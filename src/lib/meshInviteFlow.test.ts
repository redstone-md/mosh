import { describe, expect, it } from 'vitest'

import { buildMeshInvite } from './meshInvite'
import { buildInviteShellStatePatch, resolveInviteStartupPeer } from './meshInviteFlow'

describe('meshInviteFlow', () => {
  it('merges invite runtime settings into the local draft and focuses the invited room', () => {
    const invite = buildMeshInvite('operator', {
      nickname: 'operator',
      meshId: 'mosh-team',
      listenPort: 9100,
      initialRoom: 'ops',
      startupPeer: 'relay:9000',
      trackerMode: 'default',
      lanDiscoveryEnabled: true,
    })

    expect(
      buildInviteShellStatePatch(
        {
          nickname: 'guest',
          meshId: 'sandbox',
          listenPort: 0,
          initialRoom: 'lobby',
          startupPeer: '',
          trackerMode: 'disabled',
          lanDiscoveryEnabled: false,
        },
        invite
      )
    ).toEqual({
      runtimeDraft: invite.runtime,
      selectedDock: 'group',
      selectedRoomId: 'ops',
    })
  })

  it('returns a startup peer only when the invite points to a different peer', () => {
    const invite = buildMeshInvite('operator', {
      nickname: 'operator',
      meshId: 'mosh-team',
      listenPort: 9100,
      initialRoom: 'ops',
      startupPeer: 'relay:9000',
      trackerMode: 'default',
      lanDiscoveryEnabled: true,
    })

    expect(resolveInviteStartupPeer(invite, 'host:7000')).toBe('relay:9000')
    expect(resolveInviteStartupPeer(invite, 'relay:9000')).toBeNull()
  })
})
