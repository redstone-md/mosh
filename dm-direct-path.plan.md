# DM Direct Path on the Shared Substrate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the shared-substrate + sealed-rooms architecture (moss v0.6.x) and make mosh DMs reach `direct` path again: give room members a way to connect to each other by peer id, remove the supernode dial bias, stabilize relay readiness, refresh the spore.

**Architecture:** The substrate is room-blind, so a DM's counterpart is 1 of N world peers and is never preferentially dialed; glare avoidance forbids the higher-id public node from dialing at all; pub/sub only delivers between *connected* subscribers. Fix = (a) moss: explicit peer targets that bypass glare + ranking and are retried by the maintenance loop; (b) moss: neutral dial ranking with a small relay-capable quota instead of supernode-first; (c) mosh: request the explicit target as soon as `peer_moss_id` is known; (d) mosh: hysteresis on `relay_ready`; (e) ops: deploy substrate-era spore, seed relay bootstrap.

**Tech Stack:** Go (moss, MossSpore), Rust/Tauri (mosh), cgo FFI (`Moss_*` exports), systemd deploy on 94.130.74.148.

## Global Constraints

- Conventional Commits, atomic, no Claude attribution trailers.
- moss peer id = noise-static pubkey hex, 64 chars — same id space in `knownPeers`, `peer_details`, invite `moss=` param, relay targets.
- mosh↔moss FFI surface changes require: new symbol in `cmd/moss-ffi/main.go`, symbol load in `mosh/src-tauri/src/adapters/moss_ffi.rs`, dll rebuild (`npm run moss:prepare`), submodule bump.
- moss is consumed by MossSpore as a published Go module — moss changes need a pushed tag (v0.6.14) before the spore bump.
- Existing moss tests must stay green: `go test ./... -count=1` (uses `isolatedTestConfig` pattern — never touch the public DHT under test).
- mosh Rust tests: `cargo test` in `src-tauri` (fake-node test doubles already exist around `private_dm_runtime.rs:3273+`).
- Do not edit `Cargo.lock` by hand (block2 v0.6.3 incident — only `cargo update -p mosh` style bumps).

---

### Task 1: moss — explicit peer targets (`ConnectToPeer`)

**Files:**
- Create: `internal/mesh/node_explicit_targets.go`
- Modify: `internal/mesh/node_maintenance.go` (hook the retry into the ~1s peer-maintenance tick)
- Modify: `internal/mesh/node_types.go` (add `explicitTargets map[string]time.Time` to Node)
- Modify: `internal/mesh/node_lifecycle.go` (init map in NewNodeWithIdentity)
- Test: `internal/mesh/explicit_target_test.go`

**Interfaces:**
- Produces: `func (n *Node) ConnectToPeer(peerID string) int32` — registers a persistent priority target and kicks an async attempt; returns `MOSS_OK` / `MOSS_ERR_CONFIG_INVALID` (bad id) / `MOSS_ERR_NOT_STARTED`. Non-blocking.
- Behavior: registered target is retried on every peer-maintenance tick (~1s) with the existing `peerDials` cooldown until the peer is connected (direct or relayed); attempt = `tryDirectConnect` → fallback `OpenRelaySessionAny` (same pipeline as `dialKnownPeer`); **ignores the glare rule and dial ranking**; existing `promoteRelayPeers` upgrades relayed → direct automatically. Target unregisters on Stop; staying registered while connected is fine (no-op when `n.peers[id]` exists).

- [ ] **Step 1: Failing test** — two public nodes on an isolated substrate with several decoy nodes; the *higher-id* node calls `ConnectToPeer(lowerID)` (glare rule would forbid this dial) and must reach a connected (eventually direct) peer within the test deadline. Second test: unknown id is retried until an announce arrives, then connects. Mirror helpers from `direct_connect_test.go` / `isolatedTestConfig`.
- [ ] **Step 2: Run** `go test ./internal/mesh -run ExplicitTarget -count=1` — FAIL (method undefined).
- [ ] **Step 3: Implement** `node_explicit_targets.go`:

```go
package mesh

import "time"

// ConnectToPeer registers peerID as an explicit priority target: the
// maintenance loop keeps dialing it (direct first, relay fallback) until a
// connection exists, bypassing the glare rule and the discovery ranking.
// The registration survives disconnects and is dropped on Stop.
func (n *Node) ConnectToPeer(peerID string) int32 {
    if len(peerID) != 64 || peerID == n.localPeerID() {
        return MOSS_ERR_CONFIG_INVALID
    }
    n.mu.Lock()
    if !n.started {
        n.mu.Unlock()
        return MOSS_ERR_NOT_STARTED
    }
    n.explicitTargets[peerID] = time.Time{} // zero = due immediately
    n.mu.Unlock()
    go n.dialExplicitTarget(peerID)
    return MOSS_OK
}

// dialExplicitTargets runs from the peer-maintenance tick.
func (n *Node) dialExplicitTargets() {
    now := time.Now()
    cooldown := n.config.HandshakeTimeout()
    n.mu.Lock()
    due := make([]string, 0, len(n.explicitTargets))
    for peerID, last := range n.explicitTargets {
        if _, connected := n.peers[peerID]; connected {
            continue
        }
        if !last.IsZero() && now.Sub(last) < cooldown {
            continue
        }
        n.explicitTargets[peerID] = now
        due = append(due, peerID)
    }
    n.mu.Unlock()
    for _, peerID := range due {
        go n.dialExplicitTarget(peerID)
    }
}

func (n *Node) dialExplicitTarget(peerID string) {
    if n.directPeerConnected(peerID) {
        return
    }
    if !n.tryDirectConnect(peerID, n.config.HandshakeTimeout()) &&
        n.establishedRelaySession(peerID) == "" {
        _, _ = n.OpenRelaySessionAny(peerID, n.config.HandshakeTimeout())
    }
}
```

Adapt to real field/lock idioms while implementing (`n.started` accessor, dedupe of concurrent dials via the timestamp update).
- [ ] **Step 4: Run** the new test — PASS; then `go test ./internal/mesh -count=1` — green.
- [ ] **Step 5: Commit** `feat(mesh): explicit peer targets that bypass glare and dial ranking`

### Task 2: moss — neutral dial ranking + relay quota

**Files:**
- Modify: `internal/mesh/node_peer_discovery.go:70-100` (`discoveredPeerTargets` sort)
- Test: `internal/mesh/peer_discovery_ranking_test.go` (new; unit-level over `discoveredPeerTargets` if a seam exists, else table test over the extracted sort)

**Interfaces:**
- Produces: dial-target ordering = bootstrap first, then **relay-capable only while fewer than 2 relay-capable peers are connected** (`relayQuota = 2`), then score / lastSeen / id. `relayCandidateRank` is REMOVED from dial ordering (it stays in `selectRelayPeers`, which legitimately needs relay-capable peers).

- [ ] **Step 1: Failing test** — knownPeers with 3 relay-capable + 5 plain peers, 2 relay-capable already connected → selected targets must contain no relay-capable peer while plain candidates exist; with 0 relay-capable connected → relay-capable peers fill at most the quota deficit, remainder plain.
- [ ] **Step 2: Run** — FAIL (current order puts relay-capable first unconditionally).
- [ ] **Step 3: Implement** — extract ordering into a pure helper, e.g.:

```go
// orderDialTargets: bootstrap > (relay-capable, only while deficit > 0) >
// score > lastSeen > id. Relay-capable peers beyond the deficit are pushed
// behind plain peers so the mesh stops clustering on supernodes.
func (n *Node) relayCapableConnectedLocked() int { /* count n.peers whose knownPeer info is relayCapable */ }
```

In `discoveredPeerTargets`, compute `deficit := 2 - n.relayCapableConnectedLocked()` under the existing lock, then sort: bootstrap; then if `deficit > 0` relay-capable before plain (and decrement conceptually by position); if `deficit <= 0` plain before relay-capable; then score, lastSeen, id.
- [ ] **Step 4: Run** new + full mesh tests — PASS. Watch `churn_topology_test.go` / `load_topology_test.go` for assumptions about supernode-first dialing; fix tests only if they encoded the old bias.
- [ ] **Step 5: Commit** `fix(mesh): stop preferring relay-capable peers when dialing (quota of 2)`

### Task 3: moss — FFI export + tag

**Files:**
- Modify: `cmd/moss-ffi/main.go` (new export next to `Moss_RelaySendTo`)
- Test: `cmd/moss-ffi/main_test.go` (follow existing export-test pattern if present)

**Interfaces:**
- Produces: `//export Moss_ConnectToPeer` — `func Moss_ConnectToPeer(handle C.MossHandle, peerID *C.char) C.int32_t`; nil/empty id → `MOSS_ERR_CONFIG_INVALID`; delegates to `node.ConnectToPeer(C.GoString(peerID))`.

- [ ] **Step 1: Implement export** (10 lines, mirrors `Moss_RelaySendTo` shape).
- [ ] **Step 2: Run** `go build ./... && go test ./cmd/moss-ffi -count=1` — green; `go vet ./...`.
- [ ] **Step 3: Commit** `feat(ffi): export Moss_ConnectToPeer`
- [ ] **Step 4: Tag & push** `git tag v0.6.14 && git push origin main v0.6.14` (moss module must be fetchable before Task 4/6).

### Task 4: MossSpore — bump + deploy

**Files:**
- Modify: `go.mod` / `go.sum` (moss v0.6.14)

- [ ] **Step 1:** `go get github.com/redstone-md/moss@v0.6.14 && go build ./... && go test ./... -count=1`.
- [ ] **Step 2: Commit** `chore(deps): bump moss to v0.6.14 (explicit peer targets, neutral dial ranking)`
- [ ] **Step 3: Deploy** to 94.130.74.148 (current prod runs pre-substrate `v0.3.2+moss-d9760fb` — replace): cross-compile `GOOS=linux GOARCH=amd64`, scp binary, restart `systemd mossspore`, verify `curl 127.0.0.1:9800/health` + `/version` shows the new build, watch promotion (needs first peer after restart; same-IP colocation kills announces — the box must run exactly one spore).

### Task 5: mosh — FFI binding

**Files:**
- Modify: `src-tauri/src/adapters/moss_ffi.rs` (symbol type, struct field, load at `~:256`, method on `MossNode` near `relay_send_to` `~:374`)
- Modify: `src-tauri/src/adapters/moss_runtime.rs:13` region (symbol presence list, if it enumerates exports)

**Interfaces:**
- Produces: `pub fn connect_to_peer(&self, peer_id: &str) -> Result<(), MossFfiError>` on `MossNode` — one FFI call, non-blocking on the Go side, safe to call repeatedly (Go dedupes via the target registry).

- [ ] **Step 1:** Add `MossConnectToPeer` fn type + `connect_to_peer` symbol load + method (mirror `relay_send_to` minus payload).
- [ ] **Step 2:** `cargo build` in `src-tauri` (dll not rebuilt yet — build must still link since symbols load dynamically at runtime; adjust if the loader hard-fails on missing symbol → make the load optional-with-error until Task 7 bumps the dll, then required).
- [ ] **Step 3: Commit** `feat(ffi): bind Moss_ConnectToPeer`

### Task 6: mosh — request the counterpart connection

**Files:**
- Modify: `src-tauri/src/adapters/private_dm_runtime.rs` — session struct (`connect_requested_for: Option<String>`), `note_peer_moss_id` (`~:1792`), the ~1s drain tick next to `pump_handshake` (`~:1868`), `accept_invite` preseed path (`~:648`), rehydrate path
- Test: same file's test module (fake node double at `~:3273+`)

**Interfaces:**
- Consumes: `MossNode::connect_to_peer` (Task 5).
- Produces: `fn pump_peer_connect(&mut self)` — when `peer_moss_id` is `Some(id)`, `!peer_is_direct(...)`, and `connect_requested_for != Some(id)`: call `self.node.connect_to_peer(id)`, set `connect_requested_for = Some(id)`. Re-fires automatically when the id changes (peer re-handshake under a fresh identity). Driven from the same drain loop that calls `pump_handshake`.

- [ ] **Step 1: Failing test** — fake node records `connect_to_peer` calls: (a) Bob after `accept_invite` (id preseeded from invite) → exactly one call with Alice's id despite many ticks; (b) Alice: no call until `note_peer_moss_id`, then one call; (c) id change → second call with the new id.
- [ ] **Step 2: Run** `cargo test -p mosh pump_peer_connect` (adjust name) — FAIL.
- [ ] **Step 3: Implement** `pump_peer_connect` + wire into the drain tick; ignore FFI error (log via `eprintln!` like sibling pumps — Go retries anyway once registered; on error clear `connect_requested_for` so the next tick retries the FFI call itself).
- [ ] **Step 4: Run** — PASS; full `cargo test`.
- [ ] **Step 5: Commit** `feat(dm): request a direct connection to the counterpart by moss id`

### Task 7: mosh — relay_ready hysteresis

**Files:**
- Modify: `src-tauri/src/adapters/private_dm_runtime/relay.rs` (`relay_ready` `~:96`, worker loop `~:280`)
- Modify: caller that fills `SessionSnapshot.relay_ready`
- Test: `relay.rs` test module

**Interfaces:**
- Produces: `pub struct RelayReadiness { last_capable: Option<Instant> }` with `fn observe(&mut self, node: &MossNode) -> bool` — true if a relay-capable peer is visible now **or was within the last 10s** (`READY_HOLD: Duration = 10s`). Worker and snapshot each own an instance (or one shared behind the existing handle — pick whichever avoids new locking).

- [ ] **Step 1: Failing test** — pure-logic test over `RelayReadiness` with injected "capable now?" booleans and a mocked clock (pass `Instant`s in): capable→gap 9s→still ready; gap 11s→not ready.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (readiness struct keeps the pure `fn ready_at(&mut self, capable_now: bool, now: Instant) -> bool`; `observe` is a thin FFI wrapper). **Step 4:** tests PASS.
- [ ] **Step 5: Commit** `fix(dm): hold relay readiness for 10s so the path status stops flickering`

### Task 8: mosh — bootstrap spore + version bumps

**Files:**
- Modify: `src-tauri/src/adapters/private_dm_runtime/relay.rs:30` (`RELAY_BOOTSTRAP_SPORES`)
- Modify: `.gitmodules`-tracked `moss` submodule pointer, `src-tauri/Cargo.toml` version, `CHANGELOG.md`

- [ ] **Step 1:** `RELAY_BOOTSTRAP_SPORES = &["94.130.74.148:4001"]` (existing well-formedness test covers it). Commit `feat(dm): seed relay bootstrap with the mossspore relay`.
- [ ] **Step 2:** Bump submodule: detach `mosh/moss` at tag v0.6.14 (detached at upstream commit — never local main), `npm run moss:prepare` to rebuild the dll. Commit `chore(moss): bump submodule to v0.6.14 (ConnectToPeer + neutral dial ranking)`.
- [ ] **Step 3:** Make the Task 5 symbol load required (if it was made optional). `cargo test` full. Bump mosh to v0.6.5, update CHANGELOG. Commit `chore(release): bump mosh to v0.6.5 (DM direct path on the shared substrate)`.

### Task 9: live verification

- [ ] Two mosh instances (or with the friend): create invite → accept → MLS completes → path goes `relayed` → **upgrades to `direct`** within ~1 min; status does not flap between relayed/warming.
- [ ] `moss events` panel: no sub-second join/left churn for the counterpart id.
- [ ] Spore `/info`: relays sessions, peer count sane, promotion holds.
- [ ] Report: changed files, simplifications, remaining risks (per user's reporting convention).

## Deliberate non-goals (this plan)

- **One-node-per-device, N rooms** — right end-state, separate plan; removes per-DM node overhead and same-identity ambiguity.
- Room presence beacons — unnecessary for DM (invite + first relay frame already exchange peer ids).
- v0.6.13 relay-route reaping on the friend's fly.io gateway — his box; flag it to him.
