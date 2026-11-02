import type { TaskMetadata } from "./tauri";
import { CopySeparator } from "./copy-separator";

export function TaskExecutionRecord({ metadata, disabled, onNewTask }: {
  metadata: TaskMetadata | null; disabled: boolean; onNewTask: () => void;
}) {
  const fact = metadata?.latest_execution;
  if (!fact) return null;
  return <section className="task-result-record" aria-label="执行记录">
    <details className="task-execution-record"><summary>{fact.plan_date} 的执行记录<CopySeparator />{fact.outcome === "completed" ? "完成" : "未完成"}</summary><p>{fact.note || "本次未填写备注。"}</p></details>
    {fact.outcome !== "completed" && <button type="button" className="secondary-action" disabled={disabled} onClick={onNewTask}>新建任务</button>}
  </section>;
}
