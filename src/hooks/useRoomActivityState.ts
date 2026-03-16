import { useEffect, useMemo } from 'react'

import type { Dispatch, SetStateAction } from 'react'
import type { ShellPreferences } from '../lib/appShellSchemas'
import { computeRoomUnreadCounts, isRoomMuted, markRoomAsRead, toggleMutedRoom } from '../lib/roomActivity'
import type { DesktopSnapshot } from '../lib/schemas'

type UseRoomActivityStateOptions = {
  snapshot?: DesktopSnapshot
  selectedRoomId: string
  lastReadMessageIds: Record<string, string>
  mutedRooms: string[]
  setPreferences: Dispatch<SetStateAction<ShellPreferences>>
}

export function useRoomActivityState({
  snapshot,
  selectedRoomId,
  lastReadMessageIds,
  mutedRooms,
  setPreferences,
}: UseRoomActivityStateOptions) {
  const unreadCounts = useMemo(
    () =>
      computeRoomUnreadCounts(
        snapshot?.messages ?? [],
        lastReadMessageIds,
        selectedRoomId,
        snapshot?.settings.nickname ?? '',
      ),
    [lastReadMessageIds, selectedRoomId, snapshot?.messages, snapshot?.settings.nickname],
  )

  useEffect(() => {
    if (!snapshot) {
      return
    }

    setPreferences((current) => {
      const nextLastRead = markRoomAsRead(current.lastReadMessageIds, selectedRoomId, snapshot.messages)
      if (nextLastRead === current.lastReadMessageIds) {
        return current
      }

      return {
        ...current,
        lastReadMessageIds: nextLastRead,
      }
    })
  }, [selectedRoomId, setPreferences, snapshot])

  return {
    unreadCounts,
    mutedRooms,
    isRoomMuted: (roomId: string) => isRoomMuted(mutedRooms, roomId),
    toggleRoomMute: (roomId: string) =>
      setPreferences((current) => ({
        ...current,
        mutedRooms: toggleMutedRoom(current.mutedRooms, roomId),
      })),
  }
}
