/**
 * useSession hook
 *
 * Returns the current session object.
 *
 * @example
 * ```tsx
 * const { isLoaded, isSignedIn, session } = useSession()
 *
 * if (session) {
 *   const token = await session.getToken()
 * }
 * ```
 */

import { useMemo } from 'react'
import { useClerkContext } from '../context'
import type { UseSessionReturn } from '../types'

/**
 * Hook to access the current session
 */
export function useSession(): UseSessionReturn {
  const context = useClerkContext()

  return useMemo<UseSessionReturn>(() => ({
    isLoaded: context.isLoaded,
    isSignedIn: context.isSignedIn,
    session: context.session,
  }), [context.isLoaded, context.isSignedIn, context.session])
}
