# ADR 0004: Org credential identity is the moss peer-id

## Status

Accepted

## Context

Revocation must map a roster entry (a moss peer-id) to an MLS leaf. Today a
leaf's `BasicCredential` identity is a display-name string, and the MLS
fingerprint derives from a per-conversation signature key — neither is a
durable member identifier. An app-level `(group, fingerprint) → peer_id`
mapping table would be new synchronized state, the same desync bug class the
resync work exists to fix.

## Decision

In org contexts (org groups and org-bootstrapped DMs), set the MLS
`BasicCredential` identity to the member's moss peer-id. Admission enforces
the binding cryptographically: an admin accepts a KeyPackage iff the
credential identity equals the signed-envelope peer-id (ADR 0007) and that
peer-id is in the roster. Removal scans leaves by credential identity and
removes all matches; add-time dedups a stale leaf via a single Remove+Add
multi-proposal commit. Display names move entirely to app frames (where they
are already learned from). Non-org sessions are untouched.

## Consequences

- Leaf → peer-id is readable directly from the tree; zero new synced state.
- Self-claimed credentials are neutralized at the only trust point
  (admission); after that, MLS tree agreement carries the binding.
- Duplicate leaves (rejoin fallback) are legal and handled by
  remove-all-matches.
- Unifying non-org sessions on peer-id credentials is a separate later
  decision.
