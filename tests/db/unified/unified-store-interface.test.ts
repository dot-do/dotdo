/**
 * Unified Store Interface Tests (TDD RED Phase)
 *
 * These tests define the expected unified Store<T> interface that should be
 * implemented by DocumentStore, GraphStore, and VectorStore to enable
 * polymorphic usage across different storage backends.
 *
 * Implementation requirements:
 * - Create db/unified/index.ts with Store<T> interface
 * - Each store should implement the common interface
 * - Query builder compatibility across stores
 * - CDC event emission from common interface
 * - Lifecycle hooks (onCreate, onUpdate, onDelete)
 *
 * This is the RED phase of TDD - tests should fail because the
 * unified interface implementation doesn't exist yet.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// These imports should fail until the unified interface exists
import {
  type Store,
  type StoreOptions,
  type QueryBuilder,
  type Filter,
  type SortOrder,
  type Unsubscribe,
  type CDCEventType,
  type LifecycleHooks,
  createStore,
  isStore,
  wrapDocumentStore,
  wrapGraphStore,
  wrapVectorStore,
} from '../../../db/unified'

// Existing store implementations
import { DocumentStore } from '../../../db/document/store'
import { GraphStore } from '../../../db/graph/store'
import { VectorStore } from '../../../db/vector/store'

// ============================================================================
// Test Types
// ============================================================================

interface Customer {
  id: string
  name: string
  email: string
  tier?: 'basic' | 'premium' | 'enterprise'
  metadata?: Record<string, unknown>
}

interface Order {
  id: string
  customerId: string
  items: Array<{ sku: string; quantity: number; price: number }>
  status: 'pending' | 'processing' | 'completed' | 'cancelled'
  total: number
}

interface VectorDocument {
  id: string
  content: string
  embedding: Float32Array
  metadata?: Record<string, unknown>
}

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockDb() {
  return {
    exec: vi.fn(),
    run: vi.fn(),
    all: vi.fn().mockReturnValue([]),
    prepare: vi.fn().mockReturnValue({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
    }),
  }
}

function createTestCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: `cust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Customer',
    email: 'test@example.com',
    tier: 'basic',
    ...overrides,
  }
}

function createTestEmbedding(dimension = 128, seed = 1): Float32Array {
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

// ============================================================================
// Store<T> Interface Type Structure Tests
// ============================================================================

describe('Store<T> Interface Type Structure', () => {
  describe('interface definition', () => {
    it('defines Store<T> generic interface', () => {
      // The Store type should be a generic interface
      const mockDb = createMockDb()
      const store: Store<Customer> = createStore<Customer>(mockDb, { type: 'Customer' })
      expect(store).toBeDefined()
    })

    it('requires create method', () => {
      const mockDb = createMockDb()
      const store: Store<Customer> = createStore<Customer>(mockDb, { type: 'Customer' })
      expect(typeof store.create).toBe('function')
    })

    it('requires get method', () => {
      const mockDb = createMockDb()
      const store: Store<Customer> = createStore<Customer>(mockDb, { type: 'Customer' })
      expect(typeof store.get).toBe('function')
    })

    it('requires update method', () => {
      const mockDb = createMockDb()
      const store: Store<Customer> = createStore<Customer>(mockDb, { type: 'Customer' })
      expect(typeof store.update).toBe('function')
    })

    it('requires delete method', () => {
      const mockDb = createMockDb()
      const store: Store<Customer> = createStore<Customer>(mockDb, { type: 'Customer' })
      expect(typeof store.delete).toBe('function')
    })

    it('requires query method', () => {
      const mockDb = createMockDb()
      const store: Store<Customer> = createStore<Customer>(mockDb, { type: 'Customer' })
      expect(typeof store.query).toBe('function')
    })

    it('requires find method', () => {
      const mockDb = createMockDb()
      const store: Store<Customer> = createStore<Customer>(mockDb, { type: 'Customer' })
      expect(typeof store.find).toBe('function')
    })

    it('requires on method for CDC events', () => {
      const mockDb = createMockDb()
      const store: Store<Customer> = createStore<Customer>(mockDb, { type: 'Customer' })
      expect(typeof store.on).toBe('function')
    })

    it('supports optional lifecycle hooks', () => {
      const mockDb = createMockDb()
      const store: Store<Customer> = createStore<Customer>(mockDb, { type: 'Customer' })
      // These are optional, so they may be undefined
      expect(store.onCreate === undefined || typeof store.onCreate === 'function').toBe(true)
      expect(store.onUpdate === undefined || typeof store.onUpdate === 'function').toBe(true)
      expect(store.onDelete === undefined || typeof store.onDelete === 'function').toBe(true)
    })
  })

  describe('method signatures', () => {
    it('create accepts item and returns Promise<T>', async () => {
      const mockDb = createMockDb()
      const store: Store<Customer> = createStore<Customer>(mockDb, { type: 'Customer' })
      const customer = createTestCustomer()

      // Type signature check
      const result: Promise<Customer> = store.create(customer)
      expect(result).toBeInstanceOf(Promise)
    })

    it('get accepts id and returns Promise<T | null>', async () => {
      const mockDb = createMockDb()
      const store: Store<Customer> = createStore<Customer>(mockDb, { type: 'Customer' })

      const result: Promise<Customer | null> = store.get('cust_123')
      expect(result).toBeInstanceOf(Promise)
    })

    it('update accepts id and partial updates, returns Promise<T>', async () => {
      const mockDb = createMockDb()
      const store: Store<Customer> = createStore<Customer>(mockDb, { type: 'Customer' })
      // First create an item to update
      await store.create({ id: 'cust_123', name: 'Test', email: 'test@example.com' })

      const result: Promise<Customer> = store.update('cust_123', { name: 'Updated' })
      expect(result).toBeInstanceOf(Promise)
    })

    it('delete accepts id and returns Promise<boolean>', async () => {
      const mockDb = createMockDb()
      const store: Store<Customer> = createStore<Customer>(mockDb, { type: 'Customer' })
      // First create an item to delete
      await store.create({ id: 'cust_123', name: 'Test', email: 'test@example.com' })

      const result: Promise<boolean> = store.delete('cust_123')
      expect(result).toBeInstanceOf(Promise)
    })

    it('query returns QueryBuilder<T>', () => {
      const mockDb = createMockDb()
      const store: Store<Customer> = createStore<Customer>(mockDb, { type: 'Customer' })

      const builder: QueryBuilder<Customer> = store.query()
      expect(builder).toBeDefined()
    })

    it('find accepts Filter<T> and returns Promise<T[]>', async () => {
      const mockDb = createMockDb()
      const store: Store<Customer> = createStore<Customer>(mockDb, { type: 'Customer' })
      const filter: Filter<Customer> = { tier: 'premium' }

      const result: Promise<Customer[]> = store.find(filter)
      expect(result).toBeInstanceOf(Promise)
    })

    it('on accepts event type and handler, returns Unsubscribe', () => {
      const mockDb = createMockDb()
      const store: Store<Customer> = createStore<Customer>(mockDb, { type: 'Customer' })
      const handler = vi.fn()

      const unsubscribe: Unsubscribe = store.on('create', handler)
      expect(typeof unsubscribe).toBe('function')
    })
  })
})

// ============================================================================
// Standard CRUD Operations Tests
// ============================================================================

describe('Standard CRUD Operations', () => {
  describe('create operation', () => {
    it('creates item and returns it with generated id', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      const input = { name: 'Alice', email: 'alice@example.com', tier: 'premium' as const }
      const result = await store.create(input as Customer)

      expect(result).toBeDefined()
      expect(result.id).toBeDefined()
      expect(result.name).toBe('Alice')
      expect(result.email).toBe('alice@example.com')
    })

    it('creates item with provided id', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      const customer = createTestCustomer({ id: 'custom-id-123' })
      const result = await store.create(customer)

      expect(result.id).toBe('custom-id-123')
    })

    it('throws on duplicate id', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      const customer = createTestCustomer({ id: 'dup-id' })
      await store.create(customer)

      await expect(store.create(customer)).rejects.toThrow(/already exists|duplicate/i)
    })

    it('validates required fields', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, {
        type: 'Customer',
        required: ['name', 'email'],
      })

      await expect(
        store.create({ id: 'test', tier: 'basic' } as Customer)
      ).rejects.toThrow(/required|missing/i)
    })
  })

  describe('get operation', () => {
    it('retrieves existing item by id', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      const customer = createTestCustomer()
      await store.create(customer)

      const result = await store.get(customer.id)
      expect(result).not.toBeNull()
      expect(result?.id).toBe(customer.id)
      expect(result?.name).toBe(customer.name)
    })

    it('returns null for non-existent id', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      const result = await store.get('non-existent-id')
      expect(result).toBeNull()
    })

    it('validates id parameter', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      await expect(store.get('')).rejects.toThrow(/invalid|empty/i)
    })
  })

  describe('update operation', () => {
    it('updates existing item with partial data', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      const customer = createTestCustomer({ name: 'Original Name' })
      await store.create(customer)

      const updated = await store.update(customer.id, { name: 'Updated Name' })

      expect(updated.name).toBe('Updated Name')
      expect(updated.email).toBe(customer.email) // Unchanged
    })

    it('throws when item does not exist', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      await expect(
        store.update('non-existent', { name: 'New Name' })
      ).rejects.toThrow(/not found/i)
    })

    it('supports deep merge for nested objects', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      const customer = createTestCustomer({
        metadata: { preferences: { theme: 'dark' }, settings: { notify: true } },
      })
      await store.create(customer)

      const updated = await store.update(customer.id, {
        metadata: { preferences: { language: 'en' } },
      })

      expect(updated.metadata?.preferences?.theme).toBe('dark')
      expect(updated.metadata?.preferences?.language).toBe('en')
      expect(updated.metadata?.settings?.notify).toBe(true)
    })

    it('increments version on update', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      const customer = createTestCustomer()
      const created = await store.create(customer)
      const initialVersion = (created as any).$version ?? 1

      const updated = await store.update(customer.id, { name: 'Updated' })
      expect((updated as any).$version).toBe(initialVersion + 1)
    })
  })

  describe('delete operation', () => {
    it('deletes existing item and returns true', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      const customer = createTestCustomer()
      await store.create(customer)

      const result = await store.delete(customer.id)
      expect(result).toBe(true)

      const retrieved = await store.get(customer.id)
      expect(retrieved).toBeNull()
    })

    it('returns false when item does not exist', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      const result = await store.delete('non-existent-id')
      expect(result).toBe(false)
    })

    it('supports soft delete option', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, {
        type: 'Customer',
        softDelete: true,
      })

      const customer = createTestCustomer()
      await store.create(customer)

      await store.delete(customer.id)

      // Should still be retrievable with includeDeleted option
      const result = await store.get(customer.id, { includeDeleted: true })
      expect(result).not.toBeNull()
      expect((result as any).$deleted).toBe(true)
    })
  })
})

// ============================================================================
// Query Builder Compatibility Tests
// ============================================================================

describe('Query Builder Compatibility', () => {
  describe('QueryBuilder interface', () => {
    it('provides where method for filtering', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      const builder = store.query()
      expect(typeof builder.where).toBe('function')

      const result = builder.where({ tier: 'premium' })
      expect(result).toBe(builder) // Chainable
    })

    it('provides orderBy method for sorting', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      const builder = store.query()
      expect(typeof builder.orderBy).toBe('function')

      const result = builder.orderBy('name', 'asc')
      expect(result).toBe(builder) // Chainable
    })

    it('provides limit method for pagination', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      const builder = store.query()
      expect(typeof builder.limit).toBe('function')

      const result = builder.limit(10)
      expect(result).toBe(builder) // Chainable
    })

    it('provides offset method for pagination', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      const builder = store.query()
      expect(typeof builder.offset).toBe('function')

      const result = builder.offset(20)
      expect(result).toBe(builder) // Chainable
    })

    it('provides execute method to run query', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      const builder = store.query()
      expect(typeof builder.execute).toBe('function')

      const result = await builder.execute()
      expect(Array.isArray(result)).toBe(true)
    })

    it('provides count method for totals', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      const builder = store.query()
      expect(typeof builder.count).toBe('function')

      const result = await builder.count()
      expect(typeof result).toBe('number')
    })
  })

  describe('filter operations', () => {
    it('supports equality filter', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      await store.create(createTestCustomer({ name: 'Alice', tier: 'premium' }))
      await store.create(createTestCustomer({ name: 'Bob', tier: 'basic' }))

      const results = await store.query().where({ tier: 'premium' }).execute()

      expect(results.every(c => c.tier === 'premium')).toBe(true)
    })

    it('supports $in operator', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      await store.create(createTestCustomer({ name: 'Alice', tier: 'premium' }))
      await store.create(createTestCustomer({ name: 'Bob', tier: 'basic' }))
      await store.create(createTestCustomer({ name: 'Carol', tier: 'enterprise' }))

      const results = await store.query()
        .where({ tier: { $in: ['premium', 'enterprise'] } })
        .execute()

      expect(results.every(c => c.tier === 'premium' || c.tier === 'enterprise')).toBe(true)
    })

    it('supports $gt, $gte, $lt, $lte operators', async () => {
      const mockDb = createMockDb()
      const store = createStore<Order>(mockDb, { type: 'Order' })

      await store.create({ id: 'o1', customerId: 'c1', items: [], status: 'completed', total: 100 })
      await store.create({ id: 'o2', customerId: 'c1', items: [], status: 'completed', total: 200 })
      await store.create({ id: 'o3', customerId: 'c1', items: [], status: 'completed', total: 300 })

      const results = await store.query()
        .where({ total: { $gte: 150, $lte: 250 } })
        .execute()

      expect(results).toHaveLength(1)
      expect(results[0].total).toBe(200)
    })

    it('supports $like operator for pattern matching', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      await store.create(createTestCustomer({ name: 'Alice Smith', email: 'alice@example.com' }))
      await store.create(createTestCustomer({ name: 'Bob Jones', email: 'bob@example.com' }))
      await store.create(createTestCustomer({ name: 'Alice Johnson', email: 'alicejohnson@test.com' }))

      const results = await store.query()
        .where({ name: { $like: 'Alice%' } })
        .execute()

      expect(results.every(c => c.name.startsWith('Alice'))).toBe(true)
    })

    it('supports nested field filters', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      await store.create(createTestCustomer({
        name: 'Alice',
        metadata: { preferences: { theme: 'dark' } },
      }))
      await store.create(createTestCustomer({
        name: 'Bob',
        metadata: { preferences: { theme: 'light' } },
      }))

      const results = await store.query()
        .where({ 'metadata.preferences.theme': 'dark' })
        .execute()

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Alice')
    })
  })

  describe('sorting operations', () => {
    it('sorts ascending by field', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      await store.create(createTestCustomer({ name: 'Charlie' }))
      await store.create(createTestCustomer({ name: 'Alice' }))
      await store.create(createTestCustomer({ name: 'Bob' }))

      const results = await store.query().orderBy('name', 'asc').execute()

      expect(results[0].name).toBe('Alice')
      expect(results[1].name).toBe('Bob')
      expect(results[2].name).toBe('Charlie')
    })

    it('sorts descending by field', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      await store.create(createTestCustomer({ name: 'Alice' }))
      await store.create(createTestCustomer({ name: 'Bob' }))
      await store.create(createTestCustomer({ name: 'Charlie' }))

      const results = await store.query().orderBy('name', 'desc').execute()

      expect(results[0].name).toBe('Charlie')
      expect(results[1].name).toBe('Bob')
      expect(results[2].name).toBe('Alice')
    })

    it('supports multiple sort fields', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      await store.create(createTestCustomer({ name: 'Alice', tier: 'basic' }))
      await store.create(createTestCustomer({ name: 'Alice', tier: 'premium' }))
      await store.create(createTestCustomer({ name: 'Bob', tier: 'basic' }))

      const results = await store.query()
        .orderBy('name', 'asc')
        .orderBy('tier', 'desc')
        .execute()

      expect(results[0].name).toBe('Alice')
      expect(results[0].tier).toBe('premium')
      expect(results[1].name).toBe('Alice')
      expect(results[1].tier).toBe('basic')
    })
  })

  describe('pagination operations', () => {
    it('limits results correctly', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      for (let i = 0; i < 10; i++) {
        await store.create(createTestCustomer({ name: `Customer ${i}` }))
      }

      const results = await store.query().limit(5).execute()
      expect(results).toHaveLength(5)
    })

    it('offsets results correctly', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      for (let i = 0; i < 10; i++) {
        await store.create(createTestCustomer({ id: `cust-${i}`, name: `Customer ${i}` }))
      }

      const allResults = await store.query().orderBy('id', 'asc').execute()
      const offsetResults = await store.query().orderBy('id', 'asc').offset(3).execute()

      expect(offsetResults[0].id).toBe(allResults[3].id)
    })

    it('combines limit and offset for pagination', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      for (let i = 0; i < 20; i++) {
        await store.create(createTestCustomer({ id: `cust-${String(i).padStart(2, '0')}` }))
      }

      // Page 2 with page size 5
      const results = await store.query()
        .orderBy('id', 'asc')
        .limit(5)
        .offset(5)
        .execute()

      expect(results).toHaveLength(5)
      expect(results[0].id).toBe('cust-05')
    })
  })

  describe('find shorthand', () => {
    it('find method works as query().where().execute() shorthand', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })

      await store.create(createTestCustomer({ name: 'Alice', tier: 'premium' }))
      await store.create(createTestCustomer({ name: 'Bob', tier: 'basic' }))

      const queryResults = await store.query().where({ tier: 'premium' }).execute()
      const findResults = await store.find({ tier: 'premium' })

      expect(findResults).toEqual(queryResults)
    })
  })
})

// ============================================================================
// CDC Event Emission Tests
// ============================================================================

describe('CDC Event Emission', () => {
  describe('on method for subscribing', () => {
    it('subscribes to create events', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })
      const handler = vi.fn()

      store.on('create', handler)
      const customer = createTestCustomer()
      await store.create(customer)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'create',
          item: expect.objectContaining({ id: customer.id }),
        })
      )
    })

    it('subscribes to update events', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })
      const handler = vi.fn()

      const customer = createTestCustomer()
      await store.create(customer)

      store.on('update', handler)
      await store.update(customer.id, { name: 'Updated Name' })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'update',
          item: expect.objectContaining({ name: 'Updated Name' }),
          previous: expect.objectContaining({ name: customer.name }),
        })
      )
    })

    it('subscribes to delete events', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })
      const handler = vi.fn()

      const customer = createTestCustomer()
      await store.create(customer)

      store.on('delete', handler)
      await store.delete(customer.id)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'delete',
          item: expect.objectContaining({ id: customer.id }),
        })
      )
    })

    it('returns unsubscribe function', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })
      const handler = vi.fn()

      const unsubscribe = store.on('create', handler)

      await store.create(createTestCustomer())
      expect(handler).toHaveBeenCalledTimes(1)

      unsubscribe()

      await store.create(createTestCustomer())
      expect(handler).toHaveBeenCalledTimes(1) // Still 1, not called again
    })

    it('supports multiple subscribers for same event', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      store.on('create', handler1)
      store.on('create', handler2)

      await store.create(createTestCustomer())

      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledTimes(1)
    })

    it('supports wildcard * event for all events', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })
      const handler = vi.fn()

      store.on('*', handler)

      const customer = createTestCustomer()
      await store.create(customer)
      await store.update(customer.id, { name: 'Updated' })
      await store.delete(customer.id)

      expect(handler).toHaveBeenCalledTimes(3)
    })
  })

  describe('CDC event structure', () => {
    it('includes event type in CDC event', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })
      const handler = vi.fn()

      store.on('create', handler)
      await store.create(createTestCustomer())

      expect(handler.mock.calls[0][0].type).toBe('create')
    })

    it('includes item in CDC event', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })
      const handler = vi.fn()

      const customer = createTestCustomer({ name: 'Test Customer' })
      store.on('create', handler)
      await store.create(customer)

      expect(handler.mock.calls[0][0].item.name).toBe('Test Customer')
    })

    it('includes timestamp in CDC event', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })
      const handler = vi.fn()

      const before = Date.now()
      store.on('create', handler)
      await store.create(createTestCustomer())
      const after = Date.now()

      const timestamp = handler.mock.calls[0][0].timestamp
      expect(timestamp).toBeGreaterThanOrEqual(before)
      expect(timestamp).toBeLessThanOrEqual(after)
    })

    it('includes store type in CDC event', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })
      const handler = vi.fn()

      store.on('create', handler)
      await store.create(createTestCustomer())

      expect(handler.mock.calls[0][0].store).toBe('Customer')
    })

    it('includes previous state for update events', async () => {
      const mockDb = createMockDb()
      const store = createStore<Customer>(mockDb, { type: 'Customer' })
      const handler = vi.fn()

      const customer = createTestCustomer({ name: 'Original' })
      await store.create(customer)

      store.on('update', handler)
      await store.update(customer.id, { name: 'Updated' })

      expect(handler.mock.calls[0][0].previous.name).toBe('Original')
      expect(handler.mock.calls[0][0].item.name).toBe('Updated')
    })
  })
})

// ============================================================================
// Lifecycle Hooks Tests
// ============================================================================

describe('Lifecycle Hooks', () => {
  describe('onCreate hook', () => {
    it('calls onCreate before creating item', async () => {
      const mockDb = createMockDb()
      const onCreate = vi.fn().mockResolvedValue(undefined)

      const store = createStore<Customer>(mockDb, {
        type: 'Customer',
        hooks: { onCreate },
      })

      const customer = createTestCustomer()
      await store.create(customer)

      expect(onCreate).toHaveBeenCalledTimes(1)
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: customer.name })
      )
    })

    it('allows onCreate to modify item before storage', async () => {
      const mockDb = createMockDb()
      const onCreate = vi.fn(async (item: Customer) => {
        return { ...item, metadata: { createdVia: 'hook' } }
      })

      const store = createStore<Customer>(mockDb, {
        type: 'Customer',
        hooks: { onCreate },
      })

      const customer = createTestCustomer()
      const result = await store.create(customer)

      expect(result.metadata?.createdVia).toBe('hook')
    })

    it('onCreate error prevents creation', async () => {
      const mockDb = createMockDb()
      const onCreate = vi.fn().mockRejectedValue(new Error('Validation failed'))

      const store = createStore<Customer>(mockDb, {
        type: 'Customer',
        hooks: { onCreate },
      })

      await expect(store.create(createTestCustomer())).rejects.toThrow('Validation failed')
    })
  })

  describe('onUpdate hook', () => {
    it('calls onUpdate with current and previous state', async () => {
      const mockDb = createMockDb()
      const onUpdate = vi.fn().mockResolvedValue(undefined)

      const store = createStore<Customer>(mockDb, {
        type: 'Customer',
        hooks: { onUpdate },
      })

      const customer = createTestCustomer({ name: 'Original' })
      await store.create(customer)
      await store.update(customer.id, { name: 'Updated' })

      expect(onUpdate).toHaveBeenCalledTimes(1)
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Updated' }),
        expect.objectContaining({ name: 'Original' })
      )
    })

    it('allows onUpdate to modify updates', async () => {
      const mockDb = createMockDb()
      const onUpdate = vi.fn(async (item: Customer, prev: Customer) => {
        return { ...item, metadata: { previousName: prev.name } }
      })

      const store = createStore<Customer>(mockDb, {
        type: 'Customer',
        hooks: { onUpdate },
      })

      const customer = createTestCustomer({ name: 'Original' })
      await store.create(customer)
      const result = await store.update(customer.id, { name: 'Updated' })

      expect(result.metadata?.previousName).toBe('Original')
    })

    it('onUpdate error prevents update', async () => {
      const mockDb = createMockDb()
      const onUpdate = vi.fn().mockRejectedValue(new Error('Update blocked'))

      const store = createStore<Customer>(mockDb, {
        type: 'Customer',
        hooks: { onUpdate },
      })

      const customer = createTestCustomer()
      await store.create(customer)

      await expect(store.update(customer.id, { name: 'New' })).rejects.toThrow('Update blocked')
    })
  })

  describe('onDelete hook', () => {
    it('calls onDelete with item being deleted', async () => {
      const mockDb = createMockDb()
      const onDelete = vi.fn().mockResolvedValue(undefined)

      const store = createStore<Customer>(mockDb, {
        type: 'Customer',
        hooks: { onDelete },
      })

      const customer = createTestCustomer()
      await store.create(customer)
      await store.delete(customer.id)

      expect(onDelete).toHaveBeenCalledTimes(1)
      expect(onDelete).toHaveBeenCalledWith(
        expect.objectContaining({ id: customer.id })
      )
    })

    it('onDelete error prevents deletion', async () => {
      const mockDb = createMockDb()
      const onDelete = vi.fn().mockRejectedValue(new Error('Cannot delete'))

      const store = createStore<Customer>(mockDb, {
        type: 'Customer',
        hooks: { onDelete },
      })

      const customer = createTestCustomer()
      await store.create(customer)

      await expect(store.delete(customer.id)).rejects.toThrow('Cannot delete')

      // Item should still exist
      const retrieved = await store.get(customer.id)
      expect(retrieved).not.toBeNull()
    })

    it('onDelete can perform cleanup operations', async () => {
      const mockDb = createMockDb()
      const cleanupFn = vi.fn()
      const onDelete = vi.fn(async (item: Customer) => {
        cleanupFn(item.id)
      })

      const store = createStore<Customer>(mockDb, {
        type: 'Customer',
        hooks: { onDelete },
      })

      const customer = createTestCustomer()
      await store.create(customer)
      await store.delete(customer.id)

      expect(cleanupFn).toHaveBeenCalledWith(customer.id)
    })
  })
})

// ============================================================================
// Store Wrapper Tests (Polymorphism)
// ============================================================================

describe('Store Wrappers for Polymorphism', () => {
  describe('wrapDocumentStore', () => {
    it('wraps DocumentStore to implement Store<T> interface', () => {
      const mockDb = createMockDb()
      const documentStore = new DocumentStore<Customer>(mockDb as any, { type: 'Customer' })

      const store = wrapDocumentStore(documentStore)

      expect(typeof store.create).toBe('function')
      expect(typeof store.get).toBe('function')
      expect(typeof store.update).toBe('function')
      expect(typeof store.delete).toBe('function')
      expect(typeof store.query).toBe('function')
      expect(typeof store.find).toBe('function')
      expect(typeof store.on).toBe('function')
    })

    it('wrapped DocumentStore passes type guard', () => {
      const mockDb = createMockDb()
      const documentStore = new DocumentStore<Customer>(mockDb as any, { type: 'Customer' })

      const store = wrapDocumentStore(documentStore)

      expect(isStore(store)).toBe(true)
    })
  })

  describe('wrapGraphStore', () => {
    it('wraps GraphStore to implement Store<T> interface for edges', () => {
      const mockDb = createMockDb()
      const graphStore = new GraphStore(mockDb as any)

      const store = wrapGraphStore(graphStore)

      expect(typeof store.create).toBe('function')
      expect(typeof store.get).toBe('function')
      expect(typeof store.update).toBe('function')
      expect(typeof store.delete).toBe('function')
      expect(typeof store.query).toBe('function')
      expect(typeof store.find).toBe('function')
      expect(typeof store.on).toBe('function')
    })

    it('wrapped GraphStore passes type guard', () => {
      const mockDb = createMockDb()
      const graphStore = new GraphStore(mockDb as any)

      const store = wrapGraphStore(graphStore)

      expect(isStore(store)).toBe(true)
    })
  })

  describe('wrapVectorStore', () => {
    it('wraps VectorStore to implement Store<T> interface', () => {
      const mockDb = createMockDb()
      const vectorStore = new VectorStore(mockDb as any, {
        dimension: 128,
        lazyInit: true,
      })

      const store = wrapVectorStore(vectorStore)

      expect(typeof store.create).toBe('function')
      expect(typeof store.get).toBe('function')
      expect(typeof store.update).toBe('function')
      expect(typeof store.delete).toBe('function')
      expect(typeof store.query).toBe('function')
      expect(typeof store.find).toBe('function')
      expect(typeof store.on).toBe('function')
    })

    it('wrapped VectorStore passes type guard', () => {
      const mockDb = createMockDb()
      const vectorStore = new VectorStore(mockDb as any, {
        dimension: 128,
        lazyInit: true,
      })

      const store = wrapVectorStore(vectorStore)

      expect(isStore(store)).toBe(true)
    })
  })

  describe('polymorphic usage', () => {
    it('all wrapped stores can be used interchangeably', async () => {
      const mockDb = createMockDb()

      // Different store implementations
      const documentStore = wrapDocumentStore(
        new DocumentStore<Customer>(mockDb as any, { type: 'Customer' })
      )
      const graphStore = wrapGraphStore(new GraphStore(mockDb as any))
      const vectorStore = wrapVectorStore(
        new VectorStore(mockDb as any, { dimension: 128, lazyInit: true })
      )

      // Function that accepts any Store<T>
      async function countItems<T extends { id: string }>(store: Store<T>): Promise<number> {
        const count = await store.query().count()
        return count
      }

      // All stores work with the same function
      expect(await countItems(documentStore)).toBe(0)
      expect(await countItems(graphStore as unknown as Store<{ id: string }>)).toBe(0)
      expect(await countItems(vectorStore as unknown as Store<{ id: string }>)).toBe(0)
    })

    it('stores array can hold mixed store types', async () => {
      const mockDb = createMockDb()

      const stores: Store<any>[] = [
        wrapDocumentStore(new DocumentStore<Customer>(mockDb as any, { type: 'Customer' })),
        wrapGraphStore(new GraphStore(mockDb as any)),
        wrapVectorStore(new VectorStore(mockDb as any, { dimension: 128, lazyInit: true })),
      ]

      // All stores should have the same interface
      for (const store of stores) {
        expect(typeof store.create).toBe('function')
        expect(typeof store.get).toBe('function')
        expect(typeof store.update).toBe('function')
        expect(typeof store.delete).toBe('function')
        expect(typeof store.query).toBe('function')
        expect(typeof store.find).toBe('function')
        expect(typeof store.on).toBe('function')
      }
    })

    it('generic function works with all store types', async () => {
      const mockDb = createMockDb()

      // Generic repository pattern
      class Repository<T extends { id: string }> {
        constructor(private store: Store<T>) {}

        async save(item: T): Promise<T> {
          const existing = await this.store.get(item.id)
          if (existing) {
            return this.store.update(item.id, item)
          }
          return this.store.create(item)
        }

        async findById(id: string): Promise<T | null> {
          return this.store.get(id)
        }

        async remove(id: string): Promise<boolean> {
          return this.store.delete(id)
        }

        async all(): Promise<T[]> {
          return this.store.query().execute()
        }
      }

      const customerStore = wrapDocumentStore(
        new DocumentStore<Customer>(mockDb as any, { type: 'Customer' })
      )
      const customerRepo = new Repository<Customer>(customerStore)

      // Repository works with the wrapped store
      expect(customerRepo).toBeDefined()
      expect(typeof customerRepo.save).toBe('function')
      expect(typeof customerRepo.findById).toBe('function')
      expect(typeof customerRepo.remove).toBe('function')
      expect(typeof customerRepo.all).toBe('function')
    })
  })
})

// ============================================================================
// isStore Type Guard Tests
// ============================================================================

describe('isStore Type Guard', () => {
  it('returns true for valid Store implementations', () => {
    const mockDb = createMockDb()
    const store = createStore<Customer>(mockDb, { type: 'Customer' })

    expect(isStore(store)).toBe(true)
  })

  it('returns false for null', () => {
    expect(isStore(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isStore(undefined)).toBe(false)
  })

  it('returns false for plain objects', () => {
    expect(isStore({})).toBe(false)
    expect(isStore({ create: 'not a function' })).toBe(false)
  })

  it('returns false for objects missing required methods', () => {
    const partial = {
      create: vi.fn(),
      get: vi.fn(),
      // Missing update, delete, query, find, on
    }

    expect(isStore(partial)).toBe(false)
  })

  it('returns true for objects with all required methods', () => {
    const complete = {
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      query: vi.fn(),
      find: vi.fn(),
      on: vi.fn(),
    }

    expect(isStore(complete)).toBe(true)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('handles concurrent create operations', async () => {
    const mockDb = createMockDb()
    const store = createStore<Customer>(mockDb, { type: 'Customer' })

    const promises = Array.from({ length: 10 }, (_, i) =>
      store.create(createTestCustomer({ name: `Customer ${i}` }))
    )

    const results = await Promise.all(promises)

    expect(results).toHaveLength(10)
    const ids = results.map(r => r.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(10) // All unique IDs
  })

  it('handles large batch of items', async () => {
    const mockDb = createMockDb()
    const store = createStore<Customer>(mockDb, { type: 'Customer' })

    const batchSize = 100
    for (let i = 0; i < batchSize; i++) {
      await store.create(createTestCustomer({ name: `Customer ${i}` }))
    }

    const count = await store.query().count()
    expect(count).toBe(batchSize)
  })

  it('handles special characters in field values', async () => {
    const mockDb = createMockDb()
    const store = createStore<Customer>(mockDb, { type: 'Customer' })

    const customer = createTestCustomer({
      name: "O'Brien \"Johnny\" <test>",
      email: 'user+tag@example.com',
      metadata: {
        notes: 'Line 1\nLine 2\tTabbed',
        unicode: '\u{1F600} emoji',
      },
    })

    const created = await store.create(customer)
    const retrieved = await store.get(created.id)

    expect(retrieved?.name).toBe(customer.name)
    expect(retrieved?.metadata?.unicode).toBe('\u{1F600} emoji')
  })

  it('handles null and undefined field values', async () => {
    const mockDb = createMockDb()
    const store = createStore<Customer>(mockDb, { type: 'Customer' })

    const customer = createTestCustomer({
      tier: undefined,
      metadata: null as any,
    })

    const created = await store.create(customer)
    const retrieved = await store.get(created.id)

    expect(retrieved?.tier).toBeUndefined()
    expect(retrieved?.metadata).toBeNull()
  })

  it('handles empty string id gracefully', async () => {
    const mockDb = createMockDb()
    const store = createStore<Customer>(mockDb, { type: 'Customer' })

    await expect(store.get('')).rejects.toThrow()
    await expect(store.update('', { name: 'Test' })).rejects.toThrow()
    await expect(store.delete('')).rejects.toThrow()
  })

  it('handles very long string values', async () => {
    const mockDb = createMockDb()
    const store = createStore<Customer>(mockDb, { type: 'Customer' })

    const longName = 'A'.repeat(10000)
    const customer = createTestCustomer({ name: longName })

    const created = await store.create(customer)
    const retrieved = await store.get(created.id)

    expect(retrieved?.name).toBe(longName)
    expect(retrieved?.name.length).toBe(10000)
  })

  it('handles deeply nested objects', async () => {
    const mockDb = createMockDb()
    const store = createStore<Customer>(mockDb, { type: 'Customer' })

    const deeplyNested: Record<string, unknown> = {}
    let current = deeplyNested
    for (let i = 0; i < 20; i++) {
      current.level = { depth: i }
      current = current.level as Record<string, unknown>
    }

    const customer = createTestCustomer({ metadata: deeplyNested })
    const created = await store.create(customer)
    const retrieved = await store.get(created.id)

    expect(retrieved?.metadata?.level).toBeDefined()
  })
})
