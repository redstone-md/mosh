# S2 — mosh dual-path DM transport

Date: 2026-07-01
Status: design, pending review
Repo: `mosh` (Rust/Tauri + moss FFI). Depends on **S1**.
Parent: [universal-relay-overview](2026-07-01-universal-relay-overview.md)

## Purpose

Make a DM connect whether or not a direct P2P path exists. Today a DM is one
moss node on a secret `mesh_id` and dies when both peers are hard-NAT. After S2,
the DM runs over **whichever transport connects first**: the existing direct
per-DM mesh, or an S1 rendezvous-relay session. The conversation identity (MLS
group + peer static keys from the invite) is unchanged; only the transport under
it gains a fallback.

## What stays the same

- Per-DM secret `mesh_id` (from `crypto.random_token("mesh")`), the invite URI
  (mesh + session + peer fingerprint), and MLS/Noise E2E crypto.
- The direct path: tracker/DHT discovery + hole-punch on the per-DM mesh. For
  peers where at least one side is reachable (e.g. cone NAT), nothing changes.

## What is added

1. **A persistent overlay attachment per running app.** On startup mosh brings up
   one S1 `Overlay` discovery handle (leaf, not gossip member) so relay is ready
   before it is needed. Cheap: discovery announce + a small live spore set.

2. **Rendezvous token derivation.** For each DM, mosh computes
   `T = HMAC(mesh_id, "moss-rendezvous" || epoch)` (S1 vocabulary). Both peers
   already share `mesh_id`, so both derive equal `T` with no new exchange.

3. **Fallback state machine per DM** (in `private_dm_runtime`):

```
        ┌── direct connected ──────────────► DIRECT (steady)
DISCOVER┤
        └── no direct peer after T_fallback ─► RENDEZVOUS
RENDEZVOUS: RendezvousDialer.Dial(T, role) via S1 → run DM Noise+MLS over the
            returned conn. role = local_pubkey < remote_pubkey ? A : B.
Either state: if a *better* path (direct) later appears, migrate to it and drop
            the relay (relay is fallback, direct is preferred).
```

`T_fallback` ≈ the existing direct-attempt budget (hole-punch attempts +
handshake timeout), so the relay only fires once direct has genuinely failed.

4. **Invite carries overlay reachability hint (optional).** The invite already
   carries the peer fingerprint. No new secret is required for rendezvous (the
   token comes from `mesh_id`). The invite may additionally embed a preferred
   bootstrap spore hint, but discovery + the bundled spore list already cover
   cold start, so this is optional and off by default.

## FFI / boundary changes

The DM's transport selection lives in moss (S1 owns dialing); mosh drives it
through the FFI. Two moss FFI additions consumed here:

- `Moss_DM_EnableRelayFallback(handle, token[16], role)` — arms the fallback for a
  DM node; moss internally runs the S1 dialer when direct fails and presents the
  resulting session to the same read/write path the DM already uses.
- Status surfaced in the existing network-stats struct: `path ∈ {direct,
  relayed}`, `relay_spore` (coarse, for the diagnostics drawer).

Rationale: keep the Rust side thin — it computes `T`, decides *when* to allow
fallback, and reads status; moss owns the mechanics. This mirrors how mosh
already delegates transport to moss and only orchestrates.

## UI / observability

- Diagnostics drawer gains a **Path** row: `direct` / `relayed via spore` and,
  when relayed, that it is E2E-encrypted end to end (the spore sees only
  ciphertext). Reuses the existing `DiagnosticsDrawerSections` rows.
- No user-facing configuration for the common case; an advanced setting may pin
  or add bootstrap spores later (deferred, YAGNI).

## Failure handling

- **Relay unavailable** (no spores reachable) → DM stays in `DISCOVER`, surfaces
  "connecting…"; retries discovery. No worse than today.
- **Relay flaps** → the S1 dialer advances spores; the DM session (Noise) is
  torn down and re-established over the new spore. MLS state survives (it is
  above transport), so message continuity holds; only in-flight frames retransmit.
- **Direct recovers mid-relay** → migrate to direct, close relay session. Never
  keep both (mirror the existing dedup intent, but here the fragile path yields to
  the better one, fixing the current "outbound replaces stable inbound" thrash by
  making *direct* the winner, not the initiator).

## Testing

- Unit (Rust): token derivation matches S1's Go HMAC for shared vectors; role
  assignment is symmetric (A and B agree). Shared test vectors committed to both
  repos.
- Integration (Rust + moss loopback): two DM nodes with the direct path blocked
  connect via an in-process spore and exchange MLS messages; assert `path ==
  relayed`. Then unblock direct and assert migration to `direct`.
- Regression: the CGNAT flap scenario from the overview no longer flaps — with a
  spore present, the pair reaches steady `relayed`; with none, it degrades to
  "connecting", not a join/leave storm.

## Open decisions (resolved)

- **Fallback, not always-on relay** — direct stays preferred; relay is the
  last-resort path. Keeps latency/bandwidth low and preserves per-DM isolation
  for the common case.
- **moss owns dialing, mosh owns policy** — smallest FFI surface, no duplication
  of transport logic in Rust.
- **No new invite secret** — token derives from `mesh_id`; invite format is
  unchanged (backward compatible with existing invites).
