# ADR 0006: Confirmation code as the approval gate

## Status

Accepted

## Context

The org bundle URI is distributed to the whole team and must be assumed
leaked. Any URI holder can publish an `OrgHello` under any display name, so
the admin needs a way to bind a pending join request to a live human.
Per-member secret URIs would kill the single-artifact onboarding goal.
Signed hellos (ADR 0007) stop peer-id spoofing but not an attacker
presenting their own key under a victim's name.

## Decision

The joiner's client displays a confirmation code — the first 12 hex
characters of their moss peer-id — which the joiner relays to the admin over
the pre-existing trusted channel. `mosh-org approve <name> <code>` requires
both arguments; approval succeeds iff exactly one pending hello matches
both. Two pendings sharing a 12-hex prefix cause refusal plus an alert, not
a longer-prefix prompt: an honest 48-bit collision across ~30 people is
negligible, so a match means someone is grinding keypairs.

## Consequences

- 12 hex (48 bits), not 8 (32 bits): a prefix-grinding attacker moves from
  hours on a desktop to GPU-farm-weeks, outside this threat model.
- The gate defends against a leaked URI; it does not defend against an
  attacker controlling the trusted out-of-band channel itself.
- Device replacement reuses the same gate with an explicit `--replace` flag
  (revokes the old peer-id atomically in the same roster version).
- The code is human-relayable (`a1b2-c3d4-e5f6`), keeping onboarding at
  "paste URI, read one code aloud".
