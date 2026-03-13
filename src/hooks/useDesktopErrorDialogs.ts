import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'

type UseDesktopErrorDialogsOptions = {
  errors: string[]
}

export function useDesktopErrorDialogs({ errors }: UseDesktopErrorDialogsOptions) {
  const shownErrors = useRef<Set<string>>(new Set())

  useEffect(() => {
    for (const error of errors) {
      const normalized = error.trim()
      if (!normalized || shownErrors.current.has(normalized)) {
        continue
      }
      shownErrors.current.add(normalized)
      toast.error(normalized, {
        duration: 5000,
        position: 'bottom-right',
      })
    }
  }, [errors])
}
