/**
 * useAuth Hook Tests - oauth.do Integration
 *
 * TDD RED Phase: Tests for useAuth hook with real oauth.do /auth/session endpoint
 *
 * These tests verify that:
 * 1. useAuth hook fetches session from real /auth/session endpoint (not mock)
 * 2. Hook provides correct authentication state
 * 3. Login/logout functions interact with oauth.do properly
 * 4. Session refresh works correctly
 *
 * All tests should FAIL initially - they define the expected behavior
 * before implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'

// Mock fetch for API calls
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('useAuth Hook - oauth.do Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('session endpoint integration', () => {
    it('should call /auth/session endpoint on mount', async () => {
      // Setup mock response for session check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            authenticated: true,
            user: { id: 'user-123', email: 'test@example.com', name: 'Test User' },
          }),
      })

      // Import the hook - will fail until implemented with real oauth.do integration
      const { useAuth, OAuthProvider } = await import('../../hooks/use-oauth')

      // Test component that uses the hook
      function TestComponent() {
        const { isAuthenticated, user, isLoading } = useAuth()
        return (
          <div>
            <span data-testid="loading">{isLoading.toString()}</span>
            <span data-testid="authenticated">{isAuthenticated.toString()}</span>
            <span data-testid="user-email">{user?.email ?? 'none'}</span>
          </div>
        )
      }

      render(
        <OAuthProvider>
          <TestComponent />
        </OAuthProvider>
      )

      // Should have called /auth/session
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/auth/session'),
          expect.objectContaining({
            credentials: 'include', // Important for cookie-based auth
          })
        )
      })
    })

    it('should update state with user data from session endpoint', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        avatar: 'https://example.com/avatar.png',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            authenticated: true,
            user: mockUser,
          }),
      })

      const { useAuth, OAuthProvider } = await import('../../hooks/use-oauth')

      function TestComponent() {
        const { isAuthenticated, user, isLoading } = useAuth()
        return (
          <div>
            <span data-testid="loading">{isLoading.toString()}</span>
            <span data-testid="authenticated">{isAuthenticated.toString()}</span>
            <span data-testid="user-email">{user?.email ?? 'none'}</span>
            <span data-testid="user-name">{user?.name ?? 'none'}</span>
          </div>
        )
      }

      render(
        <OAuthProvider>
          <TestComponent />
        </OAuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      expect(screen.getByTestId('authenticated').textContent).toBe('true')
      expect(screen.getByTestId('user-email').textContent).toBe('test@example.com')
      expect(screen.getByTestId('user-name').textContent).toBe('Test User')
    })

    it('should set unauthenticated state when session returns 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            authenticated: false,
            error: 'Not authenticated',
          }),
      })

      const { useAuth, OAuthProvider } = await import('../../hooks/use-oauth')

      function TestComponent() {
        const { isAuthenticated, user, isLoading } = useAuth()
        return (
          <div>
            <span data-testid="loading">{isLoading.toString()}</span>
            <span data-testid="authenticated">{isAuthenticated.toString()}</span>
            <span data-testid="user-email">{user?.email ?? 'none'}</span>
          </div>
        )
      }

      render(
        <OAuthProvider>
          <TestComponent />
        </OAuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      expect(screen.getByTestId('authenticated').textContent).toBe('false')
      expect(screen.getByTestId('user-email').textContent).toBe('none')
    })
  })

  describe('login function', () => {
    it('should redirect to /login route when login() is called', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ authenticated: false }),
      })

      // Mock window.location
      const originalLocation = window.location
      // @ts-expect-error - deleting location for mock
      delete window.location
      window.location = { ...originalLocation, href: '', assign: vi.fn() } as unknown as Location

      const { useAuth, OAuthProvider } = await import('../../hooks/use-oauth')

      let loginFn: () => void

      function TestComponent() {
        const { login, isAuthenticated } = useAuth()
        loginFn = login
        return <span data-testid="authenticated">{isAuthenticated.toString()}</span>
      }

      render(
        <OAuthProvider>
          <TestComponent />
        </OAuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('authenticated').textContent).toBe('false')
      })

      // Call login
      act(() => {
        loginFn()
      })

      // Should redirect to login page
      expect(window.location.assign).toHaveBeenCalledWith(
        expect.stringContaining('/login')
      )

      // Restore window.location
      window.location = originalLocation
    })

    it('should pass returnTo parameter when calling login with redirect', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ authenticated: false }),
      })

      const originalLocation = window.location
      // @ts-expect-error - deleting location for mock
      delete window.location
      window.location = { ...originalLocation, href: '', assign: vi.fn() } as unknown as Location

      const { useAuth, OAuthProvider } = await import('../../hooks/use-oauth')

      let loginFn: (returnTo?: string) => void

      function TestComponent() {
        const { login } = useAuth()
        loginFn = login
        return <div>Test</div>
      }

      render(
        <OAuthProvider>
          <TestComponent />
        </OAuthProvider>
      )

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled()
      })

      // Call login with returnTo
      act(() => {
        loginFn('/dashboard/settings')
      })

      expect(window.location.assign).toHaveBeenCalledWith(
        expect.stringContaining('returnTo=%2Fdashboard%2Fsettings')
      )

      window.location = originalLocation
    })
  })

  describe('logout function', () => {
    it('should call /auth/logout endpoint when logout() is called', async () => {
      // Initial authenticated state
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              authenticated: true,
              user: { id: 'user-123', email: 'test@example.com' },
            }),
        })
        // Logout endpoint response
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })

      const { useAuth, OAuthProvider } = await import('../../hooks/use-oauth')

      let logoutFn: () => Promise<void>

      function TestComponent() {
        const { logout, isAuthenticated } = useAuth()
        logoutFn = logout
        return <span data-testid="authenticated">{isAuthenticated.toString()}</span>
      }

      render(
        <OAuthProvider>
          <TestComponent />
        </OAuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('authenticated').textContent).toBe('true')
      })

      // Call logout
      await act(async () => {
        await logoutFn()
      })

      // Should have called /auth/logout
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/logout'),
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
        })
      )
    })

    it('should clear user state after logout', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              authenticated: true,
              user: { id: 'user-123', email: 'test@example.com' },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })

      const { useAuth, OAuthProvider } = await import('../../hooks/use-oauth')

      let logoutFn: () => Promise<void>

      function TestComponent() {
        const { logout, isAuthenticated, user } = useAuth()
        logoutFn = logout
        return (
          <div>
            <span data-testid="authenticated">{isAuthenticated.toString()}</span>
            <span data-testid="user-email">{user?.email ?? 'none'}</span>
          </div>
        )
      }

      render(
        <OAuthProvider>
          <TestComponent />
        </OAuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('authenticated').textContent).toBe('true')
      })

      await act(async () => {
        await logoutFn()
      })

      expect(screen.getByTestId('authenticated').textContent).toBe('false')
      expect(screen.getByTestId('user-email').textContent).toBe('none')
    })
  })

  describe('session refresh', () => {
    it('should provide refreshSession function', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            authenticated: true,
            user: { id: 'user-123', email: 'old@example.com' },
          }),
      })

      const { useAuth, OAuthProvider } = await import('../../hooks/use-oauth')

      let refreshFn: () => Promise<void>

      function TestComponent() {
        const { refreshSession, user } = useAuth()
        refreshFn = refreshSession
        return <span data-testid="user-email">{user?.email ?? 'none'}</span>
      }

      render(
        <OAuthProvider>
          <TestComponent />
        </OAuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('user-email').textContent).toBe('old@example.com')
      })

      // Mock new session response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            authenticated: true,
            user: { id: 'user-123', email: 'new@example.com' },
          }),
      })

      // Refresh session
      await act(async () => {
        await refreshFn()
      })

      expect(screen.getByTestId('user-email').textContent).toBe('new@example.com')
    })
  })

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { useAuth, OAuthProvider } = await import('../../hooks/use-oauth')

      function TestComponent() {
        const { isAuthenticated, isLoading, error } = useAuth()
        return (
          <div>
            <span data-testid="loading">{isLoading.toString()}</span>
            <span data-testid="authenticated">{isAuthenticated.toString()}</span>
            <span data-testid="error">{error ?? 'none'}</span>
          </div>
        )
      }

      render(
        <OAuthProvider>
          <TestComponent />
        </OAuthProvider>
      )

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false')
      })

      // Should be unauthenticated on network error
      expect(screen.getByTestId('authenticated').textContent).toBe('false')
      // Should have error state
      expect(screen.getByTestId('error').textContent).not.toBe('none')
    })

    it('should throw error when useAuth is used outside OAuthProvider', async () => {
      const { useAuth } = await import('../../hooks/use-oauth')

      // Suppress console.error for this test
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      function TestComponent() {
        const { isAuthenticated } = useAuth()
        return <span>{isAuthenticated.toString()}</span>
      }

      expect(() => {
        render(<TestComponent />)
      }).toThrow('useAuth must be used within an OAuthProvider')

      consoleError.mockRestore()
    })
  })
})
