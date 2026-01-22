/**
 * Type declarations for the optional @ai-sdk/openai module.
 *
 * This file provides type information for TypeScript compilation when
 * @ai-sdk/openai may not be installed (it's an optional peer dependency).
 * These types are only used for compile-time checking - the actual SDK
 * is dynamically imported at runtime when available.
 *
 * @see https://sdk.vercel.ai/providers/ai-sdk-providers/openai
 * @module @ai-sdk/openai
 */

declare module '@ai-sdk/openai' {
  /**
   * OpenAI provider settings
   */
  export interface OpenAIProviderSettings {
    /** OpenAI API key */
    apiKey?: string
    /** Base URL for the OpenAI API */
    baseURL?: string
    /** Organization ID */
    organization?: string
    /** Project ID */
    project?: string
    /** Custom headers */
    headers?: Record<string, string>
    /** Custom fetch implementation */
    fetch?: typeof fetch
  }

  /**
   * OpenAI language model interface
   */
  export interface OpenAILanguageModel {
    readonly provider: string
    readonly modelId: string
    readonly specificationVersion: string
  }

  /**
   * OpenAI embedding model interface
   */
  export interface OpenAIEmbeddingModel {
    readonly provider: string
    readonly modelId: string
    readonly specificationVersion: string
  }

  /**
   * OpenAI provider instance
   */
  export interface OpenAIProvider {
    (modelId: string): OpenAILanguageModel
    languageModel(modelId: string): OpenAILanguageModel
    embedding(modelId: string): OpenAIEmbeddingModel
    textEmbeddingModel(modelId: string): OpenAIEmbeddingModel
  }

  /**
   * Create an OpenAI provider instance
   */
  export function createOpenAI(settings?: OpenAIProviderSettings): OpenAIProvider

  /**
   * Default OpenAI provider instance
   */
  export const openai: OpenAIProvider
}
