/**
 * SyncContext and useSyncContext hook
 */

import { createContext, useContext } from 'react'
import type { SyncContextValue } from './types'

/**
 * React Context for sync state
 * Initialized to null - will throw if used outside SyncProvider
 */
export const SyncContext = createContext<SyncContextValue | null>(null)

SyncContext.displayName = 'SyncContext'

/**
 * Hook to access the sync context
 * Must be used within a SyncProvider
 *
 * @throws Error if used outside of SyncProvider
 * @returns SyncContextValue with connection state and utilities
 */
export function useSyncContext(): SyncContextValue {
  const context = useContext(SyncContext)

  if (context === null) {
    throw new Error(
      'useSyncContext must be used within a SyncProvider. ' +
        'Wrap your component tree with <SyncProvider doUrl="...">...</SyncProvider>'
    )
  }

  return context
}
