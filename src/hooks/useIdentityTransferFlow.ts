import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { replaceSigningIdentity } from '../lib/appShellStorage'
import { importIdentityTransferPackage } from '../lib/identityTransfer'
import { useDeepLinkIdentityTransfers } from './useDeepLinkIdentityTransfers'

type IdentityTransferFlowOptions = {
  copy: {
    invalidLink: string
    imported: string
    importFailed: string
  }
  currentIdentityFingerprint: string
  onImported: () => Promise<void>
}

export function useIdentityTransferFlow({
  copy,
  currentIdentityFingerprint,
  onImported,
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

      const identity = await importIdentityTransferPackage(pendingTransfer.transferPackage, passphrase)
      await replaceSigningIdentity(identity)
    },
    onSuccess: async () => {
      setErrorNote(null)
      setPassphrase('')
      dismissPendingTransfer()
      await queryClient.invalidateQueries({ queryKey: ['signing-identity-summary'] })
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
