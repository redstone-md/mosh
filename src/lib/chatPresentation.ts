import type { GroupAccent, RoomGroup } from './appShellSchemas'
import type { Message, RoomSummary } from './schemas'
import { sanitizeMessageMarkup } from './messageSanitizer'

const accentStyles: Record<GroupAccent, string> = {
  forest: 'bg-[var(--accent-forest)] text-white',
  slate: 'bg-[var(--accent-slate)] text-white',
  sand: 'bg-[var(--accent-sand)] text-[var(--ink-dark)]',
  ember: 'bg-[var(--accent-ember)] text-white',
}

export function getGroupAccentClass(group: RoomGroup): string {
  return accentStyles[group.accent]
}

export function formatRoomTitle(room: RoomSummary | undefined, unknownLabel = 'Unknown room'): string {
  if (!room) {
    return unknownLabel
  }
  if (room.kind === 'system') {
    return room.label
  }
  return room.label.startsWith('#') || room.label.startsWith('@') ? room.label : `#${room.label}`
}

export function initialsFromName(value: string): string {
  const parts = value
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean)
  if (parts.length === 0) {
    return 'MS'
  }
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function getMessageMarkup(body: string): string {
  const trimmed = body.trim()
  const hasHtmlLikeMarkup = /<\/?[a-z][\s\S]*>/i.test(trimmed)
  const withBreaks = hasHtmlLikeMarkup ? trimmed : trimmed.replace(/\n/g, '<br />')
  return sanitizeMessageMarkup(withBreaks)
}

export function dedupeMessages(messages: Message[]): Message[] {
  const byId = new Map<string, Message>()
  for (const message of messages) {
    byId.set(message.id, message)
  }
  return Array.from(byId.values())
}
