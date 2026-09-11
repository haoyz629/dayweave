import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const tauriSource = readFileSync(new URL("./tauri.ts", import.meta.url), "utf8");
const userInterfaceSource = appSource.replace(
  /function uiErrorMessage\(reason: unknown\) \{[\s\S]*?\n\}\n\nfunction pickerDateLabel/,
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

test("task pages do not expose historical tag controls", () => {
  for (const phrase of ["标签", "TaskTagChips", "tagFilter", "task-tag"]) {
    assert.equal(appSource.includes(phrase), false, `App.tsx still exposes task tag UI: ${phrase}`);
    assert.equal(stylesSource.includes(phrase), false, `styles.css still contains task tag UI: ${phrase}`);
  }
});

test("plan draft time editor stays compact and supports focused manual adjustment", () => {
  for (const phrase of ["调整草案时间", "尚未加入正式日历", "plan-draft-bounds", "plan-draft-availability"]) {
    assert.equal(appSource.includes(phrase), false, `plan draft editor still contains redundant UI: ${phrase}`);
    assert.equal(stylesSource.includes(phrase), false, `plan draft editor still contains redundant styles: ${phrase}`);
  }
  assert.match(appSource, /<BlockEditorTimeRangeRail[^>]*minimumDuration=\{MIN_TASK_BLOCK_MINUTES\}/);
  assert.match(appSource, /手写 1 分钟 · 时间轴与方向键 5 分钟 · 最短 15 分钟/);
  assert.match(appSource, /normalizeClockInput\(/);
  assert.match(appSource, /focusedTimeRangePresentation\(/);
  assert.match(appSource, /type="text" inputMode="numeric"/);
  assert.match(appSource, /className="time-rail-endpoint-cards"/);
  assert.match(appSource, /timeline-floating-layer\$\{planDraftTimeEdit \? " is-time-editor"/);
  assert.match(stylesSource, /\.timeline-floating-layer\.is-time-editor, \.timeline-floating-layer\.is-block-editor \{ position: fixed;/);
  assert.match(stylesSource, /\.time-rail-endpoint-cards \{[^}]*grid-template-columns: 31fr 38fr 31fr/);
  assert.match(appSource, /highlightedEdge === "start" \? "is-active"/);
  assert.match(appSource, /className="time-rail-duration-badge"/);
  assert.match(appSource, /className="time-rail-break"[^>]*><span>\{durationText\}<\/span>/);
  assert.doesNotMatch(appSource, /durationMinutes >= 45/);
  assert.match(appSource, /original_starts_at: startsAt/);
  assert.match(appSource, /className="timeline-time-reset"/);
  assert.match(appSource, /onClick=\{resetPlanDraftTime\}/);
  assert.match(stylesSource, /\.time-rail-scale\.continuous/);
  assert.match(stylesSource, /\.time-rail-track-wrap\.active-start \.time-rail-endpoint-card\.start/);
  assert.match(appSource, /\{ minutes: 120, label: "2 小时" \}/);
  assert.match(appSource, /busy \? "正在保存…" : "保存调整"/);
  assert.doesNotMatch(appSource, /plan-draft-time-summary/);
  assert.doesNotMatch(appSource, /输入开始时间会按原时长同步结束时间/);
});

test("task capsule hover actions do not stay open after a pointer click", () => {
  assert.equal(stylesSource.includes(".task-ledger-row:focus-within .ledger-row-actions"), false);
  assert.match(stylesSource, /\.task-ledger-row:has\(:focus-visible\) \.ledger-row-actions/);
});

test("task capsule selection is visually distinct in light and dark modes", () => {
  assert.match(stylesSource, /\.ledger-row\.task-capsule-row \{[\s\S]*?background: #fff;/);
  assert.match(stylesSource, /\.ledger-row\.task-capsule-row:not\(\.selected\):hover/);
  assert.match(stylesSource, /\.ledger-row\.task-capsule-row\.selected \{[\s\S]*?border-color: #536dff;[\s\S]*?background: #e8edff;/);
  assert.match(stylesSource, /html\[data-mode="dark"\] \.next-workspace \.ledger-row\.task-capsule-row\.selected/);
});

test("task inspector expands into a wide desktop workspace", () => {
  assert.match(stylesSource, /\.task-form, \.deleted-inspector \{ width: min\(100%, 1280px\); max-width: none; margin-inline: auto;/);
  assert.match(stylesSource, /@container inspector \(min-width: 960px\) \{[\s\S]*?\.create-task-form \{ display: grid; grid-template-columns: minmax\(0, 5fr\) minmax\(0, 6fr\);/);
  assert.match(stylesSource, /\.create-task-form > \.task-content-region \{ grid-column: 1; \}/);
  assert.match(stylesSource, /\.create-task-form > \.task-planning-section \{ grid-column: 2; \}/);
});

test("ordinary tasks use one recycle-bin path instead of a cancellation state", () => {
  assert.doesNotMatch(tauriSource, /export type TaskStatus = .*"cancelled"/);
  assert.doesNotMatch(appSource, /type TaskView = .*"cancelled"/);
  assert.equal(appSource.includes("不再进行"), false);
  assert.equal(appSource.includes("task-more-actions"), false);
  assert.match(appSource, /\{ label: "历史", items: \["done", "deleted"\] \}/);
  assert.match(appSource, /className="text-danger" disabled=\{busy\} onClick=\{\(\) => requestTaskChange\(\{ kind: "trash" \}\)\}/);
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

test("recycle-bin capsules open full details with dynamic top-level recovery actions", () => {
  assert.match(appSource, /className="ledger-quick-action icon-only" data-tooltip="恢复"/);
  assert.match(appSource, /className="ledger-quick-action icon-only danger" data-tooltip="永久删除"/);
  assert.match(appSource, /\{recycleRetentionMessage\(deletedAt, nowMs\)\}/);
  assert.match(appSource, /window\.setInterval\(\(\) => setRecycleNow\(Date\.now\(\)\), 60 \* 1000\)/);
  assert.match(appSource, /<RecycleBinBanner deletedAt=\{selectedTask\.deleted_at\} nowMs=\{recycleNow\}/);
  assert.match(appSource, /<RecycleBinBanner deletedAt=\{selectedRecurringItem\.deleted_at\} nowMs=\{recycleNow\}/);
  assert.match(appSource, /<DeletedTaskDetails task=\{selectedTask\} \/>/);
  assert.match(appSource, /<DeletedRecurringItemDetails item=\{selectedRecurringItem\} \/>/);
  assert.match(stylesSource, /\.recycle-bin-banner \{ position: sticky;/);
  assert.match(stylesSource, /\.ledger-quick-action\.icon-only:is\(:hover, :focus-visible\)::after/);
});

test("confirmed plans expose automatic adjustment without a separate mode button", () => {
  assert.doesNotMatch(appSource, />调整计划<\/button>/);
  assert.doesNotMatch(appSource, /onClick=\{onAdjustPlan\}/);
  assert.match(appSource, /sourceBlockId: selectedBlock\.id/);
  assert.match(appSource, /if \(!workingPreview\) workingPreview = await onAdjustPlan\(\)/);
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
  assert.match(appSource, /setSelection\(\{ kind: "block", id: block\.id \}\)/);
  assert.match(appSource, /requestNavigation\(\{ active: "今日", timelineReturnContext: returnContext \}\)/);
  assert.match(stylesSource, /\.timeline-panel-back:focus-visible/);
  assert.match(stylesSource, /\.task-context-return button:focus-visible/);
});

test("newly included tasks are revealed on the timeline", () => {
  assert.match(appSource, /function revealDraftBlock\(blockIndex: number\)/);
  assert.match(appSource, /revealDraftBlock\(blockIndex\)/);
  assert.match(appSource, /scroller\.scrollTo\(\{[\s\S]*?top: nextTop,[\s\S]*?prefers-reduced-motion: reduce/);
});

test("time range handles use a hollow start and solid end", () => {
  assert.match(stylesSource, /\.time-rail-handle \{[^}]*background: #fff;/);
  assert.match(stylesSource, /\.time-rail-handle\.end \{[^}]*background: #315cea;/);
});

test("task workload copy follows same-day and cross-day scheduling semantics", () => {
  assert.match(appSource, /随时间自动调整/);
  assert.match(appSource, /平均每日投入/);
  assert.match(appSource, /总投入 \{formatWorkloadMinutes\(form\.estimated_minutes\)\}/);
  assert.doesNotMatch(appSource, /按时间重算/);
  assert.doesNotMatch(appSource, /使用手动值，不会被时间调整覆盖/);
});

test("timeline notes appear only after an execution result is selected", () => {
  assert.match(appSource, /draft\.result === "completed" \? <button[^>]*className="execution-add-note"/);
  assert.match(appSource, /draft\.result === "partial" \|\| draft\.result === "not_completed"/);
  assert.match(appSource, /disabled=\{savingExecution \|\| !executionDraft\.outcome\}/);
});

test("plan regeneration uses an accessible compact tooltip button", () => {
  assert.match(appSource, /confirmed \? "重新安排未执行任务" : "重新生成日计划草案"/);
  assert.match(appSource, /className="plan-action-tooltip" role="tooltip"/);
  assert.match(stylesSource, /\.plan-regenerate-control:focus-within \.plan-action-tooltip/);
  assert.match(stylesSource, /\.plan-regenerate-button:focus-visible/);
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

test("timeline task blocks use the centered editor without changing checkbox behavior", () => {
  assert.match(appSource, /data-timeline-kind="block"/);
  assert.match(appSource, /target\.closest\("\.timeline-event-check"\)/);
  assert.match(appSource, /event\.stopPropagation\(\); void \(blockCompleted/);
  assert.match(appSource, /openTimelineTask\(selectedBlock\.task_id, selectedBlock\.id\)/);
  assert.match(appSource, /panel\.dataset\.placement = placement/);
  assert.match(appSource, /selectedBlock \? " is-block-editor"/);
  assert.match(appSource, /selectedBlock \? " task-block-editor"/);
  assert.match(stylesSource, /\.timeline-floating-layer\.is-block-editor \.timeline-floating-panel\.task-block-editor/);
  assert.match(stylesSource, /\.timeline-floating-panel \{ position: fixed;/);
  assert.match(stylesSource, /\.timeline-floating-panel, \.timeline-floating-panel\.plan-draft-editor, \.timeline-floating-panel\.task-block-editor \{ top: auto; right: 14px; bottom: 14px;/);
});
