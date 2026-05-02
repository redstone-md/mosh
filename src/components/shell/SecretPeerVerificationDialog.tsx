import { Fingerprint, LockKeyhole } from 'lucide-react'

import type { PeerSummary } from '../../lib/schemas'
import { formatPeerFingerprint } from '../../lib/peerTrust'
import { useI18n } from '../I18nProvider'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'

type SecretPeerVerificationDialogProps = {
  peer: PeerSummary | null
  onApprove: (peer: PeerSummary) => void
  onDismiss: () => void
}

export function SecretPeerVerificationDialog({ peer, onApprove, onDismiss }: SecretPeerVerificationDialogProps) {
  const { copy } = useI18n()

  return (
    <Dialog open={Boolean(peer)} onOpenChange={(open) => (!open ? onDismiss() : undefined)}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden border-border/80 p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <LockKeyhole className="h-4 w-4" />
            {copy.secretVerify.title}
          </DialogTitle>
          <DialogDescription>{copy.secretVerify.description}</DialogDescription>
        </DialogHeader>
        {peer ? (
          <div className="space-y-4 px-5 py-4">
            <div className="rounded-md border border-border bg-[var(--panel-strong)] p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Fingerprint className="h-4 w-4" />
                {peer.displayName}
              </div>
              <p className="mt-3 break-all font-mono text-xs text-foreground">
                {peer.secureFingerprint ?? formatPeerFingerprint(peer.id)}
              </p>
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">{copy.secretVerify.noFallback}</p>
          </div>
        ) : null}
        <DialogFooter className="border-t border-border px-5 py-4">
          <Button variant="ghost" onClick={onDismiss}>
            {copy.secretVerify.cancel}
          </Button>
          <Button onClick={() => peer && onApprove(peer)} disabled={!peer?.secureFingerprint}>
            {copy.secretVerify.approve}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
