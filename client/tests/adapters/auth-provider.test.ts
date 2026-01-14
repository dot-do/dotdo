/**
 * React-Admin AuthProvider Adapter Tests (TDD RED Phase)
 *
 * Tests for createAuthProvider - an adapter that implements react-admin's
 * AuthProvider interface for dotdo backends.
 *
 * These tests define the expected behavior and should FAIL until
 * the implementation is complete.
 *
 * @see https://marmelab.com/react-admin/Authentication.html
 *
 * ## AuthProvider Interface (react-admin)
 *
 * The adapter must implement:
 * - login(params) - Authenticate user with credentials
 * - logout(params) - End session and clear tokens
 * - checkAuth(params) - Verify current session is valid
 * - checkError(error) - Handle API errors (401/403)
 * - getIdentity() - Return current user info
 * - getPermissions(params) - Return user roles/permissions
 *
 * ## Usage
 *
 * ```tsx
 * import { createAuthProvider } from '@dotdo/client/adapters/auth-provider'
 *
 * const authProvider = createAuthProvider('https://api.example.com.ai', {
 *   tokenKey: 'auth_token',
 *   refreshOnExpiry: true,
 * })
 *
 * // Use with react-admin
 * <Admin authProvider={authProvider}>
 *   ...
 * </Admin>
 * ```
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// =============================================================================
// Types for react-admin AuthProvider interface
// =============================================================================

interface AuthProvider {
  login: (params: { username: string; password: string }) => Promise<void>
  logout: (params?: unknown) => Promise<void | string | false>
  checkAuth: (params?: unknown) => Promise<void>
  checkError: (error: { status?: number; message?: string }) => Promise<void>
  getIdentity: () => Promise<{ id: string; fullName?: string; avatar?: string }>
  getPermissions: (params?: unknown) => Promise<string[] | Record<string, boolean>>
}

interface AuthProviderOptions {
  /** Storage key for the auth token (default: 'dotdo_auth_token') */
  tokenKey?: string
  /** Storage key for user data (default: 'dotdo_user') */
  userKey?: string
  /** Whether to auto-refresh tokens before expiry (default: true) */
  refreshOnExpiry?: boolean
  /** Token refresh threshold in ms (default: 5 minutes) */
  refreshThreshold?: number
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Custom storage implementation (default: localStorage) */
  storage?: Storage
}

// =============================================================================
// Import from implementation (will fail until implemented)
// =============================================================================

// This import will fail - that's expected for RED phase
// The adapter should be at client/adapters/auth-provider.ts
import { createAuthProvider } from '../../adapters/auth-provider'

// =============================================================================
// Mock localStorage for Node environment
// =============================================================================

class MockStorage implements Storage {
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys())
    return keys[index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

// =============================================================================
// Mock fetch for testing API calls
// =============================================================================

function createMockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn(handler)
}

// =============================================================================
// Test Suite
// =============================================================================

describe('React-Admin AuthProvider Adapter', () => {
  let mockStorage: MockStorage
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    vi.useFakeTimers()
    mockStorage = new MockStorage()
    originalFetch = globalThis.fetch

    // Default mock fetch that returns success
    mockFetch = createMockFetch(async (url, init) => {
      if (url.includes('/auth/login')) {
        return new Response(
          JSON.stringify({
            token: 'test-token-123',
            refreshToken: 'refresh-token-456',
            expiresAt: Date.now() + 3600000, // 1 hour
            user: {
              id: 'user-1',
              email: 'test@example.com.ai',
              name: 'Test User',
              avatar: 'https://example.com.ai/avatar.png',
              roles: ['admin', 'editor'],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      if (url.includes('/auth/logout')) {
        return new Response(null, { status: 204 })
      }
      if (url.includes('/auth/me')) {
        const authHeader = (init?.headers as Record<string, string>)?.Authorization
        if (authHeader === 'Bearer test-token-123') {
          return new Response(
            JSON.stringify({
              id: 'user-1',
              email: 'test@example.com.ai',
              name: 'Test User',
              avatar: 'https://example.com.ai/avatar.png',
              roles: ['admin', 'editor'],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
      }
      if (url.includes('/auth/refresh')) {
        return new Response(
          JSON.stringify({
            token: 'new-token-789',
            expiresAt: Date.now() + 3600000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 })
    })

    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Factory Function Tests
  // ===========================================================================

  describe('createAuthProvider factory', () => {
    it('creates an AuthProvider with required methods', () => {
      const authProvider = createAuthProvider('https://api.example.com.ai')

      expect(authProvider).toBeDefined()
      expect(typeof authProvider.login).toBe('function')
      expect(typeof authProvider.logout).toBe('function')
      expect(typeof authProvider.checkAuth).toBe('function')
      expect(typeof authProvider.checkError).toBe('function')
      expect(typeof authProvider.getIdentity).toBe('function')
      expect(typeof authProvider.getPermissions).toBe('function')
    })

    it('accepts custom options', () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        tokenKey: 'custom_token',
        userKey: 'custom_user',
        refreshOnExpiry: false,
        storage: mockStorage,
        fetch: mockFetch,
      })

      expect(authProvider).toBeDefined()
    })

    it('normalizes base URL (removes trailing slash)', () => {
      const authProvider = createAuthProvider('https://api.example.com.ai/', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      // Should not have double slashes when making requests
      expect(authProvider).toBeDefined()
    })
  })

  // ===========================================================================
  // login() Method Tests
  // ===========================================================================

  describe('login()', () => {
    it('authenticates with username and password', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await authProvider.login({ username: 'test@example.com.ai', password: 'password123' })

      // Should have called the login endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com.ai/auth/login',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            email: 'test@example.com.ai',
            password: 'password123',
          }),
        })
      )
    })

    it('stores token in storage after successful login', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await authProvider.login({ username: 'test@example.com.ai', password: 'password123' })

      expect(mockStorage.getItem('dotdo_auth_token')).toBe('test-token-123')
    })

    it('stores user data in storage after successful login', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await authProvider.login({ username: 'test@example.com.ai', password: 'password123' })

      const storedUser = mockStorage.getItem('dotdo_user')
      expect(storedUser).toBeDefined()
      const user = JSON.parse(storedUser!)
      expect(user.id).toBe('user-1')
      expect(user.email).toBe('test@example.com.ai')
    })

    it('stores refresh token when provided', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await authProvider.login({ username: 'test@example.com.ai', password: 'password123' })

      expect(mockStorage.getItem('dotdo_refresh_token')).toBe('refresh-token-456')
    })

    it('stores token expiry time', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await authProvider.login({ username: 'test@example.com.ai', password: 'password123' })

      const expiresAt = mockStorage.getItem('dotdo_token_expires')
      expect(expiresAt).toBeDefined()
      expect(Number(expiresAt)).toBeGreaterThan(Date.now())
    })

    it('uses custom token key when provided', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
        tokenKey: 'my_custom_token',
      })

      await authProvider.login({ username: 'test@example.com.ai', password: 'password123' })

      expect(mockStorage.getItem('my_custom_token')).toBe('test-token-123')
      expect(mockStorage.getItem('dotdo_auth_token')).toBeNull()
    })

    it('throws on invalid credentials', async () => {
      const failingFetch = createMockFetch(async () => {
        return new Response(
          JSON.stringify({ error: 'Invalid credentials' }),
          { status: 401 }
        )
      })

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: failingFetch,
      })

      await expect(
        authProvider.login({ username: 'wrong@example.com.ai', password: 'wrong' })
      ).rejects.toThrow('Invalid credentials')
    })

    it('throws on network error', async () => {
      const failingFetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: failingFetch,
      })

      await expect(
        authProvider.login({ username: 'test@example.com.ai', password: 'password123' })
      ).rejects.toThrow('Network error')
    })
  })

  // ===========================================================================
  // logout() Method Tests
  // ===========================================================================

  describe('logout()', () => {
    beforeEach(async () => {
      // Setup: Login first
      mockStorage.setItem('dotdo_auth_token', 'test-token-123')
      mockStorage.setItem('dotdo_refresh_token', 'refresh-token-456')
      mockStorage.setItem('dotdo_user', JSON.stringify({ id: 'user-1' }))
      mockStorage.setItem('dotdo_token_expires', String(Date.now() + 3600000))
    })

    it('clears auth token from storage', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await authProvider.logout()

      expect(mockStorage.getItem('dotdo_auth_token')).toBeNull()
    })

    it('clears refresh token from storage', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await authProvider.logout()

      expect(mockStorage.getItem('dotdo_refresh_token')).toBeNull()
    })

    it('clears user data from storage', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await authProvider.logout()

      expect(mockStorage.getItem('dotdo_user')).toBeNull()
    })

    it('clears token expiry from storage', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await authProvider.logout()

      expect(mockStorage.getItem('dotdo_token_expires')).toBeNull()
    })

    it('calls logout endpoint on server', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await authProvider.logout()

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com.ai/auth/logout',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token-123',
          }),
        })
      )
    })

    it('returns redirect URL when provided in params', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      const result = await authProvider.logout({ redirectTo: '/login' })

      expect(result).toBe('/login')
    })

    it('succeeds even if server logout fails', async () => {
      const failingFetch = createMockFetch(async () => {
        return new Response(null, { status: 500 })
      })

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: failingFetch,
      })

      // Should not throw - local logout should succeed
      await expect(authProvider.logout()).resolves.not.toThrow()

      // Token should still be cleared
      expect(mockStorage.getItem('dotdo_auth_token')).toBeNull()
    })
  })

  // ===========================================================================
  // checkAuth() Method Tests
  // ===========================================================================

  describe('checkAuth()', () => {
    it('resolves when valid token exists', async () => {
      mockStorage.setItem('dotdo_auth_token', 'test-token-123')
      mockStorage.setItem('dotdo_token_expires', String(Date.now() + 3600000))

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await expect(authProvider.checkAuth()).resolves.not.toThrow()
    })

    it('rejects when no token exists', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await expect(authProvider.checkAuth()).rejects.toThrow()
    })

    it('rejects when token is expired', async () => {
      mockStorage.setItem('dotdo_auth_token', 'test-token-123')
      mockStorage.setItem('dotdo_token_expires', String(Date.now() - 1000)) // Expired

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await expect(authProvider.checkAuth()).rejects.toThrow()
    })

    it('validates token with server when validateOnCheck option is true', async () => {
      mockStorage.setItem('dotdo_auth_token', 'test-token-123')
      mockStorage.setItem('dotdo_token_expires', String(Date.now() + 3600000))

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await authProvider.checkAuth({ validateOnServer: true })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com.ai/auth/me',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token-123',
          }),
        })
      )
    })

    it('clears storage and rejects if server validation fails', async () => {
      mockStorage.setItem('dotdo_auth_token', 'invalid-token')
      mockStorage.setItem('dotdo_token_expires', String(Date.now() + 3600000))

      const failingFetch = createMockFetch(async () => {
        return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 })
      })

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: failingFetch,
      })

      await expect(authProvider.checkAuth({ validateOnServer: true })).rejects.toThrow()

      // Storage should be cleared after invalid token
      expect(mockStorage.getItem('dotdo_auth_token')).toBeNull()
    })
  })

  // ===========================================================================
  // checkError() Method Tests
  // ===========================================================================

  describe('checkError()', () => {
    beforeEach(() => {
      mockStorage.setItem('dotdo_auth_token', 'test-token-123')
      mockStorage.setItem('dotdo_user', JSON.stringify({ id: 'user-1' }))
    })

    it('resolves for non-auth errors (e.g., 500)', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await expect(authProvider.checkError({ status: 500 })).resolves.not.toThrow()
    })

    it('resolves for 400 errors', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await expect(authProvider.checkError({ status: 400 })).resolves.not.toThrow()
    })

    it('rejects and clears token on 401 Unauthorized', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await expect(authProvider.checkError({ status: 401 })).rejects.toThrow()

      expect(mockStorage.getItem('dotdo_auth_token')).toBeNull()
    })

    it('rejects and clears token on 403 Forbidden', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await expect(authProvider.checkError({ status: 403 })).rejects.toThrow()

      expect(mockStorage.getItem('dotdo_auth_token')).toBeNull()
    })

    it('includes error message in rejection', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await expect(
        authProvider.checkError({ status: 401, message: 'Session expired' })
      ).rejects.toThrow('Session expired')
    })

    it('attempts token refresh on 401 when refresh token exists', async () => {
      mockStorage.setItem('dotdo_refresh_token', 'refresh-token-456')

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
        refreshOnExpiry: true,
      })

      // First 401 should attempt refresh
      await authProvider.checkError({ status: 401 })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com.ai/auth/refresh',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ refreshToken: 'refresh-token-456' }),
        })
      )

      // New token should be stored
      expect(mockStorage.getItem('dotdo_auth_token')).toBe('new-token-789')
    })
  })

  // ===========================================================================
  // getIdentity() Method Tests
  // ===========================================================================

  describe('getIdentity()', () => {
    it('returns user identity from storage', async () => {
      mockStorage.setItem('dotdo_auth_token', 'test-token-123')
      mockStorage.setItem(
        'dotdo_user',
        JSON.stringify({
          id: 'user-1',
          email: 'test@example.com.ai',
          name: 'Test User',
          avatar: 'https://example.com.ai/avatar.png',
        })
      )

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      const identity = await authProvider.getIdentity()

      expect(identity).toEqual({
        id: 'user-1',
        fullName: 'Test User',
        avatar: 'https://example.com.ai/avatar.png',
      })
    })

    it('fetches identity from server when not in storage', async () => {
      mockStorage.setItem('dotdo_auth_token', 'test-token-123')

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      const identity = await authProvider.getIdentity()

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com.ai/auth/me',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token-123',
          }),
        })
      )

      expect(identity.id).toBe('user-1')
      expect(identity.fullName).toBe('Test User')
    })

    it('throws when not authenticated', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await expect(authProvider.getIdentity()).rejects.toThrow()
    })

    it('maps name to fullName for react-admin compatibility', async () => {
      mockStorage.setItem('dotdo_auth_token', 'test-token-123')
      mockStorage.setItem(
        'dotdo_user',
        JSON.stringify({
          id: 'user-1',
          name: 'John Doe',
        })
      )

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      const identity = await authProvider.getIdentity()

      expect(identity.fullName).toBe('John Doe')
    })

    it('uses email as fallback for fullName', async () => {
      mockStorage.setItem('dotdo_auth_token', 'test-token-123')
      mockStorage.setItem(
        'dotdo_user',
        JSON.stringify({
          id: 'user-1',
          email: 'john@example.com.ai',
        })
      )

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      const identity = await authProvider.getIdentity()

      expect(identity.fullName).toBe('john@example.com.ai')
    })
  })

  // ===========================================================================
  // getPermissions() Method Tests
  // ===========================================================================

  describe('getPermissions()', () => {
    it('returns roles from stored user data', async () => {
      mockStorage.setItem('dotdo_auth_token', 'test-token-123')
      mockStorage.setItem(
        'dotdo_user',
        JSON.stringify({
          id: 'user-1',
          roles: ['admin', 'editor'],
        })
      )

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      const permissions = await authProvider.getPermissions()

      expect(permissions).toEqual(['admin', 'editor'])
    })

    it('returns empty array when user has no roles', async () => {
      mockStorage.setItem('dotdo_auth_token', 'test-token-123')
      mockStorage.setItem(
        'dotdo_user',
        JSON.stringify({
          id: 'user-1',
        })
      )

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      const permissions = await authProvider.getPermissions()

      expect(permissions).toEqual([])
    })

    it('fetches permissions from server when not cached', async () => {
      mockStorage.setItem('dotdo_auth_token', 'test-token-123')

      const customFetch = createMockFetch(async (url) => {
        if (url.includes('/auth/permissions')) {
          return new Response(
            JSON.stringify({ permissions: ['read', 'write', 'delete'] }),
            { status: 200 }
          )
        }
        if (url.includes('/auth/me')) {
          return new Response(
            JSON.stringify({ id: 'user-1', name: 'Test' }),
            { status: 200 }
          )
        }
        return new Response(null, { status: 404 })
      })

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: customFetch,
      })

      const permissions = await authProvider.getPermissions({ fetchFromServer: true })

      expect(customFetch).toHaveBeenCalledWith(
        'https://api.example.com.ai/auth/permissions',
        expect.any(Object)
      )

      expect(permissions).toEqual(['read', 'write', 'delete'])
    })

    it('returns empty array when not authenticated', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      const permissions = await authProvider.getPermissions()

      expect(permissions).toEqual([])
    })
  })

  // ===========================================================================
  // Token Persistence (localStorage) Tests
  // ===========================================================================

  describe('token persistence', () => {
    it('persists auth state across provider instances', async () => {
      // First instance - login
      const authProvider1 = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await authProvider1.login({ username: 'test@example.com.ai', password: 'password123' })

      // Second instance - should see persisted state
      const authProvider2 = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      await expect(authProvider2.checkAuth()).resolves.not.toThrow()
    })

    it('uses custom storage when provided', async () => {
      const customStorage = new MockStorage()

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: customStorage,
        fetch: mockFetch,
      })

      await authProvider.login({ username: 'test@example.com.ai', password: 'password123' })

      // Should be in custom storage, not default
      expect(customStorage.getItem('dotdo_auth_token')).toBe('test-token-123')
      expect(mockStorage.getItem('dotdo_auth_token')).toBeNull()
    })
  })

  // ===========================================================================
  // Token Refresh on Expiry Tests
  // ===========================================================================

  describe('token refresh on expiry', () => {
    it('automatically refreshes token before expiry', async () => {
      const expiresAt = Date.now() + 4 * 60 * 1000 // 4 minutes (under 5 min threshold)

      mockStorage.setItem('dotdo_auth_token', 'old-token')
      mockStorage.setItem('dotdo_refresh_token', 'refresh-token-456')
      mockStorage.setItem('dotdo_token_expires', String(expiresAt))
      mockStorage.setItem('dotdo_user', JSON.stringify({ id: 'user-1' }))

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
        refreshOnExpiry: true,
        refreshThreshold: 5 * 60 * 1000, // 5 minutes
      })

      await authProvider.checkAuth()

      // Should have called refresh endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com.ai/auth/refresh',
        expect.objectContaining({
          method: 'POST',
        })
      )

      // New token should be stored
      expect(mockStorage.getItem('dotdo_auth_token')).toBe('new-token-789')
    })

    it('does not refresh when token is not near expiry', async () => {
      const expiresAt = Date.now() + 60 * 60 * 1000 // 1 hour (well above threshold)

      mockStorage.setItem('dotdo_auth_token', 'old-token')
      mockStorage.setItem('dotdo_refresh_token', 'refresh-token-456')
      mockStorage.setItem('dotdo_token_expires', String(expiresAt))
      mockStorage.setItem('dotdo_user', JSON.stringify({ id: 'user-1' }))

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
        refreshOnExpiry: true,
      })

      await authProvider.checkAuth()

      // Should NOT have called refresh endpoint
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/auth/refresh'),
        expect.any(Object)
      )

      // Token should remain unchanged
      expect(mockStorage.getItem('dotdo_auth_token')).toBe('old-token')
    })

    it('can disable auto-refresh', async () => {
      const expiresAt = Date.now() + 4 * 60 * 1000 // 4 minutes (under threshold)

      mockStorage.setItem('dotdo_auth_token', 'old-token')
      mockStorage.setItem('dotdo_refresh_token', 'refresh-token-456')
      mockStorage.setItem('dotdo_token_expires', String(expiresAt))
      mockStorage.setItem('dotdo_user', JSON.stringify({ id: 'user-1' }))

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
        refreshOnExpiry: false,
      })

      await authProvider.checkAuth()

      // Should NOT have called refresh endpoint
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/auth/refresh'),
        expect.any(Object)
      )
    })

    it('clears session if refresh fails', async () => {
      const expiresAt = Date.now() + 4 * 60 * 1000 // Near expiry

      mockStorage.setItem('dotdo_auth_token', 'old-token')
      mockStorage.setItem('dotdo_refresh_token', 'invalid-refresh')
      mockStorage.setItem('dotdo_token_expires', String(expiresAt))

      const failingFetch = createMockFetch(async (url) => {
        if (url.includes('/auth/refresh')) {
          return new Response(JSON.stringify({ error: 'Invalid refresh token' }), { status: 401 })
        }
        return new Response(null, { status: 404 })
      })

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: failingFetch,
        refreshOnExpiry: true,
      })

      await expect(authProvider.checkAuth()).rejects.toThrow()

      // Session should be cleared
      expect(mockStorage.getItem('dotdo_auth_token')).toBeNull()
      expect(mockStorage.getItem('dotdo_refresh_token')).toBeNull()
    })
  })

  // ===========================================================================
  // Session Hydration on Page Load Tests
  // ===========================================================================

  describe('session hydration on page load', () => {
    it('hydrates session from storage on instantiation', async () => {
      // Pre-populate storage (simulating previous session)
      mockStorage.setItem('dotdo_auth_token', 'persisted-token')
      mockStorage.setItem('dotdo_token_expires', String(Date.now() + 3600000))
      mockStorage.setItem(
        'dotdo_user',
        JSON.stringify({
          id: 'user-1',
          name: 'Persisted User',
          email: 'persisted@example.com.ai',
        })
      )

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      // Should be authenticated without calling login
      await expect(authProvider.checkAuth()).resolves.not.toThrow()

      // Should have correct identity
      const identity = await authProvider.getIdentity()
      expect(identity.fullName).toBe('Persisted User')
    })

    it('validates hydrated session with server', async () => {
      mockStorage.setItem('dotdo_auth_token', 'persisted-token')
      mockStorage.setItem('dotdo_token_expires', String(Date.now() + 3600000))
      mockStorage.setItem('dotdo_user', JSON.stringify({ id: 'user-1' }))

      const customFetch = createMockFetch(async (url, init) => {
        if (url.includes('/auth/me')) {
          const authHeader = (init?.headers as Record<string, string>)?.Authorization
          if (authHeader === 'Bearer persisted-token') {
            return new Response(
              JSON.stringify({ id: 'user-1', name: 'Validated User' }),
              { status: 200 }
            )
          }
          return new Response(null, { status: 401 })
        }
        return new Response(null, { status: 404 })
      })

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: customFetch,
      })

      await authProvider.checkAuth({ validateOnServer: true })

      expect(customFetch).toHaveBeenCalledWith(
        'https://api.example.com.ai/auth/me',
        expect.any(Object)
      )
    })

    it('clears invalid hydrated session', async () => {
      mockStorage.setItem('dotdo_auth_token', 'invalid-token')
      mockStorage.setItem('dotdo_token_expires', String(Date.now() + 3600000))
      mockStorage.setItem('dotdo_user', JSON.stringify({ id: 'user-1' }))

      const failingFetch = createMockFetch(async () => {
        return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 })
      })

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: failingFetch,
      })

      await expect(authProvider.checkAuth({ validateOnServer: true })).rejects.toThrow()

      // Invalid session should be cleared
      expect(mockStorage.getItem('dotdo_auth_token')).toBeNull()
    })
  })

  // ===========================================================================
  // Concurrent Request Handling Tests
  // ===========================================================================

  describe('concurrent request handling', () => {
    it('handles multiple concurrent checkAuth calls', async () => {
      mockStorage.setItem('dotdo_auth_token', 'test-token-123')
      mockStorage.setItem('dotdo_token_expires', String(Date.now() + 3600000))
      mockStorage.setItem('dotdo_user', JSON.stringify({ id: 'user-1' }))

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      // Fire multiple concurrent requests
      const results = await Promise.all([
        authProvider.checkAuth(),
        authProvider.checkAuth(),
        authProvider.checkAuth(),
      ])

      // All should succeed
      expect(results).toHaveLength(3)
    })

    it('deduplicates concurrent token refresh requests', async () => {
      const expiresAt = Date.now() + 4 * 60 * 1000 // Near expiry

      mockStorage.setItem('dotdo_auth_token', 'old-token')
      mockStorage.setItem('dotdo_refresh_token', 'refresh-token-456')
      mockStorage.setItem('dotdo_token_expires', String(expiresAt))
      mockStorage.setItem('dotdo_user', JSON.stringify({ id: 'user-1' }))

      let refreshCallCount = 0
      const countingFetch = createMockFetch(async (url) => {
        if (url.includes('/auth/refresh')) {
          refreshCallCount++
          // No delay - deduplication is tested by concurrent calls, not timing
          return new Response(
            JSON.stringify({
              token: 'new-token-789',
              expiresAt: Date.now() + 3600000,
            }),
            { status: 200 }
          )
        }
        return new Response(null, { status: 404 })
      })

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: countingFetch,
        refreshOnExpiry: true,
      })

      // Fire multiple concurrent checkAuth calls that would trigger refresh
      await Promise.all([
        authProvider.checkAuth(),
        authProvider.checkAuth(),
        authProvider.checkAuth(),
      ])

      // Should only call refresh endpoint ONCE (deduplicated)
      expect(refreshCallCount).toBe(1)
    })

    it('queues requests during login', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      // Start login (takes time)
      const loginPromise = authProvider.login({
        username: 'test@example.com.ai',
        password: 'password123',
      })

      // Immediately try to get identity (should wait for login)
      const identityPromise = authProvider.getIdentity()

      // Wait for both
      await loginPromise
      const identity = await identityPromise

      // Should have identity from login
      expect(identity.id).toBe('user-1')
    })
  })

  // ===========================================================================
  // Error State Recovery Tests
  // ===========================================================================

  describe('error state recovery', () => {
    it('recovers from failed login attempt', async () => {
      const attemptCount = { value: 0 }
      const flakeyFetch = createMockFetch(async (url) => {
        if (url.includes('/auth/login')) {
          attemptCount.value++
          if (attemptCount.value === 1) {
            return new Response(JSON.stringify({ error: 'Temporary error' }), { status: 500 })
          }
          return new Response(
            JSON.stringify({
              token: 'test-token-123',
              user: { id: 'user-1', name: 'Test' },
            }),
            { status: 200 }
          )
        }
        return new Response(null, { status: 404 })
      })

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: flakeyFetch,
      })

      // First attempt fails
      await expect(
        authProvider.login({ username: 'test@example.com.ai', password: 'password123' })
      ).rejects.toThrow()

      // Second attempt succeeds
      await authProvider.login({ username: 'test@example.com.ai', password: 'password123' })

      expect(mockStorage.getItem('dotdo_auth_token')).toBe('test-token-123')
    })

    it('clears error state after successful operation', async () => {
      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      // Trigger an error by checking auth without token
      await expect(authProvider.checkAuth()).rejects.toThrow()

      // Login successfully
      await authProvider.login({ username: 'test@example.com.ai', password: 'password123' })

      // checkAuth should now succeed
      await expect(authProvider.checkAuth()).resolves.not.toThrow()
    })

    it('handles corrupted storage data gracefully', async () => {
      // Store corrupted JSON
      mockStorage.setItem('dotdo_auth_token', 'valid-token')
      mockStorage.setItem('dotdo_user', '{invalid json')

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: mockFetch,
      })

      // Should not crash, should fetch from server instead
      const identity = await authProvider.getIdentity()

      expect(identity.id).toBeDefined()
    })

    it('handles storage unavailability', async () => {
      const failingStorage = {
        ...mockStorage,
        getItem: () => {
          throw new Error('Storage unavailable')
        },
        setItem: () => {
          throw new Error('Storage unavailable')
        },
      } as Storage

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: failingStorage,
        fetch: mockFetch,
      })

      // Should handle gracefully (reject but not crash)
      await expect(authProvider.checkAuth()).rejects.toThrow()
    })

    it('retries failed network requests', async () => {
      let attempts = 0
      const flakeyFetch = createMockFetch(async (url) => {
        if (url.includes('/auth/login')) {
          attempts++
          if (attempts < 3) {
            throw new Error('Network error')
          }
          return new Response(
            JSON.stringify({
              token: 'test-token-123',
              user: { id: 'user-1' },
            }),
            { status: 200 }
          )
        }
        return new Response(null, { status: 404 })
      })

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: flakeyFetch,
      })

      await authProvider.login({ username: 'test@example.com.ai', password: 'password123' })

      expect(attempts).toBe(3)
      expect(mockStorage.getItem('dotdo_auth_token')).toBe('test-token-123')
    })
  })

  // ===========================================================================
  // Additional Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('handles empty response from server', async () => {
      const emptyFetch = createMockFetch(async () => {
        return new Response('', { status: 200 })
      })

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: emptyFetch,
      })

      await expect(
        authProvider.login({ username: 'test@example.com.ai', password: 'password123' })
      ).rejects.toThrow()
    })

    it('handles timeout during login', async () => {
      // Use real timers for this test to avoid fake timer complications
      vi.useRealTimers()

      const slowFetch = vi.fn().mockImplementation(async () => {
        throw new Error('Request timeout')
      })

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: slowFetch,
      })

      await expect(
        authProvider.login({ username: 'test@example.com.ai', password: 'password123' })
      ).rejects.toThrow('Request timeout')

      // Restore fake timers for subsequent tests
      vi.useFakeTimers()
    })

    it('normalizes user data with different field names', async () => {
      const customFetch = createMockFetch(async (url) => {
        if (url.includes('/auth/login')) {
          return new Response(
            JSON.stringify({
              token: 'test-token-123',
              user: {
                user_id: 'user-1', // Different field name
                full_name: 'Test User', // Different field name
                email_address: 'test@example.com.ai', // Different field name
                profile_picture: 'https://example.com.ai/avatar.png', // Different field name
                user_roles: ['admin'], // Different field name
              },
            }),
            { status: 200 }
          )
        }
        return new Response(null, { status: 404 })
      })

      const authProvider = createAuthProvider('https://api.example.com.ai', {
        storage: mockStorage,
        fetch: customFetch,
      })

      await authProvider.login({ username: 'test@example.com.ai', password: 'password123' })

      const identity = await authProvider.getIdentity()

      // Should normalize to expected format
      expect(identity.id).toBe('user-1')
      expect(identity.fullName).toBe('Test User')
    })
  })
})
