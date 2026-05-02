import {
  archiveStoreSchema,
  channelTypeSchema,
  shellPreferencesSchema,
  type ChannelType,
  type RoomGroup,
  type ShellPreferences,
  type SigningIdentity,
  type SignedRoomArchive,
  type StoredMessage,
} from './appShellSchemas'
import {
  createSigningIdentity,
  parseSigningIdentity,
  signSerializedPayload,
  upgradeSigningIdentity,
  verifySerializedPayload,
} from './cryptoIdentity'
import { desktopStorageClient } from './desktopStorageClient'
import type { Message, RoomSummary, UpdateRuntimeSettingsInput } from './schemas'
import { isTauriEnvironment } from './tauriEnv'

const SHELL_PREFERENCES_KEY = 'mosh.shell.preferences.v1'
const SIGNING_IDENTITY_KEY = 'mosh.shell.identity.v1'
const CHAT_ARCHIVE_KEY = 'mosh.shell.archives.v1'

let migrationPromise: Promise<void> | null = null

export type VerifiedArchive = SignedRoomArchive & {
  verified: boolean
}

export type ShellBootstrap = {
  preferences: ShellPreferences
  hasPersistedPreferences: boolean
}

export function createDefaultRuntimeDraft(): UpdateRuntimeSettingsInput {
  return {
    nickname: 'operator',
    meshId: 'mosh-chat',
    listenPort: 0,
    initialRoom: 'lobby',
    startupPeer: '',
    trackerMode: 'default',
    lanDiscoveryEnabled: true,
  }
}

export function createDefaultPreferences(): ShellPreferences {
  return {
    theme: 'moss',
    languagePreference: 'system',
    onboardingCompleted: false,
    selectedDock: 'group',
    selectedGroupId: 'mesh',
    selectedRoomId: 'lobby',
    selectedPanel: 'chat',
    runtimeDraft: createDefaultRuntimeDraft(),
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
    roomDrafts: {},
    messageOverlays: {},
    pinnedMessages: {},
    mutedRooms: [],
    lastReadMessageIds: {},
    identityTransferHistory: [],
    identityRollbackSnapshots: [],
    trustedPeers: {},
  }
}

export async function loadShellBootstrap(): Promise<ShellBootstrap> {
  const legacyPreferences = loadLegacyPreferences()
  const hasLegacyPreferences = hasLegacyPersistedPreferences()

  if (!isTauriEnvironment()) {
    return {
      preferences: legacyPreferences,
      hasPersistedPreferences: hasLegacyPreferences,
    }
  }

  await migrateLegacyStorage()

  const storedPreferences = await desktopStorageClient.loadPreferences()
  return {
    preferences: storedPreferences ?? legacyPreferences,
    hasPersistedPreferences: storedPreferences !== null || hasLegacyPreferences,
  }
}

export async function savePreferences(value: ShellPreferences): Promise<void> {
  if (isTauriEnvironment()) {
    await desktopStorageClient.savePreferences(value)
    return
  }

  getLocalStorage()?.setItem(SHELL_PREFERENCES_KEY, JSON.stringify(value))
}

export function reconcileGroups(groups: RoomGroup[], rooms: RoomSummary[]): RoomGroup[] {
  const channelIds = rooms.filter((room) => room.kind === 'channel').map((room) => room.id)

  if (channelIds.length === 0) {
    return groups
  }

  const baseGroups = groups.length > 0 ? groups : createDefaultPreferences().groups
  const availableIds = new Set(channelIds)
  const normalized = baseGroups.map((group) => ({
    ...group,
    roomIds: group.roomIds.filter((roomId) => availableIds.has(roomId)),
  }))

  const assignedRoomIds = new Set(normalized.flatMap((group) => group.roomIds))
  const unassigned = channelIds.filter((roomId) => !assignedRoomIds.has(roomId))

  if (normalized.length === 0) {
    return [
      {
        id: 'mesh',
        name: 'Mesh',
        icon: 'MS',
        accent: 'forest',
        roomIds: channelIds,
      },
    ]
  }

  if (unassigned.length > 0) {
    normalized[0] = {
      ...normalized[0],
      roomIds: Array.from(new Set([...normalized[0].roomIds, ...unassigned])),
    }
  }

  return normalized
}

export function reconcileRoomTypes(
  current: Record<string, ChannelType>,
  rooms: RoomSummary[]
): Record<string, ChannelType> {
  const next: Record<string, ChannelType> = {}

  for (const room of rooms) {
    if (room.kind === 'channel') {
      next[room.id] =
        current[room.id] ??
        (room.id.startsWith('voice-') || room.label.toLowerCase().includes('voice') ? 'voice' : 'text')
    }
  }

  return next
}

export function getChannelType(room: RoomSummary | undefined, roomTypes: Record<string, ChannelType>): ChannelType {
  if (!room || room.kind !== 'channel') {
    return 'text'
  }
  return roomTypes[room.id] ?? 'text'
}

export function isChannelType(value: string): value is ChannelType {
  return channelTypeSchema.safeParse(value).success
}

export async function ensureSigningIdentity() {
  if (isTauriEnvironment()) {
    await migrateLegacyStorage()

    const storedIdentity = await desktopStorageClient.loadSigningIdentity()
    if (storedIdentity) {
      const upgraded = await upgradeSigningIdentity(storedIdentity)
      if (upgraded !== storedIdentity) {
        await desktopStorageClient.saveSigningIdentity(upgraded)
      }
      return upgraded
    }
  }

  const legacyIdentity = loadLegacySigningIdentity()
  if (legacyIdentity) {
    const upgraded = await upgradeSigningIdentity(legacyIdentity)
    if (isTauriEnvironment()) {
      await desktopStorageClient.saveSigningIdentity(upgraded)
    } else {
      getLocalStorage()?.setItem(SIGNING_IDENTITY_KEY, JSON.stringify(upgraded))
    }
    return upgraded
  }

  const identity = await createSigningIdentity()

  if (isTauriEnvironment()) {
    await desktopStorageClient.saveSigningIdentity(identity)
  } else {
    getLocalStorage()?.setItem(SIGNING_IDENTITY_KEY, JSON.stringify(identity))
  }

  return identity
}

export async function regenerateSigningIdentity() {
  const identity = await createSigningIdentity()

  await replaceSigningIdentity(identity)
  return identity
}

export async function replaceSigningIdentity(identity: SigningIdentity) {
  const normalized = parseSigningIdentity(identity)
  if (!normalized) {
    throw new Error('Imported signing identity is invalid.')
  }
  const upgraded = await upgradeSigningIdentity(normalized)

  if (isTauriEnvironment()) {
    await desktopStorageClient.saveSigningIdentity(upgraded)
  } else {
    getLocalStorage()?.setItem(SIGNING_IDENTITY_KEY, JSON.stringify(upgraded))
  }

  return upgraded
}

export async function readVerifiedArchive(roomId: string): Promise<VerifiedArchive | null> {
  const archive = await loadRoomArchive(roomId)
  if (!archive) {
    return null
  }

  const payload = serializeArchive(roomId, archive.messages)
  const verified = await verifySerializedPayload(archive.publicKeyJwk, payload, archive.signature)
  return {
    ...archive,
    verified,
  }
}

export async function persistSignedArchive(roomId: string, messages: Message[]): Promise<VerifiedArchive> {
  const identity = await ensureSigningIdentity()
  const archiveMessages = messages.filter(isArchivableMessage).map<StoredMessage>((message) => ({
    ...message,
    storedAt: new Date().toISOString(),
  }))
  const payload = serializeArchive(roomId, archiveMessages)
  const signature = await signSerializedPayload(identity, payload)

  const archive: SignedRoomArchive = {
    roomId,
    signerFingerprint: identity.fingerprint,
    publicKeyJwk: identity.publicKeyJwk,
    signature,
    signedAt: new Date().toISOString(),
    messages: archiveMessages,
  }

  if (isTauriEnvironment()) {
    await desktopStorageClient.saveRoomArchive(roomId, archive)
  } else {
    const store = loadLegacyArchiveStore()
    store[roomId] = archive
    saveLegacyArchiveStore(store)
  }

  return {
    ...archive,
    verified: true,
  }
}

export function mergeArchivedMessages(archived: StoredMessage[], live: Message[]): Message[] {
  const merged = new Map<string, Message>()

  for (const message of archived) {
    if (!isArchivableMessage(message)) {
      continue
    }
    merged.set(message.id, {
      id: message.id,
      roomId: message.roomId,
      author: message.author,
      body: message.body,
      timestamp: message.timestamp,
      emphasis: message.emphasis,
    })
  }

  for (const message of live) {
    if (!isArchivableMessage(message)) {
      continue
    }
    merged.set(message.id, message)
  }

  return Array.from(merged.values()).sort((left, right) => left.id.localeCompare(right.id))
}

async function migrateLegacyStorage(): Promise<void> {
  if (!isTauriEnvironment()) {
    return
  }

  if (!migrationPromise) {
    migrationPromise = runLegacyMigration()
  }

  return migrationPromise
}

async function runLegacyMigration(): Promise<void> {
  const localStorage = getLocalStorage()
  if (!localStorage) {
    return
  }

  const [storedPreferences, storedIdentity] = await Promise.all([
    desktopStorageClient.loadPreferences(),
    desktopStorageClient.loadSigningIdentity(),
  ])

  const legacyPreferences = parseLegacyPreferences(localStorage.getItem(SHELL_PREFERENCES_KEY))
  if (!storedPreferences && legacyPreferences) {
    await desktopStorageClient.savePreferences(legacyPreferences)
  }

  const legacyIdentity = loadLegacySigningIdentity()
  if (!storedIdentity && legacyIdentity) {
    await desktopStorageClient.saveSigningIdentity(legacyIdentity)
  }

  const legacyArchives = loadLegacyArchiveStore()
  for (const [roomId, archive] of Object.entries(legacyArchives)) {
    const storedArchive = await desktopStorageClient.loadRoomArchive(roomId)
    if (!storedArchive) {
      await desktopStorageClient.saveRoomArchive(roomId, archive)
    }
  }
}

async function loadRoomArchive(roomId: string): Promise<SignedRoomArchive | null> {
  if (isTauriEnvironment()) {
    await migrateLegacyStorage()
    return desktopStorageClient.loadRoomArchive(roomId)
  }

  return loadLegacyArchiveStore()[roomId] ?? null
}

function loadLegacyPreferences(): ShellPreferences {
  return parseLegacyPreferences(getLocalStorage()?.getItem(SHELL_PREFERENCES_KEY) ?? null) ?? createDefaultPreferences()
}

function parseLegacyPreferences(raw: string | null): ShellPreferences | null {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    const result = shellPreferencesSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

function hasLegacyPersistedPreferences(): boolean {
  return getLocalStorage()?.getItem(SHELL_PREFERENCES_KEY) !== null
}

function loadLegacyArchiveStore(): Record<string, SignedRoomArchive> {
  const raw = getLocalStorage()?.getItem(CHAT_ARCHIVE_KEY)
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw)
    const result = archiveStoreSchema.safeParse(parsed)
    return result.success ? result.data : {}
  } catch {
    return {}
  }
}

function saveLegacyArchiveStore(store: Record<string, SignedRoomArchive>): void {
  getLocalStorage()?.setItem(CHAT_ARCHIVE_KEY, JSON.stringify(store))
}

function loadLegacySigningIdentity() {
  const raw = getLocalStorage()?.getItem(SIGNING_IDENTITY_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    return parseSigningIdentity(parsed)
  } catch {
    return null
  }
}

function serializeArchive(roomId: string, messages: StoredMessage[]): string {
  return JSON.stringify({
    roomId,
    messages,
  })
}

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isArchivableMessage(message: Pick<Message, 'id'>): boolean {
  return !message.id.startsWith('m-offline-') && !message.id.startsWith('m-failed-')
}
