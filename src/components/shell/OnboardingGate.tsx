import type { ThemeId } from '../../lib/appShellSchemas'
import type { RuntimeStatus, UpdateRuntimeSettingsInput } from '../../lib/schemas'
import { getThemeLabel } from '../../lib/appShellStorage'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { RuntimeSettingsForm } from './RuntimeSettingsForm'

type OnboardingGateProps = {
  runtime: RuntimeStatus
  theme: ThemeId
  runtimeDraft: UpdateRuntimeSettingsInput
  isBusy: boolean
  errorNote?: string
  onThemeChange: (theme: ThemeId) => void
  onRuntimeDraftChange: (draft: UpdateRuntimeSettingsInput) => void
  onStart: () => void
  onSkip: () => void
}

export function OnboardingGate({
  runtime,
  theme,
  runtimeDraft,
  isBusy,
  errorNote,
  onThemeChange,
  onRuntimeDraftChange,
  onStart,
  onSkip,
}: OnboardingGateProps) {
  return (
    <section className="flex flex-1 items-center justify-center bg-[var(--app)] p-6 text-foreground">
      <Card className="w-full max-w-5xl">
        <CardHeader className="border-b border-border">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>MOSH Desktop</CardTitle>
              <CardDescription>Persist your mesh identity once and reopen directly into the shell.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={runtime.state === 'Runtime online' ? 'default' : 'secondary'}>
                {runtime.state}
              </Badge>
              <div className="min-w-40">
                <Select value={theme} onValueChange={(value: ThemeId) => onThemeChange(value)}>
                  <SelectTrigger>
                    <SelectValue>{getThemeLabel(theme)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="moss">Moss</SelectItem>
                    <SelectItem value="graphite">Graphite</SelectItem>
                    <SelectItem value="linen">Linen</SelectItem>
                    <SelectItem value="ember">Ember</SelectItem>
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
              submitLabel={isBusy ? 'Applying...' : 'Save and enter'}
              errorNote={errorNote}
              onDraftChange={onRuntimeDraftChange}
              onSubmit={onStart}
            />
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-[var(--panel-strong)] p-4">
              <p className="text-sm font-medium">Runtime status</p>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">{runtime.summary}</p>
              <p className="mt-3 text-xs text-[var(--muted-foreground)]">{runtime.route}</p>
            </div>
            <div className="rounded-lg border border-border bg-[var(--panel-strong)] p-4">
              <p className="text-sm font-medium">What is persisted</p>
              <ul className="mt-3 space-y-2 text-sm text-[var(--muted-foreground)]">
                <li>Theme and onboarding completion.</li>
                <li>Runtime draft so you do not re-enter mesh data each launch.</li>
                <li>Signed local chat archives for every opened room.</li>
              </ul>
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={onSkip}>
                Open shell only
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
