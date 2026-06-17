# Mosh

Mosh is a desktop-first, decentralized, end-to-end-encrypted messenger. It is
built with Tauri v2 (Rust) and React + TypeScript, uses OpenMLS for message-layer
encryption, and discovers peers over the Moss mesh runtime — no central server.

## Download

Installers for Windows and macOS are published on the
[**Releases**](https://github.com/redstone-md/mosh/releases) page.

Windows builds are code-signed using a certificate from the **SignPath
Foundation**. Free code signing is provided by [SignPath.io](https://signpath.io),
certificate by the [SignPath Foundation](https://signpath.org). See
[`CODE_SIGNING.md`](CODE_SIGNING.md) for the signing policy.

## Features

- **Private 1:1 DMs** — invite-URI onboarding with out-of-band fingerprint
  confirmation.
- **Channels and private groups** — multi-party conversations with their own
  membership and per-conversation DMs.
- **Attachments and voice messages** — chunked, encrypted file transfer with
  thumbnails and voice waveforms.
- **Voice calls** — encrypted real-time audio with jitter buffering.
- **End-to-end encryption** — OpenMLS group messaging over every channel.
- **Decentralized discovery** — Moss tracker / mesh-based peer discovery; users
  never enter hosts or ports in the primary flow.
- **Encrypted persistent history** — conversations and MLS session state survive
  restarts (see Persistence & Privacy).

## Architecture

- `src/` — React + TypeScript frontend (Vite). Feature code lives under
  `src/features/`.
- `src-tauri/` — Rust backend (Tauri v2). Runtime adapters under
  `src-tauri/src/adapters/` bridge the UI to crypto, transport, storage, and the
  Moss shared library.
- Moss runtime — the decentralized transport/discovery layer, built from Go
  sources into a native shared library and loaded via FFI. Its source is the
  `redstone-md/moss` repository, vendored here as a git submodule at `moss/` and
  pinned to a release tag in `moss.config.json`.

## Getting started

```powershell
git clone --recursive https://github.com/redstone-md/mosh   # includes the moss submodule
# already cloned without --recursive? fetch the submodule:
git submodule update --init
npm install
npm run tauri dev   # run the app in development
```

The Go toolchain is required: `npm run build:app` (and `moss:prepare`) build the
Moss native library from the `moss/` submodule.

Onboarding flow:

1. Open Mosh on two desktops.
2. One device clicks **Create invite**; Mosh copies a `mosh://invite?...#fp=...` URI.
3. Share that URI through any existing channel.
4. The other device pastes it into **Invite URI** and confirms the fingerprint
   out of band.
5. Both sides can now message, send attachments, and call. Receiving refreshes
   automatically over Moss discovery.

## Commands

```powershell
npm run dev         # frontend only (Vite)
npm run tauri dev   # full desktop app in development
npm run build       # type-check + build the frontend
npm run build:app   # bundle installers -> src-tauri/target/release/bundle/
npm test            # typecheck + vitest + cargo test
npm run format      # check Rust formatting
```

## Persistence & Privacy

**Mosh collects no user data.** There is no central server, no telemetry, no
analytics, and no crash reporting. Nothing leaves your device except
end-to-end-encrypted messages exchanged directly with your peers over the
decentralized Moss mesh. All local data is stored encrypted, as described below.

Private-DM history and MLS session state persist across restarts, encrypted at
rest:

- Stored in a local redb database under the app-data directory.
- Each record is encrypted with **AES-256-GCM**; the 256-bit key lives in the OS
  keychain (Windows Credential Manager) and is never written to disk in plaintext.
- MLS group state is snapshotted and restored via `MlsGroup::load`, so an existing
  encrypted conversation keeps working after a restart with no re-invite.
- Attachments re-render from the local cache; call events keep their duration.
- **Fail-closed:** if the keychain or database is unavailable, Mosh runs
  in-memory only and never writes unencrypted data.

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## Build notes

- Cargo reuses `src-tauri/target` for Rust build artifacts; the first build
  compiles the full Tauri + OpenMLS dependency tree and can take several minutes.
- `npm run build:app` runs `moss:prepare` first to stage the Moss shared library
  next to the app.

## Moss submodule

- `moss/` is a git submodule tracking `redstone-md/moss`, pinned to a release tag.
- `npm run moss:update` resolves and pins the version in `moss.config.json`.
- `npm run moss:prepare` builds the native library from the submodule into
  `src-tauri/moss-runtime/`.

Do not commit built Moss shared-library binaries or generated credentials.

## License

Mosh is free software licensed under the **GNU General Public License v3.0 or
later** (`GPL-3.0-or-later`) — see [`LICENSE`](LICENSE). You may use, study,
share, and modify it; any distributed derivative must remain under the GPL and
ship its source.

The bundled Moss runtime (`moss/` submodule) is a separate project under the MIT
license.
