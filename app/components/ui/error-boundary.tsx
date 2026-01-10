/**
 * ErrorBoundary Component
 *
 * Catches JavaScript errors in child component tree and renders fallback UI.
 * Provides error recovery/retry mechanism and error logging via callbacks.
 *
 * Features:
 * - Catches errors thrown during render, in lifecycle methods, and constructors
 * - Renders fallback UI when an error occurs
 * - Supports custom fallback components (via fallback, fallbackRender, or fallbackUI props)
 * - Provides reset/retry capability
 * - Logs errors via onError callback
 * - Supports resetKeys for automatic reset when props change
 *
 * @see app/components/ui/__tests__/error-boundary.test.tsx
 */

import * as React from 'react'

// =============================================================================
// Types
// =============================================================================

export interface FallbackProps {
  error: Error
  resetErrorBoundary: () => void
}

export interface ErrorBoundaryFallbackProps extends FallbackProps {
  /** Custom title for the error display */
  title?: string
  /** Custom retry button text */
  retryText?: string
}

export interface ErrorBoundaryProps {
  /** Child components to render */
  children: React.ReactNode
  /** Custom fallback component (receives error and resetErrorBoundary props) */
  fallback?: React.ComponentType<FallbackProps>
  /** Render prop for fallback UI */
  fallbackRender?: (props: FallbackProps) => React.ReactNode
  /** Static fallback element (no error/reset props) */
  fallbackUI?: React.ReactNode
  /** Callback when an error is caught */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
  /** Callback when error boundary is reset */
  onReset?: () => void
  /** Keys that trigger a reset when changed */
  resetKeys?: unknown[]
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

// =============================================================================
// ErrorBoundaryFallback Component
// =============================================================================

/**
 * Default fallback component for ErrorBoundary.
 * Follows ErrorState styling pattern from app/components/admin/shared.tsx
 */
export function ErrorBoundaryFallback({
  error,
  resetErrorBoundary,
  title = 'Something went wrong',
  retryText = 'Try Again',
}: ErrorBoundaryFallbackProps) {
  return (
    <div
      data-slot="error-boundary-fallback"
      data-testid="error-boundary-fallback"
      role="alert"
      className="text-center py-12"
    >
      <div className="text-red-400 text-5xl mb-4" aria-hidden="true">
        &#9888;
      </div>
      <h2 className="text-xl font-semibold text-red-700 mb-2">{title}</h2>
      <p
        data-slot="error-boundary-message"
        className="text-gray-500 mb-6"
      >
        {error.message}
      </p>
      <button
        type="button"
        onClick={resetErrorBoundary}
        data-slot="error-boundary-retry"
        className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
      >
        {retryText}
      </button>
    </div>
  )
}

// =============================================================================
// ErrorBoundary Component
// =============================================================================

/**
 * React Error Boundary component that catches JavaScript errors
 * in child component tree and renders a fallback UI.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Call onError callback if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo)
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    // Reset error state when resetKeys change
    if (
      this.state.hasError &&
      this.props.resetKeys &&
      prevProps.resetKeys
    ) {
      const hasChanged = this.props.resetKeys.some(
        (key, index) => key !== prevProps.resetKeys?.[index]
      )
      if (hasChanged) {
        this.resetErrorBoundary()
      }
    }
  }

  resetErrorBoundary = (): void => {
    if (this.props.onReset) {
      this.props.onReset()
    }
    this.setState({ hasError: false, error: null })
  }

  render(): React.ReactNode {
    const { hasError, error } = this.state
    const { children, fallback: FallbackComponent, fallbackRender, fallbackUI } = this.props

    if (hasError && error) {
      // Priority: fallbackRender > fallback > fallbackUI > default
      if (fallbackRender) {
        return fallbackRender({
          error,
          resetErrorBoundary: this.resetErrorBoundary,
        })
      }

      if (FallbackComponent) {
        return (
          <FallbackComponent
            error={error}
            resetErrorBoundary={this.resetErrorBoundary}
          />
        )
      }

      if (fallbackUI) {
        return fallbackUI
      }

      // Default fallback
      return (
        <ErrorBoundaryFallback
          error={error}
          resetErrorBoundary={this.resetErrorBoundary}
        />
      )
    }

    return (
      <div data-slot="error-boundary">
        {children}
      </div>
    )
  }
}
