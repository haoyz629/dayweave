use super::*;

const TODAY: &str = "2026-10-16";

fn task(db: &mut Database) -> (String, String) {
    let draft = db.create_manual_task_draft(TaskDraftInput {
        item_type: "task".into(), recurring_settings: None, title: "状态恢复测试".into(), notes: None, priority: None,
        earliest_start_date: Some(TODAY.into()), earliest_start_time: Some("09:00".into()),
        due_date: Some(TODAY.into()), due_time: Some("10:00".into()), total_workload_minutes: Some(60),
        remaining_workload_minutes: Some(60), field_states_json: "{}".into(), tags: vec![], recurrence: None,
    }).unwrap();
    let saved = db.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
    let block = db.get_day_schedule(TODAY).unwrap().task_blocks.into_iter().find(|block| block.task_id == saved.id).unwrap();
    (saved.id, block.id)
}

fn child(db: &mut Database, id: &str) -> TaskDto {
    let draft = match db.prepare_task_followup(id).unwrap() { FollowupPreparation::Draft { draft } => draft, _ => panic!("expected draft") };
    db.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap()
}

fn assert_status_lock(db: &Database, id: &str, expected: bool) {
    assert_eq!(db.get_task(id).unwrap().status_locked, expected);
    assert_eq!(db.list_tasks(true, None).unwrap().iter().find(|task| task.id == id).unwrap().status_locked, expected);
    let transaction = db.connection.unchecked_transaction().unwrap();
    assert_eq!(load_task_dto_in_transaction(&transaction, id).unwrap().status_locked, expected);
    transaction.rollback().unwrap();
}

#[test]
fn completion_reopens_after_undo_expiry_restoring_workload_and_only_its_capture() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let (id, block) = task(&mut db);
    let before = execution_snapshot(&db.connection, &block).unwrap();
    db.complete_task_with_note(&id, Some(&block), Some("完成备注".into())).unwrap();
    assert!(db.get_task(&id).unwrap().execution_locked);
    assert_status_lock(&db, &id, false);
    db.connection.execute("UPDATE undo_entries SET expires_at = '2000-01-01T00:00:00Z'", []).unwrap();
    let reopened = db.reopen_manual_task(&id, TODAY).unwrap();
    assert_eq!(reopened.status, "scheduled");
    assert_eq!(reopened.remaining_workload_minutes, Some(60));
    assert!(!reopened.execution_locked);
    assert_eq!(serde_json::to_value(execution_snapshot(&db.connection, &block).unwrap()).unwrap(), serde_json::to_value(before).unwrap());
    assert!(db.reopen_manual_task(&id, TODAY).is_err());
    db.complete_task(&id, None).unwrap();
    let reopened = db.transition_manual_task(&id, TaskStatus::Open).unwrap();
    assert_eq!(reopened.remaining_workload_minutes, Some(60));
    assert_eq!(reopened.status, "scheduled");
}

#[test]
fn any_non_deleted_child_locks_source_status_until_child_is_deleted() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let (id, block) = task(&mut db);
    let resolution = |db: &Database| TaskExecutionResolutionInput {
        plan_block_id: block.clone(), expected_task_updated_at: db.get_task(&id).unwrap().updated_at,
        outcome: ReviewOutcome::NotStarted, note: Some("未完成原因".into()), next_action: None,
        starts_at: None, ends_at: None, remaining_workload_minutes: None,
    };
    db.resolve_task_execution(TODAY, resolution(&db)).unwrap();
    assert!(db.get_task(&id).unwrap().execution_locked);
    assert_status_lock(&db, &id, false);
    let draft = match db.prepare_task_followup(&id).unwrap() { FollowupPreparation::Draft { draft } => draft, _ => panic!() };
    assert_status_lock(&db, &id, false);
    db.complete_task(&id, None).unwrap();
    db.reopen_manual_task(&id, TODAY).unwrap();
    assert_eq!(execution_snapshot(&db.connection, &block).unwrap().execution_status, "not_started");
    let child = db.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
    assert_status_lock(&db, &id, true);
    let facts = fact_fingerprint(&db.connection, "task_completion", &id).unwrap();
    assert!(db.complete_task(&id, None).is_err());
    assert!(db.resolve_task_execution(TODAY, resolution(&db)).is_err());
    assert_eq!(facts, fact_fingerprint(&db.connection, "task_completion", &id).unwrap());
    db.complete_task(&child.id, None).unwrap();
    assert_status_lock(&db, &id, true);
    assert!(db.complete_task(&id, None).is_err());
    assert!(db.reopen_manual_task(&id, TODAY).is_err());
    db.soft_delete_manual_task(&child.id, true).unwrap();
    assert_status_lock(&db, &id, false);
    db.complete_task(&id, None).unwrap();
    db.restore_task(&child.id).unwrap();
    assert_status_lock(&db, &id, true);
    assert!(db.reopen_manual_task(&id, TODAY).is_err());
    db.soft_delete_manual_task(&child.id, true).unwrap();
    db.permanently_delete_task(&child.id, true).unwrap();
    assert_status_lock(&db, &id, false);
    assert_eq!(db.reopen_manual_task(&id, TODAY).unwrap().remaining_workload_minutes, Some(60));
}

#[test]
fn reopen_preserves_later_review_and_capture_corrections() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let (id, block) = task(&mut db);
    db.complete_task(&id, None).unwrap();
    db.connection.execute("UPDATE plan_blocks SET execution_note = '后来补充的记录' WHERE id = ?1", [&block]).unwrap();
    let facts = fact_rows(&db.connection, "SELECT * FROM plan_blocks WHERE id = ?1", &block).unwrap();
    db.reopen_manual_task(&id, TODAY).unwrap();
    assert_eq!(facts, fact_rows(&db.connection, "SELECT * FROM plan_blocks WHERE id = ?1", &block).unwrap());
}

#[test]
fn legacy_completion_payload_is_used_without_new_snapshot_or_active_undo() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let (id, block) = task(&mut db);
    db.complete_task(&id, None).unwrap();
    db.connection.execute("DELETE FROM task_completion_snapshots", []).unwrap();
    db.connection.execute("UPDATE undo_entries SET status = 'expired'", []).unwrap();
    let reopened = db.reopen_manual_task(&id, TODAY).unwrap();
    assert_eq!(reopened.remaining_workload_minutes, Some(60));
    assert_eq!(execution_snapshot(&db.connection, &block).unwrap().execution_status, "planned");
}

#[test]
fn creating_child_blocks_old_completion_undo_and_pending_draft_does_not() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let (id, _) = task(&mut db);
    let draft = match db.prepare_task_followup(&id).unwrap() { FollowupPreparation::Draft { draft } => draft, _ => panic!() };
    db.complete_task(&id, None).unwrap();
    let undo = db.latest_undo().unwrap().unwrap();
    let descendant = db.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
    assert!(db.apply_undo(&undo.id).is_err());
    db.soft_delete_manual_task(&descendant.id, true).unwrap();
    db.apply_undo(&undo.id).unwrap();
    assert_eq!(db.get_task(&id).unwrap().remaining_workload_minutes, Some(60));
    assert_status_lock(&db, &id, false);
    let second = child(&mut db, &id);
    assert_status_lock(&db, &id, true);
    db.soft_delete_manual_task(&second.id, true).unwrap();
    assert_status_lock(&db, &id, false);
}

#[test]
fn tag_colors_and_completion_restore_survive_database_reopen() {
    let _clock = TestToday::new(TODAY);
    let directory = std::env::var_os("PI_SCRATCH_DIR").map(std::path::PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let path = directory.join(format!("dayweave-tags-state-{}.sqlite", Uuid::new_v4()));
    let (id, block, color) = {
        let mut db = Database::open(&path).unwrap();
        let (id, block) = task(&mut db);
        let tag = db.create_tag("开发任务").unwrap();
        db.set_task_tags(&id, vec![tag.name]).unwrap();
        db.complete_task(&id, None).unwrap();
        (id, block, tag.color)
    };
    {
        let mut db = Database::open(&path).unwrap();
        assert_eq!(db.create_tag("开发任务").unwrap().color, color);
        assert_eq!(db.list_tag_catalog().unwrap().len(), 1);
        let reopened = db.reopen_manual_task(&id, TODAY).unwrap();
        assert_eq!(reopened.remaining_workload_minutes, Some(60));
        assert_eq!(reopened.tags, vec!["开发任务".to_string()]);
        assert_eq!(execution_snapshot(&db.connection, &block).unwrap().execution_status, "planned");
    }
    std::fs::remove_file(path).unwrap();
}

#[test]
fn legacy_done_task_without_completion_payload_keeps_known_remaining_workload() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let id = db.create_manual_task("旧版完成任务").unwrap();
    db.connection.execute("UPDATE tasks SET status = 'done', total_workload_minutes = 180,
        estimated_minutes = 180, remaining_workload_minutes = 45 WHERE id = ?1", [&id]).unwrap();
    assert_eq!(db.reopen_manual_task(&id, TODAY).unwrap().remaining_workload_minutes, Some(45));
}
