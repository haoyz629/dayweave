import { CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getDaySchedule, listRecurringOccurrencesRange, RecurringItem, Task } from "./tauri";
import { timelineHoverPosition } from "./timeline-hover-card";
import { resultToday } from "./task-result";
import { WEEK_HOUR_HEIGHT, WeekEntry, weekClock, weekDatesFor, weekDetailRange, weekEntries, weekGroups, weekInitialMinute } from "./week-timeline-model";
import { TaskTagList } from "./task-tag-editor";
import { openUrl } from "@tauri-apps/plugin-opener";
import { taskResourceUrl } from "./task-notes";
import recurringIcon from "./assets/recurring.svg";
import "./week-timeline.css";

type WeekDay = { date: string; entries: WeekEntry[] };
type WeekDetails = { date: string; entries: WeekEntry[] };
const hourHeight = WEEK_HOUR_HEIGHT;
const timeTop = (minute: number) => minute / 60 * hourHeight;
const detailDateLabel = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日 周${["日", "一", "二", "三", "四", "五", "六"][new Date(`${date}T00:00:00Z`).getUTCDay()]}`;

function WeekDetailUrl({ url }: { url: string }) {
  const href = taskResourceUrl(url);
  const [error, setError] = useState("");
  async function openResource() {
    if (!href) return;
    try { await openUrl(href); setError(""); }
    catch { setError("链接暂时无法打开，请复制后在浏览器中打开。"); }
  }
  return <section className="detail-notes-group detail-url-group" aria-label="任务 URL">
    <h4 className="detail-label">URL</h4>
    {href ? <a className="detail-notes detail-url" href={href} target="_blank" rel="noopener noreferrer" onClick={event => { event.preventDefault(); void openResource(); }}>{url}</a> : <p className="detail-notes">{url}</p>}
    {error && <p className="detail-label" role="alert">{error}</p>}
  </section>;
}

export function WeekTimeline({ selectedDate, today, tasks, recurringItems, onOpenDay, onOpenTasks, onOpenRecurringItem }: {
  selectedDate: string;
  today: string;
  tasks: Task[];
  recurringItems: RecurringItem[];
  onOpenDay?: (date: string, returnContext?: { date: string; blockId?: string; taskId?: string; occurrenceId?: string }) => void;
  onOpenTasks?: (taskId: string, returnContext: { date: string; blockId?: string; taskId?: string }) => void;
  onOpenRecurringItem?: (recurringItemId: string, returnContext: { date: string; occurrenceId?: string }) => void;
}) {
  const first = weekDatesFor(selectedDate)[0];
  const dates = useMemo(() => weekDatesFor(first), [first]);
  const [data, setData] = useState<{ first: string; days: WeekDay[] } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(() => Date.now());
  const scrollerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const positionedWeekRef = useRef<string | null>(null);
  const [measure, setMeasure] = useState({ widths: Array(7).fill(160) as number[], time: 100 });
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
  const detailRange = details ? weekDetailRange(details.entries) : null;

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
      setMeasure({ widths: Array.from(grid.querySelectorAll<HTMLElement>(".week-timeline-day"), day => day.getBoundingClientRect().width - 1), time: context?.measureText("23:59–23:59").width ?? 100 });
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

  function openDetails(date: string, entries: WeekEntry[], trigger: HTMLElement) {
    detailTriggerRef.current = trigger;
    hideHover(true);
    setDetails({ date, entries });
  }
  function closeDetails() {
    suppressedRef.current = detailTriggerRef.current;
    setDetails(null);
    window.requestAnimationFrame(() => detailTriggerRef.current?.focus({ preventScroll: true }));
  }
  useEffect(() => { if (details && !dialogRef.current?.open) dialogRef.current?.showModal(); }, [details]);

  const allEntries = days.flatMap(day => day.entries);
  const planCount = allEntries.filter(entry => entry.tone === "plan" || entry.tone === "partial").length;
  const completedCount = allEntries.filter(entry => entry.tone === "completed").length;
  const incompleteCount = allEntries.filter(entry => entry.tone === "not-started" || entry.tone === "blocked").length;
  const totalMinutes = allEntries.reduce((sum, entry) => sum + (entry.startMinute !== null && entry.endMinute !== null ? entry.endMinute - entry.startMinute : 0), 0);
  const totalHours = Number((totalMinutes / 60).toFixed(1));
  const trackableCount = allEntries.filter(entry => entry.tone !== "fixed" && entry.tone !== "cancelled").length;
  const completionRate = trackableCount ? Math.round(completedCount / trackableCount * 100) : 0;

  return <section className="week-timeline" aria-label="周视图" aria-busy={loading}>
    {error && !ready ? <div className="week-timeline-state" role="alert"><strong>这一周暂时无法打开</strong><span>{error}</span><button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></div> : !ready ? <div className="week-timeline-state" role="status">正在载入这一周的安排…</div> : <>
      {error && <div className="week-timeline-refresh-error" role="alert"><span>更新未完成，显示上次载入的安排。</span><button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></div>}
      <div ref={scrollerRef} className="week-timeline-scroll" tabIndex={0} aria-label="全周共享 24 小时时间轴">
        <div ref={gridRef} className="week-timeline-grid">
          <div ref={headerRef} className="week-timeline-dates"><div className="week-timeline-corner" aria-hidden="true">时间</div>{days.map((day, index) => {
            const weekday = ["一", "二", "三", "四", "五", "六", "日"][index];
            return <div key={day.date} className={`week-day-col-head${index > 4 ? " weekend" : ""}${day.date === today ? " today" : ""}${day.date === selectedDate ? " selected" : ""}`}>
              <button type="button" className="week-day-head-main" aria-label={`${day.date}，星期${weekday}，查看全部${day.entries.length}项安排`} aria-current={day.date === today ? "date" : undefined} onClick={event => openDetails(day.date, day.entries, event.currentTarget)}>
                <span className="week-col-name">周{weekday}</span>
                <span className="week-col-num">{Number(day.date.slice(8, 10))}</span>
                <span className="week-col-count-pill">{day.entries.length} 项安排</span>
              </button>
              {onOpenDay && <button type="button" className="week-open-day-btn" aria-label={`看当日：${day.date}`} onClick={() => onOpenDay(day.date)}>看当日</button>}
            </div>;
          })}</div>
          <div className="week-timeline-body" style={{ height: 24 * hourHeight }}>
            <div className="week-timeline-axis" aria-hidden="true">{Array.from({ length: 25 }, (_, index) => <span key={index} style={{ top: index * hourHeight }}>{weekClock(index * 60)}</span>)}</div>
            {days.map((day, index) => <div key={day.date} className={`week-timeline-day${index > 4 ? " weekend" : ""}${day.date === today ? " today" : ""}`} data-date={day.date}>
              {weekGroups(day.entries).map(group => <div key={group.entries[0].layoutKey} className="week-timeline-group">
                {group.visible.map(entry => {
                  const lane = group.lanes[entry.layoutKey];
                  const span = group.dense ? Math.min(lane.columnSpan, 2 - lane.column) : lane.columnSpan;
                  const height = Math.max(2, timeTop(entry.endMinute - entry.startMinute) - 6);
                  const timeRows = (measure.widths[index] ?? 160) * span / group.columns - 14 >= measure.time ? 1 : 2;
                  const showTime = height >= 10 + timeRows * 14 + 2 + 18;
                  const showTags = entry.tags.length > 0 && height >= 10 + (showTime ? timeRows * 14 + 2 : 0) + 18 + 20;
                  const lines = Math.max(1, Math.min(6, Math.floor((height - 10 - (showTime ? timeRows * 14 + 2 : 0) - (showTags ? 20 : 0)) / 18)));
                  const tiny = height < 44;
                  const short = tiny && height >= 28;
                  return <button type="button" key={entry.layoutKey} data-entry={entry.layoutKey} data-start={entry.startMinute} data-end={entry.endMinute} data-column={lane.column} data-columns={group.columns} data-span={span}
                    className={`week-timeline-event tone-${entry.tone}${tiny ? " is-tiny" : ""}${short ? " is-short" : ""}`}
                    style={{ top: timeTop(entry.startMinute) + 3, height, left: `calc(${lane.column / group.columns * 100}% + 2px)`, right: `calc(${(group.columns - lane.column - span) / group.columns * 100}% + 2px)`, "--title-lines": lines } as CSSProperties}
                    aria-label={`${entry.time} ${entry.title}，${entry.layoutKey.startsWith("recurring:") ? "重复事项，" : ""}${entry.status}，查看详情`} aria-describedby={hover?.entry.layoutKey === entry.layoutKey && hover.entry.date === day.date ? "week-timeline-hover" : undefined}
                    onPointerEnter={event => { if (event.pointerType !== "touch") queueHover(entry, event.currentTarget, { x: event.clientX, y: event.clientY }); }} onPointerLeave={leaveHover}
                    onFocus={event => { if (event.currentTarget.matches(":focus-visible")) queueHover(entry, event.currentTarget); }} onBlur={() => { if (!hoverRef.current?.matches(":hover")) leaveHover(); }}
                    onClick={event => openDetails(day.date, group.entries, event.currentTarget)}>
                    {tiny ? short && <span className="week-timeline-task-title">{entry.tone === "completed" && "✓ "}{entry.layoutKey.startsWith("recurring:") && <img className="week-recurring-icon" src={recurringIcon} alt="" aria-hidden="true" />}{entry.title}</span> : <><span className="week-timeline-task-title">{entry.tone === "completed" && "✓ "}{entry.layoutKey.startsWith("recurring:") && <img className="week-recurring-icon" src={recurringIcon} alt="" aria-hidden="true" />}{entry.title}</span>{showTime && <time className="week-timeline-time">{timeRows === 1 ? entry.time : <><span>{weekClock(entry.startMinute)}</span><span>{weekClock(entry.endMinute)}</span></>}</time>}{showTags && <span className="week-timeline-tags"><TaskTagList tags={entry.tags} /></span>}</>}
                  </button>;
                })}
                {group.hidden > 0 && <button type="button" className={`week-timeline-more${timeTop(group.endMinute - group.startMinute) - 6 < 44 ? " is-tiny" : ""}`} data-hidden={group.hidden} style={{ top: timeTop(group.startMinute) + 3, height: Math.max(2, Math.min(44, timeTop(group.endMinute - group.startMinute) - 6)) }} aria-label={`另有${group.hidden}项，查看完整清单`} onClick={event => openDetails(day.date, group.entries, event.currentTarget)}>+{group.hidden}</button>}
              </div>)}
              {day.date === clockDate && <div className="week-timeline-now" style={{ top: timeTop(nowMinute) }} aria-label={`当前时间 ${weekClock(Math.floor(nowMinute))}`}><span>{weekClock(Math.floor(nowMinute))} 现在</span></div>}
            </div>)}
          </div>
        </div>
      </div>
      <footer className="week-timeline-legend" aria-label="任务状态图例"><span className="tone-plan">已安排 ({planCount})</span><span className="tone-completed">已完成 ({completedCount})</span><span className="tone-not-started">未完成 ({incompleteCount})</span><div className="week-legend-summary">本周共 <strong>{allEntries.length}</strong> 项安排 · 合计约 <strong>{totalHours}</strong> 小时 · 达成率 <strong>{completionRate}%</strong></div></footer>
    </>}
    {hover && createPortal(<aside ref={hoverRef} id="week-timeline-hover" className={`week-timeline-mini tone-${hover.entry.tone}`} role="tooltip" style={hoverPosition} onPointerEnter={keepHover} onPointerLeave={leaveHover}>
      <div><span>{hover.entry.status}</span><time>{hover.entry.time}</time></div><strong>{hover.entry.title}</strong>
      {hover.entry.layoutKey.startsWith("recurring:") && <span className="week-timeline-kind"><img className="week-recurring-icon" src={recurringIcon} alt="" aria-hidden="true" />重复事项</span>}
      <TaskTagList tags={hover.entry.tags} expanded />
    </aside>, document.body)}
    {details && createPortal(<dialog ref={dialogRef} className="week-timeline-details" aria-labelledby="week-timeline-details-title" onCancel={event => { event.preventDefault(); closeDetails(); }} onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }} onClick={event => { if (event.target === event.currentTarget) closeDetails(); }}>
      <section className="detail-surface">
        <header className="detail-heading">
          <div className="detail-heading-copy">
            <h2 id="week-timeline-details-title" className="detail-title"><time dateTime={details.date} title={details.date}>{detailDateLabel(details.date)}</time><span className="detail-count">· {details.entries.length}项安排</span></h2>
            {detailRange && <p className="detail-range">{detailRange}</p>}
          </div>
          <button type="button" className="detail-close" aria-label="关闭周视图详情" onClick={closeDetails}><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>
        </header>
        <div className="detail-body" tabIndex={0} aria-label="整组安排清单">{details.entries.length ? details.entries.map(entry => <article key={entry.layoutKey} data-entry={entry.layoutKey} className={`detail-item tone-${entry.tone}`}>
          <div className="detail-status-line"><span className={`detail-kind${entry.layoutKey.startsWith("recurring:") ? " is-recurring" : ""}`}>{entry.layoutKey.startsWith("recurring:") ? <><img className="week-recurring-icon" src={recurringIcon} alt="" aria-hidden="true" />重复事项</> : entry.layoutKey.startsWith("event:") ? "固定日程" : "普通任务"}</span><span className="detail-status">{entry.status}</span></div>
          <h3 className="detail-item-title">{entry.title}</h3>
          <div className="detail-item-schedule"><time className="detail-item-time">{entry.time}</time>{entry.startMinute !== null && entry.endMinute !== null && <span className="detail-duration">安排 {entry.endMinute - entry.startMinute} 分钟</span>}</div>
          {entry.tags.length > 0 && <div className="detail-tags"><TaskTagList tags={entry.tags} expanded /></div>}
          {entry.url && <WeekDetailUrl key={entry.url} url={entry.url} />}
          {entry.notes && <section className="detail-notes-group"><h4 className="detail-label">备注</h4><p className="detail-notes">{entry.notes}</p></section>}
          {(entry.taskId && onOpenTasks || entry.recurringItemId && onOpenRecurringItem || onOpenDay) && <div className="detail-item-actions">
            {entry.taskId && onOpenTasks && <button type="button" className="detail-action-button" onClick={() => { const date = details.date; setDetails(null); onOpenTasks(entry.taskId!, { date, blockId: entry.blockId, taskId: entry.taskId }); }}>查看任务</button>}
            {entry.recurringItemId && onOpenRecurringItem && <button type="button" className="detail-action-button" onClick={() => { const date = details.date; setDetails(null); onOpenRecurringItem(entry.recurringItemId!, { date, occurrenceId: entry.occurrenceId }); }}>查看重复规则</button>}
            {onOpenDay && <button type="button" className="detail-action-button is-locate" onClick={() => { const date = details.date; setDetails(null); onOpenDay(date, { date, blockId: entry.blockId, taskId: entry.taskId, occurrenceId: entry.occurrenceId }); }}>定位到当日时间线</button>}
          </div>}
        </article>) : <p className="detail-empty">这一天没有安排。</p>}</div>
        <footer className="detail-footer">
          {onOpenDay ? <button type="button" className="detail-open-day-button" onClick={() => { const date = details.date; setDetails(null); onOpenDay(date); }}>进入当日时间线</button> : <span>仅查看安排，不会修改任务</span>}
          <button type="button" className="detail-footer-close" onClick={closeDetails}>关闭</button>
        </footer>
      </section>
    </dialog>, document.body)}
  </section>;
}
