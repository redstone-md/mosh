use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::json;

use super::{
    archive_file_name, build_backup, clear_existing_storage, import_backup_from_path,
    read_archives, read_json, read_room_archive, write_json, ImportedStorageBackup, StoragePaths,
};

fn unique_temp_dir(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{unique}"))
}

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
    assert_eq!(archive_file_name("dm:peer/one"), "dm_3a_peer_2f_one.json");
    assert_eq!(archive_file_name("dev_3ateam"), "dev_5f_3ateam.json");
}

#[test]
fn archive_file_names_do_not_collide_with_escape_like_room_ids() {
    assert_ne!(
        archive_file_name("dev:team"),
        archive_file_name("dev_3ateam")
    );
    assert_ne!(
        archive_file_name("dm:peer/one"),
        archive_file_name("dm_3apeer_2fone")
    );
}

#[test]
fn room_archive_read_falls_back_to_legacy_file_name() {
    let base_dir = unique_temp_dir("mosh-legacy-archive-test");
    let paths = StoragePaths::for_base_dir(base_dir.clone());
    let legacy_path = paths.archives_dir.join("dm_3apeer_2fone.json");

    write_json(
        &legacy_path,
        &json!({ "roomId": "dm:peer/one", "messages": [] }),
    )
    .expect("legacy archive write should succeed");

    let archive = read_room_archive(&paths, "dm:peer/one")
        .expect("archive read should succeed")
        .expect("legacy archive should load");

    assert_eq!(archive["roomId"], "dm:peer/one");

    let _ = fs::remove_dir_all(base_dir);
}

#[test]
fn json_roundtrip_writes_to_nested_directory() {
    let path = unique_temp_dir("mosh-storage-test").join("config/settings.json");
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
    let base_dir = unique_temp_dir("mosh-backup-test");
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

#[test]
fn clearing_storage_removes_existing_files() {
    let base_dir = unique_temp_dir("mosh-clear-test");
    let paths = StoragePaths::for_base_dir(base_dir.clone());

    write_json(&paths.settings_path, &json!({ "theme": "moss" }))
        .expect("settings write should succeed");
    write_json(&paths.identity_path, &json!({ "fingerprint": "aa:bb" }))
        .expect("identity write should succeed");
    write_json(&paths.archive_path("lobby"), &json!({ "roomId": "lobby" }))
        .expect("archive write should succeed");

    clear_existing_storage(&paths).expect("clear should succeed");

    assert!(!paths.settings_path.exists());
    assert!(!paths.identity_path.exists());
    assert!(!paths.archives_dir.exists());

    let _ = fs::remove_dir_all(base_dir);
}

#[test]
fn imported_backup_requires_supported_schema_version() {
    let imported = serde_json::from_value::<ImportedStorageBackup>(json!({
        "schema_version": 2,
        "settings": null,
        "signing_identity": null,
        "archives": []
    }))
    .expect("payload should deserialize");

    assert_eq!(imported.schema_version, 2);
}

#[test]
fn imported_backup_keeps_archive_payloads_as_json_objects() {
    let imported = serde_json::from_value::<ImportedStorageBackup>(json!({
        "schema_version": 1,
        "settings": null,
        "signing_identity": null,
        "archives": [{ "roomId": "lobby", "signature": "sig" }]
    }))
    .expect("payload should deserialize");

    assert_eq!(imported.archives.len(), 1);
    assert_eq!(imported.archives[0]["roomId"], json!("lobby"));
}

#[test]
fn import_backup_replaces_existing_storage_contents() {
    let base_dir = unique_temp_dir("mosh-import-test");
    let paths = StoragePaths::for_base_dir(base_dir.clone());
    let backup_path = base_dir.join("backup.json");

    write_json(&paths.settings_path, &json!({ "theme": "ember" }))
        .expect("stale settings write should succeed");
    write_json(&paths.identity_path, &json!({ "fingerprint": "stale" }))
        .expect("stale identity write should succeed");
    write_json(
        &paths.archive_path("old-room"),
        &json!({ "roomId": "old-room" }),
    )
    .expect("stale archive write should succeed");
    write_json(
        &backup_path,
        &json!({
            "schema_version": 1,
            "exported_at_unix_ms": 1,
            "settings": { "theme": "moss" },
            "signing_identity": { "fingerprint": "fresh" },
            "archives": [{ "roomId": "lobby", "signature": "sig" }]
        }),
    )
    .expect("backup file write should succeed");

    import_backup_from_path(&paths, &backup_path).expect("backup import should succeed");

    assert_eq!(
        read_json(&paths.settings_path).expect("settings read should succeed"),
        Some(json!({ "theme": "moss" }))
    );
    assert_eq!(
        read_json(&paths.identity_path).expect("identity read should succeed"),
        Some(json!({ "fingerprint": "fresh" }))
    );
    assert!(!paths.archive_path("old-room").exists());
    assert_eq!(
        read_json(&paths.archive_path("lobby")).expect("archive read should succeed"),
        Some(json!({ "roomId": "lobby", "signature": "sig" }))
    );

    let _ = fs::remove_dir_all(base_dir);
}

#[test]
fn read_archives_returns_sorted_archives() {
    let base_dir = unique_temp_dir("mosh-all-archives-test");
    let paths = StoragePaths::for_base_dir(base_dir.clone());
    write_json(
        &paths.archive_path("room-b"),
        &json!({ "roomId": "room-b", "signature": "sig-b" }),
    )
    .expect("archive write should succeed");
    write_json(
        &paths.archive_path("room-a"),
        &json!({ "roomId": "room-a", "signature": "sig-a" }),
    )
    .expect("archive write should succeed");

    let archives = read_archives(&paths.archives_dir).expect("archive load should succeed");

    assert_eq!(archives.len(), 2);
    assert_eq!(archives[0]["roomId"], json!("room-a"));
    assert_eq!(archives[1]["roomId"], json!("room-b"));

    let _ = fs::remove_dir_all(base_dir);
}
