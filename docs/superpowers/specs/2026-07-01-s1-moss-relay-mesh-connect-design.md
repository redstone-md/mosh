# S1 — moss relay-by-peer-id FFI (reuse existing Mesh TURN)

Date: 2026-07-01
Status: design, pending review (revised after code audit)
Repo: `moss` (Go core). Consumed by S2 (mosh) and S3 (MossSpore).
Parent: [universal-relay-overview](2026-07-01-universal-relay-overview.md)

## Audit result — most of S1 already exists

A code audit of moss found the relay-by-peer-id path is **already implemented**
and E2E-encrypted; the via-SuperNode only forwards ciphertext. Reuse verbatim:

- `Node.OpenRelaySessionAny(targetPeerID, timeout)` — picks SuperNodes via
  `selectRelayPeers` and opens a relay session to a target peer-id.
- `Node.RelaySendTo(targetPeerID, data, timeout)` — auto-opens (or reuses) a relay
  session and sends a point-to-point frame to the target.
- `Node.RelaySend(sessionID, data)` — send on an open session.
- Inbound relay frames surface to the host via `RelayCallback` (`dispatchRelay` →
  `relayCB`); the relayed peer registers as a normal `peerConn{relayed:true}`.
- E2E crypto (`sealRelayGossipEnvelope` / `relayGossipAEAD`): X25519 DH between the
  two peers' Noise static keys, keyed by `meshID` — the SuperNode sees only
  `Payload` ciphertext. Relay rate limits, session TTL, migrate-to-direct all exist.

So S1 does **not** build a new relay. The purpose collapses to exposing the
existing relay over the C FFI plus one seeding helper, so mosh (S2) can drive it.

## The two real gaps

1. **Out-of-band peer seeding.** A peer-id is `hex(ed25519 public key)`
   (`localPeerID`), but the relay E2E crypto and `registerRelayedPeerLocked`
   require the *other* key — the peer's 32-byte **Noise static** — to be present in
   `knownPeers[peerID].noiseStatic`. On a large shared relay mesh a specific peer
   is not gossip-discovered, so both keys must be injected from the invite before
   the first relay attempt.

2. **No relay FFI.** `cmd/moss-ffi` exports Init/Start/Subscribe/Publish/Connect/
   callbacks but nothing for relay send/receive or peer seeding.

Relay-mesh *membership* is **not** a moss change: a moss node is one mesh, so the
relay mesh is simply a second `Moss_Init("moss-relay/1", …)` node that mosh runs
(S2), with the bundled spore list passed as `static_peers` so both endpoints share
a SuperNode. moss needs no `JoinRelayMesh` method.

## Additions (small)

### moss core — one method

`internal/mesh/node_relay_api.go`:

```go
// SeedKnownPeer injects a peer's identity learned out-of-band (e.g. from a Mosh
// invite) so a relay session can be opened to it before gossip discovery.
// peerID is hex(ed25519 pub); noiseStatic is the 32-byte Noise static pub.
func (n *Node) SeedKnownPeer(peerID string, noiseStatic []byte) error
```

It validates `len(noiseStatic)==32` and a well-formed hex peerID, then under
`n.mu` sets `knownPeers[peerID]` (create or update) with `id=peerID`,
`noiseStatic=copy`, `natTrusted=false`, `lastSeen=now`. It does **not** mark the
peer relay-capable or reachable — it only supplies the static key the relay path
needs. Idempotent.

### moss FFI — three exports (`cmd/moss-ffi/main.go`)

```c
int32_t Moss_SeedKnownPeer(MossHandle h, const char* peer_id, const uint8_t* noise_static /*32*/);
int32_t Moss_RelaySendTo(MossHandle h, const char* target_peer_id, const uint8_t* data, int32_t len);
void    Moss_SetRelayCallback(MossHandle h, MossRelayCallback cb);   // delivers inbound relay frames
```

- `Moss_SeedKnownPeer` → `node.SeedKnownPeer` (copies 32 bytes from C).
- `Moss_RelaySendTo` → `node.RelaySendTo(peerID, data, node handshake timeout)`.
- `Moss_SetRelayCallback` → `node.SetRelayCallback`, marshalling `(senderPeerID,
  data)` to C like the existing `Moss_SetCallback` does for messages.

`MossRelayCallback` typedef added to the cgo preamble alongside the existing
callback typedefs; the delivery goroutine rule (invoke from a Go goroutine, never
a C thread) matches `Moss_SetCallback`.

### mesh-info (observability, optional)

`meshInfo` already exposes `RelaySessionCount` / `RelayedPeerCount` /
`SupernodeReady`; S2's diagnostics reuse them. Add a per-peer `path` only if
needed — deferred (YAGNI) unless S2 asks.

## Data flow (unchanged mechanics, new entry points)

```
A relay-mesh node          SuperNode spore S            B relay-mesh node
  Moss_Init("moss-relay/1"), static_peers=[bundled spores] → both connect to S
  Moss_SeedKnownPeer(peerID_B, noiseStatic_B)   (from invite)
  Moss_RelaySendTo(peerID_B, mls_ciphertext) ──► RelayRequest/Accept via S ──►
        RelayData(Payload=E2E ciphertext) ─────────────────► B: relayCB(peerID_A, …)
  (existing rate limit, TTL, migrate-to-direct all apply)
```

Point-to-point `RelaySendTo` is used (not pubsub) so no DM topic is published on
the shared relay mesh — the SuperNode and other members learn no topic, only that
two peer-ids exchange ciphertext.

## Failure handling (all existing)

- No SuperNode with the target reachable → `RelaySendTo` returns an error after
  `OpenRelaySessionAny` exhausts candidates; S2 retries / stays "connecting".
- SuperNode drop → existing relay teardown; S2 re-sends (auto-reopens a session).
- Hostile SuperNode → cannot read/forge (E2E to the seeded Noise static); only
  drop/stall/coarse metadata; `OpenRelaySessionAny` tries other SuperNodes.

## Testing

- `SeedKnownPeer`: rejects non-32-byte static and bad hex; sets
  `knownPeers[peerID].noiseStatic`; idempotent (second call overwrites cleanly).
- Reuse/confirm the existing 3-node relay test (initiator, target, SuperNode) with
  peers seeded via `SeedKnownPeer` instead of gossip discovery; assert the
  SuperNode only forwards ciphertext (never sees plaintext) and the target's
  `relayCB` receives the frame.
- FFI smoke (Go test around cgo boundary or via the existing FFI test harness):
  `Moss_SeedKnownPeer` + `Moss_RelaySendTo` deliver to `Moss_SetRelayCallback` on
  the peer through a loopback SuperNode.
- Regression: existing relay + migrate-to-direct tests still pass.

## Open decisions (resolved)

- **Reuse `RelaySendTo` point-to-point, not pubsub** — avoids leaking a DM topic
  on the shared relay mesh; still fully E2E.
- **Seed both keys from the invite** — peer-id (ed25519) addresses the relay;
  Noise static enables the E2E crypto. S2 extends the invite to carry the Noise
  static (32 bytes) alongside the existing fingerprint.
- **Relay-mesh membership lives in mosh (S2) as a second node** — no moss
  `JoinRelayMesh`; keeps moss's one-node-one-mesh model intact.
