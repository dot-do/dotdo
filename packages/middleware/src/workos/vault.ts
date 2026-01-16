/**
 * WorkOS Vault middleware
 *
 * TDD RED PHASE: Stub implementation that will fail tests.
 */

import type { MiddlewareHandler } from 'hono'

export interface WorkOSVaultConfig {
  apiKey?: string
  baseUrl?: string
}

// TDD RED: Stub - will fail tests
export function workosVault(_config?: WorkOSVaultConfig): MiddlewareHandler {
  throw new Error('workosVault not implemented')
}

export default workosVault
