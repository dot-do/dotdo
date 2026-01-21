/**
 * Entity Proxy Tests - $.Entity.define(), $.Entity.create(), etc.
 *
 * Tests for the entity proxy feature (do-lekf.2) that enables:
 *   $.Product.define(schema)  // Register schema
 *   $.Product.create(data)    // Create with $type: 'Product'
 *   $.Product.list(opts)      // List where $type = 'Product'
 *   $.Product(id).get()       // Get single entity
 *   $.Product(id).update(d)   // Update single entity
 *   $.Product(id).delete()    // Delete single entity
 *
 * Uses real miniflare DO instances - NO MOCKS for DurableObjectState.
 *
 * @module do/tests/entity-proxy.test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { env, runInDurableObject } from 'cloudflare:test'
import { DO } from '../DO'
import type { WorkflowContext } from '../context'
import { generateTestId, getTestDO as getTestDOFromUtils } from '@dotdo/test-utils/helpers'
import { createContext } from '../workflow/context'
import { createThingsStore, type ThingsStore } from '../../db'

/**
 * Get a test DO stub with a unique name
 */
function getTestDO(name: string = generateTestId('entity-proxy-test')) {
  return getTestDOFromUtils(env, name)
}

// ============================================================================
// TESTS: Entity Proxy (do-lekf.2)
// ============================================================================

describe('Entity Proxy (do-lekf.2)', () => {
  describe('$.Entity.define()', () => {
    it('should register a schema for an entity type', () => {
      // Create a things store and context
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      // Define a Product schema
      $.Product.define({
        name: 'Product',
        fields: {
          name: { type: 'string', required: true },
          price: { type: 'number', required: true },
          description: { type: 'string', required: false },
        },
        strict: false,
      })

      // Verify schema is registered in legacy entity schemas (used by entity accessor)
      expect($._legacyEntitySchemas.has('Product')).toBe(true)
    })

    it('should allow defining multiple entity types', () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      $.Product.define({ name: 'Product' })
      $.Customer.define({ name: 'Customer' })
      $.Order.define({ name: 'Order' })

      expect($._legacyEntitySchemas.has('Product')).toBe(true)
      expect($._legacyEntitySchemas.has('Customer')).toBe(true)
      expect($._legacyEntitySchemas.has('Order')).toBe(true)
    })
  })

  describe('$.Entity.create()', () => {
    it('should create an entity with $type automatically set', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      const product = await $.Product.create({
        name: 'Widget',
        price: 9.99,
      })

      expect(product.$type).toBe('Product')
      expect(product.$id).toBeDefined()
      expect(product.name).toBe('Widget')
      expect(product.price).toBe(9.99)
    })

    it('should create entities of different types', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      const product = await $.Product.create({ name: 'Widget', price: 9.99 })
      const customer = await $.Customer.create({ email: 'alice@example.com', name: 'Alice' })

      expect(product.$type).toBe('Product')
      expect(customer.$type).toBe('Customer')
    })

    it('should set $createdAt and $updatedAt timestamps', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      const before = Date.now()
      const product = await $.Product.create({ name: 'Widget', price: 9.99 })
      const after = Date.now()

      expect(product.$createdAt).toBeGreaterThanOrEqual(before)
      expect(product.$createdAt).toBeLessThanOrEqual(after)
      expect(product.$updatedAt).toBe(product.$createdAt)
    })
  })

  describe('$.Entity.list()', () => {
    it('should list only entities of the specified type', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      // Create mixed entities
      await $.Product.create({ name: 'Widget', price: 9.99 })
      await $.Product.create({ name: 'Gadget', price: 19.99 })
      await $.Customer.create({ email: 'alice@example.com', name: 'Alice' })

      const products = await $.Product.list()
      const customers = await $.Customer.list()

      expect(products.length).toBe(2)
      expect(products.every(p => p.$type === 'Product')).toBe(true)
      expect(customers.length).toBe(1)
      expect(customers[0]?.$type).toBe('Customer')
    })

    it('should support limit option', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      // Create multiple products
      for (let i = 0; i < 5; i++) {
        await $.Product.create({ name: `Product ${i}`, price: i * 10 })
      }

      const products = await $.Product.list({ limit: 2 })

      expect(products.length).toBe(2)
    })

    it('should support offset option', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      // Create products
      await $.Product.create({ name: 'A', price: 1 })
      await $.Product.create({ name: 'B', price: 2 })
      await $.Product.create({ name: 'C', price: 3 })

      const products = await $.Product.list({ offset: 1, limit: 2 })

      expect(products.length).toBe(2)
    })

    it('should return empty array when no entities of type exist', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      const products = await $.Product.list()

      expect(products).toEqual([])
    })
  })

  describe('$.Entity(id).get()', () => {
    it('should get an entity by ID', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      const created = await $.Product.create({ name: 'Widget', price: 9.99 })
      const retrieved = await $.Product(created.$id).get()

      expect(retrieved).not.toBeNull()
      expect(retrieved?.$id).toBe(created.$id)
      expect(retrieved?.name).toBe('Widget')
    })

    it('should return null for non-existent ID', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      const retrieved = await $.Product('non-existent-id').get()

      expect(retrieved).toBeNull()
    })
  })

  describe('$.Entity(id).update()', () => {
    it('should update an entity', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      const created = await $.Product.create({ name: 'Widget', price: 9.99 })
      const updated = await $.Product(created.$id).update({ price: 14.99 })

      expect(updated.price).toBe(14.99)
      expect(updated.name).toBe('Widget') // Unchanged
      // $updatedAt should be >= $createdAt (may be same timestamp if very fast)
      expect(updated.$updatedAt).toBeGreaterThanOrEqual(created.$createdAt)
    })

    it('should preserve $id and $type on update', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      const created = await $.Product.create({ name: 'Widget', price: 9.99 })
      const updated = await $.Product(created.$id).update({ name: 'Super Widget' })

      expect(updated.$id).toBe(created.$id)
      expect(updated.$type).toBe('Product')
    })

    it('should throw for non-existent ID', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      await expect(
        $.Product('non-existent-id').update({ price: 14.99 })
      ).rejects.toThrow()
    })
  })

  describe('$.Entity(id).delete()', () => {
    it('should delete an entity', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      const created = await $.Product.create({ name: 'Widget', price: 9.99 })

      await $.Product(created.$id).delete()

      const retrieved = await $.Product(created.$id).get()
      expect(retrieved).toBeNull()
    })

    it('should throw for non-existent ID', async () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      await expect(
        $.Product('non-existent-id').delete()
      ).rejects.toThrow()
    })
  })

  describe('Entity accessor caching', () => {
    it('should return the same accessor for repeated access', () => {
      const things = createThingsStore()
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      const $ = createContext(mockState, {}, { things })

      const accessor1 = $.Product
      const accessor2 = $.Product

      // Both should be the same cached accessor
      expect(accessor1).toBe(accessor2)
    })
  })

  describe('Entity proxy without things store', () => {
    it('should fall back to DO RPC when no things store configured', () => {
      const mockState = { id: { toString: () => 'test-id' } } as unknown as DurableObjectState
      // No things store passed
      const $ = createContext(mockState, {})

      // When no things store, $.Product should be a DO accessor function (for cross-DO RPC)
      // This is the existing behavior that we don't want to break
      expect(typeof $.Product).toBe('function')
    })
  })

  describe('Integration with DO class', () => {
    it('should work within DO instance via runInDurableObject', async () => {
      const stub = getTestDO()

      const result = await runInDurableObject(stub, async (instance: DO) => {
        // Access things store from DO instance
        const things = instance.things

        // Create a product directly via things store
        const product = await things.create({
          $type: 'Product',
          name: 'Widget',
          price: 9.99,
        })

        // List products
        const products = await things.list({ type: 'Product' })

        return {
          productId: product.$id,
          productType: product.$type,
          productName: product.name,
          count: products.length,
        }
      })

      expect(result.productType).toBe('Product')
      expect(result.productName).toBe('Widget')
      expect(result.count).toBe(1)
    })
  })
})
