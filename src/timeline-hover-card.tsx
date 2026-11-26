import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Priority } from "./tauri";
import { SeparatedCopy } from "./copy-separator";
import { TaskTagList } from "./task-tag-editor";

export type TimelineTooltipContent = {
  kind: "普通任务" | "单日任务" | "多日任务" | "任务安排" | "计划草案" | "固定日程" | "重复事项";
  title: string;
  time: string;
  detail: string;
  tone: "execution" | "execution-completed" | "execution-partial" | "execution-blocked" | "execution-cancelled" | "execution-not_started" | "draft" | "fixed" | "recurring" | "task";
  url?: string;
  note?: string;
  tags?: string[];
  statusLabel?: string;
  priority?: Priority | null;
  timeRange?: string;
  duration?: string;
  footerLead?: string;
  footerText?: string;
  footerKind?: "hint" | "completed" | "incomplete" | "info";
};
export type TimelineTooltipState = TimelineTooltipContent & {
  left: number;
  top: number;
  placement: "above" | "below";
  pointer?: { x: number; y: number };
};

const hoverPriorityLabels: Record<Priority, string> = {
  urgent: "P0",
  high: "P1",
  medium: "P2",
  low: "P3"
};

export function isTaskTimelineTooltip(content: TimelineTooltipContent) {
  return ["普通任务", "单日任务", "多日任务", "重复事项"].includes(content.kind);
}

export function timelineHoverPosition(
  point: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number }
) {
  const margin = 12, gap = 12;
  const maxLeft = Math.max(margin, viewport.width - size.width - margin);
  const maxTop = Math.max(margin, viewport.height - size.height - margin);
  const left = point.x + gap + size.width <= viewport.width - margin
    ? point.x + gap : point.x - gap - size.width;
  const top = point.y + gap + size.height <= viewport.height - margin
    ? point.y + gap : point.y - gap - size.height >= margin
      ? point.y - gap - size.height : point.y - size.height / 2;
  return { left: Math.max(margin, Math.min(maxLeft, left)), top: Math.max(margin, Math.min(maxTop, top)) };
}

function parseHoverTime(time: string, timeRange?: string, duration?: string) {
  if (timeRange !== undefined) return { range: timeRange, duration: duration ?? "" };
  const match = time.match(/^(.+?)\s*\(([^()]+)\)$/);
  if (match) return { range: match[1].replace(/\s*-\s*/, "–"), duration: duration ?? match[2] };
  return { range: time.replace(/\s*-\s*/, "–"), duration: duration ?? "" };
}

function resolveHoverStatusLabel(content: TimelineTooltipContent) {
  if (content.statusLabel) return content.statusLabel;
  switch (content.tone) {
    case "execution-completed": return "已完成";
    case "execution-partial": return "部分完成";
    case "execution-blocked": return "受阻";
    case "execution-not_started": return "未完成";
    case "execution-cancelled": return "已取消";
    case "draft": return "计划草案";
    case "fixed": return "固定日程";
    case "task": return "进行中";
    default: return "已安排";
  }
}

function resolveFooterKind(content: TimelineTooltipContent): "hint" | "completed" | "incomplete" | "info" {
  if (content.footerKind) return content.footerKind;
  if (content.tone === "execution-completed") return "completed";
  if (content.tone === "execution-not_started" || content.tone === "execution-blocked") return "incomplete";
  if (content.tone === "fixed" || content.tone === "task") return "info";
  return "hint";
}

function HoverIcon({ name }: { name: "link" | "note" | "recurring" | "hint" | "completed" | "incomplete" | "info" }) {
  switch (name) {
    case "link":
      return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>;
    case "note":
      return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M8 13h8M8 17h5" /></svg>;
    case "recurring":
      return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></svg>;
    case "completed":
      return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m9 12 2 2 4-4" /></svg>;
    case "incomplete":
      return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>;
    case "info":
      return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>;
    default:
      return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4" /></svg>;
  }
}

export function TimelineHoverCopyButton({ field, text, targetRef }: {
  field: "url" | "note";
  text: string;
  targetRef: RefObject<HTMLElement>;
}) {
  const [phase, setPhase] = useState<"default" | "success" | "fallback">("default");
  const [hintVisible, setHintVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hintTimer = useRef<number | null>(null);
  const resetTimer = useRef<number | null>(null);
  const requestRef = useRef(0);
  const hintId = `timeline-copy-${field}-hint`;
  const shortcut = /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "Cmd+C" : "Ctrl+C";

  function clearHintTimer() {
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    hintTimer.current = null;
  }
  function hideHint() {
    clearHintTimer();
    setHintVisible(false);
  }
  function showHint() {
    clearHintTimer();
    hintTimer.current = window.setTimeout(() => { hintTimer.current = null; setHintVisible(true); }, 300);
  }

  useEffect(() => {
    requestRef.current += 1;
    setPhase("default");
    setHintVisible(false);
    return () => {
      requestRef.current += 1;
      clearHintTimer();
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = null;
    };
  }, [text]);

  async function copy() {
    const request = ++requestRef.current;
    hideHint();
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = null;
    try {
      await navigator.clipboard.writeText(text);
      if (request !== requestRef.current) return;
      setPhase("success");
      resetTimer.current = window.setTimeout(() => { resetTimer.current = null; setPhase("default"); }, 1800);
    } catch {
      if (request !== requestRef.current) return;
      const target = targetRef.current;
      const selection = window.getSelection();
      if (target && selection) {
        const range = document.createRange();
        range.selectNodeContents(target);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setPhase("fallback");
      setHintVisible(true);
    }
  }

  const showTooltip = hintVisible && phase !== "success";
  return <span className="timeline-copy-control">
    <button type="button" ref={buttonRef} className={`timeline-hover-copy${phase === "success" ? " is-copied" : ""}`}
      aria-label={phase === "success" ? "已复制" : field === "url" ? "复制任务链接" : "复制任务备注"} aria-describedby={showTooltip ? hintId : undefined}
      onPointerEnter={showHint} onPointerLeave={() => { if (document.activeElement !== buttonRef.current) hideHint(); }}
      onFocus={showHint} onBlur={hideHint} onClick={() => void copy()}>
      <svg className={phase === "success" ? "timeline-copy-icon is-success" : "timeline-copy-icon"} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {phase === "success" ? <path d="m5 12 4 4L19 6" /> : <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>}
      </svg>
    </button>
    {showTooltip && <span id={hintId} className={`timeline-copy-hint${phase === "fallback" ? " is-fallback" : ""}`} role="tooltip">{phase === "fallback" ? `复制失败，请按 ${shortcut} 完成复制` : "复制到剪贴板"}</span>}
  </span>;
}

function renderHoverCardSections({ content, interactive, urlRef, noteRef }: {
  content: TimelineTooltipContent;
  interactive: boolean;
  urlRef?: RefObject<HTMLSpanElement>;
  noteRef?: RefObject<HTMLParagraphElement>;
}) {
  const statusLabel = resolveHoverStatusLabel(content);
  const { range, duration } = parseHoverTime(content.time, content.timeRange, content.duration);
  const isRecurring = content.kind === "重复事项";
  const priority = !isRecurring && content.priority ? content.priority : null;
  const showKind = content.kind !== statusLabel;
  const tags = content.tags ?? [];
  const hasTags = tags.length > 0;
  const hasAttrs = Boolean(priority || showKind || hasTags);
  const footerLead = content.footerLead ?? "";
  const footerText = content.footerText ?? content.detail;
  const showFooter = Boolean(footerLead || footerText);
  const footerKind = resolveFooterKind(content);

  return <>
    <header className="timeline-hover-meta timeline-hover-header">
      <span className="timeline-hover-status">{statusLabel}</span>
      <time className="timeline-hover-time">
        <span>{range}</span>
        {duration && <span className="timeline-hover-duration">{duration}</span>}
      </time>
    </header>
    <div className="timeline-hover-body">
      <strong className="timeline-hover-title">{content.title}</strong>
      {hasAttrs && <div className="timeline-hover-attrs">
        {priority && <span className={`timeline-hover-priority priority-${priority}`}><i aria-hidden="true" />{hoverPriorityLabels[priority]}</span>}
        {showKind && <span className={`timeline-hover-kind${isRecurring ? " is-recurring" : ""}`}>{isRecurring && <HoverIcon name="recurring" />}{content.kind}</span>}
        {(priority || showKind) && hasTags && <span className="timeline-hover-attr-sep" aria-hidden="true" />}
        <TaskTagList tags={tags} expanded />
      </div>}
      {(content.url || content.note) && <div className="timeline-hover-details">
        {content.url && <section className="timeline-hover-resource" aria-label="任务 URL">
          <span className="timeline-hover-res-icon" aria-hidden="true"><HoverIcon name="link" /></span>
          <span className="timeline-hover-url" ref={urlRef}>{content.url}</span>
          {interactive && urlRef && <TimelineHoverCopyButton field="url" text={content.url} targetRef={urlRef} />}
        </section>}
        {content.url && content.note && <span className="timeline-hover-divider" aria-hidden="true" />}
        {content.note && <section className="timeline-hover-resource" aria-label="任务备注">
          <span className="timeline-hover-res-icon" aria-hidden="true"><HoverIcon name="note" /></span>
          <p className="timeline-hover-note" ref={noteRef}>{content.note}</p>
          {interactive && noteRef && <TimelineHoverCopyButton field="note" text={content.note} targetRef={noteRef} />}
        </section>}
      </div>}
    </div>
    {showFooter && <footer className="timeline-hover-footer">
      <span className="timeline-hover-footer-lead">
        <HoverIcon name={footerKind} />
        <span>
          {footerLead && <><strong>{footerLead}</strong>{footerText && <span className="timeline-hover-footer-sep" aria-hidden="true">·</span>}</>}
          {footerText && <SeparatedCopy text={footerText} />}
        </span>
      </span>
    </footer>}
  </>;
}

export function TimelineStaticHoverCard({ content }: { content: TimelineTooltipState }) {
  return <aside
    id="timeline-time-block-tooltip"
    className={`timeline-hover-card tone-${content.tone} placement-${content.placement}`}
    style={{ left: content.left, top: content.top }}
    role="tooltip"
  >
    {renderHoverCardSections({ content, interactive: false })}
  </aside>;
}

export function TaskTimelineHoverCard({ content, cardRef, onPointerEnter, onPointerLeave, onFocus, onBlur }: {
  content: TimelineTooltipState;
  cardRef: RefObject<HTMLElement>;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const urlRef = useRef<HTMLSpanElement>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const measure = () => {
      const next = timelineHoverPosition(content.pointer ?? { x: content.left, y: content.top }, card.getBoundingClientRect(), {
        width: document.documentElement.clientWidth, height: document.documentElement.clientHeight
      });
      setPosition(previous => previous.left === next.left && previous.top === next.top ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [content, cardRef]);

  return <aside id="timeline-time-block-tooltip" ref={cardRef}
    className={`timeline-hover-card task-type-hover interactive-hover-card tone-${content.tone}${content.kind === "重复事项" ? " is-recurring-kind" : ""}`}
    style={position} role="dialog" aria-modal={false} aria-label={`${content.title}任务资料`} tabIndex={-1}
    onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} onFocus={onFocus} onBlur={onBlur}>
    {renderHoverCardSections({ content, interactive: true, urlRef, noteRef })}
  </aside>;
}
