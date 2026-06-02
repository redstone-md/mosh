# Changelog

All notable changes to Mosh are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
