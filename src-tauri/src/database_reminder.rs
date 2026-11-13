use chrono::DateTime;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppResult;
use super::{Database, TaskBlockNotificationDto};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DueReminderSnooze {
    pub reminder: TaskBlockNotificationDto,
    pub is_snoozed: bool,
}

impl Database {
    fn reminder_schedule_is_current(connection: &rusqlite::Connection, reminder: &TaskBlockNotificationDto) -> AppResult<bool> {
        connection.query_row(
            "SELECT 1 FROM plan_blocks block JOIN daily_plans plan ON plan.id = block.daily_plan_id JOIN tasks task ON task.id = block.task_id WHERE block.id = ?1 AND block.task_id = ?2 AND block.starts_at = ?3 AND block.ends_at = ?4 AND (SELECT revision FROM task_block_reminder_revisions WHERE block_id = block.id) IS ?5 AND plan.status = 'confirmed' AND block.execution_status = 'planned' AND task.deleted_at IS NULL AND task.status NOT IN ('done','deleted')",
            params![reminder.block_id, reminder.task_id, reminder.starts_at, reminder.ends_at, reminder.schedule_revision], |_| Ok(true),
        ).optional().map(|value| value.unwrap_or(false)).map_err(crate::error::AppError::from)
    }

    pub fn complete_task_block_reminder(&mut self, reminder: &TaskBlockNotificationDto) -> AppResult<bool> {
        if !reminder.is_end || !Self::reminder_schedule_is_current(&self.connection, reminder)? { return Ok(false); }
        let details: Option<(String, Option<String>)> = self.connection.query_row(
            "SELECT plan.plan_date, COALESCE(review.notes, block.execution_note) FROM plan_blocks block
             JOIN daily_plans plan ON plan.id = block.daily_plan_id JOIN tasks task ON task.id = block.task_id
             LEFT JOIN review_entries review ON review.plan_block_id = block.id
             WHERE block.id = ?1 AND plan.status = 'confirmed' AND task.deleted_at IS NULL
               AND task.status NOT IN ('done','deleted') AND block.execution_status = 'planned'
               AND review.id IS NULL", [&reminder.block_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional()?;
        let Some((date, note)) = details else { return Ok(false); };
        self.save_execution_capture(&date, super::ExecutionCaptureInput {
            plan_block_id: reminder.block_id.clone(), outcome: Some(super::ReviewOutcome::Completed), note,
        })?;
        Ok(true)
    }

    pub fn snooze_task_block_reminder(&mut self, reminder: &TaskBlockNotificationDto, now: &str) -> AppResult<bool> {
        if !Self::reminder_schedule_is_current(&self.connection, reminder)? { return Ok(false); }
        let key = format!("{}:{}:{}", reminder.block_id, if reminder.is_end { "end" } else { "start" }, reminder.event_at);
        let payload = serde_json::to_string(reminder).map_err(|error| crate::error::AppError::Schema(error.to_string()))?;
        let fire_at = (DateTime::parse_from_rfc3339(now).map_err(|error| crate::error::AppError::Schema(error.to_string()))? + chrono::Duration::minutes(5)).to_rfc3339();
        let changed = self.connection.execute(
            "INSERT OR IGNORE INTO task_block_reminder_snoozes (id, reminder_key, payload, fire_at, status) VALUES (?1, ?2, ?3, ?4, 'pending')",
            params![Uuid::new_v4().to_string(), key, payload, fire_at],
        )?;
        Ok(changed == 1)
    }

    pub fn claim_due_task_block_reminder_snoozes(&mut self, now: &str) -> AppResult<Vec<DueReminderSnooze>> {
        let transaction = self.connection.transaction()?;
        let due = {
            let mut statement = transaction.prepare("SELECT id, payload FROM task_block_reminder_snoozes WHERE status = 'pending' AND julianday(fire_at) <= julianday(?1)")?;
            let rows = statement.query_map([now], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let mut claimed = Vec::new();
        for (id, payload) in due {
            let reminder: TaskBlockNotificationDto = serde_json::from_str(&payload).map_err(|error| crate::error::AppError::Schema(error.to_string()))?;
            let changed = transaction.execute("UPDATE task_block_reminder_snoozes SET status = 'sent' WHERE id = ?1 AND status = 'pending'", [&id])?;
            if changed == 1 && Self::reminder_schedule_is_current(&transaction, &reminder)? { claimed.push(DueReminderSnooze { reminder, is_snoozed: true }); }
        }
        transaction.commit()?;
        Ok(claimed)
    }

    pub fn task_block_reminder_snooze_exists(&self, reminder: &TaskBlockNotificationDto) -> AppResult<bool> {
        let key = format!("{}:{}:{}", reminder.block_id, if reminder.is_end { "end" } else { "start" }, reminder.event_at);
        self.connection.query_row("SELECT 1 FROM task_block_reminder_snoozes WHERE reminder_key = ?1", [&key], |_| Ok(true))
            .optional().map(|value| value.unwrap_or(false)).map_err(crate::error::AppError::from)
    }
}

pub const MIGRATION: &str = r#"
    CREATE TABLE IF NOT EXISTS task_block_reminder_snoozes (
        id TEXT PRIMARY KEY,
        reminder_key TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        fire_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','sent'))
    );
    CREATE INDEX IF NOT EXISTS idx_task_block_reminder_snoozes_due ON task_block_reminder_snoozes(status, fire_at);
"#;

pub const REVISION_MIGRATION: &str = r#"
    CREATE TABLE IF NOT EXISTS task_block_reminder_revisions (block_id TEXT PRIMARY KEY, revision TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS invalidate_task_block_reminders_on_time_change
    AFTER UPDATE OF starts_at, ends_at ON plan_blocks
    WHEN OLD.starts_at IS NOT NEW.starts_at OR OLD.ends_at IS NOT NEW.ends_at
    BEGIN
        INSERT INTO task_block_reminder_revisions (block_id, revision) VALUES (OLD.id, lower(hex(randomblob(16))))
        ON CONFLICT(block_id) DO UPDATE SET revision = excluded.revision;
        DELETE FROM task_block_reminder_snoozes WHERE json_extract(payload, '$.block_id') = OLD.id;
    END;
    CREATE TRIGGER IF NOT EXISTS invalidate_task_block_reminders_on_delete
    AFTER DELETE ON plan_blocks
    BEGIN
        INSERT INTO task_block_reminder_revisions (block_id, revision) VALUES (OLD.id, lower(hex(randomblob(16))))
        ON CONFLICT(block_id) DO UPDATE SET revision = excluded.revision;
        DELETE FROM task_block_reminder_snoozes WHERE json_extract(payload, '$.block_id') = OLD.id;
    END;
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn reminder() -> TaskBlockNotificationDto {
        TaskBlockNotificationDto {
            block_id: "block-1".into(), task_id: "task-1".into(), task_title: "测试任务".into(),
            task_notes: Some("备注".into()), task_priority: Some("high".into()), task_tags: vec!["工作".into()],
            starts_at: "2026-11-11T14:30:00+08:00".into(), ends_at: "2026-11-11T15:00:00+08:00".into(),
            event_at: "2026-11-11T14:30:00+08:00".into(), is_end: false, schedule_revision: None,
        }
    }

    fn fixture(database: &mut Database) -> TaskBlockNotificationDto {
        let mut reminder = reminder();
        reminder.task_id = database.create_manual_task("测试任务").unwrap();
        database.connection.execute("INSERT INTO daily_plans (id,plan_date,status,source,created_at,confirmed_at) VALUES ('plan-1','2026-11-11','confirmed','manual','now','now')", []).unwrap();
        database.connection.execute("INSERT INTO plan_blocks (id,daily_plan_id,task_id,starts_at,ends_at,source,created_at,updated_at) VALUES (?1,'plan-1',?2,?3,?4,'manual','now','now')", params![reminder.block_id, reminder.task_id, reminder.starts_at, reminder.ends_at]).unwrap();
        reminder
    }

    #[test]
    fn snooze_is_unique_and_due_items_are_claimed_once() {
        let mut database = Database::in_memory().unwrap();
        let reminder = fixture(&mut database);
        assert!(database.snooze_task_block_reminder(&reminder, "2026-11-11T06:00:00Z").unwrap());
        assert!(!database.snooze_task_block_reminder(&reminder, "2026-11-11T06:01:00Z").unwrap());
        assert!(database.task_block_reminder_snooze_exists(&reminder).unwrap());
        assert!(database.claim_due_task_block_reminder_snoozes("2026-11-11T06:04:59Z").unwrap().is_empty());
        let due = database.claim_due_task_block_reminder_snoozes("2026-11-11T06:05:00Z").unwrap();
        assert_eq!(due.len(), 1);
        assert!(due[0].is_snoozed);
        assert_eq!(due[0].reminder, reminder);
        assert!(database.claim_due_task_block_reminder_snoozes("2026-11-11T06:06:00Z").unwrap().is_empty());
    }

    #[test]
    fn changing_time_invalidates_pending_and_old_notification_even_when_restored() {
        let mut database = Database::in_memory().unwrap();
        let reminder = fixture(&mut database);
        assert!(database.snooze_task_block_reminder(&reminder, "2026-11-11T06:00:00Z").unwrap());
        database.connection.execute("UPDATE plan_blocks SET ends_at = '2026-11-11T16:00:00+08:00' WHERE id = ?1", [&reminder.block_id]).unwrap();
        assert!(database.claim_due_task_block_reminder_snoozes("2026-11-11T06:05:00Z").unwrap().is_empty());
        assert!(!database.snooze_task_block_reminder(&reminder, "2026-11-11T06:06:00Z").unwrap());
        database.connection.execute("UPDATE plan_blocks SET ends_at = ?2 WHERE id = ?1", params![reminder.block_id, reminder.ends_at]).unwrap();
        assert!(!database.snooze_task_block_reminder(&reminder, "2026-11-11T06:07:00Z").unwrap());
        let mut new_reminder = reminder.clone();
        new_reminder.schedule_revision = database.connection.query_row("SELECT revision FROM task_block_reminder_revisions WHERE block_id = ?1", [&reminder.block_id], |row| row.get(0)).unwrap();
        assert!(database.snooze_task_block_reminder(&new_reminder, "2026-11-11T06:08:00Z").unwrap());
        assert_eq!(database.claim_due_task_block_reminder_snoozes("2026-11-11T06:13:00Z").unwrap().len(), 1);
    }

    #[test]
    fn end_notification_completes_block_once_and_preserves_note() {
        let _clock = super::super::TestToday::new("2026-11-11");
        let mut database = Database::in_memory().unwrap();
        let mut reminder = fixture(&mut database);
        reminder.is_end = true;
        reminder.event_at = reminder.ends_at.clone();
        database.connection.execute("UPDATE plan_blocks SET execution_note = '已有备注' WHERE id = ?1", [&reminder.block_id]).unwrap();
        assert!(database.snooze_task_block_reminder(&reminder, "2026-11-11T06:00:00Z").unwrap());
        assert!(database.complete_task_block_reminder(&reminder).unwrap());
        let (status, note): (String, Option<String>) = database.connection.query_row("SELECT execution_status, execution_note FROM plan_blocks WHERE id = ?1", [&reminder.block_id], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
        assert_eq!(status, "completed");
        assert_eq!(note.as_deref(), Some("已有备注"));
        assert!(!database.complete_task_block_reminder(&reminder).unwrap());
        assert!(database.claim_due_task_block_reminder_snoozes("2026-11-11T06:05:00Z").unwrap().is_empty());
    }

    #[test]
    fn start_and_stale_notifications_cannot_complete_block() {
        let _clock = super::super::TestToday::new("2026-11-11");
        let mut database = Database::in_memory().unwrap();
        let mut reminder = fixture(&mut database);
        assert!(!database.complete_task_block_reminder(&reminder).unwrap());
        reminder.is_end = true;
        database.connection.execute("UPDATE plan_blocks SET ends_at = '2026-11-11T16:00:00+08:00' WHERE id = ?1", [&reminder.block_id]).unwrap();
        assert!(!database.complete_task_block_reminder(&reminder).unwrap());
        assert_eq!(database.connection.query_row("SELECT execution_status FROM plan_blocks WHERE id = ?1", [&reminder.block_id], |row| row.get::<_, String>(0)).unwrap(), "planned");
    }

}
