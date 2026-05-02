import { describe, expect, it } from 'vitest'

import { appendIdentityRollbackSnapshot, promoteRollbackSnapshot } from './identityRollback'

const identity = (fingerprint: string) => ({
  algorithm: 'ECDSA-P256' as const,
  fingerprint,
  publicKeyJwk: { kty: 'EC' },
  privateKeyJwk: { kty: 'EC' },
})

describe('identityRollback', () => {
  it('prepends snapshots and deduplicates by fingerprint', () => {
    const snapshots = appendIdentityRollbackSnapshot([], identity('aa:bb'), 'import')
    const next = appendIdentityRollbackSnapshot(snapshots, identity('aa:bb'), 'rollback')

    expect(next).toHaveLength(1)
    expect(next[0]?.source).toBe('rollback')
  })

  it('promotes the current identity back into the rollback list', () => {
    const snapshots = appendIdentityRollbackSnapshot([], identity('aa:bb'), 'import')
    const next = promoteRollbackSnapshot(snapshots, snapshots[0]!.id, identity('cc:dd'))

    expect(next[0]?.fingerprint).toBe('cc:dd')
    expect(next[0]?.source).toBe('rollback')
  })
})
