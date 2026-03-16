import { describe, expect, it } from 'vitest'

import { encodeBytesToBase64Url } from './base64Url'
import { buildIdentityTransferHandoff } from './identityTransferHandoff'

function createTransferPayload(extraCipherText = '123') {
  return encodeBytesToBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        exportedAt: '2026-03-16T10:30:00.000Z',
        sourceFingerprint: 'ab:cd:ef',
        salt: 'abc',
        iv: 'def',
        cipherText: extraCipherText,
      }),
    ),
  )
}

describe('identityTransferHandoff', () => {
  it('normalizes raw payloads into the identity transfer scheme', () => {
    const handoff = buildIdentityTransferHandoff(createTransferPayload())

    expect(handoff.normalizedPackage).toBe(`mosh-identity://transfer/${createTransferPayload()}`)
    expect(handoff.qrValue).toBe(`mosh-identity://transfer/${createTransferPayload()}`)
  })

  it('builds a deterministic short code from the package payload', () => {
    const payload = createTransferPayload()
    const handoff = buildIdentityTransferHandoff(payload)

    expect(handoff.shortCode).toBe(payload.slice(0, 16).toUpperCase().match(/.{1,4}/g)?.join('-'))
    expect(handoff.summary.sourceFingerprint).toBe('ab:cd:ef')
  })

  it('splits the package preview into readable lines', () => {
    const handoff = buildIdentityTransferHandoff(createTransferPayload('1234567890abcdefghijklmnopqrstuvwxyz'))

    expect(handoff.previewLines.length).toBeGreaterThan(1)
    expect(handoff.previewLines[0]).toBe(`mosh-identity://transfer/${createTransferPayload('1234567890abcdefghijklmnopqrstuvwxyz').slice(0, 3)}`)
  })
})
