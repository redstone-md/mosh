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

1. **A shared relay-mesh node.** mosh runs one extra moss node via
   `Moss_Init("moss-relay/1", …)` + `Moss_Start`, config `static_peers` = the
   bundled spore list (S3) so it connects to SuperNode spores. Ref-counted: started
   when the first DM needs relay, stopped when the last relayed DM closes. This is
   the "relay-mesh membership" — moss needs no `JoinRelayMesh` (one node = one
   mesh, so membership is just a second Init).

2. **Point-to-point relayed messages.** The DM peer is addressed by its moss
   peer-id = `hex(ed25519 pub)` = the invite `fingerprint` (no new invite field,
   no key seeding — the peer's Noise static arrives via announce flooding, S1).
   - Send: `Moss_RelaySendTo(relayHandle, peerID_B, mls_ciphertext, len)`.
   - Receive: `Moss_SetRelayCallback(relayHandle, cb)` delivers `(senderPeerID,
     ciphertext)` to the same DM message handler the direct path uses.
   DM messages ride point-to-point relay frames — **not** pubsub — so no DM topic
   is published on the shared relay mesh (no metadata leak).

3. **Fallback state machine per DM** (`private_dm_runtime`):

```
        ┌── direct connected ─────────────► DIRECT (steady, per-DM mesh)
DISCOVER┤
        └── no direct peer after T_fallback ─► RELAYED
RELAYED: ensure relay-mesh node up (ref-counted) → route this DM's outgoing MLS
         messages through Moss_RelaySendTo(peerID_B); deliver inbound via the
         relay callback demultiplexed by senderPeerID → DM.
Any state: if the per-DM mesh reports a direct peer, switch routing back to direct
         and drop relay use for this DM (direct always preferred).
```

`T_fallback` ≈ the existing direct budget (hole-punch attempts + handshake
timeout) so relay fires only after direct genuinely fails.

## FFI / boundary

moss owns the mechanics (S1, already merged); mosh owns policy (when to fall back,
which peer-id, demultiplexing inbound relay frames by sender). Consumed S1
exports:

- `Moss_RelaySendTo(handle, target_peer_id, data, len) -> i32`.
- `Moss_SetRelayCallback(handle, cb)` — `cb(sender_id[32], data, len)`.

The relay callback carries only the 32-byte sender peer-id; mosh maps it to the
DM whose invite `fingerprint` matches. No new invite fields.

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
