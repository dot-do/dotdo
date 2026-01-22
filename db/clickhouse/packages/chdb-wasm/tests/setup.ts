/**
 * Test Setup and Teardown for chdb WASM Tests
 *
 * This file is automatically loaded before all tests run.
 * It handles:
 * - Global test configuration
 * - Environment setup for WASM testing
 * - Shared fixtures and utilities
 * - Cleanup hooks
 */

import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

/**
 * Global test configuration
 */
declare global {
  // eslint-disable-next-line no-var
  var __TEST_START_TIME__: number;
  // eslint-disable-next-line no-var
  var __WASM_INITIALIZED__: boolean;
}

/**
 * Track test execution time
 */
globalThis.__TEST_START_TIME__ = Date.now();
globalThis.__WASM_INITIALIZED__ = false;

/**
 * Increase Node.js memory limit for WASM tests
 */
if (typeof process !== 'undefined') {
  // Set up environment variables for testing
  process.env.NODE_ENV = 'test';

  // Increase max listeners to avoid warnings with many concurrent tests
  if (process.setMaxListeners) {
    process.setMaxListeners(50);
  }
}

/**
 * Global setup - runs once before all tests
 */
beforeAll(async () => {
  console.log('\n========================================');
  console.log('  chdb WASM Test Suite');
  console.log('========================================');
  console.log(`  Started at: ${new Date().toISOString()}`);
  console.log('----------------------------------------\n');

  // Allow time for any async module loading
  await new Promise(resolve => setTimeout(resolve, 100));
});

/**
 * Global teardown - runs once after all tests
 */
afterAll(async () => {
  const duration = Date.now() - globalThis.__TEST_START_TIME__;
  const durationSec = (duration / 1000).toFixed(2);

  console.log('\n----------------------------------------');
  console.log(`  Tests completed in ${durationSec}s`);
  console.log(`  Finished at: ${new Date().toISOString()}`);
  console.log('========================================\n');

  // Force garbage collection if available (V8 with --expose-gc flag)
  if (typeof global !== 'undefined' && typeof (global as Record<string, unknown>).gc === 'function') {
    (global as Record<string, unknown>).gc();
  }
});

/**
 * Before each test - runs before every individual test
 */
beforeEach(async () => {
  // Clear any mocks from previous tests
  vi.clearAllMocks();

  // Reset any module state if needed
  vi.resetModules();
});

/**
 * After each test - runs after every individual test
 */
afterEach(async () => {
  // Clean up any lingering timers
  vi.useRealTimers();

  // Clear any remaining mocks
  vi.restoreAllMocks();
});

// Log that setup is complete
console.log('Test setup loaded successfully');
