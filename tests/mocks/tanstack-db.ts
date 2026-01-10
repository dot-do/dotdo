/**
 * Mock for @tanstack/db module
 *
 * This stub provides the basic interface for TanStack DB.
 * Tests can override this with vi.mock() for specific test behavior.
 */

export interface DbInstance {
  query: (...args: unknown[]) => unknown
  exec: (...args: unknown[]) => unknown
  transaction: (...args: unknown[]) => unknown
  close: () => void
}

/**
 * Creates a mock database instance
 */
export function createDb(): DbInstance {
  return {
    query: () => {},
    exec: () => {},
    transaction: () => {},
    close: () => {},
  }
}
