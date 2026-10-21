import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { timelineTaskDialogState, timelineTaskCompletionAction, resultWindowOpen, executionResultForOutcome } from "./task-result.ts";
import { canCaptureTaskResult } from "./review-workflow.ts";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = [];
let dialog;
function collect(node) {
  if (ts.isFunctionDeclaration(node) && ["Icon", "ExecutionOutcomePicker", "ExecutionCaptureFields"].includes(node.name?.text)) declarations.push(node.getText(source));
  if (ts.isConditionalExpression(node) && node.condition.getText(source) === "selectedBlock" && node.whenTrue.getText(source).includes('className="execution-dialog-heading"')) dialog = node.whenTrue.getText(source);
  ts.forEachChild(node, collect);
}
collect(source);
assert.ok(dialog, "test renders the production task-block dialog JSX");
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;

export function createDialogHarness({ status = "executing", expired = false, deleted = false, busy = false } = {}) {
  const today = "2026-10-20", date = expired ? "2026-10-18" : today;
  const now = Date.parse(`${today}T12:00:00+08:00`);
  const outcome = status === "completed" ? "completed" : status === "not_completed" ? "not_started" : "planned";
  const taskStatus = deleted ? "deleted" : status === "completed" ? "done" : "scheduled";
  const block = { id: "block", task_id: "task", task_title: "1020", task_status: taskStatus, starts_at: `${date}T09:00:00+08:00`, ends_at: `${date}T10:00:00+08:00`, execution_status: outcome, execution_note: null, execution_captured_at: outcome === "planned" ? null : `${date}T10:00:00+08:00`, actual_minutes: null, review: null };
  const task = { id: "task", title: "1020", priority: "medium", tags: ["工作"], status: taskStatus, result_date: status === "completed" ? date : null, result_ends_at: block.ends_at };
  const calls = [];
  const state = {
    React, selectedBlock: block, selectedTask: task,
    selectedBlockDialog: timelineTaskDialogState(block, date < today),
    selectedBlockCompletionAction: timelineTaskCompletionAction(block, task, date, today, now),
    canRecordSelectedBlock: canCaptureTaskResult(date, today, block, now),
    canAdjustSelectedBlock: outcome === "planned" && !expired && !deleted,
    selectedResultWindowOpen: date === today && resultWindowOpen(date, block.ends_at, now),
    executionDraft: { result: outcome === "planned" ? null : executionResultForOutcome(outcome), outcome: outcome === "planned" ? null : outcome, note: "" },
    executionResultOptions: [["completed", "完成"], ["not_completed", "未完成"]],
    savingExecution: false, quickCompletingBlockId: null, savingDraggedBlock: false, timelineDrag: null, preview: null,
    busy, loading: false, executionMessage: "", selectedDate: date, today,
    reviewOutcomeCopy: { completed: "完成", not_started: "未完成" }, taskNextActionLabels: {},
    timeRangeLabel: (start, end) => `${start.slice(11, 16)} - ${end.slice(11, 16)}`,
    closeTimelinePanel() { calls.push(["close"]); },
    openTimelineTask(...args) { calls.push(["open", ...args]); },
    adjustSelectedBlockTime() { calls.push(["adjust"]); },
    removeSelectedBlock() { calls.push(["remove", block.id]); },
    quickCompleteTimelineBlock(block) { calls.push(["reopen", block.id]); },
    onNewTask(seed) { calls.push(["new", seed]); },
    saveSelectedBlockExecution() { calls.push(["save", { ...state.executionDraft }]); },
    updateExecutionDraft(update) { Object.assign(state.executionDraft, update); }
  };
  const context = vm.createContext(state);
  vm.runInContext(compile(`${declarations.join("\n")}\nfunction renderDialog() { return (${dialog}); }`), context);
  const tree = () => context.renderDialog();
  const elements = node => React.Children.toArray(node).flatMap(child => {
    if (!React.isValidElement(child)) return [];
    if (typeof child.type === "function") return elements(child.type(child.props));
    return [child, ...elements(child.props.children)];
  });
  return { state, calls, tree, elements: () => elements(tree()), markup: () => renderToStaticMarkup(tree()) };
}

const button = (current, className) => current.elements().find(node => node.type === "button" && node.props.className?.split(" ").includes(className));

test("saved states show exactly the requested left-footer action", () => {
  for (const [status, label, reopen, create] of [["completed", "已完成", true, false], ["not_completed", "未完成", false, true], ["executing", "执行中", false, false]]) {
    const current = createDialogHarness({ status });
    assert.match(current.markup(), new RegExp(`execution-status-badge status-${status}[^>]*>${label}`));
    assert.equal(Boolean(button(current, "execution-reopen-task")), reopen);
    assert.equal(Boolean(button(current, "execution-new-task")), create);
    assert.equal(Boolean(button(current, "execution-remove-today")), status === "executing");
    assert.equal(current.elements().filter(node => node.type === "footer").length, 1);
    assert.ok(button(current, "primary-action"));
    assert.doesNotMatch(current.markup(), /从今日计划移除|保存后结束任务/);
  }
});

test("unsaved outcome choices keep the saved-state action and expose an optional note immediately", () => {
  for (const status of ["executing", "completed", "not_completed"]) {
    const current = createDialogHarness({ status });
    assert.equal(current.elements().filter(node => node.type === "textarea").length, 1);
    const before = current.state.selectedBlockDialog;
    const choose = current.elements().find(node => node.props["data-outcome"] === "not_completed");
    choose.props.onClick();
    assert.equal(current.state.executionDraft.result, "not_completed");
    assert.deepEqual(current.state.selectedBlockDialog, before);
    button(current, "primary-action").props.onClick();
    assert.equal(current.calls[0][0], "save");
    assert.equal(current.calls[0][1].outcome, "not_started");
  }
});

test("footer buttons retain reopen and independent new-task behavior", () => {
  const completed = createDialogHarness({ status: "completed" });
  button(completed, "execution-reopen-task").props.onClick();
  assert.deepEqual(completed.calls, [["reopen", "block"]]);
  const unfinished = createDialogHarness({ status: "not_completed" });
  button(unfinished, "execution-new-task").props.onClick();
  const seed = unfinished.calls[0][1];
  assert.deepEqual(JSON.parse(JSON.stringify(seed)), { title: "1020", priority: "medium", tags: ["工作"] });
  seed.tags.push("独立标签");
  assert.deepEqual(unfinished.state.selectedTask.tags, ["工作"]);
  assert.equal(unfinished.state.selectedTask.status, "scheduled");
});

test("historical results stay editable and cancel only that blocks completion", () => {
  const completed = createDialogHarness({ status: "completed", expired: true });
  assert.equal(button(completed, "execution-reopen-task").props.disabled, false);
  assert.match(button(completed, "execution-reopen-task").props.title, /仅取消当天任务块/);
  assert.ok(button(completed, "primary-action"));
  assert.match(completed.markup(), /保存历史结果|不改变其他日期的任务块/);
  const unfinished = createDialogHarness({ status: "not_completed", expired: true });
  assert.equal(button(unfinished, "execution-new-task").props.disabled, false);
  assert.ok(button(unfinished, "primary-action"));
  assert.equal(createDialogHarness({ deleted: true }).elements().some(node => node.props.className?.includes("execution-new-task")), false);
});

test("historical dialog ignores global done status when determining this block state", () => {
  for (const task_status of ["scheduled", "done"]) {
    assert.equal(timelineTaskDialogState({ task_status, execution_status:"completed", review:null },true).action,"uncomplete-block");
    assert.equal(timelineTaskDialogState({ task_status, execution_status:"planned", review:null },true).status,"executing");
    assert.equal(timelineTaskDialogState({ task_status, execution_status:"not_started", review:null },true).status,"not_completed");
  }
});

test("saving and reopening block conflicting dialog actions", () => {
  for (const state of [{ savingExecution: true }, { quickCompletingBlockId: "block" }, { busy: true }]) {
    for (const status of ["completed", "not_completed"]) {
      const current = createDialogHarness({ status });
      Object.assign(current.state, state);
      for (const className of ["execution-reopen-task", "execution-new-task", "primary-action"]) {
        const target = button(current, className);
        if (target) assert.equal(Boolean(target.props.disabled), true);
      }
    }
  }
});

test("plan-time adjustment, task navigation and cancel remain wired", () => {
  const current = createDialogHarness();
  button(current, "execution-time-value").props.onClick();
  button(current, "execution-open-task").props.onClick();
  button(current, "quiet-button").props.onClick();
  assert.deepEqual(current.calls, [["adjust"], ["open", "task", "block"], ["close"]]);
  assert.equal(button(current, "primary-action").props.disabled, true);
});

test("dialog state handles legacy incomplete facts without conflicting actions", () => {
  for (const outcome of ["partial", "blocked", "cancelled", "not_started"]) {
    assert.equal(timelineTaskDialogState({ task_status: "scheduled", execution_status: "planned", review: { outcome } }).action, "new-task");
    assert.equal(timelineTaskDialogState({ task_status: "done", execution_status: outcome, review: null }).action, "reopen");
  }
  assert.equal(timelineTaskDialogState({ task_status: "scheduled", execution_status: "completed", review: null }).action, null, "historical completion must not complete the current task via a reopen button");
});

test("current planned blocks expose direct removal and protected records do not", () => {
  const current = createDialogHarness();
  button(current, "execution-remove-today").props.onClick();
  assert.deepEqual(current.calls, [["remove", "block"]]);
  for (const options of [{ status: "completed" }, { status: "not_completed" }, { expired: true }, { deleted: true }]) {
    assert.equal(button(createDialogHarness(options), "execution-remove-today"), undefined);
  }
  for (const flags of [{ busy: true }, { loading: true }, { savingExecution: true }, { quickCompletingBlockId: "block" }, { savingDraggedBlock: true }, { timelineDrag: {} }, { preview: {} }]) {
    const current = createDialogHarness();
    Object.assign(current.state, flags);
    assert.equal(Boolean(button(current, "execution-remove-today").props.disabled), true);
  }
});
