use super::*;

fn input(title: &str) -> RecurringItemInput {
    RecurringItemInput { title: title.into(), notes: Some("original notes".into()),
        frequency: "daily".into(), interval_value: 1, weekdays: vec![], month_day: None,
        starts_on: "2026-09-01".into(), ends_on: None, display_time: Some("09:00".into()),
        display_duration_minutes: Some(30), tags: vec![] }
}
fn occurrence(db: &mut Database, date: &str) -> RecurringOccurrenceDto {
    db.list_recurring_occurrences(date).unwrap().remove(0)
}
fn version_count(db: &Database) -> i64 {
    db.connection.query_row("SELECT COUNT(*) FROM recurring_rule_versions", [], |r| r.get(0)).unwrap()
}

#[test]
fn recurring_required_time_and_draft_confirmation_are_atomic() {
    let _clock = TestToday::new("2026-10-16");
    let mut db = Database::in_memory().unwrap();
    for (time, duration) in [(None,None),(Some("09:00"),None),(None,Some(30)),(Some("23:45"),Some(30)),(Some("25:00"),Some(5)),(Some("09:00"),Some(0))] {
        let mut i = input("invalid"); i.display_time = time.map(str::to_owned); i.display_duration_minutes = duration;
        assert!(db.create_recurring_item(i).is_err());
    }
    let mut draft = TaskDraftInput { item_type: "recurring".into(), recurring_settings: Some(RecurringDraftSettings {
        frequency: "daily".into(), interval_value: 1, weekdays: vec![], month_day: None,
        starts_on: "2026-10-16".into(), ends_on: None, display_time: None, display_duration_minutes: None,
    }), title: "incomplete time".into(), notes: None, priority: None, earliest_start_date: None,
        earliest_start_time: None, due_date: None, due_time: None, total_workload_minutes: None,
        remaining_workload_minutes: None, field_states_json: "{}".into(), tags: vec![], recurrence: None };
    let settings = draft.recurring_settings.as_mut().unwrap();
    settings.display_time = None; settings.display_duration_minutes = None;
    let draft = db.create_manual_task_draft(draft).unwrap();
    assert_eq!(draft.validation_status, "needs_confirmation");
    assert!(db.confirm_creation_draft(&draft.id,&draft.confirmation_token).is_err());
    assert_eq!(version_count(&db), 0);
    assert_eq!(db.list_task_drafts(false).unwrap().len(), 1);
    let mut valid = input("midnight boundary"); valid.display_time = Some("23:30".into());
    assert!(db.create_recurring_item(valid).is_ok());
}

#[test]
fn recurring_this_edit_freezes_all_schedule_fields_and_preserves_review() {
    let _clock = TestToday::new("2026-10-16");
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(input("original")).unwrap();
    let past = occurrence(&mut db,"2026-10-15");
    let today = occurrence(&mut db,"2026-10-16");
    let reviewed = db.save_recurring_occurrence_review(&today.id, RecurringOccurrenceReviewInput { outcome: Some("partial".into()), notes: Some("review stays".into()) }).unwrap();
    let mut edit = input("one only"); edit.notes = None; edit.display_time = Some("11:00".into()); edit.display_duration_minutes = Some(45);
    edit.tags = vec!["new tag".into()];
    let returned = db.update_recurring_occurrence(&today.id,edit,"2026-10-16","this").unwrap();
    assert_eq!(returned, item);
    let changed = occurrence(&mut db,"2026-10-16");
    assert_eq!(changed.id,today.id); assert_eq!(changed.title,"one only");
    assert_eq!(changed.notes,None); assert_eq!(changed.display_time.as_deref(),Some("11:00"));
    assert_eq!(changed.display_duration_minutes,Some(45)); assert_eq!(changed.tags,vec!["new tag"]);
    assert_eq!(changed.outcome,reviewed.outcome); assert_eq!(changed.review_notes,reviewed.review_notes); assert_eq!(changed.reviewed_at,reviewed.reviewed_at);
    assert_eq!(occurrence(&mut db,"2026-10-15"),past);
    assert_eq!(occurrence(&mut db,"2026-10-14").title,"original");
    assert_eq!(occurrence(&mut db,"2026-10-17").title,"original");
    assert_eq!(version_count(&db),1);
}

#[test]
fn recurring_future_versions_preserve_unvisited_history_and_earlier_versions() {
    let _clock = TestToday::new("2026-10-16");
    let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("recurring.sqlite");
    let mut db = Database::open(&path).unwrap();
    let item = db.create_recurring_item(input("original")).unwrap();
    let historical = occurrence(&mut db,"2026-10-15");
    let selected = occurrence(&mut db,"2026-10-18");
    let stale = occurrence(&mut db,"2026-10-21");
    let original_json: String = db.connection.query_row("SELECT rule_json FROM recurring_rule_versions", [], |r| r.get(0)).unwrap();
    let mut edit = input("new future"); edit.notes = Some("new notes".into()); edit.display_time = Some("14:00".into()); edit.tags = vec!["future".into()];
    db.update_recurring_occurrence(&selected.id,edit.clone(),"2026-10-18","future").unwrap();
    assert!(db.update_recurring_occurrence(&stale.id,edit.clone(),"2026-10-21","this").is_err());
    assert_eq!(occurrence(&mut db,"2026-10-15"), historical);
    assert_eq!(occurrence(&mut db,"2026-09-02").title,"original");
    assert_eq!(occurrence(&mut db,"2026-10-17").title,"original");
    assert_eq!(occurrence(&mut db,"2026-10-19").title,"new future");
    let second = occurrence(&mut db,"2026-10-20");
    edit.title = "third version".into();
    db.update_recurring_occurrence(&second.id,edit,"2026-10-20","future").unwrap();
    assert_eq!(occurrence(&mut db,"2026-10-19").title,"new future");
    assert_eq!(occurrence(&mut db,"2026-10-21").title,"third version");
    assert_eq!(version_count(&db),3);
    let first_json: String = db.connection.query_row("SELECT rule_json FROM recurring_rule_versions ORDER BY id LIMIT 1", [], |r| r.get(0)).unwrap();
    assert_eq!(original_json, first_json);
    let range = db.list_recurring_occurrences_range("2026-10-14","2026-10-23").unwrap();
    drop(db);
    let mut db = Database::open(&path).unwrap();
    assert_eq!(db.list_recurring_occurrences_range("2026-10-14","2026-10-23").unwrap(),range);
    assert_eq!(db.resolve_recurring_edit_target(&item.id).unwrap().unwrap().occurrence_date,"2026-10-16");
}

#[test]
fn recurring_rejects_past_moves_and_edits_invalid_scopes_and_rolls_back() {
    let _clock = TestToday::new("2026-10-16");
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(input("original")).unwrap();
    let past = occurrence(&mut db,"2026-10-15");
    let today = occurrence(&mut db,"2026-10-16");
    for scope in ["this","future"] {
        assert!(db.update_recurring_occurrence(&past.id,input("bad"),"2026-10-16",scope).is_err());
        assert!(db.update_recurring_occurrence(&today.id,input("bad"),"2026-10-15",scope).is_err());
    }
    assert!(db.update_recurring_occurrence(&today.id,input("bad"),"2026-10-16","all").is_err());
    assert!(db.update_recurring_occurrence("missing",input("bad"),"2026-10-16","this").is_err());
    db.connection.execute_batch("CREATE TRIGGER reject_occurrence BEFORE UPDATE ON recurring_occurrences BEGIN SELECT RAISE(ABORT,'test rejection'); END;").unwrap();
    let mut edit = input("bad"); edit.tags = vec!["rollback tag".into()];
    assert!(db.update_recurring_occurrence(&today.id,edit,"2026-10-16","future").is_err());
    assert_eq!(version_count(&db),1);
    assert_eq!(db.list_recurring_items(true,true).unwrap()[0],item);
    assert_eq!(occurrence(&mut db,"2026-10-16"),today);
    let registered: bool = db.connection.query_row("SELECT EXISTS(SELECT 1 FROM tags WHERE name='rollback tag')", [], |r| r.get(0)).unwrap();
    assert!(!registered);
}

#[test]
fn recurring_target_resolves_today_next_moved_paused_ended_deleted_and_expired() {
    let _clock = TestToday::new("2026-10-16");
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(input("original")).unwrap();
    let today = db.resolve_recurring_edit_target(&item.id).unwrap().unwrap();
    assert_eq!(today.occurrence_date,"2026-10-16");
    assert_eq!(db.resolve_recurring_edit_target(&item.id).unwrap().unwrap().id,today.id);
    db.update_recurring_occurrence(&today.id,input("moved"),"2026-10-19","this").unwrap();
    assert_eq!(db.resolve_recurring_edit_target(&item.id).unwrap().unwrap().occurrence_date,"2026-10-17");
    db.set_recurring_item_status(&item.id,"paused").unwrap();
    assert_eq!(db.resolve_recurring_edit_target(&item.id).unwrap().unwrap().occurrence_date,"2026-10-17");
    db.set_recurring_item_status(&item.id,"ended").unwrap();
    assert!(db.resolve_recurring_edit_target(&item.id).unwrap().is_none());
    db.soft_delete_recurring_item(&item.id,true).unwrap();
    assert!(db.resolve_recurring_edit_target(&item.id).unwrap().is_none());
    let mut expired = input("expired"); expired.ends_on = Some("2026-10-15".into());
    let item = db.create_recurring_item(expired.clone()).unwrap();
    assert!(db.resolve_recurring_edit_target(&item.id).unwrap().is_none());
    assert!(db.update_recurring_item(&item.id,expired).is_err());
    let mut next = input("far future"); next.starts_on = "2031-12-31".into();
    next.frequency = "monthly".into(); next.month_day = Some(31); next.interval_value = 365;
    let item = db.create_recurring_item(next).unwrap();
    assert_eq!(db.resolve_recurring_edit_target(&item.id).unwrap().unwrap().occurrence_date,"2031-12-31");
}

#[test]
fn recurring_weekly_future_move_shifts_weekdays_and_preserves_explicit_exceptions() {
    let _clock = TestToday::new("2026-10-16");
    let mut db = Database::in_memory().unwrap();
    let mut weekly = input("weekly"); weekly.frequency = "weekly".into(); weekly.weekdays = vec![1,3]; weekly.starts_on = "2026-10-12".into();
    let item = db.create_recurring_item(weekly.clone()).unwrap();
    let exception = occurrence(&mut db,"2026-10-26");
    let mut single = weekly.clone(); single.title = "explicit override".into();
    db.update_recurring_occurrence(&exception.id,single,"2026-10-30","this").unwrap();
    let selected = occurrence(&mut db,"2026-10-19");
    weekly.title = "shifted".into();
    let returned = db.update_recurring_occurrence(&selected.id,weekly,"2026-10-20","future").unwrap();
    assert_eq!(returned.id,item.id); assert_eq!(returned.weekdays,vec![2,4]);
    assert!(db.list_recurring_occurrences("2026-10-19").unwrap().is_empty());
    assert_eq!(occurrence(&mut db,"2026-10-20").id,selected.id);
    assert!(db.list_recurring_occurrences("2026-10-21").unwrap().is_empty());
    assert_eq!(occurrence(&mut db,"2026-10-22").title,"shifted");
    assert_eq!(occurrence(&mut db,"2026-10-30").id,exception.id);
    assert_eq!(occurrence(&mut db,"2026-10-30").title,"explicit override");
    assert_eq!(db.resolve_recurring_edit_target(&item.id).unwrap().unwrap().id,selected.id);
}

#[test]
fn recurring_time_only_edits_preserve_weekly_multi_interval_phase() {
    let _clock = TestToday::new("2026-10-16");
    let mut db = Database::in_memory().unwrap();
    let mut weekly = input("weekly"); weekly.frequency = "weekly".into(); weekly.weekdays = vec![1,3];
    weekly.starts_on = "2026-10-05".into(); weekly.interval_value = 2;
    db.create_recurring_item(weekly.clone()).unwrap();
    let selected = occurrence(&mut db,"2026-10-21");
    weekly.display_time = Some("15:00".into());
    let item = db.update_recurring_occurrence(&selected.id,weekly,"2026-10-21","future").unwrap();
    assert_eq!(item.starts_on,"2026-10-05");
    assert!(db.list_recurring_occurrences("2026-10-26").unwrap().is_empty());
    assert_eq!(occurrence(&mut db,"2026-11-02").display_time.as_deref(),Some("15:00"));
    assert_eq!(occurrence(&mut db,"2026-10-19").display_time.as_deref(),Some("09:00"));
}

#[test]
fn recurring_status_changes_preserve_unseen_past_and_range_matches_per_day() {
    let _clock = TestToday::new("2026-10-16");
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(input("original")).unwrap();
    db.set_recurring_item_status(&item.id,"ended").unwrap();
    assert_eq!(occurrence(&mut db,"2026-09-01").title,"original");
    assert!(db.list_recurring_occurrences("2026-10-17").unwrap().is_empty());
    let range = db.list_recurring_occurrences_range("2026-10-14","2026-10-18").unwrap();
    let mut days = vec![];
    for date in ["2026-10-14","2026-10-15","2026-10-16","2026-10-17","2026-10-18"] { days.extend(db.list_recurring_occurrences(date).unwrap()); }
    assert_eq!(range,days);
    assert!(db.list_recurring_occurrences_range("2026-10-01","2026-12-02").is_err());
    assert!(db.list_recurring_occurrences_range("2026-10-16","2026-10-15").is_err());
    assert!(db.list_recurring_occurrences_range("bad","2026-10-15").is_err());
}

#[test]
fn recurring_migration_preserves_ids_review_and_nullable_legacy_snapshots() {
    let _clock = TestToday::new("2026-10-16");
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);").unwrap();
    for (version,sql) in MIGRATIONS.iter().filter(|(v,_)| *v < 27) {
        connection.execute_batch(sql).unwrap();
        connection.execute("INSERT INTO schema_migrations VALUES(?1,?2)",params![version,now()]).unwrap();
    }
    connection.execute("INSERT INTO recurring_items(id,title,frequency,starts_on,created_at,updated_at) VALUES('legacy','legacy title','daily','2026-09-01',?1,?1)",[now()]).unwrap();
    connection.execute("INSERT INTO recurring_occurrences(id,recurring_item_id,occurrence_date,outcome,review_notes,reviewed_at,created_at,updated_at) VALUES('stable','legacy','2026-10-15','completed','old review',?1,?1,?1)",[now()]).unwrap();
    let mut db = Database { connection, holiday_calendar: CalendarState::bundled() }; db.migrate().unwrap(); db.migrate().unwrap();
    let old = occurrence(&mut db,"2026-10-15");
    assert_eq!(old.id,"stable"); assert_eq!(old.outcome.as_deref(),Some("completed")); assert_eq!(old.review_notes.as_deref(),Some("old review")); assert_eq!(old.display_time,None);
    db.update_recurring_item("legacy",input("updated")).unwrap();
    assert_eq!(occurrence(&mut db,"2026-10-15"),old);
    assert_eq!(occurrence(&mut db,"2026-09-02").title,"legacy title");
}

#[test]
fn recurring_moved_exception_remains_resolvable_after_original_date_passes() {
    let _clock = TestToday::new("2026-10-16");
    let mut db = Database::in_memory().unwrap();
    let mut rule = input("sparse"); rule.interval_value = 10; rule.starts_on = "2026-10-16".into();
    let item = db.create_recurring_item(rule.clone()).unwrap();
    let selected = occurrence(&mut db,"2026-10-16");
    db.update_recurring_occurrence(&selected.id,rule.clone(),"2026-10-20","this").unwrap();
    let _later = TestToday::new("2026-10-19");
    assert_eq!(db.resolve_recurring_edit_target(&item.id).unwrap().unwrap().id,selected.id);
    rule.title = "future from moved block".into();
    db.update_recurring_occurrence(&selected.id,rule,"2026-10-21","future").unwrap();
    assert!(db.list_recurring_occurrences("2026-10-16").unwrap().is_empty());
    assert_eq!(occurrence(&mut db,"2026-10-21").id,selected.id);
    let effective: String = db.connection.query_row("SELECT effective_from FROM recurring_rule_versions ORDER BY id DESC LIMIT 1",[],|r|r.get(0)).unwrap();
    assert_eq!(effective,"2026-10-20", "boundary is the selected block before moving, not its old exception origin");
}

#[test]
fn recurring_earlier_future_edit_supersedes_later_versions_but_keeps_exceptions() {
    let _clock = TestToday::new("2026-10-16");
    let mut db = Database::in_memory().unwrap();
    db.create_recurring_item(input("original")).unwrap();
    let later = occurrence(&mut db,"2026-10-25");
    db.update_recurring_occurrence(&later.id,input("later version"),"2026-10-25","future").unwrap();
    let before = occurrence(&mut db,"2026-10-18");
    let earlier = occurrence(&mut db,"2026-10-20");
    db.update_recurring_occurrence(&earlier.id,input("earlier version"),"2026-10-20","future").unwrap();
    assert_eq!(occurrence(&mut db,"2026-10-18"),before);
    assert_eq!(occurrence(&mut db,"2026-10-24").title,"earlier version");
    assert_eq!(occurrence(&mut db,"2026-10-25").title,"later version", "explicit selected occurrences have exception precedence");
    assert_eq!(occurrence(&mut db,"2026-10-26").title,"earlier version");
    assert_eq!(version_count(&db),3);
}

#[test]
fn recurring_daily_and_monthly_time_edits_keep_original_phase() {
    let _clock = TestToday::new("2026-10-16");
    for (frequency,interval,start,selected,next,off,month_day) in [
        ("daily",3,"2026-10-01","2026-10-16","2026-10-19","2026-10-17",None),
        ("monthly",2,"2026-08-01","2026-10-31","2026-12-31","2026-11-30",Some(31)),
    ] {
        let mut db = Database::in_memory().unwrap();
        let mut rule = input("phase"); rule.frequency = frequency.into(); rule.interval_value = interval;
        rule.starts_on = start.into(); rule.month_day = month_day;
        db.create_recurring_item(rule.clone()).unwrap();
        let selected_occurrence = occurrence(&mut db,selected);
        rule.display_time = Some("16:00".into());
        db.update_recurring_occurrence(&selected_occurrence.id,rule,selected,"future").unwrap();
        assert_eq!(occurrence(&mut db,next).display_time.as_deref(),Some("16:00"));
        assert!(db.list_recurring_occurrences(off).unwrap().is_empty());
    }
}

#[test]
fn recurring_this_move_can_share_a_date_without_overwriting_another_review_or_schedule() {
    let _clock = TestToday::new("2026-10-16");
    let mut db = Database::in_memory().unwrap();
    db.create_recurring_item(input("original")).unwrap();
    let today = occurrence(&mut db,"2026-10-16");
    let tomorrow = occurrence(&mut db,"2026-10-17");
    db.save_review_form_draft("2026-10-16","recurring",&today.id,"{}",0).unwrap();
    let drafts = fact_rows(&db.connection,"SELECT * FROM review_form_drafts WHERE item_id=?1",&today.id).unwrap();
    db.update_recurring_occurrence(&today.id,input("moved single"),"2026-10-17","this").unwrap();
    assert!(db.list_recurring_occurrences("2026-10-16").unwrap().is_empty());
    let blocks = db.list_recurring_occurrences("2026-10-17").unwrap();
    assert_eq!(blocks.len(),2);
    assert_eq!(blocks.iter().find(|o| o.id == tomorrow.id).unwrap(),&tomorrow);
    assert_eq!(fact_rows(&db.connection,"SELECT * FROM review_form_drafts WHERE item_id=?1",&today.id).unwrap(),drafts);
}

#[test]
fn recurring_pause_resume_records_effective_dates_without_erasing_unvisited_history() {
    let _clock = TestToday::new("2026-10-16");
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(input("original")).unwrap();
    db.set_recurring_item_status(&item.id,"paused").unwrap();
    let _later = TestToday::new("2026-10-20");
    db.set_recurring_item_status(&item.id,"active").unwrap();
    assert_eq!(occurrence(&mut db,"2026-10-15").title,"original");
    assert!(db.list_recurring_occurrences("2026-10-18").unwrap().is_empty());
    assert_eq!(occurrence(&mut db,"2026-10-21").title,"original");
}

#[test]
fn recurring_future_edit_keeps_review_facts_and_freezes_after_shanghai_midnight() {
    let _clock = TestNow::new("2026-10-16T23:59:59+08:00");
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(input("original")).unwrap();
    let today = occurrence(&mut db,"2026-10-16");
    let reviewed = db.save_recurring_occurrence_review(&today.id,RecurringOccurrenceReviewInput { outcome: Some("completed".into()),notes: Some("keep result".into()) }).unwrap();
    let mut edit = input("future title"); edit.display_time = Some("13:00".into());
    db.update_recurring_occurrence(&today.id,edit.clone(),"2026-10-16","future").unwrap();
    let changed = occurrence(&mut db,"2026-10-16");
    assert_eq!(changed.outcome,reviewed.outcome); assert_eq!(changed.review_notes,reviewed.review_notes); assert_eq!(changed.reviewed_at,reviewed.reviewed_at);
    let _midnight = TestNow::new("2026-10-16T16:00:00Z");
    assert_eq!(shanghai_today(),"2026-10-17");
    assert!(db.update_recurring_occurrence(&today.id,edit,"2026-10-17","this").is_err());
    assert_eq!(occurrence(&mut db,"2026-10-16"),changed);
    assert_eq!(db.resolve_recurring_edit_target(&item.id).unwrap().unwrap().occurrence_date,"2026-10-17");
}

#[test]
fn recurring_legacy_update_rolls_back_target_materialization_and_rule_on_failure() {
    let _clock = TestToday::new("2026-10-16");
    let mut db = Database::in_memory().unwrap();
    let item = db.create_recurring_item(input("original")).unwrap();
    assert_eq!(db.count("recurring_occurrences").unwrap(),0);
    let mut invalid = input("invalid"); invalid.display_time = None;
    assert!(db.update_recurring_item(&item.id,invalid).is_err());
    assert_eq!(db.count("recurring_occurrences").unwrap(),0);
    db.connection.execute_batch("CREATE TRIGGER fail_legacy_edit BEFORE UPDATE ON recurring_items BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert!(db.update_recurring_item(&item.id,input("changed")).is_err());
    assert_eq!(db.count("recurring_occurrences").unwrap(),0);
    assert_eq!(version_count(&db),1);
    assert_eq!(db.list_recurring_items(true,true).unwrap()[0],item);
    assert!(db.resolve_recurring_edit_target("permanently-deleted-or-missing").unwrap().is_none());
}

#[test]
fn recurring_paused_target_is_future_and_resolves_after_an_exception_was_moved_to_today() {
    let _clock = TestToday::new("2026-10-16");
    let mut db = Database::in_memory().unwrap();
    let mut weekly = input("weekly"); weekly.frequency = "weekly".into(); weekly.weekdays = vec![1];
    let item = db.create_recurring_item(weekly.clone()).unwrap();
    let next = occurrence(&mut db,"2026-10-19");
    db.update_recurring_occurrence(&next.id,weekly,"2026-10-16","this").unwrap();
    assert_eq!(db.resolve_recurring_edit_target(&item.id).unwrap().unwrap().id,next.id);
    db.set_recurring_item_status(&item.id,"paused").unwrap();
    let _later = TestToday::new("2026-10-20");
    let target = db.resolve_recurring_edit_target(&item.id).unwrap().unwrap();
    assert_eq!(target.occurrence_date,"2026-10-26");
    assert!(db.list_recurring_occurrences("2026-10-26").unwrap().is_empty());
}

#[test]
fn recurring_occurrence_rule_metadata_uses_its_version_not_the_latest_item() {
    let _clock = TestToday::new("2026-10-16");
    let mut db = Database::in_memory().unwrap();
    let original = input("original daily");
    let item = db.create_recurring_item(original.clone()).unwrap();
    let past = occurrence(&mut db,"2026-10-15");
    let later = occurrence(&mut db,"2026-10-26");
    let mut weekly = original.clone(); weekly.title = "later weekly".into();
    weekly.frequency = "weekly".into(); weekly.weekdays = vec![1];
    db.update_recurring_occurrence(&later.id,weekly,"2026-10-26","future").unwrap();
    assert_eq!(db.list_recurring_items(true,true).unwrap()[0].frequency,"weekly");
    let target = db.resolve_recurring_edit_target(&item.id).unwrap().unwrap();
    assert_eq!(target.occurrence_date,"2026-10-16");
    assert_eq!(target.schedule_rule,Some(original.clone()));
    assert_eq!(occurrence(&mut db,"2026-10-18").schedule_rule,Some(original.clone()));
    let range = db.list_recurring_occurrences_range("2026-10-16","2026-10-18").unwrap();
    assert!(range.iter().all(|o| o.schedule_rule.as_ref() == Some(&original)));
    let reviewed = db.save_recurring_occurrence_review(&target.id,RecurringOccurrenceReviewInput {
        outcome: Some("partial".into()), notes: Some("keep review".into()),
    }).unwrap();
    assert_eq!(reviewed.schedule_rule,Some(original.clone()));
    let mut single = target.schedule_rule.clone().unwrap(); single.title = "single title".into();
    single.display_time = Some("11:00".into());
    db.update_recurring_occurrence(&target.id,single,"2026-10-16","this").unwrap();
    let overridden = db.resolve_recurring_edit_target(&item.id).unwrap().unwrap();
    assert_eq!(overridden.title,"single title");
    assert_eq!(overridden.schedule_rule,Some(original));
    let mut edit = overridden.schedule_rule.unwrap(); edit.title = "earlier daily edit".into();
    edit.display_time = Some("12:00".into());
    let edited_item = db.update_recurring_occurrence(&target.id,edit,"2026-10-16","future").unwrap();
    assert_eq!(edited_item.frequency,"daily");
    assert_eq!(occurrence(&mut db,"2026-10-17").schedule_rule.unwrap().frequency,"daily");
    assert_eq!(occurrence(&mut db,"2026-10-26").schedule_rule.unwrap().frequency,"weekly");
    assert_eq!(occurrence(&mut db,"2026-10-15"),past);
    let saved = occurrence(&mut db,"2026-10-16");
    assert_eq!(saved.outcome,reviewed.outcome); assert_eq!(saved.review_notes,reviewed.review_notes);
    assert_eq!(saved.reviewed_at,reviewed.reviewed_at);
    let mut legacy_json = serde_json::to_value(&saved).unwrap();
    legacy_json.as_object_mut().unwrap().remove("schedule_rule");
    let legacy: RecurringOccurrenceDto = serde_json::from_value(legacy_json).unwrap();
    assert!(legacy.schedule_rule.is_none(), "legacy undo snapshots still deserialize");
}

#[test]
fn recurring_explicit_start_changes_validity_and_phase_without_rewriting_history() {
    let _clock = TestToday::new("2026-10-16");
    for (start,first,off) in [("2026-10-20","2026-10-20","2026-10-19"),
        ("2026-10-15","2026-10-18","2026-10-17"),
        ("2026-10-16","2026-10-19","2026-10-18")] {
        let mut db = Database::in_memory().unwrap();
        let mut rule = input("every three days"); rule.starts_on = "2026-10-01".into(); rule.interval_value = 3;
        db.create_recurring_item(rule).unwrap();
        let past = occurrence(&mut db,"2026-10-13");
        let selected = occurrence(&mut db,"2026-10-16");
        let mut edit = selected.schedule_rule.clone().unwrap(); edit.starts_on = start.into();
        let item = db.update_recurring_occurrence(&selected.id,edit,"2026-10-16","future").unwrap();
        assert_eq!(item.starts_on,start);
        assert_eq!(occurrence(&mut db,first).schedule_rule.unwrap().starts_on,start);
        assert!(db.list_recurring_occurrences(off).unwrap().is_empty());
        assert_eq!(occurrence(&mut db,"2026-10-13"),past);
        assert!(db.list_recurring_occurrences("2026-10-14").unwrap().is_empty());
    }
}

#[test]
fn recurring_changed_frequency_anchors_only_unchanged_start_at_target() {
    let _clock = TestToday::new("2026-10-16");
    for (explicit_start,expected_start,first,off) in [
        (None,"2026-10-16","2026-10-19","2026-10-26"),
        (Some("2026-10-20"),"2026-10-20","2026-10-26","2026-11-02"),
    ] {
        let mut db = Database::in_memory().unwrap();
        db.create_recurring_item(input("daily")).unwrap();
        let past = occurrence(&mut db,"2026-10-15");
        let selected = occurrence(&mut db,"2026-10-16");
        let mut edit = selected.schedule_rule.unwrap(); edit.frequency = "weekly".into();
        edit.interval_value = 2; edit.weekdays = vec![1];
        if let Some(start) = explicit_start { edit.starts_on = start.into(); }
        let item = db.update_recurring_occurrence(&selected.id,edit,"2026-10-16","future").unwrap();
        assert_eq!(item.starts_on,expected_start);
        assert_eq!(occurrence(&mut db,first).schedule_rule.unwrap().starts_on,expected_start);
        assert!(db.list_recurring_occurrences(off).unwrap().is_empty());
        assert_eq!(occurrence(&mut db,"2026-10-15"),past);
    }
}

#[test]
fn recurring_date_drag_shifts_phase_but_explicit_start_is_not_shifted_twice() {
    let _clock = TestToday::new("2026-10-16");
    for explicit_start in [None,Some("2026-10-21")] {
        let mut db = Database::in_memory().unwrap();
        let mut rule = input("phase"); rule.starts_on = "2026-10-01".into(); rule.interval_value = 3;
        db.create_recurring_item(rule).unwrap();
        let selected = occurrence(&mut db,"2026-10-16");
        let mut edit = selected.schedule_rule.unwrap();
        if let Some(start) = explicit_start { edit.starts_on = start.into(); }
        let item = db.update_recurring_occurrence(&selected.id,edit,"2026-10-17","future").unwrap();
        let expected = explicit_start.unwrap_or("2026-10-02");
        assert_eq!(item.starts_on,expected);
        if explicit_start.is_some() {
            assert!(db.list_recurring_occurrences("2026-10-20").unwrap().is_empty());
            assert_eq!(occurrence(&mut db,"2026-10-21").schedule_rule.unwrap().starts_on,expected);
        } else {
            assert!(db.list_recurring_occurrences("2026-10-18").unwrap().is_empty());
            assert_eq!(occurrence(&mut db,"2026-10-20").schedule_rule.unwrap().starts_on,expected);
        }
    }
}
