export const TRASH_RETENTION_DAYS = 30;

export type TrashCountdownTone = "normal" | "warning" | "danger";

export interface TrashRetentionCountdown {
  label: string;
  tone: TrashCountdownTone;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

function parseDeletedTimestamp(deletedAt: string): number {
  const trimmed = deletedAt.trim();
  if (!trimmed) return Number.NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return Date.parse(`${trimmed}T00:00:00+08:00`);
  }
  return Date.parse(trimmed);
}

export function formatTrashRetentionCountdown(
  deletedAt: string | null | undefined,
  nowMs = Date.now(),
  retentionDays = TRASH_RETENTION_DAYS,
): TrashRetentionCountdown {
  if (!deletedAt) {
    return { label: `${retentionDays} 天后彻底删除`, tone: "normal" };
  }
  const deletedMs = parseDeletedTimestamp(deletedAt);
  if (!Number.isFinite(deletedMs)) {
    return { label: `${retentionDays} 天后彻底删除`, tone: "normal" };
  }
  const remainingMs = deletedMs + retentionDays * MS_PER_DAY - nowMs;
  if (remainingMs <= 0) {
    return { label: "即将自动彻底删除", tone: "danger" };
  }
  if (remainingMs < MS_PER_HOUR) {
    const mins = Math.max(1, Math.ceil(remainingMs / MS_PER_MINUTE));
    return { label: `${mins} 分钟后彻底删除`, tone: "danger" };
  }
  if (remainingMs < MS_PER_DAY) {
    const hours = Math.ceil(remainingMs / MS_PER_HOUR);
    return { label: `${hours} 小时后彻底删除`, tone: "danger" };
  }
  const days = Math.ceil(remainingMs / MS_PER_DAY);
  return {
    label: `${days} 天后彻底删除`,
    tone: days <= 3 ? "warning" : "normal",
  };
}
