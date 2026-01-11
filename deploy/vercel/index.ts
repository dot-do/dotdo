/**
 * Vercel Edge Deployment for dotdo
 *
 * Deploy stateless Durable Objects to Vercel Edge Functions.
 *
 * @module deploy/vercel
 *
 * @example
 * ```typescript
 * // api/do.ts
 * import { edgeRouter } from 'dotdo/deploy/vercel'
 * import { Business, Agent } from 'dotdo/objects'
 *
 * export const config = { runtime: 'edge' }
 *
 * export default edgeRouter({
 *   classes: { Business, Agent },
 *   defaultClass: Business,
 * })
 * ```
 */

// Edge Router
export {
  edgeRouter,
  simpleRouter,
  type EdgeRouterConfig,
} from './edge-router'

// DO Adapter
export {
  createVercelDoHandler,
  VercelDoState,
  VercelDoId,
  VercelDoStorage,
  DO_STORAGE_SCHEMA,
  type DOClass,
  type DOInstance,
  type VercelDoHandler,
} from './do-adapter'

// Middleware
export {
  createMiddlewareChain,
  corsMiddleware,
  loggingMiddleware,
  rateLimitMiddleware,
  authMiddleware,
  requestIdMiddleware,
  compressionMiddleware,
  cacheMiddleware,
  type MiddlewareContext,
  type MiddlewareFunction,
  type CorsOptions,
  type LoggingOptions,
  type LogEntry,
  type RateLimitOptions,
  type AuthOptions,
  type AuthResult,
  type CompressionOptions,
  type CacheOptions,
} from './middleware'

// Environment
export {
  getEnv,
  parseDOClasses,
  isDebug,
  isConsistencyGuardEnabled,
  getLockTtl,
  type VercelEnv,
} from './env.d'

// Re-export config for Vercel runtime
export const config = {
  runtime: 'edge',
}

// Default export for convenience
export { edgeRouter as default } from './edge-router'
