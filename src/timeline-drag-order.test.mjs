import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { timelineLaneLayout as calculateTimelineLanes } from "./timeline-lane-layout.ts";

const text = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["timelineLaneLayout", "planDraftLayoutKeys", "clearTimelineDrag", "cancelTimelineDrag", "cancelRecurringChange", "finishTimelineDrag", "commitTimelineRecurringChange"];
const functions = new Map();
function collect(node) {
  if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) functions.set(node.name.text, node.getText(source));
  ts.forEachChild(node, collect);
}
collect(source);
for (const name of names) assert.ok(functions.has(name), `exercise the real ${name} handler`);
const code = ts.transpileModule([...functions.values()].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const date = "2026-11-03";
const stamp = minute => `${date}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00+08:00`;

function harness({ draft = false, recurring = false, fail = false } = {}) {
  const calls = [];
  const block = { id: "moving", task_id: "task", starts_at: stamp(300), ends_at: stamp(360), estimated_minutes: 60 };
  const target = { layoutKey: "block:target", starts_at: stamp(600), ends_at: stamp(720) };
  const state = {
    calculateTimelineLanes, selectedDate: date, timelineItems: [], tasks: [{ id: "task" }],
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
      state.timelineItems = [{ ...savedBlock, layoutKey: "block:moving", starts_at, ends_at }, target];
      assertLast(); // Keep the preview stable until the save finishes.
    },
    async onUpdatePlan(preview) {
      calls.push(["draft"]);
      if (fail) throw new Error("save failed");
      const key = state.planDraftLayoutKeys(preview.blocks)[0];
      state.timelineItems = [{ ...preview.blocks[0], layoutKey: key }, target];
      assertChronological(key); // A changed draft key must not retain the drag priority.
    },
    async updateRecurringOccurrence() {
      calls.push(["recurring"]);
      if (fail) throw new Error("save failed");
      state.timelineItems = [{ ...block, layoutKey: "recurring:occurrence", starts_at: stamp(570), ends_at: stamp(630) }, target];
    }
  };
  for (const key of ["timelineDrag", "savingDraggedBlock", "timelineTooltip", "pendingRecurringChange", "savingRecurringChange", "recurringChangeError"]) {
    state[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = value; };
  }
  vm.runInContext(code, vm.createContext(state));
  const key = recurring ? "recurring:occurrence" : draft ? state.planDraftLayoutKeys([block])[0] : "block:moving";
  state.timelineItems = [{ ...block, layoutKey: key }, target];
  state.timelineDrag = { key, start: 570, end: 630, x: 0, y: 0 };
  state.timelineDragRef.current = {
    key, block, draftIndex: draft ? 0 : null, preview: draft ? { blocks: [block] } : null,
    pointerId: 1, originalStart: 300, duration: 60, start: 570, active: true,
    element: { hasPointerCapture: () => false, isConnected: false, querySelector: () => null },
    occurrence: recurring ? { id: "occurrence" } : undefined
  };
  function layout() {
    return state.timelineLaneLayout(state.timelineItems, date, state.timelineDrag);
  }
  function assertLast() {
    assert.equal(layout()["block:target"].column, 0);
    assert.equal(layout()[key].column, 1);
  }
  function assertChronological(movingKey = key) {
    assert.equal(layout()[movingKey].column, 0);
    assert.equal(layout()["block:target"].column, 1);
  }
  return { state, calls, key, layout, assertLast, assertChronological };
}

test("real drag save keeps the preview last but restores time order after saving", async () => {
  const current = harness();
  current.assertLast();
  await current.state.finishTimelineDrag({ pointerId: 1 });
  current.assertChronological();
  assert.equal(current.state.timelineDrag, null);
  assert.equal(current.state.savingDraggedBlock, false);
  assert.equal(current.state.timelineItems[0].starts_at, stamp(570));
  assert.deepEqual(current.calls, [["save", "moving"]]);
});

test("draft drag uses normal time order after its time-based layout key changes", async () => {
  const current = harness({ draft: true });
  current.assertLast();
  await current.state.finishTimelineDrag({ pointerId: 1 });
  const newKey = current.state.timelineItems[0].layoutKey;
  assert.notEqual(newKey, current.key);
  assert.equal(current.state.timelineDrag, null);
  current.assertChronological(newKey);
  assert.deepEqual(current.calls, [["draft"]]);
});

test("failed ordinary and draft saves restore the original schedule and release preview priority", async () => {
  for (const draft of [false, true]) {
    const current = harness({ draft, fail: true });
    await current.state.finishTimelineDrag({ pointerId: 1 });
    assert.equal(current.state.timelineItems[0].starts_at, stamp(300));
    assert.equal(current.state.timelineDrag, null);
    assert.equal(current.state.savingDraggedBlock, false);
    assert.equal(current.layout()[current.key].total, 1);
    assert.equal(current.layout()["block:target"].total, 1);
    assert.ok(current.calls.some(([type, title]) => type === "notify" && title === "时间未保存"));
  }
});

test("cancellation and a no-op drop clear preview priority without saving", async () => {
  const cancelled = harness();
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

test("recurring drag returns to time order when scope confirmation succeeds", async () => {
  const current = harness({ recurring: true });
  await current.state.finishTimelineDrag({ pointerId: 1 });
  assert.ok(current.state.pendingRecurringChange);
  current.assertLast();
  await current.state.commitTimelineRecurringChange("this");
  assert.equal(current.state.timelineDrag, null);
  assert.equal(current.state.pendingRecurringChange, null);
  current.assertChronological();
  assert.deepEqual(current.calls.map(([type]) => type), ["recurring", "refresh", "notify"]);
});

test("cancelled or failed recurring confirmation preserves the original schedule", async () => {
  for (const fail of [false, true]) {
    const pending = harness({ recurring: true, fail });
    await pending.state.finishTimelineDrag({ pointerId: 1 });
    if (fail) {
      await pending.state.commitTimelineRecurringChange("this");
      assert.ok(pending.state.pendingRecurringChange);
      assert.match(pending.state.recurringChangeError, /未保存/);
      pending.assertLast();
    }
    pending.state.cancelRecurringChange();
    assert.equal(pending.state.timelineDrag, null);
    assert.equal(pending.state.timelineItems[0].starts_at, stamp(300));
    assert.equal(pending.layout()[pending.key].total, 1);
  }
});
