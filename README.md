# MOSH

`MOSH` is the standalone desktop chat client for the `MOSS` runtime. The chat app now lives in its own repository and consumes `MOSS` through a Git submodule plus the shared library bridge.

## Repository layout

- `moss/` - `MOSS` Git submodule tracked against `origin/main`
- `src/` - React frontend
- `src-tauri/` - Rust/Tauri desktop backend

## Local setup

```bash
git submodule update --init --recursive
npm install
```

## Desktop build flow

MOSH now prepares the bundled runtime automatically before desktop builds:

1. sync `moss/` to the latest `origin/main`
2. build the platform-specific shared runtime from `moss`
3. attach the runtime into `src-tauri/resources/moss`
4. build and bundle the Tauri desktop app

Local commands:

```bash
npm run desktop:prepare
npm run tauri:build
```

## Build the frontend

```bash
npm run build
```

## Run the desktop app in development

The app uses Tauri v2. You need Node.js, Bun or npm, and a configured Rust toolchain.

```bash
git submodule update --init --recursive
npm install
npm run tauri:dev
```

## Shared runtime resolution

The desktop backend loads the `MOSS` shared runtime dynamically. It checks:

- `MOSS_SHARED_PATH`
- the desktop executable directory
- the current working directory
- `src-tauri/resources/moss/`
- the local `moss/` submodule directory

To build and attach the runtime from the bundled submodule:

```bash
npm run moss:bundle
```

## Release flow

Release artifacts are built only from tags. The release workflow packages:

- bundled MOSH installers/packages with the matching `MOSS` runtime already embedded
- build artifacts for Linux x64/arm64, Windows x64/arm64, macOS Intel, and macOS Apple Silicon

## Deep links

MOSH now registers the `mosh://` scheme for desktop builds and can ingest invite links such as:

```text
mosh://invite/<encoded-payload>
```

Installed builds handle the scheme via the Tauri deep-link plugin, and development builds register it at runtime on Windows and Linux.

## Desktop contract

Current scope:

- React + Vite frontend
- TanStack Query desktop state synchronization
- Zod validation for runtime setup and invoke payloads
- Rust/Tauri backend with live `libmoss` lifecycle, runtime settings, and diagnostics
- callback-driven rooms, peers, and message history
