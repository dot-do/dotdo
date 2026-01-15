/**
 * AI Operations Tests - TDD RED Phase
 *
 * Template literal AI with:
 * - Lazy evaluation (AIPromise)
 * - Batch modes (immediate/flex/deferred)
 * - Budget tracking and caching
 * - Provider abstraction
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ai, is, list, code, AIPromise, createAI, AIBudgetExceededError } from './index'

// =============================================================================
// 1. Template Literal Functions
// =============================================================================

describe('Template Literal Functions', () => {
  describe('ai`...` - General AI operations', () => {
    it('returns an AIPromise when called', () => {
      const result = ai`Summarize: test document`
      expect(result).toBeInstanceOf(AIPromise)
    })

    it('resolves to a string when awaited', async () => {
      const result = await ai`Summarize: test document`
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('interpolates variables correctly', async () => {
      const document = 'This is a test document about TypeScript.'
      const result = await ai`Summarize: ${document}`
      expect(typeof result).toBe('string')
    })

    it('handles multiple interpolations', async () => {
      const topic = 'machine learning'
      const style = 'brief'
      const result = await ai`Write a ${style} summary about ${topic}`
      expect(typeof result).toBe('string')
    })

    it('handles empty string interpolations', async () => {
      const empty = ''
      const result = await ai`Process: ${empty}`
      expect(typeof result).toBe('string')
    })
  })

  describe('is`...` - Classification operations', () => {
    it('returns an AIPromise', () => {
      const result = is`Test text positive or negative?`
      expect(result).toBeInstanceOf(AIPromise)
    })

    it('returns one of the provided options', async () => {
      const text = 'I love this product!'
      const result = await is`${text} positive or negative?`
      expect(['positive', 'negative']).toContain(result)
    })

    it('handles multiple classification options', async () => {
      const text = 'The weather is cloudy today.'
      const result = await is`${text} positive, negative, or neutral?`
      expect(['positive', 'negative', 'neutral']).toContain(result)
    })

    it('handles yes/no questions', async () => {
      const statement = 'The sky is blue.'
      const result = await is`${statement} true or false?`
      expect(['true', 'false']).toContain(result)
    })

    it('extracts options from natural language', async () => {
      const text = 'I feel okay today.'
      const result = await is`Is ${text} happy, sad, angry, or neutral?`
      expect(['happy', 'sad', 'angry', 'neutral']).toContain(result)
    })
  })

  describe('list`...` - List extraction operations', () => {
    it('returns an AIPromise', () => {
      const result = list`Extract items from: test text`
      expect(result).toBeInstanceOf(AIPromise)
    })

    it('resolves to an array', async () => {
      const text = 'Buy milk, eggs, and bread.'
      const result = await list`Extract items from: ${text}`
      expect(Array.isArray(result)).toBe(true)
    })

    it('extracts items correctly', async () => {
      const text = 'The primary colors are red, blue, and yellow.'
      const result = await list`Extract colors from: ${text}`
      expect(result.length).toBeGreaterThan(0)
      expect(result.every(item => typeof item === 'string')).toBe(true)
    })

    it('handles numbered lists', async () => {
      const text = '1. First item 2. Second item 3. Third item'
      const result = await list`Extract numbered items from: ${text}`
      expect(result.length).toBe(3)
    })

    it('returns empty array for no matches', async () => {
      const text = 'No items here.'
      const result = await list`Extract email addresses from: ${text}`
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(0)
    })
  })

  describe('code`...` - Code generation operations', () => {
    it('returns an AIPromise', () => {
      const result = code`TypeScript function to add two numbers`
      expect(result).toBeInstanceOf(AIPromise)
    })

    it('resolves to a string of code', async () => {
      const desc = 'add two numbers'
      const result = await code`TypeScript function to ${desc}`
      expect(typeof result).toBe('string')
      expect(result).toContain('function')
    })

    it('generates code without markdown fences', async () => {
      const result = await code`JavaScript function to sort an array`
      expect(result).not.toMatch(/^```/)
      expect(result).not.toMatch(/```$/)
    })

    it('generates typed code when type is specified', async () => {
      const result = await code`TypeScript function with generics to swap two values`
      expect(result).toContain('<')
      expect(result).toContain('>')
    })

    it('generates code for different languages', async () => {
      const result = await code`Python function to reverse a string`
      expect(result).toContain('def ')
    })
  })
})

// =============================================================================
// 2. AIPromise (Lazy Evaluation)
// =============================================================================

describe('AIPromise - Lazy Evaluation', () => {
  describe('Deferred execution', () => {
    it('does not execute until awaited', async () => {
      const executeSpy = vi.fn()

      // Create a mock AI that tracks execution
      const mockAI = createAI({
        provider: {
          execute: async (prompt: string) => {
            executeSpy(prompt)
            return 'result'
          },
        },
      })

      const promise = mockAI`Test prompt`

      // Not executed yet
      expect(executeSpy).not.toHaveBeenCalled()

      // Now execute
      await promise

      expect(executeSpy).toHaveBeenCalledTimes(1)
    })

    it('does not execute until .then() is called', async () => {
      const executeSpy = vi.fn()

      const mockAI = createAI({
        provider: {
          execute: async (prompt: string) => {
            executeSpy(prompt)
            return 'result'
          },
        },
      })

      const promise = mockAI`Test prompt`
      expect(executeSpy).not.toHaveBeenCalled()

      await promise.then((result) => result)
      expect(executeSpy).toHaveBeenCalledTimes(1)
    })

    it('caches result after first execution', async () => {
      const executeSpy = vi.fn()

      const mockAI = createAI({
        provider: {
          execute: async (prompt: string) => {
            executeSpy(prompt)
            return 'result'
          },
        },
      })

      const promise = mockAI`Test prompt`

      // Execute multiple times
      await promise
      await promise
      await promise

      // Should only execute once
      expect(executeSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('Composition', () => {
    it('can compose nested AIPromises', async () => {
      const summary = ai`Summarize: short text`
      const analysis = ai`Analyze: ${summary}`

      const result = await analysis
      expect(typeof result).toBe('string')
    })

    it('resolves nested promises before execution', async () => {
      const first = ai`First: hello`
      const second = ai`Second: world`
      const combined = ai`Combine: ${first} and ${second}`

      const result = await combined
      expect(typeof result).toBe('string')
    })

    it('handles deeply nested compositions', async () => {
      const a = ai`Step A`
      const b = ai`Step B with ${a}`
      const c = ai`Step C with ${b}`
      const d = ai`Step D with ${c}`

      const result = await d
      expect(typeof result).toBe('string')
    })

    it('preserves types through composition', async () => {
      const items = list`Items: one, two, three`
      const count = ai`Count items: ${items}`

      const result = await count
      expect(typeof result).toBe('string')
    })
  })

  describe('Promise methods', () => {
    it('supports .then()', async () => {
      const result = await ai`Test`.then((r) => r.toUpperCase())
      expect(typeof result).toBe('string')
    })

    it('supports .catch()', async () => {
      const mockAI = createAI({
        provider: {
          execute: async () => {
            throw new Error('Test error')
          },
        },
      })

      const result = await mockAI`Test`.catch((e) => e.message)
      expect(result).toBe('Test error')
    })

    it('supports .finally()', async () => {
      const finallySpy = vi.fn()

      await ai`Test`.finally(finallySpy)

      expect(finallySpy).toHaveBeenCalled()
    })

    it('is thenable (works with Promise.all)', async () => {
      const promises = [ai`First`, ai`Second`, ai`Third`]
      const results = await Promise.all(promises)

      expect(results.length).toBe(3)
      expect(results.every((r) => typeof r === 'string')).toBe(true)
    })

    it('works with Promise.race', async () => {
      const fast = ai`Fast response`
      const slow = ai`Slow response`

      const result = await Promise.race([fast, slow])
      expect(typeof result).toBe('string')
    })
  })

  describe('Cancellation', () => {
    it('can be cancelled before execution', async () => {
      const promise = ai`Test prompt`

      promise.cancel()

      await expect(promise).rejects.toThrow('Cancelled')
    })

    it('cannot be cancelled after execution starts', async () => {
      const promise = ai`Test prompt`

      // Start execution
      const resultPromise = promise.then((r) => r)

      // Try to cancel (should have no effect or throw)
      const cancelled = promise.cancel()

      expect(cancelled).toBe(false)

      // Should still resolve
      const result = await resultPromise
      expect(typeof result).toBe('string')
    })

    it('exposes cancelled state', () => {
      const promise = ai`Test prompt`

      expect(promise.cancelled).toBe(false)

      promise.cancel()

      expect(promise.cancelled).toBe(true)
    })
  })
})

// =============================================================================
// 3. Batch Modes
// =============================================================================

describe('Batch Modes', () => {
  describe('ai.batch() - Batch processing', () => {
    it('accepts an array of items', async () => {
      const items = ['item1', 'item2', 'item3']
      const results = await ai.batch(items, 'immediate')

      expect(Array.isArray(results)).toBe(true)
      expect(results.length).toBe(3)
    })

    it('returns results in the same order as inputs', async () => {
      const items = ['first', 'second', 'third']
      const results = await ai.batch(items, 'immediate')

      expect(results.length).toBe(items.length)
    })
  })

  describe('immediate mode', () => {
    it('executes all items immediately', async () => {
      const startTime = Date.now()
      const items = ['a', 'b', 'c']

      await ai.batch(items, 'immediate')

      const elapsed = Date.now() - startTime
      // Should complete without artificial delay
      expect(elapsed).toBeLessThan(10000)
    })

    it('charges full price per item', async () => {
      const initialBudget = ai.budget.remaining

      await ai.batch(['test'], 'immediate')

      const cost = initialBudget - ai.budget.remaining
      expect(cost).toBeGreaterThan(0)
    })
  })

  describe('flex mode', () => {
    it('accepts flex mode parameter', async () => {
      const items = ['item1', 'item2']
      const results = await ai.batch(items, 'flex')

      expect(Array.isArray(results)).toBe(true)
    })

    it('costs less than immediate mode', async () => {
      // Reset budget tracking
      const aiInstance1 = createAI({ budget: { limit: 1000 } })
      const aiInstance2 = createAI({ budget: { limit: 1000 } })

      await aiInstance1.batch(['test'], 'immediate')
      await aiInstance2.batch(['test'], 'flex')

      expect(aiInstance2.budget.spent).toBeLessThan(aiInstance1.budget.spent)
    })

    it('may batch with other requests for efficiency', async () => {
      // Implementation detail: flex mode allows the provider to batch
      const results = await ai.batch(['a', 'b', 'c', 'd', 'e'], 'flex')
      expect(results.length).toBe(5)
    })
  })

  describe('deferred mode', () => {
    it('accepts deferred mode parameter', async () => {
      const items = ['item1', 'item2']
      const results = await ai.batch(items, 'deferred')

      expect(Array.isArray(results)).toBe(true)
    })

    it('costs less than flex mode', async () => {
      const aiInstance1 = createAI({ budget: { limit: 1000 } })
      const aiInstance2 = createAI({ budget: { limit: 1000 } })

      await aiInstance1.batch(['test'], 'flex')
      await aiInstance2.batch(['test'], 'deferred')

      expect(aiInstance2.budget.spent).toBeLessThan(aiInstance1.budget.spent)
    })

    it('returns a batch ID for tracking', async () => {
      const result = ai.batch(['a', 'b'], 'deferred')

      expect(result.batchId).toBeDefined()
      expect(typeof result.batchId).toBe('string')
    })

    it('can check batch status', async () => {
      const result = ai.batch(['a', 'b'], 'deferred')

      const status = await ai.batch.status(result.batchId)
      expect(['pending', 'processing', 'completed']).toContain(status)
    })
  })

  describe('batch with template function', () => {
    it('applies template to each item', async () => {
      const items = ['apple', 'banana', 'cherry']
      const results = await ai.batch(
        items,
        'immediate',
        (item) => ai`Describe: ${item}`
      )

      expect(results.length).toBe(3)
      expect(results.every((r) => typeof r === 'string')).toBe(true)
    })

    it('supports is`...` template', async () => {
      const items = ['I love it!', 'I hate it!', 'It is okay.']
      const results = await ai.batch(
        items,
        'immediate',
        (item) => is`${item} positive, negative, or neutral?`
      )

      expect(results.length).toBe(3)
      results.forEach((r) => {
        expect(['positive', 'negative', 'neutral']).toContain(r)
      })
    })

    it('supports list`...` template', async () => {
      const texts = [
        'red, blue, green',
        'apple, banana',
        'one, two, three, four',
      ]
      const results = await ai.batch(
        texts,
        'immediate',
        (text) => list`Extract items: ${text}`
      )

      expect(results.length).toBe(3)
      expect(results.every((r) => Array.isArray(r))).toBe(true)
    })
  })
})

// =============================================================================
// 4. Budget Tracking
// =============================================================================

describe('Budget Tracking', () => {
  describe('ai.budget.remaining', () => {
    it('returns available budget as number', () => {
      const remaining = ai.budget.remaining

      expect(typeof remaining).toBe('number')
      expect(remaining).toBeGreaterThanOrEqual(0)
    })

    it('decreases after operations', async () => {
      const aiInstance = createAI({ budget: { limit: 100 } })
      const before = aiInstance.budget.remaining

      await aiInstance`Test prompt`

      const after = aiInstance.budget.remaining
      expect(after).toBeLessThan(before)
    })
  })

  describe('ai.budget.spent', () => {
    it('returns spent amount as number', () => {
      const spent = ai.budget.spent

      expect(typeof spent).toBe('number')
      expect(spent).toBeGreaterThanOrEqual(0)
    })

    it('increases after operations', async () => {
      const aiInstance = createAI({ budget: { limit: 100 } })
      const before = aiInstance.budget.spent

      await aiInstance`Test prompt`

      const after = aiInstance.budget.spent
      expect(after).toBeGreaterThan(before)
    })

    it('equals limit minus remaining', async () => {
      const aiInstance = createAI({ budget: { limit: 100 } })

      await aiInstance`Test`

      expect(aiInstance.budget.spent + aiInstance.budget.remaining).toBe(100)
    })
  })

  describe('ai.budget.limit()', () => {
    it('sets a budget limit', () => {
      const aiInstance = createAI()
      aiInstance.budget.limit(100)

      expect(aiInstance.budget.remaining).toBe(100)
    })

    it('returns the AI instance for chaining', () => {
      const aiInstance = createAI()
      const result = aiInstance.budget.limit(100)

      expect(result).toBe(aiInstance)
    })

    it('can be set multiple times', () => {
      const aiInstance = createAI()
      aiInstance.budget.limit(100)
      aiInstance.budget.limit(200)

      expect(aiInstance.budget.remaining).toBe(200)
    })
  })

  describe('Budget exceeded', () => {
    it('throws AIBudgetExceededError when budget exceeded', async () => {
      const aiInstance = createAI({ budget: { limit: 0.001 } })

      await expect(aiInstance`Test prompt`).rejects.toThrow(AIBudgetExceededError)
    })

    it('includes spent amount in error', async () => {
      const aiInstance = createAI({ budget: { limit: 0.001 } })

      try {
        await aiInstance`Test prompt`
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(AIBudgetExceededError)
        expect((e as AIBudgetExceededError).spent).toBeDefined()
      }
    })

    it('includes limit in error', async () => {
      const aiInstance = createAI({ budget: { limit: 0.001 } })

      try {
        await aiInstance`Test prompt`
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(AIBudgetExceededError)
        expect((e as AIBudgetExceededError).limit).toBe(0.001)
      }
    })

    it('includes requested cost in error', async () => {
      const aiInstance = createAI({ budget: { limit: 0.001 } })

      try {
        await aiInstance`Test prompt`
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(AIBudgetExceededError)
        expect((e as AIBudgetExceededError).requested).toBeGreaterThan(0)
      }
    })
  })

  describe('Budget tracking across operations', () => {
    it('tracks cumulative spending', async () => {
      const aiInstance = createAI({ budget: { limit: 100 } })

      await aiInstance`First`
      const afterFirst = aiInstance.budget.spent

      await aiInstance`Second`
      const afterSecond = aiInstance.budget.spent

      expect(afterSecond).toBeGreaterThan(afterFirst)
    })

    it('tracks spending across different operation types', async () => {
      const aiInstance = createAI({ budget: { limit: 100 } })

      await aiInstance`Generate text`
      const afterAi = aiInstance.budget.spent

      await aiInstance.is`Test positive or negative?`
      const afterIs = aiInstance.budget.spent

      await aiInstance.list`Items: a, b, c`
      const afterList = aiInstance.budget.spent

      expect(afterIs).toBeGreaterThan(afterAi)
      expect(afterList).toBeGreaterThan(afterIs)
    })
  })
})

// =============================================================================
// 5. Response Caching
// =============================================================================

describe('Response Caching', () => {
  describe('Cache behavior', () => {
    it('returns cached result for same prompt', async () => {
      const executeSpy = vi.fn().mockResolvedValue('result')

      const aiInstance = createAI({
        provider: { execute: executeSpy },
        cache: { enabled: true },
      })

      await aiInstance`Same prompt`
      await aiInstance`Same prompt`
      await aiInstance`Same prompt`

      expect(executeSpy).toHaveBeenCalledTimes(1)
    })

    it('does not cache different prompts', async () => {
      const executeSpy = vi.fn().mockResolvedValue('result')

      const aiInstance = createAI({
        provider: { execute: executeSpy },
        cache: { enabled: true },
      })

      await aiInstance`Prompt 1`
      await aiInstance`Prompt 2`
      await aiInstance`Prompt 3`

      expect(executeSpy).toHaveBeenCalledTimes(3)
    })

    it('cache key includes interpolated values', async () => {
      const executeSpy = vi.fn().mockResolvedValue('result')

      const aiInstance = createAI({
        provider: { execute: executeSpy },
        cache: { enabled: true },
      })

      await aiInstance`Process: ${'value1'}`
      await aiInstance`Process: ${'value2'}`

      expect(executeSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe('Cache key includes model', () => {
    it('different models produce different cache keys', async () => {
      const executeSpy = vi.fn().mockResolvedValue('result')

      const aiGPT4 = createAI({
        provider: { execute: executeSpy },
        model: 'gpt-4',
        cache: { enabled: true },
      })

      const aiClaude = createAI({
        provider: { execute: executeSpy },
        model: 'claude-3-opus',
        cache: { enabled: true },
      })

      await aiGPT4`Same prompt`
      await aiClaude`Same prompt`

      expect(executeSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe('TTL-based expiration', () => {
    it('respects TTL configuration', async () => {
      vi.useFakeTimers()

      const executeSpy = vi.fn().mockResolvedValue('result')

      const aiInstance = createAI({
        provider: { execute: executeSpy },
        cache: { enabled: true, ttl: 1000 },
      })

      await aiInstance`Test prompt`
      expect(executeSpy).toHaveBeenCalledTimes(1)

      // Within TTL
      vi.advanceTimersByTime(500)
      await aiInstance`Test prompt`
      expect(executeSpy).toHaveBeenCalledTimes(1)

      // After TTL
      vi.advanceTimersByTime(600)
      await aiInstance`Test prompt`
      expect(executeSpy).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
    })

    it('default TTL is reasonable', async () => {
      const aiInstance = createAI({
        cache: { enabled: true },
      })

      // Default TTL should be at least 5 minutes
      expect(aiInstance.cache.ttl).toBeGreaterThanOrEqual(5 * 60 * 1000)
    })
  })

  describe('ai.cache.clear()', () => {
    it('clears all cached responses', async () => {
      const executeSpy = vi.fn().mockResolvedValue('result')

      const aiInstance = createAI({
        provider: { execute: executeSpy },
        cache: { enabled: true },
      })

      await aiInstance`Test prompt`
      expect(executeSpy).toHaveBeenCalledTimes(1)

      aiInstance.cache.clear()

      await aiInstance`Test prompt`
      expect(executeSpy).toHaveBeenCalledTimes(2)
    })

    it('returns number of cleared entries', async () => {
      const executeSpy = vi.fn().mockResolvedValue('result')

      const aiInstance = createAI({
        provider: { execute: executeSpy },
        cache: { enabled: true },
      })

      await aiInstance`Prompt 1`
      await aiInstance`Prompt 2`
      await aiInstance`Prompt 3`

      const cleared = aiInstance.cache.clear()
      expect(cleared).toBe(3)
    })
  })

  describe('Cache configuration', () => {
    it('can disable caching', async () => {
      const executeSpy = vi.fn().mockResolvedValue('result')

      const aiInstance = createAI({
        provider: { execute: executeSpy },
        cache: { enabled: false },
      })

      await aiInstance`Same prompt`
      await aiInstance`Same prompt`

      expect(executeSpy).toHaveBeenCalledTimes(2)
    })

    it('can set cache size limit', async () => {
      const executeSpy = vi.fn().mockResolvedValue('result')

      const aiInstance = createAI({
        provider: { execute: executeSpy },
        cache: { enabled: true, maxSize: 2 },
      })

      await aiInstance`Prompt 1`
      await aiInstance`Prompt 2`
      await aiInstance`Prompt 3`

      // Prompt 1 should be evicted
      await aiInstance`Prompt 1`
      expect(executeSpy).toHaveBeenCalledTimes(4)
    })
  })
})

// =============================================================================
// 6. Provider Abstraction
// =============================================================================

describe('Provider Abstraction', () => {
  describe('ai.provider()', () => {
    it('can set provider to openai', () => {
      const aiInstance = ai.provider('openai')
      expect(aiInstance).toBeDefined()
    })

    it('can set provider to anthropic', () => {
      const aiInstance = ai.provider('anthropic')
      expect(aiInstance).toBeDefined()
    })

    it('returns a new AI instance with the provider set', () => {
      const openaiInstance = ai.provider('openai')
      const anthropicInstance = ai.provider('anthropic')

      expect(openaiInstance).not.toBe(anthropicInstance)
    })

    it('supports chaining', async () => {
      const result = await ai.provider('openai')`Test prompt`
      expect(typeof result).toBe('string')
    })

    it('throws for unknown provider', () => {
      expect(() => ai.provider('unknown' as any)).toThrow()
    })
  })

  describe('ai.model()', () => {
    it('can set model to claude-3-opus', () => {
      const aiInstance = ai.model('claude-3-opus')
      expect(aiInstance).toBeDefined()
    })

    it('can set model to gpt-4', () => {
      const aiInstance = ai.model('gpt-4')
      expect(aiInstance).toBeDefined()
    })

    it('can set model to gpt-4-turbo', () => {
      const aiInstance = ai.model('gpt-4-turbo')
      expect(aiInstance).toBeDefined()
    })

    it('returns a new AI instance with the model set', () => {
      const opusInstance = ai.model('claude-3-opus')
      const gpt4Instance = ai.model('gpt-4')

      expect(opusInstance).not.toBe(gpt4Instance)
    })

    it('supports chaining with provider', () => {
      const aiInstance = ai.provider('anthropic').model('claude-3-opus')
      expect(aiInstance).toBeDefined()
    })

    it('infers provider from model name', () => {
      const claudeInstance = ai.model('claude-3-opus')
      const gptInstance = ai.model('gpt-4')

      // Both should work without explicit provider
      expect(claudeInstance).toBeDefined()
      expect(gptInstance).toBeDefined()
    })
  })

  describe('Provider-specific behavior', () => {
    it('uses correct API format for openai', async () => {
      const requestSpy = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'result' } }] })

      const aiInstance = createAI({
        providers: {
          openai: { request: requestSpy },
        },
      })

      await aiInstance.provider('openai')`Test prompt`

      expect(requestSpy).toHaveBeenCalled()
      const call = requestSpy.mock.calls[0][0]
      expect(call.messages).toBeDefined()
    })

    it('uses correct API format for anthropic', async () => {
      const requestSpy = vi.fn().mockResolvedValue({ content: [{ text: 'result' }] })

      const aiInstance = createAI({
        providers: {
          anthropic: { request: requestSpy },
        },
      })

      await aiInstance.provider('anthropic')`Test prompt`

      expect(requestSpy).toHaveBeenCalled()
      const call = requestSpy.mock.calls[0][0]
      expect(call.messages).toBeDefined()
    })
  })

  describe('Environment configuration', () => {
    it('reads API keys from environment', () => {
      // The implementation should read OPENAI_API_KEY, ANTHROPIC_API_KEY
      const aiInstance = createAI()
      expect(aiInstance.providers.openai.configured).toBeDefined()
      expect(aiInstance.providers.anthropic.configured).toBeDefined()
    })

    it('allows manual API key configuration', () => {
      const aiInstance = createAI({
        providers: {
          openai: { apiKey: 'sk-test-key' },
        },
      })

      expect(aiInstance.providers.openai.configured).toBe(true)
    })
  })

  describe('Fallback behavior', () => {
    it('falls back to another provider on failure', async () => {
      const openaiSpy = vi.fn().mockRejectedValue(new Error('Rate limited'))
      const anthropicSpy = vi.fn().mockResolvedValue('result')

      const aiInstance = createAI({
        providers: {
          openai: { execute: openaiSpy },
          anthropic: { execute: anthropicSpy },
        },
        fallback: ['openai', 'anthropic'],
      })

      const result = await aiInstance.provider('openai')`Test prompt`

      expect(result).toBe('result')
      expect(openaiSpy).toHaveBeenCalled()
      expect(anthropicSpy).toHaveBeenCalled()
    })

    it('does not fallback when disabled', async () => {
      const openaiSpy = vi.fn().mockRejectedValue(new Error('Rate limited'))

      const aiInstance = createAI({
        providers: {
          openai: { execute: openaiSpy },
        },
        fallback: false,
      })

      await expect(aiInstance.provider('openai')`Test prompt`).rejects.toThrow('Rate limited')
    })
  })
})

// =============================================================================
// Additional Edge Cases and Integration Tests
// =============================================================================

describe('Edge Cases', () => {
  describe('Empty and special inputs', () => {
    it('handles empty template string', async () => {
      const result = await ai``
      expect(typeof result).toBe('string')
    })

    it('handles template with only whitespace', async () => {
      const result = await ai`   `
      expect(typeof result).toBe('string')
    })

    it('handles very long prompts', async () => {
      const longText = 'x'.repeat(10000)
      const result = await ai`Process: ${longText}`
      expect(typeof result).toBe('string')
    })

    it('handles unicode characters', async () => {
      const unicodeText = 'Hello 世界! 🌍 Привет мир!'
      const result = await ai`Translate: ${unicodeText}`
      expect(typeof result).toBe('string')
    })

    it('handles null-ish interpolations gracefully', async () => {
      const nullValue = null as any
      const undefinedValue = undefined as any

      const result1 = await ai`Value: ${nullValue}`
      const result2 = await ai`Value: ${undefinedValue}`

      expect(typeof result1).toBe('string')
      expect(typeof result2).toBe('string')
    })
  })

  describe('Concurrent operations', () => {
    it('handles multiple concurrent requests', async () => {
      const promises = Array.from({ length: 10 }, (_, i) => ai`Request ${i}`)
      const results = await Promise.all(promises)

      expect(results.length).toBe(10)
      expect(results.every((r) => typeof r === 'string')).toBe(true)
    })

    it('maintains budget accuracy under concurrent load', async () => {
      const aiInstance = createAI({ budget: { limit: 100 } })

      const promises = Array.from({ length: 5 }, (_, i) => aiInstance`Request ${i}`)
      await Promise.all(promises)

      expect(aiInstance.budget.spent + aiInstance.budget.remaining).toBe(100)
    })
  })

  describe('Error handling', () => {
    it('provides meaningful error messages', async () => {
      const aiInstance = createAI({
        provider: {
          execute: async () => {
            throw new Error('API Error: Invalid request')
          },
        },
      })

      try {
        await aiInstance`Test`
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as Error).message).toContain('API Error')
      }
    })

    it('preserves error stack traces', async () => {
      const aiInstance = createAI({
        provider: {
          execute: async () => {
            throw new Error('Test error')
          },
        },
      })

      try {
        await aiInstance`Test`
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as Error).stack).toBeDefined()
      }
    })
  })
})

describe('Integration Scenarios', () => {
  describe('Real-world workflows', () => {
    it('processes documents with summarization and extraction', async () => {
      const document = `
        Meeting Notes - January 15, 2024
        Attendees: Alice, Bob, Charlie

        Action Items:
        1. Alice to review the proposal by Friday
        2. Bob to schedule follow-up meeting
        3. Charlie to prepare presentation

        Key Decisions:
        - Approved Q1 budget
        - Delayed project X to Q2
      `

      const summary = await ai`Summarize this meeting: ${document}`
      const actionItems = await list`Extract action items from: ${document}`
      const sentiment = await is`Is this meeting ${document} positive, negative, or neutral?`

      expect(typeof summary).toBe('string')
      expect(Array.isArray(actionItems)).toBe(true)
      expect(['positive', 'negative', 'neutral']).toContain(sentiment)
    })

    it('generates and validates code', async () => {
      const spec = 'a function that validates email addresses'
      const generatedCode = await code`TypeScript function for ${spec}`

      expect(generatedCode).toContain('function')
      expect(generatedCode).toContain('email')
    })

    it('chains operations for complex analysis', async () => {
      const rawData = 'Product reviews: Great quality! Terrible shipping. Amazing value.'

      // Extract individual reviews
      const reviews = await list`Extract individual reviews from: ${rawData}`

      // Analyze each review
      const analyses = await ai.batch(
        reviews,
        'immediate',
        (review) => is`${review} positive, negative, or neutral?`
      )

      expect(reviews.length).toBeGreaterThan(0)
      expect(analyses.length).toBe(reviews.length)
    })
  })
})
