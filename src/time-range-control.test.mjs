import assert from "node:assert/strict";
import test from "node:test";
import {
  closestTimeRangeEdge,
  constrainTimeRange,
  focusedTimeRangePresentation,
  focusedTimeRangeWindow,
  normalizeClockInput,
  shiftTimeRangeFromStart
} from "./time-range-control.ts";

test("manual clock input accepts short forms without losing minute precision", () => {
  assert.equal(normalizeClockInput("1"), "01:00");
  assert.equal(normalizeClockInput("100"), "01:00");
  assert.equal(normalizeClockInput("01:00"), "01:00");
  assert.equal(normalizeClockInput("7:5"), "07:05");
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
  assert.deepEqual(focusedTimeRangePresentation({ start: 14 * 60, end: 15 * 60 }), {
    kind: "continuous",
    window: { start: 13 * 60, end: 16 * 60 }
  });
  assert.deepEqual(focusedTimeRangePresentation({ start: 60, end: 6 * 60 + 10 }), {
    kind: "continuous",
    window: { start: 0, end: 7 * 60 + 10 }
  });
});

test("task block rail collapses the middle of a long range", () => {
  assert.deepEqual(focusedTimeRangePresentation({ start: 60, end: 10 * 60 }), {
    kind: "collapsed",
    startWindow: { start: 0, end: 2 * 60 + 30 },
    endWindow: { start: 8 * 60 + 30, end: 11 * 60 },
    omittedMinutes: 6 * 60
  });
});
