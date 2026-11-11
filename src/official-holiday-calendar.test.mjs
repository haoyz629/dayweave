import assert from "node:assert/strict";
import test from "node:test";
import bundled from "../data/holidays/2026.json" with { type: "json" };
import original from "./official-workdays-2026.json" with { type: "json" };
import { availabilityWorkdayOn, calendarDayInfo } from "./calendar-data.ts";
import { recurringRuleOccursOn } from "./calendar-task-placement.ts";
import {
  getHolidayCalendarSnapshot, holidayDataKey, holidayYearMessage, installHolidayCalendarSnapshot,
  missingHolidayYears, officialHolidayCoverageFor, officialWorkdayOn, subscribeHolidayCalendar, validateHolidayYear
} from "./official-holiday-calendar.ts";

const baseline = structuredClone(getHolidayCalendarSnapshot());
// Synthetic fixtures only: never publish these dates as an official annual arrangement.
function synthetic(year) {
  return { ...structuredClone(bundled), year, from: `${year}-01-01`, to: `${year}-12-31`, version: "TEST ONLY 合成年度",
    holidays: [{ name: "TEST ONLY 放假", dates: [`${year}-01-01`] }], makeupWorkdays: [[`${year}-01-02`, "TEST ONLY 补班"]] };
}
const rule = { frequency: "weekdays", interval_value: 1, weekdays: [], month_day: null, starts_on: "2026-12-31", ends_on: null };

test("bundled published 2026 preserves every original date and preference", () => {
  assert.deepEqual(bundled.holidays, original.holidays);
  assert.deepEqual(bundled.makeupWorkdays, original.makeupWorkdays);
  assert.equal(bundled.from, original.from);
  assert.equal(bundled.to, original.to);
});

test("one atomic snapshot updates calendar labels, availability and legal recurrence together", () => {
  let notifications = 0;
  const stop = subscribeHolidayCalendar(() => notifications++);
  try {
    assert.equal(officialHolidayCoverageFor("2027-01-01"), false);
    assert.equal(recurringRuleOccursOn(rule, "2027-01-04"), false);
    const next = { ...baseline, years: [bundled, synthetic(2027)], availableYears: [2026, 2027] };
    installHolidayCalendarSnapshot(next);
    assert.equal(notifications, 1);
    assert.equal(officialWorkdayOn("2027-01-01"), false);
    assert.equal(calendarDayInfo("2027-01-01").workState, "rest");
    assert.equal(availabilityWorkdayOn("2027-01-01", [1, 2, 3, 4, 5, 6, 7]), false);
    assert.equal(calendarDayInfo("2027-01-02").workState, "work");
    assert.equal(availabilityWorkdayOn("2027-01-02", [1, 2, 3, 4, 5]), true);
    assert.equal(availabilityWorkdayOn("2027-01-02", [1, 2, 3, 4, 5], false), false);
    assert.equal(recurringRuleOccursOn(rule, "2027-01-02"), true);
    assert.equal(recurringRuleOccursOn({ ...rule, interval_value: 2 }, "2027-01-02"), false);
    assert.equal(recurringRuleOccursOn({ ...rule, interval_value: 2 }, "2027-01-04"), true);
    next.years[1].holidays[0].dates[0] = "2027-01-05";
    assert.equal(officialWorkdayOn("2027-01-01"), false, "caller mutation cannot change installed data");
  } finally { stop(); installHolidayCalendarSnapshot(baseline); }
});

test("a missing middle year stops interval counting and filling the gap restores it", () => {
  try {
    installHolidayCalendarSnapshot({ ...baseline, years: [bundled, synthetic(2028)] });
    assert.deepEqual(missingHolidayYears("2026-12-31", "2028-01-03"), [2027]);
    assert.equal(recurringRuleOccursOn(rule, "2028-01-03"), false);
    installHolidayCalendarSnapshot({ ...baseline, years: [bundled, synthetic(2027), synthetic(2028)] });
    assert.equal(recurringRuleOccursOn(rule, "2028-01-03"), true);
  } finally { installHolidayCalendarSnapshot(baseline); }
});

test("untrusted annual data rejects invalid dates, partial range, schema, source and conflicts", () => {
  for (const change of [
    (d) => { d.schemaVersion = 2; }, (d) => { d.revision = 0; }, (d) => { d.to = "2027-06-30"; },
    (d) => { d.sourceUrl = "https://gov.cn.evil.example/a"; }, (d) => { d.verifiedAt = "2027-02-29"; },
    (d) => { d.holidays[0].dates = ["2027-02-29"]; }, (d) => { d.holidays[0].dates = ["2028-01-01"]; },
    (d) => { d.holidays[0].dates.push("2027-01-01"); }, (d) => { d.makeupWorkdays.push(["2027-01-01", "conflict"]); },
    (d) => { d.revision = 4294967296; }, (d) => { d.sourceUrl = "https://www.gov.cn/"; },
    (d) => { d.sourceUrl += "?redirect=elsewhere"; }, (d) => { d.extra = true; },
    (d) => { d.holidays.push({ name: d.holidays[0].name, dates: ["2027-01-03"] }); },
    (d) => { d.holidays[0].name = "invalid\u0001name"; }
  ]) {
    const invalid = synthetic(2027); change(invalid);
    assert.throws(() => validateHolidayYear(invalid));
    const before = holidayDataKey();
    assert.throws(() => installHolidayCalendarSnapshot({ ...baseline, years: [bundled, invalid] }));
    assert.equal(holidayDataKey(), before);
  }
});

test("unknown is not no-holiday or an assertion that official arrangements are unpublished", () => {
  assert.equal(officialWorkdayOn("2027-01-04"), null);
  assert.equal(availabilityWorkdayOn("2027-01-04", [1]), true);
  assert.equal(officialHolidayCoverageFor("2026-02-30"), false);
  assert.match(holidayYearMessage(2027, baseline), /暂未取得/);
  assert.match(holidayYearMessage(2027, { ...baseline, checking: true }), /正在检查并更新/);
  assert.match(holidayYearMessage(2027, { ...baseline, lastSuccessAt: "2026-11-10T00:00:00Z" }), /尚未收录/);
  assert.match(holidayYearMessage(2027, { ...baseline, lastSuccessAt: "2026-11-10T00:00:00Z", lastError: "404" }), /暂未取得/);
  assert.doesNotMatch(holidayYearMessage(2027, baseline), /官方未公布|节气仍可显示/);
});
