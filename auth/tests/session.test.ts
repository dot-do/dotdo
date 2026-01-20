import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import {
  createSession,
  getSession,
  invalidateSession,
  refreshSession,
  clearAllSessions,
  configureSessionStorage,
  resetSessionStorage,
  type Session,
  type SessionOptions,
} from '../session'
import { SharedMemoryStorage } from '../../db/adapters/memory'

describe('Session Management', () => {
  let app: Hono
  const mockUserId = 'user-123'
  const defaultOptions: SessionOptions = {
    maxAge: 3600, // 1 hour
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
  }

  beforeEach(async () => {
    app = new Hono()
    vi.clearAllMocks()
    await clearAllSessions() // Clear all sessions before each test
  })

  describe('createSession', () => {
    it('should create a new session with valid data', async () => {
      const session = await createSession(mockUserId, {
        email: 'test@example.com',
        roles: ['user'],
      })

      expect(session).toBeDefined()
      expect(session.id).toBeDefined()
      expect(session.userId).toBe(mockUserId)
      expect(session.data.email).toBe('test@example.com')
      expect(session.data.roles).toEqual(['user'])
      expect(session.createdAt).toBeDefined()
      expect(session.expiresAt).toBeDefined()
      expect(session.expiresAt).toBeGreaterThan(session.createdAt)
    })

    it('should create session with custom expiry', async () => {
      const now = Date.now()
      const session = await createSession(mockUserId, {}, { maxAge: 7200 })

      const expectedExpiry = now + 7200 * 1000
      expect(session.expiresAt).toBeGreaterThanOrEqual(expectedExpiry - 100)
      expect(session.expiresAt).toBeLessThanOrEqual(expectedExpiry + 100)
    })

    it('should include session metadata', async () => {
      const session = await createSession(
        mockUserId,
        {},
        {
          metadata: {
            ip: '127.0.0.1',
            userAgent: 'Mozilla/5.0',
          },
        }
      )

      expect(session.metadata).toBeDefined()
      expect(session.metadata?.ip).toBe('127.0.0.1')
      expect(session.metadata?.userAgent).toBe('Mozilla/5.0')
    })

    it('should generate unique session IDs', async () => {
      const session1 = await createSession(mockUserId, {})
      const session2 = await createSession(mockUserId, {})

      expect(session1.id).not.toBe(session2.id)
    })
  })

  describe('getSession', () => {
    it('should return null when no session exists', async () => {
      const session = await getSession('non-existent-id')
      expect(session).toBeNull()
    })

    it('should return session data when valid session exists', async () => {
      const created = await createSession(mockUserId, {
        email: 'test@example.com',
      })

      const retrieved = await getSession(created.id)

      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe(created.id)
      expect(retrieved?.userId).toBe(mockUserId)
      expect(retrieved?.data.email).toBe('test@example.com')
    })

    it('should return null for expired sessions', async () => {
      const created = await createSession(mockUserId, {}, { maxAge: -1 })

      const retrieved = await getSession(created.id)
      expect(retrieved).toBeNull()
    })

    it('should update lastAccessedAt on retrieval', async () => {
      const created = await createSession(mockUserId, {})

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 50))

      const retrieved = await getSession(created.id)

      expect(retrieved).toBeDefined()
      expect(retrieved!.lastAccessedAt).toBeGreaterThanOrEqual(
        created.lastAccessedAt
      )
    })
  })

  describe('invalidateSession', () => {
    it('should remove session from storage', async () => {
      const created = await createSession(mockUserId, {})

      const success = await invalidateSession(created.id)
      expect(success).toBe(true)

      const retrieved = await getSession(created.id)
      expect(retrieved).toBeNull()
    })

    it('should return false for non-existent session', async () => {
      const success = await invalidateSession('non-existent-id')
      expect(success).toBe(false)
    })

    it('should invalidate all user sessions when userId provided', async () => {
      const session1 = await createSession(mockUserId, {})
      const session2 = await createSession(mockUserId, {})
      const session3 = await createSession('other-user', {})

      const count = await invalidateSession(null, mockUserId)
      expect(count).toBe(2)

      const retrieved1 = await getSession(session1.id)
      const retrieved2 = await getSession(session2.id)
      const retrieved3 = await getSession(session3.id)

      expect(retrieved1).toBeNull()
      expect(retrieved2).toBeNull()
      expect(retrieved3).toBeDefined() // Other user's session still exists
    })
  })

  describe('refreshSession', () => {
    it('should extend session expiry', async () => {
      const created = await createSession(mockUserId, {}, { maxAge: 3600 })

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 50))

      const refreshed = await refreshSession(created.id)

      expect(refreshed).toBeDefined()
      expect(refreshed?.expiresAt).toBeGreaterThanOrEqual(created.expiresAt)
    })

    it('should return null for non-existent session', async () => {
      const refreshed = await refreshSession('non-existent-id')
      expect(refreshed).toBeNull()
    })

    it('should return null for already expired session', async () => {
      const created = await createSession(mockUserId, {}, { maxAge: -1 })

      const refreshed = await refreshSession(created.id)
      expect(refreshed).toBeNull()
    })

    it('should update session data if provided', async () => {
      const created = await createSession(mockUserId, { count: 0 })

      const refreshed = await refreshSession(created.id, { count: 1 })

      expect(refreshed).toBeDefined()
      expect(refreshed?.data.count).toBe(1)
    })

    it('should implement sliding window expiration', async () => {
      const created = await createSession(mockUserId, {}, { maxAge: 3600 })

      const initialExpiry = created.expiresAt

      // Access session multiple times
      await getSession(created.id)
      await new Promise((resolve) => setTimeout(resolve, 10))
      const retrieved = await getSession(created.id)

      // With sliding window, expiry should be extended on access
      expect(retrieved!.expiresAt).toBeGreaterThan(initialExpiry)
    })
  })

  describe('Session Metadata', () => {
    it('should track session creation metadata', async () => {
      const session = await createSession(
        mockUserId,
        {},
        {
          metadata: {
            ip: '192.168.1.1',
            userAgent: 'Test Browser',
            device: 'Desktop',
          },
        }
      )

      expect(session.metadata?.ip).toBe('192.168.1.1')
      expect(session.metadata?.userAgent).toBe('Test Browser')
      expect(session.metadata?.device).toBe('Desktop')
    })

    it('should update metadata on refresh', async () => {
      const created = await createSession(
        mockUserId,
        {},
        { metadata: { ip: '192.168.1.1' } }
      )

      const refreshed = await refreshSession(created.id, undefined, {
        metadata: { ip: '192.168.1.2' },
      })

      expect(refreshed?.metadata?.ip).toBe('192.168.1.2')
    })
  })

  describe('Session Rotation', () => {
    it('should rotate session ID on sensitive operations', async () => {
      const created = await createSession(mockUserId, {})

      const rotated = await refreshSession(created.id, undefined, {
        rotate: true,
      })

      expect(rotated).toBeDefined()
      expect(rotated!.id).not.toBe(created.id)
      expect(rotated!.userId).toBe(created.userId)
      expect(rotated!.data).toEqual(created.data)

      // Old session should be invalidated
      const oldSession = await getSession(created.id)
      expect(oldSession).toBeNull()
    })
  })

  describe('Session Cleanup', () => {
    it('should remove expired sessions from storage', async () => {
      // Create expired session
      const expired = await createSession(mockUserId, {}, { maxAge: -1 })

      // Create valid session
      const valid = await createSession(mockUserId, {})

      // Import cleanup function (will be implemented)
      const { cleanupExpiredSessions } = await import('../session')
      const removed = await cleanupExpiredSessions()

      expect(removed).toBeGreaterThanOrEqual(1)

      // Expired session should be gone
      const retrievedExpired = await getSession(expired.id)
      expect(retrievedExpired).toBeNull()

      // Valid session should remain
      const retrievedValid = await getSession(valid.id)
      expect(retrievedValid).toBeDefined()
    })
  })
})

describe('Session Storage Persistence (do-qy75)', () => {
  const SHARED_STORAGE_NAME = 'session-persistence-test'
  const mockUserId = 'user-persist-123'

  beforeEach(() => {
    // Clear shared storage before each test
    SharedMemoryStorage.clear(SHARED_STORAGE_NAME)
  })

  afterEach(() => {
    // Reset to default in-memory adapter
    resetSessionStorage()
    SharedMemoryStorage.clear(SHARED_STORAGE_NAME)
  })

  it('should persist sessions across storage adapter instances (simulating DO restart)', async () => {
    // Configure first "DO instance" with shared storage
    const adapter1 = SharedMemoryStorage.createAdapter(SHARED_STORAGE_NAME)
    configureSessionStorage({ adapter: adapter1 })

    // Create a session in the first "DO instance"
    const created = await createSession(mockUserId, {
      email: 'persist@example.com',
      role: 'admin',
    })
    expect(created.id).toBeDefined()

    // Simulate DO restart by creating a new adapter pointing to the same shared storage
    const adapter2 = SharedMemoryStorage.createAdapter(SHARED_STORAGE_NAME)
    configureSessionStorage({ adapter: adapter2 })

    // Session should still be retrievable after "restart"
    const retrieved = await getSession(created.id, { slidingWindow: false })

    expect(retrieved).toBeDefined()
    expect(retrieved?.id).toBe(created.id)
    expect(retrieved?.userId).toBe(mockUserId)
    expect(retrieved?.data.email).toBe('persist@example.com')
    expect(retrieved?.data.role).toBe('admin')
  })

  it('should persist user session index across adapter instances', async () => {
    // Configure with shared storage
    const adapter1 = SharedMemoryStorage.createAdapter(SHARED_STORAGE_NAME)
    configureSessionStorage({ adapter: adapter1 })

    // Create multiple sessions for the same user
    const session1 = await createSession(mockUserId, { device: 'laptop' })
    const session2 = await createSession(mockUserId, { device: 'phone' })

    // Simulate restart
    const adapter2 = SharedMemoryStorage.createAdapter(SHARED_STORAGE_NAME)
    configureSessionStorage({ adapter: adapter2 })

    // Invalidate all sessions for user should still work
    const count = await invalidateSession(null, mockUserId)
    expect(count).toBe(2)

    // Both sessions should be gone
    const retrieved1 = await getSession(session1.id)
    const retrieved2 = await getSession(session2.id)
    expect(retrieved1).toBeNull()
    expect(retrieved2).toBeNull()
  })

  it('should support custom storage adapter configuration', async () => {
    const adapter = SharedMemoryStorage.createAdapter(SHARED_STORAGE_NAME)
    configureSessionStorage({ adapter })

    const session = await createSession(mockUserId, { custom: true })
    const retrieved = await getSession(session.id, { slidingWindow: false })

    expect(retrieved).toBeDefined()
    expect(retrieved?.data.custom).toBe(true)
  })

  it('should isolate sessions between different storage instances', async () => {
    const STORAGE_A = 'session-storage-a'
    const STORAGE_B = 'session-storage-b'

    // Create session in storage A
    const adapterA = SharedMemoryStorage.createAdapter(STORAGE_A)
    configureSessionStorage({ adapter: adapterA })
    const sessionA = await createSession('user-a', { store: 'A' })

    // Create session in storage B
    const adapterB = SharedMemoryStorage.createAdapter(STORAGE_B)
    configureSessionStorage({ adapter: adapterB })
    const sessionB = await createSession('user-b', { store: 'B' })

    // Session A should not be accessible from storage B
    const retrievedA = await getSession(sessionA.id)
    expect(retrievedA).toBeNull()

    // Session B should be accessible
    const retrievedB = await getSession(sessionB.id, { slidingWindow: false })
    expect(retrievedB).toBeDefined()
    expect(retrievedB?.data.store).toBe('B')

    // Clean up
    SharedMemoryStorage.clear(STORAGE_A)
    SharedMemoryStorage.clear(STORAGE_B)
  })
})
