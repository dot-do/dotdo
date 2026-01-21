import { describe, it, expect, beforeEach } from 'vitest'
import {
  ApiKeyManager,
  ApiKeyAuth,
  type ApiKey,
  type ApiKeyStore,
  type ApiKeyCreateOptions,
  type ApiKeyValidationResult
} from '../apikey'

describe('ApiKeyManager', () => {
  let manager: ApiKeyManager

  beforeEach(() => {
    manager = new ApiKeyManager()
  })

  describe('Key Generation', () => {
    it('should generate a new API key with default options', async () => {
      const result = await manager.create({
        name: 'Test Key'
      })

      expect(result.key).toBeDefined()
      expect(result.key).toMatch(/^dotdo_[a-zA-Z0-9]{32}$/)
      expect(result.apiKey.id).toBeDefined()
      expect(result.apiKey.name).toBe('Test Key')
      expect(result.apiKey.hashedKey).toBeDefined()
      expect(result.apiKey.prefix).toBe(result.key.slice(0, 12))
      expect(result.apiKey.scopes).toEqual(['*'])
      expect(result.apiKey.active).toBe(true)
      expect(result.apiKey.createdAt).toBeInstanceOf(Date)
      expect(result.apiKey.expiresAt).toBeUndefined()
    })

    it('should generate a key with custom prefix', async () => {
      const result = await manager.create({
        name: 'Custom Key',
        prefix: 'custom'
      })

      expect(result.key).toMatch(/^custom_[a-zA-Z0-9]{32}$/)
      expect(result.apiKey.prefix).toBe(result.key.slice(0, 12))
    })

    it('should generate a key with expiration', async () => {
      const expiresAt = new Date(Date.now() + 86400000) // 24 hours
      const result = await manager.create({
        name: 'Expiring Key',
        expiresAt
      })

      expect(result.apiKey.expiresAt).toBeDefined()
      expect(result.apiKey.expiresAt?.getTime()).toBe(expiresAt.getTime())
    })

    it('should generate a key with specific scopes', async () => {
      const result = await manager.create({
        name: 'Scoped Key',
        scopes: ['users:read', 'users:write']
      })

      expect(result.apiKey.scopes).toEqual(['users:read', 'users:write'])
    })

    it('should generate a key with metadata', async () => {
      const result = await manager.create({
        name: 'Meta Key',
        metadata: {
          userId: '123',
          department: 'engineering'
        }
      })

      expect(result.apiKey.metadata).toEqual({
        userId: '123',
        department: 'engineering'
      })
    })

    it('should generate a key with rate limit', async () => {
      const result = await manager.create({
        name: 'Limited Key',
        rateLimit: {
          maxRequests: 100,
          windowMs: 60000
        }
      })

      expect(result.apiKey.rateLimit).toEqual({
        maxRequests: 100,
        windowMs: 60000
      })
    })
  })

  describe('Key Validation', () => {
    it('should validate a valid API key', async () => {
      const { key } = await manager.create({ name: 'Valid Key' })
      const result = await manager.validate(key)

      expect(result.valid).toBe(true)
      expect(result.apiKey).toBeDefined()
      expect(result.apiKey?.name).toBe('Valid Key')
      expect(result.error).toBeUndefined()
    })

    it('should reject an invalid API key', async () => {
      const result = await manager.validate('dotdo_invalid_key_12345678901234567890')

      expect(result.valid).toBe(false)
      expect(result.apiKey).toBeUndefined()
      expect(result.error).toBe('Invalid API key')
    })

    it('should reject an expired API key', async () => {
      const expiresAt = new Date(Date.now() - 1000) // Expired 1 second ago
      const { key } = await manager.create({
        name: 'Expired Key',
        expiresAt
      })

      const result = await manager.validate(key)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('API key expired')
    })

    it('should reject an inactive API key', async () => {
      const { key, apiKey } = await manager.create({ name: 'Inactive Key' })
      await manager.revoke(apiKey.id)

      const result = await manager.validate(key)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('API key revoked')
    })

    it('should reject malformed API key', async () => {
      const result = await manager.validate('not-a-valid-format')

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid API key format')
    })
  })

  describe('Key Lookup', () => {
    it('should retrieve a key by ID', async () => {
      const { apiKey } = await manager.create({ name: 'Lookup Key' })
      const found = await manager.get(apiKey.id)

      expect(found).toBeDefined()
      expect(found?.id).toBe(apiKey.id)
      expect(found?.name).toBe('Lookup Key')
    })

    it('should list all keys', async () => {
      await manager.create({ name: 'Key 1' })
      await manager.create({ name: 'Key 2' })
      await manager.create({ name: 'Key 3' })

      const keys = await manager.list()

      expect(keys.length).toBeGreaterThanOrEqual(3)
      expect(keys.some(k => k.name === 'Key 1')).toBe(true)
      expect(keys.some(k => k.name === 'Key 2')).toBe(true)
      expect(keys.some(k => k.name === 'Key 3')).toBe(true)
    })

    it('should list only active keys when filtered', async () => {
      const { apiKey: key1 } = await manager.create({ name: 'Active Key' })
      const { apiKey: key2 } = await manager.create({ name: 'Inactive Key' })
      await manager.revoke(key2.id)

      const keys = await manager.list({ active: true })

      expect(keys.some(k => k.id === key1.id)).toBe(true)
      expect(keys.some(k => k.id === key2.id)).toBe(false)
    })
  })

  describe('Key Revocation', () => {
    it('should revoke a key', async () => {
      const { apiKey, key } = await manager.create({ name: 'To Revoke' })

      await manager.revoke(apiKey.id)

      const result = await manager.validate(key)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('API key revoked')
    })

    it('should update revokedAt timestamp on revocation', async () => {
      const { apiKey } = await manager.create({ name: 'To Revoke' })

      await manager.revoke(apiKey.id)

      const revoked = await manager.get(apiKey.id)
      expect(revoked?.active).toBe(false)
      expect(revoked?.revokedAt).toBeInstanceOf(Date)
    })
  })

  describe('Key Rotation', () => {
    it('should rotate a key', async () => {
      const { apiKey: oldKey, key: oldKeyStr } = await manager.create({ name: 'To Rotate' })

      const { key: newKeyStr, apiKey: newKey } = await manager.rotate(oldKey.id)

      expect(newKeyStr).toBeDefined()
      expect(newKeyStr).not.toBe(oldKeyStr)
      expect(newKey.id).not.toBe(oldKey.id)
      expect(newKey.name).toBe(oldKey.name)
      expect(newKey.scopes).toEqual(oldKey.scopes)
      expect(newKey.metadata).toEqual(oldKey.metadata)

      // Old key should be revoked
      const oldValidation = await manager.validate(oldKeyStr)
      expect(oldValidation.valid).toBe(false)

      // New key should be valid
      const newValidation = await manager.validate(newKeyStr)
      expect(newValidation.valid).toBe(true)
    })

    it('should preserve metadata during rotation', async () => {
      const { apiKey: oldKey } = await manager.create({
        name: 'Meta Rotate',
        scopes: ['users:read'],
        metadata: { userId: '123' }
      })

      const { apiKey: newKey } = await manager.rotate(oldKey.id)

      expect(newKey.scopes).toEqual(['users:read'])
      expect(newKey.metadata).toEqual({ userId: '123' })
    })
  })

  describe('Scope Checking', () => {
    it('should validate exact scope match', async () => {
      const { key } = await manager.create({
        name: 'Scoped Key',
        scopes: ['users:read', 'posts:write']
      })

      const result = await manager.validate(key)
      const hasScope = ApiKeyAuth.hasScope(result.apiKey!, 'users:read')

      expect(hasScope).toBe(true)
    })

    it('should validate wildcard scope', async () => {
      const { key } = await manager.create({
        name: 'Wildcard Key',
        scopes: ['users:*']
      })

      const result = await manager.validate(key)
      const hasRead = ApiKeyAuth.hasScope(result.apiKey!, 'users:read')
      const hasWrite = ApiKeyAuth.hasScope(result.apiKey!, 'users:write')

      expect(hasRead).toBe(true)
      expect(hasWrite).toBe(true)
    })

    it('should validate global wildcard scope', async () => {
      const { key } = await manager.create({
        name: 'Global Key',
        scopes: ['*']
      })

      const result = await manager.validate(key)
      const hasAny = ApiKeyAuth.hasScope(result.apiKey!, 'anything:anywhere')

      expect(hasAny).toBe(true)
    })

    it('should reject scope mismatch', async () => {
      const { key } = await manager.create({
        name: 'Limited Key',
        scopes: ['users:read']
      })

      const result = await manager.validate(key)
      const hasWrite = ApiKeyAuth.hasScope(result.apiKey!, 'users:write')

      expect(hasWrite).toBe(false)
    })
  })

  describe('Rate Limiting', () => {
    it('should track request count', async () => {
      const { key } = await manager.create({
        name: 'Rate Limited',
        rateLimit: {
          maxRequests: 5,
          windowMs: 60000
        }
      })

      const result = await manager.validate(key)
      const apiKey = result.apiKey!

      // Make requests
      for (let i = 0; i < 5; i++) {
        const allowed = await manager.checkRateLimit(apiKey.id)
        expect(allowed).toBe(true)
      }

      // 6th request should be blocked
      const blocked = await manager.checkRateLimit(apiKey.id)
      expect(blocked).toBe(false)
    })

    it('should reset after window expires', async () => {
      const { key } = await manager.create({
        name: 'Short Window',
        rateLimit: {
          maxRequests: 2,
          windowMs: 100 // 100ms window
        }
      })

      const result = await manager.validate(key)
      const apiKey = result.apiKey!

      // Use up the limit
      await manager.checkRateLimit(apiKey.id)
      await manager.checkRateLimit(apiKey.id)

      const blocked = await manager.checkRateLimit(apiKey.id)
      expect(blocked).toBe(false)

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150))

      // Should be allowed again
      const allowed = await manager.checkRateLimit(apiKey.id)
      expect(allowed).toBe(true)
    })

    it('should allow unlimited requests when no rate limit set', async () => {
      const { key } = await manager.create({ name: 'Unlimited' })
      const result = await manager.validate(key)
      const apiKey = result.apiKey!

      // Should always return true
      for (let i = 0; i < 100; i++) {
        const allowed = await manager.checkRateLimit(apiKey.id)
        expect(allowed).toBe(true)
      }
    })
  })

  describe('Usage Tracking', () => {
    it('should track last used timestamp', async () => {
      const { key, apiKey } = await manager.create({ name: 'Tracked Key' })

      expect(apiKey.lastUsedAt).toBeUndefined()

      await manager.validate(key)

      const updated = await manager.get(apiKey.id)
      expect(updated?.lastUsedAt).toBeInstanceOf(Date)
    })

    it('should update last used on each validation', async () => {
      const { key, apiKey } = await manager.create({ name: 'Usage Key' })

      await manager.validate(key)
      const firstUse = await manager.get(apiKey.id)
      const firstTime = firstUse!.lastUsedAt!

      await new Promise(resolve => setTimeout(resolve, 10))

      await manager.validate(key)
      const secondUse = await manager.get(apiKey.id)
      const secondTime = secondUse!.lastUsedAt!

      expect(secondTime.getTime()).toBeGreaterThan(firstTime.getTime())
    })
  })
})

describe('ApiKeyManager with Persistence', () => {
  /**
   * Creates a mock store that simulates ThingsStore behavior.
   * Uses an in-memory Map for storage.
   */
  function createMockStore(): ApiKeyStore & { _data: Map<string, Record<string, unknown>> } {
    const data = new Map<string, Record<string, unknown>>()
    let idCounter = 0

    return {
      _data: data,
      async create<D extends { $type: string }>(item: D) {
        const now = Date.now()
        const id = `thing_${++idCounter}`
        const stored = {
          ...item,
          $id: id,
          $createdAt: now,
          $updatedAt: now
        }
        data.set(id, stored)
        return stored
      },
      async get(id: string) {
        const item = data.get(id)
        return item ? item as { $id: string; $type: string; $createdAt: number; $updatedAt: number; [key: string]: unknown } : null
      },
      async update(id: string, updates: Record<string, unknown>) {
        const existing = data.get(id)
        if (!existing) throw new Error(`Not found: ${id}`)
        const updated = { ...existing, ...updates, $updatedAt: Date.now() }
        data.set(id, updated)
        return updated as { $id: string; $type: string; [key: string]: unknown }
      },
      async list(options?: { type?: string }) {
        const items = Array.from(data.values())
        if (options?.type) {
          return items.filter(i => i.$type === options.type) as Array<{ $id: string; $type: string; [key: string]: unknown }>
        }
        return items as Array<{ $id: string; $type: string; [key: string]: unknown }>
      }
    }
  }

  it('should persist API keys to the store', async () => {
    const store = createMockStore()
    const manager = new ApiKeyManager({ store })

    const { apiKey } = await manager.create({
      name: 'Persisted Key',
      scopes: ['read', 'write'],
      metadata: { userId: '123' }
    })

    // Check that the key was persisted
    const storedItems = await store.list({ type: ApiKeyManager.API_KEY_TYPE })
    expect(storedItems.length).toBe(1)
    expect(storedItems[0].name).toBe('Persisted Key')
    expect(storedItems[0].keyId).toBe(apiKey.id)
    expect(storedItems[0].scopes).toBe(JSON.stringify(['read', 'write']))
    expect(storedItems[0].metadata).toBe(JSON.stringify({ userId: '123' }))
  })

  it('should load existing API keys from store on initialization', async () => {
    const store = createMockStore()

    // First manager creates a key
    const manager1 = new ApiKeyManager({ store })
    const { key, apiKey } = await manager1.create({ name: 'Original Key' })

    // Second manager should load the key from store
    const manager2 = new ApiKeyManager({ store })

    // Wait for async initialization
    const result = await manager2.validate(key)

    expect(result.valid).toBe(true)
    expect(result.apiKey?.name).toBe('Original Key')
    expect(result.apiKey?.id).toBe(apiKey.id)
  })

  it('should persist revocation to the store', async () => {
    const store = createMockStore()
    const manager = new ApiKeyManager({ store })

    const { apiKey } = await manager.create({ name: 'To Revoke' })
    await manager.revoke(apiKey.id)

    // Check the stored item
    const storedItems = await store.list({ type: ApiKeyManager.API_KEY_TYPE })
    expect(storedItems[0].active).toBe(false)
    expect(storedItems[0].revokedAt).toBeDefined()

    // New manager should load the revoked key
    const manager2 = new ApiKeyManager({ store })
    const loaded = await manager2.get(apiKey.id)
    expect(loaded?.active).toBe(false)
    expect(loaded?.revokedAt).toBeInstanceOf(Date)
  })

  it('should persist lastUsedAt on validation', async () => {
    const store = createMockStore()
    const manager = new ApiKeyManager({ store })

    const { key } = await manager.create({ name: 'Usage Tracked' })
    await manager.validate(key)

    // Check the stored item has lastUsedAt
    const storedItems = await store.list({ type: ApiKeyManager.API_KEY_TYPE })
    expect(storedItems[0].lastUsedAt).toBeDefined()
    expect(typeof storedItems[0].lastUsedAt).toBe('number')
  })

  it('should correctly serialize and deserialize all fields', async () => {
    const store = createMockStore()
    const manager = new ApiKeyManager({ store })

    const expiresAt = new Date(Date.now() + 86400000)
    const { key, apiKey } = await manager.create({
      name: 'Full Key',
      scopes: ['users:read', 'posts:*'],
      expiresAt,
      metadata: { nested: { value: 123 } },
      rateLimit: { maxRequests: 100, windowMs: 60000 }
    })

    // Create a new manager to force loading from store
    const manager2 = new ApiKeyManager({ store })
    const result = await manager2.validate(key)

    expect(result.valid).toBe(true)
    expect(result.apiKey?.name).toBe('Full Key')
    expect(result.apiKey?.scopes).toEqual(['users:read', 'posts:*'])
    expect(result.apiKey?.expiresAt?.getTime()).toBe(expiresAt.getTime())
    expect(result.apiKey?.metadata).toEqual({ nested: { value: 123 } })
    expect(result.apiKey?.rateLimit).toEqual({ maxRequests: 100, windowMs: 60000 })
  })

  it('should work without a store (in-memory fallback)', async () => {
    const manager = new ApiKeyManager() // No store

    const { key, apiKey } = await manager.create({ name: 'Memory Key' })
    const result = await manager.validate(key)

    expect(result.valid).toBe(true)
    expect(result.apiKey?.id).toBe(apiKey.id)

    // Key is only in memory, won't survive a "restart"
  })
})

describe('ApiKeyAuth', () => {
  describe('Scope Matching', () => {
    it('should match exact scopes', () => {
      const key: ApiKey = {
        id: '1',
        name: 'test',
        hashedKey: 'hash',
        prefix: 'dotdo_',
        scopes: ['users:read', 'posts:write'],
        active: true,
        createdAt: new Date()
      }

      expect(ApiKeyAuth.hasScope(key, 'users:read')).toBe(true)
      expect(ApiKeyAuth.hasScope(key, 'posts:write')).toBe(true)
      expect(ApiKeyAuth.hasScope(key, 'users:write')).toBe(false)
    })

    it('should match resource wildcards', () => {
      const key: ApiKey = {
        id: '1',
        name: 'test',
        hashedKey: 'hash',
        prefix: 'dotdo_',
        scopes: ['users:*'],
        active: true,
        createdAt: new Date()
      }

      expect(ApiKeyAuth.hasScope(key, 'users:read')).toBe(true)
      expect(ApiKeyAuth.hasScope(key, 'users:write')).toBe(true)
      expect(ApiKeyAuth.hasScope(key, 'users:delete')).toBe(true)
      expect(ApiKeyAuth.hasScope(key, 'posts:read')).toBe(false)
    })

    it('should match global wildcards', () => {
      const key: ApiKey = {
        id: '1',
        name: 'test',
        hashedKey: 'hash',
        prefix: 'dotdo_',
        scopes: ['*'],
        active: true,
        createdAt: new Date()
      }

      expect(ApiKeyAuth.hasScope(key, 'users:read')).toBe(true)
      expect(ApiKeyAuth.hasScope(key, 'posts:write')).toBe(true)
      expect(ApiKeyAuth.hasScope(key, 'anything:anywhere')).toBe(true)
    })
  })

  describe('Key Hashing', () => {
    it('should hash keys consistently', async () => {
      const key = 'dotdo_test123'
      const hash1 = await ApiKeyAuth.hashKey(key)
      const hash2 = await ApiKeyAuth.hashKey(key)

      expect(hash1).toBe(hash2)
    })

    it('should produce different hashes for different keys', async () => {
      const key1 = 'dotdo_test123'
      const key2 = 'dotdo_test456'

      const hash1 = await ApiKeyAuth.hashKey(key1)
      const hash2 = await ApiKeyAuth.hashKey(key2)

      expect(hash1).not.toBe(hash2)
    })
  })

  describe('Key Generation', () => {
    it('should generate random keys', () => {
      const key1 = ApiKeyAuth.generateKey()
      const key2 = ApiKeyAuth.generateKey()

      expect(key1).not.toBe(key2)
      expect(key1).toMatch(/^dotdo_[a-zA-Z0-9]{32}$/)
      expect(key2).toMatch(/^dotdo_[a-zA-Z0-9]{32}$/)
    })

    it('should generate keys with custom prefix', () => {
      const key = ApiKeyAuth.generateKey('custom')

      expect(key).toMatch(/^custom_[a-zA-Z0-9]{32}$/)
    })
  })
})
