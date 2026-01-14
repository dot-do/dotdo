/**
 * useAuth hook
 *
 * Returns authentication state and methods.
 *
 * @example
 * ```tsx
 * const { isLoaded, isSignedIn, userId, getToken, signOut } = useAuth()
 *
 * if (!isLoaded) return <div>Loading...</div>
 * if (!isSignedIn) return <SignIn />
 *
 * const token = await getToken()
 * ```
 */

import { useCallback, useMemo } from 'react'
import { useClerkContext } from '../context'
import type { UseAuthReturn, GetTokenOptions, SignOutOptions, HasParams } from '../types'

/**
 * Hook to access authentication state and methods
 */
export function useAuth(): UseAuthReturn {
  const context = useClerkContext()

  const has = useCallback((params: HasParams): boolean => {
    if (!context.isSignedIn) return false

    // Check organization role
    if (params.role && context.orgRole !== params.role) {
      return false
    }

    // Check permission (would need membership data)
    if (params.permission) {
      // In a real implementation, check against org permissions
      return false
    }

    return true
  }, [context.isSignedIn, context.orgRole])

  const getToken = useCallback(async (options?: GetTokenOptions): Promise<string | null> => {
    return context.getToken(options)
  }, [context.getToken])

  const signOut = useCallback(async (options?: SignOutOptions): Promise<void> => {
    return context.signOut(options)
  }, [context.signOut])

  return useMemo<UseAuthReturn>(() => ({
    isLoaded: context.isLoaded,
    isSignedIn: context.isSignedIn,
    userId: context.userId,
    sessionId: context.sessionId,
    orgId: context.orgId,
    orgSlug: context.orgSlug,
    orgRole: context.orgRole,
    orgPermissions: null, // Would come from membership
    getToken,
    has,
    signOut,
  }), [
    context.isLoaded, context.isSignedIn, context.userId,
    context.sessionId, context.orgId, context.orgSlug,
    context.orgRole, getToken, has, signOut,
  ])
}
