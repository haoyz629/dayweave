use super::*;
use rusqlite::types::Value;

fn input(priority: Option<Priority>) -> TaskDraftInput {
    TaskDraftInput {
        item_type: "task".into(), recurring_settings: None, title: "priority task".into(),
        notes: Some("keep notes".into()), priority,
        earliest_start_date: Some("2026-11-20".into()), earliest_start_time: Some("09:00".into()),
        due_date: Some("2026-11-20".into()), due_time: Some("10:00".into()),
        total_workload_minutes: Some(60), remaining_workload_minutes: Some(60),
        field_states_json: "{}".into(), tags: vec![], recurrence: None,
    }
}

#[test]
fn urgent_priority_draft_create_save_confirm_and_manual_update() {
    let _clock = TestToday::new("2026-11-01");
    let mut db = Database::in_memory().unwrap();
    assert_eq!(parse_priority("urgent").unwrap(), Priority::Urgent);
    for invalid in ["P0", "critical", "URGENT", ""] { assert!(parse_priority(invalid).is_err()); }
    let draft = db.create_manual_task_draft(input(Some(Priority::Urgent))).unwrap();
    assert_eq!(draft.priority.as_deref(), Some("urgent"));
    let saved = db.save_task_draft(&draft.id, draft.version, input(Some(Priority::High))).unwrap();
    let saved = db.save_task_draft(&saved.id, saved.version, input(Some(Priority::Urgent))).unwrap();
    let task = db.confirm_task_draft(&saved.id, &saved.confirmation_token).unwrap();
    assert_eq!(task.priority.as_deref(), Some("urgent"));
    assert_eq!(db.confirm_task_draft(&saved.id, &saved.confirmation_token).unwrap().id, task.id);
    for priority in [Some(Priority::Low), Some(Priority::Urgent), None] {
        let updated = db.update_manual_task(&task.id, ManualTaskUpdate {
            title: task.title.clone(), notes: task.notes.clone(), priority,
            earliest_start_at: task.earliest_start_at.clone(), due_at: task.due_at.clone(),
            estimated_minutes: task.estimated_minutes,
        }).unwrap();
        assert_eq!(updated.priority.as_deref(), priority.map(Priority::as_str));
    }
    // Existing update drafts use the same string parser at confirmation.
    let update = db.create_manual_task_draft(input(Some(Priority::Urgent))).unwrap();
    db.connection.execute("UPDATE task_drafts SET draft_kind = 'update', target_task_id = ?2 WHERE id = ?1",
        params![update.id, task.id]).unwrap();
    assert_eq!(db.confirm_task_draft(&update.id, &update.confirmation_token).unwrap().priority.as_deref(), Some("urgent"));
    let empty = db.create_manual_task_draft(input(None)).unwrap();
    assert_eq!(empty.priority, None, "backend must not rewrite null to the frontend default P1");
    assert_eq!(db.confirm_task_draft(&empty.id, &empty.confirmation_token).unwrap().priority, None);
    for table in ["tasks", "task_drafts"] {
        assert!(db.connection.execute(&format!("UPDATE {table} SET priority = 'P0'"), []).is_err());
    }
}

#[test]
fn priority_candidates_sort_p0_p1_p2_p3_then_null() {
    let _clock = TestToday::new("2026-11-01");
    let db = Database::in_memory().unwrap();
    // Insert in reverse priority order so row order cannot accidentally satisfy the assertion.
    for (id, priority) in [("null", None), ("p3", Some("low")), ("p2", Some("medium")),
        ("p1", Some("high")), ("p0", Some("urgent"))] {
        db.connection.execute("INSERT INTO tasks (id,title,priority,status,earliest_start_at,due_at,
            estimated_minutes,total_workload_minutes,remaining_workload_minutes,created_at,updated_at)
            VALUES (?1,?1,?2,'open','2026-11-19T09:00:00+08:00','2026-11-21T18:00:00+08:00',60,60,60,'same','same')",
            params![id, priority]).unwrap();
    }
    let expected = vec!["p0", "p1", "p2", "p3", "null"];
    assert_eq!(db.list_ai_task_candidates(10).unwrap().iter().map(|task| task.id.as_str()).collect::<Vec<_>>(), expected);
    assert_eq!(db.rule_plan_candidates("2026-11-20", None).unwrap().iter().map(|task| task.task_id.as_str()).collect::<Vec<_>>(), expected);
}

fn legacy_database(connection: Connection) -> Database {
    connection.execute_batch("PRAGMA foreign_keys = ON;
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);").unwrap();
    for (version, sql) in MIGRATIONS.iter().filter(|(version, _)| *version < 32) {
        connection.execute_batch(sql).unwrap();
        connection.execute("INSERT INTO schema_migrations VALUES (?1,'legacy')", [version]).unwrap();
    }
    // Populate both parents and children, including CASCADE and SET NULL references.
    for (id, priority) in [("high", Some("high")), ("medium", Some("medium")), ("low", Some("low")), ("none", None)] {
        connection.execute("INSERT INTO tasks (id,title,notes,priority,status,estimated_minutes,
            total_workload_minutes,remaining_workload_minutes,created_at,updated_at)
            VALUES (?1,?1,'legacy notes',?2,'open',90,90,45,'created','updated')", params![id, priority]).unwrap();
        connection.execute(r#"INSERT INTO task_drafts (id,draft_kind,target_task_id,source_type,title,notes,priority,
            field_states_json,validation_status,version,confirmation_token,status,confirmed_task_id,created_at,updated_at,tags_json)
            VALUES (?1,'update',?1,'manual',?1,'draft notes',?2,'{"priority":"manually_edited"}',
                'valid',7,?1,'confirmed',?1,'created','updated','[]')"#, params![id, priority]).unwrap();
        connection.execute("INSERT INTO task_changes (id,task_id,change_kind,source,created_at)
            VALUES (?1,?1,'created','manual','created')", [id]).unwrap();
        connection.execute("INSERT INTO task_draft_origins VALUES (?1,?1,'source title','created')", [id]).unwrap();
        connection.execute("INSERT INTO task_origins VALUES (?1,?1,'source title','created')", [id]).unwrap();
        connection.execute("INSERT INTO task_estimates (id,task_id,estimate_kind,new_minutes,source,created_at)
            VALUES (?1,?1,'total',90,'manual','created')", [id]).unwrap();
    }
    connection.execute_batch("INSERT INTO tags (id,name,created_at) VALUES ('tag','legacy tag','created');
        INSERT INTO task_tags VALUES ('high','tag');
        INSERT INTO daily_plans (id,plan_date,status,source,created_at) VALUES ('plan','2026-11-20','confirmed','manual','created');
        INSERT INTO plan_blocks (id,daily_plan_id,task_id,starts_at,ends_at,source,created_at,updated_at)
            VALUES ('block','plan','high','2026-11-20T09:00:00+08:00','2026-11-20T10:00:00+08:00','manual','created','updated');
        INSERT INTO review_entries (id,review_date,plan_block_id,task_id,outcome,notes,created_at,updated_at)
            VALUES ('review','2026-11-20','block','high','partial','review notes','created','updated');
        ALTER TABLE tasks ADD COLUMN \"extension field\" TEXT DEFAULT 'preserved';
        CREATE INDEX custom_task_priority ON tasks(priority) WHERE deleted_at IS NULL;
        CREATE UNIQUE INDEX custom_draft_title ON task_drafts(title);
        CREATE TRIGGER custom_task_update AFTER UPDATE OF priority ON tasks BEGIN
            INSERT OR REPLACE INTO settings VALUES ('priority_trigger',NEW.id,'updated'); END;
        CREATE TRIGGER custom_draft_update AFTER UPDATE OF priority ON task_drafts BEGIN
            INSERT OR REPLACE INTO settings VALUES ('draft_trigger',NEW.id,'updated'); END;
        CREATE VIEW legacy_priorities AS SELECT id,priority FROM tasks;").unwrap();
    Database { connection, holiday_calendar: CalendarState::bundled() }
}

fn rows(connection: &Connection, sql: &str) -> Vec<Vec<Value>> {
    let mut statement = connection.prepare(sql).unwrap();
    let count = statement.column_count();
    statement.query_map([], |row| (0..count).map(|column| row.get(column)).collect())
        .unwrap().collect::<Result<Vec<_>, _>>().unwrap()
}

fn data(connection: &Connection) -> Vec<(String, Vec<Vec<Value>>)> {
    rows(connection, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        AND name <> 'schema_migrations' ORDER BY name").into_iter().map(|row| {
        let Value::Text(name) = &row[0] else { panic!("table name"); };
        (name.clone(), rows(connection, &format!("SELECT rowid,* FROM \"{name}\" ORDER BY rowid")))
    }).collect()
}

fn schema(connection: &Connection) -> Vec<Vec<Value>> {
    rows(connection, "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")
        .into_iter().map(|row| row.into_iter().map(|value| match value {
            Value::Text(sql) => Value::Text(sql.replace("\"tasks\"", "tasks").replace("\"task_drafts\"", "task_drafts")),
            other => other,
        }).collect()).collect()
}

fn assert_connection_settings(connection: &Connection) {
    assert!(connection.pragma_query_value::<bool, _>(None, "foreign_keys", |row| row.get(0)).unwrap());
    assert!(!connection.pragma_query_value::<bool, _>(None, "legacy_alter_table", |row| row.get(0)).unwrap());
}

#[test]
fn priority_migration_preserves_legacy_data_references_schema_and_is_idempotent() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("legacy.db");
    let mut db = legacy_database(Connection::open(&path).unwrap());
    let before = data(&db.connection);
    let expected_schema: Vec<_> = schema(&db.connection).into_iter().map(|row| row.into_iter().map(|value| match value {
        Value::Text(sql) => Value::Text(sql.replace("CHECK(priority IN ('low','medium','high'))",
            "CHECK(priority IN ('low','medium','high','urgent'))")),
        other => other,
    }).collect::<Vec<_>>()).collect();
    assert!(db.connection.execute("UPDATE tasks SET priority = 'urgent'", []).is_err());
    assert!(db.connection.execute("UPDATE task_drafts SET priority = 'urgent'", []).is_err());
    db.migrate().unwrap();
    assert_eq!(data(&db.connection), before, "every stored field and rowid must survive");
    assert_eq!(schema(&db.connection), expected_schema, "only priority CHECK constraints may change");
    assert_connection_settings(&db.connection);
    assert!(!db.connection.prepare("PRAGMA foreign_key_check").unwrap().exists([]).unwrap());
    assert_eq!(db.connection.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0)).unwrap(), "ok");
    db.migrate().unwrap();
    assert_eq!(data(&db.connection), before);
    assert_eq!(db.connection.query_row("SELECT count(*) FROM schema_migrations WHERE version = 32", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
    db.connection.execute("DELETE FROM schema_migrations WHERE version = 32", []).unwrap();
    db.migrate().unwrap();
    assert_eq!(data(&db.connection), before, "replaying the marker must tolerate upgraded constraints");
    assert_eq!(schema(&db.connection), expected_schema);
    drop(db);
    let db = Database::open(&path).unwrap();
    assert_eq!(data(&db.connection), before, "reopen must not repeat the rebuild");
    for table in ["tasks", "task_drafts"] {
        db.connection.execute(&format!("UPDATE {table} SET priority = 'urgent' WHERE id = 'high'"), []).unwrap();
        assert!(db.connection.execute(&format!("UPDATE {table} SET priority = 'invalid'"), []).is_err());
    }
    assert_eq!(db.connection.query_row("SELECT count(*) FROM settings WHERE key IN ('priority_trigger','draft_trigger')", [], |row| row.get::<_, i64>(0)).unwrap(), 2);
    assert!(db.connection.execute("INSERT INTO task_tags VALUES ('missing','tag')", []).is_err(), "FK enforcement must be restored");
    assert_eq!(db.connection.query_row("SELECT priority FROM legacy_priorities WHERE id = 'high'", [], |row| row.get::<_, String>(0)).unwrap(), "urgent");
}

#[test]
fn priority_migration_rolls_back_data_schema_and_version_on_foreign_key_failure() {
    let mut db = legacy_database(Connection::open_in_memory().unwrap());
    db.connection.execute_batch("PRAGMA foreign_keys = OFF;
        INSERT INTO task_changes (id,task_id,change_kind,source,created_at) VALUES ('orphan','missing','created','manual','created');
        PRAGMA foreign_keys = ON;").unwrap();
    let before = data(&db.connection);
    let before_schema = schema(&db.connection);
    assert!(db.migrate().is_err());
    assert_eq!(data(&db.connection), before);
    assert_eq!(schema(&db.connection), before_schema);
    assert_connection_settings(&db.connection);
    assert_eq!(db.connection.query_row("SELECT max(version) FROM schema_migrations", [], |row| row.get::<_, i64>(0)).unwrap(), 31);
    db.connection.execute("DELETE FROM task_changes WHERE id = 'orphan'", []).unwrap();
    db.migrate().unwrap();
    assert_connection_settings(&db.connection);
}
