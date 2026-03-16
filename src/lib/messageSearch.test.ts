import { describe, expect, it } from 'vitest'

import { extractPlainText, searchMessages } from './messageSearch'
import type { Message } from './schemas'

const messages: Message[] = [
  {
    id: 'a',
    roomId: 'lobby',
    author: 'alice',
    body: '<p>Hello <strong>MOSH</strong> operator</p>',
    timestamp: '10:00',
    emphasis: 'normal',
  },
  {
    id: 'b',
    roomId: 'lobby',
    author: 'bob',
    body: '<p>Status update for the relay</p>',
    timestamp: '10:01',
    emphasis: 'normal',
  },
]

describe('messageSearch', () => {
  it('extracts plain text from html content', () => {
    expect(extractPlainText('<p>Hello <strong>MOSH</strong> operator</p>')).toBe('Hello MOSH operator')
  })

  it('matches by message body text', () => {
    const result = searchMessages(messages, 'operator')

    expect(result).toHaveLength(1)
    expect(result[0]?.messageId).toBe('a')
    expect(result[0]?.preview).toContain('MOSH operator')
  })

  it('matches by author name', () => {
    const result = searchMessages(messages, 'bob')

    expect(result).toHaveLength(1)
    expect(result[0]?.messageId).toBe('b')
  })

  it('returns no results for empty queries', () => {
    expect(searchMessages(messages, '   ')).toEqual([])
  })
})
