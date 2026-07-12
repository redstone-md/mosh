# Ubiquitous Language

Glossary of domain terms. Definitions only — no implementation details.

## Organization (org)

A signed membership document (roster), not a server or infrastructure. An
org's identity **is** its root public key.

## Org root key

Ed25519 keypair held exclusively by the org admin's tooling. Signs rosters.
Its public half is the org's identity and trust anchor.

## Roster

The canonical, versioned, org-root-signed document listing current members.
Membership in the org is defined as presence in the latest verified roster —
nothing else grants or preserves membership.

## Member

A person in an org, identified by their **moss peer-id**. In any org context
the peer-id is the sole durable identity anchor, at every layer including
the crypto layer.

## Moss peer-id

Stable per-installation identity from the moss node, persisted across
restarts. Durable. Sender authenticity against it is proven by the org
signed envelope — the gossip transport itself does not authenticate
senders; only the relay path pins it.

## MLS fingerprint

Derived from a per-conversation MLS signature key. Ephemeral relative to a
person: differs per conversation, not usable as a durable member identifier.
Contrast: [[moss peer-id]].

## Org admin

A member whose roster entry carries `role: admin`. In org groups, authority
to change group membership derives from this roster role. Distinct concept
from [[Group admin]].

## Confirmation code

The first 12 hex characters of a joining member's [[moss peer-id]], shown to
them at join time and relayed to the org admin out-of-band. Proof that a
pending join request belongs to a known person. Approval is impossible
without it. (Not a "short hash for disambiguation" — that meaning is dead.)

## Org group

A private group bound to an [[organization]] at creation (the binding is the
org's identity). The binding — not membership overlap — is what makes a
group "organizational": it activates roster-derived authority and
revocation enforcement. A group without a binding is a plain private group;
no org ever touches it. Org groups are created deliberately by members
(ad-hoc); the org does not auto-create or auto-populate groups.

## Group admin

The single per-group authority in **non-org** private groups, tracked by MLS
fingerprint and transferred by handoff. Does not exist in org groups — org
groups derive authority from the roster instead.
