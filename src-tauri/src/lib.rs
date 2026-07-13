mod commands;
#[cfg(target_os = "macos")]
mod macos_traffic_lights;
mod progress;
mod settings;

use std::sync::Mutex;

use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    ActivationPolicy, AppHandle, Emitter, LogicalSize, Manager, RunEvent, TitleBarStyle,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_positioner::{on_tray_event, WindowExt};

pub struct AppState {
    pub suppress_panel_hide: Mutex<bool>,
    pub tray_id: tauri::tray::TrayIconId,
    pub active_player_lesson: Mutex<Option<u32>>,
}

/// 全局唯一播放器窗口（所有课节共用，切集只换片源）
pub const PLAYER_WINDOW_LABEL: &str = "player";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
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
                active_player_lesson: Mutex::new(None),
            });

            refresh_tray_badge(app.handle());

            if let Ok((_, settings)) = commands::settings_for(app.handle()) {
                let _ = apply_panel_pinned(app.handle(), settings.panel_pinned());
                let _ = commands::apply_launch_at_login(app.handle(), settings.launch_at_login());
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::set_root_dir,
            commands::set_textbook_dir,
            commands::set_tricolor_notes_dir,
            commands::prepare_dialog,
            commands::finish_dialog,
            commands::get_progress,
            commands::save_video_progress,
            commands::mark_task_done,
            commands::get_today_snapshot,
            commands::resolve_video_path,
            commands::get_live_catalog,
            commands::open_player,
            commands::open_external_video,
            commands::open_plan_spreadsheet,
            commands::open_textbook,
            commands::open_tricolor_notes,
            commands::toggle_quiz_done,
            commands::open_quiz,
            commands::get_panel_pinned,
            commands::set_panel_pinned,
            commands::get_player_pinned,
            commands::set_player_pinned,
            commands::set_woven_style,
            commands::set_plan_variant,
            commands::set_floating_subtitles,
            commands::set_subtitle_cat_mode,
            commands::set_launch_at_login,
            commands::resolve_subtitle_path,
            commands::open_subtitle_window,
            commands::close_subtitle_window_cmd,
            commands::sync_pace_today_lock,
            commands::set_player_chrome_visible,
            commands::quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            match event {
                RunEvent::Ready => show_panel(&app),
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
                RunEvent::WindowEvent { label, event, .. } if label == PLAYER_WINDOW_LABEL => {
                    if matches!(
                        event,
                        tauri::WindowEvent::CloseRequested { .. }
                            | tauri::WindowEvent::Destroyed
                    ) {
                        if let Ok(guard) = app.state::<AppState>().active_player_lesson.lock() {
                            if let Some(lesson_no) = *guard {
                                close_subtitle_window(&app, lesson_no);
                            }
                        }
                        if let Ok(mut guard) = app.state::<AppState>().active_player_lesson.lock() {
                            *guard = None;
                        }
                    }
                }
                RunEvent::WindowEvent { label, event, .. } if label.starts_with("player-") => {
                    if matches!(
                        event,
                        tauri::WindowEvent::CloseRequested { .. }
                            | tauri::WindowEvent::Destroyed
                    ) {
                        if let Some(suffix) = label.strip_prefix("player-") {
                            if let Ok(lesson_no) = suffix.parse::<u32>() {
                                close_subtitle_window(&app, lesson_no);
                            }
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

pub fn set_active_player_lesson(app: &AppHandle, lesson_no: u32) {
    if let Ok(mut guard) = app.state::<AppState>().active_player_lesson.lock() {
        *guard = Some(lesson_no);
    }
}

pub fn active_player_lesson(app: &AppHandle) -> Option<u32> {
    app.state::<AppState>()
        .active_player_lesson
        .lock()
        .ok()
        .and_then(|g| *g)
}

fn close_legacy_player_windows(app: &AppHandle) {
    let labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|label| label.starts_with("player-"))
        .cloned()
        .collect();
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
    }
}

pub fn apply_player_pinned(app: &AppHandle, _lesson_no: Option<u32>, pinned: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PLAYER_WINDOW_LABEL) {
        window
            .set_always_on_top(pinned)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
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

fn show_panel(app: &AppHandle) {
    activate_for_action(app);
    if let Some(window) = app.get_webview_window("panel") {
        let _ = window.show();
        let _ = window.set_focus();
    }
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

    show_panel(app);
}

pub fn ensure_player_window(app: &AppHandle, lesson_no: u32) -> Result<(), String> {
    activate_for_action(app);
    close_legacy_player_windows(app);
    set_active_player_lesson(app, lesson_no);

    if let Some(window) = app.get_webview_window(PLAYER_WINDOW_LABEL) {
        let title = format!("第{lesson_no}节");
        let _ = window.set_title(&title);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("player-open", lesson_no);
        return Ok(());
    }

    let pinned = commands::settings_for(app)
        .map(|(_, settings)| settings.player_pinned())
        .unwrap_or(true);

    let url = WebviewUrl::App(format!("index.html?view=player&lesson={lesson_no}").into());
    let mut builder = WebviewWindowBuilder::new(app, PLAYER_WINDOW_LABEL, url)
        .title(format!("第{lesson_no}节"))
        .inner_size(640.0, 360.0)
        .min_inner_size(360.0, 202.0)
        .decorations(true)
        .title_bar_style(TitleBarStyle::Overlay)
        .always_on_top(pinned)
        .resizable(true);

    #[cfg(target_os = "macos")]
    {
        use tauri::LogicalPosition;
        use crate::macos_traffic_lights::TRAFFIC_LIGHT_Y;
        builder = builder
            .hidden_title(true)
            .traffic_light_position(LogicalPosition::new(-80.0, TRAFFIC_LIGHT_Y));
    }

    builder.build().map_err(|e| e.to_string())?;

    Ok(())
}

pub fn close_subtitle_window(app: &AppHandle, lesson_no: u32) {
    let label = format!("subtitle-{lesson_no}");
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    }
}

pub fn subtitle_window_size(cat_mode: bool) -> (f64, f64) {
    if cat_mode {
        (560.0, 220.0)
    } else {
        (640.0, 88.0)
    }
}

pub fn apply_subtitle_window_layout(window: &WebviewWindow, cat_mode: bool) {
    let (w, h) = subtitle_window_size(cat_mode);
    let _ = window.set_size(LogicalSize::new(w, h));
    let _ = window.set_min_size(Some(LogicalSize::new(
        if cat_mode { 320.0 } else { 320.0 },
        if cat_mode { 150.0 } else { 64.0 },
    )));
}

pub fn refresh_subtitle_windows_for_mode(app: &AppHandle, cat_mode: bool) {
    let windows: Vec<_> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with("subtitle-"))
        .map(|(_, window)| window)
        .collect();
    for window in windows {
        apply_subtitle_window_layout(&window, cat_mode);
        let _ = window.emit("subtitle-cat-mode", cat_mode);
    }
}

pub fn ensure_subtitle_window(app: &AppHandle, lesson_no: u32) -> Result<(), String> {
    let label = format!("subtitle-{lesson_no}");
    let cat_mode = settings::settings_path(app)
        .map(|path| settings::Settings::load(&path).subtitle_cat_mode())
        .unwrap_or(true);

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.set_always_on_top(true);
        apply_subtitle_window_layout(&window, cat_mode);
        let _ = window.emit("subtitle-open", lesson_no);
        let _ = window.emit("subtitle-cat-mode", cat_mode);
        return Ok(());
    }

    let (w, h) = subtitle_window_size(cat_mode);
    let url = WebviewUrl::App(format!("index.html?view=subtitle&lesson={lesson_no}").into());
    WebviewWindowBuilder::new(app, &label, url)
        .title("字幕")
        .inner_size(w, h)
        .min_inner_size(
            if cat_mode { 320.0 } else { 320.0 },
            if cat_mode { 150.0 } else { 64.0 },
        )
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}
