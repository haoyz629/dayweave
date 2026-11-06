use super::*;

const TODAY: &str = "2026-10-16";

fn rule(title: &str) -> RecurringItemInput {
    RecurringItemInput {
        title: title.into(), notes: None, frequency: "daily".into(), interval_value: 1,
        weekdays: vec![], month_day: None, starts_on: "2026-01-01".into(), ends_on: None,
        display_time: Some("09:00".into()), display_duration_minutes: Some(30), tags: vec![],
    }
}

fn occurrence(db: &mut Database, item: &str, date: &str) -> RecurringOccurrenceDto {
    db.list_recurring_occurrences(date).unwrap().into_iter().find(|o| o.recurring_item_id == item).unwrap()
}

fn save(db: &mut Database, id: &str, outcome: &str, notes: Option<&str>) -> RecurringOccurrenceDto {
    db.save_recurring_occurrence_review(id, RecurringOccurrenceReviewInput {
        outcome: Some(outcome.into()), notes: notes.map(str::to_owned),
    }).unwrap()
}

fn facts(db: &Database, id: &str) -> String {
    fact_fingerprint(&db.connection, "recurring_review", id).unwrap()
}

fn drafts(db: &Database, id: &str) -> Vec<Vec<String>> {
    fact_rows(&db.connection, "SELECT * FROM review_form_drafts WHERE item_id = ?1", id).unwrap()
}

#[test]
fn recurring_execution_unchecked_and_empty_clear_do_not_invent_results() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(rule("Unchecked")).unwrap();
    let current = occurrence(&mut db, &item.id, TODAY);
    occurrence(&mut db, &item.id, "2026-10-15");
    occurrence(&mut db, &item.id, "2026-10-17");
    assert!(db.list_recurring_execution_history(&item.id).unwrap().is_empty());
    assert_eq!(db.clear_recurring_occurrence_review(&current.id).unwrap(), current);
    assert_eq!(db.clear_recurring_occurrence_review(&current.id).unwrap(), current);
    assert!(db.list_recurring_execution_history(&item.id).unwrap().is_empty());
    assert!(db.latest_undo().unwrap().is_none());
}

#[test]
fn recurring_execution_save_is_normalized_idempotent_and_clear_recomplete_is_real_history() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(rule("Cycle")).unwrap();
    let current = occurrence(&mut db, &item.id, TODAY);
    let first = save(&mut db, &current.id, "completed", Some("  done  "));
    let undo = db.latest_undo().unwrap().unwrap();
    for _ in 0..3 {
        assert_eq!(save(&mut db, &current.id, "completed", Some("done")), first);
        assert_eq!(db.latest_undo().unwrap().unwrap().id, undo.id);
    }
    assert_eq!(db.list_recurring_execution_history(&item.id).unwrap().len(), 1);
    let cleared = db.clear_recurring_occurrence_review(&current.id).unwrap();
    assert_eq!(cleared.outcome, None);
    assert_eq!(cleared.review_notes, None);
    assert_eq!(cleared.reviewed_at, None);
    assert_eq!(db.clear_recurring_occurrence_review(&current.id).unwrap(), cleared);
    assert!(db.apply_undo(&undo.id).is_err());
    let repeated = save(&mut db, &current.id, "completed", Some("done"));
    assert_ne!(first.reviewed_at, repeated.reviewed_at);
    save(&mut db, &current.id, "completed", Some("changed note"));
    save(&mut db, &current.id, "partial", Some("changed note"));
    save(&mut db, &current.id, "not_completed", Some("  "));
    let no_note = load_occurrence(&db.connection, &current.id).unwrap();
    assert_eq!(save(&mut db, &current.id, "not_completed", None), no_note);
    let events = db.list_recurring_execution_history(&item.id).unwrap();
    assert_eq!(events.iter().map(|e| e.outcome.as_deref()).collect::<Vec<_>>(),
        vec![Some("completed"), None, Some("completed"), Some("completed"), Some("partial"), Some("not_completed")]);
    assert_eq!(events[0].notes.as_deref(), Some("done"));
    assert_eq!(events[1].notes, None);
    assert_eq!(events[5].notes, None);
    assert!(events.windows(2).all(|w| w[0].id.parse::<i64>().unwrap() < w[1].id.parse::<i64>().unwrap()));
    assert!(events.iter().all(|e| e.occurrence_id.as_deref() == Some(current.id.as_str()) && e.kind == "execution"));
    let json = serde_json::to_value(&events[1]).unwrap();
    assert_eq!(json.as_object().unwrap().len(), 10);
    assert_eq!(json["kind"], "execution");
    assert!(json["id"].is_string());
    assert_eq!(json["occurrence_id"], current.id);
    assert_eq!(json["occurrence_date"], TODAY);
    assert_eq!(json["title"], "Cycle");
    assert_eq!(json["display_time"], "09:00");
    assert_eq!(json["display_duration_minutes"], 30);
    assert!(json["outcome"].is_null() && json["notes"].is_null());
    assert!(json["occurred_at"].is_string());
}

#[test]
fn recurring_execution_isolates_series_dates_and_two_same_day_blocks_and_their_drafts() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(rule("Series A")).unwrap();
    let other = db.create_recurring_item(rule("Series B")).unwrap();
    let current = occurrence(&mut db, &item.id, TODAY);
    let past = occurrence(&mut db, &item.id, "2026-10-15");
    let tomorrow = occurrence(&mut db, &item.id, "2026-10-17");
    let other_current = occurrence(&mut db, &other.id, TODAY);
    let mut moved = rule("Second block");
    moved.display_time = Some("14:00".into());
    db.update_recurring_occurrence(&tomorrow.id, moved, TODAY, "this").unwrap();
    assert_eq!(db.list_recurring_occurrences(TODAY).unwrap().iter().filter(|o| o.recurring_item_id == item.id).count(), 2);
    for id in [&current.id, &tomorrow.id, &other_current.id] {
        db.save_review_form_draft(TODAY, "recurring", id, "{\"notes\":\"draft\"}", 0).unwrap();
    }
    let other_draft = drafts(&db, &other_current.id);
    let second_draft = drafts(&db, &tomorrow.id);
    save(&mut db, &current.id, "completed", None);
    assert_eq!(drafts(&db, &other_current.id), other_draft);
    assert_eq!(drafts(&db, &tomorrow.id), second_draft);
    let current_draft = db.list_review_form_drafts(TODAY).unwrap().into_iter().find(|d| d.item_id == current.id).unwrap();
    assert_eq!(current_draft.payload_json, "{}");
    db.save_review_form_draft(TODAY, "recurring", &current.id, "{\"notes\":\"clear me\"}", current_draft.revision).unwrap();
    db.clear_recurring_occurrence_review(&current.id).unwrap();
    assert_eq!(drafts(&db, &other_current.id), other_draft);
    assert_eq!(drafts(&db, &tomorrow.id), second_draft);
    assert_eq!(load_occurrence(&db.connection, &tomorrow.id).unwrap().outcome, None);
    save(&mut db, &tomorrow.id, "partial", Some("second only"));
    save(&mut db, &past.id, "not_completed", None);
    save(&mut db, &other_current.id, "completed", None);
    let history = db.list_recurring_execution_history(&item.id).unwrap();
    assert_eq!(history.iter().map(|e| e.occurrence_id.as_deref()).collect::<Vec<_>>(),
        vec![Some(past.id.as_str()), Some(current.id.as_str()), Some(current.id.as_str()), Some(tomorrow.id.as_str())]);
    assert_eq!(history[3].display_time.as_deref(), Some("14:00"));
    let other_history = db.list_recurring_execution_history(&other.id).unwrap();
    assert_eq!(other_history.len(), 1);
    assert_eq!(other_history[0].occurrence_id.as_deref(), Some(other_current.id.as_str()));
}

#[test]
fn recurring_execution_backfill_uses_actual_operation_time_not_occurrence_date() {
    let _clock = TestNow::new("2026-10-16T00:30:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(rule("Backfill")).unwrap();
    let past = occurrence(&mut db, &item.id, "2026-10-10");
    let saved = save(&mut db, &past.id, "partial", Some("late entry"));
    let events = db.list_recurring_execution_history(&item.id).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].occurrence_date, "2026-10-10");
    assert_eq!(Some(&events[0].occurred_at), saved.reviewed_at.as_ref());
    let actual = DateTime::parse_from_rfc3339(&events[0].occurred_at).unwrap();
    assert_eq!(actual.with_timezone(&FixedOffset::east_opt(8 * 3600).unwrap()).format("%Y-%m-%d").to_string(), TODAY);
    assert_eq!(actual.with_timezone(&Utc).format("%Y-%m-%d").to_string(), "2026-10-15");
}

#[test]
fn recurring_execution_reviewed_exception_and_snapshots_survive_rule_lifecycle_changes() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(rule("Original title")).unwrap();
    let current = occurrence(&mut db, &item.id, TODAY);
    let tomorrow = occurrence(&mut db, &item.id, "2026-10-17");
    save(&mut db, &current.id, "completed", Some("original review"));
    let exception: bool = db.connection.query_row("SELECT is_exception FROM recurring_occurrences WHERE id=?1", [&current.id], |r| r.get(0)).unwrap();
    assert!(exception);
    db.clear_recurring_occurrence_review(&current.id).unwrap();
    db.update_recurring_occurrence(&tomorrow.id, rule("New schedule"), TODAY, "this").unwrap();
    let mut replacement = rule("Future rule");
    replacement.starts_on = "2026-10-20".into();
    replacement.display_time = Some("17:00".into());
    db.update_recurring_occurrence(&tomorrow.id, replacement, "2026-10-20", "future").unwrap();
    assert!(db.list_recurring_occurrences(TODAY).unwrap().iter().any(|o| o.id == current.id));
    save(&mut db, &current.id, "partial", Some("still here"));
    let history = db.list_recurring_execution_history(&item.id).unwrap();
    assert_eq!(history.len(), 3);
    assert!(history.iter().all(|e| e.title == "Original title" && e.display_time.as_deref() == Some("09:00") && e.display_duration_minutes == Some(30)));
    // Even edits to this occurrence must not rewrite already-recorded event snapshots.
    db.update_recurring_occurrence(&current.id, rule("Renamed block"), TODAY, "this").unwrap();
    assert_eq!(db.list_recurring_execution_history(&item.id).unwrap(), history);
    db.set_recurring_item_status(&item.id, "paused").unwrap();
    let paused_history = db.list_recurring_execution_history(&item.id).unwrap();
    assert_eq!(&paused_history[..history.len()], history.as_slice());
    assert_eq!(paused_history.last().unwrap().kind, "paused");
    db.set_recurring_item_status(&item.id, "ended").unwrap();
    let ended_history = db.list_recurring_execution_history(&item.id).unwrap();
    assert_eq!(&ended_history[..history.len()], history.as_slice());
    assert_eq!(ended_history.len(), history.len() + 2);
    assert_eq!(ended_history.last().unwrap().kind, "ended");
    assert_eq!(ended_history.last().unwrap().title, "Future rule");
    db.soft_delete_recurring_item(&item.id, true).unwrap();
    let deleted_history = db.list_recurring_execution_history(&item.id).unwrap();
    assert_eq!(&deleted_history[..ended_history.len()], ended_history.as_slice());
    assert_eq!(deleted_history.last().unwrap().kind, "soft_deleted");
    assert_eq!(load_occurrence(&db.connection, &current.id).unwrap().outcome.as_deref(), Some("partial"));
}

#[test]
fn recurring_execution_permissions_and_rejected_requests_leave_all_facts_unchanged() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(rule("Permissions")).unwrap();
    for (date, allowed) in [("2026-10-09", false), ("2026-10-10", true), ("2026-10-15", true), (TODAY, true), ("2026-10-17", false)] {
        let target = occurrence(&mut db, &item.id, date);
        let before = facts(&db, &target.id);
        let input = || RecurringOccurrenceReviewInput { outcome: Some("completed".into()), notes: None };
        assert_eq!(db.save_recurring_occurrence_review(&target.id, input()).is_ok(), allowed);
        if !allowed { assert_eq!(facts(&db, &target.id), before); }
        let before = facts(&db, &target.id);
        let draft = drafts(&db, &target.id);
        if date != TODAY {
            assert!(db.clear_recurring_occurrence_review(&target.id).is_err());
            assert!(db.save_recurring_occurrence_review(&target.id, input()).is_err());
            assert_eq!(facts(&db, &target.id), before);
            assert_eq!(drafts(&db, &target.id), draft);
        }
    }
    let current = occurrence(&mut db, &item.id, TODAY);
    let before = facts(&db, &current.id);
    for input in [RecurringOccurrenceReviewInput { outcome: Some("invalid".into()), notes: None },
        RecurringOccurrenceReviewInput { outcome: Some("partial".into()), notes: Some("x".repeat(2001)) }] {
        assert!(db.save_recurring_occurrence_review(&current.id, input).is_err());
        assert_eq!(facts(&db, &current.id), before);
    }
    assert!(db.clear_recurring_occurrence_review("missing").is_err());
    db.set_recurring_item_status(&item.id, "ended").unwrap();
    db.soft_delete_recurring_item(&item.id, true).unwrap();
    let before = facts(&db, &current.id);
    // Recycled recurring items keep today's occurrence recordable and cancellable.
    assert!(db.save_recurring_occurrence_review(&current.id, RecurringOccurrenceReviewInput { outcome: Some("completed".into()), notes: Some("recycled note".into()) }).is_ok());
    assert!(db.clear_recurring_occurrence_review(&current.id).is_ok());
    assert_ne!(facts(&db, &current.id), before);
}

#[test]
fn recurring_execution_event_and_draft_failures_roll_back_save_and_clear_atomically() {
    let _clock = TestToday::new(TODAY);
    for failure in ["event", "draft"] {
        let mut db = Database::in_memory().unwrap();
        let item = db.create_recurring_item(rule("Atomic")).unwrap();
        let current = occurrence(&mut db, &item.id, TODAY);
        db.save_review_form_draft(TODAY, "recurring", &current.id, "{\"notes\":\"keep\"}", 0).unwrap();
        let trigger = if failure == "event" {
            "CREATE TRIGGER fail_execution BEFORE INSERT ON recurring_execution_events BEGIN SELECT RAISE(ABORT, 'event failure'); END;"
        } else {
            "CREATE TRIGGER fail_execution BEFORE INSERT ON review_form_drafts BEGIN SELECT RAISE(ABORT, 'draft failure'); END;"
        };
        for clear in [false, true] {
            if clear { save(&mut db, &current.id, "completed", None); }
            let before = facts(&db, &current.id);
            let draft = drafts(&db, &current.id);
            let undo = db.latest_undo().unwrap().map(|e| e.id);
            db.connection.execute_batch(trigger).unwrap();
            let result = if clear { db.clear_recurring_occurrence_review(&current.id) } else {
                db.save_recurring_occurrence_review(&current.id, RecurringOccurrenceReviewInput { outcome: Some("completed".into()), notes: None })
            };
            assert!(result.is_err(), "{failure}, clear={clear}");
            assert_eq!(facts(&db, &current.id), before);
            assert_eq!(drafts(&db, &current.id), draft);
            assert_eq!(db.latest_undo().unwrap().map(|e| e.id), undo);
            db.connection.execute_batch("DROP TRIGGER fail_execution").unwrap();
        }
    }
}

#[test]
fn recurring_execution_migration_backfills_only_known_results_once_and_reopens_durably() {
    let _clock = TestToday::new(TODAY);
    let scratch = std::env::var_os("PI_SCRATCH_DIR").map(std::path::PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let temp = tempfile::tempdir_in(scratch).unwrap();
    let path = temp.path().join("recurring-history.sqlite3");
    let (item_id, reviewed_id, fallback_id, expected) = {
        let mut db = Database::open(&path).unwrap();
        let item = db.create_recurring_item(rule("Legacy snapshot")).unwrap();
        let current = occurrence(&mut db, &item.id, TODAY);
        let past = occurrence(&mut db, &item.id, "2026-10-15");
        occurrence(&mut db, &item.id, "2026-10-14");
        db.connection.execute_batch("DROP TABLE recurring_execution_events;
            DROP TABLE recurring_lifecycle_events;
            ALTER TABLE recurring_status_versions DROP COLUMN occurred_at;
            DELETE FROM schema_migrations WHERE version >= 28;").unwrap();
        db.connection.execute("UPDATE recurring_occurrences SET outcome='partial', review_notes='legacy note', reviewed_at='2026-10-16T03:00:00+00:00', is_exception=0 WHERE id=?1", [&current.id]).unwrap();
        db.connection.execute("UPDATE recurring_occurrences SET outcome='completed', reviewed_at=NULL, updated_at='2026-10-15T05:00:00+00:00' WHERE id=?1", [&past.id]).unwrap();
        db.connection.execute("UPDATE recurring_items SET title='Changed parent', display_time='17:00' WHERE id=?1", [&item.id]).unwrap();
        db.migrate().unwrap();
        let events = db.list_recurring_execution_history(&item.id).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].occurrence_id.as_deref(), Some(past.id.as_str()));
        assert_eq!(events[0].occurred_at, "2026-10-15T05:00:00+00:00");
        assert_eq!(events[1].occurrence_id.as_deref(), Some(current.id.as_str()));
        assert_eq!(events[1].occurred_at, "2026-10-16T03:00:00+00:00");
        assert_eq!(events[1].notes.as_deref(), Some("legacy note"));
        assert!(events.iter().all(|e| e.title == "Legacy snapshot" && e.display_time.as_deref() == Some("09:00")));
        let exception: bool = db.connection.query_row("SELECT is_exception FROM recurring_occurrences WHERE id=?1", [&current.id], |r| r.get(0)).unwrap();
        assert!(exception);
        db.migrate().unwrap();
        assert_eq!(db.list_recurring_execution_history(&item.id).unwrap(), events);
        (item.id, current.id, past.id, events)
    };
    let mut db = Database::open(&path).unwrap();
    assert_eq!(db.list_recurring_execution_history(&item_id).unwrap(), expected);
    assert!(load_occurrence(&db.connection, &fallback_id).unwrap().outcome.is_some());
    db.clear_recurring_occurrence_review(&reviewed_id).unwrap();
    let after = db.list_recurring_execution_history(&item_id).unwrap();
    assert_eq!(after.len(), 3);
    drop(db);
    let db = Database::open(&path).unwrap();
    assert_eq!(db.list_recurring_execution_history(&item_id).unwrap(), after);
}

#[test]
fn recurring_execution_existing_save_undo_appends_result_change_without_losing_history() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(rule("Undo")).unwrap();
    let current = occurrence(&mut db, &item.id, TODAY);
    save(&mut db, &current.id, "completed", None);
    let undo = db.latest_undo().unwrap().unwrap();
    db.apply_undo(&undo.id).unwrap();
    let events = db.list_recurring_execution_history(&item.id).unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].outcome.as_deref(), Some("completed"));
    assert_eq!(events[1].outcome, None);
    save(&mut db, &current.id, "partial", Some("first"));
    save(&mut db, &current.id, "completed", Some("second"));
    let undo = db.latest_undo().unwrap().unwrap();
    db.apply_undo(&undo.id).unwrap();
    let events = db.list_recurring_execution_history(&item.id).unwrap();
    assert_eq!(events.len(), 5);
    assert_eq!(events[4].outcome.as_deref(), Some("partial"));
    assert_eq!(events[4].notes.as_deref(), Some("first"));
}

#[test]
fn recurring_execution_undo_cannot_rewrite_backfilled_or_midnight_locked_results() {
    for midnight in [false, true] {
        let _clock = TestNow::new(if midnight { "2026-10-16T23:59:58+08:00" } else { "2026-10-16T12:00:00+08:00" });
        let mut db = Database::in_memory().unwrap();
        let item = db.create_recurring_item(rule("Locked undo")).unwrap();
        let target = occurrence(&mut db, &item.id, if midnight { TODAY } else { "2026-10-15" });
        save(&mut db, &target.id, "completed", Some("keep historical fact"));
        let undo = db.latest_undo().unwrap().unwrap();
        let before = facts(&db, &target.id);
        let history = db.list_recurring_execution_history(&item.id).unwrap();
        let draft = drafts(&db, &target.id);
        let _after_midnight = midnight.then(|| TestNow::new("2026-10-17T00:00:01+08:00"));
        assert!(undo.expires_at >= now(), "undo is still within its ten-second window");
        assert!(db.apply_undo(&undo.id).is_err(), "historical result must stay locked, midnight={midnight}");
        assert_eq!(facts(&db, &target.id), before);
        assert_eq!(db.list_recurring_execution_history(&item.id).unwrap(), history);
        assert_eq!(drafts(&db, &target.id), draft);
        assert_eq!(db.latest_undo().unwrap().unwrap().id, undo.id);
    }
}

#[test]
fn recurring_execution_end_without_occurrence_records_shanghai_action_and_rejects_duplicates() {
    let _clock = TestNow::new("2026-10-15T17:30:00Z");
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(rule("Never materialized")).unwrap();
    let other = db.create_recurring_item(rule("Unrelated")).unwrap();
    db.set_recurring_item_status(&item.id, "paused").unwrap();
    db.set_recurring_item_status(&item.id, "active").unwrap();
    assert_eq!(db.list_recurring_execution_history(&item.id).unwrap().iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(), vec!["paused", "resumed"]);
    db.set_recurring_item_status(&item.id, "ended").unwrap();
    let events = db.list_recurring_execution_history(&item.id).unwrap();
    assert_eq!(events.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(), vec!["paused", "resumed", "ended"]);
    let event = &events[2];
    assert!(event.id.starts_with("status:"));
    assert_eq!(event.kind, "ended");
    assert_eq!(event.occurrence_id, None);
    assert_eq!(event.occurrence_date, TODAY);
    assert_eq!(event.title, "Never materialized");
    let stored: String = db.connection.query_row("SELECT occurred_at FROM recurring_status_versions WHERE recurring_item_id=?1 AND status='ended'", [&item.id], |r| r.get(0)).unwrap();
    assert_eq!(event.occurred_at, stored);
    assert_eq!(DateTime::parse_from_rfc3339(&event.occurred_at).unwrap().format("%Y-%m-%d").to_string(), "2026-10-15");
    let json = serde_json::to_value(event).unwrap();
    for field in ["occurrence_id", "display_time", "display_duration_minutes", "outcome", "notes"] {
        assert!(json[field].is_null(), "{field}");
    }
    for status in ["ended", "active", "paused", "invalid"] {
        assert!(db.set_recurring_item_status(&item.id, status).is_err());
        assert_eq!(db.list_recurring_execution_history(&item.id).unwrap(), events);
    }
    assert!(db.set_recurring_item_status("missing", "ended").is_err());
    assert!(db.update_recurring_item(&item.id, rule("Cannot edit ended title")).is_err());
    assert!(db.list_recurring_execution_history(&other.id).unwrap().is_empty());
    let occurrences: i64 = db.connection.query_row("SELECT count(*) FROM recurring_occurrences", [], |r| r.get(0)).unwrap();
    let executions: i64 = db.connection.query_row("SELECT count(*) FROM recurring_execution_events", [], |r| r.get(0)).unwrap();
    assert_eq!((occurrences, executions), (0, 0));
}

#[test]
fn recurring_execution_end_merges_by_actual_instant_and_numeric_sequence_without_rewriting_snapshots() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(rule("Snapshot")).unwrap();
    let current = occurrence(&mut db, &item.id, TODAY);
    for _ in 0..6 {
        save(&mut db, &current.id, "completed", Some("original note"));
        db.clear_recurring_occurrence_review(&current.id).unwrap();
    }
    // Equal instants with different offsets, plus out-of-insertion-order actions.
    db.connection.execute_batch("UPDATE recurring_execution_events SET occurred_at='2026-10-16T12:00:00+08:00';
        UPDATE recurring_execution_events SET occurred_at='2026-10-16T05:00:00Z' WHERE id=1;
        UPDATE recurring_execution_events SET occurred_at='2026-10-16T03:00:00Z' WHERE id=2;").unwrap();
    let snapshots = db.list_recurring_execution_history(&item.id).unwrap();
    db.set_recurring_item_status(&item.id, "ended").unwrap();
    db.connection.execute("UPDATE recurring_status_versions SET occurred_at='2026-10-16T04:00:00Z' WHERE recurring_item_id=?1", [&item.id]).unwrap();
    let events = db.list_recurring_execution_history(&item.id).unwrap();
    let mut expected = vec!["2".to_owned()];
    expected.extend((3..=12).map(|id| id.to_string()));
    expected.extend(["status:1".to_owned(), "1".to_owned()]);
    assert_eq!(events.iter().map(|event| event.id.clone()).collect::<Vec<_>>(), expected);
    assert_eq!(events.iter().filter(|event| event.kind == "execution").cloned().collect::<Vec<_>>(), snapshots);
    assert_eq!(events[11].occurrence_id, None);
    // A real end action can precede a later same-day execution review.
    assert_eq!(events.last().unwrap().outcome.as_deref(), Some("completed"));
    assert!(events.iter().filter(|event| event.kind == "execution").all(|event| event.title == "Snapshot"));
}

#[test]
fn recurring_execution_end_recycle_restore_and_permanent_delete_preserve_then_cascade_history() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(rule("Recycle")).unwrap();
    let other = db.create_recurring_item(rule("Other")).unwrap();
    let current = occurrence(&mut db, &item.id, TODAY);
    save(&mut db, &current.id, "partial", Some("keep"));
    db.set_recurring_item_status(&item.id, "paused").unwrap();
    db.set_recurring_item_status(&item.id, "active").unwrap();
    db.set_recurring_item_status(&item.id, "ended").unwrap();
    db.set_recurring_item_status(&other.id, "ended").unwrap();
    let mut history = db.list_recurring_execution_history(&item.id).unwrap();
    let other_history = db.list_recurring_execution_history(&other.id).unwrap();
    assert_eq!(history.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(), vec!["execution", "paused", "resumed", "ended"]);
    for _ in 0..2 {
        db.soft_delete_recurring_item(&item.id, true).unwrap();
        assert!(db.set_recurring_item_status(&item.id, "ended").is_err());
        let deleted = db.list_recurring_execution_history(&item.id).unwrap();
        assert_eq!(&deleted[..history.len()], history.as_slice());
        assert_eq!(deleted.last().unwrap().kind, "soft_deleted");
        assert!(db.soft_delete_recurring_item(&item.id, true).is_err());
        assert_eq!(db.list_recurring_execution_history(&item.id).unwrap(), deleted);
        db.restore_recurring_item(&item.id).unwrap();
        history = db.list_recurring_execution_history(&item.id).unwrap();
        assert_eq!(&history[..deleted.len()], deleted.as_slice());
        assert_eq!(history.last().unwrap().kind, "restored");
        assert!(db.restore_recurring_item(&item.id).is_err());
        assert_eq!(db.list_recurring_execution_history(&item.id).unwrap(), history);
        let restored = db.list_recurring_items(true, false).unwrap().into_iter().find(|i| i.id == item.id).unwrap();
        assert_eq!(restored.status, "ended");
    }
    db.soft_delete_recurring_item(&item.id, true).unwrap();
    assert!(db.permanently_delete_recurring_item(&item.id, false).is_err());
    db.permanently_delete_recurring_item(&item.id, true).unwrap();
    assert!(db.list_recurring_execution_history(&item.id).unwrap().is_empty());
    for table in ["recurring_execution_events", "recurring_status_versions", "recurring_lifecycle_events", "recurring_occurrences"] {
        let count: i64 = db.connection.query_row(&format!("SELECT count(*) FROM {table} WHERE recurring_item_id=?1"), [&item.id], |r| r.get(0)).unwrap();
        assert_eq!(count, 0, "{table}");
    }
    assert_eq!(db.list_recurring_execution_history(&other.id).unwrap(), other_history);
}

#[test]
fn recurring_execution_end_timestamp_insert_failure_rolls_back_item_and_history() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(rule("Atomic end")).unwrap();
    let current = occurrence(&mut db, &item.id, TODAY);
    save(&mut db, &current.id, "completed", None);
    let before = fact_rows(&db.connection, "SELECT * FROM recurring_items WHERE id=?1", &item.id).unwrap();
    let history = db.list_recurring_execution_history(&item.id).unwrap();
    let occurrence_before = load_occurrence(&db.connection, &current.id).unwrap();
    db.connection.execute_batch("CREATE TRIGGER fail_status_timestamp BEFORE INSERT ON recurring_status_versions
        WHEN NEW.occurred_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'timestamp failure'); END;").unwrap();
    assert!(db.set_recurring_item_status(&item.id, "ended").is_err());
    assert_eq!(fact_rows(&db.connection, "SELECT * FROM recurring_items WHERE id=?1", &item.id).unwrap(), before);
    assert_eq!(load_occurrence(&db.connection, &current.id).unwrap(), occurrence_before);
    assert_eq!(db.list_recurring_execution_history(&item.id).unwrap(), history);
    let count: i64 = db.connection.query_row("SELECT count(*) FROM recurring_status_versions", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 0);
    db.connection.execute_batch("DROP TRIGGER fail_status_timestamp").unwrap();
    db.set_recurring_item_status(&item.id, "ended").unwrap();
    assert_eq!(db.list_recurring_execution_history(&item.id).unwrap().len(), 2);
}

#[test]
fn recurring_execution_end_migration_preserves_legacy_date_only_and_new_timestamps_on_reopen() {
    let _clock = TestToday::new(TODAY);
    let scratch = std::env::var_os("PI_SCRATCH_DIR").map(std::path::PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let temp = tempfile::tempdir_in(scratch).unwrap();
    let path = temp.path().join("recurring-status-history.sqlite3");
    let legacy_ids = {
        let mut db = Database::open(&path).unwrap();
        let mut ids = Vec::new();
        for lifecycle in ["ended", "deleted", "restored"] {
            let item = db.create_recurring_item(rule(lifecycle)).unwrap();
            db.set_recurring_item_status(&item.id, "paused").unwrap();
            db.set_recurring_item_status(&item.id, "active").unwrap();
            db.set_recurring_item_status(&item.id, "ended").unwrap();
            if lifecycle != "ended" { db.soft_delete_recurring_item(&item.id, true).unwrap(); }
            if lifecycle == "restored" { db.restore_recurring_item(&item.id).unwrap(); }
            ids.push(item.id);
        }
        // Recreate the exact version-28 status schema, including existing ended rows.
        db.connection.execute_batch("ALTER TABLE recurring_status_versions DROP COLUMN occurred_at;
            DROP TABLE recurring_lifecycle_events;
            DELETE FROM schema_migrations WHERE version>=29;").unwrap();
        ids
    };
    let (new_id, persisted) = {
        let mut db = Database::open(&path).unwrap();
        for id in &legacy_ids {
            let history = db.list_recurring_execution_history(id).unwrap().into_iter().filter(|e| e.id.starts_with("status:")).collect::<Vec<_>>();
            assert_eq!(history.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(), vec!["paused", "resumed", "ended"]);
            assert!(history.iter().all(|e| e.occurrence_date == TODAY && e.occurred_at == TODAY && e.occurrence_id.is_none()),
                "legacy actions must retain date precision");
        }
        db.restore_recurring_item(&legacy_ids[1]).unwrap();
        let item = db.create_recurring_item(rule("New timestamp")).unwrap();
        db.set_recurring_item_status(&item.id, "paused").unwrap();
        db.set_recurring_item_status(&item.id, "active").unwrap();
        db.set_recurring_item_status(&item.id, "ended").unwrap();
        let persisted = db.list_recurring_execution_history(&item.id).unwrap();
        assert_eq!(persisted.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(), vec!["paused", "resumed", "ended"]);
        assert!(persisted.iter().all(|e| DateTime::parse_from_rfc3339(&e.occurred_at).is_ok()));
        db.migrate().unwrap();
        (item.id, persisted)
    };
    let mut db = Database::open(&path).unwrap();
    db.migrate().unwrap();
    assert_eq!(db.list_recurring_execution_history(&new_id).unwrap(), persisted);
    for id in &legacy_ids {
        let history = db.list_recurring_execution_history(id).unwrap().into_iter().filter(|e| e.id.starts_with("status:")).collect::<Vec<_>>();
        assert_eq!(history.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(), vec!["paused", "resumed", "ended"]);
        assert!(history.iter().all(|e| e.occurred_at == TODAY));
    }
    let columns: i64 = db.connection.query_row("SELECT count(*) FROM pragma_table_info('recurring_status_versions') WHERE name='occurred_at'", [], |r| r.get(0)).unwrap();
    let migrations: i64 = db.connection.query_row("SELECT count(*) FROM schema_migrations WHERE version=29", [], |r| r.get(0)).unwrap();
    assert_eq!((columns, migrations), (1, 1));
}

#[test]
fn recurring_execution_end_pre_version27_backfill_does_not_require_or_fabricate_timestamp() {
    let _clock = TestToday::new(TODAY);
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);").unwrap();
    for (version, sql) in MIGRATIONS.iter().filter(|(version, _)| *version < 27) {
        connection.execute_batch(sql).unwrap();
        connection.execute("INSERT INTO schema_migrations VALUES(?1,?2)", params![version, now()]).unwrap();
    }
    connection.execute("INSERT INTO recurring_items(id,title,status,frequency,starts_on,created_at,updated_at)
        VALUES('legacy-active','Legacy active','active','daily','2026-01-01',?1,?1)", [now()]).unwrap();
    connection.execute("INSERT INTO recurring_items(id,title,status,frequency,starts_on,created_at,updated_at)
        VALUES('legacy-paused','Legacy paused','paused','daily','2026-01-01',?1,?1)", [now()]).unwrap();
    connection.execute("INSERT INTO recurring_items(id,title,status,frequency,starts_on,created_at,updated_at)
        VALUES('legacy-ended','Legacy ended','ended','daily','2026-01-01',?1,?1)", [now()]).unwrap();
    let mut db = Database { connection };
    db.migrate().unwrap();
    db.migrate().unwrap();
    let history = db.list_recurring_execution_history("legacy-ended").unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].kind, "ended");
    assert_eq!(history[0].occurred_at, TODAY);
    assert_eq!(history[0].occurrence_id, None);
    assert!(db.list_recurring_execution_history("legacy-active").unwrap().is_empty());
    let paused = db.list_recurring_execution_history("legacy-paused").unwrap();
    assert_eq!(paused.len(), 1);
    assert_eq!(paused[0].kind, "paused");
    assert_eq!(paused[0].occurred_at, TODAY);
    db.set_recurring_item_status("legacy-paused", "active").unwrap();
    assert_eq!(db.list_recurring_execution_history("legacy-paused").unwrap().iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(), vec!["paused", "resumed"]);
}

#[test]
fn recurring_execution_end_legacy_date_fallback_sorts_before_known_times_without_changing_them() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(rule("Legacy date precision")).unwrap();
    let current = occurrence(&mut db, &item.id, TODAY);
    save(&mut db, &current.id, "completed", Some("snapshot"));
    let execution = db.list_recurring_execution_history(&item.id).unwrap().remove(0);
    db.set_recurring_item_status(&item.id, "ended").unwrap();
    db.connection.execute("UPDATE recurring_status_versions SET occurred_at=NULL WHERE recurring_item_id=?1", [&item.id]).unwrap();
    let events = db.list_recurring_execution_history(&item.id).unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].kind, "ended");
    assert_eq!(events[0].occurred_at, TODAY);
    assert_eq!(events[1], execution);
}

#[test]
fn recurring_execution_lifecycle_preserves_repeated_cycles_and_ignores_active_baselines() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(rule("Lifecycle")).unwrap();
    let other = db.create_recurring_item(rule("Other series")).unwrap();
    assert!(db.list_recurring_execution_history(&item.id).unwrap().is_empty());
    // A legacy baseline and an active-to-active request must not invent a resume.
    db.connection.execute("INSERT INTO recurring_status_versions(recurring_item_id,effective_from,status)
        VALUES(?1,'2026-10-16','active')", [&item.id]).unwrap();
    db.set_recurring_item_status(&item.id, "active").unwrap();
    assert!(db.list_recurring_execution_history(&item.id).unwrap().is_empty());
    let current = occurrence(&mut db, &item.id, TODAY);
    save(&mut db, &current.id, "completed", Some("original result"));
    let snapshot = db.list_recurring_execution_history(&item.id).unwrap().remove(0);
    for status in ["paused", "paused", "active", "active", "paused", "active", "ended"] {
        db.set_recurring_item_status(&item.id, status).unwrap();
    }
    let history = db.list_recurring_execution_history(&item.id).unwrap();
    assert_eq!(history.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(),
        vec!["execution", "paused", "paused", "resumed", "paused", "resumed", "ended"]);
    assert_eq!(history[0], snapshot);
    assert!(history[1..].iter().all(|e| e.id.starts_with("status:") && e.occurrence_id.is_none()
        && e.display_time.is_none() && e.display_duration_minutes.is_none() && e.outcome.is_none()
        && e.notes.is_none() && e.occurrence_date == TODAY && DateTime::parse_from_rfc3339(&e.occurred_at).is_ok()));
    assert!(history[1..].windows(2).all(|pair| pair[0].occurred_at < pair[1].occurred_at));
    assert!(db.list_recurring_execution_history(&other.id).unwrap().is_empty());
    db.set_recurring_item_status(&other.id, "active").unwrap();
    assert!(db.list_recurring_execution_history(&other.id).unwrap().is_empty(), "other series pauses cannot justify this resume");
    let stored: i64 = db.connection.query_row("SELECT count(*) FROM recurring_status_versions WHERE recurring_item_id=?1", [&item.id], |r| r.get(0)).unwrap();
    assert_eq!(stored, 9, "query filtering must preserve all stored operations");
}

#[test]
fn recurring_execution_lifecycle_orders_by_time_then_status_sequence_for_equal_or_legacy_times() {
    let _clock = TestToday::new(TODAY);
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(rule("Ordering")).unwrap();
    for _ in 0..6 {
        db.set_recurring_item_status(&item.id, "paused").unwrap();
        db.set_recurring_item_status(&item.id, "active").unwrap();
    }
    db.set_recurring_item_status(&item.id, "ended").unwrap();
    let kinds = db.list_recurring_execution_history(&item.id).unwrap().iter().map(|e| e.kind.clone()).collect::<Vec<_>>();
    db.connection.execute_batch("UPDATE recurring_status_versions SET occurred_at='2026-10-16T04:00:00Z';
        UPDATE recurring_status_versions SET occurred_at='2026-10-16T12:00:00+08:00' WHERE id%2=0;").unwrap();
    let equal = db.list_recurring_execution_history(&item.id).unwrap();
    assert_eq!(equal.iter().map(|e| e.id.clone()).collect::<Vec<_>>(), (1..=13).map(|id| format!("status:{id}")).collect::<Vec<_>>());
    assert_eq!(equal.iter().map(|e| e.kind.clone()).collect::<Vec<_>>(), kinds);
    db.connection.execute_batch("UPDATE recurring_status_versions SET occurred_at='2026-10-16T03:00:00Z' WHERE id=2;
        UPDATE recurring_status_versions SET occurred_at='2026-10-16T05:00:00Z' WHERE id=1;").unwrap();
    let timed = db.list_recurring_execution_history(&item.id).unwrap();
    assert_eq!(timed.first().unwrap().id, "status:2");
    assert_eq!(timed.last().unwrap().id, "status:1");
    db.connection.execute_batch("UPDATE recurring_status_versions SET occurred_at=NULL;").unwrap();
    let legacy = db.list_recurring_execution_history(&item.id).unwrap();
    assert_eq!(legacy.iter().map(|e| e.id.clone()).collect::<Vec<_>>(), equal.iter().map(|e| e.id.clone()).collect::<Vec<_>>());
    assert!(legacy.iter().all(|e| e.occurred_at == TODAY));
}

#[test]
fn recurring_trash_restore_without_occurrences_records_action_time_and_order() {
    let _clock = TestNow::new("2026-10-15T17:30:00Z");
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(rule("Never scheduled")).unwrap();
    assert!(db.soft_delete_recurring_item(&item.id, true).is_err());
    assert!(db.restore_recurring_item(&item.id).is_err());
    db.set_recurring_item_status(&item.id, "paused").unwrap();
    assert!(db.soft_delete_recurring_item(&item.id, false).is_err());
    db.soft_delete_recurring_item(&item.id, true).unwrap();
    let deleted = db.list_recurring_items(true, true).unwrap().remove(0);
    let history = db.list_recurring_execution_history(&item.id).unwrap();
    assert_eq!(history.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(), vec!["paused", "ended", "soft_deleted"]);
    assert_eq!(Some(&history[2].occurred_at), deleted.deleted_at.as_ref());
    db.restore_recurring_item(&item.id).unwrap();
    let history = db.list_recurring_execution_history(&item.id).unwrap();
    assert_eq!(history.last().unwrap().kind, "restored");
    assert_eq!(history.last().unwrap().occurred_at, db.list_recurring_items(true, false).unwrap()[0].updated_at);
    assert!(history.iter().all(|e| e.occurrence_date == TODAY && e.occurrence_id.is_none()
        && e.display_time.is_none() && e.display_duration_minutes.is_none() && e.outcome.is_none() && e.notes.is_none()));
    assert!(history[2..].iter().all(|e| e.id.starts_with("lifecycle:") && e.title == "Never scheduled"));
    assert!(DateTime::parse_from_rfc3339(&history[2].occurred_at).unwrap().to_rfc3339().starts_with("2026-10-15T17:30:"));
    let count: i64 = db.connection.query_row("SELECT count(*) FROM recurring_occurrences", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 0);
    // Equal instants use numeric insertion sequence, including repeated cycles.
    for _ in 0..6 {
        db.soft_delete_recurring_item(&item.id, true).unwrap();
        db.restore_recurring_item(&item.id).unwrap();
    }
    db.connection.execute_batch("UPDATE recurring_lifecycle_events SET occurred_at='2026-10-16T01:30:00+08:00';
        UPDATE recurring_lifecycle_events SET occurred_at='2026-10-15T17:30:00Z' WHERE id%2=0;").unwrap();
    let lifecycle = db.list_recurring_execution_history(&item.id).unwrap().into_iter().filter(|e| e.id.starts_with("lifecycle:")).collect::<Vec<_>>();
    assert_eq!(lifecycle.iter().map(|e| e.id.clone()).collect::<Vec<_>>(), (1..=14).map(|id| format!("lifecycle:{id}")).collect::<Vec<_>>());
    assert_eq!(lifecycle.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(), ["soft_deleted", "restored"].repeat(7));
}

#[test]
fn recurring_trash_restore_event_failures_roll_back_item_status_and_history() {
    let _clock = TestToday::new(TODAY);
    for initial_status in ["paused", "ended"] {
        let mut db = Database::in_memory().unwrap();
        let item = db.create_recurring_item(rule("Atomic recycle")).unwrap();
        db.set_recurring_item_status(&item.id, initial_status).unwrap();
        for restore in [false, true] {
            if restore { db.soft_delete_recurring_item(&item.id, true).unwrap(); }
            let before = fact_rows(&db.connection, "SELECT * FROM recurring_items WHERE id=?1", &item.id).unwrap();
            let statuses = fact_rows(&db.connection, "SELECT * FROM recurring_status_versions WHERE recurring_item_id=?1", &item.id).unwrap();
            let history = db.list_recurring_execution_history(&item.id).unwrap();
            db.connection.execute_batch("CREATE TRIGGER fail_lifecycle BEFORE INSERT ON recurring_lifecycle_events
                BEGIN SELECT RAISE(ABORT, 'lifecycle failure'); END;").unwrap();
            let result = if restore { db.restore_recurring_item(&item.id) } else { db.soft_delete_recurring_item(&item.id, true) };
            assert!(result.is_err());
            assert_eq!(fact_rows(&db.connection, "SELECT * FROM recurring_items WHERE id=?1", &item.id).unwrap(), before);
            assert_eq!(fact_rows(&db.connection, "SELECT * FROM recurring_status_versions WHERE recurring_item_id=?1", &item.id).unwrap(), statuses);
            assert_eq!(db.list_recurring_execution_history(&item.id).unwrap(), history);
            db.connection.execute_batch("DROP TRIGGER fail_lifecycle").unwrap();
        }
    }
}

#[test]
fn recurring_trash_migration_backfills_only_deleted_at_once_and_cycles_survive_reopen() {
    let _clock = TestToday::new(TODAY);
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("recurring-trash.sqlite");
    let (deleted_id, restored_id) = {
        let mut db = Database::open(&path).unwrap();
        let deleted = db.create_recurring_item(rule("Legacy deleted")).unwrap();
        let restored = db.create_recurring_item(rule("Legacy restored")).unwrap();
        for item in [&deleted, &restored] {
            db.set_recurring_item_status(&item.id, "ended").unwrap();
            db.soft_delete_recurring_item(&item.id, true).unwrap();
        }
        db.restore_recurring_item(&restored.id).unwrap();
        db.connection.execute("UPDATE recurring_items SET deleted_at='2026-10-14T17:30:00Z', updated_at='2026-10-16T03:00:00Z' WHERE id=?1", [&deleted.id]).unwrap();
        db.connection.execute_batch("DROP TABLE recurring_lifecycle_events; DELETE FROM schema_migrations WHERE version=30;").unwrap();
        (deleted.id, restored.id)
    };
    let expected = {
        let mut db = Database::open(&path).unwrap();
        let migrated = db.list_recurring_execution_history(&deleted_id).unwrap();
        let deletion = migrated.iter().find(|e| e.kind == "soft_deleted").unwrap();
        assert_eq!(deletion.occurred_at, "2026-10-14T17:30:00Z");
        assert_eq!(deletion.occurrence_date, "2026-10-15");
        assert_eq!(deletion.occurrence_id, None);
        assert!(db.list_recurring_execution_history(&restored_id).unwrap().iter().all(|e| e.kind == "ended"));
        db.migrate().unwrap();
        assert_eq!(db.list_recurring_execution_history(&deleted_id).unwrap(), migrated);
        for _ in 0..2 {
            db.restore_recurring_item(&deleted_id).unwrap();
            db.soft_delete_recurring_item(&deleted_id, true).unwrap();
        }
        db.restore_recurring_item(&deleted_id).unwrap();
        let expected = db.list_recurring_execution_history(&deleted_id).unwrap();
        assert_eq!(expected.iter().filter(|e| e.id.starts_with("lifecycle:")).map(|e| e.kind.as_str()).collect::<Vec<_>>(),
            vec!["soft_deleted", "restored", "soft_deleted", "restored", "soft_deleted", "restored"]);
        expected
    };
    let mut db = Database::open(&path).unwrap();
    db.migrate().unwrap();
    assert_eq!(db.list_recurring_execution_history(&deleted_id).unwrap(), expected);
    let count: i64 = db.connection.query_row("SELECT count(*) FROM schema_migrations WHERE version=30", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 1);
    let item = db.list_recurring_items(true, false).unwrap().into_iter().find(|i| i.id == deleted_id).unwrap();
    assert_eq!(item.status, "ended");
    assert!(item.deleted_at.is_none());
}
