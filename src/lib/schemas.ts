import { z } from 'zod'

import { MAX_WEBRTC_SIGNAL_DATA_LENGTH } from './webrtcSignals'

export const artifactSchema = z.object({
  name: z.string().min(1),
  platform: z.string().min(1),
  notes: z.string().min(1),
})

export const runtimeStatusSchema = z.object({
  state: z.string().min(1),
  summary: z.string().min(1),
  route: z.string().min(1),
  natHint: z.string().min(1),
  sharedBridge: z.string().min(1),
})

export const roomSummarySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  unread: z.number().int().nonnegative(),
  participants: z.number().int().nonnegative(),
  kind: z.string().min(1),
})

export const messageSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  author: z.string().min(1),
  body: z.string().min(1),
  timestamp: z.string().min(1),
  emphasis: z.string().min(1),
})

export const peerSummarySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  route: z.string().min(1),
  latency: z.string().min(1),
  status: z.string().min(1),
  rooms: z.array(z.string().min(1)),
  identityVersion: z.number().int().optional().nullable(),
  secureFingerprint: z.string().min(1).optional().nullable(),
  signingPublicKeyJwk: z.record(z.string(), z.unknown()).optional().nullable(),
  encryptionPublicKeyJwk: z.record(z.string(), z.unknown()).optional().nullable(),
})

export const secretMessageEventSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  senderPeerId: z.string().min(1),
  payloadJson: z.string().min(1),
  receivedAt: z.string().min(1),
})

export const callStateSchema = z.object({
  callId: z.string().min(1),
  peerId: z.string().min(1),
  peerName: z.string().min(1),
  roomId: z.string().min(1),
  status: z.string().min(1),
  direction: z.string().min(1),
})

export const signalingEventSchema = z.object({
  id: z.string().min(1),
  callId: z.string().min(1),
  roomId: z.string().min(1),
  peerId: z.string().min(1),
  signalType: z.enum(['offer', 'answer', 'ice-candidate']),
  signalData: z.string().min(1).max(MAX_WEBRTC_SIGNAL_DATA_LENGTH),
  sentAt: z.string().min(1),
})

export const voiceParticipantSchema = z.object({
  peerId: z.string().min(1),
  peerName: z.string().min(1),
  isSelf: z.boolean(),
})

export const voiceRoomSchema = z.object({
  roomId: z.string().min(1),
  joined: z.boolean(),
  participants: z.array(voiceParticipantSchema),
})

export const runtimeSettingsSchema = z.object({
  nickname: z.string().min(1),
  meshId: z.string().min(1),
  listenPort: z.number().int().min(0).max(65535),
  initialRoom: z.string().min(1),
  startupPeer: z.string(),
  trackerMode: z.enum(['default', 'disabled']),
  lanDiscoveryEnabled: z.boolean(),
  configPreview: z.string().min(1),
})

export const runtimeDiagnosticsSchema = z.object({
  configuredNickname: z.string().min(1),
  configuredMeshId: z.string().min(1),
  configuredListenPort: z.string().min(1),
  initialRoom: z.string().min(1),
  startupPeer: z.string().min(1),
  trackerMode: z.string().min(1),
  lanDiscovery: z.string().min(1),
  activeMeshId: z.string().min(1),
  activeListenPort: z.string().min(1),
  peerCount: z.number().int().nonnegative(),
  knownPeerCount: z.number().int().nonnegative(),
  directPeerCount: z.number().int().nonnegative(),
  relayedPeerCount: z.number().int().nonnegative(),
  relayCapablePeerCount: z.number().int().nonnegative(),
  relaySessionCount: z.number().int().nonnegative(),
  relayRouteCount: z.number().int().nonnegative(),
  trackerCandidateCount: z.number().int().nonnegative(),
  trackerConnectedCount: z.number().int().nonnegative(),
  advertisedAddr: z.string().min(1),
  natType: z.string().min(1),
  channelCount: z.number().int().nonnegative(),
  activeChannels: z.array(z.string().min(1)),
  supernodeReady: z.boolean(),
})

export const updateRuntimeSettingsInputSchema = z.object({
  nickname: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dot, dash, or underscore')
    .transform((value) => value.toLowerCase()),
  meshId: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dot, dash, or underscore'),
  listenPort: z.coerce.number().int().min(0).max(65535),
  initialRoom: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dot, dash, or underscore')
    .transform((value) => value.replace(/^#/, '').toLowerCase()),
  startupPeer: z
    .string()
    .trim()
    .transform((value) => value)
    .refine((value) => value === '' || /^[^:\s]+:\d+$/.test(value), 'Use HOST:PORT'),
  trackerMode: z.enum(['default', 'disabled']),
  lanDiscoveryEnabled: z.boolean(),
})

export const subscribeRoomInputSchema = z.object({
  room: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.replace(/^#/, '').toLowerCase()),
})

export const connectPeerInputSchema = z.object({
  addr: z
    .string()
    .trim()
    .min(3)
    .regex(/^[^:\s]+:\d+$/, 'Use HOST:PORT'),
})

export const openDirectRoomInputSchema = z.object({
  target: z.string().trim().min(1).max(128),
})

export const openSecretRoomInputSchema = z.object({
  target: z.string().trim().min(1).max(128),
})

export const identityPresenceInputSchema = z.object({
  identityVersion: z.literal(2),
  secureFingerprint: z.string().min(1),
  signingPublicKeyJwk: z.record(z.string(), z.unknown()),
  encryptionPublicKeyJwk: z.record(z.string(), z.unknown()),
})

export const publishMessageInputSchema = z.object({
  room: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.replace(/^#/, '').toLowerCase()),
  body: z.string().trim().min(1).max(65535),
})

export const publishSecretMessageInputSchema = z.object({
  room: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.replace(/^#/, '').toLowerCase()),
  payloadJson: z.string().trim().min(1).max(262_144),
})

export const startCallInputSchema = z.object({
  target: z.string().trim().min(1).max(128),
})

export const sendCallSignalInputSchema = z.object({
  targetPeerId: z.string().trim().min(1),
  callId: z.string().trim().min(1),
  room: z.string().trim().min(1),
  signalType: z.string().trim().min(1).max(64),
  signalData: z.string().trim().min(1).max(MAX_WEBRTC_SIGNAL_DATA_LENGTH),
})

export const joinVoiceRoomInputSchema = z.object({
  room: z.string().trim().min(1),
})

export const milestoneSchema = z.object({
  title: z.string().min(1),
  detail: z.string().min(1),
  status: z.enum(['ready', 'next', 'blocked']),
})

export const desktopSnapshotSchema = z.object({
  appName: z.string().min(1),
  version: z.string().min(1),
  branch: z.string().min(1),
  stage: z.string().min(1),
  runtime: runtimeStatusSchema,
  settings: runtimeSettingsSchema,
  diagnostics: runtimeDiagnosticsSchema,
  rooms: z.array(roomSummarySchema),
  messages: z.array(messageSchema),
  secretMessages: z.array(secretMessageEventSchema).default([]),
  peers: z.array(peerSummarySchema),
  callState: callStateSchema.nullable(),
  signalingEvents: z.array(signalingEventSchema),
  voiceRooms: z.array(voiceRoomSchema),
})

export type Artifact = z.infer<typeof artifactSchema>
export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>
export type RuntimeSettings = z.infer<typeof runtimeSettingsSchema>
export type RuntimeDiagnostics = z.infer<typeof runtimeDiagnosticsSchema>
export type RoomSummary = z.infer<typeof roomSummarySchema>
export type Message = z.infer<typeof messageSchema>
export type PeerSummary = z.infer<typeof peerSummarySchema>
export type SecretMessageEvent = z.infer<typeof secretMessageEventSchema>
export type CallState = z.infer<typeof callStateSchema>
export type SignalingEvent = z.infer<typeof signalingEventSchema>
export type VoiceParticipant = z.infer<typeof voiceParticipantSchema>
export type VoiceRoom = z.infer<typeof voiceRoomSchema>
export type Milestone = z.infer<typeof milestoneSchema>
export type DesktopSnapshot = z.infer<typeof desktopSnapshotSchema>
export type UpdateRuntimeSettingsInput = z.infer<typeof updateRuntimeSettingsInputSchema>
export type SubscribeRoomInput = z.infer<typeof subscribeRoomInputSchema>
export type ConnectPeerInput = z.infer<typeof connectPeerInputSchema>
export type OpenDirectRoomInput = z.infer<typeof openDirectRoomInputSchema>
export type OpenSecretRoomInput = z.infer<typeof openSecretRoomInputSchema>
export type IdentityPresenceInput = z.infer<typeof identityPresenceInputSchema>
export type PublishMessageInput = z.infer<typeof publishMessageInputSchema>
export type PublishSecretMessageInput = z.infer<typeof publishSecretMessageInputSchema>
export type StartCallInput = z.infer<typeof startCallInputSchema>
export type SendCallSignalInput = z.infer<typeof sendCallSignalInputSchema>
export type JoinVoiceRoomInput = z.infer<typeof joinVoiceRoomInputSchema>
