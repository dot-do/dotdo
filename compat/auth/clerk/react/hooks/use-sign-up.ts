/**
 * useSignUp hook
 *
 * Returns the SignUp resource for multi-step sign-up flows.
 *
 * @example
 * ```tsx
 * const { isLoaded, signUp, setActive } = useSignUp()
 *
 * // Start sign-up
 * const result = await signUp.create({
 *   emailAddress: 'user@example.com',
 *   password: 'password123',
 * })
 *
 * // Verify email
 * await signUp.prepareEmailAddressVerification()
 * await signUp.attemptEmailAddressVerification({ code: '123456' })
 *
 * if (signUp.status === 'complete') {
 *   await setActive({ session: signUp.createdSessionId })
 * }
 * ```
 */

import { useMemo, useCallback } from 'react'
import { useClerkContext } from '../context'
import type { UseSignUpReturn, SetActiveParams } from '../types'

/**
 * Hook to access sign-up functionality
 */
export function useSignUp(): UseSignUpReturn {
  const context = useClerkContext()

  const setActive = useCallback(async (params: SetActiveParams): Promise<void> => {
    return context.setActive(params)
  }, [context.setActive])

  return useMemo<UseSignUpReturn>(() => ({
    isLoaded: context.isLoaded,
    signUp: context.signUp,
    setActive,
  }), [context.isLoaded, context.signUp, setActive])
}
