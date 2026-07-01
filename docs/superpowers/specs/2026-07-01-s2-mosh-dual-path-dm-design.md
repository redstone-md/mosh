# S2 — mosh dual-path DM transport

Date: 2026-07-01
Status: design, pending review
Repo: `mosh` (Rust/Tauri + moss FFI). Depends on **S1**.
Parent: [universal-relay-overview](2026-07-01-universal-relay-overview.md)

## Purpose

Make a DM connect whether or not a direct P2P path exists. Today a DM is one
moss node on a secret `mesh_id` and dies when both peers are hard-NAT (no
SuperNode in a 2-person mesh). After S2 the DM uses **whichever transport
connects**: the existing direct per-DM mesh, or a Mesh-TURN-relayed session on
the shared **relay mesh** (S1). Conversation identity (MLS group + peer static
keys from the invite) is unchanged.

## What stays the same

- Per-DM secret `mesh_id`, the invite URI (mesh + session + peer fingerprint),
  MLS/Noise E2E crypto.
- The direct path (tracker/DHT + hole-punch on the per-DM mesh). Cone-NAT pairs
  are unaffected.

## What is added

1. **Relay-mesh presence, on demand.** When a DM has no direct peer after the
   direct-attempt budget, mosh calls S1 `JoinRelayMesh` (ref-counted; one presence
   shared by all relayed DMs). Cheap and only while needed.

2. **Targeted relayed dial.** The DM's peer is addressed on the relay mesh by the
   peer-id derived from the **static key already in the invite fingerprint**. mosh
   calls S1 `Moss_ConnectRelayed(handle, target_peer_id, remote_static_key)`; the
   returned session feeds the same subscribe/publish path the DM already uses.

3. **Fallback state machine per DM** (`private_dm_runtime`):

```
        ┌── direct connected ─────────────► DIRECT (steady)
DISCOVER┤
        └── no direct peer after T_fallback ─► RELAYED
RELAYED: JoinRelayMesh (ref-counted) → ConnectRelayed(peerID, static) → run the
         DM's MLS/Noise session over the returned transport.
Any state: if a direct path later appears, migrate to it and drop the relay
         (existing moss migration; direct always wins — also fixes the current
         "fragile outbound replaces stable inbound" thrash by preferring direct).
```

`T_fallback` ≈ the existing direct budget (hole-punch attempts + handshake
timeout) so relay fires only after direct genuinely fails.

## FFI / boundary

moss owns the mechanics (S1); mosh owns policy (when to fall back, which peer-id,
reading status). Consumed additions:

- `Moss_ConnectRelayed(handle, target_peer_id, remote_static_key)` (S1).
- `path ∈ {direct, relayed}` + `relay_supernode` in the existing network-stats
  struct.

No new invite fields: the peer-id and static key come from the invite's existing
`fingerprint`.

## UI / observability

- Diagnostics drawer gains a **Path** row: `direct` / `relayed via supernode`,
  noting the relay is E2E (spore sees only ciphertext). Reuses
  `DiagnosticsDrawerSections`.
- No user config for the common case (advanced pin/add bootstrap spores deferred,
  YAGNI).

## Failure handling

- **No relay reachable** → DM stays `DISCOVER` / "connecting"; retries. No worse
  than today.
- **Relay flaps** → S1 re-dials via the next SuperNode; Noise transport re-forms;
  MLS survives (above transport); only in-flight frames retransmit.
- **Direct recovers mid-relay** → migrate to direct, drop relay; never keep both.

## Testing

- Unit (Rust): peer-id derivation from the invite static key matches moss's Go
  derivation (shared test vectors committed to both repos).
- Integration (Rust + moss loopback): two DM nodes with the direct path blocked
  connect via an in-process SuperNode and exchange MLS messages; assert `path ==
  relayed`; then unblock direct and assert migration to `direct`.
- Regression: the CGNAT flap scenario reaches steady `relayed` with a SuperNode
  present; with none, degrades to "connecting", not a join/leave storm.

## Open decisions (resolved)

- **Fallback, not always-on** — direct stays preferred; relay is last resort.
- **moss owns dialing, mosh owns policy** — smallest FFI surface.
- **No new invite secret/field** — peer-id + static key come from the existing
  fingerprint; existing invites stay valid.
