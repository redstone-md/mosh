import { createContext, useContext, type ReactNode } from 'react'

import {
  getI18nCopy,
  getLanguageOptionLabel,
  type AppLanguage,
  type I18nCopy,
  type LanguagePreference,
} from '../lib/i18n'

type I18nContextValue = {
  language: AppLanguage
  systemLanguage: AppLanguage
  languagePreference: LanguagePreference
  copy: I18nCopy
  setLanguagePreference: (value: LanguagePreference) => void
  getLanguageLabel: (value: LanguagePreference) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

type I18nProviderProps = {
  language: AppLanguage
  systemLanguage: AppLanguage
  languagePreference: LanguagePreference
  onLanguagePreferenceChange: (value: LanguagePreference) => void
  children: ReactNode
}

export function I18nProvider({
  language,
  systemLanguage,
  languagePreference,
  onLanguagePreferenceChange,
  children,
}: I18nProviderProps) {
  const copy = getI18nCopy(language)

  return (
    <I18nContext.Provider
      value={{
        language,
        systemLanguage,
        languagePreference,
        copy,
        setLanguagePreference: onLanguagePreferenceChange,
        getLanguageLabel: (value) => getLanguageOptionLabel(copy, value, systemLanguage),
      }}
    >
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return context
}
