/**
 * @dotdo/oauth Storage Adapters Extended Tests
 *
 * Extended tests for KVSessionStore and D1SessionStore covering
 * CRUD operations, TTL handling, rotation, and edge cases.
 *
 * @module @dotdo/oauth/tests/storage-adapters
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionData } from '../src/storage/interface'

// Create mock KV namespace
function createMockKV() {
  const store = new Map<string, { value: string; expiration?: number }>()

  return {
    store,
    get: vi.fn(async (key: string, type?: string) => {
      const item = store.get(key)
      if (!item) return null
      if (item.expiration && item.expiration < Date.now()) {
        store.delete(key)
        return null
      }
      if (type === 'json') {
        return JSON.parse(item.value)
      }
      return item.value
    }),
    put: vi.fn(async (key: string, value: string, options?: { expirationTtl?: number }) => {
      const expiration = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined
      store.set(key, { value, expiration })
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  } as unknown as KVNamespace & { store: Map<string, { value: string; expiration?: number }> }
}

// Create mock D1 database
function createMockD1() {
  const rows = new Map<string, Record<string, unknown>>()

  const createStmt = (query: string) => {
    const boundValues: unknown[] = []

    return {
      bind: (...values: unknown[]) => {
        boundValues.push(...values)
        return {
          first: vi.fn(async () => {
            // SELECT query
            if (query.includes('SELECT')) {
              const id = boundValues[0] as string
              const now = boundValues[1] as number
              const row = rows.get(id)
              if (!row) return null
              if (row['session_expires_at'] && (row['session_expires_at'] as number) <= now) {
                return null
              }
              return row
            }
            return null
          }),
          run: vi.fn(async () => {
            // INSERT/REPLACE query
            if (query.includes('INSERT OR REPLACE')) {
              const [id, user_id, access_token, refresh_token, expires_at, provider, metadata, created_at, session_expires_at] =
                boundValues
              rows.set(id as string, {
                id,
                user_id,
                access_token,
                refresh_token,
                expires_at,
                provider,
                metadata,
                created_at,
                session_expires_at,
              })
            }
            // DELETE query
            if (query.includes('DELETE') && query.includes('WHERE id')) {
              rows.delete(boundValues[0] as string)
            }
            // DELETE expired query
            if (query.includes('DELETE') && query.includes('session_expires_at')) {
              const now = boundValues[0] as number
              for (const [id, row] of rows.entries()) {
                if ((row['session_expires_at'] as number) <= now) {
                  rows.delete(id)
                }
              }
            }
            return {}
          }),
        }
      },
    }
  }

  return {
    rows,
    prepare: vi.fn((query: string) => createStmt(query)),
  } as unknown as D1Database & { rows: Map<string, Record<string, unknown>> }
}

describe('@dotdo/oauth KVSessionStore', () => {
  describe('get()', () => {
    it('retrieves stored session', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createMockKV()

      const sessionData: SessionData = {
        userId: 'user-123',
        accessToken: 'token-abc',
        provider: 'github',
      }

      // Pre-populate the store
      await kv.put('session:test-session', JSON.stringify(sessionData))

      const store = new KVSessionStore(kv)
      const result = await store.get('test-session')

      expect(kv.get).toHaveBeenCalledWith('session:test-session', 'json')
      expect(result).toEqual(sessionData)
    })

    it('returns null for non-existent session', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createMockKV()

      const store = new KVSessionStore(kv)
      const result = await store.get('nonexistent')

      expect(result).toBeNull()
    })

    it('uses custom prefix', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createMockKV()

      const sessionData: SessionData = {
        userId: 'user-123',
        accessToken: 'token',
        provider: 'github',
      }

      await kv.put('auth:mysession', JSON.stringify(sessionData))

      const store = new KVSessionStore(kv, { prefix: 'auth:' })
      const result = await store.get('mysession')

      expect(kv.get).toHaveBeenCalledWith('auth:mysession', 'json')
      expect(result).toEqual(sessionData)
    })
  })

  describe('set()', () => {
    it('stores session with default TTL', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createMockKV()

      const store = new KVSessionStore(kv)

      const sessionData: SessionData = {
        userId: 'user-456',
        accessToken: 'new-token',
        provider: 'google',
      }

      await store.set('new-session', sessionData)

      expect(kv.put).toHaveBeenCalledWith('session:new-session', JSON.stringify(sessionData), {
        expirationTtl: 24 * 60 * 60, // 24 hours in seconds
      })
    })

    it('converts custom TTL from ms to seconds', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createMockKV()

      const store = new KVSessionStore(kv)

      const sessionData: SessionData = {
        userId: 'user-789',
        accessToken: 'token',
        provider: 'mock',
      }

      // Pass TTL in milliseconds
      await store.set('custom-ttl-session', sessionData, 3600000) // 1 hour in ms

      expect(kv.put).toHaveBeenCalledWith('session:custom-ttl-session', JSON.stringify(sessionData), {
        expirationTtl: 3600, // Should be converted to seconds
      })
    })

    it('uses default TTL from options', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createMockKV()

      // Default TTL in milliseconds
      const store = new KVSessionStore(kv, { defaultTTL: 7200000 }) // 2 hours in ms

      const sessionData: SessionData = {
        userId: 'user-abc',
        accessToken: 'token',
        provider: 'mock',
      }

      await store.set('default-ttl-session', sessionData)

      expect(kv.put).toHaveBeenCalledWith('session:default-ttl-session', JSON.stringify(sessionData), {
        expirationTtl: 7200, // 2 hours in seconds
      })
    })

    it('stores full session data with all fields', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createMockKV()

      const store = new KVSessionStore(kv)

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

      const storedItem = kv.store.get('session:full-session')
      expect(storedItem).toBeDefined()
      expect(JSON.parse(storedItem!.value)).toEqual(sessionData)
    })
  })

  describe('delete()', () => {
    it('removes session from store', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createMockKV()

      // Pre-populate
      await kv.put('session:to-delete', JSON.stringify({ userId: 'user', accessToken: 'token', provider: 'mock' }))

      const store = new KVSessionStore(kv)
      await store.delete('to-delete')

      expect(kv.delete).toHaveBeenCalledWith('session:to-delete')
    })

    it('handles deletion of non-existent session', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createMockKV()

      const store = new KVSessionStore(kv)

      // Should not throw
      await expect(store.delete('nonexistent')).resolves.toBeUndefined()
    })
  })

  describe('rotate()', () => {
    it('rotates session to new ID', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createMockKV()

      const sessionData: SessionData = {
        userId: 'user-rotate',
        accessToken: 'token',
        provider: 'mock',
      }

      await kv.put('session:old-id', JSON.stringify(sessionData))

      const store = new KVSessionStore(kv)
      const newId = await store.rotate('old-id', 'new-id')

      expect(newId).toBe('new-id')
      expect(await store.get('old-id')).toBeNull()

      const newSession = await store.get('new-id')
      expect(newSession).toEqual(sessionData)
    })

    it('returns null when old session does not exist', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createMockKV()

      const store = new KVSessionStore(kv)
      const result = await store.rotate('nonexistent', 'new-id')

      expect(result).toBeNull()
    })
  })

  describe('cleanup()', () => {
    it('is a no-op since KV handles TTL automatically', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')
      const kv = createMockKV()

      const store = new KVSessionStore(kv)

      // Should not throw and not delete anything
      await expect(store.cleanup()).resolves.toBeUndefined()
    })
  })
})

describe('@dotdo/oauth D1SessionStore', () => {
  describe('get()', () => {
    it('retrieves stored session', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createMockD1()

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

      const store = new D1SessionStore(db)
      const result = await store.get('test-session')

      expect(result).toBeDefined()
      expect(result?.userId).toBe('user-123')
      expect(result?.accessToken).toBe('token-abc')
      expect(result?.provider).toBe('github')
    })

    it('returns null for expired session', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createMockD1()

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

      const store = new D1SessionStore(db)
      const result = await store.get('expired-session')

      expect(result).toBeNull()
    })

    it('returns null for non-existent session', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createMockD1()

      const store = new D1SessionStore(db)
      const result = await store.get('nonexistent')

      expect(result).toBeNull()
    })

    it('includes optional fields when present', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createMockD1()

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

      const store = new D1SessionStore(db)
      const result = await store.get('full-session')

      expect(result?.refreshToken).toBe('refresh-token')
      expect(result?.expiresAt).toBe(expiresAt)
      expect(result?.metadata).toEqual({ email: 'user@example.com', role: 'admin' })
    })

    it('uses custom table name', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createMockD1()

      const store = new D1SessionStore(db, { tableName: 'custom_sessions' })
      await store.get('test-id')

      expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('custom_sessions'))
    })
  })

  describe('set()', () => {
    it('stores session with default TTL', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createMockD1()

      const store = new D1SessionStore(db)

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
      const db = createMockD1()

      const store = new D1SessionStore(db)

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
      const db = createMockD1()

      const store = new D1SessionStore(db)

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
      const db = createMockD1()

      const store = new D1SessionStore(db)

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
      const db = createMockD1()

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

      const store = new D1SessionStore(db)
      await store.delete('to-delete')

      expect(db.rows.has('to-delete')).toBe(false)
    })
  })

  describe('cleanup()', () => {
    it('removes expired sessions', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createMockD1()

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

      const store = new D1SessionStore(db)
      await store.cleanup()

      expect(db.rows.has('expired')).toBe(false)
      expect(db.rows.has('valid')).toBe(true)
    })
  })

  describe('rotate()', () => {
    it('rotates session to new ID', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createMockD1()

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

      const store = new D1SessionStore(db)
      const newId = await store.rotate('old-id', 'new-id')

      expect(newId).toBe('new-id')
      expect(db.rows.has('old-id')).toBe(false)
      expect(db.rows.has('new-id')).toBe(true)

      const newSession = db.rows.get('new-id')
      expect(newSession?.user_id).toBe('user-rotate')
    })

    it('returns null when old session does not exist', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')
      const db = createMockD1()

      const store = new D1SessionStore(db)
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
