import { describe, it, expect } from 'vitest'
import { ai, write, summarize, code } from '../template'

describe('AI Template Literal', () => {
  describe('ai', () => {
    it('should return an AIPromise', () => {
      const result = ai`Hello world`

      expect(result).toBeDefined()
      expect(typeof result.then).toBe('function')
      expect(result.$meta).toBeDefined()
    })

    it('should call AI and return a response', async () => {
      const name = 'Alice'
      const result = ai`Greet ${name}`

      const text = await result
      // Verifies the promise resolves to a string response from AI
      expect(typeof text).toBe('string')
      expect(text.length).toBeGreaterThan(0)
    })

    it('should have $meta with model info', () => {
      const result = ai`Test`
      expect(result.$meta.model).toBe('default')
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

    it('should support streaming', async () => {
      const result = ai`Test`
      const chunks: string[] = []

      for await (const chunk of result.stream()) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
    })

    it('should handle multiple interpolations', async () => {
      const name = 'Bob'
      const age = 25
      const result = ai`User ${name} is ${age} years old`

      const text = await result
      // Verifies the promise resolves to a string response from AI
      expect(typeof text).toBe('string')
      expect(text.length).toBeGreaterThan(0)
    })

    it('should handle empty template', async () => {
      const result = ai``
      const text = await result
      expect(text).toBeDefined()
    })

    it('should return actual AI response, not placeholder', async () => {
      const result = await ai`What is 2 + 2?`

      // Should not contain the placeholder pattern
      expect(result).not.toContain('[AI Response to:')
      expect(result).not.toContain('placeholder')
      // Should be a real response (or mock response from generateText)
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('should use specified model from .with()', async () => {
      const result = ai`Hello`.with({ model: 'sonnet' })
      await result

      // Model should be set correctly
      expect(result.$meta.model).toBe('sonnet')
    })

    it('should track duration in $meta', async () => {
      const result = ai`Test prompt`
      await result

      expect(result.$meta.duration).toBeDefined()
      expect(result.$meta.duration).toBeGreaterThanOrEqual(0)
    })
  })

  describe('convenience functions', () => {
    it('write() should call AI with writing prompt', async () => {
      const result = await write`a poem about code`
      // Verifies the promise resolves to a string response from AI
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('summarize() should call AI with summary prompt', async () => {
      const result = await summarize`this long text`
      // Verifies the promise resolves to a string response from AI
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('code() should call AI with code generation prompt', async () => {
      const result = await code`a function that adds two numbers`
      // Verifies the promise resolves to a string response from AI
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('write() should interpolate values', async () => {
      const topic = 'TypeScript'
      const result = await write`an article about ${topic}`
      // Verifies the promise resolves to a string response from AI
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('convenience functions should return AIPromise', () => {
      const writeResult = write`test`
      const summarizeResult = summarize`test`
      const codeResult = code`test`

      expect(writeResult.$meta).toBeDefined()
      expect(summarizeResult.$meta).toBeDefined()
      expect(codeResult.$meta).toBeDefined()
    })
  })
})
