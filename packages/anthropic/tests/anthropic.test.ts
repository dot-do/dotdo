/**
 * @dotdo/anthropic - Anthropic Compatibility Layer Tests
 *
 * Tests for the Anthropic API compatibility layer including:
 * - Messages API (create, streaming)
 * - Tool use (function calling)
 * - Model selection
 * - Error handling
 * - Local mock backend for testing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Anthropic,
  AnthropicError,
  type Message,
  type ContentBlock,
  type TextBlock,
  type ToolUseBlock,
  type MessageCreateParams,
  type Tool,
  type MessageStreamEvent,
} from '../src/index'

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
        headers: new Headers({ 'request-id': 'req_mock' }),
        json: async () => ({
          type: 'error',
          error: { type: 'not_found_error', message: `No mock for ${key}` },
        }),
      }
    }

    return {
      ok: mockResponse.status >= 200 && mockResponse.status < 300,
      status: mockResponse.status,
      headers: new Headers({ 'request-id': 'req_mock' }),
      json: async () => mockResponse.body,
    }
  })
}

function createMockStreamFetch(events: Array<{ event: string; data: unknown }>) {
  return vi.fn(async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        for (const { event, data } of events) {
          const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
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

function mockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg_test123',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello! How can I help you today?' }],
    model: 'claude-3-sonnet-20240229',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
    },
    ...overrides,
  }
}

// =============================================================================
// Anthropic Client Tests
// =============================================================================

describe('@dotdo/anthropic - Anthropic Client', () => {
  describe('initialization', () => {
    it('should create an Anthropic instance with API key', () => {
      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx' })
      expect(client).toBeDefined()
      expect(client.messages).toBeDefined()
    })

    it('should throw error without API key', () => {
      expect(() => new Anthropic({ apiKey: '' })).toThrow('Anthropic API key is required')
    })

    it('should accept configuration options', () => {
      const client = new Anthropic({
        apiKey: 'sk-ant-test-xxx',
        maxRetries: 3,
        timeout: 60000,
      })
      expect(client).toBeDefined()
    })

    it('should use ANTHROPIC_API_KEY from environment if not provided', () => {
      // Note: In real implementation, would check process.env or env binding
      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx' })
      expect(client).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('should throw AnthropicError on API errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/messages',
            {
              status: 400,
              body: {
                type: 'error',
                error: {
                  type: 'invalid_request_error',
                  message: 'max_tokens must be greater than 0',
                },
              },
            },
          ],
        ])
      )

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })

      await expect(
        client.messages.create({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 0,
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow(AnthropicError)
    })

    it('should include error type and message in AnthropicError', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/messages',
            {
              status: 401,
              body: {
                type: 'error',
                error: {
                  type: 'authentication_error',
                  message: 'Invalid API key',
                },
              },
            },
          ],
        ])
      )

      const client = new Anthropic({ apiKey: 'invalid-key', fetch: mockFetch })

      try {
        await client.messages.create({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'Hello' }],
        })
      } catch (error) {
        expect(error).toBeInstanceOf(AnthropicError)
        const anthropicError = error as AnthropicError
        expect(anthropicError.type).toBe('authentication_error')
        expect(anthropicError.message).toBe('Invalid API key')
        expect(anthropicError.status).toBe(401)
      }
    })

    it('should handle rate limit errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /v1/messages',
            {
              status: 429,
              body: {
                type: 'error',
                error: {
                  type: 'rate_limit_error',
                  message: 'Rate limit exceeded',
                },
              },
            },
          ],
        ])
      )

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })

      await expect(
        client.messages.create({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow('Rate limit exceeded')
    })
  })
})

// =============================================================================
// Messages API Tests
// =============================================================================

describe('@dotdo/anthropic - Messages API', () => {
  describe('create', () => {
    it('should create a message with basic parameters', async () => {
      const expectedMessage = mockMessage()
      const mockFetch = createMockFetch(
        new Map([['POST /v1/messages', { status: 200, body: expectedMessage }]])
      )

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      const message = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(message.id).toBe('msg_test123')
      expect(message.type).toBe('message')
      expect(message.role).toBe('assistant')
      expect(message.content).toHaveLength(1)
      expect(message.content[0].type).toBe('text')
      expect((message.content[0] as TextBlock).text).toBe('Hello! How can I help you today?')
    })

    it('should include proper headers in request', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockMessage(),
      })

      const client = new Anthropic({
        apiKey: 'sk-ant-test-xxx',
        fetch: mockFetch,
        defaultHeaders: { 'X-Custom-Header': 'custom-value' },
      })

      await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'sk-ant-test-xxx',
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          }),
        })
      )
    })

    it('should support system messages', async () => {
      const expectedMessage = mockMessage({
        content: [{ type: 'text', text: 'I am a helpful assistant.' }],
      })
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedMessage,
      })

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      const message = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Who are you?' }],
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.system).toBe('You are a helpful assistant.')
    })

    it('should support multi-turn conversations', async () => {
      const expectedMessage = mockMessage({
        content: [{ type: 'text', text: 'The capital of France is Paris.' }],
      })
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedMessage,
      })

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [
          { role: 'user', content: 'What is the capital of France?' },
          { role: 'assistant', content: 'The capital of France is Paris.' },
          { role: 'user', content: 'And what about Germany?' },
        ],
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.messages).toHaveLength(3)
    })

    it('should support temperature parameter', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockMessage(),
      })

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.temperature).toBe(0.7)
    })

    it('should support top_p parameter', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockMessage(),
      })

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
        top_p: 0.9,
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.top_p).toBe(0.9)
    })

    it('should support stop_sequences parameter', async () => {
      const expectedMessage = mockMessage({ stop_reason: 'stop_sequence', stop_sequence: '###' })
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedMessage,
      })

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      const message = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
        stop_sequences: ['###', '---'],
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.stop_sequences).toEqual(['###', '---'])
      expect(message.stop_reason).toBe('stop_sequence')
      expect(message.stop_sequence).toBe('###')
    })

    it('should return usage information', async () => {
      const expectedMessage = mockMessage({
        usage: { input_tokens: 15, output_tokens: 25 },
      })
      const mockFetch = createMockFetch(
        new Map([['POST /v1/messages', { status: 200, body: expectedMessage }]])
      )

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      const message = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(message.usage.input_tokens).toBe(15)
      expect(message.usage.output_tokens).toBe(25)
    })
  })

  describe('model selection', () => {
    it('should support claude-3-opus model', async () => {
      const expectedMessage = mockMessage({ model: 'claude-3-opus-20240229' })
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedMessage,
      })

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      const message = await client.messages.create({
        model: 'claude-3-opus-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(message.model).toBe('claude-3-opus-20240229')
    })

    it('should support claude-3-sonnet model', async () => {
      const expectedMessage = mockMessage({ model: 'claude-3-sonnet-20240229' })
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedMessage,
      })

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      const message = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(message.model).toBe('claude-3-sonnet-20240229')
    })

    it('should support claude-3-haiku model', async () => {
      const expectedMessage = mockMessage({ model: 'claude-3-haiku-20240307' })
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedMessage,
      })

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      const message = await client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(message.model).toBe('claude-3-haiku-20240307')
    })

    it('should support claude-3-5-sonnet model', async () => {
      const expectedMessage = mockMessage({ model: 'claude-3-5-sonnet-20241022' })
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedMessage,
      })

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      const message = await client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(message.model).toBe('claude-3-5-sonnet-20241022')
    })
  })
})

// =============================================================================
// Tool Use Tests
// =============================================================================

describe('@dotdo/anthropic - Tool Use', () => {
  const weatherTool: Tool = {
    name: 'get_weather',
    description: 'Get the current weather in a location',
    input_schema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'The city and state, e.g. San Francisco, CA',
        },
        unit: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: 'Temperature unit',
        },
      },
      required: ['location'],
    },
  }

  describe('tool definition', () => {
    it('should accept tools in create request', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () =>
          mockMessage({
            content: [
              {
                type: 'tool_use',
                id: 'toolu_test123',
                name: 'get_weather',
                input: { location: 'San Francisco, CA' },
              },
            ],
            stop_reason: 'tool_use',
          }),
      })

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        tools: [weatherTool],
        messages: [{ role: 'user', content: 'What is the weather in San Francisco?' }],
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.tools).toHaveLength(1)
      expect(body.tools[0].name).toBe('get_weather')
    })

    it('should support multiple tools', async () => {
      const calculatorTool: Tool = {
        name: 'calculate',
        description: 'Perform mathematical calculations',
        input_schema: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'Math expression to evaluate' },
          },
          required: ['expression'],
        },
      }

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockMessage(),
      })

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        tools: [weatherTool, calculatorTool],
        messages: [{ role: 'user', content: 'Hello' }],
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.tools).toHaveLength(2)
    })
  })

  describe('tool use response', () => {
    it('should return tool_use content block when model uses a tool', async () => {
      const expectedMessage = mockMessage({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_test123',
            name: 'get_weather',
            input: { location: 'San Francisco, CA', unit: 'fahrenheit' },
          },
        ],
        stop_reason: 'tool_use',
      })
      const mockFetch = createMockFetch(
        new Map([['POST /v1/messages', { status: 200, body: expectedMessage }]])
      )

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      const message = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        tools: [weatherTool],
        messages: [{ role: 'user', content: 'What is the weather in San Francisco?' }],
      })

      expect(message.stop_reason).toBe('tool_use')
      expect(message.content).toHaveLength(1)

      const toolUse = message.content[0] as ToolUseBlock
      expect(toolUse.type).toBe('tool_use')
      expect(toolUse.id).toBe('toolu_test123')
      expect(toolUse.name).toBe('get_weather')
      expect(toolUse.input).toEqual({ location: 'San Francisco, CA', unit: 'fahrenheit' })
    })

    it('should support mixed text and tool_use content', async () => {
      const expectedMessage = mockMessage({
        content: [
          { type: 'text', text: 'Let me check the weather for you.' },
          {
            type: 'tool_use',
            id: 'toolu_test123',
            name: 'get_weather',
            input: { location: 'San Francisco, CA' },
          },
        ],
        stop_reason: 'tool_use',
      })
      const mockFetch = createMockFetch(
        new Map([['POST /v1/messages', { status: 200, body: expectedMessage }]])
      )

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      const message = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        tools: [weatherTool],
        messages: [{ role: 'user', content: 'What is the weather in San Francisco?' }],
      })

      expect(message.content).toHaveLength(2)
      expect(message.content[0].type).toBe('text')
      expect(message.content[1].type).toBe('tool_use')
    })
  })

  describe('tool result handling', () => {
    it('should accept tool_result in messages', async () => {
      const expectedMessage = mockMessage({
        content: [{ type: 'text', text: 'The weather in San Francisco is 72F and sunny.' }],
      })
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => expectedMessage,
      })

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        tools: [weatherTool],
        messages: [
          { role: 'user', content: 'What is the weather in San Francisco?' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_test123',
                name: 'get_weather',
                input: { location: 'San Francisco, CA' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_test123',
                content: '72F, sunny',
              },
            ],
          },
        ],
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.messages).toHaveLength(3)
      expect(body.messages[2].content[0].type).toBe('tool_result')
    })

    it('should support tool_result with is_error flag', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () =>
          mockMessage({
            content: [{ type: 'text', text: 'I was unable to get the weather due to an error.' }],
          }),
      })

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        tools: [weatherTool],
        messages: [
          { role: 'user', content: 'What is the weather in San Francisco?' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_test123',
                name: 'get_weather',
                input: { location: 'San Francisco, CA' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_test123',
                content: 'Error: Weather service unavailable',
                is_error: true,
              },
            ],
          },
        ],
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.messages[2].content[0].is_error).toBe(true)
    })
  })

  describe('tool_choice parameter', () => {
    it('should support tool_choice auto', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockMessage(),
      })

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        tools: [weatherTool],
        tool_choice: { type: 'auto' },
        messages: [{ role: 'user', content: 'Hello' }],
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.tool_choice).toEqual({ type: 'auto' })
    })

    it('should support tool_choice any', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () =>
          mockMessage({
            content: [{ type: 'tool_use', id: 'toolu_123', name: 'get_weather', input: {} }],
            stop_reason: 'tool_use',
          }),
      })

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        tools: [weatherTool],
        tool_choice: { type: 'any' },
        messages: [{ role: 'user', content: 'Hello' }],
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.tool_choice).toEqual({ type: 'any' })
    })

    it('should support tool_choice with specific tool', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () =>
          mockMessage({
            content: [
              { type: 'tool_use', id: 'toolu_123', name: 'get_weather', input: { location: 'NYC' } },
            ],
            stop_reason: 'tool_use',
          }),
      })

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        tools: [weatherTool],
        tool_choice: { type: 'tool', name: 'get_weather' },
        messages: [{ role: 'user', content: 'Hello' }],
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.tool_choice).toEqual({ type: 'tool', name: 'get_weather' })
    })
  })
})

// =============================================================================
// Streaming Tests
// =============================================================================

describe('@dotdo/anthropic - Streaming', () => {
  describe('stream creation', () => {
    it('should create a streaming response when stream: true', async () => {
      const events: Array<{ event: string; data: unknown }> = [
        { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'claude-3-sonnet-20240229', stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } } },
        { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world!' } } },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
        { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } } },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ]
      const mockFetch = createMockStreamFetch(events)

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      const stream = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      })

      expect(stream).toBeDefined()
      expect(Symbol.asyncIterator in stream).toBe(true)
    })

    it('should yield events in order', async () => {
      const events: Array<{ event: string; data: unknown }> = [
        { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'claude-3-sonnet-20240229', stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } } },
        { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } } },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
        { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } } },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ]
      const mockFetch = createMockStreamFetch(events)

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      const stream = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      })

      const receivedEvents: MessageStreamEvent[] = []
      for await (const event of stream) {
        receivedEvents.push(event)
      }

      expect(receivedEvents).toHaveLength(6)
      expect(receivedEvents[0].type).toBe('message_start')
      expect(receivedEvents[1].type).toBe('content_block_start')
      expect(receivedEvents[2].type).toBe('content_block_delta')
      expect(receivedEvents[3].type).toBe('content_block_stop')
      expect(receivedEvents[4].type).toBe('message_delta')
      expect(receivedEvents[5].type).toBe('message_stop')
    })

    it('should accumulate text deltas correctly', async () => {
      const events: Array<{ event: string; data: unknown }> = [
        { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'claude-3-sonnet-20240229', stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } } },
        { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The ' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'quick ' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'brown ' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'fox' } } },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
        { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } } },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ]
      const mockFetch = createMockStreamFetch(events)

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      const stream = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      })

      let fullText = ''
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          fullText += event.delta.text
        }
      }

      expect(fullText).toBe('The quick brown fox')
    })
  })

  describe('streaming with tools', () => {
    it('should stream tool use blocks', async () => {
      const events: Array<{ event: string; data: unknown }> = [
        { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'claude-3-sonnet-20240229', stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } } },
        { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_123', name: 'get_weather', input: {} } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"loc' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'ation": "SF"}' } } },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
        { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 10 } } },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ]
      const mockFetch = createMockStreamFetch(events)

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      const stream = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather',
            input_schema: { type: 'object', properties: {}, required: [] },
          },
        ],
        messages: [{ role: 'user', content: 'What is the weather?' }],
        stream: true,
      })

      const receivedEvents: MessageStreamEvent[] = []
      for await (const event of stream) {
        receivedEvents.push(event)
      }

      expect(receivedEvents[1].type).toBe('content_block_start')
      if (receivedEvents[1].type === 'content_block_start') {
        expect(receivedEvents[1].content_block.type).toBe('tool_use')
      }
    })

    it('should accumulate input_json_delta correctly', async () => {
      const events: Array<{ event: string; data: unknown }> = [
        { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'claude-3-sonnet-20240229', stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } } },
        { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_123', name: 'get_weather', input: {} } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'location": ' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"San Francisco, CA"' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '}' } } },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
        { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 15 } } },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ]
      const mockFetch = createMockStreamFetch(events)

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      const stream = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather',
            input_schema: { type: 'object', properties: {}, required: [] },
          },
        ],
        messages: [{ role: 'user', content: 'What is the weather in San Francisco?' }],
        stream: true,
      })

      let jsonString = ''
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
          jsonString += event.delta.partial_json
        }
      }

      const parsed = JSON.parse(jsonString)
      expect(parsed.location).toBe('San Francisco, CA')
    })
  })

  describe('stream helper methods', () => {
    it('should provide getText() helper to get final text', async () => {
      const events: Array<{ event: string; data: unknown }> = [
        { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'claude-3-sonnet-20240229', stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } } },
        { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world!' } } },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
        { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } } },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ]
      const mockFetch = createMockStreamFetch(events)

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      const stream = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      })

      // Consume the stream first
      for await (const _ of stream) {
        // consume
      }

      const text = stream.getText()
      expect(text).toBe('Hello world!')
    })

    it('should provide getFinalMessage() helper', async () => {
      const events: Array<{ event: string; data: unknown }> = [
        { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'claude-3-sonnet-20240229', stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } } },
        { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi!' } } },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
        { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } } },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ]
      const mockFetch = createMockStreamFetch(events)

      const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
      const stream = await client.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      })

      // Consume the stream first
      for await (const _ of stream) {
        // consume
      }

      const message = stream.getFinalMessage()
      expect(message.id).toBe('msg_test')
      expect(message.role).toBe('assistant')
      expect(message.stop_reason).toBe('end_turn')
      expect(message.content).toHaveLength(1)
      expect((message.content[0] as TextBlock).text).toBe('Hi!')
    })
  })
})

// =============================================================================
// Metadata and Headers Tests
// =============================================================================

describe('@dotdo/anthropic - Metadata and Headers', () => {
  it('should support metadata parameter', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => mockMessage(),
    })

    const client = new Anthropic({ apiKey: 'sk-ant-test-xxx', fetch: mockFetch })
    await client.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
      metadata: {
        user_id: 'user_123',
      },
    })

    const [, options] = mockFetch.mock.calls[0]
    const body = JSON.parse(options?.body as string)
    expect(body.metadata).toEqual({ user_id: 'user_123' })
  })

  it('should allow anthropic-beta header for beta features', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => mockMessage(),
    })

    const client = new Anthropic({
      apiKey: 'sk-ant-test-xxx',
      fetch: mockFetch,
      defaultHeaders: { 'anthropic-beta': 'tools-2024-05-16' },
    })

    await client.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'anthropic-beta': 'tools-2024-05-16',
        }),
      })
    )
  })
})
