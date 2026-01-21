/**
 * TDD Integration Tests for @dotdo/ai wrapping ai-functions
 *
 * These tests verify that @dotdo/ai properly integrates with the ai-functions
 * package from the primitives submodule. Following TDD approach, these tests
 * are written to FAIL initially, proving the integration is missing.
 *
 * The ai-functions package provides:
 * - Template literals with ai``
 * - Batching (BatchQueue, BatchMapPromise)
 * - Caching (MemoryCache, EmbeddingCache, GenerationCache)
 * - Context management (configure, getContext, withContext)
 * - Budget tracking (BudgetTracker, withBudget)
 * - Retry/resilience patterns
 *
 * @see primitives/packages/ai-functions/src/index.ts
 * @issue do-zr1u.1
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// Current @dotdo/ai exports (what we have now)
import {
  ai,
  createRequestContext,
  runWithContext,
  getCurrentContext,
} from '../index'

// These imports SHOULD work when integration is complete
// They will fail now, proving the integration is missing
describe('ai-functions Integration', () => {
  describe('Template Literal Usage', () => {
    it('should support ai`` template literal from ai-functions', async () => {
      // The ai-functions package exports an `ai` template literal
      // that should work with AIPromise pattern
      const result = ai`Summarize: test content`

      // Basic functionality should work
      expect(result).toBeDefined()
      expect(typeof result.then).toBe('function')
    })

    it('should support chaining methods like .object() for structured output', async () => {
      // ai-functions provides .object() method for structured output
      // This should be integrated into @dotdo/ai
      const promise = ai`Extract name and age from: John is 25 years old`

      // FAILING TEST: @dotdo/ai does not expose .object() method from ai-functions
      // When integrated, this should work:
      // const result = await promise.object({ name: 'string', age: 'number' })
      expect(typeof (promise as any).object).toBe('function')
    })

    it('should support .list() for generating lists', async () => {
      const promise = ai`Generate 3 colors`

      // FAILING TEST: @dotdo/ai does not expose .list() method from ai-functions
      // When integrated, this should work:
      // const colors = await promise.list()
      expect(typeof (promise as any).list).toBe('function')
    })

    it('should support .boolean() for yes/no answers', async () => {
      const promise = ai`Is the sky blue?`

      // FAILING TEST: @dotdo/ai does not expose .boolean() method from ai-functions
      expect(typeof (promise as any).boolean).toBe('function')
    })
  })

  describe('Batching Integration', () => {
    it('should expose BatchQueue from ai-functions', async () => {
      // ai-functions provides BatchQueue for managing batch operations
      // This should be re-exported from @dotdo/ai

      // FAILING TEST: BatchQueue is not exported from @dotdo/ai
      let BatchQueue: any
      try {
        // Dynamic import to check if it's exported
        const aiModule = await import('../index')
        BatchQueue = (aiModule as any).BatchQueue
      } catch {
        BatchQueue = undefined
      }

      expect(BatchQueue).toBeDefined()
    })

    it('should expose createBatch helper from ai-functions', async () => {
      // ai-functions provides createBatch for creating batch jobs

      // FAILING TEST: createBatch is not exported from @dotdo/ai
      const aiModule = await import('../index')
      const createBatch = (aiModule as any).createBatch

      expect(createBatch).toBeDefined()
      expect(typeof createBatch).toBe('function')
    })

    it('should support BatchMapPromise for automatic batching of .map() operations', async () => {
      // ai-functions provides BatchMapPromise for automatic batching
      // When you call .map() on a list result, operations should be batched

      // FAILING TEST: BatchMapPromise is not exported from @dotdo/ai
      const aiModule = await import('../index')
      const BatchMapPromise = (aiModule as any).BatchMapPromise
      const createBatchMap = (aiModule as any).createBatchMap

      expect(BatchMapPromise).toBeDefined()
      expect(createBatchMap).toBeDefined()
    })

    it('should support withBatch for explicit batch context', async () => {
      // ai-functions provides withBatch for running operations in batch mode

      // FAILING TEST: withBatch is not exported from @dotdo/ai
      const aiModule = await import('../index')
      const withBatch = (aiModule as any).withBatch || (aiModule as any).withBatchQueue

      expect(withBatch).toBeDefined()
      expect(typeof withBatch).toBe('function')
    })

    it('should support batch mode configuration in context', async () => {
      // ai-functions allows configuring batch mode via context

      // FAILING TEST: batchMode configuration not exposed
      const aiModule = await import('../index')
      const configure = (aiModule as any).configure

      expect(configure).toBeDefined()

      // When integrated, this should work:
      // configure({ batchMode: 'auto', batchThreshold: 10 })
    })
  })

  describe('Caching Integration', () => {
    it('should expose MemoryCache from ai-functions', async () => {
      // ai-functions provides MemoryCache for in-memory caching with TTL and LRU

      // FAILING TEST: MemoryCache is not exported from @dotdo/ai
      const aiModule = await import('../index')
      const MemoryCache = (aiModule as any).MemoryCache

      expect(MemoryCache).toBeDefined()
    })

    it('should expose EmbeddingCache for caching embeddings', async () => {
      // ai-functions provides EmbeddingCache for content-addressable embedding cache

      // FAILING TEST: EmbeddingCache is not exported from @dotdo/ai
      const aiModule = await import('../index')
      const EmbeddingCache = (aiModule as any).EmbeddingCache

      expect(EmbeddingCache).toBeDefined()
    })

    it('should expose GenerationCache for caching AI generations', async () => {
      // ai-functions provides GenerationCache for caching text/object generations

      // FAILING TEST: GenerationCache is not exported from @dotdo/ai
      const aiModule = await import('../index')
      const GenerationCache = (aiModule as any).GenerationCache

      expect(GenerationCache).toBeDefined()
    })

    it('should expose withCache wrapper for caching functions', async () => {
      // ai-functions provides withCache for wrapping async functions with caching

      // FAILING TEST: withCache is not exported from @dotdo/ai
      const aiModule = await import('../index')
      const withCache = (aiModule as any).withCache

      expect(withCache).toBeDefined()
      expect(typeof withCache).toBe('function')
    })

    it('should expose hashKey and createCacheKey utilities', async () => {
      // ai-functions provides utilities for generating cache keys

      // FAILING TEST: cache key utilities not exported from @dotdo/ai
      const aiModule = await import('../index')
      const hashKey = (aiModule as any).hashKey
      const createCacheKey = (aiModule as any).createCacheKey

      expect(hashKey).toBeDefined()
      expect(createCacheKey).toBeDefined()
    })

    it('MemoryCache should support TTL and LRU eviction', async () => {
      // When integrated, MemoryCache should work like this:

      // FAILING TEST: MemoryCache not available
      const aiModule = await import('../index')
      const MemoryCache = (aiModule as any).MemoryCache

      if (!MemoryCache) {
        expect(MemoryCache).toBeDefined()
        return
      }

      const cache = new MemoryCache({
        maxSize: 100,
        defaultTTL: 60000, // 1 minute
      })

      await cache.set('key1', 'value1')
      const value = await cache.get('key1')
      expect(value).toBe('value1')
    })
  })

  describe('Context Management Integration', () => {
    it('should expose configure from ai-functions for global settings', async () => {
      // ai-functions provides configure for setting global defaults

      // FAILING TEST: ai-functions configure not exposed
      const aiModule = await import('../index')
      const configure = (aiModule as any).configure

      expect(configure).toBeDefined()

      // When integrated, this should work:
      // configure({
      //   provider: 'anthropic',
      //   model: 'claude-sonnet-4-20250514',
      //   batchMode: 'auto',
      // })
    })

    it('should expose getContext from ai-functions', async () => {
      // ai-functions provides getContext for getting current execution context

      // FAILING TEST: ai-functions getContext not exposed (has different one)
      const aiModule = await import('../index')
      const getContext = (aiModule as any).getContext

      // The current @dotdo/ai has a different context implementation
      // This test checks for the ai-functions context
      expect(getContext).toBeDefined()
    })

    it('should expose withContext from ai-functions for scoped settings', async () => {
      // ai-functions provides withContext for running with specific settings

      // Note: @dotdo/ai has runWithContext which is similar but not the same
      // ai-functions withContext supports more options
      const aiModule = await import('../index')
      const withContext = (aiModule as any).withContext

      expect(withContext).toBeDefined()
    })

    it('should support provider configuration in context', async () => {
      // ai-functions context supports provider configuration

      // FAILING TEST: Provider configuration via ai-functions context
      const aiModule = await import('../index')
      const configure = (aiModule as any).configure
      const getProvider = (aiModule as any).getProvider

      if (configure && getProvider) {
        // When integrated:
        // configure({ provider: 'openai' })
        // expect(getProvider()).toBe('openai')
      }

      expect(configure).toBeDefined()
      expect(getProvider).toBeDefined()
    })

    it('should support model configuration in context', async () => {
      // ai-functions context supports model configuration

      const aiModule = await import('../index')
      const configure = (aiModule as any).configure
      const getModel = (aiModule as any).getModel

      if (configure && getModel) {
        // When integrated:
        // configure({ model: 'claude-sonnet-4-20250514' })
        // expect(getModel()).toBe('claude-sonnet-4-20250514')
      }

      expect(getModel).toBeDefined()
    })

    it('withContext should properly scope settings', async () => {
      // ai-functions withContext should scope settings to the callback

      const aiModule = await import('../index')
      const withContext = (aiModule as any).withContext
      const getModel = (aiModule as any).getModel

      if (!withContext || !getModel) {
        expect(withContext).toBeDefined()
        return
      }

      // When integrated, this pattern should work:
      // await withContext({ model: 'gpt-4' }, async () => {
      //   expect(getModel()).toBe('gpt-4')
      // })
    })
  })

  describe('Budget Tracking Integration', () => {
    it('should expose BudgetTracker from ai-functions', async () => {
      // ai-functions provides BudgetTracker for tracking costs and tokens

      // FAILING TEST: BudgetTracker not exported from @dotdo/ai
      const aiModule = await import('../index')
      const BudgetTracker = (aiModule as any).BudgetTracker

      expect(BudgetTracker).toBeDefined()
    })

    it('should expose TokenCounter from ai-functions', async () => {
      // ai-functions provides TokenCounter for counting tokens

      // FAILING TEST: TokenCounter not exported from @dotdo/ai
      const aiModule = await import('../index')
      const TokenCounter = (aiModule as any).TokenCounter

      expect(TokenCounter).toBeDefined()
    })

    it('should expose withBudget for budget-limited operations', async () => {
      // ai-functions provides withBudget wrapper

      // FAILING TEST: withBudget not exported from @dotdo/ai
      const aiModule = await import('../index')
      const withBudget = (aiModule as any).withBudget

      expect(withBudget).toBeDefined()
      expect(typeof withBudget).toBe('function')
    })

    it('should expose BudgetExceededError', async () => {
      // ai-functions provides BudgetExceededError

      // Note: @dotdo/ai has its own BudgetExceededError in tracking.ts
      // This should be compatible or replaced with ai-functions version
      const aiModule = await import('../index')
      const BudgetExceededError = (aiModule as any).BudgetExceededError

      expect(BudgetExceededError).toBeDefined()
    })

    it('should support budget configuration in context', async () => {
      // ai-functions allows budget config in context

      const aiModule = await import('../index')
      const configure = (aiModule as any).configure

      if (configure) {
        // When integrated, this should work:
        // configure({
        //   budget: {
        //     maxTokens: 100000,
        //     maxCost: 10.00,
        //     alertThresholds: [0.5, 0.8, 1.0],
        //   }
        // })
      }

      expect(configure).toBeDefined()
    })
  })

  describe('Retry/Resilience Integration', () => {
    it('should expose RetryPolicy from ai-functions', async () => {
      // ai-functions provides RetryPolicy for configurable retry logic

      // FAILING TEST: RetryPolicy not exported from @dotdo/ai
      const aiModule = await import('../index')
      const RetryPolicy = (aiModule as any).RetryPolicy

      expect(RetryPolicy).toBeDefined()
    })

    it('should expose CircuitBreaker from ai-functions', async () => {
      // ai-functions provides CircuitBreaker for failure protection

      // FAILING TEST: CircuitBreaker not exported from @dotdo/ai
      const aiModule = await import('../index')
      const CircuitBreaker = (aiModule as any).CircuitBreaker

      expect(CircuitBreaker).toBeDefined()
    })

    it('should expose FallbackChain from ai-functions', async () => {
      // ai-functions provides FallbackChain for model fallbacks

      // FAILING TEST: FallbackChain not exported from @dotdo/ai
      const aiModule = await import('../index')
      const FallbackChain = (aiModule as any).FallbackChain

      expect(FallbackChain).toBeDefined()
    })

    it('should expose withRetry helper from ai-functions', async () => {
      // ai-functions provides withRetry convenience wrapper

      // FAILING TEST: withRetry not exported from @dotdo/ai
      const aiModule = await import('../index')
      const withRetry = (aiModule as any).withRetry

      expect(withRetry).toBeDefined()
      expect(typeof withRetry).toBe('function')
    })

    it('should expose error classification utilities', async () => {
      // ai-functions provides error classification for retry decisions

      // FAILING TEST: Error classification not exported from @dotdo/ai
      const aiModule = await import('../index')
      const classifyError = (aiModule as any).classifyError
      const RetryableError = (aiModule as any).RetryableError
      const RateLimitError = (aiModule as any).RateLimitError

      expect(classifyError).toBeDefined()
      expect(RetryableError).toBeDefined()
      expect(RateLimitError).toBeDefined()
    })
  })

  describe('Tool Orchestration Integration', () => {
    it('should expose AgenticLoop from ai-functions', async () => {
      // ai-functions provides AgenticLoop for tool-using agents

      // FAILING TEST: AgenticLoop not exported from @dotdo/ai
      const aiModule = await import('../index')
      const AgenticLoop = (aiModule as any).AgenticLoop

      expect(AgenticLoop).toBeDefined()
    })

    it('should expose ToolRouter from ai-functions', async () => {
      // ai-functions provides ToolRouter for routing tool calls

      // FAILING TEST: ToolRouter not exported from @dotdo/ai
      const aiModule = await import('../index')
      const ToolRouter = (aiModule as any).ToolRouter

      expect(ToolRouter).toBeDefined()
    })

    it('should expose createToolset for composing tools', async () => {
      // ai-functions provides createToolset for tool composition

      // FAILING TEST: createToolset not exported from @dotdo/ai
      const aiModule = await import('../index')
      const createToolset = (aiModule as any).createToolset

      expect(createToolset).toBeDefined()
      expect(typeof createToolset).toBe('function')
    })
  })

  describe('Primitives Integration', () => {
    it('should expose list primitive from ai-functions', async () => {
      // ai-functions provides list`` for generating lists

      // FAILING TEST: list not exported from @dotdo/ai
      const aiModule = await import('../index')
      const list = (aiModule as any).list

      expect(list).toBeDefined()
      expect(typeof list).toBe('function')
    })

    it('should expose extract primitive from ai-functions', async () => {
      // ai-functions provides extract`` for extraction

      // FAILING TEST: extract not exported from @dotdo/ai
      const aiModule = await import('../index')
      const extract = (aiModule as any).extract

      expect(extract).toBeDefined()
    })

    it('should expose is primitive for boolean questions', async () => {
      // ai-functions provides is`` for yes/no questions

      // FAILING TEST: is not exported from @dotdo/ai
      const aiModule = await import('../index')
      const is = (aiModule as any).is

      expect(is).toBeDefined()
    })

    it('should expose research primitive for agentic research', async () => {
      // ai-functions provides research`` for research tasks

      // FAILING TEST: research not exported from @dotdo/ai
      const aiModule = await import('../index')
      const research = (aiModule as any).research

      expect(research).toBeDefined()
    })
  })

  describe('AIPromise Integration', () => {
    it('should expose AIPromise class from ai-functions', async () => {
      // ai-functions provides AIPromise with rich chaining

      // FAILING TEST: AIPromise class not exported from @dotdo/ai
      const aiModule = await import('../index')
      const AIPromise = (aiModule as any).AIPromise

      expect(AIPromise).toBeDefined()
    })

    it('should expose isAIPromise type guard', async () => {
      // ai-functions provides isAIPromise for type checking

      // FAILING TEST: isAIPromise not exported from @dotdo/ai
      const aiModule = await import('../index')
      const isAIPromise = (aiModule as any).isAIPromise

      expect(isAIPromise).toBeDefined()
      expect(typeof isAIPromise).toBe('function')
    })

    it('should expose createTextPromise factory', async () => {
      // ai-functions provides factories for creating typed AIPromises

      // FAILING TEST: createTextPromise not exported from @dotdo/ai
      const aiModule = await import('../index')
      const createTextPromise = (aiModule as any).createTextPromise

      expect(createTextPromise).toBeDefined()
    })

    it('should expose createObjectPromise factory', async () => {
      // ai-functions provides createObjectPromise for structured output

      // FAILING TEST: createObjectPromise not exported from @dotdo/ai
      const aiModule = await import('../index')
      const createObjectPromise = (aiModule as any).createObjectPromise

      expect(createObjectPromise).toBeDefined()
    })
  })

  describe('Embedding Integration', () => {
    it('should expose embedding utilities from ai-functions', async () => {
      // ai-functions provides embedding utilities

      // Note: @dotdo/ai has embedText, this checks for ai-functions version
      const aiModule = await import('../index')
      const embedText = aiModule.embedText

      expect(embedText).toBeDefined()
    })

    it('should support embedding cache integration', async () => {
      // When EmbeddingCache is integrated, embedText should use it

      const aiModule = await import('../index')
      const EmbeddingCache = (aiModule as any).EmbeddingCache
      const embedText = aiModule.embedText

      // FAILING TEST: EmbeddingCache integration with embedText
      expect(EmbeddingCache).toBeDefined()
    })
  })

  describe('Digital Objects Registry Integration', () => {
    it('should expose DigitalObjectsFunctionRegistry', async () => {
      // ai-functions provides DigitalObjectsFunctionRegistry for DO integration

      // FAILING TEST: DigitalObjectsFunctionRegistry not exported
      const aiModule = await import('../index')
      const DigitalObjectsFunctionRegistry = (aiModule as any).DigitalObjectsFunctionRegistry

      expect(DigitalObjectsFunctionRegistry).toBeDefined()
    })

    it('should expose createDigitalObjectsRegistry helper', async () => {
      // ai-functions provides factory for creating DO registry

      // FAILING TEST: createDigitalObjectsRegistry not exported
      const aiModule = await import('../index')
      const createDigitalObjectsRegistry = (aiModule as any).createDigitalObjectsRegistry

      expect(createDigitalObjectsRegistry).toBeDefined()
    })
  })
})

describe('Current @dotdo/ai vs ai-functions Gap Analysis', () => {
  it('should document what @dotdo/ai currently exports', async () => {
    const aiModule = await import('../index')
    const exports = Object.keys(aiModule)

    // Current exports include:
    // Template functions: ai, write, summarize, code
    // Promise: createAIPromise, AIPromise type
    // Providers: configureProviders, providers, model, embeddingModel, etc.
    // Router: Router, etc.
    // Tracking: UsageTracker, globalTracker, countTokens, etc.
    // Context: createRequestContext, runWithContext, getCurrentContext, etc.
    // AI Core: generateText, generateObject, streamText, embedText, etc.

    expect(exports).toContain('ai')
    expect(exports).toContain('generateText')
    expect(exports).toContain('generateObject')

    // These SHOULD be exported but are NOT:
    expect(exports).not.toContain('BatchQueue')
    expect(exports).not.toContain('MemoryCache')
    expect(exports).not.toContain('withBudget')
    expect(exports).not.toContain('RetryPolicy')
  })

  it('should identify missing integrations', () => {
    // This test documents the gap between current @dotdo/ai and ai-functions
    // When integration is complete, this should fail

    const missingIntegrations = [
      // Batching
      'BatchQueue',
      'BatchMapPromise',
      'createBatch',
      'createBatchMap',
      'withBatch',

      // Caching
      'MemoryCache',
      'EmbeddingCache',
      'GenerationCache',
      'withCache',
      'hashKey',
      'createCacheKey',

      // Context (extended)
      'configure', // ai-functions version with batch/budget
      'getContext', // ai-functions version
      'withContext', // ai-functions version
      'getBatchMode',
      'getExecutionTier',

      // Budget
      'BudgetTracker', // ai-functions version (different from UsageTracker)
      'TokenCounter',
      'withBudget',

      // Retry
      'RetryPolicy',
      'CircuitBreaker',
      'FallbackChain',
      'withRetry',
      'classifyError',

      // Tools
      'AgenticLoop',
      'ToolRouter',
      'createToolset',

      // Primitives
      'list',
      'extract',
      'is',
      'research',
      'do',

      // AIPromise
      'AIPromise', // ai-functions class
      'isAIPromise',
      'createTextPromise',
      'createObjectPromise',
      'createListPromise',

      // Digital Objects
      'DigitalObjectsFunctionRegistry',
      'createDigitalObjectsRegistry',
    ]

    // All these should be integrated from ai-functions
    expect(missingIntegrations.length).toBeGreaterThan(0)
  })
})
