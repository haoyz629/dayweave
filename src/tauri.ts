import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { HolidayCalendarSnapshot } from "./official-holiday-calendar";
import type {
  Draft,
  DraftInput,
  RecurringOccurrence,
  RecurringOccurrenceStateInput,
  RecurringRule,
  RecurringRuleInput,
  RescheduleRecurringOccurrenceInput,
  RescheduleRecurringResult,
  Tag,
  TagColor,
  Task,
  TaskInput,
  WorkspaceSnapshot,
} from "./types/dayweave";
import { isStatutoryWorkday, parseDateParts, shiftDate, todayDateStr, weekdayNumMon1 } from "./utils/dateUtils";

export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

// =========================================================================
// DEV BROWSER PREVIEW ADAPTER (localStorage-backed; desktop uses SQLite!)
// =========================================================================
const DEV_STORE_KEY = "dayweave_v2_dev_preview_store";

interface DevStore {
  tags: Tag[];
  tasks: Task[];
  trash: Task[];
  drafts: Draft[];
  recurringRules: RecurringRule[];
  archivedRecurringRules: RecurringRule[];
  occurrenceRecords: Record<string, DevOccurrenceRecord>;
  settings: Record<string, string>;
  autostart: boolean;
}

interface DevOccurrenceRecord {
  occurrence: RecurringOccurrence;
  overrideStartMin: number | null;
  overrideDuration: number | null;
}

function createInitialDevStore(): DevStore {
  const today = todayDateStr();
  const yesterday = shiftDate(today, -1);
  const plus2 = shiftDate(today, 2);
  const plus3 = shiftDate(today, 3);
  const nowIso = new Date().toISOString();

  return {
    tags: [
      { id: "work", name: "工作", color: "blue" },
      { id: "focus", name: "专注项目", color: "indigo" },
      { id: "study", name: "学习", color: "emerald" },
      { id: "life", name: "生活健康", color: "amber" },
      { id: "urgent", name: "重要跟进", color: "rose" },
    ],
    tasks: [
      {
        id: "t1",
        title: "产品需求同步与版本排期",
        note: "确认 Win11 浅色云母与任务编织台交付清单",
        mode: "timeline",
        tagId: "work",
        priority: "P1",
        done: true,
        date: today,
        startMin: 10 * 60,
        duration: 60,
        dateStart: today,
        dateEnd: today,
        subtasks: [
          { id: "st-1", text: "对齐左侧图标栏信息层级", done: true },
          { id: "st-2", text: "敲定草稿箱交互边界", done: true },
        ],
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "t2",
        title: "Dayweave 交互原型走查",
        note: "验收拖拽入轴与边缘拉伸手势",
        mode: "timeline",
        tagId: "study",
        priority: "P2",
        done: true,
        date: today,
        startMin: 14 * 60,
        duration: 60,
        dateStart: today,
        dateEnd: today,
        subtasks: [],
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "t3",
        title: "客户端内存占用排查与优化",
        note: "重点检查月视图大量节点复用情况",
        mode: "timeline",
        tagId: "focus",
        priority: "P1",
        done: false,
        date: today,
        startMin: 16 * 60,
        duration: 90,
        dateStart: today,
        dateEnd: today,
        subtasks: [
          { id: "st-3", text: "采集堆内存快照", done: true },
          { id: "st-4", text: "优化时间轴滚动帧率", done: false },
        ],
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "t3b",
        title: "同步安装器签名证书进度",
        note: "与运维同学核对时间戳服务器",
        mode: "timeline",
        tagId: "urgent",
        priority: "P2",
        done: false,
        date: today,
        startMin: 16 * 60 + 30,
        duration: 60,
        dateStart: today,
        dateEnd: today,
        subtasks: [],
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "t4",
        title: "健身房有氧与拉伸",
        note: "跑步机 35 分钟 + 核心训练",
        mode: "timeline",
        tagId: "life",
        priority: "",
        done: false,
        date: today,
        startMin: 19 * 60,
        duration: 60,
        dateStart: today,
        dateEnd: today,
        subtasks: [],
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "t5",
        title: "版本封板与回归测试",
        note: "",
        mode: "timeline",
        tagId: "focus",
        priority: "P1",
        done: false,
        date: plus2,
        startMin: 10 * 60,
        duration: 90,
        dateStart: plus2,
        dateEnd: plus2,
        subtasks: [],
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "f1",
        title: "补齐 Windows 安装包代码签名流程",
        note: "联系证书供应商完成签名验证",
        mode: "flex",
        tagId: "urgent",
        priority: "P1",
        done: false,
        date: today,
        startMin: 17 * 60,
        duration: 60,
        dateStart: yesterday,
        dateEnd: plus2,
        subtasks: [],
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "f2",
        title: "整理 Q4 复盘框架与数据素材",
        note: "按任务编织完成率汇总",
        mode: "flex",
        tagId: "work",
        priority: "P2",
        done: false,
        date: today,
        startMin: 17 * 60,
        duration: 60,
        dateStart: today,
        dateEnd: plus3,
        subtasks: [],
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "p1",
        title: "打磨浅色 Mica 层级与文字对比度",
        note: "确保小字号在浅灰云母下保持高可读性",
        mode: "pool",
        tagId: "focus",
        priority: "P1",
        done: false,
        date: today,
        startMin: 17 * 60,
        duration: 60,
        dateStart: today,
        dateEnd: today,
        subtasks: [],
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "p2",
        title: "核对月视图农历与法定节假日角标",
        note: "",
        mode: "pool",
        tagId: "urgent",
        priority: "P1",
        done: false,
        date: today,
        startMin: 17 * 60,
        duration: 45,
        dateStart: today,
        dateEnd: today,
        subtasks: [],
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "p3",
        title: "撰写 2.0 重构更新日志与截图",
        note: "",
        mode: "pool",
        tagId: "work",
        priority: "P2",
        done: false,
        date: today,
        startMin: 17 * 60,
        duration: 30,
        dateStart: today,
        dateEnd: today,
        subtasks: [],
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "p4",
        title: "精读 Fluent Design 2 动效文档",
        note: "",
        mode: "pool",
        tagId: "study",
        priority: "",
        done: false,
        date: today,
        startMin: 17 * 60,
        duration: 30,
        dateStart: today,
        dateEnd: today,
        subtasks: [],
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ],
    trash: [
      {
        id: "tr1",
        title: "旧版顶部双按钮文案调研",
        note: "已改用统一智能快录栏",
        mode: "pool",
        tagId: "work",
        priority: "",
        done: false,
        date: yesterday,
        startMin: 15 * 60,
        duration: 30,
        dateStart: yesterday,
        dateEnd: yesterday,
        subtasks: [],
        deletedAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ],
    drafts: [
      {
        id: "d1",
        title: "规划桌面小组件贴边吸附接口",
        note: "确认双屏下贴边坐标与失焦自动隐藏策略...",
        mode: "pool",
        tagId: "focus",
        priority: "P1",
        duration: 90,
        startMin: 17 * 60,
        dateStart: today,
        dateEnd: today,
        updatedAt: nowIso,
      },
    ],
    recurringRules: [
      {
        id: "r1",
        title: "晨间站会与今日编织",
        note: "梳理当日 P1 事项与空档",
        tagId: "work",
        priority: "P2",
        frequency: "weekdays",
        weekdays: [1, 2, 3, 4, 5],
        monthDay: null,
        mode: "timeline",
        startMin: 9 * 60 + 30,
        duration: 30,
        startsOn: shiftDate(today, -14),
        endsOn: null,
        active: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "r2",
        title: "本周进度回顾与草稿清理",
        note: "",
        tagId: "study",
        priority: "",
        frequency: "weekly",
        weekdays: [5],
        monthDay: null,
        mode: "timeline",
        startMin: 17 * 60,
        duration: 45,
        startsOn: shiftDate(today, -14),
        endsOn: null,
        active: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ],
    archivedRecurringRules: [],
    occurrenceRecords: {},
    settings: {
      "ui.show_lunar": "true",
      "ui.snap_step": "15",
      "ui.default_duration": "60",
      "ui.enable_drag_create": "true",
      "ui.auto_draft": "true",
      "ui.reminder.task_lead": "5",
      "ui.desktop.close_to_tray": "true",
    },
    autostart: false,
  };
}

function readDevStore(): DevStore {
  try {
    const raw = window.localStorage.getItem(DEV_STORE_KEY);
    if (raw) return { occurrenceRecords: {}, archivedRecurringRules: [], ...JSON.parse(raw) } as DevStore;
  } catch {
    // ignore storage errors
  }
  const init = createInitialDevStore();
  writeDevStore(init);
  return init;
}

function writeDevStore(store: DevStore) {
  window.localStorage.setItem(DEV_STORE_KEY, JSON.stringify(store));
}

function devRuleOccursOn(rule: RecurringRule, dateStr: string): boolean {
  if (!rule.active) return false;
  if (dateStr < rule.startsOn) return false;
  if (rule.endsOn && dateStr > rule.endsOn) return false;
  if (rule.frequency === "daily") return true;
  if (rule.frequency === "weekdays") return isStatutoryWorkday(dateStr);
  if (rule.frequency === "weekly") return rule.weekdays.includes(weekdayNumMon1(dateStr));
  if (rule.frequency === "monthly") {
    const p = parseDateParts(dateStr);
    const maxDay = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
    const target = Math.min(rule.monthDay ?? parseDateParts(rule.startsOn).day, maxDay);
    return p.day === target;
  }
  return false;
}

function devOccurrenceFromRule(rule: RecurringRule, date: string): RecurringOccurrence {
  return {
    id: `ro:${rule.id}:${date}`,
    ruleId: rule.id,
    occurrenceDate: date,
    title: rule.title,
    note: rule.note,
    tagId: rule.tagId,
    priority: rule.priority,
    mode: rule.mode,
    startMin: rule.startMin,
    duration: rule.duration,
    done: false,
    skipped: false,
  };
}

function resolveDevOccurrence(record: DevOccurrenceRecord): RecurringOccurrence {
  return {
    ...record.occurrence,
    startMin: record.overrideStartMin ?? record.occurrence.startMin,
    duration: record.overrideDuration ?? record.occurrence.duration,
  };
}

// =========================================================================
// PUBLIC API
// =========================================================================

export type ReminderTarget = { date: string; blockId: string; taskId: string };
export type ReminderAction = { target: ReminderTarget; action: "open" | "completed" };

export function setAppWindowTitle(title: string): Promise<void> {
  document.title = title;
  if (!isDesktopRuntime()) return Promise.resolve();
  return invokeDesktop<void>("set_app_window_title", { title });
}

export function onReminderActivated(handler: (event: ReminderAction) => void): Promise<() => void> {
  if (!isDesktopRuntime()) return Promise.resolve(() => {});
  return listen<ReminderAction>("reminder-activated", (event) => handler(event.payload));
}

export async function getWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  if (isDesktopRuntime()) return invokeDesktop<WorkspaceSnapshot>("get_workspace_snapshot");
  const s = readDevStore();
  return {
    tags: s.tags,
    tasks: s.tasks,
    trash: s.trash,
    drafts: s.drafts,
    recurringRules: s.recurringRules,
    archivedRecurringRules: s.archivedRecurringRules ?? [],
    settings: s.settings,
  };
}

export async function createTag(name: string, color: TagColor): Promise<Tag> {
  if (isDesktopRuntime()) return invokeDesktop<Tag>("create_tag", { name, color });
  const s = readDevStore();
  const clean = name.trim().replace(/^#/, "");
  if (!clean) throw new Error("标签名称不能为空");
  if (s.tags.some((t) => t.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error(`标签「${clean}」已存在`);
  }
  const created: Tag = { id: `tg-${Date.now()}`, name: clean, color };
  s.tags.push(created);
  writeDevStore(s);
  return created;
}

export async function deleteTag(tagId: string): Promise<void> {
  if (isDesktopRuntime()) return invokeDesktop<void>("delete_tag", { tagId });
  const s = readDevStore();
  if (s.tags.length <= 1) throw new Error("至少保留 1 个任务标签");
  s.tags = s.tags.filter((t) => t.id !== tagId);
  s.tasks.forEach((t) => { if (t.tagId === tagId) t.tagId = ""; });
  s.drafts.forEach((d) => { if (d.tagId === tagId) d.tagId = ""; });
  s.recurringRules.forEach((r) => { if (r.tagId === tagId) r.tagId = ""; });
  writeDevStore(s);
}

export async function createTask(input: TaskInput, fromDraftId: string | null = null): Promise<Task> {
  if (isDesktopRuntime()) return invokeDesktop<Task>("create_task", { input, fromDraftId });
  const s = readDevStore();
  if (fromDraftId !== null) {
    if (!s.drafts.some((draft) => draft.id === fromDraftId)) throw new Error("找不到待转换的草稿");
    s.drafts = s.drafts.filter((draft) => draft.id !== fromDraftId);
  }
  const now = new Date().toISOString();
  const dateStart = input.mode === "flex" ? input.dateStart : input.date;
  const dateEnd = input.mode === "flex" && input.dateEnd >= dateStart ? input.dateEnd : dateStart;
  const task: Task = {
    ...input,
    dateStart,
    dateEnd,
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    subtasks: input.subtasks.map((st, idx) => ({
      id: st.id || `st-${Date.now()}-${idx}`,
      text: st.text,
      done: st.done,
    })),
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  s.tasks.unshift(task);
  writeDevStore(s);
  return task;
}

export async function updateTask(taskId: string, input: TaskInput): Promise<Task> {
  if (isDesktopRuntime()) return invokeDesktop<Task>("update_task", { taskId, input });
  const s = readDevStore();
  const idx = s.tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) throw new Error("找不到指定任务");
  const prev = s.tasks[idx];
  const dateStart = input.mode === "flex" ? input.dateStart : input.date;
  const dateEnd = input.mode === "flex" && input.dateEnd >= dateStart ? input.dateEnd : dateStart;
  const updated: Task = {
    ...prev,
    ...input,
    dateStart,
    dateEnd,
    subtasks: input.subtasks.map((st, i) => ({
      id: st.id || `st-${Date.now()}-${i}`,
      text: st.text,
      done: st.done,
    })),
    updatedAt: new Date().toISOString(),
  };
  s.tasks[idx] = updated;
  writeDevStore(s);
  return updated;
}

export async function softDeleteTask(taskId: string): Promise<Task> {
  if (isDesktopRuntime()) return invokeDesktop<Task>("soft_delete_task", { taskId });
  const s = readDevStore();
  const idx = s.tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) throw new Error("找不到指定任务");
  const [removed] = s.tasks.splice(idx, 1);
  removed.deletedAt = new Date().toISOString();
  s.trash.unshift(removed);
  writeDevStore(s);
  return removed;
}

export async function restoreTask(taskId: string): Promise<Task> {
  if (isDesktopRuntime()) return invokeDesktop<Task>("restore_task", { taskId });
  const s = readDevStore();
  const idx = s.trash.findIndex((t) => t.id === taskId);
  if (idx === -1) throw new Error("回收站中找不到该任务");
  const [restored] = s.trash.splice(idx, 1);
  restored.deletedAt = null;
  s.tasks.unshift(restored);
  writeDevStore(s);
  return restored;
}

export async function purgeTask(taskId: string): Promise<void> {
  if (isDesktopRuntime()) return invokeDesktop<void>("purge_task", { taskId });
  const s = readDevStore();
  s.trash = s.trash.filter((t) => t.id !== taskId);
  writeDevStore(s);
}

export async function emptyTrash(): Promise<number> {
  if (isDesktopRuntime()) return invokeDesktop<number>("empty_trash");
  const s = readDevStore();
  const count = s.trash.length;
  s.trash = [];
  writeDevStore(s);
  return count;
}

export async function upsertDraft(input: DraftInput): Promise<Draft> {
  if (isDesktopRuntime()) return invokeDesktop<Draft>("upsert_draft", { input });
  const s = readDevStore();
  const now = new Date().toISOString();
  const dateStart = input.dateStart;
  const dateEnd = input.mode === "flex" && input.dateEnd >= dateStart ? input.dateEnd : dateStart;
  const draft: Draft = {
    ...input,
    dateStart,
    dateEnd,
    id: input.id || `d-${Date.now()}`,
    title: input.title.trim() || "未命名草稿",
    updatedAt: now,
  };
  const idx = s.drafts.findIndex((d) => d.id === draft.id);
  if (idx >= 0) s.drafts[idx] = draft;
  else s.drafts.unshift(draft);
  writeDevStore(s);
  return draft;
}

export async function deleteDraft(draftId: string): Promise<void> {
  if (isDesktopRuntime()) return invokeDesktop<void>("delete_draft", { draftId });
  const s = readDevStore();
  s.drafts = s.drafts.filter((d) => d.id !== draftId);
  writeDevStore(s);
}

export async function createRecurringRule(input: RecurringRuleInput): Promise<RecurringRule> {
  if (isDesktopRuntime()) return invokeDesktop<RecurringRule>("create_recurring_rule", { input });
  const s = readDevStore();
  const now = new Date().toISOString();
  const rule: RecurringRule = {
    ...input,
    id: `r-${Date.now()}`,
    createdAt: now,
    updatedAt: now,
  };
  s.recurringRules.unshift(rule);
  writeDevStore(s);
  return rule;
}

export async function updateRecurringRule(ruleId: string, input: RecurringRuleInput): Promise<RecurringRule> {
  if (isDesktopRuntime()) return invokeDesktop<RecurringRule>("update_recurring_rule", { ruleId, input });
  const s = readDevStore();
  const idx = s.recurringRules.findIndex((r) => r.id === ruleId);
  if (idx === -1) throw new Error("找不到指定重复规则");
  const updated: RecurringRule = { ...s.recurringRules[idx], ...input, updatedAt: new Date().toISOString() };
  s.recurringRules[idx] = updated;
  writeDevStore(s);
  return updated;
}

function deleteUncompletedDevOccurrences(store: DevStore, ruleId: string) {
  for (const [key, rec] of Object.entries(store.occurrenceRecords)) {
    if (rec.occurrence.ruleId === ruleId && !rec.occurrence.done && !rec.occurrence.skipped) {
      delete store.occurrenceRecords[key];
    }
  }
}

export async function toggleRecurringRule(ruleId: string, active: boolean): Promise<RecurringRule> {
  if (isDesktopRuntime()) return invokeDesktop<RecurringRule>("toggle_recurring_rule", { ruleId, active });
  const s = readDevStore();
  const rule = s.recurringRules.find((r) => r.id === ruleId);
  if (!rule) throw new Error("找不到指定重复规则");
  rule.active = active;
  rule.updatedAt = new Date().toISOString();
  if (!active) deleteUncompletedDevOccurrences(s, ruleId);
  writeDevStore(s);
  return { ...rule };
}

export async function archiveRecurringRule(ruleId: string): Promise<RecurringRule> {
  if (isDesktopRuntime()) return invokeDesktop<RecurringRule>("archive_recurring_rule", { ruleId });
  const s = readDevStore();
  const target = s.recurringRules.find((r) => r.id === ruleId);
  if (!target) throw new Error("找不到指定重复规则");
  const archived: RecurringRule = { ...target, active: false, updatedAt: new Date().toISOString() };
  s.recurringRules = s.recurringRules.filter((r) => r.id !== ruleId);
  s.archivedRecurringRules = [archived, ...(s.archivedRecurringRules ?? []).filter((r) => r.id !== ruleId)];
  deleteUncompletedDevOccurrences(s, ruleId);
  writeDevStore(s);
  return archived;
}

export async function restoreRecurringRule(ruleId: string): Promise<RecurringRule> {
  if (isDesktopRuntime()) return invokeDesktop<RecurringRule>("restore_recurring_rule", { ruleId });
  const s = readDevStore();
  const list = s.archivedRecurringRules ?? [];
  const target = list.find((r) => r.id === ruleId);
  if (!target) throw new Error("找不到指定已归档规则");
  const restored: RecurringRule = { ...target, active: true, updatedAt: new Date().toISOString() };
  s.archivedRecurringRules = list.filter((r) => r.id !== ruleId);
  s.recurringRules = [restored, ...s.recurringRules.filter((r) => r.id !== ruleId)];
  writeDevStore(s);
  return restored;
}

export async function listRecurringOccurrencesRange(fromDate: string, toDate: string): Promise<RecurringOccurrence[]> {
  if (isDesktopRuntime()) return invokeDesktop<RecurringOccurrence[]>("list_recurring_occurrences_range", { fromDate, toDate });
  const s = readDevStore();
  const activeRuleIds = new Set(s.recurringRules.filter((r) => r.active).map((r) => r.id));
  const list = Object.values(s.occurrenceRecords)
    .filter(
      ({ occurrence }) =>
        !occurrence.skipped &&
        (occurrence.done || activeRuleIds.has(occurrence.ruleId)) &&
        occurrence.occurrenceDate >= fromDate &&
        occurrence.occurrenceDate <= toDate,
    )
    .map(resolveDevOccurrence);
  let cur = fromDate;
  let guard = 0;
  while (cur <= toDate && guard++ < 95) {
    for (const rule of s.recurringRules) {
      if (!devRuleOccursOn(rule, cur)) continue;
      const occurrence = devOccurrenceFromRule(rule, cur);
      if (!s.occurrenceRecords[occurrence.id]) list.push(occurrence);
    }
    cur = shiftDate(cur, 1);
  }
  return list.sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
}

export async function setRecurringOccurrenceState(input: RecurringOccurrenceStateInput): Promise<RecurringOccurrence> {
  if (isDesktopRuntime()) return invokeDesktop<RecurringOccurrence>("set_recurring_occurrence_state", { input });
  const s = readDevStore();
  const key = `ro:${input.ruleId}:${input.occurrenceDate}`;
  let record = s.occurrenceRecords[key];
  if (!record) {
    const rule = s.recurringRules.find((r) => r.id === input.ruleId && devRuleOccursOn(r, input.occurrenceDate));
    if (!rule) throw new Error("指定日期没有可记录的重复事项");
    record = { occurrence: devOccurrenceFromRule(rule, input.occurrenceDate), overrideStartMin: null, overrideDuration: null };
  }
  record.occurrence.done = input.done ?? record.occurrence.done;
  record.occurrence.skipped = input.skipped ?? record.occurrence.skipped;
  if (input.overrideStartMin !== undefined) record.overrideStartMin = input.overrideStartMin;
  if (input.overrideDuration !== undefined) record.overrideDuration = input.overrideDuration;
  const hasOverrides = record.overrideStartMin !== null || record.overrideDuration !== null;
  const ruleIsActive = s.recurringRules.some((r) => r.id === input.ruleId && r.active);
  if (!record.occurrence.done && !record.occurrence.skipped && (!hasOverrides || !ruleIsActive)) {
    delete s.occurrenceRecords[key];
  } else {
    s.occurrenceRecords[key] = record;
  }
  writeDevStore(s);
  return resolveDevOccurrence(record);
}

export async function rescheduleRecurringOccurrence(
  input: RescheduleRecurringOccurrenceInput,
): Promise<RescheduleRecurringResult> {
  if (isDesktopRuntime()) {
    return invokeDesktop<RescheduleRecurringResult>("reschedule_recurring_occurrence", { input });
  }
  const nextStartMin = Math.max(0, Math.min(24 * 60 - 15, Math.round(input.startMin)));
  const nextDuration = Math.max(15, Math.min(24 * 60, Math.round(input.duration)));
  if (input.scope === "single") {
    const occurrence = await setRecurringOccurrenceState({
      ruleId: input.ruleId,
      occurrenceDate: input.occurrenceDate,
      overrideStartMin: nextStartMin,
      overrideDuration: nextDuration,
    });
    const s = readDevStore();
    return {
      scope: "single",
      recurringRules: s.recurringRules,
      occurrence,
    };
  }

  const s = readDevStore();
  const idx = s.recurringRules.findIndex((r) => r.id === input.ruleId);
  if (idx === -1) throw new Error("原重复规则已归档或不存在，仅支持调整本次安排");
  const rule = s.recurringRules[idx];
  const now = new Date().toISOString();

  // 1. Freeze unrecorded past dates (< occurrenceDate) at the old time so history never drifts
  const timeChanged =
    rule.mode !== "timeline" || rule.startMin !== nextStartMin || rule.duration !== nextDuration;
  if (timeChanged && input.occurrenceDate > rule.startsOn) {
    const windowFloor = shiftDate(input.occurrenceDate, -366);
    let cur = rule.startsOn > windowFloor ? rule.startsOn : windowFloor;
    let guard = 0;
    while (cur < input.occurrenceDate && guard++ < 370) {
      if (devRuleOccursOn(rule, cur)) {
        const pastKey = `ro:${rule.id}:${cur}`;
        if (!s.occurrenceRecords[pastKey]) {
          s.occurrenceRecords[pastKey] = {
            occurrence: devOccurrenceFromRule(rule, cur),
            overrideStartMin: rule.startMin,
            overrideDuration: rule.duration,
          };
        }
      }
      cur = shiftDate(cur, 1);
    }
  }

  // 2. Update the SINGLE existing rule in-place (never duplicate into 2 rules!)
  const updatedRule: RecurringRule = {
    ...rule,
    mode: "timeline",
    startMin: nextStartMin,
    duration: nextDuration,
    updatedAt: now,
  };
  s.recurringRules[idx] = updatedRule;

  // 3. Reconcile existing records on >= occurrenceDate
  const futureKeys = Object.keys(s.occurrenceRecords).filter((k) => {
    const rec = s.occurrenceRecords[k];
    return rec.occurrence.ruleId === rule.id && rec.occurrence.occurrenceDate >= input.occurrenceDate;
  });
  for (const k of futureKeys) {
    const rec = s.occurrenceRecords[k];
    if (!rec.occurrence.done && !rec.occurrence.skipped) {
      delete s.occurrenceRecords[k];
    } else if (rec.occurrence.done) {
      rec.overrideStartMin = null;
      rec.overrideDuration = null;
      if (rec.occurrence.occurrenceDate === input.occurrenceDate) {
        rec.occurrence.mode = "timeline";
        rec.occurrence.startMin = nextStartMin;
        rec.occurrence.duration = nextDuration;
      }
    }
  }

  writeDevStore(s);
  const savedKey = `ro:${updatedRule.id}:${input.occurrenceDate}`;
  const saved = s.occurrenceRecords[savedKey];
  const occurrence = saved
    ? resolveDevOccurrence(saved)
    : devOccurrenceFromRule(updatedRule, input.occurrenceDate);
  return {
    scope: "this_and_future",
    recurringRules: s.recurringRules,
    occurrence,
  };
}

export async function setUiSetting(key: string, value: string): Promise<void> {
  if (isDesktopRuntime()) return invokeDesktop<void>("set_ui_setting", { key, value });
  const s = readDevStore();
  s.settings[key] = value;
  writeDevStore(s);
}

export async function getAutostartEnabled(): Promise<boolean> {
  if (isDesktopRuntime()) return invokeDesktop<boolean>("get_autostart_enabled");
  return readDevStore().autostart;
}

export async function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  if (isDesktopRuntime()) return invokeDesktop<boolean>("set_autostart_enabled", { enabled });
  const s = readDevStore();
  s.autostart = enabled;
  writeDevStore(s);
  return enabled;
}

export async function sendTestNotification(): Promise<void> {
  if (isDesktopRuntime()) return invokeDesktop<void>("send_test_notification");
}

export async function getHolidayCalendar(): Promise<HolidayCalendarSnapshot> {
  return invokeDesktop<HolidayCalendarSnapshot>("get_holiday_calendar");
}

export async function checkHolidayUpdates(years: number[] = [], force = false): Promise<HolidayCalendarSnapshot> {
  return invokeDesktop<HolidayCalendarSnapshot>("check_holiday_updates", { years, force });
}
