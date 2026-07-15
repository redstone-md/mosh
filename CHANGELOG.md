# Changelog

All notable changes to Mosh are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.5] - 2026-07-15

### Fixed
- **Direct messages reach the "direct" path again on the shared network.**
  The shared-substrate rework made a DM's counterpart just one of many world
  peers, so two chat endpoints only ever connected to each other by luck and
  the conversation stayed stuck on "relayed via supernode". Each side now
  asks moss to connect to its specific counterpart (moss v0.6.15
  `ConnectToPeer`): dialed immediately, retried until connected, then
  upgraded from relayed to direct as before.
- **The connection status no longer flickers between "relayed" and "warming
  up".** Relay readiness is now held for 10 seconds across momentary
  relay-peer drops instead of tracking every blip, and the background send
  worker no longer stalls on those blips either.
- **The network no longer piles onto supernodes.** Nodes used to dial
  relay-capable supernodes first, funneling the whole network's gossip
  through the relay infrastructure. Peer selection is neutral now, keeping
  just two relay-capable connections as a fallback (moss v0.6.15).

## [0.6.0] - 2026-07-14

### Fixed
- **The app no longer freezes while a relayed chat is connecting.** Sending
  over the relay used to block the whole interface for several seconds at a
  time whenever the relay link was still warming up or the peer was
  unreachable. Relay sends now run in the background: messages queue up, wait
  for the relay to become usable, and retry on their own.
- **Messages sent while the relay is warming up no longer fail instantly.**
  Instead of an immediate "relay send failed", a queued message stays marked
  as sending and goes out as soon as the relay converges (or reports a real
  failure after retries).

### Added
- **Delivery receipts in direct messages.** Your own messages now show their
  real journey: *sending…* → *✓ sent* (left this device) → *✓✓ delivered*
  (the peer's app confirmed receipt). Until a message is confirmed, Mosh
  automatically re-sends it in the background — so a message published into a
  dead connection no longer vanishes silently while looking "sent".
- **Diagnostics show relay warm-up.** While the shared relay node has not yet
  found a relay-capable supernode, the conversation's Path row reads "relayed
  via supernode (warming up)" so a not-yet-usable relay is no longer
  indistinguishable from a working one.

## [0.5.1] - 2026-07-13

### Fixed
- **Direct messages follow a peer to their current address.** A one-to-one chat
  no longer stays pinned to the first network identity it saw for someone. When
  a contact reconnects from a new location or restarts, Mosh now tracks their
  latest address, so messages keep flowing instead of silently going to a stale
  endpoint.

## [0.5.0] - 2026-07-13

### Added
- **Organizations: join a team roster and message its members.** A company or
  group can now run Mosh as a closed network. You join an organization from an
  invite link, which shows you a short confirmation code to read out to your
  admin — no keys to copy, no way to be added by someone who doesn't already
  have your code. Once approved you see the org's member list and can start an
  end-to-end encrypted direct message with anyone on it in one click, without
  swapping invite links first.
- **Org groups.** An org admin can spin up a group chat and pull in members
  straight from the roster. The group is bound to the organization: only people
  the admin has approved can be in it.
- **Membership is enforced, not advisory.** When an admin removes someone from
  the organization, that person is automatically dropped from every org group —
  and the removal sticks across restarts and for groups you had closed at the
  time. Removed members lose access to future messages; a "no longer in" marker
  shows on any direct chat with someone who has left. If a group ever falls too
  far behind to catch up on membership changes, Mosh tells you to ask an admin
  to re-invite you rather than showing a silently stale member list.
- **The roster is cryptographically signed by the organization.** Membership is
  gossiped peer-to-peer with no central server, and every client verifies the
  organization's signature and rejects any attempt to roll the roster back to an
  older version. Messages stay end-to-end encrypted throughout (OpenMLS +
  Noise); the roster only decides who is allowed in, never what is said.

### Notes
- Creating and administering an organization is done with a separate admin tool
  that holds the organization's signing key; the Mosh app never sees that key.
  Personal one-to-one DMs and groups are unchanged and need no organization.

## [0.4.3] - 2026-07-08

### Fixed
- **A transient hole punch no longer kills the relay path for good.** The DM
  transport state machine treated `direct` as terminal: the moment a single
  direct peer appeared — which behind symmetric NAT happens for a few seconds
  per punch before the mapping dies — a relayed conversation dropped its relay
  and switched to direct, then had no way back when the punch collapsed. The
  chat stayed stuck flapping on a dead direct path with the MLS handshake
  never completing. Now a relayed conversation only migrates to direct after
  the direct link has held for 30 s, and a direct conversation falls back to
  the relay once its peer has been gone for 5 s.
- **Hard-NAT joiners can complete the handshake entirely over the relay.** The
  invite link now carries the creator's moss peer id, so the joining side can
  relay the MLS handshake through a SuperNode even when no direct window ever
  opens. Old invites still parse; they just rely on the handshake exchange to
  learn the id, as before.

## [0.4.2] - 2026-07-02

### Fixed
- **Relay fallback can actually find a relay.** Bundled Moss core bumped to
  `f3bb2fb`: a relay SuperNode now periodically re-advertises its status, so a
  client that joins the shared relay mesh *after* the relay came online learns it
  can route through it (previously the one-shot promotion notice was missed and
  relay selection found nothing). Without this, the 0.4.0 relay-fallback path was
  inert for the common case; direct-capable DMs were unaffected either way.

## [0.4.1] - 2026-07-02

### Fixed
- **NAT detection works on IPv4-only networks.** Bundled Moss core bumped to
  `adb5a96`: STUN and peer address resolution is now forced to IPv4 to match
  Moss's IPv4-only transport. Previously, on a network with no IPv6 route, a STUN
  hostname could resolve to an IPv6 address that the v4 socket can't reach, so
  NAT detection stalled at "unknown" — affecting the relay-fallback path for
  peers on IPv4-only carriers.

## [0.4.0] - 2026-07-02

### Added
- **Direct messages now reach peers behind hard NAT.** When a one-to-one chat
  can't hold a direct link — the case for a peer on carrier-grade NAT, common on
  Russian mobile ISPs — Mosh transparently falls back to relaying the
  conversation through a volunteer relay SuperNode instead of leaving the chat
  stuck on "connecting". The relay only ever forwards ciphertext: messages stay
  end-to-end encrypted (OpenMLS + Noise) and the relay operator cannot read
  them. If a direct path later becomes possible the chat silently migrates back
  to it.
- **A "Path" row in the DM diagnostics drawer** shows whether a conversation is
  `direct`, `relayed via supernode`, or still `connecting`, and notes that
  relayed traffic stays end-to-end encrypted.

### Changed
- **Bundled Moss core bumped to `c02acb4`** for the relay-by-peer-id transport
  the fallback is built on (`Moss_RelaySendTo` + relay callback).

### Notes
- The relay fallback stays **inert until at least one public relay SuperNode is
  reachable** on the shared relay mesh. Standing up that pool ships separately
  (the MossSpore project); until a spore is live, hard-NAT DMs degrade to
  "connecting" exactly as before — direct-capable chats are unaffected.

## [0.3.1] - 2026-07-01

### Fixed
- **CGNAT peers no longer flap connect/disconnect.** Bundled Moss core bumped
  to `23d53e5`, pulling two NAT reachability fixes. Previously a node behind
  carrier-grade NAT (common on Russian ISPs) labelled *itself* publicly
  reachable purely from its STUN reflexive address and broadcast that to the
  mesh; peers then hammered a direct mapping that dies and re-opens on a new
  port each attempt, producing rapid `peer_joined`/`peer_left` churn.
  Reachability now requires a real inbound probe, and genuine carrier NAT is
  detected observationally (varying mapped port → symmetric) instead of from
  address shape. Both peers must run ≥ 0.3.1 for the fix to take effect on a
  given link.

## [0.3.0] - 2026-06-30

### Changed
- **Bundled Moss core upgraded to v0.4.0 (DPI-resistant flag-day).** All
  peer-to-peer UDP traffic is now obfuscated by a keyed scramble codec so it
  is indistinguishable from random UDP — Mosh now connects on networks that
  fingerprint-block protocols like WireGuard (notably Russian DPI). Discovery
  also gained the BitTorrent mainline DHT, a persistent peer cache for warm
  reconnect, and faster tracker bootstrap.
- **Network compatibility break:** the wire format changed, so this build does
  **not** interoperate with Mosh ≤ 0.2.x or older relays. Everyone on a mesh
  must update together. Message confidentiality is unchanged (OpenMLS + Noise);
  the codec is an anti-censorship wrapper, not the encryption layer.

## [0.2.10] - 2026-06-17

### Fixed
- **Voice-call audio is encrypted with a unique nonce per frame.** A flaw in the
  call frame crypto could reuse an AES-GCM nonce across frames, which weakens
  the encryption of live call audio. Each frame now derives a unique nonce, and
  an out-of-range frame sequence is rejected instead of silently wrapping.
- **Call audio recovers cleanly after a network stall.** Playback scheduling
  could drift further and further ahead of real time once a backlog built up,
  so audio lagged for the rest of the call; it now resyncs to the present.
  Frames lost in transit no longer make the remaining speech sound stretched —
  the decoder is told where the gaps are.
- **The ringtone always stops.** An incoming-call tone could keep oscillators
  and its audio context alive after the call was answered or dismissed; it now
  stops and tears down reliably.
- **Calls are labelled missed vs. completed correctly** in the call history.
- **You're no longer pulled out of a chat you just opened.** The roster refresh
  that runs every second could yank the view back to the first conversation if
  it completed before a just-created chat appeared in the list. It now keeps the
  chat you opened until it's confirmed gone.
- **Messages sent in the same millisecond can't collide.** Outgoing messages now
  get a monotonic id, so two sent in quick succession are no longer mistaken for
  one another.
- **Unread counts follow device identity, not display name**, so peers sharing a
  display name no longer miscount notifications.
- **A private group keeps working when a single frame is malformed.** One bad
  frame no longer halts delivery, and a re-applied membership change is ignored
  instead of erroring.
- **Stricter invite validation.** An invite fingerprint must be a properly
  anchored, well-formed value before it's accepted.
- **Corrupted local data fails safe.** One unparseable line in stored history is
  skipped instead of dropping the whole conversation, and a corrupted MLS
  snapshot surfaces an error instead of silently emptying secure storage.
- **Keyboard focus stays inside open dialogs** — the focus trap now ignores
  `aria-hidden`/`inert` content.

## [0.2.9] - 2026-06-17

### Fixed
- **Voice messages can be recorded on macOS.** The recorder only offered the
  WebM/Ogg Opus containers, which the macOS WebView (WebKit) cannot capture, so
  it reported recording as unsupported and the microphone button never appeared.
  It now falls back to MP4/AAC on WebKit while keeping WebM/Opus on Windows, and
  the macOS bundle ships an `NSMicrophoneUsageDescription` so the system grants
  microphone access.
- **Attachments with a large preview are delivered again.** An attachment's
  manifest — including its inline thumbnail — rides a single gossip publish that
  caps at 64KB. A heavy thumbnail pushed the encrypted manifest past the cap, so
  the peer silently never received it even though the sender saw the message as
  sent. Oversized thumbnails are now dropped from the manifest (the file is
  still downloadable in full), keeping every attachment under the transport
  limit.

## [0.2.8] - 2026-06-15

### Fixed
- **Private DMs no longer get stuck on "waiting" after the peer connects.** The
  MLS handshake (KeyPackage → Welcome) was published exactly once, before the
  Moss mesh link to the peer existed. Gossip does not buffer for an unmeshed
  peer, so on a fresh invite the handshake frame was routinely lost and the
  conversation hung on "waiting" even though the transport reported the peer as
  joined. The joiner now re-sends its KeyPackage until the handshake completes,
  and the creator caches and re-answers the Welcome, so discovery flapping or a
  slow mesh no longer deadlocks the dialog.
- **Waiting private-DM invites survive restart.** Creating an invite now persists
  the creator's MLS snapshot immediately, so a waiting DM session reappears
  after relaunch and discovery can continue instead of dropping the dialog.
- **Restored DMs become writable after inbound activity.** If an incoming
  encrypted message proves the peer is already in the MLS session, the runtime
  now reports the DM as ready instead of leaving the composer stuck in
  `waiting`.
- **Restored DMs wait for live Moss presence.** Historical MLS state no longer
  marks a DM writable by itself after relaunch; the composer waits until Moss
  reports a live peer, and unread notifications ignore locally-authored
  messages.

## [0.2.7] - 2026-06-14

### Added
- **Persistent history for public channels and private groups.** Channel and
  private-group conversations now survive an application restart, the same way
  private DMs already did — message history is restored on launch instead of
  starting empty.
- **Send retry for failed messages.** A message that fails to send can be
  retried; the retry state is persisted, and historical messages show their
  retry status after a restart so a stuck send is visible rather than silently
  lost.
- **Message metadata in the UI.** Grouped messages now show timestamps, and
  per-message metadata is exposed without cluttering the thread.
- **Browser demo gateway.** The app can run against a browser-safe native
  gateway fallback, allowing a no-install demo in the browser.
- **Clearer peer diagnostics.** Peer/connection diagnostics are reorganized into
  a more readable hierarchy.

### Fixed
- **Mobile UX pass.** Expandable conversation rail, full-screen mobile
  diagnostics, ordered mobile topbar controls, a stabilized and tighter compact
  chat header, compact composer and session rail, and reduced chrome on grouped
  messages — the small-screen layout no longer overflows or crowds the content.
- **Send failures are surfaced.** A failed chat send now reports the error to the
  user instead of failing quietly.
- **Invite validation feedback.** Invalid invites are explained more clearly, and
  onboarding invite validation is tightened.
- **No destructive browser dialog.** The native confirm dialog was replaced with
  an in-app confirmation; modal keyboard focus was improved.
- **Diagnostics moved into a drawer**, message security metadata was quieted, and
  the raw attachment file input is hidden behind the normal control.
- Added an app favicon.

### Changed
- Large internal refactor with no behavior change: chat orchestration, composer,
  message lists, session rail, voice-call orchestration, DM offer/lifecycle, the
  onboarding panel, and the diagnostics drawer were split into focused hooks and
  components. This is groundwork; users should see no functional difference.

## [0.2.6] - 2026-06-03

### Added
- **Outgoing call UI.** Placing a call now shows a "Calling…" overlay with the
  peer's name, a dial tone, and a cancel button while waiting for an answer
  (previously the caller saw nothing).

### Fixed
- **Call screens show the right name.** An incoming call now shows the caller's
  name, and the active/outgoing call overlay shows the peer's name — instead of
  the local user's own display name. The peer name is learned from inbound
  frames and restored after a restart.

### Changed
- The right-hand peer-status panel is now reliably scrollable and more compact
  (smaller type, tighter spacing) so it no longer overflows the window.

## [0.2.4] - 2026-06-03

### Fixed
- **Honest NAT reachability detection (peer flapping).** A node behind NAT was
  classified as publicly reachable ("open") from a single reflexive address —
  which is only the NAT's WAN IP — so peers kept attempting futile direct dials
  and the connection flapped (rapid `peer_joined`/`peer_left`). The Moss runtime
  (bumped to v0.3.1) now leaves reachability to an actual inbound probe and
  detects symmetric NAT from varying mapped ports.

### Note
- Two peers both behind symmetric NAT still require a relay/supernode to
  connect; correct detection lets Moss pick relay paths instead of looping on
  direct dials.

## [0.2.3] - 2026-06-03

### Fixed
- **Sending works again after a restart.** When the app reconnects, the mesh
  re-delivers already-consumed MLS messages; decrypting those fails by design
  ("secret deleted to preserve forward secrecy"). Because the inbound drain ran
  before every send, that expected error was surfaced as a *send* failure. The
  drain now drops an undecryptable/replayed frame and keeps going, so sending
  is unaffected.

### Changed
- **Deleting a conversation now removes it for good.** Closing a chat previously
  only dropped it from the in-memory list, so it reappeared on the next launch.
  It now purges the persisted session record, MLS snapshot and messages, and
  asks for confirmation first.

## [0.2.2] - 2026-06-02

### Fixed
- **Stable Moss node identity across restarts.** The Moss transport identity
  (libp2p key) was regenerated on every launch because the host never wired
  Moss's keystore, so after a restart a peer saw a brand-new peer-id and the
  connection flapped (rapid `peer_joined`/`peer_left`) instead of
  re-establishing. The identity is now persisted in the encrypted store
  (AES-256-GCM) and reused on restart.

## [0.2.1] - 2026-06-02

### Fixed
- **Invite joiner's chat history now survives restart.** The peer who *accepted*
  an invite only obtains its MLS group after processing the creator's Welcome,
  so the session record written at accept time kept an empty group-id
  placeholder and could not be reloaded — the whole conversation was silently
  dropped on the next launch. The record is now refreshed once the group is
  established. (The invite *creator* was unaffected.)

### Changed
- Added a quality-gated CI pipeline (rustfmt, Clippy `-D warnings`, typecheck,
  vitest, cargo-nextest with retries) and a Windows release pipeline that builds
  and attaches installers. The Rust toolchain is pinned via `rust-toolchain.toml`.

## [0.2.0] - 2026-06-02

### Added
- **Encrypted persistent chat history.** Private-DM conversations now survive
  application restarts. Message history and MLS session state are stored
  encrypted at rest in a local redb database.
- **Full MLS session continuity.** The OpenMLS group state of each session is
  snapshotted and restored on startup (via `MlsGroup::load`), so an existing
  end-to-end-encrypted conversation keeps working after a restart with no
  re-invite or re-handshake.
- **Attachment & voice messages persist.** Attachment descriptors are stored and
  re-rendered from the local cache on restart; cached files (including the
  sender's own) open/play immediately. Voice-message metadata is preserved.
- **Call log persists.** Completed/missed call events keep their timestamp and
  duration across restarts.

### Security
- At-rest encryption uses **AES-256-GCM** with a random 96-bit nonce per record.
- The 256-bit data-encryption key (DEK) is stored in the **OS keychain** (Windows
  Credential Manager) and never written to disk in plaintext.
- **Fail-closed:** if the keychain or database is unavailable the app runs
  in-memory only and never falls back to writing unencrypted data. A transient
  keychain failure on a machine with an existing database is refused rather than
  silently minting a new key (which would orphan prior history).

### Known limitations
- Auto re-download of a received attachment that is **not** in the local cache is
  not possible from persisted data alone (the chunk-crypto manifest is not
  persisted and MLS forward secrecy prevents re-decrypting the original offer).
  Such an attachment re-renders as a bubble and downloads only if the peer
  re-offers it on reconnect.
- Channels and private groups are not yet covered; this release targets private
  DMs.
- Secure erasure of stale overwritten bytes in the database file is out of scope.

[0.2.8]: https://github.com/redstone-md/mosh/releases/tag/v0.2.8
[0.2.7]: https://github.com/redstone-md/mosh/releases/tag/v0.2.7
[0.2.0]: https://github.com/redstone-md/mosh/releases/tag/v0.2.0
