/**
 * TDD Integration Tests: @dotdo/rpc with ai-functions
 *
 * These tests verify that RPC can invoke AI functions remotely.
 * The tests are written in TDD style - they define the expected behavior
 * before implementation, ensuring the RPC layer can:
 *
 * 1. Expose AI functions via RPC server endpoints
 * 2. Call AI functions remotely via RPC client
 * 3. Handle AI function registries over RPC
 * 4. Support schema-based AI function invocation
 * 5. Propagate AI function errors correctly
 * 6. Support generative, code, agentic, and human function types
 *
 * @module rpc/tests/ai-functions-integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createServer, createClient, CORRELATION_ID_HEADER } from '../index'
import type {
  AIFunctionDefinition,
  FunctionDefinition,
  DefinedFunction,
  FunctionRegistry,
  AIGenerateOptions,
  AIGenerateResult,
} from '../../primitives/packages/ai-functions/src/types'

// ============================================================================
// Mock AI Functions for Testing
// ============================================================================

/**
 * Mock AI function that summarizes text
 */
const mockSummarize: AIFunctionDefinition<string, { text: string }> = {
  name: 'summarize',
  description: 'Summarize the given text',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to summarize' },
    },
    required: ['text'],
  },
  handler: async (input) => {
    // Mock implementation - in real use, this would call an LLM
    return `Summary: ${input.text.slice(0, 50)}...`
  },
}

/**
 * Mock AI function that extracts entities
 */
const mockExtractEntities: AIFunctionDefinition<{ entities: string[] }, { text: string }> = {
  name: 'extractEntities',
  description: 'Extract named entities from text',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to analyze' },
    },
    required: ['text'],
  },
  handler: async (input) => {
    // Mock entity extraction
    const words = input.text.split(/\s+/)
    const entities = words.filter((w) => w[0] === w[0]?.toUpperCase() && w.length > 1)
    return { entities }
  },
}

/**
 * Mock AI function that generates code
 */
const mockCodeGen: AIFunctionDefinition<{ code: string; language: string }, { prompt: string; language?: string }> = {
  name: 'generateCode',
  description: 'Generate code from a prompt',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Code generation prompt' },
      language: { type: 'string', description: 'Target programming language' },
    },
    required: ['prompt'],
  },
  handler: async (input) => {
    const lang = input.language || 'typescript'
    return {
      code: `// Generated ${lang} code\nfunction solution() {\n  // ${input.prompt}\n}`,
      language: lang,
    }
  },
}

/**
 * Mock AI function that requires human approval
 */
const mockApproval: AIFunctionDefinition<{ approved: boolean; reason?: string }, { request: string; amount: number }> = {
  name: 'requestApproval',
  description: 'Request human approval for an action',
  parameters: {
    type: 'object',
    properties: {
      request: { type: 'string', description: 'What needs approval' },
      amount: { type: 'number', description: 'Amount involved' },
    },
    required: ['request', 'amount'],
  },
  handler: async (input) => {
    // Mock auto-approval for testing (in real use, this would wait for human input)
    if (input.amount <= 1000) {
      return { approved: true }
    }
    return { approved: false, reason: 'Amount exceeds auto-approval limit' }
  },
}

/**
 * Mock function that throws an error
 */
const mockFailingFunction: AIFunctionDefinition<never, { shouldFail: boolean }> = {
  name: 'mayFail',
  description: 'A function that may fail',
  parameters: {
    type: 'object',
    properties: {
      shouldFail: { type: 'boolean', description: 'Whether to fail' },
    },
    required: ['shouldFail'],
  },
  handler: async (input) => {
    if (input.shouldFail) {
      throw new Error('Intentional failure for testing')
    }
    return 'success' as never
  },
}

// ============================================================================
// Mock fetch for client tests
// ============================================================================

const mockFetch = vi.fn()
const originalFetch = global.fetch

beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch
  mockFetch.mockReset()
})

afterEach(() => {
  global.fetch = originalFetch
})

// ============================================================================
// Test Suites
// ============================================================================

describe('@dotdo/rpc + ai-functions Integration', () => {
  describe('1. AI Functions via RPC Server', () => {
    it('should expose AI function handlers via RPC server', async () => {
      // Create a service that exposes AI functions
      const aiService = {
        functions: {
          summarize: mockSummarize.handler,
          extractEntities: mockExtractEntities.handler,
        },
      }

      const server = createServer({ target: aiService })

      // Call the summarize function via RPC
      const request = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'functions.summarize',
          args: [{ text: 'This is a long piece of text that needs to be summarized for brevity.' }],
        }),
      })

      const response = await server.fetch(request)

      expect(response.ok).toBe(true)
      const result = await response.json()
      expect(typeof result).toBe('string')
      expect(result).toContain('Summary:')
    })

    it('should handle AI function with complex return types', async () => {
      const aiService = {
        extractEntities: mockExtractEntities.handler,
      }

      const server = createServer({ target: aiService })

      const request = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'extractEntities',
          args: [{ text: 'Alice met Bob at the New York office.' }],
        }),
      })

      const response = await server.fetch(request)

      expect(response.ok).toBe(true)
      const result = (await response.json()) as { entities: string[] }
      expect(result).toHaveProperty('entities')
      expect(Array.isArray(result.entities)).toBe(true)
      expect(result.entities).toContain('Alice')
    })

    it('should propagate AI function errors via RPC', async () => {
      const aiService = {
        mayFail: mockFailingFunction.handler,
      }

      const server = createServer({ target: aiService })

      const request = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'mayFail',
          args: [{ shouldFail: true }],
        }),
      })

      const response = await server.fetch(request)

      expect(response.ok).toBe(false)
      expect(response.status).toBe(500) // InternalError
      const error = (await response.json()) as { code: string; message: string }
      expect(error.code).toBe('INTERNAL_ERROR')
      expect(error.message).toContain('Intentional failure')
    })

    it('should whitelist AI function methods', async () => {
      const aiService = {
        safe: { summarize: mockSummarize.handler },
        unsafe: { deleteAll: async () => 'deleted' },
      }

      const server = createServer({
        target: aiService,
        whitelist: ['safe.*'], // Only expose safe methods
      })

      // Whitelisted method should work
      const safeRequest = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'safe.summarize',
          args: [{ text: 'Hello world' }],
        }),
      })

      const safeResponse = await server.fetch(safeRequest)
      expect(safeResponse.ok).toBe(true)

      // Non-whitelisted method should be blocked
      const unsafeRequest = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'unsafe.deleteAll',
          args: [],
        }),
      })

      const unsafeResponse = await server.fetch(unsafeRequest)
      expect(unsafeResponse.ok).toBe(false)
      expect(unsafeResponse.status).toBe(403) // Authorization error
    })
  })

  describe('2. AI Functions via RPC Client', () => {
    it('should call AI functions remotely via RPC client', async () => {
      const expectedResult = 'Summary: This is a test...'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(expectedResult),
        headers: new Headers({ [CORRELATION_ID_HEADER]: 'test-123' }),
      })

      interface AIServiceAPI {
        functions: {
          summarize(input: { text: string }): Promise<string>
        }
      }

      const client = createClient<AIServiceAPI>({ url: 'http://ai-service.test' })
      const result = await client.functions.summarize({ text: 'This is a test' })

      expect(mockFetch).toHaveBeenCalledWith(
        'http://ai-service.test/rpc',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            method: 'functions.summarize',
            args: [{ text: 'This is a test' }],
          }),
        })
      )
      expect(result).toBe(expectedResult)
    })

    it('should deserialize complex AI function results', async () => {
      const expectedResult = {
        entities: ['Alice', 'Bob', 'New York'],
        confidence: 0.95,
        processingTime: 150,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(expectedResult),
        headers: new Headers({ [CORRELATION_ID_HEADER]: 'test-456' }),
      })

      interface AIServiceAPI {
        analyze(text: string): Promise<{
          entities: string[]
          confidence: number
          processingTime: number
        }>
      }

      const client = createClient<AIServiceAPI>({ url: 'http://ai-service.test' })
      const result = await client.analyze('Alice met Bob in New York')

      expect(result).toEqual(expectedResult)
      expect(result.entities).toHaveLength(3)
      expect(result.confidence).toBeGreaterThan(0.9)
    })

    it('should handle AI function timeout', async () => {
      // Mock a slow AI function that times out
      mockFetch.mockImplementationOnce(() =>
        new Promise((_, reject) => {
          const error = new Error('The operation was aborted')
          error.name = 'AbortError'
          setTimeout(() => reject(error), 100)
        })
      )

      interface AIServiceAPI {
        slowGenerate(prompt: string): Promise<string>
      }

      const client = createClient<AIServiceAPI>({
        url: 'http://ai-service.test',
        timeout: 50, // Very short timeout
      })

      await expect(client.slowGenerate('Generate something')).rejects.toThrow()
    })
  })

  describe('3. Function Registry over RPC', () => {
    it('should expose function registry operations via RPC', async () => {
      // Create a mock function registry service
      const registeredFunctions = new Map<string, DefinedFunction>()

      const registryService = {
        registry: {
          has: (name: string) => registeredFunctions.has(name),
          list: () => Array.from(registeredFunctions.keys()),
          register: async (name: string, definition: FunctionDefinition) => {
            const definedFn: DefinedFunction = {
              definition,
              call: async (args: unknown) => {
                // Mock call implementation
                return { result: 'executed', args }
              },
              asTool: () => ({
                name,
                description: definition.description || '',
                parameters: { type: 'object' },
                handler: async () => ({}),
              }),
            }
            registeredFunctions.set(name, definedFn)
            return true
          },
          call: async (name: string, args: unknown) => {
            const fn = registeredFunctions.get(name)
            if (!fn) throw new Error(`Function ${name} not found`)
            return fn.call(args)
          },
        },
      }

      const server = createServer({ target: registryService })

      // Test has() method
      const hasRequest = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'registry.has', args: ['nonexistent'] }),
      })

      const hasResponse = await server.fetch(hasRequest)
      expect(hasResponse.ok).toBe(true)
      expect(await hasResponse.json()).toBe(false)

      // Test register() method
      const registerRequest = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'registry.register',
          args: [
            'testFunction',
            {
              type: 'generative',
              name: 'testFunction',
              description: 'A test function',
              args: { input: 'string' },
              output: 'string',
            },
          ],
        }),
      })

      const registerResponse = await server.fetch(registerRequest)
      expect(registerResponse.ok).toBe(true)
      expect(await registerResponse.json()).toBe(true)

      // Test list() method
      const listRequest = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'registry.list', args: [] }),
      })

      const listResponse = await server.fetch(listRequest)
      expect(listResponse.ok).toBe(true)
      expect(await listResponse.json()).toContain('testFunction')

      // Test call() method
      const callRequest = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'registry.call',
          args: ['testFunction', { input: 'hello' }],
        }),
      })

      const callResponse = await server.fetch(callRequest)
      expect(callResponse.ok).toBe(true)
      const callResult = (await callResponse.json()) as { result: string; args: unknown }
      expect(callResult.result).toBe('executed')
    })
  })

  describe('4. Schema-based AI Function Invocation', () => {
    it('should validate AI function input schema via RPC', async () => {
      const aiService = {
        generateCode: mockCodeGen.handler,
      }

      // Use the RPC validation schema format (args array with ArgSchema)
      const server = createServer({
        target: aiService,
        schemas: {
          generateCode: {
            args: [
              {
                name: 'input',
                type: 'object',
                required: true,
              },
            ],
          },
        },
      })

      // Valid request with object input
      const validRequest = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'generateCode',
          args: [{ prompt: 'Create a hello world function', language: 'typescript' }],
        }),
      })

      const validResponse = await server.fetch(validRequest)
      expect(validResponse.ok).toBe(true)
      const result = (await validResponse.json()) as { code: string; language: string }
      expect(result.code).toContain('typescript')

      // Invalid request (missing required argument)
      const invalidRequest = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'generateCode',
          args: [], // Missing required input argument
        }),
      })

      const invalidResponse = await server.fetch(invalidRequest)
      expect(invalidResponse.ok).toBe(false)
      expect(invalidResponse.status).toBe(400) // Validation error
    })

    it('should support AI functions with optional parameters', async () => {
      const aiService = {
        generate: async (options: { prompt: string; temperature?: number; maxTokens?: number }) => {
          return {
            text: `Generated with temp=${options.temperature ?? 0.7}, maxTokens=${options.maxTokens ?? 1000}`,
            usage: { tokens: 50 },
          }
        },
      }

      const server = createServer({ target: aiService })

      // Call with minimal parameters
      const minimalRequest = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'generate',
          args: [{ prompt: 'Hello' }],
        }),
      })

      const minimalResponse = await server.fetch(minimalRequest)
      expect(minimalResponse.ok).toBe(true)
      const minimalResult = (await minimalResponse.json()) as { text: string }
      expect(minimalResult.text).toContain('temp=0.7')
      expect(minimalResult.text).toContain('maxTokens=1000')

      // Call with all parameters
      const fullRequest = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'generate',
          args: [{ prompt: 'Hello', temperature: 0.9, maxTokens: 500 }],
        }),
      })

      const fullResponse = await server.fetch(fullRequest)
      expect(fullResponse.ok).toBe(true)
      const fullResult = (await fullResponse.json()) as { text: string }
      expect(fullResult.text).toContain('temp=0.9')
      expect(fullResult.text).toContain('maxTokens=500')
    })
  })

  describe('5. AI Function Type Support', () => {
    it('should handle generative function type via RPC', async () => {
      const generativeService = {
        generative: {
          summarize: async (input: { text: string }) => ({
            summary: `Summary of: ${input.text.slice(0, 20)}...`,
            confidence: 0.85,
          }),
          translate: async (input: { text: string; targetLang: string }) => ({
            translated: `[${input.targetLang}] ${input.text}`,
            detectedLang: 'en',
          }),
        },
      }

      const server = createServer({ target: generativeService })

      const request = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'generative.translate',
          args: [{ text: 'Hello world', targetLang: 'es' }],
        }),
      })

      const response = await server.fetch(request)
      expect(response.ok).toBe(true)
      const result = (await response.json()) as { translated: string; detectedLang: string }
      expect(result.translated).toBe('[es] Hello world')
      expect(result.detectedLang).toBe('en')
    })

    it('should handle code function type via RPC', async () => {
      const codeService = {
        code: {
          generate: async (input: { spec: string; language: string }) => ({
            code: `// ${input.language} implementation\n// Spec: ${input.spec}`,
            tests: `// Tests for ${input.spec}`,
            documentation: `/** ${input.spec} */`,
          }),
        },
      }

      const server = createServer({ target: codeService })

      const request = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'code.generate',
          args: [{ spec: 'Fibonacci sequence', language: 'python' }],
        }),
      })

      const response = await server.fetch(request)
      expect(response.ok).toBe(true)
      const result = (await response.json()) as { code: string; tests: string; documentation: string }
      expect(result.code).toContain('python')
      expect(result.code).toContain('Fibonacci')
      expect(result.tests).toBeDefined()
      expect(result.documentation).toBeDefined()
    })

    it('should handle agentic function type via RPC', async () => {
      const agenticService = {
        agent: {
          research: async (input: { topic: string; depth: 'shallow' | 'deep' }) => ({
            findings: [`Finding about ${input.topic}`],
            sources: ['source1', 'source2'],
            iterations: input.depth === 'deep' ? 5 : 2,
            completed: true,
          }),
        },
      }

      const server = createServer({ target: agenticService })

      const request = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'agent.research',
          args: [{ topic: 'AI functions', depth: 'deep' }],
        }),
      })

      const response = await server.fetch(request)
      expect(response.ok).toBe(true)
      const result = (await response.json()) as { findings: string[]; sources: string[]; iterations: number; completed: boolean }
      expect(result.findings).toHaveLength(1)
      expect(result.findings[0]).toContain('AI functions')
      expect(result.iterations).toBe(5)
      expect(result.completed).toBe(true)
    })

    it('should handle human function type via RPC', async () => {
      const humanService = {
        human: {
          approve: async (input: { action: string; requester: string }) => ({
            approved: true,
            approver: 'system', // Mock auto-approval
            timestamp: new Date().toISOString(),
            notes: `Auto-approved ${input.action} for ${input.requester}`,
          }),
          review: async (input: { document: string }) => ({
            feedback: `Review of: ${input.document.slice(0, 20)}...`,
            score: 4,
            reviewer: 'system',
          }),
        },
      }

      const server = createServer({ target: humanService })

      const request = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'human.approve',
          args: [{ action: 'deploy to production', requester: 'alice@example.com' }],
        }),
      })

      const response = await server.fetch(request)
      expect(response.ok).toBe(true)
      const result = (await response.json()) as { approved: boolean; approver: string; notes: string }
      expect(result.approved).toBe(true)
      expect(result.notes).toContain('deploy to production')
      expect(result.notes).toContain('alice@example.com')
    })
  })

  describe('6. Correlation ID Propagation for AI Functions', () => {
    it('should propagate correlation ID through AI function calls', async () => {
      const aiService = {
        summarize: mockSummarize.handler,
      }

      const server = createServer({ target: aiService })
      const correlationId = 'ai-request-12345'

      const request = new Request('https://test/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [CORRELATION_ID_HEADER]: correlationId,
        },
        body: JSON.stringify({
          method: 'summarize',
          args: [{ text: 'Test text' }],
        }),
      })

      const response = await server.fetch(request)
      expect(response.ok).toBe(true)
      expect(response.headers.get(CORRELATION_ID_HEADER)).toBe(correlationId)
    })

    it('should generate correlation ID if not provided for AI functions', async () => {
      const aiService = {
        summarize: mockSummarize.handler,
      }

      const server = createServer({ target: aiService })

      const request = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'summarize',
          args: [{ text: 'Test text' }],
        }),
      })

      const response = await server.fetch(request)
      expect(response.ok).toBe(true)

      const generatedId = response.headers.get(CORRELATION_ID_HEADER)
      expect(generatedId).toBeTruthy()
      expect(typeof generatedId).toBe('string')
    })
  })

  describe('7. Batch AI Function Calls via RPC', () => {
    it('should handle batch AI function invocations', async () => {
      const batchAIService = {
        batch: {
          summarize: async (inputs: Array<{ text: string }>) => {
            return inputs.map((input) => ({
              summary: `Summary: ${input.text.slice(0, 30)}...`,
              length: input.text.length,
            }))
          },
        },
      }

      const server = createServer({ target: batchAIService })

      const request = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'batch.summarize',
          args: [
            [
              { text: 'First document to summarize with some content.' },
              { text: 'Second document with different content.' },
              { text: 'Third document to process.' },
            ],
          ],
        }),
      })

      const response = await server.fetch(request)
      expect(response.ok).toBe(true)
      const results = (await response.json()) as Array<{ summary: string; length: number }>
      expect(results).toHaveLength(3)
      expect(results[0]!.summary).toContain('First document')
      expect(results[1]!.summary).toContain('Second document')
      expect(results[2]!.summary).toContain('Third document')
    })

    it('should handle partial failures in batch AI calls', async () => {
      const batchAIService = {
        batch: {
          process: async (inputs: Array<{ id: string; fail?: boolean }>) => {
            return inputs.map((input) => {
              if (input.fail) {
                return { id: input.id, error: 'Processing failed', success: false }
              }
              return { id: input.id, result: 'processed', success: true }
            })
          },
        },
      }

      const server = createServer({ target: batchAIService })

      const request = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'batch.process',
          args: [
            [
              { id: '1', fail: false },
              { id: '2', fail: true },
              { id: '3', fail: false },
            ],
          ],
        }),
      })

      const response = await server.fetch(request)
      expect(response.ok).toBe(true)
      const results = (await response.json()) as Array<{ id: string; success: boolean; error?: string; result?: string }>
      expect(results).toHaveLength(3)
      expect(results[0]!.success).toBe(true)
      expect(results[1]!.success).toBe(false)
      expect(results[1]!.error).toBe('Processing failed')
      expect(results[2]!.success).toBe(true)
    })
  })

  describe('8. AI Generate Interface via RPC', () => {
    it('should expose AI generate method via RPC', async () => {
      // Mock AI client that implements generate()
      const aiClient = {
        generate: async (options: AIGenerateOptions): Promise<AIGenerateResult> => {
          return {
            text: `Generated response for: ${options.prompt}`,
            object: options.schema ? { generated: true } : undefined,
            usage: {
              promptTokens: 10,
              completionTokens: 20,
              totalTokens: 30,
            },
          }
        },
      }

      const server = createServer({ target: aiClient })

      const request = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'generate',
          args: [
            {
              prompt: 'Write a haiku about programming',
              model: 'gpt-4',
              temperature: 0.7,
            },
          ],
        }),
      })

      const response = await server.fetch(request)
      expect(response.ok).toBe(true)
      const result = (await response.json()) as AIGenerateResult
      expect(result.text).toContain('Write a haiku')
      expect(result.usage).toBeDefined()
      expect(result.usage?.totalTokens).toBe(30)
    })

    it('should handle generate with structured output schema', async () => {
      const aiClient = {
        generate: async (options: AIGenerateOptions): Promise<AIGenerateResult> => {
          if (options.schema) {
            return {
              text: '',
              object: {
                title: 'Generated Title',
                content: 'Generated content based on schema',
                tags: ['ai', 'generated'],
              },
              usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
            }
          }
          return { text: 'No schema provided', usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 } }
        },
      }

      const server = createServer({ target: aiClient })

      const request = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'generate',
          args: [
            {
              prompt: 'Generate a blog post',
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  content: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                },
                required: ['title', 'content'],
              },
            },
          ],
        }),
      })

      const response = await server.fetch(request)
      expect(response.ok).toBe(true)
      const result = (await response.json()) as AIGenerateResult
      expect(result.object).toBeDefined()
      const obj = result.object as { title: string; content: string; tags: string[] }
      expect(obj.title).toBe('Generated Title')
      expect(obj.tags).toContain('ai')
    })
  })
})

// ============================================================================
// TDD Failing Tests - These test future features that need implementation
// These use it.skip() to mark them as pending until implementation is ready
// ============================================================================

describe('@dotdo/rpc + ai-functions Integration (TDD Pending Tests)', () => {
  describe('9. AI Function Pipeline Support (TDD)', () => {
    /**
     * TDD Test: RPC should support pipelining AI function calls
     *
     * This test verifies that multiple AI functions can be chained
     * in a single RPC pipeline call, reducing round trips.
     *
     * Expected workflow:
     * 1. Client calls pipeline with sequence of AI functions
     * 2. Server executes them in order, passing results
     * 3. Final result returned in single response
     */
    it.skip('should support AI function pipelines via RPC (not yet implemented)', async () => {
      const aiService = {
        ai: {
          summarize: async (text: string) => `Summary: ${text.slice(0, 50)}`,
          translate: async (text: string, lang: string) => `[${lang}] ${text}`,
          format: async (text: string, style: string) => `<${style}>${text}</${style}>`,
        },
      }

      const server = createServer({ target: aiService })

      // Pipeline: summarize -> translate -> format
      const pipelineRequest = new Request('https://test/rpc/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'ai.summarize',
          args: ['This is a long document that needs to be summarized, translated, and formatted.'],
          chain: [
            { method: 'ai.translate', args: ['$result', 'es'] },
            { method: 'ai.format', args: ['$result', 'bold'] },
          ],
        }),
      })

      const response = await server.fetch(pipelineRequest)
      expect(response.ok).toBe(true)
      const result = (await response.json()) as { result: string; steps: number }
      expect(result.result).toContain('[es]')
      expect(result.result).toContain('<bold>')
      expect(result.steps).toBe(3)
    })

    /**
     * TDD Test: RPC should support streaming AI function responses
     *
     * This test verifies that AI functions that produce streaming output
     * (like text generation) can stream results over RPC.
     */
    it.skip('should support streaming AI function responses (not yet implemented)', async () => {
      const streamingService = {
        ai: {
          generateStream: async function* (prompt: string) {
            const words = prompt.split(' ')
            for (const word of words) {
              yield word + ' '
              await new Promise((r) => setTimeout(r, 10))
            }
          },
        },
      }

      const server = createServer({ target: streamingService })

      const request = new Request('https://test/rpc/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'ai.generateStream',
          args: ['Hello world from streaming'],
          streaming: true,
        }),
      })

      const response = await server.fetch(request)
      expect(response.ok).toBe(true)
      expect(response.headers.get('Content-Type')).toContain('text/event-stream')

      // In real implementation, would read SSE events
      const body = await response.text()
      expect(body).toContain('Hello')
    })
  })

  describe('10. AI Function Tool Orchestration via RPC (TDD)', () => {
    /**
     * TDD Test: RPC should support registering AI function tools
     *
     * This test verifies that AI functions can be registered as tools
     * that are available for agentic AI calls.
     */
    it.skip('should support registering AI functions as tools via RPC (not yet implemented)', async () => {
      const toolService = {
        tools: {
          register: async (tool: { name: string; description: string; schema: unknown }) => ({
            registered: true,
            toolId: `tool_${tool.name}`,
          }),
          list: async () => ['summarize', 'translate', 'search'],
          invoke: async (toolName: string, args: unknown) => ({
            result: `Invoked ${toolName} with ${JSON.stringify(args)}`,
          }),
        },
      }

      const server = createServer({ target: toolService })

      // Register a new tool
      const registerRequest = new Request('https://test/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'tools.register',
          args: [
            {
              name: 'customAnalyze',
              description: 'Analyzes text for sentiment',
              schema: {
                type: 'object',
                properties: { text: { type: 'string' } },
              },
            },
          ],
        }),
      })

      const registerResponse = await server.fetch(registerRequest)
      expect(registerResponse.ok).toBe(true)
      const registerResult = (await registerResponse.json()) as { registered: boolean; toolId: string }
      expect(registerResult.registered).toBe(true)
      expect(registerResult.toolId).toBe('tool_customAnalyze')
    })
  })

  describe('11. AI Function Caching via RPC (TDD)', () => {
    /**
     * TDD Test: RPC should support caching AI function responses
     *
     * This test verifies that identical AI function calls can be cached
     * to avoid redundant LLM calls.
     */
    it.skip('should support caching AI function responses via RPC (not yet implemented)', async () => {
      let callCount = 0
      const cachedService = {
        ai: {
          summarize: async (text: string) => {
            callCount++
            return { summary: `Summary #${callCount}: ${text.slice(0, 20)}`, cached: false }
          },
        },
      }

      const server = createServer({
        target: cachedService,
        // Future feature: cache configuration
        // cache: {
        //   enabled: true,
        //   ttl: 60000, // 1 minute
        //   methods: ['ai.summarize']
        // }
      })

      // First call - should execute
      const request1 = new Request('https://test/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cache-Control': 'cache', // Future header for cache control
        },
        body: JSON.stringify({
          method: 'ai.summarize',
          args: ['Same text for caching test'],
        }),
      })

      await server.fetch(request1)

      // Second identical call - should return cached
      const request2 = new Request('https://test/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cache-Control': 'cache',
        },
        body: JSON.stringify({
          method: 'ai.summarize',
          args: ['Same text for caching test'],
        }),
      })

      const response2 = await server.fetch(request2)
      const result2 = (await response2.json()) as { summary: string; cached: boolean }

      // With caching, callCount should still be 1
      expect(callCount).toBe(1)
      expect(result2.cached).toBe(true) // This would fail until caching is implemented
    })
  })

  describe('12. AI Function Rate Limiting via RPC (TDD)', () => {
    /**
     * TDD Test: RPC should support rate limiting AI function calls
     *
     * This test verifies that AI function calls can be rate limited
     * to prevent abuse and manage costs.
     */
    it.skip('should support rate limiting AI function calls via RPC (not yet implemented)', async () => {
      const rateLimitedService = {
        ai: {
          generate: async (prompt: string) => ({ text: `Generated: ${prompt}` }),
        },
      }

      const server = createServer({
        target: rateLimitedService,
        // Future feature: rate limiting configuration
        // rateLimit: {
        //   'ai.*': {
        //     maxRequests: 3,
        //     windowMs: 1000, // 3 requests per second
        //   }
        // }
      })

      // Make 4 rapid calls - 4th should be rate limited
      const makeCall = () =>
        server.fetch(
          new Request('https://test/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              method: 'ai.generate',
              args: ['test'],
            }),
          })
        )

      const results = await Promise.all([makeCall(), makeCall(), makeCall(), makeCall()])

      // First 3 should succeed
      expect(results[0]!.ok).toBe(true)
      expect(results[1]!.ok).toBe(true)
      expect(results[2]!.ok).toBe(true)

      // 4th should be rate limited (429 Too Many Requests)
      expect(results[3]!.status).toBe(429)
    })
  })

  describe('13. Cross-DO AI Function Invocation (TDD)', () => {
    /**
     * TDD Test: AI functions should be invocable across Durable Objects
     *
     * This test verifies that one DO can call AI functions exposed
     * by another DO via RPC.
     */
    it.skip('should support cross-DO AI function invocation (requires miniflare)', async () => {
      // This test would require miniflare integration
      // It verifies that DO A can call AI functions on DO B via RPC

      // Example: Customer DO calling AI functions on Analytics DO
      // const analyticsStub = env.ANALYTICS_DO.get(env.ANALYTICS_DO.idFromName('analytics'))
      // const result = await analyticsStub.fetch('https://do/rpc', {
      //   method: 'POST',
      //   body: JSON.stringify({ method: 'ai.summarizeCustomerData', args: [customerId] })
      // })

      expect(true).toBe(true) // Placeholder - would require real DO setup
    })
  })
})
