/**
 * Provider Registry - Central management for LLM providers
 *
 * Provides:
 * - Provider registration and lookup
 * - Model-to-provider mapping
 * - Provider lifecycle management
 *
 * @module db/primitives/agent-runtime/providers
 */

import type { LLMProvider, ProviderName } from '../types'

// ============================================================================
// Provider Registry Interface
// ============================================================================

export interface ProviderRegistry {
  /** Register a provider */
  register(provider: LLMProvider): void

  /** Get provider by name */
  get(name: ProviderName): LLMProvider | undefined

  /** Get provider that supports a model */
  getForModel(model: string): LLMProvider | undefined

  /** Remove a provider */
  remove(name: ProviderName): void

  /** Get all registered providers */
  getProviders(): LLMProvider[]

  /** Check if a provider is registered */
  has(name: ProviderName): boolean
}

// ============================================================================
// Provider Registry Implementation
// ============================================================================

class ProviderRegistryImpl implements ProviderRegistry {
  private providers: Map<ProviderName, LLMProvider> = new Map()

  constructor(initialProviders?: LLMProvider[]) {
    if (initialProviders) {
      for (const provider of initialProviders) {
        this.register(provider)
      }
    }
  }

  register(provider: LLMProvider): void {
    this.providers.set(provider.name, provider)
  }

  get(name: ProviderName): LLMProvider | undefined {
    return this.providers.get(name)
  }

  getForModel(model: string): LLMProvider | undefined {
    for (const provider of this.providers.values()) {
      if (provider.supportsModel(model)) {
        return provider
      }
    }
    return undefined
  }

  remove(name: ProviderName): void {
    this.providers.delete(name)
  }

  getProviders(): LLMProvider[] {
    return Array.from(this.providers.values())
  }

  has(name: ProviderName): boolean {
    return this.providers.has(name)
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createProviderRegistry(initialProviders?: LLMProvider[]): ProviderRegistry {
  return new ProviderRegistryImpl(initialProviders)
}
