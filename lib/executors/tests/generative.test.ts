import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * GenerativeFunctionExecutor Tests
 *
 * Comprehensive TDD tests for the GenerativeFunctionExecutor which handles
 * LLM-based generation with support for:
 * - Basic generation: prompt execution, model selection, token tracking
 * - Templates: variable substitution ({{var}}), nested paths, function prompts
 * - Schemas: JSON schema validation, type coercion, retries on validation failure
 * - Streaming: async iterator, abort handling, stream-to-text/JSON
 * - Model config: temperature, maxTokens, topP, topK, stopSequences, penalties
 * - Conversations: message history, system prompts, conversation persistence
 * - Tool use: tool definitions, execution, parallel calls, iteration limits
 * - Error handling: rate limits, timeouts, retries with backoff, validation errors
 */

import {
  GenerativeFunctionExecutor,
  GenerativeOptions,
  GenerativeExecutionContext,
  GenerativeExecutionResult,
  GenerativeModelError,
  GenerativeValidationError,
  GenerativeRateLimitError,
  GenerativeTimeoutError,
  GenerativeAbortError,
  GenerativeSchemaError,
  GenerativeToolError,
  AIService,
  GenerateResult,
  GenerateWithToolsResult,
  StreamChunk,
  ToolDefinition,
  Message,
  TokenUsage,
} from '../GenerativeFunctionExecutor'

// ============================================================================
// Test Fixtures & Mocks
// ============================================================================

const createMockStorage = () => {
  const storage = new Map<string, unknown>()
  return {
    get: vi.fn(async (key: string) => storage.get(key)),
    put: vi.fn(async (key: string, value: unknown) => {
      storage.set(key, value)
    }),
    delete: vi.fn(async (key: string) => storage.delete(key)),
    list: vi.fn(async () => storage),
    _internal: storage,
  }
}

const createMockState = () => ({
  id: { toString: () => 'test-do-id' },
  storage: createMockStorage(),
})

const createMockAIService = (overrides: Partial<AIService> = {}): AIService => ({
  generate: vi.fn(async () => ({
    text: 'Generated response',
    usage: { inputTokens: 10, outputTokens: 20 },
    finishReason: 'stop' as const,
  })),
  stream: vi.fn(async function* () {
    yield { type: 'text' as const, text: 'Hello ' }
    yield { type: 'text' as const, text: 'World' }
    yield { type: 'done' as const, usage: { inputTokens: 5, outputTokens: 10 } }
  }),
  generateWithTools: vi.fn(async () => ({
    text: 'Tool result response',
    usage: { inputTokens: 15, outputTokens: 25 },
    finishReason: 'stop' as const,
    toolCalls: [],
  })),
  ...overrides,
})

const createMockContext = (overrides: Partial<GenerativeExecutionContext> = {}): GenerativeExecutionContext => ({
  state: createMockState() as unknown as GenerativeExecutionContext['state'],
  env: {},
  aiService: createMockAIService(),
  onEvent: vi.fn(),
  ...overrides,
})

// ============================================================================
// Basic Generation Tests
// ============================================================================

describe('GenerativeFunctionExecutor - Basic Generation', () => {
  let executor: GenerativeFunctionExecutor
  let context: GenerativeExecutionContext

  beforeEach(() => {
    context = createMockContext()
    executor = new GenerativeFunctionExecutor(context)
  })

  it('executes a simple prompt and returns result', async () => {
    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Hello, world!',
    })

    expect(result.success).toBe(true)
    expect(result.result).toBe('Generated response')
    expect(result.model).toBe('claude-sonnet-4-20250514')
  })

  it('tracks token usage in result', async () => {
    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test prompt',
    })

    expect(result.usage).toBeDefined()
    expect(result.usage.inputTokens).toBe(10)
    expect(result.usage.outputTokens).toBe(20)
    expect(result.usage.totalTokens).toBe(30)
  })

  it('tracks execution duration', async () => {
    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test prompt',
    })

    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  it('returns finish reason from model', async () => {
    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test prompt',
    })

    expect(result.finishReason).toBe('stop')
  })

  it('passes prompt to AI service', async () => {
    await executor.execute({
      model: 'gpt-4o',
      prompt: 'My test prompt',
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
        prompt: 'My test prompt',
      })
    )
  })

  it('emits generation.started and generation.completed events', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
    })

    expect(context.onEvent).toHaveBeenCalledWith(
      'generation.started',
      expect.objectContaining({ invocationId: expect.any(String) })
    )
    expect(context.onEvent).toHaveBeenCalledWith(
      'generation.completed',
      expect.objectContaining({ invocationId: expect.any(String) })
    )
  })

  it('emits generation.tokens event with usage', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
    })

    expect(context.onEvent).toHaveBeenCalledWith(
      'generation.tokens',
      expect.objectContaining({
        inputTokens: 10,
        outputTokens: 20,
      })
    )
  })
})

// ============================================================================
// Template Variable Substitution Tests
// ============================================================================

describe('GenerativeFunctionExecutor - Templates', () => {
  let executor: GenerativeFunctionExecutor
  let context: GenerativeExecutionContext

  beforeEach(() => {
    context = createMockContext()
    executor = new GenerativeFunctionExecutor(context)
  })

  it('substitutes simple {{var}} variables in prompt', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Hello {{name}}!',
      variables: { name: 'World' },
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Hello World!',
      })
    )
  })

  it('substitutes multiple variables', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: '{{greeting}} {{name}}, welcome to {{place}}!',
      variables: { greeting: 'Hello', name: 'Alice', place: 'Wonderland' },
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Hello Alice, welcome to Wonderland!',
      })
    )
  })

  it('handles nested path variables like {{user.name}}', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Hello {{user.name}}!',
      variables: { user: { name: 'Bob' } },
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Hello Bob!',
      })
    )
  })

  it('handles array index paths like {{items[0]}}', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'First item: {{items[0]}}',
      variables: { items: ['apple', 'banana', 'cherry'] },
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'First item: apple',
      })
    )
  })

  it('replaces missing variables with empty string', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Hello {{name}}!',
      variables: {},
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Hello !',
      })
    )
  })

  it('supports function prompts', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: (input: unknown) => `Generated: ${JSON.stringify(input)}`,
      input: { data: 'test' },
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Generated: {"data":"test"}',
      })
    )
  })

  it('supports async function prompts', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: async (input: unknown) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return `Async: ${JSON.stringify(input)}`
      },
      input: { value: 42 },
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Async: {"value":42}',
      })
    )
  })

  it('handles arrays as comma-separated values', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Tags: {{tags}}',
      variables: { tags: ['red', 'green', 'blue'] },
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Tags: red,green,blue',
      })
    )
  })

  it('applies template substitution to system prompts', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Hello',
      systemPrompt: 'You are {{role}}.',
      variables: { role: 'a helpful assistant' },
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: 'You are a helpful assistant.',
      })
    )
  })
})

// ============================================================================
// JSON Schema Validation Tests
// ============================================================================

describe('GenerativeFunctionExecutor - Schema Validation', () => {
  let executor: GenerativeFunctionExecutor
  let context: GenerativeExecutionContext

  beforeEach(() => {
    context = createMockContext({
      aiService: createMockAIService({
        generate: vi.fn(async () => ({
          text: '{"name": "Alice", "age": 30}',
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop' as const,
        })),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)
  })

  it('validates response against JSON schema', async () => {
    const result = await executor.execute<{ name: string; age: number }>({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Generate a person',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      },
    })

    expect(result.success).toBe(true)
    expect(result.result).toEqual({ name: 'Alice', age: 30 })
  })

  it('returns error for schema validation failure', async () => {
    context = createMockContext({
      aiService: createMockAIService({
        generate: vi.fn(async () => ({
          text: '{"name": "Alice"}', // missing required 'age'
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop' as const,
        })),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Generate a person',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      },
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeInstanceOf(GenerativeSchemaError)
  })

  it('coerces types when coerceTypes is enabled', async () => {
    context = createMockContext({
      aiService: createMockAIService({
        generate: vi.fn(async () => ({
          text: '{"count": "42", "active": "true"}',
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop' as const,
        })),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const result = await executor.execute<{ count: number; active: boolean }>({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Generate data',
      schema: {
        type: 'object',
        properties: {
          count: { type: 'number' },
          active: { type: 'boolean' },
        },
      },
      coerceTypes: true,
    })

    expect(result.success).toBe(true)
    expect(result.result?.count).toBe(42)
    expect(result.result?.active).toBe(true)
  })

  it('retries on validation failure when schemaRetries > 1', async () => {
    let callCount = 0
    context = createMockContext({
      aiService: createMockAIService({
        generate: vi.fn(async () => {
          callCount++
          if (callCount === 1) {
            return {
              text: '{"name": "Alice"}', // missing age
              usage: { inputTokens: 10, outputTokens: 20 },
              finishReason: 'stop' as const,
            }
          }
          return {
            text: '{"name": "Alice", "age": 25}', // correct on retry
            usage: { inputTokens: 10, outputTokens: 20 },
            finishReason: 'stop' as const,
          }
        }),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const result = await executor.execute<{ name: string; age: number }>({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Generate a person',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      },
      schemaRetries: 3,
    })

    expect(result.success).toBe(true)
    expect(result.result).toEqual({ name: 'Alice', age: 25 })
    expect(callCount).toBe(2)
  })

  it('extracts JSON from markdown code blocks', async () => {
    context = createMockContext({
      aiService: createMockAIService({
        generate: vi.fn(async () => ({
          text: 'Here is the result:\n```json\n{"value": 123}\n```\nDone!',
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop' as const,
        })),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const result = await executor.execute<{ value: number }>({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Generate JSON',
      schema: {
        type: 'object',
        properties: { value: { type: 'number' } },
      },
    })

    expect(result.success).toBe(true)
    expect(result.result).toEqual({ value: 123 })
  })

  it('validates array schemas', async () => {
    context = createMockContext({
      aiService: createMockAIService({
        generate: vi.fn(async () => ({
          text: '[1, 2, 3]',
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop' as const,
        })),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const result = await executor.execute<number[]>({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Generate numbers',
      schema: {
        type: 'array',
        items: { type: 'number' },
      },
    })

    expect(result.success).toBe(true)
    expect(result.result).toEqual([1, 2, 3])
  })

  it('validates enum values', async () => {
    context = createMockContext({
      aiService: createMockAIService({
        generate: vi.fn(async () => ({
          text: '{"status": "active"}',
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop' as const,
        })),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const result = await executor.execute<{ status: string }>({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Generate status',
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'inactive', 'pending'] },
        },
      },
    })

    expect(result.success).toBe(true)
    expect(result.result?.status).toBe('active')
  })

  it('handles lenient parsing with trailing commas', async () => {
    context = createMockContext({
      aiService: createMockAIService({
        generate: vi.fn(async () => ({
          text: '{"name": "Test", "value": 42,}', // trailing comma
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'stop' as const,
        })),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const result = await executor.execute<{ name: string; value: number }>({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Generate data',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'number' },
        },
      },
      lenientParsing: true,
    })

    expect(result.success).toBe(true)
    expect(result.result).toEqual({ name: 'Test', value: 42 })
  })
})

// ============================================================================
// Streaming Tests
// ============================================================================

describe('GenerativeFunctionExecutor - Streaming', () => {
  let executor: GenerativeFunctionExecutor
  let context: GenerativeExecutionContext

  beforeEach(() => {
    context = createMockContext()
    executor = new GenerativeFunctionExecutor(context)
  })

  it('returns an async iterator for streaming', async () => {
    const stream = await executor.executeStreaming({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Generate text',
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.some((c) => c.type === 'text')).toBe(true)
    expect(chunks.some((c) => c.type === 'done')).toBe(true)
  })

  it('collects text with toText()', async () => {
    const stream = await executor.executeStreaming({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Generate text',
    })

    const text = await stream.toText()
    expect(text).toBe('Hello World')
  })

  it('parses JSON with toJSON()', async () => {
    context = createMockContext({
      aiService: createMockAIService({
        stream: vi.fn(async function* () {
          yield { type: 'text' as const, text: '{"result":' }
          yield { type: 'text' as const, text: ' "success"}' }
          yield { type: 'done' as const, usage: { inputTokens: 5, outputTokens: 10 } }
        }),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const stream = await executor.executeStreaming({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Generate JSON',
    })

    const json = await stream.toJSON<{ result: string }>()
    expect(json).toEqual({ result: 'success' })
  })

  it('can be cancelled via cancel()', async () => {
    let yieldCount = 0
    context = createMockContext({
      aiService: createMockAIService({
        stream: vi.fn(async function* () {
          for (let i = 0; i < 10; i++) {
            yieldCount++
            yield { type: 'text' as const, text: `chunk ${i} ` }
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
          yield { type: 'done' as const, usage: { inputTokens: 5, outputTokens: 10 } }
        }),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const stream = await executor.executeStreaming({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Generate text',
    })

    // Cancel after first chunk
    setTimeout(() => stream.cancel(), 15)

    const chunks: StreamChunk[] = []
    try {
      for await (const chunk of stream) {
        chunks.push(chunk)
      }
    } catch (err) {
      // Expected abort error
      expect(err).toBeInstanceOf(GenerativeAbortError)
    }

    // Should have received some but not all chunks
    expect(chunks.length).toBeLessThan(10)
  })

  it('handles abort signal', async () => {
    const controller = new AbortController()
    context = createMockContext({
      aiService: createMockAIService({
        stream: vi.fn(async function* () {
          for (let i = 0; i < 10; i++) {
            yield { type: 'text' as const, text: `chunk ${i} ` }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          yield { type: 'done' as const, usage: { inputTokens: 5, outputTokens: 10 } }
        }),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const stream = await executor.executeStreaming(
      {
        model: 'claude-sonnet-4-20250514',
        prompt: 'Generate text',
      },
      { signal: controller.signal }
    )

    // Abort after 60ms
    setTimeout(() => controller.abort(), 60)

    const chunks: StreamChunk[] = []
    try {
      for await (const chunk of stream) {
        chunks.push(chunk)
      }
    } catch (err) {
      expect(err).toBeInstanceOf(GenerativeAbortError)
    }

    expect(chunks.length).toBeLessThan(10)
  })

  it('emits stream events', async () => {
    await executor.executeStreaming({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Generate text',
    })

    expect(context.onEvent).toHaveBeenCalledWith(
      'generation.stream.start',
      expect.any(Object)
    )
  })
})

// ============================================================================
// Model Configuration Tests
// ============================================================================

describe('GenerativeFunctionExecutor - Model Configuration', () => {
  let executor: GenerativeFunctionExecutor
  let context: GenerativeExecutionContext

  beforeEach(() => {
    context = createMockContext()
    executor = new GenerativeFunctionExecutor(context)
  })

  it('passes temperature to AI service', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      temperature: 0.7,
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.7,
      })
    )
  })

  it('passes maxTokens to AI service', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      maxTokens: 1000,
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 1000,
      })
    )
  })

  it('passes topP to AI service', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      topP: 0.9,
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        topP: 0.9,
      })
    )
  })

  it('passes topK to AI service', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      topK: 40,
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        topK: 40,
      })
    )
  })

  it('passes stopSequences to AI service', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      stopSequences: ['END', 'STOP'],
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        stopSequences: ['END', 'STOP'],
      })
    )
  })

  it('passes presencePenalty to AI service', async () => {
    await executor.execute({
      model: 'gpt-4o',
      prompt: 'Test',
      presencePenalty: 0.5,
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        presencePenalty: 0.5,
      })
    )
  })

  it('passes frequencyPenalty to AI service', async () => {
    await executor.execute({
      model: 'gpt-4o',
      prompt: 'Test',
      frequencyPenalty: 0.3,
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        frequencyPenalty: 0.3,
      })
    )
  })

  it('uses default temperature of 1.0', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 1.0,
      })
    )
  })

  it('validates temperature range (0-2)', async () => {
    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      temperature: 2.5,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeInstanceOf(GenerativeValidationError)
    expect(result.error?.message).toContain('temperature')
  })

  it('validates topP range (0-1)', async () => {
    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      topP: 1.5,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeInstanceOf(GenerativeValidationError)
    expect(result.error?.message).toContain('topP')
  })

  it('validates maxTokens is positive', async () => {
    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      maxTokens: -100,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeInstanceOf(GenerativeValidationError)
    expect(result.error?.message).toContain('maxTokens')
  })

  it('validates penalty range (-2 to 2)', async () => {
    const result = await executor.execute({
      model: 'gpt-4o',
      prompt: 'Test',
      presencePenalty: 3,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeInstanceOf(GenerativeValidationError)
    expect(result.error?.message).toContain('presencePenalty')
  })
})

// ============================================================================
// Conversation Tests
// ============================================================================

describe('GenerativeFunctionExecutor - Conversations', () => {
  let executor: GenerativeFunctionExecutor
  let context: GenerativeExecutionContext

  beforeEach(() => {
    context = createMockContext()
    executor = new GenerativeFunctionExecutor(context)
  })

  it('passes message history to AI service', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' },
    ]

    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      messages,
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages,
      })
    )
  })

  it('passes system prompt separately', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Hello',
      systemPrompt: 'You are a helpful assistant.',
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: 'You are a helpful assistant.',
      })
    )
  })

  it('saves conversation history when saveHistory is true', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Hello',
      conversationId: 'conv-123',
      saveHistory: true,
    })

    expect(context.state.storage.put).toHaveBeenCalledWith(
      'conversation:conv-123',
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user' }),
          expect.objectContaining({ role: 'assistant' }),
        ]),
      })
    )
  })

  it('loads conversation history when loadHistory is true', async () => {
    // Pre-populate conversation history
    const storage = context.state.storage as ReturnType<typeof createMockStorage>
    storage._internal.set('conversation:conv-456', {
      messages: [
        { role: 'user', content: 'Previous message' },
        { role: 'assistant', content: 'Previous response' },
      ],
    })

    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'New message',
      conversationId: 'conv-456',
      loadHistory: true,
    })

    expect(context.aiService.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ content: 'Previous message' }),
          expect.objectContaining({ content: 'Previous response' }),
          expect.objectContaining({ content: 'New message' }),
        ]),
      })
    )
  })

  it('validates message roles', async () => {
    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      messages: [
        { role: 'invalid' as Message['role'], content: 'Test' },
      ],
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeInstanceOf(GenerativeValidationError)
    expect(result.error?.message).toContain('role')
  })

  it('validates message content is not empty', async () => {
    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      messages: [
        { role: 'user', content: '' },
      ],
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeInstanceOf(GenerativeValidationError)
    expect(result.error?.message).toContain('empty')
  })

  it('emits conversationId in completion event', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Hello',
      conversationId: 'conv-789',
    })

    expect(context.onEvent).toHaveBeenCalledWith(
      'generation.completed',
      expect.objectContaining({ conversationId: 'conv-789' })
    )
  })
})

// ============================================================================
// Tool Use Tests
// ============================================================================

describe('GenerativeFunctionExecutor - Tool Use', () => {
  let executor: GenerativeFunctionExecutor
  let context: GenerativeExecutionContext

  beforeEach(() => {
    context = createMockContext()
    executor = new GenerativeFunctionExecutor(context)
  })

  it('passes tool definitions to AI service', async () => {
    const tools: ToolDefinition[] = [
      {
        name: 'get_weather',
        description: 'Get weather for a location',
        inputSchema: {
          type: 'object',
          properties: { location: { type: 'string' } },
        },
        execute: async () => ({ temp: 72, condition: 'sunny' }),
      },
    ]

    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: "What's the weather?",
      tools,
    })

    expect(context.aiService.generateWithTools).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'get_weather' }),
        ]),
      })
    )
  })

  it('executes tool and returns result to model', async () => {
    const toolExecute = vi.fn(async () => ({ temp: 72, condition: 'sunny' }))

    context = createMockContext({
      aiService: createMockAIService({
        generateWithTools: vi
          .fn()
          .mockResolvedValueOnce({
            text: '',
            usage: { inputTokens: 10, outputTokens: 20 },
            finishReason: 'tool_use' as const,
            toolCalls: [{ id: 'call_1', name: 'get_weather', input: { location: 'NYC' } }],
          })
          .mockResolvedValueOnce({
            text: 'The weather in NYC is 72F and sunny.',
            usage: { inputTokens: 15, outputTokens: 25 },
            finishReason: 'stop' as const,
            toolCalls: [],
          }),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const tools: ToolDefinition[] = [
      {
        name: 'get_weather',
        description: 'Get weather for a location',
        inputSchema: { type: 'object' },
        execute: toolExecute,
      },
    ]

    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: "What's the weather in NYC?",
      tools,
    })

    expect(toolExecute).toHaveBeenCalledWith({ location: 'NYC' })
    expect(result.success).toBe(true)
    expect(result.result).toContain('72F')
  })

  it('supports parallel tool execution', async () => {
    const weatherExecute = vi.fn(async () => ({ temp: 72 }))
    const timeExecute = vi.fn(async () => ({ time: '3:00 PM' }))

    context = createMockContext({
      aiService: createMockAIService({
        generateWithTools: vi
          .fn()
          .mockResolvedValueOnce({
            text: '',
            usage: { inputTokens: 10, outputTokens: 20 },
            finishReason: 'tool_use' as const,
            toolCalls: [
              { id: 'call_1', name: 'get_weather', input: {} },
              { id: 'call_2', name: 'get_time', input: {} },
            ],
          })
          .mockResolvedValueOnce({
            text: 'Weather is 72F and time is 3:00 PM',
            usage: { inputTokens: 15, outputTokens: 25 },
            finishReason: 'stop' as const,
            toolCalls: [],
          }),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const tools: ToolDefinition[] = [
      {
        name: 'get_weather',
        description: 'Get weather',
        inputSchema: { type: 'object' },
        execute: weatherExecute,
      },
      {
        name: 'get_time',
        description: 'Get time',
        inputSchema: { type: 'object' },
        execute: timeExecute,
      },
    ]

    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Weather and time?',
      tools,
      parallelToolCalls: true,
    })

    expect(weatherExecute).toHaveBeenCalled()
    expect(timeExecute).toHaveBeenCalled()
  })

  it('enforces maxToolIterations limit', async () => {
    context = createMockContext({
      aiService: createMockAIService({
        generateWithTools: vi.fn(async () => ({
          text: '',
          usage: { inputTokens: 10, outputTokens: 20 },
          finishReason: 'tool_use' as const,
          toolCalls: [{ id: 'call', name: 'loop_tool', input: {} }],
        })),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const tools: ToolDefinition[] = [
      {
        name: 'loop_tool',
        description: 'Loops forever',
        inputSchema: { type: 'object' },
        execute: async () => ({ result: 'loop' }),
      },
    ]

    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      tools,
      maxToolIterations: 3,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeInstanceOf(GenerativeToolError)
    expect(result.error?.message).toContain('Max tool iterations')
    expect(context.aiService.generateWithTools).toHaveBeenCalledTimes(3)
  })

  it('handles tool execution errors gracefully', async () => {
    const failingTool = vi.fn(async () => {
      throw new Error('Tool failed!')
    })

    context = createMockContext({
      aiService: createMockAIService({
        generateWithTools: vi
          .fn()
          .mockResolvedValueOnce({
            text: '',
            usage: { inputTokens: 10, outputTokens: 20 },
            finishReason: 'tool_use' as const,
            toolCalls: [{ id: 'call_1', name: 'failing_tool', input: {} }],
          })
          .mockResolvedValueOnce({
            text: 'Tool error occurred, continuing...',
            usage: { inputTokens: 15, outputTokens: 25 },
            finishReason: 'stop' as const,
            toolCalls: [],
          }),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const tools: ToolDefinition[] = [
      {
        name: 'failing_tool',
        description: 'Fails',
        inputSchema: { type: 'object' },
        execute: failingTool,
      },
    ]

    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      tools,
    })

    expect(result.success).toBe(true)
    expect(context.onEvent).toHaveBeenCalledWith(
      'generation.tool.error',
      expect.objectContaining({ error: 'Tool failed!' })
    )
  })

  it('validates tool definitions', async () => {
    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      tools: [
        {
          name: '', // Invalid empty name
          description: 'Test tool',
          inputSchema: { type: 'object' },
        },
      ],
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeInstanceOf(GenerativeValidationError)
    expect(result.error?.message).toContain('name')
  })

  it('emits tool events', async () => {
    const toolExecute = vi.fn(async () => ({ result: 'done' }))

    context = createMockContext({
      aiService: createMockAIService({
        generateWithTools: vi
          .fn()
          .mockResolvedValueOnce({
            text: '',
            usage: { inputTokens: 10, outputTokens: 20 },
            finishReason: 'tool_use' as const,
            toolCalls: [{ id: 'call_1', name: 'test_tool', input: { x: 1 } }],
          })
          .mockResolvedValueOnce({
            text: 'Done',
            usage: { inputTokens: 15, outputTokens: 25 },
            finishReason: 'stop' as const,
            toolCalls: [],
          }),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      tools: [
        {
          name: 'test_tool',
          description: 'Test',
          inputSchema: { type: 'object' },
          execute: toolExecute,
        },
      ],
    })

    expect(context.onEvent).toHaveBeenCalledWith(
      'generation.tool.called',
      expect.objectContaining({ toolName: 'test_tool', input: { x: 1 } })
    )
    expect(context.onEvent).toHaveBeenCalledWith(
      'generation.tool.completed',
      expect.objectContaining({ toolName: 'test_tool' })
    )
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('GenerativeFunctionExecutor - Error Handling', () => {
  let executor: GenerativeFunctionExecutor
  let context: GenerativeExecutionContext

  beforeEach(() => {
    context = createMockContext()
    executor = new GenerativeFunctionExecutor(context)
  })

  it('handles rate limit errors', async () => {
    context = createMockContext({
      aiService: createMockAIService({
        generate: vi.fn(async () => {
          const err = new Error('Rate limit exceeded') as Error & {
            code: string
            retryAfter: number
          }
          err.code = 'rate_limit_exceeded'
          err.retryAfter = 30
          throw err
        }),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeInstanceOf(GenerativeRateLimitError)
    expect((result.error as GenerativeRateLimitError).retryAfter).toBe(30)
  })

  it('retries on rate limit when retryOnRateLimit is true', async () => {
    let callCount = 0
    context = createMockContext({
      aiService: createMockAIService({
        generate: vi.fn(async () => {
          callCount++
          if (callCount === 1) {
            const err = new Error('Rate limit') as Error & { code: string }
            err.code = 'rate_limit_exceeded'
            throw err
          }
          return {
            text: 'Success after retry',
            usage: { inputTokens: 10, outputTokens: 20 },
            finishReason: 'stop' as const,
          }
        }),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      retryOnRateLimit: true,
      maxRetries: 3,
      retryDelay: 10,
    })

    expect(result.success).toBe(true)
    expect(result.result).toBe('Success after retry')
    expect(callCount).toBe(2)
  })

  it('handles timeout errors', async () => {
    context = createMockContext({
      aiService: createMockAIService({
        generate: vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 200))
          return {
            text: 'Too late',
            usage: { inputTokens: 10, outputTokens: 20 },
            finishReason: 'stop' as const,
          }
        }),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      timeout: 50,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeInstanceOf(GenerativeTimeoutError)
  })

  it('retries on timeout when retryOnTimeout is true', async () => {
    let callCount = 0
    context = createMockContext({
      aiService: createMockAIService({
        generate: vi.fn(async () => {
          callCount++
          if (callCount === 1) {
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
          return {
            text: 'Success',
            usage: { inputTokens: 10, outputTokens: 20 },
            finishReason: 'stop' as const,
          }
        }),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      timeout: 50,
      retryOnTimeout: true,
      maxRetries: 3,
      retryDelay: 10,
    })

    expect(result.success).toBe(true)
    expect(callCount).toBe(2)
  })

  it('uses exponential backoff on retries', async () => {
    const callTimes: number[] = []
    context = createMockContext({
      aiService: createMockAIService({
        generate: vi.fn(async () => {
          callTimes.push(Date.now())
          if (callTimes.length < 3) {
            throw new Error('Transient error')
          }
          return {
            text: 'Success',
            usage: { inputTokens: 10, outputTokens: 20 },
            finishReason: 'stop' as const,
          }
        }),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      maxRetries: 4,
      retryDelay: 50,
      retryBackoff: 'exponential',
    })

    // Second delay should be ~2x first delay
    const delay1 = callTimes[1] - callTimes[0]
    const delay2 = callTimes[2] - callTimes[1]

    expect(delay2).toBeGreaterThan(delay1 * 1.5) // Allow some tolerance
  })

  it('uses linear backoff when specified', async () => {
    const callTimes: number[] = []
    context = createMockContext({
      aiService: createMockAIService({
        generate: vi.fn(async () => {
          callTimes.push(Date.now())
          if (callTimes.length < 3) {
            throw new Error('Transient error')
          }
          return {
            text: 'Success',
            usage: { inputTokens: 10, outputTokens: 20 },
            finishReason: 'stop' as const,
          }
        }),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      maxRetries: 4,
      retryDelay: 50,
      retryBackoff: 'linear',
    })

    // Both delays should be similar (linear = fixed)
    const delay1 = callTimes[1] - callTimes[0]
    const delay2 = callTimes[2] - callTimes[1]

    // Linear delay increases by retryDelay each time: first=1*50, second=2*50
    expect(delay2).toBeGreaterThan(delay1)
    expect(delay2).toBeLessThan(delay1 * 3) // Should be roughly 2x
  })

  it('does not retry non-retryable errors', async () => {
    let callCount = 0
    context = createMockContext({
      aiService: createMockAIService({
        generate: vi.fn(async () => {
          callCount++
          const err = new Error('Invalid API key') as Error & { code: string }
          err.code = 'authentication_error'
          throw err
        }),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      maxRetries: 3,
    })

    expect(result.success).toBe(false)
    expect(callCount).toBe(1) // No retries
  })

  it('emits retry events', async () => {
    let callCount = 0
    context = createMockContext({
      aiService: createMockAIService({
        generate: vi.fn(async () => {
          callCount++
          if (callCount === 1) {
            throw new Error('Transient error')
          }
          return {
            text: 'Success',
            usage: { inputTokens: 10, outputTokens: 20 },
            finishReason: 'stop' as const,
          }
        }),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      maxRetries: 3,
      retryDelay: 10,
    })

    expect(context.onEvent).toHaveBeenCalledWith(
      'generation.retry',
      expect.objectContaining({ attempt: 1 })
    )
  })

  it('emits error events', async () => {
    context = createMockContext({
      aiService: createMockAIService({
        generate: vi.fn(async () => {
          throw new Error('Generation failed')
        }),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
    })

    expect(context.onEvent).toHaveBeenCalledWith(
      'generation.error',
      expect.objectContaining({ error: 'Generation failed' })
    )
  })

  it('requires model to be specified', async () => {
    const result = await executor.execute({
      model: '',
      prompt: 'Test',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeInstanceOf(GenerativeValidationError)
    expect(result.error?.message).toContain('model')
  })

  it('requires prompt or messages', async () => {
    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeInstanceOf(GenerativeValidationError)
    expect(result.error?.message).toContain('prompt')
  })

  it('handles content filter responses', async () => {
    context = createMockContext({
      aiService: createMockAIService({
        generate: vi.fn(async () => ({
          text: '[Content filtered]',
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: 'content_filter' as const,
          contentFiltered: true,
        })),
      }),
    })
    executor = new GenerativeFunctionExecutor(context)

    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
    })

    expect(result.success).toBe(true)
    expect(result.finishReason).toBe('content_filter')
    expect(context.onEvent).toHaveBeenCalledWith(
      'generation.content_filtered',
      expect.any(Object)
    )
  })
})

// ============================================================================
// Validation Error Tests
// ============================================================================

describe('GenerativeFunctionExecutor - Validation Errors', () => {
  let executor: GenerativeFunctionExecutor
  let context: GenerativeExecutionContext

  beforeEach(() => {
    context = createMockContext()
    executor = new GenerativeFunctionExecutor(context)
  })

  it('returns validation error for negative temperature', async () => {
    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      temperature: -0.5,
    })

    expect(result.success).toBe(false)
    expect(result.error?.name).toBe('GenerativeValidationError')
  })

  it('returns validation error for invalid schema type', async () => {
    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      schema: {
        type: 'invalid_type',
      },
    })

    expect(result.success).toBe(false)
    expect(result.error?.name).toBe('GenerativeValidationError')
    expect(result.error?.message).toContain('schema type')
  })

  it('returns validation error for topK < 0', async () => {
    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      topK: -1,
    })

    expect(result.success).toBe(false)
    expect(result.error?.name).toBe('GenerativeValidationError')
    expect(result.error?.message).toContain('topK')
  })

  it('returns validation error for frequencyPenalty out of range', async () => {
    const result = await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      frequencyPenalty: -3,
    })

    expect(result.success).toBe(false)
    expect(result.error?.name).toBe('GenerativeValidationError')
    expect(result.error?.message).toContain('frequencyPenalty')
  })

  it('emits warning for maxTokens exceeding model limit', async () => {
    await executor.execute({
      model: 'claude-sonnet-4-20250514',
      prompt: 'Test',
      maxTokens: 999999,
    })

    expect(context.onEvent).toHaveBeenCalledWith(
      'generation.warning',
      expect.objectContaining({
        message: expect.stringContaining('exceeds model limit'),
      })
    )
  })
})

// ============================================================================
// Error Type Exports Tests
// ============================================================================

describe('GenerativeFunctionExecutor - Error Types', () => {
  it('exports GenerativeModelError', () => {
    const error = new GenerativeModelError('Model error', 'model_error')
    expect(error.name).toBe('GenerativeModelError')
    expect(error.message).toBe('Model error')
    expect(error.code).toBe('model_error')
  })

  it('exports GenerativeValidationError', () => {
    const error = new GenerativeValidationError('Validation failed')
    expect(error.name).toBe('GenerativeValidationError')
    expect(error.message).toBe('Validation failed')
  })

  it('exports GenerativeRateLimitError', () => {
    const error = new GenerativeRateLimitError('Rate limited', 60)
    expect(error.name).toBe('GenerativeRateLimitError')
    expect(error.code).toBe('rate_limit_exceeded')
    expect(error.retryAfter).toBe(60)
  })

  it('exports GenerativeTimeoutError', () => {
    const error = new GenerativeTimeoutError()
    expect(error.name).toBe('GenerativeTimeoutError')
    expect(error.message).toBe('Generation timed out')
  })

  it('exports GenerativeAbortError', () => {
    const error = new GenerativeAbortError()
    expect(error.name).toBe('GenerativeAbortError')
    expect(error.message).toBe('Generation was aborted')
  })

  it('exports GenerativeSchemaError', () => {
    const error = new GenerativeSchemaError('Schema mismatch', ['field1', 'field2'])
    expect(error.name).toBe('GenerativeSchemaError')
    expect(error.validationErrors).toEqual(['field1', 'field2'])
  })

  it('exports GenerativeToolError', () => {
    const error = new GenerativeToolError('Tool failed', 'my_tool')
    expect(error.name).toBe('GenerativeToolError')
    expect(error.toolName).toBe('my_tool')
  })
})
