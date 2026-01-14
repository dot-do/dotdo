/**
 * Tests for Supabase Auth compat layer
 *
 * These tests verify the Supabase Auth API compatibility:
 * - createClient factory
 * - signUp/signIn/signOut
 * - Session management
 * - Auth state changes
 * - MFA operations
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createClient, AuthClient } from '../index'
import type {
  User,
  Session,
  AuthChangeEvent,
  SupabaseClient,
} from '../types'

// ============================================================================
// MOCK SETUP
// ============================================================================

// Mock fetch for API calls
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid-1234',
})

// Helper to create mock user
function createMockUser(overrides?: Partial<User>): User {
  return {
    id: 'user-123',
    aud: 'authenticated',
    email: 'test@example.com',
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: 'email' },
    user_metadata: {},
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

// Helper to create mock session
function createMockSession(overrides?: Partial<Session>): Session {
  return {
    access_token: 'access-token-123',
    refresh_token: 'refresh-token-456',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: createMockUser(),
    ...overrides,
  }
}

// Helper to create mock response
function createMockResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Supabase Auth Compat', () => {
  const TEST_URL = 'https://test-project.supabase.co'
  const TEST_KEY = 'test-anon-key'

  let supabase: SupabaseClient

  beforeEach(() => {
    vi.clearAllMocks()
    supabase = createClient(TEST_URL, TEST_KEY)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ============================================================================
  // CLIENT CREATION
  // ============================================================================

  describe('createClient', () => {
    it('should create a client with auth property', () => {
      expect(supabase).toBeDefined()
      expect(supabase.auth).toBeDefined()
      expect(supabase.auth).toBeInstanceOf(AuthClient)
    })

    it('should accept custom options', () => {
      const customClient = createClient(TEST_URL, TEST_KEY, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })
      expect(customClient.auth).toBeDefined()
    })

    it('should handle URL with trailing slash', () => {
      const client = createClient(TEST_URL + '/', TEST_KEY)
      expect(client.auth).toBeDefined()
    })
  })

  // ============================================================================
  // SIGN UP
  // ============================================================================

  describe('signUp', () => {
    it('should sign up with email and password', async () => {
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))

      const { data, error } = await supabase.auth.signUp({
        email: 'new@example.com',
        password: 'password123',
      })

      expect(error).toBeNull()
      expect(data.user).toBeDefined()
      expect(data.session).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_URL}/auth/v1/signup`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            apikey: TEST_KEY,
          }),
        })
      )
    })

    it('should sign up with phone and password', async () => {
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))

      const { data, error } = await supabase.auth.signUp({
        phone: '+1234567890',
        password: 'password123',
      })

      expect(error).toBeNull()
      expect(data.user).toBeDefined()
    })

    it('should handle sign up with user metadata', async () => {
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))

      await supabase.auth.signUp({
        email: 'new@example.com',
        password: 'password123',
        options: {
          data: { name: 'Test User' },
        },
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options.body)
      expect(body.data).toEqual({ name: 'Test User' })
    })

    it('should handle sign up errors', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ message: 'User already registered' }, 400)
      )

      const { data, error } = await supabase.auth.signUp({
        email: 'existing@example.com',
        password: 'password123',
      })

      expect(error).toBeDefined()
      expect(error?.message).toBe('User already registered')
      expect(data.user).toBeNull()
      expect(data.session).toBeNull()
    })
  })

  // ============================================================================
  // SIGN IN WITH PASSWORD
  // ============================================================================

  describe('signInWithPassword', () => {
    it('should sign in with email and password', async () => {
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))

      const { data, error } = await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'password123',
      })

      expect(error).toBeNull()
      expect(data.user).toBeDefined()
      expect(data.session).toBeDefined()
      expect(data.session?.access_token).toBe('access-token-123')
    })

    it('should sign in with phone and password', async () => {
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))

      const { data, error } = await supabase.auth.signInWithPassword({
        phone: '+1234567890',
        password: 'password123',
      })

      expect(error).toBeNull()
      expect(data.user).toBeDefined()
    })

    it('should handle invalid credentials', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ message: 'Invalid login credentials' }, 400)
      )

      const { data, error } = await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'wrongpassword',
      })

      expect(error).toBeDefined()
      expect(error?.message).toBe('Invalid login credentials')
      expect(data.user).toBeNull()
    })
  })

  // ============================================================================
  // SIGN IN WITH OAUTH
  // ============================================================================

  describe('signInWithOAuth', () => {
    it('should return OAuth URL for provider', async () => {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
      })

      expect(error).toBeNull()
      expect(data?.provider).toBe('github')
      expect(data?.url).toContain(`${TEST_URL}/auth/v1/authorize`)
      expect(data?.url).toContain('provider=github')
    })

    it('should include redirect URL option', async () => {
      const { data } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'https://myapp.com/callback',
        },
      })

      expect(data?.url).toContain('redirect_to=https')
    })

    it('should include scopes option', async () => {
      const { data } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          scopes: 'read:user user:email',
        },
      })

      expect(data?.url).toContain('scopes=read')
    })
  })

  // ============================================================================
  // SIGN IN WITH OTP
  // ============================================================================

  describe('signInWithOtp', () => {
    it('should send OTP to email', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ message_id: 'msg-123' })
      )

      const { data, error } = await supabase.auth.signInWithOtp({
        email: 'test@example.com',
      })

      expect(error).toBeNull()
      expect(data.messageId).toBe('msg-123')
    })

    it('should send OTP to phone', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ message_id: 'msg-456' })
      )

      const { data, error } = await supabase.auth.signInWithOtp({
        phone: '+1234567890',
      })

      expect(error).toBeNull()
    })
  })

  // ============================================================================
  // VERIFY OTP
  // ============================================================================

  describe('verifyOtp', () => {
    it('should verify email OTP', async () => {
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))

      const { data, error } = await supabase.auth.verifyOtp({
        email: 'test@example.com',
        token: '123456',
        type: 'magiclink',
      })

      expect(error).toBeNull()
      expect(data.session).toBeDefined()
    })

    it('should verify phone OTP', async () => {
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))

      const { data, error } = await supabase.auth.verifyOtp({
        phone: '+1234567890',
        token: '123456',
        type: 'sms',
      })

      expect(error).toBeNull()
      expect(data.session).toBeDefined()
    })
  })

  // ============================================================================
  // SIGN OUT
  // ============================================================================

  describe('signOut', () => {
    it('should sign out successfully', async () => {
      // First sign in
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))
      await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'password123',
      })

      // Then sign out
      mockFetch.mockResolvedValueOnce(createMockResponse({}))
      const { error } = await supabase.auth.signOut()

      expect(error).toBeNull()
    })

    it('should clear session after sign out', async () => {
      // First sign in
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))
      await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'password123',
      })

      // Then sign out
      const { error } = await supabase.auth.signOut()

      // Check session is cleared
      const { data } = await supabase.auth.getSession()
      expect(data.session).toBeNull()
    })

    it('should support scope option', async () => {
      // First sign in
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))
      await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'password123',
      })

      // Then sign out with global scope
      mockFetch.mockResolvedValueOnce(createMockResponse({}))
      await supabase.auth.signOut({ scope: 'global' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('scope=global'),
        expect.any(Object)
      )
    })
  })

  // ============================================================================
  // SESSION MANAGEMENT
  // ============================================================================

  describe('getSession', () => {
    it('should return null when not signed in', async () => {
      const { data } = await supabase.auth.getSession()
      expect(data.session).toBeNull()
    })

    it('should return session after sign in', async () => {
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))
      await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'password123',
      })

      const { data } = await supabase.auth.getSession()
      expect(data.session).toBeDefined()
      expect(data.session?.access_token).toBe('access-token-123')
    })
  })

  describe('refreshSession', () => {
    it('should refresh an expired session', async () => {
      // First sign in
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))
      await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'password123',
      })

      // Then refresh
      const newSession = createMockSession({
        access_token: 'new-access-token',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(newSession))

      const { data, error } = await supabase.auth.refreshSession()

      expect(error).toBeNull()
      expect(data.session?.access_token).toBe('new-access-token')
    })

    it('should return error when no refresh token', async () => {
      const { error } = await supabase.auth.refreshSession()
      expect(error).toBeDefined()
      expect(error?.message).toContain('No refresh token')
    })
  })

  describe('setSession', () => {
    it('should set session from tokens', async () => {
      const mockUser = createMockUser()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockUser))

      const { data, error } = await supabase.auth.setSession({
        access_token: 'custom-access-token',
        refresh_token: 'custom-refresh-token',
      })

      expect(error).toBeNull()
      expect(data.session).toBeDefined()
      expect(data.session?.access_token).toBe('custom-access-token')
    })
  })

  // ============================================================================
  // USER MANAGEMENT
  // ============================================================================

  describe('getUser', () => {
    it('should return null when not signed in', async () => {
      const { data } = await supabase.auth.getUser()
      expect(data.user).toBeNull()
    })

    it('should return user after sign in', async () => {
      // First sign in
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))
      await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'password123',
      })

      // Get user
      const mockUser = createMockUser()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockUser))

      const { data, error } = await supabase.auth.getUser()

      expect(error).toBeNull()
      expect(data.user).toBeDefined()
      expect(data.user?.email).toBe('test@example.com')
    })
  })

  describe('updateUser', () => {
    it('should update user attributes', async () => {
      // First sign in
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))
      await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'password123',
      })

      // Update user
      const updatedUser = createMockUser({
        user_metadata: { name: 'Updated Name' },
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedUser))

      const { data, error } = await supabase.auth.updateUser({
        data: { name: 'Updated Name' },
      })

      expect(error).toBeNull()
      expect(data.user?.user_metadata.name).toBe('Updated Name')
    })

    it('should return error when not signed in', async () => {
      const { error } = await supabase.auth.updateUser({
        data: { name: 'Test' },
      })

      expect(error).toBeDefined()
      expect(error?.message).toContain('No active session')
    })
  })

  // ============================================================================
  // PASSWORD RESET
  // ============================================================================

  describe('resetPasswordForEmail', () => {
    it('should send password reset email', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}))

      const { error } = await supabase.auth.resetPasswordForEmail(
        'test@example.com'
      )

      expect(error).toBeNull()
      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_URL}/auth/v1/recover`,
        expect.any(Object)
      )
    })

    it('should include redirect URL option', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}))

      await supabase.auth.resetPasswordForEmail('test@example.com', {
        redirectTo: 'https://myapp.com/reset',
      })

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options.body)
      expect(body.redirect_to).toBe('https://myapp.com/reset')
    })
  })

  // ============================================================================
  // AUTH STATE CHANGE
  // ============================================================================

  describe('onAuthStateChange', () => {
    it('should subscribe to auth state changes', () => {
      const callback = vi.fn()
      const { data } = supabase.auth.onAuthStateChange(callback)

      expect(data.subscription).toBeDefined()
      expect(data.subscription.id).toBeDefined()
      expect(typeof data.subscription.unsubscribe).toBe('function')
    })

    it('should call callback on sign in', async () => {
      const callback = vi.fn()
      supabase.auth.onAuthStateChange(callback)

      // Sign in
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))
      await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'password123',
      })

      // Give it a tick for async callback
      await new Promise(resolve => setTimeout(resolve, 10))

      // Should have been called with SIGNED_IN
      const signedInCall = callback.mock.calls.find(
        (call) => call[0] === 'SIGNED_IN'
      )
      expect(signedInCall).toBeDefined()
    })

    it('should call callback on sign out', async () => {
      // First sign in
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))
      await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'password123',
      })

      const callback = vi.fn()
      supabase.auth.onAuthStateChange(callback)

      // Sign out
      await supabase.auth.signOut()

      // Give it a tick
      await new Promise(resolve => setTimeout(resolve, 10))

      // Should have been called with SIGNED_OUT
      const signedOutCall = callback.mock.calls.find(
        (call) => call[0] === 'SIGNED_OUT'
      )
      expect(signedOutCall).toBeDefined()
    })

    it('should unsubscribe correctly', async () => {
      const callback = vi.fn()
      const { data } = supabase.auth.onAuthStateChange(callback)

      // Unsubscribe
      data.subscription.unsubscribe()

      // Sign in
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))
      await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'password123',
      })

      // Give it a tick
      await new Promise(resolve => setTimeout(resolve, 10))

      // Should NOT have been called after unsubscribe
      const signedInCall = callback.mock.calls.find(
        (call) => call[0] === 'SIGNED_IN'
      )
      expect(signedInCall).toBeUndefined()
    })
  })

  // ============================================================================
  // MFA
  // ============================================================================

  describe('MFA', () => {
    beforeEach(async () => {
      // Sign in first for MFA tests
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))
      await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'password123',
      })
    })

    describe('enroll', () => {
      it('should enroll TOTP factor', async () => {
        const mockEnroll = {
          id: 'factor-123',
          type: 'totp',
          totp: {
            qr_code: 'data:image/svg+xml,...',
            secret: 'ABCDEFGHIJKLMNOP',
            uri: 'otpauth://totp/...',
          },
        }
        mockFetch.mockResolvedValueOnce(createMockResponse(mockEnroll))

        const { data, error } = await supabase.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: 'My Authenticator',
        })

        expect(error).toBeNull()
        expect(data?.id).toBe('factor-123')
        expect(data?.totp.secret).toBe('ABCDEFGHIJKLMNOP')
      })
    })

    describe('challenge', () => {
      it('should create MFA challenge', async () => {
        const mockChallenge = {
          id: 'challenge-123',
          type: 'totp',
          expires_at: Date.now() + 300000,
        }
        mockFetch.mockResolvedValueOnce(createMockResponse(mockChallenge))

        const { data, error } = await supabase.auth.mfa.challenge({
          factorId: 'factor-123',
        })

        expect(error).toBeNull()
        expect(data?.id).toBe('challenge-123')
      })
    })

    describe('verify', () => {
      it('should verify MFA challenge', async () => {
        const mockVerify = {
          user: createMockUser(),
          session: createMockSession(),
        }
        mockFetch.mockResolvedValueOnce(createMockResponse(mockVerify))

        const { data, error } = await supabase.auth.mfa.verify({
          factorId: 'factor-123',
          challengeId: 'challenge-123',
          code: '123456',
        })

        expect(error).toBeNull()
        expect(data?.session).toBeDefined()
      })
    })

    describe('listFactors', () => {
      it('should list enrolled factors', async () => {
        const mockFactors = [
          {
            id: 'factor-1',
            friendly_name: 'My Phone',
            factor_type: 'totp',
            status: 'verified',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]
        mockFetch.mockResolvedValueOnce(createMockResponse(mockFactors))

        const { data, error } = await supabase.auth.mfa.listFactors()

        expect(error).toBeNull()
        expect(data?.totp).toHaveLength(1)
        expect(data?.totp[0].friendly_name).toBe('My Phone')
      })
    })

    describe('unenroll', () => {
      it('should unenroll factor', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse({}))

        const { data, error } = await supabase.auth.mfa.unenroll({
          factorId: 'factor-123',
        })

        expect(error).toBeNull()
        expect(data?.id).toBe('factor-123')
      })
    })

    describe('getAuthenticatorAssuranceLevel', () => {
      it('should return current AAL', async () => {
        const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

        expect(error).toBeNull()
        expect(data?.currentLevel).toBe('aal1')
      })
    })
  })

  // ============================================================================
  // EXCHANGE CODE (PKCE)
  // ============================================================================

  describe('exchangeCodeForSession', () => {
    it('should exchange auth code for session', async () => {
      const mockSession = createMockSession()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSession))

      const { data, error } = await supabase.auth.exchangeCodeForSession('auth-code-123')

      expect(error).toBeNull()
      expect(data.session).toBeDefined()
    })
  })

  // ============================================================================
  // ADMIN METHODS
  // ============================================================================

  describe('admin methods', () => {
    describe('admin_createUser', () => {
      it('should create user with admin key', async () => {
        const mockUser = createMockUser()
        mockFetch.mockResolvedValueOnce(createMockResponse(mockUser))

        const { data, error } = await supabase.auth.admin_createUser({
          email: 'admin-created@example.com',
          password: 'password123',
          email_confirm: true,
        })

        expect(error).toBeNull()
        expect(data.user).toBeDefined()
      })
    })

    describe('admin_deleteUser', () => {
      it('should delete user with admin key', async () => {
        const mockUser = createMockUser()
        mockFetch.mockResolvedValueOnce(createMockResponse(mockUser))

        const { data, error } = await supabase.auth.admin_deleteUser('user-123')

        expect(error).toBeNull()
        expect(data.user).toBeDefined()
      })
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('error handling', () => {
    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { error } = await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'password123',
      })

      expect(error).toBeDefined()
      expect(error?.message).toBe('Network error')
    })

    it('should handle malformed responses', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Not JSON', { status: 200 })
      )

      const { error } = await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'password123',
      })

      expect(error).toBeDefined()
    })
  })
})
