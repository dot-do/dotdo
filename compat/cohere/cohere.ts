/**
 * @dotdo/cohere - Cohere API Client Implementation
 *
 * Edge-compatible Cohere API client with support for:
 * - Generate API (text generation)
 * - Chat API (conversational AI with v2 API)
 * - Embed API (text embeddings)
 * - Rerank API (relevance reranking)
 * - Classify API (text classification)
 */

import type {
  CohereClientConfig,
  GenerateRequest,
  GenerateResponse,
  GenerateStreamEvent,
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  EmbedRequest,
  EmbedResponse,
  RerankRequest,
  RerankResponse,
  ClassifyRequest,
  ClassifyResponse,
} from './types'

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BASE_URL = 'https://api.cohere.com'
const DEFAULT_TIMEOUT = 300000 // 5 minutes

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Cohere API Error
 */
export class CohereError extends Error {
  readonly statusCode: number
  readonly body?: unknown

  constructor(message: string, statusCode: number, body?: unknown) {
    super(message)
    this.name = 'CohereError'
    this.statusCode = statusCode
    this.body = body
  }
}

/**
 * Cohere Timeout Error
 */
export class CohereTimeoutError extends CohereError {
  constructor(message: string = 'Request timed out') {
    super(message, 408)
    this.name = 'CohereTimeoutError'
  }
}

// =============================================================================
// Stream Implementation
// =============================================================================

/**
 * Async iterable stream for Cohere responses
 */
class CohereStream<T> implements AsyncIterable<T> {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private decoder = new TextDecoder()
  private buffer = ''

  constructor(private readonly response: Response) {}

  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    if (!this.response.body) {
      throw new CohereError('No response body', 500)
    }

    this.reader = this.response.body.getReader()

    try {
      while (true) {
        const { done, value } = await this.reader.read()
        if (done) break

        this.buffer += this.decoder.decode(value, { stream: true })
        const lines = this.buffer.split('\n')
        this.buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data.trim()) {
              try {
                yield JSON.parse(data) as T
              } catch {
                // Skip malformed JSON
              }
            }
          }
        }
      }

      // Process remaining buffer
      if (this.buffer.trim()) {
        const lines = this.buffer.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data.trim()) {
              try {
                yield JSON.parse(data) as T
              } catch {
                // Skip malformed JSON
              }
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
// Cohere Client
// =============================================================================

/**
 * Cohere API Client
 */
export class CohereClient {
  private readonly token: string
  private readonly baseURL: string
  private readonly timeout: number
  private readonly _fetch: typeof fetch

  constructor(config: CohereClientConfig) {
    if (!config.token) {
      throw new Error('Cohere API token is required')
    }

    this.token = config.token
    this.baseURL = config.baseURL ?? DEFAULT_BASE_URL
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)
  }

  // ===========================================================================
  // Generate API
  // ===========================================================================

  /**
   * Generate text from a prompt
   */
  async generate(params: GenerateRequest): Promise<GenerateResponse> {
    const body = this.buildGenerateBody(params)
    return this.request<GenerateResponse>('POST', '/v1/generate', body)
  }

  /**
   * Generate text with streaming
   */
  async generateStream(params: GenerateRequest): Promise<AsyncIterable<GenerateStreamEvent>> {
    const body = this.buildGenerateBody(params)
    body.stream = true
    const response = await this.rawRequest('POST', '/v1/generate', body)
    return new CohereStream<GenerateStreamEvent>(response)
  }

  private buildGenerateBody(params: GenerateRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      prompt: params.prompt,
    }

    if (params.model) body.model = params.model
    if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens
    if (params.temperature !== undefined) body.temperature = params.temperature
    if (params.numGenerations !== undefined) body.num_generations = params.numGenerations
    if (params.k !== undefined) body.k = params.k
    if (params.p !== undefined) body.p = params.p
    if (params.frequencyPenalty !== undefined) body.frequency_penalty = params.frequencyPenalty
    if (params.presencePenalty !== undefined) body.presence_penalty = params.presencePenalty
    if (params.stopSequences) body.stop_sequences = params.stopSequences
    if (params.endSequences) body.end_sequences = params.endSequences
    if (params.returnLikelihoods) body.return_likelihoods = params.returnLikelihoods
    if (params.truncate) body.truncate = params.truncate
    if (params.seed !== undefined) body.seed = params.seed
    if (params.preset) body.preset = params.preset
    if (params.rawPrompting !== undefined) body.raw_prompting = params.rawPrompting

    return body
  }

  // ===========================================================================
  // Chat API (v2)
  // ===========================================================================

  /**
   * Send a chat message
   */
  async chat(params: ChatRequest): Promise<ChatResponse> {
    const body = this.buildChatBody(params)
    return this.request<ChatResponse>('POST', '/v2/chat', body)
  }

  /**
   * Send a chat message with streaming
   */
  async chatStream(params: ChatRequest): Promise<AsyncIterable<ChatStreamEvent>> {
    const body = this.buildChatBody(params)
    body.stream = true
    const response = await this.rawRequest('POST', '/v2/chat', body)
    return new CohereStream<ChatStreamEvent>(response)
  }

  private buildChatBody(params: ChatRequest): Record<string, unknown> {
    // Build messages array from chat history and current message
    const messages: Array<{ role: string; content: string }> = []

    // Add system message if preamble is provided
    if (params.preamble) {
      messages.push({ role: 'system', content: params.preamble })
    }

    // Add chat history
    if (params.chatHistory) {
      for (const msg of params.chatHistory) {
        const role = msg.role === 'USER' ? 'user' : msg.role === 'CHATBOT' ? 'assistant' : 'system'
        messages.push({ role, content: msg.message })
      }
    }

    // Add current message
    messages.push({ role: 'user', content: params.message })

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
    }

    if (params.conversationId) body.conversation_id = params.conversationId
    if (params.temperature !== undefined) body.temperature = params.temperature
    if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens
    if (params.k !== undefined) body.k = params.k
    if (params.p !== undefined) body.p = params.p
    if (params.frequencyPenalty !== undefined) body.frequency_penalty = params.frequencyPenalty
    if (params.presencePenalty !== undefined) body.presence_penalty = params.presencePenalty
    if (params.stopSequences) body.stop_sequences = params.stopSequences
    if (params.tools) body.tools = params.tools
    if (params.seed !== undefined) body.seed = params.seed

    return body
  }

  // ===========================================================================
  // Embed API (v2)
  // ===========================================================================

  /**
   * Generate embeddings for texts
   */
  async embed(params: EmbedRequest): Promise<EmbedResponse> {
    const body: Record<string, unknown> = {
      texts: params.texts,
      model: params.model,
      input_type: params.inputType,
    }

    if (params.embeddingTypes) body.embedding_types = params.embeddingTypes
    if (params.truncate) body.truncate = params.truncate
    if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens
    if (params.outputDimension !== undefined) body.output_dimension = params.outputDimension

    return this.request<EmbedResponse>('POST', '/v2/embed', body)
  }

  // ===========================================================================
  // Rerank API (v2)
  // ===========================================================================

  /**
   * Rerank documents by relevance to a query
   */
  async rerank(params: RerankRequest): Promise<RerankResponse> {
    const body: Record<string, unknown> = {
      query: params.query,
      documents: params.documents,
      model: params.model,
    }

    if (params.topN !== undefined) body.top_n = params.topN
    if (params.maxTokensPerDoc !== undefined) body.max_tokens_per_doc = params.maxTokensPerDoc

    return this.request<RerankResponse>('POST', '/v2/rerank', body)
  }

  // ===========================================================================
  // Classify API (v1)
  // ===========================================================================

  /**
   * Classify texts
   */
  async classify(params: ClassifyRequest): Promise<ClassifyResponse> {
    const body: Record<string, unknown> = {
      inputs: params.inputs,
    }

    if (params.examples) body.examples = params.examples
    if (params.model) body.model = params.model
    if (params.truncate) body.truncate = params.truncate
    if (params.preset) body.preset = params.preset

    return this.request<ClassifyResponse>('POST', '/v1/classify', body)
  }

  // ===========================================================================
  // Internal HTTP Methods
  // ===========================================================================

  /**
   * Make a raw request and return the response
   */
  private async rawRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<Response> {
    const url = `${this.baseURL}${path}`

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await this._fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      if (!response.ok && !body?.stream) {
        const errorData = await response.json().catch(() => ({}))
        throw new CohereError(
          (errorData as { message?: string }).message ?? `HTTP ${response.status}`,
          response.status,
          errorData
        )
      }

      return response
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CohereTimeoutError()
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Make an API request and parse the response
   */
  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const response = await this.rawRequest(method, path, body)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new CohereError(
        (errorData as { message?: string }).message ?? `HTTP ${response.status}`,
        response.status,
        errorData
      )
    }

    return response.json() as Promise<T>
  }
}
