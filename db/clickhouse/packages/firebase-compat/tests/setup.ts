/**
 * Test setup for @chdb/firebase-compat
 *
 * This file contains common test utilities and setup for all test files.
 */

import { beforeEach, afterEach } from 'vitest';

// Reset any global state between tests
beforeEach(() => {
  // Clear any cached app instances
});

afterEach(() => {
  // Cleanup after each test
});

/**
 * Test helper to create a mock ClickHouse/chdb backend
 */
export interface MockBackend {
  query: (sql: string) => Promise<unknown>;
  execute: (sql: string) => Promise<void>;
}

export function createMockBackend(): MockBackend {
  return {
    query: async (_sql: string) => {
      throw new Error('MockBackend.query not implemented');
    },
    execute: async (_sql: string) => {
      throw new Error('MockBackend.execute not implemented');
    },
  };
}
