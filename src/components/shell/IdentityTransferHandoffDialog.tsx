import { QRCodeSVG } from 'qrcode.react'
import { Copy, ShieldCheck } from 'lucide-react'

import type { IdentityTransferHandoff } from '../../lib/identityTransferHandoff'
import { useI18n } from '../I18nProvider'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'

type IdentityTransferHandoffDialogProps = {
  open: boolean
  handoff: IdentityTransferHandoff | null
  fingerprint: string
  onCopyPackage: () => Promise<void> | void
  onOpenChange: (open: boolean) => void
}

export function IdentityTransferHandoffDialog({
  open,
  handoff,
  fingerprint,
  onCopyPackage,
  onOpenChange,
}: IdentityTransferHandoffDialogProps) {
  const { copy } = useI18n()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden border-border/80 p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{copy.identityTransfer.handoffTitle}</DialogTitle>
          <DialogDescription>{copy.identityTransfer.handoffDescription}</DialogDescription>
        </DialogHeader>

        {handoff ? (
          <div className="grid gap-0 md:grid-cols-[280px_minmax(0,1fr)]">
            <section className="border-b border-border px-5 py-5 md:border-b-0 md:border-r">
              <div className="rounded-md border border-border bg-white p-3">
                <QRCodeSVG
                  value={handoff.qrValue}
                  size={232}
                  level="M"
                  marginSize={2}
                  bgColor="#ffffff"
                  fgColor="#111111"
                  className="h-auto w-full"
                />
              </div>
              <div className="mt-4 rounded-md border border-border bg-[var(--panel-strong)] p-3">
                <div className="text-xs text-[var(--muted-foreground)]">{copy.identityTransfer.verificationCode}</div>
                <div className="mt-2 font-mono text-lg tracking-[0.2em] text-foreground">{handoff.shortCode}</div>
              </div>
              <div className="mt-4 rounded-md border border-border bg-[var(--panel-strong)] p-3 text-sm">
                <div className="text-xs text-[var(--muted-foreground)]">{copy.identityTransfer.sourceFingerprint}</div>
                <div className="mt-2 font-mono text-xs text-foreground">{handoff.summary.sourceFingerprint}</div>
                <div className="mt-3 text-xs text-[var(--muted-foreground)]">{copy.identityTransfer.exportedAt}</div>
                <div className="mt-1 text-xs text-foreground">{handoff.summary.exportedAt}</div>
              </div>
            </section>

            <section className="px-5 py-5">
              <div className="rounded-md border border-border bg-[var(--panel-strong)] p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <ShieldCheck className="h-4 w-4 text-[var(--primary)]" />
                  {copy.identityTransfer.activeFingerprint}
                </div>
                <div className="mt-2 font-mono text-xs text-[var(--muted-foreground)]">{fingerprint}</div>
              </div>

              <div className="mt-4 space-y-3">
                <div className="text-sm font-medium text-foreground">{copy.identityTransfer.handoffStepsTitle}</div>
                <ol className="space-y-2 text-sm text-[var(--muted-foreground)]">
                  <li>{copy.identityTransfer.stepPrepare}</li>
                  <li>{copy.identityTransfer.stepMove}</li>
                  <li>{copy.identityTransfer.stepImport}</li>
                </ol>
              </div>

              <div className="mt-4 rounded-md border border-border bg-[var(--panel)] p-4">
                <div className="text-sm font-medium text-foreground">{copy.identityTransfer.packagePreview}</div>
                <div className="mt-3 space-y-1 font-mono text-xs leading-5 text-[var(--muted-foreground)]">
                  {handoff.previewLines.map((line) => (
                    <div key={line} className="break-all">
                      {line}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {copy.common.dismiss}
                </Button>
                <Button type="button" onClick={() => void onCopyPackage()}>
                  <Copy className="mr-2 h-4 w-4" />
                  {copy.identityTransfer.copyPackage}
                </Button>
              </div>
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
