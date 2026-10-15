import { ComponentPropsWithoutRef, ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./feedback.css";

function FeedbackIcon({ info = false }: { info?: boolean }) {
  return <svg viewBox="0 0 20 20" width={info ? 18 : 17} height={info ? 18 : 17} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {info ? <><circle cx="10" cy="10" r="7" /><path d="M10 9v5m0-8v1" /></> : <path d="m5 5 10 10M15 5 5 15" />}
  </svg>;
}

export function ToastViewport() {
  return createPortal(<div id="feedback-toast-viewport" className="feedback-toast-viewport" />, document.body);
}

export function Toast({ title, description, tone = "info", actions = [], duration, onDismiss }: {
  title: string;
  description?: string;
  tone?: "success" | "info" | "error";
  actions?: { label: string; onClick: () => void }[];
  duration: number;
  onDismiss: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const timer = useRef(0);
  const remaining = useRef(duration);
  const started = useRef<number | null>(null);
  function pause() {
    window.clearTimeout(timer.current);
    if (started.current !== null) {
      remaining.current = Math.max(0, remaining.current - (performance.now() - started.current));
      started.current = null;
    }
  }
  function resume() {
    if (started.current !== null || element.current?.matches(":hover") || element.current?.contains(document.activeElement)) return;
    started.current = performance.now();
    timer.current = window.setTimeout(() => dismiss.current(), remaining.current);
  }
  useEffect(() => {
    remaining.current = duration;
    started.current = null;
    resume();
    return pause;
  }, [title, description, duration]);
  const host = document.getElementById("feedback-toast-viewport");
  if (!host) return null;
  return createPortal(<div ref={element} className={`feedback-toast ${tone}${actions.length ? " has-actions" : ""}`} role={tone === "error" ? "alert" : "status"}
    onMouseEnter={pause} onMouseLeave={resume} onFocus={pause} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) resume(); }}>
    <span className="feedback-toast-dot" aria-hidden="true" />
    <div className="feedback-toast-content"><strong>{title}</strong>{description && <p>{description}</p>}</div>
    {actions.length > 0 && <div className="feedback-toast-actions">{actions.map(action => <button key={action.label} type="button" onClick={action.onClick}>{action.label}</button>)}</div>}
    <button className="feedback-close" type="button" aria-label="关闭提示" onClick={onDismiss}><FeedbackIcon /></button>
  </div>, host);
}

export function ConfirmationDialog({ children, onCancel, busy = false, tone = "info", ...props }: ComponentPropsWithoutRef<"section"> & {
  children: ReactNode;
  onCancel: () => void;
  busy?: boolean;
  tone?: "info" | "caution" | "danger" | "success";
}) {
  const element = useRef<HTMLElement>(null);
  const restoreFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const current = useRef({ busy, onCancel });
  current.current = { busy, onCancel };
  useLayoutEffect(() => {
    const dialog = element.current!;
    const previousFocus = restoreFocus.current;
    const background: { element: HTMLElement; inert: boolean }[] = [];
    for (let parent = dialog.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      for (const sibling of parent.parentElement?.children ?? []) {
        if (sibling !== parent && sibling instanceof HTMLElement) {
          background.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
    }
    const controls = () => [...dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const focusFirst = () => (dialog.querySelector<HTMLButtonElement>(".dialog-actions button:not(:disabled)") ?? controls()[0] ?? dialog).focus({ preventScroll: true });
    focusFirst();
    function containFocus(event: FocusEvent) {
      if (!dialog.contains(event.target as Node)) focusFirst();
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!current.current.busy) current.current.onCancel();
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const buttons = controls();
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index + 1) % buttons.length;
        (buttons[next] ?? dialog).focus({ preventScroll: true });
      }
    }
    document.addEventListener("focusin", containFocus);
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("focusin", containFocus);
      document.removeEventListener("keydown", keydown, true);
      background.forEach(item => { item.element.inert = item.inert; });
      if (previousFocus?.isConnected && !previousFocus.closest("[inert]")) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return <section {...props} ref={element} className={`feedback-confirm ${tone}`} role="alertdialog" aria-modal="true" tabIndex={-1} aria-busy={busy}>
    <span className="feedback-confirm-symbol" aria-hidden="true"><FeedbackIcon info /></span>
    <button className="feedback-close" type="button" aria-label="取消并关闭确认框" disabled={busy} onClick={onCancel}><FeedbackIcon /></button>
    {children}
  </section>;
}
