import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    globals: true,
    watch: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    passWithNoTests: true,
    include: ['tests/**/*.test.ts', 'src/db/tests/**/*.test.ts', 'src/do/commands/**/*.test.ts', 'src/remote/**/*.test.ts'],
    exclude: [
      'node_modules',
      'dist',
      // Node.js-specific tests that use child_process, fs, os
      'tests/safety-gate.test.ts',
      'tests/mcp/bash-tool.test.ts',
      'tests/sdk-client.test.ts',
      'tests/tree-sitter-integration.test.ts',
      'tests/undo-tracking.test.ts',
      // POSIX compliance tests require real shell execution
      'tests/posix/**/*.test.ts',
      // Core package tests require Node.js file system access
      'test/**/*.test.ts',
      // Pack file tests use Node.js crypto/binary handling
      'src/remote/pack-generator.test.ts',
      'src/remote/pack-parser.test.ts',
      'src/remote/pack-streaming.test.ts',
      // MSW tests use BroadcastChannel which isn't available in Workers
      'src/remote/errors.test.ts',
      'src/remote/http-client.test.ts',
      'src/remote/protocol-v2.test.ts',
      // Pipeline executor tests (run in Node.js)
      'tests/do/pipeline/**/*.test.ts',
    ],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.test.toml' },
      },
    },
  },
})
