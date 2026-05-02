import { enTranslations } from './i18n.en'
import { ruTranslations } from './i18n.ru'

export const supportedLanguages = ['en', 'ru'] as const
export const languagePreferenceOptions = ['system', ...supportedLanguages] as const

export type AppLanguage = (typeof supportedLanguages)[number]
export type LanguagePreference = (typeof languagePreferenceOptions)[number]

const translations = {
  en: enTranslations,
  ru: ruTranslations,
} as const

export type I18nCopy = (typeof translations)[AppLanguage]

export function detectSystemLanguage(input?: string): AppLanguage {
  const source =
    input ?? (typeof navigator !== 'undefined' ? (navigator.languages?.find(Boolean) ?? navigator.language) : 'en')
  const normalized = source.trim().toLowerCase()

  if (normalized.startsWith('ru')) {
    return 'ru'
  }

  return 'en'
}

export function resolveAppLanguage(preference: LanguagePreference, systemLanguage: AppLanguage): AppLanguage {
  return preference === 'system' ? systemLanguage : preference
}

export function getI18nCopy(language: AppLanguage): I18nCopy {
  return translations[language]
}

export function getLanguageOptionLabel(
  copy: I18nCopy,
  preference: LanguagePreference,
  systemLanguage: AppLanguage
): string {
  if (preference === 'system') {
    return copy.languageNames.systemResolved(copy.languageNames[systemLanguage])
  }

  return copy.languageNames[preference]
}

export function localizeRuntimeState(copy: I18nCopy, state: string): string {
  if (state === 'Runtime online') {
    return copy.runtime.online
  }
  if (state === 'Runtime offline') {
    return copy.runtime.offline
  }
  return state
}

export function localizePeerStatus(copy: I18nCopy, status: string): string {
  if (status === 'self') {
    return copy.peerStatus.self
  }
  if (status === 'online') {
    return copy.peerStatus.online
  }
  return status
}

export function describeArchiveStateLabel(
  copy: I18nCopy,
  fingerprint: string | undefined,
  verified: boolean | undefined
): string {
  if (!fingerprint) {
    return copy.archive.pending
  }
  if (verified) {
    return copy.archive.signedBy(fingerprint)
  }
  return copy.archive.failed(fingerprint)
}

export function formatCallModes(copy: I18nCopy, modes: string[]): string {
  return modes
    .map((mode) => {
      if (mode === 'voice') {
        return copy.call.modeVoice
      }
      if (mode === 'screen') {
        return copy.call.modeScreen
      }
      return copy.call.modeUnknown
    })
    .join(' + ')
}
