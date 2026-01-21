import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import {
  createSession,
  getSession,
  invalidateSession,
  refreshSession,
  clearAllSessions,
  cleanupExpiredSessions,
  getUserSessions,
  type Session,
  type SessionOptions,
} from '../session'

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

      const removed = await cleanupExpiredSessions()

      expect(removed).toBeGreaterThanOrEqual(1)

      // Expired session should be gone
      const retrievedExpired = await getSession(expired.id)
      expect(retrievedExpired).toBeNull()

      // Valid session should remain
      const retrievedValid = await getSession(valid.id)
      expect(retrievedValid).toBeDefined()
    })

    it('should return 0 when no expired sessions exist', async () => {
      // Create only valid sessions
      await createSession(mockUserId, {})
      await createSession(mockUserId, {})

      const removed = await cleanupExpiredSessions()
      expect(removed).toBe(0)
    })

    it('should handle empty session store', async () => {
      const removed = await cleanupExpiredSessions()
      expect(removed).toBe(0)
    })
  })

  describe('Session Expiry Edge Cases', () => {
    it('should handle session that expires exactly at current time', async () => {
      // Create a session with very short maxAge
      const session = await createSession(mockUserId, {}, { maxAge: 0 })

      // Session should be considered expired (expiresAt <= now)
      const retrieved = await getSession(session.id)
      expect(retrieved).toBeNull()
    })

    it('should handle session expiry just after creation', async () => {
      // Create session with 1ms expiry
      const session = await createSession(mockUserId, {}, { maxAge: 0.001 })

      // Wait a tiny bit
      await new Promise((resolve) => setTimeout(resolve, 5))

      const retrieved = await getSession(session.id)
      expect(retrieved).toBeNull()
    })

    it('should auto-invalidate expired session on getSession', async () => {
      const session = await createSession(mockUserId, {}, { maxAge: -1 })

      // Trying to get expired session should return null and invalidate it
      const retrieved = await getSession(session.id)
      expect(retrieved).toBeNull()

      // Verify it was actually invalidated (not just hidden)
      // by checking user sessions count
      const userSessions = await getUserSessions(mockUserId)
      expect(userSessions.find((s) => s.id === session.id)).toBeUndefined()
    })

    it('should not extend expiry when slidingWindow is false', async () => {
      const session = await createSession(mockUserId, {}, { maxAge: 3600 })
      const originalExpiry = session.expiresAt

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Get session with sliding window disabled
      const retrieved = await getSession(session.id, { slidingWindow: false })

      expect(retrieved).toBeDefined()
      expect(retrieved!.expiresAt).toBe(originalExpiry)
    })

    it('should extend expiry with custom maxAge in getSession', async () => {
      const session = await createSession(mockUserId, {}, { maxAge: 3600 })
      const originalExpiry = session.expiresAt

      await new Promise((resolve) => setTimeout(resolve, 10))

      // Get session with larger maxAge
      const retrieved = await getSession(session.id, { maxAge: 7200 })

      expect(retrieved).toBeDefined()
      // New expiry should be based on the new maxAge
      expect(retrieved!.expiresAt).toBeGreaterThan(originalExpiry)
    })
  })

  describe('Refresh Token Flows', () => {
    it('should refresh session and merge new data with existing data', async () => {
      const session = await createSession(mockUserId, {
        email: 'test@example.com',
        role: 'user',
      })

      const refreshed = await refreshSession(session.id, {
        role: 'admin',
        newField: 'value',
      })

      expect(refreshed).toBeDefined()
      expect(refreshed!.data.email).toBe('test@example.com') // preserved
      expect(refreshed!.data.role).toBe('admin') // overwritten
      expect(refreshed!.data.newField).toBe('value') // added
    })

    it('should refresh session and merge new metadata with existing', async () => {
      const session = await createSession(
        mockUserId,
        {},
        {
          metadata: {
            ip: '192.168.1.1',
            userAgent: 'Chrome',
          },
        }
      )

      const refreshed = await refreshSession(session.id, undefined, {
        metadata: {
          ip: '192.168.1.2', // new IP
          device: 'mobile', // new field
        },
      })

      expect(refreshed).toBeDefined()
      expect(refreshed!.metadata?.ip).toBe('192.168.1.2')
      expect(refreshed!.metadata?.userAgent).toBe('Chrome') // preserved
      expect(refreshed!.metadata?.device).toBe('mobile') // added
    })

    it('should refresh session with custom maxAge', async () => {
      const session = await createSession(mockUserId, {}, { maxAge: 3600 })

      await new Promise((resolve) => setTimeout(resolve, 10))

      const refreshed = await refreshSession(session.id, undefined, {
        maxAge: 7200,
      })

      expect(refreshed).toBeDefined()
      // New expiry should be approximately now + 7200 seconds
      const expectedExpiry = Date.now() + 7200 * 1000
      // Use >= because refresh might happen at same millisecond
      expect(refreshed!.expiresAt).toBeGreaterThanOrEqual(session.expiresAt)
      expect(refreshed!.expiresAt).toBeLessThanOrEqual(expectedExpiry + 100)
      expect(refreshed!.expiresAt).toBeGreaterThanOrEqual(expectedExpiry - 100)
    })

    it('should update lastAccessedAt on refresh', async () => {
      const session = await createSession(mockUserId, {})
      const originalLastAccessed = session.lastAccessedAt

      await new Promise((resolve) => setTimeout(resolve, 10))

      const refreshed = await refreshSession(session.id)

      expect(refreshed).toBeDefined()
      expect(refreshed!.lastAccessedAt).toBeGreaterThan(originalLastAccessed)
    })

    it('should handle refresh with empty data object', async () => {
      const session = await createSession(mockUserId, {
        existing: 'data',
      })

      const refreshed = await refreshSession(session.id, {})

      expect(refreshed).toBeDefined()
      expect(refreshed!.data.existing).toBe('data') // preserved
    })

    it('should preserve data when refreshing with undefined data', async () => {
      const session = await createSession(mockUserId, {
        existing: 'data',
      })

      const refreshed = await refreshSession(session.id)

      expect(refreshed).toBeDefined()
      expect(refreshed!.data.existing).toBe('data')
    })

    it('should not refresh already expired session', async () => {
      const session = await createSession(mockUserId, {}, { maxAge: -1 })

      const refreshed = await refreshSession(session.id, { newData: 'value' })

      expect(refreshed).toBeNull()
    })
  })

  describe('Session Rotation Edge Cases', () => {
    it('should preserve session data during rotation', async () => {
      const session = await createSession(mockUserId, {
        important: 'data',
        count: 42,
      })

      const rotated = await refreshSession(session.id, undefined, {
        rotate: true,
      })

      expect(rotated).toBeDefined()
      expect(rotated!.data.important).toBe('data')
      expect(rotated!.data.count).toBe(42)
    })

    it('should preserve metadata during rotation', async () => {
      const session = await createSession(
        mockUserId,
        {},
        {
          metadata: {
            ip: '192.168.1.1',
            userAgent: 'Firefox',
          },
        }
      )

      const rotated = await refreshSession(session.id, undefined, {
        rotate: true,
      })

      expect(rotated).toBeDefined()
      expect(rotated!.metadata?.ip).toBe('192.168.1.1')
      expect(rotated!.metadata?.userAgent).toBe('Firefox')
    })

    it('should update data and metadata during rotation', async () => {
      const session = await createSession(
        mockUserId,
        { role: 'user' },
        { metadata: { ip: '192.168.1.1' } }
      )

      const rotated = await refreshSession(
        session.id,
        { role: 'admin' },
        {
          rotate: true,
          metadata: { ip: '10.0.0.1' },
        }
      )

      expect(rotated).toBeDefined()
      expect(rotated!.id).not.toBe(session.id)
      expect(rotated!.data.role).toBe('admin')
      expect(rotated!.metadata?.ip).toBe('10.0.0.1')
    })

    it('should reset createdAt on rotation', async () => {
      const session = await createSession(mockUserId, {})
      const originalCreatedAt = session.createdAt

      await new Promise((resolve) => setTimeout(resolve, 10))

      const rotated = await refreshSession(session.id, undefined, {
        rotate: true,
      })

      expect(rotated).toBeDefined()
      expect(rotated!.createdAt).toBeGreaterThan(originalCreatedAt)
    })

    it('should add rotated session to user sessions tracking', async () => {
      const session = await createSession(mockUserId, {})

      const rotated = await refreshSession(session.id, undefined, {
        rotate: true,
      })

      expect(rotated).toBeDefined()

      const userSessions = await getUserSessions(mockUserId)
      expect(userSessions.length).toBe(1)
      expect(userSessions[0].id).toBe(rotated!.id)
    })
  })

  describe('getUserSessions', () => {
    it('should return empty array for user with no sessions', async () => {
      const sessions = await getUserSessions('nonexistent-user')
      expect(sessions).toEqual([])
    })

    it('should return all active sessions for a user', async () => {
      const session1 = await createSession(mockUserId, { name: 'session1' })
      const session2 = await createSession(mockUserId, { name: 'session2' })
      const session3 = await createSession(mockUserId, { name: 'session3' })

      const sessions = await getUserSessions(mockUserId)

      expect(sessions.length).toBe(3)
      expect(sessions.map((s) => s.id)).toContain(session1.id)
      expect(sessions.map((s) => s.id)).toContain(session2.id)
      expect(sessions.map((s) => s.id)).toContain(session3.id)
    })

    it('should exclude expired sessions from results', async () => {
      const valid = await createSession(mockUserId, { name: 'valid' })
      await createSession(mockUserId, { name: 'expired' }, { maxAge: -1 })

      const sessions = await getUserSessions(mockUserId)

      expect(sessions.length).toBe(1)
      expect(sessions[0].id).toBe(valid.id)
    })

    it('should not include other users sessions', async () => {
      await createSession(mockUserId, { name: 'my-session' })
      await createSession('other-user', { name: 'other-session' })

      const mySessions = await getUserSessions(mockUserId)
      const otherSessions = await getUserSessions('other-user')

      expect(mySessions.length).toBe(1)
      expect(mySessions[0].data.name).toBe('my-session')
      expect(otherSessions.length).toBe(1)
      expect(otherSessions[0].data.name).toBe('other-session')
    })

    it('should return sessions with full data', async () => {
      const session = await createSession(
        mockUserId,
        { email: 'test@example.com', role: 'admin' },
        { metadata: { ip: '127.0.0.1' } }
      )

      const sessions = await getUserSessions(mockUserId)

      expect(sessions.length).toBe(1)
      expect(sessions[0].id).toBe(session.id)
      expect(sessions[0].userId).toBe(mockUserId)
      expect(sessions[0].data.email).toBe('test@example.com')
      expect(sessions[0].metadata?.ip).toBe('127.0.0.1')
    })
  })

  describe('Edge Cases', () => {
    it('should handle session with empty userId', async () => {
      const session = await createSession('', { data: 'value' })

      expect(session).toBeDefined()
      expect(session.userId).toBe('')
      expect(session.id).toBeDefined()

      const retrieved = await getSession(session.id)
      expect(retrieved).toBeDefined()
      expect(retrieved!.userId).toBe('')
    })

    it('should handle session with empty data object', async () => {
      const session = await createSession(mockUserId, {})

      expect(session).toBeDefined()
      expect(session.data).toEqual({})
    })

    it('should handle session with complex nested data', async () => {
      const complexData = {
        user: {
          profile: {
            name: 'Test',
            settings: {
              theme: 'dark',
              notifications: ['email', 'push'],
            },
          },
        },
        permissions: ['read', 'write'],
        metadata: null,
      }

      const session = await createSession(mockUserId, complexData)

      expect(session.data).toEqual(complexData)

      const retrieved = await getSession(session.id)
      expect(retrieved!.data).toEqual(complexData)
    })

    it('should handle multiple invalidate calls for same session', async () => {
      const session = await createSession(mockUserId, {})

      const first = await invalidateSession(session.id)
      const second = await invalidateSession(session.id)

      expect(first).toBe(true)
      expect(second).toBe(false)
    })

    it('should handle invalidateSession with null sessionId and no userId', async () => {
      const result = await invalidateSession(null)
      expect(result).toBe(false)
    })

    it('should handle invalidateSession for user with no sessions', async () => {
      const count = await invalidateSession(null, 'nonexistent-user')
      expect(count).toBe(0)
    })

    it('should handle very long maxAge values', async () => {
      const oneYear = 365 * 24 * 60 * 60 // seconds
      const session = await createSession(mockUserId, {}, { maxAge: oneYear })

      const expectedExpiry = Date.now() + oneYear * 1000
      expect(session.expiresAt).toBeGreaterThanOrEqual(expectedExpiry - 100)
      expect(session.expiresAt).toBeLessThanOrEqual(expectedExpiry + 100)

      const retrieved = await getSession(session.id)
      expect(retrieved).toBeDefined()
    })

    it('should handle very short positive maxAge', async () => {
      const session = await createSession(mockUserId, {}, { maxAge: 1 }) // 1 second

      // Should be valid immediately (use slidingWindow: false to avoid extending expiry)
      const retrieved = await getSession(session.id, { slidingWindow: false })
      expect(retrieved).toBeDefined()

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 1100))

      const expired = await getSession(session.id, { slidingWindow: false })
      expect(expired).toBeNull()
    })

    it('should handle concurrent session creation for same user', async () => {
      // Create multiple sessions concurrently
      const promises = Array.from({ length: 5 }, (_, i) =>
        createSession(mockUserId, { index: i })
      )

      const sessions = await Promise.all(promises)

      // All sessions should be unique
      const ids = sessions.map((s) => s.id)
      const uniqueIds = [...new Set(ids)]
      expect(uniqueIds.length).toBe(5)

      // All should be retrievable
      const userSessions = await getUserSessions(mockUserId)
      expect(userSessions.length).toBe(5)
    })

    it('should handle special characters in session data', async () => {
      const specialData = {
        emoji: '🔐',
        unicode: 'こんにちは',
        quotes: '"quotes" and \'apostrophes\'',
        html: '<script>alert("xss")</script>',
        newlines: 'line1\nline2\rline3',
      }

      const session = await createSession(mockUserId, specialData)
      const retrieved = await getSession(session.id)

      expect(retrieved!.data).toEqual(specialData)
    })

    it('should maintain session integrity after multiple refreshes', async () => {
      const session = await createSession(mockUserId, { count: 0 })

      // Refresh multiple times with data updates
      let current = session
      for (let i = 1; i <= 5; i++) {
        const refreshed = await refreshSession(current.id, { count: i })
        expect(refreshed).toBeDefined()
        expect(refreshed!.data.count).toBe(i)
        current = refreshed!
      }

      const final = await getSession(current.id)
      expect(final!.data.count).toBe(5)
    })
  })

  describe('clearAllSessions', () => {
    it('should clear all sessions from storage', async () => {
      await createSession(mockUserId, {})
      await createSession(mockUserId, {})
      await createSession('other-user', {})

      await clearAllSessions()

      const userSessions = await getUserSessions(mockUserId)
      const otherSessions = await getUserSessions('other-user')

      expect(userSessions.length).toBe(0)
      expect(otherSessions.length).toBe(0)
    })

    it('should handle clearing empty session store', async () => {
      await clearAllSessions()

      // Should not throw
      const sessions = await getUserSessions(mockUserId)
      expect(sessions).toEqual([])
    })
  })
})
