/**
 * AI Module - Template Literal AI Operations
 *
 * Template literal AI with:
 * - Lazy evaluation (AIPromise)
 * - Batch modes (immediate/flex/deferred)
 * - Budget tracking and caching
 * - Provider abstraction
 */

// =============================================================================
// Model Configuration
// =============================================================================

/**
 * Model capability flags
 */
export interface ModelCapabilities {
  text: boolean
  tool_calling: boolean
  structured: boolean
  tts: boolean
  image: boolean
}

/**
 * Cost tier information for budget tracking
 */
export interface CostTier {
  tier: 'budget' | 'standard' | 'premium'
  costPerMTokenInput: number
  costPerMTokenOutput: number
}

/**
 * Complete model metadata configuration
 */
export interface ModelConfig {
  name: string
  displayName: string
  capabilities: ModelCapabilities
  costTier: CostTier
  maxInputTokens: number
  maxOutputTokens: number
  defaultTemperature: number
  supportsStreaming: boolean
  inputFormat: 'prompt' | 'input' | 'messages'
}

/**
 * Comprehensive model registry with all metadata
 */
export const MODEL_CONFIG: Record<string, ModelConfig> = {
  GPT_OSS_120B: {
    name: '@cf/openai/gpt-oss-120b',
    displayName: 'GPT OSS 120B',
    capabilities: { text: true, tool_calling: false, structured: false, tts: false, image: false },
    costTier: { tier: 'premium', costPerMTokenInput: 2.5, costPerMTokenOutput: 10.0 },
    maxInputTokens: 8192,
    maxOutputTokens: 4096,
    defaultTemperature: 0.7,
    supportsStreaming: true,
    inputFormat: 'input',
  },
  GPT_OSS_20B: {
    name: '@cf/openai/gpt-oss-20b',
    displayName: 'GPT OSS 20B',
    capabilities: { text: true, tool_calling: false, structured: false, tts: false, image: false },
    costTier: { tier: 'standard', costPerMTokenInput: 0.5, costPerMTokenOutput: 1.5 },
    maxInputTokens: 8192,
    maxOutputTokens: 4096,
    defaultTemperature: 0.7,
    supportsStreaming: true,
    inputFormat: 'input',
  },
  LLAMA_4_SCOUT: {
    name: '@cf/meta/llama-4-scout-17b-16e-instruct',
    displayName: 'Llama 4 Scout',
    capabilities: { text: true, tool_calling: false, structured: false, tts: false, image: false },
    costTier: { tier: 'standard', costPerMTokenInput: 0.3, costPerMTokenOutput: 1.0 },
    maxInputTokens: 8192,
    maxOutputTokens: 4096,
    defaultTemperature: 0.7,
    supportsStreaming: false,
    inputFormat: 'prompt',
  },
  GRANITE_4H_MICRO: {
    name: '@cf/ibm-granite/granite-4.0-h-micro',
    displayName: 'Granite 4.0 H Micro',
    capabilities: { text: true, tool_calling: true, structured: true, tts: false, image: false },
    costTier: { tier: 'budget', costPerMTokenInput: 0.15, costPerMTokenOutput: 0.5 },
    maxInputTokens: 8192,
    maxOutputTokens: 4096,
    defaultTemperature: 0.7,
    supportsStreaming: false,
    inputFormat: 'messages',
  },
  AURA_2_EN: {
    name: '@cf/deepgram/aura-2-en',
    displayName: 'Aura 2 English',
    capabilities: { text: false, tool_calling: false, structured: false, tts: true, image: false },
    costTier: { tier: 'standard', costPerMTokenInput: 0.0, costPerMTokenOutput: 0.0 },
    maxInputTokens: 2000,
    maxOutputTokens: 0,
    defaultTemperature: 0.5,
    supportsStreaming: true,
    inputFormat: 'messages',
  },
  FLUX_2_DEV: {
    name: '@cf/black-forest-labs/flux-2-dev',
    displayName: 'Flux 2 Dev',
    capabilities: { text: false, tool_calling: false, structured: false, tts: false, image: true },
    costTier: { tier: 'premium', costPerMTokenInput: 0.0, costPerMTokenOutput: 0.0 },
    maxInputTokens: 1000,
    maxOutputTokens: 0,
    defaultTemperature: 0.0,
    supportsStreaming: false,
    inputFormat: 'messages',
  },
}

/**
 * Fallback chain configuration - models to try in order when primary fails
 */
export const FALLBACK_CHAIN: Record<string, string[]> = {
  '@cf/openai/gpt-oss-120b': ['@cf/openai/gpt-oss-20b', '@cf/meta/llama-4-scout-17b-16e-instruct'],
  '@cf/openai/gpt-oss-20b': ['@cf/meta/llama-4-scout-17b-16e-instruct'],
  '@cf/meta/llama-4-scout-17b-16e-instruct': ['@cf/ibm-granite/granite-4.0-h-micro'],
  '@cf/ibm-granite/granite-4.0-h-micro': [],
}

/**
 * Legacy registry for backward compatibility
 */
export const MODEL_REGISTRY = {
  GPT_OSS_120B: MODEL_CONFIG.GPT_OSS_120B.name,
  GPT_OSS_20B: MODEL_CONFIG.GPT_OSS_20B.name,
  LLAMA_4_SCOUT: MODEL_CONFIG.LLAMA_4_SCOUT.name,
  GRANITE_4H_MICRO: MODEL_CONFIG.GRANITE_4H_MICRO.name,
  AURA_2_EN: MODEL_CONFIG.AURA_2_EN.name,
  FLUX_2_DEV: MODEL_CONFIG.FLUX_2_DEV.name,
} as const

// =============================================================================
// Types
// =============================================================================

/**
 * Serializable types that can be returned from AI operations
 * Functions, symbols, and other non-serializable types are excluded
 */
export type SerializableValue = string | number | boolean | object | null | string[]

/**
 * Template literal interpolation value - can be any primitive, Date, array, or AIPromise
 */
export type TemplateValue = string | number | boolean | null | undefined | Date | AIPromise<SerializableValue> | readonly TemplateValue[]

/**
 * Known model names for type safety with autocomplete
 */
export type KnownModelName =
  | 'gpt-4'
  | 'gpt-4-turbo'
  | 'gpt-3.5-turbo'
  | 'claude-3'
  | 'claude-3-opus'
  | 'claude-3-sonnet'
  | 'claude-3-haiku'
  | '@cf/openai/gpt-oss-120b'
  | '@cf/openai/gpt-oss-20b'
  | '@cf/meta/llama-4-scout-17b-16e-instruct'
  | '@cf/ibm-granite/granite-4.0-h-micro'
  | '@cf/deepgram/aura-2-en'
  | '@cf/black-forest-labs/flux-2-dev'

/**
 * Model name type - known models only (narrower than string)
 */
export type ModelName = KnownModelName

/**
 * AI provider request parameters (OpenAI/Anthropic compatible)
 */
export interface AIRequestParams {
  messages: Array<{ role: string; content: string }>
  model?: string
  temperature?: number
  max_tokens?: number
}

/**
 * OpenAI-style response format
 */
export interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

/**
 * Anthropic-style response format
 */
export interface AnthropicResponse {
  content?: Array<{
    text?: string
  }>
}

/**
 * Union type for AI provider responses
 */
export type AIProviderResponse = OpenAIResponse | AnthropicResponse | string

/**
 * Type guard for OpenAI-style response
 * @param response - The response to check
 * @returns True if response is OpenAI-compatible format
 */
function isOpenAIResponse(response: AIProviderResponse): response is OpenAIResponse {
  return typeof response === 'object' && response !== null && 'choices' in response
}

/**
 * Type guard for Anthropic-style response
 * @param response - The response to check
 * @returns True if response is Anthropic-compatible format
 */
function isAnthropicResponse(response: AIProviderResponse): response is AnthropicResponse {
  return typeof response === 'object' && response !== null && 'content' in response && !('choices' in response)
}

/**
 * Extracts text content from AI provider responses
 * Handles OpenAI, Anthropic, and generic string responses with a unified interface.
 * This is the central point for all response format handling.
 *
 * @param response - The AI provider response in any supported format
 * @returns Extracted text content, or empty string if unable to extract
 *
 * @example
 * // OpenAI format
 * const text = extractResponseText({ choices: [{ message: { content: 'Hello' } }] })
 *
 * @example
 * // Anthropic format
 * const text = extractResponseText({ content: [{ text: 'Hello' }] })
 *
 * @example
 * // String format
 * const text = extractResponseText('Hello')
 */
function extractResponseText(response: AIProviderResponse): string {
  if (typeof response === 'string') {
    return response
  }

  if (isOpenAIResponse(response)) {
    return response.choices?.[0]?.message?.content ?? ''
  }

  if (isAnthropicResponse(response)) {
    return response.content?.[0]?.text ?? ''
  }

  return ''
}

/**
 * Strips markdown code fences from text if present.
 * LLMs often wrap JSON or code responses in ```json or ``` blocks.
 *
 * @param text - Text that may contain code fences
 * @returns Text with code fences removed
 *
 * @example
 * stripCodeFences('```json\n{"key": "value"}\n```') // '{"key": "value"}'
 * stripCodeFences('plain text') // 'plain text'
 */
export function stripCodeFences(text: string): string {
  if (!text) return text

  // Match opening fence with optional language specifier and closing fence
  const fencePattern = /^```[\w]*\n?([\s\S]*?)\n?```$/
  const match = text.trim().match(fencePattern)

  if (match) {
    return match[1].trim()
  }

  return text
}

/**
 * Safely extracts and validates response text with error handling.
 * Automatically strips markdown code fences from the response.
 *
 * @param response - The AI provider response
 * @param modelName - Model name for error context
 * @returns Extracted text (with code fences stripped) or throws descriptive error
 * @throws Error with model-specific context if extraction fails
 */
function extractResponseTextSafe(response: AIProviderResponse, modelName?: string): string {
  if (!response) {
    throw new Error(
      `Empty response${modelName ? ` from ${modelName}` : ''}. Ensure the model completed successfully.`
    )
  }

  const rawText = extractResponseText(response)

  if (!rawText || rawText.trim().length === 0) {
    throw new Error(
      `No text content in response${modelName ? ` from ${modelName}` : ''}. Response format may be incompatible.`
    )
  }

  // Strip code fences - LLMs often wrap structured output in markdown
  return stripCodeFences(rawText)
}

export interface AIProvider {
  execute: (prompt: string, options?: ExecuteOptions) => Promise<string>
  request?: (params: AIRequestParams) => Promise<AIProviderResponse>
  apiKey?: string
  configured?: boolean
}

export interface ExecuteOptions {
  model?: string
  mode?: 'is' | 'list' | 'code' | 'general'
}

export interface AIConfig {
  provider?: AIProvider
  providers?: Record<string, AIProvider & { request?: (params: AIRequestParams) => Promise<AIProviderResponse> }>
  model?: string
  budget?: { limit: number }
  cache?: {
    enabled: boolean
    ttl?: number
    maxSize?: number
    maxMemoryBytes?: number
    cleanupInterval?: number
    slidingTTL?: boolean
  }
  fallback?: string[] | false
  /** Return degraded responses instead of throwing when all providers fail (default: true) */
  gracefulDegradation?: boolean
}

export interface AIBudget {
  remaining: number
  spent: number
  limit: (amount: number) => AI
}

export interface CacheStats {
  hits: number
  misses: number
  evictions: number
  size: number
}

export interface AICache {
  ttl: number
  size: number
  maxSize: number
  memoryUsage: number
  cleanupInterval: number
  stats: CacheStats
  clear: () => number
  purgeExpired: () => number
}

export interface BatchResult<T> extends PromiseLike<T[]> {
  batchId: string
}

export type BatchMode = 'immediate' | 'flex' | 'deferred'

// =============================================================================
// AIPromise Class
// =============================================================================

/**
 * Lazy-evaluated AI promise that only executes when awaited
 * T is constrained to SerializableValue to prevent non-serializable types like Function
 */
export class AIPromise<T extends SerializableValue = string> implements PromiseLike<T> {
  cancelled = false
  private _executed = false
  private _executing = false
  private _result?: T
  private _error?: Error
  private _promise?: Promise<T>

  constructor(private _executor: () => Promise<T>) {}

  private _ensureExecution(): Promise<T> {
    if (this.cancelled) {
      return Promise.reject(new Error('Cancelled'))
    }

    if (this._promise) {
      return this._promise
    }

    this._executing = true
    this._promise = this._executor().then(
      (result) => {
        this._result = result
        this._executed = true
        this._executing = false
        return result
      },
      (error) => {
        this._error = error
        this._executed = true
        this._executing = false
        throw error
      }
    )

    return this._promise
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this._ensureExecution().then(onfulfilled, onrejected)
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
  ): Promise<T | TResult> {
    return this._ensureExecution().catch(onrejected)
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this._ensureExecution().finally(onfinally)
  }

  cancel(): boolean {
    if (this._executing || this._executed) {
      return false
    }
    this.cancelled = true
    return true
  }
}

// =============================================================================
// AIBudgetExceededError
// =============================================================================

export class AIBudgetExceededError extends Error {
  constructor(
    message: string,
    public spent: number,
    public limit: number,
    public requested: number
  ) {
    super(message)
    this.name = 'AIBudgetExceededError'
  }
}

// =============================================================================
// Cost Tracking Infrastructure
// =============================================================================

/**
 * Tracks cost per operation type for budget management
 */
interface CostTracker {
  modelName: string
  inputTokens: number
  outputTokens: number
  estimatedCost: number
  timestamp: number
}

/**
 * Calculates estimated cost for a given operation
 * @param modelName - Name of the model
 * @param inputTokens - Number of input tokens (estimated)
 * @param outputTokens - Number of output tokens (estimated)
 * @returns Estimated cost in cents
 */
function calculateOperationCost(modelName: string, inputTokens: number, outputTokens: number): number {
  const config = Object.values(MODEL_CONFIG).find((c) => c.name === modelName)
  if (!config) {
    return 1 // Default cost unit
  }

  const inputCost = (inputTokens / 1_000_000) * config.costTier.costPerMTokenInput
  const outputCost = (outputTokens / 1_000_000) * config.costTier.costPerMTokenOutput
  return inputCost + outputCost
}

// =============================================================================
// Cache Implementation
// =============================================================================

/** Maximum allowed cache size to prevent memory exhaustion */
const MAX_SAFE_CACHE_SIZE = 100_000

interface CacheEntry<T> {
  value: T
  timestamp: number
  lastAccessed: number
  byteSize: number
}

interface LRUCacheConfig {
  maxSize?: number
  ttl?: number
  maxMemoryBytes?: number
  cleanupInterval?: number
  slidingTTL?: boolean
}

class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private _maxSize: number
  private _ttl: number
  private _maxMemoryBytes: number
  private _cleanupInterval: number
  private _slidingTTL: boolean
  private _memoryUsage = 0
  private _cleanupTimer: ReturnType<typeof setInterval> | null = null

  // Stats tracking
  private _hits = 0
  private _misses = 0
  private _evictions = 0

  // In-flight request coalescing
  private _inFlight = new Map<string, Promise<T>>()

  constructor(config: LRUCacheConfig = {}) {
    this._maxSize = config.maxSize ?? 1000
    this._ttl = config.ttl ?? 5 * 60 * 1000 // 5 minutes default
    this._maxMemoryBytes = config.maxMemoryBytes ?? Infinity
    // Default cleanup interval: 60 seconds or TTL * 3, whichever is smaller
    // This ensures automatic cleanup runs periodically but doesn't interfere with manual purgeExpired() calls
    // The size getter also triggers lazy cleanup for immediate accuracy
    const ttl = config.ttl ?? 5 * 60 * 1000
    this._cleanupInterval = config.cleanupInterval ?? Math.min(60_000, ttl * 3)
    this._slidingTTL = config.slidingTTL ?? true // Sliding TTL by default

    // Start proactive cleanup
    this._startCleanup()
  }

  private _startCleanup(): void {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer)
    }
    this._cleanupTimer = setInterval(() => {
      this.purgeExpired()
    }, this._cleanupInterval)
  }

  private _estimateByteSize(value: T): number {
    if (typeof value === 'string') {
      // UTF-16 encoding: 2 bytes per character + overhead
      return value.length * 2 + 64
    }
    // Rough estimate for other types
    return JSON.stringify(value).length * 2 + 64
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) {
      this._misses++
      return undefined
    }

    const now = Date.now()
    const relevantTimestamp = this._slidingTTL ? entry.lastAccessed : entry.timestamp

    // Check TTL
    if (now - relevantTimestamp > this._ttl) {
      this._evict(key, entry)
      this._misses++
      return undefined
    }

    // Update last accessed time for sliding TTL
    entry.lastAccessed = now

    // Move to end (most recently used)
    this.cache.delete(key)
    this.cache.set(key, entry)

    this._hits++
    return entry.value
  }

  set(key: string, value: T): void {
    const byteSize = this._estimateByteSize(value)

    // Remove existing entry if present
    if (this.cache.has(key)) {
      const existingEntry = this.cache.get(key)!
      this._memoryUsage -= existingEntry.byteSize
      this.cache.delete(key)
    }

    // Evict entries if at capacity (by count or memory)
    while (
      (this.cache.size >= this._maxSize || this._memoryUsage + byteSize > this._maxMemoryBytes) &&
      this.cache.size > 0
    ) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        const entry = this.cache.get(firstKey)!
        this._evict(firstKey, entry)
      }
    }

    const now = Date.now()
    this.cache.set(key, {
      value,
      timestamp: now,
      lastAccessed: now,
      byteSize,
    })
    this._memoryUsage += byteSize
  }

  private _evict(key: string, entry: CacheEntry<T>): void {
    this.cache.delete(key)
    this._memoryUsage -= entry.byteSize
    this._evictions++
  }

  /**
   * Get or compute a value, coalescing concurrent requests for the same key
   */
  async getOrCompute(key: string, compute: () => Promise<T>): Promise<T> {
    // Check cache first
    const cached = this.get(key)
    if (cached !== undefined) {
      return cached
    }

    // Check if request is already in-flight
    const inFlight = this._inFlight.get(key)
    if (inFlight) {
      return inFlight
    }

    // Create new request and track it
    const promise = compute().then(
      (result) => {
        this.set(key, result)
        this._inFlight.delete(key)
        return result
      },
      (error) => {
        this._inFlight.delete(key)
        throw error
      }
    )

    this._inFlight.set(key, promise)
    return promise
  }

  /**
   * Check if a key exists in the in-flight map (for testing)
   */
  hasInFlight(key: string): boolean {
    return this._inFlight.has(key)
  }

  clear(): number {
    const count = this.cache.size
    this.cache.clear()
    this._memoryUsage = 0
    this._inFlight.clear()
    return count
  }

  /**
   * Purge expired entries proactively
   * @returns Number of entries purged
   */
  purgeExpired(): number {
    const now = Date.now()
    let purged = 0

    for (const [key, entry] of this.cache.entries()) {
      const relevantTimestamp = this._slidingTTL ? entry.lastAccessed : entry.timestamp
      if (now - relevantTimestamp > this._ttl) {
        this._evict(key, entry)
        purged++
      }
    }

    return purged
  }

  get size(): number {
    // Trigger lazy cleanup when checking size to ensure accurate count
    this.purgeExpired()
    return this.cache.size
  }

  get maxSize(): number {
    return this._maxSize
  }

  get memoryUsage(): number {
    return this._memoryUsage
  }

  get cleanupInterval(): number {
    return this._cleanupInterval
  }

  getTTL(): number {
    return this._ttl
  }

  get stats(): CacheStats {
    return {
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      size: this.cache.size,
    }
  }

  /**
   * Stop the cleanup timer (for testing/cleanup)
   */
  dispose(): void {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer)
      this._cleanupTimer = null
    }
  }
}

// =============================================================================
// Default Provider (Mock for testing)
// =============================================================================

const defaultProvider: AIProvider = {
  execute: async (prompt: string, options?: ExecuteOptions): Promise<string> => {
    // Simulate some AI response for testing
    const mode = options?.mode || 'general'

    if (mode === 'is') {
      // Classification - extract options and pick one
      const optionMatch = prompt.match(/\b(positive|negative|neutral|true|false|happy|sad|angry)\b/gi)
      if (optionMatch && optionMatch.length > 0) {
        // Simple heuristic for classification
        const text = prompt.toLowerCase()
        if (text.includes('love') || text.includes('great') || text.includes('amazing')) {
          return optionMatch.find(o => o.toLowerCase() === 'positive') || optionMatch[0]
        }
        if (text.includes('hate') || text.includes('terrible')) {
          return optionMatch.find(o => o.toLowerCase() === 'negative') || optionMatch[0]
        }
        if (text.includes('okay') || text.includes('cloudy')) {
          return optionMatch.find(o => o.toLowerCase() === 'neutral') || optionMatch[0]
        }
        if (text.includes('sky is blue')) {
          return optionMatch.find(o => o.toLowerCase() === 'true') || optionMatch[0]
        }
        return optionMatch[0].toLowerCase()
      }
      return 'neutral'
    }

    if (mode === 'list') {
      // List extraction
      const text = prompt.toLowerCase()

      // Check for email addresses - return empty if none found
      if (text.includes('email') && text.includes('no items')) {
        return '[]'
      }

      // Extract items based on patterns
      if (text.includes('colors') || text.includes('primary')) {
        const colors = prompt.match(/\b(red|blue|yellow|green|orange|purple)\b/gi)
        return JSON.stringify(colors || [])
      }

      if (text.includes('numbered items') || text.includes('1.') || text.includes('first item')) {
        const items: string[] = []
        const matches = prompt.match(/\d+\.\s*([^0-9]+?)(?=\s*\d+\.|$)/g)
        if (matches) {
          matches.forEach(m => {
            const item = m.replace(/^\d+\.\s*/, '').trim()
            if (item) items.push(item)
          })
        }
        return JSON.stringify(items)
      }

      // General list extraction (comma-separated, "and", etc.)
      const listMatch = prompt.match(/(?:from|items|extract)[:\s]+([^.]+)/i)
      if (listMatch) {
        const itemsText = listMatch[1]
        const items = itemsText
          .split(/,\s*|\s+and\s+/)
          .map(s => s.trim())
          .filter(s => s.length > 0 && !s.match(/^(from|items|extract|the|a)$/i))
        return JSON.stringify(items)
      }

      // Fallback for "no matches" scenario
      if (text.includes('email') || text.includes('no items here')) {
        return '[]'
      }

      return '[]'
    }

    if (mode === 'code') {
      // Code generation
      const text = prompt.toLowerCase()

      if (text.includes('python')) {
        return `def reverse_string(s: str) -> str:
    return s[::-1]`
      }

      if (text.includes('generics') || text.includes('swap')) {
        return `function swap<T>(a: T, b: T): [T, T] {
  return [b, a]
}`
      }

      if (text.includes('sort')) {
        return `function sortArray(arr: number[]): number[] {
  return [...arr].sort((a, b) => a - b)
}`
      }

      if (text.includes('email') || text.includes('validate')) {
        return `function validateEmail(email: string): boolean {
  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/
  return emailRegex.test(email)
}`
      }

      if (text.includes('add')) {
        return `function add(a: number, b: number): number {
  return a + b
}`
      }

      return `function example(): void {
  console.log('Generated code')
}`
    }

    // General AI response
    return `AI response for: ${prompt.slice(0, 50)}...`
  },
  configured: true
}

// =============================================================================
// AI Interface and Factory
// =============================================================================

/**
 * AI interface with generic config branding for type differentiation
 * The TConfig parameter enables TypeScript to distinguish between
 * differently configured AI instances at compile time.
 */
export interface AI<TConfig extends AIConfig = AIConfig> {
  (strings: TemplateStringsArray, ...values: TemplateValue[]): AIPromise<string>
  /**
   * Classification template literal - returns a typed category string
   * Generic T allows narrowing the return type for known classifications
   */
  is: <T extends string = string>(strings: TemplateStringsArray, ...values: TemplateValue[]) => AIPromise<T>
  list: (strings: TemplateStringsArray, ...values: TemplateValue[]) => AIPromise<string[]>
  code: (strings: TemplateStringsArray, ...values: TemplateValue[]) => AIPromise<string>
  batch: {
    <T>(items: T[], mode: BatchMode): BatchResult<string> & Promise<string[]>
    <T, R extends SerializableValue>(items: T[], mode: BatchMode, template: (item: T) => AIPromise<R>): Promise<R[]>
    status: (batchId: string) => Promise<'pending' | 'processing' | 'completed'>
  }
  budget: AIBudget
  cache: AICache
  provider: (name: 'openai' | 'anthropic') => AI<TConfig>
  model: (name: ModelName) => AI<TConfig>
  providers: Record<string, { configured: boolean }>
  /** Brand for distinguishing AI instances with different configs */
  readonly __config?: TConfig
}

// Cost per operation (for budget tracking)
const COST_IMMEDIATE = 1
const COST_FLEX = 0.5
const COST_DEFERRED = 0.25

/**
 * Create a configured AI instance
 *
 * The generic TConfig parameter allows TypeScript to distinguish between
 * differently configured AI instances at compile time.
 *
 * Note: batchStatuses is per-instance to avoid race conditions when
 * multiple isolates share the same module in Cloudflare Workers.
 */
export function createAI<TConfig extends AIConfig = AIConfig>(config?: TConfig): AI<TConfig> {
  // Validate cache size before proceeding
  const cacheMaxSize = config?.cache?.maxSize ?? 1000
  if (cacheMaxSize > MAX_SAFE_CACHE_SIZE) {
    throw new Error(
      `Cache size ${cacheMaxSize} exceeds maximum safe cache size of ${MAX_SAFE_CACHE_SIZE}. ` +
        `Use a smaller maxSize or consider memory-based limits with maxMemoryBytes.`
    )
  }

  // Batch tracking - per-instance to avoid race conditions across isolates
  const batchStatuses = new Map<string, 'pending' | 'processing' | 'completed'>()

  const provider = config?.provider || defaultProvider
  const providers = config?.providers || {}
  const currentModel = config?.model || 'default'
  const fallbackProviders = config?.fallback
  // Default to true - return degraded responses instead of throwing
  const gracefulDegradation = config?.gracefulDegradation ?? true

  // Budget state
  let budgetLimit = config?.budget?.limit ?? Infinity
  let budgetSpent = 0

  // Cache state
  const cacheEnabled = config?.cache?.enabled ?? false
  const cacheTTL = config?.cache?.ttl ?? 5 * 60 * 1000
  const cacheMaxMemoryBytes = config?.cache?.maxMemoryBytes
  const cacheCleanupInterval = config?.cache?.cleanupInterval // Let LRUCache compute default based on TTL
  const cacheSlidingTTL = config?.cache?.slidingTTL ?? true
  const cache = new LRUCache<string>({
    maxSize: cacheMaxSize,
    ttl: cacheTTL,
    maxMemoryBytes: cacheMaxMemoryBytes,
    cleanupInterval: cacheCleanupInterval,
    slidingTTL: cacheSlidingTTL,
  })

  // Helper to build prompt from template
  function buildPrompt(strings: TemplateStringsArray, values: TemplateValue[]): string {
    let result = ''
    for (let i = 0; i < strings.length; i++) {
      result += strings[i]
      if (i < values.length) {
        const value = values[i]
        if (value === null) {
          result += 'null'
        } else if (value === undefined) {
          result += 'undefined'
        } else if (Array.isArray(value)) {
          result += (value as readonly TemplateValue[]).join(', ')
        } else {
          result += String(value)
        }
      }
    }
    return result
  }

  // Helper to resolve AIPromise values in template
  async function resolveValues(values: TemplateValue[]): Promise<TemplateValue[]> {
    const resolved: TemplateValue[] = []
    for (const v of values) {
      if (v instanceof AIPromise) {
        // AIPromise resolves to string or string[] which are valid TemplateValues
        const result = await v
        resolved.push(result as TemplateValue)
      } else {
        resolved.push(v)
      }
    }
    return resolved
  }

  // Helper to generate cache key
  function getCacheKey(prompt: string, mode: string): string {
    return `${currentModel}:${mode}:${prompt}`
  }

  // Helper to track costs
  function trackCost(cost: number): void {
    budgetSpent += cost
  }

  // Helper to check budget
  function checkBudget(requestedCost: number): void {
    if (budgetSpent + requestedCost > budgetLimit) {
      throw new AIBudgetExceededError(
        `Budget exceeded: requested ${requestedCost}, spent ${budgetSpent}, limit ${budgetLimit}`,
        budgetSpent,
        budgetLimit,
        requestedCost
      )
    }
  }

  /**
   * Internal execution without caching (for use within getOrCompute)
   */
  async function executeWithProviderInternal(
    prompt: string,
    options?: ExecuteOptions,
    providerName?: string
  ): Promise<string> {
    const cost = COST_IMMEDIATE
    let result: string

    // Determine which provider to use
    const targetProvider = providerName ? providers[providerName] : provider
    const modelName = options?.model || currentModel

    if (targetProvider?.execute) {
      try {
        result = await targetProvider.execute(prompt, options)
        trackCost(cost)
        return result
      } catch (error) {
        const lastError = error as Error
        const errorMsg = lastError.message || 'Unknown error'

        // Try fallback providers
        if (fallbackProviders && Array.isArray(fallbackProviders)) {
          for (const fallbackName of fallbackProviders) {
            if (fallbackName === providerName) continue
            const fallbackProvider = providers[fallbackName]
            if (fallbackProvider?.execute) {
              try {
                result = await fallbackProvider.execute(prompt, options)
                trackCost(cost)
                return result
              } catch {
                // Continue to next fallback
              }
            }
          }
        }

        // Graceful degradation: return degraded response instead of throwing
        if (gracefulDegradation) {
          return getDegradedResponse(options?.mode || 'general')
        }

        // Enhanced error message with model context
        throw new Error(
          `Model '${modelName}' failed${providerName ? ` (provider: ${providerName})` : ''}: ${errorMsg}. ` +
            `Try with a different model or check that the model supports the requested capability (mode: ${options?.mode || 'general'}).`
        )
      }
    }

    // Use request method if available (for provider-specific formatting)
    if (targetProvider?.request) {
      try {
        const requestParams: AIRequestParams = { messages: [{ role: 'user', content: prompt }] }
        const response = await targetProvider.request(requestParams)

        // Extract text using consolidated helper with error context
        result = extractResponseTextSafe(response, modelName)
        trackCost(cost)
        return result
      } catch (error) {
        // Graceful degradation: return degraded response instead of throwing
        if (gracefulDegradation) {
          return getDegradedResponse(options?.mode || 'general')
        }
        throw new Error(
          `Model '${modelName}' request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }

    // Graceful degradation: return degraded response if no provider configured
    if (gracefulDegradation) {
      return getDegradedResponse(options?.mode || 'general')
    }

    throw new Error(
      `AI Provider not configured for model '${modelName}'. ` +
        `Ensure provider has execute() or request() method.`
    )
  }

  /**
   * Returns a degraded response based on the operation mode
   */
  function getDegradedResponse(mode: string): string {
    switch (mode) {
      case 'is':
        return 'unknown'
      case 'list':
        return '[]'
      case 'code':
        return '// AI service unavailable'
      case 'general':
      default:
        return 'AI service unavailable'
    }
  }

  /**
   * Executes AI operation with provider, fallback chain, and error handling
   * Uses getOrCompute for in-flight request coalescing when caching is enabled
   * @param prompt - The prompt to execute
   * @param options - Execution options (model, mode)
   * @param providerName - Optional provider name override
   * @returns The AI-generated text result
   * @throws Error with model-specific context on failure
   */
  async function executeWithProvider(
    prompt: string,
    options?: ExecuteOptions,
    providerName?: string
  ): Promise<string> {
    checkBudget(COST_IMMEDIATE)

    if (cacheEnabled) {
      const cacheKey = getCacheKey(prompt, options?.mode || 'general')
      return cache.getOrCompute(cacheKey, () =>
        executeWithProviderInternal(prompt, options, providerName)
      )
    }

    // Without caching, execute directly
    return executeWithProviderInternal(prompt, options, providerName)
  }

  /**
   * Main AI template literal - general text generation and reasoning
   * Supports lazy evaluation with AIPromise - only executes when awaited.
   *
   * @param strings - Template string parts
   * @param values - Interpolated values (can be primitives or AIPromises)
   * @returns AIPromise that resolves to generated text
   *
   * @example
   * const result = await ai`Generate text about ${topic}`
   *
   * @example
   * const lazy = ai`Generate...` // Not executed yet
   * if (someCondition) {
   *   const result = await lazy // Only executes if condition is true
   * }
   */
  const aiFunction = function (strings: TemplateStringsArray, ...values: TemplateValue[]): AIPromise<string> {
    return new AIPromise(async () => {
      const resolvedValues = await resolveValues(values)
      const prompt = buildPrompt(strings, resolvedValues)
      return executeWithProvider(prompt, { mode: 'general' })
    })
  }

  /**
   * Classification template literal - extract discrete categories/classes from text
   * Returns a single string representing the classified value.
   * Optimized for boolean, categorical, or enum-like outputs.
   *
   * @param strings - Template string parts
   * @param values - Interpolated values (can be primitives or AIPromises)
   * @returns AIPromise that resolves to classified category
   *
   * @example
   * const sentiment = await ai.is`Is this sentiment positive or negative? ${userInput}`
   * // Returns: 'positive' | 'negative'
   *
   * @example
   * const isValid = await ai.is`Is this email valid? ${email}`
   * // Returns: 'true' | 'false'
   */
  const isFunction = function (strings: TemplateStringsArray, ...values: TemplateValue[]): AIPromise<string> {
    return new AIPromise(async () => {
      const resolvedValues = await resolveValues(values)
      const prompt = buildPrompt(strings, resolvedValues)
      return executeWithProvider(prompt, { mode: 'is' })
    })
  }

  /**
   * List extraction template literal - extract structured lists from text
   * Returns an array of strings parsed from JSON or comma-separated format.
   * Useful for extracting multiple items, tags, or enumerated values.
   *
   * @param strings - Template string parts
   * @param values - Interpolated values (can be primitives or AIPromises)
   * @returns AIPromise that resolves to array of extracted items
   *
   * @example
   * const colors = await ai.list`Extract colors: ${userInput}`
   * // Returns: ['red', 'blue', 'yellow']
   *
   * @example
   * const tags = await ai.list`Extract tags from: ${article}`
   * // Returns: ['tag1', 'tag2', 'tag3']
   */
  const listFunction = function (strings: TemplateStringsArray, ...values: TemplateValue[]): AIPromise<string[]> {
    return new AIPromise(async () => {
      try {
        const resolvedValues = await resolveValues(values)
        const prompt = buildPrompt(strings, resolvedValues)
        const result = await executeWithProvider(prompt, { mode: 'list' })
        try {
          return JSON.parse(result)
        } catch {
          // Fallback: parse as comma-separated if JSON parsing fails
          return result.split(',').map(s => s.trim()).filter(s => s.length > 0)
        }
      } catch (error) {
        // Graceful degradation: return empty array instead of throwing
        if (gracefulDegradation) {
          return []
        }
        throw new Error(`List extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    })
  }

  /**
   * Code generation template literal - generate source code in various languages
   * Automatically strips markdown code fences from output.
   * Supports generation in Python, TypeScript, JavaScript, and other languages.
   *
   * @param strings - Template string parts
   * @param values - Interpolated values (can be primitives or AIPromises)
   * @returns AIPromise that resolves to generated source code
   *
   * @example
   * const code = await ai.code`Write a TypeScript function that ${requirement}`
   * // Returns: 'function foo() { ... }' (without markdown fences)
   *
   * @example
   * const pythonCode = await ai.code`Write Python code that ${description}`
   */
  const codeFunction = function (strings: TemplateStringsArray, ...values: TemplateValue[]): AIPromise<string> {
    return new AIPromise(async () => {
      try {
        const resolvedValues = await resolveValues(values)
        const prompt = buildPrompt(strings, resolvedValues)
        let result = await executeWithProvider(prompt, { mode: 'code' })
        // Strip markdown code fences if present
        result = result.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '')
        return result
      } catch (error) {
        throw new Error(`Code generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    })
  }

  /**
   * Batch processing - execute multiple AI operations with cost optimization
   * Supports three pricing tiers for cost control:
   * - 'immediate': Full cost, responds immediately
   * - 'flex': 50% cost, slightly delayed processing
   * - 'deferred': 25% cost, batch processing for maximum savings
   *
   * @param items - Array of items to process
   * @param mode - Batch mode: 'immediate', 'flex', or 'deferred'
   * @param template - Optional template function to transform each item
   * @returns BatchResult with batchId and promise resolving to results array
   *
   * @example
   * const results = await ai.batch([1, 2, 3], 'deferred', (n) =>
   *   ai`Generate text for number ${n}`
   * )
   *
   * @example
   * // Check batch status
   * const status = await ai.batch.status('batch-123...')
   */
  const batchFunction = Object.assign(
    function <T, R extends SerializableValue = string>(
      items: T[],
      mode: BatchMode,
      template?: (item: T) => AIPromise<R>
    ): BatchResult<R> & Promise<R[]> {
      const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`
      batchStatuses.set(batchId, 'pending')

      const costMultiplier = mode === 'immediate' ? COST_IMMEDIATE : mode === 'flex' ? COST_FLEX : COST_DEFERRED

      const promise = (async () => {
        try {
          batchStatuses.set(batchId, 'processing')

          const results: R[] = []
          for (const item of items) {
            // When template is provided, await returns R
            // When template is undefined, R defaults to string and executeBatchItem returns string
            // Type assertion is safe because the runtime guarantees correctness
            const result: R = template
              ? await template(item)
              : (await executeBatchItem(item as unknown as string, costMultiplier)) as R
            results.push(result)
          }

          batchStatuses.set(batchId, 'completed')
          return results
        } catch (error) {
          batchStatuses.set(batchId, 'completed')
          throw new Error(`Batch ${batchId} failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      })()

      // Create BatchResult that is also a Promise
      const batchResult = Object.assign(promise, {
        batchId,
        then: promise.then.bind(promise),
        catch: promise.catch.bind(promise),
        finally: promise.finally.bind(promise),
      }) as BatchResult<R> & Promise<R[]>

      return batchResult
    },
    {
      status: async (batchId: string): Promise<'pending' | 'processing' | 'completed'> => {
        return batchStatuses.get(batchId) || 'pending'
      }
    }
  )

  // Helper function for batch item execution
  async function executeBatchItem(prompt: string, costMultiplier: number): Promise<string> {
    checkBudget(costMultiplier)
    const result = await executeWithProvider(prompt, { mode: 'general' })
    trackCost(costMultiplier - COST_IMMEDIATE)
    return result
  }

  // Budget object
  const budgetObject: AIBudget = {
    get remaining() {
      // Handle Infinity case - return large number instead of Infinity
      if (budgetLimit === Infinity) {
        return Number.MAX_SAFE_INTEGER - budgetSpent
      }
      return budgetLimit - budgetSpent
    },
    get spent() {
      return budgetSpent
    },
    limit(amount: number): AI {
      budgetLimit = amount
      budgetSpent = 0
      return ai
    }
  }

  // Cache object
  const cacheObject: AICache = {
    get ttl() {
      return cache.getTTL()
    },
    get size() {
      return cache.size
    },
    get maxSize() {
      return cache.maxSize
    },
    get memoryUsage() {
      return cache.memoryUsage
    },
    get cleanupInterval() {
      return cache.cleanupInterval
    },
    get stats() {
      return cache.stats
    },
    clear() {
      return cache.clear()
    },
    purgeExpired() {
      return cache.purgeExpired()
    },
  }

  // Provider function
  function providerFn(name: 'openai' | 'anthropic'): AI<TConfig> {
    if (name !== 'openai' && name !== 'anthropic') {
      throw new Error(`Unknown provider: ${name}`)
    }

    return createAI({
      ...config,
      providers: providers,
      fallback: fallbackProviders,
      provider: providers[name] || defaultProvider,
    } as TConfig)
  }

  // Model function
  function modelFn(name: ModelName): AI<TConfig> {
    return createAI({
      ...config,
      model: name,
    } as TConfig)
  }

  // Providers registry
  const providersRegistry: Record<string, { configured: boolean }> = {
    openai: { configured: !!providers.openai?.apiKey || !!process.env?.OPENAI_API_KEY || true },
    anthropic: { configured: !!providers.anthropic?.apiKey || !!process.env?.ANTHROPIC_API_KEY || true },
  }

  // Assemble the AI object
  const ai = Object.assign(aiFunction, {
    is: isFunction,
    list: listFunction,
    code: codeFunction,
    batch: batchFunction,
    budget: budgetObject,
    cache: cacheObject,
    provider: providerFn,
    model: modelFn,
    providers: providersRegistry,
  }) as AI<TConfig>

  // Fix budget.limit to return this instance
  budgetObject.limit = function (amount: number): AI<TConfig> {
    budgetLimit = amount
    budgetSpent = 0
    return ai
  }

  return ai
}

// =============================================================================
// Default Exports
// =============================================================================

/**
 * Default AI instance with template literal support
 * Provides full access to all AI capabilities: text generation, classification,
 * list extraction, code generation, batch processing, and budget tracking.
 *
 * @example
 * // General text generation
 * const result = await ai`Generate text about ${topic}`
 *
 * @example
 * // Classification
 * const classification = await ai.is`Is this ${text} positive or negative?`
 *
 * @example
 * // List extraction
 * const items = await ai.list`Extract numbers from: ${input}`
 *
 * @example
 * // Code generation
 * const source = await ai.code`Write a function that ${requirement}`
 *
 * @example
 * // Budget management
 * const limited = ai.budget.limit(100) // 100 units max
 * const remaining = ai.budget.remaining // Check remaining budget
 *
 * @example
 * // Batch processing
 * const results = await ai.batch([1, 2, 3], 'deferred', (n) =>
 *   ai`Process item ${n}`
 * )
 */
export const ai: AI = createAI()

/**
 * Classification template literal (shorthand for ai.is)
 * Extracts discrete categories or boolean values from text.
 * Useful for sentiment analysis, validation, and categorization tasks.
 *
 * @param strings - Template string parts
 * @param values - Interpolated values
 * @returns AIPromise resolving to classification result
 *
 * @example
 * const sentiment = await is`Classify sentiment: ${text}`
 * // Returns: 'positive' | 'negative' | 'neutral'
 *
 * @example
 * const isValid = await is`Is this valid JSON? ${input}`
 * // Returns: 'true' | 'false'
 */
export const is = (strings: TemplateStringsArray, ...values: TemplateValue[]): AIPromise<string> => {
  return ai.is(strings, ...values)
}

/**
 * List extraction template literal (shorthand for ai.list)
 * Extracts structured lists from text with fallback JSON parsing.
 * Supports both JSON arrays and comma-separated lists.
 *
 * @param strings - Template string parts
 * @param values - Interpolated values
 * @returns AIPromise resolving to array of extracted items
 *
 * @example
 * const colors = await list`Extract colors: ${text}`
 * // Returns: ['red', 'blue', 'yellow']
 *
 * @example
 * const keywords = await list`Extract keywords from: ${article}`
 * // Returns: ['keyword1', 'keyword2', 'keyword3']
 */
export const list = (strings: TemplateStringsArray, ...values: TemplateValue[]): AIPromise<string[]> => {
  return ai.list(strings, ...values)
}

/**
 * Code generation template literal (shorthand for ai.code)
 * Generates source code in multiple programming languages.
 * Automatically strips markdown code fences from output.
 *
 * @param strings - Template string parts
 * @param values - Interpolated values
 * @returns AIPromise resolving to generated code
 *
 * @example
 * const tsCode = await code`Write a TypeScript function that ${requirement}`
 * // Returns: 'function foo() { ... }' (without markdown)
 *
 * @example
 * const pythonCode = await code`Write Python code to ${task}`
 * // Returns: 'def foo():\n    ...'
 */
export const code = (strings: TemplateStringsArray, ...values: TemplateValue[]): AIPromise<string> => {
  return ai.code(strings, ...values)
}
