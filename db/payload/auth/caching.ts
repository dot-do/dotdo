/**
 * Session Caching Module (Stub - RED Phase)
 *
 * Provides two-level session caching:
 * - L1: In-memory LRU cache (fast, per-instance)
 * - L2: KV cache (shared across instances)
 *
 * This is a stub implementation for RED phase testing.
 * Will be implemented in GREEN phase.
 *
 * @module @dotdo/payload/auth/caching
 */

import type { SessionValidationResult, BetterAuthUser, SessionData } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Cached session data including user and expiry metadata.
 */
export interface CachedSession {
  user: BetterAuthUser
  session: SessionData
  /** Timestamp when this cache entry was created */
  cachedAt: number
  /** Timestamp when this cache entry expires */
  expiresAt: number
}

/**
 * L1 memory cache interface for session data.
 */
export interface L1MemoryCache {
  get(token: string): CachedSession | undefined
  set(token: string, session: CachedSession): void
  delete(token: string): void
  clear(): void
  size(): number
}

/**
 * L2 KV cache interface for session data.
 */
export interface L2KVCache {
  get(token: string): Promise<CachedSession | null>
  set(token: string, session: CachedSession, ttlSeconds: number): Promise<void>
  delete(token: string): Promise<void>
}

/**
 * Configuration options for the L1 cache.
 */
export interface L1CacheConfig {
  /** Maximum entries in the cache */
  maxSize: number
  /** TTL in milliseconds */
  ttlMs: number
}

/**
 * Configuration options for the session cache.
 */
export interface SessionCacheConfig {
  /** L1 cache TTL in milliseconds (default: 60000 = 1 minute) */
  l1TtlMs?: number
  /** L2 cache TTL in seconds (default: 300 = 5 minutes) */
  l2TtlSeconds?: number
  /** Maximum entries in L1 cache (default: 1000) */
  l1MaxSize?: number
}

/**
 * Database interface for session validation queries.
 */
export interface SessionDatabase {
  getSessionByToken(token: string): Promise<SessionWithUser | null>
}

/**
 * Session record joined with user data from database.
 */
export interface SessionWithUser {
  session: {
    id: string
    token: string
    userId: string
    expiresAt: Date
    ipAddress: string | null
    userAgent: string | null
    activeOrganizationId: string | null
    activeTeamId: string | null
    impersonatedBy: string | null
    createdAt: Date
    updatedAt: Date
  }
  user: {
    id: string
    name: string
    email: string
    emailVerified: boolean
    image: string | null
    role: 'user' | 'admin' | 'owner' | null
    banned: boolean | null
    banReason: string | null
    banExpires: Date | null
    createdAt: Date
    updatedAt: Date
  }
}

/**
 * Cache invalidation event types.
 */
export type CacheInvalidationEvent =
  | { type: 'logout'; sessionToken: string }
  | { type: 'password_change'; userId: string }
  | { type: 'role_change'; userId: string }
  | { type: 'ban'; userId: string }

/**
 * Broadcast interface for cross-instance cache invalidation.
 */
export interface CacheInvalidationBroadcast {
  publish(event: CacheInvalidationEvent): Promise<void>
  subscribe(handler: (event: CacheInvalidationEvent) => void): () => void
}

/**
 * Options for creating a cached session validator.
 */
export interface CachedSessionValidatorOptions {
  db: SessionDatabase
  l1Cache: L1MemoryCache
  l2Cache: L2KVCache
  config?: SessionCacheConfig
  broadcast?: CacheInvalidationBroadcast
}

/**
 * Cached session validator interface.
 */
export interface CachedSessionValidator {
  validate(token: string): Promise<SessionValidationResult>
  invalidate(event: CacheInvalidationEvent): Promise<void>
}

// ============================================================================
// Stub Implementations (RED Phase)
// ============================================================================

/**
 * Creates an L1 memory cache.
 *
 * @stub This is a stub implementation that will be completed in GREEN phase.
 */
export function createL1Cache(_config: L1CacheConfig): L1MemoryCache {
  throw new Error('Not implemented: createL1Cache')
}

/**
 * Creates a cached session validator.
 *
 * @stub This is a stub implementation that will be completed in GREEN phase.
 */
export function createCachedSessionValidator(
  _options: CachedSessionValidatorOptions,
): CachedSessionValidator {
  throw new Error('Not implemented: createCachedSessionValidator')
}
