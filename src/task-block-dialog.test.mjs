import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { timelineTaskDialogState, timelineTaskCompletionAction, resultWindowOpen, executionResultForOutcome, taskResultEditable, historicalBlockCompletionLocked, HISTORY_COMPLETION_LOCKED_MESSAGE } from "./task-result.ts";
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

export function createDialogHarness({ status = "executing", expired = false, deleted = false, busy = false, crossDay = false } = {}) {
  const today = "2026-10-20", date = expired ? "2026-10-18" : today;
  const now = Date.parse(`${today}T12:00:00+08:00`);
  const outcome = status === "completed" ? "completed" : status === "not_completed" ? "not_started" : "planned";
  const taskStatus = deleted ? "deleted" : status === "completed" ? "done" : "scheduled";
  const block = { id: "block", task_id: "task", task_title: "1020", task_status: taskStatus, starts_at: `${date}T09:00:00+08:00`, ends_at: `${date}T10:00:00+08:00`, execution_status: outcome, execution_note: null, execution_captured_at: outcome === "planned" ? null : `${date}T10:00:00+08:00`, actual_minutes: null, review: null };
  const task = { id: "task", title: "1020", priority: "medium", tags: ["工作"], status: taskStatus, result_date: status === "completed" ? date : null, result_ends_at: block.ends_at };
  task.earliest_start_date = date;
  task.due_date = crossDay ? "2026-10-22" : date;
  const calls = [];
  const state = {
    React, selectedBlock: block, selectedTask: task, taskResultEditable, historicalBlockCompletionLocked, HISTORY_COMPLETION_LOCKED_MESSAGE, clock: { getTime: () => now },
    selectedTaskIsCrossDay: crossDay,
    selectedBlockDialog: timelineTaskDialogState(block),
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
  for (const [status, label, reopen, create] of [["completed", "当天已完成", true, false], ["not_completed", "未完成", false, true], ["executing", "执行中", false, false]]) {
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

test("historical completed results cannot be cancelled or changed to incomplete", () => {
  const completed = createDialogHarness({ status: "completed", expired: true });
  completed.state.selectedBlock.execution_note = "创建历史任务自动完成";
  assert.equal(button(completed, "execution-reopen-task").props.disabled, true);
  assert.equal(button(completed, "execution-reopen-task").props.title, HISTORY_COMPLETION_LOCKED_MESSAGE);
  assert.equal(button(completed, "primary-action"), undefined);
  assert.equal(completed.elements().some(node => node.props["data-outcome"]), false);
  assert.match(completed.markup(), /创建历史任务自动完成/);
  assert.doesNotMatch(completed.markup(), /实际耗时|实际分钟/);
  completed.state.selectedBlock.review = { outcome: "completed", notes: "独立复盘备注", actual_minutes: null, remaining_workload_minutes: null };
  assert.match(completed.markup(), /创建历史任务自动完成/);
  assert.match(completed.markup(), /独立复盘备注/);
  assert.doesNotMatch(completed.markup(), /实际耗时|实际分钟/);
  const unfinished = createDialogHarness({ status: "not_completed", expired: true });
  assert.equal(button(unfinished, "execution-new-task").props.disabled, false);
  assert.ok(button(unfinished, "primary-action"));
  assert.equal(createDialogHarness({ deleted: true }).elements().some(node => node.props.className?.includes("execution-new-task")), false);
});

test("daily dialog ignores global done status when determining this block state", () => {
  for (const task_status of ["scheduled", "done"]) {
    assert.equal(timelineTaskDialogState({ task_status, execution_status:"completed", review:null }).action,"uncomplete-block");
    assert.equal(timelineTaskDialogState({ task_status, execution_status:"planned", review:null }).status,"executing");
    assert.equal(timelineTaskDialogState({ task_status, execution_status:"not_started", review:null }).status,"not_completed");
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
    assert.equal(timelineTaskDialogState({ task_status: "done", execution_status: outcome, review: null }).action, "new-task");
  }
  assert.equal(timelineTaskDialogState({ task_status: "scheduled", execution_status: "completed", review: null }).action, "uncomplete-block", "cancellation applies only to this block even while the task remains scheduled");
});

test("current planned blocks expose direct removal and protected records do not", () => {
  for (const crossDay of [false, true]) {
    const current = createDialogHarness({ crossDay });
    button(current, "execution-remove-today").props.onClick();
    assert.deepEqual(current.calls, [["remove", "block"]]);
    for (const options of [{ status: "completed" }, { status: "not_completed" }, { expired: true }, { deleted: true }]) {
      assert.equal(button(createDialogHarness({ ...options, crossDay }), "execution-remove-today"), undefined);
    }
    for (const flags of [{ busy: true }, { loading: true }, { savingExecution: true }, { quickCompletingBlockId: "block" }, { savingDraggedBlock: true }, { timelineDrag: {} }, { preview: {} }]) {
      const current = createDialogHarness({ crossDay });
      Object.assign(current.state, flags);
      assert.equal(Boolean(button(current, "execution-remove-today").props.disabled), true);
    }
  }
});

test("cross-day completion choices stay in the dialog until Save while keeping removal for unexecuted blocks", () => {
  for (const status of ["executing", "completed", "not_completed"]) {
    const current = createDialogHarness({ crossDay: true, status });
    const complete = current.elements().find(node => node.props["data-action"] === "complete-task");
    assert.ok(complete);
    complete.props.onClick();
    assert.deepEqual(current.calls, [], "choosing whole completion must not navigate or persist");
    assert.equal(current.state.executionDraft.wholeTask, true);
    assert.equal(current.elements().find(node => node.props["data-action"] === "complete-task").props["aria-pressed"], true);
    assert.equal(current.elements().find(node => node.props["data-outcome"] === "completed").props["aria-pressed"], true);
    assert.match(renderToStaticMarkup(button(current, "primary-action")), />保存</);
    assert.equal(button(current, "execution-reopen-task"), undefined);
    assert.equal(button(current, "execution-new-task"), undefined);
    assert.equal(Boolean(button(current, "execution-remove-today")), status === "executing");
    button(current, "quiet-button").props.onClick();
    assert.deepEqual(current.calls, [["close"]]);
    current.calls.length = 0;
    button(current, "primary-action").props.onClick();
    assert.equal(current.calls[0][0], "save");
    assert.equal(current.calls[0][1].wholeTask, true);
    current.elements().find(node => node.props["data-outcome"] === "completed").props.onClick();
    assert.equal(current.state.executionDraft.wholeTask, false);
    assert.match(current.markup(), /所有日期完成后，任务自动完成/);
  }
  for (const options of [{ deleted: true, crossDay: true }, { crossDay: false }]) {
    assert.equal(createDialogHarness(options).elements().some(node => node.props["data-action"] === "complete-task"), false);
  }
});

test("a completed day of an active cross-day task still exposes whole-task completion", () => {
  const current = createDialogHarness({ status: "completed", crossDay: true });
  current.state.selectedTask.status = "scheduled";
  current.state.selectedTask.result_date = null;
  current.state.selectedTask.execution_locked = true;
  current.state.selectedBlock.task_status = "scheduled";
  const whole = current.elements().find(node => node.props["data-action"] === "complete-task");
  assert.ok(whole);
  assert.equal(whole.props.disabled, false);
  assert.equal(button(current, "execution-reopen-task"), undefined);
});

test("whole-task completion is the third existing outcome-row button only for cross-day tasks", () => {
  for (const crossDay of [false, true]) {
    const current = createDialogHarness({ crossDay });
    const group = current.elements().find(node => node.props.className === "floating-outcomes");
    assert.equal(group.props.style?.gridTemplateColumns, crossDay ? "repeat(3, minmax(0, 1fr))" : undefined);
    const labels = React.Children.toArray(group.props.children).map(child => child.props.children).flat().filter(child => typeof child === "string");
    assert.deepEqual(labels, crossDay ? ["当天完成", "未完成", "整体完成"] : ["完成", "未完成"]);
    assert.doesNotMatch(current.markup(), /execution-whole-task-action|已完成全部工作/);
  }
});

test("reopened cross-day dialog checks daily and whole completion independently", () => {
  for (const status of ["executing", "completed", "not_completed"]) {
    for (const taskStatus of ["scheduled", "done"]) {
      const current = createDialogHarness({ crossDay: true, status });
      current.state.selectedTask.status = taskStatus;
      current.state.selectedBlock.task_status = taskStatus;
      const choices = () => current.elements().filter(node => node.type === "button" && (node.props["data-outcome"] || node.props["data-action"] === "complete-task"));
      assert.deepEqual(choices().map(node => node.props["aria-pressed"]), [status === "completed", status === "not_completed", taskStatus === "done"]);
      for (const choice of choices()) {
        assert.equal(renderToStaticMarkup(choice).includes("<svg"), choice.props["aria-pressed"], "visible check agrees with the accessible pressed state");
      }
      assert.equal(current.state.executionDraft.wholeTask, undefined, "saved completion must not become a pending whole-task action");
      current.elements().find(node => node.type === "textarea").props.onChange({ target: { value: "仅修改备注" } });
      button(current, "primary-action").props.onClick();
      assert.equal(current.calls[0][1].note, "仅修改备注");
      assert.equal(current.calls[0][1].wholeTask, undefined);
    }
  }
});

test("refreshing a reopened task clears only the whole-task check while this day stays completed", () => {
  const current = createDialogHarness({ crossDay: true, status: "completed" });
  const pressed = () => current.elements().filter(node => node.type === "button" && (node.props["data-outcome"] || node.props["data-action"] === "complete-task")).map(node => node.props["aria-pressed"]);
  assert.deepEqual(pressed(), [true, false, true]);
  current.state.selectedTask.status = "scheduled";
  current.state.selectedTask.result_date = null;
  current.state.selectedBlock.task_status = "scheduled";
  assert.deepEqual(pressed(), [true, false, false]);
  assert.equal(current.state.executionDraft.wholeTask, undefined);
});

test("choosing the checked daily result never promotes saved completion to a whole-task action", () => {
  const current = createDialogHarness({ crossDay: true, status: "completed" });
  current.elements().find(node => node.props["data-outcome"] === "completed").props.onClick();
  assert.equal(current.state.executionDraft.wholeTask, false);
  assert.equal(current.elements().find(node => node.props["data-action"] === "complete-task").props["aria-pressed"], true);
  button(current, "primary-action").props.onClick();
  assert.equal(current.calls[0][1].wholeTask, false);
});

test("dual checked cross-day choices retain busy-state protection", () => {
  for (const flags of [{ busy: true }, { savingExecution: true }, { quickCompletingBlockId: "block" }]) {
    const current = createDialogHarness({ crossDay: true, status: "completed" });
    Object.assign(current.state, flags);
    const choices = current.elements().filter(node => node.type === "button" && (node.props["data-outcome"] || node.props["data-action"] === "complete-task"));
    assert.deepEqual(choices.map(node => node.props["aria-pressed"]), [true, false, true]);
    assert.ok(choices.every(node => node.props.disabled));
  }
});

test("choosing incomplete overrides saved whole completion until the draft is changed or discarded", () => {
  for (const status of ["executing", "completed", "not_completed"]) {
    for (const taskStatus of ["scheduled", "done"]) {
      const current = createDialogHarness({ crossDay: true, status });
      current.state.selectedTask.status = taskStatus;
      current.state.selectedBlock.task_status = taskStatus;
      const choose = outcome => current.elements().find(node => node.props["data-outcome"] === outcome).props.onClick();
      const assertChoices = expected => {
        const choices = current.elements().filter(node => node.type === "button" && (node.props["data-outcome"] || node.props["data-action"] === "complete-task"));
        assert.deepEqual(choices.map(node => node.props["aria-pressed"]), expected);
        assert.deepEqual(choices.map(node => renderToStaticMarkup(node).includes("<svg")), expected);
      };
      const assertIncomplete = () => {
        assertChoices([false, true, false]);
        assert.equal(current.state.executionDraft.wholeTask, false);
        assert.equal(current.state.selectedTask.status, taskStatus, "unsaved choices must not mutate the saved task");
        assert.deepEqual(current.calls, []);
      };
      choose("not_completed");
      assertIncomplete();
      current.elements().find(node => node.type === "textarea").props.onChange({ target: { value: "尚未完成" } });
      assertIncomplete();
      choose("completed");
      assertChoices([true, false, taskStatus === "done"]);
      current.elements().find(node => node.props["data-action"] === "complete-task").props.onClick();
      assertChoices([true, false, true]);
      choose("not_completed");
      assertIncomplete();
      button(current, "primary-action").props.onClick();
      assert.equal(current.calls[0][1].outcome, "not_started");
      assert.equal(current.calls[0][1].wholeTask, false);
    }
  }
});

test("discarding an incomplete draft leaves the saved dual completion unchanged", () => {
  const current = createDialogHarness({ crossDay: true, status: "completed" });
  current.elements().find(node => node.props["data-outcome"] === "not_completed").props.onClick();
  assert.equal(current.elements().find(node => node.props["data-action"] === "complete-task").props["aria-pressed"], false);
  button(current, "quiet-button").props.onClick();
  assert.deepEqual(current.calls, [["close"]]);
  assert.equal(current.state.selectedTask.status, "done");
  assert.equal(current.state.selectedBlock.execution_status, "completed");
  const reopened = createDialogHarness({ crossDay: true, status: "completed" });
  assert.equal(reopened.elements().find(node => node.props["data-outcome"] === "completed").props["aria-pressed"], true);
  assert.equal(reopened.elements().find(node => node.props["data-action"] === "complete-task").props["aria-pressed"], true);
});

test("only editable plan times show the pencil affordance", () => {
  const editable = createDialogHarness();
  assert.match(editable.markup(), /execution-time-edit-icon/);
  for (const options of [{ status: "completed" }, { status: "not_completed" }, { expired: true }, { deleted: true }]) {
    const current = createDialogHarness(options);
    assert.doesNotMatch(current.markup(), /execution-time-edit-icon/);
    assert.equal(button(current, "execution-time-value"), undefined);
  }
});
