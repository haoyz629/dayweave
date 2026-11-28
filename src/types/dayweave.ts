export type ScheduleMode = "pool" | "flex" | "timeline";
export type TagColor = "blue" | "indigo" | "emerald" | "amber" | "rose";
export type Priority = "" | "P1" | "P2";
export type RecurrenceFrequency = "daily" | "weekdays" | "weekly" | "monthly";
export type AppModule = "workbench" | "tasks" | "recurring" | "trash" | "settings";
export type CalendarView = "day" | "month";

export interface Tag {
  id: string;
  name: string;
  color: TagColor;
}

export interface Subtask {
  id: string;
  text: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  note: string;
  mode: ScheduleMode;
  tagId: string;
  priority: Priority;
  done: boolean;
  date: string; // YYYY-MM-DD (used in timeline mode)
  startMin: number; // minutes from 00:00
  duration: number; // minutes
  dateStart: string; // YYYY-MM-DD (used in flex / multi-day mode)
  dateEnd: string; // YYYY-MM-DD
  subtasks: Subtask[];
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TaskInput = {
  title: string;
  note: string;
  mode: ScheduleMode;
  tagId: string;
  priority: Priority;
  done: boolean;
  date: string;
  startMin: number;
  duration: number;
  dateStart: string;
  dateEnd: string;
  subtasks: { id?: string; text: string; done: boolean }[];
};

export interface Draft {
  id: string;
  title: string;
  note: string;
  mode: ScheduleMode;
  tagId: string;
  priority: Priority;
  duration: number;
  startMin: number;
  dateStart: string;
  dateEnd: string;
  updatedAt: string;
}

export type DraftInput = Omit<Draft, "id" | "updatedAt"> & { id?: string };

export interface RecurringRule {
  id: string;
  title: string;
  note: string;
  tagId: string;
  priority: Priority;
  frequency: RecurrenceFrequency;
  weekdays: number[]; // 1..7 Mon..Sun
  monthDay: number | null;
  mode: "timeline" | "flex";
  startMin: number | null;
  duration: number;
  startsOn: string;
  endsOn: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RecurringRuleInput = Omit<RecurringRule, "id" | "createdAt" | "updatedAt">;

export interface RecurringOccurrence {
  id: string;
  ruleId: string;
  occurrenceDate: string;
  title: string;
  note: string;
  tagId: string;
  priority: Priority;
  mode: "timeline" | "flex";
  startMin: number | null;
  duration: number;
  done: boolean;
  skipped: boolean;
}

export interface RecurringOccurrenceStateInput {
  ruleId: string;
  occurrenceDate: string;
  done?: boolean;
  skipped?: boolean;
  overrideStartMin?: number | null;
  overrideDuration?: number | null;
}

export type RescheduleRecurringScope = "single" | "this_and_future";

export interface RescheduleRecurringOccurrenceInput {
  ruleId: string;
  occurrenceDate: string;
  startMin: number;
  duration: number;
  scope: RescheduleRecurringScope;
}

export interface RescheduleRecurringResult {
  scope: RescheduleRecurringScope;
  recurringRules: RecurringRule[];
  occurrence: RecurringOccurrence;
}

export interface AppSettings {
  showLunar: boolean;
  snapStep: 15 | 30;
  defaultDuration: number;
  enableDragCreate: boolean;
  autoDraft: boolean;
  taskLeadMinutes: number;
  closeToTray: boolean;
}

export interface WorkspaceSnapshot {
  tags: Tag[];
  tasks: Task[];
  trash: Task[];
  drafts: Draft[];
  recurringRules: RecurringRule[];
  archivedRecurringRules: RecurringRule[];
  settings: Record<string, string>;
}

export const TAG_COLOR_HEX: Record<TagColor, string> = {
  blue: "#2563EB",
  indigo: "#6366F1",
  emerald: "#10B981",
  amber: "#F59E0B",
  rose: "#F43F5E",
};

export const TAG_COLOR_LABELS: Record<TagColor, string> = {
  blue: "蓝色",
  indigo: "靛紫色",
  emerald: "翠绿色",
  amber: "琥珀黄",
  rose: "玫红色",
};

export const DEFAULT_SETTINGS: AppSettings = {
  showLunar: true,
  snapStep: 15,
  defaultDuration: 60,
  enableDragCreate: true,
  autoDraft: true,
  taskLeadMinutes: 5,
  closeToTray: true,
};

export function parseSettingsMap(map: Record<string, string>): AppSettings {
  const snapRaw = Number(map["ui.snap_step"]);
  const durRaw = Number(map["ui.default_duration"]);
  const leadRaw = Number(map["ui.reminder.task_lead"]);
  return {
    showLunar: map["ui.show_lunar"] !== "false",
    snapStep: snapRaw === 30 ? 30 : 15,
    defaultDuration: Number.isFinite(durRaw) && durRaw >= 15 && durRaw <= 240 ? durRaw : 60,
    enableDragCreate: map["ui.enable_drag_create"] !== "false",
    autoDraft: map["ui.auto_draft"] !== "false",
    taskLeadMinutes: Number.isInteger(leadRaw) && leadRaw >= 0 && leadRaw <= 60 ? leadRaw : 5,
    closeToTray: map["ui.desktop.close_to_tray"] !== "false",
  };
}
