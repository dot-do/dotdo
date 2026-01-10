/**
 * Dotdo React Context
 *
 * Provides client instance and connection management to child components.
 */

import * as React from 'react'
import type { DotdoContextValue } from './types'

/**
 * React context for dotdo client
 */
export const DotdoContext = React.createContext<DotdoContextValue | null>(null)

/**
 * Hook to access the dotdo context
 * @throws Error if used outside of DotdoProvider
 */
export function useDotdoContext(): DotdoContextValue {
  const context = React.useContext(DotdoContext)
  if (!context) {
    throw new Error('useDotdoContext must be used within a DotdoProvider')
  }
  return context
}
