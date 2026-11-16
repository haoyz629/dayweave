<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="今序图标" width="96">
</p>

<h1 align="center">今序 · Dayweave</h1>

<p align="center">
  <strong>让今天，井然有序。</strong><br>
  <em>Bring order to your day.</em>
</p>

<p align="center">一款本地优先的 Windows 任务与日程应用，帮你把想做的事安排进真实的一天。</p>

## 从待办，到今天的安排

任务不只是清单上的一行字。今序将任务、日程和执行记录放在一起：先记下要做的事，再为它留出时间，完成后按需记录结果。你可以从一天的时间线出发，也可以通过周、月视图了解接下来的节奏。

## 你可以用今序做什么

### 看清每一天

在「今日」查看日、周、月视图，以及一天 24 小时的时间线。任务块、固定日程和重复事项可以同时出现在同一时段，让日程更贴近真实生活。

从待安排池加入任务，或调整、拖动、移除尚未执行的任务块；日常调整直接保存，并提供 10 秒撤销。已有整批安排草案时，需要确认后才会生效。

### 把任务安排到时间里

在「任务」创建普通任务或重复事项，用标签、搜索和状态筛选找到它们。信息还没想好时，可以先保存草稿；正式任务需要填写完整的开始和结束日期时间。

今天或未来的单日任务保存时直接安排；新建跨日任务会根据日期范围和平均每日投入生成任务块，剩余投入也可以从待安排池继续加入。

### 给重复的事留好位置

为重复事项设置每天、工作日、每周或每月的规则。每次发生都有独立记录，修改规则不会覆盖历史记录。

### 按需记录，而不是强迫复盘

在任务或时间线上记录本次执行结果，也可以补充详情。完成一个任务块和完成整个任务是两个独立操作；已有执行和复盘事实受到保护，不会因后续调整被随意覆盖。

### 按自己的节奏工作

通过标题栏的「设置」调整工作日、工作时段、任务块提醒、开机启动和关闭到托盘。日历内置 2026 年中国法定节假日及调休数据，支持按年份更新，并显示农历节日和二十四节气。

## 本地数据与使用边界

- 数据保存在本机 Tauri 应用数据目录中的 SQLite 数据库，正式数据由 Rust 事务保存。
- 工作时间是安排偏好和视觉参考，不限制在其他时段安排事项。
- 当前不提供账号、同步、外部日历或自动更新；界面也没有 AI 助手、AI 连接设置或独立的「复盘与记录」入口。仓库保留相关历史后端能力。
- 原有设计中的 API Key 以明文保存在本机 SQLite，请妥善保护数据库文件。
- 从旧版迁移时请先关闭旧版；已有新数据不会被覆盖，旧数据保留备份但不再双向同步。详见[更名迁移说明](docs/adr/0006-dayweave-brand-and-data-migration.md)。

单日任务时间同步、历史记录保护和撤销的详细规则见 [ADR-0005](docs/adr/0005-single-day-direct-scheduling.md)；轻量记录与历史补录规则见 [ADR-0007](docs/adr/0007-lightweight-review-and-backfill.md)。

## 开发与运行

项目使用 Tauri v2、React、TypeScript、Rust 和 SQLite。安装依赖后，在 Windows 上启动桌面开发环境：

```powershell
npm install
npm run tauri:dev
```

验证和构建命令：

```powershell
npm run build
node --experimental-strip-types --test src/*.test.mjs
npm run test:rust
npm run tauri:build -- --debug
```

## 了解更多

- [产品介绍](dayweave-product-overview.md) · [产品定位](PRODUCT.md) · [领域术语](CONTEXT.md)
- [节假日数据维护](docs/holiday-calendar-maintenance.md) · [设计规范](DESIGN.md)
- [历史实施规格](ai-todolist-implementation-spec.md) · [历史前端需求与验收](docs/frontend-requirements.md) · [冻结产品方案](docs/product-decision-baseline-2026-08-21.md)
- 领域决策：[草案确认](docs/adr/0001-persist-drafts-before-confirmed-writes.md) · [任务与每日执行](docs/adr/0002-separate-tasks-from-daily-execution.md) · [非独占时间线](docs/adr/0003-adopt-non-exclusive-daily-timeline.md) · [完整任务时间](docs/adr/0004-require-complete-task-time-and-remove-inbox.md) · [单日任务直接安排](docs/adr/0005-single-day-direct-scheduling.md) · [轻量记录与补录](docs/adr/0007-lightweight-review-and-backfill.md)
- 验收记录：[非独占时间线](docs/acceptance-non-exclusive-daily-timeline-2026-09-03.md) · [任务编辑器与时间范围](docs/acceptance-task-editor-time-range-2026-09-17.md)
