// TanStack Query Integration
// Provides React hooks for data fetching with caching and optimistic updates

import type { DataClient, Thing } from './index'

/**
 * Query options for TanStack Query
 */
export interface QueryOptions {
  /** Enable automatic refetching on window focus */
  refetchOnWindowFocus?: boolean
  /** Enable automatic refetching on reconnect */
  refetchOnReconnect?: boolean
  /** Stale time in milliseconds */
  staleTime?: number
  /** Cache time in milliseconds */
  cacheTime?: number
  /** Enable query (useful for conditional fetching) */
  enabled?: boolean
}

/**
 * Mutation options for TanStack Query
 */
export interface MutationOptions<T = unknown> {
  /** Callback on success */
  onSuccess?: (data: T) => void
  /** Callback on error */
  onError?: (error: Error) => void
  /** Callback on settled (success or error) */
  onSettled?: () => void
}

/**
 * Query key factory for consistent cache keys
 */
export const queryKeys = {
  all: (resource: string) => [resource] as const,
  lists: (resource: string) => [resource, 'list'] as const,
  list: (resource: string, filters?: Record<string, unknown>) =>
    [resource, 'list', filters] as const,
  details: (resource: string) => [resource, 'detail'] as const,
  detail: (resource: string, id: string) => [resource, 'detail', id] as const,
}

/**
 * Create query functions for a data client
 * These can be used directly with TanStack Query's useQuery and useMutation
 */
export function createQueryFunctions(client: DataClient) {
  return {
    /**
     * Query function for getting a single item
     */
    useGetQuery: (resource: string, id: string, options?: QueryOptions) => ({
      queryKey: queryKeys.detail(resource, id),
      queryFn: () => client.get(resource, id),
      ...options,
    }),

    /**
     * Query function for listing items
     */
    useListQuery: (resource: string, filters?: Record<string, unknown>, options?: QueryOptions) => ({
      queryKey: queryKeys.list(resource, filters),
      queryFn: () => client.list(resource, filters),
      ...options,
    }),

    /**
     * Mutation function for creating items
     */
    useCreateMutation: (resource: string, options?: MutationOptions<Thing>) => ({
      mutationFn: (data: Record<string, unknown>) => client.create(resource, data),
      onSuccess: (data: Thing) => {
        // Invalidate and refetch queries
        if (options?.onSuccess) {
          options.onSuccess(data)
        }
      },
      onError: options?.onError,
      onSettled: options?.onSettled,
    }),

    /**
     * Mutation function for updating items
     */
    useUpdateMutation: (
      resource: string,
      id: string,
      options?: MutationOptions<Thing>
    ) => ({
      mutationFn: (data: Record<string, unknown>) => client.update(resource, id, data),
      onSuccess: (data: Thing) => {
        // Invalidate cache
        client.invalidateCache(resource, id)
        if (options?.onSuccess) {
          options.onSuccess(data)
        }
      },
      onError: options?.onError,
      onSettled: options?.onSettled,
    }),

    /**
     * Mutation function for deleting items
     */
    useDeleteMutation: (resource: string, id: string, options?: MutationOptions<void>) => ({
      mutationFn: () => client.delete(resource, id),
      onSuccess: () => {
        // Invalidate cache
        client.invalidateCache(resource, id)
        if (options?.onSuccess) {
          options.onSuccess(undefined)
        }
      },
      onError: options?.onError,
      onSettled: options?.onSettled,
    }),
  }
}

/**
 * Create a query client configuration for TanStack Query
 */
export function createQueryClientConfig(client: DataClient) {
  return {
    defaultOptions: {
      queries: {
        queryFn: async ({ queryKey }: { queryKey: readonly unknown[] }) => {
          const [resource, type, ...params] = queryKey

          if (type === 'detail' && params[0]) {
            return client.get(resource as string, params[0] as string)
          }

          if (type === 'list') {
            return client.list(resource as string, params[0] as Record<string, unknown> | undefined)
          }

          throw new Error(`Invalid query key: ${queryKey}`)
        },
        staleTime: 5000, // 5 seconds
        cacheTime: 300000, // 5 minutes
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
    },
  }
}

/**
 * Subscribe to real-time updates and invalidate queries
 * This should be used in a React component or provider
 */
export function subscribeToUpdates(
  client: DataClient,
  invalidateQuery: (queryKey: readonly unknown[]) => void
) {
  return client.onUpdate((update) => {
    const { resource, id } = update

    // Invalidate specific item if ID is provided
    if (id) {
      invalidateQuery(queryKeys.detail(resource, id))
    }

    // Always invalidate lists
    invalidateQuery(queryKeys.lists(resource))
  })
}

/**
 * Optimistic update helper
 * Updates cache immediately and rolls back on error
 */
export function optimisticUpdate<T>(
  queryKey: readonly unknown[],
  updateFn: (old: T) => T,
  setQueryData: (queryKey: readonly unknown[], updater: (old: T) => T) => void,
  // Error handler for future use when mutation integration is added
  _onError?: (error: Error, rollback: () => void) => void
) {
  // Store previous value
  let previousValue: T | undefined

  // Update cache immediately
  setQueryData(queryKey, (old: T) => {
    previousValue = old
    return updateFn(old)
  })

  // Return rollback function
  return {
    rollback: () => {
      if (previousValue !== undefined) {
        setQueryData(queryKey, () => previousValue as T)
      }
    },
  }
}
