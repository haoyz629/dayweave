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
let calendarExpression, calendarHintExpression, focusEffect;
function collect(node) {
  if (ts.isJsxElement(node) && node.openingElement.getText(source).includes('className="apple-date-grid"')) {
    calendarExpression = node.getText(source);
  }
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "strong" && node.getText(source).includes("已选历史日期")) calendarHintExpression = node.getText(source);
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
    React, Icon: () => null, form, openPicker: null, pickerHoverDate: null, monthKey: start.slice(0, 7), pickerTimeInputs: { start: "", end: "" },
    allowExistingHistoricalRange: existing, pickerOriginalRef: { current: null }, triggerRef: { current: null },
    shanghaiDateValue: () => today, newTaskDefaultForm: () => ({ ...form }), normalizeClockInput, sanitizeTimeInput,
    pickerDateLabel: value => value,
    shiftMonthKey: (month, offset) => { const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + offset); return date.toISOString().slice(0, 7); },
    selectTaskDateBoundary, taskDateRangeIncludesHistory, taskRangeIsValid,
    validDraftClock: value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value),
    document: { activeElement: null, body: { style: { overflow: "" } } },
    window: { requestAnimationFrame(callback) { callback(); return 1; }, cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {} },
    dialogRef: { current: { focus() { calls.push("dialog-focus"); } } },
    handleScheduleChange(next) { calls.push(next); }
  };
  for (const key of ["openPicker", "pickerHoverDate", "pickerTimeInputs", "monthKey", "todayDate"]) state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => {
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
    state.cells = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"].map(key => ({ key, day: Number(key.slice(8)), inMonth: true }));
    return evaluate(`(${calendarExpression})`).props.children;
  }
  return {
    state, calls, effects, calendar, today(value) { today = value; },
    hint() { state.todayDate = today; return evaluate(`(${calendarHintExpression})`).props.children; },
    leaveCalendar() { return evaluate(`(${calendarExpression})`).props.onPointerLeave(); },
    batch(action) { batching = true; try { action(); } finally { batching = false; queued.splice(0).forEach(apply => apply()); } }
  };
}

function timeInput(card) { return card.props.children[1].props.children[1].props.children[1].props.children[1]; }
function dateButton(card) { return card.props.children[1].props.children[0]; }
function assertDates(state, start, end = start) {
  assert.equal(state.openPicker.earliest_start_date, start);
  assert.equal(state.openPicker.due_date, end);
}

test("ordinary picker has no single/multi-day modes or endpoint tabs", () => {
  const text = component.getText(source);
  assert.doesNotMatch(text, /dateMode|selectPickerDateMode|schedule-picker-date-mode|role="tablist"|当前操作目标/);
  assert.match(text, /较早的日期自动作为开始日/);
  assert.match(text, /历史日期仅支持单日/);
  assert.doesNotMatch(text, /schedule-picker-date-help|选定一天后，悬停预览范围，再点击完成选择/);
});

test("calendar hints distinguish historical dates, single days and multi-day ranges", () => {
  for (const date of ["2026-10-21", "2026-10-22"]) {
    const h = picker({ start: date });
    h.state.openSchedulePicker("start");
    assert.equal(h.hint(), "已选历史日期，仅支持单日");
    h.state.selectPickerField("end", true);
    assert.equal(h.hint(), "已选历史日期，仅支持单日");
  }
  for (const date of ["2026-10-23", "2026-10-25"]) {
    const h = picker({ start: date });
    h.state.openSchedulePicker("start");
    assert.equal(h.hint(), "已选单日，点击日期可重新选择");
    h.state.updatePickerDate(date);
    assert.equal(h.hint(), "已选单日，可再选一天组成多日范围");
    h.state.setPickerHoverDate("2026-11-02");
    assert.equal(h.hint(), "已选单日，可再选一天组成多日范围");
    h.state.updatePickerDate("2026-11-02");
    assert.equal(h.hint(), "已选多日，点击日期可重新选择");
    h.state.selectPickerField("start", true);
    assert.equal(h.hint(), "已选多日，点击新日期后自动排序");
    h.state.updatePickerDate("2026-10-21");
    assert.equal(h.hint(), "已选历史日期，仅支持单日");
  }
});

test("calendar hints reclassify a single day after midnight without mislabeling legacy multi-day ranges", () => {
  const h = picker();
  h.state.openSchedulePicker("start");
  h.state.updatePickerDate("2026-10-23");
  h.today("2026-10-24");
  assert.equal(h.hint(), "已选历史日期，仅支持单日");
  const legacy = picker({ start: "2026-10-20", end: "2026-10-25", existing: true });
  legacy.state.openSchedulePicker("end");
  assert.equal(legacy.hint(), "已选多日，点击日期可重新选择");
});

test("two clicks sort a future range in either direction regardless of the opening time field", () => {
  for (const edge of ["start", "end"]) for (const dates of [["2026-10-24", "2026-10-25"], ["2026-10-25", "2026-10-24"]]) {
    const { state, calendar } = picker();
    state.openSchedulePicker(edge);
    calendar().find(day => day.key === dates[0]).props.onClick();
    assertDates(state, dates[0]);
    assert.equal(state.openPicker.dateAnchor, dates[0]);
    calendar().find(day => day.key === dates[1]).props.onClick();
    assertDates(state, "2026-10-24", "2026-10-25");
    assert.equal(state.openPicker.dateAnchor, null);
    assert.equal(state.openPicker.earliest_start_time, "09:00");
    assert.equal(state.openPicker.due_time, "10:00");
  }
});

test("both endpoints remain selected with the same style when time focus changes", () => {
  const { state, calendar } = picker({ end: "2026-10-25" });
  state.openSchedulePicker("start");
  for (const edge of ["start", "end"]) {
    state.selectPickerField(edge);
    const dates = calendar();
    for (const key of ["2026-10-23", "2026-10-25"]) {
      const date = dates.find(day => day.key === key);
      assert.equal(date.props["aria-pressed"], true);
      assert.match(date.props.className, /\bselected\b/);
    }
    assert.equal(dates.find(day => day.key === "2026-10-24").props["aria-pressed"], false);
  }
});

test("hover previews a sorted range in both directions without changing dates, times or pressed state", () => {
  for (const [anchor, hover] of [["2026-10-23", "2026-10-25"], ["2026-10-25", "2026-10-23"]]) {
    const { state, calendar, leaveCalendar } = picker();
    state.openSchedulePicker("start");
    state.updatePickerDate(anchor);
    calendar().find(day => day.key === hover).props.onPointerEnter({ pointerType: "mouse" });
    assertDates(state, anchor);
    assert.equal(state.openPicker.dateAnchor, anchor);
    assert.equal(state.openPicker.earliest_start_time, "09:00");
    assert.equal(state.openPicker.due_time, "10:00");
    const days = calendar();
    assert.match(days.find(day => day.key === "2026-10-23").props.className, /\brange-start\b/);
    assert.match(days.find(day => day.key === "2026-10-24").props.className, /\bin-range\b/);
    assert.doesNotMatch(days.find(day => day.key === "2026-10-24").props.className, /\bselected\b/);
    assert.match(days.find(day => day.key === "2026-10-25").props.className, /\brange-end\b/);
    assert.equal(days.find(day => day.key === hover).props["aria-pressed"], false);
    for (const day of days.filter(day => day.key >= "2026-10-23")) assert.match(day.props.className, /\bis-preview\b/);
    leaveCalendar();
    assert.equal(state.pickerHoverDate, null);
    for (const day of calendar()) assert.doesNotMatch(day.props.className, /\bis-preview\b/);
    assertDates(state, anchor);
  }
});

test("keyboard focus previews but touch entry does not, and focus blur clears the preview", () => {
  const { state, calendar } = picker();
  state.openSchedulePicker("start"); state.updatePickerDate("2026-10-23");
  let day = calendar().find(day => day.key === "2026-10-25");
  day.props.onPointerEnter({ pointerType: "touch" });
  assert.equal(state.pickerHoverDate, null);
  day.props.onFocus();
  assert.match(calendar().find(day => day.key === "2026-10-24").props.className, /\bis-preview\b/);
  day.props.onBlur();
  assert.equal(state.pickerHoverDate, null);
});

test("clicking closes the preview and completed or historical selections do not extend on hover", () => {
  const { state, calendar } = picker();
  state.openSchedulePicker("start"); state.updatePickerDate("2026-10-23");
  calendar().find(day => day.key === "2026-10-25").props.onPointerEnter({ pointerType: "mouse" });
  calendar().find(day => day.key === "2026-10-25").props.onClick();
  assertDates(state, "2026-10-23", "2026-10-25");
  assert.equal(state.pickerHoverDate, null);
  calendar().find(day => day.key === "2026-10-24").props.onPointerEnter({ pointerType: "mouse" });
  assert.equal(state.pickerCalendarRange(state.openPicker).preview, false);
  state.updatePickerDate("2026-10-21");
  calendar().find(day => day.key === "2026-10-25").props.onFocus();
  assert.equal(state.pickerCalendarRange(state.openPicker).preview, false);
  assertDates(state, "2026-10-21");
});

test("hover cannot preview a historical range, including when the anchor crosses Shanghai midnight", () => {
  const { state, calendar, today } = picker();
  state.openSchedulePicker("start"); state.updatePickerDate("2026-10-23");
  calendar().find(day => day.key === "2026-10-22").props.onFocus();
  assert.equal(state.pickerCalendarRange(state.openPicker).preview, false);
  calendar().find(day => day.key === "2026-10-25").props.onFocus();
  assert.equal(state.pickerCalendarRange(state.openPicker).preview, true);
  today("2026-10-24");
  assert.equal(state.pickerCalendarRange(state.openPicker).preview, false);
  assertDates(state, "2026-10-23");
});

test("hover across months keeps the anchor, month navigation clears preview and reverse clicks still sort", () => {
  const { state } = picker();
  state.openSchedulePicker("start"); state.updatePickerDate("2026-11-02");
  state.setPickerHoverDate("2026-11-05"); state.shiftPickerMonth(-1);
  assert.equal(state.monthKey, "2026-10");
  assert.equal(state.pickerHoverDate, null);
  assert.equal(state.openPicker.dateAnchor, "2026-11-02");
  state.setPickerHoverDate("2026-10-25");
  const range = state.pickerCalendarRange(state.openPicker);
  assert.equal(range.start, "2026-10-25"); assert.equal(range.end, "2026-11-02");
  state.updatePickerDate("2026-10-25");
  assertDates(state, "2026-10-25", "2026-11-02");
});

test("reset, close, reopen and explicit date-card editing clear transient hover", () => {
  const { state } = picker({ end: "2026-10-25" });
  state.openSchedulePicker("start");
  state.setPickerHoverDate("2026-10-24"); state.selectPickerField("end", true);
  assert.equal(state.pickerHoverDate, null);
  state.setPickerHoverDate("2026-10-24"); state.resetSchedulePicker();
  assert.equal(state.pickerHoverDate, null);
  state.setPickerHoverDate("2026-10-24"); state.closeSchedulePicker();
  assert.equal(state.pickerHoverDate, null);
  state.setPickerHoverDate("2026-10-24"); state.openSchedulePicker("start");
  assert.equal(state.pickerHoverDate, null);
});

test("single-day selection has both closed endpoints and hover cannot change the confirmed result", () => {
  const { state, calendar, calls } = picker();
  state.openSchedulePicker("start"); state.updatePickerDate("2026-10-24");
  let selected = calendar().find(day => day.key === "2026-10-24");
  assert.match(selected.props.className, /\brange-start\b/); assert.match(selected.props.className, /\brange-end\b/);
  selected.props.onPointerEnter({ pointerType: "mouse" }); selected.props.onClick();
  assert.equal(state.openPicker.dateAnchor, null);
  state.updatePickerDate("2026-10-23");
  calendar().find(day => day.key === "2026-10-25").props.onPointerEnter({ pointerType: "mouse" });
  state.confirmSchedulePicker();
  assert.equal(calls[0].earliest_start_date, "2026-10-23"); assert.equal(calls[0].due_date, "2026-10-23");
});

test("range styles form a gapless translucent band with mirrored solid endpoints and a closed single-day node", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const rule = selector => css.slice(css.indexOf(selector), css.indexOf("}", css.indexOf(selector)) + 1);
  const prefix = ".schedule-picker-calendar .apple-date-grid button";
  assert.match(rule(`${prefix} {`), /width: 100%/);
  assert.match(rule(`${prefix}.in-range {`), /border-radius: 0; background: var\(--schedule-range-fill\)/);
  assert.match(rule(`${prefix}.selected {`), /background: var\(--schedule-range-node\); box-shadow: none/);
  assert.match(rule(`${prefix}.range-start {`), /border-radius: 19px 0 0 19px/);
  assert.match(rule(`${prefix}.range-end {`), /border-radius: 0 19px 19px 0/);
  assert.match(rule(`${prefix}.range-start.range-end {`), /width: 38px;.*border-radius: 19px/);
  assert.match(css, /--schedule-range-fill: rgb\(83 109 255 \/ 12%\)/);
  assert.match(css, /--schedule-range-fill: rgb\(113 133 255 \/ 18%\)/);
});

test("a completed range restarts as single-day on the next click and the same date twice stays single-day", () => {
  const { state } = picker();
  state.openSchedulePicker("start");
  state.updatePickerDate("2026-10-25");
  state.updatePickerDate("2026-10-24");
  assertDates(state, "2026-10-24", "2026-10-25");
  state.updatePickerDate("2026-11-02");
  assertDates(state, "2026-11-02");
  state.updatePickerDate("2026-11-02");
  assertDates(state, "2026-11-02");
  assert.equal(state.openPicker.dateAnchor, null);
});

test("one date click can be confirmed directly as a single-day task", () => {
  const { state, calls } = picker();
  state.openSchedulePicker("start");
  state.updatePickerDate("2026-11-02");
  state.confirmSchedulePicker();
  assert.equal(calls[0].earliest_start_date, "2026-11-02");
  assert.equal(calls[0].due_date, "2026-11-02");
  assert.equal(state.openPicker, null);
});

test("historical dates are selectable from any range but always replace it with one day", () => {
  for (const edge of ["start", "end"]) {
    const { state, calendar } = picker({ end: "2026-10-25" });
    state.openSchedulePicker(edge);
    for (const key of ["2026-10-21", "2026-10-20"]) {
      const date = calendar().find(day => day.key === key);
      assert.notEqual(date.props.disabled, true);
      assert.match(date.props.title, /历史日期仅支持单日/);
      date.props.onClick();
      assertDates(state, key);
      assert.equal(state.openPicker.dateAnchor, null);
    }
    state.updatePickerDate("2026-10-24");
    assertDates(state, "2026-10-24");
    state.updatePickerDate("2026-10-25");
    assertDates(state, "2026-10-24", "2026-10-25");
    state.updatePickerDate("2026-10-22");
    assertDates(state, "2026-10-22");
  }
});

test("future then historical click cannot form a cross-day range", () => {
  const { state } = picker();
  state.openSchedulePicker("start");
  state.updatePickerDate("2026-11-02");
  state.updatePickerDate("2026-10-21");
  assertDates(state, "2026-10-21");
  state.selectPickerField("end", true);
  state.updatePickerDate("2026-11-03");
  assertDates(state, "2026-11-03");
});

test("date cards edit the chosen boundary and sort crossing dates instead of discarding the other endpoint", () => {
  for (const edge of ["start", "end"]) {
    const { state } = picker({ start: "2026-10-24", end: "2026-11-02" });
    state.openSchedulePicker(edge);
    assert.equal(state.openPicker.activeField, edge);
    assert.equal(state.monthKey, edge === "start" ? "2026-10" : "2026-11");
    const card = state.renderBoundaryCard(edge, edge, edge === "start" ? "2026-10-24" : "2026-11-02");
    dateButton(card).props.onClick({ stopPropagation() {} });
    state.updatePickerDate(edge === "start" ? "2026-11-05" : "2026-10-23");
    if (edge === "start") assertDates(state, "2026-11-02", "2026-11-05");
    else assertDates(state, "2026-10-23", "2026-10-24");
    assert.equal(state.openPicker.dateAnchor, null);
  }
});

test("both date cards remain available for single-day tasks and can collapse a range to one day", () => {
  const { state } = picker({ end: "2026-10-25" });
  state.openSchedulePicker("start");
  state.selectPickerField("end", true);
  state.updatePickerDate("2026-10-23");
  assertDates(state, "2026-10-23");
  for (const edge of ["start", "end"]) assert.equal(dateButton(state.renderBoundaryCard(edge, edge, "2026-10-23")).type, "button");
});

test("time focus, typing, blur and rail changes never alter a pending first date or browsed month", () => {
  const { state } = picker();
  state.openSchedulePicker("start");
  state.updatePickerDate("2026-11-02");
  state.monthKey = "2026-12";
  for (const edge of ["start", "end"]) {
    timeInput(state.renderBoundaryCard(edge, edge, "2026-11-02")).props.onFocus({ currentTarget: { select() {} } });
    state.updatePickerTimeInput(edge, edge === "start" ? "0937" : "1045");
    state.commitPickerTimeInput(edge, edge === "start" ? "0937" : "1045");
    assert.equal(state.openPicker.dateAnchor, "2026-11-02");
    assert.equal(state.monthKey, "2026-12");
  }
  state.updatePickerRange({ start: "09:45", end: "11:00" });
  state.updatePickerDate("2026-10-24");
  assertDates(state, "2026-10-24", "2026-11-02");
});

test("end blur and a batched start-card click retain both the normalized time and date anchor", () => {
  const { state, batch } = picker({ end: "2026-10-25" });
  state.openSchedulePicker("end");
  const input = timeInput(state.renderBoundaryCard("end", "结束", "2026-10-25"));
  const card = state.renderBoundaryCard("start", "开始", "2026-10-23");
  batch(() => { input.props.onBlur({ currentTarget: { value: "1037" } }); card.props.onClick(); });
  assert.equal(state.openPicker.due_time, "10:37");
  assert.equal(state.openPicker.activeField, "start");
  assert.equal(state.openPicker.dateAnchor, "2026-10-25");
  state.updatePickerDate("2026-10-24");
  assertDates(state, "2026-10-24", "2026-10-25");
});

test("batched consecutive date selections use the latest pending anchor", () => {
  const { state, batch } = picker();
  state.openSchedulePicker("start");
  batch(() => { state.updatePickerDate("2026-11-02"); state.updatePickerDate("2026-10-24"); });
  assertDates(state, "2026-10-24", "2026-11-02");
});

test("dialog focus runs only on open, not when dates or time fields change", () => {
  const { state, calls, effects } = picker();
  effects(); state.openSchedulePicker("end"); effects();
  for (const edge of ["start", "end", "start"]) {
    let selected = false;
    timeInput(state.renderBoundaryCard(edge, edge, "2026-10-23")).props.onFocus({ currentTarget: { select() { selected = true; } } });
    state.updatePickerDate("2026-10-24"); effects();
    assert.equal(selected, true);
  }
  assert.deepEqual(calls, ["dialog-focus"]);
  state.closeSchedulePicker(); effects(); state.openSchedulePicker("start"); effects();
  assert.deepEqual(calls, ["dialog-focus", "dialog-focus"]);
});

test("confirmation rechecks Shanghai midnight while unchanged legacy historical ranges remain editable", () => {
  const current = picker({ end: "2026-10-25" });
  current.state.openSchedulePicker("start"); current.today("2026-10-24"); current.state.confirmSchedulePicker();
  assert.equal(current.calls.length, 0);
  assert.equal(current.state.todayDate, "2026-10-24");
  const legacy = picker({ start: "2026-10-20", end: "2026-10-25", existing: true });
  legacy.state.openSchedulePicker("end"); legacy.state.commitPickerTimeInput("end", "1100"); legacy.state.confirmSchedulePicker();
  assert.equal(legacy.calls[0].due_time, "11:00");
  assert.equal(legacy.calls[0].earliest_start_date, "2026-10-20");
});

test("an anchor crossing midnight starts fresh and cannot silently extend into history", () => {
  const { state, today, calls } = picker();
  state.openSchedulePicker("start"); state.updatePickerDate("2026-10-23"); today("2026-10-24");
  state.updatePickerDate("2026-10-25");
  assertDates(state, "2026-10-25");
  state.confirmSchedulePicker();
  assert.equal(calls[0].due_date, "2026-10-25");
});

test("a single day crossing midnight remains valid historical backfill", () => {
  const { state, today, calls } = picker();
  state.openSchedulePicker("start"); state.updatePickerDate("2026-10-23"); today("2026-10-24"); state.confirmSchedulePicker();
  assert.equal(calls[0].earliest_start_date, "2026-10-23");
  assert.equal(calls[0].due_date, "2026-10-23");
});

test("reset restores original dates and month, clears the pending anchor; cancel and clear retain their semantics", () => {
  const { state, calls } = picker({ end: "2026-11-02" });
  state.openSchedulePicker("end"); state.updatePickerDate("2026-12-10"); state.resetSchedulePicker();
  assertDates(state, "2026-10-23", "2026-11-02");
  assert.equal(state.monthKey, "2026-11");
  assert.equal(state.openPicker.dateAnchor, null);
  state.updatePickerDate("2026-10-24"); assertDates(state, "2026-10-24");
  state.closeSchedulePicker(); assert.equal(calls.length, 0);
  state.openSchedulePicker("end"); state.clearSchedulePicker();
  assert.equal(calls[0].earliest_start_date, ""); assert.equal(calls[0].due_date, ""); assert.equal(state.openPicker, null);
});

test("reopening discards an unconfirmed pending anchor", () => {
  const { state } = picker();
  state.openSchedulePicker("start"); state.updatePickerDate("2026-11-02"); state.closeSchedulePicker();
  state.openSchedulePicker("end"); state.updatePickerDate("2026-10-24");
  assertDates(state, "2026-10-24");
});

test("confirmation cannot save stale times while the visible input is invalid", () => {
  for (const edge of ["start", "end"]) for (const value of ["", "25:00", "09:"]) {
    const { state, calls } = picker();
    state.openSchedulePicker(edge); state.updatePickerTimeInput(edge, value); state.confirmSchedulePicker();
    assert.equal(calls.length, 0, `${edge}/${value}`); assert.ok(state.openPicker);
  }
});

test("historical single-day confirmation accepts minute precision and rejects invalid durations", () => {
  for (const end of ["0914", "0915", "0900", "0859"]) {
    const { state, calls } = picker();
    state.openSchedulePicker("end"); state.updatePickerDate("2026-10-21"); state.updatePickerTimeInput("end", end); state.confirmSchedulePicker();
    assert.equal(calls.length, end === "0915" ? 1 : 0);
    if (calls.length) {
      assert.equal(calls[0].earliest_start_date, "2026-10-21"); assert.equal(calls[0].due_date, "2026-10-21"); assert.equal(calls[0].due_time, "09:15");
    }
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
    assert.equal(form.estimated_minutes, 60); assert.equal(taskRangeIsValid(form), true);
    assert.ok(new Date(`${form.earliest_start_date}T${form.earliest_start_time}:00+08:00`) > now);
  }
});
