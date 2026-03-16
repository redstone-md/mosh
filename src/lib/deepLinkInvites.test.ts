import { describe, expect, it } from 'vitest'

import { extractInviteDeepLinks } from './deepLinkInvites'

describe('deepLinkInvites', () => {
  it('filters unrelated URLs and trims invite links', () => {
    expect(
      extractInviteDeepLinks([
        'https://example.com',
        '  mosh://invite/alpha  ',
        'MOSH://INVITE/beta',
      ]),
    ).toEqual(['mosh://invite/alpha', 'MOSH://INVITE/beta'])
  })

  it('deduplicates repeated invite links', () => {
    expect(
      extractInviteDeepLinks([
        'mosh://invite/alpha',
        'mosh://invite/alpha',
        'mosh://invite/beta',
      ]),
    ).toEqual(['mosh://invite/alpha', 'mosh://invite/beta'])
  })
})
