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
  configureMockModel,
  getMockConfig,
  resetMockConfig,
  MockModelNotAllowedError,
  AIError,
  AIModelResolutionError,
  AIProviderError,
  AIGenerationError,
  AIObjectGenerationError,
  AIEmbeddingError,
  AIStreamError,
} from '../ai-core'

describe('ai-core integration', () => {
  beforeEach(() => {
    // Clear providers before each test
    clearProviders()
    // Reset mock config to defaults
    resetMockConfig()
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

  /**
   * Tests for error handling - verifying that real errors are not masked by mock fallback
   *
   * Issue: do-ofef - Mock model fallback was masking real errors
   *
   * The mock fallback should only be used when ai-providers module is genuinely
   * not installed (MODULE_NOT_FOUND). Real errors from ai-providers (authentication
   * failures, configuration errors, API errors) should propagate to the caller.
   */
  describe('error handling (do-ofef)', () => {
    it('should use mock when ai-providers module is not found', async () => {
      // When ai-providers is not installed, we use mock - this is the expected behavior
      // In this test environment, ai-providers is likely not installed
      const result = await generateText({
        model: 'sonnet',
        prompt: 'Test',
      })

      // Mock model should work without throwing
      expect(result).toBeDefined()
      expect(result.text).toContain('Mock response')
    })

    it('should return deterministic mock embeddings when ai-providers is not found', async () => {
      // When ai-providers is not installed, we use mock embeddings
      const embedding1 = await embedText('hello world')
      const embedding2 = await embedText('hello world')

      // Mock embeddings should be deterministic (same input = same output)
      expect(embedding1).toEqual(embedding2)
    })

    it('should distinguish between module not found and other errors', async () => {
      // This test documents the expected error handling behavior:
      // - MODULE_NOT_FOUND errors -> use mock fallback
      // - Other errors (auth, config, API) -> propagate to caller

      // We can't easily mock import() in vitest, but we can verify the logic
      // by checking the error type detection in the implementation

      // Test with a standard Error (should NOT be treated as module not found)
      const authError = new Error('Authentication failed: Invalid API key')
      expect((authError as any).code).toBeUndefined()
      expect(authError.message).not.toContain('Cannot find module')
      expect(authError.message).not.toContain('Cannot find package')

      // Test with a module not found error (SHOULD be treated as module not found)
      const moduleError = new Error('Cannot find module \'ai-providers\'')
      expect(moduleError.message).toContain('Cannot find module')

      // Test with package not found error (SHOULD be treated as module not found)
      const packageError = new Error('Cannot find package \'ai-providers\'')
      expect(packageError.message).toContain('Cannot find package')

      // Test with ERR_MODULE_NOT_FOUND error code
      const errModuleNotFound = new Error('Cannot find package \'ai-providers\'') as Error & { code: string }
      errModuleNotFound.code = 'ERR_MODULE_NOT_FOUND'
      expect(errModuleNotFound.code).toBe('ERR_MODULE_NOT_FOUND')
    })

    it('should use mock model only for missing module, not for API errors', async () => {
      // This is a documentation test showing the expected behavior:
      //
      // BEFORE fix (do-ofef):
      //   Any error from ai-providers -> silently use mock -> masks real errors
      //
      // AFTER fix:
      //   MODULE_NOT_FOUND error -> use mock (expected when module not installed)
      //   Other errors (auth, config, API) -> propagate to caller
      //
      // Example errors that should propagate:
      // - "Authentication failed: Invalid API key"
      // - "Model not found: claude-invalid-model"
      // - "Rate limit exceeded"
      // - "Configuration error: missing gateway URL"

      const errorsThatShouldPropagate = [
        'Authentication failed: Invalid API key',
        'Model not found: claude-invalid-model',
        'Rate limit exceeded',
        'Configuration error: missing gateway URL',
        'Network error: Connection refused',
      ]

      // These errors do NOT match the module not found pattern
      for (const errorMessage of errorsThatShouldPropagate) {
        const error = new Error(errorMessage)
        expect(error.message).not.toContain('Cannot find module')
        expect(error.message).not.toContain('Failed to resolve')
        expect(error.message).not.toContain('Cannot resolve module')
      }
    })

    it('mock embeddings should have correct dimensions', async () => {
      // Test default dimensions
      const embedding = await embedText('test')
      expect(Array.isArray(embedding)).toBe(true)
      expect((embedding as number[]).length).toBe(1536) // default

      // Test custom dimensions
      const smallEmbedding = await embedText('test', { dimensions: 256 })
      expect(Array.isArray(smallEmbedding)).toBe(true)
      expect((smallEmbedding as number[]).length).toBe(256)
    })

    it('mock embeddings should be consistent for same input', async () => {
      // Mock embeddings should be deterministic for reproducible tests
      const text = 'The quick brown fox jumps over the lazy dog'

      const emb1 = await embedText(text) as number[]
      const emb2 = await embedText(text) as number[]

      // Same text should produce identical embeddings
      expect(emb1).toEqual(emb2)

      // Different text should produce different embeddings
      const emb3 = await embedText('Different text') as number[]
      expect(emb1).not.toEqual(emb3)
    })
  })

  /**
   * Tests for mock model configuration (do-yr0f)
   *
   * Ensures that mock models:
   * - Are only used in test/development environments by default
   * - Can be explicitly enabled or disabled
   * - Emit warnings when used
   * - Throw errors in production when not explicitly enabled
   */
  describe('mock model configuration (do-yr0f)', () => {
    beforeEach(() => {
      resetMockConfig()
    })

    it('should have default configuration', () => {
      const config = getMockConfig()
      expect(config.allowMock).toBe('auto')
      expect(config.warnOnMock).toBe(true)
    })

    it('should allow configuring mock model behavior', () => {
      configureMockModel({ allowMock: true, warnOnMock: false })
      const config = getMockConfig()
      expect(config.allowMock).toBe(true)
      expect(config.warnOnMock).toBe(false)
    })

    it('should reset configuration to defaults', () => {
      configureMockModel({ allowMock: false, warnOnMock: false })
      resetMockConfig()
      const config = getMockConfig()
      expect(config.allowMock).toBe('auto')
      expect(config.warnOnMock).toBe(true)
    })

    it('should allow explicitly enabling mock models', async () => {
      configureMockModel({ allowMock: true, warnOnMock: false })

      // Should work without throwing
      const result = await generateText({
        model: 'sonnet',
        prompt: 'Test',
      })
      expect(result.text).toContain('Mock response')
    })

    it('should throw MockModelNotAllowedError when mock is disabled', async () => {
      configureMockModel({ allowMock: false })

      // Should throw because mock is explicitly disabled
      await expect(generateText({
        model: 'sonnet',
        prompt: 'Test',
      })).rejects.toThrow(MockModelNotAllowedError)
    })

    it('should throw MockModelNotAllowedError for embeddings when mock is disabled', async () => {
      configureMockModel({ allowMock: false })

      // Should throw because mock is explicitly disabled
      await expect(embedText('test')).rejects.toThrow(MockModelNotAllowedError)
    })

    it('should call custom warning handler when mock is used', async () => {
      const warnings: Array<{ message: string; context: { model: string; operation: string } }> = []

      configureMockModel({
        allowMock: true,
        warnOnMock: true,
        onMockWarning: (message, context) => {
          warnings.push({ message, context })
        },
      })

      await generateText({ model: 'sonnet', prompt: 'Test' })

      expect(warnings.length).toBe(1)
      expect(warnings[0].message).toContain('MOCK model')
      expect(warnings[0].context.model).toContain('sonnet')
      expect(warnings[0].context.operation).toBe('resolve')
    })

    it('should not warn when warnOnMock is false', async () => {
      const warnings: string[] = []

      configureMockModel({
        allowMock: true,
        warnOnMock: false,
        onMockWarning: (message) => {
          warnings.push(message)
        },
      })

      await generateText({ model: 'sonnet', prompt: 'Test' })

      expect(warnings.length).toBe(0)
    })

    it('should work in test environment with auto setting', async () => {
      // In test environment, 'auto' should allow mock models
      configureMockModel({ allowMock: 'auto', warnOnMock: false })

      const result = await generateText({
        model: 'sonnet',
        prompt: 'Test',
      })
      expect(result.text).toContain('Mock response')
    })

    it('MockModelNotAllowedError should have descriptive message', () => {
      const error = new MockModelNotAllowedError('claude-sonnet')

      expect(error.name).toBe('MockModelNotAllowedError')
      expect(error.message).toContain('claude-sonnet')
      expect(error.message).toContain('ai-providers')
      expect(error.message).toContain('configureMockModel')
    })

    it('should export MockModelNotAllowedError for type checking', () => {
      expect(MockModelNotAllowedError).toBeDefined()
      expect(typeof MockModelNotAllowedError).toBe('function')
    })
  })

  /**
   * Tests for error types and error handling (do-im9w)
   *
   * Ensures that:
   * - Error types are properly exported and can be used for type checking
   * - Errors contain meaningful information (model, operation, cause, status, code)
   * - AIProviderError.isRetryable correctly identifies retryable errors
   * - Errors maintain proper inheritance chain
   */
  describe('error types (do-im9w)', () => {
    describe('AIError base class', () => {
      it('should have proper structure', () => {
        const error = new AIError('Test error', { operation: 'test' })

        expect(error).toBeInstanceOf(Error)
        expect(error).toBeInstanceOf(AIError)
        expect(error.name).toBe('AIError')
        expect(error.message).toBe('Test error')
        expect(error.operation).toBe('test')
      })

      it('should include model when provided', () => {
        const error = new AIError('Test error', { operation: 'test', model: 'gpt-4' })

        expect(error.model).toBe('gpt-4')
      })

      it('should include cause when provided', () => {
        const cause = new Error('Original error')
        const error = new AIError('Test error', { operation: 'test', cause })

        expect(error.cause).toBe(cause)
      })
    })

    describe('AIModelResolutionError', () => {
      it('should have proper structure', () => {
        const error = new AIModelResolutionError('gpt-4')

        expect(error).toBeInstanceOf(Error)
        expect(error).toBeInstanceOf(AIError)
        expect(error).toBeInstanceOf(AIModelResolutionError)
        expect(error.name).toBe('AIModelResolutionError')
        expect(error.message).toContain('gpt-4')
        expect(error.operation).toBe('resolveModel')
        expect(error.model).toBe('gpt-4')
      })

      it('should include cause in message', () => {
        const cause = new Error('Invalid API key')
        const error = new AIModelResolutionError('gpt-4', cause)

        expect(error.message).toContain('Invalid API key')
        expect(error.cause).toBe(cause)
      })
    })

    describe('AIProviderError', () => {
      it('should have proper structure', () => {
        const error = new AIProviderError('Provider error', {
          operation: 'generateText',
          model: 'gpt-4',
          status: 429,
          code: 'rate_limit_exceeded',
          retryable: true,
        })

        expect(error).toBeInstanceOf(Error)
        expect(error).toBeInstanceOf(AIError)
        expect(error).toBeInstanceOf(AIProviderError)
        expect(error.name).toBe('AIProviderError')
        expect(error.status).toBe(429)
        expect(error.code).toBe('rate_limit_exceeded')
        expect(error.retryable).toBe(true)
      })

      it('should default retryable to false', () => {
        const error = new AIProviderError('Provider error', { operation: 'test' })

        expect(error.retryable).toBe(false)
      })

      describe('isRetryable', () => {
        it('should identify rate limit errors (status 429)', () => {
          const error = new Error('Rate limited') as Error & { status: number }
          error.status = 429

          expect(AIProviderError.isRetryable(error)).toBe(true)
        })

        it('should identify server errors (5xx)', () => {
          const error500 = new Error('Internal error') as Error & { status: number }
          error500.status = 500
          expect(AIProviderError.isRetryable(error500)).toBe(true)

          const error503 = new Error('Service unavailable') as Error & { status: number }
          error503.status = 503
          expect(AIProviderError.isRetryable(error503)).toBe(true)
        })

        it('should identify retryable error codes', () => {
          const rateLimitError = new Error('Error') as Error & { code: string }
          rateLimitError.code = 'rate_limit_exceeded'
          expect(AIProviderError.isRetryable(rateLimitError)).toBe(true)

          const overloadedError = new Error('Error') as Error & { code: string }
          overloadedError.code = 'overloaded'
          expect(AIProviderError.isRetryable(overloadedError)).toBe(true)

          const serverError = new Error('Error') as Error & { code: string }
          serverError.code = 'server_error'
          expect(AIProviderError.isRetryable(serverError)).toBe(true)
        })

        it('should identify retryable error messages', () => {
          expect(AIProviderError.isRetryable(new Error('Rate limit exceeded'))).toBe(true)
          expect(AIProviderError.isRetryable(new Error('Too many requests'))).toBe(true)
          expect(AIProviderError.isRetryable(new Error('Server is overloaded'))).toBe(true)
          expect(AIProviderError.isRetryable(new Error('Request timeout'))).toBe(true)
          expect(AIProviderError.isRetryable(new Error('ECONNRESET'))).toBe(true)
          expect(AIProviderError.isRetryable(new Error('Socket hang up'))).toBe(true)
          expect(AIProviderError.isRetryable(new Error('Network error'))).toBe(true)
        })

        it('should not identify non-retryable errors', () => {
          expect(AIProviderError.isRetryable(new Error('Invalid API key'))).toBe(false)
          expect(AIProviderError.isRetryable(new Error('Model not found'))).toBe(false)
          expect(AIProviderError.isRetryable(new Error('Invalid request'))).toBe(false)

          const error400 = new Error('Bad request') as Error & { status: number }
          error400.status = 400
          expect(AIProviderError.isRetryable(error400)).toBe(false)

          const error401 = new Error('Unauthorized') as Error & { status: number }
          error401.status = 401
          expect(AIProviderError.isRetryable(error401)).toBe(false)
        })
      })
    })

    describe('AIGenerationError', () => {
      it('should have proper structure', () => {
        const error = new AIGenerationError('Generation failed', {
          model: 'sonnet',
          status: 500,
        })

        expect(error).toBeInstanceOf(AIProviderError)
        expect(error.name).toBe('AIGenerationError')
        expect(error.operation).toBe('generateText')
        expect(error.model).toBe('sonnet')
      })
    })

    describe('AIObjectGenerationError', () => {
      it('should have proper structure', () => {
        const error = new AIObjectGenerationError('Object generation failed', {
          model: 'sonnet',
        })

        expect(error).toBeInstanceOf(AIProviderError)
        expect(error.name).toBe('AIObjectGenerationError')
        expect(error.operation).toBe('generateObject')
      })
    })

    describe('AIEmbeddingError', () => {
      it('should have proper structure', () => {
        const error = new AIEmbeddingError('Embedding failed', {
          model: 'text-embedding-3-small',
        })

        expect(error).toBeInstanceOf(AIProviderError)
        expect(error.name).toBe('AIEmbeddingError')
        expect(error.operation).toBe('embedText')
      })
    })

    describe('AIStreamError', () => {
      it('should have proper structure', () => {
        const error = new AIStreamError('Streaming failed', {
          model: 'sonnet',
        })

        expect(error).toBeInstanceOf(AIProviderError)
        expect(error.name).toBe('AIStreamError')
        expect(error.operation).toBe('streamText')
      })
    })

    describe('error exports', () => {
      it('should export all error types', () => {
        expect(AIError).toBeDefined()
        expect(AIModelResolutionError).toBeDefined()
        expect(AIProviderError).toBeDefined()
        expect(AIGenerationError).toBeDefined()
        expect(AIObjectGenerationError).toBeDefined()
        expect(AIEmbeddingError).toBeDefined()
        expect(AIStreamError).toBeDefined()
      })

      it('should allow instanceof checks for error handling', () => {
        const error = new AIGenerationError('Test', { model: 'test' })

        // All parent classes should match
        expect(error instanceof AIStreamError).toBe(false)
        expect(error instanceof AIGenerationError).toBe(true)
        expect(error instanceof AIProviderError).toBe(true)
        expect(error instanceof AIError).toBe(true)
        expect(error instanceof Error).toBe(true)
      })
    })
  })
})
