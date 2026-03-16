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
- Added pinned messages with persisted room-level pins, hover actions, and a compact pinned strip in the chat header.
- Added global room search with `Ctrl/Cmd+K`, cross-room live message indexing, and signed archive results for quick navigation across MOSH.
