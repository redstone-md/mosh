import {
  archiveStoreSchema,
  channelTypeSchema,
  shellPreferencesSchema,
  type ChannelType,
  type RoomGroup,
  type ShellPreferences,
  type SignedRoomArchive,
  type StoredMessage,
  type ThemeId,
} from './appShellSchemas'
import type { Message, RoomSummary, UpdateRuntimeSettingsInput } from './schemas'
import {
  createSigningIdentity,
  parseSigningIdentity,
  signSerializedPayload,
  verifySerializedPayload,
} from './cryptoIdentity'

const SHELL_PREFERENCES_KEY = 'mosh.shell.preferences.v1'
const SIGNING_IDENTITY_KEY = 'mosh.shell.identity.v1'
const CHAT_ARCHIVE_KEY = 'mosh.shell.archives.v1'

export type VerifiedArchive = SignedRoomArchive & {
  verified: boolean
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
  }
}

export function loadPreferences(): ShellPreferences {
  const fallback = createDefaultPreferences()
  const raw = window.localStorage.getItem(SHELL_PREFERENCES_KEY)
  if (!raw) {
    return fallback
  }
  try {
    const parsed = JSON.parse(raw)
    const result = shellPreferencesSchema.safeParse(parsed)
    return result.success ? result.data : fallback
  } catch {
    return fallback
  }
}

export function savePreferences(value: ShellPreferences): void {
  window.localStorage.setItem(SHELL_PREFERENCES_KEY, JSON.stringify(value))
}

export function hasPersistedPreferences(): boolean {
  return window.localStorage.getItem(SHELL_PREFERENCES_KEY) !== null
}

export function reconcileGroups(groups: RoomGroup[], rooms: RoomSummary[]): RoomGroup[] {
  const channelIds = rooms
    .filter((room) => room.kind === 'channel')
    .map((room) => room.id)

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
  rooms: RoomSummary[],
): Record<string, ChannelType> {
  const next: Record<string, ChannelType> = {}

  for (const room of rooms) {
    if (room.kind === 'channel') {
      next[room.id] =
        current[room.id] ??
        (room.id.startsWith('voice-') || room.label.toLowerCase().includes('voice')
          ? 'voice'
          : 'text')
    }
  }

  return next
}

export function getChannelType(
  room: RoomSummary | undefined,
  roomTypes: Record<string, ChannelType>,
): ChannelType {
  if (!room || room.kind !== 'channel') {
    return 'text'
  }
  return roomTypes[room.id] ?? 'text'
}

export function isChannelType(value: string): value is ChannelType {
  return channelTypeSchema.safeParse(value).success
}

export function getThemeLabel(theme: ThemeId): string {
  switch (theme) {
    case 'moss':
      return 'Moss'
    case 'graphite':
      return 'Graphite'
    case 'linen':
      return 'Linen'
    case 'ember':
      return 'Ember'
  }
}

function loadArchiveStore(): Record<string, SignedRoomArchive> {
  const raw = window.localStorage.getItem(CHAT_ARCHIVE_KEY)
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

function saveArchiveStore(store: Record<string, SignedRoomArchive>): void {
  window.localStorage.setItem(CHAT_ARCHIVE_KEY, JSON.stringify(store))
}

function serializeArchive(roomId: string, messages: StoredMessage[]): string {
  return JSON.stringify({
    roomId,
    messages,
  })
}

export async function ensureSigningIdentity() {
  const raw = window.localStorage.getItem(SIGNING_IDENTITY_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      const identity = parseSigningIdentity(parsed)
      if (identity) {
        return identity
      }
    } catch {
      // regenerate below
    }
  }

  const identity = await createSigningIdentity()
  window.localStorage.setItem(SIGNING_IDENTITY_KEY, JSON.stringify(identity))
  return identity
}

export async function readVerifiedArchive(roomId: string): Promise<VerifiedArchive | null> {
  const store = loadArchiveStore()
  const archive = store[roomId]
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

export async function persistSignedArchive(
  roomId: string,
  messages: Message[],
): Promise<VerifiedArchive> {
  const identity = await ensureSigningIdentity()
  const archiveMessages = messages.map<StoredMessage>((message) => ({
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

  const store = loadArchiveStore()
  store[roomId] = archive
  saveArchiveStore(store)

  return {
    ...archive,
    verified: true,
  }
}

export function mergeArchivedMessages(archived: StoredMessage[], live: Message[]): Message[] {
  const merged = new Map<string, Message>()

  for (const message of archived) {
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
    merged.set(message.id, message)
  }

  return Array.from(merged.values()).sort((left, right) => left.id.localeCompare(right.id))
}
