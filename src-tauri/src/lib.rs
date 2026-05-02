mod callback_state;
mod chat_protocol;
mod commands;
mod ffi;
mod models;
mod runtime_settings;
mod snapshot_view;
mod state;
mod storage;

use crate::ffi::{library_file_name, set_bundled_runtime_path};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::path::BaseDirectory;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

const DEBUG_LOG_FILE_NAME: &str = "mosh-debug";

fn debug_log_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_log::Builder::new()
        .targets([Target::new(TargetKind::LogDir {
            file_name: Some(DEBUG_LOG_FILE_NAME.to_string()),
        })])
        .level(log::LevelFilter::Debug)
        .max_file_size(5_000_000)
        .rotation_strategy(RotationStrategy::KeepSome(4))
        .build()
}

fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn configure_bundled_runtime_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Ok(path) = app.path().resolve(
        format!("moss/{}", library_file_name()),
        BaseDirectory::Resource,
    ) {
        if path.exists() {
            set_bundled_runtime_path(path);
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(debug_log_plugin())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            log::info!("MOSH desktop shell starting.");
            configure_bundled_runtime_path(&app.handle());
            #[cfg(all(debug_assertions, any(target_os = "windows", target_os = "linux")))]
            {
                let _ = app.deep_link().register("mosh");
                let _ = app.deep_link().register("mosh-identity");
            }
            app.manage(state::SharedDesktopState::new(
                state::DesktopShellState::new(),
            ));

            let open = MenuItemBuilder::with_id("tray-open", "Open MOSH").build(app)?;
            let hide = MenuItemBuilder::with_id("tray-hide", "Hide to tray").build(app)?;
            let quit = MenuItemBuilder::with_id("tray-quit", "Quit MOSH").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&open, &hide, &quit])
                .build()?;

            let mut tray = TrayIconBuilder::new()
                .tooltip("MOSH")
                .show_menu_on_left_click(false)
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "tray-open" => show_main_window(app),
                    "tray-hide" => hide_main_window(app),
                    "tray-quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(true) {
                                let _ = window.hide();
                            } else {
                                show_main_window(&app);
                            }
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }

            let _tray = tray.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::desktop_snapshot,
            commands::toggle_runtime,
            commands::update_runtime_settings,
            commands::subscribe_room,
            commands::unsubscribe_room,
            commands::connect_peer,
            commands::open_direct_room,
            commands::publish_message,
            commands::start_call,
            commands::answer_call,
            commands::decline_call,
            commands::hangup_call,
            commands::send_call_signal,
            commands::join_voice_room,
            commands::leave_voice_room,
            commands::load_shell_preferences,
            commands::save_shell_preferences,
            commands::load_signing_identity,
            commands::save_signing_identity,
            commands::load_room_archive,
            commands::load_all_room_archives,
            commands::save_room_archive,
            commands::storage_overview,
            commands::export_storage_backup,
            commands::import_storage_backup,
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::window_start_drag,
            commands::window_hide_to_tray,
            commands::window_show_main,
            commands::window_state
        ])
        .run(tauri::generate_context!())
        .expect("failed to run moss chat dev app");
}
