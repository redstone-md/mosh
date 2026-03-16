import { useCallback, useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { ShellPreferences } from '../lib/appShellSchemas'
import { getRoomDraftPreview, setRoomDraftValue } from '../lib/roomDrafts'

type UseRoomDraftStateOptions = {
  roomDrafts: ShellPreferences['roomDrafts']
  setPreferences: Dispatch<SetStateAction<ShellPreferences>>
}

export function useRoomDraftState({ roomDrafts, setPreferences }: UseRoomDraftStateOptions) {
  const draftPreviews = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(roomDrafts)
          .map(([roomId, value]) => [roomId, getRoomDraftPreview(value)] as const)
          .filter((entry) => entry[1].length > 0),
      ),
    [roomDrafts],
  )

  const setDraft = useCallback(
    (roomId: string, value: string) => {
      setPreferences((current) => ({
        ...current,
        roomDrafts: setRoomDraftValue(current.roomDrafts, roomId, value),
      }))
    },
    [setPreferences],
  )

  const clearDraft = useCallback(
    (roomId: string) => {
      setPreferences((current) => ({
        ...current,
        roomDrafts: setRoomDraftValue(current.roomDrafts, roomId, ''),
      }))
    },
    [setPreferences],
  )

  return {
    roomDrafts,
    draftPreviews,
    getDraft: (roomId: string) => roomDrafts[roomId] ?? '',
    setDraft,
    clearDraft,
  }
}
