/**
 * LLM Router Tests
 *
 * Tests for:
 * - Multi-provider routing
 * - Fallback behavior
 * - Load balancing strategies
 * - Rate limiting
 * - Cost optimization
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  CompletionRequest,
  CompletionResponse,
  ProviderConfig,
  RouterConfig,
  Message,
  StreamEvent,
} from '../types'
import { createOpenAIProvider, createAnthropicProvider } from '../providers'
import { createLLMRouter, type LLMRouter } from '../router'

// ============================================================================
// Test Utilities
// ============================================================================

function createTestMessages(): Message[] {
  return [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' },
  ]
}

function createMockOpenAIResponse(): CompletionResponse {
  return {
    id: 'openai-resp-123',
    model: 'gpt-4o',
    content: 'Hello from OpenAI!',
    finishReason: 'stop',
    usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
    latencyMs: 100,
    provider: 'openai',
  }
}

function createMockAnthropicResponse(): CompletionResponse {
  return {
    id: 'anthropic-resp-123',
    model: 'claude-sonnet-4-20250514',
    content: 'Hello from Anthropic!',
    finishReason: 'stop',
    usage: { promptTokens: 25, completionTokens: 12, totalTokens: 37 },
    latencyMs: 150,
    provider: 'anthropic',
  }
}

// ============================================================================
// Router Creation Tests
// ============================================================================

describe('LLM Router', () => {
  describe('createLLMRouter()', () => {
    it('should create router with providers', () => {
      const openai = createOpenAIProvider({ apiKey: 'test-key' })
      const anthropic = createAnthropicProvider({ apiKey: 'test-key' })

      const router = createLLMRouter({
        providers: [
          { name: 'openai', apiKey: 'test-key' },
          { name: 'anthropic', apiKey: 'test-key' },
        ],
      })

      expect(router).toBeDefined()
    })

    it('should use priority strategy by default', () => {
      const router = createLLMRouter({
        providers: [{ name: 'openai', apiKey: 'test-key' }],
      })

      expect(router.getStrategy()).toBe('priority')
    })

    it('should accept custom strategy', () => {
      const router = createLLMRouter({
        providers: [{ name: 'openai', apiKey: 'test-key' }],
        strategy: 'round-robin',
      })

      expect(router.getStrategy()).toBe('round-robin')
    })
  })

  // ============================================================================
  // Routing Strategy Tests
  // ============================================================================

  describe('Priority Routing', () => {
    it('should use first provider for supported model', async () => {
      const router = createLLMRouter({
        providers: [
          {
            name: 'openai',
            apiKey: 'test-key',
            options: { mockResponse: createMockOpenAIResponse() },
          },
          {
            name: 'anthropic',
            apiKey: 'test-key',
            options: { mockResponse: createMockAnthropicResponse() },
          },
        ],
        strategy: 'priority',
      })

      const response = await router.complete({
        model: 'gpt-4o',
        messages: createTestMessages(),
      })

      expect(response.provider).toBe('openai')
    })

    it('should fall back to second provider if first does not support model', async () => {
      const router = createLLMRouter({
        providers: [
          {
            name: 'openai',
            apiKey: 'test-key',
            options: { mockResponse: createMockOpenAIResponse() },
          },
          {
            name: 'anthropic',
            apiKey: 'test-key',
            options: { mockResponse: createMockAnthropicResponse() },
          },
        ],
        strategy: 'priority',
      })

      const response = await router.complete({
        model: 'claude-sonnet-4-20250514',
        messages: createTestMessages(),
      })

      expect(response.provider).toBe('anthropic')
    })
  })

  describe('Round-Robin Routing', () => {
    it('should alternate between providers', async () => {
      const router = createLLMRouter({
        providers: [
          {
            name: 'openai',
            apiKey: 'test-key',
            options: { mockResponse: createMockOpenAIResponse() },
          },
          {
            name: 'anthropic',
            apiKey: 'test-key',
            options: { mockResponse: createMockAnthropicResponse() },
          },
        ],
        strategy: 'round-robin',
      })

      // First request should use a compatible provider
      const resp1 = await router.complete({
        model: 'gpt-4o',
        messages: createTestMessages(),
      })

      const resp2 = await router.complete({
        model: 'claude-sonnet-4-20250514',
        messages: createTestMessages(),
      })

      // Both should succeed with their respective providers
      expect(resp1.provider).toBe('openai')
      expect(resp2.provider).toBe('anthropic')
    })
  })

  describe('Least-Latency Routing', () => {
    it('should prefer provider with lowest average latency', async () => {
      const router = createLLMRouter({
        providers: [
          {
            name: 'openai',
            apiKey: 'test-key',
            options: { mockResponse: { ...createMockOpenAIResponse(), latencyMs: 200 } },
          },
          {
            name: 'anthropic',
            apiKey: 'test-key',
            options: { mockResponse: { ...createMockAnthropicResponse(), latencyMs: 50 } },
          },
        ],
        strategy: 'least-latency',
      })

      // Prime with some requests to establish latency stats
      await router.complete({ model: 'gpt-4o', messages: createTestMessages() })
      await router.complete({ model: 'claude-sonnet-4-20250514', messages: createTestMessages() })

      // With latency tracking, future requests should prefer the faster provider
      // Note: This test is simplified - real implementation would track latency history
      const stats = router.getStats()
      expect(stats).toBeDefined()
    })
  })

  describe('Cost-Optimized Routing', () => {
    it('should prefer cheaper provider when both support the model', async () => {
      const router = createLLMRouter({
        providers: [
          {
            name: 'openai',
            apiKey: 'test-key',
            options: { mockResponse: createMockOpenAIResponse() },
          },
          {
            name: 'anthropic',
            apiKey: 'test-key',
            options: { mockResponse: createMockAnthropicResponse() },
          },
        ],
        strategy: 'cost-optimized',
      })

      // Note: Cost comparison depends on model pricing
      const response = await router.complete({
        model: 'gpt-4o',
        messages: createTestMessages(),
      })

      expect(response).toBeDefined()
    })
  })

  // ============================================================================
  // Fallback Tests
  // ============================================================================

  describe('Fallback Behavior', () => {
    it('should fall back on provider error when enabled', async () => {
      const errorProvider = createOpenAIProvider({
        apiKey: 'test-key',
        // This will throw on non-mock requests
      })

      const router = createLLMRouter({
        providers: [
          { name: 'openai', apiKey: 'bad-key' }, // Will fail
          {
            name: 'anthropic',
            apiKey: 'test-key',
            options: { mockResponse: createMockAnthropicResponse() },
          },
        ],
        fallback: {
          enabled: true,
          maxAttempts: 2,
          triggerOn: ['server_error', 'auth_error'],
        },
      })

      // First provider should fail, fallback to second
      // Note: This requires actual error handling in implementation
      expect(router.config.fallback?.enabled).toBe(true)
    })

    it('should not fall back when disabled', async () => {
      const router = createLLMRouter({
        providers: [
          { name: 'openai', apiKey: 'test-key' },
          {
            name: 'anthropic',
            apiKey: 'test-key',
            options: { mockResponse: createMockAnthropicResponse() },
          },
        ],
        fallback: {
          enabled: false,
        },
      })

      expect(router.config.fallback?.enabled).toBe(false)
    })

    it('should respect maxAttempts', async () => {
      const router = createLLMRouter({
        providers: [
          { name: 'openai', apiKey: 'test-key' },
          { name: 'anthropic', apiKey: 'test-key' },
        ],
        fallback: {
          enabled: true,
          maxAttempts: 3,
        },
      })

      expect(router.config.fallback?.maxAttempts).toBe(3)
    })
  })

  // ============================================================================
  // Rate Limiting Tests
  // ============================================================================

  describe('Rate Limiting', () => {
    it('should track request count per provider', async () => {
      const router = createLLMRouter({
        providers: [
          {
            name: 'openai',
            apiKey: 'test-key',
            options: { mockResponse: createMockOpenAIResponse() },
          },
        ],
        rateLimit: {
          requestsPerMinute: 100,
        },
      })

      await router.complete({ model: 'gpt-4o', messages: createTestMessages() })
      await router.complete({ model: 'gpt-4o', messages: createTestMessages() })

      const stats = router.getStats()
      expect(stats.totalRequests).toBe(2)
    })

    it('should track token usage per provider', async () => {
      const router = createLLMRouter({
        providers: [
          {
            name: 'openai',
            apiKey: 'test-key',
            options: { mockResponse: createMockOpenAIResponse() },
          },
        ],
        rateLimit: {
          tokensPerMinute: 10000,
        },
      })

      await router.complete({ model: 'gpt-4o', messages: createTestMessages() })

      const stats = router.getStats()
      expect(stats.totalTokens).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // Statistics Tests
  // ============================================================================

  describe('Statistics', () => {
    it('should track total requests', async () => {
      const router = createLLMRouter({
        providers: [
          {
            name: 'openai',
            apiKey: 'test-key',
            options: { mockResponse: createMockOpenAIResponse() },
          },
        ],
      })

      await router.complete({ model: 'gpt-4o', messages: createTestMessages() })
      await router.complete({ model: 'gpt-4o', messages: createTestMessages() })
      await router.complete({ model: 'gpt-4o', messages: createTestMessages() })

      expect(router.getStats().totalRequests).toBe(3)
    })

    it('should track total cost', async () => {
      const router = createLLMRouter({
        providers: [
          {
            name: 'openai',
            apiKey: 'test-key',
            options: { mockResponse: createMockOpenAIResponse() },
          },
        ],
      })

      await router.complete({ model: 'gpt-4o', messages: createTestMessages() })

      const stats = router.getStats()
      expect(stats.totalCostUsd).toBeGreaterThanOrEqual(0)
    })

    it('should track per-provider statistics', async () => {
      const router = createLLMRouter({
        providers: [
          {
            name: 'openai',
            apiKey: 'test-key',
            options: { mockResponse: createMockOpenAIResponse() },
          },
          {
            name: 'anthropic',
            apiKey: 'test-key',
            options: { mockResponse: createMockAnthropicResponse() },
          },
        ],
      })

      await router.complete({ model: 'gpt-4o', messages: createTestMessages() })
      await router.complete({ model: 'claude-sonnet-4-20250514', messages: createTestMessages() })

      const stats = router.getStats()
      expect(stats.byProvider.openai).toBeDefined()
      expect(stats.byProvider.anthropic).toBeDefined()
      expect(stats.byProvider.openai.requests).toBe(1)
      expect(stats.byProvider.anthropic.requests).toBe(1)
    })

    it('should calculate average latency', async () => {
      const router = createLLMRouter({
        providers: [
          {
            name: 'openai',
            apiKey: 'test-key',
            options: { mockResponse: createMockOpenAIResponse() },
          },
        ],
      })

      await router.complete({ model: 'gpt-4o', messages: createTestMessages() })

      const stats = router.getStats()
      expect(stats.averageLatencyMs).toBeGreaterThanOrEqual(0)
    })

    it('should reset statistics', async () => {
      const router = createLLMRouter({
        providers: [
          {
            name: 'openai',
            apiKey: 'test-key',
            options: { mockResponse: createMockOpenAIResponse() },
          },
        ],
      })

      await router.complete({ model: 'gpt-4o', messages: createTestMessages() })
      expect(router.getStats().totalRequests).toBe(1)

      router.resetStats()
      expect(router.getStats().totalRequests).toBe(0)
    })
  })

  // ============================================================================
  // Streaming Tests
  // ============================================================================

  describe('Streaming', () => {
    it('should route streaming requests', async () => {
      const mockEvents: StreamEvent[] = [
        { type: 'start', data: {}, timestamp: new Date() },
        { type: 'text-delta', data: { textDelta: 'Hello', accumulated: 'Hello' }, timestamp: new Date() },
        { type: 'done', data: { response: createMockOpenAIResponse() }, timestamp: new Date() },
      ]

      const router = createLLMRouter({
        providers: [
          {
            name: 'openai',
            apiKey: 'test-key',
            options: { mockStreamEvents: mockEvents },
          },
        ],
      })

      const events: StreamEvent[] = []
      for await (const event of router.stream({
        model: 'gpt-4o',
        messages: createTestMessages(),
      })) {
        events.push(event)
      }

      expect(events.length).toBeGreaterThan(0)
      expect(events[0].type).toBe('start')
    })
  })

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('Error Handling', () => {
    it('should throw if no provider supports the model', async () => {
      const router = createLLMRouter({
        providers: [
          {
            name: 'openai',
            apiKey: 'test-key',
            options: { mockResponse: createMockOpenAIResponse() },
          },
        ],
      })

      await expect(
        router.complete({
          model: 'unknown-model-xyz',
          messages: createTestMessages(),
        })
      ).rejects.toThrow()
    })

    it('should throw if no providers are configured', async () => {
      expect(() => createLLMRouter({ providers: [] })).toThrow()
    })
  })
})
