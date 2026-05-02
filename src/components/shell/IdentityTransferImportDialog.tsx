import { ShieldAlert } from 'lucide-react'

import type { PendingDeepLinkIdentityTransfer } from '../../lib/deepLinkIdentityTransfers'
import { useI18n } from '../I18nProvider'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

type IdentityTransferImportDialogProps = {
  pendingTransfer: PendingDeepLinkIdentityTransfer | null
  currentIdentityFingerprint: string
  passphrase: string
  errorNote: string | null
  isBusy: boolean
  onPassphraseChange: (value: string) => void
  onApprove: () => void
  onDismiss: () => void
}

export function IdentityTransferImportDialog({
  pendingTransfer,
  currentIdentityFingerprint,
  passphrase,
  errorNote,
  isBusy,
  onPassphraseChange,
  onApprove,
  onDismiss,
}: IdentityTransferImportDialogProps) {
  const { copy } = useI18n()

  return (
    <Dialog open={Boolean(pendingTransfer)} onOpenChange={(open) => (!open && !isBusy ? onDismiss() : undefined)}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden border-border/80 p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{copy.identityTransfer.deepLinkTitle}</DialogTitle>
          <DialogDescription>{copy.identityTransfer.deepLinkDescription}</DialogDescription>
        </DialogHeader>

        {pendingTransfer ? (
          <>
            <div className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_280px]">
              <div className="space-y-4">
                <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4">
                  <div className="text-xs text-[var(--muted-foreground)]">{copy.identityTransfer.currentDevice}</div>
                  <div className="mt-2 font-mono text-xs text-foreground">{currentIdentityFingerprint}</div>
                </div>
                <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4">
                  <div className="text-xs text-[var(--muted-foreground)]">{copy.identityTransfer.incomingIdentity}</div>
                  <div className="mt-2 font-mono text-xs text-foreground">
                    {pendingTransfer.handoff.summary.sourceFingerprint}
                  </div>
                  <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                    {copy.identityTransfer.unverifiedIncomingFingerprint}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4">
                  <div className="text-xs text-[var(--muted-foreground)]">{copy.identityTransfer.verificationCode}</div>
                  <div className="mt-2 font-mono text-lg tracking-[0.2em] text-foreground">
                    {pendingTransfer.handoff.shortCode}
                  </div>
                  <div className="mt-3 text-xs text-[var(--muted-foreground)]">{copy.identityTransfer.exportedAt}</div>
                  <div className="mt-1 text-xs text-foreground">{pendingTransfer.handoff.summary.exportedAt}</div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="identity-transfer-link-passphrase">{copy.identityTransfer.passphrase}</Label>
                  <Input
                    id="identity-transfer-link-passphrase"
                    type="password"
                    value={passphrase}
                    onChange={(event) => onPassphraseChange(event.target.value)}
                    placeholder={copy.identityTransfer.passphrasePlaceholder}
                  />
                </div>
                {errorNote ? <p className="text-sm text-[var(--danger)]">{errorNote}</p> : null}
              </div>

              <div className="space-y-4">
                <div className="rounded-md border border-border bg-[var(--panel)] p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <ShieldAlert className="h-4 w-4 text-[var(--danger)]" />
                    {copy.identityTransfer.deepLinkWarningTitle}
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted-foreground)]">{copy.identityTransfer.deepLinkWarning}</p>
                </div>
                <div className="rounded-md border border-border bg-[var(--panel)] p-4">
                  <div className="text-sm font-medium text-foreground">{copy.identityTransfer.packagePreview}</div>
                  <div className="mt-3 space-y-1 font-mono text-xs leading-5 text-[var(--muted-foreground)]">
                    {pendingTransfer.handoff.previewLines.map((line) => (
                      <div key={line} className="break-all">
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter className="border-t border-border px-5 py-4">
              <Button type="button" variant="outline" onClick={onDismiss} disabled={isBusy}>
                {copy.common.dismiss}
              </Button>
              <Button type="button" onClick={onApprove} disabled={isBusy}>
                {isBusy ? copy.identityTransfer.importing : copy.identityTransfer.importFromLink}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
