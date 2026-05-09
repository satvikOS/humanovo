//! humanovo — Tauri shell library.
//!
//! Owns:
//!   * window setup (single 1440×900 default, resizable, centered),
//!   * deep-link registration for the `humanovo://` URI scheme so the
//!     OS hands Stripe checkout redirects back to the running app,
//!   * single-instance enforcement so launching humanovo twice from the
//!     dock just focuses the existing window instead of spawning a
//!     second process,
//!   * the OS / process / shell / updater plugins (everything the
//!     React app expects to find on `window.__TAURI__.*`).
//!
//! Renderer-side (React) code lives in `frontend/src/`. This crate is
//! intentionally thin — heavy logic stays in the Vite bundle so a
//! release that updates only the frontend doesn't require re-shipping
//! the native binary.

use tauri::{Builder, Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = Builder::default();

    // Single-instance handler: when a second copy of humanovo is
    // launched (typically by clicking a `humanovo://...` deep link),
    // forward its argv to the existing instance and exit. The existing
    // instance focuses its window and routes the deep-link payload to
    // the React app via the `single-instance` event.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Surface a deep-link forwarded by the secondary instance,
            // then bring the main window forward so the user sees the
            // result of whatever they clicked (e.g. Stripe redirect).
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            // Propagate raw argv to JS — the React app parses out the
            // humanovo:// URL on its own.
            let _ = app.emit("single-instance", args);
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Persists window position / size / maximized state across
        // launches. Writes to the OS-standard app-data directory; the
        // first-launch fallback is the size declared in
        // tauri.conf.json `app.windows[0]` (1440x900 centred).
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // OS-native notifications. Used when a long-running discovery
        // or agent task finishes while humanovo is in the background —
        // the user gets a system-tray ping instead of having to babysit
        // the window.
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Re-register `humanovo://` at runtime so the scheme is
            // associated with this binary on first launch (Linux),
            // matches the bundled plist (macOS), and the registry
            // entry (Windows). No-op if already registered.
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running humanovo desktop app");
}
