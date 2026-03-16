import { InviteReviewDialog } from './InviteReviewDialog'
import { IdentityTransferImportDialog } from './IdentityTransferImportDialog'
import type { PendingDeepLinkInvite } from '../../lib/deepLinkInvites'
import type { PendingDeepLinkIdentityTransfer } from '../../lib/deepLinkIdentityTransfers'

type ShellDialogsProps = {
  invite: {
    pendingInvite: PendingDeepLinkInvite | null
    isBusy: boolean
    currentIdentityFingerprint: string
    identityMode: 'current' | 'new'
    onIdentityModeChange: (value: 'current' | 'new') => void
    onApprove: () => void
    onDismiss: () => void
  }
  identityTransfer: {
    pendingTransfer: PendingDeepLinkIdentityTransfer | null
    currentIdentityFingerprint: string
    passphrase: string
    errorNote: string | null
    isBusy: boolean
    onPassphraseChange: (value: string) => void
    onApprove: () => void
    onDismiss: () => void
  }
}

export function ShellDialogs({ invite, identityTransfer }: ShellDialogsProps) {
  return (
    <>
      <InviteReviewDialog
        pendingInvite={invite.pendingInvite}
        isBusy={invite.isBusy}
        currentIdentityFingerprint={invite.currentIdentityFingerprint}
        identityMode={invite.identityMode}
        onIdentityModeChange={invite.onIdentityModeChange}
        onApprove={invite.onApprove}
        onDismiss={invite.onDismiss}
      />
      <IdentityTransferImportDialog
        pendingTransfer={identityTransfer.pendingTransfer}
        currentIdentityFingerprint={identityTransfer.currentIdentityFingerprint}
        passphrase={identityTransfer.passphrase}
        errorNote={identityTransfer.errorNote}
        isBusy={identityTransfer.isBusy}
        onPassphraseChange={identityTransfer.onPassphraseChange}
        onApprove={identityTransfer.onApprove}
        onDismiss={identityTransfer.onDismiss}
      />
    </>
  )
}
