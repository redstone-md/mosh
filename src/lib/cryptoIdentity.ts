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

  return {
    algorithm: 'ECDSA-P256',
    fingerprint: await fingerprintPublicKey(publicKeyJwk),
    publicKeyJwk: publicKeyJwk as Record<string, unknown>,
    privateKeyJwk: privateKeyJwk as Record<string, unknown>,
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
