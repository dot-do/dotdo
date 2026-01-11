/**
 * LLM.do - SSE Streaming Utilities
 *
 * Server-Sent Events (SSE) streaming for LLM responses.
 *
 * @module llm/streaming
 */

import type {
  OpenAIChatCompletionChunk,
  AnthropicStreamEvent,
} from './types'

// ============================================================================
// SSE Response Helpers
// ============================================================================

/**
 * Create an SSE response with proper headers
 */
export function createSSEResponse(stream: ReadableStream): Response {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable buffering in Nginx
    },
  })
}

/**
 * Format an OpenAI SSE event
 */
export function formatOpenAISSE(chunk: OpenAIChatCompletionChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`
}

/**
 * Format an Anthropic SSE event
 */
export function formatAnthropicSSE(event: AnthropicStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

/**
 * Format the final [DONE] event for OpenAI compatibility
 */
export function formatOpenAIDone(): string {
  return 'data: [DONE]\n\n'
}

// ============================================================================
// Stream Conversion
// ============================================================================

/**
 * Convert an async iterable of OpenAI chunks to an SSE ReadableStream
 */
export function openAIChunksToSSE(
  chunks: AsyncIterable<OpenAIChatCompletionChunk>
): ReadableStream {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of chunks) {
          controller.enqueue(encoder.encode(formatOpenAISSE(chunk)))
        }
        controller.enqueue(encoder.encode(formatOpenAIDone()))
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

/**
 * Convert an async iterable of Anthropic events to an SSE ReadableStream
 */
export function anthropicEventsToSSE(
  events: AsyncIterable<AnthropicStreamEvent>
): ReadableStream {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(formatAnthropicSSE(event)))
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

// ============================================================================
// Stream Aggregation
// ============================================================================

/**
 * Aggregate OpenAI stream chunks into a single response
 */
export async function aggregateOpenAIStream(
  chunks: AsyncIterable<OpenAIChatCompletionChunk>
): Promise<{
  id: string
  model: string
  content: string
  toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  finishReason: string | null
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}> {
  let id = ''
  let model = ''
  let content = ''
  const toolCalls: Map<number, { id: string; type: 'function'; function: { name: string; arguments: string } }> = new Map()
  let finishReason: string | null = null
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

  for await (const chunk of chunks) {
    id = chunk.id
    model = chunk.model

    const choice = chunk.choices[0]
    if (!choice) continue

    if (choice.delta.content) {
      content += choice.delta.content
    }

    if (choice.delta.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        const index = 'index' in tc ? (tc as { index: number }).index : toolCalls.size
        const existing = toolCalls.get(index) ?? {
          id: '',
          type: 'function' as const,
          function: { name: '', arguments: '' },
        }

        if (tc.id) existing.id = tc.id
        if (tc.function?.name) existing.function.name = tc.function.name
        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments

        toolCalls.set(index, existing)
      }
    }

    if (choice.finish_reason) {
      finishReason = choice.finish_reason
    }

    if (chunk.usage) {
      usage = chunk.usage
    }
  }

  return {
    id,
    model,
    content,
    toolCalls: Array.from(toolCalls.values()),
    finishReason,
    usage,
  }
}

/**
 * Aggregate Anthropic stream events into a single response
 */
export async function aggregateAnthropicStream(
  events: AsyncIterable<AnthropicStreamEvent>
): Promise<{
  id: string
  model: string
  content: string
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>
  stopReason: string | null
  usage: { input_tokens: number; output_tokens: number }
}> {
  let id = ''
  let model = ''
  let content = ''
  const toolCalls: Array<{ id: string; name: string; input: string }> = []
  let currentToolIndex = -1
  let stopReason: string | null = null
  let usage = { input_tokens: 0, output_tokens: 0 }

  for await (const event of events) {
    switch (event.type) {
      case 'message_start':
        id = event.message.id
        model = event.message.model
        if (event.message.usage) {
          usage.input_tokens = event.message.usage.input_tokens
        }
        break

      case 'content_block_start':
        if (event.content_block.type === 'tool_use') {
          const tc = event.content_block as { type: 'tool_use'; id: string; name: string }
          toolCalls.push({ id: tc.id, name: tc.name, input: '' })
          currentToolIndex = toolCalls.length - 1
        }
        break

      case 'content_block_delta':
        if (event.delta.type === 'text_delta') {
          content += event.delta.text
        } else if (event.delta.type === 'input_json_delta' && currentToolIndex >= 0) {
          toolCalls[currentToolIndex].input += event.delta.partial_json
        }
        break

      case 'message_delta':
        stopReason = event.delta.stop_reason
        usage.output_tokens = event.usage.output_tokens
        break
    }
  }

  return {
    id,
    model,
    content,
    toolCalls: toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      input: tc.input ? JSON.parse(tc.input) : {},
    })),
    stopReason,
    usage,
  }
}

// ============================================================================
// Error Streaming
// ============================================================================

/**
 * Create an SSE error response
 */
export function createSSEErrorResponse(error: Error, format: 'openai' | 'anthropic' = 'openai'): Response {
  const encoder = new TextEncoder()

  if (format === 'anthropic') {
    const event: AnthropicStreamEvent = {
      type: 'error',
      error: {
        type: 'api_error',
        message: error.message,
      },
    }
    const body = formatAnthropicSSE(event)

    return new Response(encoder.encode(body), {
      status: 500,
      headers: {
        'Content-Type': 'text/event-stream',
      },
    })
  }

  // OpenAI format - send error as a regular JSON response
  return new Response(
    JSON.stringify({
      error: {
        message: error.message,
        type: 'api_error',
        code: 'internal_error',
      },
    }),
    {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )
}
