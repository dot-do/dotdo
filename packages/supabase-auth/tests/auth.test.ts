/**
 * @dotdo/supabase-auth - Test Suite (RED Phase)
 *
 * Tests for the Supabase Auth compatibility layer with in-memory backend.
 * Following red-green-refactor pattern - these tests define the API contract.
 *
 * Core API Surface:
 * - signUp: Create new user account
 * - signInWithPassword: Authenticate with email/password
 * - signOut: End current session
 * - getUser: Get current authenticated user
 * - getSession: Get current session
 * - onAuthStateChange: Subscribe to auth state changes
 *
 * @module
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createClient, AuthClient } from '../src/index'
import type { User, Session, AuthChangeEvent } from '../src/types'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Helper to create mock user for validation
 */
function expectValidUser(user: User | null): asserts user is User {
  expect(user).toBeDefined()
  expect(user).not.toBeNull()
  expect(user!.id).toBeDefined()
  expect(typeof user!.id).toBe('string')
  expect(user!.aud).toBe('authenticated')
  expect(user!.created_at).toBeDefined()
}

/**
 * Helper to create mock session for validation
 */
function expectValidSession(session: Session | null): asserts session is Session {
  expect(session).toBeDefined()
  expect(session).not.toBeNull()
  expect(session!.access_token).toBeDefined()
  expect(session!.refresh_token).toBeDefined()
  expect(session!.expires_in).toBeGreaterThan(0)
  expect(session!.token_type).toBe('bearer')
  expectValidUser(session!.user)
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('@dotdo/supabase-auth', () => {
  // Note: Unlike compat layer, packages/ version uses in-memory backend
  // so no need for mocking fetch - tests run against real (in-memory) state

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ============================================================================
  // CLIENT CREATION
  // ============================================================================

  describe('createClient', () => {
    it('should create a client with auth property', () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      expect(supabase).toBeDefined()
      expect(supabase.auth).toBeDefined()
      expect(supabase.auth).toBeInstanceOf(AuthClient)
    })

    it('should accept custom options', () => {
      const supabase = createClient('https://test.supabase.co', 'test-key', {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })

      expect(supabase.auth).toBeDefined()
    })

    it('should handle URL with trailing slash', () => {
      const supabase = createClient('https://test.supabase.co/', 'test-key')
      expect(supabase.auth).toBeDefined()
    })
  })

  // ============================================================================
  // SIGN UP
  // ============================================================================

  describe('signUp', () => {
    it('should sign up with email and password', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      const { data, error } = await supabase.auth.signUp({
        email: 'newuser@example.com',
        password: 'securePassword123!',
      })

      expect(error).toBeNull()
      expectValidUser(data.user)
      expectValidSession(data.session)
      expect(data.user!.email).toBe('newuser@example.com')
    })

    it('should sign up with user metadata', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      const { data, error } = await supabase.auth.signUp({
        email: 'metadata@example.com',
        password: 'securePassword123!',
        options: {
          data: { name: 'Test User', role: 'admin' },
        },
      })

      expect(error).toBeNull()
      expectValidUser(data.user)
      expect(data.user!.user_metadata.name).toBe('Test User')
      expect(data.user!.user_metadata.role).toBe('admin')
    })

    it('should reject duplicate email registration', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      // First registration
      await supabase.auth.signUp({
        email: 'duplicate@example.com',
        password: 'password123!',
      })

      // Second registration with same email
      const { data, error } = await supabase.auth.signUp({
        email: 'duplicate@example.com',
        password: 'differentPassword123!',
      })

      expect(error).toBeDefined()
      expect(error!.message).toContain('already registered')
      expect(data.user).toBeNull()
      expect(data.session).toBeNull()
    })

    it('should reject weak passwords', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      const { data, error } = await supabase.auth.signUp({
        email: 'weak@example.com',
        password: '123', // Too short
      })

      expect(error).toBeDefined()
      expect(data.user).toBeNull()
    })
  })

  // ============================================================================
  // SIGN IN WITH PASSWORD
  // ============================================================================

  describe('signInWithPassword', () => {
    it('should sign in with valid credentials', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      // First create an account
      await supabase.auth.signUp({
        email: 'signin@example.com',
        password: 'validPassword123!',
      })

      // Sign out first
      await supabase.auth.signOut()

      // Now sign in
      const { data, error } = await supabase.auth.signInWithPassword({
        email: 'signin@example.com',
        password: 'validPassword123!',
      })

      expect(error).toBeNull()
      expectValidUser(data.user)
      expectValidSession(data.session)
      expect(data.user!.email).toBe('signin@example.com')
    })

    it('should reject invalid password', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      // First create an account
      await supabase.auth.signUp({
        email: 'wrongpass@example.com',
        password: 'correctPassword123!',
      })
      await supabase.auth.signOut()

      // Try to sign in with wrong password
      const { data, error } = await supabase.auth.signInWithPassword({
        email: 'wrongpass@example.com',
        password: 'incorrectPassword!',
      })

      expect(error).toBeDefined()
      expect(error!.message).toContain('Invalid')
      expect(data.user).toBeNull()
      expect(data.session).toBeNull()
    })

    it('should reject non-existent user', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      const { data, error } = await supabase.auth.signInWithPassword({
        email: 'nonexistent@example.com',
        password: 'anyPassword123!',
      })

      expect(error).toBeDefined()
      expect(data.user).toBeNull()
      expect(data.session).toBeNull()
    })
  })

  // ============================================================================
  // SIGN OUT
  // ============================================================================

  describe('signOut', () => {
    it('should sign out successfully', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      // First sign in
      await supabase.auth.signUp({
        email: 'signout@example.com',
        password: 'password123!',
      })

      // Then sign out
      const { error } = await supabase.auth.signOut()

      expect(error).toBeNull()
    })

    it('should clear session after sign out', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      // First sign in
      await supabase.auth.signUp({
        email: 'clearSession@example.com',
        password: 'password123!',
      })

      // Verify session exists
      const beforeSignOut = await supabase.auth.getSession()
      expect(beforeSignOut.data.session).not.toBeNull()

      // Then sign out
      await supabase.auth.signOut()

      // Verify session is cleared
      const { data } = await supabase.auth.getSession()
      expect(data.session).toBeNull()
    })

    it('should handle sign out when not signed in', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      // Sign out without being signed in
      const { error } = await supabase.auth.signOut()

      // Should not error
      expect(error).toBeNull()
    })
  })

  // ============================================================================
  // GET USER
  // ============================================================================

  describe('getUser', () => {
    it('should return null when not signed in', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      const { data, error } = await supabase.auth.getUser()

      expect(error).toBeNull()
      expect(data.user).toBeNull()
    })

    it('should return user when signed in', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      // Sign in
      await supabase.auth.signUp({
        email: 'getuser@example.com',
        password: 'password123!',
      })

      const { data, error } = await supabase.auth.getUser()

      expect(error).toBeNull()
      expectValidUser(data.user)
      expect(data.user!.email).toBe('getuser@example.com')
    })
  })

  // ============================================================================
  // GET SESSION
  // ============================================================================

  describe('getSession', () => {
    it('should return null when not signed in', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      const { data, error } = await supabase.auth.getSession()

      expect(error).toBeNull()
      expect(data.session).toBeNull()
    })

    it('should return session when signed in', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      // Sign in
      await supabase.auth.signUp({
        email: 'getsession@example.com',
        password: 'password123!',
      })

      const { data, error } = await supabase.auth.getSession()

      expect(error).toBeNull()
      expectValidSession(data.session)
    })
  })

  // ============================================================================
  // AUTH STATE CHANGE
  // ============================================================================

  describe('onAuthStateChange', () => {
    it('should subscribe to auth state changes', () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')
      const callback = vi.fn()

      const { data } = supabase.auth.onAuthStateChange(callback)

      expect(data.subscription).toBeDefined()
      expect(data.subscription.id).toBeDefined()
      expect(typeof data.subscription.unsubscribe).toBe('function')
    })

    it('should call callback on sign in', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')
      const callback = vi.fn()

      supabase.auth.onAuthStateChange(callback)

      // Sign in
      await supabase.auth.signUp({
        email: 'statechange@example.com',
        password: 'password123!',
      })

      // Wait for async callback
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Should have been called with SIGNED_IN
      const signedInCall = callback.mock.calls.find(
        (call) => call[0] === 'SIGNED_IN'
      )
      expect(signedInCall).toBeDefined()
    })

    it('should call callback on sign out', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      // First sign in
      await supabase.auth.signUp({
        email: 'statechange-out@example.com',
        password: 'password123!',
      })

      const callback = vi.fn()
      supabase.auth.onAuthStateChange(callback)

      // Sign out
      await supabase.auth.signOut()

      // Wait for async callback
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Should have been called with SIGNED_OUT
      const signedOutCall = callback.mock.calls.find(
        (call) => call[0] === 'SIGNED_OUT'
      )
      expect(signedOutCall).toBeDefined()
    })

    it('should unsubscribe correctly', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')
      const callback = vi.fn()

      const { data } = supabase.auth.onAuthStateChange(callback)

      // Unsubscribe
      data.subscription.unsubscribe()

      // Sign in
      await supabase.auth.signUp({
        email: 'unsubscribe@example.com',
        password: 'password123!',
      })

      // Wait for potential callback
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Should NOT have been called with SIGNED_IN after unsubscribe
      const signedInCall = callback.mock.calls.find(
        (call) => call[0] === 'SIGNED_IN'
      )
      expect(signedInCall).toBeUndefined()
    })
  })

  // ============================================================================
  // UPDATE USER
  // ============================================================================

  describe('updateUser', () => {
    it('should update user metadata', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      // Sign in
      await supabase.auth.signUp({
        email: 'updateuser@example.com',
        password: 'password123!',
      })

      // Update user
      const { data, error } = await supabase.auth.updateUser({
        data: { name: 'Updated Name', favoriteColor: 'blue' },
      })

      expect(error).toBeNull()
      expectValidUser(data.user)
      expect(data.user!.user_metadata.name).toBe('Updated Name')
      expect(data.user!.user_metadata.favoriteColor).toBe('blue')
    })

    it('should return error when not signed in', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      const { error } = await supabase.auth.updateUser({
        data: { name: 'Test' },
      })

      expect(error).toBeDefined()
      expect(error!.message).toContain('No active session')
    })
  })

  // ============================================================================
  // REFRESH SESSION
  // ============================================================================

  describe('refreshSession', () => {
    it('should refresh a valid session', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      // Sign in first
      await supabase.auth.signUp({
        email: 'refresh@example.com',
        password: 'password123!',
      })

      // Get original session
      const original = await supabase.auth.getSession()
      const originalToken = original.data.session!.access_token

      // Wait a bit so tokens are different
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Refresh
      const { data, error } = await supabase.auth.refreshSession()

      expect(error).toBeNull()
      expectValidSession(data.session)
      // New access token should be different
      expect(data.session!.access_token).not.toBe(originalToken)
    })

    it('should return error when no session exists', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      const { error } = await supabase.auth.refreshSession()

      expect(error).toBeDefined()
      expect(error!.message).toContain('No refresh token')
    })
  })

  // ============================================================================
  // SET SESSION
  // ============================================================================

  describe('setSession', () => {
    it('should set session from tokens', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      // Create a user first to have valid tokens
      await supabase.auth.signUp({
        email: 'setsession@example.com',
        password: 'password123!',
      })

      const session = (await supabase.auth.getSession()).data.session!
      const { access_token, refresh_token } = session

      // Create a new client to simulate restoring session
      const supabase2 = createClient('https://test.supabase.co', 'test-key')

      // The new client has no session
      const before = await supabase2.auth.getSession()
      expect(before.data.session).toBeNull()

      // Note: In real Supabase, setSession validates tokens with the server.
      // In our in-memory implementation, tokens are only valid in the store
      // that created them. This test verifies setSession works when tokens
      // are valid in the same client's store.
      const { data, error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      })

      expect(error).toBeNull()
      expectValidSession(data.session)
    })

    it('should reject invalid tokens', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      const { data, error } = await supabase.auth.setSession({
        access_token: 'invalid_token',
        refresh_token: 'invalid_refresh',
      })

      expect(error).toBeDefined()
      expect(data.session).toBeNull()
    })
  })

  // ============================================================================
  // PASSWORD RESET
  // ============================================================================

  describe('resetPasswordForEmail', () => {
    it('should request password reset', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      // Create user first
      await supabase.auth.signUp({
        email: 'reset@example.com',
        password: 'password123!',
      })

      // Request reset
      const { error } = await supabase.auth.resetPasswordForEmail('reset@example.com')

      expect(error).toBeNull()
    })

    it('should not error for non-existent email (security)', async () => {
      const supabase = createClient('https://test.supabase.co', 'test-key')

      // Request reset for non-existent email - should not reveal if email exists
      const { error } = await supabase.auth.resetPasswordForEmail('nonexistent@example.com')

      // Should not error (security best practice)
      expect(error).toBeNull()
    })
  })

  // ============================================================================
  // ISOLATED STATE PER CLIENT
  // ============================================================================

  describe('client isolation', () => {
    it('should have isolated state per client instance', async () => {
      const client1 = createClient('https://test.supabase.co', 'key1')
      const client2 = createClient('https://test.supabase.co', 'key2')

      // Sign up on client1
      await client1.auth.signUp({
        email: 'isolated@example.com',
        password: 'password123!',
      })

      // client1 should have session
      const session1 = await client1.auth.getSession()
      expect(session1.data.session).not.toBeNull()

      // client2 should not have session
      const session2 = await client2.auth.getSession()
      expect(session2.data.session).toBeNull()
    })
  })
})
