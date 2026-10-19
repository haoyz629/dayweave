use super::*;
use serde_json::json;

const TODAY: &str = "2026-10-16";

fn source(db: &mut Database) -> String {
    let id = db.create_manual_task("Source title").unwrap();
    db.connection.execute("UPDATE tasks SET notes = 'private source notes', remaining_workload_minutes = 135,
        total_workload_minutes = 180, estimated_minutes = 180, actual_minutes = 17 WHERE id = ?1", [&id]).unwrap();
    id
}
fn prepare(db: &mut Database, id: &str) -> TaskDraftDto {
    match db.prepare_task_followup(id).unwrap() { FollowupPreparation::Draft { draft } => draft, _ => panic!("expected draft") }
}
fn edited(draft: &TaskDraftDto) -> TaskDraftInput {
    TaskDraftInput { item_type:"task".into(), recurring_settings:None, title:"Independent renamed child".into(),
        notes:Some("child notes only".into()), priority:Some(Priority::High), earliest_start_date:Some("2026-11-20".into()),
        earliest_start_time:Some("13:00".into()), due_date:Some("2026-11-20".into()), due_time:Some("14:00".into()),
        total_workload_minutes:Some(60), remaining_workload_minutes:Some(60), field_states_json:draft.field_states_json.clone(),
        tags:vec!["child tag".into()], recurrence:None }
}
fn confirm(db: &mut Database, source: &str) -> TaskDto {
    let draft = prepare(db,source);
    db.confirm_task_draft(&draft.id,&draft.confirmation_token).unwrap()
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
        assert_eq!(db.resolve_task_execution(TODAY,completed).unwrap().status,"done");
        db.apply_undo(&db.latest_undo().unwrap().unwrap().id).unwrap();
        assert_eq!(serde_json::to_value(execution_snapshot(&db.connection,&selected).unwrap()).unwrap(),capture);
        assert_eq!(db.get_task(&id).unwrap().remaining_workload_minutes,Some(135));
        assert_eq!(db.get_task(&id).unwrap().status,status);
    }
}

#[test]
fn record_only_rejects_fields_history_final_status_and_sql_errors_atomically() {
    let _clock = TestToday::new(TODAY);
    for case in ["partial","start","end","remaining","note","history","wrong_date","missing","deleted","done","stale","final","trigger"] {
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
fn prepare_draft_only_prefills_title_and_reuses_identity_and_user_edits_without_touching_source() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let id = source(&mut db);
    let before = facts(&db,&id);
    let draft = prepare(&mut db,&id);
    assert_eq!(draft.title,"Source title");
    assert_eq!(draft.notes,None);
    assert_eq!(draft.priority,None);
    assert!(draft.tags.is_empty());
    assert!(draft.recurrence.is_none());
    assert!(draft.recurring_settings.is_none());
    assert_eq!(draft.item_type,"task");
    assert_eq!(draft.draft_kind,"create");
    assert_eq!(draft.earliest_start_date.as_deref(),Some("2026-10-17"));
    assert_eq!(draft.due_date,draft.earliest_start_date);
    assert_eq!(draft.earliest_start_time.as_deref(),Some("09:00"));
    assert_eq!(draft.due_time.as_deref(),Some("10:00"));
    assert_eq!((draft.total_workload_minutes,draft.remaining_workload_minutes),(Some(60),Some(60)));
    assert_eq!(draft.origin.as_ref().unwrap().source_task_id.as_deref(),Some(id.as_str()));
    let saved = db.save_task_draft(&draft.id,draft.version,edited(&draft)).unwrap();
    let reused = prepare(&mut db,&id);
    assert_eq!(serde_json::to_value(&reused).unwrap(),serde_json::to_value(&saved).unwrap());
    assert_eq!(count(&db,"task_drafts"),1);
    assert_eq!(count(&db,"tasks"),1);
    assert_eq!(count(&db,"plan_blocks"),0);
    assert_eq!(facts(&db,&id),before);
    let child = db.confirm_task_draft(&saved.id,&saved.confirmation_token).unwrap();
    assert_eq!(child.title,"Independent renamed child");
    assert_eq!(child.notes.as_deref(),Some("child notes only"));
    assert_eq!(child.earliest_start_date.as_deref(),Some("2026-11-20"));
    assert_eq!(child.actual_minutes,0);
    assert_eq!(facts(&db,&id),before);
    assert_eq!(count(&db,"task_origins"),1);
    assert_eq!(db.confirm_task_draft(&saved.id,&saved.confirmation_token).unwrap().id,child.id);
    match db.prepare_task_followup(&id).unwrap() { FollowupPreparation::Existing { task_id } => assert_eq!(task_id,child.id), _ => panic!("existing child") }
    let encoded = serde_json::to_value(db.prepare_task_followup(&id).unwrap()).unwrap();
    assert_eq!(encoded["kind"],"existing");
    assert_eq!(count(&db,"tasks"),2);
}

#[test]
fn metadata_is_bidirectional_current_title_and_includes_done_deleted_children_and_chains() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let id = source(&mut db);
    let child = confirm(&mut db,&id);
    let grandchild = confirm(&mut db,&child.id);
    assert_eq!(db.get_task_metadata(&grandchild.id).unwrap().origin.unwrap().source_task_id,Some(child.id.clone()));
    db.connection.execute("UPDATE tasks SET title = 'Renamed source' WHERE id = ?1",[&id]).unwrap();
    let origin = db.get_task_metadata(&child.id).unwrap().origin.unwrap();
    assert_eq!(origin.source_title,"Renamed source");
    assert_eq!(origin.source_status.as_deref(),Some("open"));
    assert!(db.complete_task(&child.id,None).is_err());
    // Historical databases may already contain a completed source with a child.
    db.connection.execute("UPDATE tasks SET status = 'done' WHERE id = ?1", [&child.id]).unwrap();
    let followups = db.get_task_metadata(&id).unwrap().followups;
    assert_eq!(followups[0].status,"done");
    assert_eq!(followups[0].task_id,child.id);
    assert_eq!(followups[0].starts_at,child.earliest_start_at);
    assert!(matches!(db.prepare_task_followup(&id).unwrap(),FollowupPreparation::Existing { .. }));
    db.soft_delete_manual_task(&child.id,true).unwrap();
    assert_eq!(db.get_task_metadata(&id).unwrap().followups[0].status,"deleted");
    db.restore_task(&child.id).unwrap();
    assert_eq!(db.get_task_metadata(&child.id).unwrap().origin.unwrap().source_task_id,Some(id.clone()));
    let child_facts = facts(&db,&child.id);
    db.soft_delete_manual_task(&id,true).unwrap();
    assert_eq!(db.get_task_metadata(&child.id).unwrap().origin.unwrap().source_status.as_deref(),Some("deleted"));
    assert_eq!(db.get_task_metadata(&id).unwrap().followups.len(),1);
    db.restore_task(&id).unwrap();
    assert!(db.complete_task(&id,None).is_err());
    assert_eq!(facts(&db,&child.id),child_facts);
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
    let draft = prepare(&mut db,&id);
    assert_eq!(draft.notes,None,"execution note is never copied into followup");
}

#[test]
fn restored_old_child_blocks_new_confirmation_and_preserves_new_draft_input() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let id = source(&mut db);
    let child = confirm(&mut db,&id);
    db.soft_delete_manual_task(&child.id,true).unwrap();
    let draft = prepare(&mut db,&id);
    let draft = db.save_task_draft(&draft.id,draft.version,edited(&draft)).unwrap();
    db.restore_task(&child.id).unwrap();
    let before = facts(&db,&id);
    assert!(db.confirm_task_draft(&draft.id,&draft.confirmation_token).is_err());
    assert_eq!(count(&db,"tasks"),2);
    assert_eq!(count(&db,"task_origins"),1);
    assert_eq!(serde_json::to_value(&db.list_task_drafts(false).unwrap()[0]).unwrap(),serde_json::to_value(&draft).unwrap());
    assert_eq!(facts(&db,&id),before);
    assert!(matches!(db.prepare_task_followup(&id).unwrap(),FollowupPreparation::Existing { task_id } if task_id == child.id));
}

#[test]
fn linked_draft_switches_and_origin_injection_are_rejected_but_discarded_dto_remains_readable() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let id = source(&mut db);
    let draft = prepare(&mut db,&id);
    for case in ["recurring","recurrence","settings"] {
        let mut input = edited(&draft);
        match case {
            "recurring" => input.item_type = "recurring".into(),
            "recurrence" => input.recurrence = Some(RecurrenceInput { frequency:"daily".into(), interval_value:1, weekdays:vec![], month_day:None, starts_on:TODAY.into(), ends_on:None }),
            "settings" => input.recurring_settings = Some(RecurringDraftSettings { frequency:"daily".into(), interval_value:1, weekdays:vec![], month_day:None, starts_on:TODAY.into(), ends_on:None, display_time:None, display_duration_minutes:None }),
            _ => unreachable!(),
        }
        assert!(db.save_task_draft(&draft.id,draft.version,input).is_err(),"{case}");
    }
    // Confirmation defends against persisted malformed type/update drafts as well.
    for (column,value) in [("item_type","recurring"),("draft_kind","update")] {
        db.connection.execute(&format!("UPDATE task_drafts SET {column} = ?2 WHERE id = ?1"),params![draft.id,value]).unwrap();
        assert!(db.confirm_creation_draft(&draft.id,&draft.confirmation_token).is_err());
        assert!(db.confirm_task_draft(&draft.id,&draft.confirmation_token).is_err());
        db.connection.execute("UPDATE task_drafts SET item_type = 'task', draft_kind = 'create' WHERE id = ?1",[&draft.id]).unwrap();
    }
    assert_eq!(count(&db,"tasks"),1);
    assert_eq!(count(&db,"recurring_items"),0);
    assert!(serde_json::from_value::<TaskDraftInput>(json!({"title":"injected","field_states_json":"{}","source_task_id":id})).is_err());
    db.discard_task_draft(&draft.id,draft.version).unwrap();
    let discarded = db.list_task_drafts(true).unwrap().remove(0);
    assert_eq!(discarded.status,"discarded");
    assert!(discarded.origin.is_some());
    assert_ne!(prepare(&mut db,&id).id,draft.id);
}

#[test]
fn source_status_changes_after_preparation_allow_confirmation_with_historical_provenance() {
    let _clock = TestToday::new(TODAY);
    for status in ["done","deleted"] {
        let mut db = Database::in_memory().unwrap();
        let id = source(&mut db);
        let draft = prepare(&mut db,&id);
        if status == "done" { db.complete_task(&id,None).unwrap(); } else { db.soft_delete_manual_task(&id,true).unwrap(); }
        let before = facts(&db,&id);
        let child = db.confirm_task_draft(&draft.id,&draft.confirmation_token).unwrap();
        assert_eq!(facts(&db,&id),before);
        assert_eq!(db.get_task_metadata(&child.id).unwrap().origin.unwrap().source_status.as_deref(),Some(status));
        assert!(db.prepare_task_followup(&id).is_err());
    }
}

#[test]
fn permanent_source_deletion_preserves_child_and_active_draft_snapshots_and_allows_confirm() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let id = source(&mut db);
    let child = confirm(&mut db,&id);
    db.soft_delete_manual_task(&child.id,true).unwrap();
    let draft = prepare(&mut db,&id);
    db.connection.execute("UPDATE tasks SET title = 'Later source title' WHERE id = ?1",[&id]).unwrap();
    db.soft_delete_manual_task(&id,true).unwrap();
    db.permanently_delete_task(&id,true).unwrap();
    let origin = db.get_task_metadata(&child.id).unwrap().origin.unwrap();
    assert_eq!(origin.source_task_id,None);
    assert_eq!(origin.source_status,None);
    assert_eq!(origin.source_title,"Source title");
    let listed = db.list_task_drafts(false).unwrap().remove(0);
    assert_eq!(listed.id,draft.id);
    assert_eq!(listed.origin.as_ref().unwrap().source_task_id,None);
    assert_eq!(listed.origin.as_ref().unwrap().source_title,"Source title");
    let new_child = db.confirm_task_draft(&listed.id,&listed.confirmation_token).unwrap();
    assert_eq!(db.get_task_metadata(&new_child.id).unwrap().origin.unwrap().source_task_id,None);
    assert!(db.prepare_task_followup(&id).is_err());
}

#[test]
fn prepare_missing_done_deleted_sources_reject_without_rows_and_child_lookup_is_deterministic() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    assert!(db.prepare_task_followup("missing").is_err());
    for status in ["done","deleted"] {
        let id = source(&mut db);
        db.connection.execute("UPDATE tasks SET status = ?2 WHERE id = ?1",params![id,status]).unwrap();
        assert!(db.prepare_task_followup(&id).is_err());
    }
    assert_eq!(count(&db,"task_drafts"),0);
    let id = source(&mut db);
    let child = confirm(&mut db,&id);
    let other = source(&mut db);
    db.connection.execute("INSERT INTO task_origins VALUES (?1,?2,'snapshot','2999-01-01')",params![other,id]).unwrap();
    assert!(matches!(db.prepare_task_followup(&id).unwrap(),FollowupPreparation::Existing { task_id } if task_id == child.id));
}

#[test]
fn sql_trigger_failures_roll_back_prepare_and_confirm_without_losing_draft_or_source() {
    let _clock = TestToday::new(TODAY);
    for table in ["task_drafts","task_draft_origins"] {
        let mut db = Database::in_memory().unwrap();
        let id = source(&mut db);
        let before = facts(&db,&id);
        db.connection.execute_batch(&format!("CREATE TRIGGER fail_followup BEFORE INSERT ON {table} BEGIN SELECT RAISE(ABORT,'prepare failed'); END;")).unwrap();
        assert!(db.prepare_task_followup(&id).is_err());
        assert_eq!(count(&db,"task_drafts"),0);
        assert_eq!(count(&db,"task_draft_origins"),0);
        assert_eq!(facts(&db,&id),before);
    }
    for table in ["task_origins","plan_blocks","undo_entries"] {
        let mut db = Database::in_memory().unwrap();
        let id = source(&mut db);
        let draft = prepare(&mut db,&id);
        let before = facts(&db,&id);
        let undo_count = count(&db,"undo_entries");
        db.connection.execute_batch(&format!("CREATE TRIGGER fail_followup BEFORE INSERT ON {table} BEGIN SELECT RAISE(ABORT,'confirm failed'); END;")).unwrap();
        assert!(db.confirm_task_draft(&draft.id,&draft.confirmation_token).is_err());
        assert_eq!(count(&db,"tasks"),1);
        assert_eq!(count(&db,"task_origins"),0);
        assert_eq!(count(&db,"plan_blocks"),0);
        assert_eq!(count(&db,"undo_entries"),undo_count);
        assert_eq!(serde_json::to_value(&db.list_task_drafts(false).unwrap()[0]).unwrap(),serde_json::to_value(&draft).unwrap());
        assert_eq!(facts(&db,&id),before);
    }
}

#[test]
fn v24_migration_preserves_old_rows_and_ordinary_draft_metadata_defaults() {
    let _clock = TestToday::new(TODAY);
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);").unwrap();
    for (version,sql) in MIGRATIONS.iter().filter(|(version,_)| *version <= 23) {
        connection.execute_batch(sql).unwrap();
        connection.execute("INSERT INTO schema_migrations VALUES (?1,?2)",params![version,now()]).unwrap();
    }
    let mut db = Database { connection };
    let id = source(&mut db);
    let before = facts(&db,&id);
    db.connection.execute("INSERT INTO task_drafts (id,draft_kind,source_type,title,splittable,field_states_json,validation_status,version,confirmation_token,status,created_at,updated_at)
        VALUES ('old-draft','create','manual','old draft',1,'{}','needs_confirmation',1,'token','active','old','old')",[]).unwrap();
    let old = fact_rows(&db.connection,"SELECT * FROM task_drafts WHERE id = ?1","old-draft").unwrap();
    db.migrate().unwrap();
    db.migrate().unwrap();
    assert_eq!(facts(&db,&id),before);
    assert_eq!(fact_rows(&db.connection,"SELECT * FROM task_drafts WHERE id = ?1","old-draft").unwrap(),old);
    let metadata = db.get_task_metadata(&id).unwrap();
    assert!(metadata.origin.is_none());
    assert!(metadata.followups.is_empty());
    assert!(metadata.latest_execution.is_none());
    assert!(db.list_task_drafts(false).unwrap()[0].origin.is_none());
    assert_eq!(count(&db,"task_origins"),0);
    let version: i64 = db.connection.query_row("SELECT MAX(version) FROM schema_migrations",[],|row|row.get(0)).unwrap();
    assert_eq!(version, MIGRATIONS.last().unwrap().0);
}

#[test]
fn origin_survives_source_reschedule_and_day_changes_and_ordinary_paths_have_no_origin() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let id = source(&mut db);
    let draft = prepare(&mut db,&id);
    let ordinary = db.create_manual_task_draft(edited(&draft)).unwrap();
    assert!(ordinary.origin.is_none());
    let ordinary = db.save_task_draft(&ordinary.id,ordinary.version,edited(&ordinary)).unwrap();
    assert!(ordinary.origin.is_none());
    let ordinary_task = db.confirm_task_draft(&ordinary.id,&ordinary.confirmation_token).unwrap();
    assert!(db.get_task_metadata(&ordinary_task.id).unwrap().origin.is_none());
    {
        let _later = TestToday::new("2026-10-25");
        let reused = prepare(&mut db,&id);
        assert_eq!(reused.id,draft.id);
        assert_eq!(reused.earliest_start_date,draft.earliest_start_date);
        assert_eq!(serde_json::to_value(FollowupPreparation::Draft { draft:reused }).unwrap()["kind"],"draft");
    }
    let child = db.confirm_task_draft(&draft.id,&draft.confirmation_token).unwrap();
    let child_before = facts(&db,&child.id);
    db.update_manual_task(&id,ManualTaskUpdate { title:"rescheduled source".into(), notes:None, priority:None,
        earliest_start_at:Some("2026-12-01T11:00:00+08:00".into()), due_at:Some("2026-12-02T12:00:00+08:00".into()),
        estimated_minutes:Some(60) }).unwrap();
    assert_eq!(facts(&db,&child.id),child_before);
    let listed = db.connection.unchecked_transaction().unwrap();
    let linked = load_task_draft_in_transaction(&listed,&draft.id).unwrap();
    assert_eq!(linked.origin.unwrap().source_title,"rescheduled source");
    listed.rollback().unwrap();
    let _later = TestToday::new("2026-11-30");
    assert!(matches!(db.prepare_task_followup(&id).unwrap(),FollowupPreparation::Existing { task_id } if task_id == child.id));
    assert_eq!(db.get_task_metadata(&child.id).unwrap().origin.unwrap().source_task_id,Some(id));
}

#[test]
fn confirmation_keeps_corrected_source_execution_and_draft_cascade_is_scoped() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let id = source(&mut db);
    let selected = block(&db,&id,TODAY);
    let original = record(&db,&id,&selected);
    db.resolve_task_execution(TODAY,original).unwrap();
    let mut correction = record(&db,&id,&selected);
    correction.note = Some("only corrected fact".into());
    db.resolve_task_execution(TODAY,correction).unwrap();
    let before = facts(&db,&id);
    let draft = prepare(&mut db,&id);
    let saved = db.save_task_draft(&draft.id,draft.version,edited(&draft)).unwrap();
    let child = db.confirm_task_draft(&saved.id,&saved.confirmation_token).unwrap();
    assert_eq!(facts(&db,&id),before);
    assert_eq!(db.get_task_metadata(&id).unwrap().latest_execution.unwrap().note.as_deref(),Some("only corrected fact"));
    assert_eq!(count(&db,"review_entries"),0);
    db.connection.execute("DELETE FROM task_drafts WHERE id = ?1",[&draft.id]).unwrap();
    assert_eq!(count(&db,"task_draft_origins"),0);
    assert_eq!(db.get_task_metadata(&child.id).unwrap().origin.unwrap().source_task_id,Some(id));
}

#[test]
fn followup_inherits_priority_and_tags_once_without_copying_notes_or_overwriting_draft_edits() {
    let _clock = TestToday::new(TODAY);
    for priority in [None, Some("low"), Some("medium"), Some("high")] {
        let mut db = Database::in_memory().unwrap();
        let id = source(&mut db);
        db.connection.execute("UPDATE tasks SET priority = ?2 WHERE id = ?1", params![id, priority]).unwrap();
        db.set_task_tags(&id, vec!["Planning".into(), "项目A".into()]).unwrap();
        let source_before = db.get_task(&id).unwrap();
        let before = facts(&db, &id);
        let draft = prepare(&mut db, &id);
        assert_eq!(draft.priority, source_before.priority);
        assert_eq!(draft.tags, source_before.tags);
        assert_eq!(draft.notes, None);
        assert_eq!(facts(&db, &id), before);
        let mut changes = edited(&draft);
        changes.priority = Some(Priority::Low);
        changes.tags = vec!["user-edited".into()];
        let saved = db.save_task_draft(&draft.id, draft.version, changes).unwrap();
        db.connection.execute("UPDATE tasks SET priority = 'high' WHERE id = ?1", [&id]).unwrap();
        db.set_task_tags(&id, vec!["source-changed".into()]).unwrap();
        let reused = prepare(&mut db, &id);
        assert_eq!(reused.id, saved.id);
        assert_eq!(reused.priority.as_deref(), Some("low"));
        assert_eq!(reused.tags, vec!["user-edited".to_owned()]);
        let child = db.confirm_task_draft(&reused.id, &reused.confirmation_token).unwrap();
        assert_eq!(child.priority.as_deref(), Some("low"));
        assert_eq!(child.tags, vec!["user-edited".to_owned()]);
        assert_eq!(child.notes.as_deref(), Some("child notes only"));
        assert_eq!(db.get_task(&id).unwrap().notes.as_deref(), Some("private source notes"));
    }
}
