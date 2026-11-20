import { ReactNode } from "react";
import { compactBlockDuration } from "./task-block-display";
import "./task-time-range-fields.css";

const durationPresets = [
  { minutes: 15, label: "15m" },
  { minutes: 30, label: "30m" },
  { minutes: 45, label: "45m" },
  { minutes: 60, label: "1h" },
  { minutes: 90, label: "1.5h" },
  { minutes: 120, label: "2h" },
] as const;

export function TaskDurationPresets({ duration, maxDuration, disabled = false, onDuration }: {
  duration: number;
  maxDuration: number;
  disabled?: boolean;
  onDuration: (minutes: number) => void;
}) {
  return <div className="selection-presets-row" role="group" aria-label="快捷时长">
    {durationPresets.map((preset) => <button
      key={preset.minutes}
      type="button"
      className="selection-preset-btn"
      disabled={disabled || !Number.isFinite(maxDuration) || preset.minutes > maxDuration}
      aria-pressed={duration === preset.minutes}
      onClick={() => onDuration(preset.minutes)}
    >{preset.label}</button>)}
  </div>;
}

export function TaskTimeRangeFields({ startInput, endInput, duration, maxDuration, disabled = false, showPresets = true, onDuration }: {
  startInput: ReactNode;
  endInput: ReactNode;
  duration: number;
  maxDuration: number;
  disabled?: boolean;
  showPresets?: boolean;
  onDuration: (minutes: number) => void;
}) {
  return <section className="task-time-range-fields" aria-label="安排时间">
    <div className="task-time-range-heading"><span>时间范围</span><output>{compactBlockDuration(duration)}</output></div>
    <div className="task-time-range-inputs" aria-label="选择开始和结束时间">
      <div className="task-time-range-box"><small aria-hidden="true">开始</small>{startInput}</div>
      <span className="task-time-range-arrow" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /><path className="task-time-range-forward" display="none" strokeWidth="2" d="M5 12h14m-5-5 5 5-5 5" /></svg></span>
      <div className="task-time-range-box"><small aria-hidden="true">结束</small>{endInput}</div>
    </div>
    {showPresets && <TaskDurationPresets duration={duration} maxDuration={maxDuration} disabled={disabled} onDuration={onDuration} />}
  </section>;
}
