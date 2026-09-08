import {
  CSSProperties,
  FormEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import navTodayIcon from "./assets/nav-today.svg";
import navTasksIcon from "./assets/nav-tasks.svg";
import navReviewIcon from "./assets/nav-review.svg";
import navSettingsIcon from "./assets/nav-settings.svg";
import recurringIcon from "./assets/recurring.svg";
import {
  AvailabilitySettings,
  AiConnectionSettings,
  AiConversation,
  AiMessage,
  applyConfirmedAiProposal,
  applyUndo,
  CalendarEvent,
  clearDebugTimelineLayoutFixtures,
  completeTaskFromReview,
  confirmTaskDraft,
  confirmRuleBasedPlan,
  createRecurringItem,
  debugTimelineFixturesAvailable,
  createAiConversation,
  createManualTaskDraft,
  DaySchedule,
  discardRulePlanDraft,
  discardTaskDraft,
  getAvailabilitySettings,
  getAiConnectionSettings,
  getAutostartEnabled,
  getDaySchedule,
  getTaskMetadata,
  getRulePlanDraft,
  getUiSetting,
  listAiConversations,
  listAiMessages,
  listAiConversationProposals,
  latestUndo,
  listTaskDrafts,
  listTasks,
  listRecurringItems,
  listRecurringOccurrences,
  ManualTaskUpdate,
  PlanBlock,
  permanentlyDeleteRecurringItem,
  permanentlyDeleteManualTask,
  permanentlyDeleteAiConversation,
  previewRuleBasedPlan,
  reopenManualTask,
  regenerateConfirmedPlanAdjustment,
  restoreManualTask,
  restoreRecurringItem,
  RulePlanBlock,
  RulePlanPreview,
  ProposalPreview,
  RuleUnscheduledTask,
  RecurrenceInput,
  RecurringItem,
  RecurringItemInput,
  RecurringOccurrence,
  RecurringOccurrenceOutcome,
  ReviewOutcome,
  ReviewEntryInput,
  saveAvailabilitySettings,
  clearExecutionCapture,
  saveAiConnectionSettings,
  sendTestNotification,
  setAutostartEnabled,
  setGlobalShortcut,
  saveExecutionCapture,
  saveReviewEntry,
  saveRecurringOccurrenceReview,
  saveTaskDraft,
  softDeleteManualTask,
  softDeleteRecurringItem,
  startConfirmedPlanAdjustment,
  startAiAssistant,
  completeAiAssistant,
  stopAiRun,
  testAiConnection,
  renameAiConversation,
  setAiConversationArchived,
  setTaskTags,
  setRecurringItemStatus,
  Task,
  TaskDraft,
  TaskDraftInput,
  TaskStatus,
  transitionManualTask,
  updateRulePlanDraft,
  updateManualTask,
  updateRecurringTask,
  updateRecurringItem,
  setUiSetting,
  seedDebugTimelineLayoutFixtures
} from "./tauri";
import { calendarDayInfo, lunarDayLabel, officialHolidayCoverageFor, OFFICIAL_HOLIDAY_COVERAGE } from "./calendar-data";
import { recurringItemAppearsOnDate, taskAppearsOnDate } from "./calendar-task-placement";
import { timelineDurationHeight, timelineLaneLayout as calculateTimelineLanes, TimelineLane } from "./timeline-lane-layout";

type IconName =
  | "today" | "tasks" | "inbox" | "calendar" | "review" | "settings"
  | "plus" | "sparkle" | "more" | "check" | "send" | "search"
  | "trash" | "restore" | "close" | "clock" | "filter" | "user" | "chevron-left" | "chevron-right";

const navigation: { label: string; icon: IconName; asset: string; description: string }[] = [
  { label: "今日", icon: "today", asset: navTodayIcon, description: "月历与日计划" },
  { label: "任务", icon: "tasks", asset: navTasksIcon, description: "草稿与任务账本" },
  { label: "复盘", icon: "review", asset: navReviewIcon, description: "记录实际执行" },
  { label: "设置", icon: "settings", asset: navSettingsIcon, description: "工作方式与连接" }
];

const slots = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00"];
type TaskView = "draft" | "recurring" | "inbox" | "open" | "scheduled" | "done" | "cancelled" | "deleted";
type CreateItemType = "task" | "recurring";
type LedgerResizeSession = { pointerId: number; startX: number; startWidth: number };
type ShellResizeSession = { pointerId: number; startX: number; startWidth: number; latestWidth: number };
type NavigationIntent = { active: string; taskView?: TaskView; createTask?: boolean; taskId?: string };
type PlanLeaveIntent = { kind: "navigation"; intent: NavigationIntent } | { kind: "date"; date: string };
type TaskViewRequest = { view?: TaskView; createTask?: boolean; taskId?: string };
type PendingTaskChange =
  | { kind: "select"; taskId: string }
  | { kind: "view"; view: TaskView }
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
  field: "start" | "end";
  date: string;
  time: string;
};

const TASK_LEDGER_WIDTH_SETTING = "ui.task_ledger_list_width";
const TASK_QUEUE_VIEW_SETTING = "ui.task_queue_view";
const TASK_LEDGER_LIST_MIN_WIDTH = 260;
const TASK_LEDGER_INSPECTOR_MIN_WIDTH = 380;
const TASK_LEDGER_HANDLE_WIDTH = 10;
const TASK_LEDGER_LIST_DEFAULT_WIDTH = 320;
const SHELL_SIDEBAR_WIDTH_SETTING = "ui.shell_sidebar_width";
const SHELL_SIDEBAR_COLLAPSED_SETTING = "ui.shell_sidebar_collapsed";
const SHELL_SIDEBAR_MIN_WIDTH = 188;
const SHELL_SIDEBAR_MAX_WIDTH = 320;
const SHELL_SIDEBAR_DEFAULT_WIDTH = 224;
const SHELL_SIDEBAR_COLLAPSED_WIDTH = 52;

const statusCopy: Record<TaskStatus, string> = {
  inbox: "待整理", open: "待办", scheduled: "已安排", done: "已完成", cancelled: "已取消", deleted: "回收站"
};
const priorityCopy = { low: "低优先级", medium: "中优先级", high: "高优先级" } as const;
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<IconName, React.ReactNode> = {
    today: <><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M8 2v4M16 2v4M3 10h18M8 14h3" /></>,
    tasks: <><path d="m5 12 4 4L19 6" /><path d="M5 5h7M5 19h7" /></>,
    inbox: <><path d="M4 4h16v12l-3 4H7l-3-4z" /><path d="M4 15h5l1.5 2h3L15 15h5" /></>,
    calendar: <><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M8 2v4M16 2v4M3 10h18" /></>,
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
    filter: <><path d="M4 6h16M7 12h10M10 18h4" /></>,
    user: <><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>,
    "chevron-left": <path d="m15 18-6-6 6-6" />,
    "chevron-right": <path d="m9 18 6-6-6-6" />
  };
  return <svg {...common}>{paths[name]}</svg>;
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
  const start = shanghaiDateTimeFields(currentHour + 60 * 60 * 1000);
  const end = shanghaiDateTimeFields(currentHour + 2 * 60 * 60 * 1000);
  return {
    title: "",
    notes: "",
    priority: null,
    estimated_minutes: 60,
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

function recurringItemOccursOn(form: RecurringItemForm, date: string) {
  if (!form.starts_on || date < form.starts_on || form.ends_on && date > form.ends_on) return false;
  const start = new Date(`${form.starts_on}T00:00:00+08:00`);
  const target = new Date(`${date}T00:00:00+08:00`);
  const days = Math.round((target.getTime() - start.getTime()) / 86_400_000);
  const weeks = Math.floor(days / 7);
  if (form.frequency === "daily") return days % form.interval_value === 0;
  if (form.frequency === "weekdays") return weekdayNumber(date) <= 5 && weeks % form.interval_value === 0;
  if (form.frequency === "weekly") return form.weekdays.includes(weekdayNumber(date)) && weeks % form.interval_value === 0;
  const startMonth = start.getUTCFullYear() * 12 + start.getUTCMonth();
  const targetMonth = target.getUTCFullYear() * 12 + target.getUTCMonth();
  return Number(date.slice(8, 10)) === (form.month_day ?? 1) && (targetMonth - startMonth) % form.interval_value === 0;
}

function recurringItemPreviewDates(form: RecurringItemForm) {
  const dates: string[] = [];
  if (!form.starts_on || form.interval_value < 1 || form.frequency === "weekly" && !form.weekdays.length) return dates;
  for (let offset = 0; offset <= 1100 && dates.length < 3; offset += 1) {
    const date = shiftDateValue(form.starts_on, offset);
    if (form.ends_on && date > form.ends_on) break;
    if (recurringItemOccursOn(form, date)) dates.push(date);
  }
  return dates;
}

function taskRangeIsValid(form: NewTaskForm) {
  if (!form.earliest_start_date || !form.earliest_start_time || !form.due_date || !form.due_time) return true;
  return new Date(`${form.due_date}T${form.due_time}:00+08:00`).getTime()
    > new Date(`${form.earliest_start_date}T${form.earliest_start_time}:00+08:00`).getTime();
}

function sameDayTaskRangeMinutes(form: NewTaskForm) {
  if (!form.earliest_start_date || !form.earliest_start_time || !form.due_date || !form.due_time) return null;
  if (form.earliest_start_date !== form.due_date || !taskRangeIsValid(form)) return null;
  const startsAt = new Date(`${form.earliest_start_date}T${form.earliest_start_time}:00+08:00`).getTime();
  const endsAt = new Date(`${form.due_date}T${form.due_time}:00+08:00`).getTime();
  return Math.round((endsAt - startsAt) / 60000);
}

function newTaskFormMatches(first: NewTaskForm, second: NewTaskForm) {
  return JSON.stringify(first) === JSON.stringify(second);
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

function durationLabel(startsAt: string, endsAt: string) {
  const minutes = Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000);
  return `${minutes} 分钟`;
}

function taskMatchesView(task: Task, view: TaskView) {
  return view !== "draft" && view !== "recurring" && task.status === view;
}

function viewForStatus(status: TaskStatus): TaskView {
  return status as TaskView;
}

const taskViewCopy: Record<TaskView, string> = {
  draft: "草稿",
  recurring: "重复事项",
  inbox: "Inbox",
  open: "待处理",
  scheduled: "安排",
  done: "完成",
  cancelled: "取消",
  deleted: "回收"
};

const reviewOutcomeCopy: Record<ReviewOutcome, string> = {
  completed: "完成",
  partial: "部分完成",
  not_started: "其他原因",
  cancelled: "放弃本次安排",
  blocked: "遇到阻塞"
};

type ExecutionResult = "completed" | "partial" | "not_completed";
type IncompleteReason = "blocked" | "cancelled" | "not_started";

const executionResultOptions: [ExecutionResult, string][] = [
  ["completed", "完成"],
  ["partial", "部分完成"],
  ["not_completed", "未完成"]
];

const incompleteReasonOptions: [IncompleteReason, string][] = [
  ["blocked", "遇到阻塞"],
  ["cancelled", "放弃本次安排"],
  ["not_started", "其他"]
];

function executionResultForOutcome(outcome: ReviewOutcome | null): ExecutionResult | null {
  if (outcome === "completed" || outcome === "partial") return outcome;
  return outcome ? "not_completed" : null;
}

function ExecutionOutcomePicker({
  result, outcome, disabled, compact = false, label, onChange
}: {
  result: ExecutionResult | null;
  outcome: ReviewOutcome | null;
  disabled: boolean;
  compact?: boolean;
  label: string;
  onChange: (result: ExecutionResult, outcome: ReviewOutcome | null) => void;
}) {
  return <div className={`execution-choice-stack${compact ? " compact" : ""}`}>
    <div className={compact ? "floating-outcomes" : "outcome-picker"} aria-label={label}>
      {executionResultOptions.map(([value, text]) => <button key={value} type="button" data-outcome={value} aria-pressed={result === value} disabled={disabled} onClick={() => onChange(value, value === "not_completed" ? (executionResultForOutcome(outcome) === "not_completed" ? outcome : null) : value)}>{text}</button>)}
    </div>
    {result === "not_completed" && <fieldset className="incomplete-reasons">
      <legend>未完成原因</legend>
      <div>{incompleteReasonOptions.map(([value, text]) => <button key={value} type="button" data-outcome={value} aria-pressed={outcome === value} disabled={disabled} onClick={() => onChange("not_completed", value)}>{text}</button>)}</div>
    </fieldset>}
  </div>;
}

const taskViewIcon: Record<TaskView, IconName> = {
  draft: "sparkle",
  recurring: "restore",
  inbox: "inbox",
  open: "tasks",
  scheduled: "calendar",
  done: "check",
  cancelled: "close",
  deleted: "trash"
};

const taskViewGroups: { label: string; items: TaskView[] }[] = [
  { label: "常用", items: ["open", "inbox", "scheduled"] },
  { label: "管理", items: ["recurring", "draft"] },
  { label: "历史", items: ["done", "cancelled", "deleted"] }
];

const taskEmptyCopy: Record<TaskView, { title: string; description: string }> = {
  draft: { title: "还没有待确认草稿", description: "手动创建和 AI 整理的内容会先保存在这里。" },
  recurring: { title: "还没有重复事项", description: "用“记一件事”创建不会挤进待处理队列的重复内容。" },
  inbox: { title: "Inbox 已经整理完", description: "没有日期的已确认任务会出现在这里。" },
  open: { title: "还没有待办任务", description: "新建一项任务，或先把 Inbox 中的想法整理为待办。" },
  scheduled: { title: "还没有已安排任务", description: "任务进入日计划并确认后，会在这里显示。" },
  done: { title: "还没有已完成任务", description: "完成记录会保留在这里，方便以后回看。" },
  cancelled: { title: "还没有已取消任务", description: "取消不会删除任务，历史仍会保留。" },
  deleted: { title: "回收站是空的", description: "移入回收站的普通任务和重复事项默认保留 30 天。" }
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
    priority: null,
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
  return {
    title: form.title.trim(),
    notes: form.notes.trim() || null,
    priority: form.priority,
    earliest_start_date: form.earliest_start_date || null,
    earliest_start_time: form.earliest_start_date && form.earliest_start_time ? form.earliest_start_time : null,
    due_date: form.due_date || null,
    due_time: form.due_date && form.due_time ? form.due_time : null,
    total_workload_minutes: form.estimated_minutes,
    remaining_workload_minutes: form.estimated_minutes,
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
    estimated_minutes: form.estimated_minutes,
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

function TaskScheduleEditor({ form, disabled, onChange }: {
  form: NewTaskForm;
  disabled: boolean;
  onChange: (form: NewTaskForm) => void;
}) {
  const [openPicker, setOpenPicker] = useState<TaskSchedulePicker | null>(null);
  const [monthKey, setMonthKey] = useState(form.earliest_start_date.slice(0, 7) || shanghaiDateValue().slice(0, 7));
  const dialogRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const timelineTimes = useMemo(() => Array.from({ length: 24 * 12 }, (_, index) => {
    const hour = Math.floor(index / 12);
    const minute = (index % 12) * 5;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }), []);
  const cells = useMemo(() => calendarCells(monthKey), [monthKey]);
  const todayDate = shanghaiDateValue();

  useEffect(() => {
    if (!openPicker) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.focus();
      timelineRef.current?.querySelector<HTMLElement>("[aria-selected='true']")
        ?.scrollIntoView({ block: "center" });
    });
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeSchedulePicker();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [openPicker?.field]);

  function closeSchedulePicker() {
    const trigger = triggerRef.current;
    setOpenPicker(null);
    window.requestAnimationFrame(() => trigger?.focus());
  }

  function openSchedulePicker(field: TaskSchedulePicker["field"]) {
    const date = field === "start" ? form.earliest_start_date : form.due_date;
    const time = field === "start" ? form.earliest_start_time : form.due_time;
    const nextDate = date || shanghaiDateValue();
    triggerRef.current = document.activeElement as HTMLElement | null;
    setMonthKey(nextDate.slice(0, 7));
    setOpenPicker({ field, date: nextDate, time: time || "09:00" });
  }

  function updatePickerDate(date: string) {
    setOpenPicker((current) => current ? { ...current, date } : current);
    if (date.slice(0, 7) !== monthKey) setMonthKey(date.slice(0, 7));
  }

  function updatePickerTime(time: string) {
    setOpenPicker((current) => current ? { ...current, time } : current);
  }

  function projectPickerForm(picker: TaskSchedulePicker) {
    return picker.field === "start"
      ? { ...form, earliest_start_date: picker.date, earliest_start_time: picker.time }
      : { ...form, due_date: picker.date, due_time: picker.time };
  }

  function confirmSchedulePicker() {
    if (!openPicker) return;
    const projected = projectPickerForm(openPicker);
    if (!taskRangeIsValid(projected)) return;
    onChange(projected);
    closeSchedulePicker();
  }

  const rows: { field: TaskSchedulePicker["field"]; label: string; date: string; time: string }[] = [
    { field: "start", label: "开始", date: form.earliest_start_date, time: form.earliest_start_time },
    { field: "end", label: "结束", date: form.due_date, time: form.due_time }
  ];
  const projectedForm = openPicker ? projectPickerForm(openPicker) : form;
  const pickerRangeValid = taskRangeIsValid(projectedForm);
  const [calendarYear, calendarMonth] = monthKey.split("-").map(Number);

  return <>
  <div className="apple-schedule-editor" role="group" aria-label="任务时间范围">
    <header><div><strong>时间范围</strong><span>限定可安排日期；跨日按工作量分配。</span></div>{form.earliest_start_date || form.due_date ? <button type="button" disabled={disabled} onClick={() => { onChange({ ...form, earliest_start_date: "", earliest_start_time: "", due_date: "", due_time: "" }); setOpenPicker(null); }}>清除时间</button> : <button type="button" disabled={disabled} onClick={() => { const defaults = newTaskDefaultForm(); onChange({ ...form, earliest_start_date: defaults.earliest_start_date, earliest_start_time: defaults.earliest_start_time, due_date: defaults.due_date, due_time: defaults.due_time }); }}>恢复推荐</button>}</header>
    <div className="apple-schedule-rows">{rows.map((row) => <div className="apple-schedule-row" key={row.field}>
      <span className="apple-schedule-label">{row.label}</span>
      <div className="apple-schedule-values"><button type="button" className={openPicker?.field === row.field ? "is-active" : ""} disabled={disabled} aria-haspopup="dialog" aria-expanded={openPicker?.field === row.field} onClick={() => openSchedulePicker(row.field)}><Icon name="calendar" size={14} />{pickerDateLabel(row.date)}</button><button type="button" className={openPicker?.field === row.field ? "is-active" : ""} disabled={disabled} aria-haspopup="dialog" aria-expanded={openPicker?.field === row.field} onClick={() => openSchedulePicker(row.field)}><Icon name="clock" size={14} />{row.time || "选择时间"}</button></div>
    </div>)}</div>
    {!taskRangeIsValid(form) && <p className="apple-schedule-error" role="alert">结束时间必须晚于开始时间，请重新选择。</p>}
  </div>
  {openPicker && createPortal(
    <div className="schedule-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSchedulePicker(); }}>
      <div className="schedule-picker-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="schedule-picker-title" tabIndex={-1}>
        <header className="schedule-picker-header">
          <div><span>{openPicker.field === "start" ? "任务开始" : "任务结束"}</span><h2 id="schedule-picker-title">选择{openPicker.field === "start" ? "开始" : "结束"}时间</h2></div>
          <strong><Icon name="calendar" size={15} />{pickerDateLabel(openPicker.date)}<i />{openPicker.time}</strong>
        </header>
        <div className="schedule-picker-body">
          <section className="schedule-picker-calendar" aria-label="选择日期">
            <header><div><span>日期</span><strong>{calendarYear}年{calendarMonth}月</strong></div><div><button type="button" aria-label="上个月" onClick={() => setMonthKey(shiftMonthKey(monthKey, -1))}><Icon name="chevron-left" size={17} /></button><button type="button" aria-label="下个月" onClick={() => setMonthKey(shiftMonthKey(monthKey, 1))}><Icon name="chevron-right" size={17} /></button></div></header>
            <div className="apple-date-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="apple-date-grid">{cells.map((cell) => <button key={cell.key} type="button" className={`${cell.inMonth ? "" : "outside "}${cell.key === todayDate ? "today " : ""}${cell.key === openPicker.date ? "selected" : ""}`.trim()} aria-label={cell.key === todayDate ? `${cell.day}，今天` : undefined} aria-current={cell.key === todayDate ? "date" : undefined} aria-pressed={cell.key === openPicker.date} onClick={() => updatePickerDate(cell.key)}>{cell.day}</button>)}</div>
          </section>
          <section className="schedule-picker-timeline" aria-label="选择时间">
            <header><div><span>时间</span><strong>24 小时</strong></div><small>每 5 分钟</small></header>
            <div className="schedule-timeline-list" ref={timelineRef} role="listbox" aria-label="时间轴">{timelineTimes.map((time) => <button key={time} type="button" role="option" aria-selected={time === openPicker.time} className={time.endsWith(":00") ? "is-hour" : ""} onClick={() => updatePickerTime(time)}><time>{time}</time><span aria-hidden="true" /></button>)}</div>
          </section>
        </div>
        <footer className="schedule-picker-footer">
          <p className={pickerRangeValid ? "" : "is-visible"} role={pickerRangeValid ? undefined : "alert"}>{pickerRangeValid ? "" : "结束时间必须晚于开始时间"}</p>
          <div><button type="button" className="secondary-action" onClick={closeSchedulePicker}>取消</button><button type="button" className="schedule-picker-confirm" disabled={!pickerRangeValid} onClick={confirmSchedulePicker}>确认</button></div>
        </footer>
      </div>
    </div>, document.body)}
  </>;
}

function TaskEditorRegions({
  form,
  disabled,
  idPrefix,
  autoFocusTitle = false,
  estimateHint,
  estimateAction,
  onChange,
  onScheduleChange
}: {
  form: NewTaskForm;
  disabled: boolean;
  idPrefix: string;
  autoFocusTitle?: boolean;
  estimateHint?: string | null;
  estimateAction?: { label: string; onClick: () => void } | null;
  onChange: (form: NewTaskForm) => void;
  onScheduleChange: (form: NewTaskForm) => void;
}) {
  const contentTitleId = `${idPrefix}-content-region-title`;
  const attributesTitleId = `${idPrefix}-attributes-region-title`;
  const titleId = `${idPrefix}-title`;
  const notesId = `${idPrefix}-notes`;
  const priorityId = `${idPrefix}-priority`;
  const estimateId = `${idPrefix}-estimate`;
  const tagsId = `${idPrefix}-tags`;

  return <>
    <section className="task-form-region task-content-region" aria-labelledby={contentTitleId}>
      <header><div><strong id={contentTitleId}>任务内容</strong><span>先记下要完成的事，细节可随后补充。</span></div></header>
      <div className="task-content-fields">
        <div className="task-title-tags-row">
          <label htmlFor={titleId}>标题<input id={titleId} autoFocus={autoFocusTitle} value={form.title} maxLength={300} required placeholder="例如：整理项目周报" onChange={(event) => onChange({ ...form, title: event.target.value })} /></label>
          <label className="task-tags-field" htmlFor={tagsId}>标签<input id={tagsId} value={form.tags.join("，")} maxLength={620} placeholder="例如：今序，健康" disabled={disabled} onChange={(event) => onChange({ ...form, tags: event.target.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean).slice(0, 20) })} /><small>逗号分隔，最多 20 个</small></label>
        </div>
        <label htmlFor={notesId}>备注<textarea id={notesId} value={form.notes} rows={3} placeholder="补充说明（可选）" onChange={(event) => onChange({ ...form, notes: event.target.value })} /></label>
      </div>
    </section>
    <section className="task-form-region task-planning-section" aria-labelledby={attributesTitleId}>
      <header><div><strong id={attributesTitleId}>安排与属性</strong><span>设置可安排日期、处理顺序与预计工作量。</span></div></header>
      <TaskScheduleEditor form={form} disabled={disabled} onChange={onScheduleChange} />
      <div className="task-attribute-grid">
        <div className="task-attribute-field"><div className="task-field-heading"><label htmlFor={priorityId}>优先级</label></div><select id={priorityId} value={form.priority ?? ""} onChange={(event) => onChange({ ...form, priority: (event.target.value || null) as NewTaskForm["priority"] })}><option value="">未设置</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></div>
        <div className="task-attribute-field estimate-field"><div className="task-field-heading"><label htmlFor={estimateId}>预计工作量</label></div><div className="estimate-input"><input id={estimateId} type="number" min={1} max={525600} value={form.estimated_minutes ?? ""} placeholder="分钟" onChange={(event) => onChange({ ...form, estimated_minutes: event.target.value ? Number(event.target.value) : null })} /><span>分钟</span></div><div className="estimate-field-footer"><small title={estimateHint ?? undefined}>{estimateHint ?? ""}</small>{estimateAction && <button type="button" disabled={disabled} onClick={estimateAction.onClick}>{estimateAction.label}</button>}</div></div>
      </div>
    </section>
  </>;
}

function RecurringItemEditor({ form, disabled, idPrefix, autoFocusTitle = false, onChange }: {
  form: RecurringItemForm;
  disabled: boolean;
  idPrefix: string;
  autoFocusTitle?: boolean;
  onChange: (form: RecurringItemForm) => void;
}) {
  const previewDates = recurringItemPreviewDates(form);
  const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];
  return <>
    <section className="task-form-region task-content-region" aria-labelledby={`${idPrefix}-content-title`}>
      <header><div><strong id={`${idPrefix}-content-title`}>事项内容</strong><span>先记下要持续做的事，细节可随后补充。</span></div></header>
      <div className="task-content-fields">
        <label htmlFor={`${idPrefix}-title`}>标题<input id={`${idPrefix}-title`} autoFocus={autoFocusTitle} required maxLength={300} value={form.title} placeholder="例如：晨间拉伸" onChange={(event) => onChange({ ...form, title: event.target.value })} /></label>
        <label htmlFor={`${idPrefix}-notes`}>备注<textarea id={`${idPrefix}-notes`} rows={3} maxLength={2000} value={form.notes} placeholder="补充说明（可选）" onChange={(event) => onChange({ ...form, notes: event.target.value })} /></label>
      </div>
    </section>
    <section className="task-form-region recurring-rule-section" aria-labelledby={`${idPrefix}-rule-title`}>
      <header><strong id={`${idPrefix}-rule-title`}>重复规则</strong><span>只保存一条规则，不会批量生成任务。</span></header>
      <div className="task-recurrence-grid">
        <label>频率<select disabled={disabled} value={form.frequency} onChange={(event) => onChange({ ...form, frequency: event.target.value as RecurrenceInput["frequency"] })}><option value="daily">每天</option><option value="weekdays">工作日</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label>
        <label>间隔<span className="recurrence-inline"><input type="number" min={1} max={365} disabled={disabled} value={form.interval_value} onChange={(event) => onChange({ ...form, interval_value: Math.max(1, Number(event.target.value) || 1) })} />个周期</span></label>
        <label>开始日期<input type="date" disabled={disabled} value={form.starts_on} onChange={(event) => onChange({ ...form, starts_on: event.target.value })} /></label>
        <label>结束日期<input type="date" disabled={disabled} min={form.starts_on} value={form.ends_on} onChange={(event) => onChange({ ...form, ends_on: event.target.value })} /></label>
        {form.frequency === "weekly" && <fieldset className="recurrence-weekdays"><legend>星期</legend><div>{weekdayLabels.map((label, index) => { const day = index + 1; const selected = form.weekdays.includes(day); return <button key={day} type="button" aria-pressed={selected} disabled={disabled} onClick={() => onChange({ ...form, weekdays: selected ? form.weekdays.filter((item) => item !== day) : [...form.weekdays, day].sort() })}>周{label}</button>; })}</div></fieldset>}
        {form.frequency === "monthly" && <label>每月日期<input type="number" min={1} max={31} disabled={disabled} value={form.month_day ?? 1} onChange={(event) => onChange({ ...form, month_day: Math.min(31, Math.max(1, Number(event.target.value) || 1)) })} /></label>}
      </div>
      <div className="recurring-preview" role="status"><span>接下来</span>{previewDates.length ? previewDates.map((date) => <time key={date}>{pickerDateLabel(date)}</time>) : <strong>当前规则没有可发生日期</strong>}</div>
    </section>
    <section className="task-form-region recurring-display-section" aria-labelledby={`${idPrefix}-display-title`}>
      <header><strong id={`${idPrefix}-display-title`}>今日页展示</strong><span>设置展示时间与预计时长后，以非阻塞时间块显示。</span></header>
      <div className="recurring-display-grid"><label>展示时间<input type="time" step={300} disabled={disabled} value={form.display_time} onChange={(event) => onChange({ ...form, display_time: event.target.value })} /></label><label>预计时长<div className="estimate-input"><input type="number" min={1} max={1440} disabled={disabled} value={form.display_duration_minutes ?? ""} placeholder="分钟" onChange={(event) => onChange({ ...form, display_duration_minutes: event.target.value ? Number(event.target.value) : null })} /><span>分钟</span></div></label><label>标签<input value={form.tags.join("，")} maxLength={620} disabled={disabled} placeholder="例如：健康，习惯" onChange={(event) => onChange({ ...form, tags: event.target.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean).slice(0, 20) })} /></label></div>
      <p className="recurring-display-help">{form.display_time && form.display_duration_minutes ? `${form.display_time} 起显示 ${form.display_duration_minutes} 分钟的重复事项块；可与其他事项重叠。` : form.display_time ? "还需填写预计时长，才能在时间线显示为事项块。" : "未设置时间时，到期事项显示在今日页顶部的重复事项区域。"}</p>
    </section>
  </>;
}

function TaskTagChips({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  const visibleTags = tags.slice(0, 2);
  const hiddenTagCount = tags.length - visibleTags.length;

  return <span className="task-tag-list" role="group" aria-label={`标签：${tags.join("、")}`}>
    {visibleTags.map((tag) => <span className="task-tag-chip" aria-hidden="true" key={tag}>{tag}</span>)}
    {hiddenTagCount > 0 && <span className="task-tag-chip task-tag-count" aria-hidden="true">+{hiddenTagCount}</span>}
  </span>;
}

function TaskCapsuleContent({
  title,
  notes,
  priority,
  tags = [],
  timing,
  minutes,
  status,
  sourceType,
  typeLabel,
  compact = false
}: {
  title: string;
  notes?: string | null;
  priority?: Task["priority"];
  tags?: string[];
  timing?: string | null;
  minutes?: number | null;
  status: string;
  sourceType?: Task["source_type"];
  typeLabel?: string;
  compact?: boolean;
}) {
  return <span className={`task-capsule-content${compact ? " compact" : ""}`}>
    <span className="task-capsule-heading">
      <strong title={title}>{title}</strong>
      <span className="task-capsule-heading-meta">
        {typeLabel && <span className="task-type-badge">{typeLabel}</span>}
        {priority && <span className={`priority-badge priority-${priority}`}>{priorityCopy[priority]}</span>}
        {sourceType && <span className={`task-source-icon source-${sourceType}`} role="img" aria-label={sourceType === "ai_assistant" ? "AI 创建" : "手动创建"} title={sourceType === "ai_assistant" ? "AI 创建" : "手动创建"}><Icon name={sourceType === "ai_assistant" ? "sparkle" : "user"} size={13} /></span>}
      </span>
    </span>
    {notes && <span className="task-capsule-notes" title={notes}>{notes}</span>}
    {tags.length > 0 && <span className="task-capsule-tags"><TaskTagChips tags={tags} /></span>}
    <span className="task-capsule-footer">
      <span className="task-capsule-facts">
        {timing && <span><Icon name="calendar" size={13} />{timing}</span>}
        {minutes !== null && minutes !== undefined && <span><Icon name="clock" size={13} />{minutes} 分钟</span>}
      </span>
      <span className="task-capsule-status">{status}</span>
    </span>
  </span>;
}

function recurringItemStatusLabel(item: RecurringItem) {
  if (item.deleted_at) return "已删除";
  if (item.status === "active") return "生效中";
  if (item.status === "paused") return "已暂停";
  return "已结束";
}

function RecurringItemCapsuleContent({ item }: { item: RecurringItem }) {
  return <span className="recurring-capsule-content">
    <span className="recurring-capsule-heading">
      <strong title={item.title}>{item.title}</strong>
      <span className="recurring-capsule-meta">
        <span className="task-type-badge recurring">重复事项</span>
        <span className={`recurring-status status-${item.deleted_at ? "deleted" : item.status}`}>{recurringItemStatusLabel(item)}</span>
      </span>
    </span>
    {item.notes && <span className="ledger-note" title={item.notes}>{item.notes}</span>}
    <span className="ledger-facts">
      <span className="ledger-fact"><Icon name="restore" size={13} />{item.frequency === "daily" ? "每天" : item.frequency === "weekdays" ? "工作日" : item.frequency === "weekly" ? "每周" : "每月"}</span>
      {item.display_time && <span className="ledger-fact"><Icon name="clock" size={13} />{item.display_time} 展示</span>}
      <TaskTagChips tags={item.tags} />
    </span>
  </span>;
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
  requestedView
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
}) {
  const [view, setView] = useState<TaskView>("open");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ManualTaskUpdate | null>(null);
  const [creating, setCreating] = useState(false);
  const [createItemType, setCreateItemType] = useState<CreateItemType>("task");
  const initialRecurringForm = useRef<RecurringItemForm>(recurringItemDefaultForm(today));
  const [recurringForm, setRecurringForm] = useState<RecurringItemForm>(initialRecurringForm.current);
  const [selectedRecurringId, setSelectedRecurringId] = useState<string | null>(null);
  const initialNewTaskForm = useRef<NewTaskForm>(newTaskDefaultForm());
  const [newTaskForm, setNewTaskForm] = useState<NewTaskForm>(initialNewTaskForm.current);
  const [newTaskEstimateMode, setNewTaskEstimateMode] = useState<"auto" | "manual">("auto");
  const [newTaskAutosaveArmed, setNewTaskAutosaveArmed] = useState(false);
  const [persistedNewTaskDraft, setPersistedNewTaskDraft] = useState<TaskDraft | null>(null);
  const [taskDrafts, setTaskDrafts] = useState<TaskDraft[]>([]);
  const [taskDraftsLoading, setTaskDraftsLoading] = useState(true);
  const [draftSaving, setDraftSaving] = useState(false);
  const [newTaskError, setNewTaskError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<{ id: number; message: string; undoId?: string } | null>(null);
  const [pendingTrashTask, setPendingTrashTask] = useState<{ id: string; title: string } | null>(null);
  const [pendingDiscardTaskDraft, setPendingDiscardTaskDraft] = useState<TaskDraft | null>(null);
  const [pendingEndRecurringItem, setPendingEndRecurringItem] = useState<RecurringItem | null>(null);
  const [pendingTrashRecurringItem, setPendingTrashRecurringItem] = useState<RecurringItem | null>(null);
  const preferredSelection = useRef<string | null>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const ledgerRef = useRef<HTMLDivElement>(null);
  const ledgerResizeSession = useRef<LedgerResizeSession | null>(null);
  const [ledgerListWidth, setLedgerListWidth] = useState<number | null>(null);
  const [ledgerMaximumWidth, setLedgerMaximumWidth] = useState(TASK_LEDGER_LIST_DEFAULT_WIDTH);
  const [resizingLedger, setResizingLedger] = useState(false);
  const [pendingTaskChange, setPendingTaskChange] = useState<PendingTaskChange | null>(null);
  const [taskMetadata, setTaskMetadata] = useState<{ task_id: string; tags: string[]; recurrence: RecurrenceInput | null } | null>(null);
  const initialTaskMetadata = useRef<{ task_id: string; tags: string[]; recurrence: RecurrenceInput | null } | null>(null);
  const [pendingRecurringSave, setPendingRecurringSave] = useState<TaskDraftInput | null>(null);
  const [pendingDiscardNew, setPendingDiscardNew] = useState(false);
  const [pendingDraftSelection, setPendingDraftSelection] = useState<TaskDraft | null>(null);
  const [pendingPermanentTask, setPendingPermanentTask] = useState(false);
  const [pendingPermanentRecurringItem, setPendingPermanentRecurringItem] = useState(false);
  const [pendingCreateType, setPendingCreateType] = useState<CreateItemType | null>(null);
  const handledRequestedView = useRef<TaskViewRequest | null>(null);
  const taskViewInitialized = useRef(false);
  const [taskViewReady, setTaskViewReady] = useState(false);

  useEffect(() => {
    if (!requestedView || handledRequestedView.current === requestedView) return;
    if (requestedView.taskId) {
      const target = tasks.find((task) => task.id === requestedView.taskId);
      if (target) {
        setView(viewForStatus(target.status));
        setCreating(false);
        setSelectedId(target.id);
        setDraft(draftForTask(target));
        handledRequestedView.current = requestedView;
        taskViewInitialized.current = true;
        setTaskViewReady(true);
      }
    } else if (requestedView.createTask) {
      const defaults = newTaskDefaultForm();
      const recurringDefaults = recurringItemDefaultForm(today);
      setView("draft");
      setCreating(true);
      setCreateItemType("task");
      initialNewTaskForm.current = defaults;
      setNewTaskForm(defaults);
      initialRecurringForm.current = recurringDefaults;
      setRecurringForm(recurringDefaults);
      setNewTaskEstimateMode("auto");
      setNewTaskAutosaveArmed(false);
      setPersistedNewTaskDraft(null);
      setNewTaskError(null);
      setFeedback(null);
      setSelectedId(null);
      setDraft(null);
      handledRequestedView.current = requestedView;
      taskViewInitialized.current = true;
      setTaskViewReady(true);
    } else if (requestedView.view) {
      setView(requestedView.view);
      setCreating(false);
      setSelectedId(null);
      setDraft(null);
      handledRequestedView.current = requestedView;
      taskViewInitialized.current = true;
      setTaskViewReady(true);
    }
    setFilterMenuOpen(false);
  }, [requestedView, tasks]);

  useEffect(() => {
    if (!filterMenuOpen) return;
    function closeFilterMenu(event: PointerEvent) {
      if (!filterMenuRef.current?.contains(event.target as Node)) setFilterMenuOpen(false);
    }
    function closeFilterMenuWithKeyboard(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setFilterMenuOpen(false);
    }
    window.addEventListener("pointerdown", closeFilterMenu);
    window.addEventListener("keydown", closeFilterMenuWithKeyboard);
    return () => {
      window.removeEventListener("pointerdown", closeFilterMenu);
      window.removeEventListener("keydown", closeFilterMenuWithKeyboard);
    };
  }, [filterMenuOpen]);

  const availableTags = useMemo(() => [...new Set([
    ...tasks.flatMap((task) => task.tags),
    ...recurringItems.filter((item) => !item.deleted_at).flatMap((item) => item.tags)
  ])].sort((left, right) => left.localeCompare(right, "zh-CN")), [tasks, recurringItems]);
  const visibleTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    return tasks.filter((task) => taskMatchesView(task, view)
      && (!tagFilter || task.tags.includes(tagFilter))
      && (!query || task.title.toLocaleLowerCase("zh-CN").includes(query) || task.notes?.toLocaleLowerCase("zh-CN").includes(query) || task.tags.some((tag) => tag.toLocaleLowerCase("zh-CN").includes(query))));
  }, [tasks, view, search, tagFilter]);
  const visibleTaskDrafts = useMemo(() => {
    if (view !== "draft") return [];
    const query = search.trim().toLocaleLowerCase("zh-CN");
    return taskDrafts.filter((item) => !query
      || item.title.toLocaleLowerCase("zh-CN").includes(query)
      || item.notes?.toLocaleLowerCase("zh-CN").includes(query));
  }, [taskDrafts, view, search]);
  const visibleRecurringItems = useMemo(() => {
    if (view !== "recurring" && view !== "deleted") return [];
    const query = search.trim().toLocaleLowerCase("zh-CN");
    return recurringItems.filter((item) => (view === "deleted" ? Boolean(item.deleted_at) : !item.deleted_at)
      && (!tagFilter || item.tags.includes(tagFilter))
      && (!query
        || item.title.toLocaleLowerCase("zh-CN").includes(query)
        || item.notes?.toLocaleLowerCase("zh-CN").includes(query)
        || item.tags.some((tag) => tag.toLocaleLowerCase("zh-CN").includes(query))));
  }, [recurringItems, view, search, tagFilter]);
  const selectedTask = tasks.find((task) => task.id === selectedId) ?? null;
  const selectedRecurringItem = recurringItems.find((item) => item.id === selectedRecurringId) ?? null;
  const metadataDirty = Boolean(taskMetadata && initialTaskMetadata.current
    && JSON.stringify({ tags: taskMetadata.tags, recurrence: taskMetadata.recurrence })
      !== JSON.stringify({ tags: initialTaskMetadata.current.tags, recurrence: initialTaskMetadata.current.recurrence }));
  const isDirty = !draftMatchesTask(draft, selectedTask) || metadataDirty;
  const recurringFormIsDirty = creating && JSON.stringify(recurringForm) !== JSON.stringify(initialRecurringForm.current);
  const newTaskIsDirty = creating && (createItemType === "task"
    ? !newTaskFormMatches(newTaskForm, initialNewTaskForm.current)
    : recurringFormIsDirty);
  const recurringEditingDirty = !creating && view === "recurring" && selectedRecurringItem
    ? JSON.stringify(recurringForm) !== JSON.stringify(recurringItemFormForItem(selectedRecurringItem))
    : false;
  const hasUnsavedChanges = isDirty || newTaskIsDirty || recurringEditingDirty;
  const newTaskHasDate = Boolean(newTaskForm.earliest_start_date || newTaskForm.due_date);
  const newTaskHasValidRange = taskRangeIsValid(newTaskForm);
  const newTaskRangeMinutes = sameDayTaskRangeMinutes(newTaskForm);
  const newTaskEstimateHint = newTaskForm.earliest_start_date && newTaskForm.due_date
    && newTaskForm.earliest_start_date !== newTaskForm.due_date
    ? "跨日任务，请确认预计工作量"
    : newTaskEstimateMode === "manual"
      ? "使用手动值，不会被时间调整覆盖"
      : null;
  const selectedMetadata = taskMetadata?.task_id === selectedTask?.id ? taskMetadata : null;
  const editingTaskForm = draft ? {
    ...taskFormForManualUpdate(draft),
    tags: selectedMetadata?.tags ?? selectedTask?.tags ?? [],
    recurrence: selectedMetadata?.recurrence ?? null
  } : null;
  const editingTaskEstimateHint = editingTaskForm?.earliest_start_date && editingTaskForm.due_date
    && editingTaskForm.earliest_start_date !== editingTaskForm.due_date
    ? "跨日任务，请确认预计工作量"
    : null;

  function updateNewTaskFields(next: NewTaskForm) {
    if (next.estimated_minutes !== newTaskForm.estimated_minutes) setNewTaskEstimateMode("manual");
    setNewTaskAutosaveArmed(true);
    setNewTaskForm(next);
  }

  async function applyCreateItemType(type: CreateItemType) {
    const outgoingDraft = createItemType === "task" ? persistedNewTaskDraft : null;
    if (outgoingDraft) {
      setDraftSaving(true);
      try {
        await discardTaskDraft(outgoingDraft);
        setTaskDrafts((current) => current.filter((item) => item.id !== outgoingDraft.id));
      } catch (reason) {
        setNewTaskError(`无法切换类型：当前草稿未能放弃：${String(reason)}`);
        return;
      } finally {
        setDraftSaving(false);
      }
    }
    const title = createItemType === "task" ? newTaskForm.title : recurringForm.title;
    const notes = createItemType === "task" ? newTaskForm.notes : recurringForm.notes;
    const tags = createItemType === "task" ? newTaskForm.tags : recurringForm.tags;
    if (type === "task") {
      const defaults = newTaskDefaultForm();
      const next = { ...defaults, title, notes, tags };
      initialNewTaskForm.current = defaults;
      setNewTaskForm(next);
    } else {
      const defaults = recurringItemDefaultForm(today);
      const next = { ...defaults, title, notes, tags };
      initialRecurringForm.current = defaults;
      setRecurringForm(next);
    }
    setPersistedNewTaskDraft(null);
    setNewTaskAutosaveArmed(false);
    setNewTaskError(null);
    setCreateItemType(type);
  }

  function requestCreateItemType(type: CreateItemType) {
    if (type === createItemType) return;
    if (newTaskIsDirty || persistedNewTaskDraft) {
      setNewTaskAutosaveArmed(false);
      setPendingCreateType(type);
    } else void applyCreateItemType(type);
  }

  function updateEditingTaskForm(next: NewTaskForm) {
    setDraft(manualUpdateForTaskForm(next));
    if (selectedTask) setTaskMetadata({ task_id: selectedTask.id, tags: next.tags, recurrence: next.recurrence });
  }

  function updateNewTaskSchedule(next: NewTaskForm) {
    setNewTaskAutosaveArmed(true);
    if (newTaskEstimateMode === "auto") {
      const estimate = sameDayTaskRangeMinutes(next);
      setNewTaskForm(estimate === null ? next : { ...next, estimated_minutes: estimate });
      return;
    }
    setNewTaskForm(next);
  }

  function recalculateNewTaskEstimate() {
    if (newTaskRangeMinutes === null) return;
    setNewTaskAutosaveArmed(true);
    setNewTaskEstimateMode("auto");
    setNewTaskForm({ ...newTaskForm, estimated_minutes: newTaskRangeMinutes });
  }

  useEffect(() => { onDirtyChange(hasUnsavedChanges); }, [hasUnsavedChanges, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  async function refreshTaskDrafts() {
    setTaskDraftsLoading(true);
    try {
      setTaskDrafts(await listTaskDrafts(false));
    } catch (reason) {
      setFeedback(`草稿没有读出来：${String(reason)}`);
    } finally {
      setTaskDraftsLoading(false);
    }
  }

  useEffect(() => { void refreshTaskDrafts(); }, []);

  async function persistCurrentTaskDraft(showFeedback = false) {
    if (!creating || createItemType !== "task" || draftSaving || !newTaskIsDirty) return persistedNewTaskDraft;
    setDraftSaving(true);
    try {
      const input = taskDraftInputForForm(newTaskForm);
      const saved = persistedNewTaskDraft
        ? await saveTaskDraft(persistedNewTaskDraft.id, persistedNewTaskDraft.version, input)
        : await createManualTaskDraft(input);
      setPersistedNewTaskDraft(saved);
      setTaskDrafts((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      initialNewTaskForm.current = taskFormForPersistedDraft(saved);
      if (showFeedback) setFeedback("草稿已保存到本机，尚未创建正式任务。");
      return saved;
    } catch (reason) {
      setNewTaskError(`草稿未保存：${String(reason)}`);
      return null;
    } finally {
      setDraftSaving(false);
    }
  }

  useEffect(() => {
    if (!creating || createItemType !== "task" || !newTaskIsDirty || !newTaskAutosaveArmed || busy || draftSaving) return;
    const timer = window.setTimeout(() => { void persistCurrentTaskDraft(false); }, 500);
    return () => window.clearTimeout(timer);
  }, [creating, createItemType, newTaskForm, newTaskIsDirty, newTaskAutosaveArmed, busy, draftSaving, persistedNewTaskDraft?.id, persistedNewTaskDraft?.version]);

  useEffect(() => {
    if (!successToast) return;
    const timer = window.setTimeout(() => setSuccessToast(null), successToast.undoId ? 10_000 : 2400);
    return () => window.clearTimeout(timer);
  }, [successToast]);

  async function showCommittedToast(message: string) {
    const undo = await latestUndo().catch(() => null);
    setSuccessToast({ id: Date.now(), message, undoId: undo?.id });
  }

  async function undoLastChange(undoId: string) {
    try {
      await applyUndo(undoId);
      setSuccessToast(null);
      await onReload(false);
      setSelectedId(null);
      setDraft(null);
      setFeedback("已通过新的 SQLite 事务撤销上一项操作。");
    } catch (reason) {
      setSuccessToast(null);
      setFeedback(`无法撤销：${String(reason)}`);
    }
  }

  useEffect(() => {
    if (creating) return;
    if (view === "recurring") { setSelectedId(null); return; }
    if (view === "deleted") return;
    if (isDirty && selectedTask) return;
    if (preferredSelection.current) {
      if (visibleTasks.some((task) => task.id === preferredSelection.current)) {
        setSelectedId(preferredSelection.current);
        preferredSelection.current = null;
      }
      return;
    }
    if (!visibleTasks.some((task) => task.id === selectedId)) setSelectedId(visibleTasks[0]?.id ?? null);
  }, [view, visibleTasks, selectedId, isDirty, selectedTask, creating]);

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
    if (!selectedTask) { setDraft(null); return; }
    setDraft(draftForTask(selectedTask));
  }, [selectedTask?.id, selectedTask?.updated_at]);

  useEffect(() => {
    if (!selectedTask || selectedTask.status === "deleted") {
      setTaskMetadata(null);
      initialTaskMetadata.current = null;
      return;
    }
    let active = true;
    void getTaskMetadata(selectedTask.id).then((metadata) => {
      if (!active) return;
      setTaskMetadata(metadata);
      initialTaskMetadata.current = metadata;
    }).catch((reason) => { if (active) setFeedback(`任务标签与重复规则没有读出来：${String(reason)}`); });
    return () => { active = false; };
  }, [selectedTask?.id, selectedTask?.updated_at]);

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
    inbox: tasks.filter((task) => task.status === "inbox").length,
    open: tasks.filter((task) => task.status === "open").length,
    scheduled: tasks.filter((task) => task.status === "scheduled").length,
    done: tasks.filter((task) => task.status === "done").length,
    cancelled: tasks.filter((task) => task.status === "cancelled").length,
    deleted: tasks.filter((task) => task.status === "deleted").length + recurringItems.filter((item) => item.deleted_at).length
  }), [tasks, taskDrafts, recurringItems]);

  useEffect(() => {
    if (loading || taskViewInitialized.current || requestedView) return;
    taskViewInitialized.current = true;
    const operationalViews: TaskView[] = ["open", "inbox", "scheduled"];
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
    if (!taskViewReady || !["open", "inbox", "scheduled"].includes(view)) return;
    void setUiSetting(TASK_QUEUE_VIEW_SETTING, view).catch(() => undefined);
  }, [view, taskViewReady]);

  async function commitDraft(scope?: "this" | "future") {
    if (!selectedTask || !draft || busy || !isDirty) return !isDirty;
    const form = editingTaskForm;
    if (!form) return false;
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
          });
      if (!scope) await setTaskTags(selectedTask.id, form.tags);
      const metadata = await getTaskMetadata(selectedTask.id);
      setTaskMetadata(metadata);
      initialTaskMetadata.current = metadata;
      onTaskCommitted({ ...committed, tags: metadata.tags });
      setDraft(draftForTask(committed));
      setPendingRecurringSave(null);
      setFeedback(null);
      await showCommittedToast("任务更改已保存到本机");
      return true;
    } catch (reason) {
      setFeedback(`未保存：${String(reason)}`);
      return false;
    } finally { setBusy(false); }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void commitDraft();
  }

  function resetDraft() {
    if (!selectedTask || !isDirty) return;
    setDraft(draftForTask(selectedTask));
    setTaskMetadata(initialTaskMetadata.current);
    setFeedback("未保存的修改已丢弃。");
  }

  function clearNewTaskForm() {
    setCreating(false);
    const empty = emptyNewTaskForm();
    initialNewTaskForm.current = empty;
    setNewTaskForm(empty);
    setNewTaskEstimateMode("auto");
    setNewTaskAutosaveArmed(false);
    setPersistedNewTaskDraft(null);
    setNewTaskError(null);
    setCreateItemType("task");
    const recurringDefaults = recurringItemDefaultForm(today);
    initialRecurringForm.current = recurringDefaults;
    setRecurringForm(recurringDefaults);
  }

  async function commitNewTask() {
    if (createItemType === "recurring") {
      if (busy || !recurringForm.title.trim()) return false;
      if (recurringForm.frequency === "weekly" && !recurringForm.weekdays.length) {
        setNewTaskError("每周重复至少选择一个星期。");
        return false;
      }
      setBusy(true);
      setNewTaskError(null);
      try {
        const item = await createRecurringItem(recurringItemInputForForm(recurringForm));
        await onRecurringChanged();
        setView("recurring");
        setSelectedRecurringId(item.id);
        clearNewTaskForm();
        setFeedback("重复事项已保存；不会进入 Inbox、待处理或已安排任务队列。");
        setSuccessToast({ id: Date.now(), message: "重复事项已创建" });
        return true;
      } catch (reason) {
        setNewTaskError(`重复事项未创建：${String(reason)}`);
        return false;
      } finally {
        setBusy(false);
      }
    }
    if (busy || !newTaskForm.title.trim() || !newTaskHasValidRange) return false;
    setBusy(true);
    setSuccessToast(null);
    setNewTaskError(null);
    let persisted = persistedNewTaskDraft;
    try {
      const input = taskDraftInputForForm(newTaskForm);
      persisted = persisted
        ? await saveTaskDraft(persisted.id, persisted.version, input)
        : await createManualTaskDraft(input);
      setPersistedNewTaskDraft(persisted);
      const committed = await confirmTaskDraft(persisted);
      preferredSelection.current = committed.id;
      onTaskCommitted(committed);
      setView(viewForStatus(committed.status));
      clearNewTaskForm();
      await refreshTaskDrafts();
      await onReload(false);
      setSelectedId(committed.id);
      setFeedback(null);
      await showCommittedToast(persisted.draft_kind === "update" ? "AI 修改草稿已确认并保存到本机" : committed.status === "inbox" ? "任务已创建并放入 Inbox" : "任务已创建并保存到本机");
      return true;
    } catch (reason) {
      if (persisted) setPersistedNewTaskDraft(persisted);
      setNewTaskError(persisted
        ? `草稿已保存在本机，但任务尚未创建：${String(reason)}`
        : `任务未创建：${String(reason)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function submitNewTask(event: FormEvent) {
    event.preventDefault();
    void commitNewTask();
  }

  async function cancelNewTask(requireConfirmation = true) {
    if (busy) return false;
    if (requireConfirmation && newTaskIsDirty) { setPendingDiscardNew(true); return false; }
    if (createItemType === "task" && persistedNewTaskDraft) {
      setBusy(true);
      try {
        await discardTaskDraft(persistedNewTaskDraft);
      } catch (reason) {
        setNewTaskError(`草稿未能放弃：${String(reason)}`);
        setBusy(false);
        return false;
      }
      setBusy(false);
    }
    clearNewTaskForm();
    await refreshTaskDrafts();
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
      setFeedback("草稿已放弃，正式任务没有变化。");
    } catch (reason) {
      setFeedback(`草稿未能放弃：${String(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function selectPersistedTaskDraft(item: TaskDraft) {
    if (creating && newTaskIsDirty && persistedNewTaskDraft?.id !== item.id) {
      setPendingDraftSelection(item);
      return;
    }
    await openPersistedTaskDraft(item);
  }

  async function openPersistedTaskDraft(item: TaskDraft) {
    const form = taskFormForPersistedDraft(item);
    setView("draft");
    setCreating(true);
    setSelectedId(null);
    setDraft(null);
    setPersistedNewTaskDraft(item);
    initialNewTaskForm.current = form;
    setNewTaskForm(form);
    setNewTaskEstimateMode("manual");
    setNewTaskAutosaveArmed(true);
    setNewTaskError(null);
    setFeedback(null);
  }

  async function saveAndSwitchPersistedTaskDraft(target: TaskDraft) {
    if (createItemType === "recurring") {
      const created = await commitNewTask();
      if (created) await openPersistedTaskDraft(target);
      return;
    }
    const saved = await persistCurrentTaskDraft(false);
    if (saved) await openPersistedTaskDraft(target);
  }

  async function keepCurrentDraft() {
    const saved = newTaskIsDirty ? await persistCurrentTaskDraft(true) : persistedNewTaskDraft;
    if (!saved) return;
    setCreating(false);
    setPersistedNewTaskDraft(null);
    setView("draft");
    await refreshTaskDrafts();
  }

  async function transition(target: TaskStatus) {
    if (!selectedTask || busy) return;
    setBusy(true);
    try {
      preferredSelection.current = selectedTask.id;
      const committed = await transitionManualTask(selectedTask.id, target);
      onTaskCommitted(committed);
      setView(viewForStatus(committed.status));
      await onReload(false);
      setSelectedId(selectedTask.id);
      setFeedback(`任务已更新为“${statusCopy[committed.status]}”。`);
    } catch (reason) { preferredSelection.current = null; setFeedback(`状态未改变：${String(reason)}`); }
    finally { setBusy(false); }
  }

  async function reopen() {
    if (!selectedTask || busy) return;
    setBusy(true);
    try {
      preferredSelection.current = selectedTask.id;
      const committed = await reopenManualTask(selectedTask.id, today);
      onTaskCommitted(committed);
      setView(viewForStatus(committed.status));
      await onReload(false);
      setSelectedId(selectedTask.id);
      setFeedback(committed.status === "scheduled"
        ? `“${selectedTask.title}”已取消完成，并恢复到今日计划。`
        : `“${selectedTask.title}”已取消完成，当前为待办。`);
    } catch (reason) { preferredSelection.current = null; setFeedback(`状态未改变：${String(reason)}`); }
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
      preferredSelection.current = target.id;
      await softDeleteManualTask(target.id, true);
      setView("deleted");
      await onReload(false);
      setSelectedId(target.id);
      setPendingTrashTask(null);
      setFeedback(null);
      setSuccessToast({ id: Date.now(), message: `“${target.title}”已移入回收站，可在回收站恢复` });
    } catch (reason) { preferredSelection.current = null; setFeedback(`未移入回收站：${String(reason)}`); }
    finally { setBusy(false); }
  }

  async function restore() {
    if (!selectedTask || busy) return;
    setBusy(true);
    try {
      preferredSelection.current = selectedTask.id;
      await restoreManualTask(selectedTask.id);
      setView("open");
      await onReload(false);
      setSelectedRecurringId(null);
      setSelectedId(selectedTask.id);
      setFeedback(`“${selectedTask.title}”已恢复。`);
    } catch (reason) { preferredSelection.current = null; setFeedback(`未恢复：${String(reason)}`); }
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
    } catch (reason) { setFeedback(`未永久删除：${String(reason)}`); }
    finally { setBusy(false); }
  }

  async function saveRecurringItem(event: FormEvent) {
    event.preventDefault();
    if (!selectedRecurringItem || busy || !recurringForm.title.trim()) return;
    setBusy(true);
    setFeedback("正在保存重复事项…");
    try {
      const saved = await updateRecurringItem(selectedRecurringItem.id, recurringItemInputForForm(recurringForm));
      await onRecurringChanged();
      setRecurringForm(recurringItemFormForItem(saved));
      setFeedback("重复事项已保存；历史发生记录没有被覆盖。");
    } catch (reason) {
      setFeedback(`重复事项未保存：${String(reason)}`);
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
      setFeedback(status === "active" ? "重复事项已恢复。" : status === "paused" ? "重复事项已暂停；历史记录继续保留。" : "重复事项已结束；历史记录继续保留。");
    } catch (reason) {
      setFeedback(`状态未改变：${String(reason)}`);
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
      setFeedback(`“${item.title}”已结束；历史记录继续保留。`);
    } catch (reason) {
      setFeedback(`重复事项未能结束：${String(reason)}`);
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
      setView("deleted");
      await onRecurringChanged();
      setSelectedId(null);
      setSelectedRecurringId(item.id);
      setPendingTrashRecurringItem(null);
      setFeedback(`“${item.title}”已移入回收站；历史发生与复盘记录仍保留。`);
    } catch (reason) {
      setFeedback(`重复事项未移入回收站：${String(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function restoreSelectedRecurringItem() {
    if (!selectedRecurringItem || busy) return;
    const item = selectedRecurringItem;
    setBusy(true);
    try {
      await restoreRecurringItem(item.id);
      setView("recurring");
      await onRecurringChanged();
      setSelectedId(null);
      setSelectedRecurringId(item.id);
      setFeedback(`“${item.title}”已恢复为已结束重复事项。`);
    } catch (reason) {
      setFeedback(`重复事项未恢复：${String(reason)}`);
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
      setFeedback(`重复事项未永久删除：${String(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  function applyTaskChange(change: PendingTaskChange) {
    setFeedback(null);
    if (creating) clearNewTaskForm();
    if (change.kind === "select") {
      preferredSelection.current = null;
      setSelectedRecurringId(null);
      setSelectedId(change.taskId);
    } else if (change.kind === "view") {
      preferredSelection.current = null;
      setView(change.view);
      if (change.view === "recurring") {
        setSelectedId(null);
        setSelectedRecurringId(recurringItems.find((item) => !item.deleted_at)?.id ?? null);
      } else if (change.view !== "deleted") {
        setSelectedRecurringId(null);
      }
    } else if (change.kind === "transition") {
      void transition(change.status);
    } else if (change.kind === "reopen") {
      void reopen();
    } else if (change.task) {
      setPendingTrashTask(change.task);
    } else {
      requestMoveToTrash();
    }
  }

  function requestTaskChange(change: PendingTaskChange) {
    if (busy) return;
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
      if (!await cancelNewTask(false)) return;
    } else if (selectedTask) {
      setDraft(draftForTask(selectedTask));
    }
    resolvePendingChange(true);
  }

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
      .catch((reason) => setFeedback(`分栏宽度未保存：${String(reason)}`));
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
      <div className="toast-viewport" aria-live="polite" aria-atomic="true">
        {successToast && <div key={successToast.id} className="success-toast" role="status"><span className="toast-icon"><Icon name="check" size={16} /></span><span>{successToast.message}</span>{successToast.undoId && <button type="button" onClick={() => void undoLastChange(successToast.undoId!)}>撤销</button>}</div>}
      </div>
      <div ref={ledgerRef} className={resizingLedger ? "task-ledger is-resizing" : "task-ledger"} style={ledgerListWidth ? { "--task-list-width": `${ledgerListWidth}px` } as CSSProperties : undefined}>
        <div className="task-ledger-list" aria-busy={loading}>
          <header className="task-queue-header">
            <div className="task-queue-heading">
              <div><h1>{taskViewCopy[view]}</h1><span>{view === "recurring" ? "独立规则" : view === "deleted" ? "普通任务与重复事项" : "任务队列"}{counts[view] + (creating && !persistedNewTaskDraft ? 1 : 0) > 0 ? ` · ${counts[view] + (creating && !persistedNewTaskDraft ? 1 : 0)} 项` : ""}</span></div>
              <div className="task-filter-control" ref={filterMenuRef}>
                <button className={`queue-filter-button${filterMenuOpen ? " is-open" : ""}${view !== "open" || search || tagFilter ? " is-filtered" : ""}`} type="button" aria-label={`筛选任务，当前为${taskViewCopy[view]}`} aria-haspopup="dialog" aria-expanded={filterMenuOpen} onClick={() => setFilterMenuOpen((open) => !open)}><Icon name="filter" size={19} /><span className="filter-button-state" aria-hidden="true" /></button>
                {filterMenuOpen && <section className="task-filter-menu" role="dialog" aria-label="筛选任务">
                  <header className="filter-menu-heading"><strong>筛选</strong>{(view !== "open" || search || tagFilter) && <button type="button" onClick={() => { requestTaskChange({ kind: "view", view: "open" }); setSearch(""); setTagFilter(""); }} aria-label="恢复默认筛选">重置</button>}</header>
                  <label className="task-search"><Icon name="search" size={16} /><span className="sr-only">搜索任务</span><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索任务" />{search && <button type="button" aria-label="清除搜索" onClick={() => setSearch("")}><Icon name="close" size={14} /></button>}</label>
                  <div className="filter-menu-options" role="radiogroup" aria-label="任务类型">
                    {taskViewGroups.map((group) => <div className="filter-menu-group" role="group" aria-label={group.label} key={group.label}>
                      <span className="filter-menu-caption">{group.label}</span>
                      {group.items.map((item) => (
                        <button key={item} type="button" role="radio" aria-checked={view === item} onClick={() => { requestTaskChange({ kind: "view", view: item }); setFilterMenuOpen(false); }}>
                          <span className={`filter-option-icon filter-option-${item}`}><Icon name={taskViewIcon[item]} size={16} /></span>
                          <span className="filter-option-copy"><strong>{taskViewCopy[item]}</strong></span>
                          <span className="filter-option-meta">{counts[item] > 0 && <em>{counts[item]}</em>}{view === item && <Icon name="check" size={15} />}</span>
                        </button>
                      ))}
                    </div>)}
                  </div>
                  {availableTags.length > 0 && <div className="task-tag-filter" aria-label="按标签筛选"><span>标签</span><div><button type="button" aria-pressed={!tagFilter} onClick={() => setTagFilter("")}>全部</button>{availableTags.map((tag) => <button type="button" key={tag} aria-pressed={tagFilter === tag} onClick={() => setTagFilter(tagFilter === tag ? "" : tag)}>#{tag}</button>)}</div></div>}
                </section>}
              </div>
            </div>
            {(search || tagFilter) && <div className="active-filter-row">{search && <button className="active-search-filter" type="button" onClick={() => setSearch("")} title="清除搜索"><Icon name="search" size={13} /><span>“{search}”</span><Icon name="close" size={12} /></button>}{tagFilter && <button className="active-search-filter" type="button" onClick={() => setTagFilter("")} title="清除标签筛选"><span>#{tagFilter}</span><Icon name="close" size={12} /></button>}</div>}
          </header>
          <p className="workspace-feedback" role="status" aria-live="polite">{feedback ?? ""}</p>
          {creating && view === "draft" && !persistedNewTaskDraft && <button type="button" aria-pressed="true" aria-label={`${createItemType === "task" ? newTaskForm.title.trim() || "未命名任务" : recurringForm.title.trim() || "未命名重复事项"}，${createItemType === "task" && draftSaving ? "正在保存草稿" : "未保存"}`} className={`ledger-row selected creating-ledger-row capsule-type-${createItemType}${createItemType === "task" ? " task-capsule-row" : ""}`} onClick={() => document.getElementById(createItemType === "task" ? "new-task-title" : "new-recurring-title")?.focus()}>
            <span className="ledger-accent" aria-hidden="true" />
            {createItemType === "task" ? <TaskCapsuleContent title={newTaskForm.title.trim() || "未命名任务"} notes={newTaskForm.notes.trim()} priority={newTaskForm.priority} tags={newTaskForm.tags} timing={taskFormTimingFact(newTaskForm, today)} minutes={newTaskForm.estimated_minutes} status={draftSaving ? "保存中" : persistedNewTaskDraft ? "草稿已保存" : "未保存"} sourceType="manual" /> : <><span className="ledger-main"><span className="recurring-capsule-heading"><strong>{recurringForm.title.trim() || "未命名重复事项"}</strong><span className="recurring-capsule-meta"><span className="task-type-badge recurring">重复事项</span><span className="recurring-status">未保存</span></span></span>{recurringForm.notes.trim() && <span className="ledger-note">{recurringForm.notes}</span>}<span className="ledger-facts"><span className="ledger-fact"><Icon name="restore" size={13} />{recurringForm.frequency === "daily" ? "每天" : recurringForm.frequency === "weekdays" ? "工作日" : recurringForm.frequency === "weekly" ? "每周" : "每月"}</span>{recurringForm.display_time && <span className="ledger-fact"><Icon name="clock" size={13} />{recurringForm.display_time} 展示</span>}</span></span></>}
          </button>}
          {error && <div className="inline-error"><strong>任务读取失败</strong><span>{error}</span><button onClick={() => void onReload()}>重试</button></div>}
          {!error && (loading || (view === "draft" && taskDraftsLoading)) && <div className="task-list-skeleton" role="status" aria-label="正在读取本地任务">{[0, 1, 2].map((item) => <span key={item} className="task-skeleton-card"><i /><b /><em /></span>)}</div>}
          {!error && !loading && !taskDraftsLoading && !creating && visibleTasks.length === 0 && visibleTaskDrafts.length === 0 && visibleRecurringItems.length === 0 && <div className="ledger-empty"><Icon name={view === "deleted" ? "trash" : view === "draft" ? "sparkle" : view === "recurring" ? "restore" : "tasks"} size={22} /><strong>{search ? "没有匹配内容" : taskEmptyCopy[view].title}</strong><span>{search ? `“${search.trim()}”在当前筛选中没有结果。` : taskEmptyCopy[view].description}</span>{search && <button type="button" onClick={() => setSearch("")}>清除搜索</button>}</div>}
          {(view === "recurring" || view === "deleted") && visibleRecurringItems.map((item) => <div key={item.id} className={`${selectedRecurringId === item.id ? "ledger-row selected" : "ledger-row"} task-ledger-row recurring-ledger-row capsule-type-recurring${item.deleted_at ? " status-row-deleted" : ""}`}><button type="button" className="ledger-row-select" aria-pressed={selectedRecurringId === item.id} onClick={() => { setSelectedId(null); setSelectedRecurringId(item.id); setRecurringForm(recurringItemFormForItem(item)); }}><span className="ledger-accent" aria-hidden="true" /><RecurringItemCapsuleContent item={item} /></button><div className="ledger-row-actions" aria-label={`${item.title}的快捷操作`}>{view === "recurring" && item.status !== "ended" && selectedRecurringId !== item.id && <button type="button" className="ledger-quick-action" onClick={() => { setSelectedId(null); setSelectedRecurringId(item.id); setRecurringForm(recurringItemFormForItem(item)); }}>编辑</button>}{view === "recurring" && item.status !== "ended" && <button type="button" className="ledger-quick-action danger" aria-label={`结束${item.title}`} onClick={() => setPendingEndRecurringItem(item)}><Icon name="close" size={14} /><span>结束</span></button>}{view === "recurring" && item.status === "ended" && <button type="button" className="ledger-quick-action danger" aria-label={`将${item.title}移入回收站`} onClick={() => setPendingTrashRecurringItem(item)}><Icon name="trash" size={14} /><span>回收站</span></button>}</div></div>)}
          {!taskDraftsLoading && view === "draft" && visibleTaskDrafts.map((item) => (
            <div key={item.id} className={`${persistedNewTaskDraft?.id === item.id ? "ledger-row selected" : "ledger-row"} task-ledger-row task-capsule-row capsule-type-task`}>
            <button type="button" className="ledger-row-select task-capsule-select" aria-pressed={persistedNewTaskDraft?.id === item.id} onClick={() => void selectPersistedTaskDraft(item)}>
              <span className="ledger-accent" aria-hidden="true" />
              <TaskCapsuleContent title={item.title.trim() || "未命名草稿"} notes={item.notes} priority={item.priority} tags={item.tags} timing={item.due_date ? `截止 ${item.due_date}` : null} minutes={item.total_workload_minutes} status="待确认" sourceType={item.source_type} />
            </button>
            <div className="ledger-row-actions" aria-label={`${item.title || "未命名草稿"}的快捷操作`}>{persistedNewTaskDraft?.id !== item.id && <button type="button" className="ledger-quick-action" onClick={() => void selectPersistedTaskDraft(item)}>编辑</button>}<button type="button" className="ledger-quick-action danger" aria-label={`放弃${item.title || "未命名草稿"}`} onClick={() => setPendingDiscardTaskDraft(item)}><Icon name="trash" size={14} /><span>放弃</span></button></div>
            </div>
          ))}
          {!loading && visibleTasks.map((task) => (
            <div key={task.id} className={`${selectedId === task.id ? "ledger-row selected" : "ledger-row"} task-ledger-row task-capsule-row capsule-type-task status-row-${task.status}`}>
              <button type="button" className="ledger-row-select task-capsule-select" aria-pressed={selectedId === task.id} onClick={() => requestTaskChange({ kind: "select", taskId: task.id })}>
              <span className="ledger-accent" aria-hidden="true" />
              <TaskCapsuleContent title={task.title} notes={task.notes} priority={task.priority} tags={task.tags} timing={taskTimingFact(task, today)} minutes={task.estimated_minutes} status={statusCopy[task.status]} sourceType={task.source_type} typeLabel={task.status === "deleted" ? "普通任务" : undefined} />
              </button>
              <div className="ledger-row-actions" aria-label={`${task.title}的快捷操作`}>
                {selectedId !== task.id && task.status !== "deleted" && <button type="button" className="ledger-quick-action" onClick={() => requestTaskChange({ kind: "select", taskId: task.id })}>编辑</button>}
                {task.status !== "deleted" && <button type="button" className="ledger-quick-action danger" title="移入回收站" aria-label={`将${task.title}移入回收站`} onClick={() => requestTaskChange({ kind: "trash", task: { id: task.id, title: task.title } })}><Icon name="trash" size={14} /><span>回收站</span></button>}
              </div>
            </div>
          ))}
        </div>
        <div className="ledger-resize-handle" role="separator" aria-label="调整任务列表与详情宽度；双击恢复默认宽度" aria-orientation="vertical" aria-valuemin={TASK_LEDGER_LIST_MIN_WIDTH} aria-valuemax={Math.round(ledgerMaximumWidth)} aria-valuenow={Math.round(currentLedgerListWidth())} tabIndex={0} onDoubleClick={resetLedgerWidth} onPointerDown={startLedgerResize} onPointerMove={moveLedgerResize} onPointerUp={endLedgerResize} onPointerCancel={endLedgerResize} onKeyDown={resizeLedgerWithKeyboard} />
        <aside className="task-inspector" aria-label="任务详情">
          <div className="inspector-scroll">
          {creating ? (
            <form id="new-task-form" className="task-form create-task-form" onSubmit={submitNewTask}>
              <div className="inspector-heading create-task-heading">
                <div className="inspector-title"><h2>{persistedNewTaskDraft?.draft_kind === "update" ? "确认任务修改" : "记一件事"}</h2><p>{persistedNewTaskDraft?.draft_kind === "update" ? "这是 AI 整理的修改草稿；确认前不会覆盖正式任务。" : createItemType === "task" ? "创建一项需要安排和推进的普通任务。" : "创建一条独立规则；到期当天显示，复盘时处理。"}</p></div>
                <button type="button" className="inspector-close-action" aria-label="关闭创建页" title="关闭创建页" disabled={busy || draftSaving} onClick={() => createItemType === "task" ? newTaskIsDirty || persistedNewTaskDraft ? void keepCurrentDraft() : clearNewTaskForm() : void cancelNewTask()}><Icon name="close" size={16} /></button>
              </div>
              {!persistedNewTaskDraft?.target_task_id && <div className="create-type-switch" role="radiogroup" aria-label="创建类型"><button type="button" role="radio" disabled={busy || draftSaving} aria-checked={createItemType === "task"} onClick={() => requestCreateItemType("task")}><Icon name="tasks" size={16} /><span><strong>普通任务</strong><small>进入 Inbox、待处理或已安排</small></span></button><button type="button" role="radio" disabled={busy || draftSaving} aria-checked={createItemType === "recurring"} onClick={() => requestCreateItemType("recurring")}><Icon name="restore" size={16} /><span><strong>重复事项</strong><small>到期展示，复盘时处理</small></span></button></div>}
              {newTaskError && <div className="inline-error compact" role="alert"><strong>{createItemType === "task" ? "任务尚未创建" : "重复事项尚未创建"}</strong><span>{newTaskError}</span></div>}
              {createItemType === "task" ? <TaskEditorRegions form={newTaskForm} disabled={busy} idPrefix="new-task" autoFocusTitle estimateHint={newTaskEstimateHint} estimateAction={newTaskEstimateMode === "manual" && newTaskRangeMinutes !== null ? { label: "按时间重算", onClick: recalculateNewTaskEstimate } : null} onChange={updateNewTaskFields} onScheduleChange={updateNewTaskSchedule} /> : <RecurringItemEditor form={recurringForm} disabled={busy} idPrefix="new-recurring" autoFocusTitle onChange={setRecurringForm} />}
              <div className="create-task-actions">
                <span className="task-draft-save-state" role="status">{createItemType === "task" ? draftSaving ? "正在保存草稿…" : persistedNewTaskDraft ? "草稿已保存在本机" : newTaskIsDirty ? newTaskAutosaveArmed ? "将在停止输入后自动保存" : "已保留输入，继续编辑后才会自动保存" : "尚未填写" : "创建前不会生成任务或发生记录"}</span>
                <div>
                  <button type="button" className="secondary-action" disabled={busy || draftSaving} onClick={() => void cancelNewTask()}>{createItemType === "task" ? "放弃草稿" : "取消"}</button>
                  {createItemType === "task" && <button type="button" className="secondary-action" disabled={busy || draftSaving || !newTaskIsDirty && !persistedNewTaskDraft} onClick={() => void keepCurrentDraft()}>仅保存草稿</button>}
                  <button type="submit" className="create-task-submit" disabled={busy || (createItemType === "task" ? !newTaskForm.title.trim() || !newTaskHasValidRange : !recurringForm.title.trim() || recurringForm.frequency === "weekly" && !recurringForm.weekdays.length)}>{busy ? <span className="loader" /> : <Icon name={persistedNewTaskDraft?.draft_kind === "update" ? "check" : "plus"} size={16} />}{busy ? "正在写入…" : createItemType === "recurring" ? "创建重复事项" : persistedNewTaskDraft?.draft_kind === "update" ? "确认修改任务" : newTaskHasDate ? "确认创建任务" : "确认并放入 Inbox"}</button>
                </div>
              </div>
            </form>
          ) : view === "recurring" && selectedRecurringItem?.status === "ended" ? <div className="deleted-inspector recurring-terminal-inspector"><div className="inspector-title"><span>重复事项 · 已结束</span><h2>{selectedRecurringItem.title}</h2></div><p>该事项不会再产生新的发生记录，也不能恢复或修改。现在唯一可用的操作是移入回收站；历史发生与复盘记录在软删除后仍会保留。</p><div className="inspector-actions"><button className="danger-action" onClick={() => setPendingTrashRecurringItem(selectedRecurringItem)} disabled={busy}><Icon name="trash" size={15} />移入回收站</button></div></div> : view === "recurring" && selectedRecurringItem ? <form className="task-form create-task-form edit-task-form" onSubmit={saveRecurringItem}><div className="inspector-heading create-task-heading edit-task-heading"><div className="inspector-title"><h2>编辑重复事项</h2><p>修改只影响以后发生的日期；历史记录保持原样。</p></div><span className="task-editor-status"><Icon name="restore" size={14} />{recurringItemStatusLabel(selectedRecurringItem)}</span></div><RecurringItemEditor form={recurringForm} disabled={busy} idPrefix="edit-recurring" onChange={setRecurringForm} /><div className="state-actions recurring-state-actions">{selectedRecurringItem.status === "active" && <button type="button" disabled={busy} onClick={() => void changeRecurringItemStatus("paused")}><Icon name="close" size={14} />暂停</button>}{selectedRecurringItem.status === "paused" && <button type="button" disabled={busy} onClick={() => void changeRecurringItemStatus("active")}><Icon name="restore" size={14} />恢复</button>}<button type="button" className="text-danger" disabled={busy} onClick={() => void changeRecurringItemStatus("ended")}><Icon name="check" size={14} />结束事项</button></div>{recurringEditingDirty && <div className="edit-task-floating-actions"><span>有未保存的更改</span><div><button type="button" className="secondary-action" disabled={busy} onClick={() => setRecurringForm(recurringItemFormForItem(selectedRecurringItem))}>取消修改</button><button type="submit" className="create-task-submit" disabled={busy || !recurringForm.title.trim()}>保存重复事项</button></div></div>}</form> : view === "deleted" && selectedRecurringItem?.deleted_at ? (
            <div className="deleted-inspector"><div className="inspector-title"><span>回收站 · 重复事项</span><h2>{selectedRecurringItem.title}</h2></div><p>该重复事项已结束并移出规则列表；恢复后仍保持“已结束”，历史发生与复盘记录继续保留。</p><div className="inspector-actions"><button className="secondary-action" onClick={() => void restoreSelectedRecurringItem()} disabled={busy}><Icon name="restore" size={15} />恢复重复事项</button><button className="danger-action" onClick={() => setPendingPermanentRecurringItem(true)} disabled={busy}><Icon name="trash" size={15} />永久删除</button></div></div>
          ) : !selectedTask || !draft ? <div className="inspector-empty"><Icon name={view === "draft" ? "sparkle" : view === "recurring" ? "restore" : view === "deleted" ? "trash" : "tasks"} size={21} /><p>{view === "draft" ? "当前没有待确认草稿" : view === "recurring" ? "选择一条重复事项查看和编辑" : view === "deleted" ? "选择一项回收内容查看类型与操作" : "选择一项任务查看和编辑"}</p></div> : selectedTask.status === "deleted" ? (
            <div className="deleted-inspector"><div className="inspector-title"><span>回收站 · 普通任务</span><h2>{selectedTask.title}</h2></div><p>该任务已从普通列表和安排上下文中移除。</p><div className="inspector-actions"><button className="secondary-action" onClick={() => void restore()} disabled={busy}><Icon name="restore" size={15} />恢复任务</button><button className="danger-action" onClick={() => setPendingPermanentTask(true)} disabled={busy}><Icon name="trash" size={15} />永久删除</button></div></div>
          ) : editingTaskForm ? (
            <form id="task-editor-form" className={isDirty ? "task-form create-task-form edit-task-form has-floating-actions" : "task-form create-task-form edit-task-form"} onSubmit={save}>
              <div className="inspector-heading create-task-heading edit-task-heading">
                <div className="inspector-title"><h2>编辑任务</h2><p>修改任务内容与时间边界，保存后更新本地任务。</p></div>
                <span className="task-editor-status"><Icon name={selectedTask.source_type === "ai_assistant" ? "sparkle" : "user"} size={14} />{selectedTask.source_type === "ai_assistant" ? "AI 创建" : "手动创建"}<i />{statusCopy[selectedTask.status]}</span>
              </div>
              <TaskEditorRegions form={editingTaskForm} disabled={busy} idPrefix="edit-task" estimateHint={editingTaskEstimateHint} onChange={updateEditingTaskForm} onScheduleChange={updateEditingTaskForm} />
              <p className="task-lifecycle-help">这里改变整个任务的后续状态；今日页只记录当天这一次执行。</p>
              <div className="state-actions">
                {selectedTask.status === "inbox" && <button type="button" onClick={() => requestTaskChange({ kind: "transition", status: "open" })} disabled={busy}><Icon name="tasks" size={14} />转为待办</button>}
                {["open", "scheduled"].includes(selectedTask.status) && <button type="button" title="完成整个任务并停止后续安排；已保存的执行历史仍会保留" onClick={() => requestTaskChange({ kind: "transition", status: "done" })} disabled={busy}><Icon name="check" size={14} />完成整个任务</button>}
                {["open", "scheduled"].includes(selectedTask.status) && <button type="button" title="放弃整个任务并停止后续安排；已保存的历史仍会保留" onClick={() => requestTaskChange({ kind: "transition", status: "cancelled" })} disabled={busy}><Icon name="close" size={14} />取消整个任务</button>}
                {selectedTask.status === "done" && <button type="button" onClick={() => requestTaskChange({ kind: "reopen" })} disabled={busy}><Icon name="restore" size={14} />取消完成</button>}
                {selectedTask.status === "cancelled" && <button type="button" onClick={() => requestTaskChange({ kind: "transition", status: "open" })} disabled={busy}><Icon name="restore" size={14} />重新打开</button>}
                <button type="button" className="text-danger" onClick={() => requestTaskChange({ kind: "trash" })} disabled={busy}><Icon name="trash" size={14} />移入回收站</button>
              </div>
            </form>
          ) : null}
          </div>
          {selectedTask && draft && selectedTask.status !== "deleted" && isDirty && <div className="draft-action-bar" aria-label="未保存的任务修改">
            <strong>{busy ? "正在保存到本机…" : "有未保存的更改"}</strong>
            <div className="draft-bar-actions">
              <button className="draft-reset" type="button" disabled={busy} onClick={resetDraft}><Icon name="restore" size={15} />重置</button>
              <button className="draft-save" type="submit" form="task-editor-form" disabled={busy || !draft.title.trim()} aria-label="保存修改" title="保存修改（Ctrl+S）">{busy ? <span className="loader" /> : <Icon name="check" size={16} />}{busy ? "保存中…" : "保存更改"}</button>
            </div>
          </div>}
        </aside>
      </div>
      {(pendingTaskChange || externalNavigationRequest) && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) resolvePendingChange(false); }}>
        <section className="unsaved-dialog leave-dialog" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-dialog-title" aria-describedby="unsaved-dialog-description">
          <header><h2 id="unsaved-dialog-title">{creating ? "放弃正在记录的内容？" : "放弃未保存的修改？"}</h2><button type="button" aria-label="继续编辑" title="继续编辑" disabled={busy} onClick={() => resolvePendingChange(false)}><Icon name="close" size={17} /></button></header>
          <p id="unsaved-dialog-description">{creating ? "当前填写的任务还没有创建，放弃后内容将不会保留。" : "当前修改还没有保存，放弃后将恢复为上一次保存的内容。"}</p>
          <div className="dialog-actions">
            <button type="button" className="dialog-cancel" autoFocus disabled={busy} onClick={() => resolvePendingChange(false)}>继续编辑</button>
            <button type="button" className="dialog-discard" disabled={busy} onClick={() => void discardAndContinue()}>{busy ? "正在放弃…" : creating ? "放弃新建" : "放弃修改"}</button>
          </div>
        </section>
      </div>}
      {pendingTrashTask && <div className="dialog-backdrop task-trash-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingTrashTask(null); }}>
        <section className="unsaved-dialog task-trash-dialog" role="alertdialog" aria-modal="true" aria-labelledby="task-trash-title" aria-describedby="task-trash-description" onKeyDown={(event) => { if (event.key === "Escape" && !busy) setPendingTrashTask(null); }}>
          <div className="dialog-icon trash"><Icon name="trash" size={19} /></div>
          <h2 id="task-trash-title">移入回收站？</h2>
          <p id="task-trash-description">“{pendingTrashTask.title}”将从普通任务列表和后续日计划中移除，之后仍可在回收站恢复。</p>
          <div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingTrashTask(null)}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void moveToTrash()}>{busy ? "正在移入…" : "确认移入"}</button></div>
        </section>
      </div>}
      {pendingDiscardTaskDraft && <div className="dialog-backdrop task-trash-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingDiscardTaskDraft(null); }}><section className="unsaved-dialog task-trash-dialog" role="alertdialog" aria-modal="true" aria-labelledby="discard-task-draft-title" onKeyDown={(event) => { if (event.key === "Escape" && !busy) setPendingDiscardTaskDraft(null); }}><div className="dialog-icon trash"><Icon name="trash" size={19} /></div><h2 id="discard-task-draft-title">放弃草稿？</h2><p>“{pendingDiscardTaskDraft.title || "未命名草稿"}”将从本机草稿中移除，正式任务不会发生变化。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingDiscardTaskDraft(null)}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void discardTaskDraftFromList(pendingDiscardTaskDraft)}>{busy ? "正在放弃…" : "确认放弃"}</button></div></section></div>}
      {pendingEndRecurringItem && <div className="dialog-backdrop task-trash-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingEndRecurringItem(null); }}><section className="unsaved-dialog task-trash-dialog" role="alertdialog" aria-modal="true" aria-labelledby="end-recurring-item-title" onKeyDown={(event) => { if (event.key === "Escape" && !busy) setPendingEndRecurringItem(null); }}><div className="dialog-icon trash"><Icon name="close" size={19} /></div><h2 id="end-recurring-item-title">结束重复事项？</h2><p>“{pendingEndRecurringItem.title}”不会再产生新的发生记录；已保存的历史和复盘记录会保留。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingEndRecurringItem(null)}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void endRecurringItemFromList(pendingEndRecurringItem)}>{busy ? "正在结束…" : "确认结束"}</button></div></section></div>}
      {pendingTrashRecurringItem && <div className="dialog-backdrop task-trash-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingTrashRecurringItem(null); }}><section className="unsaved-dialog task-trash-dialog" role="alertdialog" aria-modal="true" aria-labelledby="trash-recurring-item-title" onKeyDown={(event) => { if (event.key === "Escape" && !busy) setPendingTrashRecurringItem(null); }}><div className="dialog-icon trash"><Icon name="trash" size={19} /></div><h2 id="trash-recurring-item-title">移入回收站？</h2><p>“{pendingTrashRecurringItem.title}”将从重复事项列表移除；历史发生与复盘记录仍会保留，之后可从回收站恢复。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingTrashRecurringItem(null)}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void moveRecurringItemToTrash()}>{busy ? "正在移入…" : "确认移入"}</button></div></section></div>}
      {pendingRecurringSave && selectedTask && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingRecurringSave(null); }}><section className="unsaved-dialog" role="alertdialog" aria-modal="true" aria-labelledby="recurring-scope-title" aria-describedby="recurring-scope-description" onKeyDown={(event) => { if (event.key === "Escape" && !busy) setPendingRecurringSave(null); }}><div className="dialog-icon"><Icon name="restore" size={19} /></div><h2 id="recurring-scope-title">修改哪些重复任务？</h2><p id="recurring-scope-description">“{selectedTask.title}”是重复任务实例。历史实例和已有执行事实不会被覆盖。</p><div className="dialog-actions"><button type="button" disabled={busy} onClick={() => setPendingRecurringSave(null)}>取消</button><button type="button" disabled={busy} onClick={() => void commitDraft("this")}>仅修改本次</button><button type="button" className="dialog-save" disabled={busy} onClick={() => void commitDraft("future")}>修改本次及以后</button></div></section></div>}
      {pendingDiscardNew && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingDiscardNew(false); }}><section className="unsaved-dialog" role="alertdialog" aria-modal="true" aria-labelledby="discard-new-title"><h2 id="discard-new-title">放弃这个草稿？</h2><p>已填写的内容将从本机草稿中移除，正式任务不会发生变化。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingDiscardNew(false)}>继续编辑</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => { setPendingDiscardNew(false); void cancelNewTask(false); }}>放弃草稿</button></div></section></div>}
      {pendingCreateType && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setPendingCreateType(null); if (createItemType === "task" && newTaskIsDirty) setNewTaskAutosaveArmed(true); } }}><section className="unsaved-dialog" role="alertdialog" aria-modal="true" aria-labelledby="switch-create-type-title"><h2 id="switch-create-type-title">切换创建类型？</h2><p>标题、备注和标签会保留；当前类型专属的时间、工作量或重复规则将被清除。未确认的普通任务草稿不会保留。</p><div className="dialog-actions"><button type="button" autoFocus disabled={draftSaving} onClick={() => { setPendingCreateType(null); if (createItemType === "task" && newTaskIsDirty) setNewTaskAutosaveArmed(true); }}>继续编辑</button><button type="button" className="dialog-save" disabled={draftSaving} onClick={() => { const type = pendingCreateType; setPendingCreateType(null); void applyCreateItemType(type); }}>确认切换</button></div></section></div>}
      {pendingDraftSelection && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !draftSaving && !busy) setPendingDraftSelection(null); }}><section className="unsaved-dialog" role="alertdialog" aria-modal="true" aria-labelledby="switch-draft-title"><h2 id="switch-draft-title">{createItemType === "recurring" ? "创建重复事项并切换？" : "保存当前草稿并切换？"}</h2><p>{createItemType === "recurring" ? `当前重复事项会先创建为独立规则，随后打开“${pendingDraftSelection.title || "未命名草稿"}”。它不会进入普通任务队列。` : `当前输入会先保存到本机，然后打开“${pendingDraftSelection.title || "未命名草稿"}”。`}</p><div className="dialog-actions"><button type="button" autoFocus disabled={draftSaving || busy} onClick={() => setPendingDraftSelection(null)}>留在当前草稿</button><button type="button" className="dialog-save" disabled={draftSaving || busy} onClick={() => { const target = pendingDraftSelection; setPendingDraftSelection(null); void saveAndSwitchPersistedTaskDraft(target); }}>{createItemType === "recurring" ? "创建并切换" : "保存并切换"}</button></div></section></div>}
      {pendingPermanentTask && selectedTask && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingPermanentTask(false); }}><section className="unsaved-dialog task-trash-dialog" role="alertdialog" aria-modal="true" aria-labelledby="permanent-task-title"><div className="dialog-icon trash"><Icon name="trash" size={19} /></div><h2 id="permanent-task-title">永久删除任务？</h2><p>“{selectedTask.title}”及其本地历史将无法恢复。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingPermanentTask(false)}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void permanentlyDelete()}>{busy ? "正在删除…" : "永久删除"}</button></div></section></div>}
      {pendingPermanentRecurringItem && selectedRecurringItem && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingPermanentRecurringItem(false); }}><section className="unsaved-dialog task-trash-dialog" role="alertdialog" aria-modal="true" aria-labelledby="permanent-recurring-item-title"><div className="dialog-icon trash"><Icon name="trash" size={19} /></div><h2 id="permanent-recurring-item-title">永久删除重复事项？</h2><p>“{selectedRecurringItem.title}”及其全部本地发生与复盘历史将无法恢复。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingPermanentRecurringItem(false)}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void permanentlyDeleteSelectedRecurringItem()}>{busy ? "正在删除…" : "永久删除"}</button></div></section></div>}
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

function waitingTaskLabel(task: Task) {
  const unreserved = taskUnreservedMinutes(task);
  if (unreserved === null) return "待补充预计工作量";
  if (task.status === "scheduled") return `部分已安排 · 还需安排 ${unreserved} 分钟`;
  return `待安排 ${unreserved} 分钟`;
}

function waitingTaskTooltipDetail(task: Task | undefined, primary: string) {
  return [
    primary,
    task?.notes?.trim(),
    task?.tags.length ? `标签：${task.tags.join("、")}` : ""
  ].filter(Boolean).join(" · ");
}

type TimelineSelection = { kind: "block" | "event" | "draft"; id: string };
type ExecutionDraft = { result: ExecutionResult | null; outcome: ReviewOutcome | null; note: string };
type PlanDraftTimeEdit = { blockIndex: number; starts_at: string; ends_at: string; error: string };
type TimelineTooltipContent = {
  kind: "执行块" | "计划草案" | "固定日程" | "重复事项" | "待安排任务" | "非工作时间";
  title: string;
  time: string;
  detail: string;
  tone: "execution" | "execution-completed" | "execution-partial" | "execution-blocked" | "execution-cancelled" | "execution-not_started" | "draft" | "fixed" | "recurring" | "task" | "nonworking";
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
  const raw = String(reason).trim()
    .replace(/^领域规则不允许此操作：\s*/, "")
    .replace(/^结构化操作无效：\s*/, "");
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
  if (!availability.weekdays.includes(weekdayNumber(date))) {
    return [{ start: 0, end: 24 * 60 }];
  }
  const workdayStart = clockMinutes(availability.workday_start);
  const workdayEnd = clockMinutes(availability.workday_end);
  const segments: TimeRailSegment[] = [];
  if (workdayStart > 0) segments.push({ start: 0, end: workdayStart });
  if (workdayEnd < 24 * 60) segments.push({ start: workdayEnd, end: 24 * 60 });
  return segments;
}

function draftEditableBounds(task: Task | null, planDate: string) {
  let min = 0;
  let max = 23 * 60 + 45;
  if (task?.earliest_start_at) {
    const date = task.earliest_start_at.slice(0, 10);
    if (date === planDate) min = Math.max(min, Math.ceil(clockMinutes(task.earliest_start_at.slice(11, 16)) / 15) * 15);
  }
  if (task?.due_at) {
    const date = task.due_at.slice(0, 10);
    if (date === planDate) max = Math.min(max, Math.floor(clockMinutes(task.due_at.slice(11, 16)) / 15) * 15);
  }
  if (max - min < 15) return { min: 0, max: 23 * 60 + 45 };
  return { min, max };
}

function TimeRangeRail({
  start, end, onChange, segments = [], minMinute = 0, maxMinute = 23 * 60 + 45,
  startLabel = "开始", endLabel = "结束", disabled = false, describedBy
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
}) {
  const startMinute = clockMinutes(start);
  const endMinute = clockMinutes(end);
  const span = Math.max(15, maxMinute - minMinute);
  const position = (minute: number) => `${Math.max(0, Math.min(100, (minute - minMinute) / span * 100))}%`;
  const safeStartMinute = Math.max(minMinute, Math.min(startMinute, maxMinute - 15, endMinute - 15));
  const safeEndMinute = Math.min(maxMinute, Math.max(endMinute, minMinute + 15, startMinute + 15));
  const visibleSegments = segments.filter((segment) => segment.end > minMinute && segment.start < maxMinute);

  function updateStart(value: number) {
    const snapped = Math.round(value / 15) * 15;
    onChange({ start: minutesClock(Math.max(minMinute, Math.min(snapped, safeEndMinute - 15))), end: minutesClock(safeEndMinute) });
  }

  function updateEnd(value: number) {
    const snapped = Math.round(value / 15) * 15;
    onChange({ start: minutesClock(safeStartMinute), end: minutesClock(Math.min(maxMinute, Math.max(snapped, safeStartMinute + 15))) });
  }

  return <div className="time-range-rail">
    <div className="time-range-values" aria-label="选择开始和结束时间">
      <label><span>{startLabel}</span><input type="time" step={900} min={minutesClock(minMinute)} max={minutesClock(Math.max(minMinute, safeEndMinute - 15))} disabled={disabled} value={minutesClock(safeStartMinute)} aria-label={`输入${startLabel}`} onChange={(event) => updateStart(clockMinutes(event.target.value))} /></label>
      <label><span>{endLabel}</span><input type="time" step={900} min={minutesClock(Math.min(maxMinute, safeStartMinute + 15))} max={minutesClock(maxMinute)} disabled={disabled} value={minutesClock(safeEndMinute)} aria-label={`输入${endLabel}`} onChange={(event) => updateEnd(clockMinutes(event.target.value))} /></label>
    </div>
    <div className="time-rail-surface">
      <div className="time-rail-track-wrap">
        <div className="time-rail-track" aria-hidden="true">
          {visibleSegments.map((segment, index) => <span key={`${segment.start}-${segment.end}-${index}`} className="time-rail-nonworking" aria-hidden="true" style={{ left: position(Math.max(segment.start, minMinute)), width: `calc(${position(Math.min(segment.end, maxMinute))} - ${position(Math.max(segment.start, minMinute))})` }} />)}
          <span className="time-rail-selection" style={{ left: position(safeStartMinute), width: `calc(${position(safeEndMinute)} - ${position(safeStartMinute)})` }} />
        </div>
        <input className="time-rail-range start" type="range" min={minMinute} max={maxMinute} step={15} value={safeStartMinute} disabled={disabled} aria-label={`调整${startLabel}，15 分钟步进`} aria-describedby={describedBy} onChange={(event) => updateStart(Number(event.target.value))} />
        <input className="time-rail-range end" type="range" min={minMinute} max={maxMinute} step={15} value={safeEndMinute} disabled={disabled} aria-label={`调整${endLabel}，15 分钟步进`} aria-describedby={describedBy} onChange={(event) => updateEnd(Number(event.target.value))} />
      </div>
      <div className="time-rail-scale" aria-hidden="true"><span>{minutesClock(minMinute)}</span><span>{minutesClock(Math.round((minMinute + span / 2) / 15) * 15)}</span><span>{minutesClock(maxMinute)}</span></div>
      {visibleSegments.length > 0 && <small className="time-rail-preference">浅色区间仅表示非工作时间，仍可安排。</small>}
    </div>
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
  if (durationMinutes <= 0) return null;
  const earliestDate = task?.earliest_start_at?.slice(0, 10);
  const dueDate = task?.due_at?.slice(0, 10);
  if ((earliestDate && earliestDate > planDate) || (dueDate && dueDate < planDate)) return null;
  const earliestMinute = task?.earliest_start_at?.slice(0, 10) === planDate
    ? clockMinutes(task.earliest_start_at.slice(11, 16))
    : 0;
  const dueMinute = task?.due_at?.slice(0, 10) === planDate
    ? clockMinutes(task.due_at.slice(11, 16))
    : 24 * 60;
  const preferredStart = availability ? clockMinutes(availability.workday_start) : 9 * 60;
  const startsAt = Math.max(earliestMinute, preferredStart);
  const endLimit = Math.min(dueMinute, 24 * 60);
  if (startsAt >= endLimit) return null;
  const scheduledMinutes = Math.min(durationMinutes, endLimit - startsAt);
  return {
    allocations: [{
      starts_at: planTimestamp(planDate, minutesClock(startsAt)),
      ends_at: planTimestamp(planDate, minutesClock(startsAt + scheduledMinutes)),
      estimated_minutes: scheduledMinutes
    }],
    remainingMinutes: durationMinutes - scheduledMinutes
  };
}

function timelineLaneLayout<T extends { layoutKey: string; starts_at: string; ends_at: string }>(items: T[], selectedDate: string) {
  return calculateTimelineLanes(items.map((item) => ({
    layoutKey: item.layoutKey,
    startMinute: timelineMinute(item.starts_at, selectedDate, "start"),
    endMinute: timelineMinute(item.ends_at, selectedDate, "end")
  })));
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
  const weekday = weekdayIndex < 0 ? 0 : weekdayIndex;
  return Array.from({ length: 7 }, (_, index) => shiftDateValue(selectedDate, index - weekday));
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
  onGeneratePlan, onAdjustPlan, onUpdatePlan, onConfirmPlan, onCancelPlan, onOpenTasks, onFactsChanged, onNotify, message
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
  onGeneratePlan: () => void;
  onAdjustPlan: () => Promise<RulePlanPreview | null>;
  onUpdatePlan: (preview: RulePlanPreview) => Promise<RulePlanPreview>;
  onConfirmPlan: () => void;
  onCancelPlan: () => Promise<boolean>;
  onOpenTasks: (taskId?: string) => void;
  onFactsChanged: (date?: string) => Promise<void>;
  onNotify: (label: string, message: string, icon?: IconName) => void;
  message: string;
}) {
  const [monthKey, setMonthKey] = useState(selectedDate.slice(0, 7));
  const [monthSelectionPending, setMonthSelectionPending] = useState(false);
  const [todayView, setTodayView] = useState<"month" | "timeline">("timeline");
  const [selection, setSelection] = useState<TimelineSelection | null>(null);
  const [planDraftTimeEdit, setPlanDraftTimeEdit] = useState<PlanDraftTimeEdit | null>(null);
  const [executionDraft, setExecutionDraft] = useState<ExecutionDraft | null>(null);
  const [executionMessage, setExecutionMessage] = useState("");
  const [savingExecution, setSavingExecution] = useState(false);
  const [quickCompletingBlockId, setQuickCompletingBlockId] = useState<string | null>(null);
  const [debugFixtureControlsAvailable, setDebugFixtureControlsAvailable] = useState(false);
  const [debugFixturesBusy, setDebugFixturesBusy] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [followingNow, setFollowingNow] = useState(true);
  const [showReturnToNow, setShowReturnToNow] = useState(false);
  const [timelineTooltip, setTimelineTooltip] = useState<TimelineTooltipState | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const timelineCenteredDateRef = useRef<string | null>(null);
  const returnToNowFrameRef = useRef(0);
  const timelineFloatingPanelRef = useRef<HTMLElement>(null);
  const timelineSelectionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cells = useMemo(() => calendarCells(monthKey), [monthKey]);

  useEffect(() => {
    void debugTimelineFixturesAvailable().then(setDebugFixtureControlsAvailable).catch(() => setDebugFixtureControlsAvailable(false));
  }, []);
  const fixedEvents = schedule?.fixed_events ?? [];
  const taskBlocks = schedule?.task_blocks ?? [];
  const timedEvents = fixedEvents.filter((event) => !event.is_all_day);
  const draftBlocks = preview?.blocks ?? [];
  const draftLayoutKeys = planDraftLayoutKeys(draftBlocks);
  const isAdjustingConfirmedPlan = Boolean(preview?.base_plan_id && preview.base_plan_id === schedule?.plan_id);
  const visibleTaskBlocks = isAdjustingConfirmedPlan
    ? taskBlocks.filter((block) => block.execution_status !== "planned" || Boolean(block.review))
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
    ...recurringTimelineBlocks.map((block) => ({ ...block, layoutKey: block.layoutKey, timelineKind: "recurring" as const }))
  ];
  const timelineItemLanes = timelineLaneLayout(timelineItems, selectedDate);
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
  const selectedBlock = selection?.kind === "block" ? taskBlocks.find((block) => block.id === selection.id) ?? null : null;
  const selectedEvent = selection?.kind === "event" ? fixedEvents.find((event) => event.id === selection.id) ?? null : null;
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
  const recordedCount = taskBlocks.filter((block) => block.execution_status !== "planned").length;
  const todayMonthKey = today.slice(0, 7);
  const isAwayFromToday = selectedDate !== today || monthKey !== todayMonthKey;
  const monthTitle = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", timeZone: "Asia/Shanghai" })
    .format(new Date(`${monthKey}-01T00:00:00+08:00`));
  const selectedDateTitle = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Shanghai" })
    .format(new Date(`${selectedDate}T00:00:00+08:00`));
  const selectedPlanDateLabel = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", timeZone: "Asia/Shanghai" })
    .format(new Date(`${selectedDate}T00:00:00+08:00`));
  const isPastDate = selectedDate < today;
  const hasConfirmedPlan = Boolean(schedule?.plan_id);
  const generatePlanLabel = selectedDate === today ? "生成今日计划" : `生成 ${selectedPlanDateLabel}计划`;
  const planActionLabel = isPastDate ? "历史日期只读" : generatePlanLabel;
  const planActionTitle = isPastDate
    ? "历史日期不能生成新的计划草案"
    : `根据任务和可用时间生成${selectedDate === today ? "今日" : selectedPlanDateLabel}的待确认计划`;
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
  const selectedLunarDay = lunarDayLabel(selectedDate);
  const nonWorkingTimeSegments = nonWorkingSegments(availability, selectedDate);
  const draftTimeBounds = draftEditableBounds(selectedDraftTask, selectedDate);
  const holidayCoverageAvailable = officialHolidayCoverageFor(`${monthKey}-01`);

  function showTimelineTooltipForTarget(content: TimelineTooltipContent, target: HTMLElement, anchorMode: TimelineTooltipAnchor) {
    const targetRect = target.getBoundingClientRect();
    const contentAnchor = anchorMode === "content"
      ? target.querySelector<HTMLElement>(".timeline-event-copy, .lane-copy, :scope > span")
      : null;
    const contentRect = contentAnchor?.getBoundingClientRect() ?? targetRect;
    const scrollRect = target.closest(".timeline-events") ? timelineScrollRef.current?.getBoundingClientRect() : null;
    if (anchorMode === "block-top" || anchorMode === "block-bottom") {
      const anchorTop = scrollRect ? Math.max(targetRect.top, scrollRect.top) : targetRect.top;
      const anchorBottom = scrollRect ? Math.min(targetRect.bottom, scrollRect.bottom) : targetRect.bottom;
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const prefersBelow = anchorMode === "block-bottom";
      const placement = prefersBelow && viewportHeight - anchorBottom >= 126
        ? "below"
        : anchorTop >= 126 ? "above" : "below";
      setTimelineTooltip({
        ...content,
        left: prefersBelow
          ? Math.max(143, Math.min(viewportWidth - 143, targetRect.right - 143))
          : Math.max(148, Math.min(viewportWidth - 148, targetRect.left + targetRect.width / 2)),
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
    const placement = anchorTop >= 126 ? "above" : "below";
    setTimelineTooltip({
      ...content,
      left: Math.max(148, Math.min(viewportWidth - 148, anchorRect.left + anchorRect.width / 2)),
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
    const scheduleNextMinute = () => {
      syncClock();
      const delay = 60_000 - Date.now() % 60_000 + 50;
      timer = window.setTimeout(scheduleNextMinute, delay);
    };
    const syncVisibleClock = () => {
      if (document.visibilityState === "visible") syncClock();
    };

    scheduleNextMinute();
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
    if (selectedDate !== today) {
      timelineCenteredDateRef.current = null;
      return;
    }
    if (!followingNow) return;
    if (todayView !== "timeline" || loading || error) return;
    const frame = window.requestAnimationFrame(() => {
      const scroller = timelineScrollRef.current;
      const nowLine = scroller?.querySelector<HTMLElement>(".current-time-line");
      if (!scroller || !nowLine) return;
      const scrollerRect = scroller.getBoundingClientRect();
      const lineRect = nowLine.getBoundingClientRect();
      const desiredTop = scroller.scrollTop + lineRect.top - scrollerRect.top - scroller.clientHeight / 2;
      const nextTop = Math.max(0, Math.min(desiredTop, scroller.scrollHeight - scroller.clientHeight));
      const shouldReduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      scroller.scrollTo({
        top: nextTop,
        behavior: timelineCenteredDateRef.current === selectedDate && !shouldReduceMotion ? "smooth" : "auto"
      });
      timelineCenteredDateRef.current = selectedDate;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedDate, today, todayView, loading, error, followingNow, nowMinute]);

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

  useEffect(() => {
    if (!selection) return;
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (timelineFloatingPanelRef.current?.contains(target)) return;
      if (timelineSelectionTriggerRef.current?.contains(target)) return;
      setSelection(null);
      setPlanDraftTimeEdit(null);
    };
    document.addEventListener("pointerdown", dismissOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", dismissOnOutsidePointer);
  }, [selection]);

  useEffect(() => {
    if (!selectedBlock || selectedBlock.review || selectedDate !== today) {
      setExecutionDraft(null);
      return;
    }
    const outcome = selectedBlock.execution_status === "planned" ? null : selectedBlock.execution_status;
    setExecutionDraft({
      result: executionResultForOutcome(outcome),
      outcome,
      note: selectedBlock.execution_note ?? ""
    });
    setExecutionMessage("");
  }, [selectedBlock?.id, selectedBlock?.review, selectedBlock?.execution_status, selectedBlock?.execution_note, selectedDate, today]);

  function moveMonth(offset: number) {
    const [year, month] = monthKey.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    setMonthKey(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
    setMonthSelectionPending(true);
  }

  function returnToday() {
    if (selectedDate === today) {
      setMonthKey(todayMonthKey);
      setMonthSelectionPending(false);
      return;
    }
    selectCalendarDate(today);
  }

  async function loadDebugTimelineFixtures() {
    setDebugFixturesBusy(true);
    try {
      const fixtureDate = await seedDebugTimelineLayoutFixtures();
      if (!onSelectDate(fixtureDate)) return;
      setMonthKey(fixtureDate.slice(0, 7));
      setMonthSelectionPending(false);
      setTodayView("timeline");
      await onFactsChanged(fixtureDate);
      onNotify("布局样例已载入", `${fixtureDate} · 可查看等分、包含、链式与局部右扩`, "calendar");
    } catch (reason) {
      onNotify("布局样例未载入", String(reason), "review");
    } finally {
      setDebugFixturesBusy(false);
    }
  }

  async function clearDebugTimelineFixtures() {
    setDebugFixturesBusy(true);
    try {
      await clearDebugTimelineLayoutFixtures();
      await onFactsChanged(selectedDate);
      onNotify("布局样例已移除", "仅删除“布局样例”数据，不影响你的日程。", "restore");
    } catch (reason) {
      onNotify("布局样例未移除", String(reason), "review");
    } finally {
      setDebugFixturesBusy(false);
    }
  }

  function selectCalendarDate(date: string) {
    if (!onSelectDate(date)) return;
    setMonthSelectionPending(false);
    if (date.slice(0, 7) !== monthKey) setMonthKey(date.slice(0, 7));
  }

  function selectTimelineItem(nextSelection: TimelineSelection, trigger?: HTMLButtonElement) {
    if (trigger) timelineSelectionTriggerRef.current = trigger;
    setTimelineTooltip(null);
    setSelection(nextSelection);
    setExecutionMessage("");
  }

  function selectPlanDraftBlock(blockIndex: number, trigger: HTMLButtonElement) {
    const block = draftBlocks[blockIndex];
    if (!block) return;
    timelineSelectionTriggerRef.current = trigger;
    setTimelineTooltip(null);
    setSelection({ kind: "draft", id: String(blockIndex) });
    setPlanDraftTimeEdit({
      blockIndex,
      starts_at: timeInputValue(block.starts_at),
      ends_at: timeInputValue(block.ends_at),
      error: ""
    });
  }

  async function adjustSelectedBlockTime() {
    if (!selectedBlock || selectedBlock.execution_status !== "planned" || selectedBlock.review || isPastDate || busy) return;
    const target = selectedBlock;
    closeTimelinePanel();
    const adjustment = await onAdjustPlan();
    if (!adjustment) return;
    const blockIndex = adjustment.blocks.findIndex((block) =>
      block.task_id === target.task_id
      && block.starts_at === target.starts_at
      && block.ends_at === target.ends_at
    );
    if (blockIndex < 0) {
      onNotify("暂时不能调整这个时间块", "该时间块已经产生执行记录或计划已发生变化", "review");
      return;
    }
    const block = adjustment.blocks[blockIndex];
    setSelection({ kind: "draft", id: String(blockIndex) });
    setPlanDraftTimeEdit({
      blockIndex,
      starts_at: timeInputValue(block.starts_at),
      ends_at: timeInputValue(block.ends_at),
      error: ""
    });
  }

  async function savePlanDraftTime(event: FormEvent) {
    event.preventDefault();
    if (!preview || !planDraftTimeEdit) return;
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
    const block = preview.blocks[planDraftTimeEdit.blockIndex];
    if (!block) return;
    const nextBlock: RulePlanBlock = {
      ...block,
      starts_at: planTimestamp(selectedDate, startsAt),
      ends_at: planTimestamp(selectedDate, endsAt),
      estimated_minutes: endMinute - startMinute
    };
    try {
      await onUpdatePlan({
        ...preview,
        blocks: preview.blocks.map((item, index) => index === planDraftTimeEdit.blockIndex ? nextBlock : item)
      });
      closeTimelinePanel();
    } catch (reason) {
      setPlanDraftTimeEdit({ ...planDraftTimeEdit, starts_at: startsAt, ends_at: endsAt, error: "" });
      onNotify("时间未保存", planDraftErrorMessage(reason, selectedDraftTask, selectedDate), "review");
    }
  }

  async function removePlanDraftBlock() {
    if (!preview || !selectedDraftBlock || selectedDraftIndex < 0) return;
    const remainingBlocks = preview.blocks.filter((_, index) => index !== selectedDraftIndex);
    const existingUnscheduled = preview.unscheduled.find((item) => item.task_id === selectedDraftBlock.task_id);
    const removedMinutes = (existingUnscheduled?.estimated_minutes ?? 0) + selectedDraftBlock.estimated_minutes;
    const unscheduled: RuleUnscheduledTask[] = [
      ...preview.unscheduled.filter((item) => item.task_id !== selectedDraftBlock.task_id),
      {
        task_id: selectedDraftBlock.task_id,
        task_title: selectedDraftBlock.task_title,
        reason: `手动移出今日 · ${removedMinutes} 分钟待安排`,
        estimated_minutes: removedMinutes
      }
    ];
    try {
      await onUpdatePlan({ ...preview, blocks: remainingBlocks, unscheduled });
      setSelection(null);
      setPlanDraftTimeEdit(null);
      window.requestAnimationFrame(() => timelineScrollRef.current?.focus());
    } catch (reason) {
      onNotify("没有移出草案", planDraftErrorMessage(reason, selectedDraftTask, selectedDate), "review");
    }
  }

  async function includeUnscheduledTask(item: RuleUnscheduledTask) {
    if (!preview || !item.estimated_minutes) return;
    const task = tasks.find((candidate) => candidate.id === item.task_id);
    const boundaryIssue = taskSchedulingBoundaryIssue(task, selectedDate);
    if (boundaryIssue) {
      onNotify("当前日期不能安排", `“${item.task_title}”${boundaryIssue}。`, "clock");
      return;
    }
    const suggested = suggestedDraftAllocations(selectedDate, item.estimated_minutes, availability, task);
    if (!suggested) {
      onNotify("无法加入当天", `“${item.task_title}”不在当天允许的时间范围内，请调整任务日期边界或选择其他日期。`, "clock");
      return;
    }
    const scheduledMinutes = item.estimated_minutes - suggested.remainingMinutes;
    const newBlocks: RulePlanBlock[] = suggested.allocations.map((allocation) => ({
      task_id: item.task_id,
      task_title: item.task_title,
      ...allocation
    }));
    const unscheduled = preview.unscheduled.filter((candidate) => candidate.task_id !== item.task_id);
    if (suggested.remainingMinutes > 0) {
      unscheduled.push({
        ...item,
        reason: `今日已安排 ${scheduledMinutes} 分钟 · 剩余 ${suggested.remainingMinutes} 分钟可在后续日期继续安排`,
        estimated_minutes: suggested.remainingMinutes
      });
    }
    try {
      await onUpdatePlan({
        ...preview,
        blocks: [...preview.blocks, ...newBlocks],
        unscheduled
      });
      onNotify(
        suggested.remainingMinutes > 0 ? "已拆分加入时间线" : "已加入时间线",
        suggested.remainingMinutes > 0
          ? `今天已安排 ${scheduledMinutes} 分钟，剩余 ${suggested.remainingMinutes} 分钟可在后续日期继续安排。`
          : `“${item.task_title}”已加入当前计划草案。`,
        "check"
      );
    } catch (reason) {
      onNotify("没有加入草案", planDraftErrorMessage(reason, task ?? null, selectedDate), "review");
    }
  }

  function closeTimelinePanel() {
    setSelection(null);
    setPlanDraftTimeEdit(null);
    window.requestAnimationFrame(() => timelineSelectionTriggerRef.current?.focus());
  }

  function pauseTimelineFollowing() {
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
    setExecutionDraft((current) => current ? { ...current, ...update } : current);
  }

  async function saveSelectedBlockExecution() {
    if (!selectedBlock || !executionDraft || selectedDate !== today) return;
    if (!executionDraft.result) {
      setExecutionMessage("请选择本次执行结果。");
      return;
    }
    if (executionDraft.result === "not_completed" && !executionDraft.outcome) {
      setExecutionMessage("请选择未完成原因。");
      return;
    }
    if (!executionDraft.outcome) {
      setExecutionMessage("请选择本次执行结果。");
      return;
    }
    setSavingExecution(true);
    setExecutionMessage("正在记录本次执行…");
    try {
      await saveExecutionCapture(selectedDate, {
        plan_block_id: selectedBlock.id,
        outcome: executionDraft.outcome,
        note: executionDraft.note.trim() || null
      });
      await onFactsChanged();
      setExecutionMessage("本次执行已记录，等待每日复盘核对。");
      onNotify("本次执行已记录", `${selectedBlock.task_title} · 等待每日复盘`, "check");
    } catch (reason) {
      setExecutionMessage(`未记录：${String(reason)}`);
    } finally {
      setSavingExecution(false);
    }
  }

  async function quickCompleteTimelineBlock(block: PlanBlock) {
    if (selectedDate !== today || block.review || quickCompletingBlockId) return;
    setQuickCompletingBlockId(block.id);
    try {
      await saveExecutionCapture(selectedDate, {
        plan_block_id: block.id,
        outcome: "completed",
        note: null
      });
      await onFactsChanged();
      onNotify("本次执行已完成", `${block.task_title} · 等待每日复盘`, "check");
    } catch (reason) {
      onNotify("执行块未完成", String(reason), "review");
    } finally {
      setQuickCompletingBlockId(null);
    }
  }

  async function clearQuickCompletedTimelineBlock(block: PlanBlock) {
    if (selectedDate !== today || block.review || block.execution_status !== "completed" || quickCompletingBlockId) return;
    setQuickCompletingBlockId(block.id);
    try {
      await clearExecutionCapture(selectedDate, block.id);
      await onFactsChanged();
      onNotify("已取消本次完成", `${block.task_title} · 恢复为计划中`, "restore");
    } catch (reason) {
      onNotify("未能取消完成", String(reason), "review");
    } finally {
      setQuickCompletingBlockId(null);
    }
  }

  return (
    <section className="next-page today-page" aria-label="今日">
      {message && <p className="page-status" role="status">{message}</p>}
      <div className="timeline-page-shell">
        <header className="timeline-design-topbar">
          <div className="timeline-date-copy"><h1>{todayView === "month" && monthSelectionPending ? monthTitle : selectedDateTitle}</h1><span>{todayView === "month" && monthSelectionPending ? "选择一天查看安排" : `${selectedWeekday}${selectedLunarDay ? ` · 农历${selectedLunarDay}` : ""}`}</span></div>
          <div className="timeline-top-actions">
            {debugFixtureControlsAvailable && <div className="confirmed-plan-actions" aria-label="debug 布局样例"><span>布局样例</span><button type="button" className="quiet-button" disabled={debugFixturesBusy} onClick={() => void loadDebugTimelineFixtures()}>{debugFixturesBusy ? "处理中…" : "载入"}</button><button type="button" className="quiet-button" disabled={debugFixturesBusy} onClick={() => void clearDebugTimelineFixtures()}>移除</button></div>}
            {isAwayFromToday && <button type="button" className="quiet-button" onClick={returnToday}>回到今天</button>}
            {todayView === "timeline" && (preview ? <div className="plan-draft-top-actions" aria-label="日计划草案操作">
              <span className="plan-draft-mode"><i />{isAdjustingConfirmedPlan ? "调整模式" : "草案模式"}</span>
              <button type="button" className="quiet-button" disabled={busy} onClick={onGeneratePlan}>重新生成</button>
              <button type="button" className="quiet-button" disabled={busy} onClick={() => void onCancelPlan()}>放弃</button>
              <button type="button" className="primary-action" disabled={busy || (!isAdjustingConfirmedPlan && preview.blocks.length === 0)} onClick={onConfirmPlan}>{busy ? "正在保存…" : isAdjustingConfirmedPlan ? "保存调整" : "确认并写入"}</button>
            </div> : hasConfirmedPlan && !isPastDate ? <div className="confirmed-plan-actions" aria-label="已确认计划操作"><span><Icon name="check" size={13} />计划已确认</span><button type="button" className="quiet-button" disabled={busy} onClick={onAdjustPlan}>{busy ? "正在读取…" : "调整计划"}</button></div> : <button type="button" className="primary-action" disabled={busy || isPastDate} title={planActionTitle} onClick={onGeneratePlan}>{busy ? "正在生成…" : planActionLabel}</button>)}
            <div className="segmented-control timeline-view-switch" aria-label="今日页视图">
              <button type="button" aria-pressed={todayView === "month"} onClick={() => setTodayView("month")}>月历</button>
              <button type="button" aria-pressed={todayView === "timeline"} onClick={() => setTodayView("timeline")}>日计划</button>
            </div>
          </div>
        </header>

        {todayView === "month" ? <main className="today-month-view" aria-label={monthTitle}>
          <section className="month-sheet today-month-sheet">
            <div className="month-controls"><button type="button" aria-label="上一个月" onClick={() => moveMonth(-1)}><Icon name="chevron-left" size={17} /></button><strong>{monthTitle}</strong><button type="button" aria-label="下一个月" onClick={() => moveMonth(1)}><Icon name="chevron-right" size={17} /></button></div><div className={`holiday-coverage${holidayCoverageAvailable ? " available" : " missing"}`} role="status">{holidayCoverageAvailable ? `${OFFICIAL_HOLIDAY_COVERAGE.version} · 覆盖 2026 年` : "当前月份超出法定节假日/调休数据覆盖范围；农历和节气仍可显示"}</div>
            <div className="weekday-row">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>周{day}</span>)}</div>
            <div className="month-grid" role="grid" aria-label={monthTitle}>{cells.map((cell) => {
              const dayTasks = tasks.filter((task) => task.status !== "deleted" && taskAppearsOnDate(task, cell.key));
              const count = dayTasks.length;
              const recurringCount = recurringItems.filter((item) => recurringItemAppearsOnDate(item, cell.key)).length;
              const completeOnly = count > 0 && dayTasks.every((task) => task.status === "done");
              const dayInfo = calendarDayInfo(cell.key);
              const lunarLabel = lunarDayLabel(cell.key);
              const workStateLabel = dayInfo?.workState === "rest" ? "休" : dayInfo?.workState === "work" ? "班" : "";
              const calendarLabel = dayInfo?.labels.map((label) => label.text).join("、") ?? "";
              return <button key={cell.key} type="button" role="gridcell" aria-selected={selectedDate === cell.key} aria-label={`${cell.key}${lunarLabel ? `，农历${lunarLabel}` : ""}${calendarLabel ? `，${calendarLabel}` : ""}${workStateLabel ? `，${workStateLabel === "休" ? "放假" : "调休上班"}` : ""}${count ? `，${count} 项任务` : ""}${recurringCount ? `，${recurringCount} 项重复事项` : ""}`} className={`${cell.inMonth ? "in-month" : "outside"}${cell.key === today ? " today" : ""}${selectedDate === cell.key ? " selected" : ""}${dayInfo?.workState ? ` ${dayInfo.workState}` : ""}${count ? " has-tasks" : ""}${recurringCount ? " has-recurring-items" : ""}`} onClick={() => selectCalendarDate(cell.key)}>
                <span className="calendar-day-head"><span className="day-number"><span className="solar-day-number">{cell.day}</span>{lunarLabel && <span className="lunar-day-number">{lunarLabel}</span>}</span>{workStateLabel && <span className={`work-state ${dayInfo?.workState}`}>{workStateLabel}</span>}</span>
                {dayInfo?.labels.length ? <span className="calendar-labels">{dayInfo.labels.map((label) => <span key={`${label.kind}:${label.text}`} className={`calendar-label ${label.kind}`}>{label.text}</span>)}</span> : null}
                {count > 0 || recurringCount > 0 ? <span className="calendar-indicators" aria-hidden="true">
                  {count > 0 && <span className={completeOnly ? "task-indicator complete" : "task-indicator"}><i />{count}<span>项</span></span>}
                  {recurringCount > 0 && <span className="task-indicator recurring"><Icon name="restore" size={10} />{recurringCount}<span>项</span></span>}
                </span> : null}
              </button>;
            })}</div>
          </section>
          <aside className="today-month-summary">{monthSelectionPending ? <div className="today-month-selection-prompt" role="status"><strong>选择一天查看安排</strong><span>日期详情会在你选择日期后显示。</span></div> : <><div><h2>{fullDateLabel(selectedDate, today)}</h2><p>{selectedDate} · Asia/Shanghai</p></div><div className="overview-stats"><div><strong>{taskBlocks.length}</strong><span>执行块</span></div><div><strong>{recordedCount}</strong><span>已记录</span></div><div><strong>{waitingTasks.length}</strong><span>待安排</span></div></div><button type="button" className="primary-action" onClick={() => setTodayView("timeline")}>打开这一天的日计划</button></>}</aside>
        </main> : <main className={`timeline-main${error || loading ? " is-status" : ""}${preview ? " is-plan-draft" : ""}`} aria-label={`${selectedDateTitle}时间线`}>
          {error ? <div className="timeline-state"><strong>无法读取这一天</strong><span>{error}</span><button type="button" className="quiet-button" onClick={() => void onFactsChanged()}>重新读取</button></div> : loading ? <div className="timeline-state">正在读取本地日程…</div> : <>
            <div className="timeline-week" role="group" aria-label="本周日期">{weekDates.map((date) => {
              const dateValue = new Date(`${date}T00:00:00+08:00`);
              const weekday = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", weekday: "short" }).format(dateValue).replace("周", "");
              const lunarLabel = lunarDayLabel(date);
              const isWeekend = weekday === "六" || weekday === "日";
              return <button key={date} type="button" className={`${isWeekend ? "weekend " : ""}${date === today ? "today " : ""}${date === selectedDate ? "selected" : ""}`.trim()} aria-pressed={date === selectedDate} aria-current={date === today ? "date" : undefined} aria-label={`${date}，周${weekday}${lunarLabel ? `，农历${lunarLabel}` : ""}`} onClick={() => selectCalendarDate(date)}><small>{weekday}</small><span className="timeline-week-date"><strong>{Number(date.slice(8, 10))}</strong>{lunarLabel && <span>{lunarLabel}</span>}</span></button>;
            })}</div>
            {preview && <div className="plan-draft-summary" role="status"><span><Icon name="sparkle" size={14} /><strong>{preview.blocks.length} 个拟安排时间块</strong>{preview.unscheduled.length > 0 && <> · {preview.unscheduled.length} 项未排入</>}</span><small>{isAdjustingConfirmedPlan ? "可调整时间块或重新生成；保存前，原确认计划保持不变。" : "点击浅蓝虚线时间块可修改；所有调整已保存为本机草案，确认前不会写入正式日历。"}</small></div>}
            <div className="timeline-lanes">
              {untimedRecurringOccurrences.length > 0 && <section className="recurring-occurrence-lane" aria-label="今天的重复事项"><h2>重复事项</h2><div>{untimedRecurringOccurrences.map((item) => <div key={item.id} className="lane-item recurring" role="note" tabIndex={0} {...timelineTooltipProps({ kind: "重复事项", title: item.title, time: "时间未指定", detail: item.outcome ? `已复盘 · ${item.outcome === "completed" ? "完成" : item.outcome === "partial" ? "部分完成" : "未完成"}` : "待复盘；未设置展示时间", tone: "recurring" })}><span className="lane-symbol recurring" aria-hidden="true" /><span className="lane-copy"><strong>{item.title}</strong><small>{item.outcome ? `已复盘 · ${item.outcome === "completed" ? "完成" : item.outcome === "partial" ? "部分完成" : "未完成"}` : "时间未指定 · 待复盘"}</small></span></div>)}</div></section>}
              <section className="waiting-task-lane" aria-label={preview ? "草案中未排入今日的任务" : "待安排任务"}><h2>{preview ? "未排入" : "待安排"}</h2><div>{preview ? preview.unscheduled.length ? preview.unscheduled.map((item) => {
                const task = tasks.find((candidate) => candidate.id === item.task_id);
                const actionLabel = item.estimated_minutes ? "加入时间线" : "补充估时";
                return <div
                  key={item.task_id}
                  className="lane-item draft-unscheduled"
                  {...timelineTooltipProps({
                    kind: "待安排任务",
                    title: item.task_title,
                    time: item.estimated_minutes ? `预计 ${item.estimated_minutes} 分钟` : "尚未估时",
                    detail: waitingTaskTooltipDetail(task, item.reason),
                    tone: "task"
                  })}
                ><TaskCapsuleContent title={item.task_title} notes={item.reason} priority={task?.priority} tags={task?.tags} timing={task ? taskTimingFact(task, selectedDate) : null} minutes={item.estimated_minutes} status="未排入" sourceType={task?.source_type} compact /><button type="button" disabled={busy} title={item.estimated_minutes ? `加入当天日计划，预计 ${item.estimated_minutes} 分钟` : "打开任务并填写预计工作量"} onClick={() => !item.estimated_minutes ? onOpenTasks(item.task_id) : void includeUnscheduledTask(item)}>{actionLabel}</button></div>;
              }) : <span className="timeline-lane-empty">所有任务都已排入草案</span> : waitingTasks.length ? waitingTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className="lane-item task"
                  aria-label={`打开任务：${task.title}，${waitingTaskLabel(task)}`}
                  {...timelineTooltipProps({
                    kind: "待安排任务",
                    title: task.title,
                    time: "时间待定",
                    detail: waitingTaskTooltipDetail(task, waitingTaskLabel(task)),
                    tone: "task"
                  })}
                  onClick={() => onOpenTasks(task.id)}
                ><TaskCapsuleContent title={task.title} notes={task.notes || waitingTaskLabel(task)} priority={task.priority} tags={task.tags} timing={taskTimingFact(task, selectedDate)} minutes={taskUnreservedMinutes(task)} status="待安排" sourceType={task.source_type} compact /></button>
              )) : <span className="timeline-lane-empty">暂无待安排任务</span>}</div></section>
            </div>
            <div ref={timelineScrollRef} className="timeline-scroll" tabIndex={0} aria-label="24 小时时间线" onScroll={handleTimelineScroll} onWheel={pauseTimelineFollowing} onTouchMove={pauseTimelineFollowing} onPointerDown={(event) => { if (event.currentTarget === event.target) pauseTimelineFollowing(); }} onKeyDown={handleTimelineScrollKey}>
              {selectedDate === today && showReturnToNow && <div className="return-to-now-layer"><button type="button" onClick={resumeTimelineFollowing}><Icon name="clock" size={14} />回到现在</button></div>}
              {selection && <div className="timeline-floating-layer"><section ref={timelineFloatingPanelRef} className={`timeline-floating-panel${selectedDraftBlock ? " plan-draft-editor" : ""}`} role="dialog" aria-label={selectedDraftBlock ? `${selectedDraftBlock.task_title}草案时间` : selectedBlock ? `${selectedBlock.task_title}本次执行记录` : selectedEvent ? `${selectedEvent.title}日程详情` : "时间线详情"} aria-live="polite" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") closeTimelinePanel(); }}>
                {selectedDraftBlock && planDraftTimeEdit ? <>
                  <header><div><strong>调整草案时间</strong><small>{selectedDraftBlock.task_title} · 尚未写入正式日历</small></div><button type="button" aria-label="关闭草案编辑面板" onClick={closeTimelinePanel}><Icon name="close" size={15} /></button></header>
                  <form className="plan-draft-time-form" noValidate onSubmit={(event) => void savePlanDraftTime(event)}>
                    <dl id="plan-draft-constraints" className="plan-draft-bounds" aria-label="任务允许的时间范围"><div><dt>最早开始</dt><dd>{taskBoundaryLabel(selectedDraftTask?.earliest_start_at ?? null, selectedDate)}</dd></div><div><dt>最晚结束（截止）</dt><dd>{taskBoundaryLabel(selectedDraftTask?.due_at ?? null, selectedDate)}</dd></div></dl>
                    <div className="plan-draft-time-fields"><TimeRangeRail start={planDraftTimeEdit.starts_at} end={planDraftTimeEdit.ends_at} minMinute={draftTimeBounds.min} maxMinute={draftTimeBounds.max} segments={nonWorkingTimeSegments} disabled={busy} describedBy="plan-draft-constraints" onChange={(next) => setPlanDraftTimeEdit({ ...planDraftTimeEdit, starts_at: next.start, ends_at: next.end, error: "" })} /></div>
                    <p className="plan-draft-availability"><Icon name="clock" size={14} /><span>{availability ? `工作时间 ${availability.workday_start} – ${availability.workday_end} 仅作安排偏好与时间线参照。` : ""}可直接输入或拖动开始、结束端；每次以 15 分钟为步进调整，保存后仍会再次校验任务日期边界。</span></p>
                    {planDraftTimeEdit.error && <span className="plan-draft-edit-error" role="alert">{planDraftTimeEdit.error}</span>}
                    <footer><button type="button" className="text-danger" disabled={busy} onClick={() => void removePlanDraftBlock()}><Icon name="trash" size={14} />移出今日</button><div><button type="button" className="quiet-button" disabled={busy} onClick={closeTimelinePanel}>取消</button><button type="submit" className="primary-action" disabled={busy}>{busy ? "正在保存…" : "保存草案时间"}</button></div></footer>
                  </form>
                </> : selectedBlock ? <><header><div><strong>{selectedBlock.review ? "每日复盘已确认" : selectedBlock.execution_status === "planned" ? "记录本次执行" : "本次执行已记录"}</strong><small>{selectedBlock.task_title} · 详细信息在每日复盘核对</small></div><div className="timeline-panel-header-actions">{selectedBlock.execution_status === "planned" && !selectedBlock.review && !isPastDate && <button type="button" className="timeline-adjust-action" disabled={busy} onClick={() => void adjustSelectedBlockTime()}>调整时间</button>}<button type="button" aria-label="关闭执行面板" onClick={closeTimelinePanel}><Icon name="close" size={15} /></button></div></header>
                  {selectedBlock.review ? <><div className={`floating-facts execution-${selectedBlock.review.outcome}`}><div><span>本次结果</span><strong>{reviewOutcomeCopy[selectedBlock.review.outcome]}</strong></div><div><span>实际耗时</span><strong>{selectedBlock.review.actual_minutes} 分钟</strong></div><div><span>剩余工作量</span><strong>{selectedBlock.review.remaining_workload_minutes === null ? "未重估" : `${selectedBlock.review.remaining_workload_minutes} 分钟`}</strong></div>{selectedBlock.review.notes && <div className="wide"><span>备注</span><strong>{selectedBlock.review.notes}</strong></div>}{selectedBlock.review.defer_reason && <div className="wide"><span>延期原因</span><strong>{selectedBlock.review.defer_reason}</strong></div>}</div><footer><span role="status">最终事实已在每日复盘确认。</span><strong className="context-readonly-state">只读</strong></footer></> : selectedDate !== today ? selectedBlock.execution_status !== "planned" ? <><div className={`floating-capture-fact execution-${selectedBlock.execution_status}`}><span>本次结果</span><strong>{reviewOutcomeCopy[selectedBlock.execution_status]}</strong>{selectedBlock.execution_note && <p>{selectedBlock.execution_note}</p>}</div><div className="floating-readonly"><strong>当日已记录，尚未复盘</strong><span>历史记录保持原样，今序不会事后补填实际耗时或剩余工作量。</span></div></> : <div className="floating-readonly"><strong>{isPastDate ? "历史日期只读" : "未来执行块暂不可记录"}</strong><span>{isPastDate ? "这条执行块当时没有保存执行记录。" : "到执行日期后再记录本次结果。"}</span></div> : executionDraft ? <><div className="floating-capture-intro"><strong>只记录现在确定的事实</strong><span>实际耗时、剩余工作量和整个任务状态留到每日复盘。</span></div><ExecutionOutcomePicker compact label="本次执行结果" result={executionDraft.result} outcome={executionDraft.outcome} disabled={savingExecution} onChange={(result, outcome) => updateExecutionDraft({ result, outcome })} /><label className="floating-execution-note">简短备注<textarea rows={2} maxLength={500} placeholder="可选，先记下一句，复盘时还能修改" value={executionDraft.note} disabled={savingExecution} onChange={(event) => updateExecutionDraft({ note: event.target.value })} /></label><footer><span role="status" className={executionMessage.startsWith("未记录") ? "error" : ""}>{executionMessage || "保存后仍可在今天的每日复盘中核对。"}</span><div><button type="button" className="quiet-button" onClick={closeTimelinePanel}>取消</button><button type="button" className="primary-action" disabled={savingExecution} onClick={() => void saveSelectedBlockExecution()}>{savingExecution ? "正在记录…" : "保存本次记录"}</button></div></footer></> : null}
                </> : selectedEvent ? <><header><div><strong>{selectedEvent.title}</strong><small>{selectedEvent.is_all_day ? "全天固定日程" : `${timeRangeLabel(selectedEvent.starts_at, selectedEvent.ends_at)} · 固定日程`}</small></div><button type="button" aria-label="关闭日程详情" onClick={closeTimelinePanel}><Icon name="close" size={15} /></button></header><div className="floating-readonly"><strong>固定日程</strong><span>固定日程不使用执行块完成控件，也不会限制同一时段安排其他事项。</span></div></> : null}
              </section></div>}
              <div className="hourly-timeline" style={{ "--timeline-height": `${timelineHeight}px` } as CSSProperties}><div className="timeline-hours" aria-hidden="true">{timelineHours.map((hour, index) => <div key={hour} className={`timeline-hour${showNowLine && Math.abs(nowMinute - index * 60) / 60 * pixelsPerHour <= nowLabelOverlapDistance ? " current-time-covered" : ""}`} style={{ top: `${index * pixelsPerHour}px` }}><time>{String(hour).padStart(2, "0")}:00</time><span /></div>)}</div><div className="timeline-events" style={{ height: `${timelineHeight}px` }}>
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
                {recurringTimelineBlocks.map(({ item, starts_at, ends_at, layoutKey }) => <div key={item.id} className={`timeline-event recurring-event${item.outcome ? ` reviewed outcome-${item.outcome}` : ""}`} style={timelineEventPosition(starts_at, ends_at, selectedDate, axisStart, pixelsPerHour, timelineItemLanes[layoutKey])} tabIndex={0} {...timelineTooltipProps({ kind: "重复事项", title: item.title, time: timeRangeLabel(starts_at, ends_at), detail: item.outcome ? `已复盘 · ${item.outcome === "completed" ? "完成" : item.outcome === "partial" ? "部分完成" : "未完成"}` : "待复盘；重复事项不生成普通任务或执行块", tone: "recurring" }, "block-bottom")}><span className="timeline-event-symbol recurring" aria-hidden="true" /><span className="timeline-event-copy"><strong>{item.title}</strong><small><Icon name="clock" size={11} />{timeRangeLabel(starts_at, ends_at)}</small></span><span className="recurring-event-icon" aria-hidden="true"><img src={recurringIcon} alt="" /></span></div>)}
                {draftBlocks.map((block, index) => <button
                  key={draftLayoutKeys[index]}
                  type="button"
                  className={`timeline-event plan-draft-block${block.estimated_minutes <= 45 ? " is-compact" : ""}${selection?.kind === "draft" && selection.id === String(index) ? " selected" : ""}`}
                  style={timelineEventPosition(block.starts_at, block.ends_at, selectedDate, axisStart, pixelsPerHour, timelineItemLanes[draftLayoutKeys[index]])}
                  aria-pressed={selection?.kind === "draft" && selection.id === String(index)}
                  {...timelineTooltipProps({
                    kind: "计划草案",
                    title: block.task_title,
                    time: timeRangeLabel(block.starts_at, block.ends_at),
                    detail: `预计 ${block.estimated_minutes} 分钟 · 点击可调整时间`,
                    tone: "draft"
                  }, "block-top")}
                  onClick={(event) => selectPlanDraftBlock(index, event.currentTarget)}
                ><span className="plan-draft-grip" aria-hidden="true" /><span className="timeline-event-copy"><strong>{block.task_title}</strong><small><Icon name="clock" size={11} />{timeRangeLabel(block.starts_at, block.ends_at)} · {block.estimated_minutes} 分钟</small></span></button>)}
                {visibleTaskBlocks.map((block) => {
                  const effectiveOutcome = block.review?.outcome ?? (block.execution_status === "planned" ? null : block.execution_status);
                  const blockCompleted = effectiveOutcome === "completed";
                  const blockIsSaving = quickCompletingBlockId === block.id;
                  const blockHasFact = effectiveOutcome !== null;
                  const quickCompleteLabel = blockCompleted
                    ? `${block.task_title}本次执行已完成${block.review ? "，每日复盘已确认" : "，等待每日复盘"}`
                    : blockHasFact
                      ? `${block.task_title}已记录本次${reviewOutcomeCopy[effectiveOutcome!]}`
                      : selectedDate === today
                        ? `记录本次完成：${block.task_title}`
                        : `${block.task_title}仅可在执行当天记录`;
                  return <div
                    key={block.id}
                    className={`timeline-event execution-block${effectiveOutcome ? ` ${block.review ? "reviewed" : "captured"} execution-${effectiveOutcome}` : ""}${selection?.kind === "block" && selection.id === block.id ? " selected" : ""}`}
                    style={timelineEventPosition(block.starts_at, block.ends_at, selectedDate, axisStart, pixelsPerHour, timelineItemLanes[`block:${block.id}`])}
                    {...timelineTooltipProps({
                      kind: "执行块",
                      title: block.task_title,
                      time: timeRangeLabel(block.starts_at, block.ends_at),
                      detail: block.review
                        ? `本次${reviewOutcomeCopy[block.review.outcome]} · 已复盘 · 实际 ${block.review.actual_minutes} 分钟`
                        : effectiveOutcome
                          ? `本次${reviewOutcomeCopy[effectiveOutcome]} · 等待每日复盘`
                          : `尚未开始 · 计划 ${durationLabel(block.starts_at, block.ends_at)}`,
                      tone: effectiveOutcome ? `execution-${effectiveOutcome}` : "execution"
                    }, "block-top")}
                  >
                    <span className="plan-draft-grip" aria-hidden="true" />
                    <div className="timeline-execution-content">
                      <button type="button" className={`timeline-event-check${blockCompleted ? " done" : ""}${blockHasFact && !blockCompleted ? " recorded" : ""}${blockIsSaving ? " saving" : ""}`} aria-label={block.review ? `${block.task_title}已完成每日复盘，不能取消完成` : blockCompleted ? `取消完成：${block.task_title}` : quickCompleteLabel} aria-pressed={blockCompleted} disabled={Boolean(block.review) || blockHasFact && !blockCompleted || blockIsSaving || selectedDate !== today} onClick={() => void (blockCompleted ? clearQuickCompletedTimelineBlock(block) : quickCompleteTimelineBlock(block))}>{blockIsSaving ? <span className="timeline-check-spinner" /> : blockCompleted ? <Icon name="check" size={11} /> : null}</button>
                      <button type="button" className="timeline-event-body" aria-pressed={selection?.kind === "block" && selection.id === block.id} onClick={(event) => selectTimelineItem({ kind: "block", id: block.id }, event.currentTarget)}><span className="timeline-event-copy"><strong>{block.task_title}</strong><small><Icon name="clock" size={11} />{timeRangeLabel(block.starts_at, block.ends_at)} · {block.review ? `${reviewOutcomeCopy[block.review.outcome]} ${block.review.actual_minutes} 分钟` : effectiveOutcome ? `本次${reviewOutcomeCopy[effectiveOutcome]} · 待复盘` : `计划 ${durationLabel(block.starts_at, block.ends_at)}`}</small></span></button>
                    </div>
                  </div>;
                })}
                {selectedTimelineFrame && timelineItemLanes[selectedTimelineFrame.layoutKey] && <div className="timeline-event-selection-frame" style={timelineEventPosition(selectedTimelineFrame.starts_at, selectedTimelineFrame.ends_at, selectedDate, axisStart, pixelsPerHour, timelineItemLanes[selectedTimelineFrame.layoutKey])} aria-hidden="true" />}
              </div>{showNowLine && <div className="current-time-line" style={{ top: `${(nowMinute - axisStart) / 60 * pixelsPerHour}px` }} aria-label={`当前时间 ${shanghaiClock.label}`}><span>{shanghaiClock.label}</span></div>}</div>
            </div>
          </>}
        </main>}
      </div>
      {timelineTooltip && createPortal(
        <aside
          id="timeline-time-block-tooltip"
          className={`timeline-hover-card tone-${timelineTooltip.tone} placement-${timelineTooltip.placement}`}
          style={{ left: timelineTooltip.left, top: timelineTooltip.top }}
          role="tooltip"
        >
          <div className="timeline-hover-meta"><span>{timelineTooltip.kind}</span><time>{timelineTooltip.time}</time></div>
          <strong>{timelineTooltip.title}</strong>
          <p>{timelineTooltip.detail}</p>
        </aside>,
        document.body
      )}
    </section>
  );
}

type ReviewDraft = {
  result: ExecutionResult | null;
  outcome: ReviewOutcome | null;
  actual_minutes: string;
  defer_reason: string;
  notes: string;
  remaining_workload_minutes: string;
};

function ReviewPage({ today, onFactsChanged }: { today: string; onFactsChanged: (date: string) => void }) {
  const [reviewDate, setReviewDate] = useState(today);
  const [schedule, setSchedule] = useState<DaySchedule | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingBlockId, setSavingBlockId] = useState<string | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [pendingTaskCompletion, setPendingTaskCompletion] = useState<{ taskId: string; taskTitle: string; blockId: string } | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [recurringOccurrences, setRecurringOccurrences] = useState<RecurringOccurrence[]>([]);
  const [recurringDrafts, setRecurringDrafts] = useState<Record<string, { outcome: RecurringOccurrenceOutcome | null; notes: string }>>({});

  async function loadReviewSchedule(date: string) {
    setLoading(true);
    setError(null);
    try {
      const [next, occurrences] = await Promise.all([getDaySchedule(date), listRecurringOccurrences(date)]);
      setSchedule(next);
      setRecurringOccurrences(occurrences);
      setRecurringDrafts(date === today ? Object.fromEntries(occurrences.filter((item) => !item.outcome).map((item) => [item.id, { outcome: null, notes: "" }])) : {});
      setDrafts(date === today ? Object.fromEntries(next.task_blocks.filter((block) => !block.review).map((block) => [block.id, {
        result: executionResultForOutcome(block.execution_status === "planned" ? null : block.execution_status),
        outcome: block.execution_status === "planned" ? null : block.execution_status,
        actual_minutes: "",
        defer_reason: "",
        notes: block.execution_note ?? "",
        remaining_workload_minutes: block.remaining_workload_minutes === null ? "" : String(block.remaining_workload_minutes)
      }])) : {});
    } catch (reason) {
      setSchedule(null);
      setRecurringOccurrences([]);
      setDrafts({});
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setMessages({});
    setPendingTaskCompletion(null);
    void loadReviewSchedule(reviewDate);
  }, [reviewDate]);

  function updateDraft(blockId: string, update: Partial<ReviewDraft>) {
    setDrafts((current) => ({ ...current, [blockId]: { ...current[blockId], ...update } }));
  }

  async function saveBlockReview(blockId: string) {
    if (reviewDate !== today) {
      setMessages((current) => ({ ...current, [blockId]: "历史日期只展示已经保存的执行与复盘事实。" }));
      return;
    }
    const draft = drafts[blockId];
    if (!draft?.result) {
      setMessages((current) => ({ ...current, [blockId]: "请选择这次执行的结果。" }));
      return;
    }
    if (draft.result === "not_completed" && !draft.outcome) {
      setMessages((current) => ({ ...current, [blockId]: "请选择未完成原因。" }));
      return;
    }
    if (!draft.outcome) {
      setMessages((current) => ({ ...current, [blockId]: "请选择这次执行的结果。" }));
      return;
    }
    const actualMinutes = Number(draft.actual_minutes);
    const remainingMinutes = draft.remaining_workload_minutes.trim() === "" ? null : Number(draft.remaining_workload_minutes);
    if (draft.actual_minutes.trim() === "" || !Number.isInteger(actualMinutes) || actualMinutes < 0) {
      setMessages((current) => ({ ...current, [blockId]: "实际耗时需填写为不小于 0 的整数分钟。" }));
      return;
    }
    if (remainingMinutes !== null && (!Number.isInteger(remainingMinutes) || remainingMinutes < 0)) {
      setMessages((current) => ({ ...current, [blockId]: "剩余工作量需填写为不小于 0 的整数分钟。" }));
      return;
    }
    const input: ReviewEntryInput = {
      plan_block_id: blockId,
      outcome: draft.outcome,
      actual_minutes: actualMinutes,
      defer_reason: draft.defer_reason.trim() || null,
      notes: draft.notes.trim() || null,
      remaining_workload_minutes: remainingMinutes
    };
    setSavingBlockId(blockId);
    setMessages((current) => ({ ...current, [blockId]: "正在写入本机…" }));
    try {
      await saveReviewEntry(reviewDate, input);
      await loadReviewSchedule(reviewDate);
      onFactsChanged(reviewDate);
      setMessages((current) => ({ ...current, [blockId]: "执行与复盘事实已写入 SQLite。" }));
    } catch (reason) {
      setMessages((current) => ({ ...current, [blockId]: `未保存：${String(reason)}` }));
    } finally {
      setSavingBlockId(null);
    }
  }

  async function completeWholeTask(taskId: string, blockId: string) {
    if (reviewDate !== today) {
      setMessages((current) => ({ ...current, [blockId]: "历史日期只读，不能从这里改变任务状态。" }));
      return;
    }
    setPendingTaskCompletion(null);
    setCompletingTaskId(taskId);
    setMessages((current) => ({ ...current, [blockId]: "正在完成整个任务…" }));
    try {
      await completeTaskFromReview(taskId, reviewDate, true);
      await loadReviewSchedule(reviewDate);
      onFactsChanged(reviewDate);
      setMessages((current) => ({ ...current, [blockId]: "整个任务已完成；执行块和复盘事实仍已保留。" }));
    } catch (reason) {
      setMessages((current) => ({ ...current, [blockId]: `任务未完成：${String(reason)}` }));
    } finally {
      setCompletingTaskId(null);
    }
  }

  async function saveRecurringReview(occurrenceId: string) {
    const draft = recurringDrafts[occurrenceId];
    if (reviewDate !== today || !draft?.outcome) {
      setMessages((current) => ({ ...current, [occurrenceId]: reviewDate !== today ? "历史日期只读。" : "请选择完成、部分完成或未完成。" }));
      return;
    }
    setSavingBlockId(occurrenceId);
    try {
      await saveRecurringOccurrenceReview(occurrenceId, { outcome: draft.outcome, notes: draft.notes.trim() || null });
      await loadReviewSchedule(reviewDate);
      onFactsChanged(reviewDate);
      setMessages((current) => ({ ...current, [occurrenceId]: "重复事项结果已写入 SQLite。" }));
    } catch (reason) {
      setMessages((current) => ({ ...current, [occurrenceId]: `未保存：${String(reason)}` }));
    } finally {
      setSavingBlockId(null);
    }
  }

  const blocks = schedule?.task_blocks ?? [];
  const savedCount = blocks.filter((block) => block.review).length;
  const recurringSavedCount = recurringOccurrences.filter((item) => item.outcome).length;
  const isToday = reviewDate === today;
  const previousDate = shiftDateValue(reviewDate, -1);
  const nextDate = shiftDateValue(reviewDate, 1);

  return <section className="next-page review-page">
    <header className="page-commandbar"><div><h1>复盘</h1><p>记录实际发生的事，不覆盖原计划。</p></div><div className="review-date-controls"><button type="button" aria-label="前一天" title="前一天" onClick={() => setReviewDate(previousDate)}><Icon name="chevron-left" size={15} /></button><input type="date" max={today} aria-label="复盘日期" value={reviewDate} onChange={(event) => event.target.value && setReviewDate(event.target.value)} /><button type="button" aria-label="后一天" title="后一天" disabled={nextDate > today} onClick={() => setReviewDate(nextDate)}><Icon name="chevron-right" size={15} /></button><button type="button" className="review-today" disabled={isToday} onClick={() => setReviewDate(today)}>今天</button></div></header>
    <div className="review-date-line"><strong>{fullDateLabel(reviewDate, today)}</strong><span>{isToday ? "今天的记录可逐条保存" : "历史日期只呈现已确认计划与已保存事实"}</span></div>
    <div className="review-summary"><div><strong>{blocks.length}</strong><span>执行块</span></div><div><strong>{recurringOccurrences.length}</strong><span>重复事项</span></div><div><strong>{savedCount + recurringSavedCount}</strong><span>已保存</span></div><p>执行块与重复事项分别记录，不互相改变状态。</p></div>
    {!loading && !error && recurringOccurrences.length > 0 && <section className="recurring-review-section" aria-labelledby="recurring-review-title"><header><div><h2 id="recurring-review-title">重复事项</h2><p>直接记录今天这一次，不提供“跳过本次”。</p></div><span>{recurringSavedCount}/{recurringOccurrences.length} 已处理</span></header><div className="review-ledger recurring-review-ledger">{recurringOccurrences.map((item) => { const draft = recurringDrafts[item.id]; const busy = savingBlockId === item.id; return <article key={item.id} className={item.outcome ? "review-saved" : ""}><header><div><strong>{item.title}</strong><span>{item.display_time && item.display_duration_minutes ? `${item.display_time} · ${item.display_duration_minutes} 分钟 · 时间展示` : "时间未指定"}</span></div><span>{item.outcome ? "复盘已确认" : "待复盘"}</span></header>{item.outcome ? <><div className="review-facts"><div><span>本次结果</span><strong>{item.outcome === "completed" ? "完成" : item.outcome === "partial" ? "部分完成" : "未完成"}</strong></div>{item.review_notes && <div className="review-fact-wide"><span>复盘备注</span><strong>{item.review_notes}</strong></div>}</div><div className="review-actions"><span role="status">结果已保存，规则仍按原计划继续。</span></div></> : draft ? <><div className="recurring-outcome-picker" role="group" aria-label={`${item.title}本次结果`}>{([['completed','完成'],['partial','部分完成'],['not_completed','未完成']] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={draft.outcome === value} disabled={busy} onClick={() => setRecurringDrafts((current) => ({ ...current, [item.id]: { ...draft, outcome: value } }))}>{label}</button>)}</div><label className="recurring-review-notes">复盘备注<textarea rows={2} maxLength={2000} value={draft.notes} placeholder="可选，记录今天这一次" disabled={busy} onChange={(event) => setRecurringDrafts((current) => ({ ...current, [item.id]: { ...draft, notes: event.target.value } }))} /></label><div className="review-actions"><span role="status">{messages[item.id] || "确认后只保存今天这一次的结果。"}</span><button type="button" disabled={busy || !draft.outcome} onClick={() => void saveRecurringReview(item.id)}>{busy ? "正在写入…" : "确认本次复盘"}</button></div></> : <div className="review-history-readonly"><strong>历史日期只读</strong><span>这一次没有保存复盘结果。</span></div>}</article>; })}</div></section>}
    {loading ? <div className="review-empty compact"><Icon name="clock" size={24} /><h2>正在读取本机记录</h2><p>执行块和复盘事实都以 SQLite 返回结果为准。</p></div> : error ? <div className="review-empty compact error"><Icon name="review" size={26} /><h2>这一天的记录没有读出来</h2><p>{error}</p><button type="button" className="quiet-button" onClick={() => void loadReviewSchedule(reviewDate)}>重新读取</button></div> : blocks.length ? <div className="review-ledger">{blocks.map((block) => {
      const draft = drafts[block.id];
      const saved = block.review;
      const busy = savingBlockId === block.id;
      const canCompleteTask = isToday && saved && !["done", "cancelled", "deleted"].includes(block.task_status);
      const capturedOutcome = !saved && block.execution_status !== "planned" ? block.execution_status : null;
      const captured = capturedOutcome !== null;
      const reviewTone = saved?.outcome ?? capturedOutcome;
      return <article key={block.id} className={`${saved ? "review-saved" : captured ? "review-captured" : ""}${reviewTone ? ` execution-${reviewTone}` : ""}`.trim()}>
        <header><div><strong>{block.task_title}</strong><span>{timeRangeLabel(block.starts_at, block.ends_at)} · 原计划 {durationLabel(block.starts_at, block.ends_at)}</span></div><span>{saved ? "复盘已确认" : captured ? "已记录 · 待复盘" : "待复盘"}</span></header>
        {saved ? <>
          <div className="review-facts" aria-label={`${block.task_title}已保存复盘事实`}><div><span>执行结果</span><strong>{reviewOutcomeCopy[saved.outcome]}</strong></div><div><span>实际耗时</span><strong>{saved.actual_minutes} 分钟</strong></div><div><span>剩余工作量</span><strong>{saved.remaining_workload_minutes === null ? "未重估" : `${saved.remaining_workload_minutes} 分钟`}</strong></div>{saved.defer_reason && <div className="review-fact-wide"><span>延期原因</span><strong>{saved.defer_reason}</strong></div>}{saved.notes && <div className="review-fact-wide"><span>复盘备注</span><strong>{saved.notes}</strong></div>}</div>
          <div className="review-actions"><span role="status">{messages[block.id] || `已于本机保存 · ${saved.created_at.slice(0, 10)}`}</span></div>
          <div className="review-task-followup"><div><strong>任务后续</strong><span>这里决定整件任务是否还需要继续，不改变上面的本次执行事实。</span></div>{block.task_status === "done" ? <strong className="task-complete-state"><Icon name="check" size={14} />整个任务已完成</strong> : canCompleteTask ? <button type="button" className="complete-task-action" disabled={completingTaskId === block.task_id} onClick={() => setPendingTaskCompletion({ taskId: block.task_id, taskTitle: block.task_title, blockId: block.id })}>{completingTaskId === block.task_id ? "正在完成任务…" : "完成整个任务"}</button> : null}</div>
        </> : draft ? <>
          {capturedOutcome && <div className="review-capture-note"><Icon name="check" size={14} /><span>已从时间线带入“本次{reviewOutcomeCopy[capturedOutcome]}”{block.execution_note ? "和简短备注" : ""}，请核对后确认。</span></div>}
          <ExecutionOutcomePicker label={`${block.task_title}本次执行结果`} result={draft.result} outcome={draft.outcome} disabled={busy} onChange={(result, outcome) => updateDraft(block.id, { result, outcome })} />
          <div className="review-fields"><label>实际耗时<input type="number" min="0" step="1" placeholder="必填" value={draft.actual_minutes} disabled={busy} onChange={(event) => updateDraft(block.id, { actual_minutes: event.target.value })} /><span>分钟</span></label><label>剩余工作量<input type="number" min="0" step="1" placeholder="不重估" value={draft.remaining_workload_minutes} disabled={busy} onChange={(event) => updateDraft(block.id, { remaining_workload_minutes: event.target.value })} /><span>分钟</span></label><label className="review-wide">延期原因<input maxLength={500} placeholder="可选，记录推迟或受阻原因" value={draft.defer_reason} disabled={busy} onChange={(event) => updateDraft(block.id, { defer_reason: event.target.value })} /></label><label className="review-wide">复盘备注<textarea rows={2} maxLength={2000} placeholder="可选，核对或补充本次事实" value={draft.notes} disabled={busy} onChange={(event) => updateDraft(block.id, { notes: event.target.value })} /></label></div>
          <div className="review-actions"><span role="status" className={messages[block.id]?.startsWith("未保存") ? "error" : ""}>{messages[block.id] || "核对后保存为今天的最终复盘事实。"}</span><button type="button" disabled={busy} onClick={() => void saveBlockReview(block.id)}>{busy ? "正在写入…" : "确认本次复盘"}</button></div>
        </> : capturedOutcome ? <div className={`review-history-readonly has-capture execution-${capturedOutcome}`}><strong>本次{reviewOutcomeCopy[capturedOutcome]} · 未完成复盘</strong><span>{block.execution_note || "当天保存了轻量执行记录，但没有确认实际耗时和剩余工作量。"}</span></div> : <div className="review-history-readonly"><strong>历史日期只读</strong><span>这条执行块当时没有保存执行或复盘事实；今序不会事后补造记录。</span></div>}
      </article>;
    })}</div> : recurringOccurrences.length ? <div className="review-no-task-blocks"><Icon name="check" size={16} /><span>今天没有执行块，重复事项可以直接在上方处理。</span></div> : <div className="review-empty"><Icon name="review" size={28} /><h2>{isToday ? "今天没有需要复盘的内容" : "这一天没有复盘内容"}</h2><p>{isToday ? "确认过的日计划执行块或到期的重复事项会出现在这里。" : "历史只展示实际写入过的计划和复盘记录，不补造空白内容。"}</p></div>}
    <footer className="review-page-footer"><span><Icon name="check" size={14} />保存后从 SQLite 重新读取；原计划时间不会被实际耗时覆盖。</span></footer>
    {pendingTaskCompletion && <div className="dialog-backdrop task-completion-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !completingTaskId) setPendingTaskCompletion(null); }}><section className="unsaved-dialog task-completion-dialog" role="alertdialog" aria-modal="true" aria-labelledby="review-task-completion-title" aria-describedby="review-task-completion-description" onKeyDown={(event) => { if (event.key === "Escape" && !completingTaskId) setPendingTaskCompletion(null); }}><div className="dialog-icon completion"><Icon name="check" size={19} /></div><h2 id="review-task-completion-title">确认完成整个任务？</h2><p id="review-task-completion-description">“{pendingTaskCompletion.taskTitle}”以后将不再进入计划；今天已经确认的本次执行事实会继续保留。</p><div className="dialog-actions"><button type="button" autoFocus disabled={Boolean(completingTaskId)} onClick={() => setPendingTaskCompletion(null)}>取消</button><button type="button" className="dialog-save" disabled={Boolean(completingTaskId)} onClick={() => void completeWholeTask(pendingTaskCompletion.taskId, pendingTaskCompletion.blockId)}>{completingTaskId ? "正在完成…" : "确认完成任务"}</button></div></section></div>}
  </section>;
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
  const [activeCategory, setActiveCategory] = useState("ai");
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<AiConnectionSettings | null>(null);
  const [aiForm, setAiForm] = useState<{ api_type: "chat_completions" | "responses"; endpoint: string; model: string }>({ api_type: "chat_completions", endpoint: "https://api.openai.com/v1", model: "gpt-5-mini" });
  const [aiKey, setAiKey] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState("");
  const [reminders, setReminders] = useState({ morning: true, morningTime: "08:30", evening: true, eveningTime: "21:30", taskLead: 5 });
  const [appearance, setAppearance] = useState({ theme: "default", mode: "light", fontSize: 15 });
  const [desktop, setDesktop] = useState({ autostart: false, closeToTray: true, shortcut: "Ctrl+Alt+Space" });
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");
  const savedPreferences = useRef<{ reminders: typeof reminders; appearance: typeof appearance; desktop: typeof desktop } | null>(null);
  const availabilityState = saving ? "正在保存" : availability ? "已读取本机" : availabilityError ? "读取失败" : "正在读取";
  const availabilityDirty = Boolean(draft && availability && JSON.stringify(draft) !== JSON.stringify(availability));
  const aiDirty = Boolean(aiSettings && (aiKey.trim() || aiForm.api_type !== aiSettings.api_type || aiForm.endpoint !== aiSettings.endpoint || aiForm.model !== aiSettings.model));
  const preferencesDirty = Boolean(savedPreferences.current && JSON.stringify({ reminders, appearance, desktop }) !== JSON.stringify(savedPreferences.current));
  const dirty = availabilityDirty || aiDirty || preferencesDirty;
  const settingsCategories = [["ai", "AI 连接"], ["work", "工作时间"], ["reminder", "提醒"], ["appearance", "外观"], ["desktop", "Windows 集成"], ["privacy", "数据与隐私"]] as const;

  useEffect(() => {
    setDraft(availability);
    setSaveMessage("");
  }, [availability]);

  useEffect(() => {
    let active = true;
    void getAiConnectionSettings().then((settings) => {
      if (!active) return;
      setAiSettings(settings);
      setAiForm({ api_type: settings.api_type, endpoint: settings.endpoint, model: settings.model });
    }).catch((reason) => { if (active) setAiMessage(String(reason)); });
    return () => { active = false; };
  }, []);

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
    }).catch((reason) => { if (active) setPreferenceMessage(String(reason)); });
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
    if (aiSettings) setAiForm({ api_type: aiSettings.api_type, endpoint: aiSettings.endpoint, model: aiSettings.model });
    setAiKey("");
    setAiMessage("");
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
    setSaveMessage("正在写入本机 SQLite…");
    try {
      const saved = await saveAvailabilitySettings(draft);
      setDraft(saved);
      setSaveMessage("日计划偏好已保存。");
      onSaved(saved);
      onNotify("日计划偏好已保存", "工作日和工作时间已写入本机；它们只影响安排偏好与时间线参照。", "check");
    } catch (reason) {
      const message = planDraftErrorMessage(reason, null, shanghaiDateValue());
      setSaveMessage(message);
      onNotify("日计划偏好未保存", message, "review");
    } finally {
      setSaving(false);
    }
  }

  async function submitAiConnection(event: FormEvent) {
    event.preventDefault();
    if (aiBusy) return;
    setAiBusy(true);
    setAiMessage("正在保存到本机 SQLite…");
    try {
      const saved = await saveAiConnectionSettings({ ...aiForm, api_key: aiKey.trim() || null });
      setAiSettings(saved);
      setAiForm({ api_type: saved.api_type, endpoint: saved.endpoint, model: saved.model });
      setAiKey("");
      setAiMessage("AI 连接设置已保存。可先测试连接，不会读取任务。");
      onNotify("AI 连接已保存", "模型类型、地址和凭据已写入本机。", "check");
    } catch (reason) {
      setAiMessage(String(reason));
      onNotify("AI 连接未保存", String(reason), "review");
    } finally { setAiBusy(false); }
  }

  async function testConnection() {
    if (aiBusy) return;
    if (aiDirty) {
      setAiMessage("请先保存当前连接设置，再测试连接。");
      return;
    }
    setAiBusy(true);
    setAiMessage("正在发送最小连接测试；不会读取任务或其他对话…");
    try {
      const result = await testAiConnection();
      setAiMessage(`连接成功：${result}`);
      onNotify("AI 连接可用", "最小连接测试已通过。", "check");
    } catch (reason) {
      setAiMessage(String(reason));
      onNotify("AI 连接测试失败", String(reason), "review");
    } finally { setAiBusy(false); }
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
      onNotify("设置已保存", "提醒、主题与 Windows 集成已经更新。", "check");
    } catch (reason) {
      setPreferenceMessage(String(reason));
      onNotify("设置未保存", String(reason), "review");
    } finally { setPreferenceBusy(false); }
  }

  function previewAppearance(next: typeof appearance) {
    setAppearance(next);
    document.documentElement.dataset.theme = next.theme;
    document.documentElement.dataset.mode = next.mode;
    document.documentElement.style.setProperty("--app-font-size", `${next.fontSize}px`);
  }

  return <section className={`next-page settings-page${dirty || saving ? " has-floating-actions" : ""}`}>
    <header className="page-commandbar"><div><h1>设置</h1><p>把会影响安排偏好、提醒和阅读的规则集中在这里。</p></div><span className="local-only"><Icon name="check" size={14} />本机数据</span></header>
    <div className="settings-layout"><nav aria-label="设置分类">{settingsCategories.map(([category, label]) => <button key={category} type="button" className={activeCategory === category ? "active" : ""} aria-current={activeCategory === category ? "location" : undefined} onClick={() => requestCategory(category)}>{label}</button>)}</nav><div className="settings-sections">
      <section id="ai"><header><div><h2>AI 连接</h2><p>模型只接收当前对话所需的最小内容。</p></div><span className={`setting-state${aiSettings?.api_key_configured ? " connected" : ""}`}>{aiSettings?.api_key_configured ? "已配置" : "未配置"}</span></header><form className="ai-connection-form" onSubmit={(event) => void submitAiConnection(event)}>
        <label>API 类型<select value={aiForm.api_type} disabled={aiBusy} onChange={(event) => { setAiForm({ ...aiForm, api_type: event.target.value as "chat_completions" | "responses" }); setAiMessage(""); }}><option value="chat_completions">Chat Completions 兼容</option><option value="responses">Responses API 兼容</option></select></label>
        <label>连接地址<input value={aiForm.endpoint} disabled={aiBusy} placeholder="https://api.openai.com/v1" onChange={(event) => { setAiForm({ ...aiForm, endpoint: event.target.value }); setAiMessage(""); }} /></label>
        <label>模型<input value={aiForm.model} disabled={aiBusy} placeholder="gpt-5-mini" onChange={(event) => { setAiForm({ ...aiForm, model: event.target.value }); setAiMessage(""); }} /></label>
        <label>API Key<input type="password" autoComplete="off" value={aiKey} disabled={aiBusy} placeholder={aiSettings?.api_key_configured ? "已保存；留空表示不更换" : "请输入 API Key"} onChange={(event) => { setAiKey(event.target.value); setAiMessage(""); }} /></label>
        <div className="ai-connection-actions"><span role="status">{aiMessage || "测试连接只发送一条最小测试消息，不读取任何任务。"}</span><div><button type="button" className="quiet-button" disabled={aiBusy || !aiSettings?.api_key_configured || aiDirty} onClick={() => void testConnection()}>测试连接</button><button type="submit" disabled={aiBusy || !aiDirty}>{aiBusy ? "处理中…" : "保存连接"}</button></div></div>
      </form><p className="risk-note">API Key 以明文保存在本机 SQLite；诊断、日志和导出不会显示 Key。数据库文件本身仍需妥善保管。</p></section>
      <section id="work" className="availability-settings-section"><header><div><h2>工作时间偏好</h2><p>用于自动安排的优先起点和时间线参照，不限制手动安排。</p></div><span className={`setting-state${availability ? " connected" : ""}`}>{availabilityState}</span></header>
        {availabilityError && !draft ? <div className="setting-load-error"><strong>日计划偏好没有读出来</strong><span>{availabilityError}</span><button type="button" className="quiet-button" onClick={onReload}>重新读取</button></div> : draft ? <form className="setting-availability-form" onSubmit={(event) => void submitAvailability(event)}>
          <fieldset className="setting-weekdays"><legend>工作日</legend><div>{["一", "二", "三", "四", "五", "六", "日"].map((label, index) => <button key={label} type="button" aria-pressed={draft.weekdays.includes(index + 1)} disabled={saving} onClick={() => toggleWorkday(index + 1)}>周{label}</button>)}</div><small>未选中的日期会使用更浅的网格背景；仍可安排事项。</small></fieldset>
          <div className="setting-time-group"><div className="setting-time-heading"><div><h3>每日工作时间</h3><p>自动安排会优先从这段时间开始；其他时段同样可以安排。</p></div><strong>{draft.workday_start} – {draft.workday_end}</strong></div><TimeRangeRail start={draft.workday_start} end={draft.workday_end} startLabel="开始工作" endLabel="结束工作" disabled={saving} onChange={updateWorkdayRange} /></div>
          {(availabilityDirty || saving) && <footer className="setting-save-bar" aria-label="未保存的更改"><strong role="status" className={saveMessage && !saveMessage.includes("已保存") && !saveMessage.includes("正在") ? "error" : ""}>{saving ? "正在保存到本机…" : draft.weekdays.length === 0 ? "至少选择一个工作日后才能保存。" : saveMessage || "有未保存的更改"}</strong><div className="draft-bar-actions"><button type="button" className="draft-reset" disabled={saving} onClick={() => { setDraft(availability); setSaveMessage(""); }}>撤销</button><button type="submit" className="draft-save" disabled={saving || draft.weekdays.length === 0}>{saving ? "保存中…" : "保存更改"}</button></div></footer>}
        </form> : <div className="setting-loading"><span className="loader dark" />正在读取本机日计划偏好…</div>}
      </section>
      <section id="reminder"><header><div><h2>提醒</h2><p>提醒只唤起你，不会自动调用模型。</p></div><button type="button" className="quiet-button" onClick={() => void sendTestNotification().then(() => setPreferenceMessage("测试通知已发送。")).catch((reason) => setPreferenceMessage(String(reason)))}>发送测试通知</button></header><div className="setting-row"><div><strong>晨间计划</strong><span>每日首次达到设定时间后提醒一次</span></div><div className="setting-inline-controls"><input type="time" value={reminders.morningTime} disabled={!reminders.morning} onChange={(event) => setReminders({ ...reminders, morningTime: event.target.value })} /><button type="button" role="switch" aria-checked={reminders.morning} className={`switch-control${reminders.morning ? " enabled" : ""}`} onClick={() => setReminders({ ...reminders, morning: !reminders.morning })}><span /></button></div></div><div className="setting-row"><div><strong>晚间复盘</strong><span>每日首次达到设定时间后提醒一次</span></div><div className="setting-inline-controls"><input type="time" value={reminders.eveningTime} disabled={!reminders.evening} onChange={(event) => setReminders({ ...reminders, eveningTime: event.target.value })} /><button type="button" role="switch" aria-checked={reminders.evening} className={`switch-control${reminders.evening ? " enabled" : ""}`} onClick={() => setReminders({ ...reminders, evening: !reminders.evening })}><span /></button></div></div><label className="setting-buffer">任务块开始前提醒<span><input type="number" min={0} max={60} step={5} value={reminders.taskLead} onChange={(event) => setReminders({ ...reminders, taskLead: Number(event.target.value) })} />分钟</span></label></section>
      <section id="appearance"><header><div><h2>外观</h2><p>主题会即时预览，保存后随应用启动恢复。</p></div><span className="setting-state connected">可配置</span></header><div className="theme-options">{[["default", "默认"], ["github", "GitHub"], ["codex", "Codex"]].map(([value, label]) => <button key={value} type="button" aria-pressed={appearance.theme === value} onClick={() => previewAppearance({ ...appearance, theme: value })}><span className={`theme-swatch ${value}`} />{label}</button>)}</div><div className="setting-row"><div><strong>明暗模式</strong><span>暗色模式保持低饱和、账本式层级</span></div><select value={appearance.mode} onChange={(event) => previewAppearance({ ...appearance, mode: event.target.value })}><option value="light">浅色</option><option value="dark">深色</option></select></div><label className="setting-buffer">界面字号<span><input type="range" min={13} max={18} value={appearance.fontSize} onChange={(event) => previewAppearance({ ...appearance, fontSize: Number(event.target.value) })} />{appearance.fontSize}px</span></label></section>
      <section id="desktop"><header><div><h2>Windows 集成</h2><p>快捷唤起、开机启动和关闭到托盘。</p></div><span className="setting-state connected">已接入</span></header><div className="setting-row"><div><strong>开机启动</strong><span>登录 Windows 后自动启动今序</span></div><button type="button" role="switch" aria-checked={desktop.autostart} className={`switch-control${desktop.autostart ? " enabled" : ""}`} onClick={() => setDesktop({ ...desktop, autostart: !desktop.autostart })}><span /></button></div><div className="setting-row"><div><strong>关闭到托盘</strong><span>窗口关闭后仍在后台提供提醒</span></div><button type="button" role="switch" aria-checked={desktop.closeToTray} className={`switch-control${desktop.closeToTray ? " enabled" : ""}`} onClick={() => setDesktop({ ...desktop, closeToTray: !desktop.closeToTray })}><span /></button></div><label className="setting-buffer">全局快捷键<span><input value={desktop.shortcut} maxLength={80} onChange={(event) => setDesktop({ ...desktop, shortcut: event.target.value })} /></span><small>例如 Ctrl+Alt+Space；若已被其他应用占用，保存时会提示。</small></label></section>
      <section id="privacy"><header><div><h2>数据与隐私</h2><p>任务、草稿、计划和历史均保存在本机。</p></div><span className="setting-state connected">SQLite</span></header><div className="setting-row"><div><strong>本地数据库</strong><span>由 Rust 统一访问；当前版本不加密</span></div></div><div className="setting-row"><div><strong>回收站</strong><span>软删除的普通任务与重复事项默认保留 30 天，启动时自动清理过期项</span></div></div></section>
      <footer className="settings-preference-footer"><span role="status">{preferenceMessage || (preferencesDirty ? "提醒、外观或 Windows 集成有未保存的更改。" : "提醒、外观和 Windows 集成已与本机设置一致。")}</span><button type="button" disabled={preferenceBusy || !preferencesDirty} onClick={() => void savePreferences()}>{preferenceBusy ? "保存中…" : "保存提醒与外观"}</button></footer>
    </div></div>
    {pendingCategory && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) resolveCategoryNavigation(false); }}><section className="unsaved-dialog leave-dialog" role="alertdialog" aria-modal="true" aria-labelledby="settings-category-dialog-title" aria-describedby="settings-category-dialog-description" onKeyDown={(event) => { if (event.key === "Escape") resolveCategoryNavigation(false); }}><header><h2 id="settings-category-dialog-title">放弃未保存修改？</h2><button type="button" aria-label="继续编辑" onClick={() => resolveCategoryNavigation(false)}><Icon name="close" size={16} /></button></header><p id="settings-category-dialog-description">设置中还有未保存内容。放弃后，日计划、提醒、外观和 Windows 偏好会恢复为本机当前值。</p><div className="dialog-actions"><button type="button" autoFocus onClick={() => resolveCategoryNavigation(false)}>继续编辑</button><button type="button" className="dialog-discard" onClick={() => resolveCategoryNavigation(true)}>放弃修改</button></div></section></div>}
  </section>;
}

function FloatingAssistant({ open, onToggle, onNavigate, onDataChanged }: { open: boolean; onToggle: () => void; onNavigate: (page: string) => void; onDataChanged: () => Promise<void> }) {
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string | null>(null);
  const [pendingConversationDelete, setPendingConversationDelete] = useState(false);
  const [proposals, setProposals] = useState<ProposalPreview[]>([]);
  const [pendingDestructiveProposal, setPendingDestructiveProposal] = useState<ProposalPreview | null>(null);
  const currentConversation = conversations.find((item) => item.id === conversationId) ?? null;

  async function refreshConversations(preferredId?: string | null, archived = showArchived, query = search) {
    const items = await listAiConversations(archived, query);
    setConversations(items);
    const nextId = preferredId && items.some((item) => item.id === preferredId)
      ? preferredId
      : conversationId && items.some((item) => item.id === conversationId)
        ? conversationId
        : items.find((item) => item.status === "active")?.id ?? items[0]?.id ?? null;
    setConversationId(nextId);
    if (nextId) setMessages(await listAiMessages(nextId));
    else setMessages([]);
    return nextId;
  }

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    Promise.all([getAiConnectionSettings(), getUiSetting("ui.ai.current_conversation")])
      .then(async ([settings, savedConversation]) => {
        if (!active) return;
        setConfigured(settings.api_key_configured);
        const items = await listAiConversations(false);
        if (!active) return;
        let nextId = savedConversation && items.some((item) => item.id === savedConversation) ? savedConversation : items[0]?.id ?? null;
        if (!nextId) {
          const created = await createAiConversation();
          if (!active) return;
          nextId = created.id;
          setConversations([created]);
        } else setConversations(items);
        setConversationId(nextId);
        const [nextMessages, nextProposals] = await Promise.all([listAiMessages(nextId), listAiConversationProposals(nextId)]);
        setMessages(nextMessages);
        setProposals(nextProposals);
      })
      .catch((reason) => { if (active) setNotice(String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open || !selectorOpen) return;
    const timer = window.setTimeout(() => {
      void refreshConversations(conversationId, showArchived, search).catch((reason) => setNotice(String(reason)));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [search, showArchived]);

  async function selectConversation(id: string) {
    setConversationId(id);
    setSelectorOpen(false);
    setNotice("");
    await setUiSetting("ui.ai.current_conversation", id).catch(() => undefined);
    const [nextMessages, nextProposals] = await Promise.all([listAiMessages(id), listAiConversationProposals(id)]);
    setMessages(nextMessages);
    setProposals(nextProposals);
  }

  async function newConversation() {
    try {
      const created = await createAiConversation();
      setSearch("");
      setShowArchived(false);
      await refreshConversations(created.id, false, "");
      await selectConversation(created.id);
    } catch (reason) { setNotice(String(reason)); }
  }

  async function renameCurrent() {
    if (!currentConversation || renameValue === null) return;
    try {
      await renameAiConversation(currentConversation.id, renameValue);
      setRenameValue(null);
      await refreshConversations(currentConversation.id);
    } catch (reason) { setNotice(String(reason)); }
  }

  async function toggleCurrentArchive() {
    if (!currentConversation || runId) return;
    try {
      const archived = currentConversation.status !== "archived";
      await setAiConversationArchived(currentConversation.id, archived);
      setNotice(archived ? "对话已归档；关联草稿仍然保留。" : "对话已恢复。 ");
      await refreshConversations(null);
    } catch (reason) { setNotice(String(reason)); }
  }

  async function deleteCurrentConversation() {
    if (!currentConversation || runId) return;
    try {
      await permanentlyDeleteAiConversation(currentConversation.id, true);
      setPendingConversationDelete(false);
      setNotice("对话已永久删除。");
      await refreshConversations(null);
    } catch (reason) { setNotice(String(reason)); }
  }

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    const prompt = input.trim();
    if (!prompt || runId) return;
    if (!configured) {
      setNotice("请先在设置中配置 AI 连接；手动任务功能不受影响。");
      return;
    }
    try {
      let activeId = conversationId;
      if (!activeId) activeId = (await createAiConversation()).id;
      setInput("");
      setNotice("");
      const run = await startAiAssistant(activeId, prompt);
      setRunId(run.id);
      setConversationId(activeId);
      setMessages(await listAiMessages(activeId));
      try {
        const result = await completeAiAssistant(run.id);
        setMessages(await listAiMessages(activeId));
        setProposals(await listAiConversationProposals(activeId));
        await refreshConversations(activeId);
        setNotice(result.drafts.length ? `已生成 ${result.drafts.length} 条待确认草稿；确认前不会成为正式任务。` : result.proposal ? "已生成一项待确认操作；确认前不会修改本机事实。" : "这次回复没有生成草稿，你可以继续补充信息。");
      } catch (reason) {
        setMessages(await listAiMessages(activeId));
        setNotice(String(reason));
      } finally { setRunId(null); }
    } catch (reason) { setRunId(null); setNotice(String(reason)); }
  }

  async function stopAnalysis() {
    if (!runId) return;
    const stoppingId = runId;
    setRunId(null);
    try {
      await stopAiRun(stoppingId);
      setNotice("分析已停止；迟到结果不会生成或覆盖草稿。");
    } catch (reason) { setNotice(String(reason)); }
  }

  function proposalLabel(preview: ProposalPreview) {
    const operation = preview.proposal.operation;
    if (operation.type === "proposed_task_complete") return "完成任务";
    if (operation.type === "proposed_task_soft_delete") return `移入回收站 · ${"task_ids" in operation ? operation.task_ids.length : 0} 项`;
    if (operation.type === "proposed_plan") return `安排日计划 · ${"plan_date" in operation ? operation.plan_date : ""}`;
    return "确认操作";
  }

  async function confirmProposal(preview: ProposalPreview, destructive = false) {
    if (runId) return;
    if (preview.proposal.operation.type === "proposed_task_soft_delete" && !destructive) {
      setPendingDestructiveProposal(preview);
      return;
    }
    try {
      await applyConfirmedAiProposal(preview, destructive);
      setPendingDestructiveProposal(null);
      if (conversationId) setProposals(await listAiConversationProposals(conversationId));
      await onDataChanged();
      setNotice(preview.proposal.operation.type === "proposed_plan" ? "日计划已确认写入 SQLite。" : preview.proposal.operation.type === "proposed_task_soft_delete" ? "所选任务已移入回收站。" : "任务已确认完成。");
    } catch (reason) { setNotice(`操作未写入：${String(reason)}`); }
  }

  const visibleConversations = conversations;
  const conversationGroups = visibleConversations.reduce<{ label: string; items: AiConversation[] }[]>((groups, conversation) => {
    const label = shanghaiDateValue(new Date(conversation.updated_at)) === shanghaiDateValue() ? "今天" : "更早";
    const existing = groups.find((group) => group.label === label);
    if (existing) existing.items.push(conversation);
    else groups.push({ label, items: [conversation] });
    return groups;
  }, []);
  return <div className={`floating-assistant${open ? " open" : ""}`}>
    {open && <section className="assistant-popover" aria-label="今序 AI 助手">
      <header><div><span className="assistant-avatar"><Icon name="sparkle" size={18} /></span><div className="assistant-title-control"><button type="button" className="assistant-title-button" aria-expanded={selectorOpen} onClick={() => setSelectorOpen((value) => !value)}><strong>{currentConversation?.title || "新对话"}</strong><span>{runId ? "正在分析" : "应用内助手 · 本地留存"}</span></button></div></div><button type="button" aria-label="收起 AI 助手" onClick={onToggle}><Icon name="close" size={17} /></button></header>
      {selectorOpen && <div className="assistant-conversation-picker"><div className="assistant-picker-search"><Icon name="search" size={14} /><input autoFocus value={search} placeholder="搜索本地对话" onChange={(event) => setSearch(event.target.value)} /></div><div className="assistant-picker-toolbar"><button type="button" onClick={() => void newConversation()}><Icon name="plus" size={13} />新建</button><button type="button" aria-pressed={showArchived} onClick={() => setShowArchived((value) => !value)}>{showArchived ? "隐藏归档" : "查看归档"}</button></div><div className="assistant-picker-list">{conversationGroups.length ? conversationGroups.map((group) => <section className="assistant-conversation-group" key={group.label} aria-label={group.label}><strong>{group.label}</strong>{group.items.map((conversation) => <div key={conversation.id} className={conversation.id === conversationId ? "active" : ""}><button type="button" onClick={() => void selectConversation(conversation.id)}><span>{conversation.title}</span><small>{conversation.status === "archived" ? "已归档" : `${conversation.message_count} 条消息`}{conversation.draft_count ? ` · ${conversation.draft_count} 条草稿` : ""}</small></button>{conversation.id === conversationId && <Icon name="check" size={14} />}</div>)}</section>) : <p>没有匹配的本地对话。</p>}</div></div>}
      {currentConversation && <div className="assistant-conversation-actions">{renameValue === null ? <><button type="button" onClick={() => setRenameValue(currentConversation.title)}>重命名</button><button type="button" disabled={Boolean(runId)} onClick={() => void toggleCurrentArchive()}>{currentConversation.status === "archived" ? "恢复" : "归档"}</button>{currentConversation.status === "archived" && <button type="button" className="assistant-delete-conversation" disabled={Boolean(runId)} onClick={() => setPendingConversationDelete(true)}>永久删除</button>}{currentConversation.draft_count > 0 && <button type="button" className="assistant-view-drafts" onClick={() => onNavigate("草稿")}>查看草稿 · {currentConversation.draft_count}</button>}</> : <><input value={renameValue} maxLength={80} aria-label="新对话名称" onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameCurrent(); if (event.key === "Escape") setRenameValue(null); }} /><button type="button" onClick={() => void renameCurrent()}>保存名称</button><button type="button" onClick={() => setRenameValue(null)}>取消</button></>}</div>}
      <div className="assistant-conversation" aria-live="polite">{loading ? <div className="assistant-processing"><span className="processing-dot" />正在读取本地对话…</div> : messages.length ? <div className="assistant-message-list">{messages.map((message) => <article key={message.id} className={`assistant-message ${message.role}`}><span>{message.role === "user" ? "你" : "今序"}</span><p>{message.content}</p></article>)}{proposals.map((proposal) => <article className="assistant-proposal" key={proposal.ai_run_id}><span>待确认操作</span><strong>{proposalLabel(proposal)}</strong><small>确认前不会修改 SQLite；提交时会重新校验当前状态。</small><button type="button" disabled={Boolean(runId)} onClick={() => void confirmProposal(proposal)}>确认操作</button></article>)}{runId && <div className="assistant-processing"><span className="processing-dot" />正在整理结构化草稿…</div>}</div> : <div className="assistant-welcome"><strong>想从哪里开始？</strong><p>我会通过当前对话整理草稿。所有关键改动仍要由你逐条确认。</p><div className="assistant-shortcuts"><button type="button" onClick={() => setInput("帮我整理一项新任务：")}><Icon name="plus" size={15} />创建任务</button><button type="button" onClick={() => setInput("帮我梳理接下来要调整的任务：")}><Icon name="tasks" size={15} />调整任务</button><button type="button" onClick={() => setInput("请为今天安排日计划：")}><Icon name="calendar" size={15} />安排计划</button></div></div>}{notice && <p className="assistant-notice" role="status">{notice}{!configured && <button type="button" onClick={() => onNavigate("设置")}>前往设置</button>}</p>}</div>
      <form onSubmit={(event) => void submitMessage(event)}><textarea value={input} maxLength={8000} disabled={Boolean(runId) || currentConversation?.status === "archived"} onChange={(event) => setInput(event.target.value)} placeholder={currentConversation?.status === "archived" ? "恢复对话后才能继续" : "说说你想完成什么…"} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><div><span>{runId ? "停止后迟到结果会作废" : "确认前不会成为正式任务"}</span>{runId ? <button type="button" className="assistant-stop" aria-label="停止分析" title="停止分析" onClick={() => void stopAnalysis()}><Icon name="close" size={15} /></button> : <button type="submit" aria-label="发送消息" disabled={!input.trim() || currentConversation?.status === "archived"}><Icon name="send" size={16} /></button>}</div></form>
    </section>}
    {open && pendingConversationDelete && currentConversation && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingConversationDelete(false); }}><section className="unsaved-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-conversation-title"><h2 id="delete-conversation-title">永久删除对话？</h2><p>“{currentConversation.title}”的本地消息历史将无法恢复；有关联草稿时系统会拒绝删除。</p><div className="dialog-actions"><button type="button" autoFocus onClick={() => setPendingConversationDelete(false)}>取消</button><button type="button" className="dialog-discard" onClick={() => void deleteCurrentConversation()}>永久删除</button></div></section></div>}
    {open && pendingDestructiveProposal && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingDestructiveProposal(null); }}><section className="unsaved-dialog task-trash-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ai-delete-title"><div className="dialog-icon trash"><Icon name="trash" size={19} /></div><h2 id="ai-delete-title">确认移入回收站？</h2><p>AI 提议删除 {pendingDestructiveProposal.proposal.operation.type === "proposed_task_soft_delete" && "task_ids" in pendingDestructiveProposal.proposal.operation ? pendingDestructiveProposal.proposal.operation.task_ids.length : 0} 项任务。任务会停止后续安排，但仍可从回收站恢复。</p><div className="dialog-actions"><button type="button" autoFocus onClick={() => setPendingDestructiveProposal(null)}>取消</button><button type="button" className="dialog-discard" onClick={() => void confirmProposal(pendingDestructiveProposal, true)}>确认移入回收站</button></div></section></div>}
    <button type="button" className="assistant-orb" aria-expanded={open} aria-label={open ? "收起今序 AI 助手" : "打开今序 AI 助手"} title={open ? "收起今序 AI" : "打开今序 AI"} onClick={onToggle}><span aria-hidden="true">今</span></button>
  </div>;
}

export default function App() {
  const [today, setToday] = useState(() => shanghaiDateValue());
  const [selectedDate, setSelectedDate] = useState(() => shanghaiDateValue());
  const [active, setActive] = useState("今日");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
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
  const [planRegenerationOpen, setPlanRegenerationOpen] = useState(false);
  const [planToast, setPlanToast] = useState<{ id: number; label: string; message: string; icon?: IconName; undoId?: string } | null>(null);
  const [availability, setAvailability] = useState<AvailabilitySettings | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [requestedTaskView, setRequestedTaskView] = useState<TaskViewRequest | null>(null);
  const shellRef = useRef<HTMLElement>(null);
  const shellResizeSession = useRef<ShellResizeSession | null>(null);
  const shellResizeFrame = useRef<number | null>(null);
  const sidebarCollapseTimer = useRef<number | null>(null);
  const sidebarWidthRef = useRef(SHELL_SIDEBAR_DEFAULT_WIDTH);
  const [sidebarWidth, setSidebarWidth] = useState(SHELL_SIDEBAR_DEFAULT_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarAnimating, setSidebarAnimating] = useState(false);
  const [resizingShell, setResizingShell] = useState(false);
  const activeTasks = tasks.filter((task) => ["inbox", "open", "scheduled"].includes(task.status));
  const plannedTaskCount = daySchedule?.task_blocks.length ?? 0;
  const completedPlannedTaskCount = daySchedule?.task_blocks.filter((block) => block.execution_status === "completed").length ?? 0;
  const plannedMinutes = daySchedule?.task_blocks.reduce((total, block) => total + Math.round((new Date(block.ends_at).getTime() - new Date(block.starts_at).getTime()) / 60000), 0) ?? 0;
  const planProgress = plannedTaskCount ? Math.round(completedPlannedTaskCount / plannedTaskCount * 100) : 0;

  async function refreshTasks(showLoading = true) {
    if (showLoading) setTasksLoading(true);
    setTasksError(null);
    try {
      const [nextTasks, nextRecurringItems] = await Promise.all([listTasks(true), listRecurringItems(true, true)]);
      setTasks(nextTasks);
      setRecurringItems(nextRecurringItems);
    }
    catch (reason) { setTasksError(String(reason)); }
    finally { if (showLoading) setTasksLoading(false); }
  }

  async function refreshSchedule(date = selectedDate, showLoading = true) {
    if (showLoading) setScheduleLoading(true);
    setScheduleError(null);
    try {
      const [schedule, draft, occurrences] = await Promise.all([
        getDaySchedule(date), getRulePlanDraft(date), listRecurringOccurrences(date)
      ]);
      setDaySchedule(schedule);
      setPlanPreview(draft);
      setRecurringOccurrences(occurrences);
    }
    catch (reason) { setDaySchedule(null); setRecurringOccurrences([]); setScheduleError(String(reason)); }
    finally { if (showLoading) setScheduleLoading(false); }
  }

  async function refreshAvailability() {
    try {
      const settings = await getAvailabilitySettings();
      setAvailability(settings);
      setAvailabilityError(null);
    } catch (reason) {
      setAvailability(null);
      setAvailabilityError(String(reason));
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
    setPlanPreview(null);
    setPlanRegenerationOpen(false);
    setPlanToast(null);
    setMessage("");
    void refreshSchedule(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    if (!planToast) return;
    const timer = window.setTimeout(() => setPlanToast(null), planToast.undoId ? 10_000 : planToast.icon === "review" ? 5200 : 2800);
    return () => window.clearTimeout(timer);
  }, [planToast]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentDate = shanghaiDateValue();
      setToday((previous) => previous === currentDate ? previous : currentDate);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    void getUiSetting(SHELL_SIDEBAR_WIDTH_SETTING).then((value) => {
      const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
      if (active && Number.isFinite(parsed)) setConstrainedSidebarWidth(parsed);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void getUiSetting(SHELL_SIDEBAR_COLLAPSED_SETTING).then((value) => {
      if (active && value !== null) setSidebarCollapsed(value === "true");
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || sidebarCollapsed || typeof ResizeObserver === "undefined") return;
    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (window.innerWidth <= 860) return;
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        setConstrainedSidebarWidth(sidebarWidthRef.current);
      });
    });
    observer.observe(shell);
    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [sidebarCollapsed]);

  useEffect(() => () => {
    if (shellResizeFrame.current !== null) window.cancelAnimationFrame(shellResizeFrame.current);
    if (sidebarCollapseTimer.current !== null) window.clearTimeout(sidebarCollapseTimer.current);
  }, []);

  async function generateRulePlan(replaceCurrent = false) {
    if (planBusy) return;
    if (selectedDate < today) {
      setPlanPreview(null);
      setMessage("历史日期不能生成新的计划草案，只能查看已有计划和执行记录。");
      return;
    }
    const regeneratingAdjustment = Boolean(daySchedule?.plan_id && planPreview?.base_plan_id);
    if (daySchedule?.plan_id && !regeneratingAdjustment) {
      setMessage("这一天已有确认计划，不能重复生成计划草案。");
      return;
    }
    if (planPreview && !replaceCurrent) {
      setPlanRegenerationOpen(true);
      return;
    }
    setPlanRegenerationOpen(false);
    setPlanBusy(true);
    setPlanToast(null);
    try {
      const preview = regeneratingAdjustment
        ? await regenerateConfirmedPlanAdjustment(selectedDate)
        : await previewRuleBasedPlan(selectedDate);
      if (preview.blocks.length === 0 && preview.unscheduled.length === 0) {
        await discardRulePlanDraft(preview.preview_id, preview.version);
        setPlanPreview(null);
        setMessage("");
        setPlanToast({ id: Date.now(), label: "未生成计划", message: "暂无待安排任务", icon: "calendar" });
        return;
      }
      setPlanPreview(preview);
      setMessage(preview.blocks.length ? "" : "没有生成可保存时间块，请检查未排入原因、任务截止时间和可用时间。");
    } catch (reason) { setMessage(`计划草案未生成：${String(reason)}`); }
    finally { setPlanBusy(false); }
  }

  async function updatePlanDraft(nextPreview: RulePlanPreview) {
    if (planBusy) return nextPreview;
    setMessage("");
    setPlanBusy(true);
    try {
      const saved = await updateRulePlanDraft(nextPreview);
      setPlanPreview(saved);
      setMessage("");
      return saved;
    } catch (reason) {
      throw reason;
    } finally {
      setPlanBusy(false);
    }
  }

  async function startPlanAdjustment() {
    if (planBusy || !daySchedule?.plan_id) return null;
    setPlanBusy(true);
    setPlanToast(null);
    setMessage("");
    try {
      const preview = await startConfirmedPlanAdjustment(selectedDate);
      setPlanPreview(preview);
      setMessage("");
      return preview;
    } catch (reason) {
      setPlanToast({
        id: Date.now(),
        label: "暂时不能调整计划",
        message: String(reason),
        icon: "review"
      });
      return null;
    } finally {
      setPlanBusy(false);
    }
  }

  async function discardPlanDraft() {
    if (!planPreview || planBusy) return false;
    const wasAdjustment = Boolean(planPreview.base_plan_id);
    setPlanBusy(true);
    try {
      await discardRulePlanDraft(planPreview.preview_id, planPreview.version);
      setPlanPreview(null);
      setMessage("");
      setPlanToast({
        id: Date.now(),
        label: wasAdjustment ? "调整草案已放弃" : "计划草案已放弃",
        message: wasAdjustment ? "已确认计划保持不变" : "正式日历没有发生变化",
        icon: "check"
      });
      return true;
    } catch (reason) {
      setMessage(`草案未能放弃：${String(reason)}`);
      return false;
    } finally {
      setPlanBusy(false);
    }
  }

  async function confirmRulePlan() {
    if (!planPreview || planBusy) return;
    if (planPreview.plan_date < today) {
      setPlanPreview(null);
      setMessage("该计划草案对应的日期已经过去，未写入 SQLite。");
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
        message: "已写入 SQLite；10 秒内可安全撤销",
        icon: "check",
        undoId: undo?.target_type === "daily_plan" ? undo.id : undefined
      });
    } catch (reason) { setMessage(`计划未写入：${String(reason)}`); }
    finally { setPlanBusy(false); }
  }

  async function undoConfirmedPlan(undoId: string) {
    if (planBusy) return;
    setPlanBusy(true);
    try {
      await applyUndo(undoId);
      setPlanToast(null);
      await Promise.all([refreshTasks(false), refreshSchedule(selectedDate, false)]);
      setMessage("已通过新的 SQLite 事务撤销计划确认。");
    } catch (reason) {
      setPlanToast(null);
      setMessage(`无法撤销计划：${String(reason)}`);
    } finally { setPlanBusy(false); }
  }

  function applyNavigation(intent: NavigationIntent) {
    setRequestedTaskView(intent.taskView || intent.createTask || intent.taskId
      ? { view: intent.taskView, createTask: intent.createTask, taskId: intent.taskId }
      : null);
    setActive(intent.active);
    if (intent.createTask) setAssistantOpen(false);
    setMobileNavOpen(false);
  }

  function requestNavigation(intent: NavigationIntent) {
    if (active === "今日" && planPreview && intent.active !== "今日") {
      setPendingPlanLeave({ kind: "navigation", intent });
      return;
    }
    if (active === "任务" && taskEditorDirty && (intent.active !== "任务" || Boolean(intent.taskView) || Boolean(intent.createTask) || Boolean(intent.taskId))) {
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
    void refreshSchedule(selectedDate, false);
  }

  function setConstrainedSidebarWidth(requestedWidth: number) {
    const shellWidth = shellRef.current?.clientWidth ?? window.innerWidth;
    const responsiveMaximum = Math.max(SHELL_SIDEBAR_MIN_WIDTH, shellWidth - 620);
    const width = Math.round(Math.min(Math.max(requestedWidth, SHELL_SIDEBAR_MIN_WIDTH), SHELL_SIDEBAR_MAX_WIDTH, responsiveMaximum));
    sidebarWidthRef.current = width;
    setSidebarWidth((current) => current === width ? current : width);
    return width;
  }

  function persistSidebarWidth(width: number) {
    void setUiSetting(SHELL_SIDEBAR_WIDTH_SETTING, String(width))
      .catch((reason) => setMessage(`导航宽度未保存：${String(reason)}`));
  }

  function startShellResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (sidebarCollapsed) return;
    event.preventDefault();
    const startWidth = sidebarWidthRef.current;
    shellResizeSession.current = { pointerId: event.pointerId, startX: event.clientX, startWidth, latestWidth: startWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizingShell(true);
  }

  function moveShellResize(event: ReactPointerEvent<HTMLDivElement>) {
    const session = shellResizeSession.current;
    if (!session) return;
    session.latestWidth = session.startWidth + event.clientX - session.startX;
    if (shellResizeFrame.current !== null) return;
    shellResizeFrame.current = window.requestAnimationFrame(() => {
      shellResizeFrame.current = null;
      const activeSession = shellResizeSession.current;
      if (activeSession) setConstrainedSidebarWidth(activeSession.latestWidth);
    });
  }

  function endShellResize(event: ReactPointerEvent<HTMLDivElement>) {
    const session = shellResizeSession.current;
    if (!session) return;
    if (event.type === "pointerup") session.latestWidth = session.startWidth + event.clientX - session.startX;
    if (shellResizeFrame.current !== null) {
      window.cancelAnimationFrame(shellResizeFrame.current);
      shellResizeFrame.current = null;
    }
    const width = setConstrainedSidebarWidth(session.latestWidth);
    if (event.currentTarget.hasPointerCapture(session.pointerId)) event.currentTarget.releasePointerCapture(session.pointerId);
    shellResizeSession.current = null;
    setResizingShell(false);
    persistSidebarWidth(width);
  }

  function resizeShellWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (sidebarCollapsed) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 32 : 12;
    const width = setConstrainedSidebarWidth(sidebarWidthRef.current + (event.key === "ArrowRight" ? step : -step));
    persistSidebarWidth(width);
  }

  function resetSidebarWidth() {
    if (sidebarCollapsed) return;
    const width = setConstrainedSidebarWidth(SHELL_SIDEBAR_DEFAULT_WIDTH);
    persistSidebarWidth(width);
  }

  function toggleSidebarCollapsed() {
    const nextCollapsed = !sidebarCollapsed;
    setSidebarCollapsed(nextCollapsed);
    setSidebarAnimating(true);
    if (sidebarCollapseTimer.current !== null) window.clearTimeout(sidebarCollapseTimer.current);
    sidebarCollapseTimer.current = window.setTimeout(() => {
      sidebarCollapseTimer.current = null;
      setSidebarAnimating(false);
    }, 220);
    void setUiSetting(SHELL_SIDEBAR_COLLAPSED_SETTING, String(nextCollapsed))
      .catch((reason) => setMessage(`侧边栏状态未保存：${String(reason)}`));
  }

  const renderedSidebarWidth = sidebarCollapsed ? SHELL_SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;

  return <main ref={shellRef} className={`next-shell${resizingShell ? " is-resizing" : ""}${sidebarCollapsed ? " sidebar-collapsed" : ""}`} style={{ "--sidebar-width": `${renderedSidebarWidth}px` } as CSSProperties}>
    <div className="toast-viewport" aria-live="polite" aria-atomic="true">
      {planToast && <div key={planToast.id} className={`plan-toast${planToast.icon === "check" ? " success" : planToast.icon === "review" ? " error" : ""}`} role={planToast.icon === "review" ? "alert" : "status"}><span className="plan-toast-icon"><Icon name={planToast.icon ?? "calendar"} size={15} /></span><span><strong>{planToast.label}</strong><small>{planToast.message}</small></span>{planToast.undoId && <button type="button" onClick={() => void undoConfirmedPlan(planToast.undoId!)}>撤销</button>}</div>}
    </div>
    {pendingPlanLeave && planPreview && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !planBusy) void resolvePendingPlanLeave(false); }}><section className="unsaved-dialog leave-dialog" role="alertdialog" aria-modal="true" aria-labelledby="plan-leave-dialog-title" aria-describedby="plan-leave-dialog-description" onKeyDown={(event) => { if (event.key === "Escape" && !planBusy) void resolvePendingPlanLeave(false); }}><header><h2 id="plan-leave-dialog-title">日计划草案尚未确认</h2><button type="button" aria-label="继续编辑" disabled={planBusy} onClick={() => void resolvePendingPlanLeave(false)}><Icon name="close" size={16} /></button></header><p id="plan-leave-dialog-description">{planPreview.plan_date} 的草案只保存在本机，尚未写入正式日历。{pendingPlanLeave.kind === "date" ? "切换日期" : "离开今日页"}前需要先丢弃草案，或留在这里继续编辑并确认。</p><div className="dialog-actions"><button type="button" autoFocus disabled={planBusy} onClick={() => void resolvePendingPlanLeave(false)}>继续编辑</button><button type="button" className="dialog-discard" disabled={planBusy} onClick={() => void resolvePendingPlanLeave(true)}>{planBusy ? "正在丢弃…" : pendingPlanLeave.kind === "date" ? "丢弃并切换日期" : "丢弃并离开"}</button></div></section></div>}
    {active === "设置" && settingsEditorDirty && pendingNavigation && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) resolvePendingNavigation(false); }}><section className="unsaved-dialog leave-dialog" role="alertdialog" aria-modal="true" aria-labelledby="settings-leave-dialog-title" aria-describedby="settings-leave-dialog-description" onKeyDown={(event) => { if (event.key === "Escape") resolvePendingNavigation(false); }}><header><h2 id="settings-leave-dialog-title">放弃未保存修改？</h2><button type="button" aria-label="继续编辑" onClick={() => resolvePendingNavigation(false)}><Icon name="close" size={16} /></button></header><p id="settings-leave-dialog-description">设置中还有未保存内容。离开后会恢复为 SQLite 中当前保存的日计划、提醒、外观与 Windows 偏好。</p><div className="dialog-actions"><button type="button" autoFocus onClick={() => resolvePendingNavigation(false)}>继续编辑</button><button type="button" className="dialog-discard" onClick={() => resolvePendingNavigation(true)}>放弃修改</button></div></section></div>}
    {planRegenerationOpen && <div className="dialog-backdrop plan-regeneration-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !planBusy) setPlanRegenerationOpen(false); }}><section className="unsaved-dialog plan-regeneration-dialog" role="alertdialog" aria-modal="true" aria-labelledby="plan-regeneration-title" aria-describedby="plan-regeneration-description" onKeyDown={(event) => { if (event.key === "Escape" && !planBusy) setPlanRegenerationOpen(false); }}><div className="dialog-icon"><Icon name="restore" size={19} /></div><h2 id="plan-regeneration-title">重新生成这份草案？</h2><p id="plan-regeneration-description">{planPreview?.base_plan_id ? "将保留已有执行与复盘记录，按当前任务边界重新安排其余时间块；保存前正式计划不会变化。" : "重新生成会替换你对当前草案时间块的手动调整；正式日历不会发生变化。"}</p><div className="dialog-actions"><button type="button" autoFocus disabled={planBusy} onClick={() => setPlanRegenerationOpen(false)}>保留当前草案</button><button type="button" className="dialog-save" disabled={planBusy} onClick={() => void generateRulePlan(true)}>{planBusy ? "正在生成…" : "替换并重新生成"}</button></div></section></div>}
    <aside id="main-sidebar" className={`next-sidebar${mobileNavOpen ? " mobile-open" : ""}`} aria-label="主导航">
      <div className="next-brand"><div className="brand-mark"><span>今</span></div><div><strong>今序</strong><span>JinXu · 本地优先</span></div></div>
      <button className="next-create" type="button" aria-label={sidebarCollapsed ? "记一件事" : undefined} aria-describedby={sidebarCollapsed ? "sidebar-tip-create" : undefined} onClick={() => requestNavigation({ active: "任务", createTask: true })}><Icon name="plus" size={16} /><span className="next-create-label">记一件事</span><span className="sidebar-tooltip" id="sidebar-tip-create" role="tooltip" aria-hidden="true"><strong>记一件事</strong><small>创建普通任务或重复事项</small></span></button>
      <nav>{navigation.map((item) => <button key={item.label} type="button" className={active === item.label ? "active" : ""} aria-current={active === item.label ? "page" : undefined} aria-label={sidebarCollapsed ? item.label : undefined} aria-describedby={sidebarCollapsed ? `sidebar-tip-${item.icon}` : undefined} onClick={() => requestNavigation({ active: item.label })}><span className="nav-asset-icon" style={{ "--nav-icon": `url("${item.asset}")` } as CSSProperties} aria-hidden="true" /><span className="nav-copy"><strong>{item.label}</strong><small>{item.description}</small></span>{item.label === "任务" && activeTasks.length > 0 && <em>{activeTasks.length}</em>}<span className="sidebar-tooltip" id={`sidebar-tip-${item.icon}`} role="tooltip" aria-hidden="true"><strong>{item.label}</strong><small>{item.description}</small></span></button>)}</nav>
      <footer><div><span>今日计划</span><strong>{plannedTaskCount ? `${completedPlannedTaskCount}/${plannedTaskCount}` : "未生成"}</strong></div><div className="progress-track"><span style={{ width: `${planProgress}%` }} /></div>{plannedTaskCount > 0 && <p>{plannedMinutes} 分钟已安排，完成 {planProgress}%</p>}<span className={`database-state${tasksError ? " unavailable" : ""}`}><i />{tasksLoading ? "SQLite 连接中" : tasksError ? "SQLite 未连接" : "SQLite 已连接"}</span></footer>
    </aside>
    <div className="shell-resize-handle" role="separator" aria-label="调整导航与主功能区宽度；双击恢复默认宽度" aria-orientation="vertical" aria-valuemin={SHELL_SIDEBAR_MIN_WIDTH} aria-valuemax={SHELL_SIDEBAR_MAX_WIDTH} aria-valuenow={sidebarWidth} aria-disabled={sidebarCollapsed || undefined} tabIndex={sidebarCollapsed ? -1 : 0} onDoubleClick={resetSidebarWidth} onPointerDown={startShellResize} onPointerMove={moveShellResize} onPointerUp={endShellResize} onPointerCancel={endShellResize} onKeyDown={resizeShellWithKeyboard} />
    <button className="shell-collapse-button" type="button" aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} aria-controls="main-sidebar" aria-expanded={!sidebarCollapsed} onClick={toggleSidebarCollapsed}><Icon name={sidebarCollapsed ? "chevron-right" : "chevron-left"} size={16} /></button>
    {mobileNavOpen && <button type="button" className="nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}
    <section className="next-workspace">
      <button type="button" className="mobile-nav-button" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((value) => !value)}><Icon name="more" size={18} />菜单</button>
      {active === "今日" && <TodayPage today={today} selectedDate={selectedDate} onSelectDate={requestDateSelection} tasks={tasks} recurringItems={recurringItems} recurringOccurrences={recurringOccurrences} schedule={daySchedule} availability={availability} loading={scheduleLoading} error={scheduleError} preview={planPreview} busy={planBusy} onGeneratePlan={() => void generateRulePlan()} onAdjustPlan={startPlanAdjustment} onUpdatePlan={updatePlanDraft} onConfirmPlan={() => void confirmRulePlan()} onCancelPlan={discardPlanDraft} onOpenTasks={(taskId) => requestNavigation({ active: "任务", taskId })} onFactsChanged={async (date = selectedDate) => { await Promise.all([refreshTasks(false), refreshSchedule(date, false)]); }} onNotify={(label, toastMessage, icon) => setPlanToast({ id: Date.now(), label, message: toastMessage, icon })} message={message} />}
      {active === "任务" && <TaskWorkspace tasks={tasks} recurringItems={recurringItems} loading={tasksLoading} error={tasksError} onReload={refreshTasks} onTaskCommitted={taskCommitted} onRecurringChanged={async () => { await Promise.all([refreshTasks(false), refreshSchedule(selectedDate, false)]); }} today={today} onDirtyChange={setTaskEditorDirty} externalNavigationRequest={pendingNavigation} onExternalNavigationResolved={resolvePendingNavigation} requestedView={requestedTaskView} />}
      {active === "复盘" && <ReviewPage today={today} onFactsChanged={(date) => {
        void refreshTasks(false);
        if (selectedDate === date) void refreshSchedule(date, false);
      }} />}
      {active === "设置" && <SettingsPage availability={availability} availabilityError={availabilityError} onReload={() => void refreshAvailability()} onSaved={(settings) => { setAvailability(settings); setAvailabilityError(null); void refreshSchedule(selectedDate, false); }} onNotify={(label, toastMessage, icon) => setPlanToast({ id: Date.now(), label, message: toastMessage, icon })} onDirtyChange={setSettingsEditorDirty} />}
    </section>
    <FloatingAssistant open={assistantOpen} onToggle={() => setAssistantOpen((value) => !value)} onNavigate={(page) => requestNavigation(page === "草稿" ? { active: "任务", taskView: "draft" } : { active: page })} onDataChanged={async () => { await Promise.all([refreshTasks(false), refreshSchedule(selectedDate, false)]); }} />
  </main>;
}
