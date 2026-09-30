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
  completeTaskFromReview,
  confirmCreationDraft,
  importLegacyRecurringDraft,
  confirmRuleBasedPlan,
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
  setUiSetting
} from "./tauri";
import { calendarDayInfo, lunarDayLabel, officialHolidayCoverageFor, OFFICIAL_HOLIDAY_COVERAGE } from "./calendar-data";
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
  shiftTimeRangeFromStart,
  timeRangePresentationCanReuse,
  timeRangePresentationContains,
  TimeRangeEdge
} from "./time-range-control";
import { recycleRetentionMessage } from "./recycle-retention";
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
import { joinTaskNotes, splitTaskNotes } from "./task-notes";

type IconName =
  | "today" | "tasks" | "calendar" | "review" | "settings"
  | "plus" | "sparkle" | "more" | "check" | "send" | "search"
  | "trash" | "restore" | "close" | "clock" | "filter" | "user" | "info" | "chevron-left" | "chevron-right" | "chevron-down"
  | "pause" | "sliders" | "checkbox" | "file";

const navigation: { label: string; icon: IconName; asset: string; description: string }[] = [
  { label: "今日", icon: "today", asset: navTodayIcon, description: "月历与日计划" },
  { label: "任务", icon: "tasks", asset: navTasksIcon, description: "草稿与任务管理" },
  { label: "复盘", icon: "review", asset: navReviewIcon, description: "记录实际执行" },
  { label: "设置", icon: "settings", asset: navSettingsIcon, description: "工作方式与连接" }
];

const slots = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00"];
type TaskView = "draft" | "recurring" | "open" | "scheduled" | "done" | "deleted";
type CreateItemType = "task" | "recurring";
type LedgerResizeSession = { pointerId: number; startX: number; startWidth: number };
type ShellResizeSession = { pointerId: number; startX: number; startWidth: number; latestWidth: number };
type TimelineReturnContext = { date: string; blockId: string };
type NavigationIntent = { active: string; taskView?: TaskView; createTask?: boolean; taskId?: string; timelineReturnContext?: TimelineReturnContext };
type PlanLeaveIntent = { kind: "navigation"; intent: NavigationIntent } | { kind: "date"; date: string };
type TaskViewRequest = { view?: TaskView; createTask?: boolean; taskId?: string };
type PendingTaskChange =
  | { kind: "select"; taskId: string }
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
const SHELL_SIDEBAR_WIDTH_SETTING = "ui.shell_sidebar_width";
const SHELL_SIDEBAR_COLLAPSED_SETTING = "ui.shell_sidebar_collapsed";
const SHELL_SIDEBAR_MIN_WIDTH = 188;
const SHELL_SIDEBAR_MAX_WIDTH = 320;
const SHELL_SIDEBAR_DEFAULT_WIDTH = 224;
const SHELL_SIDEBAR_COLLAPSED_WIDTH = 52;
const MIN_TASK_BLOCK_MINUTES = 15;
const COMPACT_TASK_BLOCK_THRESHOLD_MINUTES = 30;

const statusCopy: Record<TaskStatus, string> = {
  open: "待处理", scheduled: "已安排", done: "已完成", deleted: "回收站"
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
    pause: <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>,
    sliders: <><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></>
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function PlanRegenerateButton({ confirmed, busy, onClick }: { confirmed: boolean; busy: boolean; onClick: () => void }) {
  const label = confirmed ? "重新安排未执行任务" : "重新生成日计划草案";
  const tooltipId = confirmed ? "confirmed-plan-regenerate-tooltip" : "draft-plan-regenerate-tooltip";
  const description = confirmed
    ? "保留执行和复盘记录，替换当前未保存修改。"
    : "替换当前草案的手动修改，并重新生成安排。";
  return <span className="plan-regenerate-control">
    <button
      type="button"
      className={`plan-regenerate-button${busy ? " is-busy" : ""}`}
      aria-label={busy ? `${label}，正在处理` : label}
      aria-describedby={tooltipId}
      disabled={busy}
      onClick={onClick}
    ><Icon name="restore" size={16} /></button>
    <span id={tooltipId} className="plan-action-tooltip" role="tooltip"><strong>{label}</strong><small>{description}</small></span>
  </span>;
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
  const start = shanghaiDateTimeFields(currentHour + 60 * 60 * 1000);
  const end = shanghaiDateTimeFields(currentHour + 2 * 60 * 60 * 1000);
  return {
    title: "",
    notes: "",
    priority: null,
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

const RECURRING_DRAFT_KEY = "jinxu.recurring_item_draft";

function loadStoredRecurringDraft(): RecurringItemForm | null {
  try {
    const raw = localStorage.getItem(RECURRING_DRAFT_KEY);
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

function taskMatchesView(task: Task, view: TaskView) {
  return view !== "draft" && view !== "recurring" && task.status === view;
}

function taskIsEditable(task: Task | null) {
  return Boolean(task && ["open", "scheduled"].includes(task.status));
}

function viewForStatus(status: TaskStatus): TaskView {
  return status as TaskView;
}

const taskViewCopy: Record<TaskView, string> = {
  draft: "草稿",
  recurring: "重复事项",
  open: "待处理",
  scheduled: "已安排",
  done: "已完成",
  deleted: "回收站"
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
  draft: "file",
  recurring: "restore",
  open: "checkbox",
  scheduled: "calendar",
  done: "check",
  deleted: "trash"
};

const taskViewGroups: { label: string; items: TaskView[] }[] = [
  { label: "常用", items: ["open", "scheduled"] },
  { label: "工作流", items: ["recurring", "draft"] },
  { label: "历史与维护", items: ["done", "deleted"] }
];

const taskEmptyCopy: Record<TaskView, { title: string; description: string }> = {
  draft: { title: "还没有待确认草稿", description: "手动创建和 AI 整理的内容会先保存在这里。" },
  recurring: { title: "还没有重复事项", description: "用“记一件事”创建不会挤进待处理队列的重复内容。" },
  open: { title: "还没有待处理任务", description: "补全草稿的开始和结束时间并确认后，任务会出现在这里。" },
  scheduled: { title: "还没有已安排任务", description: "任务进入日计划并确认后，会在这里显示。" },
  done: { title: "还没有已完成任务", description: "完成记录会保留在这里，方便以后回看。" },
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

function TaskScheduleEditor({ form, disabled, compact = false, estimateId, onChange, onScheduleChange }: {
  form: NewTaskForm;
  disabled: boolean;
  compact?: boolean;
  estimateId?: string;
  onChange: (form: NewTaskForm) => void;
  onScheduleChange?: (form: NewTaskForm) => void;
}) {
  const [openPicker, setOpenPicker] = useState<TaskSchedulePicker | null>(null);
  const [pickerTimeInputs, setPickerTimeInputs] = useState({ start: "", end: "" });
  const [monthKey, setMonthKey] = useState(form.earliest_start_date.slice(0, 7) || shanghaiDateValue().slice(0, 7));
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const pickerOriginalRef = useRef<{ earliest_start_date: string; earliest_start_time: string; due_date: string; due_time: string } | null>(null);
  const cells = useMemo(() => calendarCells(monthKey), [monthKey]);
  const todayDate = shanghaiDateValue();
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
  }, [openPicker?.activeField]);

  function closeSchedulePicker() {
    const trigger = triggerRef.current;
    setOpenPicker(null);
    window.requestAnimationFrame(() => trigger?.focus());
  }

  function openSchedulePicker(field: TaskSchedulePicker["activeField"]) {
    const defaults = newTaskDefaultForm();
    const nextPicker: TaskSchedulePicker = {
      activeField: field,
      earliest_start_date: form.earliest_start_date || defaults.earliest_start_date,
      earliest_start_time: form.earliest_start_time || defaults.earliest_start_time,
      due_date: form.due_date || defaults.due_date,
      due_time: form.due_time || defaults.due_time
    };
    const activeDate = field === "start" ? nextPicker.earliest_start_date : nextPicker.due_date;
    triggerRef.current = document.activeElement as HTMLElement | null;
    setMonthKey(activeDate.slice(0, 7));
    setPickerTimeInputs({ start: nextPicker.earliest_start_time, end: nextPicker.due_time });
    pickerOriginalRef.current = {
      earliest_start_date: nextPicker.earliest_start_date,
      earliest_start_time: nextPicker.earliest_start_time,
      due_date: nextPicker.due_date,
      due_time: nextPicker.due_time,
    };
    setOpenPicker(nextPicker);
  }

  function selectPickerField(field: TaskSchedulePicker["activeField"]) {
    if (!openPicker) return;
    const activeDate = field === "start" ? openPicker.earliest_start_date : openPicker.due_date;
    setMonthKey(activeDate.slice(0, 7));
    setOpenPicker({ ...openPicker, activeField: field });
  }

  function updatePickerDate(date: string) {
    setOpenPicker((current) => {
      if (!current) return current;
      const next = selectDateBoundary(current.earliest_start_date, current.due_date, current.activeField, date);
      return {
        ...current,
        earliest_start_date: next.start,
        due_date: next.end,
        activeField: next.activeField
      };
    });
    if (date.slice(0, 7) !== monthKey) setMonthKey(date.slice(0, 7));
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
      activeField: field,
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
    const projected = projectPickerForm(openPicker);
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
      earliest_start_date: original.earliest_start_date,
      earliest_start_time: original.earliest_start_time,
      due_date: original.due_date,
      due_time: original.due_time,
    });
    setPickerTimeInputs({ start: original.earliest_start_time, end: original.due_time });
    setMonthKey(original.earliest_start_date.slice(0, 7));
  }

  const pickerTimeChanged = openPicker && pickerOriginalRef.current
    && (openPicker.earliest_start_date !== pickerOriginalRef.current.earliest_start_date
      || openPicker.earliest_start_time !== pickerOriginalRef.current.earliest_start_time
      || openPicker.due_date !== pickerOriginalRef.current.due_date
      || openPicker.due_time !== pickerOriginalRef.current.due_time);

  const rows: { field: TaskSchedulePicker["activeField"]; label: string; date: string; time: string }[] = [
    { field: "start", label: "开始", date: form.earliest_start_date, time: form.earliest_start_time },
    { field: "end", label: "结束", date: form.due_date, time: form.due_time }
  ];
  const projectedForm = openPicker ? projectPickerForm(openPicker) : form;
  const pickerTimeInputsValid = validDraftClock(normalizeClockInput(pickerTimeInputs.start))
    && validDraftClock(normalizeClockInput(pickerTimeInputs.end));
  const pickerError = !pickerTimeInputsValid
    ? "请输入有效时间（00:00–23:59）"
    : !taskRangeIsValid(projectedForm)
      ? `结束时间必须比开始时间至少晚 ${MIN_TASK_WORKLOAD_MINUTES} 分钟`
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
      <div className="schedule-boundary-fields">
        <button type="button" className="schedule-boundary-field date" onClick={(e) => { e.stopPropagation(); selectPickerField(field); }}><small>日期</small><strong><Icon name="calendar" size={14} />{pickerDateLabel(date)}</strong></button>
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
    <div className="apple-schedule-rows">{rows.map((row) => <div className="apple-schedule-row" key={row.field}>
      <span className="apple-schedule-label">{row.label}</span>
      <div className="apple-schedule-values"><button type="button" className={openPicker?.activeField === row.field ? "is-active" : ""} disabled={disabled} aria-haspopup="dialog" aria-expanded={openPicker?.activeField === row.field} onClick={() => openSchedulePicker(row.field)}><Icon name="calendar" size={14} />{pickerDateLabel(row.date)}</button><button type="button" className={openPicker?.activeField === row.field ? "is-active" : ""} disabled={disabled} aria-haspopup="dialog" aria-expanded={openPicker?.activeField === row.field} onClick={() => openSchedulePicker(row.field)}><Icon name="clock" size={14} />{row.time || "选择时间"}</button></div>
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
          <div><h2 id="schedule-picker-title">时间范围</h2><p>选择任务允许开始与截止的完整边界。</p></div>
          <div className="schedule-picker-header-actions">{pickerTimeChanged && <button type="button" className="schedule-picker-reset" onClick={resetSchedulePicker}>重置时间</button>}<button type="button" className="schedule-picker-clear" onClick={clearSchedulePicker}>清除时间</button><button type="button" className="schedule-picker-close" aria-label="关闭时间范围" onClick={closeSchedulePicker}><Icon name="close" size={18} /></button></div>
        </header>
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
              const classes = [
                cell.inMonth ? "" : "outside",
                cell.key === todayDate ? "today" : "",
                inRange ? "in-range" : "",
                cell.key === openPicker.earliest_start_date ? "range-start" : "",
                cell.key === openPicker.due_date ? "range-end" : "",
                cell.key === activePickerDate ? "selected" : ""
              ].filter(Boolean).join(" ");
              return <button key={cell.key} type="button" className={classes} aria-label={cell.key === todayDate ? `${cell.day}，今天` : undefined} aria-current={cell.key === todayDate ? "date" : undefined} aria-pressed={cell.key === activePickerDate} onClick={() => updatePickerDate(cell.key)}>{cell.day}</button>;
            })}</div>
            <footer>
              <div className="schedule-picker-switch" role="tablist" aria-label="切换编辑起止时间">
                <span className="schedule-picker-switch-label">切换编辑：</span>
                <button
                  type="button"
                  role="tab"
                  aria-selected={openPicker.activeField === "start"}
                  className={`schedule-picker-switch-btn${openPicker.activeField === "start" ? " is-active" : ""}`}
                  onClick={() => selectPickerField("start")}
                >
                  <i className="time-range-marker start" aria-hidden="true" />开始时间
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={openPicker.activeField === "end"}
                  className={`schedule-picker-switch-btn${openPicker.activeField === "end" ? " is-active" : ""}`}
                  onClick={() => selectPickerField("end")}
                >
                  <i className="time-range-marker end" aria-hidden="true" />结束时间
                </button>
              </div>
              {activePickerDate === todayDate && <em>今天</em>}
            </footer>
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
  onChange,
  onScheduleChange
}: {
  form: NewTaskForm;
  disabled: boolean;
  idPrefix: string;
  autoFocusTitle?: boolean;
  compact?: boolean;
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
          <input id={titleId} className="task-title-input" autoFocus={autoFocusTitle} value={form.title} maxLength={300} required placeholder="标题" onChange={(event) => onChange({ ...form, title: event.target.value })} />
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

function RecurringItemEditor({ form, disabled, idPrefix, autoFocusTitle = false, compact = false, isCreating = false, onChange }: {
  form: RecurringItemForm;
  disabled: boolean;
  idPrefix: string;
  autoFocusTitle?: boolean;
  compact?: boolean;
  isCreating?: boolean;
  onChange: (form: RecurringItemForm) => void;
}) {
  const ruleTitleId = `${idPrefix}-rule-title`;
  const titleId = `${idPrefix}-title`;
  const notesId = `${idPrefix}-notes`;
  const [optionalNotesExpanded, setNotesExpanded] = useState(false);
  const notesExpanded = !isCreating || optionalNotesExpanded;
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

  return <div className="recurring-editor-surface">
    {/* BEGIN: EventBasicInfo */}
    <section className="recurring-modal-section recurring-basic-info-card recurring-card" data-purpose="basic-info-form" aria-label="事项内容">
      <div>
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
      {isCreating && <button type="button" className="recurring-notes-toggle" disabled={disabled} aria-label={notesExpanded ? "收起备注" : undefined} aria-expanded={notesExpanded} aria-controls={`${notesId}-panel`} onClick={() => setNotesExpanded((current) => !current)}>
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
                <div className="recurring-type-hint">到期展示，复盘时处理</div>
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
  statusTone?: TaskStatus | "draft" | "active" | "paused" | "ended";
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
    <span className="task-capsule-footer">
      <span className="task-capsule-facts">
        {facts.map((fact, index) => <span key={`${fact.icon}-${fact.label}-${index}`}><Icon name={fact.icon} size={13} />{fact.label}</span>)}
        {timing && <span><Icon name="calendar" size={13} />{timing}</span>}
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
    <p><Icon name="trash" size={14} /><span>{recycleRetentionMessage(deletedAt, nowMs)}</span></p>
    <div>
      <button type="button" disabled={busy} onClick={onRestore}><Icon name="restore" size={14} />恢复{itemLabel}</button>
      <button type="button" className="permanent" disabled={busy} onClick={onPermanentDelete}><Icon name="trash" size={14} />永久删除</button>
    </div>
  </section>;
}

function DeletedTaskDetails({ task }: { task: Task }) {
  const boundary = (date: string | null, time: string | null) => date ? `${date}${time ? ` ${time}` : ""}` : "未设置";
  return <section className="terminal-task-detail recycled-task-detail" aria-label="回收站任务详情">
    <header><h2>{task.title}</h2><span className="terminal-task-status deleted"><Icon name="trash" size={14} />回收站</span></header>
    <p className="terminal-task-help">该任务已停止后续安排，内容仍可查看；恢复后才能修改。</p>
    {task.notes && <p className="terminal-task-notes">{task.notes}</p>}
    <dl className="terminal-task-facts">
      <div><dt>最早开始</dt><dd>{boundary(task.earliest_start_date, task.earliest_start_time)}</dd></div>
      <div><dt>截止时间</dt><dd>{boundary(task.due_date, task.due_time)}</dd></div>
      <div><dt>预计总投入</dt><dd>{task.estimated_minutes === null ? "未设置" : formatWorkloadMinutes(task.estimated_minutes)}</dd></div>
      <div><dt>剩余投入</dt><dd>{task.remaining_workload_minutes === null ? "未设置" : formatWorkloadMinutes(task.remaining_workload_minutes)}</dd></div>
      <div><dt>优先级</dt><dd>{task.priority ? priorityCopy[task.priority] : "未设置"}</dd></div>
      <div><dt>任务来源</dt><dd>{task.source_type === "ai_assistant" ? "AI 创建" : "手动创建"}</dd></div>
    </dl>
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

function CompletedTaskDetails({ task, busy, onReopen, onTrash }: {
  task: Task; busy: boolean; onReopen: () => void; onTrash: () => void;
}) {
  const boundary = (date: string | null, time: string | null) => date ? `${date}${time ? ` ${time}` : ""}` : "未设置";
  return <section className="terminal-task-detail" aria-label="任务只读详情">
    <header><h2>{task.title}</h2><span className="terminal-task-status completed"><Icon name="check" size={14} />已完成</span></header>
    <p className="terminal-task-help">如需修改，请先取消完成。</p>
    {task.notes && <p className="terminal-task-notes">{task.notes}</p>}
    <dl className="terminal-task-facts">
      <div><dt>最早开始</dt><dd>{boundary(task.earliest_start_date, task.earliest_start_time)}</dd></div>
      <div><dt>截止时间</dt><dd>{boundary(task.due_date, task.due_time)}</dd></div>
      <div><dt>预计工作量</dt><dd>{task.estimated_minutes === null ? "未设置" : `${task.estimated_minutes} 分钟`}</dd></div>
      <div><dt>优先级</dt><dd>{task.priority ? priorityCopy[task.priority] : "未设置"}</dd></div>
    </dl>
    <footer><button type="button" className="secondary-action" disabled={busy} onClick={onReopen}><Icon name="restore" size={15} />取消完成</button><button type="button" className="terminal-task-trash" disabled={busy} onClick={onTrash}><Icon name="trash" size={14} />移入回收站</button></footer>
  </section>;
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
  onReturnToTimeline
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
}) {
  const [view, setView] = useState<TaskView>("open");
  const [search, setSearch] = useState("");
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
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const filterPopupRef = useRef<HTMLElement>(null);
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
  const handledRequestedView = useRef<TaskViewRequest | null>(null);
  const taskViewInitialized = useRef(false);
  const [taskViewReady, setTaskViewReady] = useState(false);
  const [recycleNow, setRecycleNow] = useState(() => Date.now());

  useEffect(() => {
    if (!requestedView || handledRequestedView.current === requestedView) return;
    if (requestedView.taskId) {
      const target = tasks.find((task) => task.id === requestedView.taskId);
      if (target) {
        setView(viewForStatus(target.status));
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

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    return tasks.filter((task) => taskMatchesView(task, view)
      && (!query || task.title.toLocaleLowerCase("zh-CN").includes(query) || task.notes?.toLocaleLowerCase("zh-CN").includes(query)));
  }, [tasks, view, search]);
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
      && (!query
        || item.title.toLocaleLowerCase("zh-CN").includes(query)
        || item.notes?.toLocaleLowerCase("zh-CN").includes(query)));
  }, [recurringItems, view, search]);
  const selectedTask = tasks.find((task) => task.id === selectedId) ?? null;
  const selectedRecurringItem = recurringItems.find((item) => item.id === selectedRecurringId) ?? null;
  const selectedRecycleTimestamp = selectedTask?.status === "deleted"
    ? selectedTask.deleted_at
    : selectedRecurringItem?.deleted_at ?? null;
  const metadataDirty = Boolean(taskMetadata && initialTaskMetadata.current
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
    newTaskEditRevision.current += 1;
    setNewTaskAutosaveArmed(true);
    setNewTaskForm(next);
  }

  function applyCreateItemType(type: CreateItemType) {
    if (!creating || busy || draftSaving || type === createItemType || persistedNewTaskDraft?.target_task_id) return;
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
    if (selectedTask) setTaskMetadata({ task_id: selectedTask.id, tags: next.tags, recurrence: next.recurrence });
  }

  function updateEditingTaskSchedule(next: NewTaskForm) {
    if (!editingTaskForm) return;
    updateEditingTaskForm(normalizeTaskWorkloadAfterScheduleChange(editingTaskForm, next));
  }

  function updateNewTaskSchedule(next: NewTaskForm) {
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
      if (showFeedback) setFeedback("草稿已保存，任务尚未创建。");
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
        preferredSelection.current = null;
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
    if (!selectedTask) { setDraft(null); return; }
    setDraft(draftForTask(selectedTask));
  }, [selectedTask?.id, selectedTask?.updated_at]);

  useEffect(() => {
    if (!selectedRecycleTimestamp) return;
    setRecycleNow(Date.now());
    const interval = window.setInterval(() => setRecycleNow(Date.now()), 60 * 1000);
    return () => window.clearInterval(interval);
  }, [selectedRecycleTimestamp]);

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
    }).catch((reason) => { if (active) setFeedback(`任务详情暂时无法打开：${uiErrorMessage(reason)}`); });
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
    open: tasks.filter((task) => task.status === "open").length,
    scheduled: tasks.filter((task) => task.status === "scheduled").length,
    done: tasks.filter((task) => task.status === "done").length,
    deleted: tasks.filter((task) => task.status === "deleted").length + recurringItems.filter((item) => item.deleted_at).length
  }), [tasks, taskDrafts, recurringItems]);
  const showUnsavedCreateCapsule = creating && view === "draft"
    && !persistedNewTaskDraft;

  useEffect(() => {
    if (loading || taskViewInitialized.current || requestedView) return;
    taskViewInitialized.current = true;
    const operationalViews: TaskView[] = ["open", "scheduled"];
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
    if (!taskViewReady || !["open", "scheduled"].includes(view)) return;
    void setUiSetting(TASK_QUEUE_VIEW_SETTING, view).catch(() => undefined);
  }, [view, taskViewReady]);

  async function commitDraft(scope?: "this" | "future") {
    if (!taskIsEditable(selectedTask)) return false;
    if (!selectedTask || !draft || busy || !isDirty) return !isDirty;
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
          });
      const metadata = await getTaskMetadata(selectedTask.id);
      setTaskMetadata(metadata);
      initialTaskMetadata.current = metadata;
      onTaskCommitted({ ...committed, tags: metadata.tags });
      setDraft(draftForTask(committed));
      setPendingRecurringSave(null);
      setFeedback(null);
      await showCommittedToast("任务更改已保存");
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

  async function commitNewTask() {
    if (busy || draftSaving) return false;
    const input = currentCreationInput();
    if (!input.title.trim()) return false;
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
      if (!persisted) return false;
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
        setView(viewForStatus(result.item.status));
        setSelectedId(result.item.id);
        await onReload(false);
        await showCommittedToast(persisted.draft_kind === "update" ? "AI 整理的修改已确认并保存" : "任务已创建并保存");
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
      setFeedback("草稿已放弃，正式任务没有变化。");
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
    } catch (reason) { preferredSelection.current = null; setFeedback(`状态未改变：${uiErrorMessage(reason)}`); }
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
        : `“${selectedTask.title}”已取消完成，当前为待处理。`);
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
      preferredSelection.current = null;
      if (selectedId === target.id) {
        setSelectedId(null);
        setDraft(null);
        setTaskMetadata(null);
      }
      await onReload(false);
      setPendingTrashTask(null);
      setFeedback(null);
      setSuccessToast({ id: Date.now(), message: `“${target.title}”已移入回收站，可在回收站恢复` });
    } catch (reason) { preferredSelection.current = null; setFeedback(`未移入回收站：${uiErrorMessage(reason)}`); }
    finally { setBusy(false); }
  }

  async function restore(target: Task | null = selectedTask) {
    if (!target || busy) return;
    setBusy(true);
    try {
      preferredSelection.current = target.id;
      await restoreManualTask(target.id);
      setView("open");
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

  function applyTaskChange(change: PendingTaskChange) {
    setFeedback(null);
    if (creating) clearNewTaskForm();
    if (change.kind === "select") {
      preferredSelection.current = null;
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
      void transition(change.status);
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
      setDraft(draftForTask(selectedTask));
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
      <div className="toast-viewport" aria-live="polite" aria-atomic="true">
        {successToast && <div key={successToast.id} className="success-toast" role="status"><span className="toast-icon"><Icon name="check" size={16} /></span><span>{successToast.message}</span>{successToast.undoId && <button type="button" onClick={() => void undoLastChange(successToast.undoId!)}>撤销</button>}</div>}
      </div>
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
          {!error && !loading && !taskDraftsLoading && !creating && visibleTasks.length === 0 && visibleTaskDrafts.length === 0 && visibleRecurringItems.length === 0 && <div className="ledger-empty"><Icon name={view === "deleted" ? "trash" : view === "draft" ? "sparkle" : view === "recurring" ? "restore" : "tasks"} size={22} /><strong>{search ? "没有匹配内容" : taskEmptyCopy[view].title}</strong><span>{search ? `“${search.trim()}”在当前筛选中没有结果。` : taskEmptyCopy[view].description}</span>{search && <button type="button" onClick={() => setSearch("")}>清除搜索</button>}</div>}
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
                  {itemType === "recurring" ? <TaskCapsuleContent title={draftTitle} notes={draftNotes} status="待确认" statusTone="draft" variant="recurring" sourceType={item.source_type} facts={recurringCapsuleFacts(recurring, today)} /> : <TaskCapsuleContent title={draftTitle} notes={draftNotes} priority={draftPriority} timing={draftTiming} minutes={draftMinutes} status="待确认" statusTone="draft" sourceType={item.source_type} />}
                </button>
                <div className="ledger-row-actions" aria-label={`${draftTitle}的快捷操作`}>
                  {!isEditingActiveDraft && <button type="button" className="ledger-quick-action" onClick={() => void selectPersistedTaskDraft(item)}>编辑</button>}
                  <button type="button" className="ledger-quick-action danger" aria-label={`放弃${draftTitle}`} onClick={() => setPendingDiscardTaskDraft(item)}><Icon name="trash" size={14} /><span>放弃</span></button>
                </div>
              </div>
            );
          })}
          {!loading && visibleTasks.map((task) => (
            <div key={task.id} className={`${selectedId === task.id ? "ledger-row selected" : "ledger-row"} task-ledger-row task-capsule-row capsule-type-task status-row-${task.status}`}>
              <button type="button" className="ledger-row-select task-capsule-select" aria-pressed={selectedId === task.id} onClick={() => requestTaskChange({ kind: "select", taskId: task.id })}>
              <span className="ledger-accent" aria-hidden="true" />
              <TaskCapsuleContent title={task.title} notes={task.notes} priority={task.priority} timing={taskTimingFact(task, today)} minutes={task.estimated_minutes} status={statusCopy[task.status]} statusTone={task.status} sourceType={task.source_type} typeLabel={task.status === "deleted" ? "普通任务" : undefined} />
              </button>
              <div className="ledger-row-actions" aria-label={`${task.title}的快捷操作`}>
                {selectedId !== task.id && taskIsEditable(task) && <button type="button" className="ledger-quick-action" onClick={() => requestTaskChange({ kind: "select", taskId: task.id })}>编辑</button>}
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
          ) : view === "deleted" && selectedTask?.status === "deleted" ? (
            <RecycleBinBanner deletedAt={selectedTask.deleted_at} nowMs={recycleNow} itemLabel="任务" busy={busy} onRestore={() => void restore(selectedTask)} onPermanentDelete={() => setPendingPermanentTask(true)} />
          ) : null}
          {timelineReturnContext && selectedTask && <div className="task-context-return"><button type="button" aria-label="返回今日计划中的任务块" title="返回今日计划中的任务块" onClick={() => onReturnToTimeline(timelineReturnContext)}><Icon name="chevron-left" size={16} /><span>返回任务块</span></button></div>}
          {creating ? (
            <form id="new-task-form" className="task-form create-task-form edit-task-form task-compact-form" onSubmit={submitNewTask}>
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
                      <span><strong>重复事项</strong><small>到期展示，复盘时处理</small></span>
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
                  <TaskEditorRegions form={newTaskForm} disabled={busy} idPrefix="new-task" autoFocusTitle compact onChange={updateNewTaskFields} onScheduleChange={updateNewTaskSchedule} />
                ) : (
                  <RecurringItemEditor form={recurringForm} disabled={busy} idPrefix="new-recurring" autoFocusTitle compact isCreating onChange={(next) => { newTaskEditRevision.current += 1; setNewTaskAutosaveArmed(true); setRecurringForm(next); }} />
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
                        ? !newTaskForm.title.trim() || !newTaskHasCompleteSchedule || !newTaskHasValidRange || !newTaskHasValidWorkload
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
                <RecurringItemEditor key={selectedRecurringItem.id} form={recurringForm} disabled={busy} idPrefix="edit-recurring" compact onChange={setRecurringForm} />
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
          ) : !selectedTask || !draft ? <div className="inspector-empty"><Icon name={view === "draft" ? "sparkle" : view === "recurring" ? "restore" : view === "deleted" ? "trash" : "tasks"} size={21} /><p>{view === "draft" ? "当前没有待确认草稿" : view === "recurring" ? "选择一条重复事项查看和编辑" : view === "deleted" ? "选择一项回收内容查看类型与操作" : "选择一项任务查看和编辑"}</p></div> : selectedTask.status === "deleted" ? (
            <DeletedTaskDetails task={selectedTask} />
          ) : selectedTask.status === "done" ? (
            <CompletedTaskDetails task={selectedTask} busy={busy} onReopen={() => requestTaskChange({ kind: "reopen" })} onTrash={() => requestTaskChange({ kind: "trash" })} />
          ) : editingTaskForm ? (
            <form id="task-editor-form" className="task-form create-task-form edit-task-form task-compact-form" onSubmit={save}>
              <header className="task-compact-header">
                <div className="task-compact-heading">
                  <div className="task-compact-title-row"><h2>编辑任务</h2><span className={`task-compact-status status-${selectedTask.status}`}><i aria-hidden="true" />{statusCopy[selectedTask.status]}</span><span className="task-compact-source"><i aria-hidden="true">·</i>{selectedTask.source_type === "ai_assistant" ? "AI 创建" : "手动创建"}</span></div>
                </div>
              </header>
              <div className="task-compact-body"><TaskEditorRegions form={editingTaskForm} disabled={busy} idPrefix="edit-task" compact onChange={updateEditingTaskForm} onScheduleChange={updateEditingTaskSchedule} /></div>
              <footer className="task-compact-actions">
                <div className="task-compact-lifecycle">
                  {["open", "scheduled"].includes(selectedTask.status) && <button type="button" className="task-compact-complete" title="完成整个任务并停止后续安排；已保存的执行历史仍会保留" onClick={() => requestTaskChange({ kind: "transition", status: "done" })} disabled={busy}><Icon name="check" size={15} />完成整个任务</button>}
                  <button type="button" className="task-compact-trash" disabled={busy} onClick={() => requestTaskChange({ kind: "trash" })}><Icon name="trash" size={15} />移入回收站</button>
                </div>
                <div className="task-compact-primary-actions">
                  <span className="sr-only" role="status">{busy ? "正在保存" : isDirty ? "有未保存的更改" : "更改已保存"}</span>
                  <button type="button" className="task-compact-cancel" disabled={busy} onClick={() => requestTaskChange({ kind: "close-compact-editor" })}>取消</button>
                  <button type="submit" className="task-compact-save" disabled={busy || !isDirty || !draft.title.trim() || !editingTaskHasCompleteSchedule || !editingTaskHasValidRange || !editingTaskHasValidWorkload}>{busy ? <span className="loader" /> : <Icon name="check" size={15} />}{busy ? "保存中…" : "保存修改"}</button>
                </div>
              </footer>
            </form>
          ) : null}
          </div>
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
      {pendingDiscardTaskDraft && <div className="dialog-backdrop task-trash-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingDiscardTaskDraft(null); }}><section className="unsaved-dialog task-trash-dialog" role="alertdialog" aria-modal="true" aria-labelledby="discard-task-draft-title" onKeyDown={(event) => { if (event.key === "Escape" && !busy) setPendingDiscardTaskDraft(null); }}><div className="dialog-icon trash"><Icon name="trash" size={19} /></div><h2 id="discard-task-draft-title">放弃草稿？</h2><p>“{pendingDiscardTaskDraft.title || "未命名草稿"}”将从草稿中移除，原任务不会变化。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingDiscardTaskDraft(null)}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void discardTaskDraftFromList(pendingDiscardTaskDraft)}>{busy ? "正在放弃…" : "确认放弃"}</button></div></section></div>}
      {pendingEndRecurringItem && <div className="dialog-backdrop task-trash-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingEndRecurringItem(null); }}><section className="unsaved-dialog task-trash-dialog" role="alertdialog" aria-modal="true" aria-labelledby="end-recurring-item-title" onKeyDown={(event) => { if (event.key === "Escape" && !busy) setPendingEndRecurringItem(null); }}><div className="dialog-icon trash"><Icon name="close" size={19} /></div><h2 id="end-recurring-item-title">结束重复事项？</h2><p>“{pendingEndRecurringItem.title}”以后不会再出现；已经保存的记录会继续保留。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingEndRecurringItem(null)}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void endRecurringItemFromList(pendingEndRecurringItem)}>{busy ? "正在结束…" : "确认结束"}</button></div></section></div>}
      {pendingTrashRecurringItem && <div className="dialog-backdrop task-trash-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingTrashRecurringItem(null); }}><section className="unsaved-dialog task-trash-dialog" role="alertdialog" aria-modal="true" aria-labelledby="trash-recurring-item-title" onKeyDown={(event) => { if (event.key === "Escape" && !busy) setPendingTrashRecurringItem(null); }}><div className="dialog-icon trash"><Icon name="trash" size={19} /></div><h2 id="trash-recurring-item-title">移入回收站？</h2><p>“{pendingTrashRecurringItem.title}”将从重复事项列表移除；过去的记录仍会保留，之后也可以恢复。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingTrashRecurringItem(null)}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void moveRecurringItemToTrash()}>{busy ? "正在移入…" : "确认移入"}</button></div></section></div>}
      {pendingRecurringSave && selectedTask && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingRecurringSave(null); }}><section className="unsaved-dialog" role="alertdialog" aria-modal="true" aria-labelledby="recurring-scope-title" aria-describedby="recurring-scope-description" onKeyDown={(event) => { if (event.key === "Escape" && !busy) setPendingRecurringSave(null); }}><div className="dialog-icon"><Icon name="restore" size={19} /></div><h2 id="recurring-scope-title">修改哪些重复任务？</h2><p id="recurring-scope-description">“{selectedTask.title}”来自一项重复安排。以前的任务和执行记录不会改变。</p><div className="dialog-actions"><button type="button" disabled={busy} onClick={() => setPendingRecurringSave(null)}>取消</button><button type="button" disabled={busy} onClick={() => void commitDraft("this")}>仅修改本次</button><button type="button" className="dialog-save" disabled={busy} onClick={() => void commitDraft("future")}>修改本次及以后</button></div></section></div>}
      {pendingDiscardNew && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingDiscardNew(false); }}><section className="unsaved-dialog" role="alertdialog" aria-modal="true" aria-labelledby="discard-new-title"><h2 id="discard-new-title">放弃这个草稿？</h2><p>已填写的内容将从草稿中移除，原任务不会变化。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingDiscardNew(false)}>继续编辑</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => { setPendingDiscardNew(false); void cancelNewTask(false); }}>放弃草稿</button></div></section></div>}

      {pendingDraftSelection && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !draftSaving && !busy) setPendingDraftSelection(null); }}><section className="unsaved-dialog" role="alertdialog" aria-modal="true" aria-labelledby="switch-draft-title"><h2 id="switch-draft-title">保存当前草稿并切换？</h2><p>当前输入会先保存为草稿，然后打开“{pendingDraftSelection.title || "未命名草稿"}”。</p><div className="dialog-actions"><button type="button" autoFocus disabled={draftSaving || busy} onClick={() => setPendingDraftSelection(null)}>留在当前草稿</button><button type="button" className="dialog-save" disabled={draftSaving || busy} onClick={() => { const target = pendingDraftSelection; setPendingDraftSelection(null); void saveAndSwitchPersistedTaskDraft(target); }}>保存并切换</button></div></section></div>}
      {pendingPermanentTask && selectedTask && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingPermanentTask(false); }}><section className="unsaved-dialog task-trash-dialog" role="alertdialog" aria-modal="true" aria-labelledby="permanent-task-title"><div className="dialog-icon trash"><Icon name="trash" size={19} /></div><h2 id="permanent-task-title">永久删除任务？</h2><p>“{selectedTask.title}”及其本地历史将无法恢复。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingPermanentTask(false)}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void permanentlyDelete()}>{busy ? "正在删除…" : "永久删除"}</button></div></section></div>}
      {pendingPermanentRecurringItem && selectedRecurringItem && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPendingPermanentRecurringItem(false); }}><section className="unsaved-dialog task-trash-dialog" role="alertdialog" aria-modal="true" aria-labelledby="permanent-recurring-item-title"><div className="dialog-icon trash"><Icon name="trash" size={19} /></div><h2 id="permanent-recurring-item-title">永久删除重复事项？</h2><p>“{selectedRecurringItem.title}”及其全部历史和复盘记录将无法恢复。</p><div className="dialog-actions"><button type="button" autoFocus disabled={busy} onClick={() => setPendingPermanentRecurringItem(false)}>取消</button><button type="button" className="dialog-discard" disabled={busy} onClick={() => void permanentlyDeleteSelectedRecurringItem()}>{busy ? "正在删除…" : "永久删除"}</button></div></section></div>}
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
type ExecutionDraft = { result: ExecutionResult | null; outcome: ReviewOutcome | null; note: string };

function ExecutionCaptureFields({ draft, disabled, onChange }: {
  draft: ExecutionDraft; disabled: boolean; onChange: (update: Partial<ExecutionDraft>) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (noteOpen) noteRef.current?.focus(); }, [noteOpen]);
  const showNote = Boolean(draft.result) && (noteOpen || Boolean(draft.note) || draft.result === "partial" || draft.result === "not_completed");
  return <div className="execution-capture-fields">
    <div className="execution-result-label">本次结果</div>
    <ExecutionOutcomePicker compact label="本次执行结果" result={draft.result} outcome={draft.outcome} disabled={disabled} onChange={(result, outcome) => { if (result === "completed") setNoteOpen(false); onChange({ result, outcome }); }} />
    {showNote ? <label className="floating-execution-note"><span>备注<small>可选</small></span><textarea ref={noteRef} rows={2} maxLength={500} placeholder={draft.result === "partial" ? "完成了哪些，接下来还要做什么？" : draft.result === "not_completed" ? "遇到了什么问题？" : "记下一句，复盘时回看"} value={draft.note} disabled={disabled} onChange={(event) => onChange({ note: event.target.value })} /></label> : draft.result === "completed" ? <button type="button" className="execution-add-note" disabled={disabled} aria-expanded={false} onClick={() => setNoteOpen(true)}><Icon name="plus" size={13} />添加备注</button> : null}
  </div>;
}
type PlanDraftTimeEdit = {
  blockIndex: number;
  sourceBlockId?: string;
  starts_at: string;
  ends_at: string;
  original_starts_at: string;
  original_ends_at: string;
  error: string;
};
type TimelineTooltipContent = {
  kind: "普通任务" | "任务安排" | "计划草案" | "固定日程" | "重复事项" | "待安排任务" | "非工作时间";
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
    {describedBy && <small id={describedBy} className="plan-draft-sync-note">{collapsedPresentation
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
  onGeneratePlan, onAdjustPlan, onUpdatePlan, onConfirmPlan, onCancelPlan, onOpenTasks, onFactsChanged, onNotify, message,
  timelineReturnContext, onTimelineReturnHandled
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
  onOpenTasks: (taskId?: string, returnContext?: TimelineReturnContext) => void;
  onFactsChanged: (date?: string) => Promise<void>;
  onNotify: (label: string, message: string, icon?: IconName) => void;
  message: string;
  timelineReturnContext: TimelineReturnContext | null;
  onTimelineReturnHandled: () => void;
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
  const [clock, setClock] = useState(() => new Date());
  const [followingNow, setFollowingNow] = useState(true);
  const [showReturnToNow, setShowReturnToNow] = useState(false);
  const [timelineTooltip, setTimelineTooltip] = useState<TimelineTooltipState | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const timelineCenteredDateRef = useRef<string | null>(null);
  const returnToNowFrameRef = useRef(0);
  const timelineFloatingPanelRef = useRef<HTMLElement>(null);
  const timelineSelectionTriggerRef = useRef<HTMLElement | null>(null);
  const timelineSelectionAnchorRef = useRef<HTMLElement | null>(null);
  const cells = useMemo(() => calendarCells(monthKey), [monthKey]);

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
  const holidayCoverageAvailable = officialHolidayCoverageFor(`${monthKey}-01`);

  function showTimelineTooltipForTarget(content: TimelineTooltipContent, target: HTMLElement, anchorMode: TimelineTooltipAnchor) {
    const targetRect = target.getBoundingClientRect();
    const contentAnchor = anchorMode === "content"
      ? target.querySelector<HTMLElement>(".timeline-event-copy, .lane-copy, :scope > span")
      : null;
    const contentRect = contentAnchor?.getBoundingClientRect() ?? targetRect;
    const scrollRect = target.closest(".timeline-events") ? timelineScrollRef.current?.getBoundingClientRect() : null;
    const taskTooltip = content.kind === "普通任务" || content.kind === "重复事项";
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
    if (!timelineReturnContext) return;
    if (timelineReturnContext.date !== selectedDate) {
      onSelectDate(timelineReturnContext.date);
      return;
    }
    if (loading) return;
    setTodayView("timeline");
    setFollowingNow(false);
    setTimelineTooltip(null);
    setPlanDraftTimeEdit(null);
    const block = taskBlocks.find((item) => item.id === timelineReturnContext.blockId);
    if (!block) {
      onTimelineReturnHandled();
      return;
    }
    setSelection({ kind: "block", id: block.id });
    setExecutionMessage("");
    const frame = window.requestAnimationFrame(() => {
      const scroller = timelineScrollRef.current;
      const target = Array.from(scroller?.querySelectorAll<HTMLElement>("[data-timeline-kind][data-timeline-id]") ?? [])
        .find((candidate) => candidate.dataset.timelineKind === "block" && candidate.dataset.timelineId === block.id) ?? null;
      if (scroller && target) {
        timelineSelectionTriggerRef.current = target;
        timelineSelectionAnchorRef.current = target;
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
  }, [timelineReturnContext?.date, timelineReturnContext?.blockId, selectedDate, loading, schedule]);

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
    if (todayView !== "timeline") return;
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
  }, [todayView, selection]);

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

  function selectCalendarDate(date: string) {
    if (!onSelectDate(date)) return false;
    setMonthSelectionPending(false);
    if (date.slice(0, 7) !== monthKey) setMonthKey(date.slice(0, 7));
    return true;
  }

  function openTimelineDate(date: string) {
    if (!selectCalendarDate(date)) return;
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
    if (!selectedBlock || selectedBlock.execution_status !== "planned" || selectedBlock.review || isPastDate || busy || !["open", "scheduled"].includes(selectedBlock.task_status)) return;
    setExecutionDraft(null);
    const startsAt = timeInputValue(selectedBlock.starts_at);
    const endsAt = timeInputValue(selectedBlock.ends_at);
    setPlanDraftTimeEdit({
      blockIndex: -1,
      sourceBlockId: selectedBlock.id,
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
    const outcome = selectedBlock.execution_status === "planned" ? null : selectedBlock.execution_status;
    setPlanDraftTimeEdit(null);
    setExecutionDraft(!selectedBlock.review && selectedDate === today ? {
      result: executionResultForOutcome(outcome),
      outcome,
      note: selectedBlock.execution_note ?? ""
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
      if (!sourceBlock) {
        onNotify("暂时不能调整这个时间块", "这项安排已经发生变化，请重新打开后再试", "review");
        return null;
      }
      if (!workingPreview) workingPreview = await onAdjustPlan();
      if (!workingPreview) return null;
      blockIndex = workingPreview.blocks.findIndex((block) =>
        block.task_id === sourceBlock.task_id
        && block.starts_at === sourceBlock.starts_at
        && block.ends_at === sourceBlock.ends_at
      );
      if (blockIndex < 0) {
        onNotify("暂时不能调整这个时间块", "这项安排已经产生执行记录或计划已发生变化", "review");
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
    if (!planDraftTimeEdit) return;
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
      setPlanDraftTimeEdit({ ...planDraftTimeEdit, starts_at: startsAt, ends_at: endsAt, error: "" });
      const task = selectedDraftTask ?? (selectedBlock ? tasks.find((item) => item.id === selectedBlock.task_id) ?? null : null);
      onNotify("时间未保存", planDraftErrorMessage(reason, task, selectedDate), "review");
    }
  }

  async function removePlanDraftBlock(edit: PlanDraftTimeEdit | null = planDraftTimeEdit) {
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
      onNotify("没有移出草案", planDraftErrorMessage(reason, task, selectedDate), "review");
    }
  }

  function revealDraftBlock(blockIndex: number) {
    setFollowingNow(false);
    window.requestAnimationFrame(() => {
      const scroller = timelineScrollRef.current;
      const target = scroller?.querySelector<HTMLElement>(`[data-timeline-kind="draft"][data-timeline-id="${blockIndex}"]`);
      if (!scroller || !target) return;
      const scrollerRect = scroller.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const desiredTop = scroller.scrollTop + targetRect.top - scrollerRect.top - (scroller.clientHeight - targetRect.height) / 2;
      const nextTop = Math.max(0, Math.min(desiredTop, scroller.scrollHeight - scroller.clientHeight));
      scroller.scrollTo({
        top: nextTop,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
    });
  }

  function removeSelectedBlockFromToday() {
    if (!selectedBlock || selectedBlock.execution_status !== "planned" || selectedBlock.review || isPastDate || busy || !["open", "scheduled"].includes(selectedBlock.task_status)) return;
    setExecutionDraft(null);
    const startsAt = timeInputValue(selectedBlock.starts_at);
    const endsAt = timeInputValue(selectedBlock.ends_at);
    void removePlanDraftBlock({
      blockIndex: -1,
      sourceBlockId: selectedBlock.id,
      starts_at: startsAt,
      ends_at: endsAt,
      original_starts_at: startsAt,
      original_ends_at: endsAt,
      error: ""
    });
  }

  async function includeUnscheduledTask(
    item: RuleUnscheduledTask,
    sourcePreview: RulePlanPreview | null = preview,
    trigger?: HTMLButtonElement
  ) {
    if (!sourcePreview || !item.estimated_minutes) return;
    const task = tasks.find((candidate) => candidate.id === item.task_id);
    const boundaryIssue = taskSchedulingBoundaryIssue(task, selectedDate);
    if (boundaryIssue) {
      onNotify("当前日期不能安排", `“${item.task_title}”${boundaryIssue}。`, "clock");
      return;
    }
    const preferredMinutes = preferredDailyAllocationMinutes(task, item.estimated_minutes);
    const suggested = suggestedDraftAllocations(selectedDate, preferredMinutes, availability, task);
    if (suggested.issue) {
      const message = suggested.issue === "duration_too_short"
        ? `“${item.task_title}”剩余待安排时长为 ${item.estimated_minutes} 分钟；普通任务块至少需要 ${MIN_TASK_BLOCK_MINUTES} 分钟，请先调整任务工作量。`
        : suggested.issue === "available_window_too_short"
          ? `“${item.task_title}”当天可安排的时间不足 ${MIN_TASK_BLOCK_MINUTES} 分钟，请调整任务时间或选择其他日期。`
          : `“${item.task_title}”不能安排在当天，请调整任务时间或选择其他日期。`;
      onNotify("无法加入当天", message, "clock");
      return;
    }
    const scheduledMinutes = preferredMinutes - suggested.remainingMinutes;
    const newBlocks: RulePlanBlock[] = suggested.allocations.map((allocation) => ({
      task_id: item.task_id,
      task_title: item.task_title,
      ...allocation
    }));
    const unscheduled = sourcePreview.unscheduled.filter((candidate) => candidate.task_id !== item.task_id);
    const remainingMinutes = item.estimated_minutes - scheduledMinutes;
    try {
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
        setSelection({ kind: "draft", id: String(blockIndex) });
        const startsAt = timeInputValue(saved.blocks[blockIndex].starts_at);
        const endsAt = timeInputValue(saved.blocks[blockIndex].ends_at);
        setPlanDraftTimeEdit({
          blockIndex,
          starts_at: startsAt,
          ends_at: endsAt,
          original_starts_at: startsAt,
          original_ends_at: endsAt,
          error: ""
        });
        revealDraftBlock(blockIndex);
      }
      onNotify(
        remainingMinutes > 0 ? "已拆分加入时间线" : "已加入时间线",
        remainingMinutes > 0
          ? `今天已安排 ${scheduledMinutes} 分钟，剩余 ${remainingMinutes} 分钟可在后续日期继续安排。`
          : `“${item.task_title}”已加入当前计划草案。`,
        "check"
      );
    } catch (reason) {
      onNotify("没有加入草案", planDraftErrorMessage(reason, task ?? null, selectedDate), "review");
    }
  }

  async function includeWaitingTask(task: Task, trigger: HTMLButtonElement) {
    const estimatedMinutes = taskUnreservedMinutes(task);
    if (!estimatedMinutes) {
      onOpenTasks(task.id);
      return;
    }
    const adjustment = await onAdjustPlan();
    if (!adjustment) return;
    const item = adjustment.unscheduled.find((candidate) => candidate.task_id === task.id);
    if (!item?.estimated_minutes) {
      onNotify("暂时不能加入时间线", "任务或计划已经发生变化，请刷新后再试", "review");
      return;
    }
    await includeUnscheduledTask(item, adjustment, trigger);
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
    setExecutionMessage("");
    try {
      await saveExecutionCapture(selectedDate, {
        plan_block_id: selectedBlock.id,
        outcome: executionDraft.outcome,
        note: executionDraft.note.trim() || null
      });
      await onFactsChanged();
      setSelection(null);
      setPlanDraftTimeEdit(null);
      window.requestAnimationFrame(() => timelineSelectionTriggerRef.current?.focus());
      onNotify("本次执行已记录", `${selectedBlock.task_title} · 等待每日复盘`, "check");
    } catch (reason) {
      setExecutionMessage(`未记录：${uiErrorMessage(reason)}`);
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
      onNotify("本次完成未记录", uiErrorMessage(reason), "review");
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
      onNotify("未能取消完成", uiErrorMessage(reason), "review");
    } finally {
      setQuickCompletingBlockId(null);
    }
  }

  return (
    <section className="next-page today-page" aria-label="今日">
      {message && <p className="page-status" role="status">{message}</p>}
      <div className="timeline-page-shell">
        <header className="timeline-design-topbar">
          <div className="timeline-heading">
            {todayView === "timeline" && <CalendarOverviewButton onClick={returnToMonth} />}
            <div className="timeline-date-copy"><h1>{todayView === "month" && monthSelectionPending ? monthTitle : selectedDateTitle}</h1><span>{todayView === "month" && monthSelectionPending ? "选择一天查看安排" : `${selectedWeekday}${selectedLunarDay ? ` · 农历${selectedLunarDay}` : ""}`}</span></div>
          </div>
          <div className="timeline-top-actions">
            {isAwayFromToday && <button type="button" className="quiet-button" onClick={returnToday}>回到今天</button>}
            {todayView === "timeline" && (preview ? <div className="plan-draft-top-actions" aria-label="日计划草案操作">
              <span className="plan-draft-mode"><i />{isAdjustingConfirmedPlan ? "有未保存的修改" : "计划待确认"}</span>
              <PlanRegenerateButton confirmed={isAdjustingConfirmedPlan} busy={busy} onClick={onGeneratePlan} />
              <button type="button" className="quiet-button" disabled={busy} onClick={() => void onCancelPlan()}>{isAdjustingConfirmedPlan ? "放弃修改" : "放弃草案"}</button>
              <button type="button" className="primary-action" disabled={busy || (!isAdjustingConfirmedPlan && preview.blocks.length === 0)} onClick={onConfirmPlan}>{busy ? "正在保存…" : isAdjustingConfirmedPlan ? "保存调整" : "确认计划"}</button>
            </div> : hasConfirmedPlan && !isPastDate ? <div className="confirmed-plan-actions" aria-label="已确认计划操作"><span className="confirmed-plan-status"><Icon name="check" size={13} />计划已确认</span><PlanRegenerateButton confirmed busy={busy} onClick={onGeneratePlan} /></div> : <button type="button" className="primary-action" disabled={busy || isPastDate} title={planActionTitle} onClick={onGeneratePlan}>{busy ? "正在生成…" : planActionLabel}</button>)}
          </div>
        </header>

        {todayView === "month" ? <main className="today-month-view" aria-label={monthTitle}>
          <section className="month-sheet today-month-sheet">
            <div className="month-controls"><button type="button" aria-label="上一个月" onClick={() => moveMonth(-1)}><Icon name="chevron-left" size={17} /></button><strong>{monthTitle}</strong><button type="button" aria-label="下一个月" onClick={() => moveMonth(1)}><Icon name="chevron-right" size={17} /></button></div>
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
              return <button key={cell.key} type="button" role="gridcell" aria-selected={selectedDate === cell.key} aria-label={`${cell.key}${lunarLabel ? `，农历${lunarLabel}` : ""}${calendarLabel ? `，${calendarLabel}` : ""}${workStateLabel ? `，${workStateLabel === "休" ? "放假" : "调休上班"}` : ""}${count ? `，${count} 项任务` : ""}${recurringCount ? `，${recurringCount} 项重复事项` : ""}`} className={`${cell.inMonth ? "in-month" : "outside"}${cell.key === today ? " today" : ""}${selectedDate === cell.key ? " selected" : ""}${dayInfo?.workState ? ` ${dayInfo.workState}` : ""}${count ? " has-tasks" : ""}${recurringCount ? " has-recurring-items" : ""}`} onClick={() => selectCalendarDate(cell.key)} onDoubleClick={() => openTimelineDate(cell.key)}>
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
          <aside className="today-month-summary">{monthSelectionPending ? <div className="today-month-selection-prompt" role="status"><strong>选择一天查看安排</strong><span>日期详情会在你选择日期后显示。</span></div> : <><div><h2>{fullDateLabel(selectedDate, today)}</h2><p>{selectedDate} · 中国标准时间</p></div><div className="overview-stats"><div><strong>{taskBlocks.length}</strong><span>任务安排</span></div><div><strong>{recordedCount}</strong><span>已记录</span></div><div><strong>{waitingTasks.length}</strong><span>待安排</span></div></div><button type="button" className="primary-action" onClick={() => openTimelineDate(selectedDate)}>查看日计划</button><small className="today-month-shortcut">也可以双击日期直接打开</small></>}</aside>
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
                <span className="timeline-week-date"><strong>{Number(date.slice(8, 10))}</strong>{lunarLabel && <span>{lunarLabel}</span>}</span>
                <span className="timeline-week-calendar-meta" aria-hidden="true">
                  {primaryCalendarLabel && <span className={`calendar-label ${primaryCalendarLabel.kind}`}>{primaryCalendarLabel.text}</span>}
                </span>
              </button>;
            })}</div>
            {preview && <div className="plan-draft-summary" role="status"><span><Icon name="sparkle" size={14} /><strong>{preview.blocks.length} 项草案安排</strong>{preview.unscheduled.length > 0 && <> · {preview.unscheduled.length} 项未排入</>}</span><small>{isAdjustingConfirmedPlan ? "可调整时间块或重新生成；保存前，原计划不会变化。" : "点击浅蓝虚线时间块可以修改；确认计划前，正式日历不会变化。"}</small></div>}
            <div className="timeline-lanes">
              {untimedRecurringOccurrences.length > 0 && <section className="recurring-occurrence-lane" aria-label="今天的重复事项"><h2>重复事项</h2><div>{untimedRecurringOccurrences.map((item) => {
                const { url, body } = splitTaskNotes(item.notes ?? "");
                return <div key={item.id} className="lane-item recurring" role="note" tabIndex={0} {...timelineTooltipProps({ kind: "重复事项", title: item.title, time: "时间未指定", detail: item.outcome ? `已复盘 · ${item.outcome === "completed" ? "完成" : item.outcome === "partial" ? "部分完成" : "未完成"}` : "待复盘；未设置展示时间", tone: "recurring", url, note: body })}><span className="lane-symbol recurring" aria-hidden="true" /><span className="lane-copy"><strong>{item.title}</strong><small>{item.outcome ? `已复盘 · ${item.outcome === "completed" ? "完成" : item.outcome === "partial" ? "部分完成" : "未完成"}` : "时间未指定 · 待复盘"}</small></span></div>;
              })}</div></section>}
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
                ><TaskCapsuleContent title={item.task_title} notes={item.reason} notesArePlainText priority={task?.priority} timing={task ? taskTimingFact(task, selectedDate) : null} minutes={item.estimated_minutes} status="未排入" sourceType={task?.source_type} compact /><button type="button" className="waiting-task-action" disabled={busy} aria-label={item.estimated_minutes ? `将“${item.task_title}”加入时间线` : `打开“${item.task_title}”并补充预计时长`} onClick={(event) => !item.estimated_minutes ? onOpenTasks(item.task_id) : void includeUnscheduledTask(item, preview, event.currentTarget)}>{actionLabel}</button></div>;
              }) : <span className="timeline-lane-empty">所有任务都已排入草案</span> : waitingTasks.length ? waitingTasks.map((task) => {
                const canInclude = hasConfirmedPlan && !isPastDate;
                const suggestedMinutes = waitingTaskMinutes(task);
                const taskContent = <TaskCapsuleContent title={task.title} notes={task.notes || waitingTaskLabel(task)} notesArePlainText={!task.notes} priority={task.priority} timing={taskTimingFact(task, selectedDate)} minutes={suggestedMinutes} status="待安排" sourceType={task.source_type} compact />;
                const tooltip = timelineTooltipProps({
                  kind: "待安排任务",
                  title: task.title,
                  time: suggestedMinutes ? `建议今天安排 ${suggestedMinutes} 分钟` : "时间待定",
                  detail: waitingTaskTooltipDetail(task, waitingTaskLabel(task)),
                  tone: "task"
                });
                return canInclude ? <div key={task.id} className="lane-item draft-unscheduled" {...tooltip}>
                  <button type="button" className="waiting-task-open" aria-label={`打开任务：${task.title}`} onClick={() => onOpenTasks(task.id)}>{taskContent}</button>
                  <button type="button" className="waiting-task-action" disabled={busy} aria-label={suggestedMinutes ? `将“${task.title}”加入时间线` : `打开“${task.title}”并补充预计时长`} onClick={(event) => void includeWaitingTask(task, event.currentTarget)}>{suggestedMinutes ? "加入时间线" : "补充估时"}</button>
                </div> : <button key={task.id} type="button" className="lane-item task" aria-label={`打开任务：${task.title}，${waitingTaskLabel(task)}`} {...tooltip} onClick={() => onOpenTasks(task.id)}>{taskContent}</button>;
              }) : <span className="timeline-lane-empty">暂无待安排任务</span>}</div></section>
            </div>
            <div ref={timelineScrollRef} className="timeline-scroll" tabIndex={0} aria-label="24 小时时间线" onScroll={handleTimelineScroll} onWheel={pauseTimelineFollowing} onTouchMove={pauseTimelineFollowing} onPointerDown={(event) => { if (event.currentTarget === event.target) pauseTimelineFollowing(); }} onKeyDown={handleTimelineScrollKey}>
              {selectedDate === today && showReturnToNow && <div className="return-to-now-layer"><button type="button" onClick={resumeTimelineFollowing}><Icon name="clock" size={14} />回到现在</button></div>}
              {selection && <div className={`timeline-floating-layer${planDraftTimeEdit ? " is-time-editor" : selectedBlock ? " is-block-editor" : ""}`}><section id="timeline-context-panel" ref={timelineFloatingPanelRef} className={`timeline-floating-panel${planDraftTimeEdit ? " plan-draft-editor" : selectedBlock ? " task-block-editor" : ""}`} role="dialog" aria-modal={planDraftTimeEdit || selectedBlock ? true : undefined} aria-label={planDraftTimeEdit && (selectedDraftBlock || selectedBlock) ? `${selectedDraftBlock?.task_title ?? selectedBlock?.task_title}时间调整` : selectedBlock ? `${selectedBlock.task_title}本次执行记录` : selectedEvent ? `${selectedEvent.title}日程详情` : "时间线详情"} aria-live="polite" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") closeTimelinePanel(); }}>
                {planDraftTimeEdit && (selectedDraftBlock || selectedBlock) ? <>
                  <header><div className="timeline-panel-heading">{planDraftTimeEdit.sourceBlockId && <button type="button" className="timeline-panel-back" aria-label="返回任务块详情" title="返回任务块详情" disabled={busy} onClick={returnToSelectedBlockDetails}><Icon name="chevron-left" size={16} /></button>}<div className="timeline-panel-heading-copy"><strong>调整时间</strong><small>{selectedDraftBlock?.task_title ?? selectedBlock?.task_title}</small></div></div>{(planDraftTimeEdit.starts_at !== planDraftTimeEdit.original_starts_at || planDraftTimeEdit.ends_at !== planDraftTimeEdit.original_ends_at) && <button type="button" className="timeline-time-reset" aria-label="重置为调整前的时间" title="重置为调整前的时间" disabled={busy} onClick={resetPlanDraftTime}><Icon name="restore" size={14} />重置时间</button>}<button type="button" aria-label="关闭时间调整面板" onClick={closeTimelinePanel}><Icon name="close" size={15} /></button></header>
                  <form className="plan-draft-time-form" noValidate onSubmit={(event) => void savePlanDraftTime(event)}>
                    <div className="plan-draft-time-fields"><BlockEditorTimeRangeRail start={planDraftTimeEdit.starts_at} end={planDraftTimeEdit.ends_at} segments={nonWorkingTimeSegments} disabled={busy} describedBy="plan-draft-sync-note" minimumDuration={MIN_TASK_BLOCK_MINUTES} onChange={(next) => setPlanDraftTimeEdit({ ...planDraftTimeEdit, starts_at: next.start, ends_at: next.end, error: "" })} /></div>
                    {planDraftTimeEdit.error && <span className="plan-draft-edit-error" role="alert">{planDraftTimeEdit.error}</span>}
                    <footer><button type="button" className="execution-remove-today" disabled={busy} onClick={() => void removePlanDraftBlock()}><Icon name="trash" size={14} />从今日计划移除</button><div><button type="button" className="quiet-button" disabled={busy} onClick={closeTimelinePanel}>取消</button><button type="submit" className="primary-action" disabled={busy}>{busy ? "正在保存…" : "保存调整"}</button></div></footer>
                  </form>
                </> : selectedBlock ? <><header><div><strong>{selectedBlock.review || selectedBlock.execution_status !== "planned" ? "本次执行详情" : "记录本次执行"}</strong><small>{selectedBlock.task_title}</small></div><button type="button" aria-label="关闭执行面板" disabled={savingExecution} onClick={closeTimelinePanel}><Icon name="close" size={15} /></button></header>
                  <div className="execution-plan-time"><div className="execution-plan-fact"><span>计划时间</span><strong>{timeRangeLabel(selectedBlock.starts_at, selectedBlock.ends_at)}</strong></div><div className="execution-plan-actions"><button type="button" className="execution-open-task" disabled={savingExecution} onClick={() => openTimelineTask(selectedBlock.task_id, selectedBlock.id)}>查看任务</button>{selectedBlock.execution_status === "planned" && !selectedBlock.review && !isPastDate && ["open", "scheduled"].includes(selectedBlock.task_status) && <button type="button" className="execution-adjust-time" disabled={busy || savingExecution} onClick={adjustSelectedBlockTime}>调整时间</button>}</div></div>
                  {selectedBlock.review ? <><div className={`floating-facts execution-${selectedBlock.review.outcome}`}><div><span>本次结果</span><strong>{reviewOutcomeCopy[selectedBlock.review.outcome]}</strong></div><div><span>实际耗时</span><strong>{selectedBlock.review.actual_minutes} 分钟</strong></div><div><span>剩余工作量</span><strong>{selectedBlock.review.remaining_workload_minutes === null ? "未重估" : `${selectedBlock.review.remaining_workload_minutes} 分钟`}</strong></div>{selectedBlock.review.notes && <div className="wide"><span>备注</span><strong>{selectedBlock.review.notes}</strong></div>}{selectedBlock.review.defer_reason && <div className="wide"><span>延期原因</span><strong>{selectedBlock.review.defer_reason}</strong></div>}</div><footer><span role="status">这次复盘已经确认。</span><strong className="context-readonly-state">只读</strong></footer></> : selectedDate !== today ? selectedBlock.execution_status !== "planned" ? <><div className={`floating-capture-fact execution-${selectedBlock.execution_status}`}><span>本次结果</span><strong>{reviewOutcomeCopy[selectedBlock.execution_status]}</strong>{selectedBlock.execution_note && <p>{selectedBlock.execution_note}</p>}</div><div className="floating-readonly"><strong>当日已记录，尚未复盘</strong><span>历史记录保持原样，实际耗时和剩余工作量不会在事后补填。</span></div></> : <div className="floating-readonly"><strong>{isPastDate ? "历史日期只读" : "未来安排暂不可记录"}</strong><span>{isPastDate ? "这项安排当时没有保存执行记录。" : "到执行日期后再记录本次结果。"}</span></div> : executionDraft ? <><ExecutionCaptureFields key={selectedBlock.id} draft={executionDraft} disabled={savingExecution} onChange={updateExecutionDraft} /><span role="status" className={`execution-capture-note${executionMessage ? " error" : ""}`}>{executionMessage || "本次记录会带入每日复盘"}</span><footer className="execution-capture-footer">{selectedBlock.execution_status === "planned" && <button type="button" className="execution-remove-today" disabled={busy || savingExecution} onClick={removeSelectedBlockFromToday}><Icon name="trash" size={14} />从今日计划移除</button>}<div><button type="button" className="quiet-button" disabled={savingExecution} onClick={closeTimelinePanel}>暂不记录</button><button type="button" className="primary-action" disabled={savingExecution || !executionDraft.outcome} onClick={() => void saveSelectedBlockExecution()}>{savingExecution ? "正在保存…" : "保存记录"}</button></div></footer></> : null}
                </> : selectedEvent ? <><header><div><strong>{selectedEvent.title}</strong><small>{selectedEvent.is_all_day ? "全天固定日程" : `${timeRangeLabel(selectedEvent.starts_at, selectedEvent.ends_at)} · 固定日程`}</small></div><button type="button" aria-label="关闭日程详情" onClick={closeTimelinePanel}><Icon name="close" size={15} /></button></header><div className="floating-readonly"><strong>固定日程</strong><span>固定日程不提供完成按钮，也不会限制同一时段安排其他事项。</span></div></> : null}
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
                  const time = `${timeRangeLabel(starts_at, ends_at)} (${timeRangeDurationMinutes(starts_at, ends_at)}m)`;
                  return <div
                    key={item.id}
                    className={`timeline-event recurring-event${item.outcome ? ` reviewed outcome-${item.outcome}` : ""}`}
                    style={timelineEventPosition(starts_at, ends_at, selectedDate, axisStart, pixelsPerHour, timelineItemLanes[layoutKey])}
                    tabIndex={0}
                    {...timelineTooltipProps({ kind: "重复事项", title: item.title, time, detail: item.outcome ? `已复盘 · ${item.outcome === "completed" ? "完成" : item.outcome === "partial" ? "部分完成" : "未完成"}` : "", tone: "recurring", url, note: body }, "block-bottom")}
                  >
                    <span className="timeline-task-leading recurring" aria-hidden="true"><img src={recurringIcon} alt="" /></span>
                    <div className="timeline-task-body">
                      <span className="timeline-task-head"><strong>{item.title}</strong><time>{time}</time></span>
                      {(url || body) && <span className="timeline-task-info">{url && <span className="timeline-task-url">{url}</span>}{url && body && <span className="timeline-task-divider" />}{body && <span className="timeline-task-note">{body}</span>}</span>}
                    </div>
                  </div>;
                })}
                {draftBlocks.map((block, index) => <button
                  key={draftLayoutKeys[index]}
                  type="button"
                  data-timeline-kind="draft"
                  data-timeline-id={String(index)}
                  className={`timeline-event plan-draft-block${shortTaskBlockClass(block.starts_at, block.ends_at)}${selection?.kind === "draft" && selection.id === String(index) ? " selected" : ""}`}
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
                  const { url, body } = splitTaskNotes(tasks.find((task) => task.id === block.task_id)?.notes ?? "");
                  const time = `${timeRangeLabel(block.starts_at, block.ends_at)} (${timeRangeDurationMinutes(block.starts_at, block.ends_at)}m)`;
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
                    data-timeline-kind="block"
                    data-timeline-id={block.id}
                    className={`timeline-event execution-block${shortTaskBlockClass(block.starts_at, block.ends_at)}${effectiveOutcome ? ` ${block.review ? "reviewed" : "captured"} execution-${effectiveOutcome}` : ""}${selection?.kind === "block" && selection.id === block.id ? " selected" : ""}`}
                    style={timelineEventPosition(block.starts_at, block.ends_at, selectedDate, axisStart, pixelsPerHour, timelineItemLanes[`block:${block.id}`])}
                    onClick={(event) => {
                      const target = event.target;
                      if (target instanceof Element && target.closest(".timeline-event-check")) return;
                      const trigger = event.currentTarget.querySelector<HTMLElement>(".timeline-event-body") ?? event.currentTarget;
                      selectTimelineItem({ kind: "block", id: block.id }, trigger, event.currentTarget);
                    }}
                    {...timelineTooltipProps({
                      kind: "普通任务",
                      title: block.task_title,
                      time,
                      detail: block.review
                        ? `本次${reviewOutcomeCopy[block.review.outcome]} · 已复盘 · 实际 ${block.review.actual_minutes} 分钟`
                        : effectiveOutcome ? `本次${reviewOutcomeCopy[effectiveOutcome]} · 等待每日复盘` : "",
                      tone: "task",
                      url,
                      note: body
                    }, "block-top")}
                  >
                    <button type="button" className={`timeline-event-check${blockCompleted ? " done" : ""}${blockHasFact && !blockCompleted ? " recorded" : ""}${blockIsSaving ? " saving" : ""}`} aria-label={block.review ? `${block.task_title}已完成每日复盘，不能取消完成` : blockCompleted ? `取消完成：${block.task_title}` : quickCompleteLabel} aria-pressed={blockCompleted} disabled={Boolean(block.review) || blockHasFact && !blockCompleted || blockIsSaving || selectedDate !== today} onClick={(event) => { event.stopPropagation(); void (blockCompleted ? clearQuickCompletedTimelineBlock(block) : quickCompleteTimelineBlock(block)); }}>{blockIsSaving ? <span className="timeline-check-spinner" /> : blockCompleted ? <Icon name="check" size={11} /> : null}</button>
                    <button type="button" className="timeline-event-body timeline-task-body" aria-label={`打开本次执行：${block.task_title}`} aria-haspopup="dialog" aria-controls="timeline-context-panel" aria-pressed={selection?.kind === "block" && selection.id === block.id}>
                      <span className="timeline-task-head"><strong>{block.task_title}</strong><time>{time}</time></span>
                      {(url || body) && <span className="timeline-task-info">{url && <span className="timeline-task-url">{url}</span>}{url && body && <span className="timeline-task-divider" />}{body && <span className="timeline-task-note">{body}</span>}</span>}
                    </button>
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
          className={`timeline-hover-card tone-${timelineTooltip.tone} placement-${timelineTooltip.placement}${timelineTooltip.kind === "普通任务" || timelineTooltip.kind === "重复事项" ? " task-type-hover" : ""}`}
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
      setError(uiErrorMessage(reason));
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
      setMessages((current) => ({ ...current, [blockId]: "历史日期只展示当时保存的执行和复盘记录。" }));
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
    setMessages((current) => ({ ...current, [blockId]: "正在保存…" }));
    try {
      await saveReviewEntry(reviewDate, input);
      await loadReviewSchedule(reviewDate);
      onFactsChanged(reviewDate);
      setMessages((current) => ({ ...current, [blockId]: "这次复盘已保存。" }));
    } catch (reason) {
      setMessages((current) => ({ ...current, [blockId]: `未保存：${uiErrorMessage(reason)}` }));
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
      setMessages((current) => ({ ...current, [blockId]: "整个任务已完成；原有执行和复盘记录仍会保留。" }));
    } catch (reason) {
      setMessages((current) => ({ ...current, [blockId]: `任务未完成：${uiErrorMessage(reason)}` }));
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
      setMessages((current) => ({ ...current, [occurrenceId]: "这次结果已保存。" }));
    } catch (reason) {
      setMessages((current) => ({ ...current, [occurrenceId]: `未保存：${uiErrorMessage(reason)}` }));
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
    <header className="review-context-bar"><div className="review-context-copy"><h1>{fullDateLabel(reviewDate, today)}</h1><span>{isToday ? "今天的记录可以逐条保存" : "这里只显示当时保存的计划和记录"}</span></div><div className="review-date-controls"><button type="button" aria-label="前一天" title="前一天" onClick={() => setReviewDate(previousDate)}><Icon name="chevron-left" size={15} /></button><input type="date" max={today} aria-label="复盘日期" value={reviewDate} onChange={(event) => event.target.value && setReviewDate(event.target.value)} /><button type="button" aria-label="后一天" title="后一天" disabled={nextDate > today} onClick={() => setReviewDate(nextDate)}><Icon name="chevron-right" size={15} /></button><button type="button" className="review-today" disabled={isToday} onClick={() => setReviewDate(today)}>今天</button></div></header>
    <div className="review-summary"><div><strong>{blocks.length}</strong><span>任务安排</span></div><div><strong>{recurringOccurrences.length}</strong><span>重复事项</span></div><div><strong>{savedCount + recurringSavedCount}</strong><span>已保存</span></div><p>任务安排与重复事项分别记录，不会互相影响。</p></div>
    {!loading && !error && recurringOccurrences.length > 0 && <section className="recurring-review-section" aria-labelledby="recurring-review-title"><header><div><h2 id="recurring-review-title">重复事项</h2><p>直接记录今天这一次，不提供“跳过本次”。</p></div><span>{recurringSavedCount}/{recurringOccurrences.length} 已处理</span></header><div className="review-ledger recurring-review-ledger">{recurringOccurrences.map((item) => { const draft = recurringDrafts[item.id]; const busy = savingBlockId === item.id; return <article key={item.id} className={item.outcome ? "review-saved" : ""}><header><div><strong>{item.title}</strong><span>{item.display_time && item.display_duration_minutes ? `${item.display_time} · ${item.display_duration_minutes} 分钟 · 时间展示` : "时间未指定"}</span></div><span>{item.outcome ? "复盘已确认" : "待复盘"}</span></header>{item.outcome ? <><div className="review-facts"><div><span>本次结果</span><strong>{item.outcome === "completed" ? "完成" : item.outcome === "partial" ? "部分完成" : "未完成"}</strong></div>{item.review_notes && <div className="review-fact-wide"><span>复盘备注</span><strong>{item.review_notes}</strong></div>}</div><div className="review-actions"><span role="status">结果已保存，重复安排会继续。</span></div></> : draft ? <><div className="recurring-outcome-picker" role="group" aria-label={`${item.title}本次结果`}>{([['completed','完成'],['partial','部分完成'],['not_completed','未完成']] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={draft.outcome === value} disabled={busy} onClick={() => setRecurringDrafts((current) => ({ ...current, [item.id]: { ...draft, outcome: value } }))}>{label}</button>)}</div><label className="recurring-review-notes">复盘备注<textarea rows={2} maxLength={2000} value={draft.notes} placeholder="可选，记录今天这一次" disabled={busy} onChange={(event) => setRecurringDrafts((current) => ({ ...current, [item.id]: { ...draft, notes: event.target.value } }))} /></label><div className="review-actions"><span role="status">{messages[item.id] || "确认后只保存今天这一次的结果。"}</span><button type="button" disabled={busy || !draft.outcome} onClick={() => void saveRecurringReview(item.id)}>{busy ? "正在保存…" : "确认本次复盘"}</button></div></> : <div className="review-history-readonly"><strong>历史日期只读</strong><span>这一次没有保存复盘结果。</span></div>}</article>; })}</div></section>}
    {loading ? <div className="review-empty compact"><Icon name="clock" size={24} /><h2>正在载入这一天的记录</h2><p>稍等一下，今序正在整理已保存的安排和复盘。</p></div> : error ? <div className="review-empty compact error"><Icon name="review" size={26} /><h2>这一天的记录暂时无法打开</h2><p>{error}</p><button type="button" className="quiet-button" onClick={() => void loadReviewSchedule(reviewDate)}>重试</button></div> : blocks.length ? <div className="review-ledger">{blocks.map((block) => {
      const draft = drafts[block.id];
      const saved = block.review;
      const busy = savingBlockId === block.id;
      const canCompleteTask = isToday && saved && !["done", "deleted"].includes(block.task_status);
      const capturedOutcome = !saved && block.execution_status !== "planned" ? block.execution_status : null;
      const captured = capturedOutcome !== null;
      const reviewTone = saved?.outcome ?? capturedOutcome;
      return <article key={block.id} className={`${saved ? "review-saved" : captured ? "review-captured" : ""}${reviewTone ? ` execution-${reviewTone}` : ""}`.trim()}>
        <header><div><strong>{block.task_title}</strong><span>{timeRangeLabel(block.starts_at, block.ends_at)} · 原计划 {durationLabel(block.starts_at, block.ends_at)}</span></div><span>{saved ? "复盘已确认" : captured ? "已记录 · 待复盘" : "待复盘"}</span></header>
        {saved ? <>
          <div className="review-facts" aria-label={`${block.task_title}已保存的复盘`}><div><span>执行结果</span><strong>{reviewOutcomeCopy[saved.outcome]}</strong></div><div><span>实际耗时</span><strong>{saved.actual_minutes} 分钟</strong></div><div><span>剩余工作量</span><strong>{saved.remaining_workload_minutes === null ? "未重估" : `${saved.remaining_workload_minutes} 分钟`}</strong></div>{saved.defer_reason && <div className="review-fact-wide"><span>延期原因</span><strong>{saved.defer_reason}</strong></div>}{saved.notes && <div className="review-fact-wide"><span>复盘备注</span><strong>{saved.notes}</strong></div>}</div>
          <div className="review-actions"><span role="status">{messages[block.id] || `已保存 · ${saved.created_at.slice(0, 10)}`}</span></div>
          <div className="review-task-followup"><div><strong>任务后续</strong><span>这里决定整件任务是否还需要继续，不会改变上面的复盘记录。</span></div>{block.task_status === "done" ? <strong className="task-complete-state"><Icon name="check" size={14} />整个任务已完成</strong> : canCompleteTask ? <button type="button" className="complete-task-action" disabled={completingTaskId === block.task_id} onClick={() => setPendingTaskCompletion({ taskId: block.task_id, taskTitle: block.task_title, blockId: block.id })}>{completingTaskId === block.task_id ? "正在完成任务…" : "完成整个任务"}</button> : null}</div>
        </> : draft ? <>
          {capturedOutcome && <div className="review-capture-note"><Icon name="check" size={14} /><span>已从时间线带入“本次{reviewOutcomeCopy[capturedOutcome]}”{block.execution_note ? "和简短备注" : ""}，请核对后确认。</span></div>}
          <ExecutionOutcomePicker label={`${block.task_title}本次执行结果`} result={draft.result} outcome={draft.outcome} disabled={busy} onChange={(result, outcome) => updateDraft(block.id, { result, outcome })} />
          <div className="review-fields"><label>实际耗时<input type="number" min="0" step="1" placeholder="必填" value={draft.actual_minutes} disabled={busy} onChange={(event) => updateDraft(block.id, { actual_minutes: event.target.value })} /><span>分钟</span></label><label>剩余工作量<input type="number" min="0" step="1" placeholder="不重估" value={draft.remaining_workload_minutes} disabled={busy} onChange={(event) => updateDraft(block.id, { remaining_workload_minutes: event.target.value })} /><span>分钟</span></label><label className="review-wide">延期原因<input maxLength={500} placeholder="可选，记录推迟或受阻原因" value={draft.defer_reason} disabled={busy} onChange={(event) => updateDraft(block.id, { defer_reason: event.target.value })} /></label><label className="review-wide">复盘备注<textarea rows={2} maxLength={2000} placeholder="可选，核对或补充这次记录" value={draft.notes} disabled={busy} onChange={(event) => updateDraft(block.id, { notes: event.target.value })} /></label></div>
          <div className="review-actions"><span role="status" className={messages[block.id]?.startsWith("未保存") ? "error" : ""}>{messages[block.id] || "核对后保存今天的复盘。"}</span><button type="button" disabled={busy} onClick={() => void saveBlockReview(block.id)}>{busy ? "正在保存…" : "确认本次复盘"}</button></div>
        </> : capturedOutcome ? <div className={`review-history-readonly has-capture execution-${capturedOutcome}`}><strong>本次{reviewOutcomeCopy[capturedOutcome]} · 未完成复盘</strong><span>{block.execution_note || "当天记录了执行结果，但还没有填写实际耗时和剩余工作量。"}</span></div> : <div className="review-history-readonly"><strong>历史日期只读</strong><span>这项安排当时没有执行或复盘记录。</span></div>}
      </article>;
    })}</div> : recurringOccurrences.length ? <div className="review-no-task-blocks"><Icon name="check" size={16} /><span>今天没有任务安排，重复事项可以直接在上方处理。</span></div> : <div className="review-empty"><Icon name="review" size={28} /><h2>{isToday ? "今天没有需要复盘的内容" : "这一天没有复盘内容"}</h2><p>{isToday ? "日计划中的任务安排或到期的重复事项会出现在这里。" : "这里只显示当时保存的计划和复盘记录。"}</p></div>}
    <footer className="review-page-footer"><span><Icon name="check" size={14} />保存后会立即更新；实际耗时不会改变原计划时间。</span></footer>
    {pendingTaskCompletion && <div className="dialog-backdrop task-completion-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !completingTaskId) setPendingTaskCompletion(null); }}><section className="unsaved-dialog task-completion-dialog" role="alertdialog" aria-modal="true" aria-labelledby="review-task-completion-title" aria-describedby="review-task-completion-description" onKeyDown={(event) => { if (event.key === "Escape" && !completingTaskId) setPendingTaskCompletion(null); }}><div className="dialog-icon completion"><Icon name="check" size={19} /></div><h2 id="review-task-completion-title">确认完成整个任务？</h2><p id="review-task-completion-description">“{pendingTaskCompletion.taskTitle}”以后将不再进入计划；今天的复盘记录会继续保留。</p><div className="dialog-actions"><button type="button" autoFocus disabled={Boolean(completingTaskId)} onClick={() => setPendingTaskCompletion(null)}>取消</button><button type="button" className="dialog-save" disabled={Boolean(completingTaskId)} onClick={() => void completeWholeTask(pendingTaskCompletion.taskId, pendingTaskCompletion.blockId)}>{completingTaskId ? "正在完成…" : "确认完成任务"}</button></div></section></div>}
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
  const availabilityState = saving ? "正在保存" : availability ? "已加载" : availabilityError ? "暂时不可用" : "正在加载";
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
    }).catch((reason) => { if (active) setAiMessage(uiErrorMessage(reason)); });
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
    setSaveMessage("正在保存工作时间…");
    try {
      const saved = await saveAvailabilitySettings(draft);
      setDraft(saved);
      setSaveMessage("日计划偏好已保存。");
      onSaved(saved);
      onNotify("日计划偏好已保存", "工作日和工作时间已更新，只用于安排建议和时间线显示。", "check");
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
    setAiMessage("正在保存 AI 连接…");
    try {
      const saved = await saveAiConnectionSettings({ ...aiForm, api_key: aiKey.trim() || null });
      setAiSettings(saved);
      setAiForm({ api_type: saved.api_type, endpoint: saved.endpoint, model: saved.model });
      setAiKey("");
      setAiMessage("AI 连接已保存。可以先测试连接，测试时不会发送任务内容。");
      onNotify("AI 连接已保存", "接口类型、连接地址和访问密钥已保存在这台电脑上。", "check");
    } catch (reason) {
      const message = uiErrorMessage(reason);
      setAiMessage(message);
      onNotify("AI 连接未保存", message, "review");
    } finally { setAiBusy(false); }
  }

  async function testConnection() {
    if (aiBusy) return;
    if (aiDirty) {
      setAiMessage("请先保存当前连接设置，再测试连接。");
      return;
    }
    setAiBusy(true);
    setAiMessage("正在测试连接；不会发送任务或对话内容…");
    try {
      const result = await testAiConnection();
      setAiMessage(`连接成功：${result}`);
      onNotify("AI 连接可用", "最小连接测试已通过。", "check");
    } catch (reason) {
      const message = uiErrorMessage(reason);
      setAiMessage(message);
      onNotify("AI 连接测试失败", message, "review");
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
      <section id="ai"><header><div><h2>AI 连接</h2><p>模型只接收当前对话所需的最小内容。</p></div><span className={`setting-state${aiSettings?.api_key_configured ? " connected" : ""}`}>{aiSettings?.api_key_configured ? "已配置" : "未配置"}</span></header><form className="ai-connection-form" onSubmit={(event) => void submitAiConnection(event)}>
        <label>接口类型<select value={aiForm.api_type} disabled={aiBusy} onChange={(event) => { setAiForm({ ...aiForm, api_type: event.target.value as "chat_completions" | "responses" }); setAiMessage(""); }}><option value="chat_completions">Chat Completions（兼容接口）</option><option value="responses">Responses（兼容接口）</option></select></label>
        <label>连接地址<input value={aiForm.endpoint} disabled={aiBusy} placeholder="https://api.openai.com/v1" onChange={(event) => { setAiForm({ ...aiForm, endpoint: event.target.value }); setAiMessage(""); }} /></label>
        <label>模型<input value={aiForm.model} disabled={aiBusy} placeholder="gpt-5-mini" onChange={(event) => { setAiForm({ ...aiForm, model: event.target.value }); setAiMessage(""); }} /></label>
        <label>访问密钥（API Key）<input type="password" autoComplete="off" value={aiKey} disabled={aiBusy} placeholder={aiSettings?.api_key_configured ? "已保存；留空表示不更换" : "请输入访问密钥"} onChange={(event) => { setAiKey(event.target.value); setAiMessage(""); }} /></label>
        <div className="ai-connection-actions"><span role="status">{aiMessage || "测试连接只发送测试请求，不会包含任务或对话内容。"}</span><div><button type="button" className="quiet-button" disabled={aiBusy || !aiSettings?.api_key_configured || aiDirty} onClick={() => void testConnection()}>测试连接</button><button type="submit" disabled={aiBusy || !aiDirty}>{aiBusy ? "处理中…" : "保存连接"}</button></div></div>
      </form><p className="risk-note">访问密钥会保存在这台电脑上，目前未加密。问题报告、日志和导出不会显示密钥；请妥善保管今序的数据文件。</p></section>
      <section id="work" className="availability-settings-section"><header><div><h2>工作时间偏好</h2><p>用于自动安排的优先起点和时间线参照，不限制手动安排。</p></div><span className={`setting-state${availability ? " connected" : ""}`}>{availabilityState}</span></header>
        {availabilityError && !draft ? <div className="setting-load-error"><strong>日计划偏好暂时无法打开</strong><span>{availabilityError}</span><button type="button" className="quiet-button" onClick={onReload}>重试</button></div> : draft ? <form className="setting-availability-form" onSubmit={(event) => void submitAvailability(event)}>
          <fieldset className="setting-weekdays"><legend>工作日</legend><div>{["一", "二", "三", "四", "五", "六", "日"].map((label, index) => <button key={label} type="button" aria-pressed={draft.weekdays.includes(index + 1)} disabled={saving} onClick={() => toggleWorkday(index + 1)}>周{label}</button>)}</div><small>未选中的日期会使用更浅的网格背景；仍可安排事项。</small></fieldset>
          <div className="setting-time-group"><div className="setting-time-heading"><div><h3>每日工作时间</h3><p>自动安排会优先从这段时间开始；其他时段同样可以安排。</p></div><strong>{draft.workday_start} – {draft.workday_end}</strong></div><TimeRangeRail start={draft.workday_start} end={draft.workday_end} startLabel="开始工作" endLabel="结束工作" disabled={saving} onChange={updateWorkdayRange} /></div>
          {(availabilityDirty || saving) && <footer className="setting-save-bar" aria-label="未保存的更改"><strong role="status" className={saveMessage && !saveMessage.includes("已保存") && !saveMessage.includes("正在") ? "error" : ""}>{saving ? "正在保存到本机…" : draft.weekdays.length === 0 ? "至少选择一个工作日后才能保存。" : saveMessage || "有未保存的更改"}</strong><div className="draft-bar-actions"><button type="button" className="draft-reset" disabled={saving} onClick={() => { setDraft(availability); setSaveMessage(""); }}>撤销</button><button type="submit" className="draft-save" disabled={saving || draft.weekdays.length === 0}>{saving ? "保存中…" : "保存更改"}</button></div></footer>}
        </form> : <div className="setting-loading"><span className="loader dark" />正在载入日计划偏好…</div>}
      </section>
      <section id="reminder"><header><div><h2>提醒</h2><p>提醒只会通知你，不会自动使用 AI。</p></div><button type="button" className="quiet-button" onClick={() => void sendTestNotification().then(() => setPreferenceMessage("测试通知已发送。")).catch((reason) => setPreferenceMessage(uiErrorMessage(reason)))}>发送测试通知</button></header><div className="setting-row"><div><strong>晨间计划</strong><span>每日首次达到设定时间后提醒一次</span></div><div className="setting-inline-controls"><input type="time" value={reminders.morningTime} disabled={!reminders.morning} onChange={(event) => setReminders({ ...reminders, morningTime: event.target.value })} /><button type="button" role="switch" aria-checked={reminders.morning} className={`switch-control${reminders.morning ? " enabled" : ""}`} onClick={() => setReminders({ ...reminders, morning: !reminders.morning })}><span /></button></div></div><div className="setting-row"><div><strong>晚间复盘</strong><span>每日首次达到设定时间后提醒一次</span></div><div className="setting-inline-controls"><input type="time" value={reminders.eveningTime} disabled={!reminders.evening} onChange={(event) => setReminders({ ...reminders, eveningTime: event.target.value })} /><button type="button" role="switch" aria-checked={reminders.evening} className={`switch-control${reminders.evening ? " enabled" : ""}`} onClick={() => setReminders({ ...reminders, evening: !reminders.evening })}><span /></button></div></div><label className="setting-buffer">任务块开始前提醒<span><input type="number" min={0} max={60} step={5} value={reminders.taskLead} onChange={(event) => setReminders({ ...reminders, taskLead: Number(event.target.value) })} />分钟</span></label></section>
      <section id="appearance"><header><div><h2>外观</h2><p>主题会即时预览，保存后随应用启动恢复。</p></div><span className="setting-state connected">可配置</span></header><div className="theme-options">{[["default", "默认"], ["github", "GitHub"], ["codex", "Codex"]].map(([value, label]) => <button key={value} type="button" aria-pressed={appearance.theme === value} onClick={() => previewAppearance({ ...appearance, theme: value })}><span className={`theme-swatch ${value}`} />{label}</button>)}</div><div className="setting-row"><div><strong>明暗模式</strong><span>暗色模式保持低饱和、账本式层级</span></div><select value={appearance.mode} onChange={(event) => previewAppearance({ ...appearance, mode: event.target.value })}><option value="light">浅色</option><option value="dark">深色</option></select></div><label className="setting-buffer">界面字号<span><input type="range" min={13} max={18} value={appearance.fontSize} onChange={(event) => previewAppearance({ ...appearance, fontSize: Number(event.target.value) })} />{appearance.fontSize}</span></label></section>
      <section id="desktop"><header><div><h2>Windows 集成</h2><p>快捷唤起、开机启动和关闭到托盘。</p></div><span className="setting-state connected">已接入</span></header><div className="setting-row"><div><strong>开机启动</strong><span>登录 Windows 后自动启动今序</span></div><button type="button" role="switch" aria-checked={desktop.autostart} className={`switch-control${desktop.autostart ? " enabled" : ""}`} onClick={() => setDesktop({ ...desktop, autostart: !desktop.autostart })}><span /></button></div><div className="setting-row"><div><strong>关闭到托盘</strong><span>窗口关闭后仍在后台提供提醒</span></div><button type="button" role="switch" aria-checked={desktop.closeToTray} className={`switch-control${desktop.closeToTray ? " enabled" : ""}`} onClick={() => setDesktop({ ...desktop, closeToTray: !desktop.closeToTray })}><span /></button></div><label className="setting-buffer">全局快捷键<span><input value={desktop.shortcut} maxLength={80} onChange={(event) => setDesktop({ ...desktop, shortcut: event.target.value })} /></span><small>例如 Ctrl+Alt+Space；若已被其他应用占用，保存时会提示。</small></label></section>
      <section id="privacy"><header><div><h2>数据与隐私</h2><p>任务、草稿、计划和历史都保存在这台电脑上。</p></div><span className="setting-state connected">仅存本机</span></header><div className="setting-row"><div><strong>本地数据</strong><span>由今序保存在这台电脑上；当前版本未加密</span></div></div><div className="setting-row"><div><strong>回收站</strong><span>普通任务和重复事项移入回收站后默认保留 30 天，过期内容会在启动时清理</span></div></div></section>
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
      .catch((reason) => { if (active) setNotice(uiErrorMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open || !selectorOpen) return;
    const timer = window.setTimeout(() => {
      void refreshConversations(conversationId, showArchived, search).catch((reason) => setNotice(uiErrorMessage(reason)));
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
    } catch (reason) { setNotice(uiErrorMessage(reason)); }
  }

  async function renameCurrent() {
    if (!currentConversation || renameValue === null) return;
    try {
      await renameAiConversation(currentConversation.id, renameValue);
      setRenameValue(null);
      await refreshConversations(currentConversation.id);
    } catch (reason) { setNotice(uiErrorMessage(reason)); }
  }

  async function toggleCurrentArchive() {
    if (!currentConversation || runId) return;
    try {
      const archived = currentConversation.status !== "archived";
      await setAiConversationArchived(currentConversation.id, archived);
      setNotice(archived ? "对话已归档；关联草稿仍然保留。" : "对话已恢复。 ");
      await refreshConversations(null);
    } catch (reason) { setNotice(uiErrorMessage(reason)); }
  }

  async function deleteCurrentConversation() {
    if (!currentConversation || runId) return;
    try {
      await permanentlyDeleteAiConversation(currentConversation.id, true);
      setPendingConversationDelete(false);
      setNotice("对话已永久删除。");
      await refreshConversations(null);
    } catch (reason) { setNotice(uiErrorMessage(reason)); }
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
        setNotice(result.drafts.length ? `已生成 ${result.drafts.length} 条待确认草稿；确认前不会成为正式任务。` : result.proposal ? "已准备一项待确认操作；确认前不会改变任务或日计划。" : "这次回复没有生成草稿，你可以继续补充信息。");
      } catch (reason) {
        setMessages(await listAiMessages(activeId));
        setNotice(uiErrorMessage(reason));
      } finally { setRunId(null); }
    } catch (reason) { setRunId(null); setNotice(uiErrorMessage(reason)); }
  }

  async function stopAnalysis() {
    if (!runId) return;
    const stoppingId = runId;
    setRunId(null);
    try {
      await stopAiRun(stoppingId);
      setNotice("分析已停止；本次未完成的结果不会保留。");
    } catch (reason) { setNotice(uiErrorMessage(reason)); }
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
      setNotice(preview.proposal.operation.type === "proposed_plan" ? "日计划已确认并保存。" : preview.proposal.operation.type === "proposed_task_soft_delete" ? "所选任务已移入回收站。" : "任务已确认完成。");
    } catch (reason) { setNotice(`操作没有完成：${uiErrorMessage(reason)}`); }
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
      <header><div><span className="assistant-avatar"><Icon name="sparkle" size={18} /></span><div className="assistant-title-control"><button type="button" className="assistant-title-button" aria-expanded={selectorOpen} onClick={() => setSelectorOpen((value) => !value)}><strong>{currentConversation?.title || "新对话"}</strong><span>{runId ? "正在分析" : "今序助手 · 对话仅存本机"}</span></button></div></div><button type="button" aria-label="收起 AI 助手" onClick={onToggle}><Icon name="close" size={17} /></button></header>
      {selectorOpen && <div className="assistant-conversation-picker"><div className="assistant-picker-search"><Icon name="search" size={14} /><input autoFocus value={search} placeholder="搜索本地对话" onChange={(event) => setSearch(event.target.value)} /></div><div className="assistant-picker-toolbar"><button type="button" onClick={() => void newConversation()}><Icon name="plus" size={13} />新建</button><button type="button" aria-pressed={showArchived} onClick={() => setShowArchived((value) => !value)}>{showArchived ? "隐藏归档" : "查看归档"}</button></div><div className="assistant-picker-list">{conversationGroups.length ? conversationGroups.map((group) => <section className="assistant-conversation-group" key={group.label} aria-label={group.label}><strong>{group.label}</strong>{group.items.map((conversation) => <div key={conversation.id} className={conversation.id === conversationId ? "active" : ""}><button type="button" onClick={() => void selectConversation(conversation.id)}><span>{conversation.title}</span><small>{conversation.status === "archived" ? "已归档" : `${conversation.message_count} 条消息`}{conversation.draft_count ? ` · ${conversation.draft_count} 条草稿` : ""}</small></button>{conversation.id === conversationId && <Icon name="check" size={14} />}</div>)}</section>) : <p>没有匹配的本地对话。</p>}</div></div>}
      {currentConversation && <div className="assistant-conversation-actions">{renameValue === null ? <><button type="button" onClick={() => setRenameValue(currentConversation.title)}>重命名</button><button type="button" disabled={Boolean(runId)} onClick={() => void toggleCurrentArchive()}>{currentConversation.status === "archived" ? "恢复" : "归档"}</button>{currentConversation.status === "archived" && <button type="button" className="assistant-delete-conversation" disabled={Boolean(runId)} onClick={() => setPendingConversationDelete(true)}>永久删除</button>}{currentConversation.draft_count > 0 && <button type="button" className="assistant-view-drafts" onClick={() => onNavigate("草稿")}>查看草稿 · {currentConversation.draft_count}</button>}</> : <><input value={renameValue} maxLength={80} aria-label="新对话名称" onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameCurrent(); if (event.key === "Escape") setRenameValue(null); }} /><button type="button" onClick={() => void renameCurrent()}>保存名称</button><button type="button" onClick={() => setRenameValue(null)}>取消</button></>}</div>}
      <div className="assistant-conversation" aria-live="polite">{loading ? <div className="assistant-processing"><span className="processing-dot" />正在载入对话…</div> : messages.length ? <div className="assistant-message-list">{messages.map((message) => <article key={message.id} className={`assistant-message ${message.role}`}><span>{message.role === "user" ? "你" : "今序"}</span><p>{message.content}</p></article>)}{proposals.map((proposal) => <article className="assistant-proposal" key={proposal.ai_run_id}><span>待确认操作</span><strong>{proposalLabel(proposal)}</strong><small>确认后才会更改任务或日计划；如果内容已经变化，今序会请你重新确认。</small><button type="button" disabled={Boolean(runId)} onClick={() => void confirmProposal(proposal)}>确认操作</button></article>)}{runId && <div className="assistant-processing"><span className="processing-dot" />正在整理草稿…</div>}</div> : <div className="assistant-welcome"><strong>想从哪里开始？</strong><p>我会通过当前对话整理草稿。所有关键改动仍要由你逐条确认。</p><div className="assistant-shortcuts"><button type="button" onClick={() => setInput("帮我整理一项新任务：")}><Icon name="plus" size={15} />创建任务</button><button type="button" onClick={() => setInput("帮我梳理接下来要调整的任务：")}><Icon name="tasks" size={15} />调整任务</button><button type="button" onClick={() => setInput("请为今天安排日计划：")}><Icon name="calendar" size={15} />安排计划</button></div></div>}{notice && <p className="assistant-notice" role="status">{notice}{!configured && <button type="button" onClick={() => onNavigate("设置")}>前往设置</button>}</p>}</div>
      <form onSubmit={(event) => void submitMessage(event)}><textarea value={input} maxLength={8000} disabled={Boolean(runId) || currentConversation?.status === "archived"} onChange={(event) => setInput(event.target.value)} placeholder={currentConversation?.status === "archived" ? "恢复对话后才能继续" : "说说你想完成什么…"} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><div><span>{runId ? "停止后，本次未完成的结果不会保留" : "确认前不会成为正式任务"}</span>{runId ? <button type="button" className="assistant-stop" aria-label="停止分析" title="停止分析" onClick={() => void stopAnalysis()}><Icon name="close" size={15} /></button> : <button type="submit" aria-label="发送消息" disabled={!input.trim() || currentConversation?.status === "archived"}><Icon name="send" size={16} /></button>}</div></form>
    </section>}
    {open && pendingConversationDelete && currentConversation && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingConversationDelete(false); }}><section className="unsaved-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-conversation-title"><h2 id="delete-conversation-title">永久删除对话？</h2><p>“{currentConversation.title}”的本地消息历史将无法恢复；有关联草稿时系统会拒绝删除。</p><div className="dialog-actions"><button type="button" autoFocus onClick={() => setPendingConversationDelete(false)}>取消</button><button type="button" className="dialog-discard" onClick={() => void deleteCurrentConversation()}>永久删除</button></div></section></div>}
    {open && pendingDestructiveProposal && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingDestructiveProposal(null); }}><section className="unsaved-dialog task-trash-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ai-delete-title"><div className="dialog-icon trash"><Icon name="trash" size={19} /></div><h2 id="ai-delete-title">确认移入回收站？</h2><p>今序建议将 {pendingDestructiveProposal.proposal.operation.type === "proposed_task_soft_delete" && "task_ids" in pendingDestructiveProposal.proposal.operation ? pendingDestructiveProposal.proposal.operation.task_ids.length : 0} 项任务移入回收站。它们不会再被安排，但仍可恢复。</p><div className="dialog-actions"><button type="button" autoFocus onClick={() => setPendingDestructiveProposal(null)}>取消</button><button type="button" className="dialog-discard" onClick={() => void confirmProposal(pendingDestructiveProposal, true)}>确认移入回收站</button></div></section></div>}
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
  const [timelineReturnContext, setTimelineReturnContext] = useState<TimelineReturnContext | null>(null);
  const shellRef = useRef<HTMLElement>(null);
  const shellResizeSession = useRef<ShellResizeSession | null>(null);
  const shellResizeFrame = useRef<number | null>(null);
  const sidebarCollapseTimer = useRef<number | null>(null);
  const sidebarWidthRef = useRef(SHELL_SIDEBAR_DEFAULT_WIDTH);
  const [sidebarWidth, setSidebarWidth] = useState(SHELL_SIDEBAR_DEFAULT_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarAnimating, setSidebarAnimating] = useState(false);
  const [resizingShell, setResizingShell] = useState(false);
  const activeTasks = tasks.filter((task) => ["open", "scheduled"].includes(task.status));
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
      setDaySchedule(schedule);
      setPlanPreview(draft);
      setRecurringOccurrences(occurrences);
    }
    catch (reason) { setDaySchedule(null); setRecurringOccurrences([]); setScheduleError(uiErrorMessage(reason)); }
    finally { if (showLoading) setScheduleLoading(false); }
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
    setPlanPreview(null);
    setPlanRegenerationOpen(false);
    setPlanToast(null);
    setMessage("");
    void Promise.all([refreshTasks(false), refreshSchedule(selectedDate)]);
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
    const regeneratingConfirmedPlan = Boolean(daySchedule?.plan_id);
    if ((planPreview || regeneratingConfirmedPlan) && !replaceCurrent) {
      setPlanRegenerationOpen(true);
      return;
    }
    setPlanRegenerationOpen(false);
    setPlanBusy(true);
    setPlanToast(null);
    try {
      const preview = regeneratingConfirmedPlan
        ? await regenerateConfirmedPlanAdjustment(selectedDate)
        : await previewRuleBasedPlan(selectedDate);
      if (preview.blocks.length === 0 && preview.unscheduled.length === 0) {
        await discardRulePlanDraft(preview.preview_id, preview.version);
        setPlanPreview(null);
        if (regeneratingConfirmedPlan) await refreshTasks(false);
        setMessage("");
        setPlanToast({ id: Date.now(), label: regeneratingConfirmedPlan ? "没有需要重新安排的任务" : "未生成计划", message: "暂无待安排任务", icon: "calendar" });
        return;
      }
      setPlanPreview(preview);
      if (regeneratingConfirmedPlan) await refreshTasks(false);
      setMessage(preview.blocks.length ? "" : "没有生成可保存时间块，请检查未排入原因、任务截止时间和可用时间。");
    } catch (reason) { setMessage(`计划草案未生成：${uiErrorMessage(reason)}`); }
    finally { setPlanBusy(false); }
  }

  async function updatePlanDraft(nextPreview: RulePlanPreview) {
    if (planBusy) return nextPreview;
    setMessage("");
    setPlanBusy(true);
    try {
      const saved = await updateRulePlanDraft(nextPreview);
      setPlanPreview(saved);
      await refreshTasks(false);
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
        message: uiErrorMessage(reason),
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
      const result = await discardRulePlanDraft(planPreview.preview_id, planPreview.version);
      setPlanPreview(null);
      setMessage("");
      await refreshTasks(false);
      const restoredMessage = result.restored_task_count > 0
        ? `，草案调整的 ${result.restored_task_count} 项任务时间已恢复`
        : "";
      const conflictMessage = result.conflicted_task_titles.length > 0
        ? `；${result.conflicted_task_titles.map((title) => `“${title}”`).join("、")}后来单独修改过，已保留当前时间`
        : "";
      setPlanToast({
        id: Date.now(),
        label: wasAdjustment ? "调整草案已放弃" : "计划草案已放弃",
        message: `${wasAdjustment ? "已确认计划保持不变" : "正式日历没有发生变化"}${restoredMessage}${conflictMessage}`,
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
        message: "已保存，10 秒内可以撤销",
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
        label: "已撤销这次确认",
        message: "任务和时间安排已恢复到确认前",
        icon: "check"
      });
    } catch (reason) {
      setPlanToast(null);
      setMessage(`无法撤销计划：${uiErrorMessage(reason)}`);
    } finally { setPlanBusy(false); }
  }

  function applyNavigation(intent: NavigationIntent) {
    setRequestedTaskView(intent.taskView || intent.createTask || intent.taskId
      ? { view: intent.taskView, createTask: intent.createTask, taskId: intent.taskId }
      : null);
    setTimelineReturnContext(intent.timelineReturnContext ?? null);
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
      .catch((reason) => setMessage(`导航宽度未保存：${uiErrorMessage(reason)}`));
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
      .catch((reason) => setMessage(`侧边栏状态未保存：${uiErrorMessage(reason)}`));
  }

  const renderedSidebarWidth = sidebarCollapsed ? SHELL_SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;

  return <main ref={shellRef} className={`next-shell${resizingShell ? " is-resizing" : ""}${sidebarCollapsed ? " sidebar-collapsed" : ""}`} style={{ "--sidebar-width": `${renderedSidebarWidth}px` } as CSSProperties}>
    <div className="toast-viewport" aria-live="polite" aria-atomic="true">
      {planToast && <div key={planToast.id} className={`plan-toast${planToast.icon === "check" ? " success" : planToast.icon === "review" ? " error" : ""}`} role={planToast.icon === "review" ? "alert" : "status"}><span className="plan-toast-icon"><Icon name={planToast.icon ?? "calendar"} size={15} /></span><span><strong>{planToast.label}</strong><small>{planToast.message}</small></span>{planToast.undoId && <button type="button" onClick={() => void undoConfirmedPlan(planToast.undoId!)}>撤销</button>}</div>}
    </div>
    {pendingPlanLeave && planPreview && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !planBusy) void resolvePendingPlanLeave(false); }}><section className="unsaved-dialog leave-dialog" role="alertdialog" aria-modal="true" aria-labelledby="plan-leave-dialog-title" aria-describedby="plan-leave-dialog-description" onKeyDown={(event) => { if (event.key === "Escape" && !planBusy) void resolvePendingPlanLeave(false); }}><header><h2 id="plan-leave-dialog-title">日计划草案尚未确认</h2><button type="button" aria-label="继续编辑" disabled={planBusy} onClick={() => void resolvePendingPlanLeave(false)}><Icon name="close" size={16} /></button></header><p id="plan-leave-dialog-description">{planPreview.plan_date} 的草案还没有加入正式日历。丢弃草案时，由这份草案调整的任务时间也会恢复。{pendingPlanLeave.kind === "date" ? "切换日期" : "离开今日页"}前需要先丢弃草案，或留在这里继续编辑并确认。</p><div className="dialog-actions"><button type="button" autoFocus disabled={planBusy} onClick={() => void resolvePendingPlanLeave(false)}>继续编辑</button><button type="button" className="dialog-discard" disabled={planBusy} onClick={() => void resolvePendingPlanLeave(true)}>{planBusy ? "正在丢弃…" : pendingPlanLeave.kind === "date" ? "丢弃并切换日期" : "丢弃并离开"}</button></div></section></div>}
    {active === "设置" && settingsEditorDirty && pendingNavigation && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) resolvePendingNavigation(false); }}><section className="unsaved-dialog leave-dialog" role="alertdialog" aria-modal="true" aria-labelledby="settings-leave-dialog-title" aria-describedby="settings-leave-dialog-description" onKeyDown={(event) => { if (event.key === "Escape") resolvePendingNavigation(false); }}><header><h2 id="settings-leave-dialog-title">放弃未保存修改？</h2><button type="button" aria-label="继续编辑" onClick={() => resolvePendingNavigation(false)}><Icon name="close" size={16} /></button></header><p id="settings-leave-dialog-description">设置中还有未保存内容。离开后会恢复为上次保存的日计划、提醒、外观和 Windows 偏好。</p><div className="dialog-actions"><button type="button" autoFocus onClick={() => resolvePendingNavigation(false)}>继续编辑</button><button type="button" className="dialog-discard" onClick={() => resolvePendingNavigation(true)}>放弃修改</button></div></section></div>}
    {planRegenerationOpen && <div className="dialog-backdrop plan-regeneration-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !planBusy) setPlanRegenerationOpen(false); }}><section className="unsaved-dialog plan-regeneration-dialog" role="alertdialog" aria-modal="true" aria-labelledby="plan-regeneration-title" aria-describedby="plan-regeneration-description" onKeyDown={(event) => { if (event.key === "Escape" && !planBusy) setPlanRegenerationOpen(false); }}><div className="dialog-icon"><Icon name="restore" size={19} /></div><h2 id="plan-regeneration-title">{daySchedule?.plan_id ? "重新安排未执行任务？" : "重新生成计划草案？"}</h2><p id="plan-regeneration-description">{daySchedule?.plan_id ? "今序会保留执行和复盘记录，重新安排尚未执行的任务，并替换本轮未保存的时间修改和新加入任务；结果仍需保存调整。" : "重新生成会替换当前草案中的手动调整；正式日历不会变化。"}</p><div className="dialog-actions"><button type="button" autoFocus disabled={planBusy} onClick={() => setPlanRegenerationOpen(false)}>{daySchedule?.plan_id ? "保留当前修改" : "保留当前草案"}</button><button type="button" className="dialog-save" disabled={planBusy} onClick={() => void generateRulePlan(true)}>{planBusy ? "正在生成…" : daySchedule?.plan_id ? "重新安排" : "重新生成"}</button></div></section></div>}
    <aside id="main-sidebar" className={`next-sidebar${mobileNavOpen ? " mobile-open" : ""}`} aria-label="主导航">
      <div className="next-brand"><div className="brand-mark"><span>今</span></div><div><strong>今序</strong><span>JinXu · 本地优先</span></div></div>
      <button className="next-create" type="button" aria-label={sidebarCollapsed ? "记一件事" : undefined} aria-describedby={sidebarCollapsed ? "sidebar-tip-create" : undefined} onClick={() => requestNavigation({ active: "任务", createTask: true })}><Icon name="plus" size={16} /><span className="next-create-label">记一件事</span><span className="sidebar-tooltip" id="sidebar-tip-create" role="tooltip" aria-hidden="true"><strong>记一件事</strong><small>创建普通任务或重复事项</small></span></button>
      <nav>{navigation.map((item) => <button key={item.label} type="button" className={active === item.label ? "active" : ""} aria-current={active === item.label ? "page" : undefined} aria-label={sidebarCollapsed ? item.label : undefined} aria-describedby={sidebarCollapsed ? `sidebar-tip-${item.icon}` : undefined} onClick={() => requestNavigation({ active: item.label })}><span className="nav-asset-icon" style={{ "--nav-icon": `url("${item.asset}")` } as CSSProperties} aria-hidden="true" /><span className="nav-copy"><strong>{item.label}</strong><small>{item.description}</small></span>{item.label === "任务" && activeTasks.length > 0 && <em>{activeTasks.length}</em>}<span className="sidebar-tooltip" id={`sidebar-tip-${item.icon}`} role="tooltip" aria-hidden="true"><strong>{item.label}</strong><small>{item.description}</small></span></button>)}</nav>
      <footer><div><span>今日计划</span><strong>{plannedTaskCount ? `${completedPlannedTaskCount}/${plannedTaskCount}` : "未生成"}</strong></div><div className="progress-track"><span style={{ width: `${planProgress}%` }} /></div>{plannedTaskCount > 0 && <p>{plannedMinutes} 分钟已安排，完成 {planProgress}%</p>}<span className={`database-state${tasksError ? " unavailable" : ""}`}><i />{tasksLoading ? "正在载入本地数据" : tasksError ? "本地数据暂时不可用" : "本地数据可用"}</span></footer>
    </aside>
    <div className="shell-resize-handle" role="separator" aria-label="调整导航与主功能区宽度；双击恢复默认宽度" aria-orientation="vertical" aria-valuemin={SHELL_SIDEBAR_MIN_WIDTH} aria-valuemax={SHELL_SIDEBAR_MAX_WIDTH} aria-valuenow={sidebarWidth} aria-disabled={sidebarCollapsed || undefined} tabIndex={sidebarCollapsed ? -1 : 0} onDoubleClick={resetSidebarWidth} onPointerDown={startShellResize} onPointerMove={moveShellResize} onPointerUp={endShellResize} onPointerCancel={endShellResize} onKeyDown={resizeShellWithKeyboard} />
    <button className="shell-collapse-button" type="button" aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} aria-controls="main-sidebar" aria-expanded={!sidebarCollapsed} onClick={toggleSidebarCollapsed}><Icon name={sidebarCollapsed ? "chevron-right" : "chevron-left"} size={16} /></button>
    {mobileNavOpen && <button type="button" className="nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}
    <section className="next-workspace">
      <button type="button" className="mobile-nav-button" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((value) => !value)}><Icon name="more" size={18} />菜单</button>
      {active === "今日" && <TodayPage today={today} selectedDate={selectedDate} onSelectDate={requestDateSelection} tasks={tasks} recurringItems={recurringItems} recurringOccurrences={recurringOccurrences} schedule={daySchedule} availability={availability} loading={scheduleLoading} error={scheduleError} preview={planPreview} busy={planBusy} onGeneratePlan={() => void generateRulePlan()} onAdjustPlan={startPlanAdjustment} onUpdatePlan={updatePlanDraft} onConfirmPlan={() => void confirmRulePlan()} onCancelPlan={discardPlanDraft} onOpenTasks={(taskId, returnContext) => requestNavigation({ active: "任务", taskId, timelineReturnContext: returnContext })} onFactsChanged={async (date = selectedDate) => { await Promise.all([refreshTasks(false), refreshSchedule(date, false)]); }} onNotify={(label, toastMessage, icon) => setPlanToast({ id: Date.now(), label, message: toastMessage, icon })} message={message} timelineReturnContext={timelineReturnContext} onTimelineReturnHandled={() => setTimelineReturnContext(null)} />}
      {active === "任务" && <TaskWorkspace tasks={tasks} recurringItems={recurringItems} loading={tasksLoading} error={tasksError} onReload={refreshTasks} onTaskCommitted={taskCommitted} onRecurringChanged={async () => { await Promise.all([refreshTasks(false), refreshSchedule(selectedDate, false)]); }} today={today} onDirtyChange={setTaskEditorDirty} externalNavigationRequest={pendingNavigation} onExternalNavigationResolved={resolvePendingNavigation} requestedView={requestedTaskView} timelineReturnContext={timelineReturnContext} onReturnToTimeline={(returnContext) => requestNavigation({ active: "今日", timelineReturnContext: returnContext })} />}
      {active === "复盘" && <ReviewPage today={today} onFactsChanged={(date) => {
        void refreshTasks(false);
        if (selectedDate === date) void refreshSchedule(date, false);
      }} />}
      {active === "设置" && <SettingsPage availability={availability} availabilityError={availabilityError} onReload={() => void refreshAvailability()} onSaved={(settings) => { setAvailability(settings); setAvailabilityError(null); void refreshSchedule(selectedDate, false); }} onNotify={(label, toastMessage, icon) => setPlanToast({ id: Date.now(), label, message: toastMessage, icon })} onDirtyChange={setSettingsEditorDirty} />}
    </section>
    <FloatingAssistant open={assistantOpen} onToggle={() => setAssistantOpen((value) => !value)} onNavigate={(page) => requestNavigation(page === "草稿" ? { active: "任务", taskView: "draft" } : { active: page })} onDataChanged={async () => { await Promise.all([refreshTasks(false), refreshSchedule(selectedDate, false)]); }} />
  </main>;
}
