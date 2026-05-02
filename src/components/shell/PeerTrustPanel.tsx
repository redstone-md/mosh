import type { ReactNode } from 'react'
import { ShieldCheck, ShieldQuestion, ShieldX, Trash2 } from 'lucide-react'

import { formatPeerFingerprint } from '../../lib/peerTrust'
import type { TrustedPeerEntry } from '../../lib/peerTrust'
import { useI18n } from '../I18nProvider'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'

type PeerTrustPanelProps = {
  trustedPeers: TrustedPeerEntry[]
  trustedCount: number
  reviewCount: number
  onForgetPeer: (peerId: string) => void
}

export function PeerTrustPanel({ trustedPeers, trustedCount, reviewCount, onForgetPeer }: PeerTrustPanelProps) {
  const { copy, language } = useI18n()
  const formatter = new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <TrustStatCard
          icon={<ShieldCheck className="h-4 w-4" />}
          title={copy.trust.trustedPeers}
          value={copy.trust.trustedCount(trustedCount)}
        />
        <TrustStatCard
          icon={<ShieldQuestion className="h-4 w-4" />}
          title={copy.trust.reviewQueue}
          value={copy.trust.reviewCount(reviewCount)}
        />
      </div>

      {trustedPeers.length > 0 ? (
        <div className="space-y-2">
          {trustedPeers.map((peer) => (
            <div
              key={peer.peerId}
              className="flex items-start justify-between rounded-md border border-border bg-[var(--panel-strong)] px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{peer.currentDisplayName ?? peer.displayName}</p>
                  <TrustBadge state={peer.state} />
                </div>
                {peer.currentDisplayName && peer.currentDisplayName !== peer.displayName ? (
                  <p className="mt-1 text-xs text-amber-300">{copy.trust.renamedFrom(peer.displayName)}</p>
                ) : null}
                <p className="mt-2 font-mono text-xs text-[var(--muted-foreground)]">
                  {formatPeerFingerprint(peer.peerId)}
                </p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {copy.trust.approvedAt(formatter.format(new Date(peer.approvedAt)))}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => onForgetPeer(peer.peerId)} title={copy.trust.revoke}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4 text-sm text-[var(--muted-foreground)]">
          {copy.trust.noTrustedPeers}
        </div>
      )}
    </section>
  )
}

function TrustStatCard({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">{value}</p>
    </div>
  )
}

export function TrustBadge({ state }: { state: TrustedPeerEntry['state'] }) {
  const { copy } = useI18n()

  if (state === 'trusted') {
    return <Badge variant="default">{copy.trust.trusted}</Badge>
  }

  if (state === 'renamed') {
    return <Badge variant="secondary">{copy.trust.renamed}</Badge>
  }

  return (
    <Badge variant="outline" className="gap-1">
      <ShieldX className="h-3 w-3" />
      {copy.trust.newPeer}
    </Badge>
  )
}
