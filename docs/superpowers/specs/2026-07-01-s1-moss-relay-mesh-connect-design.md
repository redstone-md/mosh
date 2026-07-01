# S1 — moss relay-mesh connect-by-peer-id

Date: 2026-07-01
Status: design, pending review
Repo: `moss` (Go core). Consumed by S2 (mosh) and S3 (MossSpore).
Parent: [universal-relay-overview](2026-07-01-universal-relay-overview.md)

## Purpose

Let a node join a shared **relay mesh** on demand and establish a **relayed
session to a known target peer-id** through the mesh's SuperNodes, exposed as an
ordinary moss session the host app can read/write. This reuses the existing Mesh
TURN relay (§3.2) unchanged — S1 adds only the *targeted, on-demand* entry point
that Mosh (S2) needs.

Non-goals: no new relay protocol, no changes to SuperNode promotion, rate
limiting, E2E, or direct-path logic. No plaintext access.

## What already exists (reused as-is)

- `selectRelayPeer(targetPeerID)` / `selectRelayPeers(targetPeerID)` — choose
  publicly-reachable, `natTrusted`, `relayCapable` SuperNodes to reach a target.
- `handleRelayRequest` / `handleRelayAccept` / `handleRelayData` / `handleRelayClose`
  with `RelaySource` / `RelayTarget` peer-ids and relay routes (`route.allows`).
- `shouldPreferRelayForTarget` / `shouldPreferRelayBetween(local, remote)` — the
  symmetric↔symmetric trigger.
- Relay rate limits (`relayBucketFor`, `relayRateLimits`), E2E Noise over the
  relay, transparent migration to direct.

The gap: today relay engages for peers already discovered *within a DM mesh*. On
the relay mesh we must let a client **ask to reach a specific peer-id it learned
out-of-band** (from the invite), even before gossip has surfaced that peer.

## Additions (small, in `internal/mesh`)

1. **`relay_mesh.go` — on-demand relay-mesh membership.**
   `JoinRelayMesh(ctx)` / `LeaveRelayMesh()` bring up a lightweight node presence
   on `relay_mesh_id = "moss-relay/1"`: bootstrap on `sha1(relay_mesh_id)`
   (tracker + DHT + bundled static spores), connect to a few SuperNodes, do **not**
   fan out full gossip (leaf: relay-only, bounded peer set). Idempotent; ref-counted
   so multiple DMs share one relay-mesh presence.

2. **`relay_connect.go` — targeted relayed dial.**
   `DialRelayed(ctx, targetPeerID, remoteStatic) (*transport.Session, error)`:
   pick SuperNodes via `selectRelayPeers(targetPeerID)`; open a relay route
   (`RelayRequest` → `RelayAccept`); run the **Noise XX handshake end-to-end to
   the target over `RelayData` frames** (the SuperNode forwards ciphertext); return
   the established session. On a SuperNode failing/stalling, try the next; error
   only when the list is exhausted. `remoteStatic` (target's Noise static key,
   from the invite) pins the handshake so a hostile SuperNode cannot MITM.

3. **Accept side** — the target's node already accepts relayed sessions via
   `handleRelayData` + `registerPeer`. Add only: when a relayed inbound session
   completes on the relay mesh, surface it to the host through the normal peer
   path (it already does; verify the relay-mesh node delivers it to the app
   channel S2 reads).

4. **FFI surface (`cmd/moss-ffi`)** — one addition consumed by S2:
   `Moss_ConnectRelayed(handle, target_peer_id, remote_static_key)` → starts (2)
   for a given DM's peer; the resulting session feeds the same subscribe/publish
   path the DM already uses. Status in the existing network-stats struct: `path ∈
   {direct, relayed}`, `relay_supernode` (coarse).

## Data flow (hard-NAT DM, both peers on the relay mesh)

```
A (CGNAT)                 SuperNode spore S            B (CGNAT)
  | JoinRelayMesh ------------>|<------------ JoinRelayMesh |
  | DialRelayed(peerID_B) ---->|                            |
  |      RelayRequest -------->| --- RelayRequest --------->|
  |<----- RelayAccept ---------| <-- RelayAccept -----------|
  |==== Noise XX (A↔B) over RelayData; S forwards ciphertext ====|
  |==== DM MLS messages E2E ====================================|
  |  (migrates to direct if NAT later allows — existing logic)  |
```

Both peers derive `peerID_B` / `peerID_A` from the static keys exchanged in the
invite, so each can address the other on the relay mesh without prior gossip.

## Failure handling

- **No SuperNode reachable** → `DialRelayed` returns an error after trying the
  bootstrapped set; S2 stays "connecting" and retries. No regression vs today.
- **SuperNode drops mid-session** → existing relay teardown fires; S2 re-dials via
  the next SuperNode; MLS state (above transport) survives.
- **Hostile SuperNode** → cannot read/forge (Noise to the pinned target static
  key); can drop/stall/see coarse metadata; client switches SuperNode.
- **Relay-mesh scale** → leaf membership + bounded SuperNode connections keep a
  client's footprint small even with hundreds of members; relay load spreads over
  many SuperNode spores.

## Interfaces (Go, sketch)

```go
func (n *Node) JoinRelayMesh(ctx context.Context) error
func (n *Node) LeaveRelayMesh() error
func (n *Node) DialRelayed(ctx context.Context, targetPeerID string, remoteStatic []byte) (*transport.Session, error)
```

`DialRelayed` returns a `*transport.Session` identical in shape to a direct dial,
so the DM stack above is transport-agnostic (S2 requirement).

## Testing

- Reuse existing relay tests; add: three loopback nodes (A, B, SuperNode S) where
  A↔B have no direct path; `DialRelayed` establishes an A↔B Noise session via S;
  assert S only ever forwards ciphertext (never observes plaintext).
- `JoinRelayMesh` is idempotent + ref-counted (two joins, one leave keeps
  presence; second leave tears down).
- SuperNode failover: kill S mid-dial with a second SuperNode present; `DialRelayed`
  re-converges on the survivor.
- Migration: once a direct path opens, the relayed session yields to direct
  (existing behaviour, add a regression assertion).

## Open decisions (resolved)

- **Reuse Mesh TURN, add only a targeted entry point** — no parallel relay
  mechanism; stays inside moss's SuperNode-relay model (G1).
- **Address by peer-id derived from the invite's static key** — no new invite
  field; the static key also pins the E2E handshake against SuperNode MITM.
- **Leaf relay-mesh membership, ref-counted** — bounded footprint; one presence
  shared by all of a client's relayed DMs.
