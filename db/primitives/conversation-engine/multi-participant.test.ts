/**
 * Multi-Participant Conversation Tests - TDD RED Phase
 *
 * These tests define the expected behavior for multi-participant conversations:
 * - Customer initiates conversation
 * - Agent joins conversation
 * - AI bot participates
 * - Participant handoff
 * - Concurrent participants
 * - Participant permissions
 *
 * @module db/primitives/conversation-engine/multi-participant.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ConversationEngine,
  createConversationEngine,
  type Conversation,
  type Participant,
  type ParticipantRole,
  type ParticipantOptions,
  type Message,
} from './index'

// =============================================================================
// Types for Multi-Participant Features (Expected - not yet implemented)
// =============================================================================

/**
 * Participant permission levels for conversation actions
 */
interface ParticipantPermissions {
  canSendMessages: boolean
  canAddParticipants: boolean
  canRemoveParticipants: boolean
  canCloseConversation: boolean
  canTransferConversation: boolean
  canViewHistory: boolean
  canAssign: boolean
}

/**
 * Handoff request for transferring conversation between participants
 */
interface HandoffRequest {
  fromParticipantId: string
  toParticipantId?: string
  toRole?: ParticipantRole
  reason: string
  context?: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'
}

/**
 * Handoff result after a successful transfer
 */
interface HandoffResult {
  success: boolean
  previousOwner: string
  newOwner: string
  handoffAt: Date
  reason: string
}

/**
 * Participant activity tracking
 */
interface ParticipantActivity {
  participantId: string
  lastActiveAt: Date
  isTyping: boolean
  isOnline: boolean
  messageCount: number
}

// =============================================================================
// Customer Initiates Conversation Tests
// =============================================================================

describe('Customer Initiates Conversation', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  describe('basic customer initiation', () => {
    it('should allow a customer to create a new conversation', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [
          { id: 'customer_123', role: 'customer', name: 'John Doe', email: 'john@example.com' },
        ],
      })

      expect(conv.id).toBeDefined()
      expect(conv.participants).toHaveLength(1)
      expect(conv.participants[0].role).toBe('customer')
      expect(conv.status).toBe('open')
    })

    it('should set the customer as the conversation initiator', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [
          { id: 'customer_123', role: 'customer' },
        ],
        metadata: { initiatedBy: 'customer_123' },
      })

      expect(conv.metadata.initiatedBy).toBe('customer_123')
    })

    it('should record the customer join timestamp', async () => {
      const beforeCreate = new Date()

      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [
          { id: 'customer_123', role: 'customer' },
        ],
      })

      const customer = conv.participants.find(p => p.id === 'customer_123')
      expect(customer?.joinedAt).toBeDefined()
      expect(customer?.joinedAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime())
    })

    it('should allow customer to send the first message', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [
          { id: 'customer_123', role: 'customer' },
        ],
      })

      const message = await engine.addMessage(conv.id, {
        from: 'customer_123',
        content: 'Hello, I need help with my order',
        contentType: 'text/plain',
      })

      expect(message.id).toBeDefined()
      expect(message.from).toBe('customer_123')
      expect(message.content).toBe('Hello, I need help with my order')
    })

    it('should trigger conversation:created event with customer info', async () => {
      const handler = vi.fn()
      engine.on('conversation:created', handler)

      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [
          { id: 'customer_123', role: 'customer', name: 'John Doe' },
        ],
      })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: conv.id,
          conversation: expect.objectContaining({
            participants: expect.arrayContaining([
              expect.objectContaining({ id: 'customer_123', role: 'customer' }),
            ]),
          }),
        })
      )
    })
  })

  describe('customer with multiple contact methods', () => {
    it('should support customer with email and phone', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [
          {
            id: 'customer_123',
            role: 'customer',
            name: 'John Doe',
            email: 'john@example.com',
            phone: '+1234567890',
          },
        ],
      })

      const customer = conv.participants.find(p => p.id === 'customer_123')
      expect(customer?.email).toBe('john@example.com')
      expect(customer?.phone).toBe('+1234567890')
    })

    it('should allow customer metadata for CRM integration', async () => {
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [
          {
            id: 'customer_123',
            role: 'customer',
            metadata: {
              customerId: 'crm_456',
              tier: 'premium',
              lifetimeValue: 5000,
              previousTickets: 3,
            },
          },
        ],
      })

      const customer = conv.participants.find(p => p.id === 'customer_123')
      expect(customer?.metadata?.tier).toBe('premium')
      expect(customer?.metadata?.lifetimeValue).toBe(5000)
    })
  })
})

// =============================================================================
// Agent Joins Conversation Tests
// =============================================================================

describe('Agent Joins Conversation', () => {
  let engine: ConversationEngine
  let conversationId: string

  beforeEach(async () => {
    engine = createConversationEngine()
    const conv = await engine.createConversation({
      channel: 'chat',
      participants: [
        { id: 'customer_123', role: 'customer', name: 'John Doe' },
      ],
    })
    conversationId = conv.id
  })

  describe('agent addition', () => {
    it('should allow an agent to join an existing conversation', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
        name: 'Agent Smith',
        email: 'smith@support.com',
      })

      const conv = await engine.getConversation(conversationId)
      expect(conv?.participants).toHaveLength(2)

      const agent = conv?.participants.find(p => p.id === 'agent_456')
      expect(agent).toBeDefined()
      expect(agent?.role).toBe('agent')
    })

    it('should record agent join timestamp', async () => {
      const beforeJoin = new Date()

      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
      })

      const conv = await engine.getConversation(conversationId)
      const agent = conv?.participants.find(p => p.id === 'agent_456')

      expect(agent?.joinedAt.getTime()).toBeGreaterThanOrEqual(beforeJoin.getTime())
    })

    it('should trigger participant:added event when agent joins', async () => {
      const handler = vi.fn()
      engine.on('participant:added', handler)

      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
      })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId,
          participantId: 'agent_456',
        })
      )
    })

    it('should allow agent to send messages after joining', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
      })

      const message = await engine.addMessage(conversationId, {
        from: 'agent_456',
        content: 'Hi John, how can I help you today?',
        contentType: 'text/plain',
      })

      expect(message.from).toBe('agent_456')
    })
  })

  describe('agent metadata and skills', () => {
    it('should support agent with skills metadata', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
        metadata: {
          skills: ['billing', 'technical', 'orders'],
          department: 'support',
          shiftEnd: '17:00',
        },
      })

      const conv = await engine.getConversation(conversationId)
      const agent = conv?.participants.find(p => p.id === 'agent_456')

      expect(agent?.metadata?.skills).toContain('billing')
      expect(agent?.metadata?.department).toBe('support')
    })

    it('should support agent availability status', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
        metadata: {
          status: 'available',
          maxConcurrent: 5,
          currentLoad: 2,
        },
      })

      const conv = await engine.getConversation(conversationId)
      const agent = conv?.participants.find(p => p.id === 'agent_456')

      expect(agent?.metadata?.status).toBe('available')
    })
  })

  describe('multiple agents', () => {
    it('should allow multiple agents to join the same conversation', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
        name: 'Agent Smith',
      })

      await engine.addParticipant(conversationId, {
        id: 'agent_789',
        role: 'agent',
        name: 'Agent Jones',
      })

      const conv = await engine.getConversation(conversationId)
      const agents = conv?.participants.filter(p => p.role === 'agent')

      expect(agents).toHaveLength(2)
    })

    it('should allow both agents to send messages', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
      })
      await engine.addParticipant(conversationId, {
        id: 'agent_789',
        role: 'agent',
      })

      await engine.addMessage(conversationId, {
        from: 'agent_456',
        content: 'Let me check that for you',
        contentType: 'text/plain',
      })

      await engine.addMessage(conversationId, {
        from: 'agent_789',
        content: 'I can help with the billing part',
        contentType: 'text/plain',
      })

      const messages = await engine.getMessages(conversationId)
      expect(messages).toHaveLength(2)
    })
  })
})

// =============================================================================
// AI Bot Participates Tests
// =============================================================================

describe('AI Bot Participates', () => {
  let engine: ConversationEngine
  let conversationId: string

  beforeEach(async () => {
    engine = createConversationEngine()
    const conv = await engine.createConversation({
      channel: 'chat',
      participants: [
        { id: 'customer_123', role: 'customer' },
      ],
    })
    conversationId = conv.id
  })

  describe('AI participant addition', () => {
    it('should allow an AI bot to join the conversation', async () => {
      await engine.addParticipant(conversationId, {
        id: 'ai_bot_1',
        role: 'ai',
        name: 'Support Bot',
        metadata: {
          model: 'gpt-4',
          version: '1.0',
          capabilities: ['faq', 'order-lookup', 'basic-support'],
        },
      })

      const conv = await engine.getConversation(conversationId)
      const aiBot = conv?.participants.find(p => p.id === 'ai_bot_1')

      expect(aiBot).toBeDefined()
      expect(aiBot?.role).toBe('ai')
      expect(aiBot?.metadata?.model).toBe('gpt-4')
    })

    it('should allow AI to send messages', async () => {
      await engine.addParticipant(conversationId, {
        id: 'ai_bot_1',
        role: 'ai',
        name: 'Support Bot',
      })

      const message = await engine.addMessage(conversationId, {
        from: 'ai_bot_1',
        content: 'Hello! I\'m an AI assistant. How can I help you today?',
        contentType: 'text/plain',
        metadata: {
          aiGenerated: true,
          confidence: 0.95,
        },
      })

      expect(message.from).toBe('ai_bot_1')
      expect(message.metadata?.aiGenerated).toBe(true)
    })

    it('should mark AI messages with appropriate metadata', async () => {
      await engine.addParticipant(conversationId, {
        id: 'ai_bot_1',
        role: 'ai',
      })

      const message = await engine.addMessage(conversationId, {
        from: 'ai_bot_1',
        content: 'Based on your order history, I can see...',
        contentType: 'text/plain',
        metadata: {
          aiGenerated: true,
          modelId: 'gpt-4-turbo',
          tokensUsed: 150,
          responseTime: 1.2,
        },
      })

      expect(message.metadata?.aiGenerated).toBe(true)
      expect(message.metadata?.modelId).toBe('gpt-4-turbo')
    })
  })

  describe('AI alongside human agents', () => {
    it('should support AI and human agent in same conversation', async () => {
      await engine.addParticipant(conversationId, {
        id: 'ai_bot_1',
        role: 'ai',
        name: 'Support Bot',
      })

      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
        name: 'Human Agent',
      })

      const conv = await engine.getConversation(conversationId)
      expect(conv?.participants).toHaveLength(3) // customer + AI + agent

      const roles = conv?.participants.map(p => p.role)
      expect(roles).toContain('customer')
      expect(roles).toContain('ai')
      expect(roles).toContain('agent')
    })

    it('should allow AI to assist agent with suggestions', async () => {
      await engine.addParticipant(conversationId, {
        id: 'ai_bot_1',
        role: 'ai',
      })
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
      })

      // AI provides internal suggestion (visible to agent only)
      const aiMessage = await engine.addMessage(conversationId, {
        from: 'ai_bot_1',
        content: 'Suggested response: Based on the order status, you could tell the customer...',
        contentType: 'text/plain',
        metadata: {
          aiGenerated: true,
          isInternal: true,
          visibleTo: ['agent_456'],
          suggestion: true,
        },
      })

      expect(aiMessage.metadata?.isInternal).toBe(true)
      expect(aiMessage.metadata?.visibleTo).toContain('agent_456')
    })
  })

  describe('multiple AI bots', () => {
    it('should support multiple AI bots with different capabilities', async () => {
      await engine.addParticipant(conversationId, {
        id: 'ai_triage',
        role: 'ai',
        name: 'Triage Bot',
        metadata: { capabilities: ['classification', 'routing'] },
      })

      await engine.addParticipant(conversationId, {
        id: 'ai_specialist',
        role: 'ai',
        name: 'Technical Specialist Bot',
        metadata: { capabilities: ['technical-support', 'troubleshooting'] },
      })

      const conv = await engine.getConversation(conversationId)
      const aiBots = conv?.participants.filter(p => p.role === 'ai')

      expect(aiBots).toHaveLength(2)
    })
  })
})

// =============================================================================
// Participant Handoff Tests
// =============================================================================

describe('Participant Handoff', () => {
  let engine: ConversationEngine
  let conversationId: string

  beforeEach(async () => {
    engine = createConversationEngine()
    const conv = await engine.createConversation({
      channel: 'chat',
      participants: [
        { id: 'customer_123', role: 'customer' },
        { id: 'ai_bot_1', role: 'ai', name: 'Support Bot' },
      ],
    })
    conversationId = conv.id

    // Add some initial messages
    await engine.addMessage(conv.id, {
      from: 'customer_123',
      content: 'I need help with a complex billing issue',
      contentType: 'text/plain',
    })

    await engine.addMessage(conv.id, {
      from: 'ai_bot_1',
      content: 'I understand. Let me connect you with a human agent who can help better.',
      contentType: 'text/plain',
    })
  })

  describe('AI to human handoff', () => {
    it('should transfer conversation from AI to human agent', async () => {
      // Add human agent
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
        name: 'Human Agent',
      })

      // Transfer/handoff
      await engine.transfer(conversationId, {
        from: 'ai_bot_1',
        to: 'agent_456',
        reason: 'Complex billing issue requires human assistance',
      })

      const conv = await engine.getConversation(conversationId)
      expect(conv?.assignedTo).toBe('agent_456')
      expect(conv?.transferHistory).toHaveLength(1)
      expect(conv?.transferHistory?.[0].reason).toContain('billing issue')
    })

    it('should preserve conversation context during handoff', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
      })

      await engine.transfer(conversationId, {
        from: 'ai_bot_1',
        to: 'agent_456',
        reason: 'Handoff to human',
        notes: 'Customer has a billing dispute about order #12345. AI attempted to resolve but requires human judgment.',
      })

      const conv = await engine.getConversation(conversationId)
      expect(conv?.transferHistory?.[0].notes).toContain('billing dispute')
      expect(conv?.transferHistory?.[0].notes).toContain('#12345')
    })

    it('should allow AI to remain in conversation after handoff as assistant', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
      })

      await engine.transfer(conversationId, {
        from: 'ai_bot_1',
        to: 'agent_456',
        reason: 'Human assistance needed',
      })

      // AI should still be a participant
      const conv = await engine.getConversation(conversationId)
      const aiBot = conv?.participants.find(p => p.id === 'ai_bot_1')
      expect(aiBot).toBeDefined()

      // AI can still send messages (as assistant)
      const aiMessage = await engine.addMessage(conversationId, {
        from: 'ai_bot_1',
        content: 'Here is the relevant order history...',
        contentType: 'text/plain',
        metadata: { assistantMode: true },
      })

      expect(aiMessage.from).toBe('ai_bot_1')
    })
  })

  describe('agent to agent handoff', () => {
    it('should transfer conversation between human agents', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
        name: 'Tier 1 Agent',
      })

      await engine.transfer(conversationId, {
        from: 'ai_bot_1',
        to: 'agent_456',
        reason: 'Initial handoff',
      })

      // Now transfer from tier 1 to tier 2
      await engine.addParticipant(conversationId, {
        id: 'agent_789',
        role: 'agent',
        name: 'Tier 2 Specialist',
        metadata: { tier: 2, specialization: 'billing' },
      })

      await engine.transfer(conversationId, {
        from: 'agent_456',
        to: 'agent_789',
        reason: 'Escalation to billing specialist',
      })

      const conv = await engine.getConversation(conversationId)
      expect(conv?.assignedTo).toBe('agent_789')
      expect(conv?.transferHistory).toHaveLength(2)
    })

    it('should notify relevant parties on handoff', async () => {
      const handler = vi.fn()
      engine.on('conversation:assigned', handler)

      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
      })

      await engine.assign(conversationId, {
        to: 'agent_456',
        type: 'agent',
      })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId,
          assignedTo: 'agent_456',
        })
      )
    })
  })

  describe('customer-initiated handoff request', () => {
    it('should allow customer to request a different agent', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
      })

      // Customer requests escalation
      const requestMessage = await engine.addMessage(conversationId, {
        from: 'customer_123',
        content: 'I would like to speak with a supervisor please',
        contentType: 'text/plain',
        metadata: {
          handoffRequest: true,
          requestedRole: 'supervisor',
        },
      })

      expect(requestMessage.metadata?.handoffRequest).toBe(true)
    })
  })
})

// =============================================================================
// Concurrent Participants Tests
// =============================================================================

describe('Concurrent Participants', () => {
  let engine: ConversationEngine
  let conversationId: string

  beforeEach(async () => {
    engine = createConversationEngine()
    const conv = await engine.createConversation({
      channel: 'chat',
      participants: [
        { id: 'customer_123', role: 'customer', name: 'John Doe' },
      ],
    })
    conversationId = conv.id
  })

  describe('multiple concurrent participants', () => {
    it('should support customer, agent, and AI all participating concurrently', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
        name: 'Agent Smith',
      })

      await engine.addParticipant(conversationId, {
        id: 'ai_bot_1',
        role: 'ai',
        name: 'Support Bot',
      })

      const conv = await engine.getConversation(conversationId)
      expect(conv?.participants).toHaveLength(3)

      // All can send messages
      await engine.addMessage(conversationId, {
        from: 'customer_123',
        content: 'Question from customer',
        contentType: 'text/plain',
      })

      await engine.addMessage(conversationId, {
        from: 'ai_bot_1',
        content: 'AI providing context',
        contentType: 'text/plain',
      })

      await engine.addMessage(conversationId, {
        from: 'agent_456',
        content: 'Agent responding',
        contentType: 'text/plain',
      })

      const messages = await engine.getMessages(conversationId)
      expect(messages).toHaveLength(3)

      const senders = messages.map(m => m.from)
      expect(senders).toContain('customer_123')
      expect(senders).toContain('ai_bot_1')
      expect(senders).toContain('agent_456')
    })

    it('should handle high volume of concurrent participants', async () => {
      // Add multiple agents
      for (let i = 1; i <= 5; i++) {
        await engine.addParticipant(conversationId, {
          id: `agent_${i}`,
          role: 'agent',
          name: `Agent ${i}`,
        })
      }

      // Add multiple AI bots
      for (let i = 1; i <= 3; i++) {
        await engine.addParticipant(conversationId, {
          id: `ai_bot_${i}`,
          role: 'ai',
          name: `Bot ${i}`,
        })
      }

      const conv = await engine.getConversation(conversationId)
      // 1 customer + 5 agents + 3 AI bots = 9
      expect(conv?.participants).toHaveLength(9)
    })

    it('should maintain message ordering with concurrent senders', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
      })
      await engine.addParticipant(conversationId, {
        id: 'ai_bot_1',
        role: 'ai',
      })

      // Simulate rapid concurrent messages
      const messagePromises = [
        engine.addMessage(conversationId, {
          from: 'customer_123',
          content: 'Message 1',
          contentType: 'text/plain',
        }),
        engine.addMessage(conversationId, {
          from: 'agent_456',
          content: 'Message 2',
          contentType: 'text/plain',
        }),
        engine.addMessage(conversationId, {
          from: 'ai_bot_1',
          content: 'Message 3',
          contentType: 'text/plain',
        }),
      ]

      await Promise.all(messagePromises)

      const messages = await engine.getMessages(conversationId)
      expect(messages).toHaveLength(3)

      // All messages should have timestamps
      for (const msg of messages) {
        expect(msg.createdAt).toBeInstanceOf(Date)
      }
    })
  })

  describe('participant activity tracking', () => {
    it('should track which participants are active', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
      })

      // Send message - should update activity
      await engine.addMessage(conversationId, {
        from: 'agent_456',
        content: 'Hello',
        contentType: 'text/plain',
      })

      const conv = await engine.getConversation(conversationId)
      // Note: This tests an expected feature - activity tracking per participant
      // The implementation would track lastActiveAt for each participant
      expect(conv?.updatedAt).toBeDefined()
    })

    it('should allow querying participants by activity', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
      })
      await engine.addParticipant(conversationId, {
        id: 'ai_bot_1',
        role: 'ai',
      })

      // Only agent sends message
      await engine.addMessage(conversationId, {
        from: 'agent_456',
        content: 'Active message',
        contentType: 'text/plain',
      })

      const conv = await engine.getConversation(conversationId)
      // All participants should still be listed
      expect(conv?.participants).toHaveLength(3)
    })
  })

  describe('participant departure', () => {
    it('should handle participant leaving mid-conversation', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
      })
      await engine.addParticipant(conversationId, {
        id: 'agent_789',
        role: 'agent',
      })

      // First agent leaves
      await engine.removeParticipant(conversationId, 'agent_456')

      const conv = await engine.getConversation(conversationId)
      expect(conv?.participants).toHaveLength(2) // customer + agent_789
      expect(conv?.participants.some(p => p.id === 'agent_456')).toBe(false)
    })

    it('should not allow removing the only customer', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
      })

      await expect(
        engine.removeParticipant(conversationId, 'customer_123')
      ).rejects.toThrow(/cannot remove last customer/)
    })

    it('should allow conversation to continue with remaining participants', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_456',
        role: 'agent',
      })
      await engine.addParticipant(conversationId, {
        id: 'ai_bot_1',
        role: 'ai',
      })

      await engine.removeParticipant(conversationId, 'ai_bot_1')

      // Remaining participants can still communicate
      const message = await engine.addMessage(conversationId, {
        from: 'agent_456',
        content: 'Still here to help',
        contentType: 'text/plain',
      })

      expect(message.from).toBe('agent_456')
    })
  })
})

// =============================================================================
// Participant Permissions Tests
// =============================================================================

describe('Participant Permissions', () => {
  let engine: ConversationEngine
  let conversationId: string

  beforeEach(async () => {
    engine = createConversationEngine()
    const conv = await engine.createConversation({
      channel: 'chat',
      participants: [
        { id: 'customer_123', role: 'customer' },
      ],
    })
    conversationId = conv.id

    await engine.addParticipant(conversationId, {
      id: 'agent_456',
      role: 'agent',
    })

    await engine.addParticipant(conversationId, {
      id: 'ai_bot_1',
      role: 'ai',
    })
  })

  describe('role-based permissions', () => {
    it('should allow customers to send messages', async () => {
      const message = await engine.addMessage(conversationId, {
        from: 'customer_123',
        content: 'Customer message',
        contentType: 'text/plain',
      })

      expect(message.from).toBe('customer_123')
    })

    it('should allow agents to send messages', async () => {
      const message = await engine.addMessage(conversationId, {
        from: 'agent_456',
        content: 'Agent message',
        contentType: 'text/plain',
      })

      expect(message.from).toBe('agent_456')
    })

    it('should allow AI to send messages', async () => {
      const message = await engine.addMessage(conversationId, {
        from: 'ai_bot_1',
        content: 'AI message',
        contentType: 'text/plain',
      })

      expect(message.from).toBe('ai_bot_1')
    })

    it('should reject messages from non-participants', async () => {
      await expect(
        engine.addMessage(conversationId, {
          from: 'unknown_user',
          content: 'Unauthorized message',
          contentType: 'text/plain',
        })
      ).rejects.toThrow(/not a participant/)
    })
  })

  describe('message visibility permissions', () => {
    it('should support internal messages visible only to agents', async () => {
      const internalMessage = await engine.addMessage(conversationId, {
        from: 'agent_456',
        content: 'Internal note: Customer seems frustrated',
        contentType: 'text/plain',
        metadata: {
          isInternal: true,
          visibleTo: ['agent'],
        },
      })

      expect(internalMessage.metadata?.isInternal).toBe(true)
      expect(internalMessage.metadata?.visibleTo).toContain('agent')
    })

    it('should support AI suggestions visible only to agents', async () => {
      const suggestion = await engine.addMessage(conversationId, {
        from: 'ai_bot_1',
        content: 'Suggested response: Consider offering a 10% discount',
        contentType: 'text/plain',
        metadata: {
          aiGenerated: true,
          isInternal: true,
          visibleTo: ['agent'],
          suggestion: true,
        },
      })

      expect(suggestion.metadata?.suggestion).toBe(true)
      expect(suggestion.metadata?.isInternal).toBe(true)
    })
  })

  describe('conversation control permissions', () => {
    it('should allow agents to close conversations', async () => {
      const closed = await engine.closeConversation(conversationId, {
        reason: 'Resolved by agent',
      })

      expect(closed.status).toBe('closed')
    })

    it('should record who closed the conversation', async () => {
      // Close with metadata indicating who closed
      const conv = await engine.getConversation(conversationId)
      await engine.updateConversation(conversationId, {
        metadata: { ...conv!.metadata, closedBy: 'agent_456' },
      })

      const closed = await engine.closeConversation(conversationId, {
        reason: 'Issue resolved',
      })

      expect(closed.closeReason).toBe('Issue resolved')
    })

    it('should allow agents to transfer conversations', async () => {
      await engine.addParticipant(conversationId, {
        id: 'agent_789',
        role: 'agent',
      })

      await engine.transfer(conversationId, {
        from: 'agent_456',
        to: 'agent_789',
        reason: 'Shift change',
      })

      const conv = await engine.getConversation(conversationId)
      expect(conv?.assignedTo).toBe('agent_789')
    })
  })

  describe('system participant', () => {
    it('should support system participant for automated messages', async () => {
      await engine.addParticipant(conversationId, {
        id: 'system',
        role: 'system',
        name: 'System',
      })

      const systemMessage = await engine.addMessage(conversationId, {
        from: 'system',
        content: 'Agent Smith has joined the conversation',
        contentType: 'text/plain',
        metadata: {
          systemEvent: true,
          eventType: 'participant_joined',
        },
      })

      expect(systemMessage.metadata?.systemEvent).toBe(true)
    })

    it('should allow system to add participants', async () => {
      await engine.addParticipant(conversationId, {
        id: 'system',
        role: 'system',
      })

      await engine.addParticipant(conversationId, {
        id: 'agent_999',
        role: 'agent',
        metadata: { addedBy: 'system', reason: 'auto-routing' },
      })

      const conv = await engine.getConversation(conversationId)
      const newAgent = conv?.participants.find(p => p.id === 'agent_999')
      expect(newAgent?.metadata?.addedBy).toBe('system')
    })
  })

  describe('participant attribute updates', () => {
    it('should allow updating participant metadata', async () => {
      await engine.updateParticipant(conversationId, 'agent_456', {
        metadata: { status: 'away', reason: 'break' },
      })

      const conv = await engine.getConversation(conversationId)
      const agent = conv?.participants.find(p => p.id === 'agent_456')
      expect(agent?.metadata?.status).toBe('away')
    })

    it('should allow updating participant name', async () => {
      await engine.updateParticipant(conversationId, 'customer_123', {
        name: 'John Smith',
      })

      const conv = await engine.getConversation(conversationId)
      const customer = conv?.participants.find(p => p.id === 'customer_123')
      expect(customer?.name).toBe('John Smith')
    })
  })
})

// =============================================================================
// Complex Multi-Participant Scenarios Tests
// =============================================================================

describe('Complex Multi-Participant Scenarios', () => {
  let engine: ConversationEngine

  beforeEach(() => {
    engine = createConversationEngine()
  })

  describe('full conversation lifecycle with multiple participants', () => {
    it('should handle complete conversation from start to resolution', async () => {
      // 1. Customer initiates
      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [
          { id: 'customer_123', role: 'customer', name: 'John Doe' },
        ],
        subject: 'Order Issue',
      })

      // 2. Customer sends initial message
      await engine.addMessage(conv.id, {
        from: 'customer_123',
        content: 'My order #12345 hasn\'t arrived yet',
        contentType: 'text/plain',
      })

      // 3. AI bot joins and provides initial response
      await engine.addParticipant(conv.id, {
        id: 'ai_bot_1',
        role: 'ai',
        name: 'Support Bot',
      })

      await engine.addMessage(conv.id, {
        from: 'ai_bot_1',
        content: 'I can see your order #12345 was shipped on Monday. Let me check the tracking...',
        contentType: 'text/plain',
      })

      // 4. Customer asks for human
      await engine.addMessage(conv.id, {
        from: 'customer_123',
        content: 'I\'d like to speak with a real person please',
        contentType: 'text/plain',
      })

      // 5. Human agent joins
      await engine.addParticipant(conv.id, {
        id: 'agent_456',
        role: 'agent',
        name: 'Agent Smith',
      })

      await engine.transfer(conv.id, {
        from: 'ai_bot_1',
        to: 'agent_456',
        reason: 'Customer requested human agent',
        notes: 'Customer inquiring about order #12345 shipping status',
      })

      // 6. Agent responds
      await engine.addMessage(conv.id, {
        from: 'agent_456',
        content: 'Hi John, I\'m Agent Smith. I\'ve looked into your order and I can see it\'s at your local depot.',
        contentType: 'text/plain',
      })

      // 7. Resolution
      await engine.addMessage(conv.id, {
        from: 'customer_123',
        content: 'Great, thanks for the help!',
        contentType: 'text/plain',
      })

      // 8. Close conversation
      await engine.closeConversation(conv.id, {
        reason: 'Resolved - customer informed of order status',
      })

      // Verify final state
      const finalConv = await engine.getConversation(conv.id)
      expect(finalConv?.status).toBe('closed')
      expect(finalConv?.participants).toHaveLength(3)
      expect(finalConv?.transferHistory).toHaveLength(1)

      const messages = await engine.getMessages(conv.id)
      expect(messages.length).toBeGreaterThanOrEqual(4)
    })

    it('should handle escalation through multiple tiers', async () => {
      // Setup queues
      engine.createQueue('tier1_queue', { priority: 'fifo', agents: ['tier1_agent'] })
      engine.createQueue('tier2_queue', { priority: 'fifo', agents: ['tier2_agent'] })
      engine.createQueue('supervisor_queue', { priority: 'priority', agents: ['supervisor'] })

      const conv = await engine.createConversation({
        channel: 'chat',
        participants: [
          { id: 'customer_123', role: 'customer' },
        ],
      })

      // Tier 1 assignment
      await engine.addParticipant(conv.id, { id: 'tier1_agent', role: 'agent' })
      await engine.assign(conv.id, { to: 'tier1_queue' })

      // Escalate to Tier 2
      await engine.addParticipant(conv.id, { id: 'tier2_agent', role: 'agent' })
      await engine.escalate(conv.id, {
        reason: 'Technical issue beyond Tier 1 scope',
        to: 'tier2_queue',
      })

      // Escalate to Supervisor
      await engine.addParticipant(conv.id, { id: 'supervisor', role: 'agent' })
      await engine.escalate(conv.id, {
        reason: 'Customer complaint - needs supervisor review',
        to: 'supervisor_queue',
      })

      const finalConv = await engine.getConversation(conv.id)
      expect(finalConv?.escalationHistory).toHaveLength(2)
      expect(finalConv?.assignedQueue).toBe('supervisor_queue')
    })
  })

  describe('concurrent multi-customer scenario', () => {
    it('should handle multiple conversations with shared agents', async () => {
      // Create two conversations with different customers
      const conv1 = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'customer_1', role: 'customer' }],
      })

      const conv2 = await engine.createConversation({
        channel: 'chat',
        participants: [{ id: 'customer_2', role: 'customer' }],
      })

      // Same agent handles both
      await engine.addParticipant(conv1.id, { id: 'agent_shared', role: 'agent' })
      await engine.addParticipant(conv2.id, { id: 'agent_shared', role: 'agent' })

      // Agent can message in both conversations
      await engine.addMessage(conv1.id, {
        from: 'agent_shared',
        content: 'Hello customer 1',
        contentType: 'text/plain',
      })

      await engine.addMessage(conv2.id, {
        from: 'agent_shared',
        content: 'Hello customer 2',
        contentType: 'text/plain',
      })

      const messages1 = await engine.getMessages(conv1.id)
      const messages2 = await engine.getMessages(conv2.id)

      expect(messages1[0].content).toBe('Hello customer 1')
      expect(messages2[0].content).toBe('Hello customer 2')
    })
  })
})
