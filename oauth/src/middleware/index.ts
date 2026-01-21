/**
 * @dotdo/oauth Middleware Exports
 *
 * Barrel exports for OAuth Hono middleware and handlers.
 *
 * @module @dotdo/oauth/middleware
 */

// Session validation middleware
export { oauthMiddleware } from './oauth-middleware'
export type { OAuthMiddlewareOptions, JwtPayload } from './oauth-middleware'

// OAuth callback handler
export { createCallbackHandler } from './callback'
export type { CallbackHandlerOptions, CookieOptions } from './callback'

// Authorization redirect handler
export { createAuthorizeHandler } from './authorize'
export type {
  AuthorizeHandlerOptions,
  AuthorizeHandlerOptionsWithProvider,
  AuthorizeHandlerOptionsWithRegistry,
} from './authorize'

// Token refresh endpoint
export { createTokenEndpoint } from './token'
export type { TokenEndpointOptions } from './token'
