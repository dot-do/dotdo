/**
 * TDD Integration tests for language-models compatibility with @dotdo/do
 *
 * These tests verify that the language-models package from primitives integrates
 * with @dotdo/do for LLM selection and routing. Following TDD approach: tests are
 * written to FAIL first, then implementation is updated to make them pass.
 *
 * The integration should enable:
 * 1. Model alias resolution (e.g., 'opus' -> 'anthropic/claude-opus-4.5')
 * 2. Provider routing information via resolveWithProvider()
 * 3. Direct routing detection for supported providers
 * 4. Model listing and search capabilities
 *
 * @module do/tests/language-models-integration.test
 * @issue do-zr1u.14
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  resolve,
  resolveWithProvider,
  list,
  get,
  search,
  DIRECT_PROVIDERS,
  ALIASES,
  type ModelInfo,
  type ResolvedModel,
} from 'language-models'
import { createContext, type WorkflowContext } from '../workflow/context'

// Mock DurableObjectState for DO context creation
const createMockState = () =>
  ({
    id: { toString: () => `test-do-${Date.now()}` },
    storage: {
      get: vi.fn(),
      put: vi.fn(),
      list: vi.fn(() => Promise.resolve(new Map())),
      delete: vi.fn(),
    },
  }) as unknown as DurableObjectState

describe('language-models Integration with @dotdo/do', () => {
  let mockState: DurableObjectState
  let $: WorkflowContext

  beforeEach(() => {
    mockState = createMockState()
    $ = createContext(mockState, {})
  })

  describe('Model Resolution for LLM Selection', () => {
    it('should resolve common aliases to full model IDs', () => {
      // These aliases should map to full OpenRouter-style model IDs
      expect(resolve('opus')).toBe('anthropic/claude-opus-4.5')
      expect(resolve('sonnet')).toBe('anthropic/claude-sonnet-4.5')
      expect(resolve('haiku')).toBe('anthropic/claude-haiku-4.5')
      expect(resolve('gpt')).toBe('openai/gpt-4o')
      expect(resolve('gemini')).toBe('google/gemini-2.5-flash')
    })

    it('should resolve aliases case-insensitively', () => {
      const lowerResult = resolve('opus')
      const upperResult = resolve('OPUS')
      const mixedResult = resolve('Opus')

      expect(lowerResult).toBe(upperResult)
      expect(lowerResult).toBe(mixedResult)
    })

    it('should preserve full model IDs when already specified', () => {
      const fullId = 'anthropic/claude-opus-4.5'
      expect(resolve(fullId)).toBe(fullId)
    })

    it('should handle unknown model names gracefully', () => {
      const unknownModel = 'unknown-model-xyz'
      // Should return input as-is when no match found
      expect(resolve(unknownModel)).toBe(unknownModel)
    })

    it('should export ALIASES for custom mapping inspection', () => {
      expect(ALIASES).toBeDefined()
      expect(typeof ALIASES).toBe('object')
      expect(ALIASES['opus']).toBe('anthropic/claude-opus-4.5')
    })
  })

  describe('Provider Routing Information', () => {
    it('should extract provider from resolved model', () => {
      const result = resolveWithProvider('opus')
      expect(result.provider).toBe('anthropic')
    })

    it('should include full resolved model ID', () => {
      const result = resolveWithProvider('opus')
      expect(result.id).toBe('anthropic/claude-opus-4.5')
    })

    it('should identify direct routing support for major providers', () => {
      // Anthropic should support direct routing
      const anthropicResult = resolveWithProvider('opus')
      expect(anthropicResult.supportsDirectRouting).toBe(true)

      // OpenAI should support direct routing
      const openaiResult = resolveWithProvider('gpt')
      expect(openaiResult.supportsDirectRouting).toBe(true)

      // Google should support direct routing
      const googleResult = resolveWithProvider('gemini')
      expect(googleResult.supportsDirectRouting).toBe(true)
    })

    it('should return complete ResolvedModel type', () => {
      const result: ResolvedModel = resolveWithProvider('opus')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('provider')
      expect(result).toHaveProperty('supportsDirectRouting')
      expect(typeof result.id).toBe('string')
      expect(typeof result.provider).toBe('string')
      expect(typeof result.supportsDirectRouting).toBe('boolean')
    })

    it('should include provider model ID when available', () => {
      const result = resolveWithProvider('opus')
      // If model info is available, providerModelId should be defined
      if (result.model?.provider_model_id) {
        expect(result.providerModelId).toBeDefined()
      }
    })

    it('should handle unknown providers', () => {
      const result = resolveWithProvider('unknown-provider/model')
      expect(result.provider).toBe('unknown-provider')
      expect(result.supportsDirectRouting).toBe(false)
    })
  })

  describe('Direct Provider Constants', () => {
    it('should export DIRECT_PROVIDERS array', () => {
      expect(DIRECT_PROVIDERS).toBeDefined()
      expect(Array.isArray(DIRECT_PROVIDERS)).toBe(true)
    })

    it('should include major AI providers in DIRECT_PROVIDERS', () => {
      expect(DIRECT_PROVIDERS).toContain('anthropic')
      expect(DIRECT_PROVIDERS).toContain('openai')
      expect(DIRECT_PROVIDERS).toContain('google')
    })

    it('should be readonly', () => {
      // Type check - this should be a readonly array
      const providers: readonly string[] = DIRECT_PROVIDERS
      expect(providers).toBeDefined()
    })
  })

  describe('Model Listing and Search', () => {
    it('should list all available models', () => {
      const models = list()
      expect(Array.isArray(models)).toBe(true)
    })

    it('should return models with required properties', () => {
      const models = list()
      if (models.length > 0) {
        const model = models[0]
        expect(model).toHaveProperty('id')
        expect(model).toHaveProperty('name')
        expect(model).toHaveProperty('context_length')
        expect(model).toHaveProperty('pricing')
      }
    })

    it('should get model by exact ID', () => {
      const models = list()
      if (models.length > 0) {
        const firstModel = models[0]
        const retrieved = get(firstModel.id)
        expect(retrieved).toBeDefined()
        expect(retrieved?.id).toBe(firstModel.id)
      }
    })

    it('should return undefined for non-existent model ID', () => {
      const result = get('non-existent/model-id')
      expect(result).toBeUndefined()
    })

    it('should search models by query string', () => {
      const models = list()
      if (models.length > 0) {
        // Search for a common provider name
        const results = search('anthropic')
        if (results.length > 0) {
          expect(results.every((m) => m.id.toLowerCase().includes('anthropic') || m.name.toLowerCase().includes('anthropic'))).toBe(true)
        }
      }
    })

    it('should search case-insensitively', () => {
      const lowerResults = search('claude')
      const upperResults = search('CLAUDE')
      expect(lowerResults).toEqual(upperResults)
    })

    it('should return empty array for no matches', () => {
      const results = search('nonexistent-model-xyz-12345')
      expect(results).toEqual([])
    })
  })

  describe('Integration with @dotdo/do Router', () => {
    it('should resolve model for use with @dotdo/ai Router', () => {
      // The resolved model should be suitable for passing to @dotdo/ai's Router
      const resolved = resolveWithProvider('sonnet')

      // Should have the information needed for routing
      expect(resolved.id).toBeDefined()
      expect(resolved.provider).toBeDefined()

      // Provider should be one of the known types
      const knownProviders = ['anthropic', 'openai', 'google', 'meta-llama', 'mistralai', 'deepseek', 'x-ai', 'perplexity', 'qwen']
      expect(knownProviders.some((p) => resolved.provider.includes(p) || resolved.id.includes(p))).toBe(true)
    })

    it('should provide pricing information for cost-based routing', () => {
      const models = list()
      if (models.length > 0) {
        const model = models[0]
        expect(model.pricing).toBeDefined()
        expect(model.pricing.prompt).toBeDefined()
        expect(model.pricing.completion).toBeDefined()
      }
    })

    it('should provide context length for model selection', () => {
      const models = list()
      if (models.length > 0) {
        const model = models[0]
        expect(typeof model.context_length).toBe('number')
        expect(model.context_length).toBeGreaterThan(0)
      }
    })
  })

  describe('WorkflowContext Integration Pattern', () => {
    /**
     * These tests verify the intended integration pattern where
     * language-models is used within workflow event handlers for
     * dynamic model selection.
     */

    it('should support model selection in event handlers', async () => {
      const selectedModels: string[] = []

      // Register handler that uses language-models for model selection
      $.on.AI.generate((event) => {
        const modelAlias = (event.payload as { model?: string })?.model || 'sonnet'
        const resolvedModel = resolve(modelAlias)
        selectedModels.push(resolvedModel)
      })

      // Emit event with model alias
      $.send({ type: 'AI.generate', payload: { model: 'opus', prompt: 'Test' } })

      // Wait for async processing
      await new Promise((r) => setTimeout(r, 100))

      expect(selectedModels).toHaveLength(1)
      expect(selectedModels[0]).toBe('anthropic/claude-opus-4.5')
    })

    it('should support provider-aware routing in handlers', async () => {
      const routingDecisions: ResolvedModel[] = []

      $.on.AI.route((event) => {
        const modelAlias = (event.payload as { model?: string })?.model || 'sonnet'
        const resolved = resolveWithProvider(modelAlias)
        routingDecisions.push(resolved)
      })

      // Emit events for different providers
      $.send({ type: 'AI.route', payload: { model: 'opus' } })
      $.send({ type: 'AI.route', payload: { model: 'gpt-4o' } })
      $.send({ type: 'AI.route', payload: { model: 'gemini' } })

      await new Promise((r) => setTimeout(r, 150))

      expect(routingDecisions).toHaveLength(3)
      expect(routingDecisions.map((r) => r.provider)).toContain('anthropic')
      expect(routingDecisions.map((r) => r.provider)).toContain('openai')
      expect(routingDecisions.map((r) => r.provider)).toContain('google')
    })

    it('should support fallback model selection', async () => {
      const results: { primary: string | undefined; fallback: string }[] = []

      $.on.AI.generateWithFallback((event) => {
        const payload = event.payload as { model?: string; fallback?: string }
        const primary = payload.model ? get(resolve(payload.model)) : undefined
        const fallback = resolve(payload.fallback || 'sonnet')

        results.push({
          primary: primary?.id,
          fallback,
        })
      })

      // Request with unknown primary, should have fallback
      $.send({
        type: 'AI.generateWithFallback',
        payload: { model: 'unknown-model', fallback: 'haiku' },
      })

      await new Promise((r) => setTimeout(r, 100))

      expect(results).toHaveLength(1)
      expect(results[0].primary).toBeUndefined()
      expect(results[0].fallback).toBe('anthropic/claude-haiku-4.5')
    })
  })

  describe('Model Capability Detection', () => {
    it('should support model filtering by search', () => {
      // Search for Claude models
      const claudeModels = search('claude')

      // All results should be Claude models
      claudeModels.forEach((model) => {
        expect(model.id.includes('claude') || model.name.toLowerCase().includes('claude')).toBe(true)
      })
    })

    it('should detect multimodal models via architecture info', () => {
      const models = list()
      const multimodalModels = models.filter((m) => m.architecture?.input_modalities && m.architecture.input_modalities.length > 1)

      // Some models should have multiple input modalities
      // This test validates the type structure is correct
      multimodalModels.forEach((model) => {
        expect(Array.isArray(model.architecture?.input_modalities)).toBe(true)
      })
    })

    it('should provide context length for long-context operations', () => {
      const models = list()
      // Find models with large context windows
      const longContextModels = models.filter((m) => m.context_length >= 100000)

      if (longContextModels.length > 0) {
        const largestContext = longContextModels.reduce((prev, curr) => (curr.context_length > prev.context_length ? curr : prev))
        expect(largestContext.context_length).toBeGreaterThanOrEqual(100000)
      }
    })
  })

  describe('Error Handling', () => {
    it('should handle empty input gracefully', () => {
      const result = resolve('')
      expect(result).toBe('')
    })

    it('should handle whitespace input', () => {
      const result = resolve('  opus  ')
      expect(result).toBe('anthropic/claude-opus-4.5')
    })

    it('should not throw for invalid search queries', () => {
      expect(() => search('')).not.toThrow()
      expect(() => search('    ')).not.toThrow()
    })

    it('should handle special characters in search', () => {
      // Should not throw even with special characters
      expect(() => search('claude-3.5')).not.toThrow()
      expect(() => search('@cf/meta')).not.toThrow()
    })
  })

  describe('Type Safety', () => {
    it('should have ModelInfo type with correct structure', () => {
      const models = list()
      if (models.length > 0) {
        const model: ModelInfo = models[0]

        // Required fields
        expect(typeof model.id).toBe('string')
        expect(typeof model.name).toBe('string')
        expect(typeof model.context_length).toBe('number')
        expect(typeof model.pricing.prompt).toBe('string')
        expect(typeof model.pricing.completion).toBe('string')

        // Optional fields should have correct types when present
        if (model.description) {
          expect(typeof model.description).toBe('string')
        }
        if (model.provider) {
          expect(typeof model.provider).toBe('string')
        }
        if (model.provider_model_id) {
          expect(typeof model.provider_model_id).toBe('string')
        }
      }
    })

    it('should have ResolvedModel type with correct structure', () => {
      const result: ResolvedModel = resolveWithProvider('opus')

      // Required fields
      expect(typeof result.id).toBe('string')
      expect(typeof result.provider).toBe('string')
      expect(typeof result.supportsDirectRouting).toBe('boolean')

      // Optional fields
      if (result.providerModelId !== undefined) {
        expect(typeof result.providerModelId).toBe('string')
      }
      if (result.model !== undefined) {
        expect(typeof result.model).toBe('object')
      }
    })
  })
})

describe('Language Models with @dotdo/ai Router Compatibility', () => {
  /**
   * Tests verifying that language-models resolution is compatible
   * with the @dotdo/ai Router's model selection methods.
   */

  it('should resolve models suitable for Router.selectByCapability pattern', () => {
    // These aliases should map to models the Router can use
    const fastModel = resolve('haiku')
    const smartModel = resolve('opus')
    const cheapModel = resolve('gemini')

    expect(fastModel).toContain('/')
    expect(smartModel).toContain('/')
    expect(cheapModel).toContain('/')
  })

  it('should provide provider information for Router fallback chains', () => {
    const anthropicModel = resolveWithProvider('opus')
    const openaiModel = resolveWithProvider('gpt-4o')
    const googleModel = resolveWithProvider('gemini')

    // Each should have distinct provider for fallback diversity
    expect(anthropicModel.provider).toBe('anthropic')
    expect(openaiModel.provider).toBe('openai')
    expect(googleModel.provider).toBe('google')
  })

  it('should identify models suitable for direct SDK routing', () => {
    // Direct providers should be identified for SDK-level features
    const directRouteModels = ['opus', 'gpt-4o', 'gemini'].map(resolveWithProvider)

    directRouteModels.forEach((model) => {
      expect(model.supportsDirectRouting).toBe(true)
    })
  })

  it('should identify models requiring OpenRouter proxy', () => {
    // Search for models from providers not in DIRECT_PROVIDERS
    const models = list()
    const openrouterModels = models.filter((m) => {
      const provider = m.id.split('/')[0]
      return !(DIRECT_PROVIDERS as readonly string[]).includes(provider)
    })

    // These should have supportsDirectRouting = false
    if (openrouterModels.length > 0) {
      const resolved = resolveWithProvider(openrouterModels[0].id)
      expect(resolved.supportsDirectRouting).toBe(false)
    }
  })
})
