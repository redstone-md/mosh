import type { DisplayMessage } from './messageDelivery'
import type { MessageOverlay } from './appShellSchemas'

export function applyMessageOverlays(
  messages: DisplayMessage[],
  overlays: Record<string, MessageOverlay>,
  hiddenLabel: string
): DisplayMessage[] {
  return messages.map((message) => {
    const overlay = roomScopedOverlay(overlays, message.id, message.roomId)
    if (!overlay) {
      return message
    }

    if (overlay.hidden) {
      return {
        ...message,
        body: `<p>${escapeHtml(hiddenLabel)}</p>`,
        overlayState: 'hidden',
      }
    }

    if (overlay.body) {
      return {
        ...message,
        body: overlay.body,
        overlayState: 'edited',
      }
    }

    return message
  })
}

export function upsertEditedMessageOverlay(
  overlays: Record<string, MessageOverlay>,
  messageId: string,
  roomId: string,
  body: string
): Record<string, MessageOverlay> {
  return {
    ...overlays,
    [messageId]: {
      roomId,
      body,
      hidden: false,
      updatedAt: new Date().toISOString(),
    },
  }
}

export function toggleHiddenMessageOverlay(
  overlays: Record<string, MessageOverlay>,
  messageId: string,
  roomId: string
): Record<string, MessageOverlay> {
  const existing = roomScopedOverlay(overlays, messageId, roomId)
  return {
    ...overlays,
    [messageId]: {
      roomId,
      body: existing?.body,
      hidden: !existing?.hidden,
      updatedAt: new Date().toISOString(),
    },
  }
}

export function serializeEditedMessageBody(text: string): string {
  return `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`
}

function roomScopedOverlay(overlays: Record<string, MessageOverlay>, messageId: string, roomId: string) {
  const overlay = overlays[messageId]
  return overlay?.roomId === roomId ? overlay : undefined
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
