import { useEffect, useMemo } from 'react'

import type { LanguagePreference, ThemeId } from '../lib/appShellSchemas'
import { resolveAppLanguage, type AppLanguage } from '../lib/i18n'

export function useDocumentAppearance(
  theme: ThemeId,
  languagePreference: LanguagePreference,
  systemLanguage: AppLanguage
) {
  const activeLanguage = useMemo(
    () => resolveAppLanguage(languagePreference, systemLanguage),
    [languagePreference, systemLanguage]
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    document.documentElement.lang = activeLanguage
  }, [activeLanguage])

  return activeLanguage
}
