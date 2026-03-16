import { describe, expect, it } from 'vitest'

import { appendIdentityTransferEvent } from './identityTransferHistory'

describe('identityTransferHistory', () => {
  it('prepends newer transfer events', () => {
    const history = appendIdentityTransferEvent([], {
      action: 'export',
      channel: 'manual',
      activeFingerprint: 'aa:bb',
      packageSourceFingerprint: 'aa:bb',
      occurredAt: '2026-03-16T10:00:00.000Z',
    })

    const next = appendIdentityTransferEvent(history, {
      action: 'import',
      channel: 'deep-link',
      activeFingerprint: 'cc:dd',
      replacedFingerprint: 'aa:bb',
      packageSourceFingerprint: 'cc:dd',
      packageExportedAt: '2026-03-16T09:30:00.000Z',
      occurredAt: '2026-03-16T10:05:00.000Z',
    })

    expect(next[0]).toMatchObject({
      action: 'import',
      replacedFingerprint: 'aa:bb',
      activeFingerprint: 'cc:dd',
    })
    expect(next[1]).toMatchObject({
      action: 'export',
    })
  })

  it('caps the stored history length', () => {
    let history = [] as ReturnType<typeof appendIdentityTransferEvent>

    for (let index = 0; index < 20; index += 1) {
      history = appendIdentityTransferEvent(history, {
        action: 'export',
        channel: 'manual',
        activeFingerprint: `fp-${index}`,
        packageSourceFingerprint: `fp-${index}`,
        occurredAt: `2026-03-16T10:${index.toString().padStart(2, '0')}:00.000Z`,
      })
    }

    expect(history).toHaveLength(16)
    expect(history[0].activeFingerprint).toBe('fp-19')
    expect(history.at(-1)?.activeFingerprint).toBe('fp-4')
  })
})
