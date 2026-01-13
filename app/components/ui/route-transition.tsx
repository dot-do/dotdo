/**
 * Route Transition Components
 *
 * Provides polished route transition experiences with:
 * - Progress bar for longer loads
 * - Fade transitions between routes
 * - Skeleton loading states
 *
 * @see https://tanstack.com/router/latest/docs/framework/react/guide/pending-component
 */

import * as React from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'

// =============================================================================
// Route Progress Bar
// =============================================================================

/**
 * A minimal progress bar that shows during route transitions.
 * Appears at the top of the viewport with smooth animation.
 */
export function RouteProgressBar() {
  const isLoading = useRouterState({ select: (s) => s.isLoading })
  const [progress, setProgress] = React.useState(0)
  const [visible, setVisible] = React.useState(false)

  React.useEffect(() => {
    if (isLoading) {
      setVisible(true)
      setProgress(0)

      // Animate progress in stages for perceived speed
      const t1 = setTimeout(() => setProgress(30), 100)
      const t2 = setTimeout(() => setProgress(60), 300)
      const t3 = setTimeout(() => setProgress(80), 600)

      return () => {
        clearTimeout(t1)
        clearTimeout(t2)
        clearTimeout(t3)
      }
    } else {
      // Complete and hide
      setProgress(100)
      const hideTimer = setTimeout(() => {
        setVisible(false)
        setProgress(0)
      }, 200)

      return () => clearTimeout(hideTimer)
    }
  }, [isLoading])

  if (!visible) return null

  return (
    <div
      data-testid="route-progress-bar"
      data-loading={isLoading ? 'true' : 'false'}
      className="fixed top-0 left-0 right-0 z-50 h-0.5 pointer-events-none"
      role="progressbar"
      aria-valuenow={progress}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Page loading"
    >
      <div
        className="h-full bg-primary transition-all duration-300 ease-out"
        style={{
          width: `${progress}%`,
          opacity: progress === 100 ? 0 : 1,
        }}
      />
    </div>
  )
}

// =============================================================================
// Route Pending Fallback
// =============================================================================

interface RoutePendingProps {
  /** Optional custom message */
  message?: string
  /** Whether to show the skeleton or just the progress bar */
  showSkeleton?: boolean
}

/**
 * Default pending component for route transitions.
 * Shows a minimal loading state that doesn't cause layout shift.
 */
export function RoutePending({ message, showSkeleton = false }: RoutePendingProps) {
  return (
    <div
      data-testid="route-pending"
      className="min-h-[200px] flex items-center justify-center"
    >
      {showSkeleton ? (
        <div className="w-full animate-pulse space-y-4 p-6">
          <div className="h-8 bg-muted rounded w-1/3" />
          <div className="h-4 bg-muted rounded w-2/3" />
          <div className="h-4 bg-muted rounded w-1/2" />
          <div className="h-32 bg-muted rounded mt-6" />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"
            aria-hidden="true"
          />
          {message && (
            <p className="text-sm text-muted-foreground">{message}</p>
          )}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Fade Transition Wrapper
// =============================================================================

interface FadeTransitionProps {
  children: React.ReactNode
  /** Unique key for the transition (usually pathname) */
  transitionKey?: string
  /** Duration in ms */
  duration?: number
}

/**
 * Wraps content in a fade transition effect.
 * Uses CSS transitions for smooth appearance.
 */
export function FadeTransition({
  children,
  transitionKey,
  duration = 150,
}: FadeTransitionProps) {
  const [isVisible, setIsVisible] = React.useState(true)
  const prevKeyRef = React.useRef(transitionKey)

  React.useEffect(() => {
    if (transitionKey !== prevKeyRef.current) {
      // Key changed, trigger fade out then in
      setIsVisible(false)
      const timer = setTimeout(() => {
        prevKeyRef.current = transitionKey
        setIsVisible(true)
      }, duration / 2)

      return () => clearTimeout(timer)
    }
  }, [transitionKey, duration])

  return (
    <div
      data-testid="fade-transition"
      className="transition-opacity"
      style={{
        opacity: isVisible ? 1 : 0,
        transitionDuration: `${duration / 2}ms`,
      }}
    >
      {children}
    </div>
  )
}

// =============================================================================
// Route Error Fallback
// =============================================================================

interface RouteErrorProps {
  error: Error
  reset?: () => void
}

/**
 * Default error component for route-level errors.
 * Provides a retry mechanism and error details.
 */
export function RouteError({ error, reset }: RouteErrorProps) {
  const router = useRouter()

  const handleRetry = () => {
    if (reset) {
      reset()
    } else {
      router.invalidate()
    }
  }

  return (
    <div
      data-testid="route-error"
      role="alert"
      className="min-h-[200px] flex items-center justify-center p-6"
    >
      <div className="text-center max-w-md">
        <div className="text-4xl mb-4" aria-hidden="true">
          &#9888;
        </div>
        <h2 className="text-xl font-semibold text-destructive mb-2">
          Something went wrong
        </h2>
        <p className="text-muted-foreground mb-6">
          {error.message || 'An unexpected error occurred while loading this page.'}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            type="button"
            onClick={handleRetry}
            data-testid="route-error-retry"
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Try Again
          </button>
          <button
            type="button"
            onClick={() => router.navigate({ to: '/' })}
            data-testid="route-error-home"
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Not Found Component
// =============================================================================

interface NotFoundProps {
  /** Custom message */
  message?: string
}

/**
 * Default not found component for unknown routes.
 */
export function RouteNotFound({ message }: NotFoundProps) {
  const router = useRouter()

  return (
    <div
      data-testid="route-not-found"
      className="min-h-[400px] flex items-center justify-center p-6"
    >
      <div className="text-center max-w-md">
        <div className="text-6xl font-bold text-muted-foreground mb-4">404</div>
        <h1 className="text-2xl font-semibold mb-2">Page Not Found</h1>
        <p className="text-muted-foreground mb-6">
          {message || "The page you're looking for doesn't exist or has been moved."}
        </p>
        <button
          type="button"
          onClick={() => router.navigate({ to: '/' })}
          data-testid="not-found-home"
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          Go Home
        </button>
      </div>
    </div>
  )
}

// =============================================================================
// Prefetch Link Wrapper
// =============================================================================

interface PrefetchLinkProps {
  children: React.ReactNode
  to: string
  /** Whether to prefetch on render (viewport) */
  prefetchOnRender?: boolean
}

/**
 * Wrapper component that prefetches a route on mount.
 * Useful for critical navigation paths.
 */
export function PrefetchLink({ children, to, prefetchOnRender = false }: PrefetchLinkProps) {
  const router = useRouter()

  React.useEffect(() => {
    if (prefetchOnRender) {
      router.preloadRoute({ to })
    }
  }, [router, to, prefetchOnRender])

  return <>{children}</>
}
