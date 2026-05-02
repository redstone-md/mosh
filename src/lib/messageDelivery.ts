import type { Message } from './schemas'

export type DeliveryState = 'sending' | 'delivered' | 'archived' | 'failed'

export type PendingOutgoingMessage = Message & {
  clientId: string
  queuedAt: string
  baselineMessageIds: string[]
  deliveryState: 'sending' | 'failed'
}

export type DisplayMessage = Message & {
  pendingClientId?: string
  deliveryState?: DeliveryState
  overlayState?: 'edited' | 'hidden'
}

export function createPendingOutgoingMessage(
  roomId: string,
  author: string,
  body: string,
  liveMessages: Message[]
): PendingOutgoingMessage {
  const queuedAt = new Date().toISOString()
  return {
    id: `pending:${queuedAt}:${Math.random().toString(36).slice(2, 8)}`,
    clientId: `pending:${queuedAt}:${Math.random().toString(36).slice(2, 8)}`,
    roomId,
    author,
    body,
    timestamp: formatPendingTimestamp(queuedAt),
    emphasis: 'default',
    queuedAt,
    baselineMessageIds: liveMessages.filter((message) => message.roomId === roomId).map((message) => message.id),
    deliveryState: 'sending',
  }
}

export function resolvePendingOutgoingMessages(
  pendingMessages: PendingOutgoingMessage[],
  liveMessages: Message[]
): PendingOutgoingMessage[] {
  const usedLiveIds = new Set<string>()

  return pendingMessages.filter((pendingMessage) => {
    if (pendingMessage.deliveryState === 'failed') {
      return true
    }

    const matchedMessage = liveMessages.find(
      (message) =>
        !usedLiveIds.has(message.id) &&
        !pendingMessage.baselineMessageIds.includes(message.id) &&
        message.roomId === pendingMessage.roomId &&
        normalizeAuthor(message.author) === normalizeAuthor(pendingMessage.author) &&
        message.body === pendingMessage.body
    )

    if (!matchedMessage) {
      return true
    }

    usedLiveIds.add(matchedMessage.id)
    return false
  })
}

export function decorateMessagesWithDeliveryState(
  messages: Message[],
  pendingMessages: PendingOutgoingMessage[],
  currentUser: string,
  archivedMessageIds: string[]
): DisplayMessage[] {
  const archivedIds = new Set(archivedMessageIds)
  const normalizedCurrentUser = normalizeAuthor(currentUser)
  const deliveredMessages: DisplayMessage[] = messages.map((message) => ({
    ...message,
    deliveryState:
      normalizeAuthor(message.author) === normalizedCurrentUser
        ? archivedIds.has(message.id)
          ? 'archived'
          : 'delivered'
        : undefined,
  }))
  const optimisticMessages: DisplayMessage[] = pendingMessages.map((message) => ({
    id: message.id,
    roomId: message.roomId,
    author: message.author,
    body: message.body,
    timestamp: message.timestamp,
    emphasis: message.emphasis,
    pendingClientId: message.clientId,
    deliveryState: message.deliveryState,
  }))

  return [...deliveredMessages, ...optimisticMessages]
}

export function retryPendingOutgoingMessage(
  pendingMessages: PendingOutgoingMessage[],
  clientId: string,
  liveMessages: Message[]
): PendingOutgoingMessage[] {
  return pendingMessages.map((pendingMessage) =>
    pendingMessage.clientId === clientId
      ? {
          ...pendingMessage,
          queuedAt: new Date().toISOString(),
          timestamp: formatPendingTimestamp(new Date().toISOString()),
          baselineMessageIds: liveMessages
            .filter((message) => message.roomId === pendingMessage.roomId)
            .map((message) => message.id),
          deliveryState: 'sending',
        }
      : pendingMessage
  )
}

export function failPendingOutgoingMessage(
  pendingMessages: PendingOutgoingMessage[],
  clientId: string
): PendingOutgoingMessage[] {
  return pendingMessages.map((pendingMessage) =>
    pendingMessage.clientId === clientId ? { ...pendingMessage, deliveryState: 'failed' } : pendingMessage
  )
}

export function removePendingOutgoingMessage(
  pendingMessages: PendingOutgoingMessage[],
  clientId: string
): PendingOutgoingMessage[] {
  return pendingMessages.filter((pendingMessage) => pendingMessage.clientId !== clientId)
}

function formatPendingTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function normalizeAuthor(value: string) {
  return value.trim().toLowerCase()
}
