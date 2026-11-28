import { useEffect, useMemo, useState } from "react";
import { TAG_COLOR_HEX } from "../types/dayweave";
import type { CalendarView, RecurringOccurrence, Tag, Task } from "../types/dayweave";
import {
  buildMonthGrid,
  buildWeekRowForDate,
  calcDayProgressLabel,
  fmtDuration,
  fmtMinutes,
  formatDateShortCn,
  formatYearMonthCn,
  getDateSubtitle,
  isDateInRange,
  shiftDate,
  shiftMonth,
  WEEKDAY_SHORT_CN,
} from "../utils/dateUtils";
import { filterPoolTasks, SHORT_TASK_MAX_MINUTES } from "../utils/poolFilter";
import type { PoolFilter } from "../utils/poolFilter";
import { buildMiniCalDotMap } from "../utils/miniCalDots";
import { FluentSelect } from "./FluentSelect";
import { tip } from "./TooltipHost";

interface WorkbenchLeftPanelProps {
  calendarView: CalendarView;
  selectedDate: string;
  todayDate: string;
  showLunar: boolean;
  tags: Tag[];
  tasks: Task[];
  occurrences: RecurringOccurrence[];
  selectedTaskId: string | null;
  onSelectDate: (date: string) => void;
  onEnterDayView: () => void;
  onOpenInspector: (taskId: string) => void;
  onInspectRecurringRule?: (ruleId: string) => void;
  onToggleTaskDone: (task: Task) => void;
  onToggleOccurrenceDone: (occ: RecurringOccurrence) => void;
  onSkipOccurrence: (occ: RecurringOccurrence) => void;
  onReturnToPool: (task: Task) => void;
  onQuickWeaveTask: (task: Task, targetDate?: string) => void;
  onUpdatePoolDuration: (task: Task, mins: number) => void;
  draggingPoolTaskId: string | null;
  pointerDropDate: string | null;
  onPoolPointerDown: (task: Task, clientX: number, clientY: number) => void;
  shouldSuppressPoolClick: () => boolean;
}

const ReturnIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-2" />
  </svg>
);

const RemoveIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
  </svg>
);

const RecurringIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" style={{ flexShrink: 0, color: "var(--w-text-2)" }} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);

const ClockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path strokeLinecap="round" d="M12 7v5l3 2" />
  </svg>
);

const SubtaskMiniIcon = () => (
  <svg width="11.5" height="11.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12l2.5 2.5L16 9" />
  </svg>
);

function formatCompactRange(start: string, end: string): string {
  const s = start.slice(5).replace("-", "/");
  const e = end.slice(5).replace("-", "/");
  return s === e ? s : `${s}–${e}`;
}

export function WorkbenchLeftPanel({
  calendarView,
  selectedDate,
  todayDate,
  showLunar,
  tags,
  tasks,
  occurrences,
  selectedTaskId,
  onSelectDate,
  onEnterDayView,
  onOpenInspector,
  onInspectRecurringRule,
  onToggleTaskDone,
  onToggleOccurrenceDone,
  onSkipOccurrence,
  onReturnToPool,
  onQuickWeaveTask,
  onUpdatePoolDuration,
  draggingPoolTaskId,
  pointerDropDate,
  onPoolPointerDown,
  shouldSuppressPoolClick,
}: WorkbenchLeftPanelProps) {
  const [miniExpanded, setMiniExpanded] = useState(false);
  const [flexCollapsed, setFlexCollapsed] = useState(false);
  const [poolFilter, setPoolFilter] = useState<PoolFilter>("all");
  const [poolTagFilter, setPoolTagFilter] = useState<string>("all");
  const [durPopoverId, setDurPopoverId] = useState<string | null>(null);

  useEffect(() => {
    if (!durPopoverId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDurPopoverId(null);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest(".dw-dur-popover, .dw-dur-chip")) {
        setDurPopoverId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [durPopoverId]);

  const tagMap = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const getTag = (tagId: string) => tagMap.get(tagId) ?? null;
  const getTaskColor = (tagId: string) => getTag(tagId)?.color ?? "blue";
  const getTaskDotHex = (tagId: string) => TAG_COLOR_HEX[getTaskColor(tagId)] ?? TAG_COLOR_HEX.blue;

  const tagFilterOptions = useMemo(
    () => [
      { value: "all", label: "全部标签" },
      ...tags.map((tg) => ({
        value: tg.id,
        label: tg.name,
        dotColor: TAG_COLOR_HEX[tg.color] ?? TAG_COLOR_HEX.blue,
      })),
    ],
    [tags],
  );

  const miniCells = useMemo(
    () => (miniExpanded ? buildMonthGrid(selectedDate) : buildWeekRowForDate(selectedDate)),
    [miniExpanded, selectedDate],
  );

  const miniDotMap = useMemo(
    () => buildMiniCalDotMap(miniCells.map((c) => c.date), tasks, occurrences),
    [miniCells, tasks, occurrences],
  );

  // Month mode: Selected Day's Woven List (timeline tasks + timeline recurring occurrences)
  const wovenItems = useMemo(() => {
    const dayTasks = tasks
      .filter((t) => t.mode === "timeline" && t.date === selectedDate)
      .map((t) => ({ kind: "task" as const, id: t.id, startMin: t.startMin, duration: t.duration, done: t.done, task: t }));
    const dayOccs = occurrences
      .filter((o) => o.mode === "timeline" && o.occurrenceDate === selectedDate)
      .map((o) => ({
        kind: "occ" as const,
        id: o.id,
        startMin: o.startMin ?? 9 * 60 + 30,
        duration: o.duration,
        done: o.done,
        occ: o,
      }));
    return [...dayTasks, ...dayOccs].sort((a, b) => a.startMin - b.startMin);
  }, [tasks, occurrences, selectedDate]);

  // Pinned Flex / Multi-Day items for selectedDate
  const flexTasks = useMemo(
    () => tasks.filter((t) => t.mode === "flex" && isDateInRange(selectedDate, t.dateStart, t.dateEnd)),
    [tasks, selectedDate],
  );
  const flexOccurrences = useMemo(
    () => occurrences.filter((o) => o.mode === "flex" && o.occurrenceDate === selectedDate),
    [occurrences, selectedDate],
  );
  const totalFlexCount = flexTasks.length + flexOccurrences.length;

  const totalDayCount = wovenItems.length + totalFlexCount;
  const totalDayDoneCount =
    wovenItems.filter((item) => item.done).length +
    flexTasks.filter((t) => t.done).length +
    flexOccurrences.filter((o) => o.done).length;

  // Scrollable Ready-to-Weave Pool
  const poolItems = useMemo(
    () => filterPoolTasks(tasks, poolFilter, poolTagFilter),
    [tasks, poolFilter, poolTagFilter],
  );

  function handleStepCalendar(dir: -1 | 1) {
    if (miniExpanded) {
      onSelectDate(shiftMonth(selectedDate, dir));
    } else {
      onSelectDate(shiftDate(selectedDate, dir * 7));
    }
  }

  const isMonth = calendarView === "month";

  return (
    <div className="dw-left-panel">
      {/* TOP AREA: Adaptive between Day Mini-Calendar and Month Full-Day Task Preview List */}
      {!isMonth ? (
        <div className="dw-minical-wrap">
          <div className="dw-minical-card">
            <div className="dw-minical-head">
              <button
                type="button"
                className="dw-minical-title-btn"
                onClick={() => setMiniExpanded((v) => !v)}
                {...tip("展开或收起月历", { side: "bottom" })}
              >
                <span>{formatYearMonthCn(selectedDate)}</span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  className={`dw-minical-arrow${miniExpanded ? " is-open" : ""}`}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                </svg>
              </button>
              <div className="dw-minical-nav">
                {selectedDate !== todayDate && (
                  <button
                    type="button"
                    className="dw-minical-today-btn"
                    onClick={() => onSelectDate(todayDate)}
                    {...tip("回到今天", { side: "bottom" })}
                  >
                    今
                  </button>
                )}
                <button
                  type="button"
                  className="dw-minical-step-btn"
                  onClick={() => handleStepCalendar(-1)}
                  aria-label={miniExpanded ? "上个月" : "上一周"}
                  {...tip(miniExpanded ? "上个月" : "上一周", { side: "bottom" })}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="dw-minical-step-btn"
                  onClick={() => handleStepCalendar(1)}
                  aria-label={miniExpanded ? "下个月" : "下一周"}
                  {...tip(miniExpanded ? "下个月" : "下一周", { side: "bottom" })}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="dw-minical-weekdays">
              {WEEKDAY_SHORT_CN.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>

            <div className="dw-minical-grid">
              {miniCells.map((cell) => {
                const isSel = cell.date === selectedDate;
                const isToday = cell.date === todayDate;
                const dotKind = miniDotMap.get(cell.date) ?? null;
                return (
                  <div
                    key={cell.date}
                    data-date={cell.date}
                    role="button"
                    tabIndex={0}
                    aria-label={cell.date}
                    onClick={() => onSelectDate(cell.date)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectDate(cell.date);
                      }
                    }}
                    className={`dw-minical-cell${pointerDropDate === cell.date ? " is-drop-over" : ""}`}
                  >
                    <div
                      className={`dw-minical-pill${
                        isSel
                          ? " is-selected"
                          : isToday
                            ? " is-today"
                            : !cell.inMonth
                              ? " is-outside"
                              : ""
                      }`}
                    >
                      <span className={`dw-minical-num tabular-nums${dotKind ? " has-dot" : ""}`}>
                        {cell.day}
                      </span>
                      {dotKind && (
                        <span className={`dw-minical-dot${dotKind === "flex" ? " is-flex" : ""}`} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="dw-minical-handle"
              onClick={() => setMiniExpanded((v) => !v)}
              aria-label="展开或收起月历"
              {...tip(miniExpanded ? "收起月历" : "展开月历", { side: "bottom" })}
            >
              <span />
            </button>
          </div>
        </div>
      ) : (
        <div className="dw-month-day-panel">
          <div className="dw-month-day-masthead">
            <div style={{ minWidth: 0 }}>
              <div className="dw-month-day-title-row">
                <span className="dw-month-day-date tabular-nums">{formatDateShortCn(selectedDate)}</span>
                <span className="dw-month-day-progress tabular-nums">
                  {totalDayCount > 0 ? `${totalDayDoneCount}/${totalDayCount}` : "0 项"}
                </span>
              </div>
              <div className="dw-month-day-sub">{getDateSubtitle(selectedDate, showLunar)}</div>
            </div>
            <button
              type="button"
              className="dw-enter-day-btn"
              onClick={onEnterDayView}
              {...tip("进入当日 24 小时时间轴", { side: "bottom" })}
            >
              <span>进日视图</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>

          <div className="dw-woven-header">
            <div className="dw-section-title-group">
              <span className="dw-section-title">当日安排</span>
              <span className="dw-section-count tabular-nums">{totalDayCount}</span>
            </div>
          </div>

          <div className="dw-woven-list win-scroll">
            {totalDayCount === 0 ? (
              <div
                style={{
                  padding: "16px 12px",
                  textAlign: "center",
                  fontSize: 12,
                  color: "var(--w-text-3)",
                  borderRadius: 8,
                  border: "1px dashed var(--w-border)",
                  background: "var(--w-surface)",
                }}
              >
                {formatDateShortCn(selectedDate)} 暂无安排
              </div>
            ) : (
              <>
                {/* Multi-day / All-day items first in full-day preview */}
                {flexTasks.map((t) => {
                  const spanBadge = calcDayProgressLabel(t.dateStart, t.dateEnd, selectedDate);
                  const compactSpanProgress = spanBadge ? spanBadge.replace(/^第\s*|\s+/g, "") : null;
                  const tg = getTag(t.tagId);
                  const subDone = t.subtasks.filter((s) => s.done).length;
                  const noteText = t.note.trim();
                  return (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenInspector(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenInspector(t.id);
                        }
                      }}
                      className={`dw-woven-item ev-${getTaskColor(t.tagId)}${t.done ? " is-done" : ""}${
                        selectedTaskId === t.id ? " is-selected" : ""
                      }`}
                    >
                      <div className="dw-woven-item-main">
                        <input
                          type="checkbox"
                          className="dw-checkbox"
                          style={{ marginTop: 2 }}
                          checked={t.done}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => onToggleTaskDone(t)}
                        />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="dw-woven-head">
                            <div className={`dw-woven-item-title${t.done ? " is-done" : ""}`}>{t.title}</div>
                            {t.priority === "P1" && <span className="dw-prio-badge is-p1">P1</span>}
                            {t.priority === "P2" && <span className="dw-prio-badge is-p2">P2</span>}
                          </div>
                          <div className="dw-woven-item-meta tabular-nums">
                            <span className={`dw-woven-meta-time${spanBadge ? " font-mono" : ""}`}>
                              {spanBadge ? formatCompactRange(t.dateStart, t.dateEnd) : "全天"}
                            </span>
                            {tg && (
                              <span className="dw-event-micro-chip">
                                <span
                                  className="dw-event-tag-dot"
                                  style={{ background: getTaskDotHex(t.tagId) }}
                                  aria-hidden="true"
                                />
                                {tg.name}
                              </span>
                            )}
                            {t.subtasks.length > 0 && (
                              <span
                                className={`dw-event-micro-chip is-mono${subDone === t.subtasks.length ? " is-complete" : ""}`}
                              >
                                <SubtaskMiniIcon />
                                {subDone}/{t.subtasks.length}
                              </span>
                            )}
                            {compactSpanProgress && (
                              <span className="dw-event-micro-chip is-mono">{compactSpanProgress}</span>
                            )}
                          </div>
                          {noteText && <div className="dw-woven-item-note">{noteText}</div>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {flexOccurrences.map((occ) => {
                  const tg = getTag(occ.tagId);
                  return (
                    <div
                      key={occ.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onInspectRecurringRule?.(occ.ruleId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onInspectRecurringRule?.(occ.ruleId);
                        }
                      }}
                      className={`dw-woven-item has-hover-action ev-${getTaskColor(occ.tagId)}${occ.done ? " is-done" : ""}`}
                    >
                      <div className="dw-woven-item-main">
                        <input
                          type="checkbox"
                          className="dw-checkbox"
                          style={{ marginTop: 2 }}
                          checked={occ.done}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => onToggleOccurrenceDone(occ)}
                        />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="dw-woven-head">
                            <div className={`dw-woven-item-title${occ.done ? " is-done" : ""}`}>
                              <RecurringIcon />
                              <span>{occ.title}</span>
                            </div>
                            {occ.priority === "P1" && <span className="dw-prio-badge is-p1">P1</span>}
                            {occ.priority === "P2" && <span className="dw-prio-badge is-p2">P2</span>}
                          </div>
                          <div className="dw-woven-item-meta tabular-nums">
                            <span className="dw-woven-meta-time">全天</span>
                            {tg && (
                              <span className="dw-event-micro-chip">
                                <span
                                  className="dw-event-tag-dot"
                                  style={{ background: getTaskDotHex(occ.tagId) }}
                                  aria-hidden="true"
                                />
                                {tg.name}
                              </span>
                            )}
                            <span className="dw-event-micro-chip">重复</span>
                          </div>
                          {occ.note.trim() && <div className="dw-woven-item-note">{occ.note.trim()}</div>}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="dw-return-pool-btn dw-woven-hover-action"
                        aria-label="移除当日重复安排"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSkipOccurrence(occ);
                        }}
                        {...tip("移除当日重复安排", { side: "left" })}
                      >
                        <RemoveIcon />
                      </button>
                    </div>
                  );
                })}

                {/* Timed items sorted chronologically */}
                {wovenItems.map((item) => {
                  if (item.kind === "task") {
                    const ev = item.task;
                    const tg = getTag(ev.tagId);
                    const subDone = ev.subtasks.filter((s) => s.done).length;
                    const noteText = ev.note.trim();
                    return (
                      <div
                        key={ev.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpenInspector(ev.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onOpenInspector(ev.id);
                          }
                        }}
                        className={`dw-woven-item${!ev.done ? " has-hover-action" : ""} ev-${getTaskColor(ev.tagId)}${ev.done ? " is-done" : ""}${
                          selectedTaskId === ev.id ? " is-selected" : ""
                        }`}
                      >
                        <div className="dw-woven-item-main">
                          <input
                            type="checkbox"
                            className="dw-checkbox"
                            style={{ marginTop: 2 }}
                            checked={ev.done}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => onToggleTaskDone(ev)}
                          />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="dw-woven-head">
                              <div className={`dw-woven-item-title${ev.done ? " is-done" : ""}`}>{ev.title}</div>
                              {ev.priority === "P1" && <span className="dw-prio-badge is-p1">P1</span>}
                              {ev.priority === "P2" && <span className="dw-prio-badge is-p2">P2</span>}
                            </div>
                            <div className="dw-woven-item-meta tabular-nums">
                              <span className="dw-woven-meta-time font-mono">
                                {fmtMinutes(ev.startMin)}–{fmtMinutes(ev.startMin + ev.duration)}
                              </span>
                              {tg && (
                                <span className="dw-event-micro-chip">
                                  <span
                                    className="dw-event-tag-dot"
                                    style={{ background: getTaskDotHex(ev.tagId) }}
                                    aria-hidden="true"
                                  />
                                  {tg.name}
                                </span>
                              )}
                              {ev.subtasks.length > 0 && (
                                <span
                                  className={`dw-event-micro-chip is-mono${subDone === ev.subtasks.length ? " is-complete" : ""}`}
                                >
                                  <SubtaskMiniIcon />
                                  {subDone}/{ev.subtasks.length}
                                </span>
                              )}
                              <span className="dw-event-micro-chip is-mono">{fmtDuration(ev.duration)}</span>
                            </div>
                            {noteText && <div className="dw-woven-item-note">{noteText}</div>}
                          </div>
                        </div>
                        {!ev.done && (
                          <button
                            type="button"
                            className="dw-return-pool-btn dw-woven-hover-action"
                            aria-label="移回待安排"
                            onClick={(e) => {
                              e.stopPropagation();
                              onReturnToPool(ev);
                            }}
                            {...tip("移回待安排", { side: "left" })}
                          >
                            <ReturnIcon />
                          </button>
                        )}
                      </div>
                    );
                  }
                  const occ = item.occ;
                  const tg = getTag(occ.tagId);
                  const noteText = occ.note.trim();
                  return (
                    <div
                      key={occ.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onInspectRecurringRule?.(occ.ruleId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onInspectRecurringRule?.(occ.ruleId);
                        }
                      }}
                      className={`dw-woven-item has-hover-action ev-${getTaskColor(occ.tagId)}${occ.done ? " is-done" : ""}`}
                    >
                      <div className="dw-woven-item-main">
                        <input
                          type="checkbox"
                          className="dw-checkbox"
                          style={{ marginTop: 2 }}
                          checked={occ.done}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => onToggleOccurrenceDone(occ)}
                        />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="dw-woven-head">
                            <div className={`dw-woven-item-title${occ.done ? " is-done" : ""}`}>
                              <RecurringIcon />
                              <span>{occ.title}</span>
                            </div>
                            {occ.priority === "P1" && <span className="dw-prio-badge is-p1">P1</span>}
                            {occ.priority === "P2" && <span className="dw-prio-badge is-p2">P2</span>}
                          </div>
                          <div className="dw-woven-item-meta tabular-nums">
                            <span className="dw-woven-meta-time font-mono">
                              {fmtMinutes(item.startMin)}–{fmtMinutes(item.startMin + occ.duration)}
                            </span>
                            {tg && (
                              <span className="dw-event-micro-chip">
                                <span
                                  className="dw-event-tag-dot"
                                  style={{ background: getTaskDotHex(occ.tagId) }}
                                  aria-hidden="true"
                                />
                                {tg.name}
                              </span>
                            )}
                            <span className="dw-event-micro-chip is-mono">{fmtDuration(occ.duration)}</span>
                          </div>
                          {noteText && <div className="dw-woven-item-note">{noteText}</div>}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="dw-return-pool-btn dw-woven-hover-action"
                        aria-label="移除当日重复安排"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSkipOccurrence(occ);
                        }}
                        {...tip("移除当日重复安排", { side: "left" })}
                      >
                        <RemoveIcon />
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}

      {/* MIDDLE PINNED (Day View): Selected Day's Untimed / Multi-Day */}
      {!isMonth && (
        <div className="dw-flex-section">
          <button
            type="button"
            className="dw-section-toggle"
            aria-expanded={!flexCollapsed}
            onClick={() => setFlexCollapsed((v) => !v)}
          >
            <div className="dw-section-title-group">
              <span className="dw-section-title">全天 / 多日</span>
              <span className="dw-section-count tabular-nums">{totalFlexCount}</span>
            </div>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              style={{
                color: "var(--w-text-3)",
                transform: flexCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                transition: "transform 160ms var(--w-ease)",
              }}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {!flexCollapsed && (
            <div className="dw-flex-list win-scroll">
              {totalFlexCount === 0 ? (
                <div style={{ fontSize: 12, color: "var(--w-text-3)", padding: "2px 0" }}>
                  当日暂无全天或多日任务
                </div>
              ) : (
                <>
                  {flexTasks.map((t) => {
                    const spanBadge = calcDayProgressLabel(t.dateStart, t.dateEnd, selectedDate);
                    const subDone = t.subtasks.filter((s) => s.done).length;
                    const rangeLabel = formatCompactRange(t.dateStart, t.dateEnd);
                    const flexTip = [
                      t.title,
                      spanBadge ? `${spanBadge}（${rangeLabel}）` : "全天",
                      t.note.trim(),
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <div
                        key={t.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpenInspector(t.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onOpenInspector(t.id);
                          }
                        }}
                        className={`dw-flex-card${selectedTaskId === t.id ? " is-selected" : ""}`}
                        style={{ boxShadow: `inset 2.5px 0 0 0 ${getTaskDotHex(t.tagId)}` }}
                        {...tip(flexTip, { side: "right" })}
                      >
                        <div className="dw-flex-card-left">
                          <input
                            type="checkbox"
                            className="dw-checkbox"
                            checked={t.done}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => onToggleTaskDone(t)}
                          />
                          <span className={`dw-flex-card-title${t.done ? " is-done" : ""}`}>{t.title}</span>
                        </div>
                        <div className="dw-flex-card-right">
                          {t.subtasks.length > 0 && (
                            <span className={`dw-event-sub-chip${subDone === t.subtasks.length ? " is-complete" : ""}`}>
                              {subDone}/{t.subtasks.length}
                            </span>
                          )}
                          {t.priority === "P1" && <span className="dw-prio-badge is-p1">P1</span>}
                          {t.priority === "P2" && <span className="dw-prio-badge is-p2">P2</span>}
                          <span className="dw-meta-inline tabular-nums">{spanBadge ?? "全天"}</span>
                        </div>
                      </div>
                    );
                  })}
                  {flexOccurrences.map((occ) => (
                    <div
                      key={occ.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onInspectRecurringRule?.(occ.ruleId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onInspectRecurringRule?.(occ.ruleId);
                        }
                      }}
                      className="dw-flex-card has-hover-action"
                      style={{ boxShadow: `inset 2.5px 0 0 0 ${getTaskDotHex(occ.tagId)}` }}
                    >
                      <div className="dw-flex-card-left">
                        <input
                          type="checkbox"
                          className="dw-checkbox"
                          checked={occ.done}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => onToggleOccurrenceDone(occ)}
                        />
                        <RecurringIcon />
                        <span className={`dw-flex-card-title${occ.done ? " is-done" : ""}`}>
                          {occ.title}
                        </span>
                      </div>
                      <div className="dw-flex-card-right">
                        {occ.priority === "P1" && <span className="dw-prio-badge is-p1">P1</span>}
                        {occ.priority === "P2" && <span className="dw-prio-badge is-p2">P2</span>}
                        <span className="dw-meta-inline">全天</span>
                      </div>
                      <button
                        type="button"
                        className="dw-return-pool-btn dw-flex-hover-action"
                        aria-label="移除当日重复安排"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSkipOccurrence(occ);
                        }}
                        {...tip("移除当日重复安排", { side: "left" })}
                      >
                        <RemoveIcon />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* BOTTOM SCROLLABLE: Unscheduled Task Pool ("待安排") */}
      <div className="dw-pool-section">
        <div className="dw-pool-head">
          <div className="dw-section-title-group">
            <span className="dw-section-title">待安排</span>
            <span className="dw-section-count tabular-nums">{poolItems.length}</span>
          </div>
        </div>

        <div className="dw-pool-toolbar">
          <div className="dw-pool-seg" role="group" aria-label="待安排筛选">
            <span
              className="dw-pool-seg-thumb"
              style={{
                transform: `translateX(${poolFilter === "all" ? 0 : poolFilter === "P1" ? 100 : 200}%)`,
              }}
              aria-hidden="true"
            />
            {(
              [
                ["all", "全部"],
                ["P1", "P1"],
                ["short", "短时"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={poolFilter === k}
                onClick={() => setPoolFilter(k)}
                className={`dw-pool-seg-btn${poolFilter === k ? " is-active" : ""}`}
                {...(k === "short" ? tip(`预计耗时 ≤ ${SHORT_TASK_MAX_MINUTES} 分钟`, { side: "top" }) : {})}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="dw-pool-tag-select">
            <FluentSelect
              compact
              ariaLabel="按标签筛选待安排"
              value={poolTagFilter}
              options={tagFilterOptions}
              onChange={setPoolTagFilter}
            />
          </div>
        </div>

        <div className="dw-pool-list win-scroll">
          {poolItems.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 8px", fontSize: 12, color: "var(--w-text-3)" }}>
              当前筛选下暂无待安排任务
            </div>
          ) : (
            poolItems.map((t) => {
              const showPop = durPopoverId === t.id;
              const tg = getTag(t.tagId);
              const subDone = t.subtasks.filter((s) => s.done).length;
              const noteText = t.note.trim();
              return (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    if ((e.target as HTMLElement).closest("button, input, .dw-dur-popover")) return;
                    onPoolPointerDown(t, e.clientX, e.clientY);
                  }}
                  onClick={() => {
                    if (shouldSuppressPoolClick()) return;
                    onOpenInspector(t.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenInspector(t.id);
                    }
                  }}
                  className={`dw-pool-card${selectedTaskId === t.id ? " is-selected" : ""}${
                    draggingPoolTaskId === t.id ? " is-dragging" : ""
                  }`}
                >
                  <div className="dw-pool-card-top">
                    <div className="dw-pool-card-title">{t.title}</div>
                    <button
                      type="button"
                      className="dw-weave-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickWeaveTask(t);
                      }}
                      {...tip(`排入 ${formatDateShortCn(selectedDate)} 空闲时段`, { side: "left" })}
                    >
                      排入
                    </button>
                  </div>

                  {noteText && <div className="dw-pool-card-note">{noteText}</div>}

                  <div className="dw-pool-card-meta">
                    {tg && (
                      <span className="dw-pool-tag-inline">
                        <span
                          className="dw-section-dot"
                          style={{ background: TAG_COLOR_HEX[tg.color] ?? TAG_COLOR_HEX.blue }}
                          aria-hidden="true"
                        />
                        {tg.name}
                      </span>
                    )}
                    {t.priority === "P1" && <span className="dw-prio-badge is-p1">P1</span>}
                    {t.priority === "P2" && <span className="dw-prio-badge is-p2">P2</span>}
                    {t.subtasks.length > 0 && (
                      <span className={`dw-event-sub-chip${subDone === t.subtasks.length ? " is-complete" : ""}`}>
                        <SubtaskMiniIcon />
                        {subDone}/{t.subtasks.length}
                      </span>
                    )}
                    <button
                      type="button"
                      className="dw-dur-chip"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDurPopoverId((prev) => (prev === t.id ? null : t.id));
                      }}
                      {...tip("修改预计耗时", { side: "top" })}
                    >
                      <ClockIcon />
                      <span className="tabular-nums">{fmtDuration(t.duration)}</span>
                    </button>
                  </div>

                  {showPop && (
                    <div className="dw-dur-popover" onClick={(e) => e.stopPropagation()}>
                      {[15, 30, 45, 60, 90, 120].map((mins) => (
                        <button
                          key={mins}
                          type="button"
                          onClick={() => {
                            onUpdatePoolDuration(t, mins);
                            setDurPopoverId(null);
                          }}
                          className={`dw-dur-opt${t.duration === mins ? " is-active" : ""}`}
                        >
                          {fmtDuration(mins)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
