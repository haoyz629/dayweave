use super::*;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskHistoryEventDto {
    pub id: String,
    pub occurred_at: Option<String>,
    pub plan_date: Option<String>,
    pub kind: String,
    pub status: Option<String>,
    pub note: Option<String>,
    pub review_note: Option<String>,
}

// Keep execution and review notes separate. Planned-only reservations are not execution facts.
pub(super) fn current_events(connection: &Connection, task_id: &str) -> AppResult<Vec<TaskHistoryEventDto>> {
    let mut statement = connection.prepare("SELECT pb.id, COALESCE(pb.result_date, dp.plan_date),
        pb.execution_captured_at, review.updated_at, COALESCE(review.outcome, pb.execution_status),
        pb.execution_note, review.notes
        FROM plan_blocks pb JOIN daily_plans dp ON dp.id = pb.daily_plan_id
        LEFT JOIN review_entries review ON review.plan_block_id = pb.id
        WHERE pb.task_id = ?1 AND (pb.execution_status <> 'planned' OR pb.execution_captured_at IS NOT NULL
            OR pb.execution_note IS NOT NULL OR review.id IS NOT NULL)
        ORDER BY pb.starts_at, pb.id")?;
    let mut events = statement.query_map([task_id], |row| {
        let execution_time: Option<String> = row.get(2)?;
        let review_time: Option<String> = row.get(3)?;
        let occurred_at = match (execution_time, review_time) {
            (Some(a), Some(b)) => Some(if instant(&a) >= instant(&b) { a } else { b }),
            (a, b) => a.or(b),
        };
        let outcome: String = row.get(4)?;
        Ok(TaskHistoryEventDto {
            id: format!("block:{}", row.get::<_, String>(0)?), occurred_at,
            plan_date: row.get(1)?, kind: "execution".into(),
            status: Some(if outcome == "completed" { "done" } else { "not_completed" }.into()),
            note: row.get(5)?, review_note: row.get(6)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    let mut statement = connection.prepare("SELECT review.id, review.review_date, review.updated_at,
        review.outcome, review.notes FROM review_entries review
        LEFT JOIN plan_blocks pb ON pb.id = review.plan_block_id
        WHERE review.task_id = ?1 AND pb.id IS NULL ORDER BY review.created_at, review.id")?;
    events.extend(statement.query_map([task_id], |row| {
        let outcome: String = row.get(3)?;
        Ok(TaskHistoryEventDto {
            id: format!("review:{}", row.get::<_, String>(0)?), occurred_at: row.get(2)?,
            plan_date: row.get(1)?, kind: "execution".into(),
            status: Some(if outcome == "completed" { "done" } else { "not_completed" }.into()),
            note: None, review_note: row.get(4)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?);
    Ok(events)
}

fn instant(value: &str) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(value).ok()
}

// The original source id is retained in JSON, so a live fact and its archived version deduplicate.
// No schema migration and no reconstruction of notes that were already lost is needed.
pub(super) fn preserve_events(transaction: &Transaction<'_>, task_id: &str, events: &[TaskHistoryEventDto]) -> AppResult<()> {
    for event in events {
        let json = serde_json::to_string(event)?;
        let exists: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM task_changes
            WHERE task_id = ?1 AND change_kind = 'history_snapshot' AND new_value = ?2)",
            params![task_id, json], |row| row.get(0))?;
        if !exists {
            record_task_change(transaction, task_id, "history_snapshot", None, Some(&json), "system", None)?;
        }
    }
    Ok(())
}

pub(super) fn preserve_current(transaction: &Transaction<'_>, task_id: &str) -> AppResult<()> {
    preserve_events(transaction, task_id, &current_events(transaction, task_id)?)
}

pub(super) fn record_cleared(transaction: &Transaction<'_>, task_id: &str, plan_date: &str, completed: bool) -> AppResult<()> {
    let status: String = transaction.query_row("SELECT status FROM tasks WHERE id = ?1", [task_id], |row| row.get(0))?;
    let event = TaskHistoryEventDto { id: format!("cleared:{}", Uuid::new_v4()), occurred_at: Some(now()),
        plan_date: Some(plan_date.into()), kind: if completed { "cleared" } else { "cleared_incomplete" }.into(), status: Some(status), note: None, review_note: None };
    preserve_events(transaction, task_id, &[event])
}

pub(super) fn load(connection: &Connection, task_id: &str) -> AppResult<Vec<TaskHistoryEventDto>> {
    let created_at: String = connection.query_row("SELECT created_at FROM tasks WHERE id = ?1", [task_id], |row| row.get(0))?;
    let initial_status: Option<String> = connection.query_row("SELECT new_value FROM task_changes
        WHERE task_id = ?1 AND change_kind IN ('created', 'created_from_draft', 'created_from_recurrence')
        ORDER BY rowid LIMIT 1", [task_id], |row| row.get(0)).optional()?.flatten();
    let created = TaskHistoryEventDto { id: format!("created:{task_id}"), occurred_at: Some(created_at),
        plan_date: None, kind: "created".into(), status: initial_status.and_then(real_status), note: None, review_note: None };
    let mut events = Vec::new();
    let mut seen = HashSet::new();
    let mut statement = connection.prepare("SELECT rowid, id, change_kind, new_value, reason, created_at, old_value
        FROM task_changes WHERE task_id = ?1 ORDER BY rowid")?;
    let changes = statement.query_map([task_id], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?,
        row.get::<_, String>(2)?, row.get::<_, Option<String>>(3)?, row.get::<_, Option<String>>(4)?,
        row.get::<_, String>(5)?, row.get::<_, Option<String>>(6)?)))?.collect::<Result<Vec<_>, _>>()?;
    for (order, id, kind, new_value, reason, timestamp, old_value) in changes {
        if kind == "history_snapshot" {
            if let Some(event) = new_value.as_deref().and_then(|json| serde_json::from_str::<TaskHistoryEventDto>(json).ok()) {
                if seen.insert(serde_json::to_string(&event)?) {
                    let mut event = event;
                    event.id = format!("history:{id}");
                    let rank = if matches!(event.kind.as_str(), "cleared" | "cleared_incomplete") { 2 } else { 1 };
                    events.push((event, rank, order));
                }
            }
            continue;
        }
        if !matches!(kind.as_str(), "status_changed" | "soft_deleted" | "restored" | "undo_task_completed" | "undo_plan_status" | "completion_note_changed" | "execution_resolved") { continue; }
        let status = if kind == "completion_note_changed" { Some("done".into()) }
            else if kind == "execution_resolved" {
                // These persisted actions commit exactly these lifecycle states (not the block outcome).
                match new_value.as_deref() {
                    Some("schedule") => Some("scheduled".into()), Some("wait") => Some("open".into()),
                    Some("stop") => Some("deleted".into()), _ => None,
                }
            } else { new_value.clone().and_then(real_status) };
        if status.is_none() { continue; }
        let automatic = kind == "status_changed" && reason.as_deref() == Some("汇总全部执行块结果");
        let reopened = matches!(kind.as_str(), "status_changed" | "undo_task_completed")
            && old_value.as_deref() == Some("done") && matches!(status.as_deref(), Some("open" | "scheduled"));
        // System aggregation explains a lifecycle transition, never a user-entered note.
        // Legacy completion and resolution audits can still contain real notes in reason.
        let note = if automatic { None } else if kind == "completion_note_changed" {
            new_value
        } else if kind == "status_changed" && status.as_deref() == Some("done") {
            reason.filter(|note| note != "明确完成整个任务")
        } else if kind == "execution_resolved" { reason } else { None };
        events.push((TaskHistoryEventDto { id: format!("change:{id}"), occurred_at: Some(timestamp), plan_date: None,
            kind: if automatic { "automatic_status" } else if reopened { "reopened" } else if matches!(kind.as_str(), "soft_deleted" | "restored") { kind.as_str() } else { "status" }.into(), status, note, review_note: None }, 2, order));
    }
    for event in current_events(connection, task_id)? {
        if seen.insert(serde_json::to_string(&event)?) { events.push((event, 1, i64::MAX)); }
    }
    // Parse offsets, retain subsecond precision, and use audit insertion order for equal timestamps.
    // Execution facts precede status/deletion/restoration at the same instant, never overriding them.
    events.sort_by(|(a, rank_a, order_a), (b, rank_b, order_b)| {
        a.occurred_at.as_deref().and_then(instant).cmp(&b.occurred_at.as_deref().and_then(instant))
            .then_with(|| rank_a.cmp(rank_b)).then_with(|| order_a.cmp(order_b)).then_with(|| a.id.cmp(&b.id))
    });
    let mut history = vec![created];
    history.extend(events.into_iter().map(|(event, _, _)| event));
    Ok(history)
}

fn real_status(value: String) -> Option<String> {
    matches!(value.as_str(), "open" | "scheduled" | "done" | "deleted").then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TODAY: &str = "2026-10-16";

    fn add_block(db: &Database, task: &str, date: &str) -> String {
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
            params![id,plan,task,format!("{date}T09:00:00+08:00"),format!("{date}T10:00:00+08:00"),now()]).unwrap();
        id
    }

    fn capture(db: &mut Database, block: &str, date: &str, note: &str) {
        db.save_execution_capture(date, ExecutionCaptureInput { plan_block_id: block.into(),
            outcome: ReviewOutcome::Partial, note: Some(note.into()) }).unwrap();
    }

    fn review(block: &str, note: &str) -> ReviewEntryInput {
        ReviewEntryInput { plan_block_id: block.into(), outcome: ReviewOutcome::Blocked,
            actual_minutes: None, defer_reason: None, notes: Some(note.into()), remaining_workload_minutes: None }
    }

    #[test]
    fn all_days_blocks_orphan_reviews_and_separate_notes_are_returned_without_read_side_effects() {
        let _clock = TestToday::new(TODAY);
        let mut db = Database::in_memory().unwrap();
        let id = db.create_manual_task("multi-day history").unwrap();
        db.connection.execute("UPDATE tasks SET notes = 'https://example.com/task' WHERE id = ?1", [&id]).unwrap();
        let first = add_block(&db, &id, "2026-10-15");
        let second = add_block(&db, &id, TODAY);
        let third = add_block(&db, &id, TODAY);
        add_block(&db, &id, "2026-10-17"); // An untouched future reservation is not a result.
        capture(&mut db, &first, "2026-10-15", "yesterday execution");
        capture(&mut db, &second, TODAY, "today execution");
        db.save_review_entry(TODAY, review(&second, "independent review")).unwrap();
        capture(&mut db, &third, TODAY, "second block today");
        db.connection.execute("INSERT INTO review_entries(id,review_date,plan_block_id,task_id,outcome,notes,created_at,updated_at)
            VALUES ('orphan',?1,NULL,?2,'completed','orphan review',?3,?3)", params![TODAY,id,now()]).unwrap();
        let before = fact_fingerprint(&db.connection, "task_completion", &id).unwrap();
        let metadata = db.get_task_metadata(&id).unwrap();
        let events = &metadata.history;
        assert_eq!(events[0].kind, "created");
        assert_eq!(events[0].occurred_at.as_deref(), Some(db.get_task(&id).unwrap().created_at.as_str()));
        assert!(events.iter().any(|e| e.plan_date.as_deref() == Some("2026-10-15") && e.note.as_deref() == Some("yesterday execution")));
        assert!(events.iter().any(|e| e.note.as_deref() == Some("today execution") && e.review_note.as_deref() == Some("independent review")));
        assert!(events.iter().any(|e| e.note.as_deref() == Some("second block today")));
        assert!(events.iter().any(|e| e.note.is_none() && e.review_note.as_deref() == Some("orphan review") && e.status.as_deref() == Some("done")));
        assert!(!events.iter().any(|e| e.plan_date.as_deref() == Some("2026-10-17")));
        assert_eq!(db.get_task(&id).unwrap().notes.as_deref(), Some("https://example.com/task"));
        assert!(metadata.latest_execution.is_some());
        assert_eq!(*events, db.get_task_metadata(&id).unwrap().history);
        assert_eq!(before, fact_fingerprint(&db.connection, "task_completion", &id).unwrap());
        assert_eq!(events.iter().map(|e| &e.id).collect::<HashSet<_>>().len(), events.len());
    }

    #[test]
    fn automatic_status_history_separates_system_reasons_from_real_execution_notes() {
        let _clock = TestToday::new(TODAY);
        let mut db = Database::in_memory().unwrap();
        let id = db.create_manual_task("automatic status history").unwrap();
        let block = add_block(&db, &id, TODAY);
        db.save_execution_capture(TODAY, ExecutionCaptureInput { plan_block_id: block.clone(),
            outcome: ReviewOutcome::Completed, note: Some("用户的完成备注".into()) }).unwrap();
        assert_eq!(db.get_task(&id).unwrap().status, "done");
        let events = db.get_task_metadata(&id).unwrap().history;
        let automatic = events.iter().find(|event| event.kind == "automatic_status").unwrap();
        assert_eq!(automatic.status.as_deref(), Some("done"));
        assert_eq!(automatic.note, None);
        assert_eq!(automatic.review_note, None);
        assert!(events.iter().any(|event| event.kind == "execution" && event.note.as_deref() == Some("用户的完成备注")));

        // Identical user wording must remain a note on the execution fact, not be filtered globally.
        capture(&mut db, &block, TODAY, "汇总全部执行块结果");
        assert_eq!(db.get_task(&id).unwrap().status, "scheduled");
        let before = fact_fingerprint(&db.connection, "task_completion", &id).unwrap();
        let events = db.get_task_metadata(&id).unwrap().history;
        let automatic = events.iter().filter(|event| event.kind == "automatic_status").collect::<Vec<_>>();
        assert_eq!(automatic.len(), 2);
        assert_eq!(automatic.last().unwrap().status.as_deref(), Some("scheduled"));
        assert!(automatic.iter().all(|event| event.note.is_none() && event.review_note.is_none()));
        assert!(events.iter().any(|event| event.kind == "execution" && event.note.as_deref() == Some("汇总全部执行块结果")));
        assert!(events.iter().any(|event| event.kind == "execution" && event.note.as_deref() == Some("用户的完成备注")));
        assert_eq!(events, db.get_task_metadata(&id).unwrap().history);
        assert_eq!(before, fact_fingerprint(&db.connection, "task_completion", &id).unwrap());
        let audits: i64 = db.connection.query_row("SELECT COUNT(*) FROM task_changes
            WHERE task_id = ?1 AND change_kind = 'status_changed' AND reason = '汇总全部执行块结果'",
            [&id], |row| row.get(0)).unwrap();
        assert_eq!(audits, 2, "reading history must retain the original system audits");
    }

    #[test]
    fn incomplete_completed_deleted_restored_done_and_equal_timestamps_keep_true_last_status() {
        let _clock = TestToday::new(TODAY);
        let mut db = Database::in_memory().unwrap();
        let id = db.create_manual_task("status chain").unwrap();
        let block = add_block(&db, &id, TODAY);
        capture(&mut db, &block, TODAY, "incomplete note");
        db.complete_task_with_note(&id, Some(&block), Some("completion note".into())).unwrap();
        db.soft_delete_manual_task(&id, true).unwrap();
        assert_eq!(db.get_task_metadata(&id).unwrap().history.last().unwrap().status.as_deref(), Some("deleted"));
        assert_eq!(db.get_task_metadata(&id).unwrap().history.last().unwrap().kind, "soft_deleted");
        db.restore_task(&id).unwrap();
        // Equal instants with different UTC offsets must sort by event type and audit insertion order.
        db.connection.execute("UPDATE task_changes SET created_at = '2026-10-16T04:00:00Z'
            WHERE task_id = ?1 AND change_kind <> 'created'", [&id]).unwrap();
        db.connection.execute("UPDATE task_changes SET new_value = json_set(new_value, '$.occurred_at', '2026-10-16T12:00:00+08:00')
            WHERE task_id = ?1 AND change_kind = 'history_snapshot'", [&id]).unwrap();
        db.connection.execute("UPDATE plan_blocks SET execution_captured_at = '2026-10-16T12:00:00+08:00' WHERE id = ?1", [&block]).unwrap();
        let events = db.get_task_metadata(&id).unwrap().history;
        assert!(events.iter().any(|e| e.status.as_deref() == Some("not_completed") && e.note.as_deref() == Some("incomplete note")));
        assert!(events.iter().any(|e| e.status.as_deref() == Some("done") && e.note.as_deref() == Some("completion note")));
        let last = events.last().unwrap();
        assert_eq!((last.kind.as_str(), last.status.as_deref()), ("restored", Some("done")));
        assert_eq!(events, db.get_task_metadata(&id).unwrap().history);
    }

    #[test]
    fn task_trash_restore_cycles_append_distinct_history_and_survive_reopen() {
        let _clock = TestToday::new(TODAY);
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("trash-history.sqlite");
        let mut db = Database::open(&path).unwrap();
        let id = db.create_manual_task("trash cycles").unwrap();
        for _ in 0..2 {
            db.soft_delete_manual_task(&id, true).unwrap();
            db.restore_task(&id).unwrap();
        }
        let history = db.get_task_metadata(&id).unwrap().history;
        assert_eq!(history.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(),
            vec!["created", "soft_deleted", "restored", "soft_deleted", "restored"]);
        assert_eq!(history.iter().skip(1).map(|e| e.status.as_deref()).collect::<Vec<_>>(),
            vec![Some("deleted"), Some("open"), Some("deleted"), Some("open")]);
        assert!(history.iter().all(|e| e.occurred_at.is_some()));
        drop(db);
        let db = Database::open(&path).unwrap();
        assert_eq!(db.get_task_metadata(&id).unwrap().history, history);
    }

    #[test]
    fn completion_note_revisions_survive_reopen_and_durable_database_reload() {
        let _clock = TestToday::new(TODAY);
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("history.sqlite");
        let mut db = Database::open(&path).unwrap();
        let id = db.create_manual_task("durable history").unwrap();
        let block = add_block(&db, &id, TODAY);
        db.complete_task_with_note(&id, Some(&block), Some("first completion".into())).unwrap();
        db.complete_task_with_note(&id, Some(&block), Some("corrected completion".into())).unwrap();
        db.reopen_manual_task(&id, TODAY).unwrap();
        assert_eq!(execution_snapshot(&db.connection, &block).unwrap().execution_status, "planned");
        drop(db);
        let db = Database::open(path).unwrap();
        let events = db.get_task_metadata(&id).unwrap().history;
        for note in ["first completion", "corrected completion"] {
            assert!(events.iter().any(|e| e.kind == "execution" && e.note.as_deref() == Some(note)), "{note}");
        }
        assert_eq!(events.last().unwrap().status.as_deref(), Some("scheduled"));
    }

    #[test]
    fn execution_and_review_revisions_and_clear_preserve_previous_notes_without_duplicates() {
        let _clock = TestToday::new(TODAY);
        let mut db = Database::in_memory().unwrap();
        let id = db.create_manual_task("result revisions").unwrap();
        let block = add_block(&db, &id, TODAY);
        capture(&mut db, &block, TODAY, "original execution");
        capture(&mut db, &block, TODAY, "revised execution");
        db.clear_execution_capture(TODAY, &block).unwrap();
        let events = db.get_task_metadata(&id).unwrap().history;
        assert_eq!(events.iter().filter(|e| e.note.as_deref() == Some("original execution")).count(), 1);
        assert_eq!(events.iter().filter(|e| e.note.as_deref() == Some("revised execution")).count(), 1);
        assert_eq!(events.last().unwrap().kind, "cleared_incomplete");
        capture(&mut db, &block, TODAY, "separate execution");
        db.save_review_entry(TODAY, review(&block, "first review")).unwrap();
        db.save_review_entry(TODAY, review(&block, "revised review")).unwrap();
        let events = db.get_task_metadata(&id).unwrap().history;
        assert!(events.iter().any(|e| e.note.as_deref() == Some("separate execution") && e.review_note.as_deref() == Some("first review")));
        assert!(events.iter().any(|e| e.review_note.as_deref() == Some("revised review")));
    }

    #[test]
    fn cancelled_daily_and_whole_completion_have_explicit_history_kinds() {
        let _clock = TestToday::new(TODAY);
        let mut db = Database::in_memory().unwrap();
        let id = db.create_manual_task("completion cancellation history").unwrap();
        let block = add_block(&db, &id, TODAY);
        db.complete_task(&id, Some(&block)).unwrap();
        db.reopen_manual_task(&id, TODAY).unwrap();
        let history = db.get_task_metadata(&id).unwrap().history;
        assert!(history.iter().any(|event| event.kind == "reopened" && event.status.as_deref() == Some("scheduled")));
        db.save_execution_capture(TODAY, ExecutionCaptureInput { plan_block_id: block.clone(),
            outcome: ReviewOutcome::Completed, note: None }).unwrap();
        db.clear_execution_capture(TODAY, &block).unwrap();
        let history = db.get_task_metadata(&id).unwrap().history;
        assert!(history.iter().any(|event| event.kind == "cleared" && event.plan_date.as_deref() == Some(TODAY)));
        assert!(history.iter().any(|event| event.kind == "automatic_status" && event.status.as_deref() == Some("scheduled")));
    }

    #[test]
    fn completion_and_capture_undo_still_validate_fingerprints_and_keep_undone_notes() {
        let _clock = TestToday::new(TODAY);
        for completion in [false, true] {
            let mut db = Database::in_memory().unwrap();
            let id = db.create_manual_task("undo history").unwrap();
            let block = add_block(&db, &id, TODAY);
            if completion {
                db.complete_task_with_note(&id, Some(&block), Some("undone completion".into())).unwrap();
            } else {
                capture(&mut db, &block, TODAY, "undone capture");
            }
            db.apply_undo(&db.latest_undo().unwrap().unwrap().id).unwrap();
            assert_eq!(execution_snapshot(&db.connection, &block).unwrap().execution_status, "planned");
            let events = db.get_task_metadata(&id).unwrap().history;
            let note = if completion { "undone completion" } else { "undone capture" };
            assert!(events.iter().any(|e| e.kind == "execution" && e.note.as_deref() == Some(note)));
        }
    }

    #[test]
    fn failed_revision_rolls_back_snapshot_and_result_and_legacy_missing_times_stay_unknown() {
        let _clock = TestToday::new(TODAY);
        let mut db = Database::in_memory().unwrap();
        let id = db.create_manual_task("atomic history").unwrap();
        let block = add_block(&db, &id, TODAY);
        capture(&mut db, &block, TODAY, "original");
        let before = fact_fingerprint(&db.connection, "task_completion", &id).unwrap();
        db.connection.execute_batch("CREATE TRIGGER fail_history BEFORE INSERT ON task_changes
            WHEN NEW.change_kind = 'history_snapshot' BEGIN SELECT RAISE(ABORT,'history write failed'); END;").unwrap();
        assert!(db.save_execution_capture(TODAY, ExecutionCaptureInput { plan_block_id: block.clone(),
            outcome: ReviewOutcome::Blocked, note: Some("rejected".into()) }).is_err());
        assert_eq!(before, fact_fingerprint(&db.connection, "task_completion", &id).unwrap());
        db.connection.execute_batch("DROP TRIGGER fail_history").unwrap();
        db.connection.execute("UPDATE plan_blocks SET execution_note = NULL, execution_captured_at = NULL WHERE id = ?1", [&block]).unwrap();
        let event = db.get_task_metadata(&id).unwrap().history.into_iter().find(|e| e.kind == "execution").unwrap();
        assert_eq!(event.occurred_at, None);
        assert_eq!(event.note, None);
        assert_eq!(event.review_note, None);
    }
}

#[cfg(test)]
mod audit_note_tests {
    use super::*;

    #[test]
    fn no_block_completion_and_legacy_resolution_audits_keep_real_notes_and_lifecycle_states() {
        let _clock = TestToday::new("2026-10-16");
        let mut db = Database::in_memory().unwrap();
        let id = db.create_manual_task("audit-only notes").unwrap();
        db.complete_task_with_note(&id, None, Some("first no-block completion".into())).unwrap();
        db.complete_task_with_note(&id, None, Some("revised no-block completion".into())).unwrap();
        db.reopen_manual_task(&id, "2026-10-16").unwrap();
        let events = db.get_task_metadata(&id).unwrap().history;
        assert!(events.iter().any(|e| e.note.as_deref() == Some("first no-block completion")));
        assert!(events.iter().any(|e| e.note.as_deref() == Some("revised no-block completion")));
        assert_eq!(events.last().unwrap().status.as_deref(), Some("open"));
        // Old execution rows may be gone, but the resolution audit still contains a real note.
        db.connection.execute("INSERT INTO task_changes(id,task_id,change_kind,old_value,new_value,source,reason,created_at)
            VALUES ('legacy-resolution',?1,'execution_resolved','partial','wait','manual','legacy update note',?2)", params![id,now()]).unwrap();
        let events = db.get_task_metadata(&id).unwrap().history;
        let last = events.last().unwrap();
        assert_eq!((last.kind.as_str(),last.status.as_deref(),last.note.as_deref()), ("status",Some("open"),Some("legacy update note")));
        assert_eq!(last.plan_date, None, "missing block context must not be invented");
    }
}
