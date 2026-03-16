import { Titlebar } from '../Titlebar'
import { ShellToaster } from '../ShellToaster'
import { OnboardingGate } from './OnboardingGate'
import type { LanguagePreference, ThemeId } from '../../lib/appShellSchemas'
import type { RuntimeStatus, UpdateRuntimeSettingsInput } from '../../lib/schemas'

type OnboardingSurfaceProps = {
  runtime: RuntimeStatus
  theme: ThemeId
  languagePreference: LanguagePreference
  runtimeDraft: UpdateRuntimeSettingsInput
  isBusy: boolean
  formErrorNote?: string
  titlebarErrorNote?: string
  onThemeChange: (theme: ThemeId) => void
  onLanguagePreferenceChange: (languagePreference: LanguagePreference) => void
  onRuntimeDraftChange: (draft: UpdateRuntimeSettingsInput) => void
  onStart: () => void
  onSkip: () => void
  onToggleRuntime: () => void
  runtimeToggleBusy: boolean
}

export function OnboardingSurface({
  runtime,
  theme,
  languagePreference,
  runtimeDraft,
  isBusy,
  formErrorNote,
  titlebarErrorNote,
  onThemeChange,
  onLanguagePreferenceChange,
  onRuntimeDraftChange,
  onStart,
  onSkip,
  onToggleRuntime,
  runtimeToggleBusy,
}: OnboardingSurfaceProps) {
  return (
    <main className="flex h-screen flex-col bg-[var(--app)] text-foreground">
      <ShellToaster />
      <Titlebar
        runtime={runtime}
        onToggleRuntime={onToggleRuntime}
        isBusy={runtimeToggleBusy}
        errorNote={titlebarErrorNote}
      />
      <OnboardingGate
        runtime={runtime}
        theme={theme}
        languagePreference={languagePreference}
        runtimeDraft={runtimeDraft}
        isBusy={isBusy}
        errorNote={formErrorNote}
        onThemeChange={onThemeChange}
        onLanguagePreferenceChange={onLanguagePreferenceChange}
        onRuntimeDraftChange={onRuntimeDraftChange}
        onStart={onStart}
        onSkip={onSkip}
      />
    </main>
  )
}
