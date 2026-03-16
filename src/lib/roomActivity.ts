import type { Message } from './schemas'

export function computeRoomUnreadCounts(
  messages: Message[],
  lastReadMessageIds: Record<string, string>,
  selectedRoomId: string,
  nickname: string,
): Record<string, number> {
  const grouped = new Map<string, Message[]>()

  for (const message of messages) {
    const roomMessages = grouped.get(message.roomId)
    if (roomMessages) {
      roomMessages.push(message)
    } else {
      grouped.set(message.roomId, [message])
    }
  }

  const counts: Record<string, number> = {}
  const normalizedNickname = nickname.trim().toLowerCase()

  for (const [roomId, roomMessages] of grouped) {
    if (roomId === selectedRoomId) {
      continue
    }

    const lastReadMessageId = lastReadMessageIds[roomId]
    let seenLastRead = !lastReadMessageId
    let unread = 0

    for (const message of roomMessages) {
      if (lastReadMessageId && message.id === lastReadMessageId) {
        seenLastRead = true
        continue
      }

      if (!seenLastRead || message.emphasis === 'system' || isOwnMessage(message.author, normalizedNickname)) {
        continue
      }

      unread += 1
    }

    if (unread > 0) {
      counts[roomId] = unread
    }
  }

  return counts
}

export function markRoomAsRead(
  current: Record<string, string>,
  roomId: string,
  messages: Message[],
): Record<string, string> {
  const latestMessage = findLatestRoomMessage(messages, roomId)
  if (!latestMessage || current[roomId] === latestMessage.id) {
    return current
  }

  return {
    ...current,
    [roomId]: latestMessage.id,
  }
}

export function toggleMutedRoom(current: string[], roomId: string): string[] {
  if (current.includes(roomId)) {
    return current.filter((value) => value !== roomId)
  }

  return [...current, roomId]
}

export function isRoomMuted(current: string[], roomId: string): boolean {
  return current.includes(roomId)
}

function findLatestRoomMessage(messages: Message[], roomId: string): Message | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.roomId === roomId) {
      return message
    }
  }

  return null
}

function isOwnMessage(author: string, nickname: string): boolean {
  const normalizedAuthor = author.trim().toLowerCase()
  return normalizedAuthor === 'you' || normalizedAuthor === nickname
}
