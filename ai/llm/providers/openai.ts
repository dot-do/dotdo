/**
 * OpenAI Provider Adapter
 *
 * Handles requests to OpenAI API with full streaming support.
 *
 * @module llm/providers/openai
 */

import type {
  ProviderAdapter,
  LLMEnv,
  LLMRequestContext,
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatCompletionChunk,
  AnthropicMessageRequest,
  AnthropicMessageResponse,
  AnthropicStreamEvent,
  AnthropicContentBlock,
} from '../types'

// ============================================================================
// OpenAI Provider
// ============================================================================

export class OpenAIAdapter implements ProviderAdapter {
  readonly name = 'openai' as const

  private getBaseUrl(env: LLMEnv): string {
    // Use AI Gateway if available
    if (env.AI_GATEWAY_ID) {
      return `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ID}/openai`
    }
    return 'https://api.openai.com/v1'
  }

  private getHeaders(env: LLMEnv): Record<string, string> {
    if (!env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required')
    }
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    }
  }

  async chatCompletion(
    request: OpenAIChatCompletionRequest,
    env: LLMEnv,
    _ctx: LLMRequestContext
  ): Promise<OpenAIChatCompletionResponse> {
    const baseUrl = this.getBaseUrl(env)
    const headers = this.getHeaders(env)

    // Ensure stream is false for non-streaming
    const body = { ...request, stream: false }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: { message?: string } }
      throw new Error(error.error?.message ?? `OpenAI API error: ${response.status}`)
    }

    return response.json() as Promise<OpenAIChatCompletionResponse>
  }

  async *streamChatCompletion(
    request: OpenAIChatCompletionRequest,
    env: LLMEnv,
    _ctx: LLMRequestContext
  ): AsyncIterable<OpenAIChatCompletionChunk> {
    const baseUrl = this.getBaseUrl(env)
    const headers = this.getHeaders(env)

    // Ensure stream is true
    const body = { ...request, stream: true, stream_options: { include_usage: true } }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: { message?: string } }
      throw new Error(error.error?.message ?? `OpenAI API error: ${response.status}`)
    }

    if (!response.body) {
      throw new Error('No response body')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === 'data: [DONE]') continue
          if (!trimmed.startsWith('data: ')) continue

          try {
            const data = JSON.parse(trimmed.slice(6)) as OpenAIChatCompletionChunk
            yield data
          } catch (error) {
            // Log malformed JSON so data loss is visible
            console.warn('[llm/openai] SSE JSON parse failed - event dropped:', {
              data: trimmed.slice(6, 100) + (trimmed.length > 106 ? '...' : ''),
              error: error instanceof Error ? error.message : 'unknown',
            })
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * Convert Anthropic request to OpenAI format and execute
   */
  async anthropicMessages(
    request: AnthropicMessageRequest,
    env: LLMEnv,
    ctx: LLMRequestContext
  ): Promise<AnthropicMessageResponse> {
    // Convert Anthropic format to OpenAI format
    const openaiRequest = this.convertAnthropicToOpenAI(request)

    // Execute OpenAI request
    const response = await this.chatCompletion(openaiRequest, env, ctx)

    // Convert response back to Anthropic format
    return this.convertOpenAIToAnthropic(response, request.model)
  }

  /**
   * Stream Anthropic messages using OpenAI backend
   */
  async *streamAnthropicMessages(
    request: AnthropicMessageRequest,
    env: LLMEnv,
    ctx: LLMRequestContext
  ): AsyncIterable<AnthropicStreamEvent> {
    const openaiRequest = this.convertAnthropicToOpenAI(request)
    const model = request.model

    let inputTokens = 0
    let outputTokens = 0
    let contentIndex = 0
    let currentToolCall: { id: string; name: string; arguments: string } | null = null

    // Send message_start
    yield {
      type: 'message_start',
      message: {
        id: `msg_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      } as const,
    }

    // Start text content block
    yield {
      type: 'content_block_start',
      index: contentIndex,
      content_block: { type: 'text', text: '' },
    }

    for await (const chunk of this.streamChatCompletion(openaiRequest, env, ctx)) {
      // Track usage
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens
        outputTokens = chunk.usage.completion_tokens
      }

      const delta = chunk.choices[0]?.delta
      if (!delta) continue

      // Handle text content
      if (delta.content) {
        yield {
          type: 'content_block_delta',
          index: contentIndex,
          delta: { type: 'text_delta', text: delta.content },
        }
      }

      // Handle tool calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.id) {
            // New tool call starting
            if (currentToolCall) {
              // Close previous tool call block
              yield { type: 'content_block_stop', index: contentIndex }
              contentIndex++
            }

            // Close text block if this is the first tool call
            if (!currentToolCall && contentIndex === 0) {
              yield { type: 'content_block_stop', index: contentIndex }
              contentIndex++
            }

            currentToolCall = { id: tc.id, name: tc.function?.name ?? '', arguments: '' }

            // Start new tool use block
            yield {
              type: 'content_block_start',
              index: contentIndex,
              content_block: {
                type: 'tool_use',
                id: tc.id,
                name: tc.function?.name ?? '',
                input: {},
              },
            }
          }

          if (tc.function?.name && currentToolCall) {
            currentToolCall.name = tc.function.name
          }

          if (tc.function?.arguments && currentToolCall) {
            currentToolCall.arguments += tc.function.arguments
            yield {
              type: 'content_block_delta',
              index: contentIndex,
              delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
            }
          }
        }
      }

      // Handle finish reason
      const finishReason = chunk.choices[0]?.finish_reason
      if (finishReason) {
        // Close current content block
        yield { type: 'content_block_stop', index: contentIndex }

        // Send message_delta
        yield {
          type: 'message_delta',
          delta: {
            stop_reason: finishReason === 'tool_calls' ? 'tool_use' : 'end_turn',
            stop_sequence: undefined,
          },
          usage: { output_tokens: outputTokens },
        }
      }
    }

    // Send message_stop
    yield { type: 'message_stop' }
  }

  private convertAnthropicToOpenAI(request: AnthropicMessageRequest): OpenAIChatCompletionRequest {
    const messages: OpenAIChatCompletionRequest['messages'] = []

    // Add system message if present
    if (request.system) {
      const systemContent = typeof request.system === 'string'
        ? request.system
        : request.system.map((s) => s.text).join('\n')
      messages.push({ role: 'system', content: systemContent })
    }

    // Convert messages
    for (const msg of request.messages) {
      if (typeof msg.content === 'string') {
        messages.push({ role: msg.role, content: msg.content })
      } else {
        // Handle content blocks
        const textParts = msg.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c) => c.text)
          .join('')

        if (msg.role === 'assistant') {
          const toolCalls = msg.content
            .filter((c): c is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } => c.type === 'tool_use')
            .map((c) => ({
              id: c.id,
              type: 'function' as const,
              function: {
                name: c.name,
                arguments: JSON.stringify(c.input),
              },
            }))

          messages.push({
            role: 'assistant',
            content: textParts || null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          })
        } else if (msg.role === 'user') {
          // Check for tool results
          const toolResults = msg.content.filter(
            (c): c is { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContentBlock[] } =>
              c.type === 'tool_result'
          )

          if (toolResults.length > 0) {
            for (const result of toolResults) {
              messages.push({
                role: 'tool',
                tool_call_id: result.tool_use_id,
                content: typeof result.content === 'string'
                  ? result.content
                  : JSON.stringify(result.content),
              })
            }
          } else {
            messages.push({ role: 'user', content: textParts })
          }
        }
      }
    }

    // Map model name
    const modelMap: Record<string, string> = {
      'claude-3-5-sonnet-20241022': 'gpt-4o',
      'claude-sonnet-4-20250514': 'gpt-4o',
      'claude-3-5-haiku-20241022': 'gpt-4o-mini',
      'claude-3-opus-20240229': 'gpt-4-turbo',
      'claude-opus-4-20250514': 'gpt-4-turbo',
    }

    const openaiRequest: OpenAIChatCompletionRequest = {
      model: modelMap[request.model] ?? 'gpt-4o',
      messages,
      max_tokens: request.max_tokens,
      temperature: request.temperature,
      top_p: request.top_p,
      stop: request.stop_sequences,
      stream: request.stream,
    }

    // Convert tools
    if (request.tools) {
      openaiRequest.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        },
      }))
    }

    return openaiRequest
  }

  private convertOpenAIToAnthropic(
    response: OpenAIChatCompletionResponse,
    requestModel: string
  ): AnthropicMessageResponse {
    const choice = response.choices[0]
    const message = choice?.message

    const content: AnthropicContentBlock[] = []

    // Add text content
    if (message?.content) {
      content.push({ type: 'text', text: message.content })
    }

    // Add tool use blocks
    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        })
      }
    }

    // Map finish reason
    const stopReasonMap: Record<string, 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use'> = {
      stop: 'end_turn',
      length: 'max_tokens',
      tool_calls: 'tool_use',
      content_filter: 'end_turn',
    }

    return {
      id: response.id,
      type: 'message',
      role: 'assistant',
      content,
      model: requestModel,
      stop_reason: stopReasonMap[choice?.finish_reason ?? 'stop'] ?? 'end_turn',
      usage: {
        input_tokens: response.usage?.prompt_tokens ?? 0,
        output_tokens: response.usage?.completion_tokens ?? 0,
      },
    }
  }

  canHandle(model: string): boolean {
    const openaiModels = [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-4',
      'gpt-3.5-turbo',
      'o1',
      'o1-mini',
      'o1-preview',
      'o3-mini',
    ]
    return openaiModels.some((m) => model.toLowerCase().includes(m.toLowerCase()))
  }

  listModels(): string[] {
    return [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-4',
      'gpt-3.5-turbo',
      'o1',
      'o1-mini',
      'o1-preview',
      'o3-mini',
    ]
  }
}

export const openaiAdapter = new OpenAIAdapter()
