/**
 * Message Handling Tests
 *
 * Tests for message-related functionality in the conversation primitive:
 * - Message creation and storage
 * - Message ordering and accumulation
 * - Message metadata handling
 * - Multi-participant messaging
 */
import { describe, it, expect, vi } from 'vitest'
import { Conversation } from '../conversation.js'
import type { ConversationMachineConfig } from '../types.js'

// =============================================================================
// Message Creation and Storage
// =============================================================================

describe('Message creation and storage', () => {
  it('should create message with unique ID', async () => {
    const machine = Conversation.create()

    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'user_123',
      content: 'Hello',
    })

    expect(machine.context.messages[0].id).toBeDefined()
    expect(machine.context.messages[0].id).toMatch(/^msg_/)
  })

  it('should set contentType to text/plain by default', async () => {
    const machine = Conversation.create()

    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'user_123',
      content: 'Hello',
    })

    expect(machine.context.messages[0].contentType).toBe('text/plain')
  })

  it('should store message sender correctly', async () => {
    const machine = Conversation.create()

    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'customer_456',
      content: 'Test message',
    })

    expect(machine.context.messages[0].from).toBe('customer_456')
  })

  it('should store message content correctly', async () => {
    const machine = Conversation.create()
    const content = 'This is a test message with special chars: <>&"\'`'

    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'user_123',
      content,
    })

    expect(machine.context.messages[0].content).toBe(content)
  })

  it('should set createdAt timestamp on message', async () => {
    const machine = Conversation.create()
    const beforeSend = new Date()

    await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'user_123',
      content: 'Hello',
    })

    const afterSend = new Date()
    const messageTime = machine.context.messages[0].createdAt

    expect(messageTime.getTime()).toBeGreaterThanOrEqual(beforeSend.getTime())
    expect(messageTime.getTime()).toBeLessThanOrEqual(afterSend.getTime())
  })
})

// =============================================================================
// Message Ordering and Accumulation
// =============================================================================

describe('Message ordering and accumulation', () => {
  it('should maintain message order (FIFO)', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'First' })
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Second' })
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Third' })

    expect(machine.context.messages[0].content).toBe('First')
    expect(machine.context.messages[1].content).toBe('Second')
    expect(machine.context.messages[2].content).toBe('Third')
  })

  it('should accumulate messages without losing any', async () => {
    const machine = Conversation.create()
    const messageCount = 10

    for (let i = 0; i < messageCount; i++) {
      await machine.send({
        type: 'MESSAGE_RECEIVED',
        from: 'user',
        content: `Message ${i}`,
      })
    }

    expect(machine.context.messages).toHaveLength(messageCount)
  })

  it('should preserve messages across state transitions', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Initial message' })
    await machine.send({ type: 'WAIT' })
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Response message' })

    expect(machine.context.messages).toHaveLength(2)
    expect(machine.context.messages[0].content).toBe('Initial message')
    expect(machine.context.messages[1].content).toBe('Response message')
  })

  it('should preserve messages when resolving conversation', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Problem description' })
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'agent', content: 'Solution provided' })
    await machine.send({ type: 'RESOLVE', reason: 'Issue resolved' })

    expect(machine.context.messages).toHaveLength(2)
  })

  it('should handle empty content messages', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: '' })

    expect(machine.context.messages).toHaveLength(1)
    expect(machine.context.messages[0].content).toBe('')
  })

  it('should handle very long messages', async () => {
    const machine = Conversation.create()
    const longContent = 'x'.repeat(100000)

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: longContent })

    expect(machine.context.messages[0].content).toBe(longContent)
    expect(machine.context.messages[0].content.length).toBe(100000)
  })
})

// =============================================================================
// Multi-participant Messaging
// =============================================================================

describe('Multi-participant messaging', () => {
  it('should track messages from different participants', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'customer_1', content: 'Question' })
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'agent_1', content: 'Answer' })
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'customer_1', content: 'Follow-up' })
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'supervisor_1', content: 'Escalated response' })

    const participants = new Set(machine.context.messages.map((m) => m.from))

    expect(participants.size).toBe(3)
    expect(participants.has('customer_1')).toBe(true)
    expect(participants.has('agent_1')).toBe(true)
    expect(participants.has('supervisor_1')).toBe(true)
  })

  it('should count messages per participant', async () => {
    const machine = Conversation.create()

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user_a', content: 'A1' })
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user_b', content: 'B1' })
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user_a', content: 'A2' })
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user_a', content: 'A3' })
    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user_b', content: 'B2' })

    const countByParticipant = machine.context.messages.reduce(
      (acc, m) => {
        acc[m.from] = (acc[m.from] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    expect(countByParticipant['user_a']).toBe(3)
    expect(countByParticipant['user_b']).toBe(2)
  })
})

// =============================================================================
// Message in Different States
// =============================================================================

describe('Message handling in different states', () => {
  it('should handle message in open state', async () => {
    const machine = Conversation.create()
    expect(machine.state).toBe('open')

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Open state message' })

    expect(machine.context.messages).toHaveLength(1)
    expect(machine.state).toBe('open')
  })

  it('should handle message in waiting state', async () => {
    const machine = Conversation.create()
    await machine.send({ type: 'WAIT' })
    expect(machine.state).toBe('waiting')

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Waiting state message' })

    expect(machine.context.messages).toHaveLength(1)
    expect(machine.state).toBe('open') // MESSAGE_RECEIVED transitions waiting -> open
  })

  it('should transition from waiting to open on message received', async () => {
    const machine = Conversation.create()
    await machine.send({ type: 'WAIT' })

    const newState = await machine.send({
      type: 'MESSAGE_RECEIVED',
      from: 'customer',
      content: 'Customer response',
    })

    expect(newState).toBe('open')
  })
})

// =============================================================================
// Message Timestamps
// =============================================================================

describe('Message timestamps', () => {
  it('should have unique IDs for messages sent at same time', async () => {
    const machine = Conversation.create()

    // Send messages as fast as possible
    await Promise.all([
      machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Msg 1' }),
      machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Msg 2' }),
    ])

    // IDs should still be unique even if timestamp is same
    const ids = machine.context.messages.map((m) => m.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it('should update conversation updatedAt on each message', async () => {
    const machine = Conversation.create()
    const initialUpdatedAt = machine.context.updatedAt

    // Small delay to ensure time difference
    await new Promise((r) => setTimeout(r, 10))

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'Hello' })
    const afterFirstMessage = machine.context.updatedAt

    expect(afterFirstMessage.getTime()).toBeGreaterThan(initialUpdatedAt.getTime())

    await new Promise((r) => setTimeout(r, 10))

    await machine.send({ type: 'MESSAGE_RECEIVED', from: 'user', content: 'World' })
    const afterSecondMessage = machine.context.updatedAt

    expect(afterSecondMessage.getTime()).toBeGreaterThan(afterFirstMessage.getTime())
  })
})
