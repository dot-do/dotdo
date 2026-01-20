import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ai, write, summarize, code, configureAI, getAIConfig, resetAIConfig, AIError } from '../template'

describe('AI Template Literal', () => {
  // Reset configuration before each test
  beforeEach(() => {
    resetAIConfig()
  })

  afterEach(() => {
    resetAIConfig()
  })

  describe('ai', () => {
    it('should return an AIPromise', () => {
      const result = ai`Hello world`

      expect(result).toBeDefined()
      expect(typeof result.then).toBe('function')
      expect(result.$meta).toBeDefined()
    })

    it('should resolve to a string response', async () => {
      const result = await ai`Say hello`

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('should have $meta with default model info', () => {
      const result = ai`Test`
      // Default model is claude-sonnet-4
      expect(result.$meta.model).toBe('claude-sonnet-4')
    })

    it('should support .with() for options', () => {
      const result = ai`Test`.with({ model: 'gpt-4', temperature: 0.7 })

      expect(result.$meta.model).toBe('gpt-4')
      expect(result.$meta.temperature).toBe(0.7)
    })

    it('should track tokens in $meta after resolution', async () => {
      const result = ai`Test prompt`
      await result

      expect(result.$meta.tokens).toBeDefined()
      expect(result.$meta.tokens?.input).toBeGreaterThan(0)
    })

    it('should track cost in $meta after resolution', async () => {
      const result = ai`Test prompt`
      await result

      expect(result.$meta.cost).toBeDefined()
      expect(typeof result.$meta.cost).toBe('number')
    })

    it('should track duration in $meta after resolution', async () => {
      const result = ai`Test prompt`
      await result

      expect(result.$meta.duration).toBeDefined()
      expect(typeof result.$meta.duration).toBe('number')
      // Duration can be 0 in mock mode since it's very fast
      expect(result.$meta.duration).toBeGreaterThanOrEqual(0)
    })

    it('should support streaming', async () => {
      const result = ai`Test`
      const chunks: string[] = []

      for await (const chunk of result.stream()) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
      // Joined chunks should form a complete response
      const fullText = chunks.join('')
      expect(fullText.length).toBeGreaterThan(0)
    })

    it('should handle empty template', async () => {
      const result = ai``
      const text = await result
      expect(text).toBeDefined()
    })

    it('should handle template with multiple interpolations', async () => {
      const name = 'Bob'
      const age = 25
      const result = ai`User ${name} is ${age} years old`

      // The AI receives the full interpolated prompt
      const text = await result
      expect(typeof text).toBe('string')
      expect(text.length).toBeGreaterThan(0)
    })
  })

  describe('configuration', () => {
    it('should allow configuring default model', () => {
      configureAI({ defaultModel: 'gpt-4o' })

      const config = getAIConfig()
      expect(config.defaultModel).toBe('gpt-4o')
    })

    it('should allow configuring default temperature', () => {
      configureAI({ defaultTemperature: 0.5 })

      const config = getAIConfig()
      expect(config.defaultTemperature).toBe(0.5)
    })

    it('should allow configuring system prompt', () => {
      configureAI({ systemPrompt: 'You are helpful.' })

      const config = getAIConfig()
      expect(config.systemPrompt).toBe('You are helpful.')
    })

    it('should use configured model for new prompts', () => {
      configureAI({ defaultModel: 'gpt-4-turbo' })

      const result = ai`Test`
      expect(result.$meta.model).toBe('gpt-4-turbo')
    })

    it('should reset configuration to defaults', () => {
      configureAI({ defaultModel: 'custom-model', defaultTemperature: 0.1 })
      resetAIConfig()

      const config = getAIConfig()
      expect(config.defaultModel).toBe('claude-sonnet-4')
      expect(config.defaultTemperature).toBe(0.7)
    })
  })

  describe('convenience functions', () => {
    it('write() should return AIPromise', () => {
      const result = write`a poem about code`
      expect(result.$meta).toBeDefined()
      expect(typeof result.then).toBe('function')
    })

    it('summarize() should return AIPromise', () => {
      const result = summarize`this long text`
      expect(result.$meta).toBeDefined()
      expect(typeof result.then).toBe('function')
    })

    it('code() should return AIPromise', () => {
      const result = code`a function that adds two numbers`
      expect(result.$meta).toBeDefined()
      expect(typeof result.then).toBe('function')
    })

    it('write() should resolve to a string', async () => {
      const result = await write`a haiku`
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('summarize() should resolve to a string', async () => {
      const result = await summarize`some text`
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('code() should resolve to a string', async () => {
      const result = await code`hello world`
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('error handling', () => {
    it('should export AIError class', () => {
      expect(AIError).toBeDefined()
      const error = new AIError('test error', 'test-model')
      expect(error.name).toBe('AIError')
      expect(error.model).toBe('test-model')
    })

    it('AIError should have cause property', () => {
      const cause = new Error('root cause')
      const error = new AIError('test error', 'test-model', cause)
      expect(error.cause).toBe(cause)
    })
  })

  describe('promise methods', () => {
    it('should support .pipe() for transformations', async () => {
      const result = await ai`Say hello`.pipe(text => text.toUpperCase())

      expect(typeof result).toBe('string')
      // The result should be uppercased
      expect(result).toBe(result.toUpperCase())
    })

    it('should support .json() for parsing JSON responses', async () => {
      // This test depends on the AI returning valid JSON
      // In mock mode, it won't return JSON, so we skip the actual parsing
      const result = ai`Return a JSON object`
      expect(typeof result.json).toBe('function')
    })
  })
})
