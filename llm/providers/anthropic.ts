/**
 * Anthropic Provider Adapter
 *
 * Handles requests to Anthropic API with full streaming support.
 *
 * @module llm/providers/anthropic
 */

import type {
  ProviderAdapter,
  LLMEnv,
  LLMRequestContext,
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatCompletionChunk,
  OpenAIChatMessage,
  AnthropicMessageRequest,
  AnthropicMessageResponse,
  AnthropicStreamEvent,
  AnthropicContentBlock,
  AnthropicMessage,
} from '../types'

// ============================================================================
// Anthropic Provider
// ============================================================================

export class AnthropicAdapter implements ProviderAdapter {
  readonly name = 'anthropic' as const

  private getBaseUrl(env: LLMEnv): string {
    // Use AI Gateway if available
    if (env.AI_GATEWAY_ID) {
      return `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ID}/anthropic`
    }
    return 'https://api.anthropic.com'
  }

  private getHeaders(env: LLMEnv): Record<string, string> {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required')
    }
    return {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    }
  }

  async chatCompletion(
    request: OpenAIChatCompletionRequest,
    env: LLMEnv,
    ctx: LLMRequestContext
  ): Promise<OpenAIChatCompletionResponse> {
    // Convert OpenAI format to Anthropic format
    const anthropicRequest = this.convertOpenAIToAnthropic(request)

    // Execute Anthropic request
    const response = await this.anthropicMessages(anthropicRequest, env, ctx)

    // Convert response back to OpenAI format
    return this.convertAnthropicToOpenAI(response, request.model)
  }

  async *streamChatCompletion(
    request: OpenAIChatCompletionRequest,
    env: LLMEnv,
    ctx: LLMRequestContext
  ): AsyncIterable<OpenAIChatCompletionChunk> {
    const anthropicRequest = this.convertOpenAIToAnthropic(request)
    const requestId = `chatcmpl-${Date.now()}`
    const created = Math.floor(Date.now() / 1000)

    let toolCallIndex = 0
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map()

    for await (const event of this.streamAnthropicMessages(anthropicRequest, env, ctx)) {
      switch (event.type) {
        case 'content_block_start':
          if (event.content_block.type === 'tool_use') {
            const tc = event.content_block as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
            toolCalls.set(toolCallIndex, { id: tc.id, name: tc.name, arguments: '' })
            yield {
              id: requestId,
              object: 'chat.completion.chunk',
              created,
              model: request.model,
              choices: [{
                index: 0,
                delta: {
                  role: 'assistant',
                  tool_calls: [{
                    id: tc.id,
                    type: 'function',
                    function: { name: tc.name, arguments: '' },
                  }],
                },
                finish_reason: null,
              }],
            }
            toolCallIndex++
          }
          break

        case 'content_block_delta':
          if (event.delta.type === 'text_delta') {
            yield {
              id: requestId,
              object: 'chat.completion.chunk',
              created,
              model: request.model,
              choices: [{
                index: 0,
                delta: { content: event.delta.text },
                finish_reason: null,
              }],
            }
          } else if (event.delta.type === 'input_json_delta') {
            const currentIndex = toolCallIndex - 1
            const tc = toolCalls.get(currentIndex)
            if (tc) {
              tc.arguments += event.delta.partial_json
              yield {
                id: requestId,
                object: 'chat.completion.chunk',
                created,
                model: request.model,
                choices: [{
                  index: 0,
                  delta: {
                    tool_calls: [{
                      id: tc.id,
                      type: 'function',
                      function: { name: tc.name, arguments: event.delta.partial_json },
                    }],
                  },
                  finish_reason: null,
                }],
              }
            }
          }
          break

        case 'message_delta':
          const finishReason = event.delta.stop_reason === 'tool_use' ? 'tool_calls' : 'stop'
          yield {
            id: requestId,
            object: 'chat.completion.chunk',
            created,
            model: request.model,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: finishReason,
            }],
            usage: {
              prompt_tokens: 0,
              completion_tokens: event.usage.output_tokens,
              total_tokens: event.usage.output_tokens,
            },
          }
          break
      }
    }
  }

  async anthropicMessages(
    request: AnthropicMessageRequest,
    env: LLMEnv,
    _ctx: LLMRequestContext
  ): Promise<AnthropicMessageResponse> {
    const baseUrl = this.getBaseUrl(env)
    const headers = this.getHeaders(env)

    // Ensure stream is false for non-streaming
    const body = { ...request, stream: false }

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: { message?: string } }
      throw new Error(error.error?.message ?? `Anthropic API error: ${response.status}`)
    }

    return response.json() as Promise<AnthropicMessageResponse>
  }

  async *streamAnthropicMessages(
    request: AnthropicMessageRequest,
    env: LLMEnv,
    _ctx: LLMRequestContext
  ): AsyncIterable<AnthropicStreamEvent> {
    const baseUrl = this.getBaseUrl(env)
    const headers = this.getHeaders(env)

    // Ensure stream is true
    const body = { ...request, stream: true }

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: { message?: string } }
      throw new Error(error.error?.message ?? `Anthropic API error: ${response.status}`)
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
          if (!trimmed || trimmed.startsWith(':')) continue

          if (trimmed.startsWith('event: ')) {
            // Event type line, next line should be data
            continue
          }

          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6)) as AnthropicStreamEvent
              yield data
            } catch (error) {
              // Log malformed JSON so data loss is visible
              console.warn('[llm/anthropic] SSE JSON parse failed - event dropped:', {
                data: trimmed.slice(6, 100) + (trimmed.length > 106 ? '...' : ''),
                error: error instanceof Error ? error.message : 'unknown',
              })
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  private convertOpenAIToAnthropic(request: OpenAIChatCompletionRequest): AnthropicMessageRequest {
    let system: string | undefined
    const messages: AnthropicMessage[] = []

    // Process messages
    for (const msg of request.messages) {
      if (msg.role === 'system') {
        // Combine system messages
        system = system ? `${system}\n\n${msg.content}` : (msg.content ?? '')
      } else if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content ?? '' })
      } else if (msg.role === 'assistant') {
        const content: AnthropicContentBlock[] = []

        if (msg.content) {
          content.push({ type: 'text', text: msg.content })
        }

        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments),
            })
          }
        }

        messages.push({
          role: 'assistant',
          content: content.length > 0 ? content : (msg.content ?? ''),
        })
      } else if (msg.role === 'tool') {
        // Tool results need to be part of a user message
        const toolResult: AnthropicContentBlock = {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id!,
          content: msg.content ?? '',
        }

        // Check if the last message is a user message we can add to
        const lastMsg = messages[messages.length - 1]
        if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
          (lastMsg.content as AnthropicContentBlock[]).push(toolResult)
        } else {
          messages.push({ role: 'user', content: [toolResult] })
        }
      }
    }

    // Map model name
    const modelMap: Record<string, string> = {
      'gpt-4o': 'claude-sonnet-4-20250514',
      'gpt-4o-mini': 'claude-3-5-haiku-20241022',
      'gpt-4-turbo': 'claude-3-opus-20240229',
      'gpt-4': 'claude-3-opus-20240229',
      'gpt-3.5-turbo': 'claude-3-5-haiku-20241022',
    }

    const anthropicRequest: AnthropicMessageRequest = {
      model: modelMap[request.model] ?? request.model,
      messages,
      max_tokens: request.max_tokens ?? request.max_completion_tokens ?? 4096,
      temperature: request.temperature,
      top_p: request.top_p,
      stop_sequences: typeof request.stop === 'string' ? [request.stop] : request.stop,
      stream: request.stream,
    }

    if (system) {
      anthropicRequest.system = system
    }

    // Convert tools
    if (request.tools) {
      anthropicRequest.tools = request.tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters ?? { type: 'object', properties: {} },
      }))
    }

    return anthropicRequest
  }

  private convertAnthropicToOpenAI(
    response: AnthropicMessageResponse,
    requestModel: string
  ): OpenAIChatCompletionResponse {
    const message: OpenAIChatMessage = {
      role: 'assistant',
      content: null,
    }

    // Extract text content
    const textBlocks = response.content.filter(
      (c): c is { type: 'text'; text: string } => c.type === 'text'
    )
    if (textBlocks.length > 0) {
      message.content = textBlocks.map((b) => b.text).join('')
    }

    // Extract tool calls
    const toolBlocks = response.content.filter(
      (c): c is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
        c.type === 'tool_use'
    )
    if (toolBlocks.length > 0) {
      message.tool_calls = toolBlocks.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.input),
        },
      }))
    }

    // Map finish reason
    const finishReasonMap: Record<string, 'stop' | 'length' | 'tool_calls' | 'content_filter'> = {
      end_turn: 'stop',
      max_tokens: 'length',
      stop_sequence: 'stop',
      tool_use: 'tool_calls',
    }

    return {
      id: response.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: requestModel,
      choices: [{
        index: 0,
        message,
        finish_reason: finishReasonMap[response.stop_reason ?? 'end_turn'] ?? 'stop',
      }],
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    }
  }

  canHandle(model: string): boolean {
    const anthropicModels = [
      'claude-3-5-sonnet',
      'claude-sonnet-4',
      'claude-3-5-haiku',
      'claude-3-opus',
      'claude-opus-4',
      'claude-3-haiku',
    ]
    return anthropicModels.some((m) => model.toLowerCase().includes(m.toLowerCase()))
  }

  listModels(): string[] {
    return [
      'claude-3-5-sonnet-20241022',
      'claude-sonnet-4-20250514',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
      'claude-opus-4-20250514',
    ]
  }
}

export const anthropicAdapter = new AnthropicAdapter()
