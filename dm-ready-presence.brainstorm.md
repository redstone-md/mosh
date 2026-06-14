# DM Ready Presence Brainstorm

## Problem

After restart, a restored DM can show `MLS ready` before Moss has a live peer connection. Because the composer can become enabled too early, locally sent messages can be appended before transport is established. The notification path also treats any message-count increase as a new inbound message, so an own optimistic message can trigger a "new message" notification.

## Evidence

- `PrivateDmSession::state` currently depends on `peer_joined && crypto.is_ready()`.
- `peer_joined` was recently restored from inbound history. That proves the peer was in the MLS session at some point, not that Moss has a live peer now.
- `send_message` appends the local message optimistically before publish outcome is known.
- `useUnreadNotifications` passes `session.messages.length`, so own outbound messages count as notification-worthy growth.

## Decision

- Keep restored inbound history as peer/MLS evidence, but make DM `ready` require live Moss peer telemetry.
- Count only messages from other devices for unread badges and OS notifications.

## Out Of Scope

- Changing Moss discovery or relay behavior.
- Adding a separate UI state store.
- Moving the `v0.2.7` tag.
