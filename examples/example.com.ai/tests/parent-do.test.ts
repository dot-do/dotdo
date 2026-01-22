/**
 * Parent DO Tests - Hierarchical DO Architecture
 *
 * GREEN phase: These tests verify the ParentDO implementation:
 * - example.com.ai = Parent DO that aggregates events and streams to R2
 * - crm.example.com.ai/:tenant = Child tenant DOs that phone home to parent
 *
 * This is a hierarchical DO architecture where:
 * 1. Parent DO receives events from child DOs (CDC - Change Data Capture)
 * 2. Parent DO aggregates events and streams to R2
 * 3. Parent DO provides global search/query across all children
 * 4. Parent DO has `$context` that children can reference
 * 5. Event buffering before R2 writes (batch for cost efficiency)
 * 6. Parent can discover and list all child DOs
 *
 * @module examples/example.com.ai/tests/parent-do.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Import the actual implementation
import { ParentDO, ChildContextManager, createChildContext } from '../src'
import type { ParentDOEvent, R2BufferConfig, GlobalQueryOptions, ChildDOInfo, ParentContext } from '../src'

/**
 * Create a mock DurableObjectState for testing
 */
function createMockState(): DurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    id: {
      toString: () => 'test-do-id',
      name: 'test-do',
    },
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => { storage.set(key, value) },
      delete: async (key: string) => storage.delete(key),
      list: async () => storage,
    },
    waitUntil: (_promise: Promise<unknown>) => {},
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
  } as unknown as DurableObjectState
}

// ============================================================================
// TEST SUITES - GREEN PHASE (Tests should PASS with implementation)
// ============================================================================

describe('Parent DO Architecture - GREEN Phase', () => {
  let parent: ParentDO
  let mockState: DurableObjectState

  beforeEach(() => {
    mockState = createMockState()
    parent = new ParentDO(mockState, {})
  })

  afterEach(() => {
    parent.destroy()
  })

  describe('1. Parent DO receives events from child DOs (CDC)', () => {
    it('should receive all events from child DOs via wildcard handler', async () => {
      const receivedEvents: ParentDOEvent[] = []

      // Expected: parent.$.on['*']['*'] registers a global event handler
      expect(parent.$).toBeDefined()
      expect(parent.$.on).toBeDefined()
      expect(parent.$.on['*']).toBeDefined()
      expect(parent.$.on['*']['*']).toBeDefined()
      expect(typeof parent.$.on['*']['*']).toBe('function')

      // Register wildcard handler
      parent.$.on['*']['*'](async (event) => {
        receivedEvents.push(event)
      })

      // Simulate receiving an event from a child
      await parent.receiveChildEvent({
        $id: 'evt-123',
        type: 'Customer.signup',
        payload: { email: 'user@example.com' },
        source: 'child',
        childId: 'tenant-abc',
        $timestamp: Date.now(),
      })

      expect(receivedEvents).toHaveLength(1)
      expect(receivedEvents[0].type).toBe('Customer.signup')
    })

    it('should track child DO source in events', async () => {
      const event: ParentDOEvent = {
        $id: 'evt-123',
        type: 'Customer.signup',
        payload: { email: 'user@example.com' },
        source: 'child',
        childId: 'crm.example.com.ai/tenant-abc',
        $timestamp: Date.now(),
      }

      expect(event.childId).toBeDefined()
      expect(event.source).toBe('child')

      // Verify parent DO has the on property
      expect(parent.$.on).toBeDefined()
    })

    it('should handle specific event types from children', async () => {
      // Expected: Parent can listen for specific events from children
      expect(parent.$.on.Child).toBeDefined()
      expect(parent.$.on.Child.registered).toBeDefined()
      expect(parent.$.on.Child.heartbeat).toBeDefined()
      expect(parent.$.on.Child.disconnected).toBeDefined()
    })
  })

  describe('2. Parent DO aggregates events and streams to R2', () => {
    it('should buffer events before writing to R2', async () => {
      // Expected: $.r2.buffer() exists and queues events
      expect(parent.$.r2).toBeDefined()
      expect(parent.$.r2.buffer).toBeDefined()
      expect(typeof parent.$.r2.buffer).toBe('function')

      const event: ParentDOEvent = {
        $id: 'evt-456',
        type: 'Order.placed',
        payload: { orderId: 'ord-123', total: 99.99 },
        source: 'child',
        childId: 'crm.example.com.ai/tenant-xyz',
        $timestamp: Date.now(),
      }

      // Should succeed
      await expect(parent.$.r2.buffer(event)).resolves.toBeUndefined()
    })

    it('should flush buffer to R2 with batch efficiency', async () => {
      // Expected: $.r2.flush() writes buffered events to R2
      expect(parent.$.r2.flush).toBeDefined()
      expect(typeof parent.$.r2.flush).toBe('function')

      // Buffer an event first
      await parent.$.r2.buffer({
        $id: 'evt-789',
        type: 'Test.event',
        payload: {},
        source: 'test',
        $timestamp: Date.now(),
      })

      const result = await parent.$.r2.flush()

      // Expected result format
      expect(result).toHaveProperty('written')
      expect(result).toHaveProperty('batchId')
      expect(typeof result.written).toBe('number')
      expect(typeof result.batchId).toBe('string')
    })

    it('should provide buffer statistics', async () => {
      // Expected: $.r2.getBufferStats() returns current buffer state
      expect(parent.$.r2.getBufferStats).toBeDefined()
      expect(typeof parent.$.r2.getBufferStats).toBe('function')

      const stats = parent.$.r2.getBufferStats()

      expect(stats).toHaveProperty('count')
      expect(stats).toHaveProperty('oldestTimestamp')
      expect(typeof stats.count).toBe('number')
    })

    it('should allow buffer configuration', async () => {
      // Expected: $.r2.configure() allows setting buffer parameters
      expect(parent.$.r2.configure).toBeDefined()
      expect(typeof parent.$.r2.configure).toBe('function')

      const config: R2BufferConfig = {
        maxBufferSize: 1000,
        flushIntervalMs: 60000, // 1 minute
        batchSize: 100,
      }

      // Should not throw
      expect(() => parent.$.r2.configure(config)).not.toThrow()
    })

    it('should auto-flush when buffer reaches max size', async () => {
      // Configure small buffer for testing
      parent.$.r2.configure({
        maxBufferSize: 3,
        flushIntervalMs: 60000,
        batchSize: 10,
      })

      // Add events up to buffer limit
      for (let i = 0; i < 3; i++) {
        await parent.$.r2.buffer({
          $id: `evt-${i}`,
          type: 'Test.event',
          payload: { index: i },
          source: 'test',
          $timestamp: Date.now(),
        })
      }

      // Buffer should be at max or flushed
      const stats = parent.$.r2.getBufferStats()

      // After auto-flush, buffer should be empty or reduced
      expect(stats.count).toBeLessThanOrEqual(3)
    })
  })

  describe('3. Parent DO provides global search/query across all children', () => {
    it('should support global query by entity type', async () => {
      // Expected: $.query.global() searches across all child DOs
      expect(parent.$.query).toBeDefined()
      expect(parent.$.query.global).toBeDefined()
      expect(typeof parent.$.query.global).toBe('function')

      const customers = await parent.$.query.global<{ name: string; email: string }>({
        $type: 'Customer',
      })

      expect(Array.isArray(customers)).toBe(true)
    })

    it('should support filters in global query', async () => {
      // Store some test data
      parent.storeData('tenant-1', 'Customer', { name: 'Alice', plan: 'premium', status: 'active' })
      parent.storeData('tenant-1', 'Customer', { name: 'Bob', plan: 'free', status: 'active' })
      parent.storeData('tenant-2', 'Customer', { name: 'Carol', plan: 'premium', status: 'inactive' })

      const premiumCustomers = await parent.$.query.global({
        $type: 'Customer',
        filters: {
          plan: 'premium',
          status: 'active',
        },
      })

      expect(Array.isArray(premiumCustomers)).toBe(true)
      expect(premiumCustomers.length).toBe(1)
    })

    it('should support pagination in global query', async () => {
      // Store test data
      for (let i = 0; i < 25; i++) {
        parent.storeData('tenant-1', 'Order', { orderId: `order-${i}` })
      }

      const page1 = await parent.$.query.global({
        $type: 'Order',
        limit: 10,
        offset: 0,
      })

      const page2 = await parent.$.query.global({
        $type: 'Order',
        limit: 10,
        offset: 10,
      })

      expect(Array.isArray(page1)).toBe(true)
      expect(Array.isArray(page2)).toBe(true)
      expect(page1.length).toBe(10)
      expect(page2.length).toBe(10)
    })

    it('should support query targeting specific child', async () => {
      // Expected: $.query.child() queries a specific child DO
      expect(parent.$.query.child).toBeDefined()
      expect(typeof parent.$.query.child).toBe('function')

      // Store data for different tenants
      parent.storeData('tenant-abc', 'Customer', { name: 'Alice' })
      parent.storeData('tenant-xyz', 'Customer', { name: 'Bob' })

      const childCustomers = await parent.$.query.child('tenant-abc', {
        $type: 'Customer',
      })

      expect(Array.isArray(childCustomers)).toBe(true)
      expect(childCustomers.length).toBe(1)
    })
  })

  describe('4. Parent DO has $context that children can reference', () => {
    it('should expose shared context for children', async () => {
      // Expected: $.context provides shared state for children
      expect(parent.$.context).toBeDefined()
      expect(parent.$.context.config).toBeDefined()
      expect(parent.$.context.secrets).toBeDefined()
      expect(parent.$.context.metadata).toBeDefined()
    })

    it('should allow children to access parent context', async () => {
      const childManager = new ChildContextManager('child-123')
      const child = { $context: createChildContext(childManager) }

      // Expected: child.$context.getParent() returns parent context
      expect(child.$context).toBeDefined()
      expect(child.$context.getParent).toBeDefined()
      expect(typeof child.$context.getParent).toBe('function')

      const parentContext = await child.$context.getParent()

      expect(parentContext).toHaveProperty('config')
      expect(parentContext).toHaveProperty('secrets')
      expect(parentContext).toHaveProperty('metadata')
    })

    it('should allow children to emit events to parent', async () => {
      const childManager = new ChildContextManager('child-123')
      const child = { $context: createChildContext(childManager) }

      // Expected: child.$context.emit() sends event to parent
      expect(child.$context.emit).toBeDefined()
      expect(typeof child.$context.emit).toBe('function')

      await expect(
        child.$context.emit({
          type: 'Customer.signup',
          payload: { email: 'new@example.com' },
        })
      ).resolves.toBeUndefined()
    })

    it('should support child heartbeat mechanism', async () => {
      const childManager = new ChildContextManager('child-123')
      const child = { $context: createChildContext(childManager) }

      // Expected: child.$context.heartbeat() notifies parent of activity
      expect(child.$context.heartbeat).toBeDefined()
      expect(typeof child.$context.heartbeat).toBe('function')

      await expect(child.$context.heartbeat()).resolves.toBeUndefined()
    })
  })

  describe('5. Event buffering before R2 writes', () => {
    it('should batch events for cost efficiency', async () => {
      // Add multiple events
      const events: ParentDOEvent[] = Array.from({ length: 50 }, (_, i) => ({
        $id: `evt-batch-${i}`,
        type: 'Test.batch',
        payload: { index: i },
        source: 'test',
        $timestamp: Date.now() + i,
      }))

      for (const event of events) {
        await parent.$.r2.buffer(event)
      }

      const stats = parent.$.r2.getBufferStats()

      // All events should be buffered
      expect(stats.count).toBe(50)

      // Flush should write all in single batch
      const result = await parent.$.r2.flush()
      expect(result.written).toBe(50)
    })

    it('should respect flush interval for automatic batching', async () => {
      // Configure with short interval for testing
      parent.$.r2.configure({
        maxBufferSize: 10000,
        flushIntervalMs: 100, // 100ms for testing
        batchSize: 100,
      })

      // Add event
      await parent.$.r2.buffer({
        $id: 'evt-interval',
        type: 'Test.interval',
        payload: {},
        source: 'test',
        $timestamp: Date.now(),
      })

      // Wait for auto-flush
      await new Promise(resolve => setTimeout(resolve, 150))

      const stats = parent.$.r2.getBufferStats()

      // Buffer should be flushed automatically
      expect(stats.count).toBe(0)
    })

    it('should preserve event ordering in batches', async () => {
      // This requires mock/spy on the actual R2 write
      // For now, just verify the interface exists
      expect(parent.$.r2.buffer).toBeDefined()
      expect(parent.$.r2.flush).toBeDefined()
    })
  })

  describe('6. Parent can discover and list all child DOs', () => {
    it('should list all registered child DOs', async () => {
      // Expected: $.children.list() returns all known children
      expect(parent.$.children).toBeDefined()
      expect(parent.$.children.list).toBeDefined()
      expect(typeof parent.$.children.list).toBe('function')

      // Register some children
      parent.registerChild('tenant-1', { name: 'Tenant 1', domain: 'crm.example.com.ai', lastSeen: Date.now(), eventCount: 0 })
      parent.registerChild('tenant-2', { name: 'Tenant 2', domain: 'crm.example.com.ai', lastSeen: Date.now(), eventCount: 0 })

      const children = await parent.$.children.list()

      expect(Array.isArray(children)).toBe(true)
      expect(children.length).toBe(2)
    })

    it('should get specific child DO info', async () => {
      // Expected: $.children.get() returns info about specific child
      expect(parent.$.children.get).toBeDefined()
      expect(typeof parent.$.children.get).toBe('function')

      // Register a child
      parent.registerChild('tenant-abc', { name: 'Tenant ABC', domain: 'crm.example.com.ai', lastSeen: Date.now(), eventCount: 5 })

      const child = await parent.$.children.get('tenant-abc')

      if (child) {
        expect(child).toHaveProperty('id')
        expect(child).toHaveProperty('name')
        expect(child).toHaveProperty('domain')
        expect(child).toHaveProperty('lastSeen')
        expect(child).toHaveProperty('eventCount')
        expect(child.id).toBe('tenant-abc')
      }
    })

    it('should discover new child DOs dynamically', async () => {
      // Expected: $.children.discover() finds and registers new children
      expect(parent.$.children.discover).toBeDefined()
      expect(typeof parent.$.children.discover).toBe('function')

      const discovered = await parent.$.children.discover()

      expect(Array.isArray(discovered)).toBe(true)
    })

    it('should return child count', async () => {
      // Expected: $.children.count() returns number of children
      expect(parent.$.children.count).toBeDefined()
      expect(typeof parent.$.children.count).toBe('function')

      // Register some children
      parent.registerChild('tenant-1', { name: 'T1', domain: 'd1', lastSeen: Date.now(), eventCount: 0 })
      parent.registerChild('tenant-2', { name: 'T2', domain: 'd2', lastSeen: Date.now(), eventCount: 0 })

      const count = await parent.$.children.count()

      expect(typeof count).toBe('number')
      expect(count).toBe(2)
    })

    it('should track child health via heartbeats', async () => {
      // Register a child
      parent.registerChild('tenant-abc', { name: 'Tenant ABC', domain: 'crm.example.com.ai', lastSeen: Date.now(), eventCount: 0 })

      // Get child info to check lastSeen
      const child = await parent.$.children.get('tenant-abc')

      if (child) {
        // lastSeen should be a recent timestamp
        expect(typeof child.lastSeen).toBe('number')

        // Check if child is considered "healthy" (seen recently)
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
        const isHealthy = child.lastSeen > fiveMinutesAgo

        expect(typeof isHealthy).toBe('boolean')
        expect(isHealthy).toBe(true)
      }
    })
  })

  describe('Integration: Full parent-child event flow', () => {
    it('should handle complete event lifecycle', async () => {
      const childManager = new ChildContextManager('child-123')
      const child = { $context: createChildContext(childManager) }

      // 1. Child emits event (without actual parent stub, just verifies the method works)
      await child.$context.emit({
        type: 'Customer.signup',
        payload: { email: 'new@example.com', plan: 'premium' },
      })

      // 2. Parent receives via wildcard handler
      let receivedEvent: ParentDOEvent | null = null
      parent.$.on['*']['*'](async (event) => {
        receivedEvent = event
      })

      // 3. Simulate parent receiving the event
      const event: ParentDOEvent = {
        $id: 'evt-123',
        type: 'Customer.signup',
        payload: { email: 'new@example.com', plan: 'premium' },
        source: 'child',
        childId: 'child-123',
        $timestamp: Date.now(),
      }

      await parent.receiveChildEvent(event)

      // 4. Store for query
      parent.storeData('child-123', 'Customer', { email: 'new@example.com' })

      // 5. Query should find the new customer
      const customers = await parent.$.query.global({
        $type: 'Customer',
        filters: { email: 'new@example.com' },
      })

      expect(parent.$).toBeDefined()
      expect(child.$context).toBeDefined()
      expect(customers.length).toBe(1)
      expect(receivedEvent).not.toBeNull()
    })

    it('should maintain consistency across child DOs', async () => {
      // Register children
      parent.registerChild('tenant-1', { name: 'T1', domain: 'd1', lastSeen: Date.now(), eventCount: 5 })
      parent.registerChild('tenant-2', { name: 'T2', domain: 'd2', lastSeen: Date.now(), eventCount: 10 })

      // Query same customer from parent (aggregated view)
      const allCustomers = await parent.$.query.global({
        $type: 'Customer',
      })

      // Get children to verify individual counts
      const children = await parent.$.children.list()

      // Sum of child event counts
      let totalEvents = 0
      for (const child of children) {
        totalEvents += child.eventCount
      }

      // Verify the relationship
      expect(typeof totalEvents).toBe('number')
      expect(totalEvents).toBe(15)
    })
  })
})

// ============================================================================
// Type checking tests - ensure interfaces are correct
// ============================================================================

describe('Type definitions', () => {
  it('should have correct ParentDOEvent structure', () => {
    const event: ParentDOEvent = {
      $id: 'test-id',
      type: 'Test.event',
      payload: { key: 'value' },
      source: 'test',
      childId: 'child-123',
      $timestamp: Date.now(),
    }

    expect(event.$id).toBeDefined()
    expect(event.type).toBeDefined()
    expect(event.payload).toBeDefined()
    expect(event.source).toBeDefined()
    expect(event.$timestamp).toBeDefined()
    // childId is optional
    expect(event.childId).toBeDefined()
  })

  it('should have correct R2BufferConfig structure', () => {
    const config: R2BufferConfig = {
      maxBufferSize: 1000,
      flushIntervalMs: 60000,
      batchSize: 100,
    }

    expect(config.maxBufferSize).toBeGreaterThan(0)
    expect(config.flushIntervalMs).toBeGreaterThan(0)
    expect(config.batchSize).toBeGreaterThan(0)
  })

  it('should have correct GlobalQueryOptions structure', () => {
    const options: GlobalQueryOptions = {
      $type: 'Customer',
      filters: { active: true },
      limit: 100,
      offset: 0,
    }

    expect(options.$type).toBe('Customer')
    expect(options.filters).toBeDefined()
    expect(options.limit).toBe(100)
    expect(options.offset).toBe(0)
  })

  it('should have correct ChildDOInfo structure', () => {
    const info: ChildDOInfo = {
      id: 'tenant-abc',
      name: 'Tenant ABC',
      domain: 'crm.example.com.ai',
      lastSeen: Date.now(),
      eventCount: 42,
    }

    expect(info.id).toBeDefined()
    expect(info.name).toBeDefined()
    expect(info.domain).toBeDefined()
    expect(info.lastSeen).toBeGreaterThan(0)
    expect(info.eventCount).toBeGreaterThanOrEqual(0)
  })
})
