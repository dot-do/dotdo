/**
 * LoginForm Component
 *
 * Login form with required data-testid attributes for E2E testing.
 *
 * Test IDs:
 * - login-form: Form container
 * - login-email-input: Email input
 * - login-password-input: Password input
 * - login-submit-button: Submit button
 * - login-remember-me: Remember me checkbox
 * - login-forgot-password: Forgot password link
 * - login-signup-link: Sign up link
 * - login-error: Error message container
 * - oauth-google: Google OAuth button
 * - oauth-github: GitHub OAuth button
 * - oauth-microsoft: Microsoft OAuth button
 * - oauth-divider: OAuth divider ("or" text)
 */

import * as React from 'react'
import { useState, useCallback, useMemo } from 'react'
import { Button } from '@mdxui/primitives/button'
import { Input } from '@mdxui/primitives/input'
import { Label } from '@mdxui/primitives/label'
import { Checkbox } from '@mdxui/primitives/checkbox'
import { cn } from '@mdxui/primitives/lib/utils'
import { Chrome, Github, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate email format using RFC 5322 simplified pattern.
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Get user-friendly validation error message.
 */
function getValidationError(field: 'email' | 'password', value: string): string | null {
  if (field === 'email') {
    if (!value.trim()) return 'Email is required'
    if (!isValidEmail(value)) return 'Please enter a valid email address'
    return null
  }
  if (field === 'password') {
    if (!value) return 'Password is required'
    return null
  }
  return null
}

/**
 * Map common auth error codes to user-friendly messages.
 */
function getAuthErrorMessage(error: string): string {
  const errorMap: Record<string, string> = {
    invalid_credentials: 'Invalid email or password. Please check your credentials and try again.',
    account_locked: 'Your account has been temporarily locked due to too many failed attempts. Please try again later.',
    account_disabled: 'Your account has been disabled. Please contact support.',
    email_not_verified: 'Please verify your email address before signing in.',
    rate_limited: 'Too many login attempts. Please wait a moment and try again.',
    network_error: 'Unable to connect. Please check your internet connection.',
    server_error: 'Something went wrong on our end. Please try again later.',
  }
  return errorMap[error] || error
}

// ============================================================================
// Types
// ============================================================================

interface LoginFormProps {
  onSubmit?: (data: {
    email: string
    password: string
    rememberMe?: boolean
  }) => void | Promise<void>
  onOAuthClick?: (provider: 'google' | 'github' | 'microsoft') => void | Promise<void>
  onForgotPasswordClick?: () => void
  onSignupClick?: () => void
  isLoading?: boolean
  showOAuth?: boolean
  oauthProviders?: Array<'google' | 'github' | 'microsoft'>
  error?: string
  className?: string
}

// ============================================================================
// Component
// ============================================================================

export function LoginForm({
  onSubmit,
  onOAuthClick,
  onForgotPasswordClick,
  onSignupClick,
  isLoading = false,
  showOAuth = true,
  oauthProviders = ['google', 'github', 'microsoft'],
  error,
  className,
}: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [touched, setTouched] = useState<{ email: boolean; password: boolean }>({
    email: false,
    password: false,
  })

  // Compute validation errors only for touched fields
  const emailError = useMemo(
    () => (touched.email ? getValidationError('email', email) : null),
    [email, touched.email]
  )
  const passwordError = useMemo(
    () => (touched.password ? getValidationError('password', password) : null),
    [password, touched.password]
  )

  // Format the display error with user-friendly message
  const displayError = useMemo(() => {
    const err = error || localError
    if (!err) return null
    return getAuthErrorMessage(err)
  }, [error, localError])

  // Clear error when user starts typing
  const handleEmailChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value)
    if (localError) setLocalError(null)
  }, [localError])

  const handlePasswordChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value)
    if (localError) setLocalError(null)
  }, [localError])

  const handleBlur = useCallback((field: 'email' | 'password') => {
    setTouched((prev) => ({ ...prev, [field]: true }))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)
    setTouched({ email: true, password: true })

    // Validate all fields
    const emailValidation = getValidationError('email', email)
    const passwordValidation = getValidationError('password', password)

    if (emailValidation || passwordValidation) {
      setLocalError(emailValidation || passwordValidation || 'Please fill in all fields')
      return
    }

    try {
      await onSubmit?.({ email, password, rememberMe })
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Login failed')
    }
  }

  const handleOAuthClick = async (provider: 'google' | 'github' | 'microsoft') => {
    try {
      await onOAuthClick?.(provider)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : `${provider} login failed`)
    }
  }

  return (
    <form
      data-testid="login-form"
      onSubmit={handleSubmit}
      className={cn('space-y-6', className)}
    >
      {/* Error message */}
      {displayError && (
        <div
          data-testid="login-error"
          className="rounded-md bg-destructive/15 p-3 text-sm text-destructive"
          role="alert"
        >
          {displayError}
        </div>
      )}

      {/* OAuth buttons */}
      {showOAuth && oauthProviders.length > 0 && (
        <>
          <div className="grid gap-3">
            {oauthProviders.includes('google') && (
              <Button
                type="button"
                variant="outline"
                data-testid="oauth-google"
                onClick={() => handleOAuthClick('google')}
                disabled={isLoading}
                className="w-full"
              >
                <Chrome className="mr-2 h-4 w-4" />
                Continue with Google
              </Button>
            )}
            {oauthProviders.includes('github') && (
              <Button
                type="button"
                variant="outline"
                data-testid="oauth-github"
                onClick={() => handleOAuthClick('github')}
                disabled={isLoading}
                className="w-full"
              >
                <Github className="mr-2 h-4 w-4" />
                Continue with GitHub
              </Button>
            )}
            {oauthProviders.includes('microsoft') && (
              <Button
                type="button"
                variant="outline"
                data-testid="oauth-microsoft"
                onClick={() => handleOAuthClick('microsoft')}
                disabled={isLoading}
                className="w-full"
              >
                <svg
                  className="mr-2 h-4 w-4"
                  viewBox="0 0 21 21"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                  <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                  <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                  <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
                </svg>
                Continue with Microsoft
              </Button>
            )}
          </div>

          <div
            data-testid="oauth-divider"
            className="relative flex items-center justify-center"
          >
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <span className="relative bg-background px-2 text-xs text-muted-foreground uppercase">
              Or continue with email
            </span>
          </div>
        </>
      )}

      {/* Email field */}
      <div className="space-y-2">
        <Label htmlFor="login-email">Email</Label>
        <div className="relative">
          <Input
            id="login-email"
            data-testid="login-email-input"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={handleEmailChange}
            onBlur={() => handleBlur('email')}
            required
            autoComplete="email"
            aria-describedby={emailError ? 'login-email-error' : displayError ? 'login-error' : undefined}
            aria-invalid={!!emailError}
            className={cn(emailError && 'border-destructive focus-visible:ring-destructive')}
          />
          {/* Email validation indicator */}
          {email && touched.email && !emailError && (
            <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" aria-hidden="true" />
          )}
        </div>
        {/* Inline email error */}
        {emailError && (
          <p id="login-email-error" className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
            {emailError}
          </p>
        )}
      </div>

      {/* Password field */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="login-password">Password</Label>
          <button
            type="button"
            data-testid="login-forgot-password"
            onClick={onForgotPasswordClick}
            className="text-sm text-muted-foreground hover:text-primary underline-offset-4 hover:underline"
          >
            Forgot password?
          </button>
        </div>
        <Input
          id="login-password"
          data-testid="login-password-input"
          type="password"
          placeholder="Enter your password"
          value={password}
          onChange={handlePasswordChange}
          onBlur={() => handleBlur('password')}
          required
          autoComplete="current-password"
          aria-describedby={passwordError ? 'login-password-error' : displayError ? 'login-error' : undefined}
          aria-invalid={!!passwordError}
          className={cn(passwordError && 'border-destructive focus-visible:ring-destructive')}
        />
        {/* Inline password error */}
        {passwordError && (
          <p id="login-password-error" className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
            {passwordError}
          </p>
        )}
      </div>

      {/* Remember me checkbox */}
      <div className="flex items-center space-x-2">
        <Checkbox
          id="login-remember-me"
          data-testid="login-remember-me"
          checked={rememberMe}
          onCheckedChange={(checked) => setRememberMe(checked === true)}
        />
        <Label
          htmlFor="login-remember-me"
          className="text-sm font-normal cursor-pointer"
        >
          Remember me
        </Label>
      </div>

      {/* Submit button */}
      <Button
        type="submit"
        data-testid="login-submit-button"
        className="w-full"
        disabled={isLoading}
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Sign in
      </Button>

      {/* Sign up link */}
      <p className="text-center text-sm text-muted-foreground">
        Don't have an account?{' '}
        <button
          type="button"
          data-testid="login-signup-link"
          onClick={onSignupClick}
          className="text-primary hover:underline underline-offset-4"
        >
          Sign up
        </button>
      </p>
    </form>
  )
}

export type { LoginFormProps }
