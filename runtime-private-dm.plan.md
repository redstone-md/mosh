# Runtime Private DM Plan

## Chosen Brainstorm

Reference: `runtime-private-dm.brainstorm.md`

Direction: prove runtime boundaries with real adapters and tests before expanding the UI.

## Goal

Make the previously untestable private DM runtime behaviors testable in Mosh desktop.

## Scope

In scope:

- Moss shared-library lifecycle wrapper for init/start/stop/subscribe/connect/publish/mesh info.
- Real two-peer Moss smoke test when a local shared library is available.
- OpenMLS Alice/Bob Welcome join and encrypted application-message roundtrip.
- Minimal ciphertext metadata persistence adapter and tests.
- Moss pinned release config plus explicit update tooling.
- Typed Tauri/TypeScript command updates for stable runtime status.

Out of scope:

- Full production UI for multi-device chat.
- Public rooms.
- Mobile clients.
- Modifying `../moss` source.

## Constraints

- Follow `AGENTS.md` file/function/type limits.
- Keep each runtime adapter cohesive and independently testable.
- Use real public APIs and real local dependencies; no service doubles.
- Keep Moss production builds pinned by config; latest is only explicit update tooling.
- Secrets stay in native storage; persisted history stores ciphertext plus minimal metadata only.

## Testing Methodology

Flows:

- Build or locate a real Moss shared library and verify required FFI symbols.
- Start two Moss nodes on localhost, connect, subscribe, publish, and receive a payload.
- Create OpenMLS Alice/Bob private group from Welcome and decrypt an application message.
- Persist ciphertext metadata and retrieve it by conversation.
- Validate Moss release pin config and update command behavior without changing production pin implicitly.

Commands:

- `npm run build`
- `npm test`
- `npm run format`
- focused Rust tests through `cargo test --manifest-path src-tauri/Cargo.toml`

## Ordered Implementation Plan

### 1. Baseline

- [x] Run current gates before runtime changes.
- [x] Record failures or missing tools.

### 2. Moss Runtime

- [x] Add typed FFI symbol table and lifecycle wrapper.
- [x] Add local Moss build path that emits artifacts under ignored build output.
- [x] Add a real two-peer smoke test using the shared library.

### 3. OpenMLS Runtime

- [x] Add Alice/Bob group abstraction with key package, Welcome join, protect, and unprotect.
- [x] Add Rust tests for Welcome join and message roundtrip.

### 4. Ciphertext Persistence

- [x] Add minimal local persistence adapter for ciphertext plus indexed metadata.
- [x] Add tests for append/list/read behavior and metadata boundaries.

### 5. Moss Release Pinning

- [x] Add `moss.config.json` with pinned version.
- [x] Add `npm run moss:update` tooling with `--latest` explicit update path.
- [x] Add tests for config parsing and update behavior.

### 6. Final Validation

- [x] Run build.
- [x] Run tests.
- [x] Run format.
- [x] Review diff and file sizes.
- [x] Commit atomically.

## Baseline Results

- `npm run build`: passed before runtime changes.
- `npm test`: passed with 11 frontend tests and 6 Rust tests before runtime changes.
- `npm run format`: passed before runtime changes.
- `cargo test --manifest-path src-tauri/Cargo.toml two_local_moss_peers_exchange_payload -- --nocapture`: passed after building `../moss/cmd/moss-ffi` into `src-tauri/target/moss-test` and exchanging a payload between two local peers.
- `cargo test --manifest-path src-tauri/Cargo.toml openmls_alice_bob_welcome_join_decrypts_message -- --nocapture`: passed with Bob joining Alice's MLS group from Welcome and decrypting Alice's application message.
- `cargo test --manifest-path src-tauri/Cargo.toml ciphertext_store -- --nocapture`: passed with append/list coverage for ciphertext plus minimal metadata.
- `npx vitest run src/features/private-dm/moss-release/moss-release-config.test.ts`: passed with pinned default and explicit latest update coverage.
- `npm run moss:update`: printed pinned `moss.version=v0.2.0` without updating config.
- `npm run build`: passed after runtime changes.
- `npm test`: passed with 15 frontend tests and 10 Rust tests after runtime changes.
- `npm run format`: passed after rustfmt.

## Already Failing Tests

None known yet.
