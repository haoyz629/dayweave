export const RECYCLE_RETENTION_DAYS = 30;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function elapsedLabel(elapsedMs: number) {
  if (elapsedMs < MINUTE_MS) return "刚刚";
  if (elapsedMs < HOUR_MS) return `${Math.floor(elapsedMs / MINUTE_MS)} 分钟前`;
  if (elapsedMs < DAY_MS) return `${Math.floor(elapsedMs / HOUR_MS)} 小时前`;
  const days = Math.floor(elapsedMs / DAY_MS);
  if (days < 7) return `${days} 天前`;
  if (days < RECYCLE_RETENTION_DAYS) return `${Math.floor(days / 7)} 周前`;
  return `${Math.floor(days / RECYCLE_RETENTION_DAYS)} 个月前`;
}

function remainingLabel(remainingMs: number) {
  if (remainingMs <= 0) return null;
  if (remainingMs < HOUR_MS) return `${Math.max(1, Math.ceil(remainingMs / MINUTE_MS))} 分钟后`;
  if (remainingMs < DAY_MS) return `${Math.ceil(remainingMs / HOUR_MS)} 小时后`;
  return `${Math.ceil(remainingMs / DAY_MS)} 天后`;
}

export function recycleRetentionMessage(deletedAt: string | null, nowMs = Date.now()) {
  const deletedAtMs = deletedAt ? Date.parse(deletedAt) : Number.NaN;
  if (!Number.isFinite(deletedAtMs)) {
    return `已移入回收站，将在 ${RECYCLE_RETENTION_DAYS} 天保留期结束后被永久删除。`;
  }
  const elapsedMs = Math.max(0, nowMs - deletedAtMs);
  const remaining = remainingLabel(deletedAtMs + RECYCLE_RETENTION_DAYS * DAY_MS - nowMs);
  return remaining
    ? `${elapsedLabel(elapsedMs)}移入回收站，将在 ${remaining}被永久删除。`
    : `${elapsedLabel(elapsedMs)}移入回收站，已到永久删除期限。`;
}

export function recycleCleanupMessage(deletedAt: string | null, nowMs = Date.now()) {
  const deletedAtMs = deletedAt ? Date.parse(deletedAt) : Number.NaN;
  if (!Number.isFinite(deletedAtMs)) return `${RECYCLE_RETENTION_DAYS} 天保留期后自动清理`;
  const expiresAt = deletedAtMs + RECYCLE_RETENTION_DAYS * DAY_MS;
  if (nowMs >= expiresAt) return "已到自动清理期限";
  const date = new Date(expiresAt + 8 * HOUR_MS).toISOString().slice(0, 10);
  return `将于 ${date} 自动清理`;
}
