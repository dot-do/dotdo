/**
 * Vitest Configuration (Default)
 *
 * This is the standalone config used when running `vitest` without workspace mode.
 * For the full multi-environment test setup, use `vitest --workspace`.
 *
 * The workspace configuration (vitest.workspace.ts) provides:
 * - Node tests for file system / config verification
 * - Schema tests for database/auth
 * - Workers tests for runtime integration
 * - App tests for TanStack Start / Fumadocs build
 *
 * @see vitest.workspace.ts for the complete test setup
 * @see vitest.shared.ts for shared configuration
 */

import { defineConfig } from 'vitest/config'
import {
  sharedTestConfig,
  nodeResolveConfig,
  coverageConfig,
  defaultExcludes,
} from './vitest.shared'

export default defineConfig({
  test: {
    ...sharedTestConfig,
    ...coverageConfig,

    // Default environment for standalone runs
    environment: 'node',

    // Include all non-workers tests
    include: [
      'api/tests/setup.test.ts',
      'api/tests/static-assets.test.ts',
      'api/tests/entry-points.test.ts',
      'db/tests/**/*.test.ts',
      'db/iceberg/**/*.test.ts',
      'app/tests/**/*.test.ts',
      'objects/tests/**/*.test.ts',
      'lib/tests/**/*.test.ts',
      'snippets/tests/**/*.test.ts',
      'types/tests/**/*.test.ts',
      'evals/tests/**/*.test.ts',
      'workflows/**/*.test.ts',
      'tests/utils/**/*.test.ts',
      'tests/mocks/**/*.test.ts',
      'tests/flags/**/*.test.ts',
      'tests/rate-limit/**/*.test.ts',
    ],

    // Exclude workers tests - they require the workers pool
    exclude: [
      ...defaultExcludes,
      'api/tests/infrastructure/**/*.test.ts',
      'api/tests/routes/**/*.test.ts',
      'api/tests/middleware/**/*.test.ts',
    ],
  },

  resolve: nodeResolveConfig,
})
