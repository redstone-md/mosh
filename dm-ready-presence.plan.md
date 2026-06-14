# DM Ready Presence Plan

Brainstorm: `dm-ready-presence.brainstorm.md`

## Goal

Prevent restored private DMs from becoming writable before Moss has a live peer connection, and prevent own outbound messages from generating "new message" unread/notification signals.

## Checklist

- [x] Change native regression expectations so restored/inbound MLS evidence without live Moss peer stays `waiting`.
- [x] Add frontend unread regression coverage for own messages.
- [x] Implement live-peer-aware DM ready state.
- [x] Implement incoming-only unread counts.
- [x] Run focused tests.
- [x] Run full verification.
- [x] Commit, push, rebuild binaries, and replace release assets.

## Verification Plan

- Focused Rust private DM tests.
- Focused Vitest unread tests.
- Repo gates: `npm run format`, `npm run build`, `npm test`.
- Release build: `npm run build:app`.
- Release upload verification through `gh release view v0.2.7 --json assets`.

## Verification Results

- `cargo test --manifest-path src-tauri/Cargo.toml inbound_ -- --nocapture` passed: 3 passed.
- `npx vitest run src/features/private-dm/notifications/unread.test.ts` passed: 6 passed.
- `cargo test --manifest-path src-tauri/Cargo.toml private_dm_runtime::tests:: -- --nocapture` passed: 7 passed, 4 ignored.
- `npm run format` passed.
- `npm run build` passed.
- `npm test` passed: Vitest 16 files / 81 tests; Rust 77 passed / 5 ignored.
- Commit `1807834 fix: gate dm ready on live peer` pushed to `origin/main`.
- `npm run build:app` passed.
- `gh release upload v0.2.7 ... --clobber` passed and release asset digests match the local build.
