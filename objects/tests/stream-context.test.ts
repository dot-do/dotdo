/**
 * Stream Emission with $context Tests (RED TDD)
 *
 * These tests verify that stream emissions include proper $context field
 * representing the DO's logical namespace, and that $id is fully constructed
 * by the DO before emission.
 *
 * Key concepts:
 * - ns = logical namespace (e.g., 'https://crm.headless.ly/acme')
 * - $id = physical ID with potential qualifiers (ns + @branch, ?shard, etc.)
 * - $context = always the logical ns (same as ns, no qualifiers)
 * - Collection items: $id = ns/itemId
 * - ThingDO items: $id = ns/type/itemId
 *
 * RED PHASE: These tests should FAIL because the DO doesn't emit $context yet.
 *
 * @see Issue: dotdo-jlvy - [RED] Tests for stream emission with $context
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DO, type Env } from '../DO'
import { createMockPipeline, type MockPipeline } from '../../tests/mocks/pipeline'

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
 * Mock SQL storage that simulates Cloudflare's SqlStorage API
 */
function createMockSqlStorage() {
  const tables = new Map<string, unknown[]>()

  return {
    exec(query: string, ...params: unknown[]): MockSqlCursor {
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

/**
 * Create a mock DurableObjectState with both KV and SQL storage
 */
function createMockState(idName: string = 'test-do-id'): DurableObjectState {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage()

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
 * Stream payload interface - what we expect to be sent to Pipeline
 */
interface StreamPayload {
  verb?: string
  source?: string
  $id?: string
  $type?: string
  $context?: string // This is what we're testing - currently NOT implemented
  data?: Record<string, unknown>
  timestamp?: string
}

// ============================================================================
// TESTS: STREAM EMISSION WITH $context (RED PHASE - EXPECTED TO FAIL)
// ============================================================================

describe('Stream Emission with $context (RED Phase)', () => {
  let mockPipeline: MockPipeline
  let mockState: DurableObjectState
  let mockEnv: Env

  beforeEach(() => {
    mockPipeline = createMockPipeline()
    mockState = createMockState()
    mockEnv = {
      PIPELINE: mockPipeline,
    }
  })

  // ==========================================================================
  // TESTS: $context Field Presence in DO emitEvent
  // These tests verify the DO's current emission behavior lacks $context
  // ==========================================================================

  describe('DO emitEvent should include $context', () => {
    it('FAILS: emitEvent payload includes $context field', async () => {
      // Create DO with mock pipeline
      const doInstance = new DO(mockState, mockEnv)
      await doInstance.initialize({ ns: 'https://crm.headless.ly/acme' })

      // Access protected emitEvent method
      const emitEvent = (doInstance as unknown as {
        emitEvent: (verb: string, data: unknown) => Promise<void>
      }).emitEvent

      // Emit an event - this should include $context but currently doesn't
      try {
        await emitEvent.call(doInstance, 'Customer.created', { customerId: 'cust-123' })
      } catch {
        // May throw due to mock DB, but we're testing what gets sent to pipeline
      }

      // Check if pipeline received anything
      if (mockPipeline.events.length > 0) {
        const sentPayload = mockPipeline.events[0] as StreamPayload

        // This assertion should FAIL - $context is not currently emitted
        expect(sentPayload).toHaveProperty('$context')
        expect(sentPayload.$context).toBe('https://crm.headless.ly/acme')
      } else {
        // If nothing was sent, the test fails because we need to verify $context
        // This is a valid RED state - the feature isn't working yet
        expect(mockPipeline.events.length).toBeGreaterThan(0)
      }
    })

    it('FAILS: $context equals DO ns (logical namespace)', async () => {
      const doNs = 'https://crm.headless.ly/acme'
      const doInstance = new DO(mockState, mockEnv)
      await doInstance.initialize({ ns: doNs })

      const emitEvent = (doInstance as unknown as {
        emitEvent: (verb: string, data: unknown) => Promise<void>
      }).emitEvent

      try {
        await emitEvent.call(doInstance, 'test.event', { data: 'test' })
      } catch {
        // Expected: mock DB may throw
      }

      // Verify $context in payload equals DO's ns
      if (mockPipeline.events.length > 0) {
        const sentPayload = mockPipeline.events[0] as StreamPayload

        // FAILS: $context is not emitted in current implementation
        expect(sentPayload.$context).toBeDefined()
        expect(sentPayload.$context).toBe(doNs)
      } else {
        // RED: Need pipeline to receive events with $context
        expect.fail('Pipeline should receive events with $context field')
      }
    })
  })

  // ==========================================================================
  // TESTS: $context in Thing stream emissions
  // ==========================================================================

  describe('ThingsStore should emit $context', () => {
    it('FAILS: ThingsStore.create emits stream with $context', async () => {
      const doNs = 'https://crm.headless.ly/acme'
      const doInstance = new DO(mockState, mockEnv)
      await doInstance.initialize({ ns: doNs })

      // Access things store
      const things = (doInstance as unknown as { things: { create: (data: unknown) => Promise<unknown> } }).things

      try {
        await things.create({
          type: 'Customer',
          name: 'Test Customer',
          data: { email: 'test@example.com' },
        })
      } catch {
        // Expected: mock DB may throw
      }

      // Check pipeline for $context
      if (mockPipeline.events.length > 0) {
        const sentPayload = mockPipeline.events[0] as StreamPayload

        // FAILS: $context is not currently emitted
        expect(sentPayload).toHaveProperty('$context')
        expect(sentPayload.$context).toBe(doNs)
      } else {
        // RED: Things store should emit to pipeline with $context
        expect.fail('Things store should emit to pipeline with $context field')
      }
    })
  })

  // ==========================================================================
  // TESTS: $id format verification
  // ==========================================================================

  describe('$id should be fully qualified', () => {
    it('FAILS: $id is fully constructed by DO (not SQL)', async () => {
      const doNs = 'https://crm.headless.ly/acme'
      const doInstance = new DO(mockState, mockEnv)
      await doInstance.initialize({ ns: doNs })

      const emitEvent = (doInstance as unknown as {
        emitEvent: (verb: string, data: unknown) => Promise<void>
      }).emitEvent

      try {
        await emitEvent.call(doInstance, 'Customer.created', {
          $id: `${doNs}/Customer/cust-123`,
          $type: 'Customer',
        })
      } catch {
        // Expected
      }

      if (mockPipeline.events.length > 0) {
        const sentPayload = mockPipeline.events[0] as StreamPayload

        // Verify $id is fully qualified URL
        if (sentPayload.$id) {
          expect(sentPayload.$id).toContain('https://')
          expect(sentPayload.$id).toContain(doNs)
        }

        // FAILS: $context must also be present
        expect(sentPayload.$context).toBe(doNs)
      } else {
        expect.fail('Pipeline should receive events with fully qualified $id and $context')
      }
    })
  })

  // ==========================================================================
  // TESTS: Collection vs ThingDO $id format
  // ==========================================================================

  describe('Collection $id format: ns/id', () => {
    it('FAILS: Collection items have $id in ns/id format with $context', async () => {
      // Collection DOs use ns/id pattern
      const collectionNs = 'https://crm.headless.ly/customers'
      const doInstance = new DO(mockState, mockEnv)
      await doInstance.initialize({ ns: collectionNs })

      const emitEvent = (doInstance as unknown as {
        emitEvent: (verb: string, data: unknown) => Promise<void>
      }).emitEvent

      try {
        await emitEvent.call(doInstance, 'item.created', {
          itemId: 'cust-123',
        })
      } catch {
        // Expected
      }

      if (mockPipeline.events.length > 0) {
        const sentPayload = mockPipeline.events[0] as StreamPayload

        // FAILS: $context should be the collection ns
        expect(sentPayload.$context).toBe(collectionNs)

        // $id format should be ns/id
        if (sentPayload.$id) {
          expect(sentPayload.$id).toMatch(/^https:\/\/[^\/]+\/[^\/]+\/[^\/]+$/)
        }
      } else {
        expect.fail('Collection should emit items with $context = collection ns')
      }
    })
  })

  describe('ThingDO $id format: ns/type/id', () => {
    it('FAILS: ThingDO items have $id in ns/type/id format with $context', async () => {
      // ThingDO uses ns/type/id pattern
      const thingDoNs = 'https://crm.headless.ly/acme'
      const doInstance = new DO(mockState, mockEnv)
      await doInstance.initialize({ ns: thingDoNs })

      const emitEvent = (doInstance as unknown as {
        emitEvent: (verb: string, data: unknown) => Promise<void>
      }).emitEvent

      try {
        await emitEvent.call(doInstance, 'Customer.created', {
          $id: `${thingDoNs}/Customer/cust-123`,
          $type: 'Customer',
        })
      } catch {
        // Expected
      }

      if (mockPipeline.events.length > 0) {
        const sentPayload = mockPipeline.events[0] as StreamPayload

        // FAILS: $context should be the ThingDO ns
        expect(sentPayload.$context).toBe(thingDoNs)
      } else {
        expect.fail('ThingDO should emit items with $context = ThingDO ns')
      }
    })
  })

  // ==========================================================================
  // TESTS: $context qualifier exclusion
  // ==========================================================================

  describe('$context excludes qualifiers', () => {
    it('FAILS: $context does not include @branch qualifier', async () => {
      // When on a branch, $context should still be the logical ns
      const logicalNs = 'https://crm.headless.ly/acme'
      const doInstance = new DO(mockState, mockEnv)
      await doInstance.initialize({ ns: logicalNs })

      // Simulate being on a branch
      const branch = (doInstance as unknown as { branch: (name: string) => Promise<void> }).branch
      try {
        await branch.call(doInstance, 'feature-branch')
      } catch {
        // Expected
      }

      const emitEvent = (doInstance as unknown as {
        emitEvent: (verb: string, data: unknown) => Promise<void>
      }).emitEvent

      try {
        await emitEvent.call(doInstance, 'test.event', { data: 'test' })
      } catch {
        // Expected
      }

      if (mockPipeline.events.length > 0) {
        const sentPayload = mockPipeline.events[0] as StreamPayload

        // FAILS: $context must exist and NOT contain @
        expect(sentPayload.$context).toBeDefined()
        expect(sentPayload.$context).toBe(logicalNs)
        expect(sentPayload.$context).not.toContain('@')
      } else {
        expect.fail('$context should be logical ns without @branch qualifier')
      }
    })

    it('FAILS: $context does not include ?shard qualifier', async () => {
      const logicalNs = 'https://crm.headless.ly/acme'
      const doInstance = new DO(mockState, mockEnv)
      await doInstance.initialize({ ns: logicalNs })

      const emitEvent = (doInstance as unknown as {
        emitEvent: (verb: string, data: unknown) => Promise<void>
      }).emitEvent

      try {
        await emitEvent.call(doInstance, 'test.event', { data: 'test' })
      } catch {
        // Expected
      }

      if (mockPipeline.events.length > 0) {
        const sentPayload = mockPipeline.events[0] as StreamPayload

        // FAILS: $context must exist and NOT contain ?
        expect(sentPayload.$context).toBeDefined()
        expect(sentPayload.$context).toBe(logicalNs)
        expect(sentPayload.$context).not.toContain('?')
      } else {
        expect.fail('$context should be logical ns without ?shard qualifier')
      }
    })

    it('FAILS: $context is always a clean namespace URL', async () => {
      const logicalNs = 'https://crm.headless.ly/acme'
      const doInstance = new DO(mockState, mockEnv)
      await doInstance.initialize({ ns: logicalNs })

      const emitEvent = (doInstance as unknown as {
        emitEvent: (verb: string, data: unknown) => Promise<void>
      }).emitEvent

      try {
        await emitEvent.call(doInstance, 'test.event', { data: 'test' })
      } catch {
        // Expected
      }

      if (mockPipeline.events.length > 0) {
        const sentPayload = mockPipeline.events[0] as StreamPayload

        // FAILS: $context must be a valid clean URL
        expect(sentPayload.$context).toBeDefined()
        expect(sentPayload.$context).toMatch(/^https:\/\/[^@?]+$/)
        expect(() => new URL(sentPayload.$context!)).not.toThrow()
      } else {
        expect.fail('$context should be a clean namespace URL')
      }
    })
  })
})

// ============================================================================
// TESTS: EventsStore stream emission
// ============================================================================

describe('EventsStore stream emission (RED Phase)', () => {
  let mockPipeline: MockPipeline
  let mockState: DurableObjectState
  let mockEnv: Env

  beforeEach(() => {
    mockPipeline = createMockPipeline()
    mockState = createMockState()
    mockEnv = {
      PIPELINE: mockPipeline,
    }
  })

  it('FAILS: EventsStore.stream includes $context', async () => {
    const doNs = 'https://crm.headless.ly/acme'
    const doInstance = new DO(mockState, mockEnv)
    await doInstance.initialize({ ns: doNs })

    // Access events store
    const events = (doInstance as unknown as {
      events: {
        emit: (options: { verb: string; source: string; data: unknown }) => Promise<unknown>
        stream: (id: string) => Promise<unknown>
      }
    }).events

    try {
      // Create an event
      const event = await events.emit({
        verb: 'Customer.created',
        source: doNs,
        data: { customerId: 'cust-123' },
      })

      // Stream it
      if (event && typeof event === 'object' && 'id' in event) {
        await events.stream((event as { id: string }).id)
      }
    } catch {
      // Expected: mock DB may throw
    }

    if (mockPipeline.events.length > 0) {
      const sentPayload = mockPipeline.events[0] as StreamPayload

      // FAILS: EventsStore.stream should include $context
      expect(sentPayload).toHaveProperty('$context')
      expect(sentPayload.$context).toBe(doNs)
    } else {
      expect.fail('EventsStore.stream should emit to pipeline with $context field')
    }
  })
})
