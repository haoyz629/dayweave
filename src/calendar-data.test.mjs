import assert from "node:assert/strict";
import test from "node:test";
import { availabilityWorkdayOn, calendarDayInfo, lunarDateLabel, solarTermProgressLabel } from "./calendar-data.ts";
import officialWorkdays from "./official-workdays-2026.json" with { type: "json" };

test("official holidays override selected working weekdays", () => {
  for (const holiday of officialWorkdays.holidays) {
    for (const date of holiday.dates) {
      assert.equal(availabilityWorkdayOn(date, [1, 2, 3, 4, 5, 6, 7]), false, date);
      assert.equal(calendarDayInfo(date)?.workState, "rest", date);
    }
  }
});

test("makeup workdays override unselected weekends and match calendar labels", () => {
  for (const [date] of officialWorkdays.makeupWorkdays) {
    assert.equal(availabilityWorkdayOn(date, [1, 2, 3, 4, 5]), true, date);
    assert.equal(calendarDayInfo(date)?.workState, "work", date);
  }
});

test("ordinary dates retain custom weekly settings", () => {
  assert.equal(availabilityWorkdayOn("2026-10-09", [5]), true);
  assert.equal(availabilityWorkdayOn("2026-10-09", [1]), false);
  assert.equal(availabilityWorkdayOn("2026-10-11", [7]), true);
  assert.equal(availabilityWorkdayOn("2026-10-11", [1, 2, 3, 4, 5]), false);
  // A lunar festival without statutory leave must not override the settings.
  assert.equal(availabilityWorkdayOn("2026-03-03", [2]), true);
});

test("disabled makeup override respects weekly settings without changing statutory leave", () => {
  for (const [date] of officialWorkdays.makeupWorkdays) {
    assert.equal(availabilityWorkdayOn(date, [1, 2, 3, 4, 5], false), false, date);
    assert.equal(availabilityWorkdayOn(date, [1, 2, 3, 4, 5, 6, 7], false), true, date);
  }
  assert.equal(availabilityWorkdayOn("2026-10-01", [1, 2, 3, 4, 5, 6, 7], false), false);
});

test("dates outside official coverage fall back to weekly settings", () => {
  assert.equal(availabilityWorkdayOn("2027-01-01", [5]), true);
  assert.equal(availabilityWorkdayOn("2027-01-01", [1]), false);
  assert.equal(availabilityWorkdayOn("2025-12-28", [7]), true);
  assert.equal(availabilityWorkdayOn("2025-12-28", [1, 2, 3, 4, 5]), false);
});

test("heading lunar date includes month and avoids duplicating month on the first day", () => {
  assert.equal(lunarDateLabel("2026-10-12"), "九月初三");
  assert.equal(lunarDateLabel("2026-10-10"), "九月初一");
});

test("solar term heading follows the selected date and resets on the next term", () => {
  assert.equal(solarTermProgressLabel("2026-10-08"), "寒露");
  assert.equal(solarTermProgressLabel("2026-10-09"), "寒露第2天");
  assert.equal(solarTermProgressLabel("2026-10-12"), "寒露第5天");
  assert.equal(solarTermProgressLabel("2026-10-22"), "寒露第15天");
  assert.equal(solarTermProgressLabel("2026-10-23"), "霜降");
  assert.equal(solarTermProgressLabel("2026-10-24"), "霜降第2天");
  assert.equal(solarTermProgressLabel("2026-10-25"), "霜降第3天");
  assert.equal(solarTermProgressLabel("2026-11-06"), "霜降第15天");
  assert.equal(solarTermProgressLabel("2026-11-07"), "立冬");
  assert.equal(solarTermProgressLabel("2026-11-08"), "立冬第2天");
  assert.equal(solarTermProgressLabel("2026-01-01"), null);
  assert.equal(solarTermProgressLabel("2027-10-12"), null);
});
