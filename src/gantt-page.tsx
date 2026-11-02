import { useId, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Task } from "./tauri";
import { taskListStatus } from "./task-result";
import type { TaskListStatus } from "./task-result";
import { buildGanttRows, calendarWeekday, ganttTags, ganttWindow, shiftGanttAnchor } from "./gantt-model";
import type { GanttDateIssue, GanttMode, GanttStatusFilter } from "./gantt-model";
import { CopySeparator } from "./copy-separator";
import "./gantt-page.css";

export type GanttPageProps = {
  tasks: Task[];
  today: string;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onOpenTask: (task: Task) => void;
};

const STATUS_LABEL: Record<TaskListStatus, string> = { open: "待处理", scheduled: "已安排", not_completed: "未完成", done: "已完成", deleted: "已删除" };
const ISSUE_LABEL: Record<GanttDateIssue, string> = {
  missing_start: "缺少最早开始日期",
  missing_end: "缺少截止日期",
  invalid_start: "最早开始日期无效",
  invalid_end: "截止日期无效",
  reversed: "截止日期早于开始日期",
};
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
function dateLabel(date: string): string {
  return `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}
function taskTitle(task: Task): string { return task.title.trim() || "未命名任务"; }

/** Read-only task date overview; opening/editing a task remains the parent's responsibility. */
export function GanttPage({ tasks, today, loading, error, onReload, onOpenTask }: GanttPageProps) {
  const id = useId();
  const [mode, setMode] = useState<GanttMode>("week");
  const [anchor, setAnchor] = useState(today);
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState<GanttStatusFilter>("all");
  const window = useMemo(() => ganttWindow(anchor, mode), [anchor, mode]);
  const tags = useMemo(() => ganttTags(tasks), [tasks]);
  const { rows, issues, matchingCount } = useMemo(() => buildGanttRows(tasks, window, { tag, status }), [tasks, window, tag, status]);
  const days = useMemo(() => window.days.map((date) => ({ date, weekday: calendarWeekday(date), isToday: date === today })), [window, today]);
  const period = mode === "week" ? "周" : "月";
  const rangeLabel = `${dateLabel(window.start)} — ${dateLabel(window.end)}`;
  const filtered = tag !== "" || status !== "all";
  const outsideCount = matchingCount - rows.length - issues.length;
  const chartStyle = { "--gantt-days": days.length } as CSSProperties;
  const resetFilters = () => { setTag(""); setStatus("all"); };

  return <section className="gantt-page" aria-labelledby={`${id}-title`}>
    <header className="gantt-heading">
      <div>
        <p className="gantt-eyebrow">计划视野<CopySeparator />任务日期</p>
        <h1 id={`${id}-title`}>甘特图</h1>
        <p className="gantt-subtitle">看清任务的起止跨度，不替代每日执行安排。</p>
      </div>
      <button type="button" className="gantt-control gantt-reload" onClick={onReload} disabled={loading}>
        {loading ? "正在刷新…" : "刷新任务"}
      </button>
    </header>

    <div className="gantt-toolbar">
      <div className="gantt-navigation" role="group" aria-label="日期导航">
        <button type="button" className="gantt-control gantt-arrow" aria-label={`上一${period}`} title={`上一${period}`}
          disabled={window.start === "0001-01-01"} onClick={() => setAnchor(shiftGanttAnchor(window.start, mode, -1))}>‹</button>
        <button type="button" className="gantt-control" onClick={() => setAnchor(today)}>今天</button>
        <button type="button" className="gantt-control gantt-arrow" aria-label={`下一${period}`} title={`下一${period}`}
          disabled={window.end === "9999-12-31"} onClick={() => setAnchor(shiftGanttAnchor(window.start, mode, 1))}>›</button>
      </div>
      <div className="gantt-mode" role="group" aria-label="显示范围">
        <button type="button" aria-pressed={mode === "week"} onClick={() => setMode("week")}>周</button>
        <button type="button" aria-pressed={mode === "month"} onClick={() => setMode("month")}>月</button>
      </div>
      <div className="gantt-filters">
        <label className="gantt-filter">标签
          <select value={tag} onChange={(event) => setTag(event.target.value)}>
            <option value="">全部标签</option>
            {tag && !tags.includes(tag) && <option value={tag}>{tag}（已无任务）</option>}
            {tags.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>
        <label className="gantt-filter">状态
          <select value={status} onChange={(event) => setStatus(event.target.value as GanttStatusFilter)}>
            <option value="all">全部（不含已删除）</option>
            <option value="open">待处理</option>
            <option value="scheduled">已安排</option>
            <option value="not_completed">未完成</option>
            <option value="done">已完成</option>
          </select>
        </label>
      </div>
    </div>

    <div className="gantt-range-heading">
      <h2 id={`${id}-range`}>{rangeLabel}</h2>
      <span aria-live="polite" aria-atomic="true">当前{period}视图<CopySeparator />{rows.length} 个任务</span>
    </div>

    {error && <div className="gantt-error" role="alert"><strong>任务加载失败</strong><span>{error}</span><span>可点击“刷新任务”重试；已有任务仍保留显示。</span></div>}
    {loading && <p className="gantt-loading" role="status">正在加载任务日期，请稍候…</p>}

    <div className="gantt-scroll" role="region" aria-labelledby={`${id}-range`} aria-describedby={`${id}-hint`} tabIndex={0} aria-busy={loading} style={chartStyle}>
      <table className="gantt-table">
        <caption className="gantt-sr-only">任务起止日期甘特图，{rangeLabel}。每行一个任务，起止日均计入。点击任务名称或日期条查看详情。</caption>
        <colgroup><col className="gantt-task-col" />{days.map(({ date }) => <col className="gantt-date-col" key={date} />)}</colgroup>
        <thead><tr>
          <th scope="col" className="gantt-task-heading"><span>任务</span><small>起止日期<CopySeparator />状态与标签</small></th>
          {days.map(({ date, weekday, isToday }) => <th scope="col" key={date}
            className={`gantt-date-heading${weekday === 0 || weekday === 6 ? " is-weekend" : ""}${isToday ? " is-today" : ""}`}>
            <time dateTime={date} aria-label={`${dateLabel(date)}，星期${WEEKDAYS[weekday]}${isToday ? "，今天" : ""}`} aria-current={isToday ? "date" : undefined}>
              <span>{mode === "week" ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : Number(date.slice(8, 10))}</span>
              <small>{isToday ? "今天" : `周${WEEKDAYS[weekday]}`}</small>
            </time>
          </th>)}
        </tr></thead>
        <tbody>
          {rows.map(({ task, range, placement }) => {
            const title = taskTitle(task);
            const displayStatus = taskListStatus(task);
            const rangeCopy = `${dateLabel(range.start)}至${dateLabel(range.end)}`;
            const clippedCopy = `${placement.clippedStart ? "，开始早于当前视图" : ""}${placement.clippedEnd ? "，结束晚于当前视图" : ""}`;
            return <tr key={task.id} className={`gantt-row gantt-status-${displayStatus}`}>
              <th scope="row" className="gantt-task-cell">
                <button type="button" className="gantt-task-link" onClick={() => onOpenTask(task)} title={`${title} · ${rangeCopy}`} aria-label={`查看任务：${title}，${STATUS_LABEL[displayStatus]}，${rangeCopy}`}>
                  <span className="gantt-task-title">{title}</span>
                  <span className="gantt-task-meta"><span className="gantt-status-badge">{STATUS_LABEL[displayStatus]}</span>
                    {task.tags.filter((item) => item.trim()).slice(0, 2).map((item, index) => <span className="gantt-tag" key={`${item}-${index}`}>#{item}</span>)}
                    {task.tags.length > 2 && <span className="gantt-more-tags" title={task.tags.join("、")}>+{task.tags.length - 2}</span>}
                  </span>
                </button>
              </th>
              <td colSpan={days.length} className="gantt-timeline-cell">
                <div className="gantt-track">
                  {days.map(({ date, weekday, isToday }, index) => <span aria-hidden="true" key={date}
                    className={`gantt-day-cell${weekday === 0 || weekday === 6 ? " is-weekend" : ""}${isToday ? " is-today" : ""}`}
                    style={{ gridColumn: index + 1 }} />)}
                  <button type="button" className={`gantt-bar${placement.clippedStart ? " is-clipped-start" : ""}${placement.clippedEnd ? " is-clipped-end" : ""}`}
                    style={{ gridColumn: `${placement.startIndex + 1} / span ${placement.span}` }} onClick={() => onOpenTask(task)}
                    title={`${title} · ${STATUS_LABEL[displayStatus]} · ${rangeCopy}${clippedCopy}`}
                    aria-label={`查看任务：${title}，${STATUS_LABEL[displayStatus]}，${rangeCopy}${clippedCopy}`}>
                    {placement.clippedStart && <span aria-hidden="true" className="gantt-continuation">‹</span>}
                    <span className="gantt-bar-title">{title}</span>
                    {placement.clippedEnd && <span aria-hidden="true" className="gantt-continuation">›</span>}
                  </button>
                </div>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>

    {rows.length === 0 && !loading && <div className="gantt-empty" role="status">
      <strong>{error ? "暂时无法显示任务" : "当前范围暂无任务"}</strong>
      <p>{error ? "请刷新重试，或稍后再查看。" : matchingCount === 0 ? "没有符合筛选条件的任务；已删除的任务不在此显示。" : "没有日期完整且与当前范围重叠的任务。试试切换日期，或补全下方任务日期。"}</p>
      {filtered && <button type="button" className="gantt-control" onClick={resetFilters}>清除筛选</button>}
    </div>}

    <footer className="gantt-footer">
      <div className="gantt-legend" aria-label="图例">
        {(["open", "scheduled", "not_completed", "done"] as const).map((item) => <span key={item} className={`gantt-legend-item gantt-status-${item}`}><i aria-hidden="true" />{STATUS_LABEL[item]}</span>)}
        <span className="gantt-legend-today"><i aria-hidden="true" />今天</span>
        <span>‹ / › 跨越视图边界</span>
      </div>
      <p id={`${id}-hint`}>仅显示与当前范围重叠的任务，起止日均计入；可横向滚动，点击任务查看详情。{outsideCount > 0 && `另有 ${outsideCount} 个任务在当前范围之外。`}</p>
    </footer>

    {issues.length > 0 && <details className="gantt-date-issues">
      <summary>{issues.length} 个任务日期待完善，未显示日期条<span>展开后点击任务修正</span></summary>
      <p>以下任务符合当前筛选，但缺少有效的起止日期；不会使用每日执行排期代替。</p>
      <ul>{issues.map(({ task, reason }) => <li key={task.id}>
        <button type="button" onClick={() => onOpenTask(task)}><span>{taskTitle(task)}</span><small>{ISSUE_LABEL[reason]}<CopySeparator />点击查看</small></button>
      </li>)}</ul>
    </details>}
  </section>;
}
