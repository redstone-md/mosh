# Desktop Private DM Brainstorm

## Problem Framing

Mosh needs a desktop-first tracer bullet for private 1:1 messaging. The slice must prove the product-critical path without expanding into a complete messenger: onboarding, invite exchange, fingerprint confirmation, encrypted direct-message send/receive, and enough diagnostics to understand Moss connectivity.

## Current State

- `mosh` currently contains repository governance only.
- `../moss` contains the Moss Go runtime and C shared-library FFI.
- `../moss/examples/rust_example` proves Rust can link to the Moss shared library.
- `../mosh-design` contains existing desktop and mobile React design mockups and tokens.
- `docs/Architecture.md` does not exist yet.

## Core Requirements

- Desktop first with Tauri v2, React, TypeScript, and Rust.
- Dynamic link to a pinned Moss shared-library release by default.
- Provide update tooling later for fetching the latest Moss release and bumping the pin.
- Private 1:1 chats use an MLS group abstraction with OpenMLS-first cryptography.
- TypeScript owns portable protocol orchestration and UI-facing contracts.
- Native code owns Moss integration, OpenMLS operations when required, and secure storage.
- Public chats are authenticated and signed, not confidential, but public rooms are outside the first tracer bullet.
- Invite links are copyable URI payloads and QR-ready.
- Trust establishment uses invite links plus manual fingerprint confirmation.
- Most users are behind NAT, so default/public Moss trackers are the v1 discovery path.
- Surface metadata limits clearly and calmly.
- Private history stores ciphertext plus minimal indexed metadata.
- Each device is its own identity in v1.

## Options

### Option A: Full messenger shell first

Build the full desktop UI structure from `../mosh-design`, including DMs, contacts, public rooms, settings, diagnostics, and history.

Trade-offs:

- Pro: closer visual parity with the design package.
- Con: too much surface area before Moss/OpenMLS integration is proven.
- Con: risks creating polished mock UI around unproven protocol boundaries.

### Option B: Protocol-first CLI or headless harness

Build Moss/OpenMLS integration without a desktop UI.

Trade-offs:

- Pro: fastest way to validate crypto and transport behaviour.
- Con: does not satisfy desktop-first product goal.
- Con: misses Tauri callback, secure storage, and UI state boundaries.

### Option C: Desktop tracer bullet with minimal screens

Build a real Tauri app with only onboarding, invite/fingerprint confirmation, one private DM screen, and diagnostics.

Trade-offs:

- Pro: proves the actual user-facing flow end to end.
- Pro: preserves visual direction by reusing selected design tokens and components.
- Pro: keeps file and feature scope small enough for maintainability limits.
- Con: later work must expand the design system and public room flows.

## Recommended Direction

Choose Option C.

The first Mosh slice should be a real desktop application, not a design-system migration or a headless protocol demo. It should carry only enough UI to validate the private DM journey while keeping protocol and native boundaries clean for Android and iOS.

## Boundary Model

- `src/features/private-dm`: TypeScript feature slice for onboarding, invite confirmation, DM UI, local state, and protocol-facing contracts.
- `src/shared`: shared frontend primitives, constants, app shell, and design tokens.
- `src-tauri`: Rust shell, Tauri commands, Moss dynamic-link bridge, secure storage adapter, and future OpenMLS adapter.
- `docs`: architecture map, feature specs, and ADRs.

## Risks

- OpenMLS state management can become complex even for 1:1 if group commits and welcomes are not isolated behind a clear adapter.
- Dynamic Moss release fetching can hurt reproducibility if the pin is bypassed in CI/release builds.
- Public tracker discovery protects content through MLS but does not provide metadata anonymity.
- Native callbacks from Moss must be marshaled safely to the Tauri frontend event loop.
- Existing design files are outside the repo root and must remain read-only unless the user expands scope.

## Open Questions

- Which exact OS keychain crate should be used for desktop secure storage?
- Should initial OpenMLS integration be real in the first code pass or represented by a strongly typed adapter contract with a follow-up implementation slice?
- Which test runner should be chosen for frontend integration and Tauri command tests?

## Chosen Direction

Proceed with a Tauri v2 + Vite + React + TypeScript scaffold, then implement the private DM slice as a vertical feature. Start with adapter contracts and a UI that can run against real Tauri command boundaries. Integrate Moss/OpenMLS in small follow-up steps once build, test, and architecture scaffolding are established.
