import { z } from 'zod'

import { updateRuntimeSettingsInputSchema } from './schemas'

const meshInvitePayloadSchema = z.object({
  version: z.literal(1),
  inviterName: z.string().trim().min(1).max(128),
  runtime: updateRuntimeSettingsInputSchema,
})

export type MeshInvitePayload = z.infer<typeof meshInvitePayloadSchema>

export function buildMeshInvite(
  inviterName: string,
  runtime: z.input<typeof updateRuntimeSettingsInputSchema>,
): MeshInvitePayload {
  return meshInvitePayloadSchema.parse({
    version: 1,
    inviterName,
    runtime,
  })
}

export function encodeMeshInvite(payload: MeshInvitePayload): string {
  const normalized = meshInvitePayloadSchema.parse(payload)
  const json = JSON.stringify(normalized)
  const bytes = new TextEncoder().encode(json)
  return `mosh://invite/${toBase64Url(bytes)}`
}

export function decodeMeshInvite(value: string): MeshInvitePayload {
  const normalized = value.trim()
  const encoded = normalized.startsWith('mosh://invite/')
    ? normalized.slice('mosh://invite/'.length)
    : normalized

  if (!encoded) {
    throw new Error('Invite is empty.')
  }

  try {
    const json = new TextDecoder().decode(fromBase64Url(encoded))
    return meshInvitePayloadSchema.parse(JSON.parse(json))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Invite is invalid.')
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}
