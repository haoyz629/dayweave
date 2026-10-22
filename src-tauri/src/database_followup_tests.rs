use super::*;
use serde_json::json;

const TODAY: &str = "2026-10-16";

fn source(db: &mut Database) -> String {
    let id = db.create_manual_task("Source title").unwrap();
    db.connection.execute("UPDATE tasks SET notes = 'private source notes', remaining_workload_minutes = 135,
        total_workload_minutes = 180, estimated_minutes = 180, actual_minutes = 17 WHERE id = ?1", [&id]).unwrap();
    id
}
fn edited(draft: &TaskDraftDto) -> TaskDraftInput {
    TaskDraftInput { item_type:"task".into(), recurring_settings:None, title:"Independent renamed child".into(),
        notes:Some("child notes only".into()), priority:Some(Priority::High), earliest_start_date:Some("2026-11-20".into()),
        earliest_start_time:Some("13:00".into()), due_date:Some("2026-11-20".into()), due_time:Some("14:00".into()),
        total_workload_minutes:Some(60), remaining_workload_minutes:Some(60), field_states_json:draft.field_states_json.clone(),
        tags:vec!["child tag".into()], recurrence:None }
}
fn facts(db: &Database, id: &str) -> String { fact_fingerprint(&db.connection,"task_completion",id).unwrap() }
fn count(db: &Database, table: &str) -> i64 { db.connection.query_row(&format!("SELECT count(*) FROM {table}"),[],|row|row.get(0)).unwrap() }
fn block(db: &Database, id: &str, date: &str) -> String {
    let plan = Uuid::new_v4().to_string();
    db.connection.execute("INSERT INTO daily_plans (id,plan_date,status,source,created_at,confirmed_at) VALUES (?1,?2,'confirmed','manual',?3,?3)",params![plan,date,now()]).unwrap();
    let block = Uuid::new_v4().to_string();
    db.connection.execute("INSERT INTO plan_blocks (id,daily_plan_id,task_id,starts_at,ends_at,source,created_at,updated_at)
        VALUES (?1,?2,?3,?4,?5,'manual',?6,?6)",params![block,plan,id,format!("{date}T09:00:00+08:00"),format!("{date}T10:00:00+08:00"),now()]).unwrap();
    block
}
fn record(db: &Database, id: &str, block: &str) -> TaskExecutionResolutionInput {
    TaskExecutionResolutionInput { plan_block_id:block.into(), expected_task_updated_at:db.get_task(id).unwrap().updated_at,
        outcome:ReviewOutcome::NotStarted, note:Some(" original note ".into()), next_action:None, starts_at:None, ends_at:None, remaining_workload_minutes:None }
}

#[test]
fn record_only_preserves_lifecycle_workload_pending_and_supports_correction_completion_undo() {
    let _clock = TestToday::new(TODAY);
    for status in ["open","scheduled"] {
        let mut db = Database::in_memory().unwrap();
        let id = source(&mut db);
        db.connection.execute("UPDATE tasks SET status = ?2 WHERE id = ?1",params![id,status]).unwrap();
        let selected = block(&db,&id,TODAY);
        let pending = block(&db,&id,"2026-10-19");
        let pending_before = fact_rows(&db.connection,"SELECT * FROM plan_blocks WHERE id = ?1",&pending).unwrap();
        let before = db.get_task(&id).unwrap();
        let estimates = count(&db,"task_estimates");
        let request = record(&db,&id,&selected);
        db.resolve_task_execution(TODAY,request.clone()).unwrap();
        let after = db.get_task(&id).unwrap();
        let mut expected = serde_json::to_value(&before).unwrap();
        expected["updated_at"] = json!(after.updated_at);
        expected["execution_locked"] = json!(after.execution_locked);
        assert_eq!(serde_json::to_value(&after).unwrap(),expected);
        assert_ne!(before.updated_at,after.updated_at);
        assert_eq!(count(&db,"task_estimates"),estimates);
        assert_eq!(count(&db,"review_entries"),0);
        assert_eq!(fact_rows(&db.connection,"SELECT * FROM plan_blocks WHERE id = ?1",&pending).unwrap(),pending_before);
        assert!(db.resolve_task_execution(TODAY,request).is_err(),"old task timestamp is stale");
        let mut corrected = record(&db,&id,&selected);
        corrected.note = Some(" corrected note ".into());
        db.resolve_task_execution(TODAY,corrected).unwrap();
        let capture = serde_json::to_value(execution_snapshot(&db.connection,&selected).unwrap()).unwrap();
        assert_eq!(capture["execution_note"],"corrected note");
        assert_eq!(capture["review_required"],false);
        let mut completed = record(&db,&id,&selected);
        completed.outcome = ReviewOutcome::Completed;
        completed.note = Some("finished".into());
        assert_eq!(db.resolve_task_execution(TODAY,completed).unwrap().status,status);
        db.apply_undo(&db.latest_undo().unwrap().unwrap().id).unwrap();
        assert_eq!(serde_json::to_value(execution_snapshot(&db.connection,&selected).unwrap()).unwrap(),capture);
        assert_eq!(db.get_task(&id).unwrap().remaining_workload_minutes,Some(135));
        assert_eq!(db.get_task(&id).unwrap().status,status);
    }
}

#[test]
fn record_only_rejects_fields_history_final_status_and_sql_errors_atomically() {
    let _clock = TestToday::new(TODAY);
    for case in ["partial","start","end","remaining","note","wrong_date","missing","deleted","stale","trigger"] {
        let mut db = Database::in_memory().unwrap();
        let id = source(&mut db);
        let selected = block(&db,&id,TODAY);
        let mut request = record(&db,&id,&selected);
        let mut date = TODAY;
        match case {
            "partial" => request.outcome = ReviewOutcome::Partial,
            "start" => request.starts_at = Some("2026-10-17T09:00:00+08:00".into()),
            "end" => request.ends_at = Some("bad".into()),
            "remaining" => request.remaining_workload_minutes = Some(60),
            "note" => request.note = Some("x".repeat(501)),
            "history" => { date = "2026-10-15"; request.plan_block_id = block(&db,&id,date); },
            "wrong_date" => request.plan_block_id = block(&db,&id,"2026-10-17"),
            "missing" => request.plan_block_id = "missing".into(),
            "deleted" | "done" => { db.connection.execute("UPDATE tasks SET status = ?2 WHERE id = ?1",params![id,case]).unwrap(); },
            "stale" => request.expected_task_updated_at = "old".into(),
            "final" => { db.save_review_entry(TODAY,ReviewEntryInput { plan_block_id:selected.clone(), outcome:ReviewOutcome::Blocked, actual_minutes:None, defer_reason:None, notes:None, remaining_workload_minutes:None }).unwrap(); request.expected_task_updated_at = db.get_task(&id).unwrap().updated_at; },
            "trigger" => db.connection.execute_batch("CREATE TRIGGER fail_record BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT,'record failure'); END;").unwrap(),
            _ => unreachable!(),
        }
        let before = facts(&db,&id);
        assert!(db.resolve_task_execution(date,request).is_err(),"{case}");
        assert_eq!(facts(&db,&id),before,"{case}");
    }
}

#[test]
fn metadata_reports_only_captured_or_final_results_and_uses_corrected_latest_note() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let id = source(&mut db);
    let today = block(&db,&id,TODAY);
    let history = block(&db,&id,"2026-10-15");
    assert!(db.get_task_metadata(&id).unwrap().latest_execution.is_none());
    db.save_review_entry("2026-10-15",ReviewEntryInput { plan_block_id:history.clone(), outcome:ReviewOutcome::Partial,
        actual_minutes:None, defer_reason:None, notes:Some("old final".into()), remaining_workload_minutes:None }).unwrap();
    db.connection.execute("UPDATE review_entries SET updated_at = '2026-10-15T15:00:00+08:00' WHERE plan_block_id = ?1",[&history]).unwrap();
    let mut input = record(&db,&id,&today);
    input.note = Some("corrected only".into());
    db.resolve_task_execution(TODAY,input).unwrap();
    let fact = db.get_task_metadata(&id).unwrap().latest_execution.unwrap();
    assert_eq!(fact.plan_block_id,today);
    assert_eq!(fact.plan_date,TODAY);
    assert_eq!(fact.outcome,"not_started");
    assert_eq!(fact.note.as_deref(),Some("corrected only"));
}

#[test]
fn old_linked_drafts_confirm_as_ordinary_independent_tasks_without_relationship_writes() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let id = source(&mut db);
    let draft = db.create_manual_task_draft(TaskDraftInput {
        item_type: "task".into(), recurring_settings: None, title: "old draft".into(), notes: None, priority: None,
        earliest_start_date: Some(TODAY.into()), earliest_start_time: Some("09:00".into()),
        due_date: Some(TODAY.into()), due_time: Some("10:00".into()), total_workload_minutes: Some(60),
        remaining_workload_minutes: Some(60), field_states_json: "{}".into(), tags: vec![], recurrence: None,
    }).unwrap();
    db.connection.execute("INSERT INTO task_draft_origins VALUES (?1,?2,'historical source',?3)", params![draft.id, id, now()]).unwrap();
    db.connection.execute_batch("CREATE TRIGGER no_relationship_write BEFORE INSERT ON task_origins BEGIN SELECT RAISE(ABORT,'retired'); END;").unwrap();
    let before = facts(&db, &id);
    let listed = db.list_task_drafts(false).unwrap().into_iter().find(|value| value.id == draft.id).unwrap();
    assert!(serde_json::to_value(&listed).unwrap().get("origin").is_none());
    let saved = db.save_task_draft(&listed.id, listed.version, edited(&listed)).unwrap();
    let child = db.confirm_task_draft(&saved.id, &saved.confirmation_token).unwrap();
    assert_eq!(facts(&db, &id), before);
    assert_eq!(count(&db, "task_origins"), 0);
    let metadata = serde_json::to_value(db.get_task_metadata(&child.id).unwrap()).unwrap();
    assert!(metadata.get("origin").is_none());
    assert!(metadata.get("followups").is_none());
}
