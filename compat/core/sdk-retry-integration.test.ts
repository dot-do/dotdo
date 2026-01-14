/**
 * @dotdo/compat/core - SDK Retry Integration Tests
 *
 * These tests verify that compat SDKs use the centralized retry handler
 * from compat/core/retry.ts instead of custom retry implementations.
 *
 * TDD Approach:
 * - RED: These tests should fail because SDKs have their own retry logic
 * - GREEN: Integrate createRetryHandler() into each SDK
 * - REFACTOR: Clean up and ensure consistent configuration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// =============================================================================
// Test that SDKs export retry configuration options
// =============================================================================

describe('SDK Retry Integration', () => {
  describe('OpenAI SDK', () => {
    it('should use RetryHandler from compat/core/retry', async () => {
      // Import the OpenAI SDK
      const { OpenAI } = await import('../openai/openai')

      // The SDK should expose a way to get the retry handler
      const client = new OpenAI({ apiKey: 'test-key' })

      // Check that the client has a retry handler property
      expect(client).toHaveProperty('_retryHandler')
    })

    it('should accept retry configuration in constructor', async () => {
      const { OpenAI } = await import('../openai/openai')

      // Should accept retry config
      const client = new OpenAI({
        apiKey: 'test-key',
        retry: {
          maxRetries: 5,
          initialDelay: 500,
          maxDelay: 10000,
        },
      })

      expect(client).toBeDefined()
    })

    it('should emit retry events through the retry handler', async () => {
      const { OpenAI } = await import('../openai/openai')

      const client = new OpenAI({ apiKey: 'test-key' })

      // Should be able to subscribe to retry events
      const retryHandler = (client as any)._retryHandler
      expect(retryHandler).toBeDefined()
      expect(typeof retryHandler.onRetry).toBe('function')
    })

    it('should use circuit breaker for cascading failure protection', async () => {
      const { OpenAI } = await import('../openai/openai')

      const client = new OpenAI({
        apiKey: 'test-key',
        retry: {
          circuitBreaker: {
            failureThreshold: 5,
            cooldownPeriod: 30000,
            successThreshold: 1,
          },
        },
      })

      const retryHandler = (client as any)._retryHandler
      expect(retryHandler.getCircuitState()).toBe('closed')
    })
  })

  describe('Anthropic SDK', () => {
    it('should use RetryHandler from compat/core/retry', async () => {
      const { Anthropic } = await import('../anthropic/anthropic')

      const client = new Anthropic({ apiKey: 'test-key' })

      expect(client).toHaveProperty('_retryHandler')
    })

    it('should accept retry configuration in constructor', async () => {
      const { Anthropic } = await import('../anthropic/anthropic')

      const client = new Anthropic({
        apiKey: 'test-key',
        retry: {
          maxRetries: 3,
          initialDelay: 1000,
          maxDelay: 30000,
        },
      })

      expect(client).toBeDefined()
    })

    it('should emit retry events through the retry handler', async () => {
      const { Anthropic } = await import('../anthropic/anthropic')

      const client = new Anthropic({ apiKey: 'test-key' })

      const retryHandler = (client as any)._retryHandler
      expect(retryHandler).toBeDefined()
      expect(typeof retryHandler.onRetry).toBe('function')
    })
  })

  describe('Stripe SDK', () => {
    it('should use RetryHandler from compat/core/retry', async () => {
      const { Stripe } = await import('../stripe/stripe')

      const client = new Stripe('sk_test_xxx')

      expect(client).toHaveProperty('_retryHandler')
    })

    it('should accept retry configuration in constructor', async () => {
      const { Stripe } = await import('../stripe/stripe')

      const client = new Stripe('sk_test_xxx', {
        retry: {
          maxRetries: 2,
          initialDelay: 500,
          maxDelay: 8000,
        },
      })

      expect(client).toBeDefined()
    })

    it('should emit retry events through the retry handler', async () => {
      const { Stripe } = await import('../stripe/stripe')

      const client = new Stripe('sk_test_xxx')

      const retryHandler = (client as any)._retryHandler
      expect(retryHandler).toBeDefined()
      expect(typeof retryHandler.onRetry).toBe('function')
    })
  })

  describe('Slack SDK', () => {
    it('should use RetryHandler from compat/core/retry', async () => {
      const { WebClient } = await import('../slack/client')

      const client = new WebClient('xoxb-test')

      expect(client).toHaveProperty('_retryHandler')
    })

    it('should accept retry configuration in constructor', async () => {
      const { WebClient } = await import('../slack/client')

      const client = new WebClient('xoxb-test', {
        retry: {
          maxRetries: 3,
          initialDelay: 1000,
          maxDelay: 30000,
        },
      })

      expect(client).toBeDefined()
    })

    it('should emit retry events through the retry handler', async () => {
      const { WebClient } = await import('../slack/client')

      const client = new WebClient('xoxb-test')

      const retryHandler = (client as any)._retryHandler
      expect(retryHandler).toBeDefined()
      expect(typeof retryHandler.onRetry).toBe('function')
    })
  })
})

// =============================================================================
// Test retry behavior with mocked fetch
// =============================================================================

describe('SDK Retry Behavior', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe('OpenAI SDK retry behavior', () => {
    it('should retry on 429 rate limit with Retry-After header', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Rate limited' } }), {
          status: 429,
          headers: { 'Retry-After': '1' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          id: 'chatcmpl-123',
          choices: [{ message: { content: 'Hello' } }],
          usage: { total_tokens: 10 },
        }), { status: 200 }))

      globalThis.fetch = fetchMock

      const { OpenAI } = await import('../openai/openai')
      const client = new OpenAI({
        apiKey: 'test-key',
        retry: { maxRetries: 3 },
      })

      // Should succeed after retry
      const result = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(result.choices[0].message.content).toBe('Hello')
    })

    it('should use centralized retry handler for exponential backoff', async () => {
      const delays: number[] = []
      const fetchMock = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          id: 'chatcmpl-123',
          choices: [{ message: { content: 'Hello' } }],
          usage: { total_tokens: 10 },
        }), { status: 200 }))

      globalThis.fetch = fetchMock

      const { OpenAI } = await import('../openai/openai')
      const client = new OpenAI({
        apiKey: 'test-key',
        retry: {
          maxRetries: 3,
          initialDelay: 100,
          multiplier: 2,
          jitter: 0,
        },
      })

      // Subscribe to retry events to capture delays
      const retryHandler = (client as any)._retryHandler
      retryHandler.onRetry((event: any) => {
        if (event.type === 'retry' && event.delay) {
          delays.push(event.delay)
        }
      })

      const result = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(result).toBeDefined()
      // Verify exponential backoff: 100ms, 200ms
      expect(delays[0]).toBe(100)
      expect(delays[1]).toBe(200)
    })
  })

  describe('Anthropic SDK retry behavior', () => {
    it('should retry on 529 overloaded status', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({
          error: { type: 'overloaded_error', message: 'Overloaded' },
        }), { status: 529 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          id: 'msg-123',
          content: [{ type: 'text', text: 'Hello' }],
          usage: { input_tokens: 5, output_tokens: 5 },
        }), { status: 200 }))

      globalThis.fetch = fetchMock

      const { Anthropic } = await import('../anthropic/anthropic')
      const client = new Anthropic({
        apiKey: 'test-key',
        retry: { maxRetries: 3 },
      })

      const result = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(result.content[0].text).toBe('Hello')
    })
  })

  describe('Stripe SDK retry behavior', () => {
    it('should retry on idempotent requests with 500 errors', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({
          error: { type: 'api_error', message: 'Internal error' },
        }), { status: 500 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          id: 'cus_123',
          object: 'customer',
          email: 'test@example.com',
        }), { status: 200 }))

      globalThis.fetch = fetchMock

      const { Stripe } = await import('../stripe/stripe')
      const client = new Stripe('sk_test_xxx', {
        retry: { maxRetries: 3 },
      })

      const result = await client.customers.create({
        email: 'test@example.com',
      })

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(result.id).toBe('cus_123')
    })
  })

  describe('Slack SDK retry behavior', () => {
    it('should retry on rate_limited error with Retry-After', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({
          ok: false,
          error: 'rate_limited',
        }), {
          status: 429,
          headers: { 'Retry-After': '1' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          ok: true,
          channel: 'C123',
          ts: '1234567890.123456',
        }), { status: 200 }))

      globalThis.fetch = fetchMock

      const { WebClient } = await import('../slack/client')
      const client = new WebClient('xoxb-test', {
        retry: { maxRetries: 3 },
      })

      const result = await client.chat.postMessage({
        channel: 'C123',
        text: 'Hello',
      })

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(result.ok).toBe(true)
    })
  })
})

// =============================================================================
// Test circuit breaker integration
// =============================================================================

describe('Circuit Breaker Integration', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('OpenAI SDK should open circuit after consecutive failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Server error' } }), { status: 500 })
    )

    globalThis.fetch = fetchMock

    const { OpenAI } = await import('../openai/openai')
    const client = new OpenAI({
      apiKey: 'test-key',
      retry: {
        maxRetries: 0, // No retries to speed up test
        circuitBreaker: {
          failureThreshold: 3,
          cooldownPeriod: 30000,
          successThreshold: 1,
        },
      },
    })

    // Make 3 failing requests to open the circuit
    for (let i = 0; i < 3; i++) {
      try {
        await client.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      } catch {
        // Expected to fail
      }
    }

    // Circuit should now be open
    const retryHandler = (client as any)._retryHandler
    expect(retryHandler.getCircuitState()).toBe('open')

    // Next request should fail immediately with circuit open
    await expect(
      client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      })
    ).rejects.toThrow(/circuit/i)
  })
})
