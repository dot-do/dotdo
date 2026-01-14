/**
 * @dotdo/openai - AgentRuntime Backend Integration
 *
 * This module provides an OpenAI-compatible client that routes requests
 * through the AgentRuntime primitive, enabling:
 * - Multi-provider support (OpenAI, Anthropic, etc.)
 * - Automatic failover between providers
 * - Cost optimization routing
 * - Usage tracking and statistics
 *
 * @example
 * ```typescript
 * import { createOpenAIWithRuntime } from '@dotdo/openai/agent-runtime'
 *
 * const client = createOpenAIWithRuntime({
 *   providers: [
 *     { name: 'openai', apiKey: process.env.OPENAI_API_KEY },
 *     { name: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
 *   ],
 *   fallback: { enabled: true },
 * })
 *
 * // Works exactly like the standard OpenAI client
 * const completion = await client.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello' }],
 * })
 * ```
 *
 * @module @dotdo/openai/agent-runtime
 */

import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionMessage,
  CreateEmbeddingResponse,
  EmbeddingCreateParams,
  RequestOptions,
} from './types'

// Import from router/runtime files directly to avoid index.ts export issues
import { createLLMRouter, type LLMRouter } from '../../db/primitives/agent-runtime/router'
import { createAgentRuntime, type AgentRuntime } from '../../db/primitives/agent-runtime/runtime'
import type {
  RouterConfig,
  ProviderConfig,
  CompletionRequest,
  CompletionResponse,
  Message,
  StreamEvent,
  ContentPart as RuntimeContentPart,
} from '../../db/primitives/agent-runtime/types'

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for AgentRuntime-backed OpenAI client
 */
export interface AgentRuntimeOpenAIConfig {
  /** Provider configurations */
  providers: ProviderConfig[]
  /** Default model to use */
  defaultModel?: string
  /** Routing strategy */
  strategy?: 'priority' | 'round-robin' | 'least-latency' | 'cost-optimized'
  /** Fallback configuration */
  fallback?: {
    enabled: boolean
    maxAttempts?: number
  }
  /** System instructions (optional) */
  instructions?: string
}

// =============================================================================
// Message Conversion
// =============================================================================

/**
 * Convert OpenAI content parts to AgentRuntime content parts
 */
function convertContentParts(
  content: string | ChatCompletionCreateParams['messages'][0]['content']
): string | RuntimeContentPart[] {
  if (typeof content === 'string') {
    return content
  }
  if (!content) {
    return ''
  }
  // Map OpenAI content parts to runtime format
  return (content as Array<{ type: string; text?: string; image_url?: { url: string } }>).map((part) => {
    if (part.type === 'text') {
      return { type: 'text' as const, text: part.text ?? '' }
    }
    if (part.type === 'image_url') {
      return { type: 'image' as const, url: part.image_url?.url ?? '' }
    }
    return { type: 'text' as const, text: '' }
  })
}

/**
 * Convert OpenAI messages to AgentRuntime messages
 */
function convertToRuntimeMessages(
  messages: ChatCompletionCreateParams['messages']
): Message[] {
  return messages.map((msg): Message => {
    switch (msg.role) {
      case 'system':
        return {
          role: 'system' as const,
          content: msg.content,
        }
      case 'user':
        return {
          role: 'user' as const,
          content: convertContentParts(msg.content),
        }
      case 'assistant':
        return {
          role: 'assistant' as const,
          content: typeof msg.content === 'string' ? msg.content : undefined,
          toolCalls: msg.tool_calls?.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
          })),
        }
      case 'tool':
        return {
          role: 'tool' as const,
          toolCallId: msg.tool_call_id,
          toolName: '',
          content: msg.content,
        }
      default:
        return {
          role: 'user' as const,
          content: String((msg as { content?: unknown }).content ?? ''),
        }
    }
  })
}

/**
 * Convert AgentRuntime response to OpenAI format
 */
function convertToOpenAIResponse(
  response: CompletionResponse,
  requestId: string
): ChatCompletion {
  const message: ChatCompletionMessage = {
    role: 'assistant',
    content: response.content ?? null,
    tool_calls: response.toolCalls?.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
    })),
  }

  return {
    id: requestId,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: response.finishReason === 'tool_calls' ? 'tool_calls' : 'stop',
      },
    ],
    usage: {
      prompt_tokens: response.usage.promptTokens,
      completion_tokens: response.usage.completionTokens,
      total_tokens: response.usage.totalTokens,
    },
  }
}

// =============================================================================
// AgentRuntime-backed OpenAI Client
// =============================================================================

/**
 * Chat completions resource backed by AgentRuntime
 */
class RuntimeCompletions {
  constructor(private router: LLMRouter, private defaultModel: string) {}

  /**
   * Create a chat completion
   */
  async create(
    params: ChatCompletionCreateParams & { stream?: false },
    options?: RequestOptions
  ): Promise<ChatCompletion>
  async create(
    params: ChatCompletionCreateParams & { stream: true },
    options?: RequestOptions
  ): Promise<AsyncIterable<ChatCompletionChunk>>
  async create(
    params: ChatCompletionCreateParams,
    options?: RequestOptions
  ): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>>
  async create(
    params: ChatCompletionCreateParams,
    _options?: RequestOptions
  ): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
    const request: CompletionRequest = {
      model: params.model || this.defaultModel,
      messages: convertToRuntimeMessages(params.messages),
      temperature: params.temperature,
      maxTokens: params.max_tokens,
      topP: params.top_p,
      stop: params.stop ? (Array.isArray(params.stop) ? params.stop : [params.stop]) : undefined,
      responseFormat: params.response_format?.type === 'json_object' ? 'json_object' : 'text',
      tools: params.tools?.map((t) => ({
        name: t.function.name,
        description: t.function.description ?? '',
        inputSchema: {
          type: 'object' as const,
          ...t.function.parameters,
        },
        execute: async () => ({}), // Placeholder - actual execution handled by caller
      })),
    }

    if (params.stream) {
      return this.streamResponse(request)
    }

    const response = await this.router.complete(request)
    return convertToOpenAIResponse(response, `chatcmpl-${Date.now()}`)
  }

  /**
   * Stream response as async iterable
   */
  private async *streamResponse(
    request: CompletionRequest
  ): AsyncIterable<ChatCompletionChunk> {
    const baseId = `chatcmpl-${Date.now()}`
    const created = Math.floor(Date.now() / 1000)

    for await (const event of this.router.stream(request)) {
      if (event.type === 'text-delta') {
        const data = event.data as { textDelta: string }
        yield {
          id: baseId,
          object: 'chat.completion.chunk',
          created,
          model: request.model,
          choices: [
            {
              index: 0,
              delta: { content: data.textDelta },
              finish_reason: null,
            },
          ],
        }
      } else if (event.type === 'tool-call-start') {
        const data = event.data as { toolCallId: string; toolName: string }
        yield {
          id: baseId,
          object: 'chat.completion.chunk',
          created,
          model: request.model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: data.toolCallId,
                    type: 'function',
                    function: { name: data.toolName, arguments: '' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }
      } else if (event.type === 'tool-call-delta') {
        const data = event.data as { toolCallId: string; argumentsDelta: string }
        yield {
          id: baseId,
          object: 'chat.completion.chunk',
          created,
          model: request.model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: data.argumentsDelta },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }
      } else if (event.type === 'done') {
        const data = event.data as { response: CompletionResponse }
        yield {
          id: baseId,
          object: 'chat.completion.chunk',
          created,
          model: request.model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: data.response.finishReason === 'tool_calls' ? 'tool_calls' : 'stop',
            },
          ],
        }
      }
    }
  }
}

/**
 * Chat resource backed by AgentRuntime
 */
class RuntimeChat {
  readonly completions: RuntimeCompletions

  constructor(router: LLMRouter, defaultModel: string) {
    this.completions = new RuntimeCompletions(router, defaultModel)
  }
}

/**
 * Embeddings resource - passthrough to OpenAI
 * (AgentRuntime doesn't handle embeddings directly)
 */
class RuntimeEmbeddings {
  constructor(
    private openaiKey: string,
    private baseUrl: string = 'https://api.openai.com'
  ) {}

  async create(
    params: EmbeddingCreateParams,
    _options?: RequestOptions
  ): Promise<CreateEmbeddingResponse> {
    const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.openaiKey}`,
      },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`Embeddings API error: ${error.error?.message ?? 'Unknown error'}`)
    }

    return response.json()
  }
}

/**
 * OpenAI-compatible client backed by AgentRuntime
 */
export class OpenAIWithRuntime {
  private router: LLMRouter
  private defaultModel: string

  readonly chat: RuntimeChat
  readonly embeddings: RuntimeEmbeddings

  constructor(config: AgentRuntimeOpenAIConfig) {
    if (!config.providers || config.providers.length === 0) {
      throw new Error('At least one provider is required')
    }

    this.defaultModel = config.defaultModel ?? 'gpt-4o'

    const routerConfig: RouterConfig = {
      providers: config.providers,
      strategy: config.strategy ?? 'priority',
      fallback: config.fallback,
    }

    this.router = createLLMRouter(routerConfig)

    this.chat = new RuntimeChat(this.router, this.defaultModel)

    // Find OpenAI provider for embeddings
    const openaiProvider = config.providers.find((p) => p.name === 'openai')
    this.embeddings = new RuntimeEmbeddings(
      openaiProvider?.apiKey ?? '',
      openaiProvider?.baseUrl
    )
  }

  /**
   * Get router statistics
   */
  getStats() {
    return this.router.getStats()
  }

  /**
   * Reset router statistics
   */
  resetStats() {
    this.router.resetStats()
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an OpenAI-compatible client backed by AgentRuntime
 *
 * @example
 * ```typescript
 * const client = createOpenAIWithRuntime({
 *   providers: [
 *     { name: 'openai', apiKey: process.env.OPENAI_API_KEY },
 *     { name: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY },
 *   ],
 *   fallback: { enabled: true },
 * })
 *
 * const completion = await client.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello' }],
 * })
 * ```
 */
export function createOpenAIWithRuntime(
  config: AgentRuntimeOpenAIConfig
): OpenAIWithRuntime {
  return new OpenAIWithRuntime(config)
}

export default createOpenAIWithRuntime
