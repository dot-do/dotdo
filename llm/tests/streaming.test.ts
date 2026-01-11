/**
 * LLM Streaming Tests
 *
 * Tests for SSE streaming utilities.
 */

import { describe, it, expect } from 'vitest'
import {
  formatOpenAISSE,
  formatAnthropicSSE,
  formatOpenAIDone,
  aggregateOpenAIStream,
  aggregateAnthropicStream,
} from '../streaming'
import type { OpenAIChatCompletionChunk, AnthropicStreamEvent } from '../types'

describe('SSE Formatting', () => {
  describe('formatOpenAISSE()', () => {
    it('should format OpenAI chunk correctly', () => {
      const chunk: OpenAIChatCompletionChunk = {
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: 1699000000,
        model: 'gpt-4o',
        choices: [{
          index: 0,
          delta: { content: 'Hello' },
          finish_reason: null,
        }],
      }

      const result = formatOpenAISSE(chunk)
      expect(result).toMatch(/^data: /)
      expect(result).toMatch(/\n\n$/)
      expect(result).toContain('"id":"chatcmpl-123"')
      expect(result).toContain('"content":"Hello"')
    })
  })

  describe('formatAnthropicSSE()', () => {
    it('should format Anthropic event correctly', () => {
      const event: AnthropicStreamEvent = {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      }

      const result = formatAnthropicSSE(event)
      expect(result).toMatch(/^event: content_block_delta\n/)
      expect(result).toMatch(/data: /)
      expect(result).toMatch(/\n\n$/)
      expect(result).toContain('"text":"Hello"')
    })
  })

  describe('formatOpenAIDone()', () => {
    it('should format [DONE] correctly', () => {
      const result = formatOpenAIDone()
      expect(result).toBe('data: [DONE]\n\n')
    })
  })
})

describe('Stream Aggregation', () => {
  describe('aggregateOpenAIStream()', () => {
    it('should aggregate text content from chunks', async () => {
      const chunks: OpenAIChatCompletionChunk[] = [
        {
          id: 'chatcmpl-123',
          object: 'chat.completion.chunk',
          created: 1699000000,
          model: 'gpt-4o',
          choices: [{
            index: 0,
            delta: { content: 'Hello' },
            finish_reason: null,
          }],
        },
        {
          id: 'chatcmpl-123',
          object: 'chat.completion.chunk',
          created: 1699000000,
          model: 'gpt-4o',
          choices: [{
            index: 0,
            delta: { content: ' world' },
            finish_reason: null,
          }],
        },
        {
          id: 'chatcmpl-123',
          object: 'chat.completion.chunk',
          created: 1699000000,
          model: 'gpt-4o',
          choices: [{
            index: 0,
            delta: {},
            finish_reason: 'stop',
          }],
        },
      ]

      async function* toAsyncIterable() {
        for (const chunk of chunks) {
          yield chunk
        }
      }

      const result = await aggregateOpenAIStream(toAsyncIterable())
      expect(result.content).toBe('Hello world')
      expect(result.finishReason).toBe('stop')
      expect(result.id).toBe('chatcmpl-123')
      expect(result.model).toBe('gpt-4o')
    })

    it('should aggregate tool calls from chunks', async () => {
      // OpenAI streaming includes an index property on tool_calls to track which tool call is being updated
      const chunks: OpenAIChatCompletionChunk[] = [
        {
          id: 'chatcmpl-123',
          object: 'chat.completion.chunk',
          created: 1699000000,
          model: 'gpt-4o',
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_123',
                type: 'function',
                function: { name: 'get_weather', arguments: '' },
              }] as unknown as OpenAIChatCompletionChunk['choices'][0]['delta']['tool_calls'],
            },
            finish_reason: null,
          }],
        },
        {
          id: 'chatcmpl-123',
          object: 'chat.completion.chunk',
          created: 1699000000,
          model: 'gpt-4o',
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_123',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":' },
              }] as unknown as OpenAIChatCompletionChunk['choices'][0]['delta']['tool_calls'],
            },
            finish_reason: null,
          }],
        },
        {
          id: 'chatcmpl-123',
          object: 'chat.completion.chunk',
          created: 1699000000,
          model: 'gpt-4o',
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_123',
                type: 'function',
                function: { name: 'get_weather', arguments: '"London"}' },
              }] as unknown as OpenAIChatCompletionChunk['choices'][0]['delta']['tool_calls'],
            },
            finish_reason: null,
          }],
        },
        {
          id: 'chatcmpl-123',
          object: 'chat.completion.chunk',
          created: 1699000000,
          model: 'gpt-4o',
          choices: [{
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          }],
        },
      ]

      async function* toAsyncIterable() {
        for (const chunk of chunks) {
          yield chunk
        }
      }

      const result = await aggregateOpenAIStream(toAsyncIterable())
      expect(result.toolCalls.length).toBe(1)
      expect(result.toolCalls[0].function.name).toBe('get_weather')
      expect(result.toolCalls[0].function.arguments).toBe('{"city":"London"}')
      expect(result.finishReason).toBe('tool_calls')
    })

    it('should track usage from final chunk', async () => {
      const chunks: OpenAIChatCompletionChunk[] = [
        {
          id: 'chatcmpl-123',
          object: 'chat.completion.chunk',
          created: 1699000000,
          model: 'gpt-4o',
          choices: [{
            index: 0,
            delta: { content: 'Hello' },
            finish_reason: null,
          }],
        },
        {
          id: 'chatcmpl-123',
          object: 'chat.completion.chunk',
          created: 1699000000,
          model: 'gpt-4o',
          choices: [{
            index: 0,
            delta: {},
            finish_reason: 'stop',
          }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        },
      ]

      async function* toAsyncIterable() {
        for (const chunk of chunks) {
          yield chunk
        }
      }

      const result = await aggregateOpenAIStream(toAsyncIterable())
      expect(result.usage.prompt_tokens).toBe(10)
      expect(result.usage.completion_tokens).toBe(5)
      expect(result.usage.total_tokens).toBe(15)
    })
  })

  describe('aggregateAnthropicStream()', () => {
    it('should aggregate text content from events', async () => {
      const events: AnthropicStreamEvent[] = [
        {
          type: 'message_start',
          message: {
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: ' world' },
        },
        {
          type: 'content_block_stop',
          index: 0,
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: undefined },
          usage: { output_tokens: 5 },
        },
        {
          type: 'message_stop',
        },
      ]

      async function* toAsyncIterable() {
        for (const event of events) {
          yield event
        }
      }

      const result = await aggregateAnthropicStream(toAsyncIterable())
      expect(result.content).toBe('Hello world')
      expect(result.stopReason).toBe('end_turn')
      expect(result.id).toBe('msg_123')
      expect(result.model).toBe('claude-3-5-sonnet-20241022')
    })

    it('should aggregate tool calls from events', async () => {
      const events: AnthropicStreamEvent[] = [
        {
          type: 'message_start',
          message: {
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tool_123',
            name: 'get_weather',
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"city":' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '"London"}' },
        },
        {
          type: 'content_block_stop',
          index: 0,
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use', stop_sequence: undefined },
          usage: { output_tokens: 5 },
        },
        {
          type: 'message_stop',
        },
      ]

      async function* toAsyncIterable() {
        for (const event of events) {
          yield event
        }
      }

      const result = await aggregateAnthropicStream(toAsyncIterable())
      expect(result.toolCalls.length).toBe(1)
      expect(result.toolCalls[0].name).toBe('get_weather')
      expect(result.toolCalls[0].input).toEqual({ city: 'London' })
      expect(result.stopReason).toBe('tool_use')
    })

    it('should track usage from events', async () => {
      const events: AnthropicStreamEvent[] = [
        {
          type: 'message_start',
          message: {
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello' },
        },
        {
          type: 'content_block_stop',
          index: 0,
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: undefined },
          usage: { output_tokens: 5 },
        },
        {
          type: 'message_stop',
        },
      ]

      async function* toAsyncIterable() {
        for (const event of events) {
          yield event
        }
      }

      const result = await aggregateAnthropicStream(toAsyncIterable())
      expect(result.usage.input_tokens).toBe(10)
      expect(result.usage.output_tokens).toBe(5)
    })
  })
})
