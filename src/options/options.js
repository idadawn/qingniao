/**
 * 青鸟 - Options 脚本
 */

import { initI18n, t } from '../utils/i18n.js';
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
  // 初始化 i18n
  initI18n();

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
    authStatus.textContent = t('optionsConnectedWithExpiry', expiresDate);
  } else {
    authStatus.className = 'auth-status warning';
    authStatus.textContent = t('optionsNotConnected');
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
    authStatus.textContent = t('optionsAuthFillRequired');
    return;
  }

  // 先存入 storage，getOAuthUrl / exchangeCodeForToken 内部会读取
  await chrome.storage.local.set({ appId, appSecret });

  authStatus.className = 'auth-status';
  authStatus.textContent = t('optionsAuthConnecting');

  try {
    const redirectUri = chrome.identity.getRedirectURL();
    console.log('重定向 URI:', redirectUri);
    
    const oauthUrl = await getOAuthUrl(redirectUri);
    console.log('OAuth URL:', oauthUrl);

    authStatus.textContent = t('optionsAuthWaiting');
    
    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: oauthUrl,
      interactive: true,
    });

    console.log('授权回调 URL:', responseUrl);

    const code = new URL(responseUrl).searchParams.get('code');
    if (!code) {
      const error = new URL(responseUrl).searchParams.get('error');
      throw new Error(error ? t('optionsAuthDenied', error) : t('optionsAuthNoCode'));
    }

    authStatus.textContent = t('optionsAuthGettingToken');
    const tokenData = await exchangeCodeForToken(code);

    await chrome.storage.local.set({
      userAccessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt: Date.now() + tokenData.expires_in * 1000,
    });

    const expiresDate = new Date(Date.now() + tokenData.expires_in * 1000).toLocaleDateString('zh-CN');
    authStatus.className = 'auth-status success';
    authStatus.textContent = t('optionsConnectedWithExpiry', expiresDate);
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
  verifyStatus.textContent = t('optionsVerifying');

  try {
    if (!tableUrl) throw new Error(t('optionsUrlRequired'));

    const token = await getValidUserToken();
    const { appToken, tableId } = parseFeishuTableUrl(tableUrl);
    
    // 验证表格可访问
    verifyStatus.textContent = t('optionsCheckingPermission');
    await listRecords(token, appToken, tableId);

    // 自动初始化字段（字段不存在则创建，存在则跳过）并删除默认空数据
    verifyStatus.textContent = t('optionsCheckingFields');
    const { created, failed, primaryRenamed, removedEmptyCount } = await initTableFields(token, appToken, tableId);

    // 构建结果列表
    const items = [];
    
    if (removedEmptyCount > 0) {
      items.push({ type: 'success', text: t('optionsRemovedEmpty', removedEmptyCount.toString()) });
    }
    
    if (primaryRenamed) {
      items.push({ type: 'success', text: t('optionsPrimaryRenamed') });
    }
    
    if (created > 0) {
      items.push({ type: 'success', text: t('optionsFieldsCreated', created.toString()) });
    }
    
    if (failed.length === 0 && items.length === 0) {
      items.push({ type: 'success', text: t('optionsAllFieldsReady') });
    }
    
    if (failed.length > 0) {
      items.push({ type: 'warning', text: t('optionsFieldsNeedManual', failed.join('、')) });
    }
    
    // 渲染结果
    const hasError = failed.length > 0 && created === 0 && !primaryRenamed && removedEmptyCount === 0;
    const headerIcon = hasError ? '✕' : '✓';
    const headerText = hasError ? t('optionsConnectPartialSuccess') : t('optionsConnectSuccess');
    
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
        <span>${t('optionsConnectFailed')}</span>
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
    saveStatus.textContent = t('optionsFillRequired');
    return;
  }

  await chrome.storage.local.set({ appId, appSecret, tableUrl, conflictStrategy });
  saveStatus.style.color = '#34c759';
  saveStatus.textContent = t('optionsSaved');
  setTimeout(() => (saveStatus.textContent = ''), 2000);
});

// ─── 危险操作 ─────────────────────────────────────────────────────────────────
document.getElementById('btn-reset-sync').addEventListener('click', async () => {
  const confirmed = confirm(t('optionsResetConfirm'));
  if (!confirmed) return;

  const btn = document.getElementById('btn-reset-sync');
  btn.disabled = true;
  btn.textContent = t('optionsResetting');

  try {
    const result = await performFullReset();
    alert(t('optionsResetSuccess', result.total.toString()));
  } catch (err) {
    alert(t('optionsResetFailed', err.message));
  } finally {
    btn.disabled = false;
    btn.textContent = t('optionsResetAndSync');
  }
});

// ─── 启动 ─────────────────────────────────────────────────────────────────────
init();
