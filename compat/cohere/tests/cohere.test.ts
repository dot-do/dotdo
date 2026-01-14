/**
 * @dotdo/cohere - Cohere Compatibility Layer Tests
 *
 * Tests for the Cohere API compatibility layer including:
 * - Generate API (text generation)
 * - Chat API (conversational AI)
 * - Embed API (text embeddings)
 * - Rerank API (relevance reranking)
 * - Classify API (text classification)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CohereClient,
  CohereError,
  type GenerateResponse,
  type ChatResponse,
  type EmbedResponse,
  type RerankResponse,
  type ClassifyResponse,
  type Generation,
  type ChatMessage,
  type ClassifyExample,
  type RerankResult,
} from '../index'

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
          message: `No mock for ${key}`,
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

function createMockStreamFetch(events: Array<{ event?: string; data: unknown }>) {
  return vi.fn(async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        for (const { event, data } of events) {
          let chunk = ''
          if (event) {
            chunk += `event: ${event}\n`
          }
          chunk += `data: ${JSON.stringify(data)}\n\n`
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    })

    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: stream,
    }
  })
}

// =============================================================================
// Cohere Client Tests
// =============================================================================

describe('@dotdo/cohere - Cohere Client', () => {
  describe('initialization', () => {
    it('should create a CohereClient instance with API token', () => {
      const client = new CohereClient({ token: 'test-api-key' })
      expect(client).toBeDefined()
    })

    it('should throw error without API token', () => {
      expect(() => new CohereClient({ token: '' })).toThrow('Cohere API token is required')
    })

    it('should accept configuration options', () => {
      const client = new CohereClient({
        token: 'test-api-key',
        timeout: 60000,
      })
      expect(client).toBeDefined()
    })

    it('should support custom base URL', () => {
      const client = new CohereClient({
        token: 'test-api-key',
        baseURL: 'https://custom.cohere.com',
      })
      expect(client).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('should throw CohereError on API errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/generate',
            {
              status: 400,
              body: {
                message: 'Invalid request: prompt cannot be empty',
              },
            },
          ],
        ])
      )

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })

      await expect(
        client.generate({
          prompt: '',
        })
      ).rejects.toThrow(CohereError)
    })

    it('should include status code in CohereError', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/generate',
            {
              status: 401,
              body: {
                message: 'Invalid API token',
              },
            },
          ],
        ])
      )

      const client = new CohereClient({ token: 'invalid-key', fetch: mockFetch })

      try {
        await client.generate({ prompt: 'Hello' })
      } catch (error) {
        expect(error).toBeInstanceOf(CohereError)
        const cohereError = error as CohereError
        expect(cohereError.statusCode).toBe(401)
        expect(cohereError.message).toBe('Invalid API token')
      }
    })

    it('should handle rate limit errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/generate',
            {
              status: 429,
              body: {
                message: 'Rate limit exceeded',
              },
            },
          ],
        ])
      )

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })

      await expect(
        client.generate({ prompt: 'Hello' })
      ).rejects.toThrow('Rate limit exceeded')
    })
  })
})

// =============================================================================
// Generate API Tests
// =============================================================================

describe('@dotdo/cohere - Generate API', () => {
  describe('basic generation', () => {
    it('should generate text with a prompt', async () => {
      const expectedResponse: GenerateResponse = {
        id: 'gen_123',
        prompt: 'Write a tagline for an ice cream shop',
        generations: [
          {
            id: 'gen_123_0',
            text: 'Where every scoop is a sweet adventure!',
            index: 0,
          },
        ],
        meta: {
          api_version: { version: '1' },
          billed_units: { input_tokens: 10, output_tokens: 8 },
        },
      }
      const mockFetch = createMockFetch(
        new Map([['POST /v1/generate', { status: 200, body: expectedResponse }]])
      )

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      const response = await client.generate({
        prompt: 'Write a tagline for an ice cream shop',
      })

      expect(response.id).toBe('gen_123')
      expect(response.generations).toHaveLength(1)
      expect(response.generations[0].text).toBe('Where every scoop is a sweet adventure!')
    })

    it('should include proper headers in request', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'gen_123',
          prompt: 'Hello',
          generations: [{ id: 'gen_123_0', text: 'World', index: 0 }],
        }),
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      await client.generate({ prompt: 'Hello' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
        })
      )
    })

    it('should support model parameter', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'gen_123',
          prompt: 'Hello',
          generations: [{ id: 'gen_123_0', text: 'World', index: 0 }],
        }),
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      await client.generate({
        prompt: 'Hello',
        model: 'command',
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.model).toBe('command')
    })

    it('should support maxTokens parameter', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'gen_123',
          prompt: 'Hello',
          generations: [{ id: 'gen_123_0', text: 'World', index: 0 }],
        }),
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      await client.generate({
        prompt: 'Hello',
        maxTokens: 50,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.max_tokens).toBe(50)
    })

    it('should support temperature parameter', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'gen_123',
          prompt: 'Hello',
          generations: [{ id: 'gen_123_0', text: 'World', index: 0 }],
        }),
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      await client.generate({
        prompt: 'Hello',
        temperature: 0.7,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.temperature).toBe(0.7)
    })

    it('should support numGenerations parameter', async () => {
      const expectedResponse: GenerateResponse = {
        id: 'gen_123',
        prompt: 'Hello',
        generations: [
          { id: 'gen_123_0', text: 'World 1', index: 0 },
          { id: 'gen_123_1', text: 'World 2', index: 1 },
          { id: 'gen_123_2', text: 'World 3', index: 2 },
        ],
      }
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedResponse,
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      const response = await client.generate({
        prompt: 'Hello',
        numGenerations: 3,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.num_generations).toBe(3)
      expect(response.generations).toHaveLength(3)
    })

    it('should support stopSequences parameter', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'gen_123',
          prompt: 'Hello',
          generations: [{ id: 'gen_123_0', text: 'World', index: 0 }],
        }),
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      await client.generate({
        prompt: 'Hello',
        stopSequences: ['###', '---'],
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.stop_sequences).toEqual(['###', '---'])
    })

    it('should support k and p parameters for sampling', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'gen_123',
          prompt: 'Hello',
          generations: [{ id: 'gen_123_0', text: 'World', index: 0 }],
        }),
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      await client.generate({
        prompt: 'Hello',
        k: 50,
        p: 0.9,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.k).toBe(50)
      expect(body.p).toBe(0.9)
    })

    it('should support frequencyPenalty and presencePenalty', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'gen_123',
          prompt: 'Hello',
          generations: [{ id: 'gen_123_0', text: 'World', index: 0 }],
        }),
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      await client.generate({
        prompt: 'Hello',
        frequencyPenalty: 0.5,
        presencePenalty: 0.3,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.frequency_penalty).toBe(0.5)
      expect(body.presence_penalty).toBe(0.3)
    })

    it('should return likelihoods when requested', async () => {
      const expectedResponse: GenerateResponse = {
        id: 'gen_123',
        prompt: 'Hello',
        generations: [
          {
            id: 'gen_123_0',
            text: 'World',
            index: 0,
            likelihood: -0.5,
            token_likelihoods: [
              { token: 'World', likelihood: -0.5 },
            ],
          },
        ],
      }
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedResponse,
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      const response = await client.generate({
        prompt: 'Hello',
        returnLikelihoods: 'GENERATION',
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.return_likelihoods).toBe('GENERATION')
      expect(response.generations[0].likelihood).toBe(-0.5)
    })
  })
})

// =============================================================================
// Chat API Tests
// =============================================================================

describe('@dotdo/cohere - Chat API', () => {
  describe('basic chat', () => {
    it('should send a chat message', async () => {
      const expectedResponse: ChatResponse = {
        id: 'chat_123',
        finish_reason: 'COMPLETE',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'The capital of France is Paris.' }],
        },
        usage: {
          billed_units: { input_tokens: 10, output_tokens: 8 },
          tokens: { input_tokens: 10, output_tokens: 8 },
        },
      }
      const mockFetch = createMockFetch(
        new Map([['POST /v2/chat', { status: 200, body: expectedResponse }]])
      )

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      const response = await client.chat({
        message: 'What is the capital of France?',
        model: 'command',
      })

      expect(response.id).toBe('chat_123')
      expect(response.finish_reason).toBe('COMPLETE')
      expect(response.message.role).toBe('assistant')
    })

    it('should support conversationId for memory', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'chat_123',
          finish_reason: 'COMPLETE',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] },
        }),
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      await client.chat({
        message: 'Hello',
        model: 'command',
        conversationId: 'conv_123',
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.conversation_id).toBe('conv_123')
    })

    it('should support chatHistory for context', async () => {
      const chatHistory: ChatMessage[] = [
        { role: 'USER', message: 'Hello' },
        { role: 'CHATBOT', message: 'Hi! How can I help?' },
      ]
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'chat_123',
          finish_reason: 'COMPLETE',
          message: { role: 'assistant', content: [{ type: 'text', text: 'I remember!' }] },
        }),
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      await client.chat({
        message: 'What did I say earlier?',
        model: 'command',
        chatHistory,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.messages).toBeDefined()
      expect(body.messages.length).toBeGreaterThan(0)
    })

    it('should support system prompt', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'chat_123',
          finish_reason: 'COMPLETE',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Arrr!' }] },
        }),
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      await client.chat({
        message: 'Hello',
        model: 'command',
        preamble: 'You are a pirate. Respond like a pirate.',
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      // System message should be in messages array
      expect(body.messages.some((m: any) => m.role === 'system')).toBe(true)
    })

    it('should support temperature for chat', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'chat_123',
          finish_reason: 'COMPLETE',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] },
        }),
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      await client.chat({
        message: 'Hello',
        model: 'command',
        temperature: 0.5,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.temperature).toBe(0.5)
    })

    it('should support maxTokens for chat', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'chat_123',
          finish_reason: 'MAX_TOKENS',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] },
        }),
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      await client.chat({
        message: 'Hello',
        model: 'command',
        maxTokens: 100,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.max_tokens).toBe(100)
    })

    it('should return usage information', async () => {
      const expectedResponse: ChatResponse = {
        id: 'chat_123',
        finish_reason: 'COMPLETE',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] },
        usage: {
          billed_units: { input_tokens: 5, output_tokens: 3 },
          tokens: { input_tokens: 5, output_tokens: 3 },
        },
      }
      const mockFetch = createMockFetch(
        new Map([['POST /v2/chat', { status: 200, body: expectedResponse }]])
      )

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      const response = await client.chat({
        message: 'Hi',
        model: 'command',
      })

      expect(response.usage?.billed_units?.input_tokens).toBe(5)
      expect(response.usage?.billed_units?.output_tokens).toBe(3)
    })
  })

  describe('chat with tools', () => {
    it('should support function calling with tools', async () => {
      const expectedResponse: ChatResponse = {
        id: 'chat_123',
        finish_reason: 'TOOL_CALL',
        message: {
          role: 'assistant',
          content: [],
          tool_calls: [
            {
              id: 'tool_123',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location": "San Francisco"}',
              },
            },
          ],
        },
      }
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedResponse,
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      const response = await client.chat({
        message: 'What is the weather in San Francisco?',
        model: 'command',
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get the current weather in a location',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string', description: 'City name' },
                },
                required: ['location'],
              },
            },
          },
        ],
      })

      expect(response.finish_reason).toBe('TOOL_CALL')
      expect(response.message.tool_calls).toBeDefined()
      expect(response.message.tool_calls![0].function.name).toBe('get_weather')
    })
  })
})

// =============================================================================
// Embed API Tests
// =============================================================================

describe('@dotdo/cohere - Embed API', () => {
  describe('text embeddings', () => {
    it('should generate embeddings for texts', async () => {
      const expectedResponse: EmbedResponse = {
        id: 'embed_123',
        response_type: 'embeddings_by_type',
        embeddings: {
          float: [
            [0.1, 0.2, 0.3, 0.4],
            [0.5, 0.6, 0.7, 0.8],
          ],
        },
        texts: ['Hello world', 'Goodbye world'],
        meta: {
          api_version: { version: '2' },
          billed_units: { input_tokens: 4 },
        },
      }
      const mockFetch = createMockFetch(
        new Map([['POST /v2/embed', { status: 200, body: expectedResponse }]])
      )

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      const response = await client.embed({
        texts: ['Hello world', 'Goodbye world'],
        model: 'embed-english-v3.0',
        inputType: 'search_document',
      })

      expect(response.id).toBe('embed_123')
      expect(response.embeddings.float).toHaveLength(2)
      expect(response.embeddings.float![0]).toHaveLength(4)
    })

    it('should support different input types', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'embed_123',
          response_type: 'embeddings_by_type',
          embeddings: { float: [[0.1, 0.2, 0.3]] },
          texts: ['query text'],
        }),
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })

      // Test search_query
      await client.embed({
        texts: ['query text'],
        model: 'embed-english-v3.0',
        inputType: 'search_query',
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.input_type).toBe('search_query')
    })

    it('should support different embedding types', async () => {
      const expectedResponse: EmbedResponse = {
        id: 'embed_123',
        response_type: 'embeddings_by_type',
        embeddings: {
          float: [[0.1, 0.2, 0.3]],
          int8: [[1, 2, 3]],
        },
        texts: ['Hello'],
      }
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedResponse,
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      const response = await client.embed({
        texts: ['Hello'],
        model: 'embed-english-v3.0',
        inputType: 'search_document',
        embeddingTypes: ['float', 'int8'],
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.embedding_types).toEqual(['float', 'int8'])
      expect(response.embeddings.float).toBeDefined()
      expect(response.embeddings.int8).toBeDefined()
    })

    it('should support truncate option', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'embed_123',
          response_type: 'embeddings_by_type',
          embeddings: { float: [[0.1, 0.2]] },
          texts: ['Long text'],
        }),
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      await client.embed({
        texts: ['Long text that might need truncation'],
        model: 'embed-english-v3.0',
        inputType: 'search_document',
        truncate: 'END',
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.truncate).toBe('END')
    })

    it('should support output_dimension for v4+ models', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'embed_123',
          response_type: 'embeddings_by_type',
          embeddings: { float: [new Array(256).fill(0.1)] },
          texts: ['Hello'],
        }),
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      await client.embed({
        texts: ['Hello'],
        model: 'embed-v4.0',
        inputType: 'search_document',
        outputDimension: 256,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.output_dimension).toBe(256)
    })
  })
})

// =============================================================================
// Rerank API Tests
// =============================================================================

describe('@dotdo/cohere - Rerank API', () => {
  describe('document reranking', () => {
    it('should rerank documents by relevance', async () => {
      const expectedResponse: RerankResponse = {
        id: 'rerank_123',
        results: [
          { index: 0, relevance_score: 0.95 },
          { index: 2, relevance_score: 0.45 },
          { index: 1, relevance_score: 0.15 },
        ],
        meta: {
          api_version: { version: '2' },
          billed_units: { search_units: 1 },
        },
      }
      const mockFetch = createMockFetch(
        new Map([['POST /v2/rerank', { status: 200, body: expectedResponse }]])
      )

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      const response = await client.rerank({
        query: 'What is the capital of France?',
        documents: [
          'Paris is the capital of France.',
          'London is the capital of England.',
          'Berlin is the capital of Germany.',
        ],
        model: 'rerank-english-v2.0',
      })

      expect(response.id).toBe('rerank_123')
      expect(response.results).toHaveLength(3)
      expect(response.results[0].relevance_score).toBe(0.95)
      expect(response.results[0].index).toBe(0)
    })

    it('should support topN parameter', async () => {
      const expectedResponse: RerankResponse = {
        id: 'rerank_123',
        results: [
          { index: 0, relevance_score: 0.95 },
          { index: 2, relevance_score: 0.45 },
        ],
      }
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedResponse,
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      const response = await client.rerank({
        query: 'What is the capital of France?',
        documents: ['Paris', 'London', 'Berlin'],
        model: 'rerank-english-v2.0',
        topN: 2,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.top_n).toBe(2)
      expect(response.results).toHaveLength(2)
    })

    it('should support maxTokensPerDoc parameter', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'rerank_123',
          results: [{ index: 0, relevance_score: 0.9 }],
        }),
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      await client.rerank({
        query: 'Test query',
        documents: ['Long document...'],
        model: 'rerank-english-v2.0',
        maxTokensPerDoc: 512,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.max_tokens_per_doc).toBe(512)
    })

    it('should return scores between 0 and 1', async () => {
      const expectedResponse: RerankResponse = {
        id: 'rerank_123',
        results: [
          { index: 0, relevance_score: 0.99 },
          { index: 1, relevance_score: 0.01 },
        ],
      }
      const mockFetch = createMockFetch(
        new Map([['POST /v2/rerank', { status: 200, body: expectedResponse }]])
      )

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      const response = await client.rerank({
        query: 'Test',
        documents: ['Relevant', 'Not relevant'],
        model: 'rerank-english-v2.0',
      })

      for (const result of response.results) {
        expect(result.relevance_score).toBeGreaterThanOrEqual(0)
        expect(result.relevance_score).toBeLessThanOrEqual(1)
      }
    })
  })
})

// =============================================================================
// Classify API Tests
// =============================================================================

describe('@dotdo/cohere - Classify API', () => {
  describe('text classification', () => {
    it('should classify texts with examples', async () => {
      const expectedResponse: ClassifyResponse = {
        id: 'classify_123',
        classifications: [
          {
            id: 'class_0',
            input: 'This is wonderful',
            prediction: 'positive',
            predictions: ['positive'],
            confidence: 0.95,
            confidences: [0.95],
            labels: {
              positive: { confidence: 0.95 },
              negative: { confidence: 0.05 },
            },
            classification_type: 'single-label',
          },
          {
            id: 'class_1',
            input: 'This is terrible',
            prediction: 'negative',
            predictions: ['negative'],
            confidence: 0.92,
            confidences: [0.92],
            labels: {
              positive: { confidence: 0.08 },
              negative: { confidence: 0.92 },
            },
            classification_type: 'single-label',
          },
        ],
        meta: {
          api_version: { version: '1' },
          billed_units: { classifications: 2 },
        },
      }
      const mockFetch = createMockFetch(
        new Map([['POST /v1/classify', { status: 200, body: expectedResponse }]])
      )

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      const response = await client.classify({
        inputs: ['This is wonderful', 'This is terrible'],
        examples: [
          { text: 'I love this', label: 'positive' },
          { text: 'I hate this', label: 'negative' },
        ],
      })

      expect(response.id).toBe('classify_123')
      expect(response.classifications).toHaveLength(2)
      expect(response.classifications[0].prediction).toBe('positive')
      expect(response.classifications[1].prediction).toBe('negative')
    })

    it('should return confidence scores', async () => {
      const expectedResponse: ClassifyResponse = {
        id: 'classify_123',
        classifications: [
          {
            id: 'class_0',
            input: 'I am happy',
            prediction: 'positive',
            predictions: ['positive'],
            confidence: 0.98,
            confidences: [0.98],
            labels: {
              positive: { confidence: 0.98 },
              negative: { confidence: 0.02 },
            },
            classification_type: 'single-label',
          },
        ],
      }
      const mockFetch = createMockFetch(
        new Map([['POST /v1/classify', { status: 200, body: expectedResponse }]])
      )

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      const response = await client.classify({
        inputs: ['I am happy'],
        examples: [
          { text: 'Great!', label: 'positive' },
          { text: 'Bad', label: 'negative' },
        ],
      })

      expect(response.classifications[0].confidence).toBe(0.98)
      expect(response.classifications[0].labels.positive.confidence).toBe(0.98)
    })

    it('should support model parameter for fine-tuned models', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'classify_123',
          classifications: [
            {
              id: 'class_0',
              input: 'Test',
              prediction: 'category_a',
              predictions: ['category_a'],
              confidence: 0.9,
              confidences: [0.9],
              labels: { category_a: { confidence: 0.9 } },
              classification_type: 'single-label',
            },
          ],
        }),
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      await client.classify({
        inputs: ['Test'],
        model: 'my-fine-tuned-model',
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.model).toBe('my-fine-tuned-model')
    })

    it('should support truncate parameter', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: 'classify_123',
          classifications: [
            {
              id: 'class_0',
              input: 'Long text',
              prediction: 'positive',
              predictions: ['positive'],
              confidence: 0.8,
              confidences: [0.8],
              labels: { positive: { confidence: 0.8 } },
              classification_type: 'single-label',
            },
          ],
        }),
      })

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      await client.classify({
        inputs: ['Long text that might need truncation'],
        examples: [{ text: 'Good', label: 'positive' }],
        truncate: 'START',
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.truncate).toBe('START')
    })

    it('should handle multiple labels per classification', async () => {
      const expectedResponse: ClassifyResponse = {
        id: 'classify_123',
        classifications: [
          {
            id: 'class_0',
            input: 'Mixed feelings',
            prediction: 'positive',
            predictions: ['positive', 'negative'],
            confidence: 0.6,
            confidences: [0.6, 0.4],
            labels: {
              positive: { confidence: 0.6 },
              negative: { confidence: 0.4 },
            },
            classification_type: 'multi-label',
          },
        ],
      }
      const mockFetch = createMockFetch(
        new Map([['POST /v1/classify', { status: 200, body: expectedResponse }]])
      )

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      const response = await client.classify({
        inputs: ['Mixed feelings'],
        examples: [
          { text: 'Happy', label: 'positive' },
          { text: 'Sad', label: 'negative' },
        ],
      })

      expect(response.classifications[0].classification_type).toBe('multi-label')
      expect(response.classifications[0].predictions).toContain('positive')
      expect(response.classifications[0].predictions).toContain('negative')
    })
  })
})

// =============================================================================
// Streaming Tests
// =============================================================================

describe('@dotdo/cohere - Streaming', () => {
  describe('chat streaming', () => {
    it('should stream chat responses', async () => {
      const events = [
        { event: 'message-start', data: { id: 'chat_123', type: 'message-start' } },
        { event: 'content-start', data: { type: 'content-start', index: 0 } },
        { event: 'content-delta', data: { type: 'content-delta', index: 0, delta: { message: { content: { text: 'Hello' } } } } },
        { event: 'content-delta', data: { type: 'content-delta', index: 0, delta: { message: { content: { text: ' world!' } } } } },
        { event: 'content-end', data: { type: 'content-end', index: 0 } },
        { event: 'message-end', data: { type: 'message-end', delta: { finish_reason: 'COMPLETE' } } },
      ]
      const mockFetch = createMockStreamFetch(events)

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      const stream = await client.chatStream({
        message: 'Hello',
        model: 'command',
      })

      expect(stream).toBeDefined()
      expect(Symbol.asyncIterator in stream).toBe(true)

      let fullText = ''
      for await (const event of stream) {
        if (event.type === 'content-delta' && event.delta?.message?.content?.text) {
          fullText += event.delta.message.content.text
        }
      }

      expect(fullText).toBe('Hello world!')
    })
  })

  describe('generate streaming', () => {
    it('should stream generate responses', async () => {
      const events = [
        { data: { is_finished: false, text: 'Where ' } },
        { data: { is_finished: false, text: 'every ' } },
        { data: { is_finished: false, text: 'scoop ' } },
        { data: { is_finished: false, text: 'is sweet!' } },
        { data: { is_finished: true, finish_reason: 'COMPLETE', response: { id: 'gen_123', generations: [{ text: 'Where every scoop is sweet!' }] } } },
      ]
      const mockFetch = createMockStreamFetch(events)

      const client = new CohereClient({ token: 'test-api-key', fetch: mockFetch })
      const stream = await client.generateStream({
        prompt: 'Write a tagline',
      })

      let fullText = ''
      for await (const event of stream) {
        if (!event.is_finished && event.text) {
          fullText += event.text
        }
      }

      expect(fullText).toBe('Where every scoop is sweet!')
    })
  })
})
