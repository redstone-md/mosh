import { describe, expect, it } from 'vitest'

import { buildMeshInvite, decodeMeshInvite, encodeMeshInvite } from './meshInvite'

describe('meshInvite', () => {
  it('roundtrips invite payloads through the mosh:// scheme', () => {
    const payload = buildMeshInvite('operator', {
      nickname: 'operator',
      meshId: 'mosh-chat',
      listenPort: 0,
      initialRoom: 'lobby',
      startupPeer: 'host:9000',
      trackerMode: 'default',
      lanDiscoveryEnabled: true,
    })

    expect(decodeMeshInvite(encodeMeshInvite(payload))).toEqual(payload)
  })

  it('accepts raw encoded payloads without the URI prefix', () => {
    const payload = buildMeshInvite('operator', {
      nickname: 'operator',
      meshId: 'mosh-chat',
      listenPort: 0,
      initialRoom: 'lobby',
      startupPeer: '',
      trackerMode: 'disabled',
      lanDiscoveryEnabled: false,
    })

    const encoded = encodeMeshInvite(payload).replace('mosh://invite/', '')
    expect(decodeMeshInvite(encoded)).toEqual(payload)
  })

  it('rejects malformed invites', () => {
    expect(() => decodeMeshInvite('mosh://invite/not-real')).toThrow()
  })
})
