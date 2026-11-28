import { useMemo, useState } from "react";
import { TAG_COLOR_HEX } from "../types/dayweave";
import type { Priority, Tag, Task } from "../types/dayweave";
import { fmtDuration, fmtMinutes, formatDateShortCn } from "../utils/dateUtils";
import { FluentSelect } from "./FluentSelect";
import { tip } from "./TooltipHost";

interface AllTasksViewProps {
  tasks: Task[];
  tags: Tag[];
  todayDate: string;
  selectedDate: string;
  selectedTaskId: string | null;
  onOpenCreateModal: () => void;
  onOpenInspector: (taskId: string) => void;
  onToggleTaskDone: (task: Task) => void;
  onQuickWeaveTask: (task: Task) => void;
}

type StatusTab = "all" | "active" | "pool" | "overdue" | "done";

const MODE_LABELS = {
  timeline: "已安排",
  flex: "全天 / 多日",
  pool: "待安排",
} as const;

export function AllTasksView({
  tasks,
  tags,
  todayDate,
  selectedDate,
  selectedTaskId,
  onOpenCreateModal,
  onOpenInspector,
  onToggleTaskDone,
  onQuickWeaveTask,
}: AllTasksViewProps) {
  const [tab, setTab] = useState<StatusTab>("all");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const [prioFilter, setPrioFilter] = useState<"all" | Priority>("all");

  const tagMap = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const counts = useMemo(() => {
    const active = tasks.filter((t) => !t.done).length;
    const pool = tasks.filter((t) => t.mode === "pool" && !t.done).length;
    const done = tasks.filter((t) => t.done).length;
    const overdue = tasks.filter((t) => {
      if (t.done) return false;
      if (t.mode === "timeline") return t.date < todayDate;
      if (t.mode === "flex") return t.dateEnd < todayDate;
      return false;
    }).length;
    return { all: tasks.length, active, pool, overdue, done };
  }, [tasks, todayDate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (tab === "active" && t.done) return false;
      if (tab === "pool" && (t.mode !== "pool" || t.done)) return false;
      if (tab === "done" && !t.done) return false;
      if (tab === "overdue") {
        if (t.done) return false;
        const isOverdue =
          (t.mode === "timeline" && t.date < todayDate) || (t.mode === "flex" && t.dateEnd < todayDate);
        if (!isOverdue) return false;
      }
      if (tagFilter !== "all" && t.tagId !== tagFilter) return false;
      if (prioFilter !== "all" && t.priority !== prioFilter) return false;
      if (q && !(t.title.toLowerCase().includes(q) || t.note.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [tasks, tab, search, tagFilter, prioFilter, todayDate]);

  return (
    <main className="dw-module" aria-label="全部任务管理">
      <div className="dw-module-header">
        <div>
          <h2 className="dw-module-title">全部任务</h2>
          <p className="dw-module-desc">按状态、标签和优先级管理全部任务</p>
        </div>
        <button type="button" className="dw-btn-primary" onClick={onOpenCreateModal}>
          + 新建任务
        </button>
      </div>

      <div className="dw-module-toolbar">
        <div className="dw-module-toolbar-inner">
          <div className="dw-tab-group" role="tablist">
            {(
              [
                ["all", "全部", counts.all],
                ["active", "进行中", counts.active],
                ["pool", "待安排", counts.pool],
                ["overdue", "逾期", counts.overdue],
                ["done", "已完成", counts.done],
              ] as [StatusTab, string, number][]
            ).map(([k, label, count]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`dw-tab-btn${tab === k ? " is-active" : ""}`}
              >
                <span>{label}</span>
                <span className="dw-tab-count tabular-nums">{count}</span>
              </button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div className="dw-search-wrap">
              <input
                type="text"
                className="dw-input"
                style={{ width: 200, height: 28, padding: search ? "0 26px 0 10px" : "0 10px", fontSize: 12 }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索任务标题或备注"
              />
              {search && (
                <button
                  type="button"
                  className="dw-search-clear"
                  aria-label="清空搜索"
                  onClick={() => setSearch("")}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              )}
            </div>
            <FluentSelect
              compact
              ariaLabel="按标签筛选"
              style={{ width: 128 }}
              value={tagFilter}
              onChange={setTagFilter}
              options={[
                { value: "all", label: "全部标签" },
                ...tags.map((tg) => ({
                  value: tg.id,
                  label: tg.name,
                  dotColor: TAG_COLOR_HEX[tg.color] ?? TAG_COLOR_HEX.blue,
                })),
              ]}
            />

            <FluentSelect<"all" | Priority>
              compact
              ariaLabel="按优先级筛选"
              style={{ width: 120 }}
              value={prioFilter}
              onChange={setPrioFilter}
              options={[
                { value: "all", label: "全部优先级" },
                { value: "P1", label: "仅 P1 紧急", dotColor: "#DC4C64" },
                { value: "P2", label: "仅 P2 重要", dotColor: "#D97706" },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="dw-module-body win-scroll">
        {filtered.length === 0 ? (
          <div className="dw-empty-state" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <span>没有符合条件的任务</span>
            {(tab !== "all" || search || tagFilter !== "all" || prioFilter !== "all") && (
              <button
                type="button"
                className="dw-btn-ghost"
                style={{ height: 28, padding: "0 12px" }}
                onClick={() => {
                  setTab("all");
                  setSearch("");
                  setTagFilter("all");
                  setPrioFilter("all");
                }}
              >
                重置筛选
              </button>
            )}
          </div>
        ) : (
          <div className="dw-list-stack">
            {filtered.map((t) => {
              const tg = tagMap.get(t.tagId);
              const isOverdue =
                !t.done &&
                ((t.mode === "timeline" && t.date < todayDate) ||
                  (t.mode === "flex" && t.dateEnd < todayDate));
              return (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenInspector(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenInspector(t.id);
                    }
                  }}
                  className={`dw-task-row${selectedTaskId === t.id ? " is-selected" : ""}`}
                >
                  <div className="dw-task-row-left">
                    <input
                      type="checkbox"
                      className="dw-checkbox"
                      checked={t.done}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => onToggleTaskDone(t)}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div className={`dw-task-row-title${t.done ? " is-done" : ""}`}>{t.title}</div>
                      <div className="dw-task-row-meta">
                        {tg && (
                          <span className="dw-pool-tag-inline">
                            <span
                              className="dw-section-dot"
                              style={{ background: TAG_COLOR_HEX[tg.color] ?? TAG_COLOR_HEX.blue }}
                            />
                            {tg.name}
                          </span>
                        )}
                        <span className="dw-badge-subtle">{MODE_LABELS[t.mode]}</span>
                        {isOverdue && <span className="dw-badge-overdue">逾期</span>}
                        {t.mode === "timeline" ? (
                          <span
                            className="font-mono tabular-nums"
                            style={isOverdue ? { color: "var(--w-rose-text)", fontWeight: 500 } : undefined}
                          >
                            {formatDateShortCn(t.date)} {fmtMinutes(t.startMin)} · {fmtDuration(t.duration)}
                          </span>
                        ) : t.mode === "flex" ? (
                          <span
                            className="font-mono tabular-nums"
                            style={isOverdue ? { color: "var(--w-rose-text)", fontWeight: 500 } : undefined}
                          >
                            {formatDateShortCn(t.dateStart)}
                            {t.dateEnd > t.dateStart ? ` – ${formatDateShortCn(t.dateEnd)}` : ""}
                          </span>
                        ) : (
                          <span className="font-mono tabular-nums">预计 {fmtDuration(t.duration)}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {t.priority === "P1" && <span className="dw-badge-p1">P1</span>}
                    {t.priority === "P2" && <span className="dw-badge-p2">P2</span>}
                    {t.mode === "pool" && !t.done && (
                      <button
                        type="button"
                        className="dw-weave-btn"
                        style={{ height: 28, padding: "0 10px" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onQuickWeaveTask(t);
                        }}
                        {...tip(`排入 ${formatDateShortCn(selectedDate)} 空闲时段`, { side: "left" })}
                      >
                        排入 {formatDateShortCn(selectedDate)}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
