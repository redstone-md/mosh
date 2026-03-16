import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  createDefaultPreferences,
  ensureSigningIdentity,
  loadShellBootstrap,
  savePreferences,
} from '../lib/appShellStorage'

export function useShellPreferences() {
  const bootstrapHydratedRef = useRef(false)
  const [preferences, setPreferences] = useState(createDefaultPreferences)
  const [identityFingerprint, setIdentityFingerprint] = useState('')
  const bootstrap = useQuery({
    queryKey: ['shell-storage-bootstrap'],
    queryFn: () => loadShellBootstrap(),
  })

  useEffect(() => {
    if (!bootstrap.data || bootstrapHydratedRef.current) {
      return
    }

    bootstrapHydratedRef.current = true
    setPreferences(bootstrap.data.preferences)
  }, [bootstrap.data])

  useEffect(() => {
    if (!bootstrapHydratedRef.current) {
      return
    }

    const timeout = window.setTimeout(() => {
      void savePreferences(preferences)
    }, 120)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [preferences])

  useEffect(() => {
    if (!bootstrapHydratedRef.current) {
      return
    }

    void ensureSigningIdentity().then((identity) => {
      setIdentityFingerprint(identity.fingerprint)
    })
  }, [bootstrap.data])

  return {
    preferences,
    setPreferences,
    identityFingerprint,
    isPending: bootstrap.isPending || (bootstrap.isSuccess && !bootstrapHydratedRef.current),
    error: bootstrap.error,
    hasPersistedPreferences: bootstrap.data?.hasPersistedPreferences ?? false,
  }
}
