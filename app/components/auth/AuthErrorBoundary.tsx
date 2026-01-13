/**
 * AuthErrorBoundary Component
 *
 * Specialized error boundary for authentication-related errors.
 * Provides user-friendly error messages for common OAuth errors
 * and retry/login options.
 *
 * @example
 * ```tsx
 * <AuthErrorBoundary>
 *   <CallbackComponent />
 * </AuthErrorBoundary>
 * ```
 */

import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { cn } from '@mdxui/primitives/lib/utils'
import { Button } from '@mdxui/primitives/button'
import { AlertCircle, RefreshCw, Home, LogIn } from 'lucide-react'

// =============================================================================
// Types
// =============================================================================

/**
 * OAuth error codes and their user-friendly messages
 */
export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Access was denied. Please try again or contact support.',
  invalid_request: 'The authentication request was invalid. Please try again.',
  unauthorized_client: 'This application is not authorized. Please contact support.',
  unsupported_response_type: 'An authentication configuration error occurred.',
  invalid_scope: 'The requested permissions are not available.',
  server_error: 'The authentication server encountered an error. Please try again.',
  temporarily_unavailable: 'Authentication is temporarily unavailable. Please try again later.',
  invalid_state: 'Session expired or invalid. Please try logging in again.',
  missing_code: 'Authentication code missing. Please try logging in again.',
  token_exchange_failed: 'Failed to complete sign in. Please try again.',
  user_fetch_failed: 'Failed to retrieve user information. Please try again.',
  callback_failed: 'Authentication callback failed. Please try again.',
  network_error: 'Network error occurred. Please check your connection and try again.',
  default: 'An unexpected authentication error occurred. Please try again.',
}

export interface AuthErrorFallbackProps {
  error: Error
  errorCode?: string
  resetErrorBoundary: () => void
}

export interface AuthErrorBoundaryProps {
  children: React.ReactNode
  /** Custom fallback component */
  fallback?: React.ComponentType<AuthErrorFallbackProps>
  /** Callback when error occurs */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
  /** Callback when reset */
  onReset?: () => void
}

interface AuthErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorCode: string | null
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract error code from URL search params
 */
export function getErrorFromUrl(): { code: string; description?: string } | null {
  if (typeof window === 'undefined') return null

  const params = new URLSearchParams(window.location.search)
  const errorCode = params.get('error')

  if (!errorCode) return null

  return {
    code: errorCode,
    description: params.get('error_description') || undefined,
  }
}

/**
 * Get user-friendly message for error code
 */
export function getAuthErrorMessage(errorCode: string | null): string {
  if (!errorCode) return AUTH_ERROR_MESSAGES.default
  return AUTH_ERROR_MESSAGES[errorCode] || AUTH_ERROR_MESSAGES.default
}

// =============================================================================
// Default Fallback Component
// =============================================================================

/**
 * Default fallback UI for auth errors
 */
export function AuthErrorFallback({
  error,
  errorCode,
  resetErrorBoundary,
}: AuthErrorFallbackProps) {
  const displayCode = errorCode || 'unknown_error'
  const message = getAuthErrorMessage(errorCode || null)

  return (
    <div
      data-testid="auth-error-boundary"
      className="min-h-screen flex items-center justify-center bg-background p-4"
      role="alert"
    >
      <div className="w-full max-w-md text-center space-y-6">
        {/* Error Icon */}
        <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
        </div>

        {/* Error Title */}
        <div className="space-y-2">
          <h1
            data-testid="auth-error-title"
            className="text-2xl font-bold tracking-tight"
          >
            Authentication Error
          </h1>
          <p
            data-testid="auth-error-message"
            className="text-muted-foreground"
          >
            {message}
          </p>
        </div>

        {/* Error Code (for debugging) */}
        <p
          data-testid="auth-error-code"
          className="text-xs text-muted-foreground/50 font-mono"
        >
          Error code: {displayCode}
        </p>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            variant="default"
            onClick={resetErrorBoundary}
            data-testid="auth-error-retry"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
          <Button variant="outline" asChild>
            <Link to="/login" data-testid="auth-error-login">
              <LogIn className="mr-2 h-4 w-4" />
              Back to Login
            </Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/" data-testid="auth-error-home">
              <Home className="mr-2 h-4 w-4" />
              Go Home
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// AuthErrorBoundary Component
// =============================================================================

/**
 * Error boundary specialized for authentication flows.
 *
 * Catches errors in auth routes and displays user-friendly messages
 * with retry and navigation options.
 */
export class AuthErrorBoundary extends React.Component<
  AuthErrorBoundaryProps,
  AuthErrorBoundaryState
> {
  constructor(props: AuthErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorCode: null }
  }

  static getDerivedStateFromError(error: Error): Partial<AuthErrorBoundaryState> {
    // Check URL for error code
    const urlError = getErrorFromUrl()
    return {
      hasError: true,
      error,
      errorCode: urlError?.code || null,
    }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Call onError callback if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo)
    }

    // Log error for debugging (in development only)
    if (process.env.NODE_ENV === 'development') {
      console.error('AuthErrorBoundary caught error:', error, errorInfo)
    }
  }

  resetErrorBoundary = (): void => {
    if (this.props.onReset) {
      this.props.onReset()
    }
    this.setState({ hasError: false, error: null, errorCode: null })
  }

  render(): React.ReactNode {
    const { hasError, error, errorCode } = this.state
    const { children, fallback: FallbackComponent } = this.props

    if (hasError && error) {
      if (FallbackComponent) {
        return (
          <FallbackComponent
            error={error}
            errorCode={errorCode || undefined}
            resetErrorBoundary={this.resetErrorBoundary}
          />
        )
      }

      return (
        <AuthErrorFallback
          error={error}
          errorCode={errorCode || undefined}
          resetErrorBoundary={this.resetErrorBoundary}
        />
      )
    }

    return children
  }
}

export default AuthErrorBoundary
