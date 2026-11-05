import { calendarDayInfo, lunarDayLabel } from "./calendar-data";

export function TimelineWeekDateContent({ date, weekday }: { date: string; weekday: string }) {
  const dayInfo = calendarDayInfo(date);
  const workStateLabel = dayInfo?.workState === "rest" ? "休" : dayInfo?.workState === "work" ? "班" : "";
  const primaryCalendarLabel = dayInfo?.labels[0];
  const lunarLabel = lunarDayLabel(date);

  return <>
    <span className="timeline-week-heading"><small>{weekday}</small>{workStateLabel && <span className={`work-state ${dayInfo?.workState}`}>{workStateLabel}</span>}</span>
    <span className="timeline-week-date"><strong>{Number(date.slice(8, 10))}</strong></span>
    <span className="timeline-week-calendar-meta" aria-hidden="true">
      {primaryCalendarLabel ? <span className={`calendar-label ${primaryCalendarLabel.kind}`}>{primaryCalendarLabel.text}</span> : lunarLabel && <span>{lunarLabel}</span>}
    </span>
  </>;
}
