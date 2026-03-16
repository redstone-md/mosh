import { describe, expect, it } from 'vitest'

import { buildIdentityTransferHandoff } from './identityTransferHandoff'

describe('identityTransferHandoff', () => {
  it('normalizes raw payloads into the identity transfer scheme', () => {
    const handoff = buildIdentityTransferHandoff('abc_def-123')

    expect(handoff.normalizedPackage).toBe('mosh-identity://transfer/abc_def-123')
    expect(handoff.qrValue).toBe('mosh-identity://transfer/abc_def-123')
  })

  it('builds a deterministic short code from the package payload', () => {
    const handoff = buildIdentityTransferHandoff('mosh-identity://transfer/abc_def-123')

    expect(handoff.shortCode).toBe('ABCD-EF12-3XXX-XXXX')
  })

  it('splits the package preview into readable lines', () => {
    const handoff = buildIdentityTransferHandoff(
      'mosh-identity://transfer/abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz',
    )

    expect(handoff.previewLines.length).toBeGreaterThan(1)
    expect(handoff.previewLines[0]).toBe('mosh-identity://transfer/abc')
  })
})
