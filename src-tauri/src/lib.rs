pub mod adapters;

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use adapters::attachment_runtime::StreamRange;
use adapters::attachment_store::AttachmentStore;
use adapters::channel_runtime::{
    ChannelLeaveResult, ChannelListSnapshot, ChannelRuntime, ChannelSendResult, ChannelSnapshot,
    JoinChannelRequest,
};
use adapters::moss_ffi::MossFfiRuntime;
use adapters::moss_runtime::{MossDynamicRuntime, MossRuntime, MossRuntimeStatus};
use adapters::openmls_crypto::{
    run_openmls_alice_bob_roundtrip, run_openmls_smoke_test, OpenMlsRoundTripStatus,
    OpenMlsSmokeStatus,
};
use adapters::private_dm_runtime::{
    AcceptInviteRequest, AttachmentSendResult, CloseSessionResult, InviteCreated, PrivateDmRuntime,
    SendMessageResult, SessionListSnapshot, SessionSnapshot, StartSessionRequest,
};
use adapters::private_group_runtime::{
    CreateGroupRequest, GroupCreated, GroupLeaveResult, GroupListSnapshot, GroupSendResult,
    GroupSnapshot, JoinGroupRequest, PrivateGroupRuntime,
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
    persistence: PersistenceRuntimeStatus,
    openmls_smoke: Result<OpenMlsSmokeStatus, String>,
    openmls_roundtrip: Result<OpenMlsRoundTripStatus, String>,
}

#[derive(Clone, serde::Serialize)]
struct PersistenceRuntimeStatus {
    backend: &'static str,
    database: String,
    available: bool,
    encrypted_at_rest: bool,
    error: Option<String>,
}

struct PersistenceStatusState(PersistenceRuntimeStatus);

struct PersistenceLoad {
    persistence: Option<Arc<adapters::persistence::Persistence>>,
    status: PersistenceRuntimeStatus,
}

struct PrivateDmState {
    runtime: Mutex<Option<PrivateDmRuntime>>,
    load_error: Option<String>,
}

impl PrivateDmState {
    fn ready(
        moss: Arc<MossFfiRuntime>,
        attachment_store: Arc<AttachmentStore>,
        persistence: Option<Arc<adapters::persistence::Persistence>>,
    ) -> Self {
        // Persist the Moss node identity so its peer-id stays stable across
        // restarts; without this Moss mints a fresh identity each launch and
        // peers flap on reconnect. The keystore is global to the Moss library
        // and must be installed before any node starts (including rehydrate).
        if let Some(store) = persistence.clone() {
            adapters::moss_ffi::set_moss_keystore(store);
            if let Err(error) = moss.install_keystore() {
                eprintln!("moss keystore install failed: {error}");
            }
        }
        let mut runtime = PrivateDmRuntime::from_shared(moss, attachment_store, persistence);
        runtime.rehydrate();
        Self {
            runtime: Mutex::new(Some(runtime)),
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

// Rapid join/leave thrashes one Moss socket per channel; the limiter caps
// the rate at which a single ChannelState consumer can churn membership.
const CHANNEL_MEMBERSHIP_MIN_INTERVAL: Duration = Duration::from_millis(250);

struct ChannelState {
    runtime: Mutex<Option<ChannelRuntime>>,
    load_error: Option<String>,
    last_membership_op: Mutex<Option<Instant>>,
}

impl ChannelState {
    fn ready(
        moss: Arc<MossFfiRuntime>,
        attachment_store: Arc<AttachmentStore>,
        persistence: Option<Arc<adapters::persistence::Persistence>>,
    ) -> Self {
        let mut runtime = ChannelRuntime::from_shared(moss, attachment_store, persistence);
        runtime.rehydrate();
        Self {
            runtime: Mutex::new(Some(runtime)),
            load_error: None,
            last_membership_op: Mutex::new(None),
        }
    }

    fn missing(error: String) -> Self {
        Self {
            runtime: Mutex::new(None),
            load_error: Some(error),
            last_membership_op: Mutex::new(None),
        }
    }

    fn with_runtime<T>(
        &self,
        action: impl FnOnce(&mut ChannelRuntime) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self
            .runtime
            .lock()
            .map_err(|_| "channel runtime lock poisoned".to_string())?;
        let runtime = guard.as_mut().ok_or_else(|| self.unavailable_message())?;
        action(runtime)
    }

    fn check_membership_rate(&self) -> Result<(), String> {
        let mut guard = self
            .last_membership_op
            .lock()
            .map_err(|_| "channel rate-limit lock poisoned".to_string())?;
        let now = Instant::now();
        if let Some(previous) = *guard {
            if now.duration_since(previous) < CHANNEL_MEMBERSHIP_MIN_INTERVAL {
                return Err("channel membership rate limit exceeded".to_string());
            }
        }
        *guard = Some(now);
        Ok(())
    }

    fn unavailable_message(&self) -> String {
        match &self.load_error {
            Some(error) => format!("channel runtime unavailable: {error}"),
            None => "channel runtime unavailable".to_string(),
        }
    }
}

struct PrivateGroupState {
    runtime: Mutex<Option<PrivateGroupRuntime>>,
    load_error: Option<String>,
}

impl PrivateGroupState {
    fn ready(
        moss: Arc<MossFfiRuntime>,
        attachment_store: Arc<AttachmentStore>,
        persistence: Option<Arc<adapters::persistence::Persistence>>,
    ) -> Self {
        let mut runtime = PrivateGroupRuntime::from_shared(moss, attachment_store, persistence);
        runtime.rehydrate();
        Self {
            runtime: Mutex::new(Some(runtime)),
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
        action: impl FnOnce(&mut PrivateGroupRuntime) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self
            .runtime
            .lock()
            .map_err(|_| "private group runtime lock poisoned".to_string())?;
        let runtime = guard.as_mut().ok_or_else(|| self.unavailable_message())?;
        action(runtime)
    }

    fn unavailable_message(&self) -> String {
        match &self.load_error {
            Some(error) => format!("private group runtime unavailable: {error}"),
            None => "private group runtime unavailable".to_string(),
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

fn build_native_runtime_status(persistence: PersistenceRuntimeStatus) -> NativeRuntimeStatus {
    NativeRuntimeStatus {
        moss: MossDynamicRuntime::from_default_candidates().status(),
        secure_storage: OsSecureSecretStore::status(),
        persistence,
        openmls_smoke: run_openmls_smoke_test().map_err(|error| error.to_string()),
        openmls_roundtrip: run_openmls_alice_bob_roundtrip().map_err(|error| error.to_string()),
    }
}

#[tauri::command]
fn native_runtime_status(
    persistence: tauri::State<'_, PersistenceStatusState>,
) -> NativeRuntimeStatus {
    build_native_runtime_status(persistence.0.clone())
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
    session_id: String,
    body: String,
) -> Result<SendMessageResult, String> {
    state.with_runtime(|runtime| {
        runtime
            .send_message(&session_id, body)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_retry_message(
    state: tauri::State<'_, PrivateDmState>,
    session_id: String,
    message_id: String,
) -> Result<SendMessageResult, String> {
    state.with_runtime(|runtime| {
        runtime
            .retry_message(&session_id, &message_id)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_poll_session(
    state: tauri::State<'_, PrivateDmState>,
    session_id: String,
) -> Result<SessionSnapshot, String> {
    state.with_runtime(|runtime| {
        runtime
            .poll_session(&session_id)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_list_sessions(
    state: tauri::State<'_, PrivateDmState>,
) -> Result<SessionListSnapshot, String> {
    state.with_runtime(|runtime| runtime.list_sessions().map_err(|error| error.to_string()))
}

#[tauri::command]
fn private_dm_close_session(
    state: tauri::State<'_, PrivateDmState>,
    session_id: String,
) -> Result<CloseSessionResult, String> {
    state.with_runtime(|runtime| {
        runtime
            .close_session(&session_id)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_send_attachment(
    state: tauri::State<'_, PrivateDmState>,
    session_id: String,
    file_name: String,
    mime: String,
    data_base64: String,
    thumbnail_base64: Option<String>,
    voice: Option<adapters::attachment_runtime::VoiceMeta>,
) -> Result<AttachmentSendResult, String> {
    let bytes = decode_base64(&data_base64)?;
    let mime = resolve_mime(mime, &file_name);
    state.with_runtime(|runtime| {
        runtime
            .send_attachment(
                &session_id,
                file_name,
                mime,
                bytes,
                thumbnail_base64.clone(),
                voice.clone(),
            )
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_download_attachment(
    state: tauri::State<'_, PrivateDmState>,
    session_id: String,
    attachment_id: String,
) -> Result<(), String> {
    state.with_runtime(|runtime| {
        runtime
            .download_attachment(&session_id, &attachment_id)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_cancel_attachment(
    state: tauri::State<'_, PrivateDmState>,
    session_id: String,
    attachment_id: String,
) -> Result<(), String> {
    state.with_runtime(|runtime| {
        runtime
            .cancel_attachment(&session_id, &attachment_id)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_call_start(
    state: tauri::State<'_, PrivateDmState>,
    session_id: String,
) -> Result<adapters::private_dm_runtime::CallStarted, String> {
    state.with_runtime(|runtime| {
        runtime
            .call_start(&session_id)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_call_accept(
    state: tauri::State<'_, PrivateDmState>,
    session_id: String,
    call_id: String,
) -> Result<(), String> {
    state.with_runtime(|runtime| {
        runtime
            .call_accept(&session_id, &call_id)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_call_decline(
    state: tauri::State<'_, PrivateDmState>,
    session_id: String,
    call_id: String,
    reason: String,
) -> Result<(), String> {
    state.with_runtime(|runtime| {
        runtime
            .call_decline(&session_id, &call_id, &reason)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_call_end(
    state: tauri::State<'_, PrivateDmState>,
    session_id: String,
    call_id: String,
    reason: String,
) -> Result<(), String> {
    state.with_runtime(|runtime| {
        runtime
            .call_end(&session_id, &call_id, &reason)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_call_send_frame(
    state: tauri::State<'_, PrivateDmState>,
    session_id: String,
    call_id: String,
    frame_b64: String,
) -> Result<(), String> {
    let bytes = decode_base64(&frame_b64)?;
    state.with_runtime(|runtime| {
        runtime
            .call_send_frame(&session_id, &call_id, bytes)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_dm_call_drain_frames(
    state: tauri::State<'_, PrivateDmState>,
    session_id: String,
    call_id: String,
) -> Result<Vec<String>, String> {
    state.with_runtime(|runtime| {
        let frames = runtime
            .call_drain_frames(&session_id, &call_id)
            .map_err(|error| error.to_string())?;
        Ok(frames
            .into_iter()
            .map(|bytes| base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes))
            .collect())
    })
}

fn decode_base64(value: &str) -> Result<Vec<u8>, String> {
    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, value)
        .map_err(|error| format!("invalid attachment payload: {error}"))
}

fn resolve_mime(mime: String, file_name: &str) -> String {
    let trimmed = mime.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }
    mime_guess::from_path(file_name)
        .first_raw()
        .unwrap_or("application/octet-stream")
        .to_string()
}

fn load_attachment_store(app: &tauri::AppHandle) -> Arc<AttachmentStore> {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("mosh"));
    let store = AttachmentStore::new(&base)
        .or_else(|_| AttachmentStore::new(std::env::temp_dir().join("mosh")))
        .expect("attachment store directory should be creatable");
    Arc::new(store)
}

fn load_persistence(app: &tauri::AppHandle) -> PersistenceLoad {
    const BACKEND: &str = "redb+aes-256-gcm+os-keychain";

    let base = match app.path().app_data_dir() {
        Ok(base) => base,
        Err(error) => {
            return PersistenceLoad {
                persistence: None,
                status: PersistenceRuntimeStatus {
                    backend: BACKEND,
                    database: "unavailable".into(),
                    available: false,
                    encrypted_at_rest: false,
                    error: Some(error.to_string()),
                },
            };
        }
    };

    let path = base.join("mosh-history.redb");
    if let Err(error) = std::fs::create_dir_all(&base) {
        return PersistenceLoad {
            persistence: None,
            status: PersistenceRuntimeStatus {
                backend: BACKEND,
                database: path.to_string_lossy().into_owned(),
                available: false,
                encrypted_at_rest: false,
                error: Some(error.to_string()),
            },
        };
    }

    match adapters::persistence::Persistence::open(&path) {
        Ok(p) => PersistenceLoad {
            persistence: Some(Arc::new(p)),
            status: PersistenceRuntimeStatus {
                backend: BACKEND,
                database: path.to_string_lossy().into_owned(),
                available: true,
                encrypted_at_rest: true,
                error: None,
            },
        },
        Err(e) => {
            eprintln!("persistence unavailable: {e}");
            PersistenceLoad {
                persistence: None,
                status: PersistenceRuntimeStatus {
                    backend: BACKEND,
                    database: path.to_string_lossy().into_owned(),
                    available: false,
                    encrypted_at_rest: false,
                    error: Some(e.to_string()),
                },
            }
        }
    }
}

const STREAM_RESPONSE_WINDOW: u64 = 512 * 1024;
const STREAM_DEADLINE: Duration = Duration::from_secs(30);
const STREAM_POLL_INTERVAL: Duration = Duration::from_millis(60);

/// Resolves the exclusive end of the byte window to serve. Saturating arithmetic
/// keeps an attacker-supplied `Range` (e.g. `bytes=0-18446744073709551615`) from
/// overflowing; the window is always capped to one `STREAM_RESPONSE_WINDOW`.
fn resolve_request_end(start: u64, end: Option<u64>) -> u64 {
    let window_end = start.saturating_add(STREAM_RESPONSE_WINDOW);
    match end {
        Some(value) => value.saturating_add(1).min(window_end),
        None => window_end,
    }
}

/// Parses an HTTP `Range` header into a `(start, optional inclusive end)`.
fn parse_range_header(header: Option<&tauri::http::HeaderValue>) -> (u64, Option<u64>) {
    let Some(raw) = header.and_then(|value| value.to_str().ok()) else {
        return (0, None);
    };
    let spec = raw.trim().strip_prefix("bytes=").unwrap_or("").trim();
    let mut parts = spec.splitn(2, '-');
    let start = parts
        .next()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(0);
    let end = parts.next().and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            trimmed.parse::<u64>().ok()
        }
    });
    (start, end)
}

fn stream_range_once(
    app: &tauri::AppHandle,
    kind: &str,
    host: &str,
    attachment: &str,
    start: u64,
    end: u64,
) -> Result<StreamRange, String> {
    match kind {
        "dm" => app.state::<PrivateDmState>().with_runtime(|runtime| {
            runtime
                .stream_attachment_range(host, attachment, start, end)
                .map_err(|error| error.to_string())
        }),
        "group" => app.state::<PrivateGroupState>().with_runtime(|runtime| {
            runtime
                .stream_attachment_range(host, attachment, start, end)
                .map_err(|error| error.to_string())
        }),
        "channel" => app.state::<ChannelState>().with_runtime(|runtime| {
            runtime
                .stream_attachment_range(host, attachment, start, end)
                .map_err(|error| error.to_string())
        }),
        _ => Err("unknown stream kind".to_string()),
    }
}

fn stream_status_response(code: u16) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(code)
        .header("Access-Control-Allow-Origin", "*")
        .body(Vec::new())
        .expect("static stream response should build")
}

/// Serves a `moshmedia://` request by streaming an attachment's byte range,
/// waiting for the covering chunks to arrive when they are not in yet.
fn serve_media_stream(
    app: &tauri::AppHandle,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let path = request.uri().path().to_string();
    let segments: Vec<&str> = path.trim_matches('/').splitn(3, '/').collect();
    if segments.len() != 3 || segments.iter().any(|segment| segment.is_empty()) {
        return stream_status_response(404);
    }
    let (kind, host, attachment) = (segments[0], segments[1], segments[2]);
    let (start, end) = parse_range_header(request.headers().get(tauri::http::header::RANGE));
    let request_end = resolve_request_end(start, end);

    let deadline = Instant::now() + STREAM_DEADLINE;
    loop {
        match stream_range_once(app, kind, host, attachment, start, request_end) {
            Ok(StreamRange::Ready {
                bytes,
                total_size,
                mime,
            }) => {
                let length = bytes.len() as u64;
                let last = if length == 0 {
                    start
                } else {
                    start + length - 1
                };
                return tauri::http::Response::builder()
                    .status(206)
                    .header(tauri::http::header::CONTENT_TYPE, mime)
                    .header(tauri::http::header::ACCEPT_RANGES, "bytes")
                    .header(
                        tauri::http::header::CONTENT_RANGE,
                        format!("bytes {start}-{last}/{total_size}"),
                    )
                    .header(tauri::http::header::CONTENT_LENGTH, length.to_string())
                    .header("Access-Control-Allow-Origin", "*")
                    .body(bytes)
                    .unwrap_or_else(|_| stream_status_response(500));
            }
            Ok(StreamRange::Pending { .. }) => {
                if Instant::now() >= deadline {
                    return stream_status_response(504);
                }
                std::thread::sleep(STREAM_POLL_INTERVAL);
            }
            Ok(StreamRange::Unknown) | Err(_) => return stream_status_response(404),
        }
    }
}

#[tauri::command]
fn channel_join(
    state: tauri::State<'_, ChannelState>,
    request: JoinChannelRequest,
) -> Result<ChannelSnapshot, String> {
    state.check_membership_rate()?;
    state.with_runtime(|runtime| runtime.join(request).map_err(|error| error.to_string()))
}

#[tauri::command]
fn channel_leave(
    state: tauri::State<'_, ChannelState>,
    name: String,
) -> Result<ChannelLeaveResult, String> {
    state.check_membership_rate()?;
    state.with_runtime(|runtime| runtime.leave(&name).map_err(|error| error.to_string()))
}

#[tauri::command]
fn channel_send(
    state: tauri::State<'_, ChannelState>,
    name: String,
    body: String,
) -> Result<ChannelSendResult, String> {
    state.with_runtime(|runtime| runtime.send(&name, body).map_err(|error| error.to_string()))
}

#[tauri::command]
fn channel_retry_message(
    state: tauri::State<'_, ChannelState>,
    name: String,
    message_id: String,
) -> Result<ChannelSendResult, String> {
    state.with_runtime(|runtime| {
        runtime
            .retry_message(&name, &message_id)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn channel_poll(
    state: tauri::State<'_, ChannelState>,
    name: String,
) -> Result<ChannelSnapshot, String> {
    state.with_runtime(|runtime| runtime.poll(&name).map_err(|error| error.to_string()))
}

#[tauri::command]
fn channel_list(state: tauri::State<'_, ChannelState>) -> Result<ChannelListSnapshot, String> {
    state.with_runtime(|runtime| runtime.list().map_err(|error| error.to_string()))
}

#[tauri::command]
fn channel_send_attachment(
    state: tauri::State<'_, ChannelState>,
    name: String,
    file_name: String,
    mime: String,
    data_base64: String,
    thumbnail_base64: Option<String>,
    voice: Option<adapters::attachment_runtime::VoiceMeta>,
) -> Result<AttachmentSendResult, String> {
    let bytes = decode_base64(&data_base64)?;
    let mime = resolve_mime(mime, &file_name);
    state.with_runtime(|runtime| {
        runtime
            .send_attachment(
                &name,
                file_name,
                mime,
                bytes,
                thumbnail_base64.clone(),
                voice.clone(),
            )
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn channel_download_attachment(
    state: tauri::State<'_, ChannelState>,
    name: String,
    attachment_id: String,
) -> Result<(), String> {
    state.with_runtime(|runtime| {
        runtime
            .download_attachment(&name, &attachment_id)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn channel_cancel_attachment(
    state: tauri::State<'_, ChannelState>,
    name: String,
    attachment_id: String,
) -> Result<(), String> {
    state.with_runtime(|runtime| {
        runtime
            .cancel_attachment(&name, &attachment_id)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn channel_send_dm_offer(
    state: tauri::State<'_, ChannelState>,
    name: String,
    target_fingerprint: String,
    invite_uri: String,
) -> Result<(), String> {
    state.with_runtime(|runtime| {
        runtime
            .send_dm_offer(&name, target_fingerprint, invite_uri)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn channel_dismiss_dm_offer(
    state: tauri::State<'_, ChannelState>,
    name: String,
    offer_id: String,
) -> Result<(), String> {
    state.with_runtime(|runtime| {
        runtime
            .dismiss_dm_offer(&name, &offer_id)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_group_create(
    state: tauri::State<'_, PrivateGroupState>,
    request: CreateGroupRequest,
) -> Result<GroupCreated, String> {
    state.with_runtime(|runtime| {
        runtime
            .create_group(request)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_group_join(
    state: tauri::State<'_, PrivateGroupState>,
    request: JoinGroupRequest,
) -> Result<GroupSnapshot, String> {
    state.with_runtime(|runtime| {
        runtime
            .join_group(request)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_group_send(
    state: tauri::State<'_, PrivateGroupState>,
    group_id: String,
    body: String,
) -> Result<GroupSendResult, String> {
    state.with_runtime(|runtime| {
        runtime
            .send(&group_id, body)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_group_retry_message(
    state: tauri::State<'_, PrivateGroupState>,
    group_id: String,
    message_id: String,
) -> Result<GroupSendResult, String> {
    state.with_runtime(|runtime| {
        runtime
            .retry_message(&group_id, &message_id)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_group_poll(
    state: tauri::State<'_, PrivateGroupState>,
    group_id: String,
) -> Result<GroupSnapshot, String> {
    state.with_runtime(|runtime| runtime.poll(&group_id).map_err(|error| error.to_string()))
}

#[tauri::command]
fn private_group_list(
    state: tauri::State<'_, PrivateGroupState>,
) -> Result<GroupListSnapshot, String> {
    state.with_runtime(|runtime| runtime.list().map_err(|error| error.to_string()))
}

#[tauri::command]
fn private_group_close(
    state: tauri::State<'_, PrivateGroupState>,
    group_id: String,
) -> Result<GroupLeaveResult, String> {
    state.with_runtime(|runtime| runtime.close(&group_id).map_err(|error| error.to_string()))
}

#[tauri::command]
fn private_group_send_attachment(
    state: tauri::State<'_, PrivateGroupState>,
    group_id: String,
    file_name: String,
    mime: String,
    data_base64: String,
    thumbnail_base64: Option<String>,
    voice: Option<adapters::attachment_runtime::VoiceMeta>,
) -> Result<AttachmentSendResult, String> {
    let bytes = decode_base64(&data_base64)?;
    let mime = resolve_mime(mime, &file_name);
    state.with_runtime(|runtime| {
        runtime
            .send_attachment(
                &group_id,
                file_name,
                mime,
                bytes,
                thumbnail_base64.clone(),
                voice.clone(),
            )
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_group_download_attachment(
    state: tauri::State<'_, PrivateGroupState>,
    group_id: String,
    attachment_id: String,
) -> Result<(), String> {
    state.with_runtime(|runtime| {
        runtime
            .download_attachment(&group_id, &attachment_id)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_group_cancel_attachment(
    state: tauri::State<'_, PrivateGroupState>,
    group_id: String,
    attachment_id: String,
) -> Result<(), String> {
    state.with_runtime(|runtime| {
        runtime
            .cancel_attachment(&group_id, &attachment_id)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_group_send_dm_offer(
    state: tauri::State<'_, PrivateGroupState>,
    group_id: String,
    target_fingerprint: String,
    invite_uri: String,
) -> Result<(), String> {
    state.with_runtime(|runtime| {
        runtime
            .send_dm_offer(&group_id, target_fingerprint, invite_uri)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn private_group_dismiss_dm_offer(
    state: tauri::State<'_, PrivateGroupState>,
    group_id: String,
    offer_id: String,
) -> Result<(), String> {
    state.with_runtime(|runtime| {
        runtime
            .dismiss_dm_offer(&group_id, &offer_id)
            .map_err(|error| error.to_string())
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct VpnDetection {
    pub vpn_likely: bool,
    pub suspect_interfaces: Vec<String>,
    /// True when the IPv4 default route currently points through a
    /// virtual / tunnel interface — the strongest signal that an active
    /// VPN owns the user's outbound traffic right now.
    pub vpn_owns_default_route: bool,
}

#[tauri::command]
fn list_network_interfaces(
) -> Result<Vec<adapters::network_inventory::NetworkInterfaceInfo>, String> {
    adapters::network_inventory::list_interfaces()
}

#[tauri::command]
fn detect_vpn() -> Result<VpnDetection, String> {
    let interfaces = adapters::network_inventory::list_interfaces()?;
    let mut suspect = Vec::new();
    let mut owns_default = false;
    for iface in &interfaces {
        if iface.is_loopback {
            continue;
        }
        if iface.is_vpn {
            suspect.push(iface.name.clone());
            if iface.is_default_route {
                owns_default = true;
            }
        }
    }
    Ok(VpnDetection {
        vpn_likely: !suspect.is_empty(),
        suspect_interfaces: suspect,
        vpn_owns_default_route: owns_default,
    })
}

#[tauri::command]
fn set_bind_interface(value: Option<String>) -> Result<(), String> {
    // Reject names that look like virtual / VPN adapters when something
    // non-empty was passed — turning the override on but pointing it at
    // the very tunnel we are trying to bypass would silently defeat the
    // feature.
    if let Some(name) = value.as_ref() {
        if !name.is_empty() && adapters::network_inventory::name_looks_virtual(name) {
            return Err(format!(
                "interface {name:?} looks virtual / VPN — pick a physical NIC"
            ));
        }
    }
    adapters::moss_ffi::set_bind_interface(value);
    Ok(())
}

#[tauri::command]
fn get_bind_interface() -> Option<String> {
    adapters::moss_ffi::current_bind_interface()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .register_asynchronous_uri_scheme_protocol("moshmedia", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                let response = serve_media_stream(&app, &request);
                responder.respond(response);
            });
        })
        .setup(|app| {
            let persistence_load = load_persistence(app.handle());
            app.manage(PersistenceStatusState(persistence_load.status.clone()));
            match MossFfiRuntime::load_from_app_handle(app.handle()) {
                Ok(moss) => {
                    let moss = Arc::new(moss);
                    let attachment_store = load_attachment_store(app.handle());
                    app.manage(PrivateDmState::ready(
                        Arc::clone(&moss),
                        Arc::clone(&attachment_store),
                        persistence_load.persistence.clone(),
                    ));
                    app.manage(ChannelState::ready(
                        Arc::clone(&moss),
                        Arc::clone(&attachment_store),
                        persistence_load.persistence.clone(),
                    ));
                    app.manage(PrivateGroupState::ready(
                        moss,
                        attachment_store,
                        persistence_load.persistence.clone(),
                    ));
                }
                Err(error) => {
                    let message = error.to_string();
                    app.manage(PrivateDmState::missing(message.clone()));
                    app.manage(ChannelState::missing(message.clone()));
                    app.manage(PrivateGroupState::missing(message));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_diagnostics,
            native_runtime_status,
            list_network_interfaces,
            detect_vpn,
            set_bind_interface,
            get_bind_interface,
            private_dm_create_invite,
            private_dm_accept_invite,
            private_dm_send_message,
            private_dm_retry_message,
            private_dm_poll_session,
            private_dm_list_sessions,
            private_dm_close_session,
            private_dm_send_attachment,
            private_dm_download_attachment,
            private_dm_cancel_attachment,
            private_dm_call_start,
            private_dm_call_accept,
            private_dm_call_decline,
            private_dm_call_end,
            private_dm_call_send_frame,
            private_dm_call_drain_frames,
            channel_join,
            channel_leave,
            channel_send,
            channel_retry_message,
            channel_poll,
            channel_list,
            channel_send_attachment,
            channel_download_attachment,
            channel_cancel_attachment,
            channel_send_dm_offer,
            channel_dismiss_dm_offer,
            private_group_create,
            private_group_join,
            private_group_send,
            private_group_retry_message,
            private_group_poll,
            private_group_list,
            private_group_close,
            private_group_send_attachment,
            private_group_download_attachment,
            private_group_cancel_attachment,
            private_group_send_dm_offer,
            private_group_dismiss_dm_offer
        ])
        .run(tauri::generate_context!())
        .expect(RUN_ERROR);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_request_end_saturates_on_attacker_range() {
        // `Range: bytes=0-18446744073709551615` must not overflow `value + 1`.
        assert_eq!(
            resolve_request_end(0, Some(u64::MAX)),
            STREAM_RESPONSE_WINDOW
        );
        // A huge start must not overflow `start + window`.
        assert_eq!(resolve_request_end(u64::MAX, None), u64::MAX);
    }

    #[test]
    fn resolve_request_end_honors_small_end_and_caps_to_window() {
        assert_eq!(resolve_request_end(0, Some(99)), 100);
        assert_eq!(
            resolve_request_end(10, Some(u64::MAX)),
            10 + STREAM_RESPONSE_WINDOW
        );
        assert_eq!(resolve_request_end(5, None), 5 + STREAM_RESPONSE_WINDOW);
    }

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
        let status = build_native_runtime_status(PersistenceRuntimeStatus {
            backend: "test",
            database: "test.redb".into(),
            available: true,
            encrypted_at_rest: true,
            error: None,
        });

        assert_eq!(status.moss.link_mode, MOSS_LINK_MODE);
        assert_eq!(status.secure_storage.backend, "os-keychain");
        assert!(status.persistence.available);
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
