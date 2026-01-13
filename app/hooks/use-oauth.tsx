'use client'

/**
 * OAuth Authentication Hook and Provider
 *
 * Provides React context for OAuth authentication state and methods.
 * Integrates with /auth/session endpoint for session validation.
 *
 * Features:
 * - Session state management (user, isAuthenticated, isLoading, error)
 * - SSR-safe hydration (avoids hydration mismatches)
 * - Login/logout methods
 * - Session refresh capability
 * - TypeScript-safe with full type exports
 *
 * Usage:
 * ```tsx
 * // In app root (e.g., __root.tsx)
 * <OAuthProvider>
 *   <App />
 * </OAuthProvider>
 *
 * // In components
 * function Profile() {
 *   const { user, isAuthenticated, login, logout } = useAuth()
 *   // ...
 * }
 * ```
 *
 * @see /app/types/auth.ts - Type definitions
 * @see /app/lib/auth-config.ts - Configuration
 * @see /app/routes/login.tsx - Login route
 * @see /app/routes/auth.callback.tsx - Callback route
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'
import type { User, AuthState, AuthMethods, AuthContextType, SessionResponse } from '../types/auth'

// =============================================================================
// Re-exports
// =============================================================================

// Re-export types for convenience
export type { User, AuthState, AuthMethods, AuthContextType }

// =============================================================================
// Context
// =============================================================================

/**
 * Auth context with undefined default (ensures proper provider usage)
 */
const AuthContext = createContext<AuthContextType | undefined>(undefined)

// =============================================================================
// Provider Props
// =============================================================================

/**
 * OAuthProvider configuration props
 */
export interface OAuthProviderProps {
  /** Child components to wrap */
  children: ReactNode
  /** Optional session endpoint URL (default: /auth/session) */
  sessionEndpoint?: string
  /** Optional logout endpoint URL (default: /auth/logout) */
  logoutEndpoint?: string
  /** Callback after successful logout */
  onLogout?: () => void
  /** Initial user data for SSR (optional) */
  initialUser?: User | null
  /** Skip initial session fetch (useful for SSR hydration) */
  skipInitialFetch?: boolean
}

// =============================================================================
// Provider Component
// =============================================================================

/**
 * OAuthProvider - Authentication context provider
 *
 * Wraps the application with authentication state and methods.
 * Automatically fetches session on mount unless skipInitialFetch is true.
 *
 * SSR Considerations:
 * - Set initialUser from server-side session data
 * - Set skipInitialFetch=true to prevent hydration mismatch
 * - Client will validate session after hydration if needed
 *
 * @example
 * ```tsx
 * // Basic usage
 * <OAuthProvider>
 *   <App />
 * </OAuthProvider>
 *
 * // With SSR initial data
 * <OAuthProvider initialUser={serverUser} skipInitialFetch>
 *   <App />
 * </OAuthProvider>
 * ```
 */
export function OAuthProvider({
  children,
  sessionEndpoint = '/auth/session',
  logoutEndpoint = '/auth/logout',
  onLogout,
  initialUser = null,
  skipInitialFetch = false,
}: OAuthProviderProps) {
  // State
  const [user, setUser] = useState<User | null>(initialUser)
  const [isLoading, setIsLoading] = useState(!skipInitialFetch)
  const [error, setError] = useState<string | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)

  // Mark as hydrated after first render
  useEffect(() => {
    setIsHydrated(true)
  }, [])

  /**
   * Fetch session from server
   *
   * Calls the session endpoint to validate current auth state
   * and update user data if authenticated.
   */
  const fetchSession = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(sessionEndpoint, {
        credentials: 'include',
      })

      if (response.ok) {
        const data = (await response.json()) as SessionResponse
        if (data.authenticated && data.user) {
          setUser(data.user)
        } else {
          setUser(null)
        }
      } else {
        // Not authenticated or error
        setUser(null)
      }
    } catch (err) {
      // Network error - clear user state
      setUser(null)
      setError(err instanceof Error ? err.message : 'Failed to fetch session')
    } finally {
      setIsLoading(false)
    }
  }, [sessionEndpoint])

  /**
   * Login - Redirect to login page
   *
   * Navigates to /login with optional returnTo parameter.
   * The login page will handle OAuth redirect.
   *
   * @param returnTo - Optional URL to redirect to after login
   */
  const login = useCallback((returnTo?: string) => {
    if (typeof window === 'undefined') return

    const loginUrl = returnTo
      ? `/login?returnTo=${encodeURIComponent(returnTo)}`
      : '/login'
    window.location.assign(loginUrl)
  }, [])

  /**
   * Logout - Revoke tokens and clear session
   *
   * Performs a complete logout:
   * 1. Calls logout endpoint to revoke tokens on oauth.do
   * 2. Clears session from database
   * 3. Sets clear-cookie header
   * 4. Clears local state
   * 5. Calls onLogout callback if provided
   */
  const logout = useCallback(async () => {
    try {
      // Call logout endpoint for server-side cleanup
      await fetch(logoutEndpoint, {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // Ignore errors - still clear local state
      // Server-side cleanup may fail but we should still
      // clear client state for security
    }

    // Clear local state regardless of server response
    setUser(null)
    setError(null)

    // Call optional callback
    onLogout?.()
  }, [logoutEndpoint, onLogout])

  /**
   * Refresh session - Re-fetch from server
   *
   * Useful for refreshing auth state after token refresh
   * or after performing sensitive operations.
   */
  const refreshSession = useCallback(async () => {
    await fetchSession()
  }, [fetchSession])

  // Fetch session on mount (unless skipped)
  useEffect(() => {
    if (!skipInitialFetch) {
      fetchSession()
    }
  }, [fetchSession, skipInitialFetch])

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo<AuthContextType>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      error,
      login,
      logout,
      refreshSession,
    }),
    [user, isLoading, error, login, logout, refreshSession]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * useAuth - Access full authentication context
 *
 * Returns authentication state and methods.
 * Must be used within an OAuthProvider.
 *
 * @throws Error if used outside OAuthProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { user, isAuthenticated, isLoading, login, logout } = useAuth()
 *
 *   if (isLoading) return <Spinner />
 *
 *   if (!isAuthenticated) {
 *     return <button onClick={() => login()}>Login</button>
 *   }
 *
 *   return (
 *     <div>
 *       <p>Hello, {user?.name}</p>
 *       <button onClick={logout}>Logout</button>
 *     </div>
 *   )
 * }
 * ```
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)

  if (context === undefined) {
    throw new Error('useAuth must be used within an OAuthProvider')
  }

  return context
}

/**
 * useUser - Get just the user object
 *
 * Convenience hook for components that only need user data.
 * Returns null if not authenticated.
 *
 * @example
 * ```tsx
 * function Profile() {
 *   const user = useUser()
 *   return user ? <p>Hello {user.name}</p> : <p>Not logged in</p>
 * }
 * ```
 */
export function useUser(): User | null {
  const { user } = useAuth()
  return user
}

/**
 * useIsAuthenticated - Check authentication status
 *
 * Convenience hook for simple auth checks.
 *
 * @example
 * ```tsx
 * function ProtectedContent() {
 *   const isAuthenticated = useIsAuthenticated()
 *   if (!isAuthenticated) return <LoginPrompt />
 *   return <SecretContent />
 * }
 * ```
 */
export function useIsAuthenticated(): boolean {
  const { isAuthenticated } = useAuth()
  return isAuthenticated
}

/**
 * useAuthLoading - Check if auth state is loading
 *
 * Useful for showing loading states during initial auth check.
 *
 * @example
 * ```tsx
 * function App() {
 *   const isLoading = useAuthLoading()
 *   if (isLoading) return <FullPageSpinner />
 *   return <MainContent />
 * }
 * ```
 */
export function useAuthLoading(): boolean {
  const { isLoading } = useAuth()
  return isLoading
}

/**
 * useRequireAuth - Redirect if not authenticated
 *
 * Hook that redirects to login if user is not authenticated.
 * Returns auth state for authenticated users.
 *
 * @param redirectTo - URL to redirect to for login (default: current path)
 *
 * @example
 * ```tsx
 * function ProtectedPage() {
 *   const { user, isLoading } = useRequireAuth()
 *
 *   if (isLoading) return <Spinner />
 *
 *   // User is guaranteed to be authenticated here
 *   return <Dashboard user={user!} />
 * }
 * ```
 */
export function useRequireAuth(redirectTo?: string): AuthContextType {
  const auth = useAuth()

  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      const returnTo = redirectTo || (typeof window !== 'undefined' ? window.location.pathname : '/')
      auth.login(returnTo)
    }
  }, [auth.isLoading, auth.isAuthenticated, auth.login, redirectTo])

  return auth
}

// =============================================================================
// Default Export
// =============================================================================

export default useAuth
