/**
 * sdk.do/oauth - OAuth 2.1 Server-Side Utilities
 *
 * Re-exports all functionality from @dotdo/oauth for server-side
 * OAuth handling in Cloudflare Workers.
 *
 * @module sdk.do/oauth
 *
 * @example
 * ```typescript
 * import { oauthMiddleware, MemorySessionStore } from 'sdk.do/oauth'
 * import { Hono } from 'hono'
 *
 * const app = new Hono()
 * const sessionStore = new MemorySessionStore()
 *
 * app.use('/api/*', oauthMiddleware({
 *   sessionStore,
 *   jwtSecret: 'secret',
 * }))
 * ```
 */

// Re-export everything from @dotdo/oauth
export * from '@dotdo/oauth'
