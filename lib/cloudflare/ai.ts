/**
 * Workers AI Integration Layer
 *
 * Comprehensive Workers AI integration for dotdo providing:
 * - Text generation (LLM inference)
 * - Embeddings (vector generation for semantic search)
 * - Image generation (AI image creation)
 * - Speech-to-text (audio transcription)
 * - Cost tracking and limits
 * - Streaming support
 * - Fallback to external providers via AI Gateway
 *
 * @module lib/cloudflare/ai
 *
 * @example Basic text generation
 * ```typescript
 * import { createWorkersAI } from './ai'
 *
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const ai = createWorkersAI(env)
 *     const response = await ai.generateText('Explain quantum computing')
 *     return new Response(response.text)
 *   }
 * }
 * ```
 *
 * @example Streaming text generation
 * ```typescript
 * const ai = createWorkersAI(env)
 * const stream = await ai.generateTextStream('Write a story about AI')
 *
 * return new Response(stream, {
 *   headers: { 'Content-Type': 'text/event-stream' }
 * })
 * ```
 *
 * @example Embeddings for semantic search
 * ```typescript
 * const ai = createWorkersAI(env)
 *
 * // Single embedding
 * const { embedding } = await ai.generateEmbedding('Hello world')
 * console.log(embedding.length) // 768 dimensions
 *
 * // Batch embeddings (efficient for multiple texts)
 * const { embeddings } = await ai.generateEmbeddings([
 *   'First document',
 *   'Second document',
 *   'Third document'
 * ])
 * ```
 *
 * @example Image generation
 * ```typescript
 * const ai = createWorkersAI(env)
 * const { image, format } = await ai.generateImage('A sunset over mountains', {
 *   width: 1024,
 *   height: 768,
 *   steps: 8
 * })
 *
 * return new Response(image, {
 *   headers: { 'Content-Type': `image/${format}` }
 * })
 * ```
 *
 * @example Speech-to-text transcription
 * ```typescript
 * const ai = createWorkersAI(env)
 * const audioData = await request.arrayBuffer()
 *
 * const { text, words } = await ai.transcribeAudio(audioData, {
 *   language: 'en',
 *   wordTimestamps: true
 * })
 * ```
 *
 * @example With cost limits and fallback
 * ```typescript
 * const ai = new WorkersAI(env, {
 *   limits: {
 *     maxOperations: 100,
 *     maxCost: 1.00 // USD
 *   },
 *   fallback: {
 *     enabled: true,
 *     provider: 'openai',
 *     model: 'gpt-4o-mini'
 *   }
 * })
 *
 * // Check remaining budget
 * console.log(ai.getRemainingBudget())
 *
 * // Get usage metrics
 * const metrics = ai.getUsageMetrics()
 * console.log(`Total operations: ${metrics.totalOperations}`)
 * console.log(`Estimated cost: $${metrics.estimatedCost.toFixed(4)}`)
 * ```
 */

// Type casting helper for Cloudflare AI - ai.run() has strict model typing
// We use 'unknown' casts to allow dynamic model selection while maintaining type safety
type AiRunParams = Parameters<Ai['run']>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runAi = (ai: Ai, model: string, params: unknown) => ai.run(model as any, params as any)

// ============================================================================
// Model Configuration
// ============================================================================

/**
 * Default models for each use case
 */
export const AI_MODELS = {
  /** Fast chat model for quick responses */
  chat: '@cf/meta/llama-3.1-8b-instruct',
  /** Large chat model for quality responses */
  chatLarge: '@cf/meta/llama-3.1-70b-instruct',
  /** Embedding model for vector generation */
  embedding: '@cf/baai/bge-base-en-v1.5',
  /** Image generation model */
  image: '@cf/black-forest-labs/flux-1-schnell',
  /** Speech-to-text model */
  speech: '@cf/openai/whisper',
} as const

/**
 * Model metadata for introspection
 */
const MODEL_INFO: Record<string, { type: 'text' | 'embedding' | 'image' | 'speech'; name: string }> = {
  [AI_MODELS.chat]: { type: 'text', name: 'Llama 3.1 8B Instruct' },
  [AI_MODELS.chatLarge]: { type: 'text', name: 'Llama 3.1 70B Instruct' },
  [AI_MODELS.embedding]: { type: 'embedding', name: 'BGE Base EN v1.5' },
  [AI_MODELS.image]: { type: 'image', name: 'Flux 1 Schnell' },
  [AI_MODELS.speech]: { type: 'speech', name: 'Whisper' },
}

// ============================================================================
// Types
// ============================================================================

/**
 * Environment bindings for Workers AI
 */
export interface WorkersAIEnv {
  /** Workers AI binding */
  AI?: Ai
  /** AI Gateway ID for fallback routing */
  AI_GATEWAY_ID?: string
  /** OpenAI API key for fallback */
  OPENAI_API_KEY?: string
  /** Anthropic API key for fallback */
  ANTHROPIC_API_KEY?: string
}

/**
 * Cost limits configuration
 */
export interface CostLimits {
  /** Maximum number of operations */
  maxOperations?: number
  /** Maximum estimated cost in USD */
  maxCost?: number
}

/**
 * Fallback configuration for external providers
 */
export interface FallbackConfig {
  /** Whether fallback is enabled */
  enabled: boolean
  /** Provider to fall back to */
  provider?: 'openai' | 'anthropic'
  /** Model to use for fallback */
  model?: string
}

/**
 * Configuration for WorkersAI client
 */
export interface WorkersAIConfig {
  /** Default model for text generation */
  defaultModel?: string
  /** Default temperature for generation */
  temperature?: number
  /** Default max tokens for generation */
  maxTokens?: number
  /** Request timeout in milliseconds */
  timeout?: number
  /** Cost limits */
  limits?: CostLimits
  /** Fallback configuration */
  fallback?: FallbackConfig
}

/**
 * Chat message format
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Options for text generation
 */
export interface TextGenerationOptions {
  /** Model to use */
  model?: string
  /** Temperature (0-2) */
  temperature?: number
  /** Maximum tokens to generate */
  maxTokens?: number
  /** System prompt */
  systemPrompt?: string
}

/**
 * Usage metrics for a response
 */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/**
 * Response from text generation
 */
export interface TextGenerationResponse {
  /** Generated text */
  text: string
  /** Model used */
  model: string
  /** Token usage */
  usage?: TokenUsage
  /** Whether fallback was used */
  usedFallback?: boolean
  /** Fallback provider if used */
  fallbackProvider?: string
}

/**
 * Options for embedding generation
 */
export interface EmbeddingOptions {
  /** Model to use */
  model?: string
}

/**
 * Response from single embedding generation
 */
export interface EmbeddingResponse {
  /** Embedding vector */
  embedding: number[]
  /** Dimension of embedding */
  dimension: number
  /** Model used */
  model: string
}

/**
 * Response from batch embedding generation
 */
export interface EmbeddingsResponse {
  /** Array of embedding vectors */
  embeddings: number[][]
  /** Dimension of embeddings */
  dimension: number
  /** Model used */
  model: string
}

/**
 * Options for image generation
 */
export interface ImageGenerationOptions {
  /** Image width */
  width?: number
  /** Image height */
  height?: number
  /** Number of inference steps */
  steps?: number
  /** Guidance scale */
  guidance?: number
}

/**
 * Response from image generation
 */
export interface ImageGenerationResponse {
  /** Generated image data */
  image: Uint8Array
  /** Image format */
  format: 'png'
  /** Image width */
  width: number
  /** Image height */
  height: number
}

/**
 * Options for speech-to-text
 */
export interface SpeechToTextOptions {
  /** Language hint (e.g., 'en', 'es') */
  language?: string
  /** Include word-level timestamps */
  wordTimestamps?: boolean
}

/**
 * Response from speech-to-text
 */
export interface SpeechToTextResponse {
  /** Transcribed text */
  text: string
  /** VTT subtitle format */
  vtt?: string
  /** Word-level timestamps if requested */
  words?: Array<{ word: string; start: number; end: number }>
}

/**
 * Aggregate usage metrics
 */
export interface UsageMetrics {
  /** Total number of operations */
  totalOperations: number
  /** Operations by type */
  operationsByType: {
    text: number
    embedding: number
    image: number
    speech: number
  }
  /** Estimated cost in USD */
  estimatedCost: number
}

/**
 * Streaming text response type
 */
export type StreamingTextResponse = ReadableStream<string>

// ============================================================================
// Workers AI Response Types
// ============================================================================

interface WorkersAITextResponse {
  response: string
}

interface WorkersAIEmbeddingResponse {
  data: number[][]
}

interface WorkersAISpeechResponse {
  text: string
  vtt?: string
  words?: Array<{ word: string; start: number; end: number }>
}

// ============================================================================
// External Provider Response Types
// ============================================================================

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string
    }
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
  }
}

interface AnthropicResponse {
  content: Array<{
    type: string
    text: string
  }>
  usage?: {
    input_tokens: number
    output_tokens: number
  }
}

// ============================================================================
// Cost Estimation
// ============================================================================

// Approximate costs per operation (in USD)
const COST_PER_OPERATION = {
  text: 0.0001,      // Per 1K tokens (simplified)
  embedding: 0.00001, // Per embedding
  image: 0.001,      // Per image
  speech: 0.0001,    // Per second of audio (simplified)
}

// ============================================================================
// WorkersAI Class
// ============================================================================

/**
 * Workers AI client for dotdo
 *
 * Provides a unified interface for AI operations with:
 * - Text generation
 * - Embeddings
 * - Image generation
 * - Speech-to-text
 * - Cost tracking
 * - Fallback support
 *
 * @example
 * ```typescript
 * const ai = new WorkersAI(env)
 *
 * // Text generation
 * const response = await ai.generateText('Hello, who are you?')
 * console.log(response.text)
 *
 * // Embeddings
 * const embedding = await ai.generateEmbedding('Hello world')
 * console.log(embedding.embedding) // number[]
 *
 * // Image generation
 * const image = await ai.generateImage('A sunset over the ocean')
 * console.log(image.image) // Uint8Array
 *
 * // Speech-to-text
 * const transcript = await ai.transcribeAudio(audioData)
 * console.log(transcript.text)
 * ```
 */
export class WorkersAI {
  private ai: Ai
  private config: Required<Omit<WorkersAIConfig, 'limits' | 'fallback'>> & {
    limits?: CostLimits
    fallback?: FallbackConfig
  }
  private env: WorkersAIEnv

  // Usage tracking
  private usageMetrics: UsageMetrics = {
    totalOperations: 0,
    operationsByType: { text: 0, embedding: 0, image: 0, speech: 0 },
    estimatedCost: 0,
  }

  constructor(env: WorkersAIEnv, config: WorkersAIConfig = {}) {
    if (!env.AI) {
      throw new Error('Workers AI binding (AI) is required')
    }

    // Validate config
    if (config.temperature !== undefined) {
      if (config.temperature < 0 || config.temperature > 2) {
        throw new Error('Temperature must be between 0 and 2')
      }
    }

    if (config.maxTokens !== undefined) {
      if (config.maxTokens <= 0 || !Number.isInteger(config.maxTokens)) {
        throw new Error('maxTokens must be a positive integer')
      }
    }

    if (config.timeout !== undefined && config.timeout < 0) {
      throw new Error('timeout must be a positive number')
    }

    this.ai = env.AI
    this.env = env
    this.config = {
      defaultModel: config.defaultModel ?? AI_MODELS.chat,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 1024,
      timeout: config.timeout ?? 30000,
      limits: config.limits,
      fallback: config.fallback,
    }
  }

  // ============================================================================
  // Text Generation
  // ============================================================================

  /**
   * Generate text from a prompt or messages
   */
  async generateText(
    input: string | ChatMessage[],
    options: TextGenerationOptions = {}
  ): Promise<TextGenerationResponse> {
    // Validate input
    if (typeof input === 'string' && input.trim() === '') {
      throw new Error('Input cannot be empty')
    }

    // Check limits
    this.checkLimits()

    const model = options.model ?? this.config.defaultModel
    const messages: ChatMessage[] = typeof input === 'string'
      ? [{ role: 'user', content: input }]
      : input

    // Add system prompt if provided
    if (options.systemPrompt && !messages.some(m => m.role === 'system')) {
      messages.unshift({ role: 'system', content: options.systemPrompt })
    }

    const params: Record<string, unknown> = {
      messages,
    }

    if (options.temperature !== undefined) {
      params.temperature = options.temperature
    } else if (this.config.temperature !== undefined) {
      params.temperature = this.config.temperature
    }

    if (options.maxTokens !== undefined) {
      params.max_tokens = options.maxTokens
    } else if (this.config.maxTokens !== undefined) {
      params.max_tokens = this.config.maxTokens
    }

    try {
      // Use helper to bypass strict model typing
      const response = await this.runWithTimeout(
        runAi(this.ai, model, params) as Promise<WorkersAITextResponse>
      )

      // Track usage
      this.trackUsage('text')

      // Estimate token usage (Workers AI doesn't always return this)
      const promptTokens = this.estimateTokens(messages.map(m => m.content).join(' '))
      const completionTokens = this.estimateTokens(response.response)

      return {
        text: response.response,
        model,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
      }
    } catch (error) {
      // Try fallback if enabled
      if (this.config.fallback?.enabled) {
        return this.generateTextWithFallback(messages, options)
      }
      throw error
    }
  }

  /**
   * Generate text with streaming response
   */
  async generateTextStream(
    input: string | ChatMessage[],
    options: TextGenerationOptions = {}
  ): Promise<StreamingTextResponse> {
    // Validate input
    if (typeof input === 'string' && input.trim() === '') {
      throw new Error('Input cannot be empty')
    }

    // Check limits
    this.checkLimits()

    const model = options.model ?? this.config.defaultModel
    const messages: ChatMessage[] = typeof input === 'string'
      ? [{ role: 'user', content: input }]
      : input

    const params: Record<string, unknown> = {
      messages,
      stream: true,
    }

    if (options.temperature !== undefined) {
      params.temperature = options.temperature
    }

    if (options.maxTokens !== undefined) {
      params.max_tokens = options.maxTokens
    }

    const response = await runAi(this.ai, model, params) as ReadableStream

    // Track usage
    this.trackUsage('text')

    // Transform the stream to extract text chunks
    const decoder = new TextDecoder()
    const transformStream = new TransformStream<Uint8Array, string>({
      transform(chunk, controller) {
        const text = decoder.decode(chunk)
        const lines = text.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') {
              return
            }
            try {
              const parsed = JSON.parse(data) as { response: string }
              if (parsed.response) {
                controller.enqueue(parsed.response)
              }
            } catch {
              // Ignore parse errors for partial chunks
            }
          }
        }
      },
    })

    return response.pipeThrough(transformStream)
  }

  /**
   * Fallback to external provider via AI Gateway
   */
  private async generateTextWithFallback(
    messages: ChatMessage[],
    options: TextGenerationOptions
  ): Promise<TextGenerationResponse> {
    const provider = this.config.fallback?.provider ?? 'openai'
    const model = this.config.fallback?.model ?? (provider === 'openai' ? 'gpt-4o-mini' : 'claude-3-5-haiku-20241022')

    if (provider === 'openai') {
      return this.generateTextOpenAI(messages, model, options)
    } else {
      return this.generateTextAnthropic(messages, model, options)
    }
  }

  private async generateTextOpenAI(
    messages: ChatMessage[],
    model: string,
    options: TextGenerationOptions
  ): Promise<TextGenerationResponse> {
    const apiKey = this.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for fallback')
    }

    const gatewayId = this.env.AI_GATEWAY_ID
    const url = gatewayId
      ? `https://gateway.ai.cloudflare.com/v1/${gatewayId}/openai/chat/completions`
      : 'https://api.openai.com/v1/chat/completions'

    const body: Record<string, unknown> = {
      model,
      messages,
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature
    }

    if (options.maxTokens !== undefined) {
      body.max_tokens = options.maxTokens
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.json() as { error?: { message?: string } }
      throw new Error(error.error?.message ?? `OpenAI API error: ${response.status}`)
    }

    const data = await response.json() as OpenAIResponse

    return {
      text: data.choices[0]?.message?.content ?? '',
      model,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.prompt_tokens + data.usage.completion_tokens,
          }
        : undefined,
      usedFallback: true,
      fallbackProvider: 'openai',
    }
  }

  private async generateTextAnthropic(
    messages: ChatMessage[],
    model: string,
    options: TextGenerationOptions
  ): Promise<TextGenerationResponse> {
    const apiKey = this.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for fallback')
    }

    const gatewayId = this.env.AI_GATEWAY_ID
    const url = gatewayId
      ? `https://gateway.ai.cloudflare.com/v1/${gatewayId}/anthropic/v1/messages`
      : 'https://api.anthropic.com/v1/messages'

    // Convert to Anthropic format
    const systemMessage = messages.find(m => m.role === 'system')
    const nonSystemMessages = messages.filter(m => m.role !== 'system')

    const body: Record<string, unknown> = {
      model,
      messages: nonSystemMessages,
      max_tokens: options.maxTokens ?? 1024,
    }

    if (systemMessage) {
      body.system = systemMessage.content
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.json() as { error?: { message?: string } }
      throw new Error(error.error?.message ?? `Anthropic API error: ${response.status}`)
    }

    const data = await response.json() as AnthropicResponse
    const textContent = data.content.find(c => c.type === 'text')

    return {
      text: textContent?.text ?? '',
      model,
      usage: data.usage
        ? {
            promptTokens: data.usage.input_tokens,
            completionTokens: data.usage.output_tokens,
            totalTokens: data.usage.input_tokens + data.usage.output_tokens,
          }
        : undefined,
      usedFallback: true,
      fallbackProvider: 'anthropic',
    }
  }

  // ============================================================================
  // Embeddings
  // ============================================================================

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(
    text: string,
    options: EmbeddingOptions = {}
  ): Promise<EmbeddingResponse> {
    if (text.trim() === '') {
      throw new Error('Text cannot be empty')
    }

    this.checkLimits()

    const model = options.model ?? AI_MODELS.embedding

    const response = await this.runWithTimeout(
      runAi(this.ai, model, { text }) as Promise<WorkersAIEmbeddingResponse>
    )

    this.trackUsage('embedding')

    const embedding = response.data[0]

    return {
      embedding: embedding!,
      dimension: embedding!.length,
      model,
    }
  }

  /**
   * Generate embeddings for multiple texts
   */
  async generateEmbeddings(
    texts: string[],
    options: EmbeddingOptions = {}
  ): Promise<EmbeddingsResponse> {
    if (texts.length === 0) {
      throw new Error('Texts array cannot be empty')
    }

    this.checkLimits()

    const model = options.model ?? AI_MODELS.embedding
    const batchSize = 100 // Workers AI batch limit

    const allEmbeddings: number[][] = []

    // Process in batches
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)

      const response = await this.runWithTimeout(
        runAi(this.ai, model, { text: batch }) as Promise<WorkersAIEmbeddingResponse>
      )

      allEmbeddings.push(...response.data)
      this.trackUsage('embedding', batch.length)
    }

    return {
      embeddings: allEmbeddings,
      dimension: allEmbeddings[0]?.length ?? 0,
      model,
    }
  }

  // ============================================================================
  // Image Generation
  // ============================================================================

  /**
   * Generate an image from a prompt
   */
  async generateImage(
    prompt: string,
    options: ImageGenerationOptions = {}
  ): Promise<ImageGenerationResponse> {
    if (prompt.trim() === '') {
      throw new Error('Prompt cannot be empty')
    }

    this.checkLimits()

    const model = AI_MODELS.image
    const width = options.width ?? 512
    const height = options.height ?? 512

    const params: Record<string, unknown> = {
      prompt,
      width,
      height,
    }

    if (options.steps !== undefined) {
      params.num_steps = options.steps
    }

    if (options.guidance !== undefined) {
      params.guidance = options.guidance
    }

    const response = await this.runWithTimeout(
      runAi(this.ai, model, params) as Promise<Uint8Array>
    )

    this.trackUsage('image')

    return {
      image: response,
      format: 'png',
      width,
      height,
    }
  }

  // ============================================================================
  // Speech-to-Text
  // ============================================================================

  /**
   * Transcribe audio to text
   */
  async transcribeAudio(
    audio: ArrayBuffer | Uint8Array,
    options: SpeechToTextOptions = {}
  ): Promise<SpeechToTextResponse> {
    if (audio.byteLength === 0) {
      throw new Error('Audio data cannot be empty')
    }

    this.checkLimits()

    const model = AI_MODELS.speech

    // Convert to array for Workers AI
    const audioArray = audio instanceof Uint8Array
      ? Array.from(audio)
      : Array.from(new Uint8Array(audio))

    const params: Record<string, unknown> = {
      audio: audioArray,
    }

    if (options.language) {
      params.source_lang = options.language
    }

    if (options.wordTimestamps) {
      params.word_timestamps = true
    }

    const response = await this.runWithTimeout(
      runAi(this.ai, model, params) as Promise<WorkersAISpeechResponse>
    )

    this.trackUsage('speech')

    return {
      text: response.text,
      vtt: response.vtt,
      words: response.words,
    }
  }

  // ============================================================================
  // Usage Tracking
  // ============================================================================

  /**
   * Get current usage metrics
   */
  getUsageMetrics(): UsageMetrics {
    return { ...this.usageMetrics }
  }

  /**
   * Reset usage metrics
   */
  resetUsageMetrics(): void {
    this.usageMetrics = {
      totalOperations: 0,
      operationsByType: { text: 0, embedding: 0, image: 0, speech: 0 },
      estimatedCost: 0,
    }
  }

  /**
   * Get remaining budget based on limits
   */
  getRemainingBudget(): number {
    if (!this.config.limits?.maxCost) {
      return Infinity
    }
    return Math.max(0, this.config.limits.maxCost - this.usageMetrics.estimatedCost)
  }

  /**
   * Check if an operation can be performed within limits
   */
  canPerformOperation(): boolean {
    if (this.config.limits?.maxOperations !== undefined) {
      if (this.usageMetrics.totalOperations >= this.config.limits.maxOperations) {
        return false
      }
    }

    if (this.config.limits?.maxCost !== undefined) {
      if (this.usageMetrics.estimatedCost >= this.config.limits.maxCost) {
        return false
      }
    }

    return true
  }

  private trackUsage(type: keyof typeof COST_PER_OPERATION, count = 1): void {
    this.usageMetrics.totalOperations += count
    this.usageMetrics.operationsByType[type] += count
    this.usageMetrics.estimatedCost += COST_PER_OPERATION[type] * count
  }

  private checkLimits(): void {
    if (this.config.limits?.maxOperations !== undefined) {
      if (this.usageMetrics.totalOperations >= this.config.limits.maxOperations) {
        throw new Error('Operation limit exceeded')
      }
    }

    if (this.config.limits?.maxCost !== undefined) {
      if (this.usageMetrics.estimatedCost >= this.config.limits.maxCost) {
        throw new Error('Cost limit exceeded')
      }
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get information about a model
   */
  getModelInfo(modelId: string): { id: string; type: string; name: string } | undefined {
    const info = MODEL_INFO[modelId]
    if (!info) {
      return undefined
    }
    return {
      id: modelId,
      type: info.type,
      name: info.name,
    }
  }

  /**
   * List available models
   */
  listModels(): string[] {
    return Object.values(AI_MODELS)
  }

  /**
   * Check if a model is valid
   */
  isValidModel(modelId: string): boolean {
    return modelId in MODEL_INFO
  }

  /**
   * Run an operation with timeout
   */
  private async runWithTimeout<T>(promise: Promise<T>): Promise<T> {
    const timeout = this.config.timeout

    if (!timeout) {
      return promise
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Operation timed out')), timeout)
    })

    return Promise.race([promise, timeoutPromise])
  }

  /**
   * Estimate token count for text (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token for English
    return Math.ceil(text.length / 4)
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a WorkersAI client from environment bindings
 *
 * @param env - Environment bindings with AI
 * @param config - Optional configuration
 * @returns WorkersAI instance
 *
 * @example
 * ```typescript
 * // In a Worker
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const ai = createWorkersAI(env)
 *     const response = await ai.generateText('Hello!')
 *     return new Response(response.text)
 *   }
 * }
 * ```
 */
export function createWorkersAI(env: WorkersAIEnv, config?: WorkersAIConfig): WorkersAI {
  return new WorkersAI(env, config)
}

/**
 * Create a WorkersAI client configured for fast responses
 *
 * Uses the smaller Llama 3.1 8B model for lower latency.
 *
 * @param env - Environment bindings with AI
 * @param config - Optional configuration (defaultModel is set automatically)
 * @returns WorkersAI instance with fast model
 */
export function createFastAI(env: WorkersAIEnv, config?: Omit<WorkersAIConfig, 'defaultModel'>): WorkersAI {
  return new WorkersAI(env, {
    ...config,
    defaultModel: AI_MODELS.chat,
  })
}

/**
 * Create a WorkersAI client configured for quality responses
 *
 * Uses the larger Llama 3.1 70B model for better quality.
 *
 * @param env - Environment bindings with AI
 * @param config - Optional configuration (defaultModel is set automatically)
 * @returns WorkersAI instance with quality model
 */
export function createQualityAI(env: WorkersAIEnv, config?: Omit<WorkersAIConfig, 'defaultModel'>): WorkersAI {
  return new WorkersAI(env, {
    ...config,
    defaultModel: AI_MODELS.chatLarge,
  })
}

/**
 * Create a WorkersAI client with OpenAI fallback enabled
 *
 * Falls back to OpenAI via AI Gateway if Workers AI fails.
 *
 * @param env - Environment bindings with AI and OPENAI_API_KEY
 * @param fallbackModel - OpenAI model to use for fallback (default: 'gpt-4o-mini')
 * @param config - Optional configuration (fallback is set automatically)
 * @returns WorkersAI instance with fallback enabled
 */
export function createAIWithFallback(
  env: WorkersAIEnv,
  fallbackModel = 'gpt-4o-mini',
  config?: Omit<WorkersAIConfig, 'fallback'>
): WorkersAI {
  return new WorkersAI(env, {
    ...config,
    fallback: {
      enabled: true,
      provider: 'openai',
      model: fallbackModel,
    },
  })
}
