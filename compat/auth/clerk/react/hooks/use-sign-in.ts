/**
 * useSignIn hook
 *
 * Returns the SignIn resource for multi-step sign-in flows.
 *
 * @example
 * ```tsx
 * const { isLoaded, signIn, setActive } = useSignIn()
 *
 * // Start sign-in with email
 * const result = await signIn.create({
 *   identifier: 'user@example.com',
 *   password: 'password123',
 * })
 *
 * if (result.status === 'complete') {
 *   await setActive({ session: result.createdSessionId })
 * }
 * ```
 */

import { useMemo, useCallback } from 'react'
import { useClerkContext } from '../context'
import type { UseSignInReturn, SetActiveParams } from '../types'

/**
 * Hook to access sign-in functionality
 */
export function useSignIn(): UseSignInReturn {
  const context = useClerkContext()

  const setActive = useCallback(async (params: SetActiveParams): Promise<void> => {
    return context.setActive(params)
  }, [context.setActive])

  return useMemo<UseSignInReturn>(() => ({
    isLoaded: context.isLoaded,
    signIn: context.signIn,
    setActive,
  }), [context.isLoaded, context.signIn, setActive])
}
