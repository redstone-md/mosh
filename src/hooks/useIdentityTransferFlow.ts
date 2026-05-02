import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { ensureSigningIdentity, replaceSigningIdentity } from '../lib/appShellStorage'
import { importIdentityTransferPackage } from '../lib/identityTransfer'
import { useDeepLinkIdentityTransfers } from './useDeepLinkIdentityTransfers'
import type { IdentityTransferEventInput } from '../lib/identityTransferHistory'
import type { SigningIdentity } from '../lib/appShellSchemas'

type IdentityTransferFlowOptions = {
  copy: {
    invalidLink: string
    imported: string
    importFailed: string
  }
  currentIdentityFingerprint: string
  onImported: () => Promise<void>
  onRecordEvent: (event: IdentityTransferEventInput) => void
  onSaveRollbackSnapshot: (identity: SigningIdentity, source: 'import' | 'rollback') => void
}

export function useIdentityTransferFlow({
  copy,
  currentIdentityFingerprint,
  onImported,
  onRecordEvent,
  onSaveRollbackSnapshot,
}: IdentityTransferFlowOptions) {
  const queryClient = useQueryClient()
  const [passphrase, setPassphrase] = useState('')
  const [errorNote, setErrorNote] = useState<string | null>(null)
  const { pendingTransfer, dismissPendingTransfer } = useDeepLinkIdentityTransfers({
    invalidMessage: copy.invalidLink,
  })
  const importTransfer = useMutation({
    mutationFn: async () => {
      if (!pendingTransfer) {
        return
      }

      const previousIdentity = await ensureSigningIdentity()
      const identity = await importIdentityTransferPackage(pendingTransfer.transferPackage, passphrase)
      await replaceSigningIdentity(identity)
      return { previousIdentity }
    },
    onSuccess: async (result) => {
      if (!pendingTransfer) {
        return
      }
      setErrorNote(null)
      setPassphrase('')
      if (result?.previousIdentity) {
        onSaveRollbackSnapshot(result.previousIdentity, 'import')
      }
      onRecordEvent({
        action: 'import',
        channel: 'deep-link',
        activeFingerprint: pendingTransfer.handoff.summary.sourceFingerprint,
        replacedFingerprint: currentIdentityFingerprint,
        packageSourceFingerprint: pendingTransfer.handoff.summary.sourceFingerprint,
        packageExportedAt: pendingTransfer.handoff.summary.exportedAt,
      })
      dismissPendingTransfer()
      await queryClient.invalidateQueries({
        queryKey: ['signing-identity-summary'],
      })
      await onImported()
      toast.success(copy.imported)
    },
    onError: () => {
      setErrorNote(copy.importFailed)
    },
  })

  return {
    pendingTransfer,
    currentIdentityFingerprint,
    passphrase,
    errorNote,
    importPending: importTransfer.isPending,
    setPassphrase,
    approvePendingTransfer: () => importTransfer.mutateAsync(),
    dismissPendingTransfer: () => {
      setPassphrase('')
      setErrorNote(null)
      dismissPendingTransfer()
    },
  }
}
