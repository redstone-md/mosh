# Universal Relay (shared relay mesh) — Overview & Decomposition

Date: 2026-07-01
Status: design, pending review
Scope: moss + mosh + MossSpore (3 repos)

## Problem

Two peers both behind symmetric / carrier-grade NAT cannot hold a direct P2P
session. moss relay and peer discovery are keyed on `infohash = sha1(mesh_id)`
(open mesh, `psk` empty), so relay only works *within a single mesh*. Each Mosh
DM runs a separate moss node on a **random secret `mesh_id`** exchanged via the
invite; channels use `mesh_id = channel/<name>`. A private DM is a 2-person mesh
with no third party, so there is **no SuperNode in it to relay through**, and the
pair cannot connect.

Observed: a peer behind Russian CGNAT flaps `peer_joined`/`peer_left` with a new
port each attempt; `Relay: none, 0 routes`. A cone-NAT peer (Czech) works,
because the direct path succeeds.

## Ideology constraint (moss SPEC)

- **G1 True Serverless:** "Zero dedicated bootstrap, STUN, or TURN servers."
  Relay is via **peer-promoted SuperNodes**, not special infrastructure.
- **§3.2 Mesh TURN:** relay is a **mutually-connected SuperNode** inside a mesh;
  already E2E (Noise — SuperNode sees only ciphertext), already token-bucket
  rate-limited, already migrates to a direct connection when NAT improves.

The relay mechanism already exists. The design must **reuse Mesh TURN**, not
invent a parallel relay.

## Chosen approach — shared relay mesh

Keep per-DM secret meshes for the **direct** path (unchanged). Add one
well-known **relay mesh** (`relay_mesh_id = "moss-relay/1"`) that:

- **MossSpore daemons join and get promoted to SuperNode** by the existing
  autonomous promotion (they are ordinary public peers — G1-compliant). More
  spores = more relay capacity, spread across the pool.
- **A hard-NAT client joins as a fallback** when its DM has no direct path. On
  the relay mesh, moss's existing Mesh TURN relays the two DM peers **to each
  other by peer-id** via a mutual SuperNode. The DM's Noise + MLS session rides
  that relayed transport end-to-end; the spore sees only ciphertext.

This scales to hundreds of hard-NAT users on one mesh (bounded gossip degree,
relay load distributed over many SuperNode spores) and adds **no new relay
protocol** — it is the standard SuperNode relay, hosted on a shared mesh.

Why not the alternatives:
- *Spore per DM mesh* — one moss node = one mesh; doesn't scale to many DMs.
- *moss multi-mesh in one node* — large core rewrite.
- *Bespoke rendezvous overlay* — a second relay mechanism; violates G1 and DRY.

## What the relay mesh exposes / hides

- Spore/relay-mesh sees: **peer-ids** that relay through it (who talks to whom)
  and ciphertext sizes/timing. It does **not** see the DM `mesh_id`, message
  content, or MLS identities.
- Metadata is spread across the spore pool (each SuperNode relays only its own
  sessions), Tor-relay-style. Content confidentiality is unchanged (MLS + Noise).

## Decomposition (build in order)

| # | Sub-project | Repo | Depends | One-line |
|---|---|---|---|---|
| **S1** | moss: relay-by-peer-id FFI | `moss` | — | Audit found Mesh TURN by peer-id (`OpenRelaySessionAny`/`RelaySendTo`, E2E via SuperNode) already exists. S1 shrinks to `SeedKnownPeer(peerID, noiseStatic)` + FFI exports (`Moss_SeedKnownPeer`/`Moss_RelaySendTo`/`Moss_SetRelayCallback`). Relay-mesh membership is a second moss node run by mosh, not a core change. |
| **S2** | mosh: dual-path DM transport | `mosh` | S1 | Keep per-DM direct; on NAT failure join the relay mesh and carry the DM session over the relayed connection to the peer's relay-mesh peer-id (from the invite). |
| **S3** | MossSpore: relay-mesh supernode + scale | `MossSpore` | S2 | Run a spore on the relay mesh (it auto-promotes to SuperNode); bundled bootstrap spore list in mosh; mass-deploy docs, health/metrics. Minimal daemon code. |

Each sub-project gets its own `-design.md` → plan → implementation. S2 needs S1;
S3 needs S2. **Start with S1.**

## Cross-cutting decisions

- **Relay mesh id**: versioned constant `moss-relay/1`; bump suffix for a
  flag-day if the join/relay contract changes.
- **Target addressing**: the DM invite already carries the peer's device
  fingerprint (its static public key). The relay-mesh peer-id derives from that
  key, so A can address B on the relay mesh with no new invite field.
- **Trust**: spore/SuperNode is untrusted — Mesh TURN is already E2E. A hostile
  spore can drop/stall/observe coarse metadata, never read or forge. Clients pick
  another SuperNode on failure (existing `selectRelayPeers` returns several).
- **Abuse**: existing per-SuperNode relay rate limits + session TTL + max
  concurrent relays (SPEC §3.2 defaults) apply unchanged.
- **Discovery**: reuse tracker + DHT bootstrap on `sha1(relay_mesh_id)`, seeded
  by a small bundled static spore list so a cold client always reaches the pool
  (data, not a trust anchor — spores are untrusted).
