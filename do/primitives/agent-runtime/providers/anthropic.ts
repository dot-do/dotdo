/**
 * Anthropic Provider - Anthropic API adapter
 *
 * Implements the LLMProvider interface for Claude models.
 *
 * @module db/primitives/agent-runtime/providers
 */

import { BaseProvider } from './base'
import type {
  ProviderConfig,
  CompletionRequest,
  CompletionResponse,
  Message,
  StreamEvent,
  ModelConfig,
  ToolDefinition,
  ToolCall,
} from '../types'

// ============================================================================
// Anthropic Model Registry
// ============================================================================

const ANTHROPIC_MODELS: ModelConfig[] = [
  {
    model: 'claude-opus-4-20250514',
    provider: 'anthropic',
    maxContextTokens: 200000,
    maxOutputTokens: 32000,
    inputCostPer1k: 0.015,
    outputCostPer1k: 0.075,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  {
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    maxContextTokens: 200000,
    maxOutputTokens: 64000,
    inputCostPer1k: 0.003,
    outputCostPer1k: 0.015,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  {
    model: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    maxContextTokens: 200000,
    maxOutputTokens: 8192,
    inputCostPer1k: 0.003,
    outputCostPer1k: 0.015,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  {
    model: 'claude-3-opus-20240229',
    provider: 'anthropic',
    maxContextTokens: 200000,
    maxOutputTokens: 4096,
    inputCostPer1k: 0.015,
    outputCostPer1k: 0.075,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  {
    model: 'claude-3-haiku-20240307',
    provider: 'anthropic',
    maxContextTokens: 200000,
    maxOutputTokens: 4096,
    inputCostPer1k: 0.00025,
    outputCostPer1k: 0.00125,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
]

// ============================================================================
// Anthropic Provider Implementation
// ============================================================================

export interface AnthropicProviderOptions extends Omit<ProviderConfig, 'name'> {
  apiKey: string
  baseUrl?: string
  defaultModel?: string
  timeout?: number
  options?: {
    mockResponse?: CompletionResponse
    mockStreamEvents?: StreamEvent[]
  }
}

export class AnthropicProvider extends BaseProvider {
  private mockResponse?: CompletionResponse
  private mockStreamEvents?: StreamEvent[]

  constructor(options: AnthropicProviderOptions) {
    super({
      name: 'anthropic',
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? 'https://api.anthropic.com',
      defaultModel: options.defaultModel ?? 'claude-sonnet-4-20250514',
      timeout: options.timeout,
      headers: options.headers,
      options: options.options,
    })
    this.mockResponse = options.options?.mockResponse
    this.mockStreamEvents = options.options?.mockStreamEvents
  }

  supportsModel(model: string): boolean {
    return ANTHROPIC_MODELS.some((m) => m.model === model) || model.startsWith('claude-')
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    // Use mock response if provided (for testing)
    if (this.mockResponse) {
      return {
        ...this.mockResponse,
        latencyMs: 0,
      }
    }

    const { result, latencyMs } = await this.withLatency(async () => {
      const response = await this.callAPI(request)
      return this.parseResponse(response)
    })

    return {
      ...result,
      latencyMs,
    }
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamEvent> {
    // Use mock stream events if provided (for testing)
    if (this.mockStreamEvents) {
      for (const event of this.mockStreamEvents) {
        yield event
      }
      return
    }

    // Real streaming implementation
    const response = await this.callStreamingAPI(request)
    yield* this.parseStreamResponse(response)
  }

  async countTokens(messages: Message[]): Promise<number> {
    // Claude uses a similar tokenization to GPT
    // In production, use the anthropic-tokenizer or API
    let total = 0
    for (const message of messages) {
      // Base tokens per message
      total += 4
      if (typeof message.content === 'string') {
        total += this.estimateTokens(message.content)
      } else if (message.role === 'user' && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'text' && part.text) {
            total += this.estimateTokens(part.text)
          }
        }
      }
    }
    return total
  }

  async listModels(): Promise<ModelConfig[]> {
    return ANTHROPIC_MODELS
  }

  // ============================================================================
  // Private Implementation
  // ============================================================================

  protected convertMessages(messages: Message[]): unknown[] {
    // Anthropic uses different format - system is separate, tool results in user messages
    const result: unknown[] = []

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Skip system messages - handled separately
        continue
      }

      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          result.push({ role: 'user', content: msg.content })
        } else {
          // Handle multimodal content
          result.push({
            role: 'user',
            content: msg.content.map((part) => {
              if (part.type === 'text') {
                return { type: 'text', text: part.text }
              }
              if (part.type === 'image') {
                return {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: part.mimeType,
                    data: part.data,
                  },
                }
              }
              return part
            }),
          })
        }
      } else if (msg.role === 'assistant') {
        const content: unknown[] = []
        if (msg.content) {
          content.push({ type: 'text', text: msg.content })
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            })
          }
        }
        result.push({ role: 'assistant', content })
      } else if (msg.role === 'tool') {
        // Tool results go in user messages for Anthropic
        result.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId,
              content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            },
          ],
        })
      }
    }

    return result
  }

  private convertTools(tools: ToolDefinition[]): unknown[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }))
  }

  private getSystemMessage(messages: Message[]): string | undefined {
    const systemMsg = messages.find((m) => m.role === 'system')
    return systemMsg?.content as string | undefined
  }

  protected parseResponse(raw: unknown): CompletionResponse {
    const response = raw as {
      id: string
      type: string
      model: string
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      >
      stop_reason: string
      usage: {
        input_tokens: number
        output_tokens: number
      }
    }

    const textBlocks = response.content.filter((b) => b.type === 'text')
    const toolBlocks = response.content.filter((b) => b.type === 'tool_use')

    const toolCalls: ToolCall[] | undefined = toolBlocks.length > 0
      ? toolBlocks.map((b) => {
          const tool = b as { id: string; name: string; input: Record<string, unknown> }
          return {
            id: tool.id,
            name: tool.name,
            arguments: tool.input,
          }
        })
      : undefined

    return {
      id: response.id,
      model: response.model,
      content: textBlocks.map((b) => (b as { text: string }).text).join('') || undefined,
      toolCalls,
      finishReason: this.mapFinishReason(response.stop_reason),
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      provider: 'anthropic',
    }
  }

  private mapFinishReason(reason: string): CompletionResponse['finishReason'] {
    switch (reason) {
      case 'end_turn':
        return 'stop'
      case 'tool_use':
        return 'tool_calls'
      case 'max_tokens':
        return 'length'
      default:
        return 'stop'
    }
  }

  private async callAPI(request: CompletionRequest): Promise<unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      messages: this.convertMessages(request.messages),
    }

    const system = this.getSystemMessage(request.messages)
    if (system) {
      body.system = system
    }

    if (request.tools?.length) {
      body.tools = this.convertTools(request.tools)
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature
    }
    if (request.topP !== undefined) {
      body.top_p = request.topP
    }
    if (request.stop) {
      body.stop_sequences = request.stop
    }

    const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey!,
        'anthropic-version': '2023-06-01',
        ...this.config.headers,
      },
      body: JSON.stringify(body),
      signal: this.config.timeout ? AbortSignal.timeout(this.config.timeout) : undefined,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Anthropic API error: ${response.status} ${error}`)
    }

    return response.json()
  }

  private async callStreamingAPI(request: CompletionRequest): Promise<ReadableStream<Uint8Array>> {
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      messages: this.convertMessages(request.messages),
      stream: true,
    }

    const system = this.getSystemMessage(request.messages)
    if (system) {
      body.system = system
    }

    if (request.tools?.length) {
      body.tools = this.convertTools(request.tools)
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature
    }

    const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey!,
        'anthropic-version': '2023-06-01',
        ...this.config.headers,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Anthropic API error: ${response.status} ${error}`)
    }

    return response.body!
  }

  private async *parseStreamResponse(stream: ReadableStream<Uint8Array>): AsyncIterable<StreamEvent> {
    yield { type: 'start', data: {}, timestamp: new Date() }

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let accumulated = ''
    const toolCalls: Map<string, { id: string; name: string; arguments: string }> = new Map()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (!data || data === '[DONE]') continue

            try {
              const event = JSON.parse(data)

              if (event.type === 'content_block_delta') {
                const delta = event.delta
                if (delta.type === 'text_delta' && delta.text) {
                  accumulated += delta.text
                  yield {
                    type: 'text-delta',
                    data: { textDelta: delta.text, accumulated },
                    timestamp: new Date(),
                  }
                } else if (delta.type === 'input_json_delta' && delta.partial_json) {
                  const blockId = `block-${event.index}`
                  const tc = toolCalls.get(blockId)
                  if (tc) {
                    tc.arguments += delta.partial_json
                    yield {
                      type: 'tool-call-delta',
                      data: { toolCallId: tc.id, argumentsDelta: delta.partial_json },
                      timestamp: new Date(),
                    }
                  }
                }
              } else if (event.type === 'content_block_start') {
                const block = event.content_block
                if (block.type === 'tool_use') {
                  const blockId = `block-${event.index}`
                  toolCalls.set(blockId, { id: block.id, name: block.name, arguments: '' })
                  yield {
                    type: 'tool-call-start',
                    data: { toolCallId: block.id, toolName: block.name },
                    timestamp: new Date(),
                  }
                }
              } else if (event.type === 'content_block_stop') {
                const blockId = `block-${event.index}`
                const tc = toolCalls.get(blockId)
                if (tc) {
                  yield {
                    type: 'tool-call-end',
                    data: {
                      toolCall: {
                        id: tc.id,
                        name: tc.name,
                        arguments: JSON.parse(tc.arguments || '{}'),
                      },
                    },
                    timestamp: new Date(),
                  }
                }
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    const finalToolCalls = Array.from(toolCalls.values()).map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: JSON.parse(tc.arguments || '{}'),
    }))

    yield {
      type: 'done',
      data: {
        response: {
          id: `stream-${Date.now()}`,
          model: 'claude-sonnet-4-20250514',
          content: accumulated || undefined,
          toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
          finishReason: finalToolCalls.length > 0 ? 'tool_calls' : 'stop',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          provider: 'anthropic',
        },
      },
      timestamp: new Date(),
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createAnthropicProvider(options: AnthropicProviderOptions): AnthropicProvider {
  return new AnthropicProvider(options)
}
