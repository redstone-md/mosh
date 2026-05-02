import { afterEach, describe, expect, it, vi } from 'vitest'

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
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('extracts plain text from html content', () => {
    expect(extractPlainText('<p>Hello <strong>MOSH</strong> operator</p>')).toBe('Hello MOSH operator')
  })

  it('extracts text without touching browser DOM APIs', () => {
    vi.stubGlobal('document', {
      createElement: () => {
        throw new Error('extractPlainText must not parse untrusted HTML in the DOM')
      },
    })

    expect(extractPlainText('<img src=x onerror=alert(1)>ready')).toBe('ready')
  })

  it('strips tags with quoted greater-than characters', () => {
    expect(extractPlainText('<a title="1 > 0" href="#">safe &amp; ready</a>')).toBe('safe & ready')
  })

  it('drops malformed tag fragments instead of indexing attacker-controlled attributes', () => {
    expect(extractPlainText('<img src=x onerror=alert(1)')).toBe('')
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
