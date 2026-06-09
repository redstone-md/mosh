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
- Add a browser demo gateway with seeded DM, group, channel, attachment, and
  call-event examples.
- Show specific invite validation feedback and confirm group invite copy actions.
- Surface active-chat send failures inline and show an explicit sending state in
  the composer.
- Add active conversation text search and an attachments-only filter.
- Extract conversation search/filter controls out of `private-dm-screen.tsx`.

## Deferred

- `prefers-reduced-motion` was intentionally skipped for now. This is a
  desktop-first app, and higher-impact layout, validation, runtime, and dialog
  problems came first.
- Message timestamps, grouped adjacent messages, and per-message retry remain
  deferred until gateway snapshots expose stable message ids and time metadata.

## Next Pass Roadmap

1. Continue reducing `private-dm-screen.tsx` size.
   - Extract onboarding, diagnostics, chat action orchestration, and message
     lists into focused modules.
   - Keep each new module under 500 lines.
