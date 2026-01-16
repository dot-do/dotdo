/**
 * DO Test Utilities - Integration Tests
 *
 * Validates that the test utilities work correctly with real DO instances.
 *
 * @module tests/helpers/do-test-utils.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import {
  createTestDO,
  createTestCustomer,
  createTestOrder,
  createTestProduct,
  createTestCustomers,
  createTestProducts,
  createTestJwt,
  assertValidThing,
  assertPascalCase,
  SAMPLE_CUSTOMERS,
  SAMPLE_PRODUCTS,
  type DOCoreTestInstance,
} from './do-test-utils'

// ============================================================================
// createTestDO Tests
// ============================================================================

describe('createTestDO()', () => {
  it('should create a DO instance with auto-generated name', () => {
    const doInstance = createTestDO()
    expect(doInstance).toBeDefined()
    expect(typeof doInstance.fetch).toBe('function')
  })

  it('should create a DO instance with specific binding', () => {
    const doInstance = createTestDO(env.DOCore)
    expect(doInstance).toBeDefined()
  })

  it('should create a DO instance with specific name', () => {
    const doInstance = createTestDO(env.DOCore, 'named-test-instance')
    expect(doInstance).toBeDefined()
  })

  it('should create unique instances with different auto-generated names', () => {
    const doInstance1 = createTestDO()
    const doInstance2 = createTestDO()
    // Different instances should work independently
    expect(doInstance1).toBeDefined()
    expect(doInstance2).toBeDefined()
  })

  it('should support RPC methods', async () => {
    const doInstance = createTestDO()
    const result = await doInstance.ping()
    expect(result).toBe('pong')
  })

  it('should support state operations', async () => {
    const doInstance = createTestDO()
    await doInstance.set('test-key', 'test-value')
    const result = await doInstance.get('test-key')
    expect(result).toBe('test-value')
  })
})

// ============================================================================
// createTestCustomer Tests
// ============================================================================

describe('createTestCustomer()', () => {
  it('should create a customer with default values', async () => {
    const doInstance = createTestDO()
    const customer = await createTestCustomer(doInstance)

    expect(customer.$id).toBeDefined()
    expect(customer.$type).toBe('Customer')
    expect(customer.name).toBe('Test Customer')
    expect(customer.email).toContain('@example.com')
    expect(customer.tags).toContain('test')
  })

  it('should create a customer with overridden values', async () => {
    const doInstance = createTestDO()
    const customer = await createTestCustomer(doInstance, {
      name: 'Custom Name',
      email: 'custom@test.com',
      tags: ['vip', 'premium'],
    })

    expect(customer.$type).toBe('Customer')
    expect(customer.name).toBe('Custom Name')
    expect(customer.email).toBe('custom@test.com')
    expect(customer.tags).toContain('vip')
  })

  it('should create a customer with address', async () => {
    const doInstance = createTestDO()
    const customer = await createTestCustomer(doInstance, {
      address: {
        street: '123 Test St',
        city: 'Test City',
        state: 'TS',
        zip: '12345',
      },
    })

    expect(customer.address).toBeDefined()
    const address = customer.address as Record<string, string>
    expect(address.street).toBe('123 Test St')
    expect(address.city).toBe('Test City')
  })
})

// ============================================================================
// createTestOrder Tests
// ============================================================================

describe('createTestOrder()', () => {
  it('should create an order with default values', async () => {
    const doInstance = createTestDO()
    const order = await createTestOrder(doInstance)

    expect(order.$id).toBeDefined()
    expect(order.$type).toBe('Order')
    expect(order.status).toBe('pending')
    expect(order.total).toBe(29.99)
    expect(order.items).toBeDefined()
  })

  it('should create an order with overridden values', async () => {
    const doInstance = createTestDO()
    const order = await createTestOrder(doInstance, {
      customerId: 'custom-customer-id',
      status: 'shipped',
      total: 199.99,
    })

    expect(order.$type).toBe('Order')
    expect(order.customerId).toBe('custom-customer-id')
    expect(order.status).toBe('shipped')
    expect(order.total).toBe(199.99)
  })

  it('should create an order with custom items', async () => {
    const doInstance = createTestDO()
    const order = await createTestOrder(doInstance, {
      items: [
        { productId: 'prod-1', quantity: 3, price: 50 },
        { productId: 'prod-2', quantity: 1, price: 100 },
      ],
      total: 250,
    })

    const items = order.items as Array<{ productId: string; quantity: number; price: number }>
    expect(items).toHaveLength(2)
    expect(items[0].quantity).toBe(3)
    expect(order.total).toBe(250)
  })
})

// ============================================================================
// createTestProduct Tests
// ============================================================================

describe('createTestProduct()', () => {
  it('should create a product with default values', async () => {
    const doInstance = createTestDO()
    const product = await createTestProduct(doInstance)

    expect(product.$id).toBeDefined()
    expect(product.$type).toBe('Product')
    expect(product.name).toBe('Test Product')
    expect(product.price).toBe(29.99)
    expect(product.inventory).toBe(100)
  })

  it('should create a product with overridden values', async () => {
    const doInstance = createTestDO()
    const product = await createTestProduct(doInstance, {
      name: 'Premium Widget',
      price: 499.99,
      category: 'premium',
    })

    expect(product.$type).toBe('Product')
    expect(product.name).toBe('Premium Widget')
    expect(product.price).toBe(499.99)
    expect(product.category).toBe('premium')
  })
})

// ============================================================================
// Bulk Creation Tests
// ============================================================================

describe('createTestCustomers()', () => {
  it('should create multiple customers', async () => {
    const doInstance = createTestDO()
    const customers = await createTestCustomers(doInstance, 3)

    expect(customers).toHaveLength(3)
    for (const customer of customers) {
      expect(customer.$type).toBe('Customer')
      expect(customer.$id).toBeDefined()
    }
  })

  it('should create customers with unique emails', async () => {
    const doInstance = createTestDO()
    const customers = await createTestCustomers(doInstance, 5)

    const emails = customers.map((c) => c.email)
    const uniqueEmails = new Set(emails)
    expect(uniqueEmails.size).toBe(5)
  })
})

describe('createTestProducts()', () => {
  it('should create multiple products', async () => {
    const doInstance = createTestDO()
    const products = await createTestProducts(doInstance, 3)

    expect(products).toHaveLength(3)
    for (const product of products) {
      expect(product.$type).toBe('Product')
      expect(product.$id).toBeDefined()
    }
  })

  it('should create products with unique SKUs', async () => {
    const doInstance = createTestDO()
    const products = await createTestProducts(doInstance, 5)

    const skus = products.map((p) => p.sku)
    const uniqueSkus = new Set(skus)
    expect(uniqueSkus.size).toBe(5)
  })
})

// ============================================================================
// JWT Helper Tests
// ============================================================================

describe('createTestJwt()', () => {
  it('should create a valid JWT structure', () => {
    const token = createTestJwt()

    expect(token).toBeDefined()
    const parts = token.split('.')
    expect(parts).toHaveLength(3)
  })

  it('should create JWT with default subject', () => {
    const token = createTestJwt()
    const [, payloadBase64] = token.split('.')
    const payload = JSON.parse(atob(payloadBase64))

    expect(payload.sub).toBe('test-user')
  })

  it('should create JWT with custom subject', () => {
    const token = createTestJwt({ sub: 'custom-user' })
    const [, payloadBase64] = token.split('.')
    const payload = JSON.parse(atob(payloadBase64))

    expect(payload.sub).toBe('custom-user')
  })

  it('should create JWT with permissions', () => {
    const token = createTestJwt({ permissions: ['admin:read', 'admin:write'] })
    const [, payloadBase64] = token.split('.')
    const payload = JSON.parse(atob(payloadBase64))

    expect(payload.permissions).toContain('admin:read')
    expect(payload.permissions).toContain('admin:write')
  })

  it('should create JWT with expiration', () => {
    const token = createTestJwt()
    const [, payloadBase64] = token.split('.')
    const payload = JSON.parse(atob(payloadBase64))

    expect(payload.exp).toBeGreaterThan(payload.iat)
  })
})

// ============================================================================
// Assertion Helper Tests
// ============================================================================

describe('assertValidThing()', () => {
  it('should pass for valid thing', () => {
    const thing = { $id: 'thing_123', $type: 'Customer', name: 'Alice' }
    expect(() => assertValidThing(thing)).not.toThrow()
  })

  it('should throw for null', () => {
    expect(() => assertValidThing(null)).toThrow('Expected thing to be an object')
  })

  it('should throw for missing $id', () => {
    const thing = { $type: 'Customer' }
    expect(() => assertValidThing(thing)).toThrow('non-empty $id')
  })

  it('should throw for empty $id', () => {
    const thing = { $id: '', $type: 'Customer' }
    expect(() => assertValidThing(thing)).toThrow('non-empty $id')
  })

  it('should throw for missing $type', () => {
    const thing = { $id: 'thing_123' }
    expect(() => assertValidThing(thing)).toThrow('non-empty $type')
  })
})

describe('assertPascalCase()', () => {
  it('should pass for valid PascalCase', () => {
    expect(() => assertPascalCase('Customer')).not.toThrow()
    expect(() => assertPascalCase('CustomerOrder')).not.toThrow()
    expect(() => assertPascalCase('A')).not.toThrow()
    expect(() => assertPascalCase('ABC123')).not.toThrow()
  })

  it('should throw for lowercase', () => {
    expect(() => assertPascalCase('customer')).toThrow('PascalCase')
  })

  it('should throw for camelCase', () => {
    expect(() => assertPascalCase('customerOrder')).toThrow('PascalCase')
  })

  it('should throw for snake_case', () => {
    expect(() => assertPascalCase('Customer_Order')).toThrow('PascalCase')
  })

  it('should throw for starting with number', () => {
    expect(() => assertPascalCase('123Customer')).toThrow('PascalCase')
  })
})

// ============================================================================
// Sample Data Tests
// ============================================================================

describe('SAMPLE_CUSTOMERS', () => {
  it('should have at least 3 sample customers', () => {
    expect(SAMPLE_CUSTOMERS.length).toBeGreaterThanOrEqual(3)
  })

  it('should have unique emails', () => {
    const emails = SAMPLE_CUSTOMERS.map((c) => c.email)
    const uniqueEmails = new Set(emails)
    expect(uniqueEmails.size).toBe(SAMPLE_CUSTOMERS.length)
  })
})

describe('SAMPLE_PRODUCTS', () => {
  it('should have at least 3 sample products', () => {
    expect(SAMPLE_PRODUCTS.length).toBeGreaterThanOrEqual(3)
  })

  it('should have unique SKUs', () => {
    const skus = SAMPLE_PRODUCTS.map((p) => p.sku)
    const uniqueSkus = new Set(skus)
    expect(uniqueSkus.size).toBe(SAMPLE_PRODUCTS.length)
  })
})
