import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { TAG_COLOR_HEX } from "../types/dayweave";
import type { AppSettings, Priority, RecurringOccurrence, Tag, Task } from "../types/dayweave";
import {
  fmtDuration,
  fmtMinutes,
  formatDateLongCn,
  formatDateShortCn,
  getCellWorkState,
  getDateSubtitle,
  shiftDate,
} from "../utils/dateUtils";
import { extractTagFromText } from "../utils/quickCapture";
import { layoutOverlappingItems, snapMinutes } from "../utils/timelineLayout";
import { useSaveAttempt } from "../utils/useSaveAttempt";
import { FluentSelect } from "./FluentSelect";
import { tip } from "./TooltipHost";

const TOTAL_MINS = 24 * 60; // 1440px (1px = 1 minute)

export interface PendingOccReschedule {
  occ: RecurringOccurrence;
  origStartMin: number;
  origDuration: number;
  nextStartMin: number;
  nextDuration: number;
}

interface DayTimelineProps {
  selectedDate: string;
  todayDate: string;
  nowMinutes: number;
  settings: AppSettings;
  tags: Tag[];
  tasks: Task[];
  occurrences: RecurringOccurrence[];
  selectedTaskId: string | null;
  justWovenTaskId?: string | null;
  pointerDropGhost?: { top: number; height: number; title: string } | null;
  pendingOccReschedule?: PendingOccReschedule | null;
  onSelectDate: (date: string) => void;
  onOpenInspector: (taskId: string) => void;
  onInspectRecurringRule?: (ruleId: string) => void;
  onToggleTaskDone: (task: Task) => void;
  onToggleOccurrenceDone: (occ: RecurringOccurrence) => void;
  onSkipOccurrence: (occ: RecurringOccurrence) => void;
  onReturnToPool: (task: Task) => void;
  onMoveOrResizeTask: (task: Task, nextStartMin: number, nextDuration: number) => void;
  onRequestRescheduleOccurrence: (
    occ: RecurringOccurrence,
    origStartMin: number,
    origDuration: number,
    nextStartMin: number,
    nextDuration: number,
  ) => void;
  onInlineCreateTask: (
    title: string,
    tagId: string,
    priority: Priority,
    date: string,
    startMin: number,
    duration: number,
  ) => Promise<boolean>;
  onLocateTodayToast: (msg: string) => void;
}

interface DragInteraction {
  kind: "move" | "resize-top" | "resize-bottom";
  entityKind: "task" | "occ";
  entityId: string;
  startY: number;
  origStart: number;
  origDur: number;
  curStart: number;
  curDur: number;
  moved: boolean;
}

interface SelectCreateInteraction {
  date: string;
  startY: number;
  anchorX: number;
  anchorMin: number;
  anchorStep: number;
  curStart: number;
  curEnd: number;
  moved: boolean;
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
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" style={{ flexShrink: 0, color: "var(--w-text-2)" }} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);

const SubtaskIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12l2.5 2.5L16 9" />
  </svg>
);

const NoteIcon = () => (
  <svg width="11.5" height="11.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" style={{ flexShrink: 0 }} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h10" />
  </svg>
);

const NextStepIcon = () => (
  <svg width="11.5" height="11.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ flexShrink: 0 }} aria-hidden="true">
    <circle cx="12" cy="12" r="8" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 9l3.5 3-3.5 3" />
  </svg>
);

export function DayTimeline({
  selectedDate,
  todayDate,
  nowMinutes,
  settings,
  tags,
  tasks,
  occurrences,
  selectedTaskId,
  justWovenTaskId,
  pointerDropGhost,
  pendingOccReschedule,
  onSelectDate,
  onOpenInspector,
  onInspectRecurringRule,
  onToggleTaskDone,
  onToggleOccurrenceDone,
  onSkipOccurrence,
  onReturnToPool,
  onMoveOrResizeTask,
  onRequestRescheduleOccurrence,
  onInlineCreateTask,
  onLocateTodayToast,
}: DayTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);
  const didInitialScrollRef = useRef(false);

  const [dragState, setDragState] = useState<DragInteraction | null>(null);
  const [selectState, setSelectState] = useState<SelectCreateInteraction | null>(null);
  const [inlineRange, setInlineRange] = useState<{ date: string; startMin: number; duration: number; anchorX: number } | null>(null);
  const [inlineTitle, setInlineTitle] = useState("");
  const [inlineTagId, setInlineTagId] = useState<string>("");
  const [inlinePriority, setInlinePriority] = useState<Priority>("");
  const { pending, saving, save } = useSaveAttempt();

  const tagMap = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const getTag = (tagId: string) => tagMap.get(tagId) ?? null;
  const getColorClass = (tagId: string) => getTag(tagId)?.color ?? "blue";

  const inlineTagOptions = useMemo(
    () => [
      { value: "", label: "无标签（默认蓝）", dotColor: TAG_COLOR_HEX.blue },
      ...tags.map((tg) => ({
        value: tg.id,
        label: tg.name,
        dotColor: TAG_COLOR_HEX[tg.color] ?? TAG_COLOR_HEX.blue,
      })),
    ],
    [tags],
  );

  const inlinePriorityOptions = useMemo(
    () => [
      { value: "" as Priority, label: "普通", dotColor: "#64748B" },
      { value: "P1" as Priority, label: "P1 紧急", dotColor: "#DC4C64" },
      { value: "P2" as Priority, label: "P2 重要", dotColor: "#D97706" },
    ],
    [],
  );

  const dayTasks = useMemo(
    () => tasks.filter((t) => t.mode === "timeline" && t.date === selectedDate),
    [tasks, selectedDate],
  );
  const dayOccs = useMemo(
    () => occurrences.filter((o) => o.mode === "timeline" && o.occurrenceDate === selectedDate),
    [occurrences, selectedDate],
  );

  // Initial scroll to ~08:00 (or 1.5h before current time if within working hours)
  useEffect(() => {
    if (didInitialScrollRef.current || !scrollRef.current) return;
    didInitialScrollRef.current = true;
    const target = nowMinutes >= 8 * 60 && nowMinutes <= 22 * 60 ? Math.max(0, nowMinutes - 140) : 8 * 60 - 20;
    scrollRef.current.scrollTop = target;
  }, [nowMinutes]);

  // Auto-scroll smoothly to a freshly woven task so it never disappears offscreen
  useEffect(() => {
    if (!justWovenTaskId || !scrollRef.current) return;
    const targetTask = dayTasks.find((t) => t.id === justWovenTaskId);
    if (!targetTask) return;
    scrollRef.current.scrollTo({
      top: Math.max(0, targetTask.startMin - 120),
      behavior: "smooth",
    });
  }, [justWovenTaskId, dayTasks]);

  useEffect(() => {
    if (inlineRange) {
      window.setTimeout(() => inlineInputRef.current?.focus(), 20);
    }
  }, [inlineRange]);

  // Dismiss empty inline-create popover when clicking outside (or on an existing event block)
  useEffect(() => {
    if (!inlineRange) return;
    function onPointerDown(e: PointerEvent) {
      if (pending.current || inlineTitle.trim()) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(".dw-inline-create, .dw-fselect-menu")) return;
      if (target?.closest(".dw-timeline-grid") && !target?.closest(".dw-event-block")) return;
      setInlineRange(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [inlineRange, inlineTitle, pending]);

  // Global mousemove / mouseup / Escape listeners for drag, resize & select-create
  useEffect(() => {
    if (!dragState && !selectState) return;

    function dragAt(st: DragInteraction, e: MouseEvent) {
      const dy = e.clientY - st.startY;
      if (!st.moved && Math.abs(dy) <= 3) return st;
      const step = e.altKey ? 5 : settings.snapStep;
      const end = st.origStart + st.origDur;
      let curStart = st.origStart;
      let curDur = st.origDur;
      if (dy !== 0) {
        const snappedStart = snapMinutes(st.origStart + dy, step);
        if (st.kind === "resize-bottom") {
          const snappedEnd = snapMinutes(end + dy, step);
          curDur = Math.max(15, Math.min(TOTAL_MINS, snappedEnd) - st.origStart);
        } else if (st.kind === "resize-top") {
          curStart = Math.max(0, Math.min(end - 15, snappedStart));
          curDur = end - curStart;
        } else {
          curStart = Math.max(0, Math.min(TOTAL_MINS - st.origDur, snappedStart));
        }
      }
      return { ...st, curStart, curDur, moved: true };
    }

    function selectAt(st: SelectCreateInteraction, e: MouseEvent): SelectCreateInteraction {
      const dy = e.clientY - st.startY;
      if (!st.moved && Math.abs(dy) <= 6) return st;
      const grid = gridRef.current;
      if (!grid) return st;
      const scrollEl = scrollRef.current;
      if (scrollEl) {
        const scrollRect = scrollEl.getBoundingClientRect();
        if (e.clientY < scrollRect.top + 44) {
          scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop - 12);
        } else if (e.clientY > scrollRect.bottom - 44) {
          scrollEl.scrollTop += 12;
        }
      }
      const step = e.altKey ? 5 : settings.snapStep;
      const rect = grid.getBoundingClientRect();
      const relY = Math.max(0, Math.min(TOTAL_MINS, e.clientY - rect.top));
      const baseEnd = Math.min(TOTAL_MINS, st.anchorMin + st.anchorStep);
      let s: number;
      let en: number;
      if (relY >= st.anchorMin) {
        s = st.anchorMin;
        const ceilEnd = Math.ceil(relY / step) * step;
        en = Math.min(TOTAL_MINS, Math.max(s + Math.max(15, step), ceilEnd));
      } else {
        const floorStart = Math.floor(relY / step) * step;
        s = Math.max(0, Math.min(st.anchorMin, floorStart));
        en = Math.min(TOTAL_MINS, Math.max(s + 15, baseEnd));
      }
      return {
        ...st,
        anchorX: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
        curStart: s,
        curEnd: en,
        moved: true,
      };
    }

    function handleMouseMove(e: MouseEvent) {
      if (selectState) {
        setSelectState((prev) => (prev ? selectAt(prev, e) : null));
        return;
      }
      if (dragState) setDragState((prev) => (prev ? dragAt(prev, e) : null));
    }

    function handleMouseUp(e: MouseEvent) {
      if (selectState) {
        const st = selectAt(selectState, e);
        setSelectState(null);
        if (st.moved) {
          setInlineRange({
            date: st.date,
            startMin: st.curStart,
            duration: Math.max(15, st.curEnd - st.curStart),
            anchorX: st.anchorX,
          });
          setInlineTitle("");
          setInlineTagId(tags[0]?.id ?? "");
          setInlinePriority("");
        }
        return;
      }

      if (dragState) {
        const st = dragAt(dragState, e);
        setDragState(null);
        if (!st.moved) {
          if (st.entityKind === "task") {
            onOpenInspector(st.entityId);
          } else {
            const occ = dayOccs.find((o) => o.id === st.entityId);
            if (occ) onInspectRecurringRule?.(occ.ruleId);
          }
        } else if (st.entityKind === "task") {
          const task = tasks.find((t) => t.id === st.entityId);
          if (task && (task.startMin !== st.curStart || task.duration !== st.curDur)) {
            onMoveOrResizeTask(task, st.curStart, st.curDur);
          }
        } else {
          const occ = dayOccs.find((o) => o.id === st.entityId);
          if (occ && (st.origStart !== st.curStart || st.origDur !== st.curDur)) {
            onRequestRescheduleOccurrence(occ, st.origStart, st.origDur, st.curStart, st.curDur);
          }
        }
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setDragState(null);
        setSelectState(null);
      }
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    dragState,
    selectState,
    settings.snapStep,
    tags,
    tasks,
    dayOccs,
    onOpenInspector,
    onInspectRecurringRule,
    onMoveOrResizeTask,
    onRequestRescheduleOccurrence,
  ]);

  const inlineResolvedTagId = useMemo(() => {
    const parsed = extractTagFromText(inlineTitle, tags).tagId;
    if (parsed) return parsed;
    return tags.some((tg) => tg.id === inlineTagId) ? inlineTagId : "";
  }, [inlineTitle, inlineTagId, tags]);

  const inlineResolvedPriority: Priority = useMemo(() => {
    if (/#P1(?=\s|$)/i.test(inlineTitle)) return "P1";
    if (/#P2(?=\s|$)/i.test(inlineTitle)) return "P2";
    return inlinePriority;
  }, [inlineTitle, inlinePriority]);

  const activeGhost = useMemo(() => {
    if (selectState && selectState.moved && selectState.date === selectedDate) {
      const dur = Math.max(15, selectState.curEnd - selectState.curStart);
      return {
        kind: "select" as const,
        top: selectState.curStart,
        height: dur,
        label: "松手新建安排",
        timeRange: `${fmtMinutes(selectState.curStart)}–${fmtMinutes(selectState.curEnd)}`,
        right: fmtDuration(dur),
        colorClass: "",
        priority: "" as Priority,
      };
    }
    if (inlineRange && inlineRange.date === selectedDate) {
      const cleanedText = extractTagFromText(inlineTitle, tags).cleaned
        .replace(/#P[123](?=\s|$)/gi, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
      return {
        kind: "inline" as const,
        top: inlineRange.startMin,
        height: inlineRange.duration,
        label: cleanedText || inlineTitle.trim() || "新建安排",
        timeRange: `${fmtMinutes(inlineRange.startMin)}–${fmtMinutes(inlineRange.startMin + inlineRange.duration)}`,
        right: fmtDuration(inlineRange.duration),
        colorClass: inlineResolvedTagId ? `ev-${getColorClass(inlineResolvedTagId)}` : "",
        priority: inlineResolvedPriority,
      };
    }
    if (pointerDropGhost) {
      return {
        kind: "drop" as const,
        top: pointerDropGhost.top,
        height: pointerDropGhost.height,
        label: pointerDropGhost.title,
        timeRange: `${fmtMinutes(pointerDropGhost.top)}–${fmtMinutes(pointerDropGhost.top + pointerDropGhost.height)}`,
        right: fmtDuration(pointerDropGhost.height),
        colorClass: "",
        priority: "" as Priority,
      };
    }
    return null;
  }, [selectState, inlineRange, inlineTitle, inlineResolvedTagId, inlineResolvedPriority, tags, pointerDropGhost, selectedDate]);

  // Compute combined overlap layout (including live dragged, pending reschedule, AND active select/drop ghost!)
  const layoutMap = useMemo(() => {
    const spans = [
      ...dayTasks.map((t) => {
        const live = dragState && dragState.entityKind === "task" && dragState.entityId === t.id && dragState.moved;
        return {
          id: t.id,
          startMin: live ? dragState.curStart : t.startMin,
          duration: live ? dragState.curDur : t.duration,
        };
      }),
      ...dayOccs.map((o) => {
        const live = dragState && dragState.entityKind === "occ" && dragState.entityId === o.id && dragState.moved;
        const pendingMatch = pendingOccReschedule && pendingOccReschedule.occ.id === o.id;
        return {
          id: o.id,
          startMin: live
            ? dragState.curStart
            : pendingMatch
              ? pendingOccReschedule.nextStartMin
              : (o.startMin ?? 9 * 60 + 30),
          duration: live
            ? dragState.curDur
            : pendingMatch
              ? pendingOccReschedule.nextDuration
              : o.duration,
        };
      }),
      ...(activeGhost
        ? [{ id: "__ghost__", startMin: activeGhost.top, duration: activeGhost.height }]
        : []),
    ];
    return layoutOverlappingItems(spans);
  }, [dayTasks, dayOccs, dragState, pendingOccReschedule, activeGhost]);

  const totalCount = dayTasks.length + dayOccs.length;
  const doneCount = dayTasks.filter((t) => t.done).length + dayOccs.filter((o) => o.done).length;
  const progressRatio = totalCount > 0 ? doneCount / totalCount : 0;
  const workState = getCellWorkState(selectedDate);
  const isToday = selectedDate === todayDate;

  function handleGridMouseDown(e: React.MouseEvent) {
    if (!settings.enableDragCreate || e.button !== 0) return;
    if (pending.current || (inlineRange && inlineTitle.trim())) return;
    if ((e.target as HTMLElement).closest(".dw-event-block, .dw-inline-create")) return;
    if (!gridRef.current) return;
    setInlineRange(null);
    const rect = gridRef.current.getBoundingClientRect();
    const relY = Math.max(0, Math.min(TOTAL_MINS, e.clientY - rect.top));
    const step = e.altKey ? 5 : settings.snapStep;
    const anchor = Math.max(0, Math.min(TOTAL_MINS - 15, Math.floor(relY / step) * step));
    const anchorStep = Math.max(15, step);
    setSelectState({
      date: selectedDate,
      startY: e.clientY,
      anchorX: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
      anchorMin: anchor,
      anchorStep,
      curStart: anchor,
      curEnd: Math.min(TOTAL_MINS, anchor + anchorStep),
      moved: false,
    });
  }

  function handleGridDoubleClick(e: React.MouseEvent) {
    if (pending.current || (inlineRange && inlineTitle.trim())) return;
    if ((e.target as HTMLElement).closest(".dw-event-block, .dw-inline-create")) return;
    if (!gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const relY = Math.max(0, Math.min(TOTAL_MINS, e.clientY - rect.top));
    const dur = settings.defaultDuration;
    const startMin = Math.max(0, Math.min(TOTAL_MINS - dur, snapMinutes(relY, settings.snapStep)));
    setInlineRange({
      date: selectedDate,
      startMin,
      duration: dur,
      anchorX: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
    });
    setInlineTitle("");
    setInlineTagId(tags[0]?.id ?? "");
    setInlinePriority("");
  }

  async function handleInlineSubmit(e: FormEvent) {
    e.preventDefault();
    if (!inlineRange || pending.current) return;
    const raw = inlineTitle.trim();
    if (!raw) {
      inlineInputRef.current?.focus();
      return;
    }
    const { tagId, cleaned } = extractTagFromText(raw, tags);
    const titleWithoutPrio = cleaned
      .replace(/#P[123](?=\s|$)/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    const { date, startMin, duration } = inlineRange;
    const resolvedTag = tagId || (tags.some((tg) => tg.id === inlineTagId) ? inlineTagId : "");
    const resolvedPrio: Priority = /#P1(?=\s|$)/i.test(raw)
      ? "P1"
      : /#P2(?=\s|$)/i.test(raw)
        ? "P2"
        : inlinePriority;
    if (!(await save(() => onInlineCreateTask(titleWithoutPrio || raw, resolvedTag, resolvedPrio, date, startMin, duration)))) return;
    setInlineRange(null);
    setInlineTitle("");
    setInlinePriority("");
  }

  function adjustInlineDuration(delta: number) {
    setInlineRange((prev) => {
      if (!prev) return null;
      const nextDur = Math.max(15, Math.min(TOTAL_MINS - prev.startMin, prev.duration + delta));
      return { ...prev, duration: nextDur };
    });
  }

  function locateToday() {
    onSelectDate(todayDate);
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: Math.max(0, nowMinutes - 140), behavior: "smooth" });
    }
    onLocateTodayToast(`已定位到今日 ${fmtMinutes(nowMinutes)}`);
  }

  const ghostPos = activeGhost ? (layoutMap.get("__ghost__") ?? { col: 0, totalCols: 1 }) : null;
  const ghostWidthPct = ghostPos ? 100 / ghostPos.totalCols : 100;
  const ghostLeftPct = ghostPos ? ghostPos.col * ghostWidthPct : 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Day Header */}
      <div className="dw-canvas-header">
        <div className="dw-canvas-heading">
          <h2 className="dw-canvas-title tabular-nums">{formatDateLongCn(selectedDate)}</h2>
          <span className="dw-canvas-sub">{getDateSubtitle(selectedDate, settings.showLunar)}</span>
          {workState === "rest" && <span className="dw-holiday-chip is-rest">休</span>}
          {workState === "work" && <span className="dw-holiday-chip is-work">班</span>}
        </div>

        <div className="dw-canvas-controls">
          <div
            className="dw-progress-box"
            {...tip(totalCount > 0 ? `当日已完成 ${doneCount} / ${totalCount} 项安排` : "当日暂无定时安排", { side: "bottom" })}
          >
            <span>当日进度</span>
            <div className="dw-progress-track">
              <div className="dw-progress-fill" style={{ transform: `scaleX(${progressRatio})` }} />
            </div>
            <span className="dw-progress-val tabular-nums">
              {totalCount > 0 ? `${doneCount}/${totalCount}` : "暂无安排"}
            </span>
          </div>

          <div className="dw-step-group">
            <button
              type="button"
              className="dw-btn-ghost"
              onClick={locateToday}
              {...tip("回到今天当前时刻", { side: "bottom" })}
            >
              回到今天
            </button>
            <button
              type="button"
              className="dw-step-icon-btn"
              onClick={() => onSelectDate(shiftDate(selectedDate, -1))}
              aria-label="前一天"
              {...tip("前一天", { side: "bottom" })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              className="dw-step-icon-btn"
              onClick={() => onSelectDate(shiftDate(selectedDate, 1))}
              aria-label="后一天"
              {...tip("后一天", { side: "bottom" })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* 00:00 - 24:00 60px/hour Timeline Scroll Container */}
      <div ref={scrollRef} className="dw-timeline-scroll win-scroll">
        <div className="dw-timeline-inner">
          {/* Crisp Vermilion Current Time Indicator */}
          <div
            className="dw-now-line"
            style={{ top: `${nowMinutes}px`, opacity: isToday ? 1 : 0.28 }}
            aria-hidden="true"
          >
            <div className="dw-now-pill tabular-nums">{fmtMinutes(nowMinutes)}</div>
            <div className="dw-now-bar" />
          </div>

          {/* Hour Labels with <16px Anti-Overlap Fade */}
          <div className="dw-hour-labels">
            {Array.from({ length: 25 }, (_, h) => {
              const y = h * 60;
              const hiddenByNow = isToday && Math.abs(y - nowMinutes) < 16;
              return (
                <div
                  key={h}
                  className={`dw-hour-label tabular-nums${hiddenByNow ? " is-hidden-by-now" : ""}`}
                  style={{ top: `${y}px` }}
                >
                  {String(h).padStart(2, "0")}:00
                </div>
              );
            })}
          </div>

          {/* Interactive Timeline Grid */}
          <div
            ref={gridRef}
            className={`dw-timeline-grid${selectState?.moved ? " is-selecting" : ""}`}
            onMouseDown={handleGridMouseDown}
            onDoubleClick={handleGridDoubleClick}
          >
            {/* Hour & Half-Hour Lines */}
            {Array.from({ length: 25 }, (_, h) => (
              <div key={h}>
                <div className="dw-grid-line-hour" style={{ top: `${h * 60}px` }} />
                {h < 24 && <div className="dw-grid-line-half" style={{ top: `${h * 60 + 30}px` }} />}
              </div>
            ))}

            {/* Dashed Drag / Select / Inline Preview Ghost (side-by-side non-overlapping column) */}
            {activeGhost && (
              <div
                className={`dw-grid-ghost${activeGhost.height < 42 ? " is-compact" : ""}${
                  activeGhost.colorClass ? ` ${activeGhost.colorClass}` : ""
                }${activeGhost.kind === "select" ? " is-selecting" : ""}`}
                style={{
                  top: `${activeGhost.top}px`,
                  height: `${activeGhost.height}px`,
                  left: `calc(${ghostLeftPct}% + 4px)`,
                  width: `calc(${ghostWidthPct}% - 10px)`,
                }}
              >
                <span className="dw-grid-ghost-left">
                  <span className="dw-grid-ghost-title">{activeGhost.label}</span>
                  {activeGhost.priority === "P1" && <span className="dw-prio-badge is-p1">P1</span>}
                  {activeGhost.priority === "P2" && <span className="dw-prio-badge is-p2">P2</span>}
                </span>
                <span className="dw-grid-ghost-time font-mono tabular-nums">
                  {activeGhost.timeRange} · {activeGhost.right}
                </span>
                {activeGhost.kind === "select" && (
                  <div
                    className={`dw-resize-tip tabular-nums${
                      activeGhost.top + activeGhost.height > 22 * 60 ? " is-above" : ""
                    }`}
                  >
                    {activeGhost.timeRange} · {activeGhost.right}
                  </div>
                )}
              </div>
            )}

            {/* Events Layer */}
            <div className="dw-events-layer">
              {totalCount === 0 && (
                <div className="dw-timeline-empty">
                  <div className="dw-timeline-empty-card">
                    {formatDateShortCn(selectedDate)} 暂无日程安排，可拖入左侧待安排任务或双击空白处新建
                  </div>
                </div>
              )}

              {/* Regular Tasks */}
              {dayTasks.map((ev) => {
                const isDragging =
                  dragState?.entityKind === "task" && dragState.entityId === ev.id && dragState.moved;
                const startMin = isDragging ? dragState.curStart : ev.startMin;
                const duration = isDragging ? dragState.curDur : ev.duration;
                const height = Math.max(26, duration);
                const compact = height < 44;
                const spacious = height >= 76;
                const extraSpacious = height >= 108;
                const pos = layoutMap.get(ev.id) ?? { col: 0, totalCols: 1 };
                const widthPct = 100 / pos.totalCols;
                const leftPct = pos.col * widthPct;
                const tg = getTag(ev.tagId);
                const tagHex = tg ? TAG_COLOR_HEX[tg.color] ?? TAG_COLOR_HEX.blue : TAG_COLOR_HEX.blue;
                const subDone = ev.subtasks.filter((s) => s.done).length;
                const allSubDone = ev.subtasks.length > 0 && subDone === ev.subtasks.length;
                const nextSubtask = ev.subtasks.find((s) => !s.done) ?? null;
                const noteText = ev.note.trim();
                const hudAbove = startMin + duration > 22 * 60;
                const timeRangeStr = `${fmtMinutes(startMin)}–${fmtMinutes(startMin + duration)}`;

                return (
                  <div
                    key={ev.id}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenInspector(ev.id);
                      }
                    }}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      if ((e.target as HTMLElement).closest("input, button, .dw-resize-top, .dw-resize-bottom")) {
                        return;
                      }
                      e.stopPropagation();
                      setDragState({
                        kind: "move",
                        entityKind: "task",
                        entityId: ev.id,
                        startY: e.clientY,
                        origStart: ev.startMin,
                        origDur: ev.duration,
                        curStart: ev.startMin,
                        curDur: ev.duration,
                        moved: false,
                      });
                    }}
                    className={`dw-event-block ev-${getColorClass(ev.tagId)}${compact ? " is-compact" : ""}${
                      spacious ? " is-spacious" : ""
                    }${ev.done ? " is-done" : ""}${selectedTaskId === ev.id ? " is-selected" : ""}${
                      justWovenTaskId === ev.id ? " is-just-woven" : ""
                    }`}
                    style={{
                      top: `${startMin}px`,
                      height: `${height}px`,
                      left: `calc(${leftPct}% + 4px)`,
                      width: `calc(${widthPct}% - 10px)`,
                    }}
                  >
                    <div
                      className="dw-resize-top"
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        setDragState({
                          kind: "resize-top",
                          entityKind: "task",
                          entityId: ev.id,
                          startY: e.clientY,
                          origStart: ev.startMin,
                          origDur: ev.duration,
                          curStart: ev.startMin,
                          curDur: ev.duration,
                          moved: false,
                        });
                      }}
                    />

                    <div className="dw-event-inner">
                      {/* TIER 1: Primary Anchor — Title + Priority + Right-Anchored Semantic Time */}
                      <div className="dw-event-head">
                        <div className="dw-event-left">
                          <input
                            type="checkbox"
                            className="dw-checkbox"
                            checked={ev.done}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => onToggleTaskDone(ev)}
                          />
                          <div className={`dw-event-title${ev.done ? " is-done" : ""}`}>{ev.title}</div>
                          {ev.priority === "P1" && <span className="dw-prio-badge is-p1">P1</span>}
                          {ev.priority === "P2" && <span className="dw-prio-badge is-p2">P2</span>}
                        </div>

                        <div className="dw-event-right">
                          <span
                            className={`dw-event-head-time font-mono tabular-nums${
                              compact ? " is-always" : " is-wide-only"
                            }`}
                          >
                            {timeRangeStr}
                          </span>
                          {compact && tg && (
                            <span className="dw-event-micro-chip is-wide-only">
                              <span className="dw-event-tag-dot" style={{ background: tagHex }} aria-hidden="true" />
                              {tg.name}
                            </span>
                          )}
                          {compact && noteText && (
                            <span className="dw-event-note-badge" {...tip(noteText, { side: "top" })}>
                              <NoteIcon />
                            </span>
                          )}
                        </div>
                      </div>

                      {/* TIER 2: Secondary Context (Left) + Frosted Micro-Chips (Right) */}
                      {!compact && (
                        <div className="dw-event-subrow">
                          <div className="dw-event-subrow-left">
                            <span className="dw-event-narrow-time font-mono tabular-nums">
                              {timeRangeStr}
                              <span className="dw-event-meta-dur">{fmtDuration(duration)}</span>
                            </span>
                            {noteText && (
                              <span className="dw-event-wide-note" {...tip(noteText, { side: "top" })}>
                                {noteText}
                              </span>
                            )}
                            {!spacious && noteText && (
                              <span className="dw-event-note-badge is-narrow-only" {...tip(noteText, { side: "top" })}>
                                <NoteIcon />
                              </span>
                            )}
                          </div>

                          <div className="dw-event-chips">
                            {tg && (
                              <span className="dw-event-micro-chip">
                                <span className="dw-event-tag-dot" style={{ background: tagHex }} aria-hidden="true" />
                                <span className="dw-event-tag-name">{tg.name}</span>
                              </span>
                            )}
                            {ev.subtasks.length > 0 && (
                              <span
                                className={`dw-event-micro-chip is-mono${allSubDone ? " is-complete" : ""}`}
                                {...tip(
                                  nextSubtask
                                    ? `子任务 ${subDone}/${ev.subtasks.length} · 下一项：${nextSubtask.text}`
                                    : `全部 ${ev.subtasks.length} 项子任务已完成`,
                                  { side: "top" },
                                )}
                              >
                                <SubtaskIcon />
                                {subDone}/{ev.subtasks.length}
                              </span>
                            )}
                            <span className="dw-event-micro-chip is-mono is-wide-only">{fmtDuration(duration)}</span>
                          </div>
                        </div>
                      )}

                      {/* TIER 3: Spacious Actionable Callout Strip (>=76px) */}
                      {spacious && (nextSubtask || noteText) && (
                        <div className="dw-event-callout">
                          {nextSubtask ? (
                            <div className="dw-event-next-step">
                              <NextStepIcon />
                              <span className="dw-event-context-label">下一步</span>
                              <span className="dw-event-context-text">{nextSubtask.text}</span>
                            </div>
                          ) : (
                            <div className={`dw-event-note-line${extraSpacious ? " is-clamp-2" : ""}`}>
                              <NoteIcon />
                              <span className="dw-event-context-text">{noteText}</span>
                            </div>
                          )}
                          {nextSubtask && noteText && extraSpacious && (
                            <div className="dw-event-note-line">
                              <NoteIcon />
                              <span className="dw-event-context-text">{noteText}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {!ev.done && (
                      <button
                        type="button"
                        className="dw-return-pool-btn dw-event-hover-action"
                        aria-label="移回待安排"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onReturnToPool(ev);
                        }}
                        {...tip("移回待安排", { side: "top" })}
                      >
                        <ReturnIcon />
                      </button>
                    )}

                    {isDragging && (
                      <div className={`dw-resize-tip tabular-nums${hudAbove ? " is-above" : ""}`}>
                        {timeRangeStr} · {fmtDuration(duration)}
                      </div>
                    )}

                    <div
                      className="dw-resize-bottom"
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        setDragState({
                          kind: "resize-bottom",
                          entityKind: "task",
                          entityId: ev.id,
                          startY: e.clientY,
                          origStart: ev.startMin,
                          origDur: ev.duration,
                          curStart: ev.startMin,
                          curDur: ev.duration,
                          moved: false,
                        });
                      }}
                    />
                  </div>
                );
              })}

              {/* Recurring Occurrences (Now Draggable & Resizable with Scope Confirmation!) */}
              {dayOccs.map((occ) => {
                const origStart = occ.startMin ?? 9 * 60 + 30;
                const origDur = occ.duration;
                const isDragging =
                  dragState?.entityKind === "occ" && dragState.entityId === occ.id && dragState.moved;
                const isPending = pendingOccReschedule?.occ.id === occ.id;
                const startMin = isDragging
                  ? dragState.curStart
                  : isPending
                    ? pendingOccReschedule.nextStartMin
                    : origStart;
                const duration = isDragging
                  ? dragState.curDur
                  : isPending
                    ? pendingOccReschedule.nextDuration
                    : origDur;
                const height = Math.max(26, duration);
                const compact = height < 44;
                const spacious = height >= 76;
                const pos = layoutMap.get(occ.id) ?? { col: 0, totalCols: 1 };
                const widthPct = 100 / pos.totalCols;
                const leftPct = pos.col * widthPct;
                const tg = getTag(occ.tagId);
                const tagHex = tg ? TAG_COLOR_HEX[tg.color] ?? TAG_COLOR_HEX.blue : TAG_COLOR_HEX.blue;
                const noteText = occ.note.trim();
                const hudAbove = startMin + duration > 22 * 60;
                const timeRangeStr = `${fmtMinutes(startMin)}–${fmtMinutes(startMin + duration)}`;

                return (
                  <div
                    key={occ.id}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onInspectRecurringRule?.(occ.ruleId);
                      }
                    }}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      if ((e.target as HTMLElement).closest("input, button, .dw-resize-top, .dw-resize-bottom")) {
                        return;
                      }
                      e.stopPropagation();
                      setDragState({
                        kind: "move",
                        entityKind: "occ",
                        entityId: occ.id,
                        startY: e.clientY,
                        origStart,
                        origDur,
                        curStart: origStart,
                        curDur: origDur,
                        moved: false,
                      });
                    }}
                    className={`dw-event-block ev-${getColorClass(occ.tagId)}${compact ? " is-compact" : ""}${
                      spacious ? " is-spacious" : ""
                    }${occ.done ? " is-done" : ""}${isPending ? " is-pending-reschedule" : ""}`}
                    style={{
                      top: `${startMin}px`,
                      height: `${height}px`,
                      left: `calc(${leftPct}% + 4px)`,
                      width: `calc(${widthPct}% - 10px)`,
                    }}
                  >
                    <div
                      className="dw-resize-top"
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        setDragState({
                          kind: "resize-top",
                          entityKind: "occ",
                          entityId: occ.id,
                          startY: e.clientY,
                          origStart,
                          origDur,
                          curStart: origStart,
                          curDur: origDur,
                          moved: false,
                        });
                      }}
                    />

                    <div className="dw-event-inner">
                      <div className="dw-event-head">
                        <div className="dw-event-left">
                          <input
                            type="checkbox"
                            className="dw-checkbox"
                            checked={occ.done}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => onToggleOccurrenceDone(occ)}
                          />
                          <div className={`dw-event-title${occ.done ? " is-done" : ""}`}>
                            <RecurringIcon />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{occ.title}</span>
                          </div>
                          {occ.priority === "P1" && <span className="dw-prio-badge is-p1">P1</span>}
                          {occ.priority === "P2" && <span className="dw-prio-badge is-p2">P2</span>}
                        </div>

                        <div className="dw-event-right">
                          <span
                            className={`dw-event-head-time font-mono tabular-nums${
                              compact ? " is-always" : " is-wide-only"
                            }`}
                          >
                            {timeRangeStr}
                          </span>
                          {compact && tg && (
                            <span className="dw-event-micro-chip is-wide-only">
                              <span className="dw-event-tag-dot" style={{ background: tagHex }} aria-hidden="true" />
                              {tg.name}
                            </span>
                          )}
                          {compact && noteText && (
                            <span className="dw-event-note-badge" {...tip(noteText, { side: "top" })}>
                              <NoteIcon />
                            </span>
                          )}
                        </div>
                      </div>

                      {!compact && (
                        <div className="dw-event-subrow">
                          <div className="dw-event-subrow-left">
                            <span className="dw-event-narrow-time font-mono tabular-nums">
                              {timeRangeStr}
                              <span className="dw-event-meta-dur">{fmtDuration(duration)}</span>
                            </span>
                            {noteText && (
                              <span className="dw-event-wide-note" {...tip(noteText, { side: "top" })}>
                                {noteText}
                              </span>
                            )}
                            {!spacious && noteText && (
                              <span className="dw-event-note-badge is-narrow-only" {...tip(noteText, { side: "top" })}>
                                <NoteIcon />
                              </span>
                            )}
                          </div>

                          <div className="dw-event-chips">
                            {tg && (
                              <span className="dw-event-micro-chip">
                                <span className="dw-event-tag-dot" style={{ background: tagHex }} aria-hidden="true" />
                                <span className="dw-event-tag-name">{tg.name}</span>
                              </span>
                            )}
                            <span className="dw-event-micro-chip">重复</span>
                            <span className="dw-event-micro-chip is-mono is-wide-only">{fmtDuration(duration)}</span>
                          </div>
                        </div>
                      )}

                      {spacious && noteText && (
                        <div className="dw-event-callout">
                          <div className="dw-event-note-line">
                            <NoteIcon />
                            <span className="dw-event-context-text">{noteText}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className="dw-return-pool-btn dw-event-hover-action"
                      aria-label="移除当日重复安排"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSkipOccurrence(occ);
                      }}
                      {...tip("移除当日重复安排", { side: "top" })}
                    >
                      <RemoveIcon />
                    </button>

                    {isDragging && (
                      <div className={`dw-resize-tip tabular-nums${hudAbove ? " is-above" : ""}`}>
                        {timeRangeStr} · {fmtDuration(duration)}
                      </div>
                    )}

                    <div
                      className="dw-resize-bottom"
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        setDragState({
                          kind: "resize-bottom",
                          entityKind: "occ",
                          entityId: occ.id,
                          startY: e.clientY,
                          origStart,
                          origDur,
                          curStart: origStart,
                          curDur: origDur,
                          moved: false,
                        });
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Compact Anchored Inline Quick-Create Popover */}
            {inlineRange && (() => {
              const popEstHeight = 142;
              const scrollEl = scrollRef.current;
              const viewTop = scrollEl ? scrollEl.scrollTop : 0;
              const viewBottom = scrollEl ? scrollEl.scrollTop + scrollEl.clientHeight : TOTAL_MINS;
              const belowTop = inlineRange.startMin + inlineRange.duration + 8;
              const aboveTop = inlineRange.startMin - popEstHeight - 8;
              const fitsBelow = belowTop + popEstHeight <= Math.min(TOTAL_MINS, viewBottom - 8);
              const fitsAbove = aboveTop >= Math.max(8, viewTop + 8);
              const showAbove = !fitsBelow && (fitsAbove || belowTop + popEstHeight > TOTAL_MINS);
              const popoverTop = showAbove
                ? Math.max(8, aboveTop)
                : Math.min(TOTAL_MINS - popEstHeight - 8, belowTop);
              const gridWidth = gridRef.current?.clientWidth ?? 760;
              const popWidth = Math.min(432, Math.max(260, gridWidth - 16));
              const ghostColLeft = ghostPos !== null ? (ghostLeftPct / 100) * gridWidth + 4 : inlineRange.anchorX;
              const desiredLeft =
                ghostPos && ghostPos.totalCols > 1
                  ? ghostColLeft
                  : inlineRange.anchorX - popWidth / 2;
              const clampedLeft = Math.round(Math.max(8, Math.min(gridWidth - popWidth - 8, desiredLeft)));
              return (
                <div
                  className="dw-inline-create"
                  style={{
                    top: `${popoverTop}px`,
                    left: `${clampedLeft}px`,
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="dw-inline-create-top">
                    <div className="dw-inline-create-meta">
                      <span className="dw-inline-create-date">安排到 {formatDateShortCn(inlineRange.date)}</span>
                      <span className="dw-inline-create-pill font-mono tabular-nums">
                        {fmtMinutes(inlineRange.startMin)}–{fmtMinutes(inlineRange.startMin + inlineRange.duration)} ·{" "}
                        {fmtDuration(inlineRange.duration)}
                      </span>
                      <div className="dw-inline-dur-step" role="group" aria-label="微调时长">
                        <button
                          type="button"
                          className="dw-inline-dur-btn"
                          disabled={saving || inlineRange.duration <= 15}
                          onClick={() => adjustInlineDuration(-15)}
                          aria-label="减少 15 分钟"
                          {...tip("-15 分钟", { side: "top" })}
                        >
                          −
                        </button>
                        <button
                          type="button"
                          className="dw-inline-dur-btn"
                          disabled={saving || inlineRange.startMin + inlineRange.duration >= TOTAL_MINS}
                          onClick={() => adjustInlineDuration(15)}
                          aria-label="增加 15 分钟"
                          {...tip("+15 分钟", { side: "top" })}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="dw-drawer-close"
                      disabled={saving}
                      onClick={() => setInlineRange(null)}
                      aria-label="关闭快速创建"
                      {...tip("关闭", { shortcut: "Esc", side: "left" })}
                    >
                      <RemoveIcon />
                    </button>
                  </div>
                  <form onSubmit={handleInlineSubmit} className="dw-inline-create-form">
                    <input
                      ref={inlineInputRef}
                      type="text"
                      readOnly={saving}
                      value={inlineTitle}
                      onChange={(e) => setInlineTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          if (!pending.current) setInlineRange(null);
                        }
                      }}
                      placeholder="输入安排标题，回车创建"
                      className="dw-input"
                      style={{ flex: 1, height: 32, padding: "0 10px" }}
                    />
                    <button type="submit" className="dw-btn-primary" disabled={saving}>
                      {saving ? "保存中…" : "创建"}
                    </button>
                  </form>
                  <div className="dw-inline-attrs">
                    <div className="dw-inline-attr-field">
                      <FluentSelect
                        compact
                        ariaLabel="任务标签"
                        placeholder="无标签（默认蓝）"
                        value={inlineResolvedTagId}
                        disabled={saving}
                        options={inlineTagOptions}
                        onChange={(nextTag) => {
                          setInlineTagId(nextTag);
                          inlineInputRef.current?.focus();
                        }}
                      />
                    </div>
                    <div className="dw-inline-attr-prio">
                      <FluentSelect<Priority>
                        compact
                        ariaLabel="优先级"
                        value={inlineResolvedPriority}
                        disabled={saving}
                        options={inlinePriorityOptions}
                        onChange={(nextPrio) => {
                          setInlinePriority(nextPrio);
                          inlineInputRef.current?.focus();
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
