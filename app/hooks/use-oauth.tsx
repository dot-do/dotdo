'use client'

/**
 * OAuth Authentication Hook and Provider
 *
 * Provides React context for OAuth authentication state and methods.
 * Integrates with /auth/session endpoint for session validation.
 *
 * @see /app/types/auth.ts for type definitions
 * @see /app/lib/auth-config.ts for configuration
 */

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { User, AuthState, AuthMethods, AuthContextType, SessionResponse } from '../types/auth'

// Re-export types for convenience
export type { User, AuthState, AuthMethods, AuthContextType }

/**
 * Create auth context with undefined default
 */
const AuthContext = createContext<AuthContextType | undefined>(undefined)

/**
 * OAuth Provider Props
 */
export interface OAuthProviderProps {
  children: ReactNode
  /** Optional session endpoint URL (default: /auth/session) */
  sessionEndpoint?: string
  /** Optional logout endpoint URL (default: /auth/logout) */
  logoutEndpoint?: string
  /** Optional callback after successful logout */
  onLogout?: () => void
}

/**
 * OAuth Provider Component
 *
 * Wraps children with authentication context.
 * Automatically fetches session on mount.
 */
export function OAuthProvider({
  children,
  sessionEndpoint = '/auth/session',
  logoutEndpoint = '/auth/logout',
  onLogout,
}: OAuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /**
   * Fetch session from server
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
      // Network error
      setUser(null)
      setError(err instanceof Error ? err.message : 'Failed to fetch session')
    } finally {
      setIsLoading(false)
    }
  }, [sessionEndpoint])

  /**
   * Login - redirect to login page
   */
  const login = useCallback((returnTo?: string) => {
    const loginUrl = returnTo
      ? `/login?returnTo=${encodeURIComponent(returnTo)}`
      : '/login'
    window.location.assign(loginUrl)
  }, [])

  /**
   * Logout - call logout endpoint with token revocation and clear state
   *
   * This performs a complete logout:
   * 1. Calls the logout endpoint to revoke tokens on oauth.do
   * 2. Clears the session cookie
   * 3. Clears local state
   * 4. Optionally calls the onLogout callback
   */
  const logout = useCallback(async () => {
    try {
      // Call logout endpoint which handles:
      // - Revoking access token on oauth.do
      // - Clearing session from database
      // - Setting clear-cookie header
      await fetch(logoutEndpoint, {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // Ignore errors - still clear local state
      // The server-side cleanup may fail but we should still
      // clear the client state for security
    }

    // Clear local state regardless of server response
    setUser(null)
    setError(null)

    // Call optional callback
    onLogout?.()
  }, [logoutEndpoint, onLogout])

  /**
   * Refresh session - re-fetch from server
   */
  const refreshSession = useCallback(async () => {
    await fetchSession()
  }, [fetchSession])

  // Fetch session on mount
  useEffect(() => {
    fetchSession()
  }, [fetchSession])

  const value: AuthContextType = {
    user,
    isAuthenticated: user !== null,
    isLoading,
    error,
    login,
    logout,
    refreshSession,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/**
 * useAuth Hook
 *
 * Access authentication state and methods.
 * Must be used within an OAuthProvider.
 *
 * @throws Error if used outside OAuthProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { user, isAuthenticated, login, logout } = useAuth()
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
 * useUser Hook
 *
 * Convenience hook to get just the user object.
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
 * useIsAuthenticated Hook
 *
 * Convenience hook to check authentication status.
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

export default useAuth
