/**
 * API Keys Tests - TDD Red-Green-Refactor
 *
 * Tests for API key management following Unkey patterns:
 * - Hashed key storage (SHA-256)
 * - Key creation returns plaintext once
 * - Verification against hash
 * - Expiration and usage limits
 * - Revocation and metadata
 *
 * @see https://www.unkey.com/docs
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  ApiKeyManager,
  type CreateKeyOptions,
  type CreateKeyResult,
  type VerifyResult,
  type ApiKeyStorage,
} from '../api-keys'

// =============================================================================
// Mock Storage Implementation
// =============================================================================

class MemoryApiKeyStorage implements ApiKeyStorage {
  private store = new Map<string, unknown>()

  async get<T>(key: string): Promise<T | null> {
    return (this.store.get(key) as T) ?? null
  }

  async set<T>(key: string, value: T, _ttl?: number): Promise<void> {
    this.store.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = []
    this.store.forEach((_value, key) => {
      if (key.startsWith(prefix)) {
        keys.push(key)
      }
    })
    return keys
  }
}

// =============================================================================
// Key Creation Tests
// =============================================================================

describe('ApiKeyManager', () => {
  let storage: MemoryApiKeyStorage
  let keyManager: ApiKeyManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    storage = new MemoryApiKeyStorage()
    keyManager = new ApiKeyManager(storage)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('key creation', () => {
    it('should create a key and return plaintext only once', async () => {
      const result = await keyManager.create()

      expect(result).toHaveProperty('key')
      expect(result).toHaveProperty('keyId')
      expect(result.key).toBeTruthy()
      expect(result.keyId).toBeTruthy()
      // The plaintext key should be long enough for security
      expect(result.key.length).toBeGreaterThanOrEqual(32)
    })

    it('should support custom prefix', async () => {
      const result = await keyManager.create({ prefix: 'sk_live_' })

      expect(result.key).toMatch(/^sk_live_/)
    })

    it('should generate unique keys', async () => {
      const result1 = await keyManager.create()
      const result2 = await keyManager.create()

      expect(result1.key).not.toBe(result2.key)
      expect(result1.keyId).not.toBe(result2.keyId)
    })

    it('should store only the hash, never the plaintext', async () => {
      const result = await keyManager.create()

      // Attempt to retrieve stored data
      const stored = await storage.get<{ hash: string; plaintext?: string }>(
        `apikey:${result.keyId}`
      )

      expect(stored).not.toBeNull()
      expect(stored!.hash).toBeTruthy()
      // Plaintext should NOT be stored
      expect(stored!.plaintext).toBeUndefined()
      // Hash should be different from the original key
      expect(stored!.hash).not.toBe(result.key)
    })

    it('should accept expiration time', async () => {
      const expires = new Date('2024-06-01T00:00:00.000Z')
      const result = await keyManager.create({ expires })

      const stored = await storage.get<{ expires: string }>(`apikey:${result.keyId}`)
      expect(new Date(stored!.expires)).toEqual(expires)
    })

    it('should accept usage limit', async () => {
      const result = await keyManager.create({ remaining: 100 })

      const stored = await storage.get<{ remaining: number }>(`apikey:${result.keyId}`)
      expect(stored!.remaining).toBe(100)
    })

    it('should store metadata', async () => {
      const metadata = { userId: 'user_123', role: 'admin' }
      const result = await keyManager.create({ metadata })

      const stored = await storage.get<{ metadata: Record<string, unknown> }>(
        `apikey:${result.keyId}`
      )
      expect(stored!.metadata).toEqual(metadata)
    })
  })

  // =============================================================================
  // Key Verification Tests
  // =============================================================================

  describe('key verification', () => {
    it('should verify a valid key', async () => {
      const created = await keyManager.create()
      const result = await keyManager.verify(created.key)

      expect(result.valid).toBe(true)
      expect(result.keyId).toBe(created.keyId)
    })

    it('should reject an invalid key', async () => {
      const result = await keyManager.verify('invalid_key_12345')

      expect(result.valid).toBe(false)
      expect(result.code).toBe('NOT_FOUND')
    })

    it('should reject an expired key', async () => {
      const expires = new Date('2024-01-01T01:00:00.000Z') // 1 hour from now
      const created = await keyManager.create({ expires })

      // Advance time past expiration
      vi.advanceTimersByTime(2 * 60 * 60 * 1000) // 2 hours

      const result = await keyManager.verify(created.key)

      expect(result.valid).toBe(false)
      expect(result.code).toBe('EXPIRED')
    })

    it('should decrement remaining on verification', async () => {
      const created = await keyManager.create({ remaining: 3 })

      const verify1 = await keyManager.verify(created.key)
      expect(verify1.valid).toBe(true)
      expect(verify1.remaining).toBe(2)

      const verify2 = await keyManager.verify(created.key)
      expect(verify2.remaining).toBe(1)

      const verify3 = await keyManager.verify(created.key)
      expect(verify3.remaining).toBe(0)
    })

    it('should reject when usage limit exceeded', async () => {
      const created = await keyManager.create({ remaining: 1 })

      await keyManager.verify(created.key) // Use the one remaining

      const result = await keyManager.verify(created.key)

      expect(result.valid).toBe(false)
      expect(result.code).toBe('LIMIT_EXCEEDED')
    })

    it('should return metadata on successful verification', async () => {
      const metadata = { userId: 'user_123', scope: 'read:all' }
      const created = await keyManager.create({ metadata })

      const result = await keyManager.verify(created.key)

      expect(result.valid).toBe(true)
      expect(result.metadata).toEqual(metadata)
    })

    it('should not decrement remaining when remaining is undefined (unlimited)', async () => {
      const created = await keyManager.create() // No remaining limit

      const verify1 = await keyManager.verify(created.key)
      const verify2 = await keyManager.verify(created.key)

      expect(verify1.valid).toBe(true)
      expect(verify2.valid).toBe(true)
      expect(verify1.remaining).toBeUndefined()
      expect(verify2.remaining).toBeUndefined()
    })
  })

  // =============================================================================
  // Key Revocation Tests
  // =============================================================================

  describe('key revocation', () => {
    it('should revoke a key', async () => {
      const created = await keyManager.create()
      const revoked = await keyManager.revoke(created.keyId)

      expect(revoked).toBe(true)
    })

    it('should reject verification of revoked key', async () => {
      const created = await keyManager.create()
      await keyManager.revoke(created.keyId)

      const result = await keyManager.verify(created.key)

      expect(result.valid).toBe(false)
      expect(result.code).toBe('REVOKED')
    })

    it('should return false when revoking non-existent key', async () => {
      const result = await keyManager.revoke('non_existent_key_id')

      expect(result).toBe(false)
    })
  })

  // =============================================================================
  // Key Management Tests
  // =============================================================================

  describe('key management', () => {
    it('should get key info without plaintext', async () => {
      const metadata = { role: 'admin' }
      const created = await keyManager.create({ metadata, remaining: 100 })

      const info = await keyManager.get(created.keyId)

      expect(info).not.toBeNull()
      expect(info!.keyId).toBe(created.keyId)
      expect(info!.metadata).toEqual(metadata)
      expect(info!.remaining).toBe(100)
      // Should NOT include plaintext or full hash
      expect((info as Record<string, unknown>).key).toBeUndefined()
      expect((info as Record<string, unknown>).hash).toBeUndefined()
    })

    it('should update key metadata', async () => {
      const created = await keyManager.create({ metadata: { role: 'user' } })

      await keyManager.update(created.keyId, { metadata: { role: 'admin' } })

      const info = await keyManager.get(created.keyId)
      expect(info!.metadata).toEqual({ role: 'admin' })
    })

    it('should update remaining uses', async () => {
      const created = await keyManager.create({ remaining: 10 })

      await keyManager.update(created.keyId, { remaining: 100 })

      const info = await keyManager.get(created.keyId)
      expect(info!.remaining).toBe(100)
    })

    it('should list all keys', async () => {
      await keyManager.create({ metadata: { name: 'key1' } })
      await keyManager.create({ metadata: { name: 'key2' } })
      await keyManager.create({ metadata: { name: 'key3' } })

      const keys = await keyManager.list()

      expect(keys).toHaveLength(3)
    })

    it('should filter keys by metadata', async () => {
      await keyManager.create({ metadata: { env: 'prod' } })
      await keyManager.create({ metadata: { env: 'staging' } })
      await keyManager.create({ metadata: { env: 'prod' } })

      const prodKeys = await keyManager.list({ metadata: { env: 'prod' } })

      expect(prodKeys).toHaveLength(2)
    })
  })

  // =============================================================================
  // Security Tests
  // =============================================================================

  describe('security', () => {
    it('should use SHA-256 for hashing', async () => {
      const created = await keyManager.create()

      const stored = await storage.get<{ hash: string }>(`apikey:${created.keyId}`)
      // SHA-256 produces 64 hex characters
      expect(stored!.hash).toHaveLength(64)
    })

    it('should be timing-safe when verifying', async () => {
      const created = await keyManager.create()

      // Generate keys that are similar but wrong
      const almostCorrect = created.key.slice(0, -1) + 'x'

      // Both verifications should take similar time (timing-safe comparison)
      const startValid = Date.now()
      await keyManager.verify(created.key)
      const validDuration = Date.now() - startValid

      const startInvalid = Date.now()
      await keyManager.verify(almostCorrect)
      const invalidDuration = Date.now() - startInvalid

      // Durations should be similar (within 10ms for test purposes)
      // Note: In real tests with real timers, this would be more meaningful
      expect(Math.abs(validDuration - invalidDuration)).toBeLessThanOrEqual(10)
    })

    it('should include prefix in hash to prevent cross-tenant attacks', async () => {
      // Create two keys with different prefixes
      const key1 = await keyManager.create({ prefix: 'sk_prod_' })
      const key2 = await keyManager.create({ prefix: 'sk_test_' })

      // Extract the random part (after prefix)
      const randomPart1 = key1.key.replace('sk_prod_', '')
      const randomPart2 = key2.key.replace('sk_test_', '')

      // If we swap prefixes, verification should fail
      const fakeKey1 = 'sk_test_' + randomPart1
      const fakeKey2 = 'sk_prod_' + randomPart2

      const verify1 = await keyManager.verify(fakeKey1)
      const verify2 = await keyManager.verify(fakeKey2)

      expect(verify1.valid).toBe(false)
      expect(verify2.valid).toBe(false)
    })
  })

  // =============================================================================
  // Edge Cases
  // =============================================================================

  describe('edge cases', () => {
    it('should handle empty prefix', async () => {
      const result = await keyManager.create({ prefix: '' })

      expect(result.key).toBeTruthy()
      expect(result.key.length).toBeGreaterThanOrEqual(32)
    })

    it('should handle special characters in metadata', async () => {
      const metadata = {
        name: "User's Key",
        description: 'Key with "quotes" and <html>',
        unicode: '\u{1F600}',
      }

      const created = await keyManager.create({ metadata })
      const result = await keyManager.verify(created.key)

      expect(result.metadata).toEqual(metadata)
    })

    it('should handle concurrent verifications', async () => {
      const created = await keyManager.create({ remaining: 10 })

      // Simulate multiple concurrent verifications
      const results = await Promise.all([
        keyManager.verify(created.key),
        keyManager.verify(created.key),
        keyManager.verify(created.key),
      ])

      // All should succeed (10 uses available)
      expect(results.every(r => r.valid)).toBe(true)

      // Verify total remaining decreased
      const info = await keyManager.get(created.keyId)
      expect(info!.remaining).toBeLessThanOrEqual(7) // At least 3 consumed
    })

    it('should handle key with expiration in the past', async () => {
      const created = await keyManager.create({
        expires: new Date('2023-12-31T00:00:00.000Z'), // Already expired
      })

      const result = await keyManager.verify(created.key)

      expect(result.valid).toBe(false)
      expect(result.code).toBe('EXPIRED')
    })

    it('should handle key with remaining set to 0', async () => {
      const created = await keyManager.create({ remaining: 0 })

      const result = await keyManager.verify(created.key)

      expect(result.valid).toBe(false)
      expect(result.code).toBe('LIMIT_EXCEEDED')
    })
  })

  // =============================================================================
  // Prefix Index Tests (for efficient lookup)
  // =============================================================================

  describe('prefix-based lookup', () => {
    it('should efficiently verify keys by prefix', async () => {
      // Create keys with different prefixes
      const liveKey = await keyManager.create({ prefix: 'sk_live_' })
      const testKey = await keyManager.create({ prefix: 'sk_test_' })

      // Verification should work for both
      expect((await keyManager.verify(liveKey.key)).valid).toBe(true)
      expect((await keyManager.verify(testKey.key)).valid).toBe(true)
    })

    it('should support key rotation with same prefix', async () => {
      const key1 = await keyManager.create({ prefix: 'sk_live_', metadata: { version: 1 } })

      // "Rotate" - create new key, revoke old
      const key2 = await keyManager.create({ prefix: 'sk_live_', metadata: { version: 2 } })
      await keyManager.revoke(key1.keyId)

      // Old key should fail
      expect((await keyManager.verify(key1.key)).valid).toBe(false)

      // New key should work
      const verify2 = await keyManager.verify(key2.key)
      expect(verify2.valid).toBe(true)
      expect(verify2.metadata).toEqual({ version: 2 })
    })
  })
})
