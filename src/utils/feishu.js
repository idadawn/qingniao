/**
 * 飞书 API 客户端
 * 封装所有与飞书开放平台的通信逻辑
 */

const FEISHU_BASE_URL = 'https://open.feishu.cn/open-apis';

/**
 * 带超时的 fetch 请求
 * @param {string} url - 请求URL
 * @param {Object} options - fetch 选项
 * @param {number} timeout - 超时时间（毫秒），默认10秒
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return res;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('请求超时，请检查网络连接');
    }
    throw error;
  }
}

/**
 * 带重试机制的函数包装器
 * @param {Function} fn - 要执行的异步函数
 * @param {number} retries - 最大重试次数，默认2次
 * @param {number} delay - 重试间隔（毫秒），默认1000ms
 * @returns {Promise<any>}
 */
async function withRetry(fn, retries = 2, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      // 最后一次重试失败，抛出错误
      if (i === retries - 1) throw error;
      
      // 只有网络相关错误才重试
      const isRetryableError = 
        error.message?.includes('超时') ||
        error.message?.includes('网络') ||
        error.message?.includes('Network') ||
        error.message?.includes('fetch') ||
        error.name === 'TypeError';
      
      if (!isRetryableError) throw error;
      
      console.warn(`请求失败，${delay}ms后进行第${i + 1}次重试...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function getCredentials() {
  const { appId, appSecret } = await chrome.storage.local.get(['appId', 'appSecret']);
  if (!appId || !appSecret) throw new Error('请先在设置页面填写 App ID 和 App Secret');
  return { appId, appSecret };
}

/**
 * 获取 tenant_access_token
 * tenant_access_token 用于应用级别的 API 调用，如 OAuth 授权、多维表格操作等
 */
async function getTenantAccessToken() {
  return withRetry(async () => {
    const { appId, appSecret } = await getCredentials();
    const res = await fetchWithTimeout(
      `${FEISHU_BASE_URL}/auth/v3/tenant_access_token/internal`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      },
      10000
    );
    
    const responseText = await res.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('获取 tenant token 响应解析失败:', responseText.substring(0, 500));
      throw new Error('服务器返回格式错误，请检查网络连接');
    }
    
    if (data.code !== 0) {
      throw new Error(`获取 tenant token 失败 (错误码: ${data.code}): ${data.msg}`);
    }
    return data.tenant_access_token;
  }, 2, 1000);
}

/**
 * 获取飞书 OAuth 授权 URL
 * 使用飞书网页授权端点
 * @param {string} redirectUri - 授权后的回调地址
 * @returns {Promise<string>} 完整的授权 URL
 */
export async function getOAuthUrl(redirectUri) {
  const { appId } = await getCredentials();
  // 飞书网页授权端点是 /authen/v1/authorize
  const url = new URL(`${FEISHU_BASE_URL}/authen/v1/authorize`);
  url.searchParams.set('app_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'bitable:app');
  return url.toString();
}

/**
 * 使用授权码兑换用户访问令牌
 * 使用 tenant_access_token 进行用户授权
 * 端点: POST /authen/v1/access_token
 * @param {string} code - 授权码
 * @returns {Promise<Object>} 用户令牌信息
 */
export async function exchangeCodeForToken(code) {
  try {
    const tenantToken = await getTenantAccessToken();
    const res = await fetchWithTimeout(
      `${FEISHU_BASE_URL}/authen/v1/access_token`,
      {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${tenantToken}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ grant_type: 'authorization_code', code }),
      },
      15000
    );
    
    // 获取响应文本以便调试
    const responseText = await res.text();
    console.log('Token交换响应:', responseText.substring(0, 500));
    
    // 尝试解析JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('JSON解析失败，原始响应:', responseText);
      throw new Error('服务器返回格式错误，请检查网络连接或稍后重试');
    }
    
    if (data.code !== 0) {
      throw new Error(`授权码兑换失败 (错误码: ${data.code}): ${data.msg}。请检查：
1. 应用是否开通了 bitable:app 权限
2. 重定向URI是否与应用配置完全一致
3. 授权码是否在5分钟有效期内且仅使用一次`);
    }
    return data.data;
  } catch (error) {
    console.error('OAuth token交换失败:', error);
    throw new Error(`认证失败: ${error.message}`);
  }
}

/**
 * 获取有效的用户访问令牌
 * 如果缓存的 token 仍然有效（预留5分钟缓冲），直接返回
 * 否则使用 refresh_token 刷新
 * @returns {Promise<string>} 用户访问令牌
 */
export async function getValidUserToken() {
  const stored = await chrome.storage.local.get([
    'userAccessToken', 'tokenExpiresAt', 'refreshToken',
  ]);

  if (
    stored.userAccessToken &&
    stored.tokenExpiresAt &&
    Date.now() < stored.tokenExpiresAt - 5 * 60 * 1000
  ) {
    return stored.userAccessToken;
  }

  if (!stored.refreshToken) {
    throw new Error('未连接飞书账号，请在设置页面点击「连接飞书账号」');
  }

  try {
    const tenantToken = await getTenantAccessToken();
    const res = await fetchWithTimeout(
      `${FEISHU_BASE_URL}/authen/v1/refresh_access_token`,
      {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${tenantToken}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ 
          grant_type: 'refresh_token', 
          refresh_token: stored.refreshToken 
        }),
      },
      15000
    );
    const data = await res.json();
    if (data.code !== 0) {
      throw new Error(
        `刷新授权失败 (错误码: ${data.code}): ${data.msg}。请重新在设置页面连接飞书账号。`
      );
    }

    await chrome.storage.local.set({
      userAccessToken: data.data.access_token,
      refreshToken: data.data.refresh_token,
      tokenExpiresAt: Date.now() + data.data.expires_in * 1000,
    });
    return data.data.access_token;
  } catch (error) {
    console.error('刷新token失败:', error);
    throw new Error(`刷新授权失败: ${error.message}`);
  }
}

/**
 * 从多维表格 URL 中解析出 app_token 和 table_id
 * 支持多种飞书多维表格 URL 格式：
 * - https://xxx.feishu.cn/base/{app_token}?table={table_id}
 * - https://xxx.feishu.cn/base/{app_token}?view={view_id}
 * - https://xxx.feishu.cn/base/{app_token}
 * @param {string} url
 * @returns {{ appToken: string, tableId: string | null }}
 */
export function parseFeishuTableUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    
    // 查找 'base' 在路径中的位置
    const baseIndex = pathParts.indexOf('base');
    if (baseIndex === -1 || baseIndex + 1 >= pathParts.length) {
      throw new Error('无法找到 app_token，请确保 URL 包含 /base/ 路径');
    }
    
    const appToken = pathParts[baseIndex + 1];
    if (!appToken) {
      throw new Error('无法解析 app_token');
    }
    
    // 尝试从 URL 参数获取 table_id
    let tableId = urlObj.searchParams.get('table');
    
    // 如果 URL 中没有 table 参数，返回 null，后续可能需要获取默认表
    return { appToken, tableId };
  } catch (error) {
    if (error.message.startsWith('无法') || error.message.startsWith('请确保')) {
      throw new Error(`飞书多维表格 URL 解析失败: ${error.message}`);
    }
    throw new Error(`飞书多维表格 URL 格式不正确: ${error.message}`);
  }
}

/**
 * 获取多维表格的默认数据表 ID
 * @param {string} token
 * @param {string} appToken
 * @returns {Promise<string>} 默认表的 table_id
 */
async function getDefaultTableId(token, appToken) {
  try {
    const res = await fetchWithTimeout(
      `${FEISHU_BASE_URL}/bitable/v1/apps/${appToken}/tables`,
      { headers: { Authorization: `Bearer ${token}` } },
      10000
    );
    const data = await res.json();
    if (data.code !== 0) {
      throw new Error(`获取数据表列表失败 (错误码: ${data.code}): ${data.msg}`);
    }
    
    const tables = data.data?.items || [];
    if (tables.length === 0) {
      throw new Error('多维表格中没有任何数据表');
    }
    
    // 优先返回默认表
    const defaultTable = tables.find(t => t.is_default) || tables[0];
    return defaultTable.table_id;
  } catch (error) {
    console.error('获取默认表ID失败:', error);
    throw new Error(`获取表格信息失败: ${error.message}`);
  }
}

/**
 * 所有必要字段定义
 * type: 1=文本, 2=数字, 3=单选, 15=超链接
 */
const REQUIRED_FIELDS = [
  { field_name: 'URL', type: 15, ui_type: 'Url' },
  { field_name: '文件夹路径', type: 1, ui_type: 'Text' },
  { field_name: '创建时间', type: 2, ui_type: 'Number' },
  { field_name: '最后修改时间', type: 2, ui_type: 'Number' },
  {
    field_name: '来源浏览器',
    type: 3,
    ui_type: 'SingleSelect',
    property: { 
      options: [
        { name: 'Chrome' }, 
        { name: 'Edge' }, 
        { name: 'Safari' },
        { name: 'Firefox' },
        { name: 'Opera' },
        { name: '其他' }
      ] 
    },
  },
  { field_name: '浏览器内部ID', type: 1, ui_type: 'Text' },
  {
    field_name: '同步状态',
    type: 3,
    ui_type: 'SingleSelect',
    property: { options: [{ name: '正常' }, { name: '已删除' }] },
  },
];

/**
 * 查询多维表格所有字段
 * @param {string} token
 * @param {string} appToken
 * @param {string} tableId
 * @returns {Promise<Array>}
 */
async function listFields(token, appToken, tableId) {
  try {
    const res = await fetchWithTimeout(
      `${FEISHU_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
      { headers: { Authorization: `Bearer ${token}` } },
      10000
    );
    const data = await res.json();
    if (data.code !== 0) {
      throw new Error(`获取字段列表失败 (错误码: ${data.code}): ${data.msg}`);
    }
    return data.data.items || [];
  } catch (error) {
    console.error('获取字段列表失败:', error);
    throw new Error(`获取字段信息失败: ${error.message}`);
  }
}

/**
 * 创建单个字段（带存在性检查和错误处理）
 * @param {string} token
 * @param {string} appToken
 * @param {string} tableId
 * @param {Object} field - { field_name, type, property? }
 * @returns {Promise<Object|null>} 创建的字段信息，如果字段已存在则返回 null
 */
async function createField(token, appToken, tableId, field) {
  try {
    const res = await fetchWithTimeout(
      `${FEISHU_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
      {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify(field),
      },
      10000
    );
    const data = await res.json();
    
    if (data.code === 0) {
      return data.data;
    }
    
    // 处理字段已存在的情况
    // 1254014: 字段名重复
    // 1254020: 字段已存在（可能其他错误码）
    if (data.code === 1254014 || data.code === 1254020 || data.msg?.includes('已存在') || data.msg?.includes('duplicate')) {
      console.log(`字段「${field.field_name}」已存在，跳过创建`);
      return null;
    }
    
    throw new Error(`创建字段「${field.field_name}」失败: ${data.msg} (错误码: ${data.code})`);
  } catch (error) {
    if (error.message?.includes('已存在')) return null;
    throw error;
  }
}

/**
 * 重命名索引字段（主键字段）
 * @param {string} token
 * @param {string} appToken
 * @param {string} tableId
 * @param {Array} existingFields - 现有字段列表
 * @returns {Promise<boolean>} 是否重命名成功
 */
async function renamePrimaryField(token, appToken, tableId, existingFields) {
  const primaryField = existingFields.find((f) => f.is_primary);
  if (!primaryField) {
    console.warn('找不到索引字段');
    return false;
  }
  
  // 如果已经是「标题」，不需要重命名
  if (primaryField.field_name === '标题') {
    return true;
  }
  
  try {
    const renameRes = await fetchWithTimeout(
      `${FEISHU_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${primaryField.field_id}`,
      {
        method: 'PUT',
        headers: { 
          Authorization: `Bearer ${token}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ field_name: '标题', type: primaryField.type }),
      },
      10000
    );
    const renameData = await renameRes.json();
    
    if (renameData.code === 0) {
      console.log(`索引字段已重命名为「标题」`);
      return true;
    } else if (renameData.code === 1254014 || renameData.msg?.includes('已存在')) {
      // 名称冲突，可能已经有其他字段叫「标题」
      console.warn(`无法重命名索引字段: ${renameData.msg}`);
      return false;
    } else {
      console.warn(`重命名索引字段失败: ${renameData.msg}`);
      return false;
    }
  } catch (error) {
    console.error('重命名索引字段时出错:', error);
    return false;
  }
}

/**
 * 检查并自动创建缺少的字段
 * @param {string} token
 * @param {string} appToken
 * @param {string} tableId - 可选，如果没有提供会自动获取默认表
 * @returns {Promise<{ tableId: string, created: number, failed: string[], primaryRenamed: boolean }>}
 */
export async function initTableFields(token, appToken, tableId) {
  // 如果没有提供 tableId，尝试获取默认表
  if (!tableId) {
    tableId = await getDefaultTableId(token, appToken);
  }
  
  const existing = await listFields(token, appToken, tableId);
  const existingNames = new Set(existing.map((f) => f.field_name));

  // 索引字段不叫「标题」时，尝试改名
  let primaryRenamed = false;
  if (!existingNames.has('标题')) {
    primaryRenamed = await renamePrimaryField(token, appToken, tableId, existing);
    if (primaryRenamed) {
      existingNames.add('标题');
    }
  } else {
    primaryRenamed = true;
  }

  // 找出缺失的字段并创建
  const missing = REQUIRED_FIELDS.filter((f) => !existingNames.has(f.field_name));

  let created = 0;
  const failed = [];
  for (const field of missing) {
    try {
      await createField(token, appToken, tableId, field);
      // 只要不抛出错误就认为成功（包括字段已存在的情况返回null）
      created++;
    } catch (error) {
      console.error(`创建字段「${field.field_name}」失败:`, error);
      failed.push(field.field_name);
    }
  }
  
  // 删除默认空数据（示例数据）
  const removedEmptyCount = await removeEmptyRecords(token, appToken, tableId);
  
  return { tableId, created, failed, primaryRenamed, removedEmptyCount };
}

/**
 * 检测并删除默认空数据（示例数据）
 * 飞书新建多维表格时默认会有5条示例数据
 * @param {string} token
 * @param {string} appToken
 * @param {string} tableId
 * @returns {Promise<number>} 删除的记录数量
 */
async function removeEmptyRecords(token, appToken, tableId) {
  try {
    // 获取表格记录
    const records = await listRecords(token, appToken, tableId);
    
    // 检测默认空数据：标题为空或只有示例文本，且URL为空
    const emptyRecordIds = [];
    
    for (const record of records) {
      const fields = record.fields;
      const title = fields['标题'];
      const url = fields['URL'];
      const browserId = fields['浏览器内部ID'];
      
      // 判断是否为默认空数据的条件：
      // 1. URL 为空或不存在
      // 2. 浏览器内部ID 为空或不存在
      // 3. 标题为空、null、undefined 或示例文本
      const isUrlEmpty = !url || 
        (typeof url === 'object' && !url.link) || 
        (typeof url === 'string' && url.trim() === '');
      
      const isBrowserIdEmpty = !browserId || browserId.trim() === '';
      
      const isTitleEmptyOrSample = !title || 
        title.trim() === '' || 
        ['任务', '项目', '待办', '示例', 'test', 'task', 'sample'].includes(title.trim());
      
      if (isUrlEmpty && isBrowserIdEmpty && isTitleEmptyOrSample) {
        emptyRecordIds.push(record.record_id);
      }
    }
    
    if (emptyRecordIds.length === 0) {
      return 0;
    }
    
    console.log(`检测到 ${emptyRecordIds.length} 条默认空数据，准备删除...`);
    
    // 批量删除空数据
    const result = await batchDeleteRecords(token, appToken, tableId, emptyRecordIds);
    const deletedCount = result.success;
    
    console.log(`成功删除 ${deletedCount} 条默认空数据`);
    return deletedCount;
    
  } catch (error) {
    console.error('删除默认空数据失败:', error);
    // 删除空数据失败不影响主流程，返回0
    return 0;
  }
}

/**
 * 查询多维表格所有记录
 * @param {string} token - user_access_token
 * @param {string} appToken - 多维表格 app_token
 * @param {string} tableId - 数据表 table_id
 * @returns {Promise<Array>} 记录列表
 */
export async function listRecords(token, appToken, tableId) {
  const records = [];
  let pageToken = null;
  let attempt = 0;
  const MAX_ATTEMPTS = 3;

  do {
    try {
      const url = new URL(`${FEISHU_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records`);
      url.searchParams.set('page_size', '500');
      if (pageToken) url.searchParams.set('page_token', pageToken);

      const res = await fetchWithTimeout(
        url.toString(),
        { headers: { Authorization: `Bearer ${token}` } },
        15000
      );
      const data = await res.json();
      if (data.code !== 0) {
        throw new Error(`查询记录失败 (错误码: ${data.code}): ${data.msg}`);
      }

      records.push(...(data.data.items || []));
      pageToken = data.data.has_more ? data.data.page_token : null;
      attempt = 0; // 重置重试计数
    } catch (error) {
      attempt++;
      if (attempt >= MAX_ATTEMPTS) {
        console.error(`分页查询${MAX_ATTEMPTS}次失败，终止:`, error);
        throw new Error(`获取记录列表失败: ${error.message}`);
      }
      console.warn(`分页查询失败，第${attempt}次重试:`, error);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  } while (pageToken);

  return records;
}

/**
 * 批量新增多维表格记录
 * 飞书API限制单次最多100条，自动分页处理
 * @param {string} token
 * @param {string} appToken
 * @param {string} tableId
 * @param {Array<Object>} fields - 记录字段数组
 * @returns {Promise<Array>} 新增的记录列表
 */
export async function batchCreateRecords(token, appToken, tableId, fields) {
  const BATCH_SIZE = 100; // 飞书API限制单次最多100条
  const results = [];
  
  for (let i = 0; i < fields.length; i += BATCH_SIZE) {
    const batch = fields.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetchWithTimeout(
        `${FEISHU_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ records: batch.map((f) => ({ fields: f })) }),
        },
        15000
      );
      const data = await res.json();
      if (data.code !== 0) {
        throw new Error(`批量新增记录失败 (${i}-${Math.min(i + BATCH_SIZE, fields.length)}): ${data.msg}`);
      }
      results.push(...(data.data.records || []));
    } catch (error) {
      console.error(`批量新增记录失败 (${i}-${Math.min(i + BATCH_SIZE, fields.length)}):`, error);
      throw new Error(`添加记录失败: ${error.message}`);
    }
  }
  
  return results;
}

/**
 * 更新多维表格单条记录
 * @param {string} token
 * @param {string} appToken
 * @param {string} tableId
 * @param {string} recordId - 飞书记录 ID
 * @param {Object} fields - 要更新的字段
 */
export async function updateRecord(token, appToken, tableId, recordId, fields) {
  try {
    const res = await fetchWithTimeout(
      `${FEISHU_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
      },
      10000
    );
    const data = await res.json();
    if (data.code !== 0) {
      throw new Error(`更新记录失败 (错误码: ${data.code}): ${data.msg}`);
    }
  } catch (error) {
    console.error('更新记录失败:', error);
    throw new Error(`更新记录失败: ${error.message}`);
  }
}

/**
 * 批量删除多维表格记录
 * 飞书API限制单次最多500条，自动分页处理
 * @param {string} token
 * @param {string} appToken
 * @param {string} tableId
 * @param {string[]} recordIds - 记录 ID 数组
 * @returns {Promise<{ success: number, failed: number, errors: string[] }>} 删除结果统计
 */
export async function batchDeleteRecords(token, appToken, tableId, recordIds) {
  const BATCH_SIZE = 500; // 飞书API限制单次最多500条
  
  if (recordIds.length === 0) {
    return { success: 0, failed: 0, errors: [] };
  }
  
  let success = 0;
  let failed = 0;
  const errors = [];
  
  for (let i = 0; i < recordIds.length; i += BATCH_SIZE) {
    const batch = recordIds.slice(i, i + BATCH_SIZE);
    const batchRange = `${i + 1}-${Math.min(i + BATCH_SIZE, recordIds.length)}`;
    
    try {
      const res = await fetchWithTimeout(
        `${FEISHU_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_delete`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ records: batch }),
        },
        15000
      );
      const data = await res.json();
      
      if (data.code === 0) {
        success += batch.length;
        console.log(`批量删除成功 (${batchRange}): ${batch.length} 条记录`);
      } else {
        // 记录不存在不算失败
        if (data.code === 1254043 || data.msg?.includes('不存在')) {
          success += batch.length;
          console.log(`批量删除 (${batchRange}): 记录已不存在`);
        } else {
          failed += batch.length;
          errors.push(`批次 ${batchRange}: ${data.msg}`);
          console.error(`批量删除失败 (${batchRange}, 错误码: ${data.code}): ${data.msg}`);
        }
      }
    } catch (error) {
      failed += batch.length;
      errors.push(`批次 ${batchRange}: ${error.message}`);
      console.error(`批量删除出错 (${batchRange}):`, error);
    }
    
    // 添加延迟避免速率限制（非最后一批时）
    if (i + BATCH_SIZE < recordIds.length) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  console.log(`批量删除完成: 成功 ${success}/${recordIds.length} 条记录`);
  return { success, failed, errors };
}

/**
 * 删除多维表格单条记录
 * @param {string} token
 * @param {string} appToken
 * @param {string} tableId
 * @param {string} recordId
 */
export async function deleteRecord(token, appToken, tableId, recordId) {
  try {
    const res = await fetchWithTimeout(
      `${FEISHU_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
      10000
    );
    const data = await res.json();
    if (data.code !== 0) {
      // 记录不存在不算失败（可能已被删除）
      if (data.code === 1254043 || data.msg?.includes('不存在')) {
        console.log(`记录 ${recordId} 不存在，可能已被删除`);
        return;
      }
      throw new Error(`删除记录失败 (错误码: ${data.code}): ${data.msg}`);
    }
    console.log(`记录 ${recordId} 删除成功`);
  } catch (error) {
    console.error('删除记录失败:', error);
    throw new Error(`删除记录失败: ${error.message}`);
  }
}
