import { describe, it, expect, vi } from 'vitest'
import type { Agent, Conversation, SupportConfig, Message, Customer } from '../types'
import { createRouter, createAITopicDetector, type TopicDetector, type RouterResult, type AIClassifier } from '../routing'

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

  // ============================================================================
  // AI-BASED TOPIC CLASSIFICATION TESTS
  // ============================================================================

  describe('AI-Based Topic Classification', () => {
    it('should route billing messages to finn via AI classification', async () => {
      const aiDetector: TopicDetector = vi.fn().mockResolvedValue({
        topic: 'billing',
        confidence: 0.92,
      })

      const router = createRouter(defaultConfig, { detector: aiDetector })
      const conversation = createConversation([
        { role: 'customer', content: 'Why was I charged twice this month?' },
      ])

      const result = await router.route(conversation)

      expect(aiDetector).toHaveBeenCalledWith(conversation)
      expect(result.agent).toBe(finn)
      expect(result.topic).toBe('billing')
      expect(result.confidence).toBe(0.92)
    })

    it('should route technical messages to ralph via AI classification', async () => {
      const aiDetector: TopicDetector = vi.fn().mockResolvedValue({
        topic: 'technical',
        confidence: 0.88,
      })

      const router = createRouter(defaultConfig, { detector: aiDetector })
      const conversation = createConversation([
        { role: 'customer', content: 'The webhook endpoint is returning 502 errors intermittently' },
      ])

      const result = await router.route(conversation)

      expect(result.agent).toBe(ralph)
      expect(result.topic).toBe('technical')
      expect(result.confidence).toBe(0.88)
    })

    it('should route sales messages to sally via AI classification', async () => {
      const aiDetector: TopicDetector = vi.fn().mockResolvedValue({
        topic: 'sales',
        confidence: 0.95,
      })

      const router = createRouter(defaultConfig, { detector: aiDetector })
      const conversation = createConversation([
        { role: 'customer', content: 'I want to discuss enterprise pricing for my team of 50' },
      ])

      const result = await router.route(conversation)

      expect(result.agent).toBe(sally)
      expect(result.topic).toBe('sales')
      expect(result.confidence).toBe(0.95)
    })

    it('should handle AI classification returning unknown topic', async () => {
      const aiDetector: TopicDetector = vi.fn().mockResolvedValue({
        topic: 'feedback',
        confidence: 0.85,
      })

      const router = createRouter(defaultConfig, { detector: aiDetector })
      const conversation = createConversation([
        { role: 'customer', content: 'I just wanted to say your product is amazing!' },
      ])

      const result = await router.route(conversation)

      expect(result.agent).toBe(sam) // Falls back to default
      expect(result.topic).toBe('feedback')
      expect(result.confidence).toBe(0.85)
    })

    it('should handle AI classification errors gracefully', async () => {
      const aiDetector: TopicDetector = vi.fn().mockRejectedValue(new Error('AI service unavailable'))

      const router = createRouter(defaultConfig, { detector: aiDetector })
      const conversation = createConversation([
        { role: 'customer', content: 'Help me with my billing' },
      ])

      await expect(router.route(conversation)).rejects.toThrow('AI service unavailable')
    })
  })

  // ============================================================================
  // MULTIPLE TOPIC DETECTION TESTS
  // ============================================================================

  describe('Multiple Topic Detection', () => {
    it('should return primary topic when multiple topics are detected', async () => {
      const multiTopicDetector: TopicDetector = vi.fn().mockResolvedValue({
        topic: 'billing', // Primary topic
        confidence: 0.75,
        secondaryTopics: [
          { topic: 'technical', confidence: 0.45 },
        ],
      })

      const router = createRouter(defaultConfig, { detector: multiTopicDetector })
      const conversation = createConversation([
        { role: 'customer', content: 'I got charged but the API integration failed' },
      ])

      const result = await router.route(conversation)

      expect(result.agent).toBe(finn)
      expect(result.topic).toBe('billing')
    })

    it('should handle conversation that spans multiple topics', async () => {
      const router = createRouter(defaultConfig)
      const conversation = createConversation([
        { role: 'customer', content: 'I have a billing question about my invoice' },
        { role: 'agent', content: 'Sure, how can I help with billing?' },
        { role: 'customer', content: 'Actually, now I need help with the API' },
        { role: 'customer', content: 'Getting 500 errors on every request' },
      ])

      const result = await router.route(conversation)

      // Recent messages about technical should take precedence
      expect(result.agent).toBe(ralph)
      expect(result.topic).toBe('technical')
    })

    it('should detect mixed billing and sales topics', async () => {
      const router = createRouter(defaultConfig)
      const conversation = createConversation([
        { role: 'customer', content: 'I want to upgrade my plan and also have a question about my last invoice' },
      ])

      const result = await router.route(conversation)

      // Should pick one topic based on scoring
      expect([finn, sally]).toContain(result.agent)
      expect(['billing', 'sales']).toContain(result.topic)
    })

    it('should handle conversation with no clear primary topic', async () => {
      const ambiguousDetector: TopicDetector = vi.fn().mockResolvedValue({
        topic: null,
        confidence: 0.2,
      })

      const router = createRouter(defaultConfig, { detector: ambiguousDetector })
      const conversation = createConversation([
        { role: 'customer', content: 'I need help with something' },
      ])

      const result = await router.route(conversation)

      expect(result.agent).toBe(sam)
      expect(result.topic).toBeNull()
      expect(result.confidence).toBe(0.2)
    })
  })

  // ============================================================================
  // AI CLASSIFIER FACTORY TESTS
  // ============================================================================

  describe('createAITopicDetector', () => {
    it('should create an AI-based topic detector', async () => {
      const mockAI = {
        generateText: vi.fn().mockResolvedValue({
          text: JSON.stringify({ topic: 'billing', confidence: 0.9 }),
        }),
      }

      const detector = createAITopicDetector(mockAI as unknown as AIClassifier)
      const conversation = createConversation([
        { role: 'customer', content: 'Question about my invoice' },
      ])

      const result = await detector(conversation)

      expect(result.topic).toBe('billing')
      expect(result.confidence).toBe(0.9)
      expect(mockAI.generateText).toHaveBeenCalled()
    })

    it('should handle malformed AI response', async () => {
      const mockAI = {
        generateText: vi.fn().mockResolvedValue({
          text: 'not valid json',
        }),
      }

      const detector = createAITopicDetector(mockAI as unknown as AIClassifier)
      const conversation = createConversation([
        { role: 'customer', content: 'Question about my invoice' },
      ])

      const result = await detector(conversation)

      expect(result.topic).toBeNull()
      expect(result.confidence).toBe(0)
    })

    it('should extract topic from AI response with explanation', async () => {
      const mockAI = {
        generateText: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            topic: 'technical',
            confidence: 0.85,
            explanation: 'User mentions API errors and server issues',
          }),
        }),
      }

      const detector = createAITopicDetector(mockAI as unknown as AIClassifier)
      const conversation = createConversation([
        { role: 'customer', content: 'API returning 500 errors' },
      ])

      const result = await detector(conversation)

      expect(result.topic).toBe('technical')
      expect(result.confidence).toBe(0.85)
    })

    it('should use configured topics in AI prompt', async () => {
      const mockAI = {
        generateText: vi.fn().mockResolvedValue({
          text: JSON.stringify({ topic: 'sales', confidence: 0.88 }),
        }),
      }

      const customTopics = ['billing', 'technical', 'sales', 'account']
      const detector = createAITopicDetector(mockAI as unknown as AIClassifier, { topics: customTopics })
      const conversation = createConversation([
        { role: 'customer', content: 'I want to buy more licenses' },
      ])

      await detector(conversation)

      // Topics are passed in the systemPrompt option
      const callArgs = mockAI.generateText.mock.calls[0]
      const systemPrompt = callArgs[1]?.systemPrompt as string
      expect(systemPrompt).toContain('billing')
      expect(systemPrompt).toContain('technical')
      expect(systemPrompt).toContain('sales')
      expect(systemPrompt).toContain('account')
    })
  })
})
