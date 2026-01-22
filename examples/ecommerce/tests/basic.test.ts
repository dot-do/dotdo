/**
 * E-commerce Example - Basic Smoke Tests
 *
 * Tests using @cloudflare/vitest-pool-workers with real Durable Objects.
 * NO MOCKS - per CLAUDE.md guidelines.
 *
 * Verifies:
 * - DO instantiation works
 * - Basic CRUD operations work
 * - No TypeScript errors
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

// Type definitions for API responses
interface Product {
  $id: string
  $type: string
  name: string
  price: number
  inventory: number
}

interface Cart {
  $id: string
  $type: string
  customerId: string
  items: CartItem[]
  total: number
  status: string
}

interface CartItem {
  productId: string
  quantity: number
  price: number
  name: string
}

interface Order {
  $id: string
  $type: string
  customerId: string
  items: OrderItem[]
  subtotal: number
  tax: number
  total: number
  status: string
}

interface OrderItem {
  productId: string
  quantity: number
  unitPrice: number
}

interface Customer {
  $id: string
  $type: string
  email: string
  name: string
}

// Helper to get a fresh DO stub
function getStub(name?: string) {
  const testName = name ?? `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const id = env.ECOMMERCE.idFromName(testName)
  return env.ECOMMERCE.get(id)
}

describe('EcommerceDO', () => {
  describe('instantiation', () => {
    it('should create a new DO instance', async () => {
      const stub = getStub()
      expect(stub).toBeDefined()
    })

    it('should respond to basic requests', async () => {
      const stub = getStub()
      const response = await stub.fetch('https://ecommerce/')

      expect(response.status).toBe(200)
    })
  })

  describe('products API', () => {
    it('should list products', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://ecommerce/products')
      expect(response.status).toBe(200)

      const products = await response.json()
      expect(Array.isArray(products)).toBe(true)
    })

    it('should create a product', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://ecommerce/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Product',
          price: 29.99,
          description: 'A test product',
          inventory: 100,
        }),
      })

      expect(response.status).toBe(201)
      const product = (await response.json()) as Product
      expect(product.name).toBe('Test Product')
      expect(product.price).toBe(29.99)
      expect(product.inventory).toBe(100)
    })

    it('should return 404 for non-existent product', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://ecommerce/products/non-existent-id')
      expect(response.status).toBe(404)
    })
  })

  describe('cart API', () => {
    it('should get or create cart for customer', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://ecommerce/cart/test-customer')
      expect(response.status).toBe(200)

      const cart = (await response.json()) as Cart
      expect(cart.customerId).toBe('test-customer')
      expect(cart.status).toBe('active')
      expect(Array.isArray(cart.items)).toBe(true)
    })

    it('should add item to cart', async () => {
      const stub = getStub()

      // Create a product first
      const productResponse = await stub.fetch('https://ecommerce/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Cart Test Product',
          price: 15.00,
          inventory: 10,
        }),
      })
      const product = (await productResponse.json()) as Product

      // Add to cart
      const response = await stub.fetch('https://ecommerce/cart/cart-test-customer/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.$id,
          quantity: 2,
        }),
      })

      expect(response.status).toBe(200)
      const cart = (await response.json()) as Cart
      expect(cart.items.length).toBe(1)
      expect(cart.items[0].quantity).toBe(2)
      expect(cart.total).toBe(30.00) // 15 * 2
    })

    it('should reject adding item with insufficient inventory', async () => {
      const stub = getStub()

      // Create a product with low inventory
      const productResponse = await stub.fetch('https://ecommerce/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Limited Product',
          price: 10.00,
          inventory: 1,
        }),
      })
      const product = (await productResponse.json()) as Product

      // Try to add more than available
      const response = await stub.fetch('https://ecommerce/cart/inventory-test-customer/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.$id,
          quantity: 10,
        }),
      })

      expect(response.status).toBe(400)
    })
  })

  describe('checkout API', () => {
    it('should create an order from cart', async () => {
      const stub = getStub()
      const customerId = `checkout-${Date.now()}`

      // Create a product
      const productResponse = await stub.fetch('https://ecommerce/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Checkout Test Product',
          price: 25.00,
          inventory: 100,
        }),
      })
      const product = (await productResponse.json()) as Product

      // Add to cart
      await stub.fetch(`https://ecommerce/cart/${customerId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.$id,
          quantity: 2,
        }),
      })

      // Checkout
      const response = await stub.fetch(`https://ecommerce/checkout/${customerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shippingAddress: {
            street: '123 Test St',
            city: 'Test City',
            state: 'TS',
            zip: '12345',
            country: 'US',
          },
        }),
      })

      expect(response.status).toBe(201)
      const order = (await response.json()) as Order
      expect(order.customerId).toBe(customerId)
      expect(order.status).toBe('pending')
      expect(order.subtotal).toBe(50.00) // 25 * 2
      expect(order.tax).toBeGreaterThan(0)
    })

    it('should reject checkout with empty cart', async () => {
      const stub = getStub()
      const customerId = `empty-cart-${Date.now()}`

      // Get empty cart
      await stub.fetch(`https://ecommerce/cart/${customerId}`)

      // Try checkout
      const response = await stub.fetch(`https://ecommerce/checkout/${customerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shippingAddress: {
            street: '123 Test St',
            city: 'Test City',
            state: 'TS',
            zip: '12345',
            country: 'US',
          },
        }),
      })

      expect(response.status).toBe(400)
    })
  })

  describe('customers API', () => {
    it('should create a customer', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://ecommerce/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          name: 'Test Customer',
        }),
      })

      expect(response.status).toBe(201)
      const customer = (await response.json()) as Customer
      expect(customer.email).toBe('test@example.com')
      expect(customer.name).toBe('Test Customer')
    })
  })
})
