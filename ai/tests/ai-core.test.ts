// TDD: ai-core Integration Tests
// Testing the integration layer without requiring live API calls

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  generateText,
  generateObject,
  embedText,
  createTool,
  configureProvider,
  getProvider,
  clearProviders,
} from '../ai-core'

describe('ai-core integration', () => {
  beforeEach(() => {
    // Clear providers before each test
    clearProviders()
  })

  describe('generateText', () => {
    it('should have proper API surface', async () => {
      // Test that the function exists and has correct signature
      expect(typeof generateText).toBe('function')
    })

    it('should return GenerateTextResult structure', async () => {
      // This tests the mock fallback when ai-providers is not available
      const result = await generateText({
        model: 'sonnet',
        prompt: 'Test',
      })

      // Should have proper result structure
      expect(result).toBeDefined()
      expect(result).toHaveProperty('text')
      expect(result).toHaveProperty('usage')
      expect(result.usage).toHaveProperty('promptTokens')
      expect(result.usage).toHaveProperty('completionTokens')
      expect(result.usage).toHaveProperty('totalTokens')
    })

    it('should accept model aliases', () => {
      // Test that model aliases are recognized
      const aliases = ['opus', 'sonnet', 'haiku', 'gpt-4o', 'gemini']

      aliases.forEach(alias => {
        // Just verify the function accepts the alias without error
        expect(() => {
          generateText({
            model: alias,
            prompt: 'test',
          })
        }).not.toThrow()
      })
    })

    it('should accept optional parameters', () => {
      expect(() => {
        generateText({
          model: 'sonnet',
          prompt: 'test',
          system: 'You are helpful',
          temperature: 0.7,
          maxTokens: 100,
        })
      }).not.toThrow()
    })

    it('should accept messages array', () => {
      expect(() => {
        generateText({
          model: 'sonnet',
          messages: [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Hello' },
          ],
        })
      }).not.toThrow()
    })
  })

  describe('generateObject', () => {
    it('should have proper API surface', () => {
      expect(typeof generateObject).toBe('function')
    })

    it('should return GenerateObjectResult structure', async () => {
      const result = await generateObject({
        model: 'sonnet',
        schema: { test: 'test field' },
        prompt: 'Test',
      })

      expect(result).toBeDefined()
      expect(result).toHaveProperty('object')
      expect(result).toHaveProperty('usage')
    })

    it('should accept simple schema syntax', () => {
      expect(() => {
        generateObject({
          model: 'sonnet',
          schema: {
            name: 'User name',
            email: 'User email',
          },
          prompt: 'test',
        })
      }).not.toThrow()
    })
  })

  describe('embedText', () => {
    it('should have proper API surface', () => {
      expect(typeof embedText).toBe('function')
    })

    it('should return embeddings array for single text', async () => {
      const result = await embedText('hello world')

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(typeof result[0]).toBe('number')
    })

    it('should return embeddings array for multiple texts', async () => {
      const result = await embedText(['hello', 'world'])

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(2)

      result.forEach(embedding => {
        expect(Array.isArray(embedding)).toBe(true)
        expect(embedding.length).toBeGreaterThan(0)
      })
    })

    it('should accept embedding model option', async () => {
      const result = await embedText('test', {
        model: 'text-embedding-3-small',
      })

      expect(result).toBeDefined()
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('createTool', () => {
    it('should define a callable tool', () => {
      const calculator = createTool({
        name: 'calculator',
        description: 'Performs calculations',
        parameters: {
          expression: 'Math expression',
        },
        execute: ({ expression }: { expression: string }) => {
          return eval(expression)
        },
      })

      expect(calculator).toBeDefined()
      expect(calculator.name).toBe('calculator')
      expect(calculator.description).toBe('Performs calculations')
      expect(typeof calculator.execute).toBe('function')
    })

    it('should execute tool with parameters', async () => {
      const tool = createTool({
        name: 'test',
        description: 'Test tool',
        parameters: { value: 'test value' },
        execute: ({ value }: { value: string }) => ({ result: value }),
      })

      const result = await tool.execute({ value: 'hello' })
      expect(result).toEqual({ result: 'hello' })
    })

    it('should support async execute function', async () => {
      const tool = createTool({
        name: 'async-tool',
        description: 'Async tool',
        parameters: { input: 'input value' },
        execute: async ({ input }: { input: string }) => {
          await new Promise(resolve => setTimeout(resolve, 10))
          return { output: input.toUpperCase() }
        },
      })

      const result = await tool.execute({ input: 'test' })
      expect(result).toEqual({ output: 'TEST' })
    })
  })

  describe('provider configuration', () => {
    it('should configure default provider', () => {
      configureProvider({
        provider: 'anthropic',
        apiKey: 'test-key',
        defaultModel: 'claude-3-sonnet',
      })

      const provider = getProvider()
      expect(provider).toBeDefined()
      expect(provider?.provider).toBe('anthropic')
      expect(provider?.defaultModel).toBe('claude-3-sonnet')
    })

    it('should configure multiple providers', () => {
      configureProvider({
        provider: 'openai',
        apiKey: 'openai-key',
        defaultModel: 'gpt-4',
      })

      configureProvider({
        provider: 'anthropic',
        apiKey: 'anthropic-key',
        defaultModel: 'claude-3-opus',
      })

      const openaiProvider = getProvider('openai')
      const anthropicProvider = getProvider('anthropic')

      expect(openaiProvider).toBeDefined()
      expect(openaiProvider?.provider).toBe('openai')
      expect(anthropicProvider).toBeDefined()
      expect(anthropicProvider?.provider).toBe('anthropic')
    })

    it('should support cloudflare provider', () => {
      configureProvider({
        provider: 'cloudflare',
        accountId: 'test-account',
        apiKey: 'cf-key',
      })

      const provider = getProvider('cloudflare')
      expect(provider).toBeDefined()
      expect(provider?.provider).toBe('cloudflare')
      expect(provider?.accountId).toBe('test-account')
    })

    it('should support google provider', () => {
      configureProvider({
        provider: 'google',
        apiKey: 'google-key',
        defaultModel: 'gemini-pro',
      })

      const provider = getProvider('google')
      expect(provider).toBeDefined()
      expect(provider?.provider).toBe('google')
    })

    it('should return undefined for unconfigured provider', () => {
      const provider = getProvider('openai')
      expect(provider).toBeUndefined()
    })
  })

  describe('model routing', () => {
    it('should resolve model aliases', async () => {
      // Testing with mocks - just ensure no errors
      const aliases = ['opus', 'sonnet', 'haiku', 'gpt-4o', 'gemini']

      for (const alias of aliases) {
        expect(() => {
          generateText({ model: alias, prompt: 'test' })
        }).not.toThrow()
      }
    })
  })

  describe('completion API wrapper', () => {
    it('should export chat function', async () => {
      const { chat } = await import('../ai-core')
      expect(typeof chat).toBe('function')
    })

    it('should export complete function', async () => {
      const { complete } = await import('../ai-core')
      expect(typeof complete).toBe('function')
    })

    it('should export streamText function', async () => {
      const { streamText } = await import('../ai-core')
      expect(typeof streamText).toBe('function')
    })
  })

  describe('type exports', () => {
    it('should export core types', async () => {
      const module = await import('../ai-core')

      // Verify type exports exist (TypeScript will catch if they don't)
      expect(module).toHaveProperty('generateText')
      expect(module).toHaveProperty('generateObject')
      expect(module).toHaveProperty('embedText')
      expect(module).toHaveProperty('createTool')
      expect(module).toHaveProperty('configureProvider')
      expect(module).toHaveProperty('getProvider')
      expect(module).toHaveProperty('clearProviders')
      expect(module).toHaveProperty('chat')
      expect(module).toHaveProperty('complete')
      expect(module).toHaveProperty('streamText')
    })
  })
})
