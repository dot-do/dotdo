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
 * - duckdb-wasm: DuckDB WASM instantiation tests (requires Workers runtime)
 *
 * Run specific workspace: npx vitest --project=workers
 * Run all workspaces: npx vitest --workspace
 *
 * @see tests/config/vitest.shared.ts for shared configuration
 * @see tests/config/vitest.workers.config.ts for Workers pool configuration
 */

import { defineWorkspace } from 'vitest/config'
import { resolve } from 'path'
import {
  sharedTestConfig,
  nodeResolveConfig,
  defaultExcludes,
  CHDB_MOCK,
  PROJECT_ROOT,
} from './tests/config/vitest.shared'

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

  // EdgeVec vector index persistence tests
  createNodeWorkspace('edgevec', ['db/edgevec/**/*.test.ts']),

  // Parquet writer/reader tests
  createNodeWorkspace('parquet', ['db/parquet/**/*.test.ts']),

  // EdgePostgres tests (PGLite + FSX integration)
  createNodeWorkspace('edge-postgres', ['db/edge-postgres/**/*.test.ts']),

  // Durable Objects tests (mocked runtime)
  createNodeWorkspace('objects', ['objects/tests/**/*.test.ts']),

  // Library utility tests (sqids, mixins, executors, rpc, sql, logging, etc.)
  createNodeWorkspace('lib', ['lib/tests/**/*.test.ts', 'lib/mixins/tests/**/*.test.ts', 'lib/executors/tests/**/*.test.ts', 'lib/rpc/tests/**/*.test.ts', 'lib/sql/tests/**/*.test.ts', 'lib/logging/tests/**/*.test.ts']),

  // Cloudflare integration tests (Workflows, etc.)
  createNodeWorkspace('cloudflare', ['lib/cloudflare/tests/**/*.test.ts']),

  // Event normalizer tests
  createNodeWorkspace('snippets', ['snippets/tests/**/*.test.ts']),

  // Workflow proxy tests ($ proxy, domain, hash, flag)
  createNodeWorkspace('workflows', ['workflows/**/*.test.ts']),

  // Type definition tests
  createNodeWorkspace('types', ['types/tests/**/*.test.ts']),

  // Evaluation storage tests
  createNodeWorkspace('evals', ['evals/tests/**/*.test.ts']),

  // DB Proxy tests (fluent query builder)
  createNodeWorkspace('db-proxy', ['db/proxy/tests/**/*.test.ts']),

  // Payload plugin tests
  createNodeWorkspace('payload', ['db/payload/tests/**/*.test.ts']),

  // TanStack Start / Fumadocs build tests
  createNodeWorkspace('app', ['app/tests/**/*.test.ts']),

  // App hooks tests (file structure verification for TDD)
  createNodeWorkspace('app-hooks', ['app/lib/hooks/**/*.test.ts']),

  // App React component tests (jsdom environment for React testing)
  {
    test: {
      ...sharedTestConfig,
      name: 'app-components',
      include: ['app/tests/**/*.test.tsx', 'app/__tests__/**/*.test.tsx', 'app/components/**/__tests__/**/*.test.tsx'],
      exclude: defaultExcludes,
      environment: 'jsdom' as const,
      setupFiles: ['./app/tests/setup.ts'],
    },
    resolve: nodeResolveConfig,
  },

  // Client React hook tests (jsdom environment for React testing)
  {
    test: {
      ...sharedTestConfig,
      name: 'client-hooks',
      include: ['client/tests/**/*.test.tsx', 'client/tests/**/*.test.ts'],
      exclude: defaultExcludes,
      environment: 'jsdom' as const,
      setupFiles: ['./app/tests/setup.ts'],
    },
    resolve: nodeResolveConfig,
  },

  // Utility tests (hash, etc.)
  createNodeWorkspace('utils', ['tests/utils/**/*.test.ts']),

  // API root discovery tests (Node environment, tests endpoint structure)
  {
    test: {
      ...sharedTestConfig,
      name: 'api-discovery',
      include: ['tests/api/**/*.test.ts'],
      exclude: defaultExcludes,
      environment: 'node' as const,
      setupFiles: ['./tests/api/setup.ts'],
    },
    resolve: nodeResolveConfig,
  },

  // Test harness utilities tests
  createNodeWorkspace('harness', ['tests/harness/**/*.test.ts']),

  // ACID test suite (Phase 1-6 tests for consistency/durability)
  createNodeWorkspace('acid', ['tests/acid/**/*.test.ts']),

  // Test mocks infrastructure
  createNodeWorkspace('mocks', ['tests/mocks/**/*.test.ts']),

  // Feature flags tests
  createNodeWorkspace('flags', ['tests/flags/**/*.test.ts']),

  // Rate limit binding tests
  createNodeWorkspace('rate-limit', ['tests/rate-limit/**/*.test.ts']),

  // Database migrations tests
  createNodeWorkspace('migrations', ['tests/migrations/**/*.test.ts']),

  // Vault credential storage tests
  createNodeWorkspace('vault', ['tests/vault/**/*.test.ts']),

  // Session replay tests
  createNodeWorkspace('session-replay', ['tests/session-replay/**/*.test.ts']),

  // Usage/analytics tests
  createNodeWorkspace('usage', ['tests/usage/**/*.test.ts']),

  // Cache tests (visibility cache, etc.)
  createNodeWorkspace('cache', ['tests/cache/**/*.test.ts']),

  // Visibility tests (with chdb mock)
  {
    test: {
      ...sharedTestConfig,
      name: 'visibility',
      include: ['tests/visibility/**/*.test.ts'],
      exclude: defaultExcludes,
      environment: 'node' as const,
    },
    resolve: {
      alias: {
        ...(nodeResolveConfig?.alias || {}),
        chdb: CHDB_MOCK,
      },
    },
  },

  // Tests for types in tests/types directory
  createNodeWorkspace('tests-types', ['tests/types/**/*.test.ts']),

  // Streams transformation tests (Pipeline SQL transforms)
  createNodeWorkspace('streams', ['tests/streams/**/*.test.ts']),

  // Tail worker and other worker processing tests (non-runtime)
  createNodeWorkspace('tests-workers', ['tests/workers/**/*.test.ts']),

  // Observability tail worker tests (pipeline integration)
  createNodeWorkspace('observability-tail', ['workers/observability-tail/tests/**/*.test.ts']),

  // Tests for objects in tests/objects directory (mocked Durable Objects)
  createNodeWorkspace('tests-objects', ['tests/objects/**/*.test.ts']),

  // CLI tests (device auth, config management)
  createNodeWorkspace('cli', ['cli/tests/**/*.test.ts']),

  // API generators tests (MCP tools, etc.)
  createNodeWorkspace('generators', ['api/generators/tests/**/*.test.ts']),

  // API routes tests (Node environment, for isolated route testing)
  createNodeWorkspace('api-routes', ['api/routes/tests/**/*.test.ts']),

  // Compat layer tests (API-compatible SDKs backed by DO)
  createNodeWorkspace('compat', ['compat/**/*.test.ts', 'db/compat/**/*.test.ts', 'search/compat/**/*.test.ts', 'config/compat/**/*.test.ts', 'storage/compat/**/*.test.ts']),

  // Database core tests (sharding, replication, tiering, vectors)
  createNodeWorkspace('db-core', ['db/core/**/*.test.ts']),

  // @dotdo/turso package tests
  createNodeWorkspace('turso', ['packages/turso/tests/**/*.test.ts']),

  // TanStack DB integration tests (db/tanstack - SyncClient, RPC, etc.)
  createNodeWorkspace('tanstack-db', ['db/tanstack/**/*.test.ts']),

  // @dotdo/duckdb-worker package tests (Node.js compatible tests only)
  // Note: Workers-specific tests are in packages/duckdb-worker/tests/workers/ and run in duckdb-worker-workers project
  createNodeWorkspace('duckdb-worker', [
    'packages/duckdb-worker/tests/*.test.ts',  // Root test files only, not workers/
    'packages/duckdb-worker/tests/benchmarks/**/*.test.ts',  // Benchmarks (R2 colocation, etc.)
  ]),

  // @dotdo/duckdb-worker E2E tests (live worker HTTP tests)
  createNodeWorkspace('duckdb-worker-e2e', [
    'packages/duckdb-worker/tests/e2e/**/*.test.ts',
  ]),

  // @dotdo/worker-helpers package tests (Customer Worker Helpers)
  createNodeWorkspace('worker-helpers', ['packages/worker-helpers/tests/**/*.test.ts']),

  // @dotdo/client package tests (RPC Client SDK)
  createNodeWorkspace('client', ['packages/client/tests/**/*.test.ts']),

  // Client context tests ($.db proxy for SaasKit)
  createNodeWorkspace('client-context', ['client/tests/**/*.test.ts']),

  // SDK client tests ($() function)
  createNodeWorkspace('sdk', ['sdk/**/*.test.ts']),

  // AI template literal API tests
  createNodeWorkspace('ai', ['ai/tests/**/*.test.ts', 'ai/**/*.test.ts']),

  // TypeScript compilation tests (RED TDD - verify type safety)
  createNodeWorkspace('typescript', ['tests/typescript/**/*.test.ts']),

  // Code conventions tests (file locations, naming, etc.)
  createNodeWorkspace('conventions', ['tests/conventions/**/*.test.ts']),

  // Agents SDK tests (Tool, Agent, Providers)
  createNodeWorkspace('agents', ['agents/**/*.test.ts']),

  // Streaming core tests (StreamBridge, pipelines integration)
  createNodeWorkspace('streaming', ['streaming/**/*.test.ts']),

  // Benchmarks (SQL parsers, etc.)
  createNodeWorkspace('benchmarks', ['tests/benchmarks/**/*.test.ts']),

  // Reliability tests (error handling, promise handling, resilience)
  createNodeWorkspace('reliability', ['tests/reliability/**/*.test.ts', 'tests/error-logging.test.ts']),

  // Platform behavior tests (subrequest limits, WebSocket limits, etc.)
  createNodeWorkspace('platform', ['tests/platform/**/*.test.ts']),

  // Vector search tests (VectorShardDO, similarity search)
  createNodeWorkspace('vector', ['tests/vector/**/*.test.ts']),

  // Iceberg metadata DO tests (metadata parsing, partition pruning)
  createNodeWorkspace('iceberg-do', ['tests/iceberg/**/*.test.ts']),

  // ============================================
  // Workers Environment Tests
  // ============================================

  // Runtime integration tests using Cloudflare Workers pool
  {
    extends: './tests/config/vitest.workers.config.ts',
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

  // Worker integration tests (real miniflare runtime)
  {
    extends: './tests/config/vitest.workers.config.ts',
    test: {
      // Only use compatible settings from sharedTestConfig (avoid pool conflicts)
      globals: sharedTestConfig?.globals,
      name: 'workers-integration',
      include: ['workers/**/*.test.ts'],
      exclude: [...defaultExcludes, 'workers/observability-tail/**'],
      sequence: { concurrent: false },
      // Override pool options to use workers-specific wrangler config
      // Type assertion needed for @cloudflare/vitest-pool-workers specific options
      poolOptions: {
        workers: {
          wrangler: { configPath: resolve(PROJECT_ROOT, 'workers/wrangler.test.jsonc') },
          // Note: isolatedStorage disabled due to storage stack issues with proxy handler tests
          // Tests don't rely on storage state between runs
          isolatedStorage: false,
          singleWorker: true,
        },
      } as unknown as Record<string, unknown>,
    },
  },

  // DuckDB WASM tests - require Workers runtime for WASM instantiation
  {
    extends: './tests/config/vitest.workers.config.ts',
    test: {
      ...sharedTestConfig,
      name: 'duckdb-wasm',
      include: ['db/compat/sql/duckdb-wasm/tests/**/*.test.ts'],
      exclude: defaultExcludes,
      // Workers tests need sequential execution for stability
      sequence: {
        concurrent: false,
      },
    },
  },

  // @dotdo/duckdb-worker package Workers tests
  {
    extends: './tests/config/vitest.workers.config.ts',
    test: {
      // Only use compatible settings from sharedTestConfig (avoid pool conflicts)
      globals: sharedTestConfig?.globals,
      name: 'duckdb-worker-workers',
      include: ['packages/duckdb-worker/tests/workers/**/*.test.ts'],
      exclude: defaultExcludes,
      // Workers tests need longer timeout for WASM loading
      testTimeout: 30_000,
      hookTimeout: 30_000,
      // Workers tests need sequential execution for stability
      sequence: {
        concurrent: false,
      },
      // Override pool options to use package-specific wrangler config
      // Type assertion needed for @cloudflare/vitest-pool-workers specific options
      poolOptions: {
        workers: {
          wrangler: { configPath: resolve(PROJECT_ROOT, 'packages/duckdb-worker/wrangler.jsonc') },
          isolatedStorage: true,
          singleWorker: true,
        },
      } as unknown as Record<string, unknown>,
    },
    resolve: {
      alias: {
        '@dotdo/duckdb-worker': resolve(PROJECT_ROOT, 'packages/duckdb-worker/src/index.ts'),
      },
    },
  },
])
