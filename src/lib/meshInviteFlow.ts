import type { ShellPreferences } from './appShellSchemas'
import type { MeshInvitePayload } from './meshInvite'

type InviteShellStatePatch = Pick<
  ShellPreferences,
  'runtimeDraft' | 'selectedDock' | 'selectedRoomId'
>

export function buildInviteShellStatePatch(
  currentDraft: ShellPreferences['runtimeDraft'],
  invite: MeshInvitePayload,
): InviteShellStatePatch {
  return {
    runtimeDraft: {
      ...currentDraft,
      ...invite.runtime,
    },
    selectedDock: 'group',
    selectedRoomId: invite.runtime.initialRoom,
  }
}

export function resolveInviteStartupPeer(
  invite: MeshInvitePayload,
  activeStartupPeer: string,
): string | null {
  if (!invite.runtime.startupPeer || invite.runtime.startupPeer === activeStartupPeer) {
    return null
  }

  return invite.runtime.startupPeer
}
