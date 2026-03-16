import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

import type { LanguagePreference, ThemeId } from '../../lib/appShellSchemas'
import type { RuntimeStatus, UpdateRuntimeSettingsInput } from '../../lib/schemas'
import { languagePreferenceOptions, localizeRuntimeState } from '../../lib/i18n'
import { useI18n } from '../I18nProvider'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { OnboardingMeshBackdrop } from './onboarding/OnboardingMeshBackdrop'
import { buildOnboardingSteps, getOnboardingStepError } from './onboarding/onboardingFlow'

const SPLASH_DURATION_MS = 2500

type OnboardingGateProps = {
  runtime: RuntimeStatus
  theme: ThemeId
  languagePreference: LanguagePreference
  playIntro: boolean
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
  playIntro,
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
  const [currentStep, setCurrentStep] = useState(0)
  const [showSplash, setShowSplash] = useState(playIntro)
  const [stepError, setStepError] = useState<string | null>(null)
  const steps = useMemo(() => buildOnboardingSteps(copy), [copy])
  const activeStep = steps[currentStep]

  useEffect(() => {
    if (!playIntro) {
      setShowSplash(false)
      return
    }

    const timeout = window.setTimeout(() => {
      setShowSplash(false)
    }, SPLASH_DURATION_MS)

    return () => window.clearTimeout(timeout)
  }, [playIntro])

  useEffect(() => {
    setStepError(null)
  }, [currentStep, runtimeDraft, languagePreference, theme])

  function updateDraft(patch: Partial<UpdateRuntimeSettingsInput>) {
    onRuntimeDraftChange({
      ...runtimeDraft,
      ...patch,
    })
  }

  function goNext() {
    const validationError = getOnboardingStepError(currentStep, runtimeDraft, copy)
    if (validationError) {
      setStepError(validationError)
      return
    }

    setStepError(null)
    setCurrentStep((value) => Math.min(value + 1, steps.length - 1))
  }

  return (
    <section className="relative flex flex-1 items-center justify-center overflow-hidden bg-[var(--app)]">
      <OnboardingMeshBackdrop />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(74,124,89,0.18),transparent_42%)]" />

      <AnimatePresence>
        {showSplash ? (
          <motion.div
            key="splash"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center px-6 text-center"
            initial={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
          >
            <motion.div
              className="text-[4.4rem] font-semibold tracking-[0.22em] text-[color-mix(in_srgb,var(--primary)_78%,white)] drop-shadow-[0_0_24px_rgba(143,203,155,0.26)] sm:text-[5.6rem]"
              animate={{ opacity: [0.72, 1, 0.82], scale: [1, 1.015, 1] }}
              transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, repeatType: 'mirror' }}
            >
              MOSH
            </motion.div>
            <div className="mt-4 text-sm tracking-[0.16em] text-[color-mix(in_srgb,var(--primary)_55%,var(--foreground))]">
              {copy.onboarding.splashTagline}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.div
        initial={playIntro ? { opacity: 0, y: 22 } : { opacity: 1, y: 0 }}
        animate={showSplash ? { opacity: 0, y: 22 } : { opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
        className="relative z-10 w-full max-w-[520px] px-6 py-8"
      >
        <div className="rounded-[24px] border border-[rgba(143,203,155,0.16)] bg-[rgba(27,58,36,0.34)] p-8 shadow-[0_24px_60px_rgba(0,0,0,0.42)] backdrop-blur-[18px]">
          <div className="mb-8 flex items-center justify-between gap-4">
            <div>
              <div className="text-[1.75rem] font-semibold text-[color-mix(in_srgb,var(--primary)_82%,white)]">
                {activeStep.title}
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                {activeStep.subtitle}
              </p>
            </div>
            <div className="rounded-full border border-[rgba(143,203,155,0.16)] bg-[rgba(10,23,16,0.42)] px-3 py-1.5 text-xs tracking-[0.08em] text-[var(--muted-foreground)]">
              {localizeRuntimeState(copy, runtime.state)}
            </div>
          </div>

          <div className="mb-7 flex justify-center gap-2">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className={
                  index === currentStep
                    ? 'h-2 w-7 rounded-full bg-[color-mix(in_srgb,var(--primary)_85%,white)]'
                    : 'h-2 w-2 rounded-full bg-[rgba(143,203,155,0.22)]'
                }
              />
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeStep.id}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="space-y-5"
            >
              {currentStep === 0 ? (
                <div className="space-y-2">
                  <Label htmlFor="onboarding-nickname" className="text-[0.9rem] text-[color-mix(in_srgb,var(--primary)_85%,white)]">
                    {copy.form.nickname}
                  </Label>
                  <Input
                    id="onboarding-nickname"
                    value={runtimeDraft.nickname}
                    disabled={isBusy}
                    onChange={(event) => updateDraft({ nickname: event.target.value })}
                    className="h-12 rounded-xl border-[rgba(74,124,89,0.7)] bg-[rgba(10,23,16,0.62)] text-base"
                  />
                </div>
              ) : null}

              {currentStep === 1 ? (
                <div className="grid gap-5">
                  <div className="space-y-2">
                    <Label htmlFor="onboarding-mesh-id" className="text-[0.9rem] text-[color-mix(in_srgb,var(--primary)_85%,white)]">
                      {copy.form.meshId}
                    </Label>
                    <Input
                      id="onboarding-mesh-id"
                      value={runtimeDraft.meshId}
                      disabled={isBusy}
                      onChange={(event) => updateDraft({ meshId: event.target.value })}
                      className="h-12 rounded-xl border-[rgba(74,124,89,0.7)] bg-[rgba(10,23,16,0.62)]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="onboarding-initial-room" className="text-[0.9rem] text-[color-mix(in_srgb,var(--primary)_85%,white)]">
                      {copy.form.initialChannel}
                    </Label>
                    <Input
                      id="onboarding-initial-room"
                      value={runtimeDraft.initialRoom}
                      disabled={isBusy}
                      onChange={(event) => updateDraft({ initialRoom: event.target.value })}
                      className="h-12 rounded-xl border-[rgba(74,124,89,0.7)] bg-[rgba(10,23,16,0.62)]"
                    />
                  </div>
                </div>
              ) : null}

              {currentStep === 2 ? (
                <div className="grid gap-5">
                  <div className="space-y-2">
                    <Label htmlFor="onboarding-startup-peer" className="text-[0.9rem] text-[color-mix(in_srgb,var(--primary)_85%,white)]">
                      {copy.form.startupPeer}
                    </Label>
                    <Input
                      id="onboarding-startup-peer"
                      value={runtimeDraft.startupPeer}
                      placeholder={copy.form.startupPeerPlaceholder}
                      disabled={isBusy}
                      onChange={(event) => updateDraft({ startupPeer: event.target.value })}
                      className="h-12 rounded-xl border-[rgba(74,124,89,0.7)] bg-[rgba(10,23,16,0.62)]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="onboarding-listen-port" className="text-[0.9rem] text-[color-mix(in_srgb,var(--primary)_85%,white)]">
                      {copy.form.listenPort}
                    </Label>
                    <Input
                      id="onboarding-listen-port"
                      type="number"
                      min={0}
                      max={65535}
                      value={runtimeDraft.listenPort}
                      disabled={isBusy}
                      onChange={(event) => updateDraft({ listenPort: Number(event.target.value || 0) })}
                      className="h-12 rounded-xl border-[rgba(74,124,89,0.7)] bg-[rgba(10,23,16,0.62)]"
                    />
                  </div>
                </div>
              ) : null}

              {currentStep === 3 ? (
                <div className="grid gap-5">
                  <div className="space-y-2">
                    <Label htmlFor="onboarding-tracker-mode" className="text-[0.9rem] text-[color-mix(in_srgb,var(--primary)_85%,white)]">
                      {copy.form.trackerBootstrap}
                    </Label>
                    <Select
                      value={runtimeDraft.trackerMode}
                      onValueChange={(value: 'default' | 'disabled') => updateDraft({ trackerMode: value })}
                    >
                      <SelectTrigger
                        id="onboarding-tracker-mode"
                        className="h-12 rounded-xl border-[rgba(74,124,89,0.7)] bg-[rgba(10,23,16,0.62)]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">{copy.runtime.trackerBuiltIn}</SelectItem>
                        <SelectItem value="disabled">{copy.runtime.trackerDisabled}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <label className="flex items-center justify-between rounded-xl border border-[rgba(74,124,89,0.7)] bg-[rgba(10,23,16,0.62)] px-4 py-3 text-sm text-[var(--foreground)]">
                    <span>{copy.form.lanDiscovery}</span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--primary)]"
                      checked={runtimeDraft.lanDiscoveryEnabled}
                      disabled={isBusy}
                      onChange={(event) => updateDraft({ lanDiscoveryEnabled: event.target.checked })}
                    />
                  </label>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-[0.9rem] text-[color-mix(in_srgb,var(--primary)_85%,white)]">
                        {copy.common.theme}
                      </Label>
                      <Select value={theme} onValueChange={(value: ThemeId) => onThemeChange(value)}>
                        <SelectTrigger className="h-12 rounded-xl border-[rgba(74,124,89,0.7)] bg-[rgba(10,23,16,0.62)]">
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
                    <div className="space-y-2">
                      <Label className="text-[0.9rem] text-[color-mix(in_srgb,var(--primary)_85%,white)]">
                        {copy.common.language}
                      </Label>
                      <Select
                        value={languagePreference}
                        onValueChange={(value: LanguagePreference) => onLanguagePreferenceChange(value)}
                      >
                        <SelectTrigger className="h-12 rounded-xl border-[rgba(74,124,89,0.7)] bg-[rgba(10,23,16,0.62)]">
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
              ) : null}
            </motion.div>
          </AnimatePresence>

          <div className="mt-7 flex min-h-5 items-center justify-between">
            <p className="text-sm text-[var(--danger)]">{stepError ?? errorNote ?? ''}</p>
            <div className="text-xs text-[var(--muted-foreground)]">{runtime.summary}</div>
          </div>

          <div className="mt-8 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {currentStep > 0 ? (
                <Button
                  variant="ghost"
                  onClick={() => setCurrentStep((value) => Math.max(value - 1, 0))}
                  disabled={isBusy}
                >
                  {copy.onboarding.controls.back}
                </Button>
              ) : (
                <div />
              )}
              <Button variant="ghost" onClick={onSkip} disabled={isBusy}>
                {copy.runtime.openShellOnly}
              </Button>
            </div>

            {currentStep === steps.length - 1 ? (
              <Button onClick={onStart} disabled={isBusy}>
                {isBusy ? copy.onboarding.controls.busy : copy.onboarding.controls.finish}
              </Button>
            ) : (
              <Button onClick={goNext} disabled={isBusy}>
                {copy.onboarding.controls.next}
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    </section>
  )
}
