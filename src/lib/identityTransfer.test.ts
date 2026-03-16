import { describe, expect, it } from 'vitest'

import {
  exportIdentityTransferPackage,
  importIdentityTransferPackage,
  readIdentityTransferSummary,
} from './identityTransfer'

const identity = {
  algorithm: 'ECDSA-P256' as const,
  fingerprint: 'ab:cd:ef:12:34:56',
  publicKeyJwk: {
    kty: 'EC',
    crv: 'P-256',
    x: 'public-x',
    y: 'public-y',
    ext: true,
    key_ops: ['verify'],
  },
  privateKeyJwk: {
    kty: 'EC',
    crv: 'P-256',
    x: 'private-x',
    y: 'private-y',
    d: 'private-d',
    ext: true,
    key_ops: ['sign'],
  },
}

describe('identityTransfer', () => {
  it('roundtrips a signing identity through an encrypted transfer package', async () => {
    const transferPackage = await exportIdentityTransferPackage(identity, 'top-secret-passphrase')

    await expect(importIdentityTransferPackage(transferPackage, 'top-secret-passphrase')).resolves.toEqual(
      identity,
    )
  })

  it('rejects a wrong passphrase', async () => {
    const transferPackage = await exportIdentityTransferPackage(identity, 'top-secret-passphrase')

    await expect(importIdentityTransferPackage(transferPackage, 'wrong-passphrase')).rejects.toThrow(
      /Unable to decrypt/,
    )
  })

  it('rejects too-short passphrases at export time', async () => {
    await expect(exportIdentityTransferPackage(identity, 'short')).rejects.toThrow(/at least 8 characters/)
  })

  it('reads summary metadata without decrypting the package', async () => {
    const transferPackage = await exportIdentityTransferPackage(identity, 'top-secret-passphrase')

    expect(readIdentityTransferSummary(transferPackage)).toMatchObject({
      sourceFingerprint: identity.fingerprint,
    })
  })
})
