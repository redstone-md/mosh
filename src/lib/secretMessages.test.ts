import { describe, expect, it } from 'vitest'

import { createSigningIdentity } from './cryptoIdentity'
import { decryptSecretMessage, encryptSecretMessage, secretRoomName, type SecretPeerKeys } from './secretMessages'

describe('secret messages', () => {
  it('encrypts and decrypts only for the intended trusted recipient', async () => {
    const alice = await createSigningIdentity()
    const bob = await createSigningIdentity()
    const roomId = secretRoomName('alice-peer', 'bob-peer')
    const envelope = await encryptSecretMessage({
      meshId: 'mesh',
      roomId,
      senderPeerId: 'alice-peer',
      recipientPeerId: 'bob-peer',
      body: '<p>secret</p>',
      senderIdentity: alice,
      recipient: peerKeys(bob),
    })

    await expect(
      decryptSecretMessage({
        envelope,
        localPeerId: 'bob-peer',
        localIdentity: bob,
        sender: peerKeys(alice),
      })
    ).resolves.toBe('<p>secret</p>')

    await expect(
      decryptSecretMessage({
        envelope,
        localPeerId: 'mallory-peer',
        localIdentity: bob,
        sender: peerKeys(alice),
      })
    ).rejects.toThrow(/another peer/i)
  })

  it('rejects tampered ciphertext and substituted sender keys', async () => {
    const alice = await createSigningIdentity()
    const bob = await createSigningIdentity()
    const mallory = await createSigningIdentity()
    const envelope = await encryptSecretMessage({
      meshId: 'mesh',
      roomId: secretRoomName('alice-peer', 'bob-peer'),
      senderPeerId: 'alice-peer',
      recipientPeerId: 'bob-peer',
      body: 'quiet',
      senderIdentity: alice,
      recipient: peerKeys(bob),
    })

    await expect(
      decryptSecretMessage({
        envelope: { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -2)}aa` },
        localPeerId: 'bob-peer',
        localIdentity: bob,
        sender: peerKeys(alice),
      })
    ).rejects.toThrow()

    await expect(
      decryptSecretMessage({
        envelope,
        localPeerId: 'bob-peer',
        localIdentity: bob,
        sender: peerKeys(mallory),
      })
    ).rejects.toThrow(/fingerprint/i)
  })
})

function peerKeys(identity: Awaited<ReturnType<typeof createSigningIdentity>>): Required<SecretPeerKeys> {
  if (!identity.secureFingerprint || !identity.encryptionPublicKeyJwk) {
    throw new Error('test identity was not upgraded')
  }
  return {
    secureFingerprint: identity.secureFingerprint,
    signingPublicKeyJwk: identity.publicKeyJwk,
    encryptionPublicKeyJwk: identity.encryptionPublicKeyJwk,
  }
}
