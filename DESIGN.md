---
name: Dayweave Win11 Fluent Light Craft (Luminous Cool-Skylight Mica)
description: 面向 Windows 的浅色云母工作台：柔和天蓝云母底壳、雕塑感白卡与利落宝石蓝强调色
colors:
  bg-base: '#eef3f9'
  window-mica-base: '#f3f6fb'
  panel: 'rgba(255, 255, 255, 0.62)'
  surface: '#ffffff'
  surface-float: 'rgba(255, 255, 255, 0.94)'
  card: '#ffffff'
  subtle: '#f1f5f9'
  text: '#0f172a'
  text-2: '#475569'
  text-3: '#5b6b82'
  border: 'rgba(148, 163, 184, 0.24)'
  border-strong: 'rgba(148, 163, 184, 0.40)'
  grid-line: 'rgba(226, 232, 240, 0.85)'
  grid-half: 'rgba(241, 245, 249, 0.90)'
  accent: '#2563eb'
  accent-hover: '#1d4ed8'
  accent-ink: '#1d4ed8'
  accent-soft: 'rgba(37, 99, 235, 0.10)'
  accent-border: 'rgba(37, 99, 235, 0.24)'
  now-line: '#2563eb'
  success: '#10b981'
  success-text: '#0f7652'
  amber: '#d97706'
  amber-text: '#b45309'
  rose: '#f43f5e'
  rose-text: '#e11d48'
  emerald: '#10b981'
  emerald-text: '#047857'
  indigo: '#6366f1'
  slate: '#64748b'
typography:
  sans: '"Inter", "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif'
  mono: '"JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace'
  base-size: 13px
  base-line-height: 1.45
  module-title: 18px
  brand-title: 14px
  caption: 12px
  badge: 11.5px
rounded:
  sm: 6px
  md: 8px
  lg: 12px
  card: 14px
  pill: 999px
layout:
  window-default: '1280x800'
  window-min: '960x640'
  titlebar-height: 48px
  icon-rail-width: 56px
  workbench-left-width: 318px
  inspector-drawer-width: 360px
  drafts-drawer-width: 336px
  module-reading-ceiling: 1000px
motion:
  ease: 'cubic-bezier(0.22, 1, 0.36, 1)'
  fast: 140ms
  medium: 180ms
---

# Design System: 今序 · Dayweave（Win11 Fluent 浅色云母工作台）

> 当前版本仅开发和验收**浅色模式**（暗色模式暂缓）。全部设计令牌以 `src/styles/tokens.css` 及同目录分层样式为准。

## Brand & Style

今序采用 **Refined Win11 Fluent Light Craft（清透浅蓝云母工艺）** 视觉语言：
- 应用底层铺设一层连续的天蓝云母渐变背景（左上角清透天蓝光晕渐隐至 `#F3F6FB`），顶部 `48px` 标题栏与左侧 `56px` 图标导航栏以低不透明度磨砂玻璃承接云母层次，右侧主画布与内容卡片则以高可读纯白卡片形成清晰前后景分离。
- 强调克制、确定性与现代 Windows 11 原生桌面质感：所有状态均配明确文字与图标，不单靠色彩传递信息；所有破坏性操作经确认弹窗保护；高频调度变更提供 10 秒白卡撤销条（`Ctrl+Z`）。

---

## Colors

全部基础与辅助文字色均满足 WCAG AA `>= 4.5:1` 对比度要求。

### 基底与容器层（Surface Ramp）

- `--w-bg-base` (`#EEF3F9`) / 窗口底色 (`#F3F6FB` + 天蓝径向云母渐变)：应用整体画布。
- `--w-panel` (`rgba(255, 255, 255, 0.62)`)：次级工具条、抽屉底栏等半透明浅层。
- `--w-surface` / `--w-card` (`#FFFFFF`)：主时间轴画布、迷你日历卡片、任务行与设置卡片。
- `--w-surface-float` (`rgba(255, 255, 255, 0.94)` + `backdrop-filter: blur(14px)`)：右滑详情抽屉、左滑草稿箱抽屉、快录语法浮层与 Tooltip。
- `--w-subtle` (`#F1F5F9`) 与 `--w-hover` (`rgba(148, 163, 184, 0.13)`)：静默胶囊底色与轻微悬停态。
- `--w-border` (`rgba(148, 163, 184, 0.24)`) / `--w-border-strong` (`rgba(148, 163, 184, 0.40)`)：细边框与输入控件轮廓。

### 墨色层次（Typography Ink）

- `--w-text` (`#0F172A`，对比度 `17.4:1`)：主标题、任务标题、活动控件文字。
- `--w-text-2` (`#475569`，对比度 `7.6:1`)：次级操作按钮、图标导航、备注与副信息。
- `--w-text-3` (`#5B6B82`，对比度 `5.3:1`)：占位符、辅助说明、计数与时间戳。

### 强调色与语义状态

- **主强调蓝（Sapphire）**：`--w-accent: #2563EB`（悬停 `#1D4ED8`、浅底 `rgba(37, 99, 235, 0.10)`、焦点环 `rgba(37, 99, 235, 0.20)`），同时作为 24 小时时间轴的当前时间线 `--w-now`。
- **成功 / 翠绿**：`#10B981` / 文字 `#0F7652`（或 `#047857`）。
- **警示 / 琥珀**：`#D97706` / 文字 `#B45309`（草稿箱激活竖条与角标、多日徽标、倒计时警告）。
- **危险 / 紧急 / 玫红**：`#F43F5E` / 文字 `#E11D48`（P1 紧急徽标、逾期标记、删除操作、错误提示）。

### 标签与日程块陶瓷浅色盘（6 套事件块语义样式）

每个任务可绑定 1 个 5 色标签（无标签时默认回退蓝色 `.ev-blue`），日时间轴卡片与月历任务条自动同步对应色板（底色 + 1px 细边框 + 左侧语义色条）：

| 类名 | 对应标签色 | 底色 `--ev-bg` | 边框 `--ev-bd` | 左侧色条 `--ev-bar` | 强调字色 `--ev-ink` |
| --- | --- | --- | --- | --- | --- |
| `.ev-blue` | 蓝色（`blue` / 无标签默认） | `#F0F6FF` | `#C8DDFD` | `#2563EB` | `#1D4ED8` |
| `.ev-indigo` | 靛紫色（`indigo`） | `#F4F3FF` | `#D8D5FE` | `#6366F1` | `#4338CA` |
| `.ev-emerald` | 翠绿色（`emerald`） | `#EFFAF5` | `#C2EBD9` | `#10B981` | `#047857` |
| `.ev-amber` | 琥珀黄（`amber`） | `#FEF9EC` | `#F6DDA8` | `#D97706` | `#B45309` |
| `.ev-rose` | 玫红色（`rose`） | `#FFF3F5` | `#F9CBD4` | `#E11D48` | `#BE123C` |
| `.ev-slate` | 中性灰（辅助态） | `#F4F6F9` | `#D5DCE6` | `#64748B` | `#334155` |

---

## Typography

采用现代无衬线 + 等宽数字双栈（字体文件离线打包于 `src/assets/fonts/`）：

- **无衬线主栈（`--w-font-sans`）**：`"Inter", "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif`
  - 正文基准：`13px` / 行高 `1.45`
  - 模块主标题：`18px`（`600` 字重）；顶栏品牌名与抽屉标题：`14px`（`600` 字重）
  - 辅助文案与按钮：`12px`；紧凑徽标（P1/P2/多日/形态）：`11.5px`
- **等宽数字栈（`--w-font-mono`）**：`"JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace`
  - 用于 24 小时时间刻度、起止时段、时长、日期数字、计数角标与快捷键键帽（`.dw-kbd`），配合 `.tabular-nums` 防止跳动。

---

## Application Shell & Layout Architecture

默认窗口尺寸 `1280×800`，最小尺寸 `960×640`，无边框自定义窗口（`decorations: false`）：

1. **顶部集成标题栏（`48px`，`.dw-titlebar`）**
   - 左侧：`26px` 应用图标 +「今序 · Dayweave」品牌名（支持空白区域拖动窗口与双击最大化/还原）。
   - 中部：最大 `560px` 居中智能快录栏（`34px` 高圆角白底输入），右侧内置 `?` 快捷语法提示按钮与「详细 (`Ctrl+N`)」按钮；输入 `#` 或 `/` 自动展开语法浮层。
   - 右侧：在日程工作台模块展示 `[日 | 月]` 滑动分段切换器；最右侧为自定义最小化 / 最大化 / 关闭按钮（关闭按钮悬停 `#E81123`）。
2. **左侧图标导航栏（`56px`，`.dw-rail`）**
   - 顶部主组：`40×40px` 图标按钮依次为「日程（日 / 月）」、「全部任务」、「草稿箱（带琥珀计数角标）」，分隔线后为「重复规则」、「回收站（带灰蓝计数角标）」。
   - 底部组：「设置」。
   - 激活项呈现纯白微边框底块与左侧 `3px` 蓝色（草稿箱为琥珀色）胶囊指示条，悬停弹出统一白卡 Tooltip。
3. **主工作区**
   - **日程工作台（`workbench`）**：左侧 `318px` 自适应云母面板（`.dw-left-panel`）+ 右侧弹性主画布（`.dw-canvas`，承接 `DayTimeline` 或 `MonthView`）。
     - 日视图左栏：顶部雕塑白卡迷你日历（单周条可展开为 6×7 月历，带任务圆点与「今」快捷按钮）→ 中部可折叠「全天 / 多日」区 → 底部可滚动「待安排」池（`全部 / P1 / 短时` 筛选 + 标签下拉 + 行内时长弹出调整 + 一键「排入」+ 指针拖拽）。
     - 月视图左栏：顶部切换为所选日期的「当日安排」完整预览卡片列表（含「进日视图 →」入口），下方保留「待安排」池支持直接拖拽到月历任意日期格。
   - **二级功能模块（`tasks` / `recurring` / `trash` / `settings`）**：统一使用 `56px` 模块头 + 可选工具栏 + `1000px` 光学阅读宽度的居中滚动正文区（`src/styles/modules.css`）。
4. **滑出抽屉与模态层（`src/styles/overlays.css`）**
   - **右侧任务详情抽屉（`360px`，`.dw-drawer-right`）**：实时预览、子任务清单、三态排程与日期时间控件、`Ctrl+S` 保存、未保存离开确认弹窗与软删除确认弹窗。
   - **左侧草稿箱抽屉（`336px`，`.dw-drawer-left`，紧贴 `56px` 图标栏右侧）**：展示未提交草稿卡片、相对时间、「继续编辑」与带确认的删除操作。
   - **居中模态框（`.dw-modal`）**：用于详细新建弹窗（`CreateModal`）、重复规则编辑、重复调时作用域确认（`仅调整本次` / `调整本次及未来安排`）以及删除/清空/恢复确认（原生 `<dialog>`）。

---

## Elevation, Shapes & Z-Index Ladder

- **圆角尺度**：`sm: 6px`（小按钮/微标签）、`md: 8px`（常规按钮/输入框/Tooltip）、`lg: 12px`（浮层/弹窗/大容器）、`card: 14px`（迷你日历等主白卡）、`pill: 999px`（开关/计数角标）。
- **多层柔和阴影**：从 `--w-shadow-xs`（输入框）→ `--w-shadow-card`（白卡）→ `--w-shadow-float`（浮层/Tooltip）→ `--w-shadow-lg`（模态框）及抽屉侧向投影（`--w-shadow-drawer` / `--w-shadow-drawer-right`）。
- **Z-Index 阶梯（`tokens.css`）**：
  - `--z-span: 8`（月历跨日条）
  - `--z-event: 10` → `--z-event-active: 20` → `--z-resize: 22`（时间轴事件块与拉伸柄）
  - `--z-now: 30`（蓝色当前时间线）
  - `--z-rail: 35`（左侧图标导航栏）
  - `--z-titlebar: 40`（顶栏）
  - `--z-inline: 44`（时间轴就地新建浮层）
  - `--z-quick-hints: 48`（顶栏快录提示浮层）
  - `--z-drawer: 52`（左右滑出抽屉）
  - `--z-modal: 60`（居中弹窗）
  - `--z-popover: 80`（日期/时间滚轮/自定义下拉浮层）
  - `--z-toast: 90`（底部白卡通知与撤销条）
  - `--z-tooltip: 100`（统一白卡 Portal Tooltip）
- **统一动效**：曲线 `cubic-bezier(0.22, 1, 0.36, 1)`，时长 `140ms`（快）/ `180ms`（中）；当系统启用 `prefers-reduced-motion: reduce` 时，所有动画与过渡自动收敛至 `0.01ms`。

---

## Core Components & Interactions

- **按钮族**：`.dw-btn-primary`（`32px` 高，`#2563EB` 宝石蓝实心底）、`.dw-btn-ghost`（白底细描边次按钮）、`.dw-btn-danger-outline` / `.dw-btn-danger-soft` / `.dw-btn-text-danger`（玫红危险语义按钮）。
- **勾选框与开关**：定制 `16×16px` 圆角勾选框（`.dw-checkbox`，选中为宝石蓝底白勾）与 `38×20px` 胶囊拨动开关（`.sw-track`）。
- **表单与时间选择控件**：`FluentSelect`（支持色点与紧凑态）、`FluentDatePicker`（自定义月历浮层）、`FluentTimeField` + `TimeWheelPicker`（滚轮式起止时刻选择，保持至少 15 分钟间距并支持 `24:00` 结束边界）。
- **24 小时时间轴（`DayTimeline`）**：
  - `1px = 1 分钟`（总高 `1440px`），重叠任务与定时重复事项通过 `layoutOverlappingItems` 连通分量等宽分列；
  - 实时蓝色时间线（`--w-now: #2563EB`）与左侧时间胶囊；
  - 块内按高度自适应展示标题、P1/P2 徽标、起止时间与时长、标签色点、备注摘要、子任务进度（`已完成/总数`）与「下一步」首条未完成子任务；
  - 拖拽移动与上下边缘拉伸吸附 `15 / 30` 分钟（按住 `Alt` 5 分钟微调）；开启空白处拖动新建后可直接拖出时间区间，关闭后仍可双击空白处就地新建。
- **月视图（`MonthView`）**：
  - `6×7` 等宽网格，每周上方最多渲染 2 条多日弹性任务跨日条（`layoutWeekMultiDayBars`），按列精确预留垂直空间，超出条目汇总为溢出计数提示；
  - 单元格顶部展示公历数字（今日蓝色高亮圆标）、国务院法定节假日「休 / 班」角标与农历/节气文字（可在设置中关闭农历与节气显示）；
  - 单击选中同步左栏，双击直接进入该日时间轴，支持从左栏待安排池直接拖放任务到任意日期格。
- **统一白卡反馈**：
  - `TooltipHost`：全局 Portal 浮层提示，可展示主文案、次级计数与快捷键键帽（`.dw-kbd`）；
  - 底部白卡 Toast（`.dw-toast`）：常规提示 3 秒自动关闭，带撤销回调时保留 10 秒并展示「撤销 `Ctrl+Z`」按钮，错误态切为玫红提示点。

---

## Brand & Logo Assets

- **品牌规范**：正式名称「今序 · Dayweave」，中文提示可简称「今序」；双语标语 *Bring order to your day.* / 让今天，井然有序。
- **主图标**：源文件为 `src-tauri/icons/dayweave.svg`（与 `design-references/dayweave-logo/source-logo.svg` 保持逐字节一致，保留原始路径、海军蓝 D、象牙白连续折带 W 及 `viewBox="-44 10 1024 1024"`）；由 `tools/generate-dayweave-logo.mjs` 等比例导出 Windows PNG / ICO / RGBA，应用内、favicon、窗口、任务栏与安装包统一使用浅色主图标。
- **托盘与通知图标**：Windows 通知区域托盘与 WinRT 通知身份图标使用 `src-tauri/icons/tray.svg`（`16×16` 源视口，生成 `32×32` `tray.rgba` 与 `tray.png`，实心 D / 负形 W、`#E8EAED` 浅灰底与细圆角框）。

---

## Do's and Don'ts

- **Do** 保持浅色云母底壳与纯白内容卡片的清晰层级，维持所有正文与辅助文案的 WCAG AA 对比度。
- **Do** 坚持状态文字化：优先级（`P1`/`P2`）、排程形态（`待安排`/`全天 / 多日`/`已安排`）、逾期与回收站倒计时均附明确中文文字。
- **Do** 对不可逆删除、清空回收站、删除标签、删除草稿、归档/恢复规则及离开未保存详情提供清晰确认保护。
- **Don't** 在未提交 SQLite 事务成功前伪造持久化状态或静默吞掉失败错误。
- **Don't** 在当前浅色聚焦阶段顺带新增暗色模式专属分支或未验证主题切换。
- **Don't** 将时间轴上的重叠事项当作冲突报错或禁止摆放。
