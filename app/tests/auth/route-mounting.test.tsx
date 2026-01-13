/**
 * Auth Route Mounting Tests - oauth.do Integration
 *
 * TDD RED Phase: Tests for mounting auth routes in TanStack router
 *
 * These tests verify that:
 * 1. /login route exists and renders login form
 * 2. /auth/callback route exists and handles OAuth callback
 * 3. /auth/logout route exists and clears session
 * 4. OAuthProvider wraps the app correctly
 * 5. Protected routes redirect unauthenticated users
 *
 * All tests should FAIL initially - they define the expected behavior
 * before implementation.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryHistory, RouterProvider, createRouter, createRootRoute, createRoute } from '@tanstack/react-router'
import React, { type ReactNode } from 'react'

// Mock fumadocs-mdx:collections/browser to avoid import error
vi.mock('fumadocs-mdx:collections/browser', () => ({
  default: {},
}))

// Mock fumadocs-ui components
vi.mock('fumadocs-ui/layouts/docs/page', () => ({
  DocsBody: ({ children }: { children: ReactNode }) => <div data-testid="docs-body">{children}</div>,
  DocsDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DocsPage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DocsTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
}))

vi.mock('fumadocs-ui/mdx', () => ({
  default: {},
}))

vi.mock('fumadocs-ui/layouts/docs/toc', () => ({
  default: () => null,
  TableOfContents: () => null,
}))

vi.mock('fumadocs-ui/layouts/docs/breadcrumb', () => ({
  default: () => null,
  Breadcrumbs: () => null,
}))

// Mock fetch for API calls
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock window.location for redirect tests
const mockLocationAssign = vi.fn()
const originalLocation = window.location

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Setup mock location before each test
 */
function setupMockLocation() {
  // @ts-expect-error - deleting location for mock
  delete window.location
  window.location = {
    ...originalLocation,
    href: '',
    assign: mockLocationAssign,
    origin: 'http://localhost:3000',
  } as unknown as Location
}

/**
 * Restore original location after each test
 */
function restoreLocation() {
  window.location = originalLocation
}

/**
 * Create a test router with the route tree
 * This will fail until routes are properly mounted
 */
async function createTestRouter(initialPath: string = '/') {
  // Import the route tree - this should include our auth routes
  const { routeTree } = await import('../../src/routeTree.gen')

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [initialPath],
    }),
  })

  return router
}

/**
 * Render component with test router
 */
async function renderWithRouter(initialPath: string = '/') {
  const router = await createTestRouter(initialPath)

  render(<RouterProvider router={router} />)

  // Wait for router to be ready
  await waitFor(() => {
    expect(router.state.status).toBe('idle')
  })

  return router
}

// =============================================================================
// Test Suite: Login Route
// =============================================================================

describe('Login Route (/login)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMockLocation()

    // Default: unauthenticated session
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ authenticated: false }),
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
    restoreLocation()
  })

  describe('route exists', () => {
    it('should have /login route in router', async () => {
      // This test fails if /login route is not defined
      const router = await createTestRouter('/login')

      // Navigate to /login
      await router.navigate({ to: '/login' })

      // Should NOT redirect to 404 or other routes
      expect(router.state.location.pathname).toBe('/login')
    })

    it('should render login route without 404', async () => {
      await renderWithRouter('/login')

      // Should not show "not found" content
      expect(screen.queryByText(/not found/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/404/i)).not.toBeInTheDocument()
    })
  })

  describe('login page rendering', () => {
    it('should render login form on /login route', async () => {
      await renderWithRouter('/login')

      // Should have email input
      expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument()

      // Should have password input
      expect(document.querySelector('input[type="password"]')).toBeInTheDocument()

      // Should have submit button
      expect(screen.getByRole('button', { name: /sign in|log in|login/i })).toBeInTheDocument()
    })

    it('should render login page with oauth.do branding', async () => {
      await renderWithRouter('/login')

      // Should show some form of branding/logo
      expect(screen.getByTestId('auth-layout')).toBeInTheDocument()
    })

    it('should show "forgot password" link', async () => {
      await renderWithRouter('/login')

      expect(screen.getByRole('link', { name: /forgot password/i })).toBeInTheDocument()
    })

    it('should show "sign up" link for new users', async () => {
      await renderWithRouter('/login')

      expect(screen.getByRole('link', { name: /sign up|create account|register/i })).toBeInTheDocument()
    })
  })

  describe('login form submission', () => {
    it('should redirect to oauth.do authorization URL on form submission', async () => {
      await renderWithRouter('/login')

      const emailInput = screen.getByRole('textbox', { name: /email/i })
      const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement
      const submitButton = screen.getByRole('button', { name: /sign in|log in|login/i })

      // Fill form
      emailInput.focus()
      emailInput.dispatchEvent(new Event('input', { bubbles: true }))
      Object.defineProperty(emailInput, 'value', { value: 'test@example.com' })

      passwordInput.focus()
      passwordInput.dispatchEvent(new Event('input', { bubbles: true }))
      Object.defineProperty(passwordInput, 'value', { value: 'password123' })

      // Submit form
      submitButton.click()

      // Should redirect to oauth.do
      await waitFor(() => {
        expect(mockLocationAssign).toHaveBeenCalledWith(
          expect.stringContaining('login.oauth.do/authorize')
        )
      })
    })

    it('should include returnTo parameter when provided', async () => {
      await renderWithRouter('/login?returnTo=%2Fadmin')

      const submitButton = screen.getByRole('button', { name: /sign in|log in|login/i })
      submitButton.click()

      await waitFor(() => {
        expect(mockLocationAssign).toHaveBeenCalledWith(
          expect.stringContaining('state=')
        )
      })
    })
  })

  describe('already authenticated', () => {
    it('should redirect to home if already authenticated', async () => {
      // Setup authenticated session
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          authenticated: true,
          user: { id: 'user-123', email: 'test@example.com', name: 'Test User' },
        }),
      })

      const router = await renderWithRouter('/login')

      await waitFor(() => {
        // Should redirect away from /login
        expect(router.state.location.pathname).not.toBe('/login')
      })
    })

    it('should redirect to returnTo URL if already authenticated', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          authenticated: true,
          user: { id: 'user-123', email: 'test@example.com', name: 'Test User' },
        }),
      })

      const router = await renderWithRouter('/login?returnTo=%2Fadmin%2Fsettings')

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/admin/settings')
      })
    })
  })
})

// =============================================================================
// Test Suite: Auth Callback Route
// =============================================================================

describe('Auth Callback Route (/auth/callback)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMockLocation()

    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ authenticated: false }),
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
    restoreLocation()
  })

  describe('route exists', () => {
    it('should have /auth/callback route in router', async () => {
      const router = await createTestRouter('/auth/callback?code=test-code')

      await router.navigate({ to: '/auth/callback', search: { code: 'test-code' } })

      expect(router.state.location.pathname).toBe('/auth/callback')
    })

    it('should NOT render 404 for /auth/callback', async () => {
      await renderWithRouter('/auth/callback?code=test-code')

      expect(screen.queryByText(/not found/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/404/i)).not.toBeInTheDocument()
    })
  })

  describe('callback processing', () => {
    it('should process code parameter from OAuth provider', async () => {
      // Mock successful token exchange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'mock-access-token',
            refresh_token: 'mock-refresh-token',
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            sub: 'user-123',
            email: 'test@example.com',
            name: 'Test User',
          }),
        })

      const router = await renderWithRouter('/auth/callback?code=auth-code-123')

      await waitFor(() => {
        // Should redirect to home or specified returnTo after processing
        expect(router.state.location.pathname).toBe('/')
      })
    })

    it('should set session cookie on successful callback', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'mock-access-token',
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            sub: 'user-123',
            email: 'test@example.com',
            name: 'Test User',
          }),
        })

      await renderWithRouter('/auth/callback?code=auth-code-123')

      // The callback handler should have been called
      await waitFor(() => {
        // Cookie is set server-side, verify we redirected successfully
        expect(mockFetch).toHaveBeenCalled()
      })
    })

    it('should redirect to state URL when provided', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'mock-access-token',
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            sub: 'user-123',
            email: 'test@example.com',
          }),
        })

      const router = await renderWithRouter('/auth/callback?code=auth-code-123&state=%2Fadmin%2Fsettings')

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/admin/settings')
      })
    })

    it('should redirect to login on missing code parameter', async () => {
      const router = await renderWithRouter('/auth/callback')

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/login')
        expect(router.state.location.search).toContain('error=missing_code')
      })
    })

    it('should redirect to login on OAuth error response', async () => {
      const router = await renderWithRouter('/auth/callback?error=access_denied&error_description=User%20cancelled')

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/login')
        expect(router.state.location.search).toContain('error=access_denied')
      })
    })
  })

  describe('CSRF validation', () => {
    it('should validate state parameter matches stored value', async () => {
      // This test verifies state validation - implementation detail
      const router = await renderWithRouter('/auth/callback?code=test-code&state=invalid-state')

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/login')
        expect(router.state.location.search).toContain('error=invalid_state')
      })
    })
  })
})

// =============================================================================
// Test Suite: Auth Logout Route
// =============================================================================

describe('Auth Logout Route (/auth/logout)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMockLocation()
  })

  afterEach(() => {
    vi.resetAllMocks()
    restoreLocation()
  })

  describe('route exists', () => {
    it('should have /auth/logout route in router', async () => {
      const router = await createTestRouter('/auth/logout')

      expect(router.state.location.pathname).toBe('/auth/logout')
    })
  })

  describe('logout behavior', () => {
    it('should clear session cookie on logout', async () => {
      // Setup authenticated session
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const router = await renderWithRouter('/auth/logout')

      await waitFor(() => {
        // Should call logout endpoint
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/auth/logout'),
          expect.objectContaining({
            method: 'POST',
            credentials: 'include',
          })
        )
      })
    })

    it('should redirect to home page after logout', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const router = await renderWithRouter('/auth/logout')

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/')
      })
    })

    it('should redirect to specified URL after logout', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const router = await renderWithRouter('/auth/logout?returnTo=%2Flogin')

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/login')
      })
    })

    it('should revoke tokens on oauth.do before redirect', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      await renderWithRouter('/auth/logout')

      await waitFor(() => {
        // Verify revoke endpoint was called
        expect(mockFetch).toHaveBeenCalled()
      })
    })
  })

  describe('error handling', () => {
    it('should still redirect even if logout fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const router = await renderWithRouter('/auth/logout')

      await waitFor(() => {
        // Should still redirect to home even on error
        expect(router.state.location.pathname).toBe('/')
      })
    })
  })
})

// =============================================================================
// Test Suite: OAuthProvider Integration
// =============================================================================

describe('OAuthProvider Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMockLocation()

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        authenticated: true,
        user: { id: 'user-123', email: 'test@example.com', name: 'Test User' },
      }),
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
    restoreLocation()
  })

  describe('provider wraps app', () => {
    it('should have OAuthProvider in __root.tsx', async () => {
      // Import __root.tsx to verify OAuthProvider is used
      const { Route } = await import('../../routes/__root')

      // The route should exist
      expect(Route).toBeDefined()

      // Render the app and verify auth context works
      await renderWithRouter('/')

      // If OAuthProvider is present, useAuth hook should work
      // This is verified by not throwing "useAuth must be used within OAuthProvider"
    })

    it('should provide auth state to child components', async () => {
      await renderWithRouter('/')

      // Session endpoint should be called on mount
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/auth/session'),
          expect.objectContaining({
            credentials: 'include',
          })
        )
      })
    })
  })

  describe('useAuth hook availability', () => {
    it('should provide isAuthenticated state', async () => {
      await renderWithRouter('/')

      // The app should render without errors when useAuth is called
      // This implicitly tests that OAuthProvider is present
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled()
      })
    })

    it('should provide user data when authenticated', async () => {
      await renderWithRouter('/admin')

      await waitFor(() => {
        // If authenticated, admin shell should render with user data
        expect(screen.getByTestId('admin-shell')).toBeInTheDocument()
      })
    })
  })
})

// =============================================================================
// Test Suite: Protected Routes
// =============================================================================

describe('Protected Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMockLocation()
  })

  afterEach(() => {
    vi.resetAllMocks()
    restoreLocation()
  })

  describe('/admin routes', () => {
    it('should redirect to /login when unauthenticated', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ authenticated: false }),
      })

      const router = await renderWithRouter('/admin')

      await waitFor(() => {
        // Should redirect to login
        expect(router.state.location.pathname).toContain('/login')
      })
    })

    it('should include returnTo parameter in login redirect', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ authenticated: false }),
      })

      const router = await renderWithRouter('/admin/settings')

      await waitFor(() => {
        expect(router.state.location.pathname).toContain('/login')
        // Should have redirect parameter
        expect(router.state.location.search).toContain('redirect')
      })
    })

    it('should render admin dashboard when authenticated', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          authenticated: true,
          user: { id: 'user-123', email: 'admin@example.com', name: 'Admin User' },
        }),
      })

      await renderWithRouter('/admin')

      await waitFor(() => {
        expect(screen.getByTestId('admin-shell')).toBeInTheDocument()
      })
    })

    it('should show loading state while checking auth', async () => {
      // Create a slow auth check
      mockFetch.mockImplementation(() =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: () =>
                  Promise.resolve({
                    authenticated: true,
                    user: { id: 'user-123', email: 'test@example.com' },
                  }),
              }),
            100
          )
        )
      )

      // Start rendering - should show loading state initially
      const renderPromise = renderWithRouter('/admin')

      // Loading spinner should be visible
      await waitFor(() => {
        const loadingSpinner = document.querySelector('.animate-spin')
        expect(loadingSpinner).toBeInTheDocument()
      })

      await renderPromise
    })
  })

  describe('/app routes', () => {
    it('should redirect to /login when unauthenticated', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ authenticated: false }),
      })

      const router = await renderWithRouter('/app')

      await waitFor(() => {
        expect(router.state.location.pathname).toContain('/login')
      })
    })

    it('should include returnTo parameter for /app routes', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ authenticated: false }),
      })

      const router = await renderWithRouter('/app/projects')

      await waitFor(() => {
        expect(router.state.location.search).toContain('redirect')
      })
    })

    it('should render app shell when authenticated', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          authenticated: true,
          user: { id: 'user-123', email: 'user@example.com', name: 'App User' },
        }),
      })

      await renderWithRouter('/app')

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument()
      })
    })
  })

  describe('public routes remain accessible', () => {
    it('should render landing page without auth', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ authenticated: false }),
      })

      await renderWithRouter('/')

      // Should NOT redirect to login
      await waitFor(() => {
        expect(screen.queryByText(/sign in|log in/i)).not.toBeInTheDocument()
      })
    })

    it('should render docs without auth', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ authenticated: false }),
      })

      await renderWithRouter('/docs')

      // Docs should be accessible without authentication
      expect(screen.queryByTestId('auth-redirect')).not.toBeInTheDocument()
    })

    it('should render /admin/login without auth redirect', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ authenticated: false }),
      })

      const router = await renderWithRouter('/admin/login')

      await waitFor(() => {
        // Should stay on login page, not redirect
        expect(router.state.location.pathname).toBe('/admin/login')
      })
    })

    it('should render /admin/signup without auth redirect', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ authenticated: false }),
      })

      const router = await renderWithRouter('/admin/signup')

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/admin/signup')
      })
    })
  })
})

// =============================================================================
// Test Suite: Session Persistence
// =============================================================================

describe('Session Persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMockLocation()
  })

  afterEach(() => {
    vi.resetAllMocks()
    restoreLocation()
  })

  describe('session restoration', () => {
    it('should restore session from cookie on app load', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          authenticated: true,
          user: { id: 'user-123', email: 'test@example.com', name: 'Test User' },
        }),
      })

      await renderWithRouter('/')

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/auth/session'),
          expect.objectContaining({
            credentials: 'include',
          })
        )
      })
    })

    it('should maintain auth state across route changes', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          authenticated: true,
          user: { id: 'user-123', email: 'test@example.com', name: 'Test User' },
        }),
      })

      const router = await renderWithRouter('/admin')

      await waitFor(() => {
        expect(screen.getByTestId('admin-shell')).toBeInTheDocument()
      })

      // Navigate to another protected route
      await router.navigate({ to: '/admin/settings' })

      await waitFor(() => {
        // Should still be authenticated, not redirect to login
        expect(router.state.location.pathname).toBe('/admin/settings')
      })
    })
  })

  describe('session expiration', () => {
    it('should redirect to login when session expires', async () => {
      // First call: authenticated
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          authenticated: true,
          user: { id: 'user-123', email: 'test@example.com' },
        }),
      })

      const router = await renderWithRouter('/admin')

      await waitFor(() => {
        expect(screen.getByTestId('admin-shell')).toBeInTheDocument()
      })

      // Simulate session expiration on next check
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ authenticated: false }),
      })

      // Trigger session refresh (e.g., by navigating)
      await router.navigate({ to: '/admin/users' })

      await waitFor(() => {
        // Should eventually redirect to login
        expect(router.state.location.pathname).toContain('/login')
      })
    })
  })
})
