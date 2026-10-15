#![recursion_limit = "256"]

mod ai;
mod database;
mod domain;
mod error;

#[cfg(windows)]
mod taskbar_icon;

#[cfg(test)]
mod logo_test;

use std::{fs, sync::Mutex, thread, time::Duration};

use database::{
    AiConnectionSettingsDto, AiConnectionSettingsInput, AiConversationDto, AiMessageDto, AiRunDto,
    ApplyResult, AvailabilitySettings, CalendarEventDto, Database, DayScheduleDto, ExecutionCaptureInput,
    ManualCalendarEventInput, ManualTaskUpdate, PlanBlockTimeUpdate, PlanBlockRemove, PlanTaskInclude, ProposalPreview, RulePlanBlock, RulePlanPreview,
    RecurringItemDto, RecurringItemInput, RecurringOccurrenceDto, RecurringOccurrenceReviewInput,
    TaskDraftDto, ReviewEntryDto, ReviewEntryInput, TaskDraftInput, TaskDto, TaskMetadataDto,
    UndoEntryDto, UnscheduledTask, purge_expired_deleted_items,
};
use domain::TaskStatus;
use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, State, Window, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;

struct AppState {
    database: Mutex<Database>,
}

#[derive(Debug, Serialize)]
struct AiAssistantResult {
    run: AiRunDto,
    drafts: Vec<TaskDraftDto>,
    proposal: Option<ProposalPreview>,
}

fn with_database<T>(state: &State<'_, AppState>, operation: impl FnOnce(&mut Database) -> crate::error::AppResult<T>) -> Result<T, String> {
    let mut database = state.database.lock().map_err(|_| "数据库锁不可用，请重试".to_string())?;
    operation(&mut database).map_err(|error| error.to_string())
}

#[tauri::command]
fn create_manual_task_draft(
    state: State<'_, AppState>,
    input: TaskDraftInput,
) -> Result<TaskDraftDto, String> {
    with_database(&state, |database| database.create_manual_task_draft(input))
}

#[tauri::command]
fn save_task_draft(
    state: State<'_, AppState>,
    draft_id: String,
    expected_version: i64,
    input: TaskDraftInput,
) -> Result<TaskDraftDto, String> {
    with_database(&state, |database| database.save_task_draft(&draft_id, expected_version, input))
}

#[tauri::command]
fn list_task_drafts(
    state: State<'_, AppState>,
    include_discarded: bool,
) -> Result<Vec<TaskDraftDto>, String> {
    with_database(&state, |database| database.list_task_drafts(include_discarded))
}

#[tauri::command]
fn confirm_task_draft(
    state: State<'_, AppState>,
    draft_id: String,
    confirmation_token: String,
) -> Result<TaskDto, String> {
    with_database(&state, |database| database.confirm_task_draft(&draft_id, &confirmation_token))
}

#[tauri::command]
fn confirm_creation_draft(state: State<'_, AppState>, draft_id: String, confirmation_token: String) -> Result<database::ConfirmedCreation, String> {
    with_database(&state, |database| database.confirm_creation_draft(&draft_id, &confirmation_token))
}

#[tauri::command]
fn import_legacy_recurring_draft(state: State<'_, AppState>, input: TaskDraftInput) -> Result<TaskDraftDto, String> {
    with_database(&state, |database| database.import_legacy_recurring_draft(input))
}

#[tauri::command]
fn discard_task_draft(
    state: State<'_, AppState>,
    draft_id: String,
    expected_version: i64,
) -> Result<(), String> {
    with_database(&state, |database| database.discard_task_draft(&draft_id, expected_version))
}

#[tauri::command]
fn list_tasks(
    state: State<'_, AppState>,
    include_deleted: bool,
    search: Option<String>,
) -> Result<Vec<TaskDto>, String> {
    with_database(&state, |database| database.list_tasks(include_deleted, search.as_deref()))
}

#[tauri::command]
fn create_recurring_item(
    state: State<'_, AppState>,
    input: RecurringItemInput,
) -> Result<RecurringItemDto, String> {
    with_database(&state, |database| database.create_recurring_item(input))
}

#[tauri::command]
fn list_recurring_items(
    state: State<'_, AppState>,
    include_ended: bool,
    include_deleted: bool,
) -> Result<Vec<RecurringItemDto>, String> {
    with_database(&state, |database| database.list_recurring_items(include_ended, include_deleted))
}

#[tauri::command]
fn update_recurring_item(
    state: State<'_, AppState>,
    item_id: String,
    input: RecurringItemInput,
) -> Result<RecurringItemDto, String> {
    with_database(&state, |database| database.update_recurring_item(&item_id, input))
}

#[tauri::command]
fn set_recurring_item_status(
    state: State<'_, AppState>,
    item_id: String,
    status: String,
) -> Result<RecurringItemDto, String> {
    with_database(&state, |database| database.set_recurring_item_status(&item_id, &status))
}

#[tauri::command]
fn soft_delete_recurring_item(
    state: State<'_, AppState>,
    item_id: String,
    confirmed: bool,
) -> Result<(), String> {
    with_database(&state, |database| database.soft_delete_recurring_item(&item_id, confirmed))
}

#[tauri::command]
fn restore_recurring_item(state: State<'_, AppState>, item_id: String) -> Result<(), String> {
    with_database(&state, |database| database.restore_recurring_item(&item_id))
}

#[tauri::command]
fn permanently_delete_recurring_item(
    state: State<'_, AppState>,
    item_id: String,
    confirmed: bool,
) -> Result<(), String> {
    with_database(&state, |database| database.permanently_delete_recurring_item(&item_id, confirmed))
}

#[tauri::command]
fn list_recurring_occurrences(
    state: State<'_, AppState>,
    occurrence_date: String,
) -> Result<Vec<RecurringOccurrenceDto>, String> {
    with_database(&state, |database| database.list_recurring_occurrences(&occurrence_date))
}

#[tauri::command]
fn save_recurring_occurrence_review(
    state: State<'_, AppState>,
    occurrence_id: String,
    input: RecurringOccurrenceReviewInput,
) -> Result<RecurringOccurrenceDto, String> {
    with_database(&state, |database| database.save_recurring_occurrence_review(&occurrence_id, input))
}

#[tauri::command]
fn get_task(state: State<'_, AppState>, task_id: String) -> Result<TaskDto, String> {
    with_database(&state, |database| database.get_task(&task_id))
}

#[tauri::command]
fn get_task_metadata(state: State<'_, AppState>, task_id: String) -> Result<TaskMetadataDto, String> {
    with_database(&state, |database| database.get_task_metadata(&task_id))
}

#[tauri::command]
fn set_task_tags(
    state: State<'_, AppState>,
    task_id: String,
    tags: Vec<String>,
) -> Result<TaskMetadataDto, String> {
    with_database(&state, |database| database.set_task_tags(&task_id, tags))
}

#[tauri::command]
fn update_recurring_task(
    state: State<'_, AppState>,
    task_id: String,
    input: TaskDraftInput,
    scope: String,
) -> Result<TaskDto, String> {
    with_database(&state, |database| database.update_recurring_task(&task_id, input, &scope))
}

#[tauri::command]
fn list_tags(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    with_database(&state, |database| database.list_tags())
}

#[tauri::command]
fn latest_undo(state: State<'_, AppState>) -> Result<Option<UndoEntryDto>, String> {
    with_database(&state, |database| database.latest_undo())
}

#[tauri::command]
fn apply_undo(state: State<'_, AppState>, undo_id: String) -> Result<UndoEntryDto, String> {
    with_database(&state, |database| database.apply_undo(&undo_id))
}

#[tauri::command]
fn get_ui_setting(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    with_database(&state, |database| database.get_ui_setting(&key))
}

#[tauri::command]
fn set_ui_setting(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    with_database(&state, |database| database.set_ui_setting(&key, &value))
}

#[tauri::command]
fn get_ai_connection_settings(state: State<'_, AppState>) -> Result<AiConnectionSettingsDto, String> {
    with_database(&state, |database| database.get_ai_connection_settings())
}

#[tauri::command]
fn save_ai_connection_settings(
    state: State<'_, AppState>,
    input: AiConnectionSettingsInput,
) -> Result<AiConnectionSettingsDto, String> {
    with_database(&state, |database| database.save_ai_connection_settings(input))
}

#[tauri::command]
fn test_ai_connection(state: State<'_, AppState>) -> Result<String, String> {
    let settings = with_database(&state, |database| database.load_ai_connection_settings())?;
    ai::test_connection(&settings).map_err(|error| error.to_string())
}

#[tauri::command]
fn create_ai_conversation(
    state: State<'_, AppState>,
    title: Option<String>,
) -> Result<AiConversationDto, String> {
    with_database(&state, |database| database.create_ai_conversation(title))
}

#[tauri::command]
fn list_ai_conversations(
    state: State<'_, AppState>,
    include_archived: bool,
    search: Option<String>,
) -> Result<Vec<AiConversationDto>, String> {
    with_database(&state, |database| database.list_ai_conversations(include_archived, search.as_deref()))
}

#[tauri::command]
fn rename_ai_conversation(
    state: State<'_, AppState>,
    conversation_id: String,
    title: String,
) -> Result<AiConversationDto, String> {
    with_database(&state, |database| database.rename_ai_conversation(&conversation_id, &title))
}

#[tauri::command]
fn set_ai_conversation_archived(
    state: State<'_, AppState>,
    conversation_id: String,
    archived: bool,
) -> Result<AiConversationDto, String> {
    with_database(&state, |database| database.set_ai_conversation_archived(&conversation_id, archived))
}

#[tauri::command]
fn permanently_delete_ai_conversation(
    state: State<'_, AppState>,
    conversation_id: String,
    confirmed: bool,
) -> Result<(), String> {
    with_database(&state, |database| database.permanently_delete_ai_conversation(&conversation_id, confirmed))
}

#[tauri::command]
fn list_ai_messages(
    state: State<'_, AppState>,
    conversation_id: String,
    limit: i64,
) -> Result<Vec<AiMessageDto>, String> {
    with_database(&state, |database| database.list_ai_messages(&conversation_id, limit))
}

#[tauri::command]
fn run_ai_assistant(
    state: State<'_, AppState>,
    conversation_id: String,
    prompt: String,
) -> Result<AiAssistantResult, String> {
    let (settings, context) = with_database(&state, |database| {
        let settings = database.load_ai_connection_settings()?;
        let context = database.start_ai_run(&conversation_id, &prompt)?;
        Ok((settings, context))
    })?;
    let run_id = context.run.id.clone();
    let generated = ai::call_task_assistant(&settings, &context.messages, &context.task_candidates);
    match generated {
        Ok((result, structured_json)) => {
            let assistant_message = result.assistant_message;
            let drafts = result.drafts.into_iter().map(|draft| draft.into_creation_input()).collect();
            let proposal = result.proposal;
            let (run, drafts) = with_database(&state, |database| {
                database.complete_ai_run_with_drafts(&run_id, &assistant_message, drafts, &structured_json)
            })?;
            let proposal = proposal.map(|proposal| with_database(&state, |database| {
                let preview = database.preview_ai_proposal(&serde_json::to_string(&proposal)?)?;
                database.attach_ai_proposal_to_conversation(&preview.ai_run_id, &conversation_id)?;
                Ok(preview)
            })).transpose()?;
            Ok(AiAssistantResult { run, drafts, proposal })
        }
        Err(error) => {
            let message = error.to_string();
            let _ = with_database(&state, |database| database.fail_ai_run(&run_id, &message));
            Err(message)
        }
    }
}

#[tauri::command]
fn start_ai_assistant(
    state: State<'_, AppState>,
    conversation_id: String,
    prompt: String,
) -> Result<AiRunDto, String> {
    with_database(&state, |database| database.start_ai_run(&conversation_id, &prompt).map(|context| context.run))
}

#[tauri::command]
fn complete_ai_assistant(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<AiAssistantResult, String> {
    let (settings, context) = with_database(&state, |database| {
        let settings = database.load_ai_connection_settings()?;
        let context = database.get_ai_run_context(&run_id)?;
        if !matches!(context.run.run_status.as_str(), "pending" | "streaming") {
            return Err(crate::error::AppError::Domain("这次分析已经停止或结束".into()));
        }
        Ok((settings, context))
    })?;
    let conversation_id = context.run.conversation_id.clone();
    let generated = ai::call_task_assistant(&settings, &context.messages, &context.task_candidates);
    match generated {
        Ok((result, structured_json)) => {
            let assistant_message = result.assistant_message;
            let drafts = result.drafts.into_iter().map(|draft| draft.into_creation_input()).collect();
            let proposal = result.proposal;
            let (run, drafts) = with_database(&state, |database| {
                database.complete_ai_run_with_drafts(&run_id, &assistant_message, drafts, &structured_json)
            })?;
            let proposal = proposal.map(|proposal| with_database(&state, |database| {
                let preview = database.preview_ai_proposal(&serde_json::to_string(&proposal)?)?;
                database.attach_ai_proposal_to_conversation(&preview.ai_run_id, &conversation_id)?;
                Ok(preview)
            })).transpose()?;
            Ok(AiAssistantResult { run, drafts, proposal })
        }
        Err(error) => {
            let message = error.to_string();
            let _ = with_database(&state, |database| database.fail_ai_run(&run_id, &message));
            Err(message)
        }
    }
}

#[tauri::command]
fn list_ai_conversation_proposals(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<ProposalPreview>, String> {
    with_database(&state, |database| database.list_ai_conversation_proposals(&conversation_id))
}

#[tauri::command]
fn stop_ai_run(state: State<'_, AppState>, run_id: String) -> Result<AiRunDto, String> {
    with_database(&state, |database| database.stop_ai_run(&run_id))
}

#[tauri::command]
fn get_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|error| error.to_string())
}

#[tauri::command]
fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<bool, String> {
    if enabled { app.autolaunch().enable() } else { app.autolaunch().disable() }
        .map_err(|error| error.to_string())?;
    app.autolaunch().is_enabled().map_err(|error| error.to_string())
}

#[tauri::command]
fn set_global_shortcut(
    app: AppHandle,
    state: State<'_, AppState>,
    shortcut: String,
) -> Result<String, String> {
    let shortcut = shortcut.trim();
    if shortcut.is_empty() || shortcut.chars().count() > 80 {
        return Err("全局快捷键不能为空且不能超过 80 个字符".into());
    }
    app.global_shortcut().unregister_all().map_err(|error| error.to_string())?;
    app.global_shortcut().register(shortcut).map_err(|error| error.to_string())?;
    with_database(&state, |database| database.set_ui_setting("ui.desktop.shortcut", shortcut))?;
    Ok(shortcut.to_owned())
}

#[tauri::command]
fn send_test_notification(app: AppHandle) -> Result<(), String> {
    app.notification().builder()
        .title("今序 · Dayweave 提醒可用")
        .body("这是一条本机 Windows 通知测试，不会调用 AI。")
        .show()
        .map_err(|error| error.to_string())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn app_logo(mode: &str) -> Result<tauri::image::Image<'static>, String> {
    let rgba: &'static [u8] = match mode {
        "light" => include_bytes!("../icons/logo-light.rgba"),
        "dark" => include_bytes!("../icons/logo-dark.rgba"),
        _ => return Err("不支持的明暗模式".into()),
    };
    Ok(tauri::image::Image::new(rgba, 128, 128))
}

#[tauri::command]
fn set_app_window_title(window: tauri::WebviewWindow, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_app_logo_mode(app: AppHandle, mode: String) -> Result<(), String> {
    let icon = app_logo(&mode)?;
    if let Some(window) = app.get_webview_window("main") {
        window.set_icon(icon.clone()).map_err(|error| error.to_string())?;
        // Tauri's Windows set_icon updates ICON_SMALL only; the taskbar uses ICON_BIG.
        #[cfg(windows)]
        {
            let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
            let taskbar_app = app.clone();
            window.run_on_main_thread(move || {
                taskbar_app.state::<taskbar_icon::TaskbarIcons>().set_for_window(hwnd, &mode);
            }).map_err(|error| error.to_string())?;
        }
    }
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_icon(Some(icon)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示今序 · Dayweave", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("今序 · Dayweave")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() { builder = builder.icon(icon); }
    builder.build(app)?;
    Ok(())
}

fn launch_reminder_worker(app: AppHandle) {
    thread::spawn(move || loop {
        let local = chrono::Utc::now().with_timezone(&chrono::FixedOffset::east_opt(8 * 3600).expect("fixed offset"));
        let date = local.format("%Y-%m-%d").to_string();
        let minute = local.format("%H:%M").to_string();
        let (title, body, should_notify, task_blocks) = if let Some(state) = app.try_state::<AppState>() {
            match state.database.lock() {
                Ok(mut database) => {
                    let evening_enabled = database.get_ui_setting("ui.reminder.evening_enabled").ok().flatten().as_deref() != Some("false");
                    let evening_time = database.get_ui_setting("ui.reminder.evening_time").ok().flatten().unwrap_or_else(|| "21:30".into());
                    let morning_enabled = database.get_ui_setting("ui.reminder.morning_enabled").ok().flatten().as_deref() != Some("false");
                    let morning_time = database.get_ui_setting("ui.reminder.morning_time").ok().flatten().unwrap_or_else(|| "08:30".into());
                    let task_lead = database.get_ui_setting("ui.reminder.task_lead").ok().flatten()
                        .and_then(|value| value.parse::<i64>().ok()).unwrap_or(5);
                    let task_blocks = database.claim_due_task_block_notifications(task_lead).unwrap_or_default();
                    if evening_enabled && minute >= evening_time {
                        let kind = "evening_review";
                        ("该复盘今天的执行情况了", "打开今序，核对实际耗时、结果和剩余工作量。", database.claim_daily_notification(kind, &date).unwrap_or(false), task_blocks)
                    } else if morning_enabled && minute >= morning_time {
                        let kind = "morning_plan";
                        ("今天准备怎么安排？", "打开今序主动生成或调整今天的计划；提醒不会自动调用 AI。", database.claim_daily_notification(kind, &date).unwrap_or(false), task_blocks)
                    } else {
                        ("", "", false, task_blocks)
                    }
                }
                Err(_) => ("", "", false, Vec::new()),
            }
        } else { ("", "", false, Vec::new()) };
        if should_notify {
            let _ = app.notification().builder().title(title).body(body).show();
        }
        for block in task_blocks {
            let starts_at = chrono::DateTime::parse_from_rfc3339(&block.starts_at)
                .map(|value| value.with_timezone(&chrono::FixedOffset::east_opt(8 * 3600).expect("fixed offset")).format("%H:%M").to_string())
                .unwrap_or_else(|_| "即将".into());
            let _ = app.notification().builder()
                .title(format!("{} 开始：{}", starts_at, block.task_title))
                .body("打开今序查看今日时间线；提醒不会自动改变任务状态。")
                .show();
        }
        thread::sleep(Duration::from_secs(30));
    });
}

#[tauri::command]
fn update_manual_task(
    state: State<'_, AppState>,
    task_id: String,
    update: ManualTaskUpdate,
) -> Result<TaskDto, String> {
    with_database(&state, |database| database.update_manual_task(&task_id, update))
}

#[tauri::command]
fn transition_manual_task(
    state: State<'_, AppState>,
    task_id: String,
    target_status: TaskStatus,
) -> Result<TaskDto, String> {
    with_database(&state, |database| database.transition_manual_task(&task_id, target_status))
}

#[tauri::command]
fn reopen_manual_task(
    state: State<'_, AppState>,
    task_id: String,
    plan_date: String,
) -> Result<TaskDto, String> {
    with_database(&state, |database| database.reopen_manual_task(&task_id, &plan_date))
}

#[tauri::command]
fn soft_delete_manual_task(
    state: State<'_, AppState>,
    task_id: String,
    confirmed: bool,
) -> Result<(), String> {
    with_database(&state, |database| database.soft_delete_manual_task(&task_id, confirmed))
}

#[tauri::command]
fn restore_manual_task(state: State<'_, AppState>, task_id: String) -> Result<(), String> {
    with_database(&state, |database| database.restore_task(&task_id))
}

#[tauri::command]
fn permanently_delete_manual_task(
    state: State<'_, AppState>,
    task_id: String,
    confirmed: bool,
) -> Result<(), String> {
    with_database(&state, |database| database.permanently_delete_task(&task_id, confirmed))
}

#[tauri::command]
fn create_fixed_event(
    state: State<'_, AppState>,
    input: ManualCalendarEventInput,
) -> Result<CalendarEventDto, String> {
    with_database(&state, |database| database.create_fixed_event(input))
}

#[tauri::command]
fn update_fixed_event(
    state: State<'_, AppState>,
    event_id: String,
    input: ManualCalendarEventInput,
) -> Result<CalendarEventDto, String> {
    with_database(&state, |database| database.update_fixed_event(&event_id, input))
}

#[tauri::command]
fn soft_delete_fixed_event(
    state: State<'_, AppState>,
    event_id: String,
    confirmed: bool,
) -> Result<(), String> {
    with_database(&state, |database| database.soft_delete_fixed_event(&event_id, confirmed))
}

#[tauri::command]
fn list_calendar_events(
    state: State<'_, AppState>,
    range_start: String,
    range_end: String,
) -> Result<Vec<CalendarEventDto>, String> {
    with_database(&state, |database| database.list_calendar_events(&range_start, &range_end))
}

#[tauri::command]
fn get_availability_settings(state: State<'_, AppState>) -> Result<AvailabilitySettings, String> {
    with_database(&state, |database| database.get_availability_settings())
}

#[tauri::command]
fn save_availability_settings(
    state: State<'_, AppState>,
    settings: AvailabilitySettings,
) -> Result<AvailabilitySettings, String> {
    with_database(&state, |database| database.save_availability_settings(settings))
}

#[tauri::command]
fn preview_rule_based_plan(
    state: State<'_, AppState>,
    plan_date: String,
) -> Result<RulePlanPreview, String> {
    with_database(&state, |database| database.preview_rule_based_plan(&plan_date))
}

#[tauri::command]
fn get_rule_plan_draft(
    state: State<'_, AppState>,
    plan_date: String,
) -> Result<Option<RulePlanPreview>, String> {
    with_database(&state, |database| database.get_rule_plan_draft(&plan_date))
}

#[tauri::command]
fn start_manual_plan_draft(
    state: State<'_, AppState>,
    plan_date: String,
) -> Result<RulePlanPreview, String> {
    with_database(&state, |database| database.start_manual_plan_draft(&plan_date))
}

#[tauri::command]
fn start_confirmed_plan_adjustment(
    state: State<'_, AppState>,
    plan_date: String,
) -> Result<RulePlanPreview, String> {
    with_database(&state, |database| database.start_confirmed_plan_adjustment(&plan_date))
}

#[tauri::command]
fn regenerate_confirmed_plan_adjustment(
    state: State<'_, AppState>,
    plan_date: String,
) -> Result<RulePlanPreview, String> {
    with_database(&state, |database| database.regenerate_confirmed_plan_adjustment(&plan_date))
}

#[tauri::command]
fn update_rule_plan_draft(
    state: State<'_, AppState>,
    preview_id: String,
    expected_version: i64,
    blocks: Vec<RulePlanBlock>,
    unscheduled: Vec<UnscheduledTask>,
) -> Result<RulePlanPreview, String> {
    with_database(&state, |database| database.update_rule_plan_draft(
        &preview_id,
        expected_version,
        blocks,
        unscheduled,
    ))
}

#[tauri::command]
fn discard_rule_plan_draft(
    state: State<'_, AppState>,
    preview_id: String,
    expected_version: i64,
) -> Result<database::RulePlanDraftDiscardResult, String> {
    with_database(&state, |database| database.discard_rule_plan_draft(&preview_id, expected_version))
}

#[tauri::command]
fn include_plan_task(state: State<'_, AppState>, input: PlanTaskInclude) -> Result<DayScheduleDto, String> {
    with_database(&state, |database| database.include_plan_task(input))
}

#[tauri::command]
fn remove_plan_block(state: State<'_, AppState>, input: PlanBlockRemove) -> Result<DayScheduleDto, String> {
    with_database(&state, |database| database.remove_plan_block(input))
}

#[tauri::command]
fn update_plan_block_time(
    state: State<'_, AppState>,
    input: PlanBlockTimeUpdate,
) -> Result<DayScheduleDto, String> {
    with_database(&state, |database| database.update_plan_block_time(input))
}

#[tauri::command]
fn confirm_rule_based_plan(
    state: State<'_, AppState>,
    preview: RulePlanPreview,
) -> Result<DayScheduleDto, String> {
    with_database(&state, |database| database.confirm_rule_based_plan(preview))
}

#[tauri::command]
fn get_day_schedule(state: State<'_, AppState>, plan_date: String) -> Result<DayScheduleDto, String> {
    with_database(&state, |database| database.get_day_schedule(&plan_date))
}

#[tauri::command]
fn save_execution_capture(
    state: State<'_, AppState>,
    capture_date: String,
    input: ExecutionCaptureInput,
) -> Result<(), String> {
    with_database(&state, |database| database.save_execution_capture(&capture_date, input))
}

#[tauri::command]
fn clear_execution_capture(
    state: State<'_, AppState>,
    capture_date: String,
    plan_block_id: String,
) -> Result<(), String> {
    with_database(&state, |database| database.clear_execution_capture(&capture_date, &plan_block_id))
}

#[tauri::command]
fn save_review_entry(
    state: State<'_, AppState>,
    review_date: String,
    input: ReviewEntryInput,
) -> Result<ReviewEntryDto, String> {
    with_database(&state, |database| database.save_review_entry(&review_date, input))
}

#[tauri::command]
fn complete_task_from_review(
    state: State<'_, AppState>,
    task_id: String,
    review_date: String,
    confirmed: bool,
) -> Result<TaskDto, String> {
    with_database(&state, |database| {
        database.complete_task_from_review(&task_id, &review_date, confirmed)
    })
}

#[tauri::command]
fn preview_ai_proposal(state: State<'_, AppState>, raw_json: String) -> Result<ProposalPreview, String> {
    with_database(&state, |database| database.preview_ai_proposal(&raw_json))
}

#[tauri::command]
fn apply_confirmed_ai_proposal(
    state: State<'_, AppState>,
    ai_run_id: String,
    confirmation_token: String,
    destructive_confirmation: bool,
) -> Result<ApplyResult, String> {
    with_database(&state, |database| {
        database.apply_confirmed_ai_proposal(&ai_run_id, &confirmation_token, destructive_confirmation)
    })
}

pub fn run() {
    tauri::Builder::default()
        // Keep the existing registry value name so upgrades retain the autostart preference.
        .plugin(tauri_plugin_autostart::Builder::new().app_name("今序（JinXu）").build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, _shortcut, event| {
            if event.state == ShortcutState::Pressed { show_main_window(app); }
        }).build())
        .plugin(tauri_plugin_opener::init())
        .setup(|application| {
            let data_dir = application.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let mut database = Database::open(data_dir.join("jinxu.sqlite3"))?;
            purge_expired_deleted_items(&mut database)?;
            application.manage(AppState { database: Mutex::new(database) });
            #[cfg(windows)]
            application.manage(taskbar_icon::TaskbarIcons::new().map_err(std::io::Error::other)?);
            setup_tray(application)?;
            let app_handle = application.handle().clone();
            let logo_mode = application.state::<AppState>().database.lock().ok()
                .and_then(|database| database.get_ui_setting("ui.appearance.mode").ok().flatten())
                .filter(|mode| mode == "dark")
                .unwrap_or_else(|| "light".into());
            set_app_logo_mode(app_handle.clone(), logo_mode).map_err(std::io::Error::other)?;
            if let Some(shortcut) = application.state::<AppState>().database.lock().ok()
                .and_then(|database| database.get_ui_setting("ui.desktop.shortcut").ok().flatten())
                .or_else(|| Some("Ctrl+Alt+Space".into()))
            {
                let _ = application.global_shortcut().register(shortcut.as_str());
            }
            launch_reminder_worker(app_handle);
            Ok(())
        })
        .on_window_event(|window: &Window, event: &WindowEvent| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let close_to_tray = if let Some(state) = window.app_handle().try_state::<AppState>() {
                    match state.database.lock() {
                        Ok(database) => database.get_ui_setting("ui.desktop.close_to_tray")
                            .ok().flatten().map(|value| value != "false").unwrap_or(true),
                        Err(_) => true,
                    }
                } else { true };
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            create_manual_task_draft,
            save_task_draft,
            list_task_drafts,
            confirm_task_draft,
            confirm_creation_draft,
            import_legacy_recurring_draft,
            discard_task_draft,
            list_tasks,
            create_recurring_item,
            list_recurring_items,
            update_recurring_item,
            set_recurring_item_status,
            soft_delete_recurring_item,
            restore_recurring_item,
            permanently_delete_recurring_item,
            list_recurring_occurrences,
            save_recurring_occurrence_review,
            get_task,
            get_task_metadata,
            set_task_tags,
            update_recurring_task,
            list_tags,
            latest_undo,
            apply_undo,
            get_ui_setting,
            set_ui_setting,
            set_app_logo_mode,
            set_app_window_title,
            get_ai_connection_settings,
            save_ai_connection_settings,
            test_ai_connection,
            create_ai_conversation,
            list_ai_conversations,
            rename_ai_conversation,
            set_ai_conversation_archived,
            permanently_delete_ai_conversation,
            list_ai_messages,
            list_ai_conversation_proposals,
            run_ai_assistant,
            start_ai_assistant,
            complete_ai_assistant,
            stop_ai_run,
            get_autostart_enabled,
            set_autostart_enabled,
            set_global_shortcut,
            send_test_notification,
            update_manual_task,
            transition_manual_task,
            reopen_manual_task,
            soft_delete_manual_task,
            restore_manual_task,
            permanently_delete_manual_task,
            create_fixed_event,
            update_fixed_event,
            soft_delete_fixed_event,
            list_calendar_events,
            get_availability_settings,
            save_availability_settings,
            preview_rule_based_plan,
            get_rule_plan_draft,
            start_manual_plan_draft,
            start_confirmed_plan_adjustment,
            regenerate_confirmed_plan_adjustment,
            update_rule_plan_draft,
            discard_rule_plan_draft,
            confirm_rule_based_plan,
            update_plan_block_time,
            include_plan_task,
            remove_plan_block,
            get_day_schedule,
            save_execution_capture,
            clear_execution_capture,
            save_review_entry,
            complete_task_from_review,
            preview_ai_proposal,
            apply_confirmed_ai_proposal
        ])
        .run(tauri::generate_context!())
        .expect("启动今序时发生无法恢复的错误");
}
