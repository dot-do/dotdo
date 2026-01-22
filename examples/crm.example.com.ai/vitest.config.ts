/**
 * Vitest Configuration for CRM Tenant DO Tests
 *
 * This configuration uses @cloudflare/vitest-pool-workers to run tests
 * inside the Cloudflare Workers runtime with real Durable Objects.
 *
 * These tests define the expected behavior for hierarchical tenant DOs
 * in the crm.example.com.ai domain. Tests are expected to FAIL until
 * the $Context function and tenant DO architecture are implemented.
 *
 * Usage:
 *   npx vitest run --config examples/crm.example.com.ai/vitest.config.ts
 *
 * @module examples/crm.example.com.ai/vitest.config
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import { resolve } from 'path'

// Project root for resolving aliases
const root = resolve(__dirname, '../..')

// Shared workspace aliases (copy from root config)
const workspaceAliases = {
  '@dotdo/test-utils/helpers': resolve(root, 'tests/utils/helpers.ts'),
  '@dotdo/test-utils/factories': resolve(root, 'tests/utils/factories.ts'),
  '@dotdo/test-utils/assertions': resolve(root, 'tests/utils/assertions.ts'),
  '@dotdo/test-utils/miniflare': resolve(root, 'tests/utils/miniflare.ts'),
  '@dotdo/test-utils': resolve(root, 'tests/utils/index.ts'),
  '@dotdo/utils/proxy': resolve(root, 'utils/proxy.ts'),
  '@dotdo/utils/logger': resolve(root, 'utils/logger.ts'),
  '@dotdo/utils/cookies': resolve(root, 'utils/cookies.ts'),
  '@dotdo/utils/circuit-breaker': resolve(root, 'utils/circuit-breaker.ts'),
  '@dotdo/utils': resolve(root, 'utils/index.ts'),
  '@dotdo/do': resolve(root, 'do/index.ts'),
  '@dotdo/db': resolve(root, 'db/index.ts'),
  '@dotdo/rpc/do-signing': resolve(root, 'rpc/do-signing.ts'),
  '@dotdo/rpc': resolve(root, 'rpc/index.ts'),
  '@dotdo/api': resolve(root, 'api/index.ts'),
  '@dotdo/auth': resolve(root, 'auth/index.ts'),
  '@dotdo/mcp': resolve(root, 'mcp/index.ts'),
  '@dotdo/ai': resolve(root, 'ai/index.ts'),
  '@dotdo/app': resolve(root, 'app/index.ts'),
  '@dotdo/testing': resolve(root, 'testing/index.ts'),
  '@dotdo/fsx': resolve(root, 'fsx/index.ts'),
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
  // Set root to this example directory
  root: __dirname,
  test: {
    name: 'crm-tenant-do',
    globals: true,

    // Only include tests from this example directory
    include: ['./tests/**/*.test.ts'],

    exclude: ['**/node_modules/**'],

    // CRITICAL: Limit concurrency to prevent resource exhaustion
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    poolOptions: {
      workers: {
        // Use root wrangler config for DO bindings
        wrangler: {
          configPath: resolve(root, 'wrangler.jsonc'),
        },
        singleWorker: true,
        isolatedStorage: false,
        miniflare: {
          durableObjectsPersist: false,
          unsafeEvalBinding: 'UNSAFE_EVAL',
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
