import { describe, it, expect, vi } from 'vitest'
import type { Agent, Conversation, SupportConfig, Message, Customer } from '../types'
import { createRouter, type TopicDetector, type RouterResult } from '../routing'

// ============================================================================
// TEST FIXTURES
// ============================================================================

const sam: Agent = { id: 'sam', name: 'Sam', specialties: ['general'] }
const finn: Agent = { id: 'finn', name: 'Finn', specialties: ['billing', 'payments'] }
const ralph: Agent = { id: 'ralph', name: 'Ralph', specialties: ['technical', 'engineering'] }
const sally: Agent = { id: 'sally', name: 'Sally', specialties: ['sales', 'pricing'] }

const defaultConfig: SupportConfig = {
  default: sam,
  topics: {
    billing: finn,
    technical: ralph,
    sales: sally,
  },
  escalation: {
    sentiment: -0.5,
    loops: 3,
    explicit: true,
  },
}

const customer: Customer = {
  id: 'cust-123',
  name: 'John Doe',
  email: 'john@example.com',
}

function createConversation(messages: Partial<Message>[]): Conversation {
  return {
    id: 'conv-123',
    messages: messages.map((m) => ({
      role: m.role ?? 'customer',
      content: m.content ?? '',
      timestamp: m.timestamp ?? new Date(),
    })),
    customer,
    agent: sam,
    startedAt: new Date(),
  }
}

// ============================================================================
// TOPIC-BASED ROUTING TESTS
// ============================================================================

describe('Topic-Based Routing', () => {
  describe('createRouter', () => {
    it('should create a router from SupportConfig', () => {
      const router = createRouter(defaultConfig)
      expect(router).toBeDefined()
      expect(typeof router.route).toBe('function')
    })
  })

  describe('Default Routing', () => {
    it('should route to default agent when no topic is detected', async () => {
      const router = createRouter(defaultConfig)
      const conversation = createConversation([
        { role: 'customer', content: 'Hello, I need some help' },
      ])

      const result = await router.route(conversation)

      expect(result.agent).toBe(sam)
      expect(result.topic).toBeNull()
      expect(result.confidence).toBe(0)
    })

    it('should route to default agent for empty conversations', async () => {
      const router = createRouter(defaultConfig)
      const conversation = createConversation([])

      const result = await router.route(conversation)

      expect(result.agent).toBe(sam)
    })
  })

  describe('Keyword-Based Topic Detection', () => {
    it('should route billing keywords to billing agent', async () => {
      const router = createRouter(defaultConfig)
      const conversation = createConversation([
        { role: 'customer', content: 'I have a question about my invoice' },
      ])

      const result = await router.route(conversation)

      expect(result.agent).toBe(finn)
      expect(result.topic).toBe('billing')
    })

    it('should route technical keywords to technical agent', async () => {
      const router = createRouter(defaultConfig)
      const conversation = createConversation([
        { role: 'customer', content: 'My API is returning 500 errors' },
      ])

      const result = await router.route(conversation)

      expect(result.agent).toBe(ralph)
      expect(result.topic).toBe('technical')
    })

    it('should route sales keywords to sales agent', async () => {
      const router = createRouter(defaultConfig)
      const conversation = createConversation([
        { role: 'customer', content: 'I want to upgrade my subscription plan' },
      ])

      const result = await router.route(conversation)

      expect(result.agent).toBe(sally)
      expect(result.topic).toBe('sales')
    })

    it('should detect topic from multiple messages', async () => {
      const router = createRouter(defaultConfig)
      const conversation = createConversation([
        { role: 'customer', content: 'Hello' },
        { role: 'agent', content: 'Hi! How can I help?' },
        { role: 'customer', content: 'I need help with my payment' },
      ])

      const result = await router.route(conversation)

      expect(result.agent).toBe(finn)
      expect(result.topic).toBe('billing')
    })

    it('should give higher weight to more recent messages', async () => {
      const router = createRouter(defaultConfig)
      // Early message mentions billing, but recent messages are about technical issues
      const conversation = createConversation([
        { role: 'customer', content: 'I had a billing issue earlier' },
        { role: 'agent', content: 'How can I help?' },
        { role: 'customer', content: 'But now my API is broken' },
        { role: 'customer', content: 'Getting lots of errors in production' },
      ])

      const result = await router.route(conversation)

      expect(result.agent).toBe(ralph)
      expect(result.topic).toBe('technical')
    })
  })

  describe('Custom Topic Detector', () => {
    it('should use custom topic detector when provided', async () => {
      const customDetector: TopicDetector = vi.fn().mockResolvedValue({
        topic: 'billing',
        confidence: 0.95,
      })

      const router = createRouter(defaultConfig, { detector: customDetector })
      const conversation = createConversation([
        { role: 'customer', content: 'Any message' },
      ])

      const result = await router.route(conversation)

      expect(customDetector).toHaveBeenCalledWith(conversation)
      expect(result.agent).toBe(finn)
      expect(result.topic).toBe('billing')
      expect(result.confidence).toBe(0.95)
    })

    it('should fall back to default when custom detector returns unknown topic', async () => {
      const customDetector: TopicDetector = vi.fn().mockResolvedValue({
        topic: 'unknown-topic',
        confidence: 0.8,
      })

      const router = createRouter(defaultConfig, { detector: customDetector })
      const conversation = createConversation([
        { role: 'customer', content: 'Any message' },
      ])

      const result = await router.route(conversation)

      expect(result.agent).toBe(sam)
      expect(result.topic).toBe('unknown-topic')
    })

    it('should fall back to default when custom detector returns null topic', async () => {
      const customDetector: TopicDetector = vi.fn().mockResolvedValue({
        topic: null,
        confidence: 0,
      })

      const router = createRouter(defaultConfig, { detector: customDetector })
      const conversation = createConversation([
        { role: 'customer', content: 'Any message' },
      ])

      const result = await router.route(conversation)

      expect(result.agent).toBe(sam)
      expect(result.topic).toBeNull()
    })
  })

  describe('Confidence Threshold', () => {
    it('should route to topic agent when confidence meets threshold', async () => {
      const customDetector: TopicDetector = vi.fn().mockResolvedValue({
        topic: 'billing',
        confidence: 0.7,
      })

      const router = createRouter(defaultConfig, {
        detector: customDetector,
        confidenceThreshold: 0.5,
      })

      const conversation = createConversation([
        { role: 'customer', content: 'Any message' },
      ])

      const result = await router.route(conversation)

      expect(result.agent).toBe(finn)
    })

    it('should route to default agent when confidence is below threshold', async () => {
      const customDetector: TopicDetector = vi.fn().mockResolvedValue({
        topic: 'billing',
        confidence: 0.3,
      })

      const router = createRouter(defaultConfig, {
        detector: customDetector,
        confidenceThreshold: 0.5,
      })

      const conversation = createConversation([
        { role: 'customer', content: 'Any message' },
      ])

      const result = await router.route(conversation)

      expect(result.agent).toBe(sam)
      expect(result.topic).toBe('billing') // Topic still reported
      expect(result.confidence).toBe(0.3)
      expect(result.belowThreshold).toBe(true)
    })
  })

  describe('RouterResult Metadata', () => {
    it('should include confidence score in result', async () => {
      const router = createRouter(defaultConfig)
      const conversation = createConversation([
        { role: 'customer', content: 'I need help with my invoice payment' },
      ])

      const result = await router.route(conversation)

      expect(typeof result.confidence).toBe('number')
      expect(result.confidence).toBeGreaterThanOrEqual(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
    })

    it('should include detected topic in result', async () => {
      const router = createRouter(defaultConfig)
      const conversation = createConversation([
        { role: 'customer', content: 'API error in my application' },
      ])

      const result = await router.route(conversation)

      expect(result.topic).toBe('technical')
    })

    it('should include routing reason in result', async () => {
      const router = createRouter(defaultConfig)
      const conversation = createConversation([
        { role: 'customer', content: 'I want to talk about upgrading' },
      ])

      const result = await router.route(conversation)

      expect(result.reason).toBeDefined()
      expect(typeof result.reason).toBe('string')
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined topics in config gracefully', async () => {
      const configWithUndefined: SupportConfig = {
        default: sam,
        topics: {
          billing: finn,
          technical: undefined, // Explicitly undefined
        },
        escalation: {
          sentiment: -0.5,
          loops: 3,
          explicit: true,
        },
      }

      const router = createRouter(configWithUndefined)
      const conversation = createConversation([
        { role: 'customer', content: 'API error in my application' },
      ])

      const result = await router.route(conversation)

      // Should fall back to default since technical is undefined
      expect(result.agent).toBe(sam)
    })

    it('should handle empty topics config', async () => {
      const configWithNoTopics: SupportConfig = {
        default: sam,
        topics: {},
        escalation: {
          sentiment: -0.5,
          loops: 3,
          explicit: true,
        },
      }

      const router = createRouter(configWithNoTopics)
      const conversation = createConversation([
        { role: 'customer', content: 'I need help with billing' },
      ])

      const result = await router.route(conversation)

      expect(result.agent).toBe(sam)
    })

    it('should handle special characters in messages', async () => {
      const router = createRouter(defaultConfig)
      const conversation = createConversation([
        { role: 'customer', content: 'I need help with my $100 invoice! 🤔' },
      ])

      const result = await router.route(conversation)

      expect(result.agent).toBe(finn)
      expect(result.topic).toBe('billing')
    })

    it('should handle very long messages', async () => {
      const router = createRouter(defaultConfig)
      const longMessage = 'I have a technical problem. '.repeat(100) + 'My API is broken.'
      const conversation = createConversation([
        { role: 'customer', content: longMessage },
      ])

      const result = await router.route(conversation)

      expect(result.agent).toBe(ralph)
      expect(result.topic).toBe('technical')
    })
  })
})
