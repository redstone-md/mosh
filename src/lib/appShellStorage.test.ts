import { beforeEach, describe, expect, it, vi } from 'vitest'

const SHELL_PREFERENCES_KEY = 'mosh.shell.preferences.v1'
const SIGNING_IDENTITY_KEY = 'mosh.shell.identity.v1'

let tauriEnvironment = false

const desktopStorageClient = {
  loadPreferences: vi.fn(),
  savePreferences: vi.fn(),
  loadSigningIdentity: vi.fn(),
  saveSigningIdentity: vi.fn(),
  loadRoomArchive: vi.fn(),
  saveRoomArchive: vi.fn(),
}

vi.mock('./desktopStorageClient', () => ({
  desktopStorageClient,
}))

vi.mock('./tauriEnv', () => ({
  isTauriEnvironment: () => tauriEnvironment,
}))

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const localStorage = new MemoryStorage()

Object.defineProperty(globalThis, 'window', {
  value: { localStorage },
  configurable: true,
})

async function loadModule() {
  vi.resetModules()
  return import('./appShellStorage')
}

function createStoredPreferences() {
  return {
    theme: 'moss',
    languagePreference: 'en',
    onboardingCompleted: true,
    selectedDock: 'group',
    selectedGroupId: 'mesh',
    selectedRoomId: 'lobby',
    selectedPanel: 'chat',
    runtimeDraft: {
      nickname: 'operator',
      meshId: 'mosh-chat',
      listenPort: 0,
      initialRoom: 'lobby',
      startupPeer: '',
      trackerMode: 'default',
      lanDiscoveryEnabled: true,
    },
    groups: [
      {
        id: 'mesh',
        name: 'Mesh',
        icon: 'MS',
        accent: 'forest',
        roomIds: ['lobby'],
      },
    ],
    roomTypes: {
      lobby: 'text',
    },
  } as const
}

function createStoredIdentity() {
  return {
    algorithm: 'ECDSA-P256',
    fingerprint: 'ab:cd:ef:12:34:56',
    publicKeyJwk: {
      kty: 'EC',
      crv: 'P-256',
      x: 'public-x',
      y: 'public-y',
      ext: true,
      key_ops: ['verify'],
    },
    privateKeyJwk: {
      kty: 'EC',
      crv: 'P-256',
      x: 'private-x',
      y: 'private-y',
      d: 'private-d',
      ext: true,
      key_ops: ['sign'],
    },
  } as const
}

describe('appShellStorage', () => {
  beforeEach(() => {
    tauriEnvironment = false
    localStorage.clear()
    Object.values(desktopStorageClient).forEach((mock) => mock.mockReset())
  })

  it('loads persisted preferences from localStorage outside Tauri', async () => {
    const storedPreferences = createStoredPreferences()
    localStorage.setItem(SHELL_PREFERENCES_KEY, JSON.stringify(storedPreferences))

    const { loadShellBootstrap } = await loadModule()
    const result = await loadShellBootstrap()

    expect(result.preferences).toEqual(storedPreferences)
    expect(result.hasPersistedPreferences).toBe(true)
    expect(desktopStorageClient.loadPreferences).not.toHaveBeenCalled()
  })

  it('migrates legacy preferences into desktop file storage on Tauri startup', async () => {
    tauriEnvironment = true
    const storedPreferences = createStoredPreferences()
    localStorage.setItem(SHELL_PREFERENCES_KEY, JSON.stringify(storedPreferences))
    desktopStorageClient.loadPreferences.mockResolvedValue(null)
    desktopStorageClient.loadSigningIdentity.mockResolvedValue(null)

    const { loadShellBootstrap } = await loadModule()
    const result = await loadShellBootstrap()

    expect(desktopStorageClient.savePreferences).toHaveBeenCalledWith(storedPreferences)
    expect(result.preferences).toEqual(storedPreferences)
    expect(result.hasPersistedPreferences).toBe(true)
  })

  it('migrates legacy signing identity into desktop file storage', async () => {
    tauriEnvironment = true
    const storedIdentity = createStoredIdentity()
    localStorage.setItem(SIGNING_IDENTITY_KEY, JSON.stringify(storedIdentity))
    desktopStorageClient.loadPreferences.mockResolvedValue(null)
    desktopStorageClient.loadSigningIdentity.mockResolvedValue(null)

    const { ensureSigningIdentity } = await loadModule()
    const identity = await ensureSigningIdentity()

    expect(desktopStorageClient.saveSigningIdentity).toHaveBeenCalledWith(storedIdentity)
    expect(identity).toEqual(storedIdentity)
  })
})
