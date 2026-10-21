import { blockResultEditable } from "./task-result.ts";

export type ReviewDraft = {
  result: "completed" | "partial" | "not_completed" | null;
  outcome: "completed" | "partial" | "not_started" | "cancelled" | "blocked" | null;
  actual_minutes: string;
  defer_reason: string;
  notes: string;
  remaining_workload_minutes: string;
};
export type RecurringReviewDraft = { outcome: "completed" | "partial" | "not_completed" | null; notes: string };
export type DraftIdentity = { review_date: string; item_type: "task" | "recurring"; item_id: string };
export type StoredReviewDraft = DraftIdentity & { payload_json: string; revision: number };

function dayNumber(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const value = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date ? value / 86400000 : NaN;
}

// Dates are already CST calendar dates, not local browser timestamps.
export function canRecordReview(date: string, today: string) {
  const age = dayNumber(today) - dayNumber(date);
  return Number.isFinite(age) && age >= 0 && age < 7;
}

export function canCaptureTaskResult(date: string, _today: string, block: {
  task_status: string; review: unknown; execution_status: string;
  execution_captured_at: string | null; actual_minutes: number | null; ends_at?: string;
  result_date?: string | null; result_ends_at?: string | null;
}, now = Date.now()) {
  if (!["open", "scheduled", "done"].includes(block.task_status)) return false;
  return blockResultEditable(date, now) && (block.result_date == null || block.result_date === date);
}

export function canCaptureRecurringResult(date: string, today: string, outcome: string | null, writable: boolean) {
  return writable && canRecordReview(date, today) && (date === today || !outcome);
}

export function optionalReviewMinutes(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(Number(value))) throw new Error("请填写不小于 0 的整数分钟，或留空。");
  return Number(value);
}

export function reviewNeedsAttention(outcome: string | null) { return outcome !== "completed"; }

export function normalizeTodayNavigation(active: string) {
  return { active: active === "复盘" ? "今日" : active };
}

export function restoreReviewDraft<T extends Record<string, unknown>>(base: T, payload: string): T {
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return base;
    const next = { ...base };
    for (const key of Object.keys(base)) {
      const value = parsed[key];
      if (key === "result" && ![null, "completed", "partial", "not_completed"].includes(value)) continue;
      if (key === "outcome" && ![null, "completed", "partial", "not_completed", "not_started", "cancelled", "blocked"].includes(value)) continue;
      if (key !== "result" && key !== "outcome" && typeof value !== "string") continue;
      (next as Record<string, unknown>)[key] = value;
    }
    return next;
  } catch { return base; }
}

export function mergeReviewDrafts<T>(base: Record<string, T>, persisted: Record<string, T>, current: Record<string, T>, committedId?: string) {
  return Object.fromEntries(Object.keys(base).map((id) => [id, id === committedId ? base[id] : current[id] ?? persisted[id] ?? base[id]]));
}

// Serial automatic writes; failures retain pending inputs.
// Formal submissions flush the queue before clearing their own draft.
export class ReviewDraftQueue {
  private pending = new Map<string, DraftIdentity & { payload_json: string }>();
  private revisions = new Map<string, number>();
  private tail: Promise<void> = Promise.resolve();
  private readonly write: (identity: DraftIdentity, payload: string, revision: number) => Promise<{ revision: number }>;
  constructor(write: (identity: DraftIdentity, payload: string, revision: number) => Promise<{ revision: number }>) { this.write = write; }
  private key(identity: DraftIdentity) { return `${identity.review_date}/${identity.item_type}/${identity.item_id}`; }
  hydrate(rows: StoredReviewDraft[]) {
    for (const row of rows) this.revisions.set(this.key(row), row.revision);
  }
  stage(identity: DraftIdentity, payload: unknown) { this.pending.set(this.key(identity), { ...identity, payload_json: JSON.stringify(payload) }); }
  get dirty() { return this.pending.size > 0; }
  forget(identity: DraftIdentity) { const key = this.key(identity); this.pending.delete(key); this.revisions.delete(key); }
  flush(): Promise<void> {
    const work = this.tail.catch(() => {}).then(async () => {
      while (this.pending.size) {
        const [key, entry] = this.pending.entries().next().value!;
        const saved = await this.write(entry, entry.payload_json, this.revisions.get(key) ?? 0);
        this.revisions.set(key, saved.revision);
        if (this.pending.get(key) === entry) this.pending.delete(key);
      }
    });
    this.tail = work;
    return work;
  }
}
