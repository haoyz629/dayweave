use crate::database::TaskBlockNotificationDto;
use chrono::{DateTime, FixedOffset, Utc};
use serde::Serialize;
use tauri::AppHandle;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderTarget {
    pub date: String,
    pub block_id: String,
    pub task_id: String,
}

pub fn task_reminder(
    block_id: &str,
    task_id: &str,
    task_title: &str,
    task_notes: Option<&str>,
    priority: Option<&str>,
    tags: &[String],
    starts_at: &str,
    ends_at: &str,
    event_at: &str,
    is_end: bool,
    now: DateTime<Utc>,
) -> Result<(String, String, ReminderTarget), String> {
    let starts_at = DateTime::parse_from_rfc3339(starts_at)
        .map_err(|_| "任务块提醒的开始时间无效".to_string())?
        .with_timezone(&FixedOffset::east_opt(8 * 3600).expect("Shanghai offset"));
    let ends_at = DateTime::parse_from_rfc3339(ends_at)
        .map_err(|_| "任务块提醒的结束时间无效".to_string())?
        .with_timezone(&FixedOffset::east_opt(8 * 3600).expect("Shanghai offset"));
    let event_at = DateTime::parse_from_rfc3339(event_at)
        .map_err(|_| "任务块提醒时间无效".to_string())?
        .with_timezone(&FixedOffset::east_opt(8 * 3600).expect("Shanghai offset"));
    let remaining = ((event_at.signed_duration_since(now).num_milliseconds().max(0) + 59_999) / 60_000) as u64;
    let action = if is_end { "结束" } else { "开始" };
    let timing = if remaining > 0 { format!("{remaining} 分钟后{action}") } else { format!("现在{action}") };
    Ok((
        task_title.to_string(),
        format!("{timing} · {}–{}{}{}{}", starts_at.format("%H:%M"), ends_at.format("%H:%M"), task_notes.filter(|value| !value.trim().is_empty()).map(|value| format!(" · {value}")).unwrap_or_default(), priority.and_then(|value| match value { "urgent" => Some("P0"), "high" => Some("P1"), "medium" => Some("P2"), "low" => Some("P3"), _ => None }).map(|value| format!(" · {value}")).unwrap_or_default(), if tags.is_empty() { String::new() } else { format!(" · {}", tags.join("、")) }),
        ReminderTarget { date: starts_at.format("%Y-%m-%d").to_string(), block_id: block_id.into(), task_id: task_id.into() },
    ))
}
#[cfg(windows)]
mod windows {
    use std::{fs, path::Path};
    use tauri::{Emitter, Manager};
    use tauri_winrt_notification::Toast;
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    use crate::database::TaskBlockNotificationDto;
    use serde::Serialize;
    use super::{AppHandle, ReminderTarget};

    const TRAY_LOGO: &[u8] = include_bytes!("../icons/tray.png");

    struct NotificationIdentity;

    fn register_identity(identifier: &str, display_name: &str, icon: &Path) -> std::io::Result<()> {
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(format!("Software\\Classes\\AppUserModelId\\{identifier}"))?;
        key.set_value("DisplayName", &display_name)?;
        key.set_value("IconUri", &icon.to_string_lossy().as_ref())?;
        key.set_value("ShowInSettings", &1u32)?;
        Ok(())
    }

    pub fn initialize(app: &AppHandle, directory: &Path) -> Result<(), String> {
        fs::create_dir_all(directory).map_err(|error| error.to_string())?;
        let tray_icon = directory.join("tray.png");
        if fs::read(&tray_icon).ok().as_deref() != Some(TRAY_LOGO) {
            fs::write(&tray_icon, TRAY_LOGO).map_err(|error| error.to_string())?;
        }
        register_identity(
            &app.config().identifier,
            "今序 · dayweave",
            &tray_icon,
        ).map_err(|error| format!("无法注册今序通知身份：{error}"))?;
        app.manage(NotificationIdentity);
        Ok(())
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum ToastActivation {
        OpenApp,
        OpenReminder,
        Snooze,
        Complete,
        Dismiss,
    }

    fn toast_buttons(reminder: Option<&TaskBlockNotificationDto>, is_snoozed: bool) -> Vec<(&'static str, &'static str)> {
        let Some(item) = reminder else {
            return vec![("打开今序", "open")];
        };
        let mut buttons = vec![("打开今序", "open")];
        if item.is_end {
            buttons.push(("快捷完成", "complete"));
            if !is_snoozed {
                buttons.push(("稍后提醒", "snooze"));
            }
        } else {
            if !is_snoozed {
                buttons.push(("稍后提醒", "snooze"));
            }
            buttons.push(("我知道了", "dismiss"));
        }
        buttons
    }

    fn classify_activation(has_reminder: bool, action: Option<&str>) -> ToastActivation {
        let action = action.filter(|value| !value.is_empty()).unwrap_or("open");
        if action == "dismiss" {
            return ToastActivation::Dismiss;
        }
        if !has_reminder {
            return ToastActivation::OpenApp;
        }
        match action {
            "snooze" => ToastActivation::Snooze,
            "complete" => ToastActivation::Complete,
            _ => ToastActivation::OpenReminder,
        }
    }

    pub fn show(app: &AppHandle, title: &str, body: &str, reminder: Option<TaskBlockNotificationDto>, is_snoozed: bool) -> Result<(), String> {
        let _identity = app.try_state::<NotificationIdentity>()
            .ok_or_else(|| "今序的 Windows 通知尚未就绪，请重新启动应用后重试".to_string())?;
        let activated_app = app.clone();
        let mut toast = Toast::new(&app.config().identifier)
            .title(title)
            .text1(body);
        for (label, action) in toast_buttons(reminder.as_ref(), is_snoozed) {
            toast = toast.add_button(label, action);
        }
        toast.on_activated(move |action| {
            let app = activated_app.clone();
            let reminder = reminder.clone();
            let _ = activated_app.run_on_main_thread(move || {
                let activation = classify_activation(reminder.is_some(), action.as_deref());
                match (activation, reminder) {
                    (ToastActivation::Snooze, Some(reminder)) => {
                        if let Err(error) = crate::snooze_task_block_reminder(&app, reminder) {
                            eprintln!("任务提醒延后失败：{error}");
                        }
                    }
                    (ToastActivation::Complete, Some(reminder)) => {
                        match crate::complete_task_block_reminder(&app, &reminder) {
                            Ok(true) => {
                                let target = ReminderAction {
                                    target: ReminderTarget {
                                        date: reminder.starts_at[..10].to_string(),
                                        block_id: reminder.block_id,
                                        task_id: reminder.task_id,
                                    },
                                    action: "completed".into(),
                                };
                                let _ = app.emit("reminder-activated", target);
                            }
                            Ok(false) => eprintln!("任务块已变化，提醒未执行完成操作"),
                            Err(error) => eprintln!("任务块完成失败：{error}"),
                        }
                    }
                    (ToastActivation::OpenReminder, Some(reminder)) => {
                        crate::show_main_window(&app);
                        let action = action.filter(|value| !value.is_empty()).unwrap_or_else(|| "open".into());
                        let target = ReminderAction {
                            target: ReminderTarget {
                                date: reminder.starts_at[..10].to_string(),
                                block_id: reminder.block_id,
                                task_id: reminder.task_id,
                            },
                            action,
                        };
                        let _ = app.emit("reminder-activated", target);
                    }
                    (ToastActivation::OpenApp, None) => {
                        crate::show_main_window(&app);
                    }
                    (ToastActivation::Dismiss, _) | (_, None) | (ToastActivation::OpenApp, Some(_)) => {}
                }
            });
            Ok(())
        }).show().map_err(|error| format!("Windows 通知发送失败：{error}"))
    }

    #[derive(Clone, Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ReminderAction { target: ReminderTarget, action: String }

    #[cfg(test)]
    mod tests {
        use std::path::PathBuf;
        use super::*;

        fn sample_reminder(is_end: bool) -> TaskBlockNotificationDto {
            TaskBlockNotificationDto {
                block_id: "block-1".into(),
                task_id: "task-1".into(),
                task_title: "测试任务".into(),
                task_notes: None,
                task_priority: None,
                task_tags: Vec::new(),
                starts_at: "2026-11-11T14:30:00+08:00".into(),
                ends_at: "2026-11-11T15:00:00+08:00".into(),
                event_at: if is_end { "2026-11-11T15:00:00+08:00" } else { "2026-11-11T14:30:00+08:00" }.into(),
                is_end,
                schedule_revision: None,
            }
        }

        #[test]
        fn start_reminder_buttons_include_open_snooze_and_acknowledge() {
            let start = sample_reminder(false);
            assert_eq!(
                toast_buttons(Some(&start), false),
                vec![("打开今序", "open"), ("稍后提醒", "snooze"), ("我知道了", "dismiss")]
            );
            assert_eq!(
                toast_buttons(Some(&start), true),
                vec![("打开今序", "open"), ("我知道了", "dismiss")]
            );
        }

        #[test]
        fn end_and_test_notification_buttons_keep_expected_actions() {
            let end = sample_reminder(true);
            assert_eq!(
                toast_buttons(Some(&end), false),
                vec![("打开今序", "open"), ("快捷完成", "complete"), ("稍后提醒", "snooze")]
            );
            assert_eq!(
                toast_buttons(Some(&end), true),
                vec![("打开今序", "open"), ("快捷完成", "complete")]
            );
            assert_eq!(toast_buttons(None, false), vec![("打开今序", "open")]);
        }

        #[test]
        fn dismiss_activation_does_not_open_or_modify_reminder() {
            assert_eq!(classify_activation(true, Some("dismiss")), ToastActivation::Dismiss);
            assert_eq!(classify_activation(false, Some("dismiss")), ToastActivation::Dismiss);
            assert_eq!(classify_activation(true, Some("snooze")), ToastActivation::Snooze);
            assert_eq!(classify_activation(true, Some("complete")), ToastActivation::Complete);
            assert_eq!(classify_activation(true, Some("open")), ToastActivation::OpenReminder);
            assert_eq!(classify_activation(true, None), ToastActivation::OpenReminder);
            assert_eq!(classify_activation(true, Some("")), ToastActivation::OpenReminder);
            assert_eq!(classify_activation(false, Some("open")), ToastActivation::OpenApp);
            assert_eq!(classify_activation(false, None), ToastActivation::OpenApp);
        }

        #[test]
        fn notification_identity_registers_brand_and_icon_for_uninstalled_executables() {
            let identifier = format!("com.dayweave.notification-test.{}", uuid::Uuid::new_v4());
            let directory = tempfile::tempdir().unwrap();
            let icon = directory.path().join("tray.png");
            fs::write(&icon, TRAY_LOGO).unwrap();
            let path = format!("Software\\Classes\\AppUserModelId\\{identifier}");
            let root = RegKey::predef(HKEY_CURRENT_USER);
            register_identity(&identifier, "今序 · dayweave", &icon).unwrap();
            let key = root.open_subkey(&path).unwrap();
            let name: String = key.get_value("DisplayName").unwrap();
            let icon_uri: String = key.get_value("IconUri").unwrap();
            let visible: u32 = key.get_value("ShowInSettings").unwrap();
            drop(key);
            root.delete_subkey_all(&path).unwrap();
            assert_eq!(name, "今序 · dayweave");
            assert_eq!(PathBuf::from(icon_uri), icon);
            assert_eq!(visible, 1);
            assert_eq!(fs::read(icon).unwrap(), TRAY_LOGO);
        }
    }
}

#[cfg(windows)]
pub use windows::{initialize, show};

#[cfg(not(windows))]
pub fn show(app: &AppHandle, title: &str, body: &str, _reminder: Option<TaskBlockNotificationDto>, _is_snoozed: bool) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification().builder().title(title).body(body).show().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reminder(starts_at: &str, now: &str) -> (String, String, ReminderTarget) {
        task_reminder("block-1", "task-1", "整理 <项目> & 方案", None, None, &[], starts_at, starts_at, starts_at, false, now.parse().unwrap()).unwrap()
    }

    #[test]
    fn reminder_shows_actual_remaining_time_and_exact_block() {
        let (title, body, target) = reminder("2026-11-11T14:30:00+08:00", "2026-11-11T06:25:00Z");
        assert_eq!(title, "整理 <项目> & 方案");
        assert_eq!(body, "5 分钟后开始 · 14:30–14:30");
        assert_eq!(target.date, "2026-11-11");
        assert_eq!(target.block_id, "block-1");
        assert_eq!(target.task_id, "task-1");
        assert_eq!(serde_json::to_value(target).unwrap()["blockId"], "block-1");
    }

    #[test]
    fn reminder_uses_shanghai_date_and_rounds_up_without_negative_minutes() {
        let (_, body, target) = reminder("2026-11-11T16:00:00Z", "2026-11-11T15:59:30Z");
        assert_eq!(target.date, "2026-11-12");
        assert_eq!(body, "1 分钟后开始 · 00:00–00:00");
        let (_, body, _) = reminder("2026-11-11T16:00:00Z", "2026-11-11T16:00:01Z");
        assert_eq!(body, "现在开始 · 00:00–00:00");
        assert!(task_reminder("block", "task", "任务", None, None, &[], "invalid", "invalid", "invalid", false, Utc::now()).is_err());
    }

    #[test]
    fn end_reminder_has_distinct_copy_and_keeps_start_date() {
        let (title, body, target) = task_reminder("block", "task", "任务", None, None, &[], "2026-11-11T23:30:00+08:00", "2026-11-12T00:00:00+08:00", "2026-11-12T00:00:00+08:00", true, "2026-11-11T15:55:00Z".parse().unwrap()).unwrap();
        assert_eq!(title, "任务");
        assert_eq!(body, "5 分钟后结束 · 23:30–00:00");
        assert_eq!(target.date, "2026-11-11");

    }
    #[test]
    fn reminder_includes_notes_priority_and_tags() {
        let (_, body, _) = task_reminder("block", "task", "任务", Some("整理资料"), Some("high"), &["工作".into(), "项目".into()], "2026-11-11T14:30:00+08:00", "2026-11-11T15:00:00+08:00", "2026-11-11T14:30:00+08:00", false, "2026-11-11T06:25:00Z".parse().unwrap()).unwrap();
        assert_eq!(body, "5 分钟后开始 · 14:30–15:00 · 整理资料 · P1 · 工作、项目");
    }

    #[test]
    fn reminder_uses_priority_labels() {
        for (priority, label) in [("urgent", "P0"), ("high", "P1"), ("medium", "P2"), ("low", "P3")] {
            let (_, body, _) = task_reminder("block", "task", "任务", None, Some(priority), &[], "2026-11-11T14:30:00+08:00", "2026-11-11T15:00:00+08:00", "2026-11-11T14:30:00+08:00", false, "2026-11-11T06:25:00Z".parse().unwrap()).unwrap();
            assert_eq!(body, format!("5 分钟后开始 · 14:30–15:00 · {label}"));
        }
    }


}
