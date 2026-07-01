# S3 — MossSpore relay-mesh infrastructure

Date: 2026-07-01
Status: design, pending review
Repo: `MossSpore` (Go daemon) + a small `mosh` bootstrap-list change. Depends on **S2**.
Parent: [universal-relay-overview](2026-07-01-universal-relay-overview.md)

## Purpose

Turn MossSpore into a **mass-deployable SuperNode on the relay mesh**: run one
command, join `moss-relay/1`, get auto-promoted to SuperNode, relay hard-NAT DMs
via the standard Mesh TURN. Hundreds/thousands form the volunteer relay pool S2
falls back to. The daemon barely changes — a spore is already "a public peer that
volunteers as relay"; S3 points it at the relay mesh and packages it for scale.

## Daemon changes (small)

MossSpore already wraps a moss node with `relay.enabled` and a monitor endpoint.
S3 adds:

1. **Relay-mesh mode (default on).** A `relay_mesh` config block sets the spore's
   `mesh_id = "moss-relay/1"`; the existing `relay.enabled` + autonomous SuperNode
   promotion do the rest. Single-mesh operation (a dedicated spore for one mesh)
   stays available for operators who want it.
2. **Persistent identity by default.** Default `identity_path` under the state dir
   so a spore keeps a stable peer-id / SuperNode identity across restarts.
3. **Monitor additions.** `/info` gains `relay_sessions`, `relay_routes`,
   `supernode_ready`, `relay_bytes_total`; `/health` unchanged. Feeds pool
   dashboards.

## Client bootstrap (small `mosh` change)

A cold client must reach the relay mesh before discovery warms up. Ship a bundled
**static spore list** in mosh (a few well-known community spores) to seed
`sha1(moss-relay/1)` discovery; the live SuperNode set is then learned from the
mesh. The list is data, not trust — SuperNodes are untrusted (relay is E2E), so a
stale/hostile entry only wastes one dial. Updatable via app releases.

## Deployment & scale

- **One-line install** (existing `install.sh`): detect OS/arch, drop the binary,
  write a relay-mesh-mode config, offer a systemd unit; set persistent identity.
- **Container**: existing Dockerfile; expose the peer port (UDP+TCP) + `:9800`.
  Document that the peer port must be inbound-open (public IP or forward) — a
  spore behind CGNAT cannot be a SuperNode.
- **Fly.io / VPS**: a `fly.toml` + a "run a spore in 2 minutes" guide.
- **Auto-update** (existing `internal/update`): default off; documented for
  hands-off fleets.

## Reachability requirement (explicit)

A spore is useful only if inbound-reachable on its peer port (public IP or real
forward / cloud host). The monitor `/health` `nat_type` lets operators verify
(`public` / cone good; `symmetric` / `cgnat` not a viable SuperNode). Same
requirement any SuperNode already has.

## Abuse & operations

- Existing SuperNode relay limits apply unchanged (per-relay token bucket, session
  TTL, max concurrent relays — SPEC §3.2 defaults).
- The spore never sees plaintext, DM `mesh_id`, or MLS identities — only relay
  peer-ids and coarse timing. Lower legal/operational burden for volunteers.
- Structured JSON event log (existing) gains relay open/close events carrying only
  peer-id prefixes, never payloads.

## Testing

- Daemon: relay-mesh-mode boot joins `moss-relay/1`, auto-promotes with a public
  test NAT, `/info` counters increment on a relayed session; identity persists
  across restart (stable peer-id).
- Discovery: a fresh client with only the bundled list finds a live SuperNode and
  completes a relayed DM (integration with S1/S2 loopback).
- Install: `install.sh` dry-run on Linux/macOS yields a valid relay-mesh config
  and a spore that answers `/health`.

## Open decisions (resolved)

- **Relay-mesh mode default-on** — the point is a shared pool; single-mesh spores
  remain the exception.
- **Bundled spore list is seed, not trust anchor** — untrusted relay, so no
  security weight; it only bootstraps discovery.
- **Daemon stays thin** — S1/moss owns relay mechanics; S3 is relay-mesh wiring +
  packaging + docs, matching MossSpore's "zero-config headless" identity.
