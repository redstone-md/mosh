# Universal Relay (MossSpore overlay) — Overview & Decomposition

Date: 2026-07-01
Status: design, pending review
Scope: moss + mosh + MossSpore (3 repos)

## Problem

Two peers both behind symmetric / carrier-grade NAT cannot hold a direct P2P
session. moss relay and peer discovery are keyed on `infohash = sha1(mesh_id)`
(open mesh, `psk` empty), so relay only works *within a single mesh*. Each Mosh
DM runs a separate moss node on a **random secret `mesh_id`** exchanged via the
invite; channels use `mesh_id = channel/<name>`. Consequently a public relay
cannot serve arbitrary private DMs without joining each DM's secret mesh — which
would leak the mesh id and does not scale.

Observed in production: a peer behind Russian CGNAT flaps `peer_joined` /
`peer_left` with a new source port every attempt, because no stable NAT path
exists and there is no relay in the mesh (`Relay: none, 0 routes`). A peer with
an open/cone NAT (Czech) works, because the direct path succeeds.

## Goal

A **volunteer relay pool**: anyone can run hundreds/thousands of MossSpore
daemons that collectively relay hard-NAT DMs — infrastructure like supernodes,
but dedicated. One spore must be usable by any DM **without learning the DM's
`mesh_id`** and **without seeing plaintext** (E2E stays MLS + Noise).

## Chosen approach — C2: rendezvous-relay overlay (fallback)

Per-DM secret meshes stay for the **direct** path (private discovery +
hole-punch; unchanged for the common case). When the direct path fails, the DM
transport falls back to a **rendezvous relay**:

- Spores announce themselves on a single well-known **overlay swarm**
  (`infohash = sha1(overlay_id)`), so any client can discover the live spore set.
- Both peers of a DM independently derive the **same blinded rendezvous token**
  `T = HMAC(mesh_id, "moss-rendezvous" || epoch)` from the DM secret they already
  share (`mesh_id`). The spore never sees `mesh_id`, only `T`.
- Both peers deterministically pick the **same spore(s)** by rendezvous-hashing
  `T` over the discovered spore set, attach with `T`, and the spore **pairs the
  two attachments that present equal `T`** and pipes opaque frames between them.
- The DM's Noise + MLS session runs **end-to-end over the pipe**. The spore is
  untrusted: it sees two IP endpoints, a blinded token, and ciphertext. Nothing
  else. MITM is impossible (Noise with the static keys already in the invite).

Why this over C1 (one shared mesh, topic isolation): C2 keeps per-DM network
isolation for direct connections, exposes no global topic/peer graph, and the
relay is a **dumb rendezvous** — so mass-deploying spores spreads metadata across
the pool (each spore sees only the pairs that hash to it), Tor-relay-style.

## Decomposition (build in order)

| # | Sub-project | Repo | Depends on | One-line |
|---|---|---|---|---|
| **S1** | moss rendezvous-relay primitive | `moss` | — | Blinded-token rendezvous relay service + overlay discovery + client attach/pipe with Noise E2E. The load-bearing core. |
| **S2** | mosh dual-path DM transport | `mosh` | S1 | Derive `T` from the DM secret, run a persistent overlay attachment, fall back from direct to rendezvous, carry the DM session over whichever path connects. |
| **S3** | MossSpore relay infra | `MossSpore` | S2 | Spore runs the S1 service on the overlay; bundled bootstrap spore list in mosh; install/systemd, health/metrics, mass-deploy docs. |

Each sub-project gets its own `-design.md` spec (this dir) → implementation plan
→ implementation. S2 cannot be exercised without S1; S3 has no consumer without
S2. **Start with S1.**

## Cross-cutting decisions

- **Overlay id**: a single hard-coded constant, versioned (`moss-relay-overlay/1`).
  Bumping the suffix is a clean flag-day if the rendezvous wire format changes.
- **Token rotation**: `epoch = floor(unixtime / 3600)`. Peers try the current and
  previous epoch to survive clock skew and hour boundaries.
- **Trust**: spore is fully untrusted. All confidentiality/integrity is E2E. A
  malicious spore can drop/observe-timing/refuse — never read or forge. Clients
  try multiple spores on failure.
- **Abuse**: rendezvous sessions are rate-limited and TTL'd by the spore
  (MossSpore already exposes `relay.max_sessions`, `max_bandwidth_kbps`,
  `session_ttl_sec`). Unpaired attachments expire fast.
- **No new dependency on trackers for the overlay**: overlay discovery reuses the
  existing tracker + DHT bootstrap on the overlay infohash, plus a small bundled
  static spore list so a cold client can always reach the pool.
