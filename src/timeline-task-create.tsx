import { FormEvent, PointerEvent as ReactPointerEvent, RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { confirmCreationDraft, createManualTaskDraft, discardTaskDraft, saveTaskDraft, Task, TaskDraft, TaskDraftInput, Priority } from "./tauri";
import { TaskPrioritySelector } from "./task-priority-selector";
import { TaskTagEditor } from "./task-tag-editor";
import { joinTaskNotes, splitTaskNotes } from "./task-notes";
import { constrainTimeRange, normalizeClockInput, sanitizeTimeInput } from "./time-range-control";
import "./timeline-task-create.css";
import { TaskDurationPresets } from "./task-time-range-fields";

export type TimelineCreateRange = { start: number; end: number; dragging?: boolean };
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minute = (value: string) => { if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN; const [h, m] = value.split(":").map(Number); return h * 60 + m; };

const weekdayCopy = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

const formatSelectionDateBadge = (dateKey: string) => {
  const [, month, day] = dateKey.split("-").map(Number);
  const weekday = weekdayCopy[new Date(`${dateKey}T00:00:00`).getDay()] ?? "";
  return month && day ? `${month}月${day}日 ${weekday}`.trim() : dateKey.replace(/-/g, " / ");
};

const formatReadableDuration = (minutes: number) => {
  if (minutes < 15) return "至少 15 分钟";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours} 小时 ${rest} 分钟`;
  if (hours) return `${hours} 小时`;
  return `${rest} 分钟`;
};

type SlideCreateFormState = {
  title: string;
  start: string;
  end: string;
  priority: Priority;
  tags: string[];
  notes: string;
  notesExpanded: boolean;
};

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
  const pointer = useRef<{ id: number; anchor: number; y: number; moved: boolean } | null>(null);
  const frame = useRef(0);
  const rangeRef = useRef<TimelineCreateRange | null>(null);
  const draftRef = useRef<TaskDraft | null>(null);
  const savedInputRef = useRef("");
  const savingRef = useRef(false);
  const [form, setForm] = useState<SlideCreateFormState | null>(null);
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
    const active = pointer.current;
    if (!active) return;
    const end = snapAt(active.y);
    if (end !== active.anchor) active.moved = true;
    if (active.moved && end === active.anchor) { clearRange(); return; }
    rangeRef.current = selectedRange(active.anchor, end);
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
    setForm({ title: "", start: clock(range.start), end: clock(range.end), priority: "high", tags: [], notes: "", notesExpanded: false });
  }

  function start(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || !event.isPrimary || form || pointer.current) return;
    event.preventDefault(); onStart();
    pointer.current = { id: event.pointerId, anchor: snapAt(event.clientY), y: event.clientY, moved: false };
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
    const parsedNotes = splitTaskNotes(form.notes ?? "");
    const normalizedNotes = joinTaskNotes(parsedNotes.url.trim(), parsedNotes.body.trim()).trim() || null;
    const input: TaskDraftInput = {
      title: form.title.trim(), notes: normalizedNotes, priority: form.priority,
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
  const startMinute = form ? minute(form.start) : NaN;
  const maxDuration = Number.isFinite(startMinute) ? 1439 - startMinute : NaN;
  const notesParts = splitTaskNotes(form?.notes ?? "");
  const urlPrefixLength = notesParts.url ? 5 + (notesParts.body ? 2 : 0) : 0;
  const hasNotesContent = Boolean(notesParts.url.trim() || notesParts.body.trim());

  return <>
    <div ref={trackRef} className="selection-create-track" role="button" tabIndex={disabled ? -1 : 0}
      aria-label="框选创建任务" aria-disabled={disabled} title="在右侧拖选时间创建任务"
      onPointerDown={start}
      onPointerMove={(event) => { if (pointer.current?.id === event.pointerId) { pointer.current.y = event.clientY; updateSelection(); } }}
      onPointerUp={(event) => { if (pointer.current?.id !== event.pointerId) return; if (!event.currentTarget.hasPointerCapture(event.pointerId)) { cancelSelection(); return; } pointer.current.y = event.clientY; updateSelection(); const range = rangeRef.current; clearPointer(); if (range) open(range); }}
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
      <header className="selection-dialog-header">
        <div className="selection-header-lead">
          <span className="selection-header-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4" />
            </svg>
          </span>
          <strong id="timeline-create-title">创建单日安排</strong>
          <span className="selection-date-pill" title={date}>{formatSelectionDateBadge(date)}</span>
        </div>
        <button type="button" className="selection-close-btn" aria-label="关闭创建任务" disabled={saving} onClick={close}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </header>
      <form noValidate onSubmit={(event) => void submit(event)}>
        <fieldset disabled={saving} className="selection-dialog-body">
          <div className="selection-field">
            <label htmlFor="timeline-create-title-input">任务标题</label>
            <input
              id="timeline-create-title-input"
              ref={titleRef}
              className={`selection-title-input${error.includes("标题") ? " is-invalid" : ""}`}
              name="title"
              maxLength={300}
              autoComplete="off"
              value={form.title}
              onChange={(event) => { setForm({ ...form, title: event.target.value }); setError(""); }}
              placeholder="这段时间准备做什么？"
            />
          </div>

          <section className="selection-time-card" aria-label="安排时间">
            <div className="selection-time-head">
              <span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                时间范围
              </span>
              <output className="selection-duration-pill">{formatReadableDuration(duration)}</output>
            </div>
            <div className="selection-time-inputs" aria-label="选择开始和结束时间">
              <div className="selection-time-box">
                <small aria-hidden="true">开始</small>
                {renderTimeInput("start")}
              </div>
              <span className="selection-time-arrow" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14m-5-5 5 5-5 5" />
                </svg>
              </span>
              <div className="selection-time-box">
                <small aria-hidden="true">结束</small>
                {renderTimeInput("end")}
              </div>
            </div>
            <TaskDurationPresets duration={duration} maxDuration={maxDuration} disabled={saving} onDuration={(minutes) => updateTimes("end", clock(startMinute + minutes))} />
          </section>

          <div className="selection-field selection-priority-field">
            <span className="selection-field-label">优先级</span>
            <TaskPrioritySelector
              id="timeline-create-priority"
              variant="segmented"
              value={form.priority}
              disabled={saving || disabled}
              onChange={(priority) => setForm({ ...form, priority })}
            />
          </div>

          <div className="selection-field selection-tags-field">
            <span className="selection-field-label">标签</span>
            <TaskTagEditor
              id="timeline-create-tags"
              inlineChips
              tags={form.tags}
              disabled={saving || disabled}
              onChange={(tags) => setForm({ ...form, tags })}
            />
          </div>

          <div className={`selection-optional-notes${form.notesExpanded ? " is-expanded" : ""}`}>
            {!form.notesExpanded ? (
              <button
                type="button"
                className={`selection-notes-toggle${hasNotesContent ? " has-content" : ""}`}
                disabled={saving}
                aria-expanded={false}
                onClick={() => {
                  setForm({ ...form, notesExpanded: true });
                  requestAnimationFrame(() => document.getElementById("timeline-create-notes-url")?.focus());
                }}
              >
                <span className="selection-notes-toggle-main">
                  <span className="selection-notes-plus" aria-hidden="true">＋</span>
                  <span>{hasNotesContent ? "查看链接与备注（已填写）" : "添加备注或链接（选填）"}</span>
                </span>
                <span className="selection-notes-toggle-hint">{hasNotesContent ? "点击展开" : "网址与说明"}</span>
              </button>
            ) : (
              <section className="selection-notes-card" aria-label="备注与链接">
                <div className="selection-notes-head">
                  <span>链接与备注</span>
                  <button
                    type="button"
                    className="selection-notes-collapse"
                    disabled={saving}
                    aria-expanded={true}
                    onClick={() => setForm({ ...form, notesExpanded: false })}
                  >
                    收起
                  </button>
                </div>
                <div className="selection-task-notes-inputs">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14 3h7v7M21 3l-9 9" />
                    <path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
                  </svg>
                  <label htmlFor="timeline-create-notes-url" className="task-notes-label">链接</label>
                  <input
                    id="timeline-create-notes-url"
                    type="text"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={saving}
                    value={notesParts.url}
                    maxLength={Math.max(0, 2000 - notesParts.body.length - 7)}
                    placeholder="粘贴网址（选填）"
                    onChange={(event) => setForm({ ...form, notes: joinTaskNotes(event.target.value, notesParts.body) })}
                  />
                  <span className="task-notes-divider" aria-hidden="true" />
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 3h9l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
                    <path d="M14 3v5h5M8 12h7M8 16h7" />
                  </svg>
                  <label htmlFor="timeline-create-notes" className="task-notes-label">备注</label>
                  <textarea
                    id="timeline-create-notes"
                    rows={3}
                    disabled={saving}
                    value={notesParts.body}
                    maxLength={Math.max(0, 2000 - notesParts.url.length - urlPrefixLength)}
                    placeholder="添加说明或补充信息（选填）"
                    onChange={(event) => setForm({ ...form, notes: joinTaskNotes(notesParts.url, event.target.value) })}
                  />
                </div>
              </section>
            )}
          </div>

          {error && (
            <p className="selection-error" role="alert">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4m0 4h.01" />
              </svg>
              <span>{error}</span>
            </p>
          )}
        </fieldset>

        <footer className="selection-dialog-footer">
          <small>
            {Number.isFinite(startMinute) && Number.isFinite(minute(form.end)) && duration >= 15
              ? <>直接排入 <strong>{form.start}–{form.end}</strong></>
              : "至少 15 分钟"}
          </small>
          <div className="selection-footer-actions">
            <button type="button" disabled={saving} onClick={close}>取消</button>
            <button type="submit" className="primary-action" disabled={saving || disabled}>{saving ? "正在创建…" : "创建任务"}</button>
          </div>
        </footer>
      </form>
    </dialog>, document.body)}
  </>;
}
