/**
 * Global Test Setup
 *
 * This file is included in all test workspaces via setupFiles.
 * It clears static state that accumulates across tests.
 */

import { beforeEach } from 'vitest'

beforeEach(async () => {
  // Clear DOBase static state (circuit breakers, etc.)
  // Dynamic import to avoid issues when DOBase isn't available in all test contexts
  try {
    const { DO } = await import('../../objects/DOBase')
    DO._resetTestState?.()
  } catch {
    // DOBase may not be available in some test contexts (e.g., pure unit tests)
    // This is expected and can be safely ignored
  }
})
