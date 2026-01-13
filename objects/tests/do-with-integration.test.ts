/**
 * DO.with() Miniflare Integration Tests
 *
 * These tests verify that DO.with() eagerly initializes features via
 * blockConcurrencyWhile() in REAL miniflare DOs with SQLite storage.
 *
 * IMPORTANT: NO MOCKS are used - this tests actual DO runtime behavior.
 * Tests verify that:
 * - Eager initialization runs via blockConcurrencyWhile()
 * - Features are available on first request without lazy init delay
 * - Multiple features can be composed together
 * - Static _eagerFeatures config is correctly inherited
 *
 * Test Strategy:
 * - Each test uses a unique namespace to ensure isolation
 * - We verify tables exist and stores are functional on first access
 * - We compare eager init (DO.with()) vs lazy init (base DO) behavior
 *
 * Run with: npx vitest run objects/tests/do-with-integration.test.ts --project=do-with-integration
 *
 * @module objects/tests/do-with-integration.test
 */

import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// Type Definitions for RPC Stubs
// ============================================================================

interface DOWithThingsStub extends DurableObjectStub {
  tableExists(tableName: string): Promise<boolean>
  getInitTimestamp(): Promise<number>
  getFeaturesInitialized(): Promise<string[]>
  isThingsReady(): Promise<boolean>
  isRelsReady(): Promise<boolean>
  isEventsReady(): Promise<boolean>
  isSearchReady(): Promise<boolean>
  createThing(data: { $type: string; name: string }): Promise<{
    $id: string
    $type: string
    name: string
    success: boolean
  }>
  getThing(id: string): Promise<{ $id: string; $type: string; name: string } | null>
}

interface DOWithSearchStub extends DurableObjectStub {
  tableExists(tableName: string): Promise<boolean>
  getInitTimestamp(): Promise<number>
  getFeaturesInitialized(): Promise<string[]>
  isSearchReady(): Promise<boolean>
  isThingsReady(): Promise<boolean>
  indexDocument(data: { $id: string; $type: string; content: string }): Promise<{
    $id: string
    success: boolean
  }>
  searchDocuments(query: string): Promise<{ $id: string; score: number }[]>
}

interface DOWithMultipleStub extends DurableObjectStub {
  tableExists(tableName: string): Promise<boolean>
  getInitTimestamp(): Promise<number>
  getFeaturesInitialized(): Promise<string[]>
  isThingsReady(): Promise<boolean>
  isRelsReady(): Promise<boolean>
  isEventsReady(): Promise<boolean>
  isActionsReady(): Promise<boolean>
  createThing(data: { $type: string; name: string }): Promise<{
    $id: string
    $type: string
    name: string
    success: boolean
  }>
  getThing(id: string): Promise<{ $id: string; $type: string; name: string } | null>
  createRelationship(data: { verb: string; from: string; to: string }): Promise<{
    id: string
    success: boolean
  }>
  emitEvent(data: { verb: string; source: string; data: Record<string, unknown> }): Promise<{
    id: string
    success: boolean
  }>
  logAction(data: { verb: string; target: string }): Promise<{
    id: string
    success: boolean
  }>
}

interface DOBaseStub extends DurableObjectStub {
  tableExists(tableName: string): Promise<boolean>
  getInitTimestamp(): Promise<number>
  getFeaturesInitialized(): Promise<string[]>
  isThingsReady(): Promise<boolean>
  isRelsReady(): Promise<boolean>
  isEventsReady(): Promise<boolean>
  isSearchReady(): Promise<boolean>
  isActionsReady(): Promise<boolean>
  createThing(data: { $type: string; name: string }): Promise<{
    $id: string
    $type: string
    name: string
    success: boolean
  }>
  getThing(id: string): Promise<{ $id: string; $type: string; name: string } | null>
  createRelationship(data: { verb: string; from: string; to: string }): Promise<{
    id: string
    success: boolean
  }>
  emitEvent(data: { verb: string; source: string; data: Record<string, unknown> }): Promise<{
    id: string
    success: boolean
  }>
}

// Env type with DO bindings
interface TestEnv {
  DO_WITH_THINGS: DurableObjectNamespace
  DO_WITH_SEARCH: DurableObjectNamespace
  DO_WITH_MULTIPLE: DurableObjectNamespace
  DO_BASE: DurableObjectNamespace
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Unique prefix per test run for namespace isolation
 */
const testRunId = Date.now()

/**
 * Generate a unique namespace for each test
 */
function uniqueNs(prefix: string = 'test'): string {
  return `${prefix}-${testRunId}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get typed DO stub by class name
 */
function getStub<T extends DurableObjectStub>(
  className: 'DOWithThings' | 'DOWithSearch' | 'DOWithMultiple' | 'DOBase',
  namespace: string
): T {
  const testEnv = env as unknown as TestEnv
  let binding: DurableObjectNamespace

  switch (className) {
    case 'DOWithThings':
      binding = testEnv.DO_WITH_THINGS
      break
    case 'DOWithSearch':
      binding = testEnv.DO_WITH_SEARCH
      break
    case 'DOWithMultiple':
      binding = testEnv.DO_WITH_MULTIPLE
      break
    case 'DOBase':
      binding = testEnv.DO_BASE
      break
  }

  const id = binding.idFromName(namespace)
  return binding.get(id) as T
}

// ============================================================================
// DO.with({ things: true }) Tests
// ============================================================================

describe('DO.with({ things: true }) Eager Initialization', () => {
  /**
   * Test that things table is ready immediately on first RPC call.
   * This verifies blockConcurrencyWhile() ran during construction.
   */
  it('has things table ready on first request', async () => {
    const ns = uniqueNs('things-ready')
    const stub = getStub<DOWithThingsStub>('DOWithThings', ns)

    // First RPC call should find table already exists
    const thingsReady = await stub.isThingsReady()

    expect(thingsReady).toBe(true)
  })

  /**
   * Test that ThingsStore operations work on first request without errors.
   * This verifies eager initialization actually initialized the store.
   */
  it('can create thing on first request', async () => {
    const ns = uniqueNs('things-create')
    const stub = getStub<DOWithThingsStub>('DOWithThings', ns)

    // First request should succeed - no lazy init needed
    const result = await stub.createThing({
      $type: 'Customer',
      name: 'Alice',
    })

    expect(result.success).toBe(true)
    expect(result.$type).toBe('Customer')
    expect(result.name).toBe('Alice')
    expect(result.$id).toBeDefined()
  })

  /**
   * Test that created things can be retrieved immediately.
   */
  it('can retrieve thing immediately after creation', async () => {
    const ns = uniqueNs('things-retrieve')
    const stub = getStub<DOWithThingsStub>('DOWithThings', ns)

    // Create
    const created = await stub.createThing({
      $type: 'Customer',
      name: 'Bob',
    })

    // Retrieve
    const retrieved = await stub.getThing(created.$id)

    expect(retrieved).not.toBeNull()
    expect(retrieved?.$id).toBe(created.$id)
    expect(retrieved?.name).toBe('Bob')
  })

  /**
   * Test that getFeaturesInitialized() returns 'things'.
   */
  it('reports things as initialized feature', async () => {
    const ns = uniqueNs('things-features')
    const stub = getStub<DOWithThingsStub>('DOWithThings', ns)

    const features = await stub.getFeaturesInitialized()

    expect(features).toContain('things')
  })

  /**
   * Test that init timestamp is set during construction.
   */
  it('has init timestamp from construction time', async () => {
    const beforeCreate = Date.now()
    const ns = uniqueNs('things-timestamp')
    const stub = getStub<DOWithThingsStub>('DOWithThings', ns)

    // First call triggers construction
    const initTimestamp = await stub.getInitTimestamp()
    const afterCreate = Date.now()

    expect(initTimestamp).toBeGreaterThanOrEqual(beforeCreate)
    expect(initTimestamp).toBeLessThanOrEqual(afterCreate)
  })
})

// ============================================================================
// DO.with({ search: true }) Tests
// ============================================================================

describe('DO.with({ search: true }) Eager Initialization', () => {
  /**
   * Test that search table is ready immediately.
   */
  it('has search table ready on first request', async () => {
    const ns = uniqueNs('search-ready')
    const stub = getStub<DOWithSearchStub>('DOWithSearch', ns)

    const searchReady = await stub.isSearchReady()

    expect(searchReady).toBe(true)
  })

  /**
   * Test that search indexing works on first request.
   */
  it('can index document on first request', async () => {
    const ns = uniqueNs('search-index')
    const stub = getStub<DOWithSearchStub>('DOWithSearch', ns)

    const result = await stub.indexDocument({
      $id: 'doc-1',
      $type: 'Document',
      content: 'This is a test document about eager initialization.',
    })

    expect(result.success).toBe(true)
    expect(result.$id).toBe('doc-1')
  })

  /**
   * Test that getFeaturesInitialized() returns 'search'.
   */
  it('reports search as initialized feature', async () => {
    const ns = uniqueNs('search-features')
    const stub = getStub<DOWithSearchStub>('DOWithSearch', ns)

    const features = await stub.getFeaturesInitialized()

    expect(features).toContain('search')
  })
})

// ============================================================================
// DO.with({ things, relationships, events, actions }) Tests
// ============================================================================

describe('DO.with() Multiple Features Composed', () => {
  /**
   * Test that all specified features are ready on first request.
   */
  it('has all tables ready on first request', async () => {
    const ns = uniqueNs('multi-ready')
    const stub = getStub<DOWithMultipleStub>('DOWithMultiple', ns)

    // All should be ready
    const [thingsReady, relsReady, eventsReady, actionsReady] = await Promise.all([
      stub.isThingsReady(),
      stub.isRelsReady(),
      stub.isEventsReady(),
      stub.isActionsReady(),
    ])

    expect(thingsReady).toBe(true)
    expect(relsReady).toBe(true)
    expect(eventsReady).toBe(true)
    expect(actionsReady).toBe(true)
  })

  /**
   * Test that getFeaturesInitialized() returns all features.
   */
  it('reports all features as initialized', async () => {
    const ns = uniqueNs('multi-features')
    const stub = getStub<DOWithMultipleStub>('DOWithMultiple', ns)

    const features = await stub.getFeaturesInitialized()

    expect(features).toContain('things')
    expect(features).toContain('relationships')
    expect(features).toContain('events')
    expect(features).toContain('actions')
  })

  /**
   * Test that all store operations work on first request.
   */
  it('can use all stores on first request', async () => {
    const ns = uniqueNs('multi-ops')
    const stub = getStub<DOWithMultipleStub>('DOWithMultiple', ns)

    // Create thing
    const thing = await stub.createThing({
      $type: 'Customer',
      name: 'Charlie',
    })
    expect(thing.success).toBe(true)

    // Create relationship
    const rel = await stub.createRelationship({
      verb: 'owns',
      from: thing.$id,
      to: 'Product/widget-1',
    })
    expect(rel.success).toBe(true)

    // Emit event
    const event = await stub.emitEvent({
      verb: 'created',
      source: thing.$id,
      data: { name: 'Charlie' },
    })
    expect(event.success).toBe(true)

    // Log action
    const action = await stub.logAction({
      verb: 'create',
      target: thing.$id,
    })
    expect(action.success).toBe(true)
  })

  /**
   * Test complex workflow with multiple stores.
   */
  it('supports complex multi-store workflow', async () => {
    const ns = uniqueNs('multi-workflow')
    const stub = getStub<DOWithMultipleStub>('DOWithMultiple', ns)

    // Create customer
    const customer = await stub.createThing({
      $type: 'Customer',
      name: 'Dave',
    })

    // Create order
    const order = await stub.createThing({
      $type: 'Order',
      name: 'Order #1',
    })

    // Create product
    const product = await stub.createThing({
      $type: 'Product',
      name: 'Widget',
    })

    // Create relationships
    await stub.createRelationship({
      verb: 'placed',
      from: customer.$id,
      to: order.$id,
    })

    await stub.createRelationship({
      verb: 'contains',
      from: order.$id,
      to: product.$id,
    })

    // Emit order event
    const event = await stub.emitEvent({
      verb: 'placed',
      source: order.$id,
      data: {
        customer: customer.$id,
        product: product.$id,
      },
    })

    expect(event.success).toBe(true)

    // Verify things persist
    const retrieved = await stub.getThing(customer.$id)
    expect(retrieved?.name).toBe('Dave')
  })
})

// ============================================================================
// Base DO (No Eager Init) Comparison Tests
// ============================================================================

describe('Base DO (No Eager Init) Comparison', () => {
  /**
   * Test that base DO also has tables (from schema init).
   * This verifies our test setup works.
   */
  it('has tables after schema initialization', async () => {
    const ns = uniqueNs('base-tables')
    const stub = getStub<DOBaseStub>('DOBase', ns)

    // Base DO initializes schema in constructor too
    const thingsReady = await stub.isThingsReady()

    expect(thingsReady).toBe(true)
  })

  /**
   * Test that base DO can perform operations.
   */
  it('can create things in base DO', async () => {
    const ns = uniqueNs('base-create')
    const stub = getStub<DOBaseStub>('DOBase', ns)

    const result = await stub.createThing({
      $type: 'Customer',
      name: 'Eve',
    })

    expect(result.success).toBe(true)
    expect(result.name).toBe('Eve')
  })

  /**
   * Test that base DO reports no eager features.
   * (It uses manual schema init, not DO.with())
   */
  it('reports no eager features', async () => {
    const ns = uniqueNs('base-features')
    const stub = getStub<DOBaseStub>('DOBase', ns)

    const features = await stub.getFeaturesInitialized()

    expect(features).toEqual([])
  })
})

// ============================================================================
// Isolation Tests
// ============================================================================

describe('DO Isolation Between Namespaces', () => {
  /**
   * Test that different namespaces have isolated storage.
   */
  it('isolates data between namespaces', async () => {
    const ns1 = uniqueNs('isolation-1')
    const ns2 = uniqueNs('isolation-2')

    const stub1 = getStub<DOWithThingsStub>('DOWithThings', ns1)
    const stub2 = getStub<DOWithThingsStub>('DOWithThings', ns2)

    // Create thing in ns1
    const thing1 = await stub1.createThing({
      $type: 'Customer',
      name: 'Namespace1Customer',
    })

    // Create thing in ns2
    const thing2 = await stub2.createThing({
      $type: 'Customer',
      name: 'Namespace2Customer',
    })

    // Verify each namespace has its own data
    const retrieved1 = await stub1.getThing(thing1.$id)
    const retrieved2 = await stub2.getThing(thing2.$id)

    expect(retrieved1?.name).toBe('Namespace1Customer')
    expect(retrieved2?.name).toBe('Namespace2Customer')

    // Verify ns1 doesn't have ns2's thing
    const crossCheck1 = await stub1.getThing(thing2.$id)
    const crossCheck2 = await stub2.getThing(thing1.$id)

    expect(crossCheck1).toBeNull()
    expect(crossCheck2).toBeNull()
  })

  /**
   * Test that different DO classes maintain separate storage.
   */
  it('isolates data between DO classes', async () => {
    const ns = uniqueNs('class-isolation')

    const thingsStub = getStub<DOWithThingsStub>('DOWithThings', ns)
    const multiStub = getStub<DOWithMultipleStub>('DOWithMultiple', ns)

    // Create in DOWithThings
    const thing1 = await thingsStub.createThing({
      $type: 'Customer',
      name: 'ThingsCustomer',
    })

    // Create in DOWithMultiple
    const thing2 = await multiStub.createThing({
      $type: 'Customer',
      name: 'MultiCustomer',
    })

    // Each should only see its own data (different DO instances)
    const retrieved1 = await thingsStub.getThing(thing1.$id)
    const retrieved2 = await multiStub.getThing(thing2.$id)

    expect(retrieved1?.name).toBe('ThingsCustomer')
    expect(retrieved2?.name).toBe('MultiCustomer')
  })
})

// ============================================================================
// Concurrent Access Tests
// ============================================================================

describe('Concurrent Access with Eager Initialization', () => {
  /**
   * Test that multiple concurrent requests work correctly.
   * Eager init via blockConcurrencyWhile() should ensure all
   * requests see initialized state.
   */
  it('handles concurrent requests after eager init', async () => {
    const ns = uniqueNs('concurrent')
    const stub = getStub<DOWithMultipleStub>('DOWithMultiple', ns)

    // Fire off multiple concurrent operations
    const results = await Promise.all([
      stub.createThing({ $type: 'Customer', name: 'Concurrent1' }),
      stub.createThing({ $type: 'Customer', name: 'Concurrent2' }),
      stub.createThing({ $type: 'Customer', name: 'Concurrent3' }),
      stub.createThing({ $type: 'Order', name: 'Order1' }),
      stub.createThing({ $type: 'Order', name: 'Order2' }),
    ])

    // All should succeed
    expect(results.every((r) => r.success)).toBe(true)

    // All should have unique IDs
    const ids = results.map((r) => r.$id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(results.length)
  })

  /**
   * Test that concurrent reads and writes work correctly.
   */
  it('handles concurrent reads and writes', async () => {
    const ns = uniqueNs('read-write')
    const stub = getStub<DOWithThingsStub>('DOWithThings', ns)

    // Create initial data
    const created = await stub.createThing({
      $type: 'Customer',
      name: 'Initial',
    })

    // Concurrent reads and writes
    const results = await Promise.all([
      stub.getThing(created.$id),
      stub.createThing({ $type: 'Customer', name: 'New1' }),
      stub.getThing(created.$id),
      stub.createThing({ $type: 'Customer', name: 'New2' }),
      stub.getThing(created.$id),
    ])

    // All reads should return the same thing
    const reads = results.filter((r) => r && 'name' in r && r.name === 'Initial')
    expect(reads.length).toBe(3)

    // Both creates should succeed
    const creates = results.filter((r) => r && 'success' in r)
    expect(creates.length).toBe(2)
  })
})

// ============================================================================
// Static Configuration Tests
// ============================================================================

describe('Static _eagerFeatures Configuration', () => {
  /**
   * Test that DO.with() creates classes with correct static config.
   * Note: We verify this indirectly through getFeaturesInitialized().
   */
  it('DOWithThings has things in eager features', async () => {
    const ns = uniqueNs('static-things')
    const stub = getStub<DOWithThingsStub>('DOWithThings', ns)

    const features = await stub.getFeaturesInitialized()

    expect(features).toContain('things')
    expect(features).not.toContain('search')
    expect(features).not.toContain('events')
  })

  it('DOWithSearch has search in eager features', async () => {
    const ns = uniqueNs('static-search')
    const stub = getStub<DOWithSearchStub>('DOWithSearch', ns)

    const features = await stub.getFeaturesInitialized()

    expect(features).toContain('search')
    expect(features).not.toContain('things')
  })

  it('DOWithMultiple has all specified features', async () => {
    const ns = uniqueNs('static-multi')
    const stub = getStub<DOWithMultipleStub>('DOWithMultiple', ns)

    const features = await stub.getFeaturesInitialized()

    expect(features).toContain('things')
    expect(features).toContain('relationships')
    expect(features).toContain('events')
    expect(features).toContain('actions')
    expect(features).not.toContain('search')
    expect(features).not.toContain('vectors')
  })
})
