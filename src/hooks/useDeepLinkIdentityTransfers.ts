import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'

import {
  appendUniqueDeepLinkIdentityTransfers,
  decodePendingIdentityTransfer,
  extractIdentityTransferDeepLinks,
  type PendingDeepLinkIdentityTransfer,
} from '../lib/deepLinkIdentityTransfers'
import { showDesktopWindow } from '../lib/desktopWindow'
import { isTauriEnvironment } from '../lib/tauriEnv'

type UseDeepLinkIdentityTransfersOptions = {
  invalidMessage: string
}

export function useDeepLinkIdentityTransfers({ invalidMessage }: UseDeepLinkIdentityTransfersOptions) {
  const queuedUrlsRef = useRef(new Set<string>())
  const [pendingTransfers, setPendingTransfers] = useState<PendingDeepLinkIdentityTransfer[]>([])

  useEffect(() => {
    queuedUrlsRef.current = new Set(pendingTransfers.map((transfer) => transfer.sourceUrl))
  }, [pendingTransfers])

  useEffect(() => {
    if (!isTauriEnvironment()) {
      return
    }

    let disposed = false
    let unsubscribe: (() => void) | undefined

    async function queueUrls(urls: string[]) {
      const nextTransfers: PendingDeepLinkIdentityTransfer[] = []

      for (const url of extractIdentityTransferDeepLinks(urls)) {
        if (queuedUrlsRef.current.has(url)) {
          continue
        }

        try {
          nextTransfers.push(decodePendingIdentityTransfer(url))
          queuedUrlsRef.current.add(url)
        } catch {
          toast.error(invalidMessage)
        }
      }

      if (nextTransfers.length === 0) {
        return
      }

      await showDesktopWindow()
      setPendingTransfers((current) => appendUniqueDeepLinkIdentityTransfers(current, nextTransfers))
    }

    void getCurrent()
      .then((urls) => {
        if (!disposed && urls) {
          void queueUrls(urls)
        }
      })
      .catch(() => undefined)

    void onOpenUrl((urls) => {
      void queueUrls(urls)
    })
      .then((detach) => {
        unsubscribe = detach
      })
      .catch(() => undefined)

    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [invalidMessage])

  return {
    pendingTransfer: pendingTransfers[0] ?? null,
    dismissPendingTransfer: () => {
      setPendingTransfers((current) => current.slice(1))
    },
  }
}
