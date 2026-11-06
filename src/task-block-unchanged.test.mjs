import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { createDialogHarness } from "./task-block-dialog.test.mjs";
import { normalizeClockInput } from "./time-range-control.ts";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
let normalTimeSave, recurringTimeSave;
function collect(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(source));
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "button" && node.getText(source).includes("保存调整")) {
    if (node.getText(source).includes('form="recurring-block-time-form"')) recurringTimeSave = node.getText(source);
    else if (node.getText(source).includes("正在保存")) normalTimeSave = node.getText(source);
  }
  ts.forEachChild(node, collect);
}
collect(source);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const run = (code, state) => vm.runInContext(compile(code), vm.isContext(state) ? state : vm.createContext(state));
const button = current => current.elements().find(node => node.props.className === "primary-action");

for (const status of ["executing", "completed", "not_completed"]) test(`${status}: only meaningful changes enable result Save`, () => {
  const current = createDialogHarness({ status });
  assert.equal(button(current).props.disabled, true);
  const note = current.elements().find(node => node.type === "textarea");
  note.props.onChange({ target: { value: "  新备注  " } });
  assert.equal(button(current).props.disabled, false);
  note.props.onChange({ target: { value: "   " } });
  assert.equal(button(current).props.disabled, true);
  const original = current.state.executionDraft.outcome;
  const different = original === "completed" ? "not_completed" : "completed";
  current.elements().find(node => node.props["data-outcome"] === different).props.onClick();
  assert.equal(button(current).props.disabled, false);
  current.state.executionDraft.outcome = original;
  current.state.executionDraft.result = original === "completed" ? "completed" : original ? "not_completed" : null;
  assert.equal(button(current).props.disabled, true);
});

test("saved note-only and legacy incomplete values are unchanged until their visible content changes", () => {
  for (const outcome of ["planned", "partial", "blocked", "cancelled", "not_started", "completed"]) {
    const current = createDialogHarness();
    Object.assign(current.state.selectedBlock, { execution_status: outcome, execution_note: "原备注" });
    current.state.executionDraft = { outcome: outcome === "planned" ? null : outcome === "completed" ? "completed" : "not_started", note: " 原备注 " };
    assert.equal(button(current).props.disabled, true, outcome);
    current.state.executionDraft.note = "新备注";
    assert.equal(button(current).props.disabled, false, outcome);
    current.state.executionDraft.note = "原备注";
    assert.equal(button(current).props.disabled, true, outcome);
  }
});

test("whole-task completion is a new action only while the task is not already done", () => {
  const current = createDialogHarness({ crossDay: true, status: "completed" });
  current.state.selectedTask.status = "scheduled";
  assert.equal(button(current).props.disabled, true);
  current.elements().find(node => node.props["data-action"] === "complete-task").props.onClick();
  assert.equal(button(current).props.disabled, false);
  current.state.selectedTask.status = "done";
  assert.equal(button(current).props.disabled, true);
  current.state.executionDraft.note = "新备注";
  assert.equal(button(current).props.disabled, false);
});

function timeHarness() {
  const state = {
    React, busy: false, savingRecurringChange: false, quickCompletingBlockId: null,
    planDraftTimeEdit: { starts_at: "09:00", ends_at: "10:00", original_starts_at: "09:00", original_ends_at: "10:00" },
    selectedRecurringOccurrence: { occurrence_date: "2026-11-06", display_time: "09:00", display_duration_minutes: 60 },
    recurringTimeEdit: { date: "2026-11-06", time: "09:00", duration: 60 },
    normalizeClockInput
  };
  for (const name of ["normalizeDraftClock", "planDraftTimeChanged", "recurringTimeEditChanged"]) if (functions.has(name)) run(functions.get(name), state);
  return { state, normal: () => run(`(${normalTimeSave})`, state), recurring: () => run(`(${recurringTimeSave})`, state) };
}

test("ordinary and draft time saves stay disabled at their normalized original range", () => {
  const h = timeHarness();
  assert.equal(h.normal().props.disabled, true);
  h.state.planDraftTimeEdit.starts_at = "9:00";
  assert.equal(h.normal().props.disabled, true);
  h.state.planDraftTimeEdit.starts_at = "09:15";
  assert.equal(h.normal().props.disabled, false);
  h.state.planDraftTimeEdit.starts_at = "09:00";
  assert.equal(h.normal().props.disabled, true);
  h.state.planDraftTimeEdit.ends_at = "10:30";
  assert.equal(h.normal().props.disabled, false);
});

test("recurring time save compares date, normalized time and duration", () => {
  const h = timeHarness();
  const original = { ...h.state.recurringTimeEdit };
  assert.equal(h.recurring().props.disabled, true);
  h.state.recurringTimeEdit.time = "9:00";
  assert.equal(h.recurring().props.disabled, true);
  for (const [key, value] of [["date", "2026-11-07"], ["time", "09:30"], ["duration", 90]]) {
    h.state.recurringTimeEdit = { ...original, [key]: value };
    assert.equal(h.recurring().props.disabled, false, key);
    h.state.recurringTimeEdit = { ...original };
    assert.equal(h.recurring().props.disabled, true, key);
  }
});

test("unchanged time submissions neither close nor stage or persist edits", async () => {
  const h = timeHarness(), calls = [];
  Object.assign(h.state, {
    recurringResultSavingRef: { current: false }, canEditRecurringOccurrence: () => true,
    recurringInput: () => ({}), recurringChangeIssue: () => null, shanghaiDateValue: () => "2026-11-06",
    stageRecurringChange() { calls.push("stage"); }, closeTimelinePanel() { calls.push("close"); },
    validDraftClock: () => true, clockMinutes: value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3)), MIN_TASK_BLOCK_MINUTES: 15,
    selectedDraftBlock: { starts_at: "2026-11-06T09:00:00+08:00", ends_at: "2026-11-06T10:00:00+08:00" },
    timeInputValue: value => value.slice(11, 16)
  });
  for (const name of ["saveRecurringTimeEdit", "savePlanDraftTime"]) {
    run(functions.get(name), h.state);
    await h.state[name]({ preventDefault() {} });
  }
  assert.deepEqual(calls, []);
});
