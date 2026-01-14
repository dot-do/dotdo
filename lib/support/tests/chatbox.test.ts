/**
 * ChatBox Integration Tests (TDD)
 *
 * RED phase: Write failing tests first
 *
 * Tests the MDXUI ChatBox integration with agent-first support.
 * ChatBox routes conversations to named agents based on topic.
 *
 * @see dotdo-crtzx - TDD: MDXUI ChatBox integration
 * @module lib/support/tests/chatbox.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ChatBox,
  ChatBoxConfig,
  ChatBoxMessage,
  ChatBoxSession,
  createChatBox,
  detectTopic,
} from '../chatbox'
import type { Agent, Customer, SupportConfig, Message } from '../types'

// ============================================================================
// MOCK AGENTS
// ============================================================================

// Mock agent factory for testing
function createMockAgent(config: { id: string; name: string; specialties?: string[] }): Agent {
  return {
    id: config.id,
    name: config.name,
    specialties: config.specialties,
  }
}

// Named mock agents matching the design doc pattern
const sam = createMockAgent({ id: 'sam', name: 'Sam', specialties: ['general', 'support'] })
const finn = createMockAgent({ id: 'finn', name: 'Finn', specialties: ['billing', 'payments', 'financial'] })
const sally = createMockAgent({ id: 'sally', name: 'Sally', specialties: ['sales', 'pricing', 'enterprise'] })
const ralph = createMockAgent({ id: 'ralph', name: 'Ralph', specialties: ['technical', 'engineering', 'bugs'] })

// ============================================================================
// CHATBOX CREATION TESTS
// ============================================================================

describe('ChatBox Integration', () => {
  describe('createChatBox', () => {
    it('should create a ChatBox with default agent', () => {
      const chatbox = createChatBox({
        default: sam,
        topics: {},
        escalation: { sentiment: -0.5, loops: 3, explicit: true },
      })

      expect(chatbox).toBeDefined()
      expect(chatbox.defaultAgent).toBe(sam)
    })

    it('should accept topic-specific agent routing', () => {
      const chatbox = createChatBox({
        default: sam,
        topics: {
          billing: finn,
          sales: sally,
          technical: ralph,
        },
        escalation: { sentiment: -0.5, loops: 3, explicit: true },
      })

      expect(chatbox.topics.billing).toBe(finn)
      expect(chatbox.topics.sales).toBe(sally)
      expect(chatbox.topics.technical).toBe(ralph)
    })

    it('should expose escalation settings', () => {
      const chatbox = createChatBox({
        default: sam,
        topics: {},
        escalation: {
          sentiment: -0.7,
          loops: 5,
          explicit: true,
          value: 10000,
        },
      })

      expect(chatbox.escalation.sentiment).toBe(-0.7)
      expect(chatbox.escalation.loops).toBe(5)
      expect(chatbox.escalation.value).toBe(10000)
    })
  })

  // ============================================================================
  // SESSION MANAGEMENT TESTS
  // ============================================================================

  describe('ChatBox sessions', () => {
    let chatbox: ChatBox

    beforeEach(() => {
      chatbox = createChatBox({
        default: sam,
        topics: {
          billing: finn,
          sales: sally,
        },
        escalation: { sentiment: -0.5, loops: 3, explicit: true },
      })
    })

    it('should create a new session for a customer', () => {
      const customer: Customer = {
        id: 'cust-123',
        name: 'John Doe',
        email: 'john@example.com',
      }

      const session = chatbox.createSession(customer)

      expect(session).toBeDefined()
      expect(session.id).toBeDefined()
      expect(session.customer).toBe(customer)
      expect(session.agent).toBe(sam) // Default agent
    })

    it('should start session with default agent (sam)', () => {
      const customer: Customer = {
        id: 'cust-456',
        name: 'Jane Doe',
        email: 'jane@example.com',
      }

      const session = chatbox.createSession(customer)

      expect(session.agent.id).toBe('sam')
      expect(session.agent.name).toBe('Sam')
    })

    it('should have an empty messages array initially', () => {
      const customer: Customer = {
        id: 'cust-789',
        name: 'Bob Smith',
        email: 'bob@example.com',
      }

      const session = chatbox.createSession(customer)

      expect(session.messages).toEqual([])
    })

    it('should track session metadata', () => {
      const customer: Customer = {
        id: 'cust-100',
        name: 'Alice',
        email: 'alice@example.com',
      }

      const session = chatbox.createSession(customer, { source: 'web', page: '/pricing' })

      expect(session.metadata?.source).toBe('web')
      expect(session.metadata?.page).toBe('/pricing')
    })
  })

  // ============================================================================
  // MESSAGE HANDLING TESTS
  // ============================================================================

  describe('ChatBox message handling', () => {
    let chatbox: ChatBox
    let session: ChatBoxSession

    beforeEach(() => {
      chatbox = createChatBox({
        default: sam,
        topics: {
          billing: finn,
          sales: sally,
          technical: ralph,
        },
        escalation: { sentiment: -0.5, loops: 3, explicit: true },
      })

      const customer: Customer = {
        id: 'cust-msg-1',
        name: 'Test User',
        email: 'test@example.com',
      }
      session = chatbox.createSession(customer)
    })

    it('should add customer message to session', async () => {
      await chatbox.handleMessage(session, 'Hello, I need help')

      expect(session.messages.length).toBeGreaterThan(0)
      expect(session.messages[0].role).toBe('customer')
      expect(session.messages[0].content).toBe('Hello, I need help')
    })

    it('should generate agent response', async () => {
      await chatbox.handleMessage(session, 'What are your hours?')

      // Should have customer message + agent response
      expect(session.messages.length).toBeGreaterThanOrEqual(2)

      const agentResponse = session.messages.find(m => m.role === 'agent')
      expect(agentResponse).toBeDefined()
      expect(agentResponse!.content.length).toBeGreaterThan(0)
    })

    it('should preserve conversation history', async () => {
      await chatbox.handleMessage(session, 'First question')
      await chatbox.handleMessage(session, 'Follow-up question')

      const customerMessages = session.messages.filter(m => m.role === 'customer')
      expect(customerMessages.length).toBe(2)
    })
  })

  // ============================================================================
  // TOPIC DETECTION TESTS
  // ============================================================================

  describe('Topic detection', () => {
    it('should detect billing topic from keywords', () => {
      expect(detectTopic('I have a question about my invoice')).toBe('billing')
      expect(detectTopic('Can you help with payment?')).toBe('billing')
      expect(detectTopic('I need a refund')).toBe('billing')
      expect(detectTopic('My subscription is not working')).toBe('billing')
    })

    it('should detect sales topic from keywords', () => {
      expect(detectTopic('What are your pricing plans?')).toBe('sales')
      expect(detectTopic('I want to upgrade my plan')).toBe('sales')
      expect(detectTopic('Can I get a demo?')).toBe('sales')
      expect(detectTopic('We are interested in enterprise features')).toBe('sales')
    })

    it('should detect technical topic from keywords', () => {
      expect(detectTopic('The API is returning an error')).toBe('technical')
      expect(detectTopic('I found a bug in the dashboard')).toBe('technical')
      expect(detectTopic('How do I integrate with your SDK?')).toBe('technical')
      expect(detectTopic('Getting a 500 server error')).toBe('technical')
    })

    it('should return null for general queries', () => {
      expect(detectTopic('Hello')).toBeNull()
      expect(detectTopic('I need some help')).toBeNull()
      expect(detectTopic('Can you assist me?')).toBeNull()
    })
  })

  // ============================================================================
  // AGENT ROUTING TESTS
  // ============================================================================

  describe('Agent routing', () => {
    let chatbox: ChatBox
    let session: ChatBoxSession

    beforeEach(() => {
      chatbox = createChatBox({
        default: sam,
        topics: {
          billing: finn,
          sales: sally,
          technical: ralph,
        },
        escalation: { sentiment: -0.5, loops: 3, explicit: true },
      })

      const customer: Customer = {
        id: 'cust-route-1',
        name: 'Route Test',
        email: 'route@example.com',
      }
      session = chatbox.createSession(customer)
    })

    it('should route billing questions to finn', async () => {
      await chatbox.handleMessage(session, 'I have a question about my invoice')

      expect(session.agent.id).toBe('finn')
    })

    it('should route sales questions to sally', async () => {
      await chatbox.handleMessage(session, 'What are your pricing plans?')

      expect(session.agent.id).toBe('sally')
    })

    it('should route technical questions to ralph', async () => {
      await chatbox.handleMessage(session, 'The API is returning an error')

      expect(session.agent.id).toBe('ralph')
    })

    it('should keep sam for general questions', async () => {
      await chatbox.handleMessage(session, 'Hello, I need some help')

      expect(session.agent.id).toBe('sam')
    })

    it('should emit agent change event on routing', async () => {
      const onAgentChange = vi.fn()
      chatbox.on('agentChange', onAgentChange)

      await chatbox.handleMessage(session, 'I have a billing question')

      expect(onAgentChange).toHaveBeenCalledWith({
        session,
        previousAgent: sam,
        newAgent: finn,
        reason: 'topic:billing',
      })
    })
  })

  // ============================================================================
  // CONVERSATION CONTEXT TESTS
  // ============================================================================

  describe('Conversation context', () => {
    let chatbox: ChatBox
    let session: ChatBoxSession

    beforeEach(() => {
      chatbox = createChatBox({
        default: sam,
        topics: { billing: finn },
        escalation: { sentiment: -0.5, loops: 3, explicit: true },
      })

      const customer: Customer = {
        id: 'cust-ctx-1',
        name: 'Context Test',
        email: 'context@example.com',
      }
      session = chatbox.createSession(customer)
    })

    it('should maintain context when agent changes', async () => {
      // Start with general question
      await chatbox.handleMessage(session, 'Hello, my name is John')

      // Then ask billing question - should route to finn
      await chatbox.handleMessage(session, 'Can you help with my invoice?')

      // Finn should have access to previous context
      expect(session.messages.length).toBeGreaterThanOrEqual(4)
      expect(session.agent.id).toBe('finn')
    })

    it('should include customer metadata in context', async () => {
      const customer: Customer = {
        id: 'cust-meta-1',
        name: 'Premium User',
        email: 'premium@example.com',
        metadata: { plan: 'enterprise', value: 50000 },
      }

      const premiumSession = chatbox.createSession(customer)

      expect(premiumSession.context.customerPlan).toBe('enterprise')
      expect(premiumSession.context.customerValue).toBe(50000)
    })

    it('should track loop count for escalation', async () => {
      // Simulate a conversation loop
      await chatbox.handleMessage(session, 'This is not working')
      await chatbox.handleMessage(session, 'Still not working')
      await chatbox.handleMessage(session, 'This is still broken')

      expect(session.context.loopCount).toBeGreaterThanOrEqual(0)
    })
  })

  // ============================================================================
  // ESCALATION TESTS
  // ============================================================================

  describe('Escalation handling', () => {
    let chatbox: ChatBox
    let session: ChatBoxSession

    beforeEach(() => {
      chatbox = createChatBox({
        default: sam,
        topics: {},
        escalation: {
          sentiment: -0.5,
          loops: 3,
          explicit: true,
        },
        humanEscalation: {
          role: 'support-lead',
          sla: '4 hours',
        },
      })

      const customer: Customer = {
        id: 'cust-esc-1',
        name: 'Escalation Test',
        email: 'escalate@example.com',
      }
      session = chatbox.createSession(customer)
    })

    it('should escalate on explicit request', async () => {
      const onEscalation = vi.fn()
      chatbox.on('escalation', onEscalation)

      await chatbox.handleMessage(session, 'I want to speak to a human')

      expect(onEscalation).toHaveBeenCalledWith(expect.objectContaining({
        session,
        trigger: 'explicit',
        target: { role: 'support-lead', sla: '4 hours' },
      }))
    })

    it('should detect explicit escalation phrases', async () => {
      const phrases = [
        'I want to speak to a human',
        'Let me talk to a real person',
        'Transfer me to a manager',
        'I need to speak with support',
        'Connect me to an agent',
      ]

      for (const phrase of phrases) {
        const result = chatbox.shouldEscalate(phrase, session)
        expect(result.shouldEscalate).toBe(true)
        expect(result.reason).toBe('explicit')
      }
    })

    it('should escalate after loop threshold', async () => {
      const onEscalation = vi.fn()
      chatbox.on('escalation', onEscalation)

      // Simulate repeated unsuccessful interactions
      await chatbox.handleMessage(session, 'This is not working')
      session.context.loopCount = 3 // Manually set for test

      await chatbox.handleMessage(session, 'Still not working, same issue')

      expect(onEscalation).toHaveBeenCalledWith(expect.objectContaining({
        trigger: 'loops',
      }))
    })
  })

  // ============================================================================
  // EVENT EMITTER TESTS
  // ============================================================================

  describe('Event emitter', () => {
    it('should emit messageReceived event', async () => {
      const chatbox = createChatBox({
        default: sam,
        topics: {},
        escalation: { sentiment: -0.5, loops: 3, explicit: true },
      })

      const onMessage = vi.fn()
      chatbox.on('messageReceived', onMessage)

      const session = chatbox.createSession({
        id: 'cust-ev-1',
        name: 'Event Test',
        email: 'event@example.com',
      })

      await chatbox.handleMessage(session, 'Test message')

      expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
        session,
        message: expect.objectContaining({
          role: 'customer',
          content: 'Test message',
        }),
      }))
    })

    it('should emit messageResponse event', async () => {
      const chatbox = createChatBox({
        default: sam,
        topics: {},
        escalation: { sentiment: -0.5, loops: 3, explicit: true },
      })

      const onResponse = vi.fn()
      chatbox.on('messageResponse', onResponse)

      const session = chatbox.createSession({
        id: 'cust-ev-2',
        name: 'Event Test 2',
        email: 'event2@example.com',
      })

      await chatbox.handleMessage(session, 'Test message')

      expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({
        session,
        message: expect.objectContaining({
          role: 'agent',
        }),
      }))
    })
  })

  // ============================================================================
  // DESIGN DOC PATTERN TESTS
  // ============================================================================

  describe('Design doc pattern', () => {
    it('should match the design doc configuration pattern', () => {
      // Pattern from design doc:
      // sam`handle billing questions`
      // finn`handle financial questions`
      // sally`handle sales questions`

      const chatbox = createChatBox({
        default: sam,
        topics: {
          billing: finn,
          financial: finn,
          sales: sally,
        },
        escalation: {
          sentiment: -0.5,
          loops: 3,
          explicit: true,
        },
      })

      expect(chatbox.defaultAgent).toBe(sam)
      expect(chatbox.topics.billing).toBe(finn)
      expect(chatbox.topics.financial).toBe(finn)
      expect(chatbox.topics.sales).toBe(sally)
    })

    it('should support the agent-first support pattern', () => {
      // "Sam handles all support by default"
      const chatbox = createChatBox({
        default: sam,
        topics: {},
        escalation: { sentiment: -0.5, loops: 3, explicit: true },
      })

      const session = chatbox.createSession({
        id: 'cust-pattern-1',
        name: 'Pattern Test',
        email: 'pattern@example.com',
      })

      // Sam is the default agent
      expect(session.agent.id).toBe('sam')
      expect(session.agent.name).toBe('Sam')
    })
  })
})
