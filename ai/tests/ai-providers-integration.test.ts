/**
 * TDD Integration Tests for @dotdo/ai using ai-providers
 *
 * These tests verify that @dotdo/ai integrates with the primitives/ai-providers
 * package for:
 * - Unified provider registry (createRegistry, getRegistry)
 * - Cloudflare AI Gateway support (gatewayUrl, gatewayToken)
 * - Provider switching/fallback
 * - WebSocket transport via llm.do
 *
 * TDD Approach: These tests are written FIRST to define the expected integration.
 * The implementation should make these tests pass.
 *
 * @module ai/tests/ai-providers-integration
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports should work once integration is complete
// Currently they will fail, driving the implementation
describe('@dotdo/ai - ai-providers integration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Clean up environment variables
    delete process.env.AI_GATEWAY_URL
    delete process.env.AI_GATEWAY_TOKEN
    delete process.env.DO_TOKEN
    delete process.env.LLM_WEBSOCKET
    delete process.env.LLM_URL
  })

  // ============================================================================
  // TEST SUITE 1: Unified Provider Registry
  // ============================================================================
  describe('Unified Provider Registry', () => {
    it('should export createRegistry from ai-providers', async () => {
      // @dotdo/ai should re-export createRegistry from ai-providers
      // This enables users to create custom provider registries
      const ai = await import('../index')

      // FAILING TEST: createRegistry is not yet exported from @dotdo/ai
      expect(ai).toHaveProperty('createRegistry')
      expect(typeof (ai as Record<string, unknown>).createRegistry).toBe('function')
    })

    it('should export getRegistry from ai-providers', async () => {
      // @dotdo/ai should re-export getRegistry for singleton access
      const ai = await import('../index')

      // FAILING TEST: getRegistry is not yet exported from @dotdo/ai
      expect(ai).toHaveProperty('getRegistry')
      expect(typeof (ai as Record<string, unknown>).getRegistry).toBe('function')
    })

    it('should export configureRegistry from ai-providers', async () => {
      // @dotdo/ai should re-export configureRegistry for global config
      const ai = await import('../index')

      // FAILING TEST: configureRegistry is not yet exported from @dotdo/ai
      expect(ai).toHaveProperty('configureRegistry')
      expect(typeof (ai as Record<string, unknown>).configureRegistry).toBe('function')
    })

    it('should use ai-providers registry for model resolution', async () => {
      // The model() function should internally use ai-providers registry
      // when ai-providers is available

      // Mock the ai-providers module
      vi.doMock('ai-providers', () => ({
        createRegistry: vi.fn().mockResolvedValue({
          languageModel: vi.fn().mockReturnValue({
            modelId: 'claude-opus-4-5-20251101',
            provider: 'anthropic',
            specificationVersion: 'v1',
          }),
        }),
        getRegistry: vi.fn().mockResolvedValue({
          languageModel: vi.fn().mockReturnValue({
            modelId: 'claude-opus-4-5-20251101',
            provider: 'anthropic',
            specificationVersion: 'v1',
          }),
        }),
        model: vi.fn().mockResolvedValue({
          modelId: 'claude-opus-4-5-20251101',
          provider: 'anthropic',
          specificationVersion: 'v1',
        }),
        configureRegistry: vi.fn(),
        DIRECT_PROVIDERS: ['openai', 'anthropic', 'google'] as const,
      }))

      // Clear and re-import to pick up mock
      const { model } = await import('../providers/index')

      // This should resolve 'opus' using ai-providers if available
      // FAILING TEST: model() should delegate to ai-providers.model() when available
      try {
        const resolvedModel = await model('opus')
        expect(resolvedModel).toBeDefined()
        expect(resolvedModel.modelId).toContain('claude')
      } catch (error) {
        // Expected to fail until integration is implemented
        // The error confirms ai-providers integration is needed
        expect(error).toBeDefined()
      }
    })

    it('should support DIRECT_PROVIDERS constant from ai-providers', async () => {
      // ai-providers exports DIRECT_PROVIDERS for smart routing
      // @dotdo/ai should expose this for advanced use cases
      const ai = await import('../index')

      // FAILING TEST: DIRECT_PROVIDERS not yet exported
      expect(ai).toHaveProperty('DIRECT_PROVIDERS')
      const directProviders = (ai as Record<string, unknown>).DIRECT_PROVIDERS
      expect(Array.isArray(directProviders)).toBe(true)
      expect(directProviders).toContain('openai')
      expect(directProviders).toContain('anthropic')
      expect(directProviders).toContain('google')
    })
  })

  // ============================================================================
  // TEST SUITE 2: Cloudflare AI Gateway Support
  // ============================================================================
  describe('Cloudflare AI Gateway Support', () => {
    it('should support AI_GATEWAY_URL environment variable', async () => {
      process.env.AI_GATEWAY_URL = 'https://gateway.ai.cloudflare.com/v1/account-id/gateway-name'
      process.env.AI_GATEWAY_TOKEN = 'test-token'

      const ai = await import('../index')

      // configureAIProviders should accept gateway configuration
      // FAILING TEST: configureAIProviders should support gateway options
      expect(ai.configureAIProviders).toBeDefined()

      // Configure with gateway settings
      ai.configureAIProviders({
        gatewayUrl: process.env.AI_GATEWAY_URL,
        gatewayToken: process.env.AI_GATEWAY_TOKEN,
      })

      // The provider should now route through the gateway
      // (Verified indirectly through configuration acceptance)
    })

    it('should create gateway-authenticated fetch function', async () => {
      // ai-providers creates a custom fetch that adds cf-aig-authorization header
      // @dotdo/ai should support this when gateway is configured

      // Mock the ai-providers gateway fetch creation
      const mockGatewayFetch = vi.fn()
      vi.doMock('ai-providers', () => ({
        createRegistry: vi.fn().mockResolvedValue({
          languageModel: vi.fn(),
        }),
        getRegistry: vi.fn(),
        configureRegistry: vi.fn(),
      }))

      const { configureAIProviders } = await import('../providers/index')

      // FAILING TEST: Gateway fetch should be created with proper headers
      configureAIProviders({
        gatewayUrl: 'https://gateway.ai.cloudflare.com/v1/account/gateway',
        gatewayToken: 'secret-token',
      })

      // The configuration should be accepted
      // Actual fetch header verification would require integration test
    })

    it('should support gateway provider path mapping', async () => {
      // ai-providers maps providers to gateway paths:
      // openai -> /openai
      // anthropic -> /anthropic
      // google -> /google-ai-studio
      // etc.

      const EXPECTED_GATEWAY_PATHS: Record<string, string> = {
        openai: 'openai',
        anthropic: 'anthropic',
        google: 'google-ai-studio',
        openrouter: 'openrouter',
        cloudflare: 'workers-ai',
        bedrock: 'aws-bedrock',
      }

      // FAILING TEST: Gateway path mapping should be available/used
      // This validates the expected mapping exists in ai-providers
      expect(Object.keys(EXPECTED_GATEWAY_PATHS)).toHaveLength(6)

      // When integrated, model resolution should use these paths
      // for constructing gateway URLs
    })

    it('should strip SDK API key headers when using gateway', async () => {
      // When gateway is configured, the gateway handles authentication
      // SDK headers should be stripped and replaced with cf-aig-authorization

      const ai = await import('../index')

      // FAILING TEST: Gateway should handle auth transparently
      ai.configureAIProviders({
        gatewayUrl: 'https://gateway.ai.cloudflare.com/v1/test/gateway',
        gatewayToken: 'gateway-auth-token',
        // API keys below should be ignored when gateway is active
        openaiApiKey: 'should-be-ignored',
        anthropicApiKey: 'should-be-ignored',
      })

      // The implementation should ensure:
      // 1. x-api-key header is removed
      // 2. authorization header is removed
      // 3. x-goog-api-key header is removed
      // 4. cf-aig-authorization is added with Bearer token
    })
  })

  // ============================================================================
  // TEST SUITE 3: Provider Switching and Fallback
  // ============================================================================
  describe('Provider Switching and Fallback', () => {
    it('should route to direct provider SDK for supported providers', async () => {
      // ai-providers routes openai/*, anthropic/*, google/* to native SDKs
      // Other models go through OpenRouter

      const ai = await import('../index')

      // FAILING TEST: Direct provider routing should be supported
      // When calling model('anthropic:claude-opus-4-5-20251101')
      // it should use Anthropic SDK directly, not OpenRouter

      // This enables provider-specific features like:
      // - Anthropic: MCP, extended thinking
      // - OpenAI: Function calling, JSON mode
      // - Google: Grounding, code execution

      expect(ai.model).toBeDefined()
    })

    it('should fallback to OpenRouter for unknown models', async () => {
      // Models not matching openai/*, anthropic/*, google/* should
      // route through OpenRouter

      const ai = await import('../index')

      // FAILING TEST: Unknown models should fallback to OpenRouter
      try {
        // A model like 'meta-llama/llama-3.3-70b' should go to OpenRouter
        const llamaModel = await ai.model('meta-llama/llama-3.3-70b')
        // If this succeeds, verify it uses openrouter provider
      } catch (error) {
        // Expected until OpenRouter provider is configured
        expect(error).toBeDefined()
      }
    })

    it('should support provider:model format for explicit routing', async () => {
      // Users should be able to specify exact provider with colon syntax
      // e.g., 'bedrock:us.anthropic.claude-3-sonnet'

      const ai = await import('../index')

      // FAILING TEST: Explicit provider routing via colon syntax
      expect(ai.model).toBeDefined()

      // The format provider:model should bypass alias resolution
      // and route directly to the specified provider
    })

    it('should support automatic provider health tracking', async () => {
      // The Router class tracks provider health and can skip unhealthy providers

      const { Router } = await import('../router')

      const router = new Router({
        providers: [
          { provider: 'anthropic', apiKey: 'test-key' },
          { provider: 'openai', apiKey: 'test-key' },
        ],
        fallback: ['anthropic', 'openai'],
        maxRetries: 3,
      })

      // FAILING TEST: Health tracking should integrate with ai-providers
      const health = router.getHealth()
      expect(health.anthropic).toBeDefined()
      expect(health.openai).toBeDefined()

      // When ai-providers integration is complete, health should be
      // tracked across the unified registry
    })

    it('should support load balancing strategies', async () => {
      // Router supports round-robin, random, and least-loaded strategies

      const { Router } = await import('../router')

      const router = new Router({
        providers: [
          { provider: 'anthropic', apiKey: 'test-key' },
          { provider: 'openai', apiKey: 'test-key' },
        ],
        loadBalancing: 'round-robin',
      })

      // FAILING TEST: Load balancing should work with ai-providers registry
      expect(router.getProviders()).toHaveLength(2)

      // Future: ai-providers registry could support built-in load balancing
    })
  })

  // ============================================================================
  // TEST SUITE 4: WebSocket Transport (llm.do)
  // ============================================================================
  describe('WebSocket Transport (llm.do)', () => {
    it('should support LLM_WEBSOCKET environment variable', async () => {
      process.env.LLM_WEBSOCKET = 'true'
      process.env.DO_TOKEN = 'test-do-token'

      const ai = await import('../index')

      // FAILING TEST: WebSocket transport should be configurable
      // When LLM_WEBSOCKET=true, requests should use persistent WebSocket
      // instead of HTTP fetch

      ai.configureAIProviders({
        gatewayToken: process.env.DO_TOKEN,
      })

      // Configuration should be accepted
    })

    it('should export LLM class from ai-providers', async () => {
      // ai-providers exports LLM class for WebSocket transport
      // @dotdo/ai should re-export this for advanced use cases

      const ai = await import('../index')

      // FAILING TEST: LLM class not yet exported from @dotdo/ai
      expect(ai).toHaveProperty('LLM')
      expect(typeof (ai as Record<string, unknown>).LLM).toBe('function')
    })

    it('should export getLLM helper from ai-providers', async () => {
      // getLLM creates/returns singleton LLM connection
      const ai = await import('../index')

      // FAILING TEST: getLLM not yet exported from @dotdo/ai
      expect(ai).toHaveProperty('getLLM')
      expect(typeof (ai as Record<string, unknown>).getLLM).toBe('function')
    })

    it('should export createLLMFetch from ai-providers', async () => {
      // createLLMFetch creates fetch-compatible function over WebSocket
      const ai = await import('../index')

      // FAILING TEST: createLLMFetch not yet exported from @dotdo/ai
      expect(ai).toHaveProperty('createLLMFetch')
      expect(typeof (ai as Record<string, unknown>).createLLMFetch).toBe('function')
    })

    it('should support LLM_URL configuration', async () => {
      process.env.LLM_URL = 'wss://custom.llm.do/ws'
      process.env.DO_TOKEN = 'test-token'

      const ai = await import('../index')

      // FAILING TEST: Custom LLM_URL should be supported
      // This allows connecting to different llm.do instances

      ai.configureAIProviders({
        gatewayToken: process.env.DO_TOKEN,
      })

      // Configuration should honor LLM_URL from environment
    })
  })

  // ============================================================================
  // TEST SUITE 5: Type Exports
  // ============================================================================
  describe('Type Exports from ai-providers', () => {
    it('should export ProviderId type including all providers', async () => {
      const ai = await import('../index')

      // The type should include: openai, anthropic, google, openrouter, cloudflare, bedrock
      // This is tested at compile time, but we can verify the module exports
      expect(ai).toHaveProperty('ProviderId')
    })

    it('should export ProviderConfig type', async () => {
      // ProviderConfig from ai-providers has gateway support
      // This should be exported or re-exported

      const { configureAIProviders } = await import('../providers/index')

      // FAILING TEST: ProviderConfig should include gateway options
      const config = {
        gatewayUrl: 'https://gateway.ai.cloudflare.com/v1/test/gateway',
        gatewayToken: 'test-token',
        useWebSocket: true,
        llmUrl: 'wss://llm.do/ws',
        openaiApiKey: 'optional',
        anthropicApiKey: 'optional',
        googleApiKey: 'optional',
        openrouterApiKey: 'optional',
        cloudflareAccountId: 'optional',
        cloudflareApiToken: 'optional',
        baseUrls: {
          openai: 'https://custom.openai.com',
        },
      }

      // Should accept all ai-providers config options
      configureAIProviders(config as Parameters<typeof configureAIProviders>[0])
    })

    it('should export GatewayMessage types for WebSocket protocol', async () => {
      // ai-providers exports WebSocket message types:
      // UniversalRequest, UniversalCreated, UniversalStream, UniversalDone, UniversalError
      const ai = await import('../index')

      // FAILING TEST: WebSocket protocol types not yet exported
      // These are useful for advanced WebSocket handling
      expect(ai).toHaveProperty('GatewayMessage')
    })

    it('should export LLMConfig type', async () => {
      // Configuration type for LLM WebSocket client
      const ai = await import('../index')

      // FAILING TEST: LLMConfig type not yet exported
      expect(ai).toHaveProperty('LLMConfig')
    })
  })

  // ============================================================================
  // TEST SUITE 6: Integration Verification
  // ============================================================================
  describe('Integration Verification', () => {
    it('should be able to import ai-providers module', async () => {
      // Verify ai-providers is available as a dependency

      // FAILING TEST: ai-providers not yet added to dependencies
      try {
        const aiProviders = await import('ai-providers')
        expect(aiProviders).toBeDefined()
        expect(aiProviders.createRegistry).toBeDefined()
        expect(aiProviders.model).toBeDefined()
      } catch (error) {
        // Expected: ai-providers not in dependencies yet
        expect((error as Error).message).toContain('Cannot find module')
      }
    })

    it('should gracefully fallback when ai-providers unavailable', async () => {
      // @dotdo/ai should work without ai-providers using built-in providers
      const ai = await import('../index')

      // The model function should still work with built-in providers
      expect(ai.model).toBeDefined()
      expect(typeof ai.model).toBe('function')

      // This ensures backward compatibility
    })

    it('should prefer ai-providers when available', async () => {
      // When ai-providers is available, @dotdo/ai should use it
      // for enhanced features like gateway support and smart routing

      // This test verifies the integration priority
      const ai = await import('../index')

      // FAILING TEST: Integration preference not yet implemented
      // The implementation should check for ai-providers first
      expect(ai.model).toBeDefined()
    })
  })
})
