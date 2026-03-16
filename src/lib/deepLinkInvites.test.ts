import { describe, expect, it } from 'vitest'

import { buildMeshInvite } from './meshInvite'
import { appendUniqueDeepLinkInvites, extractInviteDeepLinks } from './deepLinkInvites'

describe('deepLinkInvites', () => {
  it('filters unrelated URLs and trims invite links', () => {
    expect(
      extractInviteDeepLinks([
        'https://example.com',
        '  mosh://invite/alpha  ',
        'MOSH://INVITE/beta',
      ]),
    ).toEqual(['mosh://invite/alpha', 'MOSH://INVITE/beta'])
  })

  it('deduplicates repeated invite links', () => {
    expect(
      extractInviteDeepLinks([
        'mosh://invite/alpha',
        'mosh://invite/alpha',
        'mosh://invite/beta',
      ]),
    ).toEqual(['mosh://invite/alpha', 'mosh://invite/beta'])
  })

  it('appends only deep link invites that are not already queued', () => {
    const invite = buildMeshInvite('operator', {
      nickname: 'operator',
      meshId: 'mosh',
      listenPort: 0,
      initialRoom: 'lobby',
      startupPeer: '',
      trackerMode: 'default',
      lanDiscoveryEnabled: true,
    })

    expect(
      appendUniqueDeepLinkInvites(
        [{ sourceUrl: 'mosh://invite/alpha', invite }],
        [
          { sourceUrl: 'mosh://invite/alpha', invite },
          { sourceUrl: 'mosh://invite/beta', invite },
        ],
      ),
    ).toHaveLength(2)
  })
})
