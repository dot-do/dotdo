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
import { useState } from 'react'
import { Button } from '@mdxui/primitives/button'
import { Input } from '@mdxui/primitives/input'
import { Label } from '@mdxui/primitives/label'
import { Checkbox } from '@mdxui/primitives/checkbox'
import { cn } from '@mdxui/primitives/lib/utils'
import { Chrome, Github, Loader2 } from 'lucide-react'

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

  const displayError = error || localError

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)

    if (!email || !password) {
      setLocalError('Please fill in all fields')
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
        <Input
          id="login-email"
          data-testid="login-email-input"
          type="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          aria-describedby={displayError ? 'login-error' : undefined}
          aria-invalid={!!displayError}
        />
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
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          aria-describedby={displayError ? 'login-error' : undefined}
          aria-invalid={!!displayError}
        />
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
