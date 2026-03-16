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
      const body = normalizeSearchText(extractPlainText(message.body))
      const haystack = `${author} ${body}`.trim()
      const index = haystack.indexOf(query)

      if (index === -1) {
        return null
      }

      return {
        messageId: message.id,
        roomId: message.roomId,
        author: message.author,
        preview: buildPreview(extractPlainText(message.body), query, body, index),
        query,
      }
    })
    .filter((result): result is MessageSearchResult => result !== null)
}

export function extractPlainText(value: string): string {
  if (typeof document !== 'undefined') {
    const container = document.createElement('div')
    container.innerHTML = value
    return (container.textContent || container.innerText || '').replace(/\s+/g, ' ').trim()
  }

  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
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
