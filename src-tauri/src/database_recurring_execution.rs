//! Durable execution snapshots and recurring lifecycle history.
use super::*;

pub(super) const MIGRATION: &str = r#"
    CREATE TABLE recurring_execution_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recurring_item_id TEXT NOT NULL REFERENCES recurring_items(id) ON DELETE CASCADE,
        occurrence_id TEXT NOT NULL REFERENCES recurring_occurrences(id) ON DELETE CASCADE,
        occurrence_date TEXT NOT NULL,
        title TEXT NOT NULL,
        display_time TEXT,
        display_duration_minutes INTEGER,
        outcome TEXT CHECK(outcome IN ('completed','partial','not_completed')),
        notes TEXT,
        occurred_at TEXT NOT NULL
    );
    CREATE INDEX idx_recurring_execution_item ON recurring_execution_events(recurring_item_id, occurrence_date, id);
    INSERT INTO recurring_execution_events
        (recurring_item_id, occurrence_id, occurrence_date, title, display_time,
         display_duration_minutes, outcome, notes, occurred_at)
    SELECT recurring_item_id, id, occurrence_date, snapshot_title, snapshot_time,
           snapshot_duration, outcome, review_notes, COALESCE(reviewed_at, updated_at)
    FROM recurring_occurrences WHERE outcome IS NOT NULL
    ORDER BY COALESCE(reviewed_at, updated_at), id;
    UPDATE recurring_occurrences SET is_exception = 1 WHERE outcome IS NOT NULL;
"#;

pub(super) const STATUS_TIMESTAMP_MIGRATION: &str = r#"
    ALTER TABLE recurring_status_versions ADD COLUMN occurred_at TEXT;
"#;

pub(super) const LIFECYCLE_MIGRATION: &str = r#"
    CREATE TABLE recurring_lifecycle_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recurring_item_id TEXT NOT NULL REFERENCES recurring_items(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('soft_deleted', 'restored')),
        action_date TEXT NOT NULL,
        title TEXT NOT NULL,
        occurred_at TEXT NOT NULL
    );
    CREATE INDEX idx_recurring_lifecycle_item ON recurring_lifecycle_events(recurring_item_id, id);
    -- Only a still-deleted item's deletion time is known. Past restorations
    -- and earlier trash cycles cannot be reconstructed from updated_at.
    INSERT INTO recurring_lifecycle_events(recurring_item_id, kind, action_date, title, occurred_at)
    SELECT id, 'soft_deleted', date(deleted_at, '+8 hours'), title, deleted_at
    FROM recurring_items
    WHERE deleted_at IS NOT NULL AND date(deleted_at, '+8 hours') IS NOT NULL
    ORDER BY deleted_at, id;
"#;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RecurringExecutionEventDto {
    pub id: String,
    pub kind: String,
    pub occurrence_id: Option<String>,
    pub occurrence_date: String,
    pub title: String,
    pub display_time: Option<String>,
    pub display_duration_minutes: Option<i64>,
    pub outcome: Option<String>,
    pub cancelled_outcome: Option<String>,
    pub notes: Option<String>,
    pub occurred_at: String,
}

pub(super) fn record(connection: &Connection, occurrence_id: &str, timestamp: &str) -> AppResult<()> {
    connection.execute(
        "INSERT INTO recurring_execution_events
            (recurring_item_id, occurrence_id, occurrence_date, title, display_time,
             display_duration_minutes, outcome, notes, occurred_at)
         SELECT recurring_item_id, id, occurrence_date, snapshot_title, snapshot_time,
                snapshot_duration, outcome, review_notes, ?2
         FROM recurring_occurrences WHERE id = ?1",
        params![occurrence_id, timestamp],
    )?;
    Ok(())
}

pub(super) fn record_lifecycle(
    connection: &Connection, item: &RecurringItemDto, kind: &str, timestamp: &str,
) -> AppResult<()> {
    connection.execute(
        "INSERT INTO recurring_lifecycle_events(recurring_item_id, kind, action_date, title, occurred_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![item.id, kind, shanghai_today(), item.title, timestamp],
    )?;
    Ok(())
}

impl Database {
    pub fn list_recurring_execution_history(&self, item_id: &str) -> AppResult<Vec<RecurringExecutionEventDto>> {
        // Active baselines and repeated active requests are not resumptions. The
        // immediately preceding series state must be paused, including legacy rows.
        let mut statement = self.connection.prepare(
            "SELECT CAST(event.id AS TEXT), 'execution', event.occurrence_id, event.occurrence_date, event.title,
                    event.display_time, event.display_duration_minutes, event.outcome, event.notes, event.occurred_at, event.id, 0,
                    CASE WHEN event.outcome IS NULL THEN (
                        SELECT previous.outcome FROM recurring_execution_events previous
                        WHERE previous.occurrence_id = event.occurrence_id AND previous.id < event.id
                        ORDER BY previous.id DESC LIMIT 1
                    ) END
             FROM recurring_execution_events event WHERE event.recurring_item_id = ?1
             UNION ALL
             SELECT 'status:' || s.id,
                    CASE s.status WHEN 'active' THEN 'resumed' ELSE s.status END,
                    NULL, date(s.effective_from, '-1 day'), i.title, NULL, NULL, NULL, NULL,
                    COALESCE(s.occurred_at, date(s.effective_from, '-1 day')), s.id, 1, NULL
             FROM recurring_status_versions s JOIN recurring_items i ON i.id = s.recurring_item_id
             WHERE s.recurring_item_id = ?1 AND (
                 s.status IN ('paused', 'ended') OR (s.status = 'active' AND (
                     SELECT previous.status FROM recurring_status_versions previous
                     WHERE previous.recurring_item_id = s.recurring_item_id AND previous.id < s.id
                     ORDER BY previous.id DESC LIMIT 1
                 ) = 'paused'))
             UNION ALL
             SELECT 'lifecycle:' || id, kind, NULL, action_date, title, NULL, NULL, NULL, NULL,
                    occurred_at, id, 2, NULL
             FROM recurring_lifecycle_events WHERE recurring_item_id = ?1",
        )?;
        let rows = statement.query_map([item_id], |row| Ok((RecurringExecutionEventDto {
            id: row.get(0)?, kind: row.get(1)?, occurrence_id: row.get(2)?,
            occurrence_date: row.get(3)?, title: row.get(4)?, display_time: row.get(5)?,
            display_duration_minutes: row.get(6)?, outcome: row.get(7)?, notes: row.get(8)?,
            occurred_at: row.get(9)?, cancelled_outcome: row.get(12)?,
        }, row.get::<_, i64>(10)?, row.get::<_, i64>(11)?)))?;
        let mut events = rows.collect::<Result<Vec<_>, _>>()?;
        // Keep schedule days grouped, then compare actual instants (including nanoseconds
        // and offsets). Legacy date-only actions sort first without inventing a time.
        // Source sequences preserve repeated executions and lifecycle actions at equal times.
        events.sort_by_cached_key(|(event, sequence, source)| (
            event.occurrence_date.clone(),
            DateTime::parse_from_rfc3339(&event.occurred_at).ok().map(|time| time.with_timezone(&Utc)),
            *source, *sequence,
        ));
        Ok(events.into_iter().map(|(event, _, _)| event).collect())
    }

    pub fn clear_recurring_occurrence_review(&mut self, occurrence_id: &str, notes: Option<String>) -> AppResult<RecurringOccurrenceDto> {
        let notes = normalize_review_text(notes, 2000, "复盘备注")?;
        let transaction = self.connection.transaction()?;
        let before = load_occurrence(&transaction, occurrence_id)?;
        validate_review_target(&transaction, &before.occurrence_date, "recurring", occurrence_id)?;
        if before.occurrence_date != shanghai_today() {
            return Err(AppError::Domain("只能取消今天的重复事项结果；过去记录只读".into()));
        }
        if before.outcome.is_some() || before.review_notes != notes {
            let timestamp = now();
            transaction.execute(
                "UPDATE recurring_occurrences SET outcome = NULL, review_notes = ?3,
                    reviewed_at = ?4, updated_at = ?2, is_exception = 1 WHERE id = ?1",
                params![occurrence_id, timestamp, notes, notes.as_ref().map(|_| &timestamp)],
            )?;
            record(&transaction, occurrence_id, &timestamp)?;
        }
        clear_review_draft(&transaction, &before.occurrence_date, "recurring", occurrence_id)?;
        let occurrence = load_occurrence(&transaction, occurrence_id)?;
        transaction.commit()?;
        Ok(occurrence)
    }
}
