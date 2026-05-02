import { describe, expect, it, vi } from 'vitest'

import {
  formatPeerApprovedAt,
  formatPeerFingerprint,
  getPeerTrustState,
  listTrustedPeers,
  trustPeer,
  untrustPeer,
} from './peerTrust'
import type { PeerSummary } from './schemas'

const peer: PeerSummary = {
  id: '1234567890abcdef1234567890abcdef',
  displayName: 'operator',
  route: 'connected peer',
  latency: 'live',
  status: 'connected',
  rooms: ['#lobby'],
}

describe('peerTrust', () => {
  it('formats long peer ids into a readable fingerprint', () => {
    expect(formatPeerFingerprint(peer.id)).toBe('12345678..abcdef')
  })

  it('returns null instead of throwing for invalid approval timestamps', () => {
    const formatter = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })

    expect(formatPeerApprovedAt('not-a-date', formatter)).toBeNull()
    expect(formatPeerApprovedAt('2026-03-16T10:00:00.000Z', formatter)).toContain('2026')
  })

  it('tracks trusted, new, and renamed peers', () => {
    const trusted = {
      [peer.id]: {
        displayName: 'operator',
        approvedAt: '2026-03-16T10:00:00.000Z',
      },
    }

    expect(getPeerTrustState({}, peer)).toBe('new')
    expect(getPeerTrustState(trusted, peer)).toBe('trusted')
    expect(getPeerTrustState(trusted, { ...peer, displayName: 'renamed' })).toBe('renamed')
  })

  it('adds and removes trusted peers', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-16T10:00:00.000Z'))

    const trusted = trustPeer({}, peer)
    expect(trusted[peer.id]?.approvedAt).toBe('2026-03-16T10:00:00.000Z')
    expect(untrustPeer(trusted, peer.id)).toEqual({})

    vi.useRealTimers()
  })

  it('lists trusted peers with renamed state when the live name changed', () => {
    expect(
      listTrustedPeers(
        {
          [peer.id]: {
            displayName: 'operator',
            approvedAt: '2026-03-16T10:00:00.000Z',
          },
        },
        [{ ...peer, displayName: 'relay-operator' }]
      )[0]?.state
    ).toBe('renamed')
  })
})
