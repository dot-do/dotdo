/**
 * useClerk hook
 *
 * Returns the Clerk client object with all methods.
 *
 * @example
 * ```tsx
 * const clerk = useClerk()
 *
 * clerk.openSignIn()
 * clerk.signOut()
 * ```
 */

import { useClerkContext } from '../context'
import type { ClerkClient } from '../types'

/**
 * Hook to access the Clerk client object
 */
export function useClerk(): ClerkClient {
  const context = useClerkContext()

  if (!context.clerk) {
    throw new Error('Clerk is not loaded yet')
  }

  return context.clerk
}
