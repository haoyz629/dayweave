use super::*;

fn update(title: &str) -> ManualTaskUpdate {
    ManualTaskUpdate {
        title: title.into(), notes: None, priority: None,
        earliest_start_at: Some("2026-10-16T09:00:00+08:00".into()),
        due_at: Some("2026-10-18T18:00:00+08:00".into()),
        estimated_minutes: Some(180),
    }
}

#[test]
fn manual_task_tags_save_with_fields_and_undo_restores_both() {
    let _clock = TestToday::new("2026-10-16");
    let mut database = Database::in_memory().unwrap();
    let id = database.create_manual_task("原始标题").unwrap();
    database.set_task_tags(&id, vec!["原始标签".into()]).unwrap();
    let saved = database.update_manual_task_with_tags(&id, update("新标题"), Some(vec![" 项目 ".into(), "WORK".into(), "work".into()])).unwrap();
    assert_eq!(saved.title, "新标题");
    assert_eq!(saved.tags.len(), 2);
    let tags = database.get_task_metadata(&id).unwrap().tags;
    assert!(tags.contains(&"项目".into()));
    assert!(tags.contains(&"WORK".into()));
    let undo = database.latest_undo().unwrap().unwrap();
    database.apply_undo(&undo.id).unwrap();
    let restored = database.get_task(&id).unwrap();
    assert_eq!(restored.title, "原始标题");
    assert_eq!(restored.tags, vec!["原始标签".to_string()]);
}

#[test]
fn manual_task_tag_validation_rolls_back_fields_and_old_calls_preserve_tags() {
    let _clock = TestToday::new("2026-10-16");
    let mut database = Database::in_memory().unwrap();
    let id = database.create_manual_task("原始标题").unwrap();
    database.set_task_tags(&id, vec!["保留标签".into()]).unwrap();
    assert!(database.update_manual_task_with_tags(&id, update("不应保存"), Some(vec!["长".repeat(31)])).is_err());
    assert_eq!(database.get_task(&id).unwrap().title, "原始标题");
    let saved = database.update_manual_task(&id, update("兼容调用")).unwrap();
    assert_eq!(saved.tags, vec!["保留标签".to_string()]);
    assert!(database.update_manual_task_with_tags(&id, update("过多标签"), Some((0..11).map(|n| format!("tag-{n}")).collect())).is_err());
    assert_eq!(database.get_task(&id).unwrap().title, "兼容调用");
    let cleared = database.update_manual_task_with_tags(&id, update("清除标签"), Some(vec![])).unwrap();
    assert!(cleared.tags.is_empty());
}

#[test]
fn invalid_task_time_does_not_save_new_tags() {
    let _clock = TestToday::new("2026-10-16");
    let mut database = Database::in_memory().unwrap();
    let id = database.create_manual_task("原始标题").unwrap();
    let mut invalid = update("不应保存");
    invalid.due_at = None;
    assert!(database.update_manual_task_with_tags(&id, invalid, Some(vec!["不能写入".into()])).is_err());
    assert!(database.get_task_metadata(&id).unwrap().tags.is_empty());
    assert_eq!(database.get_task(&id).unwrap().title, "原始标题");
}

fn tagged_draft(tags: Vec<String>) -> TaskDraftInput {
    TaskDraftInput { item_type: "task".into(), recurring_settings: None, title: "带标签草稿".into(), notes: None,
        priority: None, earliest_start_date: None, earliest_start_time: None, due_date: None, due_time: None,
        total_workload_minutes: None, remaining_workload_minutes: None, field_states_json: "{}".into(), tags, recurrence: None }
}

fn recurring(tags: Vec<String>) -> RecurringItemInput {
    RecurringItemInput { title: "带标签重复事项".into(), notes: None, frequency: "daily".into(), interval_value: 1,
        weekdays: vec![], month_day: None, starts_on: "2026-10-16".into(), ends_on: None,
        display_time: Some("09:00".into()), display_duration_minutes: Some(30), tags }
}

#[test]
fn catalog_creation_is_case_insensitive_and_colors_are_persisted_once() {
    let mut db = Database::in_memory().unwrap();
    let first = db.create_tag(" 开发任务 ").unwrap();
    assert_eq!(first.name, "开发任务");
    assert!(first.color < 8);
    assert_eq!(db.create_tag("开发任务").unwrap(), first);
    let english = db.create_tag("Work").unwrap();
    assert_eq!(db.create_tag(" work ").unwrap(), english);
    let unicode = db.create_tag("Équipe").unwrap();
    assert_eq!(db.create_tag("éQUIPE").unwrap(), unicode);
    assert!(db.create_tag("   ").is_err());
    assert!(db.create_tag(&"长".repeat(31)).is_err());
    let before = db.list_tag_catalog().unwrap();
    db.migrate().unwrap();
    assert_eq!(db.list_tag_catalog().unwrap(), before);
    let id = db.create_manual_task("选择已有标签").unwrap();
    db.set_task_tags(&id, vec!["开发任务".into()]).unwrap();
    assert_eq!(db.list_tag_catalog().unwrap(), before);
}

#[test]
fn global_fifty_cap_rejects_new_names_atomically_but_allows_existing_selection() {
    let mut db = Database::in_memory().unwrap();
    for i in 0..49 { db.create_tag(&format!("tag-{i}")).unwrap(); }
    let id = db.create_manual_task("全局上限").unwrap();
    assert!(db.set_task_tags(&id, vec!["new-a".into(), "new-b".into()]).is_err());
    assert_eq!(db.list_tag_catalog().unwrap().len(), 49);
    assert!(db.get_task(&id).unwrap().tags.is_empty());
    db.create_tag("last").unwrap();
    assert_eq!(db.list_tag_catalog().unwrap().len(), 50);
    assert!(db.create_tag("one-too-many").is_err());
    assert!(db.create_manual_task_draft(tagged_draft(vec!["new-draft-tag".into()])).is_err());
    assert!(db.create_recurring_item(recurring(vec!["new-recurring-tag".into()])).is_err());
    db.set_task_tags(&id, vec!["TAG-0".into()]).unwrap();
    db.create_manual_task_draft(tagged_draft(vec!["tag-1".into()])).unwrap();
    db.create_recurring_item(recurring(vec!["tag-2".into()])).unwrap();
    assert_eq!(db.list_tag_catalog().unwrap().len(), 50);
    assert_eq!(db.create_tag("TAG-0").unwrap().name, "tag-0");
}

#[test]
fn ten_tag_cap_covers_tasks_drafts_and_recurring_without_partial_catalog_writes() {
    let mut db = Database::in_memory().unwrap();
    let id = db.create_manual_task("每任务上限").unwrap();
    let ten: Vec<String> = (0..10).map(|i| format!("tag-{i}")).collect();
    let eleven: Vec<String> = (0..11).map(|i| format!("tag-{i}")).collect();
    db.set_task_tags(&id, ten.clone()).unwrap();
    let draft = db.create_manual_task_draft(tagged_draft(ten.clone())).unwrap();
    let item = db.create_recurring_item(recurring(ten.clone())).unwrap();
    assert!(db.set_task_tags(&id, eleven.clone()).is_err());
    assert!(db.create_manual_task_draft(tagged_draft(eleven.clone())).is_err());
    assert!(db.save_task_draft(&draft.id, draft.version, tagged_draft(eleven.clone())).is_err());
    assert!(db.create_recurring_item(recurring(eleven.clone())).is_err());
    assert!(db.update_recurring_item(&item.id, recurring(eleven)).is_err());
    assert_eq!(db.get_task(&id).unwrap().tags.len(), 10);
    assert_eq!(db.list_tag_catalog().unwrap().len(), 10);
}

#[test]
fn migration_preserves_over_limit_data_backfills_colors_and_permits_only_reduction() {
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);").unwrap();
    for (version, sql) in MIGRATIONS.iter().filter(|(version, _)| *version <= 24) {
        connection.execute_batch(sql).unwrap();
        connection.execute("INSERT INTO schema_migrations VALUES (?1, ?2)", params![version, now()]).unwrap();
    }
    let old: Vec<String> = (0..12).map(|i| format!("old-{i}")).collect();
    for i in 0..51 {
        connection.execute("INSERT INTO tags(id, name, created_at) VALUES (?1, ?2, ?3)", params![format!("tag-{i}"), format!("old-{i}"), now()]).unwrap();
    }
    connection.execute("INSERT INTO task_drafts (id,draft_kind,source_type,title,splittable,field_states_json,validation_status,version,confirmation_token,status,created_at,updated_at,tags_json)
        VALUES ('legacy-draft','create','manual','legacy',1,'{}','needs_confirmation',1,'token','active','old','old',?1)",
        [serde_json::to_string(&old).unwrap()]).unwrap();
    connection.execute("INSERT INTO recurring_items(id,title,frequency,starts_on,created_at,updated_at,tags_json)
        VALUES ('legacy-recurring','legacy','daily','2026-10-16','old','old','[\"recurring-only\"]')", []).unwrap();
    let mut db = Database { connection, holiday_calendar: CalendarState::bundled() };
    db.migrate().unwrap();
    assert_eq!(db.list_tag_catalog().unwrap().len(), 52);
    assert!(db.list_tag_catalog().unwrap().iter().all(|tag| tag.color < 8));
    let colors = db.list_tag_catalog().unwrap();
    db.migrate().unwrap();
    assert_eq!(colors, db.list_tag_catalog().unwrap());
    assert!(db.create_tag("new-after-migration").is_err());
    let draft = db.list_task_drafts(false).unwrap().remove(0);
    assert_eq!(draft.tags, old);
    db.save_task_draft(&draft.id, draft.version, tagged_draft(old.clone())).unwrap();
    let id = db.create_manual_task("旧超限任务").unwrap();
    for i in 0..12 { db.connection.execute("INSERT INTO task_tags VALUES (?1,?2)", params![id, format!("tag-{i}")]).unwrap(); }
    let creation_clock = TestNow::new("2026-10-16T00:00:00+08:00");
    db.update_manual_task_with_tags(&id, update("保留旧标签"), Some(old.clone())).unwrap();
    drop(creation_clock);
    let mut expanded = old.clone(); expanded.push("old-12".into());
    assert!(db.set_task_tags(&id, expanded).is_err());
    db.set_task_tags(&id, old[..11].to_vec()).unwrap();
    assert_eq!(db.get_task(&id).unwrap().tags.len(), 11);
    db.set_task_tags(&id, old[..10].to_vec()).unwrap();
    assert_eq!(db.get_task(&id).unwrap().tags.len(), 10);
}
