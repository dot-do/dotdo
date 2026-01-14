/**
 * SecretStore Tests
 *
 * TDD Red-Green-Refactor tests for the secret storage system.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  SecretStore,
  EncryptionLayer,
  VersionManager,
  RotationScheduler,
  AccessPolicyEngine,
  AuditLogger,
  CacheLayer,
} from './index'
import {
  SecretNotFoundError,
  SecretVersionNotFoundError,
  AccessDeniedError,
  SecretExpiredError,
  type AccessPolicy,
  type RotationPolicy,
  type AuditLog,
  type SecretMetadata,
  type SecretVersion,
} from './types'

describe('SecretStore', () => {
  let store: SecretStore

  beforeEach(() => {
    store = new SecretStore()
  })

  // ===========================================================================
  // Store and Retrieve Secrets
  // ===========================================================================

  describe('set and get', () => {
    it('should store and retrieve a secret', async () => {
      await store.set('api-key', 'sk_live_abc123')

      const secret = await store.get('api-key')
      expect(secret).toBe('sk_live_abc123')
    })

    it('should store multiple secrets independently', async () => {
      await store.set('api-key', 'key1')
      await store.set('database-password', 'pass123')

      expect(await store.get('api-key')).toBe('key1')
      expect(await store.get('database-password')).toBe('pass123')
    })

    it('should throw SecretNotFoundError for non-existent secret', async () => {
      await expect(store.get('non-existent')).rejects.toThrow(SecretNotFoundError)
    })

    it('should update secret when set is called again', async () => {
      await store.set('api-key', 'old-value')
      await store.set('api-key', 'new-value')

      expect(await store.get('api-key')).toBe('new-value')
    })

    it('should handle empty string values', async () => {
      await store.set('empty-secret', '')

      expect(await store.get('empty-secret')).toBe('')
    })

    it('should handle special characters in secret values', async () => {
      const specialValue = 'pa$$w0rd!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\'
      await store.set('special', specialValue)

      expect(await store.get('special')).toBe(specialValue)
    })

    it('should handle unicode in secret values', async () => {
      const unicodeValue = 'secret_\u4e2d\u6587_\u0410\u0411\u0412_\ud83d\udd10'
      await store.set('unicode', unicodeValue)

      expect(await store.get('unicode')).toBe(unicodeValue)
    })

    it('should store secret with tags', async () => {
      await store.set('api-key', 'value', { tags: ['production', 'api'] })

      const metadata = await store.getMetadata('api-key')
      expect(metadata.tags).toEqual(['production', 'api'])
    })
  })

  // ===========================================================================
  // Secret Versioning
  // ===========================================================================

  describe('versioning', () => {
    it('should start at version 1', async () => {
      await store.set('api-key', 'value')

      const metadata = await store.getMetadata('api-key')
      expect(metadata.version).toBe(1)
    })

    it('should increment version when secret is updated', async () => {
      await store.set('api-key', 'value1')
      await store.set('api-key', 'value2')

      const metadata = await store.getMetadata('api-key')
      expect(metadata.version).toBe(2)
    })

    it('should retrieve specific version', async () => {
      await store.set('api-key', 'version1')
      await store.set('api-key', 'version2')
      await store.set('api-key', 'version3')

      expect(await store.get('api-key', { version: 1 })).toBe('version1')
      expect(await store.get('api-key', { version: 2 })).toBe('version2')
      expect(await store.get('api-key', { version: 3 })).toBe('version3')
    })

    it('should throw SecretVersionNotFoundError for non-existent version', async () => {
      await store.set('api-key', 'value')

      await expect(store.get('api-key', { version: 99 })).rejects.toThrow(SecretVersionNotFoundError)
    })

    it('should get all versions of a secret', async () => {
      await store.set('api-key', 'v1')
      await store.set('api-key', 'v2')
      await store.set('api-key', 'v3')

      const versions = await store.getVersions('api-key')
      expect(versions).toHaveLength(3)
      expect(versions[0].version).toBe(1)
      expect(versions[1].version).toBe(2)
      expect(versions[2].version).toBe(3)
    })

    it('should throw SecretNotFoundError when getting versions of non-existent secret', async () => {
      await expect(store.getVersions('non-existent')).rejects.toThrow(SecretNotFoundError)
    })

    it('should mark old versions as deprecated after rotation', async () => {
      await store.set('api-key', 'v1')
      await store.rotate('api-key', 'v2')

      const versions = await store.getVersions('api-key')
      expect(versions[0].deprecated).toBe(true)
      expect(versions[1].deprecated).toBe(false)
    })
  })

  // ===========================================================================
  // Delete Secret
  // ===========================================================================

  describe('delete', () => {
    it('should delete a secret', async () => {
      await store.set('api-key', 'value')
      await store.delete('api-key')

      await expect(store.get('api-key')).rejects.toThrow(SecretNotFoundError)
    })

    it('should delete all versions of a secret', async () => {
      await store.set('api-key', 'v1')
      await store.set('api-key', 'v2')
      await store.delete('api-key')

      await expect(store.get('api-key', { version: 1 })).rejects.toThrow(SecretNotFoundError)
      await expect(store.get('api-key', { version: 2 })).rejects.toThrow(SecretNotFoundError)
    })

    it('should throw SecretNotFoundError when deleting non-existent secret', async () => {
      await expect(store.delete('non-existent')).rejects.toThrow(SecretNotFoundError)
    })

    it('should not affect other secrets when deleting one', async () => {
      await store.set('key1', 'value1')
      await store.set('key2', 'value2')
      await store.delete('key1')

      expect(await store.get('key2')).toBe('value2')
    })
  })

  // ===========================================================================
  // Automatic Encryption
  // ===========================================================================

  describe('encryption', () => {
    it('should encrypt secrets at rest', async () => {
      const storeWithEncryption = new SecretStore({
        encryption: { algorithm: 'AES-GCM-256', keyId: 'master-key', envelope: true },
      })

      await storeWithEncryption.set('api-key', 'sensitive-value')

      // Internal storage should be encrypted (not plaintext)
      const rawData = storeWithEncryption.getRawStorage()
      const storedValue = rawData.get('api-key')?.value
      expect(storedValue).not.toBe('sensitive-value')
    })

    it('should decrypt secrets when retrieved', async () => {
      const storeWithEncryption = new SecretStore({
        encryption: { algorithm: 'AES-GCM-256', keyId: 'master-key', envelope: true },
      })

      await storeWithEncryption.set('api-key', 'sensitive-value')
      const retrieved = await storeWithEncryption.get('api-key')

      expect(retrieved).toBe('sensitive-value')
    })

    it('should use envelope encryption when enabled', async () => {
      const storeWithEnvelope = new SecretStore({
        encryption: { algorithm: 'AES-GCM-256', keyId: 'master-key', envelope: true },
      })

      await storeWithEnvelope.set('api-key', 'value')

      const rawData = storeWithEnvelope.getRawStorage()
      const stored = rawData.get('api-key')
      expect(stored?.encryptedDataKey).toBeDefined()
    })

    it('should support different encryption algorithms', async () => {
      const chachaStore = new SecretStore({
        encryption: { algorithm: 'ChaCha20-Poly1305', keyId: 'key', envelope: false },
      })

      await chachaStore.set('secret', 'value')
      expect(await chachaStore.get('secret')).toBe('value')
    })
  })

  // ===========================================================================
  // Manual Rotation
  // ===========================================================================

  describe('manual rotation', () => {
    it('should rotate secret with new value', async () => {
      await store.set('api-key', 'old-value')
      await store.rotate('api-key', 'new-value')

      expect(await store.get('api-key')).toBe('new-value')
    })

    it('should increment version on rotation', async () => {
      await store.set('api-key', 'v1')
      await store.rotate('api-key', 'v2')

      const metadata = await store.getMetadata('api-key')
      expect(metadata.version).toBe(2)
    })

    it('should update rotatedAt timestamp', async () => {
      await store.set('api-key', 'v1')
      const beforeRotation = new Date()

      await store.rotate('api-key', 'v2')

      const metadata = await store.getMetadata('api-key')
      expect(metadata.rotatedAt).toBeDefined()
      expect(metadata.rotatedAt!.getTime()).toBeGreaterThanOrEqual(beforeRotation.getTime())
    })

    it('should throw SecretNotFoundError when rotating non-existent secret', async () => {
      await expect(store.rotate('non-existent', 'value')).rejects.toThrow(SecretNotFoundError)
    })

    it('should preserve tags after rotation', async () => {
      await store.set('api-key', 'v1', { tags: ['prod', 'api'] })
      await store.rotate('api-key', 'v2')

      const metadata = await store.getMetadata('api-key')
      expect(metadata.tags).toEqual(['prod', 'api'])
    })
  })

  // ===========================================================================
  // Scheduled Rotation
  // ===========================================================================

  describe('scheduled rotation', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should rotate automatically based on policy interval', async () => {
      const handler = vi.fn().mockResolvedValue(undefined)
      const policy: RotationPolicy = {
        interval: 60000, // 1 minute
        handler,
      }

      await store.set('api-key', 'initial')
      await store.setRotationPolicy('api-key', policy)

      // Fast forward past interval
      await vi.advanceTimersByTimeAsync(61000)

      expect(handler).toHaveBeenCalledWith('api-key', expect.any(String))
    })

    it('should call handler with new generated value', async () => {
      let capturedValue: string | undefined
      const handler = vi.fn().mockImplementation(async (name: string, value: string) => {
        capturedValue = value
      })

      await store.set('api-key', 'initial')
      await store.setRotationPolicy('api-key', {
        interval: 60000,
        handler,
        generateValue: () => 'generated-secret-123',
      })

      await vi.advanceTimersByTimeAsync(61000)

      expect(capturedValue).toBe('generated-secret-123')
    })

    it('should stop rotation when policy is removed', async () => {
      const handler = vi.fn().mockResolvedValue(undefined)
      await store.set('api-key', 'value')
      await store.setRotationPolicy('api-key', { interval: 60000, handler })

      await store.removeRotationPolicy('api-key')
      await vi.advanceTimersByTimeAsync(120000)

      expect(handler).not.toHaveBeenCalled()
    })

    it('should continue rotation after failure with retry', async () => {
      const handler = vi
        .fn()
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValue(undefined)

      await store.set('api-key', 'value')
      await store.setRotationPolicy('api-key', { interval: 60000, handler })

      await vi.advanceTimersByTimeAsync(61000) // First attempt fails
      await vi.advanceTimersByTimeAsync(5000) // Retry after 5 seconds

      expect(handler).toHaveBeenCalledTimes(2)
    })
  })

  // ===========================================================================
  // Access Policy Enforcement
  // ===========================================================================

  describe('access policy', () => {
    it('should allow access when policy permits', async () => {
      await store.set('api-key', 'value')
      await store.setPolicy('api-key', {
        principals: ['user:alice'],
        actions: ['read', 'write'],
        conditions: [],
      })

      const value = await store.get('api-key', { principal: 'user:alice' })
      expect(value).toBe('value')
    })

    it('should deny access when principal not in policy', async () => {
      await store.set('api-key', 'value')
      await store.setPolicy('api-key', {
        principals: ['user:alice'],
        actions: ['read'],
        conditions: [],
      })

      await expect(store.get('api-key', { principal: 'user:bob' })).rejects.toThrow(AccessDeniedError)
    })

    it('should deny access when action not permitted', async () => {
      await store.set('api-key', 'value')
      await store.setPolicy('api-key', {
        principals: ['user:alice'],
        actions: ['read'],
        conditions: [],
      })

      await expect(store.delete('api-key', { principal: 'user:alice' })).rejects.toThrow(AccessDeniedError)
    })

    it('should evaluate policy conditions', async () => {
      await store.set('api-key', 'value')
      await store.setPolicy('api-key', {
        principals: ['user:*'],
        actions: ['read'],
        conditions: [{ attribute: 'environment', operator: 'equals', value: 'production' }],
      })

      // Access with correct condition
      const value = await store.get('api-key', {
        principal: 'user:alice',
        attributes: { environment: 'production' },
      })
      expect(value).toBe('value')

      // Access with wrong condition
      await expect(
        store.get('api-key', {
          principal: 'user:alice',
          attributes: { environment: 'staging' },
        })
      ).rejects.toThrow(AccessDeniedError)
    })

    it('should support wildcard principals', async () => {
      await store.set('api-key', 'value')
      await store.setPolicy('api-key', {
        principals: ['service:*'],
        actions: ['read'],
        conditions: [],
      })

      expect(await store.get('api-key', { principal: 'service:backend' })).toBe('value')
      expect(await store.get('api-key', { principal: 'service:frontend' })).toBe('value')
      await expect(store.get('api-key', { principal: 'user:alice' })).rejects.toThrow(AccessDeniedError)
    })

    it('should allow all access when no policy is set', async () => {
      await store.set('api-key', 'value')

      // Should work without any principal context
      expect(await store.get('api-key')).toBe('value')
    })
  })

  // ===========================================================================
  // Audit Logging
  // ===========================================================================

  describe('audit logging', () => {
    let auditStore: SecretStore
    let logs: AuditLog[]

    beforeEach(() => {
      logs = []
      auditStore = new SecretStore({
        auditEnabled: true,
        onAuditLog: (log) => logs.push(log),
      })
    })

    it('should log secret creation', async () => {
      await auditStore.set('api-key', 'value', { principal: 'user:alice' })

      expect(logs).toHaveLength(1)
      expect(logs[0].action).toBe('create')
      expect(logs[0].secretName).toBe('api-key')
      expect(logs[0].principal).toBe('user:alice')
    })

    it('should log secret read', async () => {
      await auditStore.set('api-key', 'value')
      logs.length = 0 // Clear creation log

      await auditStore.get('api-key', { principal: 'user:bob' })

      expect(logs).toHaveLength(1)
      expect(logs[0].action).toBe('read')
      expect(logs[0].principal).toBe('user:bob')
    })

    it('should log secret update', async () => {
      await auditStore.set('api-key', 'v1')
      logs.length = 0

      await auditStore.set('api-key', 'v2', { principal: 'user:alice' })

      expect(logs).toHaveLength(1)
      expect(logs[0].action).toBe('write')
    })

    it('should log secret deletion', async () => {
      await auditStore.set('api-key', 'value')
      logs.length = 0

      await auditStore.delete('api-key', { principal: 'admin' })

      expect(logs).toHaveLength(1)
      expect(logs[0].action).toBe('delete')
    })

    it('should log secret rotation', async () => {
      await auditStore.set('api-key', 'v1')
      logs.length = 0

      await auditStore.rotate('api-key', 'v2', { principal: 'system' })

      expect(logs).toHaveLength(1)
      expect(logs[0].action).toBe('rotate')
    })

    it('should include timestamp in audit log', async () => {
      const before = new Date()
      await auditStore.set('api-key', 'value')
      const after = new Date()

      expect(logs[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(logs[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should log denied access attempts', async () => {
      await auditStore.set('api-key', 'value')
      await auditStore.setPolicy('api-key', {
        principals: ['user:alice'],
        actions: ['read'],
        conditions: [],
      })
      logs.length = 0

      try {
        await auditStore.get('api-key', { principal: 'user:bob' })
      } catch {
        // Expected
      }

      expect(logs).toHaveLength(1)
      expect(logs[0].metadata?.denied).toBe(true)
    })
  })

  // ===========================================================================
  // Secret Expiration
  // ===========================================================================

  describe('expiration', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should throw SecretExpiredError for expired secret', async () => {
      const expiresAt = new Date(Date.now() + 60000) // 1 minute from now
      await store.set('api-key', 'value', { expiresAt })

      // Fast forward past expiration
      await vi.advanceTimersByTimeAsync(61000)

      await expect(store.get('api-key')).rejects.toThrow(SecretExpiredError)
    })

    it('should allow access to non-expired secret', async () => {
      const expiresAt = new Date(Date.now() + 60000)
      await store.set('api-key', 'value', { expiresAt })

      // Before expiration
      expect(await store.get('api-key')).toBe('value')
    })

    it('should return expiration info in metadata', async () => {
      const expiresAt = new Date(Date.now() + 60000)
      await store.set('api-key', 'value', { expiresAt })

      const metadata = await store.getMetadata('api-key')
      expect(metadata.expiresAt).toEqual(expiresAt)
    })

    it('should allow secrets without expiration', async () => {
      await store.set('api-key', 'value') // No expiration

      await vi.advanceTimersByTimeAsync(365 * 24 * 60 * 60 * 1000) // 1 year

      expect(await store.get('api-key')).toBe('value')
    })

    it('should use default TTL when set', async () => {
      const storeWithTtl = new SecretStore({ defaultTtl: 3600000 }) // 1 hour
      await storeWithTtl.set('api-key', 'value')

      const metadata = await storeWithTtl.getMetadata('api-key')
      expect(metadata.expiresAt).toBeDefined()
      expect(metadata.expiresAt!.getTime() - Date.now()).toBeCloseTo(3600000, -3)
    })
  })

  // ===========================================================================
  // List and Search
  // ===========================================================================

  describe('list', () => {
    it('should list all secret names', async () => {
      await store.set('api-key', 'v1')
      await store.set('database-password', 'v2')
      await store.set('jwt-secret', 'v3')

      const names = await store.list()
      expect(names).toHaveLength(3)
      expect(names).toContain('api-key')
      expect(names).toContain('database-password')
      expect(names).toContain('jwt-secret')
    })

    it('should return empty array when no secrets', async () => {
      const names = await store.list()
      expect(names).toEqual([])
    })

    it('should filter by tag', async () => {
      await store.set('api-key', 'v1', { tags: ['production'] })
      await store.set('database-password', 'v2', { tags: ['production', 'database'] })
      await store.set('test-key', 'v3', { tags: ['staging'] })

      const prodSecrets = await store.list({ tag: 'production' })
      expect(prodSecrets).toHaveLength(2)
      expect(prodSecrets).toContain('api-key')
      expect(prodSecrets).toContain('database-password')
    })

    it('should filter by prefix', async () => {
      await store.set('api/v1/key', 'v1')
      await store.set('api/v2/key', 'v2')
      await store.set('database/password', 'v3')

      const apiSecrets = await store.list({ prefix: 'api/' })
      expect(apiSecrets).toHaveLength(2)
      expect(apiSecrets).toContain('api/v1/key')
      expect(apiSecrets).toContain('api/v2/key')
    })

    it('should not include deleted secrets in list', async () => {
      await store.set('key1', 'v1')
      await store.set('key2', 'v2')
      await store.delete('key1')

      const names = await store.list()
      expect(names).toEqual(['key2'])
    })
  })

  // ===========================================================================
  // Cache Behavior
  // ===========================================================================

  describe('caching', () => {
    it('should cache decrypted secrets', async () => {
      const cachedStore = new SecretStore({ cacheTtl: 60000 })
      await cachedStore.set('api-key', 'value')

      // First access
      const value1 = await cachedStore.get('api-key')
      // Second access should come from cache
      const value2 = await cachedStore.get('api-key')

      expect(value1).toBe('value')
      expect(value2).toBe('value')
      expect(cachedStore.getCacheStats().hits).toBe(1)
    })

    it('should bypass cache when option is set', async () => {
      const cachedStore = new SecretStore({ cacheTtl: 60000 })
      await cachedStore.set('api-key', 'value')

      await cachedStore.get('api-key') // Populate cache
      await cachedStore.get('api-key', { bypassCache: true })

      expect(cachedStore.getCacheStats().bypasses).toBe(1)
    })

    it('should invalidate cache on update', async () => {
      const cachedStore = new SecretStore({ cacheTtl: 60000 })
      await cachedStore.set('api-key', 'old-value')
      await cachedStore.get('api-key') // Populate cache

      await cachedStore.set('api-key', 'new-value')
      const value = await cachedStore.get('api-key')

      expect(value).toBe('new-value')
    })

    it('should expire cache entries based on TTL', async () => {
      vi.useFakeTimers()

      const cachedStore = new SecretStore({ cacheTtl: 10000 }) // 10 seconds
      await cachedStore.set('api-key', 'value')
      await cachedStore.get('api-key') // Populate cache

      await vi.advanceTimersByTimeAsync(11000)

      // This should miss cache
      await cachedStore.get('api-key')
      expect(cachedStore.getCacheStats().misses).toBe(2) // Initial + after expiry

      vi.useRealTimers()
    })

    it('should not cache when cacheTtl is 0', async () => {
      const noCacheStore = new SecretStore({ cacheTtl: 0 })
      await noCacheStore.set('api-key', 'value')

      await noCacheStore.get('api-key')
      await noCacheStore.get('api-key')

      expect(noCacheStore.getCacheStats().hits).toBe(0)
    })
  })

  // ===========================================================================
  // Version Rollback
  // ===========================================================================

  describe('version rollback', () => {
    it('should rollback to a previous version', async () => {
      await store.set('api-key', 'v1')
      await store.set('api-key', 'v2')
      await store.set('api-key', 'v3')

      await store.rollback('api-key', 1)

      expect(await store.get('api-key')).toBe('v1')
    })

    it('should create a new version on rollback', async () => {
      await store.set('api-key', 'v1')
      await store.set('api-key', 'v2')

      await store.rollback('api-key', 1)

      const metadata = await store.getMetadata('api-key')
      expect(metadata.version).toBe(3) // v1 -> v2 -> rollback to v1 creates v3
    })

    it('should throw SecretVersionNotFoundError for invalid rollback version', async () => {
      await store.set('api-key', 'v1')

      await expect(store.rollback('api-key', 99)).rejects.toThrow(SecretVersionNotFoundError)
    })

    it('should throw SecretNotFoundError when rolling back non-existent secret', async () => {
      await expect(store.rollback('non-existent', 1)).rejects.toThrow(SecretNotFoundError)
    })

    it('should preserve metadata on rollback', async () => {
      await store.set('api-key', 'v1', { tags: ['prod'] })
      await store.set('api-key', 'v2')

      await store.rollback('api-key', 1)

      const metadata = await store.getMetadata('api-key')
      expect(metadata.tags).toEqual(['prod'])
    })
  })
})

// =============================================================================
// Component Tests
// =============================================================================

describe('EncryptionLayer', () => {
  it('should encrypt and decrypt values', async () => {
    const layer = new EncryptionLayer({ algorithm: 'AES-GCM-256', keyId: 'test-key', envelope: false })

    const plaintext = 'sensitive-data'
    const encrypted = await layer.encrypt(plaintext)
    const decrypted = await layer.decrypt(encrypted)

    expect(encrypted).not.toBe(plaintext)
    expect(decrypted).toBe(plaintext)
  })

  it('should produce different ciphertext for same plaintext', async () => {
    const layer = new EncryptionLayer({ algorithm: 'AES-GCM-256', keyId: 'test-key', envelope: false })

    const plaintext = 'same-value'
    const encrypted1 = await layer.encrypt(plaintext)
    const encrypted2 = await layer.encrypt(plaintext)

    expect(encrypted1).not.toBe(encrypted2) // Different IVs
  })

  it('should use envelope encryption when enabled', async () => {
    const layer = new EncryptionLayer({ algorithm: 'AES-GCM-256', keyId: 'master-key', envelope: true })

    const result = await layer.encryptWithEnvelope('data')

    expect(result.encryptedData).toBeDefined()
    expect(result.encryptedDataKey).toBeDefined()
  })
})

describe('VersionManager', () => {
  it('should track versions', () => {
    const manager = new VersionManager()

    manager.addVersion('secret1', 'value1')
    manager.addVersion('secret1', 'value2')

    expect(manager.getCurrentVersion('secret1')).toBe(2)
    expect(manager.getVersion('secret1', 1)).toMatchObject({ version: 1, value: 'value1', deprecated: false })
  })

  it('should mark versions as deprecated', () => {
    const manager = new VersionManager()

    manager.addVersion('secret1', 'v1')
    manager.deprecateVersion('secret1', 1)

    expect(manager.getVersion('secret1', 1)?.deprecated).toBe(true)
  })
})

describe('AccessPolicyEngine', () => {
  let engine: AccessPolicyEngine

  beforeEach(() => {
    engine = new AccessPolicyEngine()
  })

  it('should evaluate simple policy', () => {
    const policy: AccessPolicy = {
      principals: ['user:alice'],
      actions: ['read'],
      conditions: [],
    }

    expect(engine.evaluate(policy, 'read', 'user:alice')).toBe(true)
    expect(engine.evaluate(policy, 'write', 'user:alice')).toBe(false)
    expect(engine.evaluate(policy, 'read', 'user:bob')).toBe(false)
  })

  it('should evaluate wildcard principals', () => {
    const policy: AccessPolicy = {
      principals: ['service:*'],
      actions: ['read'],
      conditions: [],
    }

    expect(engine.evaluate(policy, 'read', 'service:api')).toBe(true)
    expect(engine.evaluate(policy, 'read', 'user:alice')).toBe(false)
  })

  it('should evaluate conditions', () => {
    const policy: AccessPolicy = {
      principals: ['user:*'],
      actions: ['read'],
      conditions: [{ attribute: 'env', operator: 'equals', value: 'prod' }],
    }

    expect(engine.evaluate(policy, 'read', 'user:alice', { env: 'prod' })).toBe(true)
    expect(engine.evaluate(policy, 'read', 'user:alice', { env: 'dev' })).toBe(false)
  })
})

describe('AuditLogger', () => {
  it('should log entries', () => {
    const entries: AuditLog[] = []
    const logger = new AuditLogger((entry) => entries.push(entry))

    logger.log({ action: 'read', secretName: 'test', principal: 'user:alice' })

    expect(entries).toHaveLength(1)
    expect(entries[0].action).toBe('read')
    expect(entries[0].timestamp).toBeInstanceOf(Date)
  })
})

describe('CacheLayer', () => {
  it('should cache and retrieve values', () => {
    const cache = new CacheLayer(60000)

    cache.set('key1', 'value1')

    expect(cache.get('key1')).toBe('value1')
    expect(cache.getStats().hits).toBe(1)
  })

  it('should return undefined for missing keys', () => {
    const cache = new CacheLayer(60000)

    expect(cache.get('missing')).toBeUndefined()
    expect(cache.getStats().misses).toBe(1)
  })

  it('should invalidate entries', () => {
    const cache = new CacheLayer(60000)

    cache.set('key1', 'value1')
    cache.invalidate('key1')

    expect(cache.get('key1')).toBeUndefined()
  })

  it('should expire entries based on TTL', () => {
    vi.useFakeTimers()

    const cache = new CacheLayer(10000) // 10 seconds
    cache.set('key1', 'value1')

    vi.advanceTimersByTime(11000)

    expect(cache.get('key1')).toBeUndefined()

    vi.useRealTimers()
  })
})
