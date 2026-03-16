import { describe, expect, it } from 'vitest'

import { getRoomDraftPreview, isEmptyDraft, setRoomDraftValue } from './roomDrafts'

describe('roomDrafts', () => {
  it('stores non-empty drafts by room id', () => {
    expect(setRoomDraftValue({}, 'lobby', '<p>hello mesh</p>')).toEqual({
      lobby: '<p>hello mesh</p>',
    })
  })

  it('removes drafts when the content is effectively empty', () => {
    expect(setRoomDraftValue({ lobby: '<p>hello</p>' }, 'lobby', '<p></p>')).toEqual({})
    expect(isEmptyDraft('<p><br></p>')).toBe(true)
  })

  it('creates compact previews from rich text draft markup', () => {
    expect(getRoomDraftPreview('<p>Reply <strong>with</strong> context</p>')).toBe('Reply with context')
  })
})
