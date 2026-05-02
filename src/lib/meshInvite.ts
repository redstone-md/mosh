import { z } from 'zod'

import { decodeBase64UrlToBytes, encodeBytesToBase64Url } from './base64Url'
import { updateRuntimeSettingsInputSchema } from './schemas'

const meshInvitePayloadSchema = z.object({
  version: z.literal(1),
  inviterName: z.string().trim().min(1).max(128),
  inviterFingerprint: z.string().min(1).optional(),
  runtime: updateRuntimeSettingsInputSchema,
})

export type MeshInvitePayload = z.infer<typeof meshInvitePayloadSchema>

export function buildMeshInvite(
  inviterName: string,
  runtime: z.input<typeof updateRuntimeSettingsInputSchema>,
  inviterFingerprint?: string
): MeshInvitePayload {
  return meshInvitePayloadSchema.parse({
    version: 1,
    inviterName,
    inviterFingerprint,
    runtime,
  })
}

export function encodeMeshInvite(payload: MeshInvitePayload): string {
  const normalized = meshInvitePayloadSchema.parse(payload)
  const json = JSON.stringify(normalized)
  const bytes = new TextEncoder().encode(json)
  return `mosh://invite/${encodeBytesToBase64Url(bytes)}`
}

export function decodeMeshInvite(value: string): MeshInvitePayload {
  const normalized = value.trim()
  const encoded = normalized.startsWith('mosh://invite/') ? normalized.slice('mosh://invite/'.length) : normalized

  if (!encoded) {
    throw new Error('Invite is empty.')
  }

  try {
    const json = new TextDecoder().decode(decodeBase64UrlToBytes(encoded))
    return meshInvitePayloadSchema.parse(JSON.parse(json))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Invite is invalid.')
  }
}
