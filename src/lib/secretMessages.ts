import { z } from 'zod'

import type { SigningIdentity, TrustedPeerRecord } from './appShellSchemas'
import { hasEncryptionIdentity, signSerializedPayload, verifySerializedPayload } from './cryptoIdentity'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const secretMessageEnvelopeSchema = z.object({
  kind: z.literal('secret_message'),
  version: z.literal(1),
  meshId: z.string().min(1),
  roomId: z.string().min(1),
  senderPeerId: z.string().min(1),
  recipientPeerId: z.string().min(1),
  senderSecureFingerprint: z.string().min(1),
  recipientSecureFingerprint: z.string().min(1),
  nonce: z.string().min(1),
  sentAt: z.string().min(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
  signature: z.string().min(1),
})

export type SecretMessageEnvelope = z.infer<typeof secretMessageEnvelopeSchema>

export type SecretPeerKeys = Pick<
  TrustedPeerRecord,
  'secureFingerprint' | 'signingPublicKeyJwk' | 'encryptionPublicKeyJwk'
>

export type SecretMessageInput = {
  meshId: string
  roomId: string
  senderPeerId: string
  recipientPeerId: string
  body: string
  senderIdentity: SigningIdentity
  recipient: SecretPeerKeys
}

export type SecretMessageDecryptInput = {
  envelope: SecretMessageEnvelope
  localPeerId: string
  localIdentity: SigningIdentity
  sender: SecretPeerKeys
}

export type OwnSecretMessageDecryptInput = {
  envelope: SecretMessageEnvelope
  localPeerId: string
  localIdentity: SigningIdentity
  recipient: SecretPeerKeys
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function randomBase64(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return bytesToBase64(bytes)
}

function envelopeSigningPayload(envelope: Omit<SecretMessageEnvelope, 'signature'>): string {
  return canonicalJson(envelope)
}

function aadPayload(envelope: Omit<SecretMessageEnvelope, 'ciphertext' | 'signature'>): ArrayBuffer {
  return bytesToArrayBuffer(encoder.encode(canonicalJson(envelope)))
}

async function deriveSecretKey(
  privateKeyJwk: JsonWebKey,
  publicKeyJwk: JsonWebKey,
  envelope: Omit<SecretMessageEnvelope, 'ciphertext' | 'signature'>
): Promise<CryptoKey> {
  const [privateKey, publicKey] = await Promise.all([
    crypto.subtle.importKey('jwk', privateKeyJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']),
    crypto.subtle.importKey('jwk', publicKeyJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []),
  ])
  const sharedSecret = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  const hkdfKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey'])
  const salt = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(
      canonicalJson({
        meshId: envelope.meshId,
        nonce: envelope.nonce,
        recipientPeerId: envelope.recipientPeerId,
        recipientSecureFingerprint: envelope.recipientSecureFingerprint,
        roomId: envelope.roomId,
        senderPeerId: envelope.senderPeerId,
        senderSecureFingerprint: envelope.senderSecureFingerprint,
      })
    )
  )

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: encoder.encode('MOSH secret dm v1'),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function assertPeerKeys(keys: SecretPeerKeys, label: string): asserts keys is Required<SecretPeerKeys> {
  if (!keys.secureFingerprint || !keys.signingPublicKeyJwk || !keys.encryptionPublicKeyJwk) {
    throw new Error(`${label} has not announced E2EE keys.`)
  }
}

export function secretRoomName(localPeerId: string, remotePeerId: string): string {
  let left = localPeerId.trim().toLowerCase()
  let right = remotePeerId.trim().toLowerCase()
  if (!left || !right) {
    return 'secret-dm'
  }
  if (left > right) {
    ;[left, right] = [right, left]
  }
  return `secret-dm-${left.slice(0, 16)}-${right.slice(0, 16)}`
}

export async function encryptSecretMessage(input: SecretMessageInput): Promise<SecretMessageEnvelope> {
  if (!hasEncryptionIdentity(input.senderIdentity)) {
    throw new Error('Local identity has no E2EE encryption key.')
  }
  assertPeerKeys(input.recipient, 'Recipient')

  const metadata = {
    kind: 'secret_message' as const,
    version: 1 as const,
    meshId: input.meshId,
    roomId: input.roomId,
    senderPeerId: input.senderPeerId,
    recipientPeerId: input.recipientPeerId,
    senderSecureFingerprint: input.senderIdentity.secureFingerprint,
    recipientSecureFingerprint: input.recipient.secureFingerprint,
    nonce: randomBase64(16),
    sentAt: new Date().toISOString(),
    iv: randomBase64(12),
  }
  const key = await deriveSecretKey(
    input.senderIdentity.encryptionPrivateKeyJwk as JsonWebKey,
    input.recipient.encryptionPublicKeyJwk as JsonWebKey,
    metadata
  )
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: bytesToArrayBuffer(base64ToBytes(metadata.iv)), additionalData: aadPayload(metadata) },
    key,
    encoder.encode(input.body)
  )
  const unsigned = {
    ...metadata,
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }

  return {
    ...unsigned,
    signature: await signSerializedPayload(input.senderIdentity, envelopeSigningPayload(unsigned)),
  }
}

export async function decryptSecretMessage(input: SecretMessageDecryptInput): Promise<string> {
  const envelope = secretMessageEnvelopeSchema.parse(input.envelope)
  if (!hasEncryptionIdentity(input.localIdentity)) {
    throw new Error('Local identity has no E2EE encryption key.')
  }
  assertPeerKeys(input.sender, 'Sender')
  if (envelope.recipientPeerId !== input.localPeerId) {
    throw new Error('Secret message is addressed to another peer.')
  }
  if (envelope.recipientSecureFingerprint !== input.localIdentity.secureFingerprint) {
    throw new Error('Recipient fingerprint does not match this identity.')
  }
  if (envelope.senderSecureFingerprint !== input.sender.secureFingerprint) {
    throw new Error('Sender fingerprint does not match trusted peer record.')
  }

  const { signature, ...unsigned } = envelope
  const signatureValid = await verifySerializedPayload(
    input.sender.signingPublicKeyJwk as JsonWebKey,
    envelopeSigningPayload(unsigned),
    signature
  )
  if (!signatureValid) {
    throw new Error('Secret message signature is invalid.')
  }

  const metadata = {
    kind: envelope.kind,
    version: envelope.version,
    meshId: envelope.meshId,
    roomId: envelope.roomId,
    senderPeerId: envelope.senderPeerId,
    recipientPeerId: envelope.recipientPeerId,
    senderSecureFingerprint: envelope.senderSecureFingerprint,
    recipientSecureFingerprint: envelope.recipientSecureFingerprint,
    nonce: envelope.nonce,
    sentAt: envelope.sentAt,
    iv: envelope.iv,
  }
  const key = await deriveSecretKey(
    input.localIdentity.encryptionPrivateKeyJwk as JsonWebKey,
    input.sender.encryptionPublicKeyJwk as JsonWebKey,
    metadata
  )
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytesToArrayBuffer(base64ToBytes(envelope.iv)), additionalData: aadPayload(metadata) },
    key,
    bytesToArrayBuffer(base64ToBytes(envelope.ciphertext))
  )

  return decoder.decode(plaintext)
}

export async function decryptOwnSecretMessage(input: OwnSecretMessageDecryptInput): Promise<string> {
  const envelope = secretMessageEnvelopeSchema.parse(input.envelope)
  if (!hasEncryptionIdentity(input.localIdentity)) {
    throw new Error('Local identity has no E2EE encryption key.')
  }
  assertPeerKeys(input.recipient, 'Recipient')
  if (envelope.senderPeerId !== input.localPeerId) {
    throw new Error('Secret message was sent by another peer.')
  }
  if (envelope.senderSecureFingerprint !== input.localIdentity.secureFingerprint) {
    throw new Error('Sender fingerprint does not match this identity.')
  }
  if (envelope.recipientSecureFingerprint !== input.recipient.secureFingerprint) {
    throw new Error('Recipient fingerprint does not match trusted peer record.')
  }

  const { signature, ...unsigned } = envelope
  const signatureValid = await verifySerializedPayload(
    input.localIdentity.publicKeyJwk as JsonWebKey,
    envelopeSigningPayload(unsigned),
    signature
  )
  if (!signatureValid) {
    throw new Error('Secret message signature is invalid.')
  }

  const metadata = {
    kind: envelope.kind,
    version: envelope.version,
    meshId: envelope.meshId,
    roomId: envelope.roomId,
    senderPeerId: envelope.senderPeerId,
    recipientPeerId: envelope.recipientPeerId,
    senderSecureFingerprint: envelope.senderSecureFingerprint,
    recipientSecureFingerprint: envelope.recipientSecureFingerprint,
    nonce: envelope.nonce,
    sentAt: envelope.sentAt,
    iv: envelope.iv,
  }
  const key = await deriveSecretKey(
    input.localIdentity.encryptionPrivateKeyJwk as JsonWebKey,
    input.recipient.encryptionPublicKeyJwk as JsonWebKey,
    metadata
  )
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytesToArrayBuffer(base64ToBytes(envelope.iv)), additionalData: aadPayload(metadata) },
    key,
    bytesToArrayBuffer(base64ToBytes(envelope.ciphertext))
  )

  return decoder.decode(plaintext)
}

export function serializeSecretEnvelope(envelope: SecretMessageEnvelope): string {
  return canonicalJson(secretMessageEnvelopeSchema.parse(envelope))
}

export function parseSecretEnvelope(raw: string): SecretMessageEnvelope {
  return secretMessageEnvelopeSchema.parse(JSON.parse(raw))
}
