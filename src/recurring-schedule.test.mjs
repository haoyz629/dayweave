import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { recurringTimeBlockIssue, recurringOccurrenceInput, recurringChangeIssue, recurringTimeRange, recurringClockRange, recurringRangeInput } from "./recurring-schedule.ts";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
function collect(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(source));
  ts.forEachChild(node, collect);
}
collect(source);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const run = (names, state) => vm.runInNewContext(compile(names.map(name => functions.get(name)).join("\n")), state);
const input = { title: "周会", notes: null, tags: [], frequency: "weekly", interval_value: 2, weekdays: [1], month_day: null, starts_on: "2026-10-05", ends_on: null, display_time: "09:00", display_duration_minutes: 60 };
const occurrence = { id: "occurrence", recurring_item_id: "series", occurrence_date: "2026-10-26", title: "单次周会", notes: "本次备注", tags: ["工作"], display_time: "10:00", display_duration_minutes: 30 };
const change = () => ({ occurrence: { ...occurrence }, input: { ...input }, targetDate: occurrence.occurrence_date });

function setters(state, keys) {
  for (const key of keys) state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = typeof value === "function" ? value(state[key]) : value; };
}

test("recurring creation requires a valid within-day time block, including exactly midnight end", () => {
  for (const fields of [ { display_time: null }, { display_time: "" }, { display_time: "24:00" }, { display_time: "9:00" }, { display_duration_minutes: null }, { display_duration_minutes: 0 }, { display_duration_minutes: 1.5 }, { display_duration_minutes: 1441 }, { display_time: "23:30", display_duration_minutes: 31 } ]) assert.ok(recurringTimeBlockIssue({ ...input, ...fields }));
  for (const fields of [ {}, { display_time: "23:30", display_duration_minutes: 30 }, { display_time: "00:00", display_duration_minutes: 1440 }, { display_duration_minutes: 1 } ]) assert.equal(recurringTimeBlockIssue({ ...input, ...fields }), null);
  assert.equal(recurringTimeRange({ display_time: "23:30", display_duration_minutes: 30 }), "23:30–24:00");
});

test("recurring range UI round-trips storage with one-minute precision and 24:00 boundary", () => {
  for (const [start, end, duration] of [["09:00", "10:00", 60], ["09:31", "09:32", 1], ["23:59", "24:00", 1], ["00:00", "24:00", 1440]]) {
    const range = { start, end };
    const stored = recurringRangeInput(range);
    assert.deepEqual(stored, { display_time: start, display_duration_minutes: duration });
    assert.equal(recurringTimeBlockIssue(stored), null);
    assert.deepEqual(recurringClockRange(stored), range);
  }
  for (const [start, end] of [["24:00", "24:00"], ["23:59", "24:01"], ["23:30", "00:30"], ["10:00", "10:00"], ["", "10:00"]]) {
    assert.ok(recurringTimeBlockIssue(recurringRangeInput({ start, end })));
  }
  assert.deepEqual(recurringClockRange({ display_time: "09:00", display_duration_minutes: null }), { start: "09:00", end: "" });
});

test("occurrence inputs keep rule phase and use the single block's edited fields", () => {
  const result = recurringOccurrenceInput(input, occurrence);
  assert.equal(result.starts_on, input.starts_on);
  assert.equal(result.interval_value, 2);
  assert.equal(result.title, occurrence.title);
  assert.equal(result.display_time, "10:00");
  assert.equal(result.notes, "本次备注");
  result.tags.push("不共享引用");
  assert.deepEqual(occurrence.tags, ["工作"]);
});

test("editing an older occurrence keeps its own rule instead of the latest series rule", () => {
  const latestItem = { ...input, id: "series", frequency: "daily", interval_value: 1, weekdays: [], starts_on: "2026-11-01", ends_on: "2026-12-31" };
  const olderOccurrence = { ...occurrence, schedule_rule: { ...input, ends_on: "2026-10-31" } };
  const result = recurringOccurrenceInput(latestItem, olderOccurrence);
  assert.equal(result.frequency, "weekly");
  assert.equal(result.interval_value, 2);
  assert.equal(result.starts_on, "2026-10-05");
  assert.equal(result.ends_on, "2026-10-31");
  assert.deepEqual(result.weekdays, [1]);
  assert.equal(result.title, occurrence.title);
  const state = { recurringOccurrenceInput };
  run(["recurringItemFormForItem", "recurringFormForOccurrence"], state);
  const form = state.recurringFormForOccurrence(latestItem, olderOccurrence);
  assert.equal(form.frequency, "weekly");
  assert.equal(form.interval_value, 2);
  assert.equal(form.starts_on, "2026-10-05");
  assert.equal(form.ends_on, "2026-10-31");
  assert.equal(form.display_time, "10:00");
  assert.deepEqual(form.tags, ["工作"]);
});

test("history and invalid target dates are rejected before any write", () => {
  assert.match(recurringChangeIssue(change(), "2026-10-27"), /历史/);
  assert.match(recurringChangeIssue({ ...change(), targetDate: "2026-10-24" }, "2026-10-25"), /历史/);
  assert.ok(recurringChangeIssue({ ...change(), targetDate: "2026-11-31" }, "2026-10-25"));
  assert.equal(recurringChangeIssue(change(), "2026-10-26"), null);
});

test("incomplete recurring creation preserves draft and never calls confirmation", async () => {
  const state = { busy: false, draftSaving: false, createItemType: "recurring", recurringForm: { ...input, display_time: "" }, currentCreationInput: () => ({ ...input }), newTaskEditRevision: { current: 0 }, recurringTimeBlockIssue };
  setters(state, ["newTaskError"]);
  run(["commitNewTask"], state);
  assert.equal(await state.commitNewTask(), false);
  assert.match(state.newTaskError, /开始时间.*草稿/);
});

test("task page resolves today/next at save and does not write before confirmation", async () => {
  for (const target of [occurrence, null]) {
    const state = { selectedRecurringItem: { id: "series" }, busy: false, recurringTargetLoading: false, recurringTarget: occurrence, recurringForm: input,
      resolveRecurringEditTarget: async () => target, recurringItemInputForForm: value => value, recurringChangeIssue, shanghaiDateValue: () => "2026-10-25", uiErrorMessage: String };
    setters(state, ["busy", "feedback", "recurringScopeError", "pendingItemChange"]);
    run(["saveRecurringItem"], state);
    await state.saveRecurringItem();
    assert.equal(state.busy, false);
    if (target) assert.equal(state.pendingItemChange.occurrence.id, "occurrence");
    else { assert.equal(state.pendingItemChange, undefined); assert.match(state.feedback, /没有可修改的后续安排/); }
  }
});

test("task page confirms this/future through one API and retains failed changes", async () => {
  for (const scope of ["this", "future"]) for (const fail of [false, true]) {
    const writes = [];
    const state = { pendingItemChange: change(), busy: false, recurringEditRevision: 0, recurringChangeIssue, shanghaiDateValue: () => "2026-10-25", uiErrorMessage: String,
      updateRecurringOccurrence: async (...args) => { writes.push(args); if (fail) throw Error("数据库忙"); }, onRecurringChanged: async () => {} };
    setters(state, ["busy", "recurringScopeError", "pendingItemChange", "recurringEditRevision", "feedback"]);
    run(["commitRecurringItemChange"], state);
    await state.commitRecurringItemChange(scope);
    assert.equal(writes.length, 1); assert.equal(writes[0][0], "occurrence"); assert.equal(writes[0][3], scope);
    assert.equal(state.busy, false);
    if (fail) { assert.ok(state.pendingItemChange); assert.match(state.recurringScopeError, /原安排已保留/); }
    else { assert.equal(state.pendingItemChange, null); assert.equal(state.recurringEditRevision, 1); }
  }
});

test("timeline staging and cancelling discard only temporary edits", () => {
  const notifications = [];
  const state = { savingRecurringChange: false, recurringChangeIssue, shanghaiDateValue: () => "2026-10-25", onNotify: (...args) => notifications.push(args), timelineScrollRef: { current: { focus() {} } }, window: { requestAnimationFrame: fn => fn() } };
  setters(state, ["selection", "recurringTimeEdit", "timelineTooltip", "recurringChangeError", "pendingRecurringChange", "timelineDrag"]);
  run(["stageRecurringChange", "cancelRecurringChange"], state);
  state.stageRecurringChange(change());
  assert.equal(state.pendingRecurringChange.occurrence.id, occurrence.id);
  state.cancelRecurringChange();
  assert.equal(state.pendingRecurringChange, null); assert.equal(state.timelineDrag, null); assert.equal(notifications.length, 0);
  state.stageRecurringChange({ ...change(), targetDate: "2026-10-20" });
  assert.equal(state.pendingRecurringChange, null); assert.equal(notifications.length, 1);
});

test("timeline scope commit revalidates history at confirmation and does not write stale past blocks", async () => {
  const state = { pendingRecurringChange: change(), savingRecurringChange: false, recurringChangeIssue, shanghaiDateValue: () => "2026-10-27" };
  setters(state, ["recurringChangeError"]);
  run(["commitTimelineRecurringChange"], state);
  await state.commitTimelineRecurringChange("future");
  assert.match(state.recurringChangeError, /历史/);
});

test("recurring drag updates time, bounded duration, or a week-date drop without saving", () => {
  const state = { pixelsPerHour: 60, selectedDate: "2026-10-26", timelineScrollRef: { current: { scrollTop: 0 } }, timelineDragRef: { current: null }, document: { elementFromPoint: () => null } };
  setters(state, ["timelineDrag"]);
  run(["updateTimelineDrag"], state);
  const session = () => ({ key: "recurring:occurrence", active: true, originalStart: 600, start: 600, originalDuration: 30, duration: 30, downY: 100, downScroll: 0, x: 100, y: 160, occurrence, mode: "move", targetDate: state.selectedDate });
  state.timelineDragRef.current = session(); state.updateTimelineDrag();
  assert.equal(state.timelineDrag.start, 660); assert.equal(state.timelineDrag.end, 690);
  state.timelineDragRef.current = { ...session(), mode: "resize", y: 10000 }; state.updateTimelineDrag();
  assert.equal(state.timelineDrag.end, 1440);
  state.timelineDragRef.current = session(); state.document.elementFromPoint = () => ({ closest: () => ({ dataset: { recurringDropDate: "2026-10-28" } }) }); state.updateTimelineDrag();
  assert.equal(state.timelineDrag.targetDate, "2026-10-28"); assert.equal(state.timelineDrag.start, 600);
});

test("scope confirmation shows target only at save, offers both scopes and no completion actions", () => {
  const dialogText = readFileSync(new URL("./recurring-scope-confirmation.tsx", import.meta.url), "utf8");
  const dialogSource = ts.createSourceFile("dialog.tsx", dialogText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = dialogSource.statements.find(node => ts.isFunctionDeclaration(node));
  const scopes = [];
  const state = { React, createPortal: node => node, ConfirmationDialog: () => null, recurringTimeRange, document: { body: {} }, change: change(), scopes };
  vm.runInNewContext(compile(fn.getText(dialogSource).replace(/^export /, "")), state);
  const tree = state.RecurringScopeConfirmation({ change: change(), busy: false, error: "", onCancel() {}, onConfirm: scope => scopes.push(scope) });
  const dialog = tree.props.children;
  const actions = React.Children.toArray(dialog.props.children).find(node => node.props?.className === "dialog-actions");
  const buttons = React.Children.toArray(actions.props.children);
  buttons[1].props.onClick(); buttons[2].props.onClick();
  assert.deepEqual(scopes, ["this", "future"]);
  assert.match(dialogText, /历史任务块保持不变/);
  assert.doesNotMatch(functions.get("saveRecurringItem"), /await updateRecurring/);
  assert.doesNotMatch(text, /正在编辑：|saveRecurringOccurrenceReview|recurring-outcome-picker/);
});
