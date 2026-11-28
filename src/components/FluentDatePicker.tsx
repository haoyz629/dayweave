import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildMonthGrid,
  formatYearMonthCn,
  shiftMonth,
  todayDateStr,
  WEEKDAY_SHORT_CN,
} from "../utils/dateUtils";

interface FluentDatePickerProps {
  value: string; // YYYY-MM-DD or ""
  onChange: (nextDate: string) => void;
  placeholder?: string;
  clearable?: boolean;
  clearLabel?: string;
  ariaLabel?: string;
}

export function FluentDatePicker({
  value,
  onChange,
  placeholder = "选择日期",
  clearable = false,
  clearLabel = "清除日期",
  ariaLabel = "选择日期",
}: FluentDatePickerProps) {
  const today = todayDateStr();
  const [open, setOpen] = useState(false);
  const [viewAnchor, setViewAnchor] = useState(() => value || today);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();

  useEffect(() => {
    if (open) {
      setViewAnchor(value || todayDateStr());
    }
  }, [open, value]);

  useLayoutEffect(() => {
    if (!open) return;
    function updatePos() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const popW = 268;
      const popH = 312;
      const pad = 10;
      const spaceBelow = window.innerHeight - rect.bottom - pad;
      const spaceAbove = rect.top - pad;
      const top =
        spaceBelow >= popH || spaceBelow >= spaceAbove
          ? Math.min(window.innerHeight - popH - pad, rect.bottom + 6)
          : Math.max(pad, rect.top - popH - 6);
      const left = Math.max(pad, Math.min(rect.left, window.innerWidth - popW - pad));
      setPos({ top: Math.round(top), left: Math.round(left) });
    }
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleEsc(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", handleDown, true);
    document.addEventListener("keydown", handleEsc, true);
    return () => {
      document.removeEventListener("pointerdown", handleDown, true);
      document.removeEventListener("keydown", handleEsc, true);
    };
  }, [open]);

  const cells = useMemo(() => buildMonthGrid(viewAnchor), [viewAnchor]);

  function closeAndRestoreFocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function selectDate(nextDate: string) {
    onChange(nextDate);
    closeAndRestoreFocus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`dw-date-trigger${open ? " is-open" : ""}`}
      >
        <span className={`dw-date-trigger-text${!value ? " is-placeholder" : ""}`}>
          {value || placeholder}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          style={{ color: open ? "var(--w-accent)" : "var(--w-text-2)", flexShrink: 0 }}
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="17" rx="2.5" />
          <path strokeLinecap="round" d="M8 2v4M16 2v4M3 10h18" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            id={dialogId}
            role="dialog"
            aria-label={ariaLabel}
            className="dw-date-popover"
            style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="dw-minical-head" style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--w-text)" }}>
                {formatYearMonthCn(viewAnchor)}
              </span>
              <div className="dw-minical-nav">
                <button
                  type="button"
                  className="dw-minical-step-btn"
                  style={{ width: 26, height: 26 }}
                  onClick={() => setViewAnchor((d) => shiftMonth(d, -1))}
                  aria-label="上个月"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="dw-minical-step-btn"
                  style={{ width: 26, height: 26 }}
                  onClick={() => setViewAnchor((d) => shiftMonth(d, 1))}
                  aria-label="下个月"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="dw-minical-weekdays" style={{ fontSize: 11, marginBottom: 4 }}>
              {WEEKDAY_SHORT_CN.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>

            <div className="dw-date-pop-grid">
              {cells.map((cell) => {
                const isSel = value === cell.date;
                const isToday = cell.date === today;
                return (
                  <div key={cell.date} className="dw-date-pop-cell">
                    <button
                      type="button"
                      onClick={() => selectDate(cell.date)}
                      className={`dw-date-pop-btn${
                        isSel
                          ? " is-selected"
                          : isToday
                            ? " is-today"
                            : !cell.inMonth
                              ? " is-outside"
                              : ""
                      }`}
                    >
                      {cell.day}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="dw-date-pop-footer">
              <button
                type="button"
                className="dw-date-pop-action"
                onClick={() => selectDate(todayDateStr())}
              >
                今天
              </button>
              {clearable ? (
                <button
                  type="button"
                  className="dw-date-pop-action is-muted"
                  onClick={() => selectDate("")}
                >
                  {clearLabel}
                </button>
              ) : (
                <button
                  type="button"
                  className="dw-date-pop-action is-muted"
                  onClick={closeAndRestoreFocus}
                >
                  关闭
                </button>
              )}
            </div>
          </div>,
          triggerRef.current?.closest("[data-modal-popup-root]") ?? document.body,
        )}
    </>
  );
}
