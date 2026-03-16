import { normalizeIdentityTransferPackage } from './identityTransfer'

const SHORT_CODE_GROUP_LENGTH = 4
const SHORT_CODE_GROUP_COUNT = 4
const PACKAGE_PREVIEW_CHUNK = 28

export type IdentityTransferHandoff = {
  normalizedPackage: string
  qrValue: string
  shortCode: string
  previewLines: string[]
}

export function buildIdentityTransferHandoff(value: string): IdentityTransferHandoff {
  const normalizedPackage = normalizeIdentityTransferPackage(value)
  const encodedPayload = normalizedPackage.slice('mosh-identity://transfer/'.length)
  const alphanumeric = encodedPayload.replace(/[^a-z0-9]/gi, '').toUpperCase()
  const requiredLength = SHORT_CODE_GROUP_LENGTH * SHORT_CODE_GROUP_COUNT
  const paddedCode = `${alphanumeric}${'X'.repeat(requiredLength)}`.slice(0, requiredLength)

  return {
    normalizedPackage,
    qrValue: normalizedPackage,
    shortCode: splitIntoChunks(paddedCode, SHORT_CODE_GROUP_LENGTH).join('-'),
    previewLines: splitIntoChunks(normalizedPackage, PACKAGE_PREVIEW_CHUNK).slice(0, 6),
  }
}

function splitIntoChunks(value: string, size: number) {
  const chunks: string[] = []

  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size))
  }

  return chunks
}
