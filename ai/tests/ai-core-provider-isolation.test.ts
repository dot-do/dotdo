/**
 * Tests for AI Core Provider Registry Isolation
 *
 * Tests that provider configuration in ai-core.ts is properly isolated
 * per request/tenant to prevent state leakage.
 *
 * @see do-9voby - Replace global provider registry with request-scoped context
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  configureProvider,
  getProvider,
  clearProviders,
  runWithAIProviderContext,
  getCurrentAIProviderContext,
  type AIProviderConfig,
} from '../ai-core'

describe('AI Core Provider Registry Isolation', () => {
  beforeEach(() => {
    // Reset global state between tests for backward compatibility tests
    clearProviders()
  })

  describe('request-scoped provider isolation', () => {
    it('should isolate provider config between concurrent contexts', async () => {
      // Two concurrent "requests" should not see each other's provider config

      const results: { tenant: string; hasAnthropic: boolean; hasOpenAI: boolean }[] = []

      // Simulate Tenant A's request
      const tenantA = runWithAIProviderContext(async () => {
        configureProvider({
          provider: 'anthropic',
          apiKey: 'sk-ant-tenant-a-secret',
        })

        // Add a small delay to ensure concurrent execution
        await new Promise(resolve => setTimeout(resolve, 10))

        const anthropicConfig = getProvider('anthropic')
        const openaiConfig = getProvider('openai')

        results.push({
          tenant: 'A',
          hasAnthropic: !!anthropicConfig && anthropicConfig.apiKey === 'sk-ant-tenant-a-secret',
          hasOpenAI: !!openaiConfig,
        })
      })

      // Simulate Tenant B's request (concurrent)
      const tenantB = runWithAIProviderContext(async () => {
        configureProvider({
          provider: 'openai',
          apiKey: 'sk-openai-tenant-b-secret',
        })

        // Add a small delay
        await new Promise(resolve => setTimeout(resolve, 10))

        const anthropicConfig = getProvider('anthropic')
        const openaiConfig = getProvider('openai')

        results.push({
          tenant: 'B',
          hasAnthropic: !!anthropicConfig,
          hasOpenAI: !!openaiConfig && openaiConfig.apiKey === 'sk-openai-tenant-b-secret',
        })
      })

      // Wait for both to complete
      await Promise.all([tenantA, tenantB])

      // Verify isolation - each tenant should only see their own config
      const resultA = results.find(r => r.tenant === 'A')
      const resultB = results.find(r => r.tenant === 'B')

      // Tenant A configured Anthropic, should see it, but NOT OpenAI
      expect(resultA?.hasAnthropic).toBe(true)
      expect(resultA?.hasOpenAI).toBe(false)

      // Tenant B configured OpenAI, should see it, but NOT Anthropic
      expect(resultB?.hasOpenAI).toBe(true)
      expect(resultB?.hasAnthropic).toBe(false)
    })

    it('should NOT leak provider config from one context to another', async () => {
      // First context configures a provider
      await runWithAIProviderContext(async () => {
        configureProvider({
          provider: 'anthropic',
          apiKey: 'sk-ant-first-context-secret',
        })

        const config = getProvider('anthropic')
        expect(config?.apiKey).toBe('sk-ant-first-context-secret')
      })

      // Second context should NOT see the first context's config
      await runWithAIProviderContext(async () => {
        // This context did NOT configure Anthropic
        const config = getProvider('anthropic')

        // Should NOT have the first context's API key
        expect(config?.apiKey).not.toBe('sk-ant-first-context-secret')
        expect(config).toBeUndefined()
      })
    })

    it('should support nested contexts with proper isolation', async () => {
      await runWithAIProviderContext(async () => {
        // Outer context configures Anthropic
        configureProvider({
          provider: 'anthropic',
          apiKey: 'sk-ant-outer-context',
        })

        // Nested context configures different provider
        await runWithAIProviderContext(async () => {
          configureProvider({
            provider: 'openai',
            apiKey: 'sk-openai-inner-context',
          })

          // Inner context should see its own OpenAI config
          const openaiConfig = getProvider('openai')
          expect(openaiConfig?.apiKey).toBe('sk-openai-inner-context')

          // Inner context should NOT see outer context's Anthropic config
          const anthropicConfig = getProvider('anthropic')
          expect(anthropicConfig).toBeUndefined()
        })

        // After inner context exits, outer should still have its config
        const anthropicConfig = getProvider('anthropic')
        expect(anthropicConfig?.apiKey).toBe('sk-ant-outer-context')

        // Outer should NOT have inner context's OpenAI config
        const openaiConfig = getProvider('openai')
        expect(openaiConfig).toBeUndefined()
      })
    })

    it('should cleanup context state after context exits', async () => {
      await runWithAIProviderContext(async () => {
        configureProvider({
          provider: 'google',
          apiKey: 'google-api-key-in-context',
          accountId: 'google-project-id',
        })

        expect(getProvider('google')).toBeDefined()
      })

      // After context exits, attempting to get context should return undefined
      // (or fall back to global if outside any context)
      const context = getCurrentAIProviderContext()
      expect(context).toBeUndefined()
    })
  })

  describe('default provider isolation', () => {
    it('should NOT leak default provider between contexts', async () => {
      // First context sets a default provider
      await runWithAIProviderContext(async () => {
        configureProvider({
          provider: 'anthropic',
          apiKey: 'sk-ant-default-test',
        })

        // Anthropic should be the default (first configured)
        const defaultConfig = getProvider()
        expect(defaultConfig?.provider).toBe('anthropic')
      })

      // Second context should have NO default provider
      await runWithAIProviderContext(async () => {
        const defaultConfig = getProvider()
        expect(defaultConfig).toBeUndefined()
      })
    })

    it('should track default provider independently per context', async () => {
      const results: { context: string; defaultProvider: string | undefined }[] = []

      const ctx1 = runWithAIProviderContext(async () => {
        configureProvider({ provider: 'anthropic', apiKey: 'key-1' })
        configureProvider({ provider: 'openai', apiKey: 'key-2' })

        // Default should be anthropic (first configured)
        const config = getProvider()
        results.push({ context: '1', defaultProvider: config?.provider })
      })

      const ctx2 = runWithAIProviderContext(async () => {
        configureProvider({ provider: 'google', apiKey: 'key-3' })

        // Default should be google (first configured in this context)
        const config = getProvider()
        results.push({ context: '2', defaultProvider: config?.provider })
      })

      await Promise.all([ctx1, ctx2])

      const result1 = results.find(r => r.context === '1')
      const result2 = results.find(r => r.context === '2')

      expect(result1?.defaultProvider).toBe('anthropic')
      expect(result2?.defaultProvider).toBe('google')
    })
  })

  describe('backward compatibility (global fallback)', () => {
    it('should fall back to global registry when NOT in a context', () => {
      // Outside any context, should use global registry
      clearProviders()

      configureProvider({
        provider: 'openai',
        apiKey: 'sk-global-fallback-key',
      })

      const config = getProvider('openai')
      expect(config?.apiKey).toBe('sk-global-fallback-key')
    })

    it('should prefer context over global when in a context', async () => {
      // Set up global config
      clearProviders()
      configureProvider({
        provider: 'openai',
        apiKey: 'sk-global-key',
      })

      await runWithAIProviderContext(async () => {
        // Configure same provider with different key in context
        configureProvider({
          provider: 'openai',
          apiKey: 'sk-context-key',
        })

        // Should get context key, NOT global key
        const config = getProvider('openai')
        expect(config?.apiKey).toBe('sk-context-key')
      })

      // After context, should get global key again
      const globalConfig = getProvider('openai')
      expect(globalConfig?.apiKey).toBe('sk-global-key')
    })
  })

  describe('concurrent access safety', () => {
    it('should handle many concurrent contexts without interference', async () => {
      const NUM_CONTEXTS = 50
      const contexts: Promise<{ id: number; success: boolean }>[] = []

      for (let i = 0; i < NUM_CONTEXTS; i++) {
        const contextPromise = runWithAIProviderContext(async () => {
          const uniqueKey = `sk-context-${i}-unique-key`

          configureProvider({
            provider: 'anthropic',
            apiKey: uniqueKey,
          })

          // Random delay to simulate real async work
          await new Promise(resolve => setTimeout(resolve, Math.random() * 20))

          // Verify we still see OUR key
          const config = getProvider('anthropic')
          const success = config?.apiKey === uniqueKey

          return { id: i, success }
        })

        contexts.push(contextPromise)
      }

      const results = await Promise.all(contexts)

      // All contexts should see their own keys
      const failures = results.filter(r => !r.success)
      expect(failures).toHaveLength(0)
    })
  })
})
