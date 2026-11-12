use super::*;
use serde_json::{json, Value};

// SYNTHETIC TEST DATA ONLY. Never published or embedded in production calendars.
fn synthetic(year: i32) -> Value {
    json!({"schemaVersion":1,"year":year,"revision":1,
        "from":format!("{year}-01-01"),"to":format!("{year}-12-31"),
        "version":"SYNTHETIC TEST ONLY; not official arrangements",
        "sourceUrl":"https://www.gov.cn/test-only-not-a-real-notice.htm","verifiedAt":"2026-11-10",
        "holidays":[{"name":"TEST ONLY holiday","dates":[format!("{year}-01-01")]}],
        "makeupWorkdays":[[format!("{year}-01-02"),"TEST ONLY makeup"]]})
}
fn apply(db: &mut Database, packets: &[Value]) -> HolidaySnapshot {
    let years=packets.iter().map(|packet|packet["year"].as_i64().unwrap() as i32).collect();
    let job = db.begin_holiday_update(years,true).unwrap().unwrap();
    let result = job.download_with(|path,_| {
        let Some(packet)=packets.iter().find(|packet| path==format!("{}.json",packet["year"])) else { return Ok(None); };
        let mut days=Vec::new();
        for holiday in packet["holidays"].as_array().unwrap() {
            for date in holiday["dates"].as_array().unwrap() { days.push(json!({"name":holiday["name"],"date":date,"isOffDay":true})); }
        }
        for pair in packet["makeupWorkdays"].as_array().unwrap() { days.push(json!({"name":pair[1],"date":pair[0],"isOffDay":false})); }
        Ok(Some(serde_json::to_vec(&json!({"year":packet["year"],"papers":[packet["sourceUrl"]],"days":days})).unwrap()))
    });
    db.finish_holiday_update(result)
}
fn input(start: &str) -> RecurringItemInput {
    RecurringItemInput { title:"TEST legal weekdays".into(),notes:None,frequency:"weekdays".into(),
        interval_value:1,weekdays:vec![],month_day:None,starts_on:start.into(),ends_on:None,
        display_time:Some("09:00".into()),display_duration_minutes:Some(30),tags:vec![] }
}
fn facts(db: &Database) -> Vec<(String,Vec<Vec<String>>)> {
    let tables = {
        let mut statement = db.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'holiday_calendar_%' ORDER BY name").unwrap();
        let rows = statement.query_map([],|row| row.get::<_,String>(0)).unwrap().collect::<Result<Vec<_>,_>>().unwrap(); rows
    };
    tables.into_iter().map(|table| {
        let rows=fact_rows(&db.connection,&format!("SELECT * FROM \"{table}\" WHERE ?1='all' ORDER BY rowid"),"all").unwrap();
        (table,rows)
    }).collect()
}

#[test]
fn holiday_updates_leave_all_task_occurrence_history_facts_unchanged_and_saved_rows_visible() {
    let _clock=TestToday::new("2026-10-16");
    let mut db=Database::in_memory().unwrap();
    db.create_manual_task("TEST untouched task").unwrap();
    let item=db.create_recurring_item(input("2026-10-08")).unwrap();
    let past=db.list_recurring_occurrences("2026-10-12").unwrap().remove(0);
    db.save_recurring_occurrence_review(&past.id,RecurringOccurrenceReviewInput { outcome:Some("completed".into()),notes:Some("TEST preserved history".into()) }).unwrap();
    let future=db.list_recurring_occurrences("2026-10-19").unwrap().remove(0);
    let before=facts(&db);
    let mut revision=serde_json::to_value(&db.get_holiday_calendar().years[0]).unwrap();
    revision["revision"]=json!(2);
    revision["holidays"][0]["dates"].as_array_mut().unwrap().extend([json!("2026-10-12"),json!("2026-10-19"),json!("2026-10-20")]);
    let snapshot=apply(&mut db,&[revision]);
    assert!(snapshot.last_error.is_none(),"{:?}",snapshot.last_error);
    assert_eq!(facts(&db),before,"calendar commit must not write any business table");
    assert_eq!(db.list_recurring_occurrences("2026-10-19").unwrap(),vec![future.clone()]);
    assert_eq!(db.resolve_recurring_edit_target(&item.id).unwrap().unwrap().occurrence_date,"2026-10-16");
    let saved=db.list_recurring_occurrences("2026-10-12").unwrap().remove(0);
    assert_eq!(saved.id,past.id); assert_eq!(saved.outcome.as_deref(),Some("completed"));
    assert!(db.list_recurring_occurrences("2026-10-20").unwrap().is_empty(),"new predictions use revised facts");
    assert_eq!(load_occurrence(&db.connection,&future.id).unwrap(),future);
}

#[test]
fn cross_year_every_n_legal_weekdays_gaps_and_recovery_use_instance_snapshot_everywhere() {
    let _clock=TestToday::new("2028-01-04");
    let mut db=Database::in_memory().unwrap();
    let isolated=Database::in_memory().unwrap();
    let item=db.create_recurring_item(input("2026-12-31")).unwrap();
    let target=parse_plan_date("2028-01-04").unwrap();
    assert!(apply(&mut db,&[synthetic(2028)]).last_error.is_none());
    assert!(!recurring_item_occurs_on(&db.get_holiday_calendar(),&item,target).unwrap());
    assert!(db.list_recurring_occurrences("2028-01-04").unwrap().is_empty());
    assert!(db.resolve_recurring_edit_target(&item.id).unwrap().is_none(),"transaction helper cannot skip 2027 gap");
    assert!(apply(&mut db,&[synthetic(2027)]).last_error.is_none());
    assert!(recurring_item_occurs_on(&db.get_holiday_calendar(),&item,target).unwrap());
    assert_eq!(db.list_recurring_occurrences("2028-01-04").unwrap().len(),1);
    assert_eq!(db.resolve_recurring_edit_target(&item.id).unwrap().unwrap().occurrence_date,"2028-01-04");
    assert_eq!(isolated.get_holiday_calendar().years.len(),1,"no process-global calendar leakage");
    let mut rule=input("2026-12-28"); rule.interval_value=3;
    let item=db.create_recurring_item(rule).unwrap();
    let start=parse_plan_date("2026-12-28").unwrap();
    let end=parse_plan_date("2027-01-10").unwrap();
    let snapshot=db.get_holiday_calendar();
    let mut count=0;
    for offset in 0..=(end-start).num_days() {
        let day=start+Duration::days(offset);
        let workday=snapshot.workday_on(day)==Some(true);
        if workday { count+=1; }
        assert_eq!(recurring_item_occurs_on(&snapshot,&item,day).unwrap(),workday && (count-1)%3==0,"{day}");
    }
    let legacy=RecurrenceInput { frequency:"weekdays".into(),interval_value:3,weekdays:vec![],month_day:None,
        starts_on:start.to_string(),ends_on:Some(end.to_string()) };
    let dates=recurrence_dates(&legacy,&snapshot).unwrap();
    assert!(dates.iter().any(|day|day.year()==2027));
    let dates_without=recurrence_dates(&legacy,&isolated.get_holiday_calendar()).unwrap();
    assert!(dates_without.iter().all(|day|day.year()==2026));
}

#[test]
fn database_reopen_uses_downloaded_years_and_persistent_failure_throttle_offline() {
    let root=std::env::var_os("PI_SCRATCH_DIR").or_else(||std::env::var_os("TEMP")).unwrap();
    let directory=tempfile::tempdir_in(root).unwrap(); let path=directory.path().join("holiday-db.sqlite");
    let mut db=Database::open(&path).unwrap();
    let item=db.create_recurring_item(input("2027-01-02")).unwrap();
    assert!(apply(&mut db,&[synthetic(2027)]).last_error.is_none());
    let snapshot=db.get_holiday_calendar(); drop(db);
    let mut reopened=Database::open(&path).unwrap();
    assert_eq!(reopened.get_holiday_calendar(),snapshot);
    assert_eq!(reopened.list_recurring_occurrences("2027-01-02").unwrap()[0].recurring_item_id,item.id);
    let _job=reopened.begin_holiday_update(vec![2028],true).unwrap().unwrap();
    let after=reopened.finish_holiday_update(Err(AppError::Schema("TEST offline".into())));
    assert_eq!(after.years,snapshot.years); drop(reopened);
    let mut reopened=Database::open(&path).unwrap();
    assert!(reopened.begin_holiday_update(vec![2028],false).unwrap().is_none());
    assert!(reopened.get_holiday_calendar().last_error.unwrap().contains("TEST offline"));
}
