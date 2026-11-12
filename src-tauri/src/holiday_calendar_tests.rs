use super::*;
use std::{io::Write, net::TcpListener, thread};
use serde_json::{json, Value};

fn now() -> DateTime<Utc> { "2026-11-11T00:00:00Z".parse().unwrap() }

// SYNTHETIC TEST DATA ONLY: these dates are not official arrangements.
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
fn cdn(annual: &Annual) -> Value {
    let mut days = annual.holidays.iter().flat_map(|holiday| holiday.dates.iter().map(|date| {
        json!({"name":holiday.name,"date":date,"isOffDay":true})
    })).collect::<Vec<_>>();
    days.extend(annual.makeup_workdays.iter().map(|(date,name)| json!({"name":name,"date":date,"isOffDay":false})));
    json!({"$schema":"https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/schema.json",
        "$id":format!("https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{}.json",annual.year),
        "year":annual.year,"papers":[annual.source_url],"days":days})
}
fn connection() -> Connection {
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch(MIGRATION).unwrap();
    connection
}
fn download(job: UpdateJob, years: &[Annual]) -> AppResult<Downloaded> {
    job.download_with(|path, timeout| {
        assert!(timeout <= TIMEOUT && !timeout.is_zero());
        assert!(path.strip_suffix(".json").unwrap().parse::<i32>().is_ok());
        Ok(years.iter().find(|annual| path == format!("{}.json",annual.year)).map(|annual| serde_json::to_vec(&cdn(annual)).unwrap()))
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
        let mut v=valid.clone(); v[field]=value; variants.push(v);
    }
    for day in ["2027-02-29","2026-01-01","2027-1-01"] {
        let mut v=valid.clone(); v["holidays"][0]["dates"]=json!([day]); variants.push(v);
    }
    let mut v=valid.clone(); v["holidays"][0]["dates"]=json!(["2027-01-01","2027-01-01"]); variants.push(v);
    let mut v=valid.clone(); v["makeupWorkdays"]=json!([["2027-01-01","conflict"]]); variants.push(v);
    for named in ["2027-02-30","2027-01-03"] {
        let mut v=valid.clone(); v["holidays"][0]["namedDate"]=json!(named); variants.push(v);
    }
    let mut v=valid.clone(); v["holidays"][0]["name"]=json!("x".repeat(81)); variants.push(v);
    for v in variants { assert!(Annual::parse(&serde_json::to_vec(&v).unwrap()).is_err(),"accepted {v}"); }
    assert!(Annual::parse(&vec![b' ';BODY_LIMIT+1]).is_err());
    assert!(Annual::parse(b"not json").is_err());
}

#[test]
fn cdn_contract_rejects_wrong_year_sources_dates_duplicate_flags_and_unknown_fields() {
    let valid=cdn(&synthetic(2027,1));
    let mut variants=Vec::new();
    for (field,value) in [("year",json!(2028)),("papers",json!([])),("papers",json!(["https://gov.cn.evil.test/a"])),
        ("papers",json!(["http://www.gov.cn/a"])),("days",json!([])),("extra",json!(true))] {
        let mut v=valid.clone(); v[field]=value; variants.push(v);
    }
    for day in ["2027-02-29","2027-1-01","2028-01-01","2026-11-30","2025-12-31"] {
        let mut v=valid.clone(); v["days"][0]["date"]=json!(day); variants.push(v);
    }
    let mut v=valid.clone(); v["days"][0]["isOffDay"]=json!("true"); variants.push(v);
    let mut v=valid.clone(); v["days"][0]["name"]=json!("invalid\u{1}name"); variants.push(v);
    let mut v=valid.clone(); v["days"].as_array_mut().unwrap().push(valid["days"][0].clone()); variants.push(v);
    let mut v=valid.clone(); v["days"][1]["date"]=v["days"][0]["date"].clone(); variants.push(v);
    let mut v=valid.clone(); v["days"][0]["isOffDay"]=json!(false); variants.push(v);
    for v in variants { assert!(CdnAnnual::parse(&serde_json::to_vec(&v).unwrap(),2027).is_err(),"accepted {v}"); }
    assert!(CdnAnnual::parse(&vec![b' ';BODY_LIMIT+1],2027).is_err());
    assert!(CdnAnnual::parse(b"not json",2027).is_err());
}

#[test]
fn cdn_conversion_preserves_every_2026_workday_and_ordinary_weekends() {
    let old=CalendarState::bundled().snapshot.years.remove(0);
    let mut value=cdn(&old);
    for day in value["days"].as_array_mut().unwrap() {
        if day["date"]=="2026-09-20" { day["name"]=json!("国庆节"); }
    }
    let annual=CdnAnnual::parse(&serde_json::to_vec(&value).unwrap(),2026).unwrap().annual(None,Some(&old),"2026-11-11").unwrap();
    assert_eq!(annual.holidays.iter().map(|holiday|holiday.dates.len()).sum::<usize>(),33);
    assert_eq!(annual.makeup_workdays.len(),6);
    assert!(annual.holidays.iter().any(|holiday|holiday.named_date.as_deref()==Some("2026-01-01")));
    let snapshot=Snapshot { years:vec![annual],..Snapshot::default() };
    let mut day=date("2026-01-01").unwrap();
    while day.year()==2026 {
        assert_eq!(snapshot.workday_on(day),CalendarState::bundled().snapshot.workday_on(day),"{day}");
        day=day.succ_opt().unwrap();
    }
    assert_eq!(snapshot.workday_on(date("2026-01-10").unwrap()),Some(false));
    assert_eq!(snapshot.workday_on(day),None);
}

#[test]
fn cdn_checks_numeric_years_and_all_intermediate_gaps_without_an_index() {
    assert_eq!(BASE,"https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/");
    let mut db=connection(); let mut state=CalendarState::bundled();
    let packets=[synthetic(2027,1),synthetic(2028,1),synthetic(2029,1)];
    let job=state.begin(&db,vec![2029,2029],false,now()).unwrap().unwrap();
    let mut paths=Vec::new();
    let result=job.download_with(|path,_| {
        paths.push(path.to_string());
        Ok(packets.iter().find(|annual|path==format!("{}.json",annual.year)).map(|annual|serde_json::to_vec(&cdn(annual)).unwrap()))
    });
    assert!(state.finish(&mut db,result,now()).last_error.is_none());
    assert_eq!(paths,vec!["2026.json","2027.json","2028.json","2029.json","2030.json"]);
    assert!(state.snapshot.covers(date("2026-12-31").unwrap(),date("2029-01-02").unwrap()));
    assert!(state.begin(&db,vec![2028],false,now()).unwrap().is_none());
    for requested in [vec![1899],vec![2201],vec![2027;302]] {
        assert!(state.begin(&db,requested,true,now()).is_err());
    }
}

#[test]
fn adjacent_notice_updates_december_but_never_claims_coverage_from_spillover_alone() {
    let mut db=connection(); let mut state=CalendarState::bundled();
    let original=state.snapshot.years[0].clone();
    let mut next=cdn(&synthetic(2027,1));
    next["days"].as_array_mut().unwrap().extend([
        json!({"name":"TEST ONLY next notice rest","date":"2026-12-31","isOffDay":true}),
        json!({"name":"TEST ONLY next notice makeup","date":"2026-12-26","isOffDay":false})
    ]);
    let job=state.begin(&db,vec![],true,now()).unwrap().unwrap();
    let result=job.download_with(|path,_|Ok(match path {
        "2026.json"=>Some(serde_json::to_vec(&cdn(&original)).unwrap()),
        "2027.json"=>Some(serde_json::to_vec(&next).unwrap()),_=>None,
    }));
    let snapshot=state.finish(&mut db,result,now());
    assert!(snapshot.last_error.is_none());
    assert_eq!(snapshot.workday_on(date("2026-12-31").unwrap()),Some(false));
    assert_eq!(snapshot.workday_on(date("2026-12-26").unwrap()),Some(true));
    let job=state.begin(&db,vec![],true,now()).unwrap().unwrap();
    assert!(state.finish(&mut db,download(job,&[original]),now()).last_error.is_none());
    assert_eq!(state.snapshot.workday_on(date("2026-12-31").unwrap()),Some(false),"next-file 404 cannot erase known December facts");
    let mut empty=CalendarState::default();
    let job=empty.begin(&db,vec![2026],true,now()).unwrap().unwrap();
    let result=job.download_with(|path,_|Ok((path=="2027.json").then(||serde_json::to_vec(&next).unwrap())));
    let snapshot=empty.finish(&mut db,result,now());
    assert_eq!(snapshot.workday_on(date("2026-12-31").unwrap()),None);
}

#[test]
fn cached_current_file_404_still_applies_explicit_next_notice_dates() {
    let mut db=connection(); let mut state=CalendarState::bundled();
    let mut next=cdn(&synthetic(2027,1));
    next["days"].as_array_mut().unwrap().push(json!({"name":"TEST ONLY next notice","date":"2026-12-31","isOffDay":true}));
    let job=state.begin(&db,vec![2026],true,now()).unwrap().unwrap();
    let result=job.download_with(|path,_|Ok((path=="2027.json").then(||serde_json::to_vec(&next).unwrap())));
    let snapshot=state.finish(&mut db,result,now());
    assert!(snapshot.last_error.is_none());
    assert_eq!(snapshot.workday_on(date("2026-12-31").unwrap()),Some(false));
    assert_eq!(snapshot.workday_on(date("2026-01-04").unwrap()),Some(true),"other cached dates stay intact");
    assert_eq!(snapshot.years.iter().find(|annual|annual.year==2026).unwrap().revision,2);
    assert_eq!(CalendarState::load(&db).unwrap().snapshot,snapshot);
}

#[test]
fn synthetic_download_reopen_offline_and_per_instance_isolation() {
    let root=std::env::var_os("PI_SCRATCH_DIR").or_else(||std::env::var_os("TEMP")).unwrap();
    let directory=tempfile::tempdir_in(root).unwrap(); let path=directory.path().join("holiday-test.sqlite");
    let mut db=Connection::open(&path).unwrap(); db.execute_batch(MIGRATION).unwrap();
    let mut state=CalendarState::load(&db).unwrap();
    let job=state.begin(&db,vec![2027],false,now()).unwrap().unwrap();
    assert!(state.snapshot.checking);
    let snapshot=state.finish(&mut db,download(job,&[synthetic(2027,1)]),now());
    assert!(snapshot.last_error.is_none()); assert!(snapshot.last_success_at.is_some());
    assert_eq!(snapshot.available_years,vec![2026,2027]);
    assert_eq!(snapshot.workday_on(date("2027-01-02").unwrap()),Some(true));
    assert_eq!(CalendarState::bundled().snapshot.years.len(),1); drop(db);
    let mut db=Connection::open(&path).unwrap(); let mut reopened=CalendarState::load(&db).unwrap();
    assert_eq!(reopened.snapshot,snapshot);
    assert!(reopened.begin(&db,vec![2027],false,now()).unwrap().is_none());
    let _job=reopened.begin(&db,vec![2027],true,now()).unwrap().unwrap();
    let offline=reopened.finish(&mut db,Err(invalid("TEST offline")),now());
    assert_eq!(offline.years,snapshot.years); assert!(offline.last_error.unwrap().contains("TEST offline"));
}

#[test]
fn throttle_includes_failures_deduplicates_inflight_and_manual_bypasses() {
    let mut db=connection(); let mut state=CalendarState::bundled();
    let _job=state.begin(&db,vec![2027],false,now()).unwrap().unwrap();
    assert!(state.begin(&db,vec![2028],true,now()).unwrap().is_none());
    state.finish(&mut db,Err(invalid("TEST failure")),now());
    assert!(state.begin(&db,vec![2028],false,now()+chrono::Duration::hours(23)).unwrap().is_none());
    let mut reopened=CalendarState::load(&db).unwrap();
    assert!(reopened.begin(&db,vec![2028],false,now()).unwrap().is_none());
    assert!(reopened.begin(&db,vec![2028],true,now()).unwrap().is_some());
    reopened.finish(&mut db,Err(invalid("TEST failure")),now());
    assert!(reopened.begin(&db,vec![2028],false,now()+chrono::Duration::hours(24)).unwrap().is_some());
}

#[test]
fn changed_cdn_contents_increment_local_revision_and_reordering_does_not() {
    let mut db=connection(); let mut state=CalendarState::bundled();
    let job=state.begin(&db,vec![2027],true,now()).unwrap().unwrap();
    state.finish(&mut db,download(job,&[synthetic(2027,99)]),now());
    let initial=state.snapshot.years.iter().find(|annual|annual.year==2027).unwrap().clone();
    assert_eq!(initial.revision,1,"upstream has no revision; do not copy a fixture or clock value");
    let mut changed=initial.clone(); changed.holidays[0].dates.push("2027-01-04".into());
    let job=state.begin(&db,vec![2027],true,now()).unwrap().unwrap();
    assert!(state.finish(&mut db,download(job,&[changed]),now()).last_error.is_none());
    let updated=state.snapshot.years.iter().find(|annual|annual.year==2027).unwrap().clone();
    assert_eq!(updated.revision,2);
    let mut reordered=cdn(&updated); reordered["days"].as_array_mut().unwrap().reverse();
    let job=state.begin(&db,vec![2027],true,now()+chrono::Duration::days(2)).unwrap().unwrap();
    let result=job.download_with(|path,_|Ok((path=="2027.json").then(||serde_json::to_vec(&reordered).unwrap())));
    assert!(state.finish(&mut db,result,now()).last_error.is_none());
    assert_eq!(CalendarState::load(&db).unwrap().snapshot.years,state.snapshot.years);
    assert_eq!(state.snapshot.years.iter().find(|annual|annual.year==2027).unwrap(),&updated);
}

#[test]
fn missing_year_404_is_not_an_empty_calendar_and_invalid_batch_keeps_all_prior_data() {
    let mut db=connection(); let mut state=CalendarState::bundled();
    let before=state.snapshot.years.clone();
    let job=state.begin(&db,vec![2027],true,now()).unwrap().unwrap();
    let missing=job.download_with(|_,_|Ok(None));
    let snapshot=state.finish(&mut db,missing,now());
    assert!(snapshot.last_error.is_none()); assert_eq!(snapshot.years,before);
    assert!(!snapshot.available_years.contains(&2027));
    let job=state.begin(&db,vec![2028],true,now()).unwrap().unwrap();
    let result=job.download_with(|path,_|Ok(match path {
        "2027.json"=>Some(serde_json::to_vec(&cdn(&synthetic(2027,1))).unwrap()),
        "2028.json"=>Some(b"invalid final packet".to_vec()),_=>None,
    }));
    assert!(result.is_err()); assert_eq!(state.finish(&mut db,result,now()).years,before);
    assert_eq!(CalendarState::load(&db).unwrap().snapshot.years,before);
    assert_eq!(db.query_row("SELECT COUNT(*) FROM holiday_calendar_years",[],|row|row.get::<_,i64>(0)).unwrap(),0);
}

#[test]
fn transaction_failure_rolls_back_packages_success_metadata_and_effective_snapshot() {
    let mut db=connection(); let mut state=CalendarState::bundled();
    let job=state.begin(&db,vec![2028],false,now()).unwrap().unwrap();
    let before=state.snapshot.years.clone();
    db.execute_batch("CREATE TRIGGER fail_holiday_commit BEFORE INSERT ON holiday_calendar_years WHEN NEW.year=2028 BEGIN SELECT RAISE(ABORT,'TEST rollback'); END;").unwrap();
    let result=download(job,&[synthetic(2027,1),synthetic(2028,1)]);
    let after=state.finish(&mut db,result,now());
    assert_eq!(after.years,before); assert!(after.last_error.unwrap().contains("TEST rollback"));
    assert_eq!(after.last_success_at,None);
    assert_eq!(db.query_row("SELECT COUNT(*) FROM holiday_calendar_years",[],|row|row.get::<_,i64>(0)).unwrap(),0);
    assert_eq!(CalendarState::load(&db).unwrap().snapshot.years,before);
}

#[test]
fn old_manifest_metadata_cannot_authorize_a_host_and_valid_caches_survive_corruption() {
    let db=connection(); let state=CalendarState::bundled();
    let old=json!({"snapshot":state.snapshot,"manifest":{"years":[{"path":"https://evil.test/file"}]},"attempted_years":[2027]});
    db.execute("INSERT INTO holiday_calendar_metadata VALUES(1,?1)",[old.to_string()]).unwrap();
    db.execute("INSERT INTO holiday_calendar_years VALUES(2027,?1)",[serde_json::to_string(&synthetic(2027,1)).unwrap()]).unwrap();
    db.execute("INSERT INTO holiday_calendar_years VALUES(2026,'{invalid')",[]).unwrap();
    let mut loaded=CalendarState::load(&db).unwrap();
    assert_eq!(loaded.snapshot.years.len(),2); assert!(loaded.snapshot.last_error.is_some());
    assert_eq!(loaded.snapshot.workday_on(date("2026-01-04").unwrap()),Some(true));
    assert_eq!(db.query_row("SELECT package_json FROM holiday_calendar_years WHERE year=2026",[],|row|row.get::<_,String>(0)).unwrap(),"{invalid");
    let job=loaded.begin(&db,vec![],true,now()).unwrap().unwrap();
    assert!(job.download_with(|path,_| { assert!(path.ends_with(".json")); assert!(!path.contains('/')); Ok(None) }).is_ok());
}

#[test]
fn switching_from_legacy_source_resets_only_network_status_once() {
    let mut db=connection();
    let mut snapshot=CalendarState::bundled().snapshot;
    snapshot.last_attempt_at=Some(now().to_rfc3339());
    snapshot.last_success_at=Some(now().to_rfc3339());
    snapshot.last_error=Some("TEST legacy source HTTP 404".into());
    let metadata=json!({"snapshot":snapshot,"manifest":null,"attempted_years":[2027]});
    db.execute("INSERT INTO holiday_calendar_metadata VALUES(1,?1)",[metadata.to_string()]).unwrap();
    db.execute("INSERT INTO holiday_calendar_years VALUES(2027,?1)",[serde_json::to_string(&synthetic(2027,1)).unwrap()]).unwrap();
    let mut state=CalendarState::load(&db).unwrap();
    assert_eq!(state.snapshot.years.len(),2);
    assert_eq!(state.snapshot.last_attempt_at,None);
    assert_eq!(state.snapshot.last_success_at,None);
    assert_eq!(state.snapshot.last_error,None);
    let job=state.begin(&db,vec![],false,now()).unwrap().expect("old-source throttle must not block CDN startup");
    state.finish(&mut db,download(job,&[synthetic(2027,1)]),now());
    let mut reopened=CalendarState::load(&db).unwrap();
    assert!(reopened.snapshot.last_success_at.is_some());
    assert!(reopened.begin(&db,vec![],false,now()).unwrap().is_none(),"new-source throttle persists after restart");
}

#[test]
fn internal_cache_merge_still_rejects_downgrades_and_revision_reuse() {
    let old=synthetic(2027,2); let mut changed=old.clone(); changed.holidays[0].dates.push("2027-01-04".into());
    let snapshot=Snapshot { years:vec![old],..Snapshot::default() };
    assert!(merge(&snapshot,vec![synthetic(2027,1)]).is_err());
    assert!(merge(&snapshot,vec![changed]).is_err());
}

fn serve(response: Vec<u8>, delay: Duration) -> (String, thread::JoinHandle<()>) {
    let listener=TcpListener::bind("127.0.0.1:0").unwrap();
    let url=format!("http://{}/test-only",listener.local_addr().unwrap());
    let handle=thread::spawn(move || {
        let (mut stream,_)=listener.accept().unwrap();
        let mut buffer=[0;2048]; let _=stream.read(&mut buffer);
        thread::sleep(delay); let _=stream.write_all(&response);
    });
    (url,handle)
}

#[test]
fn real_transport_handles_missing_year_timeout_redirect_http_errors_and_oversize() {
    let client=reqwest::blocking::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).build().unwrap();
    let (url,handle)=serve(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_vec(),Duration::ZERO);
    assert!(fetch_body(&client,&url,Duration::from_secs(2)).unwrap().is_none()); handle.join().unwrap();
    for response in [
        b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n".to_vec(),
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
    let mut db=connection(); let mut state=CalendarState::bundled();
    for error in ["TEST offline","TEST timeout","TEST HTTP 500"] {
        let job=state.begin(&db,vec![2027],true,now()).unwrap().unwrap();
        let result=job.download_with(|_,_|Err(invalid(error)));
        let snapshot=state.finish(&mut db,result,now());
        assert!(snapshot.last_error.unwrap().contains(error)); assert_eq!(snapshot.years.len(),1); assert!(!snapshot.checking);
    }
    let job=state.begin(&db,vec![2027],true,now()).unwrap().unwrap();
    let result=job.download_with(|_,_|Ok(Some(vec![b' ';BODY_LIMIT+1])));
    assert_eq!(state.finish(&mut db,result,now()).years.len(),1);
}

#[test]
fn maximum_year_range_is_bounded_and_fetches_each_numeric_path_once() {
    let db=connection(); let mut state=CalendarState::default();
    let job=state.begin(&db,vec![1900,2200],false,now()).unwrap().unwrap();
    let mut requests=0;
    let result=job.download_with(|path,_| {
        requests+=1; let year=path.strip_suffix(".json").unwrap().parse().unwrap();
        Ok(Some(serde_json::to_vec(&cdn(&synthetic(year,1))).unwrap()))
    }).unwrap();
    assert_eq!(requests,301); assert_eq!(result.years.len(),301);
}

#[test]
fn total_download_deadline_is_shared_across_annual_requests() {
    let db=connection(); let mut state=CalendarState::bundled();
    let job=state.begin(&db,vec![2027],false,now()).unwrap().unwrap();
    let result=job.download_with(|_,remaining| { thread::sleep(remaining+Duration::from_millis(5)); Ok(None) });
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
    let mut db=connection(); let mut state=CalendarState::bundled();
    let job=state.begin(&db,vec![2027],false,now()).unwrap().unwrap();
    db.execute_batch("CREATE TRIGGER fail_metadata BEFORE UPDATE ON holiday_calendar_metadata BEGIN SELECT RAISE(ABORT,'TEST final metadata failure'); END;").unwrap();
    let snapshot=state.finish(&mut db,download(job,&[synthetic(2027,1)]),now());
    assert_eq!(snapshot.years.len(),1); assert!(snapshot.last_success_at.is_none());
    assert!(snapshot.last_error.unwrap().contains("TEST final metadata failure"));
    assert_eq!(db.query_row("SELECT COUNT(*) FROM holiday_calendar_years",[],|row|row.get::<_,i64>(0)).unwrap(),0);
    let reopened=CalendarState::load(&db).unwrap(); assert_eq!(reopened.snapshot.years.len(),1);
    assert!(reopened.snapshot.last_attempt_at.is_some()); assert!(!reopened.snapshot.checking);
}

#[test]
#[ignore = "explicit online CDN verification; no user database"]
fn live_jsdelivr_download_uses_production_parser_and_frontend_wire_contract() {
    let mut db=connection(); let mut state=CalendarState::bundled();
    let job=state.begin(&db,vec![2026,2027],true,Utc::now()).unwrap().unwrap();
    let client=reqwest::blocking::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(TIMEOUT).build().unwrap();
    let mut received=BTreeSet::new();
    let result=job.download_with(|path,remaining| {
        let body=fetch_body(&client,&format!("{BASE}{path}"),remaining)?;
        if body.is_some() { received.insert(path.to_string()); }
        Ok(body)
    });
    assert!(result.is_ok(),"CDN request failed");
    assert!(received.contains("2026.json"),"2026 must be downloaded, not supplied by the bundle");
    assert!(received.contains("2027.json"),"2027 must be downloaded");
    let snapshot=state.finish(&mut db,result,Utc::now());
    assert!(snapshot.last_error.is_none(),"{:?}",snapshot.last_error);
    assert!(snapshot.years.iter().any(|annual|annual.year==2027));
    let calendar=snapshot.years.iter().find(|annual|annual.year==2026).unwrap();
    assert_eq!(calendar.holidays.iter().map(|holiday|holiday.dates.len()).sum::<usize>(),33);
    assert_eq!(calendar.makeup_workdays.len(),6);
    let mut day=date("2026-01-01").unwrap();
    while day.year()==2026 {
        assert_eq!(snapshot.workday_on(day),CalendarState::bundled().snapshot.workday_on(day),"{day}");
        day=day.succ_opt().unwrap();
    }
    assert_eq!(CalendarState::load(&db).unwrap().snapshot,snapshot);
    println!("CDN_LIVE_SNAPSHOT={}",serde_json::to_string(&snapshot).unwrap());
}
