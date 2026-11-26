use super::*;

const FIRST: &str = "2026-11-06";
const MIDDLE: &str = "2026-11-07";
const LAST: &str = "2026-11-08";

fn input(total: Option<i64>) -> TaskDraftInput {
    TaskDraftInput {
        item_type: "task".into(), recurring_settings: None, title: "跨日自动安排".into(),
        notes: None, priority: Some(Priority::Medium),
        earliest_start_date: Some(FIRST.into()), earliest_start_time: Some("09:00".into()),
        due_date: Some(LAST.into()), due_time: Some("18:00".into()),
        total_workload_minutes: total, remaining_workload_minutes: None,
        field_states_json: "{}".into(), tags: vec![], recurrence: None,
    }
}

fn create(db: &mut Database, input: TaskDraftInput) -> TaskDto {
    let draft = db.create_manual_task_draft(input).unwrap();
    db.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap()
}

#[test]
fn cross_day_creation_schedules_inclusive_days_and_retry_is_idempotent() {
    let _clock = TestNow::new("2026-11-06T08:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    db.connection.execute("DELETE FROM availability_settings", []).unwrap();
    let draft = db.create_manual_task_draft(input(Some(360))).unwrap();
    assert_eq!(db.count("plan_blocks").unwrap(), 0, "草稿不生成正式安排");
    let task = db.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
    assert_eq!(task.status, "scheduled");
    assert_eq!(task.reserved_minutes, 360);
    assert_eq!(task.remaining_workload_minutes, Some(360));
    assert_eq!(task.scheduled_dates, vec![FIRST, MIDDLE, LAST]);
    let mut ids = Vec::new();
    for date in [FIRST, MIDDLE, LAST] {
        let schedule = db.get_day_schedule(date).unwrap();
        assert_eq!(schedule.task_blocks.len(), 1, "包含首尾日和周末");
        let block = &schedule.task_blocks[0];
        assert_eq!(block.starts_at, format!("{date}T09:00:00+08:00"));
        assert_eq!(block.ends_at, format!("{date}T11:00:00+08:00"));
        ids.push(block.id.clone());
    }
    db.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap();
    assert_eq!(db.count("plan_blocks").unwrap(), 3);
    for (date, id) in [FIRST, MIDDLE, LAST].into_iter().zip(ids) {
        assert_eq!(db.get_day_schedule(date).unwrap().task_blocks[0].id, id);
    }
    let undo = db.latest_undo().unwrap().unwrap();
    db.apply_undo(&undo.id).unwrap();
    assert_eq!(db.get_task(&task.id).unwrap().status, "deleted");
    assert_eq!(db.count("plan_blocks").unwrap(), 0);
}

#[test]
fn cross_day_creation_respects_first_and_last_time_boundaries() {
    let _clock = TestNow::new("2026-11-06T08:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    db.connection.execute("UPDATE availability_settings SET workday_start = 'invalid', workday_end = '' WHERE id = 1", []).unwrap();
    assert!(db.get_availability_settings().is_ok());
    let mut task_input = input(Some(360));
    task_input.earliest_start_time = Some("23:30".into());
    task_input.due_time = Some("01:00".into());
    let task = create(&mut db, task_input);
    let first = db.get_day_schedule(FIRST).unwrap().task_blocks.remove(0);
    let last = db.get_day_schedule(LAST).unwrap().task_blocks.remove(0);
    assert_eq!(first.starts_at, format!("{FIRST}T23:30:00+08:00"));
    assert_eq!(first.ends_at, format!("{MIDDLE}T00:00:00+08:00"));
    assert_eq!(last.starts_at, format!("{LAST}T00:00:00+08:00"));
    assert_eq!(last.ends_at, format!("{LAST}T01:00:00+08:00"));
    assert_eq!(task.reserved_minutes, 210, "边界缩短的投入仍待安排");
    assert_eq!(task.remaining_workload_minutes, Some(360));
}

#[test]
fn cross_day_creation_skips_too_short_boundaries_and_never_exceeds_remaining_work() {
    let _clock = TestNow::new("2026-11-06T08:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let mut task_input = input(Some(360));
    task_input.earliest_start_time = Some("23:50".into());
    task_input.due_time = Some("00:10".into());
    task_input.remaining_workload_minutes = Some(180);
    let task = create(&mut db, task_input);
    assert!(db.get_day_schedule(FIRST).unwrap().task_blocks.is_empty());
    assert!(db.get_day_schedule(LAST).unwrap().task_blocks.is_empty());
    let block = db.get_day_schedule(MIDDLE).unwrap().task_blocks.remove(0);
    assert_eq!(block.starts_at, format!("{MIDDLE}T09:00:00+08:00"));
    assert_eq!(block.ends_at, format!("{MIDDLE}T10:00:00+08:00"));
    assert_eq!(task.reserved_minutes, 60);
}

#[test]
fn cross_day_creation_distributes_integer_remainder_and_allows_a_full_day() {
    let _clock = TestNow::new("2026-11-06T08:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let task = create(&mut db, input(Some(181)));
    assert_eq!(task.reserved_minutes, 181);
    assert_eq!(db.get_day_schedule(FIRST).unwrap().task_blocks[0].ends_at, format!("{FIRST}T10:01:00+08:00"));
    let mut full_day = input(Some(4320));
    full_day.earliest_start_time = Some("00:00".into());
    full_day.due_time = Some("23:59".into());
    let task = create(&mut db, full_day);
    assert_eq!(task.reserved_minutes, 4319);
    let schedule = db.get_day_schedule(MIDDLE).unwrap();
    let block = schedule.task_blocks.iter().find(|block| block.task_id == task.id).unwrap();
    assert_eq!(block.starts_at, format!("{MIDDLE}T00:00:00+08:00"));
    assert_eq!(block.ends_at, format!("{LAST}T00:00:00+08:00"));
}

#[test]
fn cross_day_creation_reuses_plans_and_merges_into_current_drafts_without_losing_other_edits() {
    let _clock = TestNow::new("2026-11-06T08:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let mut other_input = input(Some(90));
    other_input.due_date = Some(FIRST.into());
    other_input.due_time = Some("10:30".into());
    let other = create(&mut db, other_input);
    let original = db.get_day_schedule(FIRST).unwrap();
    let preview = db.start_manual_plan_draft(FIRST).unwrap();
    let mut blocks = preview.blocks;
    blocks[0].starts_at = format!("{FIRST}T14:00:00+08:00");
    blocks[0].ends_at = format!("{FIRST}T15:30:00+08:00");
    let old = db.update_rule_plan_draft(&preview.preview_id, preview.version, blocks, preview.unscheduled).unwrap();
    db.start_manual_plan_draft(MIDDLE).unwrap();
    let task = create(&mut db, input(Some(180)));
    let schedule = db.get_day_schedule(FIRST).unwrap();
    assert_eq!(schedule.plan_id, original.plan_id);
    assert_eq!(schedule.task_blocks.len(), 2, "允许与其他任务重叠");
    assert_eq!(schedule.task_blocks.iter().find(|block| block.task_id == other.id).unwrap().id, original.task_blocks[0].id);
    let refreshed = db.get_rule_plan_draft(FIRST).unwrap().unwrap();
    assert_eq!(refreshed.blocks.len(), 2);
    assert_eq!(refreshed.blocks.iter().find(|block| block.task_id == other.id).unwrap().starts_at, format!("{FIRST}T14:00:00+08:00"));
    assert!(refreshed.blocks.iter().any(|block| block.task_id == task.id));
    assert!(db.get_rule_plan_draft(MIDDLE).unwrap().unwrap().blocks.iter().any(|block| block.task_id == task.id));
    assert!(db.confirm_rule_based_plan(old).is_err(), "旧草案不能覆盖新安排");
    db.confirm_rule_based_plan(refreshed).unwrap();
    assert_eq!(db.get_day_schedule(FIRST).unwrap().task_blocks.len(), 2);
    assert_eq!(db.get_task(&task.id).unwrap().reserved_minutes, 180);
}

#[test]
fn cross_day_ai_creation_uses_same_scheduling_and_update_does_not_recreate_removed_blocks() {
    let _clock = TestNow::new("2026-11-06T08:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let conversation = db.create_ai_conversation(None).unwrap();
    let run = db.start_ai_run(&conversation.id, "安排跨日任务").unwrap();
    let (_, drafts) = db.complete_ai_run_with_drafts(&run.run.id, "请确认", vec![AiDraftCreationInput {
        draft_kind: "create".into(), target_task_id: None, input: input(Some(180)),
    }], "{}").unwrap();
    let ConfirmedCreation::Task(task) = db.confirm_creation_draft(&drafts[0].id, &drafts[0].confirmation_token).unwrap() else { panic!("expected task") };
    assert_eq!(task.status, "scheduled");
    assert_eq!(task.reserved_minutes, 180);
    let block = db.get_day_schedule(MIDDLE).unwrap().task_blocks.remove(0);
    db.remove_plan_block(PlanBlockRemove { plan_date: MIDDLE.into(), block_id: block.id,
        expected_starts_at: block.starts_at, expected_ends_at: block.ends_at }).unwrap();
    db.update_manual_task(&task.id, ManualTaskUpdate { title: "只改标题".into(), notes: None,
        priority: Some(Priority::Medium), earliest_start_at: task.earliest_start_at,
        due_at: task.due_at, estimated_minutes: task.estimated_minutes }).unwrap();
    assert!(db.get_day_schedule(MIDDLE).unwrap().task_blocks.is_empty());
    assert_eq!(db.get_task(&task.id).unwrap().reserved_minutes, 120);
}

#[test]
fn cross_day_creation_failure_rolls_back_task_blocks_plans_and_confirmation() {
    let _clock = TestNow::new("2026-11-06T08:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let draft = db.create_manual_task_draft(input(Some(180))).unwrap();
    db.connection.execute_batch("CREATE TRIGGER fail_second_day BEFORE INSERT ON plan_blocks
        WHEN NEW.starts_at LIKE '2026-11-07%' BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
    assert!(db.confirm_task_draft(&draft.id, &draft.confirmation_token).is_err());
    assert_eq!(db.count("tasks").unwrap(), 0);
    assert_eq!(db.count("daily_plans").unwrap(), 0);
    assert_eq!(db.count("plan_blocks").unwrap(), 0);
    assert_eq!(db.list_task_drafts(false).unwrap()[0].status, "active");
    db.connection.execute_batch("DROP TRIGGER fail_second_day;").unwrap();
    assert_eq!(db.confirm_task_draft(&draft.id, &draft.confirmation_token).unwrap().reserved_minutes, 180);
}

#[test]
fn cross_day_timed_requires_daily_minimum_while_untimed_confirms_scheduled_without_blocks() {
    let _clock = TestNow::new("2026-11-06T08:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    for total in [None, Some(30), Some(44)] {
        let draft = db.create_manual_task_draft(input(total)).unwrap();
        assert_eq!(draft.validation_status, "needs_confirmation");
        assert!(db.confirm_task_draft(&draft.id, &draft.confirmation_token).is_err());
    }
    let mut impossible_window = input(Some(60));
    impossible_window.due_date = Some(MIDDLE.into());
    impossible_window.earliest_start_time = Some("23:50".into());
    impossible_window.due_time = Some("00:10".into());
    let bad_draft = db.create_manual_task_draft(impossible_window).unwrap();
    assert_eq!(bad_draft.validation_status, "needs_confirmation");
    assert!(db.confirm_task_draft(&bad_draft.id, &bad_draft.confirmation_token).is_err());

    let minimum = create(&mut db, input(Some(45)));
    assert_eq!(minimum.status, "scheduled");
    assert_eq!(minimum.reserved_minutes, 45);
    assert_eq!(minimum.scheduled_dates, vec![FIRST, MIDDLE, LAST]);

    let mut untimed_input = input(Some(90));
    untimed_input.earliest_start_time = None;
    untimed_input.due_time = None;
    let untimed_draft = db.create_manual_task_draft(untimed_input).unwrap();
    assert_eq!(untimed_draft.validation_status, "valid");
    let untimed = db.confirm_task_draft(&untimed_draft.id, &untimed_draft.confirmation_token).unwrap();
    assert_eq!(untimed.status, "scheduled");
    assert_eq!(untimed.reserved_minutes, 0);
    assert_eq!(untimed.total_workload_minutes, None);
    assert_eq!(untimed.remaining_workload_minutes, None);

    let timed = db.update_manual_task_with_schedule(&untimed.id, ManualTaskCommandUpdate {
        title: untimed.title.clone(), notes: None, priority: Some(Priority::Medium),
        earliest_start_at: Some(format!("{FIRST}T09:00:00+08:00")),
        due_at: Some(format!("{LAST}T18:00:00+08:00")),
        earliest_start_date: Some(FIRST.into()), due_date: Some(LAST.into()),
        estimated_minutes: Some(180),
    }, None).unwrap();
    assert_eq!(timed.status, "scheduled");
    assert_eq!(timed.reserved_minutes, 180);
    assert_eq!(timed.scheduled_dates, vec![FIRST, MIDDLE, LAST]);
    assert_eq!(db.count("plan_blocks").unwrap(), 6);

    let reverted_untimed = db.update_manual_task_with_schedule(&timed.id, ManualTaskCommandUpdate {
        title: timed.title.clone(), notes: None, priority: Some(Priority::Medium),
        earliest_start_at: None, due_at: None,
        earliest_start_date: Some(FIRST.into()), due_date: Some(LAST.into()),
        estimated_minutes: Some(180),
    }, None).unwrap();
    assert_eq!(reverted_untimed.status, "scheduled");
    assert_eq!(reverted_untimed.reserved_minutes, 0);
    assert_eq!(reverted_untimed.total_workload_minutes, None);
    assert_eq!(reverted_untimed.remaining_workload_minutes, None);
    assert!(reverted_untimed.scheduled_dates.is_empty());
    assert_eq!(db.count("plan_blocks").unwrap(), 3);

    let mut historical = input(Some(180));
    historical.earliest_start_date = Some("2026-11-04".into());
    let draft = db.create_manual_task_draft(historical).unwrap();
    assert!(db.confirm_task_draft(&draft.id, &draft.confirmation_token).is_err());
    assert_eq!(db.count("plan_blocks").unwrap(), 3);
}

#[test]
fn auto_scheduled_cross_day_only_completes_after_all_daily_blocks_and_execution_prevents_creation_undo() {
    let _clock = TestNow::new("2026-11-06T18:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let task = create(&mut db, input(Some(180)));
    let undo = db.latest_undo().unwrap().unwrap();
    for date in [FIRST, MIDDLE, LAST] {
        let _day = TestNow::new(&format!("{date}T18:00:00+08:00"));
        let block = db.get_day_schedule(date).unwrap().task_blocks.remove(0);
        db.save_execution_capture(date, ExecutionCaptureInput {
            plan_block_id: block.id, outcome: Some(ReviewOutcome::Completed), note: None,
        }).unwrap();
        assert_eq!(db.get_task(&task.id).unwrap().status == "done", date == LAST);
        assert!(db.apply_undo(&undo.id).is_err(), "执行后不能撤销创建");
    }
}

#[test]
fn legacy_ai_proposal_creation_also_schedules_cross_day_blocks() {
    let _clock = TestNow::new("2026-11-06T08:00:00+08:00");
    let mut db = Database::in_memory().unwrap();
    let transaction = db.connection.transaction().unwrap();
    let result = apply_operation(&transaction, &AiOperation::ProposedTaskCreate {
        title: "AI 跨日任务".into(), notes: None, priority: Some(Priority::Medium),
        earliest_start_at: Some(format!("{FIRST}T09:00:00+08:00")),
        due_at: Some(format!("{LAST}T18:00:00+08:00")), estimated_minutes: Some(180), splittable: Some(true),
    }, false).unwrap();
    transaction.commit().unwrap();
    let task = db.get_task(&result.affected_task_ids[0]).unwrap();
    assert_eq!(task.reserved_minutes, 180);
    assert_eq!(task.scheduled_dates, vec![FIRST, MIDDLE, LAST]);
}
