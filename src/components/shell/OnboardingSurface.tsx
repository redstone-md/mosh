import { Titlebar } from '../Titlebar'
import { ShellToaster } from '../ShellToaster'
import { OnboardingGate } from './OnboardingGate'
import type { ThemeId } from '../../lib/appShellSchemas'
import type { RuntimeStatus, UpdateRuntimeSettingsInput } from '../../lib/schemas'

type OnboardingSurfaceProps = {
  runtime: RuntimeStatus
  theme: ThemeId
  runtimeDraft: UpdateRuntimeSettingsInput
  isBusy: boolean
  formErrorNote?: string
  titlebarErrorNote?: string
  onThemeChange: (theme: ThemeId) => void
  onRuntimeDraftChange: (draft: UpdateRuntimeSettingsInput) => void
  onStart: () => void
  onSkip: () => void
  onToggleRuntime: () => void
  runtimeToggleBusy: boolean
}

export function OnboardingSurface({
  runtime,
  theme,
  runtimeDraft,
  isBusy,
  formErrorNote,
  titlebarErrorNote,
  onThemeChange,
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
        runtimeDraft={runtimeDraft}
        isBusy={isBusy}
        errorNote={formErrorNote}
        onThemeChange={onThemeChange}
        onRuntimeDraftChange={onRuntimeDraftChange}
        onStart={onStart}
        onSkip={onSkip}
      />
    </main>
  )
}
