import { FormEvent, PointerEvent as ReactPointerEvent, RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { confirmCreationDraft, createManualTaskDraft, discardTaskDraft, saveTaskDraft, Task, TaskDraft, TaskDraftInput, Priority } from "./tauri";
import { compactBlockDuration } from "./task-block-display";
import { TaskTimeRangeFields } from "./task-time-range-fields";
import { TaskPrioritySelector } from "./task-priority-selector";
import { TaskTagEditor } from "./task-tag-editor";
import { constrainTimeRange, normalizeClockInput, sanitizeTimeInput } from "./time-range-control";
import "./timeline-task-create.css";

export type TimelineCreateRange = { start: number; end: number; dragging?: boolean };
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minute = (value: string) => { if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN; const [h, m] = value.split(":").map(Number); return h * 60 + m; };

// The task model uses same-date timestamps; 24:00 is not a valid time.
function selectedRange(anchor: number, end: number): TimelineCreateRange {
  const start = Math.min(1424, Math.max(0, Math.min(anchor, end)));
  return { start, end: Math.min(1439, Math.max(start + 15, anchor, end)) };
}

export function TimelineTaskCreate({ date, disabled, scrollRef, pixelsPerHour, onRange, onStart, onCreated }: {
  date: string;
  disabled: boolean;
  scrollRef: RefObject<HTMLDivElement>;
  pixelsPerHour: number;
  onRange: (range: TimelineCreateRange | null) => void;
  onStart: () => void;
  onCreated: (task: Task) => Promise<void>;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const pointer = useRef<{ id: number; anchor: number; y: number } | null>(null);
  const frame = useRef(0);
  const rangeRef = useRef<TimelineCreateRange | null>(null);
  const draftRef = useRef<TaskDraft | null>(null);
  const savedInputRef = useRef("");
  const savingRef = useRef(false);
  const [form, setForm] = useState<{ title: string; start: string; end: string; priority: Priority; tags: string[] } | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function clearPointer() {
    const active = pointer.current;
    pointer.current = null;
    cancelAnimationFrame(frame.current);
    if (active && trackRef.current?.hasPointerCapture(active.id)) trackRef.current.releasePointerCapture(active.id);
  }

  function clearRange() { rangeRef.current = null; onRange(null); }
  function cancelSelection() { if (pointer.current) { clearPointer(); clearRange(); } }
  function close() {
    if (savingRef.current) return;
    clearPointer(); clearRange(); setForm(null); setError("");
    const draft = draftRef.current;
    draftRef.current = null; savedInputRef.current = "";
    if (draft) void discardTaskDraft(draft).catch(() => {});
    trackRef.current?.focus({ preventScroll: true });
  }

  function snapAt(y: number) {
    const top = trackRef.current!.getBoundingClientRect().top;
    return Math.max(0, Math.min(1440, Math.round((y - top) / pixelsPerHour * 60 / 15) * 15));
  }

  function updateSelection() {
    if (!pointer.current) return;
    rangeRef.current = selectedRange(pointer.current.anchor, snapAt(pointer.current.y));
    onRange({ ...rangeRef.current, dragging: true });
  }

  function autoScroll() {
    const active = pointer.current, scroller = scrollRef.current;
    if (!active || !scroller) return;
    const rect = scroller.getBoundingClientRect();
    const distance = active.y < rect.top + 36 ? active.y - rect.top - 36
      : active.y > rect.bottom - 36 ? active.y - rect.bottom + 36 : 0;
    if (distance) { scroller.scrollTop += Math.sign(distance) * Math.min(16, Math.abs(distance) / 4); updateSelection(); }
    frame.current = requestAnimationFrame(autoScroll);
  }

  function open(range: TimelineCreateRange) {
    rangeRef.current = range; onRange(range); onStart(); setError("");
    setForm({ title: "", start: clock(range.start), end: clock(range.end), priority: "medium", tags: [] });
  }

  function start(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || !event.isPrimary || form || pointer.current) return;
    event.preventDefault(); onStart();
    pointer.current = { id: event.pointerId, anchor: snapAt(event.clientY), y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    updateSelection(); frame.current = requestAnimationFrame(autoScroll);
  }

  useEffect(() => {
    if (!form) return;
    dialogRef.current?.showModal(); titleRef.current?.focus();
    return () => dialogRef.current?.close();
  }, [Boolean(form)]);

  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && pointer.current) { event.preventDefault(); event.stopPropagation(); cancelSelection(); }
    }
    document.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancelSelection);
    return () => {
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", cancelSelection);
      clearPointer();
      if (draftRef.current && !savingRef.current) void discardTaskDraft(draftRef.current).catch(() => {});
    };
  }, []);

  useEffect(() => { if (disabled) cancelSelection(); }, [disabled]);

  function updateTimes(field: "start" | "end", value: string) {
    if (!form) return;
    const next = { ...form, [field]: value };
    setForm(next); setError("");
    const start = minute(next.start), end = minute(next.end);
    if (Number.isFinite(start) && Number.isFinite(end) && end - start >= 15) {
      rangeRef.current = { start, end }; onRange(rangeRef.current);
    }
  }

  function commitTimeInput(field: "start" | "end", rawValue: string, delta = 0) {
    if (!rangeRef.current) return;
    const value = minute(normalizeClockInput(sanitizeTimeInput(rawValue)));
    const next = constrainTimeRange(field, (Number.isFinite(value) ? value : rangeRef.current[field]) + delta, rangeRef.current, 0, 1439, 15, 1);
    updateTimes(field, clock(next[field]));
  }

  function renderTimeInput(field: "start" | "end") {
    if (!form) return null;
    return <input type="text" name={field} inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={5} value={form[field]} aria-label={field === "start" ? "输入开始时间" : "输入结束时间"}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => { setForm({ ...form, [field]: sanitizeTimeInput(event.target.value) }); setError(""); }}
      onBlur={(event) => commitTimeInput(field, event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); commitTimeInput(field, event.currentTarget.value); event.currentTarget.select(); }
        else if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); commitTimeInput(field, event.currentTarget.value, event.key === "ArrowUp" ? 5 : -5); }
        else if (event.key === "Escape") { event.preventDefault(); updateTimes(field, clock(rangeRef.current![field])); }
      }} />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form || savingRef.current || disabled) return;
    const start = minute(form.start), end = minute(form.end);
    if (!form.title.trim()) { setError("请填写任务标题"); titleRef.current?.focus(); return; }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1439 || end - start < 15) {
      setError("结束时间须晚于开始时间，任务时长至少 15 分钟"); return;
    }
    const input: TaskDraftInput = {
      title: form.title.trim(), notes: null, priority: form.priority,
      earliest_start_date: date, earliest_start_time: form.start,
      due_date: date, due_time: form.end,
      total_workload_minutes: end - start, remaining_workload_minutes: end - start,
      field_states_json: "{}", tags: form.tags, recurrence: null
    };
    savingRef.current = true; setSaving(true); setError("");
    let task: Task;
    try {
      const fingerprint = JSON.stringify(input);
      if (!draftRef.current) draftRef.current = await createManualTaskDraft(input);
      else if (savedInputRef.current !== fingerprint) draftRef.current = await saveTaskDraft(draftRef.current.id, draftRef.current.version, input);
      savedInputRef.current = fingerprint;
      const result = await confirmCreationDraft(draftRef.current);
      if (result.item_type !== "task") throw new Error("任务创建结果异常");
      task = result.item;
      draftRef.current = null; savedInputRef.current = "";
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : String(cause)}；输入已保留，可重试`);
      savingRef.current = false; setSaving(false); return;
    }
    // A successful confirmation must never be retried because a refresh failed.
    try { await onCreated(task); }
    finally { savingRef.current = false; setSaving(false); close(); }
  }

  const duration = rangeRef.current ? rangeRef.current.end - rangeRef.current.start : 0;
  return <>
    <div ref={trackRef} className="selection-create-track" role="button" tabIndex={disabled ? -1 : 0}
      aria-label="框选创建任务" aria-disabled={disabled} title="在右侧拖选时间创建任务；Enter 创建 15 分钟任务"
      onPointerDown={start}
      onPointerMove={(event) => { if (pointer.current?.id === event.pointerId) { pointer.current.y = event.clientY; updateSelection(); } }}
      onPointerUp={(event) => { if (pointer.current?.id !== event.pointerId) return; if (!event.currentTarget.hasPointerCapture(event.pointerId)) { cancelSelection(); return; } updateSelection(); const range = rangeRef.current; clearPointer(); if (range) open(range); }}
      onPointerCancel={cancelSelection} onLostPointerCapture={cancelSelection}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !disabled && !form) {
          event.preventDefault(); event.stopPropagation();
          const rect = scrollRef.current!.getBoundingClientRect();
          open(selectedRange(snapAt(rect.top + 90), snapAt(rect.top + 90)));
        }
      }}><span className="selection-track-plus" aria-hidden="true">＋</span></div>
    {form && createPortal(<dialog ref={dialogRef} role="dialog" className="selection-create-dialog" aria-labelledby="timeline-create-title"
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } }}>
      <header><strong id="timeline-create-title">创建单日任务</strong><button type="button" aria-label="关闭创建任务" disabled={saving} onClick={close}>×</button></header>
      <p className="selection-date">{date.replace(/-/g, " / ")}</p>
      <form noValidate onSubmit={(event) => void submit(event)}>
        <fieldset disabled={saving}>
          <label>任务标题<input ref={titleRef} name="title" maxLength={300} value={form.title} onChange={(event) => { setForm({ ...form, title: event.target.value }); setError(""); }} placeholder="这段时间要做什么？" /></label>
          <TaskTimeRangeFields duration={duration} maxDuration={1439 - minute(form.start)} disabled={saving}
            startInput={renderTimeInput("start")}
            endInput={renderTimeInput("end")}
            onDuration={(minutes) => updateTimes("end", clock(minute(form.start) + minutes))} />
          <div className="selection-task-options">
            <div className="selection-priority-field"><label htmlFor="timeline-create-priority">优先级</label><TaskPrioritySelector id="timeline-create-priority" value={form.priority} disabled={saving || disabled} onChange={(priority) => setForm({ ...form, priority })} /></div>
            <TaskTagEditor id="timeline-create-tags" tags={form.tags} disabled={saving || disabled} onChange={(tags) => setForm({ ...form, tags })} />
          </div>
        </fieldset>
        {error && <p className="selection-error" role="alert">{error}</p>}
        <footer><small>{duration >= 15 ? compactBlockDuration(duration) : "至少 15 分钟"}</small><div><button type="button" disabled={saving} onClick={close}>取消</button><button type="submit" className="primary-action" disabled={saving || disabled}>{saving ? "正在创建…" : "创建任务"}</button></div></footer>
      </form>
    </dialog>, document.body)}
  </>;
}
