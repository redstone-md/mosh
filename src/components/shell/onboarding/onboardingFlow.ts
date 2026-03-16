import type { I18nCopy } from '../../../lib/i18n'
import type { UpdateRuntimeSettingsInput } from '../../../lib/schemas'

export type OnboardingStep = {
  id: 'identity' | 'topology' | 'ports' | 'discovery'
  title: string
  subtitle: string
}

export function buildOnboardingSteps(copy: I18nCopy): OnboardingStep[] {
  return [
    {
      id: 'identity',
      title: copy.onboarding.steps.identity.title,
      subtitle: copy.onboarding.steps.identity.subtitle,
    },
    {
      id: 'topology',
      title: copy.onboarding.steps.topology.title,
      subtitle: copy.onboarding.steps.topology.subtitle,
    },
    {
      id: 'ports',
      title: copy.onboarding.steps.ports.title,
      subtitle: copy.onboarding.steps.ports.subtitle,
    },
    {
      id: 'discovery',
      title: copy.onboarding.steps.discovery.title,
      subtitle: copy.onboarding.steps.discovery.subtitle,
    },
  ]
}

export function getOnboardingStepError(
  stepIndex: number,
  draft: UpdateRuntimeSettingsInput,
  copy: I18nCopy,
): string | null {
  if (stepIndex === 0 && draft.nickname.trim().length === 0) {
    return copy.onboarding.validation.nicknameRequired
  }

  return null
}
