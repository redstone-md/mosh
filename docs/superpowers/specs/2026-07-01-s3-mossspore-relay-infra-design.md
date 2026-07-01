# S3 — MossSpore relay infrastructure

Date: 2026-07-01
Status: design, pending review
Repo: `MossSpore` (Go daemon) + a small `mosh` bootstrap-list change. Depends on **S2**.
Parent: [universal-relay-overview](2026-07-01-universal-relay-overview.md)

## Purpose

Turn MossSpore into a **mass-deployable rendezvous relay**: run one command,
join the overlay, serve the S1 rendezvous service. Hundreds/thousands of these
form the volunteer relay pool that S2 clients fall back to. Little new code in
the daemon itself — most work is discovery bootstrap, packaging, and docs so the
pool is easy to grow and easy for clients to find.

## Daemon changes (small)

MossSpore already wraps a moss node with `relay.enabled` and a monitor endpoint.
S3 adds:

1. **Overlay mode.** A `relay_overlay` config block (default **on**) makes the
   spore join `overlay_id = "moss-relay-overlay/1"` and start the S1
   `RendezvousService`. When on, the spore's own `mesh_id` is the overlay id; it
   does not need a per-conversation mesh. Existing per-mesh relay behaviour stays
   available for operators who want a dedicated single-mesh spore.
2. **Persistent identity by default for public spores.** Warn (already
   documented) and default `identity_path` under the state dir so a spore keeps a
   stable overlay id across restarts (needed for rendezvous-hash stability — a
   spore that changes id churns the ranked lists).
3. **Monitor additions.** `/info` gains `rendezvous_sessions`, `paired_total`,
   `unpaired_expired_total`, `overlay_peer_count`; `/health` unchanged. Feeds
   pool dashboards.

## Client bootstrap (small `mosh` change)

A cold client must reach the pool before discovery warms up. Ship a **bundled
static spore list** in mosh (a short list of well-known community spores, e.g.
the maintainer-run ones) used only to seed overlay discovery; the live set is
then learned from the overlay swarm. The list is data, not trust — spores are
untrusted (S1), so a stale/hostile entry only wastes one dial. Updatable via
normal app releases.

## Deployment & scale

- **One-line install** (existing `install.sh`): detect OS/arch, drop the binary,
  write a default overlay-mode config, offer a systemd unit. Extend to set
  `relay_overlay.enabled = true` and a persistent identity path.
- **Container**: existing Dockerfile; expose the peer port (UDP+TCP) and `:9800`
  monitor. Document firewall/security-group: the peer port must be inbound-open,
  or the spore is not a useful relay (it must be publicly reachable — same
  requirement as any supernode).
- **Fly.io / VPS**: a `fly.toml` and a short "run a spore in 2 minutes" guide.
- **Auto-update** (existing `internal/update`): keep default off; documented for
  operators who want hands-off fleets.

## Reachability requirement (explicit)

A spore is only useful if inbound-reachable on its peer port (public IP or a real
port-forward / cloud host). Behind CGNAT with no forward it cannot serve
rendezvous. The install guide states this up front and the monitor `/health`
`nat_type` lets an operator verify (`public` / `port_restricted_cone` good;
`symmetric` / `cgnat` not a viable public spore).

## Abuse & operations

- Rate limits from existing `relay.*` config apply to rendezvous sessions
  (`max_sessions`, `max_bandwidth_kbps`, `session_ttl_sec`) plus a short
  unpaired-attachment TTL (S1).
- The spore never sees plaintext, mesh ids, or stable peer identities, so an
  operator hosts relay capacity without hosting user content or metadata beyond
  coarse timing — lowers the legal/operational burden of volunteering.
- Structured JSON event log (existing) gains rendezvous pair/expire events for
  ops visibility, carrying only the blinded token prefix, never payloads.

## Testing

- Daemon: overlay-mode boot serves the S1 service (reuse S1 service tests via the
  daemon wiring); `/info` counters increment on a paired session; identity
  persists across restart (stable overlay id).
- Discovery: a fresh client with only the bundled static list discovers a live
  spore and completes a rendezvous (integration with S1/S2 loopback).
- Install: `install.sh` dry-run on Linux/macOS produces a valid overlay-mode
  config and a spore that answers `/health`.

## Open decisions (resolved)

- **Overlay mode default-on** — the whole point is a universal pool; single-mesh
  spores remain possible but are the exception.
- **Bundled spore list is seed, not trust anchor** — untrusted by S1, so shipping
  a list has no security weight; it only bootstraps discovery.
- **Daemon stays thin** — S1 owns the relay mechanics; S3 is overlay wiring +
  packaging + docs, matching MossSpore's "zero-config headless" identity.
