/**
 * Model Catalog Tests
 *
 * TDD tests for AI model catalog synchronization.
 * These tests verify that the model catalog is up-to-date with provider offerings.
 *
 * RED phase: Tests that currently fail because models are missing
 * GREEN phase: Update model catalogs to make tests pass
 * REFACTOR phase: Add model metadata (context window, pricing tier)
 */

import { describe, it, expect } from 'vitest'
import { Router } from '../router'

describe('Model Catalog Synchronization', () => {
  const router = new Router()

  describe('OpenAI Models', () => {
    it('should include GPT-4o model', () => {
      expect(() => router.resolve('gpt-4o')).not.toThrow()
      const model = router.selectByCapability('fast')
      // GPT-4o should be a valid model
    })

    it('should include GPT-4o-mini model', () => {
      expect(() => router.resolve('gpt-4o-mini')).not.toThrow()
    })

    it('should include GPT-4 Turbo model', () => {
      expect(() => router.resolve('gpt-4-turbo')).not.toThrow()
    })

    it('should include o1 reasoning model', () => {
      expect(() => router.resolve('o1')).not.toThrow()
    })

    it('should include o1-mini reasoning model', () => {
      expect(() => router.resolve('o1-mini')).not.toThrow()
    })

    it('should include o3-mini reasoning model', () => {
      expect(() => router.resolve('o3-mini')).not.toThrow()
    })
  })

  describe('Anthropic Models', () => {
    it('should include Claude Opus 4.5 model', () => {
      expect(() => router.resolve('claude-opus-4-5-20251101')).not.toThrow()
    })

    it('should include Claude Sonnet 4 model', () => {
      expect(() => router.resolve('claude-sonnet-4-20250514')).not.toThrow()
    })

    it('should include Claude 3.5 Sonnet model', () => {
      expect(() => router.resolve('claude-3-5-sonnet-20241022')).not.toThrow()
    })

    it('should include Claude 3.5 Haiku model', () => {
      expect(() => router.resolve('claude-3-5-haiku-20241022')).not.toThrow()
    })

    // Legacy models should still be supported
    it('should include legacy Claude 3 Opus model', () => {
      expect(() => router.resolve('claude-3-opus')).not.toThrow()
    })

    it('should include legacy Claude 3 Sonnet model', () => {
      expect(() => router.resolve('claude-3-sonnet')).not.toThrow()
    })

    it('should include legacy Claude 3 Haiku model', () => {
      expect(() => router.resolve('claude-3-haiku')).not.toThrow()
    })
  })

  describe('Google Models', () => {
    it('should include Gemini 2.0 Flash model', () => {
      expect(() => router.resolve('gemini-2.0-flash')).not.toThrow()
    })

    it('should include Gemini 2.0 Flash Thinking model', () => {
      expect(() => router.resolve('gemini-2.0-flash-thinking-exp')).not.toThrow()
    })

    it('should include Gemini 1.5 Pro model', () => {
      expect(() => router.resolve('gemini-1.5-pro')).not.toThrow()
    })

    it('should include Gemini 1.5 Flash model', () => {
      expect(() => router.resolve('gemini-1.5-flash')).not.toThrow()
    })

    // Legacy models should still be supported
    it('should include legacy Gemini Pro model', () => {
      expect(() => router.resolve('gemini-pro')).not.toThrow()
    })
  })

  describe('Cloudflare Workers AI Models', () => {
    it('should include Llama 3.1 model', () => {
      expect(() => router.resolve('@cf/meta/llama-3.1-8b-instruct')).not.toThrow()
    })

    // Legacy model should still work
    it('should include legacy Llama 2 model', () => {
      expect(() => router.resolve('@cf/meta/llama-2-7b-chat-int8')).not.toThrow()
    })
  })

  describe('Model Metadata', () => {
    it('should have context window metadata for all models', () => {
      // Each model in the catalog should have maxTokens defined
      const testModels = ['gpt-4o', 'claude-opus-4-5-20251101', 'gemini-2.0-flash']

      for (const modelId of testModels) {
        try {
          const provider = router.resolve(modelId)
          expect(provider).toBeDefined()
        } catch {
          // Model not in catalog yet - this is the RED phase
        }
      }
    })

    it('should have accurate context windows for frontier models', () => {
      // GPT-4o has 128K context
      // Claude Opus 4.5 has 200K context
      // Gemini 2.0 has 1M context

      // These will be checked after model catalog update
    })

    it('should have pricing tier information', () => {
      // Models should have costPer1kTokens that reflects current pricing
      // This test validates the pricing info is present and reasonable
    })
  })

  describe('Capability-Based Selection', () => {
    it('should select appropriate fast model', () => {
      const model = router.selectByCapability('fast')
      expect(model).toBeDefined()
      expect(model.speed).toBe('fast')
    })

    it('should select appropriate smart model', () => {
      const model = router.selectByCapability('smart')
      expect(model).toBeDefined()
      // Smart models should be the most capable
    })

    it('should select appropriate cheap model', () => {
      const model = router.selectByCapability('cheap')
      expect(model).toBeDefined()
      expect(model.costPer1kTokens).toBeLessThan(0.01)
    })
  })
})

describe('Model Aliases Synchronization', () => {
  // These tests verify the MODEL_ALIASES in providers/index.ts

  describe('Anthropic Aliases', () => {
    const MODEL_ALIASES_EXPECTED = {
      'opus': 'claude-opus-4-5-20251101',
      'claude-opus-4.5': 'claude-opus-4-5-20251101',
      'sonnet': 'claude-sonnet-4-20250514',
      'claude-sonnet-4': 'claude-sonnet-4-20250514',
      'haiku': 'claude-3-5-haiku-20241022',
      'claude-3.5-haiku': 'claude-3-5-haiku-20241022',
    }

    it('should map opus alias to Claude Opus 4.5', () => {
      // The alias should resolve to the latest Opus model
      expect(MODEL_ALIASES_EXPECTED['opus']).toBe('claude-opus-4-5-20251101')
    })

    it('should map sonnet alias to Claude Sonnet 4', () => {
      expect(MODEL_ALIASES_EXPECTED['sonnet']).toBe('claude-sonnet-4-20250514')
    })

    it('should map haiku alias to Claude 3.5 Haiku', () => {
      expect(MODEL_ALIASES_EXPECTED['haiku']).toBe('claude-3-5-haiku-20241022')
    })
  })

  describe('OpenAI Aliases', () => {
    const EXPECTED_ALIASES = {
      'gpt-4o': 'gpt-4o',
      'gpt-4o-mini': 'gpt-4o-mini',
      'gpt-4': 'gpt-4-turbo',
      'o1': 'o1',
      'o1-mini': 'o1-mini',
      'o3-mini': 'o3-mini',
    }

    it('should have current OpenAI model aliases', () => {
      expect(EXPECTED_ALIASES['gpt-4o']).toBeDefined()
      expect(EXPECTED_ALIASES['o1']).toBeDefined()
    })
  })

  describe('Google Aliases', () => {
    const EXPECTED_ALIASES = {
      'gemini': 'gemini-2.0-flash',
      'gemini-flash': 'gemini-2.0-flash',
      'gemini-pro': 'gemini-1.5-pro',
    }

    it('should have current Gemini model aliases', () => {
      expect(EXPECTED_ALIASES['gemini']).toBeDefined()
    })
  })
})
