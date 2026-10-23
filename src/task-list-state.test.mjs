import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { taskListStatus, taskResultEditable, historicalTaskCompletionLocked, HISTORY_COMPLETION_LOCKED_MESSAGE } from "./task-result.ts";
import { independentTaskDraft } from "./task-followup.ts";
import { splitTaskNotes, taskResourceUrl } from "./task-notes.ts";
import { formatWorkloadMinutes } from "./task-workload.ts";
import { recycleCleanupMessage } from "./recycle-retention.ts";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map(), expressions = new Map();
let capsule, editableCompletionButton;
function collect(node) {
  if (ts.isFunctionDeclaration(node) && ["taskMatchesView", "taskIsEditable", "TaskCapsuleFact", "TaskCapsuleContent", "CompletedTaskDetails", "DeletedTaskDetails", "TaskDetailContent", "TaskDetailResources", "taskDisplayHistory", "TaskStatusHistory", "TaskCompletionDialog"].includes(node.name?.text)) functions.set(node.name.text, node.getText(source));
  if (ts.isVariableDeclaration(node) && ["statusCopy", "taskViewCopy", "taskViewGroups", "taskEmptyCopy", "counts"].includes(node.name.getText(source))) expressions.set(node.name.getText(source), node.initializer.getText(source));
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "TaskCapsuleContent" && node.attributes.properties.some(attr => attr.name?.getText(source) === "statusTone" && attr.initializer?.getText(source) === "{taskListStatus(task)}")) capsule = node.getText(source);
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "button" && node.getText(source).includes('className="task-compact-complete"') && node.getText(source).includes('requestTaskChange({ kind: "transition", status: "done" })')) editableCompletionButton = node.getText(source);
  ts.forEachChild(node, collect);
}
collect(source);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
function harness(tasks = []) {
  const state = {
    React, taskListStatus, taskResultEditable, historicalTaskCompletionLocked, HISTORY_COMPLETION_LOCKED_MESSAGE, tasks, taskDrafts: [], recurringItems: [],
    useMemo: fn => fn(), useState: React.useState, Icon: () => null, TaskTagList: () => null, TaskCapsuleFact: () => null,
    splitTaskNotes, taskResourceUrl, formatWorkloadMinutes, recycleCleanupMessage,
    priorityCopy: { high: "高优先级", medium: "中优先级", low: "低优先级" }, taskTimingFact: () => null, today: "2026-10-20",
    ConfirmationDialog: ({ children, initialFocus, ...props }) => React.createElement("section", props, children)
  };
  const context = vm.createContext(state);
  for (const code of functions.values()) vm.runInContext(compile(code), context);
  for (const [name, expression] of expressions) vm.runInContext(compile(`var ${name} = ${expression};`), context);
  return { state, context };
}
const original = { id: "original", title: "原任务", tags: [], notes: null, priority: "medium", estimated_minutes: 60, earliest_start_date: "2026-10-20", earliest_start_time: "09:00", due_date: "2026-10-20", due_time: "10:00", created_at: "2026-10-20T08:00:00+08:00", deleted_at: null, status: "scheduled", is_incomplete: true, execution_locked: true, result_date: null };

test("unfinished is a separate filter with exclusive counts, not open or scheduled", () => {
  const tasks = [original, { ...original, id: "pending", is_incomplete: false }, { ...original, id: "open", status: "open", is_incomplete: false }, { ...original, id: "done", status: "done" }, { ...original, id: "deleted", status: "deleted" }];
  const { state } = harness(tasks);
  assert.deepEqual(JSON.parse(JSON.stringify(state.counts)), { draft: 0, recurring: 0, open: 1, scheduled: 1, not_completed: 1, done: 1, deleted: 1 });
  for (const task of tasks) {
    const matches = ["open", "scheduled", "not_completed", "done", "deleted"].filter(view => state.taskMatchesView(task, view));
    assert.deepEqual(matches, [taskListStatus(task)]);
    assert.equal(state.taskMatchesView(task, "draft"), false);
    assert.equal(state.taskMatchesView(task, "recurring"), false);
  }
  assert.ok(state.taskViewGroups.some(group => group.items.includes("not_completed")));
  assert.equal(state.taskViewCopy.not_completed, "未完成");
  assert.equal(state.taskEmptyCopy.not_completed, "暂无未完成任务");
});

test("capsule and read-only details share derived labels and status tones", () => {
  for (const [status, is_incomplete, label, tone] of [["scheduled", true, "未完成", "not_completed"], ["scheduled", false, "已安排", "scheduled"], ["open", false, "待处理", "open"], ["done", true, "已完成", "done"]]) {
    const { state, context } = harness();
    state.task = { ...original, status, is_incomplete };
    const row = renderToStaticMarkup(vm.runInContext(compile(`(${capsule});`), context));
    const details = renderToStaticMarkup(state.CompletedTaskDetails({ task: state.task, busy: false, now: Date.parse("2026-10-20T12:00:00+08:00"), onReopen() {}, onTrash() {}, onComplete() {} }));
    assert.match(row, new RegExp(`task-capsule-status status-${tone}[^>]*>${label}`));
    assert.match(details, new RegExp(`terminal-task-status status-${tone}[^>]*>${label}`));
  }
});

test("new independent task keeps its own classification while original remains unfinished", () => {
  const input = independentTaskDraft(original, "2026-10-20");
  assert.equal("is_incomplete" in input, false);
  assert.equal("id" in input, false);
  const created = { ...input, id: "independent", status: "scheduled", is_incomplete: false };
  const { state } = harness([original, created]);
  assert.equal(state.counts.not_completed, 1);
  assert.equal(state.counts.scheduled, 1);
  assert.equal(taskListStatus(original), "not_completed");
  assert.equal(taskListStatus(created), "scheduled");
});

test("unfinished colors have light and dark tokens and cover row, capsule and details", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.equal((css.match(/--task-state-incomplete:/g) ?? []).length, 2);
  for (const selector of [".task-capsule-status.status-not_completed", ".task-compact-status.status-not_completed", ".terminal-task-status.status-not_completed", ".status-row-not_completed .ledger-accent"]) assert.ok(css.includes(selector));
});

const now = Date.parse("2026-10-20T12:00:00+08:00");
const history = [
  { id: "create", occurred_at: "2026-10-20T08:00:00+08:00", plan_date: null, kind: "created", status: "open", note: null, review_note: null },
  { id: "unfinished", occurred_at: "2026-10-20T10:00:00+08:00", plan_date: "2026-10-20", kind: "execution", status: "not_completed", note: "执行备注\n第二行", review_note: "单独复盘备注" },
  { id: "done", occurred_at: "2026-10-20T11:00:00+08:00", plan_date: "2026-10-20", kind: "status", status: "done", note: "完成备注", review_note: null },
  { id: "trash", occurred_at: "2026-10-20T11:30:00+08:00", plan_date: null, kind: "status", status: "deleted", note: null, review_note: null }
];
const callbacks = { onReopen() {}, onTrash() {}, onComplete() {}, onNewTask() {}, onRestore() {}, onPermanentDelete() {}, onEdit() {} };

test("three-state details share resources, actual lifecycle notes and state-specific actions", () => {
  const { state } = harness();
  for (const status of ["scheduled", "done", "deleted"]) {
    const task = { ...original, status, notes: "URL: https://example.com/docs\n\n任务备注\n不可与执行备注混合", result_date: "2026-10-20", result_ends_at: "2026-10-20T10:00:00+08:00", deleted_at: status === "deleted" ? "2026-10-20T11:30:00+08:00" : null };
    const events = status === "deleted" ? history : history.slice(0, status === "done" ? 3 : 2);
    const metadata = { task_id: task.id, tags: [], recurrence: null, history: events, latest_execution: { outcome: status === "scheduled" ? "not_started" : "completed" } };
    const component = status === "deleted" ? state.DeletedTaskDetails : state.CompletedTaskDetails;
    const html = renderToStaticMarkup(component({ task, metadata, busy: false, now, ...callbacks }));
    assert.match(html, /ordinary-task-detail/);
    assert.match(html, /href="https:\/\/example.com\/docs"/);
    assert.match(html, /aria-label="复制任务链接"/);
    assert.match(html, /任务备注\n不可与执行备注混合/);
    assert.match(html, /执行备注\n第二行/);
    assert.match(html, /单独复盘备注/);
    assert.doesNotMatch(html.match(/<header>[\s\S]*?<\/header>/)?.[0] ?? "", /<time|完成时间|移入时间/);
    assert.doesNotMatch(html, /recycle-bin-banner|更新状态|任务 ID/);
    if (status === "deleted") {
      assert.match(html, /恢复任务/); assert.match(html, /永久删除/); assert.match(html, /将于 2026-11-19 自动清理/);
      assert.ok(html.indexOf("task-detail-cleanup") < html.indexOf("永久删除"));
      assert.match(html, /状态更新为回收站/);
      assert.ok(html.indexOf("完成备注") < html.indexOf("状态更新为回收站"));
      assert.doesNotMatch(html, /取消整体完成|>完成整个任务<|>编辑任务<|>新建任务</);
    } else if (status === "done") {
      assert.match(html, /取消完成/); assert.match(html, /完成备注/);
      assert.doesNotMatch(html, /整个任务|整体完成/);
      assert.doesNotMatch(html, />完成整个任务<|恢复任务|永久删除|>编辑任务<|>新建任务</);
    } else {
      assert.match(html, /完成任务/); assert.match(html, /新建任务/);
      assert.doesNotMatch(html, /取消整体完成|恢复任务|永久删除/);
    }
  }
});

test("completed details keep the result window and busy guards", () => {
  const { state } = harness();
  const task = { ...original, status: "done", result_date: "2020-01-01", result_ends_at: "2020-01-01T10:00:00+08:00" };
  const expired = renderToStaticMarkup(state.CompletedTaskDetails({ task, busy: false, now, ...callbacks }));
  assert.match(expired, /disabled="" title="历史日期的已完成记录不可取消完成"/);
  const busy = renderToStaticMarkup(state.DeletedTaskDetails({ task: { ...task, status: "deleted" }, metadata: null, busy: true, now, ...callbacks }));
  assert.equal((busy.match(/disabled=""/g) ?? []).length, 2);
});

test("restored history ends in its restored state, retaining deletion and previous notes", () => {
  const { state } = harness();
  const restored = { ...history.at(-1), id: "restored", kind: "restored", status: "done", occurred_at: "2026-10-20T11:40:00+08:00" };
  const html = renderToStaticMarkup(state.TaskStatusHistory({ task: { ...original, status: "done" }, metadata: { history: [...history, restored] }, busy: false, ...callbacks }));
  assert.ok(html.indexOf("状态更新为回收站") < html.indexOf("恢复为已完成"));
  assert.match(html, /完成备注/); assert.match(html, /执行备注/);
  assert.match(html, /<summary>[\s\S]*?status-done[^>]*>已完成/);
});

test("completion dialog supplies an optional separate note with length and busy guards", () => {
  const { state } = harness();
  const html = renderToStaticMarkup(state.TaskCompletionDialog({ task: original, note: "本次完成备注", busy: false, error: null, onNoteChange() {}, onCancel() {}, onConfirm() {} }));
  assert.match(html, /选填/); assert.match(html, /maxLength="500"/i); assert.match(html, /本次完成备注/); assert.match(html, /确认完成/);
  assert.match(html, /完成任务/);
  assert.match(html, /后续未执行的安排将不再显示，已有执行记录会保留/);
  const busy = renderToStaticMarkup(state.TaskCompletionDialog({ task: original, note: "", busy: true, error: "失败", onNoteChange() {}, onCancel() {}, onConfirm() {} }));
  assert.equal((busy.match(/disabled=""/g) ?? []).length, 3);
  assert.match(busy, /role="alert">失败/);
});

test("history summary uses current task state rather than a historical block outcome", () => {
  const { state } = harness();
  for (const [status, label] of [["done", "已完成"], ["deleted", "回收站"]]) {
    const html = renderToStaticMarkup(state.TaskStatusHistory({ task: { ...original, status }, metadata: { history: history.slice(0, 2) }, busy: false, ...callbacks }));
    assert.match(html.match(/<summary>[\s\S]*?<\/summary>/)?.[0] ?? "", new RegExp(`>${label}<`));
    assert.match(html, /10月20日：当天任务未完成/);
  }
});

test("lifecycle history summary uses its real Shanghai event day, not task creation day", () => {
  const { state } = harness();
  const html = renderToStaticMarkup(state.TaskStatusHistory({ task: { ...original, status: "deleted" }, metadata: { history: [{ ...history.at(-1), occurred_at: "2026-10-22T17:30:00Z" }] }, busy: false, ...callbacks }));
  assert.match(html.match(/<summary>[\s\S]*?<\/summary>/)?.[0] ?? "", />2026-10-23</);
});

test("history events cannot inherit global status background classes", () => {
  const { state } = harness();
  const html = renderToStaticMarkup(state.TaskStatusHistory({ task: { ...original, status: "deleted" }, metadata: { history }, busy: false, ...callbacks }));
  assert.doesNotMatch(html, /<li[^>]*class="[^"]*status-/);
  for (const status of ["open", "not_completed", "done", "deleted"]) assert.match(html, new RegExp(`<li[^>]*data-status="${status}"`));
});

test("same-day event times stay compact while multi-day history retains its dates", () => {
  const { state } = harness();
  const events = [...history, { ...history.at(-1), id: "next-day", occurred_at: "2026-10-21T09:01:02+08:00", plan_date: null }];
  const html = renderToStaticMarkup(state.TaskStatusHistory({ task: { ...original, status: "deleted" }, metadata: { history: events }, busy: false, ...callbacks }));
  assert.match(html, />2026-10-20 11:30:00<\/time>/);
  assert.match(html, />09:01:02<\/time>/);
});

test("detail values and action groups match the approved presentation without changing stored resources", () => {
  const { state } = harness();
  const html = renderToStaticMarkup(state.CompletedTaskDetails({ task: { ...original, execution_locked: false, notes: "URL: https://example.com/docs\n\n任务资料" }, metadata: { history }, now, busy: false, ...callbacks }));
  assert.match(html, /60<span class="task-detail-unit">分钟<\/span>/);
  assert.match(html, /href="https:\/\/example.com\/docs"[^>]*><span>example.com\/docs<\/span>/);
  assert.match(html, /task-detail-primary-actions[\s\S]*完成任务[\s\S]*编辑任务/);
});

test("detail typography, neutral timeline and completion modal are explicitly scoped", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(css, /\.ordinary-task-detail \{[^}]*font: 13px\/1\.6 "Segoe UI", "Microsoft YaHei UI"/);
  assert.match(css, /\.ordinary-task-detail > header h2 \{[^}]*font-size: 29px;[^}]*line-height: 1\.4/);
  assert.match(css, /\.ordinary-task-detail \.task-detail-event \{[^}]*background: transparent/);
  assert.match(css, /\.ordinary-task-detail \.task-detail-event\[data-status="deleted"\]::after/);
  assert.match(css, /\.ordinary-task-detail \.task-detail-actions button\.task-compact-complete \{[^}]*border-color: #cbd9cd/);
  assert.match(css, /\.task-completion-backdrop \.feedback-confirm-symbol \{ display: none;/);
  assert.match(css, /\.task-completion-backdrop \.feedback-confirm \{[^}]*420px/);
  assert.match(css, /html\[data-mode="dark"\] \.task-inspector:has\(\.ordinary-task-detail\)/);
  assert.match(css, /\.task-completion-backdrop \{ padding: 16px;/);
  assert.match(text, /initialFocus="textarea:not\(:disabled\)"/);
});

test("execution history distinguishes dated daily results from whole-task status and preserves notes", () => {
  const { state } = harness();
  for (const [kind, status, label] of [
    ["execution", "done", "10月20日：当天任务已完成"],
    ["execution", "not_completed", "10月20日：当天任务未完成"],
    ["status", "done", "任务已完成"],
    ["reopened", "scheduled", "已取消任务完成"],
    ["cleared_incomplete", "scheduled", "10月20日：已取消当天未完成"]
  ]) {
    const event = { ...history[1], kind, status, plan_date: "2026-10-20" };
    const before = structuredClone(event);
    const html = renderToStaticMarkup(state.TaskStatusHistory({ task: original, metadata: { history: [event] }, busy: false, ...callbacks }));
    assert.ok(html.includes(`<strong>${label}</strong>`));
    assert.match(html, /执行备注\n第二行/);
    assert.match(html, /单独复盘备注/);
    assert.doesNotMatch(html, /执行结果已清除/);
    assert.deepEqual(event, before);
  }
});

test("cleared history has its own neutral tone instead of inheriting task completion", () => {
  const { state } = harness();
  for (const status of ["done", "not_completed", "scheduled", "open", "deleted", null]) {
    const event = { ...history[1], id: "clear", kind: "cleared", status, note: null, review_note: null };
    const html = renderToStaticMarkup(state.TaskStatusHistory({ task: original, metadata: { history: [event] }, busy: false, ...callbacks }));
    assert.match(html, /<li[^>]*data-status="cleared"/);
    assert.match(html, /<strong>10月20日：已取消当天完成<\/strong>/);
  }
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(css, /\.ordinary-task-detail \.task-detail-event\[data-status="cleared"\]::after \{ background: var\(--task-detail-secondary\);/);
  assert.match(css, /\.ordinary-task-detail \.task-detail-event\[data-status="cleared"\] strong \{ color: var\(--task-detail-secondary\);/);
});

test("execution history starts collapsed while keeping its summary and records available", () => {
  const { state } = harness();
  for (const status of ["open", "scheduled", "done", "deleted"]) {
    const task = { ...original, id: `task-${status}`, status };
    const tree = state.TaskStatusHistory({ task, metadata: { history }, busy: false, ...callbacks });
    const detailsElement = tree.props.children.find(child => React.isValidElement(child) && child.type === "details");
    assert.equal(detailsElement.key, task.id, "switching tasks remounts collapsed history");
    const html = renderToStaticMarkup(tree);
    const details = html.match(/<details\b[^>]*class="task-detail-history"[^>]*>/)?.[0];
    assert.ok(details);
    assert.doesNotMatch(details, /\bopen(?:=|\s|>)/);
    assert.match(html, /<summary>[\s\S]*?2026-10-20[\s\S]*?<\/summary>/);
    assert.equal((html.match(/<li\b/g) ?? []).length, history.length);
    assert.match(html, /执行备注\n第二行/);
  }
});

test("recycle cleanup notice uses the red theme color without changing its expiry date", () => {
  const { state } = harness();
  const html = renderToStaticMarkup(state.DeletedTaskDetails({ task: { ...original, status: "deleted", deleted_at: "2026-10-21T09:00:00+08:00" }, metadata: { history }, busy: false, now: Date.parse("2026-10-22T12:00:00+08:00"), ...callbacks }));
  assert.match(html, /class="task-detail-cleanup"[^>]*>[\s\S]*?将于 2026-11-20 自动清理/);
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(css, /\.ordinary-task-detail \.task-detail-cleanup \{[^}]*color: var\(--task-state-deleted\);/);
  assert.equal((css.match(/--task-state-deleted:/g) ?? []).length, 2, "red theme token exists in light and dark modes");
});

test("capsule deadline icons match completed details while other fact icons stay unchanged", () => {
  const { state } = harness();
  state.Icon = ({ name }) => React.createElement("svg", { "data-icon": name });
  const details = renderToStaticMarkup(state.CompletedTaskDetails({ task: { ...original, status: "done" }, metadata: { history }, busy: false, now, ...callbacks }));
  const deadlineIcon = details.match(/data-icon="([^"]+)"[^>]*><\/svg>截止时间/)?.[1];
  assert.equal(deadlineIcon, "clock");
  for (const label of ["截止 今天 10:00", "截止 11月20日"]) {
    const fact = renderToStaticMarkup(state.TaskCapsuleFact({ icon: "calendar", label }));
    assert.match(fact, new RegExp(`data-icon="${deadlineIcon}"`));
    assert.ok(fact.includes(`aria-label="${label}"`));
    assert.ok(fact.includes(`</svg>${label.slice(3)}`));
  }
  for (const [icon, label] of [["calendar", "最早 今天 09:00"], ["restore", "每天"], ["clock", "09:30"]]) {
    const fact = renderToStaticMarkup(state.TaskCapsuleFact({ icon, label }));
    assert.match(fact, new RegExp(`data-icon="${icon}"`));
    assert.ok(fact.includes(`</svg>${label}`));
  }
});

test("automatic task status is explained in its title instead of a user note box", () => {
  const { state } = harness();
  for (const [status, label] of [["done", "任务已完成"], ["scheduled", "已取消任务完成"], ["open", "已取消任务完成"]]) {
    const event = { ...history[2], kind: "automatic_status", status, note: null, review_note: null };
    const html = renderToStaticMarkup(state.TaskStatusHistory({ task: { ...original, status }, metadata: { history: [event] }, busy: false, ...callbacks }));
    assert.ok(html.includes(`<strong>${label}</strong>`));
    assert.doesNotMatch(html, /task-detail-event-note|汇总全部执行块结果/);
    assert.match(html, new RegExp(`data-status="${status}"`));
  }
});

test("real execution notes are not filtered by system wording and matching review notes are not repeated", () => {
  const { state } = harness();
  const event = { ...history[1], note: "汇总全部执行块结果", review_note: "汇总全部执行块结果" };
  const html = renderToStaticMarkup(state.TaskStatusHistory({ task: original, metadata: { history: [event] }, busy: false, ...callbacks }));
  assert.match(html, /class="task-detail-event-note">汇总全部执行块结果<\/p>/);
  assert.equal((html.match(/task-detail-event-note/g) ?? []).length, 1);
});

test("detail completion labels and confirmation titles distinguish multi-day from single-day tasks", () => {
  for (const [dates, label] of [
    [{ earliest_start_date: "2026-10-20", due_date: "2026-10-20" }, "完成任务"],
    [{ earliest_start_date: "2026-10-20", due_date: "2026-10-21" }, "完成整个任务"],
    [{ earliest_start_date: "2026-10-31", due_date: "2026-11-01" }, "完成整个任务"],
    [{ earliest_start_date: null, due_date: null }, "完成任务"]
  ]) {
    const task = { ...original, ...dates };
    const { state, context } = harness();
    const details = renderToStaticMarkup(state.CompletedTaskDetails({ task, busy: false, now, ...callbacks }));
    assert.ok(details.includes(`>${label}</button>`));
    const dialog = renderToStaticMarkup(state.TaskCompletionDialog({ task, note: "", busy: false, error: null, onNoteChange() {}, onCancel() {}, onConfirm() {} }));
    assert.ok(dialog.includes(`id="task-completion-title">${label}</h2>`));
    const calls = [];
    Object.assign(state, { selectedTask: task, selectedMetadata: null, resultNow: now, busy: false, requestTaskChange: action => calls.push(action) });
    const button = vm.runInContext(compile(`(${editableCompletionButton});`), context);
    assert.equal(button.props.title, label);
    assert.ok(renderToStaticMarkup(button).includes(`>${label}</button>`));
    button.props.onClick();
    assert.equal(calls[0].status, "done");
  }
});

test("historical automatic completion keeps the exact explanation visible in execution history", () => {
  const { state } = harness();
  const task = { ...original, status: "done", result_date: "2026-10-19" };
  const event = { ...history[1], plan_date: task.result_date, status: "done", note: "创建历史任务自动完成", review_note: null };
  const html = renderToStaticMarkup(state.CompletedTaskDetails({ task, metadata: { task_id: task.id, history: [event] }, busy: false, now, ...callbacks }));
  assert.match(html, /class="task-detail-event-note">创建历史任务自动完成<\/p>/);
  assert.match(html, /disabled="" title="历史日期的已完成记录不可取消完成"/);
  assert.doesNotMatch(html, /实际耗时|实际分钟/);
});

test("multi-day history retains whole-task status while single-day history never uses it", () => {
  const { state } = harness();
  for (const [kind, status, singleLabel, multiLabel] of [
    ["status", "done", "任务已完成", "整个任务已完成"],
    ["reopened", "scheduled", "已取消任务完成", "已取消整个任务完成"],
    ["automatic_status", "done", "任务已完成", "所有日期均已完成，整个任务已自动完成"],
    ["automatic_status", "scheduled", "已取消任务完成", "已取消整个任务完成"]
  ]) {
    for (const [due_date, label] of [[original.earliest_start_date, singleLabel], ["2026-10-21", multiLabel]]) {
      const task = { ...original, due_date, status };
      const html = renderToStaticMarkup(state.TaskStatusHistory({ task, metadata: { history: [{ ...history[2], kind, status }] }, busy: false, ...callbacks }));
      assert.ok(html.includes(`<strong>${label}</strong>`));
      if (label === singleLabel) assert.doesNotMatch(html, /整个任务|整体完成/);
    }
  }
});

function completionPair(kind = "automatic_status", start = "2026-10-20T10:00:00.100+08:00", end = "2026-10-20T10:00:00.105+08:00") {
  return [
    { ...history[1], id: `execution-${start}`, status: "done", occurred_at: start },
    { ...history[2], id: `completion-${end}`, kind, plan_date: null, occurred_at: end }
  ];
}

test("single-day completion folds its adjacent lifecycle event, retains all distinct notes and never mutates source data", () => {
  const { state } = harness();
  for (const kind of ["automatic_status", "status"]) {
    const events = [history[0], ...completionPair(kind)];
    const before = structuredClone(events);
    for (const event of events) Object.freeze(event);
    Object.freeze(events);
    const displayed = state.taskDisplayHistory(original, events);
    assert.equal(displayed.length, 2);
    assert.deepEqual(Array.from(displayed[1].display_notes), ["执行备注\n第二行", "单独复盘备注", "完成备注"]);
    assert.equal(displayed[1].occurred_at, events[1].occurred_at);
    assert.equal(displayed[1].plan_date, events[1].plan_date);
    const html = renderToStaticMarkup(state.TaskStatusHistory({ task: original, metadata: { history: events }, busy: false, ...callbacks }));
    assert.equal((html.match(/<li\b/g) ?? []).length, 2);
    assert.match(html, /2 条动态/);
    assert.match(html, /<strong>任务已完成<\/strong>/);
    assert.doesNotMatch(html, /当天任务已完成|任务已自动完成/);
    for (const note of displayed[1].display_notes) assert.ok(html.includes(note));
    assert.deepEqual(events, before);
  }
});

test("complete, clear and complete again remain three separate actions even inside one second", () => {
  const { state } = harness();
  const first = completionPair();
  const cleared = { ...history[1], id: "clear", kind: "cleared", status: "done", occurred_at: "2026-10-20T10:00:00.200+08:00", note: null, review_note: null };
  const reopened = { ...history[2], id: "reopen", kind: "automatic_status", status: "scheduled", occurred_at: "2026-10-20T10:00:00.201+08:00", note: null, review_note: null };
  const again = completionPair("automatic_status", "2026-10-20T10:00:00.300+08:00", "2026-10-20T10:00:00.301+08:00");
  const events = [...first, cleared, reopened, ...again];
  const displayed = state.taskDisplayHistory(original, events);
  assert.equal(displayed.length, 3);
  assert.deepEqual(Array.from(displayed, event => event.display_label), ["任务已完成", "已取消任务完成", "任务已完成"]);
  const html = renderToStaticMarkup(state.TaskStatusHistory({ task: original, metadata: { history: events }, busy: false, ...callbacks }));
  assert.match(html, /3 条动态/);
  assert.equal((html.match(/<strong>任务已完成<\/strong>/g) ?? []).length, 2);
  assert.match(html, /data-status="cleared"/);
});

test("history correlation is conservative for multi-day, undated, unrelated, invalid and distant events", () => {
  const { state } = harness();
  const pair = completionPair();
  const cases = [
    [{ ...original, due_date: "2026-10-21" }, pair],
    [{ ...original, earliest_start_date: null, due_date: null }, pair],
    [original, [{ ...pair[0], plan_date: "2026-10-19" }, pair[1]]],
    [original, [{ ...pair[0], status: "not_completed" }, pair[1]]],
    [original, [pair[0], { ...pair[1], kind: "restored" }]],
    [original, [pair[0], { ...pair[1], occurred_at: null }]],
    [original, [pair[0], { ...pair[1], occurred_at: "invalid" }]],
    [original, [pair[0], { ...pair[1], occurred_at: "2026-10-20T10:00:01.100+08:00" }]],
    [original, [pair[0], { ...pair[1], occurred_at: "2026-10-20T10:00:00.099+08:00" }]],
    [original, [pair[0], history[3], pair[1]]]
  ];
  for (const [task, events] of cases) assert.equal(state.taskDisplayHistory(task, events).length, events.length);
  assert.equal(state.taskDisplayHistory(original, [pair[0]]).length, 1);
  const html = renderToStaticMarkup(state.TaskStatusHistory({ task: { ...original, due_date: "2026-10-21" }, metadata: { history: pair }, busy: false, ...callbacks }));
  assert.match(html, /10月20日：当天任务已完成/);
  assert.match(html, /所有日期均已完成，整个任务已自动完成/);
  assert.match(html, /2 条动态/);
});

test("equivalent timestamps with offsets correlate and repeated notes render once", () => {
  const { state } = harness();
  const events = completionPair("status", "2026-10-20T02:00:00.100Z", "2026-10-20T10:00:00.200+08:00");
  events[1].note = events[0].note;
  events[1].review_note = events[0].review_note;
  const displayed = state.taskDisplayHistory(original, events);
  assert.equal(displayed.length, 1);
  assert.equal(displayed[0].display_notes.length, 2);
});
