/**
 * Vitest Configuration for REST CRUD Example Tests
 *
 * Uses @cloudflare/vitest-pool-workers to run tests with real Durable Objects.
 * NO MOCKS - uses real miniflare instances per CLAUDE.md guidelines.
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import { resolve } from 'path'

// Project root for resolving aliases (two levels up from examples/rest-crud)
const root = resolve(__dirname, '../..')

// Workspace aliases for package resolution
const workspaceAliases = {
  '@dotdo/test-utils/helpers': resolve(root, 'test-utils/helpers.ts'),
  '@dotdo/test-utils/factories': resolve(root, 'test-utils/factories.ts'),
  '@dotdo/test-utils/assertions': resolve(root, 'test-utils/assertions.ts'),
  '@dotdo/test-utils/miniflare': resolve(root, 'test-utils/miniflare.ts'),
  '@dotdo/test-utils': resolve(root, 'test-utils/index.ts'),
  '@dotdo/utils/proxy': resolve(root, 'utils/proxy.ts'),
  '@dotdo/utils/logger': resolve(root, 'utils/logger.ts'),
  '@dotdo/utils': resolve(root, 'utils/index.ts'),
  '@dotdo/do': resolve(root, 'do/index.ts'),
  '@dotdo/db': resolve(root, 'db/index.ts'),
  '@dotdo/rpc': resolve(root, 'rpc/index.ts'),
  '@dotdo/api': resolve(root, 'api/index.ts'),
  '@dotdo/auth': resolve(root, 'auth/index.ts'),
  '@dotdo/mcp': resolve(root, 'mcp/index.ts'),
  '@dotdo/ai': resolve(root, 'ai/index.ts'),
  '@dotdo/observability': resolve(root, 'observability/index.ts'),
  '@dotdo/integrations/stripe': resolve(root, 'integrations/stripe/index.ts'),
  '@dotdo/integrations/sendgrid': resolve(root, 'integrations/sendgrid/index.ts'),
  '@dotdo/integrations/redis': resolve(root, 'integrations/redis/index.ts'),
  '@dotdo/integrations/s3': resolve(root, 'integrations/s3/index.ts'),
  '@dotdo/integrations/twilio': resolve(root, 'integrations/twilio/index.ts'),
  '@dotdo/integrations': resolve(root, 'integrations/index.ts'),
  '@dotdo/finance': resolve(root, 'business/finance/index.ts'),
  '@dotdo/business': resolve(root, 'business/index.ts'),
  'dotdo': resolve(root, 'dotdo/index.ts'),
}

export default defineWorkersConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**'],

    // Limit concurrency - workers pool is memory-intensive
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.jsonc',
        },
        singleWorker: true,
        isolatedStorage: false,
        miniflare: {
          durableObjectsPersist: false,
          bindings: {
            TEST_MODE: 'true',
          },
        },
      },
    },

    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
