import { KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface FluentSelectOption<T extends string | number = string> {
  value: T;
  label: string;
  dotColor?: string;
}

interface FluentSelectProps<T extends string | number = string> {
  value: T;
  options: FluentSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  placeholder?: string;
  compact?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export function FluentSelect<T extends string | number = string>({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "请选择",
  compact = false,
  disabled = false,
  style,
}: FluentSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 160,
  });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  useLayoutEffect(() => {
    if (!open) return;
    function updatePosition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const menuHeight = Math.min(260, options.length * 32 + 12);
      const width = Math.max(rect.width, 136);
      const pad = 10;
      const spaceBelow = window.innerHeight - rect.bottom - pad;
      const spaceAbove = rect.top - pad;
      const top =
        spaceBelow >= menuHeight || spaceBelow >= spaceAbove
          ? Math.min(window.innerHeight - menuHeight - pad, rect.bottom + 5)
          : Math.max(pad, rect.top - menuHeight - 5);
      const left = Math.max(pad, Math.min(rect.left, window.innerWidth - width - pad));
      setMenuPos({ top: Math.round(top), left: Math.round(left), width: Math.round(width) });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    setHighlightIndex(selectedIndex >= 0 ? selectedIndex : 0);
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleEsc(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleEsc, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleEsc, true);
    };
  }, [open, selectedIndex]);

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        setHighlightIndex((i) => Math.min(options.length - 1, i + 1));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        setHighlightIndex((i) => Math.max(0, i - 1));
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else if (highlightIndex >= 0 && options[highlightIndex]) {
        onChange(options[highlightIndex].value);
        setOpen(false);
      }
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        style={style}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleKeyDown}
        className={`dw-fselect-trigger${compact ? " is-compact" : ""}${open ? " is-open" : ""}`}
      >
        <span className={`dw-fselect-value${!selected ? " is-placeholder" : ""}`}>
          {selected?.dotColor && (
            <span className="dw-fselect-dot" style={{ background: selected.dotColor }} />
          )}
          <span>{selected ? selected.label : placeholder}</span>
        </span>
        <span className="dw-fselect-chevron" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className="dw-fselect-menu win-scroll"
            style={{
              top: `${menuPos.top}px`,
              left: `${menuPos.left}px`,
              minWidth: `${menuPos.width}px`,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {options.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isHighlighted = idx === highlightIndex;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  className={`dw-fselect-option${isSelected ? " is-selected" : ""}${
                    isHighlighted ? " is-highlighted" : ""
                  }`}
                >
                  <span className="dw-fselect-opt-main">
                    {opt.dotColor && (
                      <span className="dw-fselect-dot" style={{ background: opt.dotColor }} />
                    )}
                    <span>{opt.label}</span>
                  </span>
                  {isSelected && (
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>,
          triggerRef.current?.closest("[data-modal-popup-root]") ?? document.body,
        )}
    </>
  );
}
