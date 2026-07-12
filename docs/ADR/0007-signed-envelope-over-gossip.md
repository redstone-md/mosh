# ADR 0007: App-level signed envelope over unauthenticated gossip

## Status

Accepted

## Context

The moss gossip path delivers messages with an unverified sender claim:
`Envelope.SenderID` is set by whoever forwards the message, and Ed25519
verification exists only on the relay path and supernode announcements. The
Rust bridge additionally discards the gossip sender. Every org-control
message the design depends on (hello, offers, KeyPackage delivery, resync)
would otherwise have a spoofable sender, breaking admission (ADR 0004) and
letting revoked members forge offers. Fixing verification inside the moss
submodule touches all consumers and per-message performance; deferring to
"the relay path verifies" would couple correctness to transport selection.

## Decision

All org-channel messages travel in an application-level envelope
`OrgSigned { payload, peer_id, sig }`, signed by the moss node key (whose
public key is the peer-id), over the domain-separated context
`("mosh-org-v1" || org_pubkey || mesh_id || channel_kind || payload)`. The
roster itself is exempt (self-authenticating via org signature + version
anti-rollback). Replay: hellos are idempotent; offers are accept-once by
session/group id.

## Consequences

- Sender authenticity is transport-independent and unit-testable as a pure
  function.
- Domain separation prevents cross-protocol confusion with relay/libp2p
  signatures; the org/mesh context in the signed bytes kills cross-org
  replay.
- Requires node-key signing from Rust; if the persisted `moss_identity`
  blob format makes that awkward, fallback is a small `Moss_Sign` FFI
  addition in moss.
- Transport-level gossip verification in moss remains the v2
  defense-in-depth; this envelope stays as belt-and-suspenders if that
  lands.
