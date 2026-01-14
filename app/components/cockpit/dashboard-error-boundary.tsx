/**
 * Dashboard Error Boundary
 *
 * Specialized error boundary for dashboard sections that provides:
 * - Section-level error isolation (one failing section doesn't break others)
 * - Graceful degradation with retry capability
 * - Compact error display suitable for dashboard cards
 * - Error logging and reporting hooks
 *
 * @see app/components/ui/error-boundary.tsx for the base ErrorBoundary
 */

import * as React from 'react'
import { Component, type ReactNode, useCallback, memo } from 'react'
import { Button } from '~/components/ui/button'
import { AlertTriangle, RefreshCw } from 'lucide-react'

// =============================================================================
// Types
// =============================================================================

export interface DashboardErrorFallbackProps {
  error: Error
  resetErrorBoundary: () => void
  /** Section title for context */
  sectionTitle?: string
  /** Whether to show a compact version */
  compact?: boolean
}

export interface DashboardErrorBoundaryProps {
  /** Child components to render */
  children: ReactNode
  /** Section title for error context */
  sectionTitle?: string
  /** Whether to show compact error display */
  compact?: boolean
  /** Callback when error is caught */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
  /** Callback when boundary is reset */
  onReset?: () => void
  /** Keys that trigger automatic reset when changed */
  resetKeys?: unknown[]
  /** Custom fallback component */
  fallback?: React.ComponentType<DashboardErrorFallbackProps>
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

// =============================================================================
// Default Error Fallback
// =============================================================================

/**
 * Default fallback UI for dashboard sections.
 * Compact and non-intrusive design that fits well in dashboard grids.
 */
export const DashboardErrorFallback = memo(function DashboardErrorFallback({
  error,
  resetErrorBoundary,
  sectionTitle,
  compact = false,
}: DashboardErrorFallbackProps) {
  const handleRetry = useCallback(() => {
    resetErrorBoundary()
  }, [resetErrorBoundary])

  if (compact) {
    return (
      <div
        data-testid="dashboard-error-fallback-compact"
        className="p-4 bg-background rounded-lg border border-destructive/30 text-center"
        role="alert"
      >
        <AlertTriangle className="w-5 h-5 text-destructive mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm text-muted-foreground mb-2">
          {sectionTitle ? `${sectionTitle} unavailable` : 'Section unavailable'}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRetry}
          className="h-7 px-2"
        >
          <RefreshCw className="w-3 h-3 mr-1" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div
      data-testid="dashboard-error-fallback"
      className="p-6 bg-background rounded-lg border border-destructive/30"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0">
          <AlertTriangle
            className="w-5 h-5 text-destructive"
            aria-hidden="true"
          />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-foreground">
            {sectionTitle ? `${sectionTitle} Error` : 'Something went wrong'}
          </h4>
          <p
            data-testid="dashboard-error-message"
            className="mt-1 text-sm text-muted-foreground line-clamp-2"
          >
            {error.message || 'An unexpected error occurred'}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            className="mt-3"
          >
            <RefreshCw className="w-3 h-3 mr-1.5" />
            Try Again
          </Button>
        </div>
      </div>
    </div>
  )
})

// =============================================================================
// Dashboard Error Boundary
// =============================================================================

/**
 * Error boundary optimized for dashboard sections.
 * Provides section-level error isolation so one failing component
 * doesn't bring down the entire dashboard.
 */
export class DashboardErrorBoundary extends Component<
  DashboardErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: DashboardErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error(
        `[DashboardErrorBoundary] ${this.props.sectionTitle || 'Section'} error:`,
        error,
        errorInfo
      )
    }

    // Call onError callback if provided
    this.props.onError?.(error, errorInfo)
  }

  componentDidUpdate(prevProps: DashboardErrorBoundaryProps): void {
    // Reset error state when resetKeys change
    if (this.state.hasError && this.props.resetKeys && prevProps.resetKeys) {
      const hasChanged = this.props.resetKeys.some(
        (key, index) => key !== prevProps.resetKeys?.[index]
      )
      if (hasChanged) {
        this.resetErrorBoundary()
      }
    }
  }

  resetErrorBoundary = (): void => {
    this.props.onReset?.()
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    const { hasError, error } = this.state
    const {
      children,
      sectionTitle,
      compact,
      fallback: FallbackComponent,
    } = this.props

    if (hasError && error) {
      if (FallbackComponent) {
        return (
          <FallbackComponent
            error={error}
            resetErrorBoundary={this.resetErrorBoundary}
            sectionTitle={sectionTitle}
            compact={compact}
          />
        )
      }

      return (
        <DashboardErrorFallback
          error={error}
          resetErrorBoundary={this.resetErrorBoundary}
          sectionTitle={sectionTitle}
          compact={compact}
        />
      )
    }

    return children
  }
}

// =============================================================================
// Higher-Order Component
// =============================================================================

/**
 * HOC to wrap any component with a dashboard error boundary.
 * Useful for wrapping individual dashboard sections.
 *
 * @example
 * const SafeKPICard = withDashboardErrorBoundary(KPICard, { compact: true })
 */
export function withDashboardErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  boundaryProps?: Omit<DashboardErrorBoundaryProps, 'children'>
) {
  const displayName =
    WrappedComponent.displayName || WrappedComponent.name || 'Component'

  const ComponentWithBoundary = (props: P) => (
    <DashboardErrorBoundary {...boundaryProps}>
      <WrappedComponent {...props} />
    </DashboardErrorBoundary>
  )

  ComponentWithBoundary.displayName = `withDashboardErrorBoundary(${displayName})`

  return ComponentWithBoundary
}
