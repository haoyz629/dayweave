import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type TooltipSide = "top" | "right" | "bottom" | "left";

export interface TooltipOptions {
  sub?: string;
  shortcut?: string;
  side?: TooltipSide;
}

export interface TooltipDataAttrs {
  "data-dw-tip"?: string;
  "data-dw-tip-sub"?: string;
  "data-dw-tip-kbd"?: string;
  "data-dw-tip-side"?: TooltipSide;
}

/**
 * Returns data attributes consumed by <TooltipHost /> to render a unified
 * light white-card tooltip without injecting extra wrapper elements.
 */
export function tip(content: string | undefined | null, opts?: TooltipOptions): TooltipDataAttrs {
  if (!content) return {};
  const attrs: TooltipDataAttrs = { "data-dw-tip": content };
  if (opts?.sub) attrs["data-dw-tip-sub"] = opts.sub;
  if (opts?.shortcut) attrs["data-dw-tip-kbd"] = opts.shortcut;
  if (opts?.side) attrs["data-dw-tip-side"] = opts.side;
  return attrs;
}

interface ActiveTooltip {
  text: string;
  sub: string;
  kbd: string;
  side: TooltipSide;
  target: HTMLElement;
}

const OPEN_DELAY_MS = 220;
const WARM_WINDOW_MS = 360;
const VIEWPORT_PAD = 8;
const TRIGGER_GAP = 8;

function computePosition(target: HTMLElement, tipEl: HTMLElement, preferredSide: TooltipSide) {
  const rect = target.getBoundingClientRect();
  const tw = tipEl.offsetWidth;
  const th = tipEl.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const place = (side: TooltipSide) => {
    if (side === "right") {
      return { left: rect.right + TRIGGER_GAP, top: rect.top + (rect.height - th) / 2 };
    }
    if (side === "left") {
      return { left: rect.left - tw - TRIGGER_GAP, top: rect.top + (rect.height - th) / 2 };
    }
    if (side === "bottom") {
      return { left: rect.left + (rect.width - tw) / 2, top: rect.bottom + TRIGGER_GAP };
    }
    return { left: rect.left + (rect.width - tw) / 2, top: rect.top - th - TRIGGER_GAP };
  };

  let side = preferredSide;
  let pos = place(side);

  // Flip to opposite side if preferred side overflows the viewport
  if (side === "top" && pos.top < VIEWPORT_PAD) {
    side = "bottom";
    pos = place(side);
  } else if (side === "bottom" && pos.top + th > vh - VIEWPORT_PAD) {
    side = "top";
    pos = place(side);
  } else if (side === "right" && pos.left + tw > vw - VIEWPORT_PAD) {
    side = "left";
    pos = place(side);
  } else if (side === "left" && pos.left < VIEWPORT_PAD) {
    side = "right";
    pos = place(side);
  }

  return {
    left: Math.round(Math.max(VIEWPORT_PAD, Math.min(vw - tw - VIEWPORT_PAD, pos.left))),
    top: Math.round(Math.max(VIEWPORT_PAD, Math.min(vh - th - VIEWPORT_PAD, pos.top))),
  };
}

export function TooltipHost() {
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const warmUntilRef = useRef<number>(0);
  const pendingTargetRef = useRef<HTMLElement | null>(null);
  const visibleRef = useRef(false);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const hide = (recordWarm = true) => {
      clearTimer();
      if (recordWarm && visibleRef.current) {
        warmUntilRef.current = Date.now() + WARM_WINDOW_MS;
      }
      pendingTargetRef.current = null;
      visibleRef.current = false;
      setActive(null);
      setCoords(null);
    };

    const scheduleShow = (target: HTMLElement, immediate: boolean) => {
      const text = target.getAttribute("data-dw-tip");
      if (!text) return;
      clearTimer();
      pendingTargetRef.current = target;

      const sub = target.getAttribute("data-dw-tip-sub") ?? "";
      const kbd = target.getAttribute("data-dw-tip-kbd") ?? "";
      const sideAttr = target.getAttribute("data-dw-tip-side") as TooltipSide | null;
      const side: TooltipSide = sideAttr ?? "top";
      const delay = immediate || Date.now() < warmUntilRef.current ? 0 : OPEN_DELAY_MS;

      const commit = () => {
        if (pendingTargetRef.current !== target || !target.isConnected) return;
        visibleRef.current = true;
        setActive({ text, sub, kbd, side, target });
      };

      if (delay === 0) commit();
      else timerRef.current = window.setTimeout(commit, delay);
    };

    const onPointerOver = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-dw-tip]");
      if (!el) return;
      if (el === pendingTargetRef.current) return;
      scheduleShow(el, false);
    };

    const onPointerOut = (e: PointerEvent) => {
      const cur = pendingTargetRef.current;
      if (!cur) return;
      const related = e.relatedTarget as Node | null;
      if (!related || !cur.contains(related)) {
        hide(true);
      }
    };

    const onFocusIn = (e: FocusEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-dw-tip]");
      if (!el) return;
      try {
        if (el.matches(":focus-visible")) {
          scheduleShow(el, true);
        }
      } catch {
        // Fallback when :focus-visible selector is unsupported
      }
    };

    const onFocusOut = () => hide(false);
    const onPointerDown = () => hide(false);
    const onScroll = () => {
      if (visibleRef.current || pendingTargetRef.current) hide(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (visibleRef.current || pendingTargetRef.current)) {
        hide(false);
      }
    };

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      clearTimer();
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  useEffect(() => {
    if (!active || !tipRef.current) return;
    if (!active.target.isConnected) {
      setActive(null);
      return;
    }
    setCoords(computePosition(active.target, tipRef.current, active.side));
  }, [active]);

  if (!active || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={tipRef}
      role="tooltip"
      className={`dw-tooltip${coords ? " is-visible" : ""}`}
      style={coords ? { left: `${coords.left}px`, top: `${coords.top}px` } : { left: 0, top: 0 }}
    >
      <span className="dw-tooltip-text">{active.text}</span>
      {active.sub && <span className="dw-tooltip-sub">{active.sub}</span>}
      {active.kbd && <kbd className="dw-kbd">{active.kbd}</kbd>}
    </div>,
    document.body,
  );
}
