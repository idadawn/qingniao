# 项目说明

本项目使用 Claude Code 作为主要开发辅助工具。

## 开发规范

1. **设计先行**：在开发任何新功能前，必须先在 `docs/superpowers/specs/` 目录下编写设计文档（Design Spec）。
2. **计划驱动**：设计完成后，在 `docs/superpowers/plans/` 目录下编写实现计划（Implementation Plan），并使用 Checkbox 追踪进度。
3. **版本管理**：发布新版本前，必须同步更新 `CHANGELOG.md`、`package.json` 和 `src/manifest.json` 中的版本号。

## 发布新版本（推送新 Tag）前必须同步修改的版本号

当用户说"发布/推送新 tag"或"升级版本"时，以下文件的版本号必须全部同步更新：

| 文件 | 位置 | 格式示例 | 说明 |
|------|------|----------|------|
| `package.json` | `version` 字段 | `"0.1.0"` | 不带 `v` 前缀 |
| `src/manifest.json` | `version` 字段 | `"0.1.0"` | 不带 `v` 前缀 |

修改完上述文件后，再执行 commit → 打 tag → push tag 的发布流程。
