# Runtime Private DM Brainstorm

## Problem

The desktop tracer shell proves UI, invite parsing, diagnostics, native secure storage status, Moss dynamic symbol loading, and a one-member OpenMLS smoke test. It does not yet prove the runtime flows that make a private DM testable.

## Missing Testable Behaviors

- Two Moss peers can start, connect, subscribe, publish, and receive payloads through the shared library.
- Alice can create an MLS group, Bob can join from a Welcome, and application messages can decrypt across the two device states.
- Ciphertext history can be persisted with only minimal indexed metadata.
- Moss shared-library artifacts can be resolved through pinned release config and updated explicitly.

## Options

### Option A: Wire the full app state immediately

Pros:
- Directly visible in UI.
- Closer to the final product.

Cons:
- Too much state, error handling, and UI surface in one step.
- Harder to keep tests precise.

### Option B: Build runtime contracts with real integration tests first

Pros:
- Proves the hard boundaries before UI grows.
- Keeps Moss, OpenMLS, storage, and release tooling independently testable.
- Fits tracer-bullet architecture.

Cons:
- UI still needs a later pass to drive the full flow interactively.

## Chosen Direction

Use Option B. Add real native/runtime contracts and tests first, then expose typed Tauri command/client surfaces where stable enough.

## Risks

- Moss local integration depends on Go + CGO toolchain and a buildable sibling `../moss` checkout.
- Go shared libraries should be loaded once per process; tests must avoid repeated unload/reload assumptions.
- OpenMLS APIs are version-specific and must be verified from local crate sources.
- Release update tooling must not silently float production builds to latest.
