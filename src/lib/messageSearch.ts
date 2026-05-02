import type { Message } from './schemas'

export type MessageSearchResult = {
  messageId: string
  roomId: string
  author: string
  preview: string
  query: string
}

export function searchMessages(messages: Message[], rawQuery: string): MessageSearchResult[] {
  const query = normalizeSearchText(rawQuery)
  if (!query) {
    return []
  }

  return messages
    .map((message) => {
      const author = normalizeSearchText(message.author)
      const plainBody = extractPlainText(message.body)
      const body = normalizeSearchText(plainBody)
      const haystack = `${author} ${body}`.trim()
      const index = haystack.indexOf(query)

      if (index === -1) {
        return null
      }

      return {
        messageId: message.id,
        roomId: message.roomId,
        author: message.author,
        preview: buildPreview(plainBody, query, body, index),
        query,
      }
    })
    .filter((result): result is MessageSearchResult => result !== null)
}

export function extractPlainText(value: string): string {
  return decodeHtmlEntities(stripHtmlTags(value)).replace(/\s+/g, ' ').trim()
}

const htmlEntityMap: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

function stripHtmlTags(value: string): string {
  let output = ''
  let index = 0

  while (index < value.length) {
    if (isHtmlTagStart(value, index)) {
      index = findTagEnd(value, index)
      output += ' '
      continue
    }

    output += value[index]
    index += 1
  }

  return output
}

function isHtmlTagStart(value: string, index: number): boolean {
  if (value[index] !== '<') {
    return false
  }

  const next = value[index + 1]
  return next !== undefined && /[a-z!/\?]/i.test(next)
}

function findTagEnd(value: string, start: number): number {
  let quote: string | null = null

  for (let index = start + 1; index < value.length; index += 1) {
    const char = value[index]

    if (quote) {
      if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (char === '>') {
      return index + 1
    }
  }

  return value.length
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
    const decoded = decodeNumericEntity(token) ?? htmlEntityMap[token.toLowerCase()]
    return decoded ?? entity
  })
}

function decodeNumericEntity(token: string): string | null {
  if (!token.startsWith('#')) {
    return null
  }

  const radix = token[1]?.toLowerCase() === 'x' ? 16 : 10
  const digits = radix === 16 ? token.slice(2) : token.slice(1)
  const codePoint = Number.parseInt(digits, radix)

  if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return null
  }

  return String.fromCodePoint(codePoint)
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function buildPreview(source: string, query: string, normalizedBody: string, bodyIndex: number): string {
  const compactSource = source.replace(/\s+/g, ' ').trim()
  if (!compactSource) {
    return ''
  }

  const previewWindow = 72
  const safeIndex = Math.max(0, bodyIndex)
  const start = Math.max(0, safeIndex - Math.floor(previewWindow / 2))
  const end = Math.min(compactSource.length, start + previewWindow)
  const snippet = compactSource.slice(start, end).trim()

  if (!snippet) {
    return compactSource
  }

  const prefix = start > 0 ? '…' : ''
  const suffix = end < compactSource.length ? '…' : ''

  if (normalizedBody.includes(query)) {
    return `${prefix}${snippet}${suffix}`
  }

  return compactSource
}
