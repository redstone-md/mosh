use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

const SETTINGS_PATH: &str = "config/settings.json";
const IDENTITY_PATH: &str = "keys/signing-identity.json";
const ARCHIVES_DIR: &str = "data/archives";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageOverview {
    pub base_dir: String,
    pub settings_path: String,
    pub identity_path: String,
    pub archives_dir: String,
    pub archive_count: usize,
    pub has_settings: bool,
    pub has_signing_identity: bool,
}

struct StoragePaths {
    base_dir: PathBuf,
    settings_path: PathBuf,
    identity_path: PathBuf,
    archives_dir: PathBuf,
}

impl StoragePaths {
    fn resolve<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
        let base_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|err| format!("failed to resolve app local data directory: {err}"))?;
        Ok(Self::for_base_dir(base_dir))
    }

    fn for_base_dir(base_dir: PathBuf) -> Self {
        Self {
            settings_path: base_dir.join(SETTINGS_PATH),
            identity_path: base_dir.join(IDENTITY_PATH),
            archives_dir: base_dir.join(ARCHIVES_DIR),
            base_dir,
        }
    }

    fn archive_path(&self, room_id: &str) -> PathBuf {
        self.archives_dir.join(archive_file_name(room_id))
    }

    fn overview(&self) -> StorageOverview {
        StorageOverview {
            base_dir: self.base_dir.display().to_string(),
            settings_path: self.settings_path.display().to_string(),
            identity_path: self.identity_path.display().to_string(),
            archives_dir: self.archives_dir.display().to_string(),
            archive_count: archive_paths(&self.archives_dir)
                .map(|archives| archives.len())
                .unwrap_or(0),
            has_settings: self.settings_path.exists(),
            has_signing_identity: self.identity_path.exists(),
        }
    }
}

#[derive(Serialize)]
struct StorageBackup {
    schema_version: u8,
    exported_at_unix_ms: u128,
    settings: Option<Value>,
    signing_identity: Option<Value>,
    archives: Vec<Value>,
}

pub fn load_shell_preferences<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<Value>, String> {
    let paths = StoragePaths::resolve(app)?;
    read_json(&paths.settings_path)
}

pub fn save_shell_preferences<R: tauri::Runtime>(
    app: &AppHandle<R>,
    payload: Value,
) -> Result<(), String> {
    let paths = StoragePaths::resolve(app)?;
    write_json(&paths.settings_path, &payload)
}

pub fn load_signing_identity<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<Value>, String> {
    let paths = StoragePaths::resolve(app)?;
    read_json(&paths.identity_path)
}

pub fn save_signing_identity<R: tauri::Runtime>(
    app: &AppHandle<R>,
    payload: Value,
) -> Result<(), String> {
    let paths = StoragePaths::resolve(app)?;
    write_json(&paths.identity_path, &payload)
}

pub fn load_room_archive<R: tauri::Runtime>(
    app: &AppHandle<R>,
    room_id: &str,
) -> Result<Option<Value>, String> {
    let paths = StoragePaths::resolve(app)?;
    read_json(&paths.archive_path(room_id))
}

pub fn save_room_archive<R: tauri::Runtime>(
    app: &AppHandle<R>,
    room_id: &str,
    payload: Value,
) -> Result<(), String> {
    let paths = StoragePaths::resolve(app)?;
    write_json(&paths.archive_path(room_id), &payload)
}

pub fn storage_overview<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<StorageOverview, String> {
    let paths = StoragePaths::resolve(app)?;
    Ok(paths.overview())
}

pub fn export_storage_backup<R: tauri::Runtime>(
    app: &AppHandle<R>,
    output_path: &str,
) -> Result<(), String> {
    let output_path = PathBuf::from(output_path);
    if output_path.as_os_str().is_empty() {
        return Err("backup path is required".to_string());
    }

    let paths = StoragePaths::resolve(app)?;
    let backup = build_backup(&paths)?;
    let payload = serde_json::to_value(backup)
        .map_err(|err| format!("failed to serialize backup payload: {err}"))?;
    write_json(&output_path, &payload)
}

fn read_json(path: &Path) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path)
        .map_err(|err| format!("failed to read {}: {err}", path.display()))?;
    let parsed = serde_json::from_str(&raw)
        .map_err(|err| format!("failed to parse {}: {err}", path.display()))?;
    Ok(Some(parsed))
}

fn write_json(path: &Path, payload: &Value) -> Result<(), String> {
    ensure_parent_dir(path)?;
    let raw = serde_json::to_string_pretty(payload)
        .map_err(|err| format!("failed to serialize {}: {err}", path.display()))?;
    fs::write(path, raw).map_err(|err| format!("failed to write {}: {err}", path.display()))
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("storage path {} has no parent directory", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|err| format!("failed to create {}: {err}", parent.display()))
}

fn build_backup(paths: &StoragePaths) -> Result<StorageBackup, String> {
    Ok(StorageBackup {
        schema_version: 1,
        exported_at_unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|err| format!("system clock is before unix epoch: {err}"))?
            .as_millis(),
        settings: read_json(&paths.settings_path)?,
        signing_identity: read_json(&paths.identity_path)?,
        archives: read_archives(&paths.archives_dir)?,
    })
}

fn read_archives(archives_dir: &Path) -> Result<Vec<Value>, String> {
    let archive_paths = archive_paths(archives_dir)?;
    let mut archives = Vec::with_capacity(archive_paths.len());

    for path in archive_paths {
        if let Some(archive) = read_json(&path)? {
            archives.push(archive);
        }
    }

    Ok(archives)
}

fn archive_paths(archives_dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !archives_dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(archives_dir)
        .map_err(|err| format!("failed to read {}: {err}", archives_dir.display()))?
    {
        let entry = entry.map_err(|err| format!("failed to read archive entry: {err}"))?;
        let path = entry.path();
        if path.is_file() {
            entries.push(path);
        }
    }

    entries.sort();
    Ok(entries)
}

fn archive_file_name(room_id: &str) -> String {
    let mut file_name = String::with_capacity(room_id.len() + 5);

    for ch in room_id.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
            file_name.push(ch);
        } else {
            file_name.push('_');
            file_name.push_str(&format!("{:x}", ch as u32));
        }
    }

    file_name.push_str(".json");
    file_name
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{archive_file_name, build_backup, read_json, write_json, StoragePaths};
    use serde_json::json;

    #[test]
    fn storage_paths_match_expected_layout() {
        let base_dir = PathBuf::from("C:/Users/example/AppData/Local/md.redstone.mosh");
        let paths = StoragePaths::for_base_dir(base_dir.clone());

        assert_eq!(paths.settings_path, base_dir.join("config/settings.json"));
        assert_eq!(
            paths.identity_path,
            base_dir.join("keys/signing-identity.json")
        );
        assert_eq!(paths.archives_dir, base_dir.join("data/archives"));
    }

    #[test]
    fn archive_file_names_escape_unsupported_characters() {
        assert_eq!(archive_file_name("lobby"), "lobby.json");
        assert_eq!(archive_file_name("dm:peer/one"), "dm_3apeer_2fone.json");
    }

    #[test]
    fn json_roundtrip_writes_to_nested_directory() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let path = std::env::temp_dir()
            .join(format!("mosh-storage-test-{unique}"))
            .join("config/settings.json");
        let payload = json!({
            "theme": "moss",
            "onboardingCompleted": true
        });

        write_json(&path, &payload).expect("storage write should succeed");
        let loaded = read_json(&path)
            .expect("storage read should succeed")
            .expect("payload should exist");

        assert_eq!(loaded, payload);

        let _ = fs::remove_dir_all(
            path.parent()
                .and_then(Path::parent)
                .expect("temp test path should have a root directory"),
        );
    }

    #[test]
    fn backup_collects_settings_identity_and_archives() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after unix epoch")
            .as_nanos();
        let base_dir = std::env::temp_dir().join(format!("mosh-backup-test-{unique}"));
        let paths = StoragePaths::for_base_dir(base_dir.clone());

        write_json(&paths.settings_path, &json!({ "theme": "moss" }))
            .expect("settings write should succeed");
        write_json(&paths.identity_path, &json!({ "fingerprint": "aa:bb" }))
            .expect("identity write should succeed");
        write_json(
            &paths.archive_path("lobby"),
            &json!({ "roomId": "lobby", "signature": "sig" }),
        )
        .expect("archive write should succeed");

        let backup = build_backup(&paths).expect("backup build should succeed");

        assert_eq!(backup.schema_version, 1);
        assert_eq!(backup.settings, Some(json!({ "theme": "moss" })));
        assert_eq!(
            backup.signing_identity,
            Some(json!({ "fingerprint": "aa:bb" }))
        );
        assert_eq!(backup.archives.len(), 1);
        assert_eq!(
            backup.archives[0],
            json!({ "roomId": "lobby", "signature": "sig" })
        );

        let _ = fs::remove_dir_all(base_dir);
    }
}
