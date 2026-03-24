/**
 * 青鸟 - Popup 脚本
 * 管理 Popup 界面的状态切换和用户交互
 */

import { initI18n, t } from '../utils/i18n.js';
import { getAllBookmarks } from '../utils/bookmarks.js';
import { getValidUserToken, parseFeishuTableUrl, listRecords } from '../utils/feishu.js';

// ─── 视图管理 ─────────────────────────────────────────────────────────────────

const views = {
  disconnected: document.getElementById('view-disconnected'),
  connected: document.getElementById('view-connected'),
  syncing: document.getElementById('view-syncing'),
  done: document.getElementById('view-done'),
  error: document.getElementById('view-error'),
};

function showView(name) {
  Object.values(views).forEach((v) => v.classList.add('hidden'));
  views[name].classList.remove('hidden');
}

// ─── 初始化 ───────────────────────────────────────────────────────────────────

async function init() {
  // 初始化 i18n
  initI18n();

  const config = await chrome.storage.local.get([
    'appId', 'appSecret', 'tableUrl', 'lastSyncTime', 'refreshToken',
    'syncStatus', 'syncResult', 'syncError'
  ]);

  if (!config.appId || !config.appSecret || !config.tableUrl || !config.refreshToken) {
    showView('disconnected');
    return;
  }

  // 检查是否有同步状态需要显示
  if (config.syncStatus === 'syncing') {
    showView('syncing');
    // 清理状态，下次打开就不会再显示 syncing
    await chrome.storage.local.remove(['syncStatus']);
    return;
  }
  
  if (config.syncStatus === 'completed' && config.syncResult) {
    // 显示上次同步结果
    document.getElementById('done-added').textContent = 
      t('popupAddedX', config.syncResult.added.toString());
    document.getElementById('done-updated').textContent = 
      t('popupUpdatedX', config.syncResult.updated.toString());
    showView('done');
    // 清理状态
    await chrome.storage.local.remove(['syncStatus', 'syncResult']);
    return;
  }
  
  if (config.syncStatus === 'error' && config.syncError) {
    document.getElementById('error-msg').textContent = config.syncError;
    showView('error');
    // 清理状态
    await chrome.storage.local.remove(['syncStatus', 'syncError']);
    return;
  }

  showView('connected');

  // 并行加载本地书签数量和飞书记录数量
  const localCountEl = document.getElementById('local-count');
  const feishuCountEl = document.getElementById('feishu-count');

  try {
    const bookmarks = await getAllBookmarks();
    localCountEl.textContent = bookmarks.length;
  } catch {
    localCountEl.textContent = '—';
  }

  try {
    const token = await getValidUserToken();
    const { appToken, tableId } = parseFeishuTableUrl(config.tableUrl);
    const records = await listRecords(token, appToken, tableId);
    feishuCountEl.textContent = records.length;
  } catch {
    feishuCountEl.textContent = '—';
  }

  // 显示上次同步时间
  if (config.lastSyncTime) {
    const date = new Date(config.lastSyncTime);
    document.getElementById('last-sync-time').textContent =
      t('popupLastSync', formatTime(date));
  }
}

// ─── 事件绑定 ─────────────────────────────────────────────────────────────────

// 前往设置
document.getElementById('btn-go-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('btn-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// 立即同步 - 在 popup 中执行，显示进度
document.getElementById('btn-sync').addEventListener('click', async () => {
  showView('syncing');
  try {
    // 发送消息给 background 执行同步
    const response = await chrome.runtime.sendMessage({ type: 'SYNC_BOOKMARKS' });
    
    if (!response || !response.started) {
      throw new Error(t('popupSyncStartFailed'));
    }
    
    // 等待同步完成，轮询检查状态
    const checkResult = await waitForSyncComplete(30000); // 最多等待30秒
    
    if (checkResult.success) {
      document.getElementById('done-added').textContent = 
        t('popupAddedX', checkResult.result.added.toString());
      document.getElementById('done-updated').textContent = 
        t('popupUpdatedX', checkResult.result.updated.toString());
      showView('done');
    } else {
      document.getElementById('error-msg').textContent = checkResult.error || t('popupSyncFailed');
      showView('error');
    }
  } catch (err) {
    document.getElementById('error-msg').textContent = err.message || t('popupUnknownError');
    showView('error');
  }
});

/**
 * 轮询等待同步完成
 */
async function waitForSyncComplete(timeoutMs) {
  const startTime = Date.now();
  const checkInterval = 500; // 每500ms检查一次
  
  while (Date.now() - startTime < timeoutMs) {
    const { syncStatus, syncResult, syncError } = await chrome.storage.local.get([
      'syncStatus', 'syncResult', 'syncError'
    ]);
    
    if (syncStatus === 'completed' && syncResult) {
      // 清理状态
      await chrome.storage.local.remove(['syncStatus', 'syncResult']);
      return { success: true, result: syncResult };
    }
    
    if (syncStatus === 'error') {
      // 清理状态
      await chrome.storage.local.remove(['syncStatus', 'syncError']);
      return { success: false, error: syncError };
    }
    
    // 继续等待
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }
  
  // 超时
  return { success: false, error: t('popupSyncTimeout') };
}

// 返回
document.getElementById('btn-back').addEventListener('click', () => {
  init();
});

// 重试
document.getElementById('btn-retry').addEventListener('click', () => {
  init();
});

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function formatTime(date) {
  const now = new Date();
  const diff = now - date;
  if (diff < 60_000) return t('timeJustNow');
  if (diff < 3_600_000) return t('timeMinutesAgo', Math.floor(diff / 60_000).toString());
  if (diff < 86_400_000) return t('timeToday', `${pad(date.getHours())}:${pad(date.getMinutes())}`);
  return t('timeDate', `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// ─── 启动 ─────────────────────────────────────────────────────────────────────
init();
