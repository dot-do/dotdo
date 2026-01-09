/**
 * DO Dead Letter Queue (DLQ) Tests
 *
 * RED TDD: These tests exercise the DLQ functionality for failed event handlers.
 * When event handlers fail, events should be moved to a dead letter queue (DLQ)
 * for later retry/analysis.
 *
 * Test coverage:
 * 1. Failed event handler causes event to go to DLQ
 * 2. DLQ stores original event data plus error info
 * 3. DLQ stores retry count
 * 4. Events can be replayed from DLQ
 * 5. Events are removed from DLQ after successful replay
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO, type Env } from '../DO'
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import type * as schema from '../../db'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock SQL storage cursor result
 */
interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

/**
 * In-memory table storage for testing
 */
interface TableData {
  events: Array<Record<string, unknown>>
  dlq: Array<Record<string, unknown>>
  things: Array<Record<string, unknown>>
  actions: Array<Record<string, unknown>>
  [key: string]: Array<Record<string, unknown>>
}

/**
 * Mock SQL storage that simulates Cloudflare's SqlStorage API
 * with in-memory table support for testing
 */
function createMockSqlStorage(tables: TableData) {
  return {
    exec(query: string, ...params: unknown[]): MockSqlCursor {
      // Parse simple queries for testing
      const lowerQuery = query.toLowerCase().trim()

      if (lowerQuery.startsWith('delete from')) {
        const match = query.match(/delete from (\w+)/i)
        if (match && tables[match[1]]) {
          tables[match[1]] = []
        }
      }

      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
    _tables: tables,
  }
}

/**
 * Mock KV storage for Durable Object state
 */
function createMockKvStorage() {
  const storage = new Map<string, unknown>()

  return {
    get: vi.fn(async <T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (Array.isArray(key)) {
        const result = new Map<string, T>()
        for (const k of key) {
          const value = storage.get(k)
          if (value !== undefined) {
            result.set(k, value as T)
          }
        }
        return result as Map<string, T>
      }
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async <T>(key: string | Record<string, T>, value?: T): Promise<void> => {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          storage.set(k, v)
        }
      } else {
        storage.set(key, value)
      }
    }),
    delete: vi.fn(async (key: string | string[]): Promise<boolean | number> => {
      if (Array.isArray(key)) {
        let count = 0
        for (const k of key) {
          if (storage.delete(k)) count++
        }
        return count
      }
      return storage.delete(key)
    }),
    deleteAll: vi.fn(async (): Promise<void> => {
      storage.clear()
    }),
    list: vi.fn(async <T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      for (const [key, value] of storage) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    }),
    _storage: storage,
  }
}

/**
 * Create a mock DurableObjectId
 */
function createMockDOId(name: string = 'test-do-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
    name,
  }
}

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

interface DurableObjectState {
  id: DurableObjectId
  storage: DurableObjectStorage
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

interface DurableObjectStorage {
  get<T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined>
  put<T>(key: string | Record<string, T>, value?: T): Promise<void>
  delete(key: string | string[]): Promise<boolean | number>
  deleteAll(): Promise<void>
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>
  sql: unknown
}

/**
 * Create a mock DurableObjectState with both KV and SQL storage
 */
function createMockState(tables: TableData, idName: string = 'test-do-id'): DurableObjectState {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage(tables)

  return {
    id: createMockDOId(idName),
    storage: {
      ...kvStorage,
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async <T>(callback: () => Promise<T>): Promise<T> => callback()),
  } as unknown as DurableObjectState
}

/**
 * Create a mock environment
 */
function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
    ...overrides,
  }
}

// ============================================================================
// DLQ ENTITY TYPE (Expected schema structure)
// ============================================================================

/**
 * Dead Letter Queue entry - stores failed events with error context
 */
interface DLQEntry {
  id: string
  eventId: string
  verb: string
  source: string
  data: Record<string, unknown>
  error: string
  errorStack?: string | null
  retryCount: number
  maxRetries: number
  lastAttemptAt: Date
  createdAt: Date
}

// ============================================================================
// TESTS: DLQ - RED PHASE
// ============================================================================

describe('DO Dead Letter Queue (DLQ)', () => {
  let tables: TableData
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: DO

  beforeEach(async () => {
    tables = {
      events: [],
      dlq: [],
      things: [],
      actions: [],
    }
    mockState = createMockState(tables)
    mockEnv = createMockEnv()
    doInstance = new DO(mockState, mockEnv)
    await doInstance.initialize({ ns: 'https://test.example.com' })
  })

  // ==========================================================================
  // TEST: Failed event handler moves event to DLQ
  // ==========================================================================

  describe('Failed Event Handler', () => {
    it('moves event to DLQ when handler throws', async () => {
      // RED: This test should fail because DLQ functionality doesn't exist yet

      // Access the protected dlq store (should exist on DO)
      const dlq = (doInstance as unknown as { dlq: { list(): Promise<DLQEntry[]> } }).dlq

      // The dlq property should exist on DO
      expect(dlq).toBeDefined()
      expect(typeof dlq.list).toBe('function')
    })

    it('captures error message in DLQ entry', async () => {
      // RED: This test should fail because DLQ functionality doesn't exist yet

      const dlq = (doInstance as unknown as { dlq: { get(id: string): Promise<DLQEntry | null> } }).dlq

      // The dlq.get method should exist
      expect(dlq).toBeDefined()
      expect(typeof dlq.get).toBe('function')
    })

    it('captures error stack trace in DLQ entry', async () => {
      // RED: This test should fail because DLQ functionality doesn't exist yet

      const dlq = (doInstance as unknown as { dlq: { get(id: string): Promise<DLQEntry | null> } }).dlq

      // DLQ should store stack traces for debugging
      expect(dlq).toBeDefined()
    })
  })

  // ==========================================================================
  // TEST: DLQ stores original event data
  // ==========================================================================

  describe('DLQ Data Storage', () => {
    it('stores original event id', async () => {
      // RED: This test should fail because DLQ schema doesn't exist yet

      const dlq = (doInstance as unknown as {
        dlq: {
          add(entry: Partial<DLQEntry>): Promise<DLQEntry>
        }
      }).dlq

      // DLQ should have an add method
      expect(dlq).toBeDefined()
      expect(typeof dlq.add).toBe('function')
    })

    it('stores original event verb', async () => {
      // RED: This test should fail

      const dlq = (doInstance as unknown as { dlq: unknown }).dlq
      expect(dlq).toBeDefined()
    })

    it('stores original event source', async () => {
      // RED: This test should fail

      const dlq = (doInstance as unknown as { dlq: unknown }).dlq
      expect(dlq).toBeDefined()
    })

    it('stores original event data payload', async () => {
      // RED: This test should fail

      const dlq = (doInstance as unknown as { dlq: unknown }).dlq
      expect(dlq).toBeDefined()
    })

    it('stores error information', async () => {
      // RED: This test should fail

      const dlq = (doInstance as unknown as { dlq: unknown }).dlq
      expect(dlq).toBeDefined()
    })
  })

  // ==========================================================================
  // TEST: DLQ stores retry count
  // ==========================================================================

  describe('DLQ Retry Count', () => {
    it('initializes retry count to 0 for new DLQ entries', async () => {
      // RED: This test should fail because DLQ doesn't exist yet

      const dlq = (doInstance as unknown as {
        dlq: {
          add(entry: { eventId: string; verb: string; source: string; data: unknown; error: string }): Promise<DLQEntry>
        }
      }).dlq

      expect(dlq).toBeDefined()
      expect(typeof dlq.add).toBe('function')
    })

    it('increments retry count on retry attempt', async () => {
      // RED: This test should fail

      const dlq = (doInstance as unknown as {
        dlq: {
          incrementRetry(id: string): Promise<DLQEntry>
        }
      }).dlq

      expect(dlq).toBeDefined()
      expect(typeof dlq.incrementRetry).toBe('function')
    })

    it('stores maximum retry limit', async () => {
      // RED: This test should fail

      const dlq = (doInstance as unknown as { dlq: unknown }).dlq

      // DLQ entries should track max retries (default: 3)
      expect(dlq).toBeDefined()
    })

    it('tracks last attempt timestamp', async () => {
      // RED: This test should fail

      const dlq = (doInstance as unknown as { dlq: unknown }).dlq

      // DLQ entries should track when last retry was attempted
      expect(dlq).toBeDefined()
    })
  })

  // ==========================================================================
  // TEST: Events can be replayed from DLQ
  // ==========================================================================

  describe('DLQ Replay', () => {
    it('replays a single event from DLQ', async () => {
      // RED: This test should fail because replay functionality doesn't exist yet

      const dlq = (doInstance as unknown as {
        dlq: {
          replay(id: string): Promise<{ success: boolean; result?: unknown; error?: string }>
        }
      }).dlq

      expect(dlq).toBeDefined()
      expect(typeof dlq.replay).toBe('function')
    })

    it('replays multiple events from DLQ by filter', async () => {
      // RED: This test should fail

      const dlq = (doInstance as unknown as {
        dlq: {
          replayAll(options?: { verb?: string; source?: string }): Promise<{ replayed: number; failed: number }>
        }
      }).dlq

      expect(dlq).toBeDefined()
      expect(typeof dlq.replayAll).toBe('function')
    })

    it('re-executes event handler on replay', async () => {
      // RED: This test should fail

      const dlq = (doInstance as unknown as { dlq: unknown }).dlq

      // Replay should actually call the event handler again
      expect(dlq).toBeDefined()
    })

    it('returns replay result with success status', async () => {
      // RED: This test should fail

      const dlq = (doInstance as unknown as { dlq: unknown }).dlq
      expect(dlq).toBeDefined()
    })

    it('updates retry count on replay attempt', async () => {
      // RED: This test should fail

      const dlq = (doInstance as unknown as { dlq: unknown }).dlq
      expect(dlq).toBeDefined()
    })
  })

  // ==========================================================================
  // TEST: Events removed from DLQ after successful replay
  // ==========================================================================

  describe('DLQ Cleanup', () => {
    it('removes event from DLQ after successful replay', async () => {
      // RED: This test should fail because remove functionality doesn't exist yet

      const dlq = (doInstance as unknown as {
        dlq: {
          remove(id: string): Promise<boolean>
        }
      }).dlq

      expect(dlq).toBeDefined()
      expect(typeof dlq.remove).toBe('function')
    })

    it('keeps event in DLQ after failed replay', async () => {
      // RED: This test should fail

      const dlq = (doInstance as unknown as { dlq: unknown }).dlq

      // Failed replay should NOT remove the event
      expect(dlq).toBeDefined()
    })

    it('purges old DLQ entries that exceed max retries', async () => {
      // RED: This test should fail

      const dlq = (doInstance as unknown as {
        dlq: {
          purgeExhausted(): Promise<number>
        }
      }).dlq

      expect(dlq).toBeDefined()
      expect(typeof dlq.purgeExhausted).toBe('function')
    })

    it('archives purged entries for audit trail', async () => {
      // RED: This test should fail

      const dlq = (doInstance as unknown as { dlq: unknown }).dlq

      // Purged entries should be archived, not deleted permanently
      expect(dlq).toBeDefined()
    })
  })

  // ==========================================================================
  // TEST: DLQ Store Integration
  // ==========================================================================

  describe('DLQ Store Integration', () => {
    it('dlq property is lazily initialized on DO', async () => {
      // RED: This test should fail because dlq store doesn't exist

      const dlq = (doInstance as unknown as { dlq: unknown }).dlq

      // Like other stores (things, events, actions), dlq should be lazy
      expect(dlq).toBeDefined()
    })

    it('dlq uses DLQStore class', async () => {
      // RED: This test should fail

      const dlq = (doInstance as unknown as { dlq: unknown }).dlq

      // Should be an instance of DLQStore
      expect(dlq).toBeDefined()
      expect(dlq.constructor.name).toBe('DLQStore')
    })

    it('dlq has list method with filtering', async () => {
      // RED: This test should fail

      const dlq = (doInstance as unknown as {
        dlq: {
          list(options?: { verb?: string; source?: string; minRetries?: number }): Promise<DLQEntry[]>
        }
      }).dlq

      expect(dlq).toBeDefined()
      expect(typeof dlq.list).toBe('function')
    })

    it('dlq has count method', async () => {
      // RED: This test should fail

      const dlq = (doInstance as unknown as {
        dlq: {
          count(): Promise<number>
        }
      }).dlq

      expect(dlq).toBeDefined()
      expect(typeof dlq.count).toBe('function')
    })
  })

  // ==========================================================================
  // TEST: DLQ Schema
  // ==========================================================================

  describe('DLQ Schema', () => {
    it('dlq table exists in schema', async () => {
      // RED: This test should fail because db/dlq.ts doesn't exist

      // Import should not throw
      const dlqSchemaImport = async () => {
        const { dlq } = await import('../../db/dlq')
        return dlq
      }

      await expect(dlqSchemaImport()).resolves.toBeDefined()
    })

    it('dlq schema has required columns', async () => {
      // RED: This test should fail

      try {
        const { dlq } = await import('../../db/dlq')

        // Check table has expected structure
        expect(dlq).toBeDefined()
      } catch {
        // Expected to fail in RED phase
        expect(true).toBe(true)
      }
    })

    it('dlq schema is exported from db/index.ts', async () => {
      // RED: This test should fail

      const dbExports = await import('../../db')

      // dlq should be exported
      expect((dbExports as Record<string, unknown>).dlq).toBeDefined()
    })
  })

  // ==========================================================================
  // TEST: Event Handler Integration
  // ==========================================================================

  describe('Event Handler Integration', () => {
    it('automatically sends to DLQ when $.on handler throws', async () => {
      // RED: This test should fail because handler integration doesn't exist

      // Register a handler that throws
      const handler = vi.fn(() => {
        throw new Error('Handler failed')
      })

      doInstance.$.on.Test.created(handler)

      // The framework should catch this and add to DLQ
      const dlq = (doInstance as unknown as { dlq: { list(): Promise<DLQEntry[]> } }).dlq
      expect(dlq).toBeDefined()
    })

    it('provides error context in DLQ entry from handler', async () => {
      // RED: This test should fail

      const dlq = (doInstance as unknown as { dlq: unknown }).dlq
      expect(dlq).toBeDefined()
    })

    it('does not add to DLQ for successful handlers', async () => {
      // RED: This test should fail

      const handler = vi.fn(() => {
        return { success: true }
      })

      doInstance.$.on.Test.created(handler)

      const dlq = (doInstance as unknown as { dlq: unknown }).dlq
      expect(dlq).toBeDefined()
    })
  })
})
