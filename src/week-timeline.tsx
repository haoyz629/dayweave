import { CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getDaySchedule, listRecurringOccurrencesRange, RecurringItem, Task } from "./tauri";
import { timelineHoverPosition } from "./timeline-hover-card";
import { resultToday } from "./task-result";
import { shiftWeekDate, WEEK_HOUR_HEIGHT, WeekEntry, weekClock, weekDatesFor, weekEntries, weekGroups, weekHeading, weekInitialMinute } from "./week-timeline-model";
import "./week-timeline.css";

type WeekDay = { date: string; entries: WeekEntry[] };
type WeekDetails = { title: string; entries: WeekEntry[] };
const hourHeight = WEEK_HOUR_HEIGHT;
const timeTop = (minute: number) => minute / 60 * hourHeight;

export function WeekTimeline({ selectedDate, today, tasks, recurringItems, onSelectDate }: {
  selectedDate: string;
  today: string;
  tasks: Task[];
  recurringItems: RecurringItem[];
  onSelectDate: (date: string) => boolean;
}) {
  const first = weekDatesFor(selectedDate)[0];
  const dates = useMemo(() => weekDatesFor(first), [first]);
  const heading = weekHeading(first, dates[6]);
  const [data, setData] = useState<{ first: string; days: WeekDay[] } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(() => Date.now());
  const scrollerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const positionedWeekRef = useRef<string | null>(null);
  const [measure, setMeasure] = useState({ width: 160, time: 100 });
  const [details, setDetails] = useState<WeekDetails | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const [hover, setHover] = useState<{ entry: WeekEntry; point: { x: number; y: number } } | null>(null);
  const [hoverPosition, setHoverPosition] = useState({ left: 12, top: 12 });
  const hoverRef = useRef<HTMLElement>(null);
  const hoverAnchorRef = useRef<HTMLElement | null>(null);
  const suppressedRef = useRef<HTMLElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const ready = data?.first === first;
  const days = ready ? data.days : [];
  const nowMinute = ((clock + 8 * 3_600_000) % 86_400_000) / 60_000;
  const clockDate = resultToday(clock);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    void Promise.all([Promise.all(dates.map(date => getDaySchedule(date))), listRecurringOccurrencesRange(first, dates[6])])
      .then(([schedules, occurrences]) => {
        if (!cancelled) setData({ first, days: dates.map((date, index) => ({ date, entries: weekEntries(date, schedules[index], occurrences, tasks, today) })) });
      }).catch(() => { if (!cancelled) setError("本地安排暂时无法载入，请稍后重试。"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [first, dates, tasks, recurringItems, today, retry]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const update = () => {
      const context = document.createElement("canvas").getContext("2d");
      if (context) context.font = `12px ${getComputedStyle(grid).fontFamily}`;
      setMeasure({ width: (grid.getBoundingClientRect().width - 64) / 7, time: context?.measureText("23:59–23:59").width ?? 100 });
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(grid);
    return () => observer.disconnect();
  }, [ready]);

  useLayoutEffect(() => { positionedWeekRef.current = null; }, [first]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!ready || !scroller || positionedWeekRef.current === first) return;
    const headerHeight = headerRef.current?.offsetHeight ?? 72;
    const viewport = Math.max(1, scroller.clientHeight - headerHeight);
    const minute = weekInitialMinute(dates, clockDate, nowMinute, days.flatMap(day => day.entries), viewport / hourHeight * 60);
    scroller.scrollTop = Math.max(0, timeTop(minute) - viewport / 2);
    scroller.scrollLeft = 0;
    positionedWeekRef.current = first;
  }, [ready, first, days, dates, clockDate, nowMinute]);

  function clearTimers() {
    if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    openTimerRef.current = closeTimerRef.current = null;
  }
  function hideHover(suppress = false) {
    clearTimers();
    const anchor = hoverAnchorRef.current;
    if (suppress) suppressedRef.current = anchor && (anchor.matches(":hover") || document.activeElement === anchor) ? anchor : null;
    setHover(null);
  }
  function keepHover() {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }
  function leaveHover() {
    if (!dialogRef.current?.open) suppressedRef.current = null;
    if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
    keepHover();
    closeTimerRef.current = window.setTimeout(() => { closeTimerRef.current = null; setHover(null); }, 180);
  }
  function queueHover(entry: WeekEntry, anchor: HTMLElement, point?: { x: number; y: number }) {
    if (suppressedRef.current === anchor || dialogRef.current?.open) return;
    clearTimers(); hoverAnchorRef.current = anchor;
    const rect = anchor.getBoundingClientRect();
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      setHover({ entry, point: point ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } });
    }, 250);
  }
  useEffect(() => {
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && hoverRef.current?.contains(event.target)) return;
      hideHover(true);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (hoverRef.current || openTimerRef.current !== null)) {
        event.preventDefault(); event.stopPropagation(); hideHover(true);
      }
    };
    document.addEventListener("scroll", dismiss, true);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", dismiss); window.addEventListener("blur", dismiss);
    return () => {
      clearTimers();
      document.removeEventListener("scroll", dismiss, true);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", dismiss); window.removeEventListener("blur", dismiss);
    };
  }, []);
  useEffect(() => { hideHover(true); setDetails(null); }, [first, data]);
  useLayoutEffect(() => {
    if (!hover || !hoverRef.current) return;
    const card = hoverRef.current;
    const update = () => setHoverPosition(timelineHoverPosition(hover.point, card.getBoundingClientRect(), { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }));
    update(); const observer = new ResizeObserver(update); observer.observe(card);
    return () => observer.disconnect();
  }, [hover]);

  function openDetails(title: string, entries: WeekEntry[], trigger: HTMLElement) {
    detailTriggerRef.current = trigger;
    hideHover(true);
    setDetails({ title, entries });
  }
  function closeDetails() {
    suppressedRef.current = detailTriggerRef.current;
    setDetails(null);
    window.requestAnimationFrame(() => detailTriggerRef.current?.focus({ preventScroll: true }));
  }
  useEffect(() => { if (details && !dialogRef.current?.open) dialogRef.current?.showModal(); }, [details]);

  function moveWeek(date: string) {
    if (onSelectDate(date)) { hideHover(true); setDetails(null); }
  }

  return <section className="week-timeline" aria-label="只读周视图" aria-busy={loading}>
    <header className="week-timeline-toolbar">
      <div className="week-timeline-heading"><h2>{heading.range}</h2><span className="week-timeline-chip" title={`${heading.year}年第${heading.week}周`}>第{heading.week}周</span></div>
      <nav aria-label="周导航"><button type="button" aria-label="上一周" onClick={() => moveWeek(shiftWeekDate(selectedDate, -7))}>‹</button><button type="button" onClick={() => moveWeek(today)}>本周</button><button type="button" aria-label="下一周" onClick={() => moveWeek(shiftWeekDate(selectedDate, 7))}>›</button></nav>
    </header>
    {error && !ready ? <div className="week-timeline-state" role="alert"><strong>这一周暂时无法打开</strong><span>{error}</span><button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></div> : !ready ? <div className="week-timeline-state" role="status">正在载入这一周的安排…</div> : <>
      {error && <div className="week-timeline-refresh-error" role="alert"><span>更新未完成，显示上次载入的安排。</span><button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></div>}
      <div ref={scrollerRef} className="week-timeline-scroll" tabIndex={0} aria-label="全周共享 24 小时时间轴">
        <div ref={gridRef} className="week-timeline-grid">
          <div ref={headerRef} className="week-timeline-dates"><div className="week-timeline-corner" aria-hidden="true">时间</div>{days.map((day, index) => <button type="button" key={day.date} className={`${index > 4 ? "weekend " : ""}${day.date === today ? "today" : ""}`} aria-label={`${day.date}，查看全部${day.entries.length}项安排`} aria-current={day.date === today ? "date" : undefined} onClick={event => openDetails(`${day.date} 全部安排`, day.entries, event.currentTarget)}>
            <span>周{["一", "二", "三", "四", "五", "六", "日"][index]}</span><strong>{Number(day.date.slice(8))}</strong>{day.entries.length > 0 && <small>{day.entries.length} 项</small>}
          </button>)}</div>
          <div className="week-timeline-body" style={{ height: 24 * hourHeight }}>
            <div className="week-timeline-axis" aria-hidden="true">{Array.from({ length: 25 }, (_, index) => <span key={index} style={{ top: index * hourHeight }}>{weekClock(index * 60)}</span>)}</div>
            {days.map((day, index) => <div key={day.date} className={`week-timeline-day${index > 4 ? " weekend" : ""}`} data-date={day.date}>
              {weekGroups(day.entries).map(group => <div key={group.entries[0].layoutKey} className="week-timeline-group">
                {group.visible.map(entry => {
                  const lane = group.lanes[entry.layoutKey];
                  const span = group.dense ? Math.min(lane.columnSpan, 2 - lane.column) : lane.columnSpan;
                  const height = Math.max(2, timeTop(entry.endMinute - entry.startMinute) - 4);
                  const timeRows = measure.width * span / group.columns - 18 >= measure.time ? 1 : 2;
                  const showTime = height >= 10 + timeRows * 14 + 4 + 18;
                  const lines = Math.max(1, Math.min(6, Math.floor((height - 10 - (showTime ? timeRows * 14 + 4 : 0)) / 18)));
                  const tiny = height < 44;
                  return <button type="button" key={entry.layoutKey} data-entry={entry.layoutKey} data-start={entry.startMinute} data-end={entry.endMinute} data-column={lane.column} data-columns={group.columns} data-span={span}
                    className={`week-timeline-event tone-${entry.tone}${tiny ? " is-tiny" : ""}`}
                    style={{ top: timeTop(entry.startMinute) + 2, height, left: `calc(${lane.column / group.columns * 100}% + 4px)`, right: `calc(${(group.columns - lane.column - span) / group.columns * 100}% + 4px)`, "--title-lines": lines } as CSSProperties}
                    aria-label={`${entry.time} ${entry.title}，${entry.status}，查看详情`} aria-describedby={hover?.entry.layoutKey === entry.layoutKey && hover.entry.date === day.date ? "week-timeline-hover" : undefined}
                    onPointerEnter={event => { if (event.pointerType !== "touch") queueHover(entry, event.currentTarget, { x: event.clientX, y: event.clientY }); }} onPointerLeave={leaveHover}
                    onFocus={event => { if (event.currentTarget.matches(":focus-visible")) queueHover(entry, event.currentTarget); }} onBlur={() => { if (!hoverRef.current?.matches(":hover")) leaveHover(); }}
                    onClick={event => openDetails(entry.title, [entry], event.currentTarget)}>
                    {!tiny && <>{showTime && <time className="week-timeline-time">{timeRows === 1 ? entry.time : <><span>{weekClock(entry.startMinute)}</span><span>{weekClock(entry.endMinute)}</span></>}</time>}<span className="week-timeline-task-title">{entry.title}</span></>}
                  </button>;
                })}
                {group.hidden > 0 && <button type="button" className={`week-timeline-more${timeTop(group.endMinute - group.startMinute) - 4 < 44 ? " is-tiny" : ""}`} data-hidden={group.hidden} style={{ top: timeTop(group.startMinute) + 2, height: Math.max(2, Math.min(44, timeTop(group.endMinute - group.startMinute) - 4)) }} aria-label={`另有${group.hidden}项，查看完整清单`} onClick={event => openDetails(`${day.date} ${weekClock(group.startMinute)}–${weekClock(group.endMinute)} 全部安排`, group.entries, event.currentTarget)}>+{group.hidden}</button>}
              </div>)}
              {day.date === clockDate && <div className="week-timeline-now" style={{ top: timeTop(nowMinute) }} aria-label={`当前时间 ${weekClock(Math.floor(nowMinute))}`}><span>{weekClock(Math.floor(nowMinute))}</span></div>}
            </div>)}
          </div>
        </div>
      </div>
      <footer className="week-timeline-legend"><span className="tone-plan">已安排</span><span className="tone-completed">已完成</span><span className="tone-recurring">重复事项</span><small>只读 · 点击任务或日期查看完整安排</small></footer>
    </>}
    {hover && createPortal(<aside ref={hoverRef} id="week-timeline-hover" className={`week-timeline-mini tone-${hover.entry.tone}`} role="tooltip" style={hoverPosition} onPointerEnter={keepHover} onPointerLeave={leaveHover}>
      <div><span>{hover.entry.status}</span><time>{hover.entry.time}</time></div><strong>{hover.entry.title}</strong>
    </aside>, document.body)}
    {details && createPortal(<dialog ref={dialogRef} className="week-timeline-details" aria-labelledby="week-timeline-details-title" onCancel={event => { event.preventDefault(); closeDetails(); }} onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }} onClick={event => { if (event.target === event.currentTarget) closeDetails(); }}>
      <section><header><div><h2 id="week-timeline-details-title">{details.title}</h2><span>只读安排</span></div><button type="button" aria-label="关闭周视图详情" onClick={closeDetails}>×</button></header>
        <div className="week-timeline-detail-list">{details.entries.length ? details.entries.map(entry => <article key={entry.layoutKey} className={`tone-${entry.tone}`}><div><span>{entry.status}</span><time>{entry.date} {entry.time}</time></div><h3>{entry.title}</h3>{entry.tags.length > 0 && <p>{entry.tags.join(" · ")}</p>}{entry.notes && <p className="week-timeline-notes">{entry.notes}</p>}</article>) : <p>这一天没有安排。</p>}</div>
      </section>
    </dialog>, document.body)}
  </section>;
}
