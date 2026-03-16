use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::{
    models::DesktopSnapshot,
    runtime_settings::RuntimeSettingsInput,
    state::SharedDesktopState,
    storage::{self, StorageOverview},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallSignalInput {
    pub target_peer_id: String,
    pub call_id: String,
    pub room: String,
    pub signal_type: String,
    pub signal_data: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowStatePayload {
    pub focused: bool,
    pub visible: bool,
    pub maximized: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoragePayloadInput {
    pub payload: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportStorageBackupInput {
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportStorageBackupInput {
    pub path: String,
}

#[tauri::command]
pub fn desktop_snapshot(state: State<'_, SharedDesktopState>) -> Result<DesktopSnapshot, String> {
    let mut state = state
        .lock()
        .map_err(|_| "desktop state lock poisoned".to_string())?;
    Ok(state.snapshot())
}

#[tauri::command]
pub fn toggle_runtime(state: State<'_, SharedDesktopState>) -> Result<DesktopSnapshot, String> {
    let mut state = state
        .lock()
        .map_err(|_| "desktop state lock poisoned".to_string())?;
    Ok(state.toggle_runtime()?)
}

#[tauri::command]
pub fn update_runtime_settings(
    state: State<'_, SharedDesktopState>,
    payload: RuntimeSettingsInput,
) -> Result<DesktopSnapshot, String> {
    let mut state = state
        .lock()
        .map_err(|_| "desktop state lock poisoned".to_string())?;
    Ok(state.update_runtime_settings(payload)?)
}

#[tauri::command]
pub fn subscribe_room(
    state: State<'_, SharedDesktopState>,
    room: String,
) -> Result<DesktopSnapshot, String> {
    let room = room.trim().trim_start_matches('#').to_lowercase();
    if room.is_empty() {
        return Err("room is required".to_string());
    }
    let mut state = state
        .lock()
        .map_err(|_| "desktop state lock poisoned".to_string())?;
    Ok(state.subscribe_room(&room)?)
}

#[tauri::command]
pub fn unsubscribe_room(
    state: State<'_, SharedDesktopState>,
    room: String,
) -> Result<DesktopSnapshot, String> {
    let room = room.trim().trim_start_matches('#').to_lowercase();
    if room.is_empty() {
        return Err("room is required".to_string());
    }
    let mut state = state
        .lock()
        .map_err(|_| "desktop state lock poisoned".to_string())?;
    Ok(state.unsubscribe_room(&room)?)
}

#[tauri::command]
pub fn connect_peer(
    state: State<'_, SharedDesktopState>,
    addr: String,
) -> Result<DesktopSnapshot, String> {
    let addr = addr.trim().to_string();
    if addr.is_empty() {
        return Err("peer address is required".to_string());
    }
    let mut state = state
        .lock()
        .map_err(|_| "desktop state lock poisoned".to_string())?;
    Ok(state.connect_peer(&addr)?)
}

#[tauri::command]
pub fn open_direct_room(
    state: State<'_, SharedDesktopState>,
    target: String,
) -> Result<DesktopSnapshot, String> {
    let target = target.trim().to_string();
    if target.is_empty() {
        return Err("direct message target is required".to_string());
    }
    let mut state = state
        .lock()
        .map_err(|_| "desktop state lock poisoned".to_string())?;
    Ok(state.open_direct_room(&target)?)
}

#[tauri::command]
pub fn publish_message(
    state: State<'_, SharedDesktopState>,
    room: String,
    body: String,
) -> Result<DesktopSnapshot, String> {
    let room = room.trim().trim_start_matches('#').to_lowercase();
    let body = body.trim().to_string();
    if room.is_empty() {
        return Err("room is required".to_string());
    }
    if body.is_empty() {
        return Err("message body is required".to_string());
    }
    let mut state = state
        .lock()
        .map_err(|_| "desktop state lock poisoned".to_string())?;
    Ok(state.publish_message(&room, &body)?)
}

#[tauri::command]
pub fn start_call(
    state: State<'_, SharedDesktopState>,
    target: String,
) -> Result<DesktopSnapshot, String> {
    let target = target.trim().to_string();
    if target.is_empty() {
        return Err("call target is required".to_string());
    }
    let mut state = state
        .lock()
        .map_err(|_| "desktop state lock poisoned".to_string())?;
    Ok(state.start_call(&target)?)
}

#[tauri::command]
pub fn answer_call(state: State<'_, SharedDesktopState>) -> Result<DesktopSnapshot, String> {
    let mut state = state
        .lock()
        .map_err(|_| "desktop state lock poisoned".to_string())?;
    Ok(state.answer_call()?)
}

#[tauri::command]
pub fn decline_call(state: State<'_, SharedDesktopState>) -> Result<DesktopSnapshot, String> {
    let mut state = state
        .lock()
        .map_err(|_| "desktop state lock poisoned".to_string())?;
    Ok(state.decline_call()?)
}

#[tauri::command]
pub fn hangup_call(state: State<'_, SharedDesktopState>) -> Result<DesktopSnapshot, String> {
    let mut state = state
        .lock()
        .map_err(|_| "desktop state lock poisoned".to_string())?;
    Ok(state.hangup_call()?)
}

#[tauri::command]
pub fn send_call_signal(
    state: State<'_, SharedDesktopState>,
    payload: CallSignalInput,
) -> Result<DesktopSnapshot, String> {
    if payload.target_peer_id.trim().is_empty() {
        return Err("target peer id is required".to_string());
    }
    if payload.call_id.trim().is_empty() {
        return Err("call id is required".to_string());
    }
    if payload.room.trim().is_empty() {
        return Err("room is required".to_string());
    }
    if payload.signal_type.trim().is_empty() {
        return Err("signal type is required".to_string());
    }
    if payload.signal_data.trim().is_empty() {
        return Err("signal data is required".to_string());
    }
    let mut state = state
        .lock()
        .map_err(|_| "desktop state lock poisoned".to_string())?;
    Ok(state.send_call_signal(
        payload.target_peer_id.trim(),
        payload.call_id.trim(),
        payload.room.trim(),
        payload.signal_type.trim(),
        payload.signal_data.trim(),
    )?)
}

#[tauri::command]
pub fn join_voice_room(
    state: State<'_, SharedDesktopState>,
    room: String,
) -> Result<DesktopSnapshot, String> {
    let room = room.trim().to_string();
    if room.is_empty() {
        return Err("voice room is required".to_string());
    }
    let mut state = state
        .lock()
        .map_err(|_| "desktop state lock poisoned".to_string())?;
    Ok(state.join_voice_room(&room)?)
}

#[tauri::command]
pub fn leave_voice_room(state: State<'_, SharedDesktopState>) -> Result<DesktopSnapshot, String> {
    let mut state = state
        .lock()
        .map_err(|_| "desktop state lock poisoned".to_string())?;
    Ok(state.leave_voice_room()?)
}

#[tauri::command]
pub fn load_shell_preferences(app: AppHandle) -> Result<Option<Value>, String> {
    storage::load_shell_preferences(&app)
}

#[tauri::command]
pub fn save_shell_preferences(app: AppHandle, payload: StoragePayloadInput) -> Result<(), String> {
    storage::save_shell_preferences(&app, payload.payload)
}

#[tauri::command]
pub fn load_signing_identity(app: AppHandle) -> Result<Option<Value>, String> {
    storage::load_signing_identity(&app)
}

#[tauri::command]
pub fn save_signing_identity(app: AppHandle, payload: StoragePayloadInput) -> Result<(), String> {
    storage::save_signing_identity(&app, payload.payload)
}

#[tauri::command]
pub fn load_room_archive(app: AppHandle, room: String) -> Result<Option<Value>, String> {
    let room = room.trim();
    if room.is_empty() {
        return Err("room is required".to_string());
    }
    storage::load_room_archive(&app, room)
}

#[tauri::command]
pub fn save_room_archive(
    app: AppHandle,
    room: String,
    payload: StoragePayloadInput,
) -> Result<(), String> {
    let room = room.trim();
    if room.is_empty() {
        return Err("room is required".to_string());
    }
    storage::save_room_archive(&app, room, payload.payload)
}

#[tauri::command]
pub fn storage_overview(app: AppHandle) -> Result<StorageOverview, String> {
    storage::storage_overview(&app)
}

#[tauri::command]
pub fn export_storage_backup(
    app: AppHandle,
    payload: ExportStorageBackupInput,
) -> Result<(), String> {
    let path = payload.path.trim();
    if path.is_empty() {
        return Err("backup path is required".to_string());
    }
    storage::export_storage_backup(&app, path)
}

#[tauri::command]
pub fn import_storage_backup(
    app: AppHandle,
    payload: ImportStorageBackupInput,
) -> Result<(), String> {
    let path = payload.path.trim();
    if path.is_empty() {
        return Err("backup path is required".to_string());
    }
    storage::import_storage_backup(&app, path)
}

#[tauri::command]
pub fn window_minimize(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window.minimize().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn window_toggle_maximize(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    if window.is_maximized().map_err(|err| err.to_string())? {
        window.unmaximize().map_err(|err| err.to_string())
    } else {
        window.maximize().map_err(|err| err.to_string())
    }
}

#[tauri::command]
pub fn window_start_drag(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window.start_dragging().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn window_hide_to_tray(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window.hide().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn window_show_main(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window.unminimize().map_err(|err| err.to_string())?;
    window.show().map_err(|err| err.to_string())?;
    window.set_focus().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn window_state(app: AppHandle) -> Result<WindowStatePayload, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    Ok(WindowStatePayload {
        focused: window.is_focused().map_err(|err| err.to_string())?,
        visible: window.is_visible().map_err(|err| err.to_string())?,
        maximized: window.is_maximized().map_err(|err| err.to_string())?,
    })
}
