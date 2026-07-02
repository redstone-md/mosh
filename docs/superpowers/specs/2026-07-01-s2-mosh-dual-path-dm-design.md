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

## Reality gaps (mosh code audit) + resolutions

The audit found three gaps the first draft glossed. Each has a chosen resolution:

1. **No remote moss peer-id anywhere.** `Moss_RelaySendTo` targets
   `hex(ed25519 pub)` (64 lc hex, from `Moss_GetPublicKey`), but the invite
   `fingerprint` is the **MLS-signer** fingerprint (16 B → 32 uc hex, from
   `MlsSessionCrypto::fingerprint`) — wrong key, wrong length. No struct stores the
   peer's moss peer-id.
   → **Resolution:** exchange each device's moss peer-id in the existing MLS
   control handshake (add `moss_peer_id` to the `KeyPackage` / `Welcome`
   `ControlEnvelope` variants in `wire.rs`), captured from `session.node.public_key_hex()`,
   and store `peer_moss_id: Option<String>` on `PrivateDmSession`. The control
   handshake already runs over the per-DM mesh at setup, before relay is ever
   needed. **No invite change** (invite stays `mesh/session/#fp`).

2. **Inbound dispatch is channel-keyed; relay frames carry no channel.**
   `drain_inbound` routes by `message.channel` (`mls-control/…` etc.); the relay
   callback delivers `(sender_id, data)` only.
   → **Resolution:** frame relayed payloads as a tiny tagged wrapper
   `RelayFrame{ session_id, channel_kind ∈ {control,data,blob}, bytes }` (bincode/
   json). A new relay drain (parallel to `drain_inbound`) maps `sender_id →
   session` (via `peer_moss_id`), reconstructs the channel, and calls the existing
   `handle_moss_message` — so all MLS/dedup logic downstream is unchanged.

3. **Direct = pubsub (`node.publish(channel)`); relay = point-to-point
   (`RelaySendTo(peerID)`) on a different node.**
   → **Resolution:** a single send chokepoint per DM: `route_send(kind, payload)`
   that either `session.node.publish(channel, payload)` (direct) or
   `relayNode.relay_send_to(peer_moss_id, RelayFrame{…})` (relayed). The three
   existing publish sites (control/data/blob) call it.

Consequence: S2 is a real protocol change (control-envelope + a relay frame
format + a second node + a parallel drain + routing), not a thin wrapper.

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
- **Peer moss-id via the MLS control handshake, not the invite** — the invite
  `fingerprint` is the MLS-signer fingerprint, not the moss peer-id. Exchange the
  64-hex moss peer-id in the `KeyPackage`/`Welcome` control envelope; invite format
  unchanged, existing invites stay valid.
