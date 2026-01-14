/**
 * LLM Router Tests
 *
 * Tests for multi-provider LLM router with fallback, load balancing, and cost tracking.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  LLMRouter,
  createRouter,
  type RouterConfig,
  type ProviderConfig,
  type LoadBalanceStrategy,
  type RouterMetrics,
} from './router'
import { createMockProvider, mockResponses, createIsolatedMockProvider } from '../testing'
import type { AgentConfig, AgentProvider, StepResult } from '../types'

// ============================================================================
// Test Fixtures
// ============================================================================

const createTestAgentConfig = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  id: 'test-agent',
  name: 'Test Agent',
  instructions: 'You are a helpful assistant.',
  model: 'gpt-4o',
  ...overrides,
})

const createMockProviderConfig = (
  name: string,
  options: { priority?: number; weight?: number; models?: string[]; healthy?: boolean } = {}
): ProviderConfig => {
  const provider = createIsolatedMockProvider({
    responses: [mockResponses.text(`Response from ${name}`)],
  })

  return {
    name,
    provider,
    priority: options.priority ?? 1,
    weight: options.weight ?? 1,
    models: options.models ?? ['gpt-4o', 'gpt-4o-mini'],
    enabled: options.healthy !== false,
  }
}

// ============================================================================
// LLMRouter Constructor Tests
// ============================================================================

describe('LLMRouter', () => {
  describe('constructor', () => {
    it('creates router with single provider', () => {
      const config: RouterConfig = {
        providers: [createMockProviderConfig('openai')],
      }
      const router = new LLMRouter(config)
      expect(router).toBeInstanceOf(LLMRouter)
    })

    it('creates router with multiple providers', () => {
      const config: RouterConfig = {
        providers: [
          createMockProviderConfig('openai'),
          createMockProviderConfig('anthropic'),
        ],
      }
      const router = new LLMRouter(config)
      expect(router).toBeInstanceOf(LLMRouter)
    })

    it('uses default load balance strategy of "priority"', () => {
      const config: RouterConfig = {
        providers: [createMockProviderConfig('openai')],
      }
      const router = new LLMRouter(config)
      expect(router.strategy).toBe('priority')
    })

    it('accepts custom load balance strategy', () => {
      const config: RouterConfig = {
        providers: [createMockProviderConfig('openai')],
        strategy: 'round-robin',
      }
      const router = new LLMRouter(config)
      expect(router.strategy).toBe('round-robin')
    })

    it('accepts fallback configuration', () => {
      const config: RouterConfig = {
        providers: [createMockProviderConfig('openai')],
        fallback: {
          enabled: true,
          maxRetries: 3,
          retryDelayMs: 1000,
        },
      }
      const router = new LLMRouter(config)
      expect(router.fallbackEnabled).toBe(true)
    })

    it('defaults fallback to enabled', () => {
      const config: RouterConfig = {
        providers: [createMockProviderConfig('openai')],
      }
      const router = new LLMRouter(config)
      expect(router.fallbackEnabled).toBe(true)
    })

    it('throws error with no providers', () => {
      expect(() => new LLMRouter({ providers: [] })).toThrow('At least one provider is required')
    })
  })

  // ============================================================================
  // createAgent Tests
  // ============================================================================

  describe('createAgent()', () => {
    it('creates agent with routed provider', () => {
      const router = new LLMRouter({
        providers: [createMockProviderConfig('openai')],
      })
      const agent = router.createAgent(createTestAgentConfig())
      expect(agent).toBeDefined()
      expect(agent.config.id).toBe('test-agent')
    })

    it('agent can run and get response', async () => {
      const router = new LLMRouter({
        providers: [createMockProviderConfig('openai')],
      })
      const agent = router.createAgent(createTestAgentConfig())
      const result = await agent.run({ prompt: 'Hello' })
      expect(result.text).toBe('Response from openai')
    })

    it('preserves agent config', () => {
      const router = new LLMRouter({
        providers: [createMockProviderConfig('openai')],
      })
      const config = createTestAgentConfig({
        id: 'custom-agent',
        name: 'Custom Agent',
        instructions: 'Be concise.',
      })
      const agent = router.createAgent(config)
      expect(agent.config.id).toBe('custom-agent')
      expect(agent.config.name).toBe('Custom Agent')
      expect(agent.config.instructions).toBe('Be concise.')
    })
  })

  // ============================================================================
  // Fallback Logic Tests
  // ============================================================================

  describe('fallback behavior', () => {
    it('falls back to next provider on error', async () => {
      // First provider always fails
      const failingProvider: AgentProvider = {
        name: 'failing',
        version: '1.0',
        createAgent: () => ({
          config: {} as AgentConfig,
          provider: {} as AgentProvider,
          run: async () => {
            throw new Error('Provider unavailable')
          },
          stream: () => ({} as any),
        }),
      }

      const successProvider = createIsolatedMockProvider({
        responses: [mockResponses.text('Fallback response')],
      })

      const router = new LLMRouter({
        providers: [
          { name: 'failing', provider: failingProvider, priority: 1 },
          { name: 'success', provider: successProvider, priority: 2 },
        ],
        fallback: { enabled: true },
      })

      const agent = router.createAgent(createTestAgentConfig())
      const result = await agent.run({ prompt: 'Hello' })
      expect(result.text).toBe('Fallback response')
    })

    it('tries providers in priority order during fallback', async () => {
      const callOrder: string[] = []

      const createTrackingProvider = (name: string, shouldFail: boolean): AgentProvider => ({
        name,
        version: '1.0',
        createAgent: () => ({
          config: {} as AgentConfig,
          provider: {} as AgentProvider,
          run: async () => {
            callOrder.push(name)
            if (shouldFail) throw new Error(`${name} failed`)
            return { text: `Response from ${name}`, toolCalls: [], toolResults: [], messages: [], steps: 1, finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
          },
          stream: () => ({} as any),
        }),
      })

      const router = new LLMRouter({
        providers: [
          { name: 'primary', provider: createTrackingProvider('primary', true), priority: 1 },
          { name: 'secondary', provider: createTrackingProvider('secondary', true), priority: 2 },
          { name: 'tertiary', provider: createTrackingProvider('tertiary', false), priority: 3 },
        ],
        fallback: { enabled: true },
      })

      const agent = router.createAgent(createTestAgentConfig())
      await agent.run({ prompt: 'Hello' })

      expect(callOrder).toEqual(['primary', 'secondary', 'tertiary'])
    })

    it('throws after all providers fail', async () => {
      const failingProvider: AgentProvider = {
        name: 'failing',
        version: '1.0',
        createAgent: () => ({
          config: {} as AgentConfig,
          provider: {} as AgentProvider,
          run: async () => {
            throw new Error('Provider unavailable')
          },
          stream: () => ({} as any),
        }),
      }

      const router = new LLMRouter({
        providers: [
          { name: 'failing1', provider: failingProvider, priority: 1 },
          { name: 'failing2', provider: failingProvider, priority: 2 },
        ],
        fallback: { enabled: true },
      })

      const agent = router.createAgent(createTestAgentConfig())
      await expect(agent.run({ prompt: 'Hello' })).rejects.toThrow('All providers failed')
    })

    it('does not fallback when fallback is disabled', async () => {
      const failingProvider: AgentProvider = {
        name: 'failing',
        version: '1.0',
        createAgent: () => ({
          config: {} as AgentConfig,
          provider: {} as AgentProvider,
          run: async () => {
            throw new Error('Provider unavailable')
          },
          stream: () => ({} as any),
        }),
      }

      const successProvider = createIsolatedMockProvider({
        responses: [mockResponses.text('Success')],
      })

      const router = new LLMRouter({
        providers: [
          { name: 'failing', provider: failingProvider, priority: 1 },
          { name: 'success', provider: successProvider, priority: 2 },
        ],
        fallback: { enabled: false },
      })

      const agent = router.createAgent(createTestAgentConfig())
      await expect(agent.run({ prompt: 'Hello' })).rejects.toThrow('Provider unavailable')
    })

    it('respects maxRetries configuration', async () => {
      let attempts = 0
      const createFailingProvider = (name: string): AgentProvider => ({
        name,
        version: '1.0',
        createAgent: () => ({
          config: {} as AgentConfig,
          provider: {} as AgentProvider,
          run: async () => {
            attempts++
            throw new Error('Provider unavailable')
          },
          stream: () => ({} as any),
        }),
      })

      // With fallback enabled, maxRetries limits total attempts across providers
      // So we need 3 providers to test 3 retries
      const router = new LLMRouter({
        providers: [
          { name: 'failing1', provider: createFailingProvider('failing1'), priority: 1 },
          { name: 'failing2', provider: createFailingProvider('failing2'), priority: 2 },
          { name: 'failing3', provider: createFailingProvider('failing3'), priority: 3 },
        ],
        fallback: { enabled: true, maxRetries: 3 },
      })

      const agent = router.createAgent(createTestAgentConfig())
      await expect(agent.run({ prompt: 'Hello' })).rejects.toThrow()
      expect(attempts).toBe(3)
    })
  })

  // ============================================================================
  // Load Balancing Tests
  // ============================================================================

  describe('load balancing strategies', () => {
    describe('priority strategy', () => {
      it('always uses highest priority provider when healthy', async () => {
        const callCounts: Record<string, number> = { primary: 0, secondary: 0 }

        const createCountingProvider = (name: string): AgentProvider => ({
          name,
          version: '1.0',
          createAgent: () => ({
            config: {} as AgentConfig,
            provider: {} as AgentProvider,
            run: async () => {
              callCounts[name]++
              return { text: name, toolCalls: [], toolResults: [], messages: [], steps: 1, finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
            },
            stream: () => ({} as any),
          }),
        })

        const router = new LLMRouter({
          providers: [
            { name: 'primary', provider: createCountingProvider('primary'), priority: 1 },
            { name: 'secondary', provider: createCountingProvider('secondary'), priority: 2 },
          ],
          strategy: 'priority',
        })

        const agent = router.createAgent(createTestAgentConfig())
        await agent.run({ prompt: 'Test 1' })
        await agent.run({ prompt: 'Test 2' })
        await agent.run({ prompt: 'Test 3' })

        expect(callCounts.primary).toBe(3)
        expect(callCounts.secondary).toBe(0)
      })
    })

    describe('round-robin strategy', () => {
      it('distributes requests evenly across providers', async () => {
        const callCounts: Record<string, number> = { a: 0, b: 0, c: 0 }

        const createCountingProvider = (name: string): AgentProvider => ({
          name,
          version: '1.0',
          createAgent: () => ({
            config: {} as AgentConfig,
            provider: {} as AgentProvider,
            run: async () => {
              callCounts[name]++
              return { text: name, toolCalls: [], toolResults: [], messages: [], steps: 1, finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
            },
            stream: () => ({} as any),
          }),
        })

        const router = new LLMRouter({
          providers: [
            { name: 'a', provider: createCountingProvider('a'), priority: 1 },
            { name: 'b', provider: createCountingProvider('b'), priority: 1 },
            { name: 'c', provider: createCountingProvider('c'), priority: 1 },
          ],
          strategy: 'round-robin',
        })

        const agent = router.createAgent(createTestAgentConfig())
        for (let i = 0; i < 6; i++) {
          await agent.run({ prompt: `Test ${i}` })
        }

        expect(callCounts.a).toBe(2)
        expect(callCounts.b).toBe(2)
        expect(callCounts.c).toBe(2)
      })
    })

    describe('weighted strategy', () => {
      it('distributes requests according to weights', async () => {
        const callCounts: Record<string, number> = { heavy: 0, light: 0 }

        const createCountingProvider = (name: string): AgentProvider => ({
          name,
          version: '1.0',
          createAgent: () => ({
            config: {} as AgentConfig,
            provider: {} as AgentProvider,
            run: async () => {
              callCounts[name]++
              return { text: name, toolCalls: [], toolResults: [], messages: [], steps: 1, finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
            },
            stream: () => ({} as any),
          }),
        })

        const router = new LLMRouter({
          providers: [
            { name: 'heavy', provider: createCountingProvider('heavy'), priority: 1, weight: 3 },
            { name: 'light', provider: createCountingProvider('light'), priority: 1, weight: 1 },
          ],
          strategy: 'weighted',
        })

        const agent = router.createAgent(createTestAgentConfig())
        // Run enough times to see distribution
        for (let i = 0; i < 100; i++) {
          await agent.run({ prompt: `Test ${i}` })
        }

        // With 3:1 weight, heavy should get ~75 calls, light ~25
        // Allow some variance
        expect(callCounts.heavy).toBeGreaterThan(60)
        expect(callCounts.light).toBeGreaterThan(10)
      })
    })

    describe('least-latency strategy', () => {
      it('prefers providers with lower latency', async () => {
        const callCounts: Record<string, number> = { fast: 0, slow: 0 }

        const createTimedProvider = (name: string, delayMs: number): AgentProvider => ({
          name,
          version: '1.0',
          createAgent: () => ({
            config: {} as AgentConfig,
            provider: {} as AgentProvider,
            run: async () => {
              await new Promise(r => setTimeout(r, delayMs))
              callCounts[name]++
              return { text: name, toolCalls: [], toolResults: [], messages: [], steps: 1, finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
            },
            stream: () => ({} as any),
          }),
        })

        const router = new LLMRouter({
          providers: [
            { name: 'fast', provider: createTimedProvider('fast', 5), priority: 1 },
            { name: 'slow', provider: createTimedProvider('slow', 50), priority: 1 },
          ],
          strategy: 'least-latency',
        })

        const agent = router.createAgent(createTestAgentConfig())
        // First run to establish baseline
        await agent.run({ prompt: 'Warmup 1' })
        await agent.run({ prompt: 'Warmup 2' })

        // Subsequent runs should favor fast provider
        for (let i = 0; i < 10; i++) {
          await agent.run({ prompt: `Test ${i}` })
        }

        expect(callCounts.fast).toBeGreaterThan(callCounts.slow)
      })
    })

    describe('cost strategy', () => {
      it('prefers providers with lower cost', async () => {
        const callCounts: Record<string, number> = { cheap: 0, expensive: 0 }

        const createCountingProvider = (name: string): AgentProvider => ({
          name,
          version: '1.0',
          createAgent: () => ({
            config: {} as AgentConfig,
            provider: {} as AgentProvider,
            run: async () => {
              callCounts[name]++
              return { text: name, toolCalls: [], toolResults: [], messages: [], steps: 1, finishReason: 'stop', usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } }
            },
            stream: () => ({} as any),
          }),
        })

        const router = new LLMRouter({
          providers: [
            {
              name: 'cheap',
              provider: createCountingProvider('cheap'),
              priority: 1,
              costPerToken: { input: 0.001, output: 0.002 },
            },
            {
              name: 'expensive',
              provider: createCountingProvider('expensive'),
              priority: 1,
              costPerToken: { input: 0.01, output: 0.03 },
            },
          ],
          strategy: 'cost',
        })

        const agent = router.createAgent(createTestAgentConfig())
        for (let i = 0; i < 10; i++) {
          await agent.run({ prompt: `Test ${i}` })
        }

        expect(callCounts.cheap).toBe(10)
        expect(callCounts.expensive).toBe(0)
      })
    })
  })

  // ============================================================================
  // Model Routing Tests
  // ============================================================================

  describe('model routing', () => {
    it('routes to provider that supports the requested model', async () => {
      const callCounts: Record<string, number> = { openai: 0, anthropic: 0 }

      const createCountingProvider = (name: string): AgentProvider => ({
        name,
        version: '1.0',
        createAgent: () => ({
          config: {} as AgentConfig,
          provider: {} as AgentProvider,
          run: async () => {
            callCounts[name]++
            return { text: name, toolCalls: [], toolResults: [], messages: [], steps: 1, finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
          },
          stream: () => ({} as any),
        }),
      })

      const router = new LLMRouter({
        providers: [
          {
            name: 'openai',
            provider: createCountingProvider('openai'),
            priority: 1,
            models: ['gpt-4o', 'gpt-4o-mini'],
          },
          {
            name: 'anthropic',
            provider: createCountingProvider('anthropic'),
            priority: 1,
            models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'],
          },
        ],
      })

      // Request Claude model
      const agent = router.createAgent(createTestAgentConfig({ model: 'claude-sonnet-4-20250514' }))
      await agent.run({ prompt: 'Hello' })

      expect(callCounts.anthropic).toBe(1)
      expect(callCounts.openai).toBe(0)
    })

    it('throws error when no provider supports requested model', () => {
      const router = new LLMRouter({
        providers: [
          {
            name: 'openai',
            provider: createIsolatedMockProvider({ responses: [] }),
            priority: 1,
            models: ['gpt-4o'],
          },
        ],
      })

      expect(() =>
        router.createAgent(createTestAgentConfig({ model: 'unknown-model' }))
      ).toThrow('No provider supports model: unknown-model')
    })
  })

  // ============================================================================
  // Cost Tracking Tests
  // ============================================================================

  describe('cost tracking', () => {
    it('tracks total cost across requests', async () => {
      const router = new LLMRouter({
        providers: [
          {
            ...createMockProviderConfig('openai'),
            costPerToken: { input: 0.00001, output: 0.00002 },
          },
        ],
      })

      const agent = router.createAgent(createTestAgentConfig())
      await agent.run({ prompt: 'Test' })

      const metrics = router.getMetrics()
      expect(metrics.totalCost).toBeGreaterThan(0)
    })

    it('tracks cost per provider', async () => {
      const router = new LLMRouter({
        providers: [
          {
            ...createMockProviderConfig('openai'),
            costPerToken: { input: 0.00001, output: 0.00002 },
          },
          {
            ...createMockProviderConfig('anthropic'),
            costPerToken: { input: 0.00003, output: 0.00004 },
          },
        ],
        strategy: 'round-robin',
      })

      const agent = router.createAgent(createTestAgentConfig())
      await agent.run({ prompt: 'Test 1' })
      await agent.run({ prompt: 'Test 2' })

      const metrics = router.getMetrics()
      expect(metrics.costByProvider['openai']).toBeGreaterThan(0)
      expect(metrics.costByProvider['anthropic']).toBeGreaterThan(0)
    })

    it('exposes budget limits', async () => {
      const router = new LLMRouter({
        providers: [createMockProviderConfig('openai')],
        budget: {
          maxTotalCost: 10.0,
          alertThreshold: 8.0,
        },
      })

      expect(router.budget.maxTotalCost).toBe(10.0)
      expect(router.budget.alertThreshold).toBe(8.0)
    })

    it('emits alert when approaching budget limit', async () => {
      const alertFn = vi.fn()

      // Mock returns 10 input + 5 output tokens
      // Cost = (10/1000)*1.0 + (5/1000)*2.0 = $0.01 + $0.01 = $0.02 per request
      // Set threshold low enough to be triggered by first request
      const router = new LLMRouter({
        providers: [
          {
            ...createMockProviderConfig('openai'),
            costPerToken: { input: 1.0, output: 2.0 },
          },
        ],
        budget: {
          maxTotalCost: 1.0,
          alertThreshold: 0.01, // Will be exceeded by first request ($0.02)
          onAlert: alertFn,
        },
      })

      const agent = router.createAgent(createTestAgentConfig())
      await agent.run({ prompt: 'Test' })

      // Should trigger alert since mock usage is 10 input + 5 output tokens
      // = (10/1000)*1.0 + (5/1000)*2.0 = $0.02, which exceeds $0.01 threshold
      expect(alertFn).toHaveBeenCalled()
    })

    it('rejects requests when budget exceeded', async () => {
      const router = new LLMRouter({
        providers: [
          {
            ...createMockProviderConfig('openai'),
            costPerToken: { input: 100.0, output: 200.0 },
          },
        ],
        budget: {
          maxTotalCost: 1.0,
          hardLimit: true,
        },
      })

      const agent = router.createAgent(createTestAgentConfig())
      // First request should work but exhaust budget
      await agent.run({ prompt: 'Test 1' })
      // Second request should fail
      await expect(agent.run({ prompt: 'Test 2' })).rejects.toThrow('Budget exceeded')
    })
  })

  // ============================================================================
  // Metrics Tests
  // ============================================================================

  describe('metrics', () => {
    it('tracks request count', async () => {
      const router = new LLMRouter({
        providers: [createMockProviderConfig('openai')],
      })

      const agent = router.createAgent(createTestAgentConfig())
      await agent.run({ prompt: 'Test 1' })
      await agent.run({ prompt: 'Test 2' })

      const metrics = router.getMetrics()
      expect(metrics.totalRequests).toBe(2)
    })

    it('tracks success and failure counts', async () => {
      let shouldFail = false
      const maybeFailProvider: AgentProvider = {
        name: 'maybe-fail',
        version: '1.0',
        createAgent: () => ({
          config: {} as AgentConfig,
          provider: {} as AgentProvider,
          run: async () => {
            if (shouldFail) throw new Error('Failed')
            return { text: 'ok', toolCalls: [], toolResults: [], messages: [], steps: 1, finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
          },
          stream: () => ({} as any),
        }),
      }

      const router = new LLMRouter({
        providers: [{ name: 'maybe-fail', provider: maybeFailProvider, priority: 1 }],
        fallback: { enabled: false },
      })

      const agent = router.createAgent(createTestAgentConfig())
      await agent.run({ prompt: 'Success' })
      shouldFail = true
      await agent.run({ prompt: 'Fail' }).catch(() => {})

      const metrics = router.getMetrics()
      expect(metrics.successCount).toBe(1)
      expect(metrics.failureCount).toBe(1)
    })

    it('tracks average latency', async () => {
      const router = new LLMRouter({
        providers: [createMockProviderConfig('openai')],
      })

      const agent = router.createAgent(createTestAgentConfig())
      await agent.run({ prompt: 'Test' })

      const metrics = router.getMetrics()
      expect(metrics.averageLatencyMs).toBeGreaterThanOrEqual(0)
    })

    it('tracks latency per provider', async () => {
      const router = new LLMRouter({
        providers: [
          createMockProviderConfig('openai'),
          createMockProviderConfig('anthropic'),
        ],
        strategy: 'round-robin',
      })

      const agent = router.createAgent(createTestAgentConfig())
      await agent.run({ prompt: 'Test 1' })
      await agent.run({ prompt: 'Test 2' })

      const metrics = router.getMetrics()
      expect(metrics.latencyByProvider['openai']).toBeDefined()
      expect(metrics.latencyByProvider['anthropic']).toBeDefined()
    })

    it('exposes token usage metrics', async () => {
      const router = new LLMRouter({
        providers: [createMockProviderConfig('openai')],
      })

      const agent = router.createAgent(createTestAgentConfig())
      await agent.run({ prompt: 'Test' })

      const metrics = router.getMetrics()
      expect(metrics.totalTokens).toBeGreaterThan(0)
      expect(metrics.promptTokens).toBeGreaterThan(0)
      expect(metrics.completionTokens).toBeGreaterThan(0)
    })

    it('resets metrics on demand', async () => {
      const router = new LLMRouter({
        providers: [createMockProviderConfig('openai')],
      })

      const agent = router.createAgent(createTestAgentConfig())
      await agent.run({ prompt: 'Test' })

      router.resetMetrics()

      const metrics = router.getMetrics()
      expect(metrics.totalRequests).toBe(0)
      expect(metrics.totalCost).toBe(0)
    })
  })

  // ============================================================================
  // Health Check Tests
  // ============================================================================

  describe('health checks', () => {
    it('marks provider as unhealthy after consecutive failures', async () => {
      let callCount = 0
      const failingProvider: AgentProvider = {
        name: 'failing',
        version: '1.0',
        createAgent: () => ({
          config: {} as AgentConfig,
          provider: {} as AgentProvider,
          run: async () => {
            callCount++
            throw new Error('Always fails')
          },
          stream: () => ({} as any),
        }),
      }

      const healthyProvider = createIsolatedMockProvider({
        responses: [
          mockResponses.text('OK 1'),
          mockResponses.text('OK 2'),
          mockResponses.text('OK 3'),
          mockResponses.text('OK 4'),
        ],
      })

      const router = new LLMRouter({
        providers: [
          { name: 'failing', provider: failingProvider, priority: 1 },
          { name: 'healthy', provider: healthyProvider, priority: 2 },
        ],
        fallback: { enabled: true },
        healthCheck: { failureThreshold: 2 },
      })

      const agent = router.createAgent(createTestAgentConfig())

      // First two requests will try failing provider first, then fall back
      await agent.run({ prompt: 'Test 1' })
      await agent.run({ prompt: 'Test 2' })

      // After 2 failures, failing provider should be marked unhealthy
      // Third request should go directly to healthy provider
      const initialFailCount = callCount
      await agent.run({ prompt: 'Test 3' })

      // If failing provider was skipped, callCount shouldn't increase
      expect(callCount).toBe(initialFailCount)
    })

    it('recovers unhealthy provider after recovery period', async () => {
      const baseTime = Date.now()
      vi.useFakeTimers({ now: baseTime })

      let shouldFail = true
      const toggleProvider: AgentProvider = {
        name: 'toggle',
        version: '1.0',
        createAgent: () => ({
          config: {} as AgentConfig,
          provider: {} as AgentProvider,
          run: async () => {
            if (shouldFail) throw new Error('Temporarily failed')
            return { text: 'recovered', toolCalls: [], toolResults: [], messages: [], steps: 1, finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
          },
          stream: () => ({} as any),
        }),
      }

      const backupProvider = createIsolatedMockProvider({
        responses: Array(10).fill(mockResponses.text('backup')),
      })

      const router = new LLMRouter({
        providers: [
          { name: 'toggle', provider: toggleProvider, priority: 1 },
          { name: 'backup', provider: backupProvider, priority: 2 },
        ],
        fallback: { enabled: true },
        healthCheck: {
          failureThreshold: 1,
          recoveryPeriodMs: 5000,
        },
      })

      const agent = router.createAgent(createTestAgentConfig())

      // Trigger failure and mark unhealthy
      await agent.run({ prompt: 'Test 1' })

      // Fix the provider
      shouldFail = false

      // Advance time past recovery period using setSystemTime
      vi.setSystemTime(baseTime + 6000)

      // Next request should try toggle provider again
      const result = await agent.run({ prompt: 'Test 2' })
      expect(result.text).toBe('recovered')

      vi.useRealTimers()
    })

    it('provides health status for all providers', () => {
      const router = new LLMRouter({
        providers: [
          createMockProviderConfig('openai'),
          createMockProviderConfig('anthropic'),
        ],
      })

      const health = router.getHealthStatus()
      expect(health['openai'].healthy).toBe(true)
      expect(health['anthropic'].healthy).toBe(true)
    })
  })

  // ============================================================================
  // Provider Management Tests
  // ============================================================================

  describe('provider management', () => {
    it('allows adding providers dynamically', () => {
      const router = new LLMRouter({
        providers: [createMockProviderConfig('openai')],
      })

      router.addProvider(createMockProviderConfig('anthropic'))

      expect(router.getProviders()).toHaveLength(2)
    })

    it('allows removing providers', () => {
      const router = new LLMRouter({
        providers: [
          createMockProviderConfig('openai'),
          createMockProviderConfig('anthropic'),
        ],
      })

      router.removeProvider('anthropic')

      expect(router.getProviders()).toHaveLength(1)
      expect(router.getProviders()[0].name).toBe('openai')
    })

    it('allows enabling/disabling providers', async () => {
      const callCounts: Record<string, number> = { openai: 0, anthropic: 0 }

      const createCountingProvider = (name: string): AgentProvider => ({
        name,
        version: '1.0',
        createAgent: () => ({
          config: {} as AgentConfig,
          provider: {} as AgentProvider,
          run: async () => {
            callCounts[name]++
            return { text: name, toolCalls: [], toolResults: [], messages: [], steps: 1, finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
          },
          stream: () => ({} as any),
        }),
      })

      const router = new LLMRouter({
        providers: [
          { name: 'openai', provider: createCountingProvider('openai'), priority: 1 },
          { name: 'anthropic', provider: createCountingProvider('anthropic'), priority: 2 },
        ],
        strategy: 'priority',
      })

      const agent = router.createAgent(createTestAgentConfig())
      await agent.run({ prompt: 'Test 1' })
      expect(callCounts.openai).toBe(1)

      // Disable openai
      router.setProviderEnabled('openai', false)
      await agent.run({ prompt: 'Test 2' })
      expect(callCounts.anthropic).toBe(1)

      // Re-enable openai
      router.setProviderEnabled('openai', true)
      await agent.run({ prompt: 'Test 3' })
      expect(callCounts.openai).toBe(2)
    })
  })

  // ============================================================================
  // createRouter Factory Tests
  // ============================================================================

  describe('createRouter()', () => {
    it('creates LLMRouter instance', () => {
      const router = createRouter({
        providers: [createMockProviderConfig('openai')],
      })
      expect(router).toBeInstanceOf(LLMRouter)
    })

    it('passes options to constructor', () => {
      const router = createRouter({
        providers: [createMockProviderConfig('openai')],
        strategy: 'round-robin',
      })
      expect(router.strategy).toBe('round-robin')
    })
  })
})
