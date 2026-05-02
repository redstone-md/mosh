use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

const SETTINGS_PATH: &str = "config/settings.json";
const IDENTITY_PATH: &str = "keys/signing-identity.json";
const ARCHIVES_DIR: &str = "data/archives";
const MAX_IMPORTED_BACKUP_BYTES: u64 = 64 * 1024 * 1024;

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

    fn legacy_archive_path(&self, room_id: &str) -> PathBuf {
        self.archives_dir.join(legacy_archive_file_name(room_id))
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

#[derive(Deserialize)]
struct ImportedStorageBackup {
    schema_version: u8,
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
    read_room_archive(&paths, room_id)
}

pub fn save_room_archive<R: tauri::Runtime>(
    app: &AppHandle<R>,
    room_id: &str,
    payload: Value,
) -> Result<(), String> {
    let paths = StoragePaths::resolve(app)?;
    write_json(&paths.archive_path(room_id), &payload)
}

pub fn load_all_room_archives<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<Vec<Value>, String> {
    let paths = StoragePaths::resolve(app)?;
    read_archives(&paths.archives_dir)
}

pub fn storage_overview<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<StorageOverview, String> {
    let paths = StoragePaths::resolve(app)?;
    Ok(paths.overview())
}

pub fn export_storage_backup<R: tauri::Runtime>(
    app: &AppHandle<R>,
    output_path: &Path,
) -> Result<(), String> {
    if output_path.as_os_str().is_empty() {
        return Err("backup path is required".to_string());
    }

    let paths = StoragePaths::resolve(app)?;
    let backup = build_backup(&paths)?;
    let payload = serde_json::to_value(backup)
        .map_err(|err| format!("failed to serialize backup payload: {err}"))?;
    write_json(output_path, &payload)
}

pub fn import_storage_backup<R: tauri::Runtime>(
    app: &AppHandle<R>,
    input_path: &Path,
) -> Result<(), String> {
    let paths = StoragePaths::resolve(app)?;
    import_backup_from_path(&paths, input_path)
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

fn read_room_archive(paths: &StoragePaths, room_id: &str) -> Result<Option<Value>, String> {
    if let Some(archive) = read_json(&paths.archive_path(room_id))? {
        return Ok(Some(archive));
    }

    let legacy_path = paths.legacy_archive_path(room_id);
    if legacy_path == paths.archive_path(room_id) {
        return Ok(None);
    }

    read_json(&legacy_path)
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("storage path {} has no parent directory", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|err| format!("failed to create {}: {err}", parent.display()))
}

fn clear_existing_storage(paths: &StoragePaths) -> Result<(), String> {
    if paths.settings_path.exists() {
        fs::remove_file(&paths.settings_path)
            .map_err(|err| format!("failed to remove {}: {err}", paths.settings_path.display()))?;
    }
    if paths.identity_path.exists() {
        fs::remove_file(&paths.identity_path)
            .map_err(|err| format!("failed to remove {}: {err}", paths.identity_path.display()))?;
    }
    if paths.archives_dir.exists() {
        fs::remove_dir_all(&paths.archives_dir)
            .map_err(|err| format!("failed to clear {}: {err}", paths.archives_dir.display()))?;
    }
    Ok(())
}

fn import_backup_from_path(paths: &StoragePaths, input_path: &Path) -> Result<(), String> {
    if input_path.as_os_str().is_empty() {
        return Err("backup path is required".to_string());
    }

    let raw = read_backup_file(input_path)?;
    let backup: ImportedStorageBackup = serde_json::from_str(&raw)
        .map_err(|err| format!("failed to parse {}: {err}", input_path.display()))?;

    if backup.schema_version != 1 {
        return Err(format!(
            "unsupported backup schema version: {}",
            backup.schema_version
        ));
    }

    for archive in &backup.archives {
        let room_id = archive
            .get("roomId")
            .and_then(Value::as_str)
            .ok_or_else(|| "backup archive room id is required".to_string())?
            .trim();
        if room_id.is_empty() {
            return Err("backup archive room id is required".to_string());
        }
        if !archive.is_object() {
            return Err("backup archive payload must be an object".to_string());
        }
    }

    clear_existing_storage(paths)?;

    if let Some(settings) = backup.settings {
        write_json(&paths.settings_path, &settings)?;
    }

    if let Some(identity) = backup.signing_identity {
        write_json(&paths.identity_path, &identity)?;
    }

    for archive in backup.archives {
        let room_id = archive
            .get("roomId")
            .and_then(Value::as_str)
            .expect("validated above");
        write_json(&paths.archive_path(room_id), &archive)?;
    }

    Ok(())
}

fn read_backup_file(input_path: &Path) -> Result<String, String> {
    if !input_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
    {
        return Err(format!(
            "backup path must point to a .json file: {}",
            input_path.display()
        ));
    }

    let metadata = fs::metadata(input_path)
        .map_err(|err| format!("failed to inspect {}: {err}", input_path.display()))?;

    if !metadata.is_file() {
        return Err(format!(
            "backup path must be a regular file: {}",
            input_path.display()
        ));
    }

    if metadata.len() > MAX_IMPORTED_BACKUP_BYTES {
        return Err(format!(
            "backup file {} exceeds {} byte limit",
            input_path.display(),
            MAX_IMPORTED_BACKUP_BYTES
        ));
    }

    let mut file = fs::File::open(input_path)
        .map_err(|err| format!("failed to open {}: {err}", input_path.display()))?;
    let mut raw = String::new();
    file.by_ref()
        .take(MAX_IMPORTED_BACKUP_BYTES + 1)
        .read_to_string(&mut raw)
        .map_err(|err| format!("failed to read {}: {err}", input_path.display()))?;

    if raw.len() as u64 > MAX_IMPORTED_BACKUP_BYTES {
        return Err(format!(
            "backup file {} exceeds {} byte limit",
            input_path.display(),
            MAX_IMPORTED_BACKUP_BYTES
        ));
    }

    Ok(raw)
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
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '.') {
            file_name.push(ch);
        } else {
            file_name.push('_');
            file_name.push_str(&format!("{:x}", ch as u32));
            file_name.push('_');
        }
    }

    file_name.push_str(".json");
    file_name
}

fn legacy_archive_file_name(room_id: &str) -> String {
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
mod tests;
