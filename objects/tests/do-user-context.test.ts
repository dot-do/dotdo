/**
 * DO User Context Extraction Tests
 *
 * Tests for extracting user context from X-User-* headers in Durable Objects.
 * The RPC auth middleware enriches requests with these headers, and the DO
 * base class should extract them and make the user available.
 *
 * Features tested:
 * - User extraction from X-User-ID, X-User-Email, X-User-Role headers
 * - User available as this.user in DO
 * - User available on $.user in workflow context
 * - Null user when no headers present
 * - Partial user info (id only)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO, type Env } from '../core/DO'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock SQL storage cursor result
 */
interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

/**
 * Mock SQL storage that simulates Cloudflare's SqlStorage API
 */
function createMockSqlStorage() {
  return {
    exec(_query: string, ..._params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
  }
}

/**
 * Mock KV storage for Durable Object state
 */
function createMockKvStorage() {
  const storage = new Map<string, unknown>()

  return {
    get: vi.fn(async <T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (Array.isArray(key)) {
        const result = new Map<string, T>()
        for (const k of key) {
          const value = storage.get(k)
          if (value !== undefined) {
            result.set(k, value as T)
          }
        }
        return result as Map<string, T>
      }
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async <T>(key: string | Record<string, T>, value?: T): Promise<void> => {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          storage.set(k, v)
        }
      } else {
        storage.set(key, value)
      }
    }),
    delete: vi.fn(async (key: string | string[]): Promise<boolean> => {
      if (Array.isArray(key)) {
        let deleted = false
        for (const k of key) {
          deleted = storage.delete(k) || deleted
        }
        return deleted
      }
      return storage.delete(key)
    }),
    list: vi.fn(async <T>(_options?: { prefix?: string }): Promise<Map<string, T>> => {
      return new Map() as Map<string, T>
    }),
    _storage: storage,
  }
}

/**
 * Create a mock DurableObjectState
 */
function createMockDOState() {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage()

  return {
    id: {
      toString: () => 'test-do-id-12345',
      equals: (other: unknown) => other?.toString?.() === 'test-do-id-12345',
      name: 'test-do',
    },
    storage: {
      ...kvStorage,
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
  }
}

/**
 * Create a mock environment
 */
function createMockEnv(): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
  }
}

/**
 * Create a test DO instance
 */
function createTestDO(): DO {
  const state = createMockDOState()
  const env = createMockEnv()
  // @ts-expect-error - Mock state doesn't have all properties
  return new DO(state, env)
}

// ============================================================================
// DO USER CONTEXT EXTRACTION TESTS
// ============================================================================

describe('DO user context extraction', () => {
  let doInstance: DO

  beforeEach(() => {
    doInstance = createTestDO()
  })

  describe('this.user property', () => {
    it('should have user property on DO instance', () => {
      expect(doInstance).toHaveProperty('user')
      expect(doInstance.user).toBeNull()
    })

    it('should extract full user context from headers', async () => {
      const request = new Request('https://example.com/health', {
        headers: {
          'X-User-ID': 'user-123',
          'X-User-Email': 'test@example.com',
          'X-User-Role': 'admin',
        },
      })

      await doInstance.fetch(request)

      expect(doInstance.user).not.toBeNull()
      expect(doInstance.user?.id).toBe('user-123')
      expect(doInstance.user?.email).toBe('test@example.com')
      expect(doInstance.user?.role).toBe('admin')
    })

    it('should have null user when no headers present', async () => {
      const request = new Request('https://example.com/health')

      await doInstance.fetch(request)

      expect(doInstance.user).toBeNull()
    })

    it('should handle partial user info (id only)', async () => {
      const request = new Request('https://example.com/health', {
        headers: {
          'X-User-ID': 'user-minimal',
        },
      })

      await doInstance.fetch(request)

      expect(doInstance.user).not.toBeNull()
      expect(doInstance.user?.id).toBe('user-minimal')
      expect(doInstance.user?.email).toBeUndefined()
      expect(doInstance.user?.role).toBeUndefined()
    })

    it('should handle id and email without role', async () => {
      const request = new Request('https://example.com/health', {
        headers: {
          'X-User-ID': 'user-789',
          'X-User-Email': 'user@example.com',
        },
      })

      await doInstance.fetch(request)

      expect(doInstance.user).not.toBeNull()
      expect(doInstance.user?.id).toBe('user-789')
      expect(doInstance.user?.email).toBe('user@example.com')
      expect(doInstance.user?.role).toBeUndefined()
    })

    it('should handle id and role without email', async () => {
      const request = new Request('https://example.com/health', {
        headers: {
          'X-User-ID': 'user-abc',
          'X-User-Role': 'viewer',
        },
      })

      await doInstance.fetch(request)

      expect(doInstance.user).not.toBeNull()
      expect(doInstance.user?.id).toBe('user-abc')
      expect(doInstance.user?.email).toBeUndefined()
      expect(doInstance.user?.role).toBe('viewer')
    })

    it('should update user on each request', async () => {
      // First request with user A
      const request1 = new Request('https://example.com/health', {
        headers: {
          'X-User-ID': 'user-A',
          'X-User-Role': 'admin',
        },
      })
      await doInstance.fetch(request1)
      expect(doInstance.user?.id).toBe('user-A')
      expect(doInstance.user?.role).toBe('admin')

      // Second request with user B
      const request2 = new Request('https://example.com/health', {
        headers: {
          'X-User-ID': 'user-B',
          'X-User-Role': 'viewer',
        },
      })
      await doInstance.fetch(request2)
      expect(doInstance.user?.id).toBe('user-B')
      expect(doInstance.user?.role).toBe('viewer')
    })

    it('should clear user when unauthenticated request follows authenticated', async () => {
      // First request with user
      const request1 = new Request('https://example.com/health', {
        headers: {
          'X-User-ID': 'user-authenticated',
        },
      })
      await doInstance.fetch(request1)
      expect(doInstance.user).not.toBeNull()

      // Second request without user headers
      const request2 = new Request('https://example.com/health')
      await doInstance.fetch(request2)
      expect(doInstance.user).toBeNull()
    })
  })

  describe('$.user in workflow context', () => {
    it('should have $.user available after authenticated fetch()', async () => {
      const request = new Request('https://example.com/health', {
        headers: {
          'X-User-ID': 'workflow-user-456',
          'X-User-Email': 'workflow@example.com',
        },
      })

      await doInstance.fetch(request)

      expect(doInstance.$).toBeDefined()
      expect(doInstance.$.user).not.toBeNull()
      expect(doInstance.$.user?.id).toBe('workflow-user-456')
      expect(doInstance.$.user?.email).toBe('workflow@example.com')
    })

    it('should have null $.user for unauthenticated requests', async () => {
      const request = new Request('https://example.com/health')

      await doInstance.fetch(request)

      expect(doInstance.$).toBeDefined()
      expect(doInstance.$.user).toBeNull()
    })

    it('should sync $.user with this.user on each request', async () => {
      // First request with user
      const request1 = new Request('https://example.com/health', {
        headers: {
          'X-User-ID': 'sync-user-1',
        },
      })
      await doInstance.fetch(request1)
      expect(doInstance.user?.id).toBe('sync-user-1')
      expect(doInstance.$.user?.id).toBe('sync-user-1')

      // Second request without user
      const request2 = new Request('https://example.com/health')
      await doInstance.fetch(request2)
      expect(doInstance.user).toBeNull()
      expect(doInstance.$.user).toBeNull()
    })
  })
})

// ============================================================================
// TYPE SAFETY TESTS
// ============================================================================

describe('UserContext type safety', () => {
  let doInstance: DO

  beforeEach(() => {
    doInstance = createTestDO()
  })

  it('user should have correct type structure', async () => {
    const request = new Request('https://example.com/health', {
      headers: {
        'X-User-ID': 'typed-user',
        'X-User-Email': 'typed@example.com',
        'X-User-Role': 'admin',
      },
    })

    await doInstance.fetch(request)

    const user = doInstance.user
    expect(user).not.toBeNull()

    if (user) {
      // Type assertions - these should compile
      const id: string = user.id
      const email: string | undefined = user.email
      const role: string | undefined = user.role

      expect(id).toBe('typed-user')
      expect(email).toBe('typed@example.com')
      expect(role).toBe('admin')
    }
  })
})
