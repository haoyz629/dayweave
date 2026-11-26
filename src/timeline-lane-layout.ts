export type TimelineLaneInput = {
  layoutKey: string;
  startMinute: number;
  endMinute: number;
};

export type TimelineLane = {
  column: number;
  columnSpan: number;
  total: number;
};

function overlaps(left: TimelineLaneInput, right: TimelineLaneInput) {
  return left.startMinute < right.endMinute && left.endMinute > right.startMinute;
}

export function timelineDurationHeight(startMinute: number, endMinute: number, pixelsPerHour: number) {
  return Math.max(1, (endMinute - startMinute) / 60 * pixelsPerHour);
}

/**
 * Places connected real-time overlap groups into stable columns, then lets
 * every item grow rightward only through columns that stay empty for its full
 * interval. Card height and collision geometry both follow the stored time.
 */
export function timelineLaneLayout(items: TimelineLaneInput[], preview: TimelineLaneInput | null = null): Record<string, TimelineLane> {
  const sorted = items
    .map((item) => ({ ...(preview?.layoutKey === item.layoutKey ? preview : item) }))
    .sort((left, right) => {
      const startDifference = left.startMinute - right.startMinute;
      if (startDifference !== 0) return startDifference;
      const endDifference = right.endMinute - left.endMinute;
      return endDifference !== 0 ? endDifference : left.layoutKey.localeCompare(right.layoutKey);
    });
  const layout: Record<string, TimelineLane> = {};

  for (let groupStart = 0; groupStart < sorted.length;) {
    let groupEnd = groupStart + 1;
    let groupEndMinute = sorted[groupStart].endMinute;
    while (groupEnd < sorted.length && sorted[groupEnd].startMinute < groupEndMinute) {
      groupEndMinute = Math.max(groupEndMinute, sorted[groupEnd].endMinute);
      groupEnd += 1;
    }

    const columns: TimelineLaneInput[][] = [];
    const assignments: Array<{ item: TimelineLaneInput; column: number }> = [];
    const group = sorted.slice(groupStart, groupEnd)
      .sort((left, right) => Number(left.layoutKey === preview?.layoutKey) - Number(right.layoutKey === preview?.layoutKey));
    for (const item of group) {
      // Keep only the active drag rightmost; released blocks use the normal time order.
      const firstColumn = item.layoutKey === preview?.layoutKey
        ? columns.reduce((first, column, index) => column.some((other) => overlaps(item, other)) ? index + 1 : first, 0)
        : 0;
      let column = columns.findIndex((entries, index) => index >= firstColumn && entries.every((other) => !overlaps(item, other)));
      if (column < 0) column = columns.length;
      if (!columns[column]) columns[column] = [];
      columns[column].push(item);
      assignments.push({ item, column });
    }

    const total = Math.max(1, columns.length);
    for (const { item, column } of assignments) {
      let columnSpan = 1;
      for (let candidate = column + 1; candidate < total; candidate += 1) {
        if (columns[candidate].some((other) => overlaps(item, other))) break;
        columnSpan += 1;
      }
      layout[item.layoutKey] = { column, columnSpan, total };
    }
    groupStart = groupEnd;
  }

  return layout;
}

export type TimelineSummary = { startMinute: number; endMinute: number; keys: string[]; lane: TimelineLane | null };

/** Day-only lane packing: keep the moving block visible, then summarize only the
 * simultaneous hidden blocks when the real track width cannot fit every lane. */
export function dayTimelineLayout(
  items: TimelineLaneInput[], preview: TimelineLaneInput | null, arrivals: readonly string[], capacity: number, preferredKey: string | null, holdSource: TimelineLaneInput | null = null
): { lanes: Record<string, TimelineLane>; summaries: TimelineSummary[] } {
  const dragSourceKey = "__drag_source__";
  const reserveSource = Boolean(preview && holdSource && !overlaps(preview, holdSource));
  const arrivalOrder = new Map(arrivals.map((key, index) => [key, index]));
  const effectiveItems = items.map(item => ({ ...(preview?.layoutKey === item.layoutKey ? preview : item) }));
  if (reserveSource && holdSource) {
    effectiveItems.push({ layoutKey: dragSourceKey, startMinute: holdSource.startMinute, endMinute: holdSource.endMinute });
  }
  const sortKey = (layoutKey: string) => (reserveSource && layoutKey === dragSourceKey && preview ? preview.layoutKey : layoutKey);
  const sorted = effectiveItems
    .sort((left, right) => {
      const start = left.startMinute - right.startMinute;
      if (start) return start;
      const end = right.endMinute - left.endMinute;
      if (end) return end;
      const lk = sortKey(left.layoutKey), rk = sortKey(right.layoutKey);
      const a = arrivalOrder.get(lk), b = arrivalOrder.get(rk);
      if (a !== undefined || b !== undefined) return (a ?? -1) - (b ?? -1);
      return lk.localeCompare(rk);
    });
  const lanes: Record<string, TimelineLane> = {};
  const summaries: TimelineSummary[] = [];
  const cap = Number.isFinite(capacity) ? Math.max(1, Math.floor(capacity)) : Math.max(1, sorted.length);

  for (let from = 0; from < sorted.length;) {
    let to = from + 1, groupEnd = sorted[from].endMinute;
    while (to < sorted.length && sorted[to].startMinute < groupEnd) {
      groupEnd = Math.max(groupEnd, sorted[to].endMinute);
      to += 1;
    }
    const group = sorted.slice(from, to);
    from = to;
    const columns: TimelineLaneInput[][] = [];
    const assignment = new Map<string, number>();
    const allocation = preview ? [...group.filter(item => item.layoutKey !== preview.layoutKey), ...group.filter(item => item.layoutKey === preview.layoutKey)] : group;
    for (const item of allocation) {
      const first = item.layoutKey === preview?.layoutKey
        ? columns.reduce((minimum, column, index) => column.some(other => overlaps(item, other)) ? index + 1 : minimum, 0)
        : 0;
      let column = columns.findIndex((entries, index) => index >= first && entries.every(other => !overlaps(item, other)));
      if (column < 0) column = columns.length;
      (columns[column] ??= []).push(item);
      assignment.set(item.layoutKey, column);
    }

    const active = preview ? assignment.get(preview.layoutKey) : undefined;
    const wanted = assignment.get(preferredKey ?? "");
    const latestArrived = [...group].filter(item => arrivalOrder.has(item.layoutKey) && group.some(other => other.layoutKey !== item.layoutKey && other.startMinute === item.startMinute && other.endMinute === item.endMinute))
      .sort((left, right) => arrivalOrder.get(left.layoutKey)! - arrivalOrder.get(right.layoutKey)!).at(-1);
    const pinned = active ?? wanted ?? (latestArrived ? assignment.get(latestArrived.layoutKey) : undefined);
    const dense = columns.length > cap;
    const visible = dense
      ? cap === 1 ? [pinned ?? 0]
        : (() => {
          const limit = pinned === undefined ? cap - 1 : cap - 2;
          const chosen = wanted !== undefined && wanted !== pinned && limit > 0 ? [wanted] : [];
          for (let index = 0; index < columns.length && chosen.length < limit; index += 1) {
            if (index !== pinned && !chosen.includes(index)) chosen.push(index);
          }
          if (pinned !== undefined) chosen.push(pinned);
          return chosen.sort((a, b) => a - b);
        })()
      : columns.map((_, index) => index);
    const hiddenColumns = columns.map((_, index) => index).filter(index => !visible.includes(index));
    const summaryColumn = !dense ? -1 : cap === 1 ? -1 : pinned !== undefined ? cap - 2 : cap - 1;
    const total = dense ? cap : columns.length;
    const physicalColumn = new Map<number, number>();
    let placedColumn = 0;
    for (const column of visible) if (!dense || column !== pinned) physicalColumn.set(column, placedColumn++);
    if (dense && pinned !== undefined) physicalColumn.set(pinned, cap - 1);

    const boundaries = [...new Set(hiddenColumns.flatMap(column => columns[column].flatMap(item => [item.startMinute, item.endMinute])))].sort((a, b) => a - b);
    for (let index = 1; index < boundaries.length; index += 1) {
      const startMinute = boundaries[index - 1], endMinute = boundaries[index];
      const keys = hiddenColumns.flatMap(column => columns[column].filter(item => (!reserveSource || item.layoutKey !== dragSourceKey) && item.startMinute < endMinute && item.endMinute > startMinute).map(item => item.layoutKey));
      if (keys.length) summaries.push({ startMinute, endMinute, keys, lane: summaryColumn < 0 ? null : { column: summaryColumn, columnSpan: 1, total } });
    }
    for (const column of visible) for (const item of columns[column]) {
      const placed = physicalColumn.get(column)!;
      let columnSpan = 1;
      for (let candidate = placed + 1; candidate < total; candidate += 1) {
        const occupants = [...visible].filter((source, index) => physicalColumn.get(source) === candidate).flatMap(source => columns[source]);
        const summaryConflict = summaries.some(segment => segment.lane?.column === candidate && overlaps(item, {layoutKey: "summary", startMinute: segment.startMinute, endMinute: segment.endMinute}));
        if (summaryConflict || occupants.some(other => other.layoutKey !== item.layoutKey && overlaps(item, other))) break;
        columnSpan += 1;
      }
      lanes[item.layoutKey] = {column: placed, columnSpan, total};
    }
  }
  return {lanes, summaries};
}
