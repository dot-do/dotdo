'use client'

/**
 * OAuth Logout Route
 *
 * Handles user logout by revoking tokens and clearing the session.
 * Provides visual feedback during the logout process and handles
 * errors gracefully.
 *
 * Flow:
 * 1. User navigates to /auth/logout (optionally with returnTo param)
 * 2. Route calls /auth/logout endpoint to revoke tokens
 * 3. User is redirected to returnTo URL or home
 *
 * Error handling:
 * - Logout endpoint failures still redirect (fail-safe)
 * - Network errors show brief message then redirect
 *
 * @see /app/routes/auth-logout.ts - Server-side handler
 * @see /app/hooks/use-oauth.tsx - OAuthProvider logout method
 */

import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useState, useCallback } from 'react'
import { AuthLoading } from '../components/auth/AuthLoading'
import { sanitizeRedirectUrl } from '../lib/auth-config'

// =============================================================================
// Types
// =============================================================================

/**
 * Search parameters for logout route
 */
interface LogoutSearch {
  /** URL to redirect to after logout */
  returnTo?: string
}

/**
 * Logout processing state
 */
type LogoutState =
  | { status: 'processing' }
  | { status: 'success'; redirectTo: string }
  | { status: 'error'; redirectTo: string }

// =============================================================================
// Route Definition
// =============================================================================

export const Route = createFileRoute('/auth/logout')({
  component: LogoutComponent,
  validateSearch: (search: Record<string, unknown>): LogoutSearch => ({
    returnTo: typeof search.returnTo === 'string' ? search.returnTo : undefined,
  }),
})

// =============================================================================
// Component
// =============================================================================

/**
 * OAuth Logout Component
 *
 * Handles logout flow with proper error handling and user feedback.
 */
function LogoutComponent() {
  const navigate = useNavigate()
  const { returnTo } = useSearch({ from: '/auth/logout' })
  const [logoutState, setLogoutState] = useState<LogoutState>({ status: 'processing' })

  /**
   * Perform logout operation
   */
  const performLogout = useCallback(async () => {
    // Sanitize the return URL to prevent open redirects
    const decodedReturnTo = returnTo ? decodeURIComponent(returnTo) : '/'
    const redirectTo = sanitizeRedirectUrl(decodedReturnTo)

    try {
      // Call logout endpoint to revoke tokens and clear session
      const response = await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })

      // Log failures but don't block redirect
      if (!response.ok) {
        console.warn('Logout endpoint returned non-OK status:', response.status)
      }

      setLogoutState({ status: 'success', redirectTo })
    } catch (err) {
      // Network errors - still redirect but note the error
      console.warn('Logout request failed:', err)
      setLogoutState({ status: 'error', redirectTo })
    }

    // Always redirect regardless of logout success
    // This ensures users are logged out client-side even if server fails
    navigate({ to: redirectTo })
  }, [returnTo, navigate])

  // Perform logout on mount
  useEffect(() => {
    performLogout()
  }, [performLogout])

  // Determine loading message based on state
  const getMessage = () => {
    switch (logoutState.status) {
      case 'success':
        return {
          message: 'Signed out successfully',
          description: `Redirecting to ${logoutState.redirectTo}...`,
        }
      case 'error':
        return {
          message: 'Signing out...',
          description: 'Completing logout process.',
        }
      default:
        return {
          message: 'Signing out...',
          description: 'Please wait while we log you out.',
        }
    }
  }

  const { message, description } = getMessage()

  return (
    <AuthLoading
      message={message}
      description={description}
    />
  )
}
