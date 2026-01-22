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
beforeEach(async (context) => {
  // Clear any mocks from previous tests
  vi.clearAllMocks();

  // Reset any module state if needed
  vi.resetModules();
});

/**
 * After each test - runs after every individual test
 */
afterEach(async (context) => {
  // Clean up any lingering timers
  vi.useRealTimers();

  // Clear any remaining mocks
  vi.restoreAllMocks();
});

/**
 * Utility function to wait for a condition
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
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`waitFor timed out after ${timeout}ms`);
}

/**
 * Utility function to measure execution time
 */
export async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

/**
 * Utility function to retry an async operation
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; delayMs?: number; shouldRetry?: (error: Error) => boolean } = {}
): Promise<T> {
  const { maxAttempts = 3, delayMs = 1000, shouldRetry = () => true } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxAttempts || !shouldRetry(lastError)) {
        throw lastError;
      }

      console.log(`Attempt ${attempt} failed, retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

/**
 * Utility to create a mock chdb instance for unit testing
 */
export function createMockChdbInstance() {
  return {
    query: vi.fn().mockResolvedValue('{"data":[],"meta":[],"rows":0}'),
    queryStream: vi.fn().mockImplementation(async function* () {
      yield '{}';
    }),
    getMemoryStats: vi.fn().mockReturnValue({
      used: 1024 * 1024,
      peak: 2 * 1024 * 1024,
      limit: 64 * 1024 * 1024,
    }),
    clearCache: vi.fn(),
    dispose: vi.fn(),
    disposed: false,
  };
}

/**
 * Utility to parse JSON safely with error context
 */
export function parseJSON<T = unknown>(jsonString: string, context?: string): T {
  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    const preview = jsonString.slice(0, 100);
    throw new Error(
      `Failed to parse JSON${context ? ` (${context})` : ''}: ${error instanceof Error ? error.message : String(error)}\nPreview: ${preview}...`
    );
  }
}

/**
 * Utility to compare floating point numbers with tolerance
 */
export function floatEquals(a: number, b: number, tolerance = 0.0001): boolean {
  return Math.abs(a - b) < tolerance;
}

/**
 * Utility to generate test data
 */
export function generateTestData(rows: number, columns: string[]): string {
  const data = [];
  for (let i = 0; i < rows; i++) {
    const row: Record<string, unknown> = {};
    for (const col of columns) {
      if (col.includes('int') || col.includes('id')) {
        row[col] = i + 1;
      } else if (col.includes('float') || col.includes('price')) {
        row[col] = (i + 1) * 1.5;
      } else if (col.includes('bool')) {
        row[col] = i % 2 === 0;
      } else {
        row[col] = `value_${i + 1}`;
      }
    }
    data.push(row);
  }
  return JSON.stringify({ data, meta: columns.map(c => ({ name: c })), rows });
}

/**
 * Memory tracking utility for leak detection
 */
export class MemoryTracker {
  private snapshots: Array<{ label: string; usage: NodeJS.MemoryUsage; timestamp: number }> = [];

  snapshot(label: string): void {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      this.snapshots.push({
        label,
        usage: process.memoryUsage(),
        timestamp: Date.now(),
      });
    }
  }

  getReport(): string {
    if (this.snapshots.length === 0) {
      return 'No memory snapshots recorded';
    }

    const lines = ['Memory Usage Report:', ''];

    for (let i = 0; i < this.snapshots.length; i++) {
      const snap = this.snapshots[i];
      const heapUsedMB = (snap.usage.heapUsed / 1024 / 1024).toFixed(2);
      const heapTotalMB = (snap.usage.heapTotal / 1024 / 1024).toFixed(2);

      lines.push(`[${snap.label}] Heap: ${heapUsedMB}MB / ${heapTotalMB}MB`);

      if (i > 0) {
        const prev = this.snapshots[i - 1];
        const delta = snap.usage.heapUsed - prev.usage.heapUsed;
        const deltaMB = (delta / 1024 / 1024).toFixed(2);
        const sign = delta >= 0 ? '+' : '';
        lines.push(`  Delta from previous: ${sign}${deltaMB}MB`);
      }
    }

    return lines.join('\n');
  }

  clear(): void {
    this.snapshots = [];
  }
}

/**
 * Export test utilities
 */
export const testUtils = {
  waitFor,
  measureTime,
  retry,
  createMockChdbInstance,
  parseJSON,
  floatEquals,
  generateTestData,
  MemoryTracker,
};

// Log that setup is complete
console.log('Test setup loaded successfully');
