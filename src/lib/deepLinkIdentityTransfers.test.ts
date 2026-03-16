import { describe, expect, it } from 'vitest'

import {
  appendUniqueDeepLinkIdentityTransfers,
  decodePendingIdentityTransfer,
  extractIdentityTransferDeepLinks,
} from './deepLinkIdentityTransfers'

describe('deepLinkIdentityTransfers', () => {
  it('extracts only identity transfer links', () => {
    expect(
      extractIdentityTransferDeepLinks([
        ' mosh-identity://transfer/alpha ',
        'mosh://invite/room',
        'MOSH-IDENTITY://TRANSFER/beta',
      ]),
    ).toEqual(['mosh-identity://transfer/alpha', 'MOSH-IDENTITY://TRANSFER/beta'])
  })

  it('builds a pending transfer payload with handoff metadata', () => {
    const pending = decodePendingIdentityTransfer('mosh-identity://transfer/abc_def-123')

    expect(pending.transferPackage).toBe('mosh-identity://transfer/abc_def-123')
    expect(pending.handoff.shortCode).toBe('ABCD-EF12-3XXX-XXXX')
  })

  it('appends only unique transfer urls', () => {
    const alpha = decodePendingIdentityTransfer('mosh-identity://transfer/alpha')
    const beta = decodePendingIdentityTransfer('mosh-identity://transfer/beta')

    expect(
      appendUniqueDeepLinkIdentityTransfers([alpha], [alpha, beta]).map((entry) => entry.sourceUrl),
    ).toEqual(['mosh-identity://transfer/alpha', 'mosh-identity://transfer/beta'])
  })
})
