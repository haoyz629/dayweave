import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { applyTimeWheelSelection } from "../time-range-control";
import { TAG_COLOR_HEX } from "../types/dayweave";
import type { Draft, DraftInput, Priority, ScheduleMode, Tag, TaskInput } from "../types/dayweave";
import { fmtDuration, fmtMinutes, parseTimeToMinutes } from "../utils/dateUtils";
import { useSaveAttempt } from "../utils/useSaveAttempt";
import { FluentDatePicker } from "./FluentDatePicker";
import { FluentSelect } from "./FluentSelect";
import { FluentTimeField } from "./FluentTimeField";
import { tip } from "./TooltipHost";

interface CreateModalProps {
  selectedDate: string;
  autoDraft: boolean;
  defaultDuration: number;
  tags: Tag[];
  drafts: Draft[];
  initialDraft: Draft | null;
  onClose: () => void;
  onSubmitTask: (input: TaskInput, fromDraftId: string | null) => Promise<boolean>;
  onSaveDraft: (input: DraftInput) => Promise<boolean>;
  onPickDraft: (draft: Draft) => void;
  onResetBlank?: () => void;
  onNotify: (msg: string) => void;
}

export function CreateModal({
  selectedDate,
  autoDraft,
  defaultDuration,
  tags,
  drafts,
  initialDraft,
  onClose,
  onSubmitTask,
  onSaveDraft,
  onPickDraft,
  onResetBlank,
  onNotify,
}: CreateModalProps) {
  const [draftId, setDraftId] = useState<string>(initialDraft?.id ?? "");
  const [title, setTitle] = useState(initialDraft?.title ?? "");
  const [note, setNote] = useState(initialDraft?.note ?? "");
  const [mode, setMode] = useState<ScheduleMode>(initialDraft?.mode ?? "pool");
  const [tagId, setTagId] = useState(initialDraft?.tagId ?? "");
  const [priority, setPriority] = useState<Priority>(initialDraft?.priority ?? "");
  const [duration, setDuration] = useState<number>(initialDraft?.duration ?? defaultDuration);
  const [startStr, setStartStr] = useState<string>(
    initialDraft ? fmtMinutes(initialDraft.startMin) : "15:00",
  );
  const [dateStart, setDateStart] = useState<string>(initialDraft?.dateStart || selectedDate);
  const [dateEnd, setDateEnd] = useState<string>(initialDraft?.dateEnd || selectedDate);
  const [draftListOpen, setDraftListOpen] = useState(false);
  const { pending, saving, save } = useSaveAttempt();
  const titleRef = useRef<HTMLInputElement>(null);
  const selectedTagId = tags.some((tg) => tg.id === tagId) ? tagId : "";
  const activeDraft = useMemo(
    () => (draftId ? drafts.find((d) => d.id === draftId) ?? null : null),
    [draftId, drafts],
  );
  const isEditingDraft = Boolean(activeDraft);
  const otherDraftCount = isEditingDraft ? Math.max(0, drafts.length - 1) : drafts.length;

  const tagOptions = useMemo(
    () => [
      { value: "", label: "无标签（默认蓝）", dotColor: TAG_COLOR_HEX.blue },
      ...tags.map((tg) => ({
        value: tg.id,
        label: tg.name,
        dotColor: TAG_COLOR_HEX[tg.color] ?? TAG_COLOR_HEX.blue,
      })),
    ],
    [tags],
  );

  useEffect(() => {
    const titleInput = titleRef.current!;
    const modal = titleInput.closest<HTMLElement>(".dw-modal")!;
    const backdrop = modal.parentElement!;
    const opener = document.activeElement;
    const background = [...backdrop.parentElement!.children].filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement && !el.inert && el.matches(".dw-titlebar, .dw-workspace-body"),
    );
    background.forEach((el) => {
      el.inert = true;
    });
    titleInput.focus();

    function trapTab(e: KeyboardEvent) {
      if (e.key !== "Tab" || e.defaultPrevented) return;
      const stops = [...modal.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href], [tabindex]")]
        .filter((el) => el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length > 0);
      const first = stops[0];
      const last = stops.at(-1);
      const active = document.activeElement;
      if (!stops.some((stop) => stop === active) || (e.shiftKey ? active === first : active === last)) {
        e.preventDefault();
        (e.shiftKey ? last ?? modal : first ?? modal).focus();
      }
    }
    window.addEventListener("keydown", trapTab);
    return () => {
      window.removeEventListener("keydown", trapTab);
      background.forEach((el) => {
        el.inert = false;
      });
      if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) opener.focus();
      else document.querySelector<HTMLElement>(".dw-quick-detail-btn")?.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      e.preventDefault();
      if (!e.repeat) void handleDismiss(autoDraft);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function handleModeChange(nextMode: ScheduleMode) {
    setMode(nextMode);
    if (nextMode === "pool") {
      setDateStart(selectedDate);
      setDateEnd(selectedDate);
    } else if (nextMode === "timeline") {
      const d = dateStart || selectedDate;
      setDateStart(d);
      setDateEnd(d);
    }
  }

  const startMinVal = parseTimeToMinutes(startStr);
  const endStr = fmtMinutes(Math.min(24 * 60, startMinVal + duration));

  function handleStartChange(val: string) {
    const current = { start: startStr, end: endStr };
    const next = applyTimeWheelSelection("start", val, current, {
      minimumDuration: 15,
      allowMidnightEnd: true,
    });
    const nextStart = parseTimeToMinutes(next.start);
    const nextEnd = next.end === "24:00" ? 24 * 60 : parseTimeToMinutes(next.end);
    setStartStr(next.start);
    setDuration(Math.max(15, nextEnd - nextStart));
  }

  function handleEndChange(val: string) {
    const current = { start: startStr, end: endStr };
    const next = applyTimeWheelSelection("end", val, current, {
      minimumDuration: 15,
      allowMidnightEnd: true,
    });
    const nextStart = parseTimeToMinutes(next.start);
    const nextEnd = next.end === "24:00" ? 24 * 60 : parseTimeToMinutes(next.end);
    setStartStr(next.start);
    setDuration(Math.max(15, nextEnd - nextStart));
  }

  function handleQuickDuration(mins: number) {
    setDuration(Math.max(15, Math.min(24 * 60 - startMinVal, mins)));
  }

  async function handleDismiss(shouldSaveDraft: boolean) {
    if (pending.current) return;
    if (shouldSaveDraft && (title.trim() || note.trim())) {
      const dStart = dateStart || selectedDate;
      const dEnd = mode === "flex" && dateEnd && dateEnd >= dStart ? dateEnd : dStart;
      const saved = await save(() =>
        onSaveDraft({
          id: draftId || undefined,
          title: title.trim() || "未命名草稿",
          note: note.trim(),
          mode,
          tagId: selectedTagId,
          priority,
          duration,
          startMin: parseTimeToMinutes(startStr),
          dateStart: dStart,
          dateEnd: dEnd,
        }),
      );
      if (!saved) return;
    }
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending.current) return;
    if (!title.trim()) {
      onNotify("请先填写任务标题");
      titleRef.current?.focus();
      return;
    }
    const startMin = parseTimeToMinutes(startStr);
    const dStart = dateStart || selectedDate;
    const dEnd = mode === "flex" && dateEnd && dateEnd >= dStart ? dateEnd : dStart;
    const targetDate = mode === "timeline" ? dStart : selectedDate;
    const saved = await save(() =>
      onSubmitTask(
        {
          title: title.trim(),
          note: note.trim(),
          mode,
          tagId: selectedTagId,
          priority,
          done: false,
          date: targetDate,
          startMin,
          duration,
          dateStart: dStart,
          dateEnd: dEnd,
          subtasks: [],
        },
        draftId || null,
      ),
    );
    if (saved) onClose();
  }

  return (
    <div
      className="dw-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleDismiss(autoDraft);
      }}
    >
      <div
        className="dw-modal"
        data-modal-popup-root
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dw-create-modal-title"
      >
        <div className="dw-modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span id="dw-create-modal-title" className="dw-modal-title">
              新建任务
            </span>
            <span style={{ fontSize: 12, color: "var(--w-text-3)" }}>
              {autoDraft ? "关闭时自动存草稿" : "关闭时不存草稿"}
            </span>
          </div>
          <button
            type="button"
            className="dw-drawer-close"
            disabled={saving}
            onClick={() => handleDismiss(autoDraft)}
            aria-label="关闭弹窗"
            {...tip("关闭弹窗", { shortcut: "Esc", side: "left" })}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* Draft Recovery / Active Restored Draft Banner */}
        {drafts.length > 0 && (
          <div className={`dw-modal-draft-banner${isEditingDraft ? " is-restored" : ""}`}>
            <div className="dw-modal-draft-row">
              <span>
                {!isEditingDraft
                  ? `你有 ${drafts.length} 条未提交草稿`
                  : otherDraftCount === 0
                    ? "已恢复草稿，可继续编辑"
                    : `正在编辑草稿 · 另有 ${otherDraftCount} 条未提交草稿`}
              </span>
              <div className="dw-modal-draft-actions">
                {isEditingDraft && onResetBlank && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      if (!pending.current) onResetBlank();
                    }}
                    className="dw-modal-draft-action is-subtle"
                  >
                    新建空白
                  </button>
                )}
                {(!isEditingDraft || otherDraftCount > 0) && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setDraftListOpen((v) => !v)}
                    className="dw-modal-draft-action"
                  >
                    <span>
                      {draftListOpen ? "收起" : isEditingDraft ? "切换草稿" : "展开恢复"}
                    </span>
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      style={{ transform: draftListOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 150ms" }}
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            {draftListOpen && (!isEditingDraft || otherDraftCount > 0) && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {drafts.map((d) => {
                  const isCurrent = isEditingDraft && d.id === draftId;
                  return (
                    <div
                      key={d.id}
                      role={isCurrent ? undefined : "button"}
                      tabIndex={isCurrent ? undefined : 0}
                      aria-current={isCurrent ? "true" : undefined}
                      className={`dw-modal-draft-item${isCurrent ? " is-current" : ""}`}
                      onClick={() => {
                        if (!isCurrent && !pending.current) {
                          setDraftId(d.id);
                          onPickDraft(d);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (!isCurrent && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          if (!pending.current) {
                            setDraftId(d.id);
                            onPickDraft(d);
                          }
                        }
                      }}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontWeight: 500,
                        }}
                      >
                        {d.title || "未命名草稿"}
                      </span>
                      <span
                        className={`dw-modal-draft-item-state${isCurrent ? " is-current" : ""}`}
                      >
                        {isCurrent ? "编辑中" : isEditingDraft ? "切换编辑" : "恢复编辑"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="dw-modal-form win-scroll">
          <fieldset disabled={saving} style={{ display: "contents" }}>
            <input
              ref={titleRef}
              type="text"
              className="dw-input"
              style={{ width: "100%", height: 36, padding: "0 12px", fontSize: 14, fontWeight: 500 }}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="准备做什么？（标题）"
            />

            <textarea
              rows={2}
              className="dw-textarea"
              style={{ width: "100%", padding: 10, resize: "none" }}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="补充描述或参考链接"
            />

            <div className="dw-grid-2">
              <div>
                <label className="dw-field-label">安排方式</label>
                <FluentSelect<ScheduleMode>
                  ariaLabel="安排方式"
                  value={mode}
                  onChange={handleModeChange}
                  options={[
                    { value: "pool", label: "待安排" },
                    { value: "timeline", label: "固定时段" },
                    { value: "flex", label: "全天 / 多日" },
                  ]}
                />
              </div>

              <div>
                <label className="dw-field-label">任务标签</label>
                <FluentSelect
                  ariaLabel="任务标签"
                  value={selectedTagId}
                  placeholder="无标签（默认蓝）"
                  onChange={setTagId}
                  options={tagOptions}
                />
              </div>
            </div>

            {mode === "pool" ? (
              <div className="dw-grid-2">
                <div>
                  <label className="dw-field-label">优先级</label>
                  <FluentSelect<Priority>
                    ariaLabel="优先级"
                    value={priority}
                    onChange={setPriority}
                    options={[
                      { value: "", label: "普通", dotColor: "#64748B" },
                      { value: "P1", label: "P1 紧急", dotColor: "#DC4C64" },
                      { value: "P2", label: "P2 重要", dotColor: "#D97706" },
                    ]}
                  />
                </div>

                <div>
                  <label className="dw-field-label">预计耗时</label>
                  <FluentSelect<number>
                    ariaLabel="预计耗时"
                    value={duration}
                    onChange={setDuration}
                    options={[
                      { value: 15, label: "15 分钟" },
                      { value: 30, label: "30 分钟" },
                      { value: 45, label: "45 分钟" },
                      { value: 60, label: "1 小时" },
                      { value: 90, label: "1.5 小时" },
                      { value: 120, label: "2 小时" },
                    ]}
                  />
                </div>
              </div>
            ) : mode === "timeline" ? (
              <div className="dw-grid-2">
                <div>
                  <label className="dw-field-label">优先级</label>
                  <FluentSelect<Priority>
                    ariaLabel="优先级"
                    value={priority}
                    onChange={setPriority}
                    options={[
                      { value: "", label: "普通", dotColor: "#64748B" },
                      { value: "P1", label: "P1 紧急", dotColor: "#DC4C64" },
                      { value: "P2", label: "P2 重要", dotColor: "#D97706" },
                    ]}
                  />
                </div>

                <div>
                  <label className="dw-field-label">目标日期</label>
                  <FluentDatePicker
                    ariaLabel="目标日期"
                    value={dateStart}
                    onChange={(d) => {
                      if (d) {
                        setDateStart(d);
                        setDateEnd(d);
                      }
                    }}
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="dw-field-label">优先级</label>
                <FluentSelect<Priority>
                  ariaLabel="优先级"
                  value={priority}
                  onChange={setPriority}
                  options={[
                    { value: "", label: "普通", dotColor: "#64748B" },
                    { value: "P1", label: "P1 紧急", dotColor: "#DC4C64" },
                    { value: "P2", label: "P2 重要", dotColor: "#D97706" },
                  ]}
                />
              </div>
            )}

            {mode === "timeline" && (
              <div className="dw-insp-box">
                <div className="dw-grid-2">
                  <div>
                    <label className="dw-field-label">开始时间</label>
                    <FluentTimeField edge="start" value={startStr} onChange={handleStartChange} />
                  </div>
                  <div>
                    <label className="dw-field-label">结束时间</label>
                    <FluentTimeField edge="end" value={endStr} onChange={handleEndChange} />
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 12,
                      color: "var(--w-text-2)",
                      marginBottom: 6,
                    }}
                  >
                    <span>快捷时长</span>
                    <span className="font-mono tabular-nums" style={{ fontWeight: 600, color: "var(--w-accent-ink)" }}>
                      {fmtDuration(duration)}
                    </span>
                  </div>
                  <div className="dw-chip-wrap">
                    {[15, 30, 45, 60, 90, 120].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleQuickDuration(m)}
                        className={`dw-dur-quick-btn${duration === m ? " is-accent" : ""}`}
                      >
                        {fmtDuration(m)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {mode === "flex" && (
              <div className="dw-insp-box">
                <div className="dw-grid-2">
                  <div>
                    <label className="dw-field-label">开始日期</label>
                    <FluentDatePicker
                      ariaLabel="开始日期"
                      value={dateStart}
                      onChange={(s) => {
                        if (!s) return;
                        setDateStart(s);
                        if (dateEnd < s) setDateEnd(s);
                      }}
                    />
                  </div>
                  <div>
                    <label className="dw-field-label">结束日期</label>
                    <FluentDatePicker
                      ariaLabel="结束日期"
                      value={dateEnd}
                      onChange={(end) => {
                        if (!end) return;
                        setDateEnd(end < dateStart ? dateStart : end);
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="dw-modal-footer">
              <button type="button" className="dw-btn-ghost" onClick={() => handleDismiss(true)}>
                {isEditingDraft ? "更新草稿" : "暂存草稿"}
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  className="dw-btn-ghost"
                  style={{ border: "none", background: "transparent" }}
                  onClick={() => handleDismiss(false)}
                >
                  放弃
                </button>
                <button type="submit" className="dw-btn-primary" disabled={saving}>
                  {saving ? "保存中…" : mode === "timeline" ? "创建并安排" : "确认创建"}
                </button>
              </div>
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
