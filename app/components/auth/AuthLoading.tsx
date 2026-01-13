/**
 * AuthLoading Component
 *
 * Displays a loading spinner with message during authentication operations.
 * Used by auth routes (callback, logout) to provide visual feedback.
 *
 * @example
 * ```tsx
 * <AuthLoading message="Signing you in..." />
 * ```
 */

import * as React from 'react'
import { cn } from '@mdxui/primitives/lib/utils'

export interface AuthLoadingProps extends React.ComponentProps<'div'> {
  /** Message to display below the spinner */
  message?: string
  /** Optional additional description */
  description?: string
}

/**
 * AuthLoading - Full-page loading indicator for auth operations
 */
export function AuthLoading({
  message = 'Loading...',
  description,
  className,
  ...props
}: AuthLoadingProps) {
  return (
    <div
      data-testid="auth-loading"
      className={cn(
        'min-h-screen flex items-center justify-center bg-background',
        className
      )}
      role="status"
      aria-busy="true"
      aria-label={message}
      {...props}
    >
      <div className="text-center">
        <div
          data-testid="auth-loading-spinner"
          className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto"
          aria-hidden="true"
        />
        <p className="mt-4 text-muted-foreground" data-testid="auth-loading-message">
          {message}
        </p>
        {description && (
          <p className="mt-2 text-sm text-muted-foreground/70" data-testid="auth-loading-description">
            {description}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * AuthLoadingInline - Inline loading indicator for smaller contexts
 */
export function AuthLoadingInline({
  message = 'Loading...',
  className,
  ...props
}: Omit<AuthLoadingProps, 'description'>) {
  return (
    <div
      data-testid="auth-loading-inline"
      className={cn('flex items-center gap-2', className)}
      role="status"
      aria-busy="true"
      aria-label={message}
      {...props}
    >
      <div
        className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-primary"
        aria-hidden="true"
      />
      <span className="text-sm text-muted-foreground">{message}</span>
    </div>
  )
}

export default AuthLoading
