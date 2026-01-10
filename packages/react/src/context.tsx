/**
 * Dotdo React Context
 *
 * Provides client instance and connection management to child components.
 * This is the internal context used by all hooks.
 *
 * @module @dotdo/react
 */

import * as React from 'react'
import type { DotdoContextValue } from './types'

/**
 * React context for dotdo client.
 *
 * Use the DO provider to set this context, and useDotdoContext to read it.
 */
export const DotdoContext = React.createContext<DotdoContextValue | null>(null)

/**
 * Hook to access the dotdo context.
 *
 * Provides access to the client, namespace, and connection management.
 * Usually you don't need this directly - use the specific hooks instead.
 *
 * @returns The context value with client and connection info
 * @throws Error if used outside of DO provider
 */
export function useDotdoContext(): DotdoContextValue {
  const context = React.useContext(DotdoContext)
  if (!context) {
    throw new Error('useDotdoContext must be used within a DO provider')
  }
  return context
}
