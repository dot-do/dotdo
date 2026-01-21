/**
 * @dotdo/sdk/testing - Testing Helpers
 *
 * Utilities for testing dotdo applications locally or in CI/CD.
 * Provides mock clients, fixtures, and assertion helpers.
 *
 * @module @dotdo/sdk/testing
 *
 * @example
 * ```typescript
 * import { createMockClient, createTestFixture } from 'dotdo/sdk/testing'
 *
 * describe('MyFeature', () => {
 *   const client = createMockClient()
 *
 *   it('should create a customer', async () => {
 *     const customer = await client.things.create({
 *       $type: 'Customer',
 *       name: 'Test Customer'
 *     })
 *
 *     expect(customer.$id).toBeDefined()
 *   })
 * })
 * ```
 */

import type { Thing, Event, Relationship, JsonValue, ThingId, EventId } from '@dotdo/db'
import { toThingId, toEventId } from '@dotdo/db'
import type {
  DotdoClientOptions,
  ThingsResource,
  EventsResource,
  RelationshipsResource,
  PaginatedResponse,
  HealthResponse,
} from './client'
import { DotdoClient } from './client'

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate a unique test ID.
 */
export function generateTestId(prefix: string = 'test'): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}_${timestamp}_${random}`
}

/**
 * Generate a mock $id.
 */
export function generateMockId(): string {
  return generateTestId('mock')
}

// ============================================================================
// Mock Data Store
// ============================================================================

/**
 * In-memory data store for mock client.
 */
export interface MockDataStore {
  things: Map<string, Thing>
  events: Map<string, Event>
  relationships: Map<string, Relationship>
}

/**
 * Create an empty mock data store.
 */
export function createMockDataStore(): MockDataStore {
  return {
    things: new Map(),
    events: new Map(),
    relationships: new Map(),
  }
}

// ============================================================================
// Mock Client
// ============================================================================

/**
 * Configuration for the mock client.
 */
export interface MockClientOptions {
  /** Initial data to populate the store */
  initialData?: {
    things?: Thing[]
    events?: Event[]
    relationships?: Relationship[]
  }
  /** Simulated latency in ms (0 for instant) */
  latency?: number
  /** Simulate errors */
  errorRate?: number
  /** Custom ID generator */
  idGenerator?: () => string
}

/**
 * Mock DotdoClient for testing without a real backend.
 *
 * Provides an in-memory implementation that matches the real client API.
 *
 * @example
 * ```typescript
 * const mockClient = createMockClient({
 *   initialData: {
 *     things: [{ $id: 'cust_1', $type: 'Customer', name: 'Alice' }]
 *   }
 * })
 *
 * const customers = await mockClient.things.list({ $type: 'Customer' })
 * expect(customers.data).toHaveLength(1)
 * ```
 */
export class MockDotdoClient {
  private store: MockDataStore
  private options: Required<MockClientOptions>

  constructor(options: MockClientOptions = {}) {
    this.store = createMockDataStore()
    this.options = {
      initialData: options.initialData || {},
      latency: options.latency ?? 0,
      errorRate: options.errorRate ?? 0,
      idGenerator: options.idGenerator ?? generateMockId,
    }

    // Populate initial data
    if (options.initialData?.things) {
      for (const thing of options.initialData.things) {
        this.store.things.set(thing.$id as string, thing)
      }
    }
    if (options.initialData?.events) {
      for (const event of options.initialData.events) {
        this.store.events.set(event.$id as string, event)
      }
    }
    if (options.initialData?.relationships) {
      for (const rel of options.initialData.relationships) {
        // Use subject:predicate:object as key for relationships
        const key = `${rel.subject}:${rel.predicate}:${rel.object}`
        this.store.relationships.set(key, rel)
      }
    }
  }

  /**
   * Simulate network latency.
   */
  private async simulateLatency(): Promise<void> {
    if (this.options.latency > 0) {
      await new Promise(resolve => setTimeout(resolve, this.options.latency))
    }
  }

  /**
   * Simulate random errors.
   */
  private simulateError(): void {
    if (this.options.errorRate > 0 && Math.random() < this.options.errorRate) {
      throw new Error('Simulated error')
    }
  }

  /**
   * Things resource implementation.
   */
  readonly things: ThingsResource = {
    list: async (options?): Promise<PaginatedResponse<Thing>> => {
      await this.simulateLatency()
      this.simulateError()

      let results = Array.from(this.store.things.values())

      // Filter by type
      if (options?.$type) {
        results = results.filter(t => t.$type === options.$type)
      }

      // Apply limit
      const limit = options?.limit ?? 100
      const hasMore = results.length > limit
      results = results.slice(0, limit)

      return {
        data: results,
        hasMore,
        total: results.length,
      }
    },

    get: async (id: string): Promise<Thing> => {
      await this.simulateLatency()
      this.simulateError()

      const thing = this.store.things.get(id)
      if (!thing) {
        throw new Error(`Thing not found: ${id}`)
      }
      return { ...thing }
    },

    create: async (data): Promise<Thing> => {
      await this.simulateLatency()
      this.simulateError()

      const now = Date.now()
      const thing: Thing = {
        ...data,
        $id: toThingId(this.options.idGenerator()),
        $createdAt: now,
        $updatedAt: now,
      } as Thing

      this.store.things.set(thing.$id as string, thing)
      return { ...thing }
    },

    update: async (id: string, data): Promise<Thing> => {
      await this.simulateLatency()
      this.simulateError()

      const existing = this.store.things.get(id)
      if (!existing) {
        throw new Error(`Thing not found: ${id}`)
      }

      const updated: Thing = {
        ...existing,
        ...data,
        $id: toThingId(id),
        $updatedAt: Date.now(),
      }

      this.store.things.set(id, updated)
      return { ...updated }
    },

    delete: async (id: string): Promise<void> => {
      await this.simulateLatency()
      this.simulateError()

      if (!this.store.things.has(id)) {
        throw new Error(`Thing not found: ${id}`)
      }
      this.store.things.delete(id)
    },

    bulkCreate: async (items): Promise<Thing[]> => {
      await this.simulateLatency()
      this.simulateError()

      const results: Thing[] = []
      const now = Date.now()

      for (const data of items) {
        const thing: Thing = {
          ...data,
          $id: toThingId(this.options.idGenerator()),
          $createdAt: now,
          $updatedAt: now,
        } as Thing

        this.store.things.set(thing.$id as string, thing)
        results.push({ ...thing })
      }

      return results
    },

    bulkUpdate: async (updates): Promise<Thing[]> => {
      await this.simulateLatency()
      this.simulateError()

      const results: Thing[] = []
      const now = Date.now()

      for (const { id, data } of updates) {
        const existing = this.store.things.get(id)
        if (!existing) {
          throw new Error(`Thing not found: ${id}`)
        }

        const updated: Thing = {
          ...existing,
          ...data,
          $id: toThingId(id),
          $updatedAt: now,
        }

        this.store.things.set(id, updated)
        results.push({ ...updated })
      }

      return results
    },

    bulkDelete: async (ids: string[]): Promise<void> => {
      await this.simulateLatency()
      this.simulateError()

      for (const id of ids) {
        this.store.things.delete(id)
      }
    },
  }

  /**
   * Events resource implementation.
   */
  readonly events: EventsResource = {
    list: async (options?): Promise<PaginatedResponse<Event>> => {
      await this.simulateLatency()
      this.simulateError()

      let results = Array.from(this.store.events.values())

      if (options?.type) {
        results = results.filter(e => e.type === options.type)
      }
      if (options?.source) {
        results = results.filter(e => e.source === options.source)
      }

      const limit = options?.limit ?? 100
      const hasMore = results.length > limit
      results = results.slice(0, limit)

      return {
        data: results,
        hasMore,
      }
    },

    get: async (id: string): Promise<Event> => {
      await this.simulateLatency()
      this.simulateError()

      const event = this.store.events.get(id)
      if (!event) {
        throw new Error(`Event not found: ${id}`)
      }
      return { ...event }
    },

    emit: async (data): Promise<Event> => {
      await this.simulateLatency()
      this.simulateError()

      const event: Event = {
        $id: toEventId(this.options.idGenerator()),
        type: data.type,
        payload: data.payload as JsonValue,
        source: data.source,
        correlationId: data.correlationId,
        $timestamp: Date.now(),
      } as Event

      this.store.events.set(event.$id as string, event)
      return { ...event }
    },
  }

  /**
   * Relationships resource implementation.
   */
  readonly relationships: RelationshipsResource = {
    list: async (options?): Promise<PaginatedResponse<Relationship>> => {
      await this.simulateLatency()
      this.simulateError()

      let results = Array.from(this.store.relationships.values())

      const limit = options?.limit ?? 100
      const hasMore = results.length > limit
      results = results.slice(0, limit)

      return {
        data: results,
        hasMore,
      }
    },

    find: async (query): Promise<Relationship[]> => {
      await this.simulateLatency()
      this.simulateError()

      let results = Array.from(this.store.relationships.values())

      if (query.subject) {
        results = results.filter(r => r.subject === query.subject)
      }
      if (query.predicate) {
        results = results.filter(r => r.predicate === query.predicate)
      }
      if (query.object) {
        results = results.filter(r => r.object === query.object)
      }

      return results.map(r => ({ ...r }))
    },

    add: async (data): Promise<Relationship> => {
      await this.simulateLatency()
      this.simulateError()

      const relationship: Relationship = {
        subject: data.subject,
        predicate: data.predicate,
        object: data.object,
        ...(data.metadata !== undefined ? { metadata: data.metadata as JsonValue } : {}),
        $createdAt: Date.now(),
      } as Relationship

      const key = `${data.subject}:${data.predicate}:${data.object}`
      this.store.relationships.set(key, relationship)
      return { ...relationship }
    },

    remove: async (query): Promise<void> => {
      await this.simulateLatency()
      this.simulateError()

      const key = `${query.subject}:${query.predicate}:${query.object}`
      this.store.relationships.delete(key)
    },
  }

  /**
   * Mock RPC call.
   */
  async rpc<T = unknown>(method: string, args: unknown[] = []): Promise<T> {
    await this.simulateLatency()
    this.simulateError()

    // Handle built-in methods
    if (method === 'things.list') {
      const result = await this.things.list(args[0] as any)
      return result.data as T
    }
    if (method === 'events.list') {
      const result = await this.events.list(args[0] as any)
      return result.data as T
    }

    throw new Error(`Unknown RPC method: ${method}`)
  }

  /**
   * Mock health check.
   */
  async health(): Promise<HealthResponse> {
    await this.simulateLatency()
    this.simulateError()

    return {
      status: 'ok',
      version: '1.0.0-mock',
      uptime: 1000,
    }
  }

  /**
   * Mock root endpoint.
   */
  async root(): Promise<{ name: string; _links: Record<string, { href: string }> }> {
    await this.simulateLatency()
    this.simulateError()

    return {
      name: 'dotdo-mock',
      _links: {
        self: { href: '/' },
        things: { href: '/things' },
        events: { href: '/events' },
        relationships: { href: '/relationships' },
      },
    }
  }

  // --------------------------------------------------------------------------
  // Test Utilities
  // --------------------------------------------------------------------------

  /**
   * Get direct access to the mock data store (for assertions).
   */
  getStore(): MockDataStore {
    return this.store
  }

  /**
   * Reset all data in the mock store.
   */
  reset(): void {
    this.store.things.clear()
    this.store.events.clear()
    this.store.relationships.clear()
  }

  /**
   * Seed the mock store with data.
   */
  seed(data: {
    things?: Thing[]
    events?: Event[]
    relationships?: Relationship[]
  }): void {
    if (data.things) {
      for (const thing of data.things) {
        this.store.things.set(thing.$id as string, thing)
      }
    }
    if (data.events) {
      for (const event of data.events) {
        this.store.events.set(event.$id as string, event)
      }
    }
    if (data.relationships) {
      for (const rel of data.relationships) {
        const key = `${rel.subject}:${rel.predicate}:${rel.object}`
        this.store.relationships.set(key, rel)
      }
    }
  }
}

/**
 * Create a mock client for testing.
 *
 * @param options - Mock client options
 * @returns MockDotdoClient instance
 */
export function createMockClient(options?: MockClientOptions): MockDotdoClient {
  return new MockDotdoClient(options)
}

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Test fixture with pre-populated data and utilities.
 */
export interface TestFixture {
  /** Mock client instance */
  client: MockDotdoClient
  /** Pre-created test data */
  data: {
    customers: Thing[]
    orders: Thing[]
    events: Event[]
    relationships: Relationship[]
  }
  /** Cleanup function */
  cleanup: () => void
}

/**
 * Create a test fixture with sample data.
 *
 * @returns TestFixture with pre-populated data
 *
 * @example
 * ```typescript
 * describe('Orders', () => {
 *   let fixture: TestFixture
 *
 *   beforeEach(() => {
 *     fixture = createTestFixture()
 *   })
 *
 *   afterEach(() => {
 *     fixture.cleanup()
 *   })
 *
 *   it('should list orders', async () => {
 *     const orders = await fixture.client.things.list({ $type: 'Order' })
 *     expect(orders.data.length).toBeGreaterThan(0)
 *   })
 * })
 * ```
 */
export function createTestFixture(): TestFixture {
  // Use epoch timestamps (milliseconds since 1970-01-01)
  const timestamp2024_01_01 = new Date('2024-01-01T00:00:00Z').getTime()
  const timestamp2024_01_02 = new Date('2024-01-02T00:00:00Z').getTime()
  const timestamp2024_01_10 = new Date('2024-01-10T00:00:00Z').getTime()
  const timestamp2024_01_15 = new Date('2024-01-15T00:00:00Z').getTime()
  const timestamp2024_01_20 = new Date('2024-01-20T00:00:00Z').getTime()

  const customers: Thing[] = [
    {
      $id: toThingId('cust-alice'),
      $type: 'Customer',
      name: 'Alice',
      email: 'alice@example.com',
      plan: 'pro',
      $createdAt: timestamp2024_01_01,
      $updatedAt: timestamp2024_01_01,
    } as Thing,
    {
      $id: toThingId('cust-bob'),
      $type: 'Customer',
      name: 'Bob',
      email: 'bob@example.com',
      plan: 'free',
      $createdAt: timestamp2024_01_02,
      $updatedAt: timestamp2024_01_02,
    } as Thing,
  ]

  const orders: Thing[] = [
    {
      $id: toThingId('order-1'),
      $type: 'Order',
      customerId: 'cust-alice',
      total: 99.99,
      status: 'completed',
      $createdAt: timestamp2024_01_10,
      $updatedAt: timestamp2024_01_10,
    } as Thing,
    {
      $id: toThingId('order-2'),
      $type: 'Order',
      customerId: 'cust-alice',
      total: 149.99,
      status: 'pending',
      $createdAt: timestamp2024_01_15,
      $updatedAt: timestamp2024_01_15,
    } as Thing,
    {
      $id: toThingId('order-3'),
      $type: 'Order',
      customerId: 'cust-bob',
      total: 29.99,
      status: 'completed',
      $createdAt: timestamp2024_01_20,
      $updatedAt: timestamp2024_01_20,
    } as Thing,
  ]

  const events: Event[] = [
    {
      $id: toEventId('evt-1'),
      type: 'Customer.signup',
      payload: { customerId: 'cust-alice' },
      source: 'web',
      $timestamp: timestamp2024_01_01,
    } as Event,
    {
      $id: toEventId('evt-2'),
      type: 'Order.placed',
      payload: { orderId: 'order-1', customerId: 'cust-alice' },
      source: 'api',
      $timestamp: timestamp2024_01_10,
    } as Event,
  ]

  const relationships: Relationship[] = [
    {
      subject: 'cust-alice',
      predicate: 'hasOrder',
      object: 'order-1',
      $createdAt: timestamp2024_01_10,
    } as Relationship,
    {
      subject: 'cust-alice',
      predicate: 'hasOrder',
      object: 'order-2',
      $createdAt: timestamp2024_01_15,
    } as Relationship,
    {
      subject: 'cust-bob',
      predicate: 'hasOrder',
      object: 'order-3',
      $createdAt: timestamp2024_01_20,
    } as Relationship,
  ]

  const client = createMockClient({
    initialData: {
      things: [...customers, ...orders],
      events,
      relationships,
    },
  })

  return {
    client,
    data: {
      customers,
      orders,
      events,
      relationships,
    },
    cleanup: () => {
      client.reset()
    },
  }
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that a thing matches expected properties.
 */
export function assertThing(
  thing: Thing,
  expected: Partial<Thing>
): void {
  for (const [key, value] of Object.entries(expected)) {
    if ((thing as Record<string, unknown>)[key] !== value) {
      throw new Error(
        `Expected thing.${key} to be ${JSON.stringify(value)}, got ${JSON.stringify((thing as Record<string, unknown>)[key])}`
      )
    }
  }
}

/**
 * Assert that an event matches expected properties.
 */
export function assertEvent(
  event: Event,
  expected: Partial<Event>
): void {
  const eventRecord = event as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(expected)) {
    if (eventRecord[key] !== value) {
      throw new Error(
        `Expected event.${key} to be ${JSON.stringify(value)}, got ${JSON.stringify(eventRecord[key])}`
      )
    }
  }
}

/**
 * Assert that a relationship matches expected properties.
 */
export function assertRelationship(
  relationship: Relationship,
  expected: Partial<Relationship>
): void {
  for (const [key, value] of Object.entries(expected)) {
    if ((relationship as Record<string, unknown>)[key] !== value) {
      throw new Error(
        `Expected relationship.${key} to be ${JSON.stringify(value)}, got ${JSON.stringify((relationship as Record<string, unknown>)[key])}`
      )
    }
  }
}

// ============================================================================
// Local Development Server
// ============================================================================

/**
 * Configuration for local development server.
 */
export interface LocalServerConfig {
  /** Port to run on (default: 8787) */
  port?: number
  /** Host to bind to (default: 'localhost') */
  host?: string
  /** Enable verbose logging */
  verbose?: boolean
}

/**
 * Create a client configured for local development.
 *
 * @param config - Optional server configuration
 * @returns DotdoClient configured for localhost
 *
 * @example
 * ```typescript
 * // Connect to local wrangler dev server
 * const client = createLocalClient()
 *
 * // Or with custom port
 * const client = createLocalClient({ port: 8788 })
 * ```
 */
export function createLocalClient(config?: LocalServerConfig): DotdoClient {
  const port = config?.port ?? 8787
  const host = config?.host ?? 'localhost'

  return new DotdoClient({
    baseUrl: `http://${host}:${port}`,
    retry: false, // Don't retry in local dev
  })
}

// ============================================================================
// Resource Tracking for Cleanup
// ============================================================================

/**
 * Track created resources for cleanup.
 */
export interface ResourceTracker {
  /** Track a created resource */
  track(type: 'thing' | 'event' | 'relationship', id: string): void
  /** Get all tracked resources */
  getTracked(): { things: string[]; events: string[]; relationships: string[] }
  /** Clean up all tracked resources */
  cleanup(client: DotdoClient | MockDotdoClient): Promise<void>
  /** Clear tracking without cleanup */
  clear(): void
}

/**
 * Create a resource tracker for test cleanup.
 *
 * @example
 * ```typescript
 * const tracker = createResourceTracker()
 *
 * const customer = await client.things.create({ $type: 'Customer', name: 'Test' })
 * tracker.track('thing', customer.$id)
 *
 * // In afterEach
 * await tracker.cleanup(client)
 * ```
 */
export function createResourceTracker(): ResourceTracker {
  const tracked = {
    things: new Set<string>(),
    events: new Set<string>(),
    relationships: new Set<string>(),
  }

  return {
    track(type, id) {
      switch (type) {
        case 'thing':
          tracked.things.add(id)
          break
        case 'event':
          tracked.events.add(id)
          break
        case 'relationship':
          tracked.relationships.add(id)
          break
      }
    },

    getTracked() {
      return {
        things: Array.from(tracked.things),
        events: Array.from(tracked.events),
        relationships: Array.from(tracked.relationships),
      }
    },

    async cleanup(client) {
      // Delete things (which cascades to relationships)
      for (const id of tracked.things) {
        try {
          await client.things.delete(id)
        } catch {
          // Ignore errors during cleanup
        }
      }

      tracked.things.clear()
      tracked.events.clear()
      tracked.relationships.clear()
    },

    clear() {
      tracked.things.clear()
      tracked.events.clear()
      tracked.relationships.clear()
    },
  }
}
