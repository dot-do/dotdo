/**
 * Global Test Setup
 *
 * This file is included in all test workspaces via setupFiles.
 * It clears static state that accumulates across tests.
 */

import { beforeEach } from 'vitest'

// Cache the DOBase module reference after first successful import
let DOModule: { DO?: { _resetTestState?: () => void } } | null = null
let importAttempted = false

beforeEach(async () => {
  // Clear DOBase static state (circuit breakers, etc.)
  // Dynamic import to avoid issues when DOBase isn't available in all test contexts

  // Only attempt import once per test run
  if (!importAttempted) {
    importAttempted = true
    try {
      // Use a timeout to prevent hanging on slow imports
      const importPromise = import('../../objects/DOBase')
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000))
      const result = await Promise.race([importPromise, timeoutPromise])
      if (result) {
        DOModule = result
      }
    } catch {
      // DOBase may not be available in some test contexts (e.g., pure unit tests)
      // This is expected and can be safely ignored
      DOModule = null
    }
  }

  // Reset state if DOBase was successfully imported
  DOModule?.DO?._resetTestState?.()
})
