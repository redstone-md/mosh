import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Copy, RefreshCw, ScanQrCode } from 'lucide-react'

import { ensureSigningIdentity, replaceSigningIdentity } from '../../lib/appShellStorage'
import { buildIdentityTransferHandoff } from '../../lib/identityTransferHandoff'
import {
  exportIdentityTransferPackage,
  importIdentityTransferPackage,
  readIdentityTransferSummary,
} from '../../lib/identityTransfer'
import type { IdentityTransferEventInput } from '../../lib/identityTransferHistory'
import { useI18n } from '../I18nProvider'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { IdentityTransferHandoffDialog } from './IdentityTransferHandoffDialog'

type IdentityTransferPanelProps = {
  onImported: () => void | Promise<void>
  onRecordEvent: (event: IdentityTransferEventInput) => void
}

export function IdentityTransferPanel({ onImported, onRecordEvent }: IdentityTransferPanelProps) {
  const { copy } = useI18n()
  const [passphrase, setPassphrase] = useState('')
  const [transferPackage, setTransferPackage] = useState('')
  const [handoffOpen, setHandoffOpen] = useState(false)
  const [errorNote, setErrorNote] = useState<string | null>(null)
  const identityQuery = useQuery({
    queryKey: ['signing-identity-summary'],
    queryFn: () => ensureSigningIdentity(),
  })
  const exportTransfer = useMutation({
    mutationFn: async () => {
      const identity = await ensureSigningIdentity()
      return {
        identity,
        transferPackage: await exportIdentityTransferPackage(identity, passphrase),
      }
    },
    onSuccess: ({ identity, transferPackage }) => {
      setTransferPackage(transferPackage)
      setHandoffOpen(true)
      setErrorNote(null)
      onRecordEvent({
        action: 'export',
        channel: 'manual',
        activeFingerprint: identity.fingerprint,
        packageSourceFingerprint: identity.fingerprint,
      })
      toast.success(copy.identityTransfer.exported)
    },
    onError: () => {
      setErrorNote(copy.identityTransfer.passphraseHint)
    },
  })
  const importTransfer = useMutation({
    mutationFn: async () => {
      const previousIdentity = await ensureSigningIdentity()
      const identity = await importIdentityTransferPackage(transferPackage, passphrase)
      await replaceSigningIdentity(identity)
      return {
        previousFingerprint: previousIdentity.fingerprint,
        importedFingerprint: identity.fingerprint,
        summary: readIdentityTransferSummary(transferPackage),
      }
    },
    onSuccess: async ({ previousFingerprint, importedFingerprint, summary }) => {
      setErrorNote(null)
      onRecordEvent({
        action: 'import',
        channel: 'manual',
        activeFingerprint: importedFingerprint,
        replacedFingerprint: previousFingerprint,
        packageSourceFingerprint: summary.sourceFingerprint,
        packageExportedAt: summary.exportedAt,
      })
      await onImported()
      await identityQuery.refetch()
      toast.success(copy.identityTransfer.imported)
    },
    onError: () => {
      setErrorNote(copy.identityTransfer.importFailed)
    },
  })

  const currentFingerprint = useMemo(
    () => identityQuery.data?.fingerprint ?? copy.identityTransfer.unavailable,
    [copy.identityTransfer.unavailable, identityQuery.data?.fingerprint],
  )
  const handoff = useMemo(
    () => (transferPackage ? buildIdentityTransferHandoff(transferPackage) : null),
    [transferPackage],
  )

  async function handleCopyPackage() {
    await navigator.clipboard.writeText(transferPackage)
    toast.success(copy.identityTransfer.copied)
  }

  return (
    <>
      <section className="rounded-md border border-border bg-[var(--panel-strong)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">{copy.identityTransfer.title}</p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{copy.identityTransfer.description}</p>
          </div>
          <span className="rounded-md border border-border px-2 py-1 font-mono text-xs text-[var(--muted-foreground)]">
            {currentFingerprint}
          </span>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="identity-transfer-passphrase">{copy.identityTransfer.passphrase}</Label>
              <Input
                id="identity-transfer-passphrase"
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                placeholder={copy.identityTransfer.passphrasePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="identity-transfer-package">{copy.identityTransfer.transferPackage}</Label>
              <Textarea
                id="identity-transfer-package"
                value={transferPackage}
                onChange={(event) => setTransferPackage(event.target.value)}
                placeholder={copy.identityTransfer.packagePlaceholder}
                className="min-h-28 font-mono text-xs"
              />
            </div>
            {errorNote ? <p className="text-sm text-[var(--danger)]">{errorNote}</p> : null}
          </div>

          <div className="space-y-2">
            <Button
              type="button"
              className="w-full"
              variant="secondary"
              disabled={exportTransfer.isPending || importTransfer.isPending}
              onClick={() => exportTransfer.mutate()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {exportTransfer.isPending ? copy.identityTransfer.exporting : copy.identityTransfer.export}
            </Button>
            <Button
              type="button"
              className="w-full"
              variant="outline"
              disabled={!transferPackage || exportTransfer.isPending || importTransfer.isPending}
              onClick={() => setHandoffOpen(true)}
            >
              <ScanQrCode className="mr-2 h-4 w-4" />
              {copy.identityTransfer.openHandoff}
            </Button>
            <Button
              type="button"
              className="w-full"
              variant="outline"
              disabled={!transferPackage || exportTransfer.isPending || importTransfer.isPending}
              onClick={() => void handleCopyPackage()}
            >
              <Copy className="mr-2 h-4 w-4" />
              {copy.identityTransfer.copy}
            </Button>
            <Button
              type="button"
              className="w-full"
              disabled={exportTransfer.isPending || importTransfer.isPending}
              onClick={() => importTransfer.mutate()}
            >
              {importTransfer.isPending ? copy.identityTransfer.importing : copy.identityTransfer.import}
            </Button>
            <p className="text-xs text-[var(--muted-foreground)]">{copy.identityTransfer.note}</p>
          </div>
        </div>
      </section>

      <IdentityTransferHandoffDialog
        open={handoffOpen}
        handoff={handoff}
        fingerprint={currentFingerprint}
        onCopyPackage={handleCopyPackage}
        onOpenChange={setHandoffOpen}
      />
    </>
  )
}
