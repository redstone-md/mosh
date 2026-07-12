# ADR 0005: Roster-derived commit authority in org groups

## Status

Accepted

## Context

Private groups accept commits only from a pinned `current_admin_fingerprint`,
transferred via `AdminHandoff` on graceful leave. In an org group this
deadlocks revocation of the group admin themselves: nobody else may commit
the Remove, and a hostile or offline admin never hands off. Serverless
operation rules out any external arbiter.

## Decision

Org groups abandon the single group-admin mechanism entirely. A commit is
valid iff its author's peer-id (from the leaf credential, ADR 0004) carries
`role: admin` in the verifier's current verified roster. Commits carry the
author's roster version; a commit from an unknown admin with a newer roster
version is buffered pending roster arrival (shared machinery with epoch
resync buffering). Creating an org group requires ≥1 admin in the initial
set (UI-enforced, soft).

## Consequences

- Revoking any member, including a group's only acting admin, is always
  possible while at least one other org admin exists.
- Concurrent commits from two live admins can fork the MLS tree (gossip has
  no total order). Accepted for v1: rare, and self-heals via
  rejoin-via-roster when a dead branch hits decrypt failures. Deterministic
  tie-break is the v2 upgrade.
- A group whose last in-group admin is revoked becomes crypto-unmanageable;
  backstop is re-creating the group from the roster (one action).
- `AdminHandoff` remains for non-org groups only.
