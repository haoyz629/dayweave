import assert from "node:assert/strict";
import test from "node:test";
import { calendarDayInfo, lunarDateLabel, solarTermProgressLabel } from "./calendar-data.ts";
import officialWorkdays from "./official-workdays-2026.json" with { type: "json" };

test("official holidays mark calendar day state as rest", () => {
  for (const holiday of officialWorkdays.holidays) {
    for (const date of holiday.dates) {
      assert.equal(calendarDayInfo(date)?.workState, "rest", date);
    }
  }
});

test("makeup workdays mark calendar day state as work", () => {
  for (const [date] of officialWorkdays.makeupWorkdays) {
    assert.equal(calendarDayInfo(date)?.workState, "work", date);
  }
});

test("ordinary and uncovered dates omit statutory work or rest badges", () => {
  assert.equal(calendarDayInfo("2026-10-09")?.workState ?? null, null);
  assert.equal(calendarDayInfo("2027-01-01"), null);
  assert.equal(calendarDayInfo("2025-12-28"), null);
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
