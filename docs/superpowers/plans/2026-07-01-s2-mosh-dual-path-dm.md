# S2 — mosh dual-path DM transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A DM connects whether or not a direct P2P path exists — falling back from the per-DM mesh to a Mesh-TURN-relayed session on the shared relay mesh (S1), and migrating back to direct when it recovers.

**Architecture:** mosh owns *policy*; moss (S1, already merged) owns *mechanics*. A per-DM state machine (`Discover → Direct | Relayed`) picks a transport. Direct = pubsub `publish(channel)` on the per-DM node (unchanged). Relayed = point-to-point `Moss_RelaySendTo(peer_id)` on one shared, ref-counted relay-mesh node, carrying a tagged `RelayFrame{session_id, channel_kind, bytes}` that a parallel drain reconstructs into the exact `MossReceivedMessage` the direct path would have produced — so all MLS/dedup logic downstream is untouched. The remote's moss peer-id is exchanged in the existing MLS control handshake (`KeyPackage`/`Welcome`), not the invite.

**Tech Stack:** Rust (Tauri backend, `src-tauri`), `libloading` FFI to the moss `c-shared` dll, `serde`/`serde_json`, `base64`. moss = Go (`c-shared`), consumed only as S1 exports. Frontend diag row = existing React `DiagnosticsDrawerSections`.

## Global Constraints

- **moss submodule pin:** `mosh/moss` MUST be at `c02acb4` (S1: `Moss_RelaySendTo`, `Moss_SetRelayCallback`, `MOSS_ERR_RELAY_FAILED = -11`). Parent of `c02acb4` is the current pin `23d53e5`, so the bump is a clean single-commit fast-forward — no moss regression.
- **No invite format change.** Invite stays `mesh/session/#fingerprint`; existing invites stay valid. The invite `fingerprint` is the **MLS-signer** fingerprint (`MlsSessionCrypto::fingerprint`, 16 B → 32 uc hex) — it is NOT the moss peer-id and must never be passed to `Moss_RelaySendTo`.
- **moss peer-id = `MossNode::public_key_hex()`** = `hex(ed25519 pub)` = 64 lowercase hex chars. This is the only value valid as a `Moss_RelaySendTo` target.
- **Direct always preferred.** Relay is last resort; if the per-DM mesh reports a direct peer, migrate to direct and drop relay for that DM. Never run both.
- **No DM topic on the shared relay mesh.** DM traffic rides point-to-point relay frames, never pubsub — no metadata leak.
- **Build gotcha (Windows):** `npm run …` spawns via `cmd.exe`, which fails on this machine (missing `C:\macros\macro.bat` AutoRun). Rebuild the dll by invoking `go` **directly from the Bash tool** (Git Bash, not cmd), never `npm run moss:prepare`.
- **gofmt gotcha:** repo `core.autocrlf=true` makes `gofmt -l` report false diffs; blobs are already LF. S2 edits no Go — ignore.
- **moss is a separate Go module outside `go.work`** → gopls shows false `undefined`/`BrokenImport` in the Rust-side reasoning; trust `cargo build`/`cargo test`, not the language server.
- **Model policy:** implementers Sonnet floor; reviews on Opus 4.8; never Haiku.

---

### Task 0: Bump moss submodule to S1 (`c02acb4`) + rebuild the dll

**Files:**
- Modify: `mosh/moss` (submodule pointer, via checkout)
- Modify: `mosh/src-tauri/moss-runtime/moss.dll` (rebuilt artifact)
- Modify: mosh index (the gitlink `moss` + the dll if tracked)

**Interfaces:**
- Produces: the S1 symbols `Moss_RelaySendTo` / `Moss_SetRelayCallback` resolvable at dll load; every later task depends on this.

- [ ] **Step 1: Fetch S1 into the submodule and detach at `c02acb4`**

Run (Bash tool, absolute paths — the submodule and the standalone clone share origin `redstone-md/moss`, and `c02acb4` is on `origin/main`):
```bash
SUB=/c/Users/nevermore/Documents/bprojects/redstone-md/mossandmosh/mosh/moss
git -C "$SUB" fetch origin
git -C "$SUB" checkout --detach c02acb4
git -C "$SUB" rev-parse HEAD   # expect c02acb4…
```
Expected: `HEAD` at `c02acb4feat(ffi): relay-by-peer-id exports`.

- [ ] **Step 2: Confirm the S1 symbols exist in the checkout**

Run:
```bash
git -C "$SUB" grep -l "Moss_RelaySendTo" -- 'cmd/moss-ffi/*.go'
```
Expected: `cmd/moss-ffi/main.go` (was empty at `23d53e5`).

- [ ] **Step 3: Rebuild the c-shared dll bypassing cmd AutoRun**

Run (Bash tool — invokes `go` directly, NOT `npm`; mirrors `scripts/moss-prepare.mjs` lines 16-18 + header cleanup at 30-32):
```bash
M=/c/Users/nevermore/Documents/bprojects/redstone-md/mossandmosh/mosh
cd "$M/moss" && CGO_ENABLED=1 go build -buildmode=c-shared -o "$M/src-tauri/moss-runtime/moss.dll" ./cmd/moss-ffi
rm -f "$M/src-tauri/moss-runtime/moss.h"
ls -la "$M/src-tauri/moss-runtime/moss.dll"
```
Expected: exit 0, fresh `moss.dll` mtime. (A C toolchain/mingw gcc is already present — the dll built before.)

- [ ] **Step 4: Verify the new exports are in the dll**

Run:
```bash
M=/c/Users/nevermore/Documents/bprojects/redstone-md/mossandmosh/mosh
strings "$M/src-tauri/moss-runtime/moss.dll" | grep -E "Moss_RelaySendTo|Moss_SetRelayCallback" | sort -u
```
Expected: both symbol names present.

- [ ] **Step 5: Commit the submodule bump**

```bash
M=/c/Users/nevermore/Documents/bprojects/redstone-md/mossandmosh/mosh
git -C "$M" add moss src-tauri/moss-runtime/moss.dll
git -C "$M" commit -m "chore(moss): bump submodule to c02acb4 (S1 relay FFI)"
```
Note: if `moss-runtime/*.dll` is gitignored, drop it from the `add` — the dll is a local build artifact and Step 3 reproduces it. Check `git -C "$M" check-ignore src-tauri/moss-runtime/moss.dll` first.

---

### Task 1: Relay FFI bindings + inbound relay queue (`moss_ffi.rs`)

**Files:**
- Modify: `mosh/src-tauri/src/adapters/moss_ffi.rs`
- Test: same file, `#[cfg(test)] mod tests` (bottom)

**Interfaces:**
- Consumes (from S1 dll, C ABI):
  - `int32_t Moss_RelaySendTo(MossHandle, const char* target_peer_id, const uint8_t* data, int32_t length)` — `target_peer_id` is a **hex C-string** (64 lc hex). Returns `MOSS_OK`(0) / `MOSS_ERR_RELAY_FAILED`(-11) / `MOSS_ERR_CONFIG_INVALID`.
  - `int32_t Moss_SetRelayCallback(MossHandle, void(*cb)(const uint8_t* sender_id, const uint8_t* data, uint32_t length))` — `sender_id` is **raw 32 bytes**, not hex.
- Produces (Rust API, consumed by Tasks 2/4/5):
  - `MossNode::relay_send_to(&self, target_peer_hex: &str, payload: &[u8]) -> Result<(), MossFfiError>`
  - `MossNode::set_relay_callback(&self) -> Result<(), MossFfiError>` (registers the global handler)
  - `pub struct RelayInbound { pub sender_hex: String, pub data: Vec<u8> }`
  - `pub fn drain_relay_frames() -> Vec<RelayInbound>`
  - `MossFfiError::RelayFailed` variant (maps `-11`)

- [ ] **Step 1: Write failing tests for the relay queue + peer-id hex contract**

Add to `#[cfg(test)] mod tests` in `moss_ffi.rs`:
```rust
#[test]
fn relay_inbound_queue_roundtrips_sender_and_data() {
    // The Go callback delivers raw 32-byte sender_id; the queue must expose it
    // as 64-char lowercase hex so it matches MossNode::public_key_hex().
    let sender = [0xABu8; 32];
    push_relay_for_test(sender, b"hello".to_vec());
    let drained = drain_relay_frames();
    assert_eq!(drained.len(), 1);
    assert_eq!(drained[0].sender_hex, "ab".repeat(32));
    assert_eq!(drained[0].sender_hex.len(), 64);
    assert_eq!(drained[0].data, b"hello");
    assert!(drain_relay_frames().is_empty(), "drain must consume");
}

#[test]
fn relay_failed_code_maps_to_error() {
    assert!(matches!(
        check_relay_code(-11),
        Err(MossFfiError::RelayFailed)
    ));
    assert!(check_relay_code(0).is_ok());
}
```
`push_relay_for_test` is a `#[cfg(test)]` shim that calls the same enqueue path `on_moss_relay` uses (so the test exercises real hex-encode + queue logic, not a parallel mock).

- [ ] **Step 2: Run tests, verify they fail to compile / fail**

Run: `cargo test -p mosh --lib adapters::moss_ffi::tests::relay -- --nocapture`
(from `mosh/src-tauri`; adjust crate name if different — check `Cargo.toml` `[package] name`)
Expected: FAIL — `drain_relay_frames`, `RelayInbound`, `check_relay_code`, `MossFfiError::RelayFailed`, `push_relay_for_test` undefined.

- [ ] **Step 3: Add the extern types + runtime fields + symbol loads**

In the extern type block (near lines 51-71) add:
```rust
type RelaySendTo = unsafe extern "C" fn(MossHandle, *const c_char, *const u8, i32) -> i32;
type RelayCallback = unsafe extern "C" fn(*const u8, *const u8, u32);
type MossSetRelayCallback = unsafe extern "C" fn(MossHandle, Option<RelayCallback>) -> i32;
```
In `struct MossFfiRuntime` (after `set_key_store`, line ~177) add:
```rust
    relay_send_to: RelaySendTo,
    set_relay_callback: MossSetRelayCallback,
```
In `load_from_path` (after the `set_key_store` load, line ~233) add:
```rust
            relay_send_to: load_symbol(&library, b"Moss_RelaySendTo\0")?,
            set_relay_callback: load_symbol(&library, b"Moss_SetRelayCallback\0")?,
```

- [ ] **Step 4: Add the global relay inbox + callback + drain**

Near the existing message-queue globals (look for the `MessageCallback`/`on_moss_message` machinery and `drain_received_messages`, ~line 390). Mirror that pattern:
```rust
use std::sync::Mutex;
use once_cell::sync::Lazy; // reuse whatever the file already uses for the message queue

#[derive(Debug, Clone)]
pub struct RelayInbound {
    pub sender_hex: String,
    pub data: Vec<u8>,
}

static RELAY_INBOX: Lazy<Mutex<Vec<RelayInbound>>> = Lazy::new(|| Mutex::new(Vec::new()));

fn enqueue_relay(sender_hex: String, data: Vec<u8>) {
    RELAY_INBOX
        .lock()
        .expect("relay inbox poisoned")
        .push(RelayInbound { sender_hex, data });
}

/// C ABI callback: sender_id is raw 32 bytes; data/len is the RelayFrame payload.
unsafe extern "C" fn on_moss_relay(sender_id: *const u8, data: *const u8, len: u32) {
    if sender_id.is_null() {
        return;
    }
    let sender = std::slice::from_raw_parts(sender_id, MOSS_PUBKEY_LEN);
    let sender_hex: String = sender.iter().map(|b| format!("{b:02x}")).collect();
    let payload = if data.is_null() || len == 0 {
        Vec::new()
    } else {
        std::slice::from_raw_parts(data, len as usize).to_vec()
    };
    enqueue_relay(sender_hex, payload);
}

pub fn drain_relay_frames() -> Vec<RelayInbound> {
    std::mem::take(&mut *RELAY_INBOX.lock().expect("relay inbox poisoned"))
}

fn check_relay_code(code: i32) -> Result<(), MossFfiError> {
    match code {
        c if c == MOSS_OK => Ok(()),
        -11 => Err(MossFfiError::RelayFailed),
        other => Err(MossFfiError::Operation { name: "relay_send_to", code: other }),
    }
}

#[cfg(test)]
pub(crate) fn push_relay_for_test(sender_id: [u8; 32], data: Vec<u8>) {
    unsafe { on_moss_relay(sender_id.as_ptr(), data.as_ptr(), data.len() as u32) };
}
```
Reuse the file's existing `MOSS_OK` const and `Lazy`/`Mutex` import style — do NOT introduce a second queue abstraction; match `drain_received_messages` exactly. Add `RelayFailed` to the `MossFfiError` enum (unit variant; give it a `Display` line like `"relay send failed"`).

- [ ] **Step 5: Add the `MossNode` methods**

In `impl MossNode` (after `set_event_callback`, ~line 342):
```rust
    pub fn set_relay_callback(&self) -> Result<(), MossFfiError> {
        check_code("set_relay_callback", unsafe {
            (self.runtime.set_relay_callback)(self.handle, Some(on_moss_relay))
        })
    }

    pub fn relay_send_to(&self, target_peer_hex: &str, payload: &[u8]) -> Result<(), MossFfiError> {
        let target = c_string(target_peer_hex)?;
        let code = unsafe {
            (self.runtime.relay_send_to)(
                self.handle,
                target.as_ptr(),
                payload.as_ptr(),
                payload.len() as i32,
            )
        };
        check_relay_code(code)
    }
```

- [ ] **Step 6: Run tests, verify pass, then build**

Run: `cargo test -p mosh --lib adapters::moss_ffi -- --nocapture`
Expected: PASS.
Run: `cargo build -p mosh` — Expected: 0 errors (trust cargo, not gopls).

- [ ] **Step 7: Commit**

```bash
git -C /c/Users/nevermore/Documents/bprojects/redstone-md/mossandmosh/mosh add src-tauri/src/adapters/moss_ffi.rs
git -C /c/Users/nevermore/Documents/bprojects/redstone-md/mossandmosh/mosh commit -m "feat(moss-ffi): bind Moss_RelaySendTo + relay callback inbox"
```

---

### Task 2: Ref-counted shared relay-mesh node (`PrivateDmRuntime`)

**Files:**
- Modify: `mosh/src-tauri/src/adapters/private_dm_runtime.rs`
- Create: `mosh/src-tauri/src/adapters/private_dm_runtime/relay.rs` (relay-node lifecycle + bootstrap spore list)
- Modify: `mosh/src-tauri/src/adapters/private_dm_runtime.rs` (`mod relay;` + `PrivateDmRuntime` fields)

**Interfaces:**
- Consumes: `MossFfiRuntime::init_node(mesh_id, config_json)` / `init_default_node(mesh_id, &MossNodeConfig)`, `MossNode::{start, set_relay_callback, set_message_callback, relay_send_to, public_key_hex}` (Task 1), `MossNodeConfig { listen_port, static_peer, bind_interface }`.
- Produces (consumed by Tasks 5/6):
  - `PrivateDmRuntime::ensure_relay_up(&mut self) -> Result<&MossNode, PrivateDmRuntimeError>` — starts the node on first call, increments refcount, returns the shared node.
  - `PrivateDmRuntime::release_relay(&mut self)` — decrements; stops + drops the node at 0.
  - `PrivateDmRuntime::relay_node(&self) -> Option<&MossNode>`
  - `const RELAY_MESH_ID: &str = "moss-relay/1";`
  - `const RELAY_BOOTSTRAP_SPORES: &[&str] = &[];` (S3 fills; empty = degrades to "connecting", never a crash)

- [ ] **Step 1: Write failing tests for ref-counting semantics**

In a `#[cfg(test)] mod tests` in `relay.rs` (pure refcount logic, no real node — test a `RelayRef` counter type so the semantics are unit-testable without a dll):
```rust
#[test]
fn relay_ref_starts_on_first_and_stops_on_last() {
    let mut r = RelayRef::default();
    assert_eq!(r.acquire(), 1, "first acquire signals start");
    assert_eq!(r.acquire(), 2);
    assert_eq!(r.release(), 1);
    assert_eq!(r.release(), 0, "last release signals stop");
    assert!(!r.is_active());
}

#[test]
fn release_below_zero_saturates() {
    let mut r = RelayRef::default();
    assert_eq!(r.release(), 0);
    assert!(!r.is_active());
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cargo test -p mosh --lib private_dm_runtime::relay::tests -- --nocapture`
Expected: FAIL — `RelayRef` undefined.

- [ ] **Step 3: Implement `relay.rs`**

```rust
//! Shared relay-mesh node: one moss node on RELAY_MESH_ID, ref-counted across
//! all DMs that currently need relay. Started on first demand, stopped when the
//! last relayed DM releases it. No JoinRelayMesh — one node = one mesh, so
//! membership is just a second Moss_Init.

use crate::adapters::moss_ffi::{MossFfiRuntime, MossNode, MossNodeConfig};
use super::contracts::PrivateDmRuntimeError;
use std::sync::Arc;

pub const RELAY_MESH_ID: &str = "moss-relay/1";
/// Bundled SuperNode spores the relay node dials on start. Filled by S3;
/// empty here means "no relay reachable" → DM stays "connecting" (Failure
/// handling in the spec), never a join/leave storm.
pub const RELAY_BOOTSTRAP_SPORES: &[&str] = &[];

#[derive(Default)]
pub struct RelayRef {
    count: usize,
}

impl RelayRef {
    /// Returns the new count; 1 means "just started".
    pub fn acquire(&mut self) -> usize {
        self.count += 1;
        self.count
    }
    /// Returns the new count; 0 means "just stopped".
    pub fn release(&mut self) -> usize {
        self.count = self.count.saturating_sub(1);
        self.count
    }
    pub fn is_active(&self) -> bool {
        self.count > 0
    }
}

/// Bring up the shared relay node: Init on RELAY_MESH_ID, wire the relay
/// callback + message callback, Start, then dial each bootstrap spore.
pub fn start_relay_node(moss: &Arc<MossFfiRuntime>) -> Result<MossNode, PrivateDmRuntimeError> {
    let node = moss
        .init_default_node(RELAY_MESH_ID, &MossNodeConfig::default())
        .map_err(|e| PrivateDmRuntimeError::Moss(e.to_string()))?;
    node.set_relay_callback()
        .map_err(|e| PrivateDmRuntimeError::Moss(e.to_string()))?;
    node.start()
        .map_err(|e| PrivateDmRuntimeError::Moss(e.to_string()))?;
    for spore in RELAY_BOOTSTRAP_SPORES {
        // Best-effort: an unreachable spore must not abort startup.
        let _ = node.connect(spore);
    }
    Ok(node)
}
```

- [ ] **Step 4: Wire fields + methods into `PrivateDmRuntime`**

In `private_dm_runtime.rs`: add `mod relay;` with the other submodule decls (near `mod contracts; mod wire; mod invite;`). Add to `struct PrivateDmRuntime` (the struct holding `moss`, `sessions`, near line 144):
```rust
    relay_ref: relay::RelayRef,
    relay_node: Option<crate::adapters::moss_ffi::MossNode>,
```
Initialize both in `from_shared` (line 154): `relay_ref: relay::RelayRef::default(), relay_node: None,`. Add methods on `impl PrivateDmRuntime`:
```rust
    fn ensure_relay_up(&mut self) -> Result<&MossNode, PrivateDmRuntimeError> {
        if self.relay_ref.acquire() == 1 {
            self.relay_node = Some(relay::start_relay_node(&self.moss)?);
        }
        self.relay_node
            .as_ref()
            .ok_or_else(|| PrivateDmRuntimeError::Moss("relay node missing".into()))
    }

    fn release_relay(&mut self) {
        if self.relay_ref.release() == 0 {
            // Drop stops the node (MossNode::drop → Moss_Stop).
            self.relay_node = None;
        }
    }

    fn relay_node(&self) -> Option<&MossNode> {
        self.relay_node.as_ref()
    }
```

- [ ] **Step 5: Run tests + build**

Run: `cargo test -p mosh --lib private_dm_runtime::relay`
Expected: PASS.
Run: `cargo build -p mosh` — Expected: 0 errors. (`relay_node`/`ensure_relay_up`/`release_relay` may warn `dead_code` until Task 5/6 — acceptable this task; do NOT `#[allow]`-silence, the next tasks consume them.)

- [ ] **Step 6: Commit**

```bash
git -C /c/…/mosh add src-tauri/src/adapters/private_dm_runtime.rs src-tauri/src/adapters/private_dm_runtime/relay.rs
git -C /c/…/mosh commit -m "feat(dm): ref-counted shared relay-mesh node"
```

---

### Task 3: Exchange + store the peer moss-id in the MLS control handshake

**Files:**
- Modify: `mosh/src-tauri/src/adapters/private_dm_runtime/wire.rs` (`ControlEnvelope::{KeyPackage, Welcome}`)
- Modify: `mosh/src-tauri/src/adapters/private_dm_runtime.rs` (`PrivateDmSession.peer_moss_id`; produce on send at lines ~424 & ~1343-1349; capture on receive at `handle_control` ~1319-1364)

**Interfaces:**
- Consumes: `MossNode::public_key_hex() -> Option<String>` (our own moss peer-id), the existing `ControlEnvelope` enum + `handle_control`.
- Produces (consumed by Tasks 5/6): `PrivateDmSession.peer_moss_id: Option<String>` — the remote's 64-hex moss peer-id, set once the first `KeyPackage`/`Welcome` with the field arrives.

- [ ] **Step 1: Write failing test for envelope backward-compat + capture**

Add to `wire.rs` tests:
```rust
#[test]
fn key_package_carries_optional_moss_peer_id() {
    let with = ControlEnvelope::KeyPackage {
        session_id: "s".into(),
        participant_id: "p".into(),
        from_device: "d".into(),
        key_package_b64: "a2V5".into(),
        moss_peer_id: Some("ab".repeat(32)),
    };
    let json = serde_json::to_string(&with).unwrap();
    assert!(json.contains(&"ab".repeat(32)));
    let back: ControlEnvelope = serde_json::from_str(&json).unwrap();
    assert!(matches!(back, ControlEnvelope::KeyPackage { moss_peer_id: Some(_), .. }));

    // Old peers omit the field entirely — must still decode (None).
    let legacy = r#"{"type":"KeyPackage","session_id":"s","participant_id":"p","from_device":"d","key_package_b64":"a2V5"}"#;
    let back: ControlEnvelope = serde_json::from_str(legacy).unwrap();
    assert!(matches!(back, ControlEnvelope::KeyPackage { moss_peer_id: None, .. }));
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cargo test -p mosh --lib private_dm_runtime::wire::tests::key_package_carries`
Expected: FAIL — no `moss_peer_id` field.

- [ ] **Step 3: Add the field to both variants (backward-compatible)**

In `wire.rs`, `ControlEnvelope::KeyPackage` (after `key_package_b64`, line 46) and `::Welcome` (after `ratchet_tree_b64`, line 53) add:
```rust
        #[serde(default, skip_serializing_if = "Option::is_none")]
        moss_peer_id: Option<String>,
```
`#[serde(default)]` = old peers decode as `None`; `skip_serializing_if` keeps the wire clean when absent.

- [ ] **Step 4: Add the session field + capture/produce logic**

In `private_dm_runtime.rs`:
- Add to `struct PrivateDmSession` (after `fingerprint`, line 106): `peer_moss_id: Option<String>,`. Initialize `None` in `PrivateDmSession::new` and in `rehydrate` (persisted sessions re-learn it on the next handshake resend — no schema migration needed; note as `// ponytail: not persisted, relearned on next handshake resend`).
- **Produce** — set `moss_peer_id: self.node.public_key_hex()` at every `KeyPackage`/`Welcome` construction site: the joiner's KeyPackage build (near line 424 / the `create`/`join` flow) and the Welcome build in `handle_control` (lines 1343-1349). Since two more sites re-send cached copies (`pending_key_package`/`pending_welcome`), build the field into the payload **once at first construction** so cached bytes already carry it.
- **Capture** — in `handle_control`, in both the `KeyPackage { … }` and `Welcome { … }` match arms (lines 1319-1364), destructure `moss_peer_id` and, when `Some`, store it: `if let Some(id) = moss_peer_id { self.peer_moss_id.get_or_insert(id); }`. Add a helper `fn note_peer_moss_id(&mut self, id: Option<String>)` to DRY the two sites.

- [ ] **Step 5: Write + run a capture test through `handle_control`**

Add a runtime-level test (mirror the existing handshake tests near line 2718): drive an Alice session, feed it a `KeyPackage` envelope carrying `moss_peer_id: Some("ab"×32)`, assert `session.peer_moss_id == Some("ab"×32)` afterward. Run:
`cargo test -p mosh --lib private_dm_runtime -- peer_moss_id`
Expected: PASS.

- [ ] **Step 6: Build + commit**

Run: `cargo build -p mosh` — 0 errors.
```bash
git -C /c/…/mosh add src-tauri/src/adapters/private_dm_runtime.rs src-tauri/src/adapters/private_dm_runtime/wire.rs
git -C /c/…/mosh commit -m "feat(dm): exchange moss peer-id in KeyPackage/Welcome handshake"
```

> **Self-review note (spec drift):** the spec's "Testing → Unit: peer-id derivation from the invite static key matches moss's Go derivation (shared test vectors)" is **obsoleted** by this resolution — the moss peer-id is exchanged in-band via the handshake, never derived from the invite. The real invariant, tested above, is: the field survives serde roundtrip, old peers still decode, and `public_key_hex()` yields the 64-hex value `Moss_RelaySendTo` accepts (Task 1 Step 1). Do NOT build a cross-repo derivation vector; it would test a path this design removed.

---

### Task 4: `RelayFrame` wrapper + parallel relay drain

**Files:**
- Modify: `mosh/src-tauri/src/adapters/private_dm_runtime/wire.rs` (`RelayFrame`, `ChannelKind`)
- Modify: `mosh/src-tauri/src/adapters/private_dm_runtime.rs` (`drain_relay` on `PrivateDmRuntime`, called from `drain_inbound`)

**Interfaces:**
- Consumes: `drain_relay_frames() -> Vec<RelayInbound>` (Task 1), `PrivateDmSession.peer_moss_id` (Task 3), `wire::{control_channel, data_channel, blob_channel}`, `MossReceivedMessage`, `PrivateDmSession::handle_moss_message`.
- Produces (consumed by Task 5):
  - `pub enum ChannelKind { Control, Data, Blob }` with `fn channel_for(&self, session_id: &str) -> String`
  - `pub struct RelayFrame { pub session_id: String, pub channel_kind: ChannelKind, pub bytes: Vec<u8> }` (serde, `#[serde(tag="type")]` on `ChannelKind` or plain — JSON, matching the file's existing `serde_json` usage)
  - `PrivateDmRuntime::drain_relay(&mut self)`

- [ ] **Step 1: Write failing tests — RelayFrame roundtrip + channel reconstruction**

Add to `wire.rs` tests:
```rust
#[test]
fn relay_frame_roundtrips_and_rebuilds_channel() {
    let frame = RelayFrame {
        session_id: "sess1".into(),
        channel_kind: ChannelKind::Control,
        bytes: b"ct".to_vec(),
    };
    let json = serde_json::to_vec(&frame).unwrap();
    let back: RelayFrame = serde_json::from_slice(&json).unwrap();
    assert_eq!(back.session_id, "sess1");
    assert_eq!(back.bytes, b"ct");
    assert_eq!(back.channel_kind.channel_for("sess1"), control_channel("sess1"));
    assert_eq!(ChannelKind::Data.channel_for("s"), data_channel("s"));
    assert_eq!(ChannelKind::Blob.channel_for("s"), blob_channel("s"));
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cargo test -p mosh --lib private_dm_runtime::wire::tests::relay_frame`
Expected: FAIL — `RelayFrame`/`ChannelKind` undefined.

- [ ] **Step 3: Implement `ChannelKind` + `RelayFrame`**

In `wire.rs`:
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChannelKind {
    Control,
    Data,
    Blob,
}

impl ChannelKind {
    pub fn channel_for(&self, session_id: &str) -> String {
        match self {
            ChannelKind::Control => control_channel(session_id),
            ChannelKind::Data => data_channel(session_id),
            ChannelKind::Blob => blob_channel(session_id),
        }
    }
}

/// Point-to-point relay payload. The direct path routes by pubsub channel; the
/// relay callback carries only (sender_id, bytes), so we re-tag the channel
/// here and reconstruct the exact MossReceivedMessage on the far side.
#[derive(Debug, Serialize, Deserialize)]
pub struct RelayFrame {
    pub session_id: String,
    pub channel_kind: ChannelKind,
    pub bytes: Vec<u8>,
}
```

- [ ] **Step 4: Implement `drain_relay` on `PrivateDmRuntime`**

Add to `impl PrivateDmRuntime`, and call it from `drain_inbound` (line 807) right after the direct-path loop (before `pump_*`):
```rust
    fn drain_relay(&mut self) {
        for inbound in crate::adapters::moss_ffi::drain_relay_frames() {
            let frame: wire::RelayFrame = match wire::decode_json(&inbound.data) {
                Ok(f) => f,
                Err(e) => {
                    eprintln!("dropping malformed relay frame: {e}");
                    continue;
                }
            };
            let Some(session) = self.sessions.get_mut(&frame.session_id) else {
                continue;
            };
            // Authenticate: the frame's sender must be the peer we exchanged
            // ids with. Unknown/mismatched sender ⇒ drop (anti-spoof). If we
            // have not learned peer_moss_id yet, accept and pin it (first
            // relay frame can precede a resent handshake).
            match session.peer_moss_id.as_deref() {
                Some(known) if known != inbound.sender_hex => {
                    eprintln!("dropping relay frame: sender {} != peer", inbound.sender_hex);
                    continue;
                }
                None => session.peer_moss_id = Some(inbound.sender_hex.clone()),
                _ => {}
            }
            let channel = frame.channel_kind.channel_for(&frame.session_id);
            let message = MossReceivedMessage {
                channel,
                payload: frame.bytes,
                // Fill remaining MossReceivedMessage fields to match what the
                // direct callback produces — check the struct def; sender_id
                // if present = inbound.sender_hex bytes.
                ..Default::default()
            };
            if let Err(e) = session.handle_moss_message(message) {
                eprintln!("dropping relayed frame for {}: {e}", frame.session_id);
            }
        }
    }
```
In `drain_inbound`, after the `for message in inbound { … }` loop (line 831) and before `let now = now_ms();` (836), add: `self.drain_relay();`. **Verify `MossReceivedMessage`'s real fields** (grep its `struct` def) and construct it explicitly rather than `..Default::default()` if it has no `Default`; `handle_moss_message` only reads `.channel` and `.payload` (lines 1224-1234) + `has_seen_message` (`.channel`,`.payload`), so those two must be correct — dedup keys on them, so relayed and direct copies of the same MLS frame dedup against each other. 

- [ ] **Step 5: Run tests + build**

Run: `cargo test -p mosh --lib private_dm_runtime::wire`
Expected: PASS.
Run: `cargo build -p mosh` — 0 errors.

- [ ] **Step 6: Commit**

```bash
git -C /c/…/mosh add src-tauri/src/adapters/private_dm_runtime.rs src-tauri/src/adapters/private_dm_runtime/wire.rs
git -C /c/…/mosh commit -m "feat(dm): RelayFrame wrapper + parallel relay drain"
```

---

### Task 5: `route_send` chokepoint (direct pubsub vs relayed point-to-point)

**Files:**
- Modify: `mosh/src-tauri/src/adapters/private_dm_runtime.rs` (add `route_send`; convert the 3 control/data/blob publish sites)

**Interfaces:**
- Consumes: `ChannelKind` + `RelayFrame` (Task 4), `PrivateDmSession.peer_moss_id` (Task 3), `PrivateDmRuntime::relay_node()` (Task 2), `DmPath` (Task 6 — but define the enum here as `Direct`-default so this task builds standalone; Task 6 adds the transitions).
- Produces (consumed by Task 6): `PrivateDmSession::route_send(&self, kind: ChannelKind, payload: &[u8], relay_node: Option<&MossNode>) -> Result<(), PrivateDmRuntimeError>`.

- [ ] **Step 1: Write failing test — routing picks the right transport**

Add a runtime test that constructs a session, sets `path = DmPath::Direct`, and asserts `route_send` calls `node.publish` (reuse `fail_next_test_publish` to observe the publish path fires); then set `path = DmPath::Relayed`, `peer_moss_id = Some(...)`, pass a fake relay node, assert it does NOT publish on the direct node. (Exact assertion shape depends on test seams available — at minimum assert `Direct` + no relay node still publishes, and `Relayed` + `peer_moss_id=None` returns an error rather than publishing.)
```rust
#[test]
fn route_send_relayed_without_peer_id_errors_not_publishes() {
    let mut session = /* build minimal Alice session, path = Relayed, peer_moss_id = None */;
    let err = session.route_send(ChannelKind::Data, b"x", None);
    assert!(err.is_err(), "relayed send needs a peer_moss_id + relay node");
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cargo test -p mosh --lib private_dm_runtime -- route_send`
Expected: FAIL — `route_send`/`DmPath` undefined.

- [ ] **Step 3: Define `DmPath` + implement `route_send`**

Add (in `private_dm_runtime.rs`, near `SessionRole`):
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DmPath {
    /// Direct not yet decided; still hole-punching. Send goes direct (best
    /// effort) until we fall back.
    Discover,
    Direct,
    Relayed,
}
```
Add `path: DmPath,` to `PrivateDmSession` (init `DmPath::Discover` in `new`). Then:
```rust
    fn route_send(
        &self,
        kind: wire::ChannelKind,
        payload: &[u8],
        relay_node: Option<&MossNode>,
    ) -> Result<(), PrivateDmRuntimeError> {
        match self.path {
            DmPath::Direct | DmPath::Discover => self
                .node
                .publish(&kind.channel_for(&self.session_id), payload)
                .map_err(|e| PrivateDmRuntimeError::Moss(e.to_string())),
            DmPath::Relayed => {
                let peer = self.peer_moss_id.as_deref().ok_or_else(|| {
                    PrivateDmRuntimeError::Moss("relayed send: peer moss-id unknown".into())
                })?;
                let node = relay_node.ok_or_else(|| {
                    PrivateDmRuntimeError::Moss("relayed send: relay node down".into())
                })?;
                let frame = wire::RelayFrame {
                    session_id: self.session_id.clone(),
                    channel_kind: kind,
                    bytes: payload.to_vec(),
                };
                let bytes = serde_json::to_vec(&frame)
                    .map_err(|e| PrivateDmRuntimeError::Codec(e.to_string()))?;
                node.relay_send_to(peer, &bytes)
                    .map_err(|e| PrivateDmRuntimeError::Moss(e.to_string()))
            }
        }
    }
```

- [ ] **Step 4: Convert the three publish sites**

The relay node lives on `PrivateDmRuntime`, but the publish sites are on `PrivateDmSession`. Two options — pick the one matching how these methods are called (verify caller borrows):
  - **(a)** thread `relay_node: Option<&MossNode>` into the session methods that publish (`handle_control`, the data/blob send paths), passing `self.relay_node()` from the `PrivateDmRuntime` caller; OR
  - **(b)** have `PrivateDmRuntime` own the send: move the 3 publish calls up to runtime-level wrappers that call `session.route_send(kind, payload, self.relay_node())`.
Convert these exact direct calls to route through `route_send(ChannelKind::_, payload, relay_node)`:
  - line 424 `node.publish(&control_channel(&invite.session_id), &key_package_payload)` → `Control`
  - lines 1313, 1335, 1355 (control/welcome/handshake-resend) → `Control`
  - lines 537, 649 (data) → `Data`
  - blob send site (grep `blob_channel` publish) → `Blob`
  - **Leave voice-call (line 1960) on direct `publish`** — real-time media is out of S2 scope. Add `// ponytail: voice stays direct-only; relay carries control/data/blob, add voice relay when a hard-NAT call actually needs it`.

- [ ] **Step 5: Run tests + build**

Run: `cargo test -p mosh --lib private_dm_runtime` — Expected: PASS (existing handshake/data tests still green — `Discover`/`Direct` route identically to today's `publish`).
Run: `cargo build -p mosh` — 0 errors.

- [ ] **Step 6: Commit**

```bash
git -C /c/…/mosh add src-tauri/src/adapters/private_dm_runtime.rs
git -C /c/…/mosh commit -m "feat(dm): route_send chokepoint (direct pubsub vs relayed p2p)"
```

---

### Task 6: Fallback state machine + migrate-to-direct

**Files:**
- Modify: `mosh/src-tauri/src/adapters/private_dm_runtime.rs` (transition logic, driven from `drain_inbound`)

**Interfaces:**
- Consumes: `DmPath` (Task 5), `PrivateDmSession.{peer_joined, node, path}`, `ensure_relay_up`/`release_relay`/`relay_node` (Task 2), `MossNode::mesh_info_json()` (direct-peer signal).
- Produces: `PrivateDmSession::has_direct_peer(&self) -> bool`, `PrivateDmRuntime::pump_transports(&mut self, now_ms: u64)`.

- [ ] **Step 1: Write failing tests — the three transitions**

Pure state-machine tests over a small decision fn (extract the *decision* from the IO so it is unit-testable):
```rust
// fn next_path(current: DmPath, has_direct: bool, elapsed_ms: u64, t_fallback: u64) -> DmPath
#[test]
fn discover_falls_back_after_budget_without_direct() {
    assert_eq!(next_path(DmPath::Discover, false, 9_999, 10_000), DmPath::Discover);
    assert_eq!(next_path(DmPath::Discover, false, 10_000, 10_000), DmPath::Relayed);
}
#[test]
fn direct_peer_always_wins() {
    assert_eq!(next_path(DmPath::Relayed, true, 99_999, 10_000), DmPath::Direct);
    assert_eq!(next_path(DmPath::Discover, true, 1, 10_000), DmPath::Direct);
}
#[test]
fn relayed_stays_relayed_while_no_direct() {
    assert_eq!(next_path(DmPath::Relayed, false, 99_999, 10_000), DmPath::Relayed);
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cargo test -p mosh --lib private_dm_runtime -- next_path`
Expected: FAIL — `next_path` undefined.

- [ ] **Step 3: Implement the decision fn + `has_direct_peer` + `pump_transports`**

```rust
const T_FALLBACK_MS: u64 = 10_000; // ≈ existing direct budget (hole-punch + handshake)

fn next_path(current: DmPath, has_direct: bool, elapsed_ms: u64, t_fallback: u64) -> DmPath {
    if has_direct {
        return DmPath::Direct; // direct always preferred, from any state
    }
    match current {
        DmPath::Discover if elapsed_ms >= t_fallback => DmPath::Relayed,
        other => other,
    }
}
```
`has_direct_peer`: derive from the per-DM node. Recommended concrete signal: parse `self.node.mesh_info_json()` for a non-empty peer list (the direct mesh has ≥1 peer). **Verify the JSON shape** by logging one `mesh_info_json()` at runtime or reading moss's `Moss_GetMeshInfo`; pick the field that lists connected peers. Fallback signal if mesh_info lacks peers: treat `peer_joined && path != Relayed` as direct (MLS completed over the direct node). Keep it in one small `has_direct_peer(&self) -> bool` so the choice is swappable.

`pump_transports`, called from `drain_inbound` (after `drain_relay`, before `pump_*`):
```rust
    fn pump_transports(&mut self, now_ms: u64) {
        // Collect transitions first (mutating relay refcount can't happen while
        // iterating self.sessions).
        let mut acquires: Vec<String> = Vec::new();
        let mut releases: Vec<String> = Vec::new();
        for (id, session) in self.sessions.iter_mut() {
            let elapsed = now_ms.saturating_sub(session.discover_started_ms);
            let next = next_path(session.path, session.has_direct_peer(), elapsed, T_FALLBACK_MS);
            if next == session.path {
                continue;
            }
            match (session.path, next) {
                (_, DmPath::Relayed) => acquires.push(id.clone()),
                (DmPath::Relayed, _) => releases.push(id.clone()),
                _ => {}
            }
            session.path = next;
        }
        for _ in &acquires {
            let _ = self.ensure_relay_up(); // ref-count up; ignore start error → stays "connecting"
        }
        for _ in &releases {
            self.release_relay();
        }
    }
```
Add `discover_started_ms: u64` to `PrivateDmSession` (set to `now_ms()` when the session is created/started). On a failed `ensure_relay_up`, revert that session's `path` to `Discover` so it retries next tick (spec Failure handling: "no relay reachable → stays connecting, retries").

- [ ] **Step 4: Run tests + build**

Run: `cargo test -p mosh --lib private_dm_runtime` — PASS.
Run: `cargo build -p mosh` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git -C /c/…/mosh add src-tauri/src/adapters/private_dm_runtime.rs
git -C /c/…/mosh commit -m "feat(dm): fallback state machine + migrate-to-direct"
```

---

### Task 7: Loopback integration test + Diagnostics "Path" row

**Files:**
- Test: `mosh/src-tauri/src/adapters/private_dm_runtime.rs` (integration test, `#[cfg(test)]`) or a new `tests/` file if the crate has an integration harness
- Modify: frontend diagnostics — locate `DiagnosticsDrawerSections` (grep) and add a "Path" row
- Modify: whatever command/serializer feeds the diagnostics drawer (expose `path` per DM: `direct` / `relayed via supernode`)

**Interfaces:**
- Consumes: everything above; `PrivateDmSession.path`, an in-process moss SuperNode for the loopback (check moss test helpers / whether a SuperNode can be spun in-process — if not feasible in CI, mark the integration test `#[ignore]` with a run note and keep the unit coverage as the gate).

- [ ] **Step 1: Write the loopback integration test (spec Testing → Integration)**

Two DM nodes, direct path blocked (bind to isolated loopback / no shared tracker), an in-process SuperNode on `RELAY_MESH_ID`; assert MLS messages exchange and `session.path == DmPath::Relayed`; then unblock direct and assert migration to `DmPath::Direct`. If an in-process SuperNode isn't available, `#[ignore]` it with a comment naming the manual/CI harness that runs it, and `log()` that the automated gate is the unit suite (Tasks 1-6). Do NOT silently skip — the spec's regression scenario (CGNAT flap → steady `relayed`, no join/leave storm) must be a named test even if `#[ignore]`d.

- [ ] **Step 2: Run it**

Run: `cargo test -p mosh --lib private_dm_runtime -- relay_loopback` (or `--ignored` to force)
Expected: PASS (or a clean ignore with a documented manual run).

- [ ] **Step 3: Add the Diagnostics "Path" row**

Grep `DiagnosticsDrawerSections`; add a row rendering the DM's path: `direct` / `relayed via supernode`, with a note that relay is E2E (spore sees only ciphertext). Expose `path` from the backend DM state to the frontend via the existing diagnostics command (grep the tauri command that populates the drawer). Follow the codebase's TanStack Query pattern for the fetch — no `useEffect`+`useState`.

- [ ] **Step 4: Build frontend + backend**

Run (Bash, bypassing cmd if using vite directly): `cargo build -p mosh` and the frontend typecheck (`npx tsc --noEmit` from `mosh`, invoked via Bash not npm-cmd).
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git -C /c/…/mosh add -A
git -C /c/…/mosh commit -m "feat(dm): relay loopback test + diagnostics Path row"
```

---

## Final verification (whole plan)

- [ ] `cargo test -p mosh` (from `mosh/src-tauri`) — full suite green.
- [ ] `cargo build -p mosh --release` — 0 errors (relay symbols resolve at dll load).
- [ ] Manual smoke per the spec regression scenario, or the documented `#[ignore]` harness.
- [ ] `git -C mosh log --oneline` shows the 8 atomic commits (Task 0 chore + 7 feats).

## Spec coverage self-check

| Spec section | Task |
|---|---|
| Shared relay-mesh node (`Moss_Init "moss-relay/1"`, ref-counted, bundled spores) | 2 (+ RELAY_BOOTSTRAP_SPORES stub deferred to S3) |
| Point-to-point relayed messages (`Moss_RelaySendTo` / relay callback) | 1 |
| Fallback state machine (`Discover → Direct/Relayed`, migrate to direct) | 6 |
| Gap 1: no remote moss peer-id → exchange in KeyPackage/Welcome, store `peer_moss_id` | 3 |
| Gap 2: relay frames carry no channel → `RelayFrame{session,channel_kind,bytes}` + parallel drain | 4 |
| Gap 3: direct=pubsub vs relay=p2p → `route_send` chokepoint | 5 |
| moss submodule bump to c02acb4 + rebuild dll | 0 |
| Failure handling (no relay → connecting; flap → re-dial; direct recovers → migrate) | 6 (+ best-effort spore connect in 2) |
| UI Path row | 7 |
| Testing (unit derivation vector) | **obsoleted by Gap-1 resolution — see Task 3 self-review note** |
| Testing (loopback integration, CGNAT regression) | 7 |
