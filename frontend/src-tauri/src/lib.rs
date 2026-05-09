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

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Builder, Emitter, Manager,
};

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
        // Native confirm dialogs. Backs the CloseGuardManager prompt
        // when the user tries to quit while a discovery is running.
        .plugin(tauri_plugin_dialog::init())
        // Auto-launch on login. The plugin needs to be registered at
        // build time even when the user has the toggle disabled — the
        // plugin's enable/disable APIs read/mutate OS-level startup
        // entries (Windows registry / macOS LaunchAgents / Linux
        // .desktop autostart). No CLI args passed; humanovo opens to
        // the dashboard like a normal launch.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
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

            // System tray. Left-click anywhere in the tray icon brings
            // the main window forward (Windows/Linux convention; macOS
            // uses left-click for the menu, which Tauri handles
            // automatically once `menu_on_left_click(true)` is set).
            // Right-click opens the menu on all platforms.
            //
            // Failures (missing icon, no D-Bus on Linux, OS without a
            // tray surface) are logged-and-swallowed: the rest of the
            // app continues to work. Losing the tray is a degraded
            // UX, not a fatal error.
            #[cfg(desktop)]
            if let Err(e) = setup_tray(app) {
                eprintln!("tray: setup failed, continuing without it: {e:?}");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running humanovo desktop app");
}

/// Initialise the system tray. Extracted from `setup` so the bulky
/// menu / icon / event-handler code doesn't dominate `run`. Returns
/// `Err` on missing icon or platform-init failure; the caller logs
/// and continues without a tray.
#[cfg(desktop)]
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Show humanovo", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let icon = app
        .default_window_icon()
        .ok_or("default window icon not bundled — tray skipped")?
        .clone();

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("humanovo")
        .menu(&menu)
        // macOS: clicking the tray icon directly should pop the menu,
        // matching system convention. Windows / Linux: leave default
        // (false) so the click event can route to "show window".
        .menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            // Route Quit through the main window's close-requested
            // event so the renderer's CloseGuardManager gets a chance
            // to prompt the user when a discovery is running. If the
            // window is missing (shouldn't happen, but tray may fire
            // post-close on macOS), fall back to a hard exit.
            "quit" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.close();
                } else {
                    app.exit(0);
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Single left-click → focus the main window. Skipped on
            // macOS where the OS routes the click to the menu (see
            // menu_on_left_click above).
            if cfg!(target_os = "macos") {
                return;
            }
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
