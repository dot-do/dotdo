/**
 * usePrefetch Hook
 *
 * Provides handlers for route prefetching on hover/focus intent.
 * Uses TanStack Router's preload functionality.
 *
 * @example
 * ```tsx
 * import { usePrefetch } from '~/hooks/use-prefetch'
 *
 * function NavLink({ to, children }) {
 *   const prefetchHandlers = usePrefetch(to)
 *   return (
 *     <Link to={to} {...prefetchHandlers}>
 *       {children}
 *     </Link>
 *   )
 * }
 * ```
 */

import { useCallback, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { prefetchConfig } from '~/config/nav'

export interface PrefetchHandlers {
  onMouseEnter: () => void
  onMouseLeave: () => void
  onFocus: () => void
  onBlur: () => void
}

/**
 * Hook that returns event handlers for prefetching routes on hover/focus
 *
 * @param to - The route path to prefetch
 * @returns Object with onMouseEnter, onMouseLeave, onFocus, onBlur handlers
 */
export function usePrefetch(to: string): PrefetchHandlers {
  const router = useRouter()
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startPrefetch = useCallback(() => {
    if (!prefetchConfig.intent) return

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // Delay prefetch to avoid unnecessary loads on quick mouse movements
    timeoutRef.current = setTimeout(() => {
      try {
        // Use TanStack Router's preload method
        router.preloadRoute({ to })
      } catch {
        // Ignore errors - route might not exist or be preloadable
      }
    }, prefetchConfig.hoverDelay)
  }, [router, to])

  const cancelPrefetch = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const onMouseEnter = useCallback(() => {
    startPrefetch()
  }, [startPrefetch])

  const onMouseLeave = useCallback(() => {
    cancelPrefetch()
  }, [cancelPrefetch])

  const onFocus = useCallback(() => {
    if (prefetchConfig.focus) {
      startPrefetch()
    }
  }, [startPrefetch])

  const onBlur = useCallback(() => {
    cancelPrefetch()
  }, [cancelPrefetch])

  return {
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onBlur,
  }
}
