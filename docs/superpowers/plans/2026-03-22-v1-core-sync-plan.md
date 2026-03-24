# V1 核心同步功能实现计划

For agentic workers: REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**: 实现浏览器扩展与飞书多维表格之间的双向书签同步。

**Architecture**: 
- Background Service Worker: 监听 `chrome.bookmarks` 事件，处理与飞书 API 的通信。
- Popup UI: 提供用户交互界面，触发手动同步。
- Options Page: 提供飞书授权和同步规则配置。

**Spec**: `docs/superpowers/specs/2026-03-22-v1-core-sync-design.md`

---

## Chunk 1: 项目初始化与基础 UI

### Task 1: 初始化扩展项目结构
- [x] 创建 `manifest.json` (MV3)
- [x] 创建基础的 `background.js`
- [x] 创建 `popup.html` 和 `popup.js`
- [x] 创建 `options.html` 和 `options.js`

### Task 2: 实现 Options 页面 UI
- [x] 添加飞书 App ID 和 App Secret 输入框
- [x] 添加多维表格 URL 输入框
- [x] 实现配置的保存和读取逻辑 (`chrome.storage.local`)

### Task 3: 实现 Popup 页面 UI
- [x] 实现未连接状态的 UI（引导前往 Options）
- [x] 实现已连接状态的 UI（显示数量、同步按钮）
- [x] 实现同步中和同步完成状态的 UI 切换逻辑

---

## Chunk 2: 飞书 API 接入

### Task 4: 封装飞书 API 客户端
- [x] 实现获取 tenant_access_token 的逻辑
- [x] 实现多维表格记录的增删改查 (CRUD) 接口封装
- [x] 处理 API 请求的错误和重试机制

### Task 5: 飞书多维表格初始化
- [x] 编写脚本或提供指引，帮助用户在飞书中创建符合数据结构设计的表格
- [x] 验证扩展能否成功读取目标表格的字段信息

---

## Chunk 3: 核心同步逻辑

### Task 6: 浏览器书签读取与全量导入
- [x] 递归读取 `chrome.bookmarks` 树，扁平化为列表
- [x] 实现将本地书签批量写入飞书多维表格的逻辑
- [x] 在飞书表格中记录浏览器内部 ID，建立映射关系

### Task 7: 浏览器 → 飞书实时同步
- [x] 监听 `chrome.bookmarks.onCreated`，推送到飞书
- [x] 监听 `chrome.bookmarks.onRemoved`，在飞书中标记删除或实际删除
- [x] 监听 `chrome.bookmarks.onChanged`，更新飞书记录
- [x] 监听 `chrome.bookmarks.onMoved`，更新飞书中的文件夹路径

### Task 8: 飞书 → 浏览器手动同步
- [x] 在 Popup 中点击"立即同步"时，拉取飞书表格的最新数据
- [x] 对比本地书签和飞书数据，找出差异
- [x] 处理冲突：以最后修改时间较新者为准
- [x] 调用 `chrome.bookmarks` API 更新本地书签
- [x] 更新同步状态和时间记录
