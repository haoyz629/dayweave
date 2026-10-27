import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const databaseSource = readFileSync(new URL("../src-tauri/src/database.rs", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const tauriSource = readFileSync(new URL("./tauri.ts", import.meta.url), "utf8");
const userInterfaceSource = appSource.replace(
  /function uiErrorMessage\(reason: unknown\) \{[\s\S]*?\r?\n\}\r?\n\r?\nfunction pickerDateLabel/,
  "function pickerDateLabel"
);

const implementationPhrases = [
  "SQLite",
  "Rust",
  "事务",
  "执行事实",
  "复盘事实",
  "发生记录",
  "重复任务实例",
  "任务边界",
  "非阻塞时间块",
  "结构化草稿",
  "迟到结果",
  "本机事实",
  "重新校验",
  "确认并写入",
  "正在写入",
  "未写入",
  "写入本机",
  "操作未写入",
  "软删除",
  "· Asia/Shanghai",
  "RFC3339",
  "YYYY-MM-DD",
  "HH:MM"
];

test("user-facing copy does not expose implementation language", () => {
  for (const phrase of implementationPhrases) {
    assert.equal(userInterfaceSource.includes(phrase), false, `App.tsx still contains user-facing phrase: ${phrase}`);
    assert.equal(tauriSource.includes(phrase), false, `tauri.ts still contains user-facing phrase: ${phrase}`);
  }
});

test("task pages expose custom tags with shared editing, list display and filtering", () => {
  assert.match(appSource, /<TaskTagEditor[^>]*tags=\{form.tags\}/);
  assert.match(appSource, /<TaskTagList tags=\{tags\}/);
  assert.match(appSource, /matchesTag\(task.tags, tagFilter\)/);
  assert.match(appSource, /id="task-tag-filter"/);
  assert.match(appSource, /\}, form.tags\)/);
  assert.match(tauriSource, /updateManualTask\(taskId: string, update: ManualTaskUpdate, tags\?: string\[\]\)/);
  assert.match(tauriSource, /"update_manual_task", \{ taskId, update, tags \}/);
});

test("plan draft time editor stays compact and supports focused manual adjustment", () => {
  for (const phrase of ["调整草案时间", "尚未加入正式日历", "plan-draft-bounds", "plan-draft-availability"]) {
    assert.equal(appSource.includes(phrase), false, `plan draft editor still contains redundant UI: ${phrase}`);
    assert.equal(stylesSource.includes(phrase), false, `plan draft editor still contains redundant styles: ${phrase}`);
  }
  assert.match(appSource, /<BlockEditorTimeRangeRail[^>]*minimumDuration=\{MIN_TASK_BLOCK_MINUTES\}/);
  assert.match(appSource, /手写 1 分钟 · 时间轴与方向键 5 分钟 · 最短 \{minimumDuration\} 分钟/);
  assert.match(appSource, /normalizeClockInput\(/);
  assert.match(appSource, /focusedTimeRangePresentation\(/);
  assert.match(appSource, /type="text" inputMode="numeric"/);
  assert.match(appSource, /className="time-rail-endpoint-cards"/);
  assert.match(appSource, /timeline-floating-layer\$\{planDraftTimeEdit \|\| selectedRecurringOccurrence \? " is-time-editor"/);
  assert.match(stylesSource, /\.timeline-floating-layer\.is-time-editor, \.timeline-floating-layer\.is-block-editor \{ position: fixed;/);
  assert.match(stylesSource, /\.time-rail-endpoint-cards \{[^}]*grid-template-columns: 31fr 38fr 31fr/);
  assert.match(appSource, /highlightedEdge === "start" \? "is-active"/);
  assert.doesNotMatch(appSource, /continuousRailInset/);
  assert.doesNotMatch(appSource, /continuousRailWidth/);
  assert.match(appSource, /className="time-rail-continuous-selection"/);
  assert.match(appSource, /className="time-rail-selected-fill" style=\{\{ left: selectionFillLeft, right: selectionFillRight \}\}/);
  assert.match(appSource, /renderTrackWindow\(visibleWindow!, 0, 100\)/);
  assert.match(appSource, /visibleWindow!\.start \+ ratio \* continuousSpan/);
  assert.match(appSource, /className="time-rail-interval-badge"/);
  assert.match(appSource, /当前时间间隔为 \{durationLabel\}/);
  assert.match(appSource, /className="time-rail-break" aria-hidden="true" \/>/);
  assert.match(appSource, /className="time-rail-collapsed-duration"[^>]*>\{durationText\}<\/span>/);
  assert.match(appSource, /拖动两侧端点 · 中间不可拖动/);
  assert.doesNotMatch(appSource, /总间隔 \{durationLabel\}/);
  assert.doesNotMatch(appSource, /omittedDurationText/);
  assert.match(appSource, /<em>开始<\/em><strong>\{displayClock\(safeStartMinute\)\}<\/strong>/);
  assert.match(appSource, /<em>结束<\/em><strong>\{displayClock\(safeEndMinute\)\}<\/strong>/);
  assert.match(appSource, /className="time-rail-endpoint-selection start"/);
  assert.match(appSource, /className="time-rail-endpoint-pin end"/);
  assert.match(appSource, /\.filter\(Boolean\)\.join\(" "\)/);
  assert.doesNotMatch(appSource, /durationMinutes >= 45/);
  assert.match(appSource, /original_starts_at: startsAt/);
  assert.match(appSource, /className="timeline-time-reset"/);
  assert.match(appSource, /onClick=\{resetPlanDraftTime\}/);
  assert.match(stylesSource, /\.time-rail-scale\.continuous/);
  assert.match(stylesSource, /\.time-range-rail\.block-editor \{ --time-rail-arc-inset: 20px; \}/);
  assert.match(stylesSource, /\.time-rail-continuous-selection \{[^}]*top: 7px;[^}]*right: var\(--time-rail-arc-inset\);[^}]*bottom: 7px;[^}]*left: var\(--time-rail-arc-inset\);/);
  assert.match(stylesSource, /\.time-range-rail\.block-editor \.time-rail-handles \{[^}]*top: 20px;[^}]*right: var\(--time-rail-arc-inset\);[^}]*left: var\(--time-rail-arc-inset\);/);
  assert.match(stylesSource, /\.time-rail-scale\.continuous \{[^}]*margin: 0 var\(--time-rail-arc-inset\) 7px !important;/);
  assert.match(stylesSource, /\.time-range-rail\.block-editor \{ --time-rail-arc-inset: 22px; \}/);
  assert.match(stylesSource, /\.time-rail-continuous-selection::before \{[^}]*z-index: 0;[^}]*height: 8px;[^}]*background: #d1d2cb;/);
  assert.match(stylesSource, /\.time-rail-selected-fill \{[^}]*z-index: 1;[^}]*display: block;[^}]*inset-block: 0;[^}]*background: #315cea;/);
  assert.match(stylesSource, /\.time-rail-interval-badge \{[^}]*z-index: 2;/);
  assert.match(stylesSource, /\.is-continuous \.time-rail-track \{[^}]*top: 16px;[^}]*height: 8px;[^}]*background: #d9e2ee/);
  assert.match(stylesSource, /\.time-rail-track-wrap\.is-collapsed \{[^}]*border: 1px solid #cbd7e6;[^}]*background: #eef3f8;[^}]*box-shadow: none/);
  assert.match(stylesSource, /\.time-rail-break \{[^}]*background: #e3eaf2/);
  assert.match(stylesSource, /\.time-rail-break::before, \.time-rail-break::after \{[^}]*border-top: 1px dashed #9cacc0/);
  assert.match(stylesSource, /\.is-continuous \.time-rail-handle \{[^}]*width: 18px;[^}]*height: 18px;[^}]*border: 2px solid #fff/);
  assert.match(stylesSource, /\.is-continuous \.time-rail-handle\.start \{[^}]*background: #fff/);
  assert.match(stylesSource, /\.is-continuous \.time-rail-handle\.end \{[^}]*background: #315cea/);
  assert.match(stylesSource, /html\[data-mode="dark"\] \.time-range-rail\.block-editor \.time-rail-selected-fill \{ background: #6075ff;/);
  assert.match(stylesSource, /html\[data-mode="dark"\] \.time-range-rail\.block-editor \.time-rail-continuous-selection::before \{ background: #555850;/);
  assert.match(stylesSource, /html\[data-mode="dark"\] \.time-range-rail\.block-editor \.time-rail-track-wrap\.is-collapsed \{[^}]*border-color: #4b586b;[^}]*background: #293241;[^}]*box-shadow: none/);
  assert.match(stylesSource, /html\[data-mode="dark"\] \.time-range-rail\.block-editor \.is-continuous \.time-rail-track-piece \{ background: #46546a;/);
  assert.match(stylesSource, /html\[data-mode="dark"\] \.time-range-rail\.block-editor \.is-continuous \.time-rail-handle\.start \{[^}]*background: #202731/);
  assert.match(stylesSource, /html\[data-mode="dark"\] \.time-range-rail\.block-editor \.is-continuous \.time-rail-handle\.end \{[^}]*background: #7185ff/);
  assert.match(stylesSource, /\.time-rail-collapsed-duration \{[^}]*box-shadow: none/);
  assert.match(stylesSource, /\.time-rail-track-wrap\.active-end \.time-rail-endpoint-card\.end \{[^}]*box-shadow: none/);
  assert.doesNotMatch(appSource, /key: "range-gap"/);
  assert.doesNotMatch(appSource, /refreshPresentation/);
  assert.match(appSource, /timeRangePresentationCanReuse\(/);
  assert.match(appSource, /continuousTimeRangeGeometry\(presentation, safeRange\)/);
  assert.doesNotMatch(appSource, /const separatedHandleGap = 48/);
  assert.match(appSource, /const endpointWrapPadding = 13/);
  assert.match(appSource, /const selectionFillLeft = continuousGeometry \? `calc\(\$\{continuousGeometry\.startPosition\}% - \$\{endpointWrapPadding\}px\)`/);
  assert.match(appSource, /const selectionFillRight = continuousGeometry \? `calc\(\$\{100 - continuousGeometry\.endPosition\}% - \$\{endpointWrapPadding\}px\)`/);
  assert.match(appSource, /const intervalBadgeLeft = continuousGeometry/);
  assert.match(appSource, /className="time-rail-handle start" style=\{\{ left: startHandleLeft \}\}/);
  assert.match(appSource, /className="time-rail-handle end" style=\{\{ left: endHandleLeft \}\}/);
  assert.match(appSource, /className="time-rail-interval-badge" style=\{\{ left: intervalBadgeLeft \}\}/);
  assert.match(appSource, /continuousTimeScaleMarks\(visibleWindow/);
  assert.match(appSource, /const edgeThreshold = mark\.tone === "range" \? 15 : 6/);
  assert.match(stylesSource, /\.time-rail-handle \{[^}]*transition: left \.12s ease-out/);
  assert.match(stylesSource, /\.time-rail-selected-fill \{[^}]*transition: right \.12s ease-out, left \.12s ease-out/);
  assert.match(stylesSource, /\.time-rail-collapsed-duration \{[^}]*z-index: 8;[^}]*top: 50%;[^}]*left: 50%;/);
  assert.match(stylesSource, /\.time-rail-endpoint-card \{[^}]*cursor: grab/);
  assert.match(stylesSource, /\.time-rail-track-wrap\.is-collapsed:is\(\.dragging-start, \.dragging-end\) \{ cursor: grabbing; \}/);
  assert.match(stylesSource, /\.time-rail-track-wrap\.is-collapsed:is\(\.dragging-start, \.dragging-end\) :is\(\.time-rail-endpoint-cards, \.time-rail-endpoint-card\) \{ cursor: grabbing; \}/);
  assert.doesNotMatch(stylesSource, /--handle-shift/);
  assert.match(stylesSource, /\.time-rail-track-wrap\.active-start \.time-rail-endpoint-card\.start/);
  assert.match(appSource, /\{ minutes: 120, label: "2 小时" \}/);
  assert.match(appSource, /busy \? "正在保存…" : "保存调整"/);
  assert.doesNotMatch(appSource, /plan-draft-time-summary/);
  assert.doesNotMatch(appSource, /输入开始时间会按原时长同步结束时间/);
});

test("task schedule picker edits the full range with the shared timeline rail", () => {
  assert.match(appSource, /type TaskSchedulePicker = \{[\s\S]*?activeField: "start" \| "end";[\s\S]*?earliest_start_date: string;[\s\S]*?due_time: string;/);
  assert.match(appSource, /className="schedule-picker-boundaries schedule-picker-rows apple-schedule-rows"/);
  assert.match(appSource, /renderBoundaryCard\("start", "开始"/);
  assert.match(appSource, /renderBoundaryCard\("end", "结束"/);
  assert.match(appSource, /className="schedule-picker-range-panel"/);
  assert.match(appSource, /const \[pickerTimeInputs, setPickerTimeInputs\] = useState/);
  assert.match(appSource, /function updatePickerTimeInput\(/);
  assert.match(appSource, /function commitPickerTimeInput\(/);
  assert.match(appSource, /className="schedule-boundary-time-control"/);
  assert.match(appSource, /aria-label=\{`输入\$\{label\}时间`\}/);
  assert.match(appSource, /aria-invalid=\{!inputValid\}/);
  assert.match(appSource, /可输入 9、930 或 09:30，精确到 1 分钟/);
  assert.match(appSource, /请输入有效时间（00:00–23:59）/);
  assert.match(appSource, /target\?\.closest\("\.schedule-boundary-time-control"\)/);
  assert.match(appSource, /const pickerError = !pickerTimeInputsValid/);
  assert.match(appSource, /startMinuteOffset=\{0\}/);
  assert.match(appSource, /endMinuteOffset=\{pickerEndMinuteOffset\}/);
  assert.match(appSource, /showPresets=\{pickerSpanDays === 1\}/);
  assert.match(appSource, /const endMinute = endMinuteOffset \+ clockMinutes\(end\)/);
  assert.match(appSource, /const displayClock = \(minute: number\) => allowMidnightEnd[^;]*"24:00" : minutesClock/);
  assert.match(appSource, /className="schedule-picker-summary"/);
  assert.doesNotMatch(appSource, /schedule-timeline-list/);
  assert.doesNotMatch(stylesSource, /schedule-timeline-list/);
  assert.match(stylesSource, /\.schedule-picker-dialog \{[^}]*width: min\(920px, calc\(100vw - 48px\)\)/);
  assert.match(stylesSource, /\.schedule-picker-body \{[^}]*grid-template-columns: minmax\(360px, \.95fr\) minmax\(410px, 1\.05fr\)/);
  assert.match(stylesSource, /\.schedule-picker-range-panel \.time-range-rail\.block-editor \.time-rail-surface/);
  assert.match(stylesSource, /\.schedule-boundary-time-control:focus-within/);
  assert.match(stylesSource, /\.schedule-picker-rows \.schedule-time-control\.is-invalid \.schedule-boundary-time-control/);
  assert.match(stylesSource, /\.schedule-picker-footer-error/);
  assert.match(stylesSource, /@media \(max-width: 760px\) \{[\s\S]*?\.schedule-picker-body \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

test("task capsule hover actions do not stay open after a pointer click", () => {
  assert.equal(stylesSource.includes(".task-ledger-row:focus-within .ledger-row-actions"), false);
  assert.match(stylesSource, /\.task-ledger-row:has\(:focus-visible\) \.ledger-row-actions/);
});

test("task list selection is visually distinct in light and dark modes", () => {
  assert.match(stylesSource, /\.task-ledger-list \.ledger-row\.task-capsule-row \{[^}]*border: 1px solid var\(--task-card-border\);[^}]*border-radius: 14px;[^}]*background: var\(--task-card-bg\);/);
  assert.match(stylesSource, /\.task-ledger-list \.ledger-row\.task-capsule-row:not\(\.selected\):hover/);
  assert.match(stylesSource, /\.task-ledger-list \.ledger-row\.task-capsule-row\.selected \{[^}]*border-color: var\(--task-card-selected-border\);[^}]*background: var\(--task-card-selected-bg\);/);
  assert.match(stylesSource, /html\[data-mode="dark"\] \.next-workspace \.task-ledger-list \{[^}]*--task-card-selected-border: #6975b0;[^}]*--task-card-selected-bg: linear-gradient/);
});

test("task inspector keeps a single column and centers in wide desktop workspace", () => {
  assert.match(stylesSource, /\.task-form, \.deleted-inspector \{ width: min\(100%, 1280px\); max-width: none; margin-inline: auto;/);
  assert.match(stylesSource, /@container inspector \(min-width: 680px\) \{[\s\S]*?\.task-compact-body > \* \{[\s\S]*?max-width: 660px;/);
  assert.doesNotMatch(stylesSource, /\.task-compact-body > \.task-form-region:first-of-type \{ grid-column: 1; \}/);
  assert.doesNotMatch(stylesSource, /\.task-compact-body > \.task-form-region:last-of-type \{ grid-column: 2; \}/);
});

test("ordinary tasks use one recycle-bin path instead of a cancellation state", () => {
  assert.doesNotMatch(tauriSource, /export type TaskStatus = .*"cancelled"/);
  assert.doesNotMatch(appSource, /type TaskView = .*"cancelled"/);
  assert.equal(appSource.includes("不再进行"), false);
  assert.equal(appSource.includes("task-more-actions"), false);
  assert.match(appSource, /\{ label: "历史与维护", items: \["not_completed", "done", "deleted"\] \}/);
  assert.match(appSource, /className="task-compact-trash" disabled=\{busy\} onClick=\{\(\) => requestTaskChange\(\{ kind: "trash" \}\)\}/);
  assert.equal(stylesSource.includes("status-row-cancelled"), false);
  assert.equal(stylesSource.includes("terminal-task-status.cancelled"), false);
});

test("formal tasks require complete time and Inbox is no longer a product state", () => {
  assert.doesNotMatch(tauriSource, /export type TaskStatus = .*"inbox"/i);
  assert.doesNotMatch(appSource, /type TaskView = .*"inbox"/i);
  assert.equal(appSource.toLowerCase().includes("inbox"), false);
  assert.match(appSource, /const newTaskHasCompleteSchedule = taskScheduleIsComplete\(newTaskForm\)/);
  assert.match(appSource, /!newTaskHasCompleteSchedule \|\| !newTaskHasValidRange/);
  assert.match(appSource, /时间未完整时只保存为草稿/);
  assert.match(appSource, /请填写完整的任务开始和结束时间；当前内容仍可保存为草稿。/);
  assert.match(appSource, /!editingTaskHasCompleteSchedule \|\| !editingTaskHasValidRange/);
});

test("recycle-bin capsules open full details with state-specific recovery actions", () => {
  assert.match(appSource, /className="ledger-quick-action icon-only" data-tooltip="恢复"/);
  assert.match(appSource, /className="ledger-quick-action icon-only danger" data-tooltip="永久删除"/);
  assert.match(appSource, /\{recycleRetentionMessage\(deletedAt, nowMs\)\}/);
  assert.match(appSource, /window\.setInterval\(\(\) => setRecycleNow\(Date\.now\(\)\), 60 \* 1000\)/);
  assert.doesNotMatch(appSource, /<RecycleBinBanner deletedAt=\{selectedTask\.deleted_at\}/);
  assert.match(appSource, /<RecycleBinBanner deletedAt=\{selectedRecurringItem\.deleted_at\} nowMs=\{recycleNow\}/);
  assert.match(appSource, /<DeletedTaskDetails task=\{selectedTask\} metadata=\{selectedMetadata\} busy=\{busy\} now=\{recycleNow\}/);
  assert.match(appSource, /<DeletedRecurringItemDetails item=\{selectedRecurringItem\} \/>/);
  assert.match(stylesSource, /\.recycle-bin-banner \{ position: sticky;/);
  assert.match(stylesSource, /\.ledger-quick-action\.icon-only:is\(:hover, :focus-visible\)::after/);
});

test("recycle cleanup stays beside permanent deletion and task headings omit event times", () => {
  const deleted = appSource.slice(appSource.indexOf("function DeletedTaskDetails("), appSource.indexOf("function TaskStatusHistory("));
  assert.match(deleted, /onClick=\{onRestore\}[\s\S]*?<div className="task-detail-delete-group">\s*<p[^>]*>[\s\S]*?recycleCleanupMessage\(task.deleted_at, now\)[\s\S]*?<button[^>]*onClick=\{onPermanentDelete\}/);
  assert.match(stylesSource, /\.task-detail-delete-group \{[^}]*display: flex;[^}]*min-width: 0;[^}]*align-items: center;/);
  const content = appSource.slice(appSource.indexOf("function TaskDetailContent("), appSource.indexOf("function DeletedTaskDetails("));
  const heading = content.match(/<header>[\s\S]*?<\/header>/)?.[0];
  assert.ok(heading);
  assert.match(heading, /<h2>\{task.title\}<\/h2>/);
  assert.doesNotMatch(heading, /<time\b|task\.(?:completed_at|deleted_at|updated_at)|完成时间|移入时间|事件时间/);
  assert.match(content, /<dt><Icon name="clock" size=\{14\} \/>截止时间/);
  assert.match(content, /<dt><Icon name="deadline" size=\{14\} \/>优先级/);
});

test("formal task details use real resources, history, completion notes and restored status", () => {
  assert.match(appSource, /splitTaskNotes\(notes \?\? ""\)/);
  assert.match(appSource, /navigator\.clipboard\.writeText\(url\)/);
  assert.match(appSource, /await openUrl\(href\)/);
  assert.match(appSource, /const history = taskDisplayHistory\(task, metadata\?\.history \?\? \[\]\)/);
  assert.match(appSource, /new Set\(\[event\.note, event\.review_note\]/);
  assert.match(appSource, /event\.display_notes\.map/);
  assert.match(appSource, /await completeTask\(selectedTask\.id, null, note\?\.trim\(\) \|\| null\)/);
  assert.match(appSource, /<TaskCompletionDialog[^\n]*onConfirm=\{\(\) => void transition\("done", completionNote\)\}/);
  assert.match(appSource, /const restored = await getTask\(target\.id\);\s*onTaskCommitted\(restored\);\s*setView\(taskListStatus\(restored\)\)/);
  assert.match(appSource, /selectedTask\?\.execution_locked, taskMetadataRevision\]/);
  assert.doesNotMatch(appSource, />更新状态<\/button>/);
});

test("confirmed plans expose direct operations without a separate adjustment mode", () => {
  assert.doesNotMatch(appSource, />调整计划<\/button>/);
  assert.doesNotMatch(appSource, /onClick=\{onAdjustPlan\}/);
  assert.match(appSource, /sourceBlockId: selectedBlock\.id/);
  assert.doesNotMatch(appSource, /onAdjustPlan|startPlanAdjustment/);
  assert.match(appSource, /includeWaitingTask\(task, event\.currentTarget\)/);
  assert.equal(appSource.includes("移到待安排"), false);
  assert.match(appSource, /<Icon name="trash" size=\{14\} \/>从今日计划移除/);
  assert.match(appSource, /onClick=\{\(\) => void removePlanDraftBlock\(\)\}/);
});

test("timeline detail flows provide contextual return actions", () => {
  assert.doesNotMatch(appSource, /className="schedule-picker-back"/);
  assert.match(appSource, /planDraftTimeEdit\.sourceBlockId && <button[^>]*className="timeline-panel-back"[^>]*aria-label="返回任务块详情"/);
  assert.match(appSource, /className="task-context-return"><button[^>]*aria-label="返回今日计划中的任务块"/);
  assert.match(appSource, /onOpenTasks\(taskId, \{ date: selectedDate, blockId \}\)/);
  // Returning reveals the original block without reopening its editing dialog.
  assert.match(appSource, /setSelection\(null\);\s*setExecutionDraft\(null\);\s*setExecutionMessage\(""\);\s*const frame/);
  assert.match(appSource, /requestNavigation\(\{ active: "今日", timelineReturnContext: returnContext \}\)/);
  assert.match(stylesSource, /\.timeline-panel-back:focus-visible/);
  assert.match(stylesSource, /\.task-context-return button:focus-visible/);
});

test("newly included tasks are revealed on the timeline", () => {
  assert.match(appSource, /function revealTimelineBlock\(kind: "draft" \| "block", id: string\)/);
  assert.match(appSource, /revealTimelineBlock\("draft", String\(blockIndex\)\)/);
  assert.match(appSource, /scroller\.scrollTo\(\{[\s\S]*?top: nextTop,[\s\S]*?prefers-reduced-motion: reduce/);
});

test("time range handles use a hollow start and solid end", () => {
  assert.match(stylesSource, /\.time-rail-handle \{[^}]*background: #fff;/);
  assert.match(stylesSource, /\.time-rail-handle\.end \{[^}]*background: #315cea;/);
});

test("task workload copy follows same-day and cross-day scheduling semantics", () => {
  assert.match(appSource, /className="apple-schedule-workload"/);
  assert.match(appSource, /className="apple-schedule-workload-icon"/);
  assert.match(appSource, /sameDayMinutes === null \? "待计算" : <WorkloadTimeDigits minutes=\{sameDayMinutes\}/);
  assert.match(appSource, /sameDayMinutes === null \? "补全有效时间" : "自动计算"/);
  assert.match(appSource, /crossDay && \(/);
  assert.doesNotMatch(appSource, /workload-auto-field/);
  assert.doesNotMatch(stylesSource, /\.workload-auto-field/);
  assert.match(appSource, /平均每日投入/);
  assert.match(appSource, /<span>预估总投入<\/span><strong><WorkloadTimeDigits minutes=\{form\.estimated_minutes\}/);
  assert.doesNotMatch(appSource, /按时间重算/);
  assert.doesNotMatch(appSource, /使用手动值，不会被时间调整覆盖/);
});

test("clearing and restoring task time keeps the attribute grid dimensions stable", () => {
  assert.match(stylesSource, /\.task-attribute-grid\.same-day \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\); \}/);
  assert.match(stylesSource, /\.task-compact-body \.task-attribute-grid,\s*\.task-compact-body \.task-attribute-grid\.same-day \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.doesNotMatch(stylesSource, /\.task-attribute-grid\.same-day \{[^}]*260px/);
  assert.match(stylesSource, /@container inspector \(max-width: 560px\) \{[\s\S]*?\.task-compact-body \.task-attribute-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

test("result notes stay visible and editable without reasons or followup scheduling", () => {
  assert.match(appSource, /<label className="floating-execution-note"/);
  assert.doesNotMatch(appSource, /draft\.result !== null && <label className="floating-execution-note"/);
  assert.doesNotMatch(appSource, /execution-add-note|incompleteReasonOptions|未完成原因|TaskNextActionFields/);
  assert.match(appSource, /disabled=\{savingExecution \|\| busy \|\| loading \|\| Boolean\(quickCompletingBlockId\) \|\| !executionDraft\.outcome\}/);
});


test("calendar and daily plan behave as one two-level workspace", () => {
  assert.doesNotMatch(appSource, /aria-label="今日页视图"/);
  assert.equal(stylesSource.includes(".timeline-view-switch"), false);
  assert.match(appSource, /onDoubleClick=\{\(\) => openTimelineDate\(cell\.key\)\}/);
  assert.match(appSource, /aria-label="返回月历"/);
  assert.match(appSource, /aria-keyshortcuts="Escape"/);
  assert.match(appSource, /document\.querySelector\('\[role="dialog"\], \[role="alertdialog"\]'\)/);
  assert.match(appSource, /const mondayBasedIndex = weekdayIndex < 0 \? 0 : \(weekdayIndex \+ 6\) % 7/);
  assert.match(appSource, /className="timeline-week-calendar-meta"/);
  assert.match(appSource, /primaryCalendarLabel\.kind/);
  assert.match(appSource, /timeline-week-heading"><small>\{weekday\}<\/small>/);
  assert.equal(stylesSource.includes(".timeline-week-count"), false);
  assert.match(stylesSource, /button\.today:not\(\.selected\) \.timeline-week-date \{ color: var\(--today-red\); \}/);
  assert.match(stylesSource, /button\.today\.selected \.timeline-week-date \{ color: #fff; background: var\(--today-red\);/);
});

test("timeline task blocks use the centered editor and completing checkbox ends the task", () => {
  assert.match(appSource, /data-timeline-kind="block"/);
  assert.match(appSource, /target\.closest\("\.timeline-event-check"\)/);
  assert.match(appSource, /event\.stopPropagation\(\); void quickCompleteTimelineBlock\(block\)/);
  assert.match(appSource, /openTimelineTask\(selectedBlock\.task_id, selectedBlock\.id\)/);
  assert.match(appSource, /panel\.dataset\.placement = placement/);
  assert.match(appSource, /selectedBlock \? " is-block-editor"/);
  assert.match(appSource, /selectedBlock \? " task-block-editor"/);
  assert.match(stylesSource, /\.timeline-floating-layer\.is-block-editor \.timeline-floating-panel\.task-block-editor/);
  assert.match(stylesSource, /\.timeline-floating-panel \{ position: fixed;/);
  assert.match(stylesSource, /\.timeline-floating-panel, \.timeline-floating-panel\.plan-draft-editor, \.timeline-floating-panel\.task-block-editor \{ top: auto; right: 14px; bottom: 14px;/);
});

test("task selection stays inline and the inspector adapts to its available width", () => {
  assert.match(appSource, /kind: "close-compact-editor"/);
  assert.match(appSource, /const \[compactTaskEditorDismissed, setCompactTaskEditorDismissed\] = useState\(false\)/);
  assert.match(appSource, /className=\{`task-ledger\$\{resizingLedger \? " is-resizing" : ""\}`} /);
  assert.match(appSource, /className="task-form create-task-form edit-task-form task-compact-form"/);
  assert.match(appSource, /className="task-compact-header"/);
  assert.match(appSource, /className="task-compact-body"/);
  assert.match(appSource, /className="task-compact-actions"/);
  assert.doesNotMatch(appSource, /task-compact-close|aria-label="关闭任务编辑"/);
  assert.match(appSource, /idPrefix="edit-task" compact onChange=/);
  assert.match(appSource, /<label htmlFor=\{titleId\} className="sr-only">标题<\/label>/);
  assert.match(appSource, /placeholder="标题"/);
  assert.doesNotMatch(appSource, /任务标题|事项标题/);
  assert.match(appSource, /className="task-form-region task-notes-region" aria-label="备注"/);
  assert.doesNotMatch(appSource, /备注说明/);
  assert.match(appSource, /<strong id=\{attributesTitleId\}>安排与时限<\/strong>/);
  assert.match(appSource, /placeholder="备注"/);
  assert.doesNotMatch(appSource, /taskEditorOpen|fullScreenTaskEditor|open-editor|全屏编辑/);
  assert.doesNotMatch(stylesSource, /task-editor-workspace|is-task-editor-open|task-fullscreen/);
  assert.match(stylesSource, /\.task-compact-form \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;[\s\S]*?border: 0;[\s\S]*?box-shadow: none;/);
  assert.match(stylesSource, /\.task-compact-body \{[\s\S]*?overflow-y: auto;/);
  assert.match(stylesSource, /\.task-compact-body \.apple-schedule-rows \{[\s\S]*?flex-direction: column;/);
  assert.match(stylesSource, /\.task-compact-actions \{[\s\S]*?justify-content: space-between;/);
  assert.match(stylesSource, /@container inspector \(min-width: 680px\) \{[\s\S]*?\.task-compact-body > \* \{[\s\S]*?max-width: 660px;/);
  assert.match(stylesSource, /@container inspector \(max-width: 560px\) \{[\s\S]*?\.task-compact-body \.apple-schedule-rows \{ display: flex; flex-direction: column;/);
  assert.match(stylesSource, /html\[data-mode="dark"\] \.task-compact-form/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\) \{\s*\.task-compact-form \{ animation: none; \}/);
});

test("task editor uses shared semantic colors and keeps recycle actions in place", () => {
  assert.match(appSource, /className="task-region-title-row"/);
  assert.doesNotMatch(appSource, /className="task-region-workload"/);
  assert.match(appSource, /className=\{compact \? "apple-schedule-toolbar" : undefined\}/);
  assert.match(appSource, /sameDay \? <output className="apple-schedule-workload"/);
  assert.match(appSource, /className=\{`priority-select-control priority-tone-\$\{form\.priority \?\? "unset"\}`\}/);
  assert.match(appSource, /<option value="low">低优先级<\/option><option value="medium">中优先级<\/option><option value="high">高优先级<\/option>/);
  assert.match(appSource, /status=\{statusCopy\[taskListStatus\(task\)\]\} statusTone=\{taskListStatus\(task\)\}/);
  assert.match(appSource, /status="待确认" statusTone="draft"/);
  assert.match(stylesSource, /--task-state-draft:/);
  assert.match(stylesSource, /--task-state-open:/);
  assert.match(stylesSource, /--task-state-scheduled:/);
  assert.match(stylesSource, /--task-state-done:/);
  assert.match(stylesSource, /--task-state-deleted:/);
  assert.match(stylesSource, /--priority-low:/);
  assert.match(stylesSource, /--priority-medium:/);
  assert.match(stylesSource, /--priority-high:/);
  assert.match(stylesSource, /\.task-capsule-status\.status-scheduled \{ color: var\(--task-state-scheduled\); border-color: var\(--task-state-scheduled-border\); background: var\(--task-state-scheduled-surface\); \}/);
  assert.match(stylesSource, /\.priority-select-control > select,[\s\S]*?background: var\(--priority-surface\);/);
  assert.match(stylesSource, /\.priority-select-control::after \{[^}]*rotate\(45deg\);/);
  assert.match(stylesSource, /\.priority-select-control > select,[\s\S]*?appearance: none;/);
  assert.match(stylesSource, /\.task-compact-body \.task-planning-section \.apple-schedule-editor > header \{[\s\S]*?position: static;[\s\S]*?justify-content: space-between;/);
  assert.match(stylesSource, /\.task-compact-trash \{ color: var\(--task-state-deleted\);/);
  assert.doesNotMatch(appSource, /setView\(["']deleted["']\)/);
});

test("task capsule titles stay on one line and timeline task blocks fit their available height", () => {
  assert.match(appSource, /<strong title=\{title\}>\{title\}<\/strong>/);
  assert.match(stylesSource, /\.task-capsule-heading > strong \{[^}]*display: block;[^}]*flex: 1 1 auto;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
  assert.doesNotMatch(stylesSource, /\.task-capsule-heading > strong \{[^}]*-webkit-line-clamp:/);
  assert.match(stylesSource, /\.timeline-lanes \.task-capsule-content\.compact \{[^}]*height: auto;[^}]*min-height: 76px;/);
  assert.match(stylesSource, /\.timeline-task-body, \.timeline-event\.execution-block \.timeline-task-body \{[^}]*display: flex;[^}]*height: 100%;[^}]*overflow: hidden;/);
  assert.match(stylesSource, /\.timeline-event-body \{[^}]*min-width: 0;[^}]*width: 100%;[^}]*overflow: hidden;/);
});

test("cross-day daily workload input resets focus styles and recurring items use apple-style schedule picker", () => {
  assert.match(stylesSource, /:is\(\.apple-schedule-workload-control, \.task-compact-body \.apple-schedule-workload-control\) input:focus/);
  assert.match(stylesSource, /box-shadow: none !important;/);
  assert.match(stylesSource, /background: transparent !important;/);

  assert.match(appSource, /function RecurringValidityPicker/);
  assert.match(appSource, /有效日期范围/);
  assert.match(appSource, /设为长期有效/);
  assert.match(appSource, /recurring-validity-card/);
  assert.match(appSource, /className="apple-schedule-rows"/);
  assert.match(appSource, /schedule-validity-presets/);
  assert.match(appSource, /schedule-time-control/);
  assert.match(appSource, /time-duration-presets/);
  assert.match(appSource, /starts_on:\s*draftStartsOn,\s*ends_on:\s*draftEndsOn/);
});
test("switching between task and recurring tabs preserves inputs without modal prompt", () => {
  assert.doesNotMatch(appSource, /pendingCreateType/);
  assert.match(appSource, /syncFormCommonFields/);
  assert.match(appSource, /applyCreateItemType/);
});

test("ordinary and recurring task time inputs enforce 4-digit limit and preserve typing flow", () => {
  assert.match(appSource, /sanitizeTimeInput/);
  assert.match(appSource, /function updatePickerTimeInput\(field: TaskSchedulePicker\["activeField"\], value: string\) \{[\s\S]*?sanitizeTimeInput\(value\)/);
  assert.match(appSource, /function commitPickerTimeInput\(field: TaskSchedulePicker\["activeField"\], value: string\) \{[\s\S]*?sanitizeTimeInput\(value\)/);
  assert.match(appSource, /<input type="text" inputMode="numeric" autoComplete="off" spellCheck=\{false\} maxLength=\{5\} value=\{inputValue\}/);
  assert.match(appSource, /function updateTimeInput\(field: TimeRangeEdge, raw: string, commit = false\)/);
  assert.match(appSource, /function commitTimeInput\(field: TimeRangeEdge, raw: string\)/);
  assert.match(appSource, /function handleTimeKeyDown\(event: KeyboardEvent<HTMLInputElement>, field: TimeRangeEdge\)/);
  assert.match(appSource, /cancelledTimeBlurRef/);
});

test("recurring item editor uses start/end dates and times with inline occurrence preview", () => {
  // Title wrap contains both label and inline recent occurrences preview
  assert.match(appSource, /recurring-validity-title-wrap/);
  assert.match(appSource, /recurring-inline-preview/);
  assert.match(appSource, /最近发生：/);

  // Both boundaries expose a date and a clock, not a duration field.
  assert.match(appSource, /const clockRange = recurringClockRange\(form\)/);
  assert.match(appSource, /结束时间：\$\{clockRange\.end/);
  assert.doesNotMatch(appSource.slice(appSource.indexOf("function RecurringItemEditor"), appSource.indexOf("function RecurringItemEditor") + 20000), /设置时长|htmlFor="recurring-picker-duration"/);

  // Standalone recurring-display-group removed from editor
  assert.doesNotMatch(appSource, /<div className="recurring-display-group">/);
  assert.doesNotMatch(appSource, /<div className="recurring-preview" role="status"/);

  assert.match(appSource, /renderBoundary\("start", "开始", draftStartsOn\)/);
  assert.match(appSource, /renderBoundary\("end", "结束", draftEndsOn\)/);
  assert.match(stylesSource, /\.recurring-validity-title-wrap/);
  assert.match(stylesSource, /\.recurring-inline-preview/);
  assert.match(stylesSource, /\.schedule-picker-boundaries\.schedule-picker-rows[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("draft capsule keeps layout stable during autosave and active editing", () => {
  // Capsule status badge has fixed min-width and alignment to prevent width-shift jitter
  assert.match(stylesSource, /\.task-capsule-status\s*\{[\s\S]*?min-width:\s*48px;[\s\S]*?justify-content:\s*center;[\s\S]*?box-sizing:\s*border-box;/);

  // Both unpersisted and persisted draft capsules use stable "待确认" status
  assert.match(appSource, /status="待确认"\s+statusTone="draft"/);

  // Draft capsules do not toggle raw "保存中" or "草稿已保存" inside the capsule status pill
  assert.doesNotMatch(appSource, /status=\{draftSaving \? "保存中"/);

  // Active editing draft capsule is bound to live form data
  assert.match(appSource, /isEditingActiveDraft/);
  assert.match(appSource, /const common = isEditingActiveDraft[\s\S]*?const draftTitle = common\.title/);
  assert.match(appSource, /taskDraftTimingFact/);

  // Saving existing draft preserves position in draft list
  assert.match(appSource, /current\.map\(\(item\) => \(item\.id === saved\.id \? saved : item\)\)/);
});

test("recurring validity picker shares ordinary date grid, range rail, boundary feedback and footer", () => {
  const picker = appSource.slice(appSource.indexOf("function RecurringValidityPicker"), appSource.indexOf("function RecurringItemEditor"));
  assert.match(picker, /schedule-picker-dialog recurring-schedule-dialog/);
  assert.match(picker, /schedule-picker-header/);
  assert.match(picker, /schedule-picker-boundaries schedule-picker-rows apple-schedule-rows/);
  assert.match(picker, /<ScheduleDateGrid/);
  assert.match(picker, /<BlockEditorTimeRangeRail[^>]*allowMidnightEnd/);
  assert.match(picker, /schedule-picker-range-panel/);
  assert.match(picker, /schedule-occurrence-preview/);
  assert.match(picker, /schedule-picker-summary/);
  assert.match(picker, /schedule-picker-confirm/);
  assert.doesNotMatch(picker, /recurring-target-tabs|recurring-calendar-grid|schedule-duration-control/);
  assert.match(picker, /applyValidityPreset\(action: "open" \| "days" \| "year_end"/);
  assert.match(picker, /schedule-validity-presets/);
  assert.match(picker, /长期有效/);
  assert.match(picker, /onConfirm\(draftStartsOn, draftEndsOn, timeInput.display_time, timeInput.display_duration_minutes\)/);
  assert.match(stylesSource, /\.schedule-picker-rows \.apple-schedule-row/);
  assert.match(stylesSource, /\.schedule-picker-boundaries \.schedule-boundary-row\.is-active/);
  assert.match(stylesSource, /\.schedule-validity-presets button\.is-active/);
  assert.match(stylesSource, /\.schedule-picker-rows :is\(\.schedule-boundary-time-control, \.schedule-duration-control\) input[^}]*border: 0/);

  // Frequency excludes weekdays and monthly expands into 3-column single row
  assert.doesNotMatch(appSource, /<option value="weekdays">/);
  assert.match(appSource, /recurring-rule-grid\$\{form\.frequency === "monthly" \? " is-monthly" : ""\}/);
  assert.match(stylesSource, /\.recurring-rule-grid\.is-monthly\s*\{\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);?\s*\}/);
  assert.match(stylesSource, /\.task-compact-body \.recurring-rule-grid\.is-monthly\s*\{\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);?\s*\}/);
});

test("task draft autosave starts after editing and flushes on task switch", () => {
  // Fresh version tracking with ref
  assert.match(appSource, /const persistedNewTaskDraftRef = useRef<TaskDraft \| null>\(null\);/);
  assert.match(appSource, /persistedNewTaskDraftRef\.current \?\? persistedNewTaskDraft/);

  // Auto-flush during task switch without discarding
  assert.match(appSource, /async function requestTaskChange[\s\S]*?if \(creating\) \{[\s\S]*?if \(!await saveNewTaskBeforeLeaving\(\)\) return;/);

  // Switching drafts auto-flushes instead of showing blocking modal
  assert.match(appSource, /async function selectPersistedTaskDraft\(item: TaskDraft\)[\s\S]*?await saveNewTaskBeforeLeaving\(\)[\s\S]*?await openPersistedTaskDraft\(item\);/);

  // discardAndContinue clears new task form instead of deleting saved drafts
  const discardAndContinueBody = appSource.match(/async function discardAndContinue\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.match(discardAndContinueBody, /clearNewTaskForm\(\);/);
  assert.doesNotMatch(discardAndContinueBody, /cancelNewTask/);

  // Draft save status checks dirty state before checking persisted draft
  assert.match(appSource, /newTaskIsDirty && \(persistedNewTaskDraft \|\| newTaskFieldsAreDirty\)[\s\S]*?newTaskAutosaveArmed \? "将在停止输入后自动保存" : "离开当前任务前保存"/);
});

test("recurring task draft autosave, draft list presentation, and label unification", () => {
  // Label unification: 生效开始日期 -> 开始日期
  assert.match(appSource, /renderBoundary\("start", "开始", draftStartsOn\)/);
  assert.match(appSource, /aria-label=\{`开始日期：\$\{pickerDateLabel\(form.starts_on\)\}/);
  assert.doesNotMatch(appSource, /生效开始/);

  // Type is a property of each persisted draft; both variants share one list and save flow.
  assert.match(appSource, /draft: taskDrafts\.length/);
  assert.match(appSource, /visibleTaskDrafts\.map/);
  assert.match(appSource, /const itemType = isEditingActiveDraft \? createItemType : item.item_type/);
  assert.match(appSource, /confirmCreationDraft\(persisted\)/);
  assert.doesNotMatch(appSource, /hasRecurringDraft|storedRecurringDraft|persistRecurringDraft|saveStoredRecurringDraft/);
  assert.match(appSource, /await importLegacyRecurringDraft/);

});

test("recurring task page keeps frequency controls and shares cross-day schedule rows", () => {
  // Daily convention radio group
  assert.match(appSource, /日常规约：/);
  assert.match(appSource, /所有自然日/);
  assert.match(appSource, /仅工作日/);
  assert.match(stylesSource, /\.recurring-daily-bar\s*\{/);

  // Weekly 7-button weekday selector
  assert.match(appSource, /recurring-weekday-grid/);
  assert.match(appSource, /recurring-weekday-btn/);
  assert.match(stylesSource, /\.recurring-weekday-btn\.is-active\s*\{/);

  // Monthly 3-column inline grid & info banner
  assert.match(appSource, /每月日期/);
  assert.match(appSource, /若当月没有所选日期，将跳过该月。/);
  assert.doesNotMatch(appSource, /自动适配到当月最后一天/);
  // User explicitly discarded the switch to weekly shortcut button
  assert.doesNotMatch(appSource, /切换为每周重复/);

  // Recurring editor inherits the ordinary editor's date/time row styles, not picker overrides.
  const recurringEditor = appSource.slice(appSource.indexOf("function RecurringItemEditor"), appSource.indexOf("function RecurringItemEditor") + 20000);
  assert.match(recurringEditor, /className="apple-schedule-rows"/);
  assert.doesNotMatch(recurringEditor, /schedule-picker-rows|recurring-schedule-grid|recurring-schedule-field/);
  assert.match(stylesSource, /\.task-compact-body \.apple-schedule-row/);
  assert.match(stylesSource, /\.task-compact-body \.apple-schedule-values button/);
});

test("execution records live in timeline dialogs, not a separate Today subview", () => {
  const navigation = appSource.match(/const navigation:[\s\S]*?\n\];/)?.[0] ?? "";
  assert.match(navigation, /label: "今日"/);
  assert.match(navigation, /label: "任务"/);
  assert.match(navigation, /label: "设置"/);
  assert.doesNotMatch(navigation, /label: "复盘"/);
  assert.doesNotMatch(appSource, /today-section-tabs|todaySection|<ReviewPage|复盘与记录/);
  assert.match(appSource, /normalizeTodayNavigation\(intent.active\)/);
  assert.match(appSource, /<TodayPage visible today=/);
  assert.match(appSource, /<ExecutionCaptureFields key=\{selectedBlock.id\}/);
  assert.doesNotMatch(appSource, /incomplete-reasons|execution-reason-details/);
  assert.match(appSource, /value === "completed" \? "completed" : "not_started"/);
});

test("incomplete saves results and offers a plain independent draft from toast and details", () => {
  assert.match(appSource, /canCaptureTaskResult\(selectedDate, today, selectedBlock, clock.getTime\(\)\)/);
  assert.match(appSource, /\|\| savingExecution \|\| busy \|\| loading \|\| preview \|\| quickCompletingBlockId/);
  assert.match(appSource, /canCaptureTaskResult\(selectedDate, today, selectedBlock, Date\.now\(\)\)/);
  assert.match(appSource, /await resolveTaskExecution\(resultDate, input\)/);
  assert.match(appSource, /仅记录当天结果，不改变其他日期的记录/);
  assert.match(appSource, /所有日期完成后，任务自动完成/);
  assert.match(appSource, /await saveExecutionCapture\(resultDate/);
  assert.match(appSource, /label: "新建任务"/);
  assert.match(appSource, /requestNavigation\(\{ active: "任务", taskSeed: planToast.taskSeed \}\)/);
  assert.match(appSource, /createManualTaskDraft\(independentTaskDraft/);
  assert.match(appSource, /<TaskStatusHistory/);
  assert.doesNotMatch(appSource, /followupSourceId|prepareTaskFollowup|TaskRelations|TaskOriginBanner|status_locked/);
});

test("legacy confirmed records remain readable in the block dialog without another review form", () => {
  assert.match(appSource, /selectedBlock.review && !canRecordSelectedBlock \? <>/);
  assert.match(appSource, /selectedBlock.review.actual_minutes !== null/);
  assert.match(appSource, /selectedBlock.review.remaining_workload_minutes !== null/);
  assert.match(appSource, /selectedBlock.review.notes/);
  assert.match(appSource, /selectedBlock.review.defer_reason/);
  assert.match(appSource, /已超过结果修改时间/);
  assert.doesNotMatch(appSource, /<ReviewPage|useReviewCloseGuard|reviewFlushRef|等待每日复盘/);
  assert.match(appSource, /const committed = target === "done" \? await completeTask/);
});

test("recurring items allow scoped schedule edits but never ask for completion or review", () => {
  assert.doesNotMatch(appSource, /saveRecurringOccurrenceReview|canCaptureRecurringResult|selectedRecurring\.outcome|recurringNote|recurring-outcome-picker|记录重复事项/);
  assert.match(appSource, /className=\{`timeline-event recurring-event/);
  assert.match(appSource, /<RecurringScopeConfirmation/);
  assert.match(appSource, /按规则展示，无需勾选/);
  assert.doesNotMatch(appSource, /到期展示，复盘时处理/);
});

test("Escape returns to month only when no floating dialog is open", () => {
  assert.match(appSource, /if \(!visible \|\| todayView !== "timeline"\) return;/);
  assert.match(appSource, /\[todayView, selection, visible\]/);
});

test("task filter and empty states share type icons and concise copy", () => {
  assert.match(appSource, /filter-option-\$\{item\}[^\n]*name=\{taskViewIcon\[item\]\}/);
  assert.match(appSource, /className="ledger-empty"><Icon name=\{taskViewIcon\[view\]\}/);
  assert.match(appSource, /className="inspector-empty"><Icon name=\{taskViewIcon\[view\]\}/);
  assert.match(appSource, /const taskEmptyCopy: Record<TaskView, string>/);
  for (const text of ["暂无待确认草稿", "暂无重复事项", "暂无待处理任务", "暂无已安排任务", "暂无已完成任务", "回收站为空", "无匹配结果", "选择一项查看详情"]) {
    assert.ok(appSource.includes(text), text);
  }
  assert.doesNotMatch(appSource, /taskEmptyCopy\[view\]\.description/);
});

test("whole-task controls keep their result window while historical blocks have independent corrections", () => {
  const details = appSource.slice(appSource.indexOf("function CompletedTaskDetails("), appSource.indexOf("function TaskWorkspace("));
  assert.match(details, /taskResultEditable\(task, now, metadata\)/);
  assert.match(details, /disabled=\{busy \|\| !editable\}/);
  assert.match(details, /task.status === "done" \? task.earliest_start_date && task.due_date && task.earliest_start_date < task.due_date \? "取消整体完成" : "取消完成" : task.earliest_start_date && task.due_date && task.earliest_start_date < task.due_date \? "完成整个任务" : "完成任务"/);
  assert.match(appSource, /disabled=\{!completionAction \|\| Boolean\(quickCompletingBlockId\)/);
  assert.match(appSource, /selectedBlockCompletionAction !== selectedBlockDialog.action/);
  assert.match(appSource, /action === "complete-block" \|\| action === "uncomplete-block"/);
  assert.match(appSource, /resultDate === resultToday\(Date.now\(\)\)/);
  assert.match(appSource, /timelineTaskDialogState\(selectedBlock\)/);
});

test("tasks are independent and new drafts never use association fields", () => {
  assert.doesNotMatch(appSource, /status_locked|\.origin\b|followupSourceId|linked-select/);
  assert.doesNotMatch(tauriSource, /TaskOrigin|TaskFollowup|prepareTaskFollowup|status_locked/);
  assert.doesNotMatch(databaseSource, /ensure_status_editable|origin\.source_task_id = task.id/);
});
