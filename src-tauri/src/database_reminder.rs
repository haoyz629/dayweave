use chrono::DateTime;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{minutes_to_rfc3339, shanghai_now};
use crate::error::AppResult;

use super::{Database, TaskBlockNotificationDto};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DueReminderSnooze {
    pub reminder: TaskBlockNotificationDto,
    pub is_snoozed: bool,
}

pub const MIGRATION: &str = r#"
    CREATE TABLE IF NOT EXISTS task_reminder_sent (
        reminder_key TEXT PRIMARY KEY,
        sent_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_reminder_snoozes (
        id TEXT PRIMARY KEY,
        reminder_key TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        fire_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
    );
"#;

impl Database {
    fn reminder_task_is_current(
        connection: &rusqlite::Connection,
        reminder: &TaskBlockNotificationDto,
    ) -> AppResult<bool> {
        let row: Option<(String, i64, i64, String)> = connection
            .query_row(
                "SELECT date, start_min, duration, updated_at FROM tasks WHERE id = ?1 AND mode = 'timeline' AND done = 0 AND deleted_at IS NULL",
                [&reminder.task_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?;
        let Some((date, start_min, duration, updated_at)) = row else {
            return Ok(false);
        };
        let starts_at = minutes_to_rfc3339(&date, start_min)?;
        let ends_at = minutes_to_rfc3339(&date, (start_min + duration).min(24 * 60))?;
        Ok(starts_at == reminder.starts_at
            && ends_at == reminder.ends_at
            && reminder.schedule_revision.as_deref() == Some(updated_at.as_str()))
    }

    pub fn claim_due_task_block_notifications(
        &mut self,
        lead_minutes: i64,
    ) -> AppResult<Vec<TaskBlockNotificationDto>> {
        if lead_minutes <= 0 {
            return Ok(Vec::new());
        }
        let now = shanghai_now();
        let today = now.format("%Y-%m-%d").to_string();
        let now_ts = now.timestamp();
        let window_secs = lead_minutes * 60;

        let mut stmt = self.connection.prepare(
            "SELECT t.id, t.title, t.note, t.priority, COALESCE(tg.name, ''), t.date, t.start_min, t.duration, t.updated_at
             FROM tasks t
             LEFT JOIN tags tg ON tg.id = t.tag_id
             WHERE t.mode = 'timeline' AND t.done = 0 AND t.deleted_at IS NULL AND t.date = ?1",
        )?;
        let candidates: Vec<(String, String, String, String, String, String, i64, i64, String)> = stmt
            .query_map([&today], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);

        let mut due = Vec::new();
        for (id, title, note, priority, tag_name, date, start_min, duration, updated_at) in candidates {
            let starts_at = minutes_to_rfc3339(&date, start_min)?;
            let ends_at = minutes_to_rfc3339(&date, (start_min + duration).min(24 * 60))?;
            let start_dt = DateTime::parse_from_rfc3339(&starts_at)
                .map_err(|e| crate::error::AppError::Schema(e.to_string()))?;
            let end_dt = DateTime::parse_from_rfc3339(&ends_at)
                .map_err(|e| crate::error::AppError::Schema(e.to_string()))?;

            let tags = if tag_name.is_empty() {
                Vec::new()
            } else {
                vec![tag_name]
            };

            for (is_end, event_dt, event_str) in [
                (false, start_dt, &starts_at),
                (true, end_dt, &ends_at),
            ] {
                let diff = event_dt.timestamp() - now_ts;
                // Fire if event is within [0, lead_minutes] from now (allow 60s grace)
                if diff <= window_secs && diff >= -60 {
                    let key = format!(
                        "{}:{}:{}:{}",
                        id,
                        if is_end { "end" } else { "start" },
                        event_str,
                        updated_at
                    );
                    let inserted = self.connection.execute(
                        "INSERT OR IGNORE INTO task_reminder_sent (reminder_key, sent_at) VALUES (?1, ?2)",
                        params![key, now.to_rfc3339()],
                    )?;
                    if inserted == 1 {
                        due.push(TaskBlockNotificationDto {
                            block_id: id.clone(),
                            task_id: id.clone(),
                            task_title: title.clone(),
                            task_notes: if note.trim().is_empty() { None } else { Some(note.clone()) },
                            task_priority: if priority.is_empty() { None } else { Some(priority.clone()) },
                            task_tags: tags.clone(),
                            starts_at: starts_at.clone(),
                            ends_at: ends_at.clone(),
                            event_at: event_str.clone(),
                            is_end,
                            schedule_revision: Some(updated_at.clone()),
                        });
                    }
                }
            }
        }
        Ok(due)
    }

    pub fn complete_task_block_reminder(
        &mut self,
        reminder: &TaskBlockNotificationDto,
    ) -> AppResult<bool> {
        if !reminder.is_end || !Self::reminder_task_is_current(&self.connection, reminder)? {
            return Ok(false);
        }
        let changed = self.connection.execute(
            "UPDATE tasks SET done = 1, updated_at = ?2 WHERE id = ?1 AND done = 0 AND deleted_at IS NULL",
            params![reminder.task_id, crate::domain::now_rfc3339()],
        )?;
        Ok(changed == 1)
    }

    pub fn snooze_task_block_reminder(
        &mut self,
        reminder: &TaskBlockNotificationDto,
        now: &str,
    ) -> AppResult<bool> {
        if !Self::reminder_task_is_current(&self.connection, reminder)? {
            return Ok(false);
        }
        let key = format!(
            "{}:{}:{}",
            reminder.task_id,
            if reminder.is_end { "end" } else { "start" },
            reminder.event_at
        );
        let payload = serde_json::to_string(reminder)?;
        let fire_at = (DateTime::parse_from_rfc3339(now)
            .map_err(|e| crate::error::AppError::Schema(e.to_string()))?
            + chrono::Duration::minutes(5))
        .to_rfc3339();
        let changed = self.connection.execute(
            "INSERT OR IGNORE INTO task_reminder_snoozes (id, reminder_key, payload, fire_at, status) VALUES (?1, ?2, ?3, ?4, 'pending')",
            params![Uuid::new_v4().to_string(), key, payload, fire_at],
        )?;
        Ok(changed == 1)
    }

    pub fn claim_due_task_block_reminder_snoozes(
        &mut self,
        now: &str,
    ) -> AppResult<Vec<DueReminderSnooze>> {
        let transaction = self.connection.transaction()?;
        let due = {
            let mut stmt = transaction.prepare(
                "SELECT id, payload FROM task_reminder_snoozes WHERE status = 'pending' AND julianday(fire_at) <= julianday(?1)",
            )?;
            let rows = stmt
                .query_map([now], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        let mut claimed = Vec::new();
        for (id, payload) in due {
            let reminder: TaskBlockNotificationDto = serde_json::from_str(&payload)?;
            let changed = transaction.execute(
                "UPDATE task_reminder_snoozes SET status = 'sent' WHERE id = ?1 AND status = 'pending'",
                [&id],
            )?;
            if changed == 1 && Self::reminder_task_is_current(&transaction, &reminder)? {
                claimed.push(DueReminderSnooze {
                    reminder,
                    is_snoozed: true,
                });
            }
        }
        transaction.commit()?;
        Ok(claimed)
    }
}
