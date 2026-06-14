# Invite Rehydrate Brainstorm

## Problem

An invite creator can be left in a waiting private DM state. After restarting Mosh, that waiting session may disappear, so the existing invite/dialog cannot be resumed.

## Current Evidence

- `create_invite` writes a persisted session record immediately.
- `rehydrate` skips every persisted session that does not also have an MLS snapshot.
- Alice creates an MLS group during invite creation, but `create_invite` does not write the matching MLS snapshot.
- Existing restart tests only cover sessions after a message/send path, which writes snapshots later.

## Options

1. Persist Alice's MLS snapshot when `create_invite` persists the session record.
2. Make `rehydrate` recreate missing Alice snapshots from the session record.
3. Keep the UI invite state separately and recreate the native session from the invite URI.

## Decision

Use option 1. The snapshot is already available from the live crypto state, keeps persistence ownership in `PrivateDmRuntime`, and avoids adding UI-side recovery state.

## Scope

In scope:

- Regression test proving an invite-created waiting session survives runtime restart.
- Minimal Rust persistence fix in `PrivateDmRuntime::create_invite`.

Out of scope:

- Changing the invite URI contract.
- Changing Moss discovery behaviour.
- Adding UI storage or new client state.
- Modifying the sibling `../moss` repository.

## Risks

- Rehydrate starts a Moss node for the restored session, so the test must use the existing runtime/test lock pattern.
- The Rust file is already over the preferred size limit; this fix must stay narrow and avoid broad refactoring.
