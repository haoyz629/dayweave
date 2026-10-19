import type { Task, TaskMetadata, TaskOrigin } from "./tauri";
import { canCreateTaskFollowup, followupActionLabel } from "./task-followup";

const statusLabel: Record<Task["status"], string> = { open: "待处理", scheduled: "已安排", done: "已完成", deleted: "回收站" };

export function TaskOriginBanner({ origin, disabled, onOpenTask }: {
  origin: TaskOrigin; disabled: boolean; onOpenTask: (taskId: string) => void;
}) {
  return <section className="task-origin" aria-label="来源任务">
    <div className="task-origin-heading"><span className="task-relation-symbol" aria-hidden="true">↳</span>
      {origin.source_task_id ? <button type="button" disabled={disabled} onClick={() => onOpenTask(origin.source_task_id!)}>来源任务：{origin.source_title}<span aria-hidden="true"> →</span></button> : <strong>来源任务：{origin.source_title}</strong>}
    </div>
    <small>{origin.source_task_id ? `${origin.source_status ? statusLabel[origin.source_status] : "来源任务"} · 关联不受安排日期影响` : "来源任务已永久删除，来源信息仍保留"}</small>
  </section>;
}

export function TaskRelations({ task, metadata, disabled, onOpenTask, onCreateFollowup }: {
  task: Task; metadata: TaskMetadata | null; disabled: boolean;
  onOpenTask: (taskId: string) => void; onCreateFollowup: () => void;
}) {
  const children = metadata?.followups ?? [];
  const existing = children.find((item) => item.status !== "deleted");
  const fact = metadata?.latest_execution;
  const unfinished = canCreateTaskFollowup(task);
  if (!unfinished && !fact && !children.length) return null;
  return <section className="task-relations" aria-label="任务关联与执行记录">
    {fact && <details className="task-execution-record"><summary>{fact.plan_date} 的执行记录 · {fact.outcome === "completed" ? "完成" : "未完成"}</summary><p>{fact.note || "本次未填写备注。"}</p></details>}
    {children.length > 0 && <div className="task-followup-list"><h3>后续任务</h3>{children.map((child) => <button type="button" key={child.task_id} disabled={disabled} className="task-followup-link" onClick={() => onOpenTask(child.task_id)}>
      <strong>{child.title}</strong><span>{child.starts_at ? `${child.starts_at.slice(0, 10)} · ` : ""}{statusLabel[child.status]}<i aria-hidden="true"> →</i></span>
    </button>)}<small>来源关系独立保存，任务分别记录结果。</small></div>}
    {unfinished && <div className="task-followup-entry"><p>原任务和记录保持不变；后续任务备注默认留空。</p><button type="button" disabled={disabled || !metadata} onClick={existing ? () => onOpenTask(existing.task_id) : onCreateFollowup}>{followupActionLabel(children)}<span aria-hidden="true"> →</span></button></div>}
  </section>;
}
