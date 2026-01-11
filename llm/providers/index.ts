/**
 * LLM Provider Adapters
 *
 * Exports all provider adapters and a registry for dynamic provider selection.
 *
 * @module llm/providers
 */

import type { ProviderAdapter, LLMProvider, LLMEnv } from '../types'

// Provider adapters
export { OpenAIAdapter, openaiAdapter } from './openai'
export { AnthropicAdapter, anthropicAdapter } from './anthropic'
export { WorkersAIAdapter, workersAIAdapter } from './workers-ai'
export { GoogleAIAdapter, googleAdapter } from './google'
export { OllamaAdapter, ollamaAdapter } from './ollama'

// Re-export for convenience
import { openaiAdapter } from './openai'
import { anthropicAdapter } from './anthropic'
import { workersAIAdapter } from './workers-ai'
import { googleAdapter } from './google'
import { ollamaAdapter } from './ollama'

/**
 * Registry of all available provider adapters
 */
export const providerRegistry: Map<LLMProvider, ProviderAdapter> = new Map()
providerRegistry.set('openai', openaiAdapter)
providerRegistry.set('anthropic', anthropicAdapter)
providerRegistry.set('workers-ai', workersAIAdapter)
providerRegistry.set('google', googleAdapter)
providerRegistry.set('ollama', ollamaAdapter)

/**
 * Get a provider adapter by name
 */
export function getProvider(name: LLMProvider): ProviderAdapter | undefined {
  return providerRegistry.get(name)
}

/**
 * Get all available providers
 */
export function getAllProviders(): ProviderAdapter[] {
  return Array.from(providerRegistry.values())
}

/**
 * Get available providers based on environment configuration
 */
export function getAvailableProviders(env: LLMEnv): ProviderAdapter[] {
  const available: ProviderAdapter[] = []

  if (env.OPENAI_API_KEY) {
    available.push(openaiAdapter)
  }
  if (env.ANTHROPIC_API_KEY) {
    available.push(anthropicAdapter)
  }
  if (env.GOOGLE_API_KEY) {
    available.push(googleAdapter)
  }
  if (env.AI) {
    available.push(workersAIAdapter)
  }
  if (env.OLLAMA_BASE_URL) {
    available.push(ollamaAdapter)
  }

  return available
}

/**
 * Find the best provider for a given model
 */
export function findProviderForModel(model: string, env: LLMEnv): ProviderAdapter | undefined {
  const available = getAvailableProviders(env)

  // First, try to find a provider that explicitly handles this model
  for (const provider of available) {
    if (provider.canHandle(model)) {
      return provider
    }
  }

  // If no explicit handler, return the first available provider
  return available[0]
}

/**
 * Default export: provider registry
 */
export default providerRegistry
