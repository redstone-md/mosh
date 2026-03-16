import { useCallback } from 'react'

import { decodeMeshInvite, encodeMeshInvite } from '../lib/meshInvite'
import type { MeshInvitePayload } from '../lib/meshInvite'
import type { RoomSummary, UpdateRuntimeSettingsInput } from '../lib/schemas'

type UseMeshInviteActionsOptions = {
  currentUser: string
  runtimeDraft: UpdateRuntimeSettingsInput
  activeRoom: RoomSummary
  onApplyInvite: (invite: MeshInvitePayload) => Promise<void>
}

export function useMeshInviteActions({
  currentUser,
  runtimeDraft,
  activeRoom,
  onApplyInvite,
}: UseMeshInviteActionsOptions) {
  const inviteCode = encodeMeshInvite({
    version: 1,
    inviterName: currentUser,
    runtime: {
      ...runtimeDraft,
      initialRoom: activeRoom.id,
    },
  })

  const applyInviteCode = useCallback(
    async (value: string) => {
      const invite = decodeMeshInvite(value)
      await onApplyInvite(invite)
    },
    [onApplyInvite],
  )

  return {
    inviteCode,
    applyInviteCode,
  }
}
