#![cfg(target_os = "macos")]

use objc2_app_kit::{NSView, NSWindow, NSWindowButton};

/// macOS overlay 模式下交通灯距左/上的标准 inset（逻辑像素）。
pub const TRAFFIC_LIGHT_X: f64 = 14.0;
pub const TRAFFIC_LIGHT_Y: f64 = 14.0;

/// 显示时：同步原生标题栏容器高度 + 交通灯位置（与 CSS 顶栏对齐）。
unsafe fn show_traffic_lights(window: &NSWindow) {
    let Some(close) = window.standardWindowButton(NSWindowButton::CloseButton) else {
        return;
    };
    let Some(miniaturize) = window.standardWindowButton(NSWindowButton::MiniaturizeButton) else {
        return;
    };
    let zoom = window.standardWindowButton(NSWindowButton::ZoomButton);

    let title_bar_container = close.superview().unwrap().superview().unwrap();
    let close_rect = NSView::frame(&close);
    let title_bar_frame_height = close_rect.size.height + TRAFFIC_LIGHT_Y;
    let mut title_bar_rect = NSView::frame(&title_bar_container);
    title_bar_rect.size.height = title_bar_frame_height;
    title_bar_rect.origin.y = window.frame().size.height - title_bar_frame_height;
    title_bar_container.setFrame(title_bar_rect);

    let space_between = NSView::frame(&miniaturize).origin.x - close_rect.origin.x;
    let mut buttons = vec![&close, &miniaturize];
    if let Some(ref z) = zoom {
        buttons.push(z);
    }

    for (i, button) in buttons.into_iter().enumerate() {
        let mut rect = NSView::frame(button);
        rect.origin.x = TRAFFIC_LIGHT_X + (i as f64 * space_between);
        button.setFrameOrigin(rect.origin);
    }
}

/// 隐藏时：仅把交通灯移出可视区，不改标题栏容器尺寸。
unsafe fn hide_traffic_lights(window: &NSWindow) {
    let Some(close) = window.standardWindowButton(NSWindowButton::CloseButton) else {
        return;
    };
    let Some(miniaturize) = window.standardWindowButton(NSWindowButton::MiniaturizeButton) else {
        return;
    };
    let zoom = window.standardWindowButton(NSWindowButton::ZoomButton);

    let close_rect = NSView::frame(&close);
    let space_between = NSView::frame(&miniaturize).origin.x - close_rect.origin.x;
    let mut buttons = vec![&close, &miniaturize];
    if let Some(ref z) = zoom {
        buttons.push(z);
    }

    for (i, button) in buttons.into_iter().enumerate() {
        let mut rect = NSView::frame(button);
        rect.origin.x = -80.0 + (i as f64 * space_between);
        button.setFrameOrigin(rect.origin);
    }
}

pub fn set_traffic_lights_visible(window: &tauri::WebviewWindow, visible: bool) -> Result<(), String> {
    window
        .with_webview(move |webview| {
            use objc2_app_kit::NSWindow;
            let ns_ptr = webview.ns_window();
            // SAFETY: ns_ptr 来自当前 Webview 的 NSWindow 句柄。
            unsafe {
                let ns_window = &*(ns_ptr.cast::<NSWindow>());
                if visible {
                    show_traffic_lights(ns_window);
                } else {
                    hide_traffic_lights(ns_window);
                }
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}
