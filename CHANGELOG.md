# 更新日志

所有版本的更新内容记录。

## [1.0.1] - 2026-03-25

### 🌍 国际化（i18n）
- 完整 UI 国际化支持：Popup 和 Options 页面所有文本支持中英文切换
- 新增 `src/_locales/` 语言包，包含 `zh_CN`（简体中文）和 `en`（英语）
- 新增 `src/utils/i18n.js` 工具模块，提供 `t()` 翻译函数和 `initI18n()` 页面初始化
- 后台通知消息支持国际化（同步完成/失败通知）
- 默认语言为中文，根据浏览器语言设置自动切换

## [1.0.0] - 2026-03-25

### 🚀 新功能

**飞书授权与配置**
- Options 页面：支持填写 App ID、App Secret、多维表格 URL
- 通过 `chrome.identity` 完成飞书 OAuth 2.0 授权，自动获取并刷新 user_access_token
- 多维表格连接验证：自动创建缺失字段、重命名主键列为「标题」、清除示例数据

**浏览器 → 飞书实时同步**
- 监听 `chrome.bookmarks.onCreated`：新增书签实时推送至飞书
- 监听 `chrome.bookmarks.onChanged`：标题/URL 变更实时更新飞书记录
- 监听 `chrome.bookmarks.onMoved`：文件夹路径变更实时更新飞书记录
- 监听 `chrome.bookmarks.onRemoved`：删除书签在飞书中标记为「已删除」（保留历史）

**飞书 → 浏览器手动同步**
- Popup「立即同步」按钮触发双向全量比对
- 冲突策略：以最后修改时间较新的一方为准
- 飞书独有书签自动写入浏览器（含文件夹路径自动创建）

**全量导入 / 重置**
- Options 页面提供「清空飞书表格并重新全量同步」危险操作入口
- 支持 500 条/批的分批写入，兼容大量书签场景

**Popup 界面**
- 5 种状态切换：未连接 / 已连接 / 同步中 / 同步完成 / 错误
- 已连接状态展示本地书签数、飞书记录数、上次同步时间
- 同步完成后展示新增/更新数量摘要

**飞书 API 客户端**（`utils/feishu.js`）
- 带超时（fetchWithTimeout）和自动重试（withRetry）的请求封装
- 支持分页查询（page_size=500）、批量新增（≤100条/批）、批量删除（≤500条/批）
- 飞书多维表格 URL 解析，支持带/不带 `?table=` 参数的多种格式

**项目基础**
- 初始化「青鸟」项目结构，建立 `docs/superpowers` 文档体系（设计文档 + 实现计划）
- 扩展基础框架：Manifest V3、Background Service Worker（ES Module）、Popup、Options
