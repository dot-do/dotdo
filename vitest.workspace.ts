import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  // Node tests for file system / config verification
  {
    test: {
      name: 'node',
      include: ['api/tests/setup.test.ts', 'api/tests/static-assets.test.ts'],
      environment: 'node',
    },
  },
  // Schema tests for database/auth
  {
    test: {
      name: 'schema',
      include: ['db/tests/**/*.test.ts'],
      environment: 'node',
    },
  },
  // Iceberg tests for direct table navigation
  {
    test: {
      name: 'iceberg',
      include: ['db/iceberg/**/*.test.ts'],
      environment: 'node',
    },
  },
  // Workers tests for runtime integration
  {
    extends: './vitest.workers.config.ts',
    test: {
      name: 'workers',
      include: ['api/tests/infrastructure/**/*.test.ts', 'api/tests/routes/**/*.test.ts', 'api/tests/middleware/**/*.test.ts'],
    },
  },
  // App tests for TanStack Start / Fumadocs build
  {
    test: {
      name: 'app',
      include: ['app/tests/**/*.test.ts'],
      environment: 'node',
    },
  },
])
