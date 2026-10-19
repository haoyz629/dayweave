import assert from "node:assert/strict";
import test from "node:test";
import { readRecurringDraft, RECURRING_DRAFT_KEY } from "./legacy-storage.ts";

const legacyKey = "jinxu.recurring_item_draft"; // Migration fixture, not a current storage key.
function storageFor(entries = []) {
  const values = new Map(entries);
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test("old recurring draft migrates once without losing its value", () => {
  const storage = storageFor([[legacyKey, '{"title":"draft"}']]);
  assert.equal(readRecurringDraft(storage), '{"title":"draft"}');
  assert.equal(storage.getItem(RECURRING_DRAFT_KEY), '{"title":"draft"}');
  assert.equal(storage.getItem(legacyKey), null);
  assert.equal(readRecurringDraft(storage), '{"title":"draft"}');
});

test("current draft wins and stale legacy key is removed", () => {
  const storage = storageFor([[legacyKey, "old"], [RECURRING_DRAFT_KEY, "new"]]);
  assert.equal(readRecurringDraft(storage), "new");
  assert.equal(storage.getItem(legacyKey), null);
});

test("failed persistence keeps legacy source and permits retry", () => {
  const storage = storageFor([[legacyKey, "old"]]);
  const setItem = storage.setItem;
  storage.setItem = () => { throw new Error("quota"); };
  assert.equal(readRecurringDraft(storage), "old");
  assert.equal(storage.getItem(legacyKey), "old");
  storage.setItem = setItem;
  assert.equal(readRecurringDraft(storage), "old");
  assert.equal(storage.getItem(legacyKey), null);
});

test("fresh storage has no side effects", () => {
  const storage = storageFor();
  assert.equal(readRecurringDraft(storage), null);
  assert.equal(storage.values.size, 0);
});
