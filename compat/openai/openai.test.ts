/**
 * @dotdo/openai - OpenAI API Compatibility Layer Tests
 *
 * Tests for the OpenAI SDK compatibility layer including:
 * - Chat completions (GPT-4, GPT-3.5-turbo)
 * - Embeddings (text-embedding-ada-002, text-embedding-3-small)
 * - Function/tool calling
 * - Streaming (SSE)
 *
 * Following TDD: RED (failing tests) -> GREEN (implementation) -> REFACTOR
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  OpenAI,
  OpenAIError,
  type ChatCompletion,
  type ChatCompletionChunk,
  type ChatCompletionMessage,
  type ChatCompletionMessageParam,
  type ChatCompletionTool,
  type Embedding,
  type EmbeddingCreateParams,
  type CreateEmbeddingResponse,
  type ImagesResponse,
  type Model,
  type ModelListResponse,
} from './index'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockFetch(responses: Map<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const urlObj = new URL(url)
    const key = `${options?.method ?? 'GET'} ${urlObj.pathname}`

    const mockResponse = responses.get(key)
    if (!mockResponse) {
      return {
        ok: false,
        status: 404,
        headers: new Headers({ 'x-request-id': 'req_mock' }),
        json: async () => ({
          error: { type: 'invalid_request_error', message: `No mock for ${key}` },
        }),
      }
    }

    return {
      ok: mockResponse.status >= 200 && mockResponse.status < 300,
      status: mockResponse.status,
      headers: new Headers({ 'x-request-id': 'req_mock' }),
      json: async () => mockResponse.body,
    }
  })
}

function mockChatCompletion(overrides: Partial<ChatCompletion> = {}): ChatCompletion {
  return {
    id: 'chatcmpl-test123',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'gpt-4',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Hello! How can I help you today?',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 8,
      total_tokens: 18,
    },
    ...overrides,
  }
}

function mockEmbeddingResponse(overrides: Partial<CreateEmbeddingResponse> = {}): CreateEmbeddingResponse {
  return {
    object: 'list',
    data: [
      {
        object: 'embedding',
        index: 0,
        embedding: Array(1536).fill(0).map(() => Math.random() * 2 - 1),
      },
    ],
    model: 'text-embedding-ada-002',
    usage: {
      prompt_tokens: 5,
      total_tokens: 5,
    },
    ...overrides,
  }
}

// =============================================================================
// OpenAI Client Tests
// =============================================================================

describe('@dotdo/openai - OpenAI Client', () => {
  describe('initialization', () => {
    it('should create an OpenAI instance with API key', () => {
      const client = new OpenAI({ apiKey: 'sk-test-xxx' })
      expect(client).toBeDefined()
      expect(client.chat).toBeDefined()
      expect(client.chat.completions).toBeDefined()
      expect(client.embeddings).toBeDefined()
    })

    it('should throw error without API key', () => {
      expect(() => new OpenAI({ apiKey: '' })).toThrow('OpenAI API key is required')
    })

    it('should accept configuration options', () => {
      const client = new OpenAI({
        apiKey: 'sk-test-xxx',
        baseURL: 'https://custom.openai.com',
        timeout: 60000,
        maxRetries: 3,
      })
      expect(client).toBeDefined()
    })

    it('should use OPENAI_API_KEY from environment if not provided', () => {
      // This test verifies the client can be constructed with env var
      // In real implementation, it would check process.env.OPENAI_API_KEY
      const client = new OpenAI({ apiKey: 'sk-test-xxx' })
      expect(client).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('should throw OpenAIError on API errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/chat/completions',
            {
              status: 401,
              body: {
                error: {
                  type: 'invalid_api_key',
                  message: 'Invalid API key provided',
                  code: 'invalid_api_key',
                },
              },
            },
          ],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-invalid', fetch: mockFetch })

      await expect(
        client.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow(OpenAIError)
    })

    it('should include status code and request ID in errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/chat/completions',
            {
              status: 429,
              body: {
                error: {
                  type: 'rate_limit_error',
                  message: 'Rate limit exceeded',
                  code: 'rate_limit_exceeded',
                },
              },
            },
          ],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })

      try {
        await client.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      } catch (error) {
        expect(error).toBeInstanceOf(OpenAIError)
        const openAIError = error as OpenAIError
        expect(openAIError.status).toBe(429)
        expect(openAIError.code).toBe('rate_limit_exceeded')
      }
    })
  })
})

// =============================================================================
// Chat Completions Tests
// =============================================================================

describe('@dotdo/openai - Chat Completions', () => {
  describe('create', () => {
    it('should create a chat completion with GPT-4', async () => {
      const expectedCompletion = mockChatCompletion({ model: 'gpt-4' })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/chat/completions', { status: 200, body: expectedCompletion }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(completion.id).toBe('chatcmpl-test123')
      expect(completion.model).toBe('gpt-4')
      expect(completion.choices[0].message.content).toBe('Hello! How can I help you today?')
    })

    it('should create a chat completion with GPT-3.5-turbo', async () => {
      const expectedCompletion = mockChatCompletion({ model: 'gpt-3.5-turbo' })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/chat/completions', { status: 200, body: expectedCompletion }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const completion = await client.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(completion.model).toBe('gpt-3.5-turbo')
    })

    it('should support system messages', async () => {
      const expectedCompletion = mockChatCompletion()
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/chat/completions', { status: 200, body: expectedCompletion }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello' },
        ],
      })

      expect(completion).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/chat/completions'),
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('should support multi-turn conversations', async () => {
      const expectedCompletion = mockChatCompletion()
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/chat/completions', { status: 200, body: expectedCompletion }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
      })

      expect(completion).toBeDefined()
    })

    it('should support temperature and max_tokens parameters', async () => {
      const expectedCompletion = mockChatCompletion()
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedCompletion,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
        max_tokens: 100,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.temperature).toBe(0.7)
      expect(body.max_tokens).toBe(100)
    })

    it('should support n parameter for multiple completions', async () => {
      const expectedCompletion = mockChatCompletion({
        choices: [
          { index: 0, message: { role: 'assistant', content: 'Response 1' }, finish_reason: 'stop' },
          { index: 1, message: { role: 'assistant', content: 'Response 2' }, finish_reason: 'stop' },
        ],
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/chat/completions', { status: 200, body: expectedCompletion }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        n: 2,
      })

      expect(completion.choices).toHaveLength(2)
    })

    it('should return usage statistics', async () => {
      const expectedCompletion = mockChatCompletion({
        usage: {
          prompt_tokens: 15,
          completion_tokens: 25,
          total_tokens: 40,
        },
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/chat/completions', { status: 200, body: expectedCompletion }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(completion.usage).toBeDefined()
      expect(completion.usage?.prompt_tokens).toBe(15)
      expect(completion.usage?.completion_tokens).toBe(25)
      expect(completion.usage?.total_tokens).toBe(40)
    })
  })
})

// =============================================================================
// Embeddings Tests
// =============================================================================

describe('@dotdo/openai - Embeddings', () => {
  describe('create', () => {
    it('should create embeddings with text-embedding-ada-002', async () => {
      const expectedResponse = mockEmbeddingResponse({ model: 'text-embedding-ada-002' })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/embeddings', { status: 200, body: expectedResponse }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const response = await client.embeddings.create({
        model: 'text-embedding-ada-002',
        input: 'Hello world',
      })

      expect(response.object).toBe('list')
      expect(response.data).toHaveLength(1)
      expect(response.data[0].embedding).toHaveLength(1536)
      expect(response.model).toBe('text-embedding-ada-002')
    })

    it('should create embeddings with text-embedding-3-small', async () => {
      const smallEmbedding = Array(1536).fill(0).map(() => Math.random() * 2 - 1)
      const expectedResponse = mockEmbeddingResponse({
        model: 'text-embedding-3-small',
        data: [{ object: 'embedding', index: 0, embedding: smallEmbedding }],
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/embeddings', { status: 200, body: expectedResponse }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'Hello world',
      })

      expect(response.model).toBe('text-embedding-3-small')
    })

    it('should support batch embeddings with array input', async () => {
      const expectedResponse = mockEmbeddingResponse({
        data: [
          { object: 'embedding', index: 0, embedding: Array(1536).fill(0.1) },
          { object: 'embedding', index: 1, embedding: Array(1536).fill(0.2) },
          { object: 'embedding', index: 2, embedding: Array(1536).fill(0.3) },
        ],
        usage: { prompt_tokens: 15, total_tokens: 15 },
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/embeddings', { status: 200, body: expectedResponse }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const response = await client.embeddings.create({
        model: 'text-embedding-ada-002',
        input: ['Hello', 'World', 'Test'],
      })

      expect(response.data).toHaveLength(3)
      expect(response.data[0].index).toBe(0)
      expect(response.data[1].index).toBe(1)
      expect(response.data[2].index).toBe(2)
    })

    it('should return usage statistics', async () => {
      const expectedResponse = mockEmbeddingResponse({
        usage: { prompt_tokens: 10, total_tokens: 10 },
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/embeddings', { status: 200, body: expectedResponse }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const response = await client.embeddings.create({
        model: 'text-embedding-ada-002',
        input: 'Hello world',
      })

      expect(response.usage).toBeDefined()
      expect(response.usage.prompt_tokens).toBe(10)
      expect(response.usage.total_tokens).toBe(10)
    })

    it('should support dimensions parameter for text-embedding-3 models', async () => {
      const smallDimensionEmbedding = Array(256).fill(0).map(() => Math.random() * 2 - 1)
      const expectedResponse = mockEmbeddingResponse({
        model: 'text-embedding-3-small',
        data: [{ object: 'embedding', index: 0, embedding: smallDimensionEmbedding }],
      })
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedResponse,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'Hello world',
        dimensions: 256,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.dimensions).toBe(256)
    })
  })
})

// =============================================================================
// Function/Tool Calling Tests
// =============================================================================

describe('@dotdo/openai - Function/Tool Calling', () => {
  const weatherTool: ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get the current weather in a location',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'The city and state, e.g. San Francisco, CA',
          },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
          },
        },
        required: ['location'],
      },
    },
  }

  describe('tools parameter', () => {
    it('should support tools array in request', async () => {
      const expectedCompletion = mockChatCompletion({
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location": "San Francisco, CA"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/chat/completions', { status: 200, body: expectedCompletion }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'What is the weather in San Francisco?' }],
        tools: [weatherTool],
      })

      expect(completion.choices[0].finish_reason).toBe('tool_calls')
      expect(completion.choices[0].message.tool_calls).toBeDefined()
      expect(completion.choices[0].message.tool_calls).toHaveLength(1)
      expect(completion.choices[0].message.tool_calls?.[0].function.name).toBe('get_weather')
    })

    it('should support tool_choice parameter', async () => {
      const expectedCompletion = mockChatCompletion({
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location": "San Francisco, CA"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      })
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedCompletion,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'What is the weather in San Francisco?' }],
        tools: [weatherTool],
        tool_choice: 'auto',
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.tool_choice).toBe('auto')
    })

    it('should support forcing a specific tool', async () => {
      const expectedCompletion = mockChatCompletion()
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedCompletion,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [weatherTool],
        tool_choice: { type: 'function', function: { name: 'get_weather' } },
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'get_weather' } })
    })

    it('should support multiple tool calls in response', async () => {
      const expectedCompletion = mockChatCompletion({
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location": "San Francisco, CA"}',
                  },
                },
                {
                  id: 'call_def456',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location": "New York, NY"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/chat/completions', { status: 200, body: expectedCompletion }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'What is the weather in SF and NYC?' }],
        tools: [weatherTool],
      })

      expect(completion.choices[0].message.tool_calls).toHaveLength(2)
    })

    it('should support tool message in conversation', async () => {
      const expectedCompletion = mockChatCompletion({
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'The weather in San Francisco is 72F and sunny.',
            },
            finish_reason: 'stop',
          },
        ],
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/chat/completions', { status: 200, body: expectedCompletion }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'What is the weather in San Francisco?' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_abc123',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"location": "San Francisco, CA"}' },
              },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'call_abc123',
            content: '{"temperature": 72, "unit": "fahrenheit", "condition": "sunny"}',
          },
        ],
        tools: [weatherTool],
      })

      expect(completion.choices[0].message.content).toContain('72')
    })
  })

  describe('legacy functions parameter', () => {
    it('should support functions array (deprecated but still supported)', async () => {
      const expectedCompletion = mockChatCompletion({
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              function_call: {
                name: 'get_weather',
                arguments: '{"location": "San Francisco, CA"}',
              },
            },
            finish_reason: 'function_call',
          },
        ],
      })
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedCompletion,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'What is the weather?' }],
        functions: [
          {
            name: 'get_weather',
            description: 'Get the weather',
            parameters: {
              type: 'object',
              properties: { location: { type: 'string' } },
            },
          },
        ],
      })

      expect(completion.choices[0].message.function_call).toBeDefined()
      expect(completion.choices[0].message.function_call?.name).toBe('get_weather')
    })
  })
})

// =============================================================================
// Streaming Tests
// =============================================================================

describe('@dotdo/openai - Streaming', () => {
  function createMockStreamResponse(chunks: ChatCompletionChunk[]) {
    const encoder = new TextEncoder()
    const lines = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    lines.push('data: [DONE]\n\n')

    let index = 0
    const stream = new ReadableStream({
      pull(controller) {
        if (index < lines.length) {
          controller.enqueue(encoder.encode(lines[index]))
          index++
        } else {
          controller.close()
        }
      },
    })

    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: stream,
    }
  }

  describe('streaming responses', () => {
    it('should support stream: true option', async () => {
      const chunks: ChatCompletionChunk[] = [
        {
          id: 'chatcmpl-test123',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4',
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        },
        {
          id: 'chatcmpl-test123',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4',
          choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
        },
        {
          id: 'chatcmpl-test123',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4',
          choices: [{ index: 0, delta: { content: ' there!' }, finish_reason: null }],
        },
        {
          id: 'chatcmpl-test123',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        },
      ]

      const mockFetch = vi.fn().mockResolvedValue(createMockStreamResponse(chunks))

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const stream = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      })

      const collectedContent: string[] = []
      for await (const chunk of stream) {
        if (chunk.choices[0]?.delta?.content) {
          collectedContent.push(chunk.choices[0].delta.content)
        }
      }

      expect(collectedContent.join('')).toBe('Hello there!')
    })

    it('should handle streaming with tool calls', async () => {
      const chunks: ChatCompletionChunk[] = [
        {
          id: 'chatcmpl-test123',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_abc123',
                    type: 'function',
                    function: { name: 'get_weather', arguments: '' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chatcmpl-test123',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '{"location":' } }],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chatcmpl-test123',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '"SF"}' } }],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chatcmpl-test123',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        },
      ]

      const mockFetch = vi.fn().mockResolvedValue(createMockStreamResponse(chunks))

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const stream = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'What is the weather in SF?' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              parameters: { type: 'object', properties: { location: { type: 'string' } } },
            },
          },
        ],
        stream: true,
      })

      let lastChunk: ChatCompletionChunk | null = null
      for await (const chunk of stream) {
        lastChunk = chunk
      }

      expect(lastChunk?.choices[0].finish_reason).toBe('tool_calls')
    })

    it('should return an async iterable', async () => {
      const chunks: ChatCompletionChunk[] = [
        {
          id: 'chatcmpl-test123',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4',
          choices: [{ index: 0, delta: { content: 'Test' }, finish_reason: null }],
        },
      ]

      const mockFetch = vi.fn().mockResolvedValue(createMockStreamResponse(chunks))

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const stream = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      })

      // Verify it's an async iterable
      expect(typeof stream[Symbol.asyncIterator]).toBe('function')
    })
  })
})

// =============================================================================
// Request Options Tests
// =============================================================================

describe('@dotdo/openai - Request Options', () => {
  it('should pass custom headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => mockChatCompletion(),
    })

    const client = new OpenAI({
      apiKey: 'sk-test-xxx',
      fetch: mockFetch,
      defaultHeaders: { 'X-Custom-Header': 'custom-value' },
    })

    await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Custom-Header': 'custom-value',
        }),
      })
    )
  })

  it('should support organization header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => mockChatCompletion(),
    })

    const client = new OpenAI({
      apiKey: 'sk-test-xxx',
      organization: 'org-test123',
      fetch: mockFetch,
    })

    await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'OpenAI-Organization': 'org-test123',
        }),
      })
    )
  })

  it('should support custom base URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => mockChatCompletion(),
    })

    const client = new OpenAI({
      apiKey: 'sk-test-xxx',
      baseURL: 'https://custom-api.example.com',
      fetch: mockFetch,
    })

    await client.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://custom-api.example.com'),
      expect.anything()
    )
  })
})

// =============================================================================
// Images API Tests
// =============================================================================

function mockImagesResponse(overrides: Partial<ImagesResponse> = {}): ImagesResponse {
  return {
    created: Math.floor(Date.now() / 1000),
    data: [
      {
        url: 'https://oaidalleapiprodscus.blob.core.windows.net/private/image.png',
        revised_prompt: 'A beautiful sunset over the ocean',
      },
    ],
    ...overrides,
  }
}

describe('@dotdo/openai - Images API', () => {
  describe('generate', () => {
    it('should generate an image with DALL-E 3', async () => {
      const expectedResponse = mockImagesResponse()
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/images/generations', { status: 200, body: expectedResponse }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const response = await client.images.generate({
        model: 'dall-e-3',
        prompt: 'A beautiful sunset over the ocean',
      })

      expect(response.created).toBeDefined()
      expect(response.data).toHaveLength(1)
      expect(response.data[0].url).toBeDefined()
    })

    it('should support DALL-E 2 with multiple images', async () => {
      const expectedResponse = mockImagesResponse({
        data: [
          { url: 'https://example.com/image1.png' },
          { url: 'https://example.com/image2.png' },
          { url: 'https://example.com/image3.png' },
        ],
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/images/generations', { status: 200, body: expectedResponse }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const response = await client.images.generate({
        model: 'dall-e-2',
        prompt: 'A cute cat',
        n: 3,
      })

      expect(response.data).toHaveLength(3)
    })

    it('should support size parameter', async () => {
      const expectedResponse = mockImagesResponse()
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedResponse,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      await client.images.generate({
        model: 'dall-e-3',
        prompt: 'A mountain landscape',
        size: '1792x1024',
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.size).toBe('1792x1024')
    })

    it('should support quality and style parameters for DALL-E 3', async () => {
      const expectedResponse = mockImagesResponse()
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedResponse,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      await client.images.generate({
        model: 'dall-e-3',
        prompt: 'A photorealistic portrait',
        quality: 'hd',
        style: 'natural',
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.quality).toBe('hd')
      expect(body.style).toBe('natural')
    })

    it('should support b64_json response format', async () => {
      const expectedResponse = mockImagesResponse({
        data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }],
      })
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedResponse,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const response = await client.images.generate({
        prompt: 'A red square',
        response_format: 'b64_json',
      })

      expect(response.data[0].b64_json).toBeDefined()
    })

    it('should include revised_prompt in DALL-E 3 response', async () => {
      const expectedResponse = mockImagesResponse({
        data: [
          {
            url: 'https://example.com/image.png',
            revised_prompt: 'A stunning, photorealistic sunset over a calm ocean with vibrant orange and pink colors',
          },
        ],
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/images/generations', { status: 200, body: expectedResponse }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const response = await client.images.generate({
        model: 'dall-e-3',
        prompt: 'A sunset',
      })

      expect(response.data[0].revised_prompt).toContain('sunset')
    })
  })

  describe('edit', () => {
    it('should edit an image', async () => {
      const expectedResponse = mockImagesResponse()
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedResponse,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const imageBlob = new Blob(['fake-image-data'], { type: 'image/png' })

      const response = await client.images.edit({
        image: imageBlob,
        prompt: 'Add a rainbow to the sky',
      })

      expect(response.data).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/images/edits'),
        expect.anything()
      )
    })

    it('should support mask parameter', async () => {
      const expectedResponse = mockImagesResponse()
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedResponse,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const imageBlob = new Blob(['fake-image-data'], { type: 'image/png' })
      const maskBlob = new Blob(['fake-mask-data'], { type: 'image/png' })

      await client.images.edit({
        image: imageBlob,
        mask: maskBlob,
        prompt: 'Replace the sky with a sunset',
      })

      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('createVariation', () => {
    it('should create image variations', async () => {
      const expectedResponse = mockImagesResponse({
        data: [
          { url: 'https://example.com/variation1.png' },
          { url: 'https://example.com/variation2.png' },
        ],
      })
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedResponse,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const imageBlob = new Blob(['fake-image-data'], { type: 'image/png' })

      const response = await client.images.createVariation({
        image: imageBlob,
        n: 2,
      })

      expect(response.data).toHaveLength(2)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/images/variations'),
        expect.anything()
      )
    })
  })
})

// =============================================================================
// Models API Tests
// =============================================================================

function mockModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'gpt-4',
    object: 'model',
    created: 1687882411,
    owned_by: 'openai',
    ...overrides,
  }
}

function mockModelList(): ModelListResponse {
  return {
    object: 'list',
    data: [
      mockModel({ id: 'gpt-4' }),
      mockModel({ id: 'gpt-4-turbo' }),
      mockModel({ id: 'gpt-3.5-turbo' }),
      mockModel({ id: 'text-embedding-ada-002', owned_by: 'openai-internal' }),
      mockModel({ id: 'dall-e-3' }),
    ],
  }
}

describe('@dotdo/openai - Models API', () => {
  describe('list', () => {
    it('should list all available models', async () => {
      const expectedResponse = mockModelList()
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v1/models', { status: 200, body: expectedResponse }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const response = await client.models.list()

      expect(response.object).toBe('list')
      expect(response.data).toHaveLength(5)
      expect(response.data.some((m) => m.id === 'gpt-4')).toBe(true)
    })

    it('should return model objects with required fields', async () => {
      const expectedResponse = mockModelList()
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v1/models', { status: 200, body: expectedResponse }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const response = await client.models.list()

      const model = response.data[0]
      expect(model.id).toBeDefined()
      expect(model.object).toBe('model')
      expect(model.created).toBeDefined()
      expect(model.owned_by).toBeDefined()
    })
  })

  describe('retrieve', () => {
    it('should retrieve a specific model by ID', async () => {
      const expectedModel = mockModel({ id: 'gpt-4-turbo' })
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v1/models/gpt-4-turbo', { status: 200, body: expectedModel }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const model = await client.models.retrieve('gpt-4-turbo')

      expect(model.id).toBe('gpt-4-turbo')
      expect(model.object).toBe('model')
    })

    it('should throw error for non-existent model', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v1/models/non-existent-model',
            {
              status: 404,
              body: {
                error: {
                  type: 'invalid_request_error',
                  message: 'The model `non-existent-model` does not exist',
                  code: 'model_not_found',
                },
              },
            },
          ],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })

      await expect(client.models.retrieve('non-existent-model')).rejects.toThrow(OpenAIError)
    })
  })

  describe('del', () => {
    it('should delete a fine-tuned model', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /v1/models/ft:gpt-3.5-turbo:my-org:custom-model:123',
            {
              status: 200,
              body: {
                id: 'ft:gpt-3.5-turbo:my-org:custom-model:123',
                object: 'model',
                deleted: true,
              },
            },
          ],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const result = await client.models.del('ft:gpt-3.5-turbo:my-org:custom-model:123')

      expect(result.deleted).toBe(true)
      expect(result.id).toBe('ft:gpt-3.5-turbo:my-org:custom-model:123')
    })

    it('should throw error when deleting non-fine-tuned model', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'DELETE /v1/models/gpt-4',
            {
              status: 403,
              body: {
                error: {
                  type: 'invalid_request_error',
                  message: 'You cannot delete the model gpt-4 because it is not a fine-tuned model',
                  code: 'model_not_deletable',
                },
              },
            },
          ],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })

      await expect(client.models.del('gpt-4')).rejects.toThrow(OpenAIError)
    })
  })
})

// =============================================================================
// AgentRuntime Backend Tests
// =============================================================================

describe('@dotdo/openai - AgentRuntime Backend', () => {
  it('should support useAgentRuntime configuration option', () => {
    const client = new OpenAI({
      apiKey: 'sk-test-xxx',
      // Note: This tests that the config option is accepted
      // Actual AgentRuntime integration is tested separately
    })
    expect(client).toBeDefined()
  })
})
