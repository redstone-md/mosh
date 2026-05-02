import { extractPlainText } from './messageSearch'
import type { SignedRoomArchive } from './appShellSchemas'
import type { Message, RoomSummary } from './schemas'

export type GlobalSearchEntry = {
  id: string
  roomId: string
  roomLabel: string
  author: string
  body: string
  timestamp: string
  source: 'live' | 'archive'
}

export type GlobalSearchResult = {
  messageId: string
  roomId: string
  roomLabel: string
  author: string
  preview: string
  timestamp: string
  source: 'live' | 'archive'
}

export function buildGlobalSearchEntries(
  messages: Message[],
  archives: SignedRoomArchive[],
  rooms: RoomSummary[]
): GlobalSearchEntry[] {
  const roomLabels = new Map(rooms.map((room) => [room.id, room.label] as const))
  const entries = new Map<string, GlobalSearchEntry>()

  for (const archive of archives) {
    for (const message of archive.messages) {
      upsertEntry(entries, message, roomLabels.get(message.roomId) ?? archive.roomId, 'archive')
    }
  }

  for (const message of messages) {
    upsertEntry(entries, message, roomLabels.get(message.roomId) ?? message.roomId, 'live')
  }

  return Array.from(entries.values()).sort((left, right) =>
    `${left.timestamp}-${left.id}`.localeCompare(`${right.timestamp}-${right.id}`)
  )
}

export function searchGlobalMessages(entries: GlobalSearchEntry[], rawQuery: string): GlobalSearchResult[] {
  const query = normalizeSearchText(rawQuery)
  if (!query) {
    return []
  }

  return entries
    .map((entry) => {
      const author = normalizeSearchText(entry.author)
      const body = normalizeSearchText(entry.body)
      const roomLabel = normalizeSearchText(entry.roomLabel)
      const haystack = `${author} ${roomLabel} ${body}`.trim()
      const index = haystack.indexOf(query)

      if (index === -1) {
        return null
      }

      return {
        messageId: entry.id,
        roomId: entry.roomId,
        roomLabel: entry.roomLabel,
        author: entry.author,
        preview: buildPreview(entry.body, query),
        timestamp: entry.timestamp,
        source: entry.source,
      } satisfies GlobalSearchResult
    })
    .filter((result): result is GlobalSearchResult => result !== null)
    .reverse()
}

function upsertEntry(
  entries: Map<string, GlobalSearchEntry>,
  message: Message,
  roomLabel: string,
  source: 'live' | 'archive'
) {
  const body = extractPlainText(message.body)
  const current = entries.get(message.id)

  if (!current || source === 'live') {
    entries.set(message.id, {
      id: message.id,
      roomId: message.roomId,
      roomLabel,
      author: message.author,
      body,
      timestamp: message.timestamp,
      source,
    })
  }
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function buildPreview(source: string, query: string): string {
  const compact = source.replace(/\s+/g, ' ').trim()
  if (!compact) {
    return ''
  }

  const normalized = normalizeSearchText(compact)
  const startIndex = Math.max(0, normalized.indexOf(query))
  const start = Math.max(0, startIndex - 26)
  const end = Math.min(compact.length, start + 88)
  const snippet = compact.slice(start, end).trim()
  const prefix = start > 0 ? '…' : ''
  const suffix = end < compact.length ? '…' : ''

  return `${prefix}${snippet}${suffix}`
}
