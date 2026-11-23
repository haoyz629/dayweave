import { createPortal } from "react-dom";
import { ConfirmationDialog } from "./feedback";
import { recurringTimeRange } from "./recurring-schedule";
import type { RecurringEditScope, RecurringScheduleChange } from "./recurring-schedule";

export function RecurringScopeConfirmation({ change, busy, error, onCancel, onConfirm }: {
  change: RecurringScheduleChange;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (scope: RecurringEditScope) => void;
}) {
  return createPortal(<div className="dialog-backdrop recurring-scope-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) onCancel();
  }}><ConfirmationDialog role="alertdialog" aria-modal="true" aria-labelledby="recurring-change-title" aria-describedby="recurring-change-description" busy={busy} tone="info" onCancel={onCancel}>
    <h2 id="recurring-change-title">修改哪些重复安排？</h2>
    <div id="recurring-change-description" className="confirmation-body">
      <p className="confirmation-object">{change.input.title}</p>
      <dl className="confirmation-scope-change">
        <dt>原安排</dt><dd>{change.occurrence.occurrence_date} {recurringTimeRange(change.occurrence)}</dd>
        <dt>改为</dt><dd>{change.targetDate} {recurringTimeRange(change.input)}</dd>
      </dl>
      <p>历史任务块保持不变。仅修改本次，不改变重复规则；修改本次及以后，将从本次起应用新安排。</p>
      {error && <p className="plan-draft-edit-error" role="alert">{error}</p>}
    </div>
    <div className="dialog-actions">
      <button type="button" disabled={busy} onClick={onCancel}>取消</button>
      <button type="button" disabled={busy} onClick={() => onConfirm("this")}>仅修改本次</button>
      <button type="button" className="dialog-save" disabled={busy} onClick={() => onConfirm("future")}>{busy ? "正在保存…" : "修改本次及以后"}</button>
    </div>
  </ConfirmationDialog></div>, document.body);
}
