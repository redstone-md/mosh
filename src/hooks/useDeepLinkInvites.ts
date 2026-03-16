import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'

import type { MeshInvitePayload } from '../lib/meshInvite'
import { decodeMeshInvite } from '../lib/meshInvite'
import { extractInviteDeepLinks } from '../lib/deepLinkInvites'
import { showDesktopWindow } from '../lib/desktopWindow'
import { isTauriEnvironment } from '../lib/tauriEnv'

type UseDeepLinkInvitesOptions = {
  successMessage: string
  invalidMessage: string
  onApplyInvite: (invite: MeshInvitePayload) => Promise<void>
}

export function useDeepLinkInvites({
  successMessage,
  invalidMessage,
  onApplyInvite,
}: UseDeepLinkInvitesOptions) {
  const handledUrlsRef = useRef(new Set<string>())

  useEffect(() => {
    if (!isTauriEnvironment()) {
      return
    }

    let disposed = false
    let unsubscribe: (() => void) | undefined

    async function applyUrls(urls: string[]) {
      for (const url of extractInviteDeepLinks(urls)) {
        if (handledUrlsRef.current.has(url)) {
          continue
        }

        handledUrlsRef.current.add(url)

        try {
          await showDesktopWindow()
          await onApplyInvite(decodeMeshInvite(url))
          toast.success(successMessage)
        } catch {
          toast.error(invalidMessage)
        }
      }
    }

    void getCurrent()
      .then((urls) => {
        if (!disposed && urls) {
          void applyUrls(urls)
        }
      })
      .catch(() => undefined)

    void onOpenUrl((urls) => {
      void applyUrls(urls)
    })
      .then((detach) => {
        unsubscribe = detach
      })
      .catch(() => undefined)

    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [invalidMessage, onApplyInvite, successMessage])
}
