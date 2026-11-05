import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { syncFormCommonFields } from "./create-type-switch.ts";
import { taskListStatus, historicalTaskCreationError, historicalTaskCompletionLocked, isHistoricalResultDate, resultToday, HISTORICAL_TASK_CREATION_NOTE } from "./task-result.ts";
import { recurringTimeBlockIssue } from "./recurring-schedule.ts";

// Exercise the real editor handlers; persistence is isolated from user data.
const source = ts.createSourceFile("App.tsx", readFileSync(new URL("./App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = new Set(["applyCreateItemType", "updateNewTaskFields", "updateNewTaskSchedule", "currentCreationInput", "persistCurrentTaskDraft", "saveNewTaskBeforeLeaving", "cancelNewTask", "clearNewTaskForm", "commitNewTask", "openPersistedTaskDraft", "selectPersistedTaskDraft", "recurringFormForDraft", "recurringCapsuleFacts"]);
const snippets = [];
let capsuleExpression, historicalCreationFields, historicalDialogExpression;
const historyExpressions = new Map();
function collect(node) {
  if (ts.isFunctionDeclaration(node) && handlers.has(node.name?.text)) snippets.push(node.getText(source));
  if (ts.isJsxExpression(node) && node.expression?.getText(source).startsWith('!taskDraftsLoading && view === "draft" && visibleTaskDrafts.map')) capsuleExpression = node.expression.getText(source);
  if (ts.isJsxExpression(node) && node.expression?.getText(source).startsWith('creating && pendingHistoricalCreation &&')) historicalDialogExpression = node.expression.getText(source);
  if (ts.isVariableDeclaration(node) && ["newTaskIsHistoricalCreation", "newTaskHistoryError"].includes(node.name.getText(source))) historyExpressions.set(node.name.getText(source), node.initializer.getText(source));
  if (ts.isJsxFragment(node) && node.getText(source).includes("newTaskIsHistoricalCreation &&")) historicalCreationFields = node.getText(source);
  ts.forEachChild(node, collect);
}
collect(source);
const handlerCode = ts.transpileModule(snippets.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function editor({ saved = true } = {}) {
  const defaults = () => ({ title: "", notes: "", tags: [], priority: "high", earliest_start_date: "2026-09-25", earliest_start_time: "10:00", due_date: "2026-09-25", due_time: "11:00" });
  const taskForm = { ...defaults(), title: "团队周会", notes: "准备材料" };
  const recurringDefaults = () => ({ title: "", notes: "", tags: [], frequency: "weekly", weekdays: [1], display_time: "09:00", display_duration_minutes: 60, ends_on: "" });
  const db = new Map();
  let sequence = 0;
  const makeDraft = (input) => ({ ...input, id: `draft-${++sequence}`, version: 1, draft_kind: "create", item_type: input.item_type ?? "task" });
  const first = saved ? makeDraft(taskForm) : null;
  if (first) db.set(first.id, first);
  const state = {
    creating: true, busy: false, draftSaving: false, createItemType: "task", newTaskForm: taskForm,
    recurringForm: recurringDefaults(), persistedNewTaskDraft: first, persistedNewTaskDraftRef: { current: first },
    taskDrafts: [...db.values()], initialCreateItemType: { current: "task" },
    initialNewTaskForm: { current: taskForm }, initialRecurringForm: { current: recurringDefaults() },
    newTaskIsDirty: true, newTaskFieldsAreDirty: true, newTaskEditRevision: { current: 0 },
    newTaskHasCompleteSchedule: true, newTaskHasValidRange: true, newTaskHasValidWorkload: true,
    newTaskDefaultForm: defaults, emptyNewTaskForm: defaults, recurringItemDefaultForm: recurringDefaults,
    today: "2026-09-23", setTimeout, Date: class extends Date { static now() { return Date.parse("2026-09-23T12:00:00+08:00"); } }, syncFormCommonFields, validDraftClock: () => true,
    historicalTaskCreationError, historicalTaskCompletionLocked, isHistoricalResultDate, resultToday, HISTORICAL_TASK_CREATION_NOTE,
    recurringTimeBlockIssue,
    normalizeTaskWorkloadAfterScheduleChange: (_previous, next) => next,
    taskDraftInputForForm: (form) => ({ ...form }), taskFormForPersistedDraft: (draft) => ({ ...defaults(), ...draft }),
    uiErrorMessage: String, preferredSelection: { current: null }, taskListStatus,
    recurringItemInputForForm: (form) => form,
    async createManualTaskDraft(input) { const draft = makeDraft(input); db.set(draft.id, draft); return draft; },
    async saveTaskDraft(id, version, input) {
      assert.equal(db.get(id).version, version);
      const draft = { ...db.get(id), ...input, version: version + 1 }; db.set(id, draft); return draft;
    },
    async discardTaskDraft(draft) { db.delete(draft.id); },
    async refreshTaskDrafts() { state.taskDrafts = [...db.values()]; },
    committed: [],
    async confirmCreationDraft(draft) {
      db.delete(draft.id); state.committed.push(draft);
      return { item_type: draft.item_type, item: { id: "created-1", status: "open" } };
    },
    async onRecurringChanged() {}, onTaskCommitted() {}, async onReload() {}, async showCommittedToast() {}
  };
  state.pendingHistoricalCreation = null;
  for (const key of ["busy", "newTaskError", "newTaskForm", "persistedNewTaskDraft", "taskDrafts", "recurringForm", "newTaskAutosaveArmed", "createItemType", "draftSaving", "feedback", "creating", "successToast", "pendingDiscardNew", "pendingHistoricalCreation", "view", "selectedRecurringId", "selectedId", "draft", "search", "tagFilter"]) {
    state[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  }
  const context = vm.createContext(state);
  vm.runInContext(handlerCode, context);
  function renderCapsules() {
    Object.assign(state, {
      React, taskDraftsLoading: false, view: "draft", visibleTaskDrafts: state.taskDrafts,
      Icon: () => null, taskFormTimingFact: () => null, taskDraftTimingFact: () => null, validDraftClock: () => true,
      TaskCapsuleContent: ({ title, variant, facts = [] }) => React.createElement("span", { "data-capsule": variant ?? "task" }, title, ...facts.map((fact, index) => React.createElement("small", { key: index }, fact.label)))
    });
    const code = ts.transpileModule(`const capsules = (${capsuleExpression});`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
    return renderToStaticMarkup(vm.runInContext(`(() => { ${code} return capsules; })()`, context));
  }
  function renderHistoryFields() {
    Object.assign(state, { React, resultNow: state.Date.now(), availableTags: [], TaskEditorRegions: () => null });
    for (const [name, value] of historyExpressions) vm.runInContext(`this.${name} = ${value};`, context);
    const code = ts.transpileModule(`(${historicalCreationFields})`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
    return renderToStaticMarkup(vm.runInContext(code, context));
  }
  function historicalDialog() {
    Object.assign(state, { React, HISTORICAL_TASK_CREATION_NOTE, ConfirmationDialog: ({ children }) => React.createElement("section", null, children) });
    const code = ts.transpileModule(`(${historicalDialogExpression})`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
    return vm.runInContext(code, context);
  }
  return { state, db, renderCapsules, renderHistoryFields, historicalDialog };
}

async function save(state) { return state.persistCurrentTaskDraft(false, true); }

test("switches and autosaves preserve one capsule and its original draft id", async () => {
  for (const saved of [true, false]) {
    const { state, db } = editor({ saved });
    const first = await save(state);
    for (let turn = 0; turn < 3; turn++) {
      state.applyCreateItemType("recurring");
      assert.equal(state.persistedNewTaskDraft.id, first.id);
      state.recurringForm = { ...state.recurringForm, title: `修改${turn}`, notes: "新备注", weekdays: [2, 4] };
      await save(state);
      assert.equal(db.get(first.id).item_type, "recurring");
      state.applyCreateItemType("task");
      assert.equal(state.newTaskForm.title, `修改${turn}`);
      assert.equal(state.newTaskForm.due_time, "11:00");
      await save(state);
      assert.equal(db.size, 1);
      assert.equal(state.taskDrafts.length, 1);
      assert.equal(state.persistedNewTaskDraft.id, first.id);
      assert.deepEqual(db.get(first.id).recurring_settings.weekdays, [2, 4]);
    }
  }
});

test("type selection waits for a field edit or leaving the capsule before saving", async () => {
  const { state, db } = editor();
  state.newTaskAutosaveArmed = false;
  const id = state.persistedNewTaskDraft.id;
  state.applyCreateItemType("recurring");
  assert.equal(state.newTaskAutosaveArmed, false);
  assert.equal(db.get(id).item_type, "task");
  await state.saveNewTaskBeforeLeaving();
  assert.equal(db.get(id).item_type, "recurring");
  assert.equal(state.newTaskAutosaveArmed, false);
  state.applyCreateItemType("task");
  assert.equal(state.newTaskAutosaveArmed, false);
  state.updateNewTaskFields({ ...state.newTaskForm, title: "真的改了标题" });
  assert.equal(state.newTaskAutosaveArmed, true);
  await save(state);
  assert.equal(state.newTaskAutosaveArmed, false);
  assert.equal(db.get(id).title, "真的改了标题");
});

test("switching a blank new capsule creates no empty draft on departure", async () => {
  const { state, db } = editor({ saved: false });
  state.newTaskForm = state.newTaskDefaultForm();
  state.initialNewTaskForm.current = state.newTaskForm;
  state.newTaskFieldsAreDirty = false;
  state.newTaskAutosaveArmed = false;
  state.applyCreateItemType("recurring");
  assert.equal(await state.saveNewTaskBeforeLeaving(), true);
  assert.equal(db.size, 0);
});

test("recurring capsule facts show deadline, frequency, then plain time", () => {
  const { state } = editor();
  const facts = state.recurringCapsuleFacts({ frequency: "weekly", ends_on: "2026-09-30", display_time: "09:00" }, state.today);
  assert.deepEqual(Array.from(facts, (fact) => fact.icon), ["calendar", "restore", "clock"]);
  assert.match(facts[0].label, /^截止 /);
  assert.equal(facts[1].label, "每周");
  assert.equal(facts[2].label, "09:00");
});

test("multiple recurring drafts save, reopen and edit independently", async () => {
  const { state, db } = editor();
  state.applyCreateItemType("recurring");
  const first = await save(state);
  state.clearNewTaskForm();
  state.creating = true;
  state.newTaskForm = { ...state.newTaskForm, title: "第二份" };
  state.applyCreateItemType("recurring");
  state.recurringForm = { ...state.recurringForm, weekdays: [5] };
  const second = await save(state);
  assert.equal(db.size, 2);
  assert.notEqual(first.id, second.id);
  await state.selectPersistedTaskDraft(first);
  assert.equal(state.createItemType, "recurring");
  assert.equal(state.recurringForm.title, "团队周会");
  assert.deepEqual(state.recurringForm.weekdays, [1]);
  state.recurringForm = { ...state.recurringForm, notes: "只改第一份" };
  await save(state);
  assert.equal(db.get(second.id).title, "第二份");
  assert.deepEqual(db.get(second.id).recurring_settings.weekdays, [5]);
});

test("reopening restores type and both type-specific settings", async () => {
  const { state } = editor();
  state.applyCreateItemType("recurring");
  state.recurringForm = { ...state.recurringForm, display_time: "15:00", weekdays: [3] };
  const saved = await save(state);
  state.clearNewTaskForm();
  await state.openPersistedTaskDraft(saved);
  assert.equal(state.createItemType, "recurring");
  assert.equal(state.recurringForm.display_time, "15:00");
  state.applyCreateItemType("task");
  assert.equal(state.newTaskForm.due_time, "11:00");
});

test("the same saved capsule renders the active type and latest title without adding a row", async () => {
  const { state, renderCapsules } = editor();
  state.applyCreateItemType("recurring");
  state.recurringForm = { ...state.recurringForm, title: "重复编辑中的新标题", ends_on: "2026-09-30" };
  const beforeSave = renderCapsules();
  assert.equal((beforeSave.match(/data-capsule=/g) ?? []).length, 1);
  assert.match(beforeSave, /data-capsule="recurring"/);
  assert.match(beforeSave, /重复编辑中的新标题/);
  assert.match(beforeSave, /截止 (9\/30|9月30日)/);
  await save(state);
  state.applyCreateItemType("task");
  const afterSwitch = renderCapsules();
  assert.equal((afterSwitch.match(/data-capsule=/g) ?? []).length, 1);
  assert.match(afterSwitch, /data-capsule="task"/);
  assert.match(afterSwitch, /重复编辑中的新标题/);
});

test("cleared common fields propagate in both directions", () => {
  const { state } = editor();
  state.applyCreateItemType("recurring");
  state.recurringForm = { ...state.recurringForm, title: "", notes: "", tags: [] };
  state.applyCreateItemType("task");
  assert.equal(state.newTaskForm.title, "");
  assert.equal(state.newTaskForm.notes, "");
});

test("failed saves retain identity and input without creating another capsule", async () => {
  const { state, db } = editor();
  const id = state.persistedNewTaskDraft.id;
  state.applyCreateItemType("recurring");
  const realSave = state.saveTaskDraft;
  state.saveTaskDraft = async () => { throw Error("database busy"); };
  assert.equal(await save(state), null);
  assert.equal(state.createItemType, "recurring");
  assert.equal(state.persistedNewTaskDraft.id, id);
  assert.equal(db.size, 1);
  assert.equal(db.get(id).item_type, "task");
  state.saveTaskDraft = realSave;
  await save(state);
  assert.equal(db.get(id).item_type, "recurring");
});

test("confirm and discard share one lifecycle for either selected type", async () => {
  for (const type of ["task", "recurring"]) {
    for (const confirm of [true, false]) {
      const { state, db } = editor();
      state.applyCreateItemType(type);
      await save(state);
      assert.equal(await (confirm ? state.commitNewTask() : state.cancelNewTask(false)), true);
      assert.equal(db.size, 0);
      assert.equal(state.committed.length, confirm ? 1 : 0);
      if (confirm) assert.equal(state.committed[0].item_type, type);
    }
  }
});

test("type switching waits for pending save and leaves existing-task update drafts unchanged", () => {
  const { state } = editor();
  state.draftSaving = true;
  state.applyCreateItemType("recurring");
  assert.equal(state.createItemType, "task");
  state.draftSaving = false;
  state.persistedNewTaskDraft.target_task_id = "existing-task";
  state.applyCreateItemType("recurring");
  assert.equal(state.createItemType, "task");
});

test("syncFormCommonFields synchronizes title, notes, and tags while preserving exclusive fields", () => {
  const taskForm = {
    title: "团队周会",
    notes: "准备演示材料",
    tags: ["工作", "重点"],
    priority: "high",
    earliest_start_date: "2026-09-25",
    earliest_start_time: "10:00",
    due_date: "2026-09-25",
    due_time: "11:00",
    estimated_minutes: 60
  };

  const defaultRecurring = {
    title: "",
    notes: "",
    tags: [],
    frequency: "weekly",
    interval_value: 2,
    weekdays: [1, 5],
    month_day: 15,
    starts_on: "2026-09-22",
    ends_on: "2026-12-31",
    display_time: "09:00",
    display_duration_minutes: 30
  };

  // Switch Task -> Recurring
  const updatedRecurring = syncFormCommonFields(defaultRecurring, taskForm);
  assert.equal(updatedRecurring.title, "团队周会");
  assert.equal(updatedRecurring.notes, "准备演示材料");
  assert.deepEqual(updatedRecurring.tags, ["工作", "重点"]);
  assert.equal(updatedRecurring.frequency, "weekly");
  assert.equal(updatedRecurring.interval_value, 2);
  assert.deepEqual(updatedRecurring.weekdays, [1, 5]);
  assert.equal(updatedRecurring.display_time, "09:00");
  assert.equal(updatedRecurring.display_duration_minutes, 30);

  // Edit notes in recurring and switch Recurring -> Task
  const editedRecurring = {
    ...updatedRecurring,
    title: "修改后的周会",
    notes: "增加讨论事项"
  };
  const updatedTask = syncFormCommonFields(taskForm, editedRecurring);
  assert.equal(updatedTask.title, "修改后的周会");
  assert.equal(updatedTask.notes, "增加讨论事项");
  assert.deepEqual(updatedTask.tags, ["工作", "重点"]);
  // Task exclusive fields remain intact!
  assert.equal(updatedTask.priority, "high");
  assert.equal(updatedTask.earliest_start_date, "2026-09-25");
  assert.equal(updatedTask.earliest_start_time, "10:00");
  assert.equal(updatedTask.due_date, "2026-09-25");
  assert.equal(updatedTask.due_time, "11:00");
  assert.equal(updatedTask.estimated_minutes, 60);
});

test("independent task drafts keep copied priority and tags without relation fields", async () => {
  const { state } = editor();
  state.createItemType = "task";
  state.initialCreateItemType.current = "task";
  const independent = { ...state.persistedNewTaskDraft, id: "independent-draft", item_type: "task", title: "独立新任务",
    notes: null, priority: "low", tags: ["项目A", "文档"], recurring_settings: null };
  await state.openPersistedTaskDraft(independent);
  assert.equal(state.newTaskForm.priority, "low");
  assert.deepEqual(state.newTaskForm.tags, ["项目A", "文档"]);
  assert.equal(state.newTaskForm.notes, null);
  state.applyCreateItemType("recurring");
  assert.equal(state.createItemType, "recurring");
  const input = state.currentCreationInput();
  assert.equal(input.item_type, "recurring");
  assert.ok(input.recurring_settings);
  assert.equal("origin" in input, false);
  assert.equal("source_task_id" in input, false);
});

test("manual and AI-source historical drafts cannot confirm multi-day or incomplete times but retain the draft", async () => {
  for (const source_type of ["manual", "ai_assistant"]) for (const change of [{ earliest_start_date: "2026-09-21" }, { earliest_start_time: "" }, { due_time: "" }]) {
    const { state, db, renderHistoryFields } = editor();
    state.persistedNewTaskDraft.source_type = source_type;
    state.newTaskForm = { ...state.newTaskForm, earliest_start_date: "2026-09-22", due_date: "2026-09-22", ...change };
    assert.match(renderHistoryFields(), /多日任务|完整且有效/);
    assert.equal(await state.commitNewTask(), false);
    assert.match(state.newTaskError, /多日任务|完整且有效/);
    assert.equal(state.committed.length, 0);
    assert.equal(db.size, 1);
    assert.equal(await state.saveNewTaskBeforeLeaving(), true, "invalid creation remains saveable as a draft");
  }
});

test("historical single-day confirmation explains auto-completion and trusts backend facts without sending actual minutes", async () => {
  for (const source_type of ["manual", "ai_assistant"]) {
    const { state, db, renderHistoryFields, historicalDialog } = editor();
    state.persistedNewTaskDraft.source_type = source_type;
    state.newTaskForm = { ...state.newTaskForm, earliest_start_date: "2026-09-22", due_date: "2026-09-22" };
    assert.match(renderHistoryFields(), /创建历史任务自动完成/);
    assert.match(renderHistoryFields(), /已完成任务及当天任务块/);
    assert.match(renderHistoryFields(), /不填写实际耗时/);
    state.confirmCreationDraft = async draft => {
      state.committed.push(draft);
      assert.equal("actual_minutes" in draft, false);
      assert.equal("execution_note" in draft, false, "the automatic note is a backend fact, not a forged user note");
      return { item_type: "task", item: { id: "historical", status: "done", result_date: "2026-09-22" } };
    };
    let toast;
    state.showCommittedToast = async (...args) => { toast = args; };
    assert.equal(await state.commitNewTask(), false, "first submit requests confirmation, not creation");
    assert.equal(state.committed.length, 0);
    assert.equal(db.size, 1, "the persisted draft remains editable before confirmation");
    const dialog = historicalDialog();
    const markup = renderToStaticMarkup(dialog);
    assert.match(markup, /确认补录历史任务/);
    assert.match(markup, /历史事项补录，不是待办计划/);
    assert.match(markup, /创建后将直接完成任务/);
    assert.match(markup, /生成已完成任务块/);
    assert.match(markup, /创建历史任务自动完成/);
    assert.match(markup, /不能取消完成/);
    const confirmation = dialog.props.children;
    const confirmButton = confirmation.props.children.at(-1).props.children[1];
    assert.equal(confirmButton.props.children, "确认补录并完成");
    assert.equal(confirmation.props.role, "alertdialog");
    assert.equal(confirmation.props["aria-modal"], "true");
    confirmButton.props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.committed.length, 1);
    assert.equal(state.view, "done");
    assert.equal(toast[0], "历史任务已创建并自动完成");
    assert.equal(toast[4], false, "historical completion must not offer cancellation through undo");
  }
});

test("multi-day creation cannot start in history even when its deadline is today or future", async () => {
  for (const due_date of ["2026-09-23", "2026-09-25"]) {
    const { state, renderHistoryFields } = editor();
    state.newTaskForm = { ...state.newTaskForm, earliest_start_date: "2026-09-21", due_date };
    assert.match(renderHistoryFields(), /多日任务的开始日期不能早于今天/);
    assert.doesNotMatch(renderHistoryFields(), /创建历史任务自动完成/);
    assert.equal(await state.commitNewTask(), false);
    assert.equal(state.committed.length, 0);
    assert.equal(state.pendingHistoricalCreation, null);
  }
});

test("confirmation rechecks historical creation after an async draft save crosses Shanghai midnight", async () => {
  const { state } = editor();
  state.newTaskForm = { ...state.newTaskForm, earliest_start_date: "2026-09-23", due_date: "2026-09-25" };
  let now = Date.parse("2026-09-23T23:59:59+08:00");
  state.Date = class extends Date { static now() { return now; } };
  const realSave = state.saveTaskDraft;
  state.saveTaskDraft = async (...args) => {
    const saved = await realSave(...args);
    now = Date.parse("2026-09-24T00:00:00+08:00");
    return saved;
  };
  assert.equal(await state.commitNewTask(), false);
  assert.match(state.newTaskError, /多日任务的开始日期不能早于今天/);
  assert.equal(state.committed.length, 0);
});

test("returning from historical confirmation preserves the draft and requires confirmation again", async () => {
  const { state, db, historicalDialog } = editor();
  state.newTaskForm = { ...state.newTaskForm, earliest_start_date: "2026-09-22", due_date: "2026-09-22" };
  await state.commitNewTask();
  const dialog = historicalDialog();
  const confirmation = dialog.props.children;
  confirmation.props.onCancel();
  assert.equal(state.pendingHistoricalCreation, null);
  assert.equal(state.committed.length, 0);
  assert.equal(db.size, 1);
  assert.equal(state.newTaskForm.title, "团队周会");
  assert.equal(await state.commitNewTask(), false);
  assert.ok(state.pendingHistoricalCreation);
  const priorConsent = state.pendingHistoricalCreation.input;
  state.updateNewTaskFields({ ...state.newTaskForm, title: "改过内容的补录" });
  assert.equal(state.pendingHistoricalCreation, null);
  assert.equal(await state.commitNewTask(priorConsent), false, "old consent cannot create modified historical content");
  assert.equal(state.committed.length, 0);
  assert.equal(state.pendingHistoricalCreation.title, "改过内容的补录");
});

test("a single-day save crossing Shanghai midnight asks for historical confirmation before creation", async () => {
  const { state } = editor();
  state.newTaskForm = { ...state.newTaskForm, earliest_start_date: "2026-09-23", due_date: "2026-09-23" };
  let now = Date.parse("2026-09-23T23:59:59+08:00");
  state.Date = class extends Date { static now() { return now; } };
  const realSave = state.saveTaskDraft;
  state.saveTaskDraft = async (...args) => { const saved = await realSave(...args); now = Date.parse("2026-09-24T00:00:00+08:00"); return saved; };
  assert.equal(await state.commitNewTask(), false);
  assert.equal(state.committed.length, 0);
  assert.ok(state.pendingHistoricalCreation);
  assert.equal(await state.commitNewTask(state.pendingHistoricalCreation.input), true);
  assert.equal(state.committed.length, 1);
});

test("historical confirmation blocks actions while busy and schedule edits invalidate consent", async () => {
  const { state, historicalDialog } = editor();
  state.newTaskForm = { ...state.newTaskForm, earliest_start_date: "2026-09-22", due_date: "2026-09-22" };
  await state.commitNewTask();
  const consent = state.pendingHistoricalCreation.input;
  for (const flag of ["busy", "draftSaving"]) {
    state[flag] = true;
    const dialog = historicalDialog();
    const confirmation = dialog.props.children;
    assert.equal(confirmation.props.busy, true);
    for (const button of confirmation.props.children.at(-1).props.children) assert.equal(button.props.disabled, true);
    confirmation.props.onCancel();
    assert.ok(state.pendingHistoricalCreation);
    dialog.props.onMouseDown({ target: dialog, currentTarget: dialog });
    assert.ok(state.pendingHistoricalCreation);
    assert.equal(await state.commitNewTask(consent), false);
    assert.equal(state.committed.length, 0);
    state[flag] = false;
  }
  state.updateNewTaskSchedule({ ...state.newTaskForm, due_time: "12:00" });
  assert.equal(state.pendingHistoricalCreation, null);
  assert.equal(await state.commitNewTask(consent), false);
  assert.equal(state.committed.length, 0);
  assert.notEqual(state.pendingHistoricalCreation.input, consent);
});

test("editing during historical confirmation persistence cannot create stale content", async () => {
  const { state } = editor();
  state.newTaskForm = { ...state.newTaskForm, earliest_start_date: "2026-09-22", due_date: "2026-09-22" };
  await state.commitNewTask();
  const consent = state.pendingHistoricalCreation.input;
  const realSave = state.saveTaskDraft;
  state.saveTaskDraft = async (...args) => {
    const saved = await realSave(...args);
    state.updateNewTaskFields({ ...state.newTaskForm, title: "保存期间修改" });
    return saved;
  };
  assert.equal(await state.commitNewTask(consent), false);
  assert.equal(state.committed.length, 0);
  assert.equal(state.pendingHistoricalCreation, null);
  assert.equal(state.newTaskForm.title, "保存期间修改");
});

test("recurring creation keeps the editor open until refresh and then selects the new unfiltered series", async () => {
  const { state } = editor();
  state.applyCreateItemType("recurring");
  state.selectedRecurringId = "existing-series";
  state.search = "unrelated title";
  state.tagFilter = "unrelated tag";
  let release, refreshStarted;
  const refreshing = new Promise(resolve => { refreshStarted = resolve; });
  state.onRecurringChanged = async () => {
    refreshStarted();
    await new Promise(resolve => { release = resolve; });
  };
  const pending = state.commitNewTask();
  await refreshing;
  assert.equal(state.creating, true, "automatic list selection stays gated while old data is visible");
  assert.equal(state.selectedRecurringId, "existing-series");
  release();
  assert.equal(await pending, true);
  assert.equal(state.creating, false);
  assert.equal(state.view, "recurring");
  assert.equal(state.selectedRecurringId, "created-1");
  assert.equal(state.search, "");
  assert.equal(state.tagFilter, "");
  assert.equal(state.committed.length, 1);
});
