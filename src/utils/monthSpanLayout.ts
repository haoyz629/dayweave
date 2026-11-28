import type { Task } from "../types/dayweave";

function diffIsoDays(startStr: string, endStr: string): number {
  const [sy, sm, sd] = startStr.split("-").map(Number);
  const [ey, em, ed] = endStr.split("-").map(Number);
  const ms = Date.UTC(ey || 2026, (em || 1) - 1, ed || 1) - Date.UTC(sy || 2026, (sm || 1) - 1, sd || 1);
  return Math.round(ms / 86_400_000);
}

export interface WeekSpanSegment {
  task: Task;
  startCol: number; // 1..7 (CSS Grid 1-indexed)
  spanCols: number; // 1..7
  lane: number; // 0-indexed horizontal track
  continuesLeft: boolean;
  continuesRight: boolean;
  totalDays: number;
}

export interface WeekSpanLayout {
  visibleSegments: WeekSpanSegment[];
  visibleLaneCount: number;
  hiddenCountByCol: number[]; // length 7 (index 0..6 for Mon..Sun)
}

export function layoutWeekMultiDayBars(
  multiDayTasks: Task[],
  weekStart: string,
  weekEnd: string,
  maxVisibleLanes = 2,
): WeekSpanLayout {
  type RawSeg = Omit<WeekSpanSegment, "lane">;
  const rawSegments: RawSeg[] = [];

  for (const task of multiDayTasks) {
    if (task.mode !== "flex") continue;
    const totalDays = Math.max(1, diffIsoDays(task.dateStart, task.dateEnd) + 1);
    if (totalDays <= 1) continue;
    if (task.dateEnd < weekStart || task.dateStart > weekEnd) continue;

    const segStart = task.dateStart < weekStart ? weekStart : task.dateStart;
    const segEnd = task.dateEnd > weekEnd ? weekEnd : task.dateEnd;
    const startCol = diffIsoDays(weekStart, segStart) + 1;
    const endCol = diffIsoDays(weekStart, segEnd) + 1;
    const spanCols = Math.max(1, endCol - startCol + 1);

    rawSegments.push({
      task,
      startCol,
      spanCols,
      continuesLeft: task.dateStart < weekStart,
      continuesRight: task.dateEnd > weekEnd,
      totalDays,
    });
  }

  rawSegments.sort(
    (a, b) =>
      a.startCol - b.startCol ||
      b.spanCols - a.spanCols ||
      a.task.dateStart.localeCompare(b.task.dateStart) ||
      a.task.id.localeCompare(b.task.id),
  );

  const laneEnds: number[] = [];
  const visibleSegments: WeekSpanSegment[] = [];
  const hiddenCountByCol = [0, 0, 0, 0, 0, 0, 0];

  for (const seg of rawSegments) {
    const segEndCol = seg.startCol + seg.spanCols - 1;
    let lane = laneEnds.findIndex((endCol) => endCol < seg.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = segEndCol;

    if (lane < maxVisibleLanes) {
      visibleSegments.push({ ...seg, lane });
    } else {
      for (let c = seg.startCol; c <= segEndCol; c++) {
        hiddenCountByCol[c - 1] += 1;
      }
    }
  }

  const visibleLaneCount = Math.min(maxVisibleLanes, laneEnds.length);
  return { visibleSegments, visibleLaneCount, hiddenCountByCol };
}
