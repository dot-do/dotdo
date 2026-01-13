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
  GLOBAL_SETUP,
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
  // Always include global setup, then any custom setup files
  const setupFiles = [GLOBAL_SETUP, ...(options.setupFiles ?? [])]

  return {
    test: {
      ...sharedTestConfig,
      name,
      include,
      exclude: defaultExcludes,
      environment: 'node' as const,
      setupFiles,
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
  createNodeWorkspace('schema', ['db/tests/**/*.test.ts', 'db/schema/tests/**/*.test.ts']),

  // Primitives tests (event-emitter, fsx, bashx, etc.)
  createNodeWorkspace('primitives', ['primitives/**/*.test.ts']),

  // Iceberg table navigation tests
  createNodeWorkspace('iceberg', ['db/iceberg/**/*.test.ts']),

  // EdgeVec vector index persistence tests
  createNodeWorkspace('edgevec', ['db/edgevec/**/*.test.ts']),

  // Parquet writer/reader tests
  createNodeWorkspace('parquet', ['db/parquet/**/*.test.ts']),

  // DB primitives tests (column stores, compression codecs)
  createNodeWorkspace('db-primitives', ['db/primitives/**/*.test.ts']),

  // EdgePostgres tests (PGLite + FSX integration)
  createNodeWorkspace('edge-postgres', ['db/edge-postgres/**/*.test.ts']),

  // Durable Objects tests (mocked runtime)
  createNodeWorkspace('objects', ['objects/tests/**/*.test.ts']),

  // DO persistence layer tests (checkpoint, WAL, replication, migration, iceberg state)
  createNodeWorkspace('persistence', ['objects/persistence/tests/**/*.test.ts']),

  // DO transport layer tests (REST router, edit UI, auth layer, RPC, etc.)
  createNodeWorkspace('objects-transport', ['objects/transport/tests/**/*.test.ts']),

  // Library utility tests (sqids, mixins, executors, rpc, sql, logging, channels, humans, colo, support, pricing, okrs, storage, auth, namespace, response, triggers, cache, payments, etc.)
  createNodeWorkspace('lib', ['lib/tests/**/*.test.ts', 'lib/mixins/tests/**/*.test.ts', 'lib/executors/tests/**/*.test.ts', 'lib/rpc/tests/**/*.test.ts', 'lib/sql/tests/**/*.test.ts', 'lib/logging/tests/**/*.test.ts', 'lib/channels/tests/**/*.test.ts', 'lib/humans/tests/**/*.test.ts', 'lib/colo/tests/**/*.test.ts', 'lib/support/tests/**/*.test.ts', 'lib/pricing/tests/**/*.test.ts', 'lib/okrs/tests/**/*.test.ts', 'lib/storage/tests/**/*.test.ts', 'lib/auth/tests/**/*.test.ts', 'lib/namespace/tests/**/*.test.ts', 'lib/response/tests/**/*.test.ts', 'lib/triggers/tests/**/*.test.ts', 'lib/cache/tests/**/*.test.ts', 'lib/payments/tests/**/*.test.ts']),

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
    resolve: {
      alias: {
        ...(nodeResolveConfig?.alias || {}),
        '@dotdo/client': resolve(PROJECT_ROOT, 'packages/client/src/index.ts'),
        '@dotdo/react': resolve(PROJECT_ROOT, 'packages/react/src/index.ts'),
        // App-specific aliases (match app/tsconfig.json paths)
        '~': resolve(PROJECT_ROOT, 'app'),
        '@': resolve(PROJECT_ROOT, 'app'),
      },
    },
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

  // Worker unit tests (Node environment, uses mocks - NOT workers runtime)
  // These test worker logic without requiring actual Workers runtime
  createNodeWorkspace('worker-unit', ['workers/tests/**/*.test.ts']),

  // Tests for objects in tests/objects directory (mocked Durable Objects)
  createNodeWorkspace('tests-objects', ['tests/objects/**/*.test.ts']),

  // Transport layer tests (auth-layer JWT, RPC, etc.)
  createNodeWorkspace('transport', ['tests/transport/**/*.test.ts']),

  // CLI tests (device auth, config management, commands)
  createNodeWorkspace('cli', ['cli/tests/**/*.test.ts', 'cli/commands/tests/**/*.test.ts']),

  // API generators tests (MCP tools, etc.)
  createNodeWorkspace('generators', ['api/generators/tests/**/*.test.ts']),

  // API routes tests (Node environment, for isolated route testing)
  // Includes both api/routes/tests/ and api/tests/routes/ directories
  createNodeWorkspace('api-routes', ['api/routes/tests/**/*.test.ts', 'api/tests/routes/**/*.test.ts']),

  // Compat layer tests (API-compatible SDKs backed by DO)
  createNodeWorkspace('compat', ['compat/**/*.test.ts', 'db/compat/**/*.test.ts', 'search/compat/**/*.test.ts', 'config/compat/**/*.test.ts', 'storage/compat/**/*.test.ts']),

  // Database core tests (sharding, replication, tiering, vectors)
  createNodeWorkspace('db-core', ['db/core/**/*.test.ts']),

  // @dotdo/turso package tests
  createNodeWorkspace('turso', ['packages/turso/tests/**/*.test.ts']),

  // @dotdo/kafka package tests (Kafka-compatible message queue)
  createNodeWorkspace('kafka', ['packages/kafka/tests/**/*.test.ts']),

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

  // @dotdo/duckdb-worker distributed query layer tests
  createNodeWorkspace('duckdb-distributed', [
    'packages/duckdb-worker/src/distributed/tests/**/*.test.ts',
  ]),

  // @dotdo/worker-helpers package tests (Customer Worker Helpers)
  createNodeWorkspace('worker-helpers', ['packages/worker-helpers/tests/**/*.test.ts']),

  // @dotdo/client package tests (RPC Client SDK)
  createNodeWorkspace('client', ['packages/client/tests/**/*.test.ts']),

  // @dotdo/rpc package tests (Universal SDK Wrapper)
  createNodeWorkspace('rpc', ['packages/rpc/tests/**/*.test.ts']),

  // @dotdo/core package tests (Error handling and retry infrastructure)
  createNodeWorkspace('core', ['packages/core/tests/**/*.test.ts']),

  // @dotdo/stripe package tests (Stripe API compatibility layer)
  createNodeWorkspace('stripe', ['packages/stripe/tests/**/*.test.ts']),

  // @dotdo/hubspot package tests (HubSpot API compatibility layer)
  createNodeWorkspace('hubspot', ['packages/hubspot/tests/**/*.test.ts']),

  // @dotdo/shopify package tests (Shopify API compatibility layer)
  createNodeWorkspace('shopify', ['packages/shopify/tests/**/*.test.ts']),

  // @dotdo/shared package tests (Event emitters and shared utilities)
  createNodeWorkspace('shared', ['packages/shared/tests/**/*.test.ts']),

  // @dotdo/discord package tests (Discord SDK compat layer)
  createNodeWorkspace('discord', ['packages/discord/tests/**/*.test.ts']),

  // @dotdo/linear package tests (Linear SDK compat layer)
  createNodeWorkspace('linear', ['packages/linear/tests/**/*.test.ts']),

  // @dotdo/github package tests (Octokit-compatible GitHub SDK)
  createNodeWorkspace('github', ['packages/github/tests/**/*.test.ts']),

  // @dotdo/google-ai package tests (Google Generative AI compatibility layer)
  createNodeWorkspace('google-ai', ['packages/google-ai/tests/**/*.test.ts']),

  // @dotdo/twilio package tests (Twilio SDK compat layer)
  createNodeWorkspace('twilio', ['packages/twilio/tests/**/*.test.ts']),

  // @dotdo/anthropic package tests (Anthropic SDK compat layer)
  createNodeWorkspace('anthropic', ['packages/anthropic/tests/**/*.test.ts']),

  // @dotdo/openai package tests (OpenAI API compatibility layer)
  createNodeWorkspace('openai', ['packages/openai/tests/**/*.test.ts']),

  // @dotdo/cohere package tests (Cohere SDK compat layer)
  createNodeWorkspace('cohere', ['packages/cohere/tests/**/*.test.ts']),

  // @dotdo/intercom package tests (Intercom SDK compat layer)
  createNodeWorkspace('intercom', ['packages/intercom/tests/**/*.test.ts']),

  // @dotdo/sentry package tests (Sentry SDK compat layer)
  createNodeWorkspace('sentry', ['packages/sentry/tests/**/*.test.ts']),

  // @dotdo/analytics package tests (Analytics SDK compat layer)
  createNodeWorkspace('analytics', ['packages/analytics/tests/**/*.test.ts']),

  // @dotdo/pusher package tests (Pusher SDK compat layer)
  createNodeWorkspace('pusher', ['packages/pusher/tests/**/*.test.ts']),

  // @dotdo/sqs package tests (AWS SQS SDK compat layer)
  createNodeWorkspace('sqs', ['packages/sqs/tests/**/*.test.ts']),

  // @dotdo/algolia package tests (Algolia SDK compat layer)
  createNodeWorkspace('algolia', ['packages/algolia/tests/**/*.test.ts']),

  // @dotdo/cubejs package tests (Cube.js headless BI compat layer)
  createNodeWorkspace('cubejs', ['packages/cubejs/tests/**/*.test.ts']),

  // @dotdo/zendesk package tests (Zendesk SDK compat layer)
  createNodeWorkspace('zendesk', ['packages/zendesk/tests/**/*.test.ts']),

  // @dotdo/segment package tests (Segment SDK compat layer)
  createNodeWorkspace('segment', ['packages/segment/tests/**/*.test.ts']),

  // @dotdo/salesforce package tests (Salesforce jsforce compat layer)
  createNodeWorkspace('salesforce', ['packages/salesforce/tests/**/*.test.ts']),

  // @dotdo/flags package tests (Feature Flags SDK)
  createNodeWorkspace('pkg-flags', ['packages/flags/tests/**/*.test.ts']),

  // @dotdo/emails package tests (Email service with SendGrid/Resend compatibility)
  createNodeWorkspace('emails', ['packages/emails/tests/**/*.test.ts']),

  // @dotdo/n8n package tests (n8n-compatible workflow automation)
  createNodeWorkspace('n8n', ['packages/n8n/tests/**/*.test.ts']),

  // @dotdo/couchdb package tests (CouchDB-compatible API with in-memory backend)
  createNodeWorkspace('couchdb', ['packages/couchdb/tests/**/*.test.ts']),

  // @dotdo/supabase package tests (Supabase SDK compat layer)
  createNodeWorkspace('supabase', ['packages/supabase/tests/**/*.test.ts']),

  // @dotdo/supabase-auth package tests (Supabase Auth with in-memory backend)
  createNodeWorkspace('supabase-auth', ['packages/supabase-auth/tests/**/*.test.ts']),

  // @dotdo/auth package tests (Multi-provider auth with in-memory backend)
  createNodeWorkspace('auth', ['packages/auth/tests/**/*.test.ts']),

  // @dotdo/automation package tests (n8n-compatible workflow automation)
  createNodeWorkspace('automation', ['packages/automation/tests/**/*.test.ts']),

  // @dotdo/zapier package tests (Zapier Platform Core compat layer)
  createNodeWorkspace('zapier', ['packages/zapier/tests/**/*.test.ts']),

  // @dotdo/benthos package tests (Benthos-compatible stream processing)
  createNodeWorkspace('benthos', ['packages/benthos/tests/**/*.test.ts']),

  // @dotdo/calls package tests (Voice/Video Calling with Twilio compatibility)
  createNodeWorkspace('calls', ['packages/calls/tests/**/*.test.ts']),

  // @dotdo/flink package tests (Apache Flink DataStream API compat layer)
  createNodeWorkspace('flink', ['packages/flink/tests/**/*.test.ts']),

  // @dotdo/react package tests (React hooks and components - jsdom environment)
  {
    test: {
      ...sharedTestConfig,
      name: 'react',
      include: ['packages/react/tests/**/*.test.ts', 'packages/react/tests/**/*.test.tsx'],
      exclude: defaultExcludes,
      environment: 'jsdom' as const,
    },
    resolve: {
      alias: {
        ...(nodeResolveConfig?.alias || {}),
        '@dotdo/client': resolve(PROJECT_ROOT, 'packages/client/src/index.ts'),
        '@dotdo/react': resolve(PROJECT_ROOT, 'packages/react/src/index.ts'),
      },
    },
  },

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

  // Roles system tests (job functions with OKRs and capabilities)
  createNodeWorkspace('roles', ['roles/**/*.test.ts']),

  // Agent tool adapters (Read, Write, Edit, Glob, Grep, Bash for Workers)
  createNodeWorkspace('agent-tools', ['lib/agent/tools/tests/**/*.test.ts']),

  // LLM API tests (OpenAI/Anthropic-compatible routing)
  createNodeWorkspace('llm', ['llm/**/*.test.ts']),

  // Streaming core tests (StreamBridge, pipelines integration)
  createNodeWorkspace('streaming', ['streaming/**/*.test.ts']),

  // Benchmarks (SQL parsers, DO latency, performance)
  createNodeWorkspace('benchmarks', ['tests/benchmarks/**/*.test.ts', 'benchmarks/**/*.test.ts']),

  // Reliability tests (error handling, promise handling, resilience)
  createNodeWorkspace('reliability', ['tests/reliability/**/*.test.ts', 'tests/error-handling/**/*.test.ts', 'tests/error-logging.test.ts', 'tests/error-logging/**/*.test.ts']),

  // Platform behavior tests (subrequest limits, WebSocket limits, etc.)
  createNodeWorkspace('platform', ['tests/platform/**/*.test.ts']),

  // Vector search tests (VectorShardDO, similarity search)
  createNodeWorkspace('vector', ['tests/vector/**/*.test.ts']),

  // Iceberg metadata DO tests (metadata parsing, partition pruning)
  createNodeWorkspace('iceberg-do', ['tests/iceberg/**/*.test.ts']),

  // Security tests (audit, dependencies, etc.)
  createNodeWorkspace('security', ['tests/security/**/*.test.ts']),

  // DuckDB Iceberg extension tests (R2 Data Catalog integration)
  createNodeWorkspace('duckdb-iceberg', ['db/compat/sql/duckdb-wasm/iceberg/tests/**/*.test.ts']),

  // Usage metering system tests (counters, aggregation, limits)
  createNodeWorkspace('metering', ['services/metering/tests/**/*.test.ts']),

  // ============================================
  // Workers Environment Tests
  // ============================================

  // Runtime integration tests using Cloudflare Workers pool
  // NOTE: api/tests/routes tests are now in api-routes project (node environment)
  {
    extends: './tests/config/vitest.workers.config.ts',
    test: {
      // Use only compatible settings from sharedTestConfig (NOT pool/poolOptions - those come from extended config)
      globals: sharedTestConfig?.globals,
      testTimeout: sharedTestConfig?.testTimeout,
      hookTimeout: sharedTestConfig?.hookTimeout,
      reporters: sharedTestConfig?.reporters,
      snapshotFormat: sharedTestConfig?.snapshotFormat,
      bail: sharedTestConfig?.bail,
      name: 'workers',
      include: [
        'api/tests/infrastructure/**/*.test.ts',
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
      exclude: [...defaultExcludes, 'workers/observability-tail/**', 'workers/do-rest-integration.test.ts', 'workers/tests/**'],
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

  // DO integration tests (DOBase REST router with real SQLite storage)
  {
    extends: './tests/config/vitest.workers.config.ts',
    test: {
      // Only use compatible settings from sharedTestConfig (avoid pool conflicts)
      globals: sharedTestConfig?.globals,
      name: 'do-integration',
      include: ['workers/do-rest-integration.test.ts'],
      exclude: defaultExcludes,
      sequence: { concurrent: false },
      // Override pool options to use DO-specific wrangler config with SQLite
      // Type assertion needed for @cloudflare/vitest-pool-workers specific options
      poolOptions: {
        workers: {
          wrangler: { configPath: resolve(PROJECT_ROOT, 'workers/wrangler.do-test.jsonc') },
          // Note: isolatedStorage disabled due to storage stack issues with DO SQLite
          // Tests use unique namespaces (uniqueNs()) for isolation instead
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

  // DuckDB VSS (Vector Similarity Search) extension tests
  {
    extends: './tests/config/vitest.workers.config.ts',
    test: {
      ...sharedTestConfig,
      name: 'duckdb-vss',
      include: ['db/compat/sql/duckdb-wasm/vss/tests/**/*.test.ts'],
      exclude: defaultExcludes,
      // VSS tests need longer timeout for extension loading
      testTimeout: 30_000,
      hookTimeout: 30_000,
      // Workers tests need sequential execution for stability
      sequence: {
        concurrent: false,
      },
    },
  },

  // DuckDB FTS (Full Text Search) extension tests
  {
    extends: './tests/config/vitest.workers.config.ts',
    test: {
      ...sharedTestConfig,
      name: 'duckdb-fts',
      include: ['db/compat/sql/duckdb-wasm/fts/tests/**/*.test.ts'],
      exclude: defaultExcludes,
      // FTS tests need longer timeout for extension loading
      testTimeout: 30_000,
      hookTimeout: 30_000,
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
