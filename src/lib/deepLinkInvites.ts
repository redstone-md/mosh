import type { MeshInvitePayload } from './meshInvite'

export type PendingDeepLinkInvite = {
  sourceUrl: string
  invite: MeshInvitePayload
}

export function extractInviteDeepLinks(urls: string[]): string[] {
  const seen = new Set<string>()
  const invites: string[] = []

  for (const value of urls) {
    const normalized = value.trim()
    if (!normalized || !normalized.toLowerCase().startsWith('mosh://invite/')) {
      continue
    }
    if (seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    invites.push(normalized)
  }

  return invites
}

export function appendUniqueDeepLinkInvites(
  current: PendingDeepLinkInvite[],
  candidates: PendingDeepLinkInvite[]
): PendingDeepLinkInvite[] {
  const seen = new Set(current.map((invite) => invite.sourceUrl))
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
