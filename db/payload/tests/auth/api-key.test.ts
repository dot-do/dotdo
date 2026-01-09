import { describe, it, expect } from 'vitest'
import {
  validateApiKey,
  hasScope,
  type ApiKeyDatabase,
  type ApiKeyWithUser,
  type RateLimitStore,
} from '../../src/auth/api-key'

/**
 * API Key Validation Tests
 *
 * Tests for API key validation including:
 * - Key lookup and verification
 * - Expiration checking
 * - User ban checking
 * - Rate limiting
 * - Permission scope validation
 *
 * Reference: dotdo-q0iu - B07 GREEN: Implement API key validator
 */

// ============================================================================
// Mock Data Helpers
// ============================================================================

// Helper to create mock API key
const createMockApiKey = (overrides: Record<string, unknown> = {}): ApiKeyWithUser => ({
  id: 'key-123',
  key: 'key_abc123',
  name: 'Test API Key',
  userId: 'user-123',
  enabled: true,
  permissions: JSON.stringify(['read', 'write']),
  rateLimit: 1000,
  expiresAt: null,
  user: {
    id: 'user-123',
    name: 'Test User',
    email: 'test@example.com',
    role: 'user',
    banned: false,
  },
  ...overrides,
})

// Mock database that uses findFirst to look up keys
const createMockDb = (apiKeys: ApiKeyWithUser[]): ApiKeyDatabase => ({
  query: {
    apiKeys: {
      findFirst: async (opts: { where: any }) => {
        // The where is a function that returns eq(keys.key, searchKey)
        // We simulate this by finding the key that matches
        for (const apiKey of apiKeys) {
          // opts.where is called with (keys, { eq }) - we mock eq to return true when matched
          const mockEq = (field: unknown, value: string) => value
          const searchKey = opts.where({ key: 'key' }, { eq: mockEq })
          if (apiKey.key === searchKey) {
            return apiKey
          }
        }
        return null
      },
    },
  },
})

// Mock rate limit store
const createMockRateLimitStore = (
  data: Map<string, { count: number; resetAt: number }> = new Map(),
): RateLimitStore => ({
  get: async (key: string) => data.get(key) ?? null,
  set: async (key: string, value: { count: number; resetAt: number }) => {
    data.set(key, value)
  },
  increment: async (key: string) => {
    const current = data.get(key)
    if (current) {
      current.count++
      return current.count
    }
    data.set(key, { count: 1, resetAt: Date.now() + 3600000 })
    return 1
  },
})

// ============================================================================
// API Key Validation Tests
// ============================================================================

describe('API Key Validation', () => {
  describe('validateApiKey', () => {
    it('should return valid result for active API key', async () => {
      const validKey = createMockApiKey()
      const db = createMockDb([validKey])

      const result = await validateApiKey(db, 'key_abc123')

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.user).toBeDefined()
        expect(result.user.id).toBe('user-123')
        expect(result.apiKey).toBeDefined()
        expect(result.apiKey.id).toBe('key-123')
      }
    })

    it('should return invalid for disabled API key', async () => {
      const disabledKey = createMockApiKey({ enabled: false, key: 'key_disabled' })
      const db = createMockDb([disabledKey])

      const result = await validateApiKey(db, 'key_disabled')

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('api_key_disabled')
      }
    })

    it('should return invalid for expired API key', async () => {
      const expiredKey = createMockApiKey({
        key: 'key_expired',
        expiresAt: new Date('2020-01-01'),
      })
      const db = createMockDb([expiredKey])

      const result = await validateApiKey(db, 'key_expired')

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('api_key_expired')
      }
    })

    it('should return invalid for non-existent API key', async () => {
      const db = createMockDb([])

      const result = await validateApiKey(db, 'key_nonexistent')

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('api_key_not_found')
      }
    })

    it('should return invalid for null/undefined key', async () => {
      const db = createMockDb([])

      const resultNull = await validateApiKey(db, null)
      expect(resultNull.valid).toBe(false)
      if (!resultNull.valid) {
        expect(resultNull.error).toBe('invalid_key')
      }

      const resultUndefined = await validateApiKey(db, undefined)
      expect(resultUndefined.valid).toBe(false)
      if (!resultUndefined.valid) {
        expect(resultUndefined.error).toBe('invalid_key')
      }
    })

    it('should parse permissions JSON from key', async () => {
      const keyWithPermissions = createMockApiKey({
        permissions: JSON.stringify(['read', 'write', 'admin']),
      })
      const db = createMockDb([keyWithPermissions])

      const result = await validateApiKey(db, 'key_abc123')

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.apiKey.scopes).toEqual(['read', 'write', 'admin'])
      }
    })

    it('should include user data from key owner', async () => {
      const key = createMockApiKey({
        userId: 'user-456',
        user: {
          id: 'user-456',
          name: 'Key Owner',
          email: 'owner@example.com',
          role: 'admin',
          banned: false,
        },
      })
      const db = createMockDb([key])

      const result = await validateApiKey(db, 'key_abc123')

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.user.id).toBe('user-456')
        expect(result.user.name).toBe('Key Owner')
        expect(result.user.email).toBe('owner@example.com')
      }
    })

    it('should return invalid when key owner is banned', async () => {
      const key = createMockApiKey({
        user: {
          id: 'user-123',
          name: 'Test User',
          email: 'test@example.com',
          role: 'user',
          banned: true,
        },
      })
      const db = createMockDb([key])

      const result = await validateApiKey(db, 'key_abc123')

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('user_banned')
      }
    })

    it('should return invalid when key owner does not exist', async () => {
      const orphanKey = createMockApiKey({
        userId: 'deleted-user',
        user: null,
      })
      const db = createMockDb([orphanKey])

      const result = await validateApiKey(db, 'key_abc123')

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('user_not_found')
      }
    })
  })

  // ============================================================================
  // Rate Limiting Tests
  // ============================================================================

  describe('rate limiting', () => {
    it('should return rate_limit_exceeded when over limit', async () => {
      const key = createMockApiKey({ rateLimit: 2 })
      const db = createMockDb([key])
      const rateLimitStore = createMockRateLimitStore(
        new Map([['key_abc123', { count: 2, resetAt: Date.now() + 3600000 }]]),
      )

      const result = await validateApiKey(db, 'key_abc123', { rateLimitStore })

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('rate_limit_exceeded')
        expect(result.rateLimit).toBeDefined()
        expect(result.rateLimit?.remaining).toBe(0)
      }
    })

    it('should allow request when under rate limit', async () => {
      const key = createMockApiKey({ rateLimit: 100 })
      const db = createMockDb([key])
      const rateLimitStore = createMockRateLimitStore(
        new Map([['key_abc123', { count: 50, resetAt: Date.now() + 3600000 }]]),
      )

      const result = await validateApiKey(db, 'key_abc123', { rateLimitStore })

      expect(result.valid).toBe(true)
    })

    it('should reset count after time window expires', async () => {
      const key = createMockApiKey({ rateLimit: 100 })
      const db = createMockDb([key])
      // Window expired (resetAt is in the past)
      const rateLimitStore = createMockRateLimitStore(
        new Map([['key_abc123', { count: 100, resetAt: Date.now() - 1000 }]]),
      )

      const result = await validateApiKey(db, 'key_abc123', { rateLimitStore })

      // Should be allowed because the window has expired
      expect(result.valid).toBe(true)
    })

    it('should use key-specific rate limit if set', async () => {
      const customLimitKey = createMockApiKey({
        key: 'key_custom',
        rateLimit: 5000, // Higher than default
      })
      const db = createMockDb([customLimitKey])
      const rateLimitStore = createMockRateLimitStore(
        new Map([['key_custom', { count: 4999, resetAt: Date.now() + 3600000 }]]),
      )

      const result = await validateApiKey(db, 'key_custom', { rateLimitStore })

      expect(result.valid).toBe(true)
    })

    it('should use default rate limit if not specified on key', async () => {
      const keyWithoutLimit = createMockApiKey({
        key: 'key_default',
        rateLimit: null,
      })
      const db = createMockDb([keyWithoutLimit])
      // Default is 1000, so 1000 requests should be over limit
      const rateLimitStore = createMockRateLimitStore(
        new Map([['key_default', { count: 1000, resetAt: Date.now() + 3600000 }]]),
      )

      const result = await validateApiKey(db, 'key_default', { rateLimitStore })

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('rate_limit_exceeded')
      }
    })

    it('should use custom default rate limit from options', async () => {
      const keyWithoutLimit = createMockApiKey({
        key: 'key_custom_default',
        rateLimit: null,
      })
      const db = createMockDb([keyWithoutLimit])
      const rateLimitStore = createMockRateLimitStore(
        new Map([['key_custom_default', { count: 50, resetAt: Date.now() + 3600000 }]]),
      )

      const result = await validateApiKey(db, 'key_custom_default', {
        rateLimitStore,
        defaultRateLimit: 100,
      })

      expect(result.valid).toBe(true)
    })
  })

  // ============================================================================
  // Permissions Tests
  // ============================================================================

  describe('permissions', () => {
    it('should include scopes from API key', async () => {
      const keyWithScopes = createMockApiKey({
        permissions: JSON.stringify(['read:posts', 'write:posts', 'read:users']),
      })
      const db = createMockDb([keyWithScopes])

      const result = await validateApiKey(db, 'key_abc123')

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.apiKey.scopes).toContain('read:posts')
        expect(result.apiKey.scopes).toContain('write:posts')
        expect(result.apiKey.scopes).toContain('read:users')
      }
    })

    it('should validate scope against requested action', async () => {
      const keyWithReadOnly = createMockApiKey({
        permissions: JSON.stringify(['read:posts']),
      })
      const db = createMockDb([keyWithReadOnly])

      const resultValid = await validateApiKey(db, 'key_abc123', {
        requiredScope: 'read:posts',
      })
      expect(resultValid.valid).toBe(true)
    })

    it('should deny access for missing scope', async () => {
      const keyWithLimitedScopes = createMockApiKey({
        permissions: JSON.stringify(['read:posts']),
      })
      const db = createMockDb([keyWithLimitedScopes])

      const result = await validateApiKey(db, 'key_abc123', {
        requiredScope: 'admin:settings',
      })

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('insufficient_scope')
      }
    })

    it('should support wildcard scopes', async () => {
      const keyWithWildcard = createMockApiKey({
        permissions: JSON.stringify(['read:*']),
      })
      const db = createMockDb([keyWithWildcard])

      const resultPosts = await validateApiKey(db, 'key_abc123', {
        requiredScope: 'read:posts',
      })
      expect(resultPosts.valid).toBe(true)

      const resultUsers = await validateApiKey(db, 'key_abc123', {
        requiredScope: 'read:users',
      })
      expect(resultUsers.valid).toBe(true)

      const resultWrite = await validateApiKey(db, 'key_abc123', {
        requiredScope: 'write:posts',
      })
      expect(resultWrite.valid).toBe(false) // Wildcard only covers 'read:*'
    })

    it('should support full admin scope', async () => {
      const adminKey = createMockApiKey({
        permissions: JSON.stringify(['*']),
      })
      const db = createMockDb([adminKey])

      const result1 = await validateApiKey(db, 'key_abc123', {
        requiredScope: 'read:posts',
      })
      expect(result1.valid).toBe(true)

      const result2 = await validateApiKey(db, 'key_abc123', {
        requiredScope: 'admin:settings',
      })
      expect(result2.valid).toBe(true)
    })

    it('should handle empty permissions array', async () => {
      const keyNoPermissions = createMockApiKey({
        permissions: JSON.stringify([]),
      })
      const db = createMockDb([keyNoPermissions])

      const result = await validateApiKey(db, 'key_abc123', {
        requiredScope: 'read:posts',
      })

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('insufficient_scope')
      }
    })

    it('should handle null permissions', async () => {
      const keyNullPermissions = createMockApiKey({
        permissions: null,
      })
      const db = createMockDb([keyNullPermissions])

      const result = await validateApiKey(db, 'key_abc123', {
        requiredScope: 'read:posts',
      })

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('insufficient_scope')
      }
    })
  })

  // ============================================================================
  // hasScope Tests
  // ============================================================================

  describe('hasScope', () => {
    it('should return true for exact match', () => {
      expect(hasScope(['read:posts'], 'read:posts')).toBe(true)
    })

    it('should return false for no match', () => {
      expect(hasScope(['read:posts'], 'write:posts')).toBe(false)
    })

    it('should return true for wildcard *', () => {
      expect(hasScope(['*'], 'anything:here')).toBe(true)
    })

    it('should return true for action wildcard', () => {
      expect(hasScope(['read:*'], 'read:posts')).toBe(true)
      expect(hasScope(['read:*'], 'read:users')).toBe(true)
    })

    it('should return false when action wildcard does not match', () => {
      expect(hasScope(['read:*'], 'write:posts')).toBe(false)
    })

    it('should return false for empty scopes', () => {
      expect(hasScope([], 'read:posts')).toBe(false)
    })
  })

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('full validation flow', () => {
    it('should validate key, check rate limit, and verify scope in one call', async () => {
      const key = createMockApiKey({
        permissions: JSON.stringify(['read:posts', 'write:posts']),
        rateLimit: 1000,
      })
      const db = createMockDb([key])
      const rateLimitStore = createMockRateLimitStore()

      const result = await validateApiKey(db, 'key_abc123', {
        rateLimitStore,
        requiredScope: 'read:posts',
      })

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.user).toBeDefined()
        expect(result.apiKey).toBeDefined()
      }
    })

    it('should fail fast if key is invalid before checking rate limit', async () => {
      const db = createMockDb([])
      const rateLimitStore = createMockRateLimitStore()

      const result = await validateApiKey(db, 'key_nonexistent', {
        rateLimitStore,
        requiredScope: 'read:posts',
      })

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('api_key_not_found')
      }
    })

    it('should fail with scope error after passing key and rate limit checks', async () => {
      const key = createMockApiKey({
        permissions: JSON.stringify(['read:posts']),
        rateLimit: 1000,
      })
      const db = createMockDb([key])
      const rateLimitStore = createMockRateLimitStore()

      const result = await validateApiKey(db, 'key_abc123', {
        rateLimitStore,
        requiredScope: 'admin:settings',
      })

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toBe('insufficient_scope')
      }
    })
  })
})
