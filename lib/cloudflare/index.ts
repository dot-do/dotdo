/**
 * Cloudflare Integration Layer for dotdo
 *
 * Provides typed wrappers for Cloudflare bindings:
 * - KV Store with namespacing, TTL management, and specialized methods
 *
 * @example
 * ```typescript
 * import { createKVStore } from 'lib/cloudflare'
 *
 * const store = createKVStore(env.KV, { namespace: 'tenant-123' })
 *
 * // Basic operations
 * await store.set('key', { data: 'value' }, { ttl: store.ttl.hours(1) })
 * const value = await store.get('key')
 *
 * // Session management
 * await store.setSession('sess-abc', { userId: 'user-123' }, store.ttl.days(7))
 *
 * // Rate limiting
 * const result = await store.checkRateLimit('user:123:api', 100, store.ttl.minutes(1))
 * if (!result.allowed) {
 *   throw new Error('Rate limit exceeded')
 * }
 *
 * // Caching expensive operations
 * const data = await store.cache('expensive-result', async () => {
 *   return await computeExpensiveResult()
 * }, { ttl: store.ttl.minutes(5) })
 * ```
 */

export {
  // Factory function
  createKVStore,
  // Class
  KVStore,
  // Types
  type KVNamespace,
  type KVStoreConfig,
  type SetOptions,
  type RateLimitData,
  type RateLimitCheckResult,
  type ListResult,
  type CacheOptions,
  type TTLHelpers,
} from './kv'
