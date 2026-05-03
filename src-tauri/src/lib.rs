pub mod adapters;

use adapters::moss_runtime::{MossDynamicRuntime, MossRuntime, MossRuntimeStatus};
use adapters::openmls_crypto::{
    run_openmls_alice_bob_roundtrip, run_openmls_smoke_test, OpenMlsRoundTripStatus,
    OpenMlsSmokeStatus,
};
use adapters::secure_storage::{OsSecureSecretStore, SecureStorageStatus};

const APP_NAME: &str = "Mosh";
const PRIVACY_MODEL: &str = "OpenMLS private messages over Moss transport";
const DISCOVERY_MODEL: &str = "default public Moss trackers";
const MOSS_LINK_MODE: &str = "dynamic";
const RUN_ERROR: &str = "failed to run Mosh desktop shell";

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            app_diagnostics,
            native_runtime_status
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
}
