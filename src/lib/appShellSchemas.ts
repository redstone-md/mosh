import { z } from 'zod'

import { messageSchema, updateRuntimeSettingsInputSchema } from './schemas'

export const themeIdSchema = z.enum(['moss', 'graphite', 'linen', 'ember'])
export const languagePreferenceSchema = z.enum(['system', 'en', 'ru'])

export const groupAccentSchema = z.enum(['forest', 'slate', 'sand', 'ember'])
export const channelTypeSchema = z.enum(['text', 'voice'])

export const roomGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(32),
  icon: z
    .string()
    .trim()
    .min(1)
    .max(2)
    .regex(/^[\p{L}\p{N}]{1,2}$/u, 'Use one or two letters'),
  accent: groupAccentSchema,
  roomIds: z.array(z.string().min(1)).max(256),
})

export const identityTransferEventSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['export', 'import', 'rollback']),
  channel: z.enum(['manual', 'deep-link']),
  occurredAt: z.string().min(1),
  activeFingerprint: z.string().min(1),
  replacedFingerprint: z.string().min(1).optional(),
  packageSourceFingerprint: z.string().min(1),
  packageExportedAt: z.string().min(1).optional(),
})

export const signingIdentitySchema = z.object({
  algorithm: z.literal('ECDSA-P256'),
  fingerprint: z.string().min(1),
  publicKeyJwk: z.record(z.string(), z.unknown()),
  privateKeyJwk: z.record(z.string(), z.unknown()),
})

export const identityRollbackSnapshotSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['import', 'rollback']),
  capturedAt: z.string().min(1),
  fingerprint: z.string().min(1),
  identity: signingIdentitySchema,
})

export const messageOverlaySchema = z.object({
  roomId: z.string().min(1),
  body: z.string().min(1).max(20_000).optional(),
  hidden: z.boolean().default(false),
  updatedAt: z.string().min(1),
})

export const shellPreferencesSchema = z.object({
  theme: themeIdSchema,
  languagePreference: languagePreferenceSchema.default('system'),
  onboardingCompleted: z.boolean(),
  selectedDock: z.enum(['home', 'group']),
  selectedGroupId: z.string().min(1),
  selectedRoomId: z.string().min(1),
  selectedPanel: z.enum(['chat', 'settings']),
  runtimeDraft: updateRuntimeSettingsInputSchema,
  groups: z.array(roomGroupSchema).max(32),
  roomTypes: z.record(z.string(), channelTypeSchema).default({}),
  roomDrafts: z.record(z.string(), z.string().max(20_000)).default({}),
  messageOverlays: z.record(z.string(), messageOverlaySchema).default({}),
  pinnedMessages: z.record(z.string(), z.array(z.string().min(1)).max(12)).default({}),
  mutedRooms: z.array(z.string().min(1)).max(256).default([]),
  lastReadMessageIds: z.record(z.string(), z.string().min(1)).default({}),
  identityTransferHistory: z.array(identityTransferEventSchema).max(16).default([]),
  identityRollbackSnapshots: z.array(identityRollbackSnapshotSchema).max(5).default([]),
  trustedPeers: z
    .record(
      z.string(),
      z.object({
        displayName: z.string().trim().min(1).max(128),
        approvedAt: z.string().min(1),
      }),
    )
    .default({}),
})

export const storedMessageSchema = messageSchema.extend({
  storedAt: z.string().min(1),
})

export const signedRoomArchiveSchema = z.object({
  roomId: z.string().min(1),
  signerFingerprint: z.string().min(1),
  publicKeyJwk: z.record(z.string(), z.unknown()),
  signature: z.string().min(1),
  signedAt: z.string().min(1),
  messages: z.array(storedMessageSchema).max(5000),
})

export const archiveStoreSchema = z.record(z.string(), signedRoomArchiveSchema)
export const storageOverviewSchema = z.object({
  baseDir: z.string().min(1),
  settingsPath: z.string().min(1),
  identityPath: z.string().min(1),
  archivesDir: z.string().min(1),
  archiveCount: z.number().int().nonnegative(),
  hasSettings: z.boolean(),
  hasSigningIdentity: z.boolean(),
})

export type ThemeId = z.infer<typeof themeIdSchema>
export type LanguagePreference = z.infer<typeof languagePreferenceSchema>
export type GroupAccent = z.infer<typeof groupAccentSchema>
export type ChannelType = z.infer<typeof channelTypeSchema>
export type RoomGroup = z.infer<typeof roomGroupSchema>
export type ShellPreferences = z.infer<typeof shellPreferencesSchema>
export type StoredMessage = z.infer<typeof storedMessageSchema>
export type TrustedPeerRecord = NonNullable<ShellPreferences['trustedPeers'][string]>
export type SigningIdentity = z.infer<typeof signingIdentitySchema>
export type IdentityTransferEvent = z.infer<typeof identityTransferEventSchema>
export type IdentityRollbackSnapshot = z.infer<typeof identityRollbackSnapshotSchema>
export type MessageOverlay = z.infer<typeof messageOverlaySchema>
export type SignedRoomArchive = z.infer<typeof signedRoomArchiveSchema>
export type StorageOverview = z.infer<typeof storageOverviewSchema>
