/**
 * @dotdo/shopify - Comprehensive Tests
 *
 * RED phase tests for the Shopify SDK migration.
 * Tests for the local Shopify implementation demonstrating:
 * - Products (CRUD operations, variants, images)
 * - Orders (creation, fulfillment, refunds)
 * - Customers (CRUD, addresses)
 * - Webhooks (validation, signature verification)
 * - GraphQL API (queries and mutations)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ShopifyLocal } from '../src/local'
import type { Product, Order, Customer } from '../src/types'

describe('ShopifyLocal - Local Shopify Implementation', () => {
  let shopify: ShopifyLocal

  beforeEach(() => {
    shopify = new ShopifyLocal({
      shop: 'test-shop.myshopify.com',
      accessToken: 'test-token',
    })
  })

  // ===========================================================================
  // Initialization Tests
  // ===========================================================================

  describe('initialization', () => {
    it('should create a ShopifyLocal instance', () => {
      expect(shopify).toBeDefined()
      expect(shopify.products).toBeDefined()
      expect(shopify.orders).toBeDefined()
      expect(shopify.customers).toBeDefined()
      expect(shopify.inventory).toBeDefined()
      expect(shopify.webhooks).toBeDefined()
    })

    it('should configure with shop and access token', () => {
      const instance = new ShopifyLocal({
        shop: 'my-store.myshopify.com',
        accessToken: 'shpat_xxxxx',
      })
      expect(instance.config.shop).toBe('my-store.myshopify.com')
    })
  })

  // ===========================================================================
  // Products Tests
  // ===========================================================================

  describe('products', () => {
    describe('CRUD operations', () => {
      it('should create a product', async () => {
        const product = await shopify.products.create({
          title: 'Test Product',
          body_html: '<p>Test description</p>',
          vendor: 'Test Vendor',
          product_type: 'Test Type',
          tags: 'tag1, tag2',
        })

        expect(product.id).toBeDefined()
        expect(product.title).toBe('Test Product')
        expect(product.vendor).toBe('Test Vendor')
        expect(product.product_type).toBe('Test Type')
        expect(product.tags).toBe('tag1, tag2')
        expect(product.created_at).toBeDefined()
        expect(product.updated_at).toBeDefined()
      })

      it('should create a product with variants', async () => {
        const product = await shopify.products.create({
          title: 'T-Shirt',
          variants: [
            { title: 'Small', price: '19.99', sku: 'TSHIRT-S' },
            { title: 'Medium', price: '19.99', sku: 'TSHIRT-M' },
            { title: 'Large', price: '19.99', sku: 'TSHIRT-L' },
          ],
        })

        expect(product.variants).toHaveLength(3)
        expect(product.variants[0].sku).toBe('TSHIRT-S')
        expect(product.variants[0].price).toBe('19.99')
      })

      it('should retrieve a product', async () => {
        const created = await shopify.products.create({
          title: 'Test Product',
        })

        const retrieved = await shopify.products.get(created.id)

        expect(retrieved.id).toBe(created.id)
        expect(retrieved.title).toBe('Test Product')
      })

      it('should update a product', async () => {
        const product = await shopify.products.create({
          title: 'Original Title',
        })

        const updated = await shopify.products.update(product.id, {
          title: 'Updated Title',
          body_html: '<p>Updated description</p>',
        })

        expect(updated.title).toBe('Updated Title')
        expect(updated.body_html).toBe('<p>Updated description</p>')
      })

      it('should delete a product', async () => {
        const product = await shopify.products.create({
          title: 'To Delete',
        })

        await shopify.products.delete(product.id)

        await expect(shopify.products.get(product.id)).rejects.toThrow()
      })
    })

    describe('list and search', () => {
      it('should list products', async () => {
        await shopify.products.create({ title: 'Product 1' })
        await shopify.products.create({ title: 'Product 2' })
        await shopify.products.create({ title: 'Product 3' })

        const result = await shopify.products.list({ limit: 10 })

        expect(result.products).toHaveLength(3)
      })

      it('should filter by status', async () => {
        await shopify.products.create({ title: 'Active Product', status: 'active' })
        await shopify.products.create({ title: 'Draft Product', status: 'draft' })

        const result = await shopify.products.list({ status: 'active' })

        expect(result.products).toHaveLength(1)
        expect(result.products[0].title).toBe('Active Product')
      })

      it('should filter by vendor', async () => {
        await shopify.products.create({ title: 'Product 1', vendor: 'Acme' })
        await shopify.products.create({ title: 'Product 2', vendor: 'Other' })

        const result = await shopify.products.list({ vendor: 'Acme' })

        expect(result.products).toHaveLength(1)
        expect(result.products[0].vendor).toBe('Acme')
      })

      it('should count products', async () => {
        await shopify.products.create({ title: 'Product 1' })
        await shopify.products.create({ title: 'Product 2' })

        const count = await shopify.products.count()

        expect(count.count).toBe(2)
      })
    })

    describe('variants', () => {
      it('should create a variant', async () => {
        const product = await shopify.products.create({ title: 'Product' })

        const variant = await shopify.products.variants.create(product.id, {
          title: 'New Variant',
          price: '29.99',
          sku: 'VAR-001',
        })

        expect(variant.id).toBeDefined()
        expect(variant.product_id).toBe(product.id)
        expect(variant.price).toBe('29.99')
      })

      it('should update a variant', async () => {
        const product = await shopify.products.create({
          title: 'Product',
          variants: [{ title: 'Default', price: '10.00' }],
        })

        const variantId = product.variants[0].id

        const updated = await shopify.products.variants.update(variantId, {
          price: '15.00',
          compare_at_price: '20.00',
        })

        expect(updated.price).toBe('15.00')
        expect(updated.compare_at_price).toBe('20.00')
      })

      it('should delete a variant', async () => {
        const product = await shopify.products.create({
          title: 'Product',
          variants: [
            { title: 'Variant 1', price: '10.00' },
            { title: 'Variant 2', price: '20.00' },
          ],
        })

        await shopify.products.variants.delete(product.id, product.variants[0].id)

        const retrieved = await shopify.products.get(product.id)
        expect(retrieved.variants).toHaveLength(1)
      })
    })
  })

  // ===========================================================================
  // Orders Tests
  // ===========================================================================

  describe('orders', () => {
    describe('CRUD operations', () => {
      it('should create an order', async () => {
        const order = await shopify.orders.create({
          email: 'customer@example.com',
          line_items: [
            { title: 'Test Item', quantity: 2, price: '25.00' },
          ],
          financial_status: 'pending',
        })

        expect(order.id).toBeDefined()
        expect(order.email).toBe('customer@example.com')
        expect(order.line_items).toHaveLength(1)
        expect(order.line_items[0].quantity).toBe(2)
        expect(order.financial_status).toBe('pending')
      })

      it('should retrieve an order', async () => {
        const created = await shopify.orders.create({
          email: 'test@example.com',
          line_items: [{ title: 'Item', quantity: 1, price: '10.00' }],
        })

        const retrieved = await shopify.orders.get(created.id)

        expect(retrieved.id).toBe(created.id)
        expect(retrieved.email).toBe('test@example.com')
      })

      it('should update an order', async () => {
        const order = await shopify.orders.create({
          email: 'test@example.com',
          line_items: [{ title: 'Item', quantity: 1, price: '10.00' }],
        })

        const updated = await shopify.orders.update(order.id, {
          note: 'Updated note',
          tags: 'vip, priority',
        })

        expect(updated.note).toBe('Updated note')
        expect(updated.tags).toBe('vip, priority')
      })

      it('should close an order', async () => {
        const order = await shopify.orders.create({
          email: 'test@example.com',
          line_items: [{ title: 'Item', quantity: 1, price: '10.00' }],
        })

        const closed = await shopify.orders.close(order.id)

        expect(closed.closed_at).toBeDefined()
      })

      it('should cancel an order', async () => {
        const order = await shopify.orders.create({
          email: 'test@example.com',
          line_items: [{ title: 'Item', quantity: 1, price: '10.00' }],
        })

        const cancelled = await shopify.orders.cancel(order.id, {
          reason: 'customer',
        })

        expect(cancelled.cancelled_at).toBeDefined()
        expect(cancelled.cancel_reason).toBe('customer')
      })
    })

    describe('list and count', () => {
      it('should list orders', async () => {
        await shopify.orders.create({
          email: 'test1@example.com',
          line_items: [{ title: 'Item 1', quantity: 1, price: '10.00' }],
        })
        await shopify.orders.create({
          email: 'test2@example.com',
          line_items: [{ title: 'Item 2', quantity: 1, price: '20.00' }],
        })

        const result = await shopify.orders.list()

        expect(result.orders).toHaveLength(2)
      })

      it('should filter by status', async () => {
        const order = await shopify.orders.create({
          email: 'test@example.com',
          line_items: [{ title: 'Item', quantity: 1, price: '10.00' }],
        })
        await shopify.orders.close(order.id)

        await shopify.orders.create({
          email: 'test2@example.com',
          line_items: [{ title: 'Item 2', quantity: 1, price: '20.00' }],
        })

        const closedOrders = await shopify.orders.list({ status: 'closed' })
        expect(closedOrders.orders).toHaveLength(1)

        const openOrders = await shopify.orders.list({ status: 'open' })
        expect(openOrders.orders).toHaveLength(1)
      })

      it('should count orders', async () => {
        await shopify.orders.create({
          email: 'test@example.com',
          line_items: [{ title: 'Item', quantity: 1, price: '10.00' }],
        })
        await shopify.orders.create({
          email: 'test2@example.com',
          line_items: [{ title: 'Item', quantity: 1, price: '10.00' }],
        })

        const count = await shopify.orders.count()

        expect(count.count).toBe(2)
      })
    })

    describe('fulfillments', () => {
      it('should create a fulfillment', async () => {
        const order = await shopify.orders.create({
          email: 'test@example.com',
          line_items: [{ title: 'Item', quantity: 1, price: '10.00' }],
        })

        const fulfillment = await shopify.orders.fulfillments.create(order.id, {
          tracking_number: '1Z999AA10123456784',
          tracking_company: 'UPS',
          notify_customer: true,
        })

        expect(fulfillment.id).toBeDefined()
        expect(fulfillment.tracking_number).toBe('1Z999AA10123456784')
        expect(fulfillment.tracking_company).toBe('UPS')
      })

      it('should update fulfillment tracking', async () => {
        const order = await shopify.orders.create({
          email: 'test@example.com',
          line_items: [{ title: 'Item', quantity: 1, price: '10.00' }],
        })

        const fulfillment = await shopify.orders.fulfillments.create(order.id, {
          tracking_number: '123',
        })

        const updated = await shopify.orders.fulfillments.updateTracking(
          order.id,
          fulfillment.id,
          { tracking_number: '456', tracking_company: 'FedEx' }
        )

        expect(updated.tracking_number).toBe('456')
        expect(updated.tracking_company).toBe('FedEx')
      })
    })

    describe('refunds', () => {
      it('should create a refund', async () => {
        const order = await shopify.orders.create({
          email: 'test@example.com',
          financial_status: 'paid',
          line_items: [{ title: 'Item', quantity: 2, price: '25.00' }],
        })

        const refund = await shopify.orders.refunds.create(order.id, {
          refund_line_items: [
            { line_item_id: order.line_items[0].id, quantity: 1 },
          ],
          note: 'Customer requested refund',
        })

        expect(refund.id).toBeDefined()
        expect(refund.order_id).toBe(order.id)
        expect(refund.refund_line_items).toHaveLength(1)
      })

      it('should calculate a refund', async () => {
        const order = await shopify.orders.create({
          email: 'test@example.com',
          financial_status: 'paid',
          line_items: [{ title: 'Item', quantity: 2, price: '25.00' }],
        })

        const calculation = await shopify.orders.refunds.calculate(order.id, {
          refund_line_items: [
            { line_item_id: order.line_items[0].id, quantity: 1 },
          ],
        })

        expect(calculation).toBeDefined()
      })
    })
  })

  // ===========================================================================
  // Customers Tests
  // ===========================================================================

  describe('customers', () => {
    describe('CRUD operations', () => {
      it('should create a customer', async () => {
        const customer = await shopify.customers.create({
          email: 'customer@example.com',
          first_name: 'John',
          last_name: 'Doe',
          phone: '+1234567890',
        })

        expect(customer.id).toBeDefined()
        expect(customer.email).toBe('customer@example.com')
        expect(customer.first_name).toBe('John')
        expect(customer.last_name).toBe('Doe')
      })

      it('should retrieve a customer', async () => {
        const created = await shopify.customers.create({
          email: 'test@example.com',
          first_name: 'Test',
        })

        const retrieved = await shopify.customers.get(created.id)

        expect(retrieved.id).toBe(created.id)
        expect(retrieved.email).toBe('test@example.com')
      })

      it('should update a customer', async () => {
        const customer = await shopify.customers.create({
          email: 'test@example.com',
        })

        const updated = await shopify.customers.update(customer.id, {
          first_name: 'Updated',
          last_name: 'Name',
          tags: 'vip',
        })

        expect(updated.first_name).toBe('Updated')
        expect(updated.last_name).toBe('Name')
        expect(updated.tags).toBe('vip')
      })

      it('should delete a customer', async () => {
        const customer = await shopify.customers.create({
          email: 'test@example.com',
        })

        await shopify.customers.delete(customer.id)

        await expect(shopify.customers.get(customer.id)).rejects.toThrow()
      })
    })

    describe('list and search', () => {
      it('should list customers', async () => {
        await shopify.customers.create({ email: 'user1@example.com' })
        await shopify.customers.create({ email: 'user2@example.com' })

        const result = await shopify.customers.list()

        expect(result.customers).toHaveLength(2)
      })

      it('should search customers', async () => {
        await shopify.customers.create({ email: 'searchable@example.com', first_name: 'Searchable' })
        await shopify.customers.create({ email: 'other@example.com', first_name: 'Other' })

        const result = await shopify.customers.search({ query: 'searchable' })

        expect(result.customers).toHaveLength(1)
        expect(result.customers[0].email).toBe('searchable@example.com')
      })

      it('should count customers', async () => {
        await shopify.customers.create({ email: 'user1@example.com' })
        await shopify.customers.create({ email: 'user2@example.com' })

        const count = await shopify.customers.count()

        expect(count.count).toBe(2)
      })
    })

    describe('addresses', () => {
      it('should create an address', async () => {
        const customer = await shopify.customers.create({
          email: 'test@example.com',
        })

        const address = await shopify.customers.addresses.create(customer.id, {
          address1: '123 Main St',
          city: 'Anytown',
          province: 'CA',
          country: 'US',
          zip: '12345',
        })

        expect(address.id).toBeDefined()
        expect(address.address1).toBe('123 Main St')
        expect(address.city).toBe('Anytown')
      })

      it('should list addresses', async () => {
        const customer = await shopify.customers.create({
          email: 'test@example.com',
        })

        await shopify.customers.addresses.create(customer.id, {
          address1: '123 Main St',
          city: 'City1',
        })
        await shopify.customers.addresses.create(customer.id, {
          address1: '456 Oak Ave',
          city: 'City2',
        })

        const result = await shopify.customers.addresses.list(customer.id)

        expect(result.addresses).toHaveLength(2)
      })

      it('should set default address', async () => {
        const customer = await shopify.customers.create({
          email: 'test@example.com',
        })

        const address = await shopify.customers.addresses.create(customer.id, {
          address1: '123 Main St',
        })

        const updated = await shopify.customers.addresses.setDefault(
          customer.id,
          address.id
        )

        expect(updated.default).toBe(true)
      })
    })

    describe('orders', () => {
      it('should get customer orders', async () => {
        const customer = await shopify.customers.create({
          email: 'test@example.com',
        })

        await shopify.orders.create({
          customer: { id: customer.id },
          line_items: [{ title: 'Item 1', quantity: 1, price: '10.00' }],
        })
        await shopify.orders.create({
          customer: { id: customer.id },
          line_items: [{ title: 'Item 2', quantity: 1, price: '20.00' }],
        })

        const result = await shopify.customers.orders(customer.id)

        expect(result.orders).toHaveLength(2)
      })
    })
  })

  // ===========================================================================
  // Inventory Tests
  // ===========================================================================

  describe('inventory', () => {
    it('should set inventory level', async () => {
      const product = await shopify.products.create({
        title: 'Inventory Test Product',
        variants: [{ title: 'Default', price: '10.00', inventory_management: 'shopify' }],
      })

      const inventoryItemId = product.variants[0].inventory_item_id

      const level = await shopify.inventory.levels.set({
        inventory_item_id: inventoryItemId,
        location_id: 1,
        available: 100,
      })

      expect(level.available).toBe(100)
    })

    it('should adjust inventory level', async () => {
      const product = await shopify.products.create({
        title: 'Inventory Test Product',
        variants: [{ title: 'Default', price: '10.00', inventory_management: 'shopify' }],
      })

      const inventoryItemId = product.variants[0].inventory_item_id

      await shopify.inventory.levels.set({
        inventory_item_id: inventoryItemId,
        location_id: 1,
        available: 100,
      })

      const adjusted = await shopify.inventory.levels.adjust({
        inventory_item_id: inventoryItemId,
        location_id: 1,
        available_adjustment: -10,
      })

      expect(adjusted.available).toBe(90)
    })

    it('should list locations', async () => {
      const result = await shopify.inventory.locations.list()

      expect(result.locations).toBeDefined()
      expect(Array.isArray(result.locations)).toBe(true)
    })
  })

  // ===========================================================================
  // Webhooks Tests
  // ===========================================================================

  describe('webhooks', () => {
    it('should validate webhook signature', async () => {
      const rawBody = JSON.stringify({ test: 'data' })
      const secret = 'test-secret'

      // Generate a test HMAC
      const hmac = await shopify.webhooks.generateHmac(rawBody, secret)

      const isValid = await shopify.webhooks.validate({
        rawBody,
        hmac,
        secret,
      })

      expect(isValid).toBe(true)
    })

    it('should reject invalid webhook signature', async () => {
      const rawBody = JSON.stringify({ test: 'data' })
      const secret = 'test-secret'

      const isValid = await shopify.webhooks.validate({
        rawBody,
        hmac: 'invalid-hmac',
        secret,
      })

      expect(isValid).toBe(false)
    })
  })

  // ===========================================================================
  // GraphQL Tests
  // ===========================================================================

  describe('graphql', () => {
    it('should execute a query', async () => {
      await shopify.products.create({ title: 'GraphQL Test Product' })

      const result = await shopify.graphql.query({
        query: `
          query {
            products(first: 10) {
              edges {
                node {
                  id
                  title
                }
              }
            }
          }
        `,
      })

      expect(result.data).toBeDefined()
      expect(result.data.products.edges).toHaveLength(1)
      expect(result.data.products.edges[0].node.title).toBe('GraphQL Test Product')
    })

    it('should execute a mutation', async () => {
      const result = await shopify.graphql.query({
        query: `
          mutation productCreate($input: ProductInput!) {
            productCreate(input: $input) {
              product {
                id
                title
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        variables: {
          input: {
            title: 'Created via GraphQL',
          },
        },
      })

      expect(result.data).toBeDefined()
      expect(result.data.productCreate.product.title).toBe('Created via GraphQL')
      expect(result.data.productCreate.userErrors).toHaveLength(0)
    })
  })

  // ===========================================================================
  // Clear State
  // ===========================================================================

  describe('state management', () => {
    it('should clear all state', async () => {
      await shopify.products.create({ title: 'Product 1' })
      await shopify.customers.create({ email: 'test@example.com' })

      await shopify.clear()

      const products = await shopify.products.list()
      const customers = await shopify.customers.list()

      expect(products.products).toHaveLength(0)
      expect(customers.customers).toHaveLength(0)
    })
  })
})
