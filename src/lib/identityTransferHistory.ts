import type { IdentityTransferEvent } from './appShellSchemas'

const IDENTITY_TRANSFER_HISTORY_LIMIT = 16

type BaseTransferEventInput = {
  channel: IdentityTransferEvent['channel']
  occurredAt?: string
  packageSourceFingerprint: string
  packageExportedAt?: string
}

type ExportTransferEventInput = BaseTransferEventInput & {
  action: 'export'
  activeFingerprint: string
}

type ImportTransferEventInput = BaseTransferEventInput & {
  action: 'import'
  activeFingerprint: string
  replacedFingerprint: string
}

type RollbackTransferEventInput = BaseTransferEventInput & {
  action: 'rollback'
  activeFingerprint: string
  replacedFingerprint: string
}

export type IdentityTransferEventInput =
  | ExportTransferEventInput
  | ImportTransferEventInput
  | RollbackTransferEventInput

export function appendIdentityTransferEvent(
  history: IdentityTransferEvent[],
  input: IdentityTransferEventInput,
): IdentityTransferEvent[] {
  const occurredAt = input.occurredAt ?? new Date().toISOString()
  const event: IdentityTransferEvent = {
    ...input,
    id: `${input.action}:${input.channel}:${input.packageSourceFingerprint}:${occurredAt}`,
    occurredAt,
  }

  return [event, ...history].slice(0, IDENTITY_TRANSFER_HISTORY_LIMIT)
}
