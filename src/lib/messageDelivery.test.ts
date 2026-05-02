import { describe, expect, it } from 'vitest'

import type { Message } from './schemas'
import {
  createPendingOutgoingMessage,
  decorateMessagesWithDeliveryState,
  failPendingOutgoingMessage,
  removePendingOutgoingMessage,
  resolvePendingOutgoingMessages,
  retryPendingOutgoingMessage,
} from './messageDelivery'

function createMessage(id: string, roomId: string, body: string, author = 'operator'): Message {
  return {
    id,
    roomId,
    author,
    body,
    timestamp: '10:00',
    emphasis: 'default',
  }
}

describe('messageDelivery', () => {
  it('resolves sending optimistic messages when a new live message matches them', () => {
    const existing = [createMessage('old-1', 'lobby', '<p>older</p>')]
    const pending = createPendingOutgoingMessage('lobby', 'operator', '<p>ready</p>', existing)
    const next = resolvePendingOutgoingMessages(
      [pending],
      [...existing, createMessage('live-1', 'lobby', '<p>ready</p>')]
    )

    expect(next).toHaveLength(0)
  })

  it('keeps failed optimistic messages until they are retried or removed', () => {
    const pending = createPendingOutgoingMessage('lobby', 'operator', '<p>retry me</p>', [])
    const failed = failPendingOutgoingMessage([pending], pending.clientId)
    const resolved = resolvePendingOutgoingMessages(failed, [createMessage('live-1', 'lobby', '<p>retry me</p>')])

    expect(resolved[0]?.deliveryState).toBe('failed')
    expect(removePendingOutgoingMessage(resolved, pending.clientId)).toHaveLength(0)
  })

  it('decorates outgoing live messages with delivered and archived states', () => {
    const liveMessages = [
      createMessage('live-1', 'lobby', '<p>done</p>'),
      createMessage('live-2', 'lobby', '<p>peer</p>', 'alice'),
    ]
    const decorated = decorateMessagesWithDeliveryState(liveMessages, [], 'operator', ['live-1'])

    expect(decorated[0]?.deliveryState).toBe('archived')
    expect(decorated[1]?.deliveryState).toBeUndefined()
  })

  it('resets a failed message to sending on retry', () => {
    const pending = createPendingOutgoingMessage('lobby', 'operator', '<p>again</p>', [])
    const failed = failPendingOutgoingMessage([pending], pending.clientId)
    const retried = retryPendingOutgoingMessage(failed, pending.clientId, [createMessage('old-1', 'lobby', '<p>x</p>')])

    expect(retried[0]?.deliveryState).toBe('sending')
    expect(retried[0]?.baselineMessageIds).toContain('old-1')
  })
})
