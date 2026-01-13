/**
 * Cross-Column Expectations Tests - Referential Integrity Validation
 *
 * Tests for cross-column validation features:
 * - Foreign key validation across tables
 * - Column dependency rules (if A then B)
 * - Cross-column consistency checks
 * - Orphan record detection
 *
 * @see db/primitives/data-contract/cross-column-expectations.ts
 */
import { describe, it, expect } from 'vitest'
import {
  column,
  columns,
  when,
  sum,
  diff,
  product,
  quotient,
  col,
  lit,
  validateCrossColumnExpectations,
  CrossColumnExpectation,
  ReferenceData,
} from '../cross-column-expectations'

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Sample users reference data
 */
function createUsersData(): Record<string, unknown>[] {
  return [
    { id: 'user-1', email: 'alice@example.com', name: 'Alice' },
    { id: 'user-2', email: 'bob@example.com', name: 'Bob' },
    { id: 'user-3', email: 'carol@example.com', name: 'Carol' },
  ]
}

/**
 * Sample orders data
 */
function createOrdersData(): Record<string, unknown>[] {
  return [
    {
      order_id: 'order-1',
      user_id: 'user-1',
      status: 'shipped',
      shipping_date: '2024-01-15',
      subtotal: 100,
      tax: 10,
      total: 110,
      start_date: '2024-01-01',
      end_date: '2024-01-15',
    },
    {
      order_id: 'order-2',
      user_id: 'user-2',
      status: 'pending',
      shipping_date: null,
      subtotal: 200,
      tax: 20,
      total: 220,
      start_date: '2024-01-10',
      end_date: '2024-01-20',
    },
    {
      order_id: 'order-3',
      user_id: 'user-3',
      status: 'delivered',
      shipping_date: '2024-01-20',
      subtotal: 50,
      tax: 5,
      total: 55,
      start_date: '2024-01-05',
      end_date: '2024-01-25',
    },
  ]
}

/**
 * Sample order items data
 */
function createOrderItemsData(): Record<string, unknown>[] {
  return [
    { order_id: 'order-1', product_id: 'prod-1', price: 50, quantity: 2 },
    { order_id: 'order-1', product_id: 'prod-2', price: 0, quantity: 1 },
    { order_id: 'order-2', product_id: 'prod-1', price: 100, quantity: 2 },
    { order_id: 'order-3', product_id: 'prod-3', price: 25, quantity: 2 },
  ]
}

/**
 * Sample enum/status values
 */
function createStatusEnumData(): Record<string, unknown>[] {
  return [
    { value: 'pending' },
    { value: 'shipped' },
    { value: 'delivered' },
    { value: 'cancelled' },
  ]
}

// ============================================================================
// FOREIGN KEY VALIDATION
// ============================================================================

describe('Cross-Column Expectations', () => {
  describe('foreign key validation', () => {
    it('should pass when all foreign keys exist in reference table', () => {
      const orders = createOrdersData()
      const users = createUsersData()

      const expectations: CrossColumnExpectation[] = [
        column('user_id').toExistIn('users', 'id').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, { users })

      expect(result.passed).toBe(true)
      expect(result.failures).toHaveLength(0)
    })

    it('should fail when foreign key does not exist in reference table', () => {
      const orders = [
        { order_id: 'order-1', user_id: 'user-1' },
        { order_id: 'order-2', user_id: 'user-999' }, // does not exist
      ]
      const users = createUsersData()

      const expectations: CrossColumnExpectation[] = [
        column('user_id').toExistIn('users', 'id').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, { users })

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0].type).toBe('foreign_key')
      expect(result.failures[0].rowIndex).toBe(1)
      expect(result.failures[0].actualValues?.user_id).toBe('user-999')
    })

    it('should detect orphan records (records with no matching parent)', () => {
      const orderItems = [
        { item_id: 'item-1', order_id: 'order-1' },
        { item_id: 'item-2', order_id: 'order-orphan' }, // orphan record
        { item_id: 'item-3', order_id: 'order-2' },
      ]
      const orders = [
        { order_id: 'order-1' },
        { order_id: 'order-2' },
      ]

      const expectations: CrossColumnExpectation[] = [
        column('order_id').toExistIn('orders', 'order_id').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orderItems, { orders })

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0].message).toContain('order-orphan')
      expect(result.failures[0].message).toContain('does not exist')
    })

    it('should allow null foreign keys when configured', () => {
      const orders = [
        { order_id: 'order-1', user_id: 'user-1' },
        { order_id: 'order-2', user_id: null }, // null is allowed
      ]
      const users = createUsersData()

      const expectations: CrossColumnExpectation[] = [
        column('user_id').toExistIn('users', 'id').allowingNull().build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, { users })

      expect(result.passed).toBe(true)
    })

    it('should fail on null foreign keys when not allowed', () => {
      const orders = [
        { order_id: 'order-1', user_id: 'user-1' },
        { order_id: 'order-2', user_id: null },
      ]
      const users = createUsersData()

      const expectations: CrossColumnExpectation[] = [
        column('user_id').toExistIn('users', 'id').build(), // null not allowed by default
      ]

      const result = validateCrossColumnExpectations(expectations, orders, { users })

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0].message).toContain('null')
    })

    it('should validate multiple foreign keys', () => {
      const orderItems = [
        { item_id: '1', order_id: 'order-1', product_id: 'prod-1' },
        { item_id: '2', order_id: 'order-invalid', product_id: 'prod-1' },
        { item_id: '3', order_id: 'order-1', product_id: 'prod-invalid' },
      ]
      const orders = [{ order_id: 'order-1' }]
      const products = [{ product_id: 'prod-1' }]

      const expectations: CrossColumnExpectation[] = [
        column('order_id').toExistIn('orders', 'order_id').build(),
        column('product_id').toExistIn('products', 'product_id').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orderItems, { orders, products })

      expect(result.passed).toBe(false)
      expect(result.failures.length).toBe(2) // Two invalid references
    })
  })

  // ============================================================================
  // COLUMN DEPENDENCY RULES (IF A THEN B)
  // ============================================================================

  describe('column dependency rules', () => {
    it('should validate: when status is shipped, shipping_date must not be null', () => {
      const orders = createOrdersData()

      const expectations: CrossColumnExpectation[] = [
        when('status').equals('shipped').then('shipping_date').toNotBeNull().build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, {})

      expect(result.passed).toBe(true)
    })

    it('should fail when shipped order has no shipping_date', () => {
      const orders = [
        { order_id: 'order-1', status: 'shipped', shipping_date: null }, // invalid
        { order_id: 'order-2', status: 'shipped', shipping_date: '2024-01-15' },
      ]

      const expectations: CrossColumnExpectation[] = [
        when('status').equals('shipped').then('shipping_date').toNotBeNull().build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, {})

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0].rowIndex).toBe(0)
    })

    it('should validate: when status is pending, shipping_date should be null', () => {
      const orders = [
        { order_id: 'order-1', status: 'pending', shipping_date: null },
        { order_id: 'order-2', status: 'shipped', shipping_date: '2024-01-15' },
      ]

      const expectations: CrossColumnExpectation[] = [
        when('status').equals('pending').then('shipping_date').toBeNull().build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, {})

      expect(result.passed).toBe(true)
    })

    it('should fail when pending order has shipping_date', () => {
      const orders = [
        { order_id: 'order-1', status: 'pending', shipping_date: '2024-01-15' }, // invalid
      ]

      const expectations: CrossColumnExpectation[] = [
        when('status').equals('pending').then('shipping_date').toBeNull().build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, {})

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(1)
    })

    it('should handle conditional with in operator', () => {
      const orders = [
        { order_id: 'order-1', status: 'shipped', tracking_number: 'TRACK-123' },
        { order_id: 'order-2', status: 'delivered', tracking_number: 'TRACK-456' },
        { order_id: 'order-3', status: 'pending', tracking_number: null },
      ]

      const expectations: CrossColumnExpectation[] = [
        when('status').isIn(['shipped', 'delivered']).then('tracking_number').toNotBeNull().build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, {})

      expect(result.passed).toBe(true)
    })

    it('should handle conditional with not_in operator', () => {
      const orders = [
        { order_id: 'order-1', status: 'pending', processing_note: null },
        { order_id: 'order-2', status: 'shipped', processing_note: 'Fast shipping' },
      ]

      const expectations: CrossColumnExpectation[] = [
        when('status').isNotIn(['pending', 'cancelled']).then('processing_note').toNotBeNull().build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, {})

      expect(result.passed).toBe(true)
    })

    it('should handle conditional with greater_than operator', () => {
      const orders = [
        { order_id: 'order-1', total: 1000, requires_approval: true },
        { order_id: 'order-2', total: 500, requires_approval: null },
      ]

      const expectations: CrossColumnExpectation[] = [
        when('total').greaterThan(500).then('requires_approval').toNotBeNull().build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, {})

      expect(result.passed).toBe(true)
    })

    it('should handle conditional with is_not_null operator', () => {
      const orders = [
        { order_id: 'order-1', discount_code: 'SAVE10', discount_amount: 10 },
        { order_id: 'order-2', discount_code: null, discount_amount: null },
      ]

      const expectations: CrossColumnExpectation[] = [
        when('discount_code').isNotNull().then('discount_amount').toNotBeNull().build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, {})

      expect(result.passed).toBe(true)
    })

    it('should fail when discount_code is present but discount_amount is null', () => {
      const orders = [
        { order_id: 'order-1', discount_code: 'SAVE10', discount_amount: null }, // invalid
      ]

      const expectations: CrossColumnExpectation[] = [
        when('discount_code').isNotNull().then('discount_amount').toNotBeNull().build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, {})

      expect(result.passed).toBe(false)
    })

    it('should validate conditional then toEqual', () => {
      const orders = [
        { order_id: 'order-1', is_free: true, total: 0 },
        { order_id: 'order-2', is_free: false, total: 100 },
      ]

      const expectations: CrossColumnExpectation[] = [
        when('is_free').equals(true).then('total').toEqual(0).build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, {})

      expect(result.passed).toBe(true)
    })

    it('should fail when is_free is true but total is not 0', () => {
      const orders = [
        { order_id: 'order-1', is_free: true, total: 50 }, // invalid
      ]

      const expectations: CrossColumnExpectation[] = [
        when('is_free').equals(true).then('total').toEqual(0).build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, {})

      expect(result.passed).toBe(false)
    })
  })

  // ============================================================================
  // CROSS-COLUMN CONSISTENCY CHECKS
  // ============================================================================

  describe('cross-column consistency checks', () => {
    it('should validate end_date is greater than start_date', () => {
      const orders = createOrdersData()

      const expectations: CrossColumnExpectation[] = [
        column('end_date').toBeGreaterThanColumn('start_date').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, {})

      expect(result.passed).toBe(true)
    })

    it('should fail when end_date is before start_date', () => {
      const orders = [
        { order_id: 'order-1', start_date: '2024-01-15', end_date: '2024-01-10' }, // invalid
      ]

      const expectations: CrossColumnExpectation[] = [
        column('end_date').toBeGreaterThanColumn('start_date').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, {})

      expect(result.passed).toBe(false)
      expect(result.failures[0].type).toBe('cross_column_comparison')
    })

    it('should validate total equals subtotal + tax', () => {
      const orders = createOrdersData()

      const expectations: CrossColumnExpectation[] = [
        column('total').toEqualSumOf('subtotal', 'tax').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, {})

      expect(result.passed).toBe(true)
    })

    it('should fail when total does not equal subtotal + tax', () => {
      const orders = [
        { order_id: 'order-1', subtotal: 100, tax: 10, total: 150 }, // invalid: 100 + 10 != 150
      ]

      const expectations: CrossColumnExpectation[] = [
        column('total').toEqualSumOf('subtotal', 'tax').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, {})

      expect(result.passed).toBe(false)
      expect(result.failures[0].type).toBe('computed_value')
    })

    it('should validate with tolerance for floating point comparisons', () => {
      const orders = [
        { order_id: 'order-1', subtotal: 99.99, tax: 10.00, total: 109.99 },
      ]

      const expectations: CrossColumnExpectation[] = [
        column('total').toEqualSumOf('subtotal', 'tax').withTolerance(0.01).build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, {})

      expect(result.passed).toBe(true)
    })

    it('should validate product equals quantity * unit_price', () => {
      const items = [
        { item_id: '1', quantity: 3, unit_price: 25, line_total: 75 },
        { item_id: '2', quantity: 2, unit_price: 50, line_total: 100 },
      ]

      const expectations: CrossColumnExpectation[] = [
        column('line_total').toEqualProductOf('quantity', 'unit_price').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, items, {})

      expect(result.passed).toBe(true)
    })

    it('should fail when line_total does not equal quantity * unit_price', () => {
      const items = [
        { item_id: '1', quantity: 3, unit_price: 25, line_total: 100 }, // invalid: 3 * 25 != 100
      ]

      const expectations: CrossColumnExpectation[] = [
        column('line_total').toEqualProductOf('quantity', 'unit_price').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, items, {})

      expect(result.passed).toBe(false)
    })

    it('should validate difference calculation', () => {
      const accounts = [
        { account_id: 'acc-1', gross: 1000, deductions: 200, net: 800 },
      ]

      const expectations: CrossColumnExpectation[] = [
        column('net').toEqualDifferenceOf('gross', 'deductions').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, accounts, {})

      expect(result.passed).toBe(true)
    })

    it('should validate quotient calculation', () => {
      const items = [
        { item_id: '1', total_price: 100, quantity: 4, unit_price: 25 },
      ]

      const expectations: CrossColumnExpectation[] = [
        column('unit_price').toEqualQuotientOf('total_price', 'quantity').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, items, {})

      expect(result.passed).toBe(true)
    })

    it('should validate complex arithmetic expressions', () => {
      const orders = [
        {
          order_id: 'order-1',
          subtotal: 100,
          discount: 10,
          tax: 9, // (100 - 10) * 0.10 = 9
          total: 99, // 100 - 10 + 9 = 99
        },
      ]

      // total = subtotal - discount + tax
      const expectations: CrossColumnExpectation[] = [
        column('total').toEqualExpression(
          sum(diff('subtotal', 'discount'), 'tax'),
          0.01
        ).build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, {})

      expect(result.passed).toBe(true)
    })

    it('should validate column equals another column', () => {
      const data = [
        { id: '1', created_at: '2024-01-01', updated_at: '2024-01-01' },
        { id: '2', created_at: '2024-01-02', updated_at: '2024-01-02' },
      ]

      const expectations: CrossColumnExpectation[] = [
        column('updated_at').toEqualColumn('created_at').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, data, {})

      expect(result.passed).toBe(true)
    })

    it('should fail when columns are not equal', () => {
      const data = [
        { id: '1', created_at: '2024-01-01', updated_at: '2024-01-02' },
      ]

      const expectations: CrossColumnExpectation[] = [
        column('updated_at').toEqualColumn('created_at').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, data, {})

      expect(result.passed).toBe(false)
    })

    it('should validate column not equals another column', () => {
      const data = [
        { id: '1', old_value: 'A', new_value: 'B' },
      ]

      const expectations: CrossColumnExpectation[] = [
        column('new_value').toNotEqualColumn('old_value').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, data, {})

      expect(result.passed).toBe(true)
    })
  })

  // ============================================================================
  // COMPOSITE KEY UNIQUENESS
  // ============================================================================

  describe('composite key uniqueness', () => {
    it('should pass when composite key is unique', () => {
      const orderItems = [
        { order_id: 'order-1', product_id: 'prod-1', quantity: 2 },
        { order_id: 'order-1', product_id: 'prod-2', quantity: 1 },
        { order_id: 'order-2', product_id: 'prod-1', quantity: 3 },
      ]

      const expectations: CrossColumnExpectation[] = [
        columns(['order_id', 'product_id']).toBeUniqueComposite().build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orderItems, {})

      expect(result.passed).toBe(true)
    })

    it('should fail when composite key has duplicates', () => {
      const orderItems = [
        { order_id: 'order-1', product_id: 'prod-1', quantity: 2 },
        { order_id: 'order-1', product_id: 'prod-1', quantity: 3 }, // duplicate composite key
      ]

      const expectations: CrossColumnExpectation[] = [
        columns(['order_id', 'product_id']).toBeUniqueComposite().build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orderItems, {})

      expect(result.passed).toBe(false)
      expect(result.failures[0].type).toBe('composite_unique')
      expect(result.failures[0].message).toContain('Duplicate')
    })

    it('should handle null values in composite key (skip nulls)', () => {
      const data = [
        { org_id: 'org-1', user_id: 'user-1' },
        { org_id: 'org-1', user_id: null }, // has null, should be skipped
        { org_id: 'org-1', user_id: null }, // has null, should be skipped (not duplicate)
      ]

      const expectations: CrossColumnExpectation[] = [
        columns(['org_id', 'user_id']).toBeUniqueComposite().build(),
      ]

      const result = validateCrossColumnExpectations(expectations, data, {})

      expect(result.passed).toBe(true)
    })
  })

  // ============================================================================
  // ENUM REFERENCE VALIDATION
  // ============================================================================

  describe('enum reference validation', () => {
    it('should pass when all values reference valid enum', () => {
      const orders = [
        { order_id: 'order-1', status: 'pending' },
        { order_id: 'order-2', status: 'shipped' },
        { order_id: 'order-3', status: 'delivered' },
      ]
      const statusEnum = createStatusEnumData()

      const expectations: CrossColumnExpectation[] = [
        column('status').toReferenceEnum('statusEnum', 'value').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, { statusEnum })

      expect(result.passed).toBe(true)
    })

    it('should fail when value is not in enum', () => {
      const orders = [
        { order_id: 'order-1', status: 'invalid_status' },
      ]
      const statusEnum = createStatusEnumData()

      const expectations: CrossColumnExpectation[] = [
        column('status').toReferenceEnum('statusEnum', 'value').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, { statusEnum })

      expect(result.passed).toBe(false)
      expect(result.failures[0].type).toBe('enum_reference')
    })
  })

  // ============================================================================
  // CUSTOM MESSAGES
  // ============================================================================

  describe('custom error messages', () => {
    it('should use custom message when provided', () => {
      const orders = [{ order_id: 'order-1', user_id: 'invalid-user' }]
      const users = createUsersData()

      const expectations: CrossColumnExpectation[] = [
        column('user_id')
          .toExistIn('users', 'id')
          .withMessage('Invalid user reference - please check user_id')
          .build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, { users })

      expect(result.passed).toBe(false)
      expect(result.failures[0].message).toBe('Invalid user reference - please check user_id')
    })
  })

  // ============================================================================
  // PERFORMANCE AND TIMING
  // ============================================================================

  describe('performance', () => {
    it('should provide timing information', () => {
      const orders = createOrdersData()
      const users = createUsersData()

      const expectations: CrossColumnExpectation[] = [
        column('user_id').toExistIn('users', 'id').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, { users })

      expect(result.timing.totalMs).toBeDefined()
      expect(result.timing.totalMs).toBeGreaterThanOrEqual(0)
      expect(result.timing.lookupBuildMs).toBeDefined()
    })

    it('should report number of expectations checked', () => {
      const orders = createOrdersData()
      const users = createUsersData()

      const expectations: CrossColumnExpectation[] = [
        column('user_id').toExistIn('users', 'id').build(),
        column('end_date').toBeGreaterThanColumn('start_date').build(),
        column('total').toEqualSumOf('subtotal', 'tax').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, { users })

      expect(result.expectationsChecked).toBe(3)
    })

    it('should handle large datasets efficiently', () => {
      // Create large dataset
      const largeData: Record<string, unknown>[] = []
      for (let i = 0; i < 10000; i++) {
        largeData.push({
          id: `id-${i}`,
          user_id: `user-${i % 100}`,
          start_date: '2024-01-01',
          end_date: '2024-01-15',
          subtotal: 100,
          tax: 10,
          total: 110,
        })
      }

      // Create reference data
      const users: Record<string, unknown>[] = []
      for (let i = 0; i < 100; i++) {
        users.push({ id: `user-${i}` })
      }

      const expectations: CrossColumnExpectation[] = [
        column('user_id').toExistIn('users', 'id').build(),
        column('end_date').toBeGreaterThanColumn('start_date').build(),
        column('total').toEqualSumOf('subtotal', 'tax').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, largeData, { users })

      expect(result.passed).toBe(true)
      expect(result.timing.totalMs).toBeLessThan(1000) // Should complete in under 1 second
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle empty data array', () => {
      const expectations: CrossColumnExpectation[] = [
        column('user_id').toExistIn('users', 'id').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, [], { users: [] })

      expect(result.passed).toBe(true)
      expect(result.failures).toHaveLength(0)
    })

    it('should handle empty reference data', () => {
      const orders = [{ order_id: 'order-1', user_id: 'user-1' }]

      const expectations: CrossColumnExpectation[] = [
        column('user_id').toExistIn('users', 'id').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, { users: [] })

      expect(result.passed).toBe(false)
    })

    it('should handle missing columns gracefully', () => {
      const orders = [{ order_id: 'order-1' }] // missing user_id

      const expectations: CrossColumnExpectation[] = [
        column('user_id').toExistIn('users', 'id').allowingNull().build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, { users: [] })

      expect(result.passed).toBe(true) // undefined treated as null when allowingNull
    })

    it('should handle nested column paths', () => {
      const orders = [
        { order_id: 'order-1', customer: { id: 'cust-1' } },
        { order_id: 'order-2', customer: { id: 'cust-2' } },
      ]
      const customers = [{ id: 'cust-1' }, { id: 'cust-2' }]

      const expectations: CrossColumnExpectation[] = [
        column('customer.id').toExistIn('customers', 'id').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, { customers })

      expect(result.passed).toBe(true)
    })

    it('should skip validation when comparing null values', () => {
      const data = [
        { id: '1', start_date: null, end_date: null },
        { id: '2', start_date: '2024-01-01', end_date: '2024-01-15' },
      ]

      const expectations: CrossColumnExpectation[] = [
        column('end_date').toBeGreaterThanColumn('start_date').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, data, {})

      expect(result.passed).toBe(true) // Null values should be skipped
    })

    it('should handle division by zero gracefully', () => {
      const items = [
        { item_id: '1', total_price: 100, quantity: 0, unit_price: 25 },
      ]

      const expectations: CrossColumnExpectation[] = [
        column('unit_price').toEqualQuotientOf('total_price', 'quantity').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, items, {})

      // Division by zero should be handled (returns null, validation skipped)
      expect(result.passed).toBe(true)
    })
  })

  // ============================================================================
  // BUILDER API
  // ============================================================================

  describe('builder API', () => {
    it('should build foreign key expectation correctly', () => {
      const expectation = column('user_id')
        .toExistIn('users', 'id')
        .allowingNull()
        .withMessage('User must exist')
        .build()

      expect(expectation.type).toBe('foreign_key')
      expect(expectation.columns).toEqual(['user_id'])
      expect(expectation.foreignKey?.referenceTable).toBe('users')
      expect(expectation.foreignKey?.referenceColumn).toBe('id')
      expect(expectation.foreignKey?.allowNull).toBe(true)
      expect(expectation.message).toBe('User must exist')
    })

    it('should build cross-column comparison correctly', () => {
      const expectation = column('end_date')
        .toBeGreaterThanColumn('start_date')
        .build()

      expect(expectation.type).toBe('cross_column_comparison')
      expect(expectation.comparison?.operator).toBe('greater_than')
      expect(expectation.comparison?.targetColumn).toBe('start_date')
    })

    it('should build computed value expectation correctly', () => {
      const expectation = column('total')
        .toEqualSumOf('subtotal', 'tax')
        .withTolerance(0.01)
        .build()

      expect(expectation.type).toBe('computed_value')
      expect(expectation.expression?.operator).toBe('add')
      expect(expectation.tolerance).toBe(0.01)
    })

    it('should build conditional expectation correctly', () => {
      const expectation = when('status')
        .equals('shipped')
        .then('shipping_date')
        .toNotBeNull()
        .build()

      expect(expectation.type).toBe('conditional')
      expect(expectation.condition?.column).toBe('status')
      expect(expectation.condition?.operator).toBe('equal')
      expect(expectation.condition?.value).toBe('shipped')
    })

    it('should build composite unique expectation correctly', () => {
      const expectation = columns(['org_id', 'user_id'])
        .toBeUniqueComposite()
        .build()

      expect(expectation.type).toBe('composite_unique')
      expect(expectation.columns).toEqual(['org_id', 'user_id'])
    })

    it('should support arithmetic helper functions', () => {
      const sumExpr = sum('a', 'b', 'c')
      expect(sumExpr.operator).toBe('add')
      expect(sumExpr.operands).toHaveLength(3)

      const diffExpr = diff('a', 'b')
      expect(diffExpr.operator).toBe('subtract')

      const prodExpr = product('a', 'b')
      expect(prodExpr.operator).toBe('multiply')

      const quotExpr = quotient('a', 'b')
      expect(quotExpr.operator).toBe('divide')
    })

    it('should support col and lit helpers for expressions', () => {
      const colRef = col('price')
      expect(colRef.type).toBe('column')
      expect(colRef.name).toBe('price')

      const literal = lit(100)
      expect(literal.type).toBe('literal')
      expect(literal.value).toBe(100)
    })

    it('should support mixed operands in expressions', () => {
      const expr = sum('subtotal', 10, col('tax'))
      expect(expr.operands).toHaveLength(3)
      expect(expr.operands[0]).toEqual({ type: 'column', name: 'subtotal' })
      expect(expr.operands[1]).toEqual({ type: 'literal', value: 10 })
      expect(expr.operands[2]).toEqual({ type: 'column', name: 'tax' })
    })
  })

  // ============================================================================
  // API DESIGN EXAMPLE FROM ISSUE
  // ============================================================================

  describe('API design from issue requirements', () => {
    it('should support the API design specified in the issue', () => {
      // The issue specifies:
      // expect('orders')
      //   .column('user_id').references('users', 'id')
      //   .column('status').whenEquals('shipped').requires('shipping_date').toBeNotNull()
      //   .column('total').equals(sumOf('order_items', 'price', where('order_id')))
      //
      // Our implementation provides similar functionality through:
      // - column('user_id').toExistIn('users', 'id')
      // - when('status').equals('shipped').then('shipping_date').toNotBeNull()
      // - column('total').toEqualSumOf('subtotal', 'tax')

      const orders = [
        { order_id: 'order-1', user_id: 'user-1', status: 'shipped', shipping_date: '2024-01-15', subtotal: 100, tax: 10, total: 110 },
        { order_id: 'order-2', user_id: 'user-2', status: 'pending', shipping_date: null, subtotal: 200, tax: 20, total: 220 },
      ]
      const users = createUsersData()

      const expectations: CrossColumnExpectation[] = [
        // Foreign key: user_id references users.id
        column('user_id').toExistIn('users', 'id').build(),

        // Conditional: when status is shipped, shipping_date must not be null
        when('status').equals('shipped').then('shipping_date').toNotBeNull().build(),

        // Computed: total equals subtotal + tax
        column('total').toEqualSumOf('subtotal', 'tax').build(),
      ]

      const result = validateCrossColumnExpectations(expectations, orders, { users })

      expect(result.passed).toBe(true)
    })
  })
})
