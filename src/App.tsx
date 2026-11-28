import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AllTasksView } from "./components/AllTasksView";
import { CreateModal } from "./components/CreateModal";
import { DayTimeline } from "./components/DayTimeline";
import type { PendingOccReschedule } from "./components/DayTimeline";
import { DraftsDrawer } from "./components/DraftsDrawer";
import { IconRail } from "./components/IconRail";
import { hasTaskChanges, InspectorDrawer } from "./components/InspectorDrawer";
import { MonthView } from "./components/MonthView";
import { RecurringView } from "./components/RecurringView";
import { SettingsView } from "./components/SettingsView";
import { TitleBar } from "./components/TitleBar";
import { TooltipHost } from "./components/TooltipHost";
import { TrashView } from "./components/TrashView";
import { WorkbenchLeftPanel } from "./components/WorkbenchLeftPanel";
import { useHolidayCalendarSync } from "./holiday-calendar-sync";
import {
  archiveRecurringRule,
  createRecurringRule,
  createTag,
  createTask,
  deleteDraft,
  deleteTag,
  emptyTrash,
  getWorkspaceSnapshot,
  listRecurringOccurrencesRange,
  onReminderActivated,
  purgeTask,
  rescheduleRecurringOccurrence,
  restoreRecurringRule,
  restoreTask,
  setAppWindowTitle,
  setRecurringOccurrenceState,
  setUiSetting,
  softDeleteTask,
  toggleRecurringRule,
  updateRecurringRule,
  updateTask,
  upsertDraft,
} from "./tauri";
import { DEFAULT_SETTINGS, parseSettingsMap, TAG_COLOR_HEX } from "./types/dayweave";
import type {
  AppModule,
  AppSettings,
  CalendarView,
  Draft,
  DraftInput,
  Priority,
  RecurringOccurrence,
  RecurringRule,
  RecurringRuleInput,
  RescheduleRecurringScope,
  Tag,
  TagColor,
  Task,
  TaskInput,
} from "./types/dayweave";
import {
  buildMonthGrid,
  fmtDuration,
  fmtMinutes,
  formatDateShortCn,
  shanghaiNowParts,
} from "./utils/dateUtils";
import { parseQuickCapture } from "./utils/quickCapture";
import { findAvailableSlot, snapMinutes } from "./utils/timelineLayout";

function toTaskInput(task: Task): TaskInput {
  return {
    title: task.title,
    note: task.note,
    mode: task.mode,
    tagId: task.tagId,
    priority: task.priority,
    done: task.done,
    date: task.date,
    startMin: task.startMin,
    duration: task.duration,
    dateStart: task.dateStart,
    dateEnd: task.dateEnd,
    subtasks: task.subtasks.map((s) => ({ id: s.id, text: s.text, done: s.done })),
  };
}

interface PoolPointerDrag {
  task: Task;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
  hoverTimelineStartMin: number | null;
  hoverMiniDate: string | null;
  hoverMonthDate: string | null;
}

const NO_OCCURRENCES: RecurringOccurrence[] = [];

type InspectorLeaveAction =
  | { kind: "close" }
  | { kind: "switchTask"; taskId: string }
  | { kind: "openDrafts" }
  | { kind: "switchModule"; module: AppModule }
  | { kind: "inspectRule"; ruleId: string };

export default function App() {
  const holidayKey = useHolidayCalendarSync();

  const [clock, setClock] = useState(() => shanghaiNowParts());
  const [selectedDate, setSelectedDate] = useState(() => shanghaiNowParts().date);
  const [activeModule, setActiveModule] = useState<AppModule>("workbench");
  const [calendarView, setCalendarView] = useState<CalendarView>("day");

  const [tags, setTags] = useState<Tag[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [trash, setTrash] = useState<Task[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [recurringRules, setRecurringRules] = useState<RecurringRule[]>([]);
  const [archivedRecurringRules, setArchivedRecurringRules] = useState<RecurringRule[]>([]);
  const [occurrenceResult, setOccurrenceResult] = useState<{
    request: { from: string; to: string };
    items: RecurringOccurrence[] | null;
  } | null>(null);
  const [occurrenceRetry, setOccurrenceRetry] = useState(0);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);
  const settingWritePending = useRef(false);
  const settingsVersion = useRef(0);
  const [loaded, setLoaded] = useState(false);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [inspectorPreview, setInspectorPreview] = useState<Task | null>(null);
  const [pendingInspectorLeave, setPendingInspectorLeave] = useState<InspectorLeaveAction | null>(null);
  const [focusRuleId, setFocusRuleId] = useState<string | null>(null);
  const [justWovenTaskId, setJustWovenTaskId] = useState<string | null>(null);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [modalDraft, setModalDraft] = useState<Draft | null>(null);
  const [poolDrag, setPoolDrag] = useState<PoolPointerDrag | null>(null);
  const poolDragRef = useRef<PoolPointerDrag | null>(null);
  poolDragRef.current = poolDrag;
  const suppressPoolClickUntilRef = useRef(0);
  const [pendingOccReschedule, setPendingOccReschedule] = useState<PendingOccReschedule | null>(null);
  const [reschedulingOcc, setReschedulingOcc] = useState(false);

  const [toast, setToast] = useState<{ text: string; isError: boolean; undo?: () => void | Promise<void> } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const wovenHighlightTimerRef = useRef<number | null>(null);

  const showToast = useCallback((text: string, isError = false, undo?: () => void | Promise<void>) => {
    setToast({ text, isError, undo });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), undo ? 10_000 : 3000);
  }, []);

  const flashWovenTask = useCallback((taskId: string) => {
    setJustWovenTaskId(taskId);
    if (wovenHighlightTimerRef.current) window.clearTimeout(wovenHighlightTimerRef.current);
    wovenHighlightTimerRef.current = window.setTimeout(() => setJustWovenTaskId(null), 1500);
  }, []);

  const refreshWorkspace = useCallback(async () => {
    const readVersion = settingsVersion.current;
    try {
      const snap = await getWorkspaceSnapshot();
      setTags(snap.tags);
      setTasks(snap.tasks);
      setTrash(snap.trash);
      setDrafts(snap.drafts);
      setRecurringRules(snap.recurringRules);
      setArchivedRecurringRules(snap.archivedRecurringRules ?? []);
      if (readVersion === settingsVersion.current) setSettings(parseSettingsMap(snap.settings));
      setLoaded(true);
    } catch (error) {
      showToast(`数据加载失败：${String(error)}`, true);
    }
  }, [showToast]);

  // Initial load + Shanghai clock tick
  useEffect(() => {
    void setAppWindowTitle("今序 · Dayweave");
    void refreshWorkspace();
    const timer = window.setInterval(() => setClock(shanghaiNowParts()), 30_000);
    return () => window.clearInterval(timer);
  }, [refreshWorkspace]);

  // Load recurring occurrences for the 42-day grid surrounding selectedDate
  const { from, to } = useMemo(() => {
    const cells = buildMonthGrid(selectedDate);
    return { from: cells[0].date, to: cells[cells.length - 1].date };
  }, [selectedDate]);
  const occurrenceRequest = useMemo(() => ({ from, to }), [from, to, recurringRules, holidayKey, occurrenceRetry]);
  const currentResult = occurrenceResult?.request === occurrenceRequest ? occurrenceResult : null;
  const occurrences = currentResult?.items ?? NO_OCCURRENCES;
  const occurrenceStatus = !currentResult ? "loading" : currentResult.items ? "ready" : "error";

  useEffect(() => {
    if (!loaded) return;
    let current = true;
    void listRecurringOccurrencesRange(occurrenceRequest.from, occurrenceRequest.to).then(
      (items) => { if (current) setOccurrenceResult({ request: occurrenceRequest, items }); },
      () => { if (current) setOccurrenceResult({ request: occurrenceRequest, items: null }); },
    );
    return () => { current = false; };
  }, [loaded, occurrenceRequest]);

  // Listen to Windows reminder activations
  useEffect(() => {
    let stop: (() => void) | undefined;
    void onReminderActivated((ev) => {
      if (ev.action === "completed") {
        void refreshWorkspace();
        showToast("已通过提醒快捷完成任务");
      } else {
        setActiveModule("workbench");
        setCalendarView("day");
        setSelectedDate(ev.target.date);
        setSelectedTaskId(ev.target.taskId);
      }
    }).then((unlisten) => {
      stop = unlisten;
    });
    return () => stop?.();
  }, [refreshWorkspace, showToast]);

  useEffect(() => {
    setInspectorPreview(null);
    setPendingInspectorLeave(null);
  }, [selectedTaskId]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );

  const isInspectorDirty = useMemo(
    () =>
      Boolean(
        selectedTask &&
          inspectorPreview &&
          selectedTask.id === inspectorPreview.id &&
          hasTaskChanges(selectedTask, inspectorPreview),
      ),
    [selectedTask, inspectorPreview],
  );

  const applyInspectorLeave = useCallback((action: InspectorLeaveAction) => {
    setPendingInspectorLeave(null);
    setInspectorPreview(null);
    if (action.kind === "close") {
      setSelectedTaskId(null);
    } else if (action.kind === "switchTask") {
      setDraftsOpen(false);
      setSelectedTaskId(action.taskId);
    } else if (action.kind === "openDrafts") {
      setSelectedTaskId(null);
      setDraftsOpen(true);
    } else if (action.kind === "switchModule") {
      setSelectedTaskId(null);
      setDraftsOpen(false);
      setActiveModule(action.module);
    } else if (action.kind === "inspectRule") {
      setSelectedTaskId(null);
      setDraftsOpen(false);
      setFocusRuleId(action.ruleId);
      setActiveModule("recurring");
    }
  }, []);

  const requestInspectorLeave = useCallback(
    (action: InspectorLeaveAction) => {
      if (action.kind === "switchTask" && action.taskId === selectedTaskId) {
        setDraftsOpen(false);
        return;
      }
      if (isInspectorDirty) {
        setPendingInspectorLeave(action);
      } else {
        applyInspectorLeave(action);
      }
    },
    [selectedTaskId, isInspectorDirty, applyInspectorLeave],
  );

  // Global keyboard shortcuts (Ctrl+N, Ctrl+Z undo, Escape)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing || document.querySelector("dialog[open]")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        if (createModalOpen) return;
        setDraftsOpen(false);
        setModalDraft(null);
        setCreateModalOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        const tag = (document.activeElement as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || !toast?.undo) return;
        e.preventDefault();
        const fn = toast.undo;
        setToast(null);
        void fn();
      } else if (e.key === "Escape") {
        if (pendingOccReschedule && !reschedulingOcc) {
          e.preventDefault();
          setPendingOccReschedule(null);
          return;
        }
        if (createModalOpen) return;
        if (selectedTaskId) {
          e.preventDefault();
          requestInspectorLeave({ kind: "close" });
        } else if (draftsOpen) {
          e.preventDefault();
          setDraftsOpen(false);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createModalOpen, selectedTaskId, draftsOpen, toast, pendingOccReschedule, reschedulingOcc, requestInspectorLeave]);

  const displayedTasks = useMemo(
    () =>
      inspectorPreview && selectedTaskId === inspectorPreview.id
        ? tasks.map((t) => (t.id === inspectorPreview.id ? inspectorPreview : t))
        : tasks,
    [tasks, inspectorPreview, selectedTaskId],
  );

  // ---- Task Mutations ----

  const persistTask = useCallback(
    async (nextTask: Task) => {
      try {
        const saved = await updateTask(nextTask.id, toTaskInput(nextTask));
        setTasks((prev) => prev.map((t) => (t.id === saved.id ? saved : t)));
      } catch (error) {
        showToast(`保存任务失败：${String(error)}`, true);
        void refreshWorkspace();
      }
    },
    [refreshWorkspace, showToast],
  );

  const handleSaveInspectorTask = useCallback(
    async (draftTask: Task) => {
      try {
        const saved = await updateTask(draftTask.id, toTaskInput(draftTask));
        setTasks((prev) => prev.map((t) => (t.id === saved.id ? saved : t)));
        setInspectorPreview(null);
        setSelectedTaskId(null);
        showToast("已保存任务修改");
        return true;
      } catch (error) {
        showToast(`保存任务失败：${String(error)}`, true);
        return false;
      }
    },
    [showToast],
  );

  const handleSaveAndLeaveInspector = useCallback(
    async (draftTask: Task) => {
      try {
        const saved = await updateTask(draftTask.id, toTaskInput(draftTask));
        setTasks((prev) => prev.map((t) => (t.id === saved.id ? saved : t)));
        showToast("已保存任务修改");
        applyInspectorLeave(pendingInspectorLeave ?? { kind: "close" });
        return true;
      } catch (error) {
        showToast(`保存任务失败：${String(error)}`, true);
        return false;
      }
    },
    [applyInspectorLeave, pendingInspectorLeave, showToast],
  );

  const handleUpdateTask = useCallback(
    (task: Task, patch: Partial<Task>) => {
      const next: Task = { ...task, ...patch };
      setTasks((prev) => prev.map((t) => (t.id === next.id ? next : t)));
      void persistTask(next);
    },
    [persistTask],
  );

  const handleToggleTaskDone = useCallback(
    (task: Task) => {
      const nextDone = !task.done;
      handleUpdateTask(task, { done: nextDone });
      showToast(
        nextDone ? `已完成「${task.title}」` : `已恢复「${task.title}」为进行中`,
        false,
        () => {
          handleUpdateTask({ ...task, done: nextDone }, { done: task.done });
          showToast("已撤销状态变更");
        },
      );
    },
    [handleUpdateTask, showToast],
  );

  const handleReturnToPool = useCallback(
    (task: Task) => {
      if (task.done) return;
      const prevSnapshot = { mode: task.mode, date: task.date, startMin: task.startMin, dateStart: task.dateStart, dateEnd: task.dateEnd };
      handleUpdateTask(task, { mode: "pool", dateStart: task.date, dateEnd: task.date });
      showToast(`已将「${task.title}」移回待安排`, false, () => {
        handleUpdateTask({ ...task, mode: "pool" }, prevSnapshot);
        flashWovenTask(task.id);
        showToast("已撤销移回");
      });
    },
    [handleUpdateTask, showToast, flashWovenTask],
  );

  const handleQuickWeaveTask = useCallback(
    (task: Task, targetDate?: string) => {
      const date = targetDate ?? selectedDate;
      if (occurrenceStatus !== "ready" || date < from || date > to) {
        showToast(occurrenceStatus === "error" ? "重复事项加载失败，请在日历重试后再安排" : "重复事项尚未就绪，请稍后再安排", true);
        return;
      }
      const occupied = [
        ...tasks.filter((t) => t.mode === "timeline" && t.date === date && t.id !== task.id),
        ...occurrences
          .filter((o) => o.mode === "timeline" && o.occurrenceDate === date)
          .map((o) => ({ startMin: o.startMin ?? 9 * 60 + 30, duration: o.duration })),
      ];
      const preferredStart =
        date === clock.date ? Math.max(8 * 60, Math.min(20 * 60, clock.minutes + 15)) : 9 * 60 + 30;
      const startMin = findAvailableSlot(occupied, task.duration, {
        preferredStartMin: preferredStart,
        snapStep: settings.snapStep,
      });

      const prevSnapshot = { mode: task.mode, date: task.date, startMin: task.startMin, dateStart: task.dateStart, dateEnd: task.dateEnd };
      handleUpdateTask(task, { mode: "timeline", date, startMin, dateStart: date, dateEnd: date });
      if (targetDate) setSelectedDate(date);
      if (activeModule !== "workbench") setActiveModule("workbench");
      flashWovenTask(task.id);
      showToast(`已排入 ${formatDateShortCn(date)} ${fmtMinutes(startMin)}（${fmtDuration(task.duration)}）`, false, () => {
        handleUpdateTask({ ...task, mode: "timeline", date, startMin }, prevSnapshot);
        showToast("已撤销排入，任务返回待安排");
      });
    },
    [selectedDate, tasks, occurrences, occurrenceStatus, from, to, clock.date, clock.minutes, settings.snapStep, handleUpdateTask, activeModule, showToast, flashWovenTask],
  );

  const handleDropPoolTaskAt = useCallback(
    (taskId: string, startMin: number) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      const prevSnapshot = { mode: task.mode, date: task.date, startMin: task.startMin, dateStart: task.dateStart, dateEnd: task.dateEnd };
      handleUpdateTask(task, { mode: "timeline", date: selectedDate, startMin, dateStart: selectedDate, dateEnd: selectedDate });
      flashWovenTask(task.id);
      showToast(`已排入 ${formatDateShortCn(selectedDate)} ${fmtMinutes(startMin)}（${fmtDuration(task.duration)}）`, false, () => {
        handleUpdateTask({ ...task, mode: "timeline", date: selectedDate, startMin }, prevSnapshot);
        showToast("已撤销排入");
      });
    },
    [tasks, selectedDate, handleUpdateTask, showToast, flashWovenTask],
  );

  const handleDropPoolTaskOnDate = useCallback(
    (taskId: string, date: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      handleQuickWeaveTask(task, date);
    },
    [tasks, handleQuickWeaveTask],
  );

  const handlePoolPointerDown = useCallback((task: Task, clientX: number, clientY: number) => {
    const next: PoolPointerDrag = {
      task,
      startX: clientX,
      startY: clientY,
      x: clientX,
      y: clientY,
      moved: false,
      hoverTimelineStartMin: null,
      hoverMiniDate: null,
      hoverMonthDate: null,
    };
    poolDragRef.current = next;
    setPoolDrag(next);
  }, []);

  const shouldSuppressPoolClick = useCallback(() => Date.now() < suppressPoolClickUntilRef.current, []);

  const isPoolDragSession = poolDrag !== null;
  useEffect(() => {
    if (!isPoolDragSession) return;

    function hitTestDropTarget(clientX: number, clientY: number, duration: number) {
      const hits = document.elementsFromPoint(clientX, clientY);
      const miniCell = hits.find((el) => el.classList.contains("dw-minical-cell") && el.hasAttribute("data-date"));
      if (miniCell) {
        return {
          hoverTimelineStartMin: null,
          hoverMiniDate: miniCell.getAttribute("data-date"),
          hoverMonthDate: null,
        };
      }
      const monthCell = hits.find((el) => el.classList.contains("dw-month-cell") && el.hasAttribute("data-date"));
      if (monthCell) {
        return {
          hoverTimelineStartMin: null,
          hoverMiniDate: null,
          hoverMonthDate: monthCell.getAttribute("data-date"),
        };
      }
      const scrollEl = hits.find((el) => el.classList.contains("dw-timeline-scroll"));
      const gridEl = hits.find((el) => el.classList.contains("dw-timeline-grid"));
      if (scrollEl && gridEl) {
        const scrollRect = scrollEl.getBoundingClientRect();
        if (clientY < scrollRect.top + 44) {
          scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop - 12);
        } else if (clientY > scrollRect.bottom - 44) {
          scrollEl.scrollTop += 12;
        }
        const gridRect = gridEl.getBoundingClientRect();
        const relY = clientY - gridRect.top;
        const snapped = Math.max(0, Math.min(24 * 60 - duration, snapMinutes(relY, settings.snapStep)));
        return {
          hoverTimelineStartMin: snapped,
          hoverMiniDate: null,
          hoverMonthDate: null,
        };
      }
      return {
        hoverTimelineStartMin: null,
        hoverMiniDate: null,
        hoverMonthDate: null,
      };
    }

    function handleMouseMove(e: MouseEvent) {
      const cur = poolDragRef.current;
      if (!cur) return;
      const moved = cur.moved || Math.hypot(e.clientX - cur.startX, e.clientY - cur.startY) > 5;
      if (!moved) return;
      const targets = hitTestDropTarget(e.clientX, e.clientY, cur.task.duration);
      const next: PoolPointerDrag = {
        ...cur,
        x: e.clientX,
        y: e.clientY,
        moved: true,
        ...targets,
      };
      poolDragRef.current = next;
      setPoolDrag(next);
    }

    function handleMouseUp(e: MouseEvent) {
      const cur = poolDragRef.current;
      poolDragRef.current = null;
      setPoolDrag(null);
      if (!cur || !cur.moved) return;
      suppressPoolClickUntilRef.current = Date.now() + 250;
      const targets = hitTestDropTarget(e.clientX, e.clientY, cur.task.duration);
      if (targets.hoverMiniDate) {
        handleDropPoolTaskOnDate(cur.task.id, targets.hoverMiniDate);
      } else if (targets.hoverMonthDate) {
        handleDropPoolTaskOnDate(cur.task.id, targets.hoverMonthDate);
      } else if (targets.hoverTimelineStartMin !== null) {
        handleDropPoolTaskAt(cur.task.id, targets.hoverTimelineStartMin);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        poolDragRef.current = null;
        setPoolDrag(null);
      }
    }

    function handleBlur() {
      poolDragRef.current = null;
      setPoolDrag(null);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("blur", handleBlur);
    };
  }, [isPoolDragSession, settings.snapStep, handleDropPoolTaskAt, handleDropPoolTaskOnDate]);

  const handleMoveOrResizeTask = useCallback(
    (task: Task, nextStartMin: number, nextDuration: number) => {
      handleUpdateTask(task, { startMin: nextStartMin, duration: nextDuration });
      showToast(`已更新：${fmtMinutes(nextStartMin)} – ${fmtMinutes(nextStartMin + nextDuration)}（${fmtDuration(nextDuration)}）`);
    },
    [handleUpdateTask, showToast],
  );

  const handleInlineCreateTask = useCallback(
    async (title: string, tagId: string, priority: Priority, date: string, startMin: number, duration: number) => {
      try {
        const created = await createTask({
          title,
          note: "",
          mode: "timeline",
          tagId,
          priority,
          done: false,
          date,
          startMin,
          duration,
          dateStart: date,
          dateEnd: date,
          subtasks: [],
        });
        setTasks((prev) => [created, ...prev]);
        showToast(`已在 ${formatDateShortCn(date)} ${fmtMinutes(startMin)} 创建「${created.title}」`);
        return true;
      } catch (error) {
        showToast(`创建失败：${String(error)}`, true);
        return false;
      }
    },
    [showToast],
  );

  const handleQuickCapture = useCallback(
    async (rawText: string) => {
      if (createModalOpen) return false;
      try {
        const parsed = parseQuickCapture(rawText, tags, settings.defaultDuration, settings.snapStep);
        const created = await createTask({
          title: parsed.title,
          note: "",
          mode: parsed.mode,
          tagId: parsed.tagId,
          priority: parsed.priority,
          done: false,
          date: selectedDate,
          startMin: parsed.startMin,
          duration: parsed.duration,
          dateStart: selectedDate,
          dateEnd: selectedDate,
          subtasks: [],
        });
        setTasks((prev) => [created, ...prev]);
        const tg = tags.find((t) => t.id === created.tagId);
        const tgHint = tg ? ` · #${tg.name}` : "";
        showToast(
          created.mode === "timeline"
            ? `已排入 ${fmtMinutes(created.startMin)}（${fmtDuration(created.duration)}${tgHint}）`
            : created.mode === "flex"
              ? `已加入全天安排${tgHint}`
              : `已加入待安排（${fmtDuration(created.duration)}${tgHint}）`,
        );
        return true;
      } catch (error) {
        showToast(`快速创建失败：${String(error)}`, true);
        return false;
      }
    },
    [createModalOpen, tags, settings.defaultDuration, settings.snapStep, selectedDate, showToast],
  );

  const handleCreateFromModal = useCallback(
    async (input: TaskInput, fromDraftId: string | null) => {
      try {
        const created = await createTask(input, fromDraftId);
        setTasks((prev) => [created, ...prev]);
        if (fromDraftId) {
          setDrafts((prev) => prev.filter((d) => d.id !== fromDraftId));
        }
        showToast(`已成功创建「${created.title}」`);
        return true;
      } catch (error) {
        showToast(`创建任务失败：${String(error)}`, true);
        return false;
      }
    },
    [showToast],
  );

  const handleSoftDeleteTask = useCallback(
    async (task: Task): Promise<boolean> => {
      try {
        const deleted = await softDeleteTask(task.id);
        setTasks((prev) => prev.filter((t) => t.id !== task.id));
        setTrash((prev) => [deleted, ...prev]);
        setSelectedTaskId(null);
        showToast("已移入回收站", false, async () => {
          try {
            const restored = await restoreTask(deleted.id);
            setTrash((prev) => prev.filter((t) => t.id !== deleted.id));
            setTasks((prev) => [restored, ...prev]);
            showToast(`已撤销，恢复「${restored.title}」`);
          } catch (err) {
            showToast(`撤销失败：${String(err)}`, true);
          }
        });
        return true;
      } catch (error) {
        showToast(`移入回收站失败：${String(error)}`, true);
        return false;
      }
    },
    [showToast],
  );

  const handleRestoreTask = useCallback(
    async (task: Task): Promise<boolean> => {
      try {
        const restored = await restoreTask(task.id);
        setTrash((prev) => prev.filter((t) => t.id !== task.id));
        setTasks((prev) => [restored, ...prev]);
        showToast(`已恢复「${restored.title}」`);
        return true;
      } catch (error) {
        showToast(`恢复任务失败：${String(error)}`, true);
        return false;
      }
    },
    [showToast],
  );

  const handlePurgeTask = useCallback(
    async (taskId: string) => {
      try {
        await purgeTask(taskId);
        setTrash((prev) => prev.filter((t) => t.id !== taskId));
        showToast("已彻底删除");
        return true;
      } catch (error) {
        showToast(`删除失败：${String(error)}`, true);
        return false;
      }
    },
    [showToast],
  );

  const handleEmptyTrash = useCallback(async () => {
    try {
      await emptyTrash();
      setTrash([]);
      showToast("已清空回收站");
      return true;
    } catch (error) {
      showToast(`清空回收站失败：${String(error)}`, true);
      return false;
    }
  }, [showToast]);

  // ---- Drafts ----

  const handleSaveDraft = useCallback(
    async (input: DraftInput) => {
      try {
        const saved = await upsertDraft(input);
        setDrafts((prev) => {
          const exists = prev.some((d) => d.id === saved.id);
          return exists ? prev.map((d) => (d.id === saved.id ? saved : d)) : [saved, ...prev];
        });
        showToast("未提交内容已暂存至草稿箱");
        return true;
      } catch (error) {
        showToast(`暂存草稿失败：${String(error)}`, true);
        return false;
      }
    },
    [showToast],
  );

  const handleDeleteDraft = useCallback(
    async (draftId: string): Promise<boolean> => {
      try {
        await deleteDraft(draftId);
        setDrafts((prev) => prev.filter((d) => d.id !== draftId));
        showToast("已删除草稿");
        return true;
      } catch (error) {
        showToast(`删除草稿失败：${String(error)}`, true);
        return false;
      }
    },
    [showToast],
  );

  // ---- Recurring Rules & Occurrences ----

  const handleCreateRule = useCallback(
    async (input: RecurringRuleInput) => {
      try {
        const created = await createRecurringRule(input);
        setRecurringRules((prev) => [created, ...prev]);
        showToast(`已新建重复规则「${created.title}」`);
        return true;
      } catch (error) {
        showToast(`创建重复规则失败：${String(error)}`, true);
        return false;
      }
    },
    [showToast],
  );

  const handleUpdateRule = useCallback(
    async (ruleId: string, input: RecurringRuleInput) => {
      try {
        const updated = await updateRecurringRule(ruleId, input);
        setRecurringRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        showToast(`已保存重复规则「${updated.title}」`);
        return true;
      } catch (error) {
        showToast(`更新重复规则失败：${String(error)}`, true);
        return false;
      }
    },
    [showToast],
  );

  const handleToggleRule = useCallback(
    async (rule: RecurringRule) => {
      try {
        const updated = await toggleRecurringRule(rule.id, !rule.active);
        setRecurringRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        showToast(`「${updated.title}」已${updated.active ? "启用" : "暂停"}`);
      } catch (error) {
        showToast(`切换状态失败：${String(error)}`, true);
      }
    },
    [showToast],
  );

  const handleArchiveRule = useCallback(
    async (ruleId: string): Promise<boolean> => {
      try {
        const archived = await archiveRecurringRule(ruleId);
        setRecurringRules((prev) => prev.filter((r) => r.id !== ruleId));
        setArchivedRecurringRules((prev) => [archived, ...prev.filter((r) => r.id !== archived.id)]);
        showToast("已归档重复规则，可在「已归档」分栏查看或恢复");
        return true;
      } catch (error) {
        showToast(`归档重复规则失败：${String(error)}`, true);
        return false;
      }
    },
    [showToast],
  );

  const handleRestoreRule = useCallback(
    async (rule: RecurringRule): Promise<boolean> => {
      try {
        const restored = await restoreRecurringRule(rule.id);
        setArchivedRecurringRules((prev) => prev.filter((r) => r.id !== rule.id));
        setRecurringRules((prev) => [restored, ...prev.filter((r) => r.id !== restored.id)]);
        showToast(`已恢复重复规则「${restored.title}」`);
        return true;
      } catch (error) {
        showToast(`恢复重复规则失败：${String(error)}`, true);
        return false;
      }
    },
    [showToast],
  );

  const handleToggleOccurrenceDone = useCallback(
    async (occ: RecurringOccurrence) => {
      try {
        const updated = await setRecurringOccurrenceState({
          ruleId: occ.ruleId,
          occurrenceDate: occ.occurrenceDate,
          done: !occ.done,
        });
        const ruleIsActive = recurringRules.some((r) => r.id === occ.ruleId && r.active);
        setOccurrenceResult((prev) =>
          !prev?.items
            ? prev
            : {
                ...prev,
                items:
                  !updated.done && !ruleIsActive
                    ? prev.items.filter((o) => o.id !== occ.id)
                    : prev.items.map((o) => (o.id === occ.id ? updated : o)),
              },
        );
      } catch (error) {
        showToast(`更新重复事项失败：${String(error)}`, true);
      }
    },
    [recurringRules, showToast],
  );

  const handleSkipOccurrence = useCallback(
    async (occ: RecurringOccurrence) => {
      try {
        await setRecurringOccurrenceState({
          ruleId: occ.ruleId,
          occurrenceDate: occ.occurrenceDate,
          skipped: true,
        });
        setOccurrenceResult((prev) =>
          !prev?.items
            ? prev
            : { ...prev, items: prev.items.filter((o) => o.id !== occ.id) },
        );
        showToast(`已移除 ${formatDateShortCn(occ.occurrenceDate)} 的「${occ.title}」`, false, async () => {
          try {
            await setRecurringOccurrenceState({
              ruleId: occ.ruleId,
              occurrenceDate: occ.occurrenceDate,
              skipped: false,
            });
            setOccurrenceRetry((n) => n + 1);
            showToast("已撤销移除重复安排");
          } catch (err) {
            showToast(`撤销失败：${String(err)}`, true);
          }
        });
      } catch (error) {
        showToast(`移除重复事项失败：${String(error)}`, true);
      }
    },
    [showToast],
  );

  const handleInspectRecurringRule = useCallback(
    (ruleId: string) => {
      requestInspectorLeave({ kind: "inspectRule", ruleId });
    },
    [requestInspectorLeave],
  );

  const handleRequestRescheduleOccurrence = useCallback(
    (
      occ: RecurringOccurrence,
      origStartMin: number,
      origDuration: number,
      nextStartMin: number,
      nextDuration: number,
    ) => {
      setPendingOccReschedule({ occ, origStartMin, origDuration, nextStartMin, nextDuration });
    },
    [],
  );

  const handleConfirmRescheduleOccurrence = useCallback(
    async (scope: RescheduleRecurringScope) => {
      if (!pendingOccReschedule || reschedulingOcc) return;
      const { occ, origStartMin, origDuration, nextStartMin, nextDuration } = pendingOccReschedule;
      setReschedulingOcc(true);
      try {
        const res = await rescheduleRecurringOccurrence({
          ruleId: occ.ruleId,
          occurrenceDate: occ.occurrenceDate,
          startMin: nextStartMin,
          duration: nextDuration,
          scope,
        });
        setRecurringRules(res.recurringRules);
        setOccurrenceRetry((n) => n + 1);
        setPendingOccReschedule(null);
        const rangeLabel = `${fmtMinutes(nextStartMin)}–${fmtMinutes(nextStartMin + nextDuration)}（${fmtDuration(nextDuration)}）`;
        if (scope === "single") {
          showToast(
            `已仅调整 ${formatDateShortCn(occ.occurrenceDate)} 的「${occ.title}」至 ${rangeLabel}`,
            false,
            async () => {
              try {
                await setRecurringOccurrenceState({
                  ruleId: occ.ruleId,
                  occurrenceDate: occ.occurrenceDate,
                  overrideStartMin: origStartMin,
                  overrideDuration: origDuration,
                });
                setOccurrenceRetry((n) => n + 1);
                showToast("已撤销本次重复时间调整");
              } catch (err) {
                showToast(`撤销失败：${String(err)}`, true);
              }
            },
          );
        } else {
          showToast(`已将 ${formatDateShortCn(occ.occurrenceDate)} 及后续「${occ.title}」调整为 ${rangeLabel}`);
        }
      } catch (error) {
        showToast(`调整重复时间失败：${String(error)}`, true);
      } finally {
        setReschedulingOcc(false);
      }
    },
    [pendingOccReschedule, reschedulingOcc, showToast],
  );

  // ---- Tags & Settings ----

  const handleCreateTag = useCallback(
    async (name: string, color: TagColor): Promise<boolean> => {
      try {
        const created = await createTag(name, color);
        setTags((prev) => [...prev, created]);
        showToast(`已新增标签 #${created.name}`);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showToast(`新增标签失败：${message}`, true);
        return false;
      }
    },
    [showToast],
  );

  const handleDeleteTag = useCallback(
    async (tagId: string): Promise<boolean> => {
      try {
        await deleteTag(tagId);
        setTags((prev) => prev.filter((t) => t.id !== tagId));
        setTasks((prev) => prev.map((t) => (t.tagId === tagId ? { ...t, tagId: "" } : t)));
        setDrafts((prev) => prev.map((d) => (d.tagId === tagId ? { ...d, tagId: "" } : d)));
        setRecurringRules((prev) => prev.map((r) => (r.tagId === tagId ? { ...r, tagId: "" } : r)));
        setArchivedRecurringRules((prev) => prev.map((r) => (r.tagId === tagId ? { ...r, tagId: "" } : r)));
        showToast("已删除标签");
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showToast(message, true);
        return false;
      }
    },
    [showToast],
  );

  const handleUpdateSetting = useCallback(
    async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      if (!loaded || settingWritePending.current) return;
      const keyMap: Record<keyof AppSettings, string> = {
        showLunar: "ui.show_lunar",
        snapStep: "ui.snap_step",
        defaultDuration: "ui.default_duration",
        enableDragCreate: "ui.enable_drag_create",
        autoDraft: "ui.auto_draft",
        taskLeadMinutes: "ui.reminder.task_lead",
        closeToTray: "ui.desktop.close_to_tray",
      };
      settingWritePending.current = true;
      setSavingSettings(true);
      try {
        await setUiSetting(keyMap[key], String(value));
        settingsVersion.current += 1;
        setSettings((prev) => ({ ...prev, [key]: value }));
        showToast("偏好设置已生效");
      } catch (error) {
        showToast(`保存设置失败：${String(error)}`, true);
      } finally {
        settingWritePending.current = false;
        setSavingSettings(false);
      }
    },
    [loaded, showToast],
  );

  return (
    <div className={`win-app${poolDrag?.moved ? " is-pool-dragging" : ""}`}>
      <TitleBar
        activeModule={activeModule}
        calendarView={calendarView}
        tags={tags}
        onSwitchCalendarView={(v) => {
          setCalendarView(v);
          setActiveModule("workbench");
        }}
        onQuickCapture={handleQuickCapture}
        onOpenCreateModal={() => {
          if (createModalOpen) return;
          setDraftsOpen(false);
          setModalDraft(null);
          setCreateModalOpen(true);
        }}
        onError={(msg) => showToast(msg, true)}
      />

      <div className="dw-workspace-body">
        <IconRail
          activeModule={activeModule}
          draftsOpen={draftsOpen}
          totalTasksCount={tasks.length}
          draftsCount={drafts.length}
          trashCount={trash.length}
          onSelectModule={(mod) => {
            if (selectedTaskId) {
              requestInspectorLeave({ kind: "switchModule", module: mod });
            } else {
              setActiveModule(mod);
              setDraftsOpen(false);
            }
          }}
          onToggleDrafts={() => {
            if (draftsOpen) {
              setDraftsOpen(false);
            } else if (selectedTaskId) {
              requestInspectorLeave({ kind: "openDrafts" });
            } else {
              setDraftsOpen(true);
            }
          }}
        />

        {/* MODULE 1: WORKBENCH (Day / Month) */}
        {activeModule === "workbench" && (
          <main className="dw-workbench">
            <WorkbenchLeftPanel
              calendarView={calendarView}
              selectedDate={selectedDate}
              todayDate={clock.date}
              showLunar={settings.showLunar}
              tags={tags}
              tasks={displayedTasks}
              occurrences={occurrences}
              selectedTaskId={selectedTaskId}
              onSelectDate={setSelectedDate}
              onEnterDayView={() => setCalendarView("day")}
              onOpenInspector={(id) => requestInspectorLeave({ kind: "switchTask", taskId: id })}
              onInspectRecurringRule={handleInspectRecurringRule}
              onToggleTaskDone={handleToggleTaskDone}
              onToggleOccurrenceDone={(occ) => void handleToggleOccurrenceDone(occ)}
              onSkipOccurrence={(occ) => void handleSkipOccurrence(occ)}
              onReturnToPool={handleReturnToPool}
              onQuickWeaveTask={handleQuickWeaveTask}
              onUpdatePoolDuration={(task, mins) => {
                handleUpdateTask(task, { duration: mins });
                showToast(`预计耗时已改为 ${fmtDuration(mins)}`);
              }}
              draggingPoolTaskId={poolDrag?.moved ? poolDrag.task.id : null}
              pointerDropDate={poolDrag?.moved ? poolDrag.hoverMiniDate : null}
              onPoolPointerDown={handlePoolPointerDown}
              shouldSuppressPoolClick={shouldSuppressPoolClick}
            />

            <div className="dw-canvas">
              {loaded && occurrenceStatus !== "ready" && (
                <div className="dw-occurrence-status" role="status">
                  {occurrenceStatus === "loading" ? "正在加载重复事项…" : (
                    <>重复事项加载失败。 <button type="button" className="dw-btn-ghost" onClick={() => setOccurrenceRetry((n) => n + 1)}>重试</button></>
                  )}
                </div>
              )}
              {calendarView === "day" ? (
                <div key="view-day" className="dw-canvas-view">
                  <DayTimeline
                    selectedDate={selectedDate}
                    todayDate={clock.date}
                    nowMinutes={clock.minutes}
                    settings={settings}
                    tags={tags}
                    tasks={displayedTasks}
                    occurrences={occurrences}
                    selectedTaskId={selectedTaskId}
                    justWovenTaskId={justWovenTaskId}
                    pointerDropGhost={
                      poolDrag?.moved && poolDrag.hoverTimelineStartMin !== null
                        ? {
                            top: poolDrag.hoverTimelineStartMin,
                            height: poolDrag.task.duration,
                            title: `排入：${poolDrag.task.title}`,
                          }
                        : null
                    }
                    pendingOccReschedule={pendingOccReschedule}
                    onSelectDate={setSelectedDate}
                    onOpenInspector={(id) => requestInspectorLeave({ kind: "switchTask", taskId: id })}
                    onInspectRecurringRule={handleInspectRecurringRule}
                    onToggleTaskDone={handleToggleTaskDone}
                    onToggleOccurrenceDone={(occ) => void handleToggleOccurrenceDone(occ)}
                    onSkipOccurrence={(occ) => void handleSkipOccurrence(occ)}
                    onReturnToPool={handleReturnToPool}
                    onMoveOrResizeTask={handleMoveOrResizeTask}
                    onRequestRescheduleOccurrence={handleRequestRescheduleOccurrence}
                    onInlineCreateTask={handleInlineCreateTask}
                    onLocateTodayToast={(msg) => showToast(msg)}
                  />
                </div>
              ) : (
                <div key="view-month" className="dw-canvas-view">
                  <MonthView
                    selectedDate={selectedDate}
                    todayDate={clock.date}
                    showLunar={settings.showLunar}
                    tags={tags}
                    tasks={displayedTasks}
                    occurrences={occurrences}
                    selectedTaskId={selectedTaskId}
                    pointerDropDate={poolDrag?.moved ? poolDrag.hoverMonthDate : null}
                    onSelectDate={setSelectedDate}
                    onEnterDayView={(date) => {
                      setSelectedDate(date);
                      setCalendarView("day");
                    }}
                    onOpenInspector={(id) => requestInspectorLeave({ kind: "switchTask", taskId: id })}
                    onInspectRecurringRule={handleInspectRecurringRule}
                  />
                </div>
              )}
            </div>
          </main>
        )}

        {/* MODULE 2: ALL TASKS */}
        {activeModule === "tasks" && (
          <AllTasksView
            tasks={displayedTasks}
            tags={tags}
            todayDate={clock.date}
            selectedDate={selectedDate}
            selectedTaskId={selectedTaskId}
            onOpenCreateModal={() => {
              if (createModalOpen) return;
              setDraftsOpen(false);
              setModalDraft(null);
              setCreateModalOpen(true);
            }}
            onOpenInspector={(id) => requestInspectorLeave({ kind: "switchTask", taskId: id })}
            onToggleTaskDone={handleToggleTaskDone}
            onQuickWeaveTask={(task) => handleQuickWeaveTask(task)}
          />
        )}

        {/* MODULE 3: RECURRING RULES */}
        {activeModule === "recurring" && (
          <RecurringView
            rules={recurringRules}
            archivedRules={archivedRecurringRules}
            tags={tags}
            todayDate={clock.date}
            focusRuleId={focusRuleId}
            onConsumeFocusRule={() => setFocusRuleId(null)}
            onCreateRule={handleCreateRule}
            onUpdateRule={handleUpdateRule}
            onToggleRule={(rule) => void handleToggleRule(rule)}
            onArchiveRule={handleArchiveRule}
            onRestoreRule={handleRestoreRule}
          />
        )}

        {/* MODULE 4: TRASH */}
        {activeModule === "trash" && (
          <TrashView
            items={trash}
            todayDate={clock.date}
            onRestore={handleRestoreTask}
            onPurge={handlePurgeTask}
            onEmptyTrash={handleEmptyTrash}
          />
        )}

        {/* MODULE 5: SETTINGS & TAG MANAGER */}
        {activeModule === "settings" && (
          <SettingsView
            settings={settings}
            savingSettings={!loaded || savingSettings}
            tags={tags}
            tasks={tasks}
            onUpdateSetting={(k, v) => void handleUpdateSetting(k, v)}
            onCreateTag={handleCreateTag}
            onDeleteTag={handleDeleteTag}
            onNotify={showToast}
          />
        )}

        {/* RIGHT SLIDE-OVER INSPECTOR DRAWER (360px) */}
        <InspectorDrawer
          task={selectedTask}
          previewTask={
            inspectorPreview && selectedTask && inspectorPreview.id === selectedTask.id
              ? inspectorPreview
              : selectedTask
          }
          tags={tags}
          selectedDate={selectedDate}
          todayDate={clock.date}
          pendingLeave={Boolean(pendingInspectorLeave)}
          onClose={() => requestInspectorLeave({ kind: "close" })}
          onCancelLeave={() => setPendingInspectorLeave(null)}
          onDiscardAndLeave={() => applyInspectorLeave(pendingInspectorLeave ?? { kind: "close" })}
          onSaveAndLeave={handleSaveAndLeaveInspector}
          onPreviewChange={setInspectorPreview}
          onSaveTask={handleSaveInspectorTask}
          onDeleteTask={handleSoftDeleteTask}
          onNotify={showToast}
        />

        {/* LEFT SLIDE-OVER DRAFTS DRAWER (336px) */}
        <DraftsDrawer
          open={draftsOpen}
          drafts={drafts}
          todayDate={clock.date}
          onClose={() => setDraftsOpen(false)}
          onRestoreDraft={(d) => {
            if (createModalOpen) return;
            setDraftsOpen(false);
            setModalDraft(d);
            setCreateModalOpen(true);
            showToast("已恢复草稿，可继续完善并提交");
          }}
          onDeleteDraft={handleDeleteDraft}
        />
      </div>

      {/* CENTERED DETAILED CREATE MODAL */}
      {createModalOpen && <CreateModal
        key={modalDraft?.id ?? "new"}
        initialDraft={modalDraft}
        drafts={drafts}
        tags={tags}
        selectedDate={selectedDate}
        defaultDuration={settings.defaultDuration}
        autoDraft={settings.autoDraft}
        onClose={() => {
          setCreateModalOpen(false);
          setModalDraft(null);
        }}
        onSaveDraft={handleSaveDraft}
        onSubmitTask={handleCreateFromModal}
        onPickDraft={(d) => {
          setModalDraft(d);
          showToast("已恢复草稿，可继续完善并提交");
        }}
        onResetBlank={() => {
          setModalDraft(null);
        }}
        onNotify={(msg) => showToast(msg)}
      />}

      {/* RECURRING OCCURRENCE RESCHEDULE SCOPE CONFIRMATION MODAL */}
      {pendingOccReschedule && (() => {
        const { occ, origStartMin, origDuration, nextStartMin, nextDuration } = pendingOccReschedule;
        const ruleExists = recurringRules.some((r) => r.id === occ.ruleId);
        const dateLabel = formatDateShortCn(occ.occurrenceDate);
        return (
          <div
            className="dw-modal-backdrop"
            onClick={() => {
              if (!reschedulingOcc) setPendingOccReschedule(null);
            }}
          >
            <div
              className="dw-modal dw-reschedule-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dw-reschedule-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="dw-drawer-header">
                <h3 id="dw-reschedule-title" className="dw-drawer-title">调整重复安排时间</h3>
                <button
                  type="button"
                  className="dw-drawer-close"
                  disabled={reschedulingOcc}
                  onClick={() => setPendingOccReschedule(null)}
                  aria-label="关闭确认弹窗"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>

              <div className="dw-reschedule-body">
                <div className="dw-reschedule-summary">
                  <div className="dw-reschedule-task-name">{occ.title}</div>
                  <div className="dw-reschedule-diff font-mono tabular-nums">
                    <span className="dw-reschedule-date">{dateLabel}</span>
                    <span className="dw-reschedule-old">
                      {fmtMinutes(origStartMin)}–{fmtMinutes(origStartMin + origDuration)}（{fmtDuration(origDuration)}）
                    </span>
                    <span aria-hidden="true">→</span>
                    <span className="dw-reschedule-new">
                      {fmtMinutes(nextStartMin)}–{fmtMinutes(nextStartMin + nextDuration)}（{fmtDuration(nextDuration)}）
                    </span>
                  </div>
                </div>

                <div className="dw-reschedule-options">
                  <button
                    type="button"
                    className="dw-reschedule-option"
                    disabled={reschedulingOcc}
                    onClick={() => void handleConfirmRescheduleOccurrence("single")}
                  >
                    <span className="dw-reschedule-opt-title">仅调整本次（{dateLabel}）</span>
                    <span className="dw-reschedule-opt-desc">只修改这一天的时间，其他日期及原重复规则保持不变</span>
                  </button>

                  <button
                    type="button"
                    className="dw-reschedule-option is-primary"
                    disabled={reschedulingOcc || !ruleExists}
                    onClick={() => void handleConfirmRescheduleOccurrence("this_and_future")}
                  >
                    <span className="dw-reschedule-opt-title">调整本次及未来安排</span>
                    <span className="dw-reschedule-opt-desc">
                      {ruleExists
                        ? `保留 ${dateLabel} 之前的历史记录不变，从本次起后续重复统一改为新时间`
                        : "原重复规则已归档，仅支持调整本次安排"}
                    </span>
                  </button>
                </div>
              </div>

              <div className="dw-drawer-footer" style={{ justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="dw-btn-ghost"
                  disabled={reschedulingOcc}
                  onClick={() => setPendingOccReschedule(null)}
                >
                  取消并还原
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* FLOATING POINTER DRAG PREVIEW FOR POOL TASKS */}
      {poolDrag?.moved && (() => {
        const tg = tags.find((t) => t.id === poolDrag.task.tagId);
        const dotHex = tg ? TAG_COLOR_HEX[tg.color] ?? TAG_COLOR_HEX.blue : TAG_COLOR_HEX.blue;
        const targetBadge =
          poolDrag.hoverTimelineStartMin !== null
            ? `排入 ${fmtMinutes(poolDrag.hoverTimelineStartMin)}`
            : poolDrag.hoverMiniDate
              ? `排入 ${formatDateShortCn(poolDrag.hoverMiniDate)}`
              : poolDrag.hoverMonthDate
                ? `排入 ${formatDateShortCn(poolDrag.hoverMonthDate)}`
                : null;
        return (
          <div
            className="dw-pool-drag-ghost"
            style={{
              left: `${Math.min(window.innerWidth - 230, poolDrag.x + 14)}px`,
              top: `${Math.max(12, Math.min(window.innerHeight - 64, poolDrag.y - 18))}px`,
            }}
            aria-hidden="true"
          >
            <div className="dw-pool-drag-ghost-row">
              <span className="dw-section-dot" style={{ background: dotHex }} />
              <span className="dw-pool-drag-ghost-title">{poolDrag.task.title}</span>
              <span className="dw-pool-drag-ghost-dur font-mono tabular-nums">
                {fmtDuration(poolDrag.task.duration)}
              </span>
            </div>
            {targetBadge && (
              <div className="dw-pool-drag-ghost-target font-mono tabular-nums">{targetBadge}</div>
            )}
          </div>
        );
      })()}

      {/* WHITE-CARD UNDO TOAST */}
      {toast && (
        <div className={`dw-toast${toast.isError ? " is-error" : ""}`} role="status" aria-live="polite">
          <span className="dw-toast-dot" />
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              className="dw-toast-undo"
              onClick={() => {
                const fn = toast.undo;
                setToast(null);
                if (fn) void fn();
              }}
            >
              <span>撤销</span>
              <kbd className="dw-kbd">Ctrl+Z</kbd>
            </button>
          )}
        </div>
      )}

      {/* UNIFIED WHITE-CARD PORTAL TOOLTIP HOST */}
      <TooltipHost />
    </div>
  );
}
