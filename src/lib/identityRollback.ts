import type { IdentityRollbackSnapshot, SigningIdentity } from './appShellSchemas'

const IDENTITY_ROLLBACK_LIMIT = 5

export function appendIdentityRollbackSnapshot(
  snapshots: IdentityRollbackSnapshot[],
  identity: SigningIdentity,
  source: IdentityRollbackSnapshot['source']
): IdentityRollbackSnapshot[] {
  const nextSnapshot: IdentityRollbackSnapshot = {
    id: `${source}:${identity.fingerprint}:${new Date().toISOString()}`,
    source,
    capturedAt: new Date().toISOString(),
    fingerprint: identity.fingerprint,
    identity,
  }

  const filtered = snapshots.filter((snapshot) => snapshot.fingerprint !== identity.fingerprint)
  return [nextSnapshot, ...filtered].slice(0, IDENTITY_ROLLBACK_LIMIT)
}

export function promoteRollbackSnapshot(
  snapshots: IdentityRollbackSnapshot[],
  snapshotId: string,
  currentIdentity: SigningIdentity
): IdentityRollbackSnapshot[] {
  const remaining = snapshots.filter((snapshot) => snapshot.id !== snapshotId)
  return appendIdentityRollbackSnapshot(remaining, currentIdentity, 'rollback')
}
