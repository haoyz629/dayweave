export const MAX_GLOBAL_TAGS = 50;
export const MAX_TASK_TAGS = 10;
export const MAX_TAG_LENGTH = 30;

export function tagKey(value: string) { return value.trim().toLowerCase(); }

export function uniqueTags(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.map((tag) => tag.trim()).filter((tag) => {
    const key = tagKey(tag);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function addTaskTag(tags: readonly string[], input: string): string[] {
  const value = input.trim();
  if (!value) return [...tags];
  const current = uniqueTags(tags);
  // Legacy over-limit (or overlong) selections remain valid until explicitly removed.
  if (matchesTag(current, value)) return current;
  if (Array.from(value).length > MAX_TAG_LENGTH) throw new Error("单个标签不能超过 30 个字符");
  if (current.length >= MAX_TASK_TAGS) throw new Error(`每项最多使用 ${MAX_TASK_TAGS} 个标签`);
  return [...current, value];
}

export function matchesTag(tags: readonly string[], selected: string) {
  return !selected || tags.some((tag) => tagKey(tag) === tagKey(selected));
}

export function matchesTaggedSearch(item: { title: string; notes?: string | null; tags: readonly string[] }, query: string) {
  const key = tagKey(query);
  return !key || [item.title, item.notes ?? "", ...item.tags].some((text) => text.toLowerCase().includes(key));
}
