/**
 * AI Core Integration for @dotdo/ai
 *
 * Provides integration layer for AI operations:
 * - Text generation via generateText()
 * - Structured output via generateObject()
 * - Text embeddings via embedText()
 * - Tool definitions via createTool()
 * - Multi-provider configuration
 *
 * This module provides a simplified API that wraps the AI SDK
 * with dotdo-specific features:
 * - Provider abstraction layer
 * - Model configuration and routing
 * - Completion API compatibility
 * - Chat API support
 */

import type { ZodTypeAny } from 'zod'

// Type aliases for AI SDK models
// We define these locally because the 'ai' package's type exports may not resolve
// correctly under moduleResolution: "bundler" with the complex GlobalProviderModelId type.
// These types match the actual shape expected by the AI SDK functions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LanguageModel = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EmbeddingModel = any

// Core types (defined inline to avoid dependency on primitives submodule)
export interface JSONSchema {
  type?: string
  properties?: Record<string, JSONSchema>
  items?: JSONSchema
  required?: string[]
  description?: string
  enum?: unknown[]
  default?: unknown
  [key: string]: unknown
}

export interface AIFunctionDefinition<TOutput = unknown, TInput = unknown> {
  name: string
  description: string
  parameters: JSONSchema
  handler: (input: TInput) => TOutput | Promise<TOutput>
}

export interface AIFunctionCall {
  name: string
  arguments: unknown
}

export interface AIGenerateOptions {
  prompt?: string
  system?: string
  model?: string
  temperature?: number
  maxTokens?: number
  stop?: string[]
  schema?: JSONSchema
  functions?: AIFunctionDefinition[]
}

export interface AIGenerateResult {
  text: string
  object?: unknown
  functionCalls?: AIFunctionCall[]
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

// SimpleSchema is a recursive type for simple schema definitions
// Use interface to avoid circular reference errors with Record<>
export interface SimpleSchema {
  [key: string]: string | string[] | SimpleSchema
}

// ============================================================================
// Provider Configuration
// ============================================================================

// Import Provider from router (don't re-export to avoid duplicate exports in index.ts)
// Note: AIProviderConfig in router.ts has different fields (model vs accountId/defaultModel)
// so we define AIProviderConfig here for ai-core specific configuration
import type { Provider } from './router'

export interface AIProviderConfig {
  provider: Provider
  apiKey?: string
  accountId?: string
  defaultModel?: string
}

// Global provider registry
const providers = new Map<Provider, AIProviderConfig>()
let defaultProvider: Provider | null = null

// ============================================================================
// Mock Model Configuration
// ============================================================================

/**
 * Configuration options for mock model behavior
 */
export interface MockModelConfig {
  /**
   * Whether mock models are allowed. Defaults based on environment:
   * - 'auto': Allow in test/development, disallow in production (default)
   * - true: Always allow mock models (use with caution)
   * - false: Never allow mock models (throws if ai-providers unavailable)
   */
  allowMock?: 'auto' | boolean

  /**
   * Whether to log warnings when mock model is used.
   * Default: true
   */
  warnOnMock?: boolean

  /**
   * Custom warning handler. Defaults to console.warn.
   */
  onMockWarning?: (message: string, context: { model: string; operation: string }) => void
}

// Global mock model configuration
let mockConfig: MockModelConfig = {
  allowMock: 'auto',
  warnOnMock: true,
}

// Track if we've warned about mock usage (to avoid spamming)
let mockWarningIssued = false

/**
 * Configure mock model behavior
 *
 * @example
 * ```ts
 * // Disable mock models entirely (fail if ai-providers unavailable)
 * configureMockModel({ allowMock: false })
 *
 * // Enable mock models with custom warning handler
 * configureMockModel({
 *   allowMock: true,
 *   warnOnMock: true,
 *   onMockWarning: (msg, ctx) => logger.warn(msg, ctx),
 * })
 * ```
 */
export function configureMockModel(config: MockModelConfig): void {
  mockConfig = { ...mockConfig, ...config }
  // Reset warning flag when config changes
  mockWarningIssued = false
}

/**
 * Get current mock model configuration
 */
export function getMockConfig(): MockModelConfig {
  return { ...mockConfig }
}

/**
 * Reset mock model configuration to defaults (useful for testing)
 */
export function resetMockConfig(): void {
  mockConfig = {
    allowMock: 'auto',
    warnOnMock: true,
  }
  mockWarningIssued = false
}

/**
 * Detect if we're running in a production environment
 */
function isProduction(): boolean {
  // Check common environment variables
  if (typeof process !== 'undefined' && process.env) {
    const env = process.env['NODE_ENV'] || process.env['ENVIRONMENT'] || ''
    if (env.toLowerCase() === 'production' || env.toLowerCase() === 'prod') {
      return true
    }
  }
  // Check Cloudflare Workers environment
  if (typeof globalThis !== 'undefined' && (globalThis as any).ENVIRONMENT === 'production') {
    return true
  }
  return false
}

/**
 * Detect if we're running in a test environment
 */
function isTestEnvironment(): boolean {
  // Check common test environment indicators
  if (typeof process !== 'undefined' && process.env) {
    // NODE_ENV=test
    if (process.env['NODE_ENV'] === 'test') return true
    // Vitest
    if (process.env['VITEST'] === 'true') return true
    // Jest
    if (process.env['JEST_WORKER_ID'] !== undefined) return true
    // CI environments often set this
    if (process.env['CI'] === 'true') return true
  }
  // Check if vitest/jest globals are present
  if (typeof globalThis !== 'undefined') {
    if ((globalThis as any).__vitest_worker__) return true
    if ((globalThis as any).jest) return true
  }
  return false
}

/**
 * Check if mock models should be allowed based on configuration and environment
 */
function shouldAllowMock(): boolean {
  if (mockConfig.allowMock === true) return true
  if (mockConfig.allowMock === false) return false

  // 'auto' mode: allow in test/dev, disallow in production
  if (isTestEnvironment()) return true
  if (isProduction()) return false

  // Default to allowing in development
  return true
}

/**
 * Log a warning about mock model usage
 */
function warnMockUsage(model: string, operation: string): void {
  if (!mockConfig.warnOnMock) return
  if (mockWarningIssued && operation === 'resolve') return // Only warn once per session for model resolution

  const message = `[dotdo/ai] Using MOCK model for "${model}" because ai-providers is not installed. ` +
    `This returns fake responses and should NOT be used in production. ` +
    `Install ai-providers or configure a real provider to use actual AI models.`

  if (mockConfig.onMockWarning) {
    mockConfig.onMockWarning(message, { model, operation })
  } else {
    console.warn(message)
  }

  if (operation === 'resolve') {
    mockWarningIssued = true
  }
}

/**
 * Configure a provider for AI operations
 */
export function configureProvider(config: AIProviderConfig): void {
  providers.set(config.provider, config)

  // Set as default if it's the first provider
  if (defaultProvider === null) {
    defaultProvider = config.provider
  }
}

/**
 * Get provider configuration
 */
export function getProvider(provider?: Provider): AIProviderConfig | undefined {
  if (provider) {
    return providers.get(provider)
  }

  if (defaultProvider) {
    return providers.get(defaultProvider)
  }

  return undefined
}

/**
 * Clear all provider configurations (useful for testing)
 */
export function clearProviders(): void {
  providers.clear()
  defaultProvider = null
}

// ============================================================================
// Model Resolution
// ============================================================================

/**
 * Model aliases for common models
 */
const MODEL_ALIASES: Record<string, string> = {
  // Anthropic
  'opus': 'claude-opus-4.5',
  'sonnet': 'claude-sonnet-4.5',
  'haiku': 'claude-3-5-haiku-20241022',

  // OpenAI
  'gpt-4o': 'gpt-4o',
  'gpt-4': 'gpt-4-turbo',
  'gpt-3.5': 'gpt-3.5-turbo',

  // Google
  'gemini': 'gemini-2.0-flash-exp',
  'gemini-pro': 'gemini-1.5-pro',
}

/**
 * Resolve model alias to full model ID
 */
function resolveModelAlias(model: string): string {
  return MODEL_ALIASES[model] || model
}

/**
 * Get provider from model name
 */
function getProviderFromModel(model: string): Provider {
  const resolvedModel = resolveModelAlias(model)

  if (resolvedModel.startsWith('claude')) return 'anthropic'
  if (resolvedModel.startsWith('gpt')) return 'openai'
  if (resolvedModel.startsWith('gemini')) return 'google'

  // Default to configured provider
  return defaultProvider || 'anthropic'
}

/**
 * Check if an error is a module not found error
 */
function isModuleNotFoundError(error: unknown): boolean {
  if (error instanceof Error) {
    // Node.js/Vite MODULE_NOT_FOUND error codes
    if ('code' in error && (
      error.code === 'MODULE_NOT_FOUND' ||
      error.code === 'ERR_MODULE_NOT_FOUND'
    )) {
      return true
    }
    // Bundler/ESM import errors - various message formats
    if (error.message.includes('Cannot find module') ||
        error.message.includes('Cannot find package') ||
        error.message.includes('Failed to resolve') ||
        error.message.includes('Cannot resolve module') ||
        error.message.includes('Failed to load url')) {
      return true
    }
  }
  return false
}

/**
 * Error thrown when mock model is used but not allowed
 */
export class MockModelNotAllowedError extends Error {
  constructor(modelId: string) {
    super(
      `Mock model not allowed for "${modelId}". ` +
      `ai-providers module is not installed and mock models are disabled. ` +
      `Either install ai-providers or set configureMockModel({ allowMock: true }) for testing.`
    )
    this.name = 'MockModelNotAllowedError'
  }
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Base error class for AI operations.
 * All AI-related errors extend from this class.
 */
export class AIError extends Error {
  /** The operation that was being performed */
  readonly operation: string
  /** The model being used (if applicable) */
  readonly model?: string
  /** The underlying cause of the error */
  readonly cause?: Error

  constructor(message: string, options: { operation: string; model?: string; cause?: Error }) {
    super(message)
    this.name = 'AIError'
    this.operation = options.operation
    if (options.model !== undefined) {
      this.model = options.model
    }
    if (options.cause !== undefined) {
      this.cause = options.cause
    }
    // Maintain proper stack trace (only in V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AIError)
    }
  }
}

/**
 * Error thrown when a model cannot be resolved.
 */
export class AIModelResolutionError extends AIError {
  constructor(modelId: string, cause?: Error) {
    // Build options with only defined values to satisfy exactOptionalPropertyTypes
    const opts: { operation: string; model: string; cause?: Error } = {
      operation: 'resolveModel',
      model: modelId,
    }
    if (cause !== undefined) {
      opts.cause = cause
    }
    super(
      `Failed to resolve model "${modelId}"${cause ? `: ${cause.message}` : ''}`,
      opts
    )
    this.name = 'AIModelResolutionError'
  }
}

/**
 * Error thrown when the AI provider returns an error.
 */
export class AIProviderError extends AIError {
  /** HTTP status code from the provider (if applicable) */
  readonly status?: number
  /** Error code from the provider (if applicable) */
  readonly code?: string
  /** Whether this error is retryable */
  readonly retryable: boolean

  constructor(
    message: string,
    options: {
      operation: string
      model?: string
      cause?: Error
      status?: number
      code?: string
      retryable?: boolean
    }
  ) {
    super(message, options)
    this.name = 'AIProviderError'
    if (options.status !== undefined) {
      this.status = options.status
    }
    if (options.code !== undefined) {
      this.code = options.code
    }
    this.retryable = options.retryable ?? false
  }

  /**
   * Check if an error from the provider is retryable.
   */
  static isRetryable(error: Error & { status?: number; code?: string }): boolean {
    // Rate limit errors are retryable
    if (error.status === 429) return true

    // Server errors are generally retryable
    if (error.status !== undefined && error.status >= 500 && error.status < 600) return true

    // Check error codes
    const code = error.code?.toLowerCase()
    if (code === 'rate_limit_exceeded' || code === 'overloaded' || code === 'server_error') {
      return true
    }

    // Check error message for transient conditions
    const message = error.message?.toLowerCase() || ''
    const transientPatterns = [
      'rate limit',
      'too many requests',
      'overloaded',
      'timeout',
      'econnreset',
      'socket hang up',
      'network error',
    ]
    return transientPatterns.some(p => message.includes(p))
  }
}

/**
 * Error thrown when text generation fails.
 */
export class AIGenerationError extends AIProviderError {
  constructor(
    message: string,
    options: {
      model?: string
      cause?: Error
      status?: number
      code?: string
      retryable?: boolean
    }
  ) {
    super(message, { ...options, operation: 'generateText' })
    this.name = 'AIGenerationError'
  }
}

/**
 * Error thrown when object generation fails.
 */
export class AIObjectGenerationError extends AIProviderError {
  constructor(
    message: string,
    options: {
      model?: string
      cause?: Error
      status?: number
      code?: string
      retryable?: boolean
    }
  ) {
    super(message, { ...options, operation: 'generateObject' })
    this.name = 'AIObjectGenerationError'
  }
}

/**
 * Error thrown when embedding generation fails.
 */
export class AIEmbeddingError extends AIProviderError {
  constructor(
    message: string,
    options: {
      model?: string
      cause?: Error
      status?: number
      code?: string
      retryable?: boolean
    }
  ) {
    super(message, { ...options, operation: 'embedText' })
    this.name = 'AIEmbeddingError'
  }
}

/**
 * Error thrown when streaming fails.
 */
export class AIStreamError extends AIProviderError {
  constructor(
    message: string,
    options: {
      model?: string
      cause?: Error
      status?: number
      code?: string
      retryable?: boolean
    }
  ) {
    super(message, { ...options, operation: 'streamText' })
    this.name = 'AIStreamError'
  }
}

/**
 * Extract error details from a provider error.
 * Returns an object that can be safely used with exactOptionalPropertyTypes.
 */
function extractErrorDetails(error: unknown): { status?: number; code?: string; message: string } {
  if (error instanceof Error) {
    const err = error as Error & { status?: number; code?: string; statusCode?: number }
    const result: { status?: number; code?: string; message: string } = {
      message: err.message,
    }
    const status = err.status ?? err.statusCode
    if (status !== undefined) {
      result.status = status
    }
    if (err.code !== undefined) {
      result.code = err.code
    }
    return result
  }
  return { message: String(error) }
}

/**
 * Build error options from extracted details for use with exactOptionalPropertyTypes.
 */
function buildErrorOptions(
  modelName: string,
  cause: Error,
  details: { status?: number; code?: string; message: string }
): {
  model: string
  cause: Error
  status?: number
  code?: string
  retryable: boolean
} {
  const opts: {
    model: string
    cause: Error
    status?: number
    code?: string
    retryable: boolean
  } = {
    model: modelName,
    cause,
    retryable: AIProviderError.isRetryable(cause as Error & { status?: number; code?: string }),
  }
  if (details.status !== undefined) {
    opts.status = details.status
  }
  if (details.code !== undefined) {
    opts.code = details.code
  }
  return opts
}

/**
 * Create a mock LanguageModel for testing when ai-providers is not installed.
 *
 * IMPORTANT: This should only be used when the ai-providers module is genuinely
 * not available (development/testing without the optional dependency).
 * Real errors from ai-providers should propagate to the caller.
 *
 * @throws {MockModelNotAllowedError} If mock models are not allowed in current environment
 */
function createMockModel(modelId: string): LanguageModel {
  // Check if mock models are allowed
  if (!shouldAllowMock()) {
    throw new MockModelNotAllowedError(modelId)
  }

  // Warn about mock usage
  warnMockUsage(modelId, 'resolve')

  return {
    provider: 'mock',
    modelId,
    specificationVersion: 'v1',
    async doGenerate(options: any) {
      return {
        text: `Mock response for model: ${modelId}`,
        finishReason: 'stop' as const,
        usage: { promptTokens: 10, completionTokens: 20 },
      }
    },
    async doStream(options: any) {
      return {
        stream: (async function* () {
          yield { type: 'text-delta' as const, textDelta: 'Mock response' }
          yield { type: 'finish' as const, finishReason: 'stop' as const, usage: { promptTokens: 10, completionTokens: 20 } }
        })(),
      }
    },
  } as unknown as LanguageModel
}

/**
 * Resolve model string to LanguageModel instance
 *
 * Uses ai-providers when available, falls back to mock only when the module
 * is not installed. Real errors (auth failures, API errors, etc.) are propagated
 * wrapped in AIModelResolutionError for better error handling.
 *
 * @throws {AIModelResolutionError} When model resolution fails (wraps the original error)
 * @throws {MockModelNotAllowedError} When mock is needed but not allowed
 */
async function resolveModel(modelArg: string | LanguageModel): Promise<LanguageModel> {
  // Already a LanguageModel instance
  if (typeof modelArg !== 'string') {
    return modelArg
  }

  // Resolve alias
  const resolvedModel = resolveModelAlias(modelArg)

  // Try to use ai-providers if available
  try {
    const aiProviders = await import('ai-providers')
    // This may throw errors (auth, config, etc.) - let them propagate!
    return await aiProviders.model(resolvedModel)
  } catch (e) {
    // Only use mock model if ai-providers module is not installed
    // This allows tests to run without the optional dependency
    if (isModuleNotFoundError(e)) {
      return createMockModel(resolvedModel)
    }
    // Wrap real errors (authentication, configuration, API errors, etc.)
    // in AIModelResolutionError for better error handling
    const cause = e instanceof Error ? e : new Error(String(e))
    throw new AIModelResolutionError(resolvedModel, cause)
  }
}

// ============================================================================
// Text Generation
// ============================================================================

export interface GenerateTextOptions {
  model: string | LanguageModel
  prompt?: string
  messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  system?: string
  maxTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  presencePenalty?: number
  frequencyPenalty?: number
  seed?: number
  maxRetries?: number
  abortSignal?: AbortSignal
  headers?: Record<string, string>
  tools?: Record<string, unknown>
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string }
  maxSteps?: number
}

export interface GenerateTextResult {
  text: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  finishReason?: string | undefined
  toolCalls?: Array<{
    name: string
    arguments: unknown
  }>
}

/**
 * Generate text using AI
 *
 * @example
 * ```ts
 * const result = await generateText({
 *   model: 'sonnet',
 *   prompt: 'Write a haiku about coding',
 * })
 * console.log(result.text)
 * ```
 *
 * @throws {AIModelResolutionError} When the model cannot be resolved
 * @throws {AIGenerationError} When text generation fails
 */
export async function generateText(
  options: GenerateTextOptions
): Promise<GenerateTextResult> {
  const modelName = typeof options.model === 'string' ? options.model : 'unknown'

  // Resolve model - may throw AIModelResolutionError
  const model = await resolveModel(options.model)

  // Check if we're using the mock (ai-providers not available)
  if ((model as any).provider === 'mock') {
    // Use mock response directly
    const mockResult = await (model as any).doGenerate({})
    return {
      text: mockResult.text,
      usage: {
        promptTokens: mockResult.usage.promptTokens,
        completionTokens: mockResult.usage.completionTokens,
        totalTokens: mockResult.usage.promptTokens + mockResult.usage.completionTokens,
      },
      finishReason: mockResult.finishReason,
    }
  }

  // Use real AI SDK for actual models
  try {
    const { generateText: aiGenerateText } = await import('ai')

    const result = await aiGenerateText({
      ...options,
      model,
    })

    return {
      text: result.text,
      usage: {
        promptTokens: result.usage?.promptTokens || 0,
        completionTokens: result.usage?.completionTokens || 0,
        totalTokens: result.usage?.totalTokens || 0,
      },
      finishReason: result.finishReason,
    }
  } catch (e) {
    // Don't wrap our own errors
    if (e instanceof AIError) {
      throw e
    }

    // Wrap provider errors with context
    const details = extractErrorDetails(e)
    const cause = e instanceof Error ? e : new Error(String(e))
    throw new AIGenerationError(
      `Text generation failed for model "${modelName}": ${details.message}`,
      buildErrorOptions(modelName, cause, details)
    )
  }
}

// ============================================================================
// Object Generation
// ============================================================================

export interface GenerateObjectOptions<T = unknown> {
  model: string | LanguageModel
  schema: T
  prompt?: string
  messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  system?: string
  mode?: 'auto' | 'json' | 'tool'
  maxTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  presencePenalty?: number
  frequencyPenalty?: number
  seed?: number
  maxRetries?: number
  abortSignal?: AbortSignal
  headers?: Record<string, string>
}

export interface GenerateObjectResult<T = unknown> {
  object: T
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  finishReason?: string | undefined
}

/**
 * Generate structured object using AI
 *
 * @example
 * ```ts
 * const result = await generateObject({
 *   model: 'sonnet',
 *   schema: { colors: ['List 3 colors'] },
 *   prompt: 'List primary colors',
 * })
 * console.log(result.object.colors)
 * ```
 *
 * @throws {AIModelResolutionError} When the model cannot be resolved
 * @throws {AIObjectGenerationError} When object generation fails
 */
export async function generateObject<T>(
  options: GenerateObjectOptions<T>
): Promise<GenerateObjectResult<T>> {
  const modelName = typeof options.model === 'string' ? options.model : 'unknown'

  // Resolve model - may throw AIModelResolutionError
  const model = await resolveModel(options.model)

  // Check if we're using the mock (ai-providers not available)
  if ((model as any).provider === 'mock') {
    // Return mock object response
    return {
      object: {} as T,
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
      finishReason: 'stop',
    }
  }

  // Use real AI SDK for actual models
  try {
    const { generateObject: aiGenerateObject } = await import('ai')

    const result = await aiGenerateObject({
      ...options,
      model,
      output: 'object',
    } as any)

    return {
      object: result.object as T,
      usage: {
        promptTokens: result.usage?.promptTokens || 0,
        completionTokens: result.usage?.completionTokens || 0,
        totalTokens: result.usage?.totalTokens || 0,
      },
      finishReason: result.finishReason,
    }
  } catch (e) {
    // Don't wrap our own errors
    if (e instanceof AIError) {
      throw e
    }

    // Wrap provider errors with context
    const details = extractErrorDetails(e)
    const cause = e instanceof Error ? e : new Error(String(e))
    throw new AIObjectGenerationError(
      `Object generation failed for model "${modelName}": ${details.message}`,
      buildErrorOptions(modelName, cause, details)
    )
  }
}

// ============================================================================
// Text Streaming
// ============================================================================

export interface StreamTextOptions extends GenerateTextOptions {
}

export interface StreamTextResult {
  textStream: AsyncIterable<string>
  fullStream: AsyncIterable<any>
  usage: Promise<{
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }>
}

/**
 * Stream text generation using AI
 *
 * @example
 * ```ts
 * const stream = await streamText({
 *   model: 'sonnet',
 *   prompt: 'Write a story',
 * })
 *
 * for await (const chunk of stream.textStream) {
 *   process.stdout.write(chunk)
 * }
 * ```
 *
 * @throws {AIModelResolutionError} When the model cannot be resolved
 * @throws {AIStreamError} When streaming fails
 */
export async function streamText(
  options: StreamTextOptions
): Promise<StreamTextResult> {
  const modelName = typeof options.model === 'string' ? options.model : 'unknown'

  try {
    // Import from ai package (not the local ai folder)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aiModule = await import('ai') as any

    // Resolve model - may throw AIModelResolutionError
    const model = await resolveModel(options.model)

    // streamText returns an object with async properties, not a Promise
    const result = aiModule.streamText({
      ...options,
      model,
    })

    return {
      textStream: result.textStream,
      fullStream: result.fullStream,
      usage: result.usage.then((u: { promptTokens?: number; completionTokens?: number; totalTokens?: number }) => ({
        promptTokens: u?.promptTokens || 0,
        completionTokens: u?.completionTokens || 0,
        totalTokens: u?.totalTokens || 0,
      })),
    }
  } catch (e) {
    // Don't wrap our own errors
    if (e instanceof AIError) {
      throw e
    }

    // Wrap provider errors with context
    const details = extractErrorDetails(e)
    const cause = e instanceof Error ? e : new Error(String(e))
    throw new AIStreamError(
      `Streaming failed for model "${modelName}": ${details.message}`,
      buildErrorOptions(modelName, cause, details)
    )
  }
}

// ============================================================================
// Embeddings
// ============================================================================

export interface EmbedTextOptions {
  model?: string
  dimensions?: number
}

/**
 * Generate mock embeddings for testing when ai-providers is not installed.
 * Returns deterministic mock embeddings based on text length.
 */
function generateMockEmbedding(text: string, dimensions: number = 1536): number[] {
  // Use a simple deterministic algorithm based on text
  // This ensures tests get consistent results
  const seed = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return Array.from({ length: dimensions }, (_, i) =>
    Math.sin(seed * (i + 1) * 0.001) * 0.5
  )
}

/**
 * Generate embeddings for text
 *
 * @example
 * ```ts
 * // Single text
 * const embedding = await embedText('hello world')
 *
 * // Multiple texts
 * const embeddings = await embedText(['hello', 'world'])
 * ```
 *
 * @throws {AIModelResolutionError} When the embedding model cannot be resolved
 * @throws {AIEmbeddingError} When embedding generation fails
 * @throws {MockModelNotAllowedError} When mock is needed but not allowed
 */
export async function embedText(
  text: string | string[],
  options?: EmbedTextOptions
): Promise<number[] | number[][]> {
  const modelName = options?.model || 'text-embedding-3-small'

  // Try to get embedding model from ai-providers
  let model: EmbeddingModel | null = null
  try {
    const aiProviders = await import('ai-providers')
    // This may throw errors (auth, config, etc.) - wrap them!
    model = await aiProviders.embeddingModel(modelName)
  } catch (e) {
    // Only use mock embeddings if ai-providers module is not installed
    // This allows tests to run without the optional dependency
    if (isModuleNotFoundError(e)) {
      model = null
    } else {
      // Wrap real errors (authentication, configuration, API errors, etc.)
      // in AIModelResolutionError for better error handling
      const cause = e instanceof Error ? e : new Error(String(e))
      throw new AIModelResolutionError(modelName, cause)
    }
  }

  // If ai-providers is not available (module not installed), return mock embeddings
  if (model === null) {
    // Check if mock is allowed
    if (!shouldAllowMock()) {
      throw new MockModelNotAllowedError(modelName)
    }

    // Warn about mock usage
    warnMockUsage(modelName, 'embedding')

    if (typeof text === 'string') {
      return generateMockEmbedding(text, options?.dimensions)
    }
    return text.map((t) => generateMockEmbedding(t, options?.dimensions))
  }

  // Use real AI SDK with the model
  try {
    // Import embed from ai package (not the local ai folder)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aiModule = await import('ai') as any
    const embed = aiModule.embed as (options: { model: unknown; value: string }) => Promise<{ embedding: number[] }>

    if (typeof text === 'string') {
      const result = await embed({
        model,
        value: text,
      })
      return result.embedding
    }

    // Multiple texts
    const results = await Promise.all(
      text.map(t => embed({
        model,
        value: t,
      }))
    )

    return results.map((r: { embedding: number[] }) => r.embedding)
  } catch (e) {
    // Don't wrap our own errors
    if (e instanceof AIError) {
      throw e
    }

    // Wrap provider errors with context
    const details = extractErrorDetails(e)
    const cause = e instanceof Error ? e : new Error(String(e))
    throw new AIEmbeddingError(
      `Embedding generation failed for model "${modelName}": ${details.message}`,
      buildErrorOptions(modelName, cause, details)
    )
  }
}

// ============================================================================
// Tool Definitions
// ============================================================================

export interface ToolDefinition<TOutput = unknown, TInput = unknown> {
  name: string
  description: string
  parameters: Record<string, string> | ZodTypeAny
  execute: (input: TInput) => TOutput | Promise<TOutput>
}

export interface Tool<TOutput = unknown, TInput = unknown> {
  name: string
  description: string
  parameters: Record<string, string> | ZodTypeAny
  execute: (input: TInput) => TOutput | Promise<TOutput>
}

/**
 * Create a tool that can be called by AI
 *
 * @example
 * ```ts
 * const calculator = createTool({
 *   name: 'calculator',
 *   description: 'Performs calculations',
 *   parameters: {
 *     expression: 'Math expression to evaluate',
 *   },
 *   execute: ({ expression }) => eval(expression),
 * })
 *
 * const result = await calculator.execute({ expression: '2 + 2' })
 * ```
 */
export function createTool<TOutput = unknown, TInput = unknown>(
  definition: ToolDefinition<TOutput, TInput>
): Tool<TOutput, TInput> {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    execute: definition.execute,
  }
}

// ============================================================================
// Completion API (backward compatibility)
// ============================================================================

export interface CompletionOptions {
  model: string
  prompt: string
  system?: string
  maxTokens?: number
  temperature?: number
  stop?: string[]
}

/**
 * Complete a prompt (backward compatibility wrapper)
 *
 * @deprecated Use generateText instead
 */
export async function complete(options: CompletionOptions): Promise<string> {
  // Build options with only defined values to satisfy exactOptionalPropertyTypes
  const genOptions: GenerateTextOptions = {
    model: options.model,
    prompt: options.prompt,
  }
  if (options.system !== undefined) genOptions.system = options.system
  if (options.maxTokens !== undefined) genOptions.maxTokens = options.maxTokens
  if (options.temperature !== undefined) genOptions.temperature = options.temperature

  const result = await generateText(genOptions)

  return result.text
}

// ============================================================================
// Chat API
// ============================================================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  model: string
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
}

/**
 * Chat completion with message history
 *
 * @example
 * ```ts
 * const result = await chat({
 *   model: 'sonnet',
 *   messages: [
 *     { role: 'system', content: 'You are helpful' },
 *     { role: 'user', content: 'What is 2+2?' },
 *   ],
 * })
 * ```
 */
export async function chat(options: ChatOptions): Promise<string> {
  // Build options with only defined values to satisfy exactOptionalPropertyTypes
  const genOptions: GenerateTextOptions = {
    model: options.model,
    messages: options.messages,
  }
  if (options.maxTokens !== undefined) genOptions.maxTokens = options.maxTokens
  if (options.temperature !== undefined) genOptions.temperature = options.temperature

  const result = await generateText(genOptions)

  return result.text
}
