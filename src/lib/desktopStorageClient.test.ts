import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
}))

describe('desktopStorageClient', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('parses storage overview payloads', async () => {
    invoke.mockResolvedValue({
      baseDir: 'C:/Users/example/AppData/Local/md.redstone.mosh',
      logsDir: 'C:/Users/example/AppData/Local/md.redstone.mosh/logs',
      settingsPath: 'C:/Users/example/AppData/Local/md.redstone.mosh/config/settings.json',
      identityPath: 'C:/Users/example/AppData/Local/md.redstone.mosh/keys/signing-identity.json',
      archivesDir: 'C:/Users/example/AppData/Local/md.redstone.mosh/data/archives',
      archiveCount: 4,
      hasSettings: true,
      hasSigningIdentity: true,
    })

    const { desktopStorageClient } = await import('./desktopStorageClient')
    const overview = await desktopStorageClient.getStorageOverview()

    expect(overview.archiveCount).toBe(4)
    expect(overview.hasSettings).toBe(true)
    expect(overview.logsDir).toContain('/logs')
    expect(invoke).toHaveBeenCalledWith('storage_overview')
  })

  it('starts native backup export flow', async () => {
    invoke.mockResolvedValue(true)

    const { desktopStorageClient } = await import('./desktopStorageClient')
    const exported = await desktopStorageClient.exportBackup()

    expect(exported).toBe(true)
    expect(invoke).toHaveBeenCalledWith('export_storage_backup')
  })

  it('parses all room archives payloads', async () => {
    invoke.mockResolvedValue([
      {
        roomId: 'lobby',
        signerFingerprint: 'aa:bb',
        publicKeyJwk: { kty: 'EC' },
        signature: 'sig',
        signedAt: '2026-03-16T10:00:00.000Z',
        messages: [],
      },
    ])

    const { desktopStorageClient } = await import('./desktopStorageClient')
    const archives = await desktopStorageClient.loadAllRoomArchives()

    expect(archives[0]?.roomId).toBe('lobby')
    expect(invoke).toHaveBeenCalledWith('load_all_room_archives')
  })

  it('starts native backup import flow', async () => {
    invoke.mockResolvedValue(true)

    const { desktopStorageClient } = await import('./desktopStorageClient')
    const imported = await desktopStorageClient.importBackup()

    expect(imported).toBe(true)
    expect(invoke).toHaveBeenCalledWith('import_storage_backup')
  })
})
