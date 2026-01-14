/**
 * useOrganization hook
 *
 * Returns the current organization and membership.
 *
 * @example
 * ```tsx
 * const { isLoaded, organization, membership } = useOrganization()
 *
 * if (!isLoaded) return <div>Loading...</div>
 *
 * return (
 *   <div>
 *     <h1>{organization?.name}</h1>
 *     <p>Role: {membership?.role}</p>
 *   </div>
 * )
 * ```
 */

import { useMemo } from 'react'
import { useClerkContext } from '../context'
import type { UseOrganizationReturn } from '../types'

/**
 * Hook to access the current organization
 */
export function useOrganization(): UseOrganizationReturn {
  const context = useClerkContext()

  return useMemo<UseOrganizationReturn>(() => ({
    isLoaded: context.isLoaded,
    organization: context.organization,
    membership: null, // Would come from organization membership
    invitations: [],
    memberships: [],
  }), [context.isLoaded, context.organization])
}
