import type { Context, Next } from 'hono'

/**
 * @dotdo/auth - API Key Authentication
 *
 * Provides complete API key lifecycle management including:
 * - Key generation with cryptographic randomness
 * - Secure storage with SHA-256 hashing
 * - Scope-based authorization
 * - Rate limiting per key
 * - Key rotation and revocation
 *
 * @module @dotdo/auth/apikey
 *
 * @example
 * ```typescript
 * import { ApiKeyManager, createApiKeyMiddleware } from '@dotdo/auth'
 *
 * // Create manager
 * const manager = new ApiKeyManager()
 *
 * // Generate a new API key
 * const { key, apiKey } = await manager.create({
 *   name: 'Production API Key',
 *   scopes: ['users:read', 'posts:*'],
 *   rateLimit: { maxRequests: 1000, windowMs: 60000 },
 *   metadata: { userId: '123', team: 'engineering' }
 * })
 *
 * // Validate key
 * const result = await manager.validate(key)
 * if (result.valid) {
 *   console.log('Valid key:', result.apiKey)
 * }
 *
 * // Use as Hono middleware
 * app.use('/api/*', createApiKeyMiddleware(manager, {
 *   requireScopes: ['api:read']
 * }))
 *
 * // Rotate key
 * const { key: newKey } = await manager.rotate(apiKey.id)
 *
 * // Revoke key
 * await manager.revoke(apiKey.id)
 * ```
 */

/**
 * Stored API key information (never contains the raw key).
 */
export interface ApiKey {
  /** Unique identifier for this API key */
  id: string
  /** Human-readable name for the key */
  name: string
  /** SHA-256 hash of the raw key for validation */
  hashedKey: string
  /** First 12 characters for identification (e.g., 'dotdo_abc123') */
  prefix: string
  /** Authorization scopes (e.g., ['users:read', 'posts:*']) */
  scopes: string[]
  /** Whether the key is currently active */
  active: boolean
  /** When the key was created */
  createdAt: Date
  /** Optional expiration date */
  expiresAt?: Date | undefined
  /** When the key was revoked (if revoked) */
  revokedAt?: Date | undefined
  /** Last time the key was used */
  lastUsedAt?: Date | undefined
  /** Custom metadata attached to the key */
  metadata?: Record<string, unknown> | undefined
  /** Optional rate limiting configuration */
  rateLimit?: {
    maxRequests: number
    windowMs: number
  } | undefined
}

export interface ApiKeyCreateOptions {
  name: string
  prefix?: string
  scopes?: string[]
  expiresAt?: Date | undefined
  metadata?: Record<string, unknown> | undefined
  rateLimit?: {
    maxRequests: number
    windowMs: number
  } | undefined
}

export interface ApiKeyValidationResult {
  valid: boolean
  apiKey?: ApiKey
  error?: string
}

export interface ApiKeyListOptions {
  active?: boolean
}

export interface RateLimitWindow {
  count: number
  resetAt: Date
}

/**
 * Storage interface for API key persistence.
 * This follows the ThingsStore pattern from @dotdo/db but is defined here
 * to avoid circular dependencies.
 */
export interface ApiKeyStore {
  create<D extends { $type: string }>(data: D): Promise<D & { $id: string; $createdAt: number; $updatedAt: number }>
  get(id: string): Promise<{ $id: string; $type: string; $createdAt: number; $updatedAt: number; [key: string]: unknown } | null>
  update(id: string, data: Record<string, unknown>): Promise<{ $id: string; $type: string; [key: string]: unknown }>
  list(options?: { type?: string }): Promise<Array<{ $id: string; $type: string; [key: string]: unknown }>>
}

/**
 * Options for creating an ApiKeyManager
 */
export interface ApiKeyManagerOptions {
  /**
   * Optional storage for persisting API keys.
   * When provided, keys are stored in the ThingsStore (SQLite-backed in DO context).
   * When omitted, keys are stored in memory only.
   */
  store?: ApiKeyStore | undefined
}

/**
 * API Key Manager - handles full API key lifecycle.
 *
 * Manages creation, validation, rotation, and revocation of API keys.
 * Keys are stored with SHA-256 hashing for security - the raw key
 * is only returned once during creation and cannot be retrieved later.
 *
 * Supports optional persistence via a ThingsStore for SQLite-backed storage
 * in Durable Object contexts. When no store is provided, falls back to
 * in-memory storage.
 *
 * @example
 * ```typescript
 * // In-memory storage (default)
 * const manager = new ApiKeyManager()
 *
 * // With SQLite persistence (in DO context)
 * const manager = new ApiKeyManager({ store: this.things })
 *
 * // Create a key
 * const { key, apiKey } = await manager.create({
 *   name: 'My API Key',
 *   scopes: ['read', 'write'],
 *   rateLimit: { maxRequests: 100, windowMs: 60000 }
 * })
 *
 * // Save the raw key - it won't be accessible again!
 * console.log('Save this key:', key)
 *
 * // Later, validate the key
 * const result = await manager.validate(key)
 * if (result.valid) {
 *   console.log('Access granted with scopes:', result.apiKey.scopes)
 * }
 * ```
 */
export class ApiKeyManager {
  private keys: Map<string, ApiKey> = new Map()
  private keyHashes: Map<string, string> = new Map() // hashedKey -> id
  private rateLimits: Map<string, RateLimitWindow> = new Map() // id -> window
  private store?: ApiKeyStore | undefined
  private initialized = false
  private initPromise?: Promise<void> | undefined
  /** Maps API key ID (key_xxx) to storage $id for updates */
  private keyIdToStoreId: Map<string, string> = new Map()

  /** The $type used for storing API keys in ThingsStore */
  static readonly API_KEY_TYPE = 'ApiKey'

  constructor(options: ApiKeyManagerOptions = {}) {
    this.store = options.store

    // If we have a store, load existing keys on first operation
    if (this.store) {
      this.initPromise = this.loadFromStore()
    } else {
      this.initialized = true
    }
  }

  /**
   * Load API keys from persistent store into memory cache
   */
  private async loadFromStore(): Promise<void> {
    if (this.initialized || !this.store) return

    try {
      const stored = await this.store.list({ type: ApiKeyManager.API_KEY_TYPE })

      for (const item of stored) {
        const apiKey = this.deserializeApiKey(item)
        this.keys.set(apiKey.id, apiKey)
        this.keyHashes.set(apiKey.hashedKey, apiKey.id)
        // Track the mapping from our key ID to store's $id for updates
        this.keyIdToStoreId.set(apiKey.id, item.$id)
      }

      this.initialized = true
    } catch (error) {
      // Log but don't throw - allows fallback to in-memory
      console.error('[ApiKeyManager] Failed to load from store:', error)
      this.initialized = true
    }
  }

  /**
   * Ensure storage is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise
    }
  }

  /**
   * Serialize an ApiKey for storage (converts Date to timestamps)
   */
  private serializeApiKey(apiKey: ApiKey): Record<string, unknown> {
    return {
      $type: ApiKeyManager.API_KEY_TYPE,
      keyId: apiKey.id,
      name: apiKey.name,
      hashedKey: apiKey.hashedKey,
      prefix: apiKey.prefix,
      scopes: JSON.stringify(apiKey.scopes),
      active: apiKey.active,
      createdAt: apiKey.createdAt.getTime(),
      expiresAt: apiKey.expiresAt?.getTime(),
      revokedAt: apiKey.revokedAt?.getTime(),
      lastUsedAt: apiKey.lastUsedAt?.getTime(),
      metadata: apiKey.metadata ? JSON.stringify(apiKey.metadata) : undefined,
      rateLimitMaxRequests: apiKey.rateLimit?.maxRequests,
      rateLimitWindowMs: apiKey.rateLimit?.windowMs
    }
  }

  /**
   * Deserialize an ApiKey from storage (converts timestamps to Date)
   */
  private deserializeApiKey(stored: Record<string, unknown>): ApiKey {
    return {
      id: stored.keyId as string,
      name: stored.name as string,
      hashedKey: stored.hashedKey as string,
      prefix: stored.prefix as string,
      scopes: JSON.parse(stored.scopes as string) as string[],
      active: stored.active as boolean,
      createdAt: new Date(stored.createdAt as number),
      expiresAt: stored.expiresAt ? new Date(stored.expiresAt as number) : undefined,
      revokedAt: stored.revokedAt ? new Date(stored.revokedAt as number) : undefined,
      lastUsedAt: stored.lastUsedAt ? new Date(stored.lastUsedAt as number) : undefined,
      metadata: stored.metadata ? JSON.parse(stored.metadata as string) : undefined,
      rateLimit: stored.rateLimitMaxRequests !== undefined ? {
        maxRequests: stored.rateLimitMaxRequests as number,
        windowMs: stored.rateLimitWindowMs as number
      } : undefined
    }
  }

  /**
   * Create a new API key
   */
  async create(options: ApiKeyCreateOptions): Promise<{ key: string; apiKey: ApiKey }> {
    await this.ensureInitialized()

    const { name, prefix = 'dotdo', scopes = ['*'], expiresAt, metadata, rateLimit } = options

    // Generate key
    const key = ApiKeyAuth.generateKey(prefix)
    const hashedKey = await ApiKeyAuth.hashKey(key)

    // Create API key record
    const apiKey: ApiKey = {
      id: this.generateId(),
      name,
      hashedKey,
      prefix: key.slice(0, 12), // First 12 chars for display/identification
      scopes,
      active: true,
      createdAt: new Date(),
      expiresAt,
      metadata,
      rateLimit
    }

    // Store in memory cache
    this.keys.set(apiKey.id, apiKey)
    this.keyHashes.set(hashedKey, apiKey.id)

    // Persist to storage if available
    if (this.store) {
      const stored = await this.store.create(this.serializeApiKey(apiKey) as { $type: string })
      // Track the mapping from our key ID to store's $id for updates
      this.keyIdToStoreId.set(apiKey.id, stored.$id)
    }

    return { key, apiKey }
  }

  /**
   * Validate an API key
   */
  async validate(key: string): Promise<ApiKeyValidationResult> {
    await this.ensureInitialized()

    // Check format
    if (!key || !key.includes('_')) {
      return {
        valid: false,
        error: 'Invalid API key format'
      }
    }

    // Hash and lookup
    const hashedKey = await ApiKeyAuth.hashKey(key)
    const id = this.keyHashes.get(hashedKey)

    if (!id) {
      return {
        valid: false,
        error: 'Invalid API key'
      }
    }

    const apiKey = this.keys.get(id)

    if (!apiKey) {
      return {
        valid: false,
        error: 'Invalid API key'
      }
    }

    // Check if active
    if (!apiKey.active) {
      return {
        valid: false,
        error: 'API key revoked'
      }
    }

    // Check expiration
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return {
        valid: false,
        error: 'API key expired'
      }
    }

    // Update last used
    apiKey.lastUsedAt = new Date()
    this.keys.set(id, apiKey)

    // Persist lastUsedAt to storage if available
    if (this.store) {
      const storeId = this.keyIdToStoreId.get(apiKey.id)
      if (storeId) {
        await this.store.update(storeId, { lastUsedAt: apiKey.lastUsedAt.getTime() })
      }
    }

    return {
      valid: true,
      apiKey
    }
  }

  /**
   * Get an API key by ID
   */
  async get(id: string): Promise<ApiKey | undefined> {
    await this.ensureInitialized()
    return this.keys.get(id)
  }

  /**
   * List all API keys
   */
  async list(options: ApiKeyListOptions = {}): Promise<ApiKey[]> {
    await this.ensureInitialized()
    const { active } = options
    const keys = Array.from(this.keys.values())

    if (active !== undefined) {
      return keys.filter(k => k.active === active)
    }

    return keys
  }

  /**
   * Revoke an API key
   */
  async revoke(id: string): Promise<void> {
    await this.ensureInitialized()
    const apiKey = this.keys.get(id)

    if (apiKey) {
      apiKey.active = false
      apiKey.revokedAt = new Date()
      this.keys.set(id, apiKey)

      // Persist to storage if available
      if (this.store) {
        const storeId = this.keyIdToStoreId.get(id)
        if (storeId) {
          await this.store.update(storeId, {
            active: false,
            revokedAt: apiKey.revokedAt.getTime()
          })
        }
      }
    }
  }

  /**
   * Rotate an API key - creates a new key with same properties and revokes the old one
   */
  async rotate(id: string): Promise<{ key: string; apiKey: ApiKey }> {
    const oldKey = this.keys.get(id)

    if (!oldKey) {
      throw new Error('API key not found')
    }

    // Create new key with same properties
    const { key, apiKey } = await this.create({
      name: oldKey.name,
      prefix: oldKey.prefix.replace('_', ''),
      scopes: oldKey.scopes,
      expiresAt: oldKey.expiresAt,
      metadata: oldKey.metadata,
      rateLimit: oldKey.rateLimit
    })

    // Revoke old key
    await this.revoke(id)

    return { key, apiKey }
  }

  /**
   * Check rate limit for an API key
   * Note: Rate limits are kept in-memory only for performance.
   * They reset on DO restart, which is acceptable behavior.
   */
  async checkRateLimit(id: string): Promise<boolean> {
    await this.ensureInitialized()
    const apiKey = this.keys.get(id)

    if (!apiKey || !apiKey.rateLimit) {
      return true // No rate limit
    }

    const { maxRequests, windowMs } = apiKey.rateLimit
    const now = new Date()

    // Get or create window
    let window = this.rateLimits.get(id)

    if (!window || window.resetAt < now) {
      // Start new window
      window = {
        count: 0,
        resetAt: new Date(now.getTime() + windowMs)
      }
      this.rateLimits.set(id, window)
    }

    // Check limit
    if (window.count >= maxRequests) {
      return false
    }

    // Increment count
    window.count++
    this.rateLimits.set(id, window)

    return true
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `key_${crypto.randomUUID()}`
  }
}

/**
 * API Key authentication utilities - static helper methods.
 *
 * Provides low-level utilities for key generation, hashing, and scope checking.
 * For most use cases, use ApiKeyManager instead.
 */
export class ApiKeyAuth {
  /**
   * Generate a new API key
   */
  static generateKey(prefix = 'dotdo'): string {
    const randomBytes = new Uint8Array(32)
    crypto.getRandomValues(randomBytes)

    // Convert to base62 (alphanumeric)
    const base62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let result = ''

    for (const byte of randomBytes) {
      result += base62[byte % base62.length]
    }

    return `${prefix}_${result}`
  }

  /**
   * Hash an API key for storage
   */
  static async hashKey(key: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(key)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  /**
   * Check if an API key has a specific scope
   */
  static hasScope(apiKey: ApiKey, requiredScope: string): boolean {
    const { scopes } = apiKey

    // Check for global wildcard
    if (scopes.includes('*')) {
      return true
    }

    // Check exact match
    if (scopes.includes(requiredScope)) {
      return true
    }

    // Check resource wildcard (e.g., "users:*" matches "users:read")
    const [resource] = requiredScope.split(':')
    if (scopes.includes(`${resource}:*`)) {
      return true
    }

    return false
  }

  /**
   * Extract prefix from key
   */
  static extractPrefix(key: string): string | undefined {
    const parts = key.split('_')
    const prefix = parts[0]
    return parts.length > 1 && prefix ? prefix : undefined
  }

  /**
   * Validate key format
   */
  static isValidFormat(key: string): boolean {
    // Must have prefix_secret format
    if (!key || !key.includes('_')) {
      return false
    }

    const parts = key.split('_')
    if (parts.length !== 2) {
      return false
    }

    const prefix = parts[0]
    const secret = parts[1]

    // Both parts must exist
    if (!prefix || !secret) {
      return false
    }

    // Prefix should be alphabetic
    if (!/^[a-z]+$/i.test(prefix)) {
      return false
    }

    // Secret should be alphanumeric and at least 16 chars
    if (!/^[a-zA-Z0-9]{16,}$/.test(secret)) {
      return false
    }

    return true
  }
}

/**
 * Create Hono middleware for API key authentication.
 *
 * This middleware validates API keys using an ApiKeyManager and supports
 * scope-based authorization and rate limiting.
 *
 * @param manager - The ApiKeyManager instance for key validation
 * @param options - Middleware configuration options
 * @param options.header - Header name for API key (default: 'X-API-Key')
 * @param options.requireScopes - Scopes required to access the route
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * import { ApiKeyManager, createApiKeyMiddleware } from '@dotdo/auth'
 *
 * const manager = new ApiKeyManager()
 *
 * // Require 'api:read' scope for this route
 * app.use('/api/*', createApiKeyMiddleware(manager, {
 *   requireScopes: ['api:read']
 * }))
 *
 * app.get('/api/data', (c) => {
 *   const apiKey = c.get('apiKey')
 *   return c.json({
 *     data: 'sensitive',
 *     scopes: apiKey.scopes
 *   })
 * })
 * ```
 */
export function createApiKeyMiddleware(manager: ApiKeyManager, options: {
  header?: string
  requireScopes?: string[]
} = {}) {
  const { header = 'X-API-Key', requireScopes = [] } = options

  return async (c: Context, next: Next) => {
    const key = c.req.header(header)

    if (!key) {
      return c.json({ error: `${header} header required` }, 401)
    }

    // Validate key
    const result = await manager.validate(key)

    if (!result.valid || !result.apiKey) {
      return c.json({ error: result.error || 'Invalid API key' }, 401)
    }

    // Check required scopes
    if (requireScopes.length > 0) {
      const hasRequiredScope = requireScopes.some(scope =>
        ApiKeyAuth.hasScope(result.apiKey!, scope)
      )

      if (!hasRequiredScope) {
        return c.json({
          error: `Required scope: ${requireScopes.join(' or ')}`
        }, 403)
      }
    }

    // Check rate limit
    const rateLimitOk = await manager.checkRateLimit(result.apiKey.id)

    if (!rateLimitOk) {
      return c.json({
        error: 'Rate limit exceeded'
      }, 429)
    }

    // Set user context
    c.set('user', {
      id: `apikey:${result.apiKey.id}`,
      roles: ['api'],
      scopes: result.apiKey.scopes
    })

    c.set('apiKey', result.apiKey)
    c.set('token', key)

    await next()
  }
}
