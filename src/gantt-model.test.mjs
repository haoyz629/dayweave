import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  addCalendarDays, buildGanttRows, calendarDay, calendarWeekday,
  clipGanttRange, ganttTags, ganttTaskRange, ganttWindow, shiftGanttAnchor,
} from "./gantt-model.ts";

function task(overrides = {}) {
  return {
    id: "task-1", title: "设计方案", status: "open", tags: ["产品"],
    earliest_start_date: "2026-10-12", due_date: "2026-10-16",
    earliest_start_time: null, due_time: null,
    earliest_start_at: null, due_at: null, scheduled_dates: [],
    ...overrides,
  };
}
const week = ganttWindow("2026-10-14", "week");

test("strict Gregorian dates reject rollover, malformed values, and unsupported years", () => {
  for (const value of [null, undefined, "", "2026-2-01", "2026-02-29", "1900-02-29", "2026-04-31", "2026-00-01", "2026-13-01", "2026-01-00", "0000-01-01", "10000-01-01", "2026-10-12T00:00:00Z", " 2026-10-12"]) {
    assert.equal(calendarDay(value), null, String(value));
  }
  for (const value of ["2024-02-29", "2000-02-29", "0001-01-01", "0099-12-31", "9999-12-31", "1970-01-01"]) {
    assert.equal(typeof calendarDay(value), "number", value);
  }
  assert.equal(calendarDay("1970-01-01"), 0);
});

test("calendar arithmetic crosses leap days, months, years and early years safely", () => {
  assert.equal(addCalendarDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addCalendarDays("2024-02-28", 2), "2024-03-01");
  assert.equal(addCalendarDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addCalendarDays("0099-12-31", 1), "0100-01-01");
  assert.equal(calendarWeekday("0001-01-01"), 1);
  assert.throws(() => addCalendarDays("2026-02-30", 1), RangeError);
  assert.throws(() => addCalendarDays("2026-01-01", 0.5), RangeError);
  assert.throws(() => addCalendarDays("0001-01-01", -1), RangeError);
  assert.throws(() => addCalendarDays("9999-12-31", 1), RangeError);
});

test("week is Monday through Sunday, including Sunday anchors and year transitions", () => {
  assert.deepEqual(week.days, ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
  assert.deepEqual(ganttWindow("2026-10-18", "week"), week);
  const boundary = ganttWindow("2027-01-01", "week");
  assert.equal(boundary.start, "2026-12-28");
  assert.equal(boundary.end, "2027-01-03");
  assert.equal(boundary.days.length, 7);
});

test("month windows use actual calendar month lengths", () => {
  for (const [anchor, length] of [["2024-02-15", 29], ["2026-02-01", 28], ["2000-02-29", 29], ["1900-02-01", 28], ["2026-04-30", 30], ["2026-10-31", 31]]) {
    const window = ganttWindow(anchor, "month");
    assert.equal(window.start, `${anchor.slice(0, 7)}-01`);
    assert.equal(window.end, `${anchor.slice(0, 7)}-${length}`);
    assert.equal(window.days.length, length);
    assert.equal(new Set(window.days).size, length);
  }
  assert.throws(() => ganttWindow("not-a-date", "week"), RangeError);
});

test("previous/next navigation handles month end, leap year, and supported year limits", () => {
  assert.equal(shiftGanttAnchor("2026-01-31", "month", 1), "2026-02-28");
  assert.equal(shiftGanttAnchor("2024-03-31", "month", -1), "2024-02-29");
  assert.equal(shiftGanttAnchor("2026-12-01", "month", 1), "2027-01-01");
  assert.equal(shiftGanttAnchor("2027-01-01", "month", -1), "2026-12-01");
  assert.equal(shiftGanttAnchor("2026-10-12", "week", -1), "2026-10-05");
  assert.equal(shiftGanttAnchor("2026-10-12", "week", 1), "2026-10-19");
  assert.equal(shiftGanttAnchor("0001-01-01", "month", -1), "0001-01-01");
  assert.equal(shiftGanttAnchor("9999-12-31", "month", 1), "9999-12-31");
  assert.equal(shiftGanttAnchor("0001-01-01", "week", -1), "0001-01-01");
  assert.equal(shiftGanttAnchor("9999-12-31", "week", 1), "9999-12-31");
  assert.equal(ganttWindow("9999-12-31", "week").end, "9999-12-31");
});

test("split task dates are authoritative and independent of execution dates or times", () => {
  const input = task({ earliest_start_at: "2020-01-01T10:00:00Z", due_at: "2020-01-02T10:00:00Z", earliest_start_time: "09:00", due_time: "18:00" });
  Object.defineProperty(input, "scheduled_dates", { get() { throw new Error("Execution dates must not be read"); } });
  assert.deepEqual(ganttTaskRange(input), { range: { start: "2026-10-12", end: "2026-10-16" }, issue: null });
  assert.equal(buildGanttRows([input], week).rows.length, 1);
});

test("legacy timestamp fallback preserves the written date even when UTC is a different day", () => {
  const result = ganttTaskRange(task({ earliest_start_date: null, due_date: null, earliest_start_at: "2026-10-12T00:30:00+14:00", due_at: "2026-10-16T23:30:00-12:00" }));
  assert.deepEqual(result.range, { start: "2026-10-12", end: "2026-10-16" });
  assert.deepEqual(ganttTaskRange(task({ earliest_start_date: null, earliest_start_at: "2026-10-12 09:00:00", due_date: null, due_at: "2026-10-16" })).range, result.range);
});

test("missing, invalid, and reversed task dates are issues, never inferred from execution", () => {
  const cases = [
    [{ earliest_start_date: null }, "missing_start"],
    [{ due_date: null }, "missing_end"],
    [{ earliest_start_date: "2026-02-30", earliest_start_at: "2026-10-12T09:00:00Z" }, "invalid_start"],
    [{ earliest_start_date: "" }, "invalid_start"],
    [{ due_date: "nonsense" }, "invalid_end"],
    [{ earliest_start_date: "2026-10-17" }, "reversed"],
    [{ due_date: null, due_at: "2026-02-30T09:00:00Z" }, "invalid_end"],
    [{ due_date: null, due_at: "2026-10-16T25:00:00Z" }, "invalid_end"],
    [{ due_date: null, due_at: "2026-10-16 garbage" }, "invalid_end"],
  ];
  for (const [overrides, issue] of cases) {
    assert.deepEqual(ganttTaskRange(task({ scheduled_dates: ["2026-10-14"], ...overrides })), { range: null, issue });
  }
});

test("one-day bars occupy one column at either edge and in the middle", () => {
  for (const [date, index] of [["2026-10-12", 0], ["2026-10-14", 2], ["2026-10-18", 6]]) {
    assert.deepEqual(clipGanttRange({ start: date, end: date }, week), {
      start: date, end: date, startIndex: index, span: 1, clippedStart: false, clippedEnd: false,
    });
  }
});

test("overlapping task ranges clip inclusively and identify continuation edges", () => {
  assert.deepEqual(clipGanttRange({ start: "2026-09-01", end: "2026-11-01" }, week), {
    start: week.start, end: week.end, startIndex: 0, span: 7, clippedStart: true, clippedEnd: true,
  });
  assert.deepEqual(clipGanttRange({ start: "2026-10-10", end: week.start }, week), {
    start: week.start, end: week.start, startIndex: 0, span: 1, clippedStart: true, clippedEnd: false,
  });
  assert.deepEqual(clipGanttRange({ start: week.end, end: "2026-10-20" }, week), {
    start: week.end, end: week.end, startIndex: 6, span: 1, clippedStart: false, clippedEnd: true,
  });
  const month = ganttWindow("2024-02-10", "month");
  assert.equal(clipGanttRange({ start: "2024-01-31", end: "2024-03-01" }, month).span, 29);
});

test("non-overlaps, invalid ranges and reversed windows do not yield bars", () => {
  for (const range of [
    { start: "2026-10-01", end: "2026-10-11" },
    { start: "2026-10-19", end: "2026-10-21" },
    { start: "2026-10-16", end: "2026-10-12" },
    { start: "2026-02-30", end: "2026-10-16" },
  ]) assert.equal(clipGanttRange(range, week), null);
  assert.equal(clipGanttRange({ start: week.start, end: week.end }, { start: week.end, end: week.start }), null);
});

test("rows exclude deleted and non-overlapping tasks, retain done, and separate date issues", () => {
  const tasks = [
    task({ id: "done", status: "done" }),
    task({ id: "deleted", status: "deleted" }),
    task({ id: "outside", earliest_start_date: "2026-11-01", due_date: "2026-11-05", scheduled_dates: ["2026-10-14"] }),
    task({ id: "missing", due_date: null }),
    task({ id: "open" }),
  ];
  const result = buildGanttRows(tasks, week);
  assert.deepEqual(result.rows.map(({ task }) => task.id), ["done", "open"]);
  assert.deepEqual(result.issues.map(({ task, reason }) => [task.id, reason]), [["missing", "missing_end"]]);
  assert.equal(result.matchingCount, 4);
});

test("tag and status filters apply equally to rows, issues and counts", () => {
  const tasks = [task({ id: "open" }), task({ id: "done", status: "done" }), task({ id: "other", tags: ["个人"] }), task({ id: "missing", tags: ["个人"], due_date: null })];
  assert.deepEqual(buildGanttRows(tasks, week, { tag: "产品", status: "done" }).rows.map(({ task }) => task.id), ["done"]);
  assert.equal(buildGanttRows(tasks, week, { tag: "产品" }).issues.length, 0);
  const personal = buildGanttRows(tasks, week, { tag: "个人", status: "open" });
  assert.equal(personal.rows.length, 1);
  assert.equal(personal.issues.length, 1);
  assert.equal(personal.matchingCount, 2);
  assert.equal(buildGanttRows(tasks, week, { tag: "不存在" }).matchingCount, 0);
  assert.deepEqual(buildGanttRows([], week), { rows: [], issues: [], matchingCount: 0 });
});

test("tag options are distinct, nonblank, and do not leak deleted-only tags", () => {
  const tags = ganttTags([task({ tags: ["产品", "产品", "个人", "", " "] }), task({ status: "done", tags: ["完成"] }), task({ status: "deleted", tags: ["已删除专属"] })]);
  assert.equal(tags.length, 3);
  assert.deepEqual(new Set(tags), new Set(["产品", "个人", "完成"]));
});

test("row building is deterministic, sorted by actual range, and never mutates input", () => {
  const later = Object.freeze(task({ id: "later", earliest_start_date: "2026-10-15", tags: Object.freeze(["产品"]) }));
  const earlier = Object.freeze(task({ id: "earlier", earliest_start_date: "2026-10-01", tags: Object.freeze(["产品"]) }));
  const tasks = Object.freeze([later, earlier]);
  const result = buildGanttRows(tasks, week);
  assert.deepEqual(result.rows.map(({ task }) => task.id), ["earlier", "later"]);
  assert.strictEqual(result.rows[0].task, earlier);
  assert.deepEqual(tasks.map((task) => task.id), ["later", "earlier"]);
  assert.deepEqual(buildGanttRows(tasks, week), result);
});

test("results are identical across host time zones, DST changes and skipped local dates", () => {
  const url = new URL("./gantt-model.ts", import.meta.url).href;
  const script = `
    import { addCalendarDays, ganttWindow, ganttTaskRange, clipGanttRange } from ${JSON.stringify(url)};
    const week = ganttWindow("2026-03-08", "week");
    console.log(JSON.stringify([
      addCalendarDays("2026-03-08", 1), addCalendarDays("2026-11-01", 1),
      addCalendarDays("2011-12-29", 1), week, ganttWindow("2026-11-01", "week"),
      ganttTaskRange({ earliest_start_date: null, due_date: null, earliest_start_at: "2026-03-08T00:30:00+14:00", due_at: "2026-03-08T23:30:00-12:00" }),
      clipGanttRange({ start: "2026-03-07", end: "2026-03-09" }, week)
    ]));`;
  const outputs = ["UTC", "Asia/Shanghai", "America/Los_Angeles", "Europe/Berlin", "Pacific/Apia", "Pacific/Kiritimati"].map((TZ) =>
    execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", script], { env: { ...process.env, TZ }, encoding: "utf8" }).trim());
  for (const output of outputs) assert.equal(output, outputs[0]);
  const values = JSON.parse(outputs[0]);
  assert.deepEqual(values.slice(0, 3), ["2026-03-09", "2026-11-02", "2011-12-30"]);
  assert.deepEqual(values[5].range, { start: "2026-03-08", end: "2026-03-08" });
});
