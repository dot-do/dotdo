/**
 * API Key Persistence Tests
 *
 * Tests for durable storage of API keys. Per TDD, these tests should FAIL
 * against the current in-memory implementation and PASS after implementing
 * durable storage.
 *
 * Issue: do-2l8u4.4
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryStorageAdapter, type StorageAdapter } from '@dotdo/db'
import {
  ApiKeyManager,
  DurableApiKeyManager,
  ApiKeyAuth,
  type ApiKey,
  type ApiKeyCreateOptions,
} from '../apikey'

describe('API Key Persistence', () => {
  let adapter: StorageAdapter

  beforeEach(() => {
    adapter = new MemoryStorageAdapter()
  })

  describe('DurableApiKeyManager (with StorageAdapter)', () => {
    let manager: DurableApiKeyManager

    beforeEach(() => {
      manager = new DurableApiKeyManager(adapter)
    })

    describe('Persistence across restarts', () => {
      it('should persist API keys across manager recreation', async () => {
        // Create a key with the first manager instance
        const { key, apiKey } = await manager.create({
          name: 'Persistent Key',
          scopes: ['users:read', 'posts:write'],
          metadata: { userId: '123' },
        })

        // Simulate DO restart by creating a new manager with the same adapter
        const manager2 = new DurableApiKeyManager(adapter)

        // The key should still be retrievable
        const retrieved = await manager2.get(apiKey.id)
        expect(retrieved).toBeDefined()
        expect(retrieved?.name).toBe('Persistent Key')
        expect(retrieved?.scopes).toEqual(['users:read', 'posts:write'])
        expect(retrieved?.metadata).toEqual({ userId: '123' })

        // The key should still be valid for authentication
        const validation = await manager2.validate(key)
        expect(validation.valid).toBe(true)
        expect(validation.apiKey?.id).toBe(apiKey.id)
      })

      it('should persist key revocation state across restarts', async () => {
        // Create and revoke a key
        const { key, apiKey } = await manager.create({ name: 'To Revoke' })
        await manager.revoke(apiKey.id)

        // Simulate DO restart
        const manager2 = new DurableApiKeyManager(adapter)

        // Key should still be revoked
        const validation = await manager2.validate(key)
        expect(validation.valid).toBe(false)
        expect(validation.error).toBe('API key revoked')

        // The key metadata should show revoked state
        const retrieved = await manager2.get(apiKey.id)
        expect(retrieved?.active).toBe(false)
        expect(retrieved?.revokedAt).toBeDefined()
      })

      it('should persist lastUsedAt timestamp across restarts', async () => {
        // Create and use a key
        const { key, apiKey } = await manager.create({ name: 'Usage Tracked' })
        await manager.validate(key)

        // Get the lastUsedAt timestamp
        const beforeRestart = await manager.get(apiKey.id)
        const lastUsed = beforeRestart?.lastUsedAt

        // Simulate DO restart
        const manager2 = new DurableApiKeyManager(adapter)

        // lastUsedAt should persist
        const afterRestart = await manager2.get(apiKey.id)
        expect(afterRestart?.lastUsedAt).toBeDefined()
        expect(afterRestart?.lastUsedAt?.getTime()).toBe(lastUsed?.getTime())
      })

      it('should persist expiration across restarts', async () => {
        const expiresAt = new Date(Date.now() + 86400000) // 24 hours
        const { key, apiKey } = await manager.create({
          name: 'Expiring Key',
          expiresAt,
        })

        // Simulate DO restart
        const manager2 = new DurableApiKeyManager(adapter)

        // Expiration should persist
        const retrieved = await manager2.get(apiKey.id)
        expect(retrieved?.expiresAt?.getTime()).toBe(expiresAt.getTime())
      })
    })

    describe('CRUD operations with persistence', () => {
      it('should create and persist a new API key', async () => {
        const { key, apiKey } = await manager.create({
          name: 'Test Key',
          prefix: 'test',
          scopes: ['*'],
          metadata: { env: 'test' },
        })

        // Verify key is stored
        expect(key).toMatch(/^test_[a-zA-Z0-9]{32}$/)
        expect(apiKey.id).toBeDefined()
        expect(apiKey.hashedKey).toBeDefined()

        // Verify in storage
        const manager2 = new DurableApiKeyManager(adapter)
        const retrieved = await manager2.get(apiKey.id)
        expect(retrieved).toBeDefined()
        expect(retrieved?.name).toBe('Test Key')
      })

      it('should list all persisted keys', async () => {
        await manager.create({ name: 'Key 1' })
        await manager.create({ name: 'Key 2' })
        await manager.create({ name: 'Key 3' })

        // Simulate restart
        const manager2 = new DurableApiKeyManager(adapter)
        const keys = await manager2.list()

        expect(keys.length).toBe(3)
        expect(keys.some(k => k.name === 'Key 1')).toBe(true)
        expect(keys.some(k => k.name === 'Key 2')).toBe(true)
        expect(keys.some(k => k.name === 'Key 3')).toBe(true)
      })

      it('should filter active/inactive keys after restart', async () => {
        const { apiKey: key1 } = await manager.create({ name: 'Active' })
        const { apiKey: key2 } = await manager.create({ name: 'Inactive' })
        await manager.revoke(key2.id)

        // Simulate restart
        const manager2 = new DurableApiKeyManager(adapter)
        const activeKeys = await manager2.list({ active: true })
        const inactiveKeys = await manager2.list({ active: false })

        expect(activeKeys.length).toBe(1)
        expect(activeKeys[0].name).toBe('Active')
        expect(inactiveKeys.length).toBe(1)
        expect(inactiveKeys[0].name).toBe('Inactive')
      })

      it('should update key metadata and persist', async () => {
        const { apiKey } = await manager.create({
          name: 'Original Name',
          metadata: { version: 1 },
        })

        // Update should persist
        await manager.update(apiKey.id, {
          name: 'Updated Name',
          metadata: { version: 2 },
        })

        // Verify after restart
        const manager2 = new DurableApiKeyManager(adapter)
        const retrieved = await manager2.get(apiKey.id)
        expect(retrieved?.name).toBe('Updated Name')
        expect(retrieved?.metadata).toEqual({ version: 2 })
      })

      it('should delete keys from persistent storage', async () => {
        const { apiKey } = await manager.create({ name: 'To Delete' })

        // Delete the key
        await manager.delete(apiKey.id)

        // Verify after restart
        const manager2 = new DurableApiKeyManager(adapter)
        const retrieved = await manager2.get(apiKey.id)
        expect(retrieved).toBeUndefined()

        const all = await manager2.list()
        expect(all.length).toBe(0)
      })
    })

    describe('Security: Key hashing', () => {
      it('should never store raw API keys in storage', async () => {
        const { key, apiKey } = await manager.create({ name: 'Secure Key' })

        // Check that the raw key is not in storage
        const storageAdapter = adapter as MemoryStorageAdapter
        const storedData = storageAdapter.toJSON()
        const storedValues = JSON.stringify(storedData)

        // The raw key (e.g., dotdo_abc123...) should NOT appear
        expect(storedValues).not.toContain(key)

        // But the hashed key should be stored
        expect(apiKey.hashedKey).toBeDefined()
        expect(storedValues).toContain(apiKey.hashedKey)
      })

      it('should validate keys via hash comparison only', async () => {
        const { key, apiKey } = await manager.create({ name: 'Hash Check' })

        // Simulate restart (no in-memory cache)
        const manager2 = new DurableApiKeyManager(adapter)

        // Should still validate via hash lookup
        const result = await manager2.validate(key)
        expect(result.valid).toBe(true)
        expect(result.apiKey?.id).toBe(apiKey.id)
      })

      it('should reject invalid keys even after restart', async () => {
        await manager.create({ name: 'Valid Key' })

        // Simulate restart
        const manager2 = new DurableApiKeyManager(adapter)

        // Invalid key should be rejected
        const result = await manager2.validate('dotdo_invalid123456789012345678901234')
        expect(result.valid).toBe(false)
        expect(result.error).toBe('Invalid API key')
      })
    })

    describe('Rate limiting persistence', () => {
      it('should persist rate limit configuration', async () => {
        const { apiKey } = await manager.create({
          name: 'Rate Limited',
          rateLimit: { maxRequests: 100, windowMs: 60000 },
        })

        // Simulate restart
        const manager2 = new DurableApiKeyManager(adapter)
        const retrieved = await manager2.get(apiKey.id)

        expect(retrieved?.rateLimit).toEqual({
          maxRequests: 100,
          windowMs: 60000,
        })
      })

      // Note: Rate limit counters (current request count) can reset on restart
      // This is acceptable behavior - we persist the config, not the window state
    })

    describe('Key rotation with persistence', () => {
      it('should persist rotated keys and revoke old ones', async () => {
        const { key: oldKey, apiKey: oldApiKey } = await manager.create({
          name: 'To Rotate',
          metadata: { project: 'test' },
        })

        // Rotate
        const { key: newKey, apiKey: newApiKey } = await manager.rotate(oldApiKey.id)

        // Simulate restart
        const manager2 = new DurableApiKeyManager(adapter)

        // Old key should be revoked
        const oldValidation = await manager2.validate(oldKey)
        expect(oldValidation.valid).toBe(false)

        // New key should work
        const newValidation = await manager2.validate(newKey)
        expect(newValidation.valid).toBe(true)

        // Metadata should be preserved
        const retrieved = await manager2.get(newApiKey.id)
        expect(retrieved?.metadata).toEqual({ project: 'test' })
      })
    })
  })

  describe('Migration: In-memory to Durable', () => {
    it('should migrate existing in-memory keys to durable storage', async () => {
      // Create keys with in-memory manager
      const inMemoryManager = new ApiKeyManager()
      const { key: key1, apiKey: apiKey1 } = await inMemoryManager.create({ name: 'Key 1' })
      const { key: key2, apiKey: apiKey2 } = await inMemoryManager.create({ name: 'Key 2' })

      // Get all keys for migration
      const allKeys = await inMemoryManager.list()

      // Create durable manager and migrate
      const durableManager = new DurableApiKeyManager(adapter)

      // Migration would need to import existing ApiKey records
      // This tests the importKey method which accepts an existing ApiKey
      for (const existingKey of allKeys) {
        await durableManager.importKey(existingKey)
      }

      // Verify keys are now in durable storage
      const manager2 = new DurableApiKeyManager(adapter)
      const durableKeys = await manager2.list()

      expect(durableKeys.length).toBe(2)
      expect(durableKeys.some(k => k.id === apiKey1.id)).toBe(true)
      expect(durableKeys.some(k => k.id === apiKey2.id)).toBe(true)

      // Note: We cannot validate the original keys because we don't have
      // the plaintext keys stored - this is by design for security.
      // The migration preserves the hashed keys, so existing validated
      // sessions would continue to work.
    })
  })
})

describe('Backward Compatibility: In-memory ApiKeyManager', () => {
  // These tests ensure the original in-memory manager still works
  // for use cases that don't need persistence

  let manager: ApiKeyManager

  beforeEach(() => {
    manager = new ApiKeyManager()
  })

  it('should still work without storage adapter (in-memory)', async () => {
    const { key, apiKey } = await manager.create({ name: 'In-Memory Key' })

    const result = await manager.validate(key)
    expect(result.valid).toBe(true)
    expect(result.apiKey?.id).toBe(apiKey.id)
  })

  it('should maintain existing API compatibility', async () => {
    // These tests mirror existing apikey.test.ts tests
    // to ensure no breaking changes

    const result = await manager.create({
      name: 'Test Key',
      scopes: ['users:read'],
      metadata: { userId: '123' },
    })

    expect(result.key).toBeDefined()
    expect(result.apiKey.id).toBeDefined()
    expect(result.apiKey.name).toBe('Test Key')
    expect(result.apiKey.scopes).toEqual(['users:read'])
    expect(result.apiKey.metadata).toEqual({ userId: '123' })
  })
})
