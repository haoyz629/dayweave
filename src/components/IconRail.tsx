import type { AppModule } from "../types/dayweave";
import { tip } from "./TooltipHost";

interface IconRailProps {
  activeModule: AppModule;
  draftsOpen: boolean;
  totalTasksCount: number;
  draftsCount: number;
  trashCount: number;
  onSelectModule: (mod: AppModule) => void;
  onToggleDrafts: () => void;
}

export function IconRail({
  activeModule,
  draftsOpen,
  totalTasksCount,
  draftsCount,
  trashCount,
  onSelectModule,
  onToggleDrafts,
}: IconRailProps) {
  return (
    <aside className="dw-rail" aria-label="主功能导航">
      <div className="dw-rail-group">
        <button
          type="button"
          aria-label="日程"
          onClick={() => onSelectModule("workbench")}
          className={`dw-rail-btn${activeModule === "workbench" && !draftsOpen ? " is-active" : ""}`}
          {...tip("日程（日 / 月）", { side: "right" })}
        >
          {activeModule === "workbench" && !draftsOpen && <span className="dw-rail-pill" />}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </button>

        <button
          type="button"
          aria-label="全部任务管理"
          onClick={() => onSelectModule("tasks")}
          className={`dw-rail-btn${activeModule === "tasks" && !draftsOpen ? " is-active" : ""}`}
          {...tip("全部任务", { sub: `${totalTasksCount} 项`, side: "right" })}
        >
          {activeModule === "tasks" && !draftsOpen && <span className="dw-rail-pill" />}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="12" r="9" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 12.2l2.3 2.3 4.7-4.8" />
          </svg>
        </button>

        <button
          type="button"
          aria-label="草稿箱"
          onClick={onToggleDrafts}
          className={`dw-rail-btn${draftsOpen ? " is-active" : ""}`}
          {...tip("草稿箱", { sub: draftsCount > 0 ? `${draftsCount} 条未提交` : undefined, side: "right" })}
        >
          {draftsOpen && <span className="dw-rail-pill is-amber" />}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
            />
          </svg>
          {draftsCount > 0 && <span className="dw-rail-count tabular-nums" aria-hidden="true">{draftsCount}</span>}
        </button>

        <div className="dw-rail-divider" aria-hidden="true" />

        <button
          type="button"
          aria-label="重复规则"
          onClick={() => onSelectModule("recurring")}
          className={`dw-rail-btn${activeModule === "recurring" && !draftsOpen ? " is-active" : ""}`}
          {...tip("重复规则", { side: "right" })}
        >
          {activeModule === "recurring" && !draftsOpen && <span className="dw-rail-pill" />}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"
            />
          </svg>
        </button>

        <button
          type="button"
          aria-label="回收站"
          onClick={() => onSelectModule("trash")}
          className={`dw-rail-btn${activeModule === "trash" && !draftsOpen ? " is-active" : ""}`}
          {...tip("回收站", { sub: trashCount > 0 ? `${trashCount} 项` : undefined, side: "right" })}
        >
          {activeModule === "trash" && !draftsOpen && <span className="dw-rail-pill" />}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"
            />
          </svg>
          {trashCount > 0 && <span className="dw-rail-count is-slate tabular-nums" aria-hidden="true">{trashCount}</span>}
        </button>
      </div>

      {/* Bottom: Preferences & Tag Manager */}
      <div className="dw-rail-group">
        <button
          type="button"
          aria-label="设置"
          onClick={() => onSelectModule("settings")}
          className={`dw-rail-btn${activeModule === "settings" && !draftsOpen ? " is-active" : ""}`}
          {...tip("设置", { side: "right" })}
        >
          {activeModule === "settings" && !draftsOpen && <span className="dw-rail-pill" />}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="12" r="3" />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
            />
          </svg>
        </button>
      </div>
    </aside>
  );
}
