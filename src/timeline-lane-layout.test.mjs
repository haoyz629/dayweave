import assert from "node:assert/strict";
import test from "node:test";
import { timelineDurationHeight, timelineLaneLayout } from "./timeline-lane-layout.ts";

const item = (layoutKey, startMinute, endMinute) => ({ layoutKey, startMinute, endMinute });
const lanesFor = (...items) => timelineLaneLayout(items);

test("unrelated and adjacent items each use the full timeline width", () => {
  assert.deepEqual(lanesFor(item("A", 9 * 60, 10 * 60), item("B", 10 * 60, 11 * 60)), {
    A: { column: 0, columnSpan: 1, total: 1 },
    B: { column: 0, columnSpan: 1, total: 1 }
  });
});

test("identical intervals split evenly in deterministic key order", () => {
  assert.deepEqual(lanesFor(item("C", 540, 600), item("A", 540, 600), item("B", 540, 600)), {
    A: { column: 0, columnSpan: 1, total: 3 },
    B: { column: 1, columnSpan: 1, total: 3 },
    C: { column: 2, columnSpan: 1, total: 3 }
  });
});

test("same-start longer items are the left anchors", () => {
  assert.deepEqual(lanesFor(item("short", 540, 600), item("long", 540, 720)), {
    long: { column: 0, columnSpan: 1, total: 2 },
    short: { column: 1, columnSpan: 1, total: 2 }
  });
});

test("time containment is rendered as adjacent rectangles, never nested cards", () => {
  assert.deepEqual(lanesFor(item("outer", 540, 720), item("inner", 600, 660)), {
    outer: { column: 0, columnSpan: 1, total: 2 },
    inner: { column: 1, columnSpan: 1, total: 2 }
  });
});

test("chain overlaps reuse the first available base column", () => {
  assert.deepEqual(lanesFor(item("A", 540, 600), item("B", 570, 630), item("C", 600, 660)), {
    A: { column: 0, columnSpan: 1, total: 2 },
    B: { column: 1, columnSpan: 1, total: 2 },
    C: { column: 0, columnSpan: 1, total: 2 }
  });
});

test("an item only expands right through columns that are empty for its whole interval", () => {
  assert.deepEqual(lanesFor(item("A", 540, 720), item("B", 540, 600), item("C", 540, 600), item("D", 600, 660)), {
    A: { column: 0, columnSpan: 1, total: 3 },
    B: { column: 1, columnSpan: 1, total: 3 },
    C: { column: 2, columnSpan: 1, total: 3 },
    D: { column: 1, columnSpan: 2, total: 3 }
  });
});

test("short adjacent cards reuse the same full-width lane when their real times do not overlap", () => {
  assert.deepEqual(lanesFor(item("A", 540, 545), item("B", 545, 550)), {
    A: { column: 0, columnSpan: 1, total: 1 },
    B: { column: 0, columnSpan: 1, total: 1 }
  });
});

test("every timeline item height follows its real duration", () => {
  assert.equal(timelineDurationHeight(540, 545, 72), 6);
  assert.equal(timelineDurationHeight(540, 555, 72), 18);
  assert.equal(timelineDurationHeight(540, 570, 72), 36);
  assert.equal(timelineDurationHeight(540, 585, 72), 54);
});

test("separate overlap groups calculate their widths independently", () => {
  assert.deepEqual(lanesFor(item("A", 540, 600), item("B", 570, 630), item("C", 840, 900)), {
    A: { column: 0, columnSpan: 1, total: 2 },
    B: { column: 1, columnSpan: 1, total: 2 },
    C: { column: 0, columnSpan: 1, total: 1 }
  });
});

test("input order does not change the computed geometry", () => {
  const items = [item("A", 540, 720), item("B", 540, 600), item("C", 600, 660)];
  assert.deepEqual(timelineLaneLayout(items), timelineLaneLayout([...items].reverse()));
});
