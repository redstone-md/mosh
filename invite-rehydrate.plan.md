# Invite Rehydrate Plan

Brainstorm: `invite-rehydrate.brainstorm.md`

## Goal

Restore waiting private DM invite sessions after Mosh restarts, so an invite-created dialog can resume discovery instead of disappearing.

## Scope

- Fix the private DM persistence/restart path in `src-tauri/src/adapters/private_dm_runtime.rs`.
- Do not change React client state, Zustand/TanStack boundaries, GSAP animation, or Moss core.

## Constraints

- Keep the change inside the existing `PrivateDmRuntime` boundary.
- Avoid introducing new stringly APIs or broad abstractions.
- Keep additions minimal because `private_dm_runtime.rs` already exceeds the preferred file limit.
- Preserve existing message-history and joiner rehydrate behaviour.

## Testing Methodology

- Add a regression test that creates an invite, drops the runtime before any message is sent, rehydrates from the same encrypted store, and asserts the session exists with `state == "waiting"` and the original invite URI.
- Run the new focused test and the existing rehydrate test around message history.
- Run the repo-defined Rust test scope for the touched native crate if focused tests pass.

## Checklist

- [x] Add failing regression test for waiting creator invite rehydrate.
- [x] Confirm the test fails because the session is absent after `rehydrate`.
- [x] Persist the creator MLS snapshot at invite creation.
- [x] Confirm the regression test passes.
- [x] Run related rehydrate tests.
- [x] Run broader verification commands.
- [x] Review diff for scope and commit atomically.

## Baseline

Focused RED result:

`cargo test --manifest-path src-tauri/Cargo.toml waiting_creator_invite_survives_restart -- --nocapture`

Result: failed as expected. `rehydrate` logged `missing MLS snapshot`, then the test panicked at `waiting invite should rehydrate`.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml waiting_creator_invite_survives_restart -- --nocapture` passed after the fix.
- `cargo test --manifest-path src-tauri/Cargo.toml survive_restart -- --nocapture` passed: 2 passed, 1 ignored.
- `npm run build` passed after formatting.
- `npm run format` passed after applying `cargo fmt`.
- `npm test` passed after formatting: Vitest 16 files / 80 tests passed; Rust 75 passed / 5 ignored.
