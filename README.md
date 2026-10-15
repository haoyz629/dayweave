# 今序 · Dayweave

*Bring order to your day.*<br>
让今天，井然有序。

Windows 本地优先的任务、日计划与复盘应用。技术栈为 Tauri v2、React、TypeScript、Rust 与 SQLite。

## 当前能力

- 今日：月历与完整 24 小时时间线、可重叠的固定日程/任务块/重复事项、工作时间偏好、规则式日计划草案、按首次实际修改自动进入的调整流程、执行记录和 10 秒计划撤销。
- 任务：持久化手动/AI 草案与状态队列；手动创建可在普通任务和重复事项之间切换，实际编辑后自动保存草稿，离开当前任务前保存待保存的内容；任务在当前页响应式检查器中编辑，支持完整起止边界、分钟级手写与双端时间轴；正式任务必须填写完整开始和结束时间，信息不完整时只保存为草稿；支持全文搜索、长期工作量、回收站和 10 秒创建/修改撤销。
- 重复：每天、工作日、每周和每月的独立规则与按日发生记录；不生成普通任务批次，规则修改不会覆盖历史复盘事实。
- 复盘：本次结果、实际耗时、延期原因、备注与剩余工作量持久化；完成执行块不会自动完成整个任务。
- AI：用户自备 Chat Completions 或 Responses 兼容连接；多对话、搜索、重命名、归档、恢复、停止分析；创建/修改任务只生成草案，安排/完成/软删除只生成待确认提议。
- Windows：系统托盘、关闭到托盘、开机启动、全局快捷键、测试通知、晨间/晚间提醒和任务块提前提醒。
- 外观：默认、GitHub、Codex 三套主题，浅色/深色模式和字号设置。
- 日历数据：2026 年中国法定节假日和调休数据，并显示覆盖范围；农历节日和二十四节气独立显示。

SQLite 是唯一事实来源。界面只在 Rust 事务提交并重新读取数据库后显示成功；网络请求期间不持有数据库互斥锁。AI 停止后的迟到结果不会写入草案。

## 运行

```powershell
npm install
npm run tauri:dev
```

## 验证与打包

```powershell
npm run build
npm run test:rust
npm run tauri:build -- --debug
```

Rust 测试以临时 SQLite 的最终状态断言业务结果，不以 Toast、React 状态或模型文字代替事实。

## 安全与数据边界

- 数据库位于 Tauri 应用数据目录，只有 Rust 访问 SQLite。
- AI 结构化输出先经严格 schema、本地领域校验和当前状态复核；用户确认后才通过事务写入。
- API Key 按首发规格以明文保存在本机 SQLite。Key 不会出现在设置 DTO、日志、诊断和导出中，但数据库文件本身必须妥善保护。
- AI 删除只允许软删除并要求第二次确认；永久删除只允许用户从回收站手动执行。
- 当前不提供账号、同步、外部日历、网页搜索、附件、语音、本地模型、数据库加密、遥测或自动更新。

## 产品与设计资料

- [冻结产品方案](docs/product-decision-baseline-2026-08-21.md)
- [领域术语](CONTEXT.md)
- [实施规格](ai-todolist-implementation-spec.md)
- [前端需求与验收](docs/frontend-requirements.md)
- [设计规范](DESIGN.md)
- [草案确认 ADR](docs/adr/0001-persist-drafts-before-confirmed-writes.md)
- [完整任务时间与移除 Inbox ADR](docs/adr/0004-require-complete-task-time-and-remove-inbox.md)
- [任务与每日执行 ADR](docs/adr/0002-separate-tasks-from-daily-execution.md)
- [非独占日程时间线 ADR](docs/adr/0003-adopt-non-exclusive-daily-timeline.md)
- [非独占时间线验收基线](docs/acceptance-non-exclusive-daily-timeline-2026-09-03.md)
- [任务编辑器与时间范围验收基线](docs/acceptance-task-editor-time-range-2026-09-17.md)
