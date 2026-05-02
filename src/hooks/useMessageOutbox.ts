import { useCallback, useEffect, useRef, useState } from 'react'

import type { Message } from '../lib/schemas'
import {
  createPendingOutgoingMessage,
  decorateMessagesWithDeliveryState,
  failPendingOutgoingMessage,
  removePendingOutgoingMessage,
  resolvePendingOutgoingMessages,
  retryPendingOutgoingMessage,
  type DisplayMessage,
  type PendingOutgoingMessage,
} from '../lib/messageDelivery'

type UseMessageOutboxOptions = {
  currentUser: string
  liveMessages: Message[]
  publishMessage: (roomId: string, body: string) => Promise<void>
}

export function useMessageOutbox({ currentUser, liveMessages, publishMessage }: UseMessageOutboxOptions) {
  const [pendingMessages, setPendingMessages] = useState<PendingOutgoingMessage[]>([])
  const pendingMessagesRef = useRef(pendingMessages)
  pendingMessagesRef.current = pendingMessages

  useEffect(() => {
    setPendingMessages((current) => resolvePendingOutgoingMessages(current, liveMessages))
  }, [liveMessages])

  const sendMessage = useCallback(
    async (roomId: string, body: string) => {
      const pendingMessage = createPendingOutgoingMessage(roomId, currentUser, body, liveMessages)
      setPendingMessages((current) => [...current, pendingMessage])

      try {
        await publishMessage(roomId, body)
      } catch (error) {
        setPendingMessages((current) => failPendingOutgoingMessage(current, pendingMessage.clientId))
        throw error
      }
    },
    [currentUser, liveMessages, publishMessage]
  )

  const retryMessage = useCallback(
    async (clientId: string) => {
      const pendingMessage = pendingMessagesRef.current.find((message) => message.clientId === clientId)
      if (!pendingMessage) {
        return
      }

      setPendingMessages((current) => retryPendingOutgoingMessage(current, clientId, liveMessages))
      try {
        await publishMessage(pendingMessage.roomId, pendingMessage.body)
      } catch (error) {
        setPendingMessages((current) => failPendingOutgoingMessage(current, clientId))
        throw error
      }
    },
    [liveMessages, publishMessage]
  )

  const dismissMessage = useCallback(
    (clientId: string) => setPendingMessages((current) => removePendingOutgoingMessage(current, clientId)),
    []
  )

  const buildDisplayMessages = useCallback(
    (roomId: string, messages: Message[], archivedMessageIds: string[]): DisplayMessage[] =>
      decorateMessagesWithDeliveryState(
        messages,
        pendingMessages.filter((message) => message.roomId === roomId),
        currentUser,
        archivedMessageIds
      ),
    [currentUser, pendingMessages]
  )

  return {
    pendingMessages,
    sendMessage,
    retryMessage,
    dismissMessage,
    buildDisplayMessages,
  }
}
