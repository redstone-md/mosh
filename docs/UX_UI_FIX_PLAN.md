# UX/UI Fix Plan

## Completed

- Hide the peer diagnostics panel on narrow windows so it does not collapse into
  the session rail.
- Validate DM and group invite links before showing the join action as ready.
- Use a browser-safe native gateway fallback so Vite preview shows readable
  runtime guidance instead of raw Tauri `invoke` errors.
- Scope pending UI state by operation type: setup, message, transfer, session,
  offer, and refresh.
- Add modal keyboard basics: initial focus, Escape handling, Tab loop, and focus
  restoration for media and call dialogs.
- Replace destructive browser confirmation with an in-app confirmation dialog.
- Move peer diagnostics into an on-demand drawer opened from the titlebar.

## Deferred

- `prefers-reduced-motion` was intentionally skipped for now. This is a
  desktop-first app, and higher-impact layout, validation, runtime, and dialog
  problems came first.
- A full demo/mock conversation gateway remains a future improvement. The
  current fallback makes browser preview safe but does not seed fake chats.

## Next Pass Roadmap

1. Add a browser demo gateway.
   - Seed realistic DM, group, channel, attachment, and call-event examples.
   - Keep it separate from the Tauri gateway so native behavior stays isolated.
2. Improve invite UX.
   - Map invite parser errors to specific inline copy.
   - Add clearer copy feedback for copied group invites.
   - Consider QR invite export once the text flow is solid.
3. Improve message UX.
   - Add timestamps once message snapshots expose stable time metadata.
   - Add sending/failed/retry states where gateway results can support it.
   - Group adjacent messages by sender/time after timestamp data exists.
4. Add search and media filtering.
   - Text search first.
   - Media/attachments filter second.
5. Reduce `private-dm-screen.tsx` size.
   - Extract onboarding, diagnostics, chat action orchestration, and message
     lists into focused modules.
   - Keep each new module under 500 lines.
