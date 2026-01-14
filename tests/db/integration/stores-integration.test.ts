/**
 * Integration Tests: Store Primitives Working Together
 *
 * These tests verify that all db primitives work correctly together:
 * - CDC flow: Store mutations -> CDC events -> verification
 * - Cross-store: GraphStore interactions with CDC
 * - Hybrid search: VectorStore + FTS working together
 * - Workflow with stores: Workflows using stores in activities
 * - Stream to store: Producer -> Consumer -> Store patterns
 *
 * Note: All stores use in-memory backends (not native SQLite)
 * to enable running in any environment without native bindings.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Store imports - these use in-memory backends
import { GraphStore } from '../../../db/graph/store'
import { VectorStore } from '../../../db/vector'
import {
  AdminClient,
  Producer,
  Consumer,
  Topic,
  _resetStorage,
} from '../../../db/stream'
import {
  workflow,
  defineActivity,
  WorkflowClient,
  clearWorkflows,
  clearActivities,
} from '../../../db/workflow'
import { CDCEmitter, createCDCEvent, type UnifiedEvent } from '../../../db/cdc'

// =============================================================================
// TEST TYPES
// =============================================================================

interface Customer {
  name: string
  email: string
  tier?: string
  metadata?: Record<string, unknown>
}

interface Order {
  customerId: string
  items: Array<{ sku: string; quantity: number; price: number }>
  status: string
  total: number
}

interface CDCTestEvent {
  type: string
  op: string
  store: string
  table: string
  key: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

// =============================================================================
// MOCK HELPERS
// =============================================================================

function createMockPipeline() {
  return {
    send: vi.fn().mockResolvedValue(undefined),
  }
}

function createMockDb() {
  return {
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(),
    }),
  }
}

// =============================================================================
// TEST 1: CDC FLOW - Store mutations -> CDC events -> verify structure
// =============================================================================

describe('CDC Flow Integration', () => {
  let mockPipeline: ReturnType<typeof createMockPipeline>
  let emitter: CDCEmitter

  beforeEach(() => {
    mockPipeline = createMockPipeline()
    emitter = new CDCEmitter(mockPipeline as any, {
      ns: 'test.integration',
      source: 'DO/customers',
    })
  })

  it('emits CDC event on document create with correct structure', async () => {
    const result = await emitter.emit({
      op: 'c',
      store: 'document',
      table: 'Customer',
      key: 'cust_123',
      after: {
        name: 'Alice Smith',
        email: 'alice@example.com',
        tier: 'premium',
      },
    })

    expect(result.id).toBeDefined()
    expect(result.id.length).toBe(26) // ULID length
    expect(result.type).toBe('cdc.insert')
    expect(result.op).toBe('c')
    expect(result.store).toBe('document')
    expect(result.table).toBe('Customer')
    expect(result.key).toBe('cust_123')
    expect(result.after).toEqual({
      name: 'Alice Smith',
      email: 'alice@example.com',
      tier: 'premium',
    })

    // Verify pipeline was called
    expect(mockPipeline.send).toHaveBeenCalledTimes(1)
  })

  it('emits CDC events for update with before/after diffs', async () => {
    const result = await emitter.emit({
      op: 'u',
      store: 'document',
      table: 'Customer',
      key: 'cust_123',
      before: { tier: 'basic' },
      after: { tier: 'enterprise' },
    })

    expect(result.type).toBe('cdc.update')
    expect(result.op).toBe('u')
    expect(result.before).toEqual({ tier: 'basic' })
    expect(result.after).toEqual({ tier: 'enterprise' })
  })

  it('emits CDC event on delete with before data', async () => {
    const result = await emitter.emit({
      op: 'd',
      store: 'document',
      table: 'Customer',
      key: 'cust_123',
      before: {
        name: 'Charlie Brown',
        email: 'charlie@example.com',
      },
    })

    expect(result.type).toBe('cdc.delete')
    expect(result.op).toBe('d')
    expect(result.key).toBe('cust_123')
    expect(result.before).toEqual({
      name: 'Charlie Brown',
      email: 'charlie@example.com',
    })
  })

  it('maintains CDC event ordering for batch operations', async () => {
    const results = await emitter.emitBatch([
      { op: 'c', store: 'document', table: 'Customer', key: 'u1', after: { name: 'User 1' } },
      { op: 'c', store: 'document', table: 'Customer', key: 'u2', after: { name: 'User 2' } },
      { op: 'c', store: 'document', table: 'Customer', key: 'u3', after: { name: 'User 3' } },
    ])

    expect(results).toHaveLength(3)
    expect(results[0].lsn).toBe(0)
    expect(results[1].lsn).toBe(1)
    expect(results[2].lsn).toBe(2)
    expect(results[0].key).toBe('u1')
    expect(results[1].key).toBe('u2')
    expect(results[2].key).toBe('u3')

    // All events sent in single batch call
    expect(mockPipeline.send).toHaveBeenCalledTimes(1)
  })

  it('propagates correlation ID across events', async () => {
    const correlatedEmitter = emitter.withCorrelation('req-abc-123')

    const result = await correlatedEmitter.emit({
      op: 'c',
      store: 'document',
      table: 'Customer',
      key: 'cust_123',
      after: { name: 'Alice' },
    })

    expect(result.correlationId).toBe('req-abc-123')
  })

  it('uses createCDCEvent helper for event generation', () => {
    const event = createCDCEvent({
      op: 'c',
      store: 'document',
      table: 'Customer',
      key: 'cust_123',
      after: { name: 'Test' },
    })

    expect(event.id).toBeDefined()
    expect(event.timestamp).toBeDefined()
    expect(event.type).toBe('cdc.insert')
    expect(event._meta?.schemaVersion).toBe(1)
  })
})

// =============================================================================
// TEST 2: CROSS-STORE - GraphStore CDC integration
// =============================================================================

describe('Cross-Store Integration: Graph + CDC', () => {
  let graph: GraphStore
  let graphCDCEvents: CDCTestEvent[]
  const mockDb = createMockDb()

  beforeEach(() => {
    vi.clearAllMocks()
    graphCDCEvents = []
    graph = new GraphStore(mockDb as any)
    graph.onCDC((event) => graphCDCEvents.push(event as CDCTestEvent))
  })

  it('creates graph edges and emits CDC events', async () => {
    // Create a relationship
    const relationship = await graph.relate({
      from: 'Customer/cust_123',
      to: 'Order/ord_456',
      type: 'placed',
      data: { timestamp: Date.now() },
    })

    expect(relationship.from).toBe('Customer/cust_123')
    expect(relationship.to).toBe('Order/ord_456')
    expect(relationship.type).toBe('placed')
    expect(relationship.from_type).toBe('Customer')
    expect(relationship.to_type).toBe('Order')

    // Verify CDC event
    expect(graphCDCEvents).toHaveLength(1)
    expect(graphCDCEvents[0].type).toBe('cdc.insert')
    expect(graphCDCEvents[0].op).toBe('c')
    expect(graphCDCEvents[0].store).toBe('graph')
    expect(graphCDCEvents[0].table).toBe('relationships')
  })

  it('handles bidirectional lookups with CDC tracking', async () => {
    // Create customer and multiple orders
    await graph.relate({ from: 'Customer/alice', to: 'Order/ord_1', type: 'placed' })
    await graph.relate({ from: 'Customer/alice', to: 'Order/ord_2', type: 'placed' })
    await graph.relate({ from: 'Customer/alice', to: 'Order/ord_3', type: 'placed' })

    // Query outgoing edges
    const orders = await graph.outgoing('Customer/alice', { type: 'placed' })
    expect(orders).toHaveLength(3)

    // All creates should have emitted CDC events
    expect(graphCDCEvents).toHaveLength(3)
    expect(graphCDCEvents.every((e) => e.op === 'c')).toBe(true)
  })

  it('emits CDC delete event on unrelate', async () => {
    await graph.relate({ from: 'User/alice', to: 'User/bob', type: 'follows' })
    graphCDCEvents.length = 0 // Clear insert event

    const deleted = await graph.unrelate('User/alice', 'User/bob', 'follows')
    expect(deleted).toBe(true)

    expect(graphCDCEvents).toHaveLength(1)
    expect(graphCDCEvents[0].type).toBe('cdc.delete')
    expect(graphCDCEvents[0].op).toBe('d')
  })

  it('emits CDC update event on relationship data update', async () => {
    await graph.relate({
      from: 'User/alice',
      to: 'Team/engineering',
      type: 'memberOf',
      data: { role: 'member' },
    })
    graphCDCEvents.length = 0

    await graph.updateRelationship('User/alice', 'Team/engineering', 'memberOf', {
      data: { role: 'lead' },
    })

    expect(graphCDCEvents).toHaveLength(1)
    expect(graphCDCEvents[0].type).toBe('cdc.update')
    expect(graphCDCEvents[0].op).toBe('u')
    expect(graphCDCEvents[0].before).toEqual({ data: { role: 'member' } })
    expect(graphCDCEvents[0].after).toEqual({ data: { role: 'lead' } })
  })

  it('supports graph traversal with CDC event emission', async () => {
    // Create a follow chain: alice -> bob -> carol -> dave
    await graph.relate({ from: 'User/alice', to: 'User/bob', type: 'follows' })
    await graph.relate({ from: 'User/bob', to: 'User/carol', type: 'follows' })
    await graph.relate({ from: 'User/carol', to: 'User/dave', type: 'follows' })

    // Traverse
    const result = await graph.traverse({
      start: 'User/alice',
      direction: 'outgoing',
      types: ['follows'],
      maxDepth: 3,
    })

    expect(result.nodes).toHaveLength(3)
    expect(result.nodes.map((n) => n.id)).toContain('User/bob')
    expect(result.nodes.map((n) => n.id)).toContain('User/carol')
    expect(result.nodes.map((n) => n.id)).toContain('User/dave')

    // All edge creations emitted CDC events
    expect(graphCDCEvents).toHaveLength(3)
  })

  it('detects cycles in graph relationships', async () => {
    await graph.relate({ from: 'User/alice', to: 'User/bob', type: 'reportsTo' })
    await graph.relate({ from: 'User/bob', to: 'User/carol', type: 'reportsTo' })
    await graph.relate({ from: 'User/carol', to: 'User/alice', type: 'reportsTo' })

    const hasCycle = await graph.detectCycle('User/alice', 'reportsTo')
    expect(hasCycle).toBe(true)
  })

  it('finds shortest path between nodes', async () => {
    // Direct path: alice -> eve -> dave (length 2)
    // Longer path: alice -> bob -> carol -> dave (length 3)
    await graph.relate({ from: 'User/alice', to: 'User/bob', type: 'follows' })
    await graph.relate({ from: 'User/bob', to: 'User/carol', type: 'follows' })
    await graph.relate({ from: 'User/carol', to: 'User/dave', type: 'follows' })
    await graph.relate({ from: 'User/alice', to: 'User/eve', type: 'follows' })
    await graph.relate({ from: 'User/eve', to: 'User/dave', type: 'follows' })

    const path = await graph.shortestPath({
      from: 'User/alice',
      to: 'User/dave',
      types: ['follows'],
    })

    expect(path).toEqual(['User/alice', 'User/eve', 'User/dave'])
  })
})

// =============================================================================
// TEST 3: HYBRID SEARCH - VectorStore + FTS working together
// =============================================================================

describe('Hybrid Search Integration: Vector + FTS', () => {
  let vectorStore: VectorStore
  let vectorCDCEvents: unknown[]
  const mockDb = createMockDb()

  beforeEach(() => {
    vi.clearAllMocks()
    vectorCDCEvents = []
    vectorStore = new VectorStore(mockDb, {
      dimension: 128,
      lazyInit: true, // Skip actual SQLite initialization
      onCDC: (event) => vectorCDCEvents.push(event),
    })
  })

  function createTestEmbedding(seed: number, dimension = 128): Float32Array {
    const embedding = new Float32Array(dimension)
    for (let i = 0; i < dimension; i++) {
      embedding[i] = Math.sin(seed * (i + 1) * 0.1) * 0.5 + 0.5
    }
    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0))
    for (let i = 0; i < dimension; i++) {
      embedding[i] /= norm
    }
    return embedding
  }

  it('inserts vectors with content and emits CDC events', async () => {
    await vectorStore.insert({
      id: 'doc-1',
      content: 'Machine learning algorithms for natural language processing',
      embedding: createTestEmbedding(1),
      metadata: { category: 'ai' },
    })

    expect(vectorCDCEvents).toHaveLength(1)
    expect((vectorCDCEvents[0] as any).type).toBe('cdc.insert')
    expect((vectorCDCEvents[0] as any).op).toBe('c')
    expect((vectorCDCEvents[0] as any).store).toBe('vector')
  })

  it('performs FTS-only search', async () => {
    await vectorStore.insert({
      id: 'doc-1',
      content: 'Python programming for data science applications',
      embedding: createTestEmbedding(1),
    })

    await vectorStore.insert({
      id: 'doc-2',
      content: 'JavaScript frameworks for web development',
      embedding: createTestEmbedding(2),
    })

    await vectorStore.insert({
      id: 'doc-3',
      content: 'Python machine learning with scikit-learn',
      embedding: createTestEmbedding(3),
    })

    // FTS search for "python"
    const results = await vectorStore.hybridSearch({
      query: 'python',
      limit: 10,
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results.some((r) => r.id === 'doc-1')).toBe(true)
    expect(results.some((r) => r.id === 'doc-3')).toBe(true)
  })

  it('performs vector-only search with similarity scores', async () => {
    await vectorStore.insert({
      id: 'doc-1',
      content: 'First document',
      embedding: createTestEmbedding(1),
    })

    await vectorStore.insert({
      id: 'doc-2',
      content: 'Second document',
      embedding: createTestEmbedding(2),
    })

    // Vector search with query similar to doc-1
    const queryEmbedding = createTestEmbedding(1.05)
    const results = await vectorStore.search({
      embedding: queryEmbedding,
      limit: 2,
    })

    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('doc-1')
    expect(results[0].similarity).toBeGreaterThan(0.9)
  })

  it('performs hybrid FTS + vector search with RRF fusion', async () => {
    await vectorStore.insert({
      id: 'doc-1',
      content: 'Artificial intelligence and machine learning',
      embedding: createTestEmbedding(1),
    })

    await vectorStore.insert({
      id: 'doc-2',
      content: 'Deep learning neural networks',
      embedding: createTestEmbedding(2),
    })

    await vectorStore.insert({
      id: 'doc-3',
      content: 'Database management systems',
      embedding: createTestEmbedding(3),
    })

    // Hybrid search combining text and vector
    const results = await vectorStore.hybridSearch({
      query: 'machine learning',
      embedding: createTestEmbedding(1.1),
      limit: 3,
      ftsWeight: 0.5,
      vectorWeight: 0.5,
    })

    expect(results.length).toBeGreaterThan(0)
    // Results should have RRF scores
    expect(results[0].rrfScore).toBeDefined()
    expect(results[0].rrfScore).toBeGreaterThan(0)
  })

  it('supports metadata filtering in vector search', async () => {
    await vectorStore.insert({
      id: 'doc-1',
      content: 'AI content',
      embedding: createTestEmbedding(1),
      metadata: { category: 'ai', lang: 'en' },
    })

    await vectorStore.insert({
      id: 'doc-2',
      content: 'Database content',
      embedding: createTestEmbedding(1.05), // Very similar to doc-1
      metadata: { category: 'database', lang: 'en' },
    })

    const results = await vectorStore.search({
      embedding: createTestEmbedding(1),
      limit: 10,
      filter: { 'metadata.category': 'ai' },
    })

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('doc-1')
  })

  it('supports batch inserts with CDC event', async () => {
    await vectorStore.insertBatch([
      { id: 'batch-1', content: 'Batch doc 1', embedding: createTestEmbedding(1) },
      { id: 'batch-2', content: 'Batch doc 2', embedding: createTestEmbedding(2) },
      { id: 'batch-3', content: 'Batch doc 3', embedding: createTestEmbedding(3) },
    ])

    expect(vectorCDCEvents).toHaveLength(1)
    expect((vectorCDCEvents[0] as any).type).toBe('cdc.batch_insert')
    expect((vectorCDCEvents[0] as any).count).toBe(3)
  })

  it('emits CDC delete event on vector removal', async () => {
    await vectorStore.insert({
      id: 'to-delete',
      content: 'Will be deleted',
      embedding: createTestEmbedding(1),
    })

    vectorCDCEvents.length = 0

    await vectorStore.delete('to-delete')

    expect(vectorCDCEvents).toHaveLength(1)
    expect((vectorCDCEvents[0] as any).type).toBe('cdc.delete')
    expect((vectorCDCEvents[0] as any).key).toBe('to-delete')
  })
})

// =============================================================================
// TEST 4: WORKFLOW WITH STORES - Workflow using stores in activities
// =============================================================================

describe('Workflow with Stores Integration', () => {
  beforeEach(() => {
    clearWorkflows()
    clearActivities()
  })

  afterEach(() => {
    clearWorkflows()
    clearActivities()
  })

  it('defines workflow that uses stores in activity', async () => {
    const executedActivities: string[] = []

    // Define activity that simulates store operation
    defineActivity('createCustomer', async (input: { name: string; email: string }) => {
      executedActivities.push('createCustomer')
      return {
        $id: `cust_${Date.now()}`,
        name: input.name,
        email: input.email,
      }
    })

    defineActivity('sendWelcomeEmail', async (input: { customerId: string; email: string }) => {
      executedActivities.push('sendWelcomeEmail')
      return { sent: true, to: input.email }
    })

    const onboardCustomerWorkflow = workflow(
      'onboardCustomer',
      async (ctx, input: { name: string; email: string }) => {
        const customer = await ctx.activity('createCustomer', { input })
        await ctx.activity('sendWelcomeEmail', {
          input: { customerId: customer.$id, email: input.email },
        })
        return { customerId: customer.$id, status: 'onboarded' }
      }
    )

    expect(onboardCustomerWorkflow.name).toBe('onboardCustomer')
    expect(typeof onboardCustomerWorkflow.handler).toBe('function')
  })

  it('workflow client can start workflow and wait for result', async () => {
    const processOrderWorkflow = workflow('processOrder', async (ctx, order: { orderId: string; total: number }) => {
      return {
        orderId: order.orderId,
        status: 'processed',
        processed: true,
      }
    })

    const client = new WorkflowClient({} as any)

    const handle = await client.start(processOrderWorkflow, {
      workflowId: 'order-123',
      input: { orderId: 'ORD-001', total: 99.99 },
      taskQueue: 'orders',
    })

    expect(handle.workflowId).toBe('order-123')

    const result = await handle.result()
    expect(result.orderId).toBe('ORD-001')
    expect(result.status).toBe('processed')
  })

  it('workflow with multi-step store interaction pattern', async () => {
    defineActivity('checkInventory', async (sku: string) => {
      return { sku, available: 100, reserved: 10 }
    })

    defineActivity('reserveInventory', async (input: { sku: string; quantity: number }) => {
      return { sku: input.sku, reserved: input.quantity, reservationId: `res_${Date.now()}` }
    })

    defineActivity('commitReservation', async (reservationId: string) => {
      return { reservationId, committed: true }
    })

    const fulfillOrderWorkflow = workflow(
      'fulfillOrder',
      async (ctx, order: { orderId: string; items: Array<{ sku: string; quantity: number }> }) => {
        const reservations: string[] = []

        for (const item of order.items) {
          const inventory = await ctx.activity('checkInventory', { input: item.sku })

          if (inventory.available - inventory.reserved < item.quantity) {
            throw new Error(`Insufficient inventory for ${item.sku}`)
          }

          const reservation = await ctx.activity('reserveInventory', {
            input: { sku: item.sku, quantity: item.quantity },
          })
          reservations.push(reservation.reservationId)
        }

        for (const resId of reservations) {
          await ctx.activity('commitReservation', { input: resId })
        }

        return {
          orderId: order.orderId,
          status: 'fulfilled',
          reservations,
        }
      }
    )

    const client = new WorkflowClient({} as any)

    const handle = await client.start(fulfillOrderWorkflow, {
      workflowId: 'fulfill-order-001',
      input: {
        orderId: 'ORD-001',
        items: [
          { sku: 'WIDGET-A', quantity: 5 },
          { sku: 'WIDGET-B', quantity: 3 },
        ],
      },
      taskQueue: 'fulfillment',
    })

    const result = await handle.result()
    expect(result.status).toBe('fulfilled')
    expect(result.reservations).toHaveLength(2)
  })
})

// =============================================================================
// TEST 5: STREAM TO STORE - Producer -> Consumer -> Store patterns
// =============================================================================

describe('Stream to Store Integration: Producer -> Consumer -> Store', () => {
  beforeEach(() => {
    _resetStorage()
  })

  afterEach(() => {
    _resetStorage()
  })

  it('produces messages and consumes them', async () => {
    const admin = new AdminClient()
    await admin.createTopic('customer-events', { partitions: 1 })

    const producer = new Producer()
    const consumer = new Consumer<{ type: string; data: Customer }>('customer-events', {
      groupId: 'customer-processor',
    })

    await consumer.subscribe('customer-events')

    // Produce customer events
    await producer.send('customer-events', {
      key: 'cust-1',
      value: { type: 'CustomerCreated', data: { name: 'Alice', email: 'alice@example.com' } },
    })

    await producer.send('customer-events', {
      key: 'cust-2',
      value: { type: 'CustomerCreated', data: { name: 'Bob', email: 'bob@example.com' } },
    })

    // Consume and process
    const processedKeys: string[] = []

    for (let i = 0; i < 2; i++) {
      const message = await consumer.poll({ timeout: 1000 })
      if (message && message.value.type === 'CustomerCreated') {
        processedKeys.push(message.key)
        await consumer.commit(message.offset)
      }
    }

    expect(processedKeys).toHaveLength(2)
    expect(processedKeys).toContain('cust-1')
    expect(processedKeys).toContain('cust-2')

    await consumer.close()
  })

  it('uses Topic helper for pub/sub pattern', async () => {
    const topic = new Topic<{ action: string; payload: Record<string, unknown> }>('actions', {
      partitions: 1,
    })

    // Produce actions
    await topic.produce({
      key: 'action-1',
      value: { action: 'user.signup', payload: { userId: 'u1', email: 'user1@example.com' } },
    })

    await topic.produce({
      key: 'action-2',
      value: { action: 'user.login', payload: { userId: 'u1', ip: '192.168.1.1' } },
    })

    // Retrieve latest value per key
    const action1 = await topic.get('action-1')
    const action2 = await topic.get('action-2')

    expect(action1).not.toBeNull()
    expect(action1!.action).toBe('user.signup')

    expect(action2).not.toBeNull()
    expect(action2!.action).toBe('user.login')
  })

  it('handles consumer group with multiple partitions', async () => {
    const admin = new AdminClient()
    await admin.createTopic('orders', { partitions: 3 })

    const producer = new Producer()

    // Produce orders
    for (let i = 0; i < 5; i++) {
      await producer.send('orders', {
        key: `order-${i}`,
        value: {
          customerId: `cust-${i % 2}`,
          items: [{ sku: `SKU-${i}`, quantity: 1, price: 10 }],
          status: 'pending',
          total: 10,
        },
      })
    }

    const consumer = new Consumer<Order>('orders', {
      groupId: 'order-processors',
    })
    await consumer.subscribe('orders')

    // Process messages
    let processed = 0
    const processedKeys: string[] = []

    while (processed < 5) {
      const msg = await consumer.poll({ timeout: 500 })
      if (msg) {
        processedKeys.push(msg.key)
        processed++
      } else {
        break
      }
    }

    expect(processed).toBe(5)
    expect(processedKeys).toHaveLength(5)

    await consumer.close()
  })

  it('supports CDC events flowing through stream', async () => {
    const admin = new AdminClient()
    await admin.createTopic('cdc-events', { partitions: 1 })

    const producer = new Producer()
    const capturedEvents: UnifiedEvent[] = []

    // Create CDC emitter that produces to stream
    const mockPipeline = {
      send: async (events: UnifiedEvent[]) => {
        for (const event of events) {
          capturedEvents.push(event)
          await producer.send('cdc-events', {
            key: event.key || event.id,
            value: event,
          })
        }
      },
    }

    const emitter = new CDCEmitter(mockPipeline as any, {
      ns: 'test.stream',
      source: 'DO/customers',
    })

    // Emit CDC event
    await emitter.emit({
      op: 'c',
      store: 'document',
      table: 'Customer',
      key: 'cust_stream_1',
      after: { name: 'Stream Alice', email: 'stream.alice@example.com' },
    })

    // Verify event was captured
    expect(capturedEvents).toHaveLength(1)
    expect(capturedEvents[0].type).toBe('cdc.insert')

    // Verify event in stream
    const consumer = new Consumer<UnifiedEvent>('cdc-events', { groupId: 'cdc-reader' })
    await consumer.subscribe('cdc-events')

    const msg = await consumer.poll({ timeout: 1000 })
    expect(msg).not.toBeNull()
    expect(msg!.value.type).toBe('cdc.insert')
    expect(msg!.value.table).toBe('Customer')

    await consumer.close()
  })

  it('reads current state from compacted topic', async () => {
    const topic = new Topic<{ value: number }>('state', {
      partitions: 1,
      compaction: true,
    })

    // Write multiple versions for same key
    await topic.produce({ key: 'counter', value: { value: 1 } })
    await topic.produce({ key: 'counter', value: { value: 2 } })
    await topic.produce({ key: 'counter', value: { value: 3 } })

    // Get should return latest value
    const latest = await topic.get('counter')
    expect(latest).not.toBeNull()
    expect(latest!.value).toBe(3)

    // Read current state for all keys
    const state = await topic.readCurrentState()
    expect(state.counter.value).toBe(3)
  })
})

// =============================================================================
// TEST 6: FULL INTEGRATION - All stores working together
// =============================================================================

describe('Full Integration: All Stores Together', () => {
  const mockDb = createMockDb()
  let mockPipeline: ReturnType<typeof createMockPipeline>

  beforeEach(() => {
    _resetStorage()
    vi.clearAllMocks()
    mockPipeline = createMockPipeline()
    clearWorkflows()
    clearActivities()
  })

  afterEach(() => {
    _resetStorage()
    clearWorkflows()
    clearActivities()
  })

  it('e-commerce flow: CDC events + Graph relationships + Vector search + Streams', async () => {
    // Setup stores
    const graphStore = new GraphStore(mockDb as any)
    const graphEvents: CDCTestEvent[] = []
    graphStore.onCDC((event) => graphEvents.push(event as CDCTestEvent))

    const vectorEvents: unknown[] = []
    const vectorStore = new VectorStore(mockDb, {
      dimension: 64,
      lazyInit: true,
      onCDC: (event) => vectorEvents.push(event),
    })

    const cdcEmitter = new CDCEmitter(mockPipeline as any, {
      ns: 'ecommerce.integration',
      source: 'DO/integration-test',
    })

    // Setup stream
    const admin = new AdminClient()
    await admin.createTopic('integration-events', { partitions: 1 })
    const producer = new Producer()

    // 1. Create customer via CDC
    const customerEvent = await cdcEmitter.emit({
      op: 'c',
      store: 'document',
      table: 'Customer',
      key: 'cust_integration',
      after: { name: 'Integration Customer', email: 'integration@example.com', tier: 'premium' },
    })

    expect(customerEvent.type).toBe('cdc.insert')
    expect(customerEvent.key).toBe('cust_integration')

    // 2. Create order via CDC
    const orderEvent = await cdcEmitter.emit({
      op: 'c',
      store: 'document',
      table: 'Order',
      key: 'ord_integration',
      after: {
        customerId: 'cust_integration',
        items: [{ sku: 'LAPTOP-PRO', quantity: 1, price: 1299.99 }],
        status: 'pending',
        total: 1299.99,
      },
    })

    expect(orderEvent.type).toBe('cdc.insert')

    // 3. Create graph relationship
    const relationship = await graphStore.relate({
      from: 'Customer/cust_integration',
      to: 'Order/ord_integration',
      type: 'placed',
    })

    expect(relationship.type).toBe('placed')
    expect(graphEvents).toHaveLength(1)

    // 4. Index customer in vector store
    const customerEmbedding = new Float32Array(64)
    for (let i = 0; i < 64; i++) {
      customerEmbedding[i] = Math.random() - 0.5
    }
    const norm = Math.sqrt(customerEmbedding.reduce((sum, x) => sum + x * x, 0))
    for (let i = 0; i < 64; i++) {
      customerEmbedding[i] /= norm
    }

    await vectorStore.insert({
      id: 'customer-cust_integration',
      content: 'Integration Customer integration@example.com premium',
      embedding: customerEmbedding,
      metadata: { customerId: 'cust_integration' },
    })

    expect(vectorEvents).toHaveLength(1)

    // 5. Produce event to stream
    await producer.send('integration-events', {
      key: 'ord_integration',
      value: {
        type: 'OrderPlaced',
        customerId: 'cust_integration',
        orderId: 'ord_integration',
        total: 1299.99,
      },
    })

    // Verify all systems recorded properly
    expect(mockPipeline.send).toHaveBeenCalledTimes(2) // customer + order CDC
    expect(graphEvents).toHaveLength(1) // graph relationship
    expect(vectorEvents).toHaveLength(1) // vector index

    // 6. Query graph to find customer's orders
    const orders = await graphStore.outgoing('Customer/cust_integration')
    expect(orders).toHaveLength(1)
    expect(orders[0].type).toBe('placed')

    // 7. Search vector store
    const searchResults = await vectorStore.hybridSearch({
      query: 'premium customer',
      limit: 10,
    })

    expect(searchResults.some((r) => r.id === 'customer-cust_integration')).toBe(true)

    // 8. Consume from stream
    const consumer = new Consumer('integration-events', { groupId: 'integration-verifier' })
    await consumer.subscribe('integration-events')

    const msg = await consumer.poll({ timeout: 1000 })
    expect(msg).not.toBeNull()
    expect((msg!.value as any).type).toBe('OrderPlaced')

    await consumer.close()
  })
})
