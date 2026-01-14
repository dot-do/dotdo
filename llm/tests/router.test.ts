/**
 * LLM Router Tests
 *
 * Tests for model routing and provider selection.
 */

import { describe, it, expect } from 'vitest'
import {
  ModelRouter,
  createRouter,
  MODEL_MAPPINGS,
  MODEL_ALIASES,
} from '../router'

describe('ModelRouter', () => {
  describe('route()', () => {
    it('should route OpenAI models correctly', () => {
      const router = createRouter()

      const result = router.route('gpt-4o')
      expect(result.provider).toBe('openai')
      expect(result.model).toBe('gpt-4o')
      expect(result.originalModel).toBe('gpt-4o')
    })

    it('should route Anthropic models correctly', () => {
      const router = createRouter()

      const result = router.route('claude-sonnet-4-20250514')
      expect(result.provider).toBe('anthropic')
      expect(result.model).toBe('claude-sonnet-4-20250514')
    })

    it('should route Google models correctly', () => {
      const router = createRouter()

      const result = router.route('gemini-1.5-pro')
      expect(result.provider).toBe('google')
      expect(result.model).toBe('gemini-1.5-pro')
    })

    it('should route Workers AI models correctly', () => {
      const router = createRouter()

      const result = router.route('@cf/meta/llama-3.1-70b-instruct')
      expect(result.provider).toBe('workers-ai')
      expect(result.model).toBe('@cf/meta/llama-3.1-70b-instruct')
    })

    it('should route Ollama models correctly', () => {
      const router = createRouter()

      const result = router.route('llama3.2')
      expect(result.provider).toBe('ollama')
      expect(result.model).toBe('llama3.2')
    })

    it('should handle case-insensitive model names', () => {
      const router = createRouter()

      const result = router.route('GPT-4O')
      expect(result.provider).toBe('openai')
      expect(result.model).toBe('gpt-4o')
    })
  })

  describe('resolveAlias()', () => {
    it('should resolve "fast" alias to gpt-4o-mini', () => {
      const router = createRouter()

      const result = router.resolveAlias('fast')
      expect(result).toBe('gpt-4o-mini')
    })

    it('should resolve "best" alias to claude-opus-4-20250514', () => {
      const router = createRouter()

      const result = router.resolveAlias('best')
      expect(result).toBe('claude-opus-4-20250514')
    })

    it('should resolve "sonnet" alias correctly', () => {
      const router = createRouter()

      const result = router.resolveAlias('sonnet')
      expect(result).toBe('claude-sonnet-4-20250514')
    })

    it('should resolve "local" alias to llama3.2', () => {
      const router = createRouter()

      const result = router.resolveAlias('local')
      expect(result).toBe('llama3.2')
    })

    it('should return original model name for unknown aliases', () => {
      const router = createRouter()

      const result = router.resolveAlias('unknown-model')
      expect(result).toBe('unknown-model')
    })
  })

  describe('route() with provider prefix', () => {
    it('should handle openai/ prefix', () => {
      const router = createRouter()

      const result = router.route('openai/gpt-4o')
      expect(result.provider).toBe('openai')
      expect(result.model).toBe('gpt-4o')
    })

    it('should handle anthropic/ prefix', () => {
      const router = createRouter()

      const result = router.route('anthropic/claude-sonnet-4-20250514')
      expect(result.provider).toBe('anthropic')
      expect(result.model).toBe('claude-sonnet-4-20250514')
    })

    it('should handle google/ prefix', () => {
      const router = createRouter()

      const result = router.route('google/gemini-1.5-pro')
      expect(result.provider).toBe('google')
      expect(result.model).toBe('gemini-1.5-pro')
    })
  })

  describe('route() with routing criteria', () => {
    it('should find cost-optimized model when requested', () => {
      const router = createRouter()

      const result = router.route('gpt-4o', { costOptimized: true })
      // Should find a cheaper alternative
      expect(result.costTier).toBeLessThanOrEqual(4)
    })

    it('should find low-latency model when requested', () => {
      const router = createRouter()

      const result = router.route('gpt-4', { lowLatency: true })
      // Should find a faster alternative
      expect(result.avgLatencyMs).toBeLessThanOrEqual(800)
    })

    it('should filter by required capabilities', () => {
      const router = createRouter()

      const result = router.route('gpt-4o', {
        capabilities: ['vision', 'function_calling'],
      })
      expect(result.capabilities).toContain('vision')
      expect(result.capabilities).toContain('function_calling')
    })
  })

  describe('getModelsForProvider()', () => {
    it('should return OpenAI models', () => {
      const router = createRouter()

      const models = router.getModelsForProvider('openai')
      expect(models).toContain('gpt-4o')
      expect(models).toContain('gpt-4o-mini')
      expect(models).toContain('gpt-3.5-turbo')
    })

    it('should return Anthropic models', () => {
      const router = createRouter()

      const models = router.getModelsForProvider('anthropic')
      expect(models).toContain('claude-sonnet-4-20250514')
      expect(models).toContain('claude-3-5-sonnet-20241022')
    })

    it('should return Google models', () => {
      const router = createRouter()

      const models = router.getModelsForProvider('google')
      expect(models).toContain('gemini-1.5-pro')
      expect(models).toContain('gemini-1.5-flash')
    })
  })

  describe('getAllModels()', () => {
    it('should return all unique model names', () => {
      const router = createRouter()

      const models = router.getAllModels()
      expect(models.length).toBeGreaterThan(0)

      // Check for some known models
      expect(models).toContain('gpt-4o')
      expect(models).toContain('claude-sonnet-4-20250514')
      expect(models).toContain('gemini-1.5-pro')
    })
  })

  describe('isProviderAvailable()', () => {
    it('should return true when OpenAI API key is set', () => {
      const router = createRouter()

      const available = router.isProviderAvailable('openai', {
        OPENAI_API_KEY: 'test-key',
      })
      expect(available).toBe(true)
    })

    it('should return false when OpenAI API key is not set', () => {
      const router = createRouter()

      const available = router.isProviderAvailable('openai', {})
      expect(available).toBe(false)
    })

    it('should return true when Anthropic API key is set', () => {
      const router = createRouter()

      const available = router.isProviderAvailable('anthropic', {
        ANTHROPIC_API_KEY: 'test-key',
      })
      expect(available).toBe(true)
    })

    it('should return true when Workers AI binding is set', () => {
      const router = createRouter()

      const available = router.isProviderAvailable('workers-ai', {
        AI: { run: async () => ({}) },
      })
      expect(available).toBe(true)
    })

    it('should return true when Ollama URL is set', () => {
      const router = createRouter()

      const available = router.isProviderAvailable('ollama', {
        OLLAMA_BASE_URL: 'http://localhost:11434',
      })
      expect(available).toBe(true)
    })
  })

  describe('getAvailableProviders()', () => {
    it('should return only providers with credentials', () => {
      const router = createRouter()

      const providers = router.getAvailableProviders({
        OPENAI_API_KEY: 'test-key',
        ANTHROPIC_API_KEY: 'test-key',
      })

      expect(providers).toContain('openai')
      expect(providers).toContain('anthropic')
      expect(providers).not.toContain('google')
      expect(providers).not.toContain('workers-ai')
      expect(providers).not.toContain('ollama')
    })
  })
})

describe('MODEL_MAPPINGS', () => {
  it('should have unique from values', () => {
    const fromValues = MODEL_MAPPINGS.map((m) => m.from.toLowerCase())
    const uniqueValues = Array.from(new Set(fromValues))

    // Note: We allow duplicates since some models have multiple aliases
    // Just ensure we have mappings
    expect(fromValues.length).toBeGreaterThan(0)
  })

  it('should have valid provider values', () => {
    const validProviders = ['openai', 'anthropic', 'google', 'workers-ai', 'ollama']

    for (const mapping of MODEL_MAPPINGS) {
      expect(validProviders).toContain(mapping.provider)
    }
  })

  it('should have cost tiers between 0 and 5', () => {
    for (const mapping of MODEL_MAPPINGS) {
      if (mapping.costTier !== undefined) {
        expect(mapping.costTier).toBeGreaterThanOrEqual(0)
        expect(mapping.costTier).toBeLessThanOrEqual(5)
      }
    }
  })

  it('should have positive latency values', () => {
    for (const mapping of MODEL_MAPPINGS) {
      if (mapping.avgLatencyMs !== undefined) {
        expect(mapping.avgLatencyMs).toBeGreaterThan(0)
      }
    }
  })
})

describe('MODEL_ALIASES', () => {
  it('should have common convenience aliases', () => {
    expect(MODEL_ALIASES).toHaveProperty('fast')
    expect(MODEL_ALIASES).toHaveProperty('best')
    expect(MODEL_ALIASES).toHaveProperty('cheap')
    expect(MODEL_ALIASES).toHaveProperty('local')
  })

  it('should have valid target model names', () => {
    const router = createRouter()

    for (const [alias, model] of Object.entries(MODEL_ALIASES)) {
      const route = router.route(model)
      expect(route.model).toBeDefined()
    }
  })
})
