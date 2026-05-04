# Mosh

Mosh is a desktop-first decentralized messenger built with Tauri v2, React, TypeScript, Rust, the Moss shared runtime, and an OpenMLS-oriented private messaging architecture.

## Current Slice

The current tracer bullet focuses on a private 1:1 desktop direct-message flow:

- onboarding and invite URI shape
- manual fingerprint confirmation
- OpenMLS message-layer privacy model
- Moss tracker-based discovery model
- diagnostics for native/runtime boundaries

## Friend Test Flow

1. Install and open Mosh on both desktops.
2. One device clicks `Create invite`; Mosh copies a `mosh://invite?...#fp=...` URI.
3. Send that URI to the friend through any existing channel.
4. The friend pastes the URI into `Invite URI` and confirms the fingerprint out of band.
5. Both devices can send messages; receive refresh runs automatically over Moss default/public tracker discovery.

Users should not enter peer hosts, ports, or local listen ports in the primary flow.

## Commands

```powershell
npm install
npm run build
npm test
npm run format
npm run tauri dev
```

## Local Build Cache

- Cargo uses `src-tauri/target` for reusable Rust build artifacts.
- TypeScript writes incremental build metadata into `node_modules/.cache`.
- The first Rust test/build can still take several minutes while Tauri dependencies compile.

## Related Local Sources

- `../moss`: Moss runtime and shared-library source.
- `../mosh-design`: read-only design source material for this app.

Do not commit local Moss shared-library binaries or generated credentials.
