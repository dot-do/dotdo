/**
 * Join Cardinality Estimation Tests
 *
 * These tests expose the bug in execution-engine.ts line 573 where
 * Math.max(leftCard, rightCard) is used instead of proper cardinality estimation.
 *
 * Correct formulas:
 * - INNER JOIN: min(leftCard, rightCard) for 1:1, or leftCard * rightCard / max(leftDistinct, rightDistinct) for FK joins
 * - LEFT OUTER JOIN: at least leftCard (all left rows preserved)
 * - CROSS JOIN: leftCard * rightCard (Cartesian product)
 * - SEMI-JOIN: at most leftCard (subset of left matching right)
 *
 * Current bug: Math.max(leftCard, rightCard) is wrong for all join types
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  ExecutionEngine,
  type ExecutionContext,
  type TypedColumnStore,
} from '../executor/execution-engine'
import type { QueryPlan } from '../planner/query-planner'

describe('Join Cardinality Estimation', () => {
  let engine: ExecutionEngine
  let ctx: ExecutionContext

  /**
   * Helper to create a mock store with specific row count
   */
  function createMockStore(rowCount: number, columns: Record<string, unknown[]>): TypedColumnStore {
    return {
      project: vi.fn().mockReturnValue({
        columns: new Map(Object.entries(columns)),
        rowCount,
      }),
      filter: vi.fn(),
      aggregate: vi.fn(),
      bloomFilter: vi.fn().mockReturnValue(null),
      minMax: vi.fn().mockReturnValue(null),
    } as unknown as TypedColumnStore
  }

  beforeEach(() => {
    engine = new ExecutionEngine()
    ctx = {
      columnStore: createMockStore(0, {}),
      parameters: new Map(),
      timeout: 30000,
    }
  })

  // ===========================================================================
  // Cardinality Estimation Tests
  // ===========================================================================

  describe('cardinality estimation', () => {
    it('estimates inner join cardinality correctly - should be min, not max', async () => {
      /**
       * INNER JOIN between orders (1000 rows) and customers (100 rows)
       * where each order references exactly one customer.
       *
       * Expected: 1000 (all orders match their customer)
       * Bug result: Math.max(1000, 100) = 1000 (happens to be correct by accident)
       *
       * But with reversed sizes:
       * orders (100 rows) JOIN customers (1000 rows)
       * Expected: 100 (each order matches one customer, we can't have more matches than orders)
       * Bug result: Math.max(100, 1000) = 1000 (WRONG!)
       */
      const smallOrders = createMockStore(100, {
        id: Array.from({ length: 100 }, (_, i) => i + 1),
        customerId: Array.from({ length: 100 }, (_, i) => (i % 50) + 1), // 100 orders referencing 50 customers
        amount: Array.from({ length: 100 }, (_, i) => 100 + i),
      })

      const largeCustomers = createMockStore(1000, {
        id: Array.from({ length: 1000 }, (_, i) => i + 1),
        name: Array.from({ length: 1000 }, (_, i) => `Customer ${i}`),
      })

      ctx.stores = { orders: smallOrders, customers: largeCustomers }

      const plan: QueryPlan = {
        type: 'hash_join',
        left: { type: 'scan', source: 'orders', estimatedRows: 100, estimatedCost: 10 },
        right: { type: 'scan', source: 'customers', estimatedRows: 1000, estimatedCost: 100 },
        on: { leftColumn: 'customerId', rightColumn: 'id' },
        estimatedRows: 100, // Correct expectation
        estimatedCost: 200,
      }

      const result = await engine.execute(plan, ctx)

      // BUG: Current implementation returns Math.max(100, 1000) = 1000
      // CORRECT: Should be at most 100 (can't produce more rows than smaller input in FK join)
      expect(result.rowCount).toBeLessThanOrEqual(100)
    })

    it('estimates left outer join cardinality - should be at least left size', async () => {
      /**
       * LEFT OUTER JOIN preserves ALL left rows, even if no match.
       * orders (100 rows) LEFT JOIN customers (50 rows)
       *
       * Expected: at least 100 (all orders preserved)
       * Bug: Math.max(100, 50) = 100 (happens to be correct by accident)
       *
       * With reversed:
       * orders (50 rows) LEFT JOIN customers (100 rows)
       * Expected: at least 50
       * Bug: Math.max(50, 100) = 100 (WRONG - we can't guarantee 100 rows)
       */
      const orders = createMockStore(50, {
        id: Array.from({ length: 50 }, (_, i) => i + 1),
        customerId: Array.from({ length: 50 }, (_, i) => (i % 25) + 1),
      })

      const customers = createMockStore(100, {
        id: Array.from({ length: 100 }, (_, i) => i + 1),
        name: Array.from({ length: 100 }, (_, i) => `Customer ${i}`),
      })

      ctx.stores = { orders, customers }

      const plan: QueryPlan = {
        type: 'hash_join',
        joinType: 'LEFT',
        left: { type: 'scan', source: 'orders', estimatedRows: 50, estimatedCost: 5 },
        right: { type: 'scan', source: 'customers', estimatedRows: 100, estimatedCost: 10 },
        on: { leftColumn: 'customerId', rightColumn: 'id' },
        estimatedRows: 50,
        estimatedCost: 50,
      }

      const result = await engine.execute(plan, ctx)

      // BUG: Current implementation returns Math.max(50, 100) = 100
      // CORRECT: LEFT JOIN guarantees at least left.rowCount rows, but current impl may return more
      // The actual result should be exactly equal to left side since each left row appears once
      expect(result.rowCount).toBe(50)
    })

    it('estimates cross join cardinality - should be product of both', async () => {
      /**
       * CROSS JOIN produces Cartesian product: left * right rows
       *
       * colors (3 rows) CROSS JOIN sizes (4 rows)
       * Expected: 3 * 4 = 12
       * Bug: Math.max(3, 4) = 4 (WRONG!)
       */
      const colors = createMockStore(3, {
        color: ['red', 'green', 'blue'],
      })

      const sizes = createMockStore(4, {
        size: ['S', 'M', 'L', 'XL'],
      })

      ctx.stores = { colors, sizes }

      const plan: QueryPlan = {
        type: 'nested_loop', // Cross join often uses nested loop
        joinType: 'CROSS',
        left: { type: 'scan', source: 'colors', estimatedRows: 3, estimatedCost: 1 },
        right: { type: 'scan', source: 'sizes', estimatedRows: 4, estimatedCost: 1 },
        on: { leftColumn: 'color', rightColumn: 'size' }, // Not used for cross join
        estimatedRows: 12,
        estimatedCost: 10,
      }

      const result = await engine.execute(plan, ctx)

      // BUG: Current implementation returns Math.max(3, 4) = 4
      // CORRECT: Cross join should return 3 * 4 = 12
      expect(result.rowCount).toBe(12)
    })

    it('estimates semi-join cardinality - should be at most left size', async () => {
      /**
       * SEMI-JOIN returns left rows that have at least one match in right.
       * Result can never exceed left table size.
       *
       * orders (100 rows) SEMI JOIN premium_customers (500 rows)
       * Expected: at most 100 (subset of orders)
       * Bug: Math.max(100, 500) = 500 (WRONG - can't return more rows than left!)
       */
      const orders = createMockStore(100, {
        id: Array.from({ length: 100 }, (_, i) => i + 1),
        customerId: Array.from({ length: 100 }, (_, i) => (i % 30) + 1), // 30 unique customers
      })

      const premiumCustomers = createMockStore(500, {
        id: Array.from({ length: 500 }, (_, i) => i + 1),
        tier: Array.from({ length: 500 }, () => 'premium'),
      })

      ctx.stores = { orders, premium_customers: premiumCustomers }

      const plan: QueryPlan = {
        type: 'hash_join',
        joinType: 'SEMI',
        left: { type: 'scan', source: 'orders', estimatedRows: 100, estimatedCost: 10 },
        right: { type: 'scan', source: 'premium_customers', estimatedRows: 500, estimatedCost: 50 },
        on: { leftColumn: 'customerId', rightColumn: 'id' },
        estimatedRows: 100,
        estimatedCost: 100,
      }

      const result = await engine.execute(plan, ctx)

      // BUG: Current implementation returns Math.max(100, 500) = 500
      // CORRECT: Semi-join can never return more rows than left table
      expect(result.rowCount).toBeLessThanOrEqual(100)
    })
  })

  // ===========================================================================
  // Selectivity-Based Estimation Tests
  // ===========================================================================

  describe('selectivity-based estimation', () => {
    it('applies selectivity to join estimate for FK joins', async () => {
      /**
       * FK join: orders.customerId -> customers.id
       * 1000 orders, 100 customers, each customer has ~10 orders
       *
       * Inner join result = 1000 (each order matches exactly one customer)
       * Bug: Math.max(1000, 100) = 1000 (correct by accident)
       *
       * Reverse test case to expose bug:
       */
      const orders = createMockStore(1000, {
        id: Array.from({ length: 1000 }, (_, i) => i + 1),
        customerId: Array.from({ length: 1000 }, (_, i) => (i % 100) + 1),
      })

      const activeCustomers = createMockStore(50, {
        id: Array.from({ length: 50 }, (_, i) => i + 1), // Only first 50 customers
        status: Array.from({ length: 50 }, () => 'active'),
      })

      ctx.stores = { orders, activeCustomers }

      const plan: QueryPlan = {
        type: 'hash_join',
        left: { type: 'scan', source: 'orders', estimatedRows: 1000, estimatedCost: 100 },
        right: { type: 'scan', source: 'activeCustomers', estimatedRows: 50, estimatedCost: 5 },
        on: { leftColumn: 'customerId', rightColumn: 'id' },
        estimatedRows: 500, // 50% of orders match active customers
        estimatedCost: 200,
      }

      const result = await engine.execute(plan, ctx)

      // BUG: Current implementation returns Math.max(1000, 50) = 1000
      // CORRECT: Only orders matching active customers (IDs 1-50) should be in result
      // That's 1000 orders * (50/100 customers) = 500 expected
      expect(result.rowCount).toBeLessThanOrEqual(500)
    })

    it('handles highly selective predicates with <1% match rate', async () => {
      /**
       * Highly selective join: transactions JOIN fraud_alerts
       * 100000 transactions, 500 fraud alerts (~0.5% match rate)
       *
       * Expected: ~500 matching rows
       * Bug: Math.max(100000, 500) = 100000 (MASSIVELY WRONG!)
       */
      const transactions = createMockStore(100000, {
        id: Array.from({ length: 100000 }, (_, i) => i + 1),
        alertId: Array.from({ length: 100000 }, (_, i) => i < 500 ? i + 1 : null), // Only 500 have alerts
      })

      const fraudAlerts = createMockStore(500, {
        id: Array.from({ length: 500 }, (_, i) => i + 1),
        severity: Array.from({ length: 500 }, () => 'high'),
      })

      ctx.stores = { transactions, fraudAlerts }

      const plan: QueryPlan = {
        type: 'hash_join',
        left: { type: 'scan', source: 'transactions', estimatedRows: 100000, estimatedCost: 10000 },
        right: { type: 'scan', source: 'fraudAlerts', estimatedRows: 500, estimatedCost: 50 },
        on: { leftColumn: 'alertId', rightColumn: 'id' },
        estimatedRows: 500,
        estimatedCost: 20000,
      }

      const result = await engine.execute(plan, ctx)

      // BUG: Current implementation returns Math.max(100000, 500) = 100000
      // CORRECT: At most 500 (can't have more matches than alerts)
      expect(result.rowCount).toBeLessThanOrEqual(500)
    })

    it('handles non-selective predicates with >50% match rate', async () => {
      /**
       * Non-selective join: users JOIN country
       * 10000 users across 5 countries
       *
       * All users have a country, so result = 10000
       * Bug: Math.max(10000, 5) = 10000 (correct by accident)
       *
       * Reverse to expose:
       */
      const countries = createMockStore(5, {
        id: [1, 2, 3, 4, 5],
        name: ['USA', 'UK', 'Canada', 'Australia', 'Germany'],
      })

      const users = createMockStore(10000, {
        id: Array.from({ length: 10000 }, (_, i) => i + 1),
        countryId: Array.from({ length: 10000 }, (_, i) => (i % 5) + 1),
      })

      ctx.stores = { countries, users }

      // Swap left/right to expose bug
      const plan: QueryPlan = {
        type: 'hash_join',
        left: { type: 'scan', source: 'countries', estimatedRows: 5, estimatedCost: 1 },
        right: { type: 'scan', source: 'users', estimatedRows: 10000, estimatedCost: 1000 },
        on: { leftColumn: 'id', rightColumn: 'countryId' },
        estimatedRows: 5, // Each country matches many users, but we output based on join semantics
        estimatedCost: 2000,
      }

      const result = await engine.execute(plan, ctx)

      // BUG: Current implementation returns Math.max(5, 10000) = 10000
      // For this specific join direction (countries JOIN users), the semantics matter
      // The bug here is that Math.max doesn't consider the actual join condition
      expect(result.rowCount).not.toBe(10000)
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('handles empty left table - zero result', async () => {
      /**
       * Empty left table should produce zero rows in INNER JOIN
       *
       * [] JOIN customers (100 rows) = 0 rows
       * Bug: Math.max(0, 100) = 100 (WRONG!)
       */
      const emptyOrders = createMockStore(0, {
        id: [],
        customerId: [],
      })

      const customers = createMockStore(100, {
        id: Array.from({ length: 100 }, (_, i) => i + 1),
        name: Array.from({ length: 100 }, (_, i) => `Customer ${i}`),
      })

      ctx.stores = { orders: emptyOrders, customers }

      const plan: QueryPlan = {
        type: 'hash_join',
        left: { type: 'scan', source: 'orders', estimatedRows: 0, estimatedCost: 0 },
        right: { type: 'scan', source: 'customers', estimatedRows: 100, estimatedCost: 10 },
        on: { leftColumn: 'customerId', rightColumn: 'id' },
        estimatedRows: 0,
        estimatedCost: 10,
      }

      const result = await engine.execute(plan, ctx)

      // BUG: Current implementation returns Math.max(0, 100) = 100
      // CORRECT: Inner join with empty input produces empty output
      expect(result.rowCount).toBe(0)
    })

    it('handles empty right table - zero result', async () => {
      /**
       * Empty right table should produce zero rows in INNER JOIN
       *
       * orders (100 rows) JOIN [] = 0 rows
       * Bug: Math.max(100, 0) = 100 (WRONG!)
       */
      const orders = createMockStore(100, {
        id: Array.from({ length: 100 }, (_, i) => i + 1),
        customerId: Array.from({ length: 100 }, (_, i) => (i % 50) + 1),
      })

      const emptyCustomers = createMockStore(0, {
        id: [],
        name: [],
      })

      ctx.stores = { orders, customers: emptyCustomers }

      const plan: QueryPlan = {
        type: 'hash_join',
        left: { type: 'scan', source: 'orders', estimatedRows: 100, estimatedCost: 10 },
        right: { type: 'scan', source: 'customers', estimatedRows: 0, estimatedCost: 0 },
        on: { leftColumn: 'customerId', rightColumn: 'id' },
        estimatedRows: 0,
        estimatedCost: 10,
      }

      const result = await engine.execute(plan, ctx)

      // BUG: Current implementation returns Math.max(100, 0) = 100
      // CORRECT: Inner join with empty input produces empty output
      expect(result.rowCount).toBe(0)
    })

    it('handles 1:1 relationship - min cardinality', async () => {
      /**
       * 1:1 relationship: users JOIN user_profiles (every user has exactly one profile)
       * 100 users, 100 profiles
       *
       * Expected: 100 (perfect 1:1 match)
       * Bug: Math.max(100, 100) = 100 (correct by accident)
       *
       * With partial profiles:
       * 100 users, 80 profiles (20 users have no profile)
       * Expected: 80 (only users with profiles)
       */
      const users = createMockStore(100, {
        id: Array.from({ length: 100 }, (_, i) => i + 1),
        email: Array.from({ length: 100 }, (_, i) => `user${i}@test.com`),
      })

      const profiles = createMockStore(80, {
        userId: Array.from({ length: 80 }, (_, i) => i + 1), // Only first 80 users have profiles
        bio: Array.from({ length: 80 }, (_, i) => `Bio ${i}`),
      })

      ctx.stores = { users, profiles }

      const plan: QueryPlan = {
        type: 'hash_join',
        left: { type: 'scan', source: 'users', estimatedRows: 100, estimatedCost: 10 },
        right: { type: 'scan', source: 'profiles', estimatedRows: 80, estimatedCost: 8 },
        on: { leftColumn: 'id', rightColumn: 'userId' },
        estimatedRows: 80,
        estimatedCost: 50,
      }

      const result = await engine.execute(plan, ctx)

      // BUG: Current implementation returns Math.max(100, 80) = 100
      // CORRECT: In 1:1, result is min(left, right) when join column is unique
      expect(result.rowCount).toBe(80)
    })

    it('handles 1:N relationship - scaled cardinality', async () => {
      /**
       * 1:N relationship: categories (10) JOIN products (1000)
       * Each category has ~100 products on average
       *
       * Expected: 1000 (all products match their category)
       * Bug: Math.max(10, 1000) = 1000 (correct by accident)
       *
       * With partial categories:
       * categories (10) JOIN products (1000) where only 5 categories have products
       * Expected: ~500 (only products in active categories)
       */
      const categories = createMockStore(10, {
        id: Array.from({ length: 10 }, (_, i) => i + 1),
        name: Array.from({ length: 10 }, (_, i) => `Category ${i}`),
      })

      // Products only reference categories 1-5
      const products = createMockStore(1000, {
        id: Array.from({ length: 1000 }, (_, i) => i + 1),
        categoryId: Array.from({ length: 1000 }, (_, i) => (i % 5) + 1), // Only categories 1-5
      })

      ctx.stores = { categories, products }

      // Test with smaller categories table on left
      const plan: QueryPlan = {
        type: 'hash_join',
        left: { type: 'scan', source: 'categories', estimatedRows: 10, estimatedCost: 1 },
        right: { type: 'scan', source: 'products', estimatedRows: 1000, estimatedCost: 100 },
        on: { leftColumn: 'id', rightColumn: 'categoryId' },
        estimatedRows: 1000, // All products match a category
        estimatedCost: 200,
      }

      const result = await engine.execute(plan, ctx)

      // BUG: Current implementation returns Math.max(10, 1000) = 1000
      // While 1000 happens to be correct here, the formula is wrong
      // The test exposes that the estimation doesn't consider the actual join semantics
      expect(result.rowCount).toBe(1000)
    })
  })

  // ===========================================================================
  // Query Plan Cost Tests
  // ===========================================================================

  describe('query plan cost', () => {
    it('join order affects cost estimate - smaller table on build side', async () => {
      /**
       * Hash join should build hash table on smaller table
       *
       * orders (10000 rows) JOIN customers (100 rows)
       * Build on customers (100) = cost proportional to 100
       * Build on orders (10000) = cost proportional to 10000
       *
       * The estimated cardinality should be the same regardless of build side,
       * but current implementation doesn't consider build side in cardinality.
       */
      const orders = createMockStore(10000, {
        id: Array.from({ length: 10000 }, (_, i) => i + 1),
        customerId: Array.from({ length: 10000 }, (_, i) => (i % 100) + 1),
        amount: Array.from({ length: 10000 }, (_, i) => Math.random() * 1000),
      })

      const customers = createMockStore(100, {
        id: Array.from({ length: 100 }, (_, i) => i + 1),
        name: Array.from({ length: 100 }, (_, i) => `Customer ${i}`),
      })

      ctx.stores = { orders, customers }

      // Plan 1: Build on customers (optimal)
      const plan1: QueryPlan = {
        type: 'hash_join',
        left: { type: 'scan', source: 'orders', estimatedRows: 10000, estimatedCost: 1000 },
        right: { type: 'scan', source: 'customers', estimatedRows: 100, estimatedCost: 10 },
        on: { leftColumn: 'customerId', rightColumn: 'id' },
        buildSide: 'right',
        estimatedRows: 10000,
        estimatedCost: 2000,
      }

      // Plan 2: Build on orders (suboptimal)
      const plan2: QueryPlan = {
        type: 'hash_join',
        left: { type: 'scan', source: 'customers', estimatedRows: 100, estimatedCost: 10 },
        right: { type: 'scan', source: 'orders', estimatedRows: 10000, estimatedCost: 1000 },
        on: { leftColumn: 'id', rightColumn: 'customerId' },
        buildSide: 'right',
        estimatedRows: 10000,
        estimatedCost: 20000,
      }

      const result1 = await engine.execute(plan1, ctx)
      const result2 = await engine.execute(plan2, ctx)

      // Both should return the same number of rows (join is commutative for INNER)
      // BUG: Math.max gives different results based on which side is "left"
      expect(result1.rowCount).toBe(result2.rowCount)
    })

    it('nested loop vs hash join selection - strategy affects cardinality', async () => {
      /**
       * Small probe table should use nested loop with index
       * Large probe table should use hash join
       *
       * Both strategies should produce the same cardinality for the same logical join.
       */
      const orders = createMockStore(10, {
        id: Array.from({ length: 10 }, (_, i) => i + 1),
        customerId: Array.from({ length: 10 }, (_, i) => (i % 5) + 1),
      })

      const customers = createMockStore(100, {
        id: Array.from({ length: 100 }, (_, i) => i + 1),
        name: Array.from({ length: 100 }, (_, i) => `Customer ${i}`),
      })

      ctx.stores = { orders, customers }

      // Hash join plan
      const hashPlan: QueryPlan = {
        type: 'hash_join',
        left: { type: 'scan', source: 'orders', estimatedRows: 10, estimatedCost: 1 },
        right: { type: 'scan', source: 'customers', estimatedRows: 100, estimatedCost: 10 },
        on: { leftColumn: 'customerId', rightColumn: 'id' },
        estimatedRows: 10,
        estimatedCost: 20,
      }

      // Nested loop plan (same logical join)
      const nestedLoopPlan: QueryPlan = {
        type: 'nested_loop',
        left: { type: 'scan', source: 'orders', estimatedRows: 10, estimatedCost: 1 },
        right: { type: 'index_scan', source: 'customers', estimatedRows: 1, estimatedCost: 0.1 },
        on: { leftColumn: 'customerId', rightColumn: 'id' },
        indexHint: { name: 'idx_customer_id', type: 'btree', columns: ['id'] },
        estimatedRows: 10,
        estimatedCost: 15,
      }

      const hashResult = await engine.execute(hashPlan, ctx)
      const nestedResult = await engine.execute(nestedLoopPlan, ctx)

      // Both should produce the same cardinality (same logical join)
      // BUG: Math.max may give different results based on how the plans are structured
      expect(hashResult.rowCount).toBe(nestedResult.rowCount)
    })
  })

  // ===========================================================================
  // Regression Tests - Verify Bug with Explicit Values
  // ===========================================================================

  describe('regression tests - explicit bug verification', () => {
    it('BUG PROOF: Math.max returns 1000 instead of correct 100', async () => {
      /**
       * This test explicitly shows the Math.max bug.
       *
       * Setup: 100 orders joining with 1000 customers
       * Bug behavior: Math.max(100, 1000) = 1000
       * Expected: Should be at most 100 (each order matches at most one customer)
       */
      const orders = createMockStore(100, {
        id: Array.from({ length: 100 }, (_, i) => i + 1),
        customerId: Array.from({ length: 100 }, (_, i) => (i % 50) + 1),
      })

      const customers = createMockStore(1000, {
        id: Array.from({ length: 1000 }, (_, i) => i + 1),
        name: Array.from({ length: 1000 }, (_, i) => `Customer ${i}`),
      })

      ctx.stores = { orders, customers }

      const plan: QueryPlan = {
        type: 'hash_join',
        left: { type: 'scan', source: 'orders', estimatedRows: 100, estimatedCost: 10 },
        right: { type: 'scan', source: 'customers', estimatedRows: 1000, estimatedCost: 100 },
        on: { leftColumn: 'customerId', rightColumn: 'id' },
        estimatedRows: 100,
        estimatedCost: 200,
      }

      const result = await engine.execute(plan, ctx)

      // THIS ASSERTION PROVES THE BUG:
      // If it fails with "expected 1000 to be less than or equal to 100",
      // that proves Math.max(100, 1000) = 1000 is being used incorrectly.
      expect(result.rowCount).toBeLessThanOrEqual(100)
    })

    it('BUG PROOF: Math.max returns 100 instead of correct 0 for empty table', async () => {
      /**
       * Empty left + non-empty right should produce 0 rows
       * Bug: Math.max(0, 100) = 100
       */
      const emptyTable = createMockStore(0, { id: [] })
      const nonEmptyTable = createMockStore(100, {
        id: Array.from({ length: 100 }, (_, i) => i + 1)
      })

      ctx.stores = { empty: emptyTable, nonempty: nonEmptyTable }

      const plan: QueryPlan = {
        type: 'hash_join',
        left: { type: 'scan', source: 'empty', estimatedRows: 0, estimatedCost: 0 },
        right: { type: 'scan', source: 'nonempty', estimatedRows: 100, estimatedCost: 10 },
        on: { leftColumn: 'id', rightColumn: 'id' },
        estimatedRows: 0,
        estimatedCost: 10,
      }

      const result = await engine.execute(plan, ctx)

      // THIS ASSERTION PROVES THE BUG:
      // If it fails with "expected 100 to equal 0",
      // that proves Math.max(0, 100) = 100 is being used incorrectly.
      expect(result.rowCount).toBe(0)
    })
  })
})
