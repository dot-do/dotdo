/**
 * Admin Provider
 *
 * React context provider for the admin data layer.
 * Manages the data provider and resource configurations.
 *
 * @module @dotdo/react/admin
 */

import * as React from 'react'
import type { DataProvider, ResourceConfig, BaseRecord } from './types'

// =============================================================================
// Context Types
// =============================================================================

/**
 * Value provided by AdminProvider context
 */
export interface AdminContextValue {
  /** The data provider instance */
  dataProvider: DataProvider
  /** Registered resource configurations */
  resources: Map<string, ResourceConfig>
  /** Register a resource configuration */
  registerResource: <T extends BaseRecord>(config: ResourceConfig<T>) => void
  /** Unregister a resource */
  unregisterResource: (name: string) => void
  /** Get resource configuration by name */
  getResource: (name: string) => ResourceConfig | undefined
  /** Invalidate cache for a resource */
  invalidateResource: (name: string) => void
  /** Global loading state across all resources */
  isLoading: boolean
}

/**
 * Props for AdminProvider component
 */
export interface AdminProviderProps {
  /** The data provider to use for all operations */
  dataProvider: DataProvider
  /** Child components */
  children: React.ReactNode
  /** Initial resource configurations */
  resources?: ResourceConfig[]
}

// =============================================================================
// Context
// =============================================================================

const AdminContext = React.createContext<AdminContextValue | null>(null)
AdminContext.displayName = 'AdminContext'

// =============================================================================
// Provider Component
// =============================================================================

/**
 * Admin context provider.
 *
 * Wraps your admin application to provide data access to all child components.
 *
 * @example
 * ```tsx
 * import { AdminProvider, DotdoDataProvider } from '@dotdo/react/admin'
 *
 * function App() {
 *   const dataProvider = DotdoDataProvider({
 *     ns: 'https://api.example.com/do/workspace'
 *   })
 *
 *   return (
 *     <AdminProvider dataProvider={dataProvider}>
 *       <AdminRoutes />
 *     </AdminProvider>
 *   )
 * }
 * ```
 */
export function AdminProvider({
  dataProvider,
  children,
  resources: initialResources = [],
}: AdminProviderProps): React.ReactElement {
  // Resource registry
  const [resources, setResources] = React.useState<Map<string, ResourceConfig>>(
    () => {
      const map = new Map<string, ResourceConfig>()
      for (const config of initialResources) {
        map.set(config.name, config)
      }
      return map
    }
  )

  // Track global loading state
  const [loadingCount, setLoadingCount] = React.useState(0)

  // Cache invalidation version (increments to trigger refetches)
  const [cacheVersions, setCacheVersions] = React.useState<
    Map<string, number>
  >(new Map())

  // Register a resource configuration
  const registerResource = React.useCallback(
    <T extends BaseRecord>(config: ResourceConfig<T>) => {
      setResources((prev) => {
        const next = new Map(prev)
        next.set(config.name, config as unknown as ResourceConfig)
        return next
      })
    },
    []
  )

  // Unregister a resource
  const unregisterResource = React.useCallback((name: string) => {
    setResources((prev) => {
      const next = new Map(prev)
      next.delete(name)
      return next
    })
  }, [])

  // Get resource configuration
  const getResource = React.useCallback(
    (name: string): ResourceConfig | undefined => {
      return resources.get(name)
    },
    [resources]
  )

  // Invalidate cache for a resource
  const invalidateResource = React.useCallback((name: string) => {
    setCacheVersions((prev) => {
      const next = new Map(prev)
      next.set(name, (prev.get(name) || 0) + 1)
      return next
    })
  }, [])

  // Memoize context value
  const value = React.useMemo<AdminContextValue>(
    () => ({
      dataProvider,
      resources,
      registerResource,
      unregisterResource,
      getResource,
      invalidateResource,
      isLoading: loadingCount > 0,
    }),
    [
      dataProvider,
      resources,
      registerResource,
      unregisterResource,
      getResource,
      invalidateResource,
      loadingCount,
    ]
  )

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to access the admin context.
 *
 * Must be used within an AdminProvider.
 *
 * @returns The admin context value
 * @throws Error if used outside of AdminProvider
 */
export function useAdminContext(): AdminContextValue {
  const context = React.useContext(AdminContext)
  if (!context) {
    throw new Error('useAdminContext must be used within an AdminProvider')
  }
  return context
}

/**
 * Hook to check if we're inside an AdminProvider
 */
export function useIsAdminContext(): boolean {
  return React.useContext(AdminContext) !== null
}
