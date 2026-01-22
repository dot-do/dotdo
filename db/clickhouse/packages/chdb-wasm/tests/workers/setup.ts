/**
 * Workers Runtime Test Setup
 *
 * This setup file is for tests that run in the actual Cloudflare Workers
 * runtime (workerd) via @cloudflare/vitest-pool-workers.
 *
 * These tests have access to real Workers APIs:
 * - cloudflare:test module for test utilities
 * - env bindings (R2, KV, DO, etc.)
 * - SELF binding to make requests to the worker
 * - fetchMock for mocking outbound requests
 */

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

/**
 * Global test configuration for Workers runtime
 */
declare global {
  // eslint-disable-next-line no-var
  var __WORKERS_TEST_START_TIME__: number;
}

globalThis.__WORKERS_TEST_START_TIME__ = Date.now();

/**
 * Before all tests in Workers runtime
 */
beforeAll(async () => {
  console.log('\n========================================');
  console.log('  Workers Runtime Test Suite');
  console.log('  Running in workerd (miniflare)');
  console.log('========================================');
  console.log(`  Started at: ${new Date().toISOString()}`);
  console.log('----------------------------------------\n');
});

/**
 * After all tests in Workers runtime
 */
afterAll(async () => {
  const duration = Date.now() - globalThis.__WORKERS_TEST_START_TIME__;
  const durationSec = (duration / 1000).toFixed(2);

  console.log('\n----------------------------------------');
  console.log(`  Workers tests completed in ${durationSec}s`);
  console.log(`  Finished at: ${new Date().toISOString()}`);
  console.log('========================================\n');
});

/**
 * Before each test
 */
beforeEach(async () => {
  // Tests run in isolated storage by default
});

/**
 * After each test
 */
afterEach(async () => {
  // Cleanup is automatic with isolatedStorage: true
});

/**
 * Helper to format bytes for display
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Helper to measure async operation timing
 */
export async function measureTime<T>(
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

/**
 * Helper to wait for a condition
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`waitFor timed out after ${timeout}ms`);
}
