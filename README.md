# MOSH

`MOSH` is the standalone desktop chat client for the `MOSS` runtime. The chat app now lives in its own repository and consumes `MOSS` through a Git submodule plus the shared library bridge.

## Repository layout

- `moss/` - `MOSS` Git submodule pinned to a compatible runtime revision
- `src/` - React frontend
- `src-tauri/` - Rust/Tauri desktop backend

## Local setup

```bash
git submodule update --init --recursive
npm install
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
- the local `moss/` submodule directory

To build the runtime from the bundled submodule:

```bash
cd moss
go build -buildmode=c-shared -o ../libmoss.so ./cmd/moss-ffi
```

On Windows:

```powershell
cd moss
go build -buildmode=c-shared -o ..\moss.dll .\cmd\moss-ffi
```

## Release flow

Release artifacts are built only from tags. The release workflow packages:

- the `MOSH` desktop binary
- the matching `MOSS` shared runtime
- the generated C header from `MOSS`

## Desktop contract

Current scope:

- React + Vite frontend
- TanStack Query desktop state synchronization
- Zod validation for runtime setup and invoke payloads
- Rust/Tauri backend with live `libmoss` lifecycle, runtime settings, and diagnostics
- callback-driven rooms, peers, and message history
