import { readRecurringDraft, RECURRING_DRAFT_KEY } from "./legacy-storage";
import {
  CSSProperties,
  FormEvent,
  Fragment,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { ConfirmationDialog, Toast, ToastViewport } from "./feedback";
import { Logo, ProductBrand, logoUrl } from "./logo";
import { compactBlockDuration, taskBlockType, taskBlockTypeLabels, TaskBlockType } from "./task-block-display";
import { TimelineTaskCreate, TimelineCreateRange } from "./timeline-task-create";
import { setAppLogoMode, setAppWindowTitle } from "./tauri";
import { openUrl } from "@tauri-apps/plugin-opener";
import navTodayIcon from "./assets/nav-today.svg";
import navTasksIcon from "./assets/nav-tasks.svg";
import navSettingsIcon from "./assets/nav-settings.svg";
import taskCreateIcon from "./assets/task-create.svg";
import recurringIcon from "./assets/recurring.svg";
import {
  AvailabilitySettings,
  applyUndo,
  CalendarEvent,
  completeTask,
  confirmCreationDraft,
  importLegacyRecurringDraft,
  confirmRuleBasedPlan,
  createManualTaskDraft,
  DaySchedule,
  discardRulePlanDraft,
  discardTaskDraft,
  getAvailabilitySettings,
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
  ReviewOutcome,
  saveAvailabilitySettings,
  sendTestNotification,
  setAutostartEnabled,
  setGlobalShortcut,
  saveExecutionCapture,
  clearExecutionCapture,
  resolveTaskExecution,
  saveTaskDraft,
  softDeleteManualTask,
  softDeleteRecurringItem,
  includePlanTask,
  removePlanBlock,
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
  updateRecurringItem,
  setUiSetting
} from "./tauri";
import { availabilityWorkdayOn, calendarDayInfo, lunarDayLabel, lunarDateLabel, solarTermProgressLabel, officialHolidayCoverageFor, OFFICIAL_HOLIDAY_COVERAGE } from "./calendar-data";
import { recurringItemAppearsOnDate, recurringRuleOccursOn, taskAppearsOnDate } from "./calendar-task-placement";
import { timelineDurationHeight, timelineLaneLayout as calculateTimelineLanes, TimelineLane } from "./timeline-lane-layout";
import {
  closestTimeRangeEdge,
  continuousTimeRangeGeometry,
  continuousTimeScaleMarks,
  constrainTimeRange,
  focusedTimeRangePresentation,
  focusedTimeRangeWindow,
  normalizeClockInput,
  sanitizeTimeInput,
  selectDateBoundary,
  selectTaskDateBoundary,
  taskDateRangeIncludesHistory,
  shiftTimeRangeFromStart,
  timeRangePresentationCanReuse,
  timeRangePresentationContains,
  TimeRangeEdge
} from "./time-range-control";
import { recycleCleanupMessage, recycleRetentionMessage } from "./recycle-retention";
import {
  formatWorkloadMinutes,
  inferredDailyWorkloadMinutes,
  isCrossDayTask,
  MAX_TASK_WORKLOAD_MINUTES,
  MIN_TASK_WORKLOAD_MINUTES,
  normalizeTaskWorkloadAfterScheduleChange,
  preferredDailyAllocationMinutes,
  taskDateSpanDays,
  taskRangeDurationMinutes,
  taskRangeIsValid,
  taskScheduleIsComplete,
  taskWorkloadIsValid
} from "./task-workload";
import { syncFormCommonFields } from "./create-type-switch";
import { joinTaskNotes, splitTaskNotes, taskResourceUrl } from "./task-notes";
import { canCaptureTaskResult, normalizeTodayNavigation } from "./review-workflow";
import { executionResultForOutcome, taskExecutionResolution, timelineTaskCompletionAction, timelineTaskDialogState, taskResultEditable, resultWindowOpen, resultToday, taskNextActionLabels, ExecutionResult, ExecutionOutcome, visibleTaskScheduleBlocks, taskListStatus, TaskListStatus } from "./task-result";
import { historicalTaskCreationError, isHistoricalResultDate, historicalBlockCompletionLocked, historicalTaskCompletionLocked, HISTORY_COMPLETION_LOCKED_MESSAGE, HISTORICAL_TASK_CREATION_NOTE } from "./task-result";
import { independentTaskDraft } from "./task-followup";
import { TaskTagEditor, TaskTagList } from "./task-tag-editor";
import { matchesTag, matchesTaggedSearch, uniqueTags } from "./task-tags";
import { GanttPage } from "./gantt-page";
import navGanttIcon from "./assets/nav-gantt.svg";

type IconName =
  | "today" | "tasks" | "calendar" | "review" | "settings"
  | "plus" | "sparkle" | "more" | "check" | "send" | "search"
  | "trash" | "restore" | "close" | "clock" | "filter" | "user" | "info" | "chevron-left" | "chevron-right" | "chevron-down"
  | "pause" | "sliders" | "checkbox" | "file" | "external-link" | "deadline";

const navigation: { label: string; icon: IconName; asset: string; description: string }[] = [
  { label: "今日", icon: "today", asset: navTodayIcon, description: "月历与日计划" },
  { label: "任务", icon: "tasks", asset: navTasksIcon, description: "草稿与任务管理" },
  { label: "甘特图", icon: "calendar", asset: navGanttIcon, description: "跨天任务与时间分布" },
  { label: "设置", icon: "settings", asset: navSettingsIcon, description: "工作方式与连接" }
];

const slots = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00"];
type TaskView = "draft" | "recurring" | TaskListStatus;
type CreateItemType = "task" | "recurring";
type LedgerResizeSession = { pointerId: number; startX: number; startWidth: number };
type TimelineReturnContext = { date: string; blockId?: string; taskId?: string };
type TaskSeed = Pick<Task, "title" | "priority" | "tags">;
type NavigationIntent = { active: string; date?: string; taskView?: TaskView; createTask?: boolean; taskId?: string; taskSeed?: TaskSeed; timelineReturnContext?: TimelineReturnContext };
type PlanLeaveIntent = { kind: "navigation"; intent: NavigationIntent } | { kind: "date"; date: string };
type TaskViewRequest = { view?: TaskView; createTask?: boolean; taskId?: string; taskSeed?: TaskSeed };
type PendingTaskChange =
  | { kind: "select"; taskId: string; edit?: boolean }
  | { kind: "new-independent"; seed: TaskSeed }
  | { kind: "view"; view: TaskView }
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
  dateMode: "single" | "range";
  earliest_start_date: string;
  earliest_start_time: string;
  due_date: string;
  due_time: string;
};

const TASK_LEDGER_WIDTH_SETTING = "ui.task_ledger_list_width";
const TASK_QUEUE_VIEW_SETTING = "ui.task_queue_view";
const TASK_LEDGER_LIST_MIN_WIDTH = 260;
const TASK_LEDGER_INSPECTOR_MIN_WIDTH = 380;
const TASK_LEDGER_HANDLE_WIDTH = 10;
const TASK_LEDGER_LIST_DEFAULT_WIDTH = 320;
const SHELL_SIDEBAR_COLLAPSED_SETTING = "ui.shell_sidebar_collapsed";
const MIN_TASK_BLOCK_MINUTES = 15;
const COMPACT_TASK_BLOCK_THRESHOLD_MINUTES = 30;

const statusCopy: Record<TaskListStatus, string> = {
  open: "待处理", scheduled: "已安排", not_completed: "未完成", done: "已完成", deleted: "回收站"
};
const priorityCopy = { low: "低优先级", medium: "中优先级", high: "高优先级" } as const;
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
    filter: <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />,
    user: <><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    "chevron-left": <path d="m15 18-6-6 6-6" />,
    "chevron-right": <path d="m9 18 6-6-6-6" />,
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    "external-link": <><path d="M14 3h7v7M21 3l-9 9" /><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></>,
    pause: <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>,
    sliders: <><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></>
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function CalendarOverviewButton({ onClick }: { onClick: () => void }) {
  const tooltipId = "calendar-overview-tooltip";
  return <span className="calendar-overview-control">
    <button
      type="button"
      className="calendar-overview-button"
      aria-label="返回月历"
      aria-describedby={tooltipId}
      aria-keyshortcuts="Escape"
      onClick={onClick}
    ><Icon name="calendar" size={17} /></button>
    <span id={tooltipId} className="plan-action-tooltip calendar-overview-tooltip" role="tooltip"><strong>返回月历</strong><small>收起日计划，查看本月日期总览。</small></span>
  </span>;
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
    priority: "medium",
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

function recurringItemDefaultForm(today = shanghaiDateValue()): RecurringItemForm {
  return {
    title: "",
    notes: "",
    frequency: "weekly",
    interval_value: 1,
    weekdays: [weekdayNumber(today)],
    month_day: Number(today.slice(8, 10)),
    starts_on: today,
    ends_on: "",
    display_time: "",
    display_duration_minutes: null,
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

function recurringFormForDraft(draft: TaskDraft, today: string): RecurringItemForm {
  const settings = draft.recurring_settings;
  return {
    ...recurringItemDefaultForm(today), ...settings,
    title: draft.title, notes: draft.notes ?? "", tags: draft.tags,
    ends_on: settings?.ends_on ?? "", display_time: settings?.display_time ?? ""
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

function dayBounds(date: string) {
  const next = new Date(`${date}T00:00:00+08:00`);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    start: `${date}T00:00:00+08:00`,
    end: `${shanghaiDateValue(next)}T00:00:00+08:00`
  };
}

function allDayDraftBounds(date: string) {
  const bounds = dayBounds(date);
  return { starts_at: bounds.start.slice(0, 16), ends_at: bounds.end.slice(0, 16) };
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

function durationLabel(startsAt: string, endsAt: string) {
  return `${timeRangeDurationMinutes(startsAt, endsAt)} 分钟`;
}

function shortTaskBlockClass(startsAt: string, endsAt: string) {
  const durationMs = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  return durationMs < COMPACT_TASK_BLOCK_THRESHOLD_MINUTES * 60000 ? " is-short" : "";
}

function TimelineTaskFacts({ priority, type, inline = false }: { priority?: Task["priority"]; type: TaskBlockType | null; inline?: boolean }) {
  if (!type) return null;
  return <span className={`timeline-task-facts${inline ? " inline-facts" : ""}`}>
    {type !== "recurring" && <span className={`timeline-fact-priority priority-${priority ?? "unset"}`}><span className="timeline-fact-full">{priority ? priorityCopy[priority] : "未设优先级"}</span><span className="timeline-fact-short">{priority ? { high: "高", medium: "中", low: "低" }[priority] : "未设"}</span></span>}
    <span className={`timeline-fact-type type-${type}`}><span className="timeline-fact-full">{taskBlockTypeLabels[type].full}</span><span className="timeline-fact-short">{taskBlockTypeLabels[type].short}</span></span>
  </span>;
}

function TimelineTaskContent({ title, range, duration, priority, type, url, note }: {
  title: string; range: string; duration: string; priority?: Task["priority"]; type: TaskBlockType | null; url: string; note: string;
}) {
  return <>
    <span className="timeline-task-head"><strong>{title}</strong><TimelineTaskFacts priority={priority} type={type} inline /><time><span className="timeline-block-clock">{range} </span><span className="timeline-block-duration">({duration})</span></time></span>
    <TimelineTaskFacts priority={priority} type={type} />
    {(url || note) && <span className="timeline-task-info">{url && <span className="timeline-task-url">{url}</span>}{url && note && <span className="timeline-task-divider" />}{note && <span className="timeline-task-note">{note}</span>}</span>}
  </>;
}

function taskMatchesView(task: Task, view: TaskView) {
  return view !== "draft" && view !== "recurring" && taskListStatus(task) === view;
}

function taskIsEditable(task: Task | null) {
  return Boolean(task && !task.execution_locked && ["open", "scheduled"].includes(task.status));
}

const taskViewCopy: Record<TaskView, string> = {
  draft: "草稿",
  recurring: "重复事项",
  open: "待处理",
  scheduled: "已安排",
  not_completed: "未完成",
  done: "已完成",
  deleted: "回收站"
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
  onChange: (result: ExecutionResult, outcome: ExecutionOutcome) => void;
  onCompleteTask?: () => void;
  completeTaskDisabled?: boolean;
  wholeTask?: boolean;
}) {
  return <div className="execution-choice-stack compact"><div className="floating-outcomes" role="group" aria-label={label} style={onCompleteTask ? { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" } : undefined}>
    {executionResultOptions.map(([value, text]) => <button key={value} type="button" data-outcome={value} aria-pressed={!wholeTask && result === value} disabled={disabled} onClick={() => onChange(value, value === "completed" ? "completed" : "not_started")}>{!wholeTask && result === value && <Icon name="check" size={14} />}{onCompleteTask && value === "completed" ? "当天完成" : text}</button>)}
    {onCompleteTask && <button type="button" data-action="complete-task" aria-pressed={wholeTask} disabled={disabled || completeTaskDisabled} onClick={onCompleteTask}>{wholeTask && <Icon name="check" size={14} />}整体完成</button>}
  </div></div>;
}

const taskViewIcon: Record<TaskView, IconName> = {
  draft: "file",
  recurring: "restore",
  open: "checkbox",
  scheduled: "calendar",
  not_completed: "clock",
  done: "check",
  deleted: "trash"
};

const taskViewGroups: { label: string; items: TaskView[] }[] = [
  { label: "常用", items: ["open", "scheduled"] },
  { label: "工作流", items: ["recurring", "draft"] },
  { label: "历史与维护", items: ["not_completed", "done", "deleted"] }
];

const taskEmptyCopy: Record<TaskView, string> = {
  draft: "暂无待确认草稿",
  recurring: "暂无重复事项",
  open: "暂无待处理任务",
  scheduled: "暂无已安排任务",
  not_completed: "暂无未完成任务",
  done: "暂无已完成任务",
  deleted: "回收站为空"
};

function taskTimingFact(task: Task, today: string) {
  const value = task.due_at ?? task.earliest_start_at;
  if (!value) return null;
  const date = value.slice(0, 10);
  const time = value.slice(11, 16);
  const dateLabel = date === today
    ? "今天"
    : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).format(new Date(`${date}T00:00:00+08:00`));
  return `${task.due_at ? "截止" : "最早"} ${dateLabel}${time ? ` ${time}` : ""}`;
}

function draftForTask(task: Task): ManualTaskUpdate {
  return {
    title: task.title,
    notes: task.notes,
    priority: task.priority,
    earliest_start_at: toInputTimestamp(task.earliest_start_at),
    due_at: toInputTimestamp(task.due_at),
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
    estimated_minutes: value.estimated_minutes ?? null
  });
  return JSON.stringify(comparable(draft)) === JSON.stringify(comparable(persisted));
}

function emptyNewTaskForm(): NewTaskForm {
  return {
    title: "",
    notes: "",
    priority: "medium",
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
  const estimatedMinutes = taskRangeDurationMinutes(form) ?? form.estimated_minutes;
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
    earliest_start_date: draft.earliest_start_at?.slice(0, 10) ?? "",
    earliest_start_time: draft.earliest_start_at?.slice(11, 16) ?? "",
    due_date: draft.due_at?.slice(0, 10) ?? "",
    due_time: draft.due_at?.slice(11, 16) ?? "",
    tags: [],
    recurrence: null
  };
}

function manualUpdateForTaskForm(form: NewTaskForm): ManualTaskUpdate {
  return {
    title: form.title,
    notes: form.notes || null,
    priority: form.priority,
    estimated_minutes: taskRangeDurationMinutes(form) ?? form.estimated_minutes,
    earliest_start_at: form.earliest_start_date && form.earliest_start_time
      ? `${form.earliest_start_date}T${form.earliest_start_time}`
      : null,
    due_at: form.due_date && form.due_time
      ? `${form.due_date}T${form.due_time}`
      : null
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

function recurrenceForForm(form: NewTaskForm): RecurrenceInput {
  const startsOn = form.earliest_start_date || form.due_date || shanghaiDateValue();
  const weekday = new Date(`${startsOn}T00:00:00+08:00`).getDay() || 7;
  return {
    frequency: "weekly",
    interval_value: 1,
    weekdays: [weekday],
    month_day: Number(startsOn.slice(8, 10)),
    starts_on: startsOn,
    ends_on: null
  };
}

function WorkloadTimeDigits({ minutes }: { minutes: number | null | undefined }) {
  if (minutes === null || minutes === undefined) return <span className="workload-time-digits"><b className="workload-digit">待计算</b></span>;
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
  const [pickerTimeInputs, setPickerTimeInputs] = useState({ start: "", end: "" });
  const [monthKey, setMonthKey] = useState(form.earliest_start_date.slice(0, 7) || shanghaiDateValue().slice(0, 7));
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const pickerOriginalRef = useRef<Omit<TaskSchedulePicker, "activeField"> | null>(null);
  const cells = useMemo(() => calendarCells(monthKey), [monthKey]);
  const [todayDate, setTodayDate] = useState(shanghaiDateValue);
  const sameDay = Boolean(form.earliest_start_date
    && form.due_date
    && form.earliest_start_date === form.due_date);
  const sameDayMinutes = taskRangeDurationMinutes(form);
  const dayCount = taskDateSpanDays(form);
  const crossDay = isCrossDayTask(form) && dayCount !== null && dayCount > 1;
  const dailyMinutes = crossDay ? inferredDailyWorkloadMinutes(form.estimated_minutes, form) : null;
  const maximumDailyMinutes = dayCount ? Math.min(24 * 60, Math.floor(MAX_TASK_WORKLOAD_MINUTES / dayCount)) : 24 * 60;
  const dailyWorkloadInvalid = dailyMinutes !== null
    && (dailyMinutes < MIN_TASK_WORKLOAD_MINUTES || dailyMinutes > maximumDailyMinutes);

  const handleScheduleChange = onScheduleChange ?? onChange;

  function updateDailyWorkload(rawValue: string) {
    if (!rawValue) {
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
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.key !== "Escape" || event.defaultPrevented || target?.closest(".schedule-boundary-time-control")) return;
      event.preventDefault();
      closeSchedulePicker();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [openPicker !== null]);

  function closeSchedulePicker() {
    const trigger = triggerRef.current;
    setOpenPicker(null);
    window.requestAnimationFrame(() => trigger?.focus());
  }

  function openSchedulePicker(field: TaskSchedulePicker["activeField"]) {
    setTodayDate(shanghaiDateValue());
    const defaults = newTaskDefaultForm();
    const startDate = form.earliest_start_date || form.due_date || defaults.earliest_start_date;
    const endDate = form.due_date || startDate;
    const nextPicker: TaskSchedulePicker = {
      activeField: field,
      dateMode: startDate === endDate ? "single" : "range",
      earliest_start_date: startDate,
      earliest_start_time: form.earliest_start_time || defaults.earliest_start_time,
      due_date: endDate,
      due_time: form.due_time || defaults.due_time
    };
    const activeDate = nextPicker.activeField === "start" ? nextPicker.earliest_start_date : nextPicker.due_date;
    triggerRef.current = document.activeElement as HTMLElement | null;
    setMonthKey(activeDate.slice(0, 7));
    setPickerTimeInputs({ start: nextPicker.earliest_start_time, end: nextPicker.due_time });
    pickerOriginalRef.current = {
      dateMode: nextPicker.dateMode,
      earliest_start_date: nextPicker.earliest_start_date,
      earliest_start_time: nextPicker.earliest_start_time,
      due_date: nextPicker.due_date,
      due_time: nextPicker.due_time,
    };
    setOpenPicker(nextPicker);
  }

  function selectPickerField(field: TaskSchedulePicker["activeField"], revealDate = false) {
    if (!openPicker) return;
    const activeDate = field === "start" ? openPicker.earliest_start_date : openPicker.due_date;
    if (revealDate || (openPicker.dateMode === "range" && field !== openPicker.activeField)) setMonthKey(activeDate.slice(0, 7));
    setOpenPicker((current) => current ? { ...current, activeField: field } : current);
  }

  function updatePickerDate(date: string) {
    const today = shanghaiDateValue();
    setTodayDate(today);
    if (!openPicker || !selectTaskDateBoundary(openPicker.earliest_start_date, openPicker.due_date, openPicker.activeField, date, today, openPicker.dateMode)) return;
    setOpenPicker((current) => {
      if (!current) return current;
      const next = selectTaskDateBoundary(current.earliest_start_date, current.due_date, current.activeField, date, shanghaiDateValue(), current.dateMode);
      if (!next) return current;
      return {
        ...current,
        earliest_start_date: next.start,
        due_date: next.end,
        activeField: next.activeField
      };
    });
    if (date.slice(0, 7) !== monthKey) setMonthKey(date.slice(0, 7));
  }

  function selectPickerDateMode(dateMode: TaskSchedulePicker["dateMode"]) {
    if (!openPicker || dateMode === openPicker.dateMode) return;
    const today = shanghaiDateValue();
    setTodayDate(today);
    if (dateMode === "range" && openPicker.earliest_start_date < today) return;
    const date = openPicker.earliest_start_date < today ? today : openPicker.earliest_start_date;
    setOpenPicker((current) => current ? {
      ...current, dateMode, activeField: "start",
      earliest_start_date: date, due_date: dateMode === "single" ? date : current.due_date
    } : current);
    setMonthKey(date.slice(0, 7));
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

  function projectPickerForm(picker: TaskSchedulePicker) {
    return {
      ...form,
      earliest_start_date: picker.earliest_start_date,
      earliest_start_time: picker.earliest_start_time,
      due_date: picker.due_date,
      due_time: picker.due_time
    };
  }

  function confirmSchedulePicker() {
    if (!openPicker) return;
    setTodayDate(shanghaiDateValue());
    const startTime = normalizeClockInput(pickerTimeInputs.start);
    const endTime = normalizeClockInput(pickerTimeInputs.end);
    if (!validDraftClock(startTime) || !validDraftClock(endTime)) return;
    const projected = { ...projectPickerForm(openPicker), earliest_start_time: startTime, due_time: endTime };
    if (!pickerHistoryRangeAllowed(projected)) return;
    if (!taskRangeIsValid(projected)) return;
    handleScheduleChange(projected);
    closeSchedulePicker();
  }

  function clearSchedulePicker() {
    handleScheduleChange({
      ...form,
      earliest_start_date: "",
      earliest_start_time: "",
      due_date: "",
      due_time: ""
    });
    closeSchedulePicker();
  }

  function resetSchedulePicker() {
    const original = pickerOriginalRef.current;
    if (!original || !openPicker) return;
    setOpenPicker({
      ...openPicker,
      dateMode: original.dateMode,
      earliest_start_date: original.earliest_start_date,
      earliest_start_time: original.earliest_start_time,
      due_date: original.due_date,
      due_time: original.due_time,
    });
    setPickerTimeInputs({ start: original.earliest_start_time, end: original.due_time });
    setMonthKey((openPicker.activeField === "start" ? original.earliest_start_date : original.due_date).slice(0, 7));
  }

  const pickerTimeChanged = openPicker && pickerOriginalRef.current
    && (openPicker.dateMode !== pickerOriginalRef.current.dateMode
      || openPicker.earliest_start_date !== pickerOriginalRef.current.earliest_start_date
      || openPicker.earliest_start_time !== pickerOriginalRef.current.earliest_start_time
      || openPicker.due_date !== pickerOriginalRef.current.due_date
      || openPicker.due_time !== pickerOriginalRef.current.due_time);

  const rows: { field: TaskSchedulePicker["activeField"]; label: string; date: string; time: string }[] = [
    { field: "start", label: "开始", date: form.earliest_start_date, time: form.earliest_start_time },
    { field: "end", label: "结束", date: form.due_date, time: form.due_time }
  ];
  function pickerHistoryRangeAllowed(projected: NewTaskForm) {
    const today = shanghaiDateValue();
    const includesHistory = taskDateRangeIncludesHistory(projected.earliest_start_date, projected.due_date, today)
      || (openPicker?.dateMode === "range" && projected.earliest_start_date < today);
    return !includesHistory
      || (allowExistingHistoricalRange && form.earliest_start_date !== form.due_date
        && projected.earliest_start_date === form.earliest_start_date && projected.due_date === form.due_date);
  }
  const projectedForm = openPicker ? projectPickerForm(openPicker) : form;
  const pickerTimeInputsValid = validDraftClock(normalizeClockInput(pickerTimeInputs.start))
    && validDraftClock(normalizeClockInput(pickerTimeInputs.end));
  const pickerError = !pickerTimeInputsValid
    ? "请输入有效时间（00:00–23:59）"
    : !taskRangeIsValid(projectedForm)
      ? `结束时间必须比开始时间至少晚 ${MIN_TASK_WORKLOAD_MINUTES} 分钟`
      : !pickerHistoryRangeAllowed(projectedForm)
        ? "多日任务的开始日期不能早于今天；历史事项请补录为单日任务。"
        : "";
  const pickerRangeValid = pickerError === "";
  const pickerSpanDays = openPicker ? taskDateSpanDays(projectedForm) : null;
  const pickerEndMinuteOffset = pickerSpanDays ? (pickerSpanDays - 1) * 24 * 60 : 0;
  const pickerDurationMinutes = openPicker && pickerSpanDays
    ? pickerEndMinuteOffset + clockMinutes(openPicker.due_time) - clockMinutes(openPicker.earliest_start_time)
    : null;
  const pickerDurationLabel = pickerDurationMinutes !== null && pickerDurationMinutes > 0
    ? formatWorkloadMinutes(pickerDurationMinutes)
    : "待调整";
  const activePickerDate = openPicker
    ? openPicker.activeField === "start" ? openPicker.earliest_start_date : openPicker.due_date
    : "";
  const [calendarYear, calendarMonth] = monthKey.split("-").map(Number);

  function renderBoundaryCard(field: TaskSchedulePicker["activeField"], label: string, date: string) {
    const active = openPicker?.activeField === field;
    const inputValue = pickerTimeInputs[field];
    const inputValid = validDraftClock(normalizeClockInput(inputValue));
    return <section className={`schedule-boundary-card ${field}${active ? " is-active" : ""}`} aria-label={`${label}时间`} onClick={() => selectPickerField(field)}>
      <button type="button" className="schedule-boundary-select" aria-pressed={active} onClick={(e) => { e.stopPropagation(); selectPickerField(field); }}><i className={`time-range-marker ${field}`} aria-hidden="true" />{label}时间</button>
      <div className={`schedule-boundary-fields${openPicker?.dateMode === "single" ? " is-single-day" : ""}`}>
        {openPicker?.dateMode === "range" && <button type="button" className="schedule-boundary-field date" onClick={(e) => { e.stopPropagation(); selectPickerField(field, true); }}><small>日期</small><strong><Icon name="calendar" size={14} />{pickerDateLabel(date)}</strong></button>}
        <label className={`schedule-boundary-field time${inputValid ? "" : " is-invalid"}`} onClick={(e) => e.stopPropagation()}><small>时间</small><span className="schedule-boundary-time-control"><Icon name="clock" size={14} /><input type="text" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={5} value={inputValue} aria-label={`输入${label}时间`} aria-describedby="schedule-picker-time-input-help" aria-invalid={!inputValid} onFocus={(event) => { selectPickerField(field); event.currentTarget.select(); }} onChange={(event) => updatePickerTimeInput(field, event.target.value)} onKeyDown={(event) => handlePickerTimeKeyDown(event, field)} onBlur={(event) => commitPickerTimeInput(field, event.currentTarget.value)} /></span></label>
      </div>
    </section>;
  }

  return <>
  <div className="apple-schedule-editor" role="group" aria-label="任务时间范围">
      <header className={compact ? "apple-schedule-toolbar" : undefined}>
        {compact && <span className="apple-schedule-compact-title">安排与时限</span>}
        <div className="apple-schedule-header-actions">
          {sameDay ? <output className="apple-schedule-workload" aria-live="polite"><i className="apple-schedule-workload-icon" aria-hidden="true"><Icon name="clock" size={15} /></i><span>预估</span><strong>{sameDayMinutes === null ? "待计算" : <WorkloadTimeDigits minutes={sameDayMinutes} />}</strong><small>{sameDayMinutes === null ? "补全有效时间" : "自动计算"}</small></output> : crossDay ? <output className="apple-schedule-workload" aria-live="polite"><i className="apple-schedule-workload-icon" aria-hidden="true"><Icon name="clock" size={15} /></i><span>预估总投入</span><strong><WorkloadTimeDigits minutes={form.estimated_minutes} /></strong><small>{dailyMinutes !== null && form.estimated_minutes !== null ? `共 ${dayCount} 天 · 自动计算` : form.estimated_minutes !== null ? "原总投入已保留" : "填写后自动计算"}</small></output> : !compact ? <div><strong>时间范围</strong><span>开始和结束时间均为必填；未补完整时只保存草稿。</span></div> : null}
          {form.earliest_start_date || form.due_date ? <button type="button" disabled={disabled} onClick={() => { handleScheduleChange({ ...form, earliest_start_date: "", earliest_start_time: "", due_date: "", due_time: "" }); setOpenPicker(null); }}>清除时间</button> : <button type="button" disabled={disabled} onClick={() => { const defaults = newTaskDefaultForm(); handleScheduleChange({ ...form, earliest_start_date: defaults.earliest_start_date, earliest_start_time: defaults.earliest_start_time, due_date: defaults.due_date, due_time: defaults.due_time }); }}>恢复推荐</button>}
        </div>
      </header>
    <div className="apple-schedule-rows">
    {!crossDay && <div className="apple-schedule-row"><span className="apple-schedule-label">日期</span><div className="apple-schedule-values"><button type="button" disabled={disabled} aria-label="选择任务日期" aria-haspopup="dialog" aria-expanded={Boolean(openPicker)} onClick={() => openSchedulePicker("start")}><Icon name="calendar" size={14} />{pickerDateLabel(form.earliest_start_date || form.due_date)}</button></div></div>}
    {rows.map((row) => <div className="apple-schedule-row" key={row.field}>
      <span className="apple-schedule-label">{row.label}</span>
      <div className="apple-schedule-values">{crossDay && <button type="button" className={openPicker?.activeField === row.field ? "is-active" : ""} disabled={disabled} aria-haspopup="dialog" aria-expanded={openPicker?.activeField === row.field} onClick={() => openSchedulePicker(row.field)}><Icon name="calendar" size={14} />{pickerDateLabel(row.date)}</button>}<button type="button" className={openPicker?.activeField === row.field ? "is-active" : ""} disabled={disabled} aria-haspopup="dialog" aria-expanded={openPicker?.activeField === row.field} onClick={() => openSchedulePicker(row.field)}><Icon name="clock" size={14} />{row.time || "选择时间"}</button></div>
    </div>)}
    {crossDay && (
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
              disabled={disabled}
              value={dailyMinutes ?? ""}
              placeholder="例如 60"
              onChange={(event) => updateDailyWorkload(event.target.value)}
            />
            <span className="apple-schedule-workload-unit">分钟 / 天</span>
          </label>
        </div>
      </div>
    )}
    </div>
    {!taskRangeIsValid(form) && <p className="apple-schedule-error" role="alert">结束时间必须比开始时间至少晚 {MIN_TASK_WORKLOAD_MINUTES} 分钟，请重新选择。</p>}
    {crossDay && dailyWorkloadInvalid && <p className="apple-schedule-error workload-field-error" role="alert">平均每天至少投入 {MIN_TASK_WORKLOAD_MINUTES} 分钟。</p>}
  </div>
  {openPicker && createPortal(
    <div className="schedule-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSchedulePicker(); }}>
      <div className="schedule-picker-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="schedule-picker-title" tabIndex={-1}>
        <header className="schedule-picker-header">
          <div><h2 id="schedule-picker-title">时间范围</h2><p>{openPicker.dateMode === "single" ? "先选择任务日期，再调整当天的开始和结束时间。" : `当前操作目标：${openPicker.activeField === "start" ? "开始日期" : "结束日期"}；选完后自动切换到另一端。`}</p></div>
          <div className="schedule-picker-header-actions">{pickerTimeChanged && <button type="button" className="schedule-picker-reset" onClick={resetSchedulePicker}>重置时间</button>}<button type="button" className="schedule-picker-clear" onClick={clearSchedulePicker}>清除时间</button><button type="button" className="schedule-picker-close" aria-label="关闭时间范围" onClick={closeSchedulePicker}><Icon name="close" size={18} /></button></div>
        </header>
        <div className="schedule-picker-date-mode">
          <div className="schedule-picker-switch" role="group" aria-label="日期模式">
            <button type="button" className={`schedule-picker-switch-btn${openPicker.dateMode === "single" ? " is-active" : ""}`} aria-pressed={openPicker.dateMode === "single"} onClick={() => selectPickerDateMode("single")}>单日</button>
            <button type="button" className={`schedule-picker-switch-btn${openPicker.dateMode === "range" ? " is-active" : ""}`} aria-pressed={openPicker.dateMode === "range"} disabled={openPicker.dateMode === "single" && openPicker.earliest_start_date < todayDate} title={openPicker.dateMode === "single" && openPicker.earliest_start_date < todayDate ? "历史日期仅支持单日；请先选择今天或未来日期" : undefined} onClick={() => selectPickerDateMode("range")}>多日</button>
          </div>
          {openPicker.dateMode === "single" ? <button type="button" className="schedule-picker-task-date" onClick={() => selectPickerField(openPicker.activeField, true)}><Icon name="calendar" size={14} />任务日期：<strong>{pickerDateLabel(openPicker.earliest_start_date)}</strong></button> : <span>点击上方日期卡或下方目标切换编辑端点</span>}
        </div>
        <div className="schedule-picker-boundaries">
          {renderBoundaryCard("start", "开始", openPicker.earliest_start_date)}
          <span className="schedule-boundary-arrow" aria-hidden="true"><Icon name="chevron-right" size={18} /></span>
          {renderBoundaryCard("end", "结束", openPicker.due_date)}
          <span id="schedule-picker-time-input-help" className="sr-only">可输入 9、930 或 09:30，精确到 1 分钟。</span>
        </div>
        <div className="schedule-picker-body">
          <section className="schedule-picker-calendar" aria-label="选择日期">
            <header><strong>{calendarYear}年{calendarMonth}月</strong><div><button type="button" aria-label="上个月" onClick={() => setMonthKey(shiftMonthKey(monthKey, -1))}><Icon name="chevron-left" size={17} /></button><button type="button" aria-label="下个月" onClick={() => setMonthKey(shiftMonthKey(monthKey, 1))}><Icon name="chevron-right" size={17} /></button></div></header>
            <div className="apple-date-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="apple-date-grid">{cells.map((cell) => {
              const inRange = cell.key >= openPicker.earliest_start_date && cell.key <= openPicker.due_date;
              const dateDisabled = !selectTaskDateBoundary(openPicker.earliest_start_date, openPicker.due_date, openPicker.activeField, cell.key, todayDate, openPicker.dateMode);
              const classes = [
                cell.inMonth ? "" : "outside",
                cell.key === todayDate ? "today" : "",
                inRange ? "in-range" : "",
                cell.key === openPicker.earliest_start_date ? "range-start" : "",
                cell.key === openPicker.due_date ? "range-end" : "",
                cell.key === activePickerDate ? "selected" : ""
              ].filter(Boolean).join(" ");
              return <button key={cell.key} type="button" className={classes} disabled={dateDisabled} title={dateDisabled ? "多日任务不可选择历史日期；请切换为单日再补录" : undefined} aria-label={`${cell.key}${cell.key === todayDate ? "，今天" : ""}${dateDisabled ? "，不可选：历史日期只支持单日补录" : ""}`} aria-current={cell.key === todayDate ? "date" : undefined} aria-pressed={cell.key === activePickerDate} onClick={() => updatePickerDate(cell.key)}>{cell.day}</button>;
            })}</div>
            <footer>
              {openPicker.dateMode === "single" ? <strong>选择这一天的任务日期</strong> : <div className="schedule-picker-switch" role="group" aria-label="当前操作目标">
                <span className="schedule-picker-switch-label">当前操作：</span>
                <button
                  type="button"
                  aria-pressed={openPicker.activeField === "start"}
                  className={`schedule-picker-switch-btn${openPicker.activeField === "start" ? " is-active" : ""}`}
                  onClick={() => selectPickerField("start")}
                >
                  <i className="time-range-marker start" aria-hidden="true" />开始日期
                </button>
                <button
                  type="button"
                  aria-pressed={openPicker.activeField === "end"}
                  className={`schedule-picker-switch-btn${openPicker.activeField === "end" ? " is-active" : ""}`}
                  onClick={() => selectPickerField("end")}
                >
                  <i className="time-range-marker end" aria-hidden="true" />结束日期
                </button>
              </div>}
              {activePickerDate === todayDate && <em>今天</em>}
            </footer>
            <p className="schedule-picker-date-help" aria-live="polite">{openPicker.dateMode === "single" ? "点击日期即设置整天的任务日期，起止日期同步。历史日期仅支持单日；改为多日请先选择今天或未来日期。" : "点击开始日期后自动切换到结束日期，点击结束日期后自动切回开始日期。多日任务不可选择历史日期。"}</p>
          </section>
          <section className="schedule-picker-range-panel" aria-label="调整时间范围">
            <header><div><strong>调整时间范围</strong><span>{pickerSpanDays && pickerSpanDays > 1 ? `跨 ${pickerSpanDays} 天` : pickerDurationLabel}</span></div><output>{openPicker.earliest_start_time} → {openPicker.due_time}</output></header>
            {pickerSpanDays === null ? <p className="schedule-picker-range-error" role="alert">结束日期不能早于开始日期，请先在左侧调整日期。</p> : <BlockEditorTimeRangeRail
              start={openPicker.earliest_start_time}
              end={openPicker.due_time}
              startMinuteOffset={0}
              endMinuteOffset={pickerEndMinuteOffset}
              maxMinute={pickerEndMinuteOffset + 23 * 60 + 59}
              minimumDuration={MIN_TASK_WORKLOAD_MINUTES}
              disabled={disabled}
              describedBy="schedule-picker-range-help"
              showPresets={pickerSpanDays === 1}
              onChange={updatePickerRange}
            />}
          </section>
        </div>
        <footer className="schedule-picker-footer">
          {pickerError ? <p className="schedule-picker-footer-error" role="alert">{pickerError}</p> : <output className="schedule-picker-summary"><i aria-hidden="true" className="apple-schedule-workload-icon"><Icon name="clock" size={15} /></i><span>已选 <strong>{pickerDateLabel(openPicker.earliest_start_date)} {openPicker.earliest_start_time} — {pickerDateLabel(openPicker.due_date)} {openPicker.due_time}</strong>{pickerDurationMinutes !== null && pickerDurationMinutes > 0 ? <> · 预估 <strong><WorkloadTimeDigits minutes={pickerDurationMinutes} /></strong></> : ""}</span></output>}
          <div><button type="button" className="secondary-action" onClick={closeSchedulePicker}>取消</button><button type="button" className="schedule-picker-confirm" disabled={!pickerRangeValid} onClick={confirmSchedulePicker}>确认时间</button></div>
        </footer>
      </div>
    </div>, document.body)}
  </>;
}

function TaskNotesInputs({ id, value, disabled = false, maxLength, onChange }: {
  id: string;
  value: string;
  disabled?: boolean;
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  const { url, body } = splitTaskNotes(value);
  const urlPrefixLength = url ? 5 + (body ? 2 : 0) : 0;
  return <div className="task-notes-inputs">
    <label htmlFor={`${id}-url`} className="sr-only">URL</label>
    <input id={`${id}-url`} type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={disabled} value={url} maxLength={maxLength === undefined ? undefined : Math.max(0, maxLength - body.length - 7)} placeholder="URL" onChange={(event) => onChange(joinTaskNotes(event.target.value, body))} />
    <span className="task-notes-divider" aria-hidden="true" />
    <label htmlFor={id} className="sr-only">备注</label>
    <textarea id={id} rows={3} disabled={disabled} value={body} maxLength={maxLength === undefined ? undefined : Math.max(0, maxLength - url.length - urlPrefixLength)} placeholder="备注" onChange={(event) => onChange(joinTaskNotes(url, event.target.value))} />
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
  const [priorityOpen, setPriorityOpen] = useState(false);
  const priorityDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!priorityOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (priorityDropdownRef.current && !priorityDropdownRef.current.contains(event.target as Node)) {
        setPriorityOpen(false);
      }
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setPriorityOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [priorityOpen]);

  const priorityOptions: Array<{ value: NonNullable<NewTaskForm["priority"]>; label: string; tone: string }> = [
    { value: "high", label: "高优先级", tone: "high" },
    { value: "medium", label: "中优先级", tone: "medium" },
    { value: "low", label: "低优先级", tone: "low" },
  ];
  const priorityOptionMap: Record<string, { label: string }> = {
    unset: { label: "未设置优先级" },
    high: { label: "高优先级" },
    medium: { label: "中优先级" },
    low: { label: "低优先级" },
  };
  const notesField = <TaskNotesInputs id={notesId} value={form.notes} disabled={disabled} onChange={(notes) => onChange({ ...form, notes })} />;

  return <>
    <section className="task-form-region task-content-region" aria-labelledby={contentTitleId}>
      <header><div className="task-region-title-row"><strong id={contentTitleId}>任务内容</strong><span>先记下要完成的事，细节可随后补充。</span></div></header>
      <div className="task-content-fields">
        <div className="task-title-heading-row">
          <label htmlFor={titleId} className="sr-only">标题</label>
          <input id={titleId} className="task-title-input" autoFocus={autoFocusTitle} disabled={disabled} value={form.title} maxLength={300} required placeholder="标题" onChange={(event) => onChange({ ...form, title: event.target.value })} />
          <div className="task-title-controls">
          <div ref={priorityDropdownRef} className={`priority-select-control priority-tone-${form.priority ?? "unset"}`}>
            <select id={priorityId} value={form.priority ?? ""} onChange={(event) => onChange({ ...form, priority: (event.target.value || null) as NewTaskForm["priority"] })} className="sr-only" tabIndex={-1} aria-hidden="true">
              <option value="">未设置优先级</option>
              <option value="low">低优先级</option><option value="medium">中优先级</option><option value="high">高优先级</option>
            </select>
            <button type="button" className={`priority-dropdown-trigger${priorityOpen ? " is-open" : ""}`} disabled={disabled} aria-haspopup="listbox" aria-expanded={priorityOpen} onMouseDown={(e) => e.stopPropagation()} onClick={() => !disabled && setPriorityOpen(!priorityOpen)}>
              <span className="priority-trigger-content">
                <i className={`priority-dot priority-dot-${form.priority ?? "unset"}`} aria-hidden="true" />
                <span className="priority-trigger-label">{priorityOptionMap[form.priority ?? "unset"].label}</span>
              </span>
              <span className="priority-trigger-aside">
                <span className="priority-trigger-chevron" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    {priorityOpen ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />}
                  </svg>
                </span>
              </span>
            </button>
            {priorityOpen && (
              <div className="priority-dropdown-menu" role="listbox" aria-label="选择任务优先级">
                {priorityOptions.map((opt) => {
                  const isSelected = opt.value === form.priority;
                  return (
                    <button
                      key={opt.tone}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`priority-dropdown-option${isSelected ? " is-selected" : ""}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onChange({ ...form, priority: opt.value });
                        setPriorityOpen(false);
                      }}
                      onClick={() => {
                        onChange({ ...form, priority: opt.value });
                        setPriorityOpen(false);
                      }}
                    >
                      <span className="priority-option-label">
                        <i className={`priority-dot priority-dot-${opt.tone}`} aria-hidden="true" />
                        <span>{opt.label}</span>
                      </span>
                      <span className="priority-option-aside">
                        {isSelected && (
                          <span className="priority-check-icon" aria-hidden="true">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
            <TaskTagEditor id={`${idPrefix}-tags`} tags={form.tags} dropdown suggestions={availableTags} disabled={disabled} onChange={(tags) => onChange({ ...form, tags })} />
          </div>
        </div>
      </div>
    </section>
    <section className="task-form-region task-planning-section" aria-labelledby={attributesTitleId}>
      <header><div className="task-region-title-row"><strong id={attributesTitleId}>安排与时限</strong><span>设置可安排日期和优先级。</span></div></header>
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

function weekdayLabel(dateStr: string): string {
  if (!dateStr) return "";
  const day = new Date(`${dateStr}T00:00:00+08:00`).getDay();
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][day] ?? "";
}

function isoWeekParts(dateKey: string) {
  const thursday = new Date(`${dateKey}T00:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const year = thursday.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  return { year, week: Math.ceil(((thursday.getTime() - yearStart) / 86_400_000 + 1) / 7) };
}

function RecurringValidityPicker({
  startsOn,
  endsOn,
  displayTime = "",
  displayDurationMinutes = null,
  initialField = "start",
  todayDate,
  previewForm,
  onConfirm,
  onClose
}: {
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
  const [activeField, setActiveField] = useState<"start" | "end">(
    initialField === "end" || initialField === "duration" ? "end" : "start"
  );
  const [draftStartsOn, setDraftStartsOn] = useState(startsOn || todayDate);
  const [draftEndsOn, setDraftEndsOn] = useState(endsOn || "");
  const [draftDisplayTime, setDraftDisplayTime] = useState(displayTime || "");
  const [displayTimeInput, setDisplayTimeInput] = useState(displayTime || "");
  const [draftDurationMinutes, setDraftDurationMinutes] = useState<number | null>(displayDurationMinutes ?? null);
  const isDisplayTimeFocusedRef = useRef(false);
  const initialDisplayTimeRef = useRef(displayTime || "");
  const timeInputRef = useRef<HTMLInputElement>(null);
  const durationInputRef = useRef<HTMLInputElement>(null);
  const [monthKey, setMonthKey] = useState(() => {
    const targetDate = (initialField === "end" || initialField === "duration") && endsOn ? endsOn : (startsOn || todayDate);
    return targetDate.slice(0, 7) || todayDate.slice(0, 7);
  });
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      if (initialField === "time") {
        timeInputRef.current?.focus();
        timeInputRef.current?.select();
      } else if (initialField === "duration") {
        durationInputRef.current?.focus();
        durationInputRef.current?.select();
      } else {
        dialogRef.current?.focus();
      }
    });
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "Escape" || event.defaultPrevented || target?.closest(".schedule-boundary-time-control") || target?.closest(".schedule-boundary-duration-control")) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [initialField, onClose]);

  const cells = useMemo(() => calendarCells(monthKey), [monthKey]);
  const [calendarYear, calendarMonth] = monthKey.split("-").map(Number);
  const hasEnd = Boolean(draftEndsOn);
  const daySpan = hasEnd && draftEndsOn >= draftStartsOn
    ? taskDateSpanDays({ earliest_start_date: draftStartsOn, due_date: draftEndsOn })
    : null;
  const currentYear = Number((draftStartsOn || todayDate).slice(0, 4)) || new Date().getFullYear();
  const currentYearEnd = `${currentYear}-12-31`;
  const isYearEndActive = Boolean(hasEnd && draftEndsOn === currentYearEnd);
  const activePresetDays = hasEnd && !isYearEndActive
    ? Math.round((new Date(`${draftEndsOn}T00:00:00+08:00`).getTime() - new Date(`${draftStartsOn}T00:00:00+08:00`).getTime()) / 86400000)
    : null;
  const displayTimeValid = !displayTimeInput || validDraftClock(normalizeClockInput(displayTimeInput));
  const validityRangeValid = draftStartsOn !== "" && (!hasEnd || draftEndsOn >= draftStartsOn) && displayTimeValid;
  const previewDates = recurringItemPreviewDates({
    ...previewForm,
    starts_on: draftStartsOn,
    ends_on: draftEndsOn
  });

  function updateDisplayTimeInput(value: string) {
    const sanitized = sanitizeTimeInput(value);
    setDisplayTimeInput(sanitized);
    if (!sanitized.trim()) {
      if (draftDisplayTime) {
        setDraftDisplayTime("");
      }
      return;
    }
    const normalized = normalizeClockInput(sanitized);
    if (validDraftClock(normalized)) {
      setDraftDisplayTime(normalized);
    } else {
      setDraftDisplayTime(sanitized);
    }
  }

  function commitDisplayTimeInput(value: string) {
    const sanitized = sanitizeTimeInput(value);
    if (!sanitized.trim()) {
      setDisplayTimeInput("");
      if (draftDisplayTime) {
        setDraftDisplayTime("");
      }
      return;
    }
    const normalized = normalizeClockInput(sanitized);
    if (validDraftClock(normalized)) {
      setDisplayTimeInput(normalized);
      setDraftDisplayTime(normalized);
    } else {
      setDisplayTimeInput(sanitized);
      setDraftDisplayTime(sanitized);
    }
  }

  function handleDisplayTimeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitDisplayTimeInput(event.currentTarget.value);
      event.currentTarget.select();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      const fallback = initialDisplayTimeRef.current || "";
      setDisplayTimeInput(fallback);
      setDraftDisplayTime(fallback);
      event.currentTarget.blur();
      return;
    }
  }

  function handleDateClick(dateKey: string) {
    const next = selectDateBoundary(draftStartsOn, draftEndsOn, activeField, dateKey);
    setDraftStartsOn(next.start);
    setDraftEndsOn(next.end);
    setActiveField(next.activeField);
  }

  function applyValidityPreset(action: "open" | "days" | "year_end", days = 0) {
    setActiveField("end");
    if (action === "open") {
      setDraftEndsOn("");
      return;
    }
    if (action === "year_end") {
      const year = Number(draftStartsOn.slice(0, 4)) || new Date().getFullYear();
      const target = `${year}-12-31`;
      setDraftEndsOn(target);
      setMonthKey(target.slice(0, 7));
      return;
    }
    const target = shiftDateValue(draftStartsOn, days);
    setDraftEndsOn(target);
    setMonthKey(target.slice(0, 7));
  }

  function selectField(field: "start" | "end") {
    setActiveField(field);
    const targetDate = field === "start" ? draftStartsOn : (draftEndsOn || draftStartsOn);
    if (targetDate) setMonthKey(targetDate.slice(0, 7));
  }

  return createPortal(
    <div className="schedule-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="schedule-picker-dialog recurring-validity-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="recurring-validity-title" tabIndex={-1}>
        {/* BEGIN: ModalHeader */}
        <header className="recurring-modal-header">
          <div className="recurring-header-copy">
            <div className="recurring-header-title-row">
              <h2 id="recurring-validity-title">有效日期范围</h2>
              <span className="recurring-cycle-badge">周期循环</span>
            </div>
            <p className="recurring-header-subtitle">
              设置重复事项生效的开始与截止日期、展示时间与时长；留空时将默认长期有效。
            </p>
          </div>
          <div className="recurring-header-actions">
            {(draftDisplayTime || draftDurationMinutes !== null) && (
              <button
                type="button"
                className="recurring-clear-time-btn"
                onClick={() => {
                  setDisplayTimeInput("");
                  setDraftDisplayTime("");
                  setDraftDurationMinutes(null);
                }}
              >
                清除时间设置
              </button>
            )}
            <button type="button" className="schedule-picker-close recurring-close-btn" aria-label="关闭窗口" onClick={onClose}>
              <Icon name="close" size={18} />
            </button>
          </div>
        </header>

        {/* BEGIN: ModalBody */}
        <main className="recurring-modal-body">
          {/* Symmetrical Two-Rows Form */}
          <section className="recurring-symmetrical-panel" aria-label="排期参数与展示设定">
            <div className="recurring-symmetrical-grid">
              {/* Row 1: Dates */}
              <div className="recurring-form-row">
                {/* Start Date Card */}
                <div
                  className={`recurring-status-card${activeField === "start" ? " is-active" : ""}`}
                  onClick={() => selectField("start")}
                >
                  <div className="recurring-card-header">
                    <div className="recurring-card-title-wrap">
                      <span className="recurring-dot-indicator start">
                        {activeField === "start" && <span className="animate-pulse-dot" />}
                        <span className="recurring-dot" />
                      </span>
                      <label className="recurring-card-label">开始日期</label>
                    </div>
                  </div>
                  <div className="recurring-card-input-box">
                    <Icon name="calendar" size={15} />
                    <input
                      type="text"
                      readOnly
                      value={pickerDateLabel(draftStartsOn)}
                      className="recurring-card-date-input"
                    />
                  </div>
                </div>

                {/* Connector -> */}
                <div className="recurring-connector-wrap" aria-hidden="true">
                  <div className="recurring-connector-badge arrow">
                    <Icon name="chevron-right" size={14} />
                  </div>
                </div>

                {/* End Date Card */}
                <div
                  className={`recurring-status-card${activeField === "end" ? " is-active" : ""}`}
                  onClick={() => selectField("end")}
                >
                  <div className="recurring-card-header">
                    <div className="recurring-card-title-wrap">
                      <span className="recurring-dot-indicator end">
                        <span className="recurring-dot" />
                      </span>
                      <label className="recurring-card-label">截止日期</label>
                    </div>
                    <span className="recurring-card-sublabel">自动终止</span>
                  </div>
                  <div className="recurring-card-input-box">
                    <Icon name="calendar" size={15} />
                    <input
                      type="text"
                      readOnly
                      value={draftEndsOn ? pickerDateLabel(draftEndsOn) : "长期有效（无截止日）"}
                      className="recurring-card-date-input"
                    />
                  </div>
                </div>
              </div>

              {/* Row 2: Time & Duration */}
              <div className="recurring-form-row">
                {/* Display Time Card */}
                <div
                  className={`recurring-status-card recurring-display-time-control${!displayTimeValid ? " is-invalid" : ""}`}
                  onClick={() => timeInputRef.current?.focus()}
                >
                  <div className="recurring-card-header">
                    <label className="recurring-card-label">
                      展示时间 <span className="recurring-card-optional">(可选)</span>
                    </label>
                    <span className="recurring-card-sublabel">每日生效时刻</span>
                  </div>
                  <div className="recurring-card-input-box schedule-boundary-time-control">
                    <Icon name="clock" size={15} />
                    <input
                      ref={timeInputRef}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={5}
                      placeholder="09:00"
                      value={displayTimeInput}
                      aria-label="输入展示时间"
                      aria-invalid={!displayTimeValid}
                      onFocus={(e) => {
                        isDisplayTimeFocusedRef.current = true;
                        initialDisplayTimeRef.current = draftDisplayTime || "";
                        e.currentTarget.select();
                      }}
                      onChange={(e) => updateDisplayTimeInput(e.target.value)}
                      onKeyDown={handleDisplayTimeKeyDown}
                      onBlur={(e) => {
                        isDisplayTimeFocusedRef.current = false;
                        commitDisplayTimeInput(e.currentTarget.value);
                      }}
                    />
                  </div>
                </div>

                {/* Connector "与" */}
                <div className="recurring-connector-wrap" aria-hidden="true">
                  <div className="recurring-connector-badge text">
                    <span>与</span>
                  </div>
                </div>

                {/* Duration Card */}
                <div
                  className="recurring-status-card schedule-boundary-duration-control"
                  onClick={() => durationInputRef.current?.focus()}
                >
                  <div className="recurring-card-header">
                    <label className="recurring-card-label">时间块时长</label>
                  </div>
                  <div className="recurring-card-input-box duration-box">
                    <input
                      ref={durationInputRef}
                      type="number"
                      min={5}
                      max={1440}
                      step={5}
                      value={draftDurationMinutes ?? ""}
                      placeholder="90"
                      aria-label="输入时间块时长"
                      onChange={(e) => setDraftDurationMinutes(e.target.value ? Number(e.target.value) : null)}
                    />
                    <span className="recurring-unit-suffix">分钟</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Interactive Workarea (Calendar 5 cols + Shortcuts 7 cols) */}
          <section className="recurring-workarea-grid">
            {/* Left: Calendar */}
            <div className="recurring-calendar-container" aria-label="日历选择">
              <div className="recurring-calendar-header">
                <h3>{calendarYear}年{calendarMonth}月</h3>
                <div className="recurring-calendar-nav">
                  <button type="button" aria-label="上个月" onClick={() => setMonthKey(shiftMonthKey(monthKey, -1))}>
                    <Icon name="chevron-left" size={16} />
                  </button>
                  <button type="button" aria-label="下个月" onClick={() => setMonthKey(shiftMonthKey(monthKey, 1))}>
                    <Icon name="chevron-right" size={16} />
                  </button>
                </div>
              </div>
              <div className="recurring-calendar-weekdays" aria-hidden="true">
                {["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}
              </div>
              <div className="recurring-calendar-grid">
                {cells.map((cell, index) => {
                  const inRange = hasEnd && cell.key >= draftStartsOn && cell.key <= draftEndsOn;
                  const isStart = cell.key === draftStartsOn;
                  const isEnd = hasEnd && cell.key === draftEndsOn;
                  const isToday = cell.key === todayDate;
                  const isSelected = (activeField === "start" && isStart) || (activeField === "end" && (isEnd || (!hasEnd && isStart)));
                  const isRowStart = index % 7 === 0;
                  const isRowEnd = index % 7 === 6;

                  const isStartWithRange = isStart && inRange && !isEnd;
                  const isEndWithRange = isEnd && inRange && !isStart;
                  const isSingleSelected = (isStart && isEnd) || (isStart && !hasEnd);

                  if (isStartWithRange) {
                    return (
                      <div
                        key={cell.key}
                        className={`recurring-calendar-cell is-start${isSelected ? " selected" : ""}`}
                        onClick={() => handleDateClick(cell.key)}
                      >
                        {!isRowEnd && <div className="recurring-calendar-half-bar right" aria-hidden="true" />}
                        <button type="button" className="recurring-calendar-btn circle" aria-pressed={isSelected}>
                          {cell.day}
                        </button>
                        {isToday && <span className="recurring-today-dot on-circle" aria-hidden="true" />}
                      </div>
                    );
                  }

                  if (isEndWithRange) {
                    return (
                      <div
                        key={cell.key}
                        className={`recurring-calendar-cell is-end${isSelected ? " selected" : ""}`}
                        onClick={() => handleDateClick(cell.key)}
                      >
                        {!isRowStart && <div className="recurring-calendar-half-bar left" aria-hidden="true" />}
                        <button type="button" className="recurring-calendar-btn circle" aria-pressed={isSelected}>
                          {cell.day}
                        </button>
                        {isToday && <span className="recurring-today-dot on-circle" aria-hidden="true" />}
                      </div>
                    );
                  }

                  if (isSingleSelected) {
                    return (
                      <div
                        key={cell.key}
                        className={`recurring-calendar-cell is-single-selected${isSelected ? " selected" : ""}`}
                        onClick={() => handleDateClick(cell.key)}
                      >
                        <button type="button" className="recurring-calendar-btn circle" aria-pressed={isSelected}>
                          {cell.day}
                        </button>
                        {isToday && <span className="recurring-today-dot on-circle" aria-hidden="true" />}
                      </div>
                    );
                  }

                  if (inRange) {
                    return (
                      <div
                        key={cell.key}
                        className={`recurring-calendar-cell in-range-middle${isRowStart ? " row-start" : ""}${isRowEnd ? " row-end" : ""}${!cell.inMonth ? " outside" : ""}`}
                        onClick={() => handleDateClick(cell.key)}
                      >
                        <span className="recurring-range-day-num">{cell.day}</span>
                        {isToday && <span className="recurring-today-dot" aria-hidden="true" />}
                      </div>
                    );
                  }

                  // Non-range cell
                  return (
                    <div
                      key={cell.key}
                      className={`recurring-calendar-cell normal${cell.inMonth ? "" : " outside"}`}
                      onClick={() => handleDateClick(cell.key)}
                    >
                      {cell.inMonth ? (
                        <button type="button" className="recurring-calendar-btn normal">
                          {cell.day}
                        </button>
                      ) : (
                        <span className="recurring-outside-day">{cell.day}</span>
                      )}
                      {isToday && <span className="recurring-today-dot" aria-hidden="true" />}
                    </div>
                  );
                })}
              </div>
              <div className="recurring-calendar-footer">
                <span className="recurring-target-label">当前操作目标：</span>
                <div className="recurring-target-tabs" role="tablist" aria-label="切换编辑起止日期">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeField === "start"}
                    className={`recurring-target-tab${activeField === "start" ? " is-active" : ""}`}
                    onClick={() => selectField("start")}
                  >
                    <span className="recurring-tab-dot start" />
                    开始日期
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeField === "end"}
                    className={`recurring-target-tab${activeField === "end" ? " is-active" : ""}`}
                    onClick={() => selectField("end")}
                  >
                    <span className="recurring-tab-dot end" />
                    截止日期
                  </button>
                </div>
              </div>
            </div>

            {/* Right: Shortcuts & Presets Panel */}
            <div className="recurring-shortcuts-panel">
              {/* Section 1: 有效期限快捷选项 */}
              <div className="recurring-panel-section">
                <div className="recurring-section-header">
                  <h4>有效期限快捷选项</h4>
                  <span className="recurring-section-sub">快速设置常用周期</span>
                </div>
                <div className="recurring-presets-chips recurring-chips-grid cols-6">
                  <button
                    type="button"
                    className={`preset-chip recurring-preset-chip${!draftEndsOn ? " is-active" : ""}`}
                    onClick={() => applyValidityPreset("open")}
                  >
                    长期有效
                  </button>
                  <button type="button" className={`preset-chip recurring-preset-chip${activePresetDays === 30 ? " is-active" : ""}`} onClick={() => applyValidityPreset("days", 30)}>1 个月</button>
                  <button type="button" className={`preset-chip recurring-preset-chip${activePresetDays === 90 ? " is-active" : ""}`} onClick={() => applyValidityPreset("days", 90)}>3 个月</button>
                  <button type="button" className={`preset-chip recurring-preset-chip${activePresetDays === 180 ? " is-active" : ""}`} onClick={() => applyValidityPreset("days", 180)}>半年</button>
                  <button type="button" className={`preset-chip recurring-preset-chip${activePresetDays === 365 ? " is-active" : ""}`} onClick={() => applyValidityPreset("days", 365)}>1 年</button>
                  <button type="button" className={`preset-chip recurring-preset-chip${isYearEndActive ? " is-active" : ""}`} onClick={() => applyValidityPreset("year_end")}>至今年底</button>
                </div>
              </div>

              {/* Section 2: 今日展示快捷时长 */}
              <div className="recurring-panel-section">
                <div className="recurring-section-header">
                  <h4>今日展示快捷时长</h4>
                  {(draftDisplayTime || draftDurationMinutes !== null) && (
                    <button
                      type="button"
                      className="recurring-clear-display-link"
                      onClick={() => {
                        setDisplayTimeInput("");
                        setDraftDisplayTime("");
                        setDraftDurationMinutes(null);
                      }}
                    >
                      <Icon name="trash" size={13} />
                      <span>清除展示设置</span>
                    </button>
                  )}
                </div>
                <div className="recurring-presets-chips recurring-chips-grid cols-6" role="group" aria-label="快捷时长">
                  {[15, 30, 45, 60, 90, 120].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      className={`preset-chip preset-duration-chip recurring-preset-chip${draftDurationMinutes === mins ? " is-active" : ""}`}
                      onClick={() => {
                        const nextTime = draftDisplayTime || "09:00";
                        setDisplayTimeInput(nextTime);
                        setDraftDisplayTime(nextTime);
                        setDraftDurationMinutes(mins);
                      }}
                    >
                      {mins} 分钟
                    </button>
                  ))}
                </div>
              </div>

              {/* Section 3: 近期发生预览 */}
              <div className="recurring-panel-section occurrence-preview-section">
                <div className="recurring-section-header">
                  <div className="recurring-preview-title">
                    <Icon name="calendar" size={14} />
                    <h4>近期发生预览</h4>
                  </div>
                </div>
                {previewDates.length > 0 ? (
                  <div className="recurring-occurrence-cards">
                    {previewDates.slice(0, 3).map((date, index) => {
                      const isFirst = index === 0;
                      return (
                        <div key={date} className="recurring-occurrence-card">
                          <div className="recurring-occurrence-top">
                            <span className={`recurring-occurrence-badge${isFirst ? " first" : " subsequent"}`}>
                              <span className="badge-dot" />
                              {isFirst ? "首次生效" : `第 ${index + 1} 次`}
                            </span>
                            <span className="recurring-occurrence-weekday">{weekdayLabel(date)}</span>
                          </div>
                          <div className="recurring-occurrence-bottom">
                            <strong className="recurring-occurrence-date">{pickerDateLabel(date)}</strong>
                            <span className="recurring-occurrence-time-tag">
                              {draftDisplayTime || "未设时间"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="recurring-picker-empty-note">当前设置没有可发生日期，请调整频率或有效开始日期。</p>
                )}
              </div>
            </div>
          </section>
        </main>

        {/* BEGIN: ModalFooter */}
        <footer className="recurring-modal-footer">
          <output className="schedule-picker-summary recurring-summary-box">
            <Icon name="calendar" size={15} />
            <span>
              已选 <strong>{pickerDateLabel(draftStartsOn)}</strong> 开始 · 截止至 <strong>{draftEndsOn ? pickerDateLabel(draftEndsOn) : "长期有效"}</strong>
              {daySpan ? <span className="recurring-dayspan-tag"> (共 {daySpan} 天)</span> : ""}
              {draftDisplayTime ? (
                <> · <strong>{draftDisplayTime}</strong> 显示{draftDurationMinutes ? ` (${draftDurationMinutes}分钟)` : ""}</>
              ) : ""}
            </span>
          </output>
          <div className="recurring-footer-actions">
            <button type="button" className="recurring-btn-cancel" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="schedule-picker-confirm recurring-btn-confirm"
              disabled={!validityRangeValid}
              onClick={() => {
                const finalTime = displayTimeInput ? normalizeClockInput(displayTimeInput) : "";
                onConfirm(draftStartsOn, draftEndsOn, finalTime, draftDurationMinutes);
                onClose();
              }}
            >
              确认安排
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
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
  const displayHelp = form.display_time && form.display_duration_minutes
    ? `${form.display_time} 开始，在今日时间线上显示 ${form.display_duration_minutes} 分钟。`
    : form.display_time
      ? `${form.display_time} 开始，未设时长（在今日页顶部显示）。`
      : form.display_duration_minutes
        ? `时长 ${form.display_duration_minutes} 分钟（未设开始时间，在今日页顶部显示）。`
        : "未设置展示时间与时长，到期事项将显示在今日页顶部。";

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
          <div className="recurring-select-wrapper">
            <select
              id={`${idPrefix}-frequency`}
              disabled={disabled}
              value={isDailyLike ? "daily" : form.frequency}
              onChange={(event) => {
                const nextFreq = event.target.value as "daily" | "weekly" | "monthly";
                const startDay = Number(form.starts_on?.slice(8, 10)) || Number(today.slice(8, 10)) || 1;
                onChange({
                  ...form,
                  frequency: nextFreq,
                  month_day: nextFreq === "monthly" ? (form.month_day || startDay) : form.month_day
                });
              }}
            >
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </select>
            <span className="recurring-select-arrow" aria-hidden="true">
              <Icon name="chevron-down" size={15} />
            </span>
          </div>
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

        {form.frequency === "monthly" && (
          <div className="recurring-monthly-bar">
            <div className="recurring-monthly-info">
              <span className="recurring-info-icon" aria-hidden="true"><Icon name="info" size={16} /></span>
              <span>若当月没有所选日期，将跳过该月。</span>
            </div>
          </div>
        )}
      </div>

      <div className="recurring-validity-card">
        <div className="recurring-validity-heading">
          <div className="recurring-validity-title-wrap">
            <span className="recurring-validity-label">有效日期</span>
            <span className="recurring-inline-preview" role="status" aria-live="polite">
              {previewDates.length ? (
                <>最近发生：{previewDates.map(pickerDateLabel).join("、")}</>
              ) : (
                <span className="recurring-inline-preview-empty">暂无匹配发生日</span>
              )}
            </span>
          </div>
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

        <div className="recurring-schedule-grid">
          <div className="recurring-schedule-field">
            <span className="apple-schedule-label">开始日期</span>
            <button
              type="button"
              className={`recurring-schedule-btn${validityPicker?.activeField === "start" ? " is-active" : ""}`}
              disabled={disabled}
              aria-haspopup="dialog"
              aria-expanded={validityPicker?.activeField === "start"}
              aria-label={`开始日期：${pickerDateLabel(form.starts_on)}`}
              onClick={() => setValidityPicker({ activeField: "start" })}
            >
              <Icon name="calendar" size={16} />
              <span className="recurring-schedule-val">{pickerDateLabel(form.starts_on)}</span>
            </button>
          </div>

          <div className="recurring-schedule-field">
            <span className="apple-schedule-label">截止日期</span>
            <button
              type="button"
              className={`recurring-schedule-btn${validityPicker?.activeField === "end" ? " is-active" : ""}${!form.ends_on ? " is-open-ended" : ""}`}
              disabled={disabled}
              aria-haspopup="dialog"
              aria-expanded={validityPicker?.activeField === "end"}
              aria-label={`截止日期：${form.ends_on ? pickerDateLabel(form.ends_on) : "长期有效"}`}
              onClick={() => setValidityPicker({ activeField: "end" })}
            >
              <Icon name="calendar" size={16} />
              <span className="recurring-schedule-val">{form.ends_on ? pickerDateLabel(form.ends_on) : "长期有效（无截止日）"}</span>
            </button>
          </div>

          <div className="recurring-schedule-field">
            <span className="apple-schedule-label">展示时间</span>
            <button
              type="button"
              className={`recurring-schedule-btn${validityPicker?.activeField === "time" ? " is-active" : ""}${!form.display_time ? " is-unset" : ""}`}
              disabled={disabled}
              aria-haspopup="dialog"
              aria-expanded={validityPicker?.activeField === "time"}
              aria-label={`展示时间：${form.display_time || "未设置"}`}
              onClick={() => setValidityPicker({ activeField: "time" })}
            >
              <Icon name="clock" size={16} />
              <span className="recurring-schedule-val">{form.display_time || "未设置"}</span>
            </button>
          </div>

          <div className="recurring-schedule-field">
            <span className="apple-schedule-label">时长</span>
            <button
              type="button"
              className={`recurring-schedule-btn${validityPicker?.activeField === "duration" ? " is-active" : ""}${!form.display_duration_minutes ? " is-unset" : ""}`}
              disabled={disabled}
              aria-haspopup="dialog"
              aria-expanded={validityPicker?.activeField === "duration"}
              aria-label={`时长：${form.display_duration_minutes ? `${form.display_duration_minutes} 分钟` : "未设置"}`}
              onClick={() => setValidityPicker({ activeField: "duration" })}
            >
              <Icon name="clock" size={16} />
              <span className="recurring-schedule-val">
                {form.display_duration_minutes ? `${form.display_duration_minutes} 分钟` : (form.display_time ? "设置时长" : "不限时长")}
              </span>
            </button>
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
        <TaskNotesInputs id={notesId} value={form.notes} disabled={disabled} maxLength={2000} onChange={(notes) => onChange({ ...form, notes })} />
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

function RecurringModalDialog({
  form,
  isEditing,
  busy,
  draftSaving,
  hasDraft,
  isDirty,
  autosaveArmed,
  createItemType,
  canSaveDraft,
  canSubmit,
  onRequestCreateItemType,
  onChange,
  onSaveDraft,
  onSubmit,
  onClose,
}: {
  form: RecurringItemForm;
  isEditing: boolean;
  busy: boolean;
  draftSaving: boolean;
  hasDraft: boolean;
  isDirty: boolean;
  autosaveArmed: boolean;
  createItemType: "task" | "recurring";
  canSaveDraft: boolean;
  canSubmit: boolean;
  onRequestCreateItemType?: (type: "task" | "recurring") => void;
  onChange: (form: RecurringItemForm) => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const draftNoticeText = draftSaving
    ? "正在保存草稿…"
    : isDirty
      ? autosaveArmed
        ? "将在停止输入后自动保存"
        : "已保留输入，继续编辑后才会自动保存"
      : "草稿已保存";

  return createPortal(
    <div
      className="recurring-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <main
        className="recurring-event-modal"
        data-purpose="repeat-event-modal"
        role="dialog"
        aria-modal="true"
        aria-label={isEditing ? "编辑重复事项" : "事项与重复安排高级配置"}
      >
        <div className="recurring-modal-body">
          {/* BEGIN: TypeSelectionHeader */}
          <section className="recurring-type-selection-header" data-purpose="task-type-toggle" data-autosaving={draftSaving && !busy}>
            {/* 普通任务卡片 */}
            <button
              type="button"
              className={`recurring-type-card${createItemType === "task" ? " is-active" : ""}`}
              onClick={() => onRequestCreateItemType?.("task")}
              disabled={busy || draftSaving}
            >
              <div className="recurring-type-icon">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M4 6h16M4 12h10M4 18h7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
              </div>
              <div className="recurring-type-text">
                <div className="recurring-type-name">普通任务</div>
                <div className="recurring-type-hint">时间完整后进入待处理</div>
              </div>
            </button>

            {/* 重复事项卡片 */}
            <button
              type="button"
              className={`recurring-type-card${createItemType === "recurring" ? " is-active" : ""}`}
              onClick={() => onRequestCreateItemType?.("recurring")}
              disabled={busy || draftSaving}
            >
              <div className="recurring-type-icon is-recurring">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
                </svg>
              </div>
              <div className="recurring-type-text">
                <div className="recurring-type-name">重复事项</div>
                <div className="recurring-type-hint">按规则展示，无需勾选</div>
              </div>
            </button>
          </section>
          {/* END: TypeSelectionHeader */}

          <RecurringItemEditor
            form={form}
            disabled={busy}
            idPrefix={isEditing ? "edit-recurring" : "new-recurring"}
            autoFocusTitle
            compact
            isCreating={!isEditing}
            onChange={onChange}
          />
        </div>

        {/* BEGIN: ModalFooter */}
        <footer className="recurring-modal-footer" data-purpose="modal-actions">
          <div className="recurring-modal-draft-status">
            <span className="recurring-modal-pulse-dot" />
            <span className="recurring-modal-draft-text">{draftNoticeText}</span>
          </div>
          <div className="recurring-modal-actions-group">
            <button
              type="button"
              className="recurring-modal-btn-round"
              aria-label="取消"
              title="取消"
              disabled={busy || draftSaving}
              onClick={onClose}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
            </button>

            <button
              type="button"
              className="recurring-modal-btn-round"
              aria-label={draftSaving ? "正在保存草稿…" : (hasDraft && !isDirty) ? "草稿已保存" : "保存草稿"}
              title={draftSaving ? "正在保存草稿…" : (hasDraft && !isDirty) ? "草稿已保存" : "保存草稿"}
              disabled={busy || draftSaving || !canSaveDraft}
              onClick={onSaveDraft}
            >
              {draftSaving ? (
                <span className="loader" style={{ width: 14, height: 14 }} />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
              )}
            </button>

            <button
              type="button"
              className="recurring-modal-btn-primary"
              disabled={busy || !canSubmit}
              onClick={onSubmit}
            >
              {busy ? (
                <span className="loader" style={{ width: 14, height: 14 }} />
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d={isEditing ? "M5 13l4 4L19 7" : "M12 4v16m8-8H4"} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
                </svg>
              )}
              <span>{busy ? "正在保存…" : isEditing ? "保存修改" : "创建重复事项"}</span>
            </button>
          </div>
        </footer>
        {/* END: ModalFooter */}
      </main>
    </div>,
    document.body
  );
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
      <span className="task-capsule-heading-meta">
        {typeLabel && <span className={`task-type-badge${variant === "recurring" ? " recurring" : ""}`}>{typeLabel}</span>}
        {priority && <span className={`priority-badge priority-${priority}`}>{priorityCopy[priority]}</span>}
        {sourceType && <span className={`task-source-icon source-${sourceType}`} role="img" aria-label={sourceType === "ai_assistant" ? "AI 创建" : "手动创建"} title={sourceType === "ai_assistant" ? "AI 创建" : "手动创建"}><Icon name={sourceType === "ai_assistant" ? "sparkle" : "user"} size={13} /></span>}
      </span>
    </span>
    {visibleNotes && <span className="task-capsule-notes" title={visibleNotes}>{visibleNotes}</span>}
    <TaskTagList tags={tags} />
    <span className="task-capsule-footer">
      <span className="task-capsule-facts">
        {facts.map((fact, index) => <TaskCapsuleFact key={`${fact.icon}-${fact.label}-${index}`} {...fact} />)}
        {timing && <TaskCapsuleFact icon="calendar" label={timing} />}
        {minutes !== null && minutes !== undefined && <span><Icon name="clock" size={13} />{minutes} 分钟</span>}
      </span>
      <span className={`task-capsule-status${statusTone ? ` status-${statusTone}` : ""}`}>{status}</span>
    </span>
  </span>;
}

function recurringItemStatusLabel(item: RecurringItem) {
  if (item.deleted_at) return "已删除";
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

function RecycleBinBanner({ deletedAt, nowMs, itemLabel, busy, onRestore, onPermanentDelete }: {
  deletedAt: string | null;
  nowMs: number;
  itemLabel: string;
  busy: boolean;
  onRestore: () => void;
  onPermanentDelete: () => void;
}) {
  return <section className="recycle-bin-banner" aria-label={`${itemLabel}回收站状态`}>
    <button type="button" disabled={busy} onClick={onRestore}><Icon name="restore" size={14} />恢复{itemLabel}</button>
    <div className="recycle-bin-delete-actions">
      <p><Icon name="trash" size={14} /><span>{recycleRetentionMessage(deletedAt, nowMs)}</span></p>
      <button type="button" className="permanent" disabled={busy} onClick={onPermanentDelete}><Icon name="trash" size={14} />永久删除</button>
    </div>
  </section>;
}

function TaskDetailResources({ notes }: { notes: string | null }) {
  const { url, body } = splitTaskNotes(notes ?? "");
  const href = taskResourceUrl(url);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function copyUrl() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setError(null); }
    catch { setError("复制失败，请手动选择并复制链接。"); }
  }
  async function openResource() {
    if (!href) return;
    try { await openUrl(href); setError(null); }
    catch { setError("链接暂时无法打开，请复制后在浏览器中打开。"); }
  }
  return <>
    <h3 className="task-detail-section-heading">任务资料</h3>
    <section className="task-detail-resources" aria-label="任务链接与备注">
      <div className="task-detail-resource-row">
        <div className="task-detail-resource-label"><Icon name="external-link" size={14} />任务 URL</div>
        <div className="task-detail-link-content">
          {href ? <a className="task-detail-url" href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.preventDefault(); void openResource(); }} title={url}><span>{url.replace(/^https?:\/\//i, "")}</span><Icon name="external-link" size={13} /></a> : <span className="task-detail-empty">{url || "未设置"}</span>}
          {url && <button type="button" className="task-detail-copy" aria-label="复制任务链接" onClick={() => void copyUrl()}><span role="status">{copied ? "已复制" : "复制"}</span></button>}
        </div>
      </div>
      <div className="task-detail-resource-row">
        <div className="task-detail-resource-label"><Icon name="file" size={14} />任务备注</div>
        <p className={`task-detail-note${body ? "" : " task-detail-empty"}`}>{body || "未填写"}</p>
      </div>
      {error && <p className="task-detail-resource-feedback" role="alert">{error}</p>}
    </section>
  </>;
}

function TaskDetailContent({ task, metadata, children, busy, onNewTask }: {
  task: Task; metadata: TaskMetadata | null; children: React.ReactNode; busy: boolean; onNewTask: () => void;
}) {
  const listStatus = taskListStatus(task);
  const boundary = (date: string | null, time: string | null) => date ? <>{date}{time && <time>{time}</time>}</> : "未设置";
  return <section className="terminal-task-detail ordinary-task-detail" aria-label={task.status === "deleted" ? "回收站任务详情" : "任务只读详情"}>
    <nav className="task-detail-breadcrumb" aria-label="详情位置"><span>{task.status === "deleted" ? "回收站" : "任务"}</span><Icon name="chevron-right" size={12} /><span>任务详情</span></nav>
    <header><h2>{task.title}</h2><span className={`terminal-task-status status-${listStatus}`}><Icon name={task.status === "deleted" ? "trash" : task.status === "done" ? "check" : "clock"} size={14} />{statusCopy[listStatus]}</span></header>
    <dl className="task-detail-facts" aria-label="任务基本信息">
      <div className="task-detail-fact-column">
        <div><dt><Icon name="calendar" size={14} />最早开始</dt><dd>{boundary(task.earliest_start_date, task.earliest_start_time)}</dd></div>
        <div><dt><Icon name="clock" size={14} />预计工作量</dt><dd>{task.estimated_minutes === null ? "未设置" : <>{task.estimated_minutes}<span className="task-detail-unit">分钟</span></>}</dd></div>
      </div>
      <div className="task-detail-fact-column">
        <div><dt><Icon name="clock" size={14} />截止时间</dt><dd>{boundary(task.due_date, task.due_time)}</dd></div>
        <div><dt><Icon name="deadline" size={14} />优先级</dt><dd>{task.priority ? <span className={`priority-badge priority-${task.priority}`}><i aria-hidden="true" />{priorityCopy[task.priority]}</span> : "未设置"}</dd></div>
      </div>
    </dl>
    <TaskTagList tags={task.tags} />
    <TaskDetailResources key={task.id} notes={task.notes} />
    <footer className="task-detail-actions">{children}</footer>
    <TaskStatusHistory task={task} metadata={metadata} busy={busy} onNewTask={onNewTask} />
  </section>;
}

function DeletedTaskDetails({ task, metadata, busy, now, onRestore, onPermanentDelete, onNewTask }: {
  task: Task; metadata: TaskMetadata | null; busy: boolean; now: number; onRestore: () => void; onPermanentDelete: () => void; onNewTask: () => void;
}) {
  return <TaskDetailContent task={task} metadata={metadata} busy={busy} onNewTask={onNewTask}>
    <button type="button" className="secondary-action" disabled={busy} onClick={onRestore}><Icon name="restore" size={15} />恢复任务</button>
    <div className="task-detail-delete-group">
      <p className="task-detail-cleanup"><Icon name="clock" size={13} /><span>{recycleCleanupMessage(task.deleted_at, now)}</span></p>
      <button type="button" className="terminal-task-trash" disabled={busy} onClick={onPermanentDelete}><Icon name="trash" size={14} />永久删除</button>
    </div>
  </TaskDetailContent>;
}

function TaskStatusHistory({ task, metadata, busy, onNewTask }: {
  task: Task; metadata: TaskMetadata | null; busy: boolean; onNewTask: () => void;
}) {
  const history = metadata?.history ?? [];
  const crossDay = Boolean(task.earliest_start_date && task.due_date && task.earliest_start_date < task.due_date);
  const latestEvent = history.at(-1);
  const historyDate = latestEvent?.plan_date ?? (latestEvent?.occurred_at && Number.isFinite(Date.parse(latestEvent.occurred_at)) ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(latestEvent.occurred_at)) : task.created_at.slice(0, 10));
  const statusLabel = (status: string | null | undefined) => status === "deleted" ? "回收站" : status === "done" ? "已完成" : status === "not_completed" ? "未完成" : status ? statusCopy[status as TaskListStatus] ?? status : null;
  const labelFor = (event: TaskHistoryEvent) => {
    const { kind, status, plan_date } = event;
    const day = plan_date ? `${Number(plan_date.slice(5, 7))}月${Number(plan_date.slice(8, 10))}日：` : "";
    if (kind === "automatic_status") return status === "done" ? crossDay ? "所有日期均已完成，整个任务已自动完成" : "任务已自动完成" : crossDay ? "已取消整个任务完成" : "已取消任务完成";
    if (kind === "execution") return `${day}${status === "done" ? "当天任务已完成" : "当天任务未完成"}`;
    if (kind === "cleared") return `${day}已取消当天完成`;
    if (kind === "cleared_incomplete") return `${day}已取消当天未完成`;
    if (kind === "reopened") return crossDay ? "已取消整个任务完成" : "已取消任务完成";
    if (kind === "status" && status === "done") return crossDay ? "整个任务已完成" : "任务已完成";
    return kind === "created" ? "执行记录已建立" : kind === "restored" ? `恢复为${statusLabel(status) ?? "任务"}` : `状态更新为${statusLabel(status) ?? "未知"}`;
  };
  const displayTime = (value: string) => {
    if (!Number.isFinite(Date.parse(value))) return value;
    const date = new Date(value);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    const time = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(date);
    return day === historyDate ? time : `${day} ${time}`;
  };
  return <section className="task-detail-section" aria-label="执行记录">
    <h3 className="task-detail-section-heading"><Icon name="review" size={15} />执行记录 <span className="task-detail-history-count">{history.length} 条动态</span></h3>
    {!history.length ? <p className="task-detail-history-feedback">{metadata ? "暂无执行记录" : "正在加载执行记录…"}</p> : <details key={task.id} className="task-detail-history">
      <summary><Icon name="chevron-down" size={13} /><span>{historyDate}</span><span className={`terminal-task-status status-${taskListStatus(task)}`}>{statusCopy[taskListStatus(task)]}</span></summary>
      <ol className="task-detail-timeline">{history.map((event) => <li key={event.id} className="task-detail-event" data-status={event.kind === "cleared" || event.kind === "cleared_incomplete" ? "cleared" : event.status ?? "open"}>
        <div className="task-detail-event-top"><strong>{labelFor(event)}</strong>{event.occurred_at && <time dateTime={event.occurred_at}>{displayTime(event.occurred_at)}</time>}</div>
        {event.note && <p className="task-detail-event-note">{event.note}</p>}
        {event.review_note && event.review_note !== event.note && <p className="task-detail-event-note">{event.review_note}</p>}
      </li>)}</ol>
    </details>}
    {taskListStatus(task) === "not_completed" && <button type="button" className="secondary-action task-detail-new-task" disabled={busy} onClick={onNewTask}>新建任务</button>}
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

function DeletedRecurringItemDetails({ item }: { item: RecurringItem }) {
  return <section className="terminal-task-detail recycled-task-detail" aria-label="回收站重复事项详情">
    <header><h2>{item.title}</h2><span className="terminal-task-status deleted"><Icon name="trash" size={14} />回收站</span></header>
    <p className="terminal-task-help">该重复事项已结束并移入回收站，过去的记录仍会保留。</p>
    <dl className="terminal-task-facts">
      <div><dt>重复规则</dt><dd>{recurringScheduleLabel(item)}</dd></div>
      <div><dt>有效日期</dt><dd>{item.starts_on} 至 {item.ends_on ?? "长期"}</dd></div>
      <div><dt>今日页显示</dt><dd>{item.display_time ?? "不指定时间"}</dd></div>
      <div><dt>显示时长</dt><dd>{item.display_duration_minutes ? `${item.display_duration_minutes} 分钟` : "未设置"}</dd></div>
    </dl>
    {item.notes && <p className="terminal-task-notes">{item.notes}</p>}
  </section>;
}

function EndedRecurringItemDetails({ item, busy, onTrash }: {
  item: RecurringItem; busy: boolean; onTrash: () => void;
}) {
  return <section className="terminal-task-detail" aria-label="已结束重复事项详情">
    <header><h2>{item.title}</h2><span className="terminal-task-status ended"><Icon name="check" size={14} />已结束</span></header>
    <p className="terminal-task-help">该事项不会再出现，过去的记录仍会保留。现在可以将它移入回收站。</p>
    <dl className="terminal-task-facts">
      <div><dt>重复规则</dt><dd>{recurringScheduleLabel(item)}</dd></div>
      <div><dt>有效日期</dt><dd>{item.starts_on} 至 {item.ends_on ?? "长期"}</dd></div>
      <div><dt>今日页显示</dt><dd>{item.display_time ?? "不指定时间"}</dd></div>
      <div><dt>显示时长</dt><dd>{item.display_duration_minutes ? `${item.display_duration_minutes} 分钟` : "未设置"}</dd></div>
    </dl>
    {item.notes && <p className="terminal-task-notes">{item.notes}</p>}
    <footer><button type="button" className="terminal-task-trash" disabled={busy} onClick={onTrash}><Icon name="trash" size={14} />移入回收站</button></footer>
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

function CompletedTaskDetails({ task, busy, now, metadata = null, onReopen, onTrash, onComplete, onNewTask, onEdit }: {
  task: Task; busy: boolean; now: number; metadata?: TaskMetadata | null; onReopen: () => void; onTrash: () => void; onComplete: () => void; onNewTask: () => void; onEdit?: () => void;
}) {
  const editable = taskResultEditable(task, now, metadata);
  return <TaskDetailContent task={task} metadata={metadata} busy={busy} onNewTask={onNewTask}>
    <div className="task-detail-primary-actions">
    <button type="button" className={task.status === "done" ? "secondary-action" : "task-compact-complete"} disabled={busy || !editable} title={!editable ? historicalTaskCompletionLocked(task, now) ? HISTORY_COMPLETION_LOCKED_MESSAGE : "已超过结果修改时间" : undefined} onClick={task.status === "done" ? onReopen : onComplete}><Icon name={task.status === "done" ? "restore" : "check"} size={15} />{task.status === "done" ? task.earliest_start_date && task.due_date && task.earliest_start_date < task.due_date ? "取消整体完成" : "取消完成" : task.earliest_start_date && task.due_date && task.earliest_start_date < task.due_date ? "完成整个任务" : "完成任务"}</button>
    {onEdit && taskIsEditable(task) && <button type="button" className="secondary-action" disabled={busy} onClick={onEdit}><Icon name="file" size={14} />编辑任务</button>}
    </div>
    <button type="button" className="terminal-task-trash" disabled={busy} onClick={onTrash}><Icon name="trash" size={14} />移入回收站</button>
  </TaskDetailContent>;
}

function TaskCompletionDialog({ task, note, busy, error, onNoteChange, onCancel, onConfirm }: {
  task: Task; note: string; busy: boolean; error: string | null; onNoteChange: (note: string) => void; onCancel: () => void; onConfirm: () => void;
}) {
  return <div className="dialog-backdrop task-completion-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <ConfirmationDialog role="dialog" aria-modal="true" aria-labelledby="task-completion-title" aria-describedby="task-completion-description" initialFocus="textarea:not(:disabled)" busy={busy} onCancel={onCancel}>
      <form onSubmit={(event) => { event.preventDefault(); if (!busy) onConfirm(); }}>
        <header className="task-completion-header"><h2 id="task-completion-title">{task.earliest_start_date && task.due_date && task.earliest_start_date < task.due_date ? "完成整个任务" : "完成任务"}</h2><p id="task-completion-description">{task.title} · 后续未执行的安排将不再显示，已有执行记录会保留。</p></header>
        <div className="task-completion-body">
          <label className="task-completion-note"><span>备注 <small>选填</small></span><textarea autoFocus value={note} maxLength={500} disabled={busy} placeholder="记录完成情况…" onChange={(event) => onNoteChange(event.target.value)} /></label>
          <p className="task-completion-count">{note.length} / 500</p>
          {error && <p className="task-completion-error" role="alert">{error}</p>}
        </div>
        <footer className="dialog-actions task-completion-actions"><button type="button" disabled={busy} onClick={onCancel}>取消</button><button type="submit" className="primary-action" disabled={busy}>{busy ? "正在完成…" : "确认完成"}</button></footer>
      </form>
    </ConfirmationDialog>
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
  timelineReturnContext: TimelineReturnContext | null;
  onReturnToTimeline: (context: TimelineReturnContext) => void;
  onOpenToday: (date?: string, taskId?: string) => void;
}) {
  const [view, setView] = useState<TaskView>("open");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [filterMenuPlacement, setFilterMenuPlacement] = useState({ left: 0, top: 0, width: 0, maxHeight: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ManualTaskUpdate | null>(null);
  const [compactTaskEditorDismissed, setCompactTaskEditorDismissed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createItemType, setCreateItemType] = useState<CreateItemType>("task");
  const initialCreateItemType = useRef<CreateItemType>("task");
  const initialRecurringForm = useRef<RecurringItemForm>(recurringItemDefaultForm(today));
  const [recurringForm, setRecurringForm] = useState<RecurringItemForm>(initialRecurringForm.current);
  const [selectedRecurringId, setSelectedRecurringId] = useState<string | null>(null);
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
  const [pendingDiscardTaskDraft, setPendingDiscardTaskDraft] = useState<TaskDraft | null>(null);
  const [pendingEndRecurringItem, setPendingEndRecurringItem] = useState<RecurringItem | null>(null);
  const [pendingTrashRecurringItem, setPendingTrashRecurringItem] = useState<RecurringItem | null>(null);
  const preferredSelection = useRef<string | null>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const filterPopupRef = useRef<HTMLElement>(null);
  const ledgerRef = useRef<HTMLDivElement>(null);
  const ledgerResizeSession = useRef<LedgerResizeSession | null>(null);
  const [ledgerListWidth, setLedgerListWidth] = useState<number | null>(null);
  const [ledgerMaximumWidth, setLedgerMaximumWidth] = useState(TASK_LEDGER_LIST_DEFAULT_WIDTH);
  const [resizingLedger, setResizingLedger] = useState(false);
  const [pendingTaskChange, setPendingTaskChange] = useState<PendingTaskChange | null>(null);
  const [taskMetadata, setTaskMetadata] = useState<TaskMetadata | null>(null);
  const initialTaskMetadata = useRef<TaskMetadata | null>(null);
  const [pendingRecurringSave, setPendingRecurringSave] = useState<TaskDraftInput | null>(null);
  const [pendingDiscardNew, setPendingDiscardNew] = useState(false);
  const [pendingHistoricalCreation, setPendingHistoricalCreation] = useState<{ title: string; input: string } | null>(null);
  const [pendingDraftSelection, setPendingDraftSelection] = useState<TaskDraft | null>(null);
  const [pendingPermanentTask, setPendingPermanentTask] = useState(false);
  const [pendingPermanentRecurringItem, setPendingPermanentRecurringItem] = useState(false);
  const handledRequestedView = useRef<TaskViewRequest | null>(null);
  const preparingIndependent = useRef(false);
  const resultNow = useResultNow();
  const taskViewInitialized = useRef(false);
  const [taskViewReady, setTaskViewReady] = useState(false);
  const [recycleNow, setRecycleNow] = useState(() => Date.now());
  const availableTags = useMemo(() => uniqueTags([...tasks.flatMap((task) => task.tags), ...recurringItems.flatMap((item) => item.tags), ...taskDrafts.flatMap((item) => item.tags)]).sort((a, b) => a.localeCompare(b, "zh-CN")), [tasks, recurringItems, taskDrafts]);

  useEffect(() => {
    if (!requestedView || handledRequestedView.current === requestedView) return;
    if (requestedView.taskSeed) {
      handledRequestedView.current = requestedView;
      taskViewInitialized.current = true;
      setTaskViewReady(true);
      void openIndependentDraft(requestedView.taskSeed);
    } else if (requestedView.taskId) {
      const target = tasks.find((task) => task.id === requestedView.taskId);
      if (target) {
        preferredSelection.current = target.id;
        setView(taskListStatus(target));
        setCreating(false);
        setSelectedId(target.id);
        setDraft(draftForTask(target));
        setCompactTaskEditorDismissed(false);
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
    setFilterMenuOpen(false);
  }, [requestedView, tasks]);

  useEffect(() => {
    if (!filterMenuOpen) return;
    function closeFilterMenu(event: PointerEvent) {
      if (!filterMenuRef.current?.contains(event.target as Node) && !filterPopupRef.current?.contains(event.target as Node)) setFilterMenuOpen(false);
    }
    function closeFilterMenuWithKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setFilterMenuOpen(false);
        filterTriggerRef.current?.focus();
        event.preventDefault();
      }
    }
    window.addEventListener("pointerdown", closeFilterMenu);
    window.addEventListener("keydown", closeFilterMenuWithKeyboard);
    return () => {
      window.removeEventListener("pointerdown", closeFilterMenu);
      window.removeEventListener("keydown", closeFilterMenuWithKeyboard);
    };
  }, [filterMenuOpen]);

  useLayoutEffect(() => {
    if (!filterMenuOpen) return;
    function positionFilterMenu() {
      const list = filterMenuRef.current?.closest(".task-ledger-list")?.getBoundingClientRect();
      const searchBar = filterMenuRef.current?.closest(".task-queue-search")?.getBoundingClientRect();
      if (!list || !searchBar) return;
      const width = Math.min(340, list.width - 24, window.innerWidth - 24);
      const top = searchBar.bottom + 2;
      setFilterMenuPlacement({
        left: list.right - 12 - width,
        top,
        width,
        maxHeight: window.innerHeight - top - 16
      });
    }
    positionFilterMenu();
    filterPopupRef.current?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')?.focus();
    window.addEventListener("resize", positionFilterMenu);
    window.addEventListener("scroll", positionFilterMenu, true);
    return () => {
      window.removeEventListener("resize", positionFilterMenu);
      window.removeEventListener("scroll", positionFilterMenu, true);
    };
  }, [filterMenuOpen]);

  function handleFilterMenuKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const options = Array.from(filterPopupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
    event.preventDefault();
  }

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
  const recurringEditingDirty = !creating && view === "recurring" && selectedRecurringItem
    ? JSON.stringify(recurringForm) !== JSON.stringify(recurringItemFormForItem(selectedRecurringItem))
    : false;
  const hasUnsavedChanges = isDirty || newTaskIsDirty || recurringEditingDirty;
  const newTaskHasCompleteSchedule = taskScheduleIsComplete(newTaskForm);
  const newTaskHasValidRange = taskRangeIsValid(newTaskForm);
  const newTaskHasValidWorkload = taskWorkloadIsValid(newTaskForm);
  const newTaskIsHistoricalCreation = createItemType === "task" && persistedNewTaskDraft?.draft_kind !== "update" && isHistoricalResultDate(newTaskForm.due_date, resultNow);
  const newTaskHistoryError = createItemType === "task" && persistedNewTaskDraft?.draft_kind !== "update" ? historicalTaskCreationError(newTaskForm, resultNow) : null;
  const selectedMetadata = taskMetadata?.task_id === selectedTask?.id ? taskMetadata : null;
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
    newTaskEditRevision.current += 1;
    setNewTaskAutosaveArmed(true);
    setNewTaskForm(next);
  }

  function applyCreateItemType(type: CreateItemType) {
    if (!creating || busy || draftSaving || type === createItemType || persistedNewTaskDraft?.target_task_id) return;
    setPendingHistoricalCreation(null);
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
    if (selected) setRecurringForm(recurringItemFormForItem(selected));
  }, [view, creating, selectedRecurringId, visibleRecurringItems]);

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
        return current > maximum ? maximum : current;
      });
    });
    observer.observe(ledger);
    return () => observer.disconnect();
  }, []);

  const counts = useMemo(() => ({
    draft: taskDrafts.length,
    recurring: recurringItems.filter((item) => !item.deleted_at).length,
    open: tasks.filter((task) => taskMatchesView(task, "open")).length,
    scheduled: tasks.filter((task) => taskMatchesView(task, "scheduled")).length,
    not_completed: tasks.filter((task) => taskMatchesView(task, "not_completed")).length,
    done: tasks.filter((task) => taskMatchesView(task, "done")).length,
    deleted: tasks.filter((task) => taskMatchesView(task, "deleted")).length + recurringItems.filter((item) => item.deleted_at).length
  }), [tasks, taskDrafts, recurringItems]);
  const showUnsavedCreateCapsule = creating && view === "draft"
    && !persistedNewTaskDraft;

  useEffect(() => {
    if (loading || taskViewInitialized.current || requestedView) return;
    taskViewInitialized.current = true;
    const operationalViews: TaskView[] = ["open", "scheduled", "not_completed"];
    void getUiSetting(TASK_QUEUE_VIEW_SETTING).then((stored) => {
      const preferred = operationalViews.includes(stored as TaskView) ? stored as TaskView : null;
      const next = preferred && counts[preferred] > 0
        ? preferred
        : operationalViews.find((candidate) => counts[candidate] > 0) ?? "open";
      setView(next);
      setTaskViewReady(true);
    }).catch(() => {
      setView(operationalViews.find((candidate) => counts[candidate] > 0) ?? "open");
      setTaskViewReady(true);
    });
  }, [loading, requestedView, counts]);

  useEffect(() => {
    if (!taskViewReady || !["open", "scheduled", "not_completed"].includes(view)) return;
    void setUiSetting(TASK_QUEUE_VIEW_SETTING, view).catch(() => undefined);
  }, [view, taskViewReady]);

  async function commitDraft(scope?: "this" | "future") {
    if (!taskIsEditable(selectedTask)) return false;
    if (!selectedTask || !draft || busy || !isDirty) return !isDirty;
    if (!selectedMetadata) { setFeedback("任务标签正在加载，请稍后再保存。"); return false; }
    const form = editingTaskForm;
    if (!form) return false;
    if (!taskScheduleIsComplete(form)) {
      setFeedback("请先填写完整的任务开始和结束时间。");
      return false;
    }
    if (!taskRangeIsValid(form)) {
      setFeedback(`任务时间至少需要 ${MIN_TASK_WORKLOAD_MINUTES} 分钟。`);
      return false;
    }
    if (!taskWorkloadIsValid(form)) {
      setFeedback(`平均每天至少投入 ${MIN_TASK_WORKLOAD_MINUTES} 分钟。`);
      return false;
    }
    let input = taskDraftInputForForm(form);
    if (scope === "future" && input.recurrence && selectedTask.earliest_start_date) {
      input = { ...input, recurrence: { ...input.recurrence, starts_on: selectedTask.earliest_start_date } };
    }
    if (initialTaskMetadata.current?.recurrence && !scope) {
      setPendingRecurringSave(input);
      return false;
    }
    setBusy(true);
    setSuccessToast(null);
    try {
      const committed = scope
        ? await updateRecurringTask(selectedTask.id, input, scope)
        : await updateManualTask(selectedTask.id, {
            ...draft,
            title: draft.title.trim(),
            notes: draft.notes?.trim() || null,
            earliest_start_at: toShanghaiTimestamp(draft.earliest_start_at ?? ""),
            due_at: toShanghaiTimestamp(draft.due_at ?? "")
          }, form.tags);
      const metadata = await getTaskMetadata(selectedTask.id);
      setTaskMetadata(metadata);
      initialTaskMetadata.current = metadata;
      onTaskCommitted({ ...committed, tags: metadata.tags });
      if (taskListStatus(committed) !== view) {
        preferredSelection.current = committed.id;
        setView(taskListStatus(committed));
      }
      setDraft(draftForTask(committed));
      setPendingRecurringSave(null);
      setFeedback(null);
      await showCommittedToast("任务更改已保存", ["open", "scheduled"].includes(committed.status), committed.scheduled_dates?.[0] ?? committed.earliest_start_date ?? undefined, committed.id);
      return true;
    } catch (reason) {
      setFeedback(`未保存：${uiErrorMessage(reason)}`);
      return false;
    } finally { setBusy(false); }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void commitDraft();
  }

  function clearNewTaskForm() {
    setPendingHistoricalCreation(null);
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
      setNewTaskError("请填写完整的任务开始和结束时间；当前内容仍可保存为草稿。");
      return false;
    }
    if (createItemType === "task" && (!newTaskHasValidRange || !newTaskHasValidWorkload)) return false;
    setBusy(true);
    setSuccessToast(null);
    setNewTaskError(null);
    try {
      const persisted = await persistCurrentTaskDraft(false, true);
      if (!persisted || newTaskEditRevision.current !== editRevision) return false;
      const persistedHistoryError = persisted.item_type !== "recurring" && persisted.draft_kind !== "update" ? historicalTaskCreationError(persisted, Date.now()) : null;
      if (persistedHistoryError) { setNewTaskError(persistedHistoryError); return false; }
      if (persisted.item_type !== "recurring" && persisted.draft_kind !== "update"
        && isHistoricalResultDate(persisted.due_date, Date.now())
        && confirmedHistoricalInput !== JSON.stringify(input)) {
        setPendingHistoricalCreation({ title: persisted.title, input: JSON.stringify(input) });
        return false;
      }
      setPendingHistoricalCreation(null);
      const result = await confirmCreationDraft(persisted);
      clearNewTaskForm();
      setTaskDrafts((current) => current.filter((item) => item.id !== persisted.id));
      if (result.item_type === "recurring") {
        setView("recurring");
        setSelectedRecurringId(result.item.id);
        await onRecurringChanged();
        setSuccessToast({ id: Date.now(), message: "重复事项已创建" });
      } else {
        preferredSelection.current = result.item.id;
        onTaskCommitted(result.item);
        setView(taskListStatus(result.item));
        setSelectedId(result.item.id);
        await onReload(false);
        await showCommittedToast(persisted.draft_kind === "update" ? "任务已更新" : historicalTaskCompletionLocked(result.item) ? "历史任务已创建并自动完成" : result.item.status === "scheduled" ? "任务已创建并安排" : "任务已创建", ["open", "scheduled"].includes(result.item.status), result.item.scheduled_dates?.[0] ?? result.item.earliest_start_date ?? undefined, result.item.id, !historicalTaskCompletionLocked(result.item));
      }
      setFeedback(null);
      return true;
    } catch (reason) {
      setNewTaskError(`草稿已保留，但尚未创建：${uiErrorMessage(reason)}`);
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
      setPendingDiscardNew(true);
      return false;
    }
    if (persistedNewTaskDraft) {
      setBusy(true);
      try { await discardTaskDraft(persistedNewTaskDraft); }
      catch (reason) {
        setNewTaskError(`草稿未能放弃：${uiErrorMessage(reason)}`);
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
    try {
      await discardTaskDraft(item);
      setTaskDrafts((current) => current.filter((candidate) => candidate.id !== item.id));
      if (persistedNewTaskDraft?.id === item.id) clearNewTaskForm();
      setPendingDiscardTaskDraft(null);
      setFeedback(null);
      setSuccessToast({ id: Date.now(), message: "草稿已放弃" });
    } catch (reason) {
      setFeedback(`草稿未能放弃：${uiErrorMessage(reason)}`);
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

  async function saveAndSwitchPersistedTaskDraft(target: TaskDraft) {
    if (await persistCurrentTaskDraft(false)) await openPersistedTaskDraft(target);
  }

  async function handleManualSaveDraft() {
    if (busy || draftSaving) return;
    if (await persistCurrentTaskDraft(true)) setSuccessToast({ id: Date.now(), message: "草稿已保存" });
  }

  async function keepCurrentDraft() {
    await handleManualSaveDraft();
  }

  async function transition(target: TaskStatus, note: string | null = null) {
    if (!selectedTask || busy) return;
    setBusy(true);
    try {
      preferredSelection.current = selectedTask.id;
      const committed = target === "done" ? await completeTask(selectedTask.id, null, note?.trim() || null) : await transitionManualTask(selectedTask.id, target);
      onTaskCommitted(committed);
      setTaskMetadataRevision((revision) => revision + 1);
      setPendingCompletion(false);
      setView(taskListStatus(committed));
      await onReload(false);
      setSelectedId(selectedTask.id);
      setFeedback(target === "done" ? null : `任务已更新为“${statusCopy[taskListStatus(committed)]}”。`);
      if (target === "done") await showCommittedToast("任务已完成", false, undefined, undefined, !historicalTaskCompletionLocked(committed));
    } catch (reason) { preferredSelection.current = null; const message = `状态未改变：${uiErrorMessage(reason)}`; setFeedback(message); setCompletionError(message); }
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
    setPendingTrashTask({ id: selectedTask.id, title: selectedTask.title });
  }

  async function moveToTrash() {
    if (!pendingTrashTask || busy) return;
    const target = pendingTrashTask;
    setBusy(true);
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
      setFeedback(null);
      setSuccessToast({ id: Date.now(), message: "已移入回收站" });
    } catch (reason) { preferredSelection.current = null; setFeedback(`未移入回收站：${uiErrorMessage(reason)}`); }
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
    if (!selectedTask || busy) return;
    setPendingPermanentTask(false);
    setBusy(true);
    try {
      await permanentlyDeleteManualTask(selectedTask.id, true);
      setSelectedId(null);
      await onReload(false);
      setFeedback(`“${selectedTask.title}”已永久删除。`);
    } catch (reason) { setFeedback(`未永久删除：${uiErrorMessage(reason)}`); }
    finally { setBusy(false); }
  }

  async function saveRecurringItem(event?: FormEvent) {
    event?.preventDefault();
    if (!selectedRecurringItem || busy || !recurringForm.title.trim() || (recurringForm.display_time && !validDraftClock(recurringForm.display_time))) return;
    setBusy(true);
    setFeedback("正在保存重复事项…");
    try {
      const saved = await updateRecurringItem(selectedRecurringItem.id, recurringItemInputForForm(recurringForm));
      await onRecurringChanged();
      setRecurringForm(recurringItemFormForItem(saved));
      setFeedback("重复事项已保存；过去的记录没有改变。");
    } catch (reason) {
      setFeedback(`重复事项未保存：${uiErrorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function changeRecurringItemStatus(status: "active" | "paused" | "ended") {
    if (!selectedRecurringItem || busy) return;
    setBusy(true);
    try {
      const saved = await setRecurringItemStatus(selectedRecurringItem.id, status);
      await onRecurringChanged();
      setRecurringForm(recurringItemFormForItem(saved));
      setFeedback(status === "active" ? "重复事项已恢复。" : status === "paused" ? "重复事项已暂停；过去的记录会继续保留。" : "重复事项已结束；过去的记录会继续保留。");
    } catch (reason) {
      setFeedback(`状态未改变：${uiErrorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function endRecurringItemFromList(item: RecurringItem) {
    if (busy) return;
    setBusy(true);
    try {
      await setRecurringItemStatus(item.id, "ended");
      await onRecurringChanged();
      setPendingEndRecurringItem(null);
      setFeedback(`“${item.title}”已结束；过去的记录会继续保留。`);
    } catch (reason) {
      setFeedback(`重复事项未能结束：${uiErrorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function moveRecurringItemToTrash() {
    if (!pendingTrashRecurringItem || busy) return;
    const item = pendingTrashRecurringItem;
    setBusy(true);
    try {
      await softDeleteRecurringItem(item.id, true);
      if (selectedRecurringId === item.id) setSelectedRecurringId(null);
      await onRecurringChanged();
      setPendingTrashRecurringItem(null);
      setFeedback(`“${item.title}”已移入回收站；过去的记录仍会保留。`);
    } catch (reason) {
      setFeedback(`重复事项未移入回收站：${uiErrorMessage(reason)}`);
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
    if (!selectedRecurringItem || busy) return;
    const item = selectedRecurringItem;
    setPendingPermanentRecurringItem(false);
    setBusy(true);
    try {
      await permanentlyDeleteRecurringItem(item.id, true);
      setSelectedRecurringId(null);
      await onRecurringChanged();
      setFeedback(`“${item.title}”及其本地历史已永久删除。`);
    } catch (reason) {
      setFeedback(`重复事项未永久删除：${uiErrorMessage(reason)}`);
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
      setPendingTrashTask(change.task);
    } else {
      requestMoveToTrash();
    }
  }

  async function selectRecurringItem(item: RecurringItem) {
    if (busy || draftSaving) return;
    if (creating) {
      if (!await saveNewTaskBeforeLeaving()) return;
      clearNewTaskForm();
    }
    setSelectedId(null);
    setSelectedRecurringId(item.id);
    setRecurringForm(recurringItemFormForItem(item));
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

  useEffect(() => {
    if (!busy && !hasUnsavedChanges && (pendingTaskChange || externalNavigationRequest)) resolvePendingChange(true);
  }, [busy, hasUnsavedChanges, pendingTaskChange, externalNavigationRequest]);

  useEffect(() => {
    if (!pendingTaskChange && !externalNavigationRequest) return;
    function closeDialog(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !busy) resolvePendingChange(false);
    }
    window.addEventListener("keydown", closeDialog);
    return () => window.removeEventListener("keydown", closeDialog);
  }, [pendingTaskChange, externalNavigationRequest, busy]);

  useEffect(() => {
    function handleSaveShortcut(event: globalThis.KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== "s" || !hasUnsavedChanges) return;
      event.preventDefault();
      if (creating) void commitNewTask();
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
  }, [hasUnsavedChanges, creating, draft, selectedTask, newTaskForm, persistedNewTaskDraft, busy]);

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
    event.preventDefault();
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
      <div ref={ledgerRef} className={`task-ledger${resizingLedger ? " is-resizing" : ""}`} style={ledgerListWidth ? { "--task-list-width": `${ledgerListWidth}px` } as CSSProperties : undefined}>
        <div className="task-ledger-list" aria-busy={loading}>
          <header className="task-queue-header">
            <div className="task-queue-heading">
              <h1>{taskViewCopy[view]}</h1>
              <span className="task-queue-count">{counts[view] + (showUnsavedCreateCapsule ? 1 : 0)} 项任务</span>
            </div>
            <div className="task-queue-search">
              <Icon name="search" size={16} />
              <input type="search" aria-label="搜索当前任务视图" placeholder="搜索任务" value={search} onChange={(event) => setSearch(event.target.value)} />
              {search && <button type="button" aria-label="清除搜索" onClick={() => setSearch("")}><Icon name="close" size={14} /></button>}
              <div className="task-filter-control" ref={filterMenuRef}>
                <button ref={filterTriggerRef} className={`queue-filter-button${filterMenuOpen ? " is-open" : ""}${view !== "open" || search ? " is-filtered" : ""}`} type="button" aria-label={`筛选任务，当前为${taskViewCopy[view]}`} aria-haspopup="dialog" aria-expanded={filterMenuOpen} aria-controls={filterMenuOpen ? "task-filter-menu" : undefined} onClick={() => setFilterMenuOpen((open) => !open)}><Icon name="filter" size={18} /></button>
                {filterMenuOpen && createPortal(<section id="task-filter-menu" ref={filterPopupRef} className="task-filter-menu" role="dialog" aria-label="视图与筛选" style={filterMenuPlacement} onKeyDown={handleFilterMenuKeyDown}>
                  <header className="filter-menu-heading">
                    <div className="filter-menu-title"><strong>视图与筛选</strong></div>
                  </header>
                  <div className="filter-menu-options" role="radiogroup" aria-label="任务类型">
                    {taskViewGroups.map((group) => <div className="filter-menu-group" role="group" aria-label={group.label} key={group.label}>
                      <span className="filter-menu-caption">{group.label}</span>
                      {group.items.map((item) => (
                        <button key={item} type="button" role="radio" aria-checked={view === item} onClick={() => { requestTaskChange({ kind: "view", view: item }); setFilterMenuOpen(false); }}>
                          <span className={`filter-option-icon filter-option-${item}`}><Icon name={taskViewIcon[item]} size={16} /></span>
                          <span className="filter-option-copy"><strong>{taskViewCopy[item]}</strong></span>
                          <span className="filter-option-meta"><em>{counts[item]}</em>{view === item && <Icon name="check" size={15} />}</span>
                        </button>
                      ))}
                    </div>)}
                  </div>
                  <footer className="filter-menu-footer"><span><kbd>↑↓</kbd> 导航</span><i aria-hidden="true">·</i><span><kbd>↵</kbd> 选择</span><span className="filter-menu-footer-close"><kbd>Esc</kbd> 关闭</span></footer>
                </section>, document.body)}
              </div>
            </div>
            {(availableTags.length > 0 || tagFilter) && <div className="task-tag-filter"><label htmlFor="task-tag-filter">标签</label><select id="task-tag-filter" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="">全部标签</option>{uniqueTags([...availableTags, tagFilter]).map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select>{tagFilter && <button type="button" onClick={() => setTagFilter("")}>清除</button>}</div>}
          </header>
          <p className="workspace-feedback" role="status" aria-live="polite">{feedback ?? ""}</p>
          {showUnsavedCreateCapsule && (
            <div className={`ledger-row selected task-ledger-row task-capsule-row capsule-type-${createItemType} status-row-draft`}>
              <button
                type="button"
                className="ledger-row-select task-capsule-select"
                aria-pressed="true"
                aria-label={`${createItemType === "task" ? newTaskForm.title.trim() || "未命名草稿" : recurringForm.title.trim() || "未命名重复事项"}，待确认`}
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
                    status="待确认"
                    statusTone="draft"
                    sourceType="manual"
                  />
                ) : (
                  <TaskCapsuleContent
                    title={recurringForm.title.trim() || "未命名重复事项"}
                    notes={recurringForm.notes.trim()}
                    tags={recurringForm.tags}
                    facts={recurringCapsuleFacts(recurringForm, today)}
                    status="待确认"
                    statusTone="draft"
                    sourceType="manual"
                    variant="recurring"
                  />
                )}
              </button>
              <div className="ledger-row-actions" aria-label={`${(createItemType === "task" ? newTaskForm.title.trim() : recurringForm.title.trim()) || "未命名草稿"}的快捷操作`}>
                <button
                  type="button"
                  className="ledger-quick-action danger"
                  aria-label={`放弃${(createItemType === "task" ? newTaskForm.title.trim() : recurringForm.title.trim()) || "未命名草稿"}`}
                  onClick={() => void cancelNewTask(true)}
                >
                  <Icon name="trash" size={14} />
                  <span>放弃</span>
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
                {view === "deleted" && item.deleted_at && <button type="button" className="ledger-quick-action icon-only" data-tooltip="恢复" aria-label={`恢复${item.title}`} disabled={busy} onClick={() => void restoreSelectedRecurringItem(item)}><Icon name="restore" size={15} /></button>}
                {view === "deleted" && item.deleted_at && <button type="button" className="ledger-quick-action icon-only danger" data-tooltip="永久删除" aria-label={`永久删除${item.title}`} disabled={busy} onClick={() => { setSelectedId(null); setSelectedRecurringId(item.id); setPendingPermanentRecurringItem(true); }}><Icon name="trash" size={15} /></button>}
                {view === "recurring" && item.status !== "ended" && selectedRecurringId !== item.id && <button type="button" className="ledger-quick-action" onClick={() => void selectRecurringItem(item)}>编辑</button>}
                {view === "recurring" && item.status === "ended" && <button type="button" className="ledger-quick-action danger" aria-label={`将${item.title}移入回收站`} onClick={() => setPendingTrashRecurringItem(item)}><Icon name="trash" size={14} /><span>回收站</span></button>}
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
                  {itemType === "recurring" ? <TaskCapsuleContent title={draftTitle} tags={common.tags} notes={draftNotes} status="待确认" statusTone="draft" variant="recurring" sourceType={item.source_type} facts={recurringCapsuleFacts(recurring, today)} /> : <TaskCapsuleContent title={draftTitle} tags={common.tags} notes={draftNotes} priority={draftPriority} timing={draftTiming} minutes={draftMinutes} status="待确认" statusTone="draft" sourceType={item.source_type} />}
                </button>
                <div className="ledger-row-actions" aria-label={`${draftTitle}的快捷操作`}>
                  {!isEditingActiveDraft && <button type="button" className="ledger-quick-action" onClick={() => void selectPersistedTaskDraft(item)}>编辑</button>}
                  <button type="button" className="ledger-quick-action danger" aria-label={`放弃${draftTitle}`} onClick={() => setPendingDiscardTaskDraft(item)}><Icon name="trash" size={14} /><span>放弃</span></button>
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
                {selectedId !== task.id && taskIsEditable(task) && <button type="button" className="ledger-quick-action" onClick={() => requestTaskChange({ kind: "select", taskId: task.id, edit: true })}>编辑</button>}
                {task.status === "deleted" && <button type="button" className="ledger-quick-action icon-only" data-tooltip="恢复" aria-label={`恢复${task.title}`} disabled={busy} onClick={() => void restore(task)}><Icon name="restore" size={15} /></button>}
                {task.status === "deleted" && <button type="button" className="ledger-quick-action icon-only danger" data-tooltip="永久删除" aria-label={`永久删除${task.title}`} disabled={busy} onClick={() => { setSelectedRecurringId(null); setSelectedId(task.id); setPendingPermanentTask(true); }}><Icon name="trash" size={15} /></button>}
                {task.status !== "deleted" && <button type="button" className="ledger-quick-action danger" title="移入回收站" aria-label={`将${task.title}移入回收站`} onClick={() => requestTaskChange({ kind: "trash", task: { id: task.id, title: task.title } })}><Icon name="trash" size={14} /><span>回收站</span></button>}
              </div>
            </div>
          ))}
        </div>
        <div className="ledger-resize-handle" role="separator" aria-label="调整任务列表与详情宽度；双击恢复默认宽度" aria-orientation="vertical" aria-valuemin={TASK_LEDGER_LIST_MIN_WIDTH} aria-valuemax={Math.round(ledgerMaximumWidth)} aria-valuenow={Math.round(currentLedgerListWidth())} tabIndex={0} onDoubleClick={resetLedgerWidth} onPointerDown={startLedgerResize} onPointerMove={moveLedgerResize} onPointerUp={endLedgerResize} onPointerCancel={endLedgerResize} onKeyDown={resizeLedgerWithKeyboard} />
        <aside className="task-inspector" aria-label="任务详情">
          <div className="inspector-scroll">
          {view === "deleted" && selectedRecurringItem?.deleted_at ? (
            <RecycleBinBanner deletedAt={selectedRecurringItem.deleted_at} nowMs={recycleNow} itemLabel="重复事项" busy={busy} onRestore={() => void restoreSelectedRecurringItem(selectedRecurringItem)} onPermanentDelete={() => setPendingPermanentRecurringItem(true)} />
          ) : null}
          {timelineReturnContext && selectedTask && (!taskDetailEditing || !editingTaskForm || selectedTask.status === "done" || selectedTask.execution_locked || selectedTask.status === "deleted") && <div className="task-context-return"><button type="button" className="task-context-return-icon" aria-label="返回今日计划中的任务块" title="返回任务块" onClick={() => onReturnToTimeline(timelineReturnContext)}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5m7-7-7 7 7 7" /></svg></button></div>}
          {creating ? (
            <form id="new-task-form" className="task-form create-task-form edit-task-form task-compact-form" autoComplete="off" onSubmit={submitNewTask}>
              <header className="task-compact-header">
                <div className="task-compact-heading">
                  <div className="task-compact-title-row">
                    <h2>编辑任务</h2>
                    <span className="task-compact-status status-draft"><i aria-hidden="true" />{persistedNewTaskDraft ? "待确认草稿" : "草稿"}</span>
                    <span className="task-compact-source"><i aria-hidden="true">·</i>{createItemType === "task" ? "普通任务" : "重复事项"}</span>
                  </div>
                </div>
              </header>
              <div className="task-compact-body">
                {!persistedNewTaskDraft?.target_task_id && (
                  <div className="create-type-switch" role="radiogroup" aria-label="创建类型" data-autosaving={draftSaving && !busy}>
                    <button type="button" role="radio" disabled={busy || draftSaving} aria-checked={createItemType === "task"} onClick={() => requestCreateItemType("task")}>
                      <Icon name="tasks" size={16} />
                      <span><strong>普通任务</strong><small>时间完整后进入待处理</small></span>
                    </button>
                    <button type="button" role="radio" disabled={busy || draftSaving} aria-checked={createItemType === "recurring"} onClick={() => requestCreateItemType("recurring")}>
                      <Icon name="restore" size={16} />
                      <span><strong>重复事项</strong><small>按规则展示，无需勾选</small></span>
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
                    {newTaskHistoryError ? <p className="execution-capture-note" role="status">{newTaskHistoryError}</p> : newTaskIsHistoricalCreation && <p className="execution-capture-note" role="status">这是历史单日任务补录：确认创建后将自动生成已完成任务及当天任务块，执行记录注明“{HISTORICAL_TASK_CREATION_NOTE}”；不填写实际耗时，历史完成不可取消。</p>}
                  </>
                ) : (
                  <RecurringItemEditor form={recurringForm} availableTags={availableTags} disabled={busy} idPrefix="new-recurring" autoFocusTitle compact isCreating onChange={(next) => { newTaskEditRevision.current += 1; setNewTaskAutosaveArmed(true); setRecurringForm(next); }} />
                )}
              </div>
              <footer className="task-compact-actions create-task-actions">
                <div className="task-compact-lifecycle">
                  <span className="task-draft-save-state" role="status">
                    {draftSaving ? "正在保存草稿…"
                      : newTaskIsDirty && (persistedNewTaskDraft || newTaskFieldsAreDirty)
                        ? newTaskAutosaveArmed ? "将在停止输入后自动保存" : "离开当前任务前保存"
                      : persistedNewTaskDraft
                        ? (createItemType === "task" && !newTaskHasCompleteSchedule ? "草稿已保存；补全开始和结束时间后可创建" : "草稿已保存")
                        : (createItemType === "task" && !newTaskHasCompleteSchedule ? "时间未完整时只保存为草稿" : "尚未填写")}
                  </span>
                </div>
                <div className="task-compact-primary-actions">
                  <button
                    type="button"
                    className="task-compact-cancel task-action-icon-btn task-action-discard"
                    disabled={busy || draftSaving}
                    title="放弃草稿"
                    aria-label="放弃草稿"
                    onClick={() => void cancelNewTask()}
                  >
                    <Icon name="close" size={16} />
                  </button>
                  <button
                    type="button"
                    className={`task-compact-secondary-lifecycle task-action-icon-btn task-action-save-draft${draftSaving ? " is-saving" : ""}`}
                    disabled={busy || draftSaving || (!newTaskIsDirty && !persistedNewTaskDraft) || (!persistedNewTaskDraft && !newTaskFieldsAreDirty)}
                    title={
                      draftSaving
                        ? "正在自动保存草稿…"
                        : (!newTaskIsDirty && Boolean(persistedNewTaskDraft))
                          ? "草稿已保存"
                          : "保存草稿"
                    }
                    aria-label={
                      draftSaving
                        ? "正在自动保存草稿…"
                        : (!newTaskIsDirty && Boolean(persistedNewTaskDraft))
                          ? "草稿已保存"
                          : "保存草稿"
                    }
                    onClick={() => void handleManualSaveDraft()}
                  >
                    {draftSaving ? <span className="loader" /> : <Icon name="check" size={16} />}
                  </button>
                  <button
                    type="submit"
                    className="task-compact-save create-task-submit"
                    disabled={
                      busy || draftSaving ||
                      (createItemType === "task"
                        ? !newTaskForm.title.trim() || !newTaskHasCompleteSchedule || !newTaskHasValidRange || !newTaskHasValidWorkload || Boolean(newTaskHistoryError)
                        : !recurringForm.title.trim() || (recurringForm.frequency === "weekly" && !recurringForm.weekdays.length) || Boolean(recurringForm.display_time && !validDraftClock(recurringForm.display_time)))
                    }
                  >
                    {busy ? <span className="loader" /> : <Icon name={createItemType === "task" && persistedNewTaskDraft?.draft_kind === "update" ? "check" : "plus"} size={15} />}
                    {busy ? "正在保存…" : createItemType === "recurring" ? "创建重复事项" : persistedNewTaskDraft?.draft_kind === "update" ? "确认修改任务" : "确认创建任务"}
                  </button>
                </div>
              </footer>
            </form>
          ) : view === "recurring" && selectedRecurringItem?.status === "ended" ? (
            <EndedRecurringItemDetails item={selectedRecurringItem} busy={busy} onTrash={() => setPendingTrashRecurringItem(selectedRecurringItem)} />
          ) : view === "recurring" && selectedRecurringItem ? (
            <form id="recurring-editor-form" className="task-form create-task-form edit-task-form task-compact-form" onSubmit={saveRecurringItem}>
              <header className="task-compact-header">
                <div className="task-compact-heading">
                  <div className="task-compact-title-row">
                    <h2>编辑任务</h2>
                    <span className={`task-compact-status status-recurring status-${selectedRecurringItem.status}`}><i aria-hidden="true" />{recurringItemStatusLabel(selectedRecurringItem)}</span>
                    <span className="task-compact-source"><i aria-hidden="true">·</i>重复事项</span>
                  </div>
                </div>
              </header>
              <div className="task-compact-body">
                <RecurringItemEditor key={selectedRecurringItem.id} form={recurringForm} availableTags={availableTags} disabled={busy} idPrefix="edit-recurring" compact onChange={setRecurringForm} />
              </div>
              <footer className="task-compact-actions">
                <div className="task-compact-lifecycle">
                  {selectedRecurringItem.status === "active" && (
                    <button type="button" className="task-compact-secondary-lifecycle" title="暂停此事项，暂停期间不会在今日页出现" disabled={busy} onClick={() => void changeRecurringItemStatus("paused")}>
                      <Icon name="pause" size={15} />暂停事项
                    </button>
                  )}
                  {selectedRecurringItem.status === "paused" && (
                    <button type="button" className="task-compact-secondary-lifecycle" title="恢复此事项，到期时将在今日页重新展示" disabled={busy} onClick={() => void changeRecurringItemStatus("active")}>
                      <Icon name="restore" size={15} />恢复事项
                    </button>
                  )}
                  <button type="button" className="task-compact-trash" title="结束此事项，结束后不能再编辑，历史记录仍会保留" disabled={busy} onClick={() => void changeRecurringItemStatus("ended")}>
                    <Icon name="check" size={15} />结束事项
                  </button>
                </div>
                <div className="task-compact-primary-actions">
                  <span className="sr-only" role="status">{busy ? "正在保存" : recurringEditingDirty ? "有未保存的更改" : "更改已保存"}</span>
                  <button type="button" className="task-compact-cancel" disabled={busy} onClick={() => setRecurringForm(recurringItemFormForItem(selectedRecurringItem))}>取消</button>
                  <button type="submit" className="task-compact-save" disabled={busy || !recurringEditingDirty || !recurringForm.title.trim() || Boolean(recurringForm.display_time && !validDraftClock(recurringForm.display_time))}>
                    {busy ? <span className="loader" /> : <Icon name="check" size={15} />}{busy ? "保存中…" : "保存修改"}
                  </button>
                </div>
              </footer>
            </form>
          ) : view === "deleted" && selectedRecurringItem?.deleted_at ? (
            <DeletedRecurringItemDetails item={selectedRecurringItem} />
          ) : !selectedTask || !draft ? <div className="inspector-empty"><Icon name={taskViewIcon[view]} size={21} /><p>选择一项查看详情</p></div> : selectedTask.status === "deleted" ? (
            <DeletedTaskDetails task={selectedTask} metadata={selectedMetadata} busy={busy} now={recycleNow} onRestore={() => void restore(selectedTask)} onPermanentDelete={() => setPendingPermanentTask(true)} onNewTask={() => void requestTaskChange({ kind: "new-independent", seed: selectedTask })} />
          ) : taskDetailEditing && editingTaskForm ? (
            <form id="task-editor-form" className="task-form create-task-form edit-task-form task-compact-form" onSubmit={save}>
              <header className="task-compact-header">
                <div className="task-compact-heading">
                  <div className="task-compact-title-row">{timelineReturnContext && <button type="button" className="task-context-return-icon" aria-label="返回今日计划中的任务块" title="返回任务块" onClick={() => onReturnToTimeline(timelineReturnContext)}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5m7-7-7 7 7 7" /></svg></button>}<h2>编辑任务</h2><span className={`task-compact-status status-${taskListStatus(selectedTask)}`}><i aria-hidden="true" />{statusCopy[taskListStatus(selectedTask)]}</span><span className="task-compact-source"><i aria-hidden="true">·</i>{selectedTask.source_type === "ai_assistant" ? "AI 创建" : "手动创建"}</span></div>
                </div>
              </header>
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
            <CompletedTaskDetails task={selectedTask} busy={busy} now={resultNow} metadata={selectedMetadata} onReopen={() => requestTaskChange({ kind: "reopen" })} onTrash={() => requestTaskChange({ kind: "trash" })} onComplete={() => requestTaskChange({ kind: "transition", status: "done" })} onNewTask={() => void requestTaskChange({ kind: "new-independent", seed: selectedTask })} onEdit={() => setTaskDetailEditing(true)} />
          )}
          </div>
        </aside>
      </div>
      {(pendingTaskChange || externalNavigationRequest) && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) resolvePendingChange(false); }}>
        <ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="unsaved-dialog-title" aria-describedby="unsaved-dialog-description" busy={busy} tone="caution" onCancel={() => resolvePendingChange(false)}><h2 id="unsaved-dialog-title">{creating ? "放弃正在记录的内容？" : "放弃未保存的修改？"}</h2><p id="unsaved-dialog-description">{creating ? "当前填写的任务还没有创建，放弃后内容将不会保留。" : "当前修改还没有保存，放弃后将恢复为上一次保存的内容。"}</p><div className="dialog-actions">
            <button type="button" className="dialog-cancel" autoFocus disabled={busy} onClick={() => resolvePendingChange(false)}>继续编辑</button>
            <button type="button" className="dialog-discard" disabled={busy} onClick={() => void discardAndContinue()}>{busy ? "正在放弃…" : creating ? "放弃新建" : "放弃修改"}</button>
          </div></ConfirmationDialog>
      </div>}
      {creating && pendingHistoricalCreation && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !draftSaving) setPendingHistoricalCreation(null); }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="historical-create-title" aria-describedby="historical-create-description" busy={busy || draftSaving} tone="caution" onCancel={() => { if (!busy && !draftSaving) setPendingHistoricalCreation(null); }}><h2 id="historical-create-title">确认补录历史任务？</h2><p id="historical-create-description">“{pendingHistoricalCreation.title}”是历史事项补录，不是待办计划。创建后将直接完成任务，并生成已完成任务块；执行记录会注明“{HISTORICAL_TASK_CREATION_NOTE}”，不自动填写实际耗时。历史完成记录不能取消完成。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy || draftSaving} onClick={() => setPendingHistoricalCreation(null)}>返回编辑</button><button type="button" className="dialog-save" disabled={busy || draftSaving} onClick={() => void commitNewTask(pendingHistoricalCreation.input)}>{busy ? "正在补录…" : "确认补录并完成"}</button></div></ConfirmationDialog></div>}
      {pendingTrashTask && <div className="dialog-backdrop task-trash-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingTrashTask(null); }}>
        <ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="task-trash-title" aria-describedby="task-trash-description" busy={busy} tone="caution" onCancel={() => setPendingTrashTask(null)}><h2 id="task-trash-title">移入回收站？</h2><p id="task-trash-description">“{pendingTrashTask.title}”将从普通任务列表和后续日计划中移除，之后仍可在回收站恢复。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingTrashTask(null)}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void moveToTrash()}>{busy ? "正在移入…" : "确认移入"}</button></div></ConfirmationDialog>
      </div>}
      {pendingDiscardTaskDraft && <div className="dialog-backdrop task-trash-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingDiscardTaskDraft(null); }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="discard-task-draft-title" aria-describedby="discard-task-draft-description" busy={busy} tone="caution" onCancel={() => setPendingDiscardTaskDraft(null)}><h2 id="discard-task-draft-title">放弃草稿？</h2><p id="discard-task-draft-description">“{pendingDiscardTaskDraft.title || "未命名草稿"}”将从草稿中移除，原任务不会变化。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingDiscardTaskDraft(null)}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void discardTaskDraftFromList(pendingDiscardTaskDraft)}>{busy ? "正在放弃…" : "确认放弃"}</button></div></ConfirmationDialog></div>}
      {pendingEndRecurringItem && <div className="dialog-backdrop task-trash-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingEndRecurringItem(null); }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="end-recurring-item-title" aria-describedby="end-recurring-item-description" busy={busy} tone="caution" onCancel={() => setPendingEndRecurringItem(null)}><h2 id="end-recurring-item-title">结束重复事项？</h2><p id="end-recurring-item-description">“{pendingEndRecurringItem.title}”以后不会再出现；已经保存的记录会继续保留。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingEndRecurringItem(null)}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void endRecurringItemFromList(pendingEndRecurringItem)}>{busy ? "正在结束…" : "确认结束"}</button></div></ConfirmationDialog></div>}
      {pendingTrashRecurringItem && <div className="dialog-backdrop task-trash-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingTrashRecurringItem(null); }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="trash-recurring-item-title" aria-describedby="trash-recurring-item-description" busy={busy} tone="caution" onCancel={() => setPendingTrashRecurringItem(null)}><h2 id="trash-recurring-item-title">移入回收站？</h2><p id="trash-recurring-item-description">“{pendingTrashRecurringItem.title}”将从重复事项列表移除；过去的记录仍会保留，之后也可以恢复。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingTrashRecurringItem(null)}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void moveRecurringItemToTrash()}>{busy ? "正在移入…" : "确认移入"}</button></div></ConfirmationDialog></div>}
      {pendingRecurringSave && selectedTask && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingRecurringSave(null); }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="recurring-scope-title" aria-describedby="recurring-scope-description" busy={busy} tone="info" onCancel={() => setPendingRecurringSave(null)}><h2 id="recurring-scope-title">修改哪些重复任务？</h2><p id="recurring-scope-description">“{selectedTask.title}”来自一项重复安排。以前的任务和执行记录不会改变。</p><div className="dialog-actions"><button type="button" disabled={busy} onClick={() => setPendingRecurringSave(null)}>取消</button><button type="button" disabled={busy} onClick={() => void commitDraft("this")}>仅修改本次</button><button type="button" className="dialog-save" disabled={busy} onClick={() => void commitDraft("future")}>修改本次及以后</button></div></ConfirmationDialog></div>}
      {pendingDiscardNew && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingDiscardNew(false); }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="discard-new-title" aria-describedby="discard-new-description" busy={busy} tone="caution" onCancel={() => setPendingDiscardNew(false)}><h2 id="discard-new-title">放弃这个草稿？</h2><p id="discard-new-description">已填写的内容将从草稿中移除，原任务不会变化。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingDiscardNew(false)}>继续编辑</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => { setPendingDiscardNew(false); void cancelNewTask(false); }}>放弃草稿</button></div></ConfirmationDialog></div>}

      {pendingDraftSelection && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !draftSaving && !busy) setPendingDraftSelection(null); }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="switch-draft-title" aria-describedby="switch-draft-description" busy={draftSaving || busy} tone="info" onCancel={() => setPendingDraftSelection(null)}><h2 id="switch-draft-title">保存当前草稿并切换？</h2><p id="switch-draft-description">当前输入会先保存为草稿，然后打开“{pendingDraftSelection.title || "未命名草稿"}”。</p><div className="dialog-actions"><button type="button" autoFocus disabled={draftSaving || busy} onClick={() => setPendingDraftSelection(null)}>留在当前草稿</button><button type="button" className="dialog-save" disabled={draftSaving || busy} onClick={() => { const target = pendingDraftSelection; setPendingDraftSelection(null); void saveAndSwitchPersistedTaskDraft(target); }}>保存并切换</button></div></ConfirmationDialog></div>}
      {pendingCompletion && selectedTask && <TaskCompletionDialog task={selectedTask} note={completionNote} busy={busy} error={completionError} onNoteChange={setCompletionNote} onCancel={() => { if (!busy) setPendingCompletion(false); }} onConfirm={() => void transition("done", completionNote)} />}
      {pendingPermanentTask && selectedTask && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingPermanentTask(false); }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="permanent-task-title" aria-describedby="permanent-task-description" busy={busy} tone="danger" onCancel={() => setPendingPermanentTask(false)}><h2 id="permanent-task-title">永久删除任务？</h2><p id="permanent-task-description">“{selectedTask.title}”及其本地历史将无法恢复。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingPermanentTask(false)}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void permanentlyDelete()}>{busy ? "正在删除…" : "永久删除"}</button></div></ConfirmationDialog></div>}
      {pendingPermanentRecurringItem && selectedRecurringItem && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingPermanentRecurringItem(false); }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="permanent-recurring-item-title" aria-describedby="permanent-recurring-item-description" busy={busy} tone="danger" onCancel={() => setPendingPermanentRecurringItem(false)}><h2 id="permanent-recurring-item-title">永久删除重复事项？</h2><p id="permanent-recurring-item-description">“{selectedRecurringItem.title}”及其全部历史和复盘记录将无法恢复。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingPermanentRecurringItem(false)}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void permanentlyDeleteSelectedRecurringItem()}>{busy ? "正在删除…" : "永久删除"}</button></div></ConfirmationDialog></div>}
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

function fullDateLabel(date: string, today: string) {
  if (date === today) return "今日安排";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long"
  }).format(new Date(`${date}T00:00:00+08:00`));
}

function taskUnreservedMinutes(task: Task) {
  const remaining = task.remaining_workload_minutes ?? task.estimated_minutes;
  return remaining === null ? null : Math.max(0, remaining - task.reserved_minutes);
}

function waitingTaskMinutes(task: Task) {
  const unreserved = taskUnreservedMinutes(task);
  return unreserved === null ? null : preferredDailyAllocationMinutes(task, unreserved);
}

function waitingTaskLabel(task: Task) {
  const unreserved = taskUnreservedMinutes(task);
  if (unreserved === null) return "待补充预计工作量";
  const suggested = waitingTaskMinutes(task) ?? unreserved;
  if (suggested !== unreserved) return `今日建议 ${suggested} 分钟 · 共剩余 ${unreserved} 分钟`;
  if (task.status === "scheduled") return `部分已安排 · 还需安排 ${unreserved} 分钟`;
  return `待安排 ${unreserved} 分钟`;
}

function waitingTaskTooltipDetail(task: Task | undefined, primary: string) {
  return [
    primary,
    task?.notes?.trim()
  ].filter(Boolean).join(" · ");
}

type TimelineSelection = { kind: "block" | "event" | "draft"; id: string };
type ExecutionDraft = { result: ExecutionResult | null; outcome: ExecutionOutcome | null; note: string; wholeTask?: boolean };

function ExecutionCaptureFields({ draft, disabled, onChange, onCompleteTask, completeTaskDisabled }: {
  draft: ExecutionDraft; disabled: boolean; onChange: (update: Partial<ExecutionDraft>) => void; onCompleteTask?: () => void; completeTaskDisabled?: boolean;
}) {
  return <div className="execution-capture-fields">
    <div className="execution-result-label">任务结果</div>
    <ExecutionOutcomePicker label="任务结果" result={draft.result} disabled={disabled} onChange={(result, outcome) => onChange({ result, outcome, wholeTask: false })} onCompleteTask={onCompleteTask} completeTaskDisabled={completeTaskDisabled} wholeTask={draft.wholeTask} />
    <label className="floating-execution-note"><span>备注<small>可选</small></span><textarea rows={3} maxLength={500} placeholder="记录进展或需要留意的事…" value={draft.note} disabled={disabled} onChange={(event) => onChange({ note: event.target.value })} /></label>
  </div>;
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
type TimelineTooltipContent = {
  kind: "普通任务" | "单日任务" | "多日任务" | "任务安排" | "计划草案" | "固定日程" | "重复事项" | "待安排任务" | "非工作时间";
  title: string;
  time: string;
  detail: string;
  tone: "execution" | "execution-completed" | "execution-partial" | "execution-blocked" | "execution-cancelled" | "execution-not_started" | "draft" | "fixed" | "recurring" | "task" | "nonworking";
  url?: string;
  note?: string;
};
type TimelineTooltipState = TimelineTooltipContent & {
  left: number;
  top: number;
  placement: "above" | "below";
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

function taskSchedulingBoundaryIssue(task: Task | undefined, planDate: string) {
  if (!task) return null;
  const earliestDate = task.earliest_start_at?.slice(0, 10);
  const dueDate = task.due_at?.slice(0, 10);
  if (earliestDate && earliestDate > planDate) {
    return `最早可从 ${taskBoundaryLabel(task.earliest_start_at, planDate)} 开始，请选择有效日期或调整任务时间范围`;
  }
  if (dueDate && dueDate < planDate) {
    return `已于 ${taskBoundaryLabel(task.due_at, planDate)} 截止，请调整任务时间范围后再安排`;
  }
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

function nonWorkingSegments(availability: AvailabilitySettings | null, date: string): TimeRailSegment[] {
  if (!availability) return [];
  if (!availabilityWorkdayOn(date, availability.weekdays, availability.makeup_workdays_as_workdays)) {
    return [{ start: 0, end: 24 * 60 }];
  }
  const workdayStart = clockMinutes(availability.workday_start);
  const workdayEnd = clockMinutes(availability.workday_end);
  const segments: TimeRailSegment[] = [];
  if (workdayStart > 0) segments.push({ start: 0, end: workdayStart });
  if (workdayEnd < 24 * 60) segments.push({ start: workdayEnd, end: 24 * 60 });
  return segments;
}

function TimeRangeRail({
  start, end, onChange, segments = [], minMinute = 0, maxMinute = 23 * 60 + 45,
  startLabel = "开始", endLabel = "结束", disabled = false, describedBy,
  showInputs = true, showPreference = true, minimumDuration = MIN_TASK_BLOCK_MINUTES,
  focusedWindow = false
}: {
  start: string;
  end: string;
  onChange: (next: { start: string; end: string }) => void;
  segments?: TimeRailSegment[];
  minMinute?: number;
  maxMinute?: number;
  startLabel?: string;
  endLabel?: string;
  disabled?: boolean;
  describedBy?: string;
  showInputs?: boolean;
  showPreference?: boolean;
  minimumDuration?: number;
  focusedWindow?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const startHandleRef = useRef<HTMLSpanElement>(null);
  const endHandleRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<{ pointerId: number; edge: TimeRangeEdge; grabOffset: number; separated: boolean } | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<TimeRangeEdge | null>(null);
  const startMinute = clockMinutes(start);
  const endMinute = clockMinutes(end);
  const safeStartMinute = Math.max(minMinute, Math.min(startMinute, maxMinute - minimumDuration, endMinute - minimumDuration));
  const safeEndMinute = Math.min(maxMinute, Math.max(endMinute, minMinute + minimumDuration, safeStartMinute + minimumDuration));
  const editingInputRef = useRef<TimeRangeEdge | null>(null);
  const startInputDurationRef = useRef(Math.max(minimumDuration, safeEndMinute - safeStartMinute));
  const [inputValues, setInputValues] = useState(() => ({
    start: minutesClock(safeStartMinute),
    end: minutesClock(safeEndMinute)
  }));
  const focusedWindowRef = useRef<{ start: number; end: number } | null>(null);
  useEffect(() => {
    setInputValues((current) => {
      const next = {
        start: editingInputRef.current === "start" ? current.start : minutesClock(safeStartMinute),
        end: editingInputRef.current === "end" ? current.end : minutesClock(safeEndMinute)
      };
      return next.start === current.start && next.end === current.end ? current : next;
    });
  }, [safeStartMinute, safeEndMinute]);
  if (focusedWindow && (
    !focusedWindowRef.current
    || safeStartMinute < focusedWindowRef.current.start
    || safeEndMinute > focusedWindowRef.current.end
  )) {
    focusedWindowRef.current = focusedTimeRangeWindow({ start: safeStartMinute, end: safeEndMinute }, minMinute, maxMinute);
  }
  const visibleWindow = focusedWindow
    ? focusedWindowRef.current ?? focusedTimeRangeWindow({ start: safeStartMinute, end: safeEndMinute }, minMinute, maxMinute)
    : { start: minMinute, end: maxMinute };
  const railMinMinute = visibleWindow.start;
  const railMaxMinute = visibleWindow.end;
  const span = Math.max(minimumDuration, railMaxMinute - railMinMinute);
  const position = (minute: number) => `${Math.max(0, Math.min(100, (minute - railMinMinute) / span * 100))}%`;
  const handlesAreTight = (safeEndMinute - safeStartMinute) / span <= 0.08;
  const handlesAreSeparated = draggingHandle ? Boolean(dragRef.current?.separated) : handlesAreTight;
  const visibleSegments = segments.filter((segment) => segment.end > railMinMinute && segment.start < railMaxMinute);

  function updateEdge(edge: TimeRangeEdge, value: number, minimum = railMinMinute, maximum = railMaxMinute) {
    const next = constrainTimeRange(
      edge,
      value,
      { start: safeStartMinute, end: safeEndMinute },
      minimum,
      maximum,
      minimumDuration,
      15
    );
    if (next.start === safeStartMinute && next.end === safeEndMinute) return;
    onChange({ start: minutesClock(next.start), end: minutesClock(next.end) });
  }

  function updateStart(value: number) {
    updateEdge("start", value);
  }

  function updateEnd(value: number) {
    updateEdge("end", value);
  }

  function beginInput(edge: TimeRangeEdge) {
    editingInputRef.current = edge;
    if (edge === "start") startInputDurationRef.current = Math.max(minimumDuration, safeEndMinute - safeStartMinute);
  }

  function updateInput(edge: TimeRangeEdge, value: string) {
    setInputValues((current) => ({ ...current, [edge]: value }));
    if (!validDraftClock(value)) return;
    const next = edge === "start"
      ? shiftTimeRangeFromStart(
        clockMinutes(value),
        startInputDurationRef.current,
        minMinute,
        maxMinute,
        minimumDuration,
        15
      )
      : constrainTimeRange(
        edge,
        clockMinutes(value),
        { start: safeStartMinute, end: safeEndMinute },
        minMinute,
        maxMinute,
        minimumDuration,
        15
      );
    setInputValues({ start: minutesClock(next.start), end: minutesClock(next.end) });
    if (next.start === safeStartMinute && next.end === safeEndMinute) return;
    if (focusedWindow) focusedWindowRef.current = focusedTimeRangeWindow(next, minMinute, maxMinute);
    onChange({ start: minutesClock(next.start), end: minutesClock(next.end) });
  }

  function finishInput() {
    editingInputRef.current = null;
    setInputValues({ start: minutesClock(safeStartMinute), end: minutesClock(safeEndMinute) });
  }

  function pointerMinute(clientX: number, grabOffset: number) {
    const track = trackRef.current;
    if (!track) return null;
    const bounds = track.getBoundingClientRect();
    if (bounds.width <= 0) return null;
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left - grabOffset) / bounds.width));
    return railMinMinute + ratio * span;
  }

  function startPointerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return;
    const track = trackRef.current;
    const startHandle = startHandleRef.current;
    const endHandle = endHandleRef.current;
    if (!track || !startHandle || !endHandle) return;
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
    const trackBounds = track.getBoundingClientRect();
    const logicalMinute = edge === "start" ? safeStartMinute : safeEndMinute;
    const logicalCenter = trackBounds.left + (logicalMinute - railMinMinute) / span * trackBounds.width;
    const grabOffset = Math.abs(event.clientX - handleCenter) <= 14 ? event.clientX - logicalCenter : 0;
    dragRef.current = { pointerId: event.pointerId, edge, grabOffset, separated: handlesAreTight };
    setDraggingHandle(edge);
    event.currentTarget.setPointerCapture(event.pointerId);
    const minute = pointerMinute(event.clientX, grabOffset);
    if (minute !== null) updateEdge(edge, minute);
  }

  function movePointerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const minute = pointerMinute(event.clientX, drag.grabOffset);
    if (minute !== null) updateEdge(drag.edge, minute);
  }

  function finishPointerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDraggingHandle(null);
  }

  return <div className="time-range-rail">
    {showInputs && <div className="time-range-values" aria-label="选择开始和结束时间">
      <label><span>{startLabel}</span><input type="time" step={900} disabled={disabled} value={inputValues.start} aria-label={`输入${startLabel}`} aria-describedby={describedBy} onFocus={() => beginInput("start")} onChange={(event) => updateInput("start", event.target.value)} onBlur={finishInput} /></label>
      <label><span>{endLabel}</span><input type="time" step={900} disabled={disabled} value={inputValues.end} aria-label={`输入${endLabel}`} aria-describedby={describedBy} onFocus={() => beginInput("end")} onChange={(event) => updateInput("end", event.target.value)} onBlur={finishInput} /></label>
    </div>}
    <div className="time-rail-surface">
      <div className={`time-rail-track-wrap${handlesAreSeparated ? " handles-are-tight" : ""}${draggingHandle ? ` dragging-${draggingHandle}` : ""}${disabled ? " is-disabled" : ""}`} onPointerDown={startPointerDrag} onPointerMove={movePointerDrag} onPointerUp={finishPointerDrag} onPointerCancel={finishPointerDrag} onLostPointerCapture={finishPointerDrag}>
        <div ref={trackRef} className="time-rail-track" aria-hidden="true">
          {visibleSegments.map((segment, index) => <span key={`${segment.start}-${segment.end}-${index}`} className="time-rail-nonworking" aria-hidden="true" style={{ left: position(Math.max(segment.start, railMinMinute)), width: `calc(${position(Math.min(segment.end, railMaxMinute))} - ${position(Math.max(segment.start, railMinMinute))})` }} />)}
          <span className="time-rail-selection" style={{ left: position(safeStartMinute), width: `calc(${position(safeEndMinute)} - ${position(safeStartMinute)})` }} />
        </div>
        <input className="time-rail-range start" type="range" min={railMinMinute} max={railMaxMinute} step={15} value={safeStartMinute} disabled={disabled} aria-label={`调整${startLabel}，15 分钟步进，最短 ${minimumDuration} 分钟`} aria-valuemax={safeEndMinute - minimumDuration} aria-describedby={describedBy} onChange={(event) => updateStart(Number(event.target.value))} />
        <input className="time-rail-range end" type="range" min={railMinMinute} max={railMaxMinute} step={15} value={safeEndMinute} disabled={disabled} aria-label={`调整${endLabel}，15 分钟步进，最短 ${minimumDuration} 分钟`} aria-valuemin={safeStartMinute + minimumDuration} aria-describedby={describedBy} onChange={(event) => updateEnd(Number(event.target.value))} />
        <div className="time-rail-handles" aria-hidden="true">
          <span ref={startHandleRef} className="time-rail-handle start" style={{ left: position(safeStartMinute) }} />
          <span ref={endHandleRef} className="time-rail-handle end" style={{ left: position(safeEndMinute) }} />
        </div>
      </div>
      <div className="time-rail-scale" aria-hidden="true"><span>{minutesClock(railMinMinute)}</span><span>{minutesClock(Math.round((railMinMinute + span / 2) / 15) * 15)}</span><span>{minutesClock(railMaxMinute)}</span></div>
      {showPreference && visibleSegments.length > 0 && <small className="time-rail-preference">浅色区间仅表示非工作时间，仍可安排。</small>}
    </div>
  </div>;
}

function BlockEditorTimeRangeRail({
  start,
  end,
  onChange,
  segments = [],
  minMinute = 0,
  maxMinute = 23 * 60 + 59,
  startMinuteOffset = 0,
  endMinuteOffset = 0,
  minimumDuration = MIN_TASK_BLOCK_MINUTES,
  disabled = false,
  describedBy,
  showPresets = true
}: {
  start: string;
  end: string;
  onChange: (next: { start: string; end: string }) => void;
  segments?: TimeRailSegment[];
  minMinute?: number;
  maxMinute?: number;
  startMinuteOffset?: number;
  endMinuteOffset?: number;
  minimumDuration?: number;
  disabled?: boolean;
  describedBy?: string;
  showPresets?: boolean;
}) {
  const railStep = 5;
  const collapseThreshold = 4 * 60;
  const collapsedStartWidth = 31;
  const collapsedEndWidth = 31;
  const collapsedEndOffset = 100 - collapsedEndWidth;
  const trackRef = useRef<HTMLDivElement>(null);
  const startHandleRef = useRef<HTMLSpanElement>(null);
  const endHandleRef = useRef<HTMLSpanElement>(null);
  const editingInputRef = useRef<TimeRangeEdge | null>(null);
  const dragRef = useRef<{ pointerId: number; edge: TimeRangeEdge; grabOffset: number } | null>(null);
  const presentationRef = useRef<ReturnType<typeof focusedTimeRangePresentation> | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<TimeRangeEdge | null>(null);
  const [activeEdge, setActiveEdge] = useState<TimeRangeEdge | null>(null);
  const startMinute = startMinuteOffset + clockMinutes(start);
  const endMinute = endMinuteOffset + clockMinutes(end);
  const startDomainMin = Math.max(minMinute, startMinuteOffset);
  const startDomainMax = Math.min(maxMinute, startMinuteOffset + 23 * 60 + 59);
  const endDomainMin = Math.max(minMinute, endMinuteOffset);
  const endDomainMax = Math.min(maxMinute, endMinuteOffset + 23 * 60 + 59);
  const safeStartMinute = Math.max(startDomainMin, Math.min(startMinute, startDomainMax, endMinute - minimumDuration));
  const safeEndMinute = Math.min(endDomainMax, Math.max(endMinute, endDomainMin, safeStartMinute + minimumDuration));
  const displayClock = (minute: number) => minutesClock(((minute % (24 * 60)) + 24 * 60) % (24 * 60));
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
  const visibleWindows = collapsedPresentation
    ? [collapsedPresentation.startWindow, collapsedPresentation.endWindow]
    : [visibleWindow!];
  const visibleSegments = segments.filter((segment) => visibleWindows.some((window) => segment.end > window.start && segment.start < window.end));
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
    if (!validDraftClock(normalized)) {
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
    const localPosition = (minute: number) => windowPosition(minute, window, offset, width);
    return <Fragment key={`${window.start}-${window.end}-${offset}`}>
      <span className="time-rail-track-piece" aria-hidden="true" style={{ left: `${offset}%`, width: `${width}%` }} />
      {segments.filter((segment) => segment.end > window.start && segment.start < window.end).map((segment, index) => {
        const clippedStart = Math.max(segment.start, window.start);
        const clippedEnd = Math.min(segment.end, window.end);
        return <span key={`${window.start}-${segment.start}-${segment.end}-${index}`} className="time-rail-nonworking" aria-hidden="true" style={{ left: `${localPosition(clippedStart)}%`, width: `${localPosition(clippedEnd) - localPosition(clippedStart)}%` }} />;
      })}
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

  return <div className="time-range-rail block-editor">
    <div className="time-range-values block-editor-values" aria-label="选择开始和结束时间">
      <label className={highlightedEdge === "start" ? "is-active" : ""}><span><i className="time-range-marker start" aria-hidden="true" />开始</span><input type="text" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={5} disabled={disabled} value={inputValues.start} aria-label="输入开始时间" aria-describedby={describedBy} onFocus={(event) => { editingInputRef.current = "start"; setActiveEdge("start"); event.currentTarget.select(); }} onChange={(event) => setInputValues((current) => ({ ...current, start: sanitizeTimeInput(event.target.value) }))} onKeyDown={(event) => handleInputKeyDown(event, "start")} onBlur={() => { commitInput("start"); editingInputRef.current = null; setActiveEdge(null); }} /></label>
      <span className="time-range-connector" aria-hidden="true"><Icon name="chevron-right" size={14} /></span>
      <label className={highlightedEdge === "end" ? "is-active" : ""}><span><i className="time-range-marker end" aria-hidden="true" />结束</span><input type="text" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={5} disabled={disabled} value={inputValues.end} aria-label="输入结束时间" aria-describedby={describedBy} onFocus={(event) => { editingInputRef.current = "end"; setActiveEdge("end"); event.currentTarget.select(); }} onChange={(event) => setInputValues((current) => ({ ...current, end: sanitizeTimeInput(event.target.value) }))} onKeyDown={(event) => handleInputKeyDown(event, "end")} onBlur={() => { commitInput("end"); editingInputRef.current = null; setActiveEdge(null); }} /></label>
    </div>
    {describedBy && <small id={describedBy} className="sr-only">{collapsedPresentation
      ? <>拖动两侧端点 · 中间不可拖动</>
      : <>手写 1 分钟 · 时间轴与方向键 5 分钟 · 最短 15 分钟</>}</small>}
    <div className="time-rail-surface">
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
      {visibleSegments.length > 0 && <span className="sr-only">浅色区间表示非工作时间，仍可安排。</span>}
    </div>
    {showPresets && <div className="time-duration-presets" aria-label="快速设置时长"><span>时长</span>{[
      { minutes: 15, label: "15 分钟" },
      { minutes: 30, label: "30 分钟" },
      { minutes: 60, label: "1 小时" },
      { minutes: 120, label: "2 小时" }
    ].map((preset) => <button key={preset.minutes} type="button" disabled={disabled || safeStartMinute + preset.minutes > endDomainMax} onClick={() => setDuration(preset.minutes)}>{preset.label}</button>)}</div>}
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

function suggestedDraftAllocations(
  planDate: string,
  durationMinutes: number,
  availability: AvailabilitySettings | null,
  task: Task | undefined
) {
  if (durationMinutes < MIN_TASK_BLOCK_MINUTES) {
    return { allocations: [], remainingMinutes: durationMinutes, issue: "duration_too_short" as const };
  }
  const earliestDate = task?.earliest_start_at?.slice(0, 10);
  const dueDate = task?.due_at?.slice(0, 10);
  if ((earliestDate && earliestDate > planDate) || (dueDate && dueDate < planDate)) {
    return { allocations: [], remainingMinutes: durationMinutes, issue: "outside_task_range" as const };
  }
  const earliestMinute = task?.earliest_start_at?.slice(0, 10) === planDate
    ? clockMinutes(task.earliest_start_at.slice(11, 16))
    : 0;
  const dueMinute = task?.due_at?.slice(0, 10) === planDate
    ? clockMinutes(task.due_at.slice(11, 16))
    : 24 * 60;
  const preferredStart = availability ? clockMinutes(availability.workday_start) : 9 * 60;
  const startsAt = Math.max(earliestMinute, preferredStart);
  const endLimit = Math.min(dueMinute, 24 * 60);
  if (startsAt >= endLimit) {
    return { allocations: [], remainingMinutes: durationMinutes, issue: "outside_task_range" as const };
  }
  if (endLimit - startsAt < MIN_TASK_BLOCK_MINUTES) {
    return { allocations: [], remainingMinutes: durationMinutes, issue: "available_window_too_short" as const };
  }
  const scheduledMinutes = Math.min(durationMinutes, endLimit - startsAt);
  return {
    allocations: [{
      starts_at: planTimestamp(planDate, minutesClock(startsAt)),
      ends_at: planTimestamp(planDate, minutesClock(startsAt + scheduledMinutes)),
      estimated_minutes: scheduledMinutes
    }],
    remainingMinutes: durationMinutes - scheduledMinutes,
    issue: null
  };
}

function timelineLaneLayout<T extends { layoutKey: string; starts_at: string; ends_at: string }>(items: T[], selectedDate: string, drag: { key: string; start: number; end: number } | null = null) {
  return calculateTimelineLanes(items.map((item) => ({
    layoutKey: item.layoutKey,
    startMinute: timelineMinute(item.starts_at, selectedDate, "start"),
    endMinute: timelineMinute(item.ends_at, selectedDate, "end")
  })), drag ? { layoutKey: drag.key, startMinute: drag.start, endMinute: drag.end } : null);
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
  today, selectedDate, onSelectDate, tasks, recurringItems, recurringOccurrences, schedule, availability, loading, error, preview, busy,
  onIncludeTask, onRemoveBlock, onUpdatePlan, onSaveBlockTime, onConfirmPlan, onCancelPlan, onOpenTasks, onFactsChanged, onNotify, onNewTask, message,
  timelineReturnContext, onTimelineReturnHandled, visible
}: {
  today: string;
  selectedDate: string;
  onSelectDate: (date: string) => boolean;
  tasks: Task[];
  recurringItems: RecurringItem[];
  recurringOccurrences: RecurringOccurrence[];
  schedule: DaySchedule | null;
  availability: AvailabilitySettings | null;
  loading: boolean;
  error: string | null;
  preview: RulePlanPreview | null;
  busy: boolean;
  onIncludeTask: (task: Task, blocks: RulePlanBlock[]) => Promise<DaySchedule>;
  onRemoveBlock: (block: PlanBlock) => Promise<void>;
  onUpdatePlan: (preview: RulePlanPreview) => Promise<RulePlanPreview>;
  onSaveBlockTime: (block: PlanBlock, startsAt: string, endsAt: string) => Promise<void>;
  onConfirmPlan: () => void;
  onCancelPlan: () => Promise<boolean>;
  onOpenTasks: (taskId?: string, returnContext?: TimelineReturnContext) => void;
  onFactsChanged: (date?: string) => Promise<void>;
  onNotify: (label: string, message: string, icon?: IconName, undoId?: string, taskSeed?: TaskSeed) => void;
  onNewTask: (seed: TaskSeed) => void;
  visible: boolean;
  message: string;
  timelineReturnContext: TimelineReturnContext | null;
  onTimelineReturnHandled: () => void;
}) {
  const [monthKey, setMonthKey] = useState(selectedDate.slice(0, 7));
  const [monthSelectionPending, setMonthSelectionPending] = useState(false);
  const [todayView, setTodayView] = useState<"month" | "timeline">("timeline");
  const [calendarDateHint, setCalendarDateHint] = useState<{ date: string; left: number; top: number } | null>(null);
  const [selection, setSelection] = useState<TimelineSelection | null>(null);
  const [planDraftTimeEdit, setPlanDraftTimeEdit] = useState<PlanDraftTimeEdit | null>(null);
  const [executionDraft, setExecutionDraft] = useState<ExecutionDraft | null>(null);
  const [executionMessage, setExecutionMessage] = useState("");
  const [savingExecution, setSavingExecution] = useState(false);
  const [quickCompletingBlockId, setQuickCompletingBlockId] = useState<string | null>(null);
  const [includingTaskId, setIncludingTaskId] = useState<string | null>(null);
  const includingTaskRef = useRef(false);
  const [clock, setClock] = useState(() => new Date());
  const [followingNow, setFollowingNow] = useState(true);
  const [showReturnToNow, setShowReturnToNow] = useState(false);
  const [timelineTooltip, setTimelineTooltip] = useState<TimelineTooltipState | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const timelineCenteredDateRef = useRef<string | null>(null);
  const timelineEntryDateRef = useRef<string | null>(null);
  const returnToNowFrameRef = useRef(0);
  const timelineFloatingPanelRef = useRef<HTMLElement>(null);
  const timelineSelectionTriggerRef = useRef<HTMLElement | null>(null);
  const timelineSelectionAnchorRef = useRef<HTMLElement | null>(null);
  const [timelineDrag, setTimelineDrag] = useState<{ key: string; start: number; end: number; x: number; y: number } | null>(null);
  const [savingDraggedBlock, setSavingDraggedBlock] = useState(false);
  const timelineDragRef = useRef<{
    key: string; block: PlanBlock | RulePlanBlock; draftIndex: number | null; preview: RulePlanPreview | null;
    element: HTMLElement; pointerId: number; downY: number; downScroll: number; y: number; x: number;
    originalStart: number; duration: number; start: number; active: boolean; sourceLane: TimelineLane;
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
    }
  }, [visible]);
  const [timelineCreateRange, setTimelineCreateRange] = useState<TimelineCreateRange | null>(null);
  const cells = useMemo(() => calendarCells(monthKey), [monthKey]);

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
  const untimedRecurringOccurrences = recurringOccurrences.filter((item) => !item.display_time || !item.display_duration_minutes);
  const recurringTimelineBlocks = timedRecurringOccurrences.map((item) => {
    const starts_at = planTimestamp(selectedDate, item.display_time!);
    const ends_at = planTimestamp(selectedDate, minutesClock(clockMinutes(item.display_time!) + item.display_duration_minutes!));
    return { item, starts_at, ends_at, layoutKey: `recurring:${item.id}` };
  });
  const timelineItems = [
    ...timedEvents.map((event) => ({ ...event, layoutKey: `event:${event.id}`, timelineKind: "event" as const })),
    ...visibleTaskBlocks.map((block) => ({ ...block, layoutKey: `block:${block.id}`, timelineKind: "block" as const })),
    ...draftBlocks.map((block, index) => ({ ...block, layoutKey: draftLayoutKeys[index], timelineKind: "draft" as const })),
    ...recurringTimelineBlocks.map((block) => ({ ...block, layoutKey: block.layoutKey, timelineKind: "recurring" as const })),
    ...(timelineCreateRange ? [{ layoutKey: "create:selection", starts_at: planTimestamp(selectedDate, minutesClock(timelineCreateRange.start)), ends_at: planTimestamp(selectedDate, minutesClock(timelineCreateRange.end)), timelineKind: "create" as const }] : [])
  ];
  const timelineItemLanes = timelineLaneLayout(timelineItems, selectedDate, timelineDrag);
  const scheduledTaskIds = new Set(visibleTaskBlocks.map((block) => block.task_id));
  const draftTaskIds = new Set(draftBlocks.map((block) => block.task_id));
  const waitingTasks = tasks.filter((task) =>
    task.status !== "deleted"
    && ["open", "scheduled"].includes(task.status)
    && !taskSchedulingBoundaryIssue(task, selectedDate)
    && taskUnreservedMinutes(task) !== 0
    && !scheduledTaskIds.has(task.id)
    && !draftTaskIds.has(task.id)
  );
  const waitingPoolItems: RuleUnscheduledTask[] = preview?.unscheduled ?? waitingTasks.map((task) => ({
    task_id: task.id,
    task_title: task.title,
    reason: waitingTaskLabel(task),
    estimated_minutes: waitingTaskMinutes(task)
  }));
  const selectedBlock = selection?.kind === "block" ? taskBlocks.find((block) => block.id === selection.id) ?? null : null;
  const selectedEvent = selection?.kind === "event" ? fixedEvents.find((event) => event.id === selection.id) ?? null : null;
  const selectedTask = tasks.find((task) => task.id === selectedBlock?.task_id);
  const selectedTaskIsCrossDay = Boolean(selectedTask?.earliest_start_date && selectedTask.due_date && selectedTask.earliest_start_date < selectedTask.due_date);
  const resultDate = selectedBlock?.result_date ?? selectedDate;
  const selectedBlockCompletionAction = timelineTaskCompletionAction(selectedBlock, selectedTask, resultDate, today, clock.getTime());
  const selectedBlockDialog = selectedBlock ? timelineTaskDialogState(selectedBlock) : null;
  const canAdjustSelectedBlock = Boolean(selectedBlock && selectedBlock.execution_status === "planned" && !selectedBlock.review && selectedDate >= today && !selectedTask?.execution_locked && ["open", "scheduled"].includes(selectedBlock.task_status));
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
        : null;
  const todayMonthKey = today.slice(0, 7);
  const isAwayFromToday = selectedDate !== today || monthKey !== todayMonthKey;
  const monthTitle = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", timeZone: "Asia/Shanghai" })
    .format(new Date(`${monthKey}-01T00:00:00+08:00`));
  const selectedDateTitle = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Shanghai" })
    .format(new Date(`${selectedDate}T00:00:00+08:00`));
  const isPastDate = selectedDate < today;
  const hasConfirmedPlan = Boolean(schedule?.plan_id);
  const axisStart = 0;
  const axisEnd = 24 * 60;
  const timelineHours = Array.from({ length: 25 }, (_, index) => index);
  const pixelsPerHour = 72;
  const timelineHeight = 24 * pixelsPerHour;
  const shanghaiClock = shanghaiClockParts(clock);
  const nowMinute = shanghaiClock.hour * 60 + shanghaiClock.minute;
  const showNowLine = selectedDate === today && nowMinute >= axisStart && nowMinute <= axisEnd;
  const nowLabelOverlapDistance = 18;
  const weekDates = useMemo(() => weekDateValues(selectedDate), [selectedDate]);
  const selectedWeekday = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", weekday: "long" })
    .format(new Date(`${selectedDate}T00:00:00+08:00`));
  const selectedShortDateTitle = selectedDateTitle.replace(/^\d{4}年/, "");
  const selectedWeek = isoWeekParts(selectedDate);
  const headingContext = todayView === "month" ? `${monthTitle} · 月历总览`
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
  const nonWorkingTimeSegments = nonWorkingSegments(availability, selectedDate);
  const holidayCoverageAvailable = officialHolidayCoverageFor(`${monthKey}-01`);

  function showCalendarDateHint(date: string, target: HTMLElement) {
    const rect = target.getBoundingClientRect();
    setCalendarDateHint({ date, left: Math.max(100, Math.min(window.innerWidth - 100, rect.left + rect.width / 2)), top: Math.max(8, Math.min(window.innerHeight - 40, rect.top + 32)) });
  }

  useEffect(() => { setCalendarDateHint(null); }, [monthKey, selectedDate, todayView]);

  useEffect(() => {
    if (!calendarDateHint) return;
    const dismiss = () => setCalendarDateHint(null);
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [calendarDateHint]);

  function canDragTimelineBlock(block: PlanBlock | RulePlanBlock, draft = false) {
    const task = tasks.find((item) => item.id === block.task_id);
    return !isPastDate && !busy && !loading && !savingExecution && !quickCompletingBlockId
      && !includingTaskId && !timelineDragSavingRef.current && !planDraftTimeEdit
      && Boolean(task && ["open", "scheduled"].includes(task.status) && !task.execution_locked)
      && (draft || !preview && "execution_status" in block && block.execution_status === "planned"
        && !block.review && !block.execution_captured_at && !block.actual_minutes)
      && block.starts_at.slice(0, 10) === selectedDate
      && timeRangeDurationMinutes(block.starts_at, block.ends_at) >= MIN_TASK_BLOCK_MINUTES
      && timeRangeDurationMinutes(block.starts_at, block.ends_at) === timelineMinute(block.ends_at, selectedDate, "end") - timelineMinute(block.starts_at, selectedDate, "start");
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

  function beginTimelineDrag(event: ReactPointerEvent<HTMLElement>, block: PlanBlock | RulePlanBlock, draftIndex: number | null = null) {
    timelineDragClickRef.current = null;
    if (event.button !== 0 || event.pointerType !== "mouse" || !canDragTimelineBlock(block, draftIndex !== null)
      || (event.target instanceof Element && event.target.closest(".timeline-event-check"))) return;
    const scroller = timelineScrollRef.current;
    if (!scroller || timelineDragRef.current) return;
    event.preventDefault();
    pauseTimelineFollowing();
    const start = timelineMinute(block.starts_at, selectedDate, "start");
    timelineDragRef.current = {
      key: draftIndex === null ? `block:${(block as PlanBlock).id}` : draftLayoutKeys[draftIndex],
      block: { ...block }, draftIndex, preview, element: event.currentTarget, pointerId: event.pointerId,
      downY: event.clientY, downScroll: scroller.scrollTop, y: event.clientY, x: event.clientX,
      originalStart: start, duration: timeRangeDurationMinutes(block.starts_at, block.ends_at), start, active: false,
      sourceLane: timelineItemLanes[draftIndex === null ? `block:${(block as PlanBlock).id}` : draftLayoutKeys[draftIndex]]
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateTimelineDrag() {
    const current = timelineDragRef.current, scroller = timelineScrollRef.current;
    if (!current?.active || !scroller) return;
    const movement = (current.y - current.downY + scroller.scrollTop - current.downScroll) * 60 / pixelsPerHour;
    current.start = Math.max(0, Math.min(1440 - current.duration, Math.round((current.originalStart + movement) / 15) * 15));
    setTimelineDrag((previous) => previous?.key === current.key && previous.start === current.start
      && previous.x === current.x && previous.y === current.y ? previous
      : { key: current.key, start: current.start, end: current.start + current.duration, x: current.x, y: current.y });
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
    timelineDragSavingRef.current = true;
    setSavingDraggedBlock(true);
    const startsAt = dragTimestamp(current.start), endsAt = dragTimestamp(current.start + current.duration);
    try {
      if (current.draftIndex !== null && current.preview) {
        await onUpdatePlan({ ...current.preview, blocks: current.preview.blocks.map((block, index) => index === current.draftIndex
          ? { ...block, starts_at: startsAt, ends_at: endsAt } : block) });
      } else {
        await onSaveBlockTime(current.block as PlanBlock, startsAt, endsAt);
      }
    } catch (reason) {
      onNotify("时间未保存", `${planDraftErrorMessage(reason, tasks.find((task) => task.id === current.block.task_id) ?? null, selectedDate)} 原安排已保留。`, "review");
    } finally {
      timelineDragSavingRef.current = false;
      setSavingDraggedBlock(false); setTimelineDrag(null);
      if (current.element.isConnected) (current.element.querySelector<HTMLElement>(".timeline-event-body") ?? current.element).focus({ preventScroll: true });
      setTimelineTooltip(null);
    }
  }

  function draggedTimelineStyle(key: string, original: CSSProperties) {
    return timelineDrag?.key === key ? { ...original, "--timeline-top": `${timelineDrag.start / 60 * pixelsPerHour}px` } as CSSProperties : original;
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
    cancelTimelineDrag(); setTimelineDrag(null);
  }, [selectedDate, todayView, preview?.version, schedule]);

  useEffect(() => { setTimelineCreateRange(null); }, [selectedDate, todayView]);

  function showTimelineTooltipForTarget(content: TimelineTooltipContent, target: HTMLElement, anchorMode: TimelineTooltipAnchor) {
    if (timelineDragRef.current?.active || timelineDragSavingRef.current) return;
    const targetRect = target.getBoundingClientRect();
    const contentAnchor = anchorMode === "content"
      ? target.querySelector<HTMLElement>(".timeline-event-copy, .lane-copy, :scope > span")
      : null;
    const contentRect = contentAnchor?.getBoundingClientRect() ?? targetRect;
    const scrollRect = target.closest(".timeline-events") ? timelineScrollRef.current?.getBoundingClientRect() : null;
    const taskTooltip = content.kind === "普通任务" || content.kind === "单日任务" || content.kind === "多日任务" || content.kind === "重复事项";
    const tooltipHalfWidth = taskTooltip ? 165 : 148;
    const tooltipHeight = taskTooltip
      ? 86 + (content.url ? 36 : 0) + (content.note ? 76 : 0) + (content.detail ? 22 : 0)
      : 126;
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

  function hideTimelineTooltip() {
    setTimelineTooltip(null);
  }

  function timelineTooltipProps(content: TimelineTooltipContent, anchorMode: TimelineTooltipAnchor = "content") {
    return {
      "aria-describedby": "timeline-time-block-tooltip",
      onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => showTimelineTooltipForTarget(content, event.currentTarget, anchorMode),
      onPointerLeave: hideTimelineTooltip,
      onFocus: (event: React.FocusEvent<HTMLElement>) => showTimelineTooltipForTarget(content, event.currentTarget, anchorMode),
      onBlur: (event: React.FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hideTimelineTooltip();
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

  useEffect(() => () => {
    window.cancelAnimationFrame(returnToNowFrameRef.current);
  }, []);

  useEffect(() => {
    setSelection(null);
    setPlanDraftTimeEdit(null);
    setExecutionDraft(null);
    setExecutionMessage("");
    setTimelineTooltip(null);
  }, [selectedDate]);

  useEffect(() => {
    if (!timelineReturnContext) return;
    if (timelineReturnContext.date !== selectedDate) {
      onSelectDate(timelineReturnContext.date);
      return;
    }
    if (loading || (!schedule && !error)) return;
    setTodayView("timeline");
    setFollowingNow(false);
    setTimelineTooltip(null);
    setPlanDraftTimeEdit(null);
    const block = timelineReturnContext.blockId
      ? taskBlocks.find((item) => item.id === timelineReturnContext.blockId)
      : taskBlocks.find((item) => item.task_id === timelineReturnContext.taskId);
    if (!block) {
      onTimelineReturnHandled();
      return;
    }
    setSelection(null);
    setExecutionDraft(null);
    setExecutionMessage("");
    const frame = window.requestAnimationFrame(() => {
      const scroller = timelineScrollRef.current;
      const target = Array.from(scroller?.querySelectorAll<HTMLElement>("[data-timeline-kind][data-timeline-id]") ?? [])
        .find((candidate) => candidate.dataset.timelineKind === "block" && candidate.dataset.timelineId === block.id) ?? null;
      if (scroller && target) {
        (target.querySelector<HTMLElement>(".timeline-event-body") ?? target).focus({ preventScroll: true });
        target.dataset.returnLocated = "true";
        window.setTimeout(() => { delete target.dataset.returnLocated; }, 1800);
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
  }, [timelineReturnContext?.date, timelineReturnContext?.blockId, timelineReturnContext?.taskId, selectedDate, loading, error, schedule]);

  useEffect(() => {
    if (!timelineTooltip) return;
    const dismiss = () => setTimelineTooltip(null);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [timelineTooltip]);

  useEffect(() => {
    if (!preview && selection?.kind === "draft") {
      setSelection(null);
      setPlanDraftTimeEdit(null);
    }
  }, [preview, selection?.kind]);

  useEffect(() => {
    if (!selection) return;
    const frame = window.requestAnimationFrame(() => timelineFloatingPanelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [selection?.kind, selection?.id]);

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
    if (!selection || savingExecution) return;
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
  }, [selection, savingExecution]);

  useEffect(() => {
    if (!visible || todayView !== "timeline") return;
    const returnToMonthOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || selection) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable)) return;
      setTimelineTooltip(null);
      setTodayView("month");
    };
    window.addEventListener("keydown", returnToMonthOnEscape);
    return () => window.removeEventListener("keydown", returnToMonthOnEscape);
  }, [todayView, selection, visible]);

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

  function returnToday() {
    if (selectedDate === today) {
      setMonthKey(todayMonthKey);
      setMonthSelectionPending(false);
      return;
    }
    selectCalendarDate(today);
  }

  function selectCalendarDate(date: string) {
    if (!onSelectDate(date)) return false;
    setMonthSelectionPending(false);
    if (date.slice(0, 7) !== monthKey) setMonthKey(date.slice(0, 7));
    return true;
  }

  function openTimelineDate(date: string) {
    if (!selectCalendarDate(date)) return;
    timelineEntryDateRef.current = date;
    timelineCenteredDateRef.current = null;
    setClock(new Date());
    setFollowingNow(date === today);
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

  async function removeSelectedBlock() {
    if (!selectedBlock || !canAdjustSelectedBlock || busy || loading || savingExecution || quickCompletingBlockId || savingDraggedBlock || timelineDrag || preview) return;
    try {
      await onRemoveBlock(selectedBlock);
      closeTimelinePanel();
    } catch (reason) {
      onNotify("安排未移除", uiErrorMessage(reason), "review");
    }
  }

  async function removePlanDraftBlock(edit: PlanDraftTimeEdit | null = planDraftTimeEdit) {
    if (busy) return;
    if (edit?.sourceBlockId && !preview) {
      const block = taskBlocks.find((item) => item.id === edit.sourceBlockId);
      if (!block) return;
      try {
        await onRemoveBlock({ ...block,
          starts_at: edit.sourceStartsAt ?? block.starts_at,
          ends_at: edit.sourceEndsAt ?? block.ends_at
        });
        closeTimelinePanel();
      } catch (reason) {
        onNotify("安排未移除", uiErrorMessage(reason), "review");
      }
      return;
    }
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

  function revealTimelineBlock(kind: "draft" | "block", id: string) {
    setFollowingNow(false);
    window.requestAnimationFrame(() => {
      const scroller = timelineScrollRef.current;
      const target = scroller?.querySelector<HTMLElement>(`[data-timeline-kind="${kind}"][data-timeline-id="${id}"]`);
      if (!scroller || !target) return;
      const scrollerRect = scroller.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const desiredTop = scroller.scrollTop + targetRect.top - scrollerRect.top - (scroller.clientHeight - targetRect.height) / 2;
      const nextTop = Math.max(0, Math.min(desiredTop, scroller.scrollHeight - scroller.clientHeight));
      scroller.scrollTo({
        top: nextTop,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
      (target.querySelector<HTMLElement>(".timeline-event-body") ?? target).focus({ preventScroll: true });
      setTimelineTooltip(null);
    });
  }

  async function includeUnscheduledTask(
    item: RuleUnscheduledTask,
    sourcePreview: RulePlanPreview | null = preview,
    trigger?: HTMLButtonElement
  ) {
    if (!item.estimated_minutes) return;
    const task = tasks.find((candidate) => candidate.id === item.task_id);
    const boundaryIssue = taskSchedulingBoundaryIssue(task, selectedDate);
    if (boundaryIssue) {
      onNotify("当前日期不能安排", boundaryIssue, "clock");
      return;
    }
    const preferredMinutes = preferredDailyAllocationMinutes(task, item.estimated_minutes);
    const suggested = suggestedDraftAllocations(selectedDate, preferredMinutes, availability, task);
    if (suggested.issue) {
      const message = suggested.issue === "duration_too_short"
        ? `剩余 ${item.estimated_minutes} 分钟，不足 ${MIN_TASK_BLOCK_MINUTES} 分钟，请调整工作量`
        : suggested.issue === "available_window_too_short"
          ? `当天可用时间不足 ${MIN_TASK_BLOCK_MINUTES} 分钟，请调整时间或更换日期`
          : "请调整任务时间或更换日期";
      onNotify("无法安排", message, "clock");
      return;
    }
    const scheduledMinutes = preferredMinutes - suggested.remainingMinutes;
    const newBlocks: RulePlanBlock[] = suggested.allocations.map((allocation) => ({
      task_id: item.task_id,
      task_title: item.task_title,
      ...allocation
    }));
    const remainingMinutes = Math.max(item.estimated_minutes, task ? taskUnreservedMinutes(task) ?? 0 : 0) - scheduledMinutes;
    try {
      if (!sourcePreview) {
        if (!task) return;
        const saved = await onIncludeTask(task, newBlocks);
        const first = saved.task_blocks.find((block) => block.task_id === task.id
          && block.starts_at === newBlocks[0]?.starts_at && block.ends_at === newBlocks[0]?.ends_at);
        if (first) {
          if (trigger) timelineSelectionTriggerRef.current = trigger;
          timelineSelectionAnchorRef.current = null;
          setSelection(null);
          setPlanDraftTimeEdit(null);
          revealTimelineBlock("block", first.id);
        }
        return;
      }
      const unscheduled = sourcePreview.unscheduled.filter((candidate) => candidate.task_id !== item.task_id);
      const saved = await onUpdatePlan({
        ...sourcePreview,
        blocks: [...sourcePreview.blocks, ...newBlocks],
        unscheduled
      });
      const firstBlock = newBlocks[0];
      const blockIndex = firstBlock ? saved.blocks.findIndex((block) =>
        block.task_id === firstBlock.task_id
        && block.starts_at === firstBlock.starts_at
        && block.ends_at === firstBlock.ends_at
      ) : -1;
      if (blockIndex >= 0) {
        if (trigger) timelineSelectionTriggerRef.current = trigger;
        timelineSelectionAnchorRef.current = null;
        setSelection(null);
        setPlanDraftTimeEdit(null);
        setTimelineTooltip(null);
        revealTimelineBlock("draft", String(blockIndex));
      }
      onNotify(
        "已加入计划草案",
        remainingMinutes > 0
          ? `已安排 ${scheduledMinutes} 分钟，剩余 ${remainingMinutes} 分钟`
          : "",
        "check"
      );
    } catch (reason) {
      onNotify(sourcePreview ? "未加入草案" : "未加入时间线", planDraftErrorMessage(reason, task ?? null, selectedDate), "review");
    }
  }

  async function includeWaitingTask(task: Task, trigger: HTMLButtonElement) {
    if (isPastDate || busy || includingTaskRef.current) return;
    const estimatedMinutes = preview?.unscheduled.find((item) => item.task_id === task.id)?.estimated_minutes ?? taskUnreservedMinutes(task);
    if (!estimatedMinutes) {
      onOpenTasks(task.id);
      return;
    }
    includingTaskRef.current = true;
    setIncludingTaskId(task.id);
    try {
      const item = preview ? preview.unscheduled.find((candidate) => candidate.task_id === task.id)
        : { task_id: task.id, task_title: task.title, estimated_minutes: estimatedMinutes, reason: "待安排" };
      if (!item?.estimated_minutes) {
        onNotify("无法加入时间线", "任务或计划已变化，请刷新后重试", "review");
        return;
      }
      await includeUnscheduledTask(item, preview, trigger);
    } finally {
      includingTaskRef.current = false;
      setIncludingTaskId(null);
    }
  }

  function closeTimelinePanel() {
    if (savingExecution) return;
    setSelection(null);
    setPlanDraftTimeEdit(null);
    timelineSelectionAnchorRef.current = null;
    window.requestAnimationFrame(() => {
      const trigger = timelineSelectionTriggerRef.current;
      if (trigger?.isConnected) trigger.focus();
      else timelineScrollRef.current?.focus();
    });
  }

  function openTimelineTask(taskId: string, blockId: string) {
    if (savingExecution) return;
    setSelection(null);
    setPlanDraftTimeEdit(null);
    setTimelineTooltip(null);
    timelineSelectionAnchorRef.current = null;
    onOpenTasks(taskId, { date: selectedDate, blockId });
  }

  function pauseTimelineFollowing() {
    timelineEntryDateRef.current = null;
    if (selectedDate === today && followingNow) setFollowingNow(false);
  }

  function resumeTimelineFollowing() {
    setClock(new Date());
    setShowReturnToNow(false);
    setFollowingNow(true);
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
    if (!canCaptureTaskResult(selectedDate, today, selectedBlock, Date.now())) {
      setExecutionMessage(historicalBlockCompletionLocked(resultDate, selectedBlock, Date.now()) ? HISTORY_COMPLETION_LOCKED_MESSAGE : "已超过结果修改时间");
      return;
    }
    if (!executionDraft.outcome) { setExecutionMessage("请选择任务结果。"); return; }
    if (executionDraft.wholeTask && (!selectedTaskIsCrossDay || !selectedTask || !taskResultEditable(selectedTask, Date.now()))) {
      setExecutionMessage("任务已变化，请关闭后重新打开。");
      return;
    }
    setSavingExecution(true);
    setExecutionMessage("");
    try {
      let undoId: string | undefined;
      if (executionDraft.wholeTask && selectedTask) {
        await completeTask(selectedTask.id, null, executionDraft.note.trim() || null);
      } else if (resultDate === resultToday(Date.now())) {
        const input = taskExecutionResolution(selectedBlock, selectedTask, executionDraft.outcome, executionDraft.note);
        const previousUndo = input.outcome === "completed" ? await latestUndo().catch(() => null) : null;
        await resolveTaskExecution(resultDate, input);
        if (input.outcome === "completed") {
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
      onNotify(executionDraft.wholeTask ? "整个任务已完成" : incomplete ? "未完成结果已保存" : "当天结果已保存", "", "check", undoId, seed);
    } catch (reason) { setExecutionMessage(`未保存：${uiErrorMessage(reason)}`); }
    finally { setSavingExecution(false); }
  }

  async function quickCompleteTimelineBlock(block: PlanBlock) {
    if (quickCompletingBlockId || savingExecution || busy || loading || preview || savingDraggedBlock || timelineDrag) return;
    const task = tasks.find((task) => task.id === block.task_id);
    const action = timelineTaskCompletionAction(block, task, selectedDate, today, Date.now());
    if (!action) return;
    setQuickCompletingBlockId(block.id);
    try {
      if (action === "complete-block" || action === "uncomplete-block") {
        const canOfferUndo = action === "complete-block" && selectedDate === resultToday(Date.now());
        const previousUndo = canOfferUndo ? await latestUndo().catch(() => null) : null;
        if (action === "uncomplete-block") {
          await clearExecutionCapture(selectedDate, block.id);
        } else {
          await saveExecutionCapture(selectedDate, {
            plan_block_id: block.id, outcome: "completed", note: block.review?.notes ?? block.execution_note ?? null
          });
        }
        const undo = canOfferUndo ? await latestUndo().catch(() => null) : null;
        const undoId = undo?.target_type === "execution_capture" && undo.target_id === block.task_id && undo.id !== previousUndo?.id ? undo.id : undefined;
        await onFactsChanged();
        onNotify(action === "complete-block" ? "当天已完成" : task?.status === "done" && task.earliest_start_date && task.due_date && task.earliest_start_date < task.due_date ? "已取消当天及整体完成" : "已取消当天完成", "", "check", undoId);
      } else if (action === "clear") {
        await clearExecutionCapture(selectedDate, block.id);
        await onFactsChanged();
        onNotify(selectedDate < resultToday(Date.now()) ? "已取消本次未完成" : "已取消未完成", "", "check");
      }
    } catch (reason) { onNotify(action === "uncomplete-block" ? "未取消本次完成" : action === "complete-block" ? "当天结果未保存" : "未取消未完成", uiErrorMessage(reason), "review"); }
    finally { setQuickCompletingBlockId(null); }
  }


  return (
    <section className="next-page today-page" aria-label="今日">
      {message && <p className="page-status" role="status">{message}</p>}
      <div className={`timeline-page-shell${todayView === "timeline" ? " is-timeline-view" : ""}`}>
        <h1 className="sr-only">{windowTitle}</h1>
        {todayView === "timeline" && <header className="timeline-design-topbar">
          <div className="timeline-heading">
            <div className="timeline-date-copy"><h2 className="timeline-day-title">{selectedDateTitle}</h2><div className="timeline-date-meta timeline-day-subline"><span>{selectedWeekday}</span>{selectedLunarDate && <><i aria-hidden="true">·</i><span>农历{selectedLunarDate}</span></>}{selectedSolarTerm && <span className="timeline-term-chip">{selectedSolarTerm}</span>}</div></div>
          </div>
          <div className="timeline-top-actions">
            {isAwayFromToday && <button type="button" className="quiet-button" onClick={returnToday}>回到今天</button>}
            {todayView === "timeline" && (preview ? <div className="plan-draft-top-actions" aria-label="日计划草案操作">
              <span className="plan-draft-mode"><i />计划待确认</span>
              <button type="button" className="quiet-button" disabled={busy} onClick={() => void onCancelPlan()}>放弃草案</button>
              <button type="button" className="primary-action" disabled={busy || (!isAdjustingConfirmedPlan && preview.blocks.length === 0)} onClick={onConfirmPlan}>{busy ? "正在保存…" : "确认计划"}</button>
            </div> : hasConfirmedPlan && !isPastDate ? <div className="confirmed-plan-actions" aria-label="已确认计划状态"><span className="confirmed-plan-status"><Icon name="check" size={13} />计划已确认</span></div> : null)}
            {todayView === "timeline" && <CalendarOverviewButton onClick={returnToMonth} />}
          </div>
        </header>}

        {todayView === "month" ? <main className="today-month-view" aria-label={monthTitle}>
          <section className="month-sheet today-month-sheet">
            <div className="month-controls">
              <div aria-hidden="true" />
              <div className="month-heading"><div className="month-title-row"><button type="button" aria-label="上一个月" onClick={() => moveMonth(-1)}><Icon name="chevron-left" size={17} /></button><strong>{monthTitle}</strong><button type="button" aria-label="下一个月" onClick={() => moveMonth(1)}><Icon name="chevron-right" size={17} /></button></div><div className="timeline-date-meta calendar-month-details">{monthSelectionPending ? <span>选择一天查看安排</span> : <><span className="home-selected-date">{selectedShortDateTitle}</span><i aria-hidden="true">·</i><span>{selectedWeekday}</span>{selectedLunarDate && <><i aria-hidden="true">·</i><span>农历{selectedLunarDate}</span></>}{selectedSolarTerm && <span className="timeline-term-chip">{selectedSolarTerm}</span>}</>}</div></div>
              <div className="month-actions">{isAwayFromToday && <button type="button" className="quiet-button" onClick={returnToday}>回到今天</button>}</div>
            </div>
            {!holidayCoverageAvailable && <div className="holiday-coverage missing" role="status">当前月份暂无法定节假日和调休信息；农历与节气仍可显示</div>}
            <div className="weekday-row">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>周{day}</span>)}</div>
            <div className="month-grid" role="grid" aria-label={monthTitle}>{cells.map((cell) => {
              const dayTasks = tasks.filter((task) => task.status !== "deleted" && taskAppearsOnDate(task, cell.key));
              const count = dayTasks.length;
              const recurringCount = recurringItems.filter((item) => recurringItemAppearsOnDate(item, cell.key)).length;
              const completeOnly = count > 0 && dayTasks.every((task) => task.status === "done");
              const dayInfo = calendarDayInfo(cell.key);
              const lunarLabel = lunarDayLabel(cell.key);
              const workStateLabel = dayInfo?.workState === "rest" ? "休" : dayInfo?.workState === "work" ? "班" : "";
              const solarTerm = dayInfo?.solarTerm ?? dayInfo?.labels.find((label) => label.kind === "solar-term")?.text;
              const otherLabels = dayInfo?.labels.filter((label) => label.kind !== "solar-term") ?? [];
              const calendarLabel = dayInfo?.labels.map((label) => label.text).join("、") ?? "";
              return <button key={cell.key} type="button" role="gridcell" aria-selected={selectedDate === cell.key} aria-describedby={calendarDateHint?.date === cell.key ? "calendar-date-open-hint" : undefined} aria-label={`${cell.key}${lunarLabel ? `，农历${lunarLabel}` : ""}${calendarLabel ? `，${calendarLabel}` : ""}${workStateLabel ? `，${workStateLabel === "休" ? "放假" : "调休上班"}` : ""}${count ? `，${count} 项任务` : ""}${recurringCount ? `，${recurringCount} 项重复事项` : ""}`} className={`${cell.inMonth ? "in-month" : "outside"}${cell.key === today ? " today" : ""}${selectedDate === cell.key ? " selected" : ""}${dayInfo?.workState ? ` ${dayInfo.workState}` : ""}${count ? " has-tasks" : ""}${recurringCount ? " has-recurring-items" : ""}`} onPointerEnter={(event) => showCalendarDateHint(cell.key, event.currentTarget)} onPointerLeave={() => setCalendarDateHint(null)} onFocus={(event) => showCalendarDateHint(cell.key, event.currentTarget)} onBlur={() => setCalendarDateHint(null)} onClick={() => { setCalendarDateHint(null); selectCalendarDate(cell.key); }} onDoubleClick={() => openTimelineDate(cell.key)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); openTimelineDate(cell.key); } }}>
                <span className="calendar-day-head"><span className="day-number"><span className="solar-day-number">{cell.day}</span>{lunarLabel && <span className="lunar-day-number">{lunarLabel}</span>}</span>{workStateLabel && <span className={`work-state ${dayInfo?.workState}`}>{workStateLabel}</span>}</span>
                {solarTerm && <span className="calendar-solar-term">{solarTerm}</span>}
                {otherLabels.length ? <span className="calendar-labels">{otherLabels.map((label) => <span key={`${label.kind}:${label.text}`} className={`calendar-label ${label.kind}`}>{label.text}</span>)}</span> : null}
                {count > 0 || recurringCount > 0 ? <span className="calendar-indicators" aria-hidden="true">
                  {count > 0 && <span className={completeOnly ? "task-indicator complete" : "task-indicator"}><i />{count}<span>项</span></span>}
                  {recurringCount > 0 && <span className="task-indicator recurring"><Icon name="restore" size={10} />{recurringCount}<span>项</span></span>}
                </span> : null}
              </button>;
            })}</div>
          </section>
        </main> : <main className={`timeline-main${error || loading ? " is-status" : ""}${preview ? " is-plan-draft" : ""}`} aria-label={`${selectedDateTitle}时间线`}>
          {error ? <div className="timeline-state"><strong>这一天暂时无法打开</strong><span>{error}</span><button type="button" className="quiet-button" onClick={() => void onFactsChanged()}>重试</button></div> : loading ? <div className="timeline-state">正在载入这一天的安排…</div> : <>
            <div className="timeline-week" role="group" aria-label="本周日期">{weekDates.map((date) => {
              const dateValue = new Date(`${date}T00:00:00+08:00`);
              const weekday = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", weekday: "short" }).format(dateValue).replace("周", "");
              const lunarLabel = lunarDayLabel(date);
              const isWeekend = weekday === "六" || weekday === "日";
              const dayInfo = calendarDayInfo(date);
              const workStateLabel = dayInfo?.workState === "rest" ? "休" : dayInfo?.workState === "work" ? "班" : "";
              const calendarLabels = dayInfo?.labels.map((label) => label.text).join("、") ?? "";
              const primaryCalendarLabel = dayInfo?.labels[0] ?? null;
              return <button key={date} type="button" className={`${isWeekend ? "weekend " : ""}${date === today ? "today " : ""}${date === selectedDate ? "selected " : ""}${dayInfo?.workState ? dayInfo.workState : ""}`.trim()} aria-pressed={date === selectedDate} aria-current={date === today ? "date" : undefined} aria-label={`${date}，星期${weekday}${lunarLabel ? `，农历${lunarLabel}` : ""}${calendarLabels ? `，${calendarLabels}` : ""}${workStateLabel ? `，${workStateLabel === "休" ? "放假" : "调休上班"}` : ""}`} onClick={() => selectCalendarDate(date)}>
                <span className="timeline-week-heading"><small>{weekday}</small>{workStateLabel && <span className={`work-state ${dayInfo?.workState}`}>{workStateLabel}</span>}</span>
                <span className="timeline-week-date"><strong>{Number(date.slice(8, 10))}</strong></span>
                <span className="timeline-week-calendar-meta" aria-hidden="true">
                  {primaryCalendarLabel ? <span className={`calendar-label ${primaryCalendarLabel.kind}`}>{primaryCalendarLabel.text}</span> : lunarLabel && <span>{lunarLabel}</span>}
                </span>
              </button>;
            })}</div>
            {preview && <div className="plan-draft-summary" role="status"><span><Icon name="sparkle" size={14} /><strong>{preview.blocks.length} 项草案安排</strong>{preview.unscheduled.length > 0 && <> · {preview.unscheduled.length} 项未排入</>}</span></div>}
            <div className="timeline-lanes">
              {untimedRecurringOccurrences.length > 0 && <section className="recurring-occurrence-lane" aria-label="当天的重复事项"><h2>重复事项</h2><div>{untimedRecurringOccurrences.map((item) => {
                const { url, body } = splitTaskNotes(item.notes ?? "");
                return <div key={item.id} className="lane-item recurring" role="note" tabIndex={0} {...timelineTooltipProps({ kind: "重复事项", title: item.title, time: "时间未指定", detail: "按规则展示，无需勾选或复核", tone: "recurring", url, note: body })}><span className="lane-symbol recurring" aria-hidden="true" /><span className="lane-copy"><strong>{item.title}</strong><small>时间未指定</small></span></div>;
              })}</div></section>}
              <section className="waiting-task-lane waiting-task-pool" aria-label="待安排池"><h2><Icon name="tasks" size={15} />待安排池<span className="waiting-pool-count">{waitingPoolItems.length}</span></h2><div>{waitingPoolItems.length ? waitingPoolItems.map((item) => {
                const task = tasks.find((candidate) => candidate.id === item.task_id);
                const suggestedMinutes = item.estimated_minutes ? preferredDailyAllocationMinutes(task, item.estimated_minutes) : null;
                const actionLabel = suggestedMinutes ? "加入时间线" : "补充估时";
                return <div key={item.task_id} className="waiting-pool-task" {...timelineTooltipProps({
                  kind: "待安排任务",
                  title: item.task_title,
                  time: isPastDate ? "历史任务" : suggestedMinutes ? `建议当天安排 ${suggestedMinutes} 分钟` : "尚未估时",
                  detail: isPastDate ? "前往任务列表处理；历史单日任务完成时，会按有效起止时间自动补入当天时间线，无需重复添加。" : waitingTaskTooltipDetail(task, item.reason),
                  tone: "task"
                })}>
                  <button type="button" className="waiting-pool-open" aria-label={`打开任务：${item.task_title}`} disabled={busy || includingTaskId !== null} onClick={() => onOpenTasks(item.task_id)}><span className={`waiting-pool-dot priority-${task?.priority ?? "unset"}`} aria-hidden="true" /><strong>{item.task_title}</strong><span className="waiting-pool-estimate">{suggestedMinutes ? `预计 ${suggestedMinutes}m` : "未估时"}</span></button>
                  <button type="button" className="waiting-pool-add" title={isPastDate ? "前往任务列表完成，自动补录历史单日任务块" : actionLabel} disabled={busy || includingTaskId !== null || !task} aria-busy={includingTaskId === item.task_id} aria-label={isPastDate ? `前往任务列表处理“${item.task_title}”` : suggestedMinutes ? `将“${item.task_title}”加入时间线` : `打开“${item.task_title}”并补充预计时长`} onClick={(event) => { if (!task) return; if (isPastDate) onOpenTasks(task.id); else void includeWaitingTask(task, event.currentTarget); }}><Icon name={isPastDate ? "external-link" : "plus"} size={12} /></button>
                </div>;
              }) : <span className="timeline-lane-empty">暂无待安排任务</span>}</div></section>
            </div>
            <div ref={timelineScrollRef} className="timeline-scroll" tabIndex={0} aria-label="24 小时时间线" onScroll={handleTimelineScroll} onWheel={pauseTimelineFollowing} onTouchMove={pauseTimelineFollowing} onPointerDown={(event) => { if (event.currentTarget === event.target) pauseTimelineFollowing(); }} onKeyDown={handleTimelineScrollKey}>
              {selectedDate === today && showReturnToNow && <div className="return-to-now-layer"><button type="button" onClick={resumeTimelineFollowing}><Icon name="clock" size={14} />回到现在</button></div>}
              {selection && <div className={`timeline-floating-layer${planDraftTimeEdit ? " is-time-editor" : selectedBlock ? " is-block-editor" : ""}`}><section id="timeline-context-panel" ref={timelineFloatingPanelRef} className={`timeline-floating-panel${planDraftTimeEdit ? " plan-draft-editor" : selectedBlock ? " task-block-editor" : ""}`} role="dialog" aria-modal={planDraftTimeEdit || selectedBlock ? true : undefined} aria-label={planDraftTimeEdit && (selectedDraftBlock || selectedBlock) ? `${selectedDraftBlock?.task_title ?? selectedBlock?.task_title}时间调整` : selectedBlock ? `${selectedBlock.task_title}任务结果` : selectedEvent ? `${selectedEvent.title}日程详情` : "时间线详情"} aria-live="polite" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") closeTimelinePanel(); }}>
                {planDraftTimeEdit && (selectedDraftBlock || selectedBlock) ? <>
                  <header><div className="timeline-panel-heading">{planDraftTimeEdit.sourceBlockId && <button type="button" className="timeline-panel-back" aria-label="返回任务块详情" title="返回任务块详情" disabled={busy} onClick={returnToSelectedBlockDetails}><Icon name="chevron-left" size={16} /></button>}<div className="timeline-panel-heading-copy"><strong>调整时间</strong><small>{selectedDraftBlock?.task_title ?? selectedBlock?.task_title}</small></div></div>{(planDraftTimeEdit.starts_at !== planDraftTimeEdit.original_starts_at || planDraftTimeEdit.ends_at !== planDraftTimeEdit.original_ends_at) && <button type="button" className="timeline-time-reset" aria-label="重置为调整前的时间" title="重置为调整前的时间" disabled={busy} onClick={resetPlanDraftTime}><Icon name="restore" size={14} />重置时间</button>}<button type="button" aria-label="关闭时间调整面板" onClick={closeTimelinePanel}><Icon name="close" size={15} /></button></header>
                  <form className="plan-draft-time-form" noValidate onSubmit={(event) => void savePlanDraftTime(event)}>
                    <div className="plan-draft-time-fields"><BlockEditorTimeRangeRail start={planDraftTimeEdit.starts_at} end={planDraftTimeEdit.ends_at} segments={nonWorkingTimeSegments} disabled={busy} describedBy="plan-draft-sync-note" minimumDuration={MIN_TASK_BLOCK_MINUTES} onChange={(next) => setPlanDraftTimeEdit({ ...planDraftTimeEdit, starts_at: next.start, ends_at: next.end, error: "" })} /></div>
                    {planDraftTimeEdit.error && <span className="plan-draft-edit-error" role="alert">{planDraftTimeEdit.error}</span>}
                    <footer><button type="button" className="execution-remove-today" disabled={busy} onClick={() => void removePlanDraftBlock()}><Icon name="trash" size={14} />从今日计划移除</button><div><button type="button" className="quiet-button" disabled={busy} onClick={closeTimelinePanel}>取消</button><button type="submit" className="primary-action" disabled={busy}>{busy ? "正在保存…" : "保存调整"}</button></div></footer>
                  </form>
                </> : selectedBlock ? <><header><div className="execution-dialog-heading"><strong>{selectedBlock.task_title}</strong><span className={`execution-status-badge status-${selectedBlockDialog!.status}`}>{selectedBlockDialog!.label}</span></div><button type="button" aria-label="关闭执行面板" disabled={savingExecution || Boolean(quickCompletingBlockId)} onClick={closeTimelinePanel}><Icon name="close" size={15} /></button></header>
                  <div className="execution-plan-time"><div className="execution-plan-fact"><span>计划时间</span>{canAdjustSelectedBlock ? <button type="button" className="execution-time-value" aria-label={`调整计划时间：${timeRangeLabel(selectedBlock.starts_at, selectedBlock.ends_at)}`} disabled={busy || loading || savingExecution || Boolean(quickCompletingBlockId)} onClick={adjustSelectedBlockTime}><Icon name="clock" size={14} /><strong>{timeRangeLabel(selectedBlock.starts_at, selectedBlock.ends_at)}</strong></button> : <div className="execution-time-value"><Icon name="clock" size={14} /><strong>{timeRangeLabel(selectedBlock.starts_at, selectedBlock.ends_at)}</strong></div>}</div><div className="execution-plan-actions"><button type="button" className="execution-open-task" disabled={savingExecution || Boolean(quickCompletingBlockId)} onClick={() => openTimelineTask(selectedBlock.task_id, selectedBlock.id)}>查看任务<Icon name="external-link" size={12} /></button></div></div>
                  {selectedBlock.review && !canRecordSelectedBlock ? <>
                    <div className={`floating-facts execution-${selectedBlock.review.outcome}`}><div><span>任务结果</span><strong>{reviewOutcomeCopy[selectedBlock.review.outcome]}</strong></div>{selectedBlock.review.followup_action && <div><span>下一步</span><strong>{taskNextActionLabels[selectedBlock.review.followup_action]}</strong></div>}{selectedBlock.review.actual_minutes !== null && <div><span>实际耗时</span><strong>{selectedBlock.review.actual_minutes} 分钟</strong></div>}{selectedBlock.review.remaining_workload_minutes !== null && <div><span>剩余工作量</span><strong>{selectedBlock.review.remaining_workload_minutes} 分钟</strong></div>}{selectedBlock.review.notes && <div className="wide"><span>备注</span><strong>{selectedBlock.review.notes}</strong></div>}{selectedBlock.review.defer_reason && <div className="wide"><span>原因</span><strong>{selectedBlock.review.defer_reason}</strong></div>}</div>
                    {selectedBlock.execution_note && selectedBlock.execution_note !== selectedBlock.review.notes && <p className="execution-capture-note">{selectedBlock.execution_note}</p>}
                    <p className="execution-capture-note" role="status">{historicalBlockCompletionLocked(selectedDate, selectedBlock, clock.getTime()) ? HISTORY_COMPLETION_LOCKED_MESSAGE : "已超过结果修改时间"}</p>
                  </> : !canRecordSelectedBlock ? <>
                    {selectedBlock.execution_status !== "planned" && <div className={`floating-capture-fact execution-${selectedBlock.execution_status}`}><span>本次结果</span><strong>{reviewOutcomeCopy[selectedBlock.execution_status]}</strong>{selectedBlock.execution_note && <p>{selectedBlock.execution_note}</p>}</div>}
                    <div className="floating-readonly"><strong>{selectedBlock.task_status === "deleted" ? "任务已移入回收站" : selectedDate > today ? "未来安排暂不可记录" : historicalBlockCompletionLocked(selectedDate, selectedBlock, clock.getTime()) ? HISTORY_COMPLETION_LOCKED_MESSAGE : "已超过结果修改时间"}</strong><span>{selectedBlock.task_status === "deleted" ? "仅查看已有记录。" : selectedDate > today ? "到执行日期后再记录任务结果。" : "已有记录保持只读。"}</span></div>
                  </> : executionDraft ? <>
                    <ExecutionCaptureFields key={selectedBlock.id} draft={executionDraft} disabled={savingExecution || busy || Boolean(quickCompletingBlockId)} onChange={updateExecutionDraft}
                      onCompleteTask={selectedTaskIsCrossDay && selectedTask && ["open", "scheduled", "done"].includes(selectedTask.status) && !selectedTask.deleted_at ? () => updateExecutionDraft({ result: "completed", outcome: "completed", wholeTask: true }) : undefined}
                      completeTaskDisabled={loading || Boolean(preview) || !taskResultEditable(selectedTask, clock.getTime())} />
                    <p className="execution-capture-note">{executionDraft.wholeTask ? "保存后完成整个任务，已有日期记录会保留，后续未执行安排将不再显示。" : "仅记录当天结果，不改变其他日期的记录；所有日期完成后，任务自动完成。"}</p>
                  </> : null}
                  {executionMessage && <span role="alert" className="execution-capture-note error">{executionMessage}</span>}
                  <footer className="execution-capture-footer">
                    {canAdjustSelectedBlock && <button type="button" className="execution-remove-today" disabled={busy || loading || savingExecution || Boolean(quickCompletingBlockId) || savingDraggedBlock || Boolean(timelineDrag) || Boolean(preview)} onClick={() => void removeSelectedBlock()}><Icon name="trash" size={14} />移除当前安排</button>}
                    {!selectedTaskIsCrossDay && selectedBlockDialog?.action === "uncomplete-block" && <button type="button" className="execution-reopen-task secondary-action" title={historicalBlockCompletionLocked(selectedDate, selectedBlock, clock.getTime()) ? HISTORY_COMPLETION_LOCKED_MESSAGE : selectedBlockCompletionAction !== selectedBlockDialog.action ? "当前结果不可修改" : "仅取消当天任务块的完成状态，其他日期保持不变"} disabled={selectedBlockCompletionAction !== selectedBlockDialog.action || busy || loading || savingExecution || Boolean(quickCompletingBlockId) || savingDraggedBlock || Boolean(timelineDrag) || Boolean(preview)} onClick={() => void quickCompleteTimelineBlock(selectedBlock)}><Icon name="restore" size={14} />{quickCompletingBlockId === selectedBlock.id ? "正在取消…" : "取消当天完成"}</button>}
                    {!selectedTaskIsCrossDay && selectedBlockDialog?.action === "new-task" && selectedTask && <button type="button" className="execution-new-task secondary-action" disabled={busy || loading || savingExecution || Boolean(quickCompletingBlockId)} onClick={() => onNewTask({ title: selectedTask.title, priority: selectedTask.priority, tags: [...selectedTask.tags] })}><Icon name="plus" size={14} />新建任务</button>}
                    <div><button type="button" className="quiet-button" disabled={savingExecution || Boolean(quickCompletingBlockId)} onClick={closeTimelinePanel}>取消</button>{canRecordSelectedBlock && executionDraft && <button type="button" className="primary-action" disabled={savingExecution || busy || loading || Boolean(quickCompletingBlockId) || !executionDraft.outcome} onClick={() => void saveSelectedBlockExecution()}>{savingExecution ? "正在保存…" : "保存"}</button>}</div>
                  </footer>
                </> : selectedEvent ? <><header><div><strong>{selectedEvent.title}</strong><small>{selectedEvent.is_all_day ? "全天固定日程" : `${timeRangeLabel(selectedEvent.starts_at, selectedEvent.ends_at)} · 固定日程`}</small></div><button type="button" aria-label="关闭日程详情" onClick={closeTimelinePanel}><Icon name="close" size={15} /></button></header><div className="floating-readonly"><strong>固定日程</strong><span>固定日程不提供完成按钮，也不会限制同一时段安排其他事项。</span></div></> : null}
              </section></div>}
              <div className="hourly-timeline" style={{ "--timeline-height": `${timelineHeight}px` } as CSSProperties}><div className="timeline-hours" aria-hidden="true">{timelineHours.map((hour, index) => <div key={hour} className={`timeline-hour${showNowLine && Math.abs(nowMinute - index * 60) / 60 * pixelsPerHour <= nowLabelOverlapDistance ? " current-time-covered" : ""}`} style={{ top: `${index * pixelsPerHour}px` }}><time>{String(hour).padStart(2, "0")}:00</time><span /></div>)}</div><div className={`timeline-events${!isPastDate ? " has-create-track" : ""}`} style={{ height: `${timelineHeight}px` }}>
                {!isPastDate && <TimelineTaskCreate key={selectedDate} date={selectedDate} scrollRef={timelineScrollRef} pixelsPerHour={pixelsPerHour}
                  disabled={busy || loading || Boolean(error) || savingExecution || Boolean(quickCompletingBlockId) || Boolean(includingTaskId) || savingDraggedBlock || Boolean(timelineDrag)}
                  onRange={setTimelineCreateRange} onStart={() => { pauseTimelineFollowing(); setSelection(null); setPlanDraftTimeEdit(null); setTimelineTooltip(null); timelineSelectionAnchorRef.current = null; }}
                  onCreated={async () => { await onFactsChanged(selectedDate); onNotify("任务已创建", "", "check"); }} />}
                {timelineCreateRange && <div className={`selection-range${timelineCreateRange.end - timelineCreateRange.start <= 30 ? " is-tiny" : ""}`}
                  data-start={timelineCreateRange.start} data-end={timelineCreateRange.end}
                  style={timelineEventPosition(planTimestamp(selectedDate, minutesClock(timelineCreateRange.start)), planTimestamp(selectedDate, minutesClock(timelineCreateRange.end)), selectedDate, axisStart, pixelsPerHour, timelineItemLanes["create:selection"])} aria-hidden="true">
                  <span className="selection-label">{minutesClock(timelineCreateRange.start)} – {minutesClock(timelineCreateRange.end)}</span>
                </div>}
                {nonWorkingTimeSegments.map((segment, index) => <div
                  key={`${segment.start}-${segment.end}-${index}`}
                  className="timeline-nonworking"
                  style={{ top: `${segment.start / 60 * pixelsPerHour}px`, height: `${Math.max(20, (segment.end - segment.start) / 60 * pixelsPerHour)}px` }}
                  tabIndex={0}
                  aria-label={`非工作时间 ${minutesClock(segment.start)} 至 ${minutesClock(segment.end)}；仍可安排日程`}
                  {...timelineTooltipProps({
                    kind: "非工作时间",
                    title: "非工作时间",
                    time: `${minutesClock(segment.start)} - ${minutesClock(segment.end)}`,
                    detail: "仅作时间线参照；仍可在这段时间安排日程。",
                    tone: "nonworking"
                  }, "block-bottom")}
                />)}
                {timedEvents.map((event) => <button
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
                    tone: "fixed"
                  })}
                  onClick={(clickEvent) => selectTimelineItem({ kind: "event", id: event.id }, clickEvent.currentTarget)}
                ><span className="timeline-event-symbol fixed" aria-hidden="true" /><span className="timeline-event-copy"><strong>{event.title}</strong><small>{timeRangeLabel(event.starts_at, event.ends_at)} · 固定日程</small></span></button>)}
                {recurringTimelineBlocks.map(({ item, starts_at, ends_at, layoutKey }) => {
                  const { url, body } = splitTaskNotes(item.notes ?? "");
                  const range = timeRangeLabel(starts_at, ends_at);
                  const duration = compactBlockDuration(timeRangeDurationMinutes(starts_at, ends_at));
                  const time = `${range} (${duration})`;
                  return <div
                    key={item.id}
                    data-timeline-kind="recurring"
                    data-timeline-id={item.id}
                    className="timeline-event recurring-event"
                    style={timelineEventPosition(starts_at, ends_at, selectedDate, axisStart, pixelsPerHour, timelineItemLanes[layoutKey])}
                    tabIndex={0}
                    role="note"
                    aria-label={`重复事项：${item.title}，${time}`}
                    {...timelineTooltipProps({ kind: "重复事项", title: item.title, time, detail: "按规则展示，无需勾选或复核", tone: "recurring", url, note: body }, "block-bottom")}
                  >
                    <span className="timeline-task-leading recurring" aria-hidden="true"><img src={recurringIcon} alt="" /></span>
                    <div className="timeline-task-body">
                      <TimelineTaskContent title={item.title} range={range} duration={duration} type="recurring" url={url} note={body} />
                    </div>
                  </div>;
                })}
                {draftBlocks.map((block, index) => {
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
                    detail: `${type ? `${taskBlockTypeLabels[type].full} · ` : ""}${task ? `${task.priority ? priorityCopy[task.priority] : "未设优先级"} · ` : ""}预计 ${block.estimated_minutes} 分钟 · 拖动或点击调整时间`,
                    tone: "draft"
                  }, "block-top")}
                  onClick={(event) => {
                    if (event.detail !== 0 && timelineDragClickRef.current === draftLayoutKeys[index] || timelineDragSavingRef.current) { timelineDragClickRef.current = null; return; }
                    selectPlanDraftBlock(index, event.currentTarget);
                  }}
                ><span className="timeline-task-body"><TimelineTaskContent title={block.task_title} range={range} duration={duration} priority={task?.priority} type={type} url={url} note={body} /></span></button>;
                })}
                {visibleTaskBlocks.map((block) => {
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
                      detail: `${task ? `${task.priority ? priorityCopy[task.priority] : "未设优先级"} · ` : ""}${block.review
                        ? `${reviewOutcomeCopy[block.review.outcome]} · ${block.review.followup_action ? taskNextActionLabels[block.review.followup_action] : "已记录"}`
                        : effectiveOutcome ? `本次${reviewOutcomeCopy[effectiveOutcome]} · 已记录` : canDragTimelineBlock(block) ? "上下拖动调整时间 · 点击查看" : ""}`,
                      tone: "task",
                      url,
                      note: body
                    }, "block-top")}
                  >
                    {!preview && <button type="button" className={`timeline-event-check${taskCompleted ? " done" : ""}${blockHasFact && !taskCompleted ? " recorded" : ""}${blockIsSaving ? " saving" : ""}`} aria-label={quickCompleteLabel} title={historicalBlockCompletionLocked(selectedDate, block, clock.getTime()) ? HISTORY_COMPLETION_LOCKED_MESSAGE : block.review && !taskCompleted ? "已有复盘记录，请在弹窗中修改结果" : !completionAction ? "当前结果不可修改" : quickCompleteText} aria-pressed={taskCompleted || blockHasFact} disabled={!completionAction || Boolean(quickCompletingBlockId) || busy || loading || savingExecution || savingDraggedBlock || Boolean(timelineDrag)} onClick={(event) => { event.stopPropagation(); void quickCompleteTimelineBlock(block); }}>{blockIsSaving ? <span className="timeline-check-spinner" /> : taskCompleted ? <Icon name="check" size={11} /> : null}</button>}
                    <button type="button" className="timeline-event-body timeline-task-body" aria-label={`打开本次执行：${block.task_title}，${time}${type ? `，${taskBlockTypeLabels[type].full}` : ""}${task ? `，${task.priority ? priorityCopy[task.priority] : "未设优先级"}` : ""}`} aria-haspopup="dialog" aria-controls="timeline-context-panel" aria-pressed={selection?.kind === "block" && selection.id === block.id}>
                      <TimelineTaskContent title={block.task_title} range={range} duration={duration} priority={task?.priority} type={type} url={url} note={body} />
                    </button>
                  </div>;
                })}
                {timelineDrag && timelineDragRef.current?.active && <div className="timeline-drag-source" style={timelineEventPosition(timelineDragRef.current.block.starts_at, timelineDragRef.current.block.ends_at, selectedDate, axisStart, pixelsPerHour, timelineDragRef.current.sourceLane)} aria-hidden="true" />}
                {!timelineDrag && selectedTimelineFrame && timelineItemLanes[selectedTimelineFrame.layoutKey] && <div className="timeline-event-selection-frame" style={timelineEventPosition(selectedTimelineFrame.starts_at, selectedTimelineFrame.ends_at, selectedDate, axisStart, pixelsPerHour, timelineItemLanes[selectedTimelineFrame.layoutKey])} aria-hidden="true" />}
              </div>{showNowLine && <div className="current-time-line" style={{ top: `${(nowMinute - axisStart) / 60 * pixelsPerHour}px` }} aria-label={`当前时间 ${shanghaiClock.label}`}><span>{shanghaiClock.label}</span></div>}</div>
            </div>
          </>}
        </main>}
      </div>
      {calendarDateHint && todayView === "month" && createPortal(<div id="calendar-date-open-hint" className="calendar-date-tip" role="tooltip" style={{ left: calendarDateHint.left, top: calendarDateHint.top }}>双击日期查看当天日程</div>, document.body)}
      {timelineDrag && !savingDraggedBlock && createPortal(<div className="timeline-drag-label" style={{ left: Math.max(12, Math.min(window.innerWidth - 160, timelineDrag.x + 16)), top: Math.max(12, Math.min(window.innerHeight - 40, timelineDrag.y - 40)) }} aria-hidden="true">{minutesClock(timelineDrag.start)} – {minutesClock(timelineDrag.end)}</div>, document.body)}
      {timelineTooltip && !timelineDrag && createPortal(
        <aside
          id="timeline-time-block-tooltip"
          className={`timeline-hover-card tone-${timelineTooltip.tone} placement-${timelineTooltip.placement}${timelineTooltip.kind === "普通任务" || timelineTooltip.kind === "单日任务" || timelineTooltip.kind === "多日任务" || timelineTooltip.kind === "重复事项" ? " task-type-hover" : ""}`}
          style={{ left: timelineTooltip.left, top: timelineTooltip.top }}
          role="tooltip"
        >
          <div className="timeline-hover-meta"><span>{timelineTooltip.kind}</span><time>{timelineTooltip.time}</time></div>
          <strong>{timelineTooltip.title}</strong>
          {(timelineTooltip.url || timelineTooltip.note) && <div className="timeline-hover-details">{timelineTooltip.url && <span className="timeline-hover-url">{timelineTooltip.url}</span>}{timelineTooltip.url && timelineTooltip.note && <span className="timeline-hover-divider" aria-hidden="true" />}{timelineTooltip.note && <p className="timeline-hover-note">{timelineTooltip.note}</p>}</div>}
          {timelineTooltip.detail && <p>{timelineTooltip.detail}</p>}
        </aside>,
        document.body
      )}
    </section>
  );
}


function SettingsPage({ availability, availabilityError, onSaved, onReload, onNotify, onDirtyChange }: {
  availability: AvailabilitySettings | null;
  availabilityError: string | null;
  onSaved: (settings: AvailabilitySettings) => void;
  onReload: () => void;
  onNotify: (label: string, message: string, icon?: IconName) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<AvailabilitySettings | null>(availability);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [activeCategory, setActiveCategory] = useState("work");
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  const [reminders, setReminders] = useState({ morning: true, morningTime: "08:30", evening: true, eveningTime: "21:30", taskLead: 5 });
  const [appearance, setAppearance] = useState({ theme: "default", mode: "light", fontSize: 15 });
  const [desktop, setDesktop] = useState({ autostart: false, closeToTray: true, shortcut: "Ctrl+Alt+Space" });
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");
  const savedPreferences = useRef<{ reminders: typeof reminders; appearance: typeof appearance; desktop: typeof desktop } | null>(null);
  const availabilityState = saving ? "正在保存" : availability ? "已加载" : availabilityError ? "暂时不可用" : "正在加载";
  const availabilityDirty = Boolean(draft && availability && JSON.stringify(draft) !== JSON.stringify(availability));
  const preferencesDirty = Boolean(savedPreferences.current && JSON.stringify({ reminders, appearance, desktop }) !== JSON.stringify(savedPreferences.current));
  const dirty = availabilityDirty || preferencesDirty;
  const settingsCategories = [["work", "工作时间"], ["reminder", "提醒"], ["appearance", "外观"], ["desktop", "Windows 集成"], ["privacy", "数据与隐私"]] as const;

  useEffect(() => {
    setDraft(availability);
    setSaveMessage("");
  }, [availability]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getUiSetting("ui.reminder.morning_enabled"), getUiSetting("ui.reminder.morning_time"),
      getUiSetting("ui.reminder.evening_enabled"), getUiSetting("ui.reminder.evening_time"),
      getUiSetting("ui.reminder.task_lead"), getUiSetting("ui.appearance.theme"),
      getUiSetting("ui.appearance.mode"), getUiSetting("ui.appearance.font_size"),
      getUiSetting("ui.desktop.close_to_tray"), getUiSetting("ui.desktop.shortcut"),
      getAutostartEnabled()
    ]).then(([morningEnabled, morningTime, eveningEnabled, eveningTime, taskLead, theme, mode, fontSize, closeToTray, shortcut, autostart]) => {
      if (!active) return;
      const nextAppearance = { theme: theme || "default", mode: mode || "light", fontSize: Number(fontSize || 15) };
      setAppearance(nextAppearance);
      document.documentElement.dataset.theme = nextAppearance.theme;
      document.documentElement.dataset.mode = nextAppearance.mode;
      document.documentElement.style.setProperty("--app-font-size", `${nextAppearance.fontSize}px`);
      const nextReminders = { morning: morningEnabled !== "false", morningTime: morningTime || "08:30", evening: eveningEnabled !== "false", eveningTime: eveningTime || "21:30", taskLead: Number(taskLead || 5) };
      const nextDesktop = { autostart, closeToTray: closeToTray !== "false", shortcut: shortcut || "Ctrl+Alt+Space" };
      setReminders(nextReminders);
      setDesktop(nextDesktop);
      savedPreferences.current = { reminders: nextReminders, appearance: nextAppearance, desktop: nextDesktop };
    }).catch((reason) => { if (active) setPreferenceMessage(uiErrorMessage(reason)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  useEffect(() => () => {
    const saved = savedPreferences.current?.appearance;
    if (!saved) return;
    document.documentElement.dataset.theme = saved.theme;
    document.documentElement.dataset.mode = saved.mode;
    document.documentElement.style.setProperty("--app-font-size", `${saved.fontSize}px`);
  }, []);

  function showCategory(category: string) {
    setActiveCategory(category);
    window.requestAnimationFrame(() => document.getElementById(category)?.scrollIntoView({ block: "start" }));
  }

  function requestCategory(category: string) {
    if (category === activeCategory) {
      showCategory(category);
      return;
    }
    if (dirty) {
      setPendingCategory(category);
      return;
    }
    showCategory(category);
  }

  function resolveCategoryNavigation(discard: boolean) {
    const category = pendingCategory;
    setPendingCategory(null);
    if (!discard || !category) return;
    setDraft(availability);
    setSaveMessage("");
    if (savedPreferences.current) {
      setReminders(savedPreferences.current.reminders);
      setDesktop(savedPreferences.current.desktop);
      previewAppearance(savedPreferences.current.appearance);
    }
    showCategory(category);
  }

  function toggleWorkday(day: number) {
    if (!draft) return;
    const weekdays = draft.weekdays.includes(day)
      ? draft.weekdays.filter((item) => item !== day)
      : [...draft.weekdays, day].sort((left, right) => left - right);
    setDraft({ ...draft, weekdays });
    setSaveMessage("");
  }

  function updateWorkdayRange(next: { start: string; end: string }) {
    if (!draft) return;
    setDraft({ ...draft, workday_start: next.start, workday_end: next.end });
    setSaveMessage("");
  }

  async function submitAvailability(event: FormEvent) {
    event.preventDefault();
    if (!draft || saving) return;
    if (draft.weekdays.length === 0) {
      setSaveMessage("至少选择一个工作日。");
      return;
    }
    setSaving(true);
    setSaveMessage("正在保存工作时间…");
    try {
      const saved = await saveAvailabilitySettings(draft);
      setDraft(saved);
      setSaveMessage("日计划偏好已保存。");
      onSaved(saved);
      onNotify("工作时间已保存", "", "check");
    } catch (reason) {
      const message = planDraftErrorMessage(reason, null, shanghaiDateValue());
      setSaveMessage(message);
      onNotify("工作时间未保存", message, "review");
    } finally {
      setSaving(false);
    }
  }

  async function savePreferences() {
    if (preferenceBusy) return;
    setPreferenceBusy(true);
    setPreferenceMessage("正在保存本机偏好…");
    try {
      await Promise.all([
        setUiSetting("ui.reminder.morning_enabled", String(reminders.morning)),
        setUiSetting("ui.reminder.morning_time", reminders.morningTime),
        setUiSetting("ui.reminder.evening_enabled", String(reminders.evening)),
        setUiSetting("ui.reminder.evening_time", reminders.eveningTime),
        setUiSetting("ui.reminder.task_lead", String(reminders.taskLead)),
        setUiSetting("ui.appearance.theme", appearance.theme),
        setUiSetting("ui.appearance.mode", appearance.mode),
        setUiSetting("ui.appearance.font_size", String(appearance.fontSize)),
        setUiSetting("ui.desktop.close_to_tray", String(desktop.closeToTray)),
        setGlobalShortcut(desktop.shortcut),
        setAutostartEnabled(desktop.autostart)
      ]);
      setPreferenceMessage("提醒、外观和 Windows 集成设置已保存。");
      savedPreferences.current = { reminders, appearance, desktop };
      onNotify("设置已保存", "", "check");
    } catch (reason) {
      const message = uiErrorMessage(reason);
      setPreferenceMessage(message);
      onNotify("设置未保存", message, "review");
    } finally { setPreferenceBusy(false); }
  }

  function previewAppearance(next: typeof appearance) {
    setAppearance(next);
    document.documentElement.dataset.theme = next.theme;
    document.documentElement.dataset.mode = next.mode;
    document.documentElement.style.setProperty("--app-font-size", `${next.fontSize}px`);
  }

  return <section className={`next-page settings-page${dirty || saving ? " has-floating-actions" : ""}`}>
    <h1 className="sr-only">设置</h1>
    <div className="settings-layout"><nav aria-label="设置分类">{settingsCategories.map(([category, label]) => <button key={category} type="button" className={activeCategory === category ? "active" : ""} aria-current={activeCategory === category ? "location" : undefined} onClick={() => requestCategory(category)}>{label}</button>)}</nav><div className="settings-sections">
      <section id="work" className="availability-settings-section"><header><div><h2>工作时间偏好</h2><p>用于自动安排的优先起点和时间线参照，不限制手动安排。</p></div><span className={`setting-state${availability ? " connected" : ""}`}>{availabilityState}</span></header>
        {availabilityError && !draft ? <div className="setting-load-error"><strong>日计划偏好暂时无法打开</strong><span>{availabilityError}</span><button type="button" className="quiet-button" onClick={onReload}>重试</button></div> : draft ? <form className="setting-availability-form" onSubmit={(event) => void submitAvailability(event)}>
          <fieldset className="setting-weekdays"><legend>工作日</legend><div>{["一", "二", "三", "四", "五", "六", "日"].map((label, index) => <button key={label} type="button" aria-pressed={draft.weekdays.includes(index + 1)} disabled={saving} onClick={() => toggleWorkday(index + 1)}>周{label}</button>)}</div><label className="setting-makeup-workdays"><input type="checkbox" checked={draft.makeup_workdays_as_workdays ?? true} disabled={saving} onChange={(event) => { setDraft({ ...draft, makeup_workdays_as_workdays: event.target.checked }); setSaveMessage(""); }} />将调休补班日设为工作日</label><small>法定放假日自动作为非工作日；未勾选时，补班日按以上每周选择。非工作日使用更浅的网格背景，仍可安排事项。节假日数据覆盖 {OFFICIAL_HOLIDAY_COVERAGE.from.slice(0, 4)} 年，范围外按每周设置。</small></fieldset>
          <div className="setting-time-group"><div className="setting-time-heading"><div><h3>每日工作时间</h3><p>自动安排会优先从这段时间开始；其他时段同样可以安排。</p></div><strong>{draft.workday_start} – {draft.workday_end}</strong></div><TimeRangeRail start={draft.workday_start} end={draft.workday_end} startLabel="开始工作" endLabel="结束工作" disabled={saving} onChange={updateWorkdayRange} /></div>
          {(availabilityDirty || saving) && <footer className="setting-save-bar" aria-label="未保存的更改"><strong role="status" className={saveMessage && !saveMessage.includes("已保存") && !saveMessage.includes("正在") ? "error" : ""}>{saving ? "正在保存到本机…" : draft.weekdays.length === 0 ? "至少选择一个工作日后才能保存。" : saveMessage || "有未保存的更改"}</strong><div className="draft-bar-actions"><button type="button" className="draft-reset" disabled={saving} onClick={() => { setDraft(availability); setSaveMessage(""); }}>撤销</button><button type="submit" className="draft-save" disabled={saving || draft.weekdays.length === 0}>{saving ? "保存中…" : "保存更改"}</button></div></footer>}
        </form> : <div className="setting-loading"><span className="loader dark" />正在载入日计划偏好…</div>}
      </section>
      <section id="reminder"><header><div><h2>提醒</h2><p>按设定时间发送通知，不会自动更改任务或计划。</p></div><button type="button" className="quiet-button" onClick={() => void sendTestNotification().then(() => setPreferenceMessage("测试通知已发送。")).catch((reason) => setPreferenceMessage(uiErrorMessage(reason)))}>发送测试通知</button></header><div className="setting-row"><div><strong>晨间计划</strong><span>每日首次达到设定时间后提醒一次</span></div><div className="setting-inline-controls"><input type="time" value={reminders.morningTime} disabled={!reminders.morning} onChange={(event) => setReminders({ ...reminders, morningTime: event.target.value })} /><button type="button" role="switch" aria-checked={reminders.morning} className={`switch-control${reminders.morning ? " enabled" : ""}`} onClick={() => setReminders({ ...reminders, morning: !reminders.morning })}><span /></button></div></div><div className="setting-row"><div><strong>晚间复盘</strong><span>每日首次达到设定时间后提醒一次</span></div><div className="setting-inline-controls"><input type="time" value={reminders.eveningTime} disabled={!reminders.evening} onChange={(event) => setReminders({ ...reminders, eveningTime: event.target.value })} /><button type="button" role="switch" aria-checked={reminders.evening} className={`switch-control${reminders.evening ? " enabled" : ""}`} onClick={() => setReminders({ ...reminders, evening: !reminders.evening })}><span /></button></div></div><label className="setting-buffer">任务块开始前提醒<span><input type="number" min={0} max={60} step={5} value={reminders.taskLead} onChange={(event) => setReminders({ ...reminders, taskLead: Number(event.target.value) })} />分钟</span></label></section>
      <section id="appearance"><header><div><h2>外观</h2><p>主题会即时预览，保存后随应用启动恢复。</p></div><span className="setting-state connected">可配置</span></header><div className="theme-options">{[["default", "默认"], ["github", "GitHub"], ["codex", "Codex"]].map(([value, label]) => <button key={value} type="button" aria-pressed={appearance.theme === value} onClick={() => previewAppearance({ ...appearance, theme: value })}><span className={`theme-swatch ${value}`} />{label}</button>)}</div>
        <div className="setting-row"><div><strong>明暗模式</strong><span>切换界面明暗，应用 Logo 始终使用浅色版</span></div><select aria-label="明暗模式" value={appearance.mode} onChange={(event) => previewAppearance({ ...appearance, mode: event.target.value })}><option value="light">浅色</option><option value="dark">深色</option></select></div>
        <div className="setting-row"><div><strong>应用 Logo</strong><span>所有主题、窗口、任务栏与托盘统一使用浅色 Logo</span></div><div className="logo-mode-previews"><span><Logo /><span>浅色 · 所有主题</span></span></div></div>
        <label className="setting-buffer">界面字号<span><input type="range" min={13} max={18} value={appearance.fontSize} onChange={(event) => previewAppearance({ ...appearance, fontSize: Number(event.target.value) })} />{appearance.fontSize}</span></label></section>
      <section id="desktop"><header><div><h2>Windows 集成</h2><p>快捷唤起、开机启动和关闭到托盘。</p></div><span className="setting-state connected">已接入</span></header><div className="setting-row"><div><strong>开机启动</strong><span>登录 Windows 后自动启动今序</span></div><button type="button" role="switch" aria-checked={desktop.autostart} className={`switch-control${desktop.autostart ? " enabled" : ""}`} onClick={() => setDesktop({ ...desktop, autostart: !desktop.autostart })}><span /></button></div><div className="setting-row"><div><strong>关闭到托盘</strong><span>窗口关闭后仍在后台提供提醒</span></div><button type="button" role="switch" aria-checked={desktop.closeToTray} className={`switch-control${desktop.closeToTray ? " enabled" : ""}`} onClick={() => setDesktop({ ...desktop, closeToTray: !desktop.closeToTray })}><span /></button></div><label className="setting-buffer">全局快捷键<span><input value={desktop.shortcut} maxLength={80} onChange={(event) => setDesktop({ ...desktop, shortcut: event.target.value })} /></span><small>例如 Ctrl+Alt+Space；若已被其他应用占用，保存时会提示。</small></label></section>
      <section id="privacy"><header><div><h2>数据与隐私</h2><p>任务、草稿、计划和历史都保存在这台电脑上。</p></div><span className="setting-state connected">仅存本机</span></header><div className="setting-row"><div><strong>本地数据</strong><span>由今序保存在这台电脑上；当前版本未加密</span></div></div><div className="setting-row"><div><strong>回收站</strong><span>普通任务和重复事项移入回收站后默认保留 30 天，过期内容会在启动时清理</span></div></div></section>
      <footer className="settings-preference-footer"><span role="status">{preferenceMessage || (preferencesDirty ? "提醒、外观或 Windows 集成有未保存的更改。" : "提醒、外观和 Windows 集成已与本机设置一致。")}</span><button type="button" disabled={preferenceBusy || !preferencesDirty} onClick={() => void savePreferences()}>{preferenceBusy ? "保存中…" : "保存提醒与外观"}</button></footer>
    </div></div>
    {pendingCategory && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) resolveCategoryNavigation(false); }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="settings-category-dialog-title" aria-describedby="settings-category-dialog-description" busy={false} tone="caution" onCancel={() => resolveCategoryNavigation(false)}><h2 id="settings-category-dialog-title">放弃未保存修改？</h2><p id="settings-category-dialog-description">设置中还有未保存内容。放弃后，日计划、提醒、外观和 Windows 偏好会恢复为本机当前值。</p><div className="dialog-actions"><button type="button" autoFocus onClick={() => resolveCategoryNavigation(false)}>继续编辑</button><button type="button" className="dialog-discard" onClick={() => resolveCategoryNavigation(true)}>放弃修改</button></div></ConfirmationDialog></div>}
  </section>;
}

export default function App() {
  const [today, setToday] = useState(() => shanghaiDateValue());
  const [selectedDate, setSelectedDate] = useState(() => shanghaiDateValue());
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;
  const [active, setActive] = useState("今日");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recurringItems, setRecurringItems] = useState<RecurringItem[]>([]);
  const [recurringOccurrences, setRecurringOccurrences] = useState<RecurringOccurrence[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [taskEditorDirty, setTaskEditorDirty] = useState(false);
  const [settingsEditorDirty, setSettingsEditorDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<NavigationIntent | null>(null);
  const [pendingPlanLeave, setPendingPlanLeave] = useState<PlanLeaveIntent | null>(null);
  const [daySchedule, setDaySchedule] = useState<DaySchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [planPreview, setPlanPreview] = useState<RulePlanPreview | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planToast, setPlanToast] = useState<{ id: number; label: string; message: string; icon?: IconName; undoId?: string; taskSeed?: TaskSeed } | null>(null);
  const [availability, setAvailability] = useState<AvailabilitySettings | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [requestedTaskView, setRequestedTaskView] = useState<TaskViewRequest | null>(null);
  const [timelineReturnContext, setTimelineReturnContext] = useState<TimelineReturnContext | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const previousPageRef = useRef(active);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const summaryTaskBlocks = visibleTaskScheduleBlocks(daySchedule?.task_blocks ?? [], selectedDate, today);
  const plannedTaskCount = summaryTaskBlocks.length;
  const completedPlannedTaskCount = summaryTaskBlocks.filter((block) => (block.review?.outcome ?? block.execution_status) === "completed").length;
  const plannedMinutes = summaryTaskBlocks.reduce((total, block) => total + Math.round((new Date(block.ends_at).getTime() - new Date(block.starts_at).getTime()) / 60000), 0);
  const planProgress = plannedTaskCount ? Math.round(completedPlannedTaskCount / plannedTaskCount * 100) : 100;
  const recurringItemCount = selectedDate > today
    ? recurringItems.filter((item) => recurringItemAppearsOnDate(item, selectedDate)).length
    : recurringOccurrences.filter((item) => item.occurrence_date === selectedDate).length;

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

  async function refreshAvailability() {
    try {
      const settings = await getAvailabilitySettings();
      setAvailability(settings);
      setAvailabilityError(null);
    } catch (reason) {
      setAvailability(null);
      setAvailabilityError(uiErrorMessage(reason));
    }
  }

  useEffect(() => {
    void refreshTasks();
    void refreshAvailability();
    void Promise.all([
      getUiSetting("ui.appearance.theme"),
      getUiSetting("ui.appearance.mode"),
      getUiSetting("ui.appearance.font_size")
    ]).then(([theme, mode, fontSize]) => {
      document.documentElement.dataset.theme = theme || "default";
      document.documentElement.dataset.mode = mode || "light";
      document.documentElement.style.setProperty("--app-font-size", `${Number(fontSize || 15)}px`);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let previousMode = "";
    let pending = Promise.resolve();
    const syncLogo = () => {
      if (!document.documentElement.dataset.mode) return;
      const mode = document.documentElement.dataset.mode === "dark" ? "dark" : "light";
      if (mode === previousMode) return;
      previousMode = mode;
      let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!favicon) {
        favicon = document.createElement("link");
        favicon.rel = "icon";
        document.head.append(favicon);
      }
      favicon.href = logoUrl(mode);
      if ("__TAURI_INTERNALS__" in window) {
        pending = pending.then(() => setAppLogoMode(mode)).catch((reason) => console.warn("应用图标更新失败", reason));
      }
    };
    const observer = new MutationObserver(syncLogo);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode"] });
    syncLogo();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setPlanPreview(null);
    setPlanToast(null);
    setMessage("");
    void Promise.all([refreshTasks(false), refreshSchedule(selectedDate)]);
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

  async function saveTimelineChange(taskId: string, label: string, save: () => Promise<DaySchedule>) {
    if (planBusy) throw new Error("正在保存安排，请稍后再试");
    setPlanBusy(true);
    setPlanToast(null);
    setMessage("");
    try {
      const saved = await save();
      setDaySchedule(saved);
      await refreshTasks(false);
      const undo = await latestUndo().catch(() => null);
      setPlanToast({
        id: Date.now(), label, message: "", icon: "check",
        undoId: undo?.target_type === "task" && undo.target_id === taskId ? undo.id : undefined
      });
      return saved;
    } finally { setPlanBusy(false); }
  }

  function includeTimelineTask(task: Task, blocks: RulePlanBlock[]) {
    return saveTimelineChange(task.id, "已加入时间线", () => includePlanTask(selectedDate, task, blocks));
  }

  async function removeTimelineBlock(block: PlanBlock) {
    await saveTimelineChange(block.task_id, "已移回待安排", () => removePlanBlock(selectedDate, block));
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
    try {
      const result = await discardRulePlanDraft(planPreview.preview_id, planPreview.version);
      setPlanPreview(null);
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
      setMessage(`草案未能放弃：${uiErrorMessage(reason)}`);
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
    } else if (intent.active === "今日" && intent.timelineReturnContext?.taskId) {
      void refreshSchedule(selectedDate);
    }
    setRequestedTaskView(intent.taskView || intent.createTask || intent.taskId || intent.taskSeed
      ? { view: intent.taskView, createTask: intent.createTask, taskId: intent.taskId, taskSeed: intent.taskSeed }
      : null);
    setTimelineReturnContext(intent.timelineReturnContext ?? null);
    const normalized = normalizeTodayNavigation(intent.active);
    setActive(normalized.active);
    setMobileNavOpen(false);
  }

  function requestNavigation(intent: NavigationIntent) {
    const target = normalizeTodayNavigation(intent.active);
    if (planPreview && ((active === "今日" && target.active !== "今日") || (intent.date && intent.date !== selectedDate))) {
      setPendingPlanLeave({ kind: "navigation", intent });
      return;
    }
    if (active === "任务" && taskEditorDirty && (intent.active !== "任务" || Boolean(intent.taskView) || Boolean(intent.createTask) || Boolean(intent.taskId) || Boolean(intent.taskSeed))) {
      setPendingNavigation(intent);
      return;
    }
    if (active === "设置" && settingsEditorDirty && intent.active !== "设置") {
      setPendingNavigation(intent);
      return;
    }
    applyNavigation(intent);
  }


  function requestDateSelection(date: string) {
    if (date === selectedDate) return true;
    if (planPreview) {
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
      setPendingPlanLeave(null);
      return;
    }
    if (!target || !await discardPlanDraft()) return;
    setPendingPlanLeave(null);
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
      setDaySchedule((current) => current ? { ...current, task_blocks: current.task_blocks.filter((block) => block.task_id !== task.id) } : current);
    }
    void refreshSchedule(selectedDate, false);
  }

  function toggleSidebarCollapsed() {
    const nextCollapsed = !sidebarCollapsed;
    setSidebarCollapsed(nextCollapsed);
    void setUiSetting(SHELL_SIDEBAR_COLLAPSED_SETTING, String(nextCollapsed))
      .catch((reason) => setMessage(`侧边栏状态未保存：${uiErrorMessage(reason)}`));
  }

  return <main className={`next-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
    <ToastViewport />
    {planToast && <Toast key={planToast.id} title={planToast.label} description={planToast.message} tone={planToast.icon === "check" ? "success" : planToast.icon === "review" ? "error" : "info"} duration={planToast.undoId || planToast.taskSeed ? 10_000 : planToast.icon === "review" ? 5200 : 2800} onDismiss={() => setPlanToast(null)} actions={[
      ...(planToast.undoId ? [{ label: "撤销", onClick: () => void undoConfirmedPlan(planToast.undoId!) }] : []),
      ...(planToast.taskSeed ? [{ label: "新建任务", onClick: () => { requestNavigation({ active: "任务", taskSeed: planToast.taskSeed }); setPlanToast(null); } }] : [])
    ]} />}
    {pendingPlanLeave && planPreview && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !planBusy) void resolvePendingPlanLeave(false); }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="plan-leave-dialog-title" aria-describedby="plan-leave-dialog-description" busy={planBusy} tone="caution" onCancel={() => void resolvePendingPlanLeave(false)}><h2 id="plan-leave-dialog-title">日计划草案尚未确认</h2><p id="plan-leave-dialog-description">{planPreview.plan_date} 的草案还没有加入正式日历。切换日期或视图前，请先确认，或丢弃草案并恢复其调整的任务时间。</p><div className="dialog-actions"><button type="button" autoFocus disabled={planBusy} onClick={() => void resolvePendingPlanLeave(false)}>继续编辑</button><button type="button" className="dialog-discard" disabled={planBusy} onClick={() => void resolvePendingPlanLeave(true)}>{planBusy ? "正在丢弃…" : "丢弃并继续"}</button></div></ConfirmationDialog></div>}
    {active === "设置" && settingsEditorDirty && pendingNavigation && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) resolvePendingNavigation(false); }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="settings-leave-dialog-title" aria-describedby="settings-leave-dialog-description" busy={false} tone="caution" onCancel={() => resolvePendingNavigation(false)}><h2 id="settings-leave-dialog-title">放弃未保存修改？</h2><p id="settings-leave-dialog-description">设置中还有未保存内容。离开后会恢复为上次保存的日计划、提醒、外观和 Windows 偏好。</p><div className="dialog-actions"><button type="button" autoFocus onClick={() => resolvePendingNavigation(false)}>继续编辑</button><button type="button" className="dialog-discard" onClick={() => resolvePendingNavigation(true)}>放弃修改</button></div></ConfirmationDialog></div>}
    <aside id="main-sidebar" className={`next-sidebar${mobileNavOpen ? " mobile-open" : ""}`} aria-label="主导航">
      <ProductBrand />
      <button className="next-create" type="button" aria-label="记一件事" aria-describedby={sidebarCollapsed ? "sidebar-tip-create" : undefined} onClick={() => requestNavigation({ active: "任务", createTask: true })}><img className="sidebar-create-icon" src={taskCreateIcon} alt="" width={20} height={20} /><span className="next-create-label">记一件事</span><span className="sidebar-tooltip" id="sidebar-tip-create" role="tooltip" aria-hidden="true"><strong>记一件事</strong><small>创建普通任务或重复事项</small></span></button>
      <nav>
        <span className="sidebar-nav-selection" aria-hidden="true" style={{ "--sidebar-nav-index": navigation.findIndex((item) => item.label === active) } as CSSProperties} />
        {navigation.map((item) => <button key={item.label} type="button" className={active === item.label ? "active" : ""} aria-current={active === item.label ? "page" : undefined} aria-label={item.label} aria-describedby={sidebarCollapsed ? `sidebar-tip-${item.icon}` : undefined} onClick={() => requestNavigation({ active: item.label })}><span className="nav-icon-tile" aria-hidden="true"><span className="nav-asset-icon" style={{ "--nav-icon": `url("${item.asset}")` } as CSSProperties} /></span><span className="nav-copy"><strong>{item.label}</strong></span><span className="sidebar-tooltip" id={`sidebar-tip-${item.icon}`} role="tooltip" aria-hidden="true"><strong>{item.label}</strong><small>{item.description}</small></span></button>)}
      </nav>
      <footer>
        <section className="sidebar-summary-card" aria-label="计划统计">
          <div className="sidebar-plan-row"><span>任务计划</span><strong>{completedPlannedTaskCount} / {plannedTaskCount}</strong></div>
          <div className="sidebar-plan-track" role="progressbar" aria-label="任务计划完成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={planProgress}><span style={{ width: `${planProgress}%` }} /></div>
          <div className="sidebar-plan-meta"><span>{plannedMinutes} 分钟已安排</span><span>完成{planProgress}%</span></div>
          <div className="sidebar-repeat-row"><span>重复事项</span><strong>{recurringItemCount} 项</strong></div>
        </section>
        {(tasksLoading || tasksError) && <span className={`database-state${tasksError ? " unavailable" : ""}`} role="status"><i />{tasksLoading ? "正在载入本地数据" : "本地数据暂时不可用"}</span>}
      </footer>
    </aside>
    <div className="shell-divider" aria-hidden="true" />
    <button className="shell-collapse-button" type="button" aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} aria-controls="main-sidebar" aria-expanded={!sidebarCollapsed} onClick={toggleSidebarCollapsed}><Icon name={sidebarCollapsed ? "chevron-right" : "chevron-left"} size={16} /></button>
    {mobileNavOpen && <button type="button" className="nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}
    <section ref={workspaceRef} className="next-workspace">
      <button type="button" className="mobile-nav-button" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((value) => !value)}><Icon name="more" size={18} />菜单</button>
      {active === "今日" && <div className="today-workspace">
        <div className="today-schedule-pane">
          <TodayPage visible today={today} selectedDate={selectedDate} onSelectDate={requestDateSelection} tasks={tasks} recurringItems={recurringItems} recurringOccurrences={recurringOccurrences} schedule={daySchedule} availability={availability} loading={scheduleLoading} error={scheduleError} preview={planPreview} busy={planBusy} onIncludeTask={includeTimelineTask} onRemoveBlock={removeTimelineBlock} onUpdatePlan={updatePlanDraft} onSaveBlockTime={saveBlockTime} onConfirmPlan={() => void confirmRulePlan()} onCancelPlan={discardPlanDraft} onOpenTasks={(taskId, returnContext) => requestNavigation({ active: "任务", taskId, timelineReturnContext: returnContext })} onNewTask={(taskSeed) => requestNavigation({ active: "任务", taskSeed })} onFactsChanged={async (date = selectedDate) => { await Promise.all([refreshTasks(false), refreshSchedule(date, false)]); }} onNotify={(label, toastMessage, icon, undoId, taskSeed) => setPlanToast({ id: Date.now(), label, message: toastMessage, icon, undoId, taskSeed })} message={message} timelineReturnContext={timelineReturnContext} onTimelineReturnHandled={() => setTimelineReturnContext(null)} />
        </div>
      </div>}
      {active === "任务" && <TaskWorkspace tasks={tasks} recurringItems={recurringItems} loading={tasksLoading} error={tasksError} onReload={refreshTasks} onTaskCommitted={taskCommitted} onRecurringChanged={async () => { await Promise.all([refreshTasks(false), refreshSchedule(selectedDate, false)]); }} today={today} onDirtyChange={setTaskEditorDirty} externalNavigationRequest={pendingNavigation} onExternalNavigationResolved={resolvePendingNavigation} requestedView={requestedTaskView} timelineReturnContext={timelineReturnContext} onReturnToTimeline={(returnContext) => requestNavigation({ active: "今日", timelineReturnContext: returnContext })} onOpenToday={(date = today, taskId) => requestNavigation({ active: "今日", date, timelineReturnContext: taskId ? { date, taskId } : undefined })} />}
      {active === "甘特图" && <GanttPage tasks={tasks} today={today} loading={tasksLoading} error={tasksError} onReload={() => void refreshTasks()} onOpenTask={(task) => requestNavigation({ active: "任务", taskId: task.id })} />}
      {active === "设置" && <SettingsPage availability={availability} availabilityError={availabilityError} onReload={() => void refreshAvailability()} onSaved={(settings) => { setAvailability(settings); setAvailabilityError(null); void refreshSchedule(selectedDate, false); }} onNotify={(label, toastMessage, icon) => setPlanToast({ id: Date.now(), label, message: toastMessage, icon })} onDirtyChange={setSettingsEditorDirty} />}
    </section>
  </main>;
}
