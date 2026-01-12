/**
 * OpenAI Provider - OpenAI API adapter
 *
 * Implements the LLMProvider interface for OpenAI models.
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
// OpenAI Model Registry
// ============================================================================

const OPENAI_MODELS: ModelConfig[] = [
  {
    model: 'gpt-4o',
    provider: 'openai',
    maxContextTokens: 128000,
    maxOutputTokens: 16384,
    inputCostPer1k: 0.0025,
    outputCostPer1k: 0.01,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  {
    model: 'gpt-4o-mini',
    provider: 'openai',
    maxContextTokens: 128000,
    maxOutputTokens: 16384,
    inputCostPer1k: 0.00015,
    outputCostPer1k: 0.0006,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  {
    model: 'gpt-4-turbo',
    provider: 'openai',
    maxContextTokens: 128000,
    maxOutputTokens: 4096,
    inputCostPer1k: 0.01,
    outputCostPer1k: 0.03,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  {
    model: 'gpt-4',
    provider: 'openai',
    maxContextTokens: 8192,
    maxOutputTokens: 8192,
    inputCostPer1k: 0.03,
    outputCostPer1k: 0.06,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  {
    model: 'gpt-3.5-turbo',
    provider: 'openai',
    maxContextTokens: 16385,
    maxOutputTokens: 4096,
    inputCostPer1k: 0.0005,
    outputCostPer1k: 0.0015,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  {
    model: 'o1',
    provider: 'openai',
    maxContextTokens: 200000,
    maxOutputTokens: 100000,
    inputCostPer1k: 0.015,
    outputCostPer1k: 0.06,
    supportsTools: false,
    supportsVision: true,
    supportsStreaming: true,
  },
  {
    model: 'o1-mini',
    provider: 'openai',
    maxContextTokens: 128000,
    maxOutputTokens: 65536,
    inputCostPer1k: 0.003,
    outputCostPer1k: 0.012,
    supportsTools: false,
    supportsVision: true,
    supportsStreaming: true,
  },
]

// ============================================================================
// OpenAI Provider Implementation
// ============================================================================

export interface OpenAIProviderOptions extends Omit<ProviderConfig, 'name'> {
  apiKey: string
  organization?: string
  baseUrl?: string
  defaultModel?: string
  timeout?: number
  options?: {
    mockResponse?: CompletionResponse
    mockStreamEvents?: StreamEvent[]
  }
}

export class OpenAIProvider extends BaseProvider {
  private mockResponse?: CompletionResponse
  private mockStreamEvents?: StreamEvent[]

  constructor(options: OpenAIProviderOptions) {
    super({
      name: 'openai',
      apiKey: options.apiKey,
      organization: options.organization,
      baseUrl: options.baseUrl ?? 'https://api.openai.com/v1',
      defaultModel: options.defaultModel ?? 'gpt-4o',
      timeout: options.timeout,
      headers: options.headers,
      options: options.options,
    })
    this.mockResponse = options.options?.mockResponse
    this.mockStreamEvents = options.options?.mockStreamEvents
  }

  supportsModel(model: string): boolean {
    return OPENAI_MODELS.some((m) => m.model === model) || model.startsWith('gpt-') || model.startsWith('o1')
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
    // Use tiktoken approximation
    // In production, use the actual tiktoken library
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
    // Final assistant message overhead
    total += 2
    return total
  }

  async listModels(): Promise<ModelConfig[]> {
    return OPENAI_MODELS
  }

  // ============================================================================
  // Private Implementation
  // ============================================================================

  protected convertMessages(messages: Message[]): unknown[] {
    return messages.map((msg) => {
      switch (msg.role) {
        case 'system':
          return { role: 'system', content: msg.content }
        case 'user':
          if (typeof msg.content === 'string') {
            return { role: 'user', content: msg.content }
          }
          // Handle multimodal content
          return {
            role: 'user',
            content: msg.content.map((part) => {
              if (part.type === 'text') {
                return { type: 'text', text: part.text }
              }
              if (part.type === 'image') {
                return {
                  type: 'image_url',
                  image_url: { url: part.url ?? `data:${part.mimeType};base64,${part.data}` },
                }
              }
              return part
            }),
          }
        case 'assistant':
          const content: unknown[] = []
          if (msg.content) {
            content.push({ type: 'text', text: msg.content })
          }
          return {
            role: 'assistant',
            content: msg.content ?? null,
            tool_calls: msg.toolCalls?.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          }
        case 'tool':
          return {
            role: 'tool',
            tool_call_id: msg.toolCallId,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          }
        default:
          return msg
      }
    })
  }

  private convertTools(tools: ToolDefinition[]): unknown[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }))
  }

  protected parseResponse(raw: unknown): CompletionResponse {
    const response = raw as {
      id: string
      model: string
      choices: Array<{
        message: {
          role: string
          content: string | null
          tool_calls?: Array<{
            id: string
            function: { name: string; arguments: string }
          }>
        }
        finish_reason: string
      }>
      usage: {
        prompt_tokens: number
        completion_tokens: number
        total_tokens: number
      }
    }

    const choice = response.choices[0]
    const message = choice.message

    const toolCalls: ToolCall[] | undefined = message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }))

    return {
      id: response.id,
      model: response.model,
      content: message.content ?? undefined,
      toolCalls,
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      },
      provider: 'openai',
    }
  }

  private mapFinishReason(reason: string): CompletionResponse['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop'
      case 'tool_calls':
        return 'tool_calls'
      case 'length':
        return 'length'
      case 'content_filter':
        return 'content_filter'
      default:
        return 'stop'
    }
  }

  private async callAPI(request: CompletionRequest): Promise<unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: this.convertMessages(request.messages),
    }

    if (request.tools?.length) {
      body.tools = this.convertTools(request.tools)
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens
    }
    if (request.topP !== undefined) {
      body.top_p = request.topP
    }
    if (request.stop) {
      body.stop = request.stop
    }
    if (request.responseFormat === 'json_object') {
      body.response_format = { type: 'json_object' }
    } else if (request.responseFormat === 'json_schema' && request.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          schema: request.jsonSchema,
          strict: true,
        },
      }
    }

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
        ...(this.config.organization && { 'OpenAI-Organization': this.config.organization }),
        ...this.config.headers,
      },
      body: JSON.stringify(body),
      signal: this.config.timeout ? AbortSignal.timeout(this.config.timeout) : undefined,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} ${error}`)
    }

    return response.json()
  }

  private async callStreamingAPI(request: CompletionRequest): Promise<ReadableStream<Uint8Array>> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: this.convertMessages(request.messages),
      stream: true,
    }

    if (request.tools?.length) {
      body.tools = this.convertTools(request.tools)
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens
    }

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
        ...(this.config.organization && { 'OpenAI-Organization': this.config.organization }),
        ...this.config.headers,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} ${error}`)
    }

    return response.body!
  }

  private async *parseStreamResponse(stream: ReadableStream<Uint8Array>): AsyncIterable<StreamEvent> {
    yield { type: 'start', data: {}, timestamp: new Date() }

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let accumulated = ''
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map()

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
            if (data === '[DONE]') continue

            try {
              const chunk = JSON.parse(data)
              const delta = chunk.choices?.[0]?.delta

              if (delta?.content) {
                accumulated += delta.content
                yield {
                  type: 'text-delta',
                  data: { textDelta: delta.content, accumulated },
                  timestamp: new Date(),
                }
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const existing = toolCalls.get(tc.index) ?? { id: '', name: '', arguments: '' }
                  if (tc.id) existing.id = tc.id
                  if (tc.function?.name) {
                    existing.name = tc.function.name
                    yield {
                      type: 'tool-call-start',
                      data: { toolCallId: existing.id, toolName: existing.name },
                      timestamp: new Date(),
                    }
                  }
                  if (tc.function?.arguments) {
                    existing.arguments += tc.function.arguments
                    yield {
                      type: 'tool-call-delta',
                      data: { toolCallId: existing.id, argumentsDelta: tc.function.arguments },
                      timestamp: new Date(),
                    }
                  }
                  toolCalls.set(tc.index, existing)
                }
              }

              // Check for finish reason to emit tool-call-end events
              if (chunk.choices?.[0]?.finish_reason === 'tool_calls') {
                for (const [, tc] of toolCalls) {
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
          model: 'gpt-4o',
          content: accumulated || undefined,
          toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
          finishReason: finalToolCalls.length > 0 ? 'tool_calls' : 'stop',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          provider: 'openai',
        },
      },
      timestamp: new Date(),
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createOpenAIProvider(options: OpenAIProviderOptions): OpenAIProvider {
  return new OpenAIProvider(options)
}
