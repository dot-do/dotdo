/**
 * @dotdo/anthropic - Anthropic API Compatibility Layer
 *
 * Drop-in replacement for @anthropic-ai/sdk with edge compatibility.
 * Provides Messages API, tool use, and streaming support.
 *
 * @example
 * ```typescript
 * import Anthropic from '@dotdo/anthropic'
 *
 * const client = new Anthropic({ apiKey: 'sk-ant-xxx' })
 *
 * // Basic message
 * const message = await client.messages.create({
 *   model: 'claude-3-sonnet-20240229',
 *   max_tokens: 1024,
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * })
 *
 * // Streaming
 * const stream = await client.messages.create({
 *   model: 'claude-3-sonnet-20240229',
 *   max_tokens: 1024,
 *   messages: [{ role: 'user', content: 'Hello!' }],
 *   stream: true,
 * })
 * for await (const event of stream) {
 *   console.log(event)
 * }
 * ```
 *
 * @module @dotdo/anthropic
 */

import type {
  AnthropicConfig,
  Message,
  MessageCreateParams,
  MessageCreateParamsNonStreaming,
  MessageCreateParamsStreaming,
  MessageStream,
  MessageStreamEvent,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  AnthropicErrorResponse,
  AnthropicErrorType,
  ContentBlockStartEvent,
  ContentBlockDeltaEvent,
  MessageStartEvent,
  MessageDeltaEvent,
} from './types'

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BASE_URL = 'https://api.anthropic.com'
const DEFAULT_API_VERSION = '2023-06-01'
const DEFAULT_TIMEOUT = 600000 // 10 minutes
const DEFAULT_MAX_RETRIES = 2

// =============================================================================
// Error Class
// =============================================================================

/**
 * Anthropic API Error
 */
export class AnthropicError extends Error {
  readonly type: AnthropicErrorType
  readonly status: number
  readonly requestId?: string

  constructor(
    type: AnthropicErrorType,
    message: string,
    status: number,
    requestId?: string
  ) {
    super(message)
    this.name = 'AnthropicError'
    this.type = type
    this.status = status
    this.requestId = requestId
  }
}

// =============================================================================
// Message Stream Implementation
// =============================================================================

/**
 * Stream implementation that provides async iteration and helper methods
 */
class MessageStreamImpl implements MessageStream {
  private events: MessageStreamEvent[] = []
  private message: Message | null = null
  private contentBlocks: ContentBlock[] = []
  private inputJsonBuffers: Map<number, string> = new Map()
  private consumed = false
  private iterator: AsyncIterableIterator<MessageStreamEvent>

  constructor(
    private readonly response: Response
  ) {
    this.iterator = this.createIterator()
  }

  private async *createIterator(): AsyncIterableIterator<MessageStreamEvent> {
    if (!this.response.body) {
      throw new AnthropicError('api_error', 'No response body', 500)
    }

    const reader = this.response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let currentEvent = ''
        let currentData = ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6)
          } else if (line === '' && currentEvent && currentData) {
            try {
              const event = JSON.parse(currentData) as MessageStreamEvent
              this.processEvent(event)
              this.events.push(event)
              yield event
            } catch {
              // Skip malformed events
            }
            currentEvent = ''
            currentData = ''
          }
        }
      }
    } finally {
      reader.releaseLock()
      this.consumed = true
    }
  }

  private processEvent(event: MessageStreamEvent): void {
    switch (event.type) {
      case 'message_start':
        this.message = { ...event.message }
        break

      case 'content_block_start': {
        const startEvent = event as ContentBlockStartEvent
        if (startEvent.content_block.type === 'text') {
          this.contentBlocks[startEvent.index] = { type: 'text', text: '' }
        } else if (startEvent.content_block.type === 'tool_use') {
          this.contentBlocks[startEvent.index] = {
            type: 'tool_use',
            id: startEvent.content_block.id,
            name: startEvent.content_block.name,
            input: {},
          }
          this.inputJsonBuffers.set(startEvent.index, '')
        }
        break
      }

      case 'content_block_delta': {
        const deltaEvent = event as ContentBlockDeltaEvent
        const block = this.contentBlocks[deltaEvent.index]
        if (block) {
          if (deltaEvent.delta.type === 'text_delta' && block.type === 'text') {
            (block as TextBlock).text += deltaEvent.delta.text
          } else if (deltaEvent.delta.type === 'input_json_delta' && block.type === 'tool_use') {
            const buffer = this.inputJsonBuffers.get(deltaEvent.index) || ''
            this.inputJsonBuffers.set(deltaEvent.index, buffer + deltaEvent.delta.partial_json)
          }
        }
        break
      }

      case 'content_block_stop': {
        const block = this.contentBlocks[event.index]
        if (block?.type === 'tool_use') {
          const jsonBuffer = this.inputJsonBuffers.get(event.index)
          if (jsonBuffer) {
            try {
              (block as ToolUseBlock).input = JSON.parse(jsonBuffer)
            } catch {
              // Keep empty input if parsing fails
            }
          }
        }
        break
      }

      case 'message_delta': {
        const msgDelta = event as MessageDeltaEvent
        if (this.message) {
          this.message.stop_reason = msgDelta.delta.stop_reason
          this.message.stop_sequence = msgDelta.delta.stop_sequence
          this.message.usage.output_tokens = msgDelta.usage.output_tokens
        }
        break
      }
    }
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<MessageStreamEvent> {
    return this.iterator
  }

  getText(): string {
    return this.contentBlocks
      .filter((block): block is TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
  }

  getFinalMessage(): Message {
    if (!this.message) {
      throw new AnthropicError('api_error', 'No message received', 500)
    }

    return {
      ...this.message,
      content: this.contentBlocks.filter((block) => block !== undefined),
    }
  }
}

// =============================================================================
// Messages Resource
// =============================================================================

/**
 * Messages resource for creating messages
 */
class MessagesResource {
  constructor(private readonly client: Anthropic) {}

  /**
   * Create a message (non-streaming)
   */
  async create(params: MessageCreateParamsNonStreaming): Promise<Message>
  /**
   * Create a message (streaming)
   */
  async create(params: MessageCreateParamsStreaming): Promise<MessageStream>
  /**
   * Create a message
   */
  async create(params: MessageCreateParams): Promise<Message | MessageStream>
  async create(params: MessageCreateParams): Promise<Message | MessageStream> {
    if (params.stream) {
      return this.createStream(params)
    }
    return this.createNonStreaming(params)
  }

  private async createNonStreaming(params: MessageCreateParams): Promise<Message> {
    const response = await this.client._request<Message>('POST', '/v1/messages', params)
    return response
  }

  private async createStream(params: MessageCreateParams): Promise<MessageStream> {
    const response = await this.client._rawRequest('POST', '/v1/messages', params)
    return new MessageStreamImpl(response)
  }
}

// =============================================================================
// Main Anthropic Client
// =============================================================================

/**
 * Anthropic client for API interactions
 */
export class Anthropic {
  private readonly apiKey: string
  private readonly baseURL: string
  private readonly timeout: number
  private readonly maxRetries: number
  private readonly defaultHeaders: Record<string, string>
  private readonly apiVersion: string
  private readonly _fetch: typeof fetch

  /** Messages API resource */
  readonly messages: MessagesResource

  constructor(config: AnthropicConfig) {
    if (!config.apiKey) {
      throw new Error('Anthropic API key is required')
    }

    this.apiKey = config.apiKey
    this.baseURL = config.baseURL ?? DEFAULT_BASE_URL
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES
    this.defaultHeaders = config.defaultHeaders ?? {}
    this.apiVersion = config.apiVersion ?? DEFAULT_API_VERSION
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)

    // Initialize resources
    this.messages = new MessagesResource(this)
  }

  /**
   * Make a raw API request and return the response
   * @internal
   */
  async _rawRequest(
    method: 'POST',
    path: string,
    body?: Record<string, unknown>
  ): Promise<Response> {
    const url = `${this.baseURL}${path}`

    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      'anthropic-version': this.apiVersion,
      'content-type': 'application/json',
      ...this.defaultHeaders,
    }

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.timeout)

        try {
          const response = await this._fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
          })

          // For streaming requests, return the response directly
          if (body?.stream) {
            if (!response.ok) {
              const errorData = await response.json() as AnthropicErrorResponse
              throw new AnthropicError(
                errorData.error.type,
                errorData.error.message,
                response.status,
                response.headers.get('request-id') ?? undefined
              )
            }
            return response
          }

          return response
        } finally {
          clearTimeout(timeoutId)
        }
      } catch (error) {
        lastError = error as Error

        // Don't retry client errors
        if (error instanceof AnthropicError && error.status >= 400 && error.status < 500) {
          throw error
        }

        // Don't retry abort errors
        if (error instanceof Error && error.name === 'AbortError') {
          throw new AnthropicError('api_error', 'Request timed out', 408)
        }

        // Retry with exponential backoff
        if (attempt < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000)
          await sleep(delay)
        }
      }
    }

    throw lastError ?? new Error('Unknown error')
  }

  /**
   * Make an API request
   * @internal
   */
  async _request<T>(
    method: 'POST',
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const response = await this._rawRequest(method, path, body)

    const data = await response.json()

    if (!response.ok) {
      const errorData = data as AnthropicErrorResponse
      throw new AnthropicError(
        errorData.error.type,
        errorData.error.message,
        response.status,
        response.headers.get('request-id') ?? undefined
      )
    }

    return data as T
  }
}

// =============================================================================
// Utilities
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// =============================================================================
// Exports
// =============================================================================

export default Anthropic
