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


#[test]
fn completion_reopens_after_undo_expiry_restoring_workload_and_only_its_capture() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let (id, block) = task(&mut db);
    let before = execution_snapshot(&db.connection, &block).unwrap();
    db.complete_task_with_note(&id, Some(&block), Some("完成备注".into())).unwrap();
    assert!(db.get_task(&id).unwrap().execution_locked);
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
fn old_multiple_relationships_never_lock_status_even_after_children_complete_or_restore() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let (id, _) = task(&mut db);
    let mut children = Vec::new();
    for status in ["open", "scheduled", "done"] {
        let child = db.create_manual_task("历史关联任务").unwrap();
        db.connection.execute("UPDATE tasks SET status = ?2 WHERE id = ?1", params![child, status]).unwrap();
        db.connection.execute("INSERT INTO task_origins VALUES (?1,?2,'source',?3)", params![child,id,now()]).unwrap();
        children.push(child);
    }
    db.complete_task(&id, None).unwrap();
    let undo = db.latest_undo().unwrap().unwrap();
    db.apply_undo(&undo.id).unwrap();
    db.complete_task(&id, None).unwrap();
    assert_eq!(db.reopen_manual_task(&id, TODAY).unwrap().remaining_workload_minutes, Some(60));
    for child in children {
        db.soft_delete_manual_task(&child, true).unwrap();
        db.restore_task(&child).unwrap();
    }
    db.complete_task(&id, None).unwrap();
    db.reopen_manual_task(&id, TODAY).unwrap();
    let dto = serde_json::to_value(db.get_task(&id).unwrap()).unwrap();
    assert!(dto.get("status_locked").is_none());
}

#[test]
fn single_day_reopen_resets_current_result_and_archives_later_corrections() {
    let _clock = TestToday::new(TODAY);
    for outcome in ["completed", "not_started", "partial", "blocked", "cancelled"] {
        let mut db = Database::in_memory().unwrap();
        let (id, block) = task(&mut db);
        db.complete_task(&id, None).unwrap();
        db.connection.execute("UPDATE plan_blocks SET execution_status = ?2, execution_note = '后来补充的记录' WHERE id = ?1",
            params![block, outcome]).unwrap();
        let reopened = db.reopen_manual_task(&id, TODAY).unwrap();
        assert!(!reopened.is_incomplete);
        let saved = execution_snapshot(&db.connection, &block).unwrap();
        assert_eq!(saved.execution_status, "planned");
        assert_eq!(saved.execution_note, None);
        assert!(db.get_task_metadata(&id).unwrap().history.iter()
            .any(|event| event.note.as_deref() == Some("后来补充的记录")));
    }
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
fn legacy_done_task_without_completion_context_is_read_only_and_keeps_workload() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let id = db.create_manual_task("旧版完成任务").unwrap();
    db.connection.execute("UPDATE tasks SET status = 'done', total_workload_minutes = 180,
        estimated_minutes = 180, remaining_workload_minutes = 45 WHERE id = ?1", [&id]).unwrap();
    assert!(db.reopen_manual_task(&id, TODAY).is_err(), "unknown legacy completion context is conservatively read-only");
    assert_eq!(db.get_task(&id).unwrap().remaining_workload_minutes, Some(45));
}
