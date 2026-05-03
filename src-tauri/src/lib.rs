pub mod adapters;

use std::sync::Mutex;

use adapters::moss_ffi::MossFfiRuntime;
use adapters::moss_runtime::{MossDynamicRuntime, MossRuntime, MossRuntimeStatus};
use adapters::openmls_crypto::{
    run_openmls_alice_bob_roundtrip, run_openmls_smoke_test, OpenMlsRoundTripStatus,
    OpenMlsSmokeStatus,
};
use adapters::private_dm_runtime::{
    AcceptInviteRequest, InviteCreated, PrivateDmRuntime, SendMessageResult, SessionSnapshot,
    StartSessionRequest,
};
use adapters::secure_storage::{OsSecureSecretStore, SecureStorageStatus};
use tauri::Manager;

const APP_NAME: &str = "Mosh";
const PRIVACY_MODEL: &str = "OpenMLS private messages over Moss transport";
const DISCOVERY_MODEL: &str = "default public Moss trackers";
const MOSS_LINK_MODE: &str = "dynamic";
const RUN_ERROR: &str = "failed to run Mosh desktop shell";
const PRIVATE_DM_UNAVAILABLE: &str = "private DM runtime unavailable";

#[derive(serde::Serialize)]
struct AppDiagnostics {
    app_name: &'static str,
    privacy_model: &'static str,
    discovery_model: &'static str,
    moss_link_mode: &'static str,
}

#[derive(serde::Serialize)]
struct NativeRuntimeStatus {
    moss: MossRuntimeStatus,
    secure_storage: SecureStorageStatus,
    openmls_smoke: Result<OpenMlsSmokeStatus, String>,
    openmls_roundtrip: Result<OpenMlsRoundTripStatus, String>,
}

struct PrivateDmState {
    runtime: Mutex<Option<PrivateDmRuntime>>,
    load_error: Option<String>,
}

impl PrivateDmState {
    fn ready(moss: MossFfiRuntime) -> Self {
        Self {
            runtime: Mutex::new(Some(PrivateDmRuntime::new(moss))),
            load_error: None,
        }
    }

    fn missing(error: String) -> Self {
        Self {
            runtime: Mutex::new(None),
            load_error: Some(error),
        }
    }

    fn with_runtime<T>(
        &self,
        action: impl FnOnce(&mut PrivateDmRuntime) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self
            .runtime
            .lock()
            .map_err(|_| "private DM runtime lock poisoned".to_string())?;
        let runtime = guard.as_mut().ok_or_else(|| self.unavailable_message())?;

        action(runtime)
    }

    fn unavailable_message(&self) -> String {
        match &self.load_error {
            Some(error) => format!("{PRIVATE_DM_UNAVAILABLE}: {error}"),
            None => PRIVATE_DM_UNAVAILABLE.to_string(),
        }
    }
}

fn current_diagnostics() -> AppDiagnostics {
    AppDiagnostics {
        app_name: APP_NAME,
        privacy_model: PRIVACY_MODEL,
        discovery_model: DISCOVERY_MODEL,
        moss_link_mode: MOSS_LINK_MODE,
    }
}

#[tauri::command]
fn app_diagnostics() -> AppDiagnostics {
    current_diagnostics()
}

#[tauri::command]
fn native_runtime_status() -> NativeRuntimeStatus {
    NativeRuntimeStatus {
        moss: MossDynamicRuntime::from_default_candidates().status(),
        secure_storage: OsSecureSecretStore::status(),
        openmls_smoke: run_openmls_smoke_test().map_err(|error| error.to_string()),
        openmls_roundtrip: run_openmls_alice_bob_roundtrip().map_err(|error| error.to_string()),
    }
}

#[tauri::command]
fn private_dm_create_invite(
    state: tauri::State<'_, PrivateDmState>,
    request: StartSessionRequest,
) -> Result<InviteCreated, String> {
    state.with_runtime(|runtime| {
        runtime
            .create_invite(request)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_accept_invite(
    state: tauri::State<'_, PrivateDmState>,
    request: AcceptInviteRequest,
) -> Result<SessionSnapshot, String> {
    state.with_runtime(|runtime| {
        runtime
            .accept_invite(request)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_send_message(
    state: tauri::State<'_, PrivateDmState>,
    body: String,
) -> Result<SendMessageResult, String> {
    state.with_runtime(|runtime| {
        runtime
            .send_message(body)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_poll(state: tauri::State<'_, PrivateDmState>) -> Result<SessionSnapshot, String> {
    state.with_runtime(|runtime| runtime.poll().map_err(|error| error.to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = match MossFfiRuntime::load_from_app_handle(app.handle()) {
                Ok(moss) => PrivateDmState::ready(moss),
                Err(error) => PrivateDmState::missing(error.to_string()),
            };
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_diagnostics,
            native_runtime_status,
            private_dm_create_invite,
            private_dm_accept_invite,
            private_dm_send_message,
            private_dm_poll
        ])
        .run(tauri::generate_context!())
        .expect(RUN_ERROR);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostics_describe_the_desktop_tracer_bullet() {
        let diagnostics = current_diagnostics();

        assert_eq!(diagnostics.app_name, APP_NAME);
        assert_eq!(diagnostics.privacy_model, PRIVACY_MODEL);
        assert_eq!(diagnostics.discovery_model, DISCOVERY_MODEL);
        assert_eq!(diagnostics.moss_link_mode, MOSS_LINK_MODE);
    }

    #[test]
    fn runtime_status_checks_native_adapters() {
        let status = native_runtime_status();

        assert_eq!(status.moss.link_mode, MOSS_LINK_MODE);
        assert_eq!(status.secure_storage.backend, "os-keychain");
        assert!(status.openmls_smoke.is_ok());
        assert!(status.openmls_roundtrip.is_ok());
    }

    #[test]
    fn private_dm_state_reports_missing_runtime() {
        let state = PrivateDmState::missing("missing moss.dll".to_string());
        let error = state
            .with_runtime(|_| Ok(()))
            .expect_err("runtime should be missing");

        assert!(error.contains(PRIVATE_DM_UNAVAILABLE));
        assert!(error.contains("missing moss.dll"));
    }
}
