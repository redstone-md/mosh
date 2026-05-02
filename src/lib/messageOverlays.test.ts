import { describe, expect, it } from 'vitest'

import {
  applyMessageOverlays,
  serializeEditedMessageBody,
  toggleHiddenMessageOverlay,
  upsertEditedMessageOverlay,
} from './messageOverlays'
import type { DisplayMessage } from './messageDelivery'

const baseMessage: DisplayMessage = {
  id: 'm-1',
  roomId: 'lobby',
  author: 'operator',
  body: '<p>hello</p>',
  timestamp: '10:00',
  emphasis: 'default',
}

describe('messageOverlays', () => {
  it('applies edited overlays to messages', () => {
    const overlays = upsertEditedMessageOverlay({}, 'm-1', 'lobby', '<p>updated</p>')
    const next = applyMessageOverlays([baseMessage], overlays, 'Hidden locally')

    expect(next[0]?.body).toBe('<p>updated</p>')
    expect(next[0]?.overlayState).toBe('edited')
  })

  it('does not apply overlays when message id matches but room differs', () => {
    const overlays = upsertEditedMessageOverlay({}, 'm-1', 'alpha', '<p>updated elsewhere</p>')
    const next = applyMessageOverlays([baseMessage], overlays, 'Hidden locally')

    expect(next[0]?.body).toBe('<p>hello</p>')
    expect(next[0]?.overlayState).toBeUndefined()
  })

  it('toggles hidden overlays and replaces body with a tombstone label', () => {
    const overlays = toggleHiddenMessageOverlay({}, 'm-1', 'lobby')
    const next = applyMessageOverlays([baseMessage], overlays, 'Hidden locally')

    expect(next[0]?.overlayState).toBe('hidden')
    expect(next[0]?.body).toContain('Hidden locally')
  })

  it('does not reuse edited bodies from overlays in another room when hiding', () => {
    const editedElsewhere = upsertEditedMessageOverlay({}, 'm-1', 'alpha', '<p>updated elsewhere</p>')
    const overlays = toggleHiddenMessageOverlay(editedElsewhere, 'm-1', 'lobby')

    expect(overlays['m-1']?.roomId).toBe('lobby')
    expect(overlays['m-1']?.body).toBeUndefined()
    expect(overlays['m-1']?.hidden).toBe(true)
  })

  it('serializes edited plain text safely into message html', () => {
    expect(serializeEditedMessageBody('line one\n<script>x</script>')).toBe(
      '<p>line one<br>&lt;script&gt;x&lt;/script&gt;</p>'
    )
  })
})
