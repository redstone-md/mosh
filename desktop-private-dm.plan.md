# Desktop Private DM Plan

## Chosen Brainstorm

Reference: `desktop-private-dm.brainstorm.md`

Chosen direction: real desktop tracer bullet with Tauri v2, Vite, React, TypeScript, Rust, selected `../mosh-design` visual direction, Moss dynamic linking, and OpenMLS-oriented private DM boundaries.

## Goal

Create the initial Mosh desktop application foundation and a private 1:1 DM vertical-slice plan that can be implemented safely in small increments.

## Scope

In scope:

- Scaffold a Tauri v2 + Vite + React + TypeScript desktop app in `mosh`.
- Establish frontend, Rust, docs, and test structure.
- Create architecture documentation with Mermaid diagrams.
- Define adapter boundaries for Moss, OpenMLS, secure storage, invite links, and diagnostics.
- Port only the minimum design direction needed for onboarding, invite/fingerprint confirmation, private DM, and diagnostics.

Out of scope:

- Full public rooms implementation.
- Full contacts/address book implementation.
- Production Moss release fetcher automation beyond config structure unless explicitly chosen as a later step.
- Android and iOS implementation.
- Modifying `../moss`, `../mosh-design`, `../quiver`, or `../quiver-design`.

## Constraints

- Follow `AGENTS.md` maintainability limits: 400 LOC per file, 200 LOC per type, 50 LOC per function, max nesting depth 3.
- Keep features vertical and cohesive.
- Avoid implementation string literals by centralizing constants in named modules.
- Use TypeScript contracts for portable protocol orchestration.
- Use Rust/Tauri for native boundary work.
- Keep `../mosh-design` read-only.
- Use Context7 for current framework/library API uncertainty.
- Do not commit secrets, keys, or generated credentials.

## Risks

- Tauri scaffold may choose dependency versions that require updated commands after installation.
- OpenMLS integration may need deeper Rust design before real encrypted message flow is possible.
- Moss dynamic linking requires platform-specific packaging decisions.
- Public trackers expose metadata; the UI must avoid overstating privacy.

## Testing Methodology

Flows to test:

- App shell renders Mosh desktop layout without crashing.
- Onboarding can advance to invite/fingerprint confirmation through public UI interactions.
- Invite URI parsing rejects malformed payloads and accepts valid payload shape.
- Private DM view renders encrypted-state messaging copy and diagnostics state.
- Tauri command contracts return typed results or typed errors.

How tests will run:

- Frontend unit/integration tests through the chosen Vite-compatible runner.
- Rust tests through `cargo test` inside `src-tauri` once scaffolded.
- Build verification through the repo-defined build command once configured.

Quality bar:

- New behaviour has automated tests before or alongside implementation.
- Tests use real public interfaces and avoid mocks/fakes for verification.
- Focused tests pass before broader build/test gates.
- Coverage tooling is added when the test framework exists; until then, test coverage targets remain tracked as a known setup gap.

## Ordered Implementation Plan

### 1. Prepare Documentation Baseline

- [x] Create `desktop-private-dm.brainstorm.md` with options, risks, and chosen direction.
- [x] Create this `desktop-private-dm.plan.md`.
- [x] Create `docs/Architecture.md` with Mermaid diagrams for system boundaries, interface contracts, and key type boundaries.
- [x] Create ADRs for crypto adapter, Moss dynamic linking, and secure storage if implementation begins in those areas.

Verification:

- [x] Confirm docs exist and contain Mermaid diagrams where required.
- [x] Confirm no docs exceed maintainability limits without reason.

### 2. Establish Full-Test Baseline

- [x] Run currently available repo commands.
- [x] Record missing commands as baseline gaps.
- [x] Run `git status --short --branch` and capture pre-scaffold state.

Verification:

- [x] Baseline command outcomes are recorded below.
- [x] Already failing tests are tracked individually below.

### 3. Scaffold Desktop App

- [x] Scaffold Tauri v2 + Vite + React + TypeScript in the repo root without overwriting governance docs.
- [x] Add or update repo commands in `AGENTS.md`: build, test, format.
- [x] Add a `.gitignore` for Node, Rust, Tauri, build outputs, and local Moss shared libraries.
- [x] Keep scaffold files under LOC limits, splitting immediately if needed.

Verification:

- [x] Install/build commands complete or failures are tracked with root-cause notes.
- [x] Tauri frontend renders the initial app shell through `npm run build`.

### 4. Add Design Foundation

- [x] Import selected Mosh tokens into local app CSS without editing `../mosh-design`.
- [x] Create shared UI primitives only when used by the tracer bullet.
- [x] Replace inaccurate “Noise XX end-to-end” copy with OpenMLS-over-Moss language.

Verification:

- [x] UI renders at desktop size through the production frontend build.
- [x] Visual copy accurately distinguishes message E2EE from Moss transport encryption.

### 5. Add Private DM Feature Slice

- [x] Create `src/features/private-dm` with contracts, constants, UI, and tests.
- [x] Add invite URI parser with valid and invalid test coverage.
- [x] Add fingerprint confirmation UI flow with tests.
- [x] Add DM shell with diagnostics panel and encrypted-history placeholder state.

Verification:

- [x] Feature tests cover positive, negative, and edge cases.
- [x] Feature is isolated in its vertical slice.

### 6. Add Native Boundary Contracts

- [x] Create Rust command boundary for app diagnostics and future Moss state.
- [x] Define TypeScript command client around Tauri `invoke`.
- [x] Document Moss/OpenMLS/secure-storage adapter responsibilities.

Verification:

- [x] Rust command tests pass.
- [x] Frontend calls use typed contracts and typed errors.

### 7. Final Validation

- [x] Run format.
- [x] Run build.
- [x] Run focused tests.
- [x] Run broader test suite.
- [x] Run any configured lint/analyzer/coverage commands.
- [x] Review `git diff` for unrelated changes.
- [ ] Commit atomically if all relevant gates pass.

## Baseline Results

- `git status --short --branch`: repository is on `master`; current tracked changes are `AGENTS.md`, `desktop-private-dm.brainstorm.md`, `desktop-private-dm.plan.md`, and `docs/`.
- `package.json`: missing before scaffold.
- `src-tauri/Cargo.toml`: missing before scaffold.
- `.gitignore`: missing before scaffold.
- Toolchain available: Node `v24.11.1`, npm `11.6.2`, cargo `1.93.1`, rustc `1.93.1`.
- `npm create tauri-app@2 -- --help`: succeeded and reported create-tauri-app `2.8.0` with `--manager`, `--template`, and `--yes` flags.
- `npm create tauri-app@2 . -- --manager npm --template react-ts --yes`: failed because the repository root is not empty.
- `npm create tauri-app@latest -- --help`: succeeded and reported create-tauri-app `4.6.2` with `--tauri-version 2`, `--identifier`, and `--force` flags.
- `npm create tauri-app@latest mosh-scaffold-v2 -- --manager npm --template react-ts --identifier app.mosh.desktop --tauri-version 2 --yes`: succeeded in `.codex`; selected files were copied into the repository root.
- `npm install`: succeeded and generated `package-lock.json`.
- `npm run build`: succeeded after scaffold.
- `npm test`: timed out during the first Rust/Tauri dependency compilation; rerun with a longer timeout is required.
- `npm run format`: succeeded after scaffold.
- Local cache added: Cargo uses `src-tauri/target`; TypeScript build info is stored under `node_modules/.cache`.
- `cargo test --manifest-path src-tauri/Cargo.toml`: succeeded after first compilation with 1 Rust unit test passing.
- `npm test`: succeeded after cache warmup; TypeScript typecheck and Rust unit tests pass.
- `npm run build`: succeeded after cache changes.
- `npm run format`: succeeded after cache changes.
- Dependencies approved and added: `@tabler/icons-react`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, and `@testing-library/user-event`.
- `npm test`: succeeded with TypeScript typecheck, 10 frontend tests, and 1 Rust unit test.
- `npm run build`: succeeded after the Mosh design transfer pass.
- `npm run format`: succeeded after the Mosh design transfer pass.
- Vite dev server was started for visual spot-check setup and then stopped; port `1420` is free.
- Build/test/format commands are now configured in `package.json` and `AGENTS.md`.

## Already Failing Tests

None recorded.

## Final Validation Skills And Commands

- Documentation review: confirm required Mermaid diagrams and canonical docs exist.
- UI/UX review: confirm selected screens align with `../mosh-design` without overbuilding.
- Security review: confirm wording and boundaries do not overclaim privacy or store secrets unsafely.
- Source control review: confirm only Mosh repo files changed and commit is atomic.

Commands will be finalized after the scaffold establishes package scripts and Rust commands.
