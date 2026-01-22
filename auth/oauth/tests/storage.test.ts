/**
 * @dotdo/oauth Session Storage Tests
 *
 * Tests for session storage implementations: MemorySessionStore, KVSessionStore, D1SessionStore.
 * Following TDD - write tests first, then implement.
 *
 * @module @dotdo/oauth/tests/storage
 */

import { describe, it, expect, beforeEach } from 'vitest'

describe('@dotdo/oauth storage', () => {
  describe('MemorySessionStore', () => {
    it('set() stores session', async () => {
      const { MemorySessionStore } = await import('../src/storage/memory')
      const store = new MemorySessionStore()

      await store.set('session-1', {
        userId: 'user-123',
        accessToken: 'token',
        provider: 'github',
      })
      const session = await store.get('session-1')

      expect(session?.userId).toBe('user-123')
    })

    it('get() returns null for missing session', async () => {
      const { MemorySessionStore } = await import('../src/storage/memory')
      const store = new MemorySessionStore()

      const session = await store.get('nonexistent')
      expect(session).toBeNull()
    })

    it('delete() removes session', async () => {
      const { MemorySessionStore } = await import('../src/storage/memory')
      const store = new MemorySessionStore()

      await store.set('session-1', {
        userId: 'user-123',
        accessToken: 'token',
        provider: 'github',
      })
      await store.delete('session-1')

      expect(await store.get('session-1')).toBeNull()
    })

    it('respects TTL expiration', async () => {
      const { MemorySessionStore } = await import('../src/storage/memory')
      const store = new MemorySessionStore({ defaultTTL: 100 }) // 100ms

      await store.set('session-1', {
        userId: 'user-123',
        accessToken: 'token',
        provider: 'github',
      })
      await new Promise((r) => setTimeout(r, 150))

      expect(await store.get('session-1')).toBeNull()
    })

    it('per-session TTL overrides default', async () => {
      const { MemorySessionStore } = await import('../src/storage/memory')
      const store = new MemorySessionStore({ defaultTTL: 1000 }) // 1s default

      await store.set(
        'session-1',
        {
          userId: 'user-123',
          accessToken: 'token',
          provider: 'github',
        },
        50
      ) // 50ms TTL for this session
      await new Promise((r) => setTimeout(r, 100))

      expect(await store.get('session-1')).toBeNull()
    })

    it('stores full session data', async () => {
      const { MemorySessionStore } = await import('../src/storage/memory')
      const store = new MemorySessionStore()

      const sessionData = {
        userId: 'user-123',
        accessToken: 'access-token-xyz',
        refreshToken: 'refresh-token-abc',
        expiresAt: Date.now() + 3600000,
        provider: 'github',
        metadata: { scope: 'user:email', profile: { name: 'Test User' } },
      }

      await store.set('session-1', sessionData)
      const session = await store.get('session-1')

      expect(session).toEqual(sessionData)
    })

    it('cleanup() removes expired sessions', async () => {
      const { MemorySessionStore } = await import('../src/storage/memory')
      const store = new MemorySessionStore({ defaultTTL: 50 })

      await store.set('session-1', {
        userId: 'user-1',
        accessToken: 'token-1',
        provider: 'github',
      })
      await store.set('session-2', {
        userId: 'user-2',
        accessToken: 'token-2',
        provider: 'github',
      })

      await new Promise((r) => setTimeout(r, 100))
      await store.cleanup?.()

      // Verify internal map is empty after cleanup
      expect(await store.get('session-1')).toBeNull()
      expect(await store.get('session-2')).toBeNull()
    })
  })

  describe('SessionStore interface', () => {
    it('has required methods', async () => {
      const { MemorySessionStore } = await import('../src/storage/memory')
      const store = new MemorySessionStore()

      expect(typeof store.get).toBe('function')
      expect(typeof store.set).toBe('function')
      expect(typeof store.delete).toBe('function')
    })

    it('has optional cleanup method', async () => {
      const { MemorySessionStore } = await import('../src/storage/memory')
      const store = new MemorySessionStore()

      expect(typeof store.cleanup).toBe('function')
    })
  })

  describe('KVSessionStore', () => {
    it('implements SessionStore interface', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')

      // Create a mock KV namespace for interface testing
      const mockKV = {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
      } as unknown as KVNamespace

      const store = new KVSessionStore(mockKV)

      expect(typeof store.get).toBe('function')
      expect(typeof store.set).toBe('function')
      expect(typeof store.delete).toBe('function')
    })

    it('uses prefix for keys', async () => {
      const { KVSessionStore } = await import('../src/storage/kv')

      const calls: string[] = []
      const mockKV = {
        get: async (key: string) => {
          calls.push(`get:${key}`)
          return null
        },
        put: async (key: string) => {
          calls.push(`put:${key}`)
        },
        delete: async (key: string) => {
          calls.push(`delete:${key}`)
        },
      } as unknown as KVNamespace

      const store = new KVSessionStore(mockKV, { prefix: 'session:' })
      await store.get('test-id')
      await store.set('test-id', {
        userId: 'user-1',
        accessToken: 'token',
        provider: 'github',
      })
      await store.delete('test-id')

      expect(calls).toContain('get:session:test-id')
      expect(calls).toContain('put:session:test-id')
      expect(calls).toContain('delete:session:test-id')
    })
  })

  describe('D1SessionStore', () => {
    it('implements SessionStore interface', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')

      // Create a mock D1 database for interface testing
      const mockD1 = {
        prepare: () => ({
          bind: () => ({
            first: async () => null,
            run: async () => ({}),
          }),
        }),
      } as unknown as D1Database

      const store = new D1SessionStore(mockD1)

      expect(typeof store.get).toBe('function')
      expect(typeof store.set).toBe('function')
      expect(typeof store.delete).toBe('function')
    })

    it('uses custom table name', async () => {
      const { D1SessionStore } = await import('../src/storage/d1')

      let preparedQuery = ''
      const mockD1 = {
        prepare: (query: string) => {
          preparedQuery = query
          return {
            bind: () => ({
              first: async () => null,
              run: async () => ({}),
            }),
          }
        },
      } as unknown as D1Database

      const store = new D1SessionStore(mockD1, { tableName: 'custom_sessions' })
      await store.get('test-id')

      expect(preparedQuery).toContain('custom_sessions')
    })
  })

  describe('Session rotation', () => {
    it('rotate() creates new session with same data', async () => {
      const { MemorySessionStore } = await import('../src/storage/memory')
      const store = new MemorySessionStore()

      const sessionData = {
        userId: 'user-123',
        accessToken: 'token',
        provider: 'github',
      }
      await store.set('old-session', sessionData)

      const newSessionId = await store.rotate('old-session', 'new-session')

      expect(newSessionId).toBe('new-session')
      expect(await store.get('old-session')).toBeNull()
      expect(await store.get('new-session')).toEqual(sessionData)
    })

    it('rotate() returns null if old session does not exist', async () => {
      const { MemorySessionStore } = await import('../src/storage/memory')
      const store = new MemorySessionStore()

      const result = await store.rotate('nonexistent', 'new-session')

      expect(result).toBeNull()
    })
  })
})
