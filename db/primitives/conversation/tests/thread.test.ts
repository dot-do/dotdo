/**
 * Thread and Message Model Tests - TDD RED Phase
 *
 * Comprehensive tests for Thread and Message models providing:
 * - Thread creation with ID and metadata
 * - Message append to thread
 * - Message ordering (chronological)
 * - Timestamps (created_at, updated_at)
 * - Metadata on threads and messages
 * - Message pagination
 * - Thread listing
 *
 * Following TDD, these tests are written FIRST and should FAIL until implementation is complete.
 *
 * @module db/primitives/conversation/tests/thread
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createThreadManager } from '../thread'
import type {
  Thread,
  ThreadManager,
  ThreadStatus,
  Message,
  MessageRole,
  MessageContent,
  CreateThreadOptions,
  CreateMessageOptions,
  PaginationOptions,
  PaginatedResult,
  ThreadFilterOptions,
} from '../thread'

// =============================================================================
// TDD Cycle 1: Thread Creation
// =============================================================================

describe('Thread creation', () => {
  it('should create a thread with auto-generated ID', async () => {
    const manager = createThreadManager()

    const thread = await manager.createThread()

    expect(thread.id).toBeDefined()
    expect(thread.id.length).toBeGreaterThan(0)
    expect(thread.status).toBe('active')
    expect(thread.messageCount).toBe(0)
  })

  it('should create a thread with custom ID', async () => {
    const manager = createThreadManager()

    const thread = await manager.createThread({ id: 'thread_custom_123' })

    expect(thread.id).toBe('thread_custom_123')
  })

  it('should create a thread with title', async () => {
    const manager = createThreadManager()

    const thread = await manager.createThread({ title: 'Customer Support Inquiry' })

    expect(thread.title).toBe('Customer Support Inquiry')
  })

  it('should create a thread with metadata', async () => {
    const manager = createThreadManager()

    const thread = await manager.createThread({
      metadata: {
        customerId: 'cust_123',
        channel: 'chat',
        priority: 'high',
      },
    })

    expect(thread.metadata.customerId).toBe('cust_123')
    expect(thread.metadata.channel).toBe('chat')
    expect(thread.metadata.priority).toBe('high')
  })

  it('should create a thread with participant IDs', async () => {
    const manager = createThreadManager()

    const thread = await manager.createThread({
      participantIds: ['user_1', 'agent_1', 'bot_1'],
    })

    expect(thread.participantIds).toContain('user_1')
    expect(thread.participantIds).toContain('agent_1')
    expect(thread.participantIds).toContain('bot_1')
  })

  it('should set createdAt and updatedAt timestamps on creation', async () => {
    const manager = createThreadManager()
    const before = new Date()

    const thread = await manager.createThread()

    const after = new Date()

    expect(thread.createdAt).toBeInstanceOf(Date)
    expect(thread.updatedAt).toBeInstanceOf(Date)
    expect(thread.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(thread.createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
    expect(thread.updatedAt.getTime()).toEqual(thread.createdAt.getTime())
  })

  it('should initialize with empty metadata if not provided', async () => {
    const manager = createThreadManager()

    const thread = await manager.createThread()

    expect(thread.metadata).toEqual({})
  })

  it('should reject duplicate thread IDs', async () => {
    const manager = createThreadManager()

    await manager.createThread({ id: 'duplicate_id' })

    await expect(manager.createThread({ id: 'duplicate_id' })).rejects.toThrow(/already exists/i)
  })
})

// =============================================================================
// TDD Cycle 2: Thread Retrieval and Updates
// =============================================================================

describe('Thread retrieval and updates', () => {
  let manager: ThreadManager

  beforeEach(() => {
    manager = createThreadManager()
  })

  it('should get a thread by ID', async () => {
    const created = await manager.createThread({ id: 'thread_get_1' })

    const retrieved = await manager.getThread('thread_get_1')

    expect(retrieved).not.toBeNull()
    expect(retrieved?.id).toBe(created.id)
    expect(retrieved?.status).toBe('active')
  })

  it('should return null for non-existent thread', async () => {
    const result = await manager.getThread('nonexistent_thread')

    expect(result).toBeNull()
  })

  it('should update thread title', async () => {
    const thread = await manager.createThread({ title: 'Original Title' })

    const updated = await manager.updateThread(thread.id, { title: 'Updated Title' })

    expect(updated.title).toBe('Updated Title')
  })

  it('should update thread metadata', async () => {
    const thread = await manager.createThread({ metadata: { key1: 'value1' } })

    const updated = await manager.updateThread(thread.id, {
      metadata: { key1: 'updated', key2: 'new' },
    })

    expect(updated.metadata.key1).toBe('updated')
    expect(updated.metadata.key2).toBe('new')
  })

  it('should update updatedAt timestamp on thread update', async () => {
    const thread = await manager.createThread()
    const originalUpdatedAt = thread.updatedAt

    await new Promise((resolve) => setTimeout(resolve, 10))

    const updated = await manager.updateThread(thread.id, { title: 'New Title' })

    expect(updated.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
  })

  it('should throw when updating non-existent thread', async () => {
    await expect(
      manager.updateThread('nonexistent', { title: 'Test' })
    ).rejects.toThrow(/not found/i)
  })

  it('should archive a thread', async () => {
    const thread = await manager.createThread()

    const archived = await manager.archiveThread(thread.id)

    expect(archived.status).toBe('archived')
  })

  it('should delete a thread', async () => {
    const thread = await manager.createThread()

    await manager.deleteThread(thread.id)

    const result = await manager.getThread(thread.id)
    expect(result).toBeNull()
  })

  it('should delete thread and all its messages', async () => {
    const thread = await manager.createThread()
    await manager.appendMessage(thread.id, { role: 'user', content: 'Hello' })
    await manager.appendMessage(thread.id, { role: 'assistant', content: 'Hi' })

    await manager.deleteThread(thread.id)

    const result = await manager.getThread(thread.id)
    expect(result).toBeNull()
  })
})

// =============================================================================
// TDD Cycle 3: Message Append to Thread
// =============================================================================

describe('Message append to thread', () => {
  let manager: ThreadManager
  let threadId: string

  beforeEach(async () => {
    manager = createThreadManager()
    const thread = await manager.createThread()
    threadId = thread.id
  })

  it('should append a message to thread', async () => {
    const message = await manager.appendMessage(threadId, {
      role: 'user',
      content: 'Hello, I need help',
    })

    expect(message.id).toBeDefined()
    expect(message.threadId).toBe(threadId)
    expect(message.role).toBe('user')
    expect(message.content).toBe('Hello, I need help')
  })

  it('should append message with custom ID', async () => {
    const message = await manager.appendMessage(threadId, {
      id: 'msg_custom_1',
      role: 'user',
      content: 'Test',
    })

    expect(message.id).toBe('msg_custom_1')
  })

  it('should append message with metadata', async () => {
    const message = await manager.appendMessage(threadId, {
      role: 'user',
      content: 'Test',
      metadata: {
        sentiment: 'positive',
        tokens: 5,
        model: 'gpt-4',
      },
    })

    expect(message.metadata.sentiment).toBe('positive')
    expect(message.metadata.tokens).toBe(5)
    expect(message.metadata.model).toBe('gpt-4')
  })

  it('should set createdAt timestamp on message', async () => {
    const before = new Date()

    const message = await manager.appendMessage(threadId, {
      role: 'user',
      content: 'Test',
    })

    const after = new Date()

    expect(message.createdAt).toBeInstanceOf(Date)
    expect(message.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(message.createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('should increment thread messageCount', async () => {
    await manager.appendMessage(threadId, { role: 'user', content: 'Msg 1' })
    await manager.appendMessage(threadId, { role: 'assistant', content: 'Msg 2' })
    await manager.appendMessage(threadId, { role: 'user', content: 'Msg 3' })

    const thread = await manager.getThread(threadId)

    expect(thread?.messageCount).toBe(3)
  })

  it('should update thread lastMessageAt', async () => {
    const threadBefore = await manager.getThread(threadId)
    expect(threadBefore?.lastMessageAt).toBeUndefined()

    const message = await manager.appendMessage(threadId, {
      role: 'user',
      content: 'Test',
    })

    const threadAfter = await manager.getThread(threadId)

    expect(threadAfter?.lastMessageAt).toBeInstanceOf(Date)
    expect(threadAfter?.lastMessageAt?.getTime()).toBe(message.createdAt.getTime())
  })

  it('should update thread updatedAt when message is appended', async () => {
    const threadBefore = await manager.getThread(threadId)

    await new Promise((resolve) => setTimeout(resolve, 10))

    await manager.appendMessage(threadId, { role: 'user', content: 'Test' })

    const threadAfter = await manager.getThread(threadId)

    expect(threadAfter?.updatedAt.getTime()).toBeGreaterThan(
      threadBefore!.updatedAt.getTime()
    )
  })

  it('should throw when appending to non-existent thread', async () => {
    await expect(
      manager.appendMessage('nonexistent_thread', {
        role: 'user',
        content: 'Test',
      })
    ).rejects.toThrow(/thread not found/i)
  })

  it('should support different message roles', async () => {
    const userMsg = await manager.appendMessage(threadId, {
      role: 'user',
      content: 'User message',
    })
    const assistantMsg = await manager.appendMessage(threadId, {
      role: 'assistant',
      content: 'Assistant response',
    })
    const systemMsg = await manager.appendMessage(threadId, {
      role: 'system',
      content: 'System instruction',
    })
    const toolMsg = await manager.appendMessage(threadId, {
      role: 'tool',
      content: 'Tool result',
    })

    expect(userMsg.role).toBe('user')
    expect(assistantMsg.role).toBe('assistant')
    expect(systemMsg.role).toBe('system')
    expect(toolMsg.role).toBe('tool')
  })

  it('should support structured content', async () => {
    const message = await manager.appendMessage(threadId, {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Here is the image you requested:' },
        { type: 'image', url: 'https://example.com/image.png', mimeType: 'image/png' },
      ],
    })

    expect(Array.isArray(message.content)).toBe(true)
    const content = message.content as Array<{ type: string; text?: string; url?: string }>
    expect(content[0].type).toBe('text')
    expect(content[0].text).toBe('Here is the image you requested:')
    expect(content[1].type).toBe('image')
    expect(content[1].url).toBe('https://example.com/image.png')
  })

  it('should support tool call content', async () => {
    const message = await manager.appendMessage(threadId, {
      role: 'assistant',
      content: [
        {
          type: 'tool_call',
          toolCallId: 'call_123',
          toolName: 'get_weather',
          input: { location: 'San Francisco' },
        },
      ],
    })

    const content = message.content as Array<{
      type: string
      toolCallId?: string
      toolName?: string
      input?: unknown
    }>
    expect(content[0].type).toBe('tool_call')
    expect(content[0].toolCallId).toBe('call_123')
    expect(content[0].toolName).toBe('get_weather')
  })

  it('should support parent message reference for branching', async () => {
    const parent = await manager.appendMessage(threadId, {
      role: 'user',
      content: 'Original question',
    })

    const branch = await manager.appendMessage(threadId, {
      role: 'assistant',
      content: 'Alternative response',
      parentMessageId: parent.id,
    })

    expect(branch.parentMessageId).toBe(parent.id)
  })

  it('should support message status tracking', async () => {
    const message = await manager.appendMessage(threadId, {
      role: 'assistant',
      content: 'Processing...',
    })

    expect(message.status).toBe('pending')

    const updated = await manager.updateMessage(threadId, message.id, {
      status: 'completed',
    })

    expect(updated.status).toBe('completed')
  })
})

// =============================================================================
// TDD Cycle 4: Message Ordering (Chronological)
// =============================================================================

describe('Message ordering (chronological)', () => {
  let manager: ThreadManager
  let threadId: string

  beforeEach(async () => {
    manager = createThreadManager()
    const thread = await manager.createThread()
    threadId = thread.id
  })

  it('should return messages in chronological order by default', async () => {
    await manager.appendMessage(threadId, { role: 'user', content: 'First' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await manager.appendMessage(threadId, { role: 'assistant', content: 'Second' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await manager.appendMessage(threadId, { role: 'user', content: 'Third' })

    const result = await manager.getMessages(threadId)

    expect(result.items).toHaveLength(3)
    expect(result.items[0].content).toBe('First')
    expect(result.items[1].content).toBe('Second')
    expect(result.items[2].content).toBe('Third')
  })

  it('should return messages in reverse chronological order when specified', async () => {
    await manager.appendMessage(threadId, { role: 'user', content: 'First' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await manager.appendMessage(threadId, { role: 'assistant', content: 'Second' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await manager.appendMessage(threadId, { role: 'user', content: 'Third' })

    const result = await manager.getMessages(threadId, { order: 'desc' })

    expect(result.items).toHaveLength(3)
    expect(result.items[0].content).toBe('Third')
    expect(result.items[1].content).toBe('Second')
    expect(result.items[2].content).toBe('First')
  })

  it('should maintain order with rapid message insertion', async () => {
    const promises = [
      manager.appendMessage(threadId, { id: 'msg_1', role: 'user', content: 'Msg 1' }),
      manager.appendMessage(threadId, { id: 'msg_2', role: 'assistant', content: 'Msg 2' }),
      manager.appendMessage(threadId, { id: 'msg_3', role: 'user', content: 'Msg 3' }),
      manager.appendMessage(threadId, { id: 'msg_4', role: 'assistant', content: 'Msg 4' }),
      manager.appendMessage(threadId, { id: 'msg_5', role: 'user', content: 'Msg 5' }),
    ]

    await Promise.all(promises)

    const result = await manager.getMessages(threadId)

    // With concurrent insertion, order should be consistent
    expect(result.items).toHaveLength(5)
    // Each message should have increasing timestamps or sequence numbers
    for (let i = 1; i < result.items.length; i++) {
      expect(result.items[i].createdAt.getTime()).toBeGreaterThanOrEqual(
        result.items[i - 1].createdAt.getTime()
      )
    }
  })

  it('should get messages before a specific message', async () => {
    await manager.appendMessage(threadId, { id: 'msg_1', role: 'user', content: 'First' })
    await manager.appendMessage(threadId, { id: 'msg_2', role: 'assistant', content: 'Second' })
    await manager.appendMessage(threadId, { id: 'msg_3', role: 'user', content: 'Third' })
    await manager.appendMessage(threadId, { id: 'msg_4', role: 'assistant', content: 'Fourth' })

    const messages = await manager.getMessagesBefore(threadId, 'msg_3', 2)

    expect(messages).toHaveLength(2)
    expect(messages[0].id).toBe('msg_1')
    expect(messages[1].id).toBe('msg_2')
  })

  it('should get messages after a specific message', async () => {
    await manager.appendMessage(threadId, { id: 'msg_1', role: 'user', content: 'First' })
    await manager.appendMessage(threadId, { id: 'msg_2', role: 'assistant', content: 'Second' })
    await manager.appendMessage(threadId, { id: 'msg_3', role: 'user', content: 'Third' })
    await manager.appendMessage(threadId, { id: 'msg_4', role: 'assistant', content: 'Fourth' })

    const messages = await manager.getMessagesAfter(threadId, 'msg_2', 2)

    expect(messages).toHaveLength(2)
    expect(messages[0].id).toBe('msg_3')
    expect(messages[1].id).toBe('msg_4')
  })

  it('should get latest message', async () => {
    await manager.appendMessage(threadId, { role: 'user', content: 'First' })
    await manager.appendMessage(threadId, { role: 'assistant', content: 'Second' })
    await manager.appendMessage(threadId, { role: 'user', content: 'Third (latest)' })

    const latest = await manager.getLatestMessage(threadId)

    expect(latest?.content).toBe('Third (latest)')
  })

  it('should return null for latest message on empty thread', async () => {
    const latest = await manager.getLatestMessage(threadId)

    expect(latest).toBeNull()
  })
})

// =============================================================================
// TDD Cycle 5: Timestamps
// =============================================================================

describe('Timestamps', () => {
  let manager: ThreadManager

  beforeEach(() => {
    manager = createThreadManager()
  })

  describe('Thread timestamps', () => {
    it('should set createdAt on thread creation', async () => {
      const before = new Date()

      const thread = await manager.createThread()

      const after = new Date()

      expect(thread.createdAt).toBeInstanceOf(Date)
      expect(thread.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(thread.createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should set updatedAt equal to createdAt on creation', async () => {
      const thread = await manager.createThread()

      expect(thread.updatedAt.getTime()).toBe(thread.createdAt.getTime())
    })

    it('should update updatedAt when thread is modified', async () => {
      const thread = await manager.createThread()
      const originalUpdatedAt = thread.updatedAt

      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = await manager.updateThread(thread.id, { title: 'New' })

      expect(updated.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
    })

    it('should not change createdAt when thread is modified', async () => {
      const thread = await manager.createThread()
      const originalCreatedAt = thread.createdAt

      const updated = await manager.updateThread(thread.id, { title: 'New' })

      expect(updated.createdAt.getTime()).toBe(originalCreatedAt.getTime())
    })

    it('should track lastMessageAt accurately', async () => {
      const thread = await manager.createThread()
      expect(thread.lastMessageAt).toBeUndefined()

      const msg1 = await manager.appendMessage(thread.id, {
        role: 'user',
        content: 'First',
      })

      let updated = await manager.getThread(thread.id)
      expect(updated?.lastMessageAt?.getTime()).toBe(msg1.createdAt.getTime())

      await new Promise((resolve) => setTimeout(resolve, 10))

      const msg2 = await manager.appendMessage(thread.id, {
        role: 'assistant',
        content: 'Second',
      })

      updated = await manager.getThread(thread.id)
      expect(updated?.lastMessageAt?.getTime()).toBe(msg2.createdAt.getTime())
    })
  })

  describe('Message timestamps', () => {
    let threadId: string

    beforeEach(async () => {
      const thread = await manager.createThread()
      threadId = thread.id
    })

    it('should set createdAt on message creation', async () => {
      const before = new Date()

      const message = await manager.appendMessage(threadId, {
        role: 'user',
        content: 'Test',
      })

      const after = new Date()

      expect(message.createdAt).toBeInstanceOf(Date)
      expect(message.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(message.createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should preserve message timestamps on retrieval', async () => {
      const message = await manager.appendMessage(threadId, {
        role: 'user',
        content: 'Test',
      })

      const retrieved = await manager.getMessage(threadId, message.id)

      expect(retrieved?.createdAt.getTime()).toBe(message.createdAt.getTime())
    })

    it('should have increasing timestamps for sequential messages', async () => {
      const msg1 = await manager.appendMessage(threadId, {
        role: 'user',
        content: 'First',
      })

      await new Promise((resolve) => setTimeout(resolve, 5))

      const msg2 = await manager.appendMessage(threadId, {
        role: 'assistant',
        content: 'Second',
      })

      expect(msg2.createdAt.getTime()).toBeGreaterThan(msg1.createdAt.getTime())
    })
  })
})

// =============================================================================
// TDD Cycle 6: Metadata on Threads and Messages
// =============================================================================

describe('Metadata on threads and messages', () => {
  let manager: ThreadManager

  beforeEach(() => {
    manager = createThreadManager()
  })

  describe('Thread metadata', () => {
    it('should store and retrieve thread metadata', async () => {
      const thread = await manager.createThread({
        metadata: {
          source: 'web_chat',
          customerId: 'cust_123',
          agentId: 'agent_456',
        },
      })

      const retrieved = await manager.getThread(thread.id)

      expect(retrieved?.metadata.source).toBe('web_chat')
      expect(retrieved?.metadata.customerId).toBe('cust_123')
      expect(retrieved?.metadata.agentId).toBe('agent_456')
    })

    it('should update thread metadata without losing existing keys', async () => {
      const thread = await manager.createThread({
        metadata: { key1: 'value1', key2: 'value2' },
      })

      const updated = await manager.updateThread(thread.id, {
        metadata: { key2: 'updated', key3: 'new' },
      })

      expect(updated.metadata.key1).toBe('value1')
      expect(updated.metadata.key2).toBe('updated')
      expect(updated.metadata.key3).toBe('new')
    })

    it('should support nested metadata objects', async () => {
      const thread = await manager.createThread({
        metadata: {
          analytics: {
            firstResponseTime: 1500,
            resolutionTime: 45000,
            satisfactionScore: 4.5,
          },
          tags: ['support', 'billing', 'urgent'],
        },
      })

      const retrieved = await manager.getThread(thread.id)

      expect((retrieved?.metadata.analytics as Record<string, unknown>)?.firstResponseTime).toBe(1500)
      expect(retrieved?.metadata.tags).toContain('billing')
    })

    it('should support metadata with various value types', async () => {
      const thread = await manager.createThread({
        metadata: {
          stringVal: 'hello',
          numberVal: 42,
          booleanVal: true,
          nullVal: null,
          arrayVal: [1, 2, 3],
          objectVal: { nested: 'value' },
        },
      })

      const retrieved = await manager.getThread(thread.id)

      expect(retrieved?.metadata.stringVal).toBe('hello')
      expect(retrieved?.metadata.numberVal).toBe(42)
      expect(retrieved?.metadata.booleanVal).toBe(true)
      expect(retrieved?.metadata.nullVal).toBeNull()
      expect(retrieved?.metadata.arrayVal).toEqual([1, 2, 3])
      expect(retrieved?.metadata.objectVal).toEqual({ nested: 'value' })
    })
  })

  describe('Message metadata', () => {
    let threadId: string

    beforeEach(async () => {
      const thread = await manager.createThread()
      threadId = thread.id
    })

    it('should store and retrieve message metadata', async () => {
      const message = await manager.appendMessage(threadId, {
        role: 'assistant',
        content: 'Response',
        metadata: {
          model: 'gpt-4',
          tokens: { prompt: 100, completion: 50 },
          latencyMs: 1200,
        },
      })

      const retrieved = await manager.getMessage(threadId, message.id)

      expect(retrieved?.metadata.model).toBe('gpt-4')
      expect((retrieved?.metadata.tokens as Record<string, number>)?.prompt).toBe(100)
      expect(retrieved?.metadata.latencyMs).toBe(1200)
    })

    it('should update message metadata', async () => {
      const message = await manager.appendMessage(threadId, {
        role: 'assistant',
        content: 'Response',
        metadata: { status: 'generating' },
      })

      const updated = await manager.updateMessage(threadId, message.id, {
        metadata: { status: 'completed', finishedAt: new Date().toISOString() },
      })

      expect(updated.metadata.status).toBe('completed')
      expect(updated.metadata.finishedAt).toBeDefined()
    })

    it('should preserve message metadata across queries', async () => {
      await manager.appendMessage(threadId, {
        role: 'user',
        content: 'Question',
        metadata: { sentiment: 'curious' },
      })

      await manager.appendMessage(threadId, {
        role: 'assistant',
        content: 'Answer',
        metadata: { confidence: 0.95 },
      })

      const result = await manager.getMessages(threadId)

      expect(result.items[0].metadata.sentiment).toBe('curious')
      expect(result.items[1].metadata.confidence).toBe(0.95)
    })
  })
})

// =============================================================================
// TDD Cycle 7: Message Pagination
// =============================================================================

describe('Message pagination', () => {
  let manager: ThreadManager
  let threadId: string

  beforeEach(async () => {
    manager = createThreadManager()
    const thread = await manager.createThread()
    threadId = thread.id

    // Create 25 messages for pagination tests
    for (let i = 1; i <= 25; i++) {
      await manager.appendMessage(threadId, {
        id: `msg_${i.toString().padStart(2, '0')}`,
        role: i % 2 === 0 ? 'assistant' : 'user',
        content: `Message ${i}`,
      })
    }
  })

  it('should return limited number of messages', async () => {
    const result = await manager.getMessages(threadId, { limit: 10 })

    expect(result.items).toHaveLength(10)
    expect(result.hasMore).toBe(true)
  })

  it('should return all messages if limit exceeds count', async () => {
    const result = await manager.getMessages(threadId, { limit: 50 })

    expect(result.items).toHaveLength(25)
    expect(result.hasMore).toBe(false)
  })

  it('should use default limit if not specified', async () => {
    const result = await manager.getMessages(threadId)

    // Default limit should be reasonable (e.g., 20)
    expect(result.items.length).toBeLessThanOrEqual(25)
    expect(result.items.length).toBeGreaterThan(0)
  })

  it('should return next cursor when more results exist', async () => {
    const result = await manager.getMessages(threadId, { limit: 10 })

    expect(result.nextCursor).toBeDefined()
    expect(result.hasMore).toBe(true)
  })

  it('should paginate using cursor', async () => {
    const page1 = await manager.getMessages(threadId, { limit: 10 })
    const page2 = await manager.getMessages(threadId, {
      limit: 10,
      cursor: page1.nextCursor,
    })

    expect(page2.items).toHaveLength(10)
    expect(page2.items[0].id).not.toBe(page1.items[0].id)

    // Pages should not overlap
    const page1Ids = new Set(page1.items.map((m) => m.id))
    const page2Ids = page2.items.map((m) => m.id)
    page2Ids.forEach((id) => expect(page1Ids.has(id)).toBe(false))
  })

  it('should reach end of results with cursor pagination', async () => {
    const page1 = await manager.getMessages(threadId, { limit: 10 })
    const page2 = await manager.getMessages(threadId, {
      limit: 10,
      cursor: page1.nextCursor,
    })
    const page3 = await manager.getMessages(threadId, {
      limit: 10,
      cursor: page2.nextCursor,
    })

    expect(page3.items).toHaveLength(5)
    expect(page3.hasMore).toBe(false)
    expect(page3.nextCursor).toBeUndefined()
  })

  it('should support reverse pagination', async () => {
    const result = await manager.getMessages(threadId, {
      limit: 10,
      order: 'desc',
    })

    expect(result.items[0].content).toBe('Message 25')
    expect(result.items[9].content).toBe('Message 16')
  })

  it('should include total count when requested', async () => {
    const result = await manager.getMessages(threadId, { limit: 10 })

    // totalCount may be optional but should be accurate if provided
    if (result.totalCount !== undefined) {
      expect(result.totalCount).toBe(25)
    }
  })

  it('should handle empty thread pagination', async () => {
    const emptyThread = await manager.createThread()

    const result = await manager.getMessages(emptyThread.id, { limit: 10 })

    expect(result.items).toHaveLength(0)
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeUndefined()
  })

  it('should return correct message count', async () => {
    const count = await manager.getMessageCount(threadId)

    expect(count).toBe(25)
  })

  it('should return zero count for empty thread', async () => {
    const emptyThread = await manager.createThread()

    const count = await manager.getMessageCount(emptyThread.id)

    expect(count).toBe(0)
  })
})

// =============================================================================
// TDD Cycle 8: Thread Listing
// =============================================================================

describe('Thread listing', () => {
  let manager: ThreadManager

  beforeEach(async () => {
    manager = createThreadManager()

    // Create test threads
    await manager.createThread({
      id: 'thread_active_1',
      title: 'Active Thread 1',
      metadata: { type: 'support' },
      participantIds: ['user_1', 'agent_1'],
    })

    await manager.createThread({
      id: 'thread_active_2',
      title: 'Active Thread 2',
      metadata: { type: 'sales' },
      participantIds: ['user_2', 'agent_1'],
    })

    const archivedThread = await manager.createThread({
      id: 'thread_archived_1',
      title: 'Archived Thread',
      participantIds: ['user_1'],
    })
    await manager.archiveThread(archivedThread.id)

    // Add messages to some threads
    await manager.appendMessage('thread_active_1', {
      role: 'user',
      content: 'Hello',
    })
    await manager.appendMessage('thread_active_2', {
      role: 'user',
      content: 'Hi there',
    })
  })

  it('should list all threads', async () => {
    const result = await manager.listThreads()

    expect(result.items.length).toBeGreaterThanOrEqual(3)
  })

  it('should filter threads by status', async () => {
    const activeThreads = await manager.listThreads({ status: 'active' })
    const archivedThreads = await manager.listThreads({ status: 'archived' })

    expect(activeThreads.items.every((t) => t.status === 'active')).toBe(true)
    expect(archivedThreads.items.every((t) => t.status === 'archived')).toBe(true)
  })

  it('should filter threads by participant', async () => {
    const result = await manager.listThreads({ participantId: 'user_1' })

    expect(result.items.length).toBe(2)
    expect(result.items.every((t) => t.participantIds?.includes('user_1'))).toBe(true)
  })

  it('should filter threads by creation date range', async () => {
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

    const result = await manager.listThreads({
      createdAfter: oneHourAgo,
      createdBefore: now,
    })

    expect(result.items.length).toBeGreaterThan(0)
    result.items.forEach((thread) => {
      expect(thread.createdAt.getTime()).toBeGreaterThanOrEqual(oneHourAgo.getTime())
      expect(thread.createdAt.getTime()).toBeLessThanOrEqual(now.getTime())
    })
  })

  it('should filter threads with messages', async () => {
    const result = await manager.listThreads({ hasMessages: true })

    expect(result.items.every((t) => t.messageCount > 0)).toBe(true)
  })

  it('should filter threads without messages', async () => {
    const result = await manager.listThreads({ hasMessages: false })

    expect(result.items.every((t) => t.messageCount === 0)).toBe(true)
  })

  it('should paginate thread results', async () => {
    // Create more threads for pagination
    for (let i = 0; i < 15; i++) {
      await manager.createThread({ title: `Pagination Thread ${i}` })
    }

    const page1 = await manager.listThreads({}, { limit: 5 })

    expect(page1.items).toHaveLength(5)
    expect(page1.hasMore).toBe(true)

    const page2 = await manager.listThreads({}, { limit: 5, cursor: page1.nextCursor })

    expect(page2.items).toHaveLength(5)

    // No overlap
    const page1Ids = new Set(page1.items.map((t) => t.id))
    page2.items.forEach((t) => expect(page1Ids.has(t.id)).toBe(false))
  })

  it('should sort threads by creation date descending', async () => {
    const result = await manager.listThreads({}, { order: 'desc' })

    for (let i = 1; i < result.items.length; i++) {
      expect(result.items[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        result.items[i].createdAt.getTime()
      )
    }
  })

  it('should sort threads by creation date ascending', async () => {
    const result = await manager.listThreads({}, { order: 'asc' })

    for (let i = 1; i < result.items.length; i++) {
      expect(result.items[i - 1].createdAt.getTime()).toBeLessThanOrEqual(
        result.items[i].createdAt.getTime()
      )
    }
  })

  it('should combine multiple filters', async () => {
    const result = await manager.listThreads({
      status: 'active',
      participantId: 'agent_1',
      hasMessages: true,
    })

    expect(result.items.every((t) => t.status === 'active')).toBe(true)
    expect(result.items.every((t) => t.participantIds?.includes('agent_1'))).toBe(true)
    expect(result.items.every((t) => t.messageCount > 0)).toBe(true)
  })
})

// =============================================================================
// TDD Cycle 9: Message Operations
// =============================================================================

describe('Message operations', () => {
  let manager: ThreadManager
  let threadId: string

  beforeEach(async () => {
    manager = createThreadManager()
    const thread = await manager.createThread()
    threadId = thread.id
  })

  it('should get a message by ID', async () => {
    const created = await manager.appendMessage(threadId, {
      id: 'msg_get_test',
      role: 'user',
      content: 'Test message',
    })

    const retrieved = await manager.getMessage(threadId, 'msg_get_test')

    expect(retrieved).not.toBeNull()
    expect(retrieved?.id).toBe(created.id)
    expect(retrieved?.content).toBe('Test message')
  })

  it('should return null for non-existent message', async () => {
    const result = await manager.getMessage(threadId, 'nonexistent_msg')

    expect(result).toBeNull()
  })

  it('should update message content', async () => {
    const message = await manager.appendMessage(threadId, {
      role: 'assistant',
      content: 'Original content',
    })

    const updated = await manager.updateMessage(threadId, message.id, {
      content: 'Updated content',
    })

    expect(updated.content).toBe('Updated content')
  })

  it('should update message metadata', async () => {
    const message = await manager.appendMessage(threadId, {
      role: 'assistant',
      content: 'Response',
      metadata: { key1: 'value1' },
    })

    const updated = await manager.updateMessage(threadId, message.id, {
      metadata: { key2: 'value2' },
    })

    expect(updated.metadata.key1).toBe('value1')
    expect(updated.metadata.key2).toBe('value2')
  })

  it('should update message status', async () => {
    const message = await manager.appendMessage(threadId, {
      role: 'assistant',
      content: 'Processing...',
    })

    const updated = await manager.updateMessage(threadId, message.id, {
      status: 'completed',
    })

    expect(updated.status).toBe('completed')
  })

  it('should delete a message', async () => {
    const message = await manager.appendMessage(threadId, {
      role: 'user',
      content: 'To be deleted',
    })

    await manager.deleteMessage(threadId, message.id)

    const result = await manager.getMessage(threadId, message.id)
    expect(result).toBeNull()
  })

  it('should decrement messageCount on delete', async () => {
    await manager.appendMessage(threadId, { role: 'user', content: 'Msg 1' })
    const msg2 = await manager.appendMessage(threadId, { role: 'assistant', content: 'Msg 2' })
    await manager.appendMessage(threadId, { role: 'user', content: 'Msg 3' })

    let thread = await manager.getThread(threadId)
    expect(thread?.messageCount).toBe(3)

    await manager.deleteMessage(threadId, msg2.id)

    thread = await manager.getThread(threadId)
    expect(thread?.messageCount).toBe(2)
  })

  it('should clear all messages from thread', async () => {
    await manager.appendMessage(threadId, { role: 'user', content: 'Msg 1' })
    await manager.appendMessage(threadId, { role: 'assistant', content: 'Msg 2' })
    await manager.appendMessage(threadId, { role: 'user', content: 'Msg 3' })

    await manager.clearMessages(threadId)

    const messages = await manager.getMessages(threadId)
    const thread = await manager.getThread(threadId)

    expect(messages.items).toHaveLength(0)
    expect(thread?.messageCount).toBe(0)
    expect(thread?.lastMessageAt).toBeUndefined()
  })

  it('should throw when updating non-existent message', async () => {
    await expect(
      manager.updateMessage(threadId, 'nonexistent', { content: 'Test' })
    ).rejects.toThrow(/message not found/i)
  })

  it('should throw when deleting non-existent message', async () => {
    await expect(manager.deleteMessage(threadId, 'nonexistent')).rejects.toThrow(
      /message not found/i
    )
  })
})

// =============================================================================
// TDD Cycle 10: Integration Tests
// =============================================================================

describe('Integration: Complete conversation flow', () => {
  let manager: ThreadManager

  beforeEach(() => {
    manager = createThreadManager()
  })

  it('should handle a complete support conversation', async () => {
    // Create thread for customer support
    const thread = await manager.createThread({
      title: 'Password Reset Help',
      metadata: {
        customerId: 'cust_123',
        channel: 'web_chat',
        category: 'account',
      },
      participantIds: ['cust_123', 'bot_support'],
    })

    expect(thread.status).toBe('active')

    // Customer asks question
    const q1 = await manager.appendMessage(thread.id, {
      role: 'user',
      content: 'I forgot my password. How can I reset it?',
      metadata: { sentiment: 'neutral' },
    })

    expect(q1.role).toBe('user')

    // Bot responds
    const a1 = await manager.appendMessage(thread.id, {
      role: 'assistant',
      content: 'I can help you reset your password. Please go to the login page and click "Forgot Password".',
      metadata: { model: 'support-bot-v2' },
    })

    expect(a1.role).toBe('assistant')

    // Follow-up question
    await manager.appendMessage(thread.id, {
      role: 'user',
      content: "I don't see that option. Can you help?",
    })

    // Verify thread state
    const updatedThread = await manager.getThread(thread.id)
    expect(updatedThread?.messageCount).toBe(3)
    expect(updatedThread?.lastMessageAt).toBeInstanceOf(Date)

    // Get conversation history
    const messages = await manager.getMessages(thread.id)
    expect(messages.items).toHaveLength(3)
    expect(messages.items[0].content).toContain('forgot my password')
    expect(messages.items[2].content).toContain("don't see that option")
  })

  it('should handle multi-turn conversation with tool calls', async () => {
    const thread = await manager.createThread({
      metadata: { type: 'agent_task' },
    })

    // User request
    await manager.appendMessage(thread.id, {
      role: 'user',
      content: 'What is the weather in San Francisco?',
    })

    // Agent initiates tool call
    await manager.appendMessage(thread.id, {
      role: 'assistant',
      content: [
        {
          type: 'tool_call',
          toolCallId: 'call_weather_1',
          toolName: 'get_weather',
          input: { location: 'San Francisco, CA' },
        },
      ],
      metadata: { model: 'claude-3-opus' },
    })

    // Tool result
    await manager.appendMessage(thread.id, {
      role: 'tool',
      content: [
        {
          type: 'tool_result',
          toolCallId: 'call_weather_1',
          output: { temperature: 65, conditions: 'sunny', humidity: 45 },
        },
      ],
    })

    // Final response
    await manager.appendMessage(thread.id, {
      role: 'assistant',
      content: "The weather in San Francisco is currently 65F and sunny with 45% humidity.",
    })

    const messages = await manager.getMessages(thread.id)
    expect(messages.items).toHaveLength(4)

    // Verify tool call message
    const toolCallMsg = messages.items[1]
    const toolContent = toolCallMsg.content as Array<{
      type: string
      toolCallId?: string
      toolName?: string
    }>
    expect(toolContent[0].type).toBe('tool_call')
    expect(toolContent[0].toolName).toBe('get_weather')
  })

  it('should support conversation branching', async () => {
    const thread = await manager.createThread()

    const msg1 = await manager.appendMessage(thread.id, {
      role: 'user',
      content: 'Write me a poem about cats',
    })

    // First response
    const response1 = await manager.appendMessage(thread.id, {
      role: 'assistant',
      content: 'Whiskers soft and eyes so bright...',
      parentMessageId: msg1.id,
    })

    // Alternative response (branch)
    const response2 = await manager.appendMessage(thread.id, {
      role: 'assistant',
      content: 'In the moonlight, cats do play...',
      parentMessageId: msg1.id,
    })

    expect(response1.parentMessageId).toBe(msg1.id)
    expect(response2.parentMessageId).toBe(msg1.id)

    // Both should be in the thread
    const messages = await manager.getMessages(thread.id)
    expect(messages.items).toHaveLength(3)
  })

  it('should handle thread archival correctly', async () => {
    const thread = await manager.createThread()

    await manager.appendMessage(thread.id, {
      role: 'user',
      content: 'This conversation is done',
    })

    const archived = await manager.archiveThread(thread.id)
    expect(archived.status).toBe('archived')

    // Messages should still be accessible
    const messages = await manager.getMessages(thread.id)
    expect(messages.items).toHaveLength(1)

    // Thread should appear in archived filter
    const archivedThreads = await manager.listThreads({ status: 'archived' })
    expect(archivedThreads.items.some((t) => t.id === thread.id)).toBe(true)
  })

  it('should handle high message volume efficiently', async () => {
    const thread = await manager.createThread()

    // Add 100 messages
    for (let i = 0; i < 100; i++) {
      await manager.appendMessage(thread.id, {
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message number ${i + 1}`,
      })
    }

    // Verify count
    const count = await manager.getMessageCount(thread.id)
    expect(count).toBe(100)

    // Pagination should work correctly
    const page1 = await manager.getMessages(thread.id, { limit: 20 })
    expect(page1.items).toHaveLength(20)
    expect(page1.hasMore).toBe(true)

    // Get last page
    let lastPage = page1
    while (lastPage.hasMore) {
      lastPage = await manager.getMessages(thread.id, {
        limit: 20,
        cursor: lastPage.nextCursor,
      })
    }

    expect(lastPage.hasMore).toBe(false)
    expect(lastPage.items[lastPage.items.length - 1].content).toBe('Message number 100')
  })
})

// =============================================================================
// TDD Cycle 11: Thread Hierarchy (Parent/Child Threads)
// =============================================================================

describe('Thread hierarchy (parent/child threads)', () => {
  let manager: ThreadManager

  beforeEach(() => {
    manager = createThreadManager()
  })

  it('should create a child thread with parentThreadId', async () => {
    const parent = await manager.createThread({ title: 'Parent Thread' })
    const child = await manager.createThread({
      title: 'Child Thread',
      parentThreadId: parent.id,
    })

    expect(child.parentThreadId).toBe(parent.id)
  })

  it('should get child threads for a parent', async () => {
    const parent = await manager.createThread({ title: 'Parent Thread' })
    const child1 = await manager.createThread({
      title: 'Child 1',
      parentThreadId: parent.id,
    })
    const child2 = await manager.createThread({
      title: 'Child 2',
      parentThreadId: parent.id,
    })

    const children = await manager.getChildThreads(parent.id)

    expect(children).toHaveLength(2)
    expect(children.map((c) => c.id)).toContain(child1.id)
    expect(children.map((c) => c.id)).toContain(child2.id)
  })

  it('should return empty array when thread has no children', async () => {
    const thread = await manager.createThread({ title: 'No Children' })

    const children = await manager.getChildThreads(thread.id)

    expect(children).toHaveLength(0)
  })

  it('should get parent thread', async () => {
    const parent = await manager.createThread({ title: 'Parent Thread' })
    const child = await manager.createThread({
      title: 'Child Thread',
      parentThreadId: parent.id,
    })

    const retrieved = await manager.getParentThread(child.id)

    expect(retrieved).not.toBeNull()
    expect(retrieved?.id).toBe(parent.id)
    expect(retrieved?.title).toBe('Parent Thread')
  })

  it('should return null when thread has no parent', async () => {
    const thread = await manager.createThread({ title: 'Root Thread' })

    const parent = await manager.getParentThread(thread.id)

    expect(parent).toBeNull()
  })

  it('should return null for non-existent thread when getting parent', async () => {
    const parent = await manager.getParentThread('nonexistent')

    expect(parent).toBeNull()
  })

  it('should filter threads by parentThreadId', async () => {
    const parent = await manager.createThread({ title: 'Parent' })
    await manager.createThread({ title: 'Child 1', parentThreadId: parent.id })
    await manager.createThread({ title: 'Child 2', parentThreadId: parent.id })
    await manager.createThread({ title: 'Root Thread' })

    const children = await manager.listThreads({ parentThreadId: parent.id })

    expect(children.items).toHaveLength(2)
    expect(children.items.every((t) => t.parentThreadId === parent.id)).toBe(true)
  })

  it('should filter for root threads only (null parentThreadId)', async () => {
    const parent = await manager.createThread({ title: 'Root 1' })
    await manager.createThread({ title: 'Root 2' })
    await manager.createThread({ title: 'Child', parentThreadId: parent.id })

    const roots = await manager.listThreads({ parentThreadId: null })

    expect(roots.items).toHaveLength(2)
    expect(roots.items.every((t) => !t.parentThreadId)).toBe(true)
  })

  it('should support multiple levels of nesting', async () => {
    const grandparent = await manager.createThread({ title: 'Level 0' })
    const parent = await manager.createThread({
      title: 'Level 1',
      parentThreadId: grandparent.id,
    })
    const child = await manager.createThread({
      title: 'Level 2',
      parentThreadId: parent.id,
    })

    expect(child.parentThreadId).toBe(parent.id)

    const parentOfChild = await manager.getParentThread(child.id)
    expect(parentOfChild?.id).toBe(parent.id)

    const grandparentOfChild = await manager.getParentThread(parent.id)
    expect(grandparentOfChild?.id).toBe(grandparent.id)
  })
})

// =============================================================================
// TDD Cycle 12: Read/Unread Tracking
// =============================================================================

describe('Read/unread tracking', () => {
  let manager: ThreadManager
  let threadId: string

  beforeEach(async () => {
    manager = createThreadManager()
    const thread = await manager.createThread({
      participantIds: ['user_1', 'agent_1', 'ai_bot'],
    })
    threadId = thread.id
  })

  it('should mark a specific message as read', async () => {
    const msg1 = await manager.appendMessage(threadId, { role: 'user', content: 'First' })
    await manager.appendMessage(threadId, { role: 'assistant', content: 'Second' })

    await manager.markAsRead(threadId, 'user_1', msg1.id)

    const lastRead = await manager.getLastReadMessageId(threadId, 'user_1')
    expect(lastRead).toBe(msg1.id)
  })

  it('should mark all messages as read when no messageId provided', async () => {
    await manager.appendMessage(threadId, { role: 'user', content: 'First' })
    await manager.appendMessage(threadId, { role: 'assistant', content: 'Second' })
    const msg3 = await manager.appendMessage(threadId, { role: 'user', content: 'Third' })

    await manager.markAsRead(threadId, 'user_1')

    const lastRead = await manager.getLastReadMessageId(threadId, 'user_1')
    expect(lastRead).toBe(msg3.id)
  })

  it('should return correct unread count', async () => {
    const msg1 = await manager.appendMessage(threadId, { role: 'user', content: 'First' })
    await manager.appendMessage(threadId, { role: 'assistant', content: 'Second' })
    await manager.appendMessage(threadId, { role: 'user', content: 'Third' })

    await manager.markAsRead(threadId, 'agent_1', msg1.id)

    const unread = await manager.getUnreadCount(threadId, 'agent_1')
    expect(unread).toBe(2) // Second and Third are unread
  })

  it('should return all messages as unread when no read receipt', async () => {
    await manager.appendMessage(threadId, { role: 'user', content: 'First' })
    await manager.appendMessage(threadId, { role: 'assistant', content: 'Second' })
    await manager.appendMessage(threadId, { role: 'user', content: 'Third' })

    const unread = await manager.getUnreadCount(threadId, 'agent_1')
    expect(unread).toBe(3)
  })

  it('should return 0 unread when all messages are read', async () => {
    await manager.appendMessage(threadId, { role: 'user', content: 'First' })
    await manager.appendMessage(threadId, { role: 'assistant', content: 'Second' })
    await manager.appendMessage(threadId, { role: 'user', content: 'Third' })

    await manager.markAsRead(threadId, 'agent_1')

    const unread = await manager.getUnreadCount(threadId, 'agent_1')
    expect(unread).toBe(0)
  })

  it('should track read status independently per participant', async () => {
    const msg1 = await manager.appendMessage(threadId, { role: 'user', content: 'First' })
    await manager.appendMessage(threadId, { role: 'assistant', content: 'Second' })
    const msg3 = await manager.appendMessage(threadId, { role: 'user', content: 'Third' })

    // User read only first message, agent read all
    await manager.markAsRead(threadId, 'user_1', msg1.id)
    await manager.markAsRead(threadId, 'agent_1', msg3.id)

    expect(await manager.getUnreadCount(threadId, 'user_1')).toBe(2)
    expect(await manager.getUnreadCount(threadId, 'agent_1')).toBe(0)
  })

  it('should return null when getting last read for participant with no read receipt', async () => {
    await manager.appendMessage(threadId, { role: 'user', content: 'First' })

    const lastRead = await manager.getLastReadMessageId(threadId, 'new_participant')
    expect(lastRead).toBeNull()
  })

  it('should return 0 unread for empty thread', async () => {
    const unread = await manager.getUnreadCount(threadId, 'user_1')
    expect(unread).toBe(0)
  })

  it('should throw when marking non-existent message as read', async () => {
    await manager.appendMessage(threadId, { role: 'user', content: 'First' })

    await expect(
      manager.markAsRead(threadId, 'user_1', 'nonexistent_msg')
    ).rejects.toThrow(/not found/i)
  })

  it('should throw when marking read on non-existent thread', async () => {
    await expect(manager.markAsRead('nonexistent_thread', 'user_1')).rejects.toThrow(
      /not found/i
    )
  })

  it('should return 0 unread for non-existent thread', async () => {
    const unread = await manager.getUnreadCount('nonexistent_thread', 'user_1')
    expect(unread).toBe(0)
  })

  it('should handle read receipts correctly after new messages', async () => {
    const msg1 = await manager.appendMessage(threadId, { role: 'user', content: 'First' })
    await manager.markAsRead(threadId, 'agent_1', msg1.id)

    // Verify 0 unread
    expect(await manager.getUnreadCount(threadId, 'agent_1')).toBe(0)

    // Add more messages
    await manager.appendMessage(threadId, { role: 'assistant', content: 'Second' })
    await manager.appendMessage(threadId, { role: 'user', content: 'Third' })

    // Should have 2 unread
    expect(await manager.getUnreadCount(threadId, 'agent_1')).toBe(2)
  })
})
