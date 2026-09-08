import assert from "node:assert/strict";
import test from "node:test";
import { recurringItemAppearsOnDate, taskAppearsOnDate } from "./calendar-task-placement.ts";

test("scheduled tasks appear only on confirmed execution dates", () => {
  const task = { scheduled_dates: ["2026-09-08", "2026-09-10"], due_date: "2026-09-30", due_at: null };
  assert.equal(taskAppearsOnDate(task, "2026-09-08"), true);
  assert.equal(taskAppearsOnDate(task, "2026-09-09"), false);
  assert.equal(taskAppearsOnDate(task, "2026-09-30"), false);
});

test("unscheduled tasks appear only on their due date", () => {
  const task = { scheduled_dates: [], due_date: "2026-09-30", due_at: null };
  assert.equal(taskAppearsOnDate(task, "2026-09-01"), false);
  assert.equal(taskAppearsOnDate(task, "2026-09-30"), true);
});

test("legacy due timestamps retain due-date placement", () => {
  const task = { scheduled_dates: [], due_date: null, due_at: "2026-09-12T18:00:00+08:00" };
  assert.equal(taskAppearsOnDate(task, "2026-09-12"), true);
  assert.equal(taskAppearsOnDate(task, "2026-09-11"), false);
});

test("tasks without a due date or execution block stay out of the month grid", () => {
  const task = { scheduled_dates: [], due_date: null, due_at: null };
  assert.equal(taskAppearsOnDate(task, "2026-09-07"), false);
});

const weeklyRecurringItem = {
  status: "active",
  frequency: "weekly",
  interval_value: 1,
  weekdays: [1, 3],
  month_day: null,
  starts_on: "2026-09-01",
  ends_on: null,
  deleted_at: null
};

test("active recurring items appear on matching dates", () => {
  assert.equal(recurringItemAppearsOnDate(weeklyRecurringItem, "2026-09-07"), true);
  assert.equal(recurringItemAppearsOnDate(weeklyRecurringItem, "2026-09-08"), false);
  assert.equal(recurringItemAppearsOnDate(weeklyRecurringItem, "2026-09-09"), true);
});

test("paused and ended recurring items stay out of the month grid", () => {
  assert.equal(recurringItemAppearsOnDate({ ...weeklyRecurringItem, status: "paused" }, "2026-09-07"), false);
  assert.equal(recurringItemAppearsOnDate({ ...weeklyRecurringItem, status: "ended" }, "2026-09-07"), false);
});

test("deleted recurring items stay out of the month grid", () => {
  assert.equal(recurringItemAppearsOnDate({ ...weeklyRecurringItem, deleted_at: "2026-09-07T10:00:00+08:00" }, "2026-09-07"), false);
});

test("recurring item start and end dates are inclusive", () => {
  const item = { ...weeklyRecurringItem, frequency: "daily", starts_on: "2026-09-07", ends_on: "2026-09-09" };
  assert.equal(recurringItemAppearsOnDate(item, "2026-09-06"), false);
  assert.equal(recurringItemAppearsOnDate(item, "2026-09-07"), true);
  assert.equal(recurringItemAppearsOnDate(item, "2026-09-09"), true);
  assert.equal(recurringItemAppearsOnDate(item, "2026-09-10"), false);
});

test("monthly recurring items honor their month interval", () => {
  const item = { ...weeklyRecurringItem, frequency: "monthly", interval_value: 2, month_day: 1 };
  assert.equal(recurringItemAppearsOnDate(item, "2026-09-01"), true);
  assert.equal(recurringItemAppearsOnDate(item, "2026-10-01"), false);
  assert.equal(recurringItemAppearsOnDate(item, "2026-11-01"), true);
});
