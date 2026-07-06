mod commands;
mod progress;
mod settings;

use std::sync::Mutex;

use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    ActivationPolicy, AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_positioner::{on_tray_event, Position, WindowExt};

pub struct AppState {
    pub suppress_panel_hide: Mutex<bool>,
    pub tray_id: tauri::tray::TrayIconId,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_positioner::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(ActivationPolicy::Accessory);

            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("系规助手")
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    on_tray_event(tray.app_handle(), &event);
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_panel(tray.app_handle());
                    }
                })
                .build(app)?;

            app.manage(AppState {
                suppress_panel_hide: Mutex::new(false),
                tray_id: tray.id().clone(),
            });

            refresh_tray_badge(app.handle());

            if let Ok((_, settings)) = commands::settings_for(app.handle()) {
                let _ = apply_panel_pinned(app.handle(), settings.panel_pinned());
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::set_root_dir,
            commands::set_textbook_dir,
            commands::prepare_dialog,
            commands::finish_dialog,
            commands::get_progress,
            commands::save_video_progress,
            commands::mark_task_done,
            commands::get_today_snapshot,
            commands::resolve_video_path,
            commands::open_player,
            commands::open_external_video,
            commands::open_textbook,
            commands::open_quiz,
            commands::get_panel_pinned,
            commands::set_panel_pinned,
            commands::quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            match event {
                RunEvent::Reopen { .. } => toggle_panel(&app),
                RunEvent::WindowEvent { label, event, .. } if label == "panel" => {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let suppress = app
                            .state::<AppState>()
                            .suppress_panel_hide
                            .lock()
                            .map(|v| *v)
                            .unwrap_or(false);
                        if suppress || panel_should_stay_visible(&app) {
                            return;
                        }
                        if let Some(window) = app.get_webview_window("panel") {
                            let _ = window.hide();
                            restore_accessory(&app);
                        }
                    }
                }
                _ => {}
            }
        });
}

pub fn set_panel_hide_suppressed(app: &AppHandle, suppressed: bool) {
    if let Ok(mut guard) = app.state::<AppState>().suppress_panel_hide.lock() {
        *guard = suppressed;
    }
}

pub fn activate_for_action(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(ActivationPolicy::Regular);
    }
    if let Some(window) = app.get_webview_window("panel") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn restore_accessory(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(ActivationPolicy::Accessory);
    }
}

pub fn apply_panel_pinned(app: &AppHandle, pinned: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window("panel") else {
        return Ok(());
    };
    window
        .set_always_on_top(pinned)
        .map_err(|e| e.to_string())
}

pub fn panel_should_stay_visible(app: &AppHandle) -> bool {
    commands::settings_for(app)
        .map(|(_, settings)| settings.panel_pinned())
        .unwrap_or(true)
}

pub fn refresh_tray_badge(app: &AppHandle) {
    let badge = commands::tray_badge_count(app).unwrap_or(commands::TrayBadge {
        count: 0,
        today_scope: true,
    });
    let tray_id = app.state::<AppState>().tray_id.clone();
    let Some(tray) = app.tray_by_id(&tray_id) else {
        return;
    };
    if badge.count > 0 {
        let _ = tray.set_title(Some(format!(" {}", badge.count)));
    } else {
        let _ = tray.set_title(Some(""));
    }
    let tooltip = if badge.count > 0 {
        if badge.today_scope {
            format!("系规助手 · 今日还有 {} 节未看", badge.count)
        } else {
            format!("系规助手 · 本周还有 {} 节未看", badge.count)
        }
    } else {
        "系规助手".to_string()
    };
    let _ = tray.set_tooltip(Some(tooltip));
}

fn toggle_panel(app: &AppHandle) {
    let Some(window) = app.get_webview_window("panel") else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        restore_accessory(app);
        return;
    }

    activate_for_action(app);
    let _ = window.move_window(Position::TrayCenter);
    let _ = window.show();
    let _ = window.set_focus();
}

pub fn ensure_player_window(app: &AppHandle, lesson_no: u32) -> Result<(), String> {
    activate_for_action(app);
    let label = format!("player-{lesson_no}");

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("player-open", lesson_no);
        return Ok(());
    }

    let url = WebviewUrl::App(format!("index.html?view=player&lesson={lesson_no}").into());
    WebviewWindowBuilder::new(app, &label, url)
        .title(format!("第{lesson_no}节"))
        .inner_size(480.0, 300.0)
        .min_inner_size(360.0, 220.0)
        .decorations(true)
        .always_on_top(true)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}
