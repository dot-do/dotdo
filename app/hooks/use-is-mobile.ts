/**
 * useIsMobile Hook
 *
 * Detects if the current viewport is mobile-sized.
 * Uses window.matchMedia for efficient resize detection.
 *
 * @example
 * ```tsx
 * import { useIsMobile } from '~/hooks/use-is-mobile'
 *
 * function ResponsiveComponent() {
 *   const isMobile = useIsMobile()
 *
 *   return isMobile ? <MobileView /> : <DesktopView />
 * }
 * ```
 */

import { useState, useEffect } from 'react'

const DEFAULT_BREAKPOINT = 768 // md breakpoint

/**
 * Hook that returns whether the viewport is mobile-sized
 *
 * @param breakpoint - Width threshold for mobile detection (default: 768)
 * @returns true if viewport width is less than or equal to breakpoint
 */
export function useIsMobile(breakpoint: number = DEFAULT_BREAKPOINT): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    // Default to mobile-first for SSR
    if (typeof window === 'undefined') return true
    return window.innerWidth <= breakpoint
  })

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Initial check
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= breakpoint)
    }

    // Check immediately
    checkMobile()

    // Use matchMedia for efficient detection (if available)
    const supportsMatchMedia = typeof window.matchMedia === 'function'
    const mediaQuery = supportsMatchMedia
      ? window.matchMedia(`(max-width: ${breakpoint}px)`)
      : null

    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches)
    }

    // Modern browsers support addEventListener
    if (mediaQuery) {
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handleChange)
      } else {
        // Fallback for older browsers
        mediaQuery.addListener(handleChange as (e: MediaQueryListEvent) => void)
      }
    }

    // Also listen for resize as fallback
    window.addEventListener('resize', checkMobile)

    return () => {
      if (mediaQuery) {
        if (mediaQuery.removeEventListener) {
          mediaQuery.removeEventListener('change', handleChange)
        } else {
          mediaQuery.removeListener(handleChange as (e: MediaQueryListEvent) => void)
        }
      }
      window.removeEventListener('resize', checkMobile)
    }
  }, [breakpoint])

  return isMobile
}
