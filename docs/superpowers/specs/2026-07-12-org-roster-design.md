# Organization Roster — Design

Date: 2026-07-12
Status: reviewed (grilled Q1–Q8), accepted for planning
Glossary: see `CONTEXT.md` (ubiquitous language). ADRs 0004–0008 record the
five load-bearing decisions made during review.

## Goal

Let a team of 5–30 people onboard into Mosh with a single artifact and let an
org admin revoke a member's access with one action. Today onboarding is
pairwise invite URIs and revocation does not exist. This is the feature gap
between "hobby messenger" and "deployable for a team".

An **organization** is a signed membership document (roster), not a server.
No new infrastructure is introduced; the zero-server property is preserved.

## Non-goals (v1)

- Per-member identity key chains (org cert → member key → MLS credential).
  v1 pins the stable moss peer-id per member (ADR 0004); the key chain is the
  v2 upgrade if peer-id pinning proves insufficient.
- Org root key rotation / successor keys. Loss or compromise is recovered by
  org re-creation (runbook), not in-band (see Trust model). The
  forward-compat parsing rule below keeps the v2 door open.
- Transport-level sender verification in moss gossip. v1 authenticates at
  the application layer (ADR 0007); fixing gossip verify in the moss
  submodule is a v2 defense-in-depth item.
- Auto-membership of the whole roster in any group (ADR 0008).
- Deterministic tie-break for concurrent MLS commits. v1 relies on rarity +
  self-healing (see Commit authority).
- Commit-log pruning. v1 stores membership commits forever: commits are
  small membership events (not messages) — tens per year, years of operation
  under a megabyte. Pruning is code + tests + edge cases to save pennies.
- Admin GUI. v1 admin tooling is a CLI in a separate private repository;
  this repo only contains the verification/consumption side.
- Mobile clients, multi-device per member.
- Roster-driven policy beyond membership (retention, export) — later.

## Trust model

- **Org root key**: Ed25519 keypair generated and held exclusively by the
  admin CLI. The private key never enters this codebase. The org's identity
  *is* this public key.
- **Roster**: canonical JSON document signed by the org root key:

  ```json
  {
    "org_pubkey": "<32-byte ed25519 pubkey, 64hex>",
    "org_name": "acme",
    "version": 7,
    "members": [
      { "moss_peer_id": "<64hex>", "name": "alice", "role": "admin" },
      { "moss_peer_id": "<64hex>", "name": "bob",   "role": "member" }
    ],
    "sig": "<ed25519 signature over canonical bytes sans sig>"
  }
  ```

- Clients accept a roster iff the signature verifies against `org_pubkey`
  AND `version` is strictly greater than the stored one (anti-rollback).
- **Forward-compat parsing rule**: the signature covers the canonical bytes
  of the whole document (unknown fields included); semantically, unknown
  fields are ignored. A v1 client that meets a v2 field (e.g. a future
  `successor_org_pubkey`) verifies and keeps working.
- Member identity anchor is the **moss peer-id**: stable across restarts
  (persisted `moss_identity`, `persistence.rs`). MLS fingerprints are
  per-conversation and therefore not usable as durable identifiers.
- Sender authenticity on org channels comes from the **org signed envelope**
  (below), not from the transport: the moss gossip path does not verify
  `SenderID` (only the relay path pins it).
- Today, invite-URI possession is the only gate on DMs; the displayed
  fingerprint is informational. The signed roster is therefore the first
  cryptographic membership gate in the app, not a replacement for an
  existing one.
- **Key loss / compromise**: unrecoverable in-band. A compromised root key
  means the attacker owns the org until the team migrates to a new bundle.
  Recovery = org re-creation: new keypair → new bundle URI → re-onboard
  (30 people ≈ half an hour). Documented as a runbook, not a mechanism.
- **Boundary**: the confirmation-code gate (below) defends against a leaked
  bundle URI. It does not defend against an attacker who controls the
  trusted out-of-band channel itself (they would intercept URI, code, and
  the admin's conversation alike) — that is outside this layer.

## Org signed envelope (ADR 0007)

The moss gossip path delivers messages with an unauthenticated sender claim.
Everything on org channels therefore travels in an application-level signed
envelope; no new keys — the moss node key signs, and its public key *is* the
peer-id:

- `OrgSigned { payload, peer_id, sig }` where `sig` is Ed25519 over
  `("mosh-org-v1" || org_pubkey || mesh_id || channel_kind || payload)`.
- Domain separation: the context prefix prevents cross-protocol confusion
  with relay signing / libp2p traffic; including `org_pubkey`/`mesh_id`
  kills cross-org replay (an offer replayed into another org's mesh does
  not verify).
- Enveloped: `OrgHello`, `OrgDmOffer`, `OrgGroupOffer`, KeyPackage delivery,
  `ResyncRequest`/`ResyncResponse` on org paths. NOT enveloped: the roster
  itself (self-authenticating: org signature + version anti-rollback).
- Replay handling: `OrgHello` is idempotent; `OrgDmOffer`/`OrgGroupOffer`
  are accept-once by `session_id`/`group_id`. No timestamps.
- Implementation note: requires the node private key on the Rust side
  (`moss_identity` blob). If the blob format (libp2p protobuf vs raw seed)
  makes that awkward, fallback is a small `Moss_Sign(data)` FFI addition in
  the moss submodule.

## Leaf ↔ peer-id binding (ADR 0004)

In org contexts (org groups and org-bootstrapped DMs), the MLS
`BasicCredential` identity is the member's **moss peer-id**, not a display
name. Display names cost nothing to move: they are already learned from the
first inbound app frame, and credential identity is not consumed for display.

- **Admission rule** (the only trust point): an admin accepts a KeyPackage
  iff `credential.identity == envelope.peer_id` (envelope proves possession
  of that peer-id's private key) AND `peer_id ∈ roster.members`. Mismatch →
  drop, warn. After admission the leaf is verified by construction; members
  trust admin commits and MLS guarantees tree agreement.
- **Removal**: `remove_member_by_peer_id(peer_id)` scans leaves by
  `credential.identity` and removes ALL matching leaves (duplicates are
  legal: rejoin fallback creates a fresh KeyPackage while a stale leaf may
  survive).
- **Dedup at add-time**: if a leaf with the same peer-id already exists, the
  admin removes the stale leaf and adds the new one in a single
  multi-proposal commit (Remove+Add).
- Existing non-org DMs/groups are untouched — no migration, no compat risk.
  Unifying everything on peer-id credentials is a separate later decision.

## Commit authority in org groups (ADR 0005)

Non-org private groups keep their current single group-admin
(`current_admin_fingerprint` + `AdminHandoff`). Org groups do NOT use that
mechanism at all — it deadlocks revocation of the group admin themselves.

- A commit in an org group is valid iff its author's peer-id (from the leaf
  credential, per ADR 0004) has `role: admin` in the verifier's current
  verified roster.
- **Roster-lag buffer**: commits carry the author's `roster_version`. If the
  author is not an admin in my roster AND their `roster_version` is greater
  than mine → buffer the commit and request the roster; re-validate on
  arrival. Same buffering machinery as epoch out-of-order resync, second
  trigger.
- **Concurrent commits can fork the tree** (gossip has no total order; two
  members may see different "first" commits for the same epoch). v1 accepts
  this: admins are few (1–2), membership commits are rare, and the fork
  self-heals — members on a dead branch hit systematic decrypt failures and
  take the rejoin-via-roster fallback. A deterministic tie-break is v2 if
  practice demands it.
- **≥1 admin rule**: creating an org group requires at least one
  `role: admin` member in the initial set (UI-enforced, runtime warns). A
  hard invariant is impossible — revoking a group's last admin is legal at
  the roster layer. Backstop: any remaining member re-creates the group from
  the roster (roster DM/group bootstrap makes this one action) and the old
  group is abandoned.

## Components

### 1. Roster core (Rust, `src-tauri/src/adapters/org_roster.rs`)

Parse, canonicalize, verify, and diff rosters. Pure logic, no I/O.

- `verify(roster_bytes, expected_org_pubkey) -> Roster` — signature +
  version checks, forward-compat field handling.
- `diff(old, new) -> {added, removed}` — drives join/revoke actions. Role
  changes emit no event: authority checks (ADR 0005) read the live roster,
  and the UI re-reads the whole roster on any update (30 rows; diff events
  for UI are pointless).
- Canonical form (frozen contract with the admin CLI, NOT RFC 8785 JCS):
  serde_json compact output with object keys byte-sorted (`preserve_order`
  disabled), integers only — no floats. Signature covers the canonical
  bytes with `sig` removed. Frozen by a test vector in `org_roster.rs`.
  Duplicate `moss_peer_id` entries are rejected at verification.

### 2. Envelope core (Rust, alongside roster core)

Pure sign/verify for `OrgSigned` with the domain-separated context above.
No I/O; unit-testable without a mesh.

### 3. Org runtime (Rust, `src-tauri/src/adapters/org_runtime.rs`)

One moss node per org (same lifecycle pattern as `channel_runtime.rs`).
Multiple orgs per client are supported in v1 — the persistence and runtime
are per-org already; forbidding multi-org would be extra code.

- Org bundle URI: `mosh://org?mesh=<org_mesh_id>&name=<label>#org=<org_pubkey_64hex>`.
  The fragment carries the trust anchor; `mesh` is routing, same split as DM
  invites.
- Join flow (new member): join org mesh (existing infohash discovery from
  `mesh_id`), publish enveloped `OrgHello { moss_peer_id, display_name }` on
  `org-control/<org_mesh_id>`, re-published on the DM key-package resend
  cadence until a roster that includes the member arrives.
- Roster distribution: latest roster is broadcast on `org-control/...` by
  any member that holds it (gossip; highest valid version wins), and offered
  to newly seen peers. The admin CLI injects new roster versions via its own
  moss node joined to the same mesh.
- On roster update: emits `member_added` / `member_removed` events to UI and
  other runtimes; UI re-reads the full roster.

### 4. DM bootstrap from roster

Clicking a roster member opens/creates a DM without an invite URI: generate
`mesh_id`/`session_id` locally, send a directed, enveloped
`OrgDmOffer { target_peer_id, mesh_id, session_id }` over org-control; both
sides enter the existing `create_invite`/`accept_invite` machinery. The
offer is accepted only if the sender's (envelope-verified) peer-id is in
the current roster of *that* org.

**A DM does not belong to an org.** Org bootstrap is a way to create a DM
without a URI; afterwards the DM is an ordinary standalone session between
two peer-ids. Revocation never deletes or blocks a DM (see Revocation).

### 5. Org groups (ADR 0008)

Org groups are **ad-hoc**: created deliberately by members from the roster,
exactly like private groups today. The org does not auto-create or
auto-populate. A default `#general` is simply the first ad-hoc group the
admin creates at org setup — no special mechanics.

- **Org binding**: a group is "organizational" because it carries
  `org_pubkey` in its metadata — persisted with the group record and
  conveyed at join (the `OrgGroupOffer` travels enveloped over org-control,
  and only roster members receive offers). The binding activates
  roster-derived authority and revocation enforcement. A group without a
  binding is a plain private group; no org ever touches it.
- **Adding members is manual, one-click, batched**: the admin client shows
  "roster has +2 not in group G — add?" and commits a single multi-proposal
  commit (N × Add). Group composition is a social decision; human speed also
  serializes concurrent admins.
- **Kicking is automatic**: on `member_removed`, the first online
  `role: admin` client commits the Remove without user interaction —
  revocation leaves no room for judgment and waiting for a click widens the
  reading window.

### 6. Revocation

Two layers, driven by `diff().removed`:

- **Policy (instant on roster receipt)**: every client removes X from the
  org's roster UI, refuses new enveloped offers from X, and stops relaying
  org traffic to X. Existing DMs with X are **unlinked from the org, not
  deleted**: the conversation persists in the general chat list with a
  "no longer in <org>" badge — ending it is the human's decision. Killing
  DMs would be false security: X keeps local history and any pre-existing
  direct channel regardless.
- **Crypto (at first online admin client)**: `remove_member_by_peer_id` in
  every org group carrying that org's binding; epoch advances, X cannot
  decrypt anything after the commit.
- **Window, stated plainly**: policy revocation is instant on roster
  receipt; crypto-kick happens at the first online `role: admin` client.
  An org whose only admin is offline delays the kick until they return —
  runbook recommends ≥2 admins.

### 7. Membership resync (prerequisite for reliable revocation)

Known gap (`private_group_runtime.rs` comments): a member offline during a
commit desyncs permanently. Fix scoped to what revocation needs:

- Each group commit is stored (encrypted, `persistence.rs`) with its epoch
  by the admin and any member that observed it. No pruning in v1 (see
  Non-goals).
- Enveloped `ResyncRequest { have_epoch }` / `ResyncResponse { commits[] }`
  on the existing group control channel; on reconnect a member requests
  replay from its last epoch. Out-of-order commits are buffered keyed by
  epoch instead of dropped (the same buffer also holds commits pending a
  newer roster, per ADR 0005).
- **Fresh-state fallback**: a member with no usable state — reinstall, new
  device, late join, unreplayable gap — rejoins via roster: fresh
  KeyPackage, admin re-adds (dedup rule removes any stale leaf in the same
  commit).

This fixes an existing correctness bug for all private groups, org or not.

### 8. Device loss / reinstall

`moss_identity` lives in redb: reinstall or a new laptop = new peer-id. The
person goes through the normal join flow (URI + hello + code + approve) —
no new mechanism. The old peer-id must not stay in the roster as a live
credential:

- Admin CLI: an approve whose pending name matches an existing member
  requires the explicit `--replace` flag and prints loudly that this
  REVOKES the old device (short hash shown). Roster v+1 = Remove(old) +
  Add(new) atomically, one version; clients handle the removal as ordinary
  revocation.
- Stolen device before a replacement exists: plain `mosh-org remove` first,
  onboard later ("revoke first, think second" — runbook).
- No cooldown on replace: it would punish the legitimate case while costing
  a patient attacker nothing. The gate is the confirmation code verified
  with the live human (runbook: replace-approve only after voice/in-person
  confirmation).

### 9. Persistence

New redb tables in `persistence.rs`, following the `sessions` pattern:

- `org_roster`: one row per org — latest verified roster bytes (multi-org
  is a map, not a single row).
- `group_commit_log`: `(group_id, epoch) -> commit bytes` for resync.

Both inside the existing AES-256-GCM envelope; no new key material in this
repo. The admin CLI keeps the org private key in its own storage.

### 10. Admin CLI (separate private repo, out of scope here)

`mosh-org keygen | pending | approve | remove | bundle`. Consumes/produces
the roster format above; joins the org mesh via the same moss FFI to publish
signed rosters. This repo's only contract with it is the roster JSON format,
the bundle URI, and the envelope format — documented in this spec.

Nobody ever types a peer-id by hand. The flows are:

- **Member joins**: pastes the org bundle URI once (same gesture as a DM
  invite today). Their client publishes `OrgHello` automatically and the UI
  shows: "Your confirmation code: `a1b2-c3d4-e5f6` — give it to your admin"
  (first 12 hex of the peer-id, chunked by 4).
- **Admin approves**: `mosh-org pending` lists join requests as
  `<display_name>  <code>`. `mosh-org approve <name> <code>` — both
  arguments mandatory; approval succeeds iff exactly one pending hello
  matches both. The code is a **verification code**, not a disambiguator:
  the joiner dictates it over the pre-existing trusted channel (the one the
  URI came through), binding the pending request to a live human. 12 hex =
  48 bits — grinding a matching peer-id prefix moves from hours (32 bits)
  to GPU-farm-weeks, outside this threat model.
- **Collision = alarm**: two pendings sharing a 12-hex prefix is not a
  "type more characters" case — honest collision at 48 bits across 30
  people is ~impossible; a match means someone is grinding. CLI refuses and
  alerts.
- **Admin removes**: `mosh-org remove <name>`.
- **Device replace**: `mosh-org approve <name> <code> --replace` (see §8).
- `keygen` prints backup instructions (key file + passphrase). Restore
  runbook note: a backup carries a stale version counter — before signing,
  the CLI reads the highest roster from the mesh so the version resumes
  from live state (silent rollback rejection would otherwise mystify the
  admin).
- Peer-ids appear in full only inside the roster document and logs.

## UI (minimal)

- "Join organization" input accepting the org bundle URI (next to existing
  invite input) + the confirmation-code screen after paste.
- Sidebar section **per org** (multi-org): member list from roster, click →
  DM. UI re-reads the roster on any update.
- Admin client: "roster members not in group G" one-click add prompt (§5).
- Removed-member state: the member disappears from that org's roster
  section; an existing DM stays in the general chat list with a
  "no longer in <org>" badge, per-org context.
- "Leave organization" action — needed both for org-reset migration and for
  a member leaving voluntarily.

## Error handling

- Invalid roster signature / rollback version: reject silently, keep
  current roster, log at warn.
- Envelope verification failure on any org message: drop, log at warn.
- Org mesh unreachable: roster is cached in redb; the app works offline
  with the last known roster.
- Offer from a peer-id not in that org's roster: drop, log.
- Unreplayable resync gap: explicit "rejoin needed" state, never silent
  desync.

## Known properties (accepted, not bugs)

Stated here so nobody discovers them as surprises later:

- **Revocation window**: crypto-kick waits for the first online admin
  client (policy layer is instant). Mitigation: ≥2 admins, runbook.
- **Concurrent-commit fork**: possible, rare, self-heals via
  rejoin-via-roster. Deterministic tie-break is v2.
- **Stolen device keeps its DMs**: revocation unlinks DMs from the org but
  never kills them (DMs are standalone, Q5 decision). Each DM partner
  decides manually; the badge is their signal.
- **Root key compromise = org migration**: no in-band recovery, by design.
- **Roster contents are readable by any bundle-URI holder** on the org mesh
  — before approval and after revocation alike. The roster is membership
  metadata, never message content.
- **Gossip transport does not authenticate senders**: the app-level
  envelope is the only sender-auth layer in v1; transport verify in moss is
  the v2 defense-in-depth.

## Testing

- Envelope core: sign/verify round-trip; tampered payload fails; wrong
  domain context fails (relay-signature bytes must not verify as org
  envelope); cross-org replay fails (same payload, different
  `org_pubkey`/`mesh_id`).
- Roster core: signature tamper, version rollback, canonicalization
  stability (key order / whitespace), unknown-field forward-compat (verify
  succeeds, field ignored), diff correctness including replace
  (Remove+Add in one version).
- `mls_crypto`: `remove_member_by_peer_id` removes all matching leaves in a
  group with a duplicate; multi-proposal Remove+Add single commit; 3-party
  group, admin removes B → B's decrypt fails post-commit, A/C epochs
  advance.
- Commit authority: commit from non-admin rejected; commit with higher
  `roster_version` buffered then accepted after roster arrives; commit from
  an admin removed in the verifier's newer roster rejected.
- Resync: member misses N commits, replays, converges; out-of-order buffer;
  unreplayable gap → explicit rejoin state.
- Admission: KeyPackage with credential ≠ envelope peer-id rejected;
  peer-id not in roster rejected.
- E2E (manual, 2 machines): bundle join with code confirmation, roster DM,
  device replace, revoke while target offline → target loses group access
  on reconnect.

## Build order

1. Roster core + persistence tables (pure, testable, no runtime wiring).
2. Envelope core (pure crypto, blocks everything on org channels).
3. `mls_crypto`: `remove_member_by_peer_id` + multi-proposal Remove+Add
   commit (small, unblocks revocation and replace).
4. Group commit log + resync path + roster-version commit buffer (fixes an
   existing bug, largest risk item).
5. Org runtime: mesh, bundle URI, roster gossip, join flow with
   confirmation-code UI.
6. DM bootstrap + org groups (binding, manual add, auto-kick) + revocation
   wiring.
7. UI.
8. Admin CLI (separate repo; can start after steps 1–2 freeze the formats).
