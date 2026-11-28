import test from "node:test";
import assert from "node:assert/strict";
import { extractTagFromText, parseQuickCapture } from "./quickCapture.ts";
import { findAvailableSlot, layoutOverlappingItems } from "./timelineLayout.ts";
import { layoutWeekMultiDayBars } from "./monthSpanLayout.ts";
import { filterPoolTasks } from "./poolFilter.ts";
import { buildMiniCalDotMap } from "./miniCalDots.ts";
import { formatTrashRetentionCountdown } from "./trashRetention.ts";

const sampleTags = [
  { id: "work", name: "工作", color: "blue" },
  { id: "focus", name: "专注项目", color: "indigo" },
  { id: "study", name: "学习", color: "emerald" },
];

test("parseQuickCapture parses time, duration, priority and colored tag", () => {
  const res = parseQuickCapture("17:00 产品评审 45m #工作 #P1", sampleTags, 60, 15);
  assert.equal(res.title, "产品评审");
  assert.equal(res.mode, "timeline");
  assert.equal(res.startMin, 17 * 60);
  assert.equal(res.duration, 45);
  assert.equal(res.priority, "P1");
  assert.equal(res.tagId, "work");
});

test("parseQuickCapture defaults untimed tasks to pool and #不限时 to flex", () => {
  const pool = parseQuickCapture("阅读设计文档 1.5h #学习", sampleTags, 60, 15);
  assert.equal(pool.mode, "pool");
  assert.equal(pool.duration, 90);
  assert.equal(pool.tagId, "study");

  const flex = parseQuickCapture("整理季度材料 #不限时 #P2", sampleTags, 60, 15);
  assert.equal(flex.mode, "flex");
  assert.equal(flex.priority, "P2");
  assert.equal(flex.title, "整理季度材料");
});

test("quick entry removes only a complete registered tag", () => {
  const short = { id: "work", name: "work", color: "blue" };
  const long = { id: "shop", name: "workshop", color: "rose" };
  assert.deepEqual(extractTagFromText("send #workshop", [short]), { tagId: "", cleaned: "send #workshop" });
  assert.deepEqual(extractTagFromText("send #workshop", [short, long]), { tagId: "shop", cleaned: "send" });
  assert.deepEqual(extractTagFromText("send issue#work", [short]), { tagId: "", cleaned: "send issue#work" });
  assert.deepEqual(extractTagFromText("send #C++", [{...short, name: "C++"}]), { tagId: "work", cleaned: "send" });
  assert.equal(parseQuickCapture("send #工作坊", sampleTags).title, "send #工作坊");
});

test("layoutOverlappingItems groups connected clusters into equal columns", () => {
  const placed = layoutOverlappingItems([
    { id: "a", startMin: 600, duration: 90 }, // 10:00 - 11:30
    { id: "b", startMin: 630, duration: 60 }, // 10:30 - 11:30
    { id: "c", startMin: 720, duration: 60 }, // 12:00 - 13:00 (disjoint)
  ]);
  assert.deepEqual(placed.get("a"), { col: 0, totalCols: 2 });
  assert.deepEqual(placed.get("b"), { col: 1, totalCols: 2 });
  assert.deepEqual(placed.get("c"), { col: 0, totalCols: 1 });
});

test("findAvailableSlot avoids occupied ranges and respects snapStep", () => {
  const slot = findAvailableSlot(
    [
      { startMin: 9 * 60 + 30, duration: 60 }, // 09:30 - 10:30
      { startMin: 10 * 60 + 30, duration: 30 }, // 10:30 - 11:00
    ],
    60,
    { preferredStartMin: 9 * 60 + 30, snapStep: 15 },
  );
  assert.equal(slot, 11 * 60);
});

test("layoutWeekMultiDayBars packs overlapping multi-day flex tasks into continuous lanes and clips cross-week spans", () => {
  const mkFlex = (id, dateStart, dateEnd) => ({
    id,
    title: id,
    note: "",
    mode: "flex",
    tagId: "work",
    priority: "",
    done: false,
    date: dateStart,
    startMin: 960,
    duration: 60,
    dateStart,
    dateEnd,
    subtasks: [],
    deletedAt: null,
    createdAt: "",
    updatedAt: "",
  });

  // Week 2026-11-23 (Mon) .. 2026-11-29 (Sun)
  const layout = layoutWeekMultiDayBars(
    [
      mkFlex("single", "2026-11-26", "2026-11-26"), // ignored (1 day)
      mkFlex("f1", "2026-11-25", "2026-11-28"), // Wed..Sat (cols 3..6, span 4)
      mkFlex("f2", "2026-11-26", "2026-12-01"), // Thu..Tue next week (cols 4..7, continuesRight)
      mkFlex("f3", "2026-11-23", "2026-11-24"), // Mon..Tue (cols 1..2, shares lane 0 with f1!)
    ],
    "2026-11-23",
    "2026-11-29",
    2,
  );

  assert.equal(layout.visibleLaneCount, 2);
  const byId = new Map(layout.visibleSegments.map((s) => [s.task.id, s]));
  assert.equal(byId.has("single"), false);

  // f3 (cols 1..2) and f1 (cols 3..6) do not overlap so both fit in lane 0
  assert.deepEqual(
    { startCol: byId.get("f3").startCol, spanCols: byId.get("f3").spanCols, lane: byId.get("f3").lane },
    { startCol: 1, spanCols: 2, lane: 0 },
  );
  assert.deepEqual(
    { startCol: byId.get("f1").startCol, spanCols: byId.get("f1").spanCols, lane: byId.get("f1").lane },
    { startCol: 3, spanCols: 4, lane: 0 },
  );

  // f2 overlaps f1 -> placed in lane 1 and continuesRight
  assert.equal(byId.get("f2").startCol, 4);
  assert.equal(byId.get("f2").spanCols, 4);
  assert.equal(byId.get("f2").lane, 1);
  assert.equal(byId.get("f2").continuesLeft, false);
  assert.equal(byId.get("f2").continuesRight, true);
  assert.equal(byId.get("f2").totalDays, 6);

  // Next week clipping for f2 -> continuesLeft = true, cols 1..2
  const nextWeek = layoutWeekMultiDayBars([mkFlex("f2", "2026-11-26", "2026-12-01")], "2026-11-30", "2026-12-06", 2);
  assert.equal(nextWeek.visibleSegments.length, 1);
  assert.equal(nextWeek.visibleSegments[0].startCol, 1);
  assert.equal(nextWeek.visibleSegments[0].spanCols, 2);
  assert.equal(nextWeek.visibleSegments[0].continuesLeft, true);
  assert.equal(nextWeek.visibleSegments[0].continuesRight, false);
});

test("filterPoolTasks supports all, P1 and short (<=30m) filters with tag narrowing", () => {
  const mkTask = (id, overrides) => ({
    id,
    title: id,
    note: "",
    mode: "pool",
    tagId: "work",
    priority: "",
    done: false,
    date: "2026-11-26",
    startMin: 1020,
    duration: 60,
    dateStart: "2026-11-26",
    dateEnd: "2026-11-26",
    subtasks: [],
    deletedAt: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  });

  const tasks = [
    mkTask("p-15", { duration: 15, tagId: "study" }),
    mkTask("p-30-p1", { duration: 30, priority: "P1", tagId: "work" }),
    mkTask("p-45", { duration: 45, priority: "P2", tagId: "work" }),
    mkTask("p-60-p1", { duration: 60, priority: "P1", tagId: "focus" }),
    mkTask("p-done", { duration: 15, done: true }),
    mkTask("flex-short", { mode: "flex", duration: 15 }),
  ];

  assert.deepEqual(
    filterPoolTasks(tasks, "all", "all").map((t) => t.id),
    ["p-15", "p-30-p1", "p-45", "p-60-p1"],
  );
  assert.deepEqual(
    filterPoolTasks(tasks, "P1", "all").map((t) => t.id),
    ["p-30-p1", "p-60-p1"],
  );
  assert.deepEqual(
    filterPoolTasks(tasks, "short", "all").map((t) => t.id),
    ["p-15", "p-30-p1"],
  );
  assert.deepEqual(
    filterPoolTasks(tasks, "short", "work").map((t) => t.id),
    ["p-30-p1"],
  );
});

test("buildMiniCalDotMap distinguishes timeline (blue) and flex/multi-day (amber) dots", () => {
  const mkTask = (id, overrides) => ({
    id,
    title: id,
    note: "",
    mode: "pool",
    tagId: "work",
    priority: "",
    done: false,
    date: "2026-11-26",
    startMin: 600,
    duration: 60,
    dateStart: "2026-11-26",
    dateEnd: "2026-11-26",
    subtasks: [],
    deletedAt: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  });

  const mkOcc = (id, overrides) => ({
    id,
    ruleId: "r1",
    occurrenceDate: "2026-11-26",
    title: id,
    note: "",
    tagId: "work",
    priority: "",
    mode: "timeline",
    startMin: 570,
    duration: 30,
    done: false,
    skipped: false,
    ...overrides,
  });

  const dates = [
    "2026-11-23",
    "2026-11-24",
    "2026-11-25",
    "2026-11-26",
    "2026-11-27",
    "2026-11-28",
    "2026-11-29",
  ];

  const dots = buildMiniCalDotMap(
    dates,
    [
      mkTask("t1", { mode: "timeline", date: "2026-11-24" }),
      mkTask("f-multi", { mode: "flex", dateStart: "2026-11-24", dateEnd: "2026-11-26" }),
      mkTask("p1", { mode: "pool", date: "2026-11-29" }),
    ],
    [
      mkOcc("o-flex", { mode: "flex", occurrenceDate: "2026-11-27", startMin: null }),
      mkOcc("o-time", { mode: "timeline", occurrenceDate: "2026-11-28" }),
      mkOcc("o-skip", { mode: "flex", occurrenceDate: "2026-11-23", startMin: null, skipped: true }),
    ],
  );

  assert.equal(dots.get("2026-11-23"), undefined); // skipped occ ignored
  assert.equal(dots.get("2026-11-24"), "timeline"); // timeline wins over multi-day flex on same day
  assert.equal(dots.get("2026-11-25"), "flex"); // middle day of multi-day flex
  assert.equal(dots.get("2026-11-26"), "flex"); // end day of multi-day flex
  assert.equal(dots.get("2026-11-27"), "flex"); // flex recurring occurrence
  assert.equal(dots.get("2026-11-28"), "timeline"); // timeline recurring occurrence
  assert.equal(dots.get("2026-11-29"), undefined); // pool task does not show a dot
});

test("formatTrashRetentionCountdown formats days, warning threshold, hours, minutes and expiry", () => {
  const deletedAt = "2026-11-01T10:00:00+08:00";
  const baseMs = Date.parse(deletedAt);

  assert.deepEqual(formatTrashRetentionCountdown(deletedAt, baseMs + 1000), {
    label: "30 天后彻底删除",
    tone: "normal",
  });
  assert.deepEqual(formatTrashRetentionCountdown(deletedAt, baseMs + 27.5 * 86_400_000), {
    label: "3 天后彻底删除",
    tone: "warning",
  });
  assert.deepEqual(formatTrashRetentionCountdown(deletedAt, baseMs + 29.5 * 86_400_000), {
    label: "12 小时后彻底删除",
    tone: "danger",
  });
  assert.deepEqual(formatTrashRetentionCountdown(deletedAt, baseMs + (30 * 24 * 60 - 25) * 60_000), {
    label: "25 分钟后彻底删除",
    tone: "danger",
  });
  assert.deepEqual(formatTrashRetentionCountdown(deletedAt, baseMs + 30 * 86_400_000), {
    label: "即将自动彻底删除",
    tone: "danger",
  });
  assert.deepEqual(formatTrashRetentionCountdown("2026-11-01", Date.parse("2026-11-01T09:00:00+08:00")), {
    label: "30 天后彻底删除",
    tone: "normal",
  });
});
