import { describe, expect, it } from 'vitest'

import { encodeBytesToBase64Url } from './base64Url'
import {
  appendUniqueDeepLinkIdentityTransfers,
  decodePendingIdentityTransfer,
  extractIdentityTransferDeepLinks,
} from './deepLinkIdentityTransfers'

function createTransferUrl(name: string) {
  return `mosh-identity://transfer/${encodeBytesToBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        exportedAt: '2026-03-16T10:30:00.000Z',
        sourceFingerprint: name,
        salt: 'abc',
        iv: 'def',
        cipherText: '123',
      })
    )
  )}`
}

describe('deepLinkIdentityTransfers', () => {
  it('extracts only identity transfer links', () => {
    expect(
      extractIdentityTransferDeepLinks([
        ' mosh-identity://transfer/alpha ',
        'mosh://invite/room',
        'MOSH-IDENTITY://TRANSFER/beta',
      ])
    ).toEqual(['mosh-identity://transfer/alpha', 'MOSH-IDENTITY://TRANSFER/beta'])
  })

  it('builds a pending transfer payload with handoff metadata', () => {
    const pending = decodePendingIdentityTransfer(createTransferUrl('ab:cd:ef'))

    expect(pending.transferPackage).toBe(createTransferUrl('ab:cd:ef'))
    expect(pending.handoff.summary.sourceFingerprint).toBe('ab:cd:ef')
  })

  it('normalizes mixed-case identity transfer schemes before decoding', () => {
    const transferUrl = createTransferUrl('ab:cd:ef')
    const mixedCaseUrl = transferUrl.replace('mosh-identity://transfer/', 'MOSH-IDENTITY://TRANSFER/')
    const pending = decodePendingIdentityTransfer(mixedCaseUrl)

    expect(pending.transferPackage).toBe(transferUrl)
    expect(pending.handoff.summary.sourceFingerprint).toBe('ab:cd:ef')
  })

  it('appends only unique transfer urls', () => {
    const alpha = decodePendingIdentityTransfer(createTransferUrl('alpha'))
    const beta = decodePendingIdentityTransfer(createTransferUrl('beta'))

    expect(appendUniqueDeepLinkIdentityTransfers([alpha], [alpha, beta]).map((entry) => entry.sourceUrl)).toEqual([
      createTransferUrl('alpha'),
      createTransferUrl('beta'),
    ])
  })
})
