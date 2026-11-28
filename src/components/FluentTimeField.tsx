import { useEffect, useId, useRef, useState } from "react";
import { normalizeClockInput, sanitizeTimeInput, TimeRangeEdge } from "../time-range-control";
import { TimeWheelPopover, TimeWheelTrigger } from "../time-wheel-picker";

interface FluentTimeFieldProps {
  value: string; // HH:MM
  edge?: TimeRangeEdge;
  allowMidnight?: boolean;
  ariaLabel?: string;
  onChange: (nextClock: string) => void;
}

export function FluentTimeField({
  value,
  edge = "start",
  allowMidnight = false,
  ariaLabel,
  onChange,
}: FluentTimeFieldProps) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commitText(raw: string) {
    const trimmed = raw.trim();
    const normalized = allowMidnight && trimmed === "24:00" ? "24:00" : normalizeClockInput(trimmed);
    if (normalized) {
      setDraft(normalized);
      if (normalized !== value) onChange(normalized);
    } else {
      setDraft(value);
    }
  }

  return (
    <div ref={containerRef} className={`dw-time-field${open ? " is-open" : ""}`}>
      <input
        type="text"
        size={5}
        inputMode="numeric"
        autoComplete="off"
        maxLength={5}
        value={draft}
        aria-label={ariaLabel ?? (edge === "start" ? "开始时间" : "结束时间")}
        placeholder="HH:MM"
        className="dw-time-field-input"
        onChange={(e) => {
          const clean = sanitizeTimeInput(e.target.value);
          setDraft(clean);
          const normalized = allowMidnight && clean === "24:00" ? "24:00" : normalizeClockInput(clean);
          if (normalized && normalized.length === 5 && clean.length === 5) {
            onChange(normalized);
          }
        }}
        onBlur={() => commitText(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitText(draft);
            setOpen(false);
          } else if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      />

      <TimeWheelTrigger
        active={open}
        controlsId={popoverId}
        label={edge === "start" ? "选择开始时间" : "选择结束时间"}
        onToggle={() => setOpen((v) => !v)}
      />

      <TimeWheelPopover
        id={popoverId}
        open={open}
        edge={edge}
        value={value}
        allowMidnightEnd={allowMidnight}
        anchorRef={containerRef}
        onSelect={(nextClock) => {
          setDraft(nextClock);
          onChange(nextClock);
        }}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
