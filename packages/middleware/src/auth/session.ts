/**
 * Session middleware
 *
 * Session validation with support for:
 * - Custom session validators
 * - KV caching for performance
 * - Memory caching for hot sessions
 */

import type { MiddlewareHandler, Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'

// ============================================================================
// Types
// ============================================================================

export interface SessionConfig {
  cookieName?: string
  validateSession?: SessionValidator
  sessionCache?: KVNamespace
  sessionCacheTtl?: number
  enableMemoryCache?: boolean
  memoryCacheMaxSize?: number
}

/**
 * Session validation function type.
 * Returns session data if valid, null if invalid.
 */
export type SessionValidator = (token: string) => Promise<{
  userId: string
  email?: string
  role?: 'admin' | 'user'
  expiresAt?: Date
  activeOrganizationId?: string
} | null>

// ============================================================================
// Memory Cache
// ============================================================================

interface MemoryCacheEntry<T> {
  value: T
  expiresAt: number
}

/**
 * Simple LRU cache for in-memory session storage.
 */
export class MemoryCache<T> {
  private cache = new Map<string, MemoryCacheEntry<T>>()
  private readonly maxSize: number
  private readonly defaultTtlMs: number

  constructor(maxSize: number = 1000, defaultTtlSeconds: number = 300) {
    this.maxSize = maxSize
    this.defaultTtlMs = defaultTtlSeconds * 1000
  }

  get(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) {
      return null
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }

    // LRU: Move to end (most recently used)
    this.cache.delete(key)
    this.cache.set(key, entry)

    return entry.value
  }

  set(key: string, value: T, ttlSeconds?: number): void {
    // If at capacity, remove oldest entry (first in map)
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey) {
        this.cache.delete(oldestKey)
      }
    }

    const ttlMs = ttlSeconds ? ttlSeconds * 1000 : this.defaultTtlMs
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    })
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }
}

// Global session memory cache instance
let sessionMemoryCache: MemoryCache<CachedSession> | null = null

interface CachedSession {
  userId: string
  email?: string
  role: 'admin' | 'user'
  expiresAt?: string
}

function getSessionMemoryCache(config: SessionConfig): MemoryCache<CachedSession> | null {
  if (config.enableMemoryCache === false) {
    return null
  }
  if (!config.sessionCache && config.enableMemoryCache !== true) {
    return null
  }
  if (!sessionMemoryCache) {
    sessionMemoryCache = new MemoryCache<CachedSession>(
      config.memoryCacheMaxSize ?? 1000,
      config.sessionCacheTtl ?? 300,
    )
  }
  return sessionMemoryCache
}

/**
 * Clear the in-memory session cache.
 */
export function clearSessionMemoryCache(): void {
  sessionMemoryCache?.clear()
}

// ============================================================================
// Cookie Extraction
// ============================================================================

function extractSessionCookie(c: Context, cookieName: string): string | null {
  const cookie = c.req.header('cookie')
  if (!cookie) return null

  const cookies = cookie.split(';').reduce(
    (acc, curr) => {
      const [key, value] = curr.trim().split('=')
      if (key) acc[key] = value ?? ''
      return acc
    },
    {} as Record<string, string>,
  )

  return cookies[cookieName] || null
}

// ============================================================================
// Session Validation
// ============================================================================

function getSessionCacheKey(token: string): string {
  return `session:${token}`
}

function isCachedSessionExpired(cached: CachedSession): boolean {
  if (!cached.expiresAt) {
    return false
  }
  return new Date(cached.expiresAt) <= new Date()
}

async function validateSessionWithCache(
  sessionToken: string,
  config: SessionConfig,
): Promise<CachedSession | null> {
  if (!config.validateSession) {
    return null
  }

  const cacheKey = getSessionCacheKey(sessionToken)
  const memoryCache = getSessionMemoryCache(config)
  const ttl = config.sessionCacheTtl ?? 300

  // L1: Try memory cache first
  if (memoryCache) {
    const memoryCached = memoryCache.get(cacheKey)
    if (memoryCached) {
      if (isCachedSessionExpired(memoryCached)) {
        memoryCache.delete(cacheKey)
      } else {
        return memoryCached
      }
    }
  }

  // L2: Try KV cache
  if (config.sessionCache) {
    try {
      const cached = await config.sessionCache.get<CachedSession>(cacheKey, 'json')
      if (cached) {
        if (isCachedSessionExpired(cached)) {
          await config.sessionCache.delete(cacheKey)
          memoryCache?.delete(cacheKey)
        } else {
          memoryCache?.set(cacheKey, cached, ttl)
          return cached
        }
      }
    } catch {
      // Cache error - continue without cache
    }
  }

  // L3: Validate session
  const session = await config.validateSession(sessionToken)

  if (!session) {
    return null
  }

  // Check if session is expired
  if (session.expiresAt && session.expiresAt <= new Date()) {
    return null
  }

  const cacheData: CachedSession = {
    userId: session.userId,
    email: session.email,
    role: session.role || 'user',
    expiresAt: session.expiresAt?.toISOString(),
  }

  // Write to caches
  memoryCache?.set(cacheKey, cacheData, ttl)

  if (config.sessionCache) {
    try {
      await config.sessionCache.put(cacheKey, JSON.stringify(cacheData), {
        expirationTtl: ttl,
      })
    } catch {
      // Cache write error - continue without caching
    }
  }

  return cacheData
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Session middleware for Hono.
 *
 * Validates session cookies and sets the session data in the context.
 *
 * @param config - Session middleware configuration
 * @returns Hono middleware handler
 */
export function sessionMiddleware(config?: SessionConfig): MiddlewareHandler {
  const cookieName = config?.cookieName || 'session'

  return async (c: Context, next: Next) => {
    const sessionToken = extractSessionCookie(c, cookieName)

    if (!sessionToken) {
      throw new HTTPException(401, { message: 'No session cookie' })
    }

    if (!config?.validateSession) {
      throw new HTTPException(401, { message: 'Session validation not configured' })
    }

    const session = await validateSessionWithCache(sessionToken, config)

    if (!session) {
      throw new HTTPException(401, { message: 'Invalid session' })
    }

    c.set('session', {
      userId: session.userId,
      email: session.email,
      role: session.role,
    })

    return next()
  }
}

export default sessionMiddleware
