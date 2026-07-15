#![cfg(target_os = "macos")]

use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
use tauri::WebviewWindow;

/// 字幕/猫猫悬浮窗：跟到每个桌面，并可作为全屏 Space 的辅助窗显示。
/// （仅 alwaysOnTop 不够，macOS 全屏/多桌面需要 collectionBehavior。）
pub fn apply_overlay_space_behavior(window: &WebviewWindow) {
    let _ = window.set_visible_on_all_workspaces(true);
    let _ = window.with_webview(|webview| {
        let ns_ptr = webview.ns_window();
        // SAFETY: ns_ptr 来自当前 Webview 的 NSWindow 句柄。
        unsafe {
            let ns_window = &*(ns_ptr.cast::<NSWindow>());
            let existing = ns_window.collectionBehavior();
            ns_window.setCollectionBehavior(
                existing
                    | NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::Stationary
                    | NSWindowCollectionBehavior::FullScreenAuxiliary,
            );
        }
    });
}
