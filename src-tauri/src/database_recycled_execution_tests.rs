use super::*;

const RECYCLED_DAY: &str = "2026-10-21";
const RECYCLED_PAST: &str = "2026-10-20";

fn recycled_task(db: &mut Database, title: &str) -> String {
    let id = db.create_manual_task(title).unwrap();
    db.connection.execute(
        "UPDATE tasks SET status = 'deleted', deleted_at = ?2, deleted_from_status = 'scheduled',
            total_workload_minutes = 120, remaining_workload_minutes = 75, updated_at = ?3
         WHERE id = ?1",
        params![id, now(), now()],
    ).unwrap();
    id
}

fn confirmed_plan(db: &Database, date: &str) -> String {
    db.connection.query_row("SELECT id FROM daily_plans WHERE plan_date = ?1 AND status = 'confirmed'", [date], |row| row.get(0))
        .optional().unwrap().unwrap_or_else(|| {
            let id = Uuid::new_v4().to_string();
            db.connection.execute("INSERT INTO daily_plans(id,plan_date,status,source,created_at,confirmed_at)
                VALUES (?1,?2,'confirmed','manual',?3,?3)", params![id, date, now()]).unwrap();
            id
        })
}

fn draft_plan(db: &Database, date: &str) -> String {
    let id = Uuid::new_v4().to_string();
    db.connection.execute("INSERT INTO daily_plans(id,plan_date,status,source,created_at,confirmed_at)
        VALUES (?1,?2,'draft','manual',?3,NULL)", params![id, date, now()]).unwrap();
    id
}

fn recycled_block(db: &Database, plan: &str, task: &str, date: &str, hour: &str) -> String {
    let id = Uuid::new_v4().to_string();
    db.connection.execute("INSERT INTO plan_blocks(id,daily_plan_id,task_id,starts_at,ends_at,source,created_at,updated_at)
        VALUES (?1,?2,?3,?4,?5,'manual',?6,?6)",
        params![id, plan, task, format!("{date}T{hour}:00:00+08:00"), format!("{date}T{hour}:30:00+08:00"), now()]).unwrap();
    id
}

fn capture(block: &str) -> ExecutionCaptureInput {
    ExecutionCaptureInput { plan_block_id: block.into(), outcome: ReviewOutcome::Completed, note: Some("完成备注".into()) }
}

fn task_row(db: &Database, task: &str) -> Vec<Vec<String>> {
    fact_rows(&db.connection, "SELECT * FROM tasks WHERE id = ?1", task).unwrap()
}

fn block_row(db: &Database, block: &str) -> Vec<Vec<String>> {
    fact_rows(&db.connection, "SELECT * FROM plan_blocks WHERE id = ?1", block).unwrap()
}
fn block_status(db: &Database, block: &str) -> String {
    db.connection.query_row("SELECT execution_status FROM plan_blocks WHERE id = ?1", [block], |row| row.get(0)).unwrap()
}
fn block_note(db: &Database, block: &str) -> Option<String> {
    db.connection.query_row("SELECT execution_note FROM plan_blocks WHERE id = ?1", [block], |row| row.get(0)).unwrap()
}
fn task_col(db: &Database, task: &str, column: &str) -> String {
    db.connection.query_row(&format!("SELECT {column} FROM tasks WHERE id = ?1"), [task], |row| row.get::<_, String>(0)).unwrap()
}
fn task_remaining(db: &Database, task: &str) -> Option<i64> {
    db.connection.query_row("SELECT remaining_workload_minutes FROM tasks WHERE id = ?1", [task], |row| row.get(0)).unwrap()
}

fn other_block(db: &Database, task: &str, date: &str, hour: &str) -> String {
    recycled_block(db, &confirmed_plan(db, date), task, date, hour)
}

#[test]
fn recycled_blocks_complete_and_whole_task_completes_only_when_every_block_is_done() {
    let _clock = TestNow::new("2026-10-21T18:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let task = recycled_task(&mut db, "回收站完成");
    let plan = confirmed_plan(&db, RECYCLED_DAY);
    let block = recycled_block(&db, &plan, &task, RECYCLED_DAY, "09");
    let other = other_block(&db, &task, RECYCLED_PAST, "10");

    let task_before = task_row(&db, &task);
    let other_before = block_row(&db, &other);
    db.save_execution_capture(RECYCLED_DAY, capture(&block)).unwrap();

    assert_eq!(block_status(&db, &block), "completed");
    assert_eq!(block_note(&db, &block).as_deref(), Some("完成备注"));
    assert_eq!(task_row(&db, &task), task_before, "单块完成不能改变任务行");
    assert_eq!(block_row(&db, &other), other_before, "其他任务块保持不变");

    let past_clock = TestNow::new("2026-10-22T18:00:00+08:00");
    db.save_execution_capture(RECYCLED_PAST, capture(&other)).unwrap();
    drop(past_clock);
    assert_eq!(block_status(&db, &other), "completed");
    assert_eq!(task_col(&db, &task, "status"), "deleted", "任务仍保留在回收站");
    assert!(db.connection.query_row::<Option<String>, _, _>("SELECT deleted_at FROM tasks WHERE id = ?1", [&task], |row| row.get(0)).unwrap().is_some());
    assert_eq!(task_col(&db, &task, "deleted_from_status"), "done", "全部块完成后恢复目标应为已完成");
    assert_eq!(task_remaining(&db, &task), Some(0), "全部块完成后剩余工作量应为 0");
    let history = db.get_task_metadata(&task).unwrap().history;
    assert!(history.iter().any(|event| event.kind == "automatic_status" && event.status.as_deref() == Some("done")), "全部块完成后应追加整体完成执行记录");
}

#[test]
fn recycled_completion_rejects_future_date_mismatch_unconfirmed_and_ownership() {
    let _clock = TestNow::new("2026-10-21T18:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let task = recycled_task(&mut db, "回收站拒绝");
    let other_task = recycled_task(&mut db, "另一个回收站任务");
    let plan = confirmed_plan(&db, RECYCLED_DAY);
    let draft = draft_plan(&db, RECYCLED_DAY);
    let block = recycled_block(&db, &plan, &task, RECYCLED_DAY, "09");
    let draft_block = recycled_block(&db, &draft, &task, RECYCLED_DAY, "10");
    let owned_by_other = recycled_block(&db, &plan, &other_task, RECYCLED_DAY, "11");

    let future = TestNow::new("2026-10-20T18:00:00+08:00");
    let err = db.save_execution_capture(RECYCLED_DAY, capture(&block)).unwrap_err();
    assert!(err.to_string().contains("未来日期不能记录执行结果"));
    drop(future);

    let err = db.save_execution_capture(RECYCLED_PAST, capture(&block)).unwrap_err();
    assert!(err.to_string().contains("执行日期必须与执行块所属日期一致"));

    let err = db.save_execution_capture(RECYCLED_DAY, capture(&draft_block)).unwrap_err();
    assert!(err.to_string().contains("只能记录该任务原日期的已确认安排"));

    // save_execution_capture resolves the owning task from the block, so a block
    // belonging to another task completes that task's reservation instead of erroring.
    db.save_execution_capture(RECYCLED_DAY, capture(&owned_by_other)).unwrap();
    assert_eq!(block_status(&db, &owned_by_other), "completed");
}

#[test]
fn recycled_completion_rejects_any_outcome_but_completed() {
    let _clock = TestNow::new("2026-10-21T18:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let task = recycled_task(&mut db, "回收站只允许完成");
    let block = recycled_block(&db, &confirmed_plan(&db, RECYCLED_DAY), &task, RECYCLED_DAY, "09");
    for outcome in [ReviewOutcome::Partial, ReviewOutcome::NotStarted, ReviewOutcome::Cancelled, ReviewOutcome::Blocked] {
        let mut input = capture(&block);
        input.outcome = outcome;
        let err = db.save_execution_capture(RECYCLED_DAY, input).unwrap_err();
        assert!(err.to_string().contains("回收站任务只能记录已有安排的完成结果"), "{:?}", outcome);
    }
}

#[test]
fn identical_retry_is_idempotent_and_does_not_grow_history_or_move_timestamp() {
    let _clock = TestNow::new("2026-10-21T18:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let task = recycled_task(&mut db, "回收站幂等");
    let block = recycled_block(&db, &confirmed_plan(&db, RECYCLED_DAY), &task, RECYCLED_DAY, "09");

    db.save_execution_capture(RECYCLED_DAY, capture(&block)).unwrap();
    let first = block_row(&db, &block);
    let history_before: i64 = db.connection.query_row("SELECT COUNT(*) FROM task_changes WHERE task_id = ?1", [&task], |row| row.get(0)).unwrap();

    db.save_execution_capture(RECYCLED_DAY, capture(&block)).unwrap();
    assert_eq!(block_row(&db, &block), first, "相同重试不能改变已保存事实或时间戳");
    let history_after: i64 = db.connection.query_row("SELECT COUNT(*) FROM task_changes WHERE task_id = ?1", [&task], |row| row.get(0)).unwrap();
    assert_eq!(history_after, history_before, "相同重试不能追加执行记录");
}

#[test]
fn completing_creates_durable_history_and_promotes_restore_target_without_following_up() {
    let _clock = TestNow::new("2026-10-21T18:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let task = recycled_task(&mut db, "回收站历史");
    let block = recycled_block(&db, &confirmed_plan(&db, RECYCLED_DAY), &task, RECYCLED_DAY, "09");

    db.save_execution_capture(RECYCLED_DAY, capture(&block)).unwrap();

    let snapshots: Vec<String> = {
        let mut stmt = db.connection.prepare("SELECT new_value FROM task_changes WHERE task_id = ?1 AND change_kind = 'history_snapshot' ORDER BY rowid").unwrap();
        stmt.query_map([&task], |row| row.get::<_, Option<String>>(0)).unwrap().filter_map(|value| value.unwrap()).collect::<Vec<_>>()
    };
    assert!(snapshots.iter().any(|json| json.contains("\"kind\":\"execution\"")), "执行记录应持久化为 history_snapshot 事件");

    let updated = db.get_task(&task).unwrap();
    assert_eq!(updated.status, "deleted");
    assert!(updated.deleted_at.is_some());
    assert_eq!(task_col(&db, &task, "deleted_from_status"), "done", "单块任务完成后恢复目标应为已完成");
    assert!(db.get_task_metadata(&task).unwrap().history.iter().any(|event| event.kind == "automatic_status" && event.status.as_deref() == Some("done")), "单块任务完成后也应追加整体完成执行记录");
    let resolution = TaskExecutionResolutionInput {
        plan_block_id: block.clone(),
        expected_task_updated_at: updated.updated_at.clone(),
        outcome: ReviewOutcome::Completed,
        note: Some("完成备注".into()),
        next_action: Some("schedule".into()),
        starts_at: Some(format!("{RECYCLED_DAY}T11:00:00+08:00")),
        ends_at: Some(format!("{RECYCLED_DAY}T11:30:00+08:00")),
        remaining_workload_minutes: None,
    };
    let err = db.resolve_task_execution(RECYCLED_DAY, resolution).unwrap_err();
    assert!(err.to_string().contains("不能附带下一步安排") || err.to_string().contains("只能记录已有安排的完成结果"));
}

#[test]
fn clear_execution_capture_is_still_forbidden_for_recycled_tasks() {
    let _clock = TestNow::new("2026-10-21T18:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let task = recycled_task(&mut db, "回收站不可取消");
    let block = recycled_block(&db, &confirmed_plan(&db, RECYCLED_DAY), &task, RECYCLED_DAY, "09");
    db.save_execution_capture(RECYCLED_DAY, capture(&block)).unwrap();
    let err = db.clear_execution_capture(RECYCLED_DAY, &block).unwrap_err();
    assert!(err.to_string().contains("回收站任务不能取消结果"));
}
