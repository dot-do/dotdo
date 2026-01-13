/**
 * Root Vitest Configuration
 *
 * This file configures global vitest settings including coverage.
 * Individual workspaces are defined in vitest.workspace.ts.
 *
 * Coverage thresholds (enforced in CI):
 * - statements: 70%
 * - branches: 65%
 * - functions: 70%
 * - lines: 70%
 *
 * @see tests/config/vitest.shared.ts for coverage configuration details
 * @see vitest.workspace.ts for workspace definitions
 */

import { defineConfig } from 'vitest/config'
import { coverageConfig } from './tests/config/vitest.shared'

export default defineConfig({
  test: {
    // Coverage configuration from shared config
    // Thresholds are enforced when running with --coverage
    ...coverageConfig,
  },
})
