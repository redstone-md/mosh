import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useState } from 'react'
import toast from 'react-hot-toast'

import { useDeepLinkInvites } from './useDeepLinkInvites'
import { sameRuntimeDraft } from '../lib/appShellSelectors'
import { buildInviteShellStatePatch, resolveInviteStartupPeer } from '../lib/meshInviteFlow'
import type { MeshInvitePayload } from '../lib/meshInvite'
import type { ShellPreferences } from '../lib/appShellSchemas'
import type { DesktopSnapshot } from '../lib/schemas'
import type { PendingDeepLinkInvite } from '../lib/deepLinkInvites'

type SnapshotMutation = {
  mutateAsync: (value: any) => Promise<DesktopSnapshot>
}

type InviteFlowOptions = {
  copy: {
    inviteApplied: string
    inviteInvalid: string
  }
  data?: DesktopSnapshot
  runtimeDraft: ShellPreferences['runtimeDraft']
  setPreferences: Dispatch<SetStateAction<ShellPreferences>>
  updateRuntimeSettings: SnapshotMutation
  connectPeer: SnapshotMutation
  subscribeRoom: SnapshotMutation
}

export function useInviteFlow({
  copy,
  data,
  runtimeDraft,
  setPreferences,
  updateRuntimeSettings,
  connectPeer,
  subscribeRoom,
}: InviteFlowOptions) {
  const [reviewPending, setReviewPending] = useState(false)
  const { pendingInvite, dismissPendingInvite } = useDeepLinkInvites({
    invalidMessage: copy.inviteInvalid,
  })

  const applyInvite = useCallback(
    async (invite: MeshInvitePayload) => {
      const invitePatch = buildInviteShellStatePatch(runtimeDraft, invite)

      setPreferences((current) => ({
        ...current,
        ...invitePatch,
      }))

      if (!data || data.runtime.state !== 'Runtime online') {
        return
      }

      const updatedSnapshot = sameRuntimeDraft(data.settings, invitePatch.runtimeDraft)
        ? data
        : await updateRuntimeSettings.mutateAsync(invitePatch.runtimeDraft)

      const startupPeer = resolveInviteStartupPeer(invite, updatedSnapshot.settings.startupPeer)
      if (startupPeer) {
        await connectPeer.mutateAsync(startupPeer)
      }

      await subscribeRoom.mutateAsync(invite.runtime.initialRoom)
    },
    [connectPeer, data, runtimeDraft, setPreferences, subscribeRoom, updateRuntimeSettings],
  )

  const approvePendingInvite = useCallback(async () => {
    if (!pendingInvite) {
      return
    }

    setReviewPending(true)

    try {
      await applyInvite(pendingInvite.invite)
      toast.success(copy.inviteApplied)
      dismissPendingInvite()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.inviteInvalid)
    } finally {
      setReviewPending(false)
    }
  }, [applyInvite, copy.inviteApplied, copy.inviteInvalid, dismissPendingInvite, pendingInvite])

  return {
    pendingInvite: pendingInvite as PendingDeepLinkInvite | null,
    reviewPending,
    applyInvite,
    approvePendingInvite,
    dismissPendingInvite,
  }
}
