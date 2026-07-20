mod commands;
#[cfg(target_os = "macos")]
mod macos_overlay_spaces;
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
/// 无播放器时的猫猫陪伴窗课节号（窗口身份用，可不挂字幕文件）
pub const CAT_COMPANION_LESSON: u32 = 0;
/// 护眼整屏黑底倒计时（每块显示器一个：eye-rest-0 / eye-rest-1 …）
pub const EYE_REST_WINDOW_PREFIX: &str = "eye-rest-";

/// 菜单栏托盘图标（编译进二进制，release .app 不依赖 default_window_icon）
fn tray_icon_image() -> tauri::image::Image<'static> {
    tauri::include_image!("icons/32x32.png")
}

fn apply_tray_icon(app: &AppHandle) {
    let tray_id = app.state::<AppState>().tray_id.clone();
    let Some(tray) = app.tray_by_id(&tray_id) else {
        return;
    };
    let _ = tray.set_icon(Some(tray_icon_image()));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(|app| {
            // 菜单栏 NSStatusItem 在部分 macOS 版本上注册不稳定；改走 Dock 常驻，保证入口始终可见。
            #[cfg(target_os = "macos")]
            app.set_activation_policy(ActivationPolicy::Regular);

            let tray = TrayIconBuilder::new()
                .icon(tray_icon_image())
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
            apply_tray_icon(app.handle());

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
            commands::open_eye_rest_overlay,
            commands::close_eye_rest_overlay,
            commands::sync_pace_today_lock,
            commands::set_player_chrome_visible,
            commands::show_panel_window,
            commands::quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            match event {
                RunEvent::Ready => {
                    apply_tray_icon(&app);
                    refresh_tray_badge(&app);
                    show_panel(&app);
                }
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
                            restore_menu_bar_presence(&app);
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
                        // 猫猫模式：字幕窗留下陪伴并清气泡；常规模式随播放器关闭
                        let keep_cat = settings::settings_path(&app)
                            .map(|path| settings::Settings::load(&path).subtitle_cat_mode())
                            .unwrap_or(true);
                        let lesson_no = app
                            .state::<AppState>()
                            .active_player_lesson
                            .lock()
                            .ok()
                            .and_then(|guard| *guard);
                        if let Some(lesson_no) = lesson_no {
                            notify_player_closed(&app, lesson_no);
                            if !keep_cat {
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

/// Dock 图标常驻，不再切回 Accessory（保留函数签名兼容既有调用点）。
pub fn restore_accessory(_app: &AppHandle) {}

fn restore_menu_bar_presence(app: &AppHandle) {
    apply_tray_icon(app);
    refresh_tray_badge(app);
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

    // Dock 图标角标：主入口已切到 Dock，未看课节数在这里提醒最直接。
    if let Some(window) = app.get_webview_window("panel") {
        let _ = window.set_badge_count(if badge.count > 0 {
            Some(badge.count as i64)
        } else {
            None
        });
    }

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

pub(crate) fn show_panel(app: &AppHandle) {
    // 托盘点击后 macOS 常立刻再丢一次焦点；短抑制，避免「闪一下就没」
    set_panel_hide_suppressed(app, true);
    ensure_cat_companion(app);
    activate_for_action(app);
    if let Some(window) = app.get_webview_window("panel") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    restore_menu_bar_presence(app);
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(450));
        if let Some(window) = handle.get_webview_window("panel") {
            let _ = window.set_focus();
        }
        set_panel_hide_suppressed(&handle, false);
    });
}

/// 通知猫猫窗：播放器已关闭 → 清气泡、idle-rest
fn notify_player_closed(app: &AppHandle, lesson_no: u32) {
    let payload = serde_json::json!({
        "lessonNo": lesson_no,
        "playing": false,
        "closed": true,
    });
    let _ = app.emit("player-playback", payload);
}

/// 猫猫模式：保证有一只陪伴猫（有播放器跟当前课；否则用 companion 窗）
pub fn ensure_cat_companion(app: &AppHandle) {
    let cat_mode = settings::settings_path(app)
        .map(|path| settings::Settings::load(&path).subtitle_cat_mode())
        .unwrap_or(true);
    if !cat_mode {
        return;
    }

    if let Some(lesson_no) = active_player_lesson(app) {
        let _ = ensure_subtitle_window(app, lesson_no);
        return;
    }

    // 关视频后留下的课节猫窗：直接亮起来即可
    for (label, window) in app.webview_windows() {
        if let Some(suffix) = label.strip_prefix("subtitle-") {
            if let Ok(lesson_no) = suffix.parse::<u32>() {
                if lesson_no != CAT_COMPANION_LESSON {
                    let _ = window.show();
                    let _ = window.set_always_on_top(true);
                    #[cfg(target_os = "macos")]
                    macos_overlay_spaces::apply_overlay_space_behavior(&window);
                    return;
                }
            }
        }
    }

    let _ = ensure_subtitle_window(app, CAT_COMPANION_LESSON);
}

fn toggle_panel(app: &AppHandle) {
    let Some(window) = app.get_webview_window("panel") else {
        return;
    };

    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    // 已在最前再点托盘才收起；可见但没焦点时改成拉到前面（避免「闪一下又没」）
    if visible && focused {
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
        // 关窗流程会先 hide：半死窗口禁止复用，直接销毁后重建
        let visible = window.is_visible().unwrap_or(false);
        if visible {
            let title = format!("第{lesson_no}节");
            let _ = window.set_title(&title);
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit("player-open", lesson_no);
            return Ok(());
        }
        let _ = window.destroy();
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
        (560.0, 280.0)
    } else {
        (640.0, 88.0)
    }
}

pub fn apply_subtitle_window_layout(window: &WebviewWindow, cat_mode: bool) {
    let (w, h) = subtitle_window_size(cat_mode);
    let _ = window.set_size(LogicalSize::new(w, h));
    let _ = window.set_min_size(Some(LogicalSize::new(
        if cat_mode { 320.0 } else { 320.0 },
        if cat_mode { 200.0 } else { 64.0 },
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

    // 真正开课字幕时收掉开机 companion，避免两只猫
    if lesson_no != CAT_COMPANION_LESSON {
        close_subtitle_window(app, CAT_COMPANION_LESSON);
    }

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.set_always_on_top(true);
        #[cfg(target_os = "macos")]
        macos_overlay_spaces::apply_overlay_space_behavior(&window);
        apply_subtitle_window_layout(&window, cat_mode);
        let _ = window.emit("subtitle-open", lesson_no);
        let _ = window.emit("subtitle-cat-mode", cat_mode);
        return Ok(());
    }

    let (w, h) = subtitle_window_size(cat_mode);
    let url = WebviewUrl::App(format!("index.html?view=subtitle&lesson={lesson_no}").into());
    let window = WebviewWindowBuilder::new(app, &label, url)
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
        .visible_on_all_workspaces(true)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    #[cfg(target_os = "macos")]
    macos_overlay_spaces::apply_overlay_space_behavior(&window);

    Ok(())
}

pub fn close_eye_rest_window(app: &AppHandle) {
    let labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|label| label.starts_with(EYE_REST_WINDOW_PREFIX))
        .cloned()
        .collect();
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
    }
}

fn build_eye_rest_window_on_monitor(
    app: &AppHandle,
    label: &str,
    monitor: &tauri::Monitor,
    show_countdown: bool,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.destroy();
    }

    let scale = monitor.scale_factor();
    let phys = monitor.size();
    let pos = monitor.position();
    let logical_w = phys.width as f64 / scale;
    let logical_h = phys.height as f64 / scale;
    let logical_x = pos.x as f64 / scale;
    let logical_y = pos.y as f64 / scale;

    let url = WebviewUrl::App(
        format!(
            "index.html?view=eye-rest{}",
            if show_countdown { "&countdown=1" } else { "" }
        )
        .into(),
    );
    let window = WebviewWindowBuilder::new(app, label, url)
        .title("护眼休息")
        .inner_size(logical_w, logical_h)
        .position(logical_x, logical_y)
        .decorations(false)
        .transparent(false)
        .shadow(false)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    #[cfg(target_os = "macos")]
    macos_overlay_spaces::apply_overlay_space_behavior(&window);
    Ok(())
}

fn monitor_contains_point(monitor: &tauri::Monitor, x: f64, y: f64) -> bool {
    let pos = monitor.position();
    let size = monitor.size();
    let left = pos.x as f64;
    let top = pos.y as f64;
    let right = left + size.width as f64;
    let bottom = top + size.height as f64;
    x >= left && x < right && y >= top && y < bottom
}

/// 每块显示器各盖一层整屏黑底；倒计时只出现在鼠标所在屏（找不到则主屏）
pub fn ensure_eye_rest_window(app: &AppHandle) -> Result<(), String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let cursor = app.cursor_position().ok();
    let primary = app.primary_monitor().ok().flatten();

    let mut countdown_index: Option<usize> = None;
    if let Some(pos) = cursor {
        for (index, monitor) in monitors.iter().enumerate() {
            if monitor_contains_point(monitor, pos.x, pos.y) {
                countdown_index = Some(index);
                break;
            }
        }
    }
    if countdown_index.is_none() {
        if let (Some(primary), true) = (primary.as_ref(), !monitors.is_empty()) {
            countdown_index = monitors.iter().position(|m| {
                m.position() == primary.position() && m.size() == primary.size()
            });
        }
        if countdown_index.is_none() {
            countdown_index = Some(0);
        }
    }

    if monitors.is_empty() {
        let Some(monitor) = primary else {
            return Err("找不到显示器".to_string());
        };
        return build_eye_rest_window_on_monitor(
            app,
            &format!("{EYE_REST_WINDOW_PREFIX}0"),
            &monitor,
            true,
        );
    }

    // 已有窗可能是旧会话「全是倒计时」：先关掉再建，保证只有当前屏带 countdown
    close_eye_rest_window(app);

    for (index, monitor) in monitors.iter().enumerate() {
        let label = format!("{EYE_REST_WINDOW_PREFIX}{index}");
        let show_countdown = countdown_index == Some(index);
        build_eye_rest_window_on_monitor(app, &label, monitor, show_countdown)?;
    }
    Ok(())
}
