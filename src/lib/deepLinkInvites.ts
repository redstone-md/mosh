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
