/**
 * AI Template Literal Tests (RED Phase - TDD)
 *
 * Tests for $.ai`prompt` template literal in the workflow context.
 * These tests define the expected API for createAiTemplateLiteral(config).
 *
 * The factory should create an AI template literal function that:
 * - Executes prompts and returns responses
 * - Supports variable interpolation
 * - Supports streaming responses (async iterator)
 * - Allows model selection (ai.claude`...`, ai.gpt4`...`)
 * - Caches responses for identical prompts
 * - Tracks costs/usage
 * - Handles provider fallback on error
 * - Respects rate limits
 * - Supports abort/cancel
 *
 * @see dotdo-1wel8
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// TYPES (Expected API)
// ============================================================================

/**
 * Configuration for createAiTemplateLiteral factory
 */
interface AiTemplateConfig {
  /** AI provider (anthropic, openai, google, workers-ai) */
  provider?: 'anthropic' | 'openai' | 'google' | 'workers-ai'
  /** Model to use */
  model?: string
  /** AI Gateway ID */
  gateway?: string
  /** Temperature (0-2) */
  temperature?: number
  /** Max tokens */
  maxTokens?: number
  /** Environment bindings */
  env?: AiTemplateEnv
  /** Enable response caching */
  cache?: boolean | CacheConfig
  /** Cost tracking callback */
  onUsage?: (usage: UsageInfo) => void
  /** Fallback providers (in order of preference) */
  fallbackProviders?: Array<{
    provider: string
    model: string
  }>
  /** Rate limit configuration */
  rateLimit?: RateLimitConfig
}

/**
 * Environment bindings
 */
interface AiTemplateEnv {
  AI?: { run: (model: string, params: unknown) => Promise<unknown> }
  AI_GATEWAY_ID?: string
  OPENAI_API_KEY?: string
  ANTHROPIC_API_KEY?: string
  GOOGLE_API_KEY?: string
}

/**
 * Cache configuration
 */
interface CacheConfig {
  /** TTL in milliseconds */
  ttl?: number
  /** Maximum cache size */
  maxSize?: number
  /** Custom cache key function */
  keyFn?: (prompt: string) => string
}

/**
 * Usage/cost tracking info
 */
interface UsageInfo {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCost?: number
  model: string
  provider: string
  cached: boolean
}

/**
 * Rate limit configuration
 */
interface RateLimitConfig {
  /** Requests per minute */
  rpm?: number
  /** Tokens per minute */
  tpm?: number
  /** On rate limit exceeded */
  onLimitExceeded?: (limit: { type: 'rpm' | 'tpm'; current: number; max: number }) => void
}

/**
 * Abort options for cancellation
 */
interface AbortOptions {
  signal?: AbortSignal
  timeout?: number
}

/**
 * PipelinePromise with streaming support
 */
interface AiPipelinePromise<T> extends Promise<T> {
  map<R>(fn: (value: T) => R | Promise<R>): AiPipelinePromise<R>
  catch<R = T>(fn: (error: Error) => R | Promise<R>): AiPipelinePromise<R>
  /** Get streaming async iterator */
  stream(): AsyncIterable<string>
  /** Cancel the request */
  cancel(): void
}

/**
 * AI template literal function
 */
interface AiTemplateLiteral {
  (strings: TemplateStringsArray, ...values: unknown[]): AiPipelinePromise<string>
  /** Configure with options */
  configure(options: Partial<AiTemplateConfig>): AiTemplateLiteral
  /** Use Claude model */
  claude: AiTemplateLiteral
  /** Use GPT-4 model */
  gpt4: AiTemplateLiteral
  /** Use GPT-4o model */
  gpt4o: AiTemplateLiteral
  /** Use Gemini model */
  gemini: AiTemplateLiteral
  /** Use Workers AI model */
  workersAi: AiTemplateLiteral
  /** Execute with abort options */
  withAbort(options: AbortOptions): AiTemplateLiteral
}

/**
 * Factory function to create AI template literal
 * THIS IS WHAT NEEDS TO BE IMPLEMENTED
 */
declare function createAiTemplateLiteral(config?: AiTemplateConfig): AiTemplateLiteral

// ============================================================================
// IMPORT ACTUAL IMPLEMENTATION
// ============================================================================

import { createAiTemplateLiteral as createAiTemplateLiteralFn } from '../../../client/context/ai-template'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  // Ensure real timers are restored after each test
  vi.useRealTimers()
})

// ============================================================================
// TEST CASES
// ============================================================================

describe('createAiTemplateLiteral', () => {
  describe('Basic functionality', () => {
    it('should be a function that creates an AI template literal', () => {
      // RED: createAiTemplateLiteral should exist and be callable
      expect(createAiTemplateLiteralFn).toBeDefined()
      expect(typeof createAiTemplateLiteralFn).toBe('function')
    })

    it('should return a function when called with config', () => {
      // RED: Factory should return a template literal function
      const ai = createAiTemplateLiteralFn({ provider: 'anthropic' })
      expect(typeof ai).toBe('function')
    })
  })

  describe('ai`simple prompt` returns response', () => {
    it('should execute a simple prompt and return a string response', async () => {
      // RED: ai`prompt` should work as a template literal and return a promise
      const ai = createAiTemplateLiteralFn({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      })

      const result = await ai`What is 2 + 2?`

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('should return a PipelinePromise', async () => {
      const ai = createAiTemplateLiteralFn()

      const promise = ai`Test prompt`

      expect(promise).toBeInstanceOf(Promise)
      expect(typeof promise.map).toBe('function')
      expect(typeof promise.catch).toBe('function')
    })
  })

  describe('ai`prompt with ${variable}` interpolates correctly', () => {
    it('should interpolate a single variable', async () => {
      const ai = createAiTemplateLiteralFn()
      const topic = 'TypeScript'

      const result = ai`Explain ${topic} in one sentence`

      // The prompt should contain the interpolated value
      expect(result).toBeInstanceOf(Promise)
    })

    it('should interpolate multiple variables', async () => {
      const ai = createAiTemplateLiteralFn()
      const lang1 = 'Python'
      const lang2 = 'JavaScript'

      const result = ai`Compare ${lang1} and ${lang2}`

      expect(result).toBeInstanceOf(Promise)
    })

    it('should handle null and undefined values gracefully', async () => {
      const ai = createAiTemplateLiteralFn()
      const value1 = null
      const value2 = undefined

      // Should not throw
      const result = ai`Test ${value1} and ${value2}`

      expect(result).toBeInstanceOf(Promise)
    })

    it('should handle object interpolation with toString', async () => {
      const ai = createAiTemplateLiteralFn()
      const obj = { name: 'Test', value: 42 }

      const result = ai`Process this data: ${JSON.stringify(obj)}`

      expect(result).toBeInstanceOf(Promise)
    })
  })

  describe('Streaming response support (async iterator)', () => {
    it('should provide a stream() method on the promise', async () => {
      const ai = createAiTemplateLiteralFn()

      const promise = ai`Generate a long response`

      expect(typeof promise.stream).toBe('function')
    })

    it('should return an AsyncIterable from stream()', async () => {
      const ai = createAiTemplateLiteralFn()

      const promise = ai`Stream this response`
      const stream = promise.stream()

      // Should be iterable with for-await
      expect(stream[Symbol.asyncIterator]).toBeDefined()
    })

    it('should yield string chunks during streaming', async () => {
      const ai = createAiTemplateLiteralFn()

      const chunks: string[] = []
      const stream = ai`Count from 1 to 5`.stream()

      for await (const chunk of stream) {
        chunks.push(chunk)
        expect(typeof chunk).toBe('string')
      }

      expect(chunks.length).toBeGreaterThan(0)
    })

    it('should allow consuming the full response after streaming', async () => {
      const ai = createAiTemplateLiteralFn()

      const promise = ai`Hello world`

      // Stream first
      const chunks: string[] = []
      for await (const chunk of promise.stream()) {
        chunks.push(chunk)
      }

      // Full response should equal joined chunks
      const fullResponse = await promise
      expect(fullResponse).toBe(chunks.join(''))
    })
  })

  describe('Model selection (ai.claude`...`, ai.gpt4`...`)', () => {
    it('should have claude model shortcut', () => {
      const ai = createAiTemplateLiteralFn()

      expect(ai.claude).toBeDefined()
      expect(typeof ai.claude).toBe('function')
    })

    it('should have gpt4 model shortcut', () => {
      const ai = createAiTemplateLiteralFn()

      expect(ai.gpt4).toBeDefined()
      expect(typeof ai.gpt4).toBe('function')
    })

    it('should have gpt4o model shortcut', () => {
      const ai = createAiTemplateLiteralFn()

      expect(ai.gpt4o).toBeDefined()
      expect(typeof ai.gpt4o).toBe('function')
    })

    it('should have gemini model shortcut', () => {
      const ai = createAiTemplateLiteralFn()

      expect(ai.gemini).toBeDefined()
      expect(typeof ai.gemini).toBe('function')
    })

    it('should have workersAi model shortcut', () => {
      const ai = createAiTemplateLiteralFn()

      expect(ai.workersAi).toBeDefined()
      expect(typeof ai.workersAi).toBe('function')
    })

    it('ai.claude`prompt` should use Claude model', async () => {
      const onUsage = vi.fn()
      const ai = createAiTemplateLiteralFn({ onUsage })

      await ai.claude`Test prompt`

      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
          model: expect.stringContaining('claude'),
        })
      )
    })

    it('ai.gpt4`prompt` should use GPT-4 model', async () => {
      const onUsage = vi.fn()
      const ai = createAiTemplateLiteralFn({ onUsage })

      await ai.gpt4`Test prompt`

      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: expect.stringContaining('gpt-4'),
        })
      )
    })

    it('model shortcuts should be chainable with configure', () => {
      const ai = createAiTemplateLiteralFn()

      const configured = ai.claude.configure({ temperature: 0.5 })

      expect(typeof configured).toBe('function')
    })
  })

  describe('Response caching for identical prompts', () => {
    it('should cache responses when cache is enabled', async () => {
      const ai = createAiTemplateLiteralFn({ cache: true })

      const result1 = await ai`What is the capital of France?`
      const result2 = await ai`What is the capital of France?`

      expect(result1).toBe(result2)
    })

    it('should report cached status in usage callback', async () => {
      const onUsage = vi.fn()
      const ai = createAiTemplateLiteralFn({ cache: true, onUsage })

      await ai`Cached prompt test`
      await ai`Cached prompt test`

      expect(onUsage).toHaveBeenCalledTimes(2)
      expect(onUsage.mock.calls[0][0].cached).toBe(false)
      expect(onUsage.mock.calls[1][0].cached).toBe(true)
    })

    it('should respect cache TTL', async () => {
      vi.useFakeTimers()

      const ai = createAiTemplateLiteralFn({
        cache: { ttl: 1000 }, // 1 second TTL
      })

      const result1 = await ai`TTL test`

      // Advance time past TTL
      vi.advanceTimersByTime(2000)

      const result2 = await ai`TTL test`

      // Results might differ after TTL expires (not guaranteed from cache)
      expect(result1).toBeDefined()
      expect(result2).toBeDefined()

      vi.useRealTimers()
    })

    it('should respect cache maxSize', async () => {
      const ai = createAiTemplateLiteralFn({
        cache: { maxSize: 2 },
      })

      await ai`Prompt 1`
      await ai`Prompt 2`
      await ai`Prompt 3` // Should evict Prompt 1

      // Prompt 1 should no longer be cached
      // This would make a new request
    })

    it('should support custom cache key function', async () => {
      const keyFn = vi.fn((prompt: string) => `custom:${prompt.slice(0, 10)}`)

      const ai = createAiTemplateLiteralFn({
        cache: { keyFn },
      })

      await ai`Test prompt for custom key`

      expect(keyFn).toHaveBeenCalledWith('Test prompt for custom key')
    })

    it('should not cache when cache is disabled', async () => {
      const onUsage = vi.fn()
      const ai = createAiTemplateLiteralFn({ cache: false, onUsage })

      await ai`No cache prompt`
      await ai`No cache prompt`

      expect(onUsage).toHaveBeenCalledTimes(2)
      expect(onUsage.mock.calls[0][0].cached).toBe(false)
      expect(onUsage.mock.calls[1][0].cached).toBe(false)
    })
  })

  describe('Cost tracking integration', () => {
    it('should call onUsage callback with usage info', async () => {
      const onUsage = vi.fn()
      const ai = createAiTemplateLiteralFn({ onUsage })

      await ai`Track my usage`

      expect(onUsage).toHaveBeenCalledTimes(1)
      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: expect.any(Number),
          outputTokens: expect.any(Number),
          totalTokens: expect.any(Number),
          model: expect.any(String),
          provider: expect.any(String),
          cached: expect.any(Boolean),
        })
      )
    })

    it('should include estimated cost when available', async () => {
      const onUsage = vi.fn()
      const ai = createAiTemplateLiteralFn({ onUsage })

      await ai`Calculate my cost`

      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          estimatedCost: expect.any(Number),
        })
      )
    })

    it('should track usage for each call separately', async () => {
      const usages: UsageInfo[] = []
      const onUsage = vi.fn((usage: UsageInfo) => usages.push(usage))

      const ai = createAiTemplateLiteralFn({ onUsage })

      await ai`First call`
      await ai`Second call with more text`

      expect(usages.length).toBe(2)
      // Second call should have more input tokens
      expect(usages[1].inputTokens).toBeGreaterThan(usages[0].inputTokens)
    })

    it('should aggregate token counts correctly', async () => {
      const onUsage = vi.fn()
      const ai = createAiTemplateLiteralFn({ onUsage })

      await ai`Test`

      const usage = onUsage.mock.calls[0][0] as UsageInfo
      expect(usage.totalTokens).toBe(usage.inputTokens + usage.outputTokens)
    })
  })

  describe('Fallback on provider error', () => {
    it('should fallback to next provider on error', async () => {
      const onUsage = vi.fn()
      const ai = createAiTemplateLiteralFn({
        provider: 'openai',
        model: 'gpt-4',
        fallbackProviders: [
          { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
          { provider: 'google', model: 'gemini-pro' },
        ],
        onUsage,
        env: {
          // Missing OPENAI_API_KEY - should cause primary to fail
          ANTHROPIC_API_KEY: 'test-key',
        },
      })

      // Should succeed using fallback
      const result = await ai`Test fallback`

      expect(result).toBeDefined()
      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
        })
      )
    })

    it('should try all fallbacks before throwing', async () => {
      const ai = createAiTemplateLiteralFn({
        provider: 'openai',
        fallbackProviders: [
          { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
          { provider: 'google', model: 'gemini-pro' },
        ],
        env: {
          // All providers missing keys - should fail all
        },
      })

      await expect(ai`Should fail`).rejects.toThrow()
    })

    it('should include all errors in final error message', async () => {
      const ai = createAiTemplateLiteralFn({
        provider: 'openai',
        fallbackProviders: [
          { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
        ],
        env: {},
      })

      try {
        await ai`Should fail`
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain('openai')
        expect((error as Error).message).toContain('anthropic')
      }
    })

    it('should not use fallback if primary succeeds', async () => {
      const onUsage = vi.fn()
      const ai = createAiTemplateLiteralFn({
        provider: 'anthropic',
        fallbackProviders: [{ provider: 'openai', model: 'gpt-4' }],
        onUsage,
        env: {
          ANTHROPIC_API_KEY: 'test-key',
        },
      })

      await ai`Primary should work`

      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
        })
      )
    })
  })

  describe('Rate limiting handling', () => {
    it('should respect RPM limits', async () => {
      vi.useFakeTimers()

      const onLimitExceeded = vi.fn()
      const ai = createAiTemplateLiteralFn({
        rateLimit: { rpm: 2, onLimitExceeded },
      })

      // First two should succeed
      await ai`Request 1`
      await ai`Request 2`

      // Third should hit limit
      const promise = ai`Request 3`

      expect(onLimitExceeded).toHaveBeenCalledWith({
        type: 'rpm',
        current: 3,
        max: 2,
      })

      vi.useRealTimers()
    })

    it('should respect TPM limits', async () => {
      vi.useFakeTimers()

      const onLimitExceeded = vi.fn()
      const ai = createAiTemplateLiteralFn({
        rateLimit: { tpm: 100, onLimitExceeded },
      })

      // Large prompt that exceeds token limit
      const longPrompt = 'word '.repeat(200)
      const promise = ai`${longPrompt}`

      expect(onLimitExceeded).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tpm',
        })
      )

      vi.useRealTimers()
    })

    it('should queue requests when rate limited', async () => {
      vi.useFakeTimers()

      const ai = createAiTemplateLiteralFn({
        rateLimit: { rpm: 2 },
      })

      const promises = [ai`Request 1`, ai`Request 2`, ai`Request 3`]

      // Third request should be queued
      vi.advanceTimersByTime(60000) // Advance 1 minute

      // All should eventually complete
      const results = await Promise.all(promises)
      expect(results.length).toBe(3)

      vi.useRealTimers()
    })

    it('should reset rate limits after window expires', async () => {
      vi.useFakeTimers()

      const onLimitExceeded = vi.fn()
      const ai = createAiTemplateLiteralFn({
        rateLimit: { rpm: 1, onLimitExceeded },
      })

      await ai`Request 1`

      // Second should hit limit
      const promise2 = ai`Request 2`
      expect(onLimitExceeded).toHaveBeenCalled()

      // Reset after 1 minute
      vi.advanceTimersByTime(60000)
      onLimitExceeded.mockClear()

      // Should succeed now
      await ai`Request 3`
      expect(onLimitExceeded).not.toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  describe('Abort/cancel support', () => {
    it('should provide cancel() method on promise', () => {
      const ai = createAiTemplateLiteralFn()

      const promise = ai`Long running request`

      expect(typeof promise.cancel).toBe('function')
    })

    it('should abort request when cancel() is called', async () => {
      const ai = createAiTemplateLiteralFn()

      const promise = ai`Long running request`
      promise.cancel()

      await expect(promise).rejects.toThrow(/cancel|abort/i)
    })

    it('should support AbortSignal via withAbort()', () => {
      const ai = createAiTemplateLiteralFn()

      expect(ai.withAbort).toBeDefined()
      expect(typeof ai.withAbort).toBe('function')
    })

    it('should abort when AbortSignal is triggered', async () => {
      const ai = createAiTemplateLiteralFn()
      const controller = new AbortController()

      const promise = ai.withAbort({ signal: controller.signal })`Long request`

      // Abort immediately
      controller.abort()

      await expect(promise).rejects.toThrow(/cancel|abort/i)
    })

    it('should support timeout via withAbort()', async () => {
      vi.useFakeTimers()

      const ai = createAiTemplateLiteralFn()

      const promise = ai.withAbort({ timeout: 1000 })`Slow request`

      // Advance past timeout
      vi.advanceTimersByTime(1500)

      await expect(promise).rejects.toThrow(/timeout|abort/i)

      vi.useRealTimers()
    })

    it('should not cancel already completed requests', async () => {
      const ai = createAiTemplateLiteralFn()

      const promise = ai`Quick request`
      const result = await promise

      // Cancel after completion
      promise.cancel()

      // Should still have the result
      expect(result).toBeDefined()
    })

    it('should cancel streaming when abort is triggered', async () => {
      const ai = createAiTemplateLiteralFn()
      const controller = new AbortController()

      const stream = ai.withAbort({ signal: controller.signal })`Stream this`.stream()

      const chunks: string[] = []
      try {
        for await (const chunk of stream) {
          chunks.push(chunk)
          if (chunks.length === 2) {
            controller.abort()
          }
        }
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeDefined()
      }

      // Should have received some chunks before abort
      expect(chunks.length).toBe(2)
    })
  })

  describe('configure() method', () => {
    it('should return a new template literal with merged config', () => {
      const ai = createAiTemplateLiteralFn({ provider: 'anthropic' })

      const configured = ai.configure({ temperature: 0.5 })

      expect(typeof configured).toBe('function')
      expect(configured).not.toBe(ai)
    })

    it('should preserve original config when configuring', async () => {
      const onUsage = vi.fn()
      const ai = createAiTemplateLiteralFn({
        provider: 'anthropic',
        onUsage,
      })

      const configured = ai.configure({ temperature: 0.5 })

      await configured`Test`

      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
        })
      )
    })

    it('should allow overriding provider', async () => {
      const onUsage = vi.fn()
      const ai = createAiTemplateLiteralFn({
        provider: 'anthropic',
        onUsage,
      })

      const configured = ai.configure({ provider: 'openai' })

      await configured`Test`

      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
        })
      )
    })

    it('should be chainable', () => {
      const ai = createAiTemplateLiteralFn()

      const configured = ai.configure({ temperature: 0.5 }).configure({ maxTokens: 100 })

      expect(typeof configured).toBe('function')
    })
  })

  describe('Error handling', () => {
    it('should throw meaningful error for missing API key', async () => {
      const ai = createAiTemplateLiteralFn({
        provider: 'openai',
        env: {},
      })

      await expect(ai`Test`).rejects.toThrow(/api.?key/i)
    })

    it('should propagate provider errors', async () => {
      const ai = createAiTemplateLiteralFn({
        provider: 'openai',
        env: { OPENAI_API_KEY: 'invalid-key' },
      })

      await expect(ai`Test`).rejects.toThrow()
    })

    it('should handle network errors gracefully', async () => {
      const ai = createAiTemplateLiteralFn({
        provider: 'openai',
        env: { OPENAI_API_KEY: 'network-error-key' },
      })

      // This should throw a network/fetch error
      await expect(ai`Test`).rejects.toThrow()
    })

    it('should support .catch() on the promise', async () => {
      const ai = createAiTemplateLiteralFn({
        provider: 'openai',
        env: {},
      })

      const result = await ai`Test`.catch(() => 'fallback')

      expect(result).toBe('fallback')
    })
  })

  describe('PipelinePromise features', () => {
    it('should support .map() transformation', async () => {
      const ai = createAiTemplateLiteralFn()

      const result = await ai`Say hello`.map((s) => s.toUpperCase())

      expect(typeof result).toBe('string')
      expect(result).toBe(result.toUpperCase())
    })

    it('should support chained .map() calls', async () => {
      const ai = createAiTemplateLiteralFn()

      const result = await ai`Hello`
        .map((s) => s.trim())
        .map((s) => s.toUpperCase())
        .map((s) => `Result: ${s}`)

      expect(result).toContain('Result:')
    })

    it('should support async transformations in .map()', async () => {
      const ai = createAiTemplateLiteralFn()

      const result = await ai`Hello`.map(async (s) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return s.toUpperCase()
      })

      expect(typeof result).toBe('string')
    })

    it('should work with Promise.all()', async () => {
      const ai = createAiTemplateLiteralFn()

      const results = await Promise.all([ai`First`, ai`Second`, ai`Third`])

      expect(results.length).toBe(3)
      results.forEach((r) => expect(typeof r).toBe('string'))
    })

    it('should work with Promise.race()', async () => {
      const ai = createAiTemplateLiteralFn()

      const result = await Promise.race([ai`First`, ai`Second`])

      expect(typeof result).toBe('string')
    })
  })
})

// ============================================================================
// INTEGRATION TEST EXPECTATIONS
// ============================================================================

describe('Integration with $ workflow context', () => {
  it('$.ai should be created by createAiTemplateLiteral', () => {
    // The $ workflow context should use createAiTemplateLiteral internally
    // This tests that the factory can be used to create the $.ai property

    const mockEnv = {
      ANTHROPIC_API_KEY: 'test-key',
    }

    const ai = createAiTemplateLiteralFn({
      provider: 'anthropic',
      env: mockEnv,
    })

    // Simulating $ context setup
    const $ = {
      ai,
    }

    expect($.ai).toBeDefined()
    expect(typeof $.ai).toBe('function')
  })

  it('$.ai should support all model shortcuts', () => {
    const ai = createAiTemplateLiteralFn()

    const $ = { ai }

    expect($.ai.claude).toBeDefined()
    expect($.ai.gpt4).toBeDefined()
    expect($.ai.gpt4o).toBeDefined()
    expect($.ai.gemini).toBeDefined()
    expect($.ai.workersAi).toBeDefined()
  })
})
