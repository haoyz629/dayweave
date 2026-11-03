import { ReactNode } from "react";
import { compactBlockDuration } from "./task-block-display";
import "./task-time-range-fields.css";

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
      {startInput}
      <span className="task-time-range-arrow" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg></span>
      {endInput}
    </div>
    {showPresets && <div className="task-time-range-presets" aria-label="推荐时长"><span>推荐时长</span>{[
      { minutes: 15, label: "15 分钟" },
      { minutes: 30, label: "30 分钟" },
      { minutes: 60, label: "1 小时" },
      { minutes: 120, label: "2 小时" }
    ].map((preset) => <button key={preset.minutes} type="button" disabled={disabled || !Number.isFinite(maxDuration) || preset.minutes > maxDuration} aria-pressed={duration === preset.minutes} onClick={() => onDuration(preset.minutes)}>{preset.label}</button>)}</div>}
  </section>;
}
