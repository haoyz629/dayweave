use std::collections::HashMap;
use std::fs;
use std::path::Path;

use chrono::{Datelike, Duration, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{
    clamp_duration, clamp_start_min, now_rfc3339, shanghai_now, shanghai_today_str, validate_date,
    validate_tag_name, validate_title, Priority, RecurrenceFrequency, ScheduleMode, TagColor,
};
use crate::error::{AppError, AppResult};
use crate::holiday_calendar::{
    self, CalendarState, Downloaded, Snapshot as HolidaySnapshot, UpdateJob,
};

#[path = "database_reminder.rs"]
mod database_reminder;

const BASE_SCHEMA_VERSION: i64 = 2;
const SCHEMA_VERSION: i64 = 3;
const TRASH_RETENTION_DAYS: i64 = 30;

pub struct Database {
    connection: Connection,
    holiday_calendar: CalendarState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagDto {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubtaskDto {
    pub id: String,
    pub text: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    pub title: String,
    pub note: String,
    pub mode: String,
    pub tag_id: String,
    pub priority: String,
    pub done: bool,
    pub date: String,
    pub start_min: i64,
    pub duration: i64,
    pub date_start: String,
    pub date_end: String,
    pub subtasks: Vec<SubtaskDto>,
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub title: String,
    #[serde(default)]
    pub note: String,
    pub mode: String,
    #[serde(default)]
    pub tag_id: String,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub done: bool,
    pub date: String,
    pub start_min: i64,
    pub duration: i64,
    pub date_start: String,
    pub date_end: String,
    #[serde(default)]
    pub subtasks: Vec<SubtaskInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtaskInput {
    #[serde(default)]
    pub id: Option<String>,
    pub text: String,
    #[serde(default)]
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftDto {
    pub id: String,
    pub title: String,
    pub note: String,
    pub mode: String,
    pub tag_id: String,
    pub priority: String,
    pub duration: i64,
    pub start_min: i64,
    pub date_start: String,
    pub date_end: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub note: String,
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub tag_id: String,
    #[serde(default)]
    pub priority: String,
    #[serde(default = "default_duration")]
    pub duration: i64,
    #[serde(default = "default_start_min")]
    pub start_min: i64,
    #[serde(default)]
    pub date_start: String,
    #[serde(default)]
    pub date_end: String,
}

fn default_mode() -> String {
    "pool".into()
}
fn default_duration() -> i64 {
    60
}
fn default_start_min() -> i64 {
    17 * 60
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecurringRuleDto {
    pub id: String,
    pub title: String,
    pub note: String,
    pub tag_id: String,
    pub priority: String,
    pub frequency: String,
    pub weekdays: Vec<u32>,
    pub month_day: Option<u32>,
    pub mode: String,
    pub start_min: Option<i64>,
    pub duration: i64,
    pub starts_on: String,
    pub ends_on: Option<String>,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringRuleInput {
    pub title: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub tag_id: String,
    #[serde(default)]
    pub priority: String,
    pub frequency: String,
    #[serde(default)]
    pub weekdays: Vec<u32>,
    #[serde(default)]
    pub month_day: Option<u32>,
    #[serde(default = "default_recurring_mode")]
    pub mode: String,
    #[serde(default)]
    pub start_min: Option<i64>,
    #[serde(default = "default_duration")]
    pub duration: i64,
    pub starts_on: String,
    #[serde(default)]
    pub ends_on: Option<String>,
    #[serde(default = "default_true")]
    pub active: bool,
}

fn default_recurring_mode() -> String {
    "timeline".into()
}
fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecurringOccurrenceDto {
    pub id: String,
    pub rule_id: String,
    pub occurrence_date: String,
    pub title: String,
    pub note: String,
    pub tag_id: String,
    pub priority: String,
    pub mode: String,
    pub start_min: Option<i64>,
    pub duration: i64,
    pub done: bool,
    pub skipped: bool,
}

#[derive(Serialize, Deserialize)]
struct RecurringOccurrenceRecord {
    occurrence: RecurringOccurrenceDto,
    override_start_min: Option<i64>,
    override_duration: Option<i64>,
}

impl RecurringOccurrenceRecord {
    fn resolve(mut self) -> RecurringOccurrenceDto {
        self.occurrence.start_min = self.override_start_min.or(self.occurrence.start_min);
        self.occurrence.duration = self.override_duration.unwrap_or(self.occurrence.duration);
        self.occurrence
    }
}

impl RecurringOccurrenceDto {
    fn from_rule(rule: &RecurringRuleDto, date: &str) -> Self {
        Self {
            id: format!("ro:{}:{date}", rule.id),
            rule_id: rule.id.clone(),
            occurrence_date: date.into(),
            title: rule.title.clone(),
            note: rule.note.clone(),
            tag_id: rule.tag_id.clone(),
            priority: rule.priority.clone(),
            mode: rule.mode.clone(),
            start_min: rule.start_min,
            duration: rule.duration,
            done: false,
            skipped: false,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringOccurrenceStateInput {
    pub rule_id: String,
    pub occurrence_date: String,
    #[serde(default)]
    pub done: Option<bool>,
    #[serde(default)]
    pub skipped: Option<bool>,
    #[serde(default)]
    pub override_start_min: Option<Option<i64>>,
    #[serde(default)]
    pub override_duration: Option<Option<i64>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RescheduleRecurringOccurrenceInput {
    pub rule_id: String,
    pub occurrence_date: String,
    pub start_min: i64,
    pub duration: i64,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RescheduleRecurringResultDto {
    pub scope: String,
    pub recurring_rules: Vec<RecurringRuleDto>,
    pub occurrence: RecurringOccurrenceDto,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshotDto {
    pub tags: Vec<TagDto>,
    pub tasks: Vec<TaskDto>,
    pub trash: Vec<TaskDto>,
    pub drafts: Vec<DraftDto>,
    pub recurring_rules: Vec<RecurringRuleDto>,
    pub archived_recurring_rules: Vec<RecurringRuleDto>,
    pub settings: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskBlockNotificationDto {
    pub block_id: String,
    pub task_id: String,
    pub task_title: String,
    pub task_notes: Option<String>,
    pub task_priority: Option<String>,
    pub task_tags: Vec<String>,
    pub starts_at: String,
    pub ends_at: String,
    pub event_at: String,
    pub is_end: bool,
    pub schedule_revision: Option<String>,
}

const BASE_SCHEMA_SQL: &str = r#"
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL,
        tag_id TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT '',
        done INTEGER NOT NULL DEFAULT 0,
        date TEXT NOT NULL,
        start_min INTEGER NOT NULL DEFAULT 1020,
        duration INTEGER NOT NULL DEFAULT 60,
        date_start TEXT NOT NULL,
        date_end TEXT NOT NULL,
        deleted_at TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_mode_date ON tasks(mode, date) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_tasks_deleted ON tasks(deleted_at) WHERE deleted_at IS NOT NULL;

    CREATE TABLE IF NOT EXISTS task_subtasks (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_subtasks_task ON task_subtasks(task_id, sort_order);

    CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL DEFAULT 'pool',
        tag_id TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'P2',
        duration INTEGER NOT NULL DEFAULT 60,
        start_min INTEGER NOT NULL DEFAULT 1020,
        date_start TEXT NOT NULL,
        date_end TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recurring_rules (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        tag_id TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT '',
        frequency TEXT NOT NULL,
        weekdays_json TEXT NOT NULL DEFAULT '[]',
        month_day INTEGER NULL,
        mode TEXT NOT NULL DEFAULT 'timeline',
        start_min INTEGER NULL,
        duration INTEGER NOT NULL DEFAULT 60,
        starts_on TEXT NOT NULL,
        ends_on TEXT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ui_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
"#;

const OCCURRENCE_SCHEMA_SQL: &str = r#"
    CREATE TABLE IF NOT EXISTS recurring_occurrences (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL REFERENCES recurring_rules(id) ON DELETE RESTRICT,
        occurrence_date TEXT NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE(rule_id, occurrence_date)
    );

    CREATE INDEX IF NOT EXISTS idx_recurring_occ_date ON recurring_occurrences(occurrence_date);
"#;

fn migrate_recurring_snapshots(tx: &rusqlite::Transaction<'_>) -> AppResult<()> {
    // Both layouts shipped as v2. Do not rewrite snapshots already stored by the newer layout.
    let has_archive: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('recurring_rules') WHERE name = 'archived')",
        [], |r| r.get(0),
    )?;
    if !has_archive {
        tx.execute_batch("ALTER TABLE recurring_rules ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;")?;
    }
    let has_snapshot: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('recurring_occurrences') WHERE name = 'record_json')",
        [], |r| r.get(0),
    )?;
    if !has_snapshot {
        tx.execute_batch(
            "ALTER TABLE recurring_occurrences RENAME TO recurring_occurrences_v2;
             DROP INDEX IF EXISTS idx_recurring_occ_date;",
        )?;
        tx.execute_batch(OCCURRENCE_SCHEMA_SQL)?;
        // v2 only stored the per-date flags and overrides; the rule supplies the remaining fields.
        // The LEFT JOIN and foreign key make orphaned history fail the migration rather than disappear.
        tx.execute_batch(r#"
            INSERT INTO recurring_occurrences (id, rule_id, occurrence_date, record_json)
            SELECT o.id, o.rule_id, o.occurrence_date, json_object(
                'occurrence', json_object(
                    'id', o.id, 'ruleId', o.rule_id, 'occurrenceDate', o.occurrence_date,
                    'title', r.title, 'note', r.note, 'tagId', r.tag_id, 'priority', r.priority,
                    'mode', r.mode, 'startMin', r.start_min, 'duration', r.duration,
                    'done', json(CASE WHEN o.done != 0 THEN 'true' ELSE 'false' END),
                    'skipped', json(CASE WHEN o.skipped != 0 THEN 'true' ELSE 'false' END)
                ),
                'override_start_min', o.override_start_min,
                'override_duration', o.override_duration
            )
            FROM recurring_occurrences_v2 o LEFT JOIN recurring_rules r ON r.id = o.rule_id;
            DROP TABLE recurring_occurrences_v2;
        "#)?;
    }
    Ok(())
}

fn backup_legacy_database_if_needed(path: &Path) -> AppResult<()> {
    if !path.exists() {
        return Ok(());
    }
    let needs_reset = {
        let conn = Connection::open(path)?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version >= BASE_SCHEMA_VERSION {
            false
        } else {
            let table_count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
                [],
                |r| r.get(0),
            )?;
            table_count > 0
        }
    };
    if !needs_reset {
        return Ok(());
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Domain("无法定位数据库父目录".into()))?;
    let mut backup = parent.join("dayweave.v1.bak.sqlite3");
    if backup.exists() {
        let stamp = shanghai_now().format("%Y%m%d%H%M%S");
        backup = parent.join(format!("dayweave.v1.bak.{stamp}.sqlite3"));
    }
    fs::rename(path, &backup).map_err(|e| AppError::Domain(format!("备份旧版数据库失败：{e}")))?;
    // Clean up stale WAL/SHM sidecars so fresh v2 starts cleanly
    for suffix in ["-wal", "-shm"] {
        let sidecar = Path::new(&format!("{}{}", path.to_string_lossy(), suffix)).to_path_buf();
        let _ = fs::remove_file(sidecar);
    }
    Ok(())
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> AppResult<Self> {
        let path = path.as_ref();
        backup_legacy_database_if_needed(path)?;
        let connection = Connection::open(path)?;
        connection.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        Self::init(connection)
    }

    #[cfg(test)]
    pub fn in_memory() -> AppResult<Self> {
        let connection = Connection::open_in_memory()?;
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        Self::init(connection)
    }

    fn init(mut connection: Connection) -> AppResult<Self> {
        let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let version: i64 = tx.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version > SCHEMA_VERSION {
            return Err(AppError::Schema("数据库由更新版本的 Dayweave 创建，请使用更新的程序".into()));
        }
        if version < BASE_SCHEMA_VERSION {
            tx.execute_batch(BASE_SCHEMA_SQL)?;
            tx.execute_batch(OCCURRENCE_SCHEMA_SQL)?;
            tx.execute_batch(holiday_calendar::MIGRATION)?;
            Self::seed_defaults(&tx)?;
        } else if version < SCHEMA_VERSION {
            migrate_recurring_snapshots(&tx)?;
        }
        tx.execute_batch(database_reminder::MIGRATION)?;
        if version < SCHEMA_VERSION {
            tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }
        let holiday_calendar = CalendarState::load(&tx)?;
        tx.commit()?;
        Ok(Self {
            connection,
            holiday_calendar,
        })
    }

    fn seed_defaults(connection: &Connection) -> AppResult<()> {
        let tag_count: i64 = connection.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))?;
        if tag_count == 0 {
            let now = now_rfc3339();
            let defaults = [
                ("work", "工作", "blue", 0),
                ("focus", "专注项目", "indigo", 1),
                ("study", "学习", "emerald", 2),
                ("life", "生活健康", "amber", 3),
                ("urgent", "重要跟进", "rose", 4),
            ];
            for (id, name, color, sort_order) in defaults {
                connection.execute(
                    "INSERT INTO tags (id, name, color, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![id, name, color, sort_order, now],
                )?;
            }
        }
        let default_settings = [
            ("ui.show_lunar", "true"),
            ("ui.snap_step", "15"),
            ("ui.default_duration", "60"),
            ("ui.enable_drag_create", "true"),
            ("ui.auto_draft", "true"),
            ("ui.reminder.task_lead", "5"),
            ("ui.desktop.close_to_tray", "true"),
        ];
        for (key, value) in default_settings {
            connection.execute(
                "INSERT OR IGNORE INTO ui_settings (key, value) VALUES (?1, ?2)",
                params![key, value],
            )?;
        }
        Ok(())
    }

    // ---- Holiday Calendar ----

    pub fn get_holiday_calendar(&self) -> HolidaySnapshot {
        self.holiday_calendar.snapshot.clone()
    }

    pub fn begin_holiday_update(
        &mut self,
        years: Vec<i32>,
        force: bool,
    ) -> AppResult<Option<UpdateJob>> {
        self.holiday_calendar
            .begin(&self.connection, years, force, Utc::now())
    }

    pub fn finish_holiday_update(&mut self, result: AppResult<Downloaded>) -> HolidaySnapshot {
        self.holiday_calendar
            .finish(&mut self.connection, result, Utc::now())
    }

    // ---- UI Settings ----

    pub fn get_ui_setting(&self, key: &str) -> AppResult<Option<String>> {
        self.connection
            .query_row("SELECT value FROM ui_settings WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .optional()
            .map_err(AppError::from)
    }

    pub fn set_ui_setting(&mut self, key: &str, value: &str) -> AppResult<()> {
        if key.trim().is_empty() {
            return Err(AppError::Schema("设置键不能为空".into()));
        }
        self.connection.execute(
            "INSERT INTO ui_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn list_ui_settings(&self) -> AppResult<HashMap<String, String>> {
        let mut stmt = self
            .connection
            .prepare("SELECT key, value FROM ui_settings")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<Result<HashMap<_, _>, _>>()?;
        Ok(rows)
    }

    // ---- Workspace Snapshot ----

    pub fn get_workspace_snapshot(&self) -> AppResult<WorkspaceSnapshotDto> {
        Ok(WorkspaceSnapshotDto {
            tags: self.list_tags()?,
            tasks: self.list_tasks(false)?,
            trash: self.list_tasks(true)?,
            drafts: self.list_drafts()?,
            recurring_rules: self.list_recurring_rules()?,
            archived_recurring_rules: self.list_archived_recurring_rules()?,
            settings: self.list_ui_settings()?,
        })
    }

    // ---- Tags ----

    pub fn list_tags(&self) -> AppResult<Vec<TagDto>> {
        let mut stmt = self
            .connection
            .prepare("SELECT id, name, color FROM tags ORDER BY sort_order ASC, created_at ASC")?;
        let rows = stmt
            .query_map([], |r| {
                Ok(TagDto {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    color: r.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn create_tag(&mut self, name: &str, color: &str) -> AppResult<TagDto> {
        let clean_name = validate_tag_name(name)?;
        let parsed_color = TagColor::parse(color)?;
        let exists: bool = self
            .connection
            .query_row(
                "SELECT 1 FROM tags WHERE LOWER(name) = LOWER(?1)",
                [&clean_name],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false);
        if exists {
            return Err(AppError::Domain(format!("标签「{clean_name}」已存在")));
        }
        let next_order: i64 = self.connection.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tags",
            [],
            |r| r.get(0),
        )?;
        let id = format!("tg-{}", Uuid::new_v4());
        self.connection.execute(
            "INSERT INTO tags (id, name, color, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, clean_name, parsed_color.as_str(), next_order, now_rfc3339()],
        )?;
        Ok(TagDto {
            id,
            name: clean_name,
            color: parsed_color.as_str().to_string(),
        })
    }

    pub fn delete_tag(&mut self, tag_id: &str) -> AppResult<()> {
        let count: i64 = self
            .connection
            .query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))?;
        if count <= 1 {
            return Err(AppError::Domain("至少保留 1 个任务标签".into()));
        }
        let tx = self.connection.transaction()?;
        let deleted = tx.execute("DELETE FROM tags WHERE id = ?1", [tag_id])?;
        if deleted == 0 {
            return Err(AppError::NotFound("找不到指定标签".into()));
        }
        tx.execute("UPDATE tasks SET tag_id = '' WHERE tag_id = ?1", [tag_id])?;
        tx.execute("UPDATE drafts SET tag_id = '' WHERE tag_id = ?1", [tag_id])?;
        tx.execute(
            "UPDATE recurring_rules SET tag_id = '' WHERE tag_id = ?1",
            [tag_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    // ---- Tasks & Subtasks ----

    fn load_subtasks_map(&self) -> AppResult<HashMap<String, Vec<SubtaskDto>>> {
        let mut stmt = self.connection.prepare(
            "SELECT id, task_id, text, done FROM task_subtasks ORDER BY sort_order ASC, rowid ASC",
        )?;
        let mut map: HashMap<String, Vec<SubtaskDto>> = HashMap::new();
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(1)?,
                SubtaskDto {
                    id: r.get(0)?,
                    text: r.get(2)?,
                    done: r.get::<_, i64>(3)? != 0,
                },
            ))
        })?;
        for row in rows {
            let (task_id, sub) = row?;
            map.entry(task_id).or_default().push(sub);
        }
        Ok(map)
    }

    fn load_task_subtasks(connection: &Connection, task_id: &str) -> AppResult<Vec<SubtaskDto>> {
        let mut stmt = connection.prepare(
            "SELECT id, text, done FROM task_subtasks WHERE task_id = ?1 ORDER BY sort_order ASC, rowid ASC",
        )?;
        let rows = stmt
            .query_map([task_id], |r| {
                Ok(SubtaskDto {
                    id: r.get(0)?,
                    text: r.get(1)?,
                    done: r.get::<_, i64>(2)? != 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn list_tasks(&self, deleted_only: bool) -> AppResult<Vec<TaskDto>> {
        let mut subtasks_map = self.load_subtasks_map()?;
        let sql = if deleted_only {
            "SELECT id, title, note, mode, tag_id, priority, done, date, start_min, duration, date_start, date_end, deleted_at, created_at, updated_at
             FROM tasks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
        } else {
            "SELECT id, title, note, mode, tag_id, priority, done, date, start_min, duration, date_start, date_end, deleted_at, created_at, updated_at
             FROM tasks WHERE deleted_at IS NULL ORDER BY created_at DESC"
        };
        let mut stmt = self.connection.prepare(sql)?;
        let rows = stmt
            .query_map([], |r| {
                let id: String = r.get(0)?;
                Ok(TaskDto {
                    subtasks: subtasks_map.remove(&id).unwrap_or_default(),
                    id,
                    title: r.get(1)?,
                    note: r.get(2)?,
                    mode: r.get(3)?,
                    tag_id: r.get(4)?,
                    priority: r.get(5)?,
                    done: r.get::<_, i64>(6)? != 0,
                    date: r.get(7)?,
                    start_min: r.get(8)?,
                    duration: r.get(9)?,
                    date_start: r.get(10)?,
                    date_end: r.get(11)?,
                    deleted_at: r.get(12)?,
                    created_at: r.get(13)?,
                    updated_at: r.get(14)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_task(&self, task_id: &str) -> AppResult<TaskDto> {
        Self::read_task(&self.connection, task_id)
    }

    fn read_task(connection: &Connection, task_id: &str) -> AppResult<TaskDto> {
        let subtasks = Self::load_task_subtasks(connection, task_id)?;
        connection
            .query_row(
                "SELECT id, title, note, mode, tag_id, priority, done, date, start_min, duration, date_start, date_end, deleted_at, created_at, updated_at
                 FROM tasks WHERE id = ?1",
                [task_id],
                |r| {
                    Ok(TaskDto {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        note: r.get(2)?,
                        mode: r.get(3)?,
                        tag_id: r.get(4)?,
                        priority: r.get(5)?,
                        done: r.get::<_, i64>(6)? != 0,
                        date: r.get(7)?,
                        start_min: r.get(8)?,
                        duration: r.get(9)?,
                        date_start: r.get(10)?,
                        date_end: r.get(11)?,
                        subtasks: subtasks.clone(),
                        deleted_at: r.get(12)?,
                        created_at: r.get(13)?,
                        updated_at: r.get(14)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound("找不到指定任务".into()))
    }

    fn normalize_task_input(input: TaskInput) -> AppResult<(String, String, ScheduleMode, String, Priority, bool, String, i64, i64, String, String, Vec<SubtaskInput>)> {
        let title = validate_title(&input.title)?;
        let mode = ScheduleMode::parse(&input.mode)?;
        let priority = Priority::parse(&input.priority)?;
        let _ = validate_date(&input.date, "任务日期")?;
        let (date_start, date_end) = if mode == ScheduleMode::Flex {
            let d_start = validate_date(&input.date_start, "开始日期")?;
            let d_end = validate_date(&input.date_end, "结束日期")?;
            if d_end < d_start {
                (input.date_start.clone(), input.date_start)
            } else {
                (input.date_start, input.date_end)
            }
        } else {
            (input.date.clone(), input.date.clone())
        };
        let start_min = clamp_start_min(input.start_min);
        let duration = clamp_duration(input.duration);
        Ok((
            title,
            input.note,
            mode,
            input.tag_id,
            priority,
            input.done,
            input.date,
            start_min,
            duration,
            date_start,
            date_end,
            input.subtasks,
        ))
    }

    pub fn create_task(&mut self, input: TaskInput, from_draft_id: Option<&str>) -> AppResult<TaskDto> {
        let (title, note, mode, tag_id, priority, done, date, start_min, duration, date_start, date_end, subtasks) =
            Self::normalize_task_input(input)?;
        let id = format!("t-{}", Uuid::new_v4());
        let now = now_rfc3339();
        let tx = self.connection.transaction()?;
        tx.execute(
            "INSERT INTO tasks (id, title, note, mode, tag_id, priority, done, date, start_min, duration, date_start, date_end, deleted_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL, ?13, ?14)",
            params![
                id,
                title,
                note,
                mode.as_str(),
                tag_id,
                priority.as_str(),
                i64::from(done),
                date,
                start_min,
                duration,
                date_start,
                date_end,
                now,
                now,
            ],
        )?;
        for (idx, sub) in subtasks.into_iter().enumerate() {
            let text = sub.text.trim();
            if text.is_empty() {
                continue;
            }
            let sid = sub
                .id
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| format!("st-{}", Uuid::new_v4()));
            tx.execute(
                "INSERT INTO task_subtasks (id, task_id, text, done, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![sid, id, text, i64::from(sub.done), idx as i64],
            )?;
        }
        if let Some(draft_id) = from_draft_id {
            if tx.execute("DELETE FROM drafts WHERE id = ?1", [draft_id])? == 0 {
                return Err(AppError::NotFound("找不到待转换的草稿".into()));
            }
        }
        let saved = Self::read_task(&tx, &id)?;
        tx.commit()?;
        Ok(saved)
    }

    pub fn update_task(&mut self, task_id: &str, input: TaskInput) -> AppResult<TaskDto> {
        let (title, note, mode, tag_id, priority, done, date, start_min, duration, date_start, date_end, subtasks) =
            Self::normalize_task_input(input)?;
        let now = now_rfc3339();
        let tx = self.connection.transaction()?;
        let changed = tx.execute(
            "UPDATE tasks
             SET title = ?2, note = ?3, mode = ?4, tag_id = ?5, priority = ?6, done = ?7,
                 date = ?8, start_min = ?9, duration = ?10, date_start = ?11, date_end = ?12, updated_at = ?13
             WHERE id = ?1 AND deleted_at IS NULL",
            params![
                task_id,
                title,
                note,
                mode.as_str(),
                tag_id,
                priority.as_str(),
                i64::from(done),
                date,
                start_min,
                duration,
                date_start,
                date_end,
                now,
            ],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("找不到可编辑的任务".into()));
        }
        tx.execute("DELETE FROM task_subtasks WHERE task_id = ?1", [task_id])?;
        for (idx, sub) in subtasks.into_iter().enumerate() {
            let text = sub.text.trim();
            if text.is_empty() {
                continue;
            }
            let sid = sub
                .id
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| format!("st-{}", Uuid::new_v4()));
            tx.execute(
                "INSERT INTO task_subtasks (id, task_id, text, done, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![sid, task_id, text, i64::from(sub.done), idx as i64],
            )?;
        }
        tx.commit()?;
        self.get_task(task_id)
    }

    pub fn soft_delete_task(&mut self, task_id: &str) -> AppResult<TaskDto> {
        let now = now_rfc3339();
        let changed = self.connection.execute(
            "UPDATE tasks SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
            params![task_id, now],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("找不到指定任务".into()));
        }
        self.get_task(task_id)
    }

    pub fn restore_task(&mut self, task_id: &str) -> AppResult<TaskDto> {
        let now = now_rfc3339();
        let changed = self.connection.execute(
            "UPDATE tasks SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NOT NULL",
            params![task_id, now],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("回收站中找不到该任务".into()));
        }
        self.get_task(task_id)
    }

    pub fn purge_task(&mut self, task_id: &str) -> AppResult<()> {
        let changed = self.connection.execute(
            "DELETE FROM tasks WHERE id = ?1 AND deleted_at IS NOT NULL",
            [task_id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("回收站中找不到该任务".into()));
        }
        Ok(())
    }

    pub fn empty_trash(&mut self) -> AppResult<usize> {
        let changed = self
            .connection
            .execute("DELETE FROM tasks WHERE deleted_at IS NOT NULL", [])?;
        Ok(changed)
    }

    pub fn purge_expired_trash(&mut self) -> AppResult<usize> {
        let cutoff = (shanghai_now() - Duration::days(TRASH_RETENTION_DAYS)).to_rfc3339();
        let changed = self.connection.execute(
            "DELETE FROM tasks WHERE deleted_at IS NOT NULL AND julianday(deleted_at) <= julianday(?1)",
            [cutoff],
        )?;
        Ok(changed)
    }

    // ---- Drafts ----

    pub fn list_drafts(&self) -> AppResult<Vec<DraftDto>> {
        let mut stmt = self.connection.prepare(
            "SELECT id, title, note, mode, tag_id, priority, duration, start_min, date_start, date_end, updated_at
             FROM drafts ORDER BY updated_at DESC",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(DraftDto {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    note: r.get(2)?,
                    mode: r.get(3)?,
                    tag_id: r.get(4)?,
                    priority: r.get(5)?,
                    duration: r.get(6)?,
                    start_min: r.get(7)?,
                    date_start: r.get(8)?,
                    date_end: r.get(9)?,
                    updated_at: r.get(10)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn upsert_draft(&mut self, input: DraftInput) -> AppResult<DraftDto> {
        let mode = ScheduleMode::parse(&input.mode)?;
        let priority = Priority::parse(&input.priority)?;
        let today = shanghai_today_str();
        let date_start = if input.date_start.trim().is_empty() {
            today.clone()
        } else {
            validate_date(&input.date_start, "草稿开始日期")?;
            input.date_start
        };
        let date_end = if mode != ScheduleMode::Flex || input.date_end.trim().is_empty() {
            date_start.clone()
        } else {
            let d_start = validate_date(&date_start, "草稿开始日期")?;
            let d_end = validate_date(&input.date_end, "草稿结束日期")?;
            if d_end < d_start {
                date_start.clone()
            } else {
                input.date_end
            }
        };
        let id = input
            .id
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| format!("d-{}", Uuid::new_v4()));
        let title = if input.title.trim().is_empty() {
            "（未命名草稿）".to_string()
        } else {
            input.title.trim().to_string()
        };
        let duration = clamp_duration(input.duration);
        let start_min = clamp_start_min(input.start_min);
        let updated_at = now_rfc3339();
        self.connection.execute(
            "INSERT INTO drafts (id, title, note, mode, tag_id, priority, duration, start_min, date_start, date_end, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title, note = excluded.note, mode = excluded.mode, tag_id = excluded.tag_id,
               priority = excluded.priority, duration = excluded.duration, start_min = excluded.start_min,
               date_start = excluded.date_start, date_end = excluded.date_end, updated_at = excluded.updated_at",
            params![
                id,
                title,
                input.note,
                mode.as_str(),
                input.tag_id,
                priority.as_str(),
                duration,
                start_min,
                date_start,
                date_end,
                updated_at,
            ],
        )?;
        Ok(DraftDto {
            id,
            title,
            note: input.note,
            mode: mode.as_str().to_string(),
            tag_id: input.tag_id,
            priority: priority.as_str().to_string(),
            duration,
            start_min,
            date_start,
            date_end,
            updated_at,
        })
    }

    pub fn delete_draft(&mut self, draft_id: &str) -> AppResult<()> {
        self.connection
            .execute("DELETE FROM drafts WHERE id = ?1", [draft_id])?;
        Ok(())
    }

    // ---- Recurring Rules & Occurrences ----

    fn list_recurring_rules_by_archived(&self, archived: bool) -> AppResult<Vec<RecurringRuleDto>> {
        let sql = if archived {
            "SELECT id, title, note, tag_id, priority, frequency, weekdays_json, month_day, mode, start_min, duration, starts_on, ends_on, active, created_at, updated_at
             FROM recurring_rules WHERE archived = 1 ORDER BY updated_at DESC"
        } else {
            "SELECT id, title, note, tag_id, priority, frequency, weekdays_json, month_day, mode, start_min, duration, starts_on, ends_on, active, created_at, updated_at
             FROM recurring_rules WHERE archived = 0 ORDER BY created_at DESC"
        };
        let mut stmt = self.connection.prepare(sql)?;
        let rows = stmt
            .query_map([], |r| {
                let weekdays_json: String = r.get(6)?;
                let weekdays: Vec<u32> = serde_json::from_str(&weekdays_json).unwrap_or_default();
                Ok(RecurringRuleDto {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    note: r.get(2)?,
                    tag_id: r.get(3)?,
                    priority: r.get(4)?,
                    frequency: r.get(5)?,
                    weekdays,
                    month_day: r.get::<_, Option<i64>>(7)?.map(|v| v as u32),
                    mode: r.get(8)?,
                    start_min: r.get(9)?,
                    duration: r.get(10)?,
                    starts_on: r.get(11)?,
                    ends_on: r.get(12)?,
                    active: r.get::<_, i64>(13)? != 0,
                    created_at: r.get(14)?,
                    updated_at: r.get(15)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn list_recurring_rules(&self) -> AppResult<Vec<RecurringRuleDto>> {
        self.list_recurring_rules_by_archived(false)
    }

    pub fn list_archived_recurring_rules(&self) -> AppResult<Vec<RecurringRuleDto>> {
        self.list_recurring_rules_by_archived(true)
    }

    fn normalize_recurring_input(input: RecurringRuleInput) -> AppResult<(String, String, String, Priority, RecurrenceFrequency, Vec<u32>, Option<u32>, ScheduleMode, Option<i64>, i64, String, Option<String>, bool)> {
        let title = validate_title(&input.title)?;
        let priority = Priority::parse(&input.priority)?;
        let frequency = RecurrenceFrequency::parse(&input.frequency)?;
        let mode = match ScheduleMode::parse(&input.mode)? {
            ScheduleMode::Timeline => ScheduleMode::Timeline,
            _ => ScheduleMode::Flex,
        };
        let start_d = validate_date(&input.starts_on, "重复开始日期")?;
        let ends_on = match input.ends_on.filter(|s| !s.trim().is_empty()) {
            Some(end_s) => {
                let end_d = validate_date(&end_s, "重复结束日期")?;
                if end_d < start_d {
                    return Err(AppError::Domain("结束日期不能早于开始日期".into()));
                }
                Some(end_s)
            }
            None => None,
        };
        let mut weekdays: Vec<u32> = input
            .weekdays
            .into_iter()
            .filter(|w| (1..=7).contains(w))
            .collect();
        weekdays.sort_unstable();
        weekdays.dedup();
        if frequency == RecurrenceFrequency::Weekly && weekdays.is_empty() {
            weekdays.push(start_d.weekday().number_from_monday());
        }
        let month_day = if frequency == RecurrenceFrequency::Monthly {
            Some(input.month_day.unwrap_or(start_d.day()).clamp(1, 31))
        } else {
            None
        };
        let start_min = if mode == ScheduleMode::Timeline {
            Some(clamp_start_min(input.start_min.unwrap_or(9 * 60 + 30)))
        } else {
            None
        };
        let duration = clamp_duration(input.duration);
        Ok((
            title,
            input.note,
            input.tag_id,
            priority,
            frequency,
            weekdays,
            month_day,
            mode,
            start_min,
            duration,
            input.starts_on,
            ends_on,
            input.active,
        ))
    }

    pub fn create_recurring_rule(&mut self, input: RecurringRuleInput) -> AppResult<RecurringRuleDto> {
        let (title, note, tag_id, priority, frequency, weekdays, month_day, mode, start_min, duration, starts_on, ends_on, active) =
            Self::normalize_recurring_input(input)?;
        let id = format!("r-{}", Uuid::new_v4());
        let now = now_rfc3339();
        let weekdays_json = serde_json::to_string(&weekdays)?;
        self.connection.execute(
            "INSERT INTO recurring_rules (id, title, note, tag_id, priority, frequency, weekdays_json, month_day, mode, start_min, duration, starts_on, ends_on, active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                id,
                title,
                note,
                tag_id,
                priority.as_str(),
                frequency.as_str(),
                weekdays_json,
                month_day.map(i64::from),
                mode.as_str(),
                start_min,
                duration,
                starts_on,
                ends_on,
                i64::from(active),
                now,
                now,
            ],
        )?;
        Ok(RecurringRuleDto {
            id,
            title,
            note,
            tag_id,
            priority: priority.as_str().to_string(),
            frequency: frequency.as_str().to_string(),
            weekdays,
            month_day,
            mode: mode.as_str().to_string(),
            start_min,
            duration,
            starts_on,
            ends_on,
            active,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn update_recurring_rule(
        &mut self,
        rule_id: &str,
        input: RecurringRuleInput,
    ) -> AppResult<RecurringRuleDto> {
        let (title, note, tag_id, priority, frequency, weekdays, month_day, mode, start_min, duration, starts_on, ends_on, active) =
            Self::normalize_recurring_input(input)?;
        let now = now_rfc3339();
        let weekdays_json = serde_json::to_string(&weekdays)?;
        let changed = self.connection.execute(
            "UPDATE recurring_rules
             SET title = ?2, note = ?3, tag_id = ?4, priority = ?5, frequency = ?6,
                 weekdays_json = ?7, month_day = ?8, mode = ?9, start_min = ?10, duration = ?11,
                 starts_on = ?12, ends_on = ?13, active = ?14, updated_at = ?15
             WHERE id = ?1 AND archived = 0",
            params![
                rule_id,
                title,
                note,
                tag_id,
                priority.as_str(),
                frequency.as_str(),
                weekdays_json,
                month_day.map(i64::from),
                mode.as_str(),
                start_min,
                duration,
                starts_on,
                ends_on,
                i64::from(active),
                now,
            ],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("找不到指定重复规则".into()));
        }
        self.list_recurring_rules()?
            .into_iter()
            .find(|r| r.id == rule_id)
            .ok_or_else(|| AppError::NotFound("找不到指定重复规则".into()))
    }

    fn delete_uncompleted_occurrences(&self, rule_id: &str) -> AppResult<()> {
        let mut stmt = self.connection.prepare(
            "SELECT id, record_json FROM recurring_occurrences WHERE rule_id = ?1",
        )?;
        let rows = stmt
            .query_map([rule_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);
        for (id, json) in rows {
            if let Ok(record) = serde_json::from_str::<RecurringOccurrenceRecord>(&json) {
                if !record.occurrence.done && !record.occurrence.skipped {
                    self.connection.execute("DELETE FROM recurring_occurrences WHERE id = ?1", [id])?;
                }
            }
        }
        Ok(())
    }

    pub fn toggle_recurring_rule(&mut self, rule_id: &str, active: bool) -> AppResult<RecurringRuleDto> {
        let changed = self.connection.execute(
            "UPDATE recurring_rules SET active = ?2, updated_at = ?3 WHERE id = ?1 AND archived = 0",
            params![rule_id, i64::from(active), now_rfc3339()],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("找不到指定重复规则".into()));
        }
        if !active {
            self.delete_uncompleted_occurrences(rule_id)?;
        }
        self.list_recurring_rules()?
            .into_iter()
            .find(|r| r.id == rule_id)
            .ok_or_else(|| AppError::NotFound("找不到指定重复规则".into()))
    }

    pub fn archive_recurring_rule(&mut self, rule_id: &str) -> AppResult<RecurringRuleDto> {
        let changed = self.connection.execute(
            "UPDATE recurring_rules SET archived = 1, active = 0, updated_at = ?2 WHERE id = ?1 AND archived = 0",
            params![rule_id, now_rfc3339()],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("找不到指定重复规则".into()));
        }
        self.delete_uncompleted_occurrences(rule_id)?;
        self.list_archived_recurring_rules()?
            .into_iter()
            .find(|r| r.id == rule_id)
            .ok_or_else(|| AppError::NotFound("找不到指定重复规则".into()))
    }

    pub fn restore_recurring_rule(&mut self, rule_id: &str) -> AppResult<RecurringRuleDto> {
        let changed = self.connection.execute(
            "UPDATE recurring_rules SET archived = 0, active = 1, updated_at = ?2 WHERE id = ?1 AND archived = 1",
            params![rule_id, now_rfc3339()],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("找不到指定已归档规则".into()));
        }
        self.list_recurring_rules()?
            .into_iter()
            .find(|r| r.id == rule_id)
            .ok_or_else(|| AppError::NotFound("找不到指定重复规则".into()))
    }

    fn rule_occurs_on(&self, rule: &RecurringRuleDto, date: NaiveDate) -> bool {
        if !rule.active {
            return false;
        }
        let Ok(starts) = NaiveDate::parse_from_str(&rule.starts_on, "%Y-%m-%d") else {
            return false;
        };
        if date < starts {
            return false;
        }
        if let Some(ref end_s) = rule.ends_on {
            if let Ok(ends) = NaiveDate::parse_from_str(end_s, "%Y-%m-%d") {
                if date > ends {
                    return false;
                }
            }
        }
        match rule.frequency.as_str() {
            "daily" => true,
            "weekdays" => match self.holiday_calendar.snapshot.workday_on(date) {
                Some(is_workday) => is_workday,
                None => date.weekday().number_from_monday() <= 5,
            },
            "weekly" => rule.weekdays.contains(&date.weekday().number_from_monday()),
            "monthly" => {
                let target_day = rule.month_day.unwrap_or(starts.day());
                let last_day = last_day_of_month(date.year(), date.month());
                date.day() == target_day.min(last_day)
            }
            _ => false,
        }
    }

    pub fn list_recurring_occurrences_range(
        &self,
        from_date: &str,
        to_date: &str,
    ) -> AppResult<Vec<RecurringOccurrenceDto>> {
        let start = validate_date(from_date, "起始日期")?;
        let end = validate_date(to_date, "结束日期")?;
        if end < start || (end - start).num_days() > 93 {
            return Err(AppError::Schema("查询日期跨度无效（最多 93 天）".into()));
        }
        let rules = self.list_recurring_rules()?;
        let active_rule_ids: std::collections::HashSet<&str> =
            rules.iter().filter(|r| r.active).map(|r| r.id.as_str()).collect();
        let mut stmt = self.connection.prepare(
            "SELECT record_json FROM recurring_occurrences
             WHERE occurrence_date BETWEEN ?1 AND ?2 ORDER BY occurrence_date, id",
        )?;
        let rows = stmt.query_map(params![from_date, to_date], |r| r.get::<_, String>(0))?;
        let mut recorded_ids = std::collections::HashSet::new();
        let mut results = Vec::new();
        for row in rows {
            let record: RecurringOccurrenceRecord = serde_json::from_str(&row?)?;
            let occurrence = record.resolve();
            recorded_ids.insert(format!("ro:{}:{}", occurrence.rule_id, occurrence.occurrence_date));
            if !occurrence.skipped && (occurrence.done || active_rule_ids.contains(occurrence.rule_id.as_str())) {
                results.push(occurrence);
            }
        }
        let mut cur = start;
        while cur <= end {
            let cur_str = cur.format("%Y-%m-%d").to_string();
            for rule in &rules {
                if self.rule_occurs_on(rule, cur) {
                    let occurrence = RecurringOccurrenceDto::from_rule(rule, &cur_str);
                    if !recorded_ids.contains(&occurrence.id) {
                        results.push(occurrence);
                    }
                }
            }
            cur += Duration::days(1);
        }
        results.sort_by(|a, b| a.occurrence_date.cmp(&b.occurrence_date));
        Ok(results)
    }

    pub fn set_recurring_occurrence_state(
        &mut self,
        input: RecurringOccurrenceStateInput,
    ) -> AppResult<RecurringOccurrenceDto> {
        let date = validate_date(&input.occurrence_date, "发生日期")?;
        let existing: Option<String> = self.connection.query_row(
            "SELECT record_json FROM recurring_occurrences WHERE rule_id = ?1 AND occurrence_date = ?2",
            params![input.rule_id, input.occurrence_date],
            |r| r.get(0),
        ).optional()?;

        // Only a newly recorded occurrence uses the current rule. Saved dates own their snapshot.
        let mut record = if let Some(json) = existing {
            serde_json::from_str::<RecurringOccurrenceRecord>(&json)?
        } else {
            let rule = self.list_recurring_rules()?.into_iter()
                .find(|r| r.id == input.rule_id && self.rule_occurs_on(r, date))
                .ok_or_else(|| AppError::NotFound("指定日期没有可记录的重复事项".into()))?;
            RecurringOccurrenceRecord {
                occurrence: RecurringOccurrenceDto::from_rule(&rule, &input.occurrence_date),
                override_start_min: None,
                override_duration: None,
            }
        };
        if let Some(done) = input.done {
            record.occurrence.done = done;
        }
        if let Some(skipped) = input.skipped {
            record.occurrence.skipped = skipped;
        }
        if let Some(start) = input.override_start_min {
            record.override_start_min = start.map(clamp_start_min);
        }
        if let Some(duration) = input.override_duration {
            record.override_duration = duration.map(clamp_duration);
        }

        let has_overrides = record.override_start_min.is_some() || record.override_duration.is_some();
        let rule_is_active = self
            .list_recurring_rules()?
            .into_iter()
            .any(|r| r.id == input.rule_id && r.active);
        if !record.occurrence.done && !record.occurrence.skipped && (!has_overrides || !rule_is_active) {
            self.connection.execute(
                "DELETE FROM recurring_occurrences WHERE rule_id = ?1 AND occurrence_date = ?2",
                params![input.rule_id, input.occurrence_date],
            )?;
            return Ok(record.resolve());
        }

        self.connection.execute(
            "INSERT INTO recurring_occurrences (id, rule_id, occurrence_date, record_json)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(rule_id, occurrence_date) DO UPDATE SET record_json = excluded.record_json",
            params![record.occurrence.id, input.rule_id, input.occurrence_date, serde_json::to_string(&record)?],
        )?;
        Ok(record.resolve())
    }

    pub fn reschedule_recurring_occurrence(
        &mut self,
        input: RescheduleRecurringOccurrenceInput,
    ) -> AppResult<RescheduleRecurringResultDto> {
        let target_date = validate_date(&input.occurrence_date, "发生日期")?;
        let next_start_min = clamp_start_min(input.start_min);
        let next_duration = clamp_duration(input.duration);

        match input.scope.as_str() {
            "single" => {
                let occurrence = self.set_recurring_occurrence_state(RecurringOccurrenceStateInput {
                    rule_id: input.rule_id,
                    occurrence_date: input.occurrence_date,
                    done: None,
                    skipped: None,
                    override_start_min: Some(Some(next_start_min)),
                    override_duration: Some(Some(next_duration)),
                })?;
                let recurring_rules = self.list_recurring_rules()?;
                Ok(RescheduleRecurringResultDto {
                    scope: "single".into(),
                    recurring_rules,
                    occurrence,
                })
            }
            "this_and_future" => {
                let rule = self
                    .list_recurring_rules()?
                    .into_iter()
                    .find(|r| r.id == input.rule_id)
                    .ok_or_else(|| AppError::NotFound("原重复规则已归档或不存在，仅支持调整本次安排".into()))?;
                let rule_starts = validate_date(&rule.starts_on, "重复开始日期")?;
                let now = now_rfc3339();
                let time_changed = rule.mode != "timeline"
                    || rule.start_min != Some(next_start_min)
                    || rule.duration != next_duration;

                // Collect past dates (< target_date) to snapshot with the old schedule before updating the single rule
                let mut past_dates_to_snapshot: Vec<String> = Vec::new();
                if time_changed && target_date > rule_starts {
                    let window_start = rule_starts.max(target_date - Duration::days(366));
                    let mut cur = window_start;
                    while cur < target_date {
                        if self.rule_occurs_on(&rule, cur) {
                            past_dates_to_snapshot.push(cur.format("%Y-%m-%d").to_string());
                        }
                        cur += Duration::days(1);
                    }
                }

                let tx = self.connection.transaction()?;

                // 1. Freeze unrecorded past dates at the old time so historical days never drift
                if !past_dates_to_snapshot.is_empty() {
                    let existing_past: std::collections::HashSet<String> = {
                        let mut stmt = tx.prepare(
                            "SELECT occurrence_date FROM recurring_occurrences
                             WHERE rule_id = ?1 AND occurrence_date < ?2",
                        )?;
                        let mapped = stmt.query_map(params![rule.id, input.occurrence_date], |r| r.get(0))?;
                        mapped.collect::<Result<std::collections::HashSet<_>, _>>()?
                    };
                    for past_date in past_dates_to_snapshot {
                        if existing_past.contains(&past_date) {
                            continue;
                        }
                        let occ = RecurringOccurrenceDto::from_rule(&rule, &past_date);
                        let record = RecurringOccurrenceRecord {
                            override_start_min: rule.start_min,
                            override_duration: Some(rule.duration),
                            occurrence: occ,
                        };
                        tx.execute(
                            "INSERT INTO recurring_occurrences (id, rule_id, occurrence_date, record_json)
                             VALUES (?1, ?2, ?3, ?4)",
                            params![record.occurrence.id, rule.id, past_date, serde_json::to_string(&record)?],
                        )?;
                    }
                }

                // 2. Update the SINGLE existing rule in-place (never duplicate into 2 rules!)
                tx.execute(
                    "UPDATE recurring_rules
                     SET mode = 'timeline', start_min = ?2, duration = ?3, updated_at = ?4
                     WHERE id = ?1 AND archived = 0",
                    params![rule.id, next_start_min, next_duration, now],
                )?;

                // 3. Reconcile existing records on >= target_date
                let future_rows: Vec<(String, String, String)> = {
                    let mut stmt = tx.prepare(
                        "SELECT id, occurrence_date, record_json
                         FROM recurring_occurrences
                         WHERE rule_id = ?1 AND occurrence_date >= ?2",
                    )?;
                    let mapped = stmt.query_map(params![rule.id, input.occurrence_date], |r| {
                        Ok((r.get(0)?, r.get(1)?, r.get(2)?))
                    })?;
                    mapped.collect::<Result<Vec<_>, _>>()?
                };

                for (row_id, occ_date, json) in future_rows {
                    let Ok(mut record) = serde_json::from_str::<RecurringOccurrenceRecord>(&json) else {
                        continue;
                    };
                    if !record.occurrence.done && !record.occurrence.skipped {
                        tx.execute("DELETE FROM recurring_occurrences WHERE id = ?1", [row_id])?;
                    } else if record.occurrence.done {
                        record.override_start_min = None;
                        record.override_duration = None;
                        if occ_date == input.occurrence_date {
                            record.occurrence.mode = "timeline".into();
                            record.occurrence.start_min = Some(next_start_min);
                            record.occurrence.duration = next_duration;
                        }
                        tx.execute(
                            "UPDATE recurring_occurrences SET record_json = ?2 WHERE id = ?1",
                            params![row_id, serde_json::to_string(&record)?],
                        )?;
                    }
                }

                tx.commit()?;

                let mut updated_rule = rule;
                updated_rule.mode = "timeline".into();
                updated_rule.start_min = Some(next_start_min);
                updated_rule.duration = next_duration;
                updated_rule.updated_at = now;

                let saved_occ: Option<String> = self
                    .connection
                    .query_row(
                        "SELECT record_json FROM recurring_occurrences WHERE rule_id = ?1 AND occurrence_date = ?2",
                        params![updated_rule.id, input.occurrence_date],
                        |r| r.get(0),
                    )
                    .optional()?;
                let occurrence = if let Some(json) = saved_occ {
                    serde_json::from_str::<RecurringOccurrenceRecord>(&json)?.resolve()
                } else {
                    RecurringOccurrenceDto::from_rule(&updated_rule, &input.occurrence_date)
                };
                let recurring_rules = self.list_recurring_rules()?;
                Ok(RescheduleRecurringResultDto {
                    scope: "this_and_future".into(),
                    recurring_rules,
                    occurrence,
                })
            }
            _ => Err(AppError::Schema("调整范围仅支持 single 或 this_and_future".into())),
        }
    }
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    let (next_y, next_m) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    NaiveDate::from_ymd_opt(next_y, next_m, 1)
        .and_then(|d| d.pred_opt())
        .map(|d| d.day())
        .unwrap_or(28)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_task_input(title: &str, mode: &str) -> TaskInput {
        TaskInput {
            title: title.into(),
            note: "备注内容".into(),
            mode: mode.into(),
            tag_id: "work".into(),
            priority: "P1".into(),
            done: false,
            date: "2026-11-26".into(),
            start_min: 16 * 60,
            duration: 60,
            date_start: "2026-11-26".into(),
            date_end: "2026-11-26".into(),
            subtasks: vec![
                SubtaskInput {
                    id: None,
                    text: "步骤一".into(),
                    done: true,
                },
                SubtaskInput {
                    id: None,
                    text: "步骤二".into(),
                    done: false,
                },
            ],
        }
    }

    #[test]
    fn fresh_database_seeds_default_tags_and_settings() {
        let db = Database::in_memory().unwrap();
        let snap = db.get_workspace_snapshot().unwrap();
        assert_eq!(snap.tags.len(), 5);
        assert_eq!(snap.tags[0].name, "工作");
        assert_eq!(snap.tags[0].color, "blue");
        assert_eq!(snap.settings.get("ui.snap_step").map(String::as_str), Some("15"));
        assert_eq!(snap.settings.get("ui.show_lunar").map(String::as_str), Some("true"));
    }

    #[test]
    fn legacy_v1_database_is_backed_up_before_creating_current_schema() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("dayweave.sqlite3");
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch("CREATE TABLE legacy_tasks(id TEXT); INSERT INTO legacy_tasks VALUES ('old');")
                .unwrap();
        }
        let db = Database::open(&db_path).unwrap();
        assert!(dir.path().join("dayweave.v1.bak.sqlite3").exists());
        assert_eq!(db.list_tags().unwrap().len(), 5);
    }

    fn create_presnapshot_v2(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(BASE_SCHEMA_SQL).unwrap();
        conn.execute_batch(holiday_calendar::MIGRATION).unwrap();
        Database::seed_defaults(&conn).unwrap();
        conn.execute_batch(r#"
            ALTER TABLE recurring_rules DROP COLUMN archived;
            CREATE TABLE recurring_occurrences (
                id TEXT PRIMARY KEY,
                rule_id TEXT NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
                occurrence_date TEXT NOT NULL,
                done INTEGER NOT NULL DEFAULT 0,
                skipped INTEGER NOT NULL DEFAULT 0,
                override_start_min INTEGER NULL,
                override_duration INTEGER NULL,
                UNIQUE(rule_id, occurrence_date)
            );
            CREATE INDEX idx_recurring_occ_date ON recurring_occurrences(occurrence_date);
            INSERT INTO recurring_rules (id, title, note, frequency, start_min, starts_on, created_at, updated_at)
                VALUES ('r1', '站会', '规则备注', 'daily', 540, '2026-11-23', 'old', 'old');
            INSERT INTO recurring_occurrences VALUES
                ('old-completed', 'r1', '2026-11-23', 1, 0, 607, 35),
                ('old-skipped', 'r1', '2026-11-24', 0, 1, NULL, NULL);
            INSERT INTO tasks (id, title, mode, date, date_start, date_end, created_at, updated_at)
                VALUES ('t1', '待保留任务', 'pool', '2026-11-23', '2026-11-23', '2026-11-23', 'old', 'old');
            INSERT INTO drafts (id, title, date_start, date_end, updated_at)
                VALUES ('d1', '待保留草稿', '2026-11-23', '2026-11-23', 'old');
            UPDATE ui_settings SET value = '30' WHERE key = 'ui.snap_step';
            PRAGMA user_version = 2;
        "#).unwrap();
    }

    #[test]
    fn presnapshot_v2_upgrades_without_reset_or_duplicate_occurrences() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("v2.sqlite3");
        create_presnapshot_v2(&path);
        let original = Connection::open(&path).unwrap();
        assert!(original.prepare("SELECT id FROM recurring_rules WHERE archived = 0").is_err());
        drop(original);

        let mut db = Database::open(&path).unwrap();
        let snapshot = db.get_workspace_snapshot().unwrap();
        assert_eq!(snapshot.tasks[0].id, "t1");
        assert_eq!(snapshot.drafts[0].id, "d1");
        assert_eq!(snapshot.recurring_rules[0].id, "r1");
        assert_eq!(snapshot.settings["ui.snap_step"], "30");
        assert!(!dir.path().join("dayweave.v1.bak.sqlite3").exists());

        let range = |db: &Database| db.list_recurring_occurrences_range("2026-11-23", "2026-11-24").unwrap();
        let recorded = range(&db);
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0].id, "old-completed");
        assert!(recorded[0].done);
        assert_eq!(recorded[0].start_min, Some(607));
        assert_eq!(recorded[0].duration, 35);
        assert_eq!(recorded[0].note, "规则备注");
        db.archive_recurring_rule("r1").unwrap();
        drop(db);

        let db = Database::open(&path).unwrap();
        assert!(db.get_workspace_snapshot().unwrap().recurring_rules.is_empty());
        assert_eq!(range(&db), recorded);
        let version: i64 = db.connection.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        let count: i64 = db.connection.query_row("SELECT COUNT(*) FROM recurring_occurrences", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn presnapshot_v2_migration_failure_leaves_original_schema_and_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("v2.sqlite3");
        create_presnapshot_v2(&path);
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF; UPDATE recurring_occurrences SET rule_id = 'missing' WHERE id = 'old-completed';").unwrap();
        drop(conn);

        assert!(Database::open(&path).is_err());
        let conn = Connection::open(&path).unwrap();
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, 2);
        assert!(conn.prepare("SELECT archived FROM recurring_rules").is_err());
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM recurring_occurrences WHERE done = 1 OR skipped = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 2);
        assert!(!dir.path().join("dayweave.v1.bak.sqlite3").exists());
    }

    #[test]
    fn task_subtasks_soft_delete_restore_and_purge_flow() {
        let mut db = Database::in_memory().unwrap();
        let created = db.create_task(sample_task_input("编写重构代码", "timeline"), None).unwrap();
        assert_eq!(created.subtasks.len(), 2);
        assert!(created.subtasks[0].done);

        let mut upd = sample_task_input("编写重构代码（已更新）", "pool");
        upd.done = true;
        upd.subtasks.pop();
        let updated = db.update_task(&created.id, upd).unwrap();
        assert_eq!(updated.mode, "pool");
        assert!(updated.done);
        assert_eq!(updated.subtasks.len(), 1);

        let trashed = db.soft_delete_task(&created.id).unwrap();
        assert!(trashed.deleted_at.is_some());
        assert!(db.list_tasks(false).unwrap().is_empty());
        assert_eq!(db.list_tasks(true).unwrap().len(), 1);

        let restored = db.restore_task(&created.id).unwrap();
        assert!(restored.deleted_at.is_none());
        assert_eq!(db.list_tasks(false).unwrap().len(), 1);

        db.soft_delete_task(&created.id).unwrap();
        db.purge_task(&created.id).unwrap();
        assert!(db.list_tasks(true).unwrap().is_empty());
    }

    #[test]
    fn non_flex_tasks_and_drafts_collapse_multi_day_spans() {
        let mut db = Database::in_memory().unwrap();

        let mut pool_inp = sample_task_input("池子任务不保留多日", "pool");
        pool_inp.date = "2026-11-26".into();
        pool_inp.date_start = "2026-12-01".into();
        pool_inp.date_end = "2026-12-03".into();
        let pool_task = db.create_task(pool_inp, None).unwrap();
        assert_eq!(pool_task.date_start, "2026-11-26");
        assert_eq!(pool_task.date_end, "2026-11-26");

        let mut flex_inp = sample_task_input("多日不限时任务", "flex");
        flex_inp.date_start = "2026-12-01".into();
        flex_inp.date_end = "2026-12-03".into();
        let flex_task = db.create_task(flex_inp, None).unwrap();
        assert_eq!(flex_task.date_start, "2026-12-01");
        assert_eq!(flex_task.date_end, "2026-12-03");

        let mut to_timeline = sample_task_input("切换为时间轴单日", "timeline");
        to_timeline.date = "2026-11-27".into();
        to_timeline.date_start = "2026-12-01".into();
        to_timeline.date_end = "2026-12-03".into();
        let moved = db.update_task(&flex_task.id, to_timeline).unwrap();
        assert_eq!(moved.date_start, "2026-11-27");
        assert_eq!(moved.date_end, "2026-11-27");

        let pool_draft = db
            .upsert_draft(DraftInput {
                id: None,
                title: "池子草稿".into(),
                note: "".into(),
                mode: "pool".into(),
                tag_id: "work".into(),
                priority: "".into(),
                duration: 30,
                start_min: 600,
                date_start: "2026-12-01".into(),
                date_end: "2026-12-03".into(),
            })
            .unwrap();
        assert_eq!(pool_draft.date_start, "2026-12-01");
        assert_eq!(pool_draft.date_end, "2026-12-01");

        let flex_draft = db
            .upsert_draft(DraftInput {
                id: None,
                title: "多日草稿".into(),
                note: "".into(),
                mode: "flex".into(),
                tag_id: "work".into(),
                priority: "".into(),
                duration: 30,
                start_min: 600,
                date_start: "2026-12-01".into(),
                date_end: "2026-12-03".into(),
            })
            .unwrap();
        assert_eq!(flex_draft.date_start, "2026-12-01");
        assert_eq!(flex_draft.date_end, "2026-12-03");
    }

    #[test]
    fn tag_crud_and_cascade_clear() {
        let mut db = Database::in_memory().unwrap();
        let tg = db.create_tag("#副业", "emerald").unwrap();
        assert_eq!(tg.name, "副业");
        let mut inp = sample_task_input("副业任务", "pool");
        inp.tag_id = tg.id.clone();
        let task = db.create_task(inp, None).unwrap();
        assert_eq!(task.tag_id, tg.id);
        let draft = db.upsert_draft(DraftInput {
            id: None,
            title: "副业草稿".into(),
            note: "草稿内容".into(),
            mode: "pool".into(),
            tag_id: tg.id.clone(),
            priority: "".into(),
            duration: 30,
            start_min: 600,
            date_start: "2026-10-01".into(),
            date_end: "2026-10-01".into(),
        }).unwrap();
        assert_eq!(draft.tag_id, tg.id);

        db.delete_tag(&tg.id).unwrap();
        let reloaded = db.get_task(&task.id).unwrap();
        assert_eq!(reloaded.tag_id, "");
        let drafts = db.list_drafts().unwrap();
        assert_eq!((&drafts[0].id, drafts[0].tag_id.as_str(), drafts[0].note.as_str()), (&draft.id, "", "草稿内容"));

        // Deleting down to last tag succeeds; deleting the last remaining tag fails
        let remaining = db.list_tags().unwrap();
        for t in remaining.iter().skip(1) {
            db.delete_tag(&t.id).unwrap();
        }
        assert!(db.delete_tag(&remaining[0].id).is_err());
    }

    #[test]
    fn converting_draft_and_creating_task_are_atomic() {
        let mut db = Database::in_memory().unwrap();
        let draft = db
            .upsert_draft(DraftInput {
                id: None,
                title: "半成品草稿".into(),
                note: "草稿内容".into(),
                mode: "pool".into(),
                tag_id: "focus".into(),
                priority: "P1".into(),
                duration: 45,
                start_min: 17 * 60,
                date_start: "2026-11-26".into(),
                date_end: "2026-11-26".into(),
            })
            .unwrap();
        assert_eq!(db.list_drafts().unwrap().len(), 1);
        db.connection.execute_batch(
            "CREATE TEMP TRIGGER reject_draft_delete BEFORE DELETE ON drafts
             BEGIN SELECT RAISE(ABORT, 'test delete failure'); END;",
        ).unwrap();
        assert!(db.create_task(sample_task_input("转换草稿", "pool"), Some(&draft.id)).is_err());
        assert!(db.list_tasks(false).unwrap().is_empty());
        assert!(db.load_subtasks_map().unwrap().is_empty());
        assert_eq!(db.list_drafts().unwrap()[0].id, draft.id);
        db.connection.execute_batch("DROP TRIGGER reject_draft_delete").unwrap();
        let saved = db.create_task(sample_task_input("转换草稿", "pool"), Some(&draft.id)).unwrap();
        assert!(db.list_drafts().unwrap().is_empty());
        assert_eq!(saved.subtasks.len(), 2);
        assert!(db.create_task(sample_task_input("重复转换", "pool"), Some(&draft.id)).is_err());
        assert_eq!(db.list_tasks(false).unwrap().len(), 1);
    }

    #[test]
    fn recorded_occurrences_survive_schedule_changes_and_archiving() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fresh.sqlite3");
        let mut db = Database::open(&path).unwrap();

        let mut input = RecurringRuleInput {
                title: "晨间站会".into(),
                note: "".into(),
                tag_id: "work".into(),
                priority: "P2".into(),
                frequency: "weekdays".into(),
                weekdays: vec![],
                month_day: None,
                mode: "timeline".into(),
                start_min: Some(9 * 60 + 30),
                duration: 30,
                starts_on: "2026-11-23".into(),
                ends_on: None,
                active: true,
        };
        let rule = db.create_recurring_rule(input.clone()).unwrap();
        let occs = db
            .list_recurring_occurrences_range("2026-11-23", "2026-11-29")
            .unwrap();
        // Mon..Fri = 5 weekdays in that week
        assert_eq!(occs.len(), 5);

        let updated_occ = db
            .set_recurring_occurrence_state(RecurringOccurrenceStateInput {
                rule_id: rule.id.clone(),
                occurrence_date: "2026-11-26".into(),
                done: Some(true),
                skipped: None,
                override_start_min: Some(Some(10 * 60)),
                override_duration: None,
            })
            .unwrap();
        assert!(updated_occ.done);
        assert_eq!(updated_occ.start_min, Some(10 * 60));
        let range = |db: &Database| db.list_recurring_occurrences_range("2026-11-23", "2026-11-29").unwrap();
        assert_eq!(range(&db).len(), 5);
        db.toggle_recurring_rule(&rule.id, false).unwrap();
        assert_eq!(range(&db), vec![updated_occ.clone()]);

        input.title = "改到周二".into();
        input.frequency = "weekly".into();
        input.weekdays = vec![2];
        input.start_min = Some(15 * 60);
        input.duration = 60;
        db.update_recurring_rule(&rule.id, input.clone()).unwrap();
        let after_edit = range(&db);
        assert_eq!(after_edit.len(), 2);
        assert_eq!(after_edit[0].occurrence_date, "2026-11-24");
        assert_eq!(after_edit[0].title, input.title);
        assert_eq!(after_edit[0].start_min, input.start_min);
        assert_eq!(after_edit[1], updated_occ);

        db.archive_recurring_rule(&rule.id).unwrap();
        // The previous package already used snapshots but still reported schema version 2.
        db.connection.pragma_update(None, "user_version", 2).unwrap();
        drop(db);
        let mut db = Database::open(&path).unwrap();
        assert!(db.list_recurring_rules().unwrap().is_empty());
        assert!(db.toggle_recurring_rule(&rule.id, true).is_err());
        assert!(db.update_recurring_rule(&rule.id, input).is_err());
        assert_eq!(range(&db), vec![updated_occ.clone()]);
        assert!(db.list_recurring_occurrences_range("2026-11-30", "2026-12-06").unwrap().is_empty());
        let changed = db.set_recurring_occurrence_state(RecurringOccurrenceStateInput {
            rule_id: rule.id,
            occurrence_date: updated_occ.occurrence_date.clone(),
            done: Some(false),
            skipped: None,
            override_start_min: None,
            override_duration: None,
        }).unwrap();
        assert_eq!(changed, RecurringOccurrenceDto { done: false, ..updated_occ });
        assert!(range(&db).is_empty());
    }

    #[test]
    fn pausing_archiving_unchecking_and_skipping_recurring_occurrences() {
        let mut db = Database::in_memory().unwrap();
        let rule = db
            .create_recurring_rule(RecurringRuleInput {
                title: "每日例会".into(),
                note: "".into(),
                tag_id: "work".into(),
                priority: "".into(),
                frequency: "daily".into(),
                weekdays: vec![],
                month_day: None,
                mode: "timeline".into(),
                start_min: Some(9 * 60 + 30),
                duration: 30,
                starts_on: "2026-11-26".into(),
                ends_on: Some("2026-11-28".into()),
                active: true,
            })
            .unwrap();
        let range = |db: &Database| db.list_recurring_occurrences_range("2026-11-26", "2026-11-28").unwrap();
        assert_eq!(range(&db).len(), 3);

        // Check then uncheck 2026-11-27 -> should not permanently lock the day when paused
        db.set_recurring_occurrence_state(RecurringOccurrenceStateInput {
            rule_id: rule.id.clone(),
            occurrence_date: "2026-11-27".into(),
            done: Some(true),
            skipped: None,
            override_start_min: None,
            override_duration: None,
        })
        .unwrap();
        db.set_recurring_occurrence_state(RecurringOccurrenceStateInput {
            rule_id: rule.id.clone(),
            occurrence_date: "2026-11-27".into(),
            done: Some(false),
            skipped: None,
            override_start_min: None,
            override_duration: None,
        })
        .unwrap();

        // Mark 2026-11-26 completed (execution history)
        let done_occ = db
            .set_recurring_occurrence_state(RecurringOccurrenceStateInput {
                rule_id: rule.id.clone(),
                occurrence_date: "2026-11-26".into(),
                done: Some(true),
                skipped: None,
                override_start_min: None,
                override_duration: None,
            })
            .unwrap();

        // Pausing hides uncompleted 2026-11-27 and 2026-11-28 while keeping completed 2026-11-26
        db.toggle_recurring_rule(&rule.id, false).unwrap();
        assert_eq!(range(&db), vec![done_occ.clone()]);

        // Re-enabling and skipping 2026-11-27 hides only that single day
        db.toggle_recurring_rule(&rule.id, true).unwrap();
        assert_eq!(range(&db).len(), 3);
        db.set_recurring_occurrence_state(RecurringOccurrenceStateInput {
            rule_id: rule.id.clone(),
            occurrence_date: "2026-11-27".into(),
            done: None,
            skipped: Some(true),
            override_start_min: None,
            override_duration: None,
        })
        .unwrap();
        let after_skip: Vec<String> = range(&db).into_iter().map(|o| o.occurrence_date).collect();
        assert_eq!(after_skip, vec!["2026-11-26", "2026-11-28"]);

        // Archiving removes uncompleted 2026-11-28, preserves completed 2026-11-26, and skipping removes completed too
        db.archive_recurring_rule(&rule.id).unwrap();
        assert_eq!(range(&db), vec![done_occ]);
        db.set_recurring_occurrence_state(RecurringOccurrenceStateInput {
            rule_id: rule.id,
            occurrence_date: "2026-11-26".into(),
            done: None,
            skipped: Some(true),
            override_start_min: None,
            override_duration: None,
        })
        .unwrap();
        assert!(range(&db).is_empty());
    }

    #[test]
    fn reschedule_recurring_single_and_this_and_future_preserve_history() {
        let mut db = Database::in_memory().unwrap();
        let rule = db
            .create_recurring_rule(RecurringRuleInput {
                title: "晨间站会".into(),
                note: "同步进度".into(),
                tag_id: "work".into(),
                priority: "P2".into(),
                frequency: "daily".into(),
                weekdays: vec![],
                month_day: None,
                mode: "timeline".into(),
                start_min: Some(9 * 60 + 30),
                duration: 30,
                starts_on: "2026-11-25".into(),
                ends_on: None,
                active: true,
            })
            .unwrap();

        // 1. Single-occurrence reschedule only changes 2026-11-26
        let single = db
            .reschedule_recurring_occurrence(RescheduleRecurringOccurrenceInput {
                rule_id: rule.id.clone(),
                occurrence_date: "2026-11-26".into(),
                start_min: 10 * 60,
                duration: 45,
                scope: "single".into(),
            })
            .unwrap();
        assert_eq!(single.occurrence.start_min, Some(10 * 60));
        assert_eq!(single.occurrence.duration, 45);
        let occs_after_single = db
            .list_recurring_occurrences_range("2026-11-25", "2026-11-28")
            .unwrap();
        let by_date = |list: &[RecurringOccurrenceDto], d: &str| {
            list.iter().find(|o| o.occurrence_date == d).unwrap().clone()
        };
        assert_eq!(by_date(&occs_after_single, "2026-11-25").start_min, Some(9 * 60 + 30));
        assert_eq!(by_date(&occs_after_single, "2026-11-26").start_min, Some(10 * 60));
        assert_eq!(by_date(&occs_after_single, "2026-11-27").start_min, Some(9 * 60 + 30));

        // Mark 2026-11-27 done and 2026-11-28 skipped before splitting at 2026-11-27
        db.set_recurring_occurrence_state(RecurringOccurrenceStateInput {
            rule_id: rule.id.clone(),
            occurrence_date: "2026-11-27".into(),
            done: Some(true),
            skipped: None,
            override_start_min: None,
            override_duration: None,
        })
        .unwrap();
        db.set_recurring_occurrence_state(RecurringOccurrenceStateInput {
            rule_id: rule.id.clone(),
            occurrence_date: "2026-11-28".into(),
            done: None,
            skipped: Some(true),
            override_start_min: None,
            override_duration: None,
        })
        .unwrap();

        // 2. Reschedule this_and_future at 2026-11-27 updates the SINGLE rule in-place while freezing past dates
        let split = db
            .reschedule_recurring_occurrence(RescheduleRecurringOccurrenceInput {
                rule_id: rule.id.clone(),
                occurrence_date: "2026-11-27".into(),
                start_min: 11 * 60,
                duration: 60,
                scope: "this_and_future".into(),
            })
            .unwrap();
        assert_eq!(split.recurring_rules.len(), 1);
        assert_eq!(split.recurring_rules[0].id, rule.id);
        assert_eq!(split.recurring_rules[0].start_min, Some(11 * 60));
        assert_eq!(split.recurring_rules[0].duration, 60);
        assert_eq!(split.occurrence.start_min, Some(11 * 60));
        assert_eq!(split.occurrence.duration, 60);
        assert!(split.occurrence.done);

        let occs_after_split = db
            .list_recurring_occurrences_range("2026-11-25", "2026-11-29")
            .unwrap();
        // Past dates keep their original / single-overridden times
        assert_eq!(by_date(&occs_after_split, "2026-11-25").start_min, Some(9 * 60 + 30));
        assert_eq!(by_date(&occs_after_split, "2026-11-26").start_min, Some(10 * 60));
        // 2026-11-27 & 2026-11-29 use new time; 2026-11-28 stays skipped
        assert_eq!(by_date(&occs_after_split, "2026-11-27").start_min, Some(11 * 60));
        assert!(by_date(&occs_after_split, "2026-11-27").done);
        assert!(occs_after_split.iter().all(|o| o.occurrence_date != "2026-11-28"));
        assert_eq!(by_date(&occs_after_split, "2026-11-29").start_min, Some(11 * 60));
        assert_eq!(by_date(&occs_after_split, "2026-11-29").duration, 60);
    }

    #[test]
    fn archive_and_restore_recurring_rule_roundtrip() {
        let mut db = Database::in_memory().unwrap();
        let rule = db
            .create_recurring_rule(RecurringRuleInput {
                title: "每日复盘".into(),
                note: "".into(),
                tag_id: "work".into(),
                priority: "".into(),
                frequency: "daily".into(),
                weekdays: vec![],
                month_day: None,
                mode: "timeline".into(),
                start_min: Some(18 * 60),
                duration: 30,
                starts_on: "2026-11-25".into(),
                ends_on: None,
                active: true,
            })
            .unwrap();

        let archived = db.archive_recurring_rule(&rule.id).unwrap();
        assert_eq!(archived.id, rule.id);
        assert!(!archived.active);
        let snap_after_archive = db.get_workspace_snapshot().unwrap();
        assert!(snap_after_archive.recurring_rules.is_empty());
        assert_eq!(snap_after_archive.archived_recurring_rules.len(), 1);
        assert_eq!(snap_after_archive.archived_recurring_rules[0].id, rule.id);

        let restored = db.restore_recurring_rule(&rule.id).unwrap();
        assert_eq!(restored.id, rule.id);
        assert!(restored.active);
        let snap_after_restore = db.get_workspace_snapshot().unwrap();
        assert_eq!(snap_after_restore.recurring_rules.len(), 1);
        assert!(snap_after_restore.archived_recurring_rules.is_empty());
        let occs = db
            .list_recurring_occurrences_range("2026-11-25", "2026-11-27")
            .unwrap();
        assert_eq!(occs.len(), 3);
    }
}
