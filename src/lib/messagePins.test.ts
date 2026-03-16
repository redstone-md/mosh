import { describe, expect, it } from 'vitest'

import type { Message } from './schemas'
import { isMessagePinned, resolvePinnedMessages, togglePinnedMessage } from './messagePins'

function createMessage(id: string): Message {
  return {
    id,
    roomId: 'lobby',
    author: 'operator',
    body: `<p>${id}</p>`,
    timestamp: '12:00',
    emphasis: 'default',
  }
}

describe('messagePins', () => {
  it('adds a room pin and toggles it back off', () => {
    const pinned = togglePinnedMessage({}, 'lobby', 'm-1')

    expect(pinned).toEqual({
      lobby: ['m-1'],
    })
    expect(isMessagePinned(pinned, 'lobby', 'm-1')).toBe(true)

    expect(togglePinnedMessage(pinned, 'lobby', 'm-1')).toEqual({})
  })

  it('keeps newest pins first and caps the room list', () => {
    let current: Record<string, string[]> = {}

    for (let index = 1; index <= 14; index += 1) {
      current = togglePinnedMessage(current, 'lobby', `m-${index}`)
    }

    expect(current.lobby).toHaveLength(12)
    expect(current.lobby[0]).toBe('m-14')
    expect(current.lobby.at(-1)).toBe('m-3')
  })

  it('resolves pinned messages in saved order and skips missing ids', () => {
    const current = {
      lobby: ['m-3', 'm-1', 'missing'],
    }

    expect(resolvePinnedMessages(current, 'lobby', [
      createMessage('m-1'),
      createMessage('m-2'),
      createMessage('m-3'),
    ])).toEqual([
      createMessage('m-3'),
      createMessage('m-1'),
    ])
  })
})
