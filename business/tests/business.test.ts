/**
 * Business Class Integration Tests - Real Durable Objects with Miniflare
 *
 * TDD tests for ProductsAPI and ServicesAPI.
 *
 * NO MOCKS - per CLAUDE.md:
 * - Real miniflare runtime
 * - Real SQLite storage
 * - Real DO instances via env bindings
 *
 * @module business/tests/business.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import type { Product, Service } from '../types'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface HealthResponse {
  status: string
  id: string
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a unique test identifier to isolate test data
 */
function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a fresh Business DO stub for testing
 */
function getStub(name?: string) {
  const testName = name ?? generateTestId()
  const id = env.BUSINESS.idFromName(testName)
  return env.BUSINESS.get(id)
}

/**
 * Make an RPC call to the DO
 */
async function rpc<T>(stub: DurableObjectStub, method: string, args: unknown[] = []): Promise<T> {
  const response = await stub.fetch('https://business/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  })

  // Handle void responses (delete, remove operations return no content)
  const text = await response.text()
  if (!text) {
    return undefined as unknown as T
  }
  return JSON.parse(text) as T
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Business Class (do-e71b.1)', () => {
  describe('Business class initialization', () => {
    it('should respond to GET / health check', async () => {
      const stub = getStub()
      const response = await stub.fetch('https://business/')

      expect(response.status).toBe(200)
      const json = (await response.json()) as HealthResponse
      expect(json.status).toBe('ok')
      expect(json.id).toBeDefined()
    })

    it('should inherit from DO and have working things store', async () => {
      const stub = getStub()

      // Verify things store works (inherited from DO)
      const thing = await rpc<{ $id: string; $type: string }>(stub, 'things.create', [
        { $type: 'TestEntity', name: 'Test' }
      ])

      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('TestEntity')
    })
  })

  describe('ProductsAPI.create()', () => {
    it('should create a product with required fields', async () => {
      const stub = getStub()

      const product = await rpc<Product>(stub, 'products.create', [
        { name: 'Widget', active: true }
      ])

      expect(product.id).toBeDefined()
      expect(product.name).toBe('Widget')
      expect(product.active).toBe(true)
      expect(product.createdAt).toBeDefined()
      expect(product.updatedAt).toBeDefined()
    })

    it('should create a product with optional fields', async () => {
      const stub = getStub()

      const product = await rpc<Product>(stub, 'products.create', [
        {
          name: 'Premium Widget',
          description: 'A fancy widget',
          price: 99.99,
          currency: 'USD',
          active: true,
          metadata: { category: 'premium' }
        }
      ])

      expect(product.id).toBeDefined()
      expect(product.name).toBe('Premium Widget')
      expect(product.description).toBe('A fancy widget')
      expect(product.price).toBe(99.99)
      expect(product.currency).toBe('USD')
      expect(product.metadata).toEqual({ category: 'premium' })
    })
  })

  describe('ProductsAPI.get()', () => {
    it('should get a product by id', async () => {
      const stub = getStub()

      // Create first
      const created = await rpc<Product>(stub, 'products.create', [
        { name: 'GetTest Widget', active: true }
      ])

      // Then get
      const product = await rpc<Product | null>(stub, 'products.get', [created.id])

      expect(product).not.toBeNull()
      expect(product!.id).toBe(created.id)
      expect(product!.name).toBe('GetTest Widget')
    })

    it('should return null for non-existent product', async () => {
      const stub = getStub()

      const product = await rpc<Product | null>(stub, 'products.get', ['non-existent-id'])

      expect(product).toBeNull()
    })
  })

  describe('ProductsAPI.list()', () => {
    it('should list all products', async () => {
      const stub = getStub()

      // Create multiple products
      await rpc<Product>(stub, 'products.create', [{ name: 'Product A', active: true }])
      await rpc<Product>(stub, 'products.create', [{ name: 'Product B', active: false }])
      await rpc<Product>(stub, 'products.create', [{ name: 'Product C', active: true }])

      // List all
      const products = await rpc<Product[]>(stub, 'products.list', [])

      expect(products.length).toBe(3)
      expect(products.map(p => p.name).sort()).toEqual(['Product A', 'Product B', 'Product C'])
    })

    it('should return empty array when no products exist', async () => {
      const stub = getStub()

      const products = await rpc<Product[]>(stub, 'products.list', [])

      expect(products).toEqual([])
    })
  })

  describe('ProductsAPI.update()', () => {
    it('should update a product', async () => {
      const stub = getStub()

      // Create first
      const created = await rpc<Product>(stub, 'products.create', [
        { name: 'Original Name', active: true, price: 10 }
      ])

      // Update
      const updated = await rpc<Product>(stub, 'products.update', [
        created.id,
        { name: 'Updated Name', price: 20 }
      ])

      expect(updated.id).toBe(created.id)
      expect(updated.name).toBe('Updated Name')
      expect(updated.price).toBe(20)
      expect(updated.active).toBe(true) // unchanged
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(created.updatedAt).getTime()
      )
    })

    it('should throw error for non-existent product update', async () => {
      const stub = getStub()

      // Try to update non-existent product
      const response = await stub.fetch('https://business/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'products.update',
          args: ['non-existent-id', { name: 'New Name' }]
        })
      })

      // Should fail since product doesn't exist
      expect(response.status).toBe(500)
    })
  })

  describe('ProductsAPI.delete()', () => {
    it('should delete a product', async () => {
      const stub = getStub()

      // Create first
      const created = await rpc<Product>(stub, 'products.create', [
        { name: 'To Be Deleted', active: true }
      ])

      // Delete
      const result = await rpc<boolean>(stub, 'products.delete', [created.id])

      expect(result).toBe(true)

      // Verify deleted
      const product = await rpc<Product | null>(stub, 'products.get', [created.id])
      expect(product).toBeNull()
    })

    it('should return false for non-existent product delete', async () => {
      const stub = getStub()

      const result = await rpc<boolean>(stub, 'products.delete', ['non-existent-id'])

      expect(result).toBe(false)
    })
  })

  describe('ServicesAPI.create()', () => {
    it('should create a service with required fields', async () => {
      const stub = getStub()

      const service = await rpc<Service>(stub, 'services.create', [
        { name: 'Consulting', active: true }
      ])

      expect(service.id).toBeDefined()
      expect(service.name).toBe('Consulting')
      expect(service.active).toBe(true)
      expect(service.createdAt).toBeDefined()
      expect(service.updatedAt).toBeDefined()
    })

    it('should create a service with pricing', async () => {
      const stub = getStub()

      const service = await rpc<Service>(stub, 'services.create', [
        {
          name: 'Premium Support',
          description: '24/7 support access',
          pricing: {
            type: 'recurring',
            amount: 199,
            currency: 'USD',
            interval: 'month'
          },
          active: true,
          metadata: { tier: 'enterprise' }
        }
      ])

      expect(service.id).toBeDefined()
      expect(service.name).toBe('Premium Support')
      expect(service.description).toBe('24/7 support access')
      expect(service.pricing).toEqual({
        type: 'recurring',
        amount: 199,
        currency: 'USD',
        interval: 'month'
      })
      expect(service.metadata).toEqual({ tier: 'enterprise' })
    })
  })

  describe('ServicesAPI.get()', () => {
    it('should get a service by id', async () => {
      const stub = getStub()

      // Create first
      const created = await rpc<Service>(stub, 'services.create', [
        { name: 'GetTest Service', active: true }
      ])

      // Then get
      const service = await rpc<Service | null>(stub, 'services.get', [created.id])

      expect(service).not.toBeNull()
      expect(service!.id).toBe(created.id)
      expect(service!.name).toBe('GetTest Service')
    })

    it('should return null for non-existent service', async () => {
      const stub = getStub()

      const service = await rpc<Service | null>(stub, 'services.get', ['non-existent-id'])

      expect(service).toBeNull()
    })
  })

  describe('ServicesAPI.list()', () => {
    it('should list all services', async () => {
      const stub = getStub()

      // Create multiple services
      await rpc<Service>(stub, 'services.create', [{ name: 'Service A', active: true }])
      await rpc<Service>(stub, 'services.create', [{ name: 'Service B', active: false }])
      await rpc<Service>(stub, 'services.create', [{ name: 'Service C', active: true }])

      // List all
      const services = await rpc<Service[]>(stub, 'services.list', [])

      expect(services.length).toBe(3)
      expect(services.map(s => s.name).sort()).toEqual(['Service A', 'Service B', 'Service C'])
    })

    it('should return empty array when no services exist', async () => {
      const stub = getStub()

      const services = await rpc<Service[]>(stub, 'services.list', [])

      expect(services).toEqual([])
    })
  })

  describe('ServicesAPI.update()', () => {
    it('should update a service', async () => {
      const stub = getStub()

      // Create first
      const created = await rpc<Service>(stub, 'services.create', [
        { name: 'Original Service', active: true }
      ])

      // Update
      const updated = await rpc<Service>(stub, 'services.update', [
        created.id,
        { name: 'Updated Service', description: 'Now with description' }
      ])

      expect(updated.id).toBe(created.id)
      expect(updated.name).toBe('Updated Service')
      expect(updated.description).toBe('Now with description')
      expect(updated.active).toBe(true) // unchanged
    })

    it('should throw error for non-existent service update', async () => {
      const stub = getStub()

      // Try to update non-existent service
      const response = await stub.fetch('https://business/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'services.update',
          args: ['non-existent-id', { name: 'New Name' }]
        })
      })

      // Should fail since service doesn't exist
      expect(response.status).toBe(500)
    })
  })

  describe('ServicesAPI.delete()', () => {
    it('should delete a service', async () => {
      const stub = getStub()

      // Create first
      const created = await rpc<Service>(stub, 'services.create', [
        { name: 'To Be Deleted', active: true }
      ])

      // Delete
      const result = await rpc<boolean>(stub, 'services.delete', [created.id])

      expect(result).toBe(true)

      // Verify deleted
      const service = await rpc<Service | null>(stub, 'services.get', [created.id])
      expect(service).toBeNull()
    })

    it('should return false for non-existent service delete', async () => {
      const stub = getStub()

      const result = await rpc<boolean>(stub, 'services.delete', ['non-existent-id'])

      expect(result).toBe(false)
    })
  })
})
