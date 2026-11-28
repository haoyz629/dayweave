import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyTimeWheelSelection } from "../time-range-control";
import { TAG_COLOR_HEX } from "../types/dayweave";
import type { Priority, ScheduleMode, Tag, Task } from "../types/dayweave";
import {
  calcDaySpan,
  fmtDuration,
  fmtMinutes,
  formatDateShortCn,
  parseTimeToMinutes,
} from "../utils/dateUtils";
import { useSaveAttempt } from "../utils/useSaveAttempt";
import { FluentDatePicker } from "./FluentDatePicker";
import { FluentTimeField } from "./FluentTimeField";
import { tip } from "./TooltipHost";

interface InspectorDrawerProps {
  task: Task | null;
  previewTask: Task | null;
  tags: Tag[];
  selectedDate: string;
  todayDate: string;
  pendingLeave?: boolean;
  onClose: () => void;
  onCancelLeave?: () => void;
  onDiscardAndLeave?: () => void;
  onSaveAndLeave?: (next: Task) => Promise<boolean>;
  onPreviewChange: (next: Task) => void;
  onSaveTask: (next: Task) => Promise<boolean>;
  onDeleteTask: (task: Task) => Promise<boolean>;
  onNotify: (msg: string, isError?: boolean) => void;
}

export function hasTaskChanges(orig: Task, draft: Task): boolean {
  if (
    orig.title !== draft.title ||
    orig.note !== draft.note ||
    orig.mode !== draft.mode ||
    orig.tagId !== draft.tagId ||
    orig.priority !== draft.priority ||
    orig.done !== draft.done ||
    orig.date !== draft.date ||
    orig.startMin !== draft.startMin ||
    orig.duration !== draft.duration ||
    orig.dateStart !== draft.dateStart ||
    orig.dateEnd !== draft.dateEnd ||
    orig.subtasks.length !== draft.subtasks.length
  ) {
    return true;
  }
  for (let i = 0; i < orig.subtasks.length; i += 1) {
    const a = orig.subtasks[i];
    const b = draft.subtasks[i];
    if (a.id !== b.id || a.text !== b.text || a.done !== b.done) return true;
  }
  return false;
}

const CloseIcon = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export function InspectorDrawer({
  task,
  previewTask,
  tags,
  selectedDate,
  todayDate,
  pendingLeave = false,
  onClose,
  onCancelLeave,
  onDiscardAndLeave,
  onSaveAndLeave,
  onPreviewChange,
  onSaveTask,
  onDeleteTask,
  onNotify,
}: InspectorDrawerProps) {
  const [newSubText, setNewSubText] = useState("");
  const { pending, saving, save } = useSaveAttempt();
  const trashDialogRef = useRef<HTMLDialogElement>(null);
  const leaveDialogRef = useRef<HTMLDialogElement>(null);
  const [confirmTrashOpen, setConfirmTrashOpen] = useState(false);
  const [trashFailed, setTrashFailed] = useState(false);
  const trashAttempt = useSaveAttempt();
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNewSubText("");
    setConfirmTrashOpen(false);
    setTrashFailed(false);
  }, [task?.id]);

  useEffect(() => {
    if (!confirmTrashOpen) return;
    const dlg = trashDialogRef.current;
    if (dlg && !dlg.open) {
      dlg.showModal();
    }
  }, [confirmTrashOpen]);

  useEffect(() => {
    if (!pendingLeave) return;
    const dlg = leaveDialogRef.current;
    if (dlg && !dlg.open) {
      dlg.showModal();
    }
  }, [pendingLeave]);

  const draft = previewTask ?? task;
  const isDirty = useMemo(
    () => (task && draft ? hasTaskChanges(task, draft) : false),
    [task, draft],
  );

  const handleSave = useCallback(async () => {
    if (!task || !draft || pending.current || !isDirty) return;
    if (!draft.title.trim()) {
      onNotify("请先填写任务标题", true);
      titleInputRef.current?.focus();
      return;
    }
    await save(() => onSaveTask({ ...draft, title: draft.title.trim() }));
  }, [task, draft, pending, isDirty, onNotify, save, onSaveTask]);

  useEffect(() => {
    if (!task) return;
    function onKeyDown(e: KeyboardEvent) {
      if (document.querySelector("dialog[open]")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (isDirty && !pending.current) void handleSave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [task, isDirty, pending, handleSave]);

  if (!task || !draft) return null;

  function applyPatch(patch: Partial<Task>) {
    if (!draft || saving) return;
    onPreviewChange({ ...draft, ...patch });
  }

  const badgeText =
    draft.mode === "timeline"
      ? `已安排 · ${formatDateShortCn(draft.date)}`
      : draft.mode === "flex"
        ? "全天 / 多日"
        : "待安排";

  const spanDays = calcDaySpan(draft.dateStart, draft.dateEnd);
  const subDoneCount = draft.subtasks.filter((s) => s.done).length;
  const poolDisabled = draft.done && draft.mode !== "pool";

  function handleStartChange(val: string) {
    if (!draft) return;
    const current = { start: fmtMinutes(draft.startMin), end: fmtMinutes(draft.startMin + draft.duration) };
    const next = applyTimeWheelSelection("start", val, current, {
      minimumDuration: 15,
      allowMidnightEnd: true,
    });
    const nextStart = parseTimeToMinutes(next.start);
    const nextEnd = next.end === "24:00" ? 24 * 60 : parseTimeToMinutes(next.end);
    applyPatch({ startMin: nextStart, duration: Math.max(15, nextEnd - nextStart) });
  }

  function handleEndChange(val: string) {
    if (!draft) return;
    const current = { start: fmtMinutes(draft.startMin), end: fmtMinutes(draft.startMin + draft.duration) };
    const next = applyTimeWheelSelection("end", val, current, {
      minimumDuration: 15,
      allowMidnightEnd: true,
    });
    const nextStart = parseTimeToMinutes(next.start);
    const nextEnd = next.end === "24:00" ? 24 * 60 : parseTimeToMinutes(next.end);
    applyPatch({ startMin: nextStart, duration: Math.max(15, nextEnd - nextStart) });
  }

  function setDuration(mins: number) {
    if (!draft) return;
    const clamped =
      draft.mode === "timeline" ? Math.max(15, Math.min(24 * 60 - draft.startMin, mins)) : Math.max(15, mins);
    applyPatch({ duration: clamped });
  }

  function handleAddSubtask(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const text = newSubText.trim();
    if (!text) return;
    applyPatch({
      subtasks: [...draft.subtasks, { id: `st-${Date.now()}`, text, done: false }],
    });
    setNewSubText("");
  }

  function handleToggleSubtask(id: string) {
    if (!draft) return;
    applyPatch({
      subtasks: draft.subtasks.map((s) => (s.id === id ? { ...s, done: !s.done } : s)),
    });
  }

  function handleRemoveSubtask(id: string) {
    if (!draft) return;
    applyPatch({
      subtasks: draft.subtasks.filter((s) => s.id !== id),
    });
  }

  return (
    <>
      <div className="dw-drawer-scrim" onClick={() => !saving && onClose()} aria-hidden="true" />
      <aside className="dw-drawer-right" aria-label="任务详情抽屉">
        <div className="dw-drawer-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span className="dw-insp-badge">{badgeText}</span>
            {isDirty && <span className="dw-insp-dirty-badge">未保存</span>}
          </div>
          <button
            type="button"
            className="dw-drawer-close"
            disabled={saving}
            onClick={onClose}
            aria-label="关闭详情"
            {...tip(isDirty ? "放弃未保存修改并关闭" : "关闭详情", { shortcut: "Esc", side: "left" })}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="dw-drawer-body win-scroll">
          {/* Title & Done */}
          <div className="dw-insp-title-row">
            <input
              type="checkbox"
              className="dw-checkbox"
              style={{ marginTop: 4 }}
              disabled={saving}
              checked={draft.done}
              onChange={(e) => applyPatch({ done: e.target.checked })}
            />
            <input
              ref={titleInputRef}
              type="text"
              className="dw-insp-title-input"
              disabled={saving}
              value={draft.title}
              onChange={(e) => applyPatch({ title: e.target.value })}
              placeholder="任务标题"
            />
          </div>

          {/* Colored Tag Picker */}
          <div>
            <span className="dw-field-label">标签</span>
            <div className="dw-chip-wrap">
              {tags.map((tg) => {
                const active = draft.tagId === tg.id;
                return (
                  <button
                    key={tg.id}
                    type="button"
                    disabled={saving}
                    onClick={() => applyPatch({ tagId: tg.id })}
                    className={`dw-choice-pill${active ? " is-active" : ""}`}
                  >
                    <span
                      className="dw-section-dot"
                      style={{ background: TAG_COLOR_HEX[tg.color] ?? TAG_COLOR_HEX.blue }}
                    />
                    {tg.name}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={saving}
                onClick={() => applyPatch({ tagId: "" })}
                className={`dw-choice-pill${!draft.tagId ? " is-neutral-active" : ""}`}
              >
                无标签
              </button>
            </div>
          </div>

          {/* Priority */}
          <div>
            <span className="dw-field-label">优先级</span>
            <div className="dw-chip-wrap">
              {(
                [
                  ["P1", "P1 紧急"],
                  ["P2", "P2 重要"],
                  ["", "普通"],
                ] as [Priority, string][]
              ).map(([val, label]) => (
                <button
                  key={label}
                  type="button"
                  disabled={saving}
                  onClick={() => applyPatch({ priority: val })}
                  className={`dw-prio-btn${draft.priority === val ? " is-active" : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Schedule Mode */}
          <div>
            <span className="dw-field-label">安排方式</span>
            <div className="dw-mode-seg">
              {(
                [
                  ["timeline", "固定时段"],
                  ["flex", "全天 / 多日"],
                  ["pool", "待安排"],
                ] as [ScheduleMode, string][]
              ).map(([m, label]) => {
                const disabled = saving || (m === "pool" && poolDisabled);
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      if (m === "pool" && task.mode === "pool") {
                        applyPatch({
                          mode: "pool",
                          date: task.date,
                          dateStart: task.dateStart,
                          dateEnd: task.dateEnd,
                        });
                        return;
                      }
                      if (draft.mode === "pool" && m !== "pool") {
                        applyPatch({
                          mode: m,
                          date: todayDate,
                          dateStart: todayDate,
                          dateEnd: todayDate,
                        });
                        return;
                      }
                      const nextDate = draft.date || selectedDate || todayDate;
                      if (m === "flex") {
                        const nextStart = draft.dateStart || nextDate;
                        const nextEnd = draft.dateEnd && draft.dateEnd >= nextStart ? draft.dateEnd : nextStart;
                        applyPatch({ mode: m, dateStart: nextStart, dateEnd: nextEnd });
                      } else {
                        applyPatch({ mode: m, date: nextDate, dateStart: nextDate, dateEnd: nextDate });
                      }
                    }}
                    className={`dw-mode-btn${draft.mode === m ? " is-active" : ""}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {poolDisabled && (
              <div className="dw-inline-hint">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ flexShrink: 0 }} aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path strokeLinecap="round" d="M12 8v4M12 16h.01" />
                </svg>
                <span>已完成任务不可移回待安排，请先取消勾选完成</span>
              </div>
            )}
          </div>

          {/* Timeline Time & Duration */}
          {draft.mode === "timeline" && (
            <div className="dw-insp-box">
              <div>
                <label className="dw-field-label">日期</label>
                <FluentDatePicker
                  ariaLabel="任务日期"
                  value={draft.date}
                  onChange={(d) => {
                    if (d) applyPatch({ date: d, dateStart: d, dateEnd: d });
                  }}
                />
              </div>

              <div className="dw-grid-2">
                <div>
                  <label className="dw-field-label">开始时间</label>
                  <FluentTimeField
                    edge="start"
                    value={fmtMinutes(draft.startMin)}
                    onChange={handleStartChange}
                  />
                </div>
                <div>
                  <label className="dw-field-label">结束时间</label>
                  <FluentTimeField
                    edge="end"
                    allowMidnight
                    value={fmtMinutes(draft.startMin + draft.duration)}
                    onChange={handleEndChange}
                  />
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
                    {fmtDuration(draft.duration)}
                  </span>
                </div>
                <div className="dw-chip-wrap">
                  {[15, 30, 45, 60, 90, 120].map((m) => (
                    <button
                      key={m}
                      type="button"
                      disabled={saving}
                      onClick={() => setDuration(m)}
                      className={`dw-dur-quick-btn${draft.duration === m ? " is-accent" : ""}`}
                    >
                      {fmtDuration(m)}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={saving || draft.duration <= 15}
                    onClick={() => setDuration(draft.duration - 15)}
                    className="dw-dur-quick-btn"
                  >
                    -15m
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setDuration(draft.duration + 15)}
                    className="dw-dur-quick-btn"
                  >
                    +15m
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Flex / Multi-Day Date Range */}
          {draft.mode === "flex" && (
            <div className="dw-insp-box">
              <div className="dw-grid-2">
                <div>
                  <label className="dw-field-label">开始日期</label>
                  <FluentDatePicker
                    ariaLabel="开始日期"
                    value={draft.dateStart}
                    onChange={(s) => {
                      if (!s) return;
                      applyPatch({
                        dateStart: s,
                        dateEnd: draft.dateEnd < s ? s : draft.dateEnd,
                      });
                    }}
                  />
                </div>
                <div>
                  <label className="dw-field-label">结束日期</label>
                  <FluentDatePicker
                    ariaLabel="结束日期"
                    value={draft.dateEnd}
                    onChange={(end) => {
                      if (!end) return;
                      applyPatch({
                        dateEnd: end < draft.dateStart ? draft.dateStart : end,
                      });
                    }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: "var(--w-text-2)" }}>持续天数</span>
                <span className="dw-badge-multi tabular-nums">
                  {spanDays > 1 ? `跨多日 · 共 ${spanDays} 天` : "全天"}
                </span>
              </div>
            </div>
          )}

          {/* Pool Estimated Duration */}
          {draft.mode === "pool" && (
            <div className="dw-insp-box">
              <span style={{ fontSize: 12, color: "var(--w-text-2)" }}>预计耗时</span>
              <div className="dw-chip-wrap">
                {[15, 30, 45, 60, 90, 120].map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={saving}
                    onClick={() => setDuration(m)}
                    className={`dw-dur-quick-btn${draft.duration === m ? " is-accent" : ""}`}
                  >
                    {fmtDuration(m)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Subtasks Checklist */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <span className="dw-field-label" style={{ marginBottom: 0 }}>
                子任务
              </span>
              <span style={{ fontSize: 12, color: "var(--w-text-3)" }} className="tabular-nums">
                {subDoneCount}/{draft.subtasks.length}
              </span>
            </div>
            {draft.subtasks.length > 0 && (
              <div className="dw-subtask-list">
                {draft.subtasks.map((s) => (
                  <div key={s.id} className="dw-subtask-item">
                    <label className="dw-subtask-label">
                      <input
                        type="checkbox"
                        className="dw-checkbox"
                        disabled={saving}
                        checked={s.done}
                        onChange={() => handleToggleSubtask(s.id)}
                      />
                      <span className={`dw-subtask-text${s.done ? " is-done" : ""}`}>{s.text}</span>
                    </label>
                    <button
                      type="button"
                      className="dw-drawer-close"
                      style={{ width: 24, height: 24 }}
                      disabled={saving}
                      onClick={() => handleRemoveSubtask(s.id)}
                      aria-label="删除子任务"
                      {...tip("删除子任务", { side: "left" })}
                    >
                      <CloseIcon size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={handleAddSubtask} style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                className="dw-input"
                style={{ flex: 1, height: 32, padding: "0 10px" }}
                disabled={saving}
                value={newSubText}
                onChange={(e) => setNewSubText(e.target.value)}
                placeholder="添加子步骤，回车确认"
              />
              <button type="submit" className="dw-btn-ghost" disabled={saving}>
                添加
              </button>
            </form>
          </div>

          {/* Notes */}
          <div>
            <label className="dw-field-label">备注</label>
            <textarea
              rows={3}
              className="dw-textarea"
              style={{ width: "100%", padding: 10, resize: "vertical" }}
              disabled={saving}
              value={draft.note}
              onChange={(e) => applyPatch({ note: e.target.value })}
              placeholder="补充背景说明或参考链接"
            />
          </div>
        </div>

        <div className="dw-drawer-footer">
          <button
            type="button"
            className="dw-btn-text-danger"
            disabled={saving || trashAttempt.saving}
            onClick={() => {
              if (trashAttempt.pending.current) return;
              setTrashFailed(false);
              setConfirmTrashOpen(true);
            }}
          >
            移入回收站
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="dw-btn-ghost"
              disabled={saving}
              onClick={onClose}
              {...tip(isDirty ? "放弃修改并还原" : "关闭详情", { shortcut: "Esc", side: "top" })}
            >
              {isDirty ? "取消" : "关闭"}
            </button>
            <button
              type="button"
              className="dw-btn-primary"
              disabled={!isDirty || saving}
              onClick={() => void handleSave()}
              {...tip(isDirty ? "保存修改并生效" : "当前暂无改动", {
                shortcut: isDirty ? "Ctrl+S" : undefined,
                side: "top",
              })}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </aside>

      {confirmTrashOpen && (
        <dialog
          ref={trashDialogRef}
          className="dw-modal"
          aria-labelledby="dw-move-trash-confirm-title"
          aria-describedby="dw-move-trash-confirm-desc"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.stopPropagation();
          }}
          onCancel={(e) => {
            if (trashAttempt.pending.current) e.preventDefault();
          }}
          onClose={() => {
            if (trashAttempt.pending.current) return;
            setConfirmTrashOpen(false);
            setTrashFailed(false);
          }}
        >
          <div className="dw-modal-header">
            <span className="dw-modal-title" id="dw-move-trash-confirm-title">
              移入回收站？
            </span>
          </div>
          <div className="dw-modal-form">
            <p id="dw-move-trash-confirm-desc" style={{ margin: 0, overflowWrap: "anywhere" }}>
              将「{task.title}」移入回收站，可在 30 天内从回收站恢复。
            </p>
            {trashFailed && (
              <p role="alert" style={{ margin: 0, color: "var(--w-rose-text)" }}>
                移入回收站未完成，请重试或取消。
              </p>
            )}
            <div className="dw-modal-footer">
              <button
                type="button"
                className="dw-btn-ghost"
                autoFocus
                disabled={trashAttempt.saving}
                onClick={() => {
                  trashDialogRef.current?.close();
                  setConfirmTrashOpen(false);
                  setTrashFailed(false);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="dw-btn-danger-outline"
                disabled={trashAttempt.saving}
                onClick={async () => {
                  if (trashAttempt.pending.current) return;
                  setTrashFailed(false);
                  if (await trashAttempt.save(() => onDeleteTask(task))) {
                    trashDialogRef.current?.close();
                    setConfirmTrashOpen(false);
                    setTrashFailed(false);
                  } else {
                    setTrashFailed(true);
                  }
                }}
              >
                确认移入
              </button>
            </div>
          </div>
        </dialog>
      )}

      {pendingLeave && (
        <dialog
          ref={leaveDialogRef}
          className="dw-modal"
          aria-labelledby="dw-leave-dirty-title"
          aria-describedby="dw-leave-dirty-desc"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.stopPropagation();
          }}
          onCancel={(e) => {
            if (pending.current) e.preventDefault();
          }}
          onClose={() => {
            if (pending.current) return;
            onCancelLeave?.();
          }}
        >
          <div className="dw-modal-header">
            <span className="dw-modal-title" id="dw-leave-dirty-title">
              放弃未保存修改？
            </span>
          </div>
          <div className="dw-modal-form">
            <p id="dw-leave-dirty-desc" style={{ margin: 0, overflowWrap: "anywhere" }}>
              任务「{draft.title.trim() || task.title}」还有尚未保存的改动，离开后将丢失这些修改。
            </p>
            <div className="dw-modal-footer">
              <button
                type="button"
                className="dw-btn-ghost"
                autoFocus
                disabled={saving}
                onClick={() => {
                  leaveDialogRef.current?.close();
                  onCancelLeave?.();
                }}
              >
                继续编辑
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  className="dw-btn-danger-outline"
                  disabled={saving}
                  onClick={() => {
                    leaveDialogRef.current?.close();
                    onDiscardAndLeave?.();
                  }}
                >
                  放弃修改
                </button>
                <button
                  type="button"
                  className="dw-btn-primary"
                  disabled={saving}
                  onClick={async () => {
                    if (!draft || pending.current) return;
                    if (!draft.title.trim()) {
                      leaveDialogRef.current?.close();
                      onCancelLeave?.();
                      onNotify("请先填写任务标题", true);
                      titleInputRef.current?.focus();
                      return;
                    }
                    const ok = await save(() => (onSaveAndLeave ?? onSaveTask)({ ...draft, title: draft.title.trim() }));
                    if (ok) {
                      leaveDialogRef.current?.close();
                    }
                  }}
                >
                  {saving ? "保存中…" : "保存并离开"}
                </button>
              </div>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
