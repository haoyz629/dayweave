import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { timelineLaneLayout as calculateTimelineLanes } from "./timeline-lane-layout.ts";

const declarations = [];
const initializers = new Map();
const handlers = new Map();
for (const file of ["App.tsx", "timeline-task-create.tsx"]) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = file === "App.tsx" ? ["timelineLaneLayout"] : ["selectedRange", "clearPointer", "clearRange", "cancelSelection", "snapAt", "updateSelection", "autoScroll", "open", "start", "updateTimes"];
  function collect(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) declarations.push(node.getText(source));
    if (ts.isVariableDeclaration(node) && ["timelineItems", "timelineItemLanes"].includes(node.name.getText(source))) {
      initializers.set(node.name.getText(source), node.initializer.getText(source));
    }
    if (file === "timeline-task-create.tsx" && ts.isJsxAttribute(node) && ["onPointerMove", "onPointerUp", "onKeyDown"].includes(node.name.getText(source))) {
      handlers.set(node.name.getText(source), node.initializer.expression.getText(source));
    }
    ts.forEachChild(node, collect);
  }
  collect(source);
}
assert.equal(declarations.length, 11, "execute the real layout and creation handlers");
assert.equal(initializers.size, 2);
assert.equal(handlers.size, 3);
const code = ts.transpileModule([
  ...declarations,
  `function currentLanes() { const timelineItems = ${initializers.get("timelineItems")}; return ${initializers.get("timelineItemLanes")}; }`,
  `function move(event) { return (${handlers.get("onPointerMove")})(event); }`,
  `function release(event) { return (${handlers.get("onPointerUp")})(event); }`,
  `function keyboard(event) { return (${handlers.get("onKeyDown")})(event); }`
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const clock = minute => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minute = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

function harness() {
  const captures = new Set();
  const track = {
    getBoundingClientRect: () => ({ top: 0 }),
    setPointerCapture: id => captures.add(id),
    hasPointerCapture: id => captures.has(id),
    releasePointerCapture: id => captures.delete(id)
  };
  const state = {
    calculateTimelineLanes, clock, minute, selectedDate: "2026-11-03", disabled: false, pixelsPerHour: 60,
    timelineMinute: timestamp => minute(timestamp.slice(11, 16)),
    planTimestamp: (date, time) => `${date}T${time}:00+08:00`, minutesClock: clock,
    timedEvents: [], draftBlocks: [], draftLayoutKeys: [], recurringTimelineBlocks: [],
    visibleTaskBlocks: [{ id: "target", starts_at: "2026-11-03T10:00:00+08:00", ends_at: "2026-11-03T12:00:00+08:00" }],
    timelineDrag: null, timelineCreateRange: null, form: null,
    trackRef: { current: track }, pointer: { current: null }, rangeRef: { current: null }, frame: { current: 0 },
    scrollRef: { current: { getBoundingClientRect: () => ({ top: 510, bottom: 900 }), scrollTop: 0 } },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, onStart() {},
    onRange(range) { state.timelineCreateRange = range; },
    setForm(form) { state.form = form; }, setError(error) { state.error = error; }
  };
  vm.runInContext(code, vm.createContext(state));
  const event = y => ({ button: 0, isPrimary: true, pointerId: 1, clientY: y, currentTarget: track, preventDefault() {}, stopPropagation() {} });
  return { state, track, event };
}

function assertRightmost(state) {
  const lanes = state.currentLanes();
  assert.equal(lanes["block:target"].column, 0);
  assert.equal(lanes["create:selection"].column, 1);
}

test("slide-to-create stays rightmost while selecting across a neighbour's start in both directions", () => {
  const { state, event } = harness();
  state.start(event(660));
  for (const y of [690, 660, 630, 600, 570, 540, 570, 600, 630, 660, 690]) {
    state.pointer.current.y = y;
    state.updateSelection();
    if (y === 660) {
      assert.equal(state.timelineCreateRange, null);
      assert.equal(state.currentLanes()["create:selection"], undefined);
    } else {
      assert.equal(state.timelineCreateRange.dragging, true);
      assertRightmost(state);
    }
  }
});

test("pointer release opens the form and restores normal chronological columns", () => {
  const { state, event } = harness();
  state.start(event(660));
  state.pointer.current.y = 570;
  state.updateSelection();
  assertRightmost(state);
  state.release(event(570));
  assert.equal(state.pointer.current, null);
  assert.equal(state.timelineCreateRange.dragging, undefined);
  assert.equal(state.form.start, "09:30");
  assert.equal(state.form.end, "11:00");
  const lanes = state.currentLanes();
  assert.equal(lanes["create:selection"].column, 0);
  assert.equal(lanes["block:target"].column, 1);
  state.updateTimes("start", "09:15");
  assert.equal(state.timelineCreateRange.dragging, undefined);
  assert.equal(state.currentLanes()["create:selection"].column, 0);
});

test("cancellation and a lost pointer capture remove the selection without opening a form", () => {
  for (const lostCapture of [false, true]) {
    const { state, track, event } = harness();
    state.start(event(660));
    if (lostCapture) {
      track.releasePointerCapture(1);
      state.release(event(660));
    } else state.cancelSelection();
    assert.equal(state.timelineCreateRange, null);
    assert.equal(state.pointer.current, null);
    assert.equal(state.form, null);
    assert.equal(state.currentLanes()["block:target"].total, 1);
    assert.equal(state.currentLanes()["create:selection"], undefined);
  }
});

test("keyboard creation does not acquire sliding priority", () => {
  const { state, event } = harness();
  state.keyboard({ ...event(0), key: "Enter" });
  assert.ok(state.form);
  assert.equal(state.timelineCreateRange.dragging, undefined);
  assert.equal(state.pointer.current, null);
});

test("a real block drag still takes precedence over the slide-to-create preview", () => {
  const { state, event } = harness();
  state.start(event(660));
  state.timelineDrag = { key: "block:target", start: 660, end: 720 };
  const lanes = state.currentLanes();
  assert.equal(lanes["create:selection"].column, 0);
  assert.equal(lanes["block:target"].column, 1);
});

test("sliding back into the anchor snap interval clears the preview and cancels on release", () => {
  for (const destination of [570, 750]) {
    for (const origin of [654, 660, 666]) {
      const { state, track, event } = harness();
      state.start(event(660));
      state.move(event(destination));
      assert.ok(state.timelineCreateRange);
      state.move(event(origin));
      assert.equal(state.timelineCreateRange, null);
      assert.equal(state.rangeRef.current, null);
      assert.equal(state.currentLanes()["block:target"].total, 1);
      state.release(event(origin));
      assert.equal(state.form, null);
      assert.equal(state.pointer.current, null);
      assert.equal(track.hasPointerCapture(1), false);
    }
  }
});

test("release uses its own coordinates even without a final pointer-move event", () => {
  const { state, event } = harness();
  state.start(event(660));
  state.move(event(750));
  state.release(event(660));
  assert.equal(state.form, null);
  assert.equal(state.timelineCreateRange, null);

  state.start(event(660));
  state.release(event(690));
  assert.equal(state.form.start, "11:00");
  assert.equal(state.form.end, "11:30");
});

test("selection can resume across the origin before releasing", () => {
  const { state, event } = harness();
  state.start(event(660));
  state.move(event(750));
  state.move(event(660));
  assert.equal(state.timelineCreateRange, null);
  state.move(event(570));
  assertRightmost(state);
  state.release(event(570));
  assert.equal(state.form.start, "09:30");
  assert.equal(state.form.end, "11:00");
});

test("clicks and sub-snap pointer jitter still create the existing fifteen-minute task", () => {
  for (const y of [654, 660, 666]) {
    const { state, event } = harness();
    state.start(event(660));
    state.move(event(y));
    state.release(event(y));
    assert.equal(state.form.start, "11:00");
    assert.equal(state.form.end, "11:15");
  }
});

test("return-to-origin cancellation also works at the day boundaries", () => {
  for (const [anchor, destination] of [[0, 30], [1440, 1410]]) {
    const { state, event } = harness();
    state.start(event(anchor));
    state.move(event(destination));
    state.release(event(anchor));
    assert.equal(state.timelineCreateRange, null);
    assert.equal(state.form, null);
  }
});

test("returning to the anchor after scrolling compares timeline time, not the initial screen coordinate", () => {
  const { state, track, event } = harness();
  state.start(event(660));
  track.getBoundingClientRect = () => ({ top: -60 });
  state.move(event(660));
  assert.equal(state.timelineCreateRange.end, 720);
  state.move(event(600));
  assert.equal(state.timelineCreateRange, null);
  state.release(event(600));
  assert.equal(state.form, null);
});
