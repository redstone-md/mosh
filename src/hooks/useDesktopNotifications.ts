import { useEffect, useRef } from 'react'
import { formatRoomTitle } from '../lib/chatPresentation'
import { readDesktopWindowState } from '../lib/desktopWindow'
import type { DesktopSnapshot } from '../lib/schemas'
import { notifyDesktop } from '../lib/desktopNotifications'

type UseDesktopNotificationsOptions = {
  snapshot?: DesktopSnapshot
  selectedRoomId: string
}

export function useDesktopNotifications({
  snapshot,
  selectedRoomId,
}: UseDesktopNotificationsOptions) {
  const seenMessageIds = useRef<Set<string>>(new Set())
  const hydrated = useRef(false)

  useEffect(() => {
    if (!snapshot) {
      return
    }

    if (!hydrated.current) {
      for (const message of snapshot.messages) {
        seenMessageIds.current.add(message.id)
      }
      hydrated.current = true
      return
    }

    const freshMessages = snapshot.messages.filter((message) => !seenMessageIds.current.has(message.id))
    for (const message of freshMessages) {
      seenMessageIds.current.add(message.id)
    }

    if (freshMessages.length === 0) {
      return
    }

    const nickname = snapshot.settings.nickname.trim().toLowerCase()
    const roomsById = new Map(snapshot.rooms.map((room) => [room.id, room]))
    let cancelled = false

    void (async () => {
      const windowState = await readDesktopWindowState().catch(() => ({
        focused: false,
        visible: false,
      }))

      for (const message of freshMessages) {
        if (cancelled) {
          return
        }

        if (message.emphasis === 'system') {
          continue
        }

        const author = message.author.trim().toLowerCase()
        if (author === 'you' || author === nickname) {
          continue
        }

        const room = roomsById.get(message.roomId)
        const mention = message.body.toLowerCase().includes(`@${nickname}`)
        const directRoom = message.roomId.startsWith('dm-') || room?.kind === 'dm'
        const activeVisibleRoom =
          windowState.focused && windowState.visible && message.roomId === selectedRoomId

        if (activeVisibleRoom && !mention) {
          continue
        }

        const title = mention
          ? `Mention from ${message.author}`
          : directRoom
            ? `Direct message from ${message.author}`
            : `New message in ${formatRoomTitle(room)}`
        await notifyDesktop(title, message.body)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedRoomId, snapshot])
}
