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

/** drizzle-orm/durable-sqlite mock path */
export const DRIZZLE_DURABLE_SQLITE_MOCK = resolve(PROJECT_ROOT, 'tests/mocks/drizzle-durable-sqlite.ts')

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

/**
 * Shared resolve configuration for Node.js test environments
 * Provides mock for cloudflare:workers module and drizzle-orm/durable-sqlite
 */
export const nodeResolveConfig: UserConfig['resolve'] = {
  alias: {
    'cloudflare:workers': CLOUDFLARE_WORKERS_MOCK,
    'drizzle-orm/durable-sqlite': DRIZZLE_DURABLE_SQLITE_MOCK,
  },
}

/**
 * Coverage configuration
 * Only enabled when running with --coverage flag
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
      '**/tests/**',
      '**/tests/mocks/**',
      '**/*.d.ts',
      '**/vitest.*.ts',
      'app/**', // App has its own test setup
    ],
    // Coverage thresholds (can be enabled for CI)
    thresholds: {
      // Uncomment to enforce coverage thresholds:
      // statements: 80,
      // branches: 80,
      // functions: 80,
      // lines: 80,
    },
  },
}

/**
 * Common exclude patterns for all test workspaces
 */
export const defaultExcludes = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.git/**',
]
