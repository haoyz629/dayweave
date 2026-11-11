use super::*;
use std::{io::Write, net::TcpListener, thread};
use serde_json::{json, Value};

// SYNTHETIC TEST DATA ONLY: these dates are not official 2027 arrangements.
fn synthetic(year: i32, revision: u32) -> Annual {
    Annual::parse(&serde_json::to_vec(&json!({
        "schemaVersion":1,"year":year,"revision":revision,
        "from":format!("{year}-01-01"),"to":format!("{year}-12-31"),
        "version":"SYNTHETIC TEST ONLY — not official arrangements",
        "sourceUrl":"https://www.gov.cn/test-only-not-a-real-notice.htm","verifiedAt":"2026-11-10",
        "holidays":[{"name":"TEST ONLY holiday","dates":[format!("{year}-01-01")]}],
        "makeupWorkdays":[[format!("{year}-01-02"),"TEST ONLY makeup"]]
    })).unwrap()).unwrap()
}
fn manifest(years: &[Annual]) -> Manifest {
    Manifest { schema_version: 1, years: years.iter().map(|annual| ManifestEntry {
        year: annual.year, revision: annual.revision, path: format!("{}.json", annual.year),
        source_url: annual.source_url.clone(), verified_at: annual.verified_at.clone(),
    }).collect() }
}
fn connection() -> Connection {
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch(MIGRATION).unwrap();
    connection
}
fn download(job: UpdateJob, years: &[Annual]) -> AppResult<Downloaded> {
    job.download_with(|path, timeout| {
        assert!(timeout <= TIMEOUT && !timeout.is_zero());
        if path == "index.json" { return Ok(serde_json::to_vec(&manifest(years)).unwrap()); }
        Ok(serde_json::to_vec(years.iter().find(|annual| path == format!("{}.json", annual.year)).unwrap()).unwrap())
    })
}

#[test]
fn annual_boundary_rejects_bad_schema_dates_conflicts_sources_and_partial_coverage() {
    let valid = serde_json::to_value(synthetic(2027, 1)).unwrap();
    let mut variants = Vec::new();
    for (field, value) in [("schemaVersion",json!(2)),("revision",json!(0)),("year",json!(2201)),
        ("from",json!("2027-02-01")),("to",json!("2027-11-30")),("verifiedAt",json!("2027-02-29")),
        ("sourceUrl",json!("https://gov.cn.evil.test/notice")),("sourceUrl",json!("http://www.gov.cn/notice")),
        ("version",json!("")),("holidays",json!([]))] {
        let mut value_copy = valid.clone(); value_copy[field] = value; variants.push(value_copy);
    }
    for day in ["2027-02-29","2026-01-01","2027-1-01"] {
        let mut v = valid.clone(); v["holidays"][0]["dates"] = json!([day]); variants.push(v);
    }
    let mut v = valid.clone(); v["holidays"][0]["dates"] = json!(["2027-01-01","2027-01-01"]); variants.push(v);
    let mut v = valid.clone(); v["makeupWorkdays"] = json!([["2027-01-01","conflict"]]); variants.push(v);
    let mut v = valid.clone(); v["holidays"][0]["namedDate"] = json!("2027-02-30"); variants.push(v);
    let mut v = valid.clone(); v["holidays"][0]["namedDate"] = json!("2027-01-03"); variants.push(v);
    let mut v = valid.clone(); v["holidays"][0]["name"] = json!("x".repeat(81)); variants.push(v);
    for v in variants { assert!(Annual::parse(&serde_json::to_vec(&v).unwrap()).is_err(), "accepted {v}"); }
    assert!(Annual::parse(&vec![b' '; BODY_LIMIT+1]).is_err());
    assert!(Annual::parse(b"not json").is_err());
}

#[test]
fn manifest_boundary_never_authorizes_arbitrary_paths() {
    let valid = serde_json::to_value(manifest(&[synthetic(2027,1)])).unwrap();
    for path in ["../2027.json","https://evil.test/2027.json","2027.json?x=1","2027/2027.json","2026.json","/2027.json"] {
        let mut v = valid.clone(); v["years"][0]["path"] = json!(path);
        assert!(validate_manifest(&serde_json::to_vec(&v).unwrap()).is_err());
    }
    let mut v = valid.clone(); v["years"].as_array_mut().unwrap().push(valid["years"][0].clone());
    assert!(validate_manifest(&serde_json::to_vec(&v).unwrap()).is_err());
    let mut v = valid; v["schemaVersion"] = json!(99);
    assert!(validate_manifest(&serde_json::to_vec(&v).unwrap()).is_err());
}

#[test]
fn bundled_2026_matches_every_existing_date() {
    let old: Value = serde_json::from_str(include_str!("../../src/official-workdays-2026.json")).unwrap();
    let state = CalendarState::bundled();
    let mut day = date("2026-01-01").unwrap();
    while day.year() == 2026 {
        let text = day.to_string();
        let holiday = old["holidays"].as_array().unwrap().iter().any(|group| group["dates"].as_array().unwrap().contains(&json!(text)));
        let makeup = old["makeupWorkdays"].as_array().unwrap().iter().any(|pair| pair[0] == text);
        assert_eq!(state.snapshot.workday_on(day), Some(if holiday { false } else if makeup { true } else { day.weekday().number_from_monday() <= 5 }), "{day}");
        day = day.succ_opt().unwrap();
    }
    assert_eq!(state.snapshot.workday_on(day), None);
}

#[test]
fn synthetic_download_reopen_offline_and_per_instance_isolation() {
    let root = std::env::var_os("PI_SCRATCH_DIR").or_else(|| std::env::var_os("TEMP")).unwrap();
    let directory = tempfile::tempdir_in(root).unwrap();
    let path = directory.path().join("holiday-test.sqlite");
    let mut db = Connection::open(&path).unwrap(); db.execute_batch(MIGRATION).unwrap();
    let mut state = CalendarState::load(&db).unwrap();
    let now = Utc::now();
    let job = state.begin(&db, vec![2027], false, now).unwrap().unwrap();
    assert!(state.snapshot.checking);
    let result = download(job, &[synthetic(2027,1)]);
    let snapshot = state.finish(&mut db,result,now);
    assert!(snapshot.last_error.is_none()); assert!(snapshot.last_success_at.is_some());
    assert_eq!(snapshot.available_years,vec![2027]);
    assert_eq!(snapshot.workday_on(date("2027-01-02").unwrap()),Some(true));
    assert_eq!(CalendarState::bundled().snapshot.years.len(),1);
    drop(db);
    let mut db = Connection::open(&path).unwrap();
    let mut reopened = CalendarState::load(&db).unwrap();
    assert_eq!(reopened.snapshot,snapshot);
    assert!(reopened.begin(&db,vec![2027],false,now).unwrap().is_none());
    let _job = reopened.begin(&db,vec![2027],true,now).unwrap().unwrap();
    let offline = reopened.finish(&mut db,Err(invalid("TEST offline")),now);
    assert_eq!(offline.years,snapshot.years);
    assert!(offline.last_error.unwrap().contains("TEST offline"));
}

#[test]
fn throttle_includes_failures_deduplicates_inflight_and_manual_bypasses() {
    let mut db = connection(); let mut state = CalendarState::bundled(); let now = Utc::now();
    let _job = state.begin(&db,vec![2027],false,now).unwrap().unwrap();
    assert!(state.begin(&db,vec![2028],true,now).unwrap().is_none());
    state.finish(&mut db,Err(invalid("TEST failure")),now);
    assert!(state.begin(&db,vec![2028],false,now+chrono::Duration::hours(23)).unwrap().is_none());
    let mut reopened = CalendarState::load(&db).unwrap();
    assert!(reopened.begin(&db,vec![2028],false,now).unwrap().is_none());
    assert!(reopened.begin(&db,vec![2028],true,now).unwrap().is_some());
    reopened.finish(&mut db,Err(invalid("TEST failure")),now);
    assert!(reopened.begin(&db,vec![2028],false,now+chrono::Duration::hours(24)).unwrap().is_some());
}

#[test]
fn all_published_gaps_download_even_when_requested_year_changes() {
    let mut db = connection(); let mut state = CalendarState::bundled(); let now = Utc::now();
    let packets = [synthetic(2027,1),synthetic(2028,1),synthetic(2029,1)];
    let job = state.begin(&db,vec![2029],false,now).unwrap().unwrap();
    let mut paths = Vec::new();
    let result = job.download_with(|path,_| {
        paths.push(path.to_string());
        if path == "index.json" { Ok(serde_json::to_vec(&manifest(&packets)).unwrap()) }
        else { Ok(serde_json::to_vec(packets.iter().find(|annual| path == format!("{}.json",annual.year)).unwrap()).unwrap()) }
    });
    state.finish(&mut db,result,now);
    assert_eq!(paths,vec!["index.json","2029.json","2027.json","2028.json"]);
    assert!(state.snapshot.covers(date("2026-12-31").unwrap(),date("2029-01-02").unwrap()));
    assert!(state.begin(&db,vec![2028],false,now).unwrap().is_none());
    assert!(state.snapshot.years.iter().any(|annual| annual.year==2028));
}

#[test]
fn cached_manifest_can_supply_new_requested_year_without_refetching_manifest() {
    let mut db = connection(); let mut state = CalendarState::bundled(); let now = Utc::now();
    // Simulate a previously cached index with a locally absent annual package.
    state.manifest = Some(manifest(&[synthetic(2027,1)]));
    state.snapshot.last_attempt_at = Some(now.to_rfc3339());
    let job = state.begin(&db,vec![2027],false,now).unwrap().unwrap();
    let result = job.download_with(|path,_| { assert_eq!(path,"2027.json"); Ok(serde_json::to_vec(&synthetic(2027,1)).unwrap()) });
    state.finish(&mut db,result,now);
    assert_eq!(state.snapshot.years.len(),2);
}

#[test]
fn bad_batch_downgrade_and_same_revision_mismatch_keep_prior_cache() {
    let mut db = connection(); let mut state = CalendarState::bundled(); let now = Utc::now();
    let job = state.begin(&db,vec![2027],false,now).unwrap().unwrap();
    state.finish(&mut db,download(job,&[synthetic(2027,2)]),now);
    let before = state.snapshot.years.clone();
    let mut changed = synthetic(2027,2); changed.holidays[0].dates.push("2027-01-04".into());
    for packet in [synthetic(2027,1),changed] {
        let job = state.begin(&db,vec![2027],true,now).unwrap().unwrap();
        let result = download(job,&[packet]); assert!(result.is_err());
        let after = state.finish(&mut db,result,now);
        assert!(after.last_error.is_some()); assert_eq!(after.years,before);
    }
    let job = state.begin(&db,vec![2028],true,now).unwrap().unwrap();
    let packets = [synthetic(2028,1),synthetic(2029,1)];
    let result = job.download_with(|path,_| {
        if path=="index.json" { Ok(serde_json::to_vec(&manifest(&packets)).unwrap()) }
        else if path=="2028.json" { Ok(serde_json::to_vec(&packets[0]).unwrap()) }
        else { Ok(b"invalid final packet".to_vec()) }
    });
    assert!(result.is_err());
    assert_eq!(state.finish(&mut db,result,now).years,before);
    assert_eq!(CalendarState::load(&db).unwrap().snapshot.years,before);
}

#[test]
fn transaction_failure_rolls_back_packages_success_metadata_and_effective_snapshot() {
    let mut db = connection(); let mut state = CalendarState::bundled(); let now = Utc::now();
    let job = state.begin(&db,vec![2027],false,now).unwrap().unwrap();
    let before = state.snapshot.years.clone();
    db.execute_batch("CREATE TRIGGER fail_holiday_commit BEFORE INSERT ON holiday_calendar_years WHEN NEW.year=2028 BEGIN SELECT RAISE(ABORT,'TEST rollback'); END;").unwrap();
    let result = download(job,&[synthetic(2027,1),synthetic(2028,1)]);
    let after = state.finish(&mut db,result,now);
    assert_eq!(after.years,before); assert!(after.last_error.unwrap().contains("TEST rollback"));
    assert_eq!(after.last_success_at,None);
    assert_eq!(db.query_row("SELECT COUNT(*) FROM holiday_calendar_years",[],|row|row.get::<_,i64>(0)).unwrap(),0);
    assert_eq!(CalendarState::load(&db).unwrap().snapshot.years,before);
}

#[test]
fn corrupt_persistent_record_is_retained_but_not_used_and_other_cache_survives() {
    let db = connection();
    db.execute("INSERT INTO holiday_calendar_years VALUES(2027,?1)",[serde_json::to_string(&synthetic(2027,1)).unwrap()]).unwrap();
    db.execute("INSERT INTO holiday_calendar_years VALUES(2026,'{invalid')",[]).unwrap();
    let state = CalendarState::load(&db).unwrap();
    assert_eq!(state.snapshot.years.len(),2); assert!(state.snapshot.last_error.is_some());
    assert_eq!(state.snapshot.workday_on(date("2026-01-04").unwrap()),Some(true));
    assert_eq!(db.query_row("SELECT package_json FROM holiday_calendar_years WHERE year=2026",[],|row|row.get::<_,String>(0)).unwrap(),"{invalid");
}

fn serve(response: Vec<u8>, delay: Duration) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/test-only",listener.local_addr().unwrap());
    let handle = thread::spawn(move || {
        let (mut stream,_) = listener.accept().unwrap();
        let mut buffer = [0;2048]; let _ = stream.read(&mut buffer);
        thread::sleep(delay); let _ = stream.write_all(&response);
    });
    (url,handle)
}

#[test]
fn real_transport_handles_404_timeout_redirect_and_oversize() {
    let client = reqwest::blocking::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).build().unwrap();
    for response in [
        b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_vec(),
        b"HTTP/1.1 302 Found\r\nLocation: https://example.com/forbidden\r\nContent-Length: 0\r\n\r\n".to_vec(),
        format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n",BODY_LIMIT+1).into_bytes(),
        { let mut body=b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".to_vec(); body.extend(vec![b' ';BODY_LIMIT+1]); body },
    ] {
        let (url,handle)=serve(response,Duration::ZERO);
        assert!(fetch_body(&client,&url,Duration::from_secs(2)).is_err()); handle.join().unwrap();
    }
    let (url,handle)=serve(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}".to_vec(),Duration::from_millis(150));
    assert!(fetch_body(&client,&url,Duration::from_millis(25)).is_err()); handle.join().unwrap();
}

#[test]
fn injected_size_and_network_errors_are_status_not_cache_replacements() {
    let mut db=connection(); let mut state=CalendarState::bundled(); let now=Utc::now();
    for error in ["TEST offline","TEST timeout","TEST HTTP 404"] {
        let job=state.begin(&db,vec![2027],true,now).unwrap().unwrap();
        let result=job.download_with(|_,_|Err(invalid(error)));
        let snapshot=state.finish(&mut db,result,now);
        assert!(snapshot.last_error.unwrap().contains(error)); assert_eq!(snapshot.years.len(),1); assert!(!snapshot.checking);
    }
    let job=state.begin(&db,vec![2027],true,now).unwrap().unwrap();
    let result=job.download_with(|_,_|Ok(vec![b' ';BODY_LIMIT+1]));
    assert_eq!(state.finish(&mut db,result,now).years.len(),1);
}

#[test]
fn canonical_reordering_is_identical_and_newer_cache_wins_over_bundle() {
    let mut db=connection(); let mut state=CalendarState::bundled(); let now=Utc::now();
    let mut newer=state.snapshot.years[0].clone(); newer.revision=2;
    let job=state.begin(&db,vec![2026],true,now).unwrap().unwrap();
    assert!(state.finish(&mut db,download(job,&[newer.clone()]),now).last_error.is_none());
    let mut reordered=newer.clone(); reordered.holidays.reverse(); reordered.makeup_workdays.reverse();
    for holiday in &mut reordered.holidays { holiday.dates.reverse(); }
    let job=state.begin(&db,vec![2026],true,now).unwrap().unwrap();
    assert!(state.finish(&mut db,download(job,&[reordered]),now).last_error.is_none());
    assert_eq!(CalendarState::load(&db).unwrap().snapshot.years,vec![newer]);
}

#[test]
fn maximum_manifest_has_at_most_302_requests_and_fetches_all_intermediate_years() {
    let db=connection(); let mut state=CalendarState::default(); let now=Utc::now();
    let packets=(1900..=2200).map(|year|synthetic(year,1)).collect::<Vec<_>>();
    let job=state.begin(&db,vec![2200],false,now).unwrap().unwrap();
    let mut requests=0;
    let result=job.download_with(|path,_| {
        requests+=1;
        if path=="index.json" { Ok(serde_json::to_vec(&manifest(&packets)).unwrap()) }
        else { Ok(serde_json::to_vec(packets.iter().find(|annual|path==format!("{}.json",annual.year)).unwrap()).unwrap()) }
    }).unwrap();
    assert_eq!(requests,302); assert_eq!(result.years.len(),301);
}

#[test]
fn total_download_deadline_is_shared_across_manifest_and_annual_requests() {
    let db=connection(); let mut state=CalendarState::bundled(); let now=Utc::now();
    let job=state.begin(&db,vec![2027],false,now).unwrap().unwrap();
    let result=job.download_with(|_,remaining| {
        thread::sleep(remaining+Duration::from_millis(5));
        Ok(serde_json::to_vec(&manifest(&[synthetic(2027,1)])).unwrap())
    });
    assert!(result.err().unwrap().to_string().contains("超时"));
}

#[test]
fn snapshot_wire_contract_is_camel_case_with_null_status_fields() {
    let value=serde_json::to_value(CalendarState::bundled().snapshot).unwrap();
    let keys=value.as_object().unwrap().keys().map(String::as_str).collect::<Vec<_>>();
    assert_eq!(keys,vec!["availableYears","checking","lastAttemptAt","lastError","lastSuccessAt","years"]);
    assert_eq!(value["lastAttemptAt"],Value::Null); assert_eq!(value["lastSuccessAt"],Value::Null);
    assert_eq!(value["lastError"],Value::Null); assert_eq!(value["checking"],false);
    assert_eq!(value["years"][0]["schemaVersion"],1); assert_eq!(value["years"][0]["year"],2026);
}

#[test]
fn failure_at_metadata_commit_rolls_back_an_already_written_annual() {
    let mut db=connection(); let mut state=CalendarState::bundled(); let now=Utc::now();
    let job=state.begin(&db,vec![2027],false,now).unwrap().unwrap();
    db.execute_batch("CREATE TRIGGER fail_metadata BEFORE UPDATE ON holiday_calendar_metadata BEGIN SELECT RAISE(ABORT,'TEST final metadata failure'); END;").unwrap();
    let result=download(job,&[synthetic(2027,1)]);
    let snapshot=state.finish(&mut db,result,now);
    assert_eq!(snapshot.years.len(),1); assert!(snapshot.last_success_at.is_none());
    assert!(snapshot.last_error.unwrap().contains("TEST final metadata failure"));
    assert_eq!(db.query_row("SELECT COUNT(*) FROM holiday_calendar_years",[],|row|row.get::<_,i64>(0)).unwrap(),0);
    let reopened=CalendarState::load(&db).unwrap(); assert_eq!(reopened.snapshot.years.len(),1);
    assert!(reopened.snapshot.last_attempt_at.is_some()); assert!(!reopened.snapshot.checking);
}
