/**
 * SignupForm Component
 *
 * Signup form with required data-testid attributes for E2E testing.
 *
 * Test IDs:
 * - signup-form: Form container
 * - signup-name: Name input
 * - signup-email: Email input
 * - signup-password: Password input
 * - signup-password-confirm: Password confirmation input
 * - signup-submit: Submit button
 * - signup-terms: Terms acceptance checkbox
 * - signup-login-link: Login link
 * - signup-error: Error message container
 * - signup-password-requirements: Password requirements display
 * - password-strength: Password strength indicator
 * - oauth-google: Google OAuth button
 * - oauth-github: GitHub OAuth button
 * - oauth-microsoft: Microsoft OAuth button
 * - oauth-divider: OAuth divider ("or" text)
 */

import * as React from 'react'
import { useState, useMemo } from 'react'
import { Button } from '@mdxui/primitives/button'
import { Input } from '@mdxui/primitives/input'
import { Label } from '@mdxui/primitives/label'
import { Checkbox } from '@mdxui/primitives/checkbox'
import { cn } from '@mdxui/primitives/lib/utils'
import { Chrome, Github, Loader2 } from 'lucide-react'

interface SignupFormProps {
  onSubmit?: (data: {
    fullName: string
    email: string
    password: string
    confirmPassword: string
    agreeToTerms: boolean
  }) => void | Promise<void>
  onOAuthClick?: (provider: 'google' | 'github' | 'microsoft') => void | Promise<void>
  onLoginClick?: () => void
  isLoading?: boolean
  showOAuth?: boolean
  oauthProviders?: Array<'google' | 'github' | 'microsoft'>
  error?: string
  className?: string
}

function getPasswordStrength(password: string): {
  score: number
  label: string
  color: string
} {
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[^a-zA-Z0-9]/.test(password)) score++

  if (score <= 1) return { score, label: 'Weak', color: 'bg-red-500' }
  if (score <= 2) return { score, label: 'Fair', color: 'bg-orange-500' }
  if (score <= 3) return { score, label: 'Good', color: 'bg-yellow-500' }
  return { score, label: 'Strong', color: 'bg-green-500' }
}

export function SignupForm({
  onSubmit,
  onOAuthClick,
  onLoginClick,
  isLoading = false,
  showOAuth = true,
  oauthProviders = ['google', 'github', 'microsoft'],
  error,
  className,
}: SignupFormProps) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [agreeToTerms, setAgreeToTerms] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const displayError = error || localError
  const passwordStrength = useMemo(() => getPasswordStrength(password), [password])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)

    if (!fullName || !email || !password) {
      setLocalError('Please fill in all fields')
      return
    }

    if (password.length < 8) {
      setLocalError('Password must be at least 8 characters')
      return
    }

    if (password !== confirmPassword) {
      setLocalError('Passwords do not match')
      return
    }

    if (!agreeToTerms) {
      setLocalError('You must accept the terms and conditions')
      return
    }

    try {
      await onSubmit?.({ fullName, email, password, confirmPassword, agreeToTerms })
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Signup failed')
    }
  }

  const handleOAuthClick = async (provider: 'google' | 'github' | 'microsoft') => {
    try {
      await onOAuthClick?.(provider)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : `${provider} signup failed`)
    }
  }

  return (
    <form
      data-testid="signup-form"
      onSubmit={handleSubmit}
      className={cn('space-y-6', className)}
    >
      {/* Error message */}
      {displayError && (
        <div
          data-testid="signup-error"
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

      {/* Name field */}
      <div className="space-y-2">
        <Label htmlFor="signup-name">Full Name</Label>
        <Input
          id="signup-name"
          data-testid="signup-name"
          type="text"
          placeholder="John Doe"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          autoComplete="name"
          aria-describedby={displayError ? 'signup-error' : undefined}
          aria-invalid={!!displayError}
        />
      </div>

      {/* Email field */}
      <div className="space-y-2">
        <Label htmlFor="signup-email">Email</Label>
        <Input
          id="signup-email"
          data-testid="signup-email"
          type="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          aria-describedby={displayError ? 'signup-error' : undefined}
          aria-invalid={!!displayError}
        />
      </div>

      {/* Password field with requirements */}
      <div className="space-y-2">
        <Label htmlFor="signup-password">Password</Label>
        <Input
          id="signup-password"
          data-testid="signup-password"
          type="password"
          placeholder="Create a password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
          aria-describedby="password-requirements"
          aria-invalid={password.length > 0 && password.length < 8}
        />

        {/* Password strength indicator */}
        {password.length > 0 && (
          <div
            data-testid="password-strength"
            role="progressbar"
            aria-valuenow={passwordStrength.score}
            aria-valuemin={0}
            aria-valuemax={5}
            className="space-y-1"
          >
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className={cn(
                    'h-1 flex-1 rounded-full transition-colors',
                    i <= passwordStrength.score
                      ? passwordStrength.color
                      : 'bg-muted'
                  )}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Password strength: {passwordStrength.label}
            </p>
          </div>
        )}

        {/* Password requirements */}
        <div
          id="password-requirements"
          data-testid="signup-password-requirements"
          className={cn(
            'text-xs',
            password.length > 0 && password.length < 8
              ? 'text-destructive'
              : 'text-muted-foreground'
          )}
        >
          Password must be at least 8 characters
        </div>
      </div>

      {/* Confirm Password field */}
      <div className="space-y-2">
        <Label htmlFor="signup-password-confirm">Confirm Password</Label>
        <Input
          id="signup-password-confirm"
          data-testid="signup-password-confirm"
          type="password"
          placeholder="Confirm your password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          autoComplete="new-password"
          aria-invalid={confirmPassword.length > 0 && password !== confirmPassword}
        />
        {confirmPassword.length > 0 && password !== confirmPassword && (
          <p className="text-xs text-destructive">Passwords do not match</p>
        )}
      </div>

      {/* Terms checkbox */}
      <div className="flex items-start space-x-2">
        <Checkbox
          id="signup-terms"
          data-testid="signup-terms"
          checked={agreeToTerms}
          onCheckedChange={(checked) => setAgreeToTerms(checked === true)}
          required
          className="mt-1"
        />
        <Label
          htmlFor="signup-terms"
          className="text-sm font-normal cursor-pointer leading-relaxed"
        >
          I agree to the{' '}
          <a href="/terms" className="text-primary hover:underline underline-offset-4">
            Terms of Service
          </a>{' '}
          and{' '}
          <a href="/privacy" className="text-primary hover:underline underline-offset-4">
            Privacy Policy
          </a>
        </Label>
      </div>

      {/* Submit button */}
      <Button
        type="submit"
        data-testid="signup-submit"
        className="w-full"
        disabled={isLoading}
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Create account
      </Button>

      {/* Login link */}
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <button
          type="button"
          data-testid="signup-login-link"
          onClick={onLoginClick}
          className="text-primary hover:underline underline-offset-4"
        >
          Sign in
        </button>
      </p>
    </form>
  )
}

export type { SignupFormProps }
