/**
 * @dotdo/openai - Legacy Completions API Tests
 *
 * Tests for the legacy text completions API (not chat).
 * This API is deprecated but still supported for backwards compatibility.
 *
 * @deprecated Use chat completions instead
 */

import { describe, it, expect, vi } from 'vitest'
import {
  OpenAI,
  type Completion,
  type CompletionChunk,
  type CompletionCreateParams,
} from '../index'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockFetch(responses: Map<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const urlObj = new URL(url)
    const key = `${options?.method ?? 'POST'} ${urlObj.pathname}`

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

function mockCompletion(overrides: Partial<Completion> = {}): Completion {
  return {
    id: 'cmpl-test123',
    object: 'text_completion',
    created: Math.floor(Date.now() / 1000),
    model: 'gpt-3.5-turbo-instruct',
    choices: [
      {
        text: '\n\nHello! How can I help you today?',
        index: 0,
        logprobs: null,
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 5,
      completion_tokens: 10,
      total_tokens: 15,
    },
    ...overrides,
  }
}

// =============================================================================
// Legacy Completions Tests
// =============================================================================

describe('@dotdo/openai - Legacy Completions API', () => {
  describe('create', () => {
    it('should create a text completion', async () => {
      const expectedCompletion = mockCompletion()
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/completions', { status: 200, body: expectedCompletion }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const completion = await client.completions.create({
        model: 'gpt-3.5-turbo-instruct',
        prompt: 'Say hello',
      })

      expect(completion.id).toBe('cmpl-test123')
      expect(completion.object).toBe('text_completion')
      expect(completion.choices[0].text).toContain('Hello')
    })

    it('should support string prompt', async () => {
      const expectedCompletion = mockCompletion()
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedCompletion,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      await client.completions.create({
        model: 'gpt-3.5-turbo-instruct',
        prompt: 'Say hello',
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.prompt).toBe('Say hello')
    })

    it('should support array of strings prompt', async () => {
      const expectedCompletion = mockCompletion({
        choices: [
          { text: 'Hello', index: 0, logprobs: null, finish_reason: 'stop' },
          { text: 'World', index: 1, logprobs: null, finish_reason: 'stop' },
        ],
      })
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedCompletion,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const completion = await client.completions.create({
        model: 'gpt-3.5-turbo-instruct',
        prompt: ['Say hello', 'Say world'],
      })

      expect(completion.choices).toHaveLength(2)
    })

    it('should support max_tokens parameter', async () => {
      const expectedCompletion = mockCompletion()
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedCompletion,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      await client.completions.create({
        model: 'gpt-3.5-turbo-instruct',
        prompt: 'Say hello',
        max_tokens: 100,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.max_tokens).toBe(100)
    })

    it('should support temperature parameter', async () => {
      const expectedCompletion = mockCompletion()
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedCompletion,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      await client.completions.create({
        model: 'gpt-3.5-turbo-instruct',
        prompt: 'Say hello',
        temperature: 0.7,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.temperature).toBe(0.7)
    })

    it('should support suffix parameter', async () => {
      const expectedCompletion = mockCompletion()
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedCompletion,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      await client.completions.create({
        model: 'gpt-3.5-turbo-instruct',
        prompt: 'def fibonacci(n):',
        suffix: '\n    return result',
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.suffix).toBe('\n    return result')
    })

    it('should support n parameter for multiple completions', async () => {
      const expectedCompletion = mockCompletion({
        choices: [
          { text: 'Response 1', index: 0, logprobs: null, finish_reason: 'stop' },
          { text: 'Response 2', index: 1, logprobs: null, finish_reason: 'stop' },
          { text: 'Response 3', index: 2, logprobs: null, finish_reason: 'stop' },
        ],
      })
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedCompletion,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const completion = await client.completions.create({
        model: 'gpt-3.5-turbo-instruct',
        prompt: 'Say hello',
        n: 3,
      })

      expect(completion.choices).toHaveLength(3)
    })

    it('should support stop sequences', async () => {
      const expectedCompletion = mockCompletion()
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedCompletion,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      await client.completions.create({
        model: 'gpt-3.5-turbo-instruct',
        prompt: 'Say hello',
        stop: ['\n', '.'],
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.stop).toEqual(['\n', '.'])
    })

    it('should support logprobs parameter', async () => {
      const expectedCompletion = mockCompletion({
        choices: [
          {
            text: 'Hello',
            index: 0,
            logprobs: {
              tokens: ['Hello'],
              token_logprobs: [-0.5],
              top_logprobs: [{ 'Hello': -0.5, 'Hi': -1.0 }],
              text_offset: [0],
            },
            finish_reason: 'stop',
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
      const completion = await client.completions.create({
        model: 'gpt-3.5-turbo-instruct',
        prompt: 'Say hello',
        logprobs: 2,
      })

      expect(completion.choices[0].logprobs).toBeDefined()
      expect(completion.choices[0].logprobs?.tokens).toEqual(['Hello'])
    })

    it('should support echo parameter', async () => {
      const expectedCompletion = mockCompletion({
        choices: [
          {
            text: 'Say hello\n\nHello!',
            index: 0,
            logprobs: null,
            finish_reason: 'stop',
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
      await client.completions.create({
        model: 'gpt-3.5-turbo-instruct',
        prompt: 'Say hello',
        echo: true,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.echo).toBe(true)
    })

    it('should support best_of parameter', async () => {
      const expectedCompletion = mockCompletion()
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedCompletion,
      })

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      await client.completions.create({
        model: 'gpt-3.5-turbo-instruct',
        prompt: 'Say hello',
        best_of: 3,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.best_of).toBe(3)
    })

    it('should return usage statistics', async () => {
      const expectedCompletion = mockCompletion({
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v1/completions', { status: 200, body: expectedCompletion }],
        ])
      )

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const completion = await client.completions.create({
        model: 'gpt-3.5-turbo-instruct',
        prompt: 'Say hello',
      })

      expect(completion.usage).toBeDefined()
      expect(completion.usage?.prompt_tokens).toBe(10)
      expect(completion.usage?.completion_tokens).toBe(20)
      expect(completion.usage?.total_tokens).toBe(30)
    })

    it('should handle different finish reasons', async () => {
      const testCases: Array<{ finish_reason: 'stop' | 'length' | 'content_filter' | null }> = [
        { finish_reason: 'stop' },
        { finish_reason: 'length' },
        { finish_reason: 'content_filter' },
      ]

      for (const { finish_reason } of testCases) {
        const expectedCompletion = mockCompletion({
          choices: [
            {
              text: 'Response',
              index: 0,
              logprobs: null,
              finish_reason,
            },
          ],
        })
        const mockFetch = createMockFetch(
          new Map([
            ['POST /v1/completions', { status: 200, body: expectedCompletion }],
          ])
        )

        const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
        const completion = await client.completions.create({
          model: 'gpt-3.5-turbo-instruct',
          prompt: 'Say hello',
        })

        expect(completion.choices[0].finish_reason).toBe(finish_reason)
      }
    })
  })

  describe('streaming', () => {
    function createMockStreamResponse(chunks: CompletionChunk[]) {
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

    it('should support stream: true option', async () => {
      const chunks: CompletionChunk[] = [
        {
          id: 'cmpl-test123',
          object: 'text_completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-3.5-turbo-instruct',
          choices: [{ text: 'Hello', index: 0, logprobs: null, finish_reason: null }],
        },
        {
          id: 'cmpl-test123',
          object: 'text_completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-3.5-turbo-instruct',
          choices: [{ text: ' there!', index: 0, logprobs: null, finish_reason: null }],
        },
        {
          id: 'cmpl-test123',
          object: 'text_completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-3.5-turbo-instruct',
          choices: [{ text: '', index: 0, logprobs: null, finish_reason: 'stop' }],
        },
      ]

      const mockFetch = vi.fn().mockResolvedValue(createMockStreamResponse(chunks))

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const stream = await client.completions.create({
        model: 'gpt-3.5-turbo-instruct',
        prompt: 'Say hello',
        stream: true,
      })

      const collectedText: string[] = []
      for await (const chunk of stream) {
        if (chunk.choices[0]?.text) {
          collectedText.push(chunk.choices[0].text)
        }
      }

      expect(collectedText.join('')).toBe('Hello there!')
    })

    it('should return an async iterable', async () => {
      const chunks: CompletionChunk[] = [
        {
          id: 'cmpl-test123',
          object: 'text_completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-3.5-turbo-instruct',
          choices: [{ text: 'Test', index: 0, logprobs: null, finish_reason: null }],
        },
      ]

      const mockFetch = vi.fn().mockResolvedValue(createMockStreamResponse(chunks))

      const client = new OpenAI({ apiKey: 'sk-test-xxx', fetch: mockFetch })
      const stream = await client.completions.create({
        model: 'gpt-3.5-turbo-instruct',
        prompt: 'Say hello',
        stream: true,
      })

      expect(typeof stream[Symbol.asyncIterator]).toBe('function')
    })
  })
})
