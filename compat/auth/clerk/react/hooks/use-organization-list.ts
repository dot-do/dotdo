/**
 * useOrganizationList hook
 *
 * Returns the user's organization memberships and methods.
 *
 * @example
 * ```tsx
 * const { isLoaded, userMemberships, createOrganization, setActive } = useOrganizationList()
 *
 * // Create a new organization
 * const org = await createOrganization({ name: 'My Org' })
 *
 * // Switch to the new organization
 * await setActive({ organization: org })
 * ```
 */

import { useMemo, useCallback, useState } from 'react'
import { useClerkContext } from '../context'
import type {
  UseOrganizationListReturn,
  SetActiveParams,
  CreateOrganizationParams,
  OrganizationResource,
  OrganizationMembershipResource,
  OrganizationInvitationResource,
  OrganizationSuggestionResource,
  PaginatedResources,
} from '../types'

/**
 * Create an empty paginated resource
 */
function createEmptyPaginatedResource<T>(): PaginatedResources<T> {
  return {
    data: [],
    count: 0,
    isLoading: false,
    isFetching: false,
    isError: false,
    page: 1,
    pageCount: 0,
    fetchPage: () => {},
    fetchPrevious: () => {},
    fetchNext: () => {},
    hasNextPage: false,
    hasPreviousPage: false,
    revalidate: () => {},
    setSize: () => {},
  }
}

/**
 * Hook to access organization list functionality
 */
export function useOrganizationList(): UseOrganizationListReturn {
  const context = useClerkContext()
  const [userMemberships] = useState<PaginatedResources<OrganizationMembershipResource>>(
    createEmptyPaginatedResource()
  )
  const [userInvitations] = useState<PaginatedResources<OrganizationInvitationResource>>(
    createEmptyPaginatedResource()
  )
  const [userSuggestions] = useState<PaginatedResources<OrganizationSuggestionResource>>(
    createEmptyPaginatedResource()
  )

  const createOrganization = useCallback(async (params: CreateOrganizationParams): Promise<OrganizationResource> => {
    // In a real implementation, this would call the Clerk API
    throw new Error('Not implemented: createOrganization')
  }, [])

  const setActive = useCallback(async (params: SetActiveParams): Promise<void> => {
    return context.setActive(params)
  }, [context.setActive])

  return useMemo<UseOrganizationListReturn>(() => ({
    isLoaded: context.isLoaded,
    createOrganization,
    setActive,
    userMemberships,
    userInvitations,
    userSuggestions,
  }), [context.isLoaded, createOrganization, setActive, userMemberships, userInvitations, userSuggestions])
}
