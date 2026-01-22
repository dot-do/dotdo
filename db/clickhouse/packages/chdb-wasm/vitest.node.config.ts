/**
 * Vitest Configuration for Node.js-only Tests
 *
 * =============================================================================
 * TEST ENVIRONMENT: Node.js
 * =============================================================================
 *
 * This config is for tests that CANNOT run in workerd and require Node.js APIs.
 * Use this sparingly - prefer running tests in workerd for production parity.
 *
 * Valid use cases:
 * - Static analysis tests that read source files with Node.js fs
 * - Tests that analyze build artifacts
 * - Tests that need full Node.js compatibility
 *
 * Command: pnpm test:node
 *
 * NOTE: Most tests should run in workerd (see vitest.config.ts).
 * Only add tests here if they truly cannot run in workerd.
 */
import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Include ONLY tests that require Node.js fs
    // Currently empty - all tests have been rewritten to run in workerd
    // This config is kept for future tests that truly cannot run in workerd
    include: [
      // No tests currently require Node.js - all run in workerd
    ],

    // Enable globals for describe, it, expect
    globals: true,

    // Timeout for async operations
    testTimeout: 30000,

    // Hook timeout for beforeAll/afterAll
    hookTimeout: 30000,

    // Use node environment
    environment: 'node',
  },

  // Resolve configuration
  resolve: {
    alias: {
      '@dotdo/chdb-wasm': path.resolve(__dirname, './src/index.ts'),
    },
  },

  // ESBuild options
  esbuild: {
    target: 'esnext',
  },
});
