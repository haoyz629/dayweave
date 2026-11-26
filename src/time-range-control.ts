export type TimeRangeEdge = "start" | "end";

export function selectDateBoundary(start: string, end: string, activeField: TimeRangeEdge, date: string) {
  if (activeField === "start") return {
    start: date,
    end: end && end < date ? date : end,
    activeField: "end" as const
  };
  return {
    start: date < start ? date : start,
    end: date,
    activeField: "start" as const
  };
}

export function taskDateRangeIncludesHistory(start: string, end: string, today: string) {
  return Boolean(start && end && start !== end && start < today);
}

export function selectDateRange(anchorDate: string | null, date: string) {
  if (!anchorDate) return { start: date, end: date, dateAnchor: date };
  return { start: date < anchorDate ? date : anchorDate, end: date > anchorDate ? date : anchorDate, dateAnchor: null };
}

export function selectTaskDateBoundary(anchorDate: string | null, date: string, today: string) {
  // History is always a new single-day selection, never one end of a range.
  if (date < today) return { start: date, end: date, dateAnchor: null };
  return selectDateRange(anchorDate && anchorDate >= today ? anchorDate : null, date);
}

export type MinuteRange = {
  start: number;
  end: number;
};

export type FocusedTimeRangePresentation =
  | { kind: "continuous"; window: MinuteRange }
  | { kind: "collapsed"; startWindow: MinuteRange; endWindow: MinuteRange; omittedMinutes: number };

export type ContinuousTimeScaleMark = {
  key: string;
  minute: number;
  tone: "boundary" | "context" | "range" | "range-start" | "range-end";
};

export type ContinuousTimeRangeGeometry = {
  startPosition: number;
  endPosition: number;
  midpointPosition: number;
};

export function timeRangePresentationContains(
  presentation: FocusedTimeRangePresentation,
  range: MinuteRange
) {
  return presentation.kind === "continuous"
    ? range.start >= presentation.window.start && range.end <= presentation.window.end
    : range.start >= presentation.startWindow.start
      && range.start <= presentation.startWindow.end
      && range.end >= presentation.endWindow.start
      && range.end <= presentation.endWindow.end;
}

export function timeRangePresentationCanReuse(
  presentation: FocusedTimeRangePresentation,
  range: MinuteRange,
  collapseThreshold = 4 * 60
) {
  const shouldCollapse = range.end - range.start > collapseThreshold;
  const presentationKindMatches = shouldCollapse
    ? presentation.kind === "collapsed"
    : presentation.kind === "continuous";
  return presentationKindMatches && timeRangePresentationContains(presentation, range);
}

export function continuousTimeRangeGeometry(
  presentation: FocusedTimeRangePresentation,
  range: MinuteRange
): ContinuousTimeRangeGeometry | null {
  if (presentation.kind !== "continuous") return null;
  const span = Math.max(1, presentation.window.end - presentation.window.start);
  const position = (minute: number) => clamp((minute - presentation.window.start) / span * 100, 0, 100);
  const startPosition = position(range.start);
  const endPosition = position(range.end);
  return {
    startPosition,
    endPosition,
    midpointPosition: (startPosition + endPosition) / 2
  };
}

export function continuousTimeScaleMarks(window: MinuteRange, range: MinuteRange): ContinuousTimeScaleMark[] {
  const span = Math.max(1, window.end - window.start);
  const duration = Math.max(0, range.end - range.start);
  const position = (minute: number) => (minute - window.start) / span * 100;
  const primary = duration <= 30
    ? [{ key: "range", minute: Math.round((range.start + range.end) / 2), tone: "range" as const, clearance: 18 }]
    : [
      { key: "range-start", minute: range.start, tone: "range-start" as const, clearance: 9 },
      { key: "range-end", minute: range.end, tone: "range-end" as const, clearance: 9 }
    ];
  const collides = (minute: number, marks: Array<{ minute: number; clearance: number }>, ownClearance = 9) => marks.some((mark) => (
    Math.abs(position(minute) - position(mark.minute)) < Math.max(ownClearance, mark.clearance)
  ));
  const reserved: Array<ContinuousTimeScaleMark & { clearance: number }> = [...primary];
  const boundaryCandidates = [
    { key: "window-start", minute: window.start, tone: "boundary" as const, clearance: 9 },
    { key: "window-end", minute: window.end, tone: "boundary" as const, clearance: 9 }
  ];
  const boundaries = boundaryCandidates.filter((mark) => !collides(mark.minute, primary, mark.clearance));
  reserved.push(...boundaries);

  const hourly: Array<ContinuousTimeScaleMark & { clearance: number }> = [];
  for (let minute = Math.ceil(window.start / 60) * 60; minute <= window.end; minute += 60) {
    if (reserved.some((mark) => mark.minute === minute) || collides(minute, reserved)) continue;
    hourly.push({ key: `hour-${minute}`, minute, tone: "context", clearance: 9 });
  }

  return [...boundaries, ...hourly, ...primary]
    .sort((first, second) => first.minute - second.minute)
    .map(({ key, minute, tone }) => ({ key, minute, tone }));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function sanitizeTimeInput(raw: string): string {
  const normalized = raw.replace(/[：.。]/g, ":");
  let result = "";
  let hasColon = false;
  let digitsBeforeColon = 0;
  let digitsAfterColon = 0;

  for (const ch of normalized) {
    if (ch === ":") {
      if (!hasColon && digitsBeforeColon > 0 && digitsBeforeColon <= 2) {
        hasColon = true;
        result += ":";
      }
    } else if (/\d/.test(ch)) {
      if (!hasColon) {
        if (digitsBeforeColon < 4) {
          digitsBeforeColon++;
          result += ch;
        }
      } else {
        if (digitsAfterColon < 2 && digitsBeforeColon + digitsAfterColon < 4) {
          digitsAfterColon++;
          result += ch;
        }
      }
    }
  }

  return result;
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
      start: clamp(snapped, minimumMinute, Math.min(maximumMinute, current.end - safeDuration)),
      end: current.end
    };
  }
  return {
    start: current.start,
    end: clamp(snapped, Math.max(minimumMinute, current.start + safeDuration), maximumMinute)
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
  collapseThreshold = 4 * 60,
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

export function parseClockMinutes(value: string, allowMidnight = false): number | null {
  const trimmed = value.trim();
  if (allowMidnight && trimmed === "24:00") return 24 * 60;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) return null;
  const [hour, minute] = trimmed.split(":").map(Number);
  return hour * 60 + minute;
}

export function formatClockMinutes(minute: number, allowMidnight = false): string {
  const maxMinute = allowMidnight ? 24 * 60 : 23 * 60 + 59;
  const bounded = clamp(Math.round(minute), 0, maxMinute);
  if (allowMidnight && bounded === 24 * 60) return "24:00";
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
}

export function applyTimeWheelSelection(
  edge: TimeRangeEdge,
  selectedClock: string,
  current: { start: string; end: string },
  options: {
    independent?: boolean;
    minimumMinute?: number;
    maximumMinute?: number;
    minimumDuration?: number;
    allowMidnightEnd?: boolean;
  } = {}
): { start: string; end: string } {
  const allowMidnightEnd = Boolean(options.allowMidnightEnd);
  const minimumMinute = options.minimumMinute ?? 0;
  const maximumMinute = options.maximumMinute ?? (allowMidnightEnd ? 24 * 60 : 23 * 60 + 59);
  const minimumDuration = Math.max(1, options.minimumDuration ?? 15);
  const parsedSelected = parseClockMinutes(selectedClock, allowMidnightEnd && edge === "end");
  if (parsedSelected === null) return current;

  const currentStart = parseClockMinutes(current.start, false) ?? minimumMinute;
  const currentEnd = parseClockMinutes(current.end, allowMidnightEnd)
    ?? Math.min(maximumMinute, currentStart + minimumDuration);

  if (options.independent) {
    const edgeMax = edge === "end" && allowMidnightEnd ? 24 * 60 : 23 * 60 + 59;
    const nextValue = formatClockMinutes(clamp(parsedSelected, minimumMinute, Math.min(maximumMinute, edgeMax)), allowMidnightEnd && edge === "end");
    return edge === "start" ? { start: nextValue, end: current.end } : { start: current.start, end: nextValue };
  }

  const prevDuration = Math.max(minimumDuration, currentEnd - currentStart);
  if (edge === "start") {
    const startMax = Math.min(23 * 60 + 59, maximumMinute - minimumDuration);
    const nextStart = clamp(parsedSelected, minimumMinute, startMax);
    const nextEnd = nextStart + minimumDuration <= currentEnd
      ? clamp(currentEnd, nextStart + minimumDuration, maximumMinute)
      : Math.max(nextStart + minimumDuration, Math.min(maximumMinute, nextStart + prevDuration));
    return {
      start: formatClockMinutes(nextStart, false),
      end: formatClockMinutes(nextEnd, allowMidnightEnd)
    };
  }

  const endMin = minimumMinute + minimumDuration;
  const nextEnd = clamp(parsedSelected, endMin, maximumMinute);
  const nextStart = currentStart + minimumDuration <= nextEnd
    ? clamp(currentStart, minimumMinute, nextEnd - minimumDuration)
    : Math.min(nextEnd - minimumDuration, Math.max(minimumMinute, nextEnd - prevDuration));
  return {
    start: formatClockMinutes(nextStart, false),
    end: formatClockMinutes(nextEnd, allowMidnightEnd)
  };
}
