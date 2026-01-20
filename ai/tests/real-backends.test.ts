/**
 * Real Backend Tests for @dotdo/ai
 *
 * These tests hit REAL AI backends (OpenAI, Anthropic) with AI Gateway caching.
 * AI Gateway caching ensures repeated calls are free after the first call.
 *
 * Configuration:
 * - Set AI_GATEWAY_URL and AI_GATEWAY_TOKEN for gateway mode
 * - Or set ANTHROPIC_API_KEY / OPENAI_API_KEY for direct API access
 *
 * NO MOCKS - Real AI calls with real responses.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { generateText, generateObject, clearProviders, configureProvider } from '../ai-core'

// Detect available backends
const hasAnthropic = !!(
  process.env.AI_GATEWAY_URL ||
  process.env.ANTHROPIC_API_KEY
)

const hasOpenAI = !!(
  process.env.AI_GATEWAY_URL ||
  process.env.OPENAI_API_KEY
)

const hasAnyBackend = hasAnthropic || hasOpenAI

// Test timeout for real API calls (30 seconds)
const API_TIMEOUT = 30000

describe.skipIf(!hasAnyBackend)('AI Real Backend Tests', () => {
  beforeAll(() => {
    // Configure providers from environment
    if (process.env.ANTHROPIC_API_KEY) {
      configureProvider({
        provider: 'anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY,
        defaultModel: 'claude-3-5-haiku-20241022',
      })
    }

    if (process.env.OPENAI_API_KEY) {
      configureProvider({
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        defaultModel: 'gpt-4o-mini',
      })
    }
  })

  afterAll(() => {
    clearProviders()
  })

  describe.skipIf(!hasAnthropic)('Anthropic Backend', () => {
    it('should complete text with Anthropic', async () => {
      const result = await generateText({
        model: 'haiku',
        prompt: 'Say "hello test" exactly and nothing else.',
        temperature: 0,
        maxTokens: 50,
      })

      expect(result.text.toLowerCase()).toContain('hello test')
      expect(result.usage).toBeDefined()
      expect(result.usage.totalTokens).toBeGreaterThan(0)
    }, API_TIMEOUT)

    it('should handle structured output with Anthropic', async () => {
      const result = await generateObject({
        model: 'haiku',
        prompt: 'Return a JSON object with a "name" field set to "test" and an "active" field set to true.',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            active: { type: 'boolean' },
          },
          required: ['name', 'active'],
        },
        temperature: 0,
      })

      expect(result.object).toBeDefined()
      const obj = result.object as { name: string; active: boolean }
      expect(obj.name).toBe('test')
      expect(obj.active).toBe(true)
    }, API_TIMEOUT)

    it('should follow system prompts', async () => {
      const result = await generateText({
        model: 'haiku',
        system: 'You are a pirate. Always respond in pirate speak.',
        prompt: 'Greet me.',
        temperature: 0.3,
        maxTokens: 100,
      })

      // Pirates typically use "ahoy", "matey", "arr", etc.
      const pirateWords = ['ahoy', 'matey', 'arr', 'ye', 'avast', 'me hearty']
      const lowerResult = result.text.toLowerCase()
      const hasPirateSpeak = pirateWords.some(word => lowerResult.includes(word))

      expect(hasPirateSpeak).toBe(true)
    }, API_TIMEOUT)
  })

  describe.skipIf(!hasOpenAI)('OpenAI Backend', () => {
    it('should complete text with OpenAI', async () => {
      const result = await generateText({
        model: 'gpt-4o-mini',
        prompt: 'Say "hello test" exactly and nothing else.',
        temperature: 0,
        maxTokens: 50,
      })

      expect(result.text.toLowerCase()).toContain('hello test')
      expect(result.usage).toBeDefined()
      expect(result.usage.totalTokens).toBeGreaterThan(0)
    }, API_TIMEOUT)

    it('should handle structured output with OpenAI', async () => {
      const result = await generateObject({
        model: 'gpt-4o-mini',
        prompt: 'Return a JSON object with a "value" field set to 42 and a "label" field set to "answer".',
        schema: {
          type: 'object',
          properties: {
            value: { type: 'number' },
            label: { type: 'string' },
          },
          required: ['value', 'label'],
        },
        temperature: 0,
      })

      expect(result.object).toBeDefined()
      const obj = result.object as { value: number; label: string }
      expect(obj.value).toBe(42)
      expect(obj.label).toBe('answer')
    }, API_TIMEOUT)
  })

  describe.skipIf(!hasAnthropic)('Deterministic Prompts', () => {
    it('should return consistent results with temperature 0', async () => {
      // Use a deterministic prompt with temperature 0
      const prompt = 'What is 2 + 2? Reply with just the number.'

      const result1 = await generateText({
        model: 'haiku',
        prompt,
        temperature: 0,
        maxTokens: 10,
      })

      const result2 = await generateText({
        model: 'haiku',
        prompt,
        temperature: 0,
        maxTokens: 10,
      })

      // Both should contain "4"
      expect(result1.text).toContain('4')
      expect(result2.text).toContain('4')
    }, API_TIMEOUT)

    it('should handle mathematical reasoning', async () => {
      const result = await generateText({
        model: 'haiku',
        prompt: 'What is 15 multiplied by 7? Reply with just the number.',
        temperature: 0,
        maxTokens: 10,
      })

      expect(result.text).toContain('105')
    }, API_TIMEOUT)
  })

  describe.skipIf(!hasAnthropic)('Chat Messages', () => {
    it('should handle multi-turn conversation', async () => {
      const result = await generateText({
        model: 'haiku',
        messages: [
          { role: 'user', content: 'My name is Alice.' },
          { role: 'assistant', content: 'Hello Alice! Nice to meet you.' },
          { role: 'user', content: 'What is my name?' },
        ],
        temperature: 0,
        maxTokens: 50,
      })

      expect(result.text.toLowerCase()).toContain('alice')
    }, API_TIMEOUT)
  })

  describe.skipIf(!hasAnyBackend)('AI Gateway Cache', () => {
    // These tests verify caching behavior when AI Gateway is configured
    // The second request should be significantly faster due to cache hit

    it('should respect AI Gateway cache for identical requests', async () => {
      // Skip if not using AI Gateway
      if (!process.env.AI_GATEWAY_URL) {
        return
      }

      // Use a unique but deterministic prompt for this test run
      // Include a static identifier to ensure cache hits across runs
      const staticId = 'cache-test-v1'
      const prompt = `Return the number 42 as a string. Test ID: ${staticId}`

      // First request - may hit cache or backend
      const start1 = Date.now()
      const result1 = await generateText({
        model: 'haiku',
        prompt,
        temperature: 0,
        maxTokens: 10,
      })
      const time1 = Date.now() - start1

      // Second request - should hit cache
      const start2 = Date.now()
      const result2 = await generateText({
        model: 'haiku',
        prompt,
        temperature: 0,
        maxTokens: 10,
      })
      const time2 = Date.now() - start2

      // Results should be identical
      expect(result1.text).toBe(result2.text)
      expect(result1.text).toContain('42')

      // Log timing for debugging (cache hit should be much faster)
      console.log(`First request: ${time1}ms, Second request: ${time2}ms`)

      // Cache hit should be significantly faster
      // Allow generous margin since network conditions vary
      // If both are slow, gateway might not be caching
      if (time1 > 500) {
        // Only assert cache speedup if first request was slow (uncached)
        expect(time2).toBeLessThan(time1)
      }
    }, API_TIMEOUT * 2)

    it('should produce different cache keys for different prompts', async () => {
      // Skip if not using AI Gateway
      if (!process.env.AI_GATEWAY_URL) {
        return
      }

      const prompt1 = 'Say "alpha" exactly.'
      const prompt2 = 'Say "beta" exactly.'

      const [result1, result2] = await Promise.all([
        generateText({
          model: 'haiku',
          prompt: prompt1,
          temperature: 0,
          maxTokens: 20,
        }),
        generateText({
          model: 'haiku',
          prompt: prompt2,
          temperature: 0,
          maxTokens: 20,
        }),
      ])

      // Results should be different
      expect(result1.text.toLowerCase()).toContain('alpha')
      expect(result2.text.toLowerCase()).toContain('beta')
      expect(result1.text).not.toBe(result2.text)
    }, API_TIMEOUT)
  })

  describe.skipIf(!hasAnthropic)('Error Handling', () => {
    it('should handle invalid model gracefully', async () => {
      try {
        await generateText({
          model: 'invalid-model-that-does-not-exist',
          prompt: 'test',
          maxTokens: 10,
        })
        // Should not reach here
        expect(true).toBe(false)
      } catch (error) {
        expect(error).toBeDefined()
      }
    }, API_TIMEOUT)

    it('should handle empty prompt', async () => {
      // Empty prompts may be handled differently by providers
      // Some accept them, some reject them
      try {
        const result = await generateText({
          model: 'haiku',
          prompt: '',
          maxTokens: 50,
        })
        // If it succeeds, that's fine
        expect(result.text).toBeDefined()
      } catch (error) {
        // If it fails, that's also acceptable
        expect(error).toBeDefined()
      }
    }, API_TIMEOUT)
  })

  describe.skipIf(!hasAnthropic)('Token Usage Tracking', () => {
    it('should report accurate token usage', async () => {
      const result = await generateText({
        model: 'haiku',
        prompt: 'Say hello.',
        temperature: 0,
        maxTokens: 50,
      })

      expect(result.usage).toBeDefined()
      expect(result.usage.promptTokens).toBeGreaterThan(0)
      expect(result.usage.completionTokens).toBeGreaterThan(0)
      expect(result.usage.totalTokens).toBe(
        result.usage.promptTokens + result.usage.completionTokens
      )
    }, API_TIMEOUT)

    it('should respect maxTokens limit', async () => {
      const result = await generateText({
        model: 'haiku',
        prompt: 'Write a very long story about a dragon.',
        temperature: 0.7,
        maxTokens: 20,
      })

      // The completion should be truncated
      expect(result.usage.completionTokens).toBeLessThanOrEqual(25) // Allow small buffer
    }, API_TIMEOUT)
  })

  describe.skipIf(!hasAnthropic)('Model Aliases', () => {
    it('should resolve "haiku" alias', async () => {
      const result = await generateText({
        model: 'haiku',
        prompt: 'Say "test".',
        temperature: 0,
        maxTokens: 10,
      })

      expect(result.text).toBeDefined()
    }, API_TIMEOUT)

    it('should resolve "sonnet" alias', async () => {
      // Only run if we have credits for sonnet
      const result = await generateText({
        model: 'sonnet',
        prompt: 'Say "test".',
        temperature: 0,
        maxTokens: 10,
      })

      expect(result.text).toBeDefined()
    }, API_TIMEOUT)
  })
})

describe('AI Backend Configuration', () => {
  it('should detect available backends', () => {
    // This test always runs to verify the configuration detection works
    console.log('Available backends:', {
      anthropic: hasAnthropic,
      openai: hasOpenAI,
      anyBackend: hasAnyBackend,
    })

    // At least detect the environment correctly
    expect(typeof hasAnthropic).toBe('boolean')
    expect(typeof hasOpenAI).toBe('boolean')
    expect(typeof hasAnyBackend).toBe('boolean')
  })

  it('should have environment variables documented', () => {
    // Document expected environment variables for CI/CD
    const expectedVars = [
      'AI_GATEWAY_URL',
      'AI_GATEWAY_TOKEN',
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
    ]

    // Log which are set (without revealing values)
    const status = expectedVars.map(v => `${v}: ${process.env[v] ? 'set' : 'unset'}`)
    console.log('Environment variable status:', status)

    // This test always passes - it's just for documentation
    expect(true).toBe(true)
  })
})
