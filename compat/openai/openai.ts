/**
 * @dotdo/openai - OpenAI API Compatibility Layer
 *
 * Drop-in replacement for the official OpenAI SDK with edge compatibility.
 *
 * @example
 * ```typescript
 * import OpenAI from '@dotdo/openai'
 *
 * const client = new OpenAI({ apiKey: 'sk-xxx' })
 *
 * // Chat completions
 * const completion = await client.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello' }],
 * })
 *
 * // Embeddings
 * const embedding = await client.embeddings.create({
 *   model: 'text-embedding-ada-002',
 *   input: 'Hello world',
 * })
 *
 * // Streaming
 * const stream = await client.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello' }],
 *   stream: true,
 * })
 * for await (const chunk of stream) {
 *   console.log(chunk.choices[0]?.delta?.content)
 * }
 * ```
 *
 * @module @dotdo/openai
 */

import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  CreateEmbeddingResponse,
  EmbeddingCreateParams,
  ImageCreateParams,
  ImageEditParams,
  ImageVariationParams,
  ImagesResponse,
  Model,
  ModelListResponse,
  ModelDeleteResponse,
  OpenAIAPIError,
  OpenAIErrorResponse,
  RequestOptions,
} from './types'
import type {
  Assistant,
  Thread,
  Message as AssistantMessage,
  Run,
  RunStep,
  CreateAssistantRequest,
  UpdateAssistantRequest,
  CreateThreadRequest,
  UpdateThreadRequest,
  CreateMessageRequest,
  UpdateMessageRequest,
  CreateRunRequest,
  SubmitToolOutputsRequest,
  ListResponse,
  ListParams,
  ListMessagesParams,
  DeleteResponse,
  CreateThreadAndRunRequest,
} from './assistants'

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_BASE_URL = 'https://api.openai.com'
const DEFAULT_TIMEOUT = 600000 // 10 minutes (OpenAI's default for completions)
const MAX_RETRIES = 2

/**
 * OpenAI client configuration
 */
export interface OpenAIConfig {
  /** OpenAI API key (required) */
  apiKey: string
  /** Organization ID for API requests */
  organization?: string
  /** Base URL for API requests (default: https://api.openai.com) */
  baseURL?: string
  /** Request timeout in milliseconds (default: 600000) */
  timeout?: number
  /** Maximum number of retries (default: 2) */
  maxRetries?: number
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Default headers to include in all requests */
  defaultHeaders?: Record<string, string>
}

// =============================================================================
// OpenAI Error
// =============================================================================

/**
 * OpenAI API Error
 */
export class OpenAIError extends Error {
  status: number
  code?: string
  type: string
  param?: string
  requestId?: string

  constructor(error: OpenAIAPIError, status: number, requestId?: string) {
    super(error.message)
    this.name = 'OpenAIError'
    this.status = status
    this.code = error.code
    this.type = error.type
    this.param = error.param
    this.requestId = requestId
  }
}

// =============================================================================
// Stream Wrapper
// =============================================================================

/**
 * Async iterable wrapper for SSE streams
 */
export class Stream<T> implements AsyncIterable<T> {
  private reader: ReadableStreamDefaultReader<Uint8Array>
  private decoder: TextDecoder
  private buffer: string = ''

  constructor(response: Response) {
    if (!response.body) {
      throw new Error('Response body is null')
    }
    this.reader = response.body.getReader()
    this.decoder = new TextDecoder()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    try {
      while (true) {
        const { done, value } = await this.reader.read()

        if (done) {
          // Process any remaining buffer
          if (this.buffer.trim()) {
            const parsed = this.parseSSELine(this.buffer)
            if (parsed !== null) {
              yield parsed
            }
          }
          break
        }

        this.buffer += this.decoder.decode(value, { stream: true })

        // Process complete lines
        const lines = this.buffer.split('\n')
        this.buffer = lines.pop() ?? ''

        for (const line of lines) {
          const parsed = this.parseSSELine(line)
          if (parsed !== null) {
            yield parsed
          }
        }
      }
    } finally {
      this.reader.releaseLock()
    }
  }

  private parseSSELine(line: string): T | null {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith(':')) {
      return null
    }

    // Check for data prefix
    if (!trimmed.startsWith('data:')) {
      return null
    }

    const data = trimmed.slice(5).trim()

    // Check for stream end
    if (data === '[DONE]') {
      return null
    }

    try {
      return JSON.parse(data) as T
    } catch {
      return null
    }
  }
}

/**
 * Async iterable wrapper for Assistants API SSE streams
 * Parses event: and data: pairs from the SSE stream
 */
export class AssistantStream implements AsyncIterable<AssistantStreamEvent> {
  private reader: ReadableStreamDefaultReader<Uint8Array>
  private decoder: TextDecoder
  private buffer: string = ''

  constructor(response: Response) {
    if (!response.body) {
      throw new Error('Response body is null')
    }
    this.reader = response.body.getReader()
    this.decoder = new TextDecoder()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AssistantStreamEvent> {
    try {
      let currentEvent: string | null = null

      while (true) {
        const { done, value } = await this.reader.read()

        if (done) {
          break
        }

        this.buffer += this.decoder.decode(value, { stream: true })

        // Process complete lines
        const lines = this.buffer.split('\n')
        this.buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()

          // Skip empty lines
          if (!trimmed) {
            continue
          }

          // Check for event prefix
          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim()
            continue
          }

          // Check for data prefix
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim()

            // Check for stream end
            if (dataStr === '[DONE]') {
              continue
            }

            try {
              const data = JSON.parse(dataStr)
              if (currentEvent) {
                yield { event: currentEvent, data }
                currentEvent = null
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      this.reader.releaseLock()
    }
  }
}

// =============================================================================
// Resources
// =============================================================================

/**
 * Base class for OpenAI API resources
 */
abstract class OpenAIResource {
  protected client: OpenAI

  constructor(client: OpenAI) {
    this.client = client
  }
}

/**
 * Chat completions resource
 */
class Completions extends OpenAIResource {
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
  ): Promise<Stream<ChatCompletionChunk>>
  async create(
    params: ChatCompletionCreateParams,
    options?: RequestOptions
  ): Promise<ChatCompletion | Stream<ChatCompletionChunk>>
  async create(
    params: ChatCompletionCreateParams,
    options?: RequestOptions
  ): Promise<ChatCompletion | Stream<ChatCompletionChunk>> {
    if (params.stream) {
      return this.client._requestStream<ChatCompletionChunk>(
        '/v1/chat/completions',
        params,
        options
      )
    }
    return this.client._request<ChatCompletion>(
      '/v1/chat/completions',
      params,
      options
    )
  }
}

/**
 * Chat resource namespace
 */
class Chat extends OpenAIResource {
  readonly completions: Completions

  constructor(client: OpenAI) {
    super(client)
    this.completions = new Completions(client)
  }
}

/**
 * Embeddings resource
 */
class Embeddings extends OpenAIResource {
  /**
   * Create embeddings for text input
   */
  async create(
    params: EmbeddingCreateParams,
    options?: RequestOptions
  ): Promise<CreateEmbeddingResponse> {
    return this.client._request<CreateEmbeddingResponse>(
      '/v1/embeddings',
      params,
      options
    )
  }
}

/**
 * Images resource for DALL-E image generation
 */
class Images extends OpenAIResource {
  /**
   * Generate images from a text prompt
   */
  async generate(
    params: ImageCreateParams,
    options?: RequestOptions
  ): Promise<ImagesResponse> {
    return this.client._request<ImagesResponse>(
      '/v1/images/generations',
      params,
      options
    )
  }

  /**
   * Edit an existing image with a text prompt
   */
  async edit(
    params: ImageEditParams,
    options?: RequestOptions
  ): Promise<ImagesResponse> {
    return this.client._requestMultipart<ImagesResponse>(
      '/v1/images/edits',
      this.buildFormData(params),
      options
    )
  }

  /**
   * Create variations of an existing image
   */
  async createVariation(
    params: ImageVariationParams,
    options?: RequestOptions
  ): Promise<ImagesResponse> {
    return this.client._requestMultipart<ImagesResponse>(
      '/v1/images/variations',
      this.buildFormData(params),
      options
    )
  }

  /**
   * Build FormData for multipart requests
   */
  private buildFormData(params: ImageEditParams | ImageVariationParams): FormData {
    const formData = new FormData()

    // Add image file
    formData.append('image', params.image)

    // Add prompt if it's an edit request
    if ('prompt' in params && params.prompt) {
      formData.append('prompt', params.prompt)
    }

    // Add mask if present (edit only)
    if ('mask' in params && params.mask) {
      formData.append('mask', params.mask)
    }

    // Add optional parameters
    if (params.model) formData.append('model', params.model)
    if (params.n !== undefined) formData.append('n', String(params.n))
    if (params.size) formData.append('size', params.size)
    if (params.response_format) formData.append('response_format', params.response_format)
    if (params.user) formData.append('user', params.user)

    return formData
  }
}

/**
 * Models resource for listing and managing models
 */
class Models extends OpenAIResource {
  /**
   * List all available models
   */
  async list(options?: RequestOptions): Promise<ModelListResponse> {
    return this.client._requestGet<ModelListResponse>('/v1/models', options)
  }

  /**
   * Retrieve a specific model by ID
   */
  async retrieve(model: string, options?: RequestOptions): Promise<Model> {
    return this.client._requestGet<Model>(`/v1/models/${model}`, options)
  }

  /**
   * Delete a fine-tuned model
   */
  async del(model: string, options?: RequestOptions): Promise<ModelDeleteResponse> {
    return this.client._requestDelete<ModelDeleteResponse>(`/v1/models/${model}`, options)
  }
}

// =============================================================================
// Beta Resources (Assistants API)
// =============================================================================

/**
 * Assistants resource for managing AI assistants
 */
class BetaAssistants extends OpenAIResource {
  async create(params: CreateAssistantRequest, options?: RequestOptions): Promise<Assistant> {
    return this.client._request<Assistant>('/v1/assistants', params, options)
  }

  async retrieve(assistantId: string, options?: RequestOptions): Promise<Assistant> {
    return this.client._requestGet<Assistant>(`/v1/assistants/${assistantId}`, options)
  }

  async update(assistantId: string, params: UpdateAssistantRequest, options?: RequestOptions): Promise<Assistant> {
    return this.client._request<Assistant>(`/v1/assistants/${assistantId}`, params, options)
  }

  async del(assistantId: string, options?: RequestOptions): Promise<DeleteResponse> {
    return this.client._requestDelete<DeleteResponse>(`/v1/assistants/${assistantId}`, options)
  }

  async list(params?: ListParams, options?: RequestOptions): Promise<ListResponse<Assistant>> {
    const queryString = params ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()}` : ''
    return this.client._requestGet<ListResponse<Assistant>>(`/v1/assistants${queryString}`, options)
  }
}

/**
 * Threads resource for managing conversation threads
 */
class BetaThreads extends OpenAIResource {
  readonly messages: BetaMessages
  readonly runs: BetaRuns

  constructor(client: OpenAI) {
    super(client)
    this.messages = new BetaMessages(client)
    this.runs = new BetaRuns(client)
  }

  async create(params?: CreateThreadRequest, options?: RequestOptions): Promise<Thread> {
    return this.client._request<Thread>('/v1/threads', params ?? {}, options)
  }

  async retrieve(threadId: string, options?: RequestOptions): Promise<Thread> {
    return this.client._requestGet<Thread>(`/v1/threads/${threadId}`, options)
  }

  async update(threadId: string, params: UpdateThreadRequest, options?: RequestOptions): Promise<Thread> {
    return this.client._request<Thread>(`/v1/threads/${threadId}`, params, options)
  }

  async del(threadId: string, options?: RequestOptions): Promise<DeleteResponse> {
    return this.client._requestDelete<DeleteResponse>(`/v1/threads/${threadId}`, options)
  }

  async createAndRun(params: CreateThreadAndRunRequest, options?: RequestOptions): Promise<Run> {
    return this.client._request<Run>('/v1/threads/runs', params, options)
  }

  async createAndRunPoll(
    params: CreateThreadAndRunRequest,
    pollOptions?: { pollIntervalMs?: number; maxWaitMs?: number },
    options?: RequestOptions
  ): Promise<Run> {
    const run = await this.createAndRun(params, options)
    return this.runs.poll(run.thread_id, run.id, pollOptions, options)
  }

  /**
   * Create a thread and run with streaming
   */
  async createAndRunStream(
    params: CreateThreadAndRunRequest,
    options?: RequestOptions
  ): Promise<AsyncIterable<AssistantStreamEvent>> {
    return this.client._requestAssistantStream(
      '/v1/threads/runs',
      { ...params, stream: true },
      options
    )
  }
}

/**
 * Messages resource for managing thread messages
 */
class BetaMessages extends OpenAIResource {
  async create(threadId: string, params: CreateMessageRequest, options?: RequestOptions): Promise<AssistantMessage> {
    return this.client._request<AssistantMessage>(`/v1/threads/${threadId}/messages`, params, options)
  }

  async retrieve(threadId: string, messageId: string, options?: RequestOptions): Promise<AssistantMessage> {
    return this.client._requestGet<AssistantMessage>(`/v1/threads/${threadId}/messages/${messageId}`, options)
  }

  async update(threadId: string, messageId: string, params: UpdateMessageRequest, options?: RequestOptions): Promise<AssistantMessage> {
    return this.client._request<AssistantMessage>(`/v1/threads/${threadId}/messages/${messageId}`, params, options)
  }

  async del(threadId: string, messageId: string, options?: RequestOptions): Promise<DeleteResponse> {
    return this.client._requestDelete<DeleteResponse>(`/v1/threads/${threadId}/messages/${messageId}`, options)
  }

  async list(threadId: string, params?: ListMessagesParams, options?: RequestOptions): Promise<ListResponse<AssistantMessage>> {
    const queryString = params ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()}` : ''
    return this.client._requestGet<ListResponse<AssistantMessage>>(`/v1/threads/${threadId}/messages${queryString}`, options)
  }
}

/**
 * Assistants streaming event
 */
export interface AssistantStreamEvent {
  event: string
  data: unknown
}

/**
 * Runs resource for managing assistant runs
 */
class BetaRuns extends OpenAIResource {
  readonly steps: BetaRunSteps

  constructor(client: OpenAI) {
    super(client)
    this.steps = new BetaRunSteps(client)
  }

  async create(threadId: string, params: CreateRunRequest, options?: RequestOptions): Promise<Run> {
    return this.client._request<Run>(`/v1/threads/${threadId}/runs`, params, options)
  }

  async retrieve(threadId: string, runId: string, options?: RequestOptions): Promise<Run> {
    return this.client._requestGet<Run>(`/v1/threads/${threadId}/runs/${runId}`, options)
  }

  async update(threadId: string, runId: string, params: { metadata?: Record<string, string> }, options?: RequestOptions): Promise<Run> {
    return this.client._request<Run>(`/v1/threads/${threadId}/runs/${runId}`, params, options)
  }

  async cancel(threadId: string, runId: string, options?: RequestOptions): Promise<Run> {
    return this.client._request<Run>(`/v1/threads/${threadId}/runs/${runId}/cancel`, {}, options)
  }

  async list(threadId: string, params?: ListParams, options?: RequestOptions): Promise<ListResponse<Run>> {
    const queryString = params ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()}` : ''
    return this.client._requestGet<ListResponse<Run>>(`/v1/threads/${threadId}/runs${queryString}`, options)
  }

  async submitToolOutputs(threadId: string, runId: string, params: SubmitToolOutputsRequest, options?: RequestOptions): Promise<Run> {
    return this.client._request<Run>(`/v1/threads/${threadId}/runs/${runId}/submit_tool_outputs`, params, options)
  }

  /**
   * Create a run and stream events
   */
  async stream(
    threadId: string,
    params: CreateRunRequest,
    options?: RequestOptions
  ): Promise<AsyncIterable<AssistantStreamEvent>> {
    return this.client._requestAssistantStream(
      `/v1/threads/${threadId}/runs`,
      { ...params, stream: true },
      options
    )
  }

  /**
   * Submit tool outputs and stream events
   */
  async submitToolOutputsStream(
    threadId: string,
    runId: string,
    params: SubmitToolOutputsRequest,
    options?: RequestOptions
  ): Promise<AsyncIterable<AssistantStreamEvent>> {
    return this.client._requestAssistantStream(
      `/v1/threads/${threadId}/runs/${runId}/submit_tool_outputs`,
      { ...params, stream: true },
      options
    )
  }

  async poll(
    threadId: string,
    runId: string,
    pollOptions?: { pollIntervalMs?: number; maxWaitMs?: number },
    options?: RequestOptions
  ): Promise<Run> {
    const pollInterval = pollOptions?.pollIntervalMs ?? 1000
    const maxWait = pollOptions?.maxWaitMs ?? 300000 // 5 minutes
    const startTime = Date.now()

    while (Date.now() - startTime < maxWait) {
      const run = await this.retrieve(threadId, runId, options)

      if (['completed', 'failed', 'cancelled', 'expired', 'requires_action', 'incomplete'].includes(run.status)) {
        return run
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }

    throw new OpenAIError(
      { type: 'timeout_error', message: 'Run polling timed out' },
      408
    )
  }

  async createAndPoll(
    threadId: string,
    params: CreateRunRequest,
    pollOptions?: { pollIntervalMs?: number; maxWaitMs?: number },
    options?: RequestOptions
  ): Promise<Run> {
    const run = await this.create(threadId, params, options)
    return this.poll(threadId, run.id, pollOptions, options)
  }
}

/**
 * Run steps resource
 */
class BetaRunSteps extends OpenAIResource {
  async retrieve(threadId: string, runId: string, stepId: string, options?: RequestOptions): Promise<RunStep> {
    return this.client._requestGet<RunStep>(`/v1/threads/${threadId}/runs/${runId}/steps/${stepId}`, options)
  }

  async list(threadId: string, runId: string, params?: ListParams, options?: RequestOptions): Promise<ListResponse<RunStep>> {
    const queryString = params ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()}` : ''
    return this.client._requestGet<ListResponse<RunStep>>(`/v1/threads/${threadId}/runs/${runId}/steps${queryString}`, options)
  }
}

/**
 * Beta namespace containing experimental/v2 APIs
 */
class Beta extends OpenAIResource {
  readonly assistants: BetaAssistants
  readonly threads: BetaThreads

  constructor(client: OpenAI) {
    super(client)
    this.assistants = new BetaAssistants(client)
    this.threads = new BetaThreads(client)
  }
}

// =============================================================================
// OpenAI Client
// =============================================================================

/**
 * OpenAI API client
 */
export class OpenAI {
  private apiKey: string
  private organization?: string
  private baseURL: string
  private timeout: number
  private maxRetries: number
  private _fetch: typeof fetch
  private defaultHeaders: Record<string, string>

  // Resources
  readonly chat: Chat
  readonly embeddings: Embeddings
  readonly images: Images
  readonly models: Models
  readonly beta: Beta

  constructor(config: OpenAIConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required')
    }

    this.apiKey = config.apiKey
    this.organization = config.organization
    this.baseURL = (config.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT
    this.maxRetries = config.maxRetries ?? MAX_RETRIES
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)
    this.defaultHeaders = config.defaultHeaders ?? {}

    // Initialize resources
    this.chat = new Chat(this)
    this.embeddings = new Embeddings(this)
    this.images = new Images(this)
    this.models = new Models(this)
    this.beta = new Beta(this)
  }

  /**
   * Make a JSON API request
   * @internal
   */
  async _request<T>(
    path: string,
    body: object,
    options?: RequestOptions
  ): Promise<T> {
    const url = `${this.baseURL}${path}`
    const headers = this.buildHeaders(options?.headers)

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(
          () => controller.abort(),
          options?.timeout ?? this.timeout
        )

        try {
          const response = await this._fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: options?.signal ?? controller.signal,
          })

          const requestId = response.headers.get('x-request-id') ?? undefined

          if (!response.ok) {
            const errorData = (await response.json()) as OpenAIErrorResponse
            throw new OpenAIError(errorData.error, response.status, requestId)
          }

          return (await response.json()) as T
        } finally {
          clearTimeout(timeoutId)
        }
      } catch (error) {
        lastError = error as Error

        // Don't retry client errors (4xx)
        if (error instanceof OpenAIError && error.status >= 400 && error.status < 500) {
          throw error
        }

        // Don't retry abort errors
        if (error instanceof Error && error.name === 'AbortError') {
          throw new OpenAIError(
            { type: 'api_error', message: 'Request timed out' },
            408
          )
        }

        // Retry with exponential backoff
        if (attempt < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000)
          await this.sleep(delay)
        }
      }
    }

    throw lastError ?? new Error('Unknown error')
  }

  /**
   * Make a streaming API request
   * @internal
   */
  async _requestStream<T>(
    path: string,
    body: object,
    options?: RequestOptions
  ): Promise<Stream<T>> {
    const url = `${this.baseURL}${path}`
    const headers = this.buildHeaders(options?.headers)

    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      options?.timeout ?? this.timeout
    )

    try {
      const response = await this._fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options?.signal ?? controller.signal,
      })

      const requestId = response.headers.get('x-request-id') ?? undefined

      if (!response.ok) {
        const errorData = (await response.json()) as OpenAIErrorResponse
        throw new OpenAIError(errorData.error, response.status, requestId)
      }

      return new Stream<T>(response)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Make an Assistants API streaming request
   * @internal
   */
  async _requestAssistantStream(
    path: string,
    body: object,
    options?: RequestOptions
  ): Promise<AsyncIterable<AssistantStreamEvent>> {
    const url = `${this.baseURL}${path}`
    const headers = this.buildHeaders(options?.headers, true) // Add beta header

    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      options?.timeout ?? this.timeout
    )

    try {
      const response = await this._fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options?.signal ?? controller.signal,
      })

      const requestId = response.headers.get('x-request-id') ?? undefined

      if (!response.ok) {
        const errorData = (await response.json()) as OpenAIErrorResponse
        throw new OpenAIError(errorData.error, response.status, requestId)
      }

      return new AssistantStream(response)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Make a GET API request
   * @internal
   */
  async _requestGet<T>(
    path: string,
    options?: RequestOptions
  ): Promise<T> {
    const url = `${this.baseURL}${path}`
    const headers = this.buildHeaders(options?.headers)

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(
          () => controller.abort(),
          options?.timeout ?? this.timeout
        )

        try {
          const response = await this._fetch(url, {
            method: 'GET',
            headers,
            signal: options?.signal ?? controller.signal,
          })

          const requestId = response.headers.get('x-request-id') ?? undefined

          if (!response.ok) {
            const errorData = (await response.json()) as OpenAIErrorResponse
            throw new OpenAIError(errorData.error, response.status, requestId)
          }

          return (await response.json()) as T
        } finally {
          clearTimeout(timeoutId)
        }
      } catch (error) {
        lastError = error as Error

        // Don't retry client errors (4xx)
        if (error instanceof OpenAIError && error.status >= 400 && error.status < 500) {
          throw error
        }

        // Don't retry abort errors
        if (error instanceof Error && error.name === 'AbortError') {
          throw new OpenAIError(
            { type: 'api_error', message: 'Request timed out' },
            408
          )
        }

        // Retry with exponential backoff
        if (attempt < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000)
          await this.sleep(delay)
        }
      }
    }

    throw lastError ?? new Error('Unknown error')
  }

  /**
   * Make a DELETE API request
   * @internal
   */
  async _requestDelete<T>(
    path: string,
    options?: RequestOptions
  ): Promise<T> {
    const url = `${this.baseURL}${path}`
    const headers = this.buildHeaders(options?.headers)

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(
          () => controller.abort(),
          options?.timeout ?? this.timeout
        )

        try {
          const response = await this._fetch(url, {
            method: 'DELETE',
            headers,
            signal: options?.signal ?? controller.signal,
          })

          const requestId = response.headers.get('x-request-id') ?? undefined

          if (!response.ok) {
            const errorData = (await response.json()) as OpenAIErrorResponse
            throw new OpenAIError(errorData.error, response.status, requestId)
          }

          return (await response.json()) as T
        } finally {
          clearTimeout(timeoutId)
        }
      } catch (error) {
        lastError = error as Error

        // Don't retry client errors (4xx)
        if (error instanceof OpenAIError && error.status >= 400 && error.status < 500) {
          throw error
        }

        // Don't retry abort errors
        if (error instanceof Error && error.name === 'AbortError') {
          throw new OpenAIError(
            { type: 'api_error', message: 'Request timed out' },
            408
          )
        }

        // Retry with exponential backoff
        if (attempt < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000)
          await this.sleep(delay)
        }
      }
    }

    throw lastError ?? new Error('Unknown error')
  }

  /**
   * Make a multipart form data API request
   * @internal
   */
  async _requestMultipart<T>(
    path: string,
    formData: FormData,
    options?: RequestOptions
  ): Promise<T> {
    const url = `${this.baseURL}${path}`
    // Don't set Content-Type for FormData - browser/runtime will set it with boundary
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      ...this.defaultHeaders,
      ...options?.headers,
    }

    if (this.organization) {
      headers['OpenAI-Organization'] = this.organization
    }

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(
          () => controller.abort(),
          options?.timeout ?? this.timeout
        )

        try {
          const response = await this._fetch(url, {
            method: 'POST',
            headers,
            body: formData,
            signal: options?.signal ?? controller.signal,
          })

          const requestId = response.headers.get('x-request-id') ?? undefined

          if (!response.ok) {
            const errorData = (await response.json()) as OpenAIErrorResponse
            throw new OpenAIError(errorData.error, response.status, requestId)
          }

          return (await response.json()) as T
        } finally {
          clearTimeout(timeoutId)
        }
      } catch (error) {
        lastError = error as Error

        // Don't retry client errors (4xx)
        if (error instanceof OpenAIError && error.status >= 400 && error.status < 500) {
          throw error
        }

        // Don't retry abort errors
        if (error instanceof Error && error.name === 'AbortError') {
          throw new OpenAIError(
            { type: 'api_error', message: 'Request timed out' },
            408
          )
        }

        // Retry with exponential backoff
        if (attempt < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000)
          await this.sleep(delay)
        }
      }
    }

    throw lastError ?? new Error('Unknown error')
  }

  /**
   * Build request headers
   */
  private buildHeaders(customHeaders?: Record<string, string>, isBeta?: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      ...this.defaultHeaders,
      ...customHeaders,
    }

    if (this.organization) {
      headers['OpenAI-Organization'] = this.organization
    }

    if (isBeta) {
      headers['OpenAI-Beta'] = 'assistants=v2'
    }

    return headers
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export default OpenAI
