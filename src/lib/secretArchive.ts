import type { EncryptedSecretArchive, StoredMessage } from './appShellSchemas'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const DEFAULT_ITERATIONS = 310_000

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function randomBytes(byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return bytes
}

async function deriveArchiveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (!passphrase.trim()) {
    throw new Error('Secret archive passphrase is required.')
  }
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: bytesToArrayBuffer(salt),
      iterations,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptSecretArchive(
  roomId: string,
  messages: StoredMessage[],
  passphrase: string
): Promise<EncryptedSecretArchive> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await deriveArchiveKey(passphrase, salt, DEFAULT_ITERATIONS)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: bytesToArrayBuffer(iv), additionalData: bytesToArrayBuffer(encoder.encode(roomId)) },
    key,
    encoder.encode(JSON.stringify(messages))
  )

  return {
    schemaVersion: 1,
    roomId,
    kdf: {
      name: 'PBKDF2-SHA256',
      salt: bytesToBase64(salt),
      iterations: DEFAULT_ITERATIONS,
    },
    cipher: {
      name: 'AES-GCM',
      iv: bytesToBase64(iv),
    },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    updatedAt: new Date().toISOString(),
  }
}

export async function decryptSecretArchive(
  archive: EncryptedSecretArchive,
  passphrase: string
): Promise<StoredMessage[]> {
  const key = await deriveArchiveKey(passphrase, base64ToBytes(archive.kdf.salt), archive.kdf.iterations)
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: bytesToArrayBuffer(base64ToBytes(archive.cipher.iv)),
      additionalData: bytesToArrayBuffer(encoder.encode(archive.roomId)),
    },
    key,
    bytesToArrayBuffer(base64ToBytes(archive.ciphertext))
  )
  const parsed = JSON.parse(decoder.decode(plaintext))
  return Array.isArray(parsed) ? parsed : []
}
