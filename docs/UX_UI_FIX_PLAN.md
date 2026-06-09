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
- Extract onboarding, message lists, chat composer, active chat panes, session
  rail, and chat send/attachment orchestration into focused modules.
- Expose stable optional message ids and timestamps from gateway snapshots.
- Group adjacent stamped messages and show compact message timestamps.
- Preserve failed text drafts and provide retry for the latest failed send in
  the active conversation.
- Simplify the compact session rail to icon/avatar/status signals.
- Hide the attachment file input from the accessibility tree while keeping the
  visible attach button accessible.
- Reduce repeated message security chrome to a compact MLS badge.
- Stabilize mobile chat header/topbar ordering.
- Make the mobile diagnostics drawer a full-screen dialog.
- Make the conversation rail fully hidden on mobile until opened as a drawer,
  and expandable on desktop for readable conversation names.

## Deferred

- `prefers-reduced-motion` was intentionally skipped for now. This is a
  desktop-first app, and higher-impact layout, validation, runtime, and dialog
  problems came first.
- Per-message historical delivery status and retry remain deferred until
  gateway snapshots expose stable per-message send status metadata.

## Next Pass Roadmap

1. Continue reducing `private-dm-screen.tsx` size.
   - Extract setup/onboarding orchestration, DM offer orchestration, unread
     notification effects, and voice call orchestration into focused hooks.
   - Keep each new module under 500 lines.
2. Review remaining dense technical surfaces.
   - Peer diagnostics content hierarchy and empty/error states.
   - Mobile composer spacing and attachment/voice affordance density.
3. Keep UX fixes atomic.
   - One visible behavior or one extraction per commit.
   - Verify with `npm run typecheck`, targeted Vitest, and browser smoke checks.
