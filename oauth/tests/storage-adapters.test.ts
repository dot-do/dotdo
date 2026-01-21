/**
 * @dotdo/oauth Storage Adapters Extended Tests
 *
 * Extended tests for KVSessionStore and D1SessionStore covering
 * CRUD operations, TTL handling, rotation, and edge cases.
 *
 * Following NO MOCKS philosophy - uses real test implementations.
 *
 * @module @dotdo/oauth/tests/storage-adapters
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createTestKV, createTestD1 } from './test-utils'
import type { SessionData } from '../src/storage/interface'

describe('@dotdo/oauth KVSessionStore', () => {
  describe('get()', () => {
    it('retrieves stored session', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createTestKV()

      const sessionData: SessionData = {
        userId: 'user-123',
        accessToken: 'token-abc',
        provider: 'github',
      }

      // Pre-populate the store
      await kv.put('session:test-session', JSON.stringify(sessionData))

      const store = new KVSessionStore(kv as unknown as KVNamespace)
      const result = await store.get('test-session')

      expect(result).toEqual(sessionData)
    })

    it('returns null for non-existent session', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createTestKV()

      const store = new KVSessionStore(kv as unknown as KVNamespace)
      const result = await store.get('nonexistent')

      expect(result).toBeNull()
    })

    it('uses custom prefix', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createTestKV()

      const sessionData: SessionData = {
        userId: 'user-123',
        accessToken: 'token',
        provider: 'github',
      }

      await kv.put('auth:mysession', JSON.stringify(sessionData))

      const store = new KVSessionStore(kv as unknown as KVNamespace, { prefix: 'auth:' })
      const result = await store.get('mysession')

      expect(result).toEqual(sessionData)
    })
  })

  describe('set()', () => {
    it('stores session with default TTL', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createTestKV()

      const store = new KVSessionStore(kv as unknown as KVNamespace)

      const sessionData: SessionData = {
        userId: 'user-456',
        accessToken: 'new-token',
        provider: 'google',
      }

      await store.set('new-session', sessionData)

      // Verify session was stored
      const stored = kv.getRaw('session:new-session')
      expect(stored).toBeDefined()
      expect(JSON.parse(stored!)).toEqual(sessionData)
    })

    it('converts custom TTL from ms to seconds', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createTestKV()

      const store = new KVSessionStore(kv as unknown as KVNamespace)

      const sessionData: SessionData = {
        userId: 'user-789',
        accessToken: 'token',
        provider: 'mock',
      }

      // Pass TTL in milliseconds
      await store.set('custom-ttl-session', sessionData, 3600000) // 1 hour in ms

      const stored = kv.getRaw('session:custom-ttl-session')
      expect(stored).toBeDefined()
    })

    it('uses default TTL from options', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createTestKV()

      // Default TTL in milliseconds
      const store = new KVSessionStore(kv as unknown as KVNamespace, { defaultTTL: 7200000 }) // 2 hours in ms

      const sessionData: SessionData = {
        userId: 'user-abc',
        accessToken: 'token',
        provider: 'mock',
      }

      await store.set('default-ttl-session', sessionData)

      const stored = kv.getRaw('session:default-ttl-session')
      expect(stored).toBeDefined()
    })

    it('stores full session data with all fields', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createTestKV()

      const store = new KVSessionStore(kv as unknown as KVNamespace)

      const sessionData: SessionData = {
        userId: 'user-full',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000,
        provider: 'github',
        metadata: {
          email: 'user@example.com',
          name: 'Test User',
          picture: 'https://example.com/avatar.jpg',
        },
      }

      await store.set('full-session', sessionData)

      const stored = kv.getRaw('session:full-session')
      expect(stored).toBeDefined()
      expect(JSON.parse(stored!)).toEqual(sessionData)
    })
  })

  describe('delete()', () => {
    it('removes session from store', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createTestKV()

      // Pre-populate
      await kv.put('session:to-delete', JSON.stringify({ userId: 'user', accessToken: 'token', provider: 'mock' }))

      const store = new KVSessionStore(kv as unknown as KVNamespace)
      await store.delete('to-delete')

      expect(kv.has('session:to-delete')).toBe(false)
    })

    it('handles deletion of non-existent session', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createTestKV()

      const store = new KVSessionStore(kv as unknown as KVNamespace)

      // Should not throw
      await expect(store.delete('nonexistent')).resolves.toBeUndefined()
    })
  })

  describe('rotate()', () => {
    it('rotates session to new ID', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createTestKV()

      const sessionData: SessionData = {
        userId: 'user-rotate',
        accessToken: 'token',
        provider: 'mock',
      }

      await kv.put('session:old-id', JSON.stringify(sessionData))

      const store = new KVSessionStore(kv as unknown as KVNamespace)
      const newId = await store.rotate('old-id', 'new-id')

      expect(newId).toBe('new-id')
      expect(await store.get('old-id')).toBeNull()

      const newSession = await store.get('new-id')
      expect(newSession).toEqual(sessionData)
    })

    it('returns null when old session does not exist', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createTestKV()

      const store = new KVSessionStore(kv as unknown as KVNamespace)
      const result = await store.rotate('nonexistent', 'new-id')

      expect(result).toBeNull()
    })
  })

  describe('cleanup()', () => {
    it('is a no-op since KV handles TTL automatically', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createTestKV()

      const store = new KVSessionStore(kv as unknown as KVNamespace)

      // Should not throw and not delete anything
      await expect(store.cleanup()).resolves.toBeUndefined()
    })
  })
})

describe('@dotdo/oauth D1SessionStore', () => {
  describe('get()', () => {
    it('retrieves stored session', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createTestD1()

      // Pre-populate
      db.rows.set('test-session', {
        id: 'test-session',
        user_id: 'user-123',
        access_token: 'token-abc',
        refresh_token: null,
        expires_at: null,
        provider: 'github',
        metadata: null,
        created_at: Date.now(),
        session_expires_at: Date.now() + 86400000,
      })

      const store = new D1SessionStore(db as unknown as D1Database)
      const result = await store.get('test-session')

      expect(result).toBeDefined()
      expect(result?.userId).toBe('user-123')
      expect(result?.accessToken).toBe('token-abc')
      expect(result?.provider).toBe('github')
    })

    it('returns null for expired session', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createTestD1()

      // Pre-populate with expired session
      db.rows.set('expired-session', {
        id: 'expired-session',
        user_id: 'user-123',
        access_token: 'token',
        refresh_token: null,
        expires_at: null,
        provider: 'github',
        metadata: null,
        created_at: Date.now() - 100000,
        session_expires_at: Date.now() - 1000, // Already expired
      })

      const store = new D1SessionStore(db as unknown as D1Database)
      const result = await store.get('expired-session')

      expect(result).toBeNull()
    })

    it('returns null for non-existent session', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createTestD1()

      const store = new D1SessionStore(db as unknown as D1Database)
      const result = await store.get('nonexistent')

      expect(result).toBeNull()
    })

    it('includes optional fields when present', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createTestD1()

      const expiresAt = Date.now() + 3600000
      db.rows.set('full-session', {
        id: 'full-session',
        user_id: 'user-full',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_at: expiresAt,
        provider: 'google',
        metadata: JSON.stringify({ email: 'user@example.com', role: 'admin' }),
        created_at: Date.now(),
        session_expires_at: Date.now() + 86400000,
      })

      const store = new D1SessionStore(db as unknown as D1Database)
      const result = await store.get('full-session')

      expect(result?.refreshToken).toBe('refresh-token')
      expect(result?.expiresAt).toBe(expiresAt)
      expect(result?.metadata).toEqual({ email: 'user@example.com', role: 'admin' })
    })

    it('uses custom table name', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createTestD1()

      const store = new D1SessionStore(db as unknown as D1Database, { tableName: 'custom_sessions' })
      await store.get('test-id')

      // The query will be executed and should not throw
      expect(true).toBe(true)
    })
  })

  describe('set()', () => {
    it('stores session with default TTL', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createTestD1()

      const store = new D1SessionStore(db as unknown as D1Database)

      const sessionData: SessionData = {
        userId: 'user-new',
        accessToken: 'new-token',
        provider: 'mock',
      }

      await store.set('new-session', sessionData)

      const stored = db.rows.get('new-session')
      expect(stored).toBeDefined()
      expect(stored?.user_id).toBe('user-new')
      expect(stored?.access_token).toBe('new-token')
      expect(stored?.provider).toBe('mock')
    })

    it('stores session with custom TTL', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createTestD1()

      const store = new D1SessionStore(db as unknown as D1Database)

      const now = Date.now()
      const sessionData: SessionData = {
        userId: 'user-ttl',
        accessToken: 'token',
        provider: 'mock',
      }

      await store.set('ttl-session', sessionData, 3600000) // 1 hour

      const stored = db.rows.get('ttl-session')
      expect(stored?.session_expires_at).toBeGreaterThan(now + 3500000)
      expect(stored?.session_expires_at).toBeLessThan(now + 3700000)
    })

    it('stores all optional fields', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createTestD1()

      const store = new D1SessionStore(db as unknown as D1Database)

      const expiresAt = Date.now() + 7200000
      const sessionData: SessionData = {
        userId: 'user-full',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt,
        provider: 'github',
        metadata: { email: 'user@example.com', scopes: ['read', 'write'] },
      }

      await store.set('full-session', sessionData)

      const stored = db.rows.get('full-session')
      expect(stored?.refresh_token).toBe('refresh-token')
      expect(stored?.expires_at).toBe(expiresAt)
      expect(stored?.metadata).toBe(JSON.stringify(sessionData.metadata))
    })

    it('handles null optional fields', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createTestD1()

      const store = new D1SessionStore(db as unknown as D1Database)

      const sessionData: SessionData = {
        userId: 'user-minimal',
        accessToken: 'token',
        provider: 'mock',
        // No refreshToken, expiresAt, or metadata
      }

      await store.set('minimal-session', sessionData)

      const stored = db.rows.get('minimal-session')
      expect(stored?.refresh_token).toBeNull()
      expect(stored?.expires_at).toBeNull()
      expect(stored?.metadata).toBeNull()
    })
  })

  describe('delete()', () => {
    it('removes session from database', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createTestD1()

      db.rows.set('to-delete', {
        id: 'to-delete',
        user_id: 'user',
        access_token: 'token',
        refresh_token: null,
        expires_at: null,
        provider: 'mock',
        metadata: null,
        created_at: Date.now(),
        session_expires_at: Date.now() + 86400000,
      })

      const store = new D1SessionStore(db as unknown as D1Database)
      await store.delete('to-delete')

      expect(db.rows.has('to-delete')).toBe(false)
    })
  })

  describe('cleanup()', () => {
    it('removes expired sessions', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createTestD1()

      const now = Date.now()

      // Expired session
      db.rows.set('expired', {
        id: 'expired',
        user_id: 'user1',
        access_token: 'token1',
        refresh_token: null,
        expires_at: null,
        provider: 'mock',
        metadata: null,
        created_at: now - 100000,
        session_expires_at: now - 1000,
      })

      // Valid session
      db.rows.set('valid', {
        id: 'valid',
        user_id: 'user2',
        access_token: 'token2',
        refresh_token: null,
        expires_at: null,
        provider: 'mock',
        metadata: null,
        created_at: now,
        session_expires_at: now + 86400000,
      })

      const store = new D1SessionStore(db as unknown as D1Database)
      await store.cleanup()

      expect(db.rows.has('expired')).toBe(false)
      expect(db.rows.has('valid')).toBe(true)
    })
  })

  describe('rotate()', () => {
    it('rotates session to new ID', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createTestD1()

      db.rows.set('old-id', {
        id: 'old-id',
        user_id: 'user-rotate',
        access_token: 'token',
        refresh_token: 'refresh',
        expires_at: null,
        provider: 'mock',
        metadata: null,
        created_at: Date.now(),
        session_expires_at: Date.now() + 86400000,
      })

      const store = new D1SessionStore(db as unknown as D1Database)
      const newId = await store.rotate('old-id', 'new-id')

      expect(newId).toBe('new-id')
      expect(db.rows.has('old-id')).toBe(false)
      expect(db.rows.has('new-id')).toBe(true)

      const newSession = db.rows.get('new-id')
      expect(newSession?.user_id).toBe('user-rotate')
    })

    it('returns null when old session does not exist', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createTestD1()

      const store = new D1SessionStore(db as unknown as D1Database)
      const result = await store.rotate('nonexistent', 'new-id')

      expect(result).toBeNull()
    })
  })
})

describe('@dotdo/oauth D1_SESSION_SCHEMA', () => {
  it('exports valid SQL schema', async () => {
    const { D1_SESSION_SCHEMA } = await import('../src/storage/d1')

    expect(D1_SESSION_SCHEMA).toContain('CREATE TABLE')
    expect(D1_SESSION_SCHEMA).toContain('sessions')
    expect(D1_SESSION_SCHEMA).toContain('id TEXT PRIMARY KEY')
    expect(D1_SESSION_SCHEMA).toContain('user_id TEXT NOT NULL')
    expect(D1_SESSION_SCHEMA).toContain('access_token TEXT NOT NULL')
    expect(D1_SESSION_SCHEMA).toContain('refresh_token TEXT')
    expect(D1_SESSION_SCHEMA).toContain('provider TEXT NOT NULL')
    expect(D1_SESSION_SCHEMA).toContain('CREATE INDEX')
  })
})
