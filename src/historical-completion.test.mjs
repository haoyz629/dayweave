import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { taskResultEditable, taskListStatus, visibleTaskScheduleBlocks, timelineTaskCompletionAction, historicalTaskCompletionLocked, HISTORY_COMPLETION_LOCKED_MESSAGE } from "./task-result.ts";

const source = ts.createSourceFile("App.tsx", readFileSync(new URL("./App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = new Map(), summaries = new Map();
let poolButton, detailCompletionButton, editableCompletionButton;
function collect(node) {
  if (ts.isFunctionDeclaration(node) && ["transition", "reopen", "taskCommitted"].includes(node.name?.text)) handlers.set(node.name.text, node.getText(source));
  if (ts.isVariableDeclaration(node) && ["summaryTaskBlocks", "plannedTaskCount", "completedPlannedTaskCount", "plannedMinutes", "summaryRecurringOccurrences", "recurringItemCount", "completedRecurringItemCount", "summaryArrangementCount", "completedArrangementCount", "summaryProgress"].includes(node.name.getText(source))) summaries.set(node.name.getText(source), node.initializer.getText(source));
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "button") {
    const attribute = node.openingElement.attributes.properties.find(attr => attr.name?.getText(source) === "className");
    if (attribute?.initializer?.getText(source) === '"waiting-pool-add"') poolButton = node.getText(source);
    if (attribute?.initializer?.getText(source).includes('task.status === "done" ? "secondary-action" : "task-compact-complete"')) detailCompletionButton = node.getText(source);
    if (attribute?.initializer?.getText(source) === '"task-compact-complete"' && node.getText(source).includes('requestTaskChange({ kind: "transition", status: "done" })')) editableCompletionButton = node.getText(source);
  }
  ts.forEachChild(node, collect);
}
collect(source);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const task = { id: "historical", title: "历史任务", status: "open", result_date: null, result_ends_at: null, deleted_at: null, execution_locked: true };
const recorded = "2026-11-01T18:00:00+08:00";
const metadata = { task_id: task.id, completion_date: "2026-10-21", completion_ends_at: "2026-10-21T09:30:00+08:00", completion_backfill_allowed: true, completion_recorded_at: null };

test("historical list completion follows backend eligibility without widening legacy result windows", () => {
  const now = Date.parse(recorded);
  assert.equal(taskResultEditable(task, now, metadata), true);
  assert.equal(taskResultEditable(task, now, { ...metadata, completion_backfill_allowed: false }), false);
  const done = { ...task, status: "done", result_date: metadata.completion_date, result_ends_at: metadata.completion_ends_at };
  const completedMetadata = { ...metadata, completion_backfill_allowed: false, completion_recorded_at: recorded };
  for (const offset of [0, 6 * 3600000]) assert.equal(taskResultEditable(done, now + offset, completedMetadata), false, "historical result_date overrides freshly recorded completion");
  for (const offset of [-1, 6 * 3600000 + 1]) assert.equal(taskResultEditable(done, now + offset, completedMetadata), false);
  assert.equal(taskResultEditable({ ...done, updated_at: "2026-11-02T18:00:00+08:00" }, now + 86400000, completedMetadata), false);
  assert.equal(taskResultEditable(done, now, { ...completedMetadata, task_id: "other" }), false);
  assert.equal(taskResultEditable(done, now, { ...completedMetadata, completion_recorded_at: null }), false);
  assert.equal(taskResultEditable({ ...done, deleted_at: recorded }, now, completedMetadata), false);
});

test("historical pool action opens the task list instead of a disabled or duplicate schedule insertion", () => {
  for (const isPastDate of [false, true]) {
    const calls = [];
    const state = { React, task, item: { task_id: task.id, task_title: task.title }, suggestedMinutes: 30, actionLabel: "加入时间线", isPastDate,
      busy: false, includingTaskId: null, Icon: props => props,
      onOpenTasks: id => calls.push(["open", id]), includeWaitingTask: item => calls.push(["include", item.id]) };
    const button = vm.runInNewContext(compile(`(${poolButton})`), state);
    assert.equal(button.props.disabled, false);
    button.props.onClick({ currentTarget: {} });
    assert.deepEqual(calls, [[isPastDate ? "open" : "include", task.id]]);
    assert.equal(button.props.children.props.name, isPastDate ? "external-link" : "plus");
    if (isPastDate) assert.match(button.props.title, /任务列表.*自动补录/);
  }
});

test("real list completion and reopen handlers commit before refreshing and keep metadata current", async () => {
  for (const action of ["transition", "reopen"]) for (const fail of [false, true]) {
    const calls = [];
    const state = { selectedTask: { ...task, status: action === "reopen" ? "done" : "open", result_date: "2026-11-01" }, busy: false, today: "2026-11-01", preferredSelection: { current: null }, taskListStatus,
      uiErrorMessage: String, statusCopy: { scheduled: "已安排" }, taskResultEditable, historicalTaskCompletionLocked, HISTORY_COMPLETION_LOCKED_MESSAGE, selectedMetadata: null,
      Date: class extends Date { static now() { return Date.parse("2026-11-01T12:00:00+08:00"); } },
      async completeTask(id, block, note) { calls.push(["complete", id, block, note]); if (fail) throw Error("写入失败"); return { ...task, status: "done" }; },
      async reopenManualTask(id, date) { calls.push(["reopen", id, date]); if (fail) throw Error("写入失败"); return { ...task, status: "scheduled" }; },
      onTaskCommitted(value) { calls.push(["commit", value.status]); },
      async onReload(loading) { calls.push(["reload", loading]); }, async showCommittedToast() {},
    };
    for (const name of ["Busy", "TaskMetadataRevision", "PendingCompletion", "View", "SelectedId", "Feedback", "CompletionError"]) state[`set${name}`] = value => { calls.push([name, typeof value === "function" ? value(0) : value]); };
    vm.runInNewContext(compile(handlers.get(action) + `\nthis.run = ${action};`), state);
    await (action === "transition" ? state.run("done", " 完成备注 ") : state.run());
    if (fail) {
      assert.equal(calls.some(([name]) => ["commit", "reload", "TaskMetadataRevision"].includes(name)), false);
      if (action === "transition") {
        assert.ok(calls.some(([name, text]) => name === "CompletionError" && /写入失败/.test(text)));
        assert.equal(calls.some(([name]) => name === "Feedback"), false);
      } else {
        assert.ok(calls.some(([name, text]) => name === "Feedback" && /写入失败/.test(text)));
      }
    } else {
      assert.ok(calls.findIndex(([name]) => name === "commit") < calls.findIndex(([name]) => name === "reload"));
      assert.ok(calls.some(([name, value]) => name === "TaskMetadataRevision" && value === 1));
      if (action === "transition") assert.deepEqual(calls.find(([name]) => name === "complete"), ["complete", task.id, null, "完成备注"]);
    }
  }
});

test("committed historical tasks refresh the selected schedule and statistics follow the block fact", () => {
  const calls = [];
  const state = { selectedDate: "2026-10-21", tasks: [task], setTasks(update) { state.tasks = update(state.tasks); }, refreshSchedule(...args) { calls.push(args); } };
  vm.runInNewContext(compile(handlers.get("taskCommitted") + "\nthis.commit = taskCommitted;"), state);
  state.commit({ ...task, status: "done" });
  assert.equal(state.tasks[0].status, "done");
  assert.deepEqual(calls, [["2026-10-21", false]]);
  for (const execution_status of ["completed", "planned"]) {
    const context = vm.createContext({ visibleTaskScheduleBlocks, recurringOccurrences: [], selectedDate: "2026-10-21", today: "2026-11-01", daySchedule: { task_blocks: [{ task_status: execution_status === "completed" ? "done" : "scheduled", execution_status, starts_at: "2026-10-21T09:00:00+08:00", ends_at: "2026-10-21T09:30:00+08:00", review: null }] } });
    for (const [name, expression] of summaries) vm.runInContext(compile(`this.${name} = ${expression};`), context);
    assert.equal(context.plannedTaskCount, 1);
    assert.equal(context.completedPlannedTaskCount, execution_status === "completed" ? 1 : 0);
    assert.equal(context.plannedMinutes, 30);
    assert.equal(context.summaryProgress, execution_status === "completed" ? 100 : 0);
  }
});

test("reopened historical task completion stays enabled in read-only and editing details like the timeline", () => {
  const now = Date.parse("2026-10-28T18:00:00+08:00");
  const task = { id: "reopened-26", title: "123213123213123213123213123213123213123213123213", status: "scheduled",
    earliest_start_date: "2026-10-26", due_date: "2026-10-26", result_date: "2026-10-26", result_ends_at: "2026-10-26T09:30:00+08:00", deleted_at: null };
  const metadata = { task_id: task.id, completion_date: task.result_date, completion_ends_at: task.result_ends_at, completion_backfill_allowed: true };
  const block = { id: "original-block", task_id: task.id, task_status: task.status, result_date: task.result_date, execution_status: "planned", review: null };
  assert.equal(timelineTaskCompletionAction(block, task, task.result_date, "2026-10-28", now), "complete-block");
  for (const editing of [false, true]) for (const busy of [false, true]) {
    const calls = [];
    const state = { React, Icon: () => null, task, busy, editable: taskResultEditable(task, now, metadata),
      selectedTask: task, selectedMetadata: metadata, resultNow: now, taskResultEditable, historicalTaskCompletionLocked, HISTORY_COMPLETION_LOCKED_MESSAGE,
      onComplete: () => calls.push("complete"), requestTaskChange: change => calls.push(change.status) };
    const button = vm.runInNewContext(compile(`(${editing ? editableCompletionButton : detailCompletionButton})`), state);
    assert.equal(button.props.disabled, busy);
    if (!busy) { button.props.onClick(); assert.deepEqual(calls, [editing ? "done" : "complete"]); }
  }
  assert.equal(taskResultEditable({ ...task, status: "done" }, now, metadata), false, "historical completion stays locked");
});
