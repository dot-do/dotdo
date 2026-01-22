/**
 * Type declarations for the optional @ai-sdk/google module.
 *
 * This file provides type information for TypeScript compilation when
 * @ai-sdk/google may not be installed (it's an optional peer dependency).
 * These types are only used for compile-time checking - the actual SDK
 * is dynamically imported at runtime when available.
 *
 * @see https://sdk.vercel.ai/providers/ai-sdk-providers/google-generative-ai
 * @module @ai-sdk/google
 */

declare module '@ai-sdk/google' {
  /**
   * Google Generative AI provider settings
   */
  export interface GoogleGenerativeAIProviderSettings {
    /** Google AI API key */
    apiKey?: string
    /** Base URL for the Google AI API */
    baseURL?: string
    /** Custom headers */
    headers?: Record<string, string>
    /** Custom fetch implementation */
    fetch?: typeof fetch
  }

  /**
   * Google language model interface
   */
  export interface GoogleLanguageModel {
    readonly provider: string
    readonly modelId: string
    readonly specificationVersion: string
  }

  /**
   * Google embedding model interface
   */
  export interface GoogleEmbeddingModel {
    readonly provider: string
    readonly modelId: string
    readonly specificationVersion: string
  }

  /**
   * Google Generative AI provider instance
   */
  export interface GoogleGenerativeAIProvider {
    (modelId: string): GoogleLanguageModel
    languageModel(modelId: string): GoogleLanguageModel
    textEmbeddingModel(modelId: string): GoogleEmbeddingModel
  }

  /**
   * Create a Google Generative AI provider instance
   */
  export function createGoogleGenerativeAI(settings?: GoogleGenerativeAIProviderSettings): GoogleGenerativeAIProvider

  /**
   * Default Google Generative AI provider instance
   */
  export const google: GoogleGenerativeAIProvider
}
