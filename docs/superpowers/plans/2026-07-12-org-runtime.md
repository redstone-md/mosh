# Org Runtime Implementation Plan (Plan 3: spec build-order 5–7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Join an org from a bundle URI, gossip/verify rosters, bootstrap DMs and org-bound groups from the roster, auto-kick revoked members, and surface it all in the UI.

**Architecture:** New `org_runtime.rs` owns one moss node per org (same lifecycle as `private_group_runtime`), verifies rosters via `org_roster::verify`, authenticates all org-channel traffic with `org_envelope` (ADR 0007). `private_group_runtime` gains an optional `org_pubkey` binding that switches a group to peer-id credentials (ADR 0004), roster-derived commit authority (ADR 0005), enveloped control traffic (closes the PR #21 residual), and auto-kick (ADR 0008). Poll-driven throughout — no timers, no event bus; cross-runtime effects (auto-kick) are wired in `lib.rs` commands.

**Tech Stack:** Rust (tauri v2, ed25519-dalek 2, openmls 0.8.1, redb), React/TS (existing poll-driven gateway pattern — the codebase does not use TanStack/Zustand; follow local convention).

## Global Constraints

- Envelope domain: `"mosh-org-v1" || org_pubkey || mesh_id || channel_kind || payload` (u64 LE length-prefixed) — already frozen in `org_envelope.rs`.
- Bundle URI: `mosh://org?mesh=<org_mesh_id>&name=<label>#org=<org_pubkey_64hex>`.
- Confirmation code: first 12 hex of own peer-id, chunked by 4 (`a1b2-c3d4-e5f6`).
- Org control channel: `org-control/<org_mesh_id>`.
- Roster verification: `org_roster::verify(bytes, expected_org_pubkey, stored_version)`; anti-rollback strictly-greater.
- moss identity blob layout (moss/internal/crypto/keys.go, frozen by version byte): `[0]=1`, `[1..65]` ed25519 private (seed||pub), `[65..97]` noise priv, `[97..129]` noise pub. Total 129.
- Non-org DMs/groups: byte-for-byte unchanged behavior (serde defaults on new fields).
- No `ponytail:`-branded comments in committed source. No Co-Authored-By in commits.
- Tests: `cargo test` in `src-tauri`, `npm test` for frontend. Build check: `cargo clippy --all-targets`.

## PR structure

- **PR A (Tasks 1–7):** backend, branch `feat/org-runtime`. Fable review, fix, merge.
- **PR B (Tasks 8–10):** UI, branch `feat/org-ui`. Fable review, fix, merge.

---

### Task 1: `org_signing.rs` — signing key from the moss identity blob

**Files:**
- Create: `src-tauri/src/adapters/org_signing.rs`
- Modify: `src-tauri/src/adapters/mod.rs` (add `pub mod org_signing;`)

**Interfaces:**
- Produces: `signing_key_from_identity(blob: &[u8]) -> Result<SigningKey, OrgSigningError>`, `peer_id_hex(key: &SigningKey) -> String`, `confirmation_code(peer_id_hex: &str) -> String`.
- Consumed by Tasks 2–6 for enveloping and the join-flow code display.

- [ ] **Step 1: Write failing tests** (in-module `#[cfg(test)]`)

```rust
#[test]
fn extracts_signing_key_and_peer_id() {
    // Build a blob exactly the way moss encodes it.
    let seed = [7u8; 32];
    let key = ed25519_dalek::SigningKey::from_bytes(&seed);
    let pub_bytes = key.verifying_key().to_bytes();
    let mut blob = vec![1u8];
    blob.extend_from_slice(&seed);
    blob.extend_from_slice(&pub_bytes); // Go priv = seed || pub
    blob.extend_from_slice(&[0u8; 64]); // noise keys, irrelevant here
    let extracted = signing_key_from_identity(&blob).unwrap();
    assert_eq!(peer_id_hex(&extracted), hex::encode(pub_bytes));
}

#[test]
fn rejects_wrong_version_or_length() {
    assert!(signing_key_from_identity(&[0u8; 129]).is_err()); // version 0
    assert!(signing_key_from_identity(&[1u8; 64]).is_err()); // short
}

#[test]
fn rejects_mismatched_embedded_pubkey() {
    let mut blob = vec![1u8];
    blob.extend_from_slice(&[7u8; 32]);
    blob.extend_from_slice(&[9u8; 32]); // wrong pub half
    blob.extend_from_slice(&[0u8; 64]);
    assert!(signing_key_from_identity(&blob).is_err());
}

#[test]
fn confirmation_code_chunks_first_12_hex() {
    assert_eq!(confirmation_code("a1b2c3d4e5f6ffff"), "a1b2-c3d4-e5f6");
}
```

- [ ] **Step 2:** `cargo test org_signing` — FAIL (module missing).
- [ ] **Step 3: Implement**

```rust
use ed25519_dalek::SigningKey;

const IDENTITY_VERSION: u8 = 1;
const IDENTITY_LEN: usize = 129;

#[derive(Debug)]
pub enum OrgSigningError {
    BadBlob(&'static str),
}
// + Display/Error impls matching the codebase's error style.

/// The moss identity blob (moss/internal/crypto/keys.go) is version-tagged:
/// [1][ed25519 priv 64 = seed||pub][noise priv 32][noise pub 32]. The seed
/// alone reconstructs the key; the embedded public half is cross-checked so
/// a corrupted blob fails closed instead of signing with a wrong identity.
pub fn signing_key_from_identity(blob: &[u8]) -> Result<SigningKey, OrgSigningError> {
    if blob.len() != IDENTITY_LEN {
        return Err(OrgSigningError::BadBlob("length"));
    }
    if blob[0] != IDENTITY_VERSION {
        return Err(OrgSigningError::BadBlob("version"));
    }
    let seed: [u8; 32] = blob[1..33].try_into().expect("slice len checked");
    let key = SigningKey::from_bytes(&seed);
    if key.verifying_key().to_bytes() != blob[33..65] {
        return Err(OrgSigningError::BadBlob("pubkey mismatch"));
    }
    Ok(key)
}

pub fn peer_id_hex(key: &SigningKey) -> String {
    hex::encode(key.verifying_key().to_bytes())
}

pub fn confirmation_code(peer_id_hex: &str) -> String {
    let head: String = peer_id_hex.chars().take(12).collect();
    head.as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("-")
}
```

- [ ] **Step 4:** `cargo test org_signing` — PASS.
- [ ] **Step 5:** Commit `feat(org): extract org signing key from moss identity blob`.

---

### Task 2: `org_runtime.rs` — records, bundle URI, join/leave, OrgHello

**Files:**
- Create: `src-tauri/src/adapters/org_runtime.rs`
- Modify: `src-tauri/src/adapters/mod.rs`, `src-tauri/src/adapters/persistence.rs` (new table `org_records`)

**Interfaces:**
- Consumes: `start_node`-style init via `MossFfiRuntime::init_default_node`, `Persistence::{get_moss_identity, put/get/list_org_roster}`, Task 1.
- Produces (used by lib.rs in Task 7):
  - `OrgRuntime::from_shared(moss: Arc<MossFfiRuntime>, persistence: Option<Arc<Persistence>>) -> Self`
  - `join_org(&mut self, req: JoinOrgRequest) -> Result<OrgSnapshot, OrgError>` where `JoinOrgRequest { bundle_uri: String, display_name: String, listen_port: u16, static_peer: Option<String> }`
  - `leave_org(&mut self, org_pubkey: &str) -> Result<(), OrgError>`
  - `poll(&mut self, org_pubkey: &str) -> Result<OrgSnapshot, OrgError>`; `list(&mut self) -> Vec<OrgSnapshot>`; `rehydrate(&mut self)`
  - `OrgSnapshot { org_pubkey, org_name, mesh_id, own_peer_id, confirmation_code, in_roster: bool, roster_version: Option<u64>, members: Vec<OrgMemberView>, dm_offers: Vec<OrgDmOfferView>, dm_links: Vec<OrgDmLink> }` (members/dm fields filled in Tasks 3–4; empty here)
  - `OrgMemberView { moss_peer_id, name, role, is_self: bool }`
- Persistence: table `ORG_RECORDS: TableDefinition<&str, &[u8]> = "org_records"`, key = org_pubkey, value = serde_json `PersistedOrgRecord { org_pubkey, org_name, mesh_id, display_name, listen_port, static_peer, dm_links: Vec<OrgDmLink> }`; methods `put_org_record/get_org_record/list_org_records/delete_org_record` + `delete_org_roster(org_pubkey)` (for leave), all following the `ORG_ROSTERS` pattern.

Core mechanics:
- Bundle parse mirrors `ParsedGroupInvite::parse`: scheme `mosh`, host/path `org`, query `mesh`, `name`, fragment `org=<64hex>` (validate 64 hex chars). Reject otherwise.
- `join_org`: duplicate org_pubkey → `OrgError::Duplicate`. Start node on `mesh` (same `init_default_node` + callbacks + `start` + `subscribe("org-control/<mesh_id>")` sequence as `private_group_runtime::start_node`). Read identity via `persistence.get_moss_identity()` → Task 1 key; if identity missing (fresh install, no node ever started): after `node.start()` the keystore has saved it — read again; if still missing → `OrgError::IdentityUnavailable`.
- OrgHello publish: enveloped `OrgMessage::Hello { moss_peer_id, display_name }` (see Task 3 for the `OrgMessage` enum) with `OrgContext { org_pubkey, mesh_id, channel_kind: "org-control" }`. Re-published on every `poll` while `in_roster == false` (poll cadence is the app's heartbeat; no timers).
- `leave_org`: drop node, `delete_org_record` + `delete_org_roster`.
- `rehydrate`: re-start nodes for every persisted record (mirror group runtime's rehydrate; tolerate node failures by skipping).

- [ ] **Step 1: Failing tests** — bundle parse (valid/invalid), join persists record + returns code, duplicate rejected, leave removes record. Node-dependent tests follow the existing pattern in `private_group_runtime.rs` tests (in-process nodes, port 0).

```rust
#[test]
fn parses_bundle_uri() {
    let b = ParsedOrgBundle::parse(
        "mosh://org?mesh=orgmesh-1&name=acme#org=aa...64hex...",
    ).unwrap();
    assert_eq!(b.mesh_id, "orgmesh-1");
    assert_eq!(b.org_name, "acme");
    assert_eq!(b.org_pubkey.len(), 64);
}

#[test]
fn rejects_bad_bundle() {
    for bad in [
        "mosh://org?mesh=m#org=zz", // short/invalid hex
        "mosh://org?name=x#org=<64hex>", // missing mesh
        "https://org?mesh=m&name=x#org=<64hex>", // wrong scheme
    ] { assert!(ParsedOrgBundle::parse(bad).is_err()); }
}
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(org): org runtime join/leave with bundle URI and OrgHello`.

---

### Task 3: roster gossip — verify, persist, serve, snapshot

**Files:**
- Modify: `src-tauri/src/adapters/org_runtime.rs`

**Interfaces:**
- Produces: `OrgMessage` wire enum on `org-control/<mesh_id>`; all variants EXCEPT `Roster` travel inside `OrgSigned` (the roster is self-authenticating — spec ADR 0007):

```rust
#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
enum OrgMessage {
    /// NOT enveloped: verified by org signature + version anti-rollback.
    Roster { roster_json_b64: String },
    Hello { moss_peer_id: String, display_name: String },
    DmOffer(OrgDmOfferWire), // Task 4
}
```

- Inbound handling in `drain_inbound` (called from `poll`, mirroring group runtime):
  - `Roster`: `org_roster::verify(bytes, org_pubkey, stored_version)`; on success persist bytes, recompute `members`, set `in_roster`, record `diff().removed` into `pending_removals: Vec<RosterMember>` (consumed by lib.rs wiring in Task 7 for auto-kick). Failure → warn log, drop.
  - Stale roster (Rollback error) → republish our stored roster (gossip convergence: the sender is behind).
  - `Hello` (enveloped, verified): if we hold a roster → republish it (serves "offered to newly seen peers"). Hellos from peers already in roster are idempotent no-ops otherwise.
- Envelope verify for non-Roster messages: `org_envelope::verify(&env, &ctx)` then reject if `env.peer_id` not in current roster — EXCEPT `Hello`, which by definition comes from not-yet-members (identity-proof only; roster gate happens at the admin CLI).
- `take_pending_removals(&mut self, org_pubkey) -> Vec<String>` — drained by Task 7 wiring.

- [ ] **Step 1: Failing tests** — two runtimes on one in-process mesh: A holds roster (injected via test helper `absorb_roster_bytes` simulating admin-CLI publish), B joins, B's poll sees members + `in_roster=true`; rollback roster rejected; tampered roster rejected; removal shows up in `take_pending_removals`; hello from B triggers A republishing roster (B converges without waiting for the CLI).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(org): roster gossip with verify, anti-rollback and convergence`.

---

### Task 4: DM bootstrap from roster (OrgDmOffer)

**Files:**
- Modify: `src-tauri/src/adapters/org_runtime.rs`

**Interfaces:**
- Produces:
  - `send_dm_offer(&mut self, org_pubkey: &str, target_peer_id: &str, invite_uri: &str) -> Result<(), OrgError>` — lib.rs first calls the existing `PrivateDmRuntime::create_invite`, then hands the URI here. Wire: `OrgMessage::DmOffer(OrgDmOfferWire { offer_id, target_peer_id, from_name, invite_uri })`, enveloped.
  - Inbound: verified envelope + sender in roster + `target_peer_id == own_peer_id` → append `OrgDmOfferView { offer_id, from_peer_id, from_name, invite_uri }` to snapshot `dm_offers` (accept-once by `offer_id`, dedup set).
  - `accept_dm_offer(&mut self, org_pubkey, offer_id) -> Result<String /* invite_uri */, OrgError>` — removes the offer, records `OrgDmLink { peer_id, session_id: None }`; lib.rs then runs `accept_invite` and calls back `link_dm(&mut self, org_pubkey, peer_id, session_id)` to fill the session id (persisted in the org record). The sender side calls `link_dm` right after `send_dm_offer`.
  - `dismiss_dm_offer(&mut self, org_pubkey, offer_id)`.
  - `OrgDmLink { peer_id: String, session_id: Option<String> }` — exposed in snapshot; the UI uses it for member→DM navigation and the "no longer in org" badge (link whose peer_id is absent from roster).
- Revocation policy layer falls out for free: offers from a removed member fail the roster check and are dropped (spec §6 policy layer); links are never deleted on removal (DMs are standalone).

- [ ] **Step 1: Failing tests** — offer from roster member surfaces on target; offer from non-member dropped; offer aimed at someone else ignored; duplicate offer_id surfaces once; accept returns URI and records link; link survives roster removal (badge data).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(org): roster-driven DM offers with org links`.

---

### Task 5: org group binding — peer-id credentials, enveloped control channel, admission

**Files:**
- Modify: `src-tauri/src/adapters/private_group_runtime.rs`, `src-tauri/src/adapters/mls_crypto.rs`

**Interfaces:**
- `CreateGroupRequest`/`JoinGroupRequest` gain `#[serde(default)] pub org_pubkey: Option<String>` (and join needs `#[serde(default)] pub org_mesh_id: Option<String>` — no: the group runs on its own mesh from the invite URI; org_mesh_id not needed. Envelope ctx uses the GROUP mesh_id).
- `PersistedGroupSession` + `GroupSession` gain `org_pubkey: Option<String>` (`#[serde(default)]` keeps old records loadable).
- `GroupSnapshot` gains `pub org_pubkey: Option<String>` and `pub member_peer_ids: Vec<String>` (from `crypto.member_identities()`; empty for non-org groups — UI's add-prompt diff needs it).
- mls_crypto: add

```rust
/// Credential identity inside a serialized KeyPackage (admission rule ADR 0004).
pub fn key_package_identity(key_package_bytes: &[u8]) -> Result<String, MlsCryptoError>
```

  (deserialize `KeyPackageIn` exactly as `add_peer` does, read `credential().serialized_content()` as utf8 — same accessor `member_identities` uses.)
- Org group sessions build `MlsSessionCrypto::new(&own_peer_id)` — identity = peer-id, not display name (ADR 0004). `own_peer_id` comes from `org_signing` via a new `GroupSession` field `org_signer: Option<Arc<SigningKey>>`, loaded in `create_group`/`join_group`/`rehydrate` when `org_pubkey.is_some()` (from `persistence.get_moss_identity()`; error out of create/join if unavailable).
- **Control-channel enveloping (closes PR #21 residual):** for org groups every outbound control publish wraps the serialized `ControlEnvelope` in `OrgSigned` with `OrgContext { org_pubkey, mesh_id: <group mesh_id>, channel_kind: <control channel name> }`. Inbound on org groups: parse `OrgSigned` first, `org_envelope::verify`, then decode inner `ControlEnvelope`; verified `env.peer_id` is threaded into `handle_control` as `sender_peer_id: Option<String>`. Non-org groups keep raw JSON both ways. Unverifiable envelope → warn, drop.
- **Admission rule** (org groups, `ControlEnvelope::KeyPackage` handler): admin accepts iff `key_package_identity(&kp)? == sender_peer_id` AND peer-id is in the org roster (lazy roster read: `persistence.get_org_roster(org_pubkey)` + `org_roster::verify(bytes, org_pubkey, None)` — self-stored bytes re-verify cheaply). Mismatch/no-roster → drop + warn. Also apply dedup rule: if a leaf with the same peer-id exists, use `crypto.replace_member` instead of `add_members` (stale leaf removed in the same commit — ADR 0004).

- [ ] **Step 1: Failing tests** — org group create/join round-trip with 2 members: credentials are peer-ids (`member_identities` returns hex ids); control traffic on the wire is `OrgSigned` (subscribe a bystander node, assert raw payload parses as `OrgSigned`, not `ControlEnvelope`); KeyPackage with credential ≠ envelope peer-id rejected; joiner not in roster rejected; rejoin (same peer-id, fresh KeyPackage) lands via replace not add (member_count stable); non-org group still speaks raw JSON (regression).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(group): org binding with peer-id credentials and enveloped control channel`.

---

### Task 6: roster-derived commit authority + roster-lag buffer + org resync rules

**Files:**
- Modify: `src-tauri/src/adapters/private_group_runtime.rs`

**Interfaces:**
- `ControlEnvelope::Commit` gains `#[serde(default)] roster_version: Option<u64>` (authors on org groups stamp their current verified roster version).
- Authority check in the org-group commit path (`sequence_commit` call sites): a commit is applied only if the author (verified `sender_peer_id`) has `role == "admin"` in the lazily-read roster. Not admin:
  - author's `roster_version > ours` → buffer `(roster_version, commit_b64, epoch)` in `GroupSession.roster_lag: Vec<(u64, String)>` (cap 16, drop oldest) and re-offer on the next roster change;
  - else → drop + warn.
- `retry_roster_lagged(&mut self)` on GroupSession: called whenever poll sees a newer persisted roster version than the last one checked (cache `last_roster_version_seen: Option<u64>` on the session; compare each poll — one redb read, fine at this scale).
- Org-group role rules replace fingerprint-admin machinery (ADR 0005): `is_admin` for org groups = own peer-id has `role: admin` in roster, computed per poll (`AdminHandoff`/`current_admin_fingerprint` stay untouched for non-org groups; org groups ignore them). `serve_resync_request` on org groups: any roster admin serves; requests/responses already ride the envelope after Task 5 — verify requester is a roster member before serving (revoked members get nothing — spec §6 policy layer).
- Own commits on org groups stamp `roster_version` from the stored roster.

- [ ] **Step 1: Failing tests** — non-admin's commit dropped (member C sends remove commit, group state unchanged); admin's commit applies; commit with higher roster_version buffered, then applied after new roster where author is admin lands (inject via persistence write + poll); resync request from revoked member unanswered; admin flag follows roster role, not creator fingerprint.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(group): roster-derived commit authority with roster-lag buffer`.

---

### Task 7: revocation wiring, manual add, org group offers, tauri commands

**Files:**
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/adapters/private_group_runtime.rs`, `src-tauri/src/adapters/org_runtime.rs`

**Interfaces:**
- private_group_runtime produces:
  - `enforce_roster_removals(&mut self, org_pubkey: &str, removed_peer_ids: &[String])` — for each org-bound group where self is roster-admin: `crypto.remove_members_by_identity(peer_ids)`, publish enveloped commit, log it, persist (ADR 0008 auto-kick). Also calls each session's `retry_roster_lagged`.
  - `send_group_offer(...)` is NOT here — org group invites go over org-control (below).
- org_runtime produces:
  - `OrgMessage::GroupOffer(OrgGroupOfferWire { offer_id, target_peer_id, group_invite_uri, group_label, org_pubkey })`, enveloped, roster-gated like DmOffer; snapshot field `group_offers: Vec<OrgGroupOfferView>`; `send_group_offer(org_pubkey, target_peer_id, invite_uri, label)` + `accept_group_offer`/`dismiss_group_offer` (accept returns the invite URI; lib.rs runs `join_group` with `org_pubkey` set).
- lib.rs:
  - `OrgState { runtime: Mutex<Option<OrgRuntime>>, load_error: Option<String> }` following `PrivateGroupState` exactly; managed in `setup`.
  - Commands (all thin `with_runtime` wrappers, names frozen for the gateway):
    `org_join(request: JoinOrgRequest) -> OrgSnapshot`, `org_leave(org_pubkey)`, `org_list() -> Vec<OrgSnapshot>`, `org_poll(org_pubkey) -> OrgSnapshot`,
    `org_send_dm_offer(org_pubkey, target_peer_id)` (locks DM state → `create_invite` → org state → `send_dm_offer` + `link_dm`),
    `org_accept_dm_offer(org_pubkey, offer_id) -> SessionSnapshot` (org state accept → DM state `accept_invite` → org `link_dm`),
    `org_dismiss_dm_offer(org_pubkey, offer_id)`,
    `org_create_group(org_pubkey, label, member_peer_ids: Vec<String>) -> GroupCreated` (group state `create_group{org_pubkey}` → org state `send_group_offer` per member),
    `org_accept_group_offer(org_pubkey, offer_id) -> GroupSnapshot`, `org_dismiss_group_offer(org_pubkey, offer_id)`,
    `org_group_invite_members(org_pubkey, group_id, member_peer_ids)` (re-offer for the "+N not in group" prompt).
  - **Auto-kick wiring:** `org_poll` after polling drains `take_pending_removals` and, non-empty, locks PrivateGroupState → `enforce_roster_removals`. Lock order everywhere: DM → Org → Group (document at the state structs; never nest in another order).
  - DM create/accept for org offers reuse the setup defaults for `display_name`/`listen_port` the way `use-dm-offers.ts` does today (`requestBase`) — commands take those as parameters from the frontend, mirroring existing offer commands.
- [ ] **Step 1: Failing tests** — runtime-level (lib.rs commands are thin): `enforce_roster_removals` kicks removed member from an org group (3-party, revoked member's decrypt fails post-commit, epoch advanced) and skips groups where self is not roster-admin; group offer round-trip surfaces on target and is roster-gated.
- [ ] **Step 2:** FAIL. **Step 3:** Implement runtime methods, then lib.rs state + commands + `invoke_handler` registration. **Step 4:** `cargo test` + `cargo clippy --all-targets` — green. **Step 5:** Commit `feat(org): revocation auto-kick, group offers and tauri commands`.
- [ ] **Step 6:** Full suite, push `feat/org-runtime`, open **PR A**, run fable-subagent review, fix all findings, merge on green + user go-ahead.

---

### Task 8: gateway + types (frontend)

**Files:**
- Modify: `src/features/private-dm/native/native-messaging-gateway.ts` (+ demo gateway `native/demo-native-messaging-gateway.ts`, state in `native/demo-native-state.ts`)

**Interfaces (TS mirrors of Rust snapshots, exact command names from Task 7):**

```ts
export interface OrgMemberView { moss_peer_id: string; name: string; role: string; is_self: boolean; }
export interface OrgDmOfferView { offer_id: string; from_peer_id: string; from_name: string; invite_uri: string; }
export interface OrgGroupOfferView { offer_id: string; from_peer_id: string; group_label: string | null; group_invite_uri: string; }
export interface OrgDmLink { peer_id: string; session_id: string | null; }
export interface OrgSnapshot {
  org_pubkey: string; org_name: string; mesh_id: string;
  own_peer_id: string; confirmation_code: string;
  in_roster: boolean; roster_version: number | null;
  members: OrgMemberView[]; dm_offers: OrgDmOfferView[];
  group_offers: OrgGroupOfferView[]; dm_links: OrgDmLink[];
}
```

Gateway methods: `joinOrg`, `leaveOrg`, `listOrgs`, `pollOrg`, `orgSendDmOffer`, `orgAcceptDmOffer`, `orgDismissDmOffer`, `orgCreateGroup`, `orgAcceptGroupOffer`, `orgDismissGroupOffer`, `orgGroupInviteMembers` — thin `invoke` wrappers + demo-gateway fakes (roster of 3 fake members so the UI is developable without Tauri).

- [ ] Steps: failing vitest for demo gateway behavior (join → snapshot with code; accept offer moves link) → implement → pass → commit `feat(ui): org gateway methods and demo state`.

---

### Task 9: org UI — join flow, rail section, member list → DM

**Files:**
- Create: `src/features/private-dm/org/OrgSection.tsx`, `src/features/private-dm/org/use-orgs.ts`, `src/features/private-dm/org/JoinOrgPanel.tsx`
- Modify: `src/features/private-dm/SessionRail.tsx`, `src/features/private-dm/NewSessionPanel.tsx` (+ `NewSessionPanelSteps.tsx`), `src/features/private-dm/private-dm-screen.tsx`

**Behavior (existing poll-driven hook pattern, no new state libs):**
- `use-orgs.ts`: state `orgs: OrgSnapshot[]`; refresh piggybacks the app's existing refresh cycle (called from `usePrivateDmSnapshots`'s consumer via a `refreshOrgs` merged into the screen's `refresh`); actions `joinOrg`, `leaveOrg`, `memberDm(org, member)` (existing link → `setActive({type:"dm",...})`, else `orgSendDmOffer`), `acceptDmOffer`, `acceptGroupOffer`, dismissals.
- `JoinOrgPanel`: bundle-URI input inside `NewSessionPanel` (new tab/section beside invite input). After join, show the confirmation-code screen verbatim: "Your confirmation code: `a1b2-c3d4-e5f6` — give it to your admin" + waiting state until `in_roster`.
- `OrgSection` in the rail per org: header (org name + leave button with `ConfirmDialog`), member rows (name, role chip, click → DM), incoming org DM/group offers rendered like existing `offers` rows with accept/dismiss.
- Removed-member badge: in the rail DM row, if any org's `dm_links` contains this session_id and that link's peer_id is not in that org's roster → suffix badge "no longer in <org_name>".
- [ ] Steps: failing vitest (screen-level, demo gateway: join shows code; member click creates offer; badge shows for revoked link) → implement → pass → commit `feat(ui): org join flow, roster rail and member DM`.

---

### Task 10: group add-prompt + org group offers + polish

**Files:**
- Modify: `src/features/private-dm/ActiveChatPanes.tsx` (group header area), `src/features/private-dm/org/OrgSection.tsx`, content strings in `private-dm.content.ts`

**Behavior:**
- Active org-bound group (snapshot has `org_pubkey`): if own role is admin and roster has members whose peer-id ∉ `member_peer_ids` → banner "N roster members not in this group — Add" → `orgGroupInviteMembers` with the missing ids (spec §5 manual-add, one click, batched offers).
- Org group creation: "New group in <org>" action in OrgSection → label + member checkboxes → `orgCreateGroup`.
- `needs_rejoin` on a group snapshot already exists — surface as a banner "Group out of sync — rejoin needed" with a "Rejoin" action = `orgAcceptGroupOffer`-equivalent rejoin via fresh join (post-v1 note if wiring is disproportionate: banner alone acceptable for this PR, rejoin gesture = leave + accept fresh offer).
- [ ] Steps: failing vitest (admin sees add banner with correct count; non-admin doesn't) → implement → pass → `npm test` + `npm run build` green → commit `feat(ui): org group manual add and sync banners`.
- [ ] Push `feat/org-ui`, open **PR B**, fable review, fix, merge on green + user go-ahead.

---

## Self-review notes (spec coverage)

- §3 org runtime: Tasks 2–3. §4 DM bootstrap: Task 4. §5 org groups: Tasks 5, 7, 10. §6 revocation: Tasks 4 (policy drop + links), 6 (resync gating), 7 (auto-kick). §7 resync org rules + PR #21 residual: Tasks 5–6. §8 device replace: client side = admission dedup/replace (Task 5) + ordinary revocation handling (Task 7) — CLI `--replace` is out of repo. UI section: Tasks 9–10. §10 CLI: out of scope (formats frozen since Plan 1).
- Deliberate v1 cuts (spec-sanctioned): no commit tie-break, no pruning, no timers (poll-driven Hello/republish), roster re-read instead of role-change events.
- Cut beyond spec (call out in PR): `org_accept_dm_offer` auto-uses setup defaults for display name/port rather than a dedicated dialog — matches existing DM-offer accept UX.
