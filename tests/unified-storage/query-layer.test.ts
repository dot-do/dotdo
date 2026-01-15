/**
 * Query Layer Tests - TDD RED Phase
 *
 * These tests define the expected behavior of the Query Layer component
 * which provides a fluent, type-safe API for querying unified storage.
 *
 * Query Layer provides:
 * - Filter by field value (exact match)
 * - Filter with operators (eq, ne, gt, lt, gte, lte, in, nin)
 * - Pagination (limit, offset, cursor-based)
 * - Sort by field (asc, desc)
 * - Count aggregation
 * - Query plan for index hints
 * - Compound filters (AND, OR)
 * - Nested field queries (dot notation)
 * - Type-safe query builder API
 *
 * These tests WILL FAIL because the Query implementation does not exist yet.
 * This is the TDD RED phase.
 *
 * Issue: do-zspj
 * Phase: 5 (Developer Experience)
 *
 * @module tests/unified-storage/query-layer
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// IMPORTS - These MUST FAIL because the implementation doesn't exist yet
// ============================================================================

// This import will fail - the file doesn't exist
import {
  Query,
  createQuery,
  type QueryOptions,
  type QueryResult,
  type QueryPlan,
  type FilterOperator,
  type SortDirection,
  type CursorInfo,
} from '../../objects/unified-storage/query-layer'

// ============================================================================
// TYPE DEFINITIONS (Expected Interface)
// ============================================================================

/**
 * Thing stored in unified storage
 */
interface Thing {
  $id: string
  $type: string
  $version: number
  $createdAt: number
  $updatedAt: number
  [key: string]: unknown
}

/**
 * Customer entity for type-safe query tests
 */
interface Customer extends Thing {
  $type: 'Customer'
  name: string
  email: string
  status: 'active' | 'inactive' | 'pending'
  balance: number
  tier: 'free' | 'pro' | 'enterprise'
  metadata: {
    signupSource: string
    lastLogin: number
    preferences: {
      theme: 'light' | 'dark'
      notifications: boolean
    }
  }
  tags: string[]
}

/**
 * Order entity for type-safe query tests
 */
interface Order extends Thing {
  $type: 'Order'
  customerId: string
  total: number
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled'
  items: Array<{
    productId: string
    quantity: number
    price: number
  }>
  shippingAddress: {
    street: string
    city: string
    country: string
    postalCode: string
  }
}

// ============================================================================
// MOCK STORE
// ============================================================================

interface MockStore {
  things: Map<string, Thing>
  query<T extends Thing>(options: QueryOptions<T>): Promise<QueryResult<T>>
}

function createMockStore(initialData: Thing[] = []): MockStore {
  const things = new Map<string, Thing>()
  for (const thing of initialData) {
    things.set(thing.$id, thing)
  }

  return {
    things,
    query: vi.fn(async <T extends Thing>(_options: QueryOptions<T>): Promise<QueryResult<T>> => {
      // Mock implementation - real implementation in query-layer.ts
      return {
        data: [],
        total: 0,
        hasMore: false,
      }
    }),
  }
}

function createTestCustomer(overrides: Partial<Customer> = {}): Customer {
  const now = Date.now()
  return {
    $id: `customer_${crypto.randomUUID()}`,
    $type: 'Customer',
    $version: 1,
    $createdAt: now,
    $updatedAt: now,
    name: 'Test Customer',
    email: 'test@example.com',
    status: 'active',
    balance: 100,
    tier: 'free',
    metadata: {
      signupSource: 'web',
      lastLogin: now,
      preferences: {
        theme: 'light',
        notifications: true,
      },
    },
    tags: ['customer'],
    ...overrides,
  }
}

function createTestOrder(overrides: Partial<Order> = {}): Order {
  const now = Date.now()
  return {
    $id: `order_${crypto.randomUUID()}`,
    $type: 'Order',
    $version: 1,
    $createdAt: now,
    $updatedAt: now,
    customerId: 'customer_1',
    total: 100,
    status: 'pending',
    items: [{ productId: 'product_1', quantity: 1, price: 100 }],
    shippingAddress: {
      street: '123 Main St',
      city: 'New York',
      country: 'US',
      postalCode: '10001',
    },
    ...overrides,
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Query Layer', () => {
  let store: MockStore
  let query: Query<Thing>

  beforeEach(() => {
    store = createMockStore()
  })

  // ==========================================================================
  // CONSTRUCTOR AND BASIC API
  // ==========================================================================

  describe('Query construction', () => {
    it('should create a Query instance from store', () => {
      query = createQuery(store)

      expect(query).toBeInstanceOf(Query)
    })

    it('should support method chaining', () => {
      query = createQuery(store)

      const result = query
        .where('status', 'eq', 'active')
        .sort('$createdAt', 'desc')
        .limit(10)

      expect(result).toBeInstanceOf(Query)
    })

    it('should be immutable (each method returns a new Query)', () => {
      query = createQuery(store)

      const query1 = query.where('status', 'eq', 'active')
      const query2 = query.where('status', 'eq', 'inactive')

      expect(query1).not.toBe(query2)
      expect(query1).not.toBe(query)
    })
  })

  // ==========================================================================
  // FILTER BY FIELD VALUE (EXACT MATCH)
  // ==========================================================================

  describe('filter by field value (exact match)', () => {
    it('should filter by exact string value', async () => {
      const customers = [
        createTestCustomer({ $id: 'c_1', status: 'active' }),
        createTestCustomer({ $id: 'c_2', status: 'inactive' }),
        createTestCustomer({ $id: 'c_3', status: 'active' }),
      ]
      store = createMockStore(customers)
      query = createQuery<Customer>(store)

      const result = await query.where('status', 'eq', 'active').exec()

      expect(result.data).toHaveLength(2)
      expect(result.data.every(c => c.status === 'active')).toBe(true)
    })

    it('should filter by exact numeric value', async () => {
      const customers = [
        createTestCustomer({ $id: 'c_1', balance: 100 }),
        createTestCustomer({ $id: 'c_2', balance: 200 }),
        createTestCustomer({ $id: 'c_3', balance: 100 }),
      ]
      store = createMockStore(customers)
      query = createQuery<Customer>(store)

      const result = await query.where('balance', 'eq', 100).exec()

      expect(result.data).toHaveLength(2)
      expect(result.data.every(c => c.balance === 100)).toBe(true)
    })

    it('should filter by exact boolean value', async () => {
      const customers = [
        createTestCustomer({
          $id: 'c_1',
          metadata: { ...createTestCustomer().metadata, preferences: { theme: 'light', notifications: true } },
        }),
        createTestCustomer({
          $id: 'c_2',
          metadata: { ...createTestCustomer().metadata, preferences: { theme: 'dark', notifications: false } },
        }),
      ]
      store = createMockStore(customers)
      query = createQuery<Customer>(store)

      const result = await query.where('metadata.preferences.notifications', 'eq', true).exec()

      expect(result.data).toHaveLength(1)
      expect(result.data[0].metadata.preferences.notifications).toBe(true)
    })
  })

  // ==========================================================================
  // FILTER WITH OPERATORS
  // ==========================================================================

  describe('filter with operators', () => {
    describe('eq (equals)', () => {
      it('should match exact value', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1', name: 'Alice' }),
          createTestCustomer({ $id: 'c_2', name: 'Bob' }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.where('name', 'eq', 'Alice').exec()

        expect(result.data).toHaveLength(1)
        expect(result.data[0].name).toBe('Alice')
      })
    })

    describe('ne (not equals)', () => {
      it('should match values not equal to specified', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1', status: 'active' }),
          createTestCustomer({ $id: 'c_2', status: 'inactive' }),
          createTestCustomer({ $id: 'c_3', status: 'pending' }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.where('status', 'ne', 'active').exec()

        expect(result.data).toHaveLength(2)
        expect(result.data.every(c => c.status !== 'active')).toBe(true)
      })
    })

    describe('gt (greater than)', () => {
      it('should match values greater than specified', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1', balance: 50 }),
          createTestCustomer({ $id: 'c_2', balance: 100 }),
          createTestCustomer({ $id: 'c_3', balance: 150 }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.where('balance', 'gt', 100).exec()

        expect(result.data).toHaveLength(1)
        expect(result.data[0].balance).toBe(150)
      })
    })

    describe('lt (less than)', () => {
      it('should match values less than specified', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1', balance: 50 }),
          createTestCustomer({ $id: 'c_2', balance: 100 }),
          createTestCustomer({ $id: 'c_3', balance: 150 }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.where('balance', 'lt', 100).exec()

        expect(result.data).toHaveLength(1)
        expect(result.data[0].balance).toBe(50)
      })
    })

    describe('gte (greater than or equal)', () => {
      it('should match values greater than or equal to specified', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1', balance: 50 }),
          createTestCustomer({ $id: 'c_2', balance: 100 }),
          createTestCustomer({ $id: 'c_3', balance: 150 }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.where('balance', 'gte', 100).exec()

        expect(result.data).toHaveLength(2)
        expect(result.data.every(c => c.balance >= 100)).toBe(true)
      })
    })

    describe('lte (less than or equal)', () => {
      it('should match values less than or equal to specified', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1', balance: 50 }),
          createTestCustomer({ $id: 'c_2', balance: 100 }),
          createTestCustomer({ $id: 'c_3', balance: 150 }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.where('balance', 'lte', 100).exec()

        expect(result.data).toHaveLength(2)
        expect(result.data.every(c => c.balance <= 100)).toBe(true)
      })
    })

    describe('in (in array)', () => {
      it('should match values in the specified array', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1', tier: 'free' }),
          createTestCustomer({ $id: 'c_2', tier: 'pro' }),
          createTestCustomer({ $id: 'c_3', tier: 'enterprise' }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.where('tier', 'in', ['pro', 'enterprise']).exec()

        expect(result.data).toHaveLength(2)
        expect(result.data.every(c => ['pro', 'enterprise'].includes(c.tier))).toBe(true)
      })

      it('should handle empty array', async () => {
        const customers = [createTestCustomer({ $id: 'c_1', tier: 'free' })]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.where('tier', 'in', []).exec()

        expect(result.data).toHaveLength(0)
      })
    })

    describe('nin (not in array)', () => {
      it('should match values not in the specified array', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1', tier: 'free' }),
          createTestCustomer({ $id: 'c_2', tier: 'pro' }),
          createTestCustomer({ $id: 'c_3', tier: 'enterprise' }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.where('tier', 'nin', ['free']).exec()

        expect(result.data).toHaveLength(2)
        expect(result.data.every(c => c.tier !== 'free')).toBe(true)
      })
    })

    describe('contains (string contains)', () => {
      it('should match strings containing substring', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1', email: 'alice@example.com' }),
          createTestCustomer({ $id: 'c_2', email: 'bob@test.com' }),
          createTestCustomer({ $id: 'c_3', email: 'carol@example.org' }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.where('email', 'contains', 'example').exec()

        expect(result.data).toHaveLength(2)
        expect(result.data.every(c => c.email.includes('example'))).toBe(true)
      })
    })

    describe('startsWith', () => {
      it('should match strings starting with prefix', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1', name: 'Alice Smith' }),
          createTestCustomer({ $id: 'c_2', name: 'Bob Jones' }),
          createTestCustomer({ $id: 'c_3', name: 'Alice Johnson' }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.where('name', 'startsWith', 'Alice').exec()

        expect(result.data).toHaveLength(2)
        expect(result.data.every(c => c.name.startsWith('Alice'))).toBe(true)
      })
    })

    describe('endsWith', () => {
      it('should match strings ending with suffix', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1', email: 'alice@example.com' }),
          createTestCustomer({ $id: 'c_2', email: 'bob@test.org' }),
          createTestCustomer({ $id: 'c_3', email: 'carol@example.com' }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.where('email', 'endsWith', '.com').exec()

        expect(result.data).toHaveLength(2)
        expect(result.data.every(c => c.email.endsWith('.com'))).toBe(true)
      })
    })

    describe('exists', () => {
      it('should match when field exists', async () => {
        const things: Thing[] = [
          { ...createTestCustomer({ $id: 'c_1' }), optionalField: 'value' },
          createTestCustomer({ $id: 'c_2' }), // no optionalField
        ]
        store = createMockStore(things)
        query = createQuery<Thing>(store)

        const result = await query.where('optionalField', 'exists', true).exec()

        expect(result.data).toHaveLength(1)
      })

      it('should match when field does not exist', async () => {
        const things: Thing[] = [
          { ...createTestCustomer({ $id: 'c_1' }), optionalField: 'value' },
          createTestCustomer({ $id: 'c_2' }), // no optionalField
        ]
        store = createMockStore(things)
        query = createQuery<Thing>(store)

        const result = await query.where('optionalField', 'exists', false).exec()

        expect(result.data).toHaveLength(1)
      })
    })
  })

  // ==========================================================================
  // PAGINATION
  // ==========================================================================

  describe('pagination', () => {
    describe('limit', () => {
      it('should limit results to specified count', async () => {
        const customers = Array.from({ length: 20 }, (_, i) =>
          createTestCustomer({ $id: `c_${i}`, name: `Customer ${i}` })
        )
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.limit(5).exec()

        expect(result.data).toHaveLength(5)
      })

      it('should return all results if limit exceeds total', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1' }),
          createTestCustomer({ $id: 'c_2' }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.limit(100).exec()

        expect(result.data).toHaveLength(2)
        expect(result.hasMore).toBe(false)
      })
    })

    describe('offset', () => {
      it('should skip specified number of results', async () => {
        const customers = Array.from({ length: 10 }, (_, i) =>
          createTestCustomer({ $id: `c_${i}`, name: `Customer ${i}` })
        )
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.sort('name', 'asc').offset(5).limit(5).exec()

        expect(result.data).toHaveLength(5)
        expect(result.data[0].name).toBe('Customer 5')
      })

      it('should return empty if offset exceeds total', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1' }),
          createTestCustomer({ $id: 'c_2' }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.offset(100).exec()

        expect(result.data).toHaveLength(0)
      })
    })

    describe('cursor-based pagination', () => {
      it('should support after cursor', async () => {
        const customers = Array.from({ length: 10 }, (_, i) =>
          createTestCustomer({ $id: `c_${i}`, name: `Customer ${i}` })
        )
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const page1 = await query.sort('$id', 'asc').limit(3).exec()

        expect(page1.data).toHaveLength(3)
        expect(page1.cursor).toBeDefined()
        expect(page1.hasMore).toBe(true)

        const page2 = await query.sort('$id', 'asc').after(page1.cursor!).limit(3).exec()

        expect(page2.data).toHaveLength(3)
        expect(page2.data[0].$id).toBe('c_3')
      })

      it('should support before cursor', async () => {
        const customers = Array.from({ length: 10 }, (_, i) =>
          createTestCustomer({ $id: `c_${i}`, name: `Customer ${i}` })
        )
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        // Get page with cursor pointing to c_5
        const middlePage = await query
          .where('$id', 'gte', 'c_5')
          .sort('$id', 'asc')
          .limit(3)
          .exec()

        const previousPage = await query
          .sort('$id', 'asc')
          .before(middlePage.cursor!)
          .limit(3)
          .exec()

        expect(previousPage.data).toHaveLength(3)
        expect(previousPage.data[previousPage.data.length - 1].$id).toBe('c_4')
      })

      it('should include cursor info in result', async () => {
        const customers = Array.from({ length: 5 }, (_, i) =>
          createTestCustomer({ $id: `c_${i}` })
        )
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.sort('$id', 'asc').limit(3).exec()

        expect(result.cursor).toBeDefined()
        expect(result.cursorInfo).toBeDefined()
        expect(result.cursorInfo?.field).toBe('$id')
        expect(result.cursorInfo?.direction).toBe('asc')
      })
    })

    describe('pagination metadata', () => {
      it('should include total count', async () => {
        const customers = Array.from({ length: 100 }, (_, i) =>
          createTestCustomer({ $id: `c_${i}` })
        )
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.limit(10).exec()

        expect(result.total).toBe(100)
        expect(result.hasMore).toBe(true)
      })

      it('should indicate hasMore correctly', async () => {
        const customers = Array.from({ length: 15 }, (_, i) =>
          createTestCustomer({ $id: `c_${i}` })
        )
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const page1 = await query.limit(10).exec()
        expect(page1.hasMore).toBe(true)

        const page2 = await query.offset(10).limit(10).exec()
        expect(page2.hasMore).toBe(false)
      })
    })
  })

  // ==========================================================================
  // SORTING
  // ==========================================================================

  describe('sorting', () => {
    describe('sort ascending', () => {
      it('should sort by field ascending', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_3', name: 'Charlie' }),
          createTestCustomer({ $id: 'c_1', name: 'Alice' }),
          createTestCustomer({ $id: 'c_2', name: 'Bob' }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.sort('name', 'asc').exec()

        expect(result.data.map(c => c.name)).toEqual(['Alice', 'Bob', 'Charlie'])
      })

      it('should sort numeric fields correctly', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_2', balance: 200 }),
          createTestCustomer({ $id: 'c_1', balance: 50 }),
          createTestCustomer({ $id: 'c_3', balance: 100 }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.sort('balance', 'asc').exec()

        expect(result.data.map(c => c.balance)).toEqual([50, 100, 200])
      })
    })

    describe('sort descending', () => {
      it('should sort by field descending', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1', name: 'Alice' }),
          createTestCustomer({ $id: 'c_3', name: 'Charlie' }),
          createTestCustomer({ $id: 'c_2', name: 'Bob' }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.sort('name', 'desc').exec()

        expect(result.data.map(c => c.name)).toEqual(['Charlie', 'Bob', 'Alice'])
      })

      it('should sort by timestamp descending', async () => {
        const now = Date.now()
        const customers = [
          createTestCustomer({ $id: 'c_1', $createdAt: now - 1000 }),
          createTestCustomer({ $id: 'c_2', $createdAt: now - 500 }),
          createTestCustomer({ $id: 'c_3', $createdAt: now }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query.sort('$createdAt', 'desc').exec()

        expect(result.data.map(c => c.$id)).toEqual(['c_3', 'c_2', 'c_1'])
      })
    })

    describe('multiple sort fields', () => {
      it('should support secondary sort field', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1', status: 'active', name: 'Charlie' }),
          createTestCustomer({ $id: 'c_2', status: 'active', name: 'Alice' }),
          createTestCustomer({ $id: 'c_3', status: 'inactive', name: 'Bob' }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query
          .sort('status', 'asc')
          .thenSort('name', 'asc')
          .exec()

        expect(result.data.map(c => c.$id)).toEqual(['c_2', 'c_1', 'c_3'])
      })
    })
  })

  // ==========================================================================
  // COUNT AGGREGATION
  // ==========================================================================

  describe('count aggregation', () => {
    it('should count all matching records', async () => {
      const customers = Array.from({ length: 50 }, (_, i) =>
        createTestCustomer({ $id: `c_${i}`, status: i % 2 === 0 ? 'active' : 'inactive' })
      )
      store = createMockStore(customers)
      query = createQuery<Customer>(store)

      const count = await query.where('status', 'eq', 'active').count()

      expect(count).toBe(25)
    })

    it('should count all records without filter', async () => {
      const customers = Array.from({ length: 100 }, (_, i) =>
        createTestCustomer({ $id: `c_${i}` })
      )
      store = createMockStore(customers)
      query = createQuery<Customer>(store)

      const count = await query.count()

      expect(count).toBe(100)
    })

    it('should return 0 for empty result set', async () => {
      store = createMockStore([])
      query = createQuery<Customer>(store)

      const count = await query.count()

      expect(count).toBe(0)
    })
  })

  // ==========================================================================
  // QUERY PLAN (INDEX HINTS)
  // ==========================================================================

  describe('query plan and index hints', () => {
    it('should generate query plan', async () => {
      const customers = [createTestCustomer({ $id: 'c_1' })]
      store = createMockStore(customers)
      query = createQuery<Customer>(store)

      const plan = await query.where('status', 'eq', 'active').explain()

      expect(plan).toBeDefined()
      expect(plan.filters).toBeDefined()
      expect(plan.estimatedCost).toBeDefined()
    })

    it('should suggest index for filtered field', async () => {
      store = createMockStore([])
      query = createQuery<Customer>(store)

      const plan = await query.where('email', 'eq', 'test@example.com').explain()

      expect(plan.indexHints).toBeDefined()
      expect(plan.indexHints).toContainEqual(
        expect.objectContaining({
          field: 'email',
          type: 'exact',
        })
      )
    })

    it('should suggest range index for comparison operators', async () => {
      store = createMockStore([])
      query = createQuery<Customer>(store)

      const plan = await query.where('balance', 'gt', 100).explain()

      expect(plan.indexHints).toContainEqual(
        expect.objectContaining({
          field: 'balance',
          type: 'range',
        })
      )
    })

    it('should identify full scan queries', async () => {
      store = createMockStore([])
      query = createQuery<Customer>(store)

      const plan = await query.where('name', 'contains', 'test').explain()

      expect(plan.scanType).toBe('full')
    })

    it('should estimate query cost', async () => {
      store = createMockStore([])
      query = createQuery<Customer>(store)

      const plan = await query
        .where('status', 'eq', 'active')
        .sort('$createdAt', 'desc')
        .limit(10)
        .explain()

      expect(plan.estimatedCost).toBeDefined()
      expect(plan.estimatedCost.scanRows).toBeDefined()
      expect(plan.estimatedCost.returnRows).toBeDefined()
    })
  })

  // ==========================================================================
  // COMPOUND FILTERS (AND, OR)
  // ==========================================================================

  describe('compound filters', () => {
    describe('AND filters', () => {
      it('should combine filters with AND by default', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1', status: 'active', tier: 'pro' }),
          createTestCustomer({ $id: 'c_2', status: 'active', tier: 'free' }),
          createTestCustomer({ $id: 'c_3', status: 'inactive', tier: 'pro' }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query
          .where('status', 'eq', 'active')
          .where('tier', 'eq', 'pro')
          .exec()

        expect(result.data).toHaveLength(1)
        expect(result.data[0].$id).toBe('c_1')
      })

      it('should support explicit and() method', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1', status: 'active', balance: 200 }),
          createTestCustomer({ $id: 'c_2', status: 'active', balance: 50 }),
          createTestCustomer({ $id: 'c_3', status: 'inactive', balance: 200 }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query
          .and(
            q => q.where('status', 'eq', 'active'),
            q => q.where('balance', 'gte', 100)
          )
          .exec()

        expect(result.data).toHaveLength(1)
        expect(result.data[0].$id).toBe('c_1')
      })
    })

    describe('OR filters', () => {
      it('should combine filters with OR', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1', tier: 'pro' }),
          createTestCustomer({ $id: 'c_2', tier: 'enterprise' }),
          createTestCustomer({ $id: 'c_3', tier: 'free' }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        const result = await query
          .or(
            q => q.where('tier', 'eq', 'pro'),
            q => q.where('tier', 'eq', 'enterprise')
          )
          .exec()

        expect(result.data).toHaveLength(2)
        expect(result.data.map(c => c.$id)).toEqual(expect.arrayContaining(['c_1', 'c_2']))
      })
    })

    describe('nested compound filters', () => {
      it('should support nested AND/OR', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1', status: 'active', tier: 'pro', balance: 500 }),
          createTestCustomer({ $id: 'c_2', status: 'active', tier: 'free', balance: 100 }),
          createTestCustomer({ $id: 'c_3', status: 'inactive', tier: 'enterprise', balance: 1000 }),
          createTestCustomer({ $id: 'c_4', status: 'active', tier: 'enterprise', balance: 50 }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        // (status = 'active') AND (tier = 'pro' OR tier = 'enterprise')
        const result = await query
          .where('status', 'eq', 'active')
          .or(
            q => q.where('tier', 'eq', 'pro'),
            q => q.where('tier', 'eq', 'enterprise')
          )
          .exec()

        expect(result.data).toHaveLength(2)
        expect(result.data.map(c => c.$id)).toEqual(expect.arrayContaining(['c_1', 'c_4']))
      })

      it('should support deeply nested conditions', async () => {
        const customers = [
          createTestCustomer({ $id: 'c_1', status: 'active', tier: 'pro', balance: 500 }),
          createTestCustomer({ $id: 'c_2', status: 'active', tier: 'free', balance: 100 }),
          createTestCustomer({ $id: 'c_3', status: 'inactive', tier: 'pro', balance: 200 }),
        ]
        store = createMockStore(customers)
        query = createQuery<Customer>(store)

        // (status = 'active' AND tier = 'pro') OR (balance > 150)
        const result = await query
          .or(
            q => q.and(
              q2 => q2.where('status', 'eq', 'active'),
              q2 => q2.where('tier', 'eq', 'pro')
            ),
            q => q.where('balance', 'gt', 150)
          )
          .exec()

        expect(result.data).toHaveLength(2) // c_1 (active pro) and c_3 (balance 200)
      })
    })
  })

  // ==========================================================================
  // NESTED FIELD QUERIES (DOT NOTATION)
  // ==========================================================================

  describe('nested field queries', () => {
    it('should query nested object fields', async () => {
      const customers = [
        createTestCustomer({
          $id: 'c_1',
          metadata: { signupSource: 'web', lastLogin: 0, preferences: { theme: 'dark', notifications: true } },
        }),
        createTestCustomer({
          $id: 'c_2',
          metadata: { signupSource: 'mobile', lastLogin: 0, preferences: { theme: 'light', notifications: true } },
        }),
      ]
      store = createMockStore(customers)
      query = createQuery<Customer>(store)

      const result = await query.where('metadata.signupSource', 'eq', 'web').exec()

      expect(result.data).toHaveLength(1)
      expect(result.data[0].$id).toBe('c_1')
    })

    it('should query deeply nested fields', async () => {
      const customers = [
        createTestCustomer({
          $id: 'c_1',
          metadata: { signupSource: 'web', lastLogin: 0, preferences: { theme: 'dark', notifications: true } },
        }),
        createTestCustomer({
          $id: 'c_2',
          metadata: { signupSource: 'web', lastLogin: 0, preferences: { theme: 'light', notifications: false } },
        }),
      ]
      store = createMockStore(customers)
      query = createQuery<Customer>(store)

      const result = await query.where('metadata.preferences.theme', 'eq', 'dark').exec()

      expect(result.data).toHaveLength(1)
      expect(result.data[0].metadata.preferences.theme).toBe('dark')
    })

    it('should query array index access', async () => {
      const orders = [
        createTestOrder({
          $id: 'o_1',
          items: [
            { productId: 'p_1', quantity: 2, price: 50 },
            { productId: 'p_2', quantity: 1, price: 100 },
          ],
        }),
        createTestOrder({
          $id: 'o_2',
          items: [
            { productId: 'p_3', quantity: 1, price: 200 },
          ],
        }),
      ]
      store = createMockStore(orders)
      query = createQuery<Order>(store)

      const result = await query.where('items.0.productId', 'eq', 'p_1').exec()

      expect(result.data).toHaveLength(1)
      expect(result.data[0].$id).toBe('o_1')
    })

    it('should query nested array element property', async () => {
      const orders = [
        createTestOrder({
          $id: 'o_1',
          items: [
            { productId: 'p_1', quantity: 5, price: 50 },
          ],
        }),
        createTestOrder({
          $id: 'o_2',
          items: [
            { productId: 'p_2', quantity: 1, price: 100 },
          ],
        }),
      ]
      store = createMockStore(orders)
      query = createQuery<Order>(store)

      const result = await query.where('items.0.quantity', 'gt', 3).exec()

      expect(result.data).toHaveLength(1)
      expect(result.data[0].$id).toBe('o_1')
    })

    it('should sort by nested field', async () => {
      const customers = [
        createTestCustomer({
          $id: 'c_1',
          metadata: { signupSource: 'web', lastLogin: 100, preferences: { theme: 'dark', notifications: true } },
        }),
        createTestCustomer({
          $id: 'c_2',
          metadata: { signupSource: 'web', lastLogin: 300, preferences: { theme: 'light', notifications: true } },
        }),
        createTestCustomer({
          $id: 'c_3',
          metadata: { signupSource: 'web', lastLogin: 200, preferences: { theme: 'light', notifications: true } },
        }),
      ]
      store = createMockStore(customers)
      query = createQuery<Customer>(store)

      const result = await query.sort('metadata.lastLogin', 'desc').exec()

      expect(result.data.map(c => c.$id)).toEqual(['c_2', 'c_3', 'c_1'])
    })
  })

  // ==========================================================================
  // TYPE-SAFE QUERY BUILDER API
  // ==========================================================================

  describe('type-safe query builder API', () => {
    it('should infer types from entity type parameter', async () => {
      store = createMockStore([])
      const customerQuery = createQuery<Customer>(store)

      // TypeScript should allow these:
      customerQuery.where('name', 'eq', 'Alice')
      customerQuery.where('status', 'eq', 'active')
      customerQuery.where('balance', 'gt', 100)

      // These should work at runtime (type checking happens at compile time)
      expect(customerQuery).toBeDefined()
    })

    it('should support typed where with field path autocomplete', async () => {
      const customers = [createTestCustomer({ $id: 'c_1', name: 'Alice' })]
      store = createMockStore(customers)
      const customerQuery = createQuery<Customer>(store)

      // This tests that the API supports field paths
      const result = await customerQuery.where('name', 'eq', 'Alice').exec()

      expect(result.data).toHaveLength(1)
    })

    it('should support typed select to pick fields', async () => {
      const customers = [
        createTestCustomer({ $id: 'c_1', name: 'Alice', email: 'alice@example.com', balance: 500 }),
      ]
      store = createMockStore(customers)
      const customerQuery = createQuery<Customer>(store)

      const result = await customerQuery
        .select('$id', 'name', 'email')
        .exec()

      expect(result.data).toHaveLength(1)
      expect(result.data[0]).toHaveProperty('$id')
      expect(result.data[0]).toHaveProperty('name')
      expect(result.data[0]).toHaveProperty('email')
      // balance should not be present when we implement select
    })

    it('should support typed result transformation', async () => {
      const customers = [
        createTestCustomer({ $id: 'c_1', name: 'Alice', balance: 100 }),
        createTestCustomer({ $id: 'c_2', name: 'Bob', balance: 200 }),
      ]
      store = createMockStore(customers)
      const customerQuery = createQuery<Customer>(store)

      const result = await customerQuery
        .map(c => ({
          id: c.$id,
          displayName: c.name.toUpperCase(),
        }))
        .exec()

      expect(result.data).toHaveLength(2)
      expect(result.data[0]).toHaveProperty('id')
      expect(result.data[0]).toHaveProperty('displayName')
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty result set', async () => {
      store = createMockStore([])
      query = createQuery<Customer>(store)

      const result = await query.exec()

      expect(result.data).toHaveLength(0)
      expect(result.total).toBe(0)
      expect(result.hasMore).toBe(false)
    })

    it('should handle special characters in filter values', async () => {
      const customers = [
        createTestCustomer({ $id: 'c_1', name: "Alice's Test" }),
        createTestCustomer({ $id: 'c_2', name: 'Bob "The Builder"' }),
      ]
      store = createMockStore(customers)
      query = createQuery<Customer>(store)

      const result = await query.where('name', 'eq', "Alice's Test").exec()

      expect(result.data).toHaveLength(1)
    })

    it('should handle unicode in filter values', async () => {
      const customers = [
        createTestCustomer({ $id: 'c_1', name: 'Tokugawa' }),
        createTestCustomer({ $id: 'c_2', name: 'Muller' }),
      ]
      store = createMockStore(customers)
      query = createQuery<Customer>(store)

      const result = await query.where('name', 'contains', 'kugawa').exec()

      expect(result.data).toHaveLength(1)
    })

    it('should handle null/undefined values in filters', async () => {
      const things: Thing[] = [
        { ...createTestCustomer({ $id: 'c_1' }), nullableField: null },
        { ...createTestCustomer({ $id: 'c_2' }), nullableField: 'value' },
        createTestCustomer({ $id: 'c_3' }), // undefined field
      ]
      store = createMockStore(things)
      query = createQuery<Thing>(store)

      const resultNull = await query.where('nullableField', 'eq', null).exec()
      expect(resultNull.data).toHaveLength(1)
      expect(resultNull.data[0].$id).toBe('c_1')
    })

    it('should handle very large limit values', async () => {
      const customers = Array.from({ length: 10 }, (_, i) =>
        createTestCustomer({ $id: `c_${i}` })
      )
      store = createMockStore(customers)
      query = createQuery<Customer>(store)

      const result = await query.limit(Number.MAX_SAFE_INTEGER).exec()

      expect(result.data).toHaveLength(10)
    })

    it('should handle negative offset gracefully', async () => {
      const customers = [createTestCustomer({ $id: 'c_1' })]
      store = createMockStore(customers)
      query = createQuery<Customer>(store)

      // Should treat negative offset as 0
      const result = await query.offset(-10).exec()

      expect(result.data).toHaveLength(1)
    })
  })

  // ==========================================================================
  // PERFORMANCE CONSIDERATIONS
  // ==========================================================================

  describe('performance considerations', () => {
    it('should support lazy evaluation', async () => {
      const querySpy = vi.spyOn(store, 'query')
      query = createQuery<Customer>(store)

      // Building the query should not execute it
      const builtQuery = query
        .where('status', 'eq', 'active')
        .sort('name', 'asc')
        .limit(10)

      expect(querySpy).not.toHaveBeenCalled()

      // Only exec() should trigger execution
      await builtQuery.exec()

      expect(querySpy).toHaveBeenCalledTimes(1)
    })

    it('should support streaming results', async () => {
      const customers = Array.from({ length: 100 }, (_, i) =>
        createTestCustomer({ $id: `c_${i}` })
      )
      store = createMockStore(customers)
      query = createQuery<Customer>(store)

      const batches: Customer[][] = []
      for await (const batch of query.stream({ batchSize: 10 })) {
        batches.push(batch)
      }

      expect(batches.length).toBe(10)
      expect(batches.flat()).toHaveLength(100)
    })
  })
})
