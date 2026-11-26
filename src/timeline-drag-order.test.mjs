import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { dayTimelineLayout } from "./timeline-lane-layout.ts";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["timelineLaneLayout", "planDraftLayoutKeys", "clearTimelineDrag", "cancelTimelineDrag", "cancelRecurringChange", "finishTimelineDrag", "commitTimelineRecurringChange"];
names.push("rememberArrival");
const functions = new Map();
const layoutDeclarations = [];
function collect(node) {
  if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) functions.set(node.name.text, node.getText(source));
  if (ts.isVariableDeclaration(node) && ["arrivalKeys", "dragKey", "layoutDrag", "preferredKey", "dayLayout", "timelineItemLanes"].includes(node.name.getText(source))) {
    layoutDeclarations.push(`const ${node.getText(source)};`);
  }
  ts.forEachChild(node, collect);
}
collect(source);
for (const name of names) assert.ok(functions.has(name), `exercise the real ${name} handler`);
assert.equal(layoutDeclarations.length, 6);
const code = ts.transpileModule([
  ...functions.values(),
  `function currentTimelineLanes() { ${layoutDeclarations.join("\n")} return timelineItemLanes; }`
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const date = "2026-11-03";
const stamp = minute => `${date}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00+08:00`;

function harness({ draft = false, recurring = false, fail = false, initialOverlap = false, tie = false } = {}) {
  const calls = [];
  const initialStart = tie ? 540 : initialOverlap ? 540 : 300;
  const initialEnd = tie ? 600 : initialOverlap ? 660 : 360;
  const block = { id: "moving", task_id: "task", starts_at: stamp(initialStart), ends_at: stamp(initialEnd), estimated_minutes: initialEnd - initialStart };
  const target = { layoutKey: "block:target", starts_at: stamp(600), ends_at: stamp(tie ? 660 : 720) };
  const state = {
    dayTimelineLayout, selectedDate: date, timelineItems: [], tasks: [{ id: "task" }], arrivals: [], selection: null, laneCapacity: 5, revealedKey: null, savingLayoutKey: null,
    setArrivals(update) { state.arrivals = update(state.arrivals); },
    timelineCreateRange: null,
    timelineDragFrameRef: { current: 0 },
    timelineDragRef: { current: null }, timelineDragSavingRef: { current: false }, timelineDragClickRef: { current: null },
    timelineDrag: null, savingDraggedBlock: false, savingRecurringChange: false, pendingRecurringChange: null,
    timelineScrollRef: { current: { focus() {} } },
    timelineMinute: value => (Date.parse(value) - Date.parse(stamp(0))) / 60000,
    dragTimestamp: stamp, minutesClock: minute => stamp(minute).slice(11, 16),
    recurringInput: () => ({}), recurringChangeIssue: () => null, shanghaiDateValue: () => date,
    stageRecurringChange(change) { state.pendingRecurringChange = change; },
    window: { cancelAnimationFrame() {}, requestAnimationFrame(fn) { fn(); } },
    planDraftErrorMessage: String, uiErrorMessage: String,
    onNotify(...args) { calls.push(["notify", ...args]); },
    async onFactsChanged() { calls.push(["refresh"]); },
    async onSaveBlockTime(savedBlock, starts_at, ends_at) {
      calls.push(["save", savedBlock.id]);
      if (fail) throw new Error("save failed");
      assertInSourceLane(); // Preview must not cover the target while the save is pending.
      state.timelineItems = [{ ...savedBlock, layoutKey: "block:moving", starts_at, ends_at }, target];
      assertInSourceLane();
    },
    async onUpdatePlan(preview) {
      calls.push(["draft"]);
      if (fail) throw new Error("save failed");
      assertInSourceLane();
      const key = state.planDraftLayoutKeys(preview.blocks)[0];
      state.timelineItems = [{ ...preview.blocks[0], layoutKey: key }, target];
      assertInSourceLane(key);
    },
    async updateRecurringOccurrence() {
      calls.push(["recurring"]);
      if (fail) throw new Error("save failed");
      const newStart = state.timelineDrag?.start ?? 570;
      const newEnd = state.timelineDrag?.end ?? 630;
      state.timelineItems = [{ ...block, layoutKey: "recurring:occurrence", starts_at: stamp(newStart), ends_at: stamp(newEnd) }, target];
    }
  };
  for (const key of ["timelineDrag", "savingDraggedBlock", "timelineTooltip", "pendingRecurringChange", "savingRecurringChange", "recurringChangeError", "revealedKey", "savingLayoutKey"]) {
    state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = value; };
  }
  vm.runInContext(code, vm.createContext(state));
  const key = recurring ? "recurring:occurrence" : draft ? state.planDraftLayoutKeys([block])[0] : "block:moving";
  state.timelineItems = [{ ...block, layoutKey: key }, target];
  const sourceLane = { ...state.currentTimelineLanes()[key] };
  const dragStart = tie ? 600 : initialOverlap ? 630 : 570;
  const dragEnd = dragStart + (initialEnd - initialStart);
  state.timelineDrag = { key, start: dragStart, end: dragEnd, originalStart: initialStart, x: 0, y: 0 };
  state.timelineDragRef.current = {
    key, block, draftIndex: draft ? 0 : null, preview: draft ? { blocks: [block] } : null,
    pointerId: 1, originalStart: initialStart, duration: initialEnd - initialStart, start: dragStart, active: true,
    sourceLane,
    element: { hasPointerCapture: () => false, isConnected: false, querySelector: () => null },
    occurrence: recurring ? { id: "occurrence" } : undefined
  };
  function layout() {
    return state.currentTimelineLanes();
  }
  function assertInSourceLane(movingKey = key) {
    assert.equal(layout()[movingKey].column, 1, "preview uses the right column");
    assert.equal(layout()["block:target"].column, 0);
  }
  function assertChronological(movingKey = key) {
    if (initialOverlap || tie) {
      assert.equal(layout()["block:target"].column, 0);
      assert.equal(layout()[movingKey].column, 1);
    } else {
      assert.equal(layout()[movingKey].column, 0);
      assert.equal(layout()["block:target"].column, 1);
    }
  }
  return { state, calls, key, layout, assertInSourceLane, assertChronological };
}

test("dragging uses the target overlap group and restores chronological order after saving a partial overlap", async () => {
  for (const initialOverlap of [false, true]) {
    const current = harness({ initialOverlap });
    current.assertInSourceLane();
    await current.state.finishTimelineDrag({ pointerId: 1 });
    current.assertChronological();
    assert.equal(current.state.timelineDrag, null);
    assert.equal(current.state.savingDraggedBlock, false);
    assert.equal(current.state.timelineItems[0].starts_at, stamp(initialOverlap ? 630 : 570));
    assert.deepEqual(current.calls, [["save", "moving"]]);
  }
});

test("draft drag receives its updated time-based layout key after saving", async () => {
  const current = harness({ draft: true });
  current.assertInSourceLane();
  await current.state.finishTimelineDrag({ pointerId: 1 });
  const newKey = current.state.timelineItems[0].layoutKey;
  assert.notEqual(newKey, current.key);
  assert.equal(current.state.timelineDrag, null);
  current.assertChronological(newKey);
  assert.deepEqual(current.calls, [["draft"]]);
});

test("failed ordinary and draft saves restore the original schedule and lane", async () => {
  for (const draft of [false, true]) {
    const current = harness({ draft, fail: true });
    current.assertInSourceLane();
    await current.state.finishTimelineDrag({ pointerId: 1 });
    assert.equal(current.state.timelineItems[0].starts_at, stamp(300));
    assert.equal(current.state.timelineDrag, null);
    assert.equal(current.state.savingDraggedBlock, false);
    assert.equal(current.layout()[current.key].total, 1);
    assert.equal(current.layout()["block:target"].total, 1);
    assert.ok(current.calls.some(([type, title]) => type === "notify" && title === "时间未保存"));
  }
});

test("cancellation and a no-op drop keep the original lane without saving", async () => {
  const cancelled = harness();
  cancelled.assertInSourceLane();
  cancelled.state.cancelTimelineDrag();
  assert.equal(cancelled.state.timelineDrag, null);
  assert.equal(cancelled.layout()[cancelled.key].total, 1);
  assert.deepEqual(cancelled.calls, []);
  const unchanged = harness();
  unchanged.state.timelineDragRef.current.start = 300;
  await unchanged.state.finishTimelineDrag({ pointerId: 1 });
  assert.equal(unchanged.state.timelineDrag, null);
  assert.equal(unchanged.layout()[unchanged.key].total, 1);
  assert.deepEqual(unchanged.calls, []);
});

test("recurring drag stays in its current lane until scope confirmation succeeds", async () => {
  const current = harness({ recurring: true, initialOverlap: true });
  current.assertInSourceLane();
  await current.state.finishTimelineDrag({ pointerId: 1 });
  assert.ok(current.state.pendingRecurringChange);
  current.assertInSourceLane();
  await current.state.commitTimelineRecurringChange("this");
  assert.equal(current.state.timelineDrag, null);
  assert.equal(current.state.pendingRecurringChange, null);
  current.assertChronological();
  assert.deepEqual(current.calls.map(([type]) => type), ["recurring", "refresh", "notify"]);
});

test("cancelled or failed recurring confirmation preserves the original schedule and lane", async () => {
  for (const fail of [false, true]) {
    const pending = harness({ recurring: true, fail });
    await pending.state.finishTimelineDrag({ pointerId: 1 });
    if (fail) {
      await pending.state.commitTimelineRecurringChange("this");
      assert.ok(pending.state.pendingRecurringChange);
      assert.match(pending.state.recurringChangeError, /未保存/);
      pending.assertInSourceLane();
    }
    pending.state.cancelRecurringChange();
    assert.equal(pending.state.timelineDrag, null);
    assert.equal(pending.state.timelineItems[0].starts_at, stamp(300));
    assert.equal(pending.layout()[pending.key].total, 1);
  }
});

test("identical intervals retain their preview columns after successful ordinary, draft and recurring moves", async () => {
  for (const variant of [{}, {draft:true}, {recurring:true}]) {
    const h = harness({...variant, tie:true});
    const before = h.layout()[h.key];
    await h.state.finishTimelineDrag({pointerId:1});
    if (variant.recurring) await h.state.commitTimelineRecurringChange("this");
    assert.deepEqual(h.layout()[h.state.timelineItems[0].layoutKey], before);
    assert.equal(h.state.arrivals.length, 1);
  }
});
