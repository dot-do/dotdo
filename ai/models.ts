/**
 * Model Resolution for @dotdo/ai
 *
 * Provides model alias resolution and provider detection:
 * - Model aliases (sonnet -> claude-sonnet-4.5, etc.)
 * - Provider detection from model name
 * - Model resolution using ai-providers or mock fallback
 *
 * @module @dotdo/ai/models
 */

import type { Provider } from './router'
import { AIModelResolutionError } from './errors'
import { createMockModel, isModuleNotFoundError } from './mock'

// Type alias for AI SDK models (using any due to complex type resolution issues)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LanguageModel = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EmbeddingModel = any

// ============================================================================
// Model Aliases
// ============================================================================

/**
 * Model aliases for common models
 */
export const MODEL_ALIASES: Record<string, string> = {
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
export function resolveModelAlias(model: string): string {
  return MODEL_ALIASES[model] || model
}

// ============================================================================
// Provider Detection
// ============================================================================

// Store default provider for cases where it can't be inferred
let defaultProvider: Provider | null = null

/**
 * Set the default provider for model resolution
 */
export function setDefaultProvider(provider: Provider | null): void {
  defaultProvider = provider
}

/**
 * Get the default provider
 */
export function getDefaultProvider(): Provider | null {
  return defaultProvider
}

/**
 * Get provider from model name
 */
export function getProviderFromModel(model: string): Provider {
  const resolvedModel = resolveModelAlias(model)

  if (resolvedModel.startsWith('claude')) return 'anthropic'
  if (resolvedModel.startsWith('gpt')) return 'openai'
  if (resolvedModel.startsWith('gemini')) return 'google'

  // Default to configured provider
  return defaultProvider || 'anthropic'
}

// ============================================================================
// Model Resolution
// ============================================================================

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
export async function resolveModel(modelArg: string | LanguageModel): Promise<LanguageModel> {
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

/**
 * Resolve embedding model string to EmbeddingModel instance
 *
 * Uses ai-providers when available, returns null when the module
 * is not installed (caller should handle mock embeddings).
 *
 * @throws {AIModelResolutionError} When model resolution fails (wraps the original error)
 */
export async function resolveEmbeddingModel(modelName: string): Promise<EmbeddingModel | null> {
  try {
    const aiProviders = await import('ai-providers')
    // This may throw errors (auth, config, etc.) - wrap them!
    return await aiProviders.embeddingModel(modelName)
  } catch (e) {
    // Only return null if ai-providers module is not installed
    // This allows tests to run without the optional dependency
    if (isModuleNotFoundError(e)) {
      return null
    }
    // Wrap real errors (authentication, configuration, API errors, etc.)
    // in AIModelResolutionError for better error handling
    const cause = e instanceof Error ? e : new Error(String(e))
    throw new AIModelResolutionError(modelName, cause)
  }
}
