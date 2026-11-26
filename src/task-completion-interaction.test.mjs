import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as rules from "./task-result.ts";
import { canCaptureTaskResult } from "./review-workflow.ts";
import { independentTaskDraft } from "./task-followup.ts";

// Execute real handlers and JSX, but isolate persistence from user data.
const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = new Map();
const renderExpressions = new Map();
const names = ["executionDraftChanged", "quickCompleteTimelineBlock", "saveSelectedBlockExecution", "CompletedTaskDetails", "reopen", "requestTaskChange", "applyTaskChange", "openIndependentDraft"];
let checkbox;
function collect(node) {
  if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) handlers.set(node.name.text, node.getText(source));
  if (ts.isVariableDeclaration(node) && ["blockHasFact", "taskCompleted", "quickCompleteText", "quickCompleteLabel"].includes(node.name.getText(source))) renderExpressions.set(node.name.getText(source), node.initializer.getText(source));
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "button") {
    const className = node.openingElement.attributes.properties.find((attr) => attr.name?.getText(source) === "className");
    if (className?.initializer?.getText(source).includes("timeline-event-check")) checkbox = node.getText(source);
  }
  ts.forEachChild(node, collect);
}
collect(source);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const today = "2026-10-20", previous = "2026-10-19", end = `${previous}T23:30:00+08:00`;
const baseTask = { id: "task", title: "测试任务", priority: "medium", status: "done", execution_locked: true, remaining_workload_minutes: 0, updated_at: "version", tags: ["工作"], result_date: previous, result_ends_at: end };
const baseBlock = { id: "block", task_id: "task", task_title: "测试任务", task_status: "done", ends_at: end, result_date: previous, result_ends_at: end, execution_status: "completed", execution_note: null, execution_captured_at: end, actual_minutes: null, review: null };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function harness({ task = baseTask, block = baseBlock, selectedDate = previous, now = `${today}T05:00:00+08:00` } = {}) {
  const calls = [], clock = { value: Date.parse(now) };
  const resultDate = block.result_date ?? selectedDate;
  const resultEnd = block.result_ends_at ?? block.ends_at;
  const effectiveOutcome = block.review?.outcome ?? (block.execution_status === "planned" ? null : block.execution_status);
  const state = {
    ...rules, React, today, selectedDate, resultDate, resultEnd, task, tasks: [task], block, selectedBlock: block, selectedTask: task,
    Date: { now: () => clock.value }, clock: { getTime: () => clock.value },
    resultWindowOpen: (date, end, current = clock.value) => rules.resultWindowOpen(date, end, current),
    canCaptureTaskResult,
    independentTaskDraft, shanghaiDateValue: () => rules.resultToday(clock.value),
    quickCompletingBlockId: null, savingExecution: false, busy: false, loading: false,
    savingDraggedBlock: false, timelineDrag: null, preview: null, draftSaving: false, creating: false,
    selectedTaskIsCrossDay: Boolean(task.earliest_start_date && task.due_date && task.earliest_start_date < task.due_date),
    selectedMetadata: null,
    pendingRecycledCompletion: null, recycledCompletionNote: "", recycledCompletionError: null,
    hasUnsavedChanges: false, preferredSelection: { current: null }, preparingIndependent: { current: false },
    taskDrafts: [], effectiveOutcome, taskCompleted: false, blockHasFact: false, blockIsSaving: false,
    selectedBlockDialog: rules.timelineTaskDialogState(block),
    selectedBlockCompletionAction: rules.timelineTaskCompletionAction(block, task, selectedDate, today, clock.value),
    completionAction: rules.timelineTaskCompletionAction(block, task, selectedDate, today, clock.value),
    canRecordSelectedBlock: canCaptureTaskResult(selectedDate, today, block, clock.value),
    executionDraft: { outcome: "not_started", result: "not_completed", note: "已更新的备注" },
    Icon: () => null, TaskTagList: () => null, priorityCopy: {},
    TaskDetailContent: ({ children }) => React.createElement("section", null, React.createElement("footer", null, children)),
    statusCopy: { scheduled: "进行中", not_completed: "未完成", done: "已完成", deleted: "回收站" },
    timelineSelectionTriggerRef: { current: null }, window: { requestAnimationFrame(fn) { fn(); } },
    async reopenManualTask(id, date) { calls.push(["reopen", id, date]); return { ...task, status: "scheduled", remaining_workload_minutes: 60 }; },
    async resolveTaskExecution(date, input) { calls.push(["result", date, input]); },
    async saveExecutionCapture(date, input) { calls.push(["history", date, input]); },
    async clearExecutionCapture(date, blockId) { calls.push(["clear", date, blockId]); },
    async completeTask(...args) { calls.push(["complete-task", ...args]); },
    async latestUndo() { return { id: "undo", target_type: "task_completion", target_id: task.id }; },
    async onFactsChanged() { calls.push(["refresh"]); },
    async onReload() { calls.push(["reload"]); },
    onTaskCommitted(task) { calls.push(["commit", task.status]); },
    uiErrorMessage: String,
    onNotify(...args) { calls.push(["toast", ...args]); },
    async transition() { calls.push(["unexpected-transition"]); },
    async createManualTaskDraft(input) { calls.push(["draft", input]); return { ...input, id: `draft-${calls.filter(([type]) => type === "draft").length}` }; },
    async openPersistedTaskDraft(draft) { calls.push(["open-draft", draft.id]); state.creating = true; },
    async saveNewTaskBeforeLeaving() { return true; },
    clearNewTaskForm() { state.creating = false; }
  };
  for (const key of ["timelineCompletionTask", "timelineCompletionNote", "timelineCompletionError", "quickCompletingBlockId", "pendingRecycledCompletion", "recycledCompletionNote", "recycledCompletionError", "busy", "feedback", "view", "selectedId", "pendingTaskChange", "savingExecution", "executionMessage", "selection", "planDraftTimeEdit", "taskDrafts", "search", "tagFilter", "compactTaskEditorDismissed"]) state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const context = vm.createContext(state);
  for (const [name, expression] of renderExpressions) vm.runInContext(compile(`${name} = ${expression};`), context);
  for (const name of names) vm.runInContext(compile(handlers.get(name)), context);
  const button = markup => vm.runInContext(compile(`const button = (${markup}); button;`), vm.createContext({ ...state }));
  return { state, calls, clock, checkbox: () => button(checkbox) };
}

test("historical completion cannot be cancelled from checkbox or task list, even inside former grace", async () => {
  assert.doesNotMatch(text, /className="execution-reopen-task secondary-action"/);
  for (const now of [`${today}T05:00:00+08:00`, `${today}T12:00:00+08:00`, "2027-01-01T12:00:00+08:00"]) {
    const current = harness({ now });
    const button = current.checkbox();
    assert.equal(Boolean(button.props.disabled), true);
    assert.equal(button.props.title, rules.HISTORY_COMPLETION_LOCKED_MESSAGE);
    button.props.onClick({ stopPropagation() {} });
    await settle();
    await current.state.reopen();
    assert.deepEqual(current.calls, []);
    assert.equal(current.state.feedback, rules.HISTORY_COMPLETION_LOCKED_MESSAGE);
  }
});

test("historical checkbox cancels incomplete facts instead of completing them, regardless of global task state", async () => {
  for (const status of ["scheduled","done"]) for (const outcome of ["planned","not_started","completed","partial","blocked","cancelled"]) for (const reviewed of [false,true]) {
    if (reviewed && outcome === "planned") continue; // A finalized review cannot have an unrecorded outcome.
    const task = { ...baseTask, status };
    const block = { ...baseBlock, task_status:status, execution_status:outcome, review:reviewed?{outcome,notes:"复盘备注"}:null };
    const current = harness({task,block,now:`${today}T12:00:00+08:00`});
    const button = current.checkbox();
    const incomplete = !["planned","completed"].includes(outcome);
    assert.equal(button.props.disabled,outcome === "completed" || (reviewed && incomplete));
    assert.equal(button.props["aria-pressed"],outcome !== "planned");
    assert.equal(button.props.title,outcome === "completed" ? rules.HISTORY_COMPLETION_LOCKED_MESSAGE : reviewed && incomplete ? "已有复盘记录，请在弹窗中修改结果" : incomplete ? "取消本次未完成" : "标记本次完成");
    button.props.onClick({stopPropagation(){}}); await settle();
    if (outcome === "completed" || (reviewed && incomplete)) { assert.deepEqual(current.calls,[]); continue; }
    if (incomplete) {
      assert.deepEqual(current.calls[0],["clear",previous,"block"]);
      assert.equal(current.calls.some(([type]) => ["history","result","reopen"].includes(type)),false);
      assert.ok(current.calls.some(([type,title]) => type === "toast" && title === "已取消本次未完成"));
    } else {
      assert.equal(current.calls[0][1],previous);
      assert.equal(current.calls[0][2].outcome,"completed");
      assert.equal(current.calls[0][2].note,reviewed?"复盘备注":null);
      assert.equal(current.calls.some(([type]) => ["reopen","result","clear"].includes(type)),false);
    }
  }
});

test("a button rendered today submits a block-only correction after Shanghai midnight", async () => {
  const task = {...baseTask,status:"scheduled",result_date:today};
  const block = {...baseBlock,task_status:"scheduled",execution_status:"planned",result_date:today,ends_at:`${today}T23:30:00+08:00`};
  const current = harness({task,block,selectedDate:today,now:`${today}T23:59:59+08:00`});
  const button = current.checkbox();
  current.clock.value = Date.parse("2026-10-21T00:00:01+08:00");
  button.props.onClick({ stopPropagation() {} }); await settle();
  assert.equal(current.calls[0][0],"history");
  assert.equal(current.calls[0][1],today);
  assert.equal(current.calls.some(([type])=>type==="result"),false);
});

test("historical done cannot be saved as incomplete through the result dialog", async () => {
  const current = harness({ block: { ...baseBlock, review: { outcome: "completed", notes: "独立复盘" } } });
  await current.state.saveSelectedBlockExecution();
  assert.deepEqual(current.calls, []);
  assert.equal(current.state.executionMessage, rules.HISTORY_COMPLETION_LOCKED_MESSAGE);
});

test("today completion and cancellation use the daily API and never reopen the whole task", async () => {
  const end=`${today}T23:30:00+08:00`;
  for (const outcome of ["completed","not_started","planned"]) for (const status of ["scheduled","done"]) {
    const task={...baseTask,status,result_date:today,result_ends_at:end};
    const block={...baseBlock,task_status:status,execution_status:outcome,result_date:today,result_ends_at:end,ends_at:end};
    const current=harness({task,block,selectedDate:today});
    await current.state.quickCompleteTimelineBlock(block);
    assert.equal(current.calls[0][0],outcome === "planned" ? "history" : "clear");
    if (outcome === "planned") assert.equal(current.calls[0][2].outcome,"completed");
    assert.equal(current.calls.some(([type])=>["reopen","result"].includes(type)),false);
  }
});

test("single-day checkbox cancellation refreshes the reopened reservation without hiding it", async () => {
  for (const reviewed of [false, true]) {
    const task = { ...baseTask, earliest_start_date: today, due_date: today, result_date: today };
    const block = { ...baseBlock, result_date: today, review: reviewed ? { outcome: "completed", notes: "保留备注" } : null };
    const current = harness({ task, block, selectedDate: today });
    let refreshedTask, refreshedBlock;
    // Model the persisted scheduled/planned pair covered by the database regression.
    current.state.onFactsChanged = async () => {
      current.calls.push(["refresh"]);
      refreshedTask = { ...task, status: "scheduled", remaining_workload_minutes: 30 };
      refreshedBlock = { ...block, task_status: "scheduled", execution_status: "planned", review: null };
    };
    const button = current.checkbox();
    assert.equal(Boolean(button.props.disabled), false);
    assert.equal(button.props["aria-pressed"], true);
    button.props.onClick({ stopPropagation() {} });
    await settle();
    assert.deepEqual(current.calls.slice(0, 2), [["clear", today, "block"], ["refresh"]]);
    assert.deepEqual(rules.visibleTaskScheduleBlocks([refreshedBlock], today, today), [refreshedBlock]);
    assert.equal(rules.taskListStatus(refreshedTask), "scheduled");
    const reopened = harness({ task: refreshedTask, block: refreshedBlock, selectedDate: today });
    assert.equal(reopened.checkbox().props["aria-pressed"], false);
    await reopened.state.quickCompleteTimelineBlock(refreshedBlock);
    assert.equal(reopened.calls[0][0], "history");
    assert.equal(reopened.calls[0][2].outcome, "completed");
  }
});

test("busy, stale and deleted clicks do nothing", async () => {
  for (const update of [{ busy: true }, { savingExecution: true }, { quickCompletingBlockId: "another" }, { tasks: [] }]) {
    const current = harness(); Object.assign(current.state, update);
    await current.state.quickCompleteTimelineBlock(current.state.block);
    assert.deepEqual(current.calls, []);
  }
});

test("historical dialog save always uses the block-only API even for existing records", async () => {
  for (const outcome of ["planned","completed","not_started"]) for (const now of [`${today}T05:00:00+08:00`,`${today}T12:00:00+08:00`,"2027-01-01T12:00:00+08:00"]) {
    const task = { ...baseTask, status: "scheduled" };
    const block = { ...baseBlock, task_status: "scheduled", execution_status:outcome };
    const current = harness({ task, block, now });
    current.state.executionDraft = { outcome: "completed", result: "completed", note: "历史补录" };
    await current.state.saveSelectedBlockExecution();
    if (outcome === "completed") {
      assert.deepEqual(current.calls, []);
      assert.equal(current.state.executionMessage, rules.HISTORY_COMPLETION_LOCKED_MESSAGE);
    } else {
      assert.equal(current.calls[0][0], "history");
      assert.equal(current.calls.some(([type]) => type === "result"), false);
    }
  }
});

test("task details never offer historical cancellation, overriding the former grace window", async () => {
  for (const [now, allowed] of [[`${today}T05:00:00+08:00`,false],[`${today}T05:30:01+08:00`,false]]) {
    const { state, calls, clock } = harness({ now });
    const detail = state.CompletedTaskDetails({ task: baseTask, busy: false, now: clock.value, onReopen: () => state.requestTaskChange({ kind: "reopen" }), onComplete() {}, onTrash() {} });
    const tree = detail.type(detail.props);
    const markup = renderToStaticMarkup(tree);
    const footer = React.Children.toArray(tree.props.children).find(child => child.type === "footer");
    const primaryActions = React.Children.toArray(footer.props.children)[0];
    const button = React.Children.toArray(primaryActions.props.children)[0];
    assert.equal(!button.props.disabled, allowed);
    if (allowed) { button.props.onClick(); await settle(); assert.deepEqual(calls[0], ["reopen", "task", today]); }
    else assert.match(markup,/历史日期的已完成记录不可取消完成/);
  }
});

test("new-task dispatch respects unsaved changes and normal draft creation never mutates old task", async () => {
  const current = harness(); const original = structuredClone(baseTask);
  current.state.hasUnsavedChanges = true;
  await current.state.requestTaskChange({ kind: "new-independent", seed: baseTask });
  assert.equal(current.state.pendingTaskChange.kind, "new-independent");
  assert.deepEqual(current.calls, []);
  current.state.hasUnsavedChanges = false;
  await current.state.requestTaskChange({ kind: "new-independent", seed: baseTask }); await settle();
  const draft = current.calls.find(([type]) => type === "draft")[1];
  assert.equal(draft.notes, null); assert.equal(draft.due_date,"2026-10-21");
  assert.equal("origin" in draft, false); assert.equal("source_task_id" in draft,false);
  assert.deepEqual(baseTask, original);
  await current.state.openIndependentDraft(baseTask);
  assert.equal(current.calls.filter(([type]) => type === "draft").length,2);
  assert.equal(current.state.taskDrafts.length,2);
});

test("double click shares one pending creation and failed creation keeps old task intact", async () => {
  const current=harness(); let release;
  current.state.createManualTaskDraft = input => new Promise(resolve => { release=()=>resolve({...input,id:"draft"}); });
  const pending=current.state.openIndependentDraft(baseTask);
  await current.state.openIndependentDraft(baseTask);
  assert.equal(current.state.preparingIndependent.current,true);
  release();await pending;
  assert.equal(current.calls.filter(([type])=>type==="open-draft").length,1);
  current.state.createManualTaskDraft=async()=>{throw new Error("保存失败");};
  await current.state.openIndependentDraft(baseTask);
  assert.match(current.state.feedback,/保存失败/);
  assert.equal(current.state.preparingIndependent.current,false); assert.equal(current.state.busy,false);
  assert.equal(baseTask.status,"done");
});

test("future, invalid, mismatched and deleted history remain protected on submission", async () => {
  for (const change of [
    {selectedDate:"2026-10-21",block:{...baseBlock,result_date:"2026-10-21"}},
    {selectedDate:"invalid",block:{...baseBlock,result_date:null}},
    {block:{...baseBlock,result_date:"2026-10-18"}},
    {task:{...baseTask,status:"deleted"},block:{...baseBlock,task_status:"deleted"}},
    {task:{...baseTask,deleted_at:"deleted"}}
  ]) {
    const current = harness(change);
    await current.state.quickCompleteTimelineBlock(current.state.block);
    assert.deepEqual(current.calls,[]);
    if (current.state.block.task_status === "deleted" || current.state.selectedDate > today) {
      await current.state.saveSelectedBlockExecution();
      assert.deepEqual(current.calls,[]);
    }
  }
});

test("history save failure leaves block and task facts intact and permits retry", async () => {
  const block = {...baseBlock,result_date:today};
  const current = harness({block,selectedDate:today});
  current.state.clearExecutionCapture = async () => { throw new Error("保存失败"); };
  await current.state.quickCompleteTimelineBlock(current.state.block);
  assert.equal(current.state.block.execution_status,"completed");
  assert.equal(current.state.task.status,"done");
  assert.equal(current.calls.some(([type]) => type === "refresh"), false);
  assert.ok(current.calls.some(([type, label]) => type === "toast" && label === "未取消本次完成"));
  assert.equal(current.state.quickCompletingBlockId, null);
});

test("today checkbox cancels every incomplete outcome rather than submitting completed", async () => {
  for (const outcome of ["not_started","partial","blocked","cancelled"]) {
    const end = `${today}T23:30:00+08:00`;
    const task = {...baseTask,status:"scheduled",result_date:today,result_ends_at:end};
    const block = {...baseBlock,task_status:"scheduled",execution_status:outcome,result_date:today,result_ends_at:end,ends_at:end};
    const current = harness({task,block,selectedDate:today});
    const button = current.checkbox();
    assert.equal(button.props.disabled,false);
    assert.equal(button.props.title,"取消未完成");
    assert.equal(button.props["aria-pressed"],true);
    button.props.onClick({stopPropagation(){}}); await settle();
    assert.deepEqual(current.calls[0],["clear",today,"block"]);
    assert.equal(current.calls.some(([type]) => ["history","result","reopen"].includes(type)),false);
    assert.ok(current.calls.some(([type,title]) => type === "toast" && title === "已取消未完成"));
  }
});

test("incomplete-clear failure never falls back to completing and allows retry", async () => {
  const task = {...baseTask,status:"scheduled"};
  const block = {...baseBlock,task_status:"scheduled",execution_status:"not_started"};
  const current = harness({task,block});
  current.state.clearExecutionCapture = async () => { throw new Error("保存失败"); };
  current.checkbox().props.onClick({stopPropagation(){}}); await settle();
  assert.equal(block.execution_status,"not_started");
  assert.equal(task.status,"scheduled");
  assert.equal(current.calls.some(([type]) => ["history","result","reopen","refresh"].includes(type)),false);
  assert.ok(current.calls.some(([type,title]) => type === "toast" && title === "未取消未完成"));
  assert.equal(current.state.quickCompletingBlockId,null);
  current.state.clearExecutionCapture = async (...args) => { current.calls.push(["clear",...args]); };
  await current.state.quickCompleteTimelineBlock(block);
  assert.ok(current.calls.some(([type]) => type === "clear"));
});

test("incomplete checkbox rendered today still cancels instead of completing after midnight", async () => {
  const end = `${today}T23:30:00+08:00`;
  const task = {...baseTask,status:"scheduled",result_date:today,result_ends_at:end};
  const block = {...baseBlock,task_status:"scheduled",execution_status:"not_started",result_date:today,result_ends_at:end,ends_at:end};
  const current = harness({task,block,selectedDate:today,now:`${today}T23:59:59+08:00`});
  const button = current.checkbox();
  current.clock.value = Date.parse("2026-10-21T00:00:01+08:00");
  button.props.onClick({stopPropagation(){}}); await settle();
  assert.deepEqual(current.calls[0],["clear",today,"block"]);
  assert.equal(current.calls.some(([type]) => ["history","result","reopen"].includes(type)),false);
  assert.ok(current.calls.some(([type,title]) => type === "toast" && title === "已取消本次未完成"));
});

test("quick completion and cancellation show one result sentence without redundant descriptions", async () => {
  for (const selectedDate of [previous, today]) for (const outcome of ["planned", "completed", "not_started"]) {
    const end = `${selectedDate}T23:30:00+08:00`;
    const task = { ...baseTask, status: outcome === "completed" ? "done" : "scheduled", result_date: selectedDate, result_ends_at: end };
    const block = { ...baseBlock, task_status: task.status, execution_status: outcome, result_date: selectedDate, result_ends_at: end, ends_at: end };
    const current = harness({ task, block, selectedDate });
    if (selectedDate === previous && outcome === "completed") {
      await current.state.quickCompleteTimelineBlock(block);
      assert.deepEqual(current.calls, []);
      continue;
    }
    await current.state.quickCompleteTimelineBlock(block);
    const toasts = current.calls.filter(([type]) => type === "toast");
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0][2], "");
    assert.equal(toasts[0][3], "check");
  }
});

test("today checkbox reflects daily result rather than the parent task completion", () => {
  for (const status of ["scheduled", "done"]) for (const outcome of ["planned", "completed", "not_started"]) {
    const end = `${today}T23:30:00+08:00`;
    const task = { ...baseTask, status, result_date: null, result_ends_at: null };
    const block = { ...baseBlock, task_status: status, execution_status: outcome, result_date: today, result_ends_at: end, ends_at: end };
    const current = harness({ task, block, selectedDate: today });
    const button = current.checkbox();
    assert.equal(button.props.disabled, false);
    assert.equal(button.props.className.includes(" done"), outcome === "completed");
    assert.equal(button.props["aria-pressed"], outcome !== "planned");
    assert.equal(button.props.title, outcome === "completed" ? "取消当天完成" : outcome === "not_started" ? "取消未完成" : "完成当天");
  }
});

test("daily result save never offers a stale whole-task undo", async () => {
  const end = `${today}T23:30:00+08:00`;
  const task = { ...baseTask, status: "scheduled", result_date: null };
  const block = { ...baseBlock, task_status: "scheduled", execution_status: "planned", result_date: today, ends_at: end };
  const current = harness({ task, block, selectedDate: today });
  current.state.executionDraft = { outcome: "completed", result: "completed", note: "今天的工作已完成" };
  await current.state.saveSelectedBlockExecution();
  assert.equal(current.calls[0][0], "result");
  const toast = current.calls.find(([type]) => type === "toast");
  assert.equal(toast[1], "当天结果已保存");
  assert.equal(toast[4], undefined);
});

test("daily progress counts completed blocks rather than completed parent tasks", () => {
  let countExpression;
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "completedPlannedTaskCount") countExpression = node.initializer.getText(source);
    ts.forEachChild(node, find);
  }
  find(source);
  assert.ok(countExpression);
  const summaryTaskBlocks = [
    { ...baseBlock, task_status: "scheduled", execution_status: "completed" },
    { ...baseBlock, task_status: "done", execution_status: "not_started" },
    { ...baseBlock, task_status: "scheduled", execution_status: "planned", review: { outcome: "completed" } },
    { ...baseBlock, task_status: "done", execution_status: "completed", review: { outcome: "not_started" } }
  ];
  assert.equal(vm.runInNewContext(countExpression, { summaryTaskBlocks }), 2);
});

test("daily completion toast offers only the newly created block-result undo", async () => {
  for (const entry of ["checkbox", "dialog"]) for (const kind of ["new-daily", "old-daily", "whole-task", "other-task"]) {
    const end = `${today}T23:30:00+08:00`;
    const task = { ...baseTask, status: "scheduled", result_date: null };
    const block = { ...baseBlock, task_status: "scheduled", execution_status: "planned", result_date: today, ends_at: end };
    const current = harness({ task, block, selectedDate: today });
    let reads = 0;
    current.state.latestUndo = async () => {
      reads += 1;
      return {
        id: reads === 1 || kind === "old-daily" ? "previous" : "new-result",
        target_type: kind === "whole-task" ? "task_completion" : "execution_capture",
        target_id: kind === "other-task" ? "another-task" : task.id
      };
    };
    if (entry === "checkbox") await current.state.quickCompleteTimelineBlock(block);
    else {
      current.state.executionDraft = { outcome: "completed", result: "completed", note: "当天备注" };
      await current.state.saveSelectedBlockExecution();
    }
    const toast = current.calls.find(([type]) => type === "toast");
    assert.equal(toast[4], kind === "new-daily" ? "new-result" : undefined, `${entry}/${kind}`);
  }
});

test("cancel completion clears the fact and returns the block dialog to executing", async () => {
  for (const reviewed of [false, true]) {
    const block = { ...baseBlock, result_date: today, review: reviewed ? { outcome: "completed", notes: "独立复盘" } : null };
    const current = harness({ block, selectedDate: today });
    current.state.clearExecutionCapture = async (date, id) => {
      current.calls.push(["clear", date, id]);
      block.execution_status = "planned";
      block.review = null;
    };
    await current.state.quickCompleteTimelineBlock(block);
    assert.equal(rules.timelineTaskDialogState(block).label, "执行中");
    assert.equal(current.calls.some(([type]) => ["history", "result", "reopen"].includes(type)), false);
  }
});

test("whole-task choice saves through the existing dialog without a second confirmation", async () => {
  const task = { ...baseTask, status: "scheduled", result_date: null, execution_locked: true, earliest_start_date: previous, due_date: today };
  const block = { ...baseBlock, task_status: "scheduled", execution_status: "planned" };
  const current = harness({ task, block, now: `${today}T12:00:00+08:00` });
  current.state.executionDraft = { outcome: "completed", result: "completed", wholeTask: true, note: "  全部工作已结束  " };
  await current.state.saveSelectedBlockExecution();
  assert.deepEqual(current.calls[0], ["complete-task", task.id, null, "全部工作已结束"], "whole completion uses the task context, not the expired historical block");
  assert.equal(current.calls.some(([type]) => ["history", "result", "clear"].includes(type)), false);
  assert.ok(current.calls.some(([type, title]) => type === "toast" && title === "整个任务已完成"));
  assert.equal(current.state.selection, null);
  assert.equal(current.state.savingExecution, false);
});

test("whole-task save guards stale and busy state and retains the draft after failure", async () => {
  for (const update of [{ busy: true }, { savingExecution: true }, { loading: true }, { preview: {} }, { quickCompletingBlockId: "block" }, { selectedTask: null }]) {
    const task = { ...baseTask, status: "scheduled", result_date: null, earliest_start_date: previous, due_date: today };
    const current = harness({ task, block: { ...baseBlock, task_status: "scheduled", execution_status: "planned" } });
    current.state.executionDraft.wholeTask = true;
    Object.assign(current.state, update);
    await current.state.saveSelectedBlockExecution();
    assert.deepEqual(current.calls, []);
  }
  const task = { ...baseTask, status: "scheduled", result_date: null, earliest_start_date: previous, due_date: today };
  const current = harness({ task, block: { ...baseBlock, task_status: "scheduled", execution_status: "planned" } });
  current.state.executionDraft.wholeTask = true;
  current.state.selection = { kind: "block", id: "block" };
  current.state.completeTask = async () => { throw new Error("保存失败"); };
  await current.state.saveSelectedBlockExecution();
  assert.equal(current.state.selection.id, "block");
  assert.equal(current.state.executionDraft.wholeTask, true);
  assert.match(current.state.executionMessage, /保存失败/);
  assert.equal(current.state.savingExecution, false);
  assert.equal(current.calls.some(([type]) => type === "refresh"), false);
});

test("single-day task cannot submit the cross-day whole-task choice", async () => {
  const task = { ...baseTask, status: "scheduled", result_date: null, earliest_start_date: today, due_date: today };
  const current = harness({ task });
  current.state.executionDraft.wholeTask = true;
  await current.state.saveSelectedBlockExecution();
  assert.deepEqual(current.calls, []);
});

test("unchecking a completed day of a globally done cross-day task always shows the concise toast", async () => {
  for (const selectedDate of [previous, today]) {
    const task = { ...baseTask, earliest_start_date: previous, due_date: today };
    const block = { ...baseBlock, result_date: selectedDate, ends_at: `${selectedDate}T23:30:00+08:00`, result_ends_at: `${selectedDate}T23:30:00+08:00` };
    const current = harness({ task, block, selectedDate });
    current.checkbox().props.onClick({ stopPropagation() {} });
    await settle();
    if (selectedDate === previous) { assert.deepEqual(current.calls, []); continue; }
    assert.deepEqual(current.calls[0], ["clear", selectedDate, "block"]);
    assert.ok(current.calls.some(([type, title]) => type === "toast" && title === "已取消当天及整体完成"));
    assert.equal(current.calls.some(([type]) => type === "reopen"), false, "backend must handle both state changes atomically");
  }
});

test("completed checkbox and result form rendered before Shanghai midnight cannot cancel after midnight", async () => {
  const task = { ...baseTask, result_date: today };
  const block = { ...baseBlock, result_date: today };
  const current = harness({ task, block, selectedDate: today, now: `${today}T23:59:59+08:00` });
  const button = current.checkbox();
  assert.equal(button.props.disabled, false);
  current.clock.value = Date.parse("2026-10-21T00:00:00+08:00");
  button.props.onClick({ stopPropagation() {} });
  await settle();
  await current.state.saveSelectedBlockExecution();
  await current.state.reopen();
  assert.deepEqual(current.calls, []);
  assert.equal(current.state.executionMessage, rules.HISTORY_COMPLETION_LOCKED_MESSAGE);
  assert.equal(current.state.feedback, rules.HISTORY_COMPLETION_LOCKED_MESSAGE);
});

test("saving an already completed cross-day result never repeats whole-task completion without an explicit choice", async () => {
  const end = `${today}T10:00:00+08:00`;
  const task = { ...baseTask, earliest_start_date: previous, due_date: today, result_date: today, result_ends_at: end };
  const block = { ...baseBlock, result_date: today, result_ends_at: end, ends_at: end };
  for (const wholeTask of [undefined, false]) {
    const current = harness({ task, block, selectedDate: today, now: `${today}T12:00:00+08:00` });
    current.state.executionDraft = { result: "completed", outcome: "completed", note: "  仅修改备注  ", wholeTask };
    await current.state.saveSelectedBlockExecution();
    assert.equal(current.calls[0][0], "result");
    assert.equal(current.calls[0][2].outcome, "completed");
    assert.equal(current.calls[0][2].note, "仅修改备注");
    assert.equal(current.calls.some(([type]) => ["complete-task", "reopen", "clear"].includes(type)), false);
    assert.equal(current.state.savingExecution, false);
  }
});

test("note-only dialog saves never offer undo regardless of daily or whole-task completion", async () => {
  const end = `${today}T10:00:00+08:00`;
  const savedResults = [
    ["completed", null], ["planned", { outcome: "completed" }], ["not_started", { outcome: "completed" }],
    ["not_started", null], ["planned", { outcome: "not_started" }], ["completed", { outcome: "not_started" }]
  ];
  for (const crossDay of [false, true]) for (const status of ["scheduled", "done"]) for (const [execution_status, review] of savedResults) {
    const task = { ...baseTask, status, earliest_start_date: crossDay ? previous : today, due_date: today, result_date: today, result_ends_at: end };
    const block = { ...baseBlock, task_status: status, execution_status, review, result_date: today, result_ends_at: end, ends_at: end };
    const current = harness({ task, block, selectedDate: today, now: `${today}T12:00:00+08:00` });
    const outcome = review?.outcome ?? execution_status;
    current.state.executionDraft = { outcome, result: rules.executionResultForOutcome(outcome), note: "  只改备注  " };
    let reads = 0;
    current.state.latestUndo = async () => ({ id: `undo-${++reads}`, target_type: "execution_capture", target_id: task.id });
    await current.state.saveSelectedBlockExecution();
    assert.equal(current.calls[0][0], "result");
    assert.equal(current.calls[0][2].outcome, outcome);
    assert.equal(current.calls[0][2].note, "只改备注");
    const toast = current.calls.find(([type]) => type === "toast");
    assert.ok(toast, "note-only saves retain the ordinary success confirmation");
    assert.equal(toast[4], undefined, `${crossDay}/${status}/${execution_status}/${review?.outcome}`);
    assert.equal(reads, 0, "unchanged outcomes need not look up an undo to display");
  }
});

test("dialog transitions to completed still offer undo using the effective reviewed result", async () => {
  const end = `${today}T10:00:00+08:00`;
  for (const [execution_status, review] of [["planned", null], ["not_started", null], ["completed", { outcome: "not_started" }]]) {
    const task = { ...baseTask, status: "scheduled", result_date: today, result_ends_at: end };
    const block = { ...baseBlock, task_status: "scheduled", execution_status, review, result_date: today, result_ends_at: end, ends_at: end };
    const current = harness({ task, block, selectedDate: today, now: `${today}T12:00:00+08:00` });
    current.state.executionDraft = { outcome: "completed", result: "completed", note: "完成并更新备注" };
    let reads = 0;
    current.state.latestUndo = async () => ({ id: `undo-${++reads}`, target_type: "execution_capture", target_id: task.id });
    await current.state.saveSelectedBlockExecution();
    assert.equal(current.calls[0][2].outcome, "completed");
    assert.equal(current.calls.find(([type]) => type === "toast")[4], "undo-2");
    assert.equal(reads, 2);
  }
});

test("unchanged ordinary results never write or refresh even if the handler is called directly", async () => {
  for (const saved of ["planned", "completed", "not_started", "partial", "blocked", "cancelled"]) for (const reviewed of [false, true]) {
    if (reviewed && saved === "planned") continue;
    const end = `${today}T10:00:00+08:00`;
    const task = { ...baseTask, status: "scheduled", result_date: today, result_ends_at: end };
    const block = { ...baseBlock, task_status: "scheduled", execution_status: reviewed ? "planned" : saved, review: reviewed ? { outcome: saved, notes: "原备注" } : null, execution_note: "原备注", result_date: today, ends_at: end };
    const current = harness({ task, block, selectedDate: today, now: `${today}T12:00:00+08:00` });
    current.state.executionDraft = { result: saved === "planned" ? null : saved === "completed" ? "completed" : "not_completed", outcome: saved === "planned" ? null : saved === "completed" ? "completed" : "not_started", note: " 原备注 " };
    await current.state.saveSelectedBlockExecution();
    assert.deepEqual(current.calls, [], `${saved}/${reviewed}`);
    assert.equal(current.state.savingExecution, false);
  }
});

test("saving an unchecked completed dialog cancels atomically with its current note", async () => {
  for (const crossDay of [false, true]) for (const reviewed of [false, true]) for (const note of ["", "  保留或修改随手记  "]) {
    const end = `${today}T10:00:00+08:00`;
    const task = { ...baseTask, earliest_start_date: crossDay ? previous : today, due_date: today, result_date: today, result_ends_at: end };
    const block = { ...baseBlock, result_date: today, result_ends_at: end, ends_at: end, review: reviewed ? { outcome: "completed", notes: "原备注" } : null };
    const current = harness({ task, block, selectedDate: today, now: `${today}T12:00:00+08:00` });
    current.state.clearExecutionCapture = async (...args) => current.calls.push(["clear", ...args]);
    current.state.executionDraft = { result: null, outcome: null, wholeTask: false, note };
    await current.state.saveSelectedBlockExecution();
    assert.deepEqual(current.calls[0], ["clear", today, "block", note.trim()]);
    assert.equal(current.calls.filter(([type]) => ["clear", "result", "history", "reopen", "complete-task"].includes(type)).length, 1);
    assert.ok(current.calls.some(([type]) => type === "refresh"));
    assert.equal(current.state.selection, null);
    assert.equal(current.state.savingExecution, false);
    assert.ok(current.calls.some(([type, title]) => type === "toast" && title.includes("已取消当天")));
  }
});

test("saving an unchecked incomplete dialog clears the saved result atomically without falling back to note-only", async () => {
  for (const date of [today, previous]) for (const crossDay of [false, true]) for (const note of ["", "  保留或清空备注  "]) {
    const end = `${date}T10:00:00+08:00`;
    const task = { ...baseTask, status: "scheduled", earliest_start_date: crossDay ? previous : date, due_date: date, result_date: null, result_ends_at: null };
    const block = { ...baseBlock, task_status: "scheduled", execution_status: "not_started", result_date: date, result_ends_at: end, ends_at: end, review: null };
    const current = harness({ task, block, selectedDate: date, now: `${today}T12:00:00+08:00` });
    current.state.clearExecutionCapture = async (...args) => current.calls.push(["clear", ...args]);
    current.state.executionDraft = { result: null, outcome: null, wholeTask: false, note };
    await current.state.saveSelectedBlockExecution();
    assert.deepEqual(current.calls[0], ["clear", date, "block", note.trim()]);
    assert.equal(current.calls.filter(([type]) => type === "history").length, 0);
    assert.ok(current.calls.some(([type]) => type === "refresh"));
    assert.equal(current.state.selection, null);
    assert.equal(current.state.savingExecution, false);
    assert.ok(current.calls.some(([type, title]) => type === "toast" && title === (date < today ? "已取消本次未完成" : "已取消未完成")));
  }
  // A still-planned block with no saved outcome and a changed note stays on the note-only path.
  const planned = harness({
    task: { ...baseTask, status: "scheduled", result_date: null },
    block: { ...baseBlock, task_status: "scheduled", execution_status: "planned", result_date: today, review: null },
    selectedDate: today,
    now: `${today}T12:00:00+08:00`
  });
  planned.state.executionDraft = { result: null, outcome: null, wholeTask: false, note: "  补充随手记  " };
  await planned.state.saveSelectedBlockExecution();
  assert.deepEqual(JSON.parse(JSON.stringify(planned.calls[0])), ["history", today, { plan_block_id: "block", outcome: null, note: "补充随手记" }]);
  assert.ok(planned.calls.some(([type, title]) => type === "toast" && title === "随手记已保存"));
});

test("unchecked completion save respects history and busy guards and keeps failed drafts", async () => {
  for (const flags of [{ busy: true }, { savingExecution: true }, { loading: true }, { preview: {} }, { quickCompletingBlockId: "block" }]) {
    const current = harness({ block: { ...baseBlock, result_date: today }, selectedDate: today });
    current.state.executionDraft = { result: null, outcome: null, wholeTask: false, note: "" };
    Object.assign(current.state, flags);
    await current.state.saveSelectedBlockExecution();
    assert.deepEqual(current.calls, []);
  }
  const historical = harness();
  historical.state.executionDraft = { result: null, outcome: null, wholeTask: false, note: "" };
  await historical.state.saveSelectedBlockExecution();
  assert.deepEqual(historical.calls, []);
  assert.equal(historical.state.executionMessage, rules.HISTORY_COMPLETION_LOCKED_MESSAGE);
  const current = harness({ block: { ...baseBlock, result_date: today }, selectedDate: today });
  current.state.selection = { kind: "block", id: "block" };
  current.state.executionDraft = { result: null, outcome: null, wholeTask: false, note: "待保存备注" };
  current.state.clearExecutionCapture = async () => { throw new Error("取消失败"); };
  await current.state.saveSelectedBlockExecution();
  assert.equal(current.state.selection.id, "block");
  assert.equal(current.state.executionDraft.outcome, null);
  assert.equal(current.state.executionDraft.note, "待保存备注");
  assert.match(current.state.executionMessage, /取消失败/);
  assert.deepEqual(current.calls, []);
});
