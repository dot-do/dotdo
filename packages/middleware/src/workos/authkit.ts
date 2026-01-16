/**
 * WorkOS AuthKit middleware
 *
 * TDD RED PHASE: Stub implementation that will fail tests.
 */

import type { MiddlewareHandler } from 'hono'

export interface WorkOSAuthKitConfig {
  apiKey?: string
  clientId?: string
  baseUrl?: string
  redirectUri?: string
  allowedRedirectUris?: string[]
  session?: {
    maxAge?: number
    refreshEnabled?: boolean
  }
  magicLink?: {
    enabled?: boolean
    defaultExpiresIn?: number
  }
  directorySync?: {
    enabled?: boolean
    handleDeletions?: boolean
    mapToTeams?: boolean
  }
  adminPortal?: {
    enabled?: boolean
  }
}

// TDD RED: Stub - will fail tests
export function workosAuthKit(_config?: WorkOSAuthKitConfig): MiddlewareHandler {
  throw new Error('workosAuthKit not implemented')
}

export default workosAuthKit
