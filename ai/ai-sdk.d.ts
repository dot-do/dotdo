/**
 * Ambient module declarations for AI SDK packages.
 *
 * These packages are dynamically imported at runtime and may not be installed
 * as direct dependencies. These declarations provide type safety for the
 * dynamic imports.
 *
 * Includes:
 * - `ai` - Vercel AI SDK core package
 * - `@ai-sdk/openai` - OpenAI provider
 * - `@ai-sdk/anthropic` - Anthropic provider
 * - `@ai-sdk/google` - Google Generative AI provider
 */

/**
 * OpenAI provider settings
 */
interface OpenAIProviderSettings {
  apiKey?: string
  baseURL?: string
  organization?: string
  project?: string
  headers?: Record<string, string>
  fetch?: typeof fetch
  compatibility?: 'strict' | 'compatible'
}

/**
 * Anthropic provider settings
 */
interface AnthropicProviderSettings {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  fetch?: typeof fetch
}

/**
 * Google Generative AI provider settings
 */
interface GoogleGenerativeAIProviderSettings {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  fetch?: typeof fetch
}

/**
 * Common language model interface
 */
interface AILanguageModel {
  modelId: string
  provider: string
  specificationVersion: string
  doGenerate?: (options: unknown) => Promise<unknown>
  doStream?: (options: unknown) => Promise<unknown>
}

/**
 * Common embedding model interface
 */
interface AIEmbeddingModel {
  modelId: string
  provider: string
  specificationVersion: string
  doEmbed?: (options: unknown) => Promise<unknown>
}

/**
 * OpenAI provider interface
 */
interface OpenAIProvider {
  (modelId: string): AILanguageModel
  languageModel(modelId: string): AILanguageModel
  chat(modelId: string): AILanguageModel
  completion(modelId: string): AILanguageModel
  embedding(modelId: string): AIEmbeddingModel
  textEmbedding(modelId: string): AIEmbeddingModel
  textEmbeddingModel(modelId: string): AIEmbeddingModel
}

/**
 * Anthropic provider interface
 */
interface AnthropicProvider {
  (modelId: string): AILanguageModel
  languageModel(modelId: string): AILanguageModel
  chat(modelId: string): AILanguageModel
}

/**
 * Google Generative AI provider interface
 */
interface GoogleGenerativeAIProvider {
  (modelId: string): AILanguageModel
  languageModel(modelId: string): AILanguageModel
  chat(modelId: string): AILanguageModel
  textEmbeddingModel(modelId: string): AIEmbeddingModel
}

// ============================================================================
// Vercel AI SDK Core Module
// ============================================================================

/**
 * Usage statistics from AI generation
 */
interface AIUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

/**
 * Result from generateText
 */
interface GenerateTextResult {
  text: string
  usage?: AIUsage
  finishReason: string
}

/**
 * Result from generateObject
 */
interface GenerateObjectResult<T = unknown> {
  object: T
  usage?: AIUsage
  finishReason: string
}

/**
 * Result from streamText
 */
interface StreamTextResultType {
  textStream: AsyncIterable<string>
  fullStream: AsyncIterable<unknown>
  usage: Promise<AIUsage>
}

/**
 * Result from embed
 */
interface EmbedResult {
  embedding: number[]
}

declare module 'ai' {
  /**
   * Generate text using a language model
   */
  export function generateText(options: {
    model: AILanguageModel
    prompt?: string
    messages?: Array<{ role: string; content: string }>
    [key: string]: unknown
  }): Promise<GenerateTextResult>

  /**
   * Generate a structured object using a language model
   */
  export function generateObject<T = unknown>(options: {
    model: AILanguageModel
    schema: unknown
    prompt?: string
    messages?: Array<{ role: string; content: string }>
    output?: 'object' | 'array' | 'no-schema'
    [key: string]: unknown
  }): Promise<GenerateObjectResult<T>>

  /**
   * Stream text from a language model
   */
  export function streamText(options: {
    model: AILanguageModel
    prompt?: string
    messages?: Array<{ role: string; content: string }>
    [key: string]: unknown
  }): StreamTextResultType

  /**
   * Generate embeddings for text
   */
  export function embed(options: {
    model: AIEmbeddingModel
    value: string
  }): Promise<EmbedResult>

  /**
   * Generate embeddings for multiple texts
   */
  export function embedMany(options: {
    model: AIEmbeddingModel
    values: string[]
  }): Promise<{ embeddings: number[][] }>

  // Re-export commonly used types
  export type LanguageModel = AILanguageModel
  export type EmbeddingModel<T extends string = string> = AIEmbeddingModel

  // Provider registry types (used in ai-providers.d.ts)
  export interface Provider {
    languageModel(modelId: string): AILanguageModel
    textEmbeddingModel?(modelId: string): AIEmbeddingModel
  }

  export interface ProviderRegistryProvider extends Provider {
    (modelId: string): AILanguageModel
  }
}

// ============================================================================
// AI SDK Provider Modules
// ============================================================================

declare module '@ai-sdk/openai' {
  /**
   * Create an OpenAI provider instance
   */
  export function createOpenAI(settings?: OpenAIProviderSettings): OpenAIProvider

  /**
   * Default OpenAI provider instance
   */
  export const openai: OpenAIProvider
}

declare module '@ai-sdk/anthropic' {
  /**
   * Create an Anthropic provider instance
   */
  export function createAnthropic(settings?: AnthropicProviderSettings): AnthropicProvider

  /**
   * Default Anthropic provider instance
   */
  export const anthropic: AnthropicProvider
}

declare module '@ai-sdk/google' {
  /**
   * Create a Google Generative AI provider instance
   */
  export function createGoogleGenerativeAI(settings?: GoogleGenerativeAIProviderSettings): GoogleGenerativeAIProvider

  /**
   * Default Google Generative AI provider instance
   */
  export const google: GoogleGenerativeAIProvider
}
