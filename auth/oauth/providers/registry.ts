/**
 * @dotdo/oauth Provider Registry
 *
 * A registry for managing OAuth providers. Supports registration,
 * lookup, and listing of providers.
 *
 * @module @dotdo/oauth/providers/registry
 */

import type { OAuthProvider } from './interface'

/**
 * Provider registry for managing OAuth providers.
 *
 * @example
 * ```typescript
 * const registry = new ProviderRegistry()
 *
 * // Register providers
 * registry.register(createGoogleProvider({ ... }))
 * registry.register(createGitHubProvider({ ... }))
 *
 * // Get a provider
 * const google = registry.get('google')
 *
 * // List all providers
 * const providers = registry.list()
 * ```
 */
export class ProviderRegistry {
  private providers: Map<string, OAuthProvider> = new Map()

  /**
   * Register a provider.
   *
   * @param provider - The provider to register
   */
  register(provider: OAuthProvider): void {
    this.providers.set(provider.name, provider)
  }

  /**
   * Get a provider by name.
   *
   * @param name - The provider name
   * @returns The provider or null if not found
   */
  get(name: string): OAuthProvider | null {
    return this.providers.get(name) ?? null
  }

  /**
   * Check if a provider is registered.
   *
   * @param name - The provider name
   * @returns True if the provider is registered
   */
  has(name: string): boolean {
    return this.providers.has(name)
  }

  /**
   * Unregister a provider.
   *
   * @param name - The provider name
   */
  unregister(name: string): void {
    this.providers.delete(name)
  }

  /**
   * List all registered providers.
   *
   * @returns Array of all registered providers
   */
  list(): OAuthProvider[] {
    return Array.from(this.providers.values())
  }
}
