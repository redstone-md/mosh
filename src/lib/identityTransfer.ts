import { z } from 'zod'

import { decodeBase64UrlToBytes, encodeBytesToBase64Url } from './base64Url'
import { signingIdentitySchema, type SigningIdentity } from './appShellSchemas'

const encoder = new TextEncoder()

const identityTransferEnvelopeSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().min(1),
  sourceFingerprint: z.string().min(1),
  salt: z.string().min(1),
  iv: z.string().min(1),
  cipherText: z.string().min(1),
})

const identityTransferPayloadSchema = z.object({
  version: z.literal(1),
  identity: signingIdentitySchema,
})

const decoder = new TextDecoder()

export type IdentityTransferEnvelope = z.infer<typeof identityTransferEnvelopeSchema>
export const IDENTITY_TRANSFER_PREFIX = 'mosh-identity://transfer/'
export type IdentityTransferSummary = Pick<IdentityTransferEnvelope, 'exportedAt' | 'sourceFingerprint'>

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export async function exportIdentityTransferPackage(identity: SigningIdentity, passphrase: string): Promise<string> {
  const normalizedPassphrase = normalizePassphrase(passphrase)
  const payload = identityTransferPayloadSchema.parse({
    version: 1,
    identity,
  })
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveTransferKey(normalizedPassphrase, salt)
  const cipherText = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    encoder.encode(JSON.stringify(payload))
  )

  return `${IDENTITY_TRANSFER_PREFIX}${encodeBytesToBase64Url(
    encoder.encode(
      JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        sourceFingerprint: identity.fingerprint,
        salt: encodeBytesToBase64Url(salt),
        iv: encodeBytesToBase64Url(iv),
        cipherText: encodeBytesToBase64Url(new Uint8Array(cipherText)),
      })
    )
  )}`
}

export async function importIdentityTransferPackage(
  transferPackage: string,
  passphrase: string
): Promise<SigningIdentity> {
  const normalizedPassphrase = normalizePassphrase(passphrase)
  const envelope = readIdentityTransferEnvelope(transferPackage)
  const key = await deriveTransferKey(normalizedPassphrase, decodeBase64UrlToBytes(envelope.salt))

  try {
    const iv = toArrayBuffer(decodeBase64UrlToBytes(envelope.iv))
    const cipherText = toArrayBuffer(decodeBase64UrlToBytes(envelope.cipherText))
    const payloadBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      cipherText
    )
    const payload = identityTransferPayloadSchema.parse(JSON.parse(decoder.decode(new Uint8Array(payloadBuffer))))
    if (payload.identity.fingerprint !== envelope.sourceFingerprint) {
      throw new Error('Identity transfer package fingerprint mismatch.')
    }
    return payload.identity
  } catch {
    throw new Error('Unable to decrypt the identity transfer package.')
  }
}

function normalizePassphrase(value: string) {
  const normalized = value.trim()
  if (normalized.length < 8) {
    throw new Error('Identity transfer passphrase must be at least 8 characters.')
  }
  return normalized
}

async function deriveTransferKey(passphrase: string, salt: Uint8Array) {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: 200_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  )
}

export function normalizeIdentityTransferPackage(value: string) {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error('Identity transfer package is empty.')
  }

  return normalized.startsWith(IDENTITY_TRANSFER_PREFIX) ? normalized : `${IDENTITY_TRANSFER_PREFIX}${normalized}`
}

export function readIdentityTransferSummary(value: string): IdentityTransferSummary {
  const envelope = readIdentityTransferEnvelope(value)

  return {
    exportedAt: envelope.exportedAt,
    sourceFingerprint: envelope.sourceFingerprint,
  }
}

function readIdentityTransferEnvelope(value: string): IdentityTransferEnvelope {
  const encodedEnvelope = normalizeIdentityTransferPackage(value).slice(IDENTITY_TRANSFER_PREFIX.length)
  return identityTransferEnvelopeSchema.parse(JSON.parse(decoder.decode(decodeBase64UrlToBytes(encodedEnvelope))))
}
