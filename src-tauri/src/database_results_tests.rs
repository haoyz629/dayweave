use super::*;
use serde_json::json;

const DATE: &str = "2026-10-16";
const END: &str = "2026-10-16T23:30:00+08:00";

fn fixture(db: &mut Database) -> (String, String) {
    let id = db.create_manual_task("结果窗口").unwrap();
    db.connection.execute("UPDATE tasks SET total_workload_minutes = 120, remaining_workload_minutes = 75 WHERE id = ?1", [&id]).unwrap();
    let block = add_block(db, &id, DATE, END);
    (id, block)
}

fn add_block(db: &Database, task: &str, date: &str, end: &str) -> String {
    let plan: String = db.connection.query_row("SELECT id FROM daily_plans WHERE plan_date = ?1 AND status = 'confirmed'", [date], |row| row.get(0))
        .optional().unwrap().unwrap_or_else(|| {
            let plan = Uuid::new_v4().to_string();
            db.connection.execute("INSERT INTO daily_plans(id,plan_date,status,source,created_at,confirmed_at)
                VALUES (?1,?2,'confirmed','manual',?3,?3)", params![plan,date,now()]).unwrap();
            plan
        });
    let block = Uuid::new_v4().to_string();
    db.connection.execute("INSERT INTO plan_blocks(id,daily_plan_id,task_id,starts_at,ends_at,source,created_at,updated_at)
        VALUES (?1,?2,?3,?4,?5,'manual',?6,?6)", params![block,plan,task,format!("{date}T23:00:00+08:00"),end,now()]).unwrap();
    block
}

fn resolution(db: &Database, task: &str, block: &str, outcome: ReviewOutcome) -> TaskExecutionResolutionInput {
    TaskExecutionResolutionInput { plan_block_id: block.into(), expected_task_updated_at: db.get_task(task).unwrap().updated_at,
        outcome, note: Some("结果备注".into()), next_action: None, starts_at: None, ends_at: None, remaining_workload_minutes: None }
}

fn review(block: &str) -> ReviewEntryInput {
    ReviewEntryInput { plan_block_id: block.into(), outcome: ReviewOutcome::NotStarted, actual_minutes: None,
        defer_reason: None, notes: Some("修改结果".into()), remaining_workload_minutes: None }
}

// Include draft revisions, durable snapshots and undo metadata as well as execution facts.
fn result_facts(db: &Database, task: &str) -> String {
    serde_json::to_string(&json!([
        fact_fingerprint(&db.connection, "task_completion", task).unwrap(),
        fact_rows(&db.connection, "SELECT * FROM task_completion_snapshots WHERE task_id = ?1", task).unwrap(),
        fact_rows(&db.connection, "SELECT * FROM undo_entries WHERE target_id = ?1 ORDER BY id", task).unwrap(),
        fact_rows(&db.connection, "SELECT d.* FROM review_form_drafts d JOIN plan_blocks pb ON pb.id = d.item_id WHERE pb.task_id = ?1 ORDER BY d.review_date,d.item_type,d.item_id", task).unwrap(),
    ])).unwrap()
}

#[test]
fn whole_task_note_window_and_same_day_reopen_rules_reject_atomically() {
    for action in ["complete", "reopen", "transition", "undo"] {
        for (time, allowed) in [("2026-10-16T23:40:00+08:00",true), ("2026-10-17T05:29:59+08:00",true), ("2026-10-17T05:30:00+08:00",true), ("2026-10-17T05:30:01+08:00",false)] {
            let allowed = allowed && (action == "complete" || time.starts_with(DATE));
            let mut db = Database::in_memory().unwrap();
            let (id, block, undo) = {
                let _clock = TestNow::new(if time.starts_with(DATE) { "2026-10-16T23:39:58+08:00" } else { "2026-10-17T05:29:58+08:00" });
                let (id, block) = fixture(&mut db);
                db.complete_task(&id, Some(&block)).unwrap();
                let undo = db.latest_undo().unwrap().unwrap().id;
                (id, block, undo)
            };
            let _clock = TestNow::new(time);
            let before = result_facts(&db, &id);
            let result = match action {
                "complete" => db.complete_task_with_note(&id, Some(&block), Some("修改完成备注".into())).map(|_| ()),
                "resolve" => db.resolve_task_execution(DATE, resolution(&db,&id,&block,ReviewOutcome::NotStarted)).map(|_| ()),
                "capture" => db.save_execution_capture(DATE, ExecutionCaptureInput { plan_block_id:block.clone(), outcome:Some(ReviewOutcome::NotStarted), note:None }),
                "clear" => db.clear_execution_capture(DATE, &block),
                "review" => db.save_review_entry(DATE, review(&block)).map(|_| ()),
                "reopen" => db.reopen_manual_task(&id, "2099-01-01").map(|_| ()),
                "transition" => db.transition_manual_task(&id, TaskStatus::Open).map(|_| ()),
                "undo" => db.apply_undo(&undo).map(|_| ()),
                _ => unreachable!(),
            };
            assert_eq!(result.is_ok(), allowed, "{action} at {time}: {result:?}");
            if !allowed {
                assert_eq!(result_facts(&db, &id),before,"atomic {action}");
            } else if action != "complete" {
                assert_ne!(db.get_task(&id).unwrap().status, "done", "{action} must atomically reopen");
                assert_eq!(db.get_task(&id).unwrap().remaining_workload_minutes, Some(75));
            }
            let task = db.get_task(&id).unwrap();
            assert_eq!(task.result_date.as_deref(),Some(DATE));
            assert_eq!(task.result_ends_at.as_deref(),Some(END));
        }
    }
}

#[test]
fn cst_today_future_and_end_lower_bound_are_backend_authoritative() {
    let _clock = TestNow::new("2026-10-16T16:05:00Z");
    assert_eq!(shanghai_today(), "2026-10-17");
    assert!(database_results::window(Some("2026-10-17"), None));
    assert!(database_results::window(Some(DATE), Some("2026-10-16T15:30:00Z")));
    assert!(!database_results::window(Some("2026-10-18"),Some("2026-10-17T00:00:00+08:00")));
    assert!(!database_results::window(Some(DATE),Some("2026-10-17T01:00:00+08:00")), "cannot edit before original end on a historical date");
    assert!(!database_results::window(None,Some(END)));
    let mut db = Database::in_memory().unwrap();
    let (id, block) = fixture(&mut db);
    assert!(db.resolve_task_execution("2026-10-17",resolution(&db,&id,&block,ReviewOutcome::Completed)).is_err());
    let future = add_block(&db,&id,"2026-10-18","2026-10-18T23:30:00+08:00");
    assert!(db.complete_task(&id,Some(&future)).is_err());
    let _client_date = TestToday::new("2099-01-01");
    assert_eq!(shanghai_today(), "2026-10-17", "timestamp test clock has precedence over compatibility date clock");
}

#[test]
fn cross_day_completion_uses_original_execution_and_never_moves_it_to_today() {
    let _clock = TestNow::new("2026-10-17T02:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let (id, block) = fixture(&mut db);
    let completed = db.complete_task(&id, Some(&block)).unwrap();
    assert_eq!(completed.status,"done");
    assert_eq!(completed.result_date.as_deref(),Some(DATE));
    assert!(db.get_day_schedule("2026-10-17").unwrap().task_blocks.is_empty());
    let saved = db.get_day_schedule(DATE).unwrap().task_blocks.remove(0);
    assert_eq!(saved.ends_at,END);
    assert_eq!(saved.execution_status,"completed");
    let before = result_facts(&db, &id);
    assert!(db.reopen_manual_task(&id,"2099-01-01").is_err());
    assert_eq!(result_facts(&db, &id), before);
    db.complete_task(&id,None).unwrap();
    assert_eq!(db.get_task(&id).unwrap().result_ends_at.as_deref(),Some(END));
}

#[test]
fn completion_note_correction_preserves_first_before_snapshot_and_original_workload() {
    let _clock = TestNow::new("2026-10-16T23:40:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let (id, block) = fixture(&mut db);
    db.complete_task(&id,Some(&block)).unwrap();
    let before: String = db.connection.query_row("SELECT before_json FROM task_completion_snapshots WHERE task_id = ?1",[&id],|row|row.get(0)).unwrap();
    db.complete_task_with_note(&id,Some(&block),Some("修改完成备注".into())).unwrap();
    let after: String = db.connection.query_row("SELECT before_json FROM task_completion_snapshots WHERE task_id = ?1",[&id],|row|row.get(0)).unwrap();
    assert_eq!(before,after);
    assert_eq!(db.reopen_manual_task(&id,DATE).unwrap().remaining_workload_minutes,Some(75));
    assert_eq!(execution_snapshot(&db.connection,&block).unwrap().execution_status,"planned");
}

#[test]
fn repeated_reopen_complete_restore_and_timestamp_edits_never_extend_context() {
    let mut db = Database::in_memory().unwrap();
    let (id, block) = {
        let _clock = TestNow::new("2026-10-16T23:59:59+08:00");
        let (id, block) = fixture(&mut db);
        db.complete_task(&id,Some(&block)).unwrap();
        (id,block)
    };
    {
        let _clock = TestNow::new("2026-10-16T23:59:59+08:00");
        db.reopen_manual_task(&id,DATE).unwrap();
        db.complete_task(&id,None).unwrap();
        db.soft_delete_manual_task(&id,true).unwrap();
        db.restore_task(&id).unwrap();
    }
    let _clock = TestNow::new("2026-10-17T05:30:01+08:00");
    db.connection.execute("UPDATE tasks SET updated_at = ?2, due_at = '2026-10-18T23:59:00+08:00' WHERE id = ?1",params![id,now()]).unwrap();
    db.connection.execute("UPDATE plan_blocks SET ends_at = '2026-10-18T23:59:00+08:00' WHERE id = ?1",[&block]).unwrap();
    assert!(db.reopen_manual_task(&id,"2026-10-17").is_err());
    assert!(db.complete_task(&id,None).is_err());
    db.save_execution_capture(DATE,ExecutionCaptureInput { plan_block_id:block,outcome:Some(ReviewOutcome::Completed),note:None }).unwrap();
    assert_eq!(db.get_task(&id).unwrap().result_ends_at.as_deref(),Some(END));
}

#[test]
fn no_block_completion_uses_first_operation_day_and_original_due_end() {
    for due in [None,Some(END)] {
        let mut db = Database::in_memory().unwrap();
        let id = {
            let _clock = TestNow::new("2026-10-16T23:59:59+08:00");
            let id = db.create_manual_task("无执行块").unwrap();
            db.connection.execute("UPDATE tasks SET due_at = ?2, total_workload_minutes = 60, remaining_workload_minutes = 45 WHERE id = ?1",params![id,due]).unwrap();
            let saved = db.complete_task(&id,None).unwrap();
            assert_eq!(saved.result_date.as_deref(),Some(DATE));
            assert_eq!(saved.result_ends_at.as_deref(),due);
            id
        };
        {
            let _clock = TestNow::new("2026-10-17T05:30:00+08:00");
            let before = result_facts(&db, &id);
            assert!(db.reopen_manual_task(&id,DATE).is_err());
            assert_eq!(result_facts(&db, &id), before);
            assert_eq!(db.complete_task_with_note(&id,None,Some("窗口内完成备注".into())).is_ok(),due.is_some());
        }
        let _clock = TestNow::new("2026-10-17T05:30:01+08:00");
        assert!(db.reopen_manual_task(&id,"2026-10-17").is_err());
        assert!(db.complete_task(&id,None).is_err());
    }
}

#[test]
fn latest_historical_corrections_sync_status_without_changing_task_contents() {
    let _clock = TestNow::new("2026-10-17T12:00:00+08:00");
    for action in ["capture", "resolve", "review"] {
        let mut db = Database::in_memory().unwrap();
        let (id, block) = fixture(&mut db);
        let content_sql = "SELECT title, notes, priority, earliest_start_at, due_at, total_workload_minutes, actual_minutes FROM tasks WHERE id = ?1";
        let before = fact_rows(&db.connection, content_sql, &id).unwrap();
        for outcome in [ReviewOutcome::NotStarted, ReviewOutcome::Partial, ReviewOutcome::Blocked, ReviewOutcome::Cancelled, ReviewOutcome::Completed, ReviewOutcome::Completed] {
            correct_result(&mut db, action, DATE, &id, &block, outcome, Some("历史修正备注".into())).unwrap();
            let task = db.get_task(&id).unwrap();
            let completed = outcome == ReviewOutcome::Completed;
            assert_eq!(task.status == "done", completed, "{action}/{outcome:?}");
            assert_eq!(task.remaining_workload_minutes, Some(if completed { 0 } else { 75 }));
            assert_incomplete_classification(&mut db, &id, !completed);
            assert_eq!(fact_rows(&db.connection, content_sql, &id).unwrap(), before);
            let saved = db.get_day_schedule(DATE).unwrap().task_blocks.remove(0);
            assert_eq!(saved.task_status, task.status);
            assert_eq!(saved.execution_status, outcome.as_str());
            assert_eq!(saved.execution_note.as_deref(), Some("历史修正备注"));
            assert_eq!(saved.ends_at, END);
        }
        for outcome in [ReviewOutcome::NotStarted, ReviewOutcome::Partial, ReviewOutcome::Blocked, ReviewOutcome::Cancelled] {
            let before = result_facts(&db, &id);
            assert!(correct_result(&mut db, action, DATE, &id, &block, outcome, Some("禁止撤销".into())).is_err());
            assert_eq!(result_facts(&db, &id), before, "{action}/{outcome:?}");
        }
    }
}

#[test]
fn result_corrections_preserve_independent_review_fields_and_audit() {
    let mut db = Database::in_memory().unwrap();
    let (id, block, original) = {
        let _clock = TestNow::new("2026-10-16T23:59:00+08:00");
        let (id, block) = fixture(&mut db);
        let mut input = review(&block);
        input.actual_minutes = Some(25);
        input.defer_reason = Some("独立复盘原因".into());
        input.remaining_workload_minutes = Some(55);
        let saved = db.save_review_entry(DATE,input).unwrap();
        db.complete_task(&id,Some(&block)).unwrap();
        (id,block,saved)
    };
    let _clock = TestNow::new("2026-10-17T05:30:00+08:00");
    let mut correction = review(&block);
    correction.outcome = ReviewOutcome::Completed;
    let saved = db.save_review_entry(DATE,correction).unwrap();
    assert_eq!(saved.actual_minutes,original.actual_minutes);
    assert_eq!(saved.defer_reason,original.defer_reason);
    assert_eq!(saved.remaining_workload_minutes,original.remaining_workload_minutes);
    assert_eq!(saved.created_at,original.created_at);
    assert_eq!(saved.updated_at,original.updated_at);
    assert_eq!(db.get_task(&id).unwrap().remaining_workload_minutes,Some(0));
    assert_eq!(db.get_task(&id).unwrap().status,"done");
    assert_incomplete_classification(&mut db, &id, false);
    assert_eq!(db.get_task(&id).unwrap().actual_minutes,25);
    let mut forbidden = review(&block);
    forbidden.outcome = ReviewOutcome::Completed;
    forbidden.actual_minutes = Some(99);
    assert!(db.save_review_entry(DATE,forbidden).is_err());
}

#[test]
fn genuine_new_execution_can_have_new_context_but_other_old_results_cannot_refresh_completion() {
    let mut db = Database::in_memory().unwrap();
    let id = {
        let _clock = TestNow::new("2026-10-16T23:59:00+08:00");
        let (id, block) = fixture(&mut db);
        db.complete_task(&id,Some(&block)).unwrap();
        db.reopen_manual_task(&id,DATE).unwrap();
        id
    };
    let _clock = TestNow::new("2026-10-17T12:00:00+08:00");
    let new_block = add_block(&db,&id,"2026-10-17","2026-10-17T23:30:00+08:00");
    let saved = db.complete_task(&id,Some(&new_block)).unwrap();
    assert_eq!(saved.result_date.as_deref(),Some("2026-10-17"));
    let other = add_block(&db,&id,"2026-10-17","2026-10-17T23:45:00+08:00");
    assert!(db.complete_task(&id,Some(&other)).is_err(),"done task cannot refresh context using another block");
}

fn v25() -> Database {
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);").unwrap();
    for (version,sql) in MIGRATIONS.iter().filter(|(version,_)| *version <= 25) {
        connection.execute_batch(sql).unwrap();
        connection.execute("INSERT INTO schema_migrations VALUES (?1,?2)",params![version,now()]).unwrap();
    }
    Database { connection, holiday_calendar: CalendarState::bundled() }
}

#[test]
fn migration26_recovers_snapshot_and_utc_changes_but_never_updated_at() {
    let _clock = TestNow::new("2026-10-17T01:00:00+08:00");
    let mut db = v25();
    let (snapshot, block) = fixture(&mut db);
    let change = db.create_manual_task("UTC日期恢复").unwrap();
    let unknown = db.create_manual_task("无法确定的旧完成").unwrap();
    let malformed = db.create_manual_task("坏快照但有效完成审计").unwrap();
    db.connection.execute("UPDATE tasks SET status = 'done', remaining_workload_minutes = 0, updated_at = ?1",[now()]).unwrap();
    db.connection.execute("INSERT INTO task_completion_snapshots VALUES (?1,?2,?3)",params![snapshot,
        json!({"task":{"id":snapshot,"due_at":"2099-01-01T00:00:00+08:00"},"block":null}).to_string(),json!({"id":block}).to_string()]).unwrap();
    db.connection.execute("INSERT INTO task_completion_snapshots VALUES (?1,'invalid json',NULL)",[&malformed]).unwrap();
    for id in [&change,&malformed] {
        db.connection.execute("INSERT INTO task_changes VALUES (?1,?2,'status_changed','open','done','manual',NULL,'2026-10-16T16:01:00Z')",params![Uuid::new_v4().to_string(),id]).unwrap();
    }
    db.migrate().unwrap();
    db.migrate().unwrap();
    assert_eq!(db.get_task(&snapshot).unwrap().result_date.as_deref(),Some(DATE));
    assert_eq!(db.get_task(&snapshot).unwrap().result_ends_at.as_deref(),Some(END));
    assert_eq!(db.get_task(&change).unwrap().result_date.as_deref(),Some("2026-10-17"));
    assert_eq!(db.get_task(&malformed).unwrap().result_date.as_deref(),Some("2026-10-17"));
    assert!(db.get_task(&unknown).unwrap().result_date.is_none());
    assert!(db.reopen_manual_task(&unknown,"2026-10-17").is_err());
    assert_eq!(db.get_task(&unknown).unwrap().status,"done");
    assert_eq!(db.count("tasks").unwrap(),4);
    assert_eq!(db.get_task(&snapshot).unwrap().remaining_workload_minutes,Some(0));
}

#[test]
fn old_dto_and_fingerprints_remain_undo_compatible_without_ignoring_new_context_conflicts() {
    let _clock = TestNow::new("2026-10-16T23:40:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let (id, block) = fixture(&mut db);
    db.complete_task(&id,Some(&block)).unwrap();
    let undo = db.latest_undo().unwrap().unwrap();
    let text: String = db.connection.query_row("SELECT before_json FROM undo_entries WHERE id = ?1",[&undo.id],|row|row.get(0)).unwrap();
    let mut payload: serde_json::Value = serde_json::from_str(&text).unwrap();
    payload.as_object_mut().unwrap().remove("review");
    let task = payload["task"].as_object_mut().unwrap();
    task.remove("result_date"); task.remove("result_ends_at"); task.insert("status_locked".into(),json!(true));
    let mut facts: Vec<Vec<Vec<String>>> = serde_json::from_str(payload["after_facts"].as_str().unwrap()).unwrap();
    for row in &mut facts[0] { row.truncate(row.len()-3); }
    for row in &mut facts[1] { row.drain(row.len()-4..row.len()-2); }
    payload["after_facts"] = json!(serde_json::to_string(&facts).unwrap());
    db.connection.execute("UPDATE undo_entries SET before_json = ?2 WHERE id = ?1",params![undo.id,payload.to_string()]).unwrap();
    db.apply_undo(&undo.id).unwrap();
    assert_eq!(db.get_task(&id).unwrap().remaining_workload_minutes,Some(75));
    db.complete_task(&id,None).unwrap();
    let undo = db.latest_undo().unwrap().unwrap();
    db.connection.execute("UPDATE tasks SET result_ends_at = '2026-10-17T01:00:00+08:00' WHERE id = ?1",[&id]).unwrap();
    assert!(db.apply_undo(&undo.id).is_err(),"new fingerprints protect new context fields too");
}

#[test]
fn cleared_capture_keeps_original_date_even_when_block_is_rescheduled() {
    let mut db = Database::in_memory().unwrap();
    let (id, block) = {
        let _clock = TestNow::new("2026-10-16T23:40:00+08:00");
        let (id, block) = fixture(&mut db);
        db.save_execution_capture(DATE, ExecutionCaptureInput { plan_block_id:block.clone(), outcome:Some(ReviewOutcome::Completed), note:None }).unwrap();
        db.clear_execution_capture(DATE,&block).unwrap();
        (id,block)
    };
    let _clock = TestNow::new("2026-10-17T12:00:00+08:00");
    db.connection.execute("UPDATE daily_plans SET plan_date = '2026-10-17'",[]).unwrap();
    db.connection.execute("UPDATE plan_blocks SET starts_at = '2026-10-17T23:00:00+08:00', ends_at = '2026-10-17T23:30:00+08:00' WHERE id = ?1",[&block]).unwrap();
    assert!(db.save_execution_capture("2026-10-17", ExecutionCaptureInput { plan_block_id:block.clone(),outcome:Some(ReviewOutcome::Completed),note:None }).is_err());
    assert!(db.complete_task(&id,Some(&block)).is_err());
}

#[test]
fn correcting_completed_review_note_preserves_first_snapshot_and_reopen_restores_review_result_only() {
    let _clock = TestNow::new("2026-10-16T23:40:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let (id, block) = fixture(&mut db);
    // A pre-existing independent review owns its detail and audit columns.
    db.connection.execute("INSERT INTO review_entries(id,review_date,plan_block_id,task_id,outcome,actual_minutes,defer_reason,notes,remaining_workload_minutes,created_at,updated_at)
        VALUES ('independent',?1,?2,?3,'blocked',17,'reason','original independent note',75,'2026-10-16T23:31:00+08:00','2026-10-16T23:31:00+08:00')",params![DATE,block,id]).unwrap();
    db.connection.execute("UPDATE plan_blocks SET execution_status = 'blocked', actual_minutes = 17 WHERE id = ?1",[&block]).unwrap();
    db.complete_task_with_note(&id,Some(&block),Some("first completion note".into())).unwrap();
    let before: String = db.connection.query_row("SELECT before_json FROM task_completion_snapshots WHERE task_id = ?1",[&id],|row|row.get(0)).unwrap();
    db.complete_task_with_note(&id,Some(&block),Some("corrected completion note".into())).unwrap();
    let after: String = db.connection.query_row("SELECT before_json FROM task_completion_snapshots WHERE task_id = ?1",[&id],|row|row.get(0)).unwrap();
    assert_eq!(before,after);
    db.reopen_manual_task(&id,DATE).unwrap();
    let saved = db.get_review_entry_for_block(&block).unwrap();
    assert_eq!(saved.outcome,"blocked");
    assert_eq!(saved.notes.as_deref(),Some("original independent note"));
    assert_eq!(saved.actual_minutes,Some(17));
    assert_eq!(saved.defer_reason.as_deref(),Some("reason"));
    assert_eq!(saved.remaining_workload_minutes,Some(75));
    assert_eq!(saved.created_at,"2026-10-16T23:31:00+08:00");
    assert_eq!(saved.updated_at,"2026-10-16T23:31:00+08:00");
}

#[test]
fn omitting_block_id_cannot_disguise_a_future_execution_as_no_block_completion() {
    let _clock = TestNow::new("2026-10-17T01:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let id = db.create_manual_task("未来执行").unwrap();
    add_block(&db,&id,"2026-10-18","2026-10-18T23:30:00+08:00");
    let before = fact_fingerprint(&db.connection,"task_completion",&id).unwrap();
    assert!(db.complete_task(&id,None).is_err());
    assert!(db.transition_manual_task(&id,TaskStatus::Done).is_err());
    assert_eq!(fact_fingerprint(&db.connection,"task_completion",&id).unwrap(),before);
}

#[test]
fn cross_day_reopen_is_rejected_and_preserves_historical_content_tags_and_schedule() {
    let mut db = Database::in_memory().unwrap();
    let (id, block) = {
        let _clock = TestNow::new("2026-10-16T23:40:00+08:00");
        let (id, block) = fixture(&mut db);
        db.connection.execute("UPDATE tasks SET earliest_start_at = '2026-10-16T23:00:00+08:00', due_at = ?2,
            earliest_start_date = ?3, due_date = ?3, earliest_start_time = '23:00', due_time = '23:30' WHERE id = ?1", params![id, END, DATE]).unwrap();
        db.complete_task(&id, Some(&block)).unwrap();
        (id, block)
    };
    let _clock = TestNow::new("2026-10-17T01:00:00+08:00");
    let before = result_facts(&db, &id);
    assert!(db.reopen_manual_task(&id, DATE).is_err());
    assert_eq!(result_facts(&db, &id), before);
    assert!(db.get_task(&id).unwrap().execution_locked);
    assert_eq!(execution_snapshot(&db.connection, &block).unwrap().execution_status, "completed");
    let update = ManualTaskUpdate { title: "不应保存".into(), notes: Some("不应保存".into()), priority: None,
        earliest_start_at: Some("2026-10-16T23:00:00+08:00".into()), due_at: Some(END.into()), estimated_minutes: Some(30) };
    assert!(db.update_manual_task_with_tags(&id, update, Some(vec!["不应保存".into()])).unwrap_err().to_string().contains("任务已完成，请先取消完成再修改"));
    assert!(db.set_task_tags(&id, vec!["不应保存".into()]).is_err());
    assert!(db.update_plan_block_time(PlanBlockTimeUpdate { plan_date:DATE.into(), block_id:block.clone(),
        expected_starts_at:"2026-10-16T23:00:00+08:00".into(), expected_ends_at:END.into(),
        starts_at:"2026-10-16T22:00:00+08:00".into(), ends_at:"2026-10-16T22:30:00+08:00".into() }).is_err());
    assert!(db.remove_plan_block(PlanBlockRemove { plan_date:DATE.into(), block_id:block,
        expected_starts_at:"2026-10-16T23:00:00+08:00".into(), expected_ends_at:END.into() }).is_err());
    assert_eq!(result_facts(&db, &id), before);
}

#[test]
fn historical_backfill_is_not_the_completion_candidate_when_today_has_an_execution() {
    let _clock = TestNow::new("2026-10-17T12:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let (id, old) = fixture(&mut db);
    let current = add_block(&db, &id, "2026-10-17", "2026-10-17T23:30:00+08:00");
    db.save_execution_capture(DATE, ExecutionCaptureInput { plan_block_id:old.clone(), outcome:Some(ReviewOutcome::NotStarted), note:Some("历史补录".into()) }).unwrap();
    let metadata = db.get_task_metadata(&id).unwrap();
    assert_eq!(metadata.latest_execution.unwrap().plan_date, DATE);
    assert_eq!(metadata.completion_date.as_deref(), Some("2026-10-17"));
    assert_eq!(metadata.completion_ends_at.as_deref(), Some("2026-10-17T23:30:00+08:00"));
    assert_eq!(database_results::completion_candidate(&db.connection, &id).unwrap(), Some(current));
    let old_before = fact_rows(&db.connection, "SELECT * FROM plan_blocks WHERE id = ?1", &old).unwrap();
    db.complete_task(&id, None).unwrap();
    assert_eq!(db.get_task(&id).unwrap().result_date.as_deref(), Some("2026-10-17"));
    assert_eq!(fact_rows(&db.connection, "SELECT * FROM plan_blocks WHERE id = ?1", &old).unwrap(), old_before);
}

#[test]
fn daily_completion_note_clear_persists_null_and_whole_reopen_does_not_replay_facts() {
    let _clock = TestNow::new("2026-10-16T23:40:00+08:00");
    for final_review in [false, true] {
        let mut db = Database::in_memory().unwrap();
        let (id, block) = fixture(&mut db);
        db.connection.execute("UPDATE plan_blocks SET execution_status = 'not_started', execution_note = '原备注' WHERE id = ?1", [&block]).unwrap();
        if final_review {
            db.connection.execute("INSERT INTO review_entries(id,review_date,plan_block_id,task_id,outcome,actual_minutes,notes,created_at,updated_at)
                VALUES ('note-review',?1,?2,?3,'not_started',17,'原备注','old','old')", params![DATE,block,id]).unwrap();
        }
        db.resolve_task_execution(DATE, resolution(&db,&id,&block,ReviewOutcome::Completed)).unwrap();
        let before: String = db.connection.query_row("SELECT before_json FROM task_completion_snapshots WHERE task_id = ?1", [&id], |row|row.get(0)).unwrap();
        let mut request = resolution(&db,&id,&block,ReviewOutcome::Completed);
        request.note = None;
        db.resolve_task_execution(DATE, request).unwrap();
        assert_eq!(execution_snapshot(&db.connection,&block).unwrap().execution_note, None);
        if final_review { assert_eq!(db.get_review_entry_for_block(&block).unwrap().notes, None); }
        let after: String = db.connection.query_row("SELECT before_json FROM task_completion_snapshots WHERE task_id = ?1", [&id], |row|row.get(0)).unwrap();
        assert_eq!(before, after);
        db.reopen_manual_task(&id, DATE).unwrap();
        assert_eq!(execution_snapshot(&db.connection,&block).unwrap().execution_note, None);
        if final_review {
            let review = db.get_review_entry_for_block(&block).unwrap();
            assert_eq!(review.notes, None);
            assert_eq!(review.actual_minutes, Some(17));
            assert_eq!(review.updated_at, "old");
        }
    }
}

#[test]
fn clearing_incomplete_restores_pending_without_changing_schedule_workload_or_other_blocks() {
    let _clock = TestNow::new("2026-10-16T23:40:00+08:00");
    for outcome in [ReviewOutcome::NotStarted, ReviewOutcome::Partial, ReviewOutcome::Cancelled, ReviewOutcome::Blocked] {
        let mut db = Database::in_memory().unwrap();
        let (id, block) = fixture(&mut db);
        db.connection.execute("UPDATE tasks SET status = 'scheduled', earliest_start_at = '2026-10-16T23:00:00+08:00',
            due_at = ?2, earliest_start_date = ?3, due_date = ?3, earliest_start_time = '23:00', due_time = '23:30' WHERE id = ?1",
            params![id, END, DATE]).unwrap();
        let other = add_block(&db, &id, "2026-10-17", "2026-10-17T23:30:00+08:00");
        let other_before = fact_rows(&db.connection, "SELECT * FROM plan_blocks WHERE id = ?1", &other).unwrap();
        let before = serde_json::to_value(db.get_task(&id).unwrap()).unwrap();
        if outcome == ReviewOutcome::NotStarted {
            db.resolve_task_execution(DATE, resolution(&db, &id, &block, outcome)).unwrap();
        } else {
            db.save_execution_capture(DATE, ExecutionCaptureInput { plan_block_id: block.clone(), outcome: Some(outcome), note: Some("结果备注".into()) }).unwrap();
        }
        assert!(db.get_task(&id).unwrap().execution_locked);
        let stale = resolution(&db, &id, &block, ReviewOutcome::NotStarted);
        let undo = db.latest_undo().unwrap();
        let revision: i64 = db.connection.query_row("SELECT revision FROM review_form_drafts WHERE item_id = ?1", [&block], |row| row.get(0)).unwrap();
        db.save_review_form_draft(DATE, "task", &block, r#"{"notes":"尚未提交"}"#, revision).unwrap();
        let _clear_clock = TestNow::new("2026-10-16T23:41:00+08:00");
        db.clear_execution_capture(DATE, &block).unwrap();
        let saved = db.get_day_schedule(DATE).unwrap().task_blocks.remove(0);
        assert_eq!(saved.execution_status, "planned");
        assert_eq!(saved.execution_note, None);
        assert_eq!(saved.execution_captured_at, None);
        assert_eq!(saved.actual_minutes, None);
        assert!(!saved.review_required);
        assert!(saved.review.is_none());
        assert_eq!(saved.starts_at, "2026-10-16T23:00:00+08:00");
        assert_eq!(saved.ends_at, END);
        assert_eq!(saved.result_date.as_deref(), Some(DATE));
        assert_eq!(saved.result_ends_at.as_deref(), Some(END));
        let task = db.get_task(&id).unwrap();
        assert!(!task.execution_locked);
        assert_ne!(task.updated_at, stale.expected_task_updated_at);
        let mut after = serde_json::to_value(task).unwrap();
        after["updated_at"] = before["updated_at"].clone();
        assert_eq!(after, before, "only the task version changes");
        assert_eq!(fact_rows(&db.connection, "SELECT * FROM plan_blocks WHERE id = ?1", &other).unwrap(), other_before);
        let (payload, cleared_revision): (Option<String>, i64) = db.connection.query_row(
            "SELECT payload_json, revision FROM review_form_drafts WHERE item_id = ?1", [&block], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
        assert_eq!(payload, None);
        assert!(cleared_revision > revision);
        assert!(db.save_review_form_draft(DATE, "task", &block, r#"{"notes":"迟到的保存"}"#, revision).is_err());
        assert!(db.resolve_task_execution(DATE, stale).is_err());
        if let Some(undo) = undo { assert!(db.apply_undo(&undo.id).is_err()); }
    }
}

#[test]
fn clearing_historical_incomplete_is_record_only_without_result_deadline() {
    for time in ["2026-10-17T05:29:59+08:00", "2026-10-17T05:30:00+08:00", "2026-10-17T05:30:00.001+08:00", "2026-11-17T12:00:00+08:00"] {
        let mut db = Database::in_memory().unwrap();
        let (id, block) = {
            let _clock = TestNow::new("2026-10-16T23:40:00+08:00");
            let (id, block) = fixture(&mut db);
            db.resolve_task_execution(DATE, resolution(&db, &id, &block, ReviewOutcome::NotStarted)).unwrap();
            (id, block)
        };
        let _clock = TestNow::new(time);
        let before = fact_rows(&db.connection, "SELECT * FROM tasks WHERE id = ?1", &id).unwrap();
        db.clear_execution_capture(DATE, &block).unwrap();
        assert_eq!(execution_snapshot(&db.connection, &block).unwrap().execution_status, "planned");
        assert_eq!(fact_rows(&db.connection, "SELECT * FROM tasks WHERE id = ?1", &id).unwrap(), before);
        let (_, date, end) = database_results::block_context(&db.connection, &block).unwrap();
        assert_eq!(date, DATE);
        assert_eq!(end, END);
    }
}

#[test]
fn clearing_incomplete_rejects_wrong_date_deleted_reviewed_and_empty_records_atomically() {
    let _clock = TestNow::new("2026-10-16T23:40:00+08:00");
    for guard in ["date", "deleted", "reviewed", "empty"] {
        let mut db = Database::in_memory().unwrap();
        let (id, block) = fixture(&mut db);
        if guard != "empty" { db.resolve_task_execution(DATE, resolution(&db, &id, &block, ReviewOutcome::NotStarted)).unwrap(); }
        if guard == "deleted" { db.connection.execute("UPDATE tasks SET status = 'deleted', deleted_at = ?2 WHERE id = ?1", params![id, now()]).unwrap(); }
        if guard == "reviewed" { db.save_review_entry(DATE, review(&block)).unwrap(); }
        let before = fact_fingerprint(&db.connection, "task_completion", &id).unwrap();
        let date = if guard == "date" { "2026-10-17" } else { DATE };
        assert!(db.clear_execution_capture(date, &block).is_err(), "{guard}");
        assert_eq!(fact_fingerprint(&db.connection, "task_completion", &id).unwrap(), before, "{guard}");
    }
}

fn correct_result(db: &mut Database, action: &str, date: &str, task: &str, block: &str, outcome: ReviewOutcome, note: Option<String>) -> AppResult<()> {
    match action {
        "capture" => db.save_execution_capture(date, ExecutionCaptureInput { plan_block_id: block.into(), outcome: Some(outcome), note }),
        "resolve" => {
            let mut input = resolution(db, task, block, outcome);
            input.note = note;
            db.resolve_task_execution(date, input).map(|_| ())
        },
        "review" => {
            let mut input = review(block);
            input.outcome = outcome;
            input.notes = note;
            db.save_review_entry(date, input).map(|_| ())
        },
        "clear" => db.clear_execution_capture(date, block),
        _ => unreachable!(),
    }
}

fn task_side_effects(db: &Database, task: &str, selected: &str) -> Vec<Vec<Vec<String>>> {
    [
        "SELECT * FROM tasks WHERE id = ?1",
        "SELECT * FROM task_estimates WHERE task_id = ?1 ORDER BY id",
        // Durable history is the only permitted task-level addition for record-only corrections.
        "SELECT * FROM task_changes WHERE task_id = ?1 AND change_kind <> 'history_snapshot' ORDER BY id",
        "SELECT * FROM task_completion_snapshots WHERE task_id = ?1",
        "SELECT * FROM undo_entries WHERE target_id = ?1 ORDER BY id",
        "SELECT * FROM task_tags WHERE task_id = ?1 ORDER BY tag_id",
    ].iter().map(|sql| fact_rows(&db.connection, sql, task).unwrap()).chain([
        fact_rows(&db.connection, "SELECT * FROM plan_blocks WHERE id <> ?1 ORDER BY id", selected).unwrap(),
        fact_rows(&db.connection, "SELECT * FROM review_entries WHERE plan_block_id <> ?1 ORDER BY id", selected).unwrap(),
        fact_rows(&db.connection, "SELECT * FROM daily_plans WHERE id <> ?1 ORDER BY id", "").unwrap(),
    ]).collect()
}

#[test]
fn older_corrections_all_states_and_apis_preserve_later_execution_and_other_dates() {
    for date in [DATE, "2026-09-01"] {
        for done in [false, true] {
            for state in ["planned", "not_started", "partial", "blocked", "cancelled", "completed", "reviewed"] {
                for action in ["capture", "resolve", "review"] {
                    // Yesterday is still inside the old six-hour grace period.
                    let _clock = TestNow::new("2026-10-17T01:00:00+08:00");
                    let mut db = Database::in_memory().unwrap();
                    let id = db.create_manual_task("跨日任务隔离").unwrap();
                    db.connection.execute("UPDATE tasks SET status = 'scheduled', total_workload_minutes = 180,
                        remaining_workload_minutes = 120, actual_minutes = 23,
                        earliest_start_at = '2026-09-01T09:00:00+08:00', due_at = '2026-10-18T23:30:00+08:00' WHERE id = ?1", [&id]).unwrap();
                    let block = add_block(&db, &id, date, &format!("{date}T23:30:00+08:00"));
                    let current = add_block(&db, &id, "2026-10-17", "2026-10-17T23:30:00+08:00");
                    add_block(&db, &id, "2026-10-18", "2026-10-18T23:30:00+08:00");
                    if done { db.complete_task(&id, Some(&current)).unwrap(); }
                    else { db.connection.execute("UPDATE plan_blocks SET execution_status = 'not_started' WHERE id = ?1", [&current]).unwrap(); }
                    if state != "planned" {
                        database_results::freeze_block(&db.connection, &block).unwrap();
                        db.connection.execute("UPDATE plan_blocks SET execution_status = ?2, execution_note = 'original',
                            execution_captured_at = 'old', review_required = ?3 WHERE id = ?1",
                            params![block, if state == "reviewed" { "blocked" } else { state }, state != "reviewed"]).unwrap();
                    }
                    if state == "reviewed" {
                        db.connection.execute("INSERT INTO review_entries(id,review_date,plan_block_id,task_id,outcome,
                            actual_minutes,defer_reason,notes,remaining_workload_minutes,followup_action,created_at,updated_at)
                            VALUES (?1,?2,?1,?3,'blocked',17,'independent reason','original',55,'wait','old','old')",
                            params![block,date,id]).unwrap();
                        db.connection.execute("UPDATE plan_blocks SET actual_minutes = 17 WHERE id = ?1", [&block]).unwrap();
                    }
                    db.connection.execute("INSERT OR REPLACE INTO review_form_drafts(review_date,item_type,item_id,payload_json,revision,updated_at)
                        VALUES (?1,'task',?2,'{\"actual_minutes\":\"42\",\"remaining_workload_minutes\":\"99\"}',1,'old')", params![date,block]).unwrap();
                    let untouched = task_side_effects(&db, &id, &block);
                    let independent = fact_rows(&db.connection, "SELECT id,actual_minutes,defer_reason,remaining_workload_minutes,
                        followup_action,created_at,updated_at FROM review_entries WHERE plan_block_id = ?1", &block).unwrap();
                    let mut completed = state == "completed";
                    for (index, outcome) in [ReviewOutcome::NotStarted, ReviewOutcome::Partial, ReviewOutcome::Blocked,
                        ReviewOutcome::Cancelled, ReviewOutcome::NotStarted, ReviewOutcome::Completed, ReviewOutcome::Completed].into_iter().enumerate() {
                        let note = if index == 6 { None } else { Some(format!("correction {index}")) };
                        let before = result_facts(&db, &id);
                        let result = correct_result(&mut db, action, date, &id, &block, outcome, note.clone());
                        if completed && outcome != ReviewOutcome::Completed {
                            assert!(result.is_err(), "{date}/{done}/{state}/{action}/{index}");
                            assert_eq!(result_facts(&db, &id), before);
                            continue;
                        }
                        result.unwrap();
                        completed = outcome == ReviewOutcome::Completed;
                        assert_eq!(task_side_effects(&db, &id, &block), untouched, "{date}/{done}/{state}/{action}/{index}");
                        let schedule = db.get_day_schedule(date).unwrap();
                        let saved = schedule.task_blocks.iter().find(|value| value.id == block).unwrap();
                        assert_eq!(saved.execution_status, outcome.as_str());
                        assert_eq!(saved.execution_note, note);
                        assert_eq!(saved.starts_at, format!("{date}T23:00:00+08:00"));
                        assert_eq!(saved.ends_at, format!("{date}T23:30:00+08:00"));
                        // Daily completion statistics must follow the selected block/review, never the current task status.
                        assert_eq!(schedule.task_blocks.iter().filter(|value| value.execution_status == "completed").count(),
                            usize::from(outcome == ReviewOutcome::Completed));
                        assert_eq!(schedule.task_blocks.iter().filter_map(|value| value.actual_minutes).sum::<i64>(),
                            if state == "reviewed" { 17 } else { 0 });
                        if state == "reviewed" || action == "review" {
                            let saved_review = db.get_review_entry_for_block(&block).unwrap();
                            assert_eq!(saved_review.outcome, outcome.as_str());
                            assert_eq!(saved_review.notes, note);
                            if state == "reviewed" {
                                assert_eq!(fact_rows(&db.connection, "SELECT id,actual_minutes,defer_reason,remaining_workload_minutes,
                                    followup_action,created_at,updated_at FROM review_entries WHERE plan_block_id = ?1", &block).unwrap(), independent);
                                assert_eq!(saved.actual_minutes, Some(17));
                                assert!(!saved.review_required);
                            }
                        }
                        let payload: Option<String> = db.connection.query_row("SELECT payload_json FROM review_form_drafts
                            WHERE review_date = ?1 AND item_id = ?2", params![date,block], |row| row.get(0)).unwrap();
                        assert_eq!(payload, None, "history must not revive current-workload supplements");
                    }
                }
            }
        }
    }
}

#[test]
fn historical_clear_on_done_task_never_reopens_or_changes_other_dates() {
    let _clock = TestNow::new("2026-10-17T01:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let (id, block) = fixture(&mut db);
    let current = add_block(&db, &id, "2026-10-17", "2026-10-17T23:30:00+08:00");
    add_block(&db, &id, "2026-10-18", "2026-10-18T23:30:00+08:00");
    db.complete_task(&id, Some(&current)).unwrap();
    let before = task_side_effects(&db, &id, &block);
    for outcome in [ReviewOutcome::NotStarted, ReviewOutcome::Partial, ReviewOutcome::Blocked, ReviewOutcome::Cancelled, ReviewOutcome::Completed] {
        correct_result(&mut db, "capture", DATE, &id, &block, outcome, Some("history".into())).unwrap();
        let captured = result_facts(&db, &id);
        if outcome == ReviewOutcome::Completed {
            assert!(db.clear_execution_capture(DATE, &block).is_err());
            assert_eq!(result_facts(&db, &id), captured);
            assert_eq!(execution_snapshot(&db.connection, &block).unwrap().execution_status, "completed");
            assert_eq!(task_side_effects(&db, &id, &block), before);
            continue;
        }
        db.clear_execution_capture(DATE, &block).unwrap();
        assert_eq!(task_side_effects(&db, &id, &block), before);
        assert_eq!(execution_snapshot(&db.connection, &block).unwrap().execution_status, "planned");
    }
}

#[test]
fn historical_result_guards_reject_invalid_future_deleted_missing_and_mismatched_dates_atomically() {
    let _clock = TestNow::new("2026-10-17T01:00:00+08:00");
    for action in ["capture", "resolve", "review", "clear"] {
        for guard in ["invalid", "future", "wrong_date", "deleted", "deleted_at", "missing", "frozen_date"] {
            let mut db = Database::in_memory().unwrap();
            let (id, mut block) = fixture(&mut db);
            db.connection.execute("UPDATE plan_blocks SET execution_status = 'completed', execution_captured_at = 'old' WHERE id = ?1", [&block]).unwrap();
            let date = match guard {
                "invalid" => {
                    db.connection.execute("UPDATE daily_plans SET plan_date = '2026-02-30'", []).unwrap();
                    "2026-02-30"
                },
                "future" => {
                    db.connection.execute("UPDATE daily_plans SET plan_date = '2026-10-18'", []).unwrap();
                    "2026-10-18"
                },
                "wrong_date" => "2026-10-17",
                _ => DATE,
            };
            if guard == "deleted" { db.connection.execute("UPDATE tasks SET status = 'deleted' WHERE id = ?1", [&id]).unwrap(); }
            if guard == "deleted_at" { db.connection.execute("UPDATE tasks SET deleted_at = 'old' WHERE id = ?1", [&id]).unwrap(); }
            if guard == "missing" { block = "missing".into(); }
            if guard == "frozen_date" { db.connection.execute("UPDATE plan_blocks SET result_date = '2026-10-15' WHERE id = ?1", [&block]).unwrap(); }
            let before = fact_fingerprint(&db.connection, "task_completion", &id).unwrap();
            assert!(correct_result(&mut db, action, date, &id, &block, ReviewOutcome::NotStarted, None).is_err(), "{action}/{guard}");
            assert_eq!(fact_fingerprint(&db.connection, "task_completion", &id).unwrap(), before, "{action}/{guard}");
        }
    }
    let mut db = Database::in_memory().unwrap();
    let (_, block) = fixture(&mut db);
    let other = db.create_manual_task("wrong owner").unwrap();
    let before = fact_fingerprint(&db.connection, "task_completion", &other).unwrap();
    assert!(db.complete_task(&other, Some(&block)).is_err());
    assert_eq!(fact_fingerprint(&db.connection, "task_completion", &other).unwrap(), before);
}

#[test]
fn historical_resolution_rejects_followup_and_workload_and_preserves_version_guards() {
    let _clock = TestNow::new("2026-10-17T01:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let (id, block) = fixture(&mut db);
    for field in ["schedule", "wait", "stop", "start", "end", "workload", "stale"] {
        let mut input = resolution(&db, &id, &block, ReviewOutcome::Partial);
        match field {
            "schedule" | "wait" | "stop" => input.next_action = Some(field.into()),
            "start" => input.starts_at = Some("2026-10-17T12:00:00+08:00".into()),
            "end" => input.ends_at = Some("2026-10-17T13:00:00+08:00".into()),
            "workload" => input.remaining_workload_minutes = Some(30),
            "stale" => input.expected_task_updated_at = "stale".into(),
            _ => unreachable!(),
        }
        let before = fact_fingerprint(&db.connection, "task_completion", &id).unwrap();
        assert!(db.resolve_task_execution(DATE, input).is_err(), "{field}");
        assert_eq!(fact_fingerprint(&db.connection, "task_completion", &id).unwrap(), before);
    }
    // Remaining-workload edits are forbidden for both first historical reviews and existing reviews.
    for existing in [false, true] {
        if existing { db.save_review_entry(DATE, review(&block)).unwrap(); }
        let mut input = review(&block);
        input.remaining_workload_minutes = Some(75);
        let before = fact_fingerprint(&db.connection, "task_completion", &id).unwrap();
        assert!(db.save_review_entry(DATE, input).is_err());
        assert_eq!(fact_fingerprint(&db.connection, "task_completion", &id).unwrap(), before);
    }
}

#[test]
fn historical_review_result_corrections_roll_back_if_block_write_fails() {
    let _clock = TestNow::new("2026-11-17T01:00:00+08:00");
    for action in ["capture", "resolve", "review"] {
        let mut db = Database::in_memory().unwrap();
        let (id, block) = fixture(&mut db);
        db.save_review_entry(DATE, review(&block)).unwrap();
        db.connection.execute_batch("CREATE TRIGGER reject_result BEFORE UPDATE ON plan_blocks
            BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
        let before = fact_fingerprint(&db.connection, "task_completion", &id).unwrap();
        assert!(correct_result(&mut db, action, DATE, &id, &block, ReviewOutcome::Completed, Some("not committed".into())).is_err());
        assert_eq!(fact_fingerprint(&db.connection, "task_completion", &id).unwrap(), before, "{action}");
    }
}

fn assert_incomplete_classification(db: &mut Database, id: &str, expected: bool) {
    assert_eq!(db.get_task(id).unwrap().is_incomplete, expected, "single task");
    let listed = db.list_tasks(true, None).unwrap().into_iter().find(|task| task.id == id).unwrap();
    assert_eq!(listed.is_incomplete, expected, "task list");
    let transaction = db.connection.transaction().unwrap();
    assert_eq!(load_task_dto_in_transaction(&transaction, id).unwrap().is_incomplete, expected, "transaction");
}

#[test]
fn incomplete_classification_tracks_save_clear_completion_and_trash_without_changing_status() {
    let _clock = TestNow::new("2026-10-16T23:40:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let (id, block) = fixture(&mut db);
    db.connection.execute("UPDATE tasks SET status = 'scheduled', earliest_start_at = '2026-10-16T23:00:00+08:00', due_at = ?2 WHERE id = ?1", params![id, END]).unwrap();
    assert_incomplete_classification(&mut db, &id, false);
    let saved = db.resolve_task_execution(DATE, resolution(&db, &id, &block, ReviewOutcome::NotStarted)).unwrap();
    assert_eq!(saved.status, "scheduled", "classification must not rewrite lifecycle");
    assert!(saved.is_incomplete);
    assert_incomplete_classification(&mut db, &id, true);
    db.clear_execution_capture(DATE, &block).unwrap();
    assert_incomplete_classification(&mut db, &id, false);
    db.resolve_task_execution(DATE, resolution(&db, &id, &block, ReviewOutcome::NotStarted)).unwrap();
    db.complete_task(&id, Some(&block)).unwrap();
    assert_incomplete_classification(&mut db, &id, false);
    db.reopen_manual_task(&id, DATE).unwrap();
    assert_incomplete_classification(&mut db, &id, true);
    db.soft_delete_manual_task(&id, true).unwrap();
    assert_incomplete_classification(&mut db, &id, false);
    db.restore_task(&id).unwrap();
    assert_incomplete_classification(&mut db, &id, true);
}

#[test]
fn incomplete_classification_keeps_valid_later_schedules_but_not_recorded_or_expired_blocks() {
    let _clock = TestNow::new("2026-10-16T23:40:00+08:00");
    for kind in ["future", "same_day", "past", "captured", "actual", "reviewed", "draft"] {
        let mut db = Database::in_memory().unwrap();
        let (id, block) = fixture(&mut db);
        let date = if kind == "past" { "2026-10-15" } else if kind == "same_day" { DATE } else { "2026-10-17" };
        let pending = add_block(&db, &id, date, &format!("{date}T23:55:00+08:00"));
        db.connection.execute("UPDATE plan_blocks SET starts_at = ?2 WHERE id = ?1", params![pending, format!("{date}T23:40:00+08:00")]).unwrap();
        match kind {
            "captured" => { db.connection.execute("UPDATE plan_blocks SET execution_captured_at = 'recorded' WHERE id = ?1", [&pending]).unwrap(); },
            "actual" => { db.connection.execute("UPDATE plan_blocks SET actual_minutes = 15 WHERE id = ?1", [&pending]).unwrap(); },
            "reviewed" => {
                db.connection.execute("UPDATE plan_blocks SET execution_status = 'not_started' WHERE id = ?1", [&pending]).unwrap();
                db.connection.execute("INSERT INTO review_entries(id,review_date,plan_block_id,task_id,outcome,created_at,updated_at)
                    VALUES (?1,?2,?1,?3,'not_started','old','old')", params![pending, date, id]).unwrap();
            },
            "draft" => { db.connection.execute("UPDATE daily_plans SET status = 'draft' WHERE id = (SELECT daily_plan_id FROM plan_blocks WHERE id = ?1)", [&pending]).unwrap(); },
            _ => {},
        }
        db.resolve_task_execution(DATE, resolution(&db, &id, &block, ReviewOutcome::NotStarted)).unwrap();
        assert_incomplete_classification(&mut db, &id, !matches!(kind, "future" | "same_day"));
        if kind == "future" {
            let _later = TestNow::new("2026-10-18T12:00:00+08:00");
            assert_incomplete_classification(&mut db, &id, true);
        }
    }
}

#[test]
fn incomplete_classification_uses_latest_execution_not_backfill_order_and_does_not_transfer_to_new_tasks() {
    let _clock = TestNow::new("2026-10-17T23:40:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let (id, old) = fixture(&mut db);
    let recent = add_block(&db, &id, "2026-10-17", "2026-10-17T23:30:00+08:00");
    db.save_execution_capture("2026-10-17", ExecutionCaptureInput { plan_block_id: recent.clone(), outcome: Some(ReviewOutcome::Completed), note: None }).unwrap();
    db.resolve_task_execution(DATE, resolution(&db, &id, &old, ReviewOutcome::NotStarted)).unwrap();
    assert_incomplete_classification(&mut db, &id, false);
    for outcome in [ReviewOutcome::NotStarted, ReviewOutcome::Partial, ReviewOutcome::Blocked, ReviewOutcome::Cancelled] {
        db.save_execution_capture("2026-10-17", ExecutionCaptureInput { plan_block_id: recent.clone(), outcome: Some(outcome), note: None }).unwrap();
        assert_incomplete_classification(&mut db, &id, true);
    }
    let new_id = db.create_manual_task("独立任务").unwrap();
    assert_incomplete_classification(&mut db, &new_id, false);
    assert_incomplete_classification(&mut db, &id, true);
    // Old durable undo snapshots deserialize without the newly derived DTO field.
    let mut legacy = serde_json::to_value(db.get_task(&id).unwrap()).unwrap();
    legacy.as_object_mut().unwrap().remove("is_incomplete");
    assert!(!serde_json::from_value::<TaskDto>(legacy).unwrap().is_incomplete);
}

#[test]
fn latest_historical_done_to_incomplete_is_rejected_by_all_apis_and_readers_stay_done() {
    for action in ["capture", "resolve", "review"] {
        for reviewed in [false, true] {
            for time in ["2026-10-17T01:00:00+08:00", "2027-01-01T12:00:00+08:00"] {
                let mut db = Database::in_memory().unwrap();
                let (id, block) = {
                    let _clock = TestNow::new("2026-10-16T23:40:00+08:00");
                    let (id, block) = fixture(&mut db);
                    db.connection.execute("UPDATE tasks SET notes = '任务备注', earliest_start_at = '2026-10-16T23:00:00+08:00', due_at = ?2 WHERE id = ?1", params![id, END]).unwrap();
                    db.set_task_tags(&id, vec!["原标签".into()]).unwrap();
                    if reviewed { db.save_review_entry(DATE, review(&block)).unwrap(); }
                    db.resolve_task_execution(DATE, resolution(&db, &id, &block, ReviewOutcome::Completed)).unwrap();
                    (id, block)
                };
                let _clock = TestNow::new(time);
                let original = db.get_task(&id).unwrap();
                let stale_undo: Option<String> = db.connection.query_row("SELECT id FROM undo_entries WHERE target_type = 'execution_capture' AND target_id = ?1 ORDER BY rowid DESC LIMIT 1", [&id], |row| row.get(0)).optional().unwrap();
                let before = result_facts(&db, &id);
                assert!(correct_result(&mut db, action, DATE, &id, &block, ReviewOutcome::NotStarted, Some("改为未完成".into())).is_err());
                assert_eq!(result_facts(&db, &id), before, "{action}/{reviewed}/{time}");
                let saved = db.get_task(&id).unwrap();
                assert_eq!(saved.status, "done", "{action}/{reviewed}/{time}");
                assert_eq!(saved.remaining_workload_minutes, Some(0));
                assert_eq!(saved.notes, original.notes);
                assert_eq!(saved.tags, original.tags);
                assert_eq!(saved.earliest_start_at, original.earliest_start_at);
                assert_eq!(saved.due_at, original.due_at);
                assert_eq!(saved.result_date.as_deref(), Some(DATE));
                assert_eq!(saved.result_ends_at.as_deref(), Some(END));
                assert!(saved.execution_locked);
                assert_incomplete_classification(&mut db, &id, false);
                let listed = db.list_tasks(true, None).unwrap().into_iter().find(|task| task.id == id).unwrap();
                assert_eq!(listed.status, saved.status);
                let block = db.get_day_schedule(DATE).unwrap().task_blocks.remove(0);
                assert_eq!(block.task_status, saved.status);
                assert_eq!(block.execution_status, "completed");
                assert_eq!(block.execution_note.as_deref(), Some("结果备注"));
                if let Some(stale_undo) = stale_undo {
                    assert!(db.apply_undo(&stale_undo).is_err());
                    assert_eq!(result_facts(&db, &id), before);
                }
                assert_eq!(db.get_task(&id).unwrap().status, "done");
            }
        }
    }
}

#[test]
fn earlier_same_day_correction_cannot_override_a_later_execution() {
    for completed in [false, true] {
        let mut db = Database::in_memory().unwrap();
        let (id, old) = {
            let _clock = TestNow::new("2026-10-16T23:40:00+08:00");
            let (id, old) = fixture(&mut db);
            db.connection.execute("UPDATE plan_blocks SET starts_at = '2026-10-16T09:00:00+08:00', ends_at = '2026-10-16T10:00:00+08:00' WHERE id = ?1", [&old]).unwrap();
            let recent = add_block(&db, &id, DATE, END);
            db.resolve_task_execution(DATE, resolution(&db, &id, &recent, if completed { ReviewOutcome::Completed } else { ReviewOutcome::NotStarted })).unwrap();
            (id, old)
        };
        let _clock = TestNow::new("2026-10-18T12:00:00+08:00");
        let before = task_side_effects(&db, &id, &old);
        for action in ["capture", "resolve", "review"] {
            correct_result(&mut db, action, DATE, &id, &old, if completed { ReviewOutcome::NotStarted } else { ReviewOutcome::Completed }, None).unwrap();
            assert_eq!(task_side_effects(&db, &id, &old), before, "{action}/{completed}");
        }
    }
}

#[test]
fn historical_task_sync_failure_rolls_back_result_review_and_audit() {
    for action in ["capture", "resolve", "review"] {
        let mut db = Database::in_memory().unwrap();
        let (id, block) = {
            let _clock = TestNow::new("2026-10-16T23:40:00+08:00");
            let (id, block) = fixture(&mut db);
            db.save_review_entry(DATE, review(&block)).unwrap();
            db.resolve_task_execution(DATE, resolution(&db, &id, &block, ReviewOutcome::NotStarted)).unwrap();
            (id, block)
        };
        let _clock = TestNow::new("2026-10-18T12:00:00+08:00");
        db.connection.execute_batch("CREATE TRIGGER reject_task_sync BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
        let before = fact_fingerprint(&db.connection, "task_completion", &id).unwrap();
        let effects = task_side_effects(&db, &id, &block);
        let error = correct_result(&mut db, action, DATE, &id, &block, ReviewOutcome::Completed, None).unwrap_err();
        assert!(error.to_string().contains("test failure"), "must exercise transaction rollback: {error}");
        assert_eq!(fact_fingerprint(&db.connection, "task_completion", &id).unwrap(), before);
        assert_eq!(task_side_effects(&db, &id, &block), effects);
    }
}

#[test]
fn historical_sync_preserves_later_no_block_completion_and_handles_legacy_missing_snapshots() {
    let mut db = Database::in_memory().unwrap();
    let id = {
        let _clock = TestNow::new("2026-10-17T23:40:00+08:00");
        let id = db.create_manual_task("独立整项完成").unwrap();
        db.complete_task(&id, None).unwrap();
        id
    };
    let _clock = TestNow::new("2026-10-18T12:00:00+08:00");
    let old = add_block(&db, &id, DATE, END);
    let before = task_side_effects(&db, &id, &old);
    db.save_execution_capture(DATE, ExecutionCaptureInput { plan_block_id: old.clone(), outcome: Some(ReviewOutcome::NotStarted), note: None }).unwrap();
    assert_eq!(task_side_effects(&db, &id, &old), before);
    let (legacy, block) = fixture(&mut db);
    db.connection.execute("UPDATE tasks SET status = 'done', remaining_workload_minutes = 0 WHERE id = ?1", [&legacy]).unwrap();
    db.save_execution_capture(DATE, ExecutionCaptureInput { plan_block_id: block, outcome: Some(ReviewOutcome::NotStarted), note: None }).unwrap();
    assert_eq!(db.get_task(&legacy).unwrap().remaining_workload_minutes, Some(0));
    assert_eq!(db.get_task(&legacy).unwrap().status, "done");
    assert_incomplete_classification(&mut db, &legacy, false);
}

#[test]
fn historical_sync_protects_legacy_explicit_completion_without_durable_snapshot() {
    let mut db = Database::in_memory().unwrap();
    let (id, block) = {
        let _clock = TestNow::new("2026-10-16T23:40:00+08:00");
        let (id, block) = fixture(&mut db);
        db.complete_task(&id, Some(&block)).unwrap();
        db.connection.execute("DELETE FROM task_completion_snapshots WHERE task_id = ?1", [&id]).unwrap();
        (id, block)
    };
    let _clock = TestNow::new("2026-10-18T12:00:00+08:00");
    let before = result_facts(&db, &id);
    assert!(db.save_execution_capture(DATE, ExecutionCaptureInput { plan_block_id: block, outcome: Some(ReviewOutcome::NotStarted), note: None }).is_err());
    assert_eq!(result_facts(&db, &id), before);
    assert_eq!(db.get_task(&id).unwrap().remaining_workload_minutes, Some(0));
    assert_eq!(db.get_task(&id).unwrap().status, "done");
    assert_incomplete_classification(&mut db, &id, false);
}

#[test]
fn note_only_capture_keeps_current_outcome_and_records_an_execution_event() {
    let _clock = TestNow::new("2026-10-16T12:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let (id, block) = fixture(&mut db);
    let status_before = execution_snapshot(&db.connection, &block).unwrap().execution_status;
    assert_eq!(status_before, "planned");

    // A note-only save keeps the planned status while persisting the note as an execution fact.
    db.save_execution_capture(DATE, ExecutionCaptureInput { plan_block_id: block.clone(), outcome: None, note: Some("随手记一句".into()) }).unwrap();
    let snapshot = execution_snapshot(&db.connection, &block).unwrap();
    assert_eq!(snapshot.execution_status, "planned", "note-only must not change the outcome");
    assert_eq!(snapshot.execution_note.as_deref(), Some("随手记一句"));
    assert!(snapshot.execution_captured_at.is_some(), "note-only must record an execution timestamp");

    let history = db.get_task_metadata(&id).unwrap().history;
    assert!(history.iter().any(|event| event.kind == "note" && event.status.is_none() && event.note.as_deref() == Some("随手记一句")), "note-only history must name the note action, not an incomplete outcome");
    db.save_execution_capture(DATE, ExecutionCaptureInput { plan_block_id: block.clone(), outcome: Some(ReviewOutcome::Completed), note: Some("完成备注".into()) }).unwrap();
    let history = db.get_task_metadata(&id).unwrap().history;
    assert!(history.iter().any(|event| event.kind == "note" && event.status.is_none() && event.note.as_deref() == Some("随手记一句")), "archiving must retain the note action");
    assert!(history.iter().any(|event| event.kind == "execution" && event.status.as_deref() == Some("done")), "completion must remain a result action");
}
