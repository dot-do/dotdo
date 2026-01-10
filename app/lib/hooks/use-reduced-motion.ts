/**
 * useReducedMotion Hook
 *
 * Detects if the user has requested reduced motion via their system preferences.
 * Used to disable animations for accessibility compliance.
 *
 * @example
 * ```tsx
 * const prefersReducedMotion = useReducedMotion()
 *
 * return (
 *   <AreaChart
 *     data={data}
 *     animate={!prefersReducedMotion}
 *   />
 * )
 * ```
 */

import { useState, useEffect } from 'react'

/**
 * Media query for prefers-reduced-motion
 */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Returns true if the user prefers reduced motion, false otherwise.
 * Safely handles SSR by defaulting to false on the server.
 */
export function useReducedMotion(): boolean {
  // Default to false for SSR
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    // Check if matchMedia is available (client-side)
    if (typeof window === 'undefined' || !window.matchMedia) {
      return
    }

    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY)

    // Set initial value
    setPrefersReducedMotion(mediaQuery.matches)

    // Listen for changes
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches)
    }

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
    // Legacy browsers (Safari < 14)
    else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleChange)
      return () => mediaQuery.removeListener(handleChange)
    }
  }, [])

  return prefersReducedMotion
}

/**
 * Returns the value to use for animation based on user preference.
 * If user prefers reduced motion, returns false. Otherwise returns the provided value.
 */
export function getAnimationValue(animate: boolean, prefersReducedMotion: boolean): boolean {
  return prefersReducedMotion ? false : animate
}
