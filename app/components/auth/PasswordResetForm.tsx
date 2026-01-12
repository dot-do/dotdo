/**
 * PasswordResetForm Component
 *
 * Password reset form with required data-testid attributes for E2E testing.
 *
 * Test IDs:
 * - reset-form: Form container
 * - reset-email: Email input
 * - reset-submit: Submit button
 * - reset-back-to-login: Back to login link
 * - reset-confirmation: Confirmation message after submission
 * - reset-error: Error message container
 */

import * as React from 'react'
import { useState } from 'react'
import { Button } from '@mdxui/primitives/button'
import { Input } from '@mdxui/primitives/input'
import { Label } from '@mdxui/primitives/label'
import { cn } from '@mdxui/primitives/lib/utils'
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react'

interface PasswordResetFormProps {
  mode?: 'request' | 'confirm'
  onRequestSubmit?: (data: { email: string }) => void | Promise<void>
  onConfirmSubmit?: (data: {
    password: string
    confirmPassword: string
  }) => void | Promise<void>
  onBackToLogin?: () => void
  isLoading?: boolean
  error?: string
  successMessage?: string
  className?: string
}

export function PasswordResetForm({
  mode = 'request',
  onRequestSubmit,
  onConfirmSubmit,
  onBackToLogin,
  isLoading = false,
  error,
  successMessage,
  className,
}: PasswordResetFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const displayError = error || localError
  const showConfirmation = submitted && !displayError

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)

    if (!email) {
      setLocalError('Please enter your email address')
      return
    }

    try {
      await onRequestSubmit?.({ email })
      setSubmitted(true)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to send reset email')
    }
  }

  const handleConfirmSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)

    if (!password || !confirmPassword) {
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

    try {
      await onConfirmSubmit?.({ password, confirmPassword })
      setSubmitted(true)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to reset password')
    }
  }

  // Request mode - ask for email
  if (mode === 'request') {
    return (
      <div className={cn('space-y-6', className)}>
        {/* Success confirmation */}
        {showConfirmation && (
          <div
            data-testid="reset-confirmation"
            className="rounded-md bg-green-50 dark:bg-green-950/50 p-4 text-sm"
          >
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-500 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium text-green-800 dark:text-green-200">
                  Check your email
                </p>
                <p className="text-green-700 dark:text-green-300">
                  We've sent a password reset link to <strong>{email}</strong>.
                  Please check your inbox and spam folder.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Error message */}
        {displayError && (
          <div
            data-testid="reset-error"
            className="rounded-md bg-destructive/15 p-3 text-sm text-destructive"
            role="alert"
          >
            {displayError}
          </div>
        )}

        {/* Request form */}
        {!showConfirmation && (
          <form
            data-testid="reset-form"
            onSubmit={handleRequestSubmit}
            className="space-y-6"
          >
            <div className="space-y-2">
              <Label htmlFor="reset-email">Email</Label>
              <Input
                id="reset-email"
                data-testid="reset-email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                aria-describedby={displayError ? 'reset-error' : undefined}
                aria-invalid={!!displayError}
              />
              <p className="text-xs text-muted-foreground">
                Enter the email address associated with your account and we'll
                send you a link to reset your password.
              </p>
            </div>

            <Button
              type="submit"
              data-testid="reset-submit"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send reset link
            </Button>
          </form>
        )}

        {/* Back to login link */}
        <button
          type="button"
          data-testid="reset-back-to-login"
          onClick={onBackToLogin}
          className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary w-full"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to login
        </button>
      </div>
    )
  }

  // Confirm mode - set new password
  return (
    <div className={cn('space-y-6', className)}>
      {/* Success confirmation */}
      {showConfirmation && (
        <div
          data-testid="reset-confirmation"
          className="rounded-md bg-green-50 dark:bg-green-950/50 p-4 text-sm"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-500 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium text-green-800 dark:text-green-200">
                Password reset successful
              </p>
              <p className="text-green-700 dark:text-green-300">
                Your password has been updated. You can now sign in with your new password.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error message */}
      {displayError && (
        <div
          data-testid="reset-error"
          className="rounded-md bg-destructive/15 p-3 text-sm text-destructive"
          role="alert"
        >
          {displayError}
        </div>
      )}

      {/* Confirm form */}
      {!showConfirmation && (
        <form
          data-testid="reset-form"
          onSubmit={handleConfirmSubmit}
          className="space-y-6"
        >
          <div className="space-y-2">
            <Label htmlFor="reset-password">New Password</Label>
            <Input
              id="reset-password"
              data-testid="reset-password"
              type="password"
              placeholder="Enter new password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              aria-describedby={displayError ? 'reset-error' : undefined}
              aria-invalid={!!displayError}
            />
            <p className="text-xs text-muted-foreground">
              Password must be at least 8 characters
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reset-password-confirm">Confirm New Password</Label>
            <Input
              id="reset-password-confirm"
              data-testid="reset-password-confirm"
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              aria-invalid={confirmPassword.length > 0 && password !== confirmPassword}
            />
          </div>

          <Button
            type="submit"
            data-testid="reset-submit"
            className="w-full"
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reset password
          </Button>
        </form>
      )}

      {/* Back to login link */}
      <button
        type="button"
        data-testid="reset-back-to-login"
        onClick={onBackToLogin}
        className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary w-full"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to login
      </button>
    </div>
  )
}

export type { PasswordResetFormProps }
