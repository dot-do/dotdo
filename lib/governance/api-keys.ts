/**
 * API Keys - Hashed key management following Unkey patterns
 *
 * Features:
 * - SHA-256 hashed key storage (plaintext never stored)
 * - Key creation returns plaintext once
 * - Verification against hash with timing-safe comparison
 * - Expiration and usage limits
 * - Revocation and metadata
 *
 * @example
 * ```typescript
 * import { ApiKeyManager } from 'dotdo/lib/governance/api-keys'
 *
 * const keys = new ApiKeyManager(storage)
 *
 * // Create a key - plaintext returned only once
 * const { key, keyId } = await keys.create({
 *   prefix: 'sk_live_',
 *   expires: new Date('2025-01-01'),
 *   remaining: 1000,
 *   metadata: { userId: 'user_123' }
 * })
 *
 * // Verify a key
 * const result = await keys.verify(key)
 * if (result.valid) {
 *   console.log('Key is valid, metadata:', result.metadata)
 * }
 * ```
 *
 * @packageDocumentation
 */

import { createHash, timingSafeEqual, randomBytes } from 'crypto'

// =============================================================================
// Types
// =============================================================================

/**
 * Storage interface for API key persistence
 */
export interface ApiKeyStorage {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttl?: number): Promise<void>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<string[]>
}

/**
 * Options for creating an API key
 */
export interface CreateKeyOptions {
  /** Prefix for the key (e.g., 'sk_live_', 'pk_test_') */
  prefix?: string
  /** Expiration time */
  expires?: Date | number
  /** Number of uses remaining (undefined = unlimited) */
  remaining?: number
  /** Custom metadata to store with the key */
  metadata?: Record<string, unknown>
}

/**
 * Result of creating an API key
 */
export interface CreateKeyResult {
  /** The plaintext key (only returned once) */
  key: string
  /** The key ID for management operations */
  keyId: string
}

/**
 * Result of verifying an API key
 */
export interface VerifyResult {
  /** Whether the key is valid */
  valid: boolean
  /** Key ID (if valid) */
  keyId?: string
  /** Remaining uses (if limited) */
  remaining?: number
  /** Metadata stored with the key */
  metadata?: Record<string, unknown>
  /** Error code if invalid */
  code?: 'NOT_FOUND' | 'EXPIRED' | 'REVOKED' | 'LIMIT_EXCEEDED'
}

/**
 * Stored key data (internal)
 */
interface StoredKey {
  keyId: string
  hash: string
  prefix: string
  expires?: string
  remaining?: number
  metadata?: Record<string, unknown>
  revokedAt?: string
  createdAt: string
}

/**
 * Key info returned by get() (excludes sensitive data)
 */
export interface KeyInfo {
  keyId: string
  prefix: string
  expires?: Date
  remaining?: number
  metadata?: Record<string, unknown>
  revokedAt?: Date
  createdAt: Date
}

/**
 * Options for updating a key
 */
export interface UpdateKeyOptions {
  metadata?: Record<string, unknown>
  remaining?: number
  expires?: Date | number
}

/**
 * Options for listing keys
 */
export interface ListKeysOptions {
  metadata?: Record<string, unknown>
}

// =============================================================================
// Constants
// =============================================================================

const KEY_PREFIX = 'apikey:'
const INDEX_PREFIX = 'apikey:index:'
const DEFAULT_KEY_BYTES = 24 // 32 base64 characters

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a cryptographically random key
 */
function generateRandomKey(bytes: number = DEFAULT_KEY_BYTES): string {
  return randomBytes(bytes).toString('base64url')
}

/**
 * Generate a unique key ID
 */
function generateKeyId(): string {
  return `key_${randomBytes(12).toString('base64url')}`
}

/**
 * Hash a key using SHA-256
 */
function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * Timing-safe string comparison
 */
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Use a dummy comparison to maintain timing
    timingSafeEqual(Buffer.from(a), Buffer.from(a))
    return false
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

// =============================================================================
// ApiKeyManager Implementation
// =============================================================================

/**
 * API Key Manager
 *
 * Manages API keys with hashed storage following Unkey patterns.
 */
export class ApiKeyManager {
  constructor(private readonly storage: ApiKeyStorage) {}

  /**
   * Create a new API key
   *
   * @param options - Key creation options
   * @returns The plaintext key (shown once) and key ID
   */
  async create(options: CreateKeyOptions = {}): Promise<CreateKeyResult> {
    const { prefix = '', expires, remaining, metadata } = options

    // Generate random key and ID
    const randomPart = generateRandomKey()
    const key = prefix + randomPart
    const keyId = generateKeyId()

    // Hash the complete key (including prefix for security)
    const hash = hashKey(key)

    // Prepare stored data
    const storedKey: StoredKey = {
      keyId,
      hash,
      prefix,
      createdAt: new Date().toISOString(),
    }

    if (expires) {
      storedKey.expires =
        expires instanceof Date ? expires.toISOString() : new Date(expires).toISOString()
    }

    if (remaining !== undefined) {
      storedKey.remaining = remaining
    }

    if (metadata) {
      storedKey.metadata = metadata
    }

    // Store the key
    await this.storage.set(`${KEY_PREFIX}${keyId}`, storedKey)

    // Store hash -> keyId index for verification lookup
    await this.storage.set(`${INDEX_PREFIX}${hash}`, keyId)

    return { key, keyId }
  }

  /**
   * Verify an API key
   *
   * @param key - The plaintext key to verify
   * @returns Verification result with validity and metadata
   */
  async verify(key: string): Promise<VerifyResult> {
    // Hash the provided key
    const hash = hashKey(key)

    // Look up key ID by hash
    const keyId = await this.storage.get<string>(`${INDEX_PREFIX}${hash}`)

    if (!keyId) {
      // Perform dummy operations for timing safety
      timingSafeCompare(hash, hash)
      return { valid: false, code: 'NOT_FOUND' }
    }

    // Get stored key data
    const stored = await this.storage.get<StoredKey>(`${KEY_PREFIX}${keyId}`)

    if (!stored) {
      return { valid: false, code: 'NOT_FOUND' }
    }

    // Timing-safe hash comparison (defense in depth)
    if (!timingSafeCompare(stored.hash, hash)) {
      return { valid: false, code: 'NOT_FOUND' }
    }

    // Check revocation
    if (stored.revokedAt) {
      return { valid: false, code: 'REVOKED' }
    }

    // Check expiration
    if (stored.expires && new Date(stored.expires) <= new Date()) {
      return { valid: false, code: 'EXPIRED' }
    }

    // Check usage limit
    if (stored.remaining !== undefined && stored.remaining <= 0) {
      return { valid: false, code: 'LIMIT_EXCEEDED' }
    }

    // Decrement remaining if limited
    let newRemaining: number | undefined
    if (stored.remaining !== undefined) {
      newRemaining = stored.remaining - 1
      stored.remaining = newRemaining
      await this.storage.set(`${KEY_PREFIX}${keyId}`, stored)
    }

    return {
      valid: true,
      keyId,
      remaining: newRemaining,
      metadata: stored.metadata,
    }
  }

  /**
   * Revoke an API key
   *
   * @param keyId - The key ID to revoke
   * @returns true if revoked, false if key not found
   */
  async revoke(keyId: string): Promise<boolean> {
    const stored = await this.storage.get<StoredKey>(`${KEY_PREFIX}${keyId}`)

    if (!stored) {
      return false
    }

    stored.revokedAt = new Date().toISOString()
    await this.storage.set(`${KEY_PREFIX}${keyId}`, stored)

    return true
  }

  /**
   * Get key info (without sensitive data)
   *
   * @param keyId - The key ID
   * @returns Key info or null if not found
   */
  async get(keyId: string): Promise<KeyInfo | null> {
    const stored = await this.storage.get<StoredKey>(`${KEY_PREFIX}${keyId}`)

    if (!stored) {
      return null
    }

    return {
      keyId: stored.keyId,
      prefix: stored.prefix,
      expires: stored.expires ? new Date(stored.expires) : undefined,
      remaining: stored.remaining,
      metadata: stored.metadata,
      revokedAt: stored.revokedAt ? new Date(stored.revokedAt) : undefined,
      createdAt: new Date(stored.createdAt),
    }
  }

  /**
   * Update key properties
   *
   * @param keyId - The key ID
   * @param updates - Properties to update
   */
  async update(keyId: string, updates: UpdateKeyOptions): Promise<void> {
    const stored = await this.storage.get<StoredKey>(`${KEY_PREFIX}${keyId}`)

    if (!stored) {
      throw new Error(`Key not found: ${keyId}`)
    }

    if (updates.metadata !== undefined) {
      stored.metadata = updates.metadata
    }

    if (updates.remaining !== undefined) {
      stored.remaining = updates.remaining
    }

    if (updates.expires !== undefined) {
      stored.expires =
        updates.expires instanceof Date
          ? updates.expires.toISOString()
          : new Date(updates.expires).toISOString()
    }

    await this.storage.set(`${KEY_PREFIX}${keyId}`, stored)
  }

  /**
   * List all keys
   *
   * @param options - Filter options
   * @returns Array of key info objects
   */
  async list(options: ListKeysOptions = {}): Promise<KeyInfo[]> {
    const keyIds = await this.storage.list(KEY_PREFIX)
    const keys: KeyInfo[] = []

    for (const storageKey of keyIds) {
      // Skip index entries
      if (storageKey.startsWith(INDEX_PREFIX)) {
        continue
      }

      const keyId = storageKey.replace(KEY_PREFIX, '')
      const info = await this.get(keyId)

      if (info) {
        // Filter by metadata if specified
        if (options.metadata) {
          const matches = Object.entries(options.metadata).every(
            ([key, value]) => info.metadata?.[key] === value
          )
          if (!matches) continue
        }

        keys.push(info)
      }
    }

    return keys
  }
}
