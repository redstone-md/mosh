import { describe, expect, it } from 'vitest'

import { decryptSecretArchive, encryptSecretArchive } from './secretArchive'
import type { StoredMessage } from './appShellSchemas'

describe('secret archive', () => {
  it('stores secret history encrypted behind a passphrase', async () => {
    const messages: StoredMessage[] = [
      {
        id: 'm1',
        roomId: 'secret-dm-a-b',
        author: 'alice',
        body: '<p>secret</p>',
        timestamp: '2026-05-02T00:00:00.000Z',
        emphasis: 'normal',
        storedAt: '2026-05-02T00:00:01.000Z',
      },
    ]

    const archive = await encryptSecretArchive('secret-dm-a-b', messages, 'correct horse battery staple')

    expect(archive.ciphertext).not.toContain('secret')
    await expect(decryptSecretArchive(archive, 'wrong passphrase')).rejects.toThrow()
    await expect(decryptSecretArchive(archive, 'correct horse battery staple')).resolves.toEqual(messages)
  })
})
