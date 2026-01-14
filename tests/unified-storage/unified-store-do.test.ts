/**
 * RED Phase Tests for UnifiedStoreDO Integration
 *
 * Tests for the unified storage DO that integrates:
 * - InMemoryStateManager: Fast reads from memory
 * - PipelineEmitter: Durable writes to Pipeline (WAL)
 * - LazyCheckpointer: Batched SQLite persistence
 * - ColdStartRecovery: Startup state loading
 *
 * KEY INVARIANT: Pipeline is the WAL. Events are durable in Pipeline
 * BEFORE local SQLite persistence. This guarantees zero data loss.
 *
 * These tests will FAIL until the implementation is created.
 *
 * @see docs/architecture/unified-storage.md
 * @module tests/unified-storage/unified-store-do.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// Import implementation and types
// ============================================================================
import { UnifiedStoreDO } from '../../objects/unified-storage/unified-store-do'
import type {
  UnifiedStoreConfig,
  InMemoryStateManager,
  PipelineEmitter,
  LazyCheckpointer,
  ColdStartRecovery,
  Thing,
  DomainEvent,
} from '../../objects/unified-storage/unified-store-do'

// ============================================================================
// Mock Infrastructure
// ============================================================================

/**
 * Mock Pipeline binding for testing durable event emission
 */
interface MockPipeline {
  events: DomainEvent[]
  send(events: DomainEvent[]): void
  clear(): void
}

function createMockPipeline(): MockPipeline {
  return {
    events: [],
    send(events: DomainEvent[]) {
      this.events.push(...events)
    },
    clear() {
      this.events = []
    },
  }
}

/**
 * Mock SQLite storage for testing lazy checkpointing
 */
interface MockSQLiteStorage {
  collections: Map<string, string>
  things: Map<string, string>
  columnarStore: Map<string, string>
  normalizedStore: Map<string, string>
  exec: ReturnType<typeof vi.fn>
  toArray: () => Array<Record<string, unknown>>
}

function createMockSQLiteStorage(): MockSQLiteStorage {
  const collections = new Map<string, string>()
  const things = new Map<string, string>()
  const columnarStore = new Map<string, string>()
  const normalizedStore = new Map<string, string>()

  return {
    collections,
    things,
    columnarStore,
    normalizedStore,
    exec: vi.fn((sql: string, ...args: unknown[]) => {
      // Parse SQL to determine operation
      // Handle columnar_store (used by LazyCheckpointer)
      if (sql.includes('INSERT') && sql.includes('columnar_store')) {
        columnarStore.set(args[0] as string, args[1] as string)
        // Also mirror to collections for ColdStartRecovery
        collections.set(args[0] as string, args[1] as string)
      } else if (sql.includes('INSERT') && sql.includes('normalized_store')) {
        // normalized_store: (type, id, data)
        const key = `${args[0]}:${args[1]}`
        normalizedStore.set(key, args[2] as string)
        // Also add to things for ColdStartRecovery
        things.set(args[1] as string, args[2] as string)
      }
      // Legacy table names
      else if (sql.includes('INSERT') && sql.includes('collections')) {
        collections.set(args[0] as string, args[1] as string)
      } else if (sql.includes('INSERT') && sql.includes('things')) {
        things.set(args[0] as string, args[2] as string)
      }
      // SELECT operations for ColdStartRecovery
      else if (sql.includes('SELECT') && sql.includes('collections')) {
        return {
          toArray: () =>
            Array.from(collections.entries()).map(([type, data]) => ({ type, data })),
        }
      } else if (sql.includes('SELECT') && sql.includes('things')) {
        return {
          toArray: () =>
            Array.from(things.entries()).map(([id, data]) => ({ id, type: 'Thing', data })),
        }
      }
      return { toArray: () => [] }
    }),
    toArray: () => [],
  }
}

/**
 * Mock DurableObjectState with SQLite storage
 */
interface MockDOState {
  id: { toString: () => string; name?: string }
  storage: {
    sql: MockSQLiteStorage
    get: ReturnType<typeof vi.fn>
    put: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
  }
  waitUntil: ReturnType<typeof vi.fn>
  blockConcurrencyWhile: ReturnType<typeof vi.fn>
  acceptWebSocket: ReturnType<typeof vi.fn>
  getWebSockets: ReturnType<typeof vi.fn>
}

function createMockDOState(name: string = 'test-unified'): MockDOState {
  const kvStorage = new Map<string, unknown>()
  const sqlStorage = createMockSQLiteStorage()

  return {
    id: {
      toString: () => `unified-do-${name}`,
      name,
    },
    storage: {
      sql: sqlStorage,
      get: vi.fn(async <T>(key: string) => kvStorage.get(key) as T),
      put: vi.fn(async (key: string, value: unknown) => {
        kvStorage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => kvStorage.delete(key)),
      list: vi.fn(async (opts?: { prefix?: string }) => {
        const prefix = opts?.prefix ?? ''
        const result = new Map<string, unknown>()
        for (const [k, v] of kvStorage) {
          if (k.startsWith(prefix)) {
            result.set(k, v)
          }
        }
        return result
      }),
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async <T>(fn: () => Promise<T>) => fn()),
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => []),
  }
}

/**
 * Mock Environment bindings
 */
interface MockEnv {
  PIPELINE: MockPipeline
  DO: DurableObjectNamespace
}

function createMockEnv(): MockEnv {
  return {
    PIPELINE: createMockPipeline(),
    DO: {} as DurableObjectNamespace,
  }
}

/**
 * Mock WebSocket for testing client communication
 */
class MockWebSocket {
  readyState: number = 1 // OPEN
  sentMessages: string[] = []

  send(message: string): void {
    this.sentMessages.push(message)
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = 3 // CLOSED
  }

  getLastMessage<T = unknown>(): T | null {
    if (this.sentMessages.length === 0) return null
    return JSON.parse(this.sentMessages[this.sentMessages.length - 1]) as T
  }
}

/**
 * Create a Thing for testing
 */
function createTestThing(overrides: Partial<Thing> = {}): Thing {
  const now = Date.now()
  return {
    $id: overrides.$id ?? `thing_${crypto.randomUUID()}`,
    $type: overrides.$type ?? 'TestEntity',
    $version: overrides.$version ?? 1,
    $createdAt: overrides.$createdAt ?? now,
    $updatedAt: overrides.$updatedAt ?? now,
    name: 'Test Thing',
    ...overrides,
  }
}

// ============================================================================
// Write Path Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('UnifiedStoreDO Write Path', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockState = createMockDOState()
    mockEnv = createMockEnv()

    // This will fail until UnifiedStoreDO is implemented
    // UnifiedStoreDO implementation now exists
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Pipeline-First Durability', () => {
    it('should emit to pipeline BEFORE SQLite persistence', async () => {
      const ws = new MockWebSocket()

      // Perform a create operation
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      // Pipeline should have the event IMMEDIATELY
      expect(mockEnv.PIPELINE.events.length).toBe(1)
      expect(mockEnv.PIPELINE.events[0].type).toBe('thing.created')

      // SQLite should NOT have been written yet (lazy checkpoint)
      expect(mockState.storage.sql.exec).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT')
      )
    })

    it('should update in-memory state immediately', async () => {
      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Bob' },
      })

      // In-memory state should be updated immediately
      const ack = ws.getLastMessage<{ status: string; $id: string }>()
      expect(ack?.status).toBe('ack')
      expect(ack?.$id).toBeDefined()

      // Read should return the thing immediately (from memory)
      const thing = await unifiedDO.get(ack!.$id)
      expect(thing).not.toBeNull()
      expect(thing?.name).toBe('Bob')
    })

    it('should return ACK before checkpoint', async () => {
      const ws = new MockWebSocket()

      // Track when ACK is sent vs checkpoint
      const timeline: string[] = []

      // Mock the checkpoint to track timing
      const originalCheckpoint = unifiedDO.checkpoint?.bind(unifiedDO)
      if (originalCheckpoint) {
        unifiedDO.checkpoint = async (trigger: string) => {
          timeline.push(`checkpoint:${trigger}`)
          return originalCheckpoint(trigger)
        }
      }

      // Intercept send to track timing
      const originalSend = ws.send.bind(ws)
      ws.send = (message: string) => {
        timeline.push('ack')
        originalSend(message)
      }

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Charlie' },
      })

      // ACK should come first, checkpoint later (or never in same call)
      expect(timeline[0]).toBe('ack')
    })

    it('should persist to SQLite lazily on timer', async () => {
      const ws = new MockWebSocket()

      // Create multiple things
      for (let i = 0; i < 5; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'Customer',
          data: { name: `Customer ${i}` },
        })
      }

      // SQLite should NOT have writes yet
      const insertCalls = (mockState.storage.sql.exec as ReturnType<typeof vi.fn>).mock.calls
        .filter((call: unknown[]) => (call[0] as string).includes('INSERT'))
      expect(insertCalls.length).toBe(0)

      // Advance timer past checkpoint interval (default 5s) and tick
      await vi.advanceTimersByTimeAsync(5001)

      // Stop the timer to prevent infinite loop before running remaining timers
      unifiedDO.stopCheckpointTimer()

      // Verify checkpoint was called
      const insertCallsAfter = (mockState.storage.sql.exec as ReturnType<typeof vi.fn>).mock.calls
        .filter((call: unknown[]) => (call[0] as string).includes('INSERT'))
      expect(insertCallsAfter.length).toBeGreaterThan(0)
    })
  })

  describe('Event Idempotency', () => {
    it('should include idempotency key in pipeline events', async () => {
      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Order',
        data: { total: 100 },
      })

      const event = mockEnv.PIPELINE.events[0]
      expect(event.idempotencyKey).toBeDefined()
      expect(typeof event.idempotencyKey).toBe('string')
      expect(event.idempotencyKey.length).toBeGreaterThan(0)
    })

    it('should generate unique idempotency keys for each operation', async () => {
      const ws = new MockWebSocket()

      // Create two things
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Order',
        data: { total: 100 },
      })

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-2',
        $type: 'Order',
        data: { total: 200 },
      })

      const key1 = mockEnv.PIPELINE.events[0].idempotencyKey
      const key2 = mockEnv.PIPELINE.events[1].idempotencyKey

      expect(key1).not.toBe(key2)
    })
  })
})

// ============================================================================
// Read Path Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('UnifiedStoreDO Read Path', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv
  let unifiedDO: UnifiedStoreDO

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()

    // UnifiedStoreDO implementation now exists
    unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
  })

  describe('In-Memory Reads', () => {
    it('should read from in-memory state, not SQLite', async () => {
      const ws = new MockWebSocket()

      // Create a thing
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Alice' },
      })

      const ack = ws.getLastMessage<{ $id: string }>()

      // Clear SQL mock call count
      ;(mockState.storage.sql.exec as ReturnType<typeof vi.fn>).mockClear()

      // Read the thing
      const thing = await unifiedDO.get(ack!.$id)

      // Should NOT have queried SQLite
      expect(mockState.storage.sql.exec).not.toHaveBeenCalled()
      expect(thing?.name).toBe('Alice')
    })

    it('should return in O(1) time', async () => {
      const ws = new MockWebSocket()

      // Create many things to ensure we're not doing linear scans
      const ids: string[] = []
      for (let i = 0; i < 1000; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'Customer',
          data: { name: `Customer ${i}` },
        })
        const ack = ws.getLastMessage<{ $id: string }>()
        ids.push(ack!.$id)
      }

      // Time a read from the middle
      const middleId = ids[500]
      const start = performance.now()
      await unifiedDO.get(middleId)
      const duration = performance.now() - start

      // O(1) should be sub-millisecond
      expect(duration).toBeLessThan(1)
    })

    it('should include dirty entries in reads', async () => {
      const ws = new MockWebSocket()

      // Create a thing (dirty, not checkpointed)
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'Customer',
        data: { name: 'Dirty Alice' },
      })

      const ack = ws.getLastMessage<{ $id: string }>()

      // Should be readable even though not persisted
      const thing = await unifiedDO.get(ack!.$id)
      expect(thing?.name).toBe('Dirty Alice')

      // Verify dirty tracking
      const dirtyEntries = unifiedDO.getDirtyEntries?.() ?? new Set()
      expect(dirtyEntries.has(ack!.$id)).toBe(true)
    })
  })

  describe('Batch Reads', () => {
    it('should support reading multiple things at once', async () => {
      const ws = new MockWebSocket()

      // Create multiple things
      const ids: string[] = []
      for (let i = 0; i < 5; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'Customer',
          data: { name: `Customer ${i}` },
        })
        const ack = ws.getLastMessage<{ $id: string }>()
        ids.push(ack!.$id)
      }

      // Batch read
      await unifiedDO.handleRead(ws as unknown as WebSocket, {
        type: 'read',
        id: 'read-op',
        $ids: ids,
      })

      const response = ws.getLastMessage<{ things: Record<string, Thing> }>()
      expect(Object.keys(response!.things).length).toBe(5)
      expect(response!.things[ids[0]]?.name).toBe('Customer 0')
    })
  })
})

// ============================================================================
// Data Durability Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('UnifiedStoreDO Data Durability', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
  })

  describe('Zero Data Loss Guarantee', () => {
    it('should have zero data loss with pipeline-first writes', async () => {
      // UnifiedStoreDO implementation now exists
      const unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
      const ws = new MockWebSocket()

      // Create a thing
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'CriticalData',
        data: { important: true },
      })

      const ack = ws.getLastMessage<{ $id: string }>()

      // Verify pipeline has the event (durable)
      expect(mockEnv.PIPELINE.events.length).toBe(1)
      expect(mockEnv.PIPELINE.events[0].entityId).toBe(ack!.$id)

      // Even if DO crashes now (before SQLite), data is in Pipeline
      // and can be recovered from Iceberg
    })

    it('should recover state from Iceberg if SQLite is empty', async () => {
      // Start with empty SQLite
      mockState.storage.sql.collections.clear()
      mockState.storage.sql.things.clear()

      // Mock Iceberg with historical events
      const mockIcebergEvents: DomainEvent[] = [
        {
          type: 'thing.created',
          collection: 'Thing',
          operation: 'create',
          entityId: 'customer_recovered1',
          entityType: 'Customer',
          payload: { $id: 'customer_recovered1', $type: 'Customer', name: 'Recovered Alice' },
          ts: Date.now() - 1000,
          version: 1,
          actorId: 'system',
          idempotencyKey: 'customer_recovered1:create',
        },
        {
          type: 'thing.created',
          collection: 'Thing',
          operation: 'create',
          entityId: 'customer_recovered2',
          entityType: 'Customer',
          payload: { $id: 'customer_recovered2', $type: 'Customer', name: 'Recovered Bob' },
          ts: Date.now() - 500,
          version: 1,
          actorId: 'system',
          idempotencyKey: 'customer_recovered2:create',
        },
      ]

      // UnifiedStoreDO implementation now exists
      const unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)

      // Mock the Iceberg query
      ;(unifiedDO as unknown as { queryIceberg: (sql: string, params: unknown[]) => Promise<DomainEvent[]> }).queryIceberg = async () => mockIcebergEvents

      // Trigger cold start recovery
      await unifiedDO.onStart?.()

      // Should have recovered both things
      const alice = await unifiedDO.get('customer_recovered1')
      const bob = await unifiedDO.get('customer_recovered2')

      expect(alice?.name).toBe('Recovered Alice')
      expect(bob?.name).toBe('Recovered Bob')
    })

    it('should survive DO restart with no data loss', async () => {
      // Phase 1: Create DO and add data
      // UnifiedStoreDO implementation now exists
      let unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
      const ws = new MockWebSocket()

      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'PersistentData',
        data: { value: 42 },
      })

      const ack = ws.getLastMessage<{ $id: string }>()

      // Force checkpoint (simulating hibernation)
      await unifiedDO.checkpoint?.('test')

      // Phase 2: Simulate DO restart by creating new instance with same storage
      // UnifiedStoreDO implementation now exists
      unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
      await unifiedDO.onStart?.()

      // Data should still be there
      const thing = await unifiedDO.get(ack!.$id)
      expect(thing?.value).toBe(42)
    })
  })
})

// ============================================================================
// Cost Optimization Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('UnifiedStoreDO Cost Optimization', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockDOState()
    mockEnv = createMockEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('SQLite Row Write Minimization', () => {
    it('should minimize SQLite row writes using columnar storage', async () => {
      // UnifiedStoreDO implementation now exists
      const unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
      const ws = new MockWebSocket()

      // Create 100 things of the same type
      for (let i = 0; i < 100; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'SmallCollection',
          data: { index: i },
        })
      }

      // Force checkpoint
      await unifiedDO.checkpoint?.('test')

      // Should have used columnar storage (1 row for all 100 things)
      const insertCalls = (mockState.storage.sql.exec as ReturnType<typeof vi.fn>).mock.calls
        .filter((call: unknown[]) => (call[0] as string).includes('INSERT'))

      // Columnar: 1 INSERT into columnar_store table
      // Normalized: N INSERTs into normalized_store table
      // We expect columnar behavior (threshold is 1000 by default)
      const columnarInserts = insertCalls.filter(
        (call: unknown[]) => (call[0] as string).includes('columnar_store')
      )
      expect(columnarInserts.length).toBe(1)
    })

    it('should use normalized storage for large collections', async () => {
      // Configure with low columnar threshold
      const config: Partial<UnifiedStoreConfig> = {
        columnarThreshold: 10, // Anything over 10 uses normalized
      }

      // UnifiedStoreDO implementation now exists
      const unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv, config)
      const ws = new MockWebSocket()

      // Create 50 things (over threshold)
      for (let i = 0; i < 50; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'LargeCollection',
          data: { index: i },
        })
      }

      // Force checkpoint
      await unifiedDO.checkpoint?.('test')

      // Should have used normalized storage (50 rows into normalized_store)
      const insertCalls = (mockState.storage.sql.exec as ReturnType<typeof vi.fn>).mock.calls
        .filter((call: unknown[]) => (call[0] as string).includes('INSERT') && (call[0] as string).includes('normalized_store'))

      expect(insertCalls.length).toBe(50)
    })
  })

  describe('Pipeline Event Batching', () => {
    it('should batch pipeline events', async () => {
      // UnifiedStoreDO implementation now exists
      const unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
      const ws = new MockWebSocket()

      // Track pipeline send calls
      const sendCalls: DomainEvent[][] = []
      mockEnv.PIPELINE.send = vi.fn((events: DomainEvent[]) => {
        sendCalls.push(events)
      })

      // Create multiple things rapidly
      for (let i = 0; i < 10; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `op-${i}`,
          $type: 'BatchedEntity',
          data: { index: i },
        })
      }

      // With batching, we might have fewer send calls than operations
      // Or events might be batched together
      const totalEvents = sendCalls.flat().length
      expect(totalEvents).toBe(10) // All events should eventually be sent
    })
  })

  describe('Checkpoint on Hibernation', () => {
    it('should checkpoint before hibernation', async () => {
      // UnifiedStoreDO implementation now exists
      const unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
      const ws = new MockWebSocket()

      // Create a thing (dirty)
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'HibernateTest',
        data: { value: 'important' },
      })

      // Verify SQLite not written yet
      const insertsBefore = (mockState.storage.sql.exec as ReturnType<typeof vi.fn>).mock.calls
        .filter((call: unknown[]) => (call[0] as string).includes('INSERT'))
      expect(insertsBefore.length).toBe(0)

      // Trigger hibernation callback
      await unifiedDO.beforeHibernation?.()

      // Now SQLite should have been written
      const insertsAfter = (mockState.storage.sql.exec as ReturnType<typeof vi.fn>).mock.calls
        .filter((call: unknown[]) => (call[0] as string).includes('INSERT'))
      expect(insertsAfter.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Lifecycle Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('UnifiedStoreDO Lifecycle', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockDOState()
    mockEnv = createMockEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Cold Start', () => {
    it('should load state on cold start', async () => {
      // Pre-populate SQLite with existing data
      mockState.storage.sql.collections.set(
        'Customer',
        JSON.stringify([
          { $id: 'customer_1', $type: 'Customer', name: 'Existing Alice' },
          { $id: 'customer_2', $type: 'Customer', name: 'Existing Bob' },
        ])
      )

      // UnifiedStoreDO implementation now exists
      const unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)

      // onStart should be called via blockConcurrencyWhile
      await unifiedDO.onStart?.()

      // Should have loaded the data
      const alice = await unifiedDO.get('customer_1')
      const bob = await unifiedDO.get('customer_2')

      expect(alice?.name).toBe('Existing Alice')
      expect(bob?.name).toBe('Existing Bob')
    })

    it('should load from both columnar and normalized storage', async () => {
      // Columnar collection
      mockState.storage.sql.collections.set(
        'SmallType',
        JSON.stringify([{ $id: 'small_1', $type: 'SmallType', value: 1 }])
      )

      // Normalized things
      mockState.storage.sql.things.set(
        'big_1',
        JSON.stringify({ $id: 'big_1', $type: 'BigType', value: 100 })
      )

      // UnifiedStoreDO implementation now exists
      const unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
      await unifiedDO.onStart?.()

      const small = await unifiedDO.get('small_1')
      const big = await unifiedDO.get('big_1')

      expect(small?.value).toBe(1)
      expect(big?.value).toBe(100)
    })
  })

  describe('Hibernation', () => {
    it('should checkpoint before hibernation', async () => {
      // UnifiedStoreDO implementation now exists
      const unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
      const ws = new MockWebSocket()

      // Create dirty data
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'op-1',
        $type: 'HibernateData',
        data: { mustPersist: true },
      })

      // Track checkpoint
      let checkpointCalled = false
      const originalCheckpoint = unifiedDO.checkpoint?.bind(unifiedDO)
      if (originalCheckpoint) {
        unifiedDO.checkpoint = async (trigger: string) => {
          checkpointCalled = true
          expect(trigger).toBe('hibernation')
          return originalCheckpoint(trigger)
        }
      }

      await unifiedDO.beforeHibernation?.()

      expect(checkpointCalled).toBe(true)
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle concurrent operations safely', async () => {
      // UnifiedStoreDO implementation now exists
      const unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
      const ws = new MockWebSocket()

      // Simulate concurrent creates
      const operations = Array(100)
        .fill(null)
        .map((_, i) =>
          unifiedDO.handleCreate(ws as unknown as WebSocket, {
            type: 'create',
            id: `op-${i}`,
            $type: 'ConcurrentEntity',
            data: { index: i },
          })
        )

      await Promise.all(operations)

      // All operations should succeed
      const messages = ws.sentMessages.map((m) => JSON.parse(m))
      const acks = messages.filter((m: { status: string }) => m.status === 'ack')
      expect(acks.length).toBe(100)

      // All things should be in memory
      const ids = acks.map((a: { $id: string }) => a.$id)
      for (const id of ids) {
        const thing = await unifiedDO.get(id)
        expect(thing).not.toBeNull()
      }
    })

    it('should handle concurrent reads and writes', async () => {
      // UnifiedStoreDO implementation now exists
      const unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
      const ws = new MockWebSocket()

      // Create some initial data
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'setup',
        $type: 'MixedOps',
        data: { counter: 0 },
      })

      const setupAck = ws.getLastMessage<{ $id: string }>()
      const entityId = setupAck!.$id

      // Mixed concurrent operations
      const operations = Array(50)
        .fill(null)
        .map((_, i) => {
          if (i % 2 === 0) {
            // Read
            return unifiedDO.get(entityId)
          } else {
            // Update
            return unifiedDO.handleUpdate(ws as unknown as WebSocket, {
              type: 'update',
              id: `update-${i}`,
              $id: entityId,
              data: { counter: i },
            })
          }
        })

      const results = await Promise.all(operations)

      // All operations should complete
      expect(results.length).toBe(50)
    })
  })
})

// ============================================================================
// Full Integration Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('UnifiedStoreDO Full Integration', () => {
  let mockState: MockDOState
  let mockEnv: MockEnv

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockDOState()
    mockEnv = createMockEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('CRUD Lifecycle', () => {
    it('should handle create -> read -> update -> delete cycle', async () => {
      // UnifiedStoreDO implementation now exists
      const unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
      const ws = new MockWebSocket()

      // CREATE
      await unifiedDO.handleCreate(ws as unknown as WebSocket, {
        type: 'create',
        id: 'crud-1',
        $type: 'CRUDEntity',
        data: { name: 'Original', status: 'active' },
      })

      const createAck = ws.getLastMessage<{ status: string; $id: string }>()
      expect(createAck?.status).toBe('ack')
      const entityId = createAck!.$id

      // READ
      const created = await unifiedDO.get(entityId)
      expect(created?.name).toBe('Original')
      expect(created?.status).toBe('active')
      expect(created?.$version).toBe(1)

      // UPDATE
      await unifiedDO.handleUpdate(ws as unknown as WebSocket, {
        type: 'update',
        id: 'crud-2',
        $id: entityId,
        data: { name: 'Updated', status: 'modified' },
      })

      const updateAck = ws.getLastMessage<{ status: string; $version: number }>()
      expect(updateAck?.status).toBe('ack')
      expect(updateAck?.$version).toBe(2)

      const updated = await unifiedDO.get(entityId)
      expect(updated?.name).toBe('Updated')
      expect(updated?.status).toBe('modified')

      // DELETE
      await unifiedDO.handleDelete(ws as unknown as WebSocket, {
        type: 'delete',
        id: 'crud-3',
        $id: entityId,
      })

      const deleteAck = ws.getLastMessage<{ status: string }>()
      expect(deleteAck?.status).toBe('ok')

      const deleted = await unifiedDO.get(entityId)
      expect(deleted).toBeNull()

      // Verify pipeline events
      expect(mockEnv.PIPELINE.events.length).toBe(3)
      expect(mockEnv.PIPELINE.events[0].type).toBe('thing.created')
      expect(mockEnv.PIPELINE.events[1].type).toBe('thing.updated')
      expect(mockEnv.PIPELINE.events[2].type).toBe('thing.deleted')
    })
  })

  describe('Bulk Operations', () => {
    it('should handle bulk operations efficiently', async () => {
      // UnifiedStoreDO implementation now exists
      const unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
      const ws = new MockWebSocket()

      // Bulk create
      const bulkData = Array(500)
        .fill(null)
        .map((_, i) => ({
          $type: 'BulkEntity',
          data: { index: i, timestamp: Date.now() },
        }))

      await unifiedDO.handleBatch?.(ws as unknown as WebSocket, {
        type: 'batch',
        id: 'bulk-1',
        operations: bulkData.map((d, i) => ({
          type: 'create' as const,
          id: `create-${i}`,
          ...d,
        })),
      })

      // All should be in memory
      const stateSize = (unifiedDO as unknown as { state: Map<string, Thing> }).state?.size
      expect(stateSize).toBe(500)

      // Pipeline should have all events
      expect(mockEnv.PIPELINE.events.length).toBe(500)
    })
  })

  describe('Crash Recovery', () => {
    it('should recover from simulated crash', async () => {
      // Phase 1: Create data and checkpoint
      // UnifiedStoreDO implementation now exists
      let unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)
      const ws = new MockWebSocket()

      // Create some data
      for (let i = 0; i < 10; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `pre-crash-${i}`,
          $type: 'RecoveryTest',
          data: { value: i * 10 },
        })
      }

      // Checkpoint (simulating graceful shutdown)
      await unifiedDO.checkpoint?.('crash-test')

      // Create more data (dirty, not checkpointed)
      for (let i = 10; i < 15; i++) {
        await unifiedDO.handleCreate(ws as unknown as WebSocket, {
          type: 'create',
          id: `post-checkpoint-${i}`,
          $type: 'RecoveryTest',
          data: { value: i * 10 },
        })
      }

      // Get IDs of dirty items (these would be lost in a crash without Pipeline)
      const dirtyIds = Array.from({ length: 5 }, (_, i) => {
        const messages = ws.sentMessages.slice(-5)
        return JSON.parse(messages[i]).$id as string
      })

      // Phase 2: Simulate crash by creating new instance
      // Clear in-memory state but keep SQLite and Pipeline

      // Mock Iceberg with the dirty events (Pipeline durability)
      const dirtyEvents = mockEnv.PIPELINE.events.slice(-5)

      // UnifiedStoreDO implementation now exists
      unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)

      // Mock Iceberg query to return events not in SQLite
      ;(unifiedDO as unknown as { queryIceberg: (sql: string, params: unknown[]) => Promise<DomainEvent[]> }).queryIceberg = async () => dirtyEvents

      await unifiedDO.onStart?.()

      // All 15 items should be recovered
      // - 10 from SQLite checkpoint
      // - 5 from Pipeline/Iceberg replay
      const stateSize = (unifiedDO as unknown as { state: Map<string, Thing> }).state?.size
      expect(stateSize).toBe(15)

      // Verify specific items
      for (let i = 0; i < 10; i++) {
        const checkpointedId = ws.sentMessages[i] ? JSON.parse(ws.sentMessages[i]).$id : null
        if (checkpointedId) {
          const thing = await unifiedDO.get(checkpointedId)
          expect(thing?.value).toBe(i * 10)
        }
      }
    })
  })
})

// ============================================================================
// Component Integration Tests (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('UnifiedStoreDO Component Integration', () => {
  describe('InMemoryStateManager Integration', () => {
    it('should use InMemoryStateManager for state storage', async () => {
      const mockState = createMockDOState()
      const mockEnv = createMockEnv()

      // UnifiedStoreDO implementation now exists
      const unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)

      // Verify component exists
      const stateManager = (unifiedDO as unknown as { stateManager: InMemoryStateManager }).stateManager
      expect(stateManager).toBeDefined()
    })
  })

  describe('PipelineEmitter Integration', () => {
    it('should use PipelineEmitter for durable writes', async () => {
      const mockState = createMockDOState()
      const mockEnv = createMockEnv()

      // UnifiedStoreDO implementation now exists
      const unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)

      // Verify component exists
      const emitter = (unifiedDO as unknown as { pipelineEmitter: PipelineEmitter }).pipelineEmitter
      expect(emitter).toBeDefined()
    })
  })

  describe('LazyCheckpointer Integration', () => {
    it('should use LazyCheckpointer for SQLite persistence', async () => {
      const mockState = createMockDOState()
      const mockEnv = createMockEnv()

      // UnifiedStoreDO implementation now exists
      const unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)

      // Verify component exists
      const checkpointer = (unifiedDO as unknown as { checkpointer: LazyCheckpointer }).checkpointer
      expect(checkpointer).toBeDefined()
    })
  })

  describe('ColdStartRecovery Integration', () => {
    it('should use ColdStartRecovery for startup', async () => {
      const mockState = createMockDOState()
      const mockEnv = createMockEnv()

      // UnifiedStoreDO implementation now exists
      const unifiedDO = new UnifiedStoreDO(mockState as unknown as DurableObjectState, mockEnv)

      // Verify component exists
      const recovery = (unifiedDO as unknown as { coldStartRecovery: ColdStartRecovery }).coldStartRecovery
      expect(recovery).toBeDefined()
    })
  })
})
