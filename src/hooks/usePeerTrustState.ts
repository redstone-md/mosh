import { useMemo } from 'react'

import type { Dispatch, SetStateAction } from 'react'
import type { ShellPreferences, TrustedPeerRecord } from '../lib/appShellSchemas'
import { getPeerTrustState, listTrustedPeers, trustPeer, untrustPeer } from '../lib/peerTrust'
import type { PeerSummary } from '../lib/schemas'

type UsePeerTrustStateOptions = {
  peers: PeerSummary[]
  trustedPeers: Record<string, TrustedPeerRecord>
  setPreferences: Dispatch<SetStateAction<ShellPreferences>>
}

export function usePeerTrustState({ peers, trustedPeers, setPreferences }: UsePeerTrustStateOptions) {
  const trustByPeerId = useMemo(
    () => Object.fromEntries(peers.map((peer) => [peer.id, getPeerTrustState(trustedPeers, peer)] as const)),
    [peers, trustedPeers]
  )
  const trustedPeerEntries = useMemo(() => listTrustedPeers(trustedPeers, peers), [peers, trustedPeers])

  return {
    trustByPeerId,
    trustedPeerEntries,
    trustedCount: trustedPeerEntries.length,
    reviewCount: peers.filter((peer) => peer.status !== 'self' && trustByPeerId[peer.id] !== 'trusted').length,
    togglePeerTrust: (peer: PeerSummary) =>
      setPreferences((current) => ({
        ...current,
        trustedPeers: current.trustedPeers[peer.id]
          ? untrustPeer(current.trustedPeers, peer.id)
          : trustPeer(current.trustedPeers, peer),
      })),
    removeTrustedPeer: (peerId: string) =>
      setPreferences((current) => ({
        ...current,
        trustedPeers: untrustPeer(current.trustedPeers, peerId),
      })),
  }
}
