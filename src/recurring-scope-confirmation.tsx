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
    <h2 id="recurring-change-title">修改哪些重复任务块？</h2>
    <div id="recurring-change-description">
      <p>本次安排：{change.occurrence.occurrence_date} {recurringTimeRange(change.occurrence)}</p>
      <p>修改为：{change.targetDate} {recurringTimeRange(change.input)} · {change.input.title}</p>
      <p>历史任务块保持不变。仅修改这一次不会改变重复规则；选择本次及未来，将从这一次起应用新的安排。</p>
    </div>
    {error && <p className="plan-draft-edit-error" role="alert">{error}</p>}
    <div className="dialog-actions">
      <button type="button" disabled={busy} onClick={onCancel}>取消</button>
      <button type="button" disabled={busy} onClick={() => onConfirm("this")}>仅修改这一次</button>
      <button type="button" className="dialog-save" disabled={busy} onClick={() => onConfirm("future")}>{busy ? "正在保存…" : "修改这一次及未来"}</button>
    </div>
  </ConfirmationDialog></div>, document.body);
}
