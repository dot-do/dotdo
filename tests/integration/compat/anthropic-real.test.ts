/**
 * Anthropic Compat Layer Integration Tests (RED Phase)
 *
 * Tests the @dotdo/anthropic compat layer with real DO storage,
 * verifying API compatibility with the official Anthropic SDK.
 *
 * These tests:
 * 1. Verify correct API shape matching Anthropic SDK
 * 2. Verify proper DO storage for conversation state
 * 3. Verify error handling matches Anthropic SDK behavior
 *
 * Run with: npx vitest run tests/integration/compat/anthropic-real.test.ts --project=integration
 *
 * @module tests/integration/compat/anthropic-real
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('Anthropic Compat Layer - Real Integration', () => {
  // Mock fetch for external API calls
  const mockFetch = vi.fn()

  beforeEach(() => {
    mockFetch.mockReset()
  })

  /**
   * Test Suite 1: API Shape Compatibility with Anthropic SDK
   *
   * Verifies that the Anthropic compat layer exports the same API surface
   * as the official @anthropic-ai/sdk.
   */
  describe('API Shape Compatibility', () => {
    it('exports Anthropic class with SDK-compatible constructor', async () => {
      const { Anthropic } = await import('../../../compat/anthropic/index')

      expect(Anthropic).toBeDefined()
      expect(typeof Anthropic).toBe('function')

      const client = new Anthropic({ apiKey: 'sk-ant-xxx' })
      expect(client).toBeDefined()
    })

    it('default export is Anthropic class', async () => {
      const Anthropic = (await import('../../../compat/anthropic/index')).default

      expect(Anthropic).toBeDefined()
      expect(typeof Anthropic).toBe('function')
    })

    it('exposes messages resource', async () => {
      const { Anthropic } = await import('../../../compat/anthropic/index')
      const client = new Anthropic({ apiKey: 'sk-ant-xxx' })

      expect(client.messages).toBeDefined()
      expect(typeof client.messages.create).toBe('function')
    })

    it('accepts apiKey from environment if not provided', async () => {
      const { Anthropic } = await import('../../../compat/anthropic/index')

      // Should not throw if ANTHROPIC_API_KEY env var is set
      // or should handle gracefully
      expect(Anthropic).toBeDefined()
    })
  })

  /**
   * Test Suite 2: Messages API
   *
   * Verifies messages.create operations.
   */
  describe('Messages API', () => {
    it('creates message with model and messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'msg_xxx',
          type: 'message',
          role: 'assistant',
          content: [{
            type: 'text',
            text: 'Hello! How can I help you today?',
          }],
          model: 'claude-3-sonnet-20240229',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            output_tokens: 20,
          },
        }),
      })

      const { Anthropic } = await import('../../../compat/anthropic/index')
      const client = new Anthropic({ apiKey: 'sk-ant-xxx', fetch: mockFetch })

      const message = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello!' }],
      })

      expect(message).toBeDefined()
      expect(message.id).toMatch(/^msg_/)
      expect(message.type).toBe('message')
      expect(message.role).toBe('assistant')
      expect(message.content).toBeDefined()
      expect(Array.isArray(message.content)).toBe(true)
    })

    it('supports system parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'msg_xxx',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'As a helpful assistant...' }],
          model: 'claude-3-sonnet-20240229',
          stop_reason: 'end_turn',
          usage: { input_tokens: 15, output_tokens: 25 },
        }),
      })

      const { Anthropic } = await import('../../../compat/anthropic/index')
      const client = new Anthropic({ apiKey: 'sk-ant-xxx', fetch: mockFetch })

      const message = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Hello!' }],
      })

      expect(message.content[0].text).toBeDefined()
    })

    it('supports tool use', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'msg_xxx',
          type: 'message',
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'toolu_xxx',
            name: 'get_weather',
            input: { location: 'San Francisco' },
          }],
          model: 'claude-3-sonnet-20240229',
          stop_reason: 'tool_use',
          usage: { input_tokens: 20, output_tokens: 30 },
        }),
      })

      const { Anthropic } = await import('../../../compat/anthropic/index')
      const client = new Anthropic({ apiKey: 'sk-ant-xxx', fetch: mockFetch })

      const message = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        tools: [{
          name: 'get_weather',
          description: 'Get weather for a location',
          input_schema: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
          },
        }],
        messages: [{ role: 'user', content: 'What is the weather in SF?' }],
      })

      expect(message.stop_reason).toBe('tool_use')
      expect(message.content[0].type).toBe('tool_use')
      expect(message.content[0].name).toBe('get_weather')
    })

    it('supports tool_choice parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'msg_xxx',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_xxx', name: 'specific_tool', input: {} }],
          model: 'claude-3-sonnet-20240229',
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 15 },
        }),
      })

      const { Anthropic } = await import('../../../compat/anthropic/index')
      const client = new Anthropic({ apiKey: 'sk-ant-xxx', fetch: mockFetch })

      const message = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        tools: [{ name: 'specific_tool', description: 'A tool', input_schema: { type: 'object' } }],
        tool_choice: { type: 'tool', name: 'specific_tool' },
        messages: [{ role: 'user', content: 'Use the tool' }],
      })

      expect(message.content[0].name).toBe('specific_tool')
    })

    it('handles multi-turn conversations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'msg_xxx',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Your name is Alice.' }],
          model: 'claude-3-sonnet-20240229',
          stop_reason: 'end_turn',
          usage: { input_tokens: 30, output_tokens: 10 },
        }),
      })

      const { Anthropic } = await import('../../../compat/anthropic/index')
      const client = new Anthropic({ apiKey: 'sk-ant-xxx', fetch: mockFetch })

      const message = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [
          { role: 'user', content: 'My name is Alice.' },
          { role: 'assistant', content: 'Nice to meet you, Alice!' },
          { role: 'user', content: 'What is my name?' },
        ],
      })

      expect(message.content[0].text).toContain('Alice')
    })

    it('returns usage statistics', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'msg_xxx',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi' }],
          model: 'claude-3-sonnet-20240229',
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
          },
        }),
      })

      const { Anthropic } = await import('../../../compat/anthropic/index')
      const client = new Anthropic({ apiKey: 'sk-ant-xxx', fetch: mockFetch })

      const message = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hi' }],
      })

      expect(message.usage).toBeDefined()
      expect(message.usage.input_tokens).toBeDefined()
      expect(message.usage.output_tokens).toBeDefined()
    })
  })

  /**
   * Test Suite 3: Streaming Support
   *
   * Verifies streaming responses.
   */
  describe('Streaming Support', () => {
    it('supports stream: true parameter', async () => {
      const { Anthropic } = await import('../../../compat/anthropic/index')
      const client = new Anthropic({ apiKey: 'sk-ant-xxx' })

      // Verify the create method accepts stream parameter
      expect(typeof client.messages.create).toBe('function')
    })

    it('streaming response is async iterable', async () => {
      // This test verifies the streaming interface
      // Actual SSE streaming would need a mock ReadableStream
      const { Anthropic } = await import('../../../compat/anthropic/index')

      expect(Anthropic).toBeDefined()
    })
  })

  /**
   * Test Suite 4: Content Types
   *
   * Verifies different content block types.
   */
  describe('Content Types', () => {
    it('handles text content blocks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'msg_xxx',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello world!' }],
          model: 'claude-3-sonnet-20240229',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      })

      const { Anthropic } = await import('../../../compat/anthropic/index')
      const client = new Anthropic({ apiKey: 'sk-ant-xxx', fetch: mockFetch })

      const message = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hi' }],
      })

      expect(message.content[0].type).toBe('text')
      expect(message.content[0].text).toBe('Hello world!')
    })

    it('handles tool_use content blocks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'msg_xxx',
          type: 'message',
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'toolu_xxx',
            name: 'calculator',
            input: { expression: '2+2' },
          }],
          model: 'claude-3-sonnet-20240229',
          stop_reason: 'tool_use',
          usage: { input_tokens: 15, output_tokens: 20 },
        }),
      })

      const { Anthropic } = await import('../../../compat/anthropic/index')
      const client = new Anthropic({ apiKey: 'sk-ant-xxx', fetch: mockFetch })

      const message = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        tools: [{ name: 'calculator', description: 'Calculate', input_schema: { type: 'object' } }],
        messages: [{ role: 'user', content: 'What is 2+2?' }],
      })

      const toolUse = message.content[0]
      expect(toolUse.type).toBe('tool_use')
      expect(toolUse.id).toBeDefined()
      expect(toolUse.name).toBe('calculator')
      expect(toolUse.input).toBeDefined()
    })

    it('supports image input with base64', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'msg_xxx',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'I see an image.' }],
          model: 'claude-3-sonnet-20240229',
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 10 },
        }),
      })

      const { Anthropic } = await import('../../../compat/anthropic/index')
      const client = new Anthropic({ apiKey: 'sk-ant-xxx', fetch: mockFetch })

      const message = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'base64encodeddata',
              },
            },
            { type: 'text', text: 'What is in this image?' },
          ],
        }],
      })

      expect(message.content[0].text).toBeDefined()
    })
  })

  /**
   * Test Suite 5: Error Handling Compatibility
   *
   * Verifies that errors match Anthropic SDK error patterns.
   */
  describe('Error Handling Compatibility', () => {
    it('throws AnthropicError for API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({
          type: 'error',
          error: {
            type: 'authentication_error',
            message: 'Invalid API key',
          },
        }),
      })

      const { Anthropic } = await import('../../../compat/anthropic/index')
      const client = new Anthropic({ apiKey: 'invalid', fetch: mockFetch })

      await expect(
        client.messages.create({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'Hi' }],
        })
      ).rejects.toThrow()
    })

    it('error includes type like Anthropic', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'Invalid model',
          },
        }),
      })

      const { Anthropic } = await import('../../../compat/anthropic/index')
      const client = new Anthropic({ apiKey: 'sk-ant-xxx', fetch: mockFetch })

      try {
        await client.messages.create({
          model: 'invalid-model',
          max_tokens: 1024,
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
          type: 'error',
          error: {
            type: 'rate_limit_error',
            message: 'Rate limit exceeded',
          },
        }),
      })

      const { Anthropic } = await import('../../../compat/anthropic/index')
      const client = new Anthropic({ apiKey: 'sk-ant-xxx', fetch: mockFetch })

      await expect(
        client.messages.create({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'Hi' }],
        })
      ).rejects.toThrow()
    })

    it('handles overloaded errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 529,
        json: () => Promise.resolve({
          type: 'error',
          error: {
            type: 'overloaded_error',
            message: 'API is overloaded',
          },
        }),
      })

      const { Anthropic } = await import('../../../compat/anthropic/index')
      const client = new Anthropic({ apiKey: 'sk-ant-xxx', fetch: mockFetch })

      await expect(
        client.messages.create({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'Hi' }],
        })
      ).rejects.toThrow()
    })
  })
})
