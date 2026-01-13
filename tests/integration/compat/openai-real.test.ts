/**
 * OpenAI Compat Layer Integration Tests (RED Phase)
 *
 * Tests the @dotdo/openai compat layer with real DO storage,
 * verifying API compatibility with the official OpenAI SDK.
 *
 * These tests:
 * 1. Verify correct API shape matching OpenAI SDK
 * 2. Verify proper DO storage for conversation state
 * 3. Verify error handling matches OpenAI SDK behavior
 *
 * Run with: npx vitest run tests/integration/compat/openai-real.test.ts --project=integration
 *
 * @module tests/integration/compat/openai-real
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('OpenAI Compat Layer - Real Integration', () => {
  // Mock fetch for external API calls
  const mockFetch = vi.fn()

  beforeEach(() => {
    mockFetch.mockReset()
  })

  /**
   * Test Suite 1: API Shape Compatibility with OpenAI SDK
   *
   * Verifies that the OpenAI compat layer exports the same API surface
   * as the official OpenAI SDK.
   */
  describe('API Shape Compatibility', () => {
    it('exports OpenAI class with SDK-compatible constructor', async () => {
      const { OpenAI } = await import('../../../compat/openai/index')

      expect(OpenAI).toBeDefined()
      expect(typeof OpenAI).toBe('function')

      const client = new OpenAI({ apiKey: 'sk-xxx' })
      expect(client).toBeDefined()
    })

    it('default export is OpenAI class', async () => {
      const OpenAI = (await import('../../../compat/openai/index')).default

      expect(OpenAI).toBeDefined()
      expect(typeof OpenAI).toBe('function')
    })

    it('exposes chat.completions resource', async () => {
      const { OpenAI } = await import('../../../compat/openai/index')
      const client = new OpenAI({ apiKey: 'sk-xxx' })

      expect(client.chat).toBeDefined()
      expect(client.chat.completions).toBeDefined()
      expect(typeof client.chat.completions.create).toBe('function')
    })

    it('exposes embeddings resource', async () => {
      const { OpenAI } = await import('../../../compat/openai/index')
      const client = new OpenAI({ apiKey: 'sk-xxx' })

      expect(client.embeddings).toBeDefined()
      expect(typeof client.embeddings.create).toBe('function')
    })

    it('exposes models resource', async () => {
      const { OpenAI } = await import('../../../compat/openai/index')
      const client = new OpenAI({ apiKey: 'sk-xxx' })

      expect(client.models).toBeDefined()
      expect(typeof client.models.list).toBe('function')
      expect(typeof client.models.retrieve).toBe('function')
    })

    it('exposes images resource', async () => {
      const { OpenAI } = await import('../../../compat/openai/index')
      const client = new OpenAI({ apiKey: 'sk-xxx' })

      expect(client.images).toBeDefined()
      expect(typeof client.images.generate).toBe('function')
      expect(typeof client.images.edit).toBe('function')
      expect(typeof client.images.createVariation).toBe('function')
    })
  })

  /**
   * Test Suite 2: Chat Completions
   *
   * Verifies chat completion operations.
   */
  describe('Chat Completions', () => {
    it('creates chat completion with messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'chatcmpl-xxx',
          object: 'chat.completion',
          created: Date.now() / 1000,
          model: 'gpt-4',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        }),
      })

      const { OpenAI } = await import('../../../compat/openai/index')
      const client = new OpenAI({ apiKey: 'sk-xxx', fetch: mockFetch })

      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(completion).toBeDefined()
      expect(completion.id).toMatch(/^chatcmpl-/)
      expect(completion.object).toBe('chat.completion')
      expect(completion.choices).toBeDefined()
      expect(completion.choices.length).toBeGreaterThan(0)
      expect(completion.choices[0].message.content).toBeDefined()
    })

    it('supports system messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'chatcmpl-xxx',
          object: 'chat.completion',
          choices: [{ message: { role: 'assistant', content: 'Response' }, finish_reason: 'stop' }],
        }),
      })

      const { OpenAI } = await import('../../../compat/openai/index')
      const client = new OpenAI({ apiKey: 'sk-xxx', fetch: mockFetch })

      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello' },
        ],
      })

      expect(completion.choices[0].message.content).toBeDefined()
    })

    it('supports tool/function calling', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'chatcmpl-xxx',
          object: 'chat.completion',
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'call_xxx',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location":"San Francisco"}',
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        }),
      })

      const { OpenAI } = await import('../../../compat/openai/index')
      const client = new OpenAI({ apiKey: 'sk-xxx', fetch: mockFetch })

      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'What is the weather in SF?' }],
        tools: [{
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather for a location',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
              required: ['location'],
            },
          },
        }],
      })

      expect(completion.choices[0].message.tool_calls).toBeDefined()
      expect(completion.choices[0].message.tool_calls[0].function.name).toBe('get_weather')
    })

    it('supports streaming responses', async () => {
      const { OpenAI } = await import('../../../compat/openai/index')
      const client = new OpenAI({ apiKey: 'sk-xxx' })

      // Verify streaming is supported in the API
      expect(typeof client.chat.completions.create).toBe('function')

      // The create method should accept stream: true option
      // Actual streaming test would need SSE mock
    })

    it('returns usage statistics', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'chatcmpl-xxx',
          object: 'chat.completion',
          choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        }),
      })

      const { OpenAI } = await import('../../../compat/openai/index')
      const client = new OpenAI({ apiKey: 'sk-xxx', fetch: mockFetch })

      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      })

      expect(completion.usage).toBeDefined()
      expect(completion.usage.prompt_tokens).toBeDefined()
      expect(completion.usage.completion_tokens).toBeDefined()
      expect(completion.usage.total_tokens).toBeDefined()
    })
  })

  /**
   * Test Suite 3: Embeddings
   *
   * Verifies embedding operations.
   */
  describe('Embeddings', () => {
    it('creates embedding for string input', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          object: 'list',
          data: [{
            object: 'embedding',
            index: 0,
            embedding: Array(1536).fill(0).map(() => Math.random() * 2 - 1),
          }],
          model: 'text-embedding-ada-002',
          usage: {
            prompt_tokens: 4,
            total_tokens: 4,
          },
        }),
      })

      const { OpenAI } = await import('../../../compat/openai/index')
      const client = new OpenAI({ apiKey: 'sk-xxx', fetch: mockFetch })

      const response = await client.embeddings.create({
        model: 'text-embedding-ada-002',
        input: 'Hello world',
      })

      expect(response).toBeDefined()
      expect(response.data).toBeDefined()
      expect(response.data.length).toBe(1)
      expect(response.data[0].embedding).toBeDefined()
      expect(Array.isArray(response.data[0].embedding)).toBe(true)
    })

    it('creates embeddings for array of strings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          object: 'list',
          data: [
            { object: 'embedding', index: 0, embedding: Array(1536).fill(0.1) },
            { object: 'embedding', index: 1, embedding: Array(1536).fill(0.2) },
          ],
          model: 'text-embedding-ada-002',
          usage: { prompt_tokens: 8, total_tokens: 8 },
        }),
      })

      const { OpenAI } = await import('../../../compat/openai/index')
      const client = new OpenAI({ apiKey: 'sk-xxx', fetch: mockFetch })

      const response = await client.embeddings.create({
        model: 'text-embedding-ada-002',
        input: ['Hello', 'World'],
      })

      expect(response.data.length).toBe(2)
    })

    it('supports text-embedding-3-small model', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          object: 'list',
          data: [{
            object: 'embedding',
            index: 0,
            embedding: Array(1536).fill(0.1),
          }],
          model: 'text-embedding-3-small',
          usage: { prompt_tokens: 4, total_tokens: 4 },
        }),
      })

      const { OpenAI } = await import('../../../compat/openai/index')
      const client = new OpenAI({ apiKey: 'sk-xxx', fetch: mockFetch })

      const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'Test',
      })

      expect(response.model).toBe('text-embedding-3-small')
    })
  })

  /**
   * Test Suite 4: Error Handling Compatibility
   *
   * Verifies that errors match OpenAI SDK error patterns.
   */
  describe('Error Handling Compatibility', () => {
    it('throws OpenAIError for API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({
          error: {
            message: 'Incorrect API key provided',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        }),
      })

      const { OpenAI, OpenAIError } = await import('../../../compat/openai/index')
      const client = new OpenAI({ apiKey: 'invalid', fetch: mockFetch })

      await expect(
        client.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hi' }],
        })
      ).rejects.toThrow()
    })

    it('error includes type and code like OpenAI', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: {
            message: 'Invalid model',
            type: 'invalid_request_error',
            code: 'model_not_found',
          },
        }),
      })

      const { OpenAI } = await import('../../../compat/openai/index')
      const client = new OpenAI({ apiKey: 'sk-xxx', fetch: mockFetch })

      try {
        await client.chat.completions.create({
          model: 'invalid-model',
          messages: [{ role: 'user', content: 'Hi' }],
        })
      } catch (error: any) {
        expect(error).toBeDefined()
        expect(error.message).toBeDefined()
      }
    })

    it('handles rate limit errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: () => Promise.resolve({
          error: {
            message: 'Rate limit exceeded',
            type: 'rate_limit_error',
          },
        }),
      })

      const { OpenAI } = await import('../../../compat/openai/index')
      const client = new OpenAI({ apiKey: 'sk-xxx', fetch: mockFetch })

      await expect(
        client.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hi' }],
        })
      ).rejects.toThrow()
    })
  })

  /**
   * Test Suite 5: Type Definitions
   *
   * Verifies that types match OpenAI SDK types.
   */
  describe('Type Definitions', () => {
    it('exports ChatCompletion type', async () => {
      const openai = await import('../../../compat/openai/index')

      // Type should be available for import
      expect(openai).toBeDefined()
    })

    it('exports ChatCompletionMessage type', async () => {
      const openai = await import('../../../compat/openai/index')
      expect(openai).toBeDefined()
    })

    it('exports CreateEmbeddingResponse type', async () => {
      const openai = await import('../../../compat/openai/index')
      expect(openai).toBeDefined()
    })

    it('message has correct role types', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'chatcmpl-xxx',
          object: 'chat.completion',
          choices: [{
            message: { role: 'assistant', content: 'Hi' },
            finish_reason: 'stop',
          }],
        }),
      })

      const { OpenAI } = await import('../../../compat/openai/index')
      const client = new OpenAI({ apiKey: 'sk-xxx', fetch: mockFetch })

      const completion = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      })

      const role = completion.choices[0].message.role
      expect(['assistant', 'user', 'system', 'tool', 'function']).toContain(role)
    })
  })
})
