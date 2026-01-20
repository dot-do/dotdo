import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  countTokens,
  countMessageTokens,
  estimateCost,
  getModelPricing,
  preloadEncoders,
  clearEncoderCache,
} from '../tokens'

describe('Token Counting with Tiktoken', () => {
  beforeAll(() => {
    preloadEncoders()
  })

  afterAll(() => {
    clearEncoderCache()
  })

  describe('countTokens', () => {
    it('should count tokens in simple text', () => {
      const text = 'Hello, world!'
      const tokens = countTokens(text)

      // "Hello, world!" is 4 tokens in cl100k_base
      expect(tokens).toBe(4)
    })

    it('should return 0 for empty string', () => {
      expect(countTokens('')).toBe(0)
    })

    it('should return 0 for undefined/null-like text', () => {
      expect(countTokens(undefined as unknown as string)).toBe(0)
      expect(countTokens(null as unknown as string)).toBe(0)
    })

    it('should handle long text', () => {
      const longText = 'word '.repeat(1000)
      const tokens = countTokens(longText)

      // "word " repeated should be roughly 1-2 tokens per word
      expect(tokens).toBeGreaterThan(1000)
      expect(tokens).toBeLessThan(3000)
    })

    it('should handle unicode characters', () => {
      const text = 'Hello 世界 🌍'
      const tokens = countTokens(text)

      // Unicode and emoji typically use multiple tokens
      expect(tokens).toBeGreaterThan(3)
    })

    it('should use different encodings for different models', () => {
      const text = 'The quick brown fox jumps over the lazy dog.'

      // cl100k_base (GPT-4)
      const tokensGpt4 = countTokens(text, 'gpt-4')

      // o200k_base (GPT-4o)
      const tokensGpt4o = countTokens(text, 'gpt-4o')

      // Both should produce reasonable token counts
      expect(tokensGpt4).toBeGreaterThan(0)
      expect(tokensGpt4o).toBeGreaterThan(0)

      // Token counts might differ slightly between encodings
      expect(tokensGpt4).toBeLessThan(20)
      expect(tokensGpt4o).toBeLessThan(20)
    })

    it('should handle model name variants', () => {
      const text = 'Test prompt'

      // Full model names
      const tokens1 = countTokens(text, 'gpt-4o-2024-05-13')
      const tokens2 = countTokens(text, 'gpt-4o')

      // Should both use o200k_base encoding
      expect(tokens1).toBe(tokens2)
    })

    it('should use default encoding for unknown models', () => {
      const text = 'Test prompt'

      const tokens = countTokens(text, 'unknown-model')
      expect(tokens).toBeGreaterThan(0)
    })

    it('should handle code snippets', () => {
      const code = `
function hello(name: string): string {
  return \`Hello, \${name}!\`
}
`.trim()

      const tokens = countTokens(code)
      expect(tokens).toBeGreaterThan(10)
      expect(tokens).toBeLessThan(50)
    })

    it('should handle JSON', () => {
      const json = JSON.stringify({
        name: 'Alice',
        age: 30,
        email: 'alice@example.com',
      })

      const tokens = countTokens(json)
      expect(tokens).toBeGreaterThan(10)
      expect(tokens).toBeLessThan(30)
    })
  })

  describe('countMessageTokens', () => {
    it('should count tokens in message array', () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' },
      ]

      const tokens = countMessageTokens(messages)

      // Should include content tokens plus formatting overhead
      expect(tokens).toBeGreaterThan(10)
    })

    it('should return 0 for empty messages', () => {
      expect(countMessageTokens([])).toBe(0)
    })

    it('should return 0 for undefined messages', () => {
      expect(countMessageTokens(undefined as unknown as Array<{ role: string; content: string }>)).toBe(0)
    })

    it('should account for message formatting overhead', () => {
      const content = 'Hello!'
      const contentTokens = countTokens(content)

      const messages = [{ role: 'user', content }]
      const messageTokens = countMessageTokens(messages)

      // Message tokens should be more than just content due to formatting
      expect(messageTokens).toBeGreaterThan(contentTokens)
    })

    it('should handle multi-turn conversations', () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: '2+2 equals 4.' },
        { role: 'user', content: 'And 3+3?' },
      ]

      const tokens = countMessageTokens(messages)
      expect(tokens).toBeGreaterThan(20)
    })
  })

  describe('estimateCost', () => {
    it('should estimate cost for input tokens', () => {
      // gpt-4o: $2.50 per 1M input tokens
      const cost = estimateCost(1_000_000, 'gpt-4o')
      expect(cost).toBeCloseTo(2.50, 2)
    })

    it('should estimate cost for input/output tokens', () => {
      // gpt-4o: $2.50 input, $10.00 output per 1M
      const cost = estimateCost({ input: 1000, output: 500 }, 'gpt-4o')

      const expected = (1000 * 2.50 + 500 * 10.00) / 1_000_000
      expect(cost).toBeCloseTo(expected, 6)
    })

    it('should handle zero tokens', () => {
      const cost = estimateCost(0, 'gpt-4o')
      expect(cost).toBe(0)
    })

    it('should handle unknown models with default pricing', () => {
      const cost = estimateCost(1000, 'unknown-model')
      expect(cost).toBeGreaterThan(0)
    })

    it('should estimate cost for Claude models', () => {
      // claude-sonnet-4: $3.00 input, $15.00 output per 1M
      const cost = estimateCost({ input: 1000, output: 500 }, 'claude-sonnet-4')

      const expected = (1000 * 3.00 + 500 * 15.00) / 1_000_000
      expect(cost).toBeCloseTo(expected, 6)
    })

    it('should estimate cost for Gemini models', () => {
      // gemini-2.0-flash: $0.10 input, $0.40 output per 1M
      const cost = estimateCost({ input: 1000, output: 500 }, 'gemini-2.0-flash')

      const expected = (1000 * 0.10 + 500 * 0.40) / 1_000_000
      expect(cost).toBeCloseTo(expected, 6)
    })
  })

  describe('getModelPricing', () => {
    it('should return pricing for known models', () => {
      const pricing = getModelPricing('gpt-4o')

      expect(pricing.inputCostPer1M).toBe(2.50)
      expect(pricing.outputCostPer1M).toBe(10.00)
    })

    it('should return pricing for Claude models', () => {
      const pricing = getModelPricing('claude-opus-4')

      expect(pricing.inputCostPer1M).toBe(15.00)
      expect(pricing.outputCostPer1M).toBe(75.00)
    })

    it('should return default pricing for unknown models', () => {
      const pricing = getModelPricing('unknown-model')

      expect(pricing.inputCostPer1M).toBeDefined()
      expect(pricing.outputCostPer1M).toBeDefined()
    })

    it('should handle model name variants', () => {
      const pricing = getModelPricing('gpt-4o-2024-05-13')

      expect(pricing.inputCostPer1M).toBe(2.50)
      expect(pricing.outputCostPer1M).toBe(10.00)
    })
  })

  describe('Encoder cache management', () => {
    it('should preload encoders without error', () => {
      expect(() => preloadEncoders()).not.toThrow()
    })

    it('should clear encoder cache without error', () => {
      expect(() => clearEncoderCache()).not.toThrow()

      // Should still work after clearing
      const tokens = countTokens('Hello')
      expect(tokens).toBeGreaterThan(0)
    })
  })

  describe('Real-world scenarios', () => {
    it('should accurately count tokens for a typical prompt', () => {
      const systemPrompt = 'You are a helpful AI assistant that answers questions concisely.'
      const userMessage = 'What is the capital of France?'

      const systemTokens = countTokens(systemPrompt)
      const userTokens = countTokens(userMessage)

      // Reasonable token counts for typical prompts
      expect(systemTokens).toBeLessThan(20)
      expect(userTokens).toBeLessThan(10)
    })

    it('should estimate cost for a realistic conversation', () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Explain quantum computing in simple terms.' },
        { role: 'assistant', content: 'Quantum computing uses quantum bits (qubits) that can exist in multiple states simultaneously, unlike classical bits which are either 0 or 1. This allows quantum computers to process many possibilities at once, making them potentially much faster for certain types of problems like cryptography, drug discovery, and optimization.' },
      ]

      const inputTokens = countMessageTokens(messages.slice(0, 2))
      const outputTokens = countTokens(messages[2].content)

      const cost = estimateCost({ input: inputTokens, output: outputTokens }, 'gpt-4o')

      // Should be a small but non-zero cost
      expect(cost).toBeGreaterThan(0)
      expect(cost).toBeLessThan(0.01) // Less than 1 cent for this short conversation
    })
  })
})
