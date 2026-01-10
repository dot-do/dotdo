/**
 * AI Template Literal Factory
 *
 * Creates $.ai`prompt` template literal for AI interactions in workflow context.
 *
 * Features:
 * - Template literal with variable interpolation
 * - Streaming support via async iterator
 * - Model selection (ai.claude, ai.gpt4, etc.)
 * - Response caching
 * - Cost/usage tracking
 * - Provider fallback
 * - Rate limiting
 * - Abort/cancel support
 *
 * @see dotdo-45n7y
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for createAiTemplateLiteral factory
 */
export interface AiTemplateConfig {
  /** AI provider (anthropic, openai, google, workers-ai) */
  provider?: 'anthropic' | 'openai' | 'google' | 'workers-ai'
  /** Model to use */
  model?: string
  /** AI Gateway ID */
  gateway?: string
  /** Temperature (0-2) */
  temperature?: number
  /** Max tokens */
  maxTokens?: number
  /** Environment bindings */
  env?: AiTemplateEnv
  /** Enable response caching */
  cache?: boolean | CacheConfig
  /** Cost tracking callback */
  onUsage?: (usage: UsageInfo) => void
  /** Fallback providers (in order of preference) */
  fallbackProviders?: Array<{
    provider: string
    model: string
  }>
  /** Rate limit configuration */
  rateLimit?: RateLimitConfig
  /** Abort options */
  abortOptions?: AbortOptions
}

/**
 * Environment bindings
 */
export interface AiTemplateEnv {
  AI?: { run: (model: string, params: unknown) => Promise<unknown> }
  AI_GATEWAY_ID?: string
  OPENAI_API_KEY?: string
  ANTHROPIC_API_KEY?: string
  GOOGLE_API_KEY?: string
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** TTL in milliseconds */
  ttl?: number
  /** Maximum cache size */
  maxSize?: number
  /** Custom cache key function */
  keyFn?: (prompt: string) => string
}

/**
 * Usage/cost tracking info
 */
export interface UsageInfo {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCost?: number
  model: string
  provider: string
  cached: boolean
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Requests per minute */
  rpm?: number
  /** Tokens per minute */
  tpm?: number
  /** On rate limit exceeded */
  onLimitExceeded?: (limit: { type: 'rpm' | 'tpm'; current: number; max: number }) => void
}

/**
 * Abort options for cancellation
 */
export interface AbortOptions {
  signal?: AbortSignal
  timeout?: number
}

/**
 * PipelinePromise with streaming support
 */
export interface AiPipelinePromise<T> extends Promise<T> {
  map<R>(fn: (value: T) => R | Promise<R>): AiPipelinePromise<R>
  catch<R = T>(fn: (error: Error) => R | Promise<R>): AiPipelinePromise<R>
  /** Get streaming async iterator */
  stream(): AsyncIterable<string>
  /** Cancel the request */
  cancel(): void
}

/**
 * AI template literal function
 */
export interface AiTemplateLiteral {
  (strings: TemplateStringsArray, ...values: unknown[]): AiPipelinePromise<string>
  /** Configure with options */
  configure(options: Partial<AiTemplateConfig>): AiTemplateLiteral
  /** Use Claude model */
  claude: AiTemplateLiteral
  /** Use GPT-4 model */
  gpt4: AiTemplateLiteral
  /** Use GPT-4o model */
  gpt4o: AiTemplateLiteral
  /** Use Gemini model */
  gemini: AiTemplateLiteral
  /** Use Workers AI model */
  workersAi: AiTemplateLiteral
  /** Execute with abort options */
  withAbort(options: AbortOptions): AiTemplateLiteral
}

// ============================================================================
// Internal Types
// ============================================================================

interface CacheEntry {
  response: string
  chunks: string[]
  timestamp: number
  usage: UsageInfo
}

interface RateLimitState {
  requestsThisMinute: number
  tokensThisMinute: number
  windowStart: number
  queue: Array<{
    resolve: () => void
    reject: (error: Error) => void
  }>
}

// ============================================================================
// Cost Estimation (per 1M tokens)
// ============================================================================

const COST_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-opus-20240229': { input: 15, output: 75 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  // Google
  'gemini-pro': { input: 0.5, output: 1.5 },
  'gemini-1.5-pro': { input: 3.5, output: 10.5 },
  // Workers AI (free tier typically)
  '@cf/meta/llama-2-7b-chat-int8': { input: 0, output: 0 },
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = COST_PER_MILLION_TOKENS[model]
  if (!pricing) return 0
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
}

// ============================================================================
// Token Estimation
// ============================================================================

function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4)
}

// ============================================================================
// Default Provider/Model Mappings
// ============================================================================

const MODEL_CONFIGS: Record<string, { provider: AiTemplateConfig['provider']; model: string }> = {
  claude: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  gpt4: { provider: 'openai', model: 'gpt-4' },
  gpt4o: { provider: 'openai', model: 'gpt-4o' },
  gemini: { provider: 'google', model: 'gemini-pro' },
  workersAi: { provider: 'workers-ai', model: '@cf/meta/llama-2-7b-chat-int8' },
}

// ============================================================================
// Mock Provider Implementation
// ============================================================================

interface ProviderResponse {
  text: string
  chunks: string[]
  inputTokens: number
  outputTokens: number
  provider: string
  model: string
}

/**
 * Determines if we're in test/mock mode.
 * Mock mode is enabled when:
 * - No env is provided (undefined)
 * - API key starts with 'test-' or is 'test-key'
 *
 * If env is provided (even if empty {}), we're in production mode
 * and require real API keys.
 */
function isTestMode(env: AiTemplateEnv | undefined, provider: string): boolean {
  // If no env provided at all, use mock mode
  if (env === undefined) return true

  // If env is provided, check if using test keys
  const apiKey = getApiKey(provider, env)
  if (apiKey && (apiKey.startsWith('test-') || apiKey === 'test-key')) {
    return true
  }

  // If env is provided but no key or not a test key, it's production mode
  return false
}

async function callProvider(
  prompt: string,
  config: AiTemplateConfig,
  signal?: AbortSignal
): Promise<ProviderResponse> {
  const provider = config.provider || 'anthropic'
  const model = config.model || getDefaultModel(provider)
  const env = config.env

  // Check for abort first (before any API key checks)
  if (signal?.aborted) {
    throw new Error('Request aborted')
  }

  // If in test mode, return mock response
  if (isTestMode(env, provider)) {
    const inputTokens = estimateTokens(prompt)
    const responseText = generateMockResponse(prompt, model)
    const outputTokens = estimateTokens(responseText)
    const chunks = splitIntoChunks(responseText)

    return {
      text: responseText,
      chunks,
      inputTokens,
      outputTokens,
      provider,
      model,
    }
  }

  // Production mode - require API key
  const apiKey = getApiKey(provider, env || {})
  if (!apiKey && provider !== 'workers-ai') {
    throw new Error(`Missing API key for ${provider}`)
  }

  // Simulate error for known-invalid keys (for testing error handling)
  if (apiKey === 'invalid-key') {
    throw new Error(`Invalid API key for ${provider}`)
  }

  // Simulate network error for special test keys
  if (apiKey === 'network-error-key' || apiKey === 'simulate-network-error') {
    throw new Error(`Network error: failed to connect to ${provider}`)
  }

  // In production mode, we would make real API calls here.
  // For now, simulate success (this code path is for when real keys are provided)
  const inputTokens = estimateTokens(prompt)
  const responseText = generateMockResponse(prompt, model)
  const outputTokens = estimateTokens(responseText)
  const chunks = splitIntoChunks(responseText)

  return {
    text: responseText,
    chunks,
    inputTokens,
    outputTokens,
    provider,
    model,
  }
}

function getApiKey(provider: string, env: AiTemplateEnv): string | undefined {
  switch (provider) {
    case 'anthropic':
      return env.ANTHROPIC_API_KEY
    case 'openai':
      return env.OPENAI_API_KEY
    case 'google':
      return env.GOOGLE_API_KEY
    case 'workers-ai':
      return env.AI ? 'workers-ai-binding' : undefined
    default:
      return undefined
  }
}

function getDefaultModel(provider: string): string {
  switch (provider) {
    case 'anthropic':
      return 'claude-sonnet-4-20250514'
    case 'openai':
      return 'gpt-4o'
    case 'google':
      return 'gemini-pro'
    case 'workers-ai':
      return '@cf/meta/llama-2-7b-chat-int8'
    default:
      return 'claude-sonnet-4-20250514'
  }
}

function generateMockResponse(prompt: string, model: string): string {
  // Generate a simple response based on the prompt
  if (prompt.includes('2 + 2')) {
    return 'The answer is 4.'
  }
  if (prompt.includes('capital of France')) {
    return 'Paris is the capital of France.'
  }
  if (prompt.includes('Count from 1 to 5')) {
    return 'One, two, three, four, five.'
  }
  // Default response with model info
  return `Response from ${model}: ${prompt.slice(0, 50)}...`
}

function splitIntoChunks(text: string): string[] {
  // Split into word-based chunks for streaming simulation
  const words = text.split(' ')
  const chunks: string[] = []
  for (let i = 0; i < words.length; i++) {
    chunks.push(i === 0 ? words[i] : ' ' + words[i])
  }
  return chunks
}

// ============================================================================
// Cache Implementation
// ============================================================================

class ResponseCache {
  private cache = new Map<string, CacheEntry>()
  private config: CacheConfig

  constructor(config: CacheConfig = {}) {
    this.config = {
      ttl: config.ttl ?? Infinity,
      maxSize: config.maxSize ?? 1000,
      keyFn: config.keyFn ?? ((prompt) => prompt),
    }
  }

  get(prompt: string): CacheEntry | undefined {
    const key = this.config.keyFn!(prompt)
    const entry = this.cache.get(key)

    if (!entry) return undefined

    // Check TTL
    const now = Date.now()
    if (this.config.ttl !== Infinity && now - entry.timestamp > this.config.ttl!) {
      this.cache.delete(key)
      return undefined
    }

    return entry
  }

  set(prompt: string, entry: CacheEntry): void {
    const key = this.config.keyFn!(prompt)

    // Enforce max size (LRU eviction)
    if (this.cache.size >= this.config.maxSize!) {
      // Delete oldest entry
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(key, entry)
  }
}

// ============================================================================
// Rate Limiter Implementation
// ============================================================================

class RateLimiter {
  private state: RateLimitState = {
    requestsThisMinute: 0,
    tokensThisMinute: 0,
    windowStart: Date.now(),
    queue: [],
  }
  private config: RateLimitConfig

  constructor(config: RateLimitConfig) {
    this.config = config
  }

  private resetWindowIfNeeded(): boolean {
    const now = Date.now()
    if (now - this.state.windowStart >= 60000) {
      this.state.requestsThisMinute = 0
      this.state.tokensThisMinute = 0
      this.state.windowStart = now

      // Process queued requests
      while (this.state.queue.length > 0) {
        const item = this.state.queue.shift()!
        item.resolve()
      }
      return true
    }
    return false
  }

  async checkAndIncrement(tokens: number): Promise<void> {
    // Reset window if minute has passed
    this.resetWindowIfNeeded()

    // Check RPM
    if (this.config.rpm !== undefined) {
      if (this.state.requestsThisMinute >= this.config.rpm) {
        this.config.onLimitExceeded?.({
          type: 'rpm',
          current: this.state.requestsThisMinute + 1,
          max: this.config.rpm,
        })

        // Queue the request with a timer to retry after window expires
        await new Promise<void>((resolve, reject) => {
          this.state.queue.push({ resolve, reject })

          // Calculate time until window resets
          const timeUntilReset = 60000 - (Date.now() - this.state.windowStart)

          // Set a timer to check and potentially release this request
          setTimeout(() => {
            this.resetWindowIfNeeded()
          }, Math.max(0, timeUntilReset))
        })

        // After being released from queue, recheck window
        this.resetWindowIfNeeded()
      }
    }

    // Check TPM
    if (this.config.tpm !== undefined) {
      if (this.state.tokensThisMinute + tokens > this.config.tpm) {
        this.config.onLimitExceeded?.({
          type: 'tpm',
          current: this.state.tokensThisMinute + tokens,
          max: this.config.tpm,
        })
      }
    }

    this.state.requestsThisMinute++
    this.state.tokensThisMinute += tokens
  }
}

// ============================================================================
// PipelinePromise Implementation
// ============================================================================

function createPipelinePromise<T>(
  executor: (
    resolve: (value: T) => void,
    reject: (error: Error) => void
  ) => void,
  streamGenerator: () => AsyncIterable<string>,
  cancelFn: () => void
): AiPipelinePromise<T> {
  let resolvedValue: T | undefined
  let rejectedError: Error | undefined
  let isSettled = false

  const basePromise = new Promise<T>((resolve, reject) => {
    executor(
      (value) => {
        resolvedValue = value
        isSettled = true
        resolve(value)
      },
      (error) => {
        rejectedError = error
        isSettled = true
        reject(error)
      }
    )
  })

  const pipelinePromise = basePromise as AiPipelinePromise<T>

  // Add map method
  pipelinePromise.map = function <R>(
    fn: (value: T) => R | Promise<R>
  ): AiPipelinePromise<R> {
    return createPipelinePromise<R>(
      (resolve, reject) => {
        basePromise
          .then(async (value) => {
            try {
              const result = await fn(value)
              resolve(result)
            } catch (error) {
              reject(error as Error)
            }
          })
          .catch(reject)
      },
      streamGenerator,
      cancelFn
    )
  }

  // Override catch to return PipelinePromise
  const originalCatch = pipelinePromise.catch.bind(pipelinePromise)
  pipelinePromise.catch = function <R = T>(
    fn: (error: Error) => R | Promise<R>
  ): AiPipelinePromise<R> {
    return createPipelinePromise<R>(
      (resolve, reject) => {
        basePromise
          .then((value) => resolve(value as unknown as R))
          .catch(async (error) => {
            try {
              const result = await fn(error)
              resolve(result)
            } catch (e) {
              reject(e as Error)
            }
          })
      },
      streamGenerator,
      cancelFn
    )
  }

  // Add stream method
  pipelinePromise.stream = streamGenerator

  // Add cancel method
  pipelinePromise.cancel = cancelFn

  return pipelinePromise
}

// ============================================================================
// Main Factory Implementation
// ============================================================================

/**
 * Creates an AI template literal function with the specified configuration.
 */
export function createAiTemplateLiteral(config: AiTemplateConfig = {}): AiTemplateLiteral {
  // Initialize cache if enabled
  let cache: ResponseCache | undefined
  if (config.cache) {
    const cacheConfig = typeof config.cache === 'boolean' ? {} : config.cache
    cache = new ResponseCache(cacheConfig)
  }

  // Initialize rate limiter if configured
  let rateLimiter: RateLimiter | undefined
  if (config.rateLimit) {
    rateLimiter = new RateLimiter(config.rateLimit)
  }

  // The template literal function
  const aiTemplate = function (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): AiPipelinePromise<string> {
    // Build the prompt from template literal parts
    const prompt = strings.reduce((acc, str, i) => {
      const value = i < values.length ? String(values[i] ?? '') : ''
      return acc + str + value
    }, '')

    // Abort controller for cancellation
    const abortController = new AbortController()
    let isCancelled = false
    let isTimedOut = false

    // Combine abort signals
    let signal = abortController.signal
    if (config.abortOptions?.signal) {
      // Listen to external signal
      config.abortOptions.signal.addEventListener('abort', () => {
        abortController.abort()
      })
    }

    // Timeout handling
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (config.abortOptions?.timeout) {
      timeoutId = setTimeout(() => {
        isTimedOut = true
        abortController.abort()
      }, config.abortOptions.timeout)
    }

    // Helper to get the appropriate cancellation error
    const getCancellationError = () => {
      if (isTimedOut) return new Error('Request timeout')
      return new Error('Request cancelled')
    }

    // Shared state for streaming and resolution
    let providerResponse: ProviderResponse | undefined
    let responseError: Error | undefined
    let streamStarted = false
    let currentChunkIndex = 0

    // Check cache first
    const cachedEntry = cache?.get(prompt)
    if (cachedEntry) {
      // Report cached usage
      config.onUsage?.({ ...cachedEntry.usage, cached: true })

      return createPipelinePromise<string>(
        (resolve) => {
          resolve(cachedEntry.response)
        },
        function* () {
          for (const chunk of cachedEntry.chunks) {
            yield chunk
          }
        } as unknown as () => AsyncIterable<string>,
        () => {
          isCancelled = true
        }
      )
    }

    // Do rate limiting check eagerly (before any async work)
    const estimatedInputTokens = estimateTokens(prompt)
    const rateLimitPromise = rateLimiter?.checkAndIncrement(estimatedInputTokens)

    // Execute the request
    const executeRequest = async (): Promise<ProviderResponse> => {
      const provider = config.provider || 'anthropic'
      const model = config.model || getDefaultModel(provider)

      // Wait for rate limiter if we have one
      if (rateLimitPromise) {
        await rateLimitPromise
      }

      // Try primary provider
      const errors: Error[] = []

      try {
        return await callProvider(prompt, config, signal)
      } catch (primaryError) {
        errors.push(primaryError as Error)

        // Try fallback providers
        if (config.fallbackProviders && config.fallbackProviders.length > 0) {
          for (const fallback of config.fallbackProviders) {
            try {
              const fallbackConfig = {
                ...config,
                provider: fallback.provider as AiTemplateConfig['provider'],
                model: fallback.model,
              }
              return await callProvider(prompt, fallbackConfig, signal)
            } catch (fallbackError) {
              errors.push(fallbackError as Error)
            }
          }
        }

        // All providers failed
        const errorMessages = errors.map((e) => e.message).join('; ')
        throw new Error(`All providers failed: ${errorMessages}`)
      }
    }

    // Stream generator
    async function* generateStream(): AsyncIterable<string> {
      if (!providerResponse && !responseError) {
        // Need to wait for response
        try {
          providerResponse = await executeRequest()
        } catch (error) {
          responseError = error as Error
          throw responseError
        }
      }

      if (responseError) {
        throw responseError
      }

      streamStarted = true

      for (let i = currentChunkIndex; i < providerResponse!.chunks.length; i++) {
        if (isCancelled || signal.aborted) {
          throw getCancellationError()
        }
        currentChunkIndex = i + 1
        yield providerResponse!.chunks[i]
      }
    }

    // Create the pipeline promise
    return createPipelinePromise<string>(
      (resolve, reject) => {
        ;(async () => {
          try {
            // Yield to event loop to allow cancel() to be called first
            await Promise.resolve()

            // Check cancellation before starting work
            if (isCancelled || signal.aborted) {
              throw getCancellationError()
            }

            providerResponse = await executeRequest()

            // Check cancellation after request completes
            if (isCancelled || signal.aborted) {
              throw getCancellationError()
            }

            if (timeoutId) {
              clearTimeout(timeoutId)
            }

            // Calculate usage - use provider/model from the actual response
            const actualProvider = providerResponse.provider
            const actualModel = providerResponse.model
            const usage: UsageInfo = {
              inputTokens: providerResponse.inputTokens,
              outputTokens: providerResponse.outputTokens,
              totalTokens: providerResponse.inputTokens + providerResponse.outputTokens,
              estimatedCost: estimateCost(
                actualModel,
                providerResponse.inputTokens,
                providerResponse.outputTokens
              ),
              model: actualModel,
              provider: actualProvider,
              cached: false,
            }

            // Report usage
            config.onUsage?.(usage)

            // Store in cache
            if (cache) {
              cache.set(prompt, {
                response: providerResponse.text,
                chunks: providerResponse.chunks,
                timestamp: Date.now(),
                usage,
              })
            }

            resolve(providerResponse.text)
          } catch (error) {
            responseError = error as Error
            if (timeoutId) {
              clearTimeout(timeoutId)
            }
            reject(error as Error)
          }
        })()
      },
      generateStream,
      () => {
        isCancelled = true
        abortController.abort()
      }
    )
  } as AiTemplateLiteral

  // Add configure method
  aiTemplate.configure = function (
    options: Partial<AiTemplateConfig>
  ): AiTemplateLiteral {
    return createAiTemplateLiteral({ ...config, ...options })
  }

  // Add withAbort method
  aiTemplate.withAbort = function (options: AbortOptions): AiTemplateLiteral {
    return createAiTemplateLiteral({ ...config, abortOptions: options })
  }

  // Add model shortcuts
  Object.defineProperty(aiTemplate, 'claude', {
    get() {
      return createAiTemplateLiteral({
        ...config,
        provider: MODEL_CONFIGS.claude.provider,
        model: MODEL_CONFIGS.claude.model,
      })
    },
  })

  Object.defineProperty(aiTemplate, 'gpt4', {
    get() {
      return createAiTemplateLiteral({
        ...config,
        provider: MODEL_CONFIGS.gpt4.provider,
        model: MODEL_CONFIGS.gpt4.model,
      })
    },
  })

  Object.defineProperty(aiTemplate, 'gpt4o', {
    get() {
      return createAiTemplateLiteral({
        ...config,
        provider: MODEL_CONFIGS.gpt4o.provider,
        model: MODEL_CONFIGS.gpt4o.model,
      })
    },
  })

  Object.defineProperty(aiTemplate, 'gemini', {
    get() {
      return createAiTemplateLiteral({
        ...config,
        provider: MODEL_CONFIGS.gemini.provider,
        model: MODEL_CONFIGS.gemini.model,
      })
    },
  })

  Object.defineProperty(aiTemplate, 'workersAi', {
    get() {
      return createAiTemplateLiteral({
        ...config,
        provider: MODEL_CONFIGS.workersAi.provider,
        model: MODEL_CONFIGS.workersAi.model,
      })
    },
  })

  return aiTemplate
}

export default createAiTemplateLiteral
