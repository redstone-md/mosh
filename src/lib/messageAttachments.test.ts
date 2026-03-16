import { describe, expect, it } from 'vitest'

import {
  createFileAttachmentMarkup,
  formatAttachmentSize,
  getEmbeddedAttachmentLimit,
} from './messageAttachments'

describe('messageAttachments', () => {
  it('formats attachment sizes for human reading', () => {
    expect(formatAttachmentSize(980)).toBe('980 B')
    expect(formatAttachmentSize(1536)).toBe('1.5 KB')
    expect(formatAttachmentSize(12 * 1024)).toBe('12 KB')
  })

  it('creates download markup with attachment metadata', () => {
    const file = new File(['mesh'], 'brief.txt', { type: 'text/plain' })
    const markup = createFileAttachmentMarkup(file, 'data:text/plain;base64,bWVzaA==')

    expect(markup).toContain('data-attachment="file"')
    expect(markup).toContain('download="brief.txt"')
    expect(markup).toContain('brief.txt')
    expect(markup).toContain('text')
  })

  it('keeps embedded attachment size limit stable', () => {
    expect(getEmbeddedAttachmentLimit()).toBe(40 * 1024)
  })
})
