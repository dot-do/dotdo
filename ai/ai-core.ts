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

export type SimpleSchema = Record<string, string | string[] | SimpleSchema>

// ============================================================================
// Provider Configuration
// ============================================================================

export type Provider = 'openai' | 'anthropic' | 'google' | 'cloudflare'

export interface ProviderConfig {
  provider: Provider
  apiKey?: string
  accountId?: string
  defaultModel?: string
}

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
 * Resolve model string to LanguageModel instance
 *
 * This is a placeholder that will be properly implemented when
 * ai-providers integration is complete. For now, it returns a mock.
 */
async function resolveModel(modelArg: string | LanguageModel): Promise<LanguageModel> {
  // Already a LanguageModel instance
  if (typeof modelArg !== 'string') {
    return modelArg
  }

  // Resolve alias
  const resolvedModel = resolveModelAlias(modelArg)

  // Try to use ai-providers if available, otherwise create a mock model
  try {
    const aiProviders = await import('ai-providers')
    return aiProviders.model(resolvedModel)
  } catch (e) {
    // Fallback: create a mock LanguageModel for testing
    // In production, ai-providers should be available
    return {
      provider: 'mock',
      modelId: resolvedModel,
      specificationVersion: 'v1',
      async doGenerate(options: any) {
        return {
          text: `Mock response for model: ${resolvedModel}`,
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
  finishReason?: string
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
  finishReason?: string
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
      promptTokens: result.usage?.promptTokens || 0,
      completionTokens: result.usage?.completionTokens || 0,
      totalTokens: result.usage?.totalTokens || 0,
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

  const result = aiStreamText({
    ...options,
    model,
  })

  return {
    textStream: result.textStream,
    fullStream: result.fullStream,
    usage: result.usage.then((u: any) => ({
      promptTokens: u?.promptTokens || 0,
      completionTokens: u?.completionTokens || 0,
      totalTokens: u?.totalTokens || 0,
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
    model = aiProviders.embeddingModel(modelName)
  } catch (e) {
    // Will use mock implementation below
    model = null
  }

  // If ai-providers is not available, return mock embeddings
  if (model === null) {
    if (typeof text === 'string') {
      return Array.from({ length: 1536 }, () => Math.random())
    }
    return text.map(() => Array.from({ length: 1536 }, () => Math.random()))
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

  return results.map(r => r.embedding)
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
  const result = await generateText({
    model: options.model,
    prompt: options.prompt,
    system: options.system,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
  })

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
  const result = await generateText({
    model: options.model,
    messages: options.messages,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
  })

  return result.text
}
