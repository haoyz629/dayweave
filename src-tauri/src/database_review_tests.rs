use super::*;
use serde_json::json;

const TODAY: &str = "2026-10-16";

fn task(database: &mut Database) -> String {
    let id = database.create_manual_task("Independent review fixture").unwrap();
    database.connection.execute("UPDATE tasks SET actual_minutes = 13, remaining_workload_minutes = 90, total_workload_minutes = 120 WHERE id = ?1", [&id]).unwrap();
    id
}

fn block(database: &Database, task_id: &str, date: &str) -> String {
    let plan_id = database.connection.query_row("SELECT id FROM daily_plans WHERE plan_date = ?1",[date],|row|row.get::<_,String>(0)).optional().unwrap().unwrap_or_else(|| {
        let id = Uuid::new_v4().to_string();
        database.connection.execute("INSERT INTO daily_plans (id,plan_date,status,source,created_at,confirmed_at) VALUES (?1,?2,'confirmed','manual',?3,?3)",params![id,date,now()]).unwrap();
        id
    });
    let id = Uuid::new_v4().to_string();
    database.connection.execute("INSERT INTO plan_blocks (id,daily_plan_id,task_id,starts_at,ends_at,source,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,'manual',?6,?6)", params![id,plan_id,task_id,format!("{date}T09:00:00+08:00"),format!("{date}T10:00:00+08:00"),now()]).unwrap();
    id
}

fn review(block_id: &str, minutes: Option<i64>) -> ReviewEntryInput {
    ReviewEntryInput { plan_block_id: block_id.into(), outcome: ReviewOutcome::Completed,
        actual_minutes: minutes, defer_reason: None, notes: Some("saved detail".into()), remaining_workload_minutes: None }
}

fn capture(block_id: &str) -> ExecutionCaptureInput {
    ExecutionCaptureInput { plan_block_id: block_id.into(), outcome: Some(ReviewOutcome::Partial), note: Some("original capture".into()) }
}

fn occurrence(database: &mut Database, date: &str) -> String {
    let item = database.create_recurring_item(RecurringItemInput { title: "repeat fixture".into(), notes: None,
        frequency: "daily".into(), interval_value: 1, weekdays: vec![], month_day: None,
        starts_on: "2026-01-01".into(), ends_on: None, display_time: Some("09:00".into()), display_duration_minutes: Some(30), tags: vec![] }).unwrap();
    database.list_recurring_occurrences(date).unwrap().into_iter()
        .find(|o| o.recurring_item_id == item.id).unwrap().id
}

fn repeat_review(outcome: &str, notes: Option<&str>) -> RecurringOccurrenceReviewInput {
    RecurringOccurrenceReviewInput { outcome: Some(outcome.into()), notes: notes.map(str::to_owned) }
}

fn undo(database: &Database) -> UndoEntryDto { database.latest_undo().unwrap().unwrap() }

#[test]
fn nullable_zero_known_minutes_and_duplicate_are_distinct_and_additive() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let task_id = task(&mut database);
    for minutes in [None, Some(0), Some(27)] {
        let id = block(&database, &task_id, TODAY);
        let saved = database.save_review_entry(TODAY, review(&id, minutes)).unwrap();
        assert_eq!(saved.actual_minutes, minutes);
        assert_eq!(execution_snapshot(&database.connection, &id).unwrap().actual_minutes, minutes);
        assert!(database.save_review_entry(TODAY, review(&id, Some(900))).is_err());
        database.save_execution_capture(TODAY, capture(&id)).unwrap();
        assert_eq!(database.get_review_entry_for_block(&id).unwrap().actual_minutes, minutes);
        assert_eq!(execution_snapshot(&database.connection, &id).unwrap().actual_minutes, minutes);
    }
    let saved = database.get_task(&task_id).unwrap();
    assert_eq!(saved.actual_minutes, 40);
    assert_eq!(saved.remaining_workload_minutes, Some(90));
    assert_eq!(saved.status, "scheduled");
    let invalid = block(&database, &task_id, TODAY);
    assert!(database.save_review_entry(TODAY, review(&invalid, Some(-1))).is_err());
    assert!(serde_json::from_value::<ReviewEntryInput>(json!({"plan_block_id": invalid,"outcome":"completed","actual_minutes":1.5,"defer_reason":null,"notes":null,"remaining_workload_minutes":null})).is_err());
}

#[test]
fn task_history_is_unlimited_while_recurring_and_draft_windows_stay_seven_days() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let task_id = task(&mut database);
    for (date, allowed) in [(TODAY,true),("2026-10-15",true),("2026-10-10",true),("2026-10-09",false),("2026-10-17",false)] {
        let id = block(&database, &task_id, date);
        let task_allowed = date <= TODAY;
        assert_eq!(database.save_execution_capture(date,capture(&id)).is_ok(), task_allowed, "capture {date}");
        assert_eq!(database.save_review_form_draft(date,"task",&id,"{}",0).is_ok(), false, "capture already created a draft tombstone or date is forbidden");
        let review_id = if date == TODAY { id.clone() } else { block(&database, &task_id, date) };
        assert_eq!(database.save_review_entry(date,review(&review_id,None)).is_ok(), task_allowed, "first review {date}");
        let recurring = occurrence(&mut database,date);
        assert_eq!(database.save_review_form_draft(date,"recurring",&recurring,"{}",0).is_ok(), allowed, "draft {date}");
        assert_eq!(database.save_recurring_occurrence_review(&recurring,repeat_review("completed",None)).is_ok(), allowed, "repeat {date}");
    }
    assert!(database.save_review_entry(TODAY,review("missing",None)).is_err());
    assert!(database.save_execution_capture(TODAY,capture("missing")).is_err());
    assert!(database.save_recurring_occurrence_review("missing",repeat_review("completed",None)).is_err());
    assert!(database.save_review_form_draft(TODAY,"task","missing","{}",0).is_err());
    let historical = database.list_recurring_occurrences("2026-10-14").unwrap();
    assert_eq!(historical.len(), 5, "calendar reads reconstruct unvisited historical schedules");
    let old_count = database.count("recurring_occurrences").unwrap();
    assert_eq!(database.list_recurring_occurrences("2026-10-14").unwrap(), historical);
    assert_eq!(database.count("recurring_occurrences").unwrap(), old_count, "repeated historical reads are idempotent");
    assert!(validate_review_date("2026-02-30").is_err());
}

#[test]
fn historical_backfill_accumulates_only_known_actuals_without_current_state_or_plan_changes() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let task_id = task(&mut database);
    let today = block(&database,&task_id,TODAY);
    let history = block(&database,&task_id,"2026-10-10");
    database.connection.execute("UPDATE tasks SET status = 'done', remaining_workload_minutes = 0 WHERE id = ?1",[&task_id]).unwrap();
    let before = database.get_task(&task_id).unwrap();
    let current_block = fact_rows(&database.connection,"SELECT * FROM plan_blocks WHERE id = ?1",&today).unwrap();
    let plans = fact_rows(&database.connection,"SELECT dp.* FROM daily_plans dp JOIN plan_blocks pb ON pb.daily_plan_id = dp.id WHERE pb.task_id = ?1 ORDER BY dp.id",&task_id).unwrap();
    let estimates = fact_rows(&database.connection,"SELECT * FROM task_estimates WHERE task_id = ?1",&task_id).unwrap();
    let mut invalid = review(&history,Some(18));
    invalid.remaining_workload_minutes = Some(50);
    assert!(database.save_review_entry("2026-10-10",invalid).is_err());
    let saved = database.save_review_entry("2026-10-10",review(&history,Some(18))).unwrap();
    assert_eq!(saved.review_date,"2026-10-10");
    assert!(DateTime::parse_from_rfc3339(&saved.created_at).is_ok());
    let after = database.get_task(&task_id).unwrap();
    assert_eq!(after.actual_minutes,before.actual_minutes, "historical first backfill never changes the current task");
    assert_eq!(after.status,before.status);
    assert_eq!(after.remaining_workload_minutes,before.remaining_workload_minutes);
    assert_eq!(after.earliest_start_at,before.earliest_start_at);
    assert_eq!(after.due_at,before.due_at);
    assert_eq!(fact_rows(&database.connection,"SELECT * FROM plan_blocks WHERE id = ?1",&today).unwrap(),current_block);
    assert_eq!(fact_rows(&database.connection,"SELECT dp.* FROM daily_plans dp JOIN plan_blocks pb ON pb.daily_plan_id = dp.id WHERE pb.task_id = ?1 ORDER BY dp.id",&task_id).unwrap(),plans);
    assert_eq!(fact_rows(&database.connection,"SELECT * FROM task_estimates WHERE task_id = ?1",&task_id).unwrap(),estimates);
    assert!(database.complete_task_from_review(&task_id,"2026-10-10",true).is_err());
}

#[test]
fn completion_captures_only_selected_today_block_and_undo_restores_prior_facts() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let task_id = task(&mut database);
    let selected = block(&database,&task_id,TODAY);
    let other = block(&database,&task_id,TODAY);
    let history = block(&database,&task_id,"2026-10-15");
    database.save_execution_capture(TODAY,capture(&selected)).unwrap();
    database.save_review_entry("2026-10-15",review(&history,Some(12))).unwrap();
    let old_capture = execution_snapshot(&database.connection,&selected).unwrap();
    let untouched = fact_rows(&database.connection,"SELECT * FROM plan_blocks WHERE id = ?1",&other).unwrap();
    let old_review = fact_rows(&database.connection,"SELECT * FROM review_entries WHERE task_id = ?1",&task_id).unwrap();
    let completed = database.complete_task(&task_id,Some(&selected)).unwrap();
    assert_eq!(completed.status,"done");
    assert_eq!(completed.remaining_workload_minutes,Some(0));
    assert_eq!(completed.actual_minutes,13);
    assert_eq!(execution_snapshot(&database.connection,&selected).unwrap().execution_status,"completed");
    assert_eq!(fact_rows(&database.connection,"SELECT * FROM plan_blocks WHERE id = ?1",&other).unwrap(),untouched);
    let latest = undo(&database);
    assert_eq!(latest.action_kind,"task_completed");
    let estimate_count = database.connection.query_row("SELECT count(*) FROM task_estimates WHERE task_id = ?1",[&task_id],|row|row.get::<_,i64>(0)).unwrap();
    database.apply_undo(&latest.id).unwrap();
    let restored = database.get_task(&task_id).unwrap();
    assert_eq!(restored.status,"open");
    assert_eq!(restored.remaining_workload_minutes,Some(90));
    assert_eq!(restored.actual_minutes,13);
    assert_eq!(serde_json::to_value(execution_snapshot(&database.connection,&selected).unwrap()).unwrap(),serde_json::to_value(old_capture).unwrap());
    assert_eq!(fact_rows(&database.connection,"SELECT * FROM review_entries WHERE task_id = ?1",&task_id).unwrap(),old_review);
    assert_eq!(database.connection.query_row("SELECT count(*) FROM task_estimates WHERE task_id = ?1",[&task_id],|row|row.get::<_,i64>(0)).unwrap(),estimate_count + 1,"append compensation; retain completion estimate history");
    assert!(database.apply_undo(&latest.id).is_err());
}

#[test]
fn completion_preserves_independent_review_fields_and_undo_restores_only_its_result_changes() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let task_id = task(&mut database);
    let id = block(&database,&task_id,TODAY);
    let mut detail = review(&id,Some(7));
    detail.outcome = ReviewOutcome::Blocked;
    database.save_review_entry(TODAY,detail).unwrap();
    let before_block = serde_json::to_value(execution_snapshot(&database.connection,&id).unwrap()).unwrap();
    let before_review = fact_rows(&database.connection,"SELECT * FROM review_entries WHERE task_id = ?1",&task_id).unwrap();
    database.complete_task(&task_id,Some(&id)).unwrap();
    assert_eq!(execution_snapshot(&database.connection,&id).unwrap().execution_status,"completed");
    assert_eq!(execution_snapshot(&database.connection,&id).unwrap().actual_minutes,Some(7));
    assert_eq!(database.get_review_entry_for_block(&id).unwrap().outcome,"completed");
    database.apply_undo(&undo(&database).id).unwrap();
    assert_eq!(serde_json::to_value(execution_snapshot(&database.connection,&id).unwrap()).unwrap(),before_block);
    assert_eq!(fact_rows(&database.connection,"SELECT * FROM review_entries WHERE task_id = ?1",&task_id).unwrap(),before_review);
}

#[test]
fn completion_accepts_no_schedule_and_manual_done_routes_through_safe_undo() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let id = task(&mut database);
    assert_eq!(database.transition_manual_task(&id,TaskStatus::Done).unwrap().remaining_workload_minutes,Some(0));
    assert_eq!(database.count("plan_blocks").unwrap(),0);
    database.apply_undo(&undo(&database).id).unwrap();
    assert_eq!(database.get_task(&id).unwrap().remaining_workload_minutes,Some(90));
    assert_eq!(database.get_task(&id).unwrap().actual_minutes,13);
}

#[test]
fn completion_validates_explicit_block_and_null_selection_is_deterministic() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let id = task(&mut database);
    let other_task = task(&mut database);
    let foreign = block(&database,&other_task,TODAY);
    let historical = block(&database,&id,"2026-10-15");
    assert!(database.complete_task(&id,Some(&foreign)).is_err());
    assert!(database.complete_task(&id,Some(&historical)).is_err());
    let a = block(&database,&id,TODAY);
    let b = block(&database,&id,TODAY);
    database.complete_task(&id,None).unwrap();
    let first = if a < b { &a } else { &b };
    let second = if a < b { &b } else { &a };
    assert_eq!(execution_snapshot(&database.connection,first).unwrap().execution_status,"completed");
    assert_eq!(execution_snapshot(&database.connection,second).unwrap().execution_status,"planned");
    assert_eq!(execution_snapshot(&database.connection,&historical).unwrap().execution_status,"planned");
}

#[test]
fn completion_undo_refuses_subsequent_execution_review_edit_deletion_and_expiry() {
    let _clock = TestToday::new(TODAY);
    for conflict in ["capture","review","edit","delete","block_delete","expired"] {
        let mut database = Database::in_memory().unwrap();
        let id = task(&mut database);
        let selected = block(&database,&id,TODAY);
        database.complete_task(&id,Some(&selected)).unwrap();
        let latest = undo(&database);
        match conflict {
            "capture" => database.save_execution_capture(TODAY,capture(&selected)).unwrap(),
            "review" => { database.save_review_entry(TODAY,review(&selected,None)).unwrap(); },
            "edit" => { database.connection.execute("UPDATE tasks SET notes = 'later edit' WHERE id = ?1",[&id]).unwrap(); },
            "delete" => database.soft_delete_manual_task(&id,true).unwrap(),
            "block_delete" => { database.connection.execute("DELETE FROM plan_blocks WHERE id = ?1",[&selected]).unwrap(); },
            "expired" => { database.connection.execute("UPDATE undo_entries SET expires_at = '2000-01-01T00:00:00Z' WHERE id = ?1",[&latest.id]).unwrap(); },
            _ => unreachable!(),
        }
        let after = fact_fingerprint(&database.connection,"task_completion",&id).unwrap();
        assert!(database.apply_undo(&latest.id).is_err(),"{conflict}");
        assert_eq!(fact_fingerprint(&database.connection,"task_completion",&id).unwrap(),after,"refusal is atomic: {conflict}");
    }
}

#[test]
fn completion_and_review_roll_back_every_write_if_final_transaction_step_fails() {
    let _clock = TestToday::new(TODAY);
    for operation in ["completion","review","repeat"] {
        let mut database = Database::in_memory().unwrap();
        let id = task(&mut database);
        let selected = block(&database,&id,TODAY);
        let recurring = occurrence(&mut database,TODAY);
        database.save_review_form_draft(TODAY,"task",&selected,"{\"notes\":\"retained\"}",0).unwrap();
        database.save_review_form_draft(TODAY,"recurring",&recurring,"{}",0).unwrap();
        let task_before = fact_fingerprint(&database.connection,"task_completion",&id).unwrap();
        let recurring_before = fact_fingerprint(&database.connection,"recurring_review",&recurring).unwrap();
        let drafts_before = serde_json::to_value(database.list_review_form_drafts(TODAY).unwrap()).unwrap();
        if operation == "review" {
            database.connection.execute_batch("CREATE TRIGGER fail_draft BEFORE UPDATE ON review_form_drafts BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
        } else {
            database.connection.execute_batch("CREATE TRIGGER fail_undo BEFORE INSERT ON undo_entries BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
        }
        match operation {
            "completion" => assert!(database.complete_task(&id,Some(&selected)).is_err()),
            "review" => assert!(database.save_review_entry(TODAY,review(&selected,Some(17))).is_err()),
            "repeat" => assert!(database.save_recurring_occurrence_review(&recurring,repeat_review("completed",None)).is_err()),
            _ => unreachable!(),
        }
        assert_eq!(fact_fingerprint(&database.connection,"task_completion",&id).unwrap(),task_before);
        assert_eq!(fact_fingerprint(&database.connection,"recurring_review",&recurring).unwrap(),recurring_before);
        assert_eq!(serde_json::to_value(database.list_review_form_drafts(TODAY).unwrap()).unwrap(),drafts_before);
    }
}

#[test]
fn drafts_use_cas_target_and_date_isolation_and_never_revive_after_submission_or_deletion() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let id = task(&mut database);
    let a = block(&database,&id,TODAY);
    let b = block(&database,&id,TODAY);
    let c = block(&database,&id,"2026-10-15");
    for (date,target) in [(TODAY,&a),(TODAY,&b),("2026-10-15",&c)] {
        let draft = database.save_review_form_draft(date,"task",target,"{\"notes\":\"draft\"}",0).unwrap();
        assert_eq!(draft.revision,1);
        assert!(database.save_review_form_draft(date,"task",target,"{}",0).is_err());
    }
    let revised = database.save_review_form_draft(TODAY,"task",&a,"{\"notes\":\"latest\"}",1).unwrap();
    assert_eq!(revised.revision,2);
    database.save_review_entry(TODAY,review(&a,None)).unwrap();
    assert!(database.save_review_form_draft(TODAY,"task",&a,"{}",2).is_err());
    let today = database.list_review_form_drafts(TODAY).unwrap();
    assert_eq!(today.len(),1);
    assert_eq!(today[0].item_id,b);
    assert_eq!(today[0].payload_json,"{\"notes\":\"draft\"}");
    assert_eq!(database.list_review_form_drafts("2026-10-15").unwrap()[0].item_id,c);
    database.delete_review_form_draft(TODAY,"task",&b).unwrap();
    assert!(database.save_review_form_draft(TODAY,"task",&b,"{}",1).is_err());
    let tombstone = database.list_review_form_drafts(TODAY).unwrap().remove(0);
    assert_eq!(tombstone.payload_json,"{}");
    assert_eq!(tombstone.revision,2);
    assert_eq!(database.save_review_form_draft(TODAY,"task",&b,"{\"notes\":\"new session\"}",2).unwrap().revision,3);
    assert!(database.save_review_form_draft("2026-10-15","task",&b,"{}",0).is_err());
    database.soft_delete_manual_task(&id,true).unwrap();
    assert!(database.list_review_form_drafts(TODAY).unwrap().is_empty());
    assert!(database.save_review_form_draft(TODAY,"task",&b,"{}",3).is_err());
}

#[test]
fn drafts_persist_across_database_reopen_and_expired_targets_stay_read_only() {
    let path = std::env::var_os("PI_SCRATCH_DIR").map(std::path::PathBuf::from).unwrap_or_else(std::env::temp_dir).join(format!("dayweave-review-{}.sqlite",Uuid::new_v4()));
    let _clock = TestToday::new(TODAY);
    let (id,selected);
    {
        let mut database = Database::open(&path).unwrap();
        id = task(&mut database);
        selected = block(&database,&id,TODAY);
        database.save_review_form_draft(TODAY,"task",&selected,"{\"notes\":\"restart\"}",0).unwrap();
    }
    {
        let mut database = Database::open(&path).unwrap();
        assert_eq!(database.list_review_form_drafts(TODAY).unwrap()[0].payload_json,"{\"notes\":\"restart\"}");
        let _later = TestToday::new("2026-10-23");
        assert!(database.list_review_form_drafts(TODAY).unwrap().is_empty());
        assert!(database.save_review_form_draft(TODAY,"task",&selected,"{}",1).is_err());
        assert_eq!(database.get_task(&id).unwrap().actual_minutes,13);
    }
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(format!("{}-wal",path.display()));
    let _ = std::fs::remove_file(format!("{}-shm",path.display()));
}

#[test]
fn repeat_today_notes_edits_have_safe_undo_and_historical_results_are_read_only() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let id = occurrence(&mut database,TODAY);
    let item_id = load_occurrence(&database.connection,&id).unwrap().recurring_item_id;
    let rule = fact_rows(&database.connection,"SELECT * FROM recurring_items WHERE id = ?1",&item_id).unwrap();
    database.save_recurring_occurrence_review(&id,repeat_review("completed",Some("first note"))).unwrap();
    let first_undo = undo(&database);
    let first = load_occurrence(&database.connection,&id).unwrap();
    let draft = database.list_review_form_drafts(TODAY).unwrap().into_iter().find(|draft|draft.item_id == id).unwrap();
    assert_eq!(draft.payload_json,"{}");
    database.save_review_form_draft(TODAY,"recurring",&id,"{\"notes\":\"new note\"}",draft.revision).unwrap();
    database.save_recurring_occurrence_review(&id,repeat_review("partial",Some("new note"))).unwrap();
    let latest = undo(&database);
    assert!(database.apply_undo(&first_undo.id).is_err());
    database.apply_undo(&latest.id).unwrap();
    let restored = load_occurrence(&database.connection,&id).unwrap();
    assert_eq!(restored.outcome,first.outcome);
    assert_eq!(restored.review_notes,first.review_notes);
    assert_eq!(restored.reviewed_at,first.reviewed_at);
    assert_eq!(fact_rows(&database.connection,"SELECT * FROM recurring_items WHERE id = ?1",&item_id).unwrap(),rule);
    let history = occurrence(&mut database,"2026-10-10");
    database.save_recurring_occurrence_review(&history,repeat_review("completed",None)).unwrap();
    assert!(database.save_recurring_occurrence_review(&history,repeat_review("partial",None)).is_err());
    assert!(database.save_review_form_draft("2026-10-10","recurring",&history,"{}",0).is_err());
    assert!(database.apply_undo(&undo(&database).id).is_err());
    assert_eq!(load_occurrence(&database.connection,&history).unwrap().outcome.as_deref(),Some("completed"));
    assert_eq!(database.count("tasks").unwrap(),0);
    assert_eq!(database.count("plan_blocks").unwrap(),0);
}

#[test]
fn repeat_undo_refuses_rule_changes_deletion_and_later_review() {
    let _clock = TestToday::new(TODAY);
    for conflict in ["rule","deleted","review"] {
        let mut database = Database::in_memory().unwrap();
        let id = occurrence(&mut database,TODAY);
        database.save_recurring_occurrence_review(&id,repeat_review("completed",None)).unwrap();
        let latest = undo(&database);
        let item_id = load_occurrence(&database.connection,&id).unwrap().recurring_item_id;
        match conflict {
            "rule" => { database.connection.execute("UPDATE recurring_items SET title = 'later rule edit' WHERE id = ?1",[&item_id]).unwrap(); },
            "deleted" => {
                database.set_recurring_item_status(&item_id,"ended").unwrap();
                database.soft_delete_recurring_item(&item_id,true).unwrap();
            },
            "review" => { database.save_recurring_occurrence_review(&id,repeat_review("partial",None)).unwrap(); },
            _ => unreachable!(),
        }
        let before = fact_fingerprint(&database.connection,"recurring_review",&id).unwrap();
        assert!(database.apply_undo(&latest.id).is_err(),"{conflict}");
        assert_eq!(fact_fingerprint(&database.connection,"recurring_review",&id).unwrap(),before);
    }
}

#[test]
fn v22_migration_preserves_every_old_review_index_trigger_and_foreign_key_and_is_idempotent() {
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);").unwrap();
    for (version,sql) in MIGRATIONS.iter().filter(|(version,_)| *version <= 21) {
        connection.execute_batch(sql).unwrap();
        connection.execute("INSERT INTO schema_migrations VALUES (?1,?2)",params![version,now()]).unwrap();
    }
    let mut database = Database { connection, holiday_calendar: CalendarState::bundled() };
    let id = task(&mut database);
    let selected = block(&database,&id,TODAY);
    database.connection.execute("INSERT INTO review_entries (id,review_date,plan_block_id,task_id,outcome,actual_minutes,notes,remaining_workload_minutes,created_at,updated_at) VALUES ('legacy',?1,?2,?3,'partial',0,'old note',71,'old-created','old-updated')",params![TODAY,selected,id]).unwrap();
    database.connection.execute("INSERT INTO review_entries (id,review_date,task_id,outcome,actual_minutes,created_at,updated_at) VALUES ('unlinked',?1,?2,'completed',38,'older','older')",params![TODAY,id]).unwrap();
    database.connection.execute_batch("CREATE INDEX custom_review_notes ON review_entries(notes); CREATE TRIGGER custom_review_trigger AFTER INSERT ON review_entries BEGIN SELECT 1; END;").unwrap();
    let before = fact_rows(&database.connection,"SELECT *, NULL AS followup_action FROM review_entries WHERE task_id = ?1 ORDER BY id",&id).unwrap();
    let fks = fact_rows(&database.connection,"SELECT * FROM pragma_foreign_key_list('review_entries') WHERE ?1 = 'x' ORDER BY id","x").unwrap();
    let schema = |db: &Database| {
        let mut statement = db.connection.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name = 'review_entries' AND type IN ('index','trigger') ORDER BY name").unwrap();
        statement.query_map([],|row| Ok((row.get::<_,String>(0)?,row.get::<_,Option<String>>(1)?.map(|sql|sql.split_whitespace().collect::<Vec<_>>().join(" "))))).unwrap().collect::<Result<Vec<_>,_>>().unwrap()
    };
    let old_schema = schema(&database);
    database.migrate().unwrap();
    database.migrate().unwrap();
    assert_eq!(fact_rows(&database.connection,"SELECT * FROM review_entries WHERE task_id = ?1 ORDER BY id",&id).unwrap(),before);
    assert_eq!(fact_rows(&database.connection,"SELECT * FROM pragma_foreign_key_list('review_entries') WHERE ?1 = 'x' ORDER BY id","x").unwrap(),fks);
    assert_eq!(schema(&database),old_schema);
    assert_eq!(database.get_task(&id).unwrap().actual_minutes,13,"migration never recomputes totals");
    database.connection.execute("DELETE FROM plan_blocks WHERE id = ?1",[&selected]).unwrap();
    assert_eq!(database.connection.query_row("SELECT plan_block_id FROM review_entries WHERE id = 'legacy'",[],|row|row.get::<_,Option<String>>(0)).unwrap(),None);
    let nullable = block(&database,&id,TODAY);
    let _clock = TestToday::new(TODAY);
    database.save_review_entry(TODAY,review(&nullable,None)).unwrap();
    assert!(database.connection.execute("UPDATE review_entries SET actual_minutes = -1 WHERE id = 'legacy'",[]).is_err());
    assert!(database.connection.execute("INSERT INTO review_entries (id,review_date,task_id,outcome,actual_minutes,created_at,updated_at) VALUES ('bad',?1,'missing','completed',NULL,'a','a')",[TODAY]).is_err());
    assert!(database.connection.execute("INSERT INTO review_entries (id,review_date,plan_block_id,task_id,outcome,actual_minutes,created_at,updated_at) VALUES ('duplicate',?1,?2,?3,'completed',NULL,'a','a')",params![TODAY,nullable,id]).is_err(),"partial unique index survives migration");
    let cascade_task = task(&mut database);
    database.connection.execute("INSERT INTO review_entries (id,review_date,task_id,outcome,created_at,updated_at) VALUES ('cascade',?1,?2,'completed','a','a')",params![TODAY,cascade_task]).unwrap();
    database.connection.execute("DELETE FROM task_changes WHERE task_id = ?1",[&cascade_task]).unwrap();
    database.connection.execute("DELETE FROM tasks WHERE id = ?1",[&cascade_task]).unwrap();
    assert_eq!(database.connection.query_row("SELECT count(*) FROM review_entries WHERE id = 'cascade'",[],|row|row.get::<_,i64>(0)).unwrap(),0);
    assert!(fact_rows(&database.connection,"SELECT * FROM pragma_foreign_key_check WHERE ?1 = 'x'","x").unwrap().is_empty());
}

#[test]
fn capture_safe_undo_restores_previous_lightweight_facts_and_refuses_final_review() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let id = task(&mut database);
    let selected = block(&database,&id,TODAY);
    database.save_execution_capture(TODAY,capture(&selected)).unwrap();
    let original = serde_json::to_value(execution_snapshot(&database.connection,&selected).unwrap()).unwrap();
    database.save_execution_capture(TODAY,ExecutionCaptureInput { plan_block_id:selected.clone(),outcome:Some(ReviewOutcome::Completed),note:Some("new note".into()) }).unwrap();
    let latest = undo(&database);
    assert_eq!(latest.action_kind,"execution_captured");
    database.apply_undo(&latest.id).unwrap();
    assert_eq!(serde_json::to_value(execution_snapshot(&database.connection,&selected).unwrap()).unwrap(),original);
    assert_eq!(database.get_task(&id).unwrap().actual_minutes,13);
    assert_eq!(database.get_task(&id).unwrap().remaining_workload_minutes,Some(90));
    database.save_execution_capture(TODAY,capture(&selected)).unwrap();
    let unsafe_undo = undo(&database);
    database.save_review_entry(TODAY,review(&selected,None)).unwrap();
    assert!(database.apply_undo(&unsafe_undo.id).is_err());
}

#[test]
fn draft_validation_rejects_invalid_json_but_keeps_deleted_recurring_targets_writable() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let id = occurrence(&mut database,TODAY);
    assert!(database.save_review_form_draft(TODAY,"recurring",&id,"{broken",0).is_err());
    assert!(database.save_review_form_draft(TODAY,"unknown",&id,"{}",0).is_err());
    assert!(database.save_review_form_draft("2026-10-15","recurring",&id,"{}",0).is_err());
    assert!(database.save_review_form_draft(TODAY,"recurring",&id,"{}",-1).is_err());
    assert!(database.list_review_form_drafts(TODAY).unwrap().is_empty());
    database.save_review_form_draft(TODAY,"recurring",&id,"{}",0).unwrap();
    let item_id = load_occurrence(&database.connection,&id).unwrap().recurring_item_id;
    database.set_recurring_item_status(&item_id,"ended").unwrap();
    database.soft_delete_recurring_item(&item_id,true).unwrap();
    assert!(database.save_review_form_draft(TODAY,"recurring",&id,"{}",1).is_ok());
    assert!(database.save_recurring_occurrence_review(&id,repeat_review("completed",None)).is_ok());
}

#[test]
fn cumulative_minutes_overflow_is_rejected_before_any_review_fact_commits() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let id = task(&mut database);
    let selected = block(&database,&id,TODAY);
    database.connection.execute("UPDATE tasks SET actual_minutes = ?2 WHERE id = ?1",params![id,i64::MAX]).unwrap();
    let before = fact_fingerprint(&database.connection,"task_completion",&id).unwrap();
    assert!(database.save_review_entry(TODAY,review(&selected,Some(1))).is_err());
    assert_eq!(fact_fingerprint(&database.connection,"task_completion",&id).unwrap(),before);
    database.save_review_entry(TODAY,review(&selected,None)).unwrap();
    assert_eq!(database.get_task(&id).unwrap().actual_minutes,i64::MAX);
}

#[test]
fn historical_unknown_minutes_do_not_guess_actuals_or_submit_drafts_automatically() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let id = task(&mut database);
    let selected = block(&database,&id,"2026-10-10");
    let before = database.get_task(&id).unwrap();
    database.save_review_form_draft("2026-10-10","task",&selected,"{\"actual_minutes\":42}",0).unwrap();
    assert_eq!(database.count("review_entries").unwrap(),0);
    database.save_review_entry("2026-10-10",review(&selected,None)).unwrap();
    let saved = database.get_task(&id).unwrap();
    assert_eq!(saved.status, "done");
    assert_eq!(saved.remaining_workload_minutes, Some(0));
    assert_eq!(saved.actual_minutes, before.actual_minutes);
    assert_eq!(saved.total_workload_minutes, before.total_workload_minutes);
    assert_eq!(database.get_review_entry_for_block(&selected).unwrap().actual_minutes,None);
}

#[test]
fn historical_light_result_syncs_task_preserves_actuals_and_rejects_cancellation_but_allows_later_capture() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let task_id = task(&mut database);
    let id = block(&database, &task_id, "2026-10-15");
    database.save_execution_capture("2026-10-15", capture(&id)).unwrap();
    let before = database.get_task(&task_id).unwrap();
    database.save_execution_capture("2026-10-15", ExecutionCaptureInput {
        plan_block_id: id.clone(), outcome: Some(ReviewOutcome::Completed), note: None,
    }).unwrap();
    assert_eq!(execution_snapshot(&database.connection, &id).unwrap().execution_status, "completed");
    assert_eq!(database.get_task(&task_id).unwrap().status, "done");
    let facts = |database: &Database| json!([
        fact_fingerprint(&database.connection, "task_completion", &task_id).unwrap(),
        fact_rows(&database.connection, "SELECT * FROM task_completion_snapshots WHERE task_id = ?1", &task_id).unwrap(),
        fact_rows(&database.connection, "SELECT * FROM undo_entries WHERE target_id = ?1 ORDER BY id", &task_id).unwrap(),
        fact_rows(&database.connection, "SELECT * FROM review_form_drafts WHERE item_id = ?1 ORDER BY review_date,item_type", &id).unwrap(),
    ]);
    let completed = facts(&database);
    let mut corrected = review(&id, Some(20));
    corrected.outcome = ReviewOutcome::NotStarted;
    assert!(database.save_review_entry("2026-10-15", corrected).is_err());
    assert_eq!(facts(&database), completed);
    // Supplementing a completed historical result is still allowed without reopening it.
    let supplement = database.save_review_entry("2026-10-15", review(&id, Some(20))).unwrap();
    assert_eq!(supplement.outcome, "completed");
    assert_eq!(supplement.actual_minutes, Some(20));
    assert_eq!(supplement.notes.as_deref(), Some("saved detail"));
    let saved = database.get_task(&task_id).unwrap();
    assert_eq!(saved.status, "done");
    assert!(!saved.is_incomplete);
    assert_eq!(saved.actual_minutes, before.actual_minutes);
    assert_eq!(saved.remaining_workload_minutes, Some(0));
    let today_block = block(&database, &task_id, TODAY);
    database.save_execution_capture(TODAY, capture(&today_block)).unwrap();
    database.save_execution_capture(TODAY, ExecutionCaptureInput {
        plan_block_id: today_block.clone(), outcome: Some(ReviewOutcome::Completed), note: None,
    }).unwrap();
    assert_eq!(execution_snapshot(&database.connection, &today_block).unwrap().execution_status, "completed");
}

#[test]
fn timeline_capture_preserves_unsubmitted_supplement_and_rebases_its_revision() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let task_id = task(&mut database);
    let id = block(&database, &task_id, TODAY);
    let input = json!({"result":null,"outcome":null,"actual_minutes":"37","defer_reason":"pending reason","notes":"long note ".repeat(100),"remaining_workload_minutes":"80"}).to_string();
    let draft = database.save_review_form_draft(TODAY,"task",&id,&input,0).unwrap();
    database.save_execution_capture(TODAY,capture(&id)).unwrap();
    let restored = database.list_review_form_drafts(TODAY).unwrap().into_iter().find(|value| value.item_id == id).unwrap();
    let payload: serde_json::Value = serde_json::from_str(&restored.payload_json).unwrap();
    assert_eq!(payload["actual_minutes"],"37");
    assert_eq!(payload["defer_reason"],"pending reason");
    assert_eq!(payload["notes"],"long note ".repeat(100));
    assert_eq!(payload["remaining_workload_minutes"],"80");
    assert!(payload.get("outcome").is_none(),"restored result must come from the newly captured fact");
    assert!(restored.revision > draft.revision);
    assert!(database.save_review_form_draft(TODAY,"task",&id,&input,draft.revision).is_err());
    assert_eq!(database.get_task(&task_id).unwrap().actual_minutes,13,"drafts never count as formal actuals");
}
