/**
 * oauth.do Login Redirect Tests
 *
 * TDD RED Phase: Tests for /login route that should redirect to oauth.do
 *
 * These tests verify that:
 * 1. The /login route calls oauth.do's buildAuthUrl()
 * 2. Users are redirected to oauth.do for authentication
 * 3. Proper redirect URI and scope are passed
 *
 * All tests should FAIL initially - they define the expected behavior
 * before implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('OAuth Login Redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('/login route handler', () => {
    it('should call buildAuthUrl with correct redirectUri', async () => {
      // This import will fail until the module is created
      // RED phase: this test defines the expected API
      const { handleLogin } = await import('../../routes/login')

      // Create mock request
      const mockRequest = new Request('http://localhost:3000/login')

      // Execute
      const response = await handleLogin(mockRequest)

      // Assert - should redirect with oauth.do URL containing callback
      expect(response.status).toBe(302)
      const location = response.headers.get('Location')
      expect(location).toContain('/auth/callback')
    })

    it('should redirect to oauth.do authorize URL', async () => {
      const { handleLogin } = await import('../../routes/login')
      const mockRequest = new Request('http://localhost:3000/login')

      // Execute
      const response = await handleLogin(mockRequest)

      // Assert - should be a redirect response to oauth.do
      expect(response.status).toBe(302)
      const location = response.headers.get('Location')
      expect(location).toContain('oauth.do')
    })

    it('should pass default scope to buildAuthUrl', async () => {
      const { handleLogin } = await import('../../routes/login')
      const mockRequest = new Request('http://localhost:3000/login')

      const response = await handleLogin(mockRequest)

      const location = response.headers.get('Location')
      expect(location).toContain('scope=')
      expect(location).toContain('openid')
    })

    it('should include profile and email scopes by default', async () => {
      const { handleLogin } = await import('../../routes/login')
      const mockRequest = new Request('http://localhost:3000/login')

      const response = await handleLogin(mockRequest)

      const location = response.headers.get('Location')
      expect(location).toMatch(/profile|email/)
    })

    it('should preserve return URL in state parameter', async () => {
      const { handleLogin } = await import('../../routes/login')
      // User tried to access /dashboard before being redirected to login
      const mockRequest = new Request('http://localhost:3000/login?returnTo=/dashboard')

      const response = await handleLogin(mockRequest)

      const location = response.headers.get('Location')
      expect(location).toContain('state=')
      // State should encode the return URL
      expect(location).toContain(encodeURIComponent('/dashboard'))
    })
  })

  describe('authenticated user redirect', () => {
    it('should redirect authenticated users to home instead of oauth.do', async () => {
      const { handleLogin, setMockAuthenticated } = await import('../../routes/login')

      // Set authenticated state (mock helper)
      await setMockAuthenticated(true)

      const mockRequest = new Request('http://localhost:3000/login')
      const response = await handleLogin(mockRequest)

      // Should redirect to home, not to oauth.do
      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe('/')
    })

    it('should redirect authenticated users to returnTo URL if provided', async () => {
      const { handleLogin, setMockAuthenticated } = await import('../../routes/login')

      await setMockAuthenticated(true)

      const mockRequest = new Request('http://localhost:3000/login?returnTo=/dashboard')
      const response = await handleLogin(mockRequest)

      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe('/dashboard')
    })
  })

  describe('error handling', () => {
    it('should handle oauth.do service errors gracefully', async () => {
      const { handleLogin, setMockOAuthError } = await import('../../routes/login')

      // Simulate oauth.do service error
      await setMockOAuthError(new Error('Service unavailable'))

      const mockRequest = new Request('http://localhost:3000/login')
      const response = await handleLogin(mockRequest)

      // Should redirect to error page or show error
      expect([302, 500, 503]).toContain(response.status)
    })
  })
})
