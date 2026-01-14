/**
 * useUser hook
 *
 * Returns the current user object.
 *
 * @example
 * ```tsx
 * const { isLoaded, isSignedIn, user } = useUser()
 *
 * if (!isLoaded) return <div>Loading...</div>
 * if (!isSignedIn) return <SignIn />
 *
 * return <div>Hello, {user.firstName}!</div>
 * ```
 */

import { useMemo } from 'react'
import { useClerkContext } from '../context'
import type { UseUserReturn } from '../types'

/**
 * Hook to access the current user
 */
export function useUser(): UseUserReturn {
  const context = useClerkContext()

  return useMemo<UseUserReturn>(() => ({
    isLoaded: context.isLoaded,
    isSignedIn: context.isSignedIn,
    user: context.user,
  }), [context.isLoaded, context.isSignedIn, context.user])
}
