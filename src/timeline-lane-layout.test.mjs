import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dayTimelineLayout, timelineDurationHeight, timelineLaneLayout } from "./timeline-lane-layout.ts";

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

test("dragging into an overlap uses the same lanes as a slide-to-create preview", () => {
  const moving = item("block:moving", 540, 600);
  const target = item("block:target", 720, 780);
  const preview = item(moving.layoutKey, 735, 795);
  const dragged = timelineLaneLayout([moving, target], preview);
  const created = timelineLaneLayout([target, item("create:selection", 735, 795)]);
  assert.deepEqual(dragged[moving.layoutKey], created["create:selection"]);
  assert.deepEqual(dragged[target.layoutKey], created[target.layoutKey]);
  assert.equal(dragged[target.layoutKey].total, 2);
});

test("dragging out releases the original overlap without keeping a phantom source lane", () => {
  const items = [item("block:moving", 540, 600), item("block:other", 540, 600)];
  const before = structuredClone(items);
  const dragged = timelineLaneLayout(items, item("block:moving", 720, 780));
  assert.deepEqual(dragged, {
    "block:other": { column: 0, columnSpan: 1, total: 1 },
    "block:moving": { column: 0, columnSpan: 1, total: 1 }
  });
  assert.deepEqual(items, before);
  assert.deepEqual(timelineLaneLayout(items, null), timelineLaneLayout(before));
  assert.equal(timelineLaneLayout(items, null)["block:other"].total, 2);
});

test("drag previews cover draft blocks, multiple overlaps and exact adjacency", () => {
  const key = "draft:task:time:0";
  const items = [item(key, 540, 600), item("event:fixed", 720, 780), item("recurring:other", 735, 795)];
  const preview = item(key, 750, 810);
  assert.deepEqual(timelineLaneLayout(items, preview), timelineLaneLayout([preview, ...items.slice(1)]));
  assert.equal(timelineLaneLayout(items, preview)[key].total, 3);
  assert.equal(timelineLaneLayout(items, item(key, 795, 855))[key].total, 1);
});

test("the real day timeline uses a dragged interval preview, arrival order, and width-based overflow lanes", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  assert.match(app, /const layoutDrag = timelineDrag && dragKey \?/);
  assert.match(app, /const dayLayout = timelineLaneLayout\(timelineItems, selectedDate, layoutDrag,/);
  assert.match(app, /timelineDrag\.originalStart !== timelineDrag\.start/);
  assert.match(app, /timelineCreateRange\?\.dragging/);
  assert.match(app, /sourceLane: timelineItemLanes\[/);
  assert.match(app, /className="timeline-drag-source"[^\n]+timelineDragRef\.current\.sourceLane/);
  assert.match(app, /timeline-overflow-trigger/);
});

test("shared overlap transitions animate horizontally without delaying vertical dragging", () => {
  const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const rule = styles.match(/\.timeline-event \{[^}]+\}/)?.[0];
  assert.match(rule, /transition: left \.18s ease, right \.18s ease,/);
  assert.doesNotMatch(rule, /(?:transition:|,)\s*(?:top|all)\s/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{ \.timeline-event \{ transition: none; \} \}/);
});

test("a dragged block stays after its neighbour while crossing its start time in either direction", () => {
  const moving = item("block:moving", 300, 360), target = item("block:target", 600, 720);
  for (const start of [570, 585, 600, 615, 660, 615, 600, 585, 570]) {
    const lanes = timelineLaneLayout([moving, target], item(moving.layoutKey, start, start + 60));
    assert.deepEqual(lanes[target.layoutKey], { column: 0, columnSpan: 1, total: 2 });
    assert.deepEqual(lanes[moving.layoutKey], { column: 1, columnSpan: 1, total: 2 });
  }
});

test("releasing a drag restores chronological columns regardless of refreshed input ordering", () => {
  const items = [item("A", 570, 660), item("B", 600, 720), item("C", 585, 690)];
  for (const input of [items, [...items].reverse()]) {
    const dragging = timelineLaneLayout(input, items[0]);
    assert.deepEqual([dragging.C.column, dragging.B.column, dragging.A.column], [0, 1, 2]);
    const released = timelineLaneLayout(input);
    assert.deepEqual([released.A.column, released.C.column, released.B.column], [0, 1, 2]);
    const next = timelineLaneLayout(input, item("C", 555, 675));
    assert.deepEqual([next.A.column, next.B.column, next.C.column], [0, 1, 2]);
    assert.deepEqual(timelineLaneLayout(input), released);
  }
});

test("moved blocks stay after directly overlapping neighbours even when a left column is free", () => {
  const items = [item("A", 540, 600), item("B", 570, 630), item("C", 840, 900)];
  const lanes = timelineLaneLayout(items, item("C", 600, 660));
  assert.equal(lanes.A.column, 0);
  assert.equal(lanes.B.column, 1);
  assert.equal(lanes.C.column, 2);
  assert.equal(lanes.C.total, 3);
});

test("drag priority does not join separate groups or make adjacent blocks overlap", () => {
  const items = [item("A", 540, 600), item("B", 600, 660), item("C", 900, 960), item("D", 930, 990)];
  const lanes = timelineLaneLayout(items, items[2]);
  assert.deepEqual(lanes.A, { column: 0, columnSpan: 1, total: 1 });
  assert.deepEqual(lanes.B, { column: 0, columnSpan: 1, total: 1 });
  assert.equal(lanes.D.column, 0);
  assert.equal(lanes.C.column, 1);
  assert.equal(lanes.C.total, 2);
});

test("nonchronological placement never puts actual overlapping blocks in the same column", () => {
  const items = [item("A", 540, 720), item("B", 570, 630), item("C", 600, 660), item("D", 630, 690)];
  for (const preview of [null, ...items]) {
    const lanes = timelineLaneLayout(items, preview);
    for (const left of items) for (const right of items) {
      if (left === right || left.startMinute >= right.endMinute || left.endMinute <= right.startMinute) continue;
      const a = lanes[left.layoutKey], b = lanes[right.layoutKey];
      assert.ok(a.column + a.columnSpan <= b.column || b.column + b.columnSpan <= a.column);
    }
  }
});

test("dayTimelineLayout keeps the original slot occupied during drag until mouse release", () => {
  const items = [
    item("block:a", 960, 1020),
    item("block:b", 960, 1020),
    item("block:c", 960, 1020),
    item("block:moving", 960, 1020)
  ];
  const before = dayTimelineLayout(items, null, [], 5, null);
  const dragging = dayTimelineLayout(
    items,
    item("block:moving", 900, 960),
    [],
    5,
    "block:moving",
    item("__drag_source__", 960, 1020)
  );
  assert.deepEqual(dragging.lanes["block:a"], before.lanes["block:a"]);
  assert.deepEqual(dragging.lanes["block:b"], before.lanes["block:b"]);
  assert.deepEqual(dragging.lanes["block:c"], before.lanes["block:c"]);
  assert.deepEqual(dragging.lanes.__drag_source__, before.lanes["block:moving"]);
  assert.equal(dragging.lanes["block:moving"].total, 1);

  const released = dayTimelineLayout(items, item("block:moving", 900, 960), [], 5, "block:moving", null);
  assert.equal(released.lanes["block:a"].total, 3);
  assert.equal(released.lanes.__drag_source__, undefined);
});
