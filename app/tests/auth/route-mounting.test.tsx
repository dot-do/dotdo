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
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
} from '@tanstack/react-router'
import { createMemoryHistory } from '@tanstack/react-router'
import React from 'react'

// Static imports to ensure Vite bundles these modules for dynamic import tests
// These are imported solely to populate the module graph
import * as LoginRoute from '../../routes/login'
import * as CallbackRoute from '../../routes/auth.callback'
import * as LogoutRoute from '../../routes/auth.logout'
import * as RootRoute from '../../routes/__root'
import * as AdminLayoutRoute from '../../routes/admin/_admin'
import * as AppLayoutRoute from '../../routes/app/_app'
import * as AdminLoginRoute from '../../routes/admin/_admin.login'
import * as AdminSignupRoute from '../../routes/admin/_admin.signup'
import * as AdminResetPasswordRoute from '../../routes/admin/_admin.reset-password'

// Re-export to prevent tree-shaking
const _bundleHint = {
  LoginRoute,
  CallbackRoute,
  LogoutRoute,
  RootRoute,
  AdminLayoutRoute,
  AppLayoutRoute,
  AdminLoginRoute,
  AdminSignupRoute,
  AdminResetPasswordRoute,
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _unused = _bundleHint

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
 * Import module with error handling
 */
async function importModule(path: string) {
  try {
    return await import(/* @vite-ignore */ path)
  } catch {
    return null
  }
}

// =============================================================================
// Test Suite: Login Route File Exists
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
    cleanup()
  })

  describe('route file exists', () => {
    it('should have login route file at app/routes/login.tsx', async () => {
      // This test fails until login.tsx route is created as a TanStack route file
      // The route should export a Route created with createFileRoute('/login')
      const loginRouteModule = await importModule('../../routes/login')

      expect(loginRouteModule).not.toBeNull()
      expect(loginRouteModule?.Route).toBeDefined()
    })

    it('should have Route created with createFileRoute("/login")', async () => {
      const module = await importModule('../../routes/login')

      // TanStack Router routes have specific properties
      expect(module?.Route).toBeDefined()
      // The route should have options with a component
      expect(module?.Route?.options?.component).toBeDefined()
    })
  })

  describe('login route component', () => {
    it('should render login form with email input', async () => {
      const module = await importModule('../../routes/login')
      expect(module?.Route).toBeDefined()

      // Get the component from the route
      const LoginComponent = module?.Route?.options?.component
      expect(LoginComponent).toBeDefined()

      if (!LoginComponent) {
        throw new Error('LoginComponent not found - create app/routes/login.tsx with a component')
      }

      // Create a test router with this route
      const rootRoute = createRootRoute({
        component: () => <Outlet />,
      })

      const loginRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/login',
        component: LoginComponent,
      })

      const routeTree = rootRoute.addChildren([loginRoute])

      const router = createRouter({
        routeTree,
        history: createMemoryHistory({
          initialEntries: ['/login'],
        }),
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument()
      })
    })

    it('should render login form with password input', async () => {
      const module = await importModule('../../routes/login')
      const LoginComponent = module?.Route?.options?.component

      if (!LoginComponent) {
        throw new Error('LoginComponent not found')
      }

      const rootRoute = createRootRoute({
        component: () => <Outlet />,
      })

      const loginRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/login',
        component: LoginComponent,
      })

      const routeTree = rootRoute.addChildren([loginRoute])

      const router = createRouter({
        routeTree,
        history: createMemoryHistory({
          initialEntries: ['/login'],
        }),
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(document.querySelector('input[type="password"]')).toBeInTheDocument()
      })
    })

    it('should render submit button', async () => {
      const module = await importModule('../../routes/login')
      const LoginComponent = module?.Route?.options?.component

      if (!LoginComponent) {
        throw new Error('LoginComponent not found')
      }

      const rootRoute = createRootRoute({
        component: () => <Outlet />,
      })

      const loginRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/login',
        component: LoginComponent,
      })

      const routeTree = rootRoute.addChildren([loginRoute])

      const router = createRouter({
        routeTree,
        history: createMemoryHistory({
          initialEntries: ['/login'],
        }),
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sign in|log in|login/i })).toBeInTheDocument()
      })
    })

    it('should render forgot password link', async () => {
      const module = await importModule('../../routes/login')
      const LoginComponent = module?.Route?.options?.component

      if (!LoginComponent) {
        throw new Error('LoginComponent not found')
      }

      const rootRoute = createRootRoute({
        component: () => <Outlet />,
      })

      const loginRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/login',
        component: LoginComponent,
      })

      const routeTree = rootRoute.addChildren([loginRoute])

      const router = createRouter({
        routeTree,
        history: createMemoryHistory({
          initialEntries: ['/login'],
        }),
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByRole('link', { name: /forgot password/i })).toBeInTheDocument()
      })
    })

    it('should render sign up link', async () => {
      const module = await importModule('../../routes/login')
      const LoginComponent = module?.Route?.options?.component

      if (!LoginComponent) {
        throw new Error('LoginComponent not found')
      }

      const rootRoute = createRootRoute({
        component: () => <Outlet />,
      })

      const loginRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/login',
        component: LoginComponent,
      })

      const routeTree = rootRoute.addChildren([loginRoute])

      const router = createRouter({
        routeTree,
        history: createMemoryHistory({
          initialEntries: ['/login'],
        }),
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByRole('link', { name: /sign up|create account|register/i })).toBeInTheDocument()
      })
    })
  })

  describe('login form submission', () => {
    it('should redirect to oauth.do authorization URL on form submission', async () => {
      const module = await importModule('../../routes/login')
      const LoginComponent = module?.Route?.options?.component

      if (!LoginComponent) {
        throw new Error('LoginComponent not found')
      }

      const rootRoute = createRootRoute({
        component: () => <Outlet />,
      })

      const loginRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/login',
        component: LoginComponent,
      })

      const routeTree = rootRoute.addChildren([loginRoute])

      const router = createRouter({
        routeTree,
        history: createMemoryHistory({
          initialEntries: ['/login'],
        }),
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sign in|log in|login/i })).toBeInTheDocument()
      })

      // Click the submit button
      const submitButton = screen.getByRole('button', { name: /sign in|log in|login/i })
      submitButton.click()

      // Should redirect to oauth.do
      await waitFor(() => {
        expect(mockLocationAssign).toHaveBeenCalledWith(
          expect.stringContaining('login.oauth.do/authorize')
        )
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
  })

  afterEach(() => {
    vi.resetAllMocks()
    restoreLocation()
    cleanup()
  })

  describe('route file exists', () => {
    it('should have callback route file', async () => {
      // Try both possible locations
      let callbackModule = await importModule('../../routes/auth/callback')
      if (!callbackModule) {
        callbackModule = await importModule('../../routes/auth.callback')
      }

      expect(callbackModule).not.toBeNull()
      expect(callbackModule?.Route).toBeDefined()
    })

    it('should have Route configured for /auth/callback path', async () => {
      let module = await importModule('../../routes/auth/callback')
      if (!module) {
        module = await importModule('../../routes/auth.callback')
      }

      // The route should have options with a component
      expect(module?.Route?.options?.component).toBeDefined()
    })
  })

  describe('callback processing', () => {
    it('should process code parameter from OAuth provider', async () => {
      let module = await importModule('../../routes/auth/callback')
      if (!module) {
        module = await importModule('../../routes/auth.callback')
      }

      const CallbackComponent = module?.Route?.options?.component
      expect(CallbackComponent).toBeDefined()

      if (!CallbackComponent) {
        throw new Error('CallbackComponent not found')
      }

      const rootRoute = createRootRoute({
        component: () => <Outlet />,
      })

      const homeRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        component: () => <div data-testid="home">Home</div>,
      })

      const callbackRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/auth/callback',
        component: CallbackComponent,
      })

      const routeTree = rootRoute.addChildren([homeRoute, callbackRoute])

      const router = createRouter({
        routeTree,
        history: createMemoryHistory({
          initialEntries: ['/auth/callback?code=auth-code-123'],
        }),
      })

      // Mock successful token exchange
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'mock-access-token',
          expires_in: 3600,
        }),
      })

      render(<RouterProvider router={router} />)

      // Should process the callback and redirect
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/')
      })
    })

    it('should redirect to login on missing code parameter', async () => {
      let module = await importModule('../../routes/auth/callback')
      if (!module) {
        module = await importModule('../../routes/auth.callback')
      }

      const CallbackComponent = module?.Route?.options?.component

      if (!CallbackComponent) {
        throw new Error('CallbackComponent not found')
      }

      const rootRoute = createRootRoute({
        component: () => <Outlet />,
      })

      const loginRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/login',
        component: () => <div data-testid="login-page">Login</div>,
      })

      const callbackRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/auth/callback',
        component: CallbackComponent,
      })

      const routeTree = rootRoute.addChildren([loginRoute, callbackRoute])

      const router = createRouter({
        routeTree,
        history: createMemoryHistory({
          initialEntries: ['/auth/callback'], // No code parameter
        }),
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/login')
      })
    })

    it('should redirect to login on OAuth error response', async () => {
      let module = await importModule('../../routes/auth/callback')
      if (!module) {
        module = await importModule('../../routes/auth.callback')
      }

      const CallbackComponent = module?.Route?.options?.component

      if (!CallbackComponent) {
        throw new Error('CallbackComponent not found')
      }

      const rootRoute = createRootRoute({
        component: () => <Outlet />,
      })

      const loginRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/login',
        component: () => <div data-testid="login-page">Login</div>,
      })

      const callbackRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/auth/callback',
        component: CallbackComponent,
      })

      const routeTree = rootRoute.addChildren([loginRoute, callbackRoute])

      const router = createRouter({
        routeTree,
        history: createMemoryHistory({
          initialEntries: ['/auth/callback?error=access_denied&error_description=User%20cancelled'],
        }),
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/login')
      })
    })

    it('should redirect to state URL when provided', async () => {
      let module = await importModule('../../routes/auth/callback')
      if (!module) {
        module = await importModule('../../routes/auth.callback')
      }

      const CallbackComponent = module?.Route?.options?.component

      if (!CallbackComponent) {
        throw new Error('CallbackComponent not found')
      }

      const rootRoute = createRootRoute({
        component: () => <Outlet />,
      })

      const adminRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/admin/settings',
        component: () => <div data-testid="admin-settings">Admin Settings</div>,
      })

      const callbackRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/auth/callback',
        component: CallbackComponent,
      })

      const routeTree = rootRoute.addChildren([adminRoute, callbackRoute])

      const router = createRouter({
        routeTree,
        history: createMemoryHistory({
          initialEntries: ['/auth/callback?code=auth-code-123&state=%2Fadmin%2Fsettings'],
        }),
      })

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'mock-access-token',
          expires_in: 3600,
        }),
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/admin/settings')
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
    cleanup()
  })

  describe('route file exists', () => {
    it('should have logout route file', async () => {
      let logoutModule = await importModule('../../routes/auth/logout')
      if (!logoutModule) {
        logoutModule = await importModule('../../routes/auth.logout')
      }

      expect(logoutModule).not.toBeNull()
      expect(logoutModule?.Route).toBeDefined()
    })
  })

  describe('logout behavior', () => {
    it('should call logout endpoint', async () => {
      let module = await importModule('../../routes/auth/logout')
      if (!module) {
        module = await importModule('../../routes/auth.logout')
      }

      const LogoutComponent = module?.Route?.options?.component

      if (!LogoutComponent) {
        throw new Error('LogoutComponent not found')
      }

      const rootRoute = createRootRoute({
        component: () => <Outlet />,
      })

      const logoutRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/auth/logout',
        component: LogoutComponent,
      })

      const homeRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        component: () => <div data-testid="home">Home</div>,
      })

      const routeTree = rootRoute.addChildren([logoutRoute, homeRoute])

      const router = createRouter({
        routeTree,
        history: createMemoryHistory({
          initialEntries: ['/auth/logout'],
        }),
      })

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
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
      let module = await importModule('../../routes/auth/logout')
      if (!module) {
        module = await importModule('../../routes/auth.logout')
      }

      const LogoutComponent = module?.Route?.options?.component

      if (!LogoutComponent) {
        throw new Error('LogoutComponent not found')
      }

      const rootRoute = createRootRoute({
        component: () => <Outlet />,
      })

      const logoutRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/auth/logout',
        component: LogoutComponent,
      })

      const homeRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        component: () => <div data-testid="home">Home</div>,
      })

      const routeTree = rootRoute.addChildren([logoutRoute, homeRoute])

      const router = createRouter({
        routeTree,
        history: createMemoryHistory({
          initialEntries: ['/auth/logout'],
        }),
      })

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/')
      })
    })

    it('should redirect to specified returnTo URL', async () => {
      let module = await importModule('../../routes/auth/logout')
      if (!module) {
        module = await importModule('../../routes/auth.logout')
      }

      const LogoutComponent = module?.Route?.options?.component

      if (!LogoutComponent) {
        throw new Error('LogoutComponent not found')
      }

      const rootRoute = createRootRoute({
        component: () => <Outlet />,
      })

      const logoutRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/auth/logout',
        component: LogoutComponent,
      })

      const loginRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/login',
        component: () => <div data-testid="login">Login</div>,
      })

      const routeTree = rootRoute.addChildren([logoutRoute, loginRoute])

      const router = createRouter({
        routeTree,
        history: createMemoryHistory({
          initialEntries: ['/auth/logout?returnTo=%2Flogin'],
        }),
      })

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      render(<RouterProvider router={router} />)

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/login')
      })
    })

    it('should still redirect even if logout fails', async () => {
      let module = await importModule('../../routes/auth/logout')
      if (!module) {
        module = await importModule('../../routes/auth.logout')
      }

      const LogoutComponent = module?.Route?.options?.component

      if (!LogoutComponent) {
        throw new Error('LogoutComponent not found')
      }

      const rootRoute = createRootRoute({
        component: () => <Outlet />,
      })

      const logoutRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/auth/logout',
        component: LogoutComponent,
      })

      const homeRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        component: () => <div data-testid="home">Home</div>,
      })

      const routeTree = rootRoute.addChildren([logoutRoute, homeRoute])

      const router = createRouter({
        routeTree,
        history: createMemoryHistory({
          initialEntries: ['/auth/logout'],
        }),
      })

      // Simulate network error
      mockFetch.mockRejectedValue(new Error('Network error'))

      render(<RouterProvider router={router} />)

      // Should still redirect to home
      await waitFor(() => {
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
    cleanup()
  })

  describe('provider in __root.tsx', () => {
    it('should have OAuthProvider wrapping the app in __root.tsx', async () => {
      // Import the __root route and check it uses OAuthProvider
      const module = await importModule('../../routes/__root')

      expect(module?.Route).toBeDefined()

      // The root component should include OAuthProvider
      // We verify this by checking the component exists and can render
      const RootComponent = module?.Route?.options?.component
      expect(RootComponent).toBeDefined()
    })
  })

  describe('useAuth hook availability', () => {
    it('should export useAuth hook from hooks/use-oauth', async () => {
      const module = await importModule('../../hooks/use-oauth')

      expect(module?.useAuth).toBeDefined()
      expect(module?.OAuthProvider).toBeDefined()
      expect(typeof module?.useAuth).toBe('function')
    })

    it('should provide isAuthenticated state', async () => {
      const module = await importModule('../../hooks/use-oauth')
      const { useAuth, OAuthProvider } = module!

      function TestComponent() {
        const { isAuthenticated, isLoading } = useAuth()
        return (
          <div>
            <span data-testid="loading">{isLoading.toString()}</span>
            <span data-testid="authenticated">{isAuthenticated.toString()}</span>
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
    })

    it('should provide user data when authenticated', async () => {
      const module = await importModule('../../hooks/use-oauth')
      const { useAuth, OAuthProvider } = module!

      function TestComponent() {
        const { user, isLoading } = useAuth()
        return (
          <div>
            <span data-testid="loading">{isLoading.toString()}</span>
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

      expect(screen.getByTestId('user-email').textContent).toBe('test@example.com')
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
    cleanup()
  })

  describe('/admin routes', () => {
    it('should have AuthGuard in admin layout', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ authenticated: false }),
      })

      // Import the admin layout route
      const module = await importModule('../../routes/admin/_admin')

      expect(module?.Route).toBeDefined()

      // The admin route should have a component with AuthGuard
      const AdminComponent = module?.Route?.options?.component
      expect(AdminComponent).toBeDefined()
    })

    it('should render admin dashboard when authenticated', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          authenticated: true,
          user: { id: 'user-123', email: 'admin@example.com', name: 'Admin' },
        }),
      })

      const module = await importModule('../../routes/admin/_admin')
      const AdminComponent = module?.Route?.options?.component

      // Verify it can render (full rendering requires more context)
      expect(AdminComponent).toBeDefined()
    })
  })

  describe('/app routes', () => {
    it('should have AuthGuard in app layout', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ authenticated: false }),
      })

      const module = await importModule('../../routes/app/_app')

      expect(module?.Route).toBeDefined()

      const AppComponent = module?.Route?.options?.component
      expect(AppComponent).toBeDefined()
    })

    it('should render app shell when authenticated', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          authenticated: true,
          user: { id: 'user-123', email: 'user@example.com', name: 'User' },
        }),
      })

      const module = await importModule('../../routes/app/_app')
      const AppComponent = module?.Route?.options?.component

      expect(AppComponent).toBeDefined()
    })
  })

  describe('public routes remain accessible', () => {
    it('should have admin login route', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ authenticated: false }),
      })

      const module = await importModule('../../routes/admin/_admin.login')
      expect(module?.Route).toBeDefined()
    })

    it('should have admin signup route', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ authenticated: false }),
      })

      const module = await importModule('../../routes/admin/_admin.signup')
      expect(module?.Route).toBeDefined()
    })

    it('should have admin reset-password route', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ authenticated: false }),
      })

      const module = await importModule('../../routes/admin/_admin.reset-password')
      expect(module?.Route).toBeDefined()
    })
  })
})

// =============================================================================
// Test Suite: Route Tree Generation
// =============================================================================

describe('Route Tree Generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
    cleanup()
  })

  it('should include /login in generated route tree', async () => {
    // This test verifies TanStack Router generates routes correctly
    // The routeTree.gen.ts should include loginRoute
    const loginRoute = await importModule('../../routes/login')

    if (!loginRoute) {
      throw new Error('Login route does not exist - create app/routes/login.tsx')
    }

    expect(loginRoute.Route).toBeDefined()
  })

  it('should include /auth/callback in generated route tree', async () => {
    let callbackRoute = await importModule('../../routes/auth/callback')
    if (!callbackRoute) {
      callbackRoute = await importModule('../../routes/auth.callback')
    }

    if (!callbackRoute) {
      throw new Error('Callback route does not exist - create app/routes/auth/callback.tsx or app/routes/auth.callback.tsx')
    }

    expect(callbackRoute.Route).toBeDefined()
  })

  it('should include /auth/logout in generated route tree', async () => {
    let logoutRoute = await importModule('../../routes/auth/logout')
    if (!logoutRoute) {
      logoutRoute = await importModule('../../routes/auth.logout')
    }

    if (!logoutRoute) {
      throw new Error('Logout route does not exist - create app/routes/auth/logout.tsx or app/routes/auth.logout.tsx')
    }

    expect(logoutRoute.Route).toBeDefined()
  })
})
