use std::path::{Path, PathBuf};

use libloading::Library;

const LINK_MODE: &str = "dynamic";
const REQUIRED_SYMBOLS: [&[u8]; 8] = [
    b"Moss_Init\0",
    b"Moss_Start\0",
    b"Moss_Stop\0",
    b"Moss_Subscribe\0",
    b"Moss_Publish\0",
    b"Moss_SetCallback\0",
    b"Moss_SetKeyStore\0",
    b"Moss_Free\0",
];

#[cfg(target_os = "windows")]
const MOSS_LIBRARY_NAME: &str = "moss.dll";
#[cfg(target_os = "macos")]
const MOSS_LIBRARY_NAME: &str = "libmoss.dylib";
#[cfg(all(unix, not(target_os = "macos")))]
const MOSS_LIBRARY_NAME: &str = "libmoss.so";

pub trait MossRuntime {
    fn status(&self) -> MossRuntimeStatus;
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MossRuntimeStatus {
    pub link_mode: &'static str,
    pub library_name: &'static str,
    pub required_symbols: Vec<String>,
    pub available: bool,
    pub checked_paths: Vec<String>,
}

#[derive(Debug)]
pub enum MossRuntimeError {
    Load(String),
    MissingSymbol(String),
}

impl std::fmt::Display for MossRuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Load(error) => write!(formatter, "Moss dynamic load error: {error}"),
            Self::MissingSymbol(symbol) => write!(formatter, "Moss FFI symbol missing: {symbol}"),
        }
    }
}

impl std::error::Error for MossRuntimeError {}

pub struct MossDynamicRuntime {
    candidate_paths: Vec<PathBuf>,
}

pub struct LoadedMossRuntime {
    _library: Library,
}

impl MossDynamicRuntime {
    pub fn from_default_candidates() -> Self {
        Self {
            candidate_paths: default_candidate_paths(),
        }
    }

    pub fn load_from_path(path: &Path) -> Result<LoadedMossRuntime, MossRuntimeError> {
        let library = unsafe { Library::new(path) }
            .map_err(|error| MossRuntimeError::Load(error.to_string()))?;

        verify_required_symbols(&library)?;

        Ok(LoadedMossRuntime { _library: library })
    }

    pub fn first_available_path(&self) -> Option<PathBuf> {
        self.candidate_paths
            .iter()
            .find(|path| path.exists() && Self::load_from_path(path).is_ok())
            .cloned()
    }
}

impl MossRuntime for MossDynamicRuntime {
    fn status(&self) -> MossRuntimeStatus {
        let available = self.first_available_path().is_some();

        MossRuntimeStatus {
            link_mode: LINK_MODE,
            library_name: MOSS_LIBRARY_NAME,
            required_symbols: required_symbol_names(),
            available,
            checked_paths: self
                .candidate_paths
                .iter()
                .map(|path| path.display().to_string())
                .collect(),
        }
    }
}

fn default_candidate_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join(MOSS_LIBRARY_NAME));
        candidates.push(
            current_dir
                .join("src-tauri")
                .join("target")
                .join("moss-test")
                .join(MOSS_LIBRARY_NAME),
        );
        candidates.push(current_dir.join("..").join("moss").join(MOSS_LIBRARY_NAME));
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join(MOSS_LIBRARY_NAME));
        }
    }

    candidates
}

fn verify_required_symbols(library: &Library) -> Result<(), MossRuntimeError> {
    for symbol in REQUIRED_SYMBOLS {
        unsafe { library.get::<unsafe extern "C" fn()>(symbol) }
            .map_err(|_| MossRuntimeError::MissingSymbol(symbol_name(symbol)))?;
    }

    Ok(())
}

fn required_symbol_names() -> Vec<String> {
    REQUIRED_SYMBOLS
        .iter()
        .map(|symbol| symbol_name(symbol))
        .collect()
}

fn symbol_name(symbol: &[u8]) -> String {
    let name = symbol.strip_suffix(&[0]).unwrap_or(symbol);

    String::from_utf8_lossy(name).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dynamic_runtime_reports_candidate_paths() {
        let runtime = MossDynamicRuntime::from_default_candidates();
        let status = runtime.status();

        assert_eq!(status.link_mode, LINK_MODE);
        assert_eq!(status.library_name, MOSS_LIBRARY_NAME);
        assert!(status.required_symbols.contains(&"Moss_Init".to_string()));
        assert!(!status.checked_paths.is_empty());
    }
}
