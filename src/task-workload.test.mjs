import assert from "node:assert/strict";
import test from "node:test";
import {
  inferredDailyWorkloadMinutes,
  normalizeTaskWorkloadAfterScheduleChange,
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

test("formal tasks allow date-only schedules while rejecting missing dates or partial times", () => {
  assert.equal(taskScheduleIsComplete(sameDay), true);
  assert.equal(taskScheduleIsComplete({ ...sameDay, earliest_start_time: "", due_time: "" }), true);
  assert.equal(taskScheduleIsComplete({ ...sameDay, earliest_start_time: "", due_time: "", due_date: "2026-09-11" }), true);
  assert.equal(taskScheduleIsComplete({ ...sameDay, earliest_start_time: "" }), false);
  assert.equal(taskScheduleIsComplete({ ...sameDay, due_time: "" }), false);
  assert.equal(taskScheduleIsComplete({ ...sameDay, due_date: "", due_time: "" }), false);
  assert.equal(taskRangeIsValid({ ...sameDay, earliest_start_time: "", due_time: "" }), true);
});

test("legacy cross-day totals that do not divide evenly are not guessed", () => {
  const schedule = { earliest_start_date: "2026-09-09", due_date: "2026-09-11" };
  assert.equal(inferredDailyWorkloadMinutes(200, schedule), null);
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

test("cross-day timed tasks require at least fifteen minutes per day while untimed tasks clear workload", () => {
  const timedCrossDay = {
    earliest_start_date: "2026-09-09",
    earliest_start_time: "09:00",
    due_date: "2026-09-11",
    due_time: "18:00"
  };
  assert.equal(taskWorkloadIsValid({ ...timedCrossDay, estimated_minutes: null }), false);
  assert.equal(taskWorkloadIsValid({ ...timedCrossDay, estimated_minutes: 44 }), false);
  assert.equal(taskWorkloadIsValid({ ...timedCrossDay, estimated_minutes: 45 }), true);

  const untimedCrossDay = {
    ...timedCrossDay,
    earliest_start_time: "",
    due_time: "",
    estimated_minutes: null
  };
  assert.equal(taskRangeIsValid(untimedCrossDay), true);
  assert.equal(taskWorkloadIsValid(untimedCrossDay), true);
  assert.equal(normalizeTaskWorkloadAfterScheduleChange({ ...timedCrossDay, estimated_minutes: 90 }, {
    ...timedCrossDay,
    earliest_start_time: "",
    due_time: "",
    estimated_minutes: 90
  }).estimated_minutes, null);
});

test("two-day timed range rejects windows where neither day has fifteen minutes available", () => {
  const tightTwoDay = {
    earliest_start_date: "2026-09-09",
    earliest_start_time: "23:50",
    due_date: "2026-09-10",
    due_time: "00:10"
  };
  assert.equal(taskRangeIsValid(tightTwoDay), false);
  assert.equal(taskRangeIsValid({ ...tightTwoDay, earliest_start_time: "23:45" }), true);
  assert.equal(taskRangeIsValid({ ...tightTwoDay, due_date: "2026-09-11" }), true);
});
