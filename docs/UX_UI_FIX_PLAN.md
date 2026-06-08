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

## Deferred

- `prefers-reduced-motion` was intentionally skipped for now. This is a
  desktop-first app, and higher-impact layout, validation, runtime, and dialog
  problems came first.
- A full demo/mock conversation gateway remains a future improvement. The
  current fallback makes browser preview safe but does not seed fake chats.
