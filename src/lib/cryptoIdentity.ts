import type { SigningIdentity } from './appShellSchemas'
import { signingIdentitySchema } from './appShellSchemas'

const encoder = new TextEncoder()

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

async function fingerprintPublicKey(publicKey: JsonWebKey): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(publicKey)))
  const bytes = new Uint8Array(digest)
  return Array.from(bytes.slice(0, 6))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(':')
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

export async function createSecureFingerprint(
  signingPublicKeyJwk: JsonWebKey,
  encryptionPublicKeyJwk: JsonWebKey
): Promise<string> {
  const payload = canonicalJson({
    encryptionPublicKeyJwk,
    signingPublicKeyJwk,
    version: 2,
  })
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(payload))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(':')
}

async function createEncryptionKeyPair() {
  return crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveBits']
  )
}

export async function createSigningIdentity(): Promise<SigningIdentity> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['sign', 'verify']
  )

  const [publicKeyJwk, privateKeyJwk] = await Promise.all([
    crypto.subtle.exportKey('jwk', keyPair.publicKey),
    crypto.subtle.exportKey('jwk', keyPair.privateKey),
  ])

  const encryptionKeyPair = await createEncryptionKeyPair()
  const [encryptionPublicKeyJwk, encryptionPrivateKeyJwk] = await Promise.all([
    crypto.subtle.exportKey('jwk', encryptionKeyPair.publicKey),
    crypto.subtle.exportKey('jwk', encryptionKeyPair.privateKey),
  ])

  return {
    algorithm: 'ECDSA-P256',
    identityVersion: 2 as const,
    fingerprint: await fingerprintPublicKey(publicKeyJwk),
    secureFingerprint: await createSecureFingerprint(publicKeyJwk, encryptionPublicKeyJwk),
    publicKeyJwk: publicKeyJwk as Record<string, unknown>,
    privateKeyJwk: privateKeyJwk as Record<string, unknown>,
    encryptionPublicKeyJwk: encryptionPublicKeyJwk as Record<string, unknown>,
    encryptionPrivateKeyJwk: encryptionPrivateKeyJwk as Record<string, unknown>,
  }
}

export function hasEncryptionIdentity(identity: SigningIdentity): identity is SigningIdentity & {
  identityVersion: 2
  secureFingerprint: string
  encryptionPublicKeyJwk: Record<string, unknown>
  encryptionPrivateKeyJwk: Record<string, unknown>
} {
  return Boolean(
    identity.identityVersion === 2 &&
    identity.secureFingerprint &&
    identity.encryptionPublicKeyJwk &&
    identity.encryptionPrivateKeyJwk
  )
}

export async function upgradeSigningIdentity(identity: SigningIdentity): Promise<SigningIdentity> {
  if (hasEncryptionIdentity(identity)) {
    return identity
  }

  const encryptionKeyPair = await createEncryptionKeyPair()
  const [encryptionPublicKeyJwk, encryptionPrivateKeyJwk] = await Promise.all([
    crypto.subtle.exportKey('jwk', encryptionKeyPair.publicKey),
    crypto.subtle.exportKey('jwk', encryptionKeyPair.privateKey),
  ])

  return {
    ...identity,
    identityVersion: 2 as const,
    secureFingerprint: await createSecureFingerprint(identity.publicKeyJwk as JsonWebKey, encryptionPublicKeyJwk),
    encryptionPublicKeyJwk: encryptionPublicKeyJwk as Record<string, unknown>,
    encryptionPrivateKeyJwk: encryptionPrivateKeyJwk as Record<string, unknown>,
  }
}

export async function signSerializedPayload(identity: SigningIdentity, payload: string): Promise<string> {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    identity.privateKeyJwk,
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: 'SHA-256',
    },
    privateKey,
    encoder.encode(payload)
  )

  return arrayBufferToBase64(signature)
}

export async function verifySerializedPayload(
  publicKeyJwk: JsonWebKey,
  payload: string,
  signature: string
): Promise<boolean> {
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    publicKeyJwk,
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    false,
    ['verify']
  )

  return crypto.subtle.verify(
    {
      name: 'ECDSA',
      hash: 'SHA-256',
    },
    publicKey,
    base64ToArrayBuffer(signature),
    encoder.encode(payload)
  )
}

export function parseSigningIdentity(raw: unknown): SigningIdentity | null {
  const result = signingIdentitySchema.safeParse(raw)
  return result.success ? result.data : null
}

export function signingIdentityPublicBundle(identity: SigningIdentity) {
  if (!hasEncryptionIdentity(identity)) {
    return null
  }

  return {
    identityVersion: 2 as const,
    secureFingerprint: identity.secureFingerprint,
    signingPublicKeyJwk: identity.publicKeyJwk,
    encryptionPublicKeyJwk: identity.encryptionPublicKeyJwk,
  }
}
