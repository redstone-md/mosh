//! Tauri-specific glue for locating the Moss shared library. `mosh-core` knows
//! the platform-independent candidate paths; only the desktop shell can resolve
//! the copy bundled as a Tauri resource, so that lookup lives here.

use crate::adapters::moss_ffi::{MossFfiError, MossFfiRuntime};
use crate::adapters::moss_runtime::{MossDynamicRuntime, MossRuntimeError, MOSS_LIBRARY_NAME};

use std::path::PathBuf;

pub fn load_moss_runtime_from_app_handle(
    handle: &tauri::AppHandle,
) -> Result<MossFfiRuntime, MossFfiError> {
    let runtime = match resource_library_path(handle) {
        Some(path) => MossDynamicRuntime::with_preferred_candidate(path),
        None => MossDynamicRuntime::from_default_candidates(),
    };

    let path = runtime
        .first_available_path()
        .ok_or_else(|| MossFfiError::Runtime(MossRuntimeError::Load("library not found".into())))?;

    MossFfiRuntime::load_from_path(&path)
}

fn resource_library_path(handle: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::{path::BaseDirectory, Manager};

    handle
        .path()
        .resolve(
            format!("moss-runtime/{MOSS_LIBRARY_NAME}"),
            BaseDirectory::Resource,
        )
        .ok()
}
