'use client'

/**
 * OAuth Callback Route
 *
 * Handles the OAuth callback from oauth.do after user authentication.
 * Processes the authorization code, exchanges it for tokens, and redirects
 * to the intended destination.
 *
 * Flow:
 * 1. User completes authentication at oauth.do
 * 2. oauth.do redirects back with code and state parameters
 * 3. This route exchanges the code for tokens via /auth/token
 * 4. User is redirected to the destination encoded in state (or /)
 *
 * Error handling:
 * - OAuth errors (access_denied, etc.) redirect to /login with error params
 * - Token exchange failures redirect to /login with error=token_exchange_failed
 * - Network errors show retry option or redirect home
 *
 * @see /app/routes/login.tsx - Login initiation
 * @see /app/routes/auth-callback.ts - Server-side handler
 * @see /app/lib/auth-config.ts - Configuration
 */

import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useState, useCallback } from 'react'
import { AuthLoading } from '../components/auth/AuthLoading'
import { AuthErrorFallback, getAuthErrorMessage } from '../components/auth/AuthErrorBoundary'
import { sanitizeRedirectUrl } from '../lib/auth-config'

// =============================================================================
// Types
// =============================================================================

/**
 * Search parameters for OAuth callback
 */
interface CallbackSearch {
  /** Authorization code from OAuth provider */
  code?: string
  /** State parameter containing return URL */
  state?: string
  /** OAuth error code (if authentication failed) */
  error?: string
  /** Human-readable error description */
  error_description?: string
}

/**
 * Callback processing state
 */
type CallbackState =
  | { status: 'processing' }
  | { status: 'error'; code: string; message: string }
  | { status: 'success'; redirectTo: string }

// =============================================================================
// Route Definition
// =============================================================================

export const Route = createFileRoute('/auth/callback')({
  component: CallbackComponent,
  validateSearch: (search: Record<string, unknown>): CallbackSearch => ({
    code: typeof search.code === 'string' ? search.code : undefined,
    state: typeof search.state === 'string' ? search.state : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
    error_description: typeof search.error_description === 'string' ? search.error_description : undefined,
  }),
})

// =============================================================================
// Component
// =============================================================================

/**
 * OAuth Callback Component
 *
 * Processes OAuth callback, handles errors gracefully, and provides
 * user feedback during the authentication flow.
 */
function CallbackComponent() {
  const navigate = useNavigate()
  const { code, state, error, error_description } = useSearch({ from: '/auth/callback' })
  const [callbackState, setCallbackState] = useState<CallbackState>({ status: 'processing' })

  /**
   * Process the OAuth callback
   */
  const processCallback = useCallback(async () => {
    // Handle OAuth error from provider - redirect immediately to login
    // This matches expected behavior: OAuth errors should redirect back to login
    if (error) {
      navigate({ to: '/login' })
      return
    }

    // Handle missing code - redirect to login
    // This happens when callback is accessed directly without completing OAuth flow
    if (!code) {
      navigate({ to: '/login' })
      return
    }

    try {
      // Exchange code for tokens
      const response = await fetch('/auth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
        credentials: 'include',
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(errorData.error || 'token_exchange_failed')
      }

      // Sanitize and decode return URL from state
      const decodedState = state ? decodeURIComponent(state) : '/'
      const redirectTo = sanitizeRedirectUrl(decodedState)

      setCallbackState({ status: 'success', redirectTo })

      // Navigate to the intended destination
      navigate({ to: redirectTo })
    } catch (err) {
      const errorCode = err instanceof Error && err.message ? err.message : 'callback_failed'
      setCallbackState({
        status: 'error',
        code: errorCode,
        message: getAuthErrorMessage(errorCode),
      })
    }
  }, [code, state, error, error_description, navigate])

  /**
   * Retry callback processing
   */
  const handleRetry = useCallback(() => {
    setCallbackState({ status: 'processing' })
    processCallback()
  }, [processCallback])

  // Process callback on mount
  useEffect(() => {
    processCallback()
  }, [processCallback])

  // Render based on state
  if (callbackState.status === 'error') {
    return (
      <AuthErrorFallback
        error={new Error(callbackState.message)}
        errorCode={callbackState.code}
        resetErrorBoundary={handleRetry}
      />
    )
  }

  if (callbackState.status === 'success') {
    return (
      <AuthLoading
        message="Authentication successful"
        description={`Redirecting to ${callbackState.redirectTo}...`}
      />
    )
  }

  // Default: processing state
  return (
    <AuthLoading
      message="Processing authentication..."
      description="Please wait while we complete your sign in."
    />
  )
}
