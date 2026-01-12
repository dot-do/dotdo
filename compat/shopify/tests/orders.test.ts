/**
 * @dotdo/shopify - Orders API Tests (RED Phase)
 *
 * TDD RED tests for Shopify Orders API compatibility layer.
 * Tests order CRUD, fulfillments, refunds, transactions, risks, and pagination.
 *
 * @module @dotdo/shopify/tests/orders
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { shopifyApi, type Session, type Order, type Fulfillment, type Refund, type Transaction } from '../index'
import { OrdersResource } from '../orders'

// =============================================================================
// Test Setup
// =============================================================================

const mockSession: Session = {
  id: 'test-session',
  shop: 'test-shop.myshopify.com',
  state: 'test-state',
  isOnline: false,
  accessToken: 'test-token',
  scope: 'read_orders,write_orders',
}

function createMockFetch(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  let callIndex = 0
  return vi.fn(async () => {
    const response = responses[callIndex] || responses[responses.length - 1]
    callIndex++
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      headers: new Headers(response.headers || {}),
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
    }
  })
}

function createShopifyClient(mockFetch: ReturnType<typeof vi.fn>) {
  return shopifyApi({
    apiKey: 'test-key',
    apiSecretKey: 'test-secret',
    scopes: ['read_orders', 'write_orders'],
    hostName: 'test-shop.myshopify.com',
    fetch: mockFetch as unknown as typeof fetch,
  })
}

// =============================================================================
// Order CRUD Operations
// =============================================================================

describe('Orders API - CRUD Operations', () => {
  describe('list orders', () => {
    it('should list all orders', async () => {
      const mockOrders: Order[] = [
        {
          id: 1001,
          name: '#1001',
          email: 'customer@example.com',
          phone: null,
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-15T10:00:00Z',
          processed_at: '2024-01-15T10:00:00Z',
          closed_at: null,
          cancelled_at: null,
          cancel_reason: null,
          financial_status: 'paid',
          fulfillment_status: null,
          currency: 'USD',
          total_price: '99.99',
          subtotal_price: '89.99',
          total_tax: '10.00',
          total_discounts: '0.00',
          total_line_items_price: '89.99',
          total_weight: 500,
          taxes_included: false,
          confirmed: true,
          test: false,
          order_number: 1001,
          token: 'test-token',
          gateway: 'shopify_payments',
          line_items: [],
          shipping_lines: [],
          billing_address: null,
          shipping_address: null,
          customer: null,
          fulfillments: [],
          refunds: [],
          tags: '',
          note: null,
          note_attributes: [],
          discount_codes: [],
          discount_applications: [],
        },
      ]

      const mockFetch = createMockFetch([{ status: 200, body: { orders: mockOrders } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.list()

      expect(result.body.orders).toHaveLength(1)
      expect(result.body.orders[0].id).toBe(1001)
      expect(result.body.orders[0].financial_status).toBe('paid')
    })

    it('should filter orders by status', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { orders: [] } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.list({ status: 'open' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=open'),
        expect.any(Object)
      )
    })

    it('should filter orders by financial_status', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { orders: [] } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.list({ financial_status: 'refunded' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('financial_status=refunded'),
        expect.any(Object)
      )
    })

    it('should filter orders by fulfillment_status', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { orders: [] } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.list({ fulfillment_status: 'unfulfilled' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('fulfillment_status=unfulfilled'),
        expect.any(Object)
      )
    })

    it('should filter orders by date range', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { orders: [] } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.list({
        created_at_min: '2024-01-01T00:00:00Z',
        created_at_max: '2024-01-31T23:59:59Z',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/created_at_min.*created_at_max|created_at_max.*created_at_min/),
        expect.any(Object)
      )
    })

    it('should respect limit parameter', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { orders: [] } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.list({ limit: 50 })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=50'),
        expect.any(Object)
      )
    })

    it('should handle since_id for cursor pagination', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { orders: [] } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.list({ since_id: 1000 })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('since_id=1000'),
        expect.any(Object)
      )
    })
  })

  describe('get order', () => {
    it('should get a single order by ID', async () => {
      const mockOrder: Order = {
        id: 1001,
        name: '#1001',
        email: 'customer@example.com',
        phone: '+1234567890',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        processed_at: '2024-01-15T10:00:00Z',
        closed_at: null,
        cancelled_at: null,
        cancel_reason: null,
        financial_status: 'paid',
        fulfillment_status: 'fulfilled',
        currency: 'USD',
        total_price: '199.99',
        subtotal_price: '179.99',
        total_tax: '20.00',
        total_discounts: '10.00',
        total_line_items_price: '189.99',
        total_weight: 1000,
        taxes_included: false,
        confirmed: true,
        test: false,
        order_number: 1001,
        token: 'order-token',
        gateway: 'shopify_payments',
        line_items: [
          {
            id: 2001,
            product_id: 3001,
            variant_id: 4001,
            title: 'Test Product',
            variant_title: 'Large',
            sku: 'TEST-001',
            quantity: 2,
            price: '89.99',
            grams: 500,
            fulfillment_status: 'fulfilled',
            fulfillable_quantity: 0,
            fulfillment_service: 'manual',
            requires_shipping: true,
            taxable: true,
            gift_card: false,
            total_discount: '5.00',
            discount_allocations: [],
            tax_lines: [],
            properties: [],
          },
        ],
        shipping_lines: [],
        billing_address: {
          first_name: 'John',
          last_name: 'Doe',
          address1: '123 Main St',
          city: 'New York',
          province: 'NY',
          country: 'US',
          zip: '10001',
        },
        shipping_address: {
          first_name: 'John',
          last_name: 'Doe',
          address1: '123 Main St',
          city: 'New York',
          province: 'NY',
          country: 'US',
          zip: '10001',
        },
        customer: null,
        fulfillments: [],
        refunds: [],
        tags: 'vip,priority',
        note: 'Please handle with care',
        note_attributes: [],
        discount_codes: [],
        discount_applications: [],
      }

      const mockFetch = createMockFetch([{ status: 200, body: { order: mockOrder } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.get(1001)

      expect(result.body.order.id).toBe(1001)
      expect(result.body.order.line_items).toHaveLength(1)
      expect(result.body.order.tags).toBe('vip,priority')
    })

    it('should return 404 for non-existent order', async () => {
      const mockFetch = createMockFetch([{ status: 404, body: { errors: 'Not Found' } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await expect(orders.get(99999)).rejects.toThrow()
    })

    it('should select specific fields', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { order: { id: 1001, name: '#1001' } } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.get(1001, { fields: 'id,name' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('fields=id%2Cname'),
        expect.any(Object)
      )
    })
  })

  describe('create order', () => {
    it('should create a basic order', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: {
          order: {
            id: 1002,
            name: '#1002',
            email: 'new@example.com',
            financial_status: 'pending',
            fulfillment_status: null,
            line_items: [{ id: 2002, title: 'New Product', quantity: 1 }],
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.create({
        email: 'new@example.com',
        line_items: [{ title: 'New Product', quantity: 1, price: '49.99' }],
      })

      expect(result.body.order.id).toBe(1002)
      expect(result.body.order.email).toBe('new@example.com')
    })

    it('should create order with customer association', async () => {
      const mockFetch = createMockFetch([{ status: 201, body: { order: { id: 1003 } } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.create({
        customer: { id: 5001 },
        line_items: [{ variant_id: 4001, quantity: 1 }],
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"customer"'),
        })
      )
    })

    it('should create order with shipping and billing addresses', async () => {
      const mockFetch = createMockFetch([{ status: 201, body: { order: { id: 1004 } } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.create({
        line_items: [{ title: 'Product', quantity: 1 }],
        billing_address: {
          first_name: 'Jane',
          last_name: 'Smith',
          address1: '456 Oak Ave',
          city: 'Los Angeles',
          province: 'CA',
          country: 'US',
          zip: '90001',
        },
        shipping_address: {
          first_name: 'Jane',
          last_name: 'Smith',
          address1: '789 Pine Rd',
          city: 'San Francisco',
          province: 'CA',
          country: 'US',
          zip: '94102',
        },
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('should create order with discount codes', async () => {
      const mockFetch = createMockFetch([{ status: 201, body: { order: { id: 1005 } } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.create({
        line_items: [{ title: 'Product', quantity: 1 }],
        discount_codes: [{ code: 'SAVE10', amount: '10.00', type: 'fixed_amount' }],
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('SAVE10'),
        })
      )
    })

    it('should create order with transactions', async () => {
      const mockFetch = createMockFetch([{ status: 201, body: { order: { id: 1006 } } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.create({
        line_items: [{ title: 'Product', quantity: 1, price: '100.00' }],
        transactions: [{ kind: 'sale', amount: '100.00', gateway: 'manual' }],
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('should create order with inventory_behaviour bypass', async () => {
      const mockFetch = createMockFetch([{ status: 201, body: { order: { id: 1007 } } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.create({
        line_items: [{ variant_id: 4001, quantity: 1 }],
        inventory_behaviour: 'bypass',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('bypass'),
        })
      )
    })

    it('should create test order', async () => {
      const mockFetch = createMockFetch([{ status: 201, body: { order: { id: 1008, test: true } } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.create({
        line_items: [{ title: 'Test Product', quantity: 1 }],
        test: true,
      })

      expect(result.body.order.test).toBe(true)
    })

    it('should fail with invalid line items', async () => {
      const mockFetch = createMockFetch([{
        status: 422,
        body: { errors: { line_items: ['must have at least one line item'] } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await expect(orders.create({ line_items: [] })).rejects.toThrow()
    })
  })

  describe('update order', () => {
    it('should update order note', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: { order: { id: 1001, note: 'Updated note' } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.update(1001, { note: 'Updated note' })

      expect(result.body.order.note).toBe('Updated note')
    })

    it('should update order tags', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: { order: { id: 1001, tags: 'vip,urgent,handled' } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.update(1001, { tags: 'vip,urgent,handled' })

      expect(result.body.order.tags).toContain('urgent')
    })

    it('should update shipping address', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { order: { id: 1001 } } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.update(1001, {
        shipping_address: {
          first_name: 'Updated',
          last_name: 'Name',
          address1: '999 New St',
        },
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('should update buyer_accepts_marketing', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { order: { id: 1001 } } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.update(1001, { buyer_accepts_marketing: true })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('buyer_accepts_marketing'),
        })
      )
    })

    it('should add metafields to order', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { order: { id: 1001 } } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.update(1001, {
        metafields: [
          { namespace: 'custom', key: 'priority', value: 'high', type: 'single_line_text_field' },
        ],
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('metafields'),
        })
      )
    })
  })

  describe('delete order', () => {
    it('should delete an order', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: {} }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.delete(1001)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('orders/1001'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('should fail to delete non-existent order', async () => {
      const mockFetch = createMockFetch([{ status: 404, body: { errors: 'Not Found' } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await expect(orders.delete(99999)).rejects.toThrow()
    })
  })

  describe('close order', () => {
    it('should close an open order', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: { order: { id: 1001, closed_at: '2024-01-15T12:00:00Z' } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.close(1001)

      expect(result.body.order.closed_at).toBeTruthy()
    })

    it('should fail to close already closed order', async () => {
      const mockFetch = createMockFetch([{
        status: 422,
        body: { errors: 'Order is already closed' },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await expect(orders.close(1001)).rejects.toThrow()
    })
  })

  describe('open order', () => {
    it('should re-open a closed order', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: { order: { id: 1001, closed_at: null } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.open(1001)

      expect(result.body.order.closed_at).toBeNull()
    })
  })

  describe('cancel order', () => {
    it('should cancel an order', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: { order: { id: 1001, cancelled_at: '2024-01-15T12:00:00Z', cancel_reason: 'customer' } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.cancel(1001, { reason: 'customer' })

      expect(result.body.order.cancelled_at).toBeTruthy()
      expect(result.body.order.cancel_reason).toBe('customer')
    })

    it('should cancel with fraud reason', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: { order: { id: 1001, cancel_reason: 'fraud' } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.cancel(1001, { reason: 'fraud' })

      expect(result.body.order.cancel_reason).toBe('fraud')
    })

    it('should cancel with restock', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { order: { id: 1001 } } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.cancel(1001, { reason: 'inventory', restock: true })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('restock'),
        })
      )
    })

    it('should cancel with refund', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { order: { id: 1001 } } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.cancel(1001, {
        reason: 'customer',
        refund: {
          note: 'Customer requested cancellation',
          shipping: { full_refund: true },
        },
      })

      expect(mockFetch).toHaveBeenCalled()
    })

    it('should fail to cancel already cancelled order', async () => {
      const mockFetch = createMockFetch([{
        status: 422,
        body: { errors: 'Order is already cancelled' },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await expect(orders.cancel(1001)).rejects.toThrow()
    })
  })

  describe('count orders', () => {
    it('should count all orders', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { count: 150 } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.count()

      expect(result.body.count).toBe(150)
    })

    it('should count orders by status', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { count: 45 } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.count({ status: 'open' })

      expect(result.body.count).toBe(45)
    })

    it('should count orders by financial status', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { count: 10 } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.count({ financial_status: 'refunded' })

      expect(result.body.count).toBe(10)
    })
  })
})

// =============================================================================
// Fulfillment Management
// =============================================================================

describe('Orders API - Fulfillment Management', () => {
  describe('list fulfillments', () => {
    it('should list all fulfillments for an order', async () => {
      const mockFulfillments: Fulfillment[] = [
        {
          id: 6001,
          order_id: 1001,
          status: 'success',
          tracking_company: 'UPS',
          tracking_number: '1Z999AA10123456784',
          tracking_numbers: ['1Z999AA10123456784'],
          tracking_url: 'https://ups.com/track/1Z999AA10123456784',
          tracking_urls: ['https://ups.com/track/1Z999AA10123456784'],
          line_items: [],
          created_at: '2024-01-16T10:00:00Z',
          updated_at: '2024-01-16T10:00:00Z',
        },
      ]

      const mockFetch = createMockFetch([{ status: 200, body: { fulfillments: mockFulfillments } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.fulfillments.list(1001)

      expect(result.body.fulfillments).toHaveLength(1)
      expect(result.body.fulfillments[0].tracking_company).toBe('UPS')
    })

    it('should filter fulfillments by date', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { fulfillments: [] } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.fulfillments.list(1001, {
        created_at_min: '2024-01-01T00:00:00Z',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('created_at_min'),
        expect.any(Object)
      )
    })
  })

  describe('get fulfillment', () => {
    it('should get a single fulfillment', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: {
          fulfillment: {
            id: 6001,
            order_id: 1001,
            status: 'success',
            tracking_number: '1Z999AA10123456784',
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.fulfillments.get(1001, 6001)

      expect(result.body.fulfillment.id).toBe(6001)
    })
  })

  describe('create fulfillment', () => {
    it('should create a fulfillment for all line items', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: {
          fulfillment: {
            id: 6002,
            order_id: 1001,
            status: 'success',
            tracking_number: 'TRACK123',
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.fulfillments.create(1001, {
        tracking_number: 'TRACK123',
        tracking_company: 'FedEx',
        notify_customer: true,
      })

      expect(result.body.fulfillment.id).toBe(6002)
    })

    it('should create partial fulfillment', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: { fulfillment: { id: 6003, status: 'success' } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.fulfillments.create(1001, {
        line_items: [{ id: 2001, quantity: 1 }],
        tracking_number: 'PARTIAL123',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('line_items'),
        })
      )
    })

    it('should create fulfillment with multiple tracking numbers', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: {
          fulfillment: {
            id: 6004,
            tracking_numbers: ['TRACK1', 'TRACK2'],
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.fulfillments.create(1001, {
        tracking_numbers: ['TRACK1', 'TRACK2'],
        tracking_urls: ['https://track.com/1', 'https://track.com/2'],
      })

      expect(result.body.fulfillment.tracking_numbers).toHaveLength(2)
    })

    it('should create fulfillment with location', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: { fulfillment: { id: 6005, location_id: 7001 } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.fulfillments.create(1001, {
        location_id: 7001,
        tracking_number: 'LOC123',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('location_id'),
        })
      )
    })

    it('should set shipment status', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: { fulfillment: { id: 6006, shipment_status: 'in_transit' } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.fulfillments.create(1001, {
        tracking_number: 'SHIP123',
        shipment_status: 'in_transit',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('in_transit'),
        })
      )
    })

    it('should fail for already fulfilled order', async () => {
      const mockFetch = createMockFetch([{
        status: 422,
        body: { errors: 'All line items are already fulfilled' },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await expect(
        orders.fulfillments.create(1001, { tracking_number: 'FAIL' })
      ).rejects.toThrow()
    })
  })

  describe('update fulfillment tracking', () => {
    it('should update tracking information', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: {
          fulfillment: {
            id: 6001,
            tracking_number: 'NEW_TRACK123',
            tracking_company: 'DHL',
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.fulfillments.updateTracking(1001, 6001, {
        tracking_number: 'NEW_TRACK123',
        tracking_company: 'DHL',
        tracking_url: 'https://dhl.com/track/NEW_TRACK123',
      })

      expect(result.body.fulfillment.tracking_number).toBe('NEW_TRACK123')
    })

    it('should notify customer of tracking update', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: { fulfillment: { id: 6001 } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.fulfillments.updateTracking(1001, 6001, {
        tracking_number: 'NOTIFY123',
        notify_customer: true,
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('notify_customer'),
        })
      )
    })
  })

  describe('cancel fulfillment', () => {
    it('should cancel a fulfillment', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: { fulfillment: { id: 6001, status: 'cancelled' } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.fulfillments.cancel(1001, 6001)

      expect(result.body.fulfillment.status).toBe('cancelled')
    })

    it('should fail to cancel already delivered fulfillment', async () => {
      const mockFetch = createMockFetch([{
        status: 422,
        body: { errors: 'Fulfillment cannot be cancelled' },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await expect(orders.fulfillments.cancel(1001, 6001)).rejects.toThrow()
    })
  })

  describe('complete fulfillment', () => {
    it('should mark fulfillment as complete', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: { fulfillment: { id: 6001, status: 'success' } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.fulfillments.complete(1001, 6001)

      expect(result.body.fulfillment.status).toBe('success')
    })
  })

  describe('count fulfillments', () => {
    it('should count fulfillments for an order', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { count: 3 } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.fulfillments.count(1001)

      expect(result.body.count).toBe(3)
    })
  })
})

// =============================================================================
// Refund Processing
// =============================================================================

describe('Orders API - Refund Processing', () => {
  describe('list refunds', () => {
    it('should list all refunds for an order', async () => {
      const mockRefunds: Refund[] = [
        {
          id: 8001,
          order_id: 1001,
          created_at: '2024-01-17T10:00:00Z',
          note: 'Customer return',
          user_id: 9001,
          processed_at: '2024-01-17T10:00:00Z',
          restock: true,
          refund_line_items: [],
          transactions: [],
          order_adjustments: [],
        },
      ]

      const mockFetch = createMockFetch([{ status: 200, body: { refunds: mockRefunds } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.refunds.list(1001)

      expect(result.body.refunds).toHaveLength(1)
      expect(result.body.refunds[0].note).toBe('Customer return')
    })
  })

  describe('get refund', () => {
    it('should get a single refund', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: {
          refund: {
            id: 8001,
            order_id: 1001,
            note: 'Defective product',
            transactions: [{ id: 10001, kind: 'refund', amount: '50.00' }],
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.refunds.get(1001, 8001)

      expect(result.body.refund.id).toBe(8001)
      expect(result.body.refund.transactions).toHaveLength(1)
    })
  })

  describe('create refund', () => {
    it('should create a full refund', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: {
          refund: {
            id: 8002,
            order_id: 1001,
            transactions: [{ kind: 'refund', amount: '199.99', status: 'success' }],
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.refunds.create(1001, {
        refund_line_items: [{ line_item_id: 2001, quantity: 2, restock_type: 'return' }],
        notify: true,
      })

      expect(result.body.refund.id).toBe(8002)
    })

    it('should create partial refund', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: { refund: { id: 8003, refund_line_items: [{ quantity: 1 }] } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.refunds.create(1001, {
        refund_line_items: [{ line_item_id: 2001, quantity: 1, restock_type: 'return' }],
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"quantity":1'),
        })
      )
    })

    it('should create refund with shipping refund', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: { refund: { id: 8004 } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.refunds.create(1001, {
        shipping: { full_refund: true },
        note: 'Shipping refund',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('full_refund'),
        })
      )
    })

    it('should create refund with partial shipping amount', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: { refund: { id: 8005 } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.refunds.create(1001, {
        shipping: { amount: '5.00' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"amount":"5.00"'),
        })
      )
    })

    it('should create refund with restock type cancel', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: { refund: { id: 8006 } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.refunds.create(1001, {
        refund_line_items: [{ line_item_id: 2001, quantity: 1, restock_type: 'cancel' }],
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('cancel'),
        })
      )
    })

    it('should create refund with specific location', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: { refund: { id: 8007 } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.refunds.create(1001, {
        refund_line_items: [
          { line_item_id: 2001, quantity: 1, restock_type: 'return', location_id: 7001 },
        ],
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('location_id'),
        })
      )
    })

    it('should create refund with custom transactions', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: { refund: { id: 8008, transactions: [{ gateway: 'gift_card' }] } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.refunds.create(1001, {
        transactions: [{ kind: 'refund', amount: '25.00', gateway: 'gift_card' }],
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('gift_card'),
        })
      )
    })

    it('should fail to refund more than order total', async () => {
      const mockFetch = createMockFetch([{
        status: 422,
        body: { errors: 'Refund amount exceeds order total' },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await expect(
        orders.refunds.create(1001, {
          transactions: [{ kind: 'refund', amount: '999999.99' }],
        })
      ).rejects.toThrow()
    })

    it('should fail to refund cancelled order', async () => {
      const mockFetch = createMockFetch([{
        status: 422,
        body: { errors: 'Cannot refund a cancelled order' },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await expect(
        orders.refunds.create(1001, {
          refund_line_items: [{ line_item_id: 2001, quantity: 1 }],
        })
      ).rejects.toThrow()
    })
  })

  describe('calculate refund', () => {
    it('should calculate refund for line items', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: {
          refund: {
            refund_line_items: [
              { line_item_id: 2001, quantity: 1, subtotal: 89.99, total_tax: 9.00 },
            ],
            transactions: [{ kind: 'refund', amount: '98.99' }],
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.refunds.calculate(1001, {
        refund_line_items: [{ line_item_id: 2001, quantity: 1 }],
      })

      expect(result.body.refund.transactions?.[0]?.amount).toBe('98.99')
    })

    it('should calculate refund with shipping', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: {
          refund: {
            shipping: { amount: '10.00' },
            transactions: [{ kind: 'refund', amount: '10.00' }],
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.refunds.calculate(1001, {
        shipping: { full_refund: true },
      })

      expect(result.body.refund).toBeDefined()
    })
  })
})

// =============================================================================
// Transactions
// =============================================================================

describe('Orders API - Transactions', () => {
  describe('list transactions', () => {
    it('should list all transactions for an order', async () => {
      const mockTransactions: Transaction[] = [
        {
          id: 10001,
          order_id: 1001,
          kind: 'sale',
          amount: '199.99',
          status: 'success',
          gateway: 'shopify_payments',
          created_at: '2024-01-15T10:00:00Z',
          test: false,
        },
      ]

      const mockFetch = createMockFetch([{ status: 200, body: { transactions: mockTransactions } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.transactions.list(1001)

      expect(result.body.transactions).toHaveLength(1)
      expect(result.body.transactions[0].kind).toBe('sale')
    })

    it('should filter transactions by since_id', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { transactions: [] } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.transactions.list(1001, { since_id: 10000 })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('since_id=10000'),
        expect.any(Object)
      )
    })
  })

  describe('get transaction', () => {
    it('should get a single transaction', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: {
          transaction: {
            id: 10001,
            order_id: 1001,
            kind: 'capture',
            amount: '199.99',
            status: 'success',
            authorization: 'AUTH123',
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.transactions.get(1001, 10001)

      expect(result.body.transaction.id).toBe(10001)
      expect(result.body.transaction.authorization).toBe('AUTH123')
    })
  })

  describe('create transaction', () => {
    it('should create a capture transaction', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: {
          transaction: {
            id: 10002,
            order_id: 1001,
            kind: 'capture',
            amount: '199.99',
            status: 'success',
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.transactions.create(1001, {
        kind: 'capture',
        amount: '199.99',
      })

      expect(result.body.transaction.kind).toBe('capture')
    })

    it('should create an authorization transaction', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: {
          transaction: {
            id: 10003,
            kind: 'authorization',
            status: 'success',
            authorization: 'AUTH456',
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.transactions.create(1001, {
        kind: 'authorization',
        amount: '199.99',
        authorization: 'AUTH456',
      })

      expect(result.body.transaction.kind).toBe('authorization')
    })

    it('should create a void transaction', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: {
          transaction: {
            id: 10004,
            kind: 'void',
            status: 'success',
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.transactions.create(1001, { kind: 'void' })

      expect(result.body.transaction.kind).toBe('void')
    })

    it('should create a refund transaction', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: {
          transaction: {
            id: 10005,
            kind: 'refund',
            amount: '50.00',
            status: 'success',
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.transactions.create(1001, {
        kind: 'refund',
        amount: '50.00',
      })

      expect(result.body.transaction.kind).toBe('refund')
    })

    it('should create transaction with specific gateway', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: { transaction: { id: 10006, gateway: 'manual' } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.transactions.create(1001, {
        kind: 'sale',
        amount: '100.00',
        gateway: 'manual',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('manual'),
        })
      )
    })

    it('should fail with invalid transaction kind', async () => {
      const mockFetch = createMockFetch([{
        status: 422,
        body: { errors: { kind: ['is invalid'] } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await expect(
        orders.transactions.create(1001, { kind: 'invalid' as any })
      ).rejects.toThrow()
    })

    it('should fail to capture more than authorized', async () => {
      const mockFetch = createMockFetch([{
        status: 422,
        body: { errors: 'Capture amount exceeds authorization' },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await expect(
        orders.transactions.create(1001, { kind: 'capture', amount: '999999.99' })
      ).rejects.toThrow()
    })
  })

  describe('count transactions', () => {
    it('should count transactions for an order', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { count: 5 } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.transactions.count(1001)

      expect(result.body.count).toBe(5)
    })
  })
})

// =============================================================================
// Order Risks (RED - OrderRisksResource not yet implemented)
// =============================================================================

describe('Orders API - Order Risks', () => {
  describe('OrderRisksResource (RED - not implemented)', () => {
    it('should have risks sub-resource on OrdersResource', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { risks: [] } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      // RED: OrdersResource should have a 'risks' sub-resource like fulfillments/refunds/transactions
      expect(orders).toHaveProperty('risks')
      expect(orders.risks).toBeDefined()
    })

    it('should list risks via dedicated resource', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: {
          risks: [
            {
              id: 11001,
              order_id: 1001,
              recommendation: 'cancel',
              score: 1.0,
              source: 'External',
              cause_cancel: true,
              message: 'High fraud risk detected',
              display: true,
            },
          ],
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      // RED: Should be able to call orders.risks.list(orderId)
      const result = await orders.risks.list(1001)

      expect(result.body.risks).toHaveLength(1)
      expect(result.body.risks[0].recommendation).toBe('cancel')
    })

    it('should get a single risk via dedicated resource', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: {
          risk: {
            id: 11001,
            order_id: 1001,
            recommendation: 'investigate',
            score: 0.7,
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      // RED: Should be able to call orders.risks.get(orderId, riskId)
      const result = await orders.risks.get(1001, 11001)

      expect(result.body.risk.id).toBe(11001)
    })

    it('should create risk via dedicated resource', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: {
          risk: {
            id: 11002,
            order_id: 1001,
            recommendation: 'investigate',
            score: 0.8,
            source: 'Custom App',
            message: 'Unusual purchase pattern',
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      // RED: Should be able to call orders.risks.create(orderId, input)
      const result = await orders.risks.create(1001, {
        recommendation: 'investigate',
        score: 0.8,
        source: 'Custom App',
        message: 'Unusual purchase pattern',
      })

      expect(result.body.risk.recommendation).toBe('investigate')
    })

    it('should update risk via dedicated resource', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: {
          risk: {
            id: 11001,
            recommendation: 'accept',
            message: 'Verified by customer service',
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      // RED: Should be able to call orders.risks.update(orderId, riskId, input)
      const result = await orders.risks.update(1001, 11001, {
        recommendation: 'accept',
        message: 'Verified by customer service',
      })

      expect(result.body.risk.recommendation).toBe('accept')
    })

    it('should delete risk via dedicated resource', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: {} }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      // RED: Should be able to call orders.risks.delete(orderId, riskId)
      await orders.risks.delete(1001, 11001)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('risks/11001'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  describe('risk recommendations', () => {
    it('should create risk with cancel recommendation and cause_cancel', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: {
          risk: {
            id: 11003,
            recommendation: 'cancel',
            cause_cancel: true,
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      // RED: Uses risks sub-resource
      const result = await orders.risks.create(1001, {
        recommendation: 'cancel',
        score: 1.0,
        source: 'Fraud Detection',
        message: 'Known fraudster',
        cause_cancel: true,
      })

      expect(result.body.risk.cause_cancel).toBe(true)
    })

    it('should create risk with accept recommendation', async () => {
      const mockFetch = createMockFetch([{
        status: 201,
        body: {
          risk: {
            id: 11004,
            recommendation: 'accept',
            score: 0.1,
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      // RED: Uses risks sub-resource
      const result = await orders.risks.create(1001, {
        recommendation: 'accept',
        score: 0.1,
        source: 'Trusted Customer',
        message: 'VIP customer with good history',
      })

      expect(result.body.risk.recommendation).toBe('accept')
    })
  })
})

// =============================================================================
// Pagination and Filtering
// =============================================================================

describe('Orders API - Pagination and Filtering', () => {
  describe('cursor-based pagination', () => {
    it('should return Link header for pagination', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: { orders: [{ id: 1001 }, { id: 1002 }] },
        headers: {
          'Link': '<https://test-shop.myshopify.com/admin/api/2024-10/orders.json?page_info=abc123>; rel="next"',
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.list({ limit: 2 })

      expect(result.headers.get('Link')).toContain('page_info')
    })

    it('should fetch next page using page_info', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: { orders: [{ id: 1003 }, { id: 1004 }] },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })

      // Direct REST call with page_info (orders resource doesn't expose this directly)
      await client.get({ path: 'orders', query: { page_info: 'abc123' } })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('page_info=abc123'),
        expect.any(Object)
      )
    })
  })

  describe('multiple filters', () => {
    it('should combine multiple filters', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { orders: [] } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.list({
        status: 'open',
        financial_status: 'paid',
        fulfillment_status: 'unfulfilled',
        limit: 10,
      })

      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('status=open')
      expect(url).toContain('financial_status=paid')
      expect(url).toContain('fulfillment_status=unfulfilled')
      expect(url).toContain('limit=10')
    })

    it('should filter by multiple IDs', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { orders: [] } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.list({ ids: '1001,1002,1003' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('ids='),
        expect.any(Object)
      )
    })

    it('should filter by attribution_app_id', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { orders: [] } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.list({ attribution_app_id: 'app123' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('attribution_app_id=app123'),
        expect.any(Object)
      )
    })
  })

  describe('field selection', () => {
    it('should select specific fields in list', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: { orders: [{ id: 1001, name: '#1001', total_price: '99.99' }] },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.list({ fields: 'id,name,total_price' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('fields='),
        expect.any(Object)
      )
    })
  })

  describe('date range filtering', () => {
    it('should filter by processed_at range', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { orders: [] } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.list({
        processed_at_min: '2024-01-01T00:00:00Z',
        processed_at_max: '2024-01-31T23:59:59Z',
      })

      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('processed_at_min')
      expect(url).toContain('processed_at_max')
    })

    it('should filter by updated_at range', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { orders: [] } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await orders.list({
        updated_at_min: '2024-01-15T00:00:00Z',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('updated_at_min'),
        expect.any(Object)
      )
    })
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe('Orders API - Edge Cases', () => {
  describe('rate limiting', () => {
    it('should handle 429 rate limit response', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({ 'Retry-After': '2' }),
          json: async () => ({ errors: 'Throttled' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ orders: [] }),
        })

      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.list()

      expect(result.body.orders).toEqual([])
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('empty responses', () => {
    it('should handle empty orders list', async () => {
      const mockFetch = createMockFetch([{ status: 200, body: { orders: [] } }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.list()

      expect(result.body.orders).toEqual([])
    })

    it('should handle order with no line items gracefully', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: { order: { id: 1001, line_items: [] } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.get(1001)

      expect(result.body.order.line_items).toEqual([])
    })
  })

  describe('special characters', () => {
    it('should handle order with special characters in note', async () => {
      const noteWithSpecialChars = 'Customer note: "Handle with care!" & check <tags>'
      const mockFetch = createMockFetch([{
        status: 200,
        body: { order: { id: 1001, note: noteWithSpecialChars } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.get(1001)

      expect(result.body.order.note).toBe(noteWithSpecialChars)
    })

    it('should handle unicode in customer names', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: {
          order: {
            id: 1001,
            shipping_address: { first_name: 'Jürgen', last_name: 'Müller' },
          },
        },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.get(1001)

      expect(result.body.order.shipping_address?.first_name).toBe('Jürgen')
    })
  })

  describe('large orders', () => {
    it('should handle order with many line items', async () => {
      const lineItems = Array.from({ length: 100 }, (_, i) => ({
        id: 2000 + i,
        title: `Product ${i}`,
        quantity: 1,
        price: '10.00',
      }))

      const mockFetch = createMockFetch([{
        status: 200,
        body: { order: { id: 1001, line_items: lineItems } },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const result = await orders.get(1001)

      expect(result.body.order.line_items).toHaveLength(100)
    })
  })

  describe('concurrent operations', () => {
    it('should handle concurrent order fetches', async () => {
      const mockFetch = createMockFetch([
        { status: 200, body: { order: { id: 1001 } } },
        { status: 200, body: { order: { id: 1002 } } },
        { status: 200, body: { order: { id: 1003 } } },
      ])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      const results = await Promise.all([
        orders.get(1001),
        orders.get(1002),
        orders.get(1003),
      ])

      expect(results).toHaveLength(3)
    })
  })

  describe('error handling', () => {
    it('should handle network timeout', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network timeout'))
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await expect(orders.list()).rejects.toThrow('Network timeout')
    })

    it('should handle malformed JSON response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => {
          throw new SyntaxError('Unexpected token')
        },
      })
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await expect(orders.list()).rejects.toThrow()
    })

    it('should handle 500 server error', async () => {
      const mockFetch = createMockFetch([{
        status: 500,
        body: { errors: 'Internal Server Error' },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await expect(orders.list()).rejects.toThrow()
    })

    it('should handle 503 service unavailable', async () => {
      const mockFetch = createMockFetch([{
        status: 503,
        body: { errors: 'Service Unavailable' },
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })
      const orders = new OrdersResource(client as any)

      await expect(orders.list()).rejects.toThrow()
    })
  })

  describe('idempotency', () => {
    it('should handle duplicate order creation with idempotency key', async () => {
      const mockFetch = createMockFetch([{
        status: 200,
        body: { order: { id: 1001 } }, // Returns existing order instead of creating new
      }])
      const shopify = createShopifyClient(mockFetch)
      const client = new shopify.clients.Rest({ session: mockSession })

      await client.post({
        path: 'orders',
        data: { order: { line_items: [{ title: 'Test', quantity: 1 }] } },
        extraHeaders: { 'Idempotency-Key': 'unique-key-123' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Idempotency-Key': 'unique-key-123',
          }),
        })
      )
    })
  })
})
