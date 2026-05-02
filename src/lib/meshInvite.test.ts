import { describe, expect, it } from 'vitest'

import { buildMeshInvite, decodeMeshInvite, encodeMeshInvite } from './meshInvite'

describe('meshInvite', () => {
  it('roundtrips invite payloads through the mosh:// scheme', () => {
    const payload = buildMeshInvite(
      'operator',
      {
        nickname: 'operator',
        meshId: 'mosh-chat',
        listenPort: 0,
        initialRoom: 'lobby',
        startupPeer: 'host:9000',
        trackerMode: 'default',
        lanDiscoveryEnabled: true,
      },
      'ab:cd:ef:12:34:56'
    )

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

  it('keeps working when invites do not include a fingerprint', () => {
    const encoded = encodeMeshInvite({
      version: 1,
      inviterName: 'operator',
      runtime: {
        nickname: 'operator',
        meshId: 'mosh-chat',
        listenPort: 0,
        initialRoom: 'lobby',
        startupPeer: '',
        trackerMode: 'default',
        lanDiscoveryEnabled: true,
      },
    })

    expect(decodeMeshInvite(encoded).inviterFingerprint).toBeUndefined()
  })

  it('omits a blank inviter fingerprint while identity is loading', () => {
    const encoded = encodeMeshInvite({
      version: 1,
      inviterName: 'operator',
      inviterFingerprint: '',
      runtime: {
        nickname: 'operator',
        meshId: 'mosh-chat',
        listenPort: 0,
        initialRoom: 'lobby',
        startupPeer: '',
        trackerMode: 'default',
        lanDiscoveryEnabled: true,
      },
    })

    expect(decodeMeshInvite(encoded).inviterFingerprint).toBeUndefined()
  })
})
