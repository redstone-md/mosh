import type { Message } from './schemas'

const MAX_PINNED_MESSAGES_PER_ROOM = 12

export function togglePinnedMessage(
  current: Record<string, string[]>,
  roomId: string,
  messageId: string,
): Record<string, string[]> {
  const roomPins = current[roomId] ?? []

  if (roomPins.includes(messageId)) {
    const nextRoomPins = roomPins.filter((value) => value !== messageId)
    if (nextRoomPins.length === 0) {
      const { [roomId]: _removed, ...rest } = current
      return rest
    }
    return {
      ...current,
      [roomId]: nextRoomPins,
    }
  }

  return {
    ...current,
    [roomId]: [messageId, ...roomPins].slice(0, MAX_PINNED_MESSAGES_PER_ROOM),
  }
}

export function isMessagePinned(
  current: Record<string, string[]>,
  roomId: string,
  messageId: string,
): boolean {
  return (current[roomId] ?? []).includes(messageId)
}

export function resolvePinnedMessages(
  current: Record<string, string[]>,
  roomId: string,
  messages: Message[],
): Message[] {
  const roomPins = current[roomId] ?? []
  if (roomPins.length === 0) {
    return []
  }

  const byId = new Map(messages.map((message) => [message.id, message] as const))
  return roomPins
    .map((messageId) => byId.get(messageId) ?? null)
    .filter((message): message is Message => message !== null)
}
