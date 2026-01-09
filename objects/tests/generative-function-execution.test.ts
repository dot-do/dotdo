/**
 * GenerativeFunction Execution Tests
 *
 * RED TDD: These tests should FAIL because GenerativeFunction execution doesn't exist yet.
 *
 * GenerativeFunction is a function type that calls LLM models (Claude, GPT, etc.)
 * with prompt templates, structured output schemas, streaming support,
 * and model configuration options.
 *
 * This file tests the execution engine for AI generation, including:
 * - LLM model calls
 * - Prompt templates with variable substitution
 * - JSON schema validation for structured output
 * - Streaming token generation
 * - Temperature/maxTokens configuration
 * - Multi-turn conversations
 * - Tool use within generation
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports will FAIL - implementation doesn't exist yet
import {
  GenerativeFunctionExecutor,
  type GenerativeExecutionContext,
  type GenerativeExecutionResult,
  type GenerativeOptions,
  type ModelConfig,
  type Message,
  type ToolDefinition,
  type StreamChunk,
  type TokenUsage,
  GenerativeModelError,
  GenerativeValidationError,
  GenerativeRateLimitError,
  GenerativeTimeoutError,
  GenerativeAbortError,
  GenerativeSchemaError,
  GenerativeToolError,
} from '../GenerativeFunctionExecutor'

// ============================================================================
// TYPE DEFINITIONS (for test clarity)
// ============================================================================

/**
 * Expected model configuration
 */
interface ExpectedModelConfig {
  model: string
  temperature?: number
  maxTokens?: number
  topP?: number
  topK?: number
  stopSequences?: string[]
  presencePenalty?: number
  frequencyPenalty?: number
}

/**
 * Expected prompt template
 */
interface ExpectedPromptTemplate {
  template: string
  variables?: Record<string, unknown>
}

/**
 * Expected execution result
 */
interface ExpectedGenerativeResult<T = unknown> {
  success: boolean
  result?: T
  error?: {
    message: string
    name: string
    code?: string
  }
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  duration: number
  model: string
  finishReason?: 'stop' | 'length' | 'tool_use' | 'content_filter'
}

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()
  return {
    id: { toString: () => 'test-generative-do-id' },
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value)
      },
      delete: async (key: string) => storage.delete(key),
      list: async (options?: { prefix?: string }) => {
        const result = new Map()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      },
    },
    waitUntil: () => {},
    blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
  } as unknown as DurableObjectState
}

function createMockEnv() {
  return {
    API_KEY: 'test-api-key',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    OPENAI_API_KEY: 'test-openai-key',
  }
}

function createMockAIService() {
  return {
    generate: vi.fn().mockResolvedValue({
      text: 'Generated response',
      usage: { inputTokens: 10, outputTokens: 20 },
      finishReason: 'stop',
    }),
    stream: vi.fn().mockImplementation(async function* () {
      yield { type: 'text', text: 'Hello' }
      yield { type: 'text', text: ' ' }
      yield { type: 'text', text: 'World' }
      yield {
        type: 'done',
        usage: { inputTokens: 5, outputTokens: 3 },
        finishReason: 'stop',
      }
    }),
    generateWithTools: vi.fn().mockResolvedValue({
      text: 'Response with tool use',
      toolCalls: [],
      usage: { inputTokens: 15, outputTokens: 25 },
      finishReason: 'stop',
    }),
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('GenerativeFunction Execution', () => {
  let executor: InstanceType<typeof GenerativeFunctionExecutor>
  let mockState: DurableObjectState
  let mockEnv: ReturnType<typeof createMockEnv>
  let mockAIService: ReturnType<typeof createMockAIService>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    mockAIService = createMockAIService()
    executor = new GenerativeFunctionExecutor({
      state: mockState,
      env: mockEnv,
      aiService: mockAIService,
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // 1. BASIC GENERATION TESTS
  // ==========================================================================

  describe('Basic Generation', () => {
    describe('Simple prompt generation', () => {
      it('generates response from simple prompt', async () => {
        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Write a haiku about coding',
        })

        expect(result.success).toBe(true)
        expect(result.result).toBeDefined()
        expect(typeof result.result).toBe('string')
      })

      it('calls AI service with correct model', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Hello',
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            model: 'claude-sonnet-4-20250514',
          })
        )
      })

      it('passes prompt to AI service', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Explain quantum computing',
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: 'Explain quantum computing',
          })
        )
      })

      it('returns the generated text', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: 'Generated response about AI',
          usage: { inputTokens: 5, outputTokens: 10 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'What is AI?',
        })

        expect(result.result).toBe('Generated response about AI')
      })

      it('handles empty prompt gracefully', async () => {
        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: '',
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/prompt.*empty|required/i)
      })

      it('supports different model providers', async () => {
        // Claude
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
        })

        // GPT-4
        await executor.execute({
          model: 'gpt-4o',
          prompt: 'Test',
        })

        // GPT-3.5
        await executor.execute({
          model: 'gpt-3.5-turbo',
          prompt: 'Test',
        })

        expect(mockAIService.generate).toHaveBeenCalledTimes(3)
      })
    })

    describe('Token usage tracking', () => {
      it('reports input token count', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: 'Response',
          usage: { inputTokens: 42, outputTokens: 10 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Count my tokens',
        })

        expect(result.usage.inputTokens).toBe(42)
      })

      it('reports output token count', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: 'Long response...',
          usage: { inputTokens: 10, outputTokens: 150 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Generate a long response',
        })

        expect(result.usage.outputTokens).toBe(150)
      })

      it('reports total token count', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: 'Response',
          usage: { inputTokens: 25, outputTokens: 75 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
        })

        expect(result.usage.totalTokens).toBe(100)
      })

      it('emits token usage event', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new GenerativeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          aiService: mockAIService,
          onEvent,
        })

        await executorWithEvents.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
        })

        expect(onEvent).toHaveBeenCalledWith(
          'generation.tokens',
          expect.objectContaining({
            inputTokens: expect.any(Number),
            outputTokens: expect.any(Number),
          })
        )
      })
    })

    describe('Finish reason tracking', () => {
      it('reports stop finish reason', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: 'Complete response',
          usage: { inputTokens: 5, outputTokens: 10 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
        })

        expect(result.finishReason).toBe('stop')
      })

      it('reports length finish reason when truncated', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: 'Truncated response...',
          usage: { inputTokens: 5, outputTokens: 100 },
          finishReason: 'length',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          maxTokens: 100,
        })

        expect(result.finishReason).toBe('length')
      })

      it('reports content_filter when content is filtered', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: '',
          usage: { inputTokens: 5, outputTokens: 0 },
          finishReason: 'content_filter',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Inappropriate content',
        })

        expect(result.finishReason).toBe('content_filter')
      })
    })

    describe('Execution metadata', () => {
      it('tracks execution duration', async () => {
        // Simulate some delay
        mockAIService.generate.mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return {
            text: 'Response',
            usage: { inputTokens: 5, outputTokens: 10 },
            finishReason: 'stop',
          }
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
        })

        expect(result.duration).toBeGreaterThanOrEqual(50)
      })

      it('reports the model used', async () => {
        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
        })

        expect(result.model).toBe('claude-sonnet-4-20250514')
      })

      it('generates unique invocation ID', async () => {
        const invocationIds: string[] = []
        const onEvent = vi.fn((event, data) => {
          if (event === 'generation.started') {
            invocationIds.push((data as { invocationId: string }).invocationId)
          }
        })

        const executorWithEvents = new GenerativeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          aiService: mockAIService,
          onEvent,
        })

        await executorWithEvents.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test 1',
        })
        await executorWithEvents.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test 2',
        })

        expect(new Set(invocationIds).size).toBe(2)
      })
    })
  })

  // ==========================================================================
  // 2. TEMPLATE TESTS
  // ==========================================================================

  describe('Prompt Templates', () => {
    describe('Variable substitution', () => {
      it('substitutes single variable in template', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Hello, {{name}}!',
          variables: { name: 'World' },
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: 'Hello, World!',
          })
        )
      })

      it('substitutes multiple variables', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'My name is {{name}} and I am {{age}} years old.',
          variables: { name: 'Alice', age: 30 },
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: 'My name is Alice and I am 30 years old.',
          })
        )
      })

      it('handles missing variables gracefully', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Hello, {{name}}! Your email is {{email}}.',
          variables: { name: 'Alice' },
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: expect.stringContaining('Alice'),
          })
        )
      })

      it('handles undefined variables as empty string', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Value: {{missing}}',
          variables: {},
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: 'Value: ',
          })
        )
      })

      it('handles null variables as empty string', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Value: {{nullValue}}',
          variables: { nullValue: null },
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: 'Value: ',
          })
        )
      })

      it('converts non-string variables to strings', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Number: {{num}}, Bool: {{bool}}, Array: {{arr}}',
          variables: { num: 42, bool: true, arr: [1, 2, 3] },
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: 'Number: 42, Bool: true, Array: 1,2,3',
          })
        )
      })

      it('handles nested object variables with dot notation', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'User: {{user.name}}, Email: {{user.email}}',
          variables: { user: { name: 'Alice', email: 'alice@example.com' } },
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: 'User: Alice, Email: alice@example.com',
          })
        )
      })

      it('handles deeply nested variables', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'City: {{user.address.city}}',
          variables: {
            user: {
              address: {
                city: 'New York',
              },
            },
          },
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: 'City: New York',
          })
        )
      })

      it('supports array indexing in templates', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'First item: {{items[0]}}, Second item: {{items[1]}}',
          variables: { items: ['apple', 'banana', 'cherry'] },
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: 'First item: apple, Second item: banana',
          })
        )
      })
    })

    describe('Template syntax', () => {
      it('ignores escaped braces', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Template: \\{{name}} is escaped, {{name}} is not',
          variables: { name: 'Alice' },
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: expect.stringContaining('{{name}} is escaped'),
          })
        )
      })

      it('handles multiple occurrences of same variable', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: '{{name}} said hello to {{name}}',
          variables: { name: 'Alice' },
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: 'Alice said hello to Alice',
          })
        )
      })

      it('handles adjacent variables', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: '{{first}}{{second}}{{third}}',
          variables: { first: 'A', second: 'B', third: 'C' },
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: 'ABC',
          })
        )
      })

      it('preserves whitespace around variables', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: '  {{name}}  ',
          variables: { name: 'Alice' },
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: '  Alice  ',
          })
        )
      })

      it('handles multiline templates', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: `Line 1: {{first}}
Line 2: {{second}}
Line 3: {{third}}`,
          variables: { first: 'A', second: 'B', third: 'C' },
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: `Line 1: A
Line 2: B
Line 3: C`,
          })
        )
      })
    })

    describe('Function prompts', () => {
      it('supports function as prompt generator', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: (input: { topic: string }) => `Write about ${input.topic}`,
          input: { topic: 'AI' },
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: 'Write about AI',
          })
        )
      })

      it('function prompt receives full input object', async () => {
        const promptFn = vi.fn((input: unknown) => 'Generated prompt')

        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: promptFn,
          input: { topic: 'AI', style: 'formal', maxLength: 500 },
        })

        expect(promptFn).toHaveBeenCalledWith({
          topic: 'AI',
          style: 'formal',
          maxLength: 500,
        })
      })

      it('handles async function prompts', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: async (input: { id: string }) => {
            await new Promise((resolve) => setTimeout(resolve, 10))
            return `Fetched content for ${input.id}`
          },
          input: { id: '123' },
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: 'Fetched content for 123',
          })
        )
      })

      it('handles function prompt throwing error', async () => {
        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: () => {
            throw new Error('Prompt generation failed')
          },
          input: {},
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toContain('Prompt generation failed')
      })
    })
  })

  // ==========================================================================
  // 3. SCHEMA TESTS
  // ==========================================================================

  describe('Schema Validation', () => {
    describe('JSON schema for structured output', () => {
      it('parses JSON response when schema is provided', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: JSON.stringify({ summary: 'A summary', score: 85 }),
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Summarize this text',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              score: { type: 'number' },
            },
            required: ['summary'],
          },
        })

        expect(result.result).toEqual({ summary: 'A summary', score: 85 })
      })

      it('validates response against schema', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: JSON.stringify({ invalid: 'response' }),
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Generate data',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
            },
            required: ['summary'],
          },
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(GenerativeSchemaError)
      })

      it('reports specific schema validation errors', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: JSON.stringify({ summary: 123 }), // Wrong type
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Generate data',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
            },
            required: ['summary'],
          },
        })

        expect(result.error?.message).toMatch(/type|string|number/i)
      })

      it('handles array schemas', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: JSON.stringify(['item1', 'item2', 'item3']),
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Generate list',
          schema: {
            type: 'array',
            items: { type: 'string' },
          },
        })

        expect(result.result).toEqual(['item1', 'item2', 'item3'])
      })

      it('validates array item types', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: JSON.stringify([1, 'two', 3]), // Mixed types
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Generate numbers',
          schema: {
            type: 'array',
            items: { type: 'number' },
          },
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(GenerativeSchemaError)
      })

      it('supports nested object schemas', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: JSON.stringify({
            user: { name: 'Alice', age: 30 },
            metadata: { createdAt: '2024-01-01' },
          }),
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Generate user data',
          schema: {
            type: 'object',
            properties: {
              user: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  age: { type: 'number' },
                },
              },
              metadata: {
                type: 'object',
                properties: {
                  createdAt: { type: 'string' },
                },
              },
            },
          },
        })

        expect(result.result).toEqual({
          user: { name: 'Alice', age: 30 },
          metadata: { createdAt: '2024-01-01' },
        })
      })

      it('supports enum validation', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: JSON.stringify({ status: 'active' }),
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Get status',
          schema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['active', 'inactive', 'pending'] },
            },
          },
        })

        expect(result.result).toEqual({ status: 'active' })
      })

      it('rejects invalid enum values', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: JSON.stringify({ status: 'unknown' }),
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Get status',
          schema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['active', 'inactive', 'pending'] },
            },
          },
        })

        expect(result.success).toBe(false)
      })
    })

    describe('Type coercion', () => {
      it('coerces string numbers to numbers when schema expects number', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: JSON.stringify({ count: '42' }),
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Get count',
          schema: {
            type: 'object',
            properties: {
              count: { type: 'number' },
            },
          },
          coerceTypes: true,
        })

        expect(result.result).toEqual({ count: 42 })
      })

      it('coerces string booleans to booleans', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: JSON.stringify({ active: 'true', enabled: 'false' }),
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Get flags',
          schema: {
            type: 'object',
            properties: {
              active: { type: 'boolean' },
              enabled: { type: 'boolean' },
            },
          },
          coerceTypes: true,
        })

        expect(result.result).toEqual({ active: true, enabled: false })
      })

      it('does not coerce when coerceTypes is false', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: JSON.stringify({ count: '42' }),
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Get count',
          schema: {
            type: 'object',
            properties: {
              count: { type: 'number' },
            },
          },
          coerceTypes: false,
        })

        expect(result.success).toBe(false)
      })
    })

    describe('JSON parsing', () => {
      it('handles JSON in markdown code blocks', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: '```json\n{"summary": "A summary"}\n```',
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Generate data',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
            },
          },
        })

        expect(result.result).toEqual({ summary: 'A summary' })
      })

      it('handles JSON with surrounding text', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: 'Here is the data:\n{"summary": "A summary"}\nHope this helps!',
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Generate data',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
            },
          },
        })

        expect(result.result).toEqual({ summary: 'A summary' })
      })

      it('fails gracefully on invalid JSON', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: 'This is not valid JSON',
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Generate data',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
            },
          },
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/json|parse/i)
      })

      it('handles JSON with trailing commas', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: '{"summary": "A summary",}', // Trailing comma
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Generate data',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
            },
          },
          lenientParsing: true,
        })

        expect(result.result).toEqual({ summary: 'A summary' })
      })
    })

    describe('Schema retries', () => {
      it('retries generation when schema validation fails', async () => {
        // First attempt: invalid
        mockAIService.generate.mockResolvedValueOnce({
          text: JSON.stringify({ invalid: 'data' }),
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop',
        })
        // Second attempt: valid
        mockAIService.generate.mockResolvedValueOnce({
          text: JSON.stringify({ summary: 'Valid summary' }),
          usage: { inputTokens: 15, outputTokens: 25 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Generate data',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
            },
            required: ['summary'],
          },
          schemaRetries: 2,
        })

        expect(result.success).toBe(true)
        expect(result.result).toEqual({ summary: 'Valid summary' })
        expect(mockAIService.generate).toHaveBeenCalledTimes(2)
      })

      it('fails after all schema retries exhausted', async () => {
        mockAIService.generate.mockResolvedValue({
          text: JSON.stringify({ invalid: 'data' }),
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Generate data',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
            },
            required: ['summary'],
          },
          schemaRetries: 3,
        })

        expect(result.success).toBe(false)
        expect(mockAIService.generate).toHaveBeenCalledTimes(3)
      })

      it('adds validation feedback to retry prompt', async () => {
        // First attempt: invalid
        mockAIService.generate.mockResolvedValueOnce({
          text: JSON.stringify({ wrong: 'field' }),
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop',
        })
        // Second attempt: valid
        mockAIService.generate.mockResolvedValueOnce({
          text: JSON.stringify({ summary: 'Valid summary' }),
          usage: { inputTokens: 15, outputTokens: 25 },
          finishReason: 'stop',
        })

        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Generate data',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
            },
            required: ['summary'],
          },
          schemaRetries: 2,
        })

        // Second call should include validation feedback
        const secondCall = mockAIService.generate.mock.calls[1][0]
        expect(secondCall.prompt).toMatch(/required|summary/i)
      })
    })
  })

  // ==========================================================================
  // 4. STREAMING TESTS
  // ==========================================================================

  describe('Streaming Generation', () => {
    describe('Token streaming', () => {
      it('returns async iterator for streaming', async () => {
        const stream = await executor.executeStreaming({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Write a story',
        })

        expect(stream[Symbol.asyncIterator]).toBeDefined()
      })

      it('yields text chunks', async () => {
        const chunks: string[] = []
        const stream = await executor.executeStreaming({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Write a story',
        })

        for await (const chunk of stream) {
          if (chunk.type === 'text') {
            chunks.push(chunk.text)
          }
        }

        expect(chunks).toEqual(['Hello', ' ', 'World'])
      })

      it('yields done event at end', async () => {
        let doneReceived = false
        const stream = await executor.executeStreaming({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Write a story',
        })

        for await (const chunk of stream) {
          if (chunk.type === 'done') {
            doneReceived = true
          }
        }

        expect(doneReceived).toBe(true)
      })

      it('includes usage in done event', async () => {
        let usage: TokenUsage | undefined
        const stream = await executor.executeStreaming({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Write a story',
        })

        for await (const chunk of stream) {
          if (chunk.type === 'done') {
            usage = chunk.usage
          }
        }

        expect(usage).toBeDefined()
        expect(usage?.inputTokens).toBeGreaterThan(0)
        expect(usage?.outputTokens).toBeGreaterThan(0)
      })

      it('includes finish reason in done event', async () => {
        let finishReason: string | undefined
        const stream = await executor.executeStreaming({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Write a story',
        })

        for await (const chunk of stream) {
          if (chunk.type === 'done') {
            finishReason = chunk.finishReason
          }
        }

        expect(finishReason).toBe('stop')
      })

      it('can collect stream to string', async () => {
        const stream = await executor.executeStreaming({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Write a story',
        })

        const text = await stream.toText()

        expect(text).toBe('Hello World')
      })

      it('emits streaming events', async () => {
        const events: Array<{ type: string; data: unknown }> = []
        const onEvent = vi.fn((type, data) => events.push({ type, data }))

        const executorWithEvents = new GenerativeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          aiService: mockAIService,
          onEvent,
        })

        const stream = await executorWithEvents.executeStreaming({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Write a story',
        })

        for await (const _ of stream) {
          // Consume stream
        }

        expect(events.some((e) => e.type === 'generation.stream.start')).toBe(true)
        expect(events.some((e) => e.type === 'generation.stream.chunk')).toBe(true)
        expect(events.some((e) => e.type === 'generation.stream.end')).toBe(true)
      })
    })

    describe('Abort handling', () => {
      it('can abort streaming with AbortController', async () => {
        mockAIService.stream.mockImplementationOnce(async function* () {
          for (let i = 0; i < 100; i++) {
            await new Promise((resolve) => setTimeout(resolve, 10))
            yield { type: 'text', text: `chunk${i}` }
          }
          yield { type: 'done', usage: { inputTokens: 5, outputTokens: 100 } }
        })

        const controller = new AbortController()

        const stream = await executor.executeStreaming(
          {
            model: 'claude-sonnet-4-20250514',
            prompt: 'Write a long story',
          },
          { signal: controller.signal }
        )

        const chunks: string[] = []
        try {
          for await (const chunk of stream) {
            if (chunk.type === 'text') {
              chunks.push(chunk.text)
              if (chunks.length >= 5) {
                controller.abort()
              }
            }
          }
        } catch (error) {
          expect(error).toBeInstanceOf(GenerativeAbortError)
        }

        expect(chunks.length).toBeLessThan(100)
      })

      it('emits abort event on cancellation', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new GenerativeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          aiService: mockAIService,
          onEvent,
        })

        mockAIService.stream.mockImplementationOnce(async function* () {
          await new Promise((resolve) => setTimeout(resolve, 100))
          yield { type: 'text', text: 'chunk' }
        })

        const controller = new AbortController()
        const stream = await executorWithEvents.executeStreaming(
          {
            model: 'claude-sonnet-4-20250514',
            prompt: 'Test',
          },
          { signal: controller.signal }
        )

        setTimeout(() => controller.abort(), 10)

        try {
          for await (const _ of stream) {
            // Consume
          }
        } catch (error) {
          // Expected
        }

        expect(onEvent).toHaveBeenCalledWith(
          'generation.stream.aborted',
          expect.anything()
        )
      })

      it('stream.cancel() method aborts the stream', async () => {
        mockAIService.stream.mockImplementationOnce(async function* () {
          for (let i = 0; i < 100; i++) {
            await new Promise((resolve) => setTimeout(resolve, 10))
            yield { type: 'text', text: `chunk${i}` }
          }
        })

        const stream = await executor.executeStreaming({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Write a story',
        })

        const chunks: string[] = []
        for await (const chunk of stream) {
          if (chunk.type === 'text') {
            chunks.push(chunk.text)
            if (chunks.length >= 3) {
              stream.cancel()
              break
            }
          }
        }

        expect(chunks.length).toBe(3)
      })
    })

    describe('Streaming with schema', () => {
      it('validates complete response against schema after streaming', async () => {
        mockAIService.stream.mockImplementationOnce(async function* () {
          yield { type: 'text', text: '{"summary":' }
          yield { type: 'text', text: ' "Test' }
          yield { type: 'text', text: ' summary"' }
          yield { type: 'text', text: '}' }
          yield {
            type: 'done',
            usage: { inputTokens: 5, outputTokens: 10 },
            finishReason: 'stop',
          }
        })

        const stream = await executor.executeStreaming({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Generate data',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
            },
          },
        })

        const result = await stream.toJSON()

        expect(result).toEqual({ summary: 'Test summary' })
      })

      it('emits error event if streamed response fails schema', async () => {
        mockAIService.stream.mockImplementationOnce(async function* () {
          yield { type: 'text', text: '{"invalid": "data"}' }
          yield {
            type: 'done',
            usage: { inputTokens: 5, outputTokens: 10 },
            finishReason: 'stop',
          }
        })

        const stream = await executor.executeStreaming({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Generate data',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
            },
            required: ['summary'],
          },
        })

        await expect(stream.toJSON()).rejects.toThrow(GenerativeSchemaError)
      })
    })
  })

  // ==========================================================================
  // 5. MODEL CONFIG TESTS
  // ==========================================================================

  describe('Model Configuration', () => {
    describe('Temperature', () => {
      it('passes temperature to model', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Write creatively',
          temperature: 0.9,
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: 0.9,
          })
        )
      })

      it('uses default temperature when not specified', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: expect.any(Number),
          })
        )
      })

      it('rejects temperature below 0', async () => {
        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          temperature: -0.1,
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/temperature/i)
      })

      it('rejects temperature above 2', async () => {
        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          temperature: 2.5,
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/temperature/i)
      })

      it('accepts temperature of 0 for deterministic output', async () => {
        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          temperature: 0,
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: 0,
          })
        )
      })
    })

    describe('Max tokens', () => {
      it('passes maxTokens to model', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Write a short response',
          maxTokens: 100,
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            maxTokens: 100,
          })
        )
      })

      it('rejects negative maxTokens', async () => {
        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          maxTokens: -100,
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/maxTokens/i)
      })

      it('rejects maxTokens of 0', async () => {
        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          maxTokens: 0,
        })

        expect(result.success).toBe(false)
      })

      it('warns when maxTokens exceeds model limit', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new GenerativeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          aiService: mockAIService,
          onEvent,
        })

        await executorWithEvents.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          maxTokens: 1000000, // Exceeds typical limit
        })

        expect(onEvent).toHaveBeenCalledWith(
          'generation.warning',
          expect.objectContaining({
            message: expect.stringMatching(/maxTokens|limit/i),
          })
        )
      })
    })

    describe('Top P', () => {
      it('passes topP to model', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          topP: 0.9,
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            topP: 0.9,
          })
        )
      })

      it('rejects topP below 0', async () => {
        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          topP: -0.1,
        })

        expect(result.success).toBe(false)
      })

      it('rejects topP above 1', async () => {
        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          topP: 1.5,
        })

        expect(result.success).toBe(false)
      })
    })

    describe('Top K', () => {
      it('passes topK to model', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          topK: 40,
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            topK: 40,
          })
        )
      })

      it('rejects negative topK', async () => {
        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          topK: -10,
        })

        expect(result.success).toBe(false)
      })
    })

    describe('Stop sequences', () => {
      it('passes stop sequences to model', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Write until you see STOP',
          stopSequences: ['STOP', 'END', '---'],
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            stopSequences: ['STOP', 'END', '---'],
          })
        )
      })

      it('handles empty stop sequences array', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          stopSequences: [],
        })

        expect(mockAIService.generate).toHaveBeenCalled()
      })
    })

    describe('Presence and frequency penalty', () => {
      it('passes presencePenalty to model', async () => {
        await executor.execute({
          model: 'gpt-4o',
          prompt: 'Test',
          presencePenalty: 0.5,
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            presencePenalty: 0.5,
          })
        )
      })

      it('passes frequencyPenalty to model', async () => {
        await executor.execute({
          model: 'gpt-4o',
          prompt: 'Test',
          frequencyPenalty: 0.5,
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            frequencyPenalty: 0.5,
          })
        )
      })

      it('rejects penalty values out of range', async () => {
        const result = await executor.execute({
          model: 'gpt-4o',
          prompt: 'Test',
          presencePenalty: 3.0, // Out of range
        })

        expect(result.success).toBe(false)
      })
    })
  })

  // ==========================================================================
  // 6. CONVERSATION TESTS
  // ==========================================================================

  describe('Multi-turn Conversations', () => {
    describe('Message history', () => {
      it('supports array of messages instead of prompt', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' },
            { role: 'user', content: 'How are you?' },
          ],
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: expect.arrayContaining([
              expect.objectContaining({ role: 'user', content: 'Hello' }),
              expect.objectContaining({ role: 'assistant', content: 'Hi there!' }),
              expect.objectContaining({ role: 'user', content: 'How are you?' }),
            ]),
          })
        )
      })

      it('validates message roles', async () => {
        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          messages: [
            { role: 'invalid' as 'user', content: 'Test' },
          ],
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/role/i)
      })

      it('validates message content is not empty', async () => {
        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          messages: [
            { role: 'user', content: '' },
          ],
        })

        expect(result.success).toBe(false)
      })

      it('preserves message order', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          messages: [
            { role: 'user', content: 'First' },
            { role: 'assistant', content: 'Second' },
            { role: 'user', content: 'Third' },
          ],
        })

        const call = mockAIService.generate.mock.calls[0][0]
        expect(call.messages[0].content).toBe('First')
        expect(call.messages[1].content).toBe('Second')
        expect(call.messages[2].content).toBe('Third')
      })
    })

    describe('System prompts', () => {
      it('supports system message', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          systemPrompt: 'You are a helpful assistant.',
          prompt: 'Hello',
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            systemPrompt: 'You are a helpful assistant.',
          })
        )
      })

      it('supports system message with messages array', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          systemPrompt: 'You are a coding assistant.',
          messages: [
            { role: 'user', content: 'Write a function' },
          ],
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            systemPrompt: 'You are a coding assistant.',
            messages: expect.any(Array),
          })
        )
      })

      it('system prompt can use template variables', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          systemPrompt: 'You are an expert in {{domain}}.',
          prompt: 'Tell me about it',
          variables: { domain: 'machine learning' },
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            systemPrompt: 'You are an expert in machine learning.',
          })
        )
      })
    })

    describe('Conversation continuation', () => {
      it('can continue conversation by appending messages', async () => {
        // First turn
        mockAIService.generate.mockResolvedValueOnce({
          text: 'I am Claude.',
          usage: { inputTokens: 5, outputTokens: 5 },
          finishReason: 'stop',
        })

        const result1 = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: 'What is your name?' }],
        })

        // Second turn with history
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          messages: [
            { role: 'user', content: 'What is your name?' },
            { role: 'assistant', content: result1.result as string },
            { role: 'user', content: 'And what can you do?' },
          ],
        })

        expect(mockAIService.generate).toHaveBeenCalledTimes(2)
        const secondCall = mockAIService.generate.mock.calls[1][0]
        expect(secondCall.messages).toHaveLength(3)
      })

      it('supports conversation ID for session tracking', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new GenerativeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          aiService: mockAIService,
          onEvent,
        })

        await executorWithEvents.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Hello',
          conversationId: 'conv-123',
        })

        expect(onEvent).toHaveBeenCalledWith(
          'generation.completed',
          expect.objectContaining({
            conversationId: 'conv-123',
          })
        )
      })

      it('can load conversation history from state', async () => {
        // Store previous conversation
        await mockState.storage.put('conversation:conv-123', {
          messages: [
            { role: 'user', content: 'Previous message' },
            { role: 'assistant', content: 'Previous response' },
          ],
        })

        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Continue our conversation',
          conversationId: 'conv-123',
          loadHistory: true,
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: expect.arrayContaining([
              expect.objectContaining({ content: 'Previous message' }),
              expect.objectContaining({ content: 'Previous response' }),
            ]),
          })
        )
      })

      it('saves conversation to state when saveHistory is true', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: 'Response',
          usage: { inputTokens: 5, outputTokens: 5 },
          finishReason: 'stop',
        })

        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Hello',
          conversationId: 'conv-456',
          saveHistory: true,
        })

        const stored = await mockState.storage.get('conversation:conv-456')
        expect(stored).toBeDefined()
        expect((stored as { messages: Array<{ content: string }> }).messages).toHaveLength(2)
      })
    })

    describe('Message types', () => {
      it('supports multimodal messages with images', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'What is in this image?' },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    mediaType: 'image/png',
                    data: 'base64encodeddata...',
                  },
                },
              ],
            },
          ],
        })

        expect(mockAIService.generate).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: expect.arrayContaining([
              expect.objectContaining({
                content: expect.arrayContaining([
                  expect.objectContaining({ type: 'text' }),
                  expect.objectContaining({ type: 'image' }),
                ]),
              }),
            ]),
          })
        )
      })

      it('supports image URLs', async () => {
        await executor.execute({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Describe this' },
                {
                  type: 'image',
                  source: {
                    type: 'url',
                    url: 'https://example.com/image.png',
                  },
                },
              ],
            },
          ],
        })

        expect(mockAIService.generate).toHaveBeenCalled()
      })
    })
  })

  // ==========================================================================
  // 7. TOOL USE TESTS
  // ==========================================================================

  describe('Tool Use', () => {
    describe('Tool definitions', () => {
      it('passes tool definitions to model', async () => {
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'What is the weather in Paris?',
          tools: [
            {
              name: 'get_weather',
              description: 'Get current weather for a location',
              inputSchema: {
                type: 'object',
                properties: {
                  location: { type: 'string', description: 'City name' },
                },
                required: ['location'],
              },
            },
          ],
        })

        expect(mockAIService.generateWithTools).toHaveBeenCalledWith(
          expect.objectContaining({
            tools: expect.arrayContaining([
              expect.objectContaining({
                name: 'get_weather',
                inputSchema: expect.any(Object),
              }),
            ]),
          })
        )
      })

      it('validates tool definitions', async () => {
        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          tools: [
            {
              name: '', // Invalid: empty name
              description: 'Test tool',
              inputSchema: { type: 'object' },
            },
          ],
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/tool.*name/i)
      })

      it('requires input schema for tools', async () => {
        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          tools: [
            {
              name: 'test_tool',
              description: 'Test tool',
              // Missing inputSchema
            } as ToolDefinition,
          ],
        })

        expect(result.success).toBe(false)
      })
    })

    describe('Tool execution', () => {
      it('executes tool calls and returns results', async () => {
        mockAIService.generateWithTools.mockResolvedValueOnce({
          text: '',
          toolCalls: [
            {
              id: 'call-123',
              name: 'get_weather',
              input: { location: 'Paris' },
            },
          ],
          usage: { inputTokens: 20, outputTokens: 30 },
          finishReason: 'tool_use',
        })

        const toolExecutor = vi.fn().mockResolvedValue({
          temperature: 20,
          conditions: 'sunny',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'What is the weather in Paris?',
          tools: [
            {
              name: 'get_weather',
              description: 'Get weather',
              inputSchema: {
                type: 'object',
                properties: { location: { type: 'string' } },
              },
              execute: toolExecutor,
            },
          ],
        })

        expect(toolExecutor).toHaveBeenCalledWith({ location: 'Paris' })
      })

      it('continues generation after tool use', async () => {
        // First call: model requests tool use
        mockAIService.generateWithTools.mockResolvedValueOnce({
          text: '',
          toolCalls: [
            {
              id: 'call-123',
              name: 'get_weather',
              input: { location: 'Paris' },
            },
          ],
          usage: { inputTokens: 20, outputTokens: 30 },
          finishReason: 'tool_use',
        })

        // Second call: model generates final response
        mockAIService.generateWithTools.mockResolvedValueOnce({
          text: 'The weather in Paris is sunny and 20 degrees.',
          toolCalls: [],
          usage: { inputTokens: 50, outputTokens: 20 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'What is the weather in Paris?',
          tools: [
            {
              name: 'get_weather',
              description: 'Get weather',
              inputSchema: {
                type: 'object',
                properties: { location: { type: 'string' } },
              },
              execute: async () => ({ temperature: 20, conditions: 'sunny' }),
            },
          ],
        })

        expect(result.result).toContain('Paris')
        expect(mockAIService.generateWithTools).toHaveBeenCalledTimes(2)
      })

      it('handles multiple tool calls in single response', async () => {
        mockAIService.generateWithTools.mockResolvedValueOnce({
          text: '',
          toolCalls: [
            {
              id: 'call-1',
              name: 'get_weather',
              input: { location: 'Paris' },
            },
            {
              id: 'call-2',
              name: 'get_weather',
              input: { location: 'London' },
            },
          ],
          usage: { inputTokens: 30, outputTokens: 40 },
          finishReason: 'tool_use',
        })

        mockAIService.generateWithTools.mockResolvedValueOnce({
          text: 'Paris is 20C, London is 15C.',
          toolCalls: [],
          usage: { inputTokens: 80, outputTokens: 20 },
          finishReason: 'stop',
        })

        const toolExecutor = vi.fn()
          .mockResolvedValueOnce({ temperature: 20 })
          .mockResolvedValueOnce({ temperature: 15 })

        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Compare weather in Paris and London',
          tools: [
            {
              name: 'get_weather',
              description: 'Get weather',
              inputSchema: {
                type: 'object',
                properties: { location: { type: 'string' } },
              },
              execute: toolExecutor,
            },
          ],
        })

        expect(toolExecutor).toHaveBeenCalledTimes(2)
      })

      it('executes tools in parallel when possible', async () => {
        mockAIService.generateWithTools.mockResolvedValueOnce({
          text: '',
          toolCalls: [
            { id: 'call-1', name: 'tool1', input: {} },
            { id: 'call-2', name: 'tool2', input: {} },
          ],
          usage: { inputTokens: 20, outputTokens: 30 },
          finishReason: 'tool_use',
        })

        mockAIService.generateWithTools.mockResolvedValueOnce({
          text: 'Done',
          toolCalls: [],
          usage: { inputTokens: 50, outputTokens: 10 },
          finishReason: 'stop',
        })

        const startTimes: number[] = []
        const toolExecutor = async () => {
          startTimes.push(Date.now())
          await new Promise((resolve) => setTimeout(resolve, 50))
          return { result: 'ok' }
        }

        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          tools: [
            {
              name: 'tool1',
              description: 'Tool 1',
              inputSchema: { type: 'object' },
              execute: toolExecutor,
            },
            {
              name: 'tool2',
              description: 'Tool 2',
              inputSchema: { type: 'object' },
              execute: toolExecutor,
            },
          ],
          parallelToolCalls: true,
        })

        // Both tools should start at roughly the same time
        expect(Math.abs(startTimes[0] - startTimes[1])).toBeLessThan(20)
      })
    })

    describe('Tool errors', () => {
      it('handles tool execution errors gracefully', async () => {
        mockAIService.generateWithTools.mockResolvedValueOnce({
          text: '',
          toolCalls: [
            {
              id: 'call-123',
              name: 'failing_tool',
              input: {},
            },
          ],
          usage: { inputTokens: 20, outputTokens: 30 },
          finishReason: 'tool_use',
        })

        mockAIService.generateWithTools.mockResolvedValueOnce({
          text: 'I encountered an error with the tool.',
          toolCalls: [],
          usage: { inputTokens: 50, outputTokens: 20 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          tools: [
            {
              name: 'failing_tool',
              description: 'A tool that fails',
              inputSchema: { type: 'object' },
              execute: async () => {
                throw new Error('Tool execution failed')
              },
            },
          ],
        })

        // Should continue with error message to model
        expect(result.success).toBe(true)
      })

      it('emits tool error event', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new GenerativeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          aiService: mockAIService,
          onEvent,
        })

        mockAIService.generateWithTools.mockResolvedValueOnce({
          text: '',
          toolCalls: [
            { id: 'call-123', name: 'failing_tool', input: {} },
          ],
          usage: { inputTokens: 20, outputTokens: 30 },
          finishReason: 'tool_use',
        })

        mockAIService.generateWithTools.mockResolvedValueOnce({
          text: 'Handled error',
          toolCalls: [],
          usage: { inputTokens: 50, outputTokens: 10 },
          finishReason: 'stop',
        })

        await executorWithEvents.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          tools: [
            {
              name: 'failing_tool',
              description: 'Fails',
              inputSchema: { type: 'object' },
              execute: async () => {
                throw new Error('Tool failed')
              },
            },
          ],
        })

        expect(onEvent).toHaveBeenCalledWith(
          'generation.tool.error',
          expect.objectContaining({
            toolName: 'failing_tool',
            error: expect.stringContaining('Tool failed'),
          })
        )
      })

      it('respects maxToolIterations limit', async () => {
        // Model keeps requesting tool use
        mockAIService.generateWithTools.mockResolvedValue({
          text: '',
          toolCalls: [
            { id: 'call', name: 'infinite_tool', input: {} },
          ],
          usage: { inputTokens: 20, outputTokens: 30 },
          finishReason: 'tool_use',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          tools: [
            {
              name: 'infinite_tool',
              description: 'Infinite',
              inputSchema: { type: 'object' },
              execute: async () => ({ continue: true }),
            },
          ],
          maxToolIterations: 3,
        })

        expect(mockAIService.generateWithTools).toHaveBeenCalledTimes(3)
        expect(result.error).toBeInstanceOf(GenerativeToolError)
      })
    })

    describe('Tool events', () => {
      it('emits event when tool is called', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new GenerativeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          aiService: mockAIService,
          onEvent,
        })

        mockAIService.generateWithTools.mockResolvedValueOnce({
          text: '',
          toolCalls: [
            { id: 'call-123', name: 'test_tool', input: { arg: 'value' } },
          ],
          usage: { inputTokens: 20, outputTokens: 30 },
          finishReason: 'tool_use',
        })

        mockAIService.generateWithTools.mockResolvedValueOnce({
          text: 'Done',
          toolCalls: [],
          usage: { inputTokens: 50, outputTokens: 10 },
          finishReason: 'stop',
        })

        await executorWithEvents.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          tools: [
            {
              name: 'test_tool',
              description: 'Test',
              inputSchema: { type: 'object' },
              execute: async () => ({ result: 'ok' }),
            },
          ],
        })

        expect(onEvent).toHaveBeenCalledWith(
          'generation.tool.called',
          expect.objectContaining({
            toolName: 'test_tool',
            input: { arg: 'value' },
          })
        )
      })

      it('emits event when tool completes', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new GenerativeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          aiService: mockAIService,
          onEvent,
        })

        mockAIService.generateWithTools.mockResolvedValueOnce({
          text: '',
          toolCalls: [
            { id: 'call-123', name: 'test_tool', input: {} },
          ],
          usage: { inputTokens: 20, outputTokens: 30 },
          finishReason: 'tool_use',
        })

        mockAIService.generateWithTools.mockResolvedValueOnce({
          text: 'Done',
          toolCalls: [],
          usage: { inputTokens: 50, outputTokens: 10 },
          finishReason: 'stop',
        })

        await executorWithEvents.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          tools: [
            {
              name: 'test_tool',
              description: 'Test',
              inputSchema: { type: 'object' },
              execute: async () => ({ result: 'success' }),
            },
          ],
        })

        expect(onEvent).toHaveBeenCalledWith(
          'generation.tool.completed',
          expect.objectContaining({
            toolName: 'test_tool',
            result: { result: 'success' },
          })
        )
      })
    })
  })

  // ==========================================================================
  // 8. ERROR HANDLING TESTS
  // ==========================================================================

  describe('Error Handling', () => {
    describe('API errors', () => {
      it('handles model API errors', async () => {
        mockAIService.generate.mockRejectedValueOnce(new Error('API Error'))

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(GenerativeModelError)
      })

      it('includes API error details', async () => {
        const apiError = new Error('Invalid API key')
        ;(apiError as Error & { code: string }).code = 'invalid_api_key'
        mockAIService.generate.mockRejectedValueOnce(apiError)

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
        })

        expect(result.error?.message).toContain('Invalid API key')
        expect(result.error?.code).toBe('invalid_api_key')
      })

      it('emits error event on API failure', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new GenerativeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          aiService: mockAIService,
          onEvent,
        })

        mockAIService.generate.mockRejectedValueOnce(new Error('API Error'))

        await executorWithEvents.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
        })

        expect(onEvent).toHaveBeenCalledWith(
          'generation.error',
          expect.objectContaining({
            error: expect.stringContaining('API Error'),
          })
        )
      })
    })

    describe('Rate limit handling', () => {
      it('handles rate limit errors', async () => {
        const rateLimitError = new Error('Rate limit exceeded')
        ;(rateLimitError as Error & { code: string }).code = 'rate_limit_exceeded'
        mockAIService.generate.mockRejectedValueOnce(rateLimitError)

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(GenerativeRateLimitError)
      })

      it('retries on rate limit with backoff', async () => {
        // First call: rate limited
        const rateLimitError = new Error('Rate limit')
        ;(rateLimitError as Error & { code: string; retryAfter: number }).code = 'rate_limit_exceeded'
        ;(rateLimitError as Error & { retryAfter: number }).retryAfter = 1

        mockAIService.generate.mockRejectedValueOnce(rateLimitError)

        // Second call: succeeds
        mockAIService.generate.mockResolvedValueOnce({
          text: 'Success',
          usage: { inputTokens: 5, outputTokens: 5 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          retryOnRateLimit: true,
          maxRetries: 2,
        })

        expect(result.success).toBe(true)
        expect(mockAIService.generate).toHaveBeenCalledTimes(2)
      })

      it('respects retryAfter header', async () => {
        const rateLimitError = new Error('Rate limit')
        ;(rateLimitError as Error & { code: string; retryAfter: number }).code = 'rate_limit_exceeded'
        ;(rateLimitError as Error & { retryAfter: number }).retryAfter = 2 // 2 seconds

        mockAIService.generate.mockRejectedValueOnce(rateLimitError)
        mockAIService.generate.mockResolvedValueOnce({
          text: 'Success',
          usage: { inputTokens: 5, outputTokens: 5 },
          finishReason: 'stop',
        })

        const startTime = Date.now()
        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          retryOnRateLimit: true,
        })
        const duration = Date.now() - startTime

        expect(duration).toBeGreaterThanOrEqual(2000)
      })

      it('fails after max retries on rate limit', async () => {
        const rateLimitError = new Error('Rate limit')
        ;(rateLimitError as Error & { code: string }).code = 'rate_limit_exceeded'
        mockAIService.generate.mockRejectedValue(rateLimitError)

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          retryOnRateLimit: true,
          maxRetries: 3,
        })

        expect(result.success).toBe(false)
        expect(mockAIService.generate).toHaveBeenCalledTimes(3)
      })
    })

    describe('Timeout handling', () => {
      it('handles generation timeout', async () => {
        mockAIService.generate.mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000))
          return { text: 'Late response', usage: { inputTokens: 5, outputTokens: 5 } }
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          timeout: 100,
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(GenerativeTimeoutError)
      })

      it('emits timeout event', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new GenerativeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          aiService: mockAIService,
          onEvent,
        })

        mockAIService.generate.mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000))
          return { text: 'Late', usage: { inputTokens: 5, outputTokens: 5 } }
        })

        await executorWithEvents.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          timeout: 50,
        })

        expect(onEvent).toHaveBeenCalledWith(
          'generation.timeout',
          expect.anything()
        )
      })

      it('retries on transient timeout errors', async () => {
        // First call: timeout
        mockAIService.generate.mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 200))
          return { text: 'Late', usage: { inputTokens: 5, outputTokens: 5 } }
        })

        // Second call: succeeds quickly
        mockAIService.generate.mockResolvedValueOnce({
          text: 'Success',
          usage: { inputTokens: 5, outputTokens: 5 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          timeout: 100,
          retryOnTimeout: true,
          maxRetries: 2,
        })

        expect(result.success).toBe(true)
      })
    })

    describe('Validation errors', () => {
      it('validates model is specified', async () => {
        const result = await executor.execute({
          model: '',
          prompt: 'Test',
        })

        expect(result.success).toBe(false)
        expect(result.error).toBeInstanceOf(GenerativeValidationError)
      })

      it('validates either prompt or messages is provided', async () => {
        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          // Missing both prompt and messages
        } as GenerativeOptions)

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/prompt|messages/i)
      })

      it('validates schema is valid JSON Schema', async () => {
        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          schema: {
            type: 'invalid-type',
          },
        })

        expect(result.success).toBe(false)
        expect(result.error?.message).toMatch(/schema/i)
      })
    })

    describe('Retry logic', () => {
      it('retries on transient errors', async () => {
        // First call: transient error
        mockAIService.generate.mockRejectedValueOnce(new Error('Network error'))

        // Second call: succeeds
        mockAIService.generate.mockResolvedValueOnce({
          text: 'Success',
          usage: { inputTokens: 5, outputTokens: 5 },
          finishReason: 'stop',
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          maxRetries: 2,
        })

        expect(result.success).toBe(true)
        expect(mockAIService.generate).toHaveBeenCalledTimes(2)
      })

      it('does not retry on non-retryable errors', async () => {
        const authError = new Error('Invalid API key')
        ;(authError as Error & { code: string }).code = 'authentication_error'
        mockAIService.generate.mockRejectedValue(authError)

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          maxRetries: 3,
        })

        expect(result.success).toBe(false)
        expect(mockAIService.generate).toHaveBeenCalledTimes(1)
      })

      it('uses exponential backoff for retries', async () => {
        const retryTimes: number[] = []

        mockAIService.generate.mockImplementation(async () => {
          retryTimes.push(Date.now())
          throw new Error('Transient error')
        })

        await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          maxRetries: 3,
          retryDelay: 50,
          retryBackoff: 'exponential',
        })

        // Check delays are increasing
        if (retryTimes.length >= 3) {
          const delay1 = retryTimes[1] - retryTimes[0]
          const delay2 = retryTimes[2] - retryTimes[1]
          expect(delay2).toBeGreaterThan(delay1 * 1.5)
        }
      })

      it('emits retry event', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new GenerativeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          aiService: mockAIService,
          onEvent,
        })

        mockAIService.generate.mockRejectedValueOnce(new Error('Transient'))
        mockAIService.generate.mockResolvedValueOnce({
          text: 'Success',
          usage: { inputTokens: 5, outputTokens: 5 },
          finishReason: 'stop',
        })

        await executorWithEvents.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
          maxRetries: 2,
        })

        expect(onEvent).toHaveBeenCalledWith(
          'generation.retry',
          expect.objectContaining({
            attempt: 1,
            error: expect.any(String),
          })
        )
      })
    })

    describe('Content filter', () => {
      it('handles content filter response', async () => {
        mockAIService.generate.mockResolvedValueOnce({
          text: '',
          usage: { inputTokens: 10, outputTokens: 0 },
          finishReason: 'content_filter',
          contentFiltered: true,
        })

        const result = await executor.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Generate inappropriate content',
        })

        expect(result.finishReason).toBe('content_filter')
      })

      it('emits content filter event', async () => {
        const onEvent = vi.fn()
        const executorWithEvents = new GenerativeFunctionExecutor({
          state: mockState,
          env: mockEnv,
          aiService: mockAIService,
          onEvent,
        })

        mockAIService.generate.mockResolvedValueOnce({
          text: '',
          usage: { inputTokens: 10, outputTokens: 0 },
          finishReason: 'content_filter',
        })

        await executorWithEvents.execute({
          model: 'claude-sonnet-4-20250514',
          prompt: 'Test',
        })

        expect(onEvent).toHaveBeenCalledWith(
          'generation.content_filtered',
          expect.anything()
        )
      })
    })
  })
})
