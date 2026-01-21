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
 *
 * Error handling, mock model support, and model resolution are
 * extracted to separate modules for maintainability:
 * - ./errors.ts - Error class hierarchy
 * - ./mock.ts - Mock model configuration and creation
 * - ./models.ts - Model aliases and resolution
 */

import type { ZodTypeAny } from 'zod'

// Import from extracted modules
import {
  AIError,
  AIModelResolutionError,
  AIProviderError,
  AIGenerationError,
  AIObjectGenerationError,
  AIEmbeddingError,
  AIStreamError,
  MockModelNotAllowedError,
  extractErrorDetails,
  buildErrorOptions,
} from './errors'

import {
  type MockModelConfig,
  configureMockModel,
  getMockConfig,
  resetMockConfig,
  isMockModel,
  shouldAllowMock,
  warnMockUsage,
  generateMockEmbedding,
} from './mock'

import {
  type LanguageModel,
  type EmbeddingModel,
  resolveModel,
  resolveEmbeddingModel,
} from './models'

// Re-export error classes and utilities for backward compatibility
export {
  AIError,
  AIModelResolutionError,
  AIProviderError,
  AIGenerationError,
  AIObjectGenerationError,
  AIEmbeddingError,
  AIStreamError,
  MockModelNotAllowedError,
}

// Re-export mock configuration functions for backward compatibility
export {
  type MockModelConfig,
  configureMockModel,
  getMockConfig,
  resetMockConfig,
}

// Import Provider from router (don't re-export to avoid duplicate exports in index.ts)
import type { Provider } from './router'

// ============================================================================
// Core Type Definitions
// ============================================================================

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

/**
 * Minimal interface for AI SDK stream chunk types.
 * The actual AI SDK has many chunk types; we only define what we need.
 */
type StreamChunk =
  | { type: 'text-delta'; textDelta: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool-result'; toolCallId: string; result: unknown }
  | { type: 'error'; error: Error }
  | { type: 'finish'; finishReason: string; usage?: { promptTokens?: number; completionTokens?: number } }
  | { type: string; [key: string]: unknown }

// ============================================================================
// Provider Configuration
// ============================================================================

export interface AIProviderConfig {
  provider: Provider
  apiKey?: string
  accountId?: string
  defaultModel?: string
}

// ============================================================================
// Request-Scoped Provider Context (do-9voby)
// ============================================================================
// The global provider registry causes state leakage between requests/tenants.
// This module provides request-scoped contexts for proper isolation.
//
// Memory Management:
// - ALS contexts are automatically cleaned up when the run() callback completes
// - Stack-based fallback properly pops context in finally block (handles async)
// - Global registry is deprecated; use runWithAIProviderContext() for isolation
// - No memory leaks when using scoped contexts - they're GC'd with the request

/**
 * Provider context for request-scoped isolation
 */
export interface AIProviderContext {
  providers: Map<Provider, AIProviderConfig>
  defaultProvider: Provider | null
}

/**
 * Minimal AsyncLocalStorage interface for type safety.
 * Compatible with Node.js AsyncLocalStorage and Cloudflare Workers.
 */
interface AsyncLocalStorageInterface<T> {
  run<R>(store: T, callback: () => R): R
  getStore(): T | undefined
}

/**
 * AsyncLocalStorage instance for provider context - lazily initialized.
 */
let providerContextALS: AsyncLocalStorageInterface<AIProviderContext> | null = null

/**
 * Initialize the AsyncLocalStorage lazily to avoid issues in environments without it.
 * Uses a stack-based fallback for non-ALS environments.
 */
async function getProviderContextALS(): Promise<AsyncLocalStorageInterface<AIProviderContext>> {
  if (!providerContextALS) {
    try {
      // Dynamic import for cross-platform compatibility (Node.js vs Workers)
      // Using string variable for module name avoids bundler resolution issues
      const moduleName = 'node:async_hooks'
      const asyncHooks = await (import(moduleName) as Promise<{
        AsyncLocalStorage: new <T>() => AsyncLocalStorageInterface<T>
      }>)

      if (typeof asyncHooks?.AsyncLocalStorage !== 'function') {
        throw new Error('AsyncLocalStorage not available')
      }

      providerContextALS = new asyncHooks.AsyncLocalStorage<AIProviderContext>()
    } catch {
      // Fallback: Simple stack-based implementation for non-ALS environments
      const contextStack: AIProviderContext[] = []

      providerContextALS = {
        run<R>(store: AIProviderContext, callback: () => R): R {
          contextStack.push(store)

          try {
            const result = callback()

            // Handle promises
            const isPromiseLike = (val: unknown): val is PromiseLike<unknown> =>
              val !== null &&
              typeof val === 'object' &&
              typeof (val as PromiseLike<unknown>).then === 'function'

            if (isPromiseLike(result)) {
              const resultPromise = Promise.resolve(result).finally(() => {
                contextStack.pop()
              })
              return resultPromise as unknown as R
            }

            contextStack.pop()
            return result
          } catch (error) {
            contextStack.pop()
            throw error
          }
        },
        getStore(): AIProviderContext | undefined {
          return contextStack[contextStack.length - 1]
        },
      }
    }
  }
  return providerContextALS
}

/**
 * Run a function with a provider registry scoped to this request.
 *
 * Providers configured within the context are isolated from other requests,
 * preventing tenant data leakage in multi-tenant environments.
 *
 * @param fn - The async function to run with the scoped registry
 * @returns The result of the function
 *
 * @example
 * ```ts
 * // In middleware - ensures tenant isolation
 * app.use(async (c, next) => {
 *   await runWithAIProviderContext(async () => {
 *     await next()
 *   })
 * })
 *
 * // In handler - providers are isolated per request
 * await runWithAIProviderContext(async () => {
 *   configureProvider({
 *     provider: 'anthropic',
 *     apiKey: request.headers.get('X-Anthropic-Key'),
 *   })
 *
 *   // This provider config is only visible within this context
 * })
 * ```
 */
export async function runWithAIProviderContext<T>(fn: () => T | Promise<T>): Promise<T> {
  const als = await getProviderContextALS()
  const context: AIProviderContext = {
    providers: new Map(),
    defaultProvider: null,
  }
  return als.run(context, fn) as T | Promise<T> as Promise<T>
}

/**
 * Get the current provider context from the request scope.
 * Returns undefined if not running within runWithAIProviderContext().
 *
 * @returns The current AIProviderContext or undefined
 */
export function getCurrentAIProviderContext(): AIProviderContext | undefined {
  if (!providerContextALS) {
    return undefined
  }
  return providerContextALS.getStore()
}

/**
 * Get the active provider registry - context-scoped if available, otherwise global.
 *
 * When running within runWithAIProviderContext(), returns the request-scoped registry.
 * When running outside a context, falls back to the global registry (deprecated behavior).
 *
 * @returns The active provider context
 * @internal
 */
function getActiveProviderContext(): AIProviderContext {
  const contextStore = providerContextALS?.getStore()
  return contextStore ?? globalProviderContext
}

// ============================================================================
// Global Provider Registry (DEPRECATED - do-9voby)
// ============================================================================
// DEPRECATED: The global registry pattern causes state leakage between
// requests/tenants. Use runWithAIProviderContext() for proper isolation.
//
// Migration guide:
// 1. Wrap request handlers with runWithAIProviderContext()
// 2. Providers configured within the context are automatically isolated
// 3. Use configureProvider() and getProvider() as before - they now
//    respect the context when available

/**
 * @deprecated Global registry causes tenant state leakage. Use runWithAIProviderContext() instead.
 * @internal
 */
const globalProviders = new Map<Provider, AIProviderConfig>()

/**
 * @deprecated Global default provider causes tenant state leakage. Use runWithAIProviderContext() instead.
 * @internal
 */
let globalDefaultProvider: Provider | null = null

/**
 * Global provider context wrapped for backward compatibility.
 * @internal
 */
const globalProviderContext: AIProviderContext = {
  get providers() { return globalProviders },
  get defaultProvider() { return globalDefaultProvider },
  set defaultProvider(value: Provider | null) { globalDefaultProvider = value },
}

/**
 * Configure a provider for AI operations.
 *
 * When running inside runWithAIProviderContext(), configures the request-scoped context.
 * Otherwise, configures the global context (deprecated behavior).
 */
export function configureProvider(config: AIProviderConfig): void {
  const ctx = getActiveProviderContext()
  ctx.providers.set(config.provider, config)

  // Set as default if it's the first provider in this context
  if (ctx.defaultProvider === null) {
    ctx.defaultProvider = config.provider
  }
}

/**
 * Get provider configuration.
 *
 * When running inside runWithAIProviderContext(), returns from the request-scoped context.
 * Otherwise, returns from the global context (deprecated behavior).
 */
export function getProvider(provider?: Provider): AIProviderConfig | undefined {
  const ctx = getActiveProviderContext()

  if (provider) {
    return ctx.providers.get(provider)
  }

  if (ctx.defaultProvider) {
    return ctx.providers.get(ctx.defaultProvider)
  }

  return undefined
}

/**
 * Clear all provider configurations.
 *
 * When running inside runWithAIProviderContext(), clears the request-scoped context.
 * Otherwise, clears the global context (deprecated behavior).
 */
export function clearProviders(): void {
  const ctx = getActiveProviderContext()
  ctx.providers.clear()
  ctx.defaultProvider = null
}

/**
 * Clear the global provider registry.
 * Useful for testing to reset global state between tests.
 *
 * @deprecated Global registry is deprecated. Use runWithAIProviderContext() for proper isolation.
 */
export function clearGlobalProviders(): void {
  globalProviders.clear()
  globalDefaultProvider = null
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
  if (isMockModel(model)) {
    // Use mock response directly
    const mockResult = await model.doGenerate({})
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
  if (isMockModel(model)) {
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

    // The AI SDK's generateObject has complex type constraints that don't align well
    // with our abstraction layer. We cast through unknown since we handle the result
    // transformation ourselves.
    const result = await aiGenerateObject({
      ...options,
      model,
      output: 'object',
    } as unknown as Parameters<typeof aiGenerateObject>[0])

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
  fullStream: AsyncIterable<StreamChunk>
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
    // Dynamic import of 'ai' package with typed interface for the parts we use
    interface AIStreamResult {
      textStream: AsyncIterable<string>
      fullStream: AsyncIterable<StreamChunk>
      usage: Promise<{ promptTokens?: number; completionTokens?: number; totalTokens?: number }>
    }
    const aiModule = await import('ai') as unknown as {
      streamText: (options: Record<string, unknown>) => AIStreamResult
    }

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
      usage: result.usage.then((u) => ({
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
  const model = await resolveEmbeddingModel(modelName)

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
    // Dynamic import of 'ai' package with typed interface for the parts we use
    const aiModule = await import('ai') as unknown as {
      embed: (options: { model: unknown; value: string }) => Promise<{ embedding: number[] }>
    }
    const embed = aiModule.embed

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

    return results.map((r) => r.embedding)
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
