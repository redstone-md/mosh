function hasBrowserBase64() {
  return typeof btoa === 'function' && typeof atob === 'function'
}

function getNodeBuffer() {
  return (globalThis as { Buffer?: { from: (value: Uint8Array | string, encoding?: string) => Uint8Array & { toString: (encoding?: string) => string } } }).Buffer
}

export function encodeBytesToBase64Url(bytes: Uint8Array): string {
  if (hasBrowserBase64()) {
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }

  const buffer = getNodeBuffer()
  if (!buffer) {
    throw new Error('Base64 URL encoding is unavailable in this environment.')
  }

  return buffer.from(bytes).toString('base64url')
}

export function decodeBase64UrlToBytes(value: string): Uint8Array {
  if (hasBrowserBase64()) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }

    return bytes
  }

  const buffer = getNodeBuffer()
  if (!buffer) {
    throw new Error('Base64 URL decoding is unavailable in this environment.')
  }

  return Uint8Array.from(buffer.from(value, 'base64url'))
}
