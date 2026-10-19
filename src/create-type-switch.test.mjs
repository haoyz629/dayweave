import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { syncFormCommonFields } from "./create-type-switch.ts";

// Exercise the real editor handlers; persistence is isolated from user data.
const source = ts.createSourceFile("App.tsx", readFileSync(new URL("./App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = new Set(["applyCreateItemType", "updateNewTaskFields", "currentCreationInput", "persistCurrentTaskDraft", "saveNewTaskBeforeLeaving", "cancelNewTask", "clearNewTaskForm", "commitNewTask", "openPersistedTaskDraft", "selectPersistedTaskDraft", "recurringFormForDraft", "recurringCapsuleFacts"]);
const snippets = [];
let capsuleExpression;
function collect(node) {
  if (ts.isFunctionDeclaration(node) && handlers.has(node.name?.text)) snippets.push(node.getText(source));
  if (ts.isJsxExpression(node) && node.expression?.getText(source).startsWith('!taskDraftsLoading && view === "draft" && visibleTaskDrafts.map')) capsuleExpression = node.expression.getText(source);
  ts.forEachChild(node, collect);
}
collect(source);
const handlerCode = ts.transpileModule(snippets.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function editor({ saved = true } = {}) {
  const defaults = () => ({ title: "", notes: "", tags: [], priority: "high", due_date: "2026-09-25", due_time: "11:00" });
  const taskForm = { ...defaults(), title: "团队周会", notes: "准备材料" };
  const recurringDefaults = () => ({ title: "", notes: "", tags: [], frequency: "weekly", weekdays: [1], display_time: "09:00", ends_on: "" });
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
    today: "2026-09-23", setTimeout, Date, syncFormCommonFields, validDraftClock: () => true,
    taskDraftInputForForm: (form) => ({ ...form }), taskFormForPersistedDraft: (draft) => ({ ...defaults(), ...draft }),
    uiErrorMessage: String, preferredSelection: { current: null }, viewForStatus: () => "open",
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
  for (const key of ["busy", "newTaskError", "newTaskForm", "persistedNewTaskDraft", "taskDrafts", "recurringForm", "newTaskAutosaveArmed", "createItemType", "draftSaving", "feedback", "creating", "successToast", "pendingDiscardNew", "view", "selectedRecurringId", "selectedId", "draft"]) {
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
  return { state, db, renderCapsules };
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

test("linked followup drafts keep inherited priority and tags and submit only ordinary-task settings", async () => {
  const { state } = editor();
  const linked = { ...state.persistedNewTaskDraft, id: "followup-draft", item_type: "task", title: "后续任务",
    notes: null, priority: "low", tags: ["项目A", "文档"], recurring_settings: null,
    origin: { source_task_id: "original-task", source_title: "来源任务", source_status: "scheduled" } };
  await state.openPersistedTaskDraft(linked);
  assert.equal(state.newTaskForm.priority, "low");
  assert.deepEqual(state.newTaskForm.tags, ["项目A", "文档"]);
  assert.equal(state.newTaskForm.notes, null);
  state.applyCreateItemType("recurring");
  assert.equal(state.createItemType, "task");
  const input = state.currentCreationInput();
  assert.equal(input.item_type, "task");
  assert.equal(input.recurring_settings, null);
  assert.equal(input.priority, "low");
  assert.deepEqual(input.tags, ["项目A", "文档"]);
});
