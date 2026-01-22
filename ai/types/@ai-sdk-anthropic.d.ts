/**
 * Type declarations for the optional @ai-sdk/anthropic module.
 *
 * This file provides type information for TypeScript compilation when
 * @ai-sdk/anthropic may not be installed (it's an optional peer dependency).
 * These types are only used for compile-time checking - the actual SDK
 * is dynamically imported at runtime when available.
 *
 * @see https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic
 * @module @ai-sdk/anthropic
 */

declare module '@ai-sdk/anthropic' {
  /**
   * Anthropic provider settings
   */
  export interface AnthropicProviderSettings {
    /** Anthropic API key */
    apiKey?: string
    /** Base URL for the Anthropic API */
    baseURL?: string
    /** Custom headers */
    headers?: Record<string, string>
    /** Custom fetch implementation */
    fetch?: typeof fetch
  }

  /**
   * Anthropic language model interface
   */
  export interface AnthropicLanguageModel {
    readonly provider: string
    readonly modelId: string
    readonly specificationVersion: string
  }

  /**
   * Anthropic provider instance
   */
  export interface AnthropicProvider {
    (modelId: string): AnthropicLanguageModel
    languageModel(modelId: string): AnthropicLanguageModel
  }

  /**
   * Create an Anthropic provider instance
   */
  export function createAnthropic(settings?: AnthropicProviderSettings): AnthropicProvider

  /**
   * Default Anthropic provider instance
   */
  export const anthropic: AnthropicProvider
}
