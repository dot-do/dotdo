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
 * Workspace timeout presets for different test types
 */
const TIMEOUTS = {
  default: { testTimeout: 10_000, hookTimeout: 10_000 },
  slow: { testTimeout: 15_000, hookTimeout: 15_000 },
  wasm: { testTimeout: 30_000, hookTimeout: 30_000 },
} as const

/**
 * Workers pool options for different DO configurations
 * Centralized to avoid duplication and ensure consistency
 */
const WORKERS_POOL_OPTIONS = {
  default: {
    workers: {
      wrangler: { configPath: './wrangler.jsonc' },
      isolatedStorage: true,
      singleWorker: true,
    },
  },
  doTest: {
    workers: {
      wrangler: { configPath: resolve(PROJECT_ROOT, 'workers/wrangler.do-test.jsonc') },
      isolatedStorage: false,
      singleWorker: true,
    },
  },
  workersTest: {
    workers: {
      wrangler: { configPath: resolve(PROJECT_ROOT, 'workers/wrangler.test.jsonc') },
      isolatedStorage: false,
      singleWorker: true,
    },
  },
  simpleDo: {
    workers: {
      wrangler: { configPath: resolve(PROJECT_ROOT, 'workers/wrangler.simple-do.jsonc') },
      isolatedStorage: false,
      singleWorker: true,
    },
  },
  browserDo: {
    workers: {
      wrangler: { configPath: resolve(PROJECT_ROOT, 'workers/wrangler.browser-do-test.jsonc') },
      isolatedStorage: false,
      singleWorker: true,
    },
  },
  duckdbWorker: {
    workers: {
      wrangler: { configPath: resolve(PROJECT_ROOT, 'packages/duckdb-worker/wrangler.jsonc') },
      isolatedStorage: true,
      singleWorker: true,
    },
  },
  geoReplication: {
    workers: {
      wrangler: { configPath: resolve(PROJECT_ROOT, 'workers/wrangler.geo-replication.jsonc') },
      isolatedStorage: false,
      singleWorker: true,
    },
  },
  doWithTest: {
    workers: {
      wrangler: { configPath: resolve(PROJECT_ROOT, 'workers/wrangler.do-with-test.jsonc') },
      isolatedStorage: true,
      singleWorker: true,
    },
  },
  modulesIntegration: {
    workers: {
      wrangler: { configPath: resolve(PROJECT_ROOT, 'workers/wrangler.modules-integration.jsonc') },
      isolatedStorage: true,
      singleWorker: true,
    },
  },
} as const

/**
 * Creates a Node.js test workspace configuration
 * Reduces boilerplate for node-based test workspaces
 */
function createNodeWorkspace(
  name: string,
  include: string[],
  options: { setupFiles?: string[]; exclude?: string[] } = {}
) {
  // Always include global setup, then any custom setup files
  const setupFiles = [GLOBAL_SETUP, ...(options.setupFiles ?? [])]
  const exclude = options.exclude ? [...defaultExcludes, ...options.exclude] : defaultExcludes

  return {
    test: {
      ...sharedTestConfig,
      name,
      include,
      exclude,
      environment: 'node' as const,
      setupFiles,
    },
    resolve: nodeResolveConfig,
  }
}

/**
 * Creates a Workers test workspace configuration
 * Reduces boilerplate for Workers-based test workspaces
 */
function createWorkersWorkspace(
  name: string,
  include: string[],
  options: {
    poolOptions?: (typeof WORKERS_POOL_OPTIONS)[keyof typeof WORKERS_POOL_OPTIONS]
    timeouts?: (typeof TIMEOUTS)[keyof typeof TIMEOUTS]
    setupFiles?: string[]
    exclude?: string[]
  } = {}
) {
  const { poolOptions = WORKERS_POOL_OPTIONS.default, timeouts = TIMEOUTS.slow, setupFiles, exclude } = options

  return {
    extends: './tests/config/vitest.workers.config.ts',
    test: {
      globals: sharedTestConfig?.globals,
      name,
      include,
      exclude: exclude ? [...defaultExcludes, ...exclude] : defaultExcludes,
      sequence: { concurrent: false },
      ...timeouts,
      ...(setupFiles ? { setupFiles } : {}),
      poolOptions: poolOptions as unknown as Record<string, unknown>,
    },
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
  createNodeWorkspace('schema', ['db/tests/**/*.test.ts', 'db/schema/tests/**/*.test.ts', 'db/schema/generation/tests/**/*.test.ts']),

  // Primitives tests (event-emitter, fsx, bashx, etc.)
  createNodeWorkspace('primitives', ['primitives/**/*.test.ts']),

  // Documentation tests (code example extraction, compilation verification)
  createNodeWorkspace('docs', ['docs/tests/**/*.test.ts']),

  // Iceberg table navigation tests
  createNodeWorkspace('iceberg', ['db/iceberg/**/*.test.ts']),

  // Graph query engine and schema tests (Things + Relationships)
  createNodeWorkspace('graph', ['db/graph/**/*.test.ts']),

  // Graph E2E tests (cross-DO operations with Miniflare)
  createNodeWorkspace('graph-e2e', ['tests/e2e/graph/**/*.test.ts']),

  // TanStack DB integration tests (sync engine, collection options, rpc client)
  createNodeWorkspace('tanstack', ['db/tanstack/**/*.test.ts']),

  // EdgeVec vector index persistence tests
  createNodeWorkspace('edgevec', ['db/edgevec/**/*.test.ts']),

  // Parquet writer/reader tests
  createNodeWorkspace('parquet', ['db/parquet/**/*.test.ts']),

  // DB primitives tests (column stores, compression codecs)
  createNodeWorkspace('db-primitives', ['db/primitives/**/*.test.ts']),

  // EdgePostgres tests (PGLite + FSX integration)
  createNodeWorkspace('edge-postgres', ['db/edge-postgres/**/*.test.ts']),

  // BlobStore tests (R2 binary storage with SQLite metadata)
  createNodeWorkspace('blob', ['tests/db/blob/**/*.test.ts']),

  // TimeSeriesStore tests (time-indexed storage with retention, compaction, range queries)
  createNodeWorkspace('timeseries', ['tests/db/timeseries/**/*.test.ts']),

  // RelationalStore tests (Drizzle ORM integration with CDC)
  createNodeWorkspace('relational', ['tests/db/relational/**/*.test.ts', 'db/relational/**/*.test.ts']),

  // ColumnarStore tests (analytics-optimized columnar storage with 99.4% cost savings)
  createNodeWorkspace('columnar', ['tests/db/columnar/**/*.test.ts', 'db/columnar/**/*.test.ts']),

  // Durable Objects tests (mocked runtime)
  // Excludes tests requiring cloudflare:test (handled by Workers workspaces)
  createNodeWorkspace('objects', ['objects/tests/**/*.test.ts'], {
    exclude: [
      '**/geo-replication.test.ts', // Workers integration tests (uses cloudflare:test)
      '**/do-geo-replication.test.ts', // Workers integration tests
      '**/cross-do-transactions-e2e.test.ts', // Workers integration tests (uses cloudflare:test)
      '**/cross-do-e2e.test.ts', // Workers integration tests (uses cloudflare:test)
      '**/do-rpc*.test.ts',
      '**/do-shard-unshard.test.ts',
      '**/do-compact-merge.test.ts',
      '**/storage-stores-comprehensive.test.ts',
      '**/clickable-api-e2e.test.ts',
      '**/do-identity-schema.test.ts',
      '**/simple-do-rpc.test.ts',
      '**/browser-do-*.test.ts',
      '**/do-with-integration.test.ts',
      '**/do-promote-demote.test.ts',
      '**/schema-migration-integration.test.ts', // Workers integration tests (uses cloudflare:test)
      '**/do-modules-integration.test.ts', // Workers integration tests (uses cloudflare:test)
    ],
  }),

  // do/ entry point module tests
  createNodeWorkspace('do', ['do/tests/**/*.test.ts']),

  // DO persistence layer tests (checkpoint, WAL, replication, migration, iceberg state)
  createNodeWorkspace('persistence', ['objects/persistence/tests/**/*.test.ts']),

  // DO transport layer tests (REST router, edit UI, auth layer, RPC, etc.)
  createNodeWorkspace('objects-transport', ['objects/transport/tests/**/*.test.ts']),

  // Library utility tests (sqids, capabilities, executors, rpc, sql, logging, channels, etc.)
  // Uses glob pattern to capture all lib subdirectory tests
  createNodeWorkspace('lib', [
    'lib/tests/**/*.test.ts',
    'lib/*/tests/**/*.test.ts',
  ]),

  // Cloudflare integration tests (Workflows, etc.)
  createNodeWorkspace('cloudflare', ['lib/cloudflare/tests/**/*.test.ts']),

  // Event normalizer tests
  createNodeWorkspace('snippets', ['snippets/tests/**/*.test.ts']),

  // Workflow proxy tests ($ proxy, domain, hash, flag)
  createNodeWorkspace('workflows', ['workflows/**/*.test.ts']),

  // Type definition tests
  createNodeWorkspace('types', ['types/tests/**/*.test.ts']),

  // Nouns tests (DO-Noun integration, schema validation)
  createNodeWorkspace('nouns', ['nouns/tests/**/*.test.ts']),

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

  // App shell tests (navigation configuration, routing utilities)
  createNodeWorkspace('app-shell', ['app/lib/shell/**/*.test.ts']),

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

  // DB stream primitive tests (Kafka-inspired streaming)
  createNodeWorkspace('db-stream', ['tests/db/stream/**/*.test.ts']),

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
  // Note: shard-integration.test.ts runs in shard-integration workspace (Workers environment)
  createNodeWorkspace('db-core', ['db/core/**/*.test.ts'], {
    exclude: ['db/core/shard-integration.test.ts'],
  }),

  // @dotdo/turso package tests
  createNodeWorkspace('turso', ['packages/turso/tests/**/*.test.ts']),

  // @dotdo/mongo package tests (MongoDB-compatible client with in-memory backend)
  createNodeWorkspace('mongo', ['packages/mongo/tests/**/*.test.ts']),

  // @dotdo/redis package tests (Redis-compatible in-memory data store)
  createNodeWorkspace('redis', ['packages/redis/tests/**/*.test.ts']),

  // @dotdo/postgres package tests (PostgreSQL-compatible client with in-memory backend)
  createNodeWorkspace('postgres', ['packages/postgres/tests/**/*.test.ts']),

  // @dotdo/sendgrid package tests (SendGrid SDK compat layer)
  createNodeWorkspace('sendgrid', ['packages/sendgrid/tests/**/*.test.ts']),

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

  // @dotdo/duckdb package tests (DuckDB compat layer with dotdo extensions)
  createNodeWorkspace('duckdb', ['packages/duckdb/tests/**/*.test.ts']),

  // @dotdo/worker-helpers package tests (Customer Worker Helpers)
  createNodeWorkspace('worker-helpers', ['packages/worker-helpers/tests/**/*.test.ts']),

  // @dotdo/client package tests (RPC Client SDK)
  createNodeWorkspace('client', ['packages/client/tests/**/*.test.ts']),

  // @dotdo/rpc package tests (Universal SDK Wrapper)
  createNodeWorkspace('rpc', ['packages/rpc/tests/**/*.test.ts']),

  // @dotdo/core package tests (Error handling and retry infrastructure)
  createNodeWorkspace('core', ['packages/core/tests/**/*.test.ts']),

  // @dotdo/path-utils package tests (POSIX path utilities)
  createNodeWorkspace('path-utils', ['packages/path-utils/tests/**/*.test.ts']),

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

  // Auth module tests (better-auth graph adapter, cross-domain OAuth)
  createNodeWorkspace('auth-module', ['auth/tests/**/*.test.ts', 'auth/adapters/tests/**/*.test.ts']),

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
  createNodeWorkspace('vector', ['tests/vector/**/*.test.ts', 'tests/db/vector/**/*.test.ts']),

  // Iceberg metadata DO tests (metadata parsing, partition pruning)
  createNodeWorkspace('iceberg-do', ['tests/iceberg/**/*.test.ts']),

  // Security tests (audit, dependencies, etc.)
  createNodeWorkspace('security', ['tests/security/**/*.test.ts']),

  // Test isolation tests (verify global state reset between tests)
  createNodeWorkspace('isolation', ['tests/isolation/**/*.test.ts']),

  // Integration tests (cross-subsystem, cascade E2E, etc.)
  createNodeWorkspace('integration', ['tests/integration/**/*.test.ts', 'tests/e2e/**/*.test.ts']),

  // DuckDB Iceberg extension tests (R2 Data Catalog integration)
  createNodeWorkspace('duckdb-iceberg', ['db/compat/sql/duckdb-wasm/iceberg/tests/**/*.test.ts']),

  // Usage metering system tests (counters, aggregation, limits)
  createNodeWorkspace('metering', ['services/metering/tests/**/*.test.ts']),

  // ============================================
  // Workers Environment Tests
  // ============================================

  // Runtime integration tests using Cloudflare Workers pool
  createWorkersWorkspace('workers', [
    'api/tests/infrastructure/**/*.test.ts',
    'api/tests/middleware/**/*.test.ts',
    'api/tests/url-normalization.test.ts',
  ], {
    timeouts: TIMEOUTS.default,
    setupFiles: ['./api/tests/middleware/setup.ts'],
  }),

  // Worker integration tests (real miniflare runtime)
  createWorkersWorkspace('workers-integration', ['workers/**/*.test.ts'], {
    poolOptions: WORKERS_POOL_OPTIONS.workersTest,
    exclude: ['workers/observability-tail/**', 'workers/do-rest-integration.test.ts', 'workers/tests/**'],
  }),

  // DO integration tests (DOBase REST router with real SQLite storage)
  createWorkersWorkspace('do-integration', ['workers/do-rest-integration.test.ts'], {
    poolOptions: WORKERS_POOL_OPTIONS.doTest,
  }),

  // DO identity and schema tests
  createWorkersWorkspace('do-identity', ['objects/tests/do-identity-schema.test.ts'], {
    poolOptions: WORKERS_POOL_OPTIONS.doTest,
  }),

  // Simple DO RPC test (verifies Workers RPC works with minimal DO)
  createWorkersWorkspace('simple-do-rpc', ['objects/tests/simple-do-rpc.test.ts'], {
    poolOptions: WORKERS_POOL_OPTIONS.simpleDo,
  }),

  // DO RPC direct method access tests (stub.things.create(), stub.rels.query(), etc.)
  createWorkersWorkspace('do-rpc', [
    'objects/tests/do-rpc.test.ts',
    'objects/tests/do-rpc-flat.test.ts',
    'objects/tests/do-promote-demote.test.ts',
  ], {
    poolOptions: WORKERS_POOL_OPTIONS.doTest,
  }),

  // Comprehensive storage stores tests (Things, Rels, Events, Actions)
  createWorkersWorkspace('storage-stores', [
    'objects/tests/storage-stores-comprehensive.test.ts',
  ], {
    poolOptions: WORKERS_POOL_OPTIONS.doTest,
  }),

  // DO Shard/Unshard operations tests (real miniflare DOs, no mocks)
  createWorkersWorkspace('do-shard-unshard', ['objects/tests/do-shard-unshard.test.ts'], {
    poolOptions: WORKERS_POOL_OPTIONS.doTest,
  }),

  // DO Compact/Merge lifecycle tests (DOFull operations with real miniflare DOs)
  createWorkersWorkspace('do-compact-merge', ['objects/tests/do-compact-merge.test.ts'], {
    poolOptions: WORKERS_POOL_OPTIONS.doTest,
  }),

  // Geo-Replication Workers integration tests (multi-region data replication)
  // Both geo-replication.test.ts and do-geo-replication.test.ts use cloudflare:test with real miniflare DOs
  createWorkersWorkspace('geo-replication', [
    'objects/tests/geo-replication.test.ts',
    'objects/tests/do-geo-replication.test.ts',
  ], {
    poolOptions: WORKERS_POOL_OPTIONS.geoReplication,
  }),

  // Cross-DO Transaction E2E tests (Saga, 2PC, Idempotency)
  // Uses cloudflare:test with real miniflare DOs - NO MOCKS
  createWorkersWorkspace('cross-do-transactions', [
    'objects/tests/cross-do-transactions-e2e.test.ts',
    'objects/tests/cross-do-e2e.test.ts',
  ], {
    poolOptions: WORKERS_POOL_OPTIONS.doTest,
  }),

  // DO Clickable API E2E tests (every link is fetchable pattern)
  createWorkersWorkspace('clickable-api', ['objects/tests/clickable-api-e2e.test.ts'], {
    poolOptions: WORKERS_POOL_OPTIONS.doTest,
  }),

  // Browser DO integration tests (lifecycle, routes, screencast with mock session)
  createWorkersWorkspace('browser-do', [
    'objects/tests/browser-do-lifecycle.test.ts',
    'objects/tests/browser-do-routes.test.ts',
    'objects/tests/browser-do-screencast.test.ts',
  ], {
    poolOptions: WORKERS_POOL_OPTIONS.browserDo,
  }),

  // DO.with() eager initialization integration tests (real miniflare DOs)
  createWorkersWorkspace('do-with-integration', ['objects/tests/do-with-integration.test.ts'], {
    poolOptions: WORKERS_POOL_OPTIONS.doWithTest,
  }),

  // DO Modules Integration tests (DOStorage, DOTransport, DOWorkflow, SchemaMigration)
  // Uses real miniflare DOs - NO MOCKS (replaces schema-migration.test.ts and do-modules.test.ts)
  createWorkersWorkspace('modules-integration', [
    'objects/tests/schema-migration-integration.test.ts',
    'objects/tests/do-modules-integration.test.ts',
  ], {
    poolOptions: WORKERS_POOL_OPTIONS.modulesIntegration,
  }),

  // DuckDB WASM tests - require Workers runtime for WASM instantiation
  createWorkersWorkspace('duckdb-wasm', ['db/compat/sql/duckdb-wasm/tests/**/*.test.ts']),

  // DuckDB VSS (Vector Similarity Search) extension tests
  createWorkersWorkspace('duckdb-vss', ['db/compat/sql/duckdb-wasm/vss/tests/**/*.test.ts'], {
    timeouts: TIMEOUTS.wasm,
  }),

  // DuckDB FTS (Full Text Search) extension tests
  createWorkersWorkspace('duckdb-fts', ['db/compat/sql/duckdb-wasm/fts/tests/**/*.test.ts'], {
    timeouts: TIMEOUTS.wasm,
  }),

  // ShardManager integration tests (real DO stubs via miniflare)
  createWorkersWorkspace('shard-integration', ['db/core/shard-integration.test.ts'], {
    poolOptions: WORKERS_POOL_OPTIONS.workersTest,
  }),

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
