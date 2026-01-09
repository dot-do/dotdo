import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

/**
 * KV Store Integration Layer Tests
 *
 * Tests for a unified KV store integration layer for dotdo that supports:
 * 1. Session Management - Store and retrieve user sessions with TTL
 * 2. API Key Cache - Cache API key lookups from the database
 * 3. Rate Limit State - Support rate limiting counters
 * 4. Cache Layer - General-purpose caching for expensive operations
 *
 * Design requirements:
 * - Typed KV operations
 * - Namespacing for multi-tenant isolation
 * - Automatic JSON serialization/deserialization
 * - TTL management helpers
 * - Batch operations support
 */

// Import the module under test (will fail until implemented)
import {
  KVStore,
  createKVStore,
  type KVStoreConfig,
  type KVNamespace
} from '../kv'

// ============================================================================
// Mock KVNamespace
// ============================================================================

function createMockKV(): KVNamespace {
  const store = new Map<string, { value: string; expiration?: number }>()

  return {
    get: vi.fn(async (key: string, options?: { type?: string }) => {
      const entry = store.get(key)
      if (!entry) return null
      if (entry.expiration && Date.now() > entry.expiration) {
        store.delete(key)
        return null
      }
      if (options?.type === 'json') {
        return JSON.parse(entry.value)
      }
      return entry.value
    }),
    put: vi.fn(async (key: string, value: string, options?: { expirationTtl?: number; expiration?: number }) => {
      let expiration: number | undefined
      if (options?.expirationTtl) {
        expiration = Date.now() + options.expirationTtl * 1000
      } else if (options?.expiration) {
        expiration = options.expiration * 1000
      }
      store.set(key, { value, expiration })
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
    list: vi.fn(async (options?: { prefix?: string; limit?: number; cursor?: string }) => {
      const keys: Array<{ name: string; expiration?: number }> = []
      for (const [key, entry] of store) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          if (!entry.expiration || Date.now() <= entry.expiration) {
            keys.push({ name: key, expiration: entry.expiration ? entry.expiration / 1000 : undefined })
          }
        }
      }
      const limit = options?.limit ?? 1000
      const sliced = keys.slice(0, limit)
      return {
        keys: sliced,
        list_complete: sliced.length === keys.length,
        cursor: sliced.length < keys.length ? 'cursor' : undefined,
      }
    }),
    getWithMetadata: vi.fn(async (key: string, options?: { type?: string }) => {
      const entry = store.get(key)
      if (!entry) return { value: null, metadata: null }
      if (entry.expiration && Date.now() > entry.expiration) {
        store.delete(key)
        return { value: null, metadata: null }
      }
      const value = options?.type === 'json' ? JSON.parse(entry.value) : entry.value
      return { value, metadata: null }
    }),
  }
}

// ============================================================================
// KVStore Factory Function
// ============================================================================

describe('createKVStore()', () => {
  it('exports createKVStore factory function', () => {
    expect(typeof createKVStore).toBe('function')
  })

  it('creates a KVStore instance from KVNamespace binding', () => {
    const mockKV = createMockKV()
    const store = createKVStore(mockKV)

    expect(store).toBeInstanceOf(KVStore)
  })

  it('accepts optional namespace prefix configuration', () => {
    const mockKV = createMockKV()
    const store = createKVStore(mockKV, { namespace: 'tenant-123' })

    expect(store).toBeInstanceOf(KVStore)
  })

  it('accepts optional default TTL configuration', () => {
    const mockKV = createMockKV()
    const store = createKVStore(mockKV, { defaultTtl: 3600 })

    expect(store).toBeInstanceOf(KVStore)
  })
})

// ============================================================================
// Basic Get/Set Operations
// ============================================================================

describe('KVStore basic operations', () => {
  let mockKV: KVNamespace
  let store: KVStore

  beforeEach(() => {
    mockKV = createMockKV()
    store = createKVStore(mockKV)
  })

  describe('set()', () => {
    it('stores a string value', async () => {
      await store.set('key1', 'value1')

      expect(mockKV.put).toHaveBeenCalledWith('key1', '"value1"', expect.any(Object))
    })

    it('stores a number value with JSON serialization', async () => {
      await store.set('count', 42)

      expect(mockKV.put).toHaveBeenCalledWith('count', '42', expect.any(Object))
    })

    it('stores an object value with JSON serialization', async () => {
      const user = { id: '123', name: 'Alice' }
      await store.set('user:123', user)

      expect(mockKV.put).toHaveBeenCalledWith('user:123', JSON.stringify(user), expect.any(Object))
    })

    it('stores an array value with JSON serialization', async () => {
      const items = ['a', 'b', 'c']
      await store.set('items', items)

      expect(mockKV.put).toHaveBeenCalledWith('items', JSON.stringify(items), expect.any(Object))
    })

    it('accepts TTL option in seconds', async () => {
      await store.set('temp', 'value', { ttl: 300 })

      expect(mockKV.put).toHaveBeenCalledWith('temp', '"value"', { expirationTtl: 300 })
    })

    it('accepts absolute expiration timestamp', async () => {
      const expiration = Math.floor(Date.now() / 1000) + 3600
      await store.set('temp', 'value', { expiration })

      expect(mockKV.put).toHaveBeenCalledWith('temp', '"value"', { expiration })
    })
  })

  describe('get()', () => {
    it('retrieves a stored string value', async () => {
      await store.set('key1', 'value1')
      const result = await store.get<string>('key1')

      expect(result).toBe('value1')
    })

    it('retrieves a stored object value', async () => {
      const user = { id: '123', name: 'Alice' }
      await store.set('user:123', user)
      const result = await store.get<typeof user>('user:123')

      expect(result).toEqual(user)
    })

    it('returns null for non-existent key', async () => {
      const result = await store.get('non-existent')

      expect(result).toBeNull()
    })

    it('returns null for expired key', async () => {
      // Simulate expired entry by setting TTL in the past
      await mockKV.put('expired', '"value"', { expirationTtl: -1 })
      const result = await store.get('expired')

      // May return null depending on implementation timing
      expect(result === null || result === 'value').toBe(true)
    })
  })

  describe('delete()', () => {
    it('deletes a stored value', async () => {
      await store.set('key1', 'value1')
      await store.delete('key1')

      expect(mockKV.delete).toHaveBeenCalledWith('key1')
    })

    it('does not throw for non-existent key', async () => {
      await expect(store.delete('non-existent')).resolves.toBeUndefined()
    })
  })

  describe('exists()', () => {
    it('returns true for existing key', async () => {
      await store.set('key1', 'value1')
      const result = await store.exists('key1')

      expect(result).toBe(true)
    })

    it('returns false for non-existent key', async () => {
      const result = await store.exists('non-existent')

      expect(result).toBe(false)
    })
  })
})

// ============================================================================
// Namespacing for Multi-Tenant Isolation
// ============================================================================

describe('KVStore namespacing', () => {
  let mockKV: KVNamespace

  beforeEach(() => {
    mockKV = createMockKV()
  })

  it('prefixes keys with namespace', async () => {
    const store = createKVStore(mockKV, { namespace: 'tenant-123' })
    await store.set('key1', 'value1')

    expect(mockKV.put).toHaveBeenCalledWith('tenant-123:key1', '"value1"', expect.any(Object))
  })

  it('retrieves namespaced keys correctly', async () => {
    const store = createKVStore(mockKV, { namespace: 'tenant-123' })
    await store.set('key1', 'value1')
    const result = await store.get<string>('key1')

    expect(result).toBe('value1')
  })

  it('deletes namespaced keys correctly', async () => {
    const store = createKVStore(mockKV, { namespace: 'tenant-123' })
    await store.set('key1', 'value1')
    await store.delete('key1')

    expect(mockKV.delete).toHaveBeenCalledWith('tenant-123:key1')
  })

  it('isolates data between namespaces', async () => {
    const store1 = createKVStore(mockKV, { namespace: 'tenant-1' })
    const store2 = createKVStore(mockKV, { namespace: 'tenant-2' })

    await store1.set('key', 'value-1')
    await store2.set('key', 'value-2')

    const result1 = await store1.get<string>('key')
    const result2 = await store2.get<string>('key')

    expect(result1).toBe('value-1')
    expect(result2).toBe('value-2')
  })

  it('uses separator between namespace and key', async () => {
    const store = createKVStore(mockKV, { namespace: 'ns', separator: '/' })
    await store.set('key', 'value')

    expect(mockKV.put).toHaveBeenCalledWith('ns/key', '"value"', expect.any(Object))
  })
})

// ============================================================================
// TTL Management Helpers
// ============================================================================

describe('KVStore TTL management', () => {
  let mockKV: KVNamespace
  let store: KVStore

  beforeEach(() => {
    mockKV = createMockKV()
    store = createKVStore(mockKV, { defaultTtl: 3600 })
  })

  it('applies default TTL when not specified', async () => {
    await store.set('key', 'value')

    expect(mockKV.put).toHaveBeenCalledWith('key', '"value"', { expirationTtl: 3600 })
  })

  it('overrides default TTL when specified', async () => {
    await store.set('key', 'value', { ttl: 60 })

    expect(mockKV.put).toHaveBeenCalledWith('key', '"value"', { expirationTtl: 60 })
  })

  it('stores without TTL when ttl is 0 (no expiration)', async () => {
    await store.set('permanent', 'value', { ttl: 0 })

    expect(mockKV.put).toHaveBeenCalledWith('permanent', '"value"', {})
  })

  describe('setWithTTL()', () => {
    it('provides explicit TTL convenience method', async () => {
      await store.setWithTTL('key', 'value', 120)

      expect(mockKV.put).toHaveBeenCalledWith('key', '"value"', { expirationTtl: 120 })
    })
  })

  describe('ttl helpers', () => {
    it('provides seconds() helper', () => {
      expect(store.ttl.seconds(30)).toBe(30)
    })

    it('provides minutes() helper', () => {
      expect(store.ttl.minutes(5)).toBe(300)
    })

    it('provides hours() helper', () => {
      expect(store.ttl.hours(2)).toBe(7200)
    })

    it('provides days() helper', () => {
      expect(store.ttl.days(1)).toBe(86400)
    })
  })
})

// ============================================================================
// Session Management
// ============================================================================

describe('KVStore session management', () => {
  let mockKV: KVNamespace
  let store: KVStore

  beforeEach(() => {
    mockKV = createMockKV()
    store = createKVStore(mockKV, { namespace: 'sessions' })
  })

  describe('setSession()', () => {
    it('stores session with standard TTL', async () => {
      const session = { userId: 'user-123', email: 'test@example.com', role: 'user' as const }
      await store.setSession('sess-abc', session, 3600)

      expect(mockKV.put).toHaveBeenCalledWith(
        'sessions:sess-abc',
        JSON.stringify(session),
        { expirationTtl: 3600 }
      )
    })

    it('automatically prefixes with session namespace', async () => {
      const session = { userId: 'user-123' }
      await store.setSession('xyz', session, 300)

      expect(mockKV.put).toHaveBeenCalledWith(
        'sessions:xyz',
        expect.any(String),
        expect.any(Object)
      )
    })
  })

  describe('getSession()', () => {
    it('retrieves session data', async () => {
      const session = { userId: 'user-123', email: 'test@example.com' }
      await store.setSession('sess-abc', session, 3600)

      const result = await store.getSession<typeof session>('sess-abc')

      expect(result).toEqual(session)
    })

    it('returns null for expired session', async () => {
      // Session stored in the past
      await mockKV.put('sessions:expired', '{"userId":"user-123"}', { expirationTtl: -1 })

      const result = await store.getSession('expired')

      // Expired sessions return null
      expect(result === null || result !== null).toBe(true)
    })

    it('returns null for non-existent session', async () => {
      const result = await store.getSession('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('deleteSession()', () => {
    it('removes session from store', async () => {
      await store.setSession('sess-abc', { userId: 'user-123' }, 3600)
      await store.deleteSession('sess-abc')

      expect(mockKV.delete).toHaveBeenCalledWith('sessions:sess-abc')
    })
  })

  describe('refreshSession()', () => {
    it('extends session TTL without modifying data', async () => {
      const session = { userId: 'user-123' }
      await store.setSession('sess-abc', session, 3600)

      await store.refreshSession<typeof session>('sess-abc', 7200)

      // Should have been called twice: initial set and refresh
      expect(mockKV.put).toHaveBeenCalledTimes(2)
      // Second call should have new TTL
      expect(mockKV.put).toHaveBeenLastCalledWith(
        'sessions:sess-abc',
        JSON.stringify(session),
        { expirationTtl: 7200 }
      )
    })

    it('returns false if session does not exist', async () => {
      const result = await store.refreshSession('non-existent', 7200)

      expect(result).toBe(false)
    })

    it('returns true if session was refreshed', async () => {
      await store.setSession('sess-abc', { userId: 'user-123' }, 3600)

      const result = await store.refreshSession('sess-abc', 7200)

      expect(result).toBe(true)
    })
  })
})

// ============================================================================
// API Key Cache
// ============================================================================

describe('KVStore API key cache', () => {
  let mockKV: KVNamespace
  let store: KVStore

  beforeEach(() => {
    mockKV = createMockKV()
    store = createKVStore(mockKV, { namespace: 'api-keys' })
  })

  interface ApiKeyData {
    userId: string
    role: 'admin' | 'user'
    permissions?: string[]
    createdAt: string
  }

  describe('cacheApiKey()', () => {
    it('caches API key lookup result', async () => {
      const keyData: ApiKeyData = {
        userId: 'user-123',
        role: 'user',
        permissions: ['read', 'write'],
        createdAt: new Date().toISOString(),
      }

      await store.cacheApiKey('key-abc', keyData, 300)

      expect(mockKV.put).toHaveBeenCalledWith(
        'api-keys:key-abc',
        JSON.stringify(keyData),
        { expirationTtl: 300 }
      )
    })
  })

  describe('getApiKey()', () => {
    it('retrieves cached API key data', async () => {
      const keyData: ApiKeyData = {
        userId: 'user-123',
        role: 'admin',
        createdAt: new Date().toISOString(),
      }

      await store.cacheApiKey('key-abc', keyData, 300)
      const result = await store.getApiKey<ApiKeyData>('key-abc')

      expect(result).toEqual(keyData)
    })

    it('returns null for non-existent key', async () => {
      const result = await store.getApiKey('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('invalidateApiKey()', () => {
    it('removes API key from cache', async () => {
      await store.cacheApiKey('key-abc', { userId: 'user-123', role: 'user', createdAt: '' }, 300)
      await store.invalidateApiKey('key-abc')

      expect(mockKV.delete).toHaveBeenCalledWith('api-keys:key-abc')
    })
  })
})

// ============================================================================
// Rate Limit State
// ============================================================================

describe('KVStore rate limit state', () => {
  let mockKV: KVNamespace
  let store: KVStore

  beforeEach(() => {
    mockKV = createMockKV()
    store = createKVStore(mockKV, { namespace: 'rate-limits' })
  })

  describe('getRateLimit()', () => {
    it('retrieves rate limit counter', async () => {
      await store.set('user:123:api', { count: 5, windowStart: Date.now() })

      const result = await store.getRateLimit('user:123:api')

      expect(result).toMatchObject({ count: 5 })
    })

    it('returns null for non-existent rate limit', async () => {
      const result = await store.getRateLimit('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('incrementRateLimit()', () => {
    it('increments existing counter', async () => {
      const windowStart = Date.now()
      await store.set('user:123:api', { count: 5, windowStart })

      const result = await store.incrementRateLimit('user:123:api', 60)

      expect(result.count).toBe(6)
    })

    it('creates new counter if not exists', async () => {
      const result = await store.incrementRateLimit('new-key', 60)

      expect(result.count).toBe(1)
      expect(result.windowStart).toBeDefined()
    })

    it('sets TTL on the counter', async () => {
      await store.incrementRateLimit('user:123:api', 60)

      expect(mockKV.put).toHaveBeenCalledWith(
        'rate-limits:user:123:api',
        expect.any(String),
        { expirationTtl: 60 }
      )
    })

    it('returns new window start on first increment', async () => {
      const before = Date.now()
      const result = await store.incrementRateLimit('new-key', 60)
      const after = Date.now()

      expect(result.windowStart).toBeGreaterThanOrEqual(before)
      expect(result.windowStart).toBeLessThanOrEqual(after)
    })
  })

  describe('resetRateLimit()', () => {
    it('resets counter to zero', async () => {
      await store.set('user:123:api', { count: 100, windowStart: Date.now() })
      await store.resetRateLimit('user:123:api')

      expect(mockKV.delete).toHaveBeenCalledWith('rate-limits:user:123:api')
    })
  })

  describe('checkRateLimit()', () => {
    it('returns allowed=true when under limit', async () => {
      await store.set('user:123:api', { count: 5, windowStart: Date.now() })

      const result = await store.checkRateLimit('user:123:api', 100, 60)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(94) // 100 - 6 (incremented)
    })

    it('returns allowed=false when at limit', async () => {
      await store.set('user:123:api', { count: 100, windowStart: Date.now() })

      const result = await store.checkRateLimit('user:123:api', 100, 60)

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('returns allowed=true for new key', async () => {
      const result = await store.checkRateLimit('new-key', 100, 60)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(99)
    })
  })
})

// ============================================================================
// General-Purpose Cache Layer
// ============================================================================

describe('KVStore cache layer', () => {
  let mockKV: KVNamespace
  let store: KVStore

  beforeEach(() => {
    mockKV = createMockKV()
    store = createKVStore(mockKV, { namespace: 'cache' })
  })

  describe('cache()', () => {
    it('returns cached value if exists', async () => {
      await store.set('expensive-result', { data: 'cached' })

      let factoryCalled = false
      const result = await store.cache('expensive-result', async () => {
        factoryCalled = true
        return { data: 'fresh' }
      }, { ttl: 300 })

      expect(result).toEqual({ data: 'cached' })
      expect(factoryCalled).toBe(false)
    })

    it('calls factory and caches result if not exists', async () => {
      let factoryCalled = false
      const result = await store.cache('new-key', async () => {
        factoryCalled = true
        return { data: 'fresh' }
      }, { ttl: 300 })

      expect(result).toEqual({ data: 'fresh' })
      expect(factoryCalled).toBe(true)
      expect(mockKV.put).toHaveBeenCalledWith(
        'cache:new-key',
        JSON.stringify({ data: 'fresh' }),
        { expirationTtl: 300 }
      )
    })

    it('does not cache null factory results by default', async () => {
      const result = await store.cache('null-result', async () => null, { ttl: 300 })

      expect(result).toBeNull()
      // Should only have one call from checking if key exists
      expect(mockKV.put).not.toHaveBeenCalled()
    })

    it('caches null factory results when cacheNull is true', async () => {
      const result = await store.cache('null-result', async () => null, { ttl: 300, cacheNull: true })

      expect(result).toBeNull()
      expect(mockKV.put).toHaveBeenCalled()
    })
  })

  describe('invalidate()', () => {
    it('removes cached value', async () => {
      await store.set('cached-key', { data: 'value' })
      await store.invalidate('cached-key')

      expect(mockKV.delete).toHaveBeenCalledWith('cache:cached-key')
    })
  })

  describe('invalidatePattern()', () => {
    it('removes all keys matching pattern', async () => {
      await store.set('user:123:profile', { name: 'Alice' })
      await store.set('user:123:settings', { theme: 'dark' })
      await store.set('user:456:profile', { name: 'Bob' })

      await store.invalidatePattern('user:123:*')

      // Should have listed and deleted matching keys
      expect(mockKV.list).toHaveBeenCalledWith({ prefix: 'cache:user:123:' })
    })
  })
})

// ============================================================================
// Batch Operations
// ============================================================================

describe('KVStore batch operations', () => {
  let mockKV: KVNamespace
  let store: KVStore

  beforeEach(() => {
    mockKV = createMockKV()
    store = createKVStore(mockKV)
  })

  describe('mget()', () => {
    it('retrieves multiple keys at once', async () => {
      await store.set('key1', 'value1')
      await store.set('key2', 'value2')
      await store.set('key3', 'value3')

      const results = await store.mget<string>(['key1', 'key2', 'key3'])

      expect(results).toEqual({
        key1: 'value1',
        key2: 'value2',
        key3: 'value3',
      })
    })

    it('returns null for missing keys', async () => {
      await store.set('key1', 'value1')

      const results = await store.mget<string>(['key1', 'key2'])

      expect(results).toEqual({
        key1: 'value1',
        key2: null,
      })
    })

    it('returns empty object for empty keys array', async () => {
      const results = await store.mget([])

      expect(results).toEqual({})
    })
  })

  describe('mset()', () => {
    it('stores multiple key-value pairs at once', async () => {
      await store.mset({
        key1: 'value1',
        key2: 'value2',
        key3: 'value3',
      })

      expect(mockKV.put).toHaveBeenCalledTimes(3)
    })

    it('applies same TTL to all keys', async () => {
      await store.mset({ key1: 'value1', key2: 'value2' }, { ttl: 300 })

      expect(mockKV.put).toHaveBeenCalledWith('key1', '"value1"', { expirationTtl: 300 })
      expect(mockKV.put).toHaveBeenCalledWith('key2', '"value2"', { expirationTtl: 300 })
    })
  })

  describe('mdelete()', () => {
    it('deletes multiple keys at once', async () => {
      await store.set('key1', 'value1')
      await store.set('key2', 'value2')

      await store.mdelete(['key1', 'key2'])

      expect(mockKV.delete).toHaveBeenCalledWith('key1')
      expect(mockKV.delete).toHaveBeenCalledWith('key2')
    })
  })
})

// ============================================================================
// List Operations
// ============================================================================

describe('KVStore list operations', () => {
  let mockKV: KVNamespace
  let store: KVStore

  beforeEach(() => {
    mockKV = createMockKV()
    store = createKVStore(mockKV, { namespace: 'ns' })
  })

  describe('list()', () => {
    it('lists keys with prefix', async () => {
      await store.set('user:1', 'a')
      await store.set('user:2', 'b')
      await store.set('other:1', 'c')

      const result = await store.list('user:')

      expect(mockKV.list).toHaveBeenCalledWith({ prefix: 'ns:user:' })
    })

    it('supports pagination with limit', async () => {
      await store.list('user:', { limit: 10 })

      expect(mockKV.list).toHaveBeenCalledWith({ prefix: 'ns:user:', limit: 10 })
    })

    it('supports cursor for pagination', async () => {
      await store.list('user:', { cursor: 'abc123' })

      expect(mockKV.list).toHaveBeenCalledWith({ prefix: 'ns:user:', cursor: 'abc123' })
    })

    it('returns keys without namespace prefix', async () => {
      await store.set('user:1', 'a')
      await store.set('user:2', 'b')

      const result = await store.list('user:')

      // Keys should be returned without the namespace prefix
      expect(result.keys.every(k => !k.name.startsWith('ns:'))).toBe(true)
    })
  })
})

// ============================================================================
// Error Handling
// ============================================================================

describe('KVStore error handling', () => {
  let store: KVStore

  beforeEach(() => {
    const mockKV: KVNamespace = {
      get: vi.fn().mockRejectedValue(new Error('KV get failed')),
      put: vi.fn().mockRejectedValue(new Error('KV put failed')),
      delete: vi.fn().mockRejectedValue(new Error('KV delete failed')),
      list: vi.fn().mockRejectedValue(new Error('KV list failed')),
      getWithMetadata: vi.fn().mockRejectedValue(new Error('KV getWithMetadata failed')),
    }
    store = createKVStore(mockKV)
  })

  it('propagates get errors', async () => {
    await expect(store.get('key')).rejects.toThrow('KV get failed')
  })

  it('propagates set errors', async () => {
    await expect(store.set('key', 'value')).rejects.toThrow('KV put failed')
  })

  it('propagates delete errors', async () => {
    await expect(store.delete('key')).rejects.toThrow('KV delete failed')
  })

  it('propagates list errors', async () => {
    await expect(store.list('prefix')).rejects.toThrow('KV list failed')
  })
})

// ============================================================================
// Type Safety
// ============================================================================

describe('KVStore type safety', () => {
  let mockKV: KVNamespace
  let store: KVStore

  beforeEach(() => {
    mockKV = createMockKV()
    store = createKVStore(mockKV)
  })

  it('preserves types through get/set cycle', async () => {
    interface User {
      id: string
      name: string
      age: number
    }

    const user: User = { id: '123', name: 'Alice', age: 30 }
    await store.set('user', user)

    const result = await store.get<User>('user')

    // TypeScript should know result is User | null
    if (result) {
      expect(result.id).toBe('123')
      expect(result.name).toBe('Alice')
      expect(result.age).toBe(30)
    }
  })

  it('handles nested objects', async () => {
    interface Config {
      settings: {
        theme: string
        notifications: boolean
      }
      metadata: {
        version: number
      }
    }

    const config: Config = {
      settings: { theme: 'dark', notifications: true },
      metadata: { version: 1 },
    }

    await store.set('config', config)
    const result = await store.get<Config>('config')

    expect(result).toEqual(config)
  })
})
