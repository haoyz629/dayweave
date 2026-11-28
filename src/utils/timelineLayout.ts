export interface TimelineItemSpan {
  id: string;
  startMin: number;
  duration: number;
}

export interface OverlapPlacement {
  col: number;
  totalCols: number;
}

/**
 * Connected-component overlap column layout:
 * Overlapping intervals share a cluster and are assigned evenly-divided columns
 * (`width = 100% / totalCols`) without hiding any item.
 */
export function layoutOverlappingItems(items: TimelineItemSpan[]): Map<string, OverlapPlacement> {
  const sorted = [...items].sort(
    (a, b) => a.startMin - b.startMin || b.duration - a.duration || a.id.localeCompare(b.id),
  );
  const placed = new Map<string, OverlapPlacement>();
  let cluster: TimelineItemSpan[] = [];
  let clusterEnd = -1;

  function flush() {
    if (!cluster.length) return;
    const colEnds: number[] = [];
    for (const item of cluster) {
      let col = colEnds.findIndex((end) => end <= item.startMin);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(0);
      }
      colEnds[col] = item.startMin + Math.max(15, item.duration);
      placed.set(item.id, { col, totalCols: 0 });
    }
    const totalCols = colEnds.length;
    for (const item of cluster) {
      const entry = placed.get(item.id);
      if (entry) entry.totalCols = totalCols;
    }
    cluster = [];
  }

  for (const item of sorted) {
    const itemEnd = item.startMin + Math.max(15, item.duration);
    if (cluster.length > 0 && item.startMin >= clusterEnd) {
      flush();
    }
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, itemEnd);
  }
  flush();
  return placed;
}

export function snapMinutes(mins: number, step: number): number {
  return Math.round(mins / step) * step;
}

/**
 * Finds the best available timeslot on a day for quick-weave (`织入`) or calendar drop.
 * Prefers slots starting from `preferredStartMin` (e.g. next quarter-hour if today, or 09:30),
 * scanning 08:00–22:00 in `snapStep` increments before falling back to `preferredStartMin`.
 */
export function findAvailableSlot(
  occupied: { startMin: number; duration: number }[],
  duration: number,
  options: { preferredStartMin?: number; snapStep?: number; minStart?: number; maxEnd?: number } = {},
): number {
  const step = options.snapStep ?? 15;
  const minStart = options.minStart ?? 8 * 60;
  const maxEnd = options.maxEnd ?? 22 * 60;
  const dur = Math.max(15, duration);
  const preferred = Math.max(
    minStart,
    Math.min(maxEnd - dur, snapMinutes(options.preferredStartMin ?? 9 * 60 + 30, step)),
  );

  const isFree = (candidate: number) =>
    !occupied.some(
      (o) => candidate < o.startMin + Math.max(15, o.duration) && candidate + dur > o.startMin,
    );

  // Scan forward from preferred start through maxEnd, then wrap from minStart to preferred
  for (let t = preferred; t + dur <= maxEnd; t += step) {
    if (isFree(t)) return t;
  }
  for (let t = minStart; t < preferred && t + dur <= maxEnd; t += step) {
    if (isFree(t)) return t;
  }
  // If entire daytime is packed, check 00:00..24:00
  for (let t = maxEnd; t + dur <= 24 * 60; t += step) {
    if (isFree(t)) return t;
  }
  return preferred;
}
