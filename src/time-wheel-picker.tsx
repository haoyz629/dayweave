import { KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { parseClockMinutes, TimeRangeEdge } from "./time-range-control";
import "./time-wheel-picker.css";

const WHEEL_ROW_HEIGHT = 34;
const WHEEL_SNAP_DURATION_MS = 195;
const WHEEL_DRAG_DAMPING = 0.68;
const WHEEL_TRACKPAD_DAMPING = 0.72;
const WHEEL_TRACKPAD_THRESHOLD = 36;
const WHEEL_TRACKPAD_COOLDOWN_MS = 68;
const WHEEL_DETENT_THRESHOLD = 80;
const WHEEL_DETENT_COOLDOWN_MS = 52;
const HOURS_24 = Array.from({ length: 24 }, (_, index) => index);
const HOURS_25 = Array.from({ length: 25 }, (_, index) => index);
const MINUTES_STEP_5 = Array.from({ length: 12 }, (_, index) => index * 5);

const pad2 = (value: number) => String(value).padStart(2, "0");

function clampIndex(index: number, length: number) {
  return Math.max(0, Math.min(length - 1, index));
}

function reducedMotionPreferred() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

function nearestMinuteIndex(minute: number) {
  return clampIndex(Math.round(minute / 5), MINUTES_STEP_5.length);
}

export function TimeWheelTrigger({
  active,
  disabled = false,
  label,
  controlsId,
  onToggle
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  controlsId?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`time-wheel-trigger${active ? " is-active" : ""}`}
      disabled={disabled}
      aria-haspopup="dialog"
      aria-expanded={active}
      aria-controls={active ? controlsId : undefined}
      aria-label={label}
      title="打开时间滚轴"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m7 15 5 5 5-5" />
        <path d="m7 9 5-5 5 5" />
      </svg>
    </button>
  );
}

type WheelOption = {
  value: number;
  label: string;
  disabled?: boolean;
};

function WheelColumn({
  ariaLabel,
  heading,
  options,
  selectedIndex,
  exactMatch,
  open,
  listRef,
  onSelectValue,
  onSwitchColumn,
  onConfirmClose
}: {
  ariaLabel: string;
  heading: string;
  options: WheelOption[];
  selectedIndex: number;
  exactMatch: boolean;
  open: boolean;
  listRef: RefObject<HTMLDivElement>;
  onSelectValue: (value: number) => void;
  onSwitchColumn: () => void;
  onConfirmClose: () => void;
}) {
  const wheelIdPrefix = useId();
  const suppressScrollRef = useRef(false);
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef(0);
  const animFrameRef = useRef(0);
  const wheelAccumRef = useRef(0);
  const lastWheelStepAtRef = useRef(0);
  const scrollSettleRef = useRef(0);
  const dragRef = useRef<{ pointerId: number; startY: number; startScrollTop: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragPreviewIndex, setDragPreviewIndex] = useState<number | null>(null);

  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const onSelectRef = useRef(onSelectValue);
  onSelectRef.current = onSelectValue;

  function cancelScrollAnimation() {
    if (animFrameRef.current && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(animFrameRef.current);
    }
    animFrameRef.current = 0;
    listRef.current?.classList?.remove("is-animating");
  }

  function scrollToIndex(index: number, smooth: boolean) {
    const list = listRef.current;
    if (!list) return;
    const top = clampIndex(index, optionsRef.current.length) * WHEEL_ROW_HEIGHT;
    cancelScrollAnimation();
    suppressScrollRef.current = true;
    window.clearTimeout(suppressTimerRef.current);

    if (!smooth || reducedMotionPreferred() || typeof window.requestAnimationFrame !== "function") {
      if (typeof list.scrollTo === "function" && smooth && !reducedMotionPreferred()) {
        list.scrollTo({ top, behavior: "smooth" });
      } else {
        list.scrollTop = top;
      }
      suppressTimerRef.current = window.setTimeout(() => {
        suppressScrollRef.current = false;
      }, 40);
      return;
    }

    const startTop = list.scrollTop;
    const distance = top - startTop;
    if (Math.abs(distance) < 0.5) {
      list.scrollTop = top;
      suppressTimerRef.current = window.setTimeout(() => {
        suppressScrollRef.current = false;
      }, 40);
      return;
    }

    list.classList?.add("is-animating");
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    const stepFrame = (timestamp: number) => {
      const currentList = listRef.current;
      if (!currentList) {
        animFrameRef.current = 0;
        suppressScrollRef.current = false;
        return;
      }
      const progress = Math.min(1, Math.max(0, (timestamp - startedAt) / WHEEL_SNAP_DURATION_MS));
      const eased = 1 - Math.pow(1 - progress, 3);
      currentList.scrollTop = startTop + distance * eased;
      if (progress < 1) {
        animFrameRef.current = window.requestAnimationFrame(stepFrame);
      } else {
        currentList.scrollTop = top;
        animFrameRef.current = 0;
        currentList.classList?.remove("is-animating");
        suppressTimerRef.current = window.setTimeout(() => {
          suppressScrollRef.current = false;
        }, 40);
      }
    };
    animFrameRef.current = window.requestAnimationFrame(stepFrame);
  }

  function stepBy(delta: number) {
    const list = optionsRef.current;
    if (!list.length) return;
    let next = clampIndex(selectedIndexRef.current + delta, list.length);
    while (next >= 0 && next < list.length && list[next].disabled) {
      next += delta >= 0 ? 1 : -1;
    }
    if (next < 0 || next >= list.length || list[next].disabled) return;
    scrollToIndex(next, true);
    onSelectRef.current(list[next].value);
  }

  useLayoutEffect(() => {
    if (!open || dragRef.current?.moved) return;
    scrollToIndex(selectedIndex, false);
  }, [open, selectedIndex]);

  useEffect(() => {
    const element = listRef.current;
    if (!open || !element) return;
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      event.stopPropagation();
      const modeScale = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? 90 : 1;
      const deltaPx = event.deltaY * modeScale;
      if (!deltaPx) return;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();

      if (wheelAccumRef.current !== 0 && Math.sign(deltaPx) !== Math.sign(wheelAccumRef.current)) {
        wheelAccumRef.current = 0;
      }

      if (Math.abs(deltaPx) >= WHEEL_DETENT_THRESHOLD) {
        wheelAccumRef.current = 0;
        if (now - lastWheelStepAtRef.current < WHEEL_DETENT_COOLDOWN_MS) return;
        lastWheelStepAtRef.current = now;
        stepBy(deltaPx > 0 ? 1 : -1);
        return;
      }

      wheelAccumRef.current += deltaPx * WHEEL_TRACKPAD_DAMPING;
      if (Math.abs(wheelAccumRef.current) < WHEEL_TRACKPAD_THRESHOLD) return;
      if (now - lastWheelStepAtRef.current < WHEEL_TRACKPAD_COOLDOWN_MS) return;
      const step = wheelAccumRef.current > 0 ? 1 : -1;
      wheelAccumRef.current = 0;
      lastWheelStepAtRef.current = now;
      stepBy(step);
    }
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", handleWheel);
      cancelScrollAnimation();
      window.clearTimeout(scrollSettleRef.current);
      window.clearTimeout(suppressTimerRef.current);
    };
  }, [open]);

  function commitFromScrollTop(scrollTop: number, snap: boolean) {
    const list = optionsRef.current;
    if (!list.length) return;
    let target = clampIndex(Math.round(scrollTop / WHEEL_ROW_HEIGHT), list.length);
    if (list[target]?.disabled) {
      target = list.findIndex((option) => !option.disabled);
      if (target < 0) return;
    }
    if (snap) scrollToIndex(target, true);
    if (target !== selectedIndexRef.current) {
      onSelectRef.current(list[target].value);
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const list = listRef.current;
    if (!list) return;
    event.stopPropagation();
    cancelScrollAnimation();
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: list.scrollTop,
      moved: false
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const list = listRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !list) return;
    const delta = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(delta) >= 5) {
      drag.moved = true;
      suppressClickRef.current = true;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (!drag.moved) return;
    suppressScrollRef.current = true;
    const maxScroll = Math.max(0, (options.length - 1) * WHEEL_ROW_HEIGHT);
    const nextScrollTop = Math.max(0, Math.min(maxScroll, drag.startScrollTop - delta * WHEEL_DRAG_DAMPING));
    list.scrollTop = nextScrollTop;
    setDragPreviewIndex(clampIndex(Math.round(nextScrollTop / WHEEL_ROW_HEIGHT), options.length));
  }

  function finishPointerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const list = listRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragPreviewIndex(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.moved && list) {
      setDragging(false);
      commitFromScrollTop(list.scrollTop, true);
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    } else {
      suppressClickRef.current = false;
      setDragging(false);
    }
  }

  function handleScroll() {
    if (suppressScrollRef.current || dragRef.current?.moved) return;
    const list = listRef.current;
    if (!list) return;
    window.clearTimeout(scrollSettleRef.current);
    scrollSettleRef.current = window.setTimeout(() => {
      commitFromScrollTop(list.scrollTop, true);
    }, 105);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowUp") { event.preventDefault(); stepBy(-1); }
    else if (event.key === "ArrowDown") { event.preventDefault(); stepBy(1); }
    else if (event.key === "PageUp") { event.preventDefault(); stepBy(-3); }
    else if (event.key === "PageDown") { event.preventDefault(); stepBy(3); }
    else if (event.key === "Home") {
      event.preventDefault();
      const first = options.findIndex((option) => !option.disabled);
      if (first >= 0) { scrollToIndex(first, true); onSelectValue(options[first].value); }
    } else if (event.key === "End") {
      event.preventDefault();
      const last = options.length - 1 - [...options].reverse().findIndex((option) => !option.disabled);
      if (last >= 0 && last < options.length) { scrollToIndex(last, true); onSelectValue(options[last].value); }
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      onSwitchColumn();
    } else if (event.key === "Enter") {
      event.preventDefault();
      onConfirmClose();
    }
  }

  const activeCenterIndex = dragPreviewIndex ?? selectedIndex;

  return (
    <div className="time-wheel-column">
      <span className="time-wheel-column-label" aria-hidden="true">{heading}</span>
      <div
        ref={listRef}
        className={`time-wheel-list${dragging ? " is-dragging" : ""}`}
        role="listbox"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-activedescendant={options[activeCenterIndex] ? `${wheelIdPrefix}-${options[activeCenterIndex].value}` : undefined}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerDrag}
        onPointerCancel={finishPointerDrag}
      >
        <div className="time-wheel-spacer" aria-hidden="true" />
        {options.map((option, index) => {
          const distance = Math.min(2, Math.abs(index - activeCenterIndex));
          const isCenter = index === activeCenterIndex;
          const isSelected = isCenter && (exactMatch || dragPreviewIndex !== null);
          const isNearest = isCenter && !isSelected;
          return (
            <button
              key={option.value}
              id={`${wheelIdPrefix}-${option.value}`}
              type="button"
              role="option"
              tabIndex={-1}
              disabled={option.disabled}
              aria-selected={isSelected}
              data-distance={distance}
              className={`time-wheel-item${isSelected ? " is-selected" : isNearest ? " is-nearest" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (option.disabled || suppressClickRef.current) return;
                scrollToIndex(index, true);
                onSelectValue(option.value);
              }}
            >
              {option.label}
            </button>
          );
        })}
        <div className="time-wheel-spacer" aria-hidden="true" />
      </div>
    </div>
  );
}

export function TimeWheelPopover({
  id,
  open,
  edge,
  value,
  fallbackValue = "09:00",
  allowMidnightEnd = false,
  anchorRef,
  onSelect,
  onClose
}: {
  id?: string;
  open: boolean;
  edge: TimeRangeEdge;
  value: string;
  fallbackValue?: string;
  allowMidnightEnd?: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onSelect: (clock: string) => void;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const hourListRef = useRef<HTMLDivElement>(null);
  const minuteListRef = useRef<HTMLDivElement>(null);

  const allowMidnight = allowMidnightEnd && edge === "end";
  const parsedMinutes = parseClockMinutes(value, allowMidnight)
    ?? parseClockMinutes(fallbackValue, allowMidnight)
    ?? 9 * 60;
  const activeHour = Math.floor(parsedMinutes / 60);
  const activeMinute = parsedMinutes % 60;
  const exactFiveMinute = activeMinute % 5 === 0;
  const hourValues = allowMidnight ? HOURS_25 : HOURS_24;
  const hourOptions: WheelOption[] = hourValues.map((hour) => ({ value: hour, label: pad2(hour) }));
  const minuteOptions: WheelOption[] = MINUTES_STEP_5.map((minute) => ({
    value: minute,
    label: pad2(minute),
    disabled: activeHour === 24 && minute !== 0
  }));
  const hourIndex = clampIndex(activeHour, hourOptions.length);
  const minuteIndex = activeHour === 24 ? 0 : nearestMinuteIndex(activeMinute);
  const displayClock = `${pad2(activeHour)}:${pad2(activeMinute)}`;

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    const anchor = anchorRef.current;
    if (!open || !popover || !anchor) return;
    if (typeof popover.setAttribute === "function") popover.setAttribute("popover", "manual");
    if (typeof popover.showPopover === "function") {
      try {
        if (!popover.matches(":popover-open")) popover.showPopover();
      } catch {
        popover.showPopover();
      }
    }

    function position() {
      if (!popover || !anchor) return;
      const anchorRect = anchor.getBoundingClientRect();
      const popRect = popover.getBoundingClientRect();
      const width = popRect.width || 228;
      const height = popRect.height || 274;
      const padding = 12;
      const spaceBelow = window.innerHeight - anchorRect.bottom - padding;
      const spaceAbove = anchorRect.top - padding;
      const top = spaceBelow >= height + 6 || spaceBelow >= spaceAbove
        ? Math.max(padding, Math.min(window.innerHeight - height - padding, anchorRect.bottom + 6))
        : Math.max(padding, anchorRect.top - height - 6);
      const centeredLeft = anchorRect.left + (anchorRect.width - width) / 2;
      const left = Math.max(padding, Math.min(centeredLeft, window.innerWidth - width - padding));
      popover.style.top = `${Math.round(top)}px`;
      popover.style.left = `${Math.round(left)}px`;
    }

    position();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(position) : null;
    observer?.observe(popover);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      if (typeof popover.hidePopover === "function") {
        try {
          if (popover.matches(":popover-open")) popover.hidePopover();
        } catch {
          // Ignore when already hidden or detached.
        }
      }
    };
  }, [open, anchorRef, edge]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, anchorRef, onClose]);

  if (!open) return null;

  function selectHour(nextHour: number) {
    if (nextHour === 24 && allowMidnight) {
      onSelect("24:00");
      return;
    }
    onSelect(`${pad2(nextHour)}:${pad2(activeMinute)}`);
  }

  function selectMinute(nextMinute: number) {
    const safeHour = activeHour === 24 ? 23 : activeHour;
    onSelect(`${pad2(safeHour)}:${pad2(nextMinute)}`);
  }

  return (
    <div
      id={id}
      ref={popoverRef}
      className="time-wheel-popover"
      role="dialog"
      aria-label={edge === "start" ? "选择开始时间" : "选择结束时间"}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <header className="time-wheel-header">
        <span className="time-wheel-title">
          <i className={`time-range-marker ${edge}`} aria-hidden="true" />
          <strong>{edge === "start" ? "开始时间" : "结束时间"}</strong>
        </span>
        <output className="time-wheel-readout">{displayClock}</output>
      </header>
      <div className="time-wheel-columns">
        <div className="time-wheel-selection-band" aria-hidden="true">
          <span>:</span>
        </div>
        <WheelColumn
          ariaLabel="选择小时"
          heading="时"
          options={hourOptions}
          selectedIndex={hourIndex}
          exactMatch={true}
          open={open}
          listRef={hourListRef}
          onSelectValue={selectHour}
          onSwitchColumn={() => minuteListRef.current?.focus()}
          onConfirmClose={onClose}
        />
        <WheelColumn
          ariaLabel="选择分钟"
          heading="分"
          options={minuteOptions}
          selectedIndex={minuteIndex}
          exactMatch={exactFiveMinute}
          open={open}
          listRef={minuteListRef}
          onSelectValue={selectMinute}
          onSwitchColumn={() => hourListRef.current?.focus()}
          onConfirmClose={onClose}
        />
      </div>
      <footer className="time-wheel-footer">
        <span>{exactFiveMinute ? "滚轮 5 分 · 可手写 1 分" : `精确 ${displayClock} · 滚轮按 5 分`}</span>
        <button
          type="button"
          className="time-wheel-done"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClose}
        >
          完成
        </button>
      </footer>
    </div>
  );
}
