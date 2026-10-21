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
const names = ["quickCompleteTimelineBlock", "saveSelectedBlockExecution", "CompletedTaskDetails", "reopen", "requestTaskChange", "applyTaskChange", "openIndependentDraft"];
let checkbox, dialogReopen;
function collect(node) {
  if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) handlers.set(node.name.text, node.getText(source));
  if (ts.isVariableDeclaration(node) && ["blockHasFact", "taskCompleted", "quickCompleteText", "quickCompleteLabel"].includes(node.name.getText(source))) renderExpressions.set(node.name.getText(source), node.initializer.getText(source));
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "button") {
    const className = node.openingElement.attributes.properties.find((attr) => attr.name?.getText(source) === "className");
    if (className?.initializer?.getText(source).includes("timeline-event-check")) checkbox = node.getText(source);
    if (className?.initializer?.getText(source) === '"execution-reopen-task secondary-action"') dialogReopen = node.getText(source);
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
    hasUnsavedChanges: false, preferredSelection: { current: null }, preparingIndependent: { current: false },
    taskDrafts: [], effectiveOutcome, taskCompleted: false, blockHasFact: false, blockIsSaving: false,
    selectedBlockDialog: rules.timelineTaskDialogState(block, selectedDate < today),
    selectedBlockCompletionAction: rules.timelineTaskCompletionAction(block, task, selectedDate, today, clock.value),
    completionAction: rules.timelineTaskCompletionAction(block, task, selectedDate, today, clock.value),
    canRecordSelectedBlock: canCaptureTaskResult(selectedDate, today, block, clock.value),
    executionDraft: { outcome: "not_started", result: "not_completed", note: "已更新的备注" },
    Icon: () => null, TaskTagList: () => null, priorityCopy: {},
    statusCopy: { open: "待处理", scheduled: "已安排", not_completed: "未完成", done: "已完成", deleted: "回收站" },
    timelineSelectionTriggerRef: { current: null }, window: { requestAnimationFrame(fn) { fn(); } },
    async reopenManualTask(id, date) { calls.push(["reopen", id, date]); return { ...task, status: "scheduled", remaining_workload_minutes: 60 }; },
    async resolveTaskExecution(date, input) { calls.push(["result", date, input]); },
    async saveExecutionCapture(date, input) { calls.push(["history", date, input]); },
    async clearExecutionCapture(date, blockId) { calls.push(["clear", date, blockId]); },
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
  for (const key of ["quickCompletingBlockId", "busy", "feedback", "view", "selectedId", "pendingTaskChange", "savingExecution", "executionMessage", "selection", "planDraftTimeEdit", "taskDrafts", "search", "tagFilter", "compactTaskEditorDismissed"]) state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const context = vm.createContext(state);
  for (const [name, expression] of renderExpressions) vm.runInContext(compile(`${name} = ${expression};`), context);
  for (const name of names) vm.runInContext(compile(handlers.get(name)), context);
  const button = markup => vm.runInContext(compile(`const button = (${markup}); button;`), vm.createContext({ ...state }));
  return { state, calls, clock, checkbox: () => button(checkbox), dialog: () => button(dialogReopen) };
}

test("historical completion cancels only the block from checkbox and dialog, inside and outside former grace", async () => {
  for (const target of ["checkbox", "dialog"]) for (const now of [`${today}T05:00:00+08:00`, `${today}T12:00:00+08:00`, "2027-01-01T12:00:00+08:00"]) {
    const current = harness({ now });
    const button = current[target]();
    assert.equal(Boolean(button.props.disabled), false);
    button.props.onClick({ stopPropagation() {} });
    await settle();
    assert.deepEqual(JSON.parse(JSON.stringify(current.calls[0])), ["history", previous, { plan_block_id:"block", outcome:"not_started", note:null }]);
    assert.equal(current.calls.some(([type]) => ["reopen","result","clear"].includes(type)),false);
    assert.ok(current.calls.some(([type, title]) => type === "toast" && title === "已取消本次完成"));
    assert.equal(current.state.quickCompletingBlockId, null);
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
    assert.equal(button.props.disabled,reviewed && incomplete);
    assert.equal(button.props["aria-pressed"],outcome !== "planned");
    assert.equal(button.props.title,reviewed && incomplete ? "已有复盘记录，请在弹窗中修改结果" : outcome === "completed" ? "取消本次完成" : incomplete ? "取消本次未完成" : "标记本次完成");
    button.props.onClick({stopPropagation(){}}); await settle();
    if (reviewed && incomplete) { assert.deepEqual(current.calls,[]); continue; }
    if (incomplete) {
      assert.deepEqual(current.calls[0],["clear",previous,"block"]);
      assert.equal(current.calls.some(([type]) => ["history","result","reopen"].includes(type)),false);
      assert.ok(current.calls.some(([type,title]) => type === "toast" && title === "已取消本次未完成"));
    } else {
      assert.equal(current.calls[0][0],"history");
      assert.equal(current.calls[0][1],previous);
      assert.equal(current.calls[0][2].outcome,outcome === "completed"?"not_started":"completed");
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

test("correcting historical done to incomplete preserves its date and note without reopening the task", async () => {
  const current = harness({ block: { ...baseBlock, review: { outcome: "completed", notes: "独立复盘" } } });
  await current.state.saveSelectedBlockExecution();
  const call = current.calls.find(([type]) => type === "history");
  assert.equal(call[1], previous);
  assert.equal(call[2].outcome, "not_started");
  assert.equal(call[2].note, "已更新的备注");
  assert.equal(current.calls.some(([type])=>["reopen","result"].includes(type)),false);
});

test("today keeps whole-task reopen, completion and incomplete-clear behavior", async () => {
  const end=`${today}T23:30:00+08:00`;
  for (const outcome of ["completed","not_started","planned"]) {
    const status=outcome==="completed"?"done":"scheduled";
    const task={...baseTask,status,result_date:today,result_ends_at:end};
    const block={...baseBlock,task_status:status,execution_status:outcome,result_date:today,result_ends_at:end,ends_at:end};
    const current=harness({task,block,selectedDate:today});
    await current.state.quickCompleteTimelineBlock(block);
    assert.equal(current.calls[0][0],outcome==="completed"?"reopen":outcome==="not_started"?"clear":"result");
    assert.equal(current.calls.some(([type])=>type==="history"),false);
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
    assert.equal(current.calls[0][0], "history");
    assert.equal(current.calls.some(([type]) => type === "result"), false);
  }
});

test("task details share the same grace window and keep history read-only afterwards", async () => {
  for (const [now, allowed] of [[`${today}T05:00:00+08:00`,true],[`${today}T05:30:01+08:00`,false]]) {
    const { state, calls, clock } = harness({ now });
    const tree = state.CompletedTaskDetails({ task: baseTask, busy: false, now: clock.value, onReopen: () => state.requestTaskChange({ kind: "reopen" }), onComplete() {}, onTrash() {} });
    const markup = renderToStaticMarkup(tree);
    const footer = React.Children.toArray(tree.props.children).find(child => child.type === "footer");
    const button = React.Children.toArray(footer.props.children)[0];
    assert.equal(!button.props.disabled, allowed);
    if (allowed) { button.props.onClick(); await settle(); assert.deepEqual(calls[0], ["reopen", "task", today]); }
    else assert.match(markup,/已超过结果修改时间/);
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
  const current = harness();
  current.state.saveExecutionCapture = async () => { throw new Error("保存失败"); };
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
    await current.state.quickCompleteTimelineBlock(block);
    const toasts = current.calls.filter(([type]) => type === "toast");
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0][2], "");
    assert.equal(toasts[0][3], "check");
  }
});
