/**
 * @dotdo/oauth Authorization Handler
 *
 * Hono handler for initiating OAuth authorization flow.
 * Generates PKCE pair and state, then redirects to provider.
 *
 * @module @dotdo/oauth/middleware/authorize
 */

import type { Handler } from 'hono'
import type { OAuthProvider } from '../providers/interface'
import type { PKCEPair } from '../core/types'
import { ProviderRegistry } from '../providers/registry'
import { generatePKCE } from '../core/pkce'
import { createStateWithMetadata } from '../core/state'

/**
 * Options for the authorize handler with a single provider
 */
export interface AuthorizeHandlerOptionsWithProvider {
  /** Single OAuth provider to use */
  provider: OAuthProvider
  /** Provider registry (optional, provider takes precedence) */
  registry?: never
  /** Function to store PKCE pair for later retrieval */
  storePKCE: (pkce: PKCEPair, c: unknown) => Promise<void>
  /** Function to store state token for later retrieval */
  storeState: (state: string, c: unknown) => Promise<void>
  /** Default redirect URI after auth completes */
  defaultRedirectUri?: string
}

/**
 * Options for the authorize handler with a registry
 */
export interface AuthorizeHandlerOptionsWithRegistry {
  /** Single OAuth provider (optional, registry takes precedence) */
  provider?: never
  /** Provider registry for multi-provider support */
  registry: ProviderRegistry
  /** Default provider name when not specified in query */
  defaultProvider?: string
  /** Function to store PKCE pair for later retrieval */
  storePKCE: (pkce: PKCEPair, c: unknown) => Promise<void>
  /** Function to store state token for later retrieval */
  storeState: (state: string, c: unknown) => Promise<void>
  /** Default redirect URI after auth completes */
  defaultRedirectUri?: string
}

export type AuthorizeHandlerOptions =
  | AuthorizeHandlerOptionsWithProvider
  | AuthorizeHandlerOptionsWithRegistry

/**
 * Create an OAuth authorization handler
 *
 * Initiates the OAuth flow by:
 * 1. Generating a PKCE pair (verifier + challenge)
 * 2. Creating a state token with redirect URI metadata
 * 3. Storing PKCE and state for callback verification
 * 4. Redirecting to the OAuth provider
 *
 * Query parameters:
 * - `redirect_uri`: Where to redirect after auth (optional)
 * - `provider`: Provider name when using registry (optional)
 *
 * @example
 * ```typescript
 * // Single provider
 * const authorizeHandler = createAuthorizeHandler({
 *   provider: googleProvider,
 *   storePKCE: async (pkce, c) => setPKCEInSession(pkce, c),
 *   storeState: async (state, c) => setStateInSession(state, c),
 * })
 *
 * // Multi-provider with registry
 * const authorizeHandler = createAuthorizeHandler({
 *   registry: providerRegistry,
 *   storePKCE: async (pkce, c) => setPKCEInSession(pkce, c),
 *   storeState: async (state, c) => setStateInSession(state, c),
 * })
 *
 * app.get('/auth/login', authorizeHandler)
 * ```
 */
export function createAuthorizeHandler(options: AuthorizeHandlerOptions): Handler {
  const { storePKCE, storeState, defaultRedirectUri = '/' } = options

  return async (c) => {
    // Extract query parameters
    const url = new URL(c.req.url)
    const redirectUri = url.searchParams.get('redirect_uri') || defaultRedirectUri
    const providerName = url.searchParams.get('provider')

    // Resolve provider
    let provider: OAuthProvider | null = null

    if ('provider' in options && options.provider) {
      provider = options.provider
    } else if ('registry' in options && options.registry) {
      const registry = options.registry
      const name = providerName || options.defaultProvider

      if (!name) {
        return c.json({ error: 'Provider not specified' }, 400)
      }

      provider = registry.get(name)

      if (!provider) {
        return c.json({ error: `Unknown provider: ${name}` }, 400)
      }
    }

    if (!provider) {
      return c.json({ error: 'No provider configured' }, 500)
    }

    // Generate PKCE pair
    const pkce = await generatePKCE()

    // Create state with metadata
    const state = await createStateWithMetadata({
      redirectUri,
      provider: provider.name,
    })

    // Store PKCE and state for callback verification
    await storePKCE(pkce, c)
    await storeState(state, c)

    // Generate authorization URL and redirect
    const authUrl = provider.getAuthorizationUrl(state, pkce.challenge)

    return c.redirect(authUrl, 302)
  }
}
