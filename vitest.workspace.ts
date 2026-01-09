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
      setupFiles: ['./api/tests/middleware/setup.ts'],
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
  // Durable Objects tests
  {
    test: {
      name: 'objects',
      include: ['objects/tests/**/*.test.ts'],
      environment: 'node',
    },
  },
  // Library tests (sqids, utilities)
  {
    test: {
      name: 'lib',
      include: ['lib/tests/**/*.test.ts'],
      environment: 'node',
    },
  },
  // Snippets tests (events normalizer, etc.)
  {
    test: {
      name: 'snippets',
      include: ['snippets/tests/**/*.test.ts'],
      environment: 'node',
    },
  },
  // Workflow tests for $ proxy, domain, hash, flag, etc.
  {
    test: {
      name: 'workflows',
      include: ['workflows/**/*.test.ts'],
      environment: 'node',
    },
  },
  // Types tests for type definitions
  {
    test: {
      name: 'types',
      include: ['types/tests/**/*.test.ts'],
      environment: 'node',
    },
  },
  // Evals tests for evalite storage adapter
  {
    test: {
      name: 'evals',
      include: ['evals/tests/**/*.test.ts'],
      environment: 'node',
    },
  },
])
