/**
 * E2E Test Setup
 *
 * This file sets up the test environment for E2E tests.
 * It handles:
 * - Starting the worker via wrangler unstable_dev
 * - Providing the worker URL to tests
 * - Cleanup after tests complete
 */

import { beforeAll, afterAll } from 'vitest';
import type { UnstableDevWorker } from 'wrangler';

/**
 * Global worker instance shared across all E2E tests
 */
let worker: UnstableDevWorker | null = null;

/**
 * Base URL for the running worker
 */
export let workerUrl: string = '';

/**
 * Get the worker URL for making HTTP requests
 */
export function getWorkerUrl(): string {
  if (!workerUrl) {
    throw new Error('Worker not started. E2E tests must run after setup.');
  }
  return workerUrl;
}

/**
 * Start the worker before all tests
 */
beforeAll(async () => {
  console.log('\n========================================');
  console.log('  E2E Test Suite - Starting Worker');
  console.log('========================================\n');

  try {
    // Dynamic import to avoid issues when wrangler is not available
    const { unstable_dev } = await import('wrangler');

    // Start the worker using unstable_dev
    worker = await unstable_dev('src/worker.ts', {
      // Use the test-specific wrangler config (no assets required)
      config: 'tests/e2e/wrangler.test.toml',
      // Run in local mode (no internet required)
      local: true,
      // Don't persist data between runs
      persist: false,
      // Don't open browser
      experimental: {
        disableExperimentalWarning: true,
      },
    });

    // Get the worker URL
    const address = worker.address;
    const port = worker.port;
    workerUrl = `http://${address}:${port}`;

    console.log(`Worker started at: ${workerUrl}`);
    console.log('----------------------------------------\n');
  } catch (error) {
    console.error('Failed to start worker:', error);
    throw error;
  }
}, 60000); // 60 second timeout for worker startup

/**
 * Stop the worker after all tests
 */
afterAll(async () => {
  console.log('\n----------------------------------------');
  console.log('  Stopping Worker');

  if (worker) {
    try {
      await worker.stop();
      console.log('  Worker stopped successfully');
    } catch (error) {
      console.error('  Failed to stop worker:', error);
    }
    worker = null;
  }

  console.log('========================================\n');
}, 30000); // 30 second timeout for cleanup
