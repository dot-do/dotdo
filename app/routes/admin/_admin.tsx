/**
 * Admin Layout Route
 *
 * Layout route that wraps all admin routes with AuthProvider and
 * provides authentication protection for protected routes.
 *
 * ## Protected Routes
 * All admin routes are protected by default except:
 * - /admin/login
 * - /admin/signup
 * - /admin/reset-password
 *
 * ## Authentication Flow
 * 1. Check if route is public (login, signup, reset-password)
 * 2. If public, render without auth check
 * 3. If protected, check isAuthenticated
 * 4. If loading, show loading state
 * 5. If not authenticated, redirect to /admin/login
 * 6. If authenticated, render protected content
 */

import type { ReactNode } from 'react'
import { createFileRoute, Outlet, Navigate, useLocation } from '@tanstack/react-router'
import { AuthProvider, useAuth } from '~/src/admin/auth'

export const Route = createFileRoute('/admin/_admin')({
  component: AdminLayout,
})

/**
 * Public routes that don't require authentication
 */
const publicRoutes = ['/admin/login', '/admin/signup', '/admin/reset-password']

/**
 * AuthGuard - Protects routes that require authentication
 *
 * Checks authentication state and either:
 * - Renders children if authenticated
 * - Shows loading state while checking auth
 * - Redirects to login if not authenticated
 */
function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, error } = useAuth()
  const location = useLocation()

  // Check if current route is public
  const isPublicRoute = publicRoutes.some(
    (route) => location.pathname === route || location.pathname.startsWith(route + '/')
  )

  // Public routes are always accessible
  if (isPublicRoute) {
    return <>{children}</>
  }

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white"></div>
      </div>
    )
  }

  // Handle auth error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-red-400 mb-2">Authentication Error</h1>
          <p className="text-gray-400">{error}</p>
        </div>
      </div>
    )
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/admin/login" />
  }

  // Render protected content
  return <>{children}</>
}

/**
 * AdminLayout - Admin layout component
 *
 * Wraps all admin routes with AuthProvider and AuthGuard
 */
function AdminLayout() {
  return (
    <AuthProvider>
      <AuthGuard>
        <Outlet />
      </AuthGuard>
    </AuthProvider>
  )
}
