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

import type { LanguageModel, EmbeddingModel } from 'ai'
import type { ZodTypeAny } from 'zod'

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

export interface SimpleSchema {
  [key: string]: string | string[] | SimpleSchema
}

// ============================================================================
// Provider Configuration
// ============================================================================

import type { Provider, ProviderConfig as BaseProviderConfig } from './types'

// Re-export for backward compatibility
export type { Provider } from './types'

export interface ProviderConfig extends BaseProviderConfig {}

// Global provider registry
const providers = new Map<Provider, ProviderConfig>()
let defaultProvider: Provider | null = null

/**
 * Configure a provider for AI operations
 */
export function configureProvider(config: ProviderConfig): void {
  providers.set(config.provider, config)

  // Set as default if it's the first provider
  if (defaultProvider === null) {
    defaultProvider = config.provider
  }
}

/**
 * Get provider configuration
 */
export function getProvider(provider?: Provider): ProviderConfig | undefined {
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
 * Create a mock LanguageModel for testing when ai-providers is not installed.
 *
 * IMPORTANT: This should only be used when the ai-providers module is genuinely
 * not available (development/testing without the optional dependency).
 * Real errors from ai-providers should propagate to the caller.
 */
function createMockModel(modelId: string): LanguageModel {
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
 * is not installed. Real errors (auth failures, API errors, etc.) are propagated.
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
    // Re-throw real errors (authentication, configuration, API errors, etc.)
    // These should not be masked by the mock fallback
    throw e
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
 */
export async function generateText(
  options: GenerateTextOptions
): Promise<GenerateTextResult> {
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
  const { generateText: aiGenerateText } = await import('ai')

  // Build options object carefully to avoid type issues with exactOptionalPropertyTypes
  const sdkOptions: Record<string, unknown> = { model }
  if (options.prompt !== undefined) sdkOptions['prompt'] = options.prompt
  if (options.messages !== undefined) sdkOptions['messages'] = options.messages
  if (options.system !== undefined) sdkOptions['system'] = options.system
  if (options.maxTokens !== undefined) sdkOptions['maxTokens'] = options.maxTokens
  if (options.temperature !== undefined) sdkOptions['temperature'] = options.temperature
  if (options.topP !== undefined) sdkOptions['topP'] = options.topP
  if (options.topK !== undefined) sdkOptions['topK'] = options.topK
  if (options.presencePenalty !== undefined) sdkOptions['presencePenalty'] = options.presencePenalty
  if (options.frequencyPenalty !== undefined) sdkOptions['frequencyPenalty'] = options.frequencyPenalty
  if (options.seed !== undefined) sdkOptions['seed'] = options.seed
  if (options.maxRetries !== undefined) sdkOptions['maxRetries'] = options.maxRetries
  if (options.abortSignal !== undefined) sdkOptions['abortSignal'] = options.abortSignal
  if (options.headers !== undefined) sdkOptions['headers'] = options.headers
  if (options.tools !== undefined) sdkOptions['tools'] = options.tools
  if (options.toolChoice !== undefined) sdkOptions['toolChoice'] = options.toolChoice
  if (options.maxSteps !== undefined) sdkOptions['maxSteps'] = options.maxSteps

  const result = await aiGenerateText(sdkOptions as Parameters<typeof aiGenerateText>[0])

  return {
    text: result.text,
    usage: {
      promptTokens: result.usage?.inputTokens ?? 0,
      completionTokens: result.usage?.outputTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
    },
    finishReason: result.finishReason,
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
 */
export async function generateObject<T>(
  options: GenerateObjectOptions<T>
): Promise<GenerateObjectResult<T>> {
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
  const { generateObject: aiGenerateObject } = await import('ai')

  const result = await aiGenerateObject({
    ...options,
    model,
    output: 'object',
  } as any)

  return {
    object: result.object as T,
    usage: {
      promptTokens: result.usage?.inputTokens ?? 0,
      completionTokens: result.usage?.outputTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
    },
    finishReason: result.finishReason,
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
 */
export async function streamText(
  options: StreamTextOptions
): Promise<StreamTextResult> {
  const { streamText: aiStreamText } = await import('ai')

  const model = await resolveModel(options.model)

  // Filter out undefined values to satisfy exactOptionalPropertyTypes
  const filteredOptions: Record<string, unknown> = { model }
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && key !== 'model') {
      filteredOptions[key] = value
    }
  }

  const result = aiStreamText(filteredOptions as Parameters<typeof aiStreamText>[0])

  return {
    textStream: result.textStream,
    fullStream: result.fullStream,
    usage: Promise.resolve(result.usage).then((u: any) => ({
      promptTokens: u?.inputTokens ?? 0,
      completionTokens: u?.outputTokens ?? 0,
      totalTokens: u?.totalTokens ?? 0,
    })),
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
    // This may throw errors (auth, config, etc.) - let them propagate!
    model = await aiProviders.embeddingModel(modelName)
  } catch (e) {
    // Only use mock embeddings if ai-providers module is not installed
    // This allows tests to run without the optional dependency
    if (isModuleNotFoundError(e)) {
      model = null
    } else {
      // Re-throw real errors (authentication, configuration, API errors, etc.)
      // These should not be masked by the mock fallback
      throw e
    }
  }

  // If ai-providers is not available (module not installed), return mock embeddings
  if (model === null) {
    if (typeof text === 'string') {
      return generateMockEmbedding(text, options?.dimensions)
    }
    return text.map((t) => generateMockEmbedding(t, options?.dimensions))
  }

  // Use real AI SDK with the model
  const { embed } = await import('ai')

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
  // Build options object with only defined values
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
  // Build options object with only defined values
  const genOptions: GenerateTextOptions = {
    model: options.model,
    messages: options.messages,
  }
  if (options.maxTokens !== undefined) genOptions.maxTokens = options.maxTokens
  if (options.temperature !== undefined) genOptions.temperature = options.temperature

  const result = await generateText(genOptions)

  return result.text
}
