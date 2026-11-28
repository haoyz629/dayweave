import { useEffect, useRef, useState } from "react";
import type { Draft } from "../types/dayweave";
import { formatRelativeTimestamp } from "../utils/dateUtils";
import { useSaveAttempt } from "../utils/useSaveAttempt";
import { tip } from "./TooltipHost";

interface DraftsDrawerProps {
  open: boolean;
  drafts: Draft[];
  todayDate: string;
  onClose: () => void;
  onRestoreDraft: (draft: Draft) => void;
  onDeleteDraft: (draftId: string) => Promise<boolean>;
}

export function DraftsDrawer({
  open,
  drafts,
  todayDate,
  onClose,
  onRestoreDraft,
  onDeleteDraft,
}: DraftsDrawerProps) {
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<Draft | null>(null);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const deleteAttempt = useSaveAttempt();

  useEffect(() => {
    if (!open) {
      setDeleteTarget(null);
      setDeleteFailed(false);
    }
  }, [open]);

  useEffect(() => {
    if (!deleteTarget) return;
    const dlg = deleteDialogRef.current;
    if (dlg && !dlg.open) {
      dlg.showModal();
    }
  }, [deleteTarget]);

  if (!open) return null;

  return (
    <>
      <div className="dw-drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="dw-drawer-left" aria-label="草稿箱抽屉">
        <div className="dw-drawer-header">
          <div>
            <h2 className="dw-drawer-title">草稿箱</h2>
          </div>
          <button
            type="button"
            className="dw-drawer-close"
            onClick={onClose}
            aria-label="关闭草稿箱"
            {...tip("关闭草稿箱", { shortcut: "Esc", side: "right" })}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="dw-drawer-body win-scroll" style={{ gap: 10 }}>
          {drafts.length === 0 ? (
            <div className="dw-empty-state">暂无未提交草稿</div>
          ) : (
            drafts.map((d) => (
              <div
                key={d.id}
                role="button"
                tabIndex={0}
                className="dw-draft-card"
                onClick={() => onRestoreDraft(d)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRestoreDraft(d);
                  }
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--w-text)" }}>
                    {d.title || "未命名草稿"}
                  </div>
                  <span style={{ fontSize: 12, color: "var(--w-text-3)", flexShrink: 0 }} className="tabular-nums">
                    {formatRelativeTimestamp(d.updatedAt, todayDate)}
                  </span>
                </div>
                {d.note && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--w-text-2)",
                      marginTop: 6,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {d.note}
                  </div>
                )}
                <div
                  style={{
                    marginTop: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: "var(--w-amber-text)", fontWeight: 500 }}>继续编辑</span>
                  <button
                    type="button"
                    className="dw-btn-text-danger"
                    disabled={deleteAttempt.saving}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (deleteAttempt.pending.current) return;
                      setDeleteFailed(false);
                      setDeleteTarget(d);
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {deleteTarget && (
        <dialog
          ref={deleteDialogRef}
          className="dw-modal"
          aria-labelledby="dw-delete-draft-title"
          aria-describedby="dw-delete-draft-desc"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.stopPropagation();
          }}
          onCancel={(e) => {
            if (deleteAttempt.pending.current) e.preventDefault();
          }}
          onClose={() => {
            if (deleteAttempt.pending.current) return;
            setDeleteTarget(null);
            setDeleteFailed(false);
          }}
        >
          <div className="dw-modal-header">
            <span className="dw-modal-title" id="dw-delete-draft-title">
              删除草稿？
            </span>
          </div>
          <div className="dw-modal-form">
            <p id="dw-delete-draft-desc" style={{ margin: 0, overflowWrap: "anywhere" }}>
              将永久删除草稿「{deleteTarget.title || "未命名草稿"}」。此操作无法撤销。
            </p>
            {deleteFailed && (
              <p role="alert" style={{ margin: 0, color: "var(--w-rose-text)" }}>
                删除未完成，请重试或取消。
              </p>
            )}
            <div className="dw-modal-footer">
              <button
                type="button"
                className="dw-btn-ghost"
                autoFocus
                disabled={deleteAttempt.saving}
                onClick={() => {
                  deleteDialogRef.current?.close();
                  setDeleteTarget(null);
                  setDeleteFailed(false);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="dw-btn-danger-outline"
                disabled={deleteAttempt.saving}
                onClick={async () => {
                  if (!deleteTarget || deleteAttempt.pending.current) return;
                  setDeleteFailed(false);
                  if (await deleteAttempt.save(() => onDeleteDraft(deleteTarget.id))) {
                    deleteDialogRef.current?.close();
                    setDeleteTarget(null);
                    setDeleteFailed(false);
                  } else {
                    setDeleteFailed(true);
                  }
                }}
              >
                确认删除
              </button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
