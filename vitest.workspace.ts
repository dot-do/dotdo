/**
 * Vitest Workspace Configuration
 *
 * Organizes tests into separate workspaces by environment and purpose:
 *
 * Node Environment:
 * - node: File system / config verification tests
 * - schema: Database schema tests
 * - iceberg: Direct table navigation tests
 * - objects: Durable Objects tests (mocked runtime)
 * - lib: Library utility tests
 * - snippets: Event normalizer tests
 * - workflows: Workflow proxy tests
 * - types: Type definition tests
 * - evals: Evaluation storage tests
 * - app: TanStack Start / Fumadocs build tests
 * - utils: Utility tests (hash, etc.)
 * - mocks: Test mocks infrastructure
 * - flags: Feature flags tests
 * - rate-limit: Rate limit binding tests
 *
 * Workers Environment:
 * - workers: Runtime integration tests (uses @cloudflare/vitest-pool-workers)
 *
 * Run specific workspace: npx vitest --project=workers
 * Run all workspaces: npx vitest --workspace
 *
 * @see vitest.shared.ts for shared configuration
 * @see vitest.workers.config.ts for Workers pool configuration
 */

import { defineWorkspace } from 'vitest/config'
import {
  sharedTestConfig,
  nodeResolveConfig,
  defaultExcludes,
} from './vitest.shared'

/**
 * Creates a Node.js test workspace configuration
 * Reduces boilerplate for node-based test workspaces
 */
function createNodeWorkspace(
  name: string,
  include: string[],
  options: { setupFiles?: string[] } = {}
) {
  return {
    test: {
      ...sharedTestConfig,
      name,
      include,
      exclude: defaultExcludes,
      environment: 'node' as const,
      ...(options.setupFiles && { setupFiles: options.setupFiles }),
    },
    resolve: nodeResolveConfig,
  }
}

export default defineWorkspace([
  // ============================================
  // Node Environment Tests
  // ============================================

  // File system / config verification tests
  createNodeWorkspace('node', [
    'api/tests/setup.test.ts',
    'api/tests/static-assets.test.ts',
    'api/tests/entry-points.test.ts',
  ]),

  // Database schema tests
  createNodeWorkspace('schema', ['db/tests/**/*.test.ts']),

  // Iceberg table navigation tests
  createNodeWorkspace('iceberg', ['db/iceberg/**/*.test.ts']),

  // Durable Objects tests (mocked runtime)
  createNodeWorkspace('objects', ['objects/tests/**/*.test.ts']),

  // Library utility tests (sqids, etc.)
  createNodeWorkspace('lib', ['lib/tests/**/*.test.ts']),

  // Event normalizer tests
  createNodeWorkspace('snippets', ['snippets/tests/**/*.test.ts']),

  // Workflow proxy tests ($ proxy, domain, hash, flag)
  createNodeWorkspace('workflows', ['workflows/**/*.test.ts']),

  // Type definition tests
  createNodeWorkspace('types', ['types/tests/**/*.test.ts']),

  // Evaluation storage tests
  createNodeWorkspace('evals', ['evals/tests/**/*.test.ts']),

  // AI Database tests
  createNodeWorkspace('ai-database', ['ai-database/tests/**/*.test.ts']),

  // TanStack Start / Fumadocs build tests
  createNodeWorkspace('app', ['app/tests/**/*.test.ts']),

  // Utility tests (hash, etc.)
  createNodeWorkspace('utils', ['tests/utils/**/*.test.ts']),

  // Test mocks infrastructure
  createNodeWorkspace('mocks', ['tests/mocks/**/*.test.ts']),

  // Feature flags tests
  createNodeWorkspace('flags', ['tests/flags/**/*.test.ts']),

  // Rate limit binding tests
  createNodeWorkspace('rate-limit', ['tests/rate-limit/**/*.test.ts']),

  // CLI tests (device auth, config management)
  createNodeWorkspace('cli', ['cli/tests/**/*.test.ts']),

  // ============================================
  // Workers Environment Tests
  // ============================================

  // Runtime integration tests using Cloudflare Workers pool
  {
    extends: './vitest.workers.config.ts',
    test: {
      ...sharedTestConfig,
      name: 'workers',
      include: [
        'api/tests/infrastructure/**/*.test.ts',
        'api/tests/routes/**/*.test.ts',
        'api/tests/middleware/**/*.test.ts',
      ],
      exclude: defaultExcludes,
      setupFiles: ['./api/tests/middleware/setup.ts'],
      // Workers tests need sequential execution for stability
      sequence: {
        concurrent: false,
      },
    },
  },
])
