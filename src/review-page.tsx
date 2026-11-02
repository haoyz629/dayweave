import { MutableRefObject, useEffect, useRef, useState } from "react";
import { DaySchedule, PlanBlock, RecurringOccurrence, RecurringOccurrenceOutcome, getDaySchedule, listRecurringItems, listRecurringOccurrences, listReviewFormDrafts, saveReviewFormDraft, saveExecutionCapture, saveReviewEntry, saveRecurringOccurrenceReview, latestUndo, applyUndo } from "./tauri";
import { canRecordReview, mergeReviewDrafts, optionalReviewMinutes, restoreReviewDraft, reviewNeedsAttention, ReviewDraft, RecurringReviewDraft, ReviewDraftQueue } from "./review-workflow";
import { Toast } from "./feedback";
import { CopySeparator } from "./copy-separator";

type Outcome = NonNullable<ReviewDraft["outcome"]>;
const outcomeCopy: Record<Outcome, string> = { completed: "完成", partial: "部分完成", blocked: "遇到阻塞", cancelled: "放弃本次安排", not_started: "其他原因" };
const resultOptions = [["completed", "完成"], ["partial", "部分完成"], ["not_completed", "未完成"]] as const;
const reasonOptions = [["blocked", "遇到阻塞"], ["cancelled", "放弃本次安排"], ["not_started", "其他"]] as const;
function resultFor(outcome: Outcome | null): ReviewDraft["result"] { return outcome === "completed" || outcome === "partial" ? outcome : outcome ? "not_completed" : null; }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function shiftDate(date: string, days: number) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function timeLabel(block: PlanBlock) { return `${block.starts_at.slice(11, 16)}–${block.ends_at.slice(11, 16)}`; }

export type ReviewFlush = () => Promise<boolean>;
export function ReviewPage({ today, reviewDate, onSelectDate, onFactsChanged, onCompleteTask, flushRef, refreshVersion }: {
  today: string;
  reviewDate: string;
  onSelectDate: (date: string) => void;
  onFactsChanged: (date: string) => Promise<void>;
  onCompleteTask: (taskId: string, blockId: string | null) => Promise<void>;
  flushRef: MutableRefObject<ReviewFlush | null>;
  refreshVersion: number;
}) {
  const [schedule, setSchedule] = useState<DaySchedule | null>(null);
  const [occurrences, setOccurrences] = useState<RecurringOccurrence[]>([]);
  const [writableRecurring, setWritableRecurring] = useState(new Set<string>());
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [recurringDrafts, setRecurringDrafts] = useState<Record<string, RecurringReviewDraft>>({});
  const draftsRef = useRef(drafts);
  const recurringRef = useRef(recurringDrafts);
  const touched = useRef(new Set<string>());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ id: string; itemId: string; message: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const operation = useRef<Promise<void> | null>(null);
  const queue = useRef(new ReviewDraftQueue((id, payload, revision) => saveReviewFormDraft(id.review_date, id.item_type, id.item_id, payload, revision)));
  const sequence = useRef(0);
  const mounted = useRef(true);
  const editable = canRecordReview(reviewDate, today);
  const historical = reviewDate < today;
  const future = reviewDate > today;
  const identity = (item_type: "task" | "recurring", item_id: string) => ({ review_date: reviewDate, item_type, item_id });

  async function persistDrafts() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    try {
      if (queue.current.dirty) setDraftStatus("正在保存草稿…");
      await queue.current.flush();
      if (mounted.current) setDraftStatus("草稿已保存；结果和补充记录仍需主动保存。");
      return true;
    } catch (reason) {
      if (mounted.current) setDraftStatus(`草稿未保存：${errorText(reason)}。输入已保留，请重试。`);
      return false;
    }
  }

  useEffect(() => {
    mounted.current = true;
    const flush = async () => {
      if (operation.current) await operation.current;
      return persistDrafts();
    };
    flushRef.current = flush;
    const protect = (event: BeforeUnloadEvent) => { if (queue.current.dirty || operation.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", protect);
    return () => {
      mounted.current = false;
      sequence.current++;
      if (timer.current) clearTimeout(timer.current);
      if (flushRef.current === flush) flushRef.current = null;
      window.removeEventListener("beforeunload", protect);
    };
  }, [flushRef]);

  async function loadReviewSchedule(committedId?: string) {
    const request = ++sequence.current;
    if (!schedule) setLoading(true);
    setError("");
    try {
      const [next, items, stored, rules] = await Promise.all([
        getDaySchedule(reviewDate), future ? Promise.resolve([]) : listRecurringOccurrences(reviewDate),
        editable ? listReviewFormDrafts(reviewDate) : Promise.resolve([]), listRecurringItems(true, true)
      ]);
      if (!mounted.current || request !== sequence.current) return;
      const availableRules = new Set(rules.filter((item) => !item.deleted_at).map((item) => item.id));
      setWritableRecurring(availableRules);
      const base: Record<string, ReviewDraft> = {};
      const recurringBase: Record<string, RecurringReviewDraft> = {};
      if (editable) {
        for (const block of next.task_blocks.filter((block) => !block.review && block.task_status !== "deleted")) {
          const outcome = block.execution_status === "planned" ? null : block.execution_status;
          base[block.id] = { result: resultFor(outcome), outcome, actual_minutes: "", defer_reason: "", notes: block.execution_note ?? "", remaining_workload_minutes: "" };
        }
        for (const item of items.filter((item) => availableRules.has(item.recurring_item_id) && (!historical || !item.outcome))) recurringBase[item.id] = { outcome: item.outcome, notes: item.review_notes ?? "" };
      }
      const persisted: Record<string, ReviewDraft> = {};
      const persistedRecurring: Record<string, RecurringReviewDraft> = {};
      for (const row of stored) {
        if (row.item_type === "task" && base[row.item_id]) persisted[row.item_id] = restoreReviewDraft(base[row.item_id], row.payload_json);
        if (row.item_type === "recurring" && recurringBase[row.item_id]) persistedRecurring[row.item_id] = restoreReviewDraft(recurringBase[row.item_id], row.payload_json);
      }
      queue.current.hydrate(stored);
      if (committedId) touched.current.delete(committedId);
      const editedTasks = Object.fromEntries(Object.entries(draftsRef.current).filter(([id]) => touched.current.has(id)));
      const editedRecurring = Object.fromEntries(Object.entries(recurringRef.current).filter(([id]) => touched.current.has(id)));
      draftsRef.current = mergeReviewDrafts(base, persisted, editedTasks, committedId);
      recurringRef.current = mergeReviewDrafts(recurringBase, persistedRecurring, editedRecurring, committedId);
      setDrafts(draftsRef.current);
      setRecurringDrafts(recurringRef.current);
      setSchedule(next);
      setOccurrences(items);
    } catch (reason) {
      if (mounted.current && request === sequence.current) setError(errorText(reason));
    } finally { if (mounted.current && request === sequence.current) setLoading(false); }
  }

  useEffect(() => { void loadReviewSchedule(); }, [today, refreshVersion]);

  function stage(type: "task" | "recurring", id: string, value: ReviewDraft | RecurringReviewDraft) {
    touched.current.add(id);
    queue.current.stage(identity(type, id), value);
    setDraftStatus("草稿待保存…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void persistDrafts(); }, 450);
  }
  function updateDraft(id: string, update: Partial<ReviewDraft>) {
    if (operation.current || !draftsRef.current[id]) return;
    const next = { ...draftsRef.current[id], ...update };
    draftsRef.current = { ...draftsRef.current, [id]: next };
    setDrafts(draftsRef.current);
    stage("task", id, next);
  }
  function updateRecurringNotes(id: string, notes: string) {
    if (operation.current || !recurringRef.current[id]) return;
    const next = { ...recurringRef.current[id], notes };
    recurringRef.current = { ...recurringRef.current, [id]: next };
    setRecurringDrafts(recurringRef.current);
    stage("recurring", id, next);
  }

  function run(id: string, action: () => Promise<void>) {
    if (operation.current) return;
    setBusy(id);
    setMessages((current) => ({ ...current, [id]: "正在保存…" }));
    const work = (async () => {
      try {
        if (!await persistDrafts()) throw new Error("请先重试保存草稿，当前输入已保留");
        await action();
      } catch (reason) { if (mounted.current) setMessages((current) => ({ ...current, [id]: `未保存：${errorText(reason)}` })); }
      finally { operation.current = null; if (mounted.current) setBusy(null); }
    })();
    operation.current = work;
  }

  function saveBlock(block: PlanBlock, detailed: boolean) {
    run(block.id, async () => {
      const draft = draftsRef.current[block.id];
      if (!editable || !draft?.outcome) throw new Error("请选择本次结果；未完成时请选择原因。");
      if (detailed) {
        await saveReviewEntry(reviewDate, { plan_block_id: block.id, outcome: draft.outcome,
          actual_minutes: optionalReviewMinutes(draft.actual_minutes), defer_reason: draft.defer_reason.trim() || null,
          notes: draft.notes.trim() || null, remaining_workload_minutes: historical ? null : optionalReviewMinutes(draft.remaining_workload_minutes) });
        queue.current.forget(identity("task", block.id));
        await loadReviewSchedule(block.id);
      } else {
        await saveExecutionCapture(reviewDate, { plan_block_id: block.id, outcome: draft.outcome, note: block.execution_note });
        queue.current.forget(identity("task", block.id));
        touched.current.delete(block.id);
        await loadReviewSchedule();
      }
      setMessages((current) => ({ ...current, [block.id]: detailed ? "补充记录已保存。" : "本次结果已记录，无需再次确认。" }));
      await onFactsChanged(reviewDate);
    });
  }
  function finishTask(block: PlanBlock) {
    run(block.id, async () => {
      await onCompleteTask(block.task_id, block.id);
      queue.current.forget(identity("task", block.id));
      await loadReviewSchedule(block.id);
      setMessages((current) => ({ ...current, [block.id]: "任务已完成。" }));
    });
  }
  function saveRecurring(item: RecurringOccurrence, outcome: RecurringOccurrenceOutcome) {
    run(item.id, async () => {
      const saved = await saveRecurringOccurrenceReview(item.id, { outcome, notes: recurringRef.current[item.id]?.notes.trim() || null });
      queue.current.forget(identity("recurring", item.id));
      const undo = await latestUndo().catch(() => null);
      if (undo) setToast({ id: undo.id, itemId: item.id, message: "本次结果已保存" });
      setOccurrences((current) => current.map((value) => value.id === item.id ? saved : value));
      await loadReviewSchedule(item.id);
      setMessages((current) => ({ ...current, [item.id]: undo ? "" : "本次结果已保存。" }));
      await onFactsChanged(reviewDate);
    });
  }
  function undoRecurring(id: string) {
    run("undo", async () => {
      await applyUndo(id);
      setToast(null);
      if (toast) queue.current.forget(identity("recurring", toast.itemId));
      await loadReviewSchedule(toast?.itemId);
      await onFactsChanged(reviewDate);
    });
  }

  function taskCard(block: PlanBlock) {
    const saved = block.review;
    const draft = drafts[block.id];
    const outcome = saved?.outcome ?? (block.execution_status === "planned" ? null : block.execution_status);
    return <article key={block.id} className={`review-record-card ${outcome ? `execution-${outcome}` : ""}`}>
      <header><div><strong>{block.task_title}</strong><span>{timeLabel(block)}<CopySeparator />原计划不变</span></div><span>{saved ? "补充记录已保存" : outcome ? "已记录" : "未记录"}</span></header>
      {saved ? <details className="review-supplement"><summary>查看补充记录<CopySeparator />{outcomeCopy[saved.outcome]}</summary><div className="review-facts"><div><span>实际耗时</span><strong>{saved.actual_minutes === null ? "未记录" : `${saved.actual_minutes} 分钟`}</strong></div><div><span>剩余工作量</span><strong>{saved.remaining_workload_minutes === null ? "未重估" : `${saved.remaining_workload_minutes} 分钟`}</strong></div>{saved.defer_reason && <p>{saved.defer_reason}</p>}{saved.notes && <p>{saved.notes}</p>}</div><small>已确认的补充记录只读。</small></details> : draft ? <>
        <div className="execution-choice-stack"><div className="outcome-picker" role="group" aria-label={`${block.task_title}本次结果`}>{resultOptions.map(([value, label]) => <button type="button" key={value} aria-pressed={draft.result === value} disabled={Boolean(busy)} onClick={() => updateDraft(block.id, { result: value, outcome: value === "not_completed" ? (resultFor(draft.outcome) === "not_completed" ? draft.outcome : null) : value })}>{label}</button>)}</div>{draft.result === "not_completed" && <fieldset className="incomplete-reasons"><legend>未完成原因</legend><div>{reasonOptions.map(([value, label]) => <button type="button" key={value} aria-pressed={draft.outcome === value} disabled={Boolean(busy)} onClick={() => updateDraft(block.id, { outcome: value })}>{label}</button>)}</div></fieldset>}</div>
        {(!historical || !outcome) && (draft.outcome !== outcome || !outcome) && <div className="review-actions"><button type="button" disabled={Boolean(busy) || !draft.outcome} onClick={() => saveBlock(block, false)}>保存本次结果</button></div>}
        <details className="review-supplement"><summary>补充详情<span>可选</span></summary><div className="review-fields">
          <label>实际耗时<input aria-label="实际耗时" type="number" min="0" step="1" placeholder="未记录" value={draft.actual_minutes} disabled={Boolean(busy)} onChange={(event) => updateDraft(block.id, { actual_minutes: event.target.value })} /><span>分钟</span></label>
          {!historical && <label>剩余工作量<input aria-label="剩余工作量" type="number" min="0" step="1" placeholder="不重估" value={draft.remaining_workload_minutes} disabled={Boolean(busy)} onChange={(event) => updateDraft(block.id, { remaining_workload_minutes: event.target.value })} /><span>分钟</span></label>}
          <label className="review-wide">原因<input aria-label="原因" maxLength={500} placeholder="可选，记录推迟或受阻原因" value={draft.defer_reason} disabled={Boolean(busy)} onChange={(event) => updateDraft(block.id, { defer_reason: event.target.value })} /></label>
          <label className="review-wide">备注<textarea aria-label="备注" rows={2} maxLength={2000} value={draft.notes} disabled={Boolean(busy)} onChange={(event) => updateDraft(block.id, { notes: event.target.value })} /></label>
        </div><div className="review-actions"><small>保存后只读；空耗时不会按 0 或计划时长记录。</small><button type="button" disabled={Boolean(busy) || !draft.outcome} onClick={() => saveBlock(block, true)}>保存补充记录</button></div></details>
      </> : <p className="review-history-readonly">{outcome ? `本次${outcomeCopy[outcome]}` : "当时未记录结果"}{!editable && <><CopySeparator />此日期只读</>}{block.execution_note && <><CopySeparator />{block.execution_note}</>}</p>}
      <div className="review-actions"><span role="status">{messages[block.id] || (historical && editable && !saved ? "补录仅记录当时情况，不改变当前安排。" : "")}</span>{reviewDate === today && block.task_status !== "deleted" && (block.task_status === "done" ? <strong className="task-complete-state">任务已完成</strong> : <button type="button" className="complete-task-action" disabled={Boolean(busy)} onClick={() => finishTask(block)}>完成任务</button>)}</div>
    </article>;
  }
  function recurringCard(item: RecurringOccurrence) {
    const draft = recurringDrafts[item.id];
    return <article key={item.id} className="review-record-card recurring-review-card"><header><div><strong>{item.title}</strong><span>重复事项<CopySeparator />{item.display_time ?? "时间未指定"}</span></div><span>{item.outcome ? "已记录" : "未记录"}</span></header>
      {draft ? <><div className="recurring-outcome-picker" role="group" aria-label={`${item.title}本次结果`}>{resultOptions.map(([value, label]) => <button type="button" key={value} aria-pressed={item.outcome === value} disabled={Boolean(busy)} onClick={() => saveRecurring(item, value)}>{label}</button>)}</div><details className="review-supplement"><summary>备注<span>可选</span></summary><label className="recurring-review-notes">本次备注<textarea aria-label="本次备注" rows={2} maxLength={2000} value={draft.notes} disabled={Boolean(busy)} onChange={(event) => updateRecurringNotes(item.id, event.target.value)} /></label><div className="review-actions"><button type="button" disabled={Boolean(busy) || !item.outcome} onClick={() => item.outcome && saveRecurring(item, item.outcome)}>保存备注</button></div></details></> : <p>{item.outcome ? resultOptions.find(([value]) => value === item.outcome)?.[1] : "当时未记录结果"}{item.review_notes && <><CopySeparator />{item.review_notes}</>}</p>}
      <div className="review-actions"><span role="status">{messages[item.id] || (!writableRecurring.has(item.recurring_item_id) ? "已移入回收站，仅查看历史。" : historical ? "补录不改变重复规则。" : "仅记录本次，重复安排会继续。")}</span></div></article>;
  }
  const entries = [
    ...(schedule?.task_blocks ?? []).map((item) => ({ id: item.id, outcome: item.review?.outcome ?? (item.execution_status === "planned" ? null : item.execution_status), render: () => taskCard(item) })),
    ...occurrences.map((item) => ({ id: item.id, outcome: item.outcome, render: () => recurringCard(item) }))
  ];
  const unrecorded = entries.filter((entry) => !entry.outcome).length;
  const anomalous = entries.filter((entry) => entry.outcome && reviewNeedsAttention(entry.outcome)).length;
  return <section className="next-page review-page" aria-label="复盘与记录">
    {toast && <Toast key={toast.id} title={toast.message} tone="success" duration={10000} onDismiss={() => setToast(null)} actions={[{ label: "撤销", onClick: () => undoRecurring(toast.id) }]} />}
    <header className="review-context-bar"><div className="review-context-copy"><h1>{reviewDate === today ? "今天的记录" : `${reviewDate} 的记录`}</h1><span>{future ? "这一天尚未发生" : historical && editable ? <>补录<CopySeparator />最近 7 天，不改变当前安排</> : editable ? "先记录结果，按需补充详情" : "历史记录只读"}</span></div><div className="review-date-controls"><button type="button" aria-label="记录前一天" disabled={Boolean(busy)} onClick={() => onSelectDate(shiftDate(reviewDate, -1))}>‹</button><input type="date" aria-label="记录日期" value={reviewDate} disabled={Boolean(busy)} onChange={(event) => event.target.value && onSelectDate(event.target.value)} /><button type="button" aria-label="记录后一天" disabled={Boolean(busy)} onClick={() => onSelectDate(shiftDate(reviewDate, 1))}>›</button><button type="button" disabled={reviewDate === today || Boolean(busy)} onClick={() => onSelectDate(today)}>今天</button></div></header>
    <div className="review-summary"><div><strong>{unrecorded}</strong><span>未记录</span></div><div><strong>{anomalous}</strong><span>部分完成／异常</span></div><p>正常结果已有效记录，不需要再确认完整复盘。</p></div>
    {draftStatus && <div className="review-draft-status" role="status"><span>{draftStatus}</span>{draftStatus.startsWith("草稿未保存") && <button type="button" onClick={() => void persistDrafts()}>重试保存草稿</button>}</div>}
    {error && <div className="review-empty compact error" role="alert"><p>{error}</p><button type="button" onClick={() => void loadReviewSchedule()}>重试读取</button></div>}
    {loading ? <div className="review-empty compact" role="status">正在读取记录…</div> : future ? <div className="review-empty"><h2>这一天尚未发生</h2><p>未来日期不能记录结果。</p><button type="button" onClick={() => onSelectDate(today)}>回到今天</button></div> : !entries.length ? <div className="review-empty"><h2>这一天没有需要记录的内容</h2><p>已有任务安排和重复事项会显示在这里。</p></div> : [true, false].map((attention) => {
      const group = entries.filter((entry) => reviewNeedsAttention(entry.outcome) === attention);
      return group.length > 0 && <section className="review-record-group" key={String(attention)}><h2>{attention ? "需处理" : "已记录"}<span>{group.length}</span></h2><div className="review-ledger">{group.map((entry) => entry.render())}</div></section>;
    })}
    <footer className="review-page-footer">实际耗时不会改变原计划；未知耗时保持未记录。</footer>
  </section>;
}
