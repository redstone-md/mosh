import type { ReactNode } from 'react'
import { Link2, Network, RadioTower, UserRound } from 'lucide-react'

import type { PendingDeepLinkInvite } from '../../lib/deepLinkInvites'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { useI18n } from '../I18nProvider'

type InviteReviewDialogProps = {
  pendingInvite: PendingDeepLinkInvite | null
  isBusy: boolean
  onApprove: () => void
  onDismiss: () => void
}

export function InviteReviewDialog({
  pendingInvite,
  isBusy,
  onApprove,
  onDismiss,
}: InviteReviewDialogProps) {
  const { copy } = useI18n()
  const invite = pendingInvite?.invite

  return (
    <Dialog open={Boolean(invite)} onOpenChange={(open) => (!open && !isBusy ? onDismiss() : undefined)}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden border-border/80 p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{copy.inviteReview.title}</DialogTitle>
          <DialogDescription>
            {invite ? copy.inviteReview.description(invite.inviterName) : copy.inviteReview.idle}
          </DialogDescription>
        </DialogHeader>
        {invite ? (
          <>
            <div className="grid gap-2 px-5 py-4">
              <InviteFact
                icon={<UserRound className="h-4 w-4" />}
                label={copy.inviteReview.inviter}
                value={invite.inviterName}
              />
              <InviteFact
                icon={<Network className="h-4 w-4" />}
                label={copy.inviteReview.mesh}
                value={invite.runtime.meshId}
              />
              <InviteFact
                icon={<Link2 className="h-4 w-4" />}
                label={copy.inviteReview.room}
                value={`#${invite.runtime.initialRoom}`}
              />
              <InviteFact
                icon={<RadioTower className="h-4 w-4" />}
                label={copy.inviteReview.startupPeer}
                value={invite.runtime.startupPeer || copy.inviteReview.noStartupPeer}
              />
            </div>
            <div className="border-t border-border px-5 py-3 text-sm text-[var(--muted-foreground)]">
              {copy.inviteReview.discovery(
                invite.runtime.lanDiscoveryEnabled
                  ? copy.inviteReview.discoveryLan
                  : copy.inviteReview.discoveryDirect,
              )}
            </div>
            <DialogFooter className="border-t border-border px-5 py-4">
              <Button type="button" variant="outline" onClick={onDismiss} disabled={isBusy}>
                {copy.inviteReview.dismiss}
              </Button>
              <Button type="button" onClick={onApprove} disabled={isBusy}>
                {isBusy ? copy.inviteReview.joining : copy.inviteReview.join}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

type InviteFactProps = {
  icon: ReactNode
  label: string
  value: string
}

function InviteFact({ icon, label, value }: InviteFactProps) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border/80 bg-[var(--panel-strong)] px-3 py-3">
      <div className="mt-0.5 text-[var(--muted-foreground)]">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs text-[var(--muted-foreground)]">{label}</div>
        <div className="truncate text-sm text-foreground">{value}</div>
      </div>
    </div>
  )
}
