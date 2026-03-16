import type { TrustedPeerRecord } from './appShellSchemas'
import type { PeerSummary } from './schemas'

export type PeerTrustState = 'trusted' | 'new' | 'renamed'

export type TrustedPeerEntry = TrustedPeerRecord & {
  peerId: string
  currentDisplayName?: string
  state: PeerTrustState
}

export function formatPeerFingerprint(peerId: string): string {
  const normalized = peerId.trim()
  if (normalized.length <= 16) {
    return normalized
  }

  return `${normalized.slice(0, 8)}..${normalized.slice(-6)}`
}

export function getPeerTrustState(
  trustedPeers: Record<string, TrustedPeerRecord>,
  peer: Pick<PeerSummary, 'id' | 'displayName' | 'status'>,
): PeerTrustState {
  if (peer.status === 'self') {
    return 'trusted'
  }

  const trustedPeer = trustedPeers[peer.id]
  if (!trustedPeer) {
    return 'new'
  }

  return trustedPeer.displayName === peer.displayName ? 'trusted' : 'renamed'
}

export function trustPeer(
  trustedPeers: Record<string, TrustedPeerRecord>,
  peer: Pick<PeerSummary, 'id' | 'displayName'>,
): Record<string, TrustedPeerRecord> {
  return {
    ...trustedPeers,
    [peer.id]: {
      displayName: peer.displayName,
      approvedAt: new Date().toISOString(),
    },
  }
}

export function untrustPeer(
  trustedPeers: Record<string, TrustedPeerRecord>,
  peerId: string,
): Record<string, TrustedPeerRecord> {
  if (!trustedPeers[peerId]) {
    return trustedPeers
  }

  const { [peerId]: _removed, ...rest } = trustedPeers
  return rest
}

export function listTrustedPeers(
  trustedPeers: Record<string, TrustedPeerRecord>,
  peers: PeerSummary[],
): TrustedPeerEntry[] {
  const currentNames = new Map(peers.map((peer) => [peer.id, peer.displayName] as const))

  return Object.entries(trustedPeers)
    .map(([peerId, record]) => ({
      peerId,
      displayName: record.displayName,
      approvedAt: record.approvedAt,
      currentDisplayName: currentNames.get(peerId),
      state: (currentNames.has(peerId) && currentNames.get(peerId) !== record.displayName
        ? 'renamed'
        : 'trusted') as PeerTrustState,
    }))
    .sort((left, right) => right.approvedAt.localeCompare(left.approvedAt))
}
