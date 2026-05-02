import { useEffect, useState } from 'react'

import type { SigningIdentity, StoredMessage, TrustedPeerRecord } from '../lib/appShellSchemas'
import type { Message, SecretMessageEvent } from '../lib/schemas'
import {
  decryptOwnSecretMessage,
  decryptSecretMessage,
  parseSecretEnvelope,
  secretRoomName,
} from '../lib/secretMessages'

type UseSecretRoomMessagesOptions = {
  roomId: string
  events: SecretMessageEvent[]
  peersById: Map<string, { displayName: string }>
  trustedPeers: Record<string, TrustedPeerRecord>
  localPeerId: string
  localDisplayName: string
  identity: SigningIdentity | null
  archiveMessages: StoredMessage[]
  unlocked: boolean
  decryptErrorMessage: string
}

export function useSecretRoomMessages({
  roomId,
  events,
  peersById,
  trustedPeers,
  localPeerId,
  localDisplayName,
  identity,
  archiveMessages,
  unlocked,
  decryptErrorMessage,
}: UseSecretRoomMessagesOptions) {
  const [messages, setMessages] = useState<Message[]>(archiveMessages)

  useEffect(() => {
    let cancelled = false

    async function decryptEvents() {
      if (!unlocked || !identity || !localPeerId || !roomId.startsWith('secret-dm-')) {
        setMessages([])
        return
      }

      const decrypted = [...archiveMessages]
      for (const event of events.filter((candidate) => candidate.roomId === roomId)) {
        if (decrypted.some((message) => message.id === event.id)) {
          continue
        }
        try {
          const envelope = parseSecretEnvelope(event.payloadJson)
          const remotePeerId = envelope.senderPeerId === localPeerId ? envelope.recipientPeerId : envelope.senderPeerId
          const trusted = trustedPeers[remotePeerId]
          if (!trusted) {
            continue
          }
          const body =
            envelope.senderPeerId === localPeerId
              ? await decryptOwnSecretMessage({
                  envelope,
                  localPeerId,
                  localIdentity: identity,
                  recipient: trusted,
                })
              : await decryptSecretMessage({
                  envelope,
                  localPeerId,
                  localIdentity: identity,
                  sender: trusted,
                })
          decrypted.push({
            id: event.id,
            roomId,
            author:
              envelope.senderPeerId === localPeerId
                ? localDisplayName
                : (peersById.get(envelope.senderPeerId)?.displayName ?? envelope.senderPeerId),
            body,
            timestamp: envelope.sentAt,
            emphasis: 'normal',
            storedAt: new Date().toISOString(),
          })
        } catch {
          decrypted.push({
            id: `${event.id}-error`,
            roomId,
            author: 'System',
            body: decryptErrorMessage,
            timestamp: event.receivedAt,
            emphasis: 'system',
            storedAt: new Date().toISOString(),
          })
        }
      }

      if (!cancelled) {
        setMessages(dedupeSecretMessages(decrypted))
      }
    }

    void decryptEvents()
    return () => {
      cancelled = true
    }
  }, [
    archiveMessages,
    decryptErrorMessage,
    events,
    identity,
    localDisplayName,
    localPeerId,
    peersById,
    roomId,
    trustedPeers,
    unlocked,
  ])

  return messages
}

export function findSecretPeerForRoom(roomId: string, localPeerId: string, peerIds: string[]): string | null {
  return peerIds.find((peerId) => secretRoomName(localPeerId, peerId) === roomId) ?? null
}

function dedupeSecretMessages(messages: StoredMessage[]): StoredMessage[] {
  const byId = new Map<string, StoredMessage>()
  for (const message of messages) {
    byId.set(message.id, message)
  }
  return [...byId.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp))
}
