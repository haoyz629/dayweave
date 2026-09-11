export type TimeRangeEdge = "start" | "end";

export type MinuteRange = {
  start: number;
  end: number;
};

export type FocusedTimeRangePresentation =
  | { kind: "continuous"; window: MinuteRange }
  | { kind: "collapsed"; startWindow: MinuteRange; endWindow: MinuteRange; omittedMinutes: number };

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizeClockInput(value: string) {
  const trimmed = value.trim().replace(/[：.。]/g, ":");
  if (/^\d{1,2}$/.test(trimmed)) {
    const hour = Number(trimmed);
    return hour <= 23 ? `${String(hour).padStart(2, "0")}:00` : trimmed;
  }
  if (/^\d{3}$/.test(trimmed)) return `0${trimmed[0]}:${trimmed.slice(1)}`;
  if (/^\d{4}$/.test(trimmed)) return `${trimmed.slice(0, 2)}:${trimmed.slice(2)}`;
  const parts = trimmed.split(":");
  if (parts.length === 2 && parts.every((part) => /^\d{1,2}$/.test(part))) {
    return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}`;
  }
  return trimmed;
}

export function constrainTimeRange(
  edge: TimeRangeEdge,
  requestedMinute: number,
  current: MinuteRange,
  minimumMinute: number,
  maximumMinute: number,
  minimumDuration: number,
  step: number
): MinuteRange {
  const safeDuration = Math.max(1, minimumDuration);
  const safeStep = Math.max(1, step);
  const snapped = Math.round(requestedMinute / safeStep) * safeStep;
  if (edge === "start") {
    return {
      start: clamp(snapped, minimumMinute, current.end - safeDuration),
      end: current.end
    };
  }
  return {
    start: current.start,
    end: clamp(snapped, current.start + safeDuration, maximumMinute)
  };
}

export function shiftTimeRangeFromStart(
  requestedMinute: number,
  durationMinutes: number,
  minimumMinute: number,
  maximumMinute: number,
  minimumDuration: number,
  step: number
): MinuteRange {
  const safeMinimumDuration = Math.max(1, minimumDuration);
  const safeStep = Math.max(1, step);
  const snappedStart = Math.round(requestedMinute / safeStep) * safeStep;
  const start = clamp(snappedStart, minimumMinute, maximumMinute - safeMinimumDuration);
  const preferredDuration = Math.max(safeMinimumDuration, durationMinutes);
  return {
    start,
    end: clamp(start + preferredDuration, start + safeMinimumDuration, maximumMinute)
  };
}

export function closestTimeRangeEdge(
  pointerX: number,
  startCenterX: number,
  endCenterX: number
): TimeRangeEdge {
  return Math.abs(pointerX - startCenterX) <= Math.abs(pointerX - endCenterX) ? "start" : "end";
}

export function focusedTimeRangeWindow(
  current: MinuteRange,
  minimumMinute = 0,
  maximumMinute = 23 * 60 + 45,
  minimumSpan = 3 * 60,
  expansionRatio = 2,
  step = 15
): MinuteRange {
  const safeStep = Math.max(1, step);
  const availableSpan = Math.max(safeStep, maximumMinute - minimumMinute);
  const start = clamp(current.start, minimumMinute, maximumMinute - safeStep);
  const end = clamp(current.end, start + safeStep, maximumMinute);
  const selectionSpan = Math.max(safeStep, end - start);
  const requestedSpan = Math.max(minimumSpan, selectionSpan * Math.max(1, expansionRatio));
  const windowSpan = Math.min(availableSpan, Math.ceil(requestedSpan / safeStep) * safeStep);
  const leadingSpace = Math.floor((windowSpan - selectionSpan) / 2 / safeStep) * safeStep;
  let windowStart = Math.floor((start - leadingSpace) / safeStep) * safeStep;
  let windowEnd = windowStart + windowSpan;
  if (windowStart < minimumMinute) {
    windowStart = minimumMinute;
    windowEnd = minimumMinute + windowSpan;
  }
  if (windowEnd > maximumMinute) {
    windowEnd = maximumMinute;
    windowStart = maximumMinute - windowSpan;
  }
  return { start: windowStart, end: windowEnd };
}

function endpointWindow(
  minute: number,
  beforeMinutes: number,
  afterMinutes: number,
  minimumMinute: number,
  maximumMinute: number,
  step: number
): MinuteRange {
  const safeStep = Math.max(1, step);
  const availableSpan = Math.max(safeStep, maximumMinute - minimumMinute);
  const requestedSpan = Math.min(availableSpan, Math.ceil((beforeMinutes + afterMinutes) / safeStep) * safeStep);
  let start = Math.floor((minute - beforeMinutes) / safeStep) * safeStep;
  start = clamp(start, minimumMinute, maximumMinute - requestedSpan);
  return { start, end: start + requestedSpan };
}

export function focusedTimeRangePresentation(
  current: MinuteRange,
  minimumMinute = 0,
  maximumMinute = 23 * 60 + 45,
  collapseThreshold = 6 * 60,
  step = 5
): FocusedTimeRangePresentation {
  const safeStep = Math.max(1, step);
  const availableSpan = Math.max(safeStep, maximumMinute - minimumMinute);
  const start = clamp(current.start, minimumMinute, maximumMinute - safeStep);
  const end = clamp(current.end, start + safeStep, maximumMinute);
  const selectionSpan = end - start;

  if (selectionSpan <= collapseThreshold) {
    const requestedSpan = Math.max(3 * 60, selectionSpan + 2 * 60);
    const windowSpan = Math.min(availableSpan, Math.ceil(requestedSpan / safeStep) * safeStep);
    let windowStart = Math.floor((start - (windowSpan - selectionSpan) / 2) / safeStep) * safeStep;
    windowStart = clamp(windowStart, minimumMinute, maximumMinute - windowSpan);
    return { kind: "continuous", window: { start: windowStart, end: windowStart + windowSpan } };
  }

  const startWindow = endpointWindow(start, 60, 90, minimumMinute, maximumMinute, safeStep);
  const endWindow = endpointWindow(end, 90, 60, minimumMinute, maximumMinute, safeStep);
  const omittedMinutes = Math.max(0, endWindow.start - startWindow.end);
  if (omittedMinutes === 0) {
    return { kind: "continuous", window: focusedTimeRangeWindow({ start, end }, minimumMinute, maximumMinute, 3 * 60, 1, safeStep) };
  }
  return { kind: "collapsed", startWindow, endWindow, omittedMinutes };
}
