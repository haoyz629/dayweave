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
