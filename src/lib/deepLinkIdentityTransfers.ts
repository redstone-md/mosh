import { buildIdentityTransferHandoff, type IdentityTransferHandoff } from './identityTransferHandoff'
import { normalizeIdentityTransferPackage } from './identityTransfer'

export type PendingDeepLinkIdentityTransfer = {
  sourceUrl: string
  transferPackage: string
  handoff: IdentityTransferHandoff
}

const IDENTITY_TRANSFER_DEEP_LINK_PREFIX = 'mosh-identity://transfer/'

export function extractIdentityTransferDeepLinks(urls: string[]): string[] {
  const seen = new Set<string>()
  const transfers: string[] = []

  for (const value of urls) {
    const normalized = value.trim()
    if (!normalized || !normalized.toLowerCase().startsWith(IDENTITY_TRANSFER_DEEP_LINK_PREFIX)) {
      continue
    }
    if (seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    transfers.push(normalized)
  }

  return transfers
}

export function decodePendingIdentityTransfer(sourceUrl: string): PendingDeepLinkIdentityTransfer {
  const transferPackage = normalizeIdentityTransferPackage(sourceUrl)

  return {
    sourceUrl,
    transferPackage,
    handoff: buildIdentityTransferHandoff(transferPackage),
  }
}

export function appendUniqueDeepLinkIdentityTransfers(
  current: PendingDeepLinkIdentityTransfer[],
  candidates: PendingDeepLinkIdentityTransfer[],
): PendingDeepLinkIdentityTransfer[] {
  const seen = new Set(current.map((transfer) => transfer.sourceUrl))
  const next = [...current]

  for (const candidate of candidates) {
    if (seen.has(candidate.sourceUrl)) {
      continue
    }
    seen.add(candidate.sourceUrl)
    next.push(candidate)
  }

  return next
}
