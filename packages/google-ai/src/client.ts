/**
 * @dotdo/google-ai - Google Generative AI Compatibility Layer
 *
 * Drop-in replacement for @google/generative-ai with edge compatibility.
 * Runs on Cloudflare Workers, Deno, Bun, and Node.js.
 *
 * @example
 * ```typescript
 * import { GoogleGenerativeAI } from '@dotdo/google-ai'
 *
 * const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY)
 *
 * // Generate content
 * const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
 * const result = await model.generateContent('Write a story about a robot')
 * console.log(result.response.text())
 *
 * // Chat
 * const chat = model.startChat({
 *   history: [
 *     { role: 'user', parts: [{ text: 'Hello' }] },
 *     { role: 'model', parts: [{ text: 'Hi! How can I help?' }] },
 *   ],
 * })
 * const response = await chat.sendMessage('What is 2+2?')
 *
 * // Streaming
 * const streamResult = await model.generateContentStream('Tell me a joke')
 * for await (const chunk of streamResult.stream) {
 *   console.log(chunk.text())
 * }
 * ```
 *
 * @module @dotdo/google-ai
 */

import type {
  Content,
  Part,
  TextPart,
  FunctionCallPart,
  FunctionResponsePart,
  GenerationConfig,
  SafetySetting,
  Tool,
  ToolConfig,
  ModelParams,
  StartChatParams,
  GenerateContentRequest,
  GenerateContentResult,
  GenerateContentResponse,
  GenerateContentStreamResult,
  EmbedContentResult,
  EmbedContentRequest,
  BatchEmbedContentsResult,
  CountTokensResult,
  Candidate,
  GoogleAIErrorResponse,
  RequestOptions,
} from './types'

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_TIMEOUT = 60000 // 60 seconds

/**
 * GoogleGenerativeAI client configuration
 */
export interface GoogleGenerativeAIConfig {
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Base URL for API requests */
  baseURL?: string
  /** Request timeout in milliseconds */
  timeout?: number
}

// =============================================================================
// Google Generative AI Error
// =============================================================================

/**
 * Google AI API Error
 */
export class GoogleGenerativeAIError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'GoogleGenerativeAIError'
    this.status = status
    this.code = code ?? 'UNKNOWN'
  }
}

// =============================================================================
// Stream Wrapper
// =============================================================================

/**
 * Helper to extract text from a partial response
 */
function extractTextFromResponse(response: Omit<GenerateContentResponse, 'text'>): string {
  const parts = response.candidates?.[0]?.content?.parts ?? []
  return parts
    .filter((p): p is TextPart => 'text' in p)
    .map((p) => p.text)
    .join('')
}

/**
 * Async iterable wrapper for SSE streams with response aggregation
 */
class GenerativeContentStream {
  private chunks: GenerateContentResponse[] = []
  private aggregatedText: string = ''
  private responsePromise: Promise<GenerateContentResponse>
  private resolveResponse!: (value: GenerateContentResponse) => void
  private streamIterable: AsyncIterable<GenerateContentResponse>

  constructor(response: Response) {
    if (!response.body) {
      throw new Error('Response body is null')
    }

    // Create a promise that will be resolved when stream completes
    this.responsePromise = new Promise((resolve) => {
      this.resolveResponse = resolve
    })

    // Parse the SSE stream
    this.streamIterable = this.createStream(response)
  }

  private async *createStream(response: Response): AsyncIterable<GenerateContentResponse> {
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          // Process any remaining buffer
          if (buffer.trim()) {
            const parsed = this.parseSSELine(buffer)
            if (parsed !== null) {
              this.chunks.push(parsed)
              const text = parsed.text()
              if (text) this.aggregatedText += text
              yield parsed
            }
          }
          break
        }

        buffer += decoder.decode(value, { stream: true })

        // Process complete lines
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const parsed = this.parseSSELine(line)
          if (parsed !== null) {
            this.chunks.push(parsed)
            const text = parsed.text()
            if (text) this.aggregatedText += text
            yield parsed
          }
        }
      }
    } finally {
      reader.releaseLock()
      // Resolve the response promise when stream completes
      this.resolveResponse(this.getAggregatedResponse())
    }
  }

  private parseSSELine(line: string): GenerateContentResponse | null {
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
      const parsed = JSON.parse(data) as Omit<GenerateContentResponse, 'text'>
      return {
        ...parsed,
        text: () => extractTextFromResponse(parsed),
      }
    } catch {
      return null
    }
  }

  getAggregatedResponse(): GenerateContentResponse {
    const lastChunk = this.chunks[this.chunks.length - 1]
    return {
      candidates: lastChunk?.candidates,
      usageMetadata: lastChunk?.usageMetadata,
      text: () => this.aggregatedText,
    }
  }

  get stream(): AsyncIterable<GenerateContentResponse> {
    return this.streamIterable
  }

  get response(): Promise<GenerateContentResponse> {
    return this.responsePromise
  }
}

// =============================================================================
// Chat Session
// =============================================================================

/**
 * Chat session for multi-turn conversations
 */
export class ChatSession {
  private model: GenerativeModel
  private _history: Content[]
  private generationConfig?: GenerationConfig
  private safetySettings?: SafetySetting[]

  constructor(
    model: GenerativeModel,
    params?: StartChatParams
  ) {
    this.model = model
    this._history = params?.history ? [...params.history] : []
    this.generationConfig = params?.generationConfig
    this.safetySettings = params?.safetySettings
  }

  /**
   * Send a message and get a response
   */
  async sendMessage(
    message: string | Part[]
  ): Promise<GenerateContentResult> {
    const userContent: Content = {
      role: 'user',
      parts: typeof message === 'string' ? [{ text: message }] : message,
    }

    const contents = [...this._history, userContent]

    const result = await this.model.generateContent({
      contents,
      generationConfig: this.generationConfig,
      safetySettings: this.safetySettings,
    })

    // Add user message and model response to history
    this._history.push(userContent)
    if (result.response.candidates?.[0]?.content) {
      this._history.push(result.response.candidates[0].content)
    }

    return result
  }

  /**
   * Send a message and get a streaming response
   */
  async sendMessageStream(
    message: string | Part[]
  ): Promise<GenerateContentStreamResult> {
    const userContent: Content = {
      role: 'user',
      parts: typeof message === 'string' ? [{ text: message }] : message,
    }

    const contents = [...this._history, userContent]

    const result = await this.model.generateContentStream({
      contents,
      generationConfig: this.generationConfig,
      safetySettings: this.safetySettings,
    })

    // Add user message to history
    this._history.push(userContent)

    // Wrap stream to capture response for history
    const originalStream = result.stream
    const history = this._history
    const wrappedStream = (async function* () {
      let lastContent: Content | null = null
      for await (const chunk of originalStream) {
        if (chunk.candidates?.[0]?.content) {
          lastContent = chunk.candidates[0].content
        }
        yield chunk
      }
      if (lastContent) {
        history.push(lastContent)
      }
    })()

    // Create a response promise that resolves after the wrapped stream
    const responsePromise = (async () => {
      const response = await result.response
      return response
    })()

    return {
      stream: wrappedStream,
      response: responsePromise,
    }
  }

  /**
   * Get conversation history
   */
  getHistory(): Content[] {
    return [...this._history]
  }
}

// =============================================================================
// Generative Model
// =============================================================================

/**
 * Generative model for content generation
 */
export class GenerativeModel {
  private client: GoogleGenerativeAI
  private modelName: string
  private generationConfig?: GenerationConfig
  private safetySettings?: SafetySetting[]
  private tools?: Tool[]
  private toolConfig?: ToolConfig

  constructor(
    client: GoogleGenerativeAI,
    params: ModelParams
  ) {
    this.client = client
    this.modelName = params.model
    this.generationConfig = params.generationConfig
    this.safetySettings = params.safetySettings
    this.tools = params.tools
    this.toolConfig = params.toolConfig
  }

  /**
   * Generate content from a prompt
   */
  async generateContent(
    request: string | Part[] | Content[] | GenerateContentRequest
  ): Promise<GenerateContentResult> {
    const requestBody = this.buildRequest(request)

    const data = await this.client._request<Omit<GenerateContentResponse, 'text'>>(
      `models/${this.modelName}:generateContent`,
      requestBody
    )

    return {
      response: {
        ...data,
        text: () => this.extractText(data),
      },
    }
  }

  /**
   * Generate content with streaming
   */
  async generateContentStream(
    request: string | Part[] | Content[] | GenerateContentRequest
  ): Promise<GenerateContentStreamResult> {
    const requestBody = this.buildRequest(request)

    const contentStream = await this.client._requestStream(
      `models/${this.modelName}:streamGenerateContent?alt=sse`,
      requestBody
    )

    return {
      stream: contentStream.stream,
      response: contentStream.response,
    }
  }

  /**
   * Start a chat session
   */
  startChat(params?: StartChatParams): ChatSession {
    return new ChatSession(this, {
      ...params,
      generationConfig: params?.generationConfig ?? this.generationConfig,
      safetySettings: params?.safetySettings ?? this.safetySettings,
    })
  }

  /**
   * Generate embeddings for content
   */
  async embedContent(
    request: string | EmbedContentRequest
  ): Promise<EmbedContentResult> {
    const requestBody = typeof request === 'string'
      ? { content: { role: 'user' as const, parts: [{ text: request }] } }
      : request

    return this.client._request<EmbedContentResult>(
      `models/${this.modelName}:embedContent`,
      requestBody
    )
  }

  /**
   * Generate embeddings for multiple contents
   */
  async batchEmbedContents(
    request: { requests: EmbedContentRequest[] }
  ): Promise<BatchEmbedContentsResult> {
    const requestBody = {
      requests: request.requests.map((r) => ({
        model: `models/${this.modelName}`,
        ...r,
      })),
    }

    return this.client._request<BatchEmbedContentsResult>(
      `models/${this.modelName}:batchEmbedContents`,
      requestBody
    )
  }

  /**
   * Count tokens in content
   */
  async countTokens(
    request: string | Content[]
  ): Promise<CountTokensResult> {
    const contents = typeof request === 'string'
      ? [{ role: 'user' as const, parts: [{ text: request }] }]
      : request

    return this.client._request<CountTokensResult>(
      `models/${this.modelName}:countTokens`,
      { contents }
    )
  }

  /**
   * Build request body from various input formats
   */
  private buildRequest(
    request: string | Part[] | Content[] | GenerateContentRequest
  ): GenerateContentRequest {
    let contents: Content[]

    if (typeof request === 'string') {
      contents = [{ role: 'user', parts: [{ text: request }] }]
    } else if (Array.isArray(request)) {
      // Check if it's Part[] or Content[]
      const firstItem = request[0]
      if (request.length > 0 && firstItem && 'role' in firstItem) {
        contents = request as Content[]
      } else {
        contents = [{ role: 'user', parts: request as Part[] }]
      }
    } else {
      return {
        contents: request.contents,
        generationConfig: request.generationConfig ?? this.generationConfig,
        safetySettings: request.safetySettings ?? this.safetySettings,
        tools: request.tools ?? this.tools,
        toolConfig: request.toolConfig ?? this.toolConfig,
      }
    }

    return {
      contents,
      generationConfig: this.generationConfig,
      safetySettings: this.safetySettings,
      tools: this.tools,
      toolConfig: this.toolConfig,
    }
  }

  /**
   * Extract text from response
   */
  private extractText(response: Omit<GenerateContentResponse, 'text'>): string {
    const parts = response.candidates?.[0]?.content?.parts ?? []
    return parts
      .filter((p): p is TextPart => 'text' in p)
      .map((p) => p.text)
      .join('')
  }
}

// =============================================================================
// Google Generative AI Client
// =============================================================================

/**
 * Google Generative AI client
 */
export class GoogleGenerativeAI {
  private apiKey: string
  private baseURL: string
  private timeout: number
  private _fetch: typeof fetch

  constructor(apiKey: string, config?: GoogleGenerativeAIConfig) {
    if (!apiKey) {
      throw new Error('Google AI API key is required')
    }

    this.apiKey = apiKey
    this.baseURL = config?.baseURL ?? DEFAULT_BASE_URL
    this.timeout = config?.timeout ?? DEFAULT_TIMEOUT
    this._fetch = config?.fetch ?? globalThis.fetch.bind(globalThis)
  }

  /**
   * Get a generative model instance
   */
  getGenerativeModel(params: ModelParams): GenerativeModel {
    return new GenerativeModel(this, params)
  }

  /**
   * Make an API request
   * @internal
   */
  async _request<T>(
    path: string,
    body: object,
    options?: RequestOptions
  ): Promise<T> {
    const url = `${this.baseURL}/${path}?key=${this.apiKey}`

    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      options?.timeout ?? this.timeout
    )

    try {
      const response = await this._fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: options?.signal ?? controller.signal,
      })

      if (!response.ok) {
        const errorData = (await response.json()) as GoogleAIErrorResponse
        throw new GoogleGenerativeAIError(
          errorData.error.message,
          response.status,
          errorData.error.status
        )
      }

      return (await response.json()) as T
    } catch (error) {
      if (error instanceof GoogleGenerativeAIError) {
        throw error
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new GoogleGenerativeAIError('Request timed out', 408, 'TIMEOUT')
      }

      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Make a streaming API request
   * @internal
   */
  async _requestStream(
    path: string,
    body: object,
    options?: RequestOptions
  ): Promise<GenerativeContentStream> {
    const url = `${this.baseURL}/${path}&key=${this.apiKey}`

    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      options?.timeout ?? this.timeout
    )

    try {
      const response = await this._fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: options?.signal ?? controller.signal,
      })

      if (!response.ok) {
        const errorData = (await response.json()) as GoogleAIErrorResponse
        throw new GoogleGenerativeAIError(
          errorData.error.message,
          response.status,
          errorData.error.status
        )
      }

      return new GenerativeContentStream(response)
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

export default GoogleGenerativeAI
