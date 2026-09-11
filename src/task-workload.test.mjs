import assert from "node:assert/strict";
import test from "node:test";
import {
  inferredDailyWorkloadMinutes,
  normalizeTaskWorkloadAfterScheduleChange,
  preferredDailyAllocationMinutes,
  taskDateSpanDays,
  taskRangeDurationMinutes,
  taskRangeIsValid,
  taskScheduleIsComplete,
  taskWorkloadIsValid,
  totalWorkloadForDaily
} from "./task-workload.ts";

const sameDay = {
  earliest_start_date: "2026-09-09",
  earliest_start_time: "14:00",
  due_date: "2026-09-09",
  due_time: "15:30",
  estimated_minutes: 60
};

test("same-day workload follows the selected start and end time", () => {
  assert.equal(taskRangeDurationMinutes(sameDay), 90);
  assert.equal(normalizeTaskWorkloadAfterScheduleChange({ ...sameDay, due_time: "15:00" }, sameDay).estimated_minutes, 90);
});

test("cross-day workload includes both boundary dates", () => {
  const schedule = { earliest_start_date: "2026-09-09", due_date: "2026-09-11" };
  assert.equal(taskDateSpanDays(schedule), 3);
  assert.equal(totalWorkloadForDaily(60, 3), 180);
  assert.equal(inferredDailyWorkloadMinutes(180, schedule), 60);
});

test("switching from a same-day task uses its duration as the daily starting point", () => {
  const next = normalizeTaskWorkloadAfterScheduleChange(sameDay, {
    ...sameDay,
    due_date: "2026-09-11"
  });
  assert.equal(next.estimated_minutes, 270);
});

test("task time ranges enforce the fifteen minute minimum", () => {
  assert.equal(taskRangeIsValid({ ...sameDay, due_time: "14:14" }), false);
  assert.equal(taskRangeIsValid({ ...sameDay, due_time: "14:15" }), true);
});

test("formal tasks require complete start and end date-times", () => {
  assert.equal(taskScheduleIsComplete(sameDay), true);
  assert.equal(taskScheduleIsComplete({ ...sameDay, earliest_start_time: "" }), false);
  assert.equal(taskScheduleIsComplete({ ...sameDay, due_date: "", due_time: "" }), false);
});

test("legacy cross-day totals that do not divide evenly are not guessed", () => {
  const schedule = { earliest_start_date: "2026-09-09", due_date: "2026-09-11" };
  assert.equal(inferredDailyWorkloadMinutes(200, schedule), null);
  assert.equal(preferredDailyAllocationMinutes({
    earliest_start_at: "2026-09-09T09:00:00+08:00",
    due_at: "2026-09-11T18:00:00+08:00",
    estimated_minutes: 200
  }, 200), 200);
});

test("daily preference caps automatic planning without changing remaining workload", () => {
  assert.equal(preferredDailyAllocationMinutes({
    earliest_start_at: "2026-09-09T09:00:00+08:00",
    due_at: "2026-09-11T18:00:00+08:00",
    estimated_minutes: 180
  }, 130), 60);
  assert.equal(preferredDailyAllocationMinutes({
    earliest_start_at: "2026-09-09T09:00:00+08:00",
    due_at: "2026-09-11T18:00:00+08:00",
    estimated_minutes: 180
  }, 45), 45, "actual remaining workload wins once it is below the daily preference");
});

test("daily input can pass through a short intermediate value while typing", () => {
  const schedule = { earliest_start_date: "2026-09-09", due_date: "2026-09-11" };
  assert.equal(inferredDailyWorkloadMinutes(21, schedule), 7);
  assert.equal(totalWorkloadForDaily(7, 3), null);
  assert.equal(taskWorkloadIsValid({
    ...sameDay,
    due_date: "2026-09-11",
    estimated_minutes: 21
  }), false);
});
