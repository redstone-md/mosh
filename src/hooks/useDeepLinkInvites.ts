import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'

import { decodeMeshInvite } from '../lib/meshInvite'
import { appendUniqueDeepLinkInvites, extractInviteDeepLinks, type PendingDeepLinkInvite } from '../lib/deepLinkInvites'
import { showDesktopWindow } from '../lib/desktopWindow'
import { isTauriEnvironment } from '../lib/tauriEnv'

type UseDeepLinkInvitesOptions = {
  invalidMessage: string
}

export function useDeepLinkInvites({ invalidMessage }: UseDeepLinkInvitesOptions) {
  const queuedUrlsRef = useRef(new Set<string>())
  const [pendingInvites, setPendingInvites] = useState<PendingDeepLinkInvite[]>([])

  useEffect(() => {
    queuedUrlsRef.current = new Set(pendingInvites.map((invite) => invite.sourceUrl))
  }, [pendingInvites])

  useEffect(() => {
    if (!isTauriEnvironment()) {
      return
    }

    let disposed = false
    let unsubscribe: (() => void) | undefined

    async function queueUrls(urls: string[]) {
      const nextInvites: PendingDeepLinkInvite[] = []

      for (const url of extractInviteDeepLinks(urls)) {
        if (queuedUrlsRef.current.has(url)) {
          continue
        }

        try {
          nextInvites.push({
            sourceUrl: url,
            invite: decodeMeshInvite(url),
          })
          queuedUrlsRef.current.add(url)
        } catch {
          toast.error(invalidMessage)
        }
      }

      if (nextInvites.length === 0) {
        return
      }

      await showDesktopWindow()
      setPendingInvites((current) => appendUniqueDeepLinkInvites(current, nextInvites))
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
    pendingInvite: pendingInvites[0] ?? null,
    dismissPendingInvite: () => {
      setPendingInvites((current) => current.slice(1))
    },
  }
}
