/**
 * sdk.do - Unified SDK for dotdo
 *
 * This package re-exports all functionality from rpc.do (client SDK)
 * and @dotdo/oauth (server-side OAuth), providing a single unified
 * SDK for building dotdo applications.
 *
 * @module sdk.do
 *
 * @example
 * ```typescript
 * import { createClient, TokenStore, ensureLoggedIn } from 'sdk.do'
 *
 * // Create an RPC client
 * const client = createClient({ url: 'https://api.dotdo.dev' })
 *
 * // Use token store for authentication
 * const tokenStore = new TokenStore()
 * await ensureLoggedIn({ tokenStore, interactive: true })
 * ```
 */

// Re-export everything from rpc.do (client SDK)
export * from 'rpc.do'

// Note: Auth exports are already included via rpc.do's index.ts
// which exports from './auth'. This includes:
// - TokenStore, ITokenStore, StoredTokens, getDefaultTokensPath
// - DeviceFlow, DeviceFlowOptions
// - AuthTransport, AuthTransportOptions
// - ensureLoggedIn, EnsureLoggedInOptions
// - createRefreshHandler, RefreshHandlerOptions
