import { describe, expect, it } from 'vitest'

import { buildGlobalSearchEntries, searchGlobalMessages } from './globalMessageSearch'
import type { SignedRoomArchive } from './appShellSchemas'
import type { Message, RoomSummary } from './schemas'

const rooms: RoomSummary[] = [
  { id: 'lobby', label: 'Lobby', unread: 0, participants: 2, kind: 'channel' },
  { id: 'ops', label: 'Ops', unread: 0, participants: 2, kind: 'channel' },
]

function createMessage(id: string, roomId: string, body: string): Message {
  return {
    id,
    roomId,
    author: 'operator',
    body,
    timestamp: `10:0${id.at(-1) ?? '0'}`,
    emphasis: 'default',
  }
}

function createArchive(roomId: string, messages: Message[]): SignedRoomArchive {
  return {
    roomId,
    signerFingerprint: 'aa:bb',
    publicKeyJwk: { kty: 'EC' },
    signature: 'sig',
    signedAt: '2026-03-16T10:00:00.000Z',
    messages: messages.map((message) => ({
      ...message,
      storedAt: '2026-03-16T10:00:00.000Z',
    })),
  }
}

describe('globalMessageSearch', () => {
  it('merges archive and live messages, preferring live payloads', () => {
    const entries = buildGlobalSearchEntries(
      [createMessage('m-1', 'lobby', '<p>live body</p>')],
      [createArchive('lobby', [createMessage('m-1', 'lobby', '<p>archived body</p>')])],
      rooms
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]?.body).toBe('live body')
    expect(entries[0]?.source).toBe('live')
  })

  it('searches across room names and message bodies', () => {
    const entries = buildGlobalSearchEntries(
      [createMessage('m-1', 'lobby', '<p>handover ready</p>'), createMessage('m-2', 'ops', '<p>transport stable</p>')],
      [],
      rooms
    )

    expect(searchGlobalMessages(entries, 'transport')[0]?.messageId).toBe('m-2')
    expect(searchGlobalMessages(entries, 'lobby')[0]?.roomId).toBe('lobby')
  })

  it('returns newest matches first', () => {
    const entries = buildGlobalSearchEntries(
      [createMessage('m-1', 'lobby', '<p>mesh</p>'), createMessage('m-2', 'ops', '<p>mesh</p>')],
      [],
      rooms
    )

    const results = searchGlobalMessages(entries, 'mesh')
    expect(results[0]?.messageId).toBe('m-2')
    expect(results[1]?.messageId).toBe('m-1')
  })
})
