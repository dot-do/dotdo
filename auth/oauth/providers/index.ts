/**
 * @dotdo/oauth Providers
 *
 * OAuth provider registry and built-in providers.
 * Tree-shakeable exports for minimal bundle size.
 *
 * @module @dotdo/oauth/providers
 */

// Types and interfaces
export type { OAuthProvider, OAuthProviderConfig, UserInfo } from './interface'

// Registry
export { ProviderRegistry } from './registry'

// Built-in providers
export { createGoogleProvider, type GoogleProviderConfig } from './google'
export { createGitHubProvider, type GitHubProviderConfig } from './github'
export { createMicrosoftProvider, type MicrosoftProviderConfig } from './microsoft'
export { createCustomProvider, type CustomProviderConfig } from './custom'

// Default registry instance
import { ProviderRegistry } from './registry'

/**
 * Default provider registry instance.
 *
 * Use this registry to register and manage OAuth providers
 * across your application.
 *
 * @example
 * ```typescript
 * import { defaultRegistry, createGoogleProvider } from '@dotdo/oauth/providers'
 *
 * // Register a provider
 * defaultRegistry.register(createGoogleProvider({
 *   clientId: 'your-client-id',
 *   clientSecret: 'your-client-secret',
 *   redirectUri: 'https://yourapp.com/callback',
 * }))
 *
 * // Get a provider
 * const google = defaultRegistry.get('google')
 * ```
 */
export const defaultRegistry = new ProviderRegistry()
