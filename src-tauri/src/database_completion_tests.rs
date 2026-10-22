use super::*;

const FIRST: &str = "2026-10-21";
const SECOND: &str = "2026-10-22";

fn task(db: &mut Database) -> String {
    let id = db.create_manual_task("跨日完成分离").unwrap();
    db.connection.execute("UPDATE tasks SET status = 'scheduled', total_workload_minutes = 120,
        remaining_workload_minutes = 75, notes = 'task note' WHERE id = ?1", [&id]).unwrap();
    id
}

fn block(db: &Database, task: &str, date: &str, hour: &str) -> String {
    let plan: String = db.connection.query_row("SELECT id FROM daily_plans WHERE plan_date = ?1 AND status = 'confirmed'",
        [date], |row| row.get(0)).optional().unwrap().unwrap_or_else(|| {
        let id = Uuid::new_v4().to_string();
        db.connection.execute("INSERT INTO daily_plans(id,plan_date,status,source,created_at,confirmed_at)
            VALUES (?1,?2,'confirmed','manual',?3,?3)", params![id,date,now()]).unwrap();
        id
    });
    let id = Uuid::new_v4().to_string();
    db.connection.execute("INSERT INTO plan_blocks(id,daily_plan_id,task_id,starts_at,ends_at,source,created_at,updated_at)
        VALUES (?1,?2,?3,?4,?5,'manual',?6,?6)",
        params![id,plan,task,format!("{date}T{hour}:00:00+08:00"),format!("{date}T{hour}:30:00+08:00"),now()]).unwrap();
    id
}

fn request(db: &Database, task: &str, block: &str, outcome: ReviewOutcome) -> TaskExecutionResolutionInput {
    TaskExecutionResolutionInput { plan_block_id: block.into(), expected_task_updated_at: db.get_task(task).unwrap().updated_at,
        outcome, note: Some("block note".into()), next_action: None, starts_at: None, ends_at: None, remaining_workload_minutes: None }
}

fn write(db: &mut Database, api: &str, date: &str, task: &str, block: &str, outcome: ReviewOutcome) -> AppResult<()> {
    match api {
        "resolve" => db.resolve_task_execution(date, request(db,task,block,outcome)).map(|_| ()),
        "capture" => db.save_execution_capture(date, ExecutionCaptureInput { plan_block_id: block.into(), outcome, note: Some("block note".into()) }),
        "review" => db.save_review_entry(date, ReviewEntryInput { plan_block_id: block.into(), outcome,
            actual_minutes: None, defer_reason: None, notes: Some("block note".into()), remaining_workload_minutes: None }).map(|_| ()),
        _ => unreachable!(),
    }
}

fn rows(db: &Database, block: &str) -> Vec<Vec<String>> {
    fact_rows(&db.connection, "SELECT * FROM plan_blocks WHERE id = ?1", block).unwrap()
}

fn assert_state(db: &Database, task: &str, done: bool) {
    let task = db.get_task(task).unwrap();
    assert_eq!(task.status, if done { "done" } else { "scheduled" });
    assert_eq!(task.remaining_workload_minutes, Some(if done { 0 } else { 75 }));
    assert_eq!(task.notes.as_deref(), Some("task note"));
}

#[test]
fn day_21_completion_retains_day_22_and_only_all_confirmed_blocks_auto_complete() {
    for api in ["resolve", "capture", "review"] {
        let mut db = Database::in_memory().unwrap();
        let _clock = TestNow::new("2026-10-21T18:00:00+08:00");
        let id = task(&mut db);
        let first = block(&db,&id,FIRST,"09");
        let second = block(&db,&id,SECOND,"09");
        let untouched = rows(&db,&second);
        write(&mut db,api,FIRST,&id,&first,ReviewOutcome::Completed).unwrap();
        assert_state(&db,&id,false);
        assert_eq!(rows(&db,&second),untouched,"{api} must retain future schedule");
        assert_eq!(db.get_day_schedule(SECOND).unwrap().task_blocks.len(),1);
        let _next = TestNow::new("2026-10-22T18:00:00+08:00");
        write(&mut db,api,SECOND,&id,&second,ReviewOutcome::Completed).unwrap();
        assert_state(&db,&id,true);
        assert!(database_execution::is_automatic_completion(&db.connection,&id).unwrap());
    }
}

#[test]
fn missed_history_and_other_same_day_blocks_each_prevent_auto_completion() {
    for api in ["resolve", "capture", "review"] {
        for other_date in [FIRST,SECOND] {
            let _clock = TestNow::new("2026-10-22T18:00:00+08:00");
            let mut db = Database::in_memory().unwrap();
            let id = task(&mut db);
            let other = block(&db,&id,other_date,"09");
            let latest = block(&db,&id,SECOND,"15");
            write(&mut db,api,SECOND,&id,&latest,ReviewOutcome::Completed).unwrap();
            assert_state(&db,&id,false);
            write(&mut db,api,other_date,&id,&other,ReviewOutcome::Completed).unwrap();
            assert_state(&db,&id,true);
        }
    }
}

#[test]
fn historical_nonlatest_cancellation_reopens_auto_without_replaying_notes_or_review_metadata() {
    for api in ["resolve", "capture", "review"] {
        let _clock = TestNow::new("2026-10-22T18:00:00+08:00");
        let mut db = Database::in_memory().unwrap();
        let id = task(&mut db);
        let first = block(&db,&id,FIRST,"09");
        let second = block(&db,&id,SECOND,"15");
        let original = db.save_review_entry(FIRST,ReviewEntryInput { plan_block_id:first.clone(), outcome:ReviewOutcome::Completed,
            actual_minutes:Some(23), defer_reason:Some("independent reason".into()), notes:Some("old review note".into()),
            remaining_workload_minutes:None }).unwrap();
        write(&mut db,"capture",SECOND,&id,&second,ReviewOutcome::Completed).unwrap();
        assert_state(&db,&id,true);
        let other_block = rows(&db,&second);
        let _late = TestNow::new("2027-02-01T18:00:00+08:00");
        write(&mut db,api,FIRST,&id,&first,ReviewOutcome::NotStarted).unwrap();
        assert_state(&db,&id,false);
        assert_eq!(rows(&db,&second),other_block);
        let corrected = db.get_review_entry_for_block(&first).unwrap();
        assert_eq!(corrected.outcome,"not_started");
        assert_eq!(corrected.notes.as_deref(),Some("block note"));
        assert_eq!(corrected.actual_minutes,original.actual_minutes);
        assert_eq!(corrected.defer_reason,original.defer_reason);
        assert_eq!(corrected.remaining_workload_minutes,original.remaining_workload_minutes);
        assert_eq!(corrected.created_at,original.created_at);
        assert_eq!(corrected.updated_at,original.updated_at);
        write(&mut db,api,FIRST,&id,&first,ReviewOutcome::Completed).unwrap();
        assert_state(&db,&id,true);
    }
}

#[test]
fn clearing_nonlatest_historical_capture_reopens_auto_and_preserves_other_block() {
    let _clock = TestNow::new("2026-10-22T18:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let id = task(&mut db);
    let first = block(&db,&id,FIRST,"09");
    let second = block(&db,&id,SECOND,"15");
    write(&mut db,"capture",FIRST,&id,&first,ReviewOutcome::Completed).unwrap();
    write(&mut db,"capture",SECOND,&id,&second,ReviewOutcome::Completed).unwrap();
    let other = rows(&db,&second);
    let _late = TestNow::new("2027-02-01T18:00:00+08:00");
    db.clear_execution_capture(FIRST,&first).unwrap();
    assert_state(&db,&id,false);
    assert_eq!(rows(&db,&second),other);
    assert_eq!(execution_snapshot(&db.connection,&first).unwrap().execution_status,"planned");
}

#[test]
fn explicit_early_completion_protects_global_done_for_all_daily_corrections_and_clear() {
    for api in ["resolve", "capture", "review", "clear"] {
        for historical in [false,true] {
            let _clock = TestNow::new("2026-10-21T18:00:00+08:00");
            let mut db = Database::in_memory().unwrap();
            let id = task(&mut db);
            let first = block(&db,&id,FIRST,"09");
            let future = block(&db,&id,SECOND,"15");
            let future_before = rows(&db,&future);
            db.complete_task(&id,Some(&first)).unwrap();
            assert!(!database_execution::is_automatic_completion(&db.connection,&id).unwrap());
            let _late = historical.then(|| TestNow::new("2027-02-01T18:00:00+08:00"));
            if api == "clear" { db.clear_execution_capture(FIRST,&first).unwrap(); }
            else { write(&mut db,api,FIRST,&id,&first,ReviewOutcome::NotStarted).unwrap(); }
            assert_state(&db,&id,true);
            assert_eq!(rows(&db,&future),future_before);
            if !historical {
                db.reopen_manual_task(&id,FIRST).unwrap();
                assert_state(&db,&id,false);
                assert_eq!(execution_snapshot(&db.connection,&first).unwrap().execution_status,
                    if api == "clear" { "planned" } else { "not_started" });
            } else {
                assert!(db.reopen_manual_task(&id,FIRST).is_err(),"explicit result window stays unchanged");
            }
        }
    }
}

#[test]
fn capture_undo_reopens_auto_and_explicit_promotion_invalidates_that_undo() {
    for promote in [false,true] {
        let _clock = TestNow::new("2026-10-21T18:00:00+08:00");
        let mut db = Database::in_memory().unwrap();
        let id = task(&mut db);
        let first = block(&db,&id,FIRST,"09");
        write(&mut db,"capture",FIRST,&id,&first,ReviewOutcome::Completed).unwrap();
        let undo = db.latest_undo().unwrap().unwrap();
        if promote {
            db.transition_manual_task(&id,TaskStatus::Done).unwrap();
            assert!(!database_execution::is_automatic_completion(&db.connection,&id).unwrap());
            assert!(db.apply_undo(&undo.id).is_err());
            write(&mut db,"capture",FIRST,&id,&first,ReviewOutcome::NotStarted).unwrap();
            assert_state(&db,&id,true);
            db.reopen_manual_task(&id,FIRST).unwrap();
            assert_state(&db,&id,false);
        } else {
            db.apply_undo(&undo.id).unwrap();
            assert_state(&db,&id,false);
            assert_eq!(execution_snapshot(&db.connection,&first).unwrap().execution_status,"planned");
        }
    }
}

#[test]
fn completion_provenance_survives_reload_trash_restore_and_explicit_completion_undo() {
    let _clock = TestNow::new("2026-10-21T18:00:00+08:00");
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("completion.sqlite");
    let (automatic,auto_block,explicit,explicit_block) = {
        let mut db = Database::open(&path).unwrap();
        let automatic = task(&mut db);
        let auto_block = block(&db,&automatic,FIRST,"09");
        write(&mut db,"capture",FIRST,&automatic,&auto_block,ReviewOutcome::Completed).unwrap();
        db.soft_delete_manual_task(&automatic,true).unwrap();
        let explicit = task(&mut db);
        let explicit_block = block(&db,&explicit,FIRST,"15");
        db.complete_task(&explicit,Some(&explicit_block)).unwrap();
        let undo = db.latest_undo().unwrap().unwrap();
        db.apply_undo(&undo.id).unwrap();
        assert_state(&db,&explicit,false);
        db.complete_task(&explicit,Some(&explicit_block)).unwrap();
        db.soft_delete_manual_task(&explicit,true).unwrap();
        (automatic,auto_block,explicit,explicit_block)
    };
    let _late = TestNow::new("2027-02-01T18:00:00+08:00");
    let mut db = Database::open(&path).unwrap();
    for id in [&automatic,&explicit] { db.restore_task(id).unwrap(); }
    for (id,block) in [(&automatic,&auto_block),(&explicit,&explicit_block)] {
        db.clear_execution_capture(FIRST,block).unwrap();
        assert_state(&db,id,id == &explicit);
    }
}

#[test]
fn aggregation_prefers_review_outcome_and_ignores_unconfirmed_plans() {
    let _clock = TestNow::new("2026-10-22T18:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let id = task(&mut db);
    let old = block(&db,&id,FIRST,"09");
    let latest = block(&db,&id,SECOND,"15");
    write(&mut db,"review",FIRST,&id,&old,ReviewOutcome::NotStarted).unwrap();
    db.connection.execute("UPDATE plan_blocks SET execution_status = 'completed' WHERE id = ?1",[&old]).unwrap();
    write(&mut db,"capture",SECOND,&id,&latest,ReviewOutcome::Completed).unwrap();
    assert_state(&db,&id,false);
    let draft = block(&db,&id,"2026-10-23","09");
    db.connection.execute("UPDATE daily_plans SET status = 'draft' WHERE id = (SELECT daily_plan_id FROM plan_blocks WHERE id = ?1)",[&draft]).unwrap();
    write(&mut db,"review",FIRST,&id,&old,ReviewOutcome::Completed).unwrap();
    assert_state(&db,&id,true);
}

#[test]
fn invalid_future_deleted_stale_and_failed_aggregate_writes_are_atomic() {
    for api in ["resolve", "capture", "review", "clear"] {
        for case in ["future","deleted","date","missing","trigger"] {
            let _clock = TestNow::new("2026-10-22T18:00:00+08:00");
            let mut db = Database::in_memory().unwrap();
            let id = task(&mut db);
            let selected = block(&db,&id,FIRST,"09");
            write(&mut db,"capture",FIRST,&id,&selected,ReviewOutcome::Completed).unwrap();
            let mut date = FIRST;
            let mut target = selected.clone();
            match case {
                "future" => { date = "2026-10-23"; target = block(&db,&id,date,"09"); },
                "deleted" => db.soft_delete_manual_task(&id,true).unwrap(),
                "date" => date = SECOND,
                "missing" => target = "missing".into(),
                "trigger" => db.connection.execute_batch("CREATE TRIGGER fail_aggregate BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT,'aggregate failure'); END;").unwrap(),
                _ => unreachable!(),
            }
            let before = fact_fingerprint(&db.connection,"task_completion",&id).unwrap();
            let snapshot = fact_rows(&db.connection,"SELECT * FROM task_completion_snapshots WHERE task_id = ?1",&id).unwrap();
            let result = if api == "clear" { db.clear_execution_capture(date,&target) }
                else { write(&mut db,api,date,&id,&target,ReviewOutcome::NotStarted) };
            assert!(result.is_err(),"{api}/{case}");
            assert_eq!(fact_fingerprint(&db.connection,"task_completion",&id).unwrap(),before,"{api}/{case}");
            assert_eq!(fact_rows(&db.connection,"SELECT * FROM task_completion_snapshots WHERE task_id = ?1",&id).unwrap(),snapshot);
            let mut stale = request(&db,&id,&selected,ReviewOutcome::Completed);
            stale.expected_task_updated_at = "stale".into();
            assert!(db.resolve_task_execution(FIRST,stale).is_err());
            assert_eq!(fact_fingerprint(&db.connection,"task_completion",&id).unwrap(),before);
        }
    }
}

#[test]
fn daily_review_zero_estimate_does_not_zero_task_with_pending_blocks() {
    let _clock = TestNow::new("2026-10-21T18:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let id = task(&mut db);
    let first = block(&db,&id,FIRST,"09");
    block(&db,&id,SECOND,"09");
    let saved = db.save_review_entry(FIRST,ReviewEntryInput { plan_block_id:first, outcome:ReviewOutcome::Completed,
        actual_minutes:Some(0), defer_reason:None, notes:None, remaining_workload_minutes:Some(0) }).unwrap();
    assert_eq!(saved.remaining_workload_minutes,Some(0),"daily review metadata stays intact");
    assert_state(&db,&id,false);
}

#[test]
fn automatic_cancellation_restores_unknown_workload_without_inventing_an_estimate() {
    let _clock = TestNow::new("2026-10-21T18:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let id = task(&mut db);
    db.connection.execute("UPDATE tasks SET remaining_workload_minutes = NULL WHERE id = ?1",[&id]).unwrap();
    let first = block(&db,&id,FIRST,"09");
    write(&mut db,"capture",FIRST,&id,&first,ReviewOutcome::Completed).unwrap();
    let _late = TestNow::new("2027-02-01T18:00:00+08:00");
    db.clear_execution_capture(FIRST,&first).unwrap();
    let reopened = db.get_task(&id).unwrap();
    assert_eq!(reopened.status,"scheduled");
    assert_eq!(reopened.remaining_workload_minutes,None);
}

#[test]
fn failed_auto_completion_rolls_back_its_new_snapshot_block_review_and_estimates() {
    for api in ["resolve","capture","review"] {
        let _clock = TestNow::new("2026-10-22T18:00:00+08:00");
        let mut db = Database::in_memory().unwrap();
        let id = task(&mut db);
        let first = block(&db,&id,FIRST,"09");
        let before = fact_fingerprint(&db.connection,"task_completion",&id).unwrap();
        db.connection.execute_batch("CREATE TRIGGER fail_auto_completion BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT,'auto failure'); END;").unwrap();
        assert!(write(&mut db,api,FIRST,&id,&first,ReviewOutcome::Completed).is_err());
        assert_eq!(fact_fingerprint(&db.connection,"task_completion",&id).unwrap(),before);
        assert!(fact_rows(&db.connection,"SELECT * FROM task_completion_snapshots WHERE task_id = ?1",&id).unwrap().is_empty());
    }
}

fn confirmed_cross_day_draft(db: &mut Database, due: &str) -> String {
    let draft = db.create_manual_task_draft(TaskDraftInput {
        item_type: "task".into(), recurring_settings: None, title: "真实跨日草稿".into(), notes: Some("task note".into()),
        priority: Some(Priority::Medium), earliest_start_date: Some(FIRST.into()), earliest_start_time: Some("09:00".into()),
        due_date: Some(due.into()), due_time: Some("18:00".into()), total_workload_minutes: Some(120),
        remaining_workload_minutes: Some(75), field_states_json: "{}".into(), tags: vec![], recurrence: None,
    }).unwrap();
    let task = db.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
    assert_eq!(task.status, "open");
    assert!(db.get_day_schedule(FIRST).unwrap().task_blocks.is_empty());
    assert!(db.get_day_schedule(due).unwrap().task_blocks.is_empty(), "cross-day confirmation does not materialize dates");
    task.id
}

fn plan_day(db: &mut Database, id: &str, date: &str, flow: &str) -> String {
    let task = db.get_task(id).unwrap();
    let proposed = RulePlanBlock { task_id: id.into(), task_title: task.title.clone(),
        starts_at: format!("{date}T09:00:00+08:00"), ends_at: format!("{date}T09:30:00+08:00"), estimated_minutes: 30 };
    let schedule = if flow == "direct" {
        db.include_plan_task(PlanTaskInclude { plan_date: date.into(), task_id: id.into(),
            expected_updated_at: task.updated_at, expected_reserved_minutes: task.reserved_minutes, blocks: vec![proposed] }).unwrap()
    } else if flow == "rule" {
        let preview = db.preview_rule_based_plan(date).unwrap();
        assert!(preview.blocks.iter().any(|block| block.task_id == id));
        assert!(db.get_day_schedule(date).unwrap().task_blocks.is_empty());
        db.confirm_rule_based_plan(preview).unwrap()
    } else {
        let preview = db.start_manual_plan_draft(date).unwrap();
        assert!(preview.unscheduled.iter().any(|item| item.task_id == id));
        let edited = db.update_rule_plan_draft(&preview.preview_id, preview.version, vec![proposed], vec![]).unwrap();
        assert!(db.get_day_schedule(date).unwrap().task_blocks.is_empty(), "plan draft is not a confirmed block");
        db.confirm_rule_based_plan(edited).unwrap()
    };
    schedule.task_blocks.into_iter().find(|block| block.task_id == id).unwrap().id
}

#[test]
fn real_cross_day_creation_and_daily_planning_keep_unscheduled_future_and_auto_complete_only_all_results() {
    for flow in ["direct", "draft", "rule"] {
        for api in ["resolve", "capture", "review"] {
            for plan_future_first in [false, true] {
                let _clock = TestNow::new("2026-10-21T18:00:00+08:00");
                let mut db = Database::in_memory().unwrap();
                let id = confirmed_cross_day_draft(&mut db, SECOND);
                let first = plan_day(&mut db, &id, FIRST, flow);
                let second = plan_future_first.then(|| plan_day(&mut db, &id, SECOND, flow));
                let future = second.as_ref().map(|id| rows(&db, id));
                write(&mut db, api, FIRST, &id, &first, ReviewOutcome::Completed).unwrap();
                assert_state(&db, &id, false);
                assert!(db.list_tasks(false, None).unwrap().iter().any(|task| task.id == id && task.status != "done"));
                if let Some(second) = &second {
                    assert_eq!(rows(&db, second), future.unwrap());
                    assert_eq!(db.get_day_schedule(SECOND).unwrap().task_blocks.len(), 1);
                } else {
                    assert_eq!(db.count("plan_blocks").unwrap(), 1, "no automatic date materialization");
                    let preview = db.start_manual_plan_draft(SECOND).unwrap();
                    assert!(preview.unscheduled.iter().any(|item| item.task_id == id), "future remains available for daily planning");
                    db.discard_rule_plan_draft(&preview.preview_id, preview.version).unwrap();
                }
                let second = second.unwrap_or_else(|| plan_day(&mut db, &id, SECOND, flow));
                let _next = TestNow::new("2026-10-22T18:00:00+08:00");
                write(&mut db, api, SECOND, &id, &second, ReviewOutcome::Completed).unwrap();
                assert_state(&db, &id, true);
            }
        }
    }
}

#[test]
fn a_draft_or_a_later_reservation_does_not_hide_an_unplanned_future_date() {
    let _clock = TestNow::new("2026-10-21T18:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let id = confirmed_cross_day_draft(&mut db, "2026-10-23");
    let first = plan_day(&mut db, &id, FIRST, "direct");
    let last = plan_day(&mut db, &id, "2026-10-23", "direct");
    db.connection.execute("UPDATE plan_blocks SET execution_status = 'completed' WHERE id = ?1", [&last]).unwrap();
    db.start_manual_plan_draft(SECOND).unwrap();
    write(&mut db, "capture", FIRST, &id, &first, ReviewOutcome::Completed).unwrap();
    assert_state(&db, &id, false);
}

#[test]
fn reviewed_completion_clear_preserves_supplement_and_other_dates_without_a_planned_final_review() {
    for explicit in [false, true] {
        for historical in [false, true] {
            let _clock = TestNow::new("2026-10-22T18:00:00+08:00");
            let mut db = Database::in_memory().unwrap();
            let id = task(&mut db);
            let first = block(&db, &id, FIRST, "09");
            let second = block(&db, &id, SECOND, "09");
            write(&mut db, "review", FIRST, &id, &first, ReviewOutcome::Completed).unwrap();
            let saved = db.save_review_entry(SECOND, ReviewEntryInput { plan_block_id: second.clone(), outcome: ReviewOutcome::Completed,
                actual_minutes: Some(23), defer_reason: Some("independent reason".into()), notes: Some("independent notes".into()),
                remaining_workload_minutes: Some(45) }).unwrap();
            assert_eq!(db.get_task(&id).unwrap().actual_minutes, 23);
            if explicit { db.complete_task(&id, Some(&second)).unwrap(); }
            let other = rows(&db, &first);
            let old_revision: i64 = db.connection.query_row("SELECT revision FROM review_form_drafts WHERE item_id = ?1", [&second], |row| row.get(0)).unwrap();
            let _late = historical.then(|| TestNow::new("2027-02-01T18:00:00+08:00"));
            db.clear_execution_capture(SECOND, &second).unwrap();
            let current = db.get_task(&id).unwrap();
            assert_eq!(current.status, if explicit { "done" } else { "scheduled" });
            assert_eq!(current.remaining_workload_minutes, Some(if explicit { 0 } else { 45 }));
            assert_eq!(current.actual_minutes, 23);
            assert_eq!(rows(&db, &first), other);
            let selected = db.get_day_schedule(SECOND).unwrap().task_blocks.remove(0);
            assert_eq!(selected.execution_status, "planned");
            assert_eq!(selected.actual_minutes, Some(23));
            assert!(selected.review.is_none());
            assert!(db.get_review_entry_for_block(&second).is_err());
            let (payload, revision): (String, i64) = db.connection.query_row("SELECT payload_json, revision FROM review_form_drafts WHERE item_id = ?1",
                [&second], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
            assert_eq!(serde_json::from_str::<serde_json::Value>(&payload).unwrap(), serde_json::json!({
                "actual_minutes":"23", "defer_reason":"independent reason", "notes":"independent notes", "remaining_workload_minutes":"45" }));
            assert!(revision > old_revision);
            if !historical {
                assert!(db.save_review_form_draft(SECOND, "task", &second, "{}", old_revision).is_err());
                assert!(db.list_review_form_drafts(SECOND).unwrap().iter().any(|draft| draft.item_id == second));
                if explicit { db.reopen_manual_task(&id, SECOND).unwrap(); }
                db.save_review_entry(SECOND, ReviewEntryInput { plan_block_id: second, outcome: ReviewOutcome::Completed,
                    actual_minutes: saved.actual_minutes, defer_reason: saved.defer_reason, notes: saved.notes,
                    remaining_workload_minutes: saved.remaining_workload_minutes }).unwrap();
                assert_eq!(db.get_task(&id).unwrap().actual_minutes, 23, "reconfirmation must not double-count preserved work");
                assert_eq!(db.get_task(&id).unwrap().status, "done");
            }
        }
    }
}

#[test]
fn active_cross_day_explicit_completion_uses_today_not_future_or_expired_history_and_keeps_done_window() {
    for with_today in [false, true] {
        for action in ["complete", "transition", "review"] {
            let _clock = TestNow::new("2026-10-21T18:00:00+08:00");
            let mut db = Database::in_memory().unwrap();
            let id = confirmed_cross_day_draft(&mut db, "2026-10-23");
            db.connection.execute("UPDATE tasks SET remaining_workload_minutes = 120 WHERE id = ?1", [&id]).unwrap();
            let old = block(&db, &id, "2026-10-20", "09");
            write(&mut db, "capture", "2026-10-20", &id, &old, ReviewOutcome::NotStarted).unwrap();
            let future = plan_day(&mut db, &id, SECOND, "direct");
            let today = with_today.then(|| plan_day(&mut db, &id, FIRST, "direct"));
            assert_eq!(database_results::completion_candidate(&db.connection, &id).unwrap(), today);
            assert_eq!(db.get_task_metadata(&id).unwrap().completion_date.as_deref(), Some(FIRST));
            let other = (rows(&db, &old), rows(&db, &future));
            match action {
                "complete" => { db.complete_task(&id, None).unwrap(); },
                "transition" => { db.transition_manual_task(&id, TaskStatus::Done).unwrap(); },
                "review" => { db.complete_task_from_review(&id, FIRST, false).unwrap(); },
                _ => unreachable!(),
            }
            assert_eq!(db.get_task(&id).unwrap().status, "done");
            assert_eq!(db.get_task(&id).unwrap().result_date.as_deref(), Some(FIRST));
            assert_eq!((rows(&db, &old), rows(&db, &future)), other);
            let _expired = TestNow::new("2026-10-22T12:00:00+08:00");
            let before = fact_fingerprint(&db.connection, "task_completion", &id).unwrap();
            assert!(db.complete_task(&id, None).is_err());
            assert!(db.reopen_manual_task(&id, FIRST).is_err());
            assert_eq!(fact_fingerprint(&db.connection, "task_completion", &id).unwrap(), before);
        }
    }
}

#[test]
fn active_cross_day_with_only_future_schedule_can_complete_today_without_touching_it() {
    let _clock = TestNow::new("2026-10-21T18:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let id = confirmed_cross_day_draft(&mut db, SECOND);
    let future = plan_day(&mut db, &id, SECOND, "direct");
    let before = rows(&db, &future);
    assert_eq!(database_results::completion_candidate(&db.connection, &id).unwrap(), None);
    assert!(db.complete_task(&id, Some(&future)).is_err(), "a future block is not an execution today");
    db.complete_task(&id, None).unwrap();
    assert_eq!(db.get_task(&id).unwrap().status, "done");
    assert_eq!(db.get_task(&id).unwrap().result_date.as_deref(), Some(FIRST));
    assert_eq!(rows(&db, &future), before);
}

#[test]
fn failed_reviewed_completion_clear_restores_final_review_draft_and_aggregate_atomically() {
    let _clock = TestNow::new("2026-10-21T18:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let id = task(&mut db);
    let first = block(&db, &id, FIRST, "09");
    db.save_review_entry(FIRST, ReviewEntryInput { plan_block_id: first.clone(), outcome: ReviewOutcome::Completed,
        actual_minutes: Some(20), defer_reason: Some("保留原因".into()), notes: Some("保留备注".into()),
        remaining_workload_minutes: Some(45) }).unwrap();
    let before = fact_fingerprint(&db.connection, "task_completion", &id).unwrap();
    let draft = fact_rows(&db.connection, "SELECT * FROM review_form_drafts WHERE item_id = ?1", &first).unwrap();
    let completion = fact_rows(&db.connection, "SELECT * FROM task_completion_snapshots WHERE task_id = ?1", &id).unwrap();
    db.connection.execute_batch("CREATE TRIGGER fail_clear BEFORE UPDATE ON plan_blocks WHEN NEW.execution_status = 'planned'
        BEGIN SELECT RAISE(ABORT, 'clear failed'); END;").unwrap();
    assert!(db.clear_execution_capture(FIRST, &first).is_err());
    assert_eq!(fact_fingerprint(&db.connection, "task_completion", &id).unwrap(), before);
    assert_eq!(fact_rows(&db.connection, "SELECT * FROM review_form_drafts WHERE item_id = ?1", &first).unwrap(), draft);
    assert_eq!(fact_rows(&db.connection, "SELECT * FROM task_completion_snapshots WHERE task_id = ?1", &id).unwrap(), completion);
}

#[test]
fn clearing_reviewed_results_uses_final_review_outcome_when_legacy_block_status_disagrees() {
    for outcome in [ReviewOutcome::Completed, ReviewOutcome::Partial] {
        let _clock = TestNow::new("2026-10-21T18:00:00+08:00");
        let mut db = Database::in_memory().unwrap();
        let id = task(&mut db);
        let first = block(&db, &id, FIRST, "09");
        write(&mut db, "review", FIRST, &id, &first, outcome).unwrap();
        db.connection.execute("UPDATE plan_blocks SET execution_status = ?2 WHERE id = ?1",
            params![first, if outcome == ReviewOutcome::Completed { "partial" } else { "completed" }]).unwrap();
        let before = fact_fingerprint(&db.connection, "task_completion", &id).unwrap();
        let result = db.clear_execution_capture(FIRST, &first);
        assert_eq!(result.is_ok(), outcome == ReviewOutcome::Completed);
        if result.is_ok() { assert_eq!(execution_snapshot(&db.connection, &first).unwrap().execution_status, "planned"); }
        else { assert_eq!(fact_fingerprint(&db.connection, "task_completion", &id).unwrap(), before); }
    }
}

fn confirmed_historical_single_day(db: &mut Database) -> String {
    let draft = db.create_manual_task_draft(TaskDraftInput {
        item_type: "task".into(), recurring_settings: None, title: "补录历史单日任务".into(), notes: Some("原任务备注".into()),
        priority: Some(Priority::Medium), earliest_start_date: Some(FIRST.into()), earliest_start_time: Some("09:00".into()),
        due_date: Some(FIRST.into()), due_time: Some("09:30".into()), total_workload_minutes: Some(30),
        remaining_workload_minutes: Some(30), field_states_json: "{}".into(), tags: vec![], recurrence: None,
    }).unwrap();
    let task = db.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
    assert_eq!(task.status, "open");
    assert!(db.get_day_schedule(FIRST).unwrap().task_blocks.is_empty());
    task.id
}

#[test]
fn historical_list_completion_materializes_or_reuses_one_block_with_original_date_and_real_operation_time() {
    for existing in [false, true] {
        for api in ["complete", "transition"] {
            let _clock = TestNow::new("2026-11-01T18:00:00+08:00");
            let mut db = Database::in_memory().unwrap();
            let id = confirmed_historical_single_day(&mut db);
            let existing_id = existing.then(|| block(&db, &id, FIRST, "09"));
            let metadata = db.get_task_metadata(&id).unwrap();
            assert!(metadata.completion_backfill_allowed);
            assert_eq!(metadata.completion_date.as_deref(), Some(FIRST));
            let task = if api == "complete" { db.complete_task_with_note(&id, None, Some("历史完成备注".into())).unwrap() }
                else { db.transition_manual_task(&id, TaskStatus::Done).unwrap() };
            assert_eq!(task.status, "done");
            assert_eq!(task.result_date.as_deref(), Some(FIRST));
            assert_eq!(task.result_ends_at.as_deref(), Some("2026-10-21T09:30:00+08:00"));
            assert_eq!(task.notes.as_deref(), Some("原任务备注"));
            let schedule = db.get_day_schedule(FIRST).unwrap();
            assert_eq!(schedule.task_blocks.len(), 1);
            let saved = &schedule.task_blocks[0];
            if let Some(existing_id) = existing_id { assert_eq!(saved.id, existing_id); }
            assert_eq!(saved.starts_at, "2026-10-21T09:00:00+08:00");
            assert_eq!(saved.ends_at, "2026-10-21T09:30:00+08:00");
            assert_eq!(saved.execution_status, "completed");
            assert_eq!(saved.result_date.as_deref(), Some(FIRST));
            let captured = DateTime::parse_from_rfc3339(saved.execution_captured_at.as_deref().unwrap()).unwrap();
            assert_eq!(captured.signed_duration_since(clock_now()).num_milliseconds(), 0);
            assert_eq!(saved.actual_minutes, None, "completion must not invent actual minutes");
            assert!(db.get_day_schedule("2026-11-01").unwrap().task_blocks.is_empty());
            assert!(db.list_tasks(false, None).unwrap().iter().any(|task| task.id == id && task.status == "done"));
            let metadata = db.get_task_metadata(&id).unwrap();
            assert!(!metadata.completion_backfill_allowed);
            assert_eq!(metadata.completion_recorded_at.as_deref(), Some(clock_now().to_rfc3339().as_str()));
            assert!(metadata.history.iter().any(|event| event.kind == "execution" && event.plan_date.as_deref() == Some(FIRST)
                && event.occurred_at == saved.execution_captured_at && event.status.as_deref() == Some("done")));
            db.complete_task(&id, None).unwrap();
            assert_eq!(db.get_day_schedule(FIRST).unwrap().task_blocks.len(), 1, "repeated completion must not duplicate");
        }
    }
}

#[test]
fn historical_completion_cancel_and_undo_keep_the_block_planned_and_allow_recompletion_without_duplicates() {
    for action in ["reopen", "undo", "clear"] {
        let _clock = TestNow::new("2026-11-01T18:00:00+08:00");
        let mut db = Database::in_memory().unwrap();
        let id = confirmed_historical_single_day(&mut db);
        db.complete_task(&id, None).unwrap();
        let block_id = db.get_day_schedule(FIRST).unwrap().task_blocks[0].id.clone();
        match action {
            "reopen" => { db.reopen_manual_task(&id, "2026-11-01").unwrap(); }
            "undo" => { let undo = db.latest_undo().unwrap().unwrap(); assert_eq!(undo.target_type, "task_completion"); db.apply_undo(&undo.id).unwrap(); }
            "clear" => { let _late = TestNow::new("2027-01-01T18:00:00+08:00"); db.clear_execution_capture(FIRST, &block_id).unwrap(); }
            _ => unreachable!(),
        }
        let task = db.get_task(&id).unwrap();
        assert_eq!(task.status, "scheduled", "{action}");
        assert_eq!(task.remaining_workload_minutes, Some(30));
        assert!(!task.is_incomplete);
        let schedule = db.get_day_schedule(FIRST).unwrap();
        assert_eq!(schedule.task_blocks.len(), 1);
        assert_eq!(schedule.task_blocks[0].id, block_id);
        assert_eq!(schedule.task_blocks[0].execution_status, "planned");
        assert_eq!(schedule.task_blocks[0].execution_captured_at, None);
        assert!(db.get_task_metadata(&id).unwrap().completion_backfill_allowed);
        db.complete_task(&id, None).unwrap();
        let schedule = db.get_day_schedule(FIRST).unwrap();
        assert_eq!(schedule.task_blocks.len(), 1);
        assert_eq!(schedule.task_blocks[0].id, block_id);
        assert_eq!(schedule.task_blocks[0].execution_status, "completed");
        assert_eq!(db.get_task(&id).unwrap().result_date.as_deref(), Some(FIRST));
    }
}

#[test]
fn historical_backfill_window_uses_original_operation_time_and_cannot_be_extended_by_note_edits() {
    let _clock = TestNow::new("2026-11-01T18:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let id = confirmed_historical_single_day(&mut db);
    db.complete_task(&id, None).unwrap();
    let recorded = db.get_task_metadata(&id).unwrap().completion_recorded_at;
    let _later = TestNow::new("2026-11-01T23:59:59+08:00");
    db.complete_task_with_note(&id, None, Some("更正补录备注".into())).unwrap();
    assert_eq!(db.get_task_metadata(&id).unwrap().completion_recorded_at, recorded);
    let _boundary = TestNow::new("2026-11-02T00:00:00+08:00");
    assert!(database_results::require_task_window(&db.connection, &id).is_ok());
    let _expired = TestNow::new("2026-11-02T00:00:00.001+08:00");
    let before = fact_fingerprint(&db.connection, "task_completion", &id).unwrap();
    assert!(db.complete_task(&id, None).is_err());
    assert!(db.reopen_manual_task(&id, "2026-11-02").is_err());
    assert_eq!(fact_fingerprint(&db.connection, "task_completion", &id).unwrap(), before);
}

#[test]
fn historical_backfill_failures_roll_back_plan_block_result_estimates_snapshot_and_undo() {
    for (table, event) in [("daily_plans", "INSERT"), ("plan_blocks", "INSERT"), ("tasks", "UPDATE"),
        ("task_estimates", "INSERT"), ("task_completion_snapshots", "INSERT"), ("undo_entries", "INSERT")] {
        let _clock = TestNow::new("2026-11-01T18:00:00+08:00");
        let mut db = Database::in_memory().unwrap();
        let id = confirmed_historical_single_day(&mut db);
        let before = fact_fingerprint(&db.connection, "task_completion", &id).unwrap();
        let tables = ["daily_plans", "plan_blocks", "task_changes", "task_estimates", "task_completion_snapshots", "undo_entries"];
        let count = |database: &Database, name: &str| database.connection.query_row(&format!("SELECT COUNT(*) FROM {name}"), [], |row| row.get::<_, i64>(0)).unwrap();
        let counts = tables.map(|name| count(&db, name));
        db.connection.execute_batch(&format!("CREATE TRIGGER fail_backfill BEFORE {event} ON {table} BEGIN SELECT RAISE(ABORT,'backfill failure'); END;")).unwrap();
        assert!(db.complete_task(&id, None).is_err(), "{table}");
        assert_eq!(fact_fingerprint(&db.connection, "task_completion", &id).unwrap(), before, "{table}");
        assert_eq!(tables.map(|name| count(&db, name)), counts, "{table}");
        assert_eq!(db.get_task(&id).unwrap().status, "open");
    }
}

#[test]
fn historical_cancellation_failure_keeps_completed_block_and_task_consistent() {
    for action in ["reopen", "undo", "clear"] {
        let _clock = TestNow::new("2026-11-01T18:00:00+08:00");
        let mut db = Database::in_memory().unwrap();
        let id = confirmed_historical_single_day(&mut db);
        db.complete_task(&id, None).unwrap();
        let block_id = db.get_day_schedule(FIRST).unwrap().task_blocks[0].id.clone();
        let undo = db.latest_undo().unwrap().unwrap();
        let before = fact_fingerprint(&db.connection, "task_completion", &id).unwrap();
        let changes = db.count("task_changes").unwrap();
        db.connection.execute_batch("CREATE TRIGGER fail_cancel BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT,'cancel failure'); END;").unwrap();
        let result = match action {
            "reopen" => db.reopen_manual_task(&id, "2026-11-01").map(|_| ()),
            "undo" => db.apply_undo(&undo.id).map(|_| ()),
            "clear" => db.clear_execution_capture(FIRST, &block_id),
            _ => unreachable!(),
        };
        assert!(result.is_err(), "{action}");
        assert_eq!(fact_fingerprint(&db.connection, "task_completion", &id).unwrap(), before, "{action}");
        assert_eq!(db.count("task_changes").unwrap(), changes);
    }
}

#[test]
fn historical_backfill_does_not_fabricate_missing_times_or_bypass_old_task_results() {
    let _clock = TestNow::new("2026-11-01T18:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let id = confirmed_historical_single_day(&mut db);
    db.connection.execute("UPDATE tasks SET result_date = ?2, result_ends_at = due_at WHERE id = ?1", params![id, FIRST]).unwrap();
    assert!(!db.get_task_metadata(&id).unwrap().completion_backfill_allowed);
    assert!(db.complete_task(&id, None).is_err());
    assert!(db.get_day_schedule(FIRST).unwrap().task_blocks.is_empty());
    let missing = confirmed_historical_single_day(&mut db);
    db.connection.execute("UPDATE tasks SET earliest_start_at = NULL, earliest_start_time = NULL WHERE id = ?1", [&missing]).unwrap();
    assert!(!db.get_task_metadata(&missing).unwrap().completion_backfill_allowed);
    db.complete_task(&missing, None).unwrap();
    assert!(db.get_day_schedule(FIRST).unwrap().task_blocks.is_empty());
}

#[test]
fn cancelled_historical_backfills_keep_content_time_lock_and_cannot_move_frozen_context_into_other_dates() {
    for action in ["reopen", "undo", "clear"] {
        let _clock = TestNow::new("2026-11-01T18:00:00+08:00");
        let mut db = Database::in_memory().unwrap();
        let id = confirmed_historical_single_day(&mut db);
        db.complete_task(&id, None).unwrap();
        let block_id = db.get_day_schedule(FIRST).unwrap().task_blocks[0].id.clone();
        match action {
            "reopen" => { db.reopen_manual_task(&id, "2026-11-01").unwrap(); }
            "undo" => { let undo = db.latest_undo().unwrap().unwrap(); db.apply_undo(&undo.id).unwrap(); }
            "clear" => { db.clear_execution_capture(FIRST, &block_id).unwrap(); }
            _ => unreachable!(),
        }
        assert!(db.get_task(&id).unwrap().execution_locked);
        let before = fact_fingerprint(&db.connection, "task_completion", &id).unwrap();
        for (start, end) in [("2026-10-22T10:00:00+08:00", "2026-10-22T10:30:00+08:00"),
            ("2026-11-01T09:00:00+08:00", "2026-11-02T09:30:00+08:00")] {
            let error = db.update_manual_task(&id, ManualTaskUpdate {
                title: "尝试改期".into(), notes: None, priority: None,
                earliest_start_at: Some(start.into()), due_at: Some(end.into()), estimated_minutes: Some(30),
            }).unwrap_err();
            assert!(error.to_string().contains("锁定"), "{action}: {error}");
            assert_eq!(fact_fingerprint(&db.connection, "task_completion", &id).unwrap(), before);
        }
        db.complete_task(&id, None).unwrap();
        assert_eq!(db.get_task(&id).unwrap().result_date.as_deref(), Some(FIRST));
        assert_eq!(db.get_day_schedule(FIRST).unwrap().task_blocks[0].id, block_id);
    }
}
