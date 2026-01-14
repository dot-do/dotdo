/**
 * ConversationEngine - Multi-channel messaging and state machines
 *
 * TDD RED phase: These tests define the expected behavior for:
 * - Conversation: Container for messages with participants and state
 * - Message: Individual message with content types and metadata
 * - Participant: Customer, agent, AI with roles and permissions
 * - StateMachine: Conversation states, transitions, timeouts
 * - Channel: Email, SMS, chat, social abstractions
 * - Routing: Assignment, escalation, queue management
 * - Templates: Message templates with variable substitution
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  // Core engine
  ConversationEngine,
  createConversationEngine,
  type ConversationEngineConfig,
  // Conversation
  type Conversation,
  type ConversationOptions,
  type ConversationStatus,
  // Message
  type Message,
  type MessageOptions,
  type MessageContent,
  type MessageContentType,
  // Participant
  type Participant,
  type ParticipantRole,
  type ParticipantOptions,
  // State Machine
  type ConversationState,
  type StateTransition,
  type TransitionOptions,
  type TimeoutAction,
  // Channel
  type Channel,
  type ChannelType,
  type ChannelConfig,
  type ChannelAdapter,
  createChannelAdapter,
  // Routing
  type AssignmentOptions,
  type EscalationOptions,
  type RoutingRule,
  // Templates
  type MessageTemplate,
  type TemplateVariables,
  // Query
  type ConversationQuery,
  type QueryResult,
} from './index'

// =============================================================================
// ConversationEngine Core Tests
// =============================================================================

describe('ConversationEngine', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  describe('basic operations', () => {
    it('should create an engine with default configuration', () => {
      expect(engine).toBeDefined()
      expect(typeof engine.createConversation).toBe('function')
      expect(typeof engine.getConversation).toBe('function')
      expect(typeof engine.addMessage).toBe('function')
    })

    it('should create an engine with custom configuration', () => {
      const config: ConversationEngineConfig = {
        defaultChannel: 'chat',
        defaultState: 'new',
        maxParticipants: 10,
        maxMessagesPerConversation: 1000,
      }
      const customEngine = createConversationEngine(config)
      expect(customEngine).toBeDefined()
    })
  })
})

// =============================================================================
// Conversation Tests
// =============================================================================

describe('Conversation', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  describe('create conversation', () => {
    it('should create a conversation with minimal options', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [
          { id: 'user_123', role: 'customer' },
        ],
      })

      expect(conv).toBeDefined()
      expect(conv.id).toBeDefined()
      expect(conv.channel).toBe('email')
      expect(conv.status).toBe('open')
      expect(conv.participants).toHaveLength(1)
      expect(conv.messages).toHaveLength(0)
      expect(conv.createdAt).toBeInstanceOf(Date)
    })

    it('should create a conversation with full options', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [
          { id: 'user_123', role: 'customer', email: 'user@example.com', name: 'John Doe' },
          { id: 'agent_456', role: 'agent', email: 'agent@company.com', name: 'Agent Smith' },
        ],
        subject: 'Support Request',
        metadata: { ticketId: 'TICKET-123', priority: 'high' },
        tags: ['billing', 'urgent'],
      })

      expect(conv.subject).toBe('Support Request')
      expect(conv.metadata.ticketId).toBe('TICKET-123')
      expect(conv.tags).toContain('billing')
      expect(conv.participants).toHaveLength(2)
    })

    it('should auto-generate conversation ID if not provided', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      expect(conv.id).toBeDefined()
      expect(typeof conv.id).toBe('string')
      expect(conv.id.length).toBeGreaterThan(0)
    })

    it('should use provided conversation ID', async () => {
      const conv = await engine.createConversation({
        id: 'my-custom-id',
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      expect(conv.id).toBe('my-custom-id')
    })

    it('should reject duplicate conversation IDs', async () => {
      await engine.createConversation({
        id: 'unique-id',
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await expect(
        engine.createConversation({
          id: 'unique-id',
          channel: 'chat',
          participants: [{ id: 'user_1', role: 'customer' }],
        })
      ).rejects.toThrow(/already exists/)
    })
  })

  describe('get conversation', () => {
    it('should retrieve an existing conversation', async () => {
      const created = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_123', role: 'customer' }],
        subject: 'Test Subject',
      })

      const retrieved = await engine.getConversation(created.id)

      expect(retrieved).toBeDefined()
      expect(retrieved!.id).toBe(created.id)
      expect(retrieved!.subject).toBe('Test Subject')
    })

    it('should return undefined for non-existent conversation', async () => {
      const result = await engine.getConversation('non-existent-id')
      expect(result).toBeUndefined()
    })
  })

  describe('update conversation', () => {
    it('should update conversation metadata', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
        metadata: { key1: 'value1' },
      })

      const updated = await engine.updateConversation(conv.id, {
        metadata: { key1: 'value1', key2: 'value2' },
      })

      expect(updated.metadata.key2).toBe('value2')
    })

    it('should update conversation subject', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_1', role: 'customer' }],
        subject: 'Original Subject',
      })

      const updated = await engine.updateConversation(conv.id, {
        subject: 'Updated Subject',
      })

      expect(updated.subject).toBe('Updated Subject')
    })

    it('should update conversation tags', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
        tags: ['original'],
      })

      const updated = await engine.updateConversation(conv.id, {
        tags: ['original', 'new-tag'],
      })

      expect(updated.tags).toContain('new-tag')
    })

    it('should throw for non-existent conversation', async () => {
      await expect(
        engine.updateConversation('non-existent', { subject: 'New' })
      ).rejects.toThrow(/not found/)
    })

    it('should update the updatedAt timestamp', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      const originalUpdatedAt = conv.updatedAt

      // Small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10))

      const updated = await engine.updateConversation(conv.id, {
        subject: 'New Subject',
      })

      expect(updated.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
    })
  })

  describe('close conversation', () => {
    it('should close an open conversation', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      const closed = await engine.closeConversation(conv.id, {
        reason: 'resolved',
      })

      expect(closed.status).toBe('closed')
      expect(closed.closedAt).toBeInstanceOf(Date)
      expect(closed.closeReason).toBe('resolved')
    })

    it('should not close an already closed conversation', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.closeConversation(conv.id, { reason: 'resolved' })

      await expect(
        engine.closeConversation(conv.id, { reason: 'duplicate' })
      ).rejects.toThrow(/already closed/)
    })
  })

  describe('reopen conversation', () => {
    it('should reopen a closed conversation', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engine.closeConversation(conv.id, { reason: 'resolved' })
      const reopened = await engine.reopenConversation(conv.id, {
        reason: 'customer follow-up',
      })

      expect(reopened.status).toBe('open')
      expect(reopened.closedAt).toBeUndefined()
    })

    it('should not reopen an open conversation', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await expect(
        engine.reopenConversation(conv.id, { reason: 'test' })
      ).rejects.toThrow(/not closed/)
    })
  })
})

// =============================================================================
// Message Tests
// =============================================================================

describe('Message', () => {
  let engine: ConversationEngine
  let conversationId: string

  beforeEach(async () => {
    engine = createConversationEngine()
    const conv = await engine.createConversation({
      channel: 'email',
      participants: [
        { id: 'user_123', role: 'customer' },
        { id: 'agent_456', role: 'agent' },
      ],
    })
    conversationId = conv.id
  })

  describe('add message', () => {
    it('should add a text message', async () => {
      const message = await engine.addMessage(conversationId, {
        from: 'user_123',
        content: 'I need help with my order',
        contentType: 'text/plain',
      })

      expect(message).toBeDefined()
      expect(message.id).toBeDefined()
      expect(message.conversationId).toBe(conversationId)
      expect(message.from).toBe('user_123')
      expect(message.content).toBe('I need help with my order')
      expect(message.contentType).toBe('text/plain')
      expect(message.createdAt).toBeInstanceOf(Date)
    })

    it('should add an HTML message', async () => {
      const message = await engine.addMessage(conversationId, {
        from: 'agent_456',
        content: '<p>Hello! How can I help?</p>',
        contentType: 'text/html',
      })

      expect(message.contentType).toBe('text/html')
    })

    it('should add a message with attachments', async () => {
      const message = await engine.addMessage(conversationId, {
        from: 'user_123',
        content: 'Here is the screenshot',
        contentType: 'text/plain',
        attachments: [
          {
            id: 'att_1',
            filename: 'screenshot.png',
            mimeType: 'image/png',
            size: 12345,
            url: 'https://storage.example.com/screenshot.png',
          },
        ],
      })

      expect(message.attachments).toHaveLength(1)
      expect(message.attachments![0].filename).toBe('screenshot.png')
    })

    it('should add a message with metadata', async () => {
      const message = await engine.addMessage(conversationId, {
        from: 'agent_456',
        content: 'Automated response',
        contentType: 'text/plain',
        metadata: {
          automated: true,
          templateId: 'template_123',
        },
      })

      expect(message.metadata!.automated).toBe(true)
    })

    it('should throw for non-existent conversation', async () => {
      await expect(
        engine.addMessage('non-existent', {
          from: 'user_123',
          content: 'Hello',
          contentType: 'text/plain',
        })
      ).rejects.toThrow(/not found/)
    })

    it('should throw for non-participant sender', async () => {
      await expect(
        engine.addMessage(conversationId, {
          from: 'unknown_user',
          content: 'Hello',
          contentType: 'text/plain',
        })
      ).rejects.toThrow(/not a participant/)
    })

    it('should update conversation updatedAt when message is added', async () => {
      const conv = await engine.getConversation(conversationId)
      const originalUpdatedAt = conv!.updatedAt

      await new Promise(resolve => setTimeout(resolve, 10))

      await engine.addMessage(conversationId, {
        from: 'user_123',
        content: 'Hello',
        contentType: 'text/plain',
      })

      const updated = await engine.getConversation(conversationId)
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
    })
  })

  describe('get messages', () => {
    it('should retrieve all messages in a conversation', async () => {
      await engine.addMessage(conversationId, {
        from: 'user_123',
        content: 'First message',
        contentType: 'text/plain',
      })
      await engine.addMessage(conversationId, {
        from: 'agent_456',
        content: 'Second message',
        contentType: 'text/plain',
      })

      const messages = await engine.getMessages(conversationId)

      expect(messages).toHaveLength(2)
      expect(messages[0].content).toBe('First message')
      expect(messages[1].content).toBe('Second message')
    })

    it('should retrieve messages with pagination', async () => {
      for (let i = 0; i < 10; i++) {
        await engine.addMessage(conversationId, {
          from: 'user_123',
          content: `Message ${i}`,
          contentType: 'text/plain',
        })
      }

      const firstPage = await engine.getMessages(conversationId, { limit: 5 })
      expect(firstPage).toHaveLength(5)

      const secondPage = await engine.getMessages(conversationId, {
        limit: 5,
        offset: 5,
      })
      expect(secondPage).toHaveLength(5)
      expect(secondPage[0].content).toBe('Message 5')
    })

    it('should return empty array for conversation with no messages', async () => {
      const messages = await engine.getMessages(conversationId)
      expect(messages).toHaveLength(0)
    })
  })

  describe('message delivery status', () => {
    it('should track message delivery status', async () => {
      const message = await engine.addMessage(conversationId, {
        from: 'agent_456',
        content: 'Hello',
        contentType: 'text/plain',
      })

      expect(message.status).toBe('sent')

      const updated = await engine.updateMessageStatus(message.id, 'delivered')
      expect(updated.status).toBe('delivered')
      expect(updated.deliveredAt).toBeInstanceOf(Date)
    })

    it('should track message read status', async () => {
      const message = await engine.addMessage(conversationId, {
        from: 'agent_456',
        content: 'Hello',
        contentType: 'text/plain',
      })

      await engine.updateMessageStatus(message.id, 'delivered')
      const read = await engine.updateMessageStatus(message.id, 'read')

      expect(read.status).toBe('read')
      expect(read.readAt).toBeInstanceOf(Date)
    })
  })
})

// =============================================================================
// Participant Tests
// =============================================================================

describe('Participant', () => {
  let engine: ConversationEngine
  let conversationId: string

  beforeEach(async () => {
    engine = createConversationEngine()
    const conv = await engine.createConversation({
      channel: 'chat',
      participants: [
        { id: 'user_123', role: 'customer' },
      ],
    })
    conversationId = conv.id
  })

  describe('add participant', () => {
    it('should add a new participant to conversation', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
        name: 'Agent Smith',
      })

      const conv = await engine.getConversation(conversationId)
      expect(conv!.participants).toHaveLength(2)
      expect(conv!.participants.some(p => p.id === 'agent_456')).toBe(true)
    })

    it('should reject duplicate participants', async () => {
      await expect(
        engine.addParticipant(conversationId, {
          id: 'user_123',
          role: 'customer',
        })
      ).rejects.toThrow(/already a participant/)
    })

    it('should add AI participant', async () => {
      await engine.addParticipant(conversationId, {
        id: 'ai_bot_1',
        role: 'ai',
        name: 'Support Bot',
        metadata: { model: 'gpt-4' },
      })

      const conv = await engine.getConversation(conversationId)
      const aiParticipant = conv!.participants.find(p => p.id === 'ai_bot_1')
      expect(aiParticipant).toBeDefined()
      expect(aiParticipant!.role).toBe('ai')
    })
  })

  describe('remove participant', () => {
    it('should remove a participant from conversation', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
      })

      await engine.removeParticipant(conversationId, 'agent_456')

      const conv = await engine.getConversation(conversationId)
      expect(conv!.participants).toHaveLength(1)
      expect(conv!.participants.some(p => p.id === 'agent_456')).toBe(false)
    })

    it('should not remove the last customer', async () => {
      await expect(
        engine.removeParticipant(conversationId, 'user_123')
      ).rejects.toThrow(/cannot remove last customer/)
    })
  })

  describe('update participant', () => {
    it('should update participant metadata', async () => {
      await engine.updateParticipant(conversationId, 'user_123', {
        metadata: { vipStatus: true },
      })

      const conv = await engine.getConversation(conversationId)
      const participant = conv!.participants.find(p => p.id === 'user_123')
      expect(participant!.metadata!.vipStatus).toBe(true)
    })

    it('should update participant name', async () => {
      await engine.updateParticipant(conversationId, 'user_123', {
        name: 'Jane Doe',
      })

      const conv = await engine.getConversation(conversationId)
      const participant = conv!.participants.find(p => p.id === 'user_123')
      expect(participant!.name).toBe('Jane Doe')
    })
  })
})

// =============================================================================
// State Machine Tests
// =============================================================================

describe('State Machine', () => {
  let engine: ConversationEngine
  let conversationId: string

  beforeEach(async () => {
    engine = createConversationEngine({
      states: {
        initial: 'new',
        states: ['new', 'active', 'pending', 'awaiting_response', 'resolved', 'closed'],
        transitions: [
          { from: 'new', to: 'active', on: 'start' },
          { from: 'active', to: 'pending', on: 'pause' },
          { from: 'active', to: 'awaiting_response', on: 'await' },
          { from: 'active', to: 'resolved', on: 'resolve' },
          { from: 'pending', to: 'active', on: 'resume' },
          { from: 'awaiting_response', to: 'active', on: 'respond' },
          { from: 'resolved', to: 'closed', on: 'close' },
          { from: '*', to: 'closed', on: 'force_close' },
        ],
      },
    })

    const conv = await engine.createConversation({
      channel: 'chat',
      participants: [{ id: 'user_123', role: 'customer' }],
    })
    conversationId = conv.id
  })

  describe('transition', () => {
    it('should transition to a valid state', async () => {
      const result = await engine.transition(conversationId, 'active')

      expect(result.state).toBe('active')
      expect(result.previousState).toBe('new')
    })

    it('should reject invalid state transitions', async () => {
      await expect(
        engine.transition(conversationId, 'closed')
      ).rejects.toThrow(/invalid transition/)
    })

    it('should support wildcard transitions', async () => {
      await engine.transition(conversationId, 'active')

      // force_close should work from any state
      const result = await engine.transition(conversationId, 'closed', {
        event: 'force_close',
      })

      expect(result.state).toBe('closed')
    })

    it('should record state history', async () => {
      await engine.transition(conversationId, 'active')
      await engine.transition(conversationId, 'pending', { event: 'pause' })
      await engine.transition(conversationId, 'active', { event: 'resume' })

      const conv = await engine.getConversation(conversationId)
      expect(conv!.stateHistory).toHaveLength(3)
      expect(conv!.stateHistory[0].to).toBe('active')
      expect(conv!.stateHistory[1].to).toBe('pending')
    })
  })

  describe('timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should set up a timeout action', async () => {
      await engine.transition(conversationId, 'active')

      await engine.transition(conversationId, 'awaiting_response', {
        timeout: '24h',
        onTimeout: 'escalate',
      })

      const conv = await engine.getConversation(conversationId)
      expect(conv!.timeout).toBeDefined()
      expect(conv!.timeout!.action).toBe('escalate')
    })

    it('should trigger timeout action after duration', async () => {
      const onTimeoutHandler = vi.fn()
      engine.onTimeout(onTimeoutHandler)

      await engine.transition(conversationId, 'active')
      await engine.transition(conversationId, 'awaiting_response', {
        timeout: '1h',
        onTimeout: 'escalate',
      })

      // Advance time by 1 hour
      vi.advanceTimersByTime(60 * 60 * 1000)

      expect(onTimeoutHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId,
          action: 'escalate',
        })
      )
    })

    it('should cancel timeout on state change', async () => {
      await engine.transition(conversationId, 'active')
      await engine.transition(conversationId, 'awaiting_response', {
        timeout: '1h',
        onTimeout: 'escalate',
      })

      // Respond before timeout
      await engine.transition(conversationId, 'active', { event: 'respond' })

      const conv = await engine.getConversation(conversationId)
      expect(conv!.timeout).toBeUndefined()
    })
  })

  describe('guards', () => {
    it('should support transition guards', async () => {
      const engineWithGuards = createConversationEngine({
        states: {
          initial: 'new',
          states: ['new', 'active', 'resolved'],
          transitions: [
            { from: 'new', to: 'active', on: 'start' },
            {
              from: 'active',
              to: 'resolved',
              on: 'resolve',
              guard: (conv) => conv.messages.length > 0,
            },
          ],
        },
      })

      const conv = await engineWithGuards.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_1', role: 'customer' }],
      })

      await engineWithGuards.transition(conv.id, 'active')

      // Should fail because no messages
      await expect(
        engineWithGuards.transition(conv.id, 'resolved', { event: 'resolve' })
      ).rejects.toThrow(/guard/)
    })
  })
})

// =============================================================================
// Channel Tests
// =============================================================================

describe('Channel', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  describe('channel adapters', () => {
    it('should create email channel adapter', () => {
      const adapter = createChannelAdapter('email', {
        provider: 'sendgrid',
        fromAddress: 'support@example.com',
      })

      expect(adapter).toBeDefined()
      expect(adapter.type).toBe('email')
      expect(typeof adapter.send).toBe('function')
      expect(typeof adapter.receive).toBe('function')
    })

    it('should create SMS channel adapter', () => {
      const adapter = createChannelAdapter('sms', {
        provider: 'twilio',
        fromNumber: '+1234567890',
      })

      expect(adapter.type).toBe('sms')
    })

    it('should create chat channel adapter', () => {
      const adapter = createChannelAdapter('chat', {
        provider: 'internal',
      })

      expect(adapter.type).toBe('chat')
    })

    it('should create social channel adapter', () => {
      const adapter = createChannelAdapter('social', {
        platform: 'twitter',
        accountId: '@support',
      })

      expect(adapter.type).toBe('social')
    })
  })

  describe('register channel', () => {
    it('should register a channel adapter', async () => {
      const adapter = createChannelAdapter('email', {
        provider: 'sendgrid',
        fromAddress: 'support@example.com',
      })

      engine.registerChannel(adapter)

      const channels = engine.getChannels()
      expect(channels).toContain('email')
    })

    it('should use registered channel for sending', async () => {
      const sendMock = vi.fn().mockResolvedValue({ messageId: 'msg_123' })
      const adapter: ChannelAdapter = {
        type: 'email',
        send: sendMock,
        receive: vi.fn(),
        formatMessage: (msg) => msg,
      }

      engine.registerChannel(adapter)

      const conv = await engine.createConversation({
        channel: 'email',
        participants: [
          { id: 'user_123', role: 'customer', email: 'user@example.com' },
          { id: 'agent_456', role: 'agent', email: 'agent@company.com' },
        ],
      })

      await engine.addMessage(conv.id, {
        from: 'agent_456',
        content: 'Hello!',
        contentType: 'text/plain',
        deliverViaChannel: true,
      })

      expect(sendMock).toHaveBeenCalled()
    })
  })

  describe('channel bridging', () => {
    it('should bridge message from email to chat format', async () => {
      const conv = await engine.createConversation({
        channel: 'email',
        participants: [{ id: 'user_123', role: 'customer' }],
      })

      await engine.addMessage(conv.id, {
        from: 'user_123',
        content: '<html><body><p>Hello</p></body></html>',
        contentType: 'text/html',
      })

      const chatFormat = await engine.getMessagesForChannel(conv.id, 'chat')
      expect(chatFormat[0].content).toBe('Hello') // Stripped HTML
    })
  })
})

// =============================================================================
// Routing Tests
// =============================================================================

describe('Routing', () => {
  let engine: ConversationEngine
  let conversationId: string

  beforeEach(async () => {
    engine = createConversationEngine()

    // Set up queues
    engine.createQueue('support_queue', {
      priority: 'fifo',
      agents: ['agent_1', 'agent_2', 'agent_3'],
    })
    engine.createQueue('supervisor_queue', {
      priority: 'priority',
      agents: ['supervisor_1'],
    })

    const conv = await engine.createConversation({
      channel: 'chat',
      participants: [{ id: 'user_123', role: 'customer' }],
    })
    conversationId = conv.id
  })

  describe('assignment', () => {
    it('should assign conversation to a queue', async () => {
      await engine.assign(conversationId, {
        to: 'support_queue',
      })

      const conv = await engine.getConversation(conversationId)
      expect(conv!.assignedQueue).toBe('support_queue')
    })

    it('should assign conversation to a specific agent', async () => {
      await engine.assign(conversationId, {
        to: 'agent_1',
        type: 'agent',
      })

      const conv = await engine.getConversation(conversationId)
      expect(conv!.assignedTo).toBe('agent_1')
    })

    it('should assign with priority', async () => {
      await engine.assign(conversationId, {
        to: 'support_queue',
        priority: 'high',
      })

      const conv = await engine.getConversation(conversationId)
      expect(conv!.priority).toBe('high')
    })

    it('should assign with required skills', async () => {
      await engine.assign(conversationId, {
        to: 'support_queue',
        skills: ['billing', 'orders'],
      })

      const conv = await engine.getConversation(conversationId)
      expect(conv!.requiredSkills).toContain('billing')
      expect(conv!.requiredSkills).toContain('orders')
    })

    it('should round-robin assign when no specific agent', async () => {
      await engine.assign(conversationId, { to: 'support_queue' })

      const conv1 = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'user_456', role: 'customer' }],
      })
      await engine.assign(conv1.id, { to: 'support_queue' })

      const assigned1 = await engine.getConversation(conversationId)
      const assigned2 = await engine.getConversation(conv1.id)

      // Different agents should be assigned
      expect(assigned1!.assignedTo).not.toBe(assigned2!.assignedTo)
    })
  })

  describe('escalation', () => {
    it('should escalate conversation to supervisor queue', async () => {
      await engine.assign(conversationId, { to: 'support_queue' })

      await engine.escalate(conversationId, {
        reason: 'timeout',
        to: 'supervisor_queue',
      })

      const conv = await engine.getConversation(conversationId)
      expect(conv!.assignedQueue).toBe('supervisor_queue')
      expect(conv!.escalation).toBeDefined()
      expect(conv!.escalation!.reason).toBe('timeout')
    })

    it('should record escalation history', async () => {
      await engine.assign(conversationId, { to: 'support_queue' })

      await engine.escalate(conversationId, {
        reason: 'customer request',
        to: 'supervisor_queue',
      })

      const conv = await engine.getConversation(conversationId)
      expect(conv!.escalationHistory).toHaveLength(1)
      expect(conv!.escalationHistory![0].reason).toBe('customer request')
    })

    it('should notify on escalation', async () => {
      const onEscalation = vi.fn()
      engine.onEscalation(onEscalation)

      await engine.assign(conversationId, { to: 'support_queue' })
      await engine.escalate(conversationId, {
        reason: 'urgent',
        to: 'supervisor_queue',
      })

      expect(onEscalation).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId,
          reason: 'urgent',
          to: 'supervisor_queue',
        })
      )
    })
  })

  describe('transfer', () => {
    it('should transfer conversation to another agent', async () => {
      await engine.assign(conversationId, {
        to: 'agent_1',
        type: 'agent',
      })

      await engine.transfer(conversationId, {
        from: 'agent_1',
        to: 'agent_2',
        reason: 'expertise needed',
      })

      const conv = await engine.getConversation(conversationId)
      expect(conv!.assignedTo).toBe('agent_2')
    })

    it('should add transfer notes', async () => {
      await engine.assign(conversationId, { to: 'agent_1', type: 'agent' })

      await engine.transfer(conversationId, {
        from: 'agent_1',
        to: 'agent_2',
        reason: 'expertise needed',
        notes: 'Customer needs help with API integration',
      })

      const conv = await engine.getConversation(conversationId)
      expect(conv!.transferHistory![0].notes).toBe('Customer needs help with API integration')
    })
  })

  describe('routing rules', () => {
    it('should auto-route based on keywords', async () => {
      engine.addRoutingRule({
        id: 'billing-rule',
        condition: (conv, msg) =>
          msg.content.toLowerCase().includes('billing') ||
          msg.content.toLowerCase().includes('invoice'),
        action: { assignTo: 'billing_queue' },
      })

      engine.createQueue('billing_queue', {
        priority: 'fifo',
        agents: ['billing_agent_1'],
      })

      await engine.addMessage(conversationId, {
        from: 'user_123',
        content: 'I have a question about my billing',
        contentType: 'text/plain',
      })

      const conv = await engine.getConversation(conversationId)
      expect(conv!.assignedQueue).toBe('billing_queue')
    })
  })
})

// =============================================================================
// Template Tests
// =============================================================================

describe('Templates', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  describe('register template', () => {
    it('should register a message template', () => {
      engine.registerTemplate({
        id: 'order_confirmation',
        name: 'Order Confirmation',
        content: 'Your order {{orderNumber}} has been confirmed!',
        contentType: 'text/plain',
        variables: ['orderNumber'],
      })

      const template = engine.getTemplate('order_confirmation')
      expect(template).toBeDefined()
      expect(template!.name).toBe('Order Confirmation')
    })

    it('should register template with multiple variables', () => {
      engine.registerTemplate({
        id: 'order_items',
        name: 'Order Items',
        content: 'Order {{orderNumber}} contains: {{items}}',
        contentType: 'text/plain',
        variables: ['orderNumber', 'items'],
      })

      const template = engine.getTemplate('order_items')
      expect(template!.variables).toContain('orderNumber')
      expect(template!.variables).toContain('items')
    })
  })

  describe('render template', () => {
    beforeEach(() => {
      engine.registerTemplate({
        id: 'order_confirmation',
        name: 'Order Confirmation',
        content: 'Your order {{orderNumber}} has been confirmed! Items: {{items}}',
        contentType: 'text/plain',
        variables: ['orderNumber', 'items'],
      })

      engine.registerTemplate({
        id: 'greeting',
        name: 'Greeting',
        content: 'Hello {{name}}! Welcome to our support.',
        contentType: 'text/plain',
        variables: ['name'],
      })
    })

    it('should render template with variables', async () => {
      const rendered = await engine.renderTemplate('order_confirmation', {
        orderNumber: '12345',
        items: 'Widget A, Widget B',
      })

      expect(rendered.content).toBe('Your order 12345 has been confirmed! Items: Widget A, Widget B')
      expect(rendered.contentType).toBe('text/plain')
    })

    it('should render template and return MessageContent', async () => {
      const rendered = await engine.renderTemplate('greeting', {
        name: 'John',
      })

      expect(rendered).toHaveProperty('content')
      expect(rendered).toHaveProperty('contentType')
    })

    it('should throw for missing required variables', async () => {
      await expect(
        engine.renderTemplate('order_confirmation', {
          orderNumber: '12345',
          // missing 'items'
        })
      ).rejects.toThrow(/missing required variable/)
    })

    it('should throw for non-existent template', async () => {
      await expect(
        engine.renderTemplate('non_existent', {})
      ).rejects.toThrow(/not found/)
    })

    it('should support HTML templates', async () => {
      engine.registerTemplate({
        id: 'html_greeting',
        name: 'HTML Greeting',
        content: '<h1>Hello {{name}}!</h1>',
        contentType: 'text/html',
        variables: ['name'],
      })

      const rendered = await engine.renderTemplate('html_greeting', { name: 'Jane' })
      expect(rendered.content).toBe('<h1>Hello Jane!</h1>')
      expect(rendered.contentType).toBe('text/html')
    })

    it('should support array variables with join', async () => {
      engine.registerTemplate({
        id: 'list_template',
        name: 'List Template',
        content: 'Items: {{items|join:", "}}',
        contentType: 'text/plain',
        variables: ['items'],
      })

      const rendered = await engine.renderTemplate('list_template', {
        items: ['Apple', 'Banana', 'Cherry'],
      })

      expect(rendered.content).toBe('Items: Apple, Banana, Cherry')
    })
  })

  describe('send templated message', () => {
    it('should send a message using a template', async () => {
      engine.registerTemplate({
        id: 'welcome',
        name: 'Welcome',
        content: 'Welcome, {{name}}!',
        contentType: 'text/plain',
        variables: ['name'],
      })

      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [
          { id: 'user_123', role: 'customer' },
          { id: 'agent_456', role: 'agent' },
        ],
      })

      const message = await engine.sendTemplatedMessage(conv.id, {
        from: 'agent_456',
        templateId: 'welcome',
        variables: { name: 'John' },
      })

      expect(message.content).toBe('Welcome, John!')
      expect(message.metadata!.templateId).toBe('welcome')
    })
  })
})

// =============================================================================
// Query Tests
// =============================================================================

describe('Query', () => {
  let engine: ConversationEngine

  beforeEach(async () => {
    engine = createConversationEngine()

    // Create test conversations
    await engine.createConversation({
      id: 'conv_1',
      channel: 'email',
      participants: [
        { id: 'user_1', role: 'customer' },
        { id: 'agent_1', role: 'agent' },
      ],
      tags: ['billing'],
      metadata: { priority: 'high' },
    })

    await engine.createConversation({
      id: 'conv_2',
      channel: 'chat',
      participants: [
        { id: 'user_2', role: 'customer' },
        { id: 'agent_2', role: 'agent' },
      ],
      tags: ['support'],
      metadata: { priority: 'low' },
    })

    await engine.createConversation({
      id: 'conv_3',
      channel: 'email',
      participants: [
        { id: 'user_3', role: 'customer' },
        { id: 'agent_1', role: 'agent' },
      ],
      tags: ['billing', 'urgent'],
      metadata: { priority: 'high' },
    })
  })

  describe('query conversations', () => {
    it('should query by status', async () => {
      const results = await engine.query({ status: 'open' })

      expect(results.conversations).toHaveLength(3)
      expect(results.total).toBe(3)
    })

    it('should query by channel', async () => {
      const results = await engine.query({ channel: ['email'] })

      expect(results.conversations).toHaveLength(2)
      expect(results.conversations.every(c => c.channel === 'email')).toBe(true)
    })

    it('should query by multiple channels', async () => {
      const results = await engine.query({ channel: ['email', 'chat'] })

      expect(results.conversations).toHaveLength(3)
    })

    it('should query by assignee', async () => {
      // Assign conversations
      await engine.assign('conv_1', { to: 'agent_1', type: 'agent' })
      await engine.assign('conv_2', { to: 'agent_2', type: 'agent' })

      const results = await engine.query({ assignee: 'agent_1' })

      expect(results.conversations).toHaveLength(1)
      expect(results.conversations[0].id).toBe('conv_1')
    })

    it('should query by tags', async () => {
      const results = await engine.query({ tags: ['billing'] })

      expect(results.conversations).toHaveLength(2)
      expect(results.conversations.every(c => c.tags!.includes('billing'))).toBe(true)
    })

    it('should query with pagination', async () => {
      const page1 = await engine.query({ status: 'open', limit: 2, offset: 0 })
      expect(page1.conversations).toHaveLength(2)
      expect(page1.hasMore).toBe(true)

      const page2 = await engine.query({ status: 'open', limit: 2, offset: 2 })
      expect(page2.conversations).toHaveLength(1)
      expect(page2.hasMore).toBe(false)
    })

    it('should query by participant', async () => {
      const results = await engine.query({ participant: 'user_1' })

      expect(results.conversations).toHaveLength(1)
      expect(results.conversations[0].id).toBe('conv_1')
    })

    it('should query by date range', async () => {
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)

      const results = await engine.query({
        createdAfter: yesterday,
        createdBefore: tomorrow,
      })

      expect(results.conversations).toHaveLength(3)
    })

    it('should combine multiple query criteria', async () => {
      const results = await engine.query({
        channel: ['email'],
        tags: ['billing'],
        status: 'open',
      })

      expect(results.conversations).toHaveLength(2)
    })

    it('should sort results by createdAt', async () => {
      const results = await engine.query({
        status: 'open',
        sortBy: 'createdAt',
        sortOrder: 'desc',
      })

      const dates = results.conversations.map(c => c.createdAt.getTime())
      expect(dates).toEqual([...dates].sort((a, b) => b - a))
    })
  })
})

// =============================================================================
// Event Emission Tests
// =============================================================================

describe('Events', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  it('should emit event on conversation created', async () => {
    const handler = vi.fn()
    engine.on('conversation:created', handler)

    const conv = await engine.createConversation({
      channel: 'chat',
      participants: [{ id: 'user_1', role: 'customer' }],
    })

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: conv.id })
    )
  })

  it('should emit event on message added', async () => {
    const handler = vi.fn()
    engine.on('message:added', handler)

    const conv = await engine.createConversation({
      channel: 'chat',
      participants: [{ id: 'user_1', role: 'customer' }],
    })

    await engine.addMessage(conv.id, {
      from: 'user_1',
      content: 'Hello',
      contentType: 'text/plain',
    })

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: conv.id,
        from: 'user_1',
      })
    )
  })

  it('should emit event on state transition', async () => {
    const handler = vi.fn()

    const engineWithStates = createConversationEngine({
      states: {
        initial: 'new',
        states: ['new', 'active'],
        transitions: [{ from: 'new', to: 'active', on: 'start' }],
      },
    })
    engineWithStates.on('state:changed', handler)

    const conv = await engineWithStates.createConversation({
      channel: 'chat',
      participants: [{ id: 'user_1', role: 'customer' }],
    })

    await engineWithStates.transition(conv.id, 'active')

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: conv.id,
        from: 'new',
        to: 'active',
      })
    )
  })

  it('should emit event on assignment', async () => {
    const handler = vi.fn()
    engine.on('conversation:assigned', handler)

    engine.createQueue('test_queue', { priority: 'fifo', agents: ['agent_1'] })

    const conv = await engine.createConversation({
      channel: 'chat',
      participants: [{ id: 'user_1', role: 'customer' }],
    })

    await engine.assign(conv.id, { to: 'test_queue' })

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: conv.id,
        assignedTo: expect.any(String),
      })
    )
  })
})
