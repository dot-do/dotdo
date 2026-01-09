import type { Context, MiddlewareHandler, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import * as jose from 'jose'

/**
 * Authentication Middleware
 *
 * Supports multiple authentication methods:
 * 1. JWT Bearer tokens (Authorization: Bearer <token>)
 * 2. Session cookies (via better-auth)
 * 3. API keys (X-API-Key header)
 *
 * Sets auth context for downstream handlers:
 * - c.get('user') - User info
 * - c.get('session') - Session info
 * - c.get('auth') - Full auth context
 */

// ============================================================================
// Types
// ============================================================================

export interface AuthContext {
  userId: string
  email?: string
  role: 'admin' | 'user'
  permissions?: string[]
  method: 'jwt' | 'session' | 'apikey'
}

export interface User {
  id: string
  email?: string
  name?: string
  role: 'admin' | 'user'
  permissions?: string[]
}

export interface Session {
  id: string
  userId: string
  expiresAt: Date
}

export interface JWTPayload {
  sub: string
  email?: string
  role?: 'admin' | 'user'
  permissions?: string[]
  iat?: number
  exp?: number
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

export interface AuthConfig {
  jwtSecret?: string
  jwksUrl?: string
  apiKeys?: Map<string, ApiKeyConfig>
  publicPaths?: string[]
  cookieName?: string
  /**
   * Custom session validator function.
   * When provided, this function is used to validate session tokens
   * instead of the mock validation.
   */
  validateSession?: SessionValidator
  /**
   * KV namespace for session caching.
   * When provided, validated sessions are cached for performance.
   */
  sessionCache?: KVNamespace
  /**
   * Session cache TTL in seconds (default: 300 = 5 minutes)
   */
  sessionCacheTtl?: number
  /**
   * Enable in-memory cache as L1 cache before KV.
   * This reduces KV calls for frequently accessed sessions.
   * Default: true when sessionCache is provided
   */
  enableMemoryCache?: boolean
  /**
   * Maximum number of sessions to keep in memory cache.
   * Default: 1000
   */
  memoryCacheMaxSize?: number
}

export interface ApiKeyConfig {
  userId: string
  role: 'admin' | 'user'
  permissions?: string[]
  name?: string
}

// ============================================================================
// Default Configuration
// ============================================================================

const defaultConfig: AuthConfig = {
  cookieName: 'session',
  publicPaths: ['/health', '/public'],
}

// ============================================================================
// In-Memory LRU Cache for Session Optimization
// ============================================================================

interface MemoryCacheEntry<T> {
  value: T
  expiresAt: number
}

/**
 * Simple LRU (Least Recently Used) cache for in-memory session storage.
 * Provides O(1) get/set operations with automatic expiration.
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

  get size(): number {
    return this.cache.size
  }

  /**
   * Remove expired entries. Call periodically for cleanup.
   */
  prune(): number {
    const now = Date.now()
    let removed = 0
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
        removed++
      }
    }
    return removed
  }
}

/**
 * Cached session data structure
 */
interface CachedSession {
  userId: string
  email?: string
  role: 'admin' | 'user'
  expiresAt?: string
}

// Global session memory cache instance (L1 cache before KV)
let sessionMemoryCache: MemoryCache<CachedSession> | null = null

function getSessionMemoryCache(config: AuthConfig): MemoryCache<CachedSession> | null {
  if (config.enableMemoryCache === false) {
    return null
  }
  // Only use memory cache if KV is also configured (L1 before L2)
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
 * Useful for testing or when sessions are invalidated.
 */
export function clearSessionMemoryCache(): void {
  sessionMemoryCache?.clear()
}

// ============================================================================
// API Key Loading from Environment/KV (SECURITY FIX)
// ============================================================================

/**
 * Load API keys from environment variable.
 * API_KEYS should be a JSON string mapping key -> ApiKeyConfig
 *
 * Example env.API_KEYS:
 * {
 *   "prod-key-123": { "userId": "user-1", "role": "user", "name": "Production Key" },
 *   "admin-key-456": { "userId": "admin-1", "role": "admin", "name": "Admin Key" }
 * }
 *
 * SECURITY: API keys must NEVER be hardcoded in source code.
 * They must come from environment variables or KV storage.
 */
export function loadApiKeysFromEnv(env: Record<string, unknown>): Map<string, ApiKeyConfig> {
  const apiKeys = new Map<string, ApiKeyConfig>()

  const apiKeysJson = env.API_KEYS as string | undefined
  if (!apiKeysJson) {
    return apiKeys
  }

  try {
    const parsed = JSON.parse(apiKeysJson) as Record<string, ApiKeyConfig>
    for (const [key, config] of Object.entries(parsed)) {
      apiKeys.set(key, config)
    }
  } catch {
    // Invalid JSON - return empty map
    console.warn('Failed to parse API_KEYS environment variable')
  }

  return apiKeys
}

// Runtime API key store - used for dynamically registered keys
// SECURITY: This should only be used for runtime-registered keys.
// Production keys should be loaded from environment via loadApiKeysFromEnv.
const runtimeApiKeys = new Map<string, ApiKeyConfig>()

/**
 * Create an API key loader that checks multiple sources in order:
 * 1. Environment variables (env.API_KEYS)
 * 2. Runtime-registered keys (via registerApiKey)
 * 3. KV storage
 *
 * Returns a function that can look up API key configurations.
 *
 * @param env - Environment bindings from the Cloudflare Worker context
 * @returns Async function to look up API key configurations
 */
export function getApiKeyLoader(
  env: Record<string, unknown>,
): (apiKey: string) => Promise<ApiKeyConfig | undefined> {
  // Load static keys from environment
  const envKeys = loadApiKeysFromEnv(env)

  // Get KV binding if available
  const kv = env.KV as { get: (key: string) => Promise<string | null> } | undefined

  return async (apiKey: string): Promise<ApiKeyConfig | undefined> => {
    // Check env keys first (faster, no network call)
    const envConfig = envKeys.get(apiKey)
    if (envConfig) {
      return envConfig
    }

    // Check runtime-registered keys
    const runtimeConfig = runtimeApiKeys.get(apiKey)
    if (runtimeConfig) {
      return runtimeConfig
    }

    // Fall back to KV lookup
    if (kv) {
      try {
        const kvValue = await kv.get(`api-key:${apiKey}`)
        if (kvValue) {
          return JSON.parse(kvValue) as ApiKeyConfig
        }
      } catch {
        // KV lookup failed - return undefined
      }
    }

    return undefined
  }
}

// ============================================================================
// JWT Verification
// ============================================================================

let jwks: jose.JWTVerifyGetKey | null = null

async function verifyJWT(token: string, config: AuthConfig): Promise<JWTPayload> {
  try {
    // Try JWKS first if configured
    if (config.jwksUrl) {
      if (!jwks) {
        jwks = jose.createRemoteJWKSet(new URL(config.jwksUrl))
      }
      const { payload } = await jose.jwtVerify(token, jwks)
      return payload as JWTPayload
    }

    // Fall back to symmetric secret
    if (config.jwtSecret) {
      const secret = new TextEncoder().encode(config.jwtSecret)
      const { payload } = await jose.jwtVerify(token, secret)
      return payload as JWTPayload
    }

    throw new Error('No JWT verification method configured')
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      throw new HTTPException(401, { message: 'Token expired' })
    }
    if (error instanceof jose.errors.JWTInvalid) {
      throw new HTTPException(401, { message: 'Invalid token' })
    }
    throw new HTTPException(401, { message: 'Token verification failed' })
  }
}

// ============================================================================
// Token Extraction
// ============================================================================

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null
  return parts[1]
}

function extractApiKey(c: Context): string | null {
  return c.req.header('x-api-key') || null
}

function extractSessionCookie(c: Context, cookieName: string): string | null {
  const cookie = c.req.header('cookie')
  if (!cookie) return null

  const cookies = cookie.split(';').reduce(
    (acc, curr) => {
      const [key, value] = curr.trim().split('=')
      acc[key] = value
      return acc
    },
    {} as Record<string, string>,
  )

  return cookies[cookieName] || null
}

// ============================================================================
// Authentication Methods
// ============================================================================

async function authenticateJWT(token: string, config: AuthConfig): Promise<AuthContext> {
  const payload = await verifyJWT(token, config)

  return {
    userId: payload.sub,
    email: payload.email,
    role: payload.role || 'user',
    permissions: payload.permissions,
    method: 'jwt',
  }
}

async function authenticateApiKey(
  apiKey: string,
  loader: (key: string) => Promise<ApiKeyConfig | undefined>,
): Promise<AuthContext> {
  const keyConfig = await loader(apiKey)
  if (!keyConfig) {
    throw new HTTPException(401, { message: 'Invalid API key' })
  }

  return {
    userId: keyConfig.userId,
    role: keyConfig.role,
    permissions: keyConfig.permissions,
    method: 'apikey',
  }
}

/**
 * Cache key for session tokens in KV
 */
function getSessionCacheKey(token: string): string {
  return `session:${token}`
}

/**
 * Check if a cached session is expired
 */
function isCachedSessionExpired(cached: CachedSession): boolean {
  if (!cached.expiresAt) {
    return false
  }
  return new Date(cached.expiresAt) <= new Date()
}

/**
 * Convert cached session to auth context
 */
function cachedSessionToAuthContext(cached: CachedSession): AuthContext {
  return {
    userId: cached.userId,
    email: cached.email,
    role: cached.role,
    method: 'session',
  }
}

async function authenticateSession(sessionToken: string, config: AuthConfig): Promise<AuthContext> {
  // Check if session validator is configured
  if (!config.validateSession) {
    throw new HTTPException(401, { message: 'Session validation not configured' })
  }

  const cacheKey = getSessionCacheKey(sessionToken)
  const memoryCache = getSessionMemoryCache(config)
  const ttl = config.sessionCacheTtl ?? 300 // Default 5 minutes

  // L1: Try memory cache first (fastest)
  if (memoryCache) {
    const memoryCached = memoryCache.get(cacheKey)
    if (memoryCached) {
      if (isCachedSessionExpired(memoryCached)) {
        memoryCache.delete(cacheKey)
      } else {
        return cachedSessionToAuthContext(memoryCached)
      }
    }
  }

  // L2: Try KV cache (if configured)
  if (config.sessionCache) {
    try {
      const cached = await config.sessionCache.get<CachedSession>(cacheKey, 'json')
      if (cached) {
        if (isCachedSessionExpired(cached)) {
          // Session expired, delete from cache and continue to validate
          await config.sessionCache.delete(cacheKey)
          memoryCache?.delete(cacheKey)
        } else {
          // Populate L1 cache from L2
          memoryCache?.set(cacheKey, cached, ttl)
          return cachedSessionToAuthContext(cached)
        }
      }
    } catch {
      // Cache error - continue without cache
    }
  }

  // L3: Validate session using the configured validator (slowest)
  const session = await config.validateSession(sessionToken)

  if (!session) {
    throw new HTTPException(401, { message: 'Invalid session' })
  }

  // Check if session is expired
  if (session.expiresAt && session.expiresAt <= new Date()) {
    throw new HTTPException(401, { message: 'Session expired' })
  }

  const cacheData: CachedSession = {
    userId: session.userId,
    email: session.email,
    role: session.role || 'user',
    expiresAt: session.expiresAt?.toISOString(),
  }

  // Write to both caches
  // L1: Memory cache
  memoryCache?.set(cacheKey, cacheData, ttl)

  // L2: KV cache
  if (config.sessionCache) {
    try {
      await config.sessionCache.put(cacheKey, JSON.stringify(cacheData), {
        expirationTtl: ttl,
      })
    } catch {
      // Cache write error - continue without caching
    }
  }

  return cachedSessionToAuthContext(cacheData)
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Main authentication middleware
 * Attempts to authenticate using JWT, API key, or session cookie
 */
export function authMiddleware(config: AuthConfig = {}): MiddlewareHandler {
  const mergedConfig = { ...defaultConfig, ...config }

  return async (c: Context, next: Next) => {
    const path = c.req.path

    // Skip auth for public paths
    if (mergedConfig.publicPaths?.some((p) => path.startsWith(p))) {
      return next()
    }

    // Get environment bindings for API key loading
    // SECURITY: API keys are loaded from env.API_KEYS or KV, never hardcoded
    const env = c.env as Record<string, unknown> | undefined
    const apiKeyLoader = getApiKeyLoader(env ?? {})

    let authContext: AuthContext | null = null

    // Try JWT Bearer token first
    const bearerToken = extractBearerToken(c.req.header('authorization'))
    if (bearerToken) {
      try {
        authContext = await authenticateJWT(bearerToken, mergedConfig)
      } catch (error) {
        if (error instanceof HTTPException) throw error
        // Continue to try other methods
      }
    }

    // Try API key (loaded from environment/KV)
    if (!authContext) {
      const apiKey = extractApiKey(c)
      if (apiKey) {
        authContext = await authenticateApiKey(apiKey, apiKeyLoader)
      }
    }

    // Try session cookie
    if (!authContext && mergedConfig.cookieName) {
      const sessionToken = extractSessionCookie(c, mergedConfig.cookieName)
      if (sessionToken) {
        try {
          authContext = await authenticateSession(sessionToken, mergedConfig)
        } catch {
          // Continue without auth
        }
      }
    }

    // Set context for downstream handlers
    if (authContext) {
      c.set('auth', authContext)
      c.set('user', {
        id: authContext.userId,
        email: authContext.email,
        role: authContext.role,
        permissions: authContext.permissions,
      } as User)
      c.set('session', { userId: authContext.userId } as Session)
    }

    return next()
  }
}

/**
 * Require authentication - returns 401 if not authenticated
 */
export function requireAuth(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth') as AuthContext | undefined
    if (!auth) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }
    return next()
  }
}

/**
 * Require specific role - returns 403 if role doesn't match
 */
export function requireRole(role: 'admin' | 'user'): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth') as AuthContext | undefined
    if (!auth) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }

    // Admin can access everything
    if (auth.role === 'admin') {
      return next()
    }

    // Check if user has required role
    if (auth.role !== role) {
      throw new HTTPException(403, { message: `Role '${role}' required` })
    }

    return next()
  }
}

/**
 * Require specific permission
 */
export function requirePermission(permission: string): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth') as AuthContext | undefined
    if (!auth) {
      throw new HTTPException(401, { message: 'Authentication required' })
    }

    // Admin has all permissions
    if (auth.role === 'admin') {
      return next()
    }

    if (!auth.permissions?.includes(permission)) {
      throw new HTTPException(403, { message: `Permission '${permission}' required` })
    }

    return next()
  }
}

// ============================================================================
// API Key Management (for runtime)
// ============================================================================

export function registerApiKey(key: string, config: ApiKeyConfig): void {
  runtimeApiKeys.set(key, config)
}

export function revokeApiKey(key: string): boolean {
  return runtimeApiKeys.delete(key)
}

export function validateApiKey(key: string): ApiKeyConfig | undefined {
  return runtimeApiKeys.get(key)
}

// ============================================================================
// JWT Token Generation (for testing/development)
// ============================================================================

export async function generateJWT(payload: Omit<JWTPayload, 'iat' | 'exp'>, secret: string, expiresIn: string = '1h'): Promise<string> {
  const secretKey = new TextEncoder().encode(secret)

  const jwt = await new jose.SignJWT(payload as jose.JWTPayload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(expiresIn).sign(secretKey)

  return jwt
}

// ============================================================================
// Session Validator Factory
// ============================================================================

/**
 * Database interface for session validation.
 * Compatible with Drizzle ORM query interface.
 */
export interface SessionDatabase {
  query: {
    sessions: {
      findFirst: (options: {
        where: (table: { token: unknown; expiresAt: unknown }, ops: { eq: (a: unknown, b: unknown) => unknown; and: (...args: unknown[]) => unknown; gt: (a: unknown, b: unknown) => unknown }) => unknown
      }) => Promise<{
        id: string
        userId: string
        token: string
        expiresAt: Date
      } | undefined>
    }
    users: {
      findFirst: (options: {
        where: (table: { id: unknown }, ops: { eq: (a: unknown, b: unknown) => unknown }) => unknown
      }) => Promise<{
        id: string
        email: string
        role?: string | null
      } | undefined>
    }
  }
}

/**
 * Create a session validator function from a Drizzle database.
 *
 * This factory creates a validator that:
 * 1. Looks up the session by token in the sessions table
 * 2. Verifies the session hasn't expired
 * 3. Fetches user details for the session
 *
 * @param db - Drizzle database instance with sessions and users tables
 * @returns SessionValidator function for use with authMiddleware
 *
 * @example
 * ```typescript
 * import { drizzle } from 'drizzle-orm/d1'
 * import { authMiddleware, createSessionValidator } from './middleware/auth'
 * import * as schema from '../db'
 *
 * const db = drizzle(env.DB, { schema })
 * const validateSession = createSessionValidator(db)
 *
 * app.use('*', authMiddleware({
 *   validateSession,
 *   sessionCache: env.KV,
 * }))
 * ```
 */
export function createSessionValidator(db: SessionDatabase): SessionValidator {
  return async (token: string) => {
    // Look up session by token
    const session = await db.query.sessions.findFirst({
      where: (t, { eq, and, gt }) => and(eq(t.token, token), gt(t.expiresAt, new Date())),
    })

    if (!session) {
      return null
    }

    // Get user details
    const user = await db.query.users.findFirst({
      where: (t, { eq }) => eq(t.id, session.userId),
    })

    if (!user) {
      return null
    }

    return {
      userId: user.id,
      email: user.email,
      role: (user.role as 'admin' | 'user') || 'user',
      expiresAt: session.expiresAt,
    }
  }
}

export default authMiddleware
