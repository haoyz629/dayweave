#![recursion_limit = "256"]

mod database;
mod desktop_notifications;
mod domain;
mod error;
mod holiday_calendar;
mod legacy;

#[cfg(windows)]
mod taskbar_icon;

#[cfg(test)]
mod logo_test;

use std::{fs, sync::Mutex, thread, time::Duration};

use database::{
    Database, DraftDto, DraftInput, RecurringOccurrenceDto, RecurringOccurrenceStateInput,
    RecurringRuleDto, RecurringRuleInput, RescheduleRecurringOccurrenceInput,
    RescheduleRecurringResultDto, TagDto, TaskBlockNotificationDto, TaskDto, TaskInput,
    WorkspaceSnapshotDto,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State, Window, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutostartExt;

struct AppState {
    database: Mutex<Database>,
}

fn with_database<T>(
    state: &State<'_, AppState>,
    operation: impl FnOnce(&mut Database) -> crate::error::AppResult<T>,
) -> Result<T, String> {
    let mut database = state
        .database
        .lock()
        .map_err(|_| "数据库锁不可用，请重试".to_string())?;
    operation(&mut database).map_err(|error| error.to_string())
}

// ---- Holiday Calendar ----

#[tauri::command]
fn get_holiday_calendar(state: State<'_, AppState>) -> Result<holiday_calendar::Snapshot, String> {
    with_database(&state, |database| Ok(database.get_holiday_calendar()))
}

fn run_holiday_check(
    app: &AppHandle,
    years: Vec<i32>,
    force: bool,
) -> Result<holiday_calendar::Snapshot, String> {
    let state = app.state::<AppState>();
    let (job, snapshot) = {
        let mut database = state
            .database
            .lock()
            .map_err(|_| "数据库锁不可用".to_string())?;
        let job = database
            .begin_holiday_update(years, force)
            .map_err(|error| error.to_string())?;
        (job, database.get_holiday_calendar())
    };
    let Some(job) = job else {
        return Ok(snapshot);
    };
    let _ = app.emit("holiday-calendar-updated", &snapshot);
    let result = job.download();
    let snapshot = {
        let mut database = state
            .database
            .lock()
            .map_err(|_| "数据库锁不可用".to_string())?;
        database.finish_holiday_update(result)
    };
    let _ = app.emit("holiday-calendar-updated", &snapshot);
    Ok(snapshot)
}

#[tauri::command]
async fn check_holiday_updates(
    app: AppHandle,
    years: Vec<i32>,
    force: bool,
) -> Result<holiday_calendar::Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || run_holiday_check(&app, years, force))
        .await
        .map_err(|error| error.to_string())?
}

fn launch_holiday_worker(app: AppHandle) {
    thread::spawn(move || loop {
        let _ = run_holiday_check(&app, Vec::new(), false);
        thread::sleep(Duration::from_secs(3600));
    });
}

// ---- Workspace Snapshot ----

#[tauri::command]
fn get_workspace_snapshot(state: State<'_, AppState>) -> Result<WorkspaceSnapshotDto, String> {
    with_database(&state, |db| db.get_workspace_snapshot())
}

// ---- Tags ----

#[tauri::command]
fn create_tag(state: State<'_, AppState>, name: String, color: String) -> Result<TagDto, String> {
    with_database(&state, |db| db.create_tag(&name, &color))
}

#[tauri::command]
fn delete_tag(state: State<'_, AppState>, tag_id: String) -> Result<(), String> {
    with_database(&state, |db| db.delete_tag(&tag_id))
}

// ---- Tasks ----

#[tauri::command]
fn create_task(
    state: State<'_, AppState>,
    input: TaskInput,
    from_draft_id: Option<String>,
) -> Result<TaskDto, String> {
    with_database(&state, |db| db.create_task(input, from_draft_id.as_deref()))
}

#[tauri::command]
fn update_task(
    state: State<'_, AppState>,
    task_id: String,
    input: TaskInput,
) -> Result<TaskDto, String> {
    with_database(&state, |db| db.update_task(&task_id, input))
}

#[tauri::command]
fn soft_delete_task(state: State<'_, AppState>, task_id: String) -> Result<TaskDto, String> {
    with_database(&state, |db| db.soft_delete_task(&task_id))
}

#[tauri::command]
fn restore_task(state: State<'_, AppState>, task_id: String) -> Result<TaskDto, String> {
    with_database(&state, |db| db.restore_task(&task_id))
}

#[tauri::command]
fn purge_task(state: State<'_, AppState>, task_id: String) -> Result<(), String> {
    with_database(&state, |db| db.purge_task(&task_id))
}

#[tauri::command]
fn empty_trash(state: State<'_, AppState>) -> Result<usize, String> {
    with_database(&state, |db| db.empty_trash())
}

// ---- Drafts ----

#[tauri::command]
fn upsert_draft(state: State<'_, AppState>, input: DraftInput) -> Result<DraftDto, String> {
    with_database(&state, |db| db.upsert_draft(input))
}

#[tauri::command]
fn delete_draft(state: State<'_, AppState>, draft_id: String) -> Result<(), String> {
    with_database(&state, |db| db.delete_draft(&draft_id))
}

// ---- Recurring Rules & Occurrences ----

#[tauri::command]
fn create_recurring_rule(
    state: State<'_, AppState>,
    input: RecurringRuleInput,
) -> Result<RecurringRuleDto, String> {
    with_database(&state, |db| db.create_recurring_rule(input))
}

#[tauri::command]
fn update_recurring_rule(
    state: State<'_, AppState>,
    rule_id: String,
    input: RecurringRuleInput,
) -> Result<RecurringRuleDto, String> {
    with_database(&state, |db| db.update_recurring_rule(&rule_id, input))
}

#[tauri::command]
fn toggle_recurring_rule(
    state: State<'_, AppState>,
    rule_id: String,
    active: bool,
) -> Result<RecurringRuleDto, String> {
    with_database(&state, |db| db.toggle_recurring_rule(&rule_id, active))
}

#[tauri::command]
fn archive_recurring_rule(
    state: State<'_, AppState>,
    rule_id: String,
) -> Result<RecurringRuleDto, String> {
    with_database(&state, |db| db.archive_recurring_rule(&rule_id))
}

#[tauri::command]
fn restore_recurring_rule(
    state: State<'_, AppState>,
    rule_id: String,
) -> Result<RecurringRuleDto, String> {
    with_database(&state, |db| db.restore_recurring_rule(&rule_id))
}

#[tauri::command]
fn list_recurring_occurrences_range(
    state: State<'_, AppState>,
    from_date: String,
    to_date: String,
) -> Result<Vec<RecurringOccurrenceDto>, String> {
    with_database(&state, |db| {
        db.list_recurring_occurrences_range(&from_date, &to_date)
    })
}

#[tauri::command]
fn set_recurring_occurrence_state(
    state: State<'_, AppState>,
    input: RecurringOccurrenceStateInput,
) -> Result<RecurringOccurrenceDto, String> {
    with_database(&state, |db| db.set_recurring_occurrence_state(input))
}

#[tauri::command]
fn reschedule_recurring_occurrence(
    state: State<'_, AppState>,
    input: RescheduleRecurringOccurrenceInput,
) -> Result<RescheduleRecurringResultDto, String> {
    with_database(&state, |db| db.reschedule_recurring_occurrence(input))
}

// ---- UI Settings & Desktop ----

#[tauri::command]
fn get_ui_setting(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    with_database(&state, |db| db.get_ui_setting(&key))
}

#[tauri::command]
fn set_ui_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    with_database(&state, |db| db.set_ui_setting(&key, &value))
}

#[tauri::command]
fn get_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<bool, String> {
    if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    }
    .map_err(|error| error.to_string())?;
    app.autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn send_test_notification(app: AppHandle) -> Result<(), String> {
    desktop_notifications::show(
        &app,
        "提醒已准备好",
        "之后的任务提醒会显示在这里。",
        None,
        false,
    )
}

#[tauri::command]
fn set_app_window_title(window: tauri::WebviewWindow, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|error| error.to_string())
}

// ---- Window, Tray & Reminder Worker ----

fn single_instance_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app))
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn app_logo(mode: &str) -> Result<tauri::image::Image<'static>, String> {
    if !matches!(mode, "light" | "dark") {
        return Err("不支持的明暗模式".into());
    }
    let rgba: &'static [u8] = include_bytes!("../icons/logo-light.rgba");
    Ok(tauri::image::Image::new(rgba, 128, 128))
}

fn tray_logo() -> tauri::image::Image<'static> {
    tauri::image::Image::new(include_bytes!("../icons/tray.rgba"), 32, 32)
}

fn initialize_app_logo(app: AppHandle) -> Result<(), String> {
    let icon = app_logo("light")?;
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_icon(icon.clone())
            .map_err(|error| error.to_string())?;
        #[cfg(windows)]
        {
            let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
            let taskbar_app = app.clone();
            window
                .run_on_main_thread(move || {
                    taskbar_app
                        .state::<taskbar_icon::TaskbarIcons>()
                        .set_for_window(hwnd, "light");
                })
                .map_err(|error| error.to_string())?;
        }
    }
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_icon(Some(tray_logo()))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示今序 · Dayweave", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let builder = TrayIconBuilder::with_id("main-tray")
        .icon(tray_logo())
        .menu(&menu)
        .tooltip("今序 · Dayweave")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    builder.build(app)?;
    Ok(())
}

fn launch_reminder_worker(app: AppHandle) {
    thread::spawn(move || loop {
        let (task_blocks, snoozed) = if let Some(state) = app.try_state::<AppState>() {
            match state.database.lock() {
                Ok(mut database) => {
                    let task_lead = database
                        .get_ui_setting("ui.reminder.task_lead")
                        .ok()
                        .flatten()
                        .and_then(|value| value.parse::<i64>().ok())
                        .unwrap_or(5);
                    let task_blocks = database
                        .claim_due_task_block_notifications(task_lead)
                        .unwrap_or_default();
                    let snoozed = database
                        .claim_due_task_block_reminder_snoozes(&chrono::Utc::now().to_rfc3339())
                        .unwrap_or_default();
                    (task_blocks, snoozed)
                }
                Err(_) => (Vec::new(), Vec::new()),
            }
        } else {
            (Vec::new(), Vec::new())
        };
        for block in task_blocks {
            show_task_reminder(&app, block, false);
        }
        for delayed in snoozed {
            show_task_reminder(&app, delayed.reminder, true);
        }
        thread::sleep(Duration::from_secs(15));
    });
}

fn show_task_reminder(app: &AppHandle, block: TaskBlockNotificationDto, is_snoozed: bool) {
    match desktop_notifications::task_reminder(
        &block.block_id,
        &block.task_id,
        &block.task_title,
        block.task_notes.as_deref(),
        block.task_priority.as_deref(),
        &block.task_tags,
        &block.starts_at,
        &block.ends_at,
        &block.event_at,
        block.is_end,
        chrono::Utc::now(),
    ) {
        Ok((title, body, _)) => {
            if let Err(error) = desktop_notifications::show(app, &title, &body, Some(block), is_snoozed) {
                eprintln!("任务提醒发送失败：{error}");
            }
        }
        Err(error) => eprintln!("任务提醒无效：{error}"),
    }
}

pub(crate) fn snooze_task_block_reminder(
    app: &AppHandle,
    reminder: TaskBlockNotificationDto,
) -> Result<(), String> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "提醒数据库尚未就绪".to_string())?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "提醒数据库暂不可用".to_string())?;
    if !database
        .snooze_task_block_reminder(&reminder, &chrono::Utc::now().to_rfc3339())
        .map_err(|error| error.to_string())?
    {
        return Err("这条提醒已经延后过".into());
    }
    Ok(())
}

pub(crate) fn complete_task_block_reminder(
    app: &AppHandle,
    reminder: &TaskBlockNotificationDto,
) -> Result<bool, String> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "提醒数据库尚未就绪".to_string())?;
    let mut database = state
        .database
        .lock()
        .map_err(|_| "提醒数据库暂不可用".to_string())?;
    database
        .complete_task_block_reminder(reminder)
        .map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(single_instance_plugin())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name(legacy::AUTOSTART_NAME)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|application| {
            let data_dir = application.path().app_data_dir()?;
            legacy::migrate_database(&data_dir)?;
            fs::create_dir_all(&data_dir)?;
            let mut database = Database::open(data_dir.join(legacy::DATABASE_NAME))?;
            let _ = database.purge_expired_trash();
            application.manage(AppState {
                database: Mutex::new(database),
            });
            legacy::migrate_local_storage(&application.path().app_local_data_dir()?)?;
            tauri::WebviewWindowBuilder::from_config(
                application,
                &application.config().app.windows[0],
            )?
            .build()?;
            #[cfg(windows)]
            application.manage(taskbar_icon::TaskbarIcons::new().map_err(std::io::Error::other)?);
            setup_tray(application)?;
            let app_handle = application.handle().clone();
            initialize_app_logo(app_handle.clone()).map_err(std::io::Error::other)?;
            #[cfg(windows)]
            if let Err(error) = desktop_notifications::initialize(
                &app_handle,
                &application.path().app_local_data_dir()?.join("notifications"),
            ) {
                eprintln!("Windows 通知初始化失败：{error}");
            }
            launch_holiday_worker(app_handle.clone());
            launch_reminder_worker(app_handle);
            Ok(())
        })
        .on_window_event(|window: &Window, event: &WindowEvent| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let close_to_tray = if let Some(state) = window.app_handle().try_state::<AppState>() {
                    match state.database.lock() {
                        Ok(database) => database
                            .get_ui_setting("ui.desktop.close_to_tray")
                            .ok()
                            .flatten()
                            .map(|value| value != "false")
                            .unwrap_or(true),
                        Err(_) => true,
                    }
                } else {
                    true
                };
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_holiday_calendar,
            check_holiday_updates,
            get_workspace_snapshot,
            create_tag,
            delete_tag,
            create_task,
            update_task,
            soft_delete_task,
            restore_task,
            purge_task,
            empty_trash,
            upsert_draft,
            delete_draft,
            create_recurring_rule,
            update_recurring_rule,
            toggle_recurring_rule,
            archive_recurring_rule,
            restore_recurring_rule,
            list_recurring_occurrences_range,
            set_recurring_occurrence_state,
            reschedule_recurring_occurrence,
            get_ui_setting,
            set_ui_setting,
            get_autostart_enabled,
            set_autostart_enabled,
            send_test_notification,
            set_app_window_title,
        ])
        .run(tauri::generate_context!())
        .expect("启动今序时发生无法恢复的错误");
}
