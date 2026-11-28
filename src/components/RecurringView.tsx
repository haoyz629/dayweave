import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { applyTimeWheelSelection } from "../time-range-control";
import { TAG_COLOR_HEX } from "../types/dayweave";
import type { Priority, RecurrenceFrequency, RecurringRule, RecurringRuleInput, Tag } from "../types/dayweave";
import {
  fmtDuration,
  fmtMinutes,
  formatDateShortCn,
  formatRelativeTimestamp,
  isStatutoryWorkday,
  parseDateParts,
  parseTimeToMinutes,
  shiftDate,
  WEEKDAY_SHORT_CN,
  weekdayNumMon1,
} from "../utils/dateUtils";
import { useSaveAttempt } from "../utils/useSaveAttempt";
import { FluentDatePicker } from "./FluentDatePicker";
import { FluentSelect } from "./FluentSelect";
import { FluentTimeField } from "./FluentTimeField";
import { tip } from "./TooltipHost";

interface RecurringViewProps {
  rules: RecurringRule[];
  archivedRules: RecurringRule[];
  tags: Tag[];
  todayDate: string;
  focusRuleId?: string | null;
  onConsumeFocusRule?: () => void;
  onCreateRule: (input: RecurringRuleInput) => Promise<boolean>;
  onUpdateRule: (ruleId: string, input: RecurringRuleInput) => Promise<boolean>;
  onToggleRule: (rule: RecurringRule) => void;
  onArchiveRule: (ruleId: string) => Promise<boolean>;
  onRestoreRule: (rule: RecurringRule) => Promise<boolean>;
}

type RecurringConfirmAction =
  | { kind: "archive"; rule: RecurringRule }
  | { kind: "restore"; rule: RecurringRule };

function describeFrequency(rule: RecurringRule): string {
  if (rule.frequency === "daily") return "每天";
  if (rule.frequency === "weekdays") return "每个法定工作日";
  if (rule.frequency === "weekly") {
    const names = rule.weekdays
      .slice()
      .sort((a, b) => a - b)
      .map((w) => WEEKDAY_SHORT_CN[w - 1])
      .filter(Boolean);
    return names.length ? `每周${names.join("、")}` : "每周";
  }
  return `每月 ${rule.monthDay ?? 1} 日`;
}

function computeNextOccurrenceLabel(rule: RecurringRule, todayDate: string): string {
  if (!rule.active) return "已暂停";
  for (let offset = 0; offset <= 45; offset++) {
    const d = shiftDate(todayDate, offset);
    if (d < rule.startsOn) continue;
    if (rule.endsOn && d > rule.endsOn) return "已结束";
    let match = false;
    if (rule.frequency === "daily") match = true;
    else if (rule.frequency === "weekdays") match = isStatutoryWorkday(d);
    else if (rule.frequency === "weekly") match = rule.weekdays.includes(weekdayNumMon1(d));
    else if (rule.frequency === "monthly") {
      const p = parseDateParts(d);
      const maxD = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
      match = p.day === Math.min(rule.monthDay ?? 1, maxD);
    }
    if (match) {
      const dayLabel = offset === 0 ? "今天" : offset === 1 ? "明天" : formatDateShortCn(d);
      const timeLabel =
        rule.mode === "timeline" && rule.startMin !== null ? ` ${fmtMinutes(rule.startMin)}` : "";
      return `${dayLabel}${timeLabel}`;
    }
  }
  return "待排期";
}

export function RecurringView({
  rules,
  archivedRules,
  tags,
  todayDate,
  focusRuleId = null,
  onConsumeFocusRule,
  onCreateRule,
  onUpdateRule,
  onToggleRule,
  onArchiveRule,
  onRestoreRule,
}: RecurringViewProps) {
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [highlightedRuleId, setHighlightedRuleId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const { pending, saving, save } = useSaveAttempt();
  const [editingRule, setEditingRule] = useState<RecurringRule | null>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);
  const [confirmAction, setConfirmAction] = useState<RecurringConfirmAction | null>(null);
  const [confirmFailed, setConfirmFailed] = useState(false);
  const confirmAttempt = useSaveAttempt();

  // Modal form fields
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [tagId, setTagId] = useState("");
  const [priority, setPriority] = useState<Priority>("");
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("weekdays");
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);
  const [monthDay, setMonthDay] = useState<number>(1);
  const [mode, setMode] = useState<"timeline" | "flex">("timeline");
  const [startStr, setStartStr] = useState("09:30");
  const [duration, setDuration] = useState(30);
  const [startsOn, setStartsOn] = useState(todayDate);
  const [endsOn, setEndsOn] = useState("");

  const tagMap = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  useEffect(() => {
    if (!modalOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || pending.current) return;
      e.preventDefault();
      setModalOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, pending]);

  useEffect(() => {
    if (!confirmAction) return;
    const dlg = confirmDialogRef.current;
    if (dlg && !dlg.open) {
      dlg.showModal();
    }
  }, [confirmAction]);

  useEffect(() => {
    if (!focusRuleId) return;
    const activeRule = rules.find((r) => r.id === focusRuleId);
    if (activeRule) {
      setTab("active");
      setHighlightedRuleId(activeRule.id);
      openEditModal(activeRule);
      onConsumeFocusRule?.();
      return;
    }
    const archivedRule = archivedRules.find((r) => r.id === focusRuleId);
    if (archivedRule) {
      setTab("archived");
      setHighlightedRuleId(archivedRule.id);
      onConsumeFocusRule?.();
      return;
    }
    onConsumeFocusRule?.();
  }, [focusRuleId, rules, archivedRules, onConsumeFocusRule]);

  useEffect(() => {
    if (!highlightedRuleId) return;
    const timer = window.setTimeout(() => setHighlightedRuleId(null), 2200);
    return () => window.clearTimeout(timer);
  }, [highlightedRuleId]);

  function openConfirm(next: RecurringConfirmAction) {
    if (confirmAttempt.pending.current) return;
    setConfirmFailed(false);
    setConfirmAction(next);
  }

  function openNewModal() {
    setEditingRule(null);
    setTitle("");
    setNote("");
    setTagId(tags[0]?.id ?? "");
    setPriority("");
    setFrequency("weekdays");
    setWeekdays([1, 3, 5]);
    setMonthDay(parseDateParts(todayDate).day);
    setMode("timeline");
    setStartStr("09:30");
    setDuration(30);
    setStartsOn(todayDate);
    setEndsOn("");
    setModalOpen(true);
  }

  function openEditModal(rule: RecurringRule) {
    setEditingRule(rule);
    setTitle(rule.title);
    setNote(rule.note);
    setTagId(rule.tagId);
    setPriority(rule.priority);
    setFrequency(rule.frequency);
    setWeekdays(rule.weekdays.length ? rule.weekdays : [weekdayNumMon1(todayDate)]);
    setMonthDay(rule.monthDay ?? parseDateParts(rule.startsOn).day);
    setMode(rule.mode);
    setStartStr(rule.startMin !== null ? fmtMinutes(rule.startMin) : "09:30");
    setDuration(rule.duration);
    setStartsOn(rule.startsOn);
    setEndsOn(rule.endsOn ?? "");
    setModalOpen(true);
  }

  function toggleWeekday(w: number) {
    setWeekdays((prev) => {
      if (prev.includes(w)) {
        return prev.length > 1 ? prev.filter((x) => x !== w) : prev;
      }
      return [...prev, w].sort((a, b) => a - b);
    });
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || pending.current) return;
    const payload: RecurringRuleInput = {
      title: title.trim(),
      note: note.trim(),
      tagId,
      priority,
      frequency,
      weekdays: frequency === "weekly" ? weekdays : [],
      monthDay: frequency === "monthly" ? monthDay : null,
      mode,
      startMin: mode === "timeline" ? parseTimeToMinutes(startStr) : null,
      duration,
      startsOn: startsOn || todayDate,
      endsOn: endsOn.trim() ? endsOn.trim() : null,
      active: editingRule ? editingRule.active : true,
    };
    const saved = await save(() => (editingRule ? onUpdateRule(editingRule.id, payload) : onCreateRule(payload)));
    if (saved) {
      setModalOpen(false);
      if (!editingRule) setTab("active");
    }
  }

  const visibleRules = tab === "active" ? rules : archivedRules;

  return (
    <main className="dw-module" aria-label="重复规则">
      <div className="dw-module-header">
        <div>
          <h2 className="dw-module-title">重复规则</h2>
          <p className="dw-module-desc">为固定例会、日常习惯和周期事项自动生成日程</p>
        </div>
        <button type="button" className="dw-btn-primary" onClick={openNewModal}>
          + 新建重复规则
        </button>
      </div>

      <div className="dw-module-toolbar">
        <div className="dw-module-toolbar-inner">
          <div className="dw-tab-group" role="tablist" aria-label="重复规则分栏">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "active"}
              onClick={() => setTab("active")}
              className={`dw-tab-btn${tab === "active" ? " is-active" : ""}`}
            >
              <span>当前规则</span>
              <span className="dw-tab-count tabular-nums">{rules.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "archived"}
              onClick={() => setTab("archived")}
              className={`dw-tab-btn${tab === "archived" ? " is-active" : ""}`}
            >
              <span>已归档</span>
              <span className="dw-tab-count tabular-nums">{archivedRules.length}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="dw-module-body win-scroll">
        {visibleRules.length === 0 ? (
          <div className="dw-empty-state">
            {tab === "active" ? "暂无重复规则，点击右上角「+ 新建重复规则」创建" : "暂无已归档的重复规则"}
          </div>
        ) : (
          <div className="dw-recurring-grid">
            {visibleRules.map((r) => {
              const isArchived = tab === "archived";
              const tg = tagMap.get(r.tagId);
              const dotColor = !isArchived && r.active && tg ? TAG_COLOR_HEX[tg.color] ?? TAG_COLOR_HEX.blue : "#64748B";
              const timeText =
                r.mode === "timeline" && r.startMin !== null
                  ? `${fmtMinutes(r.startMin)}–${fmtMinutes(r.startMin + r.duration)} · ${fmtDuration(r.duration)}`
                  : "全天";

              return (
                <div
                  key={r.id}
                  className={`dw-recurring-card${isArchived ? " is-archived" : r.active ? "" : " is-paused"}${highlightedRuleId === r.id ? " is-focused" : ""}`}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: dotColor,
                          flexShrink: 0,
                        }}
                        aria-hidden="true"
                      />
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--w-text)" }}>
                        {r.title}
                      </span>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 12, color: "var(--w-text-2)" }}>
                      {tg && <span className="dw-badge-subtle">{tg.name}</span>}
                      <span className="dw-badge-subtle" style={{ fontWeight: 500 }}>
                        {describeFrequency(r)}
                      </span>
                      <span className="font-mono tabular-nums">{timeText}</span>
                    </div>

                    <div style={{ fontSize: 12, color: "var(--w-text-3)" }} className="tabular-nums">
                      {isArchived
                        ? `归档于 ${formatRelativeTimestamp(r.updatedAt, todayDate)}`
                        : `下次安排：${computeNextOccurrenceLabel(r, todayDate)}`}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      {isArchived ? (
                        <button
                          type="button"
                          className="dw-btn-ghost"
                          style={{ height: 28, padding: "0 10px" }}
                          disabled={confirmAttempt.saving}
                          onClick={() => openConfirm({ kind: "restore", rule: r })}
                        >
                          恢复规则
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="dw-btn-ghost"
                            style={{ height: 28, padding: "0 10px" }}
                            onClick={() => openEditModal(r)}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="dw-btn-danger-soft"
                            disabled={confirmAttempt.saving}
                            onClick={() => openConfirm({ kind: "archive", rule: r })}
                            {...tip("停止生成，保留已完成记录", { side: "top" })}
                          >
                            归档
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {isArchived ? (
                    <span className="dw-badge-subtle" style={{ flexShrink: 0 }}>
                      已归档
                    </span>
                  ) : (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={r.active}
                      aria-label={`启停 ${r.title}`}
                      onClick={() => onToggleRule(r)}
                      className={`sw-track${r.active ? " on" : ""}`}
                    >
                      <div className="sw-thumb" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create / Edit Recurring Rule Modal */}
      {modalOpen && (
        <div
          className="dw-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !pending.current) setModalOpen(false);
          }}
        >
          <div className="dw-modal" role="dialog" aria-modal="true" aria-label="重复规则编辑">
            <div className="dw-modal-header">
              <span className="dw-modal-title">{editingRule ? "编辑重复规则" : "新建重复规则"}</span>
              <button
                type="button"
                className="dw-drawer-close"
                disabled={saving}
                onClick={() => setModalOpen(false)}
                aria-label="关闭弹窗"
                {...tip("关闭弹窗", { shortcut: "Esc", side: "left" })}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="dw-modal-form win-scroll">
              <fieldset disabled={saving} style={{ display: "contents" }}>
                <input
                  type="text"
                  autoFocus
                  className="dw-input"
                  style={{ width: "100%", height: 36, padding: "0 12px", fontSize: 14, fontWeight: 500 }}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="重复事项名称（如：晨间站会）"
                  required
                />

                <div className="dw-grid-2">
                  <div>
                    <label className="dw-field-label">重复频率</label>
                    <FluentSelect<RecurrenceFrequency>
                      ariaLabel="重复频率"
                      value={frequency}
                      onChange={setFrequency}
                      options={[
                        { value: "daily", label: "每天" },
                        { value: "weekdays", label: "每个法定工作日" },
                        { value: "weekly", label: "每周指定星期" },
                        { value: "monthly", label: "每月指定日期" },
                      ]}
                    />
                  </div>

                  <div>
                    <label className="dw-field-label">任务标签</label>
                    <FluentSelect
                      ariaLabel="任务标签"
                      value={tagId}
                      onChange={setTagId}
                      options={[
                        { value: "", label: "无标签（默认蓝）", dotColor: "#2F66D8" },
                        ...tags.map((tg) => ({
                          value: tg.id,
                          label: tg.name,
                          dotColor: TAG_COLOR_HEX[tg.color] ?? TAG_COLOR_HEX.blue,
                        })),
                      ]}
                    />
                  </div>
                </div>

                {frequency === "weekly" && (
                  <div>
                    <span className="dw-field-label">选择重复星期</span>
                    <div className="dw-weekday-picks">
                      {WEEKDAY_SHORT_CN.map((label, idx) => {
                        const w = idx + 1;
                        return (
                          <button
                            key={w}
                            type="button"
                            onClick={() => toggleWeekday(w)}
                            className={`dw-weekday-btn${weekdays.includes(w) ? " is-active" : ""}`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {frequency === "monthly" && (
                  <div>
                    <label className="dw-field-label">每月第几日（1–31）</label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      className="dw-input font-mono tabular-nums"
                      style={{ width: 120, height: 32, padding: "0 10px" }}
                      value={monthDay}
                      onChange={(e) => setMonthDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
                    />
                  </div>
                )}

                <div className="dw-grid-2">
                  <div>
                    <label className="dw-field-label">安排方式</label>
                    <FluentSelect<"timeline" | "flex">
                      ariaLabel="安排方式"
                      value={mode}
                      onChange={setMode}
                      options={[
                        { value: "timeline", label: "固定时段" },
                        { value: "flex", label: "全天" },
                      ]}
                    />
                  </div>

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
                </div>

                {mode === "timeline" && (
                  <div className="dw-insp-box">
                    <div className="dw-grid-2">
                      <div>
                        <label className="dw-field-label">开始时间</label>
                        <FluentTimeField edge="start" value={startStr} onChange={handleStartChange} />
                      </div>
                      <div>
                        <label className="dw-field-label">结束时间</label>
                        <FluentTimeField edge="end" allowMidnight value={endStr} onChange={handleEndChange} />
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

                <div className="dw-grid-2">
                  <div>
                    <label className="dw-field-label">开始日期</label>
                    <FluentDatePicker ariaLabel="重复开始日期" value={startsOn} onChange={(d) => d && setStartsOn(d)} />
                  </div>
                  <div>
                    <label className="dw-field-label">结束日期（留空表示长期）</label>
                    <FluentDatePicker
                      ariaLabel="重复结束日期"
                      value={endsOn}
                      placeholder="长期有效"
                      clearable
                      clearLabel="设为长期"
                      onChange={setEndsOn}
                    />
                  </div>
                </div>

                <div className="dw-modal-footer">
                  <span style={{ fontSize: 12, color: "var(--w-text-3)" }}>生效后自动在对应日期显示</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="dw-btn-ghost" onClick={() => setModalOpen(false)}>
                      取消
                    </button>
                    <button type="submit" className="dw-btn-primary" disabled={saving}>
                      {saving ? "保存中…" : editingRule ? "保存修改" : "创建规则"}
                    </button>
                  </div>
                </div>
              </fieldset>
            </form>
          </div>
        </div>
      )}

      {confirmAction && (
        <dialog
          ref={confirmDialogRef}
          className="dw-modal"
          aria-labelledby="dw-recurring-confirm-title"
          aria-describedby="dw-recurring-confirm-desc"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.stopPropagation();
          }}
          onCancel={(e) => {
            if (confirmAttempt.pending.current) e.preventDefault();
          }}
          onClose={() => {
            if (confirmAttempt.pending.current) return;
            setConfirmAction(null);
            setConfirmFailed(false);
          }}
        >
          <div className="dw-modal-header">
            <span className="dw-modal-title" id="dw-recurring-confirm-title">
              {confirmAction.kind === "archive" ? "归档重复规则？" : "恢复重复规则？"}
            </span>
          </div>
          <div className="dw-modal-form">
            <p id="dw-recurring-confirm-desc" style={{ margin: 0, overflowWrap: "anywhere" }}>
              {confirmAction.kind === "archive"
                ? `将归档「${confirmAction.rule.title}」并停止生成后续日程，未完成的实例会一并移除；已完成的历史记录仍保留在原日期。归档后可在「已归档」分栏查看或随时恢复。`
                : `将恢复「${confirmAction.rule.title}」并重新启用，自动按规则生成后续日程。`}
            </p>
            {confirmFailed && (
              <p role="alert" style={{ margin: 0, color: "var(--w-rose-text)" }}>
                {confirmAction.kind === "archive" ? "归档未完成，请重试或取消。" : "恢复未完成，请重试或取消。"}
              </p>
            )}
            <div className="dw-modal-footer">
              <button
                type="button"
                className="dw-btn-ghost"
                autoFocus
                disabled={confirmAttempt.saving}
                onClick={() => {
                  confirmDialogRef.current?.close();
                  setConfirmAction(null);
                  setConfirmFailed(false);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className={confirmAction.kind === "archive" ? "dw-btn-danger-outline" : "dw-btn-primary"}
                disabled={confirmAttempt.saving}
                onClick={async () => {
                  if (!confirmAction || confirmAttempt.pending.current) return;
                  setConfirmFailed(false);
                  const ok = await confirmAttempt.save(() =>
                    confirmAction.kind === "archive"
                      ? onArchiveRule(confirmAction.rule.id)
                      : onRestoreRule(confirmAction.rule),
                  );
                  if (ok) {
                    confirmDialogRef.current?.close();
                    setConfirmAction(null);
                    setConfirmFailed(false);
                  } else {
                    setConfirmFailed(true);
                  }
                }}
              >
                {confirmAction.kind === "archive" ? "确认归档" : "确认恢复"}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </main>
  );
}
