import assert from "node:assert/strict";
import test from "node:test";
import { dayTimelineLayout } from "./timeline-lane-layout.ts";

const item = (layoutKey, startMinute, endMinute) => ({layoutKey, startMinute, endMinute});
const interval = [600, 630];
const five = ["A", "B", "C", "D", "E"].map(key => item(key, ...interval));

test("arrived exact-time blocks keep the same final column used during drag preview", () => {
  const preview = dayTimelineLayout(five, item("E", ...interval), [], 8, null);
  const released = dayTimelineLayout(five, null, ["E"], 8, null);
  assert.deepEqual(preview.lanes.E, released.lanes.E);
  assert.equal(released.lanes.E.column, 4);
  assert.deepEqual(Object.keys(released.lanes), ["A", "B", "C", "D", "E"]);
  const previewDense = dayTimelineLayout(five, item("E", ...interval), [], 3, null);
  const releasedDense = dayTimelineLayout(five, null, ["E"], 3, null);
  assert.deepEqual(previewDense.lanes.E, releasedDense.lanes.E);
  assert.equal(releasedDense.lanes.E.column, 2);
});

test("overlap preview moves the active block to the right without changing other times", () => {
  const items = [item("a", 600, 720), item("b", 630, 690), item("c", 690, 750)];
  const layout = dayTimelineLayout(items, item("c", 615, 675), [], 8, null).lanes;
  assert.ok(layout.c.column > layout.a.column);
  assert.ok(layout.c.column > layout.b.column);
  assert.equal(layout.a.column, 0);
  assert.equal(layout.b.column, 1);
});

test("chain overlaps reuse columns at touching endpoints rather than counting the whole connected group", () => {
  const layout = dayTimelineLayout([item("a", 600, 630), item("b", 615, 645), item("c", 630, 660)], null, [], 8, null).lanes;
  assert.equal(layout.a.total, 2);
  assert.equal(layout.c.total, 2);
  assert.equal(layout.a.column, layout.c.column);
  assert.notEqual(layout.a.column, layout.b.column);
});

test("dense same-time groups preserve the active lane and count every hidden member", () => {
  const result = dayTimelineLayout(five, item("E", ...interval), [], 3, "E");
  assert.deepEqual(Object.keys(result.lanes), ["A", "E"]);
  assert.deepEqual(result.lanes.A, {column:0,columnSpan:1,total:3});
  assert.deepEqual(result.lanes.E, {column:2,columnSpan:1,total:3});
  assert.equal(result.summaries.length, 1);
  assert.deepEqual(result.summaries[0].keys, ["B", "C", "D"]);
  assert.deepEqual(result.summaries[0].lane, {column:1,columnSpan:1,total:3});
});

test("one physical lane puts hidden members outside the timeline without obscuring the active block", () => {
  const result = dayTimelineLayout(five, item("E", ...interval), [], 1, "E");
  assert.deepEqual(Object.keys(result.lanes), ["E"]);
  assert.equal(result.lanes.E.column, 0);
  assert.equal(result.summaries[0].lane, null);
  assert.deepEqual(result.summaries[0].keys, ["A", "B", "C", "D"]);
});

test("a selected hidden task gets a real lane after a narrow group is expanded", () => {
  const result = dayTimelineLayout(five, null, [], 3, "E");
  assert.ok(result.lanes.E);
  assert.equal(result.summaries[0].lane.column, 1);
  assert.equal(result.summaries[0].keys.includes("E"), false);
  const selected = dayTimelineLayout(five, null, ["E"], 2, "B");
  assert.equal(selected.lanes.B.column, 1);
  assert.equal(selected.summaries[0].lane.column, 0);
  assert.equal(selected.summaries[0].keys.includes("E"), true);
});

test("summary counts follow each actual simultaneous-time segment in a chain", () => {
  const items = [item("a", 600, 660), item("b", 600, 660), item("c", 615, 645), item("d", 630, 660)];
  const result = dayTimelineLayout(items, item("a", 600, 660), [], 1, "a");
  assert.deepEqual(result.summaries.map(segment => [segment.startMinute,segment.endMinute,segment.keys.length]), [
    [600,615,1], [615,630,2], [630,645,3], [645,660,2]
  ]);
});
