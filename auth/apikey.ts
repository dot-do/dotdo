// API Key Authentication for @dotdo/auth
// Provides key generation, validation, scoping, rate limiting, and rotation
//
// Usage:
//
// ```typescript
// import { ApiKeyManager, createApiKeyMiddleware } from '@dotdo/auth'
//
// // Create manager
// const manager = new ApiKeyManager()
//
// // Generate a new API key
// const { key, apiKey } = await manager.create({
//   name: 'Production API Key',
//   scopes: ['users:read', 'posts:*'],
//   rateLimit: { maxRequests: 1000, windowMs: 60000 },
//   metadata: { userId: '123', team: 'engineering' }
// })
//
// // Validate key
// const result = await manager.validate(key)
// if (result.valid) {
//   console.log('Valid key:', result.apiKey)
// }
//
// // Use as Hono middleware
// app.use('/api/*', createApiKeyMiddleware(manager, {
//   requireScopes: ['api:read']
// }))
//
// // Rotate key
// const { key: newKey } = await manager.rotate(apiKey.id)
//
// // Revoke key
// await manager.revoke(apiKey.id)
// ```

import type { Context, Next, MiddlewareHandler } from 'hono'

export interface ApiKey {
  id: string
  name: string
  hashedKey: string
  prefix: string
  scopes: string[]
  active: boolean
  createdAt: Date
  expiresAt?: Date | undefined
  revokedAt?: Date | undefined
  lastUsedAt?: Date | undefined
  metadata?: Record<string, unknown> | undefined
  rateLimit?: {
    maxRequests: number
    windowMs: number
  } | undefined
}

export interface ApiKeyCreateOptions {
  name: string
  prefix?: string
  scopes?: string[]
  expiresAt?: Date
  metadata?: Record<string, unknown>
  rateLimit?: {
    maxRequests: number
    windowMs: number
  }
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
 * API Key Manager - handles key lifecycle
 */
export class ApiKeyManager {
  private keys: Map<string, ApiKey> = new Map()
  private keyHashes: Map<string, string> = new Map() // hashedKey -> id
  private rateLimits: Map<string, RateLimitWindow> = new Map() // id -> window

  /**
   * Create a new API key
   */
  async create(options: ApiKeyCreateOptions): Promise<{ key: string; apiKey: ApiKey }> {
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

    // Store
    this.keys.set(apiKey.id, apiKey)
    this.keyHashes.set(hashedKey, apiKey.id)

    return { key, apiKey }
  }

  /**
   * Validate an API key
   */
  async validate(key: string): Promise<ApiKeyValidationResult> {
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

    return {
      valid: true,
      apiKey
    }
  }

  /**
   * Get an API key by ID
   */
  async get(id: string): Promise<ApiKey | undefined> {
    return this.keys.get(id)
  }

  /**
   * List all API keys
   */
  async list(options: ApiKeyListOptions = {}): Promise<ApiKey[]> {
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
    const apiKey = this.keys.get(id)

    if (apiKey) {
      apiKey.active = false
      apiKey.revokedAt = new Date()
      this.keys.set(id, apiKey)
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
      ...(oldKey.expiresAt !== undefined && { expiresAt: oldKey.expiresAt }),
      ...(oldKey.metadata !== undefined && { metadata: oldKey.metadata }),
      ...(oldKey.rateLimit !== undefined && { rateLimit: oldKey.rateLimit }),
    })

    // Revoke old key
    await this.revoke(id)

    return { key, apiKey }
  }

  /**
   * Check rate limit for an API key
   */
  async checkRateLimit(id: string): Promise<boolean> {
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
    return `key_${Math.random().toString(36).substring(2, 15)}_${Date.now()}`
  }
}

/**
 * API Key Authentication utilities
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
 * Hono middleware for API key authentication
 */
export function createApiKeyMiddleware(manager: ApiKeyManager, options: {
  header?: string
  requireScopes?: string[]
} = {}): MiddlewareHandler {
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
      scopes: result.apiKey.scopes,
      metadata: result.apiKey.metadata
    })

    c.set('apiKey', result.apiKey)
    c.set('token', key)

    await next()
  }
}
