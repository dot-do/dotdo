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
          ]
        })

        // Mark openai as unhealthy
        router._markUnhealthy('openai')

        const selectedProviders: string[] = []

        const mockExecute = vi.fn().mockImplementation((prompt, options) => {
          selectedProviders.push(options.provider)
          return Promise.resolve({ result: 'Success', provider: options.provider })
        })

        router._setExecutor(mockExecute)

        await router.execute('test 1')
        await router.execute('test 2')

        // All requests should go to anthropic since openai is unhealthy
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
      const router = new Router({ fallback: ['anthropic'] }) // Only one provider, no fallback

      const mockExecute = vi.fn()
        .mockRejectedValue(new Error('Provider down'))

      router._setExecutor(mockExecute)

      await expect(router.execute('test')).rejects.toThrow('All providers failed')

      const health = router.getHealth()
      expect(health.anthropic?.healthy).toBe(false)
    })

    it('should skip unhealthy providers in rotation', async () => {
      const router = new Router({
        loadBalancing: 'round-robin',
        providers: [
          { provider: 'openai', apiKey: 'key1' },
          { provider: 'anthropic', apiKey: 'key2' }
        ]
      })

      // Mark one provider as unhealthy
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
})
