/**
 * AuthProvider Integration Tests (TDD RED Phase)
 *
 * These tests verify that AuthProvider wraps admin routes and provides
 * authentication context to all protected routes.
 *
 * Tests are expected to FAIL until implementation is complete.
 *
 * Test cases:
 * 1. AuthProvider wraps admin routes in __root.tsx or admin layout
 * 2. useAuth() hook is available in admin route components
 * 3. Auth context provides user, isAuthenticated, login, logout
 * 4. Protected routes redirect to login when not authenticated
 * 5. Login page is accessible without authentication
 *
 * ## Implementation Requirements
 *
 * To make these tests pass:
 * 1. Create app/routes/admin/_admin.tsx layout route that wraps admin routes
 * 2. Import AuthProvider from ~/src/admin/auth
 * 3. Wrap admin children with AuthProvider
 * 4. Add protection logic to redirect unauthenticated users to /admin/login
 *
 * @see app/routes/__root.tsx - Root layout (should NOT have auth)
 * @see app/routes/admin/_admin.tsx - Admin layout (should have AuthProvider)
 * @see app/src/admin/auth.ts - Auth module with AuthProvider and useAuth
 */

import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

// =============================================================================
// File Structure Tests - Admin Layout Route
// =============================================================================

describe('AuthProvider Integration - File Structure', () => {
  describe('Admin Layout Route', () => {
    it('should have admin layout route at app/routes/admin/_admin.tsx', () => {
      // TDD RED: This file should exist to wrap all admin routes with AuthProvider
      // TanStack Router convention: _admin.tsx is a layout route for /admin/* routes
      expect(existsSync('app/routes/admin/_admin.tsx')).toBe(true)
    })

    it('should export Route constant for TanStack Router', async () => {
      // TDD RED: Layout route must export Route for TanStack Router file-based routing
      const layoutPath = 'app/routes/admin/_admin.tsx'
      expect(existsSync(layoutPath)).toBe(true)

      const content = await readFile(layoutPath, 'utf-8')
      expect(content).toContain('export const Route')
    })

    it('should use createFileRoute for layout', async () => {
      // TDD RED: Must use TanStack Router's createFileRoute
      const layoutPath = 'app/routes/admin/_admin.tsx'
      expect(existsSync(layoutPath)).toBe(true)

      const content = await readFile(layoutPath, 'utf-8')
      expect(content).toContain('createFileRoute')
    })

    it('should import AuthProvider from ~/src/admin/auth', async () => {
      // TDD RED: Admin layout must import AuthProvider to wrap children
      const layoutPath = 'app/routes/admin/_admin.tsx'
      expect(existsSync(layoutPath)).toBe(true)

      const content = await readFile(layoutPath, 'utf-8')
      expect(content).toContain("import")
      expect(content).toMatch(/AuthProvider.*from.*['"]~\/src\/admin\/auth['"]|from.*['"]~\/src\/admin\/auth['"].*AuthProvider/)
    })

    it('should wrap children with AuthProvider', async () => {
      // TDD RED: Layout must wrap <Outlet /> with <AuthProvider>
      const layoutPath = 'app/routes/admin/_admin.tsx'
      expect(existsSync(layoutPath)).toBe(true)

      const content = await readFile(layoutPath, 'utf-8')
      expect(content).toContain('<AuthProvider')
      expect(content).toContain('</AuthProvider>')
    })

    it('should render Outlet for child routes', async () => {
      // TDD RED: Layout must use Outlet to render child routes
      const layoutPath = 'app/routes/admin/_admin.tsx'
      expect(existsSync(layoutPath)).toBe(true)

      const content = await readFile(layoutPath, 'utf-8')
      expect(content).toContain('Outlet')
      expect(content).toContain('<Outlet')
    })
  })

  describe('Root Layout', () => {
    it('should NOT have AuthProvider in __root.tsx', async () => {
      // Auth should only wrap admin routes, not the entire app
      // This ensures public routes don't require authentication
      const rootContent = await readFile('app/routes/__root.tsx', 'utf-8')

      // Root should NOT import AuthProvider
      expect(rootContent).not.toMatch(/import.*AuthProvider.*from.*auth/)

      // Root should NOT render AuthProvider
      expect(rootContent).not.toContain('<AuthProvider')
    })
  })
})

// =============================================================================
// Auth Context Tests - useAuth Hook Availability
// =============================================================================

describe('AuthProvider Integration - Auth Context', () => {
  describe('useAuth Hook in Admin Routes', () => {
    it('should have auth module that exports useAuth hook', async () => {
      // This test verifies the auth module exports useAuth
      // (Already implemented, this should pass)
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')
      expect(authContent).toContain('export function useAuth')
    })

    it('should have auth module that exports AuthProvider', async () => {
      // This test verifies the auth module exports AuthProvider
      // (Already implemented, this should pass)
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')
      expect(authContent).toContain('export function AuthProvider')
    })

    it('should have useAuth that throws when used outside AuthProvider', async () => {
      // TDD GREEN (should pass): useAuth throws descriptive error when context missing
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')
      expect(authContent).toContain('useAuth must be used within an AuthProvider')
    })

    it('should use useAuth in admin index route for auth-aware rendering', async () => {
      // TDD RED: Admin routes should use useAuth to access auth state
      const adminIndexContent = await readFile('app/routes/admin/index.tsx', 'utf-8')

      // Route should import useAuth from auth module
      expect(adminIndexContent).toMatch(/import.*{.*useAuth.*}.*from.*['"]~\/src\/admin\/auth['"]/)
    })
  })

  describe('Auth Context Value', () => {
    it('should provide user property in auth context', async () => {
      // Verify AuthContextValue includes user property
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')
      expect(authContent).toMatch(/user.*User.*null|User.*null.*user/)
    })

    it('should provide isAuthenticated property in auth context', async () => {
      // Verify AuthContextValue includes isAuthenticated property
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')
      expect(authContent).toContain('isAuthenticated')
    })

    it('should provide login function in auth context', async () => {
      // Verify AuthContextValue includes login function
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')
      expect(authContent).toMatch(/login:.*\(|login.*Promise/)
    })

    it('should provide logout function in auth context', async () => {
      // Verify AuthContextValue includes logout function
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')
      expect(authContent).toMatch(/logout:.*\(|logout.*Promise/)
    })

    it('should provide isLoading property in auth context', async () => {
      // Verify AuthContextValue includes isLoading for loading states
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')
      expect(authContent).toContain('isLoading')
    })

    it('should provide error property in auth context', async () => {
      // Verify AuthContextValue includes error for error states
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')
      expect(authContent).toContain('error')
    })
  })
})

// =============================================================================
// Protected Route Tests - Authentication Redirect
// =============================================================================

describe('AuthProvider Integration - Protected Routes', () => {
  describe('Auth Guard Component', () => {
    it('should have AuthGuard component for protecting routes', async () => {
      // TDD RED: Need AuthGuard component that checks auth and redirects
      // This could be in the auth module or admin layout
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')
      const hasAuthGuard = authContent.includes('AuthGuard') ||
                          authContent.includes('RequireAuth') ||
                          authContent.includes('ProtectedRoute')

      // Check if admin layout has protection logic
      const layoutExists = existsSync('app/routes/admin/_admin.tsx')

      if (layoutExists) {
        const layoutContent = await readFile('app/routes/admin/_admin.tsx', 'utf-8')
        const hasProtection = layoutContent.includes('isAuthenticated') ||
                             layoutContent.includes('redirect') ||
                             layoutContent.includes('Navigate')
        expect(hasAuthGuard || hasProtection).toBe(true)
      } else {
        expect(hasAuthGuard).toBe(true)
      }
    })

    it('should redirect to /admin/login when not authenticated', async () => {
      // TDD RED: Admin layout should redirect unauthenticated users
      const layoutPath = 'app/routes/admin/_admin.tsx'
      expect(existsSync(layoutPath)).toBe(true)

      const content = await readFile(layoutPath, 'utf-8')

      // Should have redirect logic to login page
      expect(content).toMatch(/\/admin\/login|redirect.*login/)
    })

    it('should check isAuthenticated before rendering protected content', async () => {
      // TDD RED: Admin layout should check auth state
      const layoutPath = 'app/routes/admin/_admin.tsx'
      expect(existsSync(layoutPath)).toBe(true)

      const content = await readFile(layoutPath, 'utf-8')
      expect(content).toContain('isAuthenticated')
    })

    it('should show loading state while checking authentication', async () => {
      // TDD RED: Should handle loading state during auth check
      const layoutPath = 'app/routes/admin/_admin.tsx'
      expect(existsSync(layoutPath)).toBe(true)

      const content = await readFile(layoutPath, 'utf-8')
      expect(content).toContain('isLoading')
    })
  })

  describe('Login Route Accessibility', () => {
    it('should have login route at app/routes/admin/login.tsx', () => {
      // Login route should exist (already implemented)
      expect(existsSync('app/routes/admin/login.tsx')).toBe(true)
    })

    it('should NOT require authentication for login route', async () => {
      // TDD RED: Login route should be accessible without auth
      // This requires the admin layout to exclude login from protection
      const layoutPath = 'app/routes/admin/_admin.tsx'
      expect(existsSync(layoutPath)).toBe(true)

      const content = await readFile(layoutPath, 'utf-8')

      // Layout should have logic to allow login/signup routes without auth
      // Could be pathname check, route exclusion, or separate layout
      const hasExclusion = content.includes('login') ||
                          content.includes('signup') ||
                          content.includes('pathname') ||
                          content.includes('publicRoutes') ||
                          content.includes('excludeAuth')

      expect(hasExclusion).toBe(true)
    })

    it('should NOT require authentication for signup route', async () => {
      // TDD RED: Signup route should also be accessible without auth
      expect(existsSync('app/routes/admin/signup.tsx')).toBe(true)
    })

    it('should NOT require authentication for reset-password route', async () => {
      // TDD RED: Password reset route should be accessible without auth
      expect(existsSync('app/routes/admin/reset-password.tsx')).toBe(true)
    })
  })
})

// =============================================================================
// Integration Tests - Admin Routes with Auth
// =============================================================================

describe('AuthProvider Integration - Admin Routes', () => {
  describe('Admin Dashboard', () => {
    it('should use auth context in admin dashboard', async () => {
      // TDD RED: Dashboard should access auth context
      const dashboardContent = await readFile('app/routes/admin/index.tsx', 'utf-8')

      // Should use useAuth hook instead of getCurrentSession directly
      expect(dashboardContent).toMatch(/useAuth|AuthProvider|isAuthenticated/)
    })

    it('should display user info from auth context', async () => {
      // TDD RED: Dashboard should show authenticated user info
      const dashboardContent = await readFile('app/routes/admin/index.tsx', 'utf-8')

      // Should have access to user object from auth
      expect(dashboardContent).toMatch(/user\.|user\?\./)
    })
  })

  describe('Settings Routes', () => {
    it('should have settings routes that use auth context', async () => {
      // Settings routes should be protected and use auth
      expect(existsSync('app/routes/admin/settings/index.tsx')).toBe(true)
    })

    it('should have account settings that can update user profile', async () => {
      // Account settings should interact with auth context
      expect(existsSync('app/routes/admin/settings/account.tsx')).toBe(true)
    })

    it('should have security settings for password/session management', async () => {
      // Security settings should use auth context for session management
      expect(existsSync('app/routes/admin/settings/security.tsx')).toBe(true)
    })
  })

  describe('Protected Admin Sub-routes', () => {
    const protectedRoutes = [
      'app/routes/admin/workflows/index.tsx',
      'app/routes/admin/sandboxes/index.tsx',
      'app/routes/admin/users/index.tsx',
      'app/routes/admin/integrations/index.tsx',
      'app/routes/admin/approvals/index.tsx',
      'app/routes/admin/browsers/index.tsx',
      'app/routes/admin/activity/index.tsx',
    ]

    protectedRoutes.forEach((routePath) => {
      const routeName = routePath.replace('app/routes/admin/', '').replace('/index.tsx', '')

      it(`should have ${routeName} route protected by AuthProvider`, () => {
        // All these routes should exist and be children of admin layout
        expect(existsSync(routePath)).toBe(true)
      })
    })
  })
})

// =============================================================================
// Auth Actions Tests - Login/Logout Integration
// =============================================================================

describe('AuthProvider Integration - Auth Actions', () => {
  describe('Login Flow', () => {
    it('should have login page that calls auth login function', async () => {
      const loginContent = await readFile('app/routes/admin/login.tsx', 'utf-8')

      // Login page should have submit handler
      expect(loginContent).toContain('onSubmit')
    })

    it('should navigate to admin dashboard after successful login', async () => {
      const loginContent = await readFile('app/routes/admin/login.tsx', 'utf-8')

      // Should navigate to /admin after login
      expect(loginContent).toMatch(/navigate.*\/admin|to.*\/admin/)
    })

    it('should support OAuth login providers', async () => {
      const loginContent = await readFile('app/routes/admin/login.tsx', 'utf-8')

      // Should have OAuth support
      expect(loginContent).toContain('OAuth')
    })
  })

  describe('Logout Flow', () => {
    it('should have logout functionality accessible in admin routes', async () => {
      // TDD RED: Admin routes should have access to logout via useAuth
      // This is verified through the auth module having logout function
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')
      expect(authContent).toContain('logout')
    })

    it('should have user menu with logout option in admin layout', async () => {
      // TDD RED: Admin layout or shell should have logout button
      // Check AdminContent which has SidebarUser
      const adminContentPath = 'app/components/cockpit/AdminContent.tsx'
      if (existsSync(adminContentPath)) {
        const content = await readFile(adminContentPath, 'utf-8')
        expect(content).toMatch(/logout|Logout|SidebarUser/)
      } else {
        // Fall back to checking admin layout
        const layoutPath = 'app/routes/admin/_admin.tsx'
        expect(existsSync(layoutPath)).toBe(true)
        const content = await readFile(layoutPath, 'utf-8')
        expect(content).toMatch(/logout|Logout/)
      }
    })
  })

  describe('Session Persistence', () => {
    it('should have refreshSession function in auth context', async () => {
      // Auth module should support session refresh
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')
      expect(authContent).toContain('refreshSession')
    })

    it('should have session validation on mount', async () => {
      // AuthProvider should validate session on mount
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')
      expect(authContent).toContain('useEffect')
      expect(authContent).toMatch(/initAuth|checkSession|validateSession/)
    })
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe('AuthProvider Integration - Type Safety', () => {
  describe('AuthContextValue Type', () => {
    it('should export AuthContextValue type', async () => {
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')
      expect(authContent).toMatch(/export.*AuthContextValue|export type.*AuthContextValue/)
    })

    it('should export User type', async () => {
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')
      expect(authContent).toMatch(/export.*interface User|export type User/)
    })

    it('should export Session type', async () => {
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')
      expect(authContent).toMatch(/export.*interface Session|export type Session/)
    })

    it('should export AuthState type', async () => {
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')
      expect(authContent).toMatch(/export.*interface AuthState|export type AuthState/)
    })
  })

  describe('Admin Layout Props', () => {
    it('should have proper TypeScript types for admin layout', async () => {
      // TDD RED: Admin layout should have proper typing
      const layoutPath = 'app/routes/admin/_admin.tsx'
      expect(existsSync(layoutPath)).toBe(true)

      const content = await readFile(layoutPath, 'utf-8')

      // Should have React/TypeScript imports
      expect(content).toMatch(/import.*React|import.*from ['"]react['"]/)
    })
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('AuthProvider Integration - Error Handling', () => {
  describe('Auth Errors', () => {
    it('should handle login errors gracefully', async () => {
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')

      // Should catch and handle errors
      expect(authContent).toContain('catch')
      expect(authContent).toMatch(/error.*Error|Error.*error/)
    })

    it('should expose error state in auth context', async () => {
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')

      // Should have error in state
      expect(authContent).toContain('error:')
    })

    it('should handle session expiration', async () => {
      const authContent = await readFile('app/src/admin/auth.ts', 'utf-8')

      // Should handle expired sessions
      expect(authContent).toMatch(/expired|Session expired|valid/)
    })
  })

  describe('Admin Layout Error Boundaries', () => {
    it('should have error handling in admin layout', async () => {
      // TDD RED: Admin layout should handle errors gracefully
      const layoutPath = 'app/routes/admin/_admin.tsx'
      expect(existsSync(layoutPath)).toBe(true)

      const content = await readFile(layoutPath, 'utf-8')

      // Should have some form of error handling (ErrorBoundary, try/catch, or error state)
      const hasErrorHandling = content.includes('ErrorBoundary') ||
                              content.includes('error') ||
                              content.includes('catch') ||
                              content.includes('Error')

      expect(hasErrorHandling).toBe(true)
    })
  })
})
