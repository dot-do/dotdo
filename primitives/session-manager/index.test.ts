/**
 * SessionManager Tests - TDD Red-Green-Refactor
 *
 * Comprehensive tests for session management primitives
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  SessionManager,
  MemoryStore,
  TokenGenerator,
  TokenValidator,
  RollingSession,
  SessionCleaner,
  ConcurrentSessionLimiter,
} from './index'
import type {
  Session,
  SessionConfig,
  SessionData,
  SessionToken,
  SessionStats,
  SessionStore,
} from './types'

// =============================================================================
// SessionManager Tests
// =============================================================================

describe('SessionManager', () => {
  let store: MemoryStore
  let manager: SessionManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    store = new MemoryStore()
    manager = new SessionManager({ ttl: 3600000 }, store) // 1 hour TTL
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('create and retrieve session', () => {
    it('should create a new session', async () => {
      const result = await manager.create('user:123', { role: 'admin' })

      expect(result.session).toBeDefined()
      expect(result.session.id).toBeDefined()
      expect(result.session.userId).toBe('user:123')
      expect(result.session.data.role).toBe('admin')
      expect(result.token).toBeDefined()
    })

    it('should retrieve session by ID', async () => {
      const { session } = await manager.create('user:123', { role: 'admin' })

      const retrieved = await manager.get(session.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(session.id)
      expect(retrieved?.userId).toBe('user:123')
      expect(retrieved?.data.role).toBe('admin')
    })

    it('should return null for non-existent session', async () => {
      const result = await manager.get('non-existent-id')
      expect(result).toBeNull()
    })

    it('should set correct timestamps on creation', async () => {
      const now = Date.now()
      const { session } = await manager.create('user:123')

      expect(session.createdAt).toBe(now)
      expect(session.lastAccessedAt).toBe(now)
      expect(session.expiresAt).toBe(now + 3600000)
    })
  })

  describe('session expiration', () => {
    it('should return null for expired session', async () => {
      const { session } = await manager.create('user:123')

      // Advance time past expiration
      vi.advanceTimersByTime(3600001)

      const retrieved = await manager.get(session.id)
      expect(retrieved).toBeNull()
    })

    it('should not return expired sessions in getUserSessions', async () => {
      await manager.create('user:123')
      await manager.create('user:123')

      // Advance time past expiration
      vi.advanceTimersByTime(3600001)

      const sessions = await manager.getUserSessions('user:123')
      expect(sessions).toHaveLength(0)
    })
  })

  describe('rolling session extension', () => {
    it('should extend TTL on touch when rolling is enabled', async () => {
      const rollingManager = new SessionManager({ ttl: 3600000, rolling: true }, store)
      const { session } = await rollingManager.create('user:123')

      // Advance time 30 minutes
      vi.advanceTimersByTime(1800000)

      const touched = await rollingManager.touch(session.id)

      expect(touched).not.toBeNull()
      expect(touched?.expiresAt).toBe(Date.now() + 3600000)
      expect(touched?.lastAccessedAt).toBe(Date.now())
    })

    it('should not extend TTL on touch when rolling is disabled', async () => {
      const { session } = await manager.create('user:123')
      const originalExpiresAt = session.expiresAt

      // Advance time 30 minutes
      vi.advanceTimersByTime(1800000)

      const touched = await manager.touch(session.id)

      expect(touched).not.toBeNull()
      expect(touched?.expiresAt).toBe(originalExpiresAt)
      expect(touched?.lastAccessedAt).toBe(Date.now())
    })
  })

  describe('update session data', () => {
    it('should update session data', async () => {
      const { session } = await manager.create('user:123', { role: 'user' })

      const updated = await manager.update(session.id, { role: 'admin', name: 'Test' })

      expect(updated).not.toBeNull()
      expect(updated?.data.role).toBe('admin')
      expect(updated?.data.name).toBe('Test')
    })

    it('should return null when updating non-existent session', async () => {
      const result = await manager.update('non-existent', { role: 'admin' })
      expect(result).toBeNull()
    })

    it('should preserve existing data when updating partially', async () => {
      const { session } = await manager.create('user:123', { role: 'user', count: 5 })

      const updated = await manager.update(session.id, { count: 10 })

      expect(updated?.data.role).toBe('user')
      expect(updated?.data.count).toBe(10)
    })
  })

  describe('destroy session', () => {
    it('should destroy a session', async () => {
      const { session } = await manager.create('user:123')

      await manager.destroy(session.id)

      const retrieved = await manager.get(session.id)
      expect(retrieved).toBeNull()
    })

    it('should not throw when destroying non-existent session', async () => {
      await expect(manager.destroy('non-existent')).resolves.not.toThrow()
    })
  })

  describe('get user sessions', () => {
    it('should get all sessions for a user', async () => {
      await manager.create('user:123')
      await manager.create('user:123')
      await manager.create('user:456')

      const sessions = await manager.getUserSessions('user:123')

      expect(sessions).toHaveLength(2)
      expect(sessions.every(s => s.userId === 'user:123')).toBe(true)
    })

    it('should return empty array for user with no sessions', async () => {
      const sessions = await manager.getUserSessions('user:no-sessions')
      expect(sessions).toHaveLength(0)
    })
  })

  describe('destroy all user sessions', () => {
    it('should destroy all sessions for a user', async () => {
      await manager.create('user:123')
      await manager.create('user:123')
      await manager.create('user:456')

      await manager.destroyUserSessions('user:123')

      const user123Sessions = await manager.getUserSessions('user:123')
      const user456Sessions = await manager.getUserSessions('user:456')

      expect(user123Sessions).toHaveLength(0)
      expect(user456Sessions).toHaveLength(1)
    })
  })

  describe('session statistics', () => {
    it('should return correct statistics', async () => {
      await manager.create('user:123')
      await manager.create('user:123')
      await manager.create('user:456')

      const stats = await manager.getStats()

      expect(stats.active).toBe(3)
      expect(stats.expired).toBe(0)
      expect(stats.total).toBe(3)
    })

    it('should count expired sessions correctly', async () => {
      await manager.create('user:123')
      await manager.create('user:456')

      // Advance time past expiration
      vi.advanceTimersByTime(3600001)

      await manager.create('user:789') // Create after expiration

      const stats = await manager.getStats()

      expect(stats.active).toBe(1)
      expect(stats.expired).toBe(2)
      expect(stats.total).toBe(3)
    })
  })
})

// =============================================================================
// Token Generation and Validation Tests
// =============================================================================

describe('TokenGenerator', () => {
  let generator: TokenGenerator

  beforeEach(() => {
    generator = new TokenGenerator('my-secret-key')
  })

  describe('token generation', () => {
    it('should generate a valid token', () => {
      const token = generator.generate('session-123')

      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(0)
    })

    it('should generate different tokens for different session IDs', () => {
      const token1 = generator.generate('session-1')
      const token2 = generator.generate('session-2')

      expect(token1).not.toBe(token2)
    })

    it('should generate consistent tokens for same session ID', () => {
      const token1 = generator.generate('session-123')
      const token2 = generator.generate('session-123')

      expect(token1).toBe(token2)
    })
  })

  describe('token parsing', () => {
    it('should parse a valid token', () => {
      const token = generator.generate('session-123')
      const parsed = generator.parse(token)

      expect(parsed).not.toBeNull()
      expect(parsed?.id).toBe('session-123')
      expect(parsed?.signature).toBeDefined()
    })

    it('should return null for invalid token format', () => {
      const parsed = generator.parse('invalid-token')
      expect(parsed).toBeNull()
    })

    it('should return null for empty token', () => {
      const parsed = generator.parse('')
      expect(parsed).toBeNull()
    })
  })

  describe('token validation', () => {
    it('should validate a valid token', () => {
      const token = generator.generate('session-123')
      const isValid = generator.validate(token)

      expect(isValid).toBe(true)
    })

    it('should reject token with tampered signature', () => {
      const token = generator.generate('session-123')
      const [id] = token.split('.')
      const tamperedToken = `${id}.tampered-signature`

      const isValid = generator.validate(tamperedToken)
      expect(isValid).toBe(false)
    })

    it('should reject token with tampered session ID', () => {
      const token = generator.generate('session-123')
      const [, signature] = token.split('.')
      const tamperedToken = `different-session.${signature}`

      const isValid = generator.validate(tamperedToken)
      expect(isValid).toBe(false)
    })

    it('should reject invalid token format', () => {
      const isValid = generator.validate('not-a-valid-token')
      expect(isValid).toBe(false)
    })
  })
})

describe('TokenValidator', () => {
  let generator: TokenGenerator
  let validator: TokenValidator

  beforeEach(() => {
    generator = new TokenGenerator('my-secret-key')
    validator = new TokenValidator('my-secret-key')
  })

  it('should validate tokens from the same secret', () => {
    const token = generator.generate('session-123')
    const isValid = validator.validate(token)

    expect(isValid).toBe(true)
  })

  it('should reject tokens from different secret', () => {
    const otherGenerator = new TokenGenerator('different-secret')
    const token = otherGenerator.generate('session-123')

    const isValid = validator.validate(token)
    expect(isValid).toBe(false)
  })

  it('should parse and validate in one step', () => {
    const token = generator.generate('session-123')
    const parsed = validator.validateAndParse(token)

    expect(parsed).not.toBeNull()
    expect(parsed?.id).toBe('session-123')
  })

  it('should return null for invalid token in validateAndParse', () => {
    const parsed = validator.validateAndParse('invalid.token')
    expect(parsed).toBeNull()
  })
})

// =============================================================================
// Invalid Token Handling Tests
// =============================================================================

describe('Invalid Token Handling', () => {
  let store: MemoryStore
  let manager: SessionManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    store = new MemoryStore()
    manager = new SessionManager({ ttl: 3600000 }, store, 'test-secret')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return null for invalid token', async () => {
    const result = await manager.validateToken('invalid-token')
    expect(result).toBeNull()
  })

  it('should return null for tampered token', async () => {
    const { token } = await manager.create('user:123')
    const [id] = token.split('.')
    const tamperedToken = `${id}.fake-signature`

    const result = await manager.validateToken(tamperedToken)
    expect(result).toBeNull()
  })

  it('should return null for token with non-existent session', async () => {
    const generator = new TokenGenerator('test-secret')
    const fakeToken = generator.generate('non-existent-session')

    const result = await manager.validateToken(fakeToken)
    expect(result).toBeNull()
  })

  it('should return null for expired session token', async () => {
    const { token } = await manager.create('user:123')

    vi.advanceTimersByTime(3600001)

    const result = await manager.validateToken(token)
    expect(result).toBeNull()
  })

  it('should return session for valid token', async () => {
    const { session, token } = await manager.create('user:123', { role: 'admin' })

    const result = await manager.validateToken(token)

    expect(result).not.toBeNull()
    expect(result?.id).toBe(session.id)
    expect(result?.userId).toBe('user:123')
  })
})

// =============================================================================
// MemoryStore Tests
// =============================================================================

describe('MemoryStore', () => {
  let store: MemoryStore

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    store = new MemoryStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should set and get session', async () => {
    const session: Session = {
      id: 'session-123',
      userId: 'user:123',
      data: { role: 'admin' },
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      lastAccessedAt: Date.now(),
    }

    await store.set(session)
    const retrieved = await store.get('session-123')

    expect(retrieved).not.toBeNull()
    expect(retrieved?.id).toBe('session-123')
    expect(retrieved?.data.role).toBe('admin')
  })

  it('should return null for non-existent session', async () => {
    const result = await store.get('non-existent')
    expect(result).toBeNull()
  })

  it('should delete session', async () => {
    const session: Session = {
      id: 'session-123',
      userId: 'user:123',
      data: {},
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      lastAccessedAt: Date.now(),
    }

    await store.set(session)
    await store.delete('session-123')

    const result = await store.get('session-123')
    expect(result).toBeNull()
  })

  it('should touch session and update lastAccessedAt', async () => {
    const session: Session = {
      id: 'session-123',
      userId: 'user:123',
      data: {},
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      lastAccessedAt: Date.now(),
    }

    await store.set(session)

    vi.advanceTimersByTime(1000)

    await store.touch('session-123')

    const retrieved = await store.get('session-123')
    expect(retrieved?.lastAccessedAt).toBe(Date.now())
  })

  it('should get user sessions', async () => {
    const session1: Session = {
      id: 'session-1',
      userId: 'user:123',
      data: {},
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      lastAccessedAt: Date.now(),
    }

    const session2: Session = {
      id: 'session-2',
      userId: 'user:123',
      data: {},
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      lastAccessedAt: Date.now(),
    }

    const session3: Session = {
      id: 'session-3',
      userId: 'user:456',
      data: {},
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      lastAccessedAt: Date.now(),
    }

    await store.set(session1)
    await store.set(session2)
    await store.set(session3)

    const sessions = await store.getUserSessions('user:123')

    expect(sessions).toHaveLength(2)
    expect(sessions.every(s => s.userId === 'user:123')).toBe(true)
  })

  it('should delete user sessions', async () => {
    const session1: Session = {
      id: 'session-1',
      userId: 'user:123',
      data: {},
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      lastAccessedAt: Date.now(),
    }

    const session2: Session = {
      id: 'session-2',
      userId: 'user:456',
      data: {},
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      lastAccessedAt: Date.now(),
    }

    await store.set(session1)
    await store.set(session2)

    await store.deleteUserSessions('user:123')

    const user123Sessions = await store.getUserSessions('user:123')
    const user456Sessions = await store.getUserSessions('user:456')

    expect(user123Sessions).toHaveLength(0)
    expect(user456Sessions).toHaveLength(1)
  })

  it('should get all sessions', async () => {
    const session1: Session = {
      id: 'session-1',
      userId: 'user:123',
      data: {},
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      lastAccessedAt: Date.now(),
    }

    const session2: Session = {
      id: 'session-2',
      userId: 'user:456',
      data: {},
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      lastAccessedAt: Date.now(),
    }

    await store.set(session1)
    await store.set(session2)

    const allSessions = await store.getAllSessions()
    expect(allSessions).toHaveLength(2)
  })
})

// =============================================================================
// RollingSession Tests
// =============================================================================

describe('RollingSession', () => {
  let store: MemoryStore
  let rollingSession: RollingSession

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    store = new MemoryStore()
    rollingSession = new RollingSession(store, 3600000) // 1 hour extension
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should extend session when activity detected', async () => {
    const session: Session = {
      id: 'session-123',
      userId: 'user:123',
      data: {},
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      lastAccessedAt: Date.now(),
    }

    await store.set(session)

    vi.advanceTimersByTime(1800000) // 30 minutes

    const extended = await rollingSession.maybeExtend(session)

    expect(extended.expiresAt).toBe(Date.now() + 3600000)
    expect(extended.lastAccessedAt).toBe(Date.now())
  })

  it('should not extend session if recently accessed', async () => {
    const now = Date.now()
    const session: Session = {
      id: 'session-123',
      userId: 'user:123',
      data: {},
      createdAt: now,
      expiresAt: now + 3600000,
      lastAccessedAt: now,
    }

    await store.set(session)

    // Only 1 second later
    vi.advanceTimersByTime(1000)

    const extended = await rollingSession.maybeExtend(session)

    // Should update lastAccessedAt but not extend expiration significantly
    expect(extended.lastAccessedAt).toBe(Date.now())
  })
})

// =============================================================================
// SessionCleaner Tests
// =============================================================================

describe('SessionCleaner', () => {
  let store: MemoryStore
  let cleaner: SessionCleaner

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    store = new MemoryStore()
    cleaner = new SessionCleaner(store)
  })

  afterEach(() => {
    cleaner.stopAutoClean()
    vi.useRealTimers()
  })

  it('should clean expired sessions', async () => {
    const expiredSession: Session = {
      id: 'expired-session',
      userId: 'user:123',
      data: {},
      createdAt: Date.now() - 7200000,
      expiresAt: Date.now() - 3600000, // Expired 1 hour ago
      lastAccessedAt: Date.now() - 7200000,
    }

    const validSession: Session = {
      id: 'valid-session',
      userId: 'user:456',
      data: {},
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      lastAccessedAt: Date.now(),
    }

    await store.set(expiredSession)
    await store.set(validSession)

    const cleanedCount = await cleaner.cleanExpired()

    expect(cleanedCount).toBe(1)

    const expired = await store.get('expired-session')
    const valid = await store.get('valid-session')

    expect(expired).toBeNull()
    expect(valid).not.toBeNull()
  })

  it('should run auto-clean at interval', async () => {
    const expiredSession: Session = {
      id: 'expired-session',
      userId: 'user:123',
      data: {},
      createdAt: Date.now(),
      expiresAt: Date.now() + 1000, // Expires in 1 second
      lastAccessedAt: Date.now(),
    }

    await store.set(expiredSession)

    // Start auto-clean every 500ms
    cleaner.startAutoClean(500)

    // Advance past expiration and cleanup interval
    vi.advanceTimersByTime(2000)

    const result = await store.get('expired-session')
    expect(result).toBeNull()
  })

  it('should stop auto-clean', async () => {
    cleaner.startAutoClean(100)
    cleaner.stopAutoClean()

    const expiredSession: Session = {
      id: 'expired-session',
      userId: 'user:123',
      data: {},
      createdAt: Date.now() - 7200000,
      expiresAt: Date.now() - 3600000,
      lastAccessedAt: Date.now() - 7200000,
    }

    await store.set(expiredSession)

    vi.advanceTimersByTime(1000)

    // Session should still exist since auto-clean is stopped
    const result = await store.get('expired-session')
    // Note: get() returns expired sessions from the raw store
    // The cleanup didn't run, so the session is still there
    const allSessions = await store.getAllSessions()
    expect(allSessions).toHaveLength(1)
  })
})

// =============================================================================
// ConcurrentSessionLimiter Tests
// =============================================================================

describe('ConcurrentSessionLimiter', () => {
  let store: MemoryStore
  let limiter: ConcurrentSessionLimiter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    store = new MemoryStore()
    limiter = new ConcurrentSessionLimiter(store, 3) // Max 3 sessions per user
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should allow creating sessions under limit', async () => {
    const session1: Session = {
      id: 'session-1',
      userId: 'user:123',
      data: {},
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      lastAccessedAt: Date.now(),
    }

    await store.set(session1)

    const canCreate = await limiter.canCreateSession('user:123')
    expect(canCreate).toBe(true)
  })

  it('should deny creating sessions at limit', async () => {
    for (let i = 1; i <= 3; i++) {
      const session: Session = {
        id: `session-${i}`,
        userId: 'user:123',
        data: {},
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        lastAccessedAt: Date.now(),
      }
      await store.set(session)
    }

    const canCreate = await limiter.canCreateSession('user:123')
    expect(canCreate).toBe(false)
  })

  it('should enforce limit by removing oldest sessions', async () => {
    for (let i = 1; i <= 3; i++) {
      const session: Session = {
        id: `session-${i}`,
        userId: 'user:123',
        data: {},
        createdAt: Date.now() + i * 1000, // Each session 1 second apart
        expiresAt: Date.now() + 3600000,
        lastAccessedAt: Date.now() + i * 1000,
      }
      await store.set(session)
    }

    // Add a 4th session (should trigger enforcement)
    const newSession: Session = {
      id: 'session-4',
      userId: 'user:123',
      data: {},
      createdAt: Date.now() + 4000,
      expiresAt: Date.now() + 3600000,
      lastAccessedAt: Date.now() + 4000,
    }
    await store.set(newSession)

    await limiter.enforceLimit('user:123')

    const sessions = await store.getUserSessions('user:123')
    expect(sessions).toHaveLength(3)

    // Oldest session should be removed
    const sessionIds = sessions.map(s => s.id)
    expect(sessionIds).not.toContain('session-1')
    expect(sessionIds).toContain('session-4')
  })

  it('should not affect other users', async () => {
    for (let i = 1; i <= 3; i++) {
      const session: Session = {
        id: `user123-session-${i}`,
        userId: 'user:123',
        data: {},
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        lastAccessedAt: Date.now(),
      }
      await store.set(session)
    }

    const canCreateUser123 = await limiter.canCreateSession('user:123')
    const canCreateUser456 = await limiter.canCreateSession('user:456')

    expect(canCreateUser123).toBe(false)
    expect(canCreateUser456).toBe(true)
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('SessionManager Integration', () => {
  let store: MemoryStore
  let manager: SessionManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    store = new MemoryStore()
    manager = new SessionManager(
      { ttl: 3600000, rolling: true, secure: true, sameSite: 'strict' },
      store,
      'integration-test-secret'
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should handle complete session lifecycle', async () => {
    // Create session
    const { session, token } = await manager.create('user:123', { cart: [] })
    expect(session.data.cart).toEqual([])

    // Update session
    const updated = await manager.update(session.id, { cart: ['item1', 'item2'] })
    expect(updated?.data.cart).toEqual(['item1', 'item2'])

    // Validate token
    const validated = await manager.validateToken(token)
    expect(validated?.id).toBe(session.id)

    // Touch session
    vi.advanceTimersByTime(1800000)
    const touched = await manager.touch(session.id)
    expect(touched?.expiresAt).toBe(Date.now() + 3600000)

    // Destroy session
    await manager.destroy(session.id)
    const destroyed = await manager.get(session.id)
    expect(destroyed).toBeNull()
  })

  it('should handle multi-device logout', async () => {
    // Create multiple sessions for same user (different devices)
    await manager.create('user:123', { device: 'phone' })
    await manager.create('user:123', { device: 'tablet' })
    await manager.create('user:123', { device: 'laptop' })

    const sessionsBeforeLogout = await manager.getUserSessions('user:123')
    expect(sessionsBeforeLogout).toHaveLength(3)

    // Logout all devices
    await manager.destroyUserSessions('user:123')

    const sessionsAfterLogout = await manager.getUserSessions('user:123')
    expect(sessionsAfterLogout).toHaveLength(0)
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe('Edge Cases', () => {
  let store: MemoryStore
  let manager: SessionManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    store = new MemoryStore()
    manager = new SessionManager({ ttl: 3600000 }, store)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should handle empty session data', async () => {
    const { session } = await manager.create('user:123')
    expect(session.data).toEqual({})
  })

  it('should handle special characters in user ID', async () => {
    const { session } = await manager.create('user:email@example.com')
    expect(session.userId).toBe('user:email@example.com')

    const retrieved = await manager.get(session.id)
    expect(retrieved?.userId).toBe('user:email@example.com')
  })

  it('should handle nested session data', async () => {
    const { session } = await manager.create('user:123', {
      profile: { name: 'Test', settings: { theme: 'dark' } },
    })

    expect(session.data.profile).toEqual({ name: 'Test', settings: { theme: 'dark' } })
  })

  it('should handle concurrent session operations', async () => {
    const { session } = await manager.create('user:123')

    // Simulate concurrent updates
    const updates = await Promise.all([
      manager.update(session.id, { field1: 'value1' }),
      manager.update(session.id, { field2: 'value2' }),
    ])

    // Both updates should succeed (last one wins for overlapping fields)
    expect(updates.every(u => u !== null)).toBe(true)
  })

  it('should handle zero TTL', async () => {
    const zeroTtlManager = new SessionManager({ ttl: 0 }, store)
    const { session } = await zeroTtlManager.create('user:123')

    // Session should expire immediately
    expect(session.expiresAt).toBe(Date.now())

    vi.advanceTimersByTime(1)

    const retrieved = await zeroTtlManager.get(session.id)
    expect(retrieved).toBeNull()
  })

  it('should handle very long TTL', async () => {
    const longTtlManager = new SessionManager({ ttl: 365 * 24 * 60 * 60 * 1000 }, store) // 1 year
    const { session } = await longTtlManager.create('user:123')

    expect(session.expiresAt).toBe(Date.now() + 365 * 24 * 60 * 60 * 1000)
  })
})
