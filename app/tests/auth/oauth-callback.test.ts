/**
 * oauth.do Callback Handler Tests
 *
 * TDD RED Phase: Tests for /auth/callback route that handles OAuth callback
 *
 * These tests verify that:
 * 1. The callback handler exchanges the authorization code for tokens
 * 2. A session cookie is set after successful authentication
 * 3. User is redirected to the original destination
 * 4. Error handling works correctly for failed auth attempts
 *
 * All tests should FAIL initially - they define the expected behavior
 * before implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('OAuth Callback Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('/auth/callback route handler', () => {
    it('should exchange authorization code for session', async () => {
      // This import will fail until the module is created
      // RED phase: this test defines the expected API
      const { handleCallback } = await import('../../routes/auth-callback')

      // Mock callback request with authorization code
      const mockRequest = new Request(
        'http://localhost:3000/auth/callback?code=auth-code-123&state=%2Fdashboard'
      )

      // Execute
      const response = await handleCallback(mockRequest)

      // Assert - should redirect to the state URL (original destination)
      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe('/dashboard')
    })

    it('should set session cookie after successful auth', async () => {
      const { handleCallback } = await import('../../routes/auth-callback')

      const mockRequest = new Request(
        'http://localhost:3000/auth/callback?code=auth-code-123'
      )

      const response = await handleCallback(mockRequest)

      // Assert - Set-Cookie header should be present
      const setCookie = response.headers.get('Set-Cookie')
      expect(setCookie).toBeDefined()
      expect(setCookie).toContain('session')
      // Cookie should be HttpOnly for security
      expect(setCookie).toContain('HttpOnly')
      // Cookie should have SameSite attribute
      expect(setCookie).toMatch(/SameSite/)
    })

    it('should redirect to home if no state parameter provided', async () => {
      const { handleCallback } = await import('../../routes/auth-callback')

      // No state parameter in callback URL
      const mockRequest = new Request(
        'http://localhost:3000/auth/callback?code=auth-code-123'
      )

      const response = await handleCallback(mockRequest)

      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe('/')
    })

    it('should store user session data correctly', async () => {
      const { handleCallback, getSessionStore } = await import('../../routes/auth-callback')

      const mockRequest = new Request(
        'http://localhost:3000/auth/callback?code=auth-code-123'
      )

      await handleCallback(mockRequest)

      // Verify session store has data
      const sessionStore = await getSessionStore()
      expect(sessionStore).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('should redirect to login with error for missing code', async () => {
      const { handleCallback } = await import('../../routes/auth-callback')

      // No code parameter in callback URL
      const mockRequest = new Request(
        'http://localhost:3000/auth/callback?state=%2Fdashboard'
      )

      const response = await handleCallback(mockRequest)

      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toContain('/login')
      expect(response.headers.get('Location')).toContain('error=missing_code')
    })

    it('should redirect to login with error for OAuth error response', async () => {
      const { handleCallback } = await import('../../routes/auth-callback')

      // OAuth provider returned an error
      const mockRequest = new Request(
        'http://localhost:3000/auth/callback?error=access_denied&error_description=User%20denied%20access'
      )

      const response = await handleCallback(mockRequest)

      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toContain('/login')
      expect(response.headers.get('Location')).toContain('error=access_denied')
    })

    it('should handle token exchange failure gracefully', async () => {
      const { handleCallback, setMockTokenError } = await import('../../routes/auth-callback')

      // Set up token exchange to fail
      await setMockTokenError(new Error('Token exchange failed'))

      const mockRequest = new Request(
        'http://localhost:3000/auth/callback?code=invalid-code'
      )

      const response = await handleCallback(mockRequest)

      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toContain('/login')
      expect(response.headers.get('Location')).toContain('error=token_exchange_failed')
    })

    it('should handle user fetch failure gracefully', async () => {
      const { handleCallback, setMockUserError } = await import('../../routes/auth-callback')

      await setMockUserError(new Error('Failed to fetch user'))

      const mockRequest = new Request(
        'http://localhost:3000/auth/callback?code=auth-code-123'
      )

      const response = await handleCallback(mockRequest)

      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toContain('/login')
      expect(response.headers.get('Location')).toContain('error=user_fetch_failed')
    })
  })

  describe('security validations', () => {
    it('should validate state parameter to prevent CSRF', async () => {
      const { handleCallback, setExpectedState } = await import('../../routes/auth-callback')

      // Set expected state (would be stored when login redirect was initiated)
      await setExpectedState('expected-state-token')

      // Callback with different state (potential CSRF attack)
      const mockRequest = new Request(
        'http://localhost:3000/auth/callback?code=auth-code-123&state=malicious-state'
      )

      const response = await handleCallback(mockRequest)

      // Should reject mismatched state
      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toContain('/login')
      expect(response.headers.get('Location')).toContain('error=invalid_state')
    })

    it('should sanitize redirect URL to prevent open redirect', async () => {
      const { handleCallback } = await import('../../routes/auth-callback')

      // Malicious state trying to redirect to external site
      const mockRequest = new Request(
        'http://localhost:3000/auth/callback?code=auth-code-123&state=https%3A%2F%2Fevil.com%2Fphishing'
      )

      const response = await handleCallback(mockRequest)

      // Should NOT redirect to external URL
      expect(response.status).toBe(302)
      const location = response.headers.get('Location')
      expect(location).not.toContain('evil.com')
      // Should redirect to safe default
      expect(location).toBe('/')
    })

    it('should set secure cookie attributes', async () => {
      const { handleCallback } = await import('../../routes/auth-callback')

      const mockRequest = new Request(
        'http://localhost:3000/auth/callback?code=auth-code-123'
      )

      const response = await handleCallback(mockRequest)

      const setCookie = response.headers.get('Set-Cookie')
      // Should have security attributes
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('SameSite=Lax')
      // Path should be root to work across the app
      expect(setCookie).toContain('Path=/')
    })
  })
})
