import { describe, expect, it } from 'vitest'

import { computeRoomUnreadCounts, isRoomMuted, markRoomAsRead, toggleMutedRoom } from './roomActivity'
import type { Message } from './schemas'

function createMessage(id: string, roomId: string, author: string, emphasis = 'default'): Message {
  return {
    id,
    roomId,
    author,
    body: `<p>${id}</p>`,
    timestamp: `10:0${id.at(-1) ?? '0'}`,
    emphasis,
  }
}

describe('roomActivity', () => {
  it('counts unread messages after the last read marker and skips active room', () => {
    const counts = computeRoomUnreadCounts(
      [
        createMessage('m-1', 'lobby', 'operator'),
        createMessage('m-2', 'lobby', 'peer'),
        createMessage('m-3', 'ops', 'peer'),
        createMessage('m-4', 'ops', 'you'),
        createMessage('m-5', 'ops', 'peer', 'system'),
      ],
      { lobby: 'm-1' },
      'ops',
      'operator'
    )

    expect(counts).toEqual({
      lobby: 1,
    })
  })

  it('marks a room as read using the latest room message', () => {
    expect(
      markRoomAsRead({}, 'lobby', [createMessage('m-1', 'ops', 'peer'), createMessage('m-2', 'lobby', 'peer')])
    ).toEqual({
      lobby: 'm-2',
    })
  })

  it('toggles muted rooms', () => {
    const muted = toggleMutedRoom([], 'lobby')
    expect(isRoomMuted(muted, 'lobby')).toBe(true)
    expect(toggleMutedRoom(muted, 'lobby')).toEqual([])
  })
})
