// Compatibility boundary for localStorage created before the Dayweave rename.
export const RECURRING_DRAFT_KEY = "dayweave.recurring_item_draft";
const LEGACY_RECURRING_DRAFT_KEY = "jinxu.recurring_item_draft";

export function readRecurringDraft(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): string | null {
  const current = storage.getItem(RECURRING_DRAFT_KEY);
  if (current !== null) {
    storage.removeItem(LEGACY_RECURRING_DRAFT_KEY);
    return current;
  }
  const legacy = storage.getItem(LEGACY_RECURRING_DRAFT_KEY);
  if (legacy === null) return null;
  // Keep the source if writing is unavailable (quota/security), but allow import.
  try {
    storage.setItem(RECURRING_DRAFT_KEY, legacy);
    storage.removeItem(LEGACY_RECURRING_DRAFT_KEY);
  } catch {
    // Retain the old value for a later retry.
  }
  return legacy;
}
