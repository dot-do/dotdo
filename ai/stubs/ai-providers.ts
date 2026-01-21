/**
 * Mock stub for ai-providers module during testing.
 *
 * This stub provides a mock model function that returns a mock LanguageModel
 * so that @org.ai/core can be imported and tested without requiring
 * actual AI provider configurations.
 *
 * @module ai/stubs/ai-providers
 */

import type { LanguageModel } from './ai'

/**
 * Mock model function that returns a mock LanguageModel
 */
export function model(modelId: string): LanguageModel {
  // Parse provider from modelId (e.g., "anthropic/claude-sonnet" -> "anthropic")
  const parts = modelId.split('/')
  const provider = parts.length > 1 ? parts[0] : 'mock'
  const actualModelId = parts.length > 1 ? parts.slice(1).join('/') : modelId

  return {
    provider,
    modelId: actualModelId,
    specificationVersion: 'v1',
  } as LanguageModel
}

/**
 * Mock provider registry
 */
export const providers = {
  openai: {
    languageModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    embeddingModels: ['text-embedding-3-small', 'text-embedding-3-large'],
  },
  anthropic: {
    languageModels: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-haiku-latest'],
    embeddingModels: [],
  },
  google: {
    languageModels: ['gemini-2.0-flash-exp', 'gemini-1.5-pro'],
    embeddingModels: ['text-embedding-004'],
  },
}

/**
 * Model aliases for common names
 */
export const aliases: Record<string, string> = {
  // Anthropic
  sonnet: 'anthropic/claude-sonnet-4-20250514',
  opus: 'anthropic/claude-opus-4-20250514',
  haiku: 'anthropic/claude-3-5-haiku-latest',
  // OpenAI
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  // Google
  gemini: 'google/gemini-2.0-flash-exp',
  'gemini-pro': 'google/gemini-1.5-pro',
}
