/**
 * 青鸟 - Options 脚本
 */

import {
  getOAuthUrl,
  exchangeCodeForToken,
  getValidUserToken,
  parseFeishuTableUrl,
  listRecords,
  initTableFields,
} from '../utils/feishu.js';
import { performFullReset } from '../utils/sync.js';

const appIdInput = document.getElementById('app-id');
const appSecretInput = document.getElementById('app-secret');
const tableUrlInput = document.getElementById('table-url');
const tableUrlInputGroup = document.getElementById('table-url-input-group');
const tableUrlDisplayGroup = document.getElementById('table-url-display-group');
const tableUrlLink = document.getElementById('table-url-link');
const btnEditTableUrl = document.getElementById('btn-edit-table-url');
const btnVerifyRow = document.getElementById('btn-verify-row');
const verifyStatus = document.getElementById('verify-status');
const saveStatus = document.getElementById('save-status');
const authStatus = document.getElementById('auth-status');
const verifyResult = document.getElementById('verify-result');

// ─── 初始化 ───────────────────────────────────────────────────────────────────
async function init() {
  const config = await chrome.storage.local.get([
    'appId', 'appSecret', 'tableUrl', 'conflictStrategy', 'tokenExpiresAt',
  ]);

  if (config.appId) appIdInput.value = config.appId;
  if (config.appSecret) appSecretInput.value = config.appSecret;
  if (config.tableUrl) tableUrlInput.value = config.tableUrl;

  const strategy = config.conflictStrategy || 'newer';
  const radio = document.querySelector(`input[name="conflict"][value="${strategy}"]`);
  if (radio) radio.checked = true;

  document.getElementById('redirect-uri').textContent = chrome.identity.getRedirectURL();

  if (config.tokenExpiresAt) {
    const expiresDate = new Date(config.tokenExpiresAt).toLocaleDateString('zh-CN');
    authStatus.className = 'auth-status success';
    authStatus.textContent = `✓ 已连接（有效期至 ${expiresDate}）`;
  } else {
    authStatus.className = 'auth-status warning';
    authStatus.textContent = '未连接';
  }
  
  // 根据是否配置了 tableUrl 切换显示模式
  if (config.tableUrl) {
    showTableUrlReadOnly(config.tableUrl);
  } else {
    showTableUrlEdit();
  }
}

// 显示表格 URL 只读模式（已配置）
function showTableUrlReadOnly(url) {
  tableUrlInputGroup.classList.add('hidden');
  tableUrlDisplayGroup.classList.remove('hidden');
  tableUrlLink.href = url;
  tableUrlLink.textContent = url;
}

// 显示表格 URL 编辑模式
function showTableUrlEdit() {
  tableUrlInputGroup.classList.remove('hidden');
  tableUrlDisplayGroup.classList.add('hidden');
  verifyResult.classList.add('hidden');
}

// ─── 连接飞书账号 ──────────────────────────────────────────────────────────────
document.getElementById('btn-authorize').addEventListener('click', async () => {
  const appId = appIdInput.value.trim();
  const appSecret = appSecretInput.value.trim();

  if (!appId || !appSecret) {
    authStatus.className = 'auth-status error';
    authStatus.textContent = '请先填写 App ID 和 App Secret';
    return;
  }

  // 先存入 storage，getOAuthUrl / exchangeCodeForToken 内部会读取
  await chrome.storage.local.set({ appId, appSecret });

  authStatus.className = 'auth-status';
  authStatus.textContent = '连接中...';

  try {
    const redirectUri = chrome.identity.getRedirectURL();
    console.log('重定向 URI:', redirectUri);
    
    const oauthUrl = await getOAuthUrl(redirectUri);
    console.log('OAuth URL:', oauthUrl);

    authStatus.textContent = '等待授权...';
    
    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: oauthUrl,
      interactive: true,
    });

    console.log('授权回调 URL:', responseUrl);

    const code = new URL(responseUrl).searchParams.get('code');
    if (!code) {
      const error = new URL(responseUrl).searchParams.get('error');
      throw new Error(error ? `授权被拒绝: ${error}` : '未获取到授权码');
    }

    authStatus.textContent = '正在获取令牌...';
    const tokenData = await exchangeCodeForToken(code);

    await chrome.storage.local.set({
      userAccessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt: Date.now() + tokenData.expires_in * 1000,
    });

    const expiresDate = new Date(Date.now() + tokenData.expires_in * 1000).toLocaleDateString('zh-CN');
    authStatus.className = 'auth-status success';
    authStatus.textContent = `✓ 连接成功（有效期至 ${expiresDate}）`;
  } catch (err) {
    console.error('授权失败详情:', err);
    authStatus.className = 'auth-status error';
    authStatus.textContent = `✕ ${err.message}`;
  }
});

// ─── 验证连接 ─────────────────────────────────────────────────────────────────
document.getElementById('btn-verify').addEventListener('click', async () => {
  const tableUrl = tableUrlInput.value.trim();
  verifyResult.className = 'verify-result hidden';
  verifyStatus.textContent = '验证连接中...';

  try {
    if (!tableUrl) throw new Error('请填写多维表格 URL');

    const token = await getValidUserToken();
    const { appToken, tableId } = parseFeishuTableUrl(tableUrl);
    
    // 验证表格可访问
    verifyStatus.textContent = '验证表格访问权限...';
    await listRecords(token, appToken, tableId);

    // 自动初始化字段（字段不存在则创建，存在则跳过）并删除默认空数据
    verifyStatus.textContent = '检查字段并清理示例数据...';
    const { created, failed, primaryRenamed, removedEmptyCount } = await initTableFields(token, appToken, tableId);

    // 构建结果列表
    const items = [];
    
    if (removedEmptyCount > 0) {
      items.push({ type: 'success', text: `已删除 ${removedEmptyCount} 条示例数据` });
    }
    
    if (primaryRenamed) {
      items.push({ type: 'success', text: '已将第一列改名为「标题」' });
    }
    
    if (created > 0) {
      items.push({ type: 'success', text: `已自动创建 ${created} 个字段` });
    }
    
    if (failed.length === 0 && items.length === 0) {
      items.push({ type: 'success', text: '所有字段已就绪' });
    }
    
    if (failed.length > 0) {
      items.push({ type: 'warning', text: `以下字段需手动添加：${failed.join('、')}` });
    }
    
    // 渲染结果
    const hasError = failed.length > 0 && created === 0 && !primaryRenamed && removedEmptyCount === 0;
    const headerIcon = hasError ? '✕' : '✓';
    const headerText = hasError ? '连接成功，但部分字段需要手动添加' : '连接成功';
    
    verifyResult.className = hasError ? 'verify-result error-state' : 'verify-result';
    verifyResult.innerHTML = `
      <div class="verify-result-header">
        <span class="icon">${headerIcon}</span>
        <span>${headerText}</span>
      </div>
      <div class="verify-result-list">
        ${items.map(item => `
          <div class="verify-result-item ${item.type}">
            <span class="dot"></span>
            <span>${item.text}</span>
          </div>
        `).join('')}
      </div>
    `;
    
    verifyStatus.textContent = '';
    
    // 验证成功，保存配置并切换到只读模式
    if (!hasError) {
      await chrome.storage.local.set({ tableUrl });
      showTableUrlReadOnly(tableUrl);
    }
  } catch (err) {
    verifyStatus.textContent = '';
    verifyResult.className = 'verify-result error-state';
    verifyResult.innerHTML = `
      <div class="verify-result-header">
        <span class="icon">✕</span>
        <span>连接失败</span>
      </div>
      <div class="verify-result-list">
        <div class="verify-result-item error">
          <span class="dot"></span>
          <span>${err.message}</span>
        </div>
      </div>
    `;
  }
});

// ─── 修改表格 URL ─────────────────────────────────────────────────────────────
btnEditTableUrl.addEventListener('click', () => {
  showTableUrlEdit();
  tableUrlInput.focus();
});

// ─── 保存设置 ─────────────────────────────────────────────────────────────────
document.getElementById('btn-save').addEventListener('click', async () => {
  const appId = appIdInput.value.trim();
  const appSecret = appSecretInput.value.trim();
  const tableUrl = tableUrlInput.value.trim();
  const conflictStrategy = document.querySelector('input[name="conflict"]:checked')?.value || 'newer';

  if (!appId || !appSecret || !tableUrl) {
    saveStatus.style.color = '#f54a45';
    saveStatus.textContent = '请填写所有必填项';
    return;
  }

  await chrome.storage.local.set({ appId, appSecret, tableUrl, conflictStrategy });
  saveStatus.style.color = '#34c759';
  saveStatus.textContent = '✓ 已保存';
  setTimeout(() => (saveStatus.textContent = ''), 2000);
});

// ─── 危险操作 ─────────────────────────────────────────────────────────────────
document.getElementById('btn-reset-sync').addEventListener('click', async () => {
  const confirmed = confirm(
    '此操作将清空飞书多维表格中的所有书签记录，并重新从浏览器全量导入。\n\n确定要继续吗？'
  );
  if (!confirmed) return;

  const btn = document.getElementById('btn-reset-sync');
  btn.disabled = true;
  btn.textContent = '正在执行...';

  try {
    const result = await performFullReset();
    alert(`全量同步完成！共导入 ${result.total} 条书签。`);
  } catch (err) {
    alert(`操作失败：${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '清空飞书表格并重新全量同步';
  }
});

// ─── 启动 ─────────────────────────────────────────────────────────────────────
init();
