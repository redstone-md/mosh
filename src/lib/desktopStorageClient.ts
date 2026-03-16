import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

import {
  shellPreferencesSchema,
  signedRoomArchiveSchema,
  signingIdentitySchema,
  storageOverviewSchema,
  type ShellPreferences,
  type SignedRoomArchive,
  type SigningIdentity,
  type StorageOverview,
} from './appShellSchemas'

export class DesktopStorageClient {
  async loadPreferences(): Promise<ShellPreferences | null> {
    const payload = await invoke('load_shell_preferences')
    if (payload === null) {
      return null
    }
    return shellPreferencesSchema.parse(payload)
  }

  async savePreferences(value: ShellPreferences): Promise<void> {
    const payload = shellPreferencesSchema.parse(value)
    await invoke('save_shell_preferences', { payload })
  }

  async loadSigningIdentity(): Promise<SigningIdentity | null> {
    const payload = await invoke('load_signing_identity')
    if (payload === null) {
      return null
    }
    return signingIdentitySchema.parse(payload)
  }

  async saveSigningIdentity(value: SigningIdentity): Promise<void> {
    const payload = signingIdentitySchema.parse(value)
    await invoke('save_signing_identity', { payload })
  }

  async loadRoomArchive(room: string): Promise<SignedRoomArchive | null> {
    const payload = await invoke('load_room_archive', { room })
    if (payload === null) {
      return null
    }
    return signedRoomArchiveSchema.parse(payload)
  }

  async loadAllRoomArchives(): Promise<SignedRoomArchive[]> {
    const payload = await invoke('load_all_room_archives')
    return z.array(signedRoomArchiveSchema).parse(payload)
  }

  async saveRoomArchive(room: string, value: SignedRoomArchive): Promise<void> {
    const payload = signedRoomArchiveSchema.parse(value)
    await invoke('save_room_archive', { room, payload })
  }

  async getStorageOverview(): Promise<StorageOverview> {
    const payload = await invoke('storage_overview')
    return storageOverviewSchema.parse(payload)
  }

  async exportBackup(path: string): Promise<void> {
    const parsedPath = z.string().trim().min(1).parse(path)
    await invoke('export_storage_backup', {
      payload: {
        path: parsedPath,
      },
    })
  }

  async importBackup(path: string): Promise<void> {
    const parsedPath = z.string().trim().min(1).parse(path)
    await invoke('import_storage_backup', {
      payload: {
        path: parsedPath,
      },
    })
  }
}

export const desktopStorageClient = new DesktopStorageClient()
