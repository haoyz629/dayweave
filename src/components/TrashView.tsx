import { useEffect, useRef, useState } from "react";
import type { Task } from "../types/dayweave";
import { formatRelativeTimestamp } from "../utils/dateUtils";
import { formatTrashRetentionCountdown } from "../utils/trashRetention";
import { useSaveAttempt } from "../utils/useSaveAttempt";

interface TrashViewProps {
  items: Task[];
  todayDate: string;
  onRestore: (task: Task) => Promise<boolean>;
  onPurge: (taskId: string) => Promise<boolean>;
  onEmptyTrash: () => Promise<boolean>;
}

type TrashConfirmAction =
  | { kind: "purge"; task: Task }
  | { kind: "empty" }
  | { kind: "restore"; task: Task };

export function TrashView({ items, todayDate, onRestore, onPurge, onEmptyTrash }: TrashViewProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [action, setAction] = useState<TrashConfirmAction | null>(null);
  const [failed, setFailed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const { pending, saving, save } = useSaveAttempt();

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  function openConfirm(next: TrashConfirmAction) {
    if (pending.current) return;
    setAction(next);
    setFailed(false);
    dialogRef.current?.showModal();
  }

  const dialogTitle =
    action?.kind === "empty"
      ? "清空回收站？"
      : action?.kind === "restore"
        ? "恢复任务？"
        : "彻底删除任务？";

  const dialogDesc =
    action?.kind === "empty"
      ? `将永久删除回收站中的 ${items.length} 项任务。此操作无法撤销。`
      : action?.kind === "restore"
        ? `将恢复「${action.task.title}」到原来的任务列表与日程安排。`
        : `将永久删除「${action?.task.title ?? ""}」。此操作无法撤销。`;

  const errorText = action?.kind === "restore" ? "恢复未完成，请重试或取消。" : "删除未完成，请重试或取消。";

  const confirmLabel =
    action?.kind === "empty"
      ? "确认清空"
      : action?.kind === "restore"
        ? "确认恢复"
        : "确认彻底删除";

  return (
    <main className="dw-module" aria-label="回收站">
      <div className="dw-module-header">
        <div>
          <h2 className="dw-module-title">回收站</h2>
          <p className="dw-module-desc">移入回收站的任务保留 30 天，期间支持随时恢复</p>
        </div>
        <button
          type="button"
          className="dw-btn-danger-outline"
          disabled={saving || items.length === 0}
          onClick={() => openConfirm({ kind: "empty" })}
        >
          清空回收站
        </button>
      </div>

      <div className="dw-module-body win-scroll">
        {items.length === 0 ? (
          <div className="dw-empty-state">回收站空空如也</div>
        ) : (
          <div className="dw-list-stack">
            {items.map((tr) => {
              const deletedAt = tr.deletedAt ?? tr.updatedAt;
              const countdown = formatTrashRetentionCountdown(deletedAt, nowMs);
              const countdownClass =
                countdown.tone === "danger"
                  ? "dw-trash-countdown is-danger tabular-nums"
                  : countdown.tone === "warning"
                    ? "dw-trash-countdown is-warning tabular-nums"
                    : "dw-trash-countdown tabular-nums";
              return (
                <div key={tr.id} className="dw-task-row" style={{ cursor: "default" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="dw-task-row-title">{tr.title}</div>
                    <div className="dw-trash-meta tabular-nums">
                      <span>删除于 {formatRelativeTimestamp(deletedAt, todayDate)}</span>
                      <span className={countdownClass}>{countdown.label}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <button
                      type="button"
                      className="dw-btn-ghost"
                      style={{ height: 28, padding: "0 10px" }}
                      disabled={saving}
                      onClick={() => openConfirm({ kind: "restore", task: tr })}
                    >
                      恢复任务
                    </button>
                    <button
                      type="button"
                      className="dw-btn-danger-outline"
                      style={{ height: 28, padding: "0 10px" }}
                      disabled={saving}
                      onClick={() => openConfirm({ kind: "purge", task: tr })}
                    >
                      彻底删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <dialog
        ref={dialogRef}
        className="dw-modal"
        aria-labelledby="dw-trash-confirm-title"
        aria-describedby="dw-trash-confirm-description"
        onKeyDown={(e) => {
          if (e.key === "Escape") e.stopPropagation();
        }}
        onCancel={(e) => {
          if (pending.current) e.preventDefault();
        }}
        onClose={() => {
          if (pending.current) return;
          setFailed(false);
        }}
      >
        <div className="dw-modal-header">
          <span className="dw-modal-title" id="dw-trash-confirm-title">
            {dialogTitle}
          </span>
        </div>
        <div className="dw-modal-form">
          <p id="dw-trash-confirm-description" style={{ margin: 0, overflowWrap: "anywhere" }}>
            {dialogDesc}
          </p>
          {failed && (
            <p role="alert" style={{ margin: 0, color: "var(--w-rose-text)" }}>
              {errorText}
            </p>
          )}
          <div className="dw-modal-footer">
            <button
              type="button"
              className="dw-btn-ghost"
              autoFocus
              disabled={saving}
              onClick={() => dialogRef.current?.close()}
            >
              取消
            </button>
            <button
              type="button"
              className={action?.kind === "restore" ? "dw-btn-primary" : "dw-btn-danger-outline"}
              disabled={saving || !action}
              onClick={async () => {
                if (!action || pending.current) return;
                setFailed(false);
                const ok = await save(() =>
                  action.kind === "empty"
                    ? onEmptyTrash()
                    : action.kind === "restore"
                      ? onRestore(action.task)
                      : onPurge(action.task.id),
                );
                if (ok) {
                  dialogRef.current?.close();
                } else {
                  setFailed(true);
                }
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </main>
  );
}
