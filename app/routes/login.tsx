'use client'

/**
 * Login Route
 *
 * Public login page that redirects to oauth.do for authentication.
 * Supports returnTo URL preservation for post-login redirects.
 *
 * Features:
 * - Email/password form (for UX, actual auth is via OAuth)
 * - Loading state during OAuth redirect
 * - returnTo URL preservation via state parameter
 * - Links to forgot password and signup
 *
 * Flow:
 * 1. User arrives at /login (optionally with ?returnTo=/path)
 * 2. User clicks "Sign In" button
 * 3. Browser redirects to oauth.do with returnTo encoded in state
 * 4. After auth, callback route redirects to returnTo URL
 *
 * @see /app/routes/auth.callback.tsx - Handles OAuth callback
 * @see /app/lib/auth-config.ts - OAuth configuration
 */

import { createFileRoute, Link, useSearch } from '@tanstack/react-router'
import { useState, useCallback, useEffect } from 'react'
import { Button } from '@mdxui/primitives/button'
import { Input } from '@mdxui/primitives/input'
import { Label } from '@mdxui/primitives/label'
import { Loader2 } from 'lucide-react'
import { AuthLayout } from '../components/auth/AuthLayout'
import { getAuthErrorMessage } from '../components/auth/AuthErrorBoundary'

// =============================================================================
// Types
// =============================================================================

/**
 * Search parameters for login route
 */
interface LoginSearch {
  /** URL to redirect to after successful login */
  returnTo?: string
  /** Error code from failed auth attempt */
  error?: string
  /** Error description from OAuth provider */
  error_description?: string
}

// =============================================================================
// Constants
// =============================================================================

/** Key for storing returnTo in sessionStorage */
const RETURN_TO_KEY = 'auth_return_to'

// =============================================================================
// Route Definition
// =============================================================================

export const Route = createFileRoute('/login')({
  component: LoginComponent,
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    returnTo: typeof search.returnTo === 'string' ? search.returnTo : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
    error_description: typeof search.error_description === 'string' ? search.error_description : undefined,
  }),
})

// =============================================================================
// Component
// =============================================================================

/**
 * Login Component
 *
 * Renders login form and handles OAuth redirect flow.
 */
function LoginComponent() {
  const { returnTo, error, error_description } = useSearch({ from: '/login' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Store returnTo in sessionStorage for persistence across OAuth flow
  useEffect(() => {
    if (returnTo && typeof window !== 'undefined') {
      sessionStorage.setItem(RETURN_TO_KEY, returnTo)
    }
  }, [returnTo])

  // Handle error from URL (e.g., from failed OAuth attempt)
  useEffect(() => {
    if (error) {
      setErrorMessage(error_description || getAuthErrorMessage(error))
    }
  }, [error, error_description])

  /**
   * Get the returnTo URL, checking both search params and sessionStorage
   */
  const getReturnTo = useCallback((): string => {
    // First check URL params
    if (returnTo) return returnTo

    // Then check sessionStorage
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem(RETURN_TO_KEY)
      if (stored) return stored
    }

    // Default to home
    return '/'
  }, [returnTo])

  /**
   * Redirect to OAuth provider
   */
  const redirectToOAuth = useCallback(() => {
    setIsLoading(true)
    setErrorMessage(null)

    // Build OAuth authorization URL
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const redirectUri = encodeURIComponent(`${origin}/auth/callback`)
    const returnToUrl = getReturnTo()

    // Encode returnTo in state parameter for post-auth redirect
    const state = returnToUrl !== '/' ? encodeURIComponent(returnToUrl) : ''
    const stateParam = state ? `&state=${state}` : ''

    const authUrl = `https://login.oauth.do/authorize?client_id=dotdo&redirect_uri=${redirectUri}&response_type=code&scope=openid%20profile%20email${stateParam}`

    // Redirect to oauth.do
    window.location.assign(authUrl)
  }, [getReturnTo])

  /**
   * Handle form submission
   */
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    redirectToOAuth()
  }, [redirectToOAuth])

  /**
   * Handle button click (for testing compatibility)
   */
  const handleButtonClick = useCallback(() => {
    redirectToOAuth()
  }, [redirectToOAuth])

  /**
   * Clear error message
   */
  const clearError = useCallback(() => {
    setErrorMessage(null)
  }, [])

  return (
    <AuthLayout
      title="Sign In"
      subtitle="Enter your credentials to access your account"
    >
      {/* Error Alert */}
      {errorMessage && (
        <div
          role="alert"
          data-testid="login-error"
          className="mb-4 p-4 rounded-md bg-destructive/10 border border-destructive/20"
        >
          <p className="text-sm text-destructive">{errorMessage}</p>
          <button
            type="button"
            onClick={clearError}
            className="mt-2 text-xs text-destructive/70 hover:text-destructive underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Email field */}
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            aria-label="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            disabled={isLoading}
          />
        </div>

        {/* Password field */}
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            aria-label="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            disabled={isLoading}
          />
        </div>

        {/* Submit button */}
        <Button
          type="submit"
          className="w-full"
          disabled={isLoading}
          onClick={handleButtonClick}
        >
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isLoading ? 'Signing in...' : 'Sign In'}
        </Button>

        {/* Links */}
        <div className="flex flex-col items-center gap-2 text-sm">
          <Link
            to="/forgot-password"
            className="text-muted-foreground hover:text-primary underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
          <p className="text-muted-foreground">
            Don't have an account?{' '}
            <Link
              to="/signup"
              className="text-primary hover:underline underline-offset-4"
            >
              Sign up
            </Link>
          </p>
        </div>
      </form>
    </AuthLayout>
  )
}
