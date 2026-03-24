/**
 * 同步核心逻辑
 * 负责对比本地书签与飞书数据，计算差异并执行合并
 */

import { getAllBookmarks, createBookmark } from './bookmarks.js';
import {
  getValidUserToken,
  parseFeishuTableUrl,
  initTableFields,
  listRecords,
  batchCreateRecords,
  batchDeleteRecords,
  updateRecord,
  deleteRecord,
} from './feishu.js';

/**
 * 将本地书签对象转换为飞书多维表格字段格式
 * @param {Object} bookmark
 * @returns {Object} 飞书字段对象
 */
function toFeishuFields(bookmark) {
  return {
    标题: bookmark.title,
    URL: { link: bookmark.url, text: bookmark.url },
    文件夹路径: bookmark.folderPath,
    创建时间: bookmark.dateAdded,
    最后修改时间: bookmark.dateLastUsed || bookmark.dateAdded,
    来源浏览器: detectBrowser(),
    浏览器内部ID: bookmark.browserId,
    同步状态: '正常',
  };
}

/**
 * 检测当前浏览器类型
 * @returns {string}
 */
function detectBrowser() {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Chrome/')) return 'Chrome';
  if (ua.includes('Safari/')) return 'Safari';
  return 'Unknown';
}

/**
 * 执行完整的双向同步
 * @returns {Promise<{ added: number, updated: number, deleted: number }>} 同步结果摘要
 */
export async function performSync() {
  const config = await chrome.storage.local.get(['tableUrl']);
  const { tableUrl } = config;
  if (!tableUrl) {
    throw new Error('请先在设置页面完成飞书配置');
  }

  const token = await getValidUserToken();
  const { appToken, tableId: parsedTableId } = parseFeishuTableUrl(tableUrl);
  
  // 初始化表格字段（如果没有 tableId，会自动获取默认表）
  const { tableId } = await initTableFields(token, appToken, parsedTableId);

  // 并行获取本地书签和飞书记录
  const [localBookmarks, feishuRecords] = await Promise.all([
    getAllBookmarks(),
    listRecords(token, appToken, tableId),
  ]);

  // 建立飞书记录的索引：以浏览器内部 ID 为 key
  const feishuMap = new Map();
  for (const record of feishuRecords) {
    const browserId = record.fields['浏览器内部ID'];
    if (browserId) feishuMap.set(browserId, record);
  }

  // 建立本地书签的索引
  const localMap = new Map(localBookmarks.map((b) => [b.browserId, b]));

  let added = 0;
  let updated = 0;

  // 1. 本地 → 飞书：找出飞书中没有的书签，批量新增
  const toCreate = localBookmarks.filter((b) => !feishuMap.has(b.browserId));
  if (toCreate.length > 0) {
    const chunkSize = 500;
    for (let i = 0; i < toCreate.length; i += chunkSize) {
      const chunk = toCreate.slice(i, i + chunkSize);
      await batchCreateRecords(token, appToken, tableId, chunk.map(toFeishuFields));
    }
    added += toCreate.length;
  }

  // 2. 飞书 → 本地：找出本地没有的飞书记录，写入浏览器
  const feishuOnlyRecords = feishuRecords.filter(
    (r) => r.fields['浏览器内部ID'] && !localMap.has(r.fields['浏览器内部ID'])
  );
  for (const record of feishuOnlyRecords) {
    const f = record.fields;
    await createBookmark({
      title: f['标题'] || '未命名书签',
      url: f['URL']?.link || f['URL'] || '',
      folderPath: f['文件夹路径'] || '/',
    });
    added++;
  }

  // 3. 冲突处理：两端都有，但内容不同，以最后修改时间较新者为准
  for (const [browserId, localBm] of localMap) {
    const feishuRecord = feishuMap.get(browserId);
    if (!feishuRecord) continue;

    const localTime = localBm.dateLastUsed || localBm.dateAdded || 0;
    const feishuTime = feishuRecord.fields['最后修改时间'] || 0;

    if (localTime > feishuTime) {
      // 本地较新，更新飞书
      await updateRecord(token, appToken, tableId, feishuRecord.record_id, toFeishuFields(localBm));
      updated++;
    }
    // 飞书较新的情况：暂不处理（V1 阶段飞书→本地仅新增，不覆盖已有书签）
  }

  // 记录同步时间
  await chrome.storage.local.set({ lastSyncTime: Date.now() });

  return { added, updated, deleted: 0 };
}

/**
 * 清空飞书表格并重新全量导入所有本地书签
 * @returns {Promise<{ total: number }>}
 */
export async function performFullReset() {
  const config = await chrome.storage.local.get(['tableUrl']);
  const { tableUrl } = config;
  if (!tableUrl) {
    throw new Error('请先在设置页面完成飞书配置');
  }

  const token = await getValidUserToken();
  const { appToken, tableId: parsedTableId } = parseFeishuTableUrl(tableUrl);
  
  // 初始化表格字段（如果没有 tableId，会自动获取默认表）
  const { tableId } = await initTableFields(token, appToken, parsedTableId);

  // 删除飞书中所有现有记录
  const existingRecords = await listRecords(token, appToken, tableId);
  const recordIds = existingRecords.map((r) => r.record_id);
  const chunkSize = 500;
  for (let i = 0; i < recordIds.length; i += chunkSize) {
    await batchDeleteRecords(token, appToken, tableId, recordIds.slice(i, i + chunkSize));
  }

  // 重新全量导入本地书签
  const localBookmarks = await getAllBookmarks();
  for (let i = 0; i < localBookmarks.length; i += chunkSize) {
    const chunk = localBookmarks.slice(i, i + chunkSize);
    await batchCreateRecords(token, appToken, tableId, chunk.map(toFeishuFields));
  }

  await chrome.storage.local.set({ lastSyncTime: Date.now() });
  return { total: localBookmarks.length };
}
