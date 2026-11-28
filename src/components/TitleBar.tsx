import { FormEvent, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Logo } from "../logo";
import { isDesktopRuntime } from "../tauri";
import { TAG_COLOR_HEX } from "../types/dayweave";
import type { AppModule, CalendarView, Tag } from "../types/dayweave";
import { useSaveAttempt } from "../utils/useSaveAttempt";
import { tip } from "./TooltipHost";

interface TitleBarProps {
  activeModule: AppModule;
  calendarView: CalendarView;
  tags: Tag[];
  onSwitchCalendarView: (view: CalendarView) => void;
  onQuickCapture: (rawText: string) => Promise<boolean>;
  onOpenCreateModal: () => void;
  onError: (message: string) => void;
}

export function TitleBar({
  activeModule,
  calendarView,
  tags,
  onSwitchCalendarView,
  onQuickCapture,
  onOpenCreateModal,
  onError,
}: TitleBarProps) {
  const [quickText, setQuickText] = useState("");
  const { pending, saving, save } = useSaveAttempt();
  const [hintsOpen, setHintsOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const quickWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refresh = async () => {
      const value = await appWindow.isMaximized();
      if (!disposed) setMaximized(value);
    };
    void refresh().catch(() => {});
    void appWindow
      .onResized(() => {
        void refresh().catch(() => {});
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!hintsOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (quickWrapRef.current && !quickWrapRef.current.contains(e.target as Node)) {
        setHintsOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setHintsOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [hintsOpen]);

  async function runWindowAction(action: "minimize" | "toggleMaximize" | "close" | "startDragging") {
    if (!isDesktopRuntime()) return;
    try {
      const appWindow = getCurrentWindow();
      await appWindow[action]();
      if (action === "toggleMaximize") {
        setMaximized(await appWindow.isMaximized());
      }
    } catch (error) {
      onError(`窗口操作失败：${String(error)}`);
    }
  }

  function appendToken(token: string) {
    if (pending.current) return;
    setQuickText((prev) => {
      const cleaned = prev.endsWith("/") ? prev.slice(0, -1).trimEnd() : prev.trim();
      return `${cleaned ? `${cleaned} ` : ""}${token}`;
    });
    window.setTimeout(() => inputRef.current?.focus(), 10);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const raw = quickText.trim();
    if (!raw || !(await save(() => onQuickCapture(raw)))) return;
    setQuickText("");
    setHintsOpen(false);
  }

  return (
    <header
      className="dw-titlebar"
      aria-label="应用标题栏"
      onMouseDown={(e) => {
        if (
          e.button !== 0 ||
          (e.target as HTMLElement).closest("button, input, form, [role='group']")
        ) {
          return;
        }
        e.preventDefault();
        void runWindowAction(e.detail === 2 ? "toggleMaximize" : "startDragging");
      }}
    >
      {/* Left: Brand */}
      <div className="dw-brand">
        <div className="dw-brand-logo">
          <Logo />
        </div>
        <span className="dw-brand-name">今序 · Dayweave</span>
      </div>

      {/* Center: Quiet Smart Quick-Capture Bar (on-demand syntax helper) */}
      <div className="dw-quick-wrap" ref={quickWrapRef}>
        <form onSubmit={handleSubmit} className="dw-quick-form">
          <span className="dw-quick-plus" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <input
            ref={inputRef}
            type="text"
            autoComplete="off"
            readOnly={saving}
            value={quickText}
            onChange={(e) => {
              const next = e.target.value;
              setQuickText(next);
              if (next.endsWith("#") || next.endsWith("/")) {
                setHintsOpen(true);
              } else if (!next.trim() && hintsOpen) {
                setHintsOpen(false);
              }
            }}
            placeholder="快速新建，输入 # 加标签或 / 看快捷指令（回车创建）"
            className="dw-quick-input"
            aria-label="快速新建输入框"
          />
          <div className="dw-quick-actions">
            <button
              type="button"
              onClick={() => setHintsOpen((v) => !v)}
              aria-label="快捷输入提示"
              aria-expanded={hintsOpen}
              className={`dw-quick-help-btn${hintsOpen ? " is-active" : ""}`}
              {...tip("快捷输入提示", { shortcut: "/", side: "bottom" })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" d="M9.5 9.5a2.5 2.5 0 0 1 4.8.8c0 1.5-2.3 2-2.3 3.2" />
                <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => {
                setHintsOpen(false);
                onOpenCreateModal();
              }}
              className="dw-quick-detail-btn"
              {...tip("打开详细新建弹窗", { shortcut: "Ctrl+N", side: "bottom" })}
            >
              <span>详细</span>
            </button>
          </div>
        </form>

        {hintsOpen && (
          <div className="dw-quick-hints" role="region" aria-label="快捷输入提示">
            <div className="dw-quick-hint-head">
              <span>点击插入快捷指令</span>
              <kbd className="dw-kbd">Esc</kbd>
            </div>
            <div className="dw-quick-hint-row">
              <span className="dw-quick-hint-label">时间与属性</span>
              <button type="button" onClick={() => appendToken("17:00 ")} className="dw-hint-chip font-mono">
                17:00
              </button>
              <button type="button" onClick={() => appendToken("45m ")} className="dw-hint-chip font-mono">
                45m
              </button>
              <button type="button" onClick={() => appendToken("1h ")} className="dw-hint-chip font-mono">
                1h
              </button>
              <button type="button" onClick={() => appendToken("#P1 ")} className="dw-hint-chip is-p1">
                #P1
              </button>
              <button type="button" onClick={() => appendToken("#全天 ")} className="dw-hint-chip">
                #全天
              </button>
            </div>
            {tags.length > 0 && (
              <div className="dw-quick-hint-row">
                <span className="dw-quick-hint-label">任务标签</span>
                {tags.map((tg) => (
                  <button
                    key={tg.id}
                    type="button"
                    onClick={() => appendToken(`#${tg.name} `)}
                    className="dw-hint-chip"
                  >
                    <span
                      className="dw-hint-chip-dot"
                      style={{ background: TAG_COLOR_HEX[tg.color] ?? TAG_COLOR_HEX.blue }}
                    />
                    #{tg.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: [日 | 月] Switcher + Windows Caption Controls */}
      <div className="dw-titlebar-right">
        {activeModule === "workbench" && (
          <div className="dw-view-switch" role="group" aria-label="日历视图切换">
            <span
              className={`dw-view-thumb${calendarView === "month" ? " is-month" : ""}`}
              aria-hidden="true"
            />
            <button
              type="button"
              aria-pressed={calendarView === "day"}
              onClick={() => onSwitchCalendarView("day")}
              className={`dw-view-btn${calendarView === "day" ? " is-active" : ""}`}
            >
              日
            </button>
            <button
              type="button"
              aria-pressed={calendarView === "month"}
              onClick={() => onSwitchCalendarView("month")}
              className={`dw-view-btn${calendarView === "month" ? " is-active" : ""}`}
            >
              月
            </button>
          </div>
        )}

        <div className="dw-win-controls" role="group" aria-label="窗口控制">
          <button
            type="button"
            className="dw-win-btn"
            aria-label="最小化"
            onClick={() => void runWindowAction("minimize")}
            {...tip("最小化", { side: "bottom" })}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M0.5 5h9" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          <button
            type="button"
            className="dw-win-btn"
            aria-label={maximized ? "还原窗口" : "最大化"}
            onClick={() => void runWindowAction("toggleMaximize")}
            {...tip(maximized ? "还原窗口" : "最大化", { side: "bottom" })}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              {maximized ? (
                <path d="M2.5 0.5h7v7M0.5 2.5h7v7h-7z" stroke="currentColor" strokeWidth="1.1" />
              ) : (
                <rect x="0.8" y="0.8" width="8.4" height="8.4" stroke="currentColor" strokeWidth="1.1" />
              )}
            </svg>
          </button>
          <button
            type="button"
            className="dw-win-btn is-close"
            aria-label="关闭窗口"
            onClick={() => void runWindowAction("close")}
            {...tip("关闭窗口", { side: "bottom" })}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="m1 1 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
