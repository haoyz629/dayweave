import { useMemo, useState } from "react";
import type { RecurringOccurrence, Tag, Task } from "../types/dayweave";
import {
  buildMonthGrid,
  calcDaySpan,
  fmtDuration,
  fmtMinutes,
  formatYearMonthCn,
  getCellLunarBadge,
  getCellWorkState,
  isDateInRange,
  shiftMonth,
} from "../utils/dateUtils";
import { layoutWeekMultiDayBars } from "../utils/monthSpanLayout";
import { tip } from "./TooltipHost";

interface MonthViewProps {
  selectedDate: string;
  todayDate: string;
  showLunar: boolean;
  tags: Tag[];
  tasks: Task[];
  occurrences: RecurringOccurrence[];
  selectedTaskId: string | null;
  pointerDropDate?: string | null;
  onSelectDate: (date: string) => void;
  onEnterDayView: (date: string) => void;
  onOpenInspector: (taskId: string) => void;
  onInspectRecurringRule?: (ruleId: string) => void;
}

const WEEKDAYS_FULL = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const SPAN_LANE_HEIGHT = 19;
const SPAN_LANE_GAP = 2;

export function MonthView({
  selectedDate,
  todayDate,
  showLunar,
  tags,
  tasks,
  occurrences,
  selectedTaskId,
  pointerDropDate = null,
  onSelectDate,
  onEnterDayView,
  onOpenInspector,
  onInspectRecurringRule,
}: MonthViewProps) {
  const [hoveredSpanTaskId, setHoveredSpanTaskId] = useState<string | null>(null);

  const tagMap = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const getColor = (tagId: string) => tagMap.get(tagId)?.color ?? "blue";
  const getTagName = (tagId: string) => tagMap.get(tagId)?.name ?? "";

  const multiDayFlexTasks = useMemo(
    () => tasks.filter((t) => t.mode === "flex" && calcDaySpan(t.dateStart, t.dateEnd) > 1),
    [tasks],
  );

  const singleDayFlexTasks = useMemo(
    () => tasks.filter((t) => t.mode === "flex" && calcDaySpan(t.dateStart, t.dateEnd) <= 1),
    [tasks],
  );

  const weeks = useMemo(() => {
    const cells = buildMonthGrid(selectedDate);
    const rows = [];
    for (let i = 0; i < 42; i += 7) {
      const weekCells = cells.slice(i, i + 7);
      const weekStart = weekCells[0].date;
      const weekEnd = weekCells[6].date;
      const spanLayout = layoutWeekMultiDayBars(multiDayFlexTasks, weekStart, weekEnd, 2);
      rows.push({
        key: weekStart,
        cells: weekCells,
        spanLayout,
      });
    }
    return rows;
  }, [selectedDate, multiDayFlexTasks]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="dw-canvas-header">
        <div className="dw-canvas-heading">
          <h2 className="dw-canvas-title tabular-nums">{formatYearMonthCn(selectedDate)}</h2>
        </div>

        <div className="dw-step-group">
          <button
            type="button"
            className="dw-btn-ghost"
            onClick={() => onSelectDate(todayDate)}
            {...tip("回到今天", { side: "bottom" })}
          >
            回到今天
          </button>
          <button
            type="button"
            className="dw-step-icon-btn"
            onClick={() => onSelectDate(shiftMonth(selectedDate, -1))}
            aria-label="上个月"
            {...tip("上个月", { side: "bottom" })}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            className="dw-step-icon-btn"
            onClick={() => onSelectDate(shiftMonth(selectedDate, 1))}
            aria-label="下个月"
            {...tip("下个月", { side: "bottom" })}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="dw-month-weekdays">
        {WEEKDAYS_FULL.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>

      <div className="dw-month-weeks win-scroll">
        {weeks.map((week) => {
          const { visibleSegments, hiddenCountByCol } = week.spanLayout;

          return (
            <div key={week.key} className="dw-month-week-row">
              {/* Layer 1: 7 Day Cells with Per-Column Span Lane Reservation */}
              <div className="dw-month-week-cells">
                {week.cells.map((cell, colIdx) => {
                  const isSel = cell.date === selectedDate;
                  const isToday = cell.date === todayDate;
                  const lunar = showLunar ? getCellLunarBadge(cell.date) : null;
                  const workState = getCellWorkState(cell.date);

                  // Reserve vertical lanes ONLY for columns actually covered by multi-day bars
                  let colLanes = 0;
                  for (const seg of visibleSegments) {
                    const col1 = colIdx + 1;
                    if (col1 >= seg.startCol && col1 < seg.startCol + seg.spanCols) {
                      colLanes = Math.max(colLanes, seg.lane + 1);
                    }
                  }
                  const spanReservePx =
                    colLanes > 0
                      ? colLanes * SPAN_LANE_HEIGHT + (colLanes - 1) * SPAN_LANE_GAP + 2
                      : 0;
                  const maxDailyBars = colLanes >= 2 ? 1 : colLanes === 1 ? 2 : 3;

                  const daySingleFlex = singleDayFlexTasks.filter((t) =>
                    isDateInRange(cell.date, t.dateStart, t.dateEnd),
                  );
                  const dayTimeline = [
                    ...tasks
                      .filter((t) => t.mode === "timeline" && t.date === cell.date)
                      .map((t) => ({
                        id: t.id,
                        kind: "task" as const,
                        ruleId: "",
                        title: t.title,
                        note: t.note.trim(),
                        startMin: t.startMin,
                        duration: t.duration,
                        tagId: t.tagId,
                        priority: t.priority,
                        done: t.done,
                      })),
                    ...occurrences
                      .filter((o) => o.mode === "timeline" && o.occurrenceDate === cell.date)
                      .map((o) => ({
                        id: o.id,
                        kind: "occ" as const,
                        ruleId: o.ruleId,
                        title: o.title,
                        note: o.note.trim(),
                        startMin: o.startMin ?? 9 * 60 + 30,
                        duration: o.duration,
                        tagId: o.tagId,
                        priority: o.priority,
                        done: o.done,
                      })),
                  ].sort((a, b) => a.startMin - b.startMin);

                  const combinedDaily = [
                    ...daySingleFlex.map((f) => ({
                      id: f.id,
                      kind: "task" as const,
                      ruleId: "",
                      label: f.title,
                      note: f.note.trim(),
                      timePrefix: "",
                      timeRange: "全天",
                      tagId: f.tagId,
                      priority: f.priority,
                      done: f.done,
                    })),
                    ...dayTimeline.map((ev) => ({
                      id: ev.id,
                      kind: ev.kind,
                      ruleId: ev.ruleId,
                      label: ev.title,
                      note: ev.note,
                      timePrefix: fmtMinutes(ev.startMin),
                      timeRange: `${fmtMinutes(ev.startMin)}–${fmtMinutes(ev.startMin + ev.duration)}（${fmtDuration(ev.duration)}）`,
                      tagId: ev.tagId,
                      priority: ev.priority,
                      done: ev.done,
                    })),
                  ];

                  const shownDaily = combinedDaily.slice(0, maxDailyBars);
                  const overflowCount =
                    Math.max(0, combinedDaily.length - shownDaily.length) + hiddenCountByCol[colIdx];

                  return (
                    <div
                      key={cell.date}
                      data-date={cell.date}
                      onClick={() => onSelectDate(cell.date)}
                      onDoubleClick={() => onEnterDayView(cell.date)}
                      className={`dw-month-cell${!cell.inMonth ? " is-outside" : ""}${
                        isSel ? " is-selected" : ""
                      }${pointerDropDate === cell.date ? " is-drop-over" : ""}`}
                    >
                      <div className="dw-month-cell-top">
                        <span
                          className={`dw-month-day-num tabular-nums${
                            isToday ? " is-today" : isSel ? " is-selected" : ""
                          }`}
                        >
                          {cell.day}
                        </span>

                        <div className="dw-month-cell-badges">
                          {workState === "rest" && <span className="dw-holiday-chip is-rest">休</span>}
                          {workState === "work" && <span className="dw-holiday-chip is-work">班</span>}
                          {lunar && (
                            <span className={`dw-month-lunar${lunar.highlight ? " is-highlight" : ""}`}>
                              {lunar.text}
                            </span>
                          )}
                        </div>
                      </div>

                      {spanReservePx > 0 && (
                        <div style={{ height: `${spanReservePx}px`, flexShrink: 0 }} aria-hidden="true" />
                      )}

                      <div className="dw-month-items">
                        {shownDaily.map((item) => {
                          const tagName = getTagName(item.tagId);
                          const itemTip = [
                            item.priority ? `[${item.priority}] ${item.label}` : item.label,
                            item.timeRange,
                            tagName,
                            item.note,
                          ]
                            .filter(Boolean)
                            .join(" · ");
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectDate(cell.date);
                                if (item.kind === "task") onOpenInspector(item.id);
                                else if (item.ruleId) onInspectRecurringRule?.(item.ruleId);
                              }}
                              className={`dw-month-item-bar ev-${getColor(item.tagId)}${
                                item.done ? " is-done" : ""
                              }`}
                              {...tip(itemTip, { side: "top" })}
                            >
                              <span className="dw-month-item-title">{item.label}</span>
                              {item.timePrefix && (
                                <span className="dw-month-item-time font-mono tabular-nums">{item.timePrefix}</span>
                              )}
                            </button>
                          );
                        })}
                        {overflowCount > 0 && (
                          <div className="dw-month-more">+{overflowCount} 项 · 见左侧</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Layer 2: Continuous Multi-Day Spanning Task Bars */}
              {visibleSegments.length > 0 && (
                <div className="dw-month-span-layer" aria-label="跨多日任务条">
                  {visibleSegments.map((seg) => {
                    const color = getColor(seg.task.tagId);
                    const isSel = selectedTaskId === seg.task.id;
                    const isHov = hoveredSpanTaskId === seg.task.id;
                    const tagName = getTagName(seg.task.tagId);
                    const spanTip = [
                      seg.task.priority ? `[${seg.task.priority}] ${seg.task.title}` : seg.task.title,
                      `${seg.task.dateStart} 至 ${seg.task.dateEnd}（共 ${seg.totalDays} 天）`,
                      tagName,
                      seg.task.note.trim(),
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <button
                        key={`${seg.task.id}-${week.key}`}
                        type="button"
                        onMouseEnter={() => setHoveredSpanTaskId(seg.task.id)}
                        onMouseLeave={() => setHoveredSpanTaskId((prev) => (prev === seg.task.id ? null : prev))}
                        onFocus={() => setHoveredSpanTaskId(seg.task.id)}
                        onBlur={() => setHoveredSpanTaskId((prev) => (prev === seg.task.id ? null : prev))}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenInspector(seg.task.id);
                        }}
                        className={`dw-month-span-bar ev-${color}${seg.task.done ? " is-done" : ""}${
                          seg.continuesLeft ? " is-cont-left" : ""
                        }${seg.continuesRight ? " is-cont-right" : ""}${isHov ? " is-hovered" : ""}${
                          isSel ? " is-selected" : ""
                        }`}
                        style={{
                          gridColumn: `${seg.startCol} / span ${seg.spanCols}`,
                          gridRow: seg.lane + 1,
                        }}
                        {...tip(spanTip, { side: "top" })}
                      >
                        <span className="dw-month-span-title">
                          {seg.continuesLeft ? "续 · " : ""}
                          {seg.task.priority === "P1" && <span className="dw-span-p1">P1</span>}
                          {seg.task.title}
                        </span>
                        <span className="dw-month-span-days font-mono tabular-nums">
                          {seg.continuesRight ? "续下周 →" : `${seg.totalDays}天`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
