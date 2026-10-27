import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

export type TimelineTooltipContent = {
  kind: "普通任务" | "单日任务" | "多日任务" | "任务安排" | "计划草案" | "固定日程" | "重复事项" | "待安排任务" | "非工作时间";
  title: string;
  time: string;
  detail: string;
  tone: "execution" | "execution-completed" | "execution-partial" | "execution-blocked" | "execution-cancelled" | "execution-not_started" | "draft" | "fixed" | "recurring" | "task" | "nonworking";
  url?: string;
  note?: string;
};
export type TimelineTooltipState = TimelineTooltipContent & {
  left: number;
  top: number;
  placement: "above" | "below";
  pointer?: { x: number; y: number };
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
    {showTooltip && <span id={hintId} className="timeline-copy-hint" role="tooltip">{phase === "fallback" ? `复制失败，请按 ${shortcut} 完成复制` : "复制到剪贴板"}</span>}
  </span>;
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
    className={`timeline-hover-card task-type-hover interactive-hover-card tone-${content.tone}`}
    style={position} role="dialog" aria-modal={false} aria-label={`${content.title}任务资料`} tabIndex={-1}
    onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} onFocus={onFocus} onBlur={onBlur}>
    <div className="timeline-hover-meta"><span>{content.kind}</span><time>{content.time}</time></div>
    <strong>{content.title}</strong>
    {(content.url || content.note) && <div className="timeline-hover-details">
      {content.url && <section className="timeline-hover-resource" aria-label="任务 URL">
        <span className="timeline-hover-url" ref={urlRef}>{content.url}</span>
        <TimelineHoverCopyButton field="url" text={content.url} targetRef={urlRef} />
      </section>}
      {content.url && content.note && <span className="timeline-hover-divider" aria-hidden="true" />}
      {content.note && <section className="timeline-hover-resource" aria-label="任务备注">
        <p className="timeline-hover-note" ref={noteRef}>{content.note}</p>
        <TimelineHoverCopyButton field="note" text={content.note} targetRef={noteRef} />
      </section>}
    </div>}
    {content.detail && <p>{content.detail}</p>}
  </aside>;
}
