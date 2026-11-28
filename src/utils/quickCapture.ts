import type { Priority, ScheduleMode, Tag } from "../types/dayweave";

export interface ParsedQuickCapture {
  title: string;
  mode: ScheduleMode;
  startMin: number;
  duration: number;
  priority: Priority;
  tagId: string;
}

export function extractTagFromText(text: string, tags: Tag[]): { tagId: string; cleaned: string } {
  // Quick-entry tokens are whitespace-delimited, just like times and durations.
  let match: { index: number; token: string; id: string } | undefined;
  for (const tag of tags) {
    const token = `#${tag.name}`;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found = new RegExp(`(^|\\s)${escaped}(?=\\s|$)`).exec(text);
    if (!found) continue;
    const index = found.index + found[1].length;
    if (!match || index < match.index || (index === match.index && token.length > match.token.length)) {
      match = { index, token, id: tag.id };
    }
  }
  if (!match) return { tagId: "", cleaned: text };
  const { index, token, id } = match;
  return { tagId: id, cleaned: `${text.slice(0, index)}${text.slice(index + token.length)}`.replace(/\s{2,}/g, " ").trim() };
}

export function parseQuickCapture(
  rawInput: string,
  tags: Tag[],
  defaultDuration = 60,
  snapStep = 15,
): ParsedQuickCapture {
  const raw = rawInput.trim();
  const timeMatch = raw.match(/(?:^|\s)(\d{1,2})[:：](\d{2})(?=\s|$)/);
  const durH = raw.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*h(?=\s|$)/i);
  const durM = raw.match(/(?:^|\s)(\d+)\s*m(?=\s|$)/i);
  const isP1 = /#P1(?=\s|$)/i.test(raw);
  const isP2 = !isP1 && /#P2(?=\s|$)/i.test(raw);
  const isFlex = /#(?:全天|不限时)(?=\s|$)/.test(raw);
  const { tagId, cleaned } = extractTagFromText(raw, tags);

  let duration = defaultDuration;
  if (durH) {
    duration = Math.max(15, Math.min(24 * 60, Math.round((parseFloat(durH[1]) * 60) / snapStep) * snapStep));
  } else if (durM) {
    duration = Math.max(15, Math.min(24 * 60, Math.round(parseInt(durM[1], 10) / snapStep) * snapStep));
  }

  let title = cleaned
    .replace(/(?:^|\s)\d{1,2}[:：]\d{2}(?=\s|$)/g, " ")
    .replace(/(?:^|\s)\d+(?:\.\d+)?\s*h(?=\s|$)/gi, " ")
    .replace(/(?:^|\s)\d+\s*m(?=\s|$)/gi, " ")
    .replace(/#P[123](?=\s|$)/gi, " ")
    .replace(/#(?:全天|不限时)(?=\s|$)/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!title) title = "新建事项";

  let mode: ScheduleMode = "pool";
  let startMin = 17 * 60;
  if (timeMatch) {
    mode = "timeline";
    const h = Math.max(0, Math.min(23, parseInt(timeMatch[1], 10)));
    const m = Math.max(0, Math.min(59, parseInt(timeMatch[2], 10)));
    startMin = Math.min(24 * 60 - 15, h * 60 + Math.round(m / snapStep) * snapStep);
  } else if (isFlex) {
    mode = "flex";
  }

  return {
    title,
    mode,
    startMin,
    duration,
    priority: isP1 ? "P1" : isP2 ? "P2" : "",
    tagId,
  };
}
