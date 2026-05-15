use std::{
    ffi::{c_void, CStr, CString},
    mem::ManuallyDrop,
    os::raw::c_char,
    sync::{Arc, Mutex},
    time::Duration,
};

use libloading::{Library, Symbol};

use crate::adapters::moss_runtime::{MossDynamicRuntime, MossRuntimeError};

const MOSS_OK: i32 = 0;
const MOSS_ERR_NO_PEERS: i32 = -6;
const DEFAULT_WAIT_MS: u64 = 3000;
const POLL_MS: u64 = 50;
// Moss_GetPublicKey returns a fixed-size Ed25519 public key. Keep this in
// sync with `node.PublicKey() [32]byte` on the Go side; relying on the
// constant prevents accidental drift in the raw-pointer deref below.
const MOSS_PUBKEY_LEN: usize = 32;

pub type MossHandle = i64;
type MessageCallback = unsafe extern "C" fn(*const c_char, *const u8, *const u8, u32);
type EventCallback = unsafe extern "C" fn(i32, *const c_char);
type MossInit = unsafe extern "C" fn(*const c_char, *const u8, *const c_char) -> MossHandle;
type MossStart = unsafe extern "C" fn(MossHandle) -> i32;
type MossStop = unsafe extern "C" fn(MossHandle) -> i32;
type MossSubscribe = unsafe extern "C" fn(MossHandle, *const c_char) -> i32;
type MossConnect = unsafe extern "C" fn(MossHandle, *const c_char) -> i32;
type MossPublish = unsafe extern "C" fn(MossHandle, *const c_char, *const u8, u32) -> i32;
type MossSetCallback = unsafe extern "C" fn(MossHandle, Option<MessageCallback>) -> i32;
type MossSetEventCallback = unsafe extern "C" fn(MossHandle, Option<EventCallback>) -> i32;
type MossGetMeshInfo = unsafe extern "C" fn(MossHandle) -> *mut c_char;
type MossGetNatType = unsafe extern "C" fn(MossHandle) -> *mut c_char;
type MossGetPublicKey = unsafe extern "C" fn(MossHandle) -> *mut u8;
type MossFree = unsafe extern "C" fn(*mut c_void);

const EVENT_RING_CAPACITY: usize = 64;

static RECEIVED_MESSAGES: Mutex<Vec<MossReceivedMessage>> = Mutex::new(Vec::new());
static EVENT_LOG: Mutex<Vec<MossEvent>> = Mutex::new(Vec::new());

#[cfg(test)]
pub static MOSS_TEST_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug)]
pub struct MossEvent {
    pub event_type: i32,
    pub detail_json: String,
    pub epoch_millis: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MossReceivedMessage {
    pub channel: String,
    pub payload: Vec<u8>,
}

#[derive(Debug)]
pub enum MossFfiError {
    Runtime(MossRuntimeError),
    Symbol(String),
    InvalidCString(String),
    Operation { name: &'static str, code: i32 },
    DeliveryTimeout,
}

impl std::fmt::Display for MossFfiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Runtime(error) => write!(formatter, "{error}"),
            Self::Symbol(symbol) => write!(formatter, "Moss symbol unavailable: {symbol}"),
            Self::InvalidCString(value) => write!(formatter, "Moss string contains NUL: {value}"),
            Self::Operation { name, code } => write!(formatter, "Moss {name} failed: {code}"),
            Self::DeliveryTimeout => write!(formatter, "Moss delivery timed out"),
        }
    }
}

impl std::error::Error for MossFfiError {}

impl From<MossRuntimeError> for MossFfiError {
    fn from(error: MossRuntimeError) -> Self {
        Self::Runtime(error)
    }
}

pub struct MossFfiRuntime {
    _library: ManuallyDrop<Library>,
    init: MossInit,
    start: MossStart,
    stop: MossStop,
    subscribe: MossSubscribe,
    connect: MossConnect,
    publish: MossPublish,
    set_callback: MossSetCallback,
    set_event_callback: MossSetEventCallback,
    get_mesh_info: MossGetMeshInfo,
    get_nat_type: MossGetNatType,
    get_public_key: MossGetPublicKey,
    free: MossFree,
}

pub struct MossNode {
    runtime: Arc<MossFfiRuntime>,
    handle: MossHandle,
}

#[derive(Debug, Clone)]
pub struct MossNodeConfig {
    pub listen_port: u16,
    pub static_peer: Option<String>,
}

impl MossFfiRuntime {
    pub fn load_default() -> Result<Self, MossFfiError> {
        let path = MossDynamicRuntime::from_default_candidates()
            .first_available_path()
            .ok_or_else(|| {
                MossFfiError::Runtime(MossRuntimeError::Load("library not found".into()))
            })?;

        Self::load_from_path(&path)
    }

    pub fn load_from_app_handle(handle: &tauri::AppHandle) -> Result<Self, MossFfiError> {
        let path = MossDynamicRuntime::from_app_handle(handle)
            .first_available_path()
            .ok_or_else(|| {
                MossFfiError::Runtime(MossRuntimeError::Load("library not found".into()))
            })?;

        Self::load_from_path(&path)
    }

    pub fn load_from_path(path: &std::path::Path) -> Result<Self, MossFfiError> {
        let library = unsafe { Library::new(path) }
            .map_err(|error| MossFfiError::Runtime(MossRuntimeError::Load(error.to_string())))?;

        Ok(Self {
            init: load_symbol(&library, b"Moss_Init\0")?,
            start: load_symbol(&library, b"Moss_Start\0")?,
            stop: load_symbol(&library, b"Moss_Stop\0")?,
            subscribe: load_symbol(&library, b"Moss_Subscribe\0")?,
            connect: load_symbol(&library, b"Moss_Connect\0")?,
            publish: load_symbol(&library, b"Moss_Publish\0")?,
            set_callback: load_symbol(&library, b"Moss_SetCallback\0")?,
            set_event_callback: load_symbol(&library, b"Moss_SetEventCallback\0")?,
            get_mesh_info: load_symbol(&library, b"Moss_GetMeshInfo\0")?,
            get_nat_type: load_symbol(&library, b"Moss_GetNATType\0")?,
            get_public_key: load_symbol(&library, b"Moss_GetPublicKey\0")?,
            free: load_symbol(&library, b"Moss_Free\0")?,
            _library: ManuallyDrop::new(library),
        })
    }

    pub fn init_node(
        self: &Arc<Self>,
        mesh_id: &str,
        config_json: &str,
    ) -> Result<MossNode, MossFfiError> {
        let mesh_id = c_string(mesh_id)?;
        let config = c_string(config_json)?;
        let handle = unsafe { (self.init)(mesh_id.as_ptr(), std::ptr::null(), config.as_ptr()) };

        if handle <= 0 {
            return Err(MossFfiError::Operation {
                name: "init",
                code: handle as i32,
            });
        }

        Ok(MossNode {
            runtime: Arc::clone(self),
            handle,
        })
    }

    pub fn init_default_node(
        self: &Arc<Self>,
        mesh_id: &str,
        config: &MossNodeConfig,
    ) -> Result<MossNode, MossFfiError> {
        self.init_node(mesh_id, &node_config_json(config))
    }
}

impl MossNode {
    pub fn start(&self) -> Result<(), MossFfiError> {
        check_code("start", unsafe { (self.runtime.start)(self.handle) })
    }

    pub fn subscribe(&self, channel: &str) -> Result<(), MossFfiError> {
        let channel = c_string(channel)?;

        check_code("subscribe", unsafe {
            (self.runtime.subscribe)(self.handle, channel.as_ptr())
        })
    }

    pub fn connect(&self, address: &str) -> Result<(), MossFfiError> {
        let address = c_string(address)?;

        check_code("connect", unsafe {
            (self.runtime.connect)(self.handle, address.as_ptr())
        })
    }

    pub fn publish(&self, channel: &str, payload: &[u8]) -> Result<(), MossFfiError> {
        let channel = c_string(channel)?;
        let code = unsafe {
            (self.runtime.publish)(
                self.handle,
                channel.as_ptr(),
                payload.as_ptr(),
                payload.len() as u32,
            )
        };

        check_publish_code(code)
    }

    pub fn set_message_callback(&self) -> Result<(), MossFfiError> {
        check_code("set_callback", unsafe {
            (self.runtime.set_callback)(self.handle, Some(on_moss_message))
        })
    }

    pub fn set_event_callback(&self) -> Result<(), MossFfiError> {
        check_code("set_event_callback", unsafe {
            (self.runtime.set_event_callback)(self.handle, Some(on_moss_event))
        })
    }

    pub fn mesh_info_json(&self) -> Option<String> {
        let ptr = unsafe { (self.runtime.get_mesh_info)(self.handle) };
        if ptr.is_null() {
            return None;
        }
        let value = unsafe { CStr::from_ptr(ptr) }
            .to_string_lossy()
            .into_owned();
        unsafe { (self.runtime.free)(ptr as *mut c_void) };
        Some(value)
    }

    pub fn nat_type(&self) -> Option<String> {
        let ptr = unsafe { (self.runtime.get_nat_type)(self.handle) };
        if ptr.is_null() {
            return None;
        }
        let value = unsafe { CStr::from_ptr(ptr) }
            .to_string_lossy()
            .into_owned();
        unsafe { (self.runtime.free)(ptr as *mut c_void) };
        Some(value)
    }

    pub fn public_key_hex(&self) -> Option<String> {
        let ptr = unsafe { (self.runtime.get_public_key)(self.handle) };
        if ptr.is_null() {
            return None;
        }
        // SAFETY: Moss_GetPublicKey on the Go side always returns a buffer
        // sized by the MOSS_PUBKEY_LEN-byte Ed25519 public key. Reading any
        // other length would be UB; the constant locks the contract.
        let bytes = unsafe { std::slice::from_raw_parts(ptr, MOSS_PUBKEY_LEN) }.to_vec();
        unsafe { (self.runtime.free)(ptr as *mut c_void) };
        Some(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
    }
}

impl Drop for MossNode {
    fn drop(&mut self) {
        unsafe {
            (self.runtime.stop)(self.handle);
        }
    }
}

pub fn drain_received_messages() -> Vec<MossReceivedMessage> {
    let mut messages = RECEIVED_MESSAGES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    std::mem::take(&mut *messages)
}

pub fn drain_messages_where<F>(predicate: F) -> Vec<MossReceivedMessage>
where
    F: Fn(&MossReceivedMessage) -> bool,
{
    // Take the queue out from under the mutex before running the user
    // predicate. Holding the lock across an arbitrary closure would poison
    // it on any predicate panic and stall every other Moss consumer.
    let drained: Vec<MossReceivedMessage> = {
        let mut log = RECEIVED_MESSAGES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        std::mem::take(&mut *log)
    };
    let mut taken = Vec::new();
    let mut kept = Vec::with_capacity(drained.len());
    for message in drained {
        if predicate(&message) {
            taken.push(message);
        } else {
            kept.push(message);
        }
    }
    if !kept.is_empty() {
        let mut log = RECEIVED_MESSAGES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        kept.append(&mut *log);
        *log = kept;
    }
    taken
}

pub fn snapshot_event_log() -> Vec<MossEvent> {
    EVENT_LOG
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

pub fn clear_event_log() {
    EVENT_LOG
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clear();
}

pub fn wait_for_payload(payload: &[u8]) -> Result<MossReceivedMessage, MossFfiError> {
    let deadline = std::time::Instant::now() + Duration::from_millis(DEFAULT_WAIT_MS);

    while std::time::Instant::now() < deadline {
        if let Some(message) = drain_received_messages()
            .into_iter()
            .find(|message| message.payload == payload)
        {
            return Ok(message);
        }

        std::thread::sleep(Duration::from_millis(POLL_MS));
    }

    Err(MossFfiError::DeliveryTimeout)
}

pub fn node_config_json(config: &MossNodeConfig) -> String {
    let peers = match &config.static_peer {
        Some(peer) => format!("[\"{peer}\"]"),
        None => "[]".to_string(),
    };

    format!(
        r#"{{"listen_port":{},"static_peers":{},"announce_interval_sec":15,"bootstrap_timeout_sec":12,"lan_discovery_enabled":true,"gossipsub":{{"heartbeat_ms":250}},"nat":{{"upnp_enabled":true,"natpmp_enabled":true,"pcp_enabled":true,"hole_punch_attempts":8,"port_prediction_enabled":true}}}}"#,
        config.listen_port, peers
    )
}

fn load_symbol<T: Copy>(library: &Library, name: &[u8]) -> Result<T, MossFfiError> {
    let symbol: Symbol<T> =
        unsafe { library.get(name) }.map_err(|_| MossFfiError::Symbol(symbol_name(name)))?;

    Ok(*symbol)
}

fn c_string(value: &str) -> Result<CString, MossFfiError> {
    CString::new(value).map_err(|_| MossFfiError::InvalidCString(value.to_string()))
}

fn check_code(name: &'static str, code: i32) -> Result<(), MossFfiError> {
    if code == MOSS_OK {
        Ok(())
    } else {
        Err(MossFfiError::Operation { name, code })
    }
}

fn check_publish_code(code: i32) -> Result<(), MossFfiError> {
    if code == MOSS_OK || code == MOSS_ERR_NO_PEERS {
        Ok(())
    } else {
        Err(MossFfiError::Operation {
            name: "publish",
            code,
        })
    }
}

fn symbol_name(name: &[u8]) -> String {
    let name = name.strip_suffix(&[0]).unwrap_or(name);

    String::from_utf8_lossy(name).into_owned()
}

unsafe extern "C" fn on_moss_message(
    channel: *const c_char,
    _sender_id: *const u8,
    data: *const u8,
    len: u32,
) {
    if channel.is_null() || data.is_null() {
        return;
    }

    let channel = unsafe { std::ffi::CStr::from_ptr(channel) }
        .to_string_lossy()
        .into_owned();
    let payload = unsafe { std::slice::from_raw_parts(data, len as usize) }.to_vec();

    RECEIVED_MESSAGES
        .lock()
        .expect("Moss message lock poisoned")
        .push(MossReceivedMessage { channel, payload });
}

unsafe extern "C" fn on_moss_event(event_type: i32, detail_json: *const c_char) {
    let detail = if detail_json.is_null() {
        String::new()
    } else {
        unsafe { CStr::from_ptr(detail_json) }
            .to_string_lossy()
            .into_owned()
    };
    let epoch_millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);

    let mut log = EVENT_LOG.lock().expect("Moss event lock poisoned");
    log.push(MossEvent {
        event_type,
        detail_json: detail,
        epoch_millis,
    });
    if log.len() > EVENT_RING_CAPACITY {
        let drop = log.len() - EVENT_RING_CAPACITY;
        log.drain(0..drop);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_MESH: &str = "mosh-runtime-smoke";
    const TEST_CHANNEL: &str = "mls-control";
    const TEST_PAYLOAD: &[u8] = b"mosh-runtime-payload";

    #[cfg(target_os = "windows")]
    const TEST_LIBRARY_NAME: &str = "moss.dll";
    #[cfg(target_os = "macos")]
    const TEST_LIBRARY_NAME: &str = "libmoss.dylib";
    #[cfg(all(unix, not(target_os = "macos")))]
    const TEST_LIBRARY_NAME: &str = "libmoss.so";

    #[test]
    fn two_local_moss_peers_exchange_payload() {
        let _guard = MOSS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let library_path = build_test_moss_library();
        let runtime = Arc::new(
            MossFfiRuntime::load_from_path(&library_path).expect("Moss library should load"),
        );

        drain_received_messages();
        let alice = runtime
            .init_node(TEST_MESH, &node_config(42030, None))
            .expect("alice node should init");
        alice.start().expect("alice should start");
        alice
            .set_message_callback()
            .expect("alice callback should register");
        alice
            .subscribe(TEST_CHANNEL)
            .expect("alice should subscribe");

        let bob = runtime
            .init_node(TEST_MESH, &node_config(42031, Some("127.0.0.1:42030")))
            .expect("bob node should init");
        bob.start().expect("bob should start");
        bob.subscribe(TEST_CHANNEL).expect("bob should subscribe");
        bob.connect("127.0.0.1:42030").expect("bob should connect");

        std::thread::sleep(Duration::from_millis(250));
        bob.publish(TEST_CHANNEL, TEST_PAYLOAD)
            .expect("bob should publish");

        let received = wait_for_payload(TEST_PAYLOAD).expect("alice should receive payload");
        assert_eq!(received.channel, TEST_CHANNEL);
    }

    fn node_config(port: u16, static_peer: Option<&str>) -> String {
        let peers = match static_peer {
            Some(peer) => format!("[\"{peer}\"]"),
            None => "[]".to_string(),
        };

        format!(
            r#"{{"trackers":[],"listen_port":{port},"static_peers":{peers},"gossipsub":{{"heartbeat_ms":50}},"nat":{{"upnp_enabled":false,"natpmp_enabled":false,"pcp_enabled":false}}}}"#
        )
    }

    fn build_test_moss_library() -> std::path::PathBuf {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let output_dir = manifest_dir.join("target").join("moss-test");
        let output_path = output_dir.join(TEST_LIBRARY_NAME);
        let moss_dir = manifest_dir.join("..").join("..").join("moss");

        std::fs::create_dir_all(&output_dir).expect("Moss test output dir should exist");
        let output = std::process::Command::new("go")
            .arg("build")
            .arg("-buildmode=c-shared")
            .arg("-o")
            .arg(&output_path)
            .arg("./cmd/moss-ffi")
            .current_dir(&moss_dir)
            .output()
            .expect("go build should start");

        if !output.status.success() {
            panic!(
                "Moss shared build failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        output_path
    }
}
