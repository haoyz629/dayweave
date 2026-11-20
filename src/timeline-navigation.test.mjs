import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
let centerEffect;
function collect(node) {
  if (ts.isFunctionDeclaration(node) && ["calendarCells", "returnToday", "selectCalendarDate", "openTimelineDate", "moveMonth", "pauseTimelineFollowing", "shanghaiClockParts", "shanghaiDateValue", "shiftDateValue", "weekDateValues", "requestDateSelection", "refreshSchedule"].includes(node.name?.text)) functions.set(node.name.text, node.getText(source));
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect") {
    const effect = node.arguments[0]?.getText(source);
    if (effect?.includes("const enteringDate = timelineEntryDateRef.current === selectedDate")) centerEffect = effect;
  }
  ts.forEachChild(node, collect);
}
collect(source);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(overrides = {}) {
  const calls = [], frames = new Map();
  let frameId = 0;
  const scroller = {
    scrollTop: 350, clientHeight: 480, scrollHeight: 1768,
    getBoundingClientRect() { return { top: 100 }; },
    querySelector(selector) {
      assert.equal(selector, ".hourly-timeline", "entry must not require today's current-time line");
      return { getBoundingClientRect() { return { top: 100 + 14 - scroller.scrollTop }; } };
    },
    scrollTo(options) { calls.push({ ...options }); scroller.scrollTop = options.top; }
  };
  const state = {
    today: "2026-10-21", todayMonthKey: "2026-10", selectedDate: "2026-10-21", monthKey: "2026-10", todayView: "month",
    visible: true, loading: false, error: null, followingNow: false, timelineReturnContext: null,
    planPreview: null,
    axisStart: 0, pixelsPerHour: 72, nowMinute: 15 * 60,
    timelineEntryDateRef: { current: null }, timelineCenteredDateRef: { current: "2026-10-21" },
    timelineScrollRef: { current: scroller },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : ["2026-10-21T15:00:00+08:00"])); } },
    window: {
      requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
      cancelAnimationFrame(id) { frames.delete(id); },
      matchMedia() { return { matches: false }; }
    },
    onSelectDate(date) { state.selectedDate = date; return true; },
    ...overrides
  };
  for (const key of ["todayView", "monthKey", "monthSelectionPending", "followingNow", "selectedDate", "scheduleLoading", "pendingPlanLeave"]) state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = value; };
  state.setClock = value => {
    state.clock = value;
    const { hour, minute } = state.shanghaiClockParts(value);
    state.nowMinute = hour * 60 + minute;
  };
  const context = vm.createContext(state);
  for (const code of functions.values()) vm.runInContext(compile(code), context);
  const effect = vm.runInContext(compile(`(${centerEffect})`), context);
  return { state, calls, scroller, effect, flush() { const ready = [...frames.values()]; frames.clear(); ready.forEach(fn => fn()); } };
}

test("month double-click and keyboard entry share the current-time positioning handler while single-click selects", () => {
  assert.match(text, /onClick=\{\(\) => selectCalendarDate\(cell\.key, true\)\}/);
  assert.match(text, /onDoubleClick=\{\(\) => openTimelineDate\(cell\.key\)\}/);
  assert.match(text, /event\.key === "Enter"\) \{ event\.preventDefault\(\); openTimelineDate\(cell\.key\)/);
  assert.doesNotMatch(text, /calendar-date-open-hint|双击日期查看当天日程/);
  for (const date of ["2026-10-20", "2026-10-21", "2026-10-22", "2026-11-01"]) {
    const current = harness();
    current.state.openTimelineDate(date);
    assert.equal(current.state.todayView, "timeline");
    assert.equal(current.state.timelineEntryDateRef.current, date);
    assert.equal(current.state.followingNow, date === current.state.today);
    assert.equal(current.state.monthKey, date.slice(0, 7));
    assert.equal(current.state.clock.toISOString(), "2026-10-21T07:00:00.000Z");
    current.effect(); current.flush();
    assert.deepEqual(current.calls, [{ top: 854, behavior: "auto" }]);
    assert.equal(current.state.timelineEntryDateRef.current, null);
  }
});

test("month date pointer selection preserves focus without scrolling the document", () => {
  assert.match(text, /onPointerDown=\{\(event\) => \{ event\.preventDefault\(\); event\.currentTarget\.focus\(\{ preventScroll: true \}\); \}\}/);
  assert.match(text, /onClick=\{\(\) => selectCalendarDate\(cell\.key, true\)\}/);
  assert.match(text, /onDoubleClick=\{\(\) => openTimelineDate\(cell\.key\)\}/);
});

test("adjacent-month clicks keep date cells stationary until the requested timeline opens", () => {
  for (const [monthKey, date] of [["2026-11", "2026-10-29"], ["2026-11", "2026-12-01"], ["2027-01", "2026-12-31"]]) {
    const { state } = harness({ monthKey, monthSelectionPending: true });
    const cells = state.calendarCells(monthKey);
    const index = cells.findIndex(cell => cell.key === date);
    assert.ok(index >= 0);
    for (let click = 0; click < 2; click++) {
      assert.equal(state.selectCalendarDate(date, true), true);
      assert.equal(state.selectedDate, date);
      assert.equal(state.monthKey, monthKey);
      assert.equal(state.monthSelectionPending, false);
      assert.equal(state.todayView, "month");
      assert.equal(state.calendarCells(state.monthKey)[index].key, date);
    }
    state.openTimelineDate(date);
    assert.equal(state.selectedDate, date);
    assert.equal(state.monthKey, date.slice(0, 7));
    assert.equal(state.todayView, "timeline");
    assert.equal(state.timelineEntryDateRef.current, date);
  }
});

test("return today and timeline navigation still synchronize months; rejected clicks change nothing", () => {
  const { state } = harness({ monthKey: "2026-11", selectedDate: "2026-10-29" });
  state.returnToday();
  assert.equal(state.selectedDate, state.today);
  assert.equal(state.monthKey, state.todayMonthKey);
  state.todayView = "timeline";
  state.selectCalendarDate("2026-12-01");
  assert.equal(state.monthKey, "2026-12");
  const denied = harness({ monthKey: "2026-11", monthSelectionPending: true, onSelectDate() { return false; } });
  assert.equal(denied.state.selectCalendarDate("2026-10-29", true), false);
  assert.equal(denied.state.monthKey, "2026-11");
  assert.equal(denied.state.monthSelectionPending, true);
  assert.equal(denied.state.selectedDate, "2026-10-21");
});

test("only adjacent-month date numbers include an explicit month prefix", () => {
  let dateNumber;
  function find(node) {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(source) === "className" && attr.initializer?.getText(source) === '"solar-day-number"')) dateNumber = node;
    ts.forEachChild(node, find);
  }
  find(source);
  assert.ok(dateNumber);
  const context = vm.createContext({ React });
  vm.runInContext(ts.transpileModule(`function renderDate(cell) { return (${dateNumber.getText(source)}); }`, { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText, context);
  for (const [key, inMonth, expected] of [["2026-10-29", false, "10月29"], ["2026-12-01", false, "12月1"], ["2026-11-01", true, "1"]]) {
    const html = renderToStaticMarkup(context.renderDate({ key, day: Number(key.slice(8)), inMonth }));
    assert.equal(html.replace(/<[^>]+>/g, ""), expected);
    assert.equal(html.includes('class="calendar-month-prefix"'), !inMonth);
  }
});

test("re-entering the same day recenters after a previous manual scroll", () => {
  const current = harness();
  current.state.openTimelineDate(current.state.today);
  current.effect(); current.flush();
  current.state.pauseTimelineFollowing();
  current.scroller.scrollTop = 30;
  current.effect(); current.flush();
  assert.equal(current.calls.length, 1);
  current.state.todayView = "month";
  current.state.openTimelineDate(current.state.today);
  current.effect(); current.flush();
  assert.deepEqual(current.calls, [{ top: 854, behavior: "auto" }, { top: 854, behavior: "auto" }]);
});

test("entry waits for the requested date, loading and visible timeline before consuming its position", () => {
  for (const flags of [{ loading: true }, { error: "offline" }, { visible: false }, { todayView: "month" }]) {
    const current = harness();
    current.state.openTimelineDate("2026-10-22");
    Object.assign(current.state, flags);
    current.effect(); current.flush();
    assert.deepEqual(current.calls, []);
    assert.equal(current.state.timelineEntryDateRef.current, "2026-10-22");
    Object.assign(current.state, { loading: false, error: null, visible: true, todayView: "timeline" });
    current.effect(); current.flush();
    assert.equal(current.calls.length, 1);
  }
  const current = harness({ onSelectDate() { return true; } });
  current.state.openTimelineDate("2026-10-22");
  current.effect(); current.flush();
  assert.equal(current.calls.length, 0);
  current.state.selectedDate = "2026-10-22";
  current.effect(); current.flush();
  assert.equal(current.calls.length, 1);
});

test("non-today dates only center once, while today retains clock following and reduced-motion support", () => {
  const other = harness();
  other.state.openTimelineDate("2026-10-22");
  other.effect(); other.flush();
  other.scroller.scrollTop = 20;
  other.state.nowMinute++;
  other.effect(); other.flush();
  assert.equal(other.calls.length, 1);
  const today = harness();
  today.state.openTimelineDate(today.state.today);
  today.effect(); today.flush();
  today.state.nowMinute++;
  today.effect(); today.flush();
  assert.deepEqual(today.calls[1], { top: 855.2, behavior: "smooth" });
  today.state.window.matchMedia = () => ({ matches: true });
  today.state.nowMinute++;
  today.effect(); today.flush();
  assert.equal(today.calls[2].behavior, "auto");
});

test("manual input, a task-specific destination and effect cleanup cancel pending entry positioning", () => {
  const manual = harness();
  manual.state.openTimelineDate("2026-10-22");
  manual.effect();
  manual.state.pauseTimelineFollowing(); manual.flush();
  assert.deepEqual(manual.calls, []);
  const target = harness({ timelineReturnContext: { date: "2026-10-21", blockId: "target" } });
  target.state.openTimelineDate(target.state.today);
  target.effect(); target.flush();
  assert.deepEqual(target.calls, []);
  assert.equal(target.state.timelineEntryDateRef.current, null);
  const cancelled = harness();
  cancelled.state.openTimelineDate("2026-10-22");
  cancelled.effect()(); cancelled.flush();
  assert.deepEqual(cancelled.calls, []);
});

test("midnight and late-night positions clamp to scroll bounds; rejected navigation does not scroll", () => {
  for (const [minute, expected] of [[0, 0], [1439, 1288]]) {
    const current = harness();
    current.state.openTimelineDate("2026-10-22");
    current.state.nowMinute = minute;
    current.effect(); current.flush();
    assert.equal(current.calls[0].top, expected);
  }
  const denied = harness({ onSelectDate() { return false; } });
  denied.state.openTimelineDate("2026-10-22");
  assert.equal(denied.state.todayView, "month");
  assert.equal(denied.state.timelineEntryDateRef.current, null);
  denied.effect(); denied.flush();
  assert.deepEqual(denied.calls, []);
});

test("month has no wheel pagination listener or misleading wheel hint", () => {
  assert.doesNotMatch(text, /handleMonthWheel|monthWheelGestureRef|monthSheetRef|滚轮切换月份/);
  assert.match(text, /<section className="month-sheet today-month-sheet" aria-label="月历">/);
});

test("month buttons cross year boundaries without selecting a date", () => {
  const { state } = harness({ monthKey: "2026-12" });
  state.moveMonth(1);
  assert.equal(state.monthKey, "2027-01");
  assert.equal(state.selectedDate, "2026-10-21");
  assert.equal(state.monthSelectionPending, true);
  state.moveMonth(-1);
  assert.equal(state.monthKey, "2026-12");
  state.monthKey = "2027-01";
  state.moveMonth(-1);
  assert.equal(state.monthKey, "2026-12");
  state.monthKey = "2026-11";
  state.moveMonth(-1);
  assert.equal(state.monthKey, "2026-10");
  assert.equal(state.monthSelectionPending, false);
});

test("day arrows cross weeks, months and years through the guarded selection entry without changing today", () => {
  for (const [start, offset, expected] of [["2026-10-31", 1, "2026-11-01"], ["2026-11-01", 1, "2026-11-02"], ["2026-12-31", 1, "2027-01-01"], ["2027-01-01", -1, "2026-12-31"]]) {
    const { state } = harness({ selectedDate: start, monthKey: start.slice(0, 7), todayView: "timeline" });
    state.onSelectDate = state.requestDateSelection;
    assert.equal(state.selectCalendarDate(state.shiftDateValue(state.selectedDate, offset)), true);
    assert.equal(state.selectedDate, expected);
    assert.equal(state.monthKey, expected.slice(0, 7));
    assert.equal(state.scheduleLoading, true);
    assert.ok(state.weekDateValues(state.selectedDate).includes(expected));
    assert.equal(state.today, "2026-10-21");
    state.returnToday();
    assert.equal(state.selectedDate, state.today);
    assert.equal(state.monthKey, state.todayMonthKey);
    assert.equal(state.todayView, "timeline");
  }
});

test("draft protection rejects both day arrows and return-today without changing date or month", () => {
  for (const action of [state => state.selectCalendarDate(state.shiftDateValue(state.selectedDate, 1)), state => state.returnToday()]) {
    const { state } = harness({ selectedDate: "2026-10-31", monthKey: "2026-10", monthSelectionPending: true, scheduleLoading: false, planPreview: { plan_date: "2026-10-31" } });
    state.onSelectDate = state.requestDateSelection;
    action(state);
    assert.equal(state.selectedDate, "2026-10-31");
    assert.equal(state.monthKey, "2026-10");
    assert.equal(state.monthSelectionPending, true);
    assert.equal(state.scheduleLoading, false);
    assert.equal(state.pendingPlanLeave.kind, "date");
    assert.ok(["2026-11-01", state.today].includes(state.pendingPlanLeave.date));
  }
});

test("late schedules and stale failures cannot overwrite the newly selected day's content", async () => {
  const pending = new Map(), calls = [];
  const state = {
    selectedDate: "2026-10-31", selectedDateRef: { current: "2026-10-31" },
    getDaySchedule(date) { calls.push(date); return new Promise((resolve, reject) => pending.set(date, { resolve, reject })); },
    getRulePlanDraft(date) { return { plan_date: date }; },
    listRecurringOccurrences(date) { return [date]; },
    uiErrorMessage(reason) { return reason.message; }
  };
  for (const key of ["scheduleLoading", "scheduleError", "daySchedule", "planPreview", "recurringOccurrences"]) state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = value; };
  const context = vm.createContext(state);
  vm.runInContext(compile(functions.get("refreshSchedule")), context);
  const oldRequest = state.refreshSchedule("2026-10-31");
  const staleFailure = state.refreshSchedule("2026-10-30");
  state.selectedDateRef.current = "2026-11-01";
  const newRequest = state.refreshSchedule("2026-11-01");
  pending.get("2026-11-01").resolve({ date: "2026-11-01" });
  await newRequest;
  pending.get("2026-10-31").resolve({ date: "2026-10-31" });
  pending.get("2026-10-30").reject(new Error("stale failure"));
  await Promise.all([oldRequest, staleFailure]);
  assert.deepEqual(calls, ["2026-10-31", "2026-10-30", "2026-11-01"]);
  assert.equal(state.daySchedule.date, "2026-11-01");
  assert.equal(state.planPreview.plan_date, "2026-11-01");
  assert.deepEqual(state.recurringOccurrences, ["2026-11-01"]);
  assert.equal(state.scheduleError, null);
  assert.equal(state.scheduleLoading, false);
});
