use super::*;

const PAST: &str = "2026-10-21";
const TODAY: &str = "2026-11-01";
const FUTURE: &str = "2026-11-02";
const AUTOMATIC_NOTE: &str = "创建历史任务自动完成";

fn input(start: &str, due: &str) -> TaskDraftInput {
    TaskDraftInput {
        item_type: "task".into(), recurring_settings: None, title: "补录历史事项".into(),
        notes: Some("任务备注保留".into()), priority: Some(Priority::Medium),
        earliest_start_date: Some(start.into()), earliest_start_time: Some("09:00".into()),
        due_date: Some(due.into()), due_time: Some("09:30".into()),
        total_workload_minutes: Some(30), remaining_workload_minutes: Some(30),
        field_states_json: "{}".into(), tags: vec!["历史补录".into()], recurrence: None,
    }
}

fn ai_draft(db: &mut Database, kind: &str, target: Option<&str>, input: TaskDraftInput) -> TaskDraftDto {
    let conversation = db.create_ai_conversation(None).unwrap();
    let run = db.start_ai_run(&conversation.id, "整理任务草稿").unwrap();
    let (_, mut drafts) = db.complete_ai_run_with_drafts(&run.run.id, "请确认草稿", vec![AiDraftCreationInput {
        draft_kind: kind.into(), target_task_id: target.map(str::to_owned), input,
    }], "{}").unwrap();
    drafts.remove(0)
}

fn confirm_edit(db: &mut Database, api: &str, task: &TaskDto, draft: &TaskDraftDto) -> AppResult<TaskDto> {
    if api == "manual" {
        db.update_manual_task(&task.id, ManualTaskUpdate {
            title: draft.title.clone(), notes: draft.notes.clone(), priority: Some(Priority::Medium),
            earliest_start_at: legacy_timestamp(draft.earliest_start_date.as_deref(), draft.earliest_start_time.as_deref()),
            due_at: legacy_timestamp(draft.due_date.as_deref(), draft.due_time.as_deref()),
            estimated_minutes: draft.total_workload_minutes,
        })
    } else {
        db.confirm_task_draft(&draft.id, &draft.confirmation_token)
    }
}

fn snapshot(db: &Database) -> Vec<Vec<Vec<String>>> {
    ["tasks", "task_drafts", "daily_plans", "plan_blocks", "task_changes", "task_estimates",
        "task_completion_snapshots", "undo_entries", "tags", "task_tags"].iter().map(|table|
        fact_rows(&db.connection, &format!("SELECT * FROM {table} WHERE ?1 = ?1 ORDER BY rowid"), "all").unwrap()).collect()
}

#[test]
fn historical_single_day_creation_is_completed_once_and_explains_automatic_execution_after_reload() {
    let _clock = TestNow::new("2026-11-01T18:00:00+08:00");
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("historical-create.sqlite");
    let mut db = Database::open(&path).unwrap();
    let draft = db.create_manual_task_draft(input(PAST, PAST)).unwrap();
    assert_eq!(db.count("tasks").unwrap(), 0, "draft autosave is not completion");
    let task = db.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
    assert_eq!(task.status, "done");
    assert_eq!(task.remaining_workload_minutes, Some(0));
    assert_eq!(task.total_workload_minutes, Some(30));
    assert_eq!(task.actual_minutes, 0);
    assert_eq!(task.result_date.as_deref(), Some(PAST));
    assert_eq!(task.notes.as_deref(), Some("任务备注保留"));
    assert_eq!(task.tags, vec!["历史补录"]);
    assert!(task.execution_locked);
    assert!(db.latest_undo().unwrap().is_none(), "historical creation must not advertise a forbidden undo");
    let before = snapshot(&db);
    assert_eq!(db.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap().id, task.id);
    assert_eq!(snapshot(&db), before, "repeated confirmation has no new side effects");
    drop(db);
    let db = Database::open(&path).unwrap();
    let schedule = db.get_day_schedule(PAST).unwrap();
    assert_eq!(schedule.task_blocks.len(), 1);
    let block = &schedule.task_blocks[0];
    assert_eq!(block.task_id, task.id);
    assert_eq!(block.execution_status, "completed");
    assert_eq!(block.task_status, "done");
    assert_eq!(block.starts_at, format!("{PAST}T09:00:00+08:00"));
    assert_eq!(block.ends_at, format!("{PAST}T09:30:00+08:00"));
    assert_eq!(block.execution_note.as_deref(), Some(AUTOMATIC_NOTE));
    assert_eq!(block.actual_minutes, None, "do not invent actual minutes from reservation length");
    assert!(!block.review_required);
    let recorded = DateTime::parse_from_rfc3339(block.execution_captured_at.as_deref().unwrap()).unwrap();
    assert_eq!(recorded.signed_duration_since(clock_now()).num_milliseconds(), 0);
    assert!(db.get_day_schedule(TODAY).unwrap().task_blocks.is_empty());
    let metadata = db.get_task_metadata(&task.id).unwrap();
    assert!(!metadata.completion_backfill_allowed);
    assert!(metadata.history.iter().any(|event| event.kind == "execution"
        && event.plan_date.as_deref() == Some(PAST) && event.status.as_deref() == Some("done")
        && event.note.as_deref() == Some(AUTOMATIC_NOTE) && event.occurred_at == block.execution_captured_at));
}

#[test]
fn historical_multiday_creation_rejects_past_today_and_future_due_dates_for_manual_and_ai_drafts() {
    let _clock = TestNow::new("2026-11-01T18:00:00+08:00");
    for api in ["manual", "ai_draft"] {
        for due in ["2026-10-22", TODAY, FUTURE] {
            let mut db = Database::in_memory().unwrap();
            let draft = if api == "manual" {
                db.create_manual_task_draft(input(PAST, due)).unwrap()
            } else {
                ai_draft(&mut db, "create", None, input(PAST, due))
            };
            let before = snapshot(&db);
            let error = db.confirm_creation_draft(&draft.id, &draft.confirmation_token).unwrap_err();
            assert!(error.to_string().contains("历史日期只允许创建单日任务"), "{api}/{due}");
            assert_eq!(snapshot(&db), before, "{api}/{due}: rejected confirmation must preserve the active draft and all data");
        }
    }
}

#[test]
fn historical_creation_failure_rolls_back_task_block_completion_draft_tags_and_audit_together() {
    for (table, event) in [("tasks", "INSERT"), ("daily_plans", "INSERT"), ("plan_blocks", "INSERT"),
        ("plan_blocks", "UPDATE"), ("task_estimates", "INSERT"), ("task_completion_snapshots", "INSERT"),
        ("task_changes", "INSERT"), ("undo_entries", "INSERT"), ("task_drafts", "UPDATE")] {
        let _clock = TestNow::new("2026-11-01T18:00:00+08:00");
        let mut db = Database::in_memory().unwrap();
        let draft = db.create_manual_task_draft(input(PAST, PAST)).unwrap();
        let before = snapshot(&db);
        db.connection.execute_batch(&format!("CREATE TRIGGER fail_history BEFORE {event} ON {table}
            BEGIN SELECT RAISE(ABORT, 'historical creation failed'); END;")).unwrap();
        assert!(db.confirm_task_draft(&draft.id, &draft.confirmation_token).is_err(), "{table}/{event}");
        assert_eq!(snapshot(&db), before, "{table}/{event}");
        db.connection.execute_batch("DROP TRIGGER fail_history").unwrap();
        assert_eq!(db.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap().status, "done");
    }
}

#[test]
fn historical_creation_completion_cannot_be_cleared_or_changed_through_any_result_api() {
    for action in ["clear", "reopen", "transition", "resolve", "capture", "review"] {
        let _clock = TestNow::new("2026-11-01T18:00:00+08:00");
        let mut db = Database::in_memory().unwrap();
        let draft = db.create_manual_task_draft(input(PAST, PAST)).unwrap();
        let task = db.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
        let block = db.get_day_schedule(PAST).unwrap().task_blocks.remove(0);
        let before = snapshot(&db);
        let result = match action {
            "clear" => db.clear_execution_capture(PAST, &block.id),
            "reopen" => db.reopen_manual_task(&task.id, TODAY).map(|_| ()),
            "transition" => db.transition_manual_task(&task.id, TaskStatus::Open).map(|_| ()),
            "resolve" => db.resolve_task_execution(PAST, TaskExecutionResolutionInput {
                plan_block_id: block.id.clone(), expected_task_updated_at: task.updated_at.clone(),
                outcome: ReviewOutcome::NotStarted, note: None, next_action: None, starts_at: None,
                ends_at: None, remaining_workload_minutes: None,
            }).map(|_| ()),
            "capture" => db.save_execution_capture(PAST, ExecutionCaptureInput {
                plan_block_id: block.id.clone(), outcome: ReviewOutcome::NotStarted, note: None,
            }),
            "review" => db.save_review_entry(PAST, ReviewEntryInput {
                plan_block_id: block.id.clone(), outcome: ReviewOutcome::NotStarted, actual_minutes: None,
                defer_reason: None, notes: None, remaining_workload_minutes: None,
            }).map(|_| ()),
            _ => unreachable!(),
        };
        assert!(result.unwrap_err().to_string().contains("历史完成记录不支持取消"), "{action}");
        assert_eq!(snapshot(&db), before, "{action}");
    }
}

#[test]
fn midnight_locks_completed_task_and_block_immediately_even_with_unexpired_undo_and_grace() {
    for action in ["reopen", "clear", "undo"] {
        let _clock = TestNow::new("2026-10-21T23:59:58+08:00");
        let mut db = Database::in_memory().unwrap();
        let mut form = input(PAST, PAST);
        form.earliest_start_time = Some("23:00".into());
        form.due_time = Some("23:59".into());
        let draft = db.create_manual_task_draft(form).unwrap();
        let task = db.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
        assert_eq!(task.status, "scheduled");
        let block = db.get_day_schedule(PAST).unwrap().task_blocks.remove(0);
        db.complete_task(&task.id, Some(&block.id)).unwrap();
        let undo = db.latest_undo().unwrap().unwrap();
        let before = snapshot(&db);
        let _next = TestNow::new("2026-10-22T00:00:01+08:00");
        let result = match action {
            "reopen" => db.reopen_manual_task(&task.id, "2026-10-22").map(|_| ()),
            "clear" => db.clear_execution_capture(PAST, &block.id),
            "undo" => db.apply_undo(&undo.id).map(|_| ()),
            _ => unreachable!(),
        };
        assert!(result.unwrap_err().to_string().contains("历史完成记录不支持取消"), "{action}");
        assert_eq!(snapshot(&db), before);
    }
}

#[test]
fn ai_historical_creation_uses_same_completion_policy_and_rejects_multiday_without_task_side_effects() {
    let _clock = TestNow::new("2026-11-01T18:00:00+08:00");
    for due in [PAST, "2026-10-22", TODAY, FUTURE] {
        let mut db = Database::in_memory().unwrap();
        let proposal = serde_json::json!({ "proposal_id": Uuid::new_v4().to_string(), "operation": {
            "type": "proposed_task_create", "title": "AI历史补录", "notes": null, "priority": "medium",
            "earliest_start_at": format!("{PAST}T09:00:00+08:00"),
            "due_at": format!("{due}T09:30:00+08:00"), "estimated_minutes": 30, "splittable": false
        }}).to_string();
        let preview = db.preview_ai_proposal(&proposal).unwrap();
        let before = snapshot(&db);
        let result = db.apply_confirmed_ai_proposal(&preview.ai_run_id, &preview.confirmation_token, false);
        if due == PAST {
            let id = result.unwrap().affected_task_ids.remove(0);
            assert_eq!(db.get_task(&id).unwrap().status, "done");
            assert_eq!(db.get_day_schedule(PAST).unwrap().task_blocks[0].execution_note.as_deref(), Some(AUTOMATIC_NOTE));
            assert!(db.latest_undo().unwrap().is_none());
        } else {
            assert!(result.unwrap_err().to_string().contains("历史日期只允许创建单日任务"));
            assert_eq!(snapshot(&db), before);
        }
    }
}

#[test]
fn current_and_future_tasks_cannot_be_moved_into_history_through_manual_or_ai_draft_edits() {
    let _clock = TestNow::new("2026-11-01T18:00:00+08:00");
    for api in ["manual", "ai_draft"] {
        for (start, due) in [(TODAY, TODAY), (TODAY, FUTURE), (FUTURE, FUTURE)] {
            for new_due in [PAST, "2026-10-22", TODAY, FUTURE] {
                let mut db = Database::in_memory().unwrap();
                let draft = db.create_manual_task_draft(input(start, due)).unwrap();
                let task = db.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
                let mut form = input(PAST, new_due);
                form.title = "拒绝后不能留下标题、标签或审计变化".into();
                form.tags = vec!["不能写入的标签".into()];
                let edit = ai_draft(&mut db, "update", Some(&task.id), form);
                let before = snapshot(&db);
                let result = confirm_edit(&mut db, api, &task, &edit);
                assert!(result.unwrap_err().to_string().contains("不能改为历史任务"), "{api}/{start}/{due}->{new_due}");
                assert_eq!(snapshot(&db), before, "{api}/{start}/{due}->{new_due}");
            }
        }
    }
}

#[test]
fn existing_historical_multiday_ranges_survive_reload_content_edits_and_can_move_to_future() {
    for api in ["manual", "ai_draft"] {
        for due in ["2026-10-22", TODAY, FUTURE] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("existing-multiday.sqlite");
            let _clock = TestNow::new("2026-10-20T18:00:00+08:00");
            let mut db = Database::open(&path).unwrap();
            let draft = db.create_manual_task_draft(input(PAST, due)).unwrap();
            let task = db.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
            let before = snapshot(&db);
            drop(db);
            let _next = TestNow::new("2026-11-01T18:00:00+08:00");
            let mut db = Database::open(&path).unwrap();
            assert_eq!(snapshot(&db), before, "reload must not migrate or complete existing {due} range");
            assert_eq!(db.get_task(&task.id).unwrap().status, "open");

            let mut form = input(PAST, due);
            form.title = "保留历史日期范围的正常编辑".into();
            form.notes = Some("允许修改内容和同日内时间".into());
            form.earliest_start_time = Some("10:00".into());
            form.due_time = Some("10:30".into());
            let edit = ai_draft(&mut db, "update", Some(&task.id), form);
            let edited = confirm_edit(&mut db, api, &task, &edit).unwrap();
            assert_eq!(edited.title, "保留历史日期范围的正常编辑");
            assert_eq!(edited.earliest_start_date.as_deref(), Some(PAST));
            assert_eq!(edited.due_date.as_deref(), Some(due));
            assert_eq!(edited.status, "open");
            assert_eq!(edited.remaining_workload_minutes, Some(30));
            assert_eq!(db.count("plan_blocks").unwrap(), 0);

            let rejected = ai_draft(&mut db, "update", Some(&task.id), input("2026-10-20", due));
            let before = snapshot(&db);
            assert!(confirm_edit(&mut db, api, &edited, &rejected).is_err());
            assert_eq!(snapshot(&db), before, "existing history cannot be expanded into a new historical range");

            let future = ai_draft(&mut db, "update", Some(&task.id), input(FUTURE, "2026-11-03"));
            let moved = confirm_edit(&mut db, api, &edited, &future).unwrap();
            assert_eq!(moved.earliest_start_date.as_deref(), Some(FUTURE));
            assert_eq!(moved.due_date.as_deref(), Some("2026-11-03"));
            assert_eq!(moved.status, "open");
            assert_eq!(db.count("plan_blocks").unwrap(), 0, "do not expand future automatic scheduling");
            assert!(fact_rows(&db.connection, "SELECT * FROM task_completion_snapshots WHERE task_id = ?1", &task.id).unwrap().is_empty());
        }
    }
}

#[test]
fn shanghai_midnight_rechecks_draft_creation_and_edits_without_using_the_utc_date() {
    for api in ["manual", "ai_draft"] {
        let _clock = TestNow::new("2026-10-31T15:59:59Z");
        assert_eq!(shanghai_today(), "2026-10-31");
        let mut db = Database::in_memory().unwrap();
        let make_draft = |db: &mut Database, form| if api == "manual" {
            db.create_manual_task_draft(form).unwrap()
        } else {
            ai_draft(db, "create", None, form)
        };
        let allowed = make_draft(&mut db, input("2026-10-31", FUTURE));
        let existing = db.confirm_task_draft(&allowed.id, &allowed.confirmation_token).unwrap();
        assert_eq!(existing.status, "open");
        let stale = make_draft(&mut db, input("2026-10-31", FUTURE));
        let single = make_draft(&mut db, input("2026-10-31", "2026-10-31"));
        let _next = TestNow::new("2026-10-31T16:00:00Z");
        assert_eq!(shanghai_today(), TODAY, "UTC is still October 31 but Shanghai is November 1");
        let before = snapshot(&db);
        assert!(db.confirm_task_draft(&stale.id, &stale.confirmation_token).is_err());
        assert_eq!(snapshot(&db), before);

        let edit = ai_draft(&mut db, "update", Some(&existing.id), input("2026-10-31", "2026-11-03"));
        let before = snapshot(&db);
        assert!(confirm_edit(&mut db, api, &existing, &edit).is_err());
        assert_eq!(snapshot(&db), before);
        let completed = db.confirm_task_draft(&single.id, &single.confirmation_token).unwrap();
        assert_eq!(completed.status, "done");
        assert_eq!(completed.result_date.as_deref(), Some("2026-10-31"));
        assert_eq!(db.get_day_schedule("2026-10-31").unwrap().task_blocks[0].execution_note.as_deref(), Some(AUTOMATIC_NOTE));
        let today = make_draft(&mut db, input(TODAY, FUTURE));
        assert_eq!(db.confirm_task_draft(&today.id, &today.confirmation_token).unwrap().status, "open");
    }
}
