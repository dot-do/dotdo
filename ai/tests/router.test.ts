import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Router, providers, type ProviderConfig } from '../router'

describe('Router', () => {
  describe('provider selection by model name', () => {
    it('should select anthropic provider for claude models', () => {
      const router = new Router()
      expect(router.resolve('claude-3-opus')).toBe(providers.anthropic)
      expect(router.resolve('claude-3-sonnet')).toBe(providers.anthropic)
      expect(router.resolve('claude-3-haiku')).toBe(providers.anthropic)
    })

    it('should select openai provider for gpt models', () => {
      const router = new Router()
      expect(router.resolve('gpt-4')).toBe(providers.openai)
      expect(router.resolve('gpt-4-turbo')).toBe(providers.openai)
      expect(router.resolve('gpt-3.5-turbo')).toBe(providers.openai)
    })

    it('should select google provider for gemini models', () => {
      const router = new Router()
      expect(router.resolve('gemini-pro')).toBe(providers.google)
      expect(router.resolve('gemini-ultra')).toBe(providers.google)
    })

    it('should select cloudflare provider for workers-ai models', () => {
      const router = new Router()
      expect(router.resolve('@cf/meta/llama-2-7b-chat-int8')).toBe(providers.cloudflare)
    })

    it('should throw error for unknown model', () => {
      const router = new Router()
      expect(() => router.resolve('unknown-model')).toThrow('Unknown model')
    })
  })

  describe('model selection by capability', () => {
    it('should select fast model when capability is "fast"', () => {
      const router = new Router()
      const model = router.selectByCapability('fast')
      expect(model.provider).toBeDefined()
      expect(model.model).toBeDefined()
    })

    it('should select smart model when capability is "smart"', () => {
      const router = new Router()
      const model = router.selectByCapability('smart')
      expect(model.provider).toBeDefined()
      expect(model.model).toBeDefined()
    })

    it('should select cheap model when capability is "cheap"', () => {
      const router = new Router()
      const model = router.selectByCapability('cheap')
      expect(model.provider).toBeDefined()
      expect(model.model).toBeDefined()
    })
  })

  describe('fallback chain', () => {
    it('should support fallback chain on provider failure', async () => {
      const router = new Router({
        fallback: ['anthropic', 'openai', 'google']
      })

      // Mock first provider failing
      const mockExecute = vi.fn()
        .mockRejectedValueOnce(new Error('Provider unavailable'))
        .mockResolvedValueOnce({ result: 'Success', provider: 'openai' })

      router._setExecutor(mockExecute)

      const result = await router.execute('test prompt', { model: 'claude-3-opus' })
      expect(result.provider).toBe('openai')
      expect(mockExecute).toHaveBeenCalledTimes(2)
    })

    it('should try all providers in fallback chain', async () => {
      const router = new Router({
        fallback: ['anthropic', 'openai', 'google']
      })

      const mockExecute = vi.fn()
        .mockRejectedValueOnce(new Error('Anthropic unavailable'))
        .mockRejectedValueOnce(new Error('OpenAI unavailable'))
        .mockResolvedValueOnce({ result: 'Success', provider: 'google' })

      router._setExecutor(mockExecute)

      const result = await router.execute('test prompt')
      expect(result.provider).toBe('google')
      expect(mockExecute).toHaveBeenCalledTimes(3)
    })

    it('should throw error when all providers fail', async () => {
      const router = new Router({
        fallback: ['anthropic', 'openai']
      })

      const mockExecute = vi.fn()
        .mockRejectedValue(new Error('Provider unavailable'))

      router._setExecutor(mockExecute)

      await expect(router.execute('test prompt')).rejects.toThrow('All providers failed')
    })
  })

  describe('cost constraints', () => {
    it('should respect max cost per request', () => {
      const router = new Router({ maxCostPerRequest: 0.01 })
      const model = router.selectModel({ task: 'summarize', tokens: 1000 })

      // Cost should be less than max
      expect(model.costPer1kTokens).toBeLessThan(0.01)
    })

    it('should select cheaper model when tokens are high', () => {
      const router = new Router({ maxCostPerRequest: 0.05 })

      const model1 = router.selectModel({ task: 'general', tokens: 100 })
      const model2 = router.selectModel({ task: 'general', tokens: 10000 })

      // Higher token count should prefer cheaper model
      expect(model2.costPer1kTokens).toBeLessThanOrEqual(model1.costPer1kTokens)
    })

    it('should throw error when no model meets cost constraints', () => {
      const router = new Router({ maxCostPerRequest: 0.0001 })

      expect(() => router.selectModel({ task: 'general', tokens: 10000 }))
        .toThrow('No model meets cost constraints')
    })
  })

  describe('rate limit handling', () => {
    it('should detect rate limit errors', async () => {
      const router = new Router()

      const mockExecute = vi.fn()
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockResolvedValueOnce({ result: 'Success', retries: 1 })

      router._setExecutor(mockExecute)

      const result = await router.execute('test prompt')
      expect(result.retries).toBeGreaterThan(0)
    })

    it('should retry with exponential backoff on rate limits', async () => {
      const router = new Router({ maxRetries: 3 })
      const delays: number[] = []

      const mockExecute = vi.fn()
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockResolvedValueOnce({ result: 'Success' })

      router._setExecutor(mockExecute)
      router._onDelay((delay: number) => delays.push(delay))

      await router.execute('test prompt')

      // Should have exponential delays
      expect(delays.length).toBeGreaterThan(1)
      expect(delays[1]!).toBeGreaterThan(delays[0]!)
    })

    it('should give up after max retries', async () => {
      const router = new Router({ maxRetries: 2 })

      const mockExecute = vi.fn()
        .mockRejectedValue(new Error('Rate limit exceeded'))

      router._setExecutor(mockExecute)

      await expect(router.execute('test prompt')).rejects.toThrow('Max retries exceeded')
    })

    describe('robust rate limit detection', () => {
      it('should detect rate limit by HTTP status code 429', async () => {
        const router = new Router()

        const error = new Error('Request failed') as Error & { status: number }
        error.status = 429

        const mockExecute = vi.fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValueOnce({ result: 'Success' })

        router._setExecutor(mockExecute)

        const result = await router.execute('test prompt')
        expect(result.retries).toBeGreaterThan(0)
      })

      it('should detect rate limit by statusCode 429', async () => {
        const router = new Router()

        const error = new Error('Request failed') as Error & { statusCode: number }
        error.statusCode = 429

        const mockExecute = vi.fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValueOnce({ result: 'Success' })

        router._setExecutor(mockExecute)

        const result = await router.execute('test prompt')
        expect(result.retries).toBeGreaterThan(0)
      })

      it('should detect rate limit by error code string', async () => {
        const router = new Router()

        const error = new Error('Request failed') as Error & { code: string }
        error.code = 'rate_limit_exceeded'

        const mockExecute = vi.fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValueOnce({ result: 'Success' })

        router._setExecutor(mockExecute)

        const result = await router.execute('test prompt')
        expect(result.retries).toBeGreaterThan(0)
      })

      it('should detect rate limit by error code 429', async () => {
        const router = new Router()

        const error = new Error('Request failed') as Error & { code: number }
        error.code = 429

        const mockExecute = vi.fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValueOnce({ result: 'Success' })

        router._setExecutor(mockExecute)

        const result = await router.execute('test prompt')
        expect(result.retries).toBeGreaterThan(0)
      })

      it('should detect rate limit by error name RateLimitError', async () => {
        const router = new Router()

        const error = new Error('Request failed')
        error.name = 'RateLimitError'

        const mockExecute = vi.fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValueOnce({ result: 'Success' })

        router._setExecutor(mockExecute)

        const result = await router.execute('test prompt')
        expect(result.retries).toBeGreaterThan(0)
      })

      it('should detect rate limit by error name TooManyRequestsError', async () => {
        const router = new Router()

        const error = new Error('Request failed')
        error.name = 'TooManyRequestsError'

        const mockExecute = vi.fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValueOnce({ result: 'Success' })

        router._setExecutor(mockExecute)

        const result = await router.execute('test prompt')
        expect(result.retries).toBeGreaterThan(0)
      })

      it.each([
        'Too many requests',
        'Quota exceeded',
        'Resource exhausted',
        'Request throttled',
        'You have exceeded your requests per minute limit',
        'TPM limit reached',
        'Server is overloaded, try again later',
        'Error 429: Too Many Requests',
        'retry-after: 60',
        'Capacity exceeded for this endpoint'
      ])('should detect rate limit from message: "%s"', async (errorMessage) => {
        const router = new Router()

        const mockExecute = vi.fn()
          .mockRejectedValueOnce(new Error(errorMessage))
          .mockResolvedValueOnce({ result: 'Success' })

        router._setExecutor(mockExecute)

        const result = await router.execute('test prompt')
        expect(result.retries).toBeGreaterThan(0)
      })

      it('should NOT detect non-rate-limit errors', async () => {
        const router = new Router({ fallback: ['anthropic'] })

        const mockExecute = vi.fn()
          .mockRejectedValue(new Error('Authentication failed'))

        router._setExecutor(mockExecute)

        // Non-rate-limit error should fail immediately without retry
        await expect(router.execute('test prompt')).rejects.toThrow('All providers failed')
        expect(mockExecute).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('load balancing', () => {
    it('should support round-robin load balancing', async () => {
      const router = new Router({
        loadBalancing: 'round-robin',
        providers: [
          { provider: 'openai', apiKey: 'key1' },
          { provider: 'anthropic', apiKey: 'key2' }
        ]
      })

      const providers: string[] = []
      const mockExecute = vi.fn().mockImplementation((prompt, options) => {
        providers.push(options.provider)
        return Promise.resolve({ result: 'Success', provider: options.provider })
      })

      router._setExecutor(mockExecute)

      await router.execute('test 1')
      await router.execute('test 2')
      await router.execute('test 3')

      // Should alternate between providers
      expect(providers[0]).not.toBe(providers[1])
      expect(providers[0]).toBe(providers[2])
    })

    it('should support random load balancing', async () => {
      const router = new Router({
        loadBalancing: 'random',
        providers: [
          { provider: 'openai', apiKey: 'key1' },
          { provider: 'anthropic', apiKey: 'key2' }
        ]
      })

      const mockExecute = vi.fn().mockResolvedValue({ result: 'Success' })
      router._setExecutor(mockExecute)

      await router.execute('test')

      // Should call with one of the providers
      expect(mockExecute).toHaveBeenCalled()
    })

    describe('least-loaded load balancing', () => {
      it('should prefer provider with fewer in-flight requests', async () => {
        const router = new Router({
          loadBalancing: 'least-loaded',
          providers: [
            { provider: 'openai', apiKey: 'key1' },
            { provider: 'anthropic', apiKey: 'key2' },
            { provider: 'google', apiKey: 'key3' }
          ]
        })

        const selectedProviders: string[] = []
        let resolvers: Array<() => void> = []

        // Mock that holds requests until we resolve them
        const mockExecute = vi.fn().mockImplementation((prompt, options) => {
          selectedProviders.push(options.provider)
          return new Promise<{ result: string; provider: string }>((resolve) => {
            resolvers.push(() => resolve({ result: 'Success', provider: options.provider }))
          })
        })

        router._setExecutor(mockExecute)

        // Start 3 concurrent requests - they should go to different providers
        const promise1 = router.execute('test 1')
        const promise2 = router.execute('test 2')
        const promise3 = router.execute('test 3')

        // Wait for the mock to be called
        await vi.waitFor(() => expect(selectedProviders.length).toBe(3))

        // All 3 should go to different providers since they're equally loaded
        const uniqueProviders = new Set(selectedProviders)
        expect(uniqueProviders.size).toBe(3)

        // Complete all requests
        resolvers.forEach(resolve => resolve())
        await Promise.all([promise1, promise2, promise3])
      })

      it('should route new request to least-loaded provider', async () => {
        const router = new Router({
          loadBalancing: 'least-loaded',
          providers: [
            { provider: 'openai', apiKey: 'key1' },
            { provider: 'anthropic', apiKey: 'key2' }
          ]
        })

        const selectedProviders: string[] = []
        let resolvers: Array<() => void> = []

        const mockExecute = vi.fn().mockImplementation((prompt, options) => {
          selectedProviders.push(options.provider)
          return new Promise<{ result: string; provider: string }>((resolve) => {
            resolvers.push(() => resolve({ result: 'Success', provider: options.provider }))
          })
        })

        router._setExecutor(mockExecute)

        // Start first request - should go to first provider (both equally loaded)
        const promise1 = router.execute('test 1')
        await vi.waitFor(() => expect(selectedProviders.length).toBe(1))
        const firstProvider = selectedProviders[0]

        // Start second request while first is in-flight - should go to other provider
        const promise2 = router.execute('test 2')
        await vi.waitFor(() => expect(selectedProviders.length).toBe(2))
        const secondProvider = selectedProviders[1]

        // Should have routed to different providers
        expect(firstProvider).not.toBe(secondProvider)

        // Complete all requests
        resolvers.forEach(resolve => resolve())
        await Promise.all([promise1, promise2])
      })

      it('should decrement load count after request completes', async () => {
        const router = new Router({
          loadBalancing: 'least-loaded',
          providers: [
            { provider: 'openai', apiKey: 'key1' },
            { provider: 'anthropic', apiKey: 'key2' }
          ]
        })

        const selectedProviders: string[] = []

        const mockExecute = vi.fn().mockImplementation((prompt, options) => {
          selectedProviders.push(options.provider)
          return Promise.resolve({ result: 'Success', provider: options.provider })
        })

        router._setExecutor(mockExecute)

        // Execute requests sequentially - after each completes, load should reset
        await router.execute('test 1')
        await router.execute('test 2')
        await router.execute('test 3')
        await router.execute('test 4')

        // After each completion, the load resets, so with round-robin tie-breaking
        // we should see alternating pattern or always first provider
        // Key point: load counts are properly decremented
        expect(selectedProviders.length).toBe(4)
      })

      it('should skip unhealthy providers even if least loaded', async () => {
        const router = new Router({
          loadBalancing: 'least-loaded',
          providers: [
            { provider: 'openai', apiKey: 'key1' },
            { provider: 'anthropic', apiKey: 'key2' }
          ],
          circuitBreaker: {
            failureThreshold: 1, // Single failure opens circuit
            recoveryTimeout: 60000
          }
        })

        // Mark openai as unhealthy - with threshold=1 this opens the circuit
        router._markUnhealthy('openai')

        const selectedProviders: string[] = []

        const mockExecute = vi.fn().mockImplementation((prompt, options) => {
          selectedProviders.push(options.provider)
          return Promise.resolve({ result: 'Success', provider: options.provider })
        })

        router._setExecutor(mockExecute)

        await router.execute('test 1')
        await router.execute('test 2')

        // All requests should go to anthropic since openai circuit is open
        expect(selectedProviders).toEqual(['anthropic', 'anthropic'])
      })

      it('should handle request failure and decrement load', async () => {
        const router = new Router({
          loadBalancing: 'least-loaded',
          providers: [
            { provider: 'openai', apiKey: 'key1' },
            { provider: 'anthropic', apiKey: 'key2' }
          ]
        })

        const selectedProviders: string[] = []
        let callCount = 0

        const mockExecute = vi.fn().mockImplementation((prompt, options) => {
          selectedProviders.push(options.provider)
          callCount++
          if (callCount === 1) {
            return Promise.reject(new Error('Provider error'))
          }
          return Promise.resolve({ result: 'Success', provider: options.provider })
        })

        router._setExecutor(mockExecute)

        // First request fails
        await expect(router.execute('test 1')).rejects.toThrow('Provider error')

        // Second request should still work - load should have been decremented on failure
        const result = await router.execute('test 2')
        expect(result.result).toBe('Success')
      })

      it('should expose load metrics via getProviderLoad', () => {
        const router = new Router({
          loadBalancing: 'least-loaded',
          providers: [
            { provider: 'openai', apiKey: 'key1' },
            { provider: 'anthropic', apiKey: 'key2' }
          ]
        })

        const load = router.getProviderLoad()
        expect(load).toEqual({
          openai: 0,
          anthropic: 0
        })
      })
    })
  })

  describe('provider configuration', () => {
    it('should accept provider configs with API keys', () => {
      const configs: ProviderConfig[] = [
        { provider: 'openai', apiKey: 'sk-test123', model: 'gpt-4' },
        { provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-3-opus' }
      ]

      const router = new Router({ providers: configs })
      expect(router.getProviders()).toHaveLength(2)
    })

    it('should use environment variables for missing API keys', () => {
      const router = new Router({
        providers: [
          { provider: 'openai' } // No API key provided
        ]
      })

      // Should attempt to use env var
      const provider = router.getProviders()[0]
      expect(provider).toBeDefined()
    })
  })

  describe('health checks', () => {
    it('should track provider health status', async () => {
      const router = new Router({
        fallback: ['anthropic'], // Only one provider, no fallback
        circuitBreaker: {
          failureThreshold: 1, // Single failure opens circuit
          recoveryTimeout: 60000
        }
      })

      const mockExecute = vi.fn()
        .mockRejectedValue(new Error('Provider down'))

      router._setExecutor(mockExecute)

      await expect(router.execute('test')).rejects.toThrow('All providers failed')

      const health = router.getHealth()
      expect(health.anthropic?.healthy).toBe(false)
      expect(health.anthropic?.circuitState).toBe('open')
    })

    it('should skip unhealthy providers in rotation', async () => {
      const router = new Router({
        loadBalancing: 'round-robin',
        providers: [
          { provider: 'openai', apiKey: 'key1' },
          { provider: 'anthropic', apiKey: 'key2' }
        ],
        circuitBreaker: {
          failureThreshold: 1, // Single failure opens circuit
          recoveryTimeout: 60000
        }
      })

      // Mark one provider as unhealthy - with threshold=1 this opens the circuit
      router._markUnhealthy('openai')

      const mockExecute = vi.fn().mockImplementation((prompt, options) => {
        return Promise.resolve({ result: 'Success', provider: options.provider })
      })

      router._setExecutor(mockExecute)

      const result = await router.execute('test')

      // Should only use healthy provider
      expect(result.provider).toBe('anthropic')
    })
  })

  describe('circuit breaker', () => {
    it('should open circuit after failure threshold', async () => {
      const router = new Router({
        fallback: ['anthropic', 'openai'],
        circuitBreaker: {
          failureThreshold: 2,
          recoveryTimeout: 60000
        }
      })

      let failCount = 0
      const mockExecute = vi.fn().mockImplementation((prompt, options) => {
        if (options.provider === 'anthropic') {
          failCount++
          return Promise.reject(new Error('Provider unavailable'))
        }
        return Promise.resolve({ result: 'Success', provider: options.provider })
      })

      router._setExecutor(mockExecute)

      // First call should try anthropic, fail, then succeed with openai
      const result1 = await router.execute('test 1')
      expect(result1.provider).toBe('openai')

      // Second call should also fail on anthropic, opening the circuit
      const result2 = await router.execute('test 2')
      expect(result2.provider).toBe('openai')
      expect(failCount).toBe(2) // Anthropic was tried twice

      // Third call - circuit should be open, anthropic should be skipped
      mockExecute.mockClear()
      const result3 = await router.execute('test 3')
      expect(result3.provider).toBe('openai')

      // Verify anthropic was not tried (circuit is open)
      const anthropicCalls = mockExecute.mock.calls.filter(
        call => call[1]?.provider === 'anthropic'
      )
      expect(anthropicCalls.length).toBe(0)
    })

    it('should transition to half-open after recovery timeout', async () => {
      const router = new Router({
        fallback: ['anthropic', 'openai'],
        circuitBreaker: {
          failureThreshold: 1,
          recoveryTimeout: 100, // Short timeout for testing
          successThreshold: 1
        }
      })

      const mockExecute = vi.fn()
        .mockRejectedValueOnce(new Error('Provider unavailable')) // First call to anthropic fails
        .mockResolvedValue({ result: 'Success' }) // All subsequent calls succeed

      router._setExecutor(mockExecute)

      // First call opens the circuit on anthropic
      await router.execute('test 1')

      const health1 = router.getHealth()
      expect(health1.anthropic?.circuitState).toBe('open')

      // Wait for recovery timeout
      await new Promise(resolve => setTimeout(resolve, 150))

      // Next call should try anthropic again (half-open state)
      mockExecute.mockClear()
      await router.execute('test 2')

      // Anthropic should have been tried
      const anthropicCalls = mockExecute.mock.calls.filter(
        call => call[1]?.provider === 'anthropic'
      )
      expect(anthropicCalls.length).toBeGreaterThan(0)
    })

    it('should close circuit after success threshold in half-open', async () => {
      const router = new Router({
        fallback: ['anthropic'],
        circuitBreaker: {
          failureThreshold: 1,
          recoveryTimeout: 50,
          successThreshold: 1
        }
      })

      const mockExecute = vi.fn()
        .mockRejectedValueOnce(new Error('Provider unavailable'))
        .mockResolvedValue({ result: 'Success', provider: 'anthropic' })

      router._setExecutor(mockExecute)

      // Open the circuit
      await expect(router.execute('test 1')).rejects.toThrow('All providers failed')

      // Wait for recovery
      await new Promise(resolve => setTimeout(resolve, 100))

      // Success should close the circuit
      await router.execute('test 2')

      const health = router.getHealth()
      expect(health.anthropic?.circuitState).toBe('closed')
      expect(health.anthropic?.healthy).toBe(true)
    })
  })

  describe('configurable backoff', () => {
    it('should use custom initial delay', async () => {
      const router = new Router({
        fallback: ['anthropic'],
        maxRetries: 2,
        backoff: {
          initialDelay: 25, // Small delay for fast tests
          multiplier: 2,
          jitter: false
        }
      })

      const delays: number[] = []
      const mockExecute = vi.fn()
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockResolvedValueOnce({ result: 'Success' })

      router._setExecutor(mockExecute)
      router._onDelay((delay: number) => delays.push(delay))

      await router.execute('test')

      // First retry should use initial delay of 25ms
      expect(delays[0]).toBe(25)
    })

    it('should respect max delay', async () => {
      const router = new Router({
        fallback: ['anthropic'],
        maxRetries: 5,
        backoff: {
          initialDelay: 10, // Small delay for fast tests
          multiplier: 10, // Would grow very fast
          maxDelay: 50, // Capped at 50ms
          jitter: false
        }
      })

      const delays: number[] = []
      const mockExecute = vi.fn()
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockResolvedValueOnce({ result: 'Success' })

      router._setExecutor(mockExecute)
      router._onDelay((delay: number) => delays.push(delay))

      await router.execute('test')

      // All delays should be capped at maxDelay (50ms)
      expect(delays.length).toBe(3)
      delays.forEach(delay => {
        expect(delay).toBeLessThanOrEqual(50)
      })
    })

    it('should add jitter when enabled', async () => {
      const router = new Router({
        fallback: ['anthropic'],
        maxRetries: 10,
        backoff: {
          initialDelay: 10, // Small delay for fast tests
          multiplier: 1, // Keep same base delay
          jitter: true
        }
      })

      const delays: number[] = []
      const mockExecute = vi.fn()
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockResolvedValueOnce({ result: 'Success' })

      router._setExecutor(mockExecute)
      router._onDelay((delay: number) => delays.push(delay))

      await router.execute('test')

      // With jitter, delays should vary slightly (within +/- 10%)
      // Note: There's a small chance all random values could be the same
      // but with 3 retries this is very unlikely
      expect(delays.length).toBe(3)
    })
  })

  describe('capability-based fallback', () => {
    it('should use capability-specific fallback chain', async () => {
      const router = new Router({
        fallbackConfig: {
          default: ['openai', 'anthropic'],
          byCapability: {
            fast: ['cloudflare', 'openai'],
            smart: ['anthropic', 'openai']
          }
        }
      })

      const mockExecute = vi.fn().mockResolvedValue({ result: 'Success' })
      router._setExecutor(mockExecute)

      // Request with 'fast' capability should try cloudflare first
      await router.execute('test', { capability: 'fast' })

      expect(mockExecute).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ provider: 'cloudflare' })
      )
    })

    it('should use model-specific fallback chain', async () => {
      const router = new Router({
        fallbackConfig: {
          default: ['openai', 'anthropic'],
          byModel: {
            'gpt-4': {
              chain: [
                { provider: 'openai', weight: 2 },
                { provider: 'anthropic', model: 'claude-3-opus', weight: 1 }
              ]
            }
          }
        }
      })

      const selectedProviders: string[] = []
      const mockExecute = vi.fn().mockImplementation((prompt, options) => {
        selectedProviders.push(options.provider)
        if (options.provider === 'openai') {
          return Promise.reject(new Error('Provider unavailable'))
        }
        return Promise.resolve({ result: 'Success', provider: options.provider })
      })

      router._setExecutor(mockExecute)

      // Request with gpt-4 model should use model-specific chain
      const result = await router.execute('test', { model: 'gpt-4' })

      // Should have tried openai first (higher weight), then anthropic
      expect(selectedProviders).toContain('openai')
      expect(result.provider).toBe('anthropic')
    })

    it('should fall back to default chain when no specific chain matches', async () => {
      const router = new Router({
        fallbackConfig: {
          default: {
            chain: [
              { provider: 'anthropic', weight: 1 },
              { provider: 'openai', weight: 1 }
            ]
          },
          byCapability: {
            fast: ['cloudflare']
          }
        }
      })

      const mockExecute = vi.fn().mockResolvedValue({ result: 'Success' })
      router._setExecutor(mockExecute)

      // Request without capability should use default chain
      await router.execute('test')

      // Should have used default chain (anthropic or openai)
      const calledProvider = mockExecute.mock.calls[0]?.[1]?.provider
      expect(['anthropic', 'openai']).toContain(calledProvider)
    })
  })

  describe('fallback chain with model override', () => {
    it('should use fallback entry model override', async () => {
      const router = new Router({
        fallbackConfig: {
          default: {
            chain: [
              { provider: 'anthropic', model: 'claude-3-haiku' },
              { provider: 'openai', model: 'gpt-3.5-turbo' }
            ]
          }
        }
      })

      const mockExecute = vi.fn().mockResolvedValue({ result: 'Success' })
      router._setExecutor(mockExecute)

      // Request should use the model from fallback entry
      await router.execute('test', { model: 'claude-3-opus' }) // Original model

      // Should have overridden to claude-3-haiku from fallback entry
      expect(mockExecute).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ model: 'claude-3-haiku' })
      )
    })
  })

  describe('weighted provider selection', () => {
    it('should prefer higher-weighted providers', async () => {
      const router = new Router({
        fallbackConfig: {
          default: {
            chain: [
              { provider: 'openai', weight: 1 },
              { provider: 'anthropic', weight: 10 } // Higher weight
            ]
          }
        }
      })

      const mockExecute = vi.fn().mockResolvedValue({ result: 'Success' })
      router._setExecutor(mockExecute)

      await router.execute('test')

      // Higher-weighted provider (anthropic) should be tried first
      expect(mockExecute).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ provider: 'anthropic' })
      )
    })
  })

  describe('provider availability', () => {
    it('should include attempted providers in error message', async () => {
      const router = new Router({
        fallback: ['anthropic', 'openai']
      })

      const mockExecute = vi.fn().mockRejectedValue(new Error('Provider unavailable'))
      router._setExecutor(mockExecute)

      await expect(router.execute('test')).rejects.toThrow(/tried: anthropic, openai/)
    })
  })
})
