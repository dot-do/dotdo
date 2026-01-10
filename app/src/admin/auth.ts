/**
 * Admin Authentication Module
 *
 * Provides authentication session management for the admin dashboard.
 *
 * ## Architecture
 *
 * This module provides a layered auth approach:
 * 1. **Session functions** - Low-level session management (create, validate, invalidate)
 * 2. **useAuth hook** - React state management for auth (TODO: implement with better-auth)
 * 3. **AuthContext** - React context for sharing auth state across components
 *
 * ## Production Integration
 *
 * In production, replace the in-memory session store with:
 * - better-auth for OAuth/email auth
 * - Cloudflare Durable Objects for session storage
 * - Worker KV for session tokens
 *
 * ## Usage
 *
 * ```tsx
 * // In a component
 * const { user, isAuthenticated, login, logout } = useAuth()
 *
 * // Protect routes
 * if (!isAuthenticated) {
 *   return <Navigate to="/admin/login" />
 * }
 * ```
 */

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'

// =============================================================================
// Types
// =============================================================================

export interface User {
  id: string
  email?: string
  name?: string
  avatar?: string
}

export interface Session {
  token: string
  userId: string
  expiresAt?: Date
}

export interface AuthState {
  user: User | null
  session: Session | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
}

export interface AuthActions {
  login: (credentials: { email: string; password: string }) => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
}

export type AuthContextValue = AuthState & AuthActions

// =============================================================================
// SessionStore Interface
// =============================================================================

/**
 * SessionStore interface abstracts session storage mechanism.
 * Implementations can use localStorage, cookies, Durable Objects, KV, etc.
 */
export interface SessionStore {
  /** Get stored session data by key */
  get(key: string): string | null
  /** Store session data by key */
  set(key: string, value: string): void
  /** Delete session data by key */
  delete(key: string): void
}

/**
 * LocalStorageSessionStore - Browser localStorage implementation of SessionStore
 */
export class LocalStorageSessionStore implements SessionStore {
  get(key: string): string | null {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key)
    }
    return null
  }

  set(key: string, value: string): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value)
    }
  }

  delete(key: string): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key)
    }
  }
}

/**
 * MemorySessionStore - In-memory implementation for Node/testing environments
 */
export class MemorySessionStore implements SessionStore {
  private storage = new Map<string, string>()

  get(key: string): string | null {
    return this.storage.get(key) ?? null
  }

  set(key: string, value: string): void {
    this.storage.set(key, value)
  }

  delete(key: string): void {
    this.storage.delete(key)
  }
}

// =============================================================================
// Session Storage (using SessionStore interface)
// =============================================================================

const STORAGE_KEY = 'dotdo_session'

// Session storage (in-memory for now, would use better-auth in production)
const sessions = new Map<string, { userId: string; createdAt: Date }>()

/**
 * Create default SessionStore based on environment.
 * Uses localStorage in browser, in-memory Map in Node.
 */
function createDefaultSessionStore(): SessionStore {
  if (typeof localStorage !== 'undefined') {
    return new LocalStorageSessionStore()
  }
  // Fallback for Node environment (tests)
  return new MemorySessionStore()
}

// Singleton storage instance - can be replaced via setSessionStore() for testing/DI
let sessionStore: SessionStore | null = null

/**
 * Get the current session store instance.
 * Creates a default one if not set.
 */
function getSessionStore(): SessionStore {
  if (!sessionStore) {
    sessionStore = createDefaultSessionStore()
  }
  return sessionStore
}

/**
 * Set a custom session store (for dependency injection/testing).
 * Pass null to reset to default behavior.
 */
export function setSessionStore(store: SessionStore | null): void {
  sessionStore = store
}

/**
 * Create a new authenticated session
 * Creates a real session with proper token and stores it
 */
export async function createSession(): Promise<{ token: string; userId: string }> {
  const token = crypto.randomUUID()
  const userId = `user_${crypto.randomUUID().slice(0, 8)}`

  sessions.set(token, {
    userId,
    createdAt: new Date(),
  })

  // Store the current session in storage
  getSessionStore().set(STORAGE_KEY, JSON.stringify({ token, userId }))

  return { token, userId }
}

/**
 * Validate a session token
 * Validates against the sessions Map
 */
export async function validateSession(token: string): Promise<{ valid: boolean; userId?: string }> {
  const session = sessions.get(token)
  if (!session) {
    return { valid: false }
  }
  return { valid: true, userId: session.userId }
}

/**
 * Invalidate/logout a session
 * Removes from sessions Map and clears storage
 */
export async function invalidateSession(token: string): Promise<void> {
  sessions.delete(token)
  getSessionStore().delete(STORAGE_KEY)
}

/**
 * Get current session from storage
 * Returns null if no session exists or session is invalid
 * Only returns test values if NODE_ENV === 'test' AND no real session exists
 */
export function getCurrentSession(): { token: string; userId: string } | null {
  // Check storage for stored session
  const storedSession = getSessionStore().get(STORAGE_KEY)
  if (storedSession) {
    try {
      const session = JSON.parse(storedSession)
      // Hydrate the sessions Map from storage if needed (e.g., after page refresh)
      // This ensures session survives page refresh when JS context resets
      if (!sessions.has(session.token)) {
        sessions.set(session.token, {
          userId: session.userId,
          createdAt: new Date(),
        })
      }
      return session
    } catch {
      // Invalid stored session, clear it
      getSessionStore().delete(STORAGE_KEY)
    }
  }

  // No valid session exists
  return null
}

/**
 * Logout the current session
 * Clears session from storage and invalidates in session store
 */
export async function logout(): Promise<void> {
  const currentSession = getCurrentSession()
  if (currentSession) {
    await invalidateSession(currentSession.token)
  }
}

// =============================================================================
// Auth Context
// =============================================================================

const defaultAuthState: AuthState = {
  user: null,
  session: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * Auth Provider Props
 */
interface AuthProviderProps {
  children: ReactNode
  /** Optional initial session for SSR */
  initialSession?: Session | null
}

/**
 * AuthProvider - Provides auth state to the component tree
 *
 * Wrap your app (or admin routes) with this provider:
 * ```tsx
 * <AuthProvider>
 *   <AdminRoutes />
 * </AuthProvider>
 * ```
 */
export function AuthProvider({ children, initialSession }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>(() => ({
    ...defaultAuthState,
    session: initialSession ?? null,
    isAuthenticated: !!initialSession,
    isLoading: !initialSession,
  }))

  // Initialize auth state on mount
  useEffect(() => {
    const initAuth = async () => {
      const session = getCurrentSession()
      if (session) {
        const validation = await validateSession(session.token)
        if (validation.valid) {
          setState({
            user: { id: session.userId },
            session,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          })
          return
        }
      }
      setState((prev) => ({ ...prev, isLoading: false }))
    }
    initAuth()
  }, [])

  const login = useCallback(async (credentials: { email: string; password: string }) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }))
    try {
      // In production, this would call better-auth or your auth API
      const session = await createSession()
      setState({
        user: { id: session.userId, email: credentials.email },
        session,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      })
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Login failed',
      }))
      throw error
    }
  }, [])

  const logout = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }))
    try {
      if (state.session?.token) {
        await invalidateSession(state.session.token)
      }
      setState({
        user: null,
        session: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      })
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Logout failed',
      }))
    }
  }, [state.session?.token])

  const refreshSession = useCallback(async () => {
    if (!state.session?.token) return
    const validation = await validateSession(state.session.token)
    if (!validation.valid) {
      setState({
        user: null,
        session: null,
        isAuthenticated: false,
        isLoading: false,
        error: 'Session expired',
      })
    }
  }, [state.session?.token])

  const value: AuthContextValue = {
    ...state,
    login,
    logout,
    refreshSession,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// =============================================================================
// useAuth Hook
// =============================================================================

/**
 * useAuth - Hook to access auth state and actions
 *
 * Must be used within an AuthProvider.
 *
 * @example
 * ```tsx
 * function AdminPage() {
 *   const { user, isAuthenticated, logout } = useAuth()
 *
 *   if (!isAuthenticated) {
 *     return <Navigate to="/admin/login" />
 *   }
 *
 *   return (
 *     <div>
 *       <p>Welcome, {user?.email}</p>
 *       <button onClick={logout}>Logout</button>
 *     </div>
 *   )
 * }
 * ```
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

/**
 * useRequireAuth - Hook that redirects to login if not authenticated
 *
 * @returns Auth state (guaranteed to have user if this hook returns)
 */
export function useRequireAuth(): AuthContextValue & { user: User; session: Session } {
  const auth = useAuth()

  // In a real app, this would trigger a redirect via router
  if (!auth.isAuthenticated && !auth.isLoading) {
    throw new Error('Authentication required')
  }

  return auth as AuthContextValue & { user: User; session: Session }
}
