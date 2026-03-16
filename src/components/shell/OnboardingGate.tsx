import type { LanguagePreference, ThemeId } from '../../lib/appShellSchemas'
import type { RuntimeStatus, UpdateRuntimeSettingsInput } from '../../lib/schemas'
import { languagePreferenceOptions, localizeRuntimeState } from '../../lib/i18n'
import { useI18n } from '../I18nProvider'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { RuntimeSettingsForm } from './RuntimeSettingsForm'

type OnboardingGateProps = {
  runtime: RuntimeStatus
  theme: ThemeId
  languagePreference: LanguagePreference
  runtimeDraft: UpdateRuntimeSettingsInput
  isBusy: boolean
  errorNote?: string
  onThemeChange: (theme: ThemeId) => void
  onLanguagePreferenceChange: (languagePreference: LanguagePreference) => void
  onRuntimeDraftChange: (draft: UpdateRuntimeSettingsInput) => void
  onStart: () => void
  onSkip: () => void
}

export function OnboardingGate({
  runtime,
  theme,
  languagePreference,
  runtimeDraft,
  isBusy,
  errorNote,
  onThemeChange,
  onLanguagePreferenceChange,
  onRuntimeDraftChange,
  onStart,
  onSkip,
}: OnboardingGateProps) {
  const { copy, getLanguageLabel } = useI18n()

  return (
    <section className="flex flex-1 items-center justify-center bg-[var(--app)] p-6 text-foreground">
      <Card className="w-full max-w-5xl">
        <CardHeader className="border-b border-border">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>{copy.onboarding.title}</CardTitle>
              <CardDescription>{copy.onboarding.description}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={runtime.state === 'Runtime online' ? 'default' : 'secondary'}>
                {localizeRuntimeState(copy, runtime.state)}
              </Badge>
              <div className="min-w-40">
                <Select value={theme} onValueChange={(value: ThemeId) => onThemeChange(value)}>
                  <SelectTrigger>
                    <SelectValue>{copy.themes[theme]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="moss">{copy.themes.moss}</SelectItem>
                    <SelectItem value="graphite">{copy.themes.graphite}</SelectItem>
                    <SelectItem value="linen">{copy.themes.linen}</SelectItem>
                    <SelectItem value="ember">{copy.themes.ember}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-44">
                <Select
                  value={languagePreference}
                  onValueChange={(value: LanguagePreference) => onLanguagePreferenceChange(value)}
                >
                  <SelectTrigger>
                    <SelectValue>{getLanguageLabel(languagePreference)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {languagePreferenceOptions.map((value) => (
                      <SelectItem key={value} value={value}>
                        {getLanguageLabel(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 p-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <RuntimeSettingsForm
              draft={runtimeDraft}
              disabled={isBusy}
              submitLabel={isBusy ? copy.runtime.applying : copy.runtime.saveAndEnter}
              errorNote={errorNote}
              onDraftChange={onRuntimeDraftChange}
              onSubmit={onStart}
            />
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-[var(--panel-strong)] p-4">
              <p className="text-sm font-medium">{copy.runtime.status}</p>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">{runtime.summary}</p>
              <p className="mt-3 text-xs text-[var(--muted-foreground)]">{runtime.route}</p>
            </div>
            <div className="rounded-lg border border-border bg-[var(--panel-strong)] p-4">
              <p className="text-sm font-medium">{copy.runtime.persisted}</p>
              <ul className="mt-3 space-y-2 text-sm text-[var(--muted-foreground)]">
                <li>{copy.runtime.persistedTheme}</li>
                <li>{copy.runtime.persistedDraft}</li>
                <li>{copy.runtime.persistedArchive}</li>
              </ul>
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={onSkip}>
                {copy.runtime.openShellOnly}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
