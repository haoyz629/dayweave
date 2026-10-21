import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
let centerEffect;
function collect(node) {
  if (ts.isFunctionDeclaration(node) && ["selectCalendarDate", "openTimelineDate", "pauseTimelineFollowing", "shanghaiClockParts"].includes(node.name?.text)) functions.set(node.name.text, node.getText(source));
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("const enteringDate = timelineEntryDateRef.current === selectedDate")) centerEffect = node.arguments[0].getText(source);
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
    today: "2026-10-21", selectedDate: "2026-10-21", monthKey: "2026-10", todayView: "month",
    visible: true, loading: false, error: null, followingNow: false, timelineReturnContext: null,
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
  for (const key of ["todayView", "monthKey", "monthSelectionPending", "followingNow"]) state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = value; };
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

test("month double-click and keyboard entry share the current-time positioning handler", () => {
  assert.match(text, /onDoubleClick=\{\(\) => openTimelineDate\(cell\.key\)\}/);
  assert.match(text, /event\.key === "Enter"\) \{ event\.preventDefault\(\); openTimelineDate\(cell\.key\)/);
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
