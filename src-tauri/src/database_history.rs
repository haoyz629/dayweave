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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_cleared: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_status: Option<String>,
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
            plan_date: row.get(1)?, kind: if outcome == "planned" { "note" } else { "execution" }.into(),
            status: if outcome == "planned" { None } else { Some(if outcome == "completed" { "done" } else { "not_completed" }.into()) },
            note: row.get(5)?, review_note: row.get(6)?, note_cleared: None, task_status: None,
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
            note: None, review_note: row.get(4)?, note_cleared: None, task_status: None,
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
            WHERE task_id = ?1 AND change_kind = 'history_snapshot' AND (new_value = ?2 OR old_value = ?2))",
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

// Link audit rows by insertion ID, not by timestamp: separate saves can share a clock tick.
pub(super) fn audit_cursor(transaction: &Transaction<'_>, task_id: &str) -> AppResult<i64> {
    Ok(transaction.query_row("SELECT COALESCE(MAX(rowid), 0) FROM task_changes WHERE task_id = ?1",
        [task_id], |row| row.get(0))?)
}

fn linked_audit_info(
    transaction: &Transaction<'_>,
    task_id: &str,
    audit_cursor: i64,
    include_note_change: bool,
) -> AppResult<(Option<String>, Option<String>, bool, bool)> {
    Ok(transaction.query_row(
        "SELECT CASE WHEN COUNT(*) > 0 THEN (SELECT status FROM tasks WHERE id = ?1) END, GROUP_CONCAT(id),
            COALESCE(MAX(change_kind = 'status_changed' AND old_value = 'done' AND new_value IN ('open', 'scheduled') AND reason IS NULL), 0),
            COALESCE(MAX(change_kind = 'undo_task_completed' AND old_value = 'done' AND new_value IN ('open', 'scheduled')), 0)
         FROM task_changes WHERE task_id = ?1 AND rowid > ?2
         AND (change_kind IN ('status_changed', 'soft_deleted', 'execution_resolved', 'undo_task_completed')
              OR (?3 = 1 AND change_kind = 'completion_note_changed'))",
        params![task_id, audit_cursor, include_note_change as i64],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?)
}

pub(super) fn record_capture_change(transaction: &Transaction<'_>, task_id: &str, plan_date: &str,
    before: &ExecutionSnapshot, audit_cursor: i64, timestamp: &str) -> AppResult<()> {
    let after = capture_snapshot(transaction, &before.id)?;
    let outcome_changed = before.execution_status != after.execution_status;
    let note_changed = before.execution_note.as_deref().unwrap_or_default().trim()
        != after.execution_note.as_deref().unwrap_or_default().trim();
    let (task_status, audit_ids, reopened, _) = linked_audit_info(transaction, task_id, audit_cursor, false)?;
    if !outcome_changed && !note_changed && task_status.is_none() { return Ok(()); }

    let block_key = format!("block:{}", before.id);
    // A later independent review can still replace this exact live snapshot.
    let snapshot = current_events(transaction, task_id)?.into_iter().find(|event| event.id == block_key)
        .map(|event| serde_json::to_string(&event)).transpose()?;
    let (kind, status) = if reopened { ("reopened", task_status.clone()) }
    else if !outcome_changed {
        if let Some(status) = &task_status { ("status", Some(status.clone())) } else { ("note", None) }
    } else if after.execution_status == "planned" {
        (if before.execution_status == "completed" { "cleared" } else { "cleared_incomplete" }, task_status.clone())
    } else {
        ("execution", Some(if after.execution_status == "completed" { "done" } else { "not_completed" }.into()))
    };
    let event = TaskHistoryEventDto { id: format!("capture:{}", Uuid::new_v4()), occurred_at: Some(timestamp.into()),
        plan_date: Some(plan_date.into()), kind: kind.into(), status, review_note: None, task_status,
        note_cleared: (note_changed && after.execution_note.as_deref().unwrap_or_default().trim().is_empty()).then_some(true),
        note: if note_changed { after.execution_note } else { None } };
    record_task_change(transaction, task_id, "history_snapshot", snapshot.as_deref(),
        Some(&serde_json::to_string(&event)?), "system", audit_ids.as_deref())
}

pub(super) fn record_untimed_capture_change(
    transaction: &Transaction<'_>,
    task_id: &str,
    plan_date: &str,
    audit_cursor: i64,
    timestamp: &str,
    note: Option<&str>,
    note_only: bool,
) -> AppResult<()> {
    let (task_status, audit_ids, status_reopened, undo_reopened) =
        linked_audit_info(transaction, task_id, audit_cursor, note_only)?;
    let clean_note = note.map(str::trim).filter(|value| !value.is_empty()).map(str::to_owned);
    if task_status.is_none() && (!note_only || clean_note.is_none()) {
        return Ok(());
    }
    let reopened = status_reopened || undo_reopened;
    let (kind, status, recorded_task_status) = if reopened {
        ("reopened", task_status.clone(), task_status)
    } else if note_only {
        ("note", None, None)
    } else {
        ("execution", task_status.clone(), task_status)
    };
    let event = TaskHistoryEventDto {
        id: format!("capture:{}", Uuid::new_v4()),
        occurred_at: Some(timestamp.into()),
        plan_date: Some(plan_date.into()),
        kind: kind.into(),
        status,
        note: clean_note,
        review_note: None,
        note_cleared: None,
        task_status: recorded_task_status,
    };
    record_task_change(
        transaction,
        task_id,
        "history_snapshot",
        None,
        Some(&serde_json::to_string(&event)?),
        "system",
        audit_ids.as_deref(),
    )
}


pub(super) fn load(connection: &Connection, task_id: &str) -> AppResult<Vec<TaskHistoryEventDto>> {
    let created_at: String = connection.query_row("SELECT created_at FROM tasks WHERE id = ?1", [task_id], |row| row.get(0))?;
    let initial_status: Option<String> = connection.query_row("SELECT new_value FROM task_changes
        WHERE task_id = ?1 AND change_kind IN ('created', 'created_from_draft', 'created_from_recurrence')
        ORDER BY rowid LIMIT 1", [task_id], |row| row.get(0)).optional()?.flatten();
    let created = TaskHistoryEventDto { id: format!("created:{task_id}"), occurred_at: Some(created_at),
        plan_date: None, kind: "created".into(), status: initial_status.and_then(real_status), note: None, review_note: None, note_cleared: None, task_status: None };
    let mut events = Vec::new();
    let mut seen = HashSet::new();
    let mut statement = connection.prepare("SELECT rowid, id, change_kind, new_value, reason, created_at, old_value
        FROM task_changes WHERE task_id = ?1 ORDER BY rowid")?;
    let changes = statement.query_map([task_id], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?,
        row.get::<_, String>(2)?, row.get::<_, Option<String>>(3)?, row.get::<_, Option<String>>(4)?,
        row.get::<_, String>(5)?, row.get::<_, Option<String>>(6)?)))?.collect::<Result<Vec<_>, _>>()?;
    let linked_audits: HashSet<String> = changes.iter().filter(|change| change.2 == "history_snapshot")
        .filter_map(|change| change.4.as_deref()).flat_map(|ids| ids.split(',').map(str::to_owned)).collect();
    for (order, id, kind, new_value, reason, timestamp, old_value) in changes {
        if kind == "history_snapshot" {
            if let Some(snapshot) = old_value { seen.insert(snapshot); }
            if let Some(event) = new_value.as_deref().and_then(|json| serde_json::from_str::<TaskHistoryEventDto>(json).ok()) {
                if seen.insert(serde_json::to_string(&event)?) {
                    let mut event = event;
                    let delta = event.id.starts_with("capture:");
                    if !delta { event.id = format!("history:{id}"); }
                    let rank = if delta || matches!(event.kind.as_str(), "cleared" | "cleared_incomplete") { 2 } else { 1 };
                    events.push((event, rank, order));
                }
            }
            continue;
        }
        if linked_audits.contains(&id) { continue; }
        if kind == "completion_note_changed" {
            if new_value.is_some() {
                events.push((TaskHistoryEventDto { id: format!("change:{id}"), occurred_at: Some(timestamp), plan_date: None,
                    kind: "note".into(), status: None, note: new_value, review_note: None, note_cleared: None, task_status: None }, 2, order));
            }
            continue;
        }
        if !matches!(kind.as_str(), "status_changed" | "soft_deleted" | "restored" | "undo_task_completed" | "undo_plan_status" | "execution_resolved") { continue; }
        let status = if kind == "execution_resolved" {
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
        let note = if automatic { None } else if kind == "status_changed" && status.as_deref() == Some("done") {
            reason.filter(|note| note != "明确完成整个任务")
        } else if kind == "execution_resolved" { reason } else { None };
        events.push((TaskHistoryEventDto { id: format!("change:{id}"), occurred_at: Some(timestamp), plan_date: None,
            kind: if automatic { "automatic_status" } else if reopened { "reopened" } else if matches!(kind.as_str(), "soft_deleted" | "restored") { kind.as_str() } else { "status" }.into(), status, note, review_note: None, note_cleared: None, task_status: None }, 2, order));
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

pub(super) fn capture_snapshot(connection: &Connection, id: &str) -> AppResult<ExecutionSnapshot> {
    let mut snapshot = execution_snapshot(connection, id)?;
    if let Some((outcome, note)) = connection.query_row("SELECT outcome, notes FROM review_entries WHERE plan_block_id = ?1", [id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))).optional()? {
        snapshot.execution_status = outcome;
        snapshot.execution_note = note.or(snapshot.execution_note);
    }
    Ok(snapshot)
}

pub(super) fn capture_unchanged(before: &ExecutionSnapshot, outcome: &str, note: Option<&str>) -> bool {
    before.execution_status == outcome && before.execution_note.as_deref().unwrap_or_default().trim() == note.unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TODAY: &str = "2026-10-16";
    #[test]
    fn unplanned_completion_note_revisions_do_not_repeat_the_done_status() {
        let _clock = TestToday::new(TODAY);
        let mut db = Database::in_memory().unwrap();
        let task = db.create_manual_task("Unplanned notes").unwrap();
        for note in ["111222", " 111222 ", "revised"] {
            db.complete_task_with_note(&task, None, Some(note.into())).unwrap();
        }
        let history = db.get_task_metadata(&task).unwrap().history;
        assert_eq!(history.iter().skip(1).map(|event| (event.kind.as_str(), event.status.as_deref(), event.note.as_deref())).collect::<Vec<_>>(),
            [("status", Some("done"), Some("111222")), ("note", None, Some("revised"))]);
    }


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
            outcome: Some(ReviewOutcome::Partial), note: Some(note.into()) }).unwrap();
    }

    fn review(block: &str, note: &str) -> ReviewEntryInput {
        ReviewEntryInput { plan_block_id: block.into(), outcome: ReviewOutcome::Blocked,
            actual_minutes: None, defer_reason: None, notes: Some(note.into()), remaining_workload_minutes: None }
    }

    #[test]
    fn capture_saves_record_only_the_fields_changed_at_that_save() {
        let _clock = TestToday::new(TODAY);
        for api in ["resolve", "capture", "whole"] {
            let mut db = Database::in_memory().unwrap();
            let task = db.create_manual_task(api).unwrap();
            let block = add_block(&db, &task, TODAY);
            let input = |outcome, note: &str| ExecutionCaptureInput { plan_block_id: block.clone(), outcome, note: Some(note.into()) };
            db.save_execution_capture(TODAY, input(None, "111222")).unwrap();
            let before = fact_fingerprint(&db.connection, "execution_capture", &task).unwrap();
            db.save_execution_capture(TODAY, input(None, " 111222 ")).unwrap();
            assert_eq!(fact_fingerprint(&db.connection, "execution_capture", &task).unwrap(), before);

            match api {
                "resolve" => { db.resolve_task_execution(TODAY, super::super::database_execution::TaskExecutionResolutionInput {
                    plan_block_id: block.clone(), expected_task_updated_at: db.get_task(&task).unwrap().updated_at,
                    outcome: ReviewOutcome::Completed, note: Some("111222".into()), next_action: None,
                    starts_at: None, ends_at: None, remaining_workload_minutes: None,
                }).unwrap(); }
                "capture" => db.save_execution_capture(TODAY, input(Some(ReviewOutcome::Completed), "111222")).unwrap(),
                _ => { db.complete_task_with_note(&task, Some(&block), Some("111222".into())).unwrap(); }
            }
            db.clear_execution_capture_with_note(TODAY, &block, Some("111222".into())).unwrap();
            let events = db.get_task_metadata(&task).unwrap().history;
            assert_eq!(events.iter().skip(1).map(|e| (e.kind.as_str(), e.note.as_deref(), e.note_cleared)).collect::<Vec<_>>(),
                vec![("note", Some("111222"), None), ("execution", None, None), ("cleared", None, None)], "{api}");
            assert_eq!(execution_snapshot(&db.connection, &block).unwrap().execution_note.as_deref(), Some("111222"));

            db.save_execution_capture(TODAY, input(None, " ")).unwrap();
            db.save_execution_capture(TODAY, input(Some(ReviewOutcome::Partial), "同次保存")).unwrap();
            db.apply_undo(&db.latest_undo().unwrap().unwrap().id).unwrap();
            let events = db.get_task_metadata(&task).unwrap().history;
            assert_eq!(events[4].kind, "note");
            assert_eq!(events[4].note_cleared, Some(true));
            assert_eq!((events[5].status.as_deref(), events[5].note.as_deref()), (Some("not_completed"), Some("同次保存")));
            assert_eq!((events[6].kind.as_str(), events[6].note_cleared), ("cleared_incomplete", Some(true)));
            assert_eq!(events.len(), 7);
            assert!(execution_snapshot(&db.connection, &block).unwrap().execution_note.is_none());
        }
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
            outcome: Some(ReviewOutcome::Completed), note: Some("用户的完成备注".into()) }).unwrap();
        assert_eq!(db.get_task(&id).unwrap().status, "done");
        let events = db.get_task_metadata(&id).unwrap().history;
        assert_eq!(events.len(), 2);
        let event = &events[1];
        assert_eq!((event.kind.as_str(), event.task_status.as_deref(), event.note.as_deref()),
            ("execution", Some("done"), Some("用户的完成备注")));
        assert_eq!(event.review_note, None);

        // Identical user wording must remain a note on the execution fact, not be filtered globally.
        capture(&mut db, &block, TODAY, "汇总全部执行块结果");
        assert_eq!(db.get_task(&id).unwrap().status, "scheduled");
        let before = fact_fingerprint(&db.connection, "task_completion", &id).unwrap();
        let events = db.get_task_metadata(&id).unwrap().history;
        assert_eq!(events.len(), 3);
        assert_eq!(events[2].task_status.as_deref(), Some("scheduled"));
        assert_eq!(events[2].note.as_deref(), Some("汇总全部执行块结果"));
        assert_eq!(events[1].note.as_deref(), Some("用户的完成备注"));
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
        assert_eq!(events.iter().find(|e| e.note.as_deref() == Some("first completion")).unwrap().kind, "execution");
        assert_eq!(events.iter().find(|e| e.note.as_deref() == Some("corrected completion")).unwrap().kind, "note");
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
            outcome: Some(ReviewOutcome::Completed), note: None }).unwrap();
        db.clear_execution_capture(TODAY, &block).unwrap();
        let history = db.get_task_metadata(&id).unwrap().history;
        assert!(history.iter().any(|event| event.kind == "cleared" && event.plan_date.as_deref() == Some(TODAY)
            && event.task_status.as_deref() == Some("scheduled")));
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
            outcome: Some(ReviewOutcome::Blocked), note: Some("rejected".into()) }).is_err());
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
        assert_eq!(events.last().unwrap().status.as_deref(), Some("scheduled"));
        // Old execution rows may be gone, but the resolution audit still contains a real note.
        db.connection.execute("INSERT INTO task_changes(id,task_id,change_kind,old_value,new_value,source,reason,created_at)
            VALUES ('legacy-resolution',?1,'execution_resolved','partial','wait','manual','legacy update note',?2)", params![id,now()]).unwrap();
        let events = db.get_task_metadata(&id).unwrap().history;
        let last = events.last().unwrap();
        assert_eq!((last.kind.as_str(),last.status.as_deref(),last.note.as_deref()), ("status",Some("open"),Some("legacy update note")));
        assert_eq!(last.plan_date, None, "missing block context must not be invented");
    }
}
