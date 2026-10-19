import type { PlanBlock, Task, TaskExecutionResolutionInput } from "./tauri";

export type ExecutionResult = "completed" | "not_completed";
export type ExecutionOutcome = "completed" | "not_started";

// Old finalized records remain readable; new submissions do not use these actions.
export const taskNextActionLabels = {
  schedule: "继续安排", wait: "暂不安排", stop: "不再做"
};

export function executionResultForOutcome(outcome: string | null): ExecutionResult | null {
  return outcome === null ? null : outcome === "completed" ? "completed" : "not_completed";
}

export function taskExecutionResolution(
  block: PlanBlock, task: Task | undefined, outcome: ExecutionOutcome, note: string
): TaskExecutionResolutionInput {
  if (!task || task.id !== block.task_id || !["open", "scheduled"].includes(task.status)) {
    throw new Error("任务已变化，请重新打开后再试。");
  }
  return {
    plan_block_id: block.id, expected_task_updated_at: task.updated_at, outcome, note: note.trim() || null,
    next_action: null, starts_at: null, ends_at: null, remaining_workload_minutes: null
  };
}

// Ended tasks retain their facts, but unexecuted current/future blocks are no longer work to do.
export function visibleTaskScheduleBlocks(blocks: PlanBlock[], date: string, today: string) {
  return blocks.filter((block) => !(date >= today && block.task_status === "done" && block.execution_status === "planned" && !block.review));
}
