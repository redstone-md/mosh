# S1 — moss rendezvous-relay primitive

Date: 2026-07-01
Status: design, pending review
Repo: `moss` (Go core). Consumed by S2 (mosh) and S3 (MossSpore).
Parent: [universal-relay-overview](2026-07-01-universal-relay-overview.md)

## Purpose

Give moss a **blinded-token rendezvous relay**: a relay-capable node lets two
peers that share a secret token meet and exchange opaque frames, without the
relay learning who they are, what mesh they belong to, or what they say. This is
the transport substrate for hard-NAT DMs. Everything confidential rides E2E
(Noise + MLS) *over* the pipe; the relay is untrusted plumbing.

Non-goals: no changes to the existing intra-mesh direct/relay path; no plaintext
access; no cross-spore federation (single rendezvous spore per session — see
Failure & selection for multi-spore fallback).

## Vocabulary

- **Overlay** — one well-known mesh (`overlay_id = "moss-relay-overlay/1"`) that
  every spore joins and every relay-seeking client can discover. Its only job is
  to make the spore set findable (`infohash = sha1(overlay_id)`).
- **Spore** — a node running the rendezvous-relay service, discoverable on the
  overlay.
- **Rendezvous token `T`** — `HMAC-SHA256(key = mesh_id_bytes, msg = "moss-rendezvous" || epoch)`,
  truncated to 16 bytes, hex. `epoch = floor(unixtime/3600)`. Both DM peers know
  `mesh_id`, so both derive equal `T`. The spore only ever sees `T`.
- **Attachment** — a client's transport connection to a spore carrying an
  `ATTACH(T, role)` request, where `role ∈ {A, B}` is decided by
  `local_pubkey < remote_pubkey` (deterministic, avoids two A's).

## Architecture

Three new units in `internal/mesh` (+ one in `internal/nat` for selection math),
each with one job:

1. **`rendezvous_service.go` (spore side)** — accepts `ATTACH`, holds at most one
   unpaired attachment per `(T, role)` with a short TTL, pairs opposite roles on
   equal `T`, then splices the two sessions frame-for-frame until either closes
   or the session TTL fires. Enforces caps (`max_sessions`, per-session
   `max_bandwidth_kbps`, `session_ttl_sec`). Never parses payloads.

2. **`rendezvous_client.go` (dialer side)** — given `T` and the discovered spore
   set, computes the ranked spore list (unit 4), attaches to the top spore,
   waits for `PAIRED`, and returns a `net.Conn`-like piped stream. On failure or
   timeout, advances to the next spore.

3. **`overlay.go` (discovery)** — a thin wrapper that runs/queries a node on
   `overlay_id` to enumerate live spores (tracker + DHT bootstrap on the overlay
   infohash, seeded by a static spore list passed in config). Exposes
   `Spores() []SporeAddr` refreshed on the normal announce interval.

4. **`internal/nat/rendezvous_select.go`** — pure function
   `RankSpores(T, spores) []SporeAddr` using rendezvous (highest-random-weight)
   hashing: sort by `sha256(T || spore_id)` descending. Deterministic, so both
   peers pick the same order without communicating. Unit-testable in isolation.

The spore is just a moss node with `rendezvous_service` enabled and `relay`
capability; MossSpore (S3) wires it. A client that only needs relay runs the
`rendezvous_client` + `overlay` discovery — it does **not** join overlay gossip
(it is a leaf that dials spores), so the overlay does not carry a giant mesh.

## Wire protocol (over an established Noise session to the spore)

The client first completes the ordinary moss transport handshake **to the spore**
on `overlay_id` (so spore-link traffic is also obfuscated/authenticated at the
transport layer). Then, as the first application frames:

```
ATTACH  { t: <16-byte hex>, role: "A"|"B", ttl_ms: <=30000 }
      → PAIRED { }                 // second matching attach arrived
      → BUSY    { retry_after_ms } // a live session already holds this (T,role)
      → EXPIRED { }                // ttl elapsed with no partner
After PAIRED: raw opaque frames are spliced 1:1 to the partner until close.
```

The **inner** Noise + MLS handshake between A and B runs as opaque frames after
`PAIRED`; the spore relays them blindly. The spore authenticates nothing about A
or B beyond "presented a valid overlay transport handshake + a token".

## Data flow (hard-NAT DM, happy path)

```
A (CGNAT)                     Spore S (public)                    B (CGNAT)
  |-- overlay handshake ---------->|<--------- overlay handshake --|
  |-- ATTACH(T, role=A) ---------->|<--------- ATTACH(T, role=B) --|
  |<-------------- PAIRED ---------|--------- PAIRED ------------->|
  |==== Noise(A,B) over spliced opaque frames (S sees ciphertext) ====|
  |==== MLS DM messages E2E =========================================|
```

Both A and B chose S because `RankSpores(T, …)[0] == S`. If A's top pick differs
from B's (transient spore-set skew), they retry down the shared ranked list until
they land on a common spore within the attach TTL window.

## Failure & selection

- **Spore down / unreachable** → client advances to `RankSpores(T,…)[i+1]`.
  Both peers use the same ranked list, so they re-converge.
- **Set skew** (A and B see slightly different live sets) → the ranked lists
  still share a long common prefix; the attach TTL (≤30 s) plus retry over the
  prefix makes them meet. Selection considers only spores present in *both*
  bootstrap-static and freshly-discovered sets first (stable core), then extras.
- **Epoch boundary / clock skew** → derive `T` for `epoch` and `epoch-1`; attach
  attempts cover both; the spore keys sessions on the exact `T` bytes so there is
  no cross-talk.
- **Malicious spore** → can only drop, stall, or observe timing + coarse
  metadata (two IPs, one blinded token, ciphertext sizes). Cannot read, forge, or
  link across DMs (token rotates hourly, is per-`mesh_id`). Client falls back to
  the next spore on stall.
- **Abuse / DoS** → per-spore `max_sessions`, per-session bandwidth cap, session
  TTL, unpaired-attachment TTL; an `ATTACH` for a `(T,role)` already paired gets
  `BUSY`.

## Interfaces (Go, sketch)

```go
// spore side
type RendezvousService struct{ /* caps, session table */ }
func (s *RendezvousService) Serve(sess *transport.Session) error // handles ATTACH→splice

// dialer side
type RendezvousDialer struct{ overlay *Overlay; caps DialCaps }
func (d *RendezvousDialer) Dial(ctx context.Context, token [16]byte, role Role) (net.Conn, error)

// discovery
type Overlay struct{ /* node on overlay_id */ }
func (o *Overlay) Spores() []SporeAddr

// pure selection (internal/nat)
func RankSpores(token [16]byte, spores []SporeAddr) []SporeAddr
```

`Dial` returns a `net.Conn`; S2 layers the DM's existing Noise+MLS session on top
exactly as it would over a direct `net.Conn`, so the DM stack is transport-agnostic.

## Testing

- `RankSpores` — determinism (same input → same order), even distribution,
  stability when one spore leaves (only its slots redistribute). Table test, no I/O.
- `RendezvousService` — two in-process attachments with equal `T` opposite roles
  get spliced and bytes flow both ways; equal role → second gets `BUSY`;
  unpaired → `EXPIRED` after TTL; caps enforced. Loopback sessions.
- `RendezvousDialer` — with a fake overlay of N in-process spores, two dialers
  with the same token meet on the same spore; killing the top spore re-converges
  them on the next. Loopback.
- End-to-end (mesh package): two nodes with no direct path (loopback firewall
  sim) complete a Noise handshake through a third spore node. Asserts the spore
  never observes plaintext (it only ever sees ciphertext frames).

## Open decisions (resolved)

- **Token = HMAC(mesh_id)**, not a new shared secret — mesh_id is already a shared
  random secret both peers hold; reusing it avoids new key exchange. The spore
  never receives mesh_id, only the HMAC, so this does not weaken mesh secrecy.
- **Single rendezvous spore per session** (no A→S1→S2→B federation) — simpler,
  and rendezvous hashing makes both peers pick the same spore deterministically,
  so federation is unnecessary. Multi-spore is only a *sequential* fallback.
- **Clients are overlay leaves, not gossip members** — keeps the overlay from
  becoming an unbounded mesh; spores gossip among themselves only for their own
  liveness/discovery, not client fan-out.
