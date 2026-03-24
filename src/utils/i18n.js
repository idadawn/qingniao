/**
 * i18n 工具函数
 * 提供国际化文本加载和替换功能
 */

/**
 * 获取本地化消息
 * @param {string} key - 消息 key
 * @param {...string} substitutions - 替换参数
 * @returns {string}
 */
export function t(key, ...substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

/**
 * 初始化页面 i18n
 * 自动替换所有带有 data-i18n 属性的元素
 */
export function initI18n() {
  // 替换文本内容
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const message = t(key);
    if (message) {
      el.textContent = message;
    }
  });

  // 替换 placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const message = t(key);
    if (message) {
      el.placeholder = message;
    }
  });

  // 替换 title 属性
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    const message = t(key);
    if (message) {
      el.title = message;
    }
  });
}
