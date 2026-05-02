# Changelog

All notable user-visible changes in this project should be documented in this file.

## Unreleased

- Initialized changelog tracking.
- Added multilingual shell support with system language detection and manual language override in onboarding and settings.
- Rebuilt onboarding into a cinematic multi-step mesh setup flow with splash animation, progress dots, and step-based configuration.
- Fixed MSI startup so the bundled MOSS runtime is resolved before desktop state initialization, removing the manual `moss.dll` setup requirement after install.
- Moved desktop persistence out of WebView `localStorage` into structured files under the app local data directory, with migration for existing preferences, signing identity, and signed chat archives.
- Added a storage tab in settings that shows the live app data layout and exports a portable JSON backup of settings, signing identity, and signed room archives.
- Added backup import and live restore flow in settings so a desktop user can bring settings, identity, and signed archives onto a new machine without manual file copying.
- Added in-room message search with result navigation over the merged live transcript and signed archive history.
- Added embedded file attachments with download cards for non-image files and inline previews for images inside the rich message flow.
- Hardened embedded file attachments so data-URL payloads cannot navigate chat links or open executable MIME types.
- Added pinned messages with persisted room-level pins, hover actions, and a compact pinned strip in the chat header.
- Added global room search with `Ctrl/Cmd+K`, cross-room live message indexing, and signed archive results for quick navigation across MOSH.
- Added local read-state tracking and room mute controls, including unread badges driven by persisted room activity and muted-room suppression for desktop notifications.
- Added a local peer trust registry with trust/revoke actions, trusted/new/name-changed states in the member list, and a dedicated trust tab in settings.
- Added a mesh invite flow for copying the current room/runtime setup and applying incoming `mosh://invite/...` links without manually re-entering mesh settings.
- Reworked desktop packaging so builds now sync `moss` from `origin/main`, bundle the platform runtime into MOSH automatically, and produce cross-platform release artifacts with embedded `MOSS` libraries.
- Expanded CI/release coverage to include Windows ARM64 hosted runners alongside Linux ARM64 and Apple Silicon macOS targets.
- Added desktop deep-link handling for `mosh://invite/...`, so installed builds can open invite links directly into MOSH instead of requiring manual paste/import.
- Added an invite review dialog for deep links, so `mosh://invite/...` now shows inviter/mesh/room details and requires explicit confirmation before MOSH joins.
- Extended mesh invites with inviter fingerprint metadata and added a current-vs-new local identity choice in the invite review flow before joining.
- Added an encrypted identity transfer tool in storage settings so users can move their local signing identity between MOSH devices with a passphrase-protected `mosh-identity://transfer/...` package.
- Added a dedicated identity handoff view with QR rendering, a short verification code, and package preview so device-to-device identity transfer is clearer than a raw textarea alone.
- Added deep-link import for `mosh-identity://transfer/...`, so an installed MOSH client can receive an identity handoff from the OS and finish the import with a passphrase prompt.
- Added trust-aware identity transfer metadata, so handoff and import screens now show the source fingerprint, export time, and a direct current-to-incoming identity replacement summary.
- Added a persisted device handoff history in storage settings, so MOSH now records recent identity exports/imports, the transfer source, replaced fingerprint, and the last accepted handoff on this machine.
- Added identity rollback recovery in storage settings, so MOSH now preserves the previous signing identity before imports, lets users restore it locally, and records rollback events in the device handoff history.
- Added an outgoing message delivery pipeline with optimistic local outbox, failed-send recovery, and `sending / delivered / archived` states in the chat timeline.
- Added persisted per-room draft recovery, so composer content now survives room switches and app restarts, with draft previews visible directly in the conversation sidebar.
- Added local message overlays for your own messages, including per-device edit and hide/restore actions without mutating the underlying signed room history.
- Hardened message search indexing and copy text extraction so untrusted message HTML is never parsed through DOM `innerHTML`.
- Escaped reply quote metadata before reinserting message text into editor HTML, preventing encoded markup from rehydrating in drafts.
- Raised frontend and Tauri dependency minimums to patched versions after npm and RustSec audit review.
