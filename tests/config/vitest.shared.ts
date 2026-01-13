/**
 * Shared Vitest Configuration
 *
 * This file contains shared test configuration used across all test workspaces.
 * Import and spread this configuration to ensure consistency.
 */

import { resolve } from 'path'
import type { UserConfig } from 'vitest/config'

/** Project root directory (two levels up from tests/config/) */
export const PROJECT_ROOT = resolve(__dirname, '../..')

/** Cloudflare workers module mock path */
export const CLOUDFLARE_WORKERS_MOCK = resolve(PROJECT_ROOT, 'tests/mocks/cloudflare-workers.ts')

/** chdb mock path for environments without native module */
export const CHDB_MOCK = resolve(PROJECT_ROOT, 'tests/mocks/chdb.ts')

/** capnweb mock path for ESM/CJS compatibility in tests */
export const CAPNWEB_MOCK = resolve(PROJECT_ROOT, 'tests/mocks/capnweb.ts')

/** drizzle-orm/durable-sqlite mock path */
export const DRIZZLE_DURABLE_SQLITE_MOCK = resolve(PROJECT_ROOT, 'tests/mocks/drizzle-durable-sqlite.ts')

/** @cloudflare/sandbox mock path for node environments */
export const CLOUDFLARE_SANDBOX_MOCK = resolve(PROJECT_ROOT, 'tests/mocks/cloudflare-sandbox.ts')

/** @cloudflare/containers mock path for node environments */
export const CLOUDFLARE_CONTAINERS_MOCK = resolve(PROJECT_ROOT, 'tests/mocks/cloudflare-containers.ts')

/** @tanstack/db mock path for TanStack DB integration tests */
export const TANSTACK_DB_MOCK = resolve(PROJECT_ROOT, 'tests/mocks/tanstack-db.ts')

/** @dotdo/tanstack/sync mock path for dotdo sync engine */
export const DOTDO_TANSTACK_SYNC_MOCK = resolve(PROJECT_ROOT, 'tests/mocks/dotdo-tanstack-sync.ts')

/** @dotdo/client/adapters path for client adapter modules */
export const DOTDO_CLIENT_ADAPTERS = resolve(PROJECT_ROOT, 'client/adapters')

/** humans.do path for human escalation module */
export const HUMANS_DO = resolve(PROJECT_ROOT, 'lib/humans/index.ts')

/** fsx.do path for filesystem module (sibling project) */
export const FSX_DO = resolve(PROJECT_ROOT, '../fsx/index.ts')

/** Global test setup file path for clearing static state between tests */
export const GLOBAL_SETUP = resolve(PROJECT_ROOT, 'tests/config/global-setup.ts')

/**
 * Shared test configuration settings applied to all test workspaces
 */
export const sharedTestConfig: Partial<UserConfig['test']> = {
  // Enable globals (describe, it, expect, etc.) without imports
  globals: true,

  // Test timeout - give async tests adequate time
  testTimeout: 10_000,
  hookTimeout: 10_000,

  // Reporter configuration
  // CI: minimal output for clean logs
  // Dev: verbose for debugging
  reporters: process.env.CI ? ['dot', 'github-actions'] : ['default'],

  // Snapshot configuration
  snapshotFormat: {
    printBasicPrototype: false,
  },

  // Fail fast in CI to save time
  bail: process.env.CI ? 1 : 0,

  // Thread pool configuration for faster tests
  pool: 'threads',
  poolOptions: {
    threads: {
      // Use all available cores in CI, fewer in dev for responsiveness
      maxThreads: process.env.CI ? undefined : 4,
      minThreads: 1,
    },
  },
}

/** @dotdo/client source path for direct imports */
export const DOTDO_CLIENT = resolve(PROJECT_ROOT, 'packages/client/src/index.ts')

/** @dotdo/zapier source path for direct imports */
export const DOTDO_ZAPIER = resolve(PROJECT_ROOT, 'packages/zapier/src/index.ts')

/** @dotdo/shared source path for direct imports */
export const DOTDO_SHARED = resolve(PROJECT_ROOT, 'packages/shared/src/index.ts')

/** @dotdo/shared/event-emitter source path for direct imports */
export const DOTDO_SHARED_EVENT_EMITTER = resolve(PROJECT_ROOT, 'packages/shared/src/event-emitter.ts')

/**
 * Shared resolve configuration for Node.js test environments
 * Provides mock for cloudflare:workers module and drizzle-orm/durable-sqlite
 */
export const nodeResolveConfig: UserConfig['resolve'] = {
  alias: {
    'cloudflare:workers': CLOUDFLARE_WORKERS_MOCK,
    'drizzle-orm/durable-sqlite': DRIZZLE_DURABLE_SQLITE_MOCK,
    '@cloudflare/sandbox': CLOUDFLARE_SANDBOX_MOCK,
    '@cloudflare/containers': CLOUDFLARE_CONTAINERS_MOCK,
    '@tanstack/db': TANSTACK_DB_MOCK,
    '@dotdo/tanstack/sync': DOTDO_TANSTACK_SYNC_MOCK,
    '@dotdo/client/adapters': DOTDO_CLIENT_ADAPTERS,
    '@dotdo/client': DOTDO_CLIENT,
    '@dotdo/zapier': DOTDO_ZAPIER,
    '@dotdo/shared/event-emitter': DOTDO_SHARED_EVENT_EMITTER,
    '@dotdo/shared': DOTDO_SHARED,
    'humans.do': HUMANS_DO,
    'fsx.do': FSX_DO,
    // capnweb mock for ESM/CJS compatibility in node tests
    capnweb: CAPNWEB_MOCK,
  },
}

/**
 * Coverage configuration
 * Only enabled when running with --coverage flag
 *
 * In CI, thresholds are enforced to maintain code quality.
 * Local development runs without threshold enforcement by default.
 */
export const coverageConfig: UserConfig['test'] = {
  coverage: {
    enabled: false, // Enable with --coverage flag
    provider: 'v8',
    reporter: ['text', 'html', 'json', 'lcov'],
    reportsDirectory: './coverage',
    // Exclude test files and mocks from coverage
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/tests/**',
      '**/tests/mocks/**',
      '**/*.d.ts',
      '**/vitest.*.ts',
      'app/**', // App has its own test setup
      // Workspace exemptions (see docs below)
      'benchmarks/**', // Benchmark code - coverage not meaningful
      'examples/**', // Example code for documentation
      'internal/**', // Internal documentation
      'docs/**', // Documentation
      'scripts/**', // Build/deploy scripts
    ],
    // Coverage thresholds enforced in CI
    // These ensure code quality doesn't regress
    thresholds: {
      statements: 70,
      branches: 65,
      functions: 70,
      lines: 70,
    },
  },
}

/**
 * Coverage workspace exemptions documentation:
 *
 * The following workspaces are EXEMPT from coverage thresholds:
 *
 * 1. benchmarks - Performance benchmarks, not business logic
 * 2. examples - Sample code for documentation purposes
 * 3. internal - Internal research/planning documents
 * 4. docs - Documentation files
 * 5. scripts - Build/deploy tooling, tested via integration
 *
 * Workspaces with coverage applied (70/65/70/70 thresholds):
 * - api, objects, lib, workflows, agents, compat packages
 * - db (iceberg, edgevec, parquet, etc.)
 * - packages/* (SDK packages)
 * - primitives (fsx, gitx, bashx, npmx, pyx)
 *
 * To check current coverage: npm run test:coverage
 * To run with threshold enforcement: CI=true npm run test:coverage
 */

/**
 * Common exclude patterns for all test workspaces
 */
export const defaultExcludes = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.git/**',
]
