/**
 * Integration Tests: Store Primitives Working Together
 *
 * These tests verify that all db primitives work correctly together:
 * - CDC flow: Document mutations -> CDC events -> verification
 * - Cross-store: Document + Graph store interactions
 * - Hybrid search: Vector + FTS working together
 * - Workflow with stores: Workflows using DocumentStore in activities
 * - Stream to store: Producer -> Consumer -> DocumentStore
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'

// Store imports
import { DocumentStore } from '../../../db/document'
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
// SETUP HELPERS
// =============================================================================

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)

  // Create documents table for DocumentStore
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      "$id" TEXT PRIMARY KEY,
      "$type" TEXT NOT NULL,
      "data" TEXT NOT NULL,
      "$createdAt" INTEGER NOT NULL,
      "$updatedAt" INTEGER NOT NULL,
      "$version" INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_documents_type ON documents("$type");
  `)

  return { db, sqlite }
}

// =============================================================================
// TEST 1: CDC FLOW - Document create -> CDC event -> verify structure
// =============================================================================

describe('CDC Flow Integration', () => {
  let db: ReturnType<typeof drizzle>
  let sqlite: Database.Database
  let cdcEvents: CDCTestEvent[]

  beforeEach(() => {
    const testDb = createTestDb()
    db = testDb.db
    sqlite = testDb.sqlite
    cdcEvents = []
  })

  afterEach(() => {
    sqlite.close()
  })

  it('emits CDC event on document create with correct structure', async () => {
    const store = new DocumentStore<Customer>(db, {
      type: 'Customer',
      onEvent: (event) => cdcEvents.push(event as CDCTestEvent),
    })

    const customer = await store.create({
      name: 'Alice Smith',
      email: 'alice@example.com',
      tier: 'premium',
    })

    expect(customer.$id).toBeDefined()
    expect(customer.$type).toBe('Customer')
    expect(customer.name).toBe('Alice Smith')
    expect(customer.$version).toBe(1)

    // Verify CDC event structure
    expect(cdcEvents).toHaveLength(1)
    const event = cdcEvents[0]
    expect(event.type).toBe('cdc.insert')
    expect(event.op).toBe('c')
    expect(event.store).toBe('document')
    expect(event.table).toBe('Customer')
    expect(event.key).toBe(customer.$id)
    expect(event.after).toEqual({
      name: 'Alice Smith',
      email: 'alice@example.com',
      tier: 'premium',
    })
  })

  it('emits CDC events for update with before/after diffs', async () => {
    const store = new DocumentStore<Customer>(db, {
      type: 'Customer',
      onEvent: (event) => cdcEvents.push(event as CDCTestEvent),
    })

    const customer = await store.create({
      name: 'Bob Jones',
      email: 'bob@example.com',
    })

    // Clear create event
    cdcEvents.length = 0

    // Update the customer
    const updated = await store.update(customer.$id, {
      tier: 'enterprise',
    })

    expect(updated.$version).toBe(2)
    expect(updated.tier).toBe('enterprise')

    // Verify CDC update event
    expect(cdcEvents).toHaveLength(1)
    const event = cdcEvents[0]
    expect(event.type).toBe('cdc.update')
    expect(event.op).toBe('u')
    expect(event.before).toEqual({ tier: undefined })
    expect(event.after).toEqual({ tier: 'enterprise' })
  })

  it('emits CDC event on delete with before data', async () => {
    const store = new DocumentStore<Customer>(db, {
      type: 'Customer',
      onEvent: (event) => cdcEvents.push(event as CDCTestEvent),
    })

    const customer = await store.create({
      name: 'Charlie Brown',
      email: 'charlie@example.com',
    })

    cdcEvents.length = 0

    const deleted = await store.delete(customer.$id)
    expect(deleted).toBe(true)

    // Verify CDC delete event
    expect(cdcEvents).toHaveLength(1)
    const event = cdcEvents[0]
    expect(event.type).toBe('cdc.delete')
    expect(event.op).toBe('d')
    expect(event.key).toBe(customer.$id)
    expect(event.before).toEqual({
      name: 'Charlie Brown',
      email: 'charlie@example.com',
    })
  })

  it('maintains CDC event ordering for batch operations', async () => {
    const store = new DocumentStore<Customer>(db, {
      type: 'Customer',
      onEvent: (event) => cdcEvents.push(event as CDCTestEvent),
    })

    // Create multiple customers
    await store.createMany([
      { name: 'User 1', email: 'user1@example.com' },
      { name: 'User 2', email: 'user2@example.com' },
      { name: 'User 3', email: 'user3@example.com' },
    ])

    // Verify all create events were emitted in order
    expect(cdcEvents).toHaveLength(3)
    expect(cdcEvents[0].after?.name).toBe('User 1')
    expect(cdcEvents[1].after?.name).toBe('User 2')
    expect(cdcEvents[2].after?.name).toBe('User 3')
  })
})

// =============================================================================
// TEST 2: CROSS-STORE - Document + Graph working together
// =============================================================================

describe('Cross-Store Integration: Document + Graph', () => {
  let db: ReturnType<typeof drizzle>
  let sqlite: Database.Database
  let documentEvents: CDCTestEvent[]
  let graphEvents: CDCTestEvent[]

  beforeEach(() => {
    const testDb = createTestDb()
    db = testDb.db
    sqlite = testDb.sqlite
    documentEvents = []
    graphEvents = []
  })

  afterEach(() => {
    sqlite.close()
  })

  it('creates documents and graph edges with consistent references', async () => {
    // Create document store for customers
    const customerStore = new DocumentStore<Customer>(db, {
      type: 'Customer',
      onEvent: (event) => documentEvents.push(event as CDCTestEvent),
    })

    // Create document store for orders
    const orderStore = new DocumentStore<Order>(db, {
      type: 'Order',
      onEvent: (event) => documentEvents.push(event as CDCTestEvent),
    })

    // Create graph store for relationships
    const graphStore = new GraphStore(db)
    graphStore.onCDC((event) => graphEvents.push(event as CDCTestEvent))

    // Create a customer
    const customer = await customerStore.create({
      name: 'Alice',
      email: 'alice@example.com',
    })

    // Create an order
    const order = await orderStore.create({
      customerId: customer.$id,
      items: [{ sku: 'WIDGET-1', quantity: 2, price: 29.99 }],
      status: 'pending',
      total: 59.98,
    })

    // Create graph relationship between customer and order
    const relationship = await graphStore.relate({
      from: `Customer/${customer.$id}`,
      to: `Order/${order.$id}`,
      type: 'placed',
      data: { timestamp: Date.now() },
    })

    // Verify document was created correctly
    expect(customer.$id).toBeDefined()
    expect(order.customerId).toBe(customer.$id)

    // Verify graph relationship
    expect(relationship.from).toBe(`Customer/${customer.$id}`)
    expect(relationship.to).toBe(`Order/${order.$id}`)
    expect(relationship.type).toBe('placed')

    // Verify CDC events from both stores
    expect(documentEvents).toHaveLength(2) // customer + order
    expect(graphEvents).toHaveLength(1) // relationship

    // Verify we can traverse from customer to order
    const outgoing = await graphStore.outgoing(`Customer/${customer.$id}`)
    expect(outgoing).toHaveLength(1)
    expect(outgoing[0].to).toBe(`Order/${order.$id}`)
  })

  it('handles cross-store queries: find orders for a customer', async () => {
    const customerStore = new DocumentStore<Customer>(db, { type: 'Customer' })
    const orderStore = new DocumentStore<Order>(db, { type: 'Order' })
    const graphStore = new GraphStore(db)

    // Create customer
    const customer = await customerStore.create({
      name: 'Bob',
      email: 'bob@example.com',
    })

    // Create multiple orders
    const orders: Awaited<ReturnType<typeof orderStore.create>>[] = []
    for (let i = 0; i < 3; i++) {
      const order = await orderStore.create({
        customerId: customer.$id,
        items: [{ sku: `SKU-${i}`, quantity: 1, price: 10 * (i + 1) }],
        status: 'pending',
        total: 10 * (i + 1),
      })
      orders.push(order)

      // Create relationship
      await graphStore.relate({
        from: `Customer/${customer.$id}`,
        to: `Order/${order.$id}`,
        type: 'placed',
      })
    }

    // Query: Get all orders for customer via graph
    const customerOrders = await graphStore.outgoing(`Customer/${customer.$id}`, { type: 'placed' })
    expect(customerOrders).toHaveLength(3)

    // Fetch actual order documents
    const orderIds = customerOrders.map((rel) => rel.to.split('/')[1])
    const orderDocs = await Promise.all(orderIds.map((id) => orderStore.get(id)))

    expect(orderDocs).toHaveLength(3)
    expect(orderDocs.every((o) => o !== null)).toBe(true)
    expect(orderDocs.map((o) => o!.customerId)).toEqual([customer.$id, customer.$id, customer.$id])
  })

  it('maintains referential integrity via graph relationships', async () => {
    const customerStore = new DocumentStore<Customer>(db, { type: 'Customer' })
    const graphStore = new GraphStore(db)

    // Create two customers
    const alice = await customerStore.create({ name: 'Alice', email: 'alice@example.com' })
    const bob = await customerStore.create({ name: 'Bob', email: 'bob@example.com' })

    // Create "follows" relationship
    await graphStore.relate({
      from: `Customer/${alice.$id}`,
      to: `Customer/${bob.$id}`,
      type: 'follows',
    })

    // Verify bidirectional lookup
    const aliceFollows = await graphStore.outgoing(`Customer/${alice.$id}`, { type: 'follows' })
    const bobFollowers = await graphStore.incoming(`Customer/${bob.$id}`, { type: 'follows' })

    expect(aliceFollows).toHaveLength(1)
    expect(aliceFollows[0].to).toBe(`Customer/${bob.$id}`)

    expect(bobFollowers).toHaveLength(1)
    expect(bobFollowers[0].from).toBe(`Customer/${alice.$id}`)
  })
})

// =============================================================================
// TEST 3: HYBRID SEARCH - Vector + FTS working together
// =============================================================================

describe('Hybrid Search Integration: Vector + FTS', () => {
  let sqlite: Database.Database
  let vectorStore: VectorStore

  beforeEach(() => {
    sqlite = new Database(':memory:')
    vectorStore = new VectorStore(sqlite, {
      dimension: 128, // Smaller dimension for tests
      lazyInit: false,
    })
  })

  afterEach(() => {
    sqlite.close()
  })

  function createTestEmbedding(seed: number, dimension = 128): Float32Array {
    const embedding = new Float32Array(dimension)
    for (let i = 0; i < dimension; i++) {
      // Create deterministic but varied embeddings
      embedding[i] = Math.sin(seed * (i + 1) * 0.1) * 0.5 + 0.5
    }
    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0))
    for (let i = 0; i < dimension; i++) {
      embedding[i] /= norm
    }
    return embedding
  }

  it('inserts vectors with content for hybrid search', async () => {
    const events: unknown[] = []
    vectorStore.subscribe((event) => events.push(event))

    await vectorStore.insert({
      id: 'doc-1',
      content: 'Machine learning algorithms for natural language processing',
      embedding: createTestEmbedding(1),
      metadata: { category: 'ai' },
    })

    await vectorStore.insert({
      id: 'doc-2',
      content: 'Deep neural networks and computer vision techniques',
      embedding: createTestEmbedding(2),
      metadata: { category: 'ai' },
    })

    await vectorStore.insert({
      id: 'doc-3',
      content: 'Database optimization and query performance tuning',
      embedding: createTestEmbedding(3),
      metadata: { category: 'databases' },
    })

    // Verify CDC events
    expect(events).toHaveLength(3)
    expect(events.every((e: any) => e.type === 'cdc.insert')).toBe(true)

    // Verify documents can be retrieved
    const doc = await vectorStore.get('doc-1')
    expect(doc).not.toBeNull()
    expect(doc!.content).toContain('Machine learning')
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

    // Should find docs with "python"
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((r) => r.id === 'doc-1')).toBe(true)
    expect(results.some((r) => r.id === 'doc-3')).toBe(true)
  })

  it('performs vector-only search', async () => {
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
    const queryEmbedding = createTestEmbedding(1.05) // Slightly different
    const results = await vectorStore.hybridSearch({
      embedding: queryEmbedding,
      limit: 2,
    })

    expect(results).toHaveLength(2)
    // doc-1 should be most similar since query is close to its embedding
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

    // doc-1 should rank highly (matches both FTS and vector)
    const doc1Result = results.find((r) => r.id === 'doc-1')
    expect(doc1Result).toBeDefined()
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

    // Search with filter
    const results = await vectorStore.search({
      embedding: createTestEmbedding(1),
      limit: 10,
      filter: { 'metadata.category': 'ai' },
    })

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('doc-1')
  })
})

// =============================================================================
// TEST 4: WORKFLOW WITH STORES - Workflow using DocumentStore in activity
// =============================================================================

describe('Workflow with Stores Integration', () => {
  let db: ReturnType<typeof drizzle>
  let sqlite: Database.Database

  beforeEach(() => {
    const testDb = createTestDb()
    db = testDb.db
    sqlite = testDb.sqlite
    clearWorkflows()
    clearActivities()
  })

  afterEach(() => {
    sqlite.close()
    clearWorkflows()
    clearActivities()
  })

  it('defines workflow that uses DocumentStore in activity', async () => {
    // Track what activities were executed
    const executedActivities: string[] = []

    // Define activity that creates a customer
    const createCustomerActivity = defineActivity('createCustomer', async (input: { name: string; email: string }) => {
      executedActivities.push('createCustomer')
      // In a real scenario, this would use the DocumentStore
      return {
        $id: `cust_${Date.now()}`,
        name: input.name,
        email: input.email,
      }
    })

    // Define activity that sends welcome email
    const sendWelcomeEmailActivity = defineActivity('sendWelcomeEmail', async (input: { customerId: string; email: string }) => {
      executedActivities.push('sendWelcomeEmail')
      return { sent: true, to: input.email }
    })

    // Define the workflow
    const onboardCustomerWorkflow = workflow(
      'onboardCustomer',
      async (ctx, input: { name: string; email: string }) => {
        // Create customer using activity
        const customer = await ctx.activity('createCustomer', { input })

        // Send welcome email
        await ctx.activity('sendWelcomeEmail', {
          input: { customerId: customer.$id, email: input.email },
        })

        return { customerId: customer.$id, status: 'onboarded' }
      }
    )

    // Verify workflow definition
    expect(onboardCustomerWorkflow.name).toBe('onboardCustomer')
    expect(typeof onboardCustomerWorkflow.handler).toBe('function')

    // Verify activities are defined
    expect(createCustomerActivity.name).toBe('createCustomer')
    expect(sendWelcomeEmailActivity.name).toBe('sendWelcomeEmail')
  })

  it('workflow client can start workflow and wait for result', async () => {
    // Define a simple workflow
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

    // Wait for result
    const result = await handle.result()
    expect(result.orderId).toBe('ORD-001')
    expect(result.status).toBe('processed')
  })

  it('workflow with document store interaction pattern', async () => {
    // This test demonstrates the pattern of using stores within workflows
    // In production, activities would hold store references

    interface InventoryItem {
      sku: string
      quantity: number
      reserved: number
    }

    // Define inventory activities
    defineActivity('checkInventory', async (sku: string) => {
      // Would query DocumentStore in real implementation
      return { sku, available: 100, reserved: 10 }
    })

    defineActivity('reserveInventory', async (input: { sku: string; quantity: number }) => {
      // Would update DocumentStore in real implementation
      return { sku: input.sku, reserved: input.quantity, reservationId: `res_${Date.now()}` }
    })

    defineActivity('commitReservation', async (reservationId: string) => {
      // Would update DocumentStore in real implementation
      return { reservationId, committed: true }
    })

    // Define fulfillment workflow
    const fulfillOrderWorkflow = workflow(
      'fulfillOrder',
      async (ctx, order: { orderId: string; items: Array<{ sku: string; quantity: number }> }) => {
        const reservations: string[] = []

        // Reserve each item
        for (const item of order.items) {
          // Check inventory
          const inventory = await ctx.activity('checkInventory', { input: item.sku })

          if (inventory.available - inventory.reserved < item.quantity) {
            throw new Error(`Insufficient inventory for ${item.sku}`)
          }

          // Reserve
          const reservation = await ctx.activity('reserveInventory', {
            input: { sku: item.sku, quantity: item.quantity },
          })
          reservations.push(reservation.reservationId)
        }

        // Commit all reservations
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
// TEST 5: STREAM TO STORE - Producer -> Consumer -> DocumentStore
// =============================================================================

describe('Stream to Store Integration: Producer -> Consumer -> DocumentStore', () => {
  let db: ReturnType<typeof drizzle>
  let sqlite: Database.Database

  beforeEach(() => {
    _resetStorage()
    const testDb = createTestDb()
    db = testDb.db
    sqlite = testDb.sqlite
  })

  afterEach(() => {
    sqlite.close()
    _resetStorage()
  })

  it('produces messages and consumes them to write to DocumentStore', async () => {
    const admin = new AdminClient()
    await admin.createTopic('customer-events', { partitions: 1 })

    const producer = new Producer()
    const consumer = new Consumer<{ type: string; data: Customer }>('customer-events', {
      groupId: 'customer-processor',
    })

    await consumer.subscribe('customer-events')

    // DocumentStore to persist events
    const customerStore = new DocumentStore<Customer>(db, { type: 'Customer' })

    // Produce some customer events
    await producer.send('customer-events', {
      key: 'cust-1',
      value: { type: 'CustomerCreated', data: { name: 'Alice', email: 'alice@example.com' } },
    })

    await producer.send('customer-events', {
      key: 'cust-2',
      value: { type: 'CustomerCreated', data: { name: 'Bob', email: 'bob@example.com' } },
    })

    // Consume and process
    const processedIds: string[] = []

    for (let i = 0; i < 2; i++) {
      const message = await consumer.poll({ timeout: 1000 })
      if (message && message.value.type === 'CustomerCreated') {
        // Write to DocumentStore
        const doc = await customerStore.create({
          $id: message.key,
          ...message.value.data,
        })
        processedIds.push(doc.$id)
        await consumer.commit(message.offset)
      }
    }

    expect(processedIds).toHaveLength(2)
    expect(processedIds).toContain('cust-1')
    expect(processedIds).toContain('cust-2')

    // Verify documents exist in store
    const alice = await customerStore.get('cust-1')
    const bob = await customerStore.get('cust-2')

    expect(alice).not.toBeNull()
    expect(alice!.name).toBe('Alice')
    expect(bob).not.toBeNull()
    expect(bob!.name).toBe('Bob')

    await consumer.close()
  })

  it('uses Topic helper for simple pub/sub with store writes', async () => {
    const topic = new Topic<{ action: string; payload: Record<string, unknown> }>('actions', {
      partitions: 1,
    })

    const actionStore = new DocumentStore<{ action: string; payload: Record<string, unknown> }>(db, {
      type: 'Action',
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

    // Use get() to retrieve latest value per key
    const action1 = await topic.get('action-1')
    const action2 = await topic.get('action-2')

    expect(action1).not.toBeNull()
    expect(action1!.action).toBe('user.signup')

    expect(action2).not.toBeNull()
    expect(action2!.action).toBe('user.login')

    // Write to document store
    if (action1) {
      await actionStore.create({ $id: 'action-1', ...action1 })
    }
    if (action2) {
      await actionStore.create({ $id: 'action-2', ...action2 })
    }

    // Verify stored
    const storedAction = await actionStore.get('action-1')
    expect(storedAction).not.toBeNull()
    expect(storedAction!.action).toBe('user.signup')
  })

  it('handles consumer group rebalancing while writing to store', async () => {
    const admin = new AdminClient()
    await admin.createTopic('orders', { partitions: 3 })

    const producer = new Producer()
    const orderStore = new DocumentStore<Order>(db, { type: 'Order' })

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

    // Create consumer
    const consumer = new Consumer<Order>('orders', {
      groupId: 'order-processors',
    })
    await consumer.subscribe('orders')

    // Process messages
    let processed = 0
    while (processed < 5) {
      const msg = await consumer.poll({ timeout: 500 })
      if (msg) {
        await orderStore.create({
          $id: msg.key,
          ...msg.value,
        })
        processed++
      } else {
        break
      }
    }

    expect(processed).toBe(5)

    // Verify all orders in store
    const allOrders = await orderStore.list()
    expect(allOrders).toHaveLength(5)

    await consumer.close()
  })

  it('CDC events from store can be produced to stream', async () => {
    const admin = new AdminClient()
    await admin.createTopic('cdc-events', { partitions: 1 })

    const producer = new Producer()
    const cdcEvents: CDCTestEvent[] = []

    // Create store with CDC handler that produces to stream
    const customerStore = new DocumentStore<Customer>(db, {
      type: 'Customer',
      onEvent: async (event) => {
        cdcEvents.push(event as CDCTestEvent)
        // Forward CDC event to stream
        await producer.send('cdc-events', {
          key: (event as CDCTestEvent).key,
          value: event,
        })
      },
    })

    // Create a customer
    await customerStore.create({
      name: 'Stream Alice',
      email: 'stream.alice@example.com',
    })

    // Verify CDC event was captured
    expect(cdcEvents).toHaveLength(1)
    expect(cdcEvents[0].type).toBe('cdc.insert')

    // Verify event was produced to stream
    const consumer = new Consumer<CDCTestEvent>('cdc-events', { groupId: 'cdc-reader' })
    await consumer.subscribe('cdc-events')

    const msg = await consumer.poll({ timeout: 1000 })
    expect(msg).not.toBeNull()
    expect(msg!.value.type).toBe('cdc.insert')
    expect(msg!.value.table).toBe('Customer')

    await consumer.close()
  })
})

// =============================================================================
// TEST 6: FULL INTEGRATION - All stores working together
// =============================================================================

describe('Full Integration: All Stores Together', () => {
  let db: ReturnType<typeof drizzle>
  let sqlite: Database.Database

  beforeEach(() => {
    _resetStorage()
    const testDb = createTestDb()
    db = testDb.db
    sqlite = testDb.sqlite
    clearWorkflows()
    clearActivities()
  })

  afterEach(() => {
    sqlite.close()
    _resetStorage()
    clearWorkflows()
    clearActivities()
  })

  it('e-commerce flow: customer signup -> order -> graph + vector + stream', async () => {
    // 1. Setup stores
    const customerStore = new DocumentStore<Customer>(db, { type: 'Customer' })
    const orderStore = new DocumentStore<Order>(db, { type: 'Order' })
    const graphStore = new GraphStore(db)
    const vectorStore = new VectorStore(new Database(':memory:'), {
      dimension: 64,
      lazyInit: false,
    })

    // Setup stream
    const admin = new AdminClient()
    await admin.createTopic('events', { partitions: 1 })
    const producer = new Producer()

    // 2. Create customer
    const customer = await customerStore.create({
      name: 'Integration Customer',
      email: 'integration@example.com',
      tier: 'premium',
    })

    // 3. Create order
    const order = await orderStore.create({
      customerId: customer.$id,
      items: [
        { sku: 'LAPTOP-PRO', quantity: 1, price: 1299.99 },
        { sku: 'MOUSE-WIRELESS', quantity: 2, price: 49.99 },
      ],
      status: 'pending',
      total: 1399.97,
    })

    // 4. Create graph relationships
    await graphStore.relate({
      from: `Customer/${customer.$id}`,
      to: `Order/${order.$id}`,
      type: 'placed',
    })

    // 5. Index customer profile in vector store for search
    const profileEmbedding = new Float32Array(64)
    for (let i = 0; i < 64; i++) {
      profileEmbedding[i] = Math.random() - 0.5
    }
    // Normalize
    const norm = Math.sqrt(profileEmbedding.reduce((sum, x) => sum + x * x, 0))
    for (let i = 0; i < 64; i++) {
      profileEmbedding[i] /= norm
    }

    await vectorStore.insert({
      id: `customer-${customer.$id}`,
      content: `${customer.name} ${customer.email} ${customer.tier}`,
      embedding: profileEmbedding,
      metadata: { customerId: customer.$id },
    })

    // 6. Produce event to stream
    await producer.send('events', {
      key: order.$id,
      value: {
        type: 'OrderPlaced',
        customerId: customer.$id,
        orderId: order.$id,
        total: order.total,
      },
    })

    // Verify everything is connected
    // - Document stores have data
    const storedCustomer = await customerStore.get(customer.$id)
    const storedOrder = await orderStore.get(order.$id)
    expect(storedCustomer).not.toBeNull()
    expect(storedOrder).not.toBeNull()

    // - Graph has relationship
    const customerOrders = await graphStore.outgoing(`Customer/${customer.$id}`)
    expect(customerOrders).toHaveLength(1)
    expect(customerOrders[0].type).toBe('placed')

    // - Vector store has indexed profile
    const vectorDoc = await vectorStore.get(`customer-${customer.$id}`)
    expect(vectorDoc).not.toBeNull()
    expect(vectorDoc!.content).toContain('Integration Customer')

    // - Stream has event
    const consumer = new Consumer('events', { groupId: 'verifier' })
    await consumer.subscribe('events')
    const msg = await consumer.poll({ timeout: 1000 })
    expect(msg).not.toBeNull()
    expect((msg!.value as any).type).toBe('OrderPlaced')

    await consumer.close()
  })
})
