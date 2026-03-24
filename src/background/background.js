/**
 * 青鸟 - Background Service Worker
 * 负责监听书签事件，并在书签变动时实时同步到飞书
 */

import { getValidUserToken, parseFeishuTableUrl, batchCreateRecords, updateRecord, deleteRecord, listRecords } from '../utils/feishu.js';
import { performSync } from '../utils/sync.js';

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/**
 * 获取当前配置，若未配置则返回 null
 */
async function getConfig() {
  const config = await chrome.storage.local.get(['tableUrl']);
  if (!config.tableUrl) return null;
  return config;
}

/**
 * 根据浏览器内部 ID 查找飞书记录
 */
async function findFeishuRecordByBrowserId(token, appToken, tableId, browserId) {
  const records = await listRecords(token, appToken, tableId);
  return records.find((r) => r.fields['浏览器内部ID'] === browserId) || null;
}

// ─── 书签事件监听 ─────────────────────────────────────────────────────────────

/**
 * 监听书签新增事件 → 同步到飞书
 */
chrome.bookmarks.onCreated.addListener(async (id, bookmark) => {
  if (!bookmark.url) return; // 忽略文件夹创建
  const config = await getConfig();
  if (!config) return;

  try {
    const token = await getValidUserToken();
    const { appToken, tableId } = parseFeishuTableUrl(config.tableUrl);

    // 获取父文件夹路径
    const ancestors = await getAncestorPath(bookmark.parentId);

    await batchCreateRecords(token, appToken, tableId, [
      {
        标题: bookmark.title,
        URL: { link: bookmark.url, text: bookmark.url },
        文件夹路径: ancestors,
        创建时间: bookmark.dateAdded,
        最后修改时间: bookmark.dateAdded,
        浏览器内部ID: id,
        同步状态: '正常',
      },
    ]);
    console.log('[青鸟] 书签已同步到飞书:', bookmark.title);
  } catch (err) {
    console.error('[青鸟] 同步新增书签失败:', err);
  }
});

/**
 * 监听书签修改事件（标题/URL 变更）→ 更新飞书
 */
chrome.bookmarks.onChanged.addListener(async (id, changeInfo) => {
  const config = await getConfig();
  if (!config) return;

  try {
    const token = await getValidUserToken();
    const { appToken, tableId } = parseFeishuTableUrl(config.tableUrl);
    const record = await findFeishuRecordByBrowserId(token, appToken, tableId, id);
    if (!record) return;

    const fields = {};
    if (changeInfo.title !== undefined) fields['标题'] = changeInfo.title;
    if (changeInfo.url !== undefined) fields['URL'] = { link: changeInfo.url, text: changeInfo.url };
    fields['最后修改时间'] = Date.now();

    await updateRecord(token, appToken, tableId, record.record_id, fields);
    console.log('[青鸟] 书签已更新到飞书, id:', id);
  } catch (err) {
    console.error('[青鸟] 同步修改书签失败:', err);
  }
});

/**
 * 监听书签移动事件（文件夹路径变更）→ 更新飞书
 */
chrome.bookmarks.onMoved.addListener(async (id, moveInfo) => {
  const config = await getConfig();
  if (!config) return;

  try {
    const token = await getValidUserToken();
    const { appToken, tableId } = parseFeishuTableUrl(config.tableUrl);
    const record = await findFeishuRecordByBrowserId(token, appToken, tableId, id);
    if (!record) return;

    const newPath = await getAncestorPath(moveInfo.parentId);
    await updateRecord(token, appToken, tableId, record.record_id, {
      文件夹路径: newPath,
      最后修改时间: Date.now(),
    });
    console.log('[青鸟] 书签路径已更新到飞书, id:', id);
  } catch (err) {
    console.error('[青鸟] 同步移动书签失败:', err);
  }
});

/**
 * 监听书签删除事件 → 在飞书中标记删除
 */
chrome.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
  if (!removeInfo.node.url) return; // 忽略文件夹删除
  const config = await getConfig();
  if (!config) return;

  try {
    const token = await getValidUserToken();
    const { appToken, tableId } = parseFeishuTableUrl(config.tableUrl);
    const record = await findFeishuRecordByBrowserId(token, appToken, tableId, id);
    if (!record) return;

    // V1 阶段：标记状态为"已删除"，而非直接删除飞书记录，保留历史数据
    await updateRecord(token, appToken, tableId, record.record_id, {
      同步状态: '已删除',
      最后修改时间: Date.now(),
    });
    console.log('[青鸟] 书签已标记删除, id:', id);
  } catch (err) {
    console.error('[青鸟] 同步删除书签失败:', err);
  }
});

// ─── 工具：获取祖先文件夹路径 ─────────────────────────────────────────────────

/**
 * 根据父文件夹 ID，递归构建完整路径字符串
 * @param {string} parentId
 * @returns {Promise<string>} 如 '/工作/前端'
 */
async function getAncestorPath(parentId) {
  const parts = [];
  let currentId = parentId;

  while (currentId && currentId !== '0') {
    const nodes = await chrome.bookmarks.get(currentId);
    const node = nodes[0];
    if (!node || node.id === '1' || node.id === '2') break; // 跳过书签栏、其他书签根节点
    parts.unshift(node.title);
    currentId = node.parentId;
  }

  return '/' + parts.join('/');
}

// ─── 监听来自 popup 的同步消息 ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SYNC_BOOKMARKS') {
    // 在后台执行同步
    doBackgroundSync();
    sendResponse({ started: true });
  }
  return true;
});

/**
 * 后台执行同步，完成后发送通知
 */
async function doBackgroundSync() {
  // 记录开始时间
  const startTime = Date.now();
  
  try {
    // 更新同步状态
    await chrome.storage.local.set({
      syncStatus: 'syncing',
      syncStartTime: startTime,
    });
    
    const result = await performSync();
    
    // 更新完成状态
    await chrome.storage.local.set({
      syncStatus: 'completed',
      syncResult: result,
      lastSyncTime: Date.now(),
    });
    
    // 发送成功通知（使用插件图标）
    try {
      await chrome.notifications.create(`sync-success-${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/icons/icon48.png'),
        title: '青鸟 - 同步完成',
        message: `新增 ${result.added} 条，更新 ${result.updated} 条书签`,
      });
      console.log('[青鸟] 成功通知已发送');
    } catch (notifyErr) {
      console.error('[青鸟] 发送通知失败:', notifyErr);
    }
    
  } catch (err) {
    console.error('[青鸟] 后台同步失败:', err);
    
    // 更新失败状态
    await chrome.storage.local.set({
      syncStatus: 'error',
      syncError: err.message,
      lastSyncTime: Date.now(),
    });
    
    // 发送失败通知（使用插件图标）
    try {
      await chrome.notifications.create(`sync-error-${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/icons/icon48.png'),
        title: '青鸟 - 同步失败',
        message: err.message || '请检查飞书配置',
      });
      console.log('[青鸟] 失败通知已发送');
    } catch (notifyErr) {
      console.error('[青鸟] 发送通知失败:', notifyErr);
    }
  }
}
