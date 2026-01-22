/**
 * Type declarations for optional AI modules
 *
 * These modules are dynamically imported at runtime and may not be available.
 * The declarations allow TypeScript to compile without errors when the modules
 * are not installed.
 */

// ai-providers is an optional dependency from primitives.org.ai
declare module 'ai-providers' {
  export function model(modelId: string): Promise<unknown>
  export function embeddingModel(modelId: string): Promise<unknown>
}

// @ai-sdk/* packages are optional peer dependencies
declare module '@ai-sdk/openai' {
  interface OpenAIProviderSettings {
    apiKey?: string
    baseURL?: string
  }

  interface OpenAIProvider {
    (modelId: string): unknown
    embedding(modelId: string): unknown
  }

  export function createOpenAI(settings?: OpenAIProviderSettings): OpenAIProvider
}

declare module '@ai-sdk/anthropic' {
  interface AnthropicProviderSettings {
    apiKey?: string
    baseURL?: string
  }

  interface AnthropicProvider {
    (modelId: string): unknown
  }

  export function createAnthropic(settings?: AnthropicProviderSettings): AnthropicProvider
}

declare module '@ai-sdk/google' {
  interface GoogleProviderSettings {
    apiKey?: string
    baseURL?: string
  }

  interface GoogleProvider {
    (modelId: string): unknown
    textEmbeddingModel(modelId: string): unknown
  }

  export function createGoogleGenerativeAI(settings?: GoogleProviderSettings): GoogleProvider
}
