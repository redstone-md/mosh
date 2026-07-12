# Group Commit Resync Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the known desync bug in private groups (spec §7): a member offline during a membership commit, or receiving commits out of order, currently desyncs permanently. Prerequisite for reliable org revocation.

**Architecture:** Three layers. (1) `mls_crypto`: expose group epoch + peek a commit's wire epoch without processing. (2) A pure `CommitSequencer` (buffer keyed by epoch, dedup, gap detection) replacing the `processed_commits` set. (3) Runtime wiring: persist applied/produced commits into `group_commit_log` (Plan 1 table), `ResyncRequest`/`ResyncResponse` control envelopes with the admin as sole responder, `needs_rejoin` surfaced when a gap cannot be bridged.

**Tech Stack:** Rust, OpenMLS 0.8, redb via Plan 1's `append_group_commit`/`list_group_commits_from`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-org-roster-design.md` §7. ADR 0005 (the same buffer machinery later gains a roster-version trigger — keep the sequencer org-agnostic).
- Branch `feat/group-commit-resync`; PR at the end.
- Commit's "epoch" = the epoch it applies AT (wire header epoch; merge advances epoch to N+1).
- Single responder: only the group admin answers ResyncRequests (exactly one admin exists in non-org groups; avoids response storms).
- No timers in v1: a resync request fires on gap detection and after rehydrate; no timeout-based retry. An unanswered request re-fires on the next gap trigger.
- Tests: `cargo test --manifest-path src-tauri/Cargo.toml <filter>` (PowerShell). Runtime tests may access private items (in-module `#[cfg(test)]`).

---

### Task 1: mls_crypto epoch accessors

**Files:** Modify `src-tauri/src/adapters/mls_crypto.rs`

**Interfaces (produces):**
- `pub fn epoch(&self) -> Option<u64>` — current group epoch, `None` before join.
- `pub fn commit_epoch(commit_bytes: &[u8]) -> Result<u64, MlsCryptoError>` — associated fn; reads the wire header epoch without touching group state (works for public and private messages: the epoch is in the header).

Tests (TDD):

```rust
    #[test]
    fn epoch_advances_and_commit_epoch_peeks() {
        let (mut admin, _bob, _carol) = three_party();
        let e0 = admin.epoch().unwrap();
        let mut dave = MlsSessionCrypto::new("peer-dave").unwrap();
        let kp = dave.key_package_bytes().unwrap();
        let outcome = admin.add_members(&[kp.as_slice()]).unwrap();
        // The commit was created AT e0 and advanced the group to e0+1.
        assert_eq!(
            MlsSessionCrypto::commit_epoch(&outcome.commit_bytes).unwrap(),
            e0
        );
        assert_eq!(admin.epoch().unwrap(), e0 + 1);
    }

    #[test]
    fn commit_epoch_rejects_garbage() {
        assert!(MlsSessionCrypto::commit_epoch(b"not a commit").is_err());
    }
```

Implementation sketch:

```rust
    pub fn epoch(&self) -> Option<u64> {
        self.group.as_ref().map(|g| g.epoch().as_u64())
    }

    /// Wire-header epoch of a serialized commit — readable without processing.
    pub fn commit_epoch(commit_bytes: &[u8]) -> Result<u64, MlsCryptoError> {
        let message = MlsMessageIn::tls_deserialize(&mut &commit_bytes[..])
            .map_err(|error| MlsCryptoError::Codec(error.to_string()))?;
        let protocol_message = message
            .try_into_protocol_message()
            .map_err(|error| MlsCryptoError::Codec(error.to_string()))?;
        Ok(protocol_message.epoch().as_u64())
    }
```

Commit: `feat(mls): expose group epoch and commit wire epoch`

---

### Task 2: pure CommitSequencer

**Files:** Create `src-tauri/src/adapters/commit_sequencer.rs`; register in `mod.rs`.

**Interfaces (produces):**

```rust
pub enum Disposition {
    Apply,          // commit is for the current epoch — process now
    Buffered,       // future epoch — held; check gap()
    AlreadySeen,    // duplicate b64 or stale epoch — drop silently
}

pub struct CommitSequencer {
    seen: HashSet<String>,          // b64 of everything accepted or skipped
    buffered: BTreeMap<u64, String>, // future commits by wire epoch
    last_requested_epoch: Option<u64>, // resync-request dedup
}
```

- `offer(&mut self, current_epoch: u64, commit_epoch: u64, commit_b64: &str) -> Disposition`
- `mark_seen(&mut self, commit_b64: String)` — for Welcome-carried admission commits (replaces `processed_commits.insert`).
- `drain_ready(&mut self, current_epoch: u64) -> Option<String>` — pops the buffered commit for `current_epoch`, if any (caller loops: apply → epoch advanced → call again).
- `gap(&self, current_epoch: u64) -> Option<u64>` — `Some(current_epoch)` when a buffered commit exists whose epoch > current (i.e. something is missing in between or the buffered head is not yet applicable); `None` otherwise.
- `should_request(&mut self, have_epoch: u64) -> bool` — true once per distinct `have_epoch` (dedups repeat requests while stuck at the same epoch).

Semantics table (drives tests):
| condition | disposition |
|---|---|
| b64 already in `seen` | AlreadySeen |
| commit_epoch < current | AlreadySeen (stale replay; also insert into `seen`) |
| commit_epoch == current | Apply (insert into `seen`) |
| commit_epoch > current | Buffered (insert into `seen` + buffer) |

Tests: exact-epoch applies; duplicate b64 dropped; stale dropped; future buffered then drained in order after epoch advances (buffer epochs N+1, N+2 while at N → apply N (external), drain N+1, drain N+2); gap reported when buffered head > current; `should_request` fires once per epoch value and re-arms after epoch changes.

Commit: `feat(group): pure commit sequencer with epoch buffer and gap detection`

---

### Task 3: wire sequencer + commit log into the group runtime

**Files:** Modify `src-tauri/src/adapters/private_group_runtime.rs`

Changes, anchored to current code:

1. `GroupSession`: replace `processed_commits: HashSet<String>` (field at ~:346) with `sequencer: CommitSequencer`. `process_commit_once` (:1421) becomes `apply_commit_sequenced(commit_b64)`:

```rust
    fn apply_commit_sequenced(&mut self, commit_b64: String) -> Result<(), PrivateGroupError> {
        let Some(current) = self.crypto.epoch() else {
            return Ok(());
        };
        let commit_bytes = decode(&commit_b64)?;
        let wire_epoch = MlsSessionCrypto::commit_epoch(&commit_bytes)?;
        match self.sequencer.offer(current, wire_epoch, &commit_b64) {
            Disposition::AlreadySeen => return Ok(()),
            Disposition::Buffered => return self.request_resync_if_gapped(),
            Disposition::Apply => {}
        }
        self.crypto.process_commit(&commit_bytes)?;
        self.log_commit(wire_epoch, &commit_bytes);
        // Buffered successors may now be applicable.
        while let Some(current) = self.crypto.epoch() {
            let Some(next_b64) = self.sequencer.drain_ready(current) else {
                break;
            };
            let next_bytes = decode(&next_b64)?;
            self.crypto.process_commit(&next_bytes)?;
            self.log_commit(current, &next_bytes);
        }
        Ok(())
    }

    fn log_commit(&self, epoch: u64, commit_bytes: &[u8]) {
        if let Some(p) = self.persistence.as_ref() {
            if let Err(e) = p.append_group_commit(&self.group_id, epoch, commit_bytes) {
                eprintln!("group {}: commit log write failed: {e}", self.group_id);
            }
        }
    }
```

   `GroupSession` needs a `persistence: Option<Arc<Persistence>>` handle (clone of the runtime's) — plumb it through session construction sites (`create_group`, invite-accept, `rehydrate`).

2. Producer side logs too: everywhere the admin creates a commit, capture `self.crypto.epoch()` BEFORE the producing call, then `log_commit(pre_epoch, &commit_bytes)`. Sites: the `KeyPackage` admit arm (`add_members`, :1450) and the `SelfRemove` arm (`commit_pending`, :1538).

3. Welcome arm (:1491): `self.processed_commits.insert(commit_b64)` → `self.sequencer.mark_seen(commit_b64)`.

Tests (in-module, no moss node needed — operate on `GroupSession`-level helpers via the crypto directly is impossible; instead test through two runtimes exchanging crafted `ControlEnvelope` JSON via `handle_control`, following the existing in-module private-access pattern):
- member receives commits N+1 then N (out of order) → both applied, member decrypts post-commit traffic;
- duplicate commit re-delivery is a no-op;
- applied commits appear in `list_group_commits_from`.

Commit: `feat(group): sequence commits by epoch and persist commit log`

---

### Task 4: resync protocol + needs_rejoin

**Files:** Modify `src-tauri/src/adapters/private_group_runtime.rs`

1. New `ControlEnvelope` variants (enum at :199):

```rust
    ResyncRequest {
        group_id: String,
        from_fingerprint: String,
        have_epoch: u64,
    },
    ResyncResponse {
        group_id: String,
        for_fingerprint: String,
        commits: Vec<ResyncCommit>, // { epoch: u64, commit_b64: String }
    },
```

2. Requester: `request_resync_if_gapped()` — if `sequencer.gap(current)` and `sequencer.should_request(current)`, publish `ResyncRequest { have_epoch: current }`. Also fire once per joined group after `rehydrate()` (member may have missed commits while offline; `should_request` dedups).

3. Responder (admin only): on `ResyncRequest` with `self.is_admin && group_id == self.group_id && from_fingerprint != own_fp`, read `list_group_commits_from(&group_id, have_epoch)`, publish `ResyncResponse` directed at `from_fingerprint`. Empty result → still respond with empty `commits` (lets the requester learn the gap is unbridgeable).

4. Requester on `ResyncResponse` (matching `for_fingerprint == own_fp`): feed each commit through `apply_commit_sequenced`. After processing, if `sequencer.gap(current)` still reports a gap (or the response was empty while a gap exists) → set `self.needs_rejoin = true`; expose the flag in the group snapshot for the UI ("rejoin needed", spec Error handling: never silent desync).

5. `needs_rejoin: bool` field on `GroupSession` + snapshot struct + UI contract (snapshot only; UI work is Plan 3).

Tests:
- admin answers request with exactly the commits ≥ have_epoch;
- member with a gap + admin log → converges, `needs_rejoin` stays false;
- member with a gap + empty admin log (fresh-state admin) → `needs_rejoin` true;
- non-admin never responds to ResyncRequest.

Commit: `feat(group): admin-served commit resync and needs_rejoin state`

---

### Task 5: full suite + PR

`cargo test` full, `cargo fmt`, push `feat/group-commit-resync`, `gh pr create`. Body references spec §7 and notes: fixes pre-existing desync bug for ALL private groups, org or not; admin-only responder documented as a narrowing of spec §7 ("any member that observed it" stores commits — kept — but only the admin serves them in v1).
