# Changelog

All notable changes to Mosh are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/redstone-md/mosh/releases/tag/v0.2.0
