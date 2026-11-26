import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTimeWheelSelection,
  closestTimeRangeEdge,
  continuousTimeRangeGeometry,
  continuousTimeScaleMarks,
  constrainTimeRange,
  focusedTimeRangePresentation,
  focusedTimeRangeWindow,
  formatClockMinutes,
  normalizeClockInput,
  parseClockMinutes,
  sanitizeTimeInput,
  selectDateBoundary,
  selectTaskDateBoundary,
  taskDateRangeIncludesHistory,
  shiftTimeRangeFromStart,
  timeRangePresentationCanReuse,
  timeRangePresentationContains
} from "./time-range-control.ts";

test("date boundaries alternate and keep a valid date order", () => {
  assert.deepEqual(selectDateBoundary("2026-09-10", "2026-09-12", "start", "2026-09-15"), {
    start: "2026-09-15", end: "2026-09-15", activeField: "end"
  });
  assert.deepEqual(selectDateBoundary("2026-09-10", "2026-09-12", "end", "2026-09-08"), {
    start: "2026-09-08", end: "2026-09-08", activeField: "start"
  });
  assert.deepEqual(selectDateBoundary("2026-09-10", "", "start", "2026-09-11"), {
    start: "2026-09-11", end: "", activeField: "end"
  });
});

test("first task date click selects one day and a second click sorts endpoints in either direction", () => {
  for (const [first, second] of [["2026-10-24", "2026-11-02"], ["2026-11-02", "2026-10-24"]]) {
    const one = selectTaskDateBoundary(null, first, "2026-10-23");
    assert.deepEqual(one, { start: first, end: first, dateAnchor: first });
    assert.deepEqual(selectTaskDateBoundary(one.dateAnchor, second, "2026-10-23"), {
      start: "2026-10-24", end: "2026-11-02", dateAnchor: null
    });
  }
});

test("historical task dates always select a single day, regardless of the pending anchor", () => {
  for (const anchor of [null, "2026-10-20", "2026-10-23", "2026-11-02"]) {
    for (const date of ["2026-09-30", "2026-10-21", "2026-10-22"]) {
      assert.deepEqual(selectTaskDateBoundary(anchor, date, "2026-10-23"), {
        start: date, end: date, dateAnchor: null
      });
    }
  }
});

test("an expired anchor starts a fresh single-day selection instead of a historical range", () => {
  assert.deepEqual(selectTaskDateBoundary("2026-10-23", "2026-10-25", "2026-10-24"), {
    start: "2026-10-25", end: "2026-10-25", dateAnchor: "2026-10-25"
  });
});

test("clicking the same date twice completes a single-day selection", () => {
  assert.deepEqual(selectTaskDateBoundary("2026-10-24", "2026-10-24", "2026-10-23"), {
    start: "2026-10-24", end: "2026-10-24", dateAnchor: null
  });
});

test("all task date combinations are ordered and never form a historical cross-day range", () => {
  const dates = ["2026-09-30", "2026-10-22", "2026-10-23", "2026-10-25", "2026-11-01"];
  for (const anchor of [null, ...dates]) for (const date of dates) {
    const next = selectTaskDateBoundary(anchor, date, "2026-10-23");
    assert.ok(next.start <= next.end);
    assert.equal(taskDateRangeIncludesHistory(next.start, next.end, "2026-10-23"), false);
    assert.equal(Boolean(next.dateAnchor), date >= "2026-10-23" && (!anchor || anchor < "2026-10-23"));
  }
});

test("manual clock input accepts short forms without losing minute precision", () => {
  assert.equal(normalizeClockInput("1"), "01:00");
  assert.equal(normalizeClockInput("100"), "01:00");
  assert.equal(normalizeClockInput("01:00"), "01:00");
  assert.equal(normalizeClockInput("7:5"), "07:05");
});

test("sanitizeTimeInput restricts input to at most 4 digits and allows time separators", () => {
  assert.equal(sanitizeTimeInput(""), "");
  assert.equal(sanitizeTimeInput("9"), "9");
  assert.equal(sanitizeTimeInput("93"), "93");
  assert.equal(sanitizeTimeInput("930"), "930");
  assert.equal(sanitizeTimeInput("0930"), "0930");
  assert.equal(sanitizeTimeInput("09300"), "0930");
  assert.equal(sanitizeTimeInput("12345"), "1234");
  assert.equal(sanitizeTimeInput("9:"), "9:");
  assert.equal(sanitizeTimeInput("9:3"), "9:3");
  assert.equal(sanitizeTimeInput("9:30"), "9:30");
  assert.equal(sanitizeTimeInput("9:300"), "9:30");
  assert.equal(sanitizeTimeInput("09:30"), "09:30");
  assert.equal(sanitizeTimeInput("09:305"), "09:30");
  assert.equal(sanitizeTimeInput("9：30"), "9:30");
  assert.equal(sanitizeTimeInput("9.30"), "9:30");
  assert.equal(sanitizeTimeInput("9。30"), "9:30");
  assert.equal(sanitizeTimeInput("abc"), "");
  assert.equal(sanitizeTimeInput(":30"), "30");
});

test("start and end handles stop at a fifteen minute minimum", () => {
  assert.deepEqual(constrainTimeRange("start", 610, { start: 540, end: 600 }, 0, 1425, 15, 15), {
    start: 585,
    end: 600
  });
  assert.deepEqual(constrainTimeRange("end", 530, { start: 540, end: 600 }, 0, 1425, 15, 15), {
    start: 540,
    end: 555
  });
  assert.deepEqual(constrainTimeRange("start", 180, { start: 60, end: 300 }, 0, 120, 15, 15), {
    start: 120,
    end: 300
  });
  assert.deepEqual(constrainTimeRange("end", 120, { start: 60, end: 300 }, 240, 480, 15, 15), {
    start: 60,
    end: 240
  });
});

test("pointer selection keeps close handles independently grabbable", () => {
  assert.equal(closestTimeRangeEdge(91, 90, 110), "start");
  assert.equal(closestTimeRangeEdge(109, 90, 110), "end");
});

test("manual start input shifts the range by its original duration", () => {
  assert.deepEqual(shiftTimeRangeFromStart(13 * 60, 60, 0, 23 * 60 + 45, 15, 15), {
    start: 13 * 60,
    end: 14 * 60
  });
  assert.deepEqual(shiftTimeRangeFromStart(23 * 60 + 15, 60, 0, 23 * 60 + 45, 15, 15), {
    start: 23 * 60 + 15,
    end: 23 * 60 + 45
  });
});

test("focused time window starts near the block and expands with manual input", () => {
  assert.deepEqual(focusedTimeRangeWindow({ start: 14 * 60, end: 15 * 60 }), {
    start: 13 * 60,
    end: 16 * 60
  });
  assert.deepEqual(focusedTimeRangeWindow({ start: 14 * 60, end: 18 * 60 }), {
    start: 12 * 60,
    end: 20 * 60
  });
});

test("focused time window stays inside the day near either boundary", () => {
  assert.deepEqual(focusedTimeRangeWindow({ start: 0, end: 30 }), { start: 0, end: 180 });
  assert.deepEqual(focusedTimeRangeWindow({ start: 23 * 60, end: 23 * 60 + 45 }), {
    start: 20 * 60 + 45,
    end: 23 * 60 + 45
  });
});

test("task block rail keeps ordinary ranges continuous", () => {
  const presentation = focusedTimeRangePresentation({ start: 14 * 60, end: 15 * 60 });
  assert.deepEqual(presentation, {
    kind: "continuous",
    window: { start: 13 * 60, end: 16 * 60 }
  });
  assert.equal(timeRangePresentationContains(presentation, { start: 11 * 60 + 45, end: 12 * 60 }), false);
  assert.equal(timeRangePresentationContains(
    { kind: "continuous", window: { start: 9 * 60, end: 13 * 60 } },
    { start: 11 * 60 + 45, end: 12 * 60 }
  ), true);
});

test("presentation switches safely at the four hour boundary", () => {
  const continuous = {
    kind: "continuous",
    window: { start: 8 * 60, end: 15 * 60 }
  };
  const ordinaryRange = { start: 9 * 60, end: 13 * 60 };
  const longRange = { start: 9 * 60, end: 13 * 60 + 5 };
  assert.equal(timeRangePresentationCanReuse(continuous, ordinaryRange), true);
  assert.equal(timeRangePresentationCanReuse(continuous, longRange), false);

  const collapsed = focusedTimeRangePresentation(longRange);
  assert.equal(collapsed.kind, "collapsed");
  assert.equal(continuousTimeRangeGeometry(collapsed, longRange), null);
});

test("fifteen minute range keeps logical endpoint positions without forced separation", () => {
  const range = { start: 11 * 60 + 45, end: 12 * 60 };
  const presentation = focusedTimeRangePresentation(range);
  const geometry = continuousTimeRangeGeometry(presentation, range);
  assert.ok(geometry);
  assert.equal(Math.round((geometry.endPosition - geometry.startPosition) * 100) / 100, 8.33);
  assert.equal(geometry.midpointPosition, (geometry.startPosition + geometry.endPosition) / 2);
});

test("continuous time scale shows hourly marks unless endpoint labels would overlap", () => {
  assert.deepEqual(
    continuousTimeScaleMarks({ start: 6 * 60 + 40, end: 12 * 60 }, { start: 7 * 60 + 40, end: 11 * 60 }),
    [
      { key: "window-start", minute: 6 * 60 + 40, tone: "boundary" },
      { key: "range-start", minute: 7 * 60 + 40, tone: "range-start" },
      { key: "hour-540", minute: 9 * 60, tone: "context" },
      { key: "hour-600", minute: 10 * 60, tone: "context" },
      { key: "range-end", minute: 11 * 60, tone: "range-end" },
      { key: "window-end", minute: 12 * 60, tone: "boundary" }
    ]
  );
  assert.deepEqual(
    continuousTimeScaleMarks({ start: 10 * 60 + 20, end: 13 * 60 + 20 }, { start: 11 * 60 + 45, end: 12 * 60 }),
    [
      { key: "window-start", minute: 10 * 60 + 20, tone: "boundary" },
      { key: "hour-660", minute: 11 * 60, tone: "context" },
      { key: "range", minute: 11 * 60 + 53, tone: "range" },
      { key: "hour-780", minute: 13 * 60, tone: "context" },
      { key: "window-end", minute: 13 * 60 + 20, tone: "boundary" }
    ]
  );
  assert.deepEqual(
    continuousTimeScaleMarks({ start: 9 * 60, end: 15 * 60 }, { start: 9 * 60, end: 9 * 60 + 15 }),
    [
      { key: "range", minute: 9 * 60 + 8, tone: "range" },
      { key: "hour-660", minute: 11 * 60, tone: "context" },
      { key: "hour-720", minute: 12 * 60, tone: "context" },
      { key: "hour-780", minute: 13 * 60, tone: "context" },
      { key: "hour-840", minute: 14 * 60, tone: "context" },
      { key: "window-end", minute: 15 * 60, tone: "boundary" }
    ]
  );
});

test("hourly marks return after the selected endpoint moves away", () => {
  const before = continuousTimeScaleMarks({ start: 7 * 60, end: 12 * 60 }, { start: 7 * 60 + 40, end: 11 * 60 });
  const after = continuousTimeScaleMarks({ start: 7 * 60, end: 12 * 60 }, { start: 8 * 60 + 50, end: 11 * 60 });
  assert.equal(before.some((mark) => mark.minute === 8 * 60), false);
  assert.equal(after.some((mark) => mark.minute === 8 * 60), true);
  assert.equal(after.some((mark) => mark.minute === 9 * 60), false);
});

test("task block rail collapses the middle of a long range", () => {
  assert.deepEqual(focusedTimeRangePresentation({ start: 60, end: 6 * 60 + 10 }), {
    kind: "collapsed",
    startWindow: { start: 0, end: 2 * 60 + 30 },
    endWindow: { start: 4 * 60 + 40, end: 7 * 60 + 10 },
    omittedMinutes: 2 * 60 + 10
  });
  assert.deepEqual(focusedTimeRangePresentation({ start: 60, end: 10 * 60 }), {
    kind: "collapsed",
    startWindow: { start: 0, end: 2 * 60 + 30 },
    endWindow: { start: 8 * 60 + 30, end: 11 * 60 },
    omittedMinutes: 6 * 60
  });
  assert.deepEqual(focusedTimeRangePresentation({ start: 60, end: 23 * 60 }), {
    kind: "collapsed",
    startWindow: { start: 0, end: 2 * 60 + 30 },
    endWindow: { start: 21 * 60 + 15, end: 23 * 60 + 45 },
    omittedMinutes: 18 * 60 + 45
  });
});

test("clock parsing and formatting honor optional recurring 24:00 midnight", () => {
  assert.equal(parseClockMinutes("09:30"), 570);
  assert.equal(parseClockMinutes("24:00", false), null);
  assert.equal(parseClockMinutes("24:00", true), 1440);
  assert.equal(parseClockMinutes("25:00", true), null);
  assert.equal(formatClockMinutes(1440, true), "24:00");
  assert.equal(formatClockMinutes(1440, false), "23:59");
  assert.equal(formatClockMinutes(-15, false), "00:00");
});

test("time wheel selection keeps valid span on same day and clamps near day boundaries", () => {
  assert.deepEqual(
    applyTimeWheelSelection("start", "08:15", { start: "09:30", end: "11:00" }),
    { start: "08:15", end: "11:00" }
  );
  assert.deepEqual(
    applyTimeWheelSelection("start", "11:30", { start: "09:30", end: "10:30" }),
    { start: "11:30", end: "12:30" }
  );
  assert.deepEqual(
    applyTimeWheelSelection("end", "08:45", { start: "09:30", end: "10:30" }),
    { start: "07:45", end: "08:45" }
  );
  assert.deepEqual(
    applyTimeWheelSelection("start", "23:45", { start: "22:00", end: "23:00" }),
    { start: "23:44", end: "23:59" }
  );
  assert.deepEqual(
    applyTimeWheelSelection("end", "24:00", { start: "23:30", end: "23:45" }, { allowMidnightEnd: true, minimumDuration: 1 }),
    { start: "23:30", end: "24:00" }
  );
});

test("independent wheel selection only updates the chosen boundary across multiple days", () => {
  assert.deepEqual(
    applyTimeWheelSelection("start", "21:15", { start: "09:00", end: "10:00" }, { independent: true }),
    { start: "21:15", end: "10:00" }
  );
  assert.deepEqual(
    applyTimeWheelSelection("end", "07:30", { start: "09:00", end: "10:00" }, { independent: true }),
    { start: "09:00", end: "07:30" }
  );
  assert.deepEqual(
    applyTimeWheelSelection("end", "24:00", { start: "23:50", end: "23:55" }, { independent: true, allowMidnightEnd: true }),
    { start: "23:50", end: "24:00" }
  );
});
