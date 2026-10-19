use super::*;
use serde_json::json;

const TODAY: &str = "2026-10-16";
const NEXT: &str = "2026-10-17";

fn timestamp(date: &str, time: &str) -> String { format!("{date}T{time}:00+08:00") }

fn fixture(database: &mut Database, cross_day: bool) -> (String, String) {
    let id = database.create_manual_task("Execution resolution fixture").unwrap();
    let end = if cross_day { "2026-10-19" } else { TODAY };
    database.connection.execute("UPDATE tasks SET earliest_start_at = ?2, due_at = ?3,
        earliest_start_date = ?4, earliest_start_time = '09:00', due_date = ?5, due_time = '10:00',
        estimated_minutes = 120, total_workload_minutes = 120, remaining_workload_minutes = 90,
        actual_minutes = 13, status = 'scheduled', notes = 'task metadata' WHERE id = ?1",
        params![id, timestamp(TODAY,"09:00"), timestamp(end,"10:00"), TODAY, end]).unwrap();
    let block = block(database, &id, TODAY);
    (id, block)
}

fn block(database: &Database, task_id: &str, date: &str) -> String {
    let plan_id: String = database.connection.query_row("SELECT id FROM daily_plans WHERE plan_date = ?1 AND status = 'confirmed'", [date], |row| row.get(0))
        .optional().unwrap().unwrap_or_else(|| {
            let id = Uuid::new_v4().to_string();
            database.connection.execute("INSERT INTO daily_plans (id,plan_date,status,source,created_at,confirmed_at) VALUES (?1,?2,'confirmed','manual',?3,?3)",params![id,date,now()]).unwrap();
            id
        });
    let id = Uuid::new_v4().to_string();
    database.connection.execute("INSERT INTO plan_blocks (id,daily_plan_id,task_id,starts_at,ends_at,source,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,'manual',?6,?6)",
        params![id,plan_id,task_id,timestamp(date,"09:00"),timestamp(date,"10:00"),now()]).unwrap();
    id
}

fn input(database: &Database, id: &str, block: &str, action: &str) -> TaskExecutionResolutionInput {
    TaskExecutionResolutionInput { plan_block_id: block.into(), expected_task_updated_at: database.get_task(id).unwrap().updated_at,
        outcome: ReviewOutcome::Partial, note: Some(" recorded result ".into()), next_action: Some(action.into()),
        starts_at: (action == "schedule").then(|| timestamp(NEXT,"14:00")),
        ends_at: (action == "schedule").then(|| timestamp(NEXT,"14:45")), remaining_workload_minutes: None }
}

fn rows(database: &Database, id: &str) -> Vec<Vec<String>> {
    fact_rows(&database.connection,"SELECT * FROM plan_blocks WHERE id = ?1",id).unwrap()
}

fn assert_unlocked(database: &Database, id: &str) {
    assert!(!database.get_task(id).unwrap().execution_locked);
    assert!(!database.list_tasks(false,None).unwrap().into_iter().find(|task| task.id == id).unwrap().execution_locked);
    let transaction = database.connection.unchecked_transaction().unwrap();
    assert!(!load_task_dto_in_transaction(&transaction,id).unwrap().execution_locked);
    transaction.rollback().unwrap();
}

#[test]
fn completion_with_optional_note_is_direct_done_zero_and_undoable_without_review() {
    let _clock = TestToday::new(TODAY);
    for note in [None, Some(" final note ".to_owned())] {
        let mut database = Database::in_memory().unwrap();
        let (id, selected) = fixture(&mut database,false);
        let other = block(&database,&id,NEXT);
        let original = rows(&database,&selected);
        let untouched = rows(&database,&other);
        let result = database.complete_task_with_note(&id,Some(&selected),note.clone()).unwrap();
        assert_eq!(result.status,"done");
        assert_eq!(result.remaining_workload_minutes,Some(0));
        assert_eq!(result.actual_minutes,13);
        assert_eq!(database.count("review_entries").unwrap(),0);
        let captured = execution_snapshot(&database.connection,&selected).unwrap();
        assert_eq!(captured.execution_status,"completed");
        assert!(!captured.review_required);
        assert_eq!(captured.execution_note,note.map(|note| note.trim().to_owned()));
        assert_eq!(rows(&database,&other),untouched);
        database.apply_undo(&database.latest_undo().unwrap().unwrap().id).unwrap();
        assert_eq!(database.get_task(&id).unwrap().remaining_workload_minutes,Some(90));
        // Undo restores fact columns; updated_at is an audit timestamp, not a fact.
        assert_eq!(execution_snapshot(&database.connection,&selected).unwrap().execution_status,"planned");
        assert_eq!(rows(&database,&selected)[0][0],original[0][0]);
        assert_eq!(rows(&database,&other),untouched);
    }
}

#[test]
fn completed_resolution_routes_to_completion_and_does_not_need_confirmation() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let (id, selected) = fixture(&mut database,false);
    let mut request = input(&database,&id,&selected,"wait");
    request.outcome = ReviewOutcome::Completed;
    request.next_action = None;
    let result = database.resolve_task_execution(TODAY,request).unwrap();
    assert_eq!((result.status.as_str(),result.remaining_workload_minutes),("done",Some(0)));
    assert_eq!(execution_snapshot(&database.connection,&selected).unwrap().execution_note.as_deref(),Some("recorded result"));
    assert_eq!(database.count("review_entries").unwrap(),0);
    database.apply_undo(&database.latest_undo().unwrap().unwrap().id).unwrap();
    assert_eq!(database.get_task(&id).unwrap().status,"scheduled");
}

#[test]
fn schedule_single_and_cross_day_preserves_facts_and_workload_and_can_edit_new_block() {
    let _clock = TestToday::new(TODAY);
    for cross_day in [false,true] {
        for explicit in [None,Some(75)] {
            let mut database = Database::in_memory().unwrap();
            let (id, selected) = fixture(&mut database,cross_day);
            let old_start = timestamp(TODAY,"09:00");
            let old_end = timestamp(TODAY,"10:00");
            let mut request = input(&database,&id,&selected,"schedule");
            request.remaining_workload_minutes = explicit;
            let result = database.resolve_task_execution(TODAY,request).unwrap();
            assert_eq!(result.status,"scheduled");
            assert_eq!(result.total_workload_minutes,Some(120));
            assert_eq!(result.remaining_workload_minutes,explicit.or(Some(90)));
            assert_eq!(result.actual_minutes,13);
            assert_eq!(result.earliest_start_at,Some(timestamp(NEXT,"14:00")));
            assert_eq!(result.due_at,Some(timestamp(NEXT,"14:45")));
            assert_eq!(result.reserved_minutes,45,"old final block releases reservation");
            assert_unlocked(&database,&id);
            let original = database.get_day_schedule(TODAY).unwrap().task_blocks.remove(0);
            assert_eq!((original.starts_at,original.ends_at),(old_start,old_end));
            assert!(!original.review_required);
            let review = original.review.unwrap();
            assert_eq!(review.followup_action.as_deref(),Some("schedule"));
            assert_eq!(review.actual_minutes,None);
            assert_eq!(review.notes.as_deref(),Some("recorded result"));
            assert_eq!(database.get_review_entry_for_block(&selected).unwrap().followup_action,review.followup_action);
            let fact = rows(&database,&selected);
            let final_review = fact_rows(&database.connection,"SELECT * FROM review_entries WHERE plan_block_id = ?1",&selected).unwrap();
            let history = block(&database,&id,"2026-10-15");
            let history_fact = rows(&database,&history);
            let future = database.get_day_schedule(NEXT).unwrap().task_blocks.remove(0);
            database.update_plan_block_time(PlanBlockTimeUpdate { plan_date:NEXT.into(), block_id:future.id,
                expected_starts_at:future.starts_at, expected_ends_at:future.ends_at,
                starts_at:timestamp(NEXT,"15:00"), ends_at:timestamp(NEXT,"15:45") }).unwrap();
            assert_eq!(rows(&database,&selected),fact);
            assert_eq!(rows(&database,&history),history_fact);
            assert_eq!(fact_rows(&database.connection,"SELECT * FROM review_entries WHERE plan_block_id = ?1",&selected).unwrap(),final_review);
            assert_eq!(database.get_task(&id).unwrap().total_workload_minutes,Some(120));
            assert_eq!(database.get_task(&id).unwrap().remaining_workload_minutes,explicit.or(Some(90)));
        }
    }
}

#[test]
fn wait_keeps_boundaries_releases_reservations_and_existing_editor_creates_next_schedule() {
    let _clock = TestToday::new(TODAY);
    for cross_day in [false,true] {
        for explicit in [None,Some(65)] {
            let mut database = Database::in_memory().unwrap();
            let (id, selected) = fixture(&mut database,cross_day);
            block(&database,&id,NEXT);
            let before = database.get_task(&id).unwrap();
            let mut request = input(&database,&id,&selected,"wait");
            request.remaining_workload_minutes = explicit;
            let result = database.resolve_task_execution(TODAY,request).unwrap();
            assert_eq!(result.status,"open");
            assert_eq!(result.reserved_minutes,0);
            assert_eq!(result.earliest_start_at,before.earliest_start_at);
            assert_eq!(result.due_at,before.due_at);
            assert_eq!(result.remaining_workload_minutes,explicit.or(Some(90)));
            assert_eq!(database.get_review_entry_for_block(&selected).unwrap().followup_action.as_deref(),Some("wait"));
            assert_unlocked(&database,&id);
            let fact = rows(&database,&selected);
            let history = block(&database,&id,"2026-10-15");
            let history_fact = rows(&database,&history);
            let updated = database.update_manual_task(&id, ManualTaskUpdate { title:result.title, notes:result.notes,
                priority:None, earliest_start_at:Some(timestamp(NEXT,"16:00")), due_at:Some(timestamp(NEXT,"16:45")), estimated_minutes:Some(120) }).unwrap();
            assert_eq!(updated.status,"scheduled");
            assert_eq!(updated.total_workload_minutes,Some(120));
            assert_eq!(updated.remaining_workload_minutes,explicit.or(Some(90)));
            assert_eq!(database.get_day_schedule(NEXT).unwrap().task_blocks.len(),1);
            assert_eq!(rows(&database,&selected),fact);
            assert_eq!(rows(&database,&history),history_fact);
        }
    }
}

#[test]
fn resolution_removes_only_replaceable_current_future_blocks_and_never_other_tasks() {
    let _clock = TestToday::new(TODAY);
    for action in ["schedule","wait","stop"] {
        let mut database = Database::in_memory().unwrap();
        let (id, selected) = fixture(&mut database,true);
        let history = block(&database,&id,"2026-10-15");
        let old = rows(&database,&history);
        let executed = block(&database,&id,NEXT);
        database.connection.execute("UPDATE plan_blocks SET execution_status = 'blocked', execution_captured_at = ?2 WHERE id = ?1",params![executed,now()]).unwrap();
        let fact = rows(&database,&executed);
        let replaceable = block(&database,&id,NEXT);
        let same_day = block(&database,&id,TODAY);
        let (other_id,other_block) = fixture(&mut database,false);
        let other = fact_fingerprint(&database.connection,"task_completion",&other_id).unwrap();
        let request = input(&database,&id,&selected,action);
        database.resolve_task_execution(TODAY,request).unwrap();
        assert!(rows(&database,&replaceable).is_empty());
        assert!(rows(&database,&same_day).is_empty());
        assert!(!rows(&database,&selected).is_empty());
        assert_eq!(rows(&database,&history),old);
        assert_eq!(rows(&database,&executed),fact);
        assert!(!rows(&database,&other_block).is_empty());
        assert_eq!(fact_fingerprint(&database.connection,"task_completion",&other_id).unwrap(),other);
    }
}

#[test]
fn stopped_task_recovers_open_with_metadata_and_final_result_without_phantom_schedule() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let (id, selected) = fixture(&mut database,true);
    block(&database,&id,NEXT);
    let request = input(&database,&id,&selected,"stop");
    assert_eq!(database.resolve_task_execution(TODAY,request).unwrap().status,"deleted");
    let fact = rows(&database,&selected);
    let record = database.get_review_entry_for_block(&selected).unwrap();
    assert_eq!(record.followup_action.as_deref(),Some("stop"));
    database.restore_task(&id).unwrap();
    let restored = database.get_task(&id).unwrap();
    assert_eq!(restored.status,"open");
    assert_eq!(restored.notes.as_deref(),Some("task metadata"));
    assert_eq!(restored.remaining_workload_minutes,Some(90));
    assert_eq!(restored.actual_minutes,13);
    assert_eq!(restored.reserved_minutes,0);
    assert_eq!(rows(&database,&selected),fact);
    assert_eq!(database.get_review_entry_for_block(&selected).unwrap().id,record.id);
    assert!(load_task_schedule_blocks(&database.connection,&id).unwrap().is_empty());
}

#[test]
fn all_noncompleted_outcomes_and_today_schedule_are_supported_without_implicit_deduction() {
    let _clock = TestToday::new(TODAY);
    for outcome in [ReviewOutcome::Partial,ReviewOutcome::NotStarted,ReviewOutcome::Cancelled,ReviewOutcome::Blocked] {
        let mut database = Database::in_memory().unwrap();
        let (id, selected) = fixture(&mut database,false);
        let mut request = input(&database,&id,&selected,"schedule");
        request.starts_at = Some(timestamp(TODAY,"15:00"));
        request.ends_at = Some(timestamp(TODAY,"15:15"));
        request.outcome = outcome;
        let result = database.resolve_task_execution(TODAY,request).unwrap();
        assert_eq!(result.remaining_workload_minutes,Some(90));
        assert_eq!(database.get_day_schedule(TODAY).unwrap().task_blocks.len(),2);
        assert_unlocked(&database,&id);
    }
}

#[test]
fn malformed_actions_dates_estimates_and_followup_fields_are_rejected_atomically() {
    let _clock = TestToday::new(TODAY);
    for case in ["missing_action","bad_action","missing_start","missing_end","malformed","wrong_offset","noncanonical","past","cross_day","short","reversed","too_long","negative","zero","tiny","bound","over_explicit","wait_start","stop_end","stop_remaining","completed_action","completed_remaining","note","stale","missing_block","wrong_date","history","future","invalid_date"] {
        let mut database = Database::in_memory().unwrap();
        let (id, selected) = fixture(&mut database,false);
        block(&database,&id,NEXT);
        let mut request = input(&database,&id,&selected,"schedule");
        let mut date = TODAY;
        match case {
            "missing_action" => request.next_action = None,
            "bad_action" => request.next_action = Some("review".into()),
            "missing_start" => request.starts_at = None,
            "missing_end" => request.ends_at = None,
            "malformed" => request.starts_at = Some("broken".into()),
            "wrong_offset" => request.starts_at = Some("2026-10-17T14:00:00Z".into()),
            "noncanonical" => request.starts_at = Some("2026-10-17t14:00:00+08:00".into()),
            "past" => { request.starts_at = Some(timestamp("2026-10-15","14:00")); request.ends_at = Some(timestamp("2026-10-15","15:00")); },
            "cross_day" => request.ends_at = Some(timestamp("2026-10-18","14:45")),
            "short" => request.ends_at = Some(timestamp(NEXT,"14:14")),
            "reversed" => request.ends_at = Some(timestamp(NEXT,"13:00")),
            "too_long" => request.ends_at = Some(timestamp(NEXT,"15:31")),
            "negative" => request.remaining_workload_minutes = Some(-1),
            "tiny" => request.remaining_workload_minutes = Some(14),
            "zero" => request.remaining_workload_minutes = Some(0),
            "over_explicit" => request.remaining_workload_minutes = Some(15),
            "bound" => request.remaining_workload_minutes = Some(525_601),
            "wait_start" => request.next_action = Some("wait".into()),
            "stop_end" => { request.next_action = Some("stop".into()); request.starts_at = None; },
            "stop_remaining" => { request.next_action = Some("stop".into()); request.starts_at = None; request.ends_at = None; request.remaining_workload_minutes = Some(30); },
            "completed_action" => request.outcome = ReviewOutcome::Completed,
            "completed_remaining" => { request.outcome = ReviewOutcome::Completed; request.next_action = None; request.starts_at = None; request.ends_at = None; request.remaining_workload_minutes = Some(0); },
            "note" => request.note = Some("x".repeat(501)),
            "stale" => request.expected_task_updated_at = "stale".into(),
            "missing_block" => request.plan_block_id = "missing".into(),
            "wrong_date" => request.plan_block_id = block(&database,&id,NEXT),
            "history" => { date = "2026-10-15"; request.plan_block_id = block(&database,&id,date); },
            "future" => date = NEXT,
            "invalid_date" => date = "2026-02-30",
            _ => unreachable!(),
        }
        let before = fact_fingerprint(&database.connection,"task_completion",&id).unwrap();
        let plan_count = database.count("daily_plans").unwrap();
        assert!(database.resolve_task_execution(date,request).is_err(),"{case}");
        assert_eq!(fact_fingerprint(&database.connection,"task_completion",&id).unwrap(),before,"{case}");
        assert_eq!(database.count("daily_plans").unwrap(),plan_count,"{case}");
    }
    assert!(serde_json::from_value::<TaskExecutionResolutionInput>(json!({"plan_block_id":"x","expected_task_updated_at":"x","outcome":"partial","next_action":"wait","confirmed":true})).is_err());
}

#[test]
fn done_deleted_and_duplicate_final_results_are_rejected_without_changes() {
    let _clock = TestToday::new(TODAY);
    for status in ["done","deleted","duplicate"] {
        let mut database = Database::in_memory().unwrap();
        let (id, selected) = fixture(&mut database,false);
        if status == "duplicate" {
            let request = input(&database,&id,&selected,"wait");
            database.resolve_task_execution(TODAY,request).unwrap();
        } else {
            database.connection.execute("UPDATE tasks SET status = ?2 WHERE id = ?1",params![id,status]).unwrap();
        }
        let request = input(&database,&id,&selected,"wait");
        let before = fact_fingerprint(&database.connection,"task_completion",&id).unwrap();
        assert!(database.resolve_task_execution(TODAY,request).is_err());
        assert_eq!(fact_fingerprint(&database.connection,"task_completion",&id).unwrap(),before);
    }
}

#[test]
fn sql_failure_rolls_back_result_capture_task_estimate_deletions_and_new_plan() {
    let _clock = TestToday::new(TODAY);
    for failure in ["new_block","task","task_change","completion"] {
        let mut database = Database::in_memory().unwrap();
        let (id, selected) = fixture(&mut database,true);
        block(&database,&id,TODAY); // Must be restored if failure occurs after deletion.
        block(&database,&id,"2026-10-15");
        let mut request = input(&database,&id,&selected,"schedule");
        request.remaining_workload_minutes = Some(60);
        let trigger = match failure {
            "new_block" => "CREATE TRIGGER fail_resolution BEFORE INSERT ON plan_blocks BEGIN SELECT RAISE(ABORT, 'simulated block failure'); END;",
            "task" => "CREATE TRIGGER fail_resolution BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT, 'simulated task failure'); END;",
            "task_change" => "CREATE TRIGGER fail_resolution BEFORE INSERT ON task_changes BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END;",
            "completion" => {
                request.outcome = ReviewOutcome::Completed; request.next_action = None; request.starts_at = None; request.ends_at = None; request.remaining_workload_minutes = None;
                "CREATE TRIGGER fail_resolution BEFORE INSERT ON undo_entries BEGIN SELECT RAISE(ABORT, 'simulated undo failure'); END;"
            }
            _ => unreachable!(),
        };
        database.save_review_form_draft(TODAY,"task",&selected,"{}",0).unwrap();
        database.connection.execute_batch(trigger).unwrap();
        let before = fact_fingerprint(&database.connection,"task_completion",&id).unwrap();
        let plans = database.count("daily_plans").unwrap();
        assert!(database.resolve_task_execution(TODAY,request).is_err(),"{failure}");
        assert_eq!(fact_fingerprint(&database.connection,"task_completion",&id).unwrap(),before,"{failure}");
        assert_eq!(database.count("daily_plans").unwrap(),plans);
        assert_eq!(database.count("review_entries").unwrap(),0);
        assert_eq!(database.list_review_form_drafts(TODAY).unwrap()[0].revision,1);
    }
}

#[test]
fn explicit_followup_does_not_unlock_unresolved_legacy_execution_facts() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let (id, selected) = fixture(&mut database,false);
    let history = block(&database,&id,"2026-10-15");
    database.connection.execute("UPDATE plan_blocks SET execution_status = 'blocked' WHERE id = ?1",[&history]).unwrap();
    let request = input(&database,&id,&selected,"wait");
    database.resolve_task_execution(TODAY,request).unwrap();
    assert!(database.get_task(&id).unwrap().execution_locked);
    assert!(!can_sync_single_day_task(&database.connection,&id,Some(&timestamp(NEXT,"14:00")),Some(&timestamp(NEXT,"15:00"))).unwrap());
}

#[test]
fn missing_estimate_uses_original_block_duration_and_explicit_minimum_is_valid() {
    let _clock = TestToday::new(TODAY);
    for explicit in [None,Some(15)] {
        let mut database = Database::in_memory().unwrap();
        let (id, selected) = fixture(&mut database,false);
        database.connection.execute("UPDATE tasks SET estimated_minutes = NULL, total_workload_minutes = NULL, remaining_workload_minutes = NULL WHERE id = ?1",[&id]).unwrap();
        let mut request = input(&database,&id,&selected,"schedule");
        request.remaining_workload_minutes = explicit;
        request.ends_at = Some(timestamp(NEXT,if explicit.is_some() { "14:15" } else { "15:01" }));
        if explicit.is_none() {
            assert!(database.resolve_task_execution(TODAY,request.clone()).is_err());
            request.ends_at = Some(timestamp(NEXT,"15:00"));
        }
        let result = database.resolve_task_execution(TODAY,request).unwrap();
        assert_eq!(result.remaining_workload_minutes,explicit);
        assert_eq!(result.total_workload_minutes,None);
    }
}

#[test]
fn migration_v23_preserves_existing_records_and_adds_nullable_checked_action() {
    let _clock = TestToday::new(TODAY);
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);").unwrap();
    for (version, sql) in MIGRATIONS.iter().filter(|(version,_)| *version <= 22) {
        connection.execute_batch(sql).unwrap();
        connection.execute("INSERT INTO schema_migrations VALUES (?1,?2)",params![version,now()]).unwrap();
    }
    let mut database = Database { connection };
    let (id, selected) = fixture(&mut database,true);
    database.connection.execute("INSERT INTO review_entries (id,review_date,plan_block_id,task_id,outcome,actual_minutes,notes,created_at,updated_at)
        VALUES ('legacy',?1,?2,?3,'partial',27,'legacy note',?4,?4)",params![TODAY,selected,id,now()]).unwrap();
    database.migrate().unwrap();
    database.migrate().unwrap();
    let saved = database.get_review_entry_for_block(&selected).unwrap();
    assert_eq!(saved.id,"legacy");
    assert_eq!(saved.actual_minutes,Some(27));
    assert_eq!(saved.notes.as_deref(),Some("legacy note"));
    assert_eq!(saved.followup_action,None);
    assert!(database.connection.execute("UPDATE review_entries SET followup_action = 'review' WHERE id = 'legacy'",[]).is_err());
    let version: i64 = database.connection.query_row("SELECT MAX(version) FROM schema_migrations",[],|row|row.get(0)).unwrap();
    assert_eq!(version, MIGRATIONS.last().unwrap().0);
}

#[test]
fn completion_note_never_rewrites_a_selected_final_review_or_historical_facts() {
    let _clock = TestToday::new(TODAY);
    let mut database = Database::in_memory().unwrap();
    let (id, selected) = fixture(&mut database,true);
    let history = block(&database,&id,"2026-10-15");
    database.save_review_entry(TODAY,ReviewEntryInput { plan_block_id:selected.clone(), outcome:ReviewOutcome::Blocked,
        actual_minutes:Some(7), defer_reason:None, notes:Some("final record".into()), remaining_workload_minutes:None }).unwrap();
    let selected_fact = rows(&database,&selected);
    let history_fact = rows(&database,&history);
    let review = fact_rows(&database.connection,"SELECT * FROM review_entries WHERE task_id = ?1",&id).unwrap();
    let completed = database.complete_task_with_note(&id,Some(&selected),Some("completion note".into())).unwrap();
    assert_eq!(completed.status,"done");
    assert_eq!(completed.remaining_workload_minutes,Some(0));
    assert_eq!(rows(&database,&selected),selected_fact);
    assert_eq!(rows(&database,&history),history_fact);
    database.apply_undo(&database.latest_undo().unwrap().unwrap().id).unwrap();
    assert_eq!(rows(&database,&selected),selected_fact);
    assert_eq!(rows(&database,&history),history_fact);
    assert_eq!(fact_rows(&database.connection,"SELECT * FROM review_entries WHERE task_id = ?1",&id).unwrap(),review);
}

#[test]
fn stopped_single_day_and_cross_day_tasks_can_be_scheduled_again_after_recovery() {
    let _clock = TestToday::new(TODAY);
    for cross_day in [false, true] {
        let mut database = Database::in_memory().unwrap();
        let (id, selected) = fixture(&mut database, cross_day);
        let request = input(&database, &id, &selected, "stop");
        database.resolve_task_execution(TODAY, request).unwrap();
        let original_fact = rows(&database, &selected);
        let record = fact_rows(&database.connection, "SELECT * FROM review_entries WHERE plan_block_id = ?1", &selected).unwrap();
        database.restore_task(&id).unwrap();
        assert_unlocked(&database, &id);
        let restored = database.get_task(&id).unwrap();
        let updated = database.update_manual_task(&id, ManualTaskUpdate {
            title: restored.title, notes: restored.notes, priority: None,
            earliest_start_at: Some(timestamp(NEXT, "16:00")), due_at: Some(timestamp(NEXT, "16:45")),
            estimated_minutes: Some(120),
        }).unwrap();
        assert_eq!(updated.status, "scheduled");
        assert_eq!(updated.remaining_workload_minutes, Some(90));
        assert_eq!(updated.total_workload_minutes, Some(120));
        assert_eq!(database.get_day_schedule(NEXT).unwrap().task_blocks.len(), 1);
        assert_eq!(rows(&database, &selected), original_fact);
        assert_eq!(fact_rows(&database.connection, "SELECT * FROM review_entries WHERE plan_block_id = ?1", &selected).unwrap(), record);
    }
}

#[test]
fn confirming_other_day_plan_invalidates_stale_resolution_without_deleting_new_schedule() {
    let _clock = TestToday::new(TODAY);
    for change in ["create", "adjust", "remove"] {
        for action in ["schedule", "wait", "stop"] {
            let mut database = Database::in_memory().unwrap();
            let (id, selected) = fixture(&mut database, true);
            let base_plan_id = if change == "create" { None } else {
                block(&database, &id, NEXT);
                database.get_day_schedule(NEXT).unwrap().plan_id
            };
            let stale = input(&database, &id, &selected, action);
            let blocks = if change == "remove" { Vec::new() } else { vec![RulePlanBlock {
                task_id: id.clone(), task_title: "Execution resolution fixture".into(),
                starts_at: timestamp(NEXT, "09:15"), ends_at: timestamp(NEXT, "09:30"), estimated_minutes: 15,
            }] };
            let draft = database.store_rule_plan_draft(NEXT, blocks, Vec::new(), base_plan_id).unwrap();
            database.confirm_rule_based_plan(draft).unwrap();
            assert_ne!(database.get_task(&id).unwrap().updated_at, stale.expected_task_updated_at, "{change}");
            let facts = fact_fingerprint(&database.connection, "task_completion", &id).unwrap();
            assert!(database.resolve_task_execution(TODAY, stale).is_err(), "{change}/{action}");
            assert_eq!(fact_fingerprint(&database.connection, "task_completion", &id).unwrap(), facts, "{change}/{action}");
            assert_eq!(database.count("review_entries").unwrap(), 0);
        }
    }
}
