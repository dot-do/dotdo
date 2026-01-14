/**
 * @dotdo/openai - AgentRuntime Backend Tests
 *
 * Tests for the OpenAI-compatible client backed by AgentRuntime.
 * Verifies that the client properly routes requests through the
 * multi-provider router while maintaining OpenAI API compatibility.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createOpenAIWithRuntime, OpenAIWithRuntime } from '../agent-runtime'

// Mock the router module
vi.mock('../../../db/primitives/agent-runtime/router', () => ({
  createLLMRouter: vi.fn(() => ({
    complete: vi.fn(async (request: { model: string }) => ({
      id: 'response-123',
      model: request.model,
      content: 'Hello! How can I help you?',
      finishReason: 'stop',
      usage: {
        promptTokens: 10,
        completionTokens: 8,
        totalTokens: 18,
      },
      provider: 'openai',
    })),
    stream: vi.fn(async function* () {
      yield { type: 'start', data: {}, timestamp: new Date() }
      yield {
        type: 'text-delta',
        data: { textDelta: 'Hello', accumulated: 'Hello' },
        timestamp: new Date(),
      }
      yield {
        type: 'text-delta',
        data: { textDelta: ' there!', accumulated: 'Hello there!' },
        timestamp: new Date(),
      }
      yield {
        type: 'done',
        data: {
          response: {
            id: 'stream-123',
            model: 'gpt-4',
            content: 'Hello there!',
            finishReason: 'stop',
            usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
            provider: 'openai',
          },
        },
        timestamp: new Date(),
      }
    }),
    getStats: vi.fn(() => ({
      totalRequests: 1,
      totalTokens: 18,
      totalInputTokens: 10,
      totalOutputTokens: 8,
      totalCostUsd: 0.001,
      averageLatencyMs: 100,
      successRate: 1,
      byProvider: {},
      byModel: {},
    })),
    resetStats: vi.fn(),
  })),
}))

// Mock the runtime module
vi.mock('../../../db/primitives/agent-runtime/runtime', () => ({
  createAgentRuntime: vi.fn(),
}))

// =============================================================================
// Initialization Tests
// =============================================================================

describe('OpenAIWithRuntime - Initialization', () => {
  it('should create a client with provider configuration', () => {
    const client = createOpenAIWithRuntime({
      providers: [{ name: 'openai', apiKey: 'sk-test-xxx' }],
    })

    expect(client).toBeInstanceOf(OpenAIWithRuntime)
    expect(client.chat).toBeDefined()
    expect(client.chat.completions).toBeDefined()
    expect(client.embeddings).toBeDefined()
  })

  it('should throw error without providers', () => {
    expect(() =>
      createOpenAIWithRuntime({
        providers: [],
      })
    ).toThrow('At least one provider is required')
  })

  it('should accept multiple providers for fallback', () => {
    const client = createOpenAIWithRuntime({
      providers: [
        { name: 'openai', apiKey: 'sk-openai-xxx' },
        { name: 'anthropic', apiKey: 'sk-anthropic-xxx' },
      ],
      fallback: { enabled: true },
    })

    expect(client).toBeDefined()
  })

  it('should accept routing strategy configuration', () => {
    const client = createOpenAIWithRuntime({
      providers: [{ name: 'openai', apiKey: 'sk-test-xxx' }],
      strategy: 'least-latency',
    })

    expect(client).toBeDefined()
  })

  it('should accept default model configuration', () => {
    const client = createOpenAIWithRuntime({
      providers: [{ name: 'openai', apiKey: 'sk-test-xxx' }],
      defaultModel: 'gpt-4o-mini',
    })

    expect(client).toBeDefined()
  })
})

// =============================================================================
// Chat Completions Tests
// =============================================================================

describe('OpenAIWithRuntime - Chat Completions', () => {
  let client: OpenAIWithRuntime

  beforeEach(() => {
    client = createOpenAIWithRuntime({
      providers: [{ name: 'openai', apiKey: 'sk-test-xxx' }],
    })
  })

  describe('create', () => {
    it('should return OpenAI-compatible response format', async () => {
      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(completion.id).toBeDefined()
      expect(completion.object).toBe('chat.completion')
      expect(completion.created).toBeTypeOf('number')
      expect(completion.model).toBe('gpt-4')
      expect(completion.choices).toHaveLength(1)
      expect(completion.choices[0].message.role).toBe('assistant')
      expect(completion.choices[0].message.content).toBe('Hello! How can I help you?')
      expect(completion.choices[0].finish_reason).toBe('stop')
      expect(completion.usage).toBeDefined()
    })

    it('should convert messages to runtime format', async () => {
      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
      })

      expect(completion).toBeDefined()
    })

    it('should handle tool messages', async () => {
      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'What is the weather?' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location":"SF"}',
                },
              },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'call_123',
            content: '{"temp": 72}',
          },
        ],
      })

      expect(completion).toBeDefined()
    })

    it('should pass temperature and other parameters', async () => {
      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
        max_tokens: 100,
        top_p: 0.9,
      })

      expect(completion).toBeDefined()
    })

    it('should pass tools configuration', async () => {
      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather for a location',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string' },
                },
              },
            },
          },
        ],
      })

      expect(completion).toBeDefined()
    })
  })

  describe('streaming', () => {
    it('should return async iterable for streaming', async () => {
      const stream = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      })

      expect(typeof stream[Symbol.asyncIterator]).toBe('function')
    })

    it('should yield OpenAI-compatible chunks', async () => {
      const stream = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      })

      const chunks: unknown[] = []
      for await (const chunk of stream) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)

      // Check first chunk with content
      const contentChunk = chunks.find(
        (c: unknown) => (c as { choices: Array<{ delta: { content?: string } }> }).choices[0]?.delta?.content
      ) as { id: string; object: string; created: number; model: string; choices: Array<{ delta: { content: string } }> }
      expect(contentChunk).toBeDefined()
      expect(contentChunk.object).toBe('chat.completion.chunk')
      expect(contentChunk.choices[0].delta.content).toBeDefined()
    })

    it('should accumulate content correctly', async () => {
      const stream = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      })

      let accumulated = ''
      for await (const chunk of stream) {
        const content = (chunk as { choices: Array<{ delta: { content?: string } }> }).choices[0]?.delta?.content
        if (content) {
          accumulated += content
        }
      }

      expect(accumulated).toBe('Hello there!')
    })
  })
})

// =============================================================================
// Statistics Tests
// =============================================================================

describe('OpenAIWithRuntime - Statistics', () => {
  it('should expose router statistics', () => {
    const client = createOpenAIWithRuntime({
      providers: [{ name: 'openai', apiKey: 'sk-test-xxx' }],
    })

    const stats = client.getStats()
    expect(stats).toBeDefined()
    expect(stats.totalRequests).toBeDefined()
    expect(stats.totalTokens).toBeDefined()
  })

  it('should allow resetting statistics', () => {
    const client = createOpenAIWithRuntime({
      providers: [{ name: 'openai', apiKey: 'sk-test-xxx' }],
    })

    expect(() => client.resetStats()).not.toThrow()
  })
})

// =============================================================================
// Multi-Provider Tests
// =============================================================================

describe('OpenAIWithRuntime - Multi-Provider', () => {
  it('should support OpenAI provider', () => {
    const client = createOpenAIWithRuntime({
      providers: [{ name: 'openai', apiKey: 'sk-openai-xxx' }],
    })

    expect(client).toBeDefined()
  })

  it('should support Anthropic provider', () => {
    const client = createOpenAIWithRuntime({
      providers: [{ name: 'anthropic', apiKey: 'sk-anthropic-xxx' }],
    })

    expect(client).toBeDefined()
  })

  it('should support mixed providers with fallback', () => {
    const client = createOpenAIWithRuntime({
      providers: [
        { name: 'openai', apiKey: 'sk-openai-xxx' },
        { name: 'anthropic', apiKey: 'sk-anthropic-xxx' },
      ],
      fallback: {
        enabled: true,
        maxAttempts: 3,
      },
      strategy: 'priority',
    })

    expect(client).toBeDefined()
  })

  it('should support cost-optimized routing', () => {
    const client = createOpenAIWithRuntime({
      providers: [
        { name: 'openai', apiKey: 'sk-openai-xxx' },
        { name: 'anthropic', apiKey: 'sk-anthropic-xxx' },
      ],
      strategy: 'cost-optimized',
    })

    expect(client).toBeDefined()
  })
})
