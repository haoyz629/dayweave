import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { normalizeClockInput, sanitizeTimeInput, selectTaskDateBoundary, taskDateRangeIncludesHistory } from "./time-range-control.ts";
import { taskRangeIsValid } from "./task-workload.ts";

const source = ts.createSourceFile("App.tsx", readFileSync(new URL("./App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "TaskScheduleEditor");
const handlers = component.body.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(source));
let calendarExpression, focusEffect;
function collect(node) {
  if (ts.isJsxElement(node) && node.openingElement.getText(source).includes('className="apple-date-grid"')) calendarExpression = node.getText(source);
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect") focusEffect = node;
  ts.forEachChild(node, collect);
}
collect(component);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;

function picker({ start = "2026-10-23", end = start, existing = false } = {}) {
  let today = "2026-10-23", batching = false, priorDependencies;
  const queued = [], calls = [];
  const form = { title: "测试任务", earliest_start_date: start, due_date: end, earliest_start_time: "09:00", due_time: "10:00", estimated_minutes: 60 };
  const state = {
    React, Icon: () => null, form, openPicker: null, monthKey: start.slice(0, 7), pickerTimeInputs: { start: "", end: "" },
    allowExistingHistoricalRange: existing, pickerOriginalRef: { current: null }, triggerRef: { current: null },
    shanghaiDateValue: () => today, newTaskDefaultForm: () => ({ ...form }), normalizeClockInput, sanitizeTimeInput,
    pickerDateLabel: value => value,
    selectTaskDateBoundary, taskDateRangeIncludesHistory, taskRangeIsValid,
    validDraftClock: value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value),
    document: { activeElement: null, body: { style: { overflow: "" } } },
    window: { requestAnimationFrame(callback) { callback(); return 1; }, cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {} },
    dialogRef: { current: { focus() { calls.push("dialog-focus"); } } },
    handleScheduleChange(next) { calls.push(next); }
  };
  for (const key of ["openPicker", "pickerTimeInputs", "monthKey", "todayDate"]) state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => {
    const apply = () => { state[key] = typeof value === "function" ? value(state[key]) : value; };
    if (batching) queued.push(apply); else apply();
  };
  const context = vm.createContext(state);
  vm.runInContext(compile(handlers.join("\n")), context);
  const evaluate = code => vm.runInContext(compile(code), context);
  function effects() {
    const dependencies = evaluate(`(${focusEffect.arguments[1].getText(source)})`);
    if (!priorDependencies || dependencies.some((value, index) => !Object.is(value, priorDependencies[index]))) {
      evaluate(`(${focusEffect.arguments[0].getText(source)})`)();
      priorDependencies = dependencies;
    }
  }
  function calendar() {
    state.todayDate = today;
    state.activePickerDate = state.openPicker.activeField === "start" ? state.openPicker.earliest_start_date : state.openPicker.due_date;
    state.cells = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"].map(key => ({ key, day: Number(key.slice(8)), inMonth: true }));
    return evaluate(`(${calendarExpression})`).props.children;
  }
  return {
    state, calls, effects, calendar, today(value) { today = value; },
    batch(action) { batching = true; try { action(); } finally { batching = false; queued.splice(0).forEach(apply => apply()); } }
  };
}

function timeInput(card) { return card.props.children[1].props.children[1].props.children[1].props.children[1]; }

test("calendar disables historical cross-day dates and handlers cannot bypass the disabled state", () => {
  const { state, calendar } = picker({ end: "2026-10-25" });
  state.openSchedulePicker("start");
  const dates = calendar();
  for (const day of dates.filter(element => element.key < "2026-10-23")) {
    assert.equal(day.props.disabled, true);
    assert.match(day.props.title, /多日任务不可选择历史日期/);
    assert.match(day.props["aria-label"], /不可选/);
    const before = structuredClone(state.openPicker);
    day.props.onClick();
    assert.deepEqual({ ...state.openPicker }, before);
  }
  const allowed = dates.find(element => element.key === "2026-10-24");
  assert.equal(allowed.props.disabled, false);
  allowed.props.onClick();
  assert.equal(state.openPicker.earliest_start_date, "2026-10-24");
  assert.equal(state.openPicker.activeField, "end");
});

test("historical single-day selection synchronizes both dates and stays on the chosen edge", () => {
  for (const edge of ["start", "end"]) {
    const { state, calendar } = picker();
    state.openSchedulePicker(edge);
    const date = calendar().find(element => element.key === "2026-10-21");
    assert.equal(date.props.disabled, false);
    date.props.onClick();
    assert.equal(state.openPicker.earliest_start_date, "2026-10-21");
    assert.equal(state.openPicker.due_date, "2026-10-21");
    assert.equal(state.openPicker.activeField, edge);
    state.updatePickerDate("2026-10-20");
    assert.equal(state.openPicker.earliest_start_date, "2026-10-20");
    assert.equal(state.openPicker.due_date, "2026-10-20");
    assert.equal(state.openPicker.activeField, edge);
  }
});

test("end input blur never reselects end or overwrites a batched time correction when start is clicked", () => {
  const { state, batch } = picker();
  state.openSchedulePicker("end");
  const input = timeInput(state.renderBoundaryCard("end", "结束", state.openPicker.due_date));
  const selectStart = state.renderBoundaryCard("start", "开始", state.openPicker.earliest_start_date).props.onClick;
  batch(() => {
    input.props.onBlur({ currentTarget: { value: "1037" } });
    selectStart();
  });
  assert.equal(state.openPicker.activeField, "start");
  assert.equal(state.openPicker.due_time, "10:37");
  state.commitPickerTimeInput("end", "1045");
  assert.equal(state.openPicker.activeField, "start");
  assert.equal(state.openPicker.due_time, "10:45");
  state.updatePickerDate("2026-10-24");
  state.updatePickerDate("2026-10-25");
  assert.equal(state.openPicker.activeField, "start");
  assert.equal(state.openPicker.earliest_start_date, "2026-10-25");
});

test("dialog focus runs only on open, not on input focus or switching boundaries", () => {
  const { state, calls, effects } = picker();
  effects();
  state.openSchedulePicker("end");
  effects();
  for (const edge of ["start", "end", "start", "end"]) {
    const input = timeInput(state.renderBoundaryCard(edge, edge === "start" ? "开始" : "结束", state.openPicker.due_date));
    let selected = false;
    input.props.onFocus({ currentTarget: { select() { selected = true; } } });
    effects();
    assert.equal(selected, true);
    assert.equal(state.openPicker.activeField, edge);
  }
  assert.deepEqual(calls, ["dialog-focus"]);
  state.closeSchedulePicker(); effects(); state.openSchedulePicker("start"); effects();
  assert.deepEqual(calls, ["dialog-focus", "dialog-focus"]);
});

test("confirmation rechecks Shanghai midnight while legacy unchanged historical ranges remain editable", () => {
  const current = picker({ end: "2026-10-25" });
  current.state.openSchedulePicker("start");
  current.today("2026-10-24");
  current.state.confirmSchedulePicker();
  assert.equal(current.calls.length, 0);
  assert.equal(current.state.todayDate, "2026-10-24", "midnight rejection refreshes calendar and error presentation");
  assert.ok(current.state.openPicker);
  const legacy = picker({ start: "2026-10-20", end: "2026-10-25", existing: true });
  legacy.state.openSchedulePicker("end");
  legacy.state.commitPickerTimeInput("end", "1100");
  legacy.state.confirmSchedulePicker();
  assert.equal(legacy.calls[0].due_time, "11:00");
  assert.equal(legacy.calls[0].earliest_start_date, "2026-10-20");
  assert.equal(legacy.state.openPicker, null);
});

test("reset, cancel and clear keep the original schedule semantics", () => {
  const { state, calls } = picker();
  state.openSchedulePicker("start");
  state.updatePickerDate("2026-10-21");
  state.resetSchedulePicker();
  assert.equal(state.openPicker.earliest_start_date, "2026-10-23");
  assert.equal(state.openPicker.due_date, "2026-10-23");
  state.closeSchedulePicker();
  assert.equal(calls.length, 0);
  state.openSchedulePicker("end");
  state.clearSchedulePicker();
  assert.equal(calls[0].earliest_start_date, "");
  assert.equal(calls[0].due_date, "");
  assert.equal(state.openPicker, null);
});

test("multi-day calendar blocks historical selection on both edges without changing the viewed month", () => {
  for (const edge of ["start", "end"]) {
    const { state, calendar } = picker({ end: "2026-10-25" });
    state.openSchedulePicker(edge);
    for (const day of calendar().filter(element => element.key < "2026-10-23")) assert.equal(day.props.disabled, true);
    const before = structuredClone(state.openPicker);
    state.updatePickerDate("2026-09-30");
    assert.deepEqual({ ...state.openPicker }, before);
    assert.equal(state.monthKey, "2026-10");
  }
});

test("reselecting the active boundary or focusing its time preserves the browsed month", () => {
  const { state } = picker({ end: "2026-11-02" });
  state.openSchedulePicker("start");
  state.monthKey = "2026-12";
  state.selectPickerField("start");
  timeInput(state.renderBoundaryCard("start", "开始", state.openPicker.earliest_start_date)).props.onFocus({ currentTarget: { select() {} } });
  assert.equal(state.monthKey, "2026-12");
  state.selectPickerField("end");
  assert.equal(state.monthKey, "2026-11");
  state.monthKey = "2026-12";
  const dateButton = state.renderBoundaryCard("end", "结束", state.openPicker.due_date).props.children[1].props.children[0];
  dateButton.props.onClick({ stopPropagation() {} });
  assert.equal(state.monthKey, "2026-11", "explicit date click reveals the selected date");
});

test("reset preserves the editing edge and reveals its original month", () => {
  const { state } = picker({ end: "2026-11-02" });
  state.openSchedulePicker("end");
  state.updatePickerDate("2026-12-10");
  state.resetSchedulePicker();
  assert.equal(state.openPicker.activeField, "start");
  assert.equal(state.openPicker.due_date, "2026-11-02");
  assert.equal(state.monthKey, "2026-10");
});

test("confirmation cannot save stale times while the visible input is invalid", () => {
  for (const edge of ["start", "end"]) for (const value of ["", "25:00", "09:"]) {
    const { state, calls } = picker();
    state.openSchedulePicker(edge);
    state.updatePickerTimeInput(edge, value);
    state.confirmSchedulePicker();
    assert.equal(calls.length, 0, `${edge}/${value}`);
    assert.ok(state.openPicker);
  }
});

test("explicit single-day action enables historical backfill and is cancelled without saving", () => {
  for (const edge of ["start", "end"]) {
    const { state, calendar, calls } = picker({ end: "2026-11-02" });
    state.openSchedulePicker(edge);
    state.selectPickerDateMode("single");
    const date = "2026-10-23";
    assert.equal(state.openPicker.earliest_start_date, date);
    assert.equal(state.openPicker.due_date, date);
    assert.equal(state.monthKey, date.slice(0, 7));
    assert.equal(state.openPicker.activeField, "start");
    assert.equal(state.openPicker.earliest_start_time, "09:00");
    assert.equal(state.openPicker.due_time, "10:00");
    const past = calendar().find(day => day.key === "2026-10-21");
    assert.equal(past.props.disabled, false);
    past.props.onClick();
    assert.equal(state.openPicker.earliest_start_date, "2026-10-21");
    assert.equal(state.openPicker.due_date, "2026-10-21");
    state.closeSchedulePicker();
    assert.equal(calls.length, 0);
  }
});

test("single-day conversion of an old range uses today rather than implicitly choosing history", () => {
  const { state } = picker({ start: "2026-10-20", end: "2026-10-25" });
  state.openSchedulePicker("start");
  state.selectPickerDateMode("single");
  assert.equal(state.openPicker.earliest_start_date, "2026-10-23");
  assert.equal(state.openPicker.due_date, "2026-10-23");
});

test("historical single-day confirmation accepts minute precision and rejects invalid durations", () => {
  for (const end of ["0914", "0915", "0900", "0859"]) {
    const { state, calls } = picker();
    state.openSchedulePicker("end");
    state.updatePickerDate("2026-10-21");
    state.updatePickerTimeInput("end", end);
    state.confirmSchedulePicker();
    assert.equal(calls.length, end === "0915" ? 1 : 0);
    if (calls.length) {
      assert.equal(calls[0].earliest_start_date, "2026-10-21");
      assert.equal(calls[0].due_date, "2026-10-21");
      assert.equal(calls[0].due_time, "09:15");
    }
  }
});

test("opening a saved multi-day range honors the selected boundary and clicking updates that boundary", () => {
  for (const edge of ["start", "end"]) {
    const { state } = picker({ start: "2026-10-25", end: "2026-11-02" });
    state.openSchedulePicker(edge);
    assert.equal(state.openPicker.dateMode, "range");
    assert.equal(state.openPicker.activeField, edge);
    assert.equal(state.monthKey, edge === "start" ? "2026-10" : "2026-11");
    state.updatePickerDate("2026-11-05");
    assert.equal(state.openPicker.earliest_start_date, edge === "start" ? "2026-11-05" : "2026-10-25");
    assert.equal(state.openPicker.due_date, edge === "start" ? "2026-11-05" : "2026-11-05");
  }
});

test("opening either edge of a single-day task selects the whole day, including future dates", () => {
  for (const edge of ["start", "end"]) {
    const { state } = picker();
    state.openSchedulePicker(edge);
    assert.equal(state.openPicker.dateMode, "single");
    for (const date of ["2026-11-02", "2026-10-24", "2026-10-21"]) {
      state.updatePickerDate(date);
      assert.equal(state.openPicker.earliest_start_date, date);
      assert.equal(state.openPicker.due_date, date);
      assert.equal(state.openPicker.dateMode, "single");
    }
  }
});

test("multi-day selection is explicit, begins at start, and remains multi-day when boundaries meet", () => {
  const { state, calendar } = picker();
  state.openSchedulePicker("end");
  state.selectPickerDateMode("range");
  assert.equal(state.openPicker.dateMode, "range");
  assert.equal(state.openPicker.activeField, "start");
  assert.ok(calendar().filter(day => day.key < "2026-10-23").every(day => day.props.disabled));
  state.selectPickerField("end");
  state.updatePickerDate("2026-10-25");
  assert.equal(state.openPicker.earliest_start_date, "2026-10-23");
  assert.equal(state.openPicker.due_date, "2026-10-25");
  state.updatePickerDate("2026-10-23");
  assert.equal(state.openPicker.dateMode, "range");
  state.updatePickerDate("2026-10-21");
  assert.equal(state.openPicker.due_date, "2026-10-25");
  assert.equal(state.openPicker.activeField, "end");
  state.resetSchedulePicker();
  assert.equal(state.openPicker.dateMode, "single");
});

test("historical single day cannot switch to multi-day until a current or future day is chosen", () => {
  const { state } = picker({ start: "2026-10-21" });
  state.openSchedulePicker("end");
  state.selectPickerDateMode("range");
  assert.equal(state.openPicker.dateMode, "single");
  assert.equal(state.openPicker.earliest_start_date, "2026-10-21");
  state.updatePickerDate("2026-10-24");
  state.selectPickerDateMode("range");
  assert.equal(state.openPicker.dateMode, "range");
  assert.equal(state.openPicker.activeField, "start");
});

test("unexpanded multi-day selection is rechecked at midnight rather than silently becoming backfill", () => {
  const { state, today, calls } = picker();
  state.openSchedulePicker("start");
  state.selectPickerDateMode("range");
  today("2026-10-24");
  state.confirmSchedulePicker();
  assert.equal(calls.length, 0);
  assert.ok(state.openPicker);
});

test("single-day cards do not present separate start and end date choices", () => {
  const { state } = picker();
  state.openSchedulePicker("end");
  for (const edge of ["start", "end"]) {
    const fields = state.renderBoundaryCard(edge, edge, state.openPicker.due_date).props.children[1];
    assert.equal(fields.props.children[0], false);
    assert.match(fields.props.className, /is-single-day/);
  }
  state.selectPickerDateMode("range");
  for (const edge of ["start", "end"]) {
    const fields = state.renderBoundaryCard(edge, edge, state.openPicker.due_date).props.children[1];
    assert.equal(fields.props.children[0].type, "button");
  }
});

test("recommended tasks stay single-day at every hour, including month and year boundaries", () => {
  const names = ["shanghaiDateValue", "shanghaiDateTimeFields", "newTaskDefaultForm"];
  const declarations = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(source));
  const defaults = vm.runInNewContext(compile(`${declarations.join("\n")}\nnewTaskDefaultForm;`));
  for (const date of ["2026-10-23", "2026-12-31", "2028-02-29"]) for (let hour = 0; hour < 24; hour++) {
    const now = new Date(`${date}T${String(hour).padStart(2, "0")}:37:00+08:00`);
    const form = defaults(now);
    assert.equal(form.earliest_start_date, form.due_date, `${date}/${hour}`);
    assert.equal(form.estimated_minutes, 60);
    assert.equal(taskRangeIsValid(form), true);
    assert.ok(new Date(`${form.earliest_start_date}T${form.earliest_start_time}:00+08:00`) > now);
  }
});
