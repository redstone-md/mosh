import { describe, expect, it } from 'vitest'

import { getI18nCopy } from '../../../lib/i18n'
import { buildOnboardingSteps, getOnboardingStepError } from './onboardingFlow'

const baseDraft = {
  nickname: 'operator',
  meshId: 'mosh-chat',
  listenPort: 0,
  initialRoom: 'lobby',
  startupPeer: '',
  trackerMode: 'default' as const,
  lanDiscoveryEnabled: true,
}

describe('onboarding flow helpers', () => {
  it('builds four onboarding steps in order', () => {
    const steps = buildOnboardingSteps(getI18nCopy('en'))
    expect(steps.map((step) => step.id)).toEqual(['identity', 'topology', 'ports', 'discovery'])
  })

  it('requires nickname on the identity step', () => {
    const copy = getI18nCopy('en')
    expect(getOnboardingStepError(0, { ...baseDraft, nickname: '   ' }, copy)).toBe(
      copy.onboarding.validation.nicknameRequired
    )
  })

  it('does not block later steps when optional fields are empty', () => {
    const copy = getI18nCopy('en')
    expect(getOnboardingStepError(2, { ...baseDraft, startupPeer: '' }, copy)).toBeNull()
  })
})
