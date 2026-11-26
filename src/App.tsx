import { readRecurringDraft, RECURRING_DRAFT_KEY } from "./legacy-storage";
import {
  CSSProperties,
  FormEvent,
  Fragment,
  KeyboardEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { ConfirmationDialog, lockBackgroundElements, Toast, ToastViewport } from "./feedback";
import { AppTitlebar } from "./app-titlebar";
import { Logo } from "./logo";
import "./settings-dialog.css";
import { CopySeparator, SeparatedCopy } from "./copy-separator";
import { compactBlockDuration, recurringBlockDisplay, taskBlockType, taskBlockTypeLabels, TaskBlockType } from "./task-block-display";
import { TimelineTaskCreate, TimelineCreateRange } from "./timeline-task-create";
import { TaskDurationPresets, TaskTimeRangeFields } from "./task-time-range-fields";
import { TimeWheelPopover, TimeWheelTrigger } from "./time-wheel-picker";
import { priorityCopy, TaskPrioritySelector } from "./task-priority-selector";
import { isTaskTimelineTooltip, TaskTimelineHoverCard, TimelineHoverCopyButton, TimelineStaticHoverCard, TimelineTooltipContent, TimelineTooltipState } from "./timeline-hover-card";
import { WeekTimeline } from "./week-timeline";
import { weekDatesFor, weekHeading } from "./week-timeline-model";
import { recurringTimeBlockIssue, recurringOccurrenceInput, recurringChangeIssue, recurringTimeRange, recurringClockRange, recurringRangeInput, RecurringScheduleChange, RecurringEditScope } from "./recurring-schedule";
import { RecurringScopeConfirmation } from "./recurring-scope-confirmation";
import { canCaptureRecurringResult } from "./review-workflow";
import { onReminderActivated, ReminderAction, setAppWindowTitle } from "./tauri";
import { openUrl } from "@tauri-apps/plugin-opener";
import recurringIcon from "./assets/recurring.svg";
import {
  applyUndo,
  completeTask,
  confirmCreationDraft,
  importLegacyRecurringDraft,
  confirmRuleBasedPlan,
  createManualTaskDraft,
  DaySchedule,
  discardRulePlanDraft,
  discardTaskDraft,
  getAutostartEnabled,
  getDaySchedule,
  getTask,
  getTaskMetadata,
  getRulePlanDraft,
  getUiSetting,
  latestUndo,
  listTaskDrafts,
  listTasks,
  listRecurringItems,
  listRecurringOccurrences,
  listRecurringOccurrencesRange,
  listRecurringExecutionHistory,
  saveRecurringOccurrenceReview,
  clearRecurringOccurrenceReview,
  resolveRecurringEditTarget,
  updateRecurringOccurrence,
  ManualTaskUpdate,
  PlanBlock,
  permanentlyDeleteRecurringItem,
  permanentlyDeleteManualTask,
  reopenManualTask,
  restoreManualTask,
  restoreRecurringItem,
  RulePlanBlock,
  RulePlanPreview,
  RuleUnscheduledTask,
  RecurrenceInput,
  RecurringItem,
  RecurringItemInput,
  RecurringOccurrence,
  RecurringExecutionEvent,
  RecurringOccurrenceOutcome,
  ReviewOutcome,
  sendTestNotification,
  setAutostartEnabled,
  saveExecutionCapture,
  clearExecutionCapture,
  resolveTaskExecution,
  saveTaskDraft,
  softDeleteManualTask,
  softDeleteRecurringItem,
  setRecurringItemStatus,
  Task,
  TaskMetadata,
  TaskHistoryEvent,
  TaskDraft,
  TaskDraftInput,
  TaskStatus,
  transitionManualTask,
  updateRulePlanDraft,
  updatePlanBlockTime,
  updateManualTask,
  updateRecurringTask,
  setUiSetting
} from "./tauri";
import { calendarDayInfo, lunarDayLabel, lunarDateLabel, monthOverviewMeta, solarTermProgressLabel, weekPeriodLabel } from "./calendar-data";
import { HolidayCalendarSettings, HolidayCoverageNotice } from "./holiday-calendar-status";
import { useHolidayCalendarSync } from "./holiday-calendar-sync";
import { recurringRuleOccursOn, taskAppearsOnDate } from "./calendar-task-placement";
import { timelineDurationHeight, dayTimelineLayout, TimelineLane } from "./timeline-lane-layout";
import { TimelineOverflowDialog } from "./timeline-overflow-dialog";
import {
  applyTimeWheelSelection,
  closestTimeRangeEdge,
  continuousTimeRangeGeometry,
  continuousTimeScaleMarks,
  constrainTimeRange,
  focusedTimeRangePresentation,
  normalizeClockInput,
  sanitizeTimeInput,
  selectDateRange,
  selectTaskDateBoundary,
  taskDateRangeIncludesHistory,
  timeRangePresentationCanReuse,
  timeRangePresentationContains,
  TimeRangeEdge
} from "./time-range-control";
import { recycleCleanupMessage } from "./recycle-retention";
import {
  formatWorkloadMinutes,
  inferredDailyWorkloadMinutes,
  isCrossDayTask,
  MAX_TASK_WORKLOAD_MINUTES,
  MIN_TASK_WORKLOAD_MINUTES,
  normalizeTaskWorkloadAfterScheduleChange,
  taskDateSpanDays,
  taskRangeDurationMinutes,
  taskRangeIsValid,
  taskScheduleIsComplete,
  taskWorkloadIsValid,
  totalWorkloadForDaily
} from "./task-workload";
import { syncFormCommonFields } from "./create-type-switch";
import { joinTaskNotes, splitTaskNotes, taskResourceUrl } from "./task-notes";
import { canCaptureTaskResult, normalizeTodayNavigation } from "./review-workflow";
import { executionResultForOutcome, taskExecutionResolution, timelineTaskCompletionAction, timelineTaskDialogState, taskResultEditable, resultToday, taskNextActionLabels, ExecutionResult, ExecutionOutcome, visibleTaskScheduleBlocks, visibleUntimedTasksForDate, formatSidebarSummaryDuration, taskListStatus, TaskListStatus } from "./task-result";
import { historicalTaskCreationError, isHistoricalResultDate, historicalBlockCompletionLocked, historicalTaskCompletionLocked, HISTORY_COMPLETION_LOCKED_MESSAGE, HISTORICAL_TASK_CREATION_NOTE } from "./task-result";
import { independentTaskDraft, type TaskDraftSeed } from "./task-followup";
import { TaskTagEditor, TaskTagFilter, TaskTagList } from "./task-tag-editor";
import { matchesTag, matchesTaggedSearch, tagKey, uniqueTags } from "./task-tags";

type IconName =
  | "today" | "tasks" | "calendar" | "review" | "settings"
  | "plus" | "sparkle" | "more" | "check" | "send" | "search"
  | "trash" | "restore" | "close" | "clock" | "filter" | "user" | "info" | "chevron-left" | "chevron-right" | "chevron-down" | "chevron-up"
  | "moon" | "pause" | "sliders" | "checkbox" | "file" | "external-link" | "deadline" | "locate" | "pencil";

const navigation: { label: string }[] = [{ label: "今日" }, { label: "任务" }];

type TaskView = "all" | "draft" | "recurring" | TaskListStatus;
type CreateItemType = "task" | "recurring";
type LedgerResizeSession = { pointerId: number; startX: number; startWidth: number };
type TimelineReturnContext = { date: string; blockId?: string; taskId?: string; occurrenceId?: string; eventId?: string };
type TaskSeed = TaskDraftSeed;
type ScheduleView = "month" | "timeline" | "week";
type NavigationIntent = { active: string; date?: string; todayView?: ScheduleView; taskView?: TaskView; createTask?: boolean; taskId?: string; completeOnOpen?: boolean; recurringItemId?: string; taskSeed?: TaskSeed; timelineReturnContext?: TimelineReturnContext };
type PlanLeaveIntent = { kind: "navigation"; intent: NavigationIntent } | { kind: "date"; date: string };
type TaskViewRequest = { view?: TaskView; createTask?: boolean; taskId?: string; recurringItemId?: string; taskSeed?: TaskSeed; completeOnOpen?: boolean };
type PendingTaskChange =
  | { kind: "select"; taskId: string; edit?: boolean }
  | { kind: "select-recurring"; itemId: string }
  | { kind: "recurring-detail" }
  | { kind: "new-independent"; seed: TaskSeed }
  | { kind: "view"; view: TaskView }
  | { kind: "detail" }
  | { kind: "close-compact-editor" }
  | { kind: "transition"; status: TaskStatus }
  | { kind: "reopen" }
  | { kind: "trash"; task?: { id: string; title: string } };

type NewTaskForm = {
  title: string;
  notes: string;
  priority: ManualTaskUpdate["priority"];
  estimated_minutes: number | null;
  earliest_start_date: string;
  earliest_start_time: string;
  due_date: string;
  due_time: string;
  tags: string[];
  recurrence: RecurrenceInput | null;
};
type RecurringItemForm = Omit<RecurringItemInput, "notes" | "ends_on" | "display_time" | "display_duration_minutes"> & {
  notes: string;
  ends_on: string;
  display_time: string;
  display_duration_minutes: number | null;
};
type TaskSchedulePicker = {
  activeField: "start" | "end";
  dateAnchor: string | null;
  earliest_start_date: string;
  earliest_start_time: string;
  due_date: string;
  due_time: string;
  timed?: boolean;
};

const TASK_LEDGER_WIDTH_SETTING = "ui.task_ledger_list_width";
const TASK_QUEUE_VIEW_SETTING = "ui.task_queue_view";
const TASK_LEDGER_LIST_MIN_WIDTH = 320;
const TASK_LEDGER_INSPECTOR_MIN_WIDTH = 380;
const TASK_LEDGER_HANDLE_WIDTH = 14;
const TASK_LEDGER_LIST_DEFAULT_WIDTH = 400;
const SHELL_SIDEBAR_COLLAPSED_SETTING = "ui.shell_sidebar_collapsed";
const MIN_TASK_BLOCK_MINUTES = 15;
const COMPACT_TASK_BLOCK_THRESHOLD_MINUTES = 30;
const UNTIMED_SCHEDULE_NOTE = "不占用时间线时段，会在对应日期的「不限时事项」中显示，可随时勾选完成或补充具体时段。";

function UntimedScheduleNote() {
  return <div className="schedule-picker-untimed-note" role="note">
    <span className="schedule-picker-untimed-icon" aria-hidden="true"><Icon name="info" size={14} /></span>
    <div className="schedule-picker-untimed-copy">
      <strong>当前为不限时刻</strong>
      <p>{UNTIMED_SCHEDULE_NOTE}</p>
    </div>
  </div>;
}

const statusCopy: Record<TaskListStatus, string> = {
  scheduled: "进行中", not_completed: "未完成", done: "已完成", deleted: "回收站"
};
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<IconName, React.ReactNode> = {
    today: <><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M8 2v4M16 2v4M3 10h18M8 14h3" /></>,
    tasks: <><path d="m5 12 4 4L19 6" /><path d="M5 5h7M5 19h7" /></>,
    checkbox: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m7 12 3 3 7-7" /></>,
    file: <><path d="M6 3h9l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h5M8 12h7M8 16h7" /></>,
    calendar: <><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M8 2v4M16 2v4M3 10h18" /></>,
    deadline: <><path d="M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0" /></>,
    review: <><path d="M4 19.5V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14.5" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.14 2.14-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.55V20.3h-3v-.08A1.7 1.7 0 0 0 10.65 18.7a1.7 1.7 0 0 0-1.88.34l-.06.06-2.14-2.14.06-.06A1.7 1.7 0 0 0 6.97 15a1.7 1.7 0 0 0-1.55-1.03h-.08v-3h.08A1.7 1.7 0 0 0 6.97 9.94a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.14-2.14.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.55v-.08h3v.08a1.7 1.7 0 0 0 1.03 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06L19.8 8l-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.55 1.03h.08v3h-.08A1.7 1.7 0 0 0 19.4 15Z" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    sparkle: <><path d="m12 3-1.2 5.3L6 9.5l4.8 1.2L12 16l1.2-5.3L18 9.5l-4.8-1.2L12 3Z" /><path d="m19 16-.55 2.45L16 19l2.45.55L19 22l.55-2.45L22 19l-2.45-.55L19 16Z" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
    check: <path d="m5 12 4.2 4.2L19 6.5" />,
    send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
    search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.4-4.4" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14" /><path d="M10 11v6M14 11v6" /></>,
    restore: <><path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.68" /><path d="M4 4v4.68h4.68" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    pencil: <><path d="m16 3 5 5L8 21H3v-5L16 3Z" /><path d="m14 5 5 5" /></>,
    locate: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
    filter: <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />,
    user: <><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    "chevron-left": <path d="m15 18-6-6 6-6" />,
    "chevron-right": <path d="m9 18 6-6-6-6" />,
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    "chevron-up": <path d="m18 15-6-6-6 6" />,
    moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
    "external-link": <><path d="M14 3h7v7M21 3l-9 9" /><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></>,
    pause: <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>,
    sliders: <><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></>
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function ScheduleViewIcon({ view }: { view: ScheduleView }) {
  const common = { width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (view === "timeline") {
    return <svg {...common}><rect x="3" y="4" width="18" height="17" rx="2.5" /><path d="M8 2v4M16 2v4M3 10h18M8 14h4" /></svg>;
  }
  if (view === "week") {
    return <svg {...common}><rect x="3" y="4" width="18" height="17" rx="2.5" /><path d="M3 10h18M9 10v11M15 10v11" /></svg>;
  }
  return <svg {...common}><rect x="3" y="4" width="18" height="17" rx="2.5" /><path d="M3 9h18M9 9v12M15 9v12M3 15h18" /></svg>;
}

function SidebarIcon({ name }: { name: "today" | TaskView }) {
  const paths: Partial<Record<"today" | TaskView, React.ReactNode>> = {
    today: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
    all: <><path d="m9 11 3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
    scheduled: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
    draft: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></>,
    recurring: <><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38" /></>,
    not_completed: <><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></>,
    deleted: <><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>
  };
  if (name === "done") return <Icon name={taskViewIcon[name]} size={14} />;
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{paths[name]}</svg>;
}


function toInputTimestamp(value: string | null) {
  return value ? value.slice(0, 16) : "";
}

function toShanghaiTimestamp(value: string) {
  return value ? `${value}:00+08:00` : null;
}

function shanghaiDateValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function shanghaiDateTimeFields(timestamp: number) {
  const shifted = new Date(timestamp + 8 * 60 * 60 * 1000).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

function newTaskDefaultForm(now = new Date()): NewTaskForm {
  const date = shanghaiDateValue(now);
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23"
  }).format(now));
  const currentHour = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+08:00`).getTime();
  // Keep the recommended one-hour task on one day, including late evening.
  const startAt = currentHour + (hour === 22 ? 2 : 1) * 60 * 60 * 1000;
  const start = shanghaiDateTimeFields(startAt);
  const end = shanghaiDateTimeFields(startAt + 60 * 60 * 1000);
  return {
    title: "",
    notes: "",
    priority: "high",
    estimated_minutes: Math.round((
      new Date(`${end.date}T${end.time}:00+08:00`).getTime()
      - new Date(`${start.date}T${start.time}:00+08:00`).getTime()
    ) / 60000),
    earliest_start_date: start.date,
    earliest_start_time: start.time,
    due_date: end.date,
    due_time: end.time,
    tags: [],
    recurrence: null
  };
}

function recurringItemDefaultForm(today = shanghaiDateValue(), now = new Date()): RecurringItemForm {
  const schedule = newTaskDefaultForm(now);
  return {
    title: "",
    notes: "",
    frequency: "weekly",
    interval_value: 1,
    weekdays: [weekdayNumber(today)],
    month_day: Number(today.slice(8, 10)),
    starts_on: today,
    ends_on: "",
    display_time: schedule.earliest_start_time,
    display_duration_minutes: schedule.estimated_minutes,
    tags: []
  };
}

function loadStoredRecurringDraft(): RecurringItemForm | null {
  try {
    const raw = readRecurringDraft(localStorage);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.title === "string" && typeof parsed.frequency === "string") {
      return parsed as RecurringItemForm;
    }
  } catch {
    // ignore
  }
  return null;
}

function recurringItemInputForForm(form: RecurringItemForm): RecurringItemInput {
  return {
    ...form,
    notes: form.notes.trim() || null,
    ends_on: form.ends_on || null,
    display_time: form.display_time || null,
    display_duration_minutes: form.display_duration_minutes,
    tags: form.tags.map((tag) => tag.trim()).filter(Boolean)
  };
}

function recurringItemFormForItem(item: RecurringItem): RecurringItemForm {
  return {
    title: item.title,
    notes: item.notes ?? "",
    frequency: item.frequency,
    interval_value: item.interval_value,
    weekdays: item.weekdays,
    month_day: item.month_day,
    starts_on: item.starts_on,
    ends_on: item.ends_on ?? "",
    display_time: item.display_time ?? "",
    display_duration_minutes: item.display_duration_minutes,
    tags: item.tags
  };
}

function recurringFormForOccurrence(item: RecurringItem, occurrence: RecurringOccurrence | null): RecurringItemForm {
  if (!occurrence) return recurringItemFormForItem(item);
  return recurringItemFormForItem({ ...item, ...recurringOccurrenceInput(item, occurrence) });
}

function recurringFormForDraft(draft: TaskDraft, today: string): RecurringItemForm {
  const settings = draft.recurring_settings;
  return {
    ...recurringItemDefaultForm(today), ...settings,
    title: draft.title, notes: draft.notes ?? "", tags: draft.tags,
    ends_on: settings?.ends_on ?? "", display_time: settings?.display_time ?? "",
    display_duration_minutes: settings?.display_duration_minutes ?? null
  };
}

function recurringItemPreviewDates(form: RecurringItemForm) {
  const dates: string[] = [];
  if (!form.starts_on || form.interval_value < 1 || form.frequency === "weekly" && !form.weekdays.length) return dates;
  for (let offset = 0; offset <= 1100 && dates.length < 3; offset += 1) {
    const date = shiftDateValue(form.starts_on, offset);
    if (form.ends_on && date > form.ends_on) break;
    if (recurringRuleOccursOn(form, date)) dates.push(date);
  }
  return dates;
}

function recurringFormSaveIssue(form: RecurringItemForm) {
  if (!form.title.trim()) return "请填写标题。";
  const timeIssue = recurringTimeBlockIssue(form);
  if (timeIssue) return timeIssue;
  if (!recurringItemPreviewDates(form).length) return "有效日期暂无匹配发生日，不能保存。";
  return null;
}

function newTaskFormMatches(first: NewTaskForm, second: NewTaskForm) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function uiErrorMessage(reason: unknown) {
  const raw = String(reason).trim().replace(/^Error:\s*/i, "");
  if (!raw) return "暂时无法完成，请稍后重试。";
  if (/^(数据库错误|序列化错误)：/.test(raw)) return "本地数据暂时无法处理，请稍后重试。";
  if (raw.startsWith("找不到指定对象：")) return "相关内容已经不存在，请刷新后重试。";
  if (raw === "操作确认无效或已过期") return "这次确认已失效，请重新操作。";
  const message = raw
    .replace(/^结构化操作无效：\s*/, "")
    .replace(/^领域规则不允许此操作：\s*/, "");
  if (/^(无法初始化 AI 网络连接|AI 连接失败)/.test(message)) {
    return "无法连接 AI 服务，请检查连接地址和网络后重试。";
  }
  if (/^AI 服务返回了无法解析的响应/.test(message)) {
    return "AI 服务返回的内容无法识别，请检查接口类型后重试。";
  }
  const aiStatus = message.match(/^AI 服务返回 (\d{3})/);
  if (aiStatus) {
    const status = Number(aiStatus[1]);
    if (status === 401 || status === 403) return "AI 连接未通过验证，请检查访问密钥。";
    if (status === 404) return "没有找到对应的 AI 服务，请检查连接地址和模型名称。";
    if (status === 429) return "AI 服务请求过于频繁，请稍后重试。";
    if (status >= 500) return "AI 服务暂时不可用，请稍后重试。";
    return "AI 服务没有完成请求，请检查连接设置后重试。";
  }
  if (message.startsWith("AI 结构化结果不符合今序草稿格式")) {
    return "AI 返回的内容无法整理成草稿，请换一种说法再试。";
  }
  if (message.includes("YYYY-MM-DD")) return "日期格式不正确，请重新选择日期。";
  if (message.includes("HH:MM") || message.includes("RFC3339")) return "时间格式不正确，请重新选择时间。";
  if (/proposal_id|task_ids|草稿版本|修改范围必须为 this 或 future|必须为 active、paused 或 ended|v1 仅接受|状态转移|撤销快照|AI 运行|不允许查询该表|未知.+(?:类型|状态|操作)/.test(message)) {
    return "内容已经变化或暂时无法处理，请刷新后重试。";
  }
  if (message.includes("结构化文本")) return "AI 返回的内容无法识别，请换一种说法再试。";
  const readableMessage = message
    .replace(/执行事实/g, "执行记录")
    .replace(/复盘事实/g, "复盘记录")
    .replace(/历史发生记录/g, "过去的记录")
    .replace(/发生记录/g, "记录")
    .replace(/重复任务实例/g, "重复任务")
    .replace(/未来实例/g, "以后的重复任务")
    .replace(/当前实例/g, "当前任务")
    .replace(/重新读取/g, "重新打开")
    .replace(/迟到结果不会写入草稿/g, "本次未完成的结果不会保留");
  if (/\[object Object\]|[{}]|\b(?:[a-z][a-z0-9]*_)+[a-z0-9]+\b|\b(?:SQLite|SQL|JSON|RFC3339|rusqlite|serde|SELECT|INSERT|UPDATE|DELETE|FOREIGN KEY|invoke|command|plugin)\b|\b(?:TypeError|ReferenceError|RangeError|NetworkError)\b|\b(?:invalid|unknown|missing|expected|failed)\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|line \d+ column \d+/i.test(readableMessage)) {
    return "暂时无法完成，请稍后重试。";
  }
  return readableMessage;
}

function pickerDateLabel(value: string) {
  if (!value) return "选择日期";
  const [year, month, day] = value.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

function shiftMonthKey(monthKey: string, delta: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftDateValue(date: string, days: number) {
  const value = new Date(`${date}T00:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return shanghaiDateValue(value);
}

function timeLabel(value: string) {
  return value.slice(11, 16);
}

function timeRangeLabel(startsAt: string, endsAt: string) {
  return `${timeLabel(startsAt)} - ${timeLabel(endsAt)}`;
}

function timeRangeDurationMinutes(startsAt: string, endsAt: string) {
  return Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000);
}

function shortTaskBlockClass(startsAt: string, endsAt: string) {
  const durationMs = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  return durationMs < COMPACT_TASK_BLOCK_THRESHOLD_MINUTES * 60000 ? " is-short" : "";
}

function TimelineTaskFacts({ priority, type, inline = false }: { priority?: Task["priority"]; type: TaskBlockType | null; inline?: boolean }) {
  if (!type) return null;
  return <span className={`timeline-task-facts${inline ? " inline-facts" : ""}`}>
    {type !== "recurring" && priority && <span className={`timeline-fact-priority priority-${priority}`}><span className="timeline-fact-full">{priorityCopy[priority]}</span><span className="timeline-fact-short">{{ urgent: "P0", high: "P1", medium: "P2", low: "P3" }[priority]}</span></span>}
    <span className={`timeline-fact-type type-${type}`}><span className="timeline-fact-full">{taskBlockTypeLabels[type].full}</span><span className="timeline-fact-short">{taskBlockTypeLabels[type].short}</span></span>
  </span>;
}

function TimelineTaskContent({ title, range, duration, priority, type, url, note, tags = [] }: {
  title: string; range: string; duration: string; priority?: Task["priority"]; type: TaskBlockType | null; url: string; note: string; tags?: string[];
}) {
  return <>
    <span className="timeline-task-head"><strong>{title}</strong><TimelineTaskFacts priority={priority} type={type} inline /><time><span className="timeline-block-clock">{range} </span><span className="timeline-block-duration">({duration})</span></time></span>
    <span className="timeline-task-metadata"><TimelineTaskFacts priority={priority} type={type} />
      {tags.length > 0 && <span className="timeline-task-tags"><TaskTagList tags={tags} /></span>}
    </span>
    {(url || note) && <span className="timeline-task-info">{url && <span className="timeline-task-url">{url}</span>}{url && note && <span className="timeline-task-divider" />}{note && <span className="timeline-task-note">{note}</span>}</span>}
  </>;
}

function taskMatchesView(task: Task, view: TaskView) {
  return view === "all" ? taskListStatus(task) !== "deleted" && !task.deleted_at
    : view !== "draft" && view !== "recurring" && taskListStatus(task) === view;
}

function taskIsEditable(task: Task | null) {
  return Boolean(task && !task.execution_locked && ["open", "scheduled"].includes(task.status));
}

const taskViewCopy: Record<TaskView, string> = {
  all: "全部任务",
  draft: "草稿箱",
  recurring: "重复规则",
  ...statusCopy
};

const reviewOutcomeCopy: Record<ReviewOutcome, string> = {
  completed: "完成",
  partial: "部分完成",
  not_started: "未完成",
  cancelled: "放弃本次安排",
  blocked: "遇到阻塞"
};

const executionResultOptions: [ExecutionResult, string][] = [["completed", "完成"], ["not_completed", "未完成"]];

function ExecutionOutcomePicker({ result, disabled, label, onChange, onCompleteTask, completeTaskDisabled = false, wholeTask = false }: {
  result: ExecutionResult | null;
  disabled: boolean;
  label: string;
  onChange: (result: ExecutionResult | null, outcome: ExecutionOutcome | null) => void;
  onCompleteTask?: () => void;
  completeTaskDisabled?: boolean;
  wholeTask?: boolean;
}) {
  return <div className="execution-choice-stack compact"><div className="floating-outcomes" role="group" aria-label={label} style={onCompleteTask ? { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" } : undefined}>
    {executionResultOptions.map(([value, text]) => <button key={value} type="button" data-outcome={value} aria-pressed={result === value} disabled={disabled} onClick={() => result === value ? onChange(null, null) : onChange(value, value === "completed" ? "completed" : "not_started")}>{result === value && <Icon name="check" size={14} />}{onCompleteTask && value === "completed" ? "当天完成" : text}</button>)}
    {onCompleteTask && <button type="button" data-action="complete-task" aria-pressed={wholeTask} disabled={disabled || completeTaskDisabled} onClick={onCompleteTask}>{wholeTask && <Icon name="check" size={14} />}整体完成</button>}
  </div></div>;
}

const taskViewIcon: Record<TaskView, IconName> = {
  all: "tasks",
  draft: "file",
  recurring: "restore",
  scheduled: "clock",
  not_completed: "clock",
  done: "check",
  deleted: "trash"
};

const taskStatusFilterOrder: TaskView[] = ["all", "scheduled", "draft", "recurring", "not_completed", "done", "deleted"];
const sidebarTaskViews: { view: TaskView; label: string }[] = [
  { view: "scheduled", label: "进行中" },
  { view: "draft", label: "草稿箱" },
  { view: "recurring", label: "重复规则" },
  { view: "not_completed", label: "未完成" },
  { view: "done", label: "已完成" },
  { view: "deleted", label: "回收站" }
];

function taskViewCounts(tasks: Task[], draftCount: number, recurringItems: RecurringItem[]) {
  return {
    all: tasks.filter((task) => taskMatchesView(task, "all")).length,
    draft: draftCount,
    recurring: recurringItems.filter((item) => !item.deleted_at).length,
    scheduled: tasks.filter((task) => taskMatchesView(task, "scheduled")).length,
    not_completed: tasks.filter((task) => taskMatchesView(task, "not_completed")).length,
    done: tasks.filter((task) => taskMatchesView(task, "done")).length,
    deleted: tasks.filter((task) => taskMatchesView(task, "deleted")).length + recurringItems.filter((item) => item.deleted_at).length
  };
}
const taskEmptyCopy: Record<TaskView, string> = {
  all: "暂无任务",
  draft: "暂无待确认草稿",
  recurring: "暂无重复规则",
  scheduled: "暂无进行中任务",
  not_completed: "暂无未完成任务",
  done: "暂无已完成任务",
  deleted: "回收站为空"
};

function taskTimingFact(task: Task, today: string) {
  const value = task.due_at ?? task.earliest_start_at;
  const date = value ? value.slice(0, 10) : (task.due_date ?? task.earliest_start_date);
  if (!date) return null;
  const time = value ? value.slice(11, 16) : (task.due_date ? task.due_time : task.earliest_start_time);
  const dateLabel = date === today
    ? "今天"
    : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).format(new Date(`${date}T00:00:00+08:00`));
  return `${task.due_at || task.due_date ? "截止" : "最早"} ${dateLabel}${time ? ` ${time}` : " · 不限时刻"}`;
}

function draftForTask(task: Task): ManualTaskUpdate {
  return {
    title: task.title,
    notes: task.notes,
    priority: task.priority,
    earliest_start_at: toInputTimestamp(task.earliest_start_at),
    due_at: toInputTimestamp(task.due_at),
    earliest_start_date: task.earliest_start_date,
    due_date: task.due_date,
    estimated_minutes: task.estimated_minutes
  };
}

function draftMatchesTask(draft: ManualTaskUpdate | null, task: Task | null) {
  if (!draft || !task) return true;
  const persisted = draftForTask(task);
  const comparable = (value: ManualTaskUpdate) => ({
    title: value.title.trim(),
    notes: value.notes?.trim() || null,
    priority: value.priority ?? null,
    earliest_start_at: value.earliest_start_at || null,
    due_at: value.due_at || null,
    earliest_start_date: value.earliest_start_date || value.earliest_start_at?.slice(0, 10) || null,
    due_date: value.due_date || value.due_at?.slice(0, 10) || null,
    estimated_minutes: value.estimated_minutes ?? null
  });
  return JSON.stringify(comparable(draft)) === JSON.stringify(comparable(persisted));
}

function emptyNewTaskForm(): NewTaskForm {
  return {
    title: "",
    notes: "",
    priority: "high",
    estimated_minutes: null,
    earliest_start_date: "",
    earliest_start_time: "",
    due_date: "",
    due_time: "",
    tags: [],
    recurrence: null
  };
}

function taskDraftInputForForm(form: NewTaskForm): TaskDraftInput {
  const untimed = !form.earliest_start_time && !form.due_time;
  const undated = !form.earliest_start_date && !form.due_date;
  const estimatedMinutes = untimed || undated ? null : (taskRangeDurationMinutes(form) ?? form.estimated_minutes);
  return {
    title: form.title.trim(),
    notes: form.notes.trim() || null,
    priority: form.priority,
    earliest_start_date: form.earliest_start_date || null,
    earliest_start_time: form.earliest_start_date && form.earliest_start_time ? form.earliest_start_time : null,
    due_date: form.due_date || null,
    due_time: form.due_date && form.due_time ? form.due_time : null,
    total_workload_minutes: estimatedMinutes,
    remaining_workload_minutes: estimatedMinutes,
    field_states_json: "{}",
    tags: form.tags,
    recurrence: null
  };
}

function taskFormForPersistedDraft(draft: TaskDraft): NewTaskForm {
  return {
    title: draft.title,
    notes: draft.notes ?? "",
    priority: draft.priority,
    estimated_minutes: draft.total_workload_minutes,
    earliest_start_date: draft.earliest_start_date ?? "",
    earliest_start_time: draft.earliest_start_time ?? "",
    due_date: draft.due_date ?? "",
    due_time: draft.due_time ?? "",
    tags: draft.tags,
    recurrence: null
  };
}

function taskFormForManualUpdate(draft: ManualTaskUpdate): NewTaskForm {
  return {
    title: draft.title,
    notes: draft.notes ?? "",
    priority: draft.priority ?? null,
    estimated_minutes: draft.estimated_minutes ?? null,
    earliest_start_date: draft.earliest_start_date || draft.earliest_start_at?.slice(0, 10) || "",
    earliest_start_time: draft.earliest_start_at?.slice(11, 16) ?? "",
    due_date: draft.due_date || draft.due_at?.slice(0, 10) || "",
    due_time: draft.due_at?.slice(11, 16) ?? "",
    tags: [],
    recurrence: null
  };
}

function manualUpdateForTaskForm(form: NewTaskForm): ManualTaskUpdate {
  const untimed = !form.earliest_start_time && !form.due_time;
  const undated = !form.earliest_start_date && !form.due_date;
  return {
    title: form.title,
    notes: form.notes || null,
    priority: form.priority,
    estimated_minutes: untimed || undated ? null : (taskRangeDurationMinutes(form) ?? form.estimated_minutes),
    earliest_start_at: form.earliest_start_date && form.earliest_start_time
      ? `${form.earliest_start_date}T${form.earliest_start_time}`
      : null,
    due_at: form.due_date && form.due_time
      ? `${form.due_date}T${form.due_time}`
      : null,
    earliest_start_date: form.earliest_start_date || null,
    due_date: form.due_date || null
  };
}

function taskFormTimingFact(form: NewTaskForm, today: string) {
  const date = form.due_date || form.earliest_start_date;
  const time = form.due_date ? form.due_time : form.earliest_start_time;
  if (!date) return null;
  const dateLabel = date === today
    ? "今天"
    : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).format(new Date(`${date}T00:00:00+08:00`));
  return `${form.due_date ? "截止" : "最早"} ${dateLabel}${time ? ` ${time}` : ""}`;
}

function taskDraftTimingFact(draft: TaskDraftInput, today: string) {
  const date = draft.due_date || draft.earliest_start_date;
  const time = draft.due_date ? draft.due_time : draft.earliest_start_time;
  if (!date) return null;
  const dateLabel = date === today
    ? "今天"
    : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).format(new Date(`${date}T00:00:00+08:00`));
  return `${draft.due_date ? "截止" : "最早"} ${dateLabel}${time ? ` ${time}` : ""}`;
}

function WorkloadTimeDigits({ minutes, emptyLabel = "待计算" }: { minutes: number | null | undefined; emptyLabel?: string }) {
  if (minutes === null || minutes === undefined) return <span className="workload-time-digits"><b className="workload-digit">{emptyLabel}</b></span>;
  if (minutes <= 0) return <span className="workload-time-digits"><b className="workload-digit">0</b><span className="workload-unit"> m</span></span>;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) {
    return <span className="workload-time-digits"><b className="workload-digit">{minutes}</b><span className="workload-unit"> m</span></span>;
  }
  if (!remainder) {
    return <span className="workload-time-digits"><b className="workload-digit">{hours}</b><span className="workload-unit"> h</span></span>;
  }
  return <span className="workload-time-digits"><b className="workload-digit">{hours}</b><span className="workload-unit"> h </span><b className="workload-digit">{remainder}</b><span className="workload-unit"> m</span></span>;
}

function ScheduleDateGrid({ cells, today, start, end, range, historySingleDay = false, minDate, onSelect, onHover }: {
  cells: ReturnType<typeof calendarCells>;
  today: string;
  start: string;
  end: string;
  range: { start: string; end: string; preview: boolean };
  historySingleDay?: boolean;
  minDate?: string;
  onSelect: (date: string) => void;
  onHover: (date: string | null) => void;
}) {
  return <div className="apple-date-grid" onPointerLeave={() => onHover(null)}>{cells.map((cell) => {
    const inRange = cell.key >= range.start && cell.key <= range.end;
    const historical = historySingleDay && cell.key < today;
    const classes = [cell.inMonth ? "" : "outside", cell.key === today ? "today" : "", inRange ? "in-range" : "", cell.key === range.start ? "range-start" : "", cell.key === range.end ? "range-end" : "", inRange && range.preview ? "is-preview" : "", cell.key === range.start || cell.key === range.end ? "selected" : ""].filter(Boolean).join(" ");
    return <button key={cell.key} type="button" className={classes} disabled={minDate ? cell.key < minDate : undefined} title={historical ? "历史日期仅支持单日，点击后将改为当天的单日任务" : undefined} aria-label={`${cell.key}${cell.key === today ? "，今天" : ""}${historical ? "，历史日期，仅支持单日" : ""}`} aria-current={cell.key === today ? "date" : undefined} aria-pressed={cell.key === start || cell.key === end} onPointerEnter={(event) => { if (event.pointerType !== "touch") onHover(cell.key); }} onFocus={() => onHover(cell.key)} onBlur={() => onHover(null)} onClick={() => onSelect(cell.key)}>{cell.day}</button>;
  })}</div>;
}

type RecurringBlockTimeEdit = { date: string; time: string; duration: number | null; error: string };

function RecurringBlockTimeEditor({ value, today, onChange }: {
  value: RecurringBlockTimeEdit; today: string; onChange: (value: RecurringBlockTimeEdit) => void;
}) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [monthKey, setMonthKey] = useState(value.date.slice(0, 7));
  const dateButtonRef = useRef<HTMLButtonElement>(null);
  const calendarRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const calendar = calendarRef.current, trigger = dateButtonRef.current;
    if (!calendarOpen || !calendar || !trigger) return;
    calendar.setAttribute("popover", "manual");
    calendar.showPopover();
    function positionCalendar() {
      const anchor = trigger!.getBoundingClientRect();
      calendar!.style.width = `${Math.min(anchor.width, window.innerWidth - 24)}px`;
      const height = calendar!.getBoundingClientRect().height;
      const below = anchor.bottom + 6;
      const top = below + height <= window.innerHeight - 12 ? below : Math.max(12, anchor.top - height - 6);
      calendar!.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - calendar!.offsetWidth - 12))}px`;
      calendar!.style.top = `${top}px`;
    }
    function dismissCalendar(event: PointerEvent) {
      if (event.target instanceof Node && !calendar!.contains(event.target) && !trigger!.contains(event.target)) setCalendarOpen(false);
    }
    positionCalendar();
    const observer = new ResizeObserver(positionCalendar);
    observer.observe(calendar);
    window.addEventListener("resize", positionCalendar);
    window.addEventListener("scroll", positionCalendar, true);
    document.addEventListener("pointerdown", dismissCalendar);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", positionCalendar);
      window.removeEventListener("scroll", positionCalendar, true);
      document.removeEventListener("pointerdown", dismissCalendar);
    };
  }, [calendarOpen]);
  const cells = useMemo(() => calendarCells(monthKey), [monthKey]);
  const [year, month] = monthKey.split("-").map(Number);
  const range = recurringClockRange({ display_time: value.time, display_duration_minutes: value.duration });
  function selectDate(date: string) {
    if (date < today) return;
    onChange({ ...value, date, error: "" });
    setCalendarOpen(false);
    dateButtonRef.current?.focus();
  }
  return <div className="recurring-block-time-editor" onKeyDown={(event) => {
    if (event.key === "Escape" && calendarOpen) { event.preventDefault(); event.stopPropagation(); setCalendarOpen(false); dateButtonRef.current?.focus(); }
  }}>
    <section className="recurring-block-date-section" aria-label="安排日期">
      <span className="recurring-block-field-label">日期</span>
      <button ref={dateButtonRef} type="button" className="recurring-block-date-trigger" aria-expanded={calendarOpen} aria-controls="recurring-block-date-calendar" onClick={() => { if (!calendarOpen) setMonthKey(value.date.slice(0, 7)); setCalendarOpen(!calendarOpen); }}><Icon name="calendar" size={16} /><strong>{pickerDateLabel(value.date)}</strong><Icon name="chevron-down" size={15} /></button>
      {calendarOpen && <section ref={calendarRef} id="recurring-block-date-calendar" className="schedule-picker-calendar recurring-block-calendar" aria-label="选择安排日期">
        <header><strong>{year}年{month}月</strong><div><button type="button" aria-label="上个月" onClick={() => setMonthKey(shiftMonthKey(monthKey, -1))}><Icon name="chevron-left" size={17} /></button><button type="button" aria-label="下个月" onClick={() => setMonthKey(shiftMonthKey(monthKey, 1))}><Icon name="chevron-right" size={17} /></button></div></header>
        <div className="apple-date-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
        <ScheduleDateGrid cells={cells} today={today} start={value.date} end={value.date} range={{ start: value.date, end: value.date, preview: false }} minDate={today} onSelect={selectDate} onHover={() => {}} />
      </section>}
    </section>
    <BlockEditorTimeRangeRail start={range.start} end={range.end} minimumDuration={1} maxMinute={24 * 60} allowMidnightEnd inputsOnly onChange={(next) => { const input = recurringRangeInput(next); onChange({ ...value, time: input.display_time, duration: input.display_duration_minutes, error: "" }); }} />
  </div>;
}

function TaskScheduleEditor({ form, disabled, compact = false, estimateId, allowExistingHistoricalRange = false, onChange, onScheduleChange }: {
  form: NewTaskForm;
  disabled: boolean;
  compact?: boolean;
  estimateId?: string;
  allowExistingHistoricalRange?: boolean;
  onChange: (form: NewTaskForm) => void;
  onScheduleChange?: (form: NewTaskForm) => void;
}) {
  const [openPicker, setOpenPicker] = useState<TaskSchedulePicker | null>(null);
  const [openWheelField, setOpenWheelField] = useState<TaskSchedulePicker["activeField"] | null>(null);
  const [pickerTimeInputs, setPickerTimeInputs] = useState({ start: "", end: "" });
  const [pickerHoverDate, setPickerHoverDate] = useState<string | null>(null);
  const [monthKey, setMonthKey] = useState(form.earliest_start_date.slice(0, 7) || shanghaiDateValue().slice(0, 7));
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const startWheelAnchorRef = useRef<HTMLDivElement>(null);
  const endWheelAnchorRef = useRef<HTMLDivElement>(null);
  const pickerOriginalRef = useRef<Omit<TaskSchedulePicker, "activeField" | "dateAnchor"> | null>(null);
  const lastTimedRangeRef = useRef<{ start: string; end: string } | null>(null);
  const lastCrossDayDailyRef = useRef<number | null>(null);
  const cells = useMemo(() => calendarCells(monthKey), [monthKey]);
  const [todayDate, setTodayDate] = useState(shanghaiDateValue);
  const sameDay = Boolean(form.earliest_start_date
    && form.due_date
    && form.earliest_start_date === form.due_date);
  const sameDayMinutes = taskRangeDurationMinutes(form);
  const dayCount = taskDateSpanDays(form);
  const crossDay = isCrossDayTask(form) && dayCount !== null && dayCount > 1;
  const hasAnyDate = Boolean(form.earliest_start_date || form.due_date);
  const isUntimed = hasAnyDate && !form.earliest_start_time && !form.due_time;
  const crossDayTimed = crossDay && !isUntimed;
  const dailyMinutes = crossDayTimed ? inferredDailyWorkloadMinutes(form.estimated_minutes, form) : null;
  const maximumDailyMinutes = dayCount ? Math.min(24 * 60, Math.floor(MAX_TASK_WORKLOAD_MINUTES / dayCount)) : 24 * 60;
  const dailyWorkloadInvalid = crossDayTimed && form.estimated_minutes !== null && !taskWorkloadIsValid(form);
  if (crossDayTimed && dailyMinutes !== null && dailyMinutes >= MIN_TASK_WORKLOAD_MINUTES && dailyMinutes <= maximumDailyMinutes) {
    lastCrossDayDailyRef.current = dailyMinutes;
  }

  const handleScheduleChange = onScheduleChange ?? onChange;

  function updateDailyWorkload(rawValue: string) {
    if (!rawValue) {
      lastCrossDayDailyRef.current = null;
      onChange({ ...form, estimated_minutes: null });
      return;
    }
    const daily = Number(rawValue);
    onChange({ ...form, estimated_minutes: dayCount ? daily * dayCount : null });
  }

  useEffect(() => {
    if (!openPicker) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const unlockBackground = typeof HTMLElement !== "undefined" && dialog ? lockBackgroundElements(dialog) : () => {};
    const focusableControls = () => dialog && typeof dialog.querySelectorAll === "function"
      ? Array.from(dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])"))
        .filter((node) => typeof node.getClientRects !== "function" || node.getClientRects().length > 0)
      : [];
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });
    const containFocus = (event: FocusEvent) => {
      if (dialog && typeof dialog.contains === "function" && !dialog.contains(event.target as Node)) {
        (focusableControls()[0] ?? dialog).focus();
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      const target = typeof Element !== "undefined" && event.target instanceof Element ? event.target : null;
      if (event.key === "Tab" && !event.defaultPrevented && dialog) {
        const controls = focusableControls();
        if (!controls.length) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        event.preventDefault();
        const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
        const nextIndex = event.shiftKey
          ? (currentIndex <= 0 ? controls.length - 1 : currentIndex - 1)
          : (currentIndex + 1) % controls.length;
        (controls[nextIndex] ?? dialog).focus();
        return;
      }
      if (event.key !== "Escape" || event.defaultPrevented || target?.closest(".schedule-time-control")) return;
      event.preventDefault();
      closeSchedulePicker();
    };
    const hasDocumentListeners = typeof document.addEventListener === "function";
    if (hasDocumentListeners) document.addEventListener("focusin", containFocus);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      if (hasDocumentListeners) document.removeEventListener("focusin", containFocus);
      window.removeEventListener("keydown", closeOnEscape);
      unlockBackground();
      document.body.style.overflow = previousOverflow;
    };
  }, [openPicker !== null]);

  function closeSchedulePicker() {
    const trigger = triggerRef.current;
    setOpenWheelField(null);
    setPickerHoverDate(null);
    setOpenPicker(null);
    window.requestAnimationFrame(() => trigger?.focus());
  }

  function openSchedulePicker(field: TaskSchedulePicker["activeField"], preferTimed?: boolean) {
    setTodayDate(shanghaiDateValue());
    setOpenWheelField(null);
    setPickerHoverDate(null);
    const defaults = newTaskDefaultForm();
    const startDate = form.earliest_start_date || form.due_date || defaults.earliest_start_date;
    const endDate = form.due_date || startDate;
    const hasAnyScheduleDate = Boolean(form.earliest_start_date || form.due_date);
    const hasTimes = Boolean(form.earliest_start_time || form.due_time);
    const nextPicker: TaskSchedulePicker = {
      activeField: field,
      dateAnchor: startDate === endDate ? null : field === "start" ? endDate : startDate,
      earliest_start_date: startDate,
      earliest_start_time: form.earliest_start_time || defaults.earliest_start_time,
      due_date: endDate,
      due_time: form.due_time || defaults.due_time,
      timed: preferTimed ?? (hasTimes || !hasAnyScheduleDate)
    };
    const activeDate = nextPicker.activeField === "start" ? nextPicker.earliest_start_date : nextPicker.due_date;
    triggerRef.current = document.activeElement as HTMLElement | null;
    setMonthKey(activeDate.slice(0, 7));
    setPickerTimeInputs({ start: nextPicker.earliest_start_time, end: nextPicker.due_time });
    pickerOriginalRef.current = {
      earliest_start_date: nextPicker.earliest_start_date,
      earliest_start_time: nextPicker.earliest_start_time,
      due_date: nextPicker.due_date,
      due_time: nextPicker.due_time,
      timed: nextPicker.timed,
    };
    setOpenPicker(nextPicker);
  }

  function selectPickerField(field: TaskSchedulePicker["activeField"], revealDate = false) {
    if (!openPicker) return;
    const activeDate = field === "start" ? openPicker.earliest_start_date : openPicker.due_date;
    if (revealDate) {
      setPickerHoverDate(null);
      setMonthKey(activeDate.slice(0, 7));
    }
    setOpenPicker((current) => current ? {
      ...current,
      activeField: field,
      dateAnchor: revealDate ? (field === "start" ? current.due_date : current.earliest_start_date) : current.dateAnchor
    } : current);
  }

  function updatePickerDate(date: string) {
    setTodayDate(shanghaiDateValue());
    setPickerHoverDate(null);
    if (!openPicker) return;
    setOpenPicker((current) => {
      if (!current) return current;
      const next = selectTaskDateBoundary(current.dateAnchor, date, shanghaiDateValue());
      return {
        ...current,
        earliest_start_date: next.start,
        due_date: next.end,
        dateAnchor: next.dateAnchor
      };
    });
    if (date.slice(0, 7) !== monthKey) setMonthKey(date.slice(0, 7));
  }

  function pickerCalendarRange(picker: TaskSchedulePicker) {
    const today = shanghaiDateValue();
    if (picker.dateAnchor && picker.dateAnchor >= today && pickerHoverDate && pickerHoverDate >= today) {
      return { ...selectTaskDateBoundary(picker.dateAnchor, pickerHoverDate, today), preview: true };
    }
    return { start: picker.earliest_start_date, end: picker.due_date, preview: false };
  }

  function shiftPickerMonth(offset: number) {
    setPickerHoverDate(null);
    setMonthKey(shiftMonthKey(monthKey, offset));
  }

  function updatePickerRange(next: { start: string; end: string }) {
    setPickerTimeInputs(next);
    setOpenPicker((current) => current ? {
      ...current,
      earliest_start_time: next.start,
      due_time: next.end
    } : current);
  }

  function updatePickerTimeInput(field: TaskSchedulePicker["activeField"], value: string) {
    const sanitized = sanitizeTimeInput(value);
    setPickerTimeInputs((current) => ({ ...current, [field]: sanitized }));
    const normalized = normalizeClockInput(sanitized);
    if (!validDraftClock(normalized)) return;
    setOpenPicker((current) => current ? {
      ...current,
      activeField: field,
      [field === "start" ? "earliest_start_time" : "due_time"]: normalized
    } : current);
  }

  function commitPickerTimeInput(field: TaskSchedulePicker["activeField"], value: string) {
    const sanitized = sanitizeTimeInput(value);
    const normalized = normalizeClockInput(sanitized);
    if (!validDraftClock(normalized)) return;
    setPickerTimeInputs((current) => ({ ...current, [field]: normalized }));
    setOpenPicker((current) => current ? {
      ...current,
      [field === "start" ? "earliest_start_time" : "due_time"]: normalized
    } : current);
  }

  function handlePickerTimeKeyDown(event: KeyboardEvent<HTMLInputElement>, field: TaskSchedulePicker["activeField"]) {
    if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      selectPickerField(field, false);
      setOpenWheelField(field);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commitPickerTimeInput(field, event.currentTarget.value);
      event.currentTarget.select();
      return;
    }
    if (event.key !== "Escape" || !openPicker) return;
    event.preventDefault();
    event.stopPropagation();
    const savedValue = field === "start" ? openPicker.earliest_start_time : openPicker.due_time;
    setPickerTimeInputs((current) => ({ ...current, [field]: savedValue }));
    event.currentTarget.blur();
  }

  function applyPickerWheelTime(field: TaskSchedulePicker["activeField"], nextClock: string) {
    if (!openPicker) return;
    const normalizedStart = normalizeClockInput(pickerTimeInputs.start);
    const normalizedEnd = normalizeClockInput(pickerTimeInputs.end);
    const currentRange = {
      start: validDraftClock(normalizedStart) ? normalizedStart : openPicker.earliest_start_time,
      end: validDraftClock(normalizedEnd) ? normalizedEnd : openPicker.due_time
    };
    const next = applyTimeWheelSelection(field, nextClock, currentRange, {
      independent: pickerSpanDays !== 1,
      minimumDuration: MIN_TASK_WORKLOAD_MINUTES,
      maximumMinute: 23 * 60 + 59
    });
    updatePickerRange(next);
    selectPickerField(field, false);
  }

  function projectPickerForm(picker: TaskSchedulePicker) {
    const timed = picker.timed !== false;
    return {
      ...form,
      earliest_start_date: picker.earliest_start_date,
      earliest_start_time: timed ? picker.earliest_start_time : "",
      due_date: picker.due_date,
      due_time: timed ? picker.due_time : ""
    };
  }

  function confirmSchedulePicker() {
    if (!openPicker) return;
    setTodayDate(shanghaiDateValue());
    if (openPicker.timed === false) {
      const projected = {
        ...projectPickerForm(openPicker),
        earliest_start_time: "",
        due_time: "",
        estimated_minutes: null
      };
      if (!pickerHistoryRangeAllowed(projected)) return;
      lastTimedRangeRef.current = form.earliest_start_time && form.due_time
        ? { start: form.earliest_start_time, end: form.due_time }
        : lastTimedRangeRef.current;
      if (crossDayTimed && dailyMinutes !== null && dailyMinutes >= MIN_TASK_WORKLOAD_MINUTES && dailyMinutes <= maximumDailyMinutes) {
        lastCrossDayDailyRef.current = dailyMinutes;
      }
      handleScheduleChange(projected);
      closeSchedulePicker();
      return;
    }
    const startTime = normalizeClockInput(pickerTimeInputs.start);
    const endTime = normalizeClockInput(pickerTimeInputs.end);
    if (!validDraftClock(startTime) || !validDraftClock(endTime)) return;
    const projected = { ...projectPickerForm(openPicker), earliest_start_time: startTime, due_time: endTime };
    if (projected.estimated_minutes === null && isCrossDayTask(projected) && lastCrossDayDailyRef.current !== null) {
      const spanDays = taskDateSpanDays(projected);
      if (spanDays && spanDays > 1) {
        projected.estimated_minutes = totalWorkloadForDaily(lastCrossDayDailyRef.current, spanDays);
      }
    }
    if (!pickerHistoryRangeAllowed(projected)) return;
    if (!taskRangeIsValid(projected)) return;
    handleScheduleChange(projected);
    closeSchedulePicker();
  }

  function clearSchedulePicker() {
    lastCrossDayDailyRef.current = null;
    handleScheduleChange({
      ...form,
      earliest_start_date: "",
      earliest_start_time: "",
      due_date: "",
      due_time: "",
      estimated_minutes: null
    });
    closeSchedulePicker();
  }

  function resetSchedulePicker() {
    const original = pickerOriginalRef.current;
    if (!original || !openPicker) return;
    setOpenWheelField(null);
    setPickerHoverDate(null);
    setOpenPicker({
      ...openPicker,
      dateAnchor: null,
      earliest_start_date: original.earliest_start_date,
      earliest_start_time: original.earliest_start_time,
      due_date: original.due_date,
      due_time: original.due_time,
      timed: original.timed,
    });
    setPickerTimeInputs({ start: original.earliest_start_time, end: original.due_time });
    setMonthKey((openPicker.activeField === "start" ? original.earliest_start_date : original.due_date).slice(0, 7));
  }

  const pickerTimeChanged = openPicker && pickerOriginalRef.current
    && (openPicker.earliest_start_date !== pickerOriginalRef.current.earliest_start_date
      || openPicker.earliest_start_time !== pickerOriginalRef.current.earliest_start_time
      || openPicker.due_date !== pickerOriginalRef.current.due_date
      || openPicker.due_time !== pickerOriginalRef.current.due_time
      || openPicker.timed !== pickerOriginalRef.current.timed);

  const rows: { field: TaskSchedulePicker["activeField"]; label: string; date: string; time: string }[] = [
    { field: "start", label: "开始", date: form.earliest_start_date, time: form.earliest_start_time },
    { field: "end", label: "结束", date: form.due_date, time: form.due_time }
  ];
  function pickerHistoryRangeAllowed(projected: NewTaskForm) {
    const today = shanghaiDateValue();
    const includesHistory = taskDateRangeIncludesHistory(projected.earliest_start_date, projected.due_date, today);
    return !includesHistory
      || (allowExistingHistoricalRange && form.earliest_start_date !== form.due_date
        && projected.earliest_start_date === form.earliest_start_date && projected.due_date === form.due_date);
  }
  const projectedForm = openPicker ? projectPickerForm(openPicker) : form;
  const pickerTimed = openPicker?.timed !== false;
  const pickerTimeInputsValid = !pickerTimed || (validDraftClock(normalizeClockInput(pickerTimeInputs.start))
    && validDraftClock(normalizeClockInput(pickerTimeInputs.end)));
  const pickerSpanDays = openPicker ? taskDateSpanDays(projectedForm) : null;
  const pickerError = !pickerTimeInputsValid
    ? "请输入有效时间（00:00–23:59）"
    : !taskRangeIsValid(projectedForm)
      ? pickerSpanDays === 2
        ? `跨两日任务的可用时段每天均不足 ${MIN_TASK_WORKLOAD_MINUTES} 分钟，请延长时间范围或改用不限时刻`
        : `结束时间必须比开始时间至少晚 ${MIN_TASK_WORKLOAD_MINUTES} 分钟`
      : !pickerHistoryRangeAllowed(projectedForm)
        ? "多日任务的开始日期不能早于今天；历史事项请补录为单日任务。"
        : "";
  const pickerRangeValid = pickerError === "";
  const pickerEndMinuteOffset = pickerSpanDays ? (pickerSpanDays - 1) * 24 * 60 : 0;
  const pickerDurationMinutes = openPicker && pickerTimed && pickerSpanDays
    ? pickerEndMinuteOffset + clockMinutes(openPicker.due_time) - clockMinutes(openPicker.earliest_start_time)
    : null;
  const pickerDurationLabel = !pickerTimed
    ? "不限时刻"
    : pickerDurationMinutes !== null && pickerDurationMinutes > 0
      ? formatWorkloadMinutes(pickerDurationMinutes)
      : "待调整";
  const [calendarYear, calendarMonth] = monthKey.split("-").map(Number);

  function renderBoundaryCard(field: TaskSchedulePicker["activeField"], label: string, date: string) {
    const active = openPicker?.activeField === field;
    const inputValue = pickerTimeInputs[field];
    const inputValid = validDraftClock(normalizeClockInput(inputValue));
    return <section className={`apple-schedule-row schedule-boundary-row ${field}${active ? " is-active" : ""}`} aria-label={`${label}时间`} onClick={() => selectPickerField(field, true)}>
      <span className="apple-schedule-label">{label}日期</span>
      <div className="apple-schedule-values">
        <button type="button" className={active ? "is-active" : ""} aria-label={`选择${label}日期`} aria-pressed={active} onClick={(e) => { e.stopPropagation(); selectPickerField(field, true); }}><Icon name="calendar" size={14} />{pickerDateLabel(date)}</button>
      </div>
      {(openPicker?.timed !== false) && <div className="schedule-time-control selection-time-box" ref={field === "start" ? startWheelAnchorRef : endWheelAnchorRef} onClick={(event) => event.stopPropagation()}>
        <small aria-hidden="true">{label}</small>
        <input type="text" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={5} disabled={disabled} value={inputValue} aria-label={`输入${label}时间`} aria-describedby="schedule-picker-time-input-help" aria-invalid={!inputValid} onFocus={(event) => { selectPickerField(field); event.currentTarget.select(); }} onClick={() => { selectPickerField(field, false); setOpenWheelField(field); }} onChange={(event) => updatePickerTimeInput(field, event.target.value)} onKeyDown={(event) => handlePickerTimeKeyDown(event, field)} onBlur={(event) => commitPickerTimeInput(field, event.currentTarget.value)} />
        <TimeWheelTrigger active={openWheelField === field} disabled={disabled} label={`打开${label}时间滚轴`} controlsId="schedule-picker-time-wheel" onToggle={() => { selectPickerField(field, false); setOpenWheelField((current) => current === field ? null : field); }} />
      </div>}
    </section>;
  }

  function toggleUntimed() {
    setOpenPicker(null);
    if (isUntimed) {
      const defaults = newTaskDefaultForm();
      const restored = lastTimedRangeRef.current;
      const restoredCrossDayMinutes = crossDay && form.estimated_minutes === null && lastCrossDayDailyRef.current !== null && dayCount
        ? totalWorkloadForDaily(lastCrossDayDailyRef.current, dayCount)
        : form.estimated_minutes;
      handleScheduleChange({
        ...form,
        earliest_start_time: restored?.start || defaults.earliest_start_time,
        due_time: restored?.end || defaults.due_time,
        ...(crossDay ? { estimated_minutes: restoredCrossDayMinutes } : {})
      });
      return;
    }
    if (form.earliest_start_time && form.due_time) {
      lastTimedRangeRef.current = { start: form.earliest_start_time, end: form.due_time };
    }
    if (crossDayTimed && dailyMinutes !== null && dailyMinutes >= MIN_TASK_WORKLOAD_MINUTES && dailyMinutes <= maximumDailyMinutes) {
      lastCrossDayDailyRef.current = dailyMinutes;
    }
    handleScheduleChange({
      ...form,
      earliest_start_time: "",
      due_time: "",
      estimated_minutes: null
    });
  }

  return <>
  <div className="apple-schedule-editor" role="group" aria-label="任务时间范围">
      <header className={compact ? "apple-schedule-toolbar" : undefined}>
        {compact && <span className="apple-schedule-compact-title">安排与时限</span>}
        <div className="apple-schedule-header-actions">
          {isUntimed ? <output className="apple-schedule-workload is-untimed" aria-live="polite"><i className="apple-schedule-workload-icon" aria-hidden="true"><Icon name="clock" size={15} /></i><span>安排</span><strong>不限时刻</strong></output> : sameDay ? <output className="apple-schedule-workload" aria-live="polite"><i className="apple-schedule-workload-icon" aria-hidden="true"><Icon name="clock" size={15} /></i><span>预估</span><strong>{sameDayMinutes === null ? "待计算" : <WorkloadTimeDigits minutes={sameDayMinutes} />}</strong>{sameDayMinutes === null && <small>补全有效时间</small>}</output> : crossDay ? <output className="apple-schedule-workload" aria-live="polite"><i className="apple-schedule-workload-icon" aria-hidden="true"><Icon name="clock" size={15} /></i><span>预估总投入</span><strong><WorkloadTimeDigits minutes={form.estimated_minutes} emptyLabel="待填写" /></strong>{dailyMinutes !== null && form.estimated_minutes !== null ? <small>共 {dayCount} 天</small> : form.estimated_minutes !== null ? <small>原总投入已保留</small> : <small>必填</small>}</output> : !compact ? <div><strong>时间范围</strong><span>开始和结束日期必填，具体时刻可选；未选日期时只保存为草稿。</span></div> : null}
          <div className="apple-schedule-toolbar-buttons">
            {hasAnyDate ? <>
              <button type="button" className={`apple-schedule-untimed-btn${isUntimed ? " is-active" : ""}`} aria-pressed={isUntimed} title={isUntimed ? "点击取消不限时刻，恢复具体时刻" : "切换为不限时刻（仅保留日期）"} disabled={disabled} onClick={toggleUntimed}>{isUntimed && <Icon name="check" size={12} />}不限时刻</button>
              <button type="button" className="apple-schedule-clear-btn" disabled={disabled} onClick={() => { lastCrossDayDailyRef.current = null; handleScheduleChange({ ...form, earliest_start_date: "", earliest_start_time: "", due_date: "", due_time: "", estimated_minutes: null }); setOpenPicker(null); }}>清除时间</button>
            </> : <button type="button" className="apple-schedule-restore-btn" disabled={disabled} onClick={() => { const defaults = newTaskDefaultForm(); handleScheduleChange({ ...form, earliest_start_date: defaults.earliest_start_date, earliest_start_time: defaults.earliest_start_time, due_date: defaults.due_date, due_time: defaults.due_time }); }}>恢复推荐</button>}
          </div>
        </div>
      </header>
    <div className="apple-schedule-rows">
    {!crossDay && <div className="apple-schedule-row"><span className="apple-schedule-label">日期</span><div className="apple-schedule-values"><button type="button" disabled={disabled} aria-label="选择任务日期" aria-haspopup="dialog" aria-expanded={Boolean(openPicker)} onClick={() => openSchedulePicker("start")}><Icon name="calendar" size={14} />{pickerDateLabel(form.earliest_start_date || form.due_date)}</button></div></div>}
    {rows.map((row) => <div className="apple-schedule-row" key={row.field}>
      <span className="apple-schedule-label">{row.label}</span>
      <div className="apple-schedule-values">{crossDay && <button type="button" className={openPicker?.activeField === row.field ? "is-active" : ""} disabled={disabled} aria-haspopup="dialog" aria-expanded={openPicker?.activeField === row.field} onClick={() => openSchedulePicker(row.field)}><Icon name="calendar" size={14} />{pickerDateLabel(row.date)}</button>}<button type="button" className={`${openPicker?.activeField === row.field ? "is-active " : ""}${!row.time && hasAnyDate ? "is-untimed" : ""}`.trim()} disabled={disabled} aria-haspopup="dialog" aria-expanded={openPicker?.activeField === row.field} onClick={() => openSchedulePicker(row.field, true)}><Icon name="clock" size={14} />{row.time || (hasAnyDate ? "不限时刻" : "选择时间")}</button></div>
    </div>)}
    {crossDayTimed && (
      <div className="apple-schedule-row apple-schedule-daily-workload-row">
        <span className="apple-schedule-label">平均每日投入</span>
        <div className="apple-schedule-values apple-schedule-workload-values">
          <label htmlFor={estimateId ?? "task-estimate"} className="apple-schedule-workload-control">
            <input
              id={estimateId ?? "task-estimate"}
              type="number"
              min={MIN_TASK_WORKLOAD_MINUTES}
              max={maximumDailyMinutes}
              step={5}
              required
              disabled={disabled}
              value={dailyMinutes ?? ""}
              placeholder="例如 60（至少 15）"
              onChange={(event) => updateDailyWorkload(event.target.value)}
            />
            <span className="apple-schedule-workload-unit">分钟 / 天</span>
          </label>
        </div>
      </div>
    )}
    </div>
    {!taskRangeIsValid(form) && <p className="apple-schedule-error" role="alert">{dayCount === 2 ? `跨两日任务的可用时段每天均不足 ${MIN_TASK_WORKLOAD_MINUTES} 分钟，请延长时间范围或改用不限时刻。` : `结束时间必须比开始时间至少晚 ${MIN_TASK_WORKLOAD_MINUTES} 分钟，请重新选择。`}</p>}
    {crossDayTimed && dailyWorkloadInvalid && <p className="apple-schedule-error workload-field-error" role="alert">平均每天至少投入 {MIN_TASK_WORKLOAD_MINUTES} 分钟。</p>}
  </div>
  {openPicker && createPortal(
    <div className="schedule-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSchedulePicker(); }}>
      <div className="schedule-picker-dialog manual-time-picker" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="schedule-picker-title" tabIndex={-1}>
        <header className="schedule-picker-header">
          <div><h2 id="schedule-picker-title">时间范围</h2><p>点选一天，或连续点选两个日期；较早的日期自动作为开始日。</p></div>
          <div className="schedule-picker-header-actions">{pickerTimeChanged && <button type="button" className="schedule-picker-reset" onClick={resetSchedulePicker}>重置时间</button>}<button type="button" className="schedule-picker-clear" onClick={clearSchedulePicker}>清除时间</button><button type="button" className="schedule-picker-close" aria-label="关闭时间范围" onClick={closeSchedulePicker}><Icon name="close" size={18} /></button></div>
        </header>
        <div className="schedule-picker-body">
          <section className="schedule-picker-calendar" aria-label="选择日期">
            <header><strong>{calendarYear}年{calendarMonth}月</strong><div><button type="button" aria-label="上个月" onClick={() => shiftPickerMonth(-1)}><Icon name="chevron-left" size={17} /></button><button type="button" aria-label="下个月" onClick={() => shiftPickerMonth(1)}><Icon name="chevron-right" size={17} /></button></div></header>
            <div className="apple-date-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
            <ScheduleDateGrid cells={cells} today={todayDate} start={openPicker.earliest_start_date} end={openPicker.due_date} range={pickerCalendarRange(openPicker)} historySingleDay onSelect={updatePickerDate} onHover={setPickerHoverDate} />
            <footer aria-live="polite">
              <strong>{openPicker.earliest_start_date === openPicker.due_date ? openPicker.earliest_start_date < todayDate ? "已选历史日期，仅支持单日" : openPicker.dateAnchor && openPicker.dateAnchor >= todayDate ? "已选单日，可再选一天组成多日范围" : "已选单日，点击日期可重新选择" : openPicker.dateAnchor && openPicker.dateAnchor >= todayDate ? "已选多日，点击新日期后自动排序" : "已选多日，点击日期可重新选择"}</strong>
            </footer>
          </section>
          <section className="schedule-picker-range-panel" aria-label="调整时间范围">
            <header>
              <div><strong>调整时间范围</strong><span>{pickerSpanDays && pickerSpanDays > 1 && pickerTimed ? `跨 ${pickerSpanDays} 天` : pickerDurationLabel}</span></div>
              <div className="schedule-picker-time-mode" role="group" aria-label="时刻设置方式">
                <button type="button" className={pickerTimed ? "is-active" : ""} aria-pressed={pickerTimed} onClick={() => setOpenPicker((current) => current ? { ...current, timed: true } : current)}>指定时刻</button>
                <button type="button" className={!pickerTimed ? "is-active" : ""} aria-pressed={!pickerTimed} onClick={() => { setOpenWheelField(null); setOpenPicker((current) => current ? { ...current, timed: false } : current); }}>不限时刻</button>
              </div>
            </header>
            <div className="schedule-picker-boundaries schedule-picker-rows apple-schedule-rows">
              {renderBoundaryCard("start", "开始", openPicker.earliest_start_date)}
              {renderBoundaryCard("end", "结束", openPicker.due_date)}
              <span id="schedule-picker-time-input-help" className="sr-only">可输入 9、930 或 09:30，精确到 1 分钟。</span>
            </div>
            {pickerTimed ? <>
              <TimeWheelPopover
                id="schedule-picker-time-wheel"
                open={openWheelField !== null}
                edge={openWheelField ?? "start"}
                value={openWheelField === "end" ? pickerTimeInputs.end : pickerTimeInputs.start}
                fallbackValue={openWheelField === "end" ? openPicker.due_time : openPicker.earliest_start_time}
                anchorRef={openWheelField === "end" ? endWheelAnchorRef : startWheelAnchorRef}
                onSelect={(nextClock) => { if (openWheelField) applyPickerWheelTime(openWheelField, nextClock); }}
                onClose={() => setOpenWheelField(null)}
              />
              {pickerSpanDays === null ? <p className="schedule-picker-range-error" role="alert">结束日期不能早于开始日期，请先在左侧调整日期。</p> : <BlockEditorTimeRangeRail
                start={openPicker.earliest_start_time}
                end={openPicker.due_time}
                startMinuteOffset={0}
                endMinuteOffset={pickerEndMinuteOffset}
                maxMinute={pickerEndMinuteOffset + 23 * 60 + 59}
                minimumDuration={MIN_TASK_WORKLOAD_MINUTES}
                disabled={disabled}
                presetsOnly
                showPresets={pickerSpanDays === 1}
                onChange={updatePickerRange}
              />}
            </> : <UntimedScheduleNote />}
          </section>
        </div>
        <footer className="schedule-picker-footer">
          {pickerError ? <p className="schedule-picker-footer-error" role="alert">{pickerError}</p> : <output className="schedule-picker-summary"><i aria-hidden="true" className="apple-schedule-workload-icon"><Icon name="clock" size={15} /></i><span>已选 <strong>{pickerTimed ? `${pickerDateLabel(openPicker.earliest_start_date)} ${openPicker.earliest_start_time} — ${pickerDateLabel(openPicker.due_date)} ${openPicker.due_time}` : openPicker.earliest_start_date === openPicker.due_date ? `${pickerDateLabel(openPicker.earliest_start_date)} · 不限时刻` : `${pickerDateLabel(openPicker.earliest_start_date)} — ${pickerDateLabel(openPicker.due_date)} · 不限时刻`}</strong>{pickerDurationMinutes !== null && pickerDurationMinutes > 0 ? <><CopySeparator />预估 <strong><WorkloadTimeDigits minutes={pickerDurationMinutes} /></strong></> : ""}</span></output>}
          <div><button type="button" className="secondary-action" onClick={closeSchedulePicker}>取消</button><button type="button" className="schedule-picker-confirm" disabled={!pickerRangeValid} onClick={confirmSchedulePicker}>确认安排</button></div>
        </footer>
      </div>
    </div>, document.body)}
  </>;
}

function TaskNotesInputs({ id, value, disabled = false, maxLength, icons = false, onChange }: {
  id: string;
  value: string;
  disabled?: boolean;
  maxLength?: number;
  icons?: boolean;
  onChange: (value: string) => void;
}) {
  const { url, body } = splitTaskNotes(value);
  const urlPrefixLength = url ? 5 + (body ? 2 : 0) : 0;
  return <div className={`task-notes-inputs${icons ? " has-field-icons" : ""}`}>
    <label htmlFor={`${id}-url`} className="task-notes-label sr-only">链接</label>
    {icons && <Icon name="external-link" size={14} />}
    <input id={`${id}-url`} type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={disabled} value={url} maxLength={maxLength === undefined ? undefined : Math.max(0, maxLength - body.length - 7)} placeholder="粘贴网址（选填）" onChange={(event) => onChange(joinTaskNotes(event.target.value, body))} />
    <span className="task-notes-divider" aria-hidden="true" />
    <label htmlFor={id} className="task-notes-label sr-only">备注</label>
    {icons && <Icon name="file" size={14} />}
    <textarea id={id} rows={3} disabled={disabled} value={body} maxLength={maxLength === undefined ? undefined : Math.max(0, maxLength - url.length - urlPrefixLength)} placeholder="添加说明或补充信息（选填）" onChange={(event) => onChange(joinTaskNotes(url, event.target.value))} />
  </div>;
}

function TaskEditorRegions({
  form,
  disabled,
  idPrefix,
  autoFocusTitle = false,
  compact = false,
  availableTags = [],
  allowExistingHistoricalRange = false,
  onChange,
  onScheduleChange
}: {
  form: NewTaskForm;
  disabled: boolean;
  idPrefix: string;
  autoFocusTitle?: boolean;
  compact?: boolean;
  availableTags?: string[];
  allowExistingHistoricalRange?: boolean;
  onChange: (form: NewTaskForm) => void;
  onScheduleChange: (form: NewTaskForm) => void;
}) {
  const contentTitleId = `${idPrefix}-content-region-title`;
  const attributesTitleId = `${idPrefix}-attributes-region-title`;
  const titleId = `${idPrefix}-title`;
  const notesId = `${idPrefix}-notes`;
  const priorityId = `${idPrefix}-priority`;
  const estimateId = `${idPrefix}-estimate`;
  const notesField = <TaskNotesInputs id={notesId} value={form.notes} disabled={disabled} icons onChange={(notes) => onChange({ ...form, notes })} />;

  return <>
    <section className="task-form-region task-content-region" aria-labelledby={contentTitleId}>
      <header><div className="task-region-title-row"><strong id={contentTitleId}>任务内容</strong></div></header>
      <div className="task-content-fields">
        <div className="task-title-heading-row">
          <label htmlFor={titleId} className="sr-only">标题</label>
          <input id={titleId} className="task-title-input" autoFocus={autoFocusTitle} disabled={disabled} value={form.title} maxLength={300} required placeholder="标题" onChange={(event) => onChange({ ...form, title: event.target.value })} />
          <div className="task-title-controls">
            <TaskPrioritySelector id={priorityId} value={form.priority} disabled={disabled} onChange={(priority) => onChange({ ...form, priority })} />
            <TaskTagEditor id={`${idPrefix}-tags`} tags={form.tags} dropdown suggestions={availableTags} disabled={disabled} onChange={(tags) => onChange({ ...form, tags })} />
          </div>
        </div>
      </div>
    </section>
    <section className="task-form-region task-planning-section" aria-labelledby={attributesTitleId}>
      <header><div className="task-region-title-row"><strong id={attributesTitleId}>安排与时限</strong></div></header>
      <TaskScheduleEditor
        form={form}
        disabled={disabled}
        compact={compact}
        estimateId={estimateId}
        allowExistingHistoricalRange={allowExistingHistoricalRange}
        onChange={onChange}
        onScheduleChange={onScheduleChange}
      />
    </section>
    <section className="task-form-region task-notes-region" aria-label="备注"><div className="task-content-fields">{notesField}</div></section>
  </>;
}

function isoWeekParts(dateKey: string) {
  const thursday = new Date(`${dateKey}T00:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const year = thursday.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  return { year, week: Math.ceil(((thursday.getTime() - yearStart) / 86_400_000 + 1) / 7) };
}

function RecurringValidityPicker({ startsOn, endsOn, displayTime = "", displayDurationMinutes = null, initialField = "start", todayDate, previewForm, onConfirm, onClose }: {
  startsOn: string;
  endsOn: string;
  displayTime?: string;
  displayDurationMinutes?: number | null;
  initialField?: "start" | "end" | "time" | "duration";
  todayDate: string;
  previewForm: RecurringItemForm;
  onConfirm: (startsOn: string, endsOn: string, displayTime: string, displayDurationMinutes: number | null) => void;
  onClose: () => void;
}) {
  const [activeField, setActiveField] = useState<TimeRangeEdge>(initialField === "end" || initialField === "duration" ? "end" : "start");
  const [openWheelField, setOpenWheelField] = useState<TimeRangeEdge | null>(null);
  const [dates, setDates] = useState(() => ({ start: startsOn || todayDate, end: endsOn || "", dateAnchor: endsOn && endsOn !== startsOn ? initialField === "end" || initialField === "duration" ? startsOn || todayDate : endsOn : null }));
  const draftStartsOn = dates.start;
  const draftEndsOn = dates.end;
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [monthKey, setMonthKey] = useState(() => ((initialField === "end" && endsOn) || startsOn || todayDate).slice(0, 7));
  const [timed, setTimed] = useState(() => Boolean(displayTime?.trim()) || initialField === "time" || initialField === "duration");
  const [timeInputs, setTimeInputs] = useState(() => displayTime ? recurringClockRange({ display_time: displayTime, display_duration_minutes: displayDurationMinutes }) : { start: "09:00", end: "10:00" });
  const [railRange, setRailRange] = useState(() => displayTime && !recurringTimeBlockIssue({ display_time: displayTime, display_duration_minutes: displayDurationMinutes }) ? recurringClockRange({ display_time: displayTime, display_duration_minutes: displayDurationMinutes }) : { start: "09:00", end: "10:00" });
  const dialogRef = useRef<HTMLDivElement>(null);
  const timeInputRef = useRef<HTMLInputElement>(null);
  const endTimeInputRef = useRef<HTMLInputElement>(null);
  const startWheelAnchorRef = useRef<HTMLDivElement>(null);
  const endWheelAnchorRef = useRef<HTMLDivElement>(null);
  const cancelledTimeBlurRef = useRef<TimeRangeEdge | null>(null);
  const triggerRef = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const unlockBackground = typeof HTMLElement !== "undefined" && dialog ? lockBackgroundElements(dialog) : () => {};
    const focusableControls = () => dialog && typeof dialog.querySelectorAll === "function"
      ? Array.from(dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])"))
        .filter((node) => typeof node.getClientRects !== "function" || node.getClientRects().length > 0)
      : [];
    const frame = window.requestAnimationFrame(() => {
      const input = initialField === "time" ? timeInputRef.current : initialField === "duration" ? endTimeInputRef.current : null;
      if (input) { input.focus(); input.select(); } else dialogRef.current?.focus();
    });
    const containFocus = (event: FocusEvent) => {
      if (dialog && typeof dialog.contains === "function" && !dialog.contains(event.target as Node)) {
        (focusableControls()[0] ?? dialog).focus();
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Tab" && !event.defaultPrevented && dialog) {
        const controls = focusableControls();
        if (!controls.length) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        event.preventDefault();
        const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
        const nextIndex = event.shiftKey
          ? (currentIndex <= 0 ? controls.length - 1 : currentIndex - 1)
          : (currentIndex + 1) % controls.length;
        (controls[nextIndex] ?? dialog).focus();
        return;
      }
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    const hasDocumentListeners = typeof document.addEventListener === "function";
    if (hasDocumentListeners) document.addEventListener("focusin", containFocus);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      if (hasDocumentListeners) document.removeEventListener("focusin", containFocus);
      window.removeEventListener("keydown", closeOnEscape);
      unlockBackground();
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
  }, [initialField, onClose]);
  const cells = useMemo(() => calendarCells(monthKey), [monthKey]);
  const [calendarYear, calendarMonth] = monthKey.split("-").map(Number);
  const normalizedRange = { start: normalizeClockInput(timeInputs.start), end: normalizeClockInput(timeInputs.end) };
  const timeInput = recurringRangeInput(normalizedRange);
  const timeError = !timed ? "" : !validRecurringClock("start", timeInputs.start) || !validRecurringClock("end", timeInputs.end)
    ? "请输入有效的开始和结束时间；结束时间可到 24:00。"
    : recurringTimeBlockIssue(timeInput) ? "结束时间必须晚于开始时间，且不能超过当天 24:00。" : "";
  const validityRangeValid = Boolean(draftStartsOn) && (!draftEndsOn || draftEndsOn >= draftStartsOn) && !timeError;
  const previewDates = recurringItemPreviewDates({ ...previewForm, starts_on: draftStartsOn, ends_on: draftEndsOn });
  const range = dates.dateAnchor && hoverDate ? { ...selectDateRange(dates.dateAnchor, hoverDate), preview: true } : { start: draftStartsOn, end: draftEndsOn || draftStartsOn, preview: false };

  function validRecurringClock(field: TimeRangeEdge, value: string) {
    const normalized = normalizeClockInput(value);
    return validDraftClock(normalized) || (field === "end" && normalized === "24:00");
  }
  function selectField(field: TimeRangeEdge, revealDate = false) {
    setActiveField(field);
    if (revealDate) {
      setHoverDate(null);
      setDates((current) => ({ ...current, dateAnchor: field === "start" ? current.end || null : current.start }));
      setMonthKey((field === "start" ? draftStartsOn : draftEndsOn || draftStartsOn).slice(0, 7));
    }
  }
  function handleDateClick(date: string) {
    setHoverDate(null);
    setDates((current) => {
      const next = selectDateRange(current.dateAnchor, date);
      return !current.end && !current.dateAnchor ? { ...next, end: "" } : next;
    });
    if (date.slice(0, 7) !== monthKey) setMonthKey(date.slice(0, 7));
  }
  function shiftPickerMonth(offset: number) {
    setHoverDate(null);
    setMonthKey(shiftMonthKey(monthKey, offset));
  }
  const validityPresets = [
    { key: "open" as const, label: "长期有效", endDate: "" },
    { key: "days" as const, label: "1 个月", days: 30, endDate: shiftDateValue(draftStartsOn, 30) },
    { key: "days" as const, label: "3 个月", days: 90, endDate: shiftDateValue(draftStartsOn, 90) },
    { key: "days" as const, label: "半年", days: 180, endDate: shiftDateValue(draftStartsOn, 180) },
    { key: "days" as const, label: "1 年", days: 365, endDate: shiftDateValue(draftStartsOn, 365) },
    { key: "year_end" as const, label: "至今年底", endDate: `${draftStartsOn.slice(0, 4)}-12-31` }
  ];
  function applyValidityPreset(action: "open" | "days" | "year_end", days = 0) {
    setHoverDate(null);
    setDates((current) => ({ ...current, end: action === "open" ? "" : action === "year_end" ? `${current.start.slice(0, 4)}-12-31` : shiftDateValue(current.start, days), dateAnchor: null }));
  }
  function updateTimeRange(next: { start: string; end: string }) {
    setTimeInputs(next);
    setRailRange(next);
  }
  function updateTimeInput(field: TimeRangeEdge, raw: string, commit = false) {
    const sanitized = sanitizeTimeInput(raw);
    const value = commit && validRecurringClock(field, sanitized) ? normalizeClockInput(sanitized) : sanitized;
    setTimeInputs((current) => ({ ...current, [field]: value }));
  }
  function commitTimeInput(field: TimeRangeEdge, raw: string) {
    if (cancelledTimeBlurRef.current === field) {
      cancelledTimeBlurRef.current = null;
      return;
    }
    updateTimeInput(field, raw, true);
  }
  useEffect(() => {
    if (!timeError) setRailRange(normalizedRange);
  }, [normalizedRange.start, normalizedRange.end, timeError]);
  function handleTimeKeyDown(event: KeyboardEvent<HTMLInputElement>, field: TimeRangeEdge) {
    if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      selectField(field);
      setOpenWheelField(field);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      updateTimeInput(field, event.currentTarget.value, true);
      event.currentTarget.select();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelledTimeBlurRef.current = field;
      setTimeInputs((current) => ({ ...current, [field]: railRange[field] }));
      event.currentTarget.blur();
    }
  }
  function applyWheelTime(field: TimeRangeEdge, nextClock: string) {
    const next = applyTimeWheelSelection(field, nextClock, {
      start: validRecurringClock("start", timeInputs.start) ? normalizeClockInput(timeInputs.start) : railRange.start,
      end: validRecurringClock("end", timeInputs.end) ? normalizeClockInput(timeInputs.end) : railRange.end
    }, {
      minimumDuration: 1,
      maximumMinute: 24 * 60,
      allowMidnightEnd: true
    });
    updateTimeRange(next);
    selectField(field);
  }
  function confirmRange() {
    if (!validityRangeValid) return;
    setOpenWheelField(null);
    if (!timed) {
      onConfirm(draftStartsOn, draftEndsOn, "", null);
    } else {
      onConfirm(draftStartsOn, draftEndsOn, timeInput.display_time, timeInput.display_duration_minutes);
    }
    onClose();
  }
  function renderBoundary(field: TimeRangeEdge, label: string, date: string) {
    const active = activeField === field;
    const inputValid = validRecurringClock(field, timeInputs[field]);
    return <section className={`apple-schedule-row schedule-boundary-row ${field}${active ? " is-active" : ""}`} aria-label={`${label}时间`} onClick={() => selectField(field, true)}>
      <span className="apple-schedule-label">{label}日期</span>
      <div className="apple-schedule-values">
        <button type="button" className={active ? "is-active" : ""} aria-label={`选择${label}日期`} aria-pressed={active} onClick={(event) => { event.stopPropagation(); selectField(field, true); }}><Icon name="calendar" size={14} />{date ? pickerDateLabel(date) : "长期有效"}</button>
      </div>
      {timed && <div className="schedule-time-control selection-time-box" ref={field === "start" ? startWheelAnchorRef : endWheelAnchorRef} onClick={(event) => event.stopPropagation()}>
        <small aria-hidden="true">{label}</small>
        <input ref={field === "start" ? timeInputRef : endTimeInputRef} type="text" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={5} value={timeInputs[field]} aria-label={`输入${label}时间`} aria-describedby="recurring-time-input-help" aria-invalid={!inputValid} onFocus={(event) => { selectField(field); event.currentTarget.select(); }} onClick={() => { selectField(field); setOpenWheelField(field); }} onChange={(event) => updateTimeInput(field, event.target.value)} onBlur={(event) => commitTimeInput(field, event.currentTarget.value)} onKeyDown={(event) => handleTimeKeyDown(event, field)} />
        <TimeWheelTrigger active={openWheelField === field} label={`打开${label}时间滚轴`} controlsId="recurring-picker-time-wheel" onToggle={() => { selectField(field); setOpenWheelField((current) => current === field ? null : field); }} />
      </div>}
    </section>;
  }
  return createPortal(<div className="schedule-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="schedule-picker-dialog recurring-schedule-dialog manual-time-picker" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="recurring-validity-title" tabIndex={-1}>
      <header className="schedule-picker-header">
        <div><h2 id="recurring-validity-title">有效日期范围</h2><p>点选一天，或连续点选两个日期；较早的日期自动作为开始日。</p></div>
        <div className="schedule-picker-header-actions"><button type="button" className="schedule-picker-close" aria-label="关闭时间范围" onClick={onClose}><Icon name="close" size={18} /></button></div>
      </header>
      <div className="schedule-picker-body">
        <section className="schedule-picker-calendar" aria-label="选择日期">
          <header><strong>{calendarYear}年{calendarMonth}月</strong><div><button type="button" aria-label="上个月" onClick={() => shiftPickerMonth(-1)}><Icon name="chevron-left" size={17} /></button><button type="button" aria-label="下个月" onClick={() => shiftPickerMonth(1)}><Icon name="chevron-right" size={17} /></button></div></header>
          <div className="apple-date-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
          <ScheduleDateGrid cells={cells} today={todayDate} start={draftStartsOn} end={draftEndsOn} range={range} onSelect={handleDateClick} onHover={setHoverDate} />
          <footer aria-live="polite"><strong>{!draftEndsOn ? dates.dateAnchor ? "长期有效，可再选一天设置结束日期" : "已选长期有效，点击日期调整开始日" : draftStartsOn === draftEndsOn ? dates.dateAnchor ? "已选单日，可再选一天组成多日范围" : "已选单日，点击日期可重新选择" : dates.dateAnchor ? "已选多日，点击新日期后自动排序" : "已选多日，点击日期可重新选择"}</strong></footer>
          <div className="schedule-validity-presets" role="group" aria-label="有效期限快捷选项">
            {validityPresets.map((preset) => {
              const active = draftEndsOn === preset.endDate;
              return <button key={preset.label} type="button" className={active ? "selection-preset-btn is-active" : "selection-preset-btn"} aria-pressed={active} onClick={() => applyValidityPreset(preset.key, preset.days ?? 0)}>{preset.label}</button>;
            })}
          </div>
        </section>
        <section className="schedule-picker-range-panel" aria-label="调整时间范围">
          <header>
            <div><strong>调整时间范围</strong><span>{!timed ? "不限时刻" : timeError ? "每次任务" : formatWorkloadMinutes(timeInput.display_duration_minutes!)}</span></div>
            <div className="schedule-picker-time-mode" role="group" aria-label="时刻设置方式">
              <button type="button" className={timed ? "is-active" : ""} aria-pressed={timed} onClick={() => setTimed(true)}>指定时刻</button>
              <button type="button" className={!timed ? "is-active" : ""} aria-pressed={!timed} onClick={() => { setOpenWheelField(null); setTimed(false); }}>不限时刻</button>
            </div>
          </header>
          <div className="schedule-picker-boundaries schedule-picker-rows apple-schedule-rows">
            {renderBoundary("start", "开始", draftStartsOn)}
            {renderBoundary("end", "结束", draftEndsOn)}
            <span id="recurring-time-input-help" className="sr-only">可输入 9、930 或 09:30；结束时间可到当天 24:00。</span>
          </div>
          {timed ? <>
            <TimeWheelPopover
              id="recurring-picker-time-wheel"
              open={openWheelField !== null}
              edge={openWheelField ?? "start"}
              value={openWheelField === "end" ? timeInputs.end : timeInputs.start}
              fallbackValue={openWheelField === "end" ? railRange.end : railRange.start}
              allowMidnightEnd={openWheelField === "end"}
              anchorRef={openWheelField === "end" ? endWheelAnchorRef : startWheelAnchorRef}
              onSelect={(nextClock) => { if (openWheelField) applyWheelTime(openWheelField, nextClock); }}
              onClose={() => setOpenWheelField(null)}
            />
            <BlockEditorTimeRangeRail start={railRange.start} end={railRange.end} minimumDuration={1} maxMinute={24 * 60} allowMidnightEnd presetsOnly onChange={updateTimeRange} />
          </> : <UntimedScheduleNote />}
          <div className="schedule-occurrence-preview"><strong>近期发生预览</strong><p>{previewDates.length ? previewDates.slice(0, 3).map(pickerDateLabel).join("、") : previewForm.frequency === "weekdays" ? "暂无可确认的发生日期；请检查相关年份的节假日数据或调整规则。" : "当前设置没有可发生日期，请调整频率或有效开始日期。"}</p></div>
          {previewForm.frequency === "weekdays" && <HolidayCoverageNotice from={draftStartsOn} to={draftEndsOn || shiftDateValue(draftStartsOn, 365)} />}
        </section>
      </div>
      <footer className="schedule-picker-footer">
        {timeError ? <p className="schedule-picker-footer-error" role="alert">{timeError}</p> : <output className="schedule-picker-summary"><i className="apple-schedule-workload-icon" aria-hidden="true"><Icon name="clock" size={15} /></i><span>已选 <strong>{pickerDateLabel(draftStartsOn)} — {draftEndsOn ? pickerDateLabel(draftEndsOn) : "长期有效"}</strong><CopySeparator />{timed ? <>每次 <strong>{normalizedRange.start}–{normalizedRange.end}</strong></> : <strong>不限时刻</strong>}</span></output>}
        <div><button type="button" className="secondary-action" onClick={onClose}>取消</button><button type="button" className="schedule-picker-confirm" disabled={!validityRangeValid} onClick={confirmRange}>确认安排</button></div>
      </footer>
    </div>
  </div>, document.body);
}

const recurringFrequencyOptions: { value: "daily" | "weekly" | "monthly"; label: string }[] = [
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" }
];

function RecurringFrequencyDropdown({ id, value, disabled = false, onChange }: {
  id: string;
  value: "daily" | "weekly" | "monthly";
  disabled?: boolean;
  onChange: (value: "daily" | "weekly" | "monthly") => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const currentLabel = recurringFrequencyOptions.find((option) => option.value === value)?.label ?? "每周";

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent | FocusEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return <div ref={rootRef} className={`recurring-select-wrapper${open ? " is-open" : ""}`}>
    <button
      id={id}
      ref={triggerRef}
      type="button"
      className={`recurring-select-trigger${open ? " is-open" : ""}`}
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? `${id}-menu` : undefined}
      aria-label={`频率：${currentLabel}`}
      onClick={() => setOpen((current) => !current)}
    >
      <span className="recurring-select-value">{currentLabel}</span>
      <span className="recurring-select-arrow" aria-hidden="true">
        <Icon name="chevron-down" size={15} />
      </span>
    </button>
    {open && <div id={`${id}-menu`} className="recurring-frequency-popover" role="listbox" aria-label="重复频率">
      {recurringFrequencyOptions.map((option) => {
        const selected = option.value === value;
        return <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={selected}
          className={`recurring-frequency-option${selected ? " is-selected" : ""}`}
          onClick={() => {
            onChange(option.value);
            setOpen(false);
          }}
        >
          <span>{option.label}</span>
          {selected && <span className="task-filter-check" aria-hidden="true">✓</span>}
        </button>;
      })}
    </div>}
  </div>;
}

function RecurringItemEditor({ form, disabled, idPrefix, autoFocusTitle = false, compact = false, isCreating = false, availableTags = [], onChange }: {
  form: RecurringItemForm;
  disabled: boolean;
  idPrefix: string;
  autoFocusTitle?: boolean;
  compact?: boolean;
  isCreating?: boolean;
  availableTags?: string[];
  onChange: (form: RecurringItemForm) => void;
}) {
  const ruleTitleId = `${idPrefix}-rule-title`;
  const titleId = `${idPrefix}-title`;
  const notesId = `${idPrefix}-notes`;
  const editorRef = useRef<HTMLDivElement>(null);
  const [optionalNotesExpanded, setNotesExpanded] = useState<boolean | null>(null);
  const [hasRoomForNotes, setHasRoomForNotes] = useState(false);
  const notesExpanded = !isCreating || (optionalNotesExpanded ?? hasRoomForNotes);
  useLayoutEffect(() => {
    if (!isCreating || !compact) return;
    const editorForm = editorRef.current?.closest<HTMLFormElement>("#new-task-form");
    if (!editorForm) return;
    const updateNotesSpace = () => {
      const { width, height } = editorForm.getBoundingClientRect();
      setHasRoomForNotes(width >= 680 && height >= 850);
    };
    updateNotesSpace();
    const observer = new ResizeObserver(updateNotesSpace);
    observer.observe(editorForm);
    return () => observer.disconnect();
  }, [isCreating, compact]);
  const [validityPicker, setValidityPicker] = useState<{ activeField: "start" | "end" | "time" | "duration" } | null>(null);
  const [intervalNoticeId, setIntervalNoticeId] = useState(0);
  const intervalShakeRef = useRef<Animation | null>(null);
  useEffect(() => {
    if (!intervalNoticeId) return;
    const timer = window.setTimeout(() => setIntervalNoticeId(0), 2400);
    return () => window.clearTimeout(timer);
  }, [intervalNoticeId]);
  function showIntervalMinimum(input: HTMLInputElement) {
    setIntervalNoticeId((current) => current + 1);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    intervalShakeRef.current?.cancel();
    intervalShakeRef.current = input.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(-3px)" }, { transform: "translateX(0)" }],
      { duration: 280, easing: "ease-in-out" }
    );
  }
  const today = shanghaiDateValue();
  const previewDates = recurringItemPreviewDates(form);
  const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];
  const isDailyLike = form.frequency === "daily" || form.frequency === "weekdays";
  const intervalUnit = form.frequency === "weekdays" ? "工作日" : form.frequency === "daily" ? "天" : form.frequency === "monthly" ? "个月" : "周";
  const clockRange = recurringClockRange(form);
  const isUntimed = !form.display_time;
  const lastTimedRangeRef = useRef<{ time: string; duration: number } | null>(null);
  if (form.display_time && form.display_duration_minutes && !recurringTimeBlockIssue(form)) {
    lastTimedRangeRef.current = { time: form.display_time, duration: form.display_duration_minutes };
  }

  function toggleUntimed() {
    if (isUntimed) {
      const defaults = recurringItemDefaultForm(today);
      const restored = lastTimedRangeRef.current;
      onChange({
        ...form,
        display_time: restored?.time || defaults.display_time || "09:00",
        display_duration_minutes: restored?.duration || defaults.display_duration_minutes || 60
      });
      return;
    }
    if (form.display_time && form.display_duration_minutes && !recurringTimeBlockIssue(form)) {
      lastTimedRangeRef.current = { time: form.display_time, duration: form.display_duration_minutes };
    }
    onChange({ ...form, display_time: "", display_duration_minutes: null });
  }

  return <div className="recurring-editor-surface" ref={editorRef}>
    {/* BEGIN: EventBasicInfo */}
    <section className="recurring-modal-section recurring-basic-info-card recurring-card" data-purpose="basic-info-form" aria-label="事项内容">
      <div className="recurring-title-row">
        <div className="recurring-title-field">
          <label htmlFor={titleId} className="sr-only">标题</label>
          <input
            id={titleId}
            type="text"
            autoFocus={autoFocusTitle}
            required
            maxLength={300}
            disabled={disabled}
            value={form.title}
            placeholder="标题"
            className="recurring-modal-input"
            onChange={(event) => onChange({ ...form, title: event.target.value })}
          />
        </div>
        <TaskTagEditor id={`${idPrefix}-tags`} tags={form.tags} suggestions={availableTags} disabled={disabled} onChange={(tags) => onChange({ ...form, tags })} />
      </div>
    </section>
    {/* END: EventBasicInfo */}

    {/* BEGIN: RepeatScheduleConfiguration */}
    <section className="recurring-modal-section recurring-repeat-rules-card recurring-card" data-purpose="repeat-rules-panel" aria-labelledby={ruleTitleId}>
      <div className="recurring-modal-section-title-row">
        <span className="recurring-modal-section-title" id={ruleTitleId}>重复安排</span>
      </div>
      <div className={`recurring-rule-grid${form.frequency === "monthly" ? " is-monthly" : ""}`}>
        <div className="recurring-field-inline">
          <label className="recurring-inline-label" htmlFor={`${idPrefix}-frequency`}>频率</label>
          <RecurringFrequencyDropdown
            id={`${idPrefix}-frequency`}
            disabled={disabled}
            value={form.frequency === "weekdays" ? "daily" : form.frequency}
            onChange={(nextFreq) => {
              const startDay = Number(form.starts_on?.slice(8, 10)) || Number(today.slice(8, 10)) || 1;
              onChange({
                ...form,
                frequency: nextFreq,
                month_day: nextFreq === "monthly" ? (form.month_day || startDay) : form.month_day
              });
            }}
          />
        </div>
        <div className="recurring-field-inline">
          <label className="recurring-inline-label" htmlFor={`${idPrefix}-interval`}>重复周期</label>
          <div className="recurring-input-with-suffix">
            <input
              id={`${idPrefix}-interval`}
              type="number"
              min={1}
              max={365}
              disabled={disabled}
              value={form.interval_value}
              aria-describedby={intervalNoticeId ? `${idPrefix}-interval-popover` : undefined}
              onKeyDown={(event) => {
                if (form.interval_value === 1 && (event.key === "Backspace" || event.key === "Delete")) {
                  event.preventDefault();
                  showIntervalMinimum(event.currentTarget);
                }
              }}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (!Number.isFinite(value) || value < 1 || !event.currentTarget.value) {
                  if (form.interval_value === 1) showIntervalMinimum(event.currentTarget);
                  else onChange({ ...form, interval_value: 1 });
                  return;
                }
                onChange({ ...form, interval_value: value });
              }}
            />
            <span className="recurring-input-suffix">{intervalUnit}</span>
            {intervalNoticeId > 0 && <span key={intervalNoticeId} id={`${idPrefix}-interval-popover`} className="recurring-minimum-popover" role="status">周期不能小于 1 {intervalUnit}</span>}
          </div>
        </div>
        {form.frequency === "monthly" && (
          <div className="recurring-field-inline recurrence-month-day">
            <label className="recurring-inline-label" htmlFor={`${idPrefix}-month-day`}>每月日期</label>
            <div className="recurring-input-with-suffix">
              <input
                id={`${idPrefix}-month-day`}
                type="number"
                min={1}
                max={31}
                disabled={disabled}
                value={form.month_day ?? (Number(form.starts_on?.slice(8, 10)) || Number(today.slice(8, 10)) || 1)}
                onChange={(event) => onChange({ ...form, month_day: Math.min(31, Math.max(1, Number(event.target.value) || 1)) })}
              />
              <span className="recurring-input-suffix">日</span>
            </div>
          </div>
        )}
      </div>
      {(isDailyLike || form.frequency === "weekly") && (
        <div className="recurring-frequency-bar-container">
          {isDailyLike && (
          <div className="recurring-daily-bar">
            <div className="recurring-daily-radios" role="group" aria-label="日常规约">
              <span className="recurring-daily-heading">日常规约：</span>
              <label className="recurring-radio-label">
                <input
                  type="radio"
                  name={`${idPrefix}-day-type`}
                  value="all"
                  checked={form.frequency === "daily"}
                  disabled={disabled}
                  onChange={() => onChange({ ...form, frequency: "daily" })}
                />
                <span>所有自然日</span>
              </label>
              <label className="recurring-radio-label">
                <input
                  type="radio"
                  name={`${idPrefix}-day-type`}
                  value="workday"
                  checked={form.frequency === "weekdays"}
                  disabled={disabled}
                  onChange={() => onChange({ ...form, frequency: "weekdays" })}
                />
                <span>仅工作日</span>
              </label>
            </div>
            <span className="recurring-daily-tag">
              {form.frequency === "weekdays"
                ? `每 ${form.interval_value} 个工作日发生一次`
                : `每 ${form.interval_value} 天发生一次`}
            </span>
          </div>
        )}

        {form.frequency === "weekly" && (
          <div className="recurring-weekly-bar">
            <div className="recurring-weekday-grid" role="group" aria-label="每周发生日期">
              {weekdayLabels.map((label, index) => {
                const day = index + 1;
                const selected = form.weekdays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={selected}
                    disabled={disabled}
                    className={`recurring-weekday-btn${selected ? " is-active" : ""}`}
                    onClick={() =>
                      onChange({
                        ...form,
                        weekdays: selected
                          ? form.weekdays.filter((item) => item !== day)
                          : [...form.weekdays, day].sort((left, right) => left - right)
                      })
                    }
                  >
                    周{label}
                  </button>
                );
              })}
            </div>
          </div>
          )}
        </div>
      )}

      <div className="recurring-validity-card">
        {form.frequency === "weekdays" && <HolidayCoverageNotice from={form.starts_on} to={form.ends_on || shiftDateValue(form.starts_on, 365)} />}
        <div className="recurring-validity-heading">
          <div className="recurring-validity-title-wrap">
            <span className="recurring-validity-label">有效日期</span>
            <span className={`recurring-inline-preview${previewDates.length ? "" : " is-empty"}`} role="status" aria-live="polite">
              {previewDates.length ? (
                <>最近发生：{previewDates.map(pickerDateLabel).join("、")}</>
              ) : (
                <span className="recurring-inline-preview-empty">暂无匹配发生日，不能保存</span>
              )}
            </span>
          </div>
          <div className="recurring-validity-actions">
            <button
              type="button"
              className={`apple-schedule-untimed-btn${isUntimed ? " is-active" : ""}`}
              aria-pressed={isUntimed}
              title={isUntimed ? "点击取消不限时刻，恢复具体时刻" : "切换为不限时刻（仅保留日期）"}
              disabled={disabled}
              onClick={toggleUntimed}
            >
              {isUntimed && <Icon name="check" size={12} />}
              不限时刻
            </button>
            {form.ends_on && (
              <button
                type="button"
                className="recurring-clear-ends-on"
                disabled={disabled}
                onClick={() => onChange({ ...form, ends_on: "" })}
              >
                设为长期有效
              </button>
            )}
          </div>
        </div>

        <div className="apple-schedule-rows">
          <div className="apple-schedule-row">
            <span className="apple-schedule-label">开始</span>
            <div className="apple-schedule-values">
              <button type="button" className={validityPicker?.activeField === "start" ? "is-active" : ""} disabled={disabled} aria-haspopup="dialog" aria-expanded={validityPicker?.activeField === "start"} aria-label={`开始日期：${pickerDateLabel(form.starts_on)}`} onClick={() => setValidityPicker({ activeField: "start" })}><Icon name="calendar" size={14} />{pickerDateLabel(form.starts_on)}</button>
              <button type="button" className={`${validityPicker?.activeField === "time" ? "is-active " : ""}${!form.display_time ? "is-untimed" : ""}`.trim()} disabled={disabled} aria-haspopup="dialog" aria-expanded={validityPicker?.activeField === "time"} aria-label={`开始时间：${form.display_time || "不限时刻（可选）"}`} onClick={() => setValidityPicker({ activeField: "time" })}><Icon name="clock" size={14} />{form.display_time || "不限时刻"}</button>
            </div>
          </div>
          <div className="apple-schedule-row">
            <span className="apple-schedule-label">结束</span>
            <div className="apple-schedule-values">
              <button type="button" className={validityPicker?.activeField === "end" ? "is-active" : ""} disabled={disabled} aria-haspopup="dialog" aria-expanded={validityPicker?.activeField === "end"} aria-label={`结束日期：${form.ends_on ? pickerDateLabel(form.ends_on) : "长期有效"}`} onClick={() => setValidityPicker({ activeField: "end" })}><Icon name="calendar" size={14} />{form.ends_on ? pickerDateLabel(form.ends_on) : "长期有效"}</button>
              <button type="button" className={`${validityPicker?.activeField === "duration" ? "is-active " : ""}${!form.display_time ? "is-untimed" : ""}`.trim()} disabled={disabled} aria-haspopup="dialog" aria-expanded={validityPicker?.activeField === "duration"} aria-label={`结束时间：${clockRange.end || "不限时刻（可选）"}`} onClick={() => setValidityPicker({ activeField: "duration" })}><Icon name="clock" size={14} />{clockRange.end || "不限时刻"}</button>
            </div>
          </div>
        </div>
      </div>
    </section>
    {/* END: RepeatScheduleConfiguration */}

    <section className={`recurring-optional-notes${notesExpanded ? " is-expanded" : ""}`} aria-label="备注">
      {isCreating && <button type="button" className="recurring-notes-toggle" disabled={disabled} aria-label={notesExpanded ? "收起备注" : undefined} aria-expanded={notesExpanded} aria-controls={`${notesId}-panel`} onClick={() => setNotesExpanded(!notesExpanded)}>
        <span className="recurring-notes-toggle-main">{notesExpanded ? <span className="sr-only">备注</span> : <><span className="recurring-notes-toggle-icon" aria-hidden="true"><Icon name="plus" size={12} /></span>{form.notes.trim() ? "查看备注" : "添加备注（可选）"}</>}</span>
        <span className="recurring-notes-toggle-hint">{notesExpanded ? <>收起<Icon name="chevron-down" size={14} /></> : form.notes.trim() ? "点击查看说明" : "点击补充说明"}</span>
      </button>}
      <div id={`${notesId}-panel`} className="recurring-notes-panel" hidden={!notesExpanded}>
        <TaskNotesInputs id={notesId} value={form.notes} disabled={disabled} maxLength={2000} icons onChange={(notes) => onChange({ ...form, notes })} />
      </div>
    </section>

    {validityPicker && (
      <RecurringValidityPicker
        startsOn={form.starts_on}
        endsOn={form.ends_on}
        displayTime={form.display_time}
        displayDurationMinutes={form.display_duration_minutes}
        initialField={validityPicker.activeField}
        todayDate={today}
        previewForm={form}
        onConfirm={(startsOn, endsOn, displayTime, displayDurationMinutes) => {
          const prevStartDay = Number(form.starts_on?.slice(8, 10)) || 1;
          const nextStartDay = Number(startsOn?.slice(8, 10)) || 1;
          const shouldSyncMonthDay = form.frequency === "monthly" && (!form.month_day || form.month_day === prevStartDay);
          onChange({
            ...form,
            starts_on: startsOn,
            ends_on: endsOn,
            display_time: displayTime,
            display_duration_minutes: displayDurationMinutes,
            month_day: shouldSyncMonthDay ? nextStartDay : form.month_day
          });
        }}
        onClose={() => setValidityPicker(null)}
      />
    )}
  </div>;
}

function TaskCapsuleFact({ icon, label }: { icon: IconName; label: string }) {
  const deadline = label.startsWith("截止 ");
  return <span className={deadline ? "task-capsule-deadline" : undefined} title={label} aria-label={label}><Icon name={deadline ? "clock" : icon} size={13} />{deadline ? label.slice(3) : label}</span>;
}

function TaskCapsuleContent({
  title,
  notes,
  notesArePlainText = false,
  priority,
  timing,
  minutes,
  facts = [],
  status,
  sourceType,
  typeLabel,
  variant = "task",
  statusTone,
  tags = [],
  compact = false
}: {
  title: string;
  notes?: string | null;
  notesArePlainText?: boolean;
  priority?: Task["priority"];
  timing?: string | null;
  minutes?: number | null;
  facts?: { icon: IconName; label: string }[];
  status: string;
  sourceType?: Task["source_type"];
  typeLabel?: string;
  variant?: "task" | "recurring";
  statusTone?: TaskListStatus | "draft" | "active" | "paused" | "ended";
  tags?: string[];
  compact?: boolean;
}) {
  const visibleNotes = notesArePlainText ? notes : splitTaskNotes(notes ?? "").body;
  return <span className={`task-capsule-content${variant === "recurring" ? " recurring" : ""}${compact ? " compact" : ""}`}>
    <span className="task-capsule-heading">
      <strong title={title}>{title}</strong>
      <span className="task-capsule-right-slot">
        <span className={`task-capsule-status${statusTone ? ` status-${statusTone}` : ""}`}>{status}</span>
      </span>
    </span>
    {visibleNotes && <span className="task-capsule-notes" title={visibleNotes}>{visibleNotes}</span>}
    <span className="task-capsule-footer">
      <span className="task-capsule-facts">
        {priority && <span className={`priority-badge priority-${priority}`}>{priorityCopy[priority]}</span>}
        {facts.map((fact, index) => <TaskCapsuleFact key={`${fact.icon}-${fact.label}-${index}`} {...fact} />)}
        {timing && <TaskCapsuleFact icon="calendar" label={timing} />}
        {minutes !== null && minutes !== undefined && <span><Icon name="clock" size={13} />{minutes} 分钟</span>}
      </span>
      <span className="task-capsule-heading-meta">
        {typeLabel && <span className={`task-type-badge${variant === "recurring" ? " recurring" : ""}`}>{typeLabel}</span>}
        <TaskTagList tags={tags} limit={1} />
        {sourceType === "ai_assistant" && <span className="task-source-icon source-ai_assistant" role="img" aria-label="AI 创建" title="AI 创建"><Icon name="sparkle" size={13} /></span>}
      </span>
    </span>
  </span>;
}

function recurringItemStatusLabel(item: RecurringItem) {
  if (item.deleted_at) return "回收站";
  if (item.status === "active") return "生效中";
  if (item.status === "paused") return "已暂停";
  return "已结束";
}

function recurringCapsuleFacts(item: Pick<RecurringItem, "frequency" | "ends_on" | "display_time">, today: string): { icon: IconName; label: string }[] {
  const endLabel = item.ends_on === today
    ? "今天"
    : item.ends_on
      ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).format(new Date(`${item.ends_on}T00:00:00+08:00`))
      : null;
  return [
    { icon: "calendar", label: endLabel ? `截止 ${endLabel}` : "长期有效" },
    { icon: "restore", label: item.frequency === "daily" ? "每天" : item.frequency === "weekdays" ? "工作日" : item.frequency === "weekly" ? "每周" : "每月" },
    ...(item.display_time && validDraftClock(item.display_time) ? [{ icon: "clock" as const, label: item.display_time }] : [])
  ];
}

function RecurringItemCapsuleContent({ item, today }: { item: RecurringItem; today: string }) {
  const statusTone = item.deleted_at ? "deleted" : item.status;
  return <TaskCapsuleContent
    title={item.title}
    notes={item.notes}
    tags={item.tags}
    facts={recurringCapsuleFacts(item, today)}
    status={recurringItemStatusLabel(item)}
    sourceType={item.source_type}
    variant="recurring"
    statusTone={statusTone}
  />;
}

function RecycleBinActions({ deletedAt, nowMs, itemLabel, busy, onRestore, onPermanentDelete }: {
  deletedAt: string | null;
  nowMs: number;
  itemLabel: string;
  busy: boolean;
  onRestore: () => void;
  onPermanentDelete: () => void;
}) {
  return <>
    <button type="button" className="secondary-action" disabled={busy} onClick={onRestore}><Icon name="restore" size={15} />恢复{itemLabel}</button>
    <div className="task-detail-delete-group">
      <p className="task-detail-cleanup"><Icon name="clock" size={13} /><span>{recycleCleanupMessage(deletedAt, nowMs)}</span></p>
      <button type="button" className="terminal-task-trash" disabled={busy} onClick={onPermanentDelete}><Icon name="trash" size={14} />永久删除</button>
    </div>
  </>;
}

function TaskDetailResources({ notes }: { notes: string | null }) {
  const { url, body } = splitTaskNotes(notes ?? "");
  const href = taskResourceUrl(url);
  const urlRef = useRef<HTMLSpanElement>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);
  const [error, setError] = useState<string | null>(null);
  async function openResource() {
    if (!href) return;
    try { await openUrl(href); setError(null); }
    catch { setError("链接暂时无法打开，请复制后在浏览器中打开。"); }
  }
  return <>
    <section className="task-detail-resources" aria-label="任务链接与备注">
      <h3 className="task-detail-section-title">链接与备注</h3>
      <div className="task-detail-resource-row">
        <div className="task-detail-resource-label" aria-label="任务 URL" title="任务 URL"><Icon name="external-link" size={14} /><span>链接</span></div>
        <div className="task-detail-link-content">
          {href ? <a className="task-detail-url" href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); void openResource(); }} title={url}><span ref={urlRef}>{url}</span></a> : <span ref={urlRef} className="task-detail-empty" title={url || undefined}>{url || "未设置"}</span>}
        </div>
        {url && <TimelineHoverCopyButton field="url" text={url} targetRef={urlRef} />}
      </div>
      <div className="task-detail-resource-row">
        <div className="task-detail-resource-label" aria-label="任务备注" title="任务备注"><Icon name="file" size={14} /><span>备注</span></div>
        <p ref={noteRef} className={`task-detail-note${body ? "" : " task-detail-empty"}`} tabIndex={body ? 0 : undefined} aria-label="任务备注">{body || "未填写"}</p>
        {body && <TimelineHoverCopyButton field="note" text={body} targetRef={noteRef} />}
      </div>
      {error && <p className="task-detail-resource-feedback" role="alert">{error}</p>}
    </section>
  </>;
}

function TaskContextReturnButton({ label, title = label, disabled, onClick }: { label: string; title?: string; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className="task-context-return-icon" aria-label={label} title={title} disabled={disabled} onClick={onClick}><Icon name="chevron-left" size={17} /></button>;
}

function TaskPageHeader({ task, editing = false, draftLabel = "草稿", onBack, backLabel, busy = false, utilityActions, children }: {
  task?: Task | RecurringItem; editing?: boolean; draftLabel?: string; onBack?: () => void; backLabel?: string; busy?: boolean; utilityActions?: React.ReactNode; children?: React.ReactNode;
}) {
  const recurring = task && "frequency" in task;
  const deleted = task?.status === "deleted" || Boolean(recurring && task.deleted_at);
  const listStatus = task ? recurring ? deleted ? "deleted" : task.status : taskListStatus(task) : "draft";
  const label = task ? recurring ? deleted ? "回收站" : recurringItemStatusLabel(task) : statusCopy[taskListStatus(task)] : draftLabel;
  const fallbackBack = editing ? (recurring ? "返回重复事项详情" : "返回任务详情") : "返回今日计划中的任务块";
  return <header className="task-compact-header task-page-header">
    <div className="task-compact-title-row">
      {onBack && <TaskContextReturnButton label={backLabel ?? fallbackBack} title={backLabel ?? fallbackBack} disabled={busy} onClick={onBack} />}
      {children}
      <nav className="task-detail-breadcrumb" aria-label={editing ? "编辑位置" : "详情位置"}><span>{deleted ? "回收站" : recurring ? "重复事项" : "任务"}</span><Icon name="chevron-right" size={12} /><h2 aria-current="page">{recurring ? (editing ? "编辑重复事项" : "重复事项详情") : (editing ? "编辑任务" : "任务详情")}</h2></nav>
    </div>
    <div className="task-page-header-right">
      {utilityActions}
      <span className={`terminal-task-status status-${listStatus}${recurring && !deleted ? " task-compact-status status-recurring" : ""}`}><Icon name={deleted ? "trash" : !task ? "file" : task.status === "done" || task.status === "ended" ? "check" : task.status === "paused" ? "pause" : "clock"} size={14} />{label}</span>
    </div>
  </header>;
}

function TaskDetailHero({ task, busy, onBack, utilityActions, actions }: {
  task: Task | RecurringItem;
  busy: boolean;
  onBack?: () => void;
  utilityActions?: React.ReactNode;
  actions: React.ReactNode;
}) {
  const recurring = "frequency" in task;
  const priority = !recurring ? task.priority : null;
  const showMeta = Boolean(priority || task.tags.length > 0 || task.source_type === "ai_assistant");
  return <div className="detail-fused-header">
    <TaskPageHeader task={task} onBack={onBack} busy={busy} utilityActions={utilityActions} />
    <header className="detail-hero-title-block">
      <h2 title={task.title}>{task.title}</h2>
      {showMeta && <div className="detail-hero-meta">
        {priority && <span className={`priority-badge priority-${priority}`}>{priorityCopy[priority]}</span>}
        <TaskTagList tags={task.tags} expanded />
        {task.source_type === "ai_assistant" && <span className="task-source-icon source-ai_assistant" role="img" aria-label="AI 创建" title="AI 创建"><Icon name="sparkle" size={13} />AI 创建</span>}
      </div>}
    </header>
    <footer className="task-detail-actions">{actions}</footer>
  </div>;
}

function TaskDetailContent({ task, metadata, children, busy, utilityActions, onBack }: {
  task: Task; metadata: TaskMetadata | null; children: React.ReactNode; busy: boolean; utilityActions?: React.ReactNode; onBack?: () => void;
}) {
  const boundary = (date: string | null, time: string | null) => date ? <>{date}{time && <time>{time}</time>}</> : "未设置";
  return <section className="terminal-task-detail ordinary-task-detail" aria-label={task.status === "deleted" ? "回收站任务详情" : "任务只读详情"}>
    <TaskDetailHero task={task} busy={busy} onBack={onBack} utilityActions={utilityActions} actions={children} />
    <div className="detail-scroll-body">
      <dl className="task-detail-facts" aria-label="任务基本信息">
        <div><dt><Icon name="calendar" size={14} />最早开始</dt><dd>{boundary(task.earliest_start_date, task.earliest_start_time)}</dd></div>
        <div><dt><Icon name="clock" size={14} />截止时间</dt><dd>{boundary(task.due_date, task.due_time)}</dd></div>
        <div><dt><Icon name="clock" size={14} />预计工作量</dt><dd>{task.estimated_minutes === null ? "未设置" : <>{task.estimated_minutes}<span className="task-detail-unit">分钟</span></>}</dd></div>
      </dl>
      <TaskDetailResources key={task.id} notes={task.notes} />
      <TaskStatusHistory task={task} metadata={metadata} />
    </div>
  </section>;
}

function DeletedTaskDetails({ task, metadata, busy, now, onRestore, onPermanentDelete, onBack }: {
  task: Task; metadata: TaskMetadata | null; busy: boolean; now: number; onRestore: () => void; onPermanentDelete: () => void; onNewTask?: () => void; onBack?: () => void;
}) {
  return <TaskDetailContent task={task} metadata={metadata} busy={busy} onBack={onBack}>
    <RecycleBinActions deletedAt={task.deleted_at} nowMs={now} itemLabel="任务" busy={busy} onRestore={onRestore} onPermanentDelete={onPermanentDelete} />
  </TaskDetailContent>;
}

function taskDisplayHistory(task: Task, events: TaskHistoryEvent[]) {
  const singleDay = Boolean(task.earliest_start_date && task.earliest_start_date === task.due_date);
  const displayed: (TaskHistoryEvent & { display_notes: string[]; display_label?: string })[] = [];
  for (const [index, event] of events.entries()) {
    const notes = [...new Set([event.note, event.review_note].filter((note): note is string => Boolean(note)))];
    const previous = events[index - 1];
    const completes = (event.kind === "automatic_status" || event.kind === "status") && event.status === "done"
      && previous?.kind === "execution" && previous.status === "done";
    const reopens = (event.kind === "automatic_status" || event.kind === "reopened")
      && (event.status === "open" || event.status === "scheduled") && previous?.kind === "cleared";
    // Keep the legacy correlation for old snapshots only. Capture deltas already represent one save.
    const elapsed = event.occurred_at && previous?.occurred_at
      ? Date.parse(event.occurred_at) - Date.parse(previous.occurred_at) : NaN;
    if (singleDay && !previous?.id.startsWith("capture:") && !event.id.startsWith("capture:") && previous?.plan_date === task.earliest_start_date
      && (completes || reopens) && elapsed >= 0 && elapsed < 1000) {
      const entry = displayed[displayed.length - 1];
      entry.display_label = completes ? "任务已完成" : "已取消任务完成";
      entry.display_notes = [...new Set([...entry.display_notes, ...notes])];
    } else {
      displayed.push({ ...event, display_notes: notes });
    }
  }
  return displayed;
}

function TaskStatusHistory({ task, metadata }: {
  task: Task; metadata: TaskMetadata | null; busy?: boolean; onNewTask?: () => void;
}) {
  const history = taskDisplayHistory(task, metadata?.history ?? []);
  const singleDay = Boolean(task.earliest_start_date && task.earliest_start_date === task.due_date);
  const crossDay = Boolean(task.earliest_start_date && task.due_date && task.earliest_start_date < task.due_date);
  const crossDayUntimed = crossDay && !task.earliest_start_time && !task.due_time;
  const groups = new Map<string, typeof history>();
  for (const event of history) {
    const date = event.occurred_at && Number.isFinite(Date.parse(event.occurred_at))
      ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(event.occurred_at))
      : event.plan_date ?? task.created_at.slice(0, 10);
    groups.set(date, [...(groups.get(date) ?? []), event]);
  }
  const statusLabel = (status: string | null | undefined) => status === "open" ? statusCopy.scheduled : status ? statusCopy[status as TaskListStatus] ?? status : null;
  const planDateLabel = (planDate: string | null | undefined) => planDate ? `${Number(planDate.slice(5, 7))}月${Number(planDate.slice(8, 10))}日` : "";
  const labelFor = (event: TaskHistoryEvent & { display_label?: string }) => {
    if (event.display_label) return event.display_label;
    const { kind, status, plan_date } = event;
    if (kind === "note") return "随手记";
    const taskDay = singleDay && plan_date === task.earliest_start_date;
    if (event.task_status === "done" && kind === "execution" && status === "done" && crossDay) return crossDayUntimed ? "整个任务已完成" : "当天任务已完成，整个任务已完成";
    if (event.task_status === "deleted" && kind === "execution") return "当天任务未完成，已移入回收站";
    if (kind === "cleared" && crossDay && event.task_status) return "已取消当天及整个任务完成";
    if (kind === "automatic_status") return status === "done" ? crossDay ? "所有日期均已完成，整个任务已自动完成" : "任务已完成" : crossDay ? "已取消整个任务完成" : "已取消任务完成";
    if (kind === "execution") return crossDayUntimed && status === "done" ? "整个任务已完成" : taskDay ? status === "done" ? "任务已完成" : "任务未完成" : status === "done" ? "当天任务已完成" : "当天任务未完成";
    if (kind === "cleared") return taskDay ? "已取消任务完成" : "已取消当天完成";
    if (kind === "cleared_incomplete") return taskDay ? "已取消任务未完成" : "已取消当天未完成";
    if (kind === "reopened") return crossDay ? "已取消整个任务完成" : "已取消任务完成";
    if (kind === "soft_deleted" || kind === "status" && status === "deleted") return "已移入回收站";
    if (kind === "restored") return `已从回收站恢复为${statusLabel(status) ?? "任务"}`;
    if (kind === "status" && status === "done") return crossDay ? "整个任务已完成" : "任务已完成";
    return kind === "created" ? "执行记录已建立" : `状态更新为${statusLabel(status) ?? "未知"}`;
  };
  const displayTime = (value: string, historyDate: string) => {
    if (!Number.isFinite(Date.parse(value))) return value;
    const date = new Date(value);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    const time = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(date);
    return day === historyDate ? time : `${day} ${time}`;
  };
  return <section className="task-detail-section" aria-label="执行记录">
    <details key={task.id} className="task-detail-history-group" open>
      <summary><Icon name="chevron-down" size={13} /><h3 className="task-detail-section-heading"><Icon name="review" size={15} />执行记录 <span className="task-detail-history-count">{history.length} 条动态</span></h3></summary>
      {!history.length ? <p className="task-detail-history-feedback">{metadata ? "暂无执行记录" : "正在加载执行记录…"}</p> : [...groups].sort(([a], [b]) => b.localeCompare(a)).map(([date, events], index) => <details key={date} className="task-detail-history" open={index === 0}>
        <summary><Icon name="chevron-down" size={13} /><span className="task-detail-history-date">{date}</span><span className="task-detail-history-count">{events.length} 条动态</span></summary>
        <ol className="task-detail-timeline">{events.map((event) => <li key={event.id} className="task-detail-event" data-status={event.kind === "cleared" || event.kind === "cleared_incomplete" ? "cleared" : event.status ?? "open"}>
          <div className="task-detail-event-top">{event.plan_date && <span className="task-detail-plan-date">安排日期 {planDateLabel(event.plan_date)}</span>}<strong>{labelFor(event)}</strong>{event.occurred_at && <time dateTime={event.occurred_at}>{displayTime(event.occurred_at, date)}</time>}</div>
          {event.display_notes.map((note, index) => <p key={index} className="task-detail-event-note">{note}</p>)}
          {event.note_cleared && <p className="task-detail-event-note">已清空随手记</p>}
        </li>)}</ol>
      </details>)}
    </details>
  </section>;
}

function RecurringExecutionHistory({ itemId, createdAt, status, deletedAt }: { itemId: string; createdAt: string; status?: RecurringItem["status"]; deletedAt?: string | null }) {
  const [history, setHistory] = useState<RecurringExecutionEvent[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setError("");
    void listRecurringExecutionHistory(itemId).then((events) => {
      if (!cancelled) setHistory(events);
    }).catch((reason) => { if (!cancelled) setError(`执行记录未载入：${uiErrorMessage(reason)}`); });
    return () => { cancelled = true; };
  }, [itemId, status, deletedAt, retry]);
  const creationEvent: RecurringExecutionEvent = { id: `created:${itemId}`, kind: "created", occurrence_id: null, occurrence_date: Number.isFinite(Date.parse(createdAt)) ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(createdAt)) : createdAt.slice(0, 10), title: "", display_time: null, display_duration_minutes: null, outcome: null, notes: null, occurred_at: createdAt };
  const displayHistory = history ? [creationEvent, ...history] : null;
  const groups = new Map<string, RecurringExecutionEvent[]>();
  for (const event of displayHistory ?? []) groups.set(event.occurrence_date, [...(groups.get(event.occurrence_date) ?? []), event]);
  return <section className="task-detail-section recurring-execution-records" aria-label="执行记录">
    <details key={itemId} className="task-detail-history-group" open>
      <summary><Icon name="chevron-down" size={13} /><h3 className="task-detail-section-heading"><Icon name="review" size={15} />执行记录{displayHistory && <span className="task-detail-history-count">{displayHistory.length} 条动态</span>}</h3></summary>
    {error ? <p className="task-detail-history-feedback" role="alert">{error} <button type="button" className="quiet-button" onClick={() => setRetry((value) => value + 1)}>重试</button></p>
      : history === null ? <p className="task-detail-history-feedback">正在加载执行记录…</p>
      : [...groups].sort(([a], [b]) => b.localeCompare(a)).map(([date, events], index) => <details key={`${itemId}:${date}`} className="task-detail-history" open={index === 0}>
        <summary><Icon name="chevron-down" size={13} /><span>{date}</span><span className="task-detail-history-count">{events.length} 条动态</span></summary>
        <ol className="task-detail-timeline">{events.map((event) => <li key={event.id} className="task-detail-event" data-occurrence-id={event.occurrence_id ?? undefined} data-status={event.kind && event.kind !== "execution" ? event.kind : event.outcome === "completed" ? "done" : event.outcome ? "not_completed" : event.cancelled_outcome || !(event.notes || event.note_cleared) ? "cleared" : "open"}>
          <div className="task-detail-event-top"><strong>{event.kind === "created" ? "执行记录已建立" : event.kind === "soft_deleted" ? "已移入回收站" : event.kind === "restored" ? "已从回收站恢复（保持已结束）" : event.kind === "paused" ? "重复事项已暂停" : event.kind === "resumed" ? "重复事项已恢复" : event.kind === "ended" ? "重复事项已结束" : event.outcome === "completed" ? "本次已完成" : event.outcome === "partial" ? "本次部分完成" : event.outcome === "not_completed" ? "本次未完成" : event.cancelled_outcome ? `已取消本次${event.cancelled_outcome === "completed" ? "完成" : event.cancelled_outcome === "partial" ? "部分完成" : "未完成"}` : event.notes || event.note_cleared ? "随手记" : "已取消本次结果"}</strong><time dateTime={event.occurred_at}>{event.occurred_at.length === 10 ? event.occurred_at : Number.isFinite(Date.parse(event.occurred_at)) ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(event.occurred_at)) : event.occurred_at}</time></div>
          {event.notes && <p className="task-detail-event-note">{event.notes}</p>}
          {event.note_cleared && <p className="task-detail-event-note">已清空随手记</p>}
        </li>)}</ol>
      </details>)}
    </details>
  </section>;
}


function recurringScheduleLabel(item: RecurringItem) {
  if (item.frequency === "daily") return item.interval_value === 1 ? "每天" : `每 ${item.interval_value} 天`;
  if (item.frequency === "weekdays") return `每 ${item.interval_value} 个工作日`;
  if (item.frequency === "monthly") return `${item.interval_value === 1 ? "每月" : `每 ${item.interval_value} 个月`} ${item.month_day ?? 1} 日`;
  const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
  const selectedDays = item.weekdays.map((day) => `周${weekdays[day - 1]}`).join("、") || "未选择星期";
  return `${item.interval_value === 1 ? "每周" : `每 ${item.interval_value} 周`} · ${selectedDays}`;
}
function RecurringDetailFacts({ item }: { item: RecurringItem }) {
  return <dl className="task-detail-facts task-detail-facts-recurring" aria-label="重复事项基本信息">
    <div><dt><Icon name="restore" size={14} />重复规则</dt><dd><SeparatedCopy text={recurringScheduleLabel(item)} /></dd></div>
    <div><dt><Icon name="calendar" size={14} />有效日期</dt><dd>{item.starts_on} 至 {item.ends_on ?? "长期"}</dd></div>
    <div><dt><Icon name="clock" size={14} />今日页显示</dt><dd>{item.display_time ?? "不指定时间"}</dd></div>
    <div><dt><Icon name="clock" size={14} />显示时长</dt><dd>{item.display_duration_minutes ? <>{item.display_duration_minutes}<span className="task-detail-unit">分钟</span></> : "未设置"}</dd></div>
  </dl>;
}

function RecurringItemDetails({ item, busy, onEdit, onPause, onResume, onEnd, onBack }: {
  item: RecurringItem; busy: boolean; onEdit: () => void; onPause: () => void; onResume: () => void; onEnd: () => void; onBack?: () => void;
}) {
  return <section className="terminal-task-detail ordinary-task-detail" aria-label="重复事项只读详情">
    <TaskDetailHero
      task={item}
      busy={busy}
      onBack={onBack}
      actions={<>
        <div className="task-detail-primary-actions">
          {item.status === "active" && <button type="button" className="secondary-action" disabled={busy} onClick={onPause}><Icon name="pause" size={14} />暂停事项</button>}
          {item.status === "paused" && <button type="button" className="secondary-action" disabled={busy} onClick={onResume}><Icon name="restore" size={14} />恢复事项</button>}
          <button type="button" className="secondary-action" disabled={busy} onClick={onEdit}><Icon name="file" size={14} />编辑事项</button>
        </div>
        {item.status === "paused" && <button type="button" className="terminal-task-trash" disabled={busy} onClick={onEnd}><Icon name="check" size={14} />结束事项</button>}
      </>}
    />
    <div className="detail-scroll-body">
      <RecurringDetailFacts item={item} />
      <TaskDetailResources key={item.id} notes={item.notes} />
      <RecurringExecutionHistory key={`history:${item.id}`} itemId={item.id} createdAt={item.created_at} status={item.status} deletedAt={item.deleted_at} />
    </div>
  </section>;
}


function DeletedRecurringItemDetails({ item, children, busy = false, onBack }: { item: RecurringItem; children?: React.ReactNode; busy?: boolean; onBack?: () => void }) {
  return <section className="terminal-task-detail ordinary-task-detail recycled-task-detail" aria-label="回收站重复事项详情">
    <TaskDetailHero task={item} busy={busy} onBack={onBack} actions={children} />
    <div className="detail-scroll-body">
      <RecurringDetailFacts item={item} />
      <TaskDetailResources key={item.id} notes={item.notes} />
      <RecurringExecutionHistory key={`history:${item.id}`} itemId={item.id} createdAt={item.created_at} status={item.status} deletedAt={item.deleted_at} />
    </div>
  </section>;
}

function EndedRecurringItemDetails({ item, busy, onTrash, onBack }: {
  item: RecurringItem; busy: boolean; onTrash: () => void; onBack?: () => void;
}) {
  return <section className="terminal-task-detail ordinary-task-detail" aria-label="已结束重复事项详情">
    <TaskDetailHero
      task={item}
      busy={busy}
      onBack={onBack}
      actions={<button type="button" className="terminal-task-trash" disabled={busy} onClick={onTrash}><Icon name="trash" size={14} />移入回收站</button>}
    />
    <div className="detail-scroll-body">
      <RecurringDetailFacts item={item} />
      <TaskDetailResources key={item.id} notes={item.notes} />
      <RecurringExecutionHistory key={`history:${item.id}`} itemId={item.id} createdAt={item.created_at} status={item.status} deletedAt={item.deleted_at} />
    </div>
  </section>;
}

function useResultNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 1000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  return now;
}

function taskBlockLocationDate(task: Task | null, today: string) {
  if (!task || !["scheduled", "done", "not_completed"].includes(taskListStatus(task)) || task.deleted_at) return null;
  const dates = [...task.scheduled_dates].sort();
  return dates.find((date) => date >= today) ?? dates[dates.length - 1] ?? null;
}

function CompletedTaskDetails({ task, busy, now, metadata = null, onReopen, onTrash, onComplete, onNewTask, onEdit, onBack, onLocate }: {
  task: Task; busy: boolean; now: number; metadata?: TaskMetadata | null; onReopen: () => void; onTrash: () => void; onComplete: () => void; onNewTask: () => void; onEdit?: () => void; onBack?: () => void; onLocate?: () => void;
}) {
  const editable = taskResultEditable(task, now, metadata);
  const notCompleted = taskListStatus(task) === "not_completed";
  const utilityActions = !notCompleted && task.status !== "deleted"
    ? <button type="button" className="secondary-action task-detail-utility-btn" disabled={busy} onClick={onNewTask}><Icon name="plus" size={14} />基于此新建</button>
    : undefined;
  return <TaskDetailContent task={task} metadata={metadata} busy={busy} utilityActions={utilityActions} onBack={onBack}>
    <div className="task-detail-primary-actions">
      {notCompleted ? (
        <button type="button" className="task-compact-complete" disabled={busy} onClick={onNewTask}><Icon name="plus" size={15} />基于此新建</button>
      ) : (
        <button type="button" className={task.status === "done" ? "secondary-action" : "task-compact-complete"} disabled={busy || !editable} title={!editable ? historicalTaskCompletionLocked(task, now) ? HISTORY_COMPLETION_LOCKED_MESSAGE : "已超过结果修改时间" : undefined} onClick={task.status === "done" ? onReopen : onComplete}><Icon name={task.status === "done" ? "restore" : "check"} size={15} />{task.status === "done" ? task.earliest_start_date && task.due_date && task.earliest_start_date < task.due_date ? "取消整体完成" : "取消完成" : task.earliest_start_date && task.due_date && task.earliest_start_date < task.due_date ? "完成整个任务" : "完成任务"}</button>
      )}
      {onEdit && taskIsEditable(task) && <button type="button" className="secondary-action" disabled={busy} onClick={onEdit}><Icon name="file" size={14} />编辑任务</button>}
      {onLocate && <button type="button" className="secondary-action" disabled={busy} title="前往对应日期，在时间线中高亮任务块" onClick={onLocate}><Icon name="locate" size={14} />定位任务块</button>}
    </div>
    <button type="button" className="terminal-task-trash" disabled={busy} onClick={onTrash}><Icon name="trash" size={14} />移入回收站</button>
  </TaskDetailContent>;
}

function TaskCompletionDialog({ task, note, busy, error, onNoteChange, onCancel, onConfirm }: {
  task: Task; note: string; busy: boolean; error: string | null; onNoteChange: (note: string) => void; onCancel: () => void; onConfirm: () => void;
}) {
  return <div className="dialog-backdrop task-completion-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <ConfirmationDialog role="dialog" aria-modal="true" aria-labelledby="task-completion-heading task-completion-title" initialFocus="textarea:not(:disabled)" busy={busy} onCancel={onCancel}>
      <form onSubmit={(event) => { event.preventDefault(); if (!busy) onConfirm(); }}>
        <header className="task-completion-header"><h2 id="task-completion-title" title={task.title}>{task.title}</h2><p className="task-completion-heading" id="task-completion-heading">{task.earliest_start_date && task.due_date && task.earliest_start_date < task.due_date ? "完成整个任务" : "完成任务"}</p></header>
        <div className="task-completion-body">
          <label className="task-completion-note"><span><span>备注 <small>选填</small></span><span className="task-completion-count" aria-hidden="true">{note.length} / 500</span></span><textarea autoFocus value={note} maxLength={500} disabled={busy} placeholder="记录完成情况…" onChange={(event) => onNoteChange(event.target.value)} /></label>
          {error && <p className="task-completion-error" role="alert">{error}</p>}
        </div>
        <footer className="dialog-actions task-completion-actions"><button type="button" disabled={busy} onClick={onCancel}>取消</button><button type="submit" className="primary-action" disabled={busy}>{busy ? "正在完成…" : task.earliest_start_date && task.due_date && task.earliest_start_date < task.due_date ? "完成整个任务" : "完成任务"}</button></footer>
      </form>
    </ConfirmationDialog>
  </div>;
}

function MoveTaskToTrashDialog({
  title,
  description,
  busy,
  error,
  titleId,
  descriptionId,
  onCancel,
  onConfirm
}: {
  title: string;
  description: string;
  busy: boolean;
  error: string | null;
  titleId: string;
  descriptionId: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="dialog-backdrop task-trash-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} busy={busy} tone="caution" onCancel={() => { if (!busy) onCancel(); }}>
        <h2 id={titleId}>移入回收站？</h2>
        <div id={descriptionId} className="confirmation-body">
          <strong className="confirmation-object">{title}</strong>
          <p>{description}</p>
          {error && <p className="confirmation-error" role="alert">{error}</p>}
        </div>
        <div className="dialog-actions">
          <button type="button" autoFocus disabled={busy} onClick={onCancel}>取消</button>
          <button type="button" className="dialog-discard" disabled={busy} onClick={onConfirm}>{busy ? "正在移入…" : "移入回收站"}</button>
        </div>
      </ConfirmationDialog>
    </div>
  );
}

function TaskStatusDropdown({ id, view, counts, onSelect }: {
  id: string;
  view: TaskView;
  counts: Record<TaskView, number>;
  onSelect: (view: TaskView) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const active = view !== "all";
  const label = taskViewCopy[view];

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent | FocusEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return <div ref={rootRef} className={`task-status-filter task-filter-dropdown${open ? " is-open" : ""}`}>
    <div className={`task-filter-trigger-group${active ? " is-active" : ""}`} data-status-color={active ? view : undefined}>
      <button
        ref={triggerRef}
        type="button"
        className={`task-filter-trigger${active ? " is-active" : ""}${open ? " is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={active ? `状态筛选：${taskViewCopy[view]}` : "状态筛选"}
        title={active ? `状态：${taskViewCopy[view]}` : "按状态筛选"}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="filter" size={13} />
        <span className="task-filter-trigger-label">{label}</span>
        {!active && <svg className="task-filter-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>}
      </button>
      {active && <button
        type="button"
        className="task-filter-clear"
        aria-label="重置状态为全部任务"
        title="显示全部任务"
        onClick={() => { onSelect("all"); setOpen(false); }}
      ><Icon name="close" size={11} /></button>}
    </div>
    {open && <div id={id} className="task-filter-popover task-status-filter-popover" role="listbox" aria-label="任务状态筛选">
      <div className="task-filter-popover-list">
        {taskStatusFilterOrder.map((item) => {
          const selected = view === item;
          return <button
            key={item}
            type="button"
            role="option"
            aria-selected={selected}
            className={`task-filter-option${selected ? " is-selected" : ""}`}
            data-status-color={item}
            onClick={() => { onSelect(item); setOpen(false); }}
          >
            <span className="task-filter-option-name">{taskViewCopy[item]}</span>
            <span className="task-filter-option-meta">
              <span className="task-filter-option-count">{counts[item]}</span>
              {selected && <span className="task-filter-check" aria-hidden="true">✓</span>}
            </span>
          </button>;
        })}
      </div>
    </div>}
  </div>;
}

function TaskWorkspace({
  tasks,
  recurringItems,
  loading,
  error,
  onReload,
  onTaskCommitted,
  onRecurringChanged,
  today,
  onDirtyChange,
  externalNavigationRequest,
  onExternalNavigationResolved,
  requestedView,
  onViewChange,
  onDraftCountChange,
  timelineReturnContext,
  onReturnToTimeline,
  onOpenToday
}: {
  tasks: Task[];
  recurringItems: RecurringItem[];
  loading: boolean;
  error: string | null;
  onReload: (showLoading?: boolean) => Promise<void>;
  onTaskCommitted: (task: Task) => void;
  onRecurringChanged: () => Promise<void>;
  today: string;
  onDirtyChange: (dirty: boolean) => void;
  externalNavigationRequest: NavigationIntent | null;
  onExternalNavigationResolved: (proceed: boolean) => void;
  requestedView: TaskViewRequest | null;
  onViewChange: (view: TaskView) => void;
  onDraftCountChange: (count: number) => void;
  timelineReturnContext: TimelineReturnContext | null;
  onReturnToTimeline: (context: TimelineReturnContext) => void;
  onOpenToday: (date?: string, taskId?: string) => void;
}) {
  const [view, setView] = useState<TaskView>("scheduled");
  useEffect(() => { onViewChange(view); }, [view, onViewChange]);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ManualTaskUpdate | null>(null);
  const [compactTaskEditorDismissed, setCompactTaskEditorDismissed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createItemType, setCreateItemType] = useState<CreateItemType>("task");
  const initialCreateItemType = useRef<CreateItemType>("task");
  const initialRecurringForm = useRef<RecurringItemForm>(recurringItemDefaultForm(today));
  const [recurringForm, setRecurringForm] = useState<RecurringItemForm>(initialRecurringForm.current);
  const [selectedRecurringId, setSelectedRecurringId] = useState<string | null>(null);
  const [recurringDetailEditing, setRecurringDetailEditing] = useState(false);
  const [recurringTarget, setRecurringTarget] = useState<RecurringOccurrence | null>(null);
  const [recurringTargetLoading, setRecurringTargetLoading] = useState(false);
  const [recurringEditBaseline, setRecurringEditBaseline] = useState<RecurringItemForm | null>(null);
  const [recurringEditRevision, setRecurringEditRevision] = useState(0);
  const [pendingItemChange, setPendingItemChange] = useState<RecurringScheduleChange | null>(null);
  const [recurringScopeError, setRecurringScopeError] = useState("");
  const initialNewTaskForm = useRef<NewTaskForm>(newTaskDefaultForm());
  const [newTaskForm, setNewTaskForm] = useState<NewTaskForm>(initialNewTaskForm.current);
  const [newTaskAutosaveArmed, setNewTaskAutosaveArmed] = useState(false);
  const newTaskEditRevision = useRef(0);
  const [persistedNewTaskDraft, setPersistedNewTaskDraft] = useState<TaskDraft | null>(null);
  const persistedNewTaskDraftRef = useRef<TaskDraft | null>(null);
  useEffect(() => {
    persistedNewTaskDraftRef.current = persistedNewTaskDraft;
  }, [persistedNewTaskDraft]);
  const [taskDetailEditing, setTaskDetailEditing] = useState(false);
  const pendingTaskEdit = useRef<string | null>(null);
  const [taskDrafts, setTaskDrafts] = useState<TaskDraft[]>([]);
  const [taskDraftsLoading, setTaskDraftsLoading] = useState(true);
  useEffect(() => { if (!taskDraftsLoading) onDraftCountChange(taskDrafts.length); }, [taskDrafts, taskDraftsLoading, onDraftCountChange]);
  const [draftSaving, setDraftSaving] = useState(false);
  const [newTaskError, setNewTaskError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<{ id: number; message: string; undoId?: string; openToday?: boolean; date?: string; taskId?: string } | null>(null);
  const [completionNote, setCompletionNote] = useState("");
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [taskMetadataRevision, setTaskMetadataRevision] = useState(0);
  const [pendingCompletion, setPendingCompletion] = useState(false);
  const [pendingTrashTask, setPendingTrashTask] = useState<{ id: string; title: string } | null>(null);
  const [trashTaskError, setTrashTaskError] = useState<string | null>(null);
  const [pendingDiscardTaskDraft, setPendingDiscardTaskDraft] = useState<TaskDraft | null>(null);
  const [discardDraftError, setDiscardDraftError] = useState<string | null>(null);
  const [pendingEndRecurringItem, setPendingEndRecurringItem] = useState<RecurringItem | null>(null);
  const [endRecurringError, setEndRecurringError] = useState<string | null>(null);
  const [pendingTrashRecurringItem, setPendingTrashRecurringItem] = useState<RecurringItem | null>(null);
  const [trashRecurringError, setTrashRecurringError] = useState<string | null>(null);
  const preferredSelection = useRef<string | null>(null);
  const ledgerRef = useRef<HTMLDivElement>(null);
  const ledgerResizeSession = useRef<LedgerResizeSession | null>(null);
  const [ledgerListWidth, setLedgerListWidth] = useState<number | null>(null);
  const [ledgerMaximumWidth, setLedgerMaximumWidth] = useState(TASK_LEDGER_LIST_DEFAULT_WIDTH);
  const [resizingLedger, setResizingLedger] = useState(false);
  const [pendingTaskChange, setPendingTaskChange] = useState<PendingTaskChange | null>(null);
  const [taskMetadata, setTaskMetadata] = useState<TaskMetadata | null>(null);
  const initialTaskMetadata = useRef<TaskMetadata | null>(null);
  const [pendingRecurringSave, setPendingRecurringSave] = useState<TaskDraftInput | null>(null);
  const [recurringSaveError, setRecurringSaveError] = useState<string | null>(null);
  const [pendingDiscardNew, setPendingDiscardNew] = useState(false);
  const [discardNewError, setDiscardNewError] = useState<string | null>(null);
  const [pendingHistoricalCreation, setPendingHistoricalCreation] = useState<{ title: string; input: string; untimed: boolean } | null>(null);
  const [historicalCreationError, setHistoricalCreationError] = useState<string | null>(null);
  const [pendingPermanentTask, setPendingPermanentTask] = useState<Task | null>(null);
  const [pendingPermanentRecurringItem, setPendingPermanentRecurringItem] = useState<RecurringItem | null>(null);
  const [permanentDeleteError, setPermanentDeleteError] = useState<string | null>(null);
  const handledRequestedView = useRef<TaskViewRequest | null>(null);
  const preparingIndependent = useRef(false);
  const resultNow = useResultNow();
  const taskViewInitialized = useRef(false);
  const [taskViewReady, setTaskViewReady] = useState(false);
  const [recycleNow, setRecycleNow] = useState(() => Date.now());
  const availableTags = useMemo(() => uniqueTags([...tasks.flatMap((task) => task.tags), ...recurringItems.flatMap((item) => item.tags), ...taskDrafts.flatMap((item) => item.tags)]).sort((a, b) => a.localeCompare(b, "zh-CN")), [tasks, recurringItems, taskDrafts]);

  useLayoutEffect(() => {
    ledgerRef.current?.querySelector(".task-ledger-scroll")?.scrollTo({ top: 0 });
  }, [view, search, tagFilter]);

  useEffect(() => {
    if (!requestedView || handledRequestedView.current === requestedView) return;
    if (requestedView.taskSeed) {
      handledRequestedView.current = requestedView;
      taskViewInitialized.current = true;
      setTaskViewReady(true);
      void openIndependentDraft(requestedView.taskSeed);
    } else if (requestedView.recurringItemId) {
      const target = recurringItems.find((item) => item.id === requestedView.recurringItemId);
      if (target) {
        setView(target.deleted_at ? "deleted" : "recurring");
        setCreating(false);
        setSelectedId(null);
        setDraft(null);
        setSelectedRecurringId(target.id);
        setRecurringDetailEditing(false);
        setSearch("");
        setTagFilter("");
        setCompactTaskEditorDismissed(false);
        handledRequestedView.current = requestedView;
        taskViewInitialized.current = true;
        setTaskViewReady(true);
      }
    } else if (requestedView.taskId) {
      const target = tasks.find((task) => task.id === requestedView.taskId);
      if (target) {
        preferredSelection.current = target.id;
        setView(taskListStatus(target));
        setCreating(false);
        setSelectedId(target.id);
        setDraft(draftForTask(target));
        setCompactTaskEditorDismissed(false);
        if (requestedView.completeOnOpen) { setCompletionNote(""); setCompletionError(null); setPendingCompletion(true); }
        handledRequestedView.current = requestedView;
        taskViewInitialized.current = true;
        setTaskViewReady(true);
      }
    } else if (requestedView.createTask) {
      const defaults = newTaskDefaultForm();
      const initialType: CreateItemType = view === "recurring" ? "recurring" : "task";
      const recurringDefaults = recurringItemDefaultForm(today);
      setView("draft");
      setCreating(true);
      setCreateItemType(initialType);
      initialCreateItemType.current = initialType;
      initialNewTaskForm.current = defaults;
      setNewTaskForm(defaults);
      initialRecurringForm.current = recurringDefaults;
      setRecurringForm(recurringDefaults);
      newTaskEditRevision.current = 0;
      setNewTaskAutosaveArmed(false);
      persistedNewTaskDraftRef.current = null;
      setPersistedNewTaskDraft(null);
      setNewTaskError(null);
      setFeedback(null);
      setSelectedId(null);
      setDraft(null);
      setCompactTaskEditorDismissed(false);
      handledRequestedView.current = requestedView;
      taskViewInitialized.current = true;
      setTaskViewReady(true);
      window.requestAnimationFrame(() => {
        document.getElementById(initialType === "recurring" ? "new-recurring-title" : "new-task-title")?.focus();
      });
    } else if (requestedView.view) {
      setView(requestedView.view);
      setCreating(false);
      setSelectedId(null);
      setDraft(null);
      setCompactTaskEditorDismissed(false);
      handledRequestedView.current = requestedView;
      taskViewInitialized.current = true;
      setTaskViewReady(true);
    }
  }, [requestedView, tasks, recurringItems]);


  const visibleTasks = useMemo(() => tasks.filter((task) => taskMatchesView(task, view)
    && matchesTag(task.tags, tagFilter) && matchesTaggedSearch(task, search)), [tasks, view, search, tagFilter]);
  const visibleTaskDrafts = useMemo(() => view !== "draft" ? [] : taskDrafts.filter((item) =>
    matchesTag(item.tags, tagFilter) && matchesTaggedSearch(item, search)), [taskDrafts, view, search, tagFilter]);
  const visibleRecurringItems = useMemo(() => {
    if (view !== "recurring" && view !== "deleted") return [];
    return recurringItems.filter((item) => (view === "deleted" ? Boolean(item.deleted_at) : !item.deleted_at)
      && matchesTag(item.tags, tagFilter) && matchesTaggedSearch(item, search));
  }, [recurringItems, view, search, tagFilter]);
  const selectedTask = tasks.find((task) => task.id === selectedId) ?? null;
  const selectedRecurringItem = recurringItems.find((item) => item.id === selectedRecurringId) ?? null;
  const selectedRecycleTimestamp = selectedTask?.status === "deleted"
    ? selectedTask.deleted_at
    : selectedRecurringItem?.deleted_at ?? null;
  const metadataDirty = Boolean(taskMetadata && initialTaskMetadata.current
    && taskMetadata.task_id === selectedTask?.id && initialTaskMetadata.current.task_id === selectedTask?.id
    && JSON.stringify({ tags: taskMetadata.tags, recurrence: taskMetadata.recurrence })
      !== JSON.stringify({ tags: initialTaskMetadata.current.tags, recurrence: initialTaskMetadata.current.recurrence }));
  const isDirty = taskIsEditable(selectedTask) && (!draftMatchesTask(draft, selectedTask) || metadataDirty);
  const recurringFormIsDirty = creating && JSON.stringify(recurringForm) !== JSON.stringify(initialRecurringForm.current);
  const newTaskFieldsAreDirty = !newTaskFormMatches(newTaskForm, initialNewTaskForm.current) || recurringFormIsDirty;
  const newTaskIsDirty = creating && (createItemType !== initialCreateItemType.current || newTaskFieldsAreDirty);
  const recurringEditingDirty = !creating && recurringDetailEditing && view === "recurring" && selectedRecurringItem
    ? Boolean(recurringEditBaseline && JSON.stringify(recurringForm) !== JSON.stringify(recurringEditBaseline))
    : false;
  const hasUnsavedChanges = isDirty || newTaskIsDirty || recurringEditingDirty;
  const newTaskHasCompleteSchedule = taskScheduleIsComplete(newTaskForm);
  const newTaskHasValidRange = taskRangeIsValid(newTaskForm);
  const newTaskHasValidWorkload = taskWorkloadIsValid(newTaskForm);
  const newTaskIsHistoricalCreation = createItemType === "task" && persistedNewTaskDraft?.draft_kind !== "update" && isHistoricalResultDate(newTaskForm.due_date, resultNow);
  const newTaskHistoryError = createItemType === "task" && persistedNewTaskDraft?.draft_kind !== "update" ? historicalTaskCreationError(newTaskForm, resultNow) : null;
  const selectedMetadata = taskMetadata?.task_id === selectedTask?.id ? taskMetadata : null;
  const selectedTaskLocationDate = taskBlockLocationDate(selectedTask, today);
  const editingTaskForm = draft ? {
    ...taskFormForManualUpdate(draft),
    tags: selectedMetadata?.tags ?? selectedTask?.tags ?? [],
    recurrence: selectedMetadata?.recurrence ?? null
  } : null;
  const editingTaskHasValidRange = editingTaskForm ? taskRangeIsValid(editingTaskForm) : true;
  const editingTaskHasCompleteSchedule = editingTaskForm ? taskScheduleIsComplete(editingTaskForm) : true;
  const editingTaskHasValidWorkload = editingTaskForm ? taskWorkloadIsValid(editingTaskForm) : true;
  function updateNewTaskFields(next: NewTaskForm) {
    setPendingHistoricalCreation(null);
    setHistoricalCreationError(null);
    newTaskEditRevision.current += 1;
    setNewTaskAutosaveArmed(true);
    setNewTaskForm(next);
  }

  function applyCreateItemType(type: CreateItemType) {
    if (!creating || busy || draftSaving || type === createItemType || persistedNewTaskDraft?.target_task_id) return;
    setPendingHistoricalCreation(null);
    setHistoricalCreationError(null);
    if (type === "task") setNewTaskForm((current) => syncFormCommonFields(current, recurringForm));
    else setRecurringForm((current) => syncFormCommonFields(current, newTaskForm));
    setCreateItemType(type);
    setNewTaskError(null);
  }

  function requestCreateItemType(type: CreateItemType) {
    applyCreateItemType(type);
  }

  function currentCreationInput(): TaskDraftInput {
    const common = createItemType === "task" ? newTaskForm : recurringForm;
    const { title: _title, notes: _notes, tags: _tags, ...settings } = recurringItemInputForForm(recurringForm);
    return {
      ...taskDraftInputForForm(syncFormCommonFields(newTaskForm, common)),
      item_type: createItemType,
      recurring_settings: settings
    };
  }

  function updateEditingTaskForm(next: NewTaskForm) {
    setDraft(manualUpdateForTaskForm(next));
    if (selectedTask) setTaskMetadata((current) => ({ ...current, task_id: selectedTask.id, tags: next.tags, recurrence: next.recurrence }));
  }

  function updateEditingTaskSchedule(next: NewTaskForm) {
    if (!editingTaskForm) return;
    updateEditingTaskForm(normalizeTaskWorkloadAfterScheduleChange(editingTaskForm, next));
  }

  function updateNewTaskSchedule(next: NewTaskForm) {
    setPendingHistoricalCreation(null);
    setHistoricalCreationError(null);
    newTaskEditRevision.current += 1;
    setNewTaskAutosaveArmed(true);
    setNewTaskForm(normalizeTaskWorkloadAfterScheduleChange(newTaskForm, next));
  }

  useEffect(() => { onDirtyChange(hasUnsavedChanges); }, [hasUnsavedChanges, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  async function refreshTaskDrafts() {
    setTaskDraftsLoading(true);
    try {
      const legacy = loadStoredRecurringDraft();
      if (legacy) {
        const { title: _title, notes: _notes, tags: _tags, ...settings } = recurringItemInputForForm(legacy);
        await importLegacyRecurringDraft({
          ...taskDraftInputForForm(syncFormCommonFields(emptyNewTaskForm(), legacy)),
          item_type: "recurring", recurring_settings: settings
        });
        localStorage.removeItem(RECURRING_DRAFT_KEY);
      }
      setTaskDrafts(await listTaskDrafts(false));
    } catch (reason) {
      setFeedback(`草稿暂时无法打开：${uiErrorMessage(reason)}`);
    } finally {
      setTaskDraftsLoading(false);
    }
  }

  useEffect(() => { void refreshTaskDrafts(); }, []);

  async function persistCurrentTaskDraft(showFeedback = false, skipMinDuration = false) {
    if (!creating) return persistedNewTaskDraftRef.current ?? persistedNewTaskDraft;
    const currentDraft = persistedNewTaskDraftRef.current ?? persistedNewTaskDraft;
    if (!newTaskIsDirty && currentDraft) return currentDraft;
    if (!currentDraft && !newTaskFieldsAreDirty) return null;
    const input = currentCreationInput();
    const editRevision = newTaskEditRevision.current;
    const startTime = Date.now();
    setDraftSaving(true);
    try {
      const saved = currentDraft
        ? await saveTaskDraft(currentDraft.id, currentDraft.version, input)
        : await createManualTaskDraft(input);
      persistedNewTaskDraftRef.current = saved;
      setPersistedNewTaskDraft(saved);
      setTaskDrafts((current) => {
        const exists = current.some((item) => item.id === saved.id);
        if (exists) {
          return current.map((item) => (item.id === saved.id ? saved : item));
        }
        return [saved, ...current];
      });
      initialNewTaskForm.current = newTaskForm;
      initialRecurringForm.current = recurringForm;
      initialCreateItemType.current = createItemType;
      if (newTaskEditRevision.current === editRevision) setNewTaskAutosaveArmed(false);
      if (showFeedback) setFeedback(null);
      return saved;
    } catch (reason) {
      setNewTaskError(`草稿未保存：${uiErrorMessage(reason)}`);
      return null;
    } finally {
      if (!skipMinDuration) {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, 260 - elapsed);
        if (remaining > 0) {
          await new Promise((resolve) => setTimeout(resolve, remaining));
        }
      }
      setDraftSaving(false);
    }
  }

  useEffect(() => {
    if (!creating || !newTaskIsDirty || !newTaskAutosaveArmed || busy || draftSaving) return;
    const timer = window.setTimeout(() => { void persistCurrentTaskDraft(false); }, 500);
    return () => window.clearTimeout(timer);
  }, [creating, createItemType, newTaskForm, recurringForm, newTaskIsDirty, newTaskAutosaveArmed, busy, draftSaving, persistedNewTaskDraft?.id, persistedNewTaskDraft?.version]);

  async function saveNewTaskBeforeLeaving() {
    if (!newTaskIsDirty || (!persistedNewTaskDraft && !newTaskFieldsAreDirty)) return true;
    return Boolean(await persistCurrentTaskDraft(false, true));
  }


  async function showCommittedToast(message: string, openToday = false, date?: string, taskId?: string, allowUndo = true) {
    const undo = allowUndo ? await latestUndo().catch(() => null) : null;
    setSuccessToast({ id: Date.now(), message, undoId: undo?.id, openToday, date, taskId });
  }

  async function undoLastChange(undoId: string) {
    try {
      await applyUndo(undoId);
      setSuccessToast(null);
      setTaskMetadataRevision((revision) => revision + 1);
      await onRecurringChanged();
      setSelectedId(null);
      setDraft(null);
      setFeedback("已撤销上一项操作。");
    } catch (reason) {
      setSuccessToast(null);
      setFeedback(`无法撤销：${uiErrorMessage(reason)}`);
    }
  }

  useEffect(() => {
    if (creating) return;
    if (view === "draft" || view === "recurring") { setSelectedId(null); return; }
    if (view === "deleted") return;
    if (isDirty && selectedTask) return;
    if (compactTaskEditorDismissed) return;
    if (preferredSelection.current) {
      if (visibleTasks.some((task) => task.id === preferredSelection.current)) {
        setSelectedId(preferredSelection.current);
        if (selectedId === preferredSelection.current) preferredSelection.current = null;
      }
      return;
    }
    if (!visibleTasks.some((task) => task.id === selectedId)) setSelectedId(visibleTasks[0]?.id ?? null);
  }, [view, visibleTasks, selectedId, isDirty, selectedTask, creating, compactTaskEditorDismissed]);

  useEffect(() => {
    if (view !== "draft") return;
    if (compactTaskEditorDismissed) return;
    if (creating && !persistedNewTaskDraft) return;
    if (creating && persistedNewTaskDraft) {
      if (visibleTaskDrafts.some((item) => item.id === persistedNewTaskDraft.id)) return;
    }
    const firstDraft = visibleTaskDrafts[0];
    if (firstDraft) {
      void openPersistedTaskDraft(firstDraft);
    }
  }, [view, creating, persistedNewTaskDraft, visibleTaskDrafts, compactTaskEditorDismissed]);

  useEffect(() => {
    if (creating || view !== "recurring") return;
    const selected = visibleRecurringItems.find((item) => item.id === selectedRecurringId) ?? visibleRecurringItems[0] ?? null;
    setSelectedRecurringId(selected?.id ?? null);
  }, [view, creating, selectedRecurringId, visibleRecurringItems]);

  useEffect(() => {
    setRecurringDetailEditing(false);
  }, [selectedRecurringItem?.id, selectedRecurringItem?.status, selectedRecurringItem?.deleted_at, view]);

  useEffect(() => {
    if (creating || view !== "recurring" || !selectedRecurringItem) return;
    let cancelled = false;
    const item = selectedRecurringItem;
    setRecurringTarget(null);
    setRecurringEditBaseline(null);
    setRecurringForm(recurringItemFormForItem(item));
    setRecurringTargetLoading(true);
    const loadTarget = async () => {
      try {
        const target = item.status === "ended" || item.deleted_at ? null : await resolveRecurringEditTarget(item.id);
        if (cancelled) return;
        const form = recurringFormForOccurrence(item, target);
        setRecurringTarget(target);
        setRecurringForm(form);
        setRecurringEditBaseline(form);
      } catch (reason) {
        if (!cancelled) setFeedback(`无法读取后续安排：${uiErrorMessage(reason)}`);
      } finally { if (!cancelled) setRecurringTargetLoading(false); }
    };
    void loadTarget();
    return () => { cancelled = true; };
  }, [view, creating, selectedRecurringItem, today, recurringEditRevision]);

  useEffect(() => {
    if (creating || view !== "deleted") return;
    if (selectedId && visibleTasks.some((task) => task.id === selectedId)) {
      if (selectedRecurringId) setSelectedRecurringId(null);
      return;
    }
    if (selectedRecurringId && visibleRecurringItems.some((item) => item.id === selectedRecurringId)) {
      if (selectedId) setSelectedId(null);
      return;
    }
    const task = visibleTasks[0];
    const recurringItem = visibleRecurringItems[0];
    setSelectedId(task?.id ?? null);
    setSelectedRecurringId(task ? null : recurringItem?.id ?? null);
    if (recurringItem && !task) setRecurringForm(recurringItemFormForItem(recurringItem));
  }, [view, creating, selectedId, selectedRecurringId, visibleTasks, visibleRecurringItems]);

  useEffect(() => {
    if (!selectedTask) { setDraft(null); setTaskDetailEditing(false); return; }
    setDraft(draftForTask(selectedTask));
    setTaskDetailEditing(pendingTaskEdit.current === selectedTask.id);
    pendingTaskEdit.current = null;
  }, [selectedTask?.id, selectedTask?.updated_at, selectedTask?.execution_locked]);

  useEffect(() => {
    if (!selectedRecycleTimestamp) return;
    setRecycleNow(Date.now());
    const interval = window.setInterval(() => setRecycleNow(Date.now()), 60 * 1000);
    return () => window.clearInterval(interval);
  }, [selectedRecycleTimestamp]);

  useEffect(() => {
    if (!selectedTask) {
      setTaskMetadata(null);
      initialTaskMetadata.current = null;
      return;
    }
    let active = true;
    void getTaskMetadata(selectedTask.id).then((metadata) => {
      if (!active) return;
      setTaskMetadata(metadata);
      initialTaskMetadata.current = metadata;
    }).catch((reason) => { if (active) setFeedback(`任务详情暂时无法打开：${uiErrorMessage(reason)}`); });
    return () => { active = false; };
  }, [selectedTask?.id, selectedTask?.updated_at, selectedTask?.execution_locked, taskMetadataRevision]);

  useEffect(() => {
    let active = true;
    void getUiSetting(TASK_LEDGER_WIDTH_SETTING).then((value) => {
      const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
      if (active && Number.isFinite(parsed)) setConstrainedLedgerWidth(parsed);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const ledger = ledgerRef.current;
    if (!ledger || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const maximum = Math.max(TASK_LEDGER_LIST_MIN_WIDTH, ledger.clientWidth - TASK_LEDGER_INSPECTOR_MIN_WIDTH - TASK_LEDGER_HANDLE_WIDTH);
      setLedgerMaximumWidth(maximum);
      setLedgerListWidth((current) => {
        if (current === null) return Math.min(maximum, TASK_LEDGER_LIST_DEFAULT_WIDTH);
        return Math.max(TASK_LEDGER_LIST_MIN_WIDTH, Math.min(current, maximum));
      });
    });
    observer.observe(ledger);
    return () => observer.disconnect();
  }, []);

  const counts = useMemo(() => taskViewCounts(tasks, taskDrafts.length, recurringItems), [tasks, taskDrafts, recurringItems]);
  const tagCounts = useMemo(() => {
    const countsByTag: Record<string, number> = {};
    const addTags = (itemTags: string[]) => {
      for (const raw of uniqueTags(itemTags)) {
        const key = tagKey(raw);
        countsByTag[key] = (countsByTag[key] ?? 0) + 1;
      }
    };
    if (view === "draft") {
      taskDrafts.filter((item) => matchesTaggedSearch(item, search)).forEach((item) => addTags(item.tags));
    } else if (view === "recurring") {
      recurringItems.filter((item) => !item.deleted_at && matchesTaggedSearch(item, search)).forEach((item) => addTags(item.tags));
    } else if (view === "deleted") {
      tasks.filter((task) => taskMatchesView(task, "deleted") && matchesTaggedSearch(task, search)).forEach((task) => addTags(task.tags));
      recurringItems.filter((item) => Boolean(item.deleted_at) && matchesTaggedSearch(item, search)).forEach((item) => addTags(item.tags));
    } else {
      tasks.filter((task) => taskMatchesView(task, view) && matchesTaggedSearch(task, search)).forEach((task) => addTags(task.tags));
    }
    return countsByTag;
  }, [tasks, taskDrafts, recurringItems, view, search]);
  const showUnsavedCreateCapsule = creating && view === "draft"
    && !persistedNewTaskDraft;

  useEffect(() => {
    if (loading || taskViewInitialized.current || requestedView) return;
    taskViewInitialized.current = true;
    const operationalViews: TaskView[] = ["scheduled", "not_completed"];
    void getUiSetting(TASK_QUEUE_VIEW_SETTING).then((stored) => {
      if (handledRequestedView.current) return;
      const normalizedStored = stored === "open" ? "scheduled" : stored;
      const preferred = normalizedStored && Object.hasOwn(taskViewCopy, normalizedStored) ? normalizedStored as TaskView : null;
      const next = preferred ?? operationalViews.find((candidate) => counts[candidate] > 0) ?? "scheduled";
      setView(next);
      setTaskViewReady(true);
    }).catch(() => {
      if (handledRequestedView.current) return;
      setView(operationalViews.find((candidate) => counts[candidate] > 0) ?? "scheduled");
      setTaskViewReady(true);
    });
  }, [loading, requestedView, counts]);

  useEffect(() => {
    if (!taskViewReady) return;
    void setUiSetting(TASK_QUEUE_VIEW_SETTING, view).catch(() => undefined);
  }, [view, taskViewReady]);

  async function commitDraft(scope?: "this" | "future") {
    if (!taskIsEditable(selectedTask)) return false;
    if (!selectedTask || !draft || busy || !isDirty) return !isDirty;
    if (!selectedMetadata) { setFeedback("任务标签正在加载，请稍后再保存。"); return false; }
    const form = editingTaskForm;
    if (!form) return false;
    if (!taskScheduleIsComplete(form)) {
      setFeedback("请先填写完整的任务日期（如填写具体时刻，开始和结束时刻需同时完整）。");
      return false;
    }
    if (!taskRangeIsValid(form)) {
      setFeedback(`任务时间至少需要 ${MIN_TASK_WORKLOAD_MINUTES} 分钟。`);
      return false;
    }
    if (!taskWorkloadIsValid(form)) {
      setFeedback(form.estimated_minutes === null
        ? `跨日指定时刻任务必须填写平均每日投入（至少 ${MIN_TASK_WORKLOAD_MINUTES} 分钟）。`
        : `平均每天至少投入 ${MIN_TASK_WORKLOAD_MINUTES} 分钟。`);
      return false;
    }
    let input = taskDraftInputForForm(form);
    if (scope === "future" && input.recurrence && selectedTask.earliest_start_date) {
      input = { ...input, recurrence: { ...input.recurrence, starts_on: selectedTask.earliest_start_date } };
    }
    if (initialTaskMetadata.current?.recurrence && !scope) {
      setRecurringSaveError(null);
      setPendingRecurringSave(input);
      return false;
    }
    setBusy(true);
    setRecurringSaveError(null);
    setSuccessToast(null);
    try {
      const committed = scope
        ? await updateRecurringTask(selectedTask.id, input, scope)
        : await updateManualTask(selectedTask.id, {
            ...draft,
            title: draft.title.trim(),
            notes: draft.notes?.trim() || null,
            earliest_start_at: toShanghaiTimestamp(draft.earliest_start_at ?? ""),
            due_at: toShanghaiTimestamp(draft.due_at ?? ""),
            earliest_start_date: draft.earliest_start_date || draft.earliest_start_at?.slice(0, 10) || null,
            due_date: draft.due_date || draft.due_at?.slice(0, 10) || null
          }, form.tags);
      const metadata = await getTaskMetadata(selectedTask.id);
      setTaskMetadata(metadata);
      initialTaskMetadata.current = metadata;
      onTaskCommitted({ ...committed, tags: metadata.tags });
      if (!taskMatchesView(committed, view)) {
        preferredSelection.current = committed.id;
        setView(taskListStatus(committed));
      }
      setDraft(draftForTask(committed));
      setPendingRecurringSave(null);
      setRecurringSaveError(null);
      setFeedback(null);
      await showCommittedToast("任务更改已保存", ["open", "scheduled"].includes(committed.status), committed.scheduled_dates?.[0] ?? committed.earliest_start_date ?? undefined, committed.id);
      return true;
    } catch (reason) {
      const errorText = `未保存：${uiErrorMessage(reason)}`;
      if (scope) setRecurringSaveError(errorText);
      else setFeedback(errorText);
      return false;
    } finally { setBusy(false); }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void commitDraft();
  }

  function clearNewTaskForm() {
    setPendingHistoricalCreation(null);
    setHistoricalCreationError(null);
    setPendingDiscardNew(false);
    setDiscardNewError(null);
    setCreating(false);
    newTaskEditRevision.current = 0;
    const empty = emptyNewTaskForm();
    initialNewTaskForm.current = empty;
    setNewTaskForm(empty);
    setNewTaskAutosaveArmed(false);
    persistedNewTaskDraftRef.current = null;
    setPersistedNewTaskDraft(null);
    setNewTaskError(null);
    setCreateItemType("task");
    initialCreateItemType.current = "task";
    const recurringDefaults = recurringItemDefaultForm(today);
    initialRecurringForm.current = recurringDefaults;
    setRecurringForm(recurringDefaults);
  }

  async function commitNewTask(confirmedHistoricalInput: string | null = null) {
    if (busy || draftSaving) return false;
    const input = currentCreationInput();
    const editRevision = newTaskEditRevision.current;
    if (!input.title.trim()) return false;
    const historyError = createItemType === "task" && persistedNewTaskDraft?.draft_kind !== "update" ? historicalTaskCreationError(input, Date.now()) : null;
    if (historyError) { setNewTaskError(historyError); return false; }
    if (createItemType === "task" && !newTaskHasCompleteSchedule) {
      setNewTaskError("请填写完整的任务日期（具体时刻可选）；当前内容仍可保存为草稿。");
      return false;
    }
    if (createItemType === "recurring") {
      const issue = recurringTimeBlockIssue(recurringForm);
      if (issue) { setNewTaskError(`${issue} 当前内容仍可保存为草稿。`); return false; }
      if (!recurringItemPreviewDates(recurringForm).length) {
        setNewTaskError("有效日期暂无匹配发生日，不能保存；当前内容仍可保存为草稿。");
        return false;
      }
    }
    if (createItemType === "task" && !newTaskHasValidWorkload) {
      setNewTaskError(newTaskForm.estimated_minutes === null
        ? `跨日指定时刻任务必须填写平均每日投入（至少 ${MIN_TASK_WORKLOAD_MINUTES} 分钟）；当前内容仍可保存为草稿。`
        : `平均每天至少投入 ${MIN_TASK_WORKLOAD_MINUTES} 分钟；当前内容仍可保存为草稿。`);
      return false;
    }
    if (createItemType === "task" && !newTaskHasValidRange) return false;
    setBusy(true);
    setSuccessToast(null);
    setNewTaskError(null);
    setHistoricalCreationError(null);
    try {
      const persisted = await persistCurrentTaskDraft(false, true);
      if (!persisted || newTaskEditRevision.current !== editRevision) return false;
      const persistedHistoryError = persisted.item_type !== "recurring" && persisted.draft_kind !== "update" ? historicalTaskCreationError(persisted, Date.now()) : null;
      if (persistedHistoryError) { setNewTaskError(persistedHistoryError); return false; }
      if (persisted.item_type !== "recurring" && persisted.draft_kind !== "update"
        && isHistoricalResultDate(persisted.due_date, Date.now())
        && confirmedHistoricalInput !== JSON.stringify(input)) {
        setHistoricalCreationError(null);
        setPendingHistoricalCreation({
          title: persisted.title,
          input: JSON.stringify(input),
          untimed: !persisted.earliest_start_time && !persisted.due_time
        });
        return false;
      }
      const result = await confirmCreationDraft(persisted);
      setPendingHistoricalCreation(null);
      setHistoricalCreationError(null);
      setTaskDrafts((current) => current.filter((item) => item.id !== persisted.id));
      if (result.item_type === "recurring") {
        await onRecurringChanged();
        setSearch("");
        setTagFilter("");
        setView("recurring");
        setSelectedRecurringId(result.item.id);
        clearNewTaskForm();
        setSuccessToast({ id: Date.now(), message: "重复事项已创建" });
      } else {
        clearNewTaskForm();
        preferredSelection.current = result.item.id;
        onTaskCommitted(result.item);
        setView(taskListStatus(result.item));
        setSelectedId(result.item.id);
        await onReload(false);
        await showCommittedToast(persisted.draft_kind === "update" ? "任务已更新" : historicalTaskCompletionLocked(result.item) ? "历史任务已创建并自动完成" : result.item.scheduled_dates.length > 0 ? "任务已创建并安排" : "任务已创建", ["open", "scheduled"].includes(result.item.status), result.item.scheduled_dates?.[0] ?? result.item.earliest_start_date ?? undefined, result.item.id, !historicalTaskCompletionLocked(result.item));
      }
      setFeedback(null);
      return true;
    } catch (reason) {
      const errorText = `草稿已保留，但尚未创建：${uiErrorMessage(reason)}`;
      if (confirmedHistoricalInput !== null) setHistoricalCreationError(errorText);
      else setNewTaskError(errorText);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function submitNewTask(event?: FormEvent) {
    event?.preventDefault();
    void commitNewTask();
  }

  async function cancelNewTask(requireConfirmation = true) {
    if (busy || draftSaving) return false;
    const hasContentOrDraft = Boolean(newTaskIsDirty || persistedNewTaskDraft || currentCreationInput().title.trim());
    if (requireConfirmation && hasContentOrDraft) {
      setDiscardNewError(null);
      setPendingDiscardNew(true);
      return false;
    }
    setDiscardNewError(null);
    if (persistedNewTaskDraft) {
      setBusy(true);
      try { await discardTaskDraft(persistedNewTaskDraft); }
      catch (reason) {
        const errorText = `草稿未能放弃：${uiErrorMessage(reason)}`;
        if (!requireConfirmation) setDiscardNewError(errorText);
        else setNewTaskError(errorText);
        return false;
      } finally { setBusy(false); }
    }
    clearNewTaskForm();
    await refreshTaskDrafts();
    if (hasContentOrDraft) {
      setSuccessToast({ id: Date.now(), message: "草稿已放弃" });
    }
    return true;
  }

  async function discardTaskDraftFromList(item: TaskDraft) {
    if (busy) return;
    setBusy(true);
    setDiscardDraftError(null);
    try {
      await discardTaskDraft(item);
      setTaskDrafts((current) => current.filter((candidate) => candidate.id !== item.id));
      if (persistedNewTaskDraft?.id === item.id) clearNewTaskForm();
      setPendingDiscardTaskDraft(null);
      setDiscardDraftError(null);
      setFeedback(null);
      setSuccessToast({ id: Date.now(), message: "草稿已放弃" });
    } catch (reason) {
      setDiscardDraftError(`草稿未能放弃：${uiErrorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function selectPersistedTaskDraft(item: TaskDraft) {
    if (busy || draftSaving || (creating && persistedNewTaskDraft?.id === item.id)) return;
    if (creating && !await saveNewTaskBeforeLeaving()) return;
    await openPersistedTaskDraft(item);
  }

  async function openPersistedTaskDraft(item: TaskDraft) {
    if (creating && persistedNewTaskDraft?.id === item.id) return;
    const form = taskFormForPersistedDraft(item);
    const recurring = recurringFormForDraft(item, today);
    initialRecurringForm.current = recurring;
    setRecurringForm(recurring);
    newTaskEditRevision.current = 0;
    setView("draft");
    setCreating(true);
    const type = item.item_type ?? "task";
    setCreateItemType(type);
    initialCreateItemType.current = type;
    setSelectedId(null);
    setDraft(null);
    persistedNewTaskDraftRef.current = item;
    setPersistedNewTaskDraft(item);
    initialNewTaskForm.current = form;
    setNewTaskForm(form);
    setNewTaskAutosaveArmed(false);
    setNewTaskError(null);
    setFeedback(null);
  }

  async function openIndependentDraft(seed: TaskSeed) {
    if (preparingIndependent.current) return;
    preparingIndependent.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const draft = await createManualTaskDraft(independentTaskDraft(seed, shanghaiDateValue()));
      setTaskDrafts((current) => [draft, ...current.filter((item) => item.id !== draft.id)]);
      await openPersistedTaskDraft(draft);
      setSearch("");
      setTagFilter("");
      setCompactTaskEditorDismissed(false);
    } catch (reason) { setFeedback(`新任务暂时无法创建：${uiErrorMessage(reason)}`); }
    finally { preparingIndependent.current = false; setBusy(false); }
  }

  async function transition(target: TaskStatus, note: string | null = null) {
    if (!selectedTask || busy) return;
    setBusy(true);
    if (target === "done") setCompletionError(null);
    try {
      preferredSelection.current = selectedTask.id;
      const committed = target === "done" ? await completeTask(selectedTask.id, null, note?.trim() || null) : await transitionManualTask(selectedTask.id, target);
      onTaskCommitted(committed);
      setTaskMetadataRevision((revision) => revision + 1);
      setPendingCompletion(false);
      setCompletionError(null);
      setView(taskListStatus(committed));
      await onReload(false);
      setSelectedId(selectedTask.id);
      setFeedback(target === "done" ? null : `任务已更新为“${statusCopy[taskListStatus(committed)]}”。`);
      if (target === "done") await showCommittedToast("任务已完成", false, undefined, undefined, !historicalTaskCompletionLocked(committed));
    } catch (reason) {
      preferredSelection.current = null;
      const message = `状态未改变：${uiErrorMessage(reason)}`;
      if (target === "done") setCompletionError(message);
      else setFeedback(message);
    }
    finally { setBusy(false); }
  }

  async function reopen() {
    if (!selectedTask || busy) return;
    if (!taskResultEditable(selectedTask, Date.now(), selectedMetadata)) {
      setFeedback(historicalTaskCompletionLocked(selectedTask, Date.now()) ? HISTORY_COMPLETION_LOCKED_MESSAGE : "已超过结果修改时间");
      return;
    }
    setBusy(true);
    try {
      preferredSelection.current = selectedTask.id;
      const committed = await reopenManualTask(selectedTask.id, today);
      onTaskCommitted(committed);
      setTaskMetadataRevision((revision) => revision + 1);
      setView(taskListStatus(committed));
      await onReload(false);
      setSelectedId(selectedTask.id);
      setFeedback(`“${selectedTask.title}”已取消完成，当前为${statusCopy[taskListStatus(committed)]}。`);
    } catch (reason) { preferredSelection.current = null; setFeedback(`状态未改变：${uiErrorMessage(reason)}`); }
    finally { setBusy(false); }
  }

  function requestMoveToTrash() {
    if (!selectedTask || busy) return;
    setTrashTaskError(null);
    setPendingTrashTask({ id: selectedTask.id, title: selectedTask.title });
  }

  async function moveToTrash() {
    if (!pendingTrashTask || busy) return;
    const target = pendingTrashTask;
    setBusy(true);
    setTrashTaskError(null);
    try {
      await softDeleteManualTask(target.id, true);
      onTaskCommitted(await getTask(target.id));
      preferredSelection.current = null;
      if (selectedId === target.id) {
        setSelectedId(null);
        setDraft(null);
        setTaskMetadata(null);
      }
      await onReload(false);
      setPendingTrashTask(null);
      setTrashTaskError(null);
      setFeedback(null);
      setSuccessToast({ id: Date.now(), message: "已移入回收站" });
    } catch (reason) { preferredSelection.current = null; setTrashTaskError(`未移入回收站：${uiErrorMessage(reason)}`); }
    finally { setBusy(false); }
  }

  async function restore(target: Task | null = selectedTask) {
    if (!target || busy) return;
    setBusy(true);
    try {
      preferredSelection.current = target.id;
      await restoreManualTask(target.id);
      const restored = await getTask(target.id);
      onTaskCommitted(restored);
      setView(taskListStatus(restored));
      setTaskMetadataRevision((revision) => revision + 1);
      await onReload(false);
      setSelectedRecurringId(null);
      setSelectedId(target.id);
      setFeedback(`“${target.title}”已恢复。`);
    } catch (reason) { preferredSelection.current = null; setFeedback(`未恢复：${uiErrorMessage(reason)}`); }
    finally { setBusy(false); }
  }

  async function permanentlyDelete() {
    const target = pendingPermanentTask;
    if (!target || busy) return;
    setBusy(true);
    setPermanentDeleteError(null);
    try {
      await permanentlyDeleteManualTask(target.id, true);
      if (selectedId === target.id) setSelectedId(null);
      await onReload(false);
      setPendingPermanentTask(null);
      setPermanentDeleteError(null);
      setFeedback(`“${target.title}”已永久删除。`);
    } catch (reason) { setPermanentDeleteError(`未永久删除：${uiErrorMessage(reason)}`); }
    finally { setBusy(false); }
  }

  async function saveRecurringItem(event?: FormEvent) {
    event?.preventDefault();
    if (!selectedRecurringItem || busy || recurringTargetLoading) return;
    if (!recurringItemPreviewDates(recurringForm).length) {
      setFeedback("有效日期暂无匹配发生日，不能保存。");
      return;
    }
    setBusy(true);
    try {
      const target = await resolveRecurringEditTarget(selectedRecurringItem.id);
      if (!target) { setFeedback("没有可修改的后续安排，历史任务块保持只读。"); return; }
      if (!recurringTarget || target.id !== recurringTarget.id) { setFeedback("编辑目标已变化，请重新打开该重复事项后再修改。"); return; }
      const change = { occurrence: target, input: recurringItemInputForForm(recurringForm), targetDate: target.occurrence_date };
      const issue = recurringChangeIssue(change, shanghaiDateValue());
      if (issue) { setFeedback(issue); return; }
      setRecurringScopeError("");
      setPendingItemChange(change);
    } catch (reason) { setFeedback(`无法保存：${uiErrorMessage(reason)}`); }
    finally { setBusy(false); }
  }

  async function commitRecurringItemChange(scope: RecurringEditScope) {
    if (!pendingItemChange || busy) return;
    const issue = recurringChangeIssue(pendingItemChange, shanghaiDateValue());
    if (issue) { setRecurringScopeError(issue); return; }
    setBusy(true);
    setRecurringScopeError("");
    try {
      await updateRecurringOccurrence(pendingItemChange.occurrence.id, pendingItemChange.input, pendingItemChange.targetDate, scope);
      setPendingItemChange(null);
      await onRecurringChanged();
      setRecurringEditRevision((value) => value + 1);
      setRecurringDetailEditing(false);
      setFeedback("");
    } catch (reason) { setRecurringScopeError(`未保存，原安排已保留：${uiErrorMessage(reason)}`); }
    finally { setBusy(false); }
  }

  async function changeRecurringItemStatus(status: "active" | "paused", target: RecurringItem | null = selectedRecurringItem) {
    if (!target || busy || hasUnsavedChanges) return;
    setBusy(true);
    try {
      await setRecurringItemStatus(target.id, status);
      await onRecurringChanged();
      setFeedback(status === "active" ? "重复事项已恢复。" : "重复事项已暂停；过去的记录会继续保留。");
    } catch (reason) {
      setFeedback(`状态未改变：${uiErrorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function endRecurringItemFromList(item: RecurringItem) {
    if (busy) return;
    setBusy(true);
    setEndRecurringError(null);
    try {
      await setRecurringItemStatus(item.id, "ended");
      await onRecurringChanged();
      setPendingEndRecurringItem(null);
      setEndRecurringError(null);
      setFeedback(`“${item.title}”已结束；过去的记录会继续保留。`);
    } catch (reason) {
      setEndRecurringError(`重复事项未能结束：${uiErrorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function moveRecurringItemToTrash() {
    if (!pendingTrashRecurringItem || busy) return;
    const item = pendingTrashRecurringItem;
    setBusy(true);
    setTrashRecurringError(null);
    try {
      await softDeleteRecurringItem(item.id, true);
      if (selectedRecurringId === item.id) setSelectedRecurringId(null);
      await onRecurringChanged();
      setPendingTrashRecurringItem(null);
      setTrashRecurringError(null);
      setFeedback(`“${item.title}”已移入回收站；过去的记录仍会保留。`);
    } catch (reason) {
      setTrashRecurringError(`重复事项未移入回收站：${uiErrorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function restoreSelectedRecurringItem(target: RecurringItem | null = selectedRecurringItem) {
    if (!target || busy) return;
    const item = target;
    setBusy(true);
    try {
      await restoreRecurringItem(item.id);
      setView("recurring");
      await onRecurringChanged();
      setSelectedId(null);
      setSelectedRecurringId(item.id);
      setFeedback(`“${item.title}”已恢复为已结束重复事项。`);
    } catch (reason) {
      setFeedback(`重复事项未恢复：${uiErrorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function permanentlyDeleteSelectedRecurringItem() {
    const item = pendingPermanentRecurringItem;
    if (!item || busy) return;
    setBusy(true);
    setPermanentDeleteError(null);
    try {
      await permanentlyDeleteRecurringItem(item.id, true);
      if (selectedRecurringId === item.id) setSelectedRecurringId(null);
      await onRecurringChanged();
      setPendingPermanentRecurringItem(null);
      setPermanentDeleteError(null);
      setFeedback(`“${item.title}”及其全部执行记录已永久删除。`);
    } catch (reason) {
      setPermanentDeleteError(`重复事项未永久删除：${uiErrorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  }
  function cancelTaskEditing() {
    if (busy || !selectedTask) return;
    setDraft(draftForTask(selectedTask));
    setTaskMetadata(initialTaskMetadata.current);
    setTaskDetailEditing(false);
  }

  function cancelRecurringEditing() {
    if (busy || !selectedRecurringItem) return;
    setRecurringForm(recurringEditBaseline ?? recurringItemFormForItem(selectedRecurringItem));
    setRecurringDetailEditing(false);
  }


  function applyTaskChange(change: PendingTaskChange) {
    setFeedback(null);
    if (creating) clearNewTaskForm();
    if (change.kind === "new-independent") {
      void openIndependentDraft(change.seed);
    } else if (change.kind === "select") {
      preferredSelection.current = null;
      pendingTaskEdit.current = change.edit ? change.taskId : null;
      setTaskDetailEditing(Boolean(change.edit));
      setSelectedRecurringId(null);
      setSelectedId(change.taskId);
      setCompactTaskEditorDismissed(false);
    } else if (change.kind === "select-recurring") {
      setSelectedId(null);
      setSelectedRecurringId(change.itemId);
      cancelRecurringEditing();
    } else if (change.kind === "recurring-detail") {
      cancelRecurringEditing();
    } else if (change.kind === "view") {
      preferredSelection.current = null;
      setView(change.view);
      setCompactTaskEditorDismissed(false);
      if (change.view === "recurring") {
        setSelectedId(null);
        setSelectedRecurringId(recurringItems.find((item) => !item.deleted_at)?.id ?? null);
      } else if (change.view === "draft") {
        setSelectedId(null);
        setSelectedRecurringId(null);
        const first = visibleTaskDrafts[0] ?? taskDrafts[0];
        if (first) {
          void openPersistedTaskDraft(first);

        }
      } else if (change.view !== "deleted") {
        setSelectedRecurringId(null);
      }
    } else if (change.kind === "detail") {
      cancelTaskEditing();
    } else if (change.kind === "close-compact-editor") {
      setCompactTaskEditorDismissed(true);
      setSelectedId(null);
      setDraft(null);
      setTaskMetadata(null);
    } else if (change.kind === "transition") {
      if (change.status === "done") { setCompletionNote(""); setCompletionError(null); setPendingCompletion(true); }
      else void transition(change.status);
    } else if (change.kind === "reopen") {
      void reopen();
    } else if (change.task) {
      setTrashTaskError(null);
      setPendingTrashTask(change.task);
    } else {
      requestMoveToTrash();
    }
  }

  async function selectRecurringItem(item: RecurringItem) {
    await requestTaskChange({ kind: "select-recurring", itemId: item.id });
  }

  async function requestTaskChange(change: PendingTaskChange) {
    if (busy || draftSaving) return;
    if (creating) {
      if (!await saveNewTaskBeforeLeaving()) return;
      applyTaskChange(change);
      return;
    }
    if (hasUnsavedChanges) setPendingTaskChange(change);
    else applyTaskChange(change);
  }

  function resolvePendingChange(proceed: boolean) {
    if (pendingTaskChange) {
      const change = pendingTaskChange;
      setPendingTaskChange(null);
      if (proceed) applyTaskChange(change);
      return;
    }
    if (externalNavigationRequest) onExternalNavigationResolved(proceed);
  }

  async function discardAndContinue() {
    if (creating) {
      clearNewTaskForm();
    } else if (selectedTask) {
      cancelTaskEditing();
    } else if (selectedRecurringItem) {
      cancelRecurringEditing();
    }
    resolvePendingChange(true);
  }

  useEffect(() => {
    if (!externalNavigationRequest || busy || draftSaving) return;
    if (creating) {
      void (async () => {
        if (!await saveNewTaskBeforeLeaving()) {
          onExternalNavigationResolved(false);
          return;
        }
        clearNewTaskForm();
        onExternalNavigationResolved(true);
      })();
    }
  }, [externalNavigationRequest, busy, draftSaving, creating, newTaskIsDirty]);

  const hasOpenConfirmation = Boolean(
    pendingTaskChange || (externalNavigationRequest && !creating) || (creating && pendingHistoricalCreation)
    || pendingTrashTask || pendingDiscardTaskDraft || pendingEndRecurringItem || pendingTrashRecurringItem
    || pendingRecurringSave || pendingItemChange || pendingDiscardNew || pendingCompletion
    || pendingPermanentTask || pendingPermanentRecurringItem
  );

  useEffect(() => {
    if (!busy && !hasUnsavedChanges && (pendingTaskChange || externalNavigationRequest)) resolvePendingChange(true);
  }, [busy, hasUnsavedChanges, pendingTaskChange, externalNavigationRequest]);

  useEffect(() => {
    function handleSaveShortcut(event: globalThis.KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== "s" || !hasUnsavedChanges || hasOpenConfirmation || busy) return;
      event.preventDefault();
      if (creating) void commitNewTask();
      else if (recurringDetailEditing) void saveRecurringItem();
      else void commitDraft();
    }
    function protectWindowClose(event: BeforeUnloadEvent) {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("keydown", handleSaveShortcut);
    window.addEventListener("beforeunload", protectWindowClose);
    return () => {
      window.removeEventListener("keydown", handleSaveShortcut);
      window.removeEventListener("beforeunload", protectWindowClose);
    };
  }, [hasUnsavedChanges, hasOpenConfirmation, creating, draft, selectedTask, newTaskForm, persistedNewTaskDraft, busy, recurringDetailEditing, recurringForm, recurringTarget, recurringTargetLoading]);

  function currentLedgerListWidth() {
    if (ledgerListWidth) return ledgerListWidth;
    const ledger = ledgerRef.current;
    if (!ledger) return TASK_LEDGER_LIST_DEFAULT_WIDTH;
    const computedWidth = Number.parseFloat(window.getComputedStyle(ledger).gridTemplateColumns);
    return Number.isFinite(computedWidth) ? computedWidth : Math.max(TASK_LEDGER_LIST_MIN_WIDTH, Math.round(ledger.clientWidth * .34));
  }

  function setConstrainedLedgerWidth(requestedWidth: number) {
    const ledgerWidth = ledgerRef.current?.clientWidth ?? 0;
    const maximumWidth = Math.max(TASK_LEDGER_LIST_MIN_WIDTH, ledgerWidth - TASK_LEDGER_INSPECTOR_MIN_WIDTH - TASK_LEDGER_HANDLE_WIDTH);
    const width = Math.round(Math.min(Math.max(requestedWidth, TASK_LEDGER_LIST_MIN_WIDTH), maximumWidth));
    setLedgerMaximumWidth(maximumWidth);
    setLedgerListWidth(width);
    return width;
  }

  function persistLedgerWidth(width: number) {
    void setUiSetting(TASK_LEDGER_WIDTH_SETTING, String(Math.round(width)))
      .catch((reason) => setFeedback(`分栏宽度未保存：${uiErrorMessage(reason)}`));
  }

  function startLedgerResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    ledgerResizeSession.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: currentLedgerListWidth() };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizingLedger(true);
  }

  function moveLedgerResize(event: ReactPointerEvent<HTMLDivElement>) {
    const session = ledgerResizeSession.current;
    if (!session) return;
    setConstrainedLedgerWidth(session.startWidth + event.clientX - session.startX);
  }

  function endLedgerResize(event: ReactPointerEvent<HTMLDivElement>) {
    const session = ledgerResizeSession.current;
    if (!session) return;
    if (event.currentTarget.hasPointerCapture(session.pointerId)) event.currentTarget.releasePointerCapture(session.pointerId);
    ledgerResizeSession.current = null;
    setResizingLedger(false);
    persistLedgerWidth(currentLedgerListWidth());
  }

  function resizeLedgerWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 16;
    const width = setConstrainedLedgerWidth(currentLedgerListWidth() + (event.key === "ArrowRight" ? step : -step));
    persistLedgerWidth(width);
  }

  function resetLedgerWidth() {
    const width = setConstrainedLedgerWidth(TASK_LEDGER_LIST_DEFAULT_WIDTH);
    persistLedgerWidth(width);
  }

  return (
    <section className="tasks-workspace" aria-label="任务管理">
      {successToast && <Toast key={successToast.id} title={successToast.message} tone="success" duration={successToast.undoId || successToast.openToday ? 10_000 : 2400} onDismiss={() => setSuccessToast(null)} actions={[
        ...(successToast.undoId ? [{ label: "撤销", onClick: () => void undoLastChange(successToast.undoId!) }] : []),
        ...(successToast.openToday ? [{ label: "查看安排", onClick: () => onOpenToday(successToast.date, successToast.taskId) }] : [])
      ]} />}
      {feedback && <Toast title={feedback} duration={5000} onDismiss={() => setFeedback(null)} />}
      <div ref={ledgerRef} className={`task-ledger${resizingLedger ? " is-resizing" : ""}`} style={ledgerListWidth ? { "--task-list-width": `${ledgerListWidth}px` } as CSSProperties : undefined}>
        <div className="task-ledger-list" aria-busy={loading}>
          <header className="task-queue-header">
            <div className="task-queue-heading">
              <h1>{taskViewCopy[view]}</h1>
              <span className="task-queue-heading-meta">
                <span className="task-queue-count">{counts[view] + (showUnsavedCreateCapsule ? 1 : 0)} 项</span>
                {(view !== "all" || Boolean(tagFilter) || Boolean(search)) && (
                  <button
                    type="button"
                    className="task-filter-reset-all"
                    onClick={() => {
                      setSearch("");
                      setTagFilter("");
                      if (view !== "all") void requestTaskChange({ kind: "view", view: "all" });
                    }}
                  >重置</button>
                )}
              </span>
            </div>
            <div className="task-queue-toolbar">
              <div className="task-queue-search">
                <Icon name="search" size={14} />
                <input type="search" aria-label="搜索当前任务视图" placeholder="搜索任务…" value={search} onChange={(event) => setSearch(event.target.value)} />
                {search && <button type="button" aria-label="清除搜索" onClick={() => setSearch("")}><Icon name="close" size={13} /></button>}
              </div>
              <TaskStatusDropdown id="task-status-filter" view={view} counts={counts} onSelect={(nextView) => void requestTaskChange({ kind: "view", view: nextView })} />
              <TaskTagFilter id="task-tag-filter" tags={availableTags} counts={tagCounts} value={tagFilter} onChange={setTagFilter} />
            </div>
          </header>
          <div className="task-ledger-scroll">
          {showUnsavedCreateCapsule && (
            <div className={`ledger-row selected task-ledger-row task-capsule-row capsule-type-${createItemType} status-row-draft`}>
              <button
                type="button"
                className="ledger-row-select task-capsule-select"
                aria-pressed="true"
                aria-label={`${createItemType === "task" ? newTaskForm.title.trim() || "未命名草稿" : recurringForm.title.trim() || "未命名重复事项"}，草稿`}
                onClick={() => document.getElementById(createItemType === "task" ? "new-task-title" : "new-recurring-title")?.focus()}
              >
                <span className="ledger-accent" aria-hidden="true" />
                {createItemType === "task" ? (
                  <TaskCapsuleContent
                    title={newTaskForm.title.trim() || "未命名草稿"}
                    notes={newTaskForm.notes.trim()}
                    tags={newTaskForm.tags}
                    priority={newTaskForm.priority}
                    timing={taskFormTimingFact(newTaskForm, today)}
                    minutes={newTaskForm.estimated_minutes}
                    status="草稿"
                    statusTone="draft"
                    sourceType="manual"
                  />
                ) : (
                  <TaskCapsuleContent
                    title={recurringForm.title.trim() || "未命名重复事项"}
                    notes={recurringForm.notes.trim()}
                    tags={recurringForm.tags}
                    facts={recurringCapsuleFacts(recurringForm, today)}
                    status="草稿"
                    statusTone="draft"
                    sourceType="manual"
                    variant="recurring"
                  />
                )}
              </button>
              <div className="ledger-row-actions" aria-label={`${(createItemType === "task" ? newTaskForm.title.trim() : recurringForm.title.trim()) || "未命名草稿"}的快捷操作`}>
                <button
                  type="button"
                  className="ledger-quick-action danger icon-only"
                  data-tooltip="放弃"
                  aria-label={`放弃${(createItemType === "task" ? newTaskForm.title.trim() : recurringForm.title.trim()) || "未命名草稿"}`}
                  onClick={() => void cancelNewTask(true)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          )}
          {error && <div className="inline-error"><strong>任务暂时无法打开</strong><span>{error}</span><button onClick={() => void onReload()}>重试</button></div>}
          {!error && (loading || (view === "draft" && taskDraftsLoading)) && <div className="task-list-skeleton" role="status" aria-label="正在载入任务">{[0, 1, 2].map((item) => <span key={item} className="task-skeleton-card"><i /><b /><em /></span>)}</div>}
          {!error && !loading && !taskDraftsLoading && !creating && visibleTasks.length === 0 && visibleTaskDrafts.length === 0 && visibleRecurringItems.length === 0 && <div className="ledger-empty"><Icon name={taskViewIcon[view]} size={22} /><strong>{search || tagFilter ? "无匹配结果" : taskEmptyCopy[view]}</strong>{(search || tagFilter) && <button type="button" onClick={() => { setSearch(""); setTagFilter(""); }}>清除筛选</button>}</div>}
          {(view === "recurring" || view === "deleted") && visibleRecurringItems.map((item) => (
            <div key={item.id} className={`${selectedRecurringId === item.id ? "ledger-row selected" : "ledger-row"} task-ledger-row task-capsule-row recurring-ledger-row capsule-type-recurring status-row-${item.deleted_at ? "deleted" : item.status}`}>
              <button type="button" className="ledger-row-select task-capsule-select" aria-pressed={selectedRecurringId === item.id} onClick={() => void selectRecurringItem(item)}><span className="ledger-accent" aria-hidden="true" /><RecurringItemCapsuleContent item={item} today={today} /></button>
              <div className="ledger-row-actions" aria-label={`${item.title}的快捷操作`}>
                {view === "deleted" && item.deleted_at && <button type="button" className="ledger-quick-action icon-only" data-tooltip="恢复" aria-label={`恢复${item.title}`} disabled={busy} onClick={() => void restoreSelectedRecurringItem(item)}><Icon name="restore" size={14} /></button>}
                {view === "deleted" && item.deleted_at && <button type="button" className="ledger-quick-action danger icon-only" data-tooltip="永久删除" aria-label={`永久删除${item.title}`} disabled={busy} onClick={() => { setPermanentDeleteError(null); setPendingPermanentRecurringItem(item); }}><Icon name="trash" size={14} /></button>}
                {view === "recurring" && !item.deleted_at && item.status === "active" && <button type="button" className="ledger-quick-action icon-only" data-tooltip="暂停" aria-label={`暂停${item.title}`} disabled={busy || hasUnsavedChanges} onClick={() => void changeRecurringItemStatus("paused", item)}><Icon name="pause" size={14} /></button>}
                {view === "recurring" && !item.deleted_at && item.status === "paused" && <button type="button" className="ledger-quick-action icon-only" data-tooltip="恢复" aria-label={`恢复${item.title}`} disabled={busy || hasUnsavedChanges} onClick={() => void changeRecurringItemStatus("active", item)}><Icon name="restore" size={14} /></button>}
                {view === "recurring" && !item.deleted_at && item.status === "paused" && <button type="button" className="ledger-quick-action caution icon-only" data-tooltip="结束" aria-label={`结束${item.title}`} disabled={busy || hasUnsavedChanges} onClick={() => { setEndRecurringError(null); setPendingEndRecurringItem(item); }}><Icon name="check" size={14} /></button>}
                {view === "recurring" && !item.deleted_at && (item.status === "paused" || item.status === "ended") && <button type="button" className="ledger-quick-action danger icon-only" data-tooltip="移入回收站" aria-label={`将${item.title}移入回收站`} disabled={busy || hasUnsavedChanges} onClick={() => { setTrashRecurringError(null); setPendingTrashRecurringItem(item); }}><Icon name="trash" size={14} /></button>}
              </div>
            </div>
          ))}
          {!taskDraftsLoading && view === "draft" && visibleTaskDrafts.map((item) => {
            const isEditingActiveDraft = creating && persistedNewTaskDraft?.id === item.id;
            const itemType = isEditingActiveDraft ? createItemType : item.item_type ?? "task";
            const common = isEditingActiveDraft ? (itemType === "task" ? newTaskForm : recurringForm) : item;
            const recurring = isEditingActiveDraft ? recurringForm : recurringFormForDraft(item, today);
            const draftTitle = common.title.trim() || "未命名草稿";
            const draftNotes = common.notes?.trim();
            const draftPriority = isEditingActiveDraft ? newTaskForm.priority : item.priority;
            const draftTiming = isEditingActiveDraft ? taskFormTimingFact(newTaskForm, today) : taskDraftTimingFact(item, today);
            const draftMinutes = isEditingActiveDraft ? newTaskForm.estimated_minutes : item.total_workload_minutes;
            return (
              <div key={item.id} className={`${isEditingActiveDraft ? "ledger-row selected" : "ledger-row"} task-ledger-row task-capsule-row capsule-type-${itemType} status-row-draft`}>
                <button type="button" className="ledger-row-select task-capsule-select" aria-pressed={isEditingActiveDraft} onClick={() => void selectPersistedTaskDraft(item)}>
                  <span className="ledger-accent" aria-hidden="true" />
                  {itemType === "recurring" ? <TaskCapsuleContent title={draftTitle} tags={common.tags} notes={draftNotes} status="草稿" statusTone="draft" variant="recurring" sourceType={item.source_type} facts={recurringCapsuleFacts(recurring, today)} /> : <TaskCapsuleContent title={draftTitle} tags={common.tags} notes={draftNotes} priority={draftPriority} timing={draftTiming} minutes={draftMinutes} status="草稿" statusTone="draft" sourceType={item.source_type} />}
                </button>
                <div className="ledger-row-actions" aria-label={`${draftTitle}的快捷操作`}>
                  {!isEditingActiveDraft && <button type="button" className="ledger-quick-action icon-only" data-tooltip="编辑" onClick={() => void selectPersistedTaskDraft(item)}><Icon name="pencil" size={14} /></button>}
                  <button type="button" className="ledger-quick-action danger icon-only" data-tooltip="放弃" aria-label={`放弃${draftTitle}`} disabled={busy || draftSaving} onClick={() => { setDiscardDraftError(null); setPendingDiscardTaskDraft(item); }}><Icon name="trash" size={14} /></button>
                </div>
              </div>
            );
          })}
          {!loading && visibleTasks.map((task) => (
            <div key={task.id} className={`${selectedId === task.id ? "ledger-row selected" : "ledger-row"} task-ledger-row task-capsule-row capsule-type-task status-row-${taskListStatus(task)}`}>
              <button type="button" className="ledger-row-select task-capsule-select" aria-pressed={selectedId === task.id} onClick={() => requestTaskChange({ kind: "select", taskId: task.id })}>
              <span className="ledger-accent" aria-hidden="true" />
              <TaskCapsuleContent title={task.title} tags={task.tags} notes={task.notes} priority={task.priority} timing={taskTimingFact(task, today)} minutes={task.estimated_minutes} status={statusCopy[taskListStatus(task)]} statusTone={taskListStatus(task)} sourceType={task.source_type} typeLabel={task.status === "deleted" ? "普通任务" : undefined} />
              </button>
              <div className="ledger-row-actions" aria-label={`${task.title}的快捷操作`}>
                {selectedId !== task.id && taskIsEditable(task) && <button type="button" className="ledger-quick-action icon-only" data-tooltip="编辑" onClick={() => requestTaskChange({ kind: "select", taskId: task.id, edit: true })}><Icon name="pencil" size={14} /></button>}
                {task.status === "deleted" && <button type="button" className="ledger-quick-action icon-only" data-tooltip="恢复" aria-label={`恢复${task.title}`} disabled={busy} onClick={() => void restore(task)}><Icon name="restore" size={14} /></button>}
                {task.status === "deleted" && <button type="button" className="ledger-quick-action danger icon-only" data-tooltip="永久删除" aria-label={`永久删除${task.title}`} disabled={busy} onClick={() => { setPermanentDeleteError(null); setPendingPermanentTask(task); }}><Icon name="trash" size={14} /></button>}
                {task.status !== "deleted" && <button type="button" className="ledger-quick-action danger icon-only" data-tooltip="移入回收站" aria-label={`将${task.title}移入回收站`} onClick={() => requestTaskChange({ kind: "trash", task: { id: task.id, title: task.title } })}><Icon name="trash" size={14} /></button>}
              </div>
            </div>
          ))}
          </div>
        </div>
        <div className="ledger-resize-handle" role="separator" aria-label="调整任务列表与详情宽度；双击恢复默认宽度" aria-orientation="vertical" aria-valuemin={TASK_LEDGER_LIST_MIN_WIDTH} aria-valuemax={Math.round(ledgerMaximumWidth)} aria-valuenow={Math.round(currentLedgerListWidth())} tabIndex={0} onDoubleClick={resetLedgerWidth} onPointerDown={startLedgerResize} onPointerMove={moveLedgerResize} onPointerUp={endLedgerResize} onPointerCancel={endLedgerResize} onKeyDown={resizeLedgerWithKeyboard} />
        <aside className="task-inspector" aria-label="任务详情">
          <div className="inspector-scroll">
          {creating ? (
            <form id="new-task-form" className="task-form create-task-form edit-task-form task-compact-form" autoComplete="off" onSubmit={submitNewTask}>
              <TaskPageHeader editing draftLabel={persistedNewTaskDraft ? "待确认草稿" : "草稿"} />
              <div className="task-compact-body">
                {!persistedNewTaskDraft?.target_task_id && (
                  <div className="create-type-switch" role="radiogroup" aria-label="创建类型" data-autosaving={draftSaving && !busy}>
                    <button type="button" role="radio" disabled={busy || draftSaving} aria-checked={createItemType === "task"} onClick={() => requestCreateItemType("task")}>
                      <Icon name="tasks" size={16} />
                      <span><strong>普通任务</strong></span>
                    </button>
                    <button type="button" role="radio" disabled={busy || draftSaving} aria-checked={createItemType === "recurring"} onClick={() => requestCreateItemType("recurring")}>
                      <Icon name="restore" size={16} />
                      <span><strong>重复事项</strong></span>
                    </button>
                  </div>
                )}
                {newTaskError && (
                  <div className="inline-error compact" role="alert">
                    <strong>{createItemType === "task" ? "任务尚未创建" : "重复事项尚未创建"}</strong>
                    <span>{newTaskError}</span>
                  </div>
                )}
                {createItemType === "task" ? (
                  <>
                    <TaskEditorRegions form={newTaskForm} availableTags={availableTags} disabled={busy} idPrefix="new-task" autoFocusTitle compact allowExistingHistoricalRange={persistedNewTaskDraft?.draft_kind === "update"} onChange={updateNewTaskFields} onScheduleChange={updateNewTaskSchedule} />
                    {newTaskHistoryError ? <p className="execution-capture-note" role="status">{newTaskHistoryError}</p> : newTaskIsHistoricalCreation && <p className="execution-capture-note" role="status">这是历史单日任务补录：确认创建后将自动生成{(newTaskForm.earliest_start_time || newTaskForm.due_time) ? "已完成任务及当天任务块" : "已完成任务及当天执行记录"}，执行记录注明“{HISTORICAL_TASK_CREATION_NOTE}”；不填写实际耗时，历史完成不可取消。</p>}
                  </>
                ) : (
                  <RecurringItemEditor form={recurringForm} availableTags={availableTags} disabled={busy} idPrefix="new-recurring" autoFocusTitle compact isCreating onChange={(next) => { newTaskEditRevision.current += 1; setNewTaskAutosaveArmed(true); setRecurringForm(next); }} />
                )}
              </div>
              <footer className="task-compact-actions create-task-actions">
                <div className="task-compact-lifecycle">
                  <button
                    type="button"
                    className="task-compact-cancel task-action-discard"
                    disabled={busy || draftSaving}
                    onClick={() => void cancelNewTask()}
                  >
                    放弃草稿
                  </button>
                  <span className="task-draft-save-state" role="status">
                    {draftSaving ? "正在保存草稿…"
                      : newTaskIsDirty && (persistedNewTaskDraft || newTaskFieldsAreDirty)
                        ? newTaskAutosaveArmed ? "将在停止输入后自动保存" : "离开当前任务前保存"
                      : persistedNewTaskDraft
                        ? (createItemType === "task" && !newTaskHasCompleteSchedule ? "草稿已保存；补全开始和结束日期后可创建" : createItemType === "task" && !newTaskHasValidWorkload ? "草稿已保存；补全平均每日投入后可创建" : "草稿已保存")
                        : (createItemType === "task" && !newTaskHasCompleteSchedule ? "日期未完整时只保存为草稿" : createItemType === "task" && !newTaskHasValidWorkload ? "跨日定时任务需填写平均每日投入" : "尚未填写")}
                  </span>
                </div>
                <div className="task-compact-primary-actions">
                  <button
                    type="submit"
                    className="task-compact-save create-task-submit"
                    disabled={
                      busy || draftSaving ||
                      (createItemType === "task"
                        ? !newTaskForm.title.trim() || !newTaskHasCompleteSchedule || !newTaskHasValidRange || !newTaskHasValidWorkload || Boolean(newTaskHistoryError)
                        : Boolean(recurringFormSaveIssue(recurringForm)))
                    }
                  >
                    {busy ? <span className="loader" /> : <Icon name={createItemType === "task" && persistedNewTaskDraft?.draft_kind === "update" ? "check" : "plus"} size={15} />}
                    {busy ? "正在保存…" : createItemType === "recurring" ? "创建重复事项" : persistedNewTaskDraft?.draft_kind === "update" ? "保存修改" : "创建任务"}
                  </button>
                </div>
              </footer>
            </form>
          ) : view === "recurring" && selectedRecurringItem?.status === "ended" ? (
            <EndedRecurringItemDetails item={selectedRecurringItem} busy={busy} onTrash={() => { setTrashRecurringError(null); setPendingTrashRecurringItem(selectedRecurringItem); }} onBack={timelineReturnContext ? () => onReturnToTimeline(timelineReturnContext) : undefined} />
          ) : view === "recurring" && selectedRecurringItem && !recurringDetailEditing ? (
            <RecurringItemDetails item={selectedRecurringItem} busy={busy} onEdit={() => setRecurringDetailEditing(true)} onPause={() => void changeRecurringItemStatus("paused")} onResume={() => void changeRecurringItemStatus("active")} onEnd={() => { setEndRecurringError(null); setPendingEndRecurringItem(selectedRecurringItem); }} onBack={timelineReturnContext ? () => onReturnToTimeline(timelineReturnContext) : undefined} />
          ) : view === "recurring" && selectedRecurringItem ? (
            <form id="recurring-editor-form" className="task-form create-task-form edit-task-form task-compact-form" onSubmit={saveRecurringItem}>
              <TaskPageHeader task={selectedRecurringItem} editing busy={busy || recurringTargetLoading} onBack={() => void requestTaskChange({ kind: "recurring-detail" })} />
              <div className="task-compact-body">
                <RecurringItemEditor key={selectedRecurringItem.id} form={recurringForm} availableTags={availableTags} disabled={busy || recurringTargetLoading} idPrefix="edit-recurring" compact onChange={setRecurringForm} />
              </div>
              <footer className="task-compact-actions">
                <div className="task-compact-lifecycle" />
                <div className="task-compact-primary-actions">
                  <span className="sr-only" role="status">{busy ? "正在保存" : recurringEditingDirty ? "有未保存的更改" : "更改已保存"}</span>
                  <button type="button" className="task-compact-cancel" disabled={busy || recurringTargetLoading} onClick={cancelRecurringEditing}>取消</button>
                  <button type="submit" className="task-compact-save" disabled={busy || recurringTargetLoading || !recurringEditingDirty || Boolean(recurringFormSaveIssue(recurringForm))}>
                    {busy ? <span className="loader" /> : <Icon name="check" size={15} />}{busy ? "保存中…" : "保存修改"}
                  </button>
                </div>
              </footer>
            </form>
          ) : view === "deleted" && selectedRecurringItem?.deleted_at ? (
            <DeletedRecurringItemDetails item={selectedRecurringItem} busy={busy} onBack={timelineReturnContext ? () => onReturnToTimeline(timelineReturnContext) : undefined}>
              <RecycleBinActions deletedAt={selectedRecurringItem.deleted_at} nowMs={recycleNow} itemLabel="重复事项" busy={busy} onRestore={() => void restoreSelectedRecurringItem(selectedRecurringItem)} onPermanentDelete={() => { setPermanentDeleteError(null); setPendingPermanentRecurringItem(selectedRecurringItem); }} />
            </DeletedRecurringItemDetails>
          ) : !selectedTask || !draft ? <div className="inspector-empty"><Icon name={taskViewIcon[view]} size={21} /><p>选择一项查看详情</p></div> : selectedTask.status === "deleted" ? (
            <DeletedTaskDetails task={selectedTask} metadata={selectedMetadata} busy={busy} now={recycleNow} onRestore={() => void restore(selectedTask)} onPermanentDelete={() => { setPermanentDeleteError(null); setPendingPermanentTask(selectedTask); }} onNewTask={() => void requestTaskChange({ kind: "new-independent", seed: selectedTask })} onBack={timelineReturnContext ? () => onReturnToTimeline(timelineReturnContext) : undefined} />
          ) : taskDetailEditing && editingTaskForm ? (
            <form id="task-editor-form" className="task-form create-task-form edit-task-form task-compact-form" onSubmit={save}>
              <TaskPageHeader task={selectedTask} editing busy={busy} onBack={() => void requestTaskChange({ kind: "detail" })} />
              <div className="task-compact-body"><TaskEditorRegions key={selectedTask.id} form={editingTaskForm} availableTags={availableTags} disabled={busy || !selectedMetadata} allowExistingHistoricalRange idPrefix="edit-task" compact onChange={updateEditingTaskForm} onScheduleChange={updateEditingTaskSchedule} /></div>
              <footer className="task-compact-actions">
                <div className="task-compact-lifecycle">
                  {["open", "scheduled"].includes(selectedTask.status) && <button type="button" className="task-compact-complete" title={!taskResultEditable(selectedTask, resultNow, selectedMetadata) ? "已超过结果修改时间" : selectedTask.earliest_start_date && selectedTask.due_date && selectedTask.earliest_start_date < selectedTask.due_date ? "完成整个任务" : "完成任务"} onClick={() => requestTaskChange({ kind: "transition", status: "done" })} disabled={busy || !taskResultEditable(selectedTask, resultNow, selectedMetadata)}><Icon name="check" size={15} />{selectedTask.earliest_start_date && selectedTask.due_date && selectedTask.earliest_start_date < selectedTask.due_date ? "完成整个任务" : "完成任务"}</button>}
                  <button type="button" className="task-compact-trash" disabled={busy} onClick={() => requestTaskChange({ kind: "trash" })}><Icon name="trash" size={15} />移入回收站</button>
                </div>
                <div className="task-compact-primary-actions">
                  <span className="sr-only" role="status">{busy ? "正在保存" : isDirty ? "有未保存的更改" : "更改已保存"}</span>
                  <button type="button" className="task-compact-cancel" disabled={busy} onClick={cancelTaskEditing}>取消</button>
                  <button type="submit" className="task-compact-save" disabled={busy || !selectedMetadata || !isDirty || !draft.title.trim() || !editingTaskHasCompleteSchedule || !editingTaskHasValidRange || !editingTaskHasValidWorkload}>{busy ? <span className="loader" /> : <Icon name="check" size={15} />}{busy ? "保存中…" : "保存修改"}</button>
                </div>
              </footer>
            </form>
          ) : (
            <CompletedTaskDetails task={selectedTask} busy={busy} now={resultNow} metadata={selectedMetadata} onReopen={() => requestTaskChange({ kind: "reopen" })} onTrash={() => requestTaskChange({ kind: "trash" })} onComplete={() => requestTaskChange({ kind: "transition", status: "done" })} onNewTask={() => void requestTaskChange({ kind: "new-independent", seed: selectedTask })} onEdit={() => setTaskDetailEditing(true)} onBack={timelineReturnContext ? () => onReturnToTimeline(timelineReturnContext) : undefined} onLocate={selectedTaskLocationDate ? () => onOpenToday(selectedTaskLocationDate, selectedTask.id) : undefined} />
          )}
          </div>
        </aside>
      </div>
      {(pendingTaskChange || (externalNavigationRequest && !creating)) && createPortal(<div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) resolvePendingChange(false); }}>
        <ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="unsaved-dialog-title" aria-describedby="unsaved-dialog-description" busy={busy} tone="caution" onCancel={() => { if (!busy) resolvePendingChange(false); }}><h2 id="unsaved-dialog-title">{creating ? "放弃新建任务？" : "放弃未保存的修改？"}</h2><div id="unsaved-dialog-description" className="confirmation-body">{(creating ? (createItemType === "task" ? newTaskForm.title.trim() : recurringForm.title.trim()) || "未命名草稿" : recurringDetailEditing && selectedRecurringItem ? selectedRecurringItem.title : selectedTask?.title) && <strong className="confirmation-object">{creating ? (createItemType === "task" ? newTaskForm.title.trim() : recurringForm.title.trim()) || "未命名草稿" : recurringDetailEditing && selectedRecurringItem ? selectedRecurringItem.title : selectedTask?.title}</strong>}<p>{creating ? "任务尚未创建，放弃后已填写的内容将丢失。" : recurringDetailEditing && selectedRecurringItem ? "未保存的修改将丢失，重复事项恢复为上次保存的设置。" : "未保存的修改将丢失，任务恢复为上次保存的内容。"}</p></div><div className="dialog-actions">
            <button type="button" className="dialog-cancel" autoFocus disabled={busy} onClick={() => resolvePendingChange(false)}>继续编辑</button>
            <button type="button" className="dialog-discard" disabled={busy} onClick={() => void discardAndContinue()}>{busy ? "正在放弃…" : creating ? "放弃新建" : "放弃修改"}</button>
          </div></ConfirmationDialog>
      </div>, document.body)}
      {creating && pendingHistoricalCreation && createPortal(<div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !draftSaving) { setPendingHistoricalCreation(null); setHistoricalCreationError(null); } }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="historical-create-title" aria-describedby="historical-create-description" busy={busy || draftSaving} tone="caution" onCancel={() => { if (!busy && !draftSaving) { setPendingHistoricalCreation(null); setHistoricalCreationError(null); } }}><h2 id="historical-create-title">补录历史任务？</h2><div id="historical-create-description" className="confirmation-body"><strong className="confirmation-object">{pendingHistoricalCreation.title}</strong><p>这是历史补录，不是待办计划。将直接完成任务并{pendingHistoricalCreation.untimed ? "生成当天执行记录" : "生成已完成任务块"}，执行记录注明“{HISTORICAL_TASK_CREATION_NOTE}”，实际耗时留空。历史完成记录不能取消完成。</p>{historicalCreationError && <p className="confirmation-error" role="alert">{historicalCreationError}</p>}</div><div className="dialog-actions"><button type="button" autoFocus disabled={busy || draftSaving} onClick={() => { setPendingHistoricalCreation(null); setHistoricalCreationError(null); }}>返回编辑</button><button type="button" className="dialog-save" disabled={busy || draftSaving} onClick={() => void commitNewTask(pendingHistoricalCreation.input)}>{busy ? "正在补录…" : "补录并完成"}</button></div></ConfirmationDialog></div>, document.body)}
      {pendingTrashTask && createPortal(<MoveTaskToTrashDialog
        title={pendingTrashTask.title}
        description="将从任务列表及日、周、月视图移除展示；任务及已有执行记录会在回收站保留 30 天，恢复后重新展示。"
        busy={busy}
        error={trashTaskError}
        titleId="task-trash-title"
        descriptionId="task-trash-description"
        onCancel={() => { setPendingTrashTask(null); setTrashTaskError(null); }}
        onConfirm={() => void moveToTrash()}
      />, document.body)}
      {pendingDiscardTaskDraft && createPortal(<div className="dialog-backdrop task-trash-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setPendingDiscardTaskDraft(null); setDiscardDraftError(null); } }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="discard-task-draft-title" aria-describedby="discard-task-draft-description" busy={busy} tone="caution" onCancel={() => { if (!busy) { setPendingDiscardTaskDraft(null); setDiscardDraftError(null); } }}><h2 id="discard-task-draft-title">放弃草稿？</h2><div id="discard-task-draft-description" className="confirmation-body"><strong className="confirmation-object">{pendingDiscardTaskDraft.title || "未命名草稿"}</strong><p>{pendingDiscardTaskDraft.draft_kind === "update" ? "草稿内容将永久移除，无法恢复，原任务保持不变。" : "草稿内容将永久移除，无法恢复。"}</p>{discardDraftError && <p className="confirmation-error" role="alert">{discardDraftError}</p>}</div><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => { setPendingDiscardTaskDraft(null); setDiscardDraftError(null); }}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void discardTaskDraftFromList(pendingDiscardTaskDraft)}>{busy ? "正在放弃…" : "放弃草稿"}</button></div></ConfirmationDialog></div>, document.body)}
      {pendingEndRecurringItem && createPortal(<div className="dialog-backdrop task-trash-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setPendingEndRecurringItem(null); setEndRecurringError(null); } }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="end-recurring-item-title" aria-describedby="end-recurring-item-description" busy={busy} tone="caution" onCancel={() => { if (!busy) { setPendingEndRecurringItem(null); setEndRecurringError(null); } }}><h2 id="end-recurring-item-title">结束重复事项？</h2><div id="end-recurring-item-description" className="confirmation-body"><strong className="confirmation-object">{pendingEndRecurringItem.title}</strong><p>结束后将不再产生后续安排，且无法重新启用或编辑；已保存的执行记录保留。如仅需暂时停用，请改用「暂停」。</p>{endRecurringError && <p className="confirmation-error" role="alert">{endRecurringError}</p>}</div><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => { setPendingEndRecurringItem(null); setEndRecurringError(null); }}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void endRecurringItemFromList(pendingEndRecurringItem)}>{busy ? "正在结束…" : "结束重复"}</button></div></ConfirmationDialog></div>, document.body)}
      {pendingTrashRecurringItem && createPortal(<div className="dialog-backdrop task-trash-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setPendingTrashRecurringItem(null); setTrashRecurringError(null); } }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="trash-recurring-item-title" aria-describedby="trash-recurring-item-description" busy={busy} tone="caution" onCancel={() => { if (!busy) { setPendingTrashRecurringItem(null); setTrashRecurringError(null); } }}><h2 id="trash-recurring-item-title">移入回收站？</h2><div id="trash-recurring-item-description" className="confirmation-body"><strong className="confirmation-object">{pendingTrashRecurringItem.title}</strong><p>{pendingTrashRecurringItem.status === "paused" ? "将永久结束重复规则并移入回收站；不再产生后续安排，已保存的执行记录保留，30 天内恢复后为已结束状态。" : "将移出重复事项列表；已保存的执行记录保留，30 天内可在回收站恢复。"}</p>{trashRecurringError && <p className="confirmation-error" role="alert">{trashRecurringError}</p>}</div><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => { setPendingTrashRecurringItem(null); setTrashRecurringError(null); }}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void moveRecurringItemToTrash()}>{busy ? "正在移入…" : "移入回收站"}</button></div></ConfirmationDialog></div>, document.body)}
      {pendingRecurringSave && selectedTask && createPortal(<div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setPendingRecurringSave(null); setRecurringSaveError(null); } }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="recurring-scope-title" aria-describedby="recurring-scope-description" busy={busy} tone="info" onCancel={() => { if (!busy) { setPendingRecurringSave(null); setRecurringSaveError(null); } }}><h2 id="recurring-scope-title">修改哪些重复安排？</h2><div id="recurring-scope-description" className="confirmation-body"><strong className="confirmation-object">{selectedTask.title}</strong><p>历史任务和执行记录保持不变。仅修改本次，不改变重复规则；修改本次及以后，将从本次起应用新安排。</p>{recurringSaveError && <p className="confirmation-error" role="alert">{recurringSaveError}</p>}</div><div className="dialog-actions"><button type="button" disabled={busy} onClick={() => { setPendingRecurringSave(null); setRecurringSaveError(null); }}>取消</button><button type="button" disabled={busy} onClick={() => void commitDraft("this")}>仅修改本次</button><button type="button" className="dialog-save" disabled={busy} onClick={() => void commitDraft("future")}>{busy ? "正在保存…" : "修改本次及以后"}</button></div></ConfirmationDialog></div>, document.body)}
      {pendingItemChange && <RecurringScopeConfirmation change={pendingItemChange} busy={busy} error={recurringScopeError} onCancel={() => { if (!busy) setPendingItemChange(null); }} onConfirm={(scope) => void commitRecurringItemChange(scope)} />}
      {pendingDiscardNew && createPortal(<div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setPendingDiscardNew(false); setDiscardNewError(null); } }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="discard-new-title" aria-describedby="discard-new-description" busy={busy} tone="caution" onCancel={() => { if (!busy) { setPendingDiscardNew(false); setDiscardNewError(null); } }}><h2 id="discard-new-title">放弃草稿？</h2><div id="discard-new-description" className="confirmation-body"><strong className="confirmation-object">{(createItemType === "task" ? newTaskForm.title.trim() : recurringForm.title.trim()) || persistedNewTaskDraft?.title?.trim() || "未命名草稿"}</strong><p>{persistedNewTaskDraft?.draft_kind === "update" ? "草稿内容将永久移除，无法恢复，原任务保持不变。" : "草稿内容将永久移除，无法恢复。"}</p>{discardNewError && <p className="confirmation-error" role="alert">{discardNewError}</p>}</div><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => { setPendingDiscardNew(false); setDiscardNewError(null); }}>继续编辑</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void cancelNewTask(false)}>{busy ? "正在放弃…" : "放弃草稿"}</button></div></ConfirmationDialog></div>, document.body)}
      {pendingCompletion && selectedTask && createPortal(<TaskCompletionDialog task={selectedTask} note={completionNote} busy={busy} error={completionError} onNoteChange={setCompletionNote} onCancel={() => { if (!busy) setPendingCompletion(false); }} onConfirm={() => void transition("done", completionNote)} />, document.body)}
      {pendingPermanentTask && createPortal(<div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setPendingPermanentTask(null); setPermanentDeleteError(null); } }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="permanent-task-title" aria-describedby="permanent-task-description" busy={busy} tone="danger" onCancel={() => { if (!busy) { setPendingPermanentTask(null); setPermanentDeleteError(null); } }}><h2 id="permanent-task-title">永久删除任务？</h2><div id="permanent-task-description" className="confirmation-body"><strong className="confirmation-object">{pendingPermanentTask.title}</strong><p>任务及其全部执行记录将永久删除，无法恢复。</p>{permanentDeleteError && <p className="confirmation-error" role="alert">{permanentDeleteError}</p>}</div><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => { setPendingPermanentTask(null); setPermanentDeleteError(null); }}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void permanentlyDelete()}>{busy ? "正在删除…" : "永久删除"}</button></div></ConfirmationDialog></div>, document.body)}
      {pendingPermanentRecurringItem && createPortal(<div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setPendingPermanentRecurringItem(null); setPermanentDeleteError(null); } }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="permanent-recurring-item-title" aria-describedby="permanent-recurring-item-description" busy={busy} tone="danger" onCancel={() => { if (!busy) { setPendingPermanentRecurringItem(null); setPermanentDeleteError(null); } }}><h2 id="permanent-recurring-item-title">永久删除重复事项？</h2><div id="permanent-recurring-item-description" className="confirmation-body"><strong className="confirmation-object">{pendingPermanentRecurringItem.title}</strong><p>重复事项及其全部执行记录将永久删除，无法恢复。</p>{permanentDeleteError && <p className="confirmation-error" role="alert">{permanentDeleteError}</p>}</div><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => { setPendingPermanentRecurringItem(null); setPermanentDeleteError(null); }}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void permanentlyDeleteSelectedRecurringItem()}>{busy ? "正在删除…" : "永久删除"}</button></div></ConfirmationDialog></div>, document.body)}
    </section>
  );
}

function calendarCells(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(year, month - 1, 1 - mondayOffset));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cellCount = Math.ceil((mondayOffset + daysInMonth) / 7) * 7;
  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return {
      key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`,
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month - 1
    };
  });
}

type TimelineSelection = { kind: "block" | "event" | "draft" | "recurring"; id: string };
type ExecutionDraft = { result: ExecutionResult | null; outcome: ExecutionOutcome | null; note: string; wholeTask?: boolean };

function executionDraftChanged(block: PlanBlock, draft: ExecutionDraft, task: Task | undefined) {
  const savedOutcome = block.review?.outcome ?? block.execution_status;
  const outcome = savedOutcome === "planned" ? null : savedOutcome === "completed" ? "completed" : "not_started";
  const noteChanged = draft.note.trim() !== (block.review?.notes ?? block.execution_note ?? "").trim();
  return noteChanged || (draft.wholeTask ? task?.status !== "done" : draft.outcome !== outcome);
}

function ExecutionCaptureFields({ draft, disabled, onChange, onCompleteTask, completeTaskDisabled, taskCompleted = false }: {
  draft: ExecutionDraft; disabled: boolean; onChange: (update: Partial<ExecutionDraft>) => void; onCompleteTask?: () => void; completeTaskDisabled?: boolean; taskCompleted?: boolean;
}) {
  const choseIncomplete = draft.wholeTask === false && draft.result !== "completed";
  return <div className="execution-capture-fields">
    <div className="execution-result-label">任务结果</div>
    <ExecutionOutcomePicker label="任务结果" result={draft.result} disabled={disabled} onChange={(result, outcome) => onChange({ result, outcome, wholeTask: false })} onCompleteTask={onCompleteTask} completeTaskDisabled={completeTaskDisabled} wholeTask={draft.wholeTask || (taskCompleted && !choseIncomplete)} />
    <label className="floating-execution-note"><span>随手记<small>可选</small></span><textarea rows={3} maxLength={500} placeholder="记录进展或需要留意的事…" value={draft.note} disabled={disabled} onChange={(event) => onChange({ note: event.target.value })} /></label>
  </div>;
}

function CompletedBlockRecord({ notes, review, actualMinutes, recycled = false, hidden = false, disabled, onClose }: {
  notes: (string | null | undefined)[]; review?: PlanBlock["review"]; actualMinutes?: number | null;
  recycled?: boolean; hidden?: boolean; disabled: boolean; onClose: () => void;
}) {
  const savedNotes = [...new Set(notes.filter((note): note is string => Boolean(note)))];
  const actual = review?.actual_minutes ?? actualMinutes;
  const hasFacts = actual != null || review?.remaining_workload_minutes != null || review?.followup_action || review?.defer_reason;
  return <div className="completed-record" hidden={hidden}>
    {(savedNotes.length > 0 || hasFacts) && <section className="completed-record-details" aria-label="已有执行记录">
      {savedNotes.length > 0 && <div className="completed-record-notes"><span>随手记</span>{savedNotes.map((note, index) => <p key={index}>{note}</p>)}</div>}
      {hasFacts && <dl className="completed-record-facts">
        {actual != null && <div><dt>实际耗时</dt><dd>{actual} 分钟</dd></div>}
        {review?.remaining_workload_minutes != null && <div><dt>剩余工作量</dt><dd>{review.remaining_workload_minutes} 分钟</dd></div>}
        {review?.followup_action && <div><dt>下一步</dt><dd>{taskNextActionLabels[review.followup_action]}</dd></div>}
        {review?.defer_reason && <div><dt>原因</dt><dd>{review.defer_reason}</dd></div>}
      </dl>}
    </section>}
    {recycled && <p className="completed-record-recycled">任务已移入回收站，仅查看已有记录。</p>}
    <footer className="execution-capture-footer completed-record-footer"><span role="status">完成记录只读，不可修改</span><button type="button" className="quiet-button" disabled={disabled} onClick={onClose}>关闭</button></footer>
  </div>;
}

function RecurringOccurrenceResult({ occurrence, writable, disabled, hidden = false, onCancel, onSave }: {
  occurrence: RecurringOccurrence; writable: boolean; disabled: boolean; hidden?: boolean; onCancel: () => void;
  onSave: (outcome: RecurringOccurrenceOutcome | null, notes: string | null) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState(occurrence.outcome);
  const [notes, setNotes] = useState(occurrence.review_notes ?? "");
  useEffect(() => {
    setOutcome(occurrence.outcome);
    setNotes(occurrence.review_notes ?? "");
  }, [occurrence.id, occurrence.outcome, occurrence.review_notes]);
  const dirty = outcome !== occurrence.outcome || notes.trim() !== (occurrence.review_notes ?? "").trim();
  if (!writable && occurrence.outcome === "completed") return <CompletedBlockRecord notes={[occurrence.review_notes]} hidden={hidden} disabled={disabled} onClose={onCancel} />;
  return <><section className="recurring-occurrence-result" aria-label="本次执行结果" hidden={hidden}>
    {writable ? <>
      <div className="execution-capture-fields">
        <div className="execution-result-label">本次结果</div>
        <div className="floating-outcomes" role="group" aria-label="本次结果" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>{(["completed", "not_completed"] as const).map((value) => <button key={value} type="button" data-outcome={value} aria-pressed={outcome === value} disabled={disabled} onClick={() => setOutcome(outcome === value ? null : value)}>{outcome === value && <Icon name="check" size={14} />}{value === "completed" ? "本次完成" : "本次未完成"}</button>)}</div>
        <label className="floating-execution-note"><span>随手记<small>可选</small></span><textarea rows={3} maxLength={500} placeholder="记录进展或需要留意的事…" value={notes} disabled={disabled} onChange={(event) => setNotes(event.target.value)} /></label>
      </div>
      <p className="execution-capture-note">仅记录这一次，不影响其他日期或重复规则；未勾选不会自动记为未完成。</p>
    </> : occurrence.outcome ? <>
      <div className={`floating-capture-fact execution-${occurrence.outcome}`}><span>本次结果</span><strong>{occurrence.outcome === "completed" ? "完成" : occurrence.outcome === "partial" ? "部分完成" : "未完成"}</strong>{occurrence.review_notes && <p>{occurrence.review_notes}</p>}</div>
      {occurrence.outcome !== "completed" && <p className="execution-capture-note" role="status">历史已有结果及超出补录范围的记录保持只读。</p>}
    </> : <div className="floating-readonly"><strong>{occurrence.review_notes ? "随手记" : "尚无执行记录"}</strong>{occurrence.review_notes && <span>{occurrence.review_notes}</span>}<span>未来日期暂不可记录；历史已有结果及超出补录范围的记录保持只读。</span></div>}
  </section><footer className="execution-capture-footer" hidden={hidden}><div><button type="button" className="quiet-button" disabled={disabled} onClick={onCancel}>取消</button>{writable && <button type="button" className="primary-action" disabled={disabled || !dirty} onClick={() => { if (!disabled && dirty) void onSave(outcome, notes.trim() || null); }}>{disabled ? "正在保存…" : "保存"}</button>}</div></footer></>;
}
type PlanDraftTimeEdit = {
  blockIndex: number;
  sourceBlockId?: string;
  sourceStartsAt?: string;
  sourceEndsAt?: string;
  starts_at: string;
  ends_at: string;
  original_starts_at: string;
  original_ends_at: string;
  error: string;
};
type TimelineTooltipAnchor = "content" | "block-top" | "block-bottom";

function timeInputValue(timestamp: string) {
  return timestamp.slice(11, 16);
}

function normalizeDraftClock(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (/^\d{3}$/.test(digits)) return `0${digits[0]}:${digits.slice(1)}`;
  if (/^\d{4}$/.test(digits)) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  const parts = trimmed.split(":");
  if (parts.length === 2 && parts.every((part) => /^\d{1,2}$/.test(part))) {
    return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}`;
  }
  return trimmed;
}

function planDraftTimeChanged(edit: PlanDraftTimeEdit) {
  return normalizeDraftClock(edit.starts_at) !== normalizeDraftClock(edit.original_starts_at)
    || normalizeDraftClock(edit.ends_at) !== normalizeDraftClock(edit.original_ends_at);
}

function recurringTimeEditChanged(occurrence: RecurringOccurrence, edit: RecurringBlockTimeEdit) {
  return edit.date !== occurrence.occurrence_date || normalizeClockInput(edit.time) !== (occurrence.display_time ?? "")
    || edit.duration !== occurrence.display_duration_minutes;
}

function validDraftClock(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function taskBoundaryLabel(value: string | null, planDate: string) {
  if (!value) return "未限制";
  const date = value.slice(0, 10);
  const time = value.slice(11, 16);
  return date === planDate ? time : `${date} ${time}`;
}

function taskAllowedRangeLabel(task: Task | null, planDate: string) {
  if (!task) return null;
  const earliest = task.earliest_start_at ? taskBoundaryLabel(task.earliest_start_at, planDate) : null;
  const due = task.due_at ? taskBoundaryLabel(task.due_at, planDate) : null;
  if (earliest && due) return `${earliest} 至 ${due}`;
  if (earliest) return `${earliest} 之后`;
  if (due) return `${due} 之前`;
  return null;
}

function planDraftErrorMessage(reason: unknown, task: Task | null, planDate: string) {
  const raw = uiErrorMessage(reason);
  const allowedRange = taskAllowedRangeLabel(task, planDate);
  if (raw.includes("不能早于任务的最早开始时间")) {
    return allowedRange
      ? `开始时间过早。“${task?.title}”可安排在 ${allowedRange}。`
      : "开始时间早于任务允许范围，请查看任务的最早开始时间。";
  }
  if (raw.includes("不能晚于任务的截止时间")) {
    return allowedRange
      ? `结束时间过晚。“${task?.title}”可安排在 ${allowedRange}。`
      : "结束时间晚于任务截止时间，请缩短或前移时间块。";
  }
  return /[。！？]$/.test(raw) ? raw : `${raw}。`;
}

function planTimestamp(planDate: string, time: string) {
  return `${planDate}T${time}:00+08:00`;
}

function clockMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesClock(minutes: number) {
  const bounded = Math.max(0, Math.min(24 * 60, minutes));
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
}

type TimeRailSegment = {
  start: number;
  end: number;
};

function weekdayNumber(date: string) {
  const day = new Date(`${date}T00:00:00+08:00`).getDay();
  return day === 0 ? 7 : day;
}

function BlockEditorTimeRangeRail({
  start,
  end,
  onChange,
  minMinute = 0,
  maxMinute = 23 * 60 + 59,
  startMinuteOffset = 0,
  endMinuteOffset = 0,
  minimumDuration = MIN_TASK_BLOCK_MINUTES,
  disabled = false,
  describedBy,
  showPresets = true,
  inputsOnly = false,
  presetsOnly = false,
  allowMidnightEnd = false
}: {
  start: string;
  end: string;
  onChange: (next: { start: string; end: string }) => void;
  minMinute?: number;
  maxMinute?: number;
  startMinuteOffset?: number;
  endMinuteOffset?: number;
  minimumDuration?: number;
  disabled?: boolean;
  describedBy?: string;
  showPresets?: boolean;
  inputsOnly?: boolean;
  presetsOnly?: boolean;
  allowMidnightEnd?: boolean;
}) {
  const railStep = 5;
  const collapseThreshold = 4 * 60;
  const collapsedStartWidth = 31;
  const collapsedEndWidth = 31;
  const collapsedEndOffset = 100 - collapsedEndWidth;
  const trackRef = useRef<HTMLDivElement>(null);
  const startHandleRef = useRef<HTMLSpanElement>(null);
  const endHandleRef = useRef<HTMLSpanElement>(null);
  const startInputRef = useRef<HTMLInputElement>(null);
  const endInputRef = useRef<HTMLInputElement>(null);
  const wheelAnchorRef = useRef<HTMLElement | null>(null);
  const editingInputRef = useRef<TimeRangeEdge | null>(null);
  const dragRef = useRef<{ pointerId: number; edge: TimeRangeEdge; grabOffset: number } | null>(null);
  const presentationRef = useRef<ReturnType<typeof focusedTimeRangePresentation> | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<TimeRangeEdge | null>(null);
  const [activeEdge, setActiveEdge] = useState<TimeRangeEdge | null>(null);
  const [openWheelEdge, setOpenWheelEdge] = useState<TimeRangeEdge | null>(null);
  const startMinute = startMinuteOffset + clockMinutes(start);
  const endMinute = endMinuteOffset + clockMinutes(end);
  const startDomainMin = Math.max(minMinute, startMinuteOffset);
  const startDomainMax = Math.min(maxMinute, startMinuteOffset + 23 * 60 + 59);
  const endDomainMin = Math.max(minMinute, endMinuteOffset);
  const endDomainMax = Math.min(maxMinute, endMinuteOffset + (allowMidnightEnd ? 24 * 60 : 23 * 60 + 59));
  const safeStartMinute = Math.max(startDomainMin, Math.min(startMinute, startDomainMax, endMinute - minimumDuration));
  const safeEndMinute = Math.min(endDomainMax, Math.max(endMinute, endDomainMin, safeStartMinute + minimumDuration));
  const displayClock = (minute: number) => allowMidnightEnd && minute === endMinuteOffset + 24 * 60 ? "24:00" : minutesClock(((minute % (24 * 60)) + 24 * 60) % (24 * 60));
  const [inputValues, setInputValues] = useState(() => ({
    start: displayClock(safeStartMinute),
    end: displayClock(safeEndMinute)
  }));

  useEffect(() => {
    setInputValues((current) => {
      const next = {
        start: editingInputRef.current === "start" ? current.start : displayClock(safeStartMinute),
        end: editingInputRef.current === "end" ? current.end : displayClock(safeEndMinute)
      };
      return next.start === current.start && next.end === current.end ? current : next;
    });
  }, [safeStartMinute, safeEndMinute]);

  const safeRange = { start: safeStartMinute, end: safeEndMinute };
  const canKeepPresentationWhileDragging = draggingHandle !== null
    && presentationRef.current !== null
    && timeRangePresentationContains(presentationRef.current, safeRange);
  if (!presentationRef.current || (!canKeepPresentationWhileDragging && !timeRangePresentationCanReuse(
    presentationRef.current,
    safeRange,
    collapseThreshold
  ))) {
    presentationRef.current = focusedTimeRangePresentation(
      safeRange,
      minMinute,
      maxMinute,
      collapseThreshold,
      railStep
    );
  }

  const presentation = presentationRef.current;
  const collapsedPresentation = presentation.kind === "collapsed" ? presentation : null;
  const visibleWindow = presentation.kind === "continuous" ? presentation.window : null;
  const startRailBounds = collapsedPresentation?.startWindow ?? visibleWindow!;
  const endRailBounds = collapsedPresentation?.endWindow ?? visibleWindow!;
  const continuousSpan = visibleWindow ? Math.max(minimumDuration, visibleWindow.end - visibleWindow.start) : 0;
  const startSliderMin = Math.max(startRailBounds.start, startDomainMin);
  const startSliderMax = Math.min(startRailBounds.end, startDomainMax, safeEndMinute - minimumDuration);
  const endSliderMin = Math.max(endRailBounds.start, endDomainMin, safeStartMinute + minimumDuration);
  const endSliderMax = Math.min(endRailBounds.end, endDomainMax);

  function windowPosition(minute: number, window: TimeRailSegment, offset = 0, width = 100) {
    const span = Math.max(1, window.end - window.start);
    const ratio = Math.max(0, Math.min(1, (minute - window.start) / span));
    return offset + ratio * width;
  }

  function continuousPosition(minute: number) {
    return windowPosition(minute, visibleWindow!);
  }

  function edgePosition(edge: TimeRangeEdge, minute: number) {
    if (!collapsedPresentation) return continuousPosition(minute);
    return windowPosition(
      minute,
      edge === "start" ? collapsedPresentation.startWindow : collapsedPresentation.endWindow,
      edge === "start" ? 0 : collapsedEndOffset,
      edge === "start" ? collapsedStartWidth : collapsedEndWidth
    );
  }

  function emitRange(next: { start: number; end: number }) {
    const nextValues = { start: displayClock(next.start), end: displayClock(next.end) };
    setInputValues(nextValues);
    if (next.start === safeStartMinute && next.end === safeEndMinute) return;
    onChange(nextValues);
  }

  function updateEdge(edge: TimeRangeEdge, value: number) {
    const bounds = edge === "start" ? startRailBounds : endRailBounds;
    const edgeMinimum = Math.max(bounds.start, edge === "start" ? startDomainMin : endDomainMin);
    const edgeMaximum = Math.min(bounds.end, edge === "start" ? startDomainMax : endDomainMax);
    emitRange(constrainTimeRange(
      edge,
      value,
      { start: safeStartMinute, end: safeEndMinute },
      edgeMinimum,
      edgeMaximum,
      minimumDuration,
      railStep
    ));
  }

  function commitInput(edge: TimeRangeEdge, rawValue = inputValues[edge]) {
    const normalized = normalizeClockInput(sanitizeTimeInput(rawValue));
    if (!validDraftClock(normalized) && !(allowMidnightEnd && edge === "end" && normalized === "24:00")) {
      setInputValues({ start: displayClock(safeStartMinute), end: displayClock(safeEndMinute) });
      return;
    }
    const edgeOffset = edge === "start" ? startMinuteOffset : endMinuteOffset;
    const edgeMinimum = edge === "start" ? startDomainMin : endDomainMin;
    const edgeMaximum = edge === "start" ? startDomainMax : endDomainMax;
    emitRange(constrainTimeRange(
      edge,
      edgeOffset + clockMinutes(normalized),
      { start: safeStartMinute, end: safeEndMinute },
      edgeMinimum,
      edgeMaximum,
      minimumDuration,
      1
    ));
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>, edge: TimeRangeEdge) {
    if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      setOpenWheelEdge(edge);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commitInput(edge, event.currentTarget.value);
      event.currentTarget.select();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setInputValues({ start: displayClock(safeStartMinute), end: displayClock(safeEndMinute) });
      editingInputRef.current = null;
      event.currentTarget.blur();
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const normalized = normalizeClockInput(event.currentTarget.value);
    const fallbackMinute = edge === "start" ? safeStartMinute : safeEndMinute;
    const edgeOffset = edge === "start" ? startMinuteOffset : endMinuteOffset;
    const edgeMinimum = edge === "start" ? startDomainMin : endDomainMin;
    const edgeMaximum = edge === "start" ? startDomainMax : endDomainMax;
    const currentMinute = validDraftClock(normalized) ? edgeOffset + clockMinutes(normalized) : fallbackMinute;
    emitRange(constrainTimeRange(
      edge,
      currentMinute + (event.key === "ArrowUp" ? railStep : -railStep),
      { start: safeStartMinute, end: safeEndMinute },
      edgeMinimum,
      edgeMaximum,
      minimumDuration,
      1
    ));
  }

  function pointerMinute(clientX: number, grabOffset: number, edge: TimeRangeEdge) {
    const track = trackRef.current;
    if (!track) return null;
    const bounds = track.getBoundingClientRect();
    if (bounds.width <= 0) return null;
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left - grabOffset) / bounds.width));
    if (!collapsedPresentation) {
      return visibleWindow!.start + ratio * continuousSpan;
    }
    const window = edge === "start" ? collapsedPresentation.startWindow : collapsedPresentation.endWindow;
    const localRatio = edge === "start"
      ? Math.max(0, Math.min(1, ratio / (collapsedStartWidth / 100)))
      : Math.max(0, Math.min(1, (ratio - collapsedEndOffset / 100) / (collapsedEndWidth / 100)));
    return window.start + localRatio * (window.end - window.start);
  }

  function startPointerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return;
    const track = trackRef.current;
    const startHandle = startHandleRef.current;
    const endHandle = endHandleRef.current;
    if (!track || !startHandle || !endHandle) return;
    const trackBounds = track.getBoundingClientRect();
    if (trackBounds.width <= 0) return;
    const pointerRatio = (event.clientX - trackBounds.left) / trackBounds.width;
    if (collapsedPresentation && pointerRatio > collapsedStartWidth / 100 && pointerRatio < collapsedEndOffset / 100) return;
    event.preventDefault();
    const startBounds = startHandle.getBoundingClientRect();
    const endBounds = endHandle.getBoundingClientRect();
    const clickedEndpoint = event.target instanceof Element ? event.target.closest<HTMLElement>(".time-rail-endpoint-card") : null;
    const edge = clickedEndpoint?.classList.contains("start")
      ? "start"
      : clickedEndpoint?.classList.contains("end")
        ? "end"
        : closestTimeRangeEdge(
          event.clientX,
          startBounds.left + startBounds.width / 2,
          endBounds.left + endBounds.width / 2
        );
    const handleBounds = edge === "start" ? startBounds : endBounds;
    const handleCenter = handleBounds.left + handleBounds.width / 2;
    const logicalMinute = edge === "start" ? safeStartMinute : safeEndMinute;
    const logicalCenter = trackBounds.left + edgePosition(edge, logicalMinute) / 100 * trackBounds.width;
    const grabOffset = clickedEndpoint || Math.abs(event.clientX - handleCenter) <= 14 ? event.clientX - logicalCenter : 0;
    dragRef.current = { pointerId: event.pointerId, edge, grabOffset };
    setDraggingHandle(edge);
    event.currentTarget.setPointerCapture(event.pointerId);
    const minute = pointerMinute(event.clientX, grabOffset, edge);
    if (minute !== null) updateEdge(edge, minute);
  }

  function movePointerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const minute = pointerMinute(event.clientX, drag.grabOffset, drag.edge);
    if (minute !== null) updateEdge(drag.edge, minute);
  }

  function finishPointerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDraggingHandle(null);
  }

  function setDuration(durationMinutes: number) {
    if (safeStartMinute + durationMinutes > endDomainMax) return;
    emitRange({ start: safeStartMinute, end: safeStartMinute + durationMinutes });
  }

  function renderTrackWindow(window: TimeRailSegment, offset: number, width: number) {
    return <Fragment key={`${window.start}-${window.end}-${offset}`}>
      <span className="time-rail-track-piece" aria-hidden="true" style={{ left: `${offset}%`, width: `${width}%` }} />
    </Fragment>;
  }

  const compactDuration = (minutes: number) => [
    Math.floor(minutes / 60) > 0 ? `${Math.floor(minutes / 60)}h` : "",
    minutes % 60 > 0 ? `${minutes % 60}m` : ""
  ].filter(Boolean).join(" ");
  const durationMinutes = safeEndMinute - safeStartMinute;
  const durationText = compactDuration(durationMinutes);
  const durationLabel = formatWorkloadMinutes(durationMinutes);
  const startEndpointPosition = collapsedPresentation
    ? windowPosition(safeStartMinute, collapsedPresentation.startWindow)
    : 0;
  const endEndpointPosition = collapsedPresentation
    ? windowPosition(safeEndMinute, collapsedPresentation.endWindow)
    : 100;
  const highlightedEdge = draggingHandle ?? activeEdge;
  const continuousGeometry = continuousTimeRangeGeometry(presentation, safeRange);
  const continuousScaleMarks = (() => {
    if (!visibleWindow) return [];
    const position = (minute: number) => continuousPosition(minute);
    return continuousTimeScaleMarks(visibleWindow, { start: safeStartMinute, end: safeEndMinute }).map((mark) => {
      const markPosition = position(mark.minute);
      const edgeThreshold = mark.tone === "range" ? 15 : 6;
      return {
        ...mark,
        label: mark.tone === "range" ? `${displayClock(safeStartMinute)}–${displayClock(safeEndMinute)}` : displayClock(mark.minute),
        position: markPosition,
        alignment: markPosition <= edgeThreshold ? "start" : markPosition >= 100 - edgeThreshold ? "end" : null
      };
    });
  })();
  const startHandlePosition = edgePosition("start", safeStartMinute);
  const endHandlePosition = edgePosition("end", safeEndMinute);
  const endpointWrapPadding = 13;
  const startHandleLeft = `${startHandlePosition}%`;
  const endHandleLeft = `${endHandlePosition}%`;
  const selectionFillLeft = continuousGeometry ? `calc(${continuousGeometry.startPosition}% - ${endpointWrapPadding}px)` : "0%";
  const selectionFillRight = continuousGeometry ? `calc(${100 - continuousGeometry.endPosition}% - ${endpointWrapPadding}px)` : "0%";
  const intervalBadgeLeft = continuousGeometry ? `${continuousGeometry.midpointPosition}%` : "50%";

  function applyWheelTime(edge: TimeRangeEdge, nextClock: string) {
    const next = applyTimeWheelSelection(edge, nextClock, {
      start: displayClock(safeStartMinute),
      end: displayClock(safeEndMinute)
    }, {
      minimumMinute: startDomainMin,
      maximumMinute: endDomainMax,
      minimumDuration,
      allowMidnightEnd
    });
    const nextStart = startMinuteOffset + clockMinutes(next.start);
    const nextEnd = next.end === "24:00"
      ? endMinuteOffset + 24 * 60
      : endMinuteOffset + clockMinutes(next.end);
    emitRange({ start: nextStart, end: nextEnd });
  }

  function renderTimeInput(edge: TimeRangeEdge) {
    return <input ref={edge === "start" ? startInputRef : endInputRef} type="text" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={5} disabled={disabled} value={inputValues[edge]} aria-label={edge === "start" ? "输入开始时间" : "输入结束时间"} aria-describedby={inputsOnly ? undefined : describedBy} onFocus={(event) => { editingInputRef.current = edge; setActiveEdge(edge); event.currentTarget.select(); }} onClick={() => { if (!disabled) setOpenWheelEdge(edge); }} onChange={(event) => setInputValues((current) => ({ ...current, [edge]: sanitizeTimeInput(event.target.value) }))} onKeyDown={(event) => handleInputKeyDown(event, edge)} onBlur={() => { commitInput(edge); editingInputRef.current = null; setActiveEdge(null); }} />;
  }

  function renderTimeControl(edge: TimeRangeEdge) {
    return <>
      {renderTimeInput(edge)}
      <TimeWheelTrigger
        active={openWheelEdge === edge}
        disabled={disabled}
        label={edge === "start" ? "打开开始时间滚轴" : "打开结束时间滚轴"}
        controlsId="block-editor-time-wheel"
        onToggle={() => setOpenWheelEdge((current) => current === edge ? null : edge)}
      />
    </>;
  }

  const targetInput = openWheelEdge === "end" ? endInputRef.current : openWheelEdge === "start" ? startInputRef.current : null;
  wheelAnchorRef.current = (targetInput?.closest?.(".task-time-range-box, .block-editor-input-box") as HTMLElement | null) ?? targetInput;

  return <div className="time-range-rail block-editor">
    {!presetsOnly && (inputsOnly ? <TaskTimeRangeFields startInput={renderTimeControl("start")} endInput={renderTimeControl("end")} duration={durationMinutes} maxDuration={endDomainMax - safeStartMinute} disabled={disabled} showPresets={showPresets} onDuration={setDuration} /> : <div className="time-range-values block-editor-values" aria-label="选择开始和结束时间">
      <label className={highlightedEdge === "start" ? "is-active" : ""}><span><i className="time-range-marker start" aria-hidden="true" />开始</span><span className="block-editor-input-box">{renderTimeControl("start")}</span></label>
      <span className="time-range-connector" aria-hidden="true"><Icon name="chevron-right" size={14} /></span>
      <label className={highlightedEdge === "end" ? "is-active" : ""}><span><i className="time-range-marker end" aria-hidden="true" />结束</span><span className="block-editor-input-box">{renderTimeControl("end")}</span></label>
    </div>)}
    {!presetsOnly && <TimeWheelPopover
      id="block-editor-time-wheel"
      open={openWheelEdge !== null}
      edge={openWheelEdge ?? "start"}
      value={openWheelEdge ? inputValues[openWheelEdge] : inputValues.start}
      fallbackValue={displayClock(openWheelEdge === "end" ? safeEndMinute : safeStartMinute)}
      allowMidnightEnd={allowMidnightEnd}
      anchorRef={wheelAnchorRef}
      onSelect={(nextClock) => { if (openWheelEdge) applyWheelTime(openWheelEdge, nextClock); }}
      onClose={() => setOpenWheelEdge(null)}
    />}
    {!presetsOnly && !inputsOnly && describedBy && <small id={describedBy} className="sr-only">{collapsedPresentation
      ? <>拖动两侧端点<CopySeparator />中间不可拖动</>
      : <>手写 1 分钟<CopySeparator />时间轴与方向键 5 分钟<CopySeparator />最短 {minimumDuration} 分钟</>}</small>}
    {!presetsOnly && !inputsOnly && <div className="time-rail-surface">
      {collapsedPresentation ? <div className="time-rail-scale collapsed" aria-hidden="true">
        <span className="time-rail-scale-zone start"><i>{displayClock(collapsedPresentation.startWindow.start)}</i><strong>{displayClock(safeStartMinute)}</strong><i>{displayClock(collapsedPresentation.startWindow.end)}</i></span>
        <em>···</em>
        <span className="time-rail-scale-zone end"><i>{displayClock(collapsedPresentation.endWindow.start)}</i><strong>{displayClock(safeEndMinute)}</strong><i>{displayClock(collapsedPresentation.endWindow.end)}</i></span>
      </div> : <div className="time-rail-scale continuous" aria-hidden="true">{continuousScaleMarks.map((mark) => <span key={mark.key} className={`${mark.tone}${mark.alignment ? ` at-${mark.alignment}` : ""}`} style={{ left: `${mark.position}%` }}>{mark.label}</span>)}</div>}
      <div className={`time-rail-track-wrap${collapsedPresentation ? " is-collapsed" : " is-continuous"}${highlightedEdge ? ` active-${highlightedEdge}` : ""}${draggingHandle ? ` dragging-${draggingHandle}` : ""}${disabled ? " is-disabled" : ""}`} onPointerDown={startPointerDrag} onPointerMove={movePointerDrag} onPointerUp={finishPointerDrag} onPointerCancel={finishPointerDrag} onLostPointerCapture={finishPointerDrag}>
        <div ref={trackRef} className="time-rail-track" aria-hidden="true">
          {collapsedPresentation ? <>
            <span className="time-rail-break" aria-hidden="true" />
          </> : <>
            {renderTrackWindow(visibleWindow!, 0, 100)}
          </>}
        </div>
        {collapsedPresentation && <span className="time-rail-collapsed-duration" aria-hidden="true">{durationText}</span>}
        {!collapsedPresentation && <div className="time-rail-continuous-selection" aria-hidden="true">
          <span className="time-rail-selected-fill" style={{ left: selectionFillLeft, right: selectionFillRight }} />
          <span className="time-rail-interval-badge" style={{ left: intervalBadgeLeft }}>{durationText}</span>
        </div>}
        <input className="time-rail-range start" type="range" min={startSliderMin} max={startSliderMax} step={railStep} value={safeStartMinute} disabled={disabled} aria-label={`调整开始时间，${railStep} 分钟步进，最短 ${minimumDuration} 分钟`} aria-valuetext={displayClock(safeStartMinute)} aria-describedby={describedBy} onFocus={() => setActiveEdge("start")} onBlur={() => setActiveEdge(null)} onChange={(event) => updateEdge("start", Number(event.target.value))} />
        <input className="time-rail-range end" type="range" min={endSliderMin} max={endSliderMax} step={railStep} value={safeEndMinute} disabled={disabled} aria-label={`调整结束时间，${railStep} 分钟步进，最短 ${minimumDuration} 分钟`} aria-valuetext={displayClock(safeEndMinute)} aria-describedby={describedBy} onFocus={() => setActiveEdge("end")} onBlur={() => setActiveEdge(null)} onChange={(event) => updateEdge("end", Number(event.target.value))} />
        {collapsedPresentation ? <div className="time-rail-endpoint-cards" aria-hidden="true">
          <span ref={startHandleRef} className="time-rail-endpoint-card start">
            <i className="time-rail-endpoint-selection start" style={{ left: `${startEndpointPosition}%` }} />
            <i className="time-rail-endpoint-pin start" style={{ left: `${startEndpointPosition}%` }} />
            <span><i className="time-range-marker start" /><em>开始</em><strong>{displayClock(safeStartMinute)}</strong></span><i className="time-rail-grip"><b /><b /></i>
          </span>
          <span ref={endHandleRef} className="time-rail-endpoint-card end">
            <i className="time-rail-endpoint-selection end" style={{ right: `${100 - endEndpointPosition}%` }} />
            <i className="time-rail-endpoint-pin end" style={{ left: `${endEndpointPosition}%` }} />
            <i className="time-rail-grip"><b /><b /></i><span><em>结束</em><strong>{displayClock(safeEndMinute)}</strong><i className="time-range-marker end" /></span>
          </span>
        </div> : <div className="time-rail-handles" aria-hidden="true">
          <span ref={startHandleRef} className="time-rail-handle start" style={{ left: startHandleLeft }} />
          <span ref={endHandleRef} className="time-rail-handle end" style={{ left: endHandleLeft }} />
        </div>}
      </div>
      <output className="sr-only">当前时间间隔为 {durationLabel}</output>
    </div>}
    {!inputsOnly && showPresets && <TaskDurationPresets duration={durationMinutes} maxDuration={endDomainMax - safeStartMinute} disabled={disabled} onDuration={setDuration} />}
  </div>;
}

function timelineMinute(value: string, selectedDate: string, edge: "start" | "end") {
  const valueDate = value.slice(0, 10);
  if (valueDate < selectedDate) return 0;
  if (valueDate > selectedDate) return 24 * 60;
  const time = value.slice(11, 16).split(":").map(Number);
  if (time.length !== 2 || time.some((part) => !Number.isFinite(part))) return edge === "start" ? 0 : 24 * 60;
  return time[0] * 60 + time[1];
}

function timelinePosition(start: string, end: string, selectedDate: string, axisStart: number, pixelsPerHour: number) {
  const startMinute = timelineMinute(start, selectedDate, "start");
  const endMinute = timelineMinute(end, selectedDate, "end");
  return {
    "--timeline-top": `${Math.max(0, startMinute - axisStart) / 60 * pixelsPerHour}px`,
    "--timeline-height": `${timelineDurationHeight(startMinute, endMinute, pixelsPerHour)}px`
  } as CSSProperties;
}

function timelineLaneLayout<T extends { layoutKey: string; starts_at: string; ends_at: string }>(items: T[], selectedDate: string, drag: { key: string; start: number; end: number } | null, arrivals: readonly string[], capacity: number, preferred: string | null, holdSource: { start: number; end: number } | null = null) {
  return dayTimelineLayout(items.map((item) => ({
    layoutKey: item.layoutKey,
    startMinute: timelineMinute(item.starts_at, selectedDate, "start"),
    endMinute: timelineMinute(item.ends_at, selectedDate, "end")
  })), drag ? { layoutKey: drag.key, startMinute: drag.start, endMinute: drag.end } : null, arrivals, capacity, preferred, holdSource ? { layoutKey: "__drag_source__", startMinute: holdSource.start, endMinute: holdSource.end } : null);
}

function planDraftLayoutKeys(blocks: RulePlanBlock[]) {
  const duplicateCounts = new Map<string, number>();
  return blocks.map((block) => {
    const baseKey = `draft:${block.task_id}:${block.starts_at}:${block.ends_at}:${block.estimated_minutes}`;
    const duplicateIndex = duplicateCounts.get(baseKey) ?? 0;
    duplicateCounts.set(baseKey, duplicateIndex + 1);
    return `${baseKey}:${duplicateIndex}`;
  });
}

function timelineEventPosition(start: string, end: string, selectedDate: string, axisStart: number, pixelsPerHour: number, lane: TimelineLane, rangeStart = 0, rangeEnd = 100) {
  const gap = .8;
  const columnWidth = (rangeEnd - rangeStart) / lane.total;
  const left = rangeStart + lane.column * columnWidth;
  const occupiedWidth = lane.columnSpan * columnWidth;
  return {
    ...timelinePosition(start, end, selectedDate, axisStart, pixelsPerHour),
    left: `${left + gap / 2}%`,
    right: `${100 - left - occupiedWidth + gap / 2}%`
  } as CSSProperties;
}

function weekDateValues(selectedDate: string) {
  const selected = new Date(`${selectedDate}T00:00:00+08:00`);
  const weekdayName = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(selected);
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
  const mondayBasedIndex = weekdayIndex < 0 ? 0 : (weekdayIndex + 6) % 7;
  return Array.from({ length: 7 }, (_, index) => shiftDateValue(selectedDate, index - mondayBasedIndex));
}

function shanghaiClockParts(value: Date) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return { hour, minute, label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

function TodayPage({
  today, selectedDate, onSelectDate, tasks, recurringItems, recurringOccurrences, schedule, loading, error, preview, busy,
  onTrashTask, onUpdatePlan, onSaveBlockTime, onConfirmPlan, onCancelPlan, onOpenTasks, onOpenRecurringItem, onFactsChanged, onNotify, onNewTask, message,
  timelineReturnContext, onTimelineReturnHandled, onLocateTimeline, visible, todayView, onTodayViewChange, viewActionsRef
}: {
  today: string;
  selectedDate: string;
  onSelectDate: (date: string) => boolean;
  tasks: Task[];
  recurringItems: RecurringItem[];
  recurringOccurrences: RecurringOccurrence[];
  schedule: DaySchedule | null;
  loading: boolean;
  error: string | null;
  preview: RulePlanPreview | null;
  busy: boolean;
  onTrashTask: (taskId: string) => Promise<void>;
  onUpdatePlan: (preview: RulePlanPreview) => Promise<RulePlanPreview>;
  onSaveBlockTime: (block: PlanBlock, startsAt: string, endsAt: string) => Promise<void>;
  onConfirmPlan: () => void;
  onCancelPlan: () => Promise<boolean>;
  onOpenTasks: (taskId?: string, returnContext?: TimelineReturnContext) => void;
  onOpenRecurringItem: (itemId: string, returnContext: TimelineReturnContext) => void;
  onFactsChanged: (date?: string) => Promise<void>;
  onNotify: (label: string, message: string, icon?: IconName, undoId?: string, taskSeed?: TaskSeed) => void;
  onNewTask: (seed: TaskSeed) => void;
  visible: boolean;
  message: string;
  timelineReturnContext: TimelineReturnContext | null;
  onTimelineReturnHandled: () => void;
  onLocateTimeline?: (returnContext: TimelineReturnContext) => void;
  todayView: ScheduleView;
  onTodayViewChange: (view: ScheduleView) => void;
  viewActionsRef?: MutableRefObject<{ openDay: () => void; openWeek: () => void; openMonth: () => void } | null>;
}) {
  const [monthKey, setMonthKey] = useState(selectedDate.slice(0, 7));
  const [monthSelectionPending, setMonthSelectionPending] = useState(false);
  const setTodayView = onTodayViewChange;
  const [selection, setSelection] = useState<TimelineSelection | null>(null);
  const [planDraftTimeEdit, setPlanDraftTimeEdit] = useState<PlanDraftTimeEdit | null>(null);
  const [recurringTimeEdit, setRecurringTimeEdit] = useState<RecurringBlockTimeEdit | null>(null);
  const [pendingRecurringChange, setPendingRecurringChange] = useState<RecurringScheduleChange | null>(null);
  const [savingRecurringChange, setSavingRecurringChange] = useState(false);
  const [recurringChangeError, setRecurringChangeError] = useState("");
  const [monthRecurringOccurrences, setMonthRecurringOccurrences] = useState<RecurringOccurrence[]>([]);
  const [monthRecurringError, setMonthRecurringError] = useState("");
  const [executionDraft, setExecutionDraft] = useState<ExecutionDraft | null>(null);
  const [executionMessage, setExecutionMessage] = useState("");
  const [savingExecution, setSavingExecution] = useState(false);
  const [quickCompletingBlockId, setQuickCompletingBlockId] = useState<string | null>(null);
  const [quickCompletingTaskId, setQuickCompletingTaskId] = useState<string | null>(null);
  const [nightExpanded, setNightExpanded] = useState(false);
  const [pendingRecycledCompletion, setPendingRecycledCompletion] = useState<{ block: PlanBlock; date: string; note: string } | null>(null);
  const [recycledCompletionNote, setRecycledCompletionNote] = useState("");
  const [recycledCompletionError, setRecycledCompletionError] = useState<string | null>(null);
  const [pendingTrashBlock, setPendingTrashBlock] = useState<{ taskId: string; title: string } | null>(null);
  const [trashingBlock, setTrashingBlock] = useState(false);
  const [trashBlockError, setTrashBlockError] = useState<string | null>(null);
  const trashingBlockRef = useRef(false);
  const recurringResultSavingRef = useRef(false);
  const [clock, setClock] = useState(() => new Date());
  const [followingNow, setFollowingNow] = useState(true);
  const [showReturnToNow, setShowReturnToNow] = useState(false);
  const [timelineTooltip, setTimelineTooltip] = useState<TimelineTooltipState | null>(null);
  const timelineTooltipCardRef = useRef<HTMLElement>(null);
  const timelineTooltipTriggerRef = useRef<HTMLElement | null>(null);
  const timelineTooltipFocusRef = useRef<HTMLElement | null>(null);
  const timelineTooltipPointerRef = useRef<HTMLElement | null>(null);
  const timelineTooltipHideTimerRef = useRef<number | null>(null);
  const suppressTooltipFocusRef = useRef(false);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const agendaListRef = useRef<HTMLDivElement>(null);
  const agendaLocatedTargetRef = useRef<{ date: string; key: string } | null>(null);
  const agendaUserScrolledRef = useRef(false);
  const [agendaLocateRevision, setAgendaLocateRevision] = useState(0);
  const timelineCenteredDateRef = useRef<string | null>(null);
  const timelineEntryDateRef = useRef<string | null>(null);
  const returnToNowFrameRef = useRef(0);
  const locateTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (locateTimerRef.current !== null) window.clearTimeout(locateTimerRef.current); }, []);
  const timelineFloatingPanelRef = useRef<HTMLElement>(null);
  const timelineSelectionTriggerRef = useRef<HTMLElement | null>(null);
  const timelineSelectionAnchorRef = useRef<HTMLElement | null>(null);
  const [timelineDrag, setTimelineDrag] = useState<{ key: string; start: number; end: number; x: number; y: number; originalStart: number } | null>(null);
  const [laneCapacity, setLaneCapacity] = useState(Infinity);
  const [laneTrack, setLaneTrack] = useState<HTMLDivElement | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [overflowKeys, setOverflowKeys] = useState<string[] | null>(null);
  const [arrivals, setArrivals] = useState<{date: string; key: string; start: number; end: number}[]>([]);
  const [savingLayoutKey, setSavingLayoutKey] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!laneTrack) return;
    const measure = () => { if (laneTrack.clientWidth) setLaneCapacity(Math.max(1, Math.floor(laneTrack.clientWidth / 120))); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(laneTrack);
    return () => observer.disconnect();
  }, [laneTrack]);
  function rememberArrival(key: string, start: number, end: number) {
    setArrivals(previous => [...previous.filter(entry => entry.date !== selectedDate || entry.key !== key), {date: selectedDate, key, start, end}]);
    setRevealedKey(key);
  }
  const [savingDraggedBlock, setSavingDraggedBlock] = useState(false);
  const timelineDragRef = useRef<{
    key: string; block: PlanBlock | RulePlanBlock; draftIndex: number | null; preview: RulePlanPreview | null;
    element: HTMLElement; pointerId: number; downY: number; downScroll: number; y: number; x: number;
    originalStart: number; duration: number; start: number; active: boolean; sourceLane: TimelineLane;
    occurrence?: RecurringOccurrence;
  } | null>(null);
  const timelineDragFrameRef = useRef(0);
  const timelineDragSavingRef = useRef(false);
  const timelineDragClickRef = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) {
      setSelection(null);
      setPlanDraftTimeEdit(null);
      setTimelineTooltip(null);
      setTimelineCreateRange(null);
      setPendingTrashBlock(null);
      setTrashBlockError(null);
    }
  }, [visible]);
  const [timelineCreateRange, setTimelineCreateRange] = useState<TimelineCreateRange | null>(null);
  const cells = useMemo(() => calendarCells(monthKey), [monthKey]);

  useEffect(() => {
    let cancelled = false;
    setMonthRecurringOccurrences([]);
    setMonthRecurringError("");
    void listRecurringOccurrencesRange(cells[0].key, cells[cells.length - 1].key).then((items) => {
      if (!cancelled) setMonthRecurringOccurrences(items);
    }).catch((reason) => { if (!cancelled) setMonthRecurringError(`重复事项未载入：${uiErrorMessage(reason)}`); });
    return () => { cancelled = true; };
  }, [cells, recurringItems, recurringOccurrences]);

  const fixedEvents = schedule?.fixed_events ?? [];
  const taskBlocks = visibleTaskScheduleBlocks(schedule?.task_blocks ?? [], selectedDate, today);
  const timedEvents = fixedEvents.filter((event) => !event.is_all_day);
  const draftBlocks = preview?.blocks ?? [];
  const draftLayoutKeys = planDraftLayoutKeys(draftBlocks);
  const isAdjustingConfirmedPlan = Boolean(preview?.base_plan_id && preview.base_plan_id === schedule?.plan_id);
  const visibleTaskBlocks = isAdjustingConfirmedPlan
    ? taskBlocks.filter((block) => block.execution_status !== "planned" || Boolean(block.review) || tasks.some((task) => task.id === block.task_id && task.execution_locked))
    : taskBlocks;
  const timedRecurringOccurrences = recurringOccurrences.filter((item) => item.display_time && item.display_duration_minutes);
  const untimedRecurringOccurrences = recurringOccurrences
    .filter((item) => !item.display_time || !item.display_duration_minutes)
    .sort((left, right) => left.recurring_item_id.localeCompare(right.recurring_item_id) || left.id.localeCompare(right.id));
  const recurringTimelineBlocks = timedRecurringOccurrences.map((item) => {
    const starts_at = planTimestamp(selectedDate, item.display_time!);
    const endMinute = clockMinutes(item.display_time!) + item.display_duration_minutes!;
    const ends_at = endMinute === 1440 ? planTimestamp(shiftDateValue(selectedDate, 1), "00:00") : planTimestamp(selectedDate, minutesClock(endMinute));
    return { item, starts_at, ends_at, layoutKey: `recurring:${item.id}` };
  });
  const timelineItems = [
    ...timedEvents.map((event) => ({ ...event, layoutKey: `event:${event.id}`, timelineKind: "event" as const })),
    ...visibleTaskBlocks.map((block) => ({ ...block, layoutKey: `block:${block.id}`, timelineKind: "block" as const })),
    ...draftBlocks.map((block, index) => ({ ...block, layoutKey: draftLayoutKeys[index], timelineKind: "draft" as const })),
    ...recurringTimelineBlocks.map((block) => ({ ...block, layoutKey: block.layoutKey, timelineKind: "recurring" as const })),
    ...(timelineCreateRange ? [{ layoutKey: "create:selection", starts_at: planTimestamp(selectedDate, minutesClock(timelineCreateRange.start)), ends_at: planTimestamp(selectedDate, minutesClock(timelineCreateRange.end)), timelineKind: "create" as const }] : [])
  ];
  const arrivalKeys = arrivals.filter(entry => entry.date === selectedDate && timelineItems.some(item => item.layoutKey === entry.key && timelineMinute(item.starts_at, selectedDate, "start") === entry.start && timelineMinute(item.ends_at, selectedDate, "end") === entry.end)).map(entry => entry.key);
  const dragKey = savingLayoutKey && timelineItems.some(item => item.layoutKey === savingLayoutKey) ? savingLayoutKey : timelineDrag?.key;
  const layoutDrag = timelineDrag && dragKey ? {...timelineDrag, key: dragKey} : timelineCreateRange?.dragging ? {key: "create:selection", start: timelineCreateRange.start, end: timelineCreateRange.end} : null;
  const preferredKey = timelineDrag ? dragKey ?? null : timelineCreateRange ? "create:selection" : selection ? (selection.kind === "draft" ? draftLayoutKeys[Number(selection.id)] : `${selection.kind}:${selection.id}`) : revealedKey;
  const dayLayout = timelineLaneLayout(timelineItems, selectedDate, layoutDrag, timelineDrag && timelineDrag.originalStart !== timelineDrag.start && dragKey ? [...arrivalKeys.filter(key => key !== dragKey), dragKey] : arrivalKeys, laneCapacity, preferredKey, timelineDrag && typeof timelineDragRef !== "undefined" && timelineDragRef.current?.active ? { start: timelineDragRef.current.originalStart, end: timelineDragRef.current.originalStart + timelineDragRef.current.duration } : null);
  const timelineItemLanes = dayLayout.lanes;
  function overflowButton(group: (typeof dayLayout.summaries)[number]) {
    const label = `${minutesClock(group.startMinute)}–${minutesClock(group.endMinute)} 另 ${group.keys.length} 项`;
    return <button key={`${group.startMinute}:${group.endMinute}`} type="button" className="timeline-overflow-trigger" aria-label={label} aria-haspopup="dialog" disabled={Boolean(timelineDrag || timelineCreateRange?.dragging)}
      style={group.lane ? timelineEventPosition(dragTimestamp(group.startMinute), dragTimestamp(group.endMinute), selectedDate, axisStart, pixelsPerHour, group.lane) : undefined}
      onClick={() => { setTimelineTooltip(null); setOverflowKeys(group.keys); }}>{group.lane ? `另 ${group.keys.length} 项` : label}</button>;
  }
  const selectedBlock = selection?.kind === "block" ? taskBlocks.find((block) => block.id === selection.id) ?? null : null;
  const selectedEvent = selection?.kind === "event" ? fixedEvents.find((event) => event.id === selection.id) ?? null : null;
  const selectedRecurringOccurrence = selection?.kind === "recurring" ? recurringOccurrences.find((item) => item.id === selection.id) ?? null : null;
  const selectedRecurringFrame = recurringTimelineBlocks.find((block) => block.item.id === selectedRecurringOccurrence?.id);
  const selectedTask = tasks.find((task) => task.id === selectedBlock?.task_id);
  const selectedTaskIsCrossDay = Boolean(selectedTask?.earliest_start_date && selectedTask.due_date && selectedTask.earliest_start_date < selectedTask.due_date);
  const resultDate = selectedBlock?.result_date ?? selectedDate;
  const selectedBlockCompletionAction = timelineTaskCompletionAction(selectedBlock, selectedTask, resultDate, today, clock.getTime());
  const selectedBlockDialog = selectedBlock ? timelineTaskDialogState(selectedBlock) : null;
  const canAdjustSelectedBlock = Boolean(selectedBlock && selectedBlock.execution_status === "planned" && !selectedBlock.review && selectedDate >= today && !selectedTask?.execution_locked && ["open", "scheduled"].includes(selectedBlock.task_status));
  const canTrashSelectedBlock = Boolean(selectedBlock && selectedTask && !selectedTask.deleted_at && selectedBlock.execution_status === "planned" && !selectedBlock.review && selectedDate >= today && ["open", "scheduled"].includes(selectedBlock.task_status));
  const canRecordSelectedBlock = Boolean(selectedBlock && canCaptureTaskResult(selectedDate, today, selectedBlock, clock.getTime()));
  const selectedDraftIndex = selection?.kind === "draft" ? Number(selection.id) : -1;
  const selectedDraftBlock = selectedDraftIndex >= 0 ? draftBlocks[selectedDraftIndex] ?? null : null;
  const selectedDraftTask = selectedDraftBlock ? tasks.find((task) => task.id === selectedDraftBlock.task_id) ?? null : null;
  const selectedTimelineFrame = selectedBlock
    ? { starts_at: selectedBlock.starts_at, ends_at: selectedBlock.ends_at, layoutKey: `block:${selectedBlock.id}` }
    : selectedDraftBlock
      ? { starts_at: selectedDraftBlock.starts_at, ends_at: selectedDraftBlock.ends_at, layoutKey: draftLayoutKeys[selectedDraftIndex] }
      : selectedEvent && !selectedEvent.is_all_day
        ? { starts_at: selectedEvent.starts_at, ends_at: selectedEvent.ends_at, layoutKey: `event:${selectedEvent.id}` }
        : selectedRecurringFrame ?? null;
  const todayMonthKey = today.slice(0, 7);
  const monthTitle = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", timeZone: "Asia/Shanghai" })
    .format(new Date(`${monthKey}-01T00:00:00+08:00`));
  const selectedDateTitle = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Shanghai" })
    .format(new Date(`${selectedDate}T00:00:00+08:00`));
  const isPastDate = selectedDate < today;
  const shanghaiClock = shanghaiClockParts(clock);
  const nowMinute = shanghaiClock.hour * 60 + shanghaiClock.minute;
  const hasNightItems = useMemo(() => (
    timedEvents.some((event) => timelineMinute(event.starts_at, selectedDate, "start") < 7 * 60)
    || visibleTaskBlocks.some((block) => timelineMinute(block.starts_at, selectedDate, "start") < 7 * 60)
    || draftBlocks.some((block) => timelineMinute(block.starts_at, selectedDate, "start") < 7 * 60)
    || recurringTimelineBlocks.some((block) => timelineMinute(block.starts_at, selectedDate, "start") < 7 * 60)
    || (selectedDate === today && nowMinute < 7 * 60)
  ), [timedEvents, visibleTaskBlocks, draftBlocks, recurringTimelineBlocks, selectedDate, today, nowMinute]);
  const nightCollapsed = !nightExpanded && !hasNightItems;
  const axisStart = nightCollapsed ? 7 * 60 : 0;
  const axisEnd = 24 * 60;
  const timelineHours = Array.from({ length: (axisEnd - axisStart) / 60 + 1 }, (_, index) => axisStart / 60 + index);
  const pixelsPerHour = 72;
  const timelineHeight = (axisEnd - axisStart) / 60 * pixelsPerHour;
  const showNowLine = selectedDate === today && nowMinute >= axisStart && nowMinute <= axisEnd;
  const nowLabelOverlapDistance = 18;
  const allDayEvents = useMemo(() => fixedEvents.filter((event) => event.is_all_day && !event.deleted_at), [fixedEvents]);
  const untimedDayTasks = useMemo(
    () => visibleUntimedTasksForDate(tasks, taskBlocks, selectedDate)
      .sort((left, right) => right.created_at.localeCompare(left.created_at) || left.id.localeCompare(right.id)),
    [tasks, taskBlocks, selectedDate]
  );
  const priorityShortLabels: Record<NonNullable<Task["priority"]>, string> = { urgent: "P0", high: "P1", medium: "P2", low: "P3" };
  const agendaEntries = useMemo(() => {
    type AgendaEntry = {
      layoutKey: string;
      kind: "block" | "recurring" | "event";
      title: string;
      startsAt: string;
      endsAt: string;
      startMin: number;
      endMin: number;
      kindLabel: string;
      outcome: string | null;
      done: boolean;
      recorded: boolean;
      priority: Task["priority"];
      block?: PlanBlock;
      task?: Task;
      recurringItem?: RecurringOccurrence;
      tooltip: TimelineTooltipContent;
    };
    const entries: AgendaEntry[] = [
      ...visibleTaskBlocks.map((block) => {
        const task = tasks.find((candidate) => candidate.id === block.task_id);
        const { url, body } = splitTaskNotes(task?.notes ?? "");
        const effectiveOutcome = block.review?.outcome ?? (block.execution_status === "planned" ? null : block.execution_status);
        const startMin = timelineMinute(block.starts_at, selectedDate, "start");
        const endMin = timelineMinute(block.ends_at, selectedDate, "end");
        const range = timeRangeLabel(block.starts_at, block.ends_at);
        const duration = compactBlockDuration(timeRangeDurationMinutes(block.starts_at, block.ends_at));
        const type = taskBlockType(task);
        const tooltip: TimelineTooltipContent = {
          kind: type ? taskBlockTypeLabels[type].full : "普通任务",
          title: block.task_title,
          time: `${range} (${duration})`,
          detail: effectiveOutcome ? reviewOutcomeCopy[effectiveOutcome] : "点击定位时间轴",
          tone: effectiveOutcome ? `execution-${effectiveOutcome}` : "execution",
          url,
          note: body,
          tags: task?.tags,
          statusLabel: effectiveOutcome ? reviewOutcomeCopy[effectiveOutcome] : "已安排",
          priority: task?.priority,
          timeRange: range.replace(/\s*-\s*/, "–"),
          duration,
          footerKind: effectiveOutcome === "completed" ? "completed" : effectiveOutcome === "not_started" || effectiveOutcome === "blocked" ? "incomplete" : "hint",
          footerText: "点击定位时间轴"
        };
        return {
          layoutKey: `block:${block.id}`,
          kind: "block" as const,
          title: block.task_title,
          startsAt: block.starts_at,
          endsAt: block.ends_at,
          startMin,
          endMin,
          kindLabel: "任务安排",
          outcome: effectiveOutcome,
          done: effectiveOutcome === "completed",
          recorded: effectiveOutcome !== null,
          priority: task?.priority ?? null,
          block,
          task,
          tooltip
        };
      }),
      ...recurringTimelineBlocks.map((block) => {
        const { url, body } = splitTaskNotes(block.item.notes ?? "");
        const display = recurringBlockDisplay(block.item.outcome);
        const startMin = timelineMinute(block.starts_at, selectedDate, "start");
        const endMin = timelineMinute(block.ends_at, selectedDate, "end");
        const range = timeRangeLabel(block.starts_at, block.ends_at);
        const duration = compactBlockDuration(block.item.display_duration_minutes!);
        const tooltip: TimelineTooltipContent = {
          kind: "重复事项",
          title: block.item.title,
          time: `${range} (${duration})`,
          detail: `${display.label} · 点击定位时间轴`,
          tone: display.outcome === "planned" ? "execution" : `execution-${display.outcome}`,
          url,
          note: body,
          tags: block.item.tags,
          statusLabel: display.label,
          timeRange: range.replace(/\s*-\s*/, "–"),
          duration,
          footerKind: display.outcome === "completed" ? "completed" : display.outcome === "not_started" ? "incomplete" : "hint",
          footerText: "点击定位时间轴"
        };
        return {
          layoutKey: block.layoutKey,
          kind: "recurring" as const,
          title: block.item.title,
          startsAt: block.starts_at,
          endsAt: block.ends_at,
          startMin,
          endMin,
          kindLabel: "重复事项",
          outcome: block.item.outcome,
          done: block.item.outcome === "completed",
          recorded: Boolean(block.item.outcome),
          priority: null,
          recurringItem: block.item,
          tooltip
        };
      }),
      ...timedEvents.map((event) => {
        const startMin = timelineMinute(event.starts_at, selectedDate, "start");
        const endMin = timelineMinute(event.ends_at, selectedDate, "end");
        const range = timeRangeLabel(event.starts_at, event.ends_at);
        const duration = compactBlockDuration(timeRangeDurationMinutes(event.starts_at, event.ends_at));
        const tooltip: TimelineTooltipContent = {
          kind: "固定日程",
          title: event.title,
          time: range,
          detail: "固定日程 · 点击定位时间轴",
          tone: "fixed",
          statusLabel: "固定日程",
          duration,
          footerKind: "info",
          footerText: "点击定位时间轴"
        };
        return {
          layoutKey: `event:${event.id}`,
          kind: "event" as const,
          title: event.title,
          startsAt: event.starts_at,
          endsAt: event.ends_at,
          startMin,
          endMin,
          kindLabel: "固定日程",
          outcome: null,
          done: false,
          recorded: false,
          priority: null,
          tooltip
        };
      })
    ];
    return entries.sort((left, right) => {
      const startDiff = left.startMin - right.startMin;
      if (startDiff !== 0) return startDiff;
      const colDiff = (timelineItemLanes[left.layoutKey]?.column ?? Number.MAX_SAFE_INTEGER)
        - (timelineItemLanes[right.layoutKey]?.column ?? Number.MAX_SAFE_INTEGER);
      if (colDiff !== 0) return colDiff;
      const endDiff = right.endMin - left.endMin;
      return endDiff !== 0 ? endDiff : left.layoutKey.localeCompare(right.layoutKey);
    });
  }, [visibleTaskBlocks, recurringTimelineBlocks, timedEvents, tasks, selectedDate, timelineItemLanes]);
  function isAgendaEntryRunningNow(entry: { done: boolean; recorded: boolean; startMin: number; endMin: number }) {
    return !entry.done && !entry.recorded && selectedDate === today && entry.startMin <= nowMinute && entry.endMin > nowMinute;
  }
  const runningAgendaEntry = useMemo(
    () => (selectedDate === today ? agendaEntries.find(isAgendaEntryRunningNow) ?? null : null),
    [agendaEntries, selectedDate, today, nowMinute]
  );
  const runningAgendaKey = runningAgendaEntry?.layoutKey ?? null;
  const weekDates = useMemo(() => weekDateValues(selectedDate), [selectedDate]);
  const selectedWeekday = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", weekday: "long" })
    .format(new Date(`${selectedDate}T00:00:00+08:00`));
  const selectedShortDateTitle = selectedDateTitle.replace(/^\d{4}年/, "");
  const selectedWeek = isoWeekParts(selectedDate);
  const selectedWeekDates = weekDatesFor(selectedDate);
  const selectedWeekHeading = weekHeading(selectedWeekDates[0], selectedWeekDates[6]);
  const isCurrentWeek = selectedWeekDates[0] === weekDatesFor(today)[0];
  const headingContext = todayView === "month" ? `${monthTitle} · 月历总览`
    : todayView === "week" ? `${selectedWeek.year} 第${selectedWeek.week}周 · 周日程`
    : `${selectedWeek.year} 第 ${selectedWeek.week} 专注周 · ${selectedWeekday.replace("星期", "周")}日计划`;
  const windowTitle = `今序 · Dayweave / ${headingContext}`;

  useEffect(() => {
    void setAppWindowTitle(windowTitle).catch((reason) => console.error("无法更新窗口标题", reason));
  }, [windowTitle]);

  useEffect(() => () => {
    void setAppWindowTitle("今序 · Dayweave").catch((reason) => console.error("无法恢复窗口标题", reason));
  }, []);

  const selectedLunarDate = lunarDateLabel(selectedDate);
  const selectedSolarTerm = solarTermProgressLabel(selectedDate);
  const monthMeta = useMemo(() => monthOverviewMeta(monthKey), [monthKey]);
  const selectedWeekPeriod = weekPeriodLabel(selectedWeekDates[3]);

  if (viewActionsRef) {
    viewActionsRef.current = {
      openDay: () => openTimelineDate(selectedDate),
      openWeek: () => {
        setSelection(null);
        setPlanDraftTimeEdit(null);
        setTimelineTooltip(null);
        setTodayView("week");
      },
      openMonth: returnToMonth
    };
  }
  useEffect(() => () => {
    if (viewActionsRef) viewActionsRef.current = null;
  }, [viewActionsRef]);

  function canDragTimelineBlock(block: PlanBlock | RulePlanBlock, draft = false) {
    const task = tasks.find((item) => item.id === block.task_id);
    return !isPastDate && !busy && !loading && !savingExecution && !quickCompletingBlockId
      && !timelineDragSavingRef.current && !planDraftTimeEdit
      && Boolean(task && ["open", "scheduled"].includes(task.status) && !task.execution_locked)
      && (draft || !preview && "execution_status" in block && block.execution_status === "planned"
        && !block.review && !block.execution_captured_at && !block.actual_minutes)
      && block.starts_at.slice(0, 10) === selectedDate
      && timeRangeDurationMinutes(block.starts_at, block.ends_at) >= MIN_TASK_BLOCK_MINUTES
      && timeRangeDurationMinutes(block.starts_at, block.ends_at) === timelineMinute(block.ends_at, selectedDate, "end") - timelineMinute(block.starts_at, selectedDate, "start");
  }

  function canRecordRecurringOccurrence(item: RecurringOccurrence) {
    const rule = recurringItems.find((candidate) => candidate.id === item.recurring_item_id);
    return canCaptureRecurringResult(item.occurrence_date, shanghaiDateValue(), item.outcome, Boolean(rule));
  }

  async function saveRecurringResult(item: RecurringOccurrence, outcome: RecurringOccurrenceOutcome | null, notes: string | null) {
    if (recurringResultSavingRef.current || quickCompletingBlockId || savingExecution || busy || loading || preview || savingDraggedBlock || timelineDrag || savingRecurringChange || pendingRecurringChange) return;
    if (!canRecordRecurringOccurrence(item)) { onNotify("本次结果不可修改", "未来日期暂不可记录，历史已有结果保持只读。", "review"); return; }
    recurringResultSavingRef.current = true;
    setQuickCompletingBlockId(item.id);
    let saved = false;
    try {
      const noteOnly = !outcome && !item.outcome && Boolean(notes?.trim() || item.review_notes);
      const previousUndo = outcome === "completed" ? await latestUndo().catch(() => null) : null;
      if (outcome || noteOnly) await saveRecurringOccurrenceReview(item.id, { outcome, notes: notes?.trim() || null });
      else await clearRecurringOccurrenceReview(item.id, notes?.trim() || null);
      saved = true;
      let undoId: string | undefined;
      if (outcome === "completed") {
        const undo = await latestUndo().catch(() => null);
        if (undo?.target_type === "recurring_review" && undo.target_id === item.id && undo.id !== previousUndo?.id) undoId = undo.id;
      }
      await onFactsChanged(item.occurrence_date);
      onNotify(outcome === "completed" ? "本次已完成" : outcome === "not_completed" ? "本次未完成" : noteOnly ? "随手记已保存" : outcome ? "本次结果已保存" : item.outcome ? `已取消本次${item.outcome === "completed" ? "完成" : item.outcome === "partial" ? "部分完成" : "未完成"}` : "已取消本次结果", "", "check", undoId);
    } catch (reason) { onNotify(saved ? "结果已保存，界面刷新失败" : "本次结果未保存", uiErrorMessage(reason), "review"); }
    finally { recurringResultSavingRef.current = false; setQuickCompletingBlockId(null); }
  }

  function canEditRecurringOccurrence(item: RecurringOccurrence) {
    const rule = recurringItems.find((candidate) => candidate.id === item.recurring_item_id);
    return item.occurrence_date >= shanghaiDateValue() && Boolean(rule && !rule.deleted_at && rule.status === "active")
      && !busy && !loading && !savingExecution && !savingRecurringChange && !pendingRecurringChange && !timelineDragSavingRef.current;
  }

  function recurringInput(item: RecurringOccurrence) {
    const rule = recurringItems.find((candidate) => candidate.id === item.recurring_item_id);
    return rule ? recurringOccurrenceInput(recurringItemInputForForm(recurringItemFormForItem(rule)), item) : null;
  }

  function stageRecurringChange(change: RecurringScheduleChange) {
    const issue = recurringChangeIssue(change, shanghaiDateValue());
    if (issue) { onNotify("安排未修改", issue, "review"); setTimelineDrag(null); return; }
    setSelection(null);
    setRecurringTimeEdit(null);
    setTimelineTooltip(null);
    setRecurringChangeError("");
    setPendingRecurringChange(change);
  }

  function cancelRecurringChange() {
    if (savingRecurringChange) return;
    setPendingRecurringChange(null);
    setTimelineDrag(null);
    setTimelineTooltip(null);
    window.requestAnimationFrame(() => timelineScrollRef.current?.focus({ preventScroll: true }));
  }

  async function commitTimelineRecurringChange(scope: RecurringEditScope) {
    if (!pendingRecurringChange || savingRecurringChange) return;
    const issue = recurringChangeIssue(pendingRecurringChange, shanghaiDateValue());
    if (issue) { setRecurringChangeError(issue); return; }
    setSavingRecurringChange(true);
    setRecurringChangeError("");
    try {
      await updateRecurringOccurrence(pendingRecurringChange.occurrence.id, pendingRecurringChange.input, pendingRecurringChange.targetDate, scope);
      setPendingRecurringChange(null);
      if (timelineDrag) rememberArrival(timelineDrag.key, timelineDrag.start, timelineDrag.end);
      try { await onFactsChanged(selectedDate); } finally { setTimelineDrag(null); }
      onNotify(scope === "this" ? "已修改这一次安排" : "已修改这一次及未来安排", "历史任务块保持不变。", "check");
    } catch (reason) { setRecurringChangeError(`未保存，原安排已保留：${uiErrorMessage(reason)}`); }
    finally { setSavingRecurringChange(false); }
  }

  function selectRecurringOccurrence(item: RecurringOccurrence, trigger: HTMLElement, anchor: HTMLElement) {
    if (savingRecurringChange || pendingRecurringChange || recurringResultSavingRef.current) return;
    selectTimelineItem({ kind: "recurring", id: item.id }, trigger, anchor);
    setRecurringTimeEdit(null);
  }

  function adjustRecurringOccurrenceTime() {
    if (!selectedRecurringOccurrence || !canEditRecurringOccurrence(selectedRecurringOccurrence) || recurringResultSavingRef.current) return;
    const item = selectedRecurringOccurrence;
    setRecurringTimeEdit({ date: item.occurrence_date, time: item.display_time ?? "09:00", duration: item.display_duration_minutes ?? 60, error: "" });
    window.requestAnimationFrame(() => timelineFloatingPanelRef.current?.focus());
  }

  function returnToRecurringOccurrenceDetails() {
    if (savingRecurringChange || pendingRecurringChange || recurringResultSavingRef.current) return;
    setRecurringTimeEdit(null);
    window.requestAnimationFrame(() => timelineFloatingPanelRef.current?.querySelector<HTMLElement>(".execution-time-value")?.focus());
  }

  function saveRecurringTimeEdit(event: FormEvent) {
    event.preventDefault();
    if (!selectedRecurringOccurrence || !recurringTimeEdit || !canEditRecurringOccurrence(selectedRecurringOccurrence) || recurringResultSavingRef.current) return;
    if (!recurringTimeEditChanged(selectedRecurringOccurrence, recurringTimeEdit)) return;
    const input = recurringInput(selectedRecurringOccurrence);
    if (!input) return;
    const change = { occurrence: selectedRecurringOccurrence, input: { ...input, display_time: normalizeClockInput(recurringTimeEdit.time), display_duration_minutes: recurringTimeEdit.duration }, targetDate: recurringTimeEdit.date };
    const issue = recurringChangeIssue(change, shanghaiDateValue());
    if (issue) { setRecurringTimeEdit({ ...recurringTimeEdit, error: issue }); return; }
    stageRecurringChange(change);
  }

  function dragTimestamp(minute: number) {
    return minute === 1440 ? planTimestamp(shiftDateValue(selectedDate, 1), "00:00")
      : planTimestamp(selectedDate, minutesClock(minute));
  }

  function clearTimelineDrag() {
    const current = timelineDragRef.current;
    timelineDragRef.current = null;
    window.cancelAnimationFrame(timelineDragFrameRef.current);
    if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    return current;
  }

  function cancelTimelineDrag() {
    const current = clearTimelineDrag();
    if (!current) return;
    if (current.active) timelineDragClickRef.current = current.key;
    setTimelineDrag(null);
    if (current.active) current.element.querySelector<HTMLElement>(".timeline-event-body")?.focus({ preventScroll: true });
  }

  function beginTimelineDrag(event: ReactPointerEvent<HTMLElement>, block: PlanBlock | RulePlanBlock, draftIndex: number | null = null, occurrence?: RecurringOccurrence) {
    timelineDragClickRef.current = null;
    if (recurringResultSavingRef.current || event.button !== 0 || event.pointerType !== "mouse" || (occurrence ? !canEditRecurringOccurrence(occurrence) : !canDragTimelineBlock(block, draftIndex !== null))
      || (event.target instanceof Element && event.target.closest(".timeline-event-check"))) return;
    const scroller = timelineScrollRef.current;
    if (!scroller || timelineDragRef.current) return;
    event.preventDefault();
    pauseTimelineFollowing();
    const start = timelineMinute(block.starts_at, selectedDate, "start");
    const key = occurrence ? `recurring:${occurrence.id}` : draftIndex === null ? `block:${(block as PlanBlock).id}` : draftLayoutKeys[draftIndex];
    timelineDragRef.current = {
      key,
      block: { ...block }, draftIndex, preview, element: event.currentTarget, pointerId: event.pointerId,
      downY: event.clientY, downScroll: scroller.scrollTop, y: event.clientY, x: event.clientX,
      originalStart: start, duration: timeRangeDurationMinutes(block.starts_at, block.ends_at), start, active: false,
      sourceLane: timelineItemLanes[key], occurrence
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateTimelineDrag() {
    const current = timelineDragRef.current, scroller = timelineScrollRef.current;
    if (!current?.active || !scroller) return;
    const movement = (current.y - current.downY + scroller.scrollTop - current.downScroll) * 60 / pixelsPerHour;
    const minMinute = typeof axisStart === "number" ? axisStart : 0;
    current.start = Math.max(minMinute, Math.min(1440 - current.duration, Math.round((current.originalStart + movement) / 15) * 15));
    setTimelineDrag((previous) => previous?.key === current.key && previous.start === current.start && previous.end === current.start + current.duration
      && previous.x === current.x && previous.y === current.y ? previous
      : { key: current.key, start: current.start, end: current.start + current.duration, originalStart: current.originalStart, x: current.x, y: current.y });
  }

  function scrollTimelineDrag() {
    const current = timelineDragRef.current, scroller = timelineScrollRef.current;
    if (!current?.active || !scroller) return;
    const bounds = scroller.getBoundingClientRect(), edge = 36;
    const speed = current.y < bounds.top + edge ? -Math.min(7, (bounds.top + edge - current.y) / 4)
      : current.y > bounds.bottom - edge ? Math.min(7, (current.y - bounds.bottom + edge) / 4) : 0;
    if (speed) scroller.scrollTop += speed;
    updateTimelineDrag();
    timelineDragFrameRef.current = window.requestAnimationFrame(scrollTimelineDrag);
  }

  function moveTimelineDrag(event: ReactPointerEvent<HTMLElement>) {
    const current = timelineDragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    current.x = event.clientX; current.y = event.clientY;
    if (!current.active && Math.abs(current.y - current.downY) >= 5) {
      current.active = true;
      setSelection(null); setExecutionDraft(null); setTimelineTooltip(null);
      timelineDragFrameRef.current = window.requestAnimationFrame(scrollTimelineDrag);
    }
    updateTimelineDrag();
  }

  async function finishTimelineDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerId !== timelineDragRef.current?.pointerId) return;
    const current = clearTimelineDrag();
    if (!current?.active) return;
    timelineDragClickRef.current = current.key;
    if (current.start === current.originalStart) { setTimelineDrag(null); return; }
    if (current.occurrence) {
      const input = recurringInput(current.occurrence);
      if (!input) { setTimelineDrag(null); return; }
      stageRecurringChange({ occurrence: current.occurrence, input: { ...input, display_time: minutesClock(current.start), display_duration_minutes: current.duration }, targetDate: selectedDate });
      return;
    }
    timelineDragSavingRef.current = true;
    setSavingDraggedBlock(true);
    const startsAt = dragTimestamp(current.start), endsAt = dragTimestamp(current.start + current.duration);
    try {
      if (current.draftIndex !== null && current.preview) {
        const blocks = current.preview.blocks.map((block, index) => index === current.draftIndex ? { ...block, starts_at: startsAt, ends_at: endsAt } : block);
        const key = planDraftLayoutKeys(blocks)[current.draftIndex];
        setSavingLayoutKey(key);
        await onUpdatePlan({ ...current.preview, blocks });
        rememberArrival(key, current.start, current.start + current.duration);
      } else {
        await onSaveBlockTime(current.block as PlanBlock, startsAt, endsAt);
        rememberArrival(current.key, current.start, current.start + current.duration);
      }
    } catch (reason) {
      onNotify("时间未保存", `${planDraftErrorMessage(reason, tasks.find((task) => task.id === current.block.task_id) ?? null, selectedDate)} 原安排已保留。`, "review");
    } finally {
      timelineDragSavingRef.current = false;
      setSavingLayoutKey(null);
      setSavingDraggedBlock(false); setTimelineDrag(null);
      if (current.element.isConnected) (current.element.querySelector<HTMLElement>(".timeline-event-body") ?? current.element).focus({ preventScroll: true });
      setTimelineTooltip(null);
    }
  }

  function draggedTimelineStyle(key: string, original: CSSProperties) {
    return timelineDrag?.key === key ? { ...original, "--timeline-top": `${Math.max(0, timelineDrag.start - axisStart) / 60 * pixelsPerHour}px`, "--timeline-height": `${timelineDurationHeight(timelineDrag.start, timelineDrag.end, pixelsPerHour)}px` } as CSSProperties : original;
  }

  useEffect(() => {
    const cancelOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !timelineDragRef.current) return;
      event.preventDefault(); event.stopPropagation(); cancelTimelineDrag();
    };
    document.addEventListener("keydown", cancelOnEscape, true);
    window.addEventListener("blur", cancelTimelineDrag);
    return () => {
      document.removeEventListener("keydown", cancelOnEscape, true);
      window.removeEventListener("blur", cancelTimelineDrag);
      clearTimelineDrag();
    };
  }, []);

  useEffect(() => {
    cancelTimelineDrag(); setTimelineDrag(null); setOverflowKeys(null); setRevealedKey(null);
  }, [selectedDate, todayView, visible]);
  useEffect(() => { if (timelineDragRef.current) cancelTimelineDrag(); }, [preview?.version, schedule]);
  useEffect(() => { setTimelineCreateRange(null); }, [selectedDate, todayView]);

  function showTimelineTooltipForTarget(content: TimelineTooltipContent, target: HTMLElement, anchorMode: TimelineTooltipAnchor, pointer?: { x: number; y: number }) {
    if (timelineDragRef.current?.active || timelineDragSavingRef.current) return;
    cancelTimelineTooltipHide();
    if (isTaskTimelineTooltip(content) && timelineTooltip && timelineTooltipTriggerRef.current === target) return;
    timelineTooltipTriggerRef.current = target;
    const targetRect = target.getBoundingClientRect();
    const scrollRect = target.closest(".timeline-events") ? timelineScrollRef.current?.getBoundingClientRect() : null;
    if (isTaskTimelineTooltip(content)) {
      setTimelineTooltip({ ...content, left: 0, top: 0, placement: "below", pointer: pointer ?? {
        x: targetRect.right, y: Math.max(targetRect.top, scrollRect?.top ?? 12)
      } });
      return;
    }
    const contentAnchor = anchorMode === "content"
      ? target.querySelector<HTMLElement>(".timeline-event-copy, .lane-copy, :scope > span")
      : null;
    const contentRect = contentAnchor?.getBoundingClientRect() ?? targetRect;
    const tooltipHalfWidth = 148;
    const tooltipHeight = 126;
    if (anchorMode === "block-top" || anchorMode === "block-bottom") {
      const anchorTop = scrollRect ? Math.max(targetRect.top, scrollRect.top) : targetRect.top;
      const anchorBottom = scrollRect ? Math.min(targetRect.bottom, scrollRect.bottom) : targetRect.bottom;
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const prefersBelow = anchorMode === "block-bottom";
      const placement = prefersBelow && viewportHeight - anchorBottom >= tooltipHeight
        ? "below"
        : anchorTop >= tooltipHeight ? "above" : "below";
      setTimelineTooltip({
        ...content,
        left: prefersBelow
          ? Math.max(tooltipHalfWidth, Math.min(viewportWidth - tooltipHalfWidth, targetRect.right - tooltipHalfWidth))
          : Math.max(tooltipHalfWidth, Math.min(viewportWidth - tooltipHalfWidth, targetRect.left + targetRect.width / 2)),
        top: placement === "above" ? anchorTop - 12 : anchorBottom + 12,
        placement
      });
      return;
    }
    const visibleTop = scrollRect ? Math.max(contentRect.top, scrollRect.top) : contentRect.top;
    const visibleBottom = scrollRect ? Math.min(contentRect.bottom, scrollRect.bottom) : contentRect.bottom;
    const contentIsVisible = visibleBottom > visibleTop;
    const anchorRect = contentIsVisible ? contentRect : targetRect;
    const anchorTop = contentIsVisible ? visibleTop : scrollRect ? Math.max(targetRect.top, scrollRect.top) : targetRect.top;
    const anchorBottom = contentIsVisible ? visibleBottom : scrollRect ? Math.min(targetRect.bottom, scrollRect.bottom) : targetRect.bottom;
    const viewportWidth = document.documentElement.clientWidth;
    const placement = anchorTop >= tooltipHeight ? "above" : "below";
    setTimelineTooltip({
      ...content,
      left: Math.max(tooltipHalfWidth, Math.min(viewportWidth - tooltipHalfWidth, anchorRect.left + anchorRect.width / 2)),
      top: placement === "above" ? anchorTop - 10 : anchorBottom + 10,
      placement
    });
  }

  function cancelTimelineTooltipHide() {
    if (timelineTooltipHideTimerRef.current !== null) window.clearTimeout(timelineTooltipHideTimerRef.current);
    timelineTooltipHideTimerRef.current = null;
  }

  function hideTimelineTooltip() {
    cancelTimelineTooltipHide();
    timelineTooltipPointerRef.current = null;
    setTimelineTooltip(null);
  }

  function scheduleTimelineTooltipHide() {
    cancelTimelineTooltipHide();
    timelineTooltipHideTimerRef.current = window.setTimeout(() => {
      timelineTooltipHideTimerRef.current = null;
      const focused = document.activeElement;
      if (timelineTooltipPointerRef.current || timelineTooltipTriggerRef.current?.contains(focused)
        || timelineTooltipCardRef.current?.contains(focused)) return;
      hideTimelineTooltip();
    }, 200);
  }

  function timelineTooltipProps(content: TimelineTooltipContent, anchorMode: TimelineTooltipAnchor = "content") {
    const interactive = isTaskTimelineTooltip(content);
    return {
      "aria-describedby": interactive ? undefined : "timeline-time-block-tooltip",
      "aria-details": interactive ? "timeline-time-block-tooltip" : undefined,
      "aria-keyshortcuts": interactive ? "ArrowDown" : undefined,
      "aria-description": interactive ? "按向下方向键进入任务资料，Esc 关闭" : undefined,
      onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => {
        if (event.pointerType === "touch") return;
        timelineTooltipPointerRef.current = event.currentTarget;
        showTimelineTooltipForTarget(content, event.currentTarget, anchorMode, { x: event.clientX, y: event.clientY });
      },
      onPointerLeave: () => {
        timelineTooltipPointerRef.current = null;
        if (interactive) scheduleTimelineTooltipHide(); else hideTimelineTooltip();
      },
      onFocus: (event: React.FocusEvent<HTMLElement>) => {
        if ((typeof suppressTooltipFocusRef !== "undefined" && suppressTooltipFocusRef.current) || (event.target as HTMLElement).closest(".timeline-event-check") || (event.target as HTMLElement).closest(".today-untimed-check")) {
          hideTimelineTooltip();
          return;
        }
        timelineTooltipFocusRef.current = event.target as HTMLElement;
        showTimelineTooltipForTarget(content, event.currentTarget, anchorMode);
      },
      onBlur: (event: React.FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          if (interactive) scheduleTimelineTooltipHide(); else hideTimelineTooltip();
        }
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (interactive && event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          cancelTimelineTooltipHide();
          if (timelineTooltipCardRef.current) timelineTooltipCardRef.current.focus({ preventScroll: true });
          else {
            showTimelineTooltipForTarget(content, event.currentTarget, anchorMode);
            window.requestAnimationFrame(() => timelineTooltipCardRef.current?.focus({ preventScroll: true }));
          }
        }
      }
    };
  }

  useEffect(() => {
    let timer = 0;
    const syncClock = () => setClock(new Date());
    const scheduleNextSecond = () => {
      syncClock();
      const delay = 1000 - Date.now() % 1000 + 20;
      timer = window.setTimeout(scheduleNextSecond, delay);
    };
    const syncVisibleClock = () => { if (document.visibilityState === "visible") syncClock(); };
    scheduleNextSecond();
    window.addEventListener("focus", syncClock);
    window.addEventListener("pageshow", syncClock);
    document.addEventListener("visibilitychange", syncVisibleClock);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", syncClock);
      window.removeEventListener("pageshow", syncClock);
      document.removeEventListener("visibilitychange", syncVisibleClock);
    };
  }, []);

  useEffect(() => {
    setFollowingNow(selectedDate === today);
  }, [selectedDate, today]);

  useEffect(() => {
    setMonthSelectionPending(false);
  }, [selectedDate]);

  useEffect(() => {
    const enteringDate = timelineEntryDateRef.current === selectedDate;
    if (selectedDate !== today) timelineCenteredDateRef.current = null;
    if (timelineReturnContext) {
      timelineEntryDateRef.current = null;
      return;
    }
    if (!enteringDate && (selectedDate !== today || !followingNow)) return;
    if (!visible || todayView !== "timeline" || loading || error) return;
    const frame = window.requestAnimationFrame(() => {
      if (enteringDate && timelineEntryDateRef.current !== selectedDate) return;
      const scroller = timelineScrollRef.current;
      const timeline = scroller?.querySelector<HTMLElement>(".hourly-timeline");
      if (!scroller || !timeline) return;
      const scrollerRect = scroller.getBoundingClientRect();
      const timelineRect = timeline.getBoundingClientRect();
      const desiredTop = scroller.scrollTop + timelineRect.top - scrollerRect.top
        + (nowMinute - axisStart) / 60 * pixelsPerHour - scroller.clientHeight / 2;
      const nextTop = Math.max(0, Math.min(desiredTop, scroller.scrollHeight - scroller.clientHeight));
      const shouldReduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      scroller.scrollTo({
        top: nextTop,
        behavior: timelineCenteredDateRef.current === selectedDate && !shouldReduceMotion ? "smooth" : "auto"
      });
      timelineCenteredDateRef.current = selectedDate;
      if (enteringDate) timelineEntryDateRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedDate, today, todayView, loading, error, followingNow, nowMinute, visible, timelineReturnContext, axisStart, pixelsPerHour]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateReturnToNowVisibility);
    return () => window.cancelAnimationFrame(frame);
  }, [selectedDate, today, todayView, loading, error, followingNow, nowMinute]);

  useEffect(() => {
    if (!visible || todayView !== "timeline" || selectedDate !== today) {
      agendaLocatedTargetRef.current = null;
      agendaUserScrolledRef.current = false;
      return;
    }
    if (loading || error) return;
    if (!runningAgendaKey) {
      agendaLocatedTargetRef.current = null;
      agendaUserScrolledRef.current = false;
      return;
    }
    const previousTarget = agendaLocatedTargetRef.current;
    if (previousTarget?.key !== runningAgendaKey) agendaUserScrolledRef.current = false;
    if (agendaUserScrolledRef.current && previousTarget?.date === selectedDate && previousTarget.key === runningAgendaKey) return;
    const frame = window.requestAnimationFrame(() => {
      const list = agendaListRef.current;
      if (!list) return;
      const target = Array.from(list.querySelectorAll<HTMLElement>("[data-agenda-key]"))
        .find((node) => node.dataset.agendaKey === runningAgendaKey) ?? null;
      if (!target) return;
      const listRect = list.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const desiredTop = list.scrollTop + targetRect.top - listRect.top - (list.clientHeight - targetRect.height) / 2;
      const maxTop = Math.max(0, list.scrollHeight - list.clientHeight);
      const nextTop = Math.max(0, Math.min(desiredTop, maxTop));
      const shouldReduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (Math.abs(list.scrollTop - nextTop) > 1) {
        list.scrollTo({
          top: nextTop,
          behavior: previousTarget?.date === selectedDate && !shouldReduceMotion ? "smooth" : "auto"
        });
      }
      agendaLocatedTargetRef.current = { date: selectedDate, key: runningAgendaKey };
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedDate, today, todayView, visible, loading, error, runningAgendaKey, agendaEntries.length, agendaLocateRevision]);

  useEffect(() => () => {
    window.cancelAnimationFrame(returnToNowFrameRef.current);
  }, []);

  useEffect(() => {
    setSelection(null);
    setPlanDraftTimeEdit(null);
    setExecutionDraft(null);
    setExecutionMessage("");
    setTimelineTooltip(null);
    if (todayView === "timeline") setMonthKey(selectedDate.slice(0, 7));
  }, [selectedDate, todayView]);

  useEffect(() => {
    if (!timelineReturnContext) return;
    if (timelineReturnContext.date !== selectedDate) {
      onSelectDate(timelineReturnContext.date);
      return;
    }
    if (loading || (!schedule && !error)) return;
    setTodayView("timeline");
    setTimelineTooltip(null);
    setPlanDraftTimeEdit(null);
    const block = timelineReturnContext.occurrenceId
      ? recurringOccurrences.find((item) => item.id === timelineReturnContext.occurrenceId)
      : timelineReturnContext.eventId && typeof fixedEvents !== "undefined"
        ? fixedEvents.find((item) => item.id === timelineReturnContext.eventId)
        : timelineReturnContext.blockId ? taskBlocks.find((item) => item.id === timelineReturnContext.blockId)
          : taskBlocks.find((item) => item.task_id === timelineReturnContext.taskId);
    if (!block) {
      if (typeof today !== "undefined" && selectedDate === today && typeof setFollowingNow === "function") {
        if (typeof timelineEntryDateRef !== "undefined") timelineEntryDateRef.current = selectedDate;
        setFollowingNow(true);
      }
      onTimelineReturnHandled();
      return;
    }
    setFollowingNow(false);
    const locatedKind = timelineReturnContext.occurrenceId ? "recurring" : timelineReturnContext.eventId ? "event" : "block";
    setRevealedKey(`${locatedKind}:${block.id}`);
    setSelection(null);
    setExecutionDraft(null);
    setExecutionMessage("");
    const frame = window.requestAnimationFrame(() => {
      const scroller = timelineScrollRef.current;
      const target = Array.from(scroller?.querySelectorAll<HTMLElement>("[data-timeline-kind][data-timeline-id]") ?? [])
        .find((candidate) => candidate.dataset.timelineKind === locatedKind && candidate.dataset.timelineId === block.id) ?? null;
      if (scroller && target) {
        if (typeof locateTimerRef !== "undefined" && locateTimerRef.current !== null && typeof window.clearTimeout === "function") {
          window.clearTimeout(locateTimerRef.current);
          locateTimerRef.current = null;
        }
        for (const candidate of scroller.querySelectorAll<HTMLElement>('[data-return-located="true"]')) {
          if (candidate !== target && candidate.dataset) delete candidate.dataset.returnLocated;
        }
        if (typeof hideTimelineTooltip === "function") hideTimelineTooltip();
        if (typeof suppressTooltipFocusRef !== "undefined") suppressTooltipFocusRef.current = true;
        try {
          (target.querySelector<HTMLElement>(".timeline-event-body") ?? target).focus({ preventScroll: true });
        } finally {
          if (typeof suppressTooltipFocusRef !== "undefined") suppressTooltipFocusRef.current = false;
        }
        target.dataset.returnLocated = "true";
        const timer = window.setTimeout(() => {
          delete target.dataset.returnLocated;
          if (typeof locateTimerRef !== "undefined" && locateTimerRef.current === timer) locateTimerRef.current = null;
        }, 3000);
        if (typeof locateTimerRef !== "undefined") locateTimerRef.current = typeof timer === "number" ? timer : null;
        const scrollerRect = scroller.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const desiredTop = scroller.scrollTop + targetRect.top - scrollerRect.top - (scroller.clientHeight - targetRect.height) / 2;
        scroller.scrollTo({
          top: Math.max(0, Math.min(desiredTop, scroller.scrollHeight - scroller.clientHeight)),
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
        });
      }
      onTimelineReturnHandled();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [timelineReturnContext?.date, timelineReturnContext?.blockId, timelineReturnContext?.taskId, timelineReturnContext?.occurrenceId, timelineReturnContext?.eventId, selectedDate, loading, error, schedule, recurringOccurrences]);

  useEffect(() => {
    if (!timelineTooltip) return;
    const dismiss = () => hideTimelineTooltip();
    const scroll = (event: Event) => {
      if (event.target instanceof Node && timelineTooltipCardRef.current?.contains(event.target)) return;
      dismiss();
    };
    const outsidePointer = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && (timelineTooltipCardRef.current?.contains(event.target)
        || timelineTooltipTriggerRef.current?.contains(event.target))) return;
      dismiss();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (timelineTooltipCardRef.current?.contains(document.activeElement)) {
        timelineTooltipFocusRef.current?.focus({ preventScroll: true });
      }
      dismiss();
    };
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("pointerdown", outsidePointer);
    window.addEventListener("keydown", escape);
    return () => {
      cancelTimelineTooltipHide();
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("pointerdown", outsidePointer);
      window.removeEventListener("keydown", escape);
    };
  }, [timelineTooltip]);

  useEffect(() => {
    if (!preview && selection?.kind === "draft") {
      setSelection(null);
      setPlanDraftTimeEdit(null);
    }
  }, [preview, selection?.kind]);

  const timelinePanelModal = Boolean(planDraftTimeEdit || selectedBlock || selectedRecurringOccurrence);

  useEffect(() => {
    if (!selection) return;
    const frame = window.requestAnimationFrame(() => timelineFloatingPanelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [selection?.kind, selection?.id]);

  useEffect(() => {
    const panel = timelineFloatingPanelRef.current;
    if (!timelinePanelModal || !panel || typeof HTMLElement === "undefined" || typeof document.addEventListener !== "function") return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlockBackground = lockBackgroundElements(panel);
    const controls = () => Array.from(panel.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])"))
      .filter((node) => node.getClientRects().length > 0);
    const containFocus = (event: FocusEvent) => {
      if (!panel.contains(event.target as Node)) (controls()[0] ?? panel).focus({ preventScroll: true });
    };
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("focusin", containFocus);
      unlockBackground();
      const target = timelineSelectionTriggerRef.current?.isConnected ? timelineSelectionTriggerRef.current : previousFocus;
      if (target?.isConnected && !target.closest("[inert]")) {
        window.requestAnimationFrame(() => target.focus({ preventScroll: true }));
      }
    };
  }, [timelinePanelModal]);

  useLayoutEffect(() => {
    const panel = timelineFloatingPanelRef.current;
    const scroll = timelineScrollRef.current;
    if (!selection || !panel || !scroll) return;
    const positionPanel = () => {
      const selectedAnchor = timelineSelectionAnchorRef.current?.isConnected
        ? timelineSelectionAnchorRef.current
        : Array.from(scroll.querySelectorAll<HTMLElement>("[data-timeline-kind][data-timeline-id]"))
          .find((candidate) => candidate.dataset.timelineKind === selection.kind && candidate.dataset.timelineId === selection.id) ?? null;
      if (!selectedAnchor) return;

      timelineSelectionAnchorRef.current = selectedAnchor;
      const scrollRect = scroll.getBoundingClientRect();
      const anchorRect = selectedAnchor.getBoundingClientRect();
      const isCompact = window.matchMedia("(max-width: 860px)").matches;
      const viewportMargin = 14;
      const gap = 12;
      const visibleTop = Math.max(viewportMargin, scrollRect.top + 8);
      const visibleBottom = Math.min(window.innerHeight - viewportMargin, scrollRect.bottom - 8);
      const availableHeight = Math.max(220, Math.floor(visibleBottom - visibleTop));

      panel.style.setProperty("--floating-panel-height", `${availableHeight}px`);
      if (isCompact) {
        panel.dataset.placement = "drawer";
        panel.style.removeProperty("--floating-panel-left");
        panel.style.removeProperty("--floating-panel-top");
        return;
      }

      const panelWidth = panel.offsetWidth;
      const panelHeight = Math.min(panel.scrollHeight, availableHeight);
      const anchorTop = Math.max(visibleTop, Math.min(anchorRect.top, visibleBottom));
      const anchorBottom = Math.max(visibleTop, Math.min(anchorRect.bottom, visibleBottom));
      const anchorCenterX = anchorRect.left + anchorRect.width / 2;
      const canPlaceRight = anchorRect.right + gap + panelWidth <= window.innerWidth - viewportMargin;
      const canPlaceLeft = anchorRect.left - gap - panelWidth >= viewportMargin;
      const canPlaceBelow = anchorBottom + gap + panelHeight <= visibleBottom;
      const canPlaceAbove = anchorTop - gap - panelHeight >= visibleTop;

      let placement: "right" | "left" | "below" | "above";
      let left: number;
      let top: number;
      if (canPlaceRight || canPlaceLeft) {
        placement = canPlaceRight ? "right" : "left";
        left = placement === "right" ? anchorRect.right + gap : anchorRect.left - gap - panelWidth;
        top = Math.max(visibleTop, Math.min(anchorTop, visibleBottom - panelHeight));
      } else {
        placement = canPlaceBelow || !canPlaceAbove ? "below" : "above";
        left = Math.max(viewportMargin, Math.min(anchorCenterX - panelWidth / 2, window.innerWidth - viewportMargin - panelWidth));
        top = placement === "below"
          ? Math.min(anchorBottom + gap, visibleBottom - panelHeight)
          : Math.max(visibleTop, anchorTop - gap - panelHeight);
      }

      panel.dataset.placement = placement;
      panel.style.setProperty("--floating-panel-left", `${Math.round(left)}px`);
      panel.style.setProperty("--floating-panel-top", `${Math.round(top)}px`);
    };
    positionPanel();
    const observer = new ResizeObserver(positionPanel);
    observer.observe(scroll);
    observer.observe(panel);
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    };
  }, [selection?.kind, selection?.id, Boolean(planDraftTimeEdit)]);

  useEffect(() => {
    if (!selection || savingExecution || trashingBlock || Boolean(pendingTrashBlock) || Boolean(pendingRecycledCompletion)) return;
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (timelineFloatingPanelRef.current?.contains(target)) return;
      if (timelineSelectionTriggerRef.current?.contains(target)) return;
      if (timelineSelectionAnchorRef.current?.contains(target)) return;
      setSelection(null);
      setPlanDraftTimeEdit(null);
    };
    document.addEventListener("pointerdown", dismissOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", dismissOnOutsidePointer);
  }, [selection, savingExecution, trashingBlock, pendingTrashBlock, pendingRecycledCompletion]);

  useEffect(() => {
    if (!selectedBlock || !canRecordSelectedBlock) {
      setExecutionDraft(null);
      return;
    }
    const savedOutcome = selectedBlock.review?.outcome ?? selectedBlock.execution_status;
    const outcome: ExecutionOutcome | null = savedOutcome === "planned" ? null : savedOutcome === "completed" ? "completed" : "not_started";
    setExecutionDraft({ result: executionResultForOutcome(outcome), outcome, note: selectedBlock.review?.notes ?? selectedBlock.execution_note ?? "" });
    setExecutionMessage("");
  }, [selectedBlock?.id, selectedBlock?.review, selectedBlock?.execution_status, selectedBlock?.execution_note, canRecordSelectedBlock, selectedDate, today]);

  function moveMonth(offset: number) {
    const [year, month] = monthKey.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    const nextMonthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    setMonthKey(nextMonthKey);
    setMonthSelectionPending(nextMonthKey !== selectedDate.slice(0, 7));
  }

  function resetAgendaPosition() {
    agendaUserScrolledRef.current = false;
    agendaLocatedTargetRef.current = null;
    setAgendaLocateRevision((value) => value + 1);
  }

  function returnToday() {
    if (typeof resetAgendaPosition === "function") resetAgendaPosition();
    if (selectedDate === today) {
      setMonthKey(todayMonthKey);
      setMonthSelectionPending(false);
      return;
    }
    selectCalendarDate(today);
  }

  function selectCalendarDate(date: string, keepMonth = false) {
    if (!onSelectDate(date)) return false;
    setMonthSelectionPending(false);
    if (!keepMonth && date.slice(0, 7) !== monthKey) setMonthKey(date.slice(0, 7));
    return true;
  }

  function openTimelineDate(date: string) {
    if (!selectCalendarDate(date)) return;
    timelineEntryDateRef.current = date;
    timelineCenteredDateRef.current = null;
    setClock(new Date());
    setFollowingNow(date === today);
    if (typeof resetAgendaPosition === "function") resetAgendaPosition();
    setTodayView("timeline");
  }

  function returnToMonth() {
    setSelection(null);
    setPlanDraftTimeEdit(null);
    setExecutionDraft(null);
    setExecutionMessage("");
    setTimelineTooltip(null);
    setTodayView("month");
  }

  function selectTimelineItem(nextSelection: TimelineSelection, trigger?: HTMLElement, anchor: HTMLElement | null = trigger ?? null) {
    if (savingExecution) return;
    if (trigger) timelineSelectionTriggerRef.current = trigger;
    if (anchor) timelineSelectionAnchorRef.current = anchor;
    setTimelineTooltip(null);
    setSelection(nextSelection);
    setExecutionMessage("");
  }

  function selectPlanDraftBlock(blockIndex: number, trigger: HTMLButtonElement) {
    if (savingExecution) return;
    const block = draftBlocks[blockIndex];
    if (!block) return;
    timelineSelectionTriggerRef.current = trigger;
    timelineSelectionAnchorRef.current = trigger;
    setTimelineTooltip(null);
    setSelection({ kind: "draft", id: String(blockIndex) });
    const startsAt = timeInputValue(block.starts_at);
    const endsAt = timeInputValue(block.ends_at);
    setPlanDraftTimeEdit({
      blockIndex,
      starts_at: startsAt,
      ends_at: endsAt,
      original_starts_at: startsAt,
      original_ends_at: endsAt,
      error: ""
    });
  }

  function adjustSelectedBlockTime() {
    if (!selectedBlock || selectedBlock.execution_status !== "planned" || selectedBlock.review || isPastDate || busy || tasks.some((task) => task.id === selectedBlock.task_id && task.execution_locked) || !["open", "scheduled"].includes(selectedBlock.task_status)) return;
    setExecutionDraft(null);
    const startsAt = timeInputValue(selectedBlock.starts_at);
    const endsAt = timeInputValue(selectedBlock.ends_at);
    setPlanDraftTimeEdit({
      blockIndex: -1,
      sourceBlockId: selectedBlock.id,
      sourceStartsAt: selectedBlock.starts_at,
      sourceEndsAt: selectedBlock.ends_at,
      starts_at: startsAt,
      ends_at: endsAt,
      original_starts_at: startsAt,
      original_ends_at: endsAt,
      error: ""
    });
  }

  function resetPlanDraftTime() {
    if (!planDraftTimeEdit || busy) return;
    setPlanDraftTimeEdit({
      ...planDraftTimeEdit,
      starts_at: planDraftTimeEdit.original_starts_at,
      ends_at: planDraftTimeEdit.original_ends_at,
      error: ""
    });
  }
  function returnToSelectedBlockDetails() {
    if (!selectedBlock || !planDraftTimeEdit?.sourceBlockId || busy) return;
    const savedOutcome = selectedBlock.review?.outcome ?? selectedBlock.execution_status;
    const outcome: ExecutionOutcome | null = savedOutcome === "planned" ? null : savedOutcome === "completed" ? "completed" : "not_started";
    setPlanDraftTimeEdit(null);
    setExecutionDraft(canRecordSelectedBlock ? {
      result: executionResultForOutcome(outcome),
      outcome,
      note: selectedBlock.review?.notes ?? selectedBlock.execution_note ?? ""
    } : null);
    setExecutionMessage("");
    window.requestAnimationFrame(() => timelineFloatingPanelRef.current?.focus());
  }

  async function resolveEditablePlanDraftBlock(edit: PlanDraftTimeEdit | null = planDraftTimeEdit) {
    if (!edit) return null;
    let workingPreview = preview;
    let blockIndex = edit.blockIndex;
    if (edit.sourceBlockId) {
      const sourceBlock = taskBlocks.find((item) => item.id === edit.sourceBlockId);
      if (!sourceBlock || tasks.some((task) => task.id === sourceBlock.task_id && task.execution_locked)) {
        onNotify("无法调整时间", "安排已变化，请重新打开", "review");
        return null;
      }
      if (!workingPreview) return null;
      blockIndex = workingPreview.blocks.findIndex((block) =>
        block.task_id === sourceBlock.task_id
        && block.starts_at === sourceBlock.starts_at
        && block.ends_at === sourceBlock.ends_at
      );
      if (blockIndex < 0) {
        onNotify("无法调整时间", "已有执行记录或计划已变化", "review");
        return null;
      }
    }
    if (!workingPreview) return null;
    const block = workingPreview.blocks[blockIndex];
    if (!block) return null;
    return { preview: workingPreview, blockIndex, block };
  }

  async function savePlanDraftTime(event: FormEvent) {
    event.preventDefault();
    if (!planDraftTimeEdit || busy) return;
    if (!planDraftTimeChanged(planDraftTimeEdit)) return;
    const startsAt = normalizeDraftClock(planDraftTimeEdit.starts_at);
    const endsAt = normalizeDraftClock(planDraftTimeEdit.ends_at);
    if (!validDraftClock(startsAt) || !validDraftClock(endsAt)) {
      setPlanDraftTimeEdit({ ...planDraftTimeEdit, starts_at: startsAt, ends_at: endsAt, error: "请输入 24 小时制时间，例如 09:30。" });
      return;
    }
    const startMinute = clockMinutes(startsAt);
    const endMinute = clockMinutes(endsAt);
    if (endMinute <= startMinute) {
      setPlanDraftTimeEdit({ ...planDraftTimeEdit, error: "结束时间必须晚于开始时间。" });
      return;
    }
    if (endMinute - startMinute < MIN_TASK_BLOCK_MINUTES) {
      setPlanDraftTimeEdit({ ...planDraftTimeEdit, error: `普通任务块至少需要 ${MIN_TASK_BLOCK_MINUTES} 分钟。` });
      return;
    }
    const originalBlock = planDraftTimeEdit.sourceBlockId
      ? taskBlocks.find((item) => item.id === planDraftTimeEdit.sourceBlockId) ?? null
      : selectedDraftBlock;
    if (originalBlock
      && timeInputValue(originalBlock.starts_at) === startsAt
      && timeInputValue(originalBlock.ends_at) === endsAt
    ) {
      closeTimelinePanel();
      return;
    }
    try {
      if (planDraftTimeEdit.sourceBlockId && !preview) {
        const block = taskBlocks.find((item) => item.id === planDraftTimeEdit.sourceBlockId);
        if (!block) throw new Error("这项安排已经变化，请重新打开后再调整");
        await onSaveBlockTime({ ...block,
          starts_at: planDraftTimeEdit.sourceStartsAt ?? block.starts_at,
          ends_at: planDraftTimeEdit.sourceEndsAt ?? block.ends_at
        }, planTimestamp(selectedDate, startsAt), planTimestamp(selectedDate, endsAt));
        closeTimelinePanel();
        return;
      }
      const resolved = await resolveEditablePlanDraftBlock();
      if (!resolved) return;
      const nextBlock: RulePlanBlock = {
        ...resolved.block,
        starts_at: planTimestamp(selectedDate, startsAt),
        ends_at: planTimestamp(selectedDate, endsAt),
        estimated_minutes: endMinute - startMinute
      };
      await onUpdatePlan({
        ...resolved.preview,
        blocks: resolved.preview.blocks.map((item, index) => index === resolved.blockIndex ? nextBlock : item)
      });
      closeTimelinePanel();
    } catch (reason) {
      const task = selectedDraftTask ?? (selectedBlock ? tasks.find((item) => item.id === selectedBlock.task_id) ?? null : null);
      const error = planDraftErrorMessage(reason, task, selectedDate);
      setPlanDraftTimeEdit({ ...planDraftTimeEdit, starts_at: startsAt, ends_at: endsAt, error });
      onNotify("时间未保存", error, "review");
    }
  }

  function requestTrashSelectedBlock() {
    if (!selectedBlock || !canTrashSelectedBlock || busy || loading || savingExecution || quickCompletingBlockId || savingDraggedBlock || timelineDrag || preview || trashingBlockRef.current) return;
    setTrashBlockError(null);
    setPendingTrashBlock({ taskId: selectedBlock.task_id, title: selectedBlock.task_title });
  }

  async function confirmTrashSelectedBlock() {
    if (!pendingTrashBlock || trashingBlockRef.current || busy) return;
    const target = pendingTrashBlock;
    trashingBlockRef.current = true;
    setTrashingBlock(true);
    setTrashBlockError(null);
    try {
      await onTrashTask(target.taskId);
      trashingBlockRef.current = false;
      setTrashingBlock(false);
      setPendingTrashBlock(null);
      setTrashBlockError(null);
      closeTimelinePanel();
    } catch (reason) {
      setTrashBlockError(`未移入回收站：${uiErrorMessage(reason)}`);
    } finally {
      trashingBlockRef.current = false;
      setTrashingBlock(false);
    }
  }

  async function removePlanDraftBlock(edit: PlanDraftTimeEdit | null = planDraftTimeEdit) {
    if (busy || edit?.sourceBlockId) return;
    const resolved = await resolveEditablePlanDraftBlock(edit);
    if (!resolved) return;
    const task = tasks.find((item) => item.id === resolved.block.task_id) ?? null;
    const remainingBlocks = resolved.preview.blocks.filter((_, index) => index !== resolved.blockIndex);
    const existingUnscheduled = resolved.preview.unscheduled.find((item) => item.task_id === resolved.block.task_id);
    const removedMinutes = (existingUnscheduled?.estimated_minutes ?? 0) + resolved.block.estimated_minutes;
    const unscheduled: RuleUnscheduledTask[] = [
      ...resolved.preview.unscheduled.filter((item) => item.task_id !== resolved.block.task_id),
      {
        task_id: resolved.block.task_id,
        task_title: resolved.block.task_title,
        reason: `手动移出今日 · ${removedMinutes} 分钟待安排`,
        estimated_minutes: removedMinutes
      }
    ];
    try {
      await onUpdatePlan({ ...resolved.preview, blocks: remainingBlocks, unscheduled });
      setSelection(null);
      setPlanDraftTimeEdit(null);
      window.requestAnimationFrame(() => timelineScrollRef.current?.focus());
    } catch (reason) {
      onNotify("未移出草案", planDraftErrorMessage(reason, task, selectedDate), "review");
    }
  }

  function closeTimelinePanel() {
    if (savingExecution || recurringResultSavingRef.current || trashingBlockRef.current) return;
    setSelection(null);
    setPlanDraftTimeEdit(null);
    setRecurringTimeEdit(null);
    setRecycledCompletionNote("");
    timelineSelectionAnchorRef.current = null;
    window.requestAnimationFrame(() => {
      const trigger = timelineSelectionTriggerRef.current;
      if (trigger?.isConnected) trigger.focus();
      else timelineScrollRef.current?.focus();
      hideTimelineTooltip();
    });
  }

  function openTimelineTask(taskId: string, blockId: string) {
    if (savingExecution || trashingBlockRef.current) return;
    setSelection(null);
    setPlanDraftTimeEdit(null);
    setTimelineTooltip(null);
    timelineSelectionAnchorRef.current = null;
    onOpenTasks(taskId, { date: selectedDate, blockId });
  }

  function openTimelineRecurringItem(item: RecurringOccurrence) {
    if (savingRecurringChange || pendingRecurringChange || recurringResultSavingRef.current) return;
    setSelection(null);
    setRecurringTimeEdit(null);
    setTimelineTooltip(null);
    timelineSelectionAnchorRef.current = null;
    onOpenRecurringItem(item.recurring_item_id, { date: selectedDate, occurrenceId: item.id });
  }

  function pauseTimelineFollowing() {
    timelineEntryDateRef.current = null;
    if (selectedDate === today && followingNow) setFollowingNow(false);
  }

  function resumeTimelineFollowing() {
    setClock(new Date());
    setShowReturnToNow(false);
    setFollowingNow(true);
    resetAgendaPosition();
  }

  function updateReturnToNowVisibility() {
    const scroller = timelineScrollRef.current;
    const nowLine = scroller?.querySelector<HTMLElement>(".current-time-line");
    if (selectedDate !== today || followingNow || todayView !== "timeline" || loading || error || !scroller || !nowLine) {
      setShowReturnToNow(false);
      return;
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const lineRect = nowLine.getBoundingClientRect();
    const linePosition = lineRect.top - scrollerRect.top;
    const shouldShow = linePosition <= scrollerRect.height * 0.2 || linePosition >= scrollerRect.height * 0.8;
    setShowReturnToNow((current) => current === shouldShow ? current : shouldShow);
  }

  function handleTimelineScroll() {
    if (returnToNowFrameRef.current) return;
    returnToNowFrameRef.current = window.requestAnimationFrame(() => {
      returnToNowFrameRef.current = 0;
      updateReturnToNowVisibility();
    });
  }

  function handleTimelineScrollKey(event: KeyboardEvent<HTMLDivElement>) {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
      pauseTimelineFollowing();
    }
  }

  function updateExecutionDraft(update: Partial<ExecutionDraft>) {
    setExecutionMessage("");
    setExecutionDraft((current) => current ? { ...current, ...update } : current);
  }

  async function saveSelectedBlockExecution() {
    if (!selectedBlock || !executionDraft || savingExecution || busy || loading || preview || quickCompletingBlockId) return;
    if (!executionDraftChanged(selectedBlock, executionDraft, selectedTask)) return;
    if (!canCaptureTaskResult(selectedDate, today, selectedBlock, Date.now())) {
      setExecutionMessage(historicalBlockCompletionLocked(resultDate, selectedBlock, Date.now()) ? HISTORY_COMPLETION_LOCKED_MESSAGE : "已超过结果修改时间");
      return;
    }
    const savedOutcome = selectedBlock.review?.outcome ?? selectedBlock.execution_status;
    const clearingResult = !executionDraft.outcome && savedOutcome !== "planned";
    const clearingCompletion = clearingResult && savedOutcome === "completed";
    const clearingIncomplete = clearingResult && savedOutcome !== "completed";
    const noteOnly = !executionDraft.outcome && !clearingResult && !executionDraft.wholeTask;
    if (executionDraft.wholeTask && (!selectedTaskIsCrossDay || !selectedTask || !taskResultEditable(selectedTask, Date.now()))) {
      setExecutionMessage("任务已变化，请关闭后重新打开。");
      return;
    }
    setSavingExecution(true);
    setExecutionMessage("");
    try {
      let undoId: string | undefined;
      if (clearingResult) {
        await clearExecutionCapture(resultDate, selectedBlock.id, executionDraft.note.trim());
      } else if (executionDraft.wholeTask && selectedTask) {
        await completeTask(selectedTask.id, null, executionDraft.note.trim() || null);
      } else if (noteOnly) {
        await saveExecutionCapture(resultDate, { plan_block_id: selectedBlock.id, outcome: null, note: executionDraft.note.trim() || null });
      } else if (resultDate === resultToday(Date.now())) {
        const input = taskExecutionResolution(selectedBlock, selectedTask, executionDraft.outcome!, executionDraft.note);
        const canOfferUndo = input.outcome === "completed" && (selectedBlock.review?.outcome ?? selectedBlock.execution_status) !== "completed";
        const previousUndo = canOfferUndo ? await latestUndo().catch(() => null) : null;
        await resolveTaskExecution(resultDate, input);
        if (canOfferUndo) {
          const undo = await latestUndo().catch(() => null);
          if (undo?.target_type === "execution_capture" && undo.target_id === selectedBlock.task_id && undo.id !== previousUndo?.id) undoId = undo.id;
        }
      } else {
        // Daily results share the same aggregation regardless of the execution date.
        await saveExecutionCapture(resultDate, { plan_block_id: selectedBlock.id, outcome: executionDraft.outcome, note: executionDraft.note.trim() || null });
      }
      await onFactsChanged();
      setSelection(null);
      setPlanDraftTimeEdit(null);
      window.requestAnimationFrame(() => timelineSelectionTriggerRef.current?.focus());
      const incomplete = executionDraft.outcome === "not_started";
      const seed = incomplete && selectedTask ? { title: selectedTask.title, priority: selectedTask.priority, tags: [...selectedTask.tags] } : undefined;
      onNotify(clearingCompletion ? "已取消当天完成" : clearingIncomplete ? (resultDate < resultToday(Date.now()) ? "已取消本次未完成" : "已取消未完成") : executionDraft.wholeTask ? "整个任务已完成" : noteOnly ? "随手记已保存" : incomplete ? "未完成结果已保存" : "当天结果已保存", "", "check", undoId, seed);
    } catch (reason) { setExecutionMessage(`未保存：${uiErrorMessage(reason)}`); }
    finally { setSavingExecution(false); }
  }

  async function quickCompleteTimelineBlock(block: PlanBlock, recycledConfirmed = false, note: string | null = null) {
    if (quickCompletingBlockId || savingExecution || busy || loading || preview || savingDraggedBlock || timelineDrag) return;
    if (recycledConfirmed) {
      const current = schedule?.task_blocks.find((candidate) => candidate.id === block.id);
      if (!pendingRecycledCompletion || pendingRecycledCompletion.block.id !== block.id || pendingRecycledCompletion.date !== selectedDate || current?.task_status !== "deleted") {
        setPendingRecycledCompletion(null);
        setRecycledCompletionError(null);
        onNotify("任务块已变化", "请重新打开原日期的安排后再确认。", "review");
        return;
      }
      block = current;
    }
    const task = tasks.find((task) => task.id === block.task_id);
    const action = timelineTaskCompletionAction(block, task, selectedDate, today, Date.now());
    if (!action) return;
    if (block.task_status === "deleted" && action === "complete-block" && !recycledConfirmed) {
      setTimelineTooltip(null);
      setRecycledCompletionError(null);
      setPendingRecycledCompletion({ block, date: selectedDate, note: note ?? "" });
      return;
    }
    setQuickCompletingBlockId(block.id);
    if (recycledConfirmed) setRecycledCompletionError(null);
    let saved = false;
    try {
      if (action === "complete-block" || action === "uncomplete-block") {
        const recycled = block.task_status === "deleted";
        const canOfferUndo = !recycled && action === "complete-block" && selectedDate === resultToday(Date.now());
        const previousUndo = canOfferUndo ? await latestUndo().catch(() => null) : null;
        if (action === "uncomplete-block") {
          await clearExecutionCapture(selectedDate, block.id, (block.review?.notes ?? block.execution_note ?? "").trim());
        } else {
          const recycledNote = (pendingRecycledCompletion?.note?.trim() || note?.trim() || block.review?.notes) ?? block.execution_note ?? null;
          await saveExecutionCapture(selectedDate, { plan_block_id: block.id, outcome: "completed", note: recycled ? recycledNote : (block.review?.notes ?? block.execution_note ?? null) });
        }
        saved = true;
        if (recycled) {
          setPendingRecycledCompletion(null);
          setRecycledCompletionError(null);
          setRecycledCompletionNote("");
        }
        const undo = canOfferUndo ? await latestUndo().catch(() => null) : null;
        const undoId = undo?.target_type === "execution_capture" && undo.target_id === block.task_id && undo.id !== previousUndo?.id ? undo.id : undefined;
        await onFactsChanged();
        onNotify(recycled ? "已完成回收站中的任务块" : action === "complete-block" ? "当天已完成" : task?.status === "done" && task.earliest_start_date && task.due_date && task.earliest_start_date < task.due_date ? "已取消当天及整体完成" : "已取消当天完成", recycled ? "执行记录已增加，任务仍在回收站。" : "", "check", undoId);
      } else if (action === "clear") {
        await clearExecutionCapture(selectedDate, block.id, (block.review?.notes ?? block.execution_note ?? "").trim());
        await onFactsChanged();
        onNotify(selectedDate < resultToday(Date.now()) ? "已取消本次未完成" : "已取消未完成", "", "check");
      }
    } catch (reason) {
      if (!saved && recycledConfirmed && block.task_status === "deleted") {
        setRecycledCompletionError(uiErrorMessage(reason));
      } else {
        onNotify(saved ? "执行记录已保存，界面刷新失败" : action === "uncomplete-block" ? "未取消本次完成" : action === "complete-block" ? "当天结果未保存" : "未取消未完成", uiErrorMessage(reason), "review");
      }
    }
    finally { setQuickCompletingBlockId(null); }
  }

  function locateTimelineKey(layoutKey: string) {
    const matched = timelineItems.find((item) => item.layoutKey === layoutKey);
    if (matched && timelineMinute(matched.starts_at, selectedDate, "start") < 7 * 60) setNightExpanded(true);
    setRevealedKey(layoutKey);
    pauseTimelineFollowing();
    if (typeof hideTimelineTooltip === "function") hideTimelineTooltip();
    if (locateTimerRef.current !== null) {
      window.clearTimeout(locateTimerRef.current);
      locateTimerRef.current = null;
    }
    window.requestAnimationFrame(() => {
      const scroller = timelineScrollRef.current;
      const target = scroller?.querySelector<HTMLElement>(`[data-timeline-key="${CSS.escape(layoutKey)}"]`);
      if (!scroller || !target) return;
      scroller.querySelectorAll<HTMLElement>('[data-return-located="true"]').forEach((node) => {
        if (node !== target) delete node.dataset.returnLocated;
      });
      if (typeof suppressTooltipFocusRef !== "undefined") suppressTooltipFocusRef.current = true;
      try {
        (target.querySelector<HTMLElement>(".timeline-event-body") ?? target).focus({ preventScroll: true });
      } finally {
        if (typeof suppressTooltipFocusRef !== "undefined") suppressTooltipFocusRef.current = false;
      }
      target.dataset.returnLocated = "true";
      locateTimerRef.current = window.setTimeout(() => {
        delete target.dataset.returnLocated;
        locateTimerRef.current = null;
      }, 3000);
      const scrollerRect = scroller.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const desiredTop = scroller.scrollTop + targetRect.top - scrollerRect.top - (scroller.clientHeight - targetRect.height) / 2;
      scroller.scrollTo({
        top: Math.max(0, Math.min(desiredTop, scroller.scrollHeight - scroller.clientHeight)),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
    });
  }

  async function toggleUntimedTask(task: Task) {
    if (quickCompletingTaskId || quickCompletingBlockId || savingExecution || busy || loading || preview) return;
    if (selectedDate > today) {
      onNotify("未来日期暂不可记录", "到日期当天后再记录任务结果。", "review");
      return;
    }
    if (task.status === "done" && !taskResultEditable(task, clock.getTime())) {
      onNotify("无法取消完成", historicalTaskCompletionLocked(task, clock.getTime()) ? HISTORY_COMPLETION_LOCKED_MESSAGE : "已超过结果修改时间", "review");
      return;
    }
    setQuickCompletingTaskId(task.id);
    try {
      if (task.status === "done") {
        await reopenManualTask(task.id, selectedDate);
        await onFactsChanged(selectedDate);
        onNotify("已取消完成", task.title, "check");
      } else {
        const canUndo = selectedDate === resultToday(Date.now());
        const previousUndo = canUndo ? await latestUndo().catch(() => null) : null;
        await completeTask(task.id, null, null);
        const undo = canUndo ? await latestUndo().catch(() => null) : null;
        const undoId = undo?.target_type === "task_completion" && undo.target_id === task.id && undo.id !== previousUndo?.id ? undo.id : undefined;
        await onFactsChanged(selectedDate);
        onNotify("任务已完成", task.title, "check", undoId);
      }
    } catch (reason) {
      onNotify("操作未完成", uiErrorMessage(reason), "review");
    } finally {
      setQuickCompletingTaskId(null);
    }
  }


  const periodNavigation = todayView === "timeline"
    ? {
        groupLabel: "日期导航",
        prevLabel: "上一天",
        nextLabel: "下一天",
        isCurrent: selectedDate === today,
        currentLabel: "今天",
        awayLabel: "回到今天",
        onPrev: () => selectCalendarDate(shiftDateValue(selectedDate, -1)),
        onNext: () => selectCalendarDate(shiftDateValue(selectedDate, 1))
      }
    : todayView === "week"
      ? {
          groupLabel: "周导航",
          prevLabel: "上一周",
          nextLabel: "下一周",
          isCurrent: isCurrentWeek,
          currentLabel: "本周",
          awayLabel: "回到本周",
          onPrev: () => selectCalendarDate(shiftDateValue(selectedDate, -7)),
          onNext: () => selectCalendarDate(shiftDateValue(selectedDate, 7))
        }
      : {
          groupLabel: "月份导航",
          prevLabel: "上一个月",
          nextLabel: "下一个月",
          isCurrent: monthKey === todayMonthKey,
          currentLabel: "本月",
          awayLabel: "回到本月",
          onPrev: () => moveMonth(-1),
          onNext: () => moveMonth(1)
        };
  const periodLabel = periodNavigation.isCurrent ? periodNavigation.currentLabel : periodNavigation.awayLabel;

  return (
    <section className={`next-page today-page${todayView === "week" ? " is-week-view" : ""}`} aria-label="今日">
      <div className={`timeline-page-shell${todayView === "timeline" ? " is-timeline-view" : ""}`}>
        <h1 className="sr-only">{windowTitle}</h1>
        <header className="timeline-design-topbar">
          <div className="timeline-heading">
            <div className="timeline-date-copy">
              <div className="timeline-date-primary">
                <h2 className="timeline-day-title">{todayView === "month" ? monthTitle : todayView === "week" ? selectedWeekHeading.range : selectedDateTitle}</h2>
              </div>
              <div className="timeline-date-meta timeline-day-subline">{todayView === "month" ? <><span>{monthMeta.lunarYear}</span>{monthMeta.solarTerms && <><CopySeparator /><span>{monthMeta.solarTerms}</span></>}<CopySeparator /><span className="timeline-strong-fact">{monthMeta.daysLabel}</span></> : todayView === "week" ? <><span>第 {selectedWeekHeading.week} 周</span>{selectedWeekPeriod && <><CopySeparator /><span>{selectedWeekPeriod}</span></>}{isCurrentWeek && <><CopySeparator /><span className="timeline-current-period">本周</span></>}</> : <><span>{selectedWeekday}</span>{selectedLunarDate && <><CopySeparator /><span>农历{selectedLunarDate}</span></>}{selectedSolarTerm && <><CopySeparator /><span className="timeline-term-chip">{selectedSolarTerm}</span></>}</>}</div>
            </div>
          </div>
          <div className="timeline-top-actions">
            <div className="timeline-date-navigation" role="group" aria-label={periodNavigation.groupLabel}>
              <button
                type="button"
                data-period-state={periodNavigation.isCurrent ? "current" : "away"}
                className="timeline-return-today"
                aria-pressed={periodNavigation.isCurrent}
                title={periodNavigation.isCurrent ? `当前处于${periodNavigation.currentLabel}` : periodNavigation.awayLabel}
                onClick={returnToday}
              >{periodLabel}</button>
              <div className="timeline-date-steppers">
                <button type="button" className="timeline-date-step" aria-label={periodNavigation.prevLabel} title={periodNavigation.prevLabel} onClick={periodNavigation.onPrev}><Icon name="chevron-left" size={14} /></button>
                <span className="timeline-date-stepper-divider" aria-hidden="true" />
                <button type="button" className="timeline-date-step" aria-label={periodNavigation.nextLabel} title={periodNavigation.nextLabel} onClick={periodNavigation.onNext}><Icon name="chevron-right" size={14} /></button>
              </div>
            </div>
            {todayView === "timeline" && preview && <div className="plan-draft-top-actions" aria-label="日计划草案操作">
              <span className="plan-draft-mode"><i />计划待确认</span>
              <button type="button" className="quiet-button" disabled={busy} onClick={() => void onCancelPlan()}>放弃草案</button>
              <button type="button" className="primary-action" disabled={busy || (!isAdjustingConfirmedPlan && preview.blocks.length === 0)} onClick={onConfirmPlan}>{busy ? "正在保存…" : "确认计划"}</button>
            </div>}
          </div>
        </header>
        {message && <p className="page-status" role="status">{message}</p>}
        <HolidayCoverageNotice from={todayView === "month" ? `${monthKey}-01` : weekDates[0]} to={todayView === "month" ? `${monthKey}-01` : weekDates[6]} recurringStarts={recurringItems.filter((item) => item.status === "active" && !item.deleted_at && item.frequency === "weekdays" && (!item.ends_on || item.ends_on >= selectedDate)).map((item) => item.starts_on)} />

        {todayView === "week" ? <WeekTimeline selectedDate={selectedDate} today={today} tasks={tasks} recurringItems={recurringItems} onOpenDay={(date, returnContext) => { openTimelineDate(date); if (returnContext) onLocateTimeline?.(returnContext); }} onOpenTasks={(taskId, returnContext) => onOpenTasks(taskId, returnContext)} onOpenRecurringItem={(recurringItemId, returnContext) => onOpenRecurringItem(recurringItemId, returnContext)} /> : todayView === "month" ? <main className="today-month-view" aria-label={monthTitle}>
          <section className="month-sheet today-month-sheet" aria-label="月历">
            <div className="weekday-row">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>周{day}</span>)}</div>
            <div className="month-grid" role="grid" aria-label={monthTitle}>{cells.map((cell) => {
              const dayTasks = tasks.filter((task) => task.status !== "deleted" && !task.deleted_at && taskAppearsOnDate(task, cell.key));
              const count = dayTasks.length;
              const recurringCount = monthRecurringOccurrences.filter((item) => item.occurrence_date === cell.key).length;
              const dayInfo = calendarDayInfo(cell.key);
              const lunarLabel = lunarDayLabel(cell.key);
              const workStateLabel = dayInfo?.workState === "rest" ? "休" : dayInfo?.workState === "work" ? "班" : "";
              const solarTerm = dayInfo?.solarTerm ?? dayInfo?.labels.find((label) => label.kind === "solar-term")?.text;
              const otherLabels = dayInfo?.labels.filter((label) => label.kind !== "solar-term") ?? [];
              const calendarLabel = dayInfo?.labels.map((label) => label.text).join("、") ?? "";
              return <button key={cell.key} type="button" role="gridcell" aria-selected={!monthSelectionPending && selectedDate === cell.key} aria-current={cell.key === today ? "date" : undefined} aria-label={`${cell.key}${lunarLabel ? `，农历${lunarLabel}` : ""}${calendarLabel ? `，${calendarLabel}` : ""}${workStateLabel ? `，${workStateLabel === "休" ? "放假" : "调休上班"}` : ""}${count ? `，${count} 项任务` : ""}${recurringCount ? `，${recurringCount} 项重复事项` : ""}`} className={`${cell.inMonth ? "in-month" : "outside"}${cell.key === today ? " today" : ""}${!monthSelectionPending && selectedDate === cell.key ? " selected" : ""}${dayInfo?.workState ? ` ${dayInfo.workState}` : ""}${count ? " has-tasks" : ""}${recurringCount ? " has-recurring-items" : ""}`} onPointerDown={(event) => { event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); }} onClick={() => selectCalendarDate(cell.key, true)} onDoubleClick={() => openTimelineDate(cell.key)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); openTimelineDate(cell.key); } }}>
                <span className="calendar-day-head"><span className="day-number"><span className="solar-day-number">{!cell.inMonth && <span className="calendar-month-prefix">{Number(cell.key.slice(5, 7))}月</span>}{cell.day}</span>{solarTerm ? <span className="calendar-solar-term">{solarTerm}</span> : otherLabels.length ? <span className={`calendar-label ${otherLabels[0].kind}`}>{otherLabels[0].text}</span> : lunarLabel && <span className="lunar-day-number">{cell.key === today ? `今日·${lunarLabel}` : lunarLabel}</span>}</span>{workStateLabel && <span className={`work-state ${dayInfo?.workState}`}>{workStateLabel}</span>}</span>
                {count > 0 || recurringCount > 0 ? <span className="calendar-indicators" aria-hidden="true">
                  {count > 0 && <span className="task-indicator"><i />{count}<span>项</span></span>}
                  {recurringCount > 0 && <span className="task-indicator recurring"><Icon name="restore" size={10} />{recurringCount}<span>项</span></span>}
                </span> : null}
              </button>;
            })}</div>
          </section>
        </main> : <div className="today-day-split"><main className={`timeline-main${error || loading ? " is-status" : ""}${preview ? " is-plan-draft" : ""}`} aria-label={`${selectedDateTitle}时间线`}>
          {error ? <div className="timeline-state"><strong>这一天暂时无法打开</strong><span>{error}</span><button type="button" className="quiet-button" onClick={() => void onFactsChanged()}>重试</button></div> : loading ? <div className="timeline-state">正在载入这一天的安排…</div> : <>
            {preview && <div className="plan-draft-summary" role="status"><span><Icon name="sparkle" size={14} /><strong>{preview.blocks.length} 项草案安排</strong>{preview.unscheduled.length > 0 && <><CopySeparator />{preview.unscheduled.length} 项未排入</>}</span></div>}
            <div ref={timelineScrollRef} className="timeline-scroll" tabIndex={0} aria-label="24 小时时间线" onScroll={handleTimelineScroll} onWheel={pauseTimelineFollowing} onTouchMove={pauseTimelineFollowing} onPointerDown={(event) => { if (event.currentTarget === event.target) pauseTimelineFollowing(); }} onKeyDown={handleTimelineScrollKey}>
              {!hasNightItems && <div className="timeline-night-fold">
                <button
                  type="button"
                  aria-expanded={nightExpanded}
                  aria-label={nightExpanded ? "收起 00:00 – 07:00 夜间时段" : "展开 00:00 – 07:00 夜间时段（暂无安排）"}
                  onClick={() => { pauseTimelineFollowing(); setNightExpanded((current) => !current); }}
                >
                  <span className="timeline-night-fold-gutter" aria-hidden="true">00–07</span>
                  <span className="timeline-night-fold-track">
                    <span className="timeline-night-fold-rule is-lead" aria-hidden="true" />
                    <span className="timeline-night-fold-label">
                      <Icon name="moon" size={12} />
                      <span>{nightExpanded ? "夜间时段" : "夜间时段暂无安排"}</span>
                    </span>
                    <span className="timeline-night-fold-rule is-tail" aria-hidden="true" />
                    <span className="timeline-night-fold-action">
                      <strong>{nightExpanded ? "收起" : "展开"}</strong>
                      <Icon name={nightExpanded ? "chevron-up" : "chevron-down"} size={12} />
                    </span>
                  </span>
                </button>
              </div>}
              {dayLayout.summaries.some(group => !group.lane) && <div className="timeline-overflow-outside">{dayLayout.summaries.filter(group => !group.lane).map(overflowButton)}</div>}
              {selectedDate === today && showReturnToNow && <div className="return-to-now-layer"><button type="button" onClick={resumeTimelineFollowing}><span className="return-to-now-dot" aria-hidden="true" /><span>回到现在</span></button></div>}
              {selection && <div className={`timeline-floating-layer${planDraftTimeEdit || selectedRecurringOccurrence && recurringTimeEdit ? " is-time-editor" : selectedBlock || selectedRecurringOccurrence ? " is-block-editor" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget && (planDraftTimeEdit || selectedBlock || selectedRecurringOccurrence)) closeTimelinePanel(); }}><section id="timeline-context-panel" ref={timelineFloatingPanelRef} className={`timeline-floating-panel${selectedRecurringOccurrence ? recurringTimeEdit ? " task-block-editor plan-draft-editor" : " task-block-editor" : planDraftTimeEdit ? " plan-draft-editor" : selectedBlock ? " task-block-editor" : ""}`} role="dialog" aria-modal={planDraftTimeEdit || selectedBlock || selectedRecurringOccurrence ? true : undefined} aria-label={selectedRecurringOccurrence ? `${selectedRecurringOccurrence.title}${recurringTimeEdit ? "时间调整" : "本次结果"}` : planDraftTimeEdit && (selectedDraftBlock || selectedBlock) ? `${selectedDraftBlock?.task_title ?? selectedBlock?.task_title}时间调整` : selectedBlock ? `${selectedBlock.task_title}任务结果` : selectedEvent ? `${selectedEvent.title}日程详情` : "时间线详情"} aria-live="polite" tabIndex={-1} onKeyDown={(event) => {
                if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeTimelinePanel(); return; }
                if (event.key === "Tab" && !event.defaultPrevented && (planDraftTimeEdit || selectedBlock || selectedRecurringOccurrence) && typeof document !== "undefined") {
                  const panel = event.currentTarget;
                  const controls = Array.from(panel.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])"))
                    .filter((node) => typeof node.getClientRects !== "function" || node.getClientRects().length > 0);
                  event.preventDefault();
                  if (!controls.length) { panel.focus(); return; }
                  const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
                  const nextIndex = event.shiftKey ? (currentIndex <= 0 ? controls.length - 1 : currentIndex - 1) : (currentIndex + 1) % controls.length;
                  (controls[nextIndex] ?? panel).focus();
                }
              }}>
                {selectedRecurringOccurrence ? <>
                  <header>{recurringTimeEdit ? <div className="timeline-panel-heading"><TaskContextReturnButton label="返回任务块详情" disabled={savingRecurringChange || Boolean(quickCompletingBlockId)} onClick={returnToRecurringOccurrenceDetails} /><div className="timeline-panel-heading-copy"><strong>调整时间</strong><small>{selectedRecurringOccurrence.title}</small></div></div> : <div className="execution-dialog-heading"><strong>{selectedRecurringOccurrence.title}</strong><span className={`execution-status-badge status-${selectedRecurringOccurrence.outcome === "completed" ? "completed" : selectedRecurringOccurrence.outcome ? "not_completed" : "executing"}`}>{selectedRecurringOccurrence.outcome === "completed" ? "本次已完成" : selectedRecurringOccurrence.outcome === "partial" ? "本次部分完成" : selectedRecurringOccurrence.outcome === "not_completed" ? "本次未完成" : "执行中"}</span></div>}<button type="button" aria-label="关闭重复任务块" disabled={savingRecurringChange || Boolean(quickCompletingBlockId)} onClick={closeTimelinePanel}><Icon name="close" size={15} /></button></header>
                  {recurringTimeEdit ? <><form id="recurring-block-time-form" className="plan-draft-time-form recurring-time-form" noValidate onSubmit={saveRecurringTimeEdit}>
                    <RecurringBlockTimeEditor value={recurringTimeEdit} today={today} onChange={setRecurringTimeEdit} />
                    {recurringTimeEdit.error && <p className="plan-draft-edit-error" role="alert">{recurringTimeEdit.error}</p>}
                  </form><footer className="execution-capture-footer"><div><button type="button" className="quiet-button" disabled={savingRecurringChange || Boolean(quickCompletingBlockId)} onClick={closeTimelinePanel}>取消</button><button type="submit" form="recurring-block-time-form" className="primary-action" disabled={savingRecurringChange || Boolean(quickCompletingBlockId) || !recurringTimeEditChanged(selectedRecurringOccurrence, recurringTimeEdit)}>保存调整</button></div></footer></> : <div className="execution-plan-time"><div className="execution-plan-fact"><span>计划时间</span>{canEditRecurringOccurrence(selectedRecurringOccurrence) ? <button type="button" className="execution-time-value" aria-label={`调整计划时间：${recurringTimeRange(selectedRecurringOccurrence)}`} disabled={Boolean(quickCompletingBlockId)} onClick={adjustRecurringOccurrenceTime}><Icon name="clock" size={14} /><strong>{recurringTimeRange(selectedRecurringOccurrence)}</strong><span className="execution-time-edit-icon"><Icon name="pencil" size={13} /></span></button> : <div className="execution-time-value"><Icon name="clock" size={14} /><strong>{recurringTimeRange(selectedRecurringOccurrence)}</strong></div>}</div><div className="execution-plan-actions"><button type="button" className="execution-open-task" disabled={savingRecurringChange || Boolean(pendingRecurringChange) || Boolean(quickCompletingBlockId)} onClick={() => openTimelineRecurringItem(selectedRecurringOccurrence)}>查看任务<Icon name="external-link" size={12} /></button></div></div>}
                  <RecurringOccurrenceResult key={selectedRecurringOccurrence.id} occurrence={selectedRecurringOccurrence} writable={canRecordRecurringOccurrence(selectedRecurringOccurrence)} hidden={Boolean(recurringTimeEdit)} disabled={Boolean(quickCompletingBlockId) || busy || loading || savingExecution || savingRecurringChange || Boolean(preview) || Boolean(pendingRecurringChange)} onCancel={closeTimelinePanel} onSave={(outcome, notes) => saveRecurringResult(selectedRecurringOccurrence, outcome, notes)} />
                </> : planDraftTimeEdit && (selectedDraftBlock || selectedBlock) ? <>
                  <header><div className="timeline-panel-heading">{planDraftTimeEdit.sourceBlockId && <TaskContextReturnButton label="返回任务块详情" disabled={busy} onClick={returnToSelectedBlockDetails} />}<div className="timeline-panel-heading-copy"><strong>调整时间</strong><small>{selectedDraftBlock?.task_title ?? selectedBlock?.task_title}</small></div></div>{(planDraftTimeEdit.starts_at !== planDraftTimeEdit.original_starts_at || planDraftTimeEdit.ends_at !== planDraftTimeEdit.original_ends_at) && <button type="button" className="timeline-time-reset" aria-label="重置为调整前的时间" title="重置为调整前的时间" disabled={busy} onClick={resetPlanDraftTime}><Icon name="restore" size={14} />重置时间</button>}<button type="button" aria-label="关闭时间调整面板" onClick={closeTimelinePanel}><Icon name="close" size={15} /></button></header>
                  <form className="plan-draft-time-form" noValidate onSubmit={(event) => void savePlanDraftTime(event)}>
                    <div className="plan-draft-time-fields"><BlockEditorTimeRangeRail start={planDraftTimeEdit.starts_at} end={planDraftTimeEdit.ends_at} inputsOnly disabled={busy} minimumDuration={MIN_TASK_BLOCK_MINUTES} onChange={(next) => setPlanDraftTimeEdit({ ...planDraftTimeEdit, starts_at: next.start, ends_at: next.end, error: "" })} /></div>
                    {planDraftTimeEdit.error && <span className="plan-draft-edit-error" role="alert">{planDraftTimeEdit.error}</span>}
                    <footer>{!planDraftTimeEdit.sourceBlockId && <button type="button" className="execution-remove-today" disabled={busy} onClick={() => void removePlanDraftBlock()}><Icon name="trash" size={14} />从今日计划移除</button>}<div><button type="button" className="quiet-button" disabled={busy} onClick={closeTimelinePanel}>取消</button><button type="submit" className="primary-action" disabled={busy || !planDraftTimeChanged(planDraftTimeEdit)}>{busy ? "正在保存…" : "保存调整"}</button></div></footer>
                  </form>
                </> : selectedBlock ? <><header><div className="execution-dialog-heading"><strong>{selectedBlock.task_title}</strong><span className={`execution-status-badge status-${selectedBlockDialog!.status}`}>{selectedBlockDialog!.label}</span></div><button type="button" aria-label="关闭执行面板" disabled={savingExecution || Boolean(quickCompletingBlockId)} onClick={closeTimelinePanel}><Icon name="close" size={15} /></button></header>
                  <div className="execution-plan-time"><div className="execution-plan-fact"><span>计划时间</span>{canAdjustSelectedBlock ? <button type="button" className="execution-time-value" aria-label={`调整计划时间：${timeRangeLabel(selectedBlock.starts_at, selectedBlock.ends_at)}`} disabled={busy || loading || savingExecution || Boolean(quickCompletingBlockId)} onClick={adjustSelectedBlockTime}><Icon name="clock" size={14} /><strong>{timeRangeLabel(selectedBlock.starts_at, selectedBlock.ends_at)}</strong><span className="execution-time-edit-icon"><Icon name="pencil" size={13} /></span></button> : <div className="execution-time-value"><Icon name="clock" size={14} /><strong>{timeRangeLabel(selectedBlock.starts_at, selectedBlock.ends_at)}</strong></div>}</div><div className="execution-plan-actions"><button type="button" className="execution-open-task" disabled={savingExecution || Boolean(quickCompletingBlockId)} onClick={() => openTimelineTask(selectedBlock.task_id, selectedBlock.id)}>查看任务<Icon name="external-link" size={12} /></button></div></div>
                  {!canRecordSelectedBlock && selectedBlockDialog?.status === "completed" ? <CompletedBlockRecord notes={[selectedBlock.review?.notes, selectedBlock.execution_note]} review={selectedBlock.review} actualMinutes={selectedBlock.actual_minutes} recycled={selectedBlock.task_status === "deleted"} disabled={savingExecution || Boolean(quickCompletingBlockId)} onClose={closeTimelinePanel} /> : selectedBlock.review && !canRecordSelectedBlock ? <>
                    <div className={`floating-facts execution-${selectedBlock.review.outcome}`}><div><span>任务结果</span><strong>{reviewOutcomeCopy[selectedBlock.review.outcome]}</strong></div>{selectedBlock.review.followup_action && <div><span>下一步</span><strong>{taskNextActionLabels[selectedBlock.review.followup_action]}</strong></div>}{selectedBlock.review.actual_minutes !== null && <div><span>实际耗时</span><strong>{selectedBlock.review.actual_minutes} 分钟</strong></div>}{selectedBlock.review.remaining_workload_minutes !== null && <div><span>剩余工作量</span><strong>{selectedBlock.review.remaining_workload_minutes} 分钟</strong></div>}{selectedBlock.review.notes && <div className="wide"><span>备注</span><strong>{selectedBlock.review.notes}</strong></div>}{selectedBlock.review.defer_reason && <div className="wide"><span>原因</span><strong>{selectedBlock.review.defer_reason}</strong></div>}</div>
                    {selectedBlock.execution_note && selectedBlock.execution_note !== selectedBlock.review.notes && <p className="execution-capture-note">{selectedBlock.execution_note}</p>}
                    <p className="execution-capture-note" role="status">{historicalBlockCompletionLocked(selectedDate, selectedBlock, clock.getTime()) ? HISTORY_COMPLETION_LOCKED_MESSAGE : "已超过结果修改时间"}</p>
                  </> : !canRecordSelectedBlock ? <>
                    {selectedBlock.execution_status !== "planned" && <div className={`floating-capture-fact execution-${selectedBlock.execution_status}`}><span>本次结果</span><strong>{reviewOutcomeCopy[selectedBlock.execution_status]}</strong>{selectedBlock.execution_note && <p>{selectedBlock.execution_note}</p>}</div>}
                    {!(selectedBlock.execution_status === "completed" && selectedBlock.task_status !== "deleted") && <div className="floating-readonly"><strong>{selectedBlock.task_status === "deleted" ? "任务已移入回收站" : selectedDate > today ? "未来安排暂不可记录" : historicalBlockCompletionLocked(selectedDate, selectedBlock, clock.getTime()) ? HISTORY_COMPLETION_LOCKED_MESSAGE : "已超过结果修改时间"}</strong><span>{selectedBlock.task_status === "deleted" ? selectedBlockCompletionAction === "complete-block" ? "确认后可为这个已有安排增加完成执行记录；任务仍留在回收站。" : "仅查看已有记录。" : selectedDate > today ? "到执行日期后再记录任务结果。" : "已有记录保持只读。"}</span></div>}
                    {selectedBlock.task_status === "deleted" && selectedBlockCompletionAction === "complete-block" && <label className="floating-execution-note"><span>随手记<small>可选</small></span><textarea rows={3} maxLength={500} placeholder="记录进展或需要留意的事…" value={recycledCompletionNote} disabled={savingExecution || busy || Boolean(quickCompletingBlockId)} onChange={(event) => setRecycledCompletionNote(event.target.value)} /></label>}
                  </> : executionDraft ? <>
                    <ExecutionCaptureFields key={selectedBlock.id} draft={executionDraft} disabled={savingExecution || busy || Boolean(quickCompletingBlockId)} onChange={updateExecutionDraft}
                      onCompleteTask={selectedTaskIsCrossDay && selectedTask && ["open", "scheduled", "done"].includes(selectedTask.status) && !selectedTask.deleted_at ? () => updateExecutionDraft({ result: "completed", outcome: "completed", wholeTask: true }) : undefined}
                      taskCompleted={selectedTask?.status === "done"} completeTaskDisabled={loading || Boolean(preview) || !taskResultEditable(selectedTask, clock.getTime())} />
                    <p className="execution-capture-note">{executionDraft.wholeTask ? "保存后完成整个任务，已有日期记录会保留，后续未执行安排将不再显示。" : "仅记录当天结果，不改变其他日期的记录；所有日期完成后，任务自动完成。"}</p>
                  </> : null}
                  {executionMessage && <span role="alert" className="execution-capture-note error">{executionMessage}</span>}
                  {(canRecordSelectedBlock || selectedBlockDialog?.status !== "completed") && <footer className="execution-capture-footer">
                    {canTrashSelectedBlock && <button type="button" className="execution-remove-today" disabled={busy || loading || savingExecution || Boolean(quickCompletingBlockId) || savingDraggedBlock || Boolean(timelineDrag) || Boolean(preview) || trashingBlock} onClick={() => requestTrashSelectedBlock()}><Icon name="trash" size={14} />移入回收站</button>}
                    {!selectedTaskIsCrossDay && selectedBlockDialog?.action === "new-task" && selectedTask && <button type="button" className="execution-new-task secondary-action" disabled={busy || loading || savingExecution || Boolean(quickCompletingBlockId)} onClick={() => onNewTask({ title: selectedTask.title, priority: selectedTask.priority, tags: [...selectedTask.tags] })}><Icon name="plus" size={14} />新建任务</button>}
                    {selectedBlock.task_status === "deleted" && selectedBlockCompletionAction === "complete-block" && <button type="button" className="execution-complete-recycled secondary-action" disabled={busy || loading || savingExecution || Boolean(quickCompletingBlockId) || Boolean(preview)} onClick={() => void quickCompleteTimelineBlock(selectedBlock, false, recycledCompletionNote)}><Icon name="check" size={14} />确认完成并记录</button>}
                    <div><button type="button" className="quiet-button" disabled={savingExecution || Boolean(quickCompletingBlockId)} onClick={closeTimelinePanel}>取消</button>{canRecordSelectedBlock && executionDraft && <button type="button" className="primary-action" disabled={savingExecution || busy || loading || Boolean(quickCompletingBlockId) || !executionDraftChanged(selectedBlock, executionDraft, selectedTask)} onClick={() => void saveSelectedBlockExecution()}>{savingExecution ? "正在保存…" : "保存"}</button>}</div>
                  </footer>}
                </> : selectedEvent ? <><header><div><strong>{selectedEvent.title}</strong><small>{selectedEvent.is_all_day ? "全天固定日程" : <>{timeRangeLabel(selectedEvent.starts_at, selectedEvent.ends_at)}<CopySeparator />固定日程</>}</small></div><button type="button" aria-label="关闭日程详情" onClick={closeTimelinePanel}><Icon name="close" size={15} /></button></header><div className="floating-readonly"><strong>固定日程</strong><span>固定日程不提供完成按钮，也不会限制同一时段安排其他事项。</span></div></> : null}
              </section></div>}
              <div className="hourly-timeline" style={{ "--timeline-height": `${timelineHeight}px` } as CSSProperties}><div className="timeline-hours" aria-hidden="true">{timelineHours.map((hour, index) => <div key={hour} className={`timeline-hour${showNowLine && Math.abs(nowMinute - hour * 60) / 60 * pixelsPerHour <= nowLabelOverlapDistance ? " current-time-covered" : ""}`} style={{ top: `${index * pixelsPerHour}px` }}><time>{String(hour).padStart(2, "0")}:00</time><span /></div>)}</div><div className={`timeline-events${!isPastDate ? " has-create-track" : ""}`} style={{ height: `${timelineHeight}px` }}>
                <div className="timeline-width-probe" ref={setLaneTrack} aria-hidden="true" />
                {dayLayout.summaries.filter(group => group.lane).map(overflowButton)}
                {!isPastDate && <TimelineTaskCreate key={selectedDate} date={selectedDate} scrollRef={timelineScrollRef} pixelsPerHour={pixelsPerHour} axisStart={axisStart}
                  disabled={busy || loading || Boolean(error) || savingExecution || Boolean(quickCompletingBlockId) || savingDraggedBlock || Boolean(timelineDrag)}
                  onRange={setTimelineCreateRange} onStart={() => { pauseTimelineFollowing(); setSelection(null); setPlanDraftTimeEdit(null); setTimelineTooltip(null); timelineSelectionAnchorRef.current = null; }}
                  onCreated={async () => { await onFactsChanged(selectedDate); onNotify("任务已创建", "", "check"); }} />}
                {timelineCreateRange && timelineItemLanes["create:selection"] && <div className={`selection-range${timelineCreateRange.end - timelineCreateRange.start <= 30 ? " is-tiny" : ""}`}
                  data-start={timelineCreateRange.start} data-end={timelineCreateRange.end}
                  style={timelineEventPosition(planTimestamp(selectedDate, minutesClock(timelineCreateRange.start)), planTimestamp(selectedDate, minutesClock(timelineCreateRange.end)), selectedDate, axisStart, pixelsPerHour, timelineItemLanes["create:selection"])} aria-hidden="true">
                  <span className="selection-label">{minutesClock(timelineCreateRange.start)} – {minutesClock(timelineCreateRange.end)}</span>
                </div>}
                {timedEvents.filter(event => timelineItemLanes[`event:${event.id}`]).map((event) => <button data-timeline-key={`event:${event.id}`}
                  key={event.id}
                  type="button"
                  data-timeline-kind="event"
                  data-timeline-id={event.id}
                  className={`timeline-event fixed-event${selection?.kind === "event" && selection.id === event.id ? " selected" : ""}`}
                  style={timelineEventPosition(event.starts_at, event.ends_at, selectedDate, axisStart, pixelsPerHour, timelineItemLanes[`event:${event.id}`])}
                  aria-pressed={selection?.kind === "event" && selection.id === event.id}
                  {...timelineTooltipProps({
                    kind: "固定日程",
                    title: event.title,
                    time: timeRangeLabel(event.starts_at, event.ends_at),
                    detail: "固定日程；同一时段仍可安排其他事项",
                    tone: "fixed",
                    statusLabel: "固定日程",
                    duration: compactBlockDuration(timeRangeDurationMinutes(event.starts_at, event.ends_at)),
                    footerKind: "info",
                    footerText: "固定日程 · 同一时段仍可安排其他事项"
                  })}
                  onClick={(clickEvent) => selectTimelineItem({ kind: "event", id: event.id }, clickEvent.currentTarget)}
                ><span className="timeline-event-symbol fixed" aria-hidden="true" /><span className="timeline-event-copy"><strong>{event.title}</strong><small>{timeRangeLabel(event.starts_at, event.ends_at)}<CopySeparator />固定日程</small></span></button>)}
                {recurringTimelineBlocks.map(({ item, starts_at, ends_at, layoutKey }) => {
                  if (!timelineItemLanes[layoutKey]) return null;
                  const { url, body } = splitTaskNotes(item.notes ?? "");
                  const dragging = timelineDrag?.key === layoutKey;
                  const range = dragging ? `${minutesClock(timelineDrag.start)} - ${minutesClock(timelineDrag.end)}` : timeRangeLabel(starts_at, ends_at);
                  const duration = compactBlockDuration(dragging ? timelineDrag.end - timelineDrag.start : item.display_duration_minutes!);
                  const time = `${range} (${duration})`;
                  const editable = canEditRecurringOccurrence(item);
                  const display = recurringBlockDisplay(item.outcome);
                  const block: RulePlanBlock = { task_id: item.recurring_item_id, task_title: item.title, starts_at, ends_at, estimated_minutes: item.display_duration_minutes! };
                  return <div key={item.id} data-timeline-kind="recurring" data-timeline-id={item.id}
                    data-timeline-key={layoutKey}
                    className={`timeline-event recurring-event execution-${display.outcome}${shortTaskBlockClass(starts_at, ends_at)}${editable ? " can-drag" : ""}${dragging ? " is-dragging" : ""}${selection?.kind === "recurring" && selection.id === item.id ? " selected" : ""}`}
                    style={draggedTimelineStyle(layoutKey, timelineEventPosition(starts_at, ends_at, selectedDate, axisStart, pixelsPerHour, timelineItemLanes[layoutKey]))}
                    onPointerDown={(event) => beginTimelineDrag(event, block, null, item)}
                    onPointerMove={moveTimelineDrag} onPointerUp={(event) => void finishTimelineDrag(event)} onPointerCancel={cancelTimelineDrag}
                    onLostPointerCapture={() => { if (timelineDragRef.current) cancelTimelineDrag(); }}
                    onClick={(event) => {
                      if (event.detail !== 0 && timelineDragClickRef.current === layoutKey || timelineDragSavingRef.current) { timelineDragClickRef.current = null; return; }
                      if (event.target instanceof Element && event.target.closest(".timeline-event-check")) return;
                      selectRecurringOccurrence(item, event.currentTarget.querySelector<HTMLElement>(".timeline-event-body") ?? event.currentTarget, event.currentTarget);
                    }}
                    {...timelineTooltipProps({
                      kind: "重复事项",
                      title: item.title,
                      time,
                      detail: `${display.label}${editable ? " · 上下拖动调整时间·点击精确编辑" : " · 点击查看本次执行"}`,
                      tone: display.outcome === "planned" ? "execution" : `execution-${display.outcome}`,
                      url,
                      note: body,
                      tags: item.tags,
                      statusLabel: display.label,
                      timeRange: range.replace(/\s*-\s*/, "–"),
                      duration,
                      footerKind: display.outcome === "completed" ? "completed" : display.outcome === "not_started" ? "incomplete" : "hint",
                      footerLead: display.outcome === "planned" ? "" : display.label,
                      footerText: editable ? "上下拖动调整时间 · 点击精确编辑" : "点击查看本次执行"
                    }, "block-bottom")}
                  >
                    {!preview && <button type="button" className={`timeline-event-check${item.outcome === "completed" ? " done" : item.outcome ? " recorded" : ""}${quickCompletingBlockId === item.id ? " saving" : ""}`} aria-label={`${item.outcome === "completed" ? "取消本次完成" : item.outcome === "not_completed" ? "取消本次未完成" : item.outcome === "partial" ? "取消本次部分完成" : "标记本次完成"}：${item.title}`} aria-pressed={Boolean(item.outcome)} disabled={!canRecordRecurringOccurrence(item) || Boolean(quickCompletingBlockId) || busy || loading || savingExecution || savingRecurringChange || savingDraggedBlock || Boolean(timelineDrag) || Boolean(pendingRecurringChange)} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void saveRecurringResult(item, item.outcome ? null : "completed", item.review_notes); }}>{quickCompletingBlockId === item.id ? <span className="timeline-check-spinner" /> : item.outcome === "completed" ? <Icon name="check" size={11} /> : null}</button>}
                    <span className="timeline-recurring-marker" aria-hidden="true"><img src={recurringIcon} alt="" /></span>
                    <button type="button" className="timeline-event-body timeline-task-body" aria-label={`重复事项：${item.title}，${time}，${display.label}`} aria-haspopup="dialog" aria-controls="timeline-context-panel" aria-pressed={selection?.kind === "recurring" && selection.id === item.id}>
                      <TimelineTaskContent title={item.title} range={range} duration={duration} type="recurring" url={url} note={body} tags={item.tags} />
                    </button>
                  </div>;
                })}
                {draftBlocks.map((block, index) => {
                  if (!timelineItemLanes[draftLayoutKeys[index]]) return null;
                  const task = tasks.find((task) => task.id === block.task_id);
                  const { url, body } = splitTaskNotes(task?.notes ?? "");
                  const dragging = timelineDrag?.key === draftLayoutKeys[index];
                  const range = dragging ? `${minutesClock(timelineDrag.start)} - ${minutesClock(timelineDrag.end)}` : timeRangeLabel(block.starts_at, block.ends_at);
                  const duration = compactBlockDuration(timeRangeDurationMinutes(block.starts_at, block.ends_at));
                  const time = `${range} (${duration})`;
                  const type = taskBlockType(task);
                  return <button
                  key={draftLayoutKeys[index]}
                  type="button"
                  data-timeline-kind="draft"
                  data-timeline-id={String(index)}
                  data-timeline-key={draftLayoutKeys[index]}
                  className={`timeline-event plan-draft-block${canDragTimelineBlock(block, true) ? " can-drag" : ""}${dragging ? savingDraggedBlock ? " is-drag-saving" : " is-dragging" : ""}${shortTaskBlockClass(block.starts_at, block.ends_at)}${selection?.kind === "draft" && selection.id === String(index) ? " selected" : ""}`}
                  style={draggedTimelineStyle(draftLayoutKeys[index], timelineEventPosition(block.starts_at, block.ends_at, selectedDate, axisStart, pixelsPerHour, timelineItemLanes[draftLayoutKeys[index]]))}
                  aria-pressed={selection?.kind === "draft" && selection.id === String(index)}
                  onPointerDown={(event) => beginTimelineDrag(event, block, index)}
                  onPointerMove={moveTimelineDrag}
                  onPointerUp={(event) => void finishTimelineDrag(event)}
                  onPointerCancel={cancelTimelineDrag}
                  onLostPointerCapture={() => { if (timelineDragRef.current) cancelTimelineDrag(); }}
                  {...timelineTooltipProps({
                    kind: "计划草案",
                    title: block.task_title,
                    time,
                    detail: `${type ? `${taskBlockTypeLabels[type].full} · ` : ""}${task?.priority ? `${priorityCopy[task.priority]} · ` : ""}预计 ${block.estimated_minutes} 分钟 · 上下拖动调整时间·点击精确编辑`,
                    tone: "draft",
                    tags: task?.tags,
                    statusLabel: "计划草案",
                    priority: task?.priority,
                    timeRange: range.replace(/\s*-\s*/, "–"),
                    duration,
                    footerKind: "hint",
                    footerText: `预计 ${block.estimated_minutes} 分钟 · 上下拖动调整时间 · 点击精确编辑`
                  }, "block-top")}
                  onClick={(event) => {
                    if (event.detail !== 0 && timelineDragClickRef.current === draftLayoutKeys[index] || timelineDragSavingRef.current) { timelineDragClickRef.current = null; return; }
                    selectPlanDraftBlock(index, event.currentTarget);
                  }}
                ><span className="timeline-task-body"><TimelineTaskContent title={block.task_title} range={range} duration={duration} priority={task?.priority} type={type} url={url} note={body} tags={task?.tags} /></span></button>;
                })}
                {visibleTaskBlocks.map((block) => {
                  if (!timelineItemLanes[`block:${block.id}`]) return null;
                  const task = tasks.find((task) => task.id === block.task_id);
                  const { url, body } = splitTaskNotes(task?.notes ?? "");
                  const dragging = timelineDrag?.key === `block:${block.id}`;
                  const range = dragging ? `${minutesClock(timelineDrag.start)} - ${minutesClock(timelineDrag.end)}` : timeRangeLabel(block.starts_at, block.ends_at);
                  const duration = compactBlockDuration(timeRangeDurationMinutes(block.starts_at, block.ends_at));
                  const time = `${range} (${duration})`;
                  const type = taskBlockType(task);
                  const effectiveOutcome = block.review?.outcome ?? (block.execution_status === "planned" ? null : block.execution_status);
                  const blockIsSaving = quickCompletingBlockId === block.id;
                  const blockHasFact = effectiveOutcome !== null;
                  const taskCompleted = effectiveOutcome === "completed";
                  const completionAction = timelineTaskCompletionAction(block, task, selectedDate, today, clock.getTime());
                  const quickCompleteText = selectedDate < today ? taskCompleted ? "取消本次完成" : effectiveOutcome ? "取消本次未完成" : "标记本次完成" : taskCompleted ? "取消当天完成" : effectiveOutcome ? "取消未完成" : "完成当天";
                  const quickCompleteLabel = `${quickCompleteText}：${block.task_title}`;
                  return <div
                    key={block.id}
                    data-timeline-kind="block"
                    data-timeline-id={block.id}
                    data-timeline-key={`block:${block.id}`}
                    className={`timeline-event execution-block${preview ? " is-adjusting" : ""}${canDragTimelineBlock(block) ? " can-drag" : ""}${dragging ? savingDraggedBlock ? " is-drag-saving" : " is-dragging" : ""}${shortTaskBlockClass(block.starts_at, block.ends_at)}${effectiveOutcome ? ` ${block.review ? "reviewed" : "captured"} execution-${effectiveOutcome}` : ""}${selection?.kind === "block" && selection.id === block.id ? " selected" : ""}`}
                    style={draggedTimelineStyle(`block:${block.id}`, timelineEventPosition(block.starts_at, block.ends_at, selectedDate, axisStart, pixelsPerHour, timelineItemLanes[`block:${block.id}`]))}
                    onPointerDown={(event) => beginTimelineDrag(event, block)}
                    onPointerMove={moveTimelineDrag}
                    onPointerUp={(event) => void finishTimelineDrag(event)}
                    onPointerCancel={cancelTimelineDrag}
                    onLostPointerCapture={() => { if (timelineDragRef.current) cancelTimelineDrag(); }}
                    onClick={(event) => {
                      if (event.detail !== 0 && timelineDragClickRef.current === `block:${block.id}` || timelineDragSavingRef.current) { timelineDragClickRef.current = null; return; }
                      const target = event.target;
                      if (target instanceof Element && target.closest(".timeline-event-check")) return;
                      const trigger = event.currentTarget.querySelector<HTMLElement>(".timeline-event-body") ?? event.currentTarget;
                      selectTimelineItem({ kind: "block", id: block.id }, trigger, event.currentTarget);
                    }}
                    {...timelineTooltipProps({
                      kind: type ? taskBlockTypeLabels[type].full : "普通任务",
                      title: block.task_title,
                      time,
                      detail: [task?.priority ? priorityCopy[task.priority] : "", block.review
                        ? `${reviewOutcomeCopy[block.review.outcome]} · ${block.review.followup_action ? taskNextActionLabels[block.review.followup_action] : "已记录"}`
                        : effectiveOutcome ? `本次${reviewOutcomeCopy[effectiveOutcome]} · 已记录` : canDragTimelineBlock(block) ? "上下拖动调整时间·点击精确编辑" : ""].filter(Boolean).join(" · "),
                      tone: effectiveOutcome ? `execution-${effectiveOutcome}` : "execution",
                      url,
                      note: body, tags: task?.tags,
                      statusLabel: block.review
                        ? reviewOutcomeCopy[block.review.outcome]
                        : effectiveOutcome ? reviewOutcomeCopy[effectiveOutcome] : "已安排",
                      priority: task?.priority,
                      timeRange: range.replace(/\s*-\s*/, "–"),
                      duration,
                      footerKind: effectiveOutcome === "completed" ? "completed"
                        : effectiveOutcome === "not_started" || effectiveOutcome === "blocked" ? "incomplete" : "hint",
                      footerLead: block.review
                        ? reviewOutcomeCopy[block.review.outcome]
                        : effectiveOutcome ? `本次${reviewOutcomeCopy[effectiveOutcome]}` : "",
                      footerText: block.review
                        ? `${block.review.followup_action ? `下一步：${taskNextActionLabels[block.review.followup_action]}` : "已记录"} · 点击查看详情`
                        : effectiveOutcome ? "已记录 · 点击查看详情"
                          : canDragTimelineBlock(block) ? "上下拖动调整时间 · 点击精确编辑" : ""
                    }, "block-top")}
                  >
                    {!preview && <button type="button" className={`timeline-event-check${taskCompleted ? " done" : ""}${blockHasFact && !taskCompleted ? " recorded" : ""}${blockIsSaving ? " saving" : ""}`} aria-label={quickCompleteLabel} title={historicalBlockCompletionLocked(selectedDate, block, clock.getTime()) ? HISTORY_COMPLETION_LOCKED_MESSAGE : block.review && !taskCompleted ? "已有复盘记录，请在弹窗中修改结果" : !completionAction ? "当前结果不可修改" : quickCompleteText} aria-pressed={taskCompleted || blockHasFact} disabled={!completionAction || Boolean(quickCompletingBlockId) || busy || loading || savingExecution || savingDraggedBlock || Boolean(timelineDrag)} onClick={(event) => { event.stopPropagation(); void quickCompleteTimelineBlock(block); }}>{blockIsSaving ? <span className="timeline-check-spinner" /> : taskCompleted ? <Icon name="check" size={11} /> : null}</button>}
                    <button type="button" className="timeline-event-body timeline-task-body" aria-label={`打开本次执行：${block.task_title}，${time}${type ? `，${taskBlockTypeLabels[type].full}` : ""}${task?.priority ? `，${priorityCopy[task.priority]}` : ""}`} aria-haspopup="dialog" aria-controls="timeline-context-panel" aria-pressed={selection?.kind === "block" && selection.id === block.id}>
                      <TimelineTaskContent title={block.task_title} range={range} duration={duration} priority={task?.priority} type={type} url={url} note={body} tags={task?.tags} />
                    </button>
                  </div>;
                })}
                {timelineDrag && timelineDragRef.current?.active && <div className="timeline-drag-source" style={timelineEventPosition(timelineDragRef.current.block.starts_at, timelineDragRef.current.block.ends_at, selectedDate, axisStart, pixelsPerHour, timelineItemLanes["__drag_source__"] ?? timelineDragRef.current.sourceLane)} aria-hidden="true" />}
                {!timelineDrag && selectedTimelineFrame && timelineItemLanes[selectedTimelineFrame.layoutKey] && <div className="timeline-event-selection-frame" style={timelineEventPosition(selectedTimelineFrame.starts_at, selectedTimelineFrame.ends_at, selectedDate, axisStart, pixelsPerHour, timelineItemLanes[selectedTimelineFrame.layoutKey])} aria-hidden="true" />}
              </div>{showNowLine && <div className="current-time-line" style={{ top: `${(nowMinute - axisStart) / 60 * pixelsPerHour}px` }} aria-label={`当前时间 ${shanghaiClock.label}`}><span>{shanghaiClock.label}</span></div>}</div>
            </div>
          </>}
        </main>
        <aside className="today-rail" aria-label="日历、不限时事项与当日安排清单">
          <section className="today-rail-card today-mini-calendar-card" aria-label="日期快速切换">
            <header className="today-mini-cal-head">
              <strong>{monthTitle}</strong>
              <div className="today-mini-cal-actions">
                {(monthKey !== todayMonthKey || selectedDate !== today) && <button type="button" className="today-mini-cal-today" onClick={() => selectCalendarDate(today)}>今</button>}
                <button type="button" aria-label="上个月" onClick={() => setMonthKey(shiftMonthKey(monthKey, -1))}><Icon name="chevron-left" size={14} /></button>
                <button type="button" aria-label="下个月" onClick={() => setMonthKey(shiftMonthKey(monthKey, 1))}><Icon name="chevron-right" size={14} /></button>
              </div>
            </header>
            <div className="today-mini-cal-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="today-mini-cal-grid" role="grid" aria-label={monthTitle}>
              {cells.map((cell) => {
                const hasItems = tasks.some((task) => task.status !== "deleted" && !task.deleted_at && taskAppearsOnDate(task, cell.key))
                  || monthRecurringOccurrences.some((item) => item.occurrence_date === cell.key);
                return <button
                  key={cell.key}
                  type="button"
                  role="gridcell"
                  className={`${cell.inMonth ? "in-month" : "outside"}${cell.key === today ? " is-today" : ""}${cell.key === selectedDate ? " is-selected" : ""}${hasItems ? " has-items" : ""}`}
                  aria-selected={cell.key === selectedDate}
                  aria-current={cell.key === today ? "date" : undefined}
                  aria-label={cell.key}
                  onClick={() => { if (!pendingRecurringChange) selectCalendarDate(cell.key); }}
                >
                  <span>{cell.day}</span>
                  {hasItems && <i aria-hidden="true" />}
                </button>;
              })}
            </div>
          </section>

          <section className="today-rail-card today-untimed-card" aria-label="不限时事项">
            <header className="today-rail-head">
              <h3>不限时事项</h3>
              <span className="today-rail-count">{untimedDayTasks.length + untimedRecurringOccurrences.length + allDayEvents.length} 项</span>
            </header>
            {untimedDayTasks.length + untimedRecurringOccurrences.length + allDayEvents.length > 0 ? <div className="today-untimed-list">
              {untimedDayTasks.map((task) => {
                const isDone = task.status === "done";
                const locked = isDone && !taskResultEditable(task, clock.getTime());
                const canToggle = !locked && selectedDate <= today && !busy && !loading && !preview && !quickCompletingTaskId && !quickCompletingBlockId;
                const multiDay = Boolean(task.earliest_start_date && task.due_date && task.earliest_start_date < task.due_date);
                const dateLabel = multiDay
                  ? `${Number(task.earliest_start_date!.slice(5, 7))}月${Number(task.earliest_start_date!.slice(8, 10))}日–${Number(task.due_date!.slice(5, 7))}月${Number(task.due_date!.slice(8, 10))}日`
                  : "只定日期";
                const { url, body } = splitTaskNotes(task.notes ?? "");
                const listState = taskListStatus(task);
                return <div
                  key={`task:${task.id}`}
                  className={`today-untimed-item${isDone ? " is-done execution-completed" : ""}`}
                  {...timelineTooltipProps({
                    kind: "普通任务",
                    title: task.title,
                    time: `${dateLabel} · 不限时刻`,
                    detail: statusCopy[listState],
                    tone: isDone ? "execution-completed" : "task",
                    url,
                    note: body,
                    tags: task.tags,
                    statusLabel: statusCopy[listState],
                    priority: task.priority,
                    timeRange: `${dateLabel} · 不限时刻`,
                    footerKind: isDone ? "completed" : "info",
                    footerText: "点击查看或编辑任务详情"
                  })}
                >
                  <button
                    type="button"
                    className={`today-untimed-check${isDone ? " done" : ""}${quickCompletingTaskId === task.id ? " saving" : ""}`}
                    aria-label={`${isDone ? "取消完成" : "完成任务"}：${task.title}`}
                    aria-pressed={isDone}
                    title={locked ? (historicalTaskCompletionLocked(task, clock.getTime()) ? HISTORY_COMPLETION_LOCKED_MESSAGE : "已超过结果修改时间") : selectedDate > today ? "未来日期暂不可记录" : undefined}
                    disabled={!canToggle}
                    onClick={() => void toggleUntimedTask(task)}
                  >{quickCompletingTaskId === task.id ? <span className="timeline-check-spinner" /> : isDone ? <Icon name="check" size={11} /> : null}</button>
                  <button type="button" className="today-untimed-copy" onClick={() => onOpenTasks(task.id, { date: selectedDate, taskId: task.id })}>
                    <strong className="today-untimed-title">{task.title}</strong>
                    <span className="today-untimed-meta">
                      {task.priority && <span className={`timeline-fact-priority priority-${task.priority}`}>{priorityShortLabels[task.priority]}</span>}
                      <span className={`timeline-fact-type type-${multiDay ? "multi" : "single"}`}>{multiDay ? taskBlockTypeLabels.multi.short : taskBlockTypeLabels.single.short}</span>
                      {task.tags.length > 0 && <span className="today-untimed-tags">
                        <span className="today-untimed-tag">{task.tags[0]}</span>
                        {task.tags.length > 1 && <span className="today-untimed-tag-more" aria-label={`共 ${task.tags.length} 个标签`}>+{task.tags.length - 1}</span>}
                      </span>}
                    </span>
                  </button>
                </div>;
              })}
              {untimedRecurringOccurrences.map((item) => {
                const { url, body } = splitTaskNotes(item.notes ?? "");
                const display = recurringBlockDisplay(item.outcome);
                return <div
                  key={`rec:${item.id}`}
                  className={`today-untimed-item recurring${item.outcome ? ` execution-${item.outcome}` : ""}${item.outcome === "completed" ? " is-done" : ""}`}
                  {...timelineTooltipProps({
                    kind: "重复事项",
                    title: item.title,
                    time: "时间未指定",
                    detail: display.label,
                    tone: display.outcome === "planned" ? "execution" : `execution-${display.outcome}`,
                    url,
                    note: body,
                    tags: item.tags,
                    statusLabel: display.label,
                    timeRange: "时间未指定",
                    footerKind: display.outcome === "completed" ? "completed" : display.outcome === "not_started" ? "incomplete" : "info",
                    footerLead: display.outcome === "planned" ? "" : display.label,
                    footerText: "点击查看本次执行"
                  })}
                >
                  <button
                    type="button"
                    className={`today-untimed-check${item.outcome === "completed" ? " done" : item.outcome ? " recorded" : ""}${quickCompletingBlockId === item.id ? " saving" : ""}`}
                    aria-label={`${item.outcome === "completed" ? "取消本次完成" : item.outcome === "not_completed" ? "取消本次未完成" : item.outcome === "partial" ? "取消本次部分完成" : "标记本次完成"}：${item.title}`}
                    aria-pressed={Boolean(item.outcome)}
                    disabled={!canRecordRecurringOccurrence(item) || Boolean(quickCompletingBlockId) || busy || loading || savingExecution || savingRecurringChange || Boolean(preview) || Boolean(pendingRecurringChange)}
                    onClick={(event) => { event.stopPropagation(); void saveRecurringResult(item, item.outcome ? null : "completed", item.review_notes); }}
                  >{quickCompletingBlockId === item.id ? <span className="timeline-check-spinner" /> : item.outcome === "completed" ? <Icon name="check" size={11} /> : null}</button>
                  <button type="button" className="today-untimed-copy" onClick={(event) => selectRecurringOccurrence(item, event.currentTarget, event.currentTarget.parentElement!)}>
                    <strong className="today-untimed-title"><img className="week-recurring-icon" src={recurringIcon} alt="" aria-hidden="true" />{item.title}</strong>
                    <span className="today-untimed-meta">
                      <span className="timeline-fact-type type-recurring">{taskBlockTypeLabels.recurring.short}</span>
                      {item.tags.length > 0 && <span className="today-untimed-tags">
                        <span className="today-untimed-tag">{item.tags[0]}</span>
                        {item.tags.length > 1 && <span className="today-untimed-tag-more" aria-label={`共 ${item.tags.length} 个标签`}>+{item.tags.length - 1}</span>}
                      </span>}
                    </span>
                  </button>
                </div>;
              })}
              {allDayEvents.map((event) => (
                <div
                  key={`allday:${event.id}`}
                  className="today-untimed-item fixed"
                  {...timelineTooltipProps({
                    kind: "固定日程",
                    title: event.title,
                    time: "全天",
                    detail: "固定日程；同一时段仍可安排其他事项",
                    tone: "fixed",
                    statusLabel: "全天固定日程",
                    footerKind: "info",
                    footerText: "固定日程 · 点击查看说明"
                  })}
                >
                  <span className="today-untimed-dot" aria-hidden="true" />
                  <button type="button" className="today-untimed-copy" onClick={(clickEvent) => selectTimelineItem({ kind: "event", id: event.id }, clickEvent.currentTarget)}>
                    <strong className="today-untimed-title">{event.title}</strong>
                    <span className="today-untimed-meta"><span className="today-untimed-tag">全天</span></span>
                  </button>
                </div>
              ))}
            </div> : <p className="today-rail-empty">当日暂无不限时安排</p>}
          </section>

          <section className="today-rail-card today-agenda-card" aria-label="当日安排清单">
            <header className="today-rail-head">
              <h3>当日安排清单</h3>
              <span className="today-rail-count">{agendaEntries.length} 项</span>
            </header>
            {agendaEntries.length > 0 ? <div
              ref={agendaListRef}
              className="today-agenda-list"
              onWheel={() => { agendaUserScrolledRef.current = true; }}
              onTouchMove={() => { agendaUserScrolledRef.current = true; }}
              onPointerDown={(event) => { if (event.currentTarget === event.target) agendaUserScrolledRef.current = true; }}
              onKeyDown={(event) => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) agendaUserScrolledRef.current = true; }}
            >
              {agendaEntries.map((entry) => {
                const isRunningNow = isAgendaEntryRunningNow(entry);
                return (
                  <div
                    key={entry.layoutKey}
                    data-agenda-key={entry.layoutKey}
                    className={`today-agenda-item kind-${entry.kind}${entry.outcome ? ` execution-${entry.outcome}` : ""}${entry.done ? " is-done" : ""}${isRunningNow ? " is-now" : ""}`}
                  >
                    <button type="button" className="today-agenda-copy" onClick={() => locateTimelineKey(entry.layoutKey)}>
                      {isRunningNow && <span className="today-agenda-live-dot" aria-hidden="true" />}
                      <time className="today-agenda-time" dateTime={entry.startsAt}>{timeInputValue(entry.startsAt)}</time>
                      <span className="today-agenda-title">{entry.title}</span>
                      {entry.priority && <span className={`today-agenda-priority timeline-fact-priority priority-${entry.priority}`}>{priorityShortLabels[entry.priority]}</span>}
                    </button>
                  </div>
                );
              })}
            </div> : <p className="today-rail-empty">当日暂无安排</p>}
          </section>
        </aside>
        </div>}
      </div>
      {overflowKeys && <TimelineOverflowDialog members={timelineItems.filter(item => overflowKeys.includes(item.layoutKey) && item.timelineKind !== "create").sort((a,b) => a.starts_at.localeCompare(b.starts_at)).map(item => ({key: item.layoutKey, title: item.timelineKind === "recurring" ? item.item.title : item.timelineKind === "event" ? item.title : "task_title" in item ? item.task_title : "选区", time: timeRangeLabel(item.starts_at, item.ends_at)}))} onClose={() => setOverflowKeys(null)} onLocate={key => {
        setOverflowKeys(null);
        locateTimelineKey(key);
      }} />}
      {pendingRecycledCompletion && createPortal(<div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !quickCompletingBlockId) { setPendingRecycledCompletion(null); setRecycledCompletionError(null); } }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="recycled-block-completion-title" aria-describedby="recycled-block-completion-description" busy={Boolean(quickCompletingBlockId)} tone="success" onCancel={() => { if (!quickCompletingBlockId) { setPendingRecycledCompletion(null); setRecycledCompletionError(null); } }}><h2 id="recycled-block-completion-title">完成这次安排？</h2><div id="recycled-block-completion-description" className="confirmation-body"><strong className="confirmation-object">{pendingRecycledCompletion.block.task_title}</strong><p>仅完成 {pendingRecycledCompletion.date} 的这一次安排并记录执行结果，任务仍保留在回收站。{pendingRecycledCompletion.date < today ? "历史完成记录不可取消。" : ""}</p>{recycledCompletionError && <p className="confirmation-error" role="alert">{recycledCompletionError}</p>}</div><div className="dialog-actions"><button type="button" autoFocus disabled={Boolean(quickCompletingBlockId)} onClick={() => { setPendingRecycledCompletion(null); setRecycledCompletionError(null); }}>取消</button><button type="button" className="dialog-save" disabled={Boolean(quickCompletingBlockId)} onClick={() => void quickCompleteTimelineBlock(pendingRecycledCompletion.block, true, pendingRecycledCompletion.note)}>{quickCompletingBlockId === pendingRecycledCompletion.block.id ? "正在记录…" : "完成这次安排"}</button></div></ConfirmationDialog></div>, document.body)}
      {pendingTrashBlock && createPortal(<MoveTaskToTrashDialog
        title={pendingTrashBlock.title}
        description="将整个任务移入回收站，并从日、周、月视图移除展示；任务及已有执行记录会在回收站保留 30 天，恢复后重新展示。"
        busy={trashingBlock || busy}
        error={trashBlockError}
        titleId="timeline-task-trash-title"
        descriptionId="timeline-task-trash-description"
        onCancel={() => { if (!trashingBlock && !busy) { setPendingTrashBlock(null); setTrashBlockError(null); } }}
        onConfirm={() => void confirmTrashSelectedBlock()}
      />, document.body)}
      {pendingRecurringChange && <RecurringScopeConfirmation change={pendingRecurringChange} busy={savingRecurringChange} error={recurringChangeError} onCancel={cancelRecurringChange} onConfirm={(scope) => void commitTimelineRecurringChange(scope)} />}
      {todayView === "month" && monthRecurringError && <p className="recurring-calendar-error" role="alert">{monthRecurringError}</p>}
      {timelineDrag && !savingDraggedBlock && createPortal(<div className="timeline-drag-label" style={{ left: Math.max(12, Math.min(window.innerWidth - 160, timelineDrag.x + 16)), top: Math.max(12, Math.min(window.innerHeight - 40, timelineDrag.y - 40)) }} aria-hidden="true">{minutesClock(timelineDrag.start)} – {minutesClock(timelineDrag.end)}</div>, document.body)}
      {timelineTooltip && !timelineDrag && createPortal(
        isTaskTimelineTooltip(timelineTooltip) ? <TaskTimelineHoverCard content={timelineTooltip} cardRef={timelineTooltipCardRef}
          onPointerEnter={() => { timelineTooltipPointerRef.current = timelineTooltipCardRef.current; cancelTimelineTooltipHide(); }}
          onPointerLeave={() => { timelineTooltipPointerRef.current = null; scheduleTimelineTooltipHide(); }}
          onFocus={cancelTimelineTooltipHide} onBlur={scheduleTimelineTooltipHide} /> : <TimelineStaticHoverCard content={timelineTooltip} />,
        document.body
      )}
    </section>
  );
}


function SettingsPage({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollLockUntilRef = useRef(0);
  const applyingRef = useRef(false);
  const [activeCategory, setActiveCategory] = useState("settings-sec-holiday");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [taskLead, setTaskLead] = useState(5);
  const [desktop, setDesktop] = useState({ autostart: false, closeToTray: true });
  const [preferenceMessage, setPreferenceMessage] = useState("");
  const [preferenceLoadAttempt, setPreferenceLoadAttempt] = useState(0);
  const [feedbackHost, setFeedbackHost] = useState<HTMLDivElement | null>(null);
  const [feedback, setFeedback] = useState<{ title: string; error: boolean; id: number } | null>(null);
  const feedbackId = useRef(0);
  const savedPreferences = useRef<{ taskLead: number; desktop: typeof desktop } | null>(null);
  const preferencesDirty = Boolean(savedPreferences.current && JSON.stringify({ taskLead, desktop }) !== JSON.stringify(savedPreferences.current));
  const dirty = preferencesDirty;
  const preferencesDisabled = saving || !savedPreferences.current;
  const ready = Boolean(savedPreferences.current);
  const categoryItems = [
    {
      id: "settings-sec-holiday",
      label: "节假日数据",
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2.5" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
    },
    {
      id: "settings-sec-reminder",
      label: "提醒与通知",
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
    },
    {
      id: "settings-sec-system",
      label: "系统",
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg>
    },
    {
      id: "settings-sec-about",
      label: "关于",
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
    }
  ];

  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    let active = true;
    setPreferenceMessage("");
    void Promise.all([
      getUiSetting("ui.reminder.task_lead"), getUiSetting("ui.desktop.close_to_tray"), getAutostartEnabled()
    ]).then(([storedTaskLead, closeToTray, autostart]) => {
      if (!active) return;
      const value = Number(storedTaskLead ?? 5);
      const nextTaskLead = Number.isInteger(value) && value >= 0 && value <= 60 ? value : 5;
      const nextDesktop = { autostart, closeToTray: closeToTray !== "false" };
      savedPreferences.current = { taskLead: nextTaskLead, desktop: nextDesktop };
      setTaskLead(nextTaskLead);
      setDesktop(nextDesktop);
    }).catch((reason) => { if (active) setPreferenceMessage(uiErrorMessage(reason)); });
    return () => { active = false; };
  }, [preferenceLoadAttempt]);

  function showFeedback(title: string, error = false) {
    setFeedback({ title, error, id: ++feedbackId.current });
  }

  function requestClose() {
    if (applyingRef.current) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  }

  function restoreDefaults() {
    if (!ready || applyingRef.current) return;
    setTaskLead(5);
    setDesktop({ autostart: false, closeToTray: true });
    setSaveMessage("已恢复默认值，应用后生效");
    setPreferenceMessage("");
  }

  function stepTaskLead(delta: number) {
    if (preferencesDisabled) return;
    const base = Number.isInteger(taskLead) ? taskLead : 5;
    setTaskLead(Math.max(0, Math.min(60, base + delta)));
    setSaveMessage("");
  }

  function jumpToCategory(categoryId: string) {
    setActiveCategory(categoryId);
    scrollLockUntilRef.current = Date.now() + 900;
    const container = contentRef.current;
    const target = container?.querySelector<HTMLElement>(`#${categoryId}`) ?? null;
    if (!container || !target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop = Math.max(0, container.scrollTop + (targetRect.top - containerRect.top) - 16);
    const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    container.scrollTo({ top: nextTop, behavior: reducedMotion ? "auto" : "smooth" });
  }

  function releaseScrollLock() {
    scrollLockUntilRef.current = 0;
  }

  function handleContentScroll() {
    if (Date.now() < scrollLockUntilRef.current) return;
    const container = contentRef.current;
    if (!container) return;
    if (container.scrollHeight - container.clientHeight > 8 && container.scrollTop + container.clientHeight >= container.scrollHeight - 4) {
      setActiveCategory(categoryItems[categoryItems.length - 1].id);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    let current = categoryItems[0].id;
    for (const item of categoryItems) {
      const el = container.querySelector<HTMLElement>(`#${item.id}`);
      if (el && el.getBoundingClientRect().top - containerRect.top <= 48) {
        current = item.id;
      }
    }
    setActiveCategory(current);
  }

  async function savePreferences() {
    const saved = savedPreferences.current;
    if (!saved) return;
    const writes: Promise<void>[] = [];
    if (taskLead !== saved.taskLead) writes.push(setUiSetting("ui.reminder.task_lead", String(taskLead)).then(() => { saved.taskLead = taskLead; }));
    if (desktop.closeToTray !== saved.desktop.closeToTray) writes.push(setUiSetting("ui.desktop.close_to_tray", String(desktop.closeToTray)).then(() => { saved.desktop.closeToTray = desktop.closeToTray; }));
    if (desktop.autostart !== saved.desktop.autostart) writes.push(setAutostartEnabled(desktop.autostart).then(() => { saved.desktop.autostart = desktop.autostart; }));
    const results = await Promise.allSettled(writes);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }

  async function applySettings(closeAfter: boolean) {
    if (applyingRef.current || !ready) return;
    if (!Number.isInteger(taskLead) || taskLead < 0 || taskLead > 60) {
      setSaveMessage("提醒时间须为 0 到 60 分钟的整数，0 表示关闭");
      return;
    }
    if (!dirty) { if (closeAfter) onClose(); return; }
    applyingRef.current = true;
    setSaving(true);
    setSaveMessage("正在应用设置…");
    setPreferenceMessage("");
    try {
      await savePreferences();
      setSaveMessage("设置已应用");
      showFeedback("设置已应用");
      if (closeAfter) onClose();
    } catch (reason) {
      const errorText = `提醒与系统设置：${uiErrorMessage(reason)}`;
      setSaveMessage(`部分设置未应用，请重试。${errorText}`);
      showFeedback(`设置未全部应用：${errorText}`, true);
    } finally { applyingRef.current = false; setSaving(false); }
  }

  return <dialog ref={dialogRef} className="settings-dialog" aria-labelledby="settings-dialog-title" aria-modal="true" aria-busy={saving}
    onCancel={(event) => { event.preventDefault(); requestClose(); }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); return; }
      if (event.key === "Tab" && !event.defaultPrevented && !confirmClose) {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex='0']")].filter((control) => control.getClientRects().length > 0);
        const target = event.shiftKey ? controls.at(-1) : controls[0];
        if (document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) {
          event.preventDefault(); target?.focus();
        }
      }
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation();
      if (confirmClose) { if (!saving) setConfirmClose(false); } else requestClose();
    }} onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) requestClose();
    }}>
    <header className="settings-dialog-header"><button type="button" className="settings-text-button" disabled={!ready || saving} onClick={(event) => { restoreDefaults(); event.currentTarget.blur(); }}>恢复默认</button><h1 id="settings-dialog-title">偏好设置</h1><button type="button" className="settings-close-button" aria-label="关闭设置" disabled={saving} autoFocus onClick={requestClose}><Icon name="close" size={16} /></button></header>
    <form className="settings-dialog-form" onSubmit={(event) => { event.preventDefault(); void applySettings(false); }}>
      <div className="settings-dialog-split">
        <nav className="settings-dialog-rail" aria-label="设置分类">
          {categoryItems.map((item) => (
            <button key={item.id} type="button" className={`settings-rail-item${activeCategory === item.id ? " is-active" : ""}`} aria-current={activeCategory === item.id ? "location" : undefined} onClick={() => jumpToCategory(item.id)}>
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div ref={contentRef} className="settings-dialog-content" tabIndex={0} role="region" aria-label="设置内容" onScroll={handleContentScroll} onWheel={releaseScrollLock} onPointerDown={releaseScrollLock} onTouchStart={releaseScrollLock} onKeyDown={releaseScrollLock}><fieldset className="settings-dialog-fields" disabled={saving}>
          <section id="settings-sec-holiday" className="settings-dialog-section" aria-labelledby="settings-holiday-title">
            <div className="settings-section-head">
              <h2 id="settings-holiday-title">节假日数据</h2>
              <span>用于月历休/班标记与法定工作日重复</span>
            </div>
            <HolidayCalendarSettings compact onResult={showFeedback} />
          </section>
          <section id="settings-sec-reminder" className="settings-dialog-section" aria-labelledby="settings-reminder-title">
            <div className="settings-section-head">
              <h2 id="settings-reminder-title">提醒与通知</h2>
              <span>桌面通知触发设置</span>
            </div>
            <div className="settings-dialog-row">
              <label className="settings-field-copy" htmlFor="settings-task-lead"><strong id="settings-reminder-label">任务块提前提醒</strong><small id="settings-reminder-help">开始前和结束前提醒，0–60 分钟，0 表示关闭{taskLead === 0 ? "（当前已关闭）" : ""}</small></label>
              <div className="settings-reminder-inputs"><span className="settings-minutes-input"><input id="settings-task-lead" type="number" inputMode="numeric" autoComplete="off" min={0} max={60} step={1} aria-describedby="settings-reminder-help" aria-labelledby="settings-reminder-label" value={Number.isNaN(taskLead) ? "" : taskLead} disabled={preferencesDisabled} onFocus={(event) => event.currentTarget.select()} onChange={(event) => { setTaskLead(event.target.value === "" ? NaN : Number(event.target.value)); setSaveMessage(""); }} /><span className="settings-minutes-unit" aria-hidden="true">分钟</span><span className="settings-stepper-col"><button type="button" aria-label="增加提醒分钟" disabled={preferencesDisabled || (!Number.isNaN(taskLead) && taskLead >= 60)} onClick={() => stepTaskLead(1)}><svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="2 6.5 5 3.5 8 6.5" /></svg></button><button type="button" aria-label="减少提醒分钟" disabled={preferencesDisabled || (!Number.isNaN(taskLead) && taskLead <= 0)} onClick={() => stepTaskLead(-1)}><svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="2 3.5 5 6.5 8 3.5" /></svg></button></span></span>
                <button type="button" className="settings-test-button" disabled={saving} onClick={() => void sendTestNotification().then(() => showFeedback("测试通知已发送")).catch((reason) => showFeedback(uiErrorMessage(reason), true))}>测试通知</button>
              </div>
            </div>
          </section>
          <section id="settings-sec-system" className="settings-dialog-section" aria-labelledby="settings-system-title">
            <div className="settings-section-head">
              <h2 id="settings-system-title">系统</h2>
              <span>启动与窗口驻留行为</span>
            </div>
            <div className="settings-dialog-row"><span className="settings-field-copy"><strong>开机启动</strong><small>登录后在后台启动</small></span><span className="settings-switch-cluster"><span className="settings-switch-state" aria-hidden="true">{desktop.autostart ? "已开启" : "已关闭"}</span><button type="button" role="switch" aria-label="开机启动" aria-checked={desktop.autostart} disabled={preferencesDisabled} className={`switch-control${desktop.autostart ? " enabled" : ""}`} onClick={() => { setDesktop({ ...desktop, autostart: !desktop.autostart }); setSaveMessage(""); }}><span /></button></span></div>
            <div className="settings-dialog-row"><span className="settings-field-copy"><strong>关闭到托盘</strong><small>关闭窗口后继续运行和提醒</small></span><span className="settings-switch-cluster"><span className="settings-switch-state" aria-hidden="true">{desktop.closeToTray ? "已开启" : "已关闭"}</span><button type="button" role="switch" aria-label="关闭到托盘" aria-checked={desktop.closeToTray} disabled={preferencesDisabled} className={`switch-control${desktop.closeToTray ? " enabled" : ""}`} onClick={() => { setDesktop({ ...desktop, closeToTray: !desktop.closeToTray }); setSaveMessage(""); }}><span /></button></span></div>
          </section>
          <section id="settings-sec-about" className="settings-dialog-section" aria-labelledby="settings-about-title">
            <div className="settings-section-head">
              <h2 id="settings-about-title">关于</h2>
              <span>版本与运行说明</span>
            </div>
            <div className="settings-about-brand">
              <span className="settings-about-logo-frame"><Logo /></span>
              <div className="settings-about-title-group">
                <strong>今序<CopySeparator />Dayweave</strong>
                <span>让今天，井然有序。<CopySeparator />Bring order to your day.</span>
              </div>
            </div>
            <dl className="settings-about-facts">
              <div><dt>版本</dt><dd className="is-mono">0.1.0</dd></div>
              <div><dt>应用标识</dt><dd className="is-mono">com.dayweave.desktop</dd></div>
              <div><dt>数据存储</dt><dd className="is-mono">dayweave.sqlite3</dd></div>
              <div><dt>语言与时区</dt><dd>简体中文<CopySeparator />北京时间</dd></div>
              <div><dt>运行原则</dt><dd>所有日程、任务与偏好均保存在本机，仅在您主动检查节假日更新时访问网络。</dd></div>
            </dl>
          </section>
          {!savedPreferences.current && preferenceMessage && <div className="settings-load-error" role="alert"><span>提醒与系统设置加载失败：{preferenceMessage}</span><button type="button" onClick={() => setPreferenceLoadAttempt((value) => value + 1)}>重试</button></div>}
        </fieldset></div>
      </div>
      <footer className="settings-dialog-footer"><span className="settings-save-status" role="status">{saveMessage || preferenceMessage || (dirty ? "有未应用的修改" : !ready ? "正在加载设置…" : "")}</span><div className="settings-dialog-actions"><button type="button" className="settings-text-button" disabled={saving} onClick={requestClose}>关闭</button><button type="submit" disabled={saving || !ready || !dirty}>应用</button><button type="button" className="settings-apply-close" disabled={saving || !ready} onClick={() => void applySettings(true)}>{saving ? "正在应用…" : "应用并关闭"}</button></div></footer>
    </form>
    <div ref={setFeedbackHost} className="feedback-toast-viewport settings-feedback-viewport" />
    {feedback && <Toast key={feedback.id} container={feedbackHost} title={feedback.title} tone={feedback.error ? "error" : "success"} duration={4000} onDismiss={() => setFeedback(null)} />}
    {confirmClose && <div className="dialog-backdrop settings-discard-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setConfirmClose(false); }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="settings-leave-dialog-title" aria-describedby="settings-leave-dialog-description" busy={saving} tone="caution" onCancel={() => { if (!saving) setConfirmClose(false); }}><h2 id="settings-leave-dialog-title">放弃未应用的修改？</h2><p id="settings-leave-dialog-description">未应用的设置修改将被放弃，已生效的设置保持不变。</p><div className="dialog-actions"><button type="button" autoFocus disabled={saving} onClick={() => setConfirmClose(false)}>继续编辑</button><button type="button" className="dialog-discard" disabled={saving} onClick={onClose}>放弃修改</button></div></ConfirmationDialog></div>}
  </dialog>;
}

export default function App() {
  const holidayRevision = useHolidayCalendarSync();
  const previousHolidayRevision = useRef(holidayRevision);
  const [today, setToday] = useState(() => shanghaiDateValue());
  const [selectedDate, setSelectedDate] = useState(() => shanghaiDateValue());
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;
  const [active, setActive] = useState("今日");
  const [todayView, setTodayView] = useState<ScheduleView>("timeline");
  const todayViewActionsRef = useRef<{ openDay: () => void; openWeek: () => void; openMonth: () => void } | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recurringItems, setRecurringItems] = useState<RecurringItem[]>([]);
  const [recurringOccurrences, setRecurringOccurrences] = useState<RecurringOccurrence[]>([]);
  const [sidebarDraftCount, setSidebarDraftCount] = useState(0);
  const sidebarCounts = useMemo(() => taskViewCounts(tasks, sidebarDraftCount, recurringItems), [tasks, sidebarDraftCount, recurringItems]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const tasksRequested = useRef(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [taskEditorDirty, setTaskEditorDirty] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<NavigationIntent | null>(null);
  const [pendingPlanLeave, setPendingPlanLeave] = useState<PlanLeaveIntent | null>(null);
  const [planLeaveError, setPlanLeaveError] = useState<string | null>(null);
  const [daySchedule, setDaySchedule] = useState<DaySchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [planPreview, setPlanPreview] = useState<RulePlanPreview | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planToast, setPlanToast] = useState<{ id: number; label: string; message: string; icon?: IconName; undoId?: string; taskSeed?: TaskSeed } | null>(null);
  const [requestedTaskView, setRequestedTaskView] = useState<TaskViewRequest | null>(null);
  const [timelineReturnContext, setTimelineReturnContext] = useState<TimelineReturnContext | null>(null);
  const reminderNavigationRef = useRef<(event: ReminderAction) => void>(() => {});
  reminderNavigationRef.current = ({ target, action }) => {
    if (action === "completed") {
      void Promise.all([refreshTasks(false), refreshSchedule(selectedDate, false)]).catch((reason) => setMessage(`任务已完成，刷新失败：${uiErrorMessage(reason)}`));
    } else {
      requestNavigation({ active: "今日", date: target.date, timelineReturnContext: { date: target.date, blockId: target.blockId } });
    }
  };

  useEffect(() => {
    let disposed = false;
    let stopListening: (() => void) | undefined;
    void onReminderActivated((event) => { if (!disposed) reminderNavigationRef.current(event); }).then((unlisten) => {
      if (disposed) unlisten();
      else stopListening = unlisten;
    }).catch((reason) => { if (!disposed) setMessage(`提醒定位暂不可用：${uiErrorMessage(reason)}`); });
    return () => { disposed = true; stopListening?.(); };
  }, []);
  const workspaceRef = useRef<HTMLElement>(null);
  const previousPageRef = useRef(active);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const summaryTaskBlocks = visibleTaskScheduleBlocks(daySchedule?.task_blocks ?? [], selectedDate, today);
  const summaryUntimedTasks = visibleUntimedTasksForDate(tasks, daySchedule?.task_blocks ?? [], selectedDate);
  const plannedTaskCount = summaryTaskBlocks.length;
  const completedPlannedTaskCount = summaryTaskBlocks.filter((block) => (block.review?.outcome ?? block.execution_status) === "completed").length;
  const plannedMinutes = summaryTaskBlocks.reduce((total, block) => total + Math.round((new Date(block.ends_at).getTime() - new Date(block.starts_at).getTime()) / 60000), 0);
  const summaryRecurringOccurrences = recurringOccurrences.filter((item) => item.occurrence_date === selectedDate);
  const summaryMinutes = plannedMinutes + summaryRecurringOccurrences.reduce((total, item) => total + (item.display_duration_minutes ?? 0), 0);
  const recurringItemCount = summaryRecurringOccurrences.length;
  const completedRecurringItemCount = summaryRecurringOccurrences.filter((item) => item.outcome === "completed").length;
  const summaryArrangementCount = plannedTaskCount + summaryUntimedTasks.length + recurringItemCount;
  const completedArrangementCount = completedPlannedTaskCount + summaryUntimedTasks.filter((task) => task.status === "done").length + completedRecurringItemCount;
  const summaryPendingCount = Math.max(0, summaryArrangementCount - completedArrangementCount);
  const summaryProgress = summaryArrangementCount ? Math.round(completedArrangementCount / summaryArrangementCount * 100) : 0;

  useLayoutEffect(() => {
    const previousPage = previousPageRef.current;
    previousPageRef.current = active;
    const workspace = workspaceRef.current;
    if (previousPage === active || !workspace || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const direction = navigation.findIndex((item) => item.label === active) > navigation.findIndex((item) => item.label === previousPage) ? 1 : -1;
    const animation = workspace.animate([
      { opacity: .55, transform: `translateY(${direction * 4}px)` },
      { opacity: 1, transform: "translateY(0)" }
    ], { duration: 200, easing: "cubic-bezier(.16,1,.3,1)" });
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stopAnimation = () => { if (preference.matches) animation.cancel(); };
    preference.addEventListener("change", stopAnimation);
    return () => { animation.cancel(); preference.removeEventListener("change", stopAnimation); };
  }, [active]);

  async function refreshTasks(showLoading = true) {
    if (showLoading) setTasksLoading(true);
    setTasksError(null);
    try {
      const [nextTasks, nextRecurringItems] = await Promise.all([listTasks(true), listRecurringItems(true, true)]);
      setTasks(nextTasks);
      setRecurringItems(nextRecurringItems);
    }
    catch (reason) { setTasksError(uiErrorMessage(reason)); }
    finally { if (showLoading) setTasksLoading(false); }
  }

  async function refreshSchedule(date = selectedDate, showLoading = true) {
    if (showLoading) setScheduleLoading(true);
    setScheduleError(null);
    try {
      const [schedule, draft, occurrences] = await Promise.all([
        getDaySchedule(date), getRulePlanDraft(date), listRecurringOccurrences(date)
      ]);
      if (date !== selectedDateRef.current) return;
      setDaySchedule(schedule);
      setPlanPreview(draft);
      setRecurringOccurrences(occurrences);
    }
    catch (reason) { if (date === selectedDateRef.current) { setDaySchedule(null); setRecurringOccurrences([]); setScheduleError(uiErrorMessage(reason)); } }
    finally { if (showLoading && date === selectedDateRef.current) setScheduleLoading(false); }
  }

  useEffect(() => {
    if (previousHolidayRevision.current === holidayRevision) return;
    previousHolidayRevision.current = holidayRevision;
    const date = selectedDateRef.current;
    // Refresh rule projections only; do not reset an edited plan preview or reschedule tasks.
    void refreshTasks(false);
    void listRecurringOccurrences(date).then((items) => {
      if (selectedDateRef.current === date) setRecurringOccurrences(items);
    }).catch((reason) => { if (selectedDateRef.current === date) setScheduleError(uiErrorMessage(reason)); });
  }, [holidayRevision]);

  useEffect(() => {
    document.documentElement.dataset.theme = "default";
    document.documentElement.dataset.mode = "light";
    void listTaskDrafts(false).then((drafts) => setSidebarDraftCount(drafts.length))
      .catch((reason) => setMessage(`草稿数量暂不可用：${uiErrorMessage(reason)}`));
  }, []);

  useEffect(() => {
    setPlanPreview(null);
    setPlanToast(null);
    setMessage("");
    void Promise.all([refreshTasks(!tasksRequested.current), refreshSchedule(selectedDate)]);
    tasksRequested.current = true;
  }, [selectedDate]);


  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentDate = shanghaiDateValue();
      setToday((previous) => previous === currentDate ? previous : currentDate);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    void getUiSetting(SHELL_SIDEBAR_COLLAPSED_SETTING).then((value) => {
      if (active && value !== null) setSidebarCollapsed(value === "true");
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function updatePlanDraft(nextPreview: RulePlanPreview) {
    if (planBusy) return nextPreview;
    setMessage("");
    setPlanBusy(true);
    try {
      const saved = await updateRulePlanDraft(nextPreview);
      if (selectedDateRef.current === nextPreview.plan_date) setPlanPreview(saved);
      await refreshTasks(false);
      setMessage("");
      return saved;
    } catch (reason) {
      throw reason;
    } finally {
      setPlanBusy(false);
    }
  }

  async function trashTimelineTask(taskId: string) {
    if (planBusy) throw new Error("正在保存安排，请稍后再试");
    setPlanBusy(true);
    setPlanToast(null);
    setMessage("");
    try {
      await softDeleteManualTask(taskId, true);
      try {
        taskCommitted(await getTask(taskId));
      } catch {
        await Promise.all([refreshTasks(false), refreshSchedule(selectedDate, false)]);
        setPlanToast({ id: Date.now(), label: "已移入回收站", message: "", icon: "check" });
        return;
      }
      await refreshTasks(false);
      setPlanToast({ id: Date.now(), label: "已移入回收站", message: "", icon: "check" });
    } finally { setPlanBusy(false); }
  }

  async function saveBlockTime(block: PlanBlock, startsAt: string, endsAt: string) {
    if (planBusy) throw new Error("正在保存安排，请稍后再试");
    setPlanBusy(true);
    setPlanToast(null);
    setMessage("");
    try {
      const saved = await updatePlanBlockTime(selectedDate, block, startsAt, endsAt);
      if (selectedDateRef.current === selectedDate) setDaySchedule(saved);
      await refreshTasks(false);
      const undo = await latestUndo().catch(() => null);
      setPlanToast({
        id: Date.now(), label: "时间调整已保存", message: "", icon: "check",
        undoId: undo?.target_type === "task" && undo.target_id === block.task_id ? undo.id : undefined
      });
    } finally { setPlanBusy(false); }
  }

  async function discardPlanDraft() {
    if (!planPreview || planBusy) return false;
    setPlanBusy(true);
    setPlanLeaveError(null);
    try {
      const result = await discardRulePlanDraft(planPreview.preview_id, planPreview.version);
      setPlanPreview(null);
      setPlanLeaveError(null);
      setMessage("");
      await refreshTasks(false);
      const restoredMessage = result.restored_task_count > 0
        ? `已恢复 ${result.restored_task_count} 项任务时间`
        : "";
      const conflictMessage = result.conflicted_task_titles.length > 0
        ? `${result.conflicted_task_titles.length} 项另有修改，保持不变`
        : "";
      setPlanToast({
        id: Date.now(),
        label: "计划草案已放弃",
        message: [restoredMessage, conflictMessage].filter(Boolean).join("；"),
        icon: result.conflicted_task_titles.length > 0 ? "review" : "check"
      });
      return true;
    } catch (reason) {
      const errorText = `草案未能放弃：${uiErrorMessage(reason)}`;
      setPlanLeaveError(errorText);
      setMessage(errorText);
      return false;
    } finally {
      setPlanBusy(false);
    }
  }

  async function confirmRulePlan() {
    if (!planPreview || planBusy) return;
    if (planPreview.plan_date < today) {
      setPlanPreview(null);
      setMessage("这份计划草案对应的日期已经过去，无法再保存。");
      return;
    }
    const wasAdjustment = Boolean(planPreview.base_plan_id);
    setPlanBusy(true);
    try {
      setDaySchedule(await confirmRuleBasedPlan(planPreview));
      setPlanPreview(null);
      await refreshTasks(false);
      const undo = await latestUndo().catch(() => null);
      setMessage("");
      setPlanToast({
        id: Date.now(),
        label: wasAdjustment ? "计划调整已确认" : "日计划已确认",
        message: "",
        icon: "check",
        undoId: undo?.target_type === "daily_plan" ? undo.id : undefined
      });
    } catch (reason) { setMessage(`计划没有保存：${uiErrorMessage(reason)}`); }
    finally { setPlanBusy(false); }
  }

  async function undoConfirmedPlan(undoId: string) {
    if (planBusy) return;
    setPlanBusy(true);
    try {
      await applyUndo(undoId);
      setPlanToast(null);
      await Promise.all([refreshTasks(false), refreshSchedule(selectedDate, false)]);
      setMessage("");
      setPlanToast({
        id: Date.now(),
        label: "操作已撤销",
        message: "",
        icon: "check"
      });
    } catch (reason) {
      setPlanToast(null);
      setMessage(`无法撤销这次操作：${uiErrorMessage(reason)}`);
    } finally { setPlanBusy(false); }
  }


  function applyNavigation(intent: NavigationIntent) {
    if (intent.date && intent.date !== selectedDate) {
      setScheduleLoading(true);
      setSelectedDate(intent.date);
    } else if (intent.active === "今日" && (intent.timelineReturnContext?.blockId || intent.timelineReturnContext?.taskId || intent.timelineReturnContext?.occurrenceId || intent.timelineReturnContext?.eventId)) {
      void refreshSchedule(selectedDate);
    }
    if (intent.todayView) setTodayView(intent.todayView);
    setRequestedTaskView(intent.taskView || intent.createTask || intent.taskId || intent.recurringItemId || intent.taskSeed
      ? { view: intent.taskView, createTask: intent.createTask, taskId: intent.taskId, recurringItemId: intent.recurringItemId, taskSeed: intent.taskSeed, completeOnOpen: intent.completeOnOpen }
      : null);
    setTimelineReturnContext(intent.todayView && intent.todayView !== "timeline" ? null : intent.timelineReturnContext ?? null);
    const normalized = normalizeTodayNavigation(intent.active);
    setActive(normalized.active);
    setMobileNavOpen(false);
  }

  function requestNavigation(intent: NavigationIntent) {
    const target = normalizeTodayNavigation(intent.active);
    if (active === "任务" && target.active === "今日" && !intent.date && !intent.timelineReturnContext && !intent.todayView && timelineReturnContext) {
      intent = { ...intent, timelineReturnContext };
    }
    if (planPreview && ((active === "今日" && target.active !== "今日") || (intent.date && intent.date !== selectedDate))) {
      setMobileNavOpen(false);
      setPlanLeaveError(null);
      setPendingPlanLeave({ kind: "navigation", intent });
      return;
    }
    if (active === "任务" && taskEditorDirty && (intent.active !== "任务" || Boolean(intent.taskView) || Boolean(intent.createTask) || Boolean(intent.taskId) || Boolean(intent.taskSeed))) {
      setMobileNavOpen(false);
      setPendingNavigation(intent);
      return;
    }
    applyNavigation(intent);
  }


  function requestDateSelection(date: string) {
    if (date === selectedDate) return true;
    if (planPreview) {
      setPlanLeaveError(null);
      setPendingPlanLeave({ kind: "date", date });
      return false;
    }
    setScheduleLoading(true);
    setSelectedDate(date);
    return true;
  }

  async function resolvePendingPlanLeave(discard: boolean) {
    const target = pendingPlanLeave;
    if (!discard) {
      setPlanLeaveError(null);
      setPendingPlanLeave(null);
      return;
    }
    setPlanLeaveError(null);
    if (!target || !await discardPlanDraft()) return;
    setPendingPlanLeave(null);
    setPlanLeaveError(null);
    if (target.kind === "date") setSelectedDate(target.date);
    else applyNavigation(target.intent);
  }

  function resolvePendingNavigation(proceed: boolean) {
    const intent = pendingNavigation;
    setPendingNavigation(null);
    if (proceed && intent) applyNavigation(intent);
  }

  function taskCommitted(task: Task) {
    setTasks((current) => current.some((item) => item.id === task.id)
      ? current.map((item) => item.id === task.id ? task : item)
      : [task, ...current]);
    if (task.status === "deleted" || task.deleted_at) {
      setDaySchedule((current) => current ? { ...current, task_blocks: current.task_blocks.map((block) => block.task_id === task.id ? { ...block, task_status: "deleted" } : block) } : current);
    }
    void refreshSchedule(selectedDate, false);
  }

  const [headerViewSlot, setHeaderViewSlot] = useState<HTMLDivElement | null>(null);
  const [sidebarTaskView, setSidebarTaskView] = useState<TaskView>("scheduled");
  const notifyWindowError = useCallback((description: string) => {
    setPlanToast({ id: Date.now(), label: "窗口操作未完成", message: description, icon: "review" });
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return;
    function closeMobileNav(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setMobileNavOpen(false);
    }
    window.addEventListener("keydown", closeMobileNav);
    return () => window.removeEventListener("keydown", closeMobileNav);
  }, [mobileNavOpen]);

  const createShortcutActionRef = useRef<() => void>(() => {});
  createShortcutActionRef.current = () => {
    if (settingsOpen || pendingPlanLeave || pendingNavigation) return;
    if (typeof document !== "undefined" && document.querySelector('dialog[open], .dialog-backdrop, .schedule-picker-backdrop, .timeline-floating-layer.is-time-editor, .timeline-floating-layer.is-block-editor')) return;
    requestNavigation({ active: "任务", createTask: true });
  };
  useEffect(() => {
    function handleCreateShortcut(event: globalThis.KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.isComposing || event.key.toLocaleLowerCase() !== "n") return;
      event.preventDefault();
      if (event.repeat) return;
      createShortcutActionRef.current();
    }
    window.addEventListener("keydown", handleCreateShortcut, true);
    return () => window.removeEventListener("keydown", handleCreateShortcut, true);
  }, []);

  function toggleSidebarCollapsed() {
    const nextCollapsed = !sidebarCollapsed;
    setSidebarCollapsed(nextCollapsed);
    if (!("__TAURI_INTERNALS__" in window)) return;
    void setUiSetting(SHELL_SIDEBAR_COLLAPSED_SETTING, String(nextCollapsed))
      .catch((reason) => setMessage(`侧边栏状态未保存：${uiErrorMessage(reason)}`));
  }
  function switchGlobalScheduleView(nextView: ScheduleView) {
    if (active === "今日" && todayViewActionsRef.current) {
      if (nextView === "timeline") todayViewActionsRef.current.openDay();
      else if (nextView === "week") todayViewActionsRef.current.openWeek();
      else todayViewActionsRef.current.openMonth();
      return;
    }
    requestNavigation({ active: "今日", todayView: nextView });
  }

  return <div className="desktop-app">
    <AppTitlebar viewSlotRef={setHeaderViewSlot} onError={notifyWindowError} onCreateTask={() => requestNavigation({ active: "任务", createTask: true })} mobileNavOpen={mobileNavOpen} onToggleMobileNav={() => setMobileNavOpen((value) => !value)} />
    {headerViewSlot && createPortal(
      <div
        className={`timeline-view-switch${active !== "今日" ? " is-unselected-group" : ""}`}
        role="group"
        aria-label="日程视图"
        data-scope={active === "今日" ? "schedule" : "tasks"}
      >
        {([
          { view: "timeline", label: "日视图" },
          { view: "week", label: "周视图" },
          { view: "month", label: "月视图" }
        ] as const).map(({ view, label }) => {
          const isCurrent = active === "今日" && todayView === view;
          return (
            <button
              key={view}
              type="button"
              aria-pressed={isCurrent}
              aria-label={label}
              className={isCurrent ? "is-active" : ""}
              onClick={() => switchGlobalScheduleView(view)}
            >
              <ScheduleViewIcon view={view} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>,
      headerViewSlot
    )}
    <main className={`next-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
    <ToastViewport />
    {planToast && <Toast key={planToast.id} title={planToast.label} description={planToast.message} tone={planToast.icon === "check" ? "success" : planToast.icon === "review" ? "error" : "info"} duration={planToast.undoId || planToast.taskSeed ? 10_000 : planToast.icon === "review" ? 5200 : 2800} onDismiss={() => setPlanToast(null)} actions={[
      ...(planToast.undoId ? [{ label: "撤销", onClick: () => void undoConfirmedPlan(planToast.undoId!) }] : []),
      ...(planToast.taskSeed ? [{ label: "新建任务", onClick: () => { requestNavigation({ active: "任务", taskSeed: planToast.taskSeed }); setPlanToast(null); } }] : [])
    ]} />}
    {pendingPlanLeave && planPreview && createPortal(<div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !planBusy) void resolvePendingPlanLeave(false); }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="plan-leave-dialog-title" aria-describedby="plan-leave-dialog-description" busy={planBusy} tone="caution" onCancel={() => void resolvePendingPlanLeave(false)}><h2 id="plan-leave-dialog-title">放弃未确认的日计划草案？</h2><div id="plan-leave-dialog-description" className="confirmation-body"><p>{planPreview.plan_date} 的计划草案尚未确认；离开后草案将被放弃，已调整的任务时间将恢复。</p>{planLeaveError && <p className="confirmation-error" role="alert">{planLeaveError}</p>}</div><div className="dialog-actions"><button type="button" autoFocus disabled={planBusy} onClick={() => void resolvePendingPlanLeave(false)}>继续编辑</button><button type="button" className="dialog-discard" disabled={planBusy} onClick={() => void resolvePendingPlanLeave(true)}>{planBusy ? "正在放弃…" : pendingPlanLeave.kind === "date" ? "放弃并切换" : "放弃并离开"}</button></div></ConfirmationDialog></div>, document.body)}
    <aside id="main-sidebar" className={`next-sidebar${mobileNavOpen ? " mobile-open" : ""}`} aria-label="主导航">
      <div className="sidebar-mobile-header">
        <strong>导航菜单</strong>
        <button type="button" className="sidebar-mobile-close" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)}><Icon name="close" size={16} /></button>
      </div>
      <div className="sidebar-primary-action">
        <button
          type="button"
          className="sidebar-create-task-btn"
          aria-label="新建任务"
          title={sidebarCollapsed ? "新建任务 (Ctrl+N)" : undefined}
          onClick={() => requestNavigation({ active: "任务", createTask: true })}
        >
          <Icon name="plus" size={15} />
          <span className="menu-label">新建任务</span>
        </button>
      </div>
      <nav aria-label="日程与任务">
        <div className="nav-section-label">日程视图</div>
        <button type="button" className={`menu-item${active === "今日" ? " active" : ""}`} aria-current={active === "今日" ? "page" : undefined} aria-label="今日安排" title={sidebarCollapsed ? "今日安排" : undefined} onClick={() => requestNavigation({ active: "今日" })}><SidebarIcon name="today" /><span className="menu-label">今日安排</span><span className="item-counter">{summaryArrangementCount}</span></button>
        <div className="nav-section-label task-section-label">任务管理</div>
        <button type="button" className={`menu-item${active === "任务" && sidebarTaskView === "all" ? " active" : ""}`} aria-current={active === "任务" && sidebarTaskView === "all" ? "page" : undefined} aria-label="全部任务" title={sidebarCollapsed ? "全部任务" : undefined} onClick={() => requestNavigation({ active: "任务", taskView: "all" })}><SidebarIcon name="all" /><span className="menu-label">全部任务</span><span className="item-counter">{sidebarCounts.all}</span></button>
        <div className="sidebar-task-views sidebar-subgroup" aria-label="任务分类">{sidebarTaskViews.map(({ view: taskView, label }) => <button key={taskView} type="button" className={`menu-item menu-sub-item${active === "任务" && sidebarTaskView === taskView ? " active" : ""}`} aria-label={label} title={sidebarCollapsed ? label : undefined} aria-current={active === "任务" && sidebarTaskView === taskView ? "page" : undefined} onClick={() => requestNavigation({ active: "任务", taskView })}><SidebarIcon name={taskView} /><span className="menu-label">{label}</span><span className="item-counter">{sidebarCounts[taskView]}</span></button>)}</div>
      </nav>
      <footer className="sidebar-footer-group">
        <section className="sidebar-summary-card" aria-label="当日进度">
          <header className="sidebar-summary-heading"><div className="summary-heading-left"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01 9 11.01" /></svg><h2>当日进度</h2></div><time dateTime={selectedDate} title={selectedDate}>{Number(selectedDate.slice(5, 7))}月{Number(selectedDate.slice(8, 10))}日</time></header>
          {summaryArrangementCount > 0 ? <div className="sidebar-summary-body">
            <div className="sidebar-summary-reading"><div className="sidebar-summary-fraction"><strong className="sidebar-summary-total">{completedArrangementCount}<span>/{summaryArrangementCount}</span></strong><span className="sidebar-summary-unit">已完成</span></div><span className={`sidebar-summary-percent${summaryProgress === 100 ? " is-done" : ""}`}>{summaryProgress}%</span></div>
            <div className="sidebar-plan-track" role="progressbar" aria-label="当日任务完成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summaryProgress} aria-valuetext={`已完成 ${completedArrangementCount} 项，共 ${summaryArrangementCount} 项`}><span style={{ width: `${summaryProgress}%` }} /></div>
            <div className="sidebar-summary-stats"><div className="sidebar-summary-stat"><span>待完成</span><strong>{summaryPendingCount} 项</strong></div><div className="sidebar-summary-stat"><span>安排时长</span><strong className={summaryMinutes === 0 ? "is-quiet" : undefined}>{formatSidebarSummaryDuration(summaryMinutes)}</strong></div></div>
          </div> : <p className="sidebar-summary-empty">暂无安排</p>}
        </section>
        {(tasksLoading || tasksError) && <span className={`database-state${tasksError ? " unavailable" : ""}`} role="status"><i />{tasksLoading ? "正在载入本地数据" : "本地数据暂时不可用"}</span>}
        <div className="sidebar-bottom-bar"><button type="button" className="settings-nav-btn" aria-label="偏好设置" title={sidebarCollapsed ? "偏好设置" : undefined} onClick={() => setSettingsOpen(true)}><svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9.5 3-.6 2.3-2 .9-2.2-.7-2.5 4.3 1.7 1.6v2.3l-1.7 1.6 2.5 4.3 2.2-.7 2 .9.6 2.2h5l.6-2.2 2-.9 2.2.7 2.5-4.3-1.7-1.6v-2.3l1.7-1.6-2.5-4.3-2.2.7-2-.9L14.5 3z" /><circle cx="12" cy="12.5" r="3" /></svg><span>偏好设置</span></button><button className="shell-collapse-button" type="button" aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} aria-controls="main-sidebar" aria-expanded={!sidebarCollapsed} onClick={toggleSidebarCollapsed}><Icon name={sidebarCollapsed ? "chevron-right" : "chevron-left"} size={15} /></button></div>
      </footer>
    </aside>
    <div className="shell-divider" aria-hidden="true" />
    {mobileNavOpen && <button type="button" className="nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}
    <section ref={workspaceRef} className="next-workspace">
      <button type="button" className="mobile-nav-button" aria-controls="main-sidebar" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((value) => !value)}><Icon name="more" size={18} />菜单</button>
      {active === "今日" && <div className="today-workspace">
        <div className="today-schedule-pane">
          <TodayPage visible today={today} selectedDate={selectedDate} onSelectDate={requestDateSelection} tasks={tasks} recurringItems={recurringItems} recurringOccurrences={recurringOccurrences} schedule={daySchedule} loading={scheduleLoading} error={scheduleError} preview={planPreview} busy={planBusy} onTrashTask={trashTimelineTask} onUpdatePlan={updatePlanDraft} onSaveBlockTime={saveBlockTime} onConfirmPlan={() => void confirmRulePlan()} onCancelPlan={discardPlanDraft} onOpenTasks={(taskId, returnContext) => requestNavigation({ active: "任务", taskId, timelineReturnContext: returnContext })} onOpenRecurringItem={(recurringItemId, returnContext) => requestNavigation({ active: "任务", recurringItemId, timelineReturnContext: returnContext })} onNewTask={(taskSeed) => requestNavigation({ active: "任务", taskSeed })} onFactsChanged={async (date = selectedDate) => { await Promise.all([refreshTasks(false), refreshSchedule(date, false)]); }} onNotify={(label, toastMessage, icon, undoId, taskSeed) => setPlanToast({ id: Date.now(), label, message: toastMessage, icon, undoId, taskSeed })} message={message} timelineReturnContext={timelineReturnContext} onTimelineReturnHandled={() => setTimelineReturnContext(null)} onLocateTimeline={(returnContext) => setTimelineReturnContext(returnContext)} todayView={todayView} onTodayViewChange={setTodayView} viewActionsRef={todayViewActionsRef} />
        </div>
      </div>}
      {active === "任务" && <TaskWorkspace tasks={tasks} recurringItems={recurringItems} loading={tasksLoading} error={tasksError} onReload={refreshTasks} onTaskCommitted={taskCommitted} onRecurringChanged={async () => { await Promise.all([refreshTasks(false), refreshSchedule(selectedDate, false)]); }} today={today} onDirtyChange={setTaskEditorDirty} externalNavigationRequest={pendingNavigation} onExternalNavigationResolved={resolvePendingNavigation} requestedView={requestedTaskView} onViewChange={setSidebarTaskView} onDraftCountChange={setSidebarDraftCount} timelineReturnContext={timelineReturnContext} onReturnToTimeline={(returnContext) => requestNavigation({ active: "今日", timelineReturnContext: returnContext })} onOpenToday={(date = today, taskId) => requestNavigation({ active: "今日", date, timelineReturnContext: taskId ? { date, taskId } : undefined })} />}
      {settingsOpen && <SettingsPage onClose={() => setSettingsOpen(false)} />}
    </section>
    </main>
  </div>;
}
