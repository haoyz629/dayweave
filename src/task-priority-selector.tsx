import { KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Priority } from "./tauri";

export const priorityCopy = { urgent: "P0 紧急", high: "P1 高优先级", medium: "P2 中优先级", low: "P3 低优先级" } as const;

export function TaskPrioritySelector({ id, value, disabled = false, onChange }: {
  id: string;
  value: Priority | null;
  disabled?: boolean;
  onChange: (priority: Priority) => void;
}) {
  const [priorityOpen, setPriorityOpen] = useState(false);
  const priorityDropdownRef = useRef<HTMLDivElement>(null);
  const priority = value ?? "high";

  function closePriorityMenu() {
    setPriorityOpen(false);
    priorityDropdownRef.current?.querySelector<HTMLButtonElement>(".priority-dropdown-trigger")?.focus();
  }

  function handlePriorityKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (event.key === "Escape" && priorityOpen) {
      event.preventDefault();
      event.stopPropagation();
      closePriorityMenu();
      return;
    }
    if (event.key === "Tab" && priorityOpen) {
      closePriorityMenu();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (!priorityOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setPriorityOpen(true);
      }
      return;
    }
    event.preventDefault();
    const options = Array.from(priorityDropdownRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length;
    options[next]?.focus();
  }

  useEffect(() => {
    if (disabled) setPriorityOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!priorityOpen || disabled) return;
    priorityDropdownRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    function handleClickOutside(event: PointerEvent) {
      if (priorityDropdownRef.current && !priorityDropdownRef.current.contains(event.target as Node)) {
        setPriorityOpen(false);
      }
    }
    document.addEventListener("pointerdown", handleClickOutside);
    return () => document.removeEventListener("pointerdown", handleClickOutside);
  }, [priorityOpen, disabled]);

  const priorityOptions: Array<{ value: Priority; label: string; tone: string }> = [
    { value: "urgent", label: priorityCopy.urgent, tone: "urgent" },
    { value: "high", label: priorityCopy.high, tone: "high" },
    { value: "medium", label: priorityCopy.medium, tone: "medium" },
    { value: "low", label: priorityCopy.low, tone: "low" },
  ];

  return <div ref={priorityDropdownRef} className={`priority-select-control priority-tone-${priority}`} onKeyDown={handlePriorityKeyDown} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPriorityOpen(false); }}>
    <button id={id} type="button" className={`priority-dropdown-trigger${priorityOpen && !disabled ? " is-open" : ""}`} disabled={disabled} aria-label={`优先级：${priorityCopy[priority]}`} aria-haspopup="listbox" aria-controls={`${id}-menu`} aria-expanded={priorityOpen && !disabled} onMouseDown={(e) => e.stopPropagation()} onClick={() => !disabled && setPriorityOpen(!priorityOpen)}>
      <span className="priority-trigger-content">
        <i className={`priority-dot priority-dot-${priority}`} aria-hidden="true" />
        <span className="priority-trigger-label">{priorityCopy[priority]}</span>
      </span>
      <span className="priority-trigger-aside">
        <span className="priority-trigger-chevron" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {priorityOpen && !disabled ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />}
          </svg>
        </span>
      </span>
    </button>
    {priorityOpen && !disabled && (
      <div id={`${id}-menu`} className="priority-dropdown-menu" role="listbox" aria-label="选择任务优先级">
        {priorityOptions.map((opt) => {
          const isSelected = opt.value === priority;
          return (
            <button
              key={opt.tone}
              type="button"
              role="option"
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              disabled={disabled}
              className={`priority-dropdown-option priority-tone-${opt.tone}${isSelected ? " is-selected" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (disabled) return;
                onChange(opt.value);
                closePriorityMenu();
              }}
            >
              <span className="priority-option-label">
                <i className={`priority-dot priority-dot-${opt.tone}`} aria-hidden="true" />
                <span>{opt.label}</span>
              </span>
              <span className="priority-option-aside">
                {opt.value === "high" && <span className="priority-option-default">默认</span>}
                {isSelected && (
                  <span className="priority-check-icon" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    )}
  </div>;
}
