import type { ReactNode } from 'react'

import { I18nProvider } from '../I18nProvider'
import { ShellDialogs } from './ShellDialogs'
import type { AppLanguage, LanguagePreference } from '../../lib/i18n'
import type { PendingDeepLinkInvite } from '../../lib/deepLinkInvites'
import type { PendingDeepLinkIdentityTransfer } from '../../lib/deepLinkIdentityTransfers'

type ShellI18nFrameProps = {
  language: AppLanguage
  systemLanguage: AppLanguage
  languagePreference: LanguagePreference
  onLanguagePreferenceChange: (value: LanguagePreference) => void
  invite: {
    pendingInvite: PendingDeepLinkInvite | null
    isBusy: boolean
    currentIdentityFingerprint: string
    identityMode: 'current' | 'new'
    onIdentityModeChange: (value: 'current' | 'new') => void
    onApprove: () => void
    onDismiss: () => void
  }
  identityTransfer: {
    pendingTransfer: PendingDeepLinkIdentityTransfer | null
    currentIdentityFingerprint: string
    passphrase: string
    errorNote: string | null
    isBusy: boolean
    onPassphraseChange: (value: string) => void
    onApprove: () => void
    onDismiss: () => void
  }
  children: ReactNode
}

export function ShellI18nFrame({
  language,
  systemLanguage,
  languagePreference,
  onLanguagePreferenceChange,
  invite,
  identityTransfer,
  children,
}: ShellI18nFrameProps) {
  return (
    <I18nProvider
      language={language}
      systemLanguage={systemLanguage}
      languagePreference={languagePreference}
      onLanguagePreferenceChange={onLanguagePreferenceChange}
    >
      <>
        {children}
        <ShellDialogs invite={invite} identityTransfer={identityTransfer} />
      </>
    </I18nProvider>
  )
}
