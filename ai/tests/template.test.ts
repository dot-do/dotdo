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

    it('should interpolate values', async () => {
      const name = 'Alice'
      const result = ai`Greet ${name}`

      const text = await result
      expect(text).toContain('Greet Alice')
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
      expect(text).toContain('User Bob is 25 years old')
    })

    it('should handle empty template', async () => {
      const result = ai``
      const text = await result
      expect(text).toBeDefined()
    })
  })

  describe('convenience functions', () => {
    it('write() should create writing prompt', async () => {
      const result = await write`a poem about code`
      expect(result).toContain('Write:')
    })

    it('summarize() should create summary prompt', async () => {
      const result = await summarize`this long text`
      expect(result).toContain('Summarize:')
    })

    it('code() should create code generation prompt', async () => {
      const result = await code`a function that adds two numbers`
      expect(result).toContain('Generate code:')
    })

    it('write() should interpolate values', async () => {
      const topic = 'TypeScript'
      const result = await write`an article about ${topic}`
      expect(result).toContain('Write:')
      expect(result).toContain('TypeScript')
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
