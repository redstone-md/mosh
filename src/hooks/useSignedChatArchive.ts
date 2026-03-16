import { useEffect, useMemo, useRef, useState } from 'react'

import {
  mergeArchivedMessages,
  persistSignedArchive,
  readVerifiedArchive,
  type VerifiedArchive,
} from '../lib/appShellStorage'
import type { Message } from '../lib/schemas'

type ArchiveState = {
  archive: VerifiedArchive | null
  mergedMessages: Message[]
}

export function useSignedChatArchive(roomId: string, liveMessages: Message[], refreshToken = 0) {
  const [archiveState, setArchiveState] = useState<ArchiveState>({
    archive: null,
    mergedMessages: liveMessages,
  })
  const lastSerializedRef = useRef<string>('')
  const liveMessagesKey = useMemo(
    () =>
      JSON.stringify(
        liveMessages.map((message) => ({
          id: message.id,
          roomId: message.roomId,
          author: message.author,
          body: message.body,
          timestamp: message.timestamp,
          emphasis: message.emphasis,
        })),
      ),
    [liveMessages],
  )

  useEffect(() => {
    let cancelled = false

    async function loadArchive() {
      const archive = await readVerifiedArchive(roomId)
      if (cancelled) {
        return
      }

      setArchiveState({
        archive,
        mergedMessages: mergeArchivedMessages(archive?.messages ?? [], liveMessages),
      })
    }

    void loadArchive()

    return () => {
      cancelled = true
    }
  }, [liveMessagesKey, refreshToken, roomId])

  const serializedMessages = useMemo(
    () =>
      JSON.stringify(
        archiveState.mergedMessages.map((message) => ({
          id: message.id,
          roomId: message.roomId,
          author: message.author,
          body: message.body,
          timestamp: message.timestamp,
          emphasis: message.emphasis,
        })),
      ),
    [archiveState.mergedMessages],
  )

  useEffect(() => {
    if (archiveState.mergedMessages.length === 0 || serializedMessages === lastSerializedRef.current) {
      return
    }
    lastSerializedRef.current = serializedMessages

    let cancelled = false

    async function persist() {
      const archive = await persistSignedArchive(roomId, archiveState.mergedMessages)
      if (!cancelled) {
        setArchiveState((current) => ({
          archive,
          mergedMessages: current.mergedMessages,
        }))
      }
    }

    void persist()

    return () => {
      cancelled = true
    }
  }, [archiveState.mergedMessages, refreshToken, roomId, serializedMessages])

  return archiveState
}
