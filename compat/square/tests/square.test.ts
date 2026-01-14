/**
 * @dotdo/square - Square Compatibility Layer Tests
 *
 * Tests for the Square API compatibility layer including:
 * - Payment operations (create, complete, cancel, refund)
 * - Customer management (CRUD, search)
 * - Catalog management (items, categories, modifiers)
 * - Order operations
 * - Location management
 * - Inventory tracking
 * - Webhook signature verification
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Square,
  SquareAPIError,
  Webhooks,
  type Customer,
  type Payment,
  type Refund,
  type CatalogObject,
  type Order,
  type Location,
  type InventoryCount,
  type SquareError,
} from '../index'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockFetch(responses: Map<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const urlObj = new URL(url)
    const method = options?.method ?? 'GET'
    const key = `${method} ${urlObj.pathname}`

    const mockResponse = responses.get(key)
    if (!mockResponse) {
      return {
        ok: false,
        status: 404,
        headers: new Headers({ 'x-request-id': 'req_mock' }),
        json: async () => ({
          errors: [{ category: 'INVALID_REQUEST_ERROR', code: 'NOT_FOUND', detail: `No mock for ${key}` }],
        }),
      }
    }

    return {
      ok: mockResponse.status >= 200 && mockResponse.status < 300,
      status: mockResponse.status,
      headers: new Headers({ 'x-request-id': 'req_mock' }),
      json: async () => mockResponse.body,
    }
  })
}

function mockLocation(overrides: Partial<Location> = {}): Location {
  return {
    id: 'L1234567890',
    name: 'Test Location',
    address: {
      address_line_1: '123 Main St',
      locality: 'San Francisco',
      administrative_district_level_1: 'CA',
      postal_code: '94102',
      country: 'US',
    },
    timezone: 'America/Los_Angeles',
    capabilities: ['CREDIT_CARD_PROCESSING'],
    status: 'ACTIVE',
    created_at: '2024-01-01T00:00:00Z',
    merchant_id: 'M1234567890',
    country: 'US',
    currency: 'USD',
    ...overrides,
  }
}

function mockCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'CUST123456789',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    given_name: 'John',
    family_name: 'Doe',
    email_address: 'john@example.com',
    phone_number: '+15555551234',
    version: 1,
    ...overrides,
  }
}

function mockPayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'PAY123456789',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    amount_money: { amount: 1000, currency: 'USD' },
    total_money: { amount: 1000, currency: 'USD' },
    status: 'COMPLETED',
    source_type: 'CARD',
    location_id: 'L1234567890',
    ...overrides,
  }
}

function mockRefund(overrides: Partial<Refund> = {}): Refund {
  return {
    id: 'REF123456789',
    status: 'APPROVED',
    amount_money: { amount: 500, currency: 'USD' },
    payment_id: 'PAY123456789',
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function mockCatalogItem(overrides: Partial<CatalogObject> = {}): CatalogObject {
  return {
    type: 'ITEM',
    id: 'ITEM123456789',
    updated_at: '2024-01-01T00:00:00Z',
    version: 1,
    is_deleted: false,
    present_at_all_locations: true,
    item_data: {
      name: 'Test Item',
      description: 'A test item',
      variations: [
        {
          type: 'ITEM_VARIATION',
          id: 'VAR123456789',
          item_variation_data: {
            item_id: 'ITEM123456789',
            name: 'Regular',
            pricing_type: 'FIXED_PRICING',
            price_money: { amount: 500, currency: 'USD' },
          },
        },
      ],
    },
    ...overrides,
  }
}

function mockOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ORD123456789',
    location_id: 'L1234567890',
    state: 'OPEN',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    version: 1,
    line_items: [
      {
        uid: 'LI123',
        name: 'Test Item',
        quantity: '1',
        base_price_money: { amount: 1000, currency: 'USD' },
        total_money: { amount: 1000, currency: 'USD' },
      },
    ],
    total_money: { amount: 1000, currency: 'USD' },
    ...overrides,
  }
}

function mockInventoryCount(overrides: Partial<InventoryCount> = {}): InventoryCount {
  return {
    catalog_object_id: 'VAR123456789',
    catalog_object_type: 'ITEM_VARIATION',
    state: 'IN_STOCK',
    location_id: 'L1234567890',
    quantity: '100',
    calculated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// =============================================================================
// Square Client Tests
// =============================================================================

describe('@dotdo/square - Square Client', () => {
  describe('initialization', () => {
    it('should create a Square instance with access token', () => {
      const square = new Square('sq0atp-xxx')
      expect(square).toBeDefined()
      expect(square.locations).toBeDefined()
      expect(square.customers).toBeDefined()
      expect(square.payments).toBeDefined()
      expect(square.refunds).toBeDefined()
      expect(square.catalog).toBeDefined()
      expect(square.orders).toBeDefined()
      expect(square.inventory).toBeDefined()
    })

    it('should throw error without access token', () => {
      expect(() => new Square('')).toThrow('Square access token is required')
    })

    it('should accept configuration options', () => {
      const square = new Square('sq0atp-xxx', {
        environment: 'production',
        timeout: 30000,
        maxNetworkRetries: 3,
      })
      expect(square).toBeDefined()
    })

    it('should use sandbox environment by default', () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ locations: [] }),
      })

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      square.locations.list()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('squareupsandbox.com'),
        expect.anything()
      )
    })

    it('should use production environment when specified', () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ locations: [] }),
      })

      const square = new Square('sq0atp-xxx', { environment: 'production', fetch: mockFetch })
      square.locations.list()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('connect.squareup.com'),
        expect.anything()
      )
    })
  })

  describe('error handling', () => {
    it('should throw SquareAPIError on API errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/customers/CUST_NOT_FOUND',
            {
              status: 404,
              body: {
                errors: [
                  {
                    category: 'INVALID_REQUEST_ERROR',
                    code: 'NOT_FOUND',
                    detail: 'Customer not found',
                  },
                ],
              },
            },
          ],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })

      await expect(square.customers.retrieve('CUST_NOT_FOUND')).rejects.toThrow(SquareAPIError)

      try {
        await square.customers.retrieve('CUST_NOT_FOUND')
      } catch (error) {
        expect(error).toBeInstanceOf(SquareAPIError)
        const sqError = error as SquareAPIError
        expect(sqError.errors[0].code).toBe('NOT_FOUND')
        expect(sqError.statusCode).toBe(404)
      }
    })

    it('should include request ID in errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET /v2/customers/CUST_NOT_FOUND',
            {
              status: 404,
              body: {
                errors: [{ category: 'INVALID_REQUEST_ERROR', code: 'NOT_FOUND' }],
              },
            },
          ],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })

      try {
        await square.customers.retrieve('CUST_NOT_FOUND')
      } catch (error) {
        expect((error as SquareAPIError).requestId).toBe('req_mock')
      }
    })
  })
})

// =============================================================================
// Locations Resource Tests
// =============================================================================

describe('@dotdo/square - Locations', () => {
  describe('list', () => {
    it('should list all locations', async () => {
      const expectedLocations = [mockLocation(), mockLocation({ id: 'L2', name: 'Second Location' })]
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v2/locations', { status: 200, body: { locations: expectedLocations } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.locations.list()

      expect(result.locations).toHaveLength(2)
      expect(result.locations![0].id).toBe('L1234567890')
    })
  })

  describe('retrieve', () => {
    it('should retrieve a location by ID', async () => {
      const expectedLocation = mockLocation()
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v2/locations/L1234567890', { status: 200, body: { location: expectedLocation } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.locations.retrieve('L1234567890')

      expect(result.location?.id).toBe('L1234567890')
      expect(result.location?.status).toBe('ACTIVE')
    })
  })

  describe('create', () => {
    it('should create a new location', async () => {
      const expectedLocation = mockLocation()
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/locations', { status: 200, body: { location: expectedLocation } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.locations.create({ name: 'Test Location' })

      expect(result.location?.id).toBe('L1234567890')
    })
  })

  describe('update', () => {
    it('should update a location', async () => {
      const updatedLocation = mockLocation({ name: 'Updated Location' })
      const mockFetch = createMockFetch(
        new Map([
          ['PUT /v2/locations/L1234567890', { status: 200, body: { location: updatedLocation } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.locations.update('L1234567890', { name: 'Updated Location' })

      expect(result.location?.name).toBe('Updated Location')
    })
  })
})

// =============================================================================
// Customers Resource Tests
// =============================================================================

describe('@dotdo/square - Customers', () => {
  describe('create', () => {
    it('should create a customer', async () => {
      const expectedCustomer = mockCustomer()
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/customers', { status: 200, body: { customer: expectedCustomer } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.customers.create({
        given_name: 'John',
        family_name: 'Doe',
        email_address: 'john@example.com',
      })

      expect(result.customer?.id).toBe('CUST123456789')
      expect(result.customer?.email_address).toBe('john@example.com')
    })

    it('should create a customer with address', async () => {
      const expectedCustomer = mockCustomer({
        address: {
          address_line_1: '123 Main St',
          locality: 'San Francisco',
          postal_code: '94102',
          country: 'US',
        },
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/customers', { status: 200, body: { customer: expectedCustomer } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.customers.create({
        given_name: 'John',
        address: {
          address_line_1: '123 Main St',
          locality: 'San Francisco',
          postal_code: '94102',
          country: 'US',
        },
      })

      expect(result.customer?.address?.address_line_1).toBe('123 Main St')
    })
  })

  describe('retrieve', () => {
    it('should retrieve a customer by ID', async () => {
      const expectedCustomer = mockCustomer()
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v2/customers/CUST123456789', { status: 200, body: { customer: expectedCustomer } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.customers.retrieve('CUST123456789')

      expect(result.customer?.id).toBe('CUST123456789')
    })
  })

  describe('update', () => {
    it('should update a customer', async () => {
      const updatedCustomer = mockCustomer({ family_name: 'Smith' })
      const mockFetch = createMockFetch(
        new Map([
          ['PUT /v2/customers/CUST123456789', { status: 200, body: { customer: updatedCustomer } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.customers.update('CUST123456789', { family_name: 'Smith' })

      expect(result.customer?.family_name).toBe('Smith')
    })
  })

  describe('delete', () => {
    it('should delete a customer', async () => {
      const mockFetch = createMockFetch(
        new Map([
          ['DELETE /v2/customers/CUST123456789', { status: 200, body: {} }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.customers.delete('CUST123456789')

      expect(result.errors).toBeUndefined()
    })
  })

  describe('list', () => {
    it('should list customers', async () => {
      const customers = [mockCustomer(), mockCustomer({ id: 'CUST2' })]
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v2/customers', { status: 200, body: { customers, cursor: 'next_cursor' } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.customers.list()

      expect(result.customers).toHaveLength(2)
      expect(result.cursor).toBe('next_cursor')
    })

    it('should support pagination parameters', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ customers: [mockCustomer()] }),
      })

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      await square.customers.list({ limit: 10, sort_field: 'CREATED_AT', sort_order: 'DESC' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.anything()
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('sort_field=CREATED_AT'),
        expect.anything()
      )
    })
  })

  describe('search', () => {
    it('should search customers by email', async () => {
      const customers = [mockCustomer()]
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/customers/search', { status: 200, body: { customers } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.customers.search({
        query: {
          filter: {
            email_address: { exact: 'john@example.com' },
          },
        },
      })

      expect(result.customers).toHaveLength(1)
    })

    it('should search customers by phone', async () => {
      const customers = [mockCustomer()]
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/customers/search', { status: 200, body: { customers } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.customers.search({
        query: {
          filter: {
            phone_number: { fuzzy: '555' },
          },
        },
      })

      expect(result.customers).toHaveLength(1)
    })
  })
})

// =============================================================================
// Payments Resource Tests
// =============================================================================

describe('@dotdo/square - Payments', () => {
  describe('create', () => {
    it('should create a payment', async () => {
      const expectedPayment = mockPayment()
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/payments', { status: 200, body: { payment: expectedPayment } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.payments.create({
        source_id: 'cnon:card-nonce-ok',
        idempotency_key: 'unique-key-123',
        amount_money: { amount: 1000, currency: 'USD' },
      })

      expect(result.payment?.id).toBe('PAY123456789')
      expect(result.payment?.status).toBe('COMPLETED')
    })

    it('should create a payment with autocomplete false', async () => {
      const expectedPayment = mockPayment({ status: 'APPROVED' })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/payments', { status: 200, body: { payment: expectedPayment } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.payments.create({
        source_id: 'cnon:card-nonce-ok',
        idempotency_key: 'unique-key-123',
        amount_money: { amount: 1000, currency: 'USD' },
        autocomplete: false,
      })

      expect(result.payment?.status).toBe('APPROVED')
    })

    it('should create a payment with tip', async () => {
      const expectedPayment = mockPayment({
        tip_money: { amount: 200, currency: 'USD' },
        total_money: { amount: 1200, currency: 'USD' },
      })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/payments', { status: 200, body: { payment: expectedPayment } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.payments.create({
        source_id: 'cnon:card-nonce-ok',
        idempotency_key: 'unique-key-123',
        amount_money: { amount: 1000, currency: 'USD' },
        tip_money: { amount: 200, currency: 'USD' },
      })

      expect(result.payment?.tip_money?.amount).toBe(200)
      expect(result.payment?.total_money?.amount).toBe(1200)
    })

    it('should create a payment with customer ID', async () => {
      const expectedPayment = mockPayment({ customer_id: 'CUST123' })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/payments', { status: 200, body: { payment: expectedPayment } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.payments.create({
        source_id: 'cnon:card-nonce-ok',
        idempotency_key: 'unique-key-123',
        amount_money: { amount: 1000, currency: 'USD' },
        customer_id: 'CUST123',
      })

      expect(result.payment?.customer_id).toBe('CUST123')
    })
  })

  describe('retrieve', () => {
    it('should retrieve a payment by ID', async () => {
      const expectedPayment = mockPayment()
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v2/payments/PAY123456789', { status: 200, body: { payment: expectedPayment } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.payments.retrieve('PAY123456789')

      expect(result.payment?.id).toBe('PAY123456789')
    })
  })

  describe('update', () => {
    it('should update a payment amount', async () => {
      const updatedPayment = mockPayment({ amount_money: { amount: 1500, currency: 'USD' } })
      const mockFetch = createMockFetch(
        new Map([
          ['PUT /v2/payments/PAY123456789', { status: 200, body: { payment: updatedPayment } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.payments.update('PAY123456789', {
        idempotency_key: 'update-key',
        payment: { amount_money: { amount: 1500, currency: 'USD' } },
      })

      expect(result.payment?.amount_money?.amount).toBe(1500)
    })
  })

  describe('complete', () => {
    it('should complete an authorized payment', async () => {
      const completedPayment = mockPayment({ status: 'COMPLETED' })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/payments/PAY123456789/complete', { status: 200, body: { payment: completedPayment } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.payments.complete('PAY123456789')

      expect(result.payment?.status).toBe('COMPLETED')
    })
  })

  describe('cancel', () => {
    it('should cancel a payment', async () => {
      const canceledPayment = mockPayment({ status: 'CANCELED' })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/payments/PAY123456789/cancel', { status: 200, body: { payment: canceledPayment } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.payments.cancel('PAY123456789')

      expect(result.payment?.status).toBe('CANCELED')
    })
  })

  describe('list', () => {
    it('should list payments', async () => {
      const payments = [mockPayment(), mockPayment({ id: 'PAY2' })]
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v2/payments', { status: 200, body: { payments } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.payments.list()

      expect(result.payments).toHaveLength(2)
    })

    it('should filter payments by date range', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ payments: [mockPayment()] }),
      })

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      await square.payments.list({
        begin_time: '2024-01-01T00:00:00Z',
        end_time: '2024-01-31T23:59:59Z',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('begin_time='),
        expect.anything()
      )
    })

    it('should filter payments by card brand', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ payments: [mockPayment()] }),
      })

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      await square.payments.list({ card_brand: 'VISA' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('card_brand=VISA'),
        expect.anything()
      )
    })
  })
})

// =============================================================================
// Refunds Resource Tests
// =============================================================================

describe('@dotdo/square - Refunds', () => {
  describe('refundPayment', () => {
    it('should refund a payment', async () => {
      const expectedRefund = mockRefund()
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/refunds', { status: 200, body: { refund: expectedRefund } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.refunds.refundPayment({
        idempotency_key: 'refund-key-123',
        payment_id: 'PAY123456789',
        amount_money: { amount: 500, currency: 'USD' },
      })

      expect(result.refund?.id).toBe('REF123456789')
      expect(result.refund?.status).toBe('APPROVED')
    })

    it('should refund with reason', async () => {
      const expectedRefund = mockRefund({ reason: 'Customer request' })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/refunds', { status: 200, body: { refund: expectedRefund } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.refunds.refundPayment({
        idempotency_key: 'refund-key-123',
        payment_id: 'PAY123456789',
        amount_money: { amount: 500, currency: 'USD' },
        reason: 'Customer request',
      })

      expect(result.refund?.reason).toBe('Customer request')
    })
  })

  describe('retrieve', () => {
    it('should retrieve a refund by ID', async () => {
      const expectedRefund = mockRefund()
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v2/refunds/REF123456789', { status: 200, body: { refund: expectedRefund } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.refunds.retrieve('REF123456789')

      expect(result.refund?.id).toBe('REF123456789')
    })
  })

  describe('list', () => {
    it('should list refunds', async () => {
      const refunds = [mockRefund(), mockRefund({ id: 'REF2' })]
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v2/refunds', { status: 200, body: { refunds } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.refunds.list()

      expect(result.refunds).toHaveLength(2)
    })

    it('should filter refunds by status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ refunds: [mockRefund()] }),
      })

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      await square.refunds.list({ status: 'APPROVED' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=APPROVED'),
        expect.anything()
      )
    })
  })
})

// =============================================================================
// Catalog Resource Tests
// =============================================================================

describe('@dotdo/square - Catalog', () => {
  describe('list', () => {
    it('should list catalog objects', async () => {
      const objects = [mockCatalogItem(), mockCatalogItem({ id: 'ITEM2' })]
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v2/catalog/list', { status: 200, body: { objects } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.catalog.list()

      expect(result.objects).toHaveLength(2)
    })

    it('should filter by type', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ objects: [mockCatalogItem()] }),
      })

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      await square.catalog.list({ types: ['ITEM', 'CATEGORY'] })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('types=ITEM%2CCATEGORY'),
        expect.anything()
      )
    })
  })

  describe('retrieve', () => {
    it('should retrieve a catalog object', async () => {
      const expectedItem = mockCatalogItem()
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v2/catalog/object/ITEM123456789', { status: 200, body: { object: expectedItem } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.catalog.retrieve('ITEM123456789')

      expect(result.object?.id).toBe('ITEM123456789')
    })

    it('should include related objects', async () => {
      const expectedItem = mockCatalogItem()
      const relatedObjects = [{ type: 'CATEGORY' as const, id: 'CAT1', category_data: { name: 'Category' } }]
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v2/catalog/object/ITEM123456789', { status: 200, body: { object: expectedItem, related_objects: relatedObjects } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.catalog.retrieve('ITEM123456789', { include_related_objects: true })

      expect(result.related_objects).toHaveLength(1)
    })
  })

  describe('upsert', () => {
    it('should upsert a catalog object', async () => {
      const expectedItem = mockCatalogItem()
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/catalog/object', { status: 200, body: { catalog_object: expectedItem } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.catalog.upsert({
        idempotency_key: 'upsert-key-123',
        object: {
          type: 'ITEM',
          id: '#new-item',
          item_data: { name: 'New Item' },
        },
      })

      expect(result.catalog_object?.id).toBe('ITEM123456789')
    })
  })

  describe('delete', () => {
    it('should delete a catalog object', async () => {
      const mockFetch = createMockFetch(
        new Map([
          ['DELETE /v2/catalog/object/ITEM123456789', { status: 200, body: { deleted_object_ids: ['ITEM123456789'] } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.catalog.delete('ITEM123456789')

      expect(result.deleted_object_ids).toContain('ITEM123456789')
    })
  })

  describe('batchUpsert', () => {
    it('should batch upsert catalog objects', async () => {
      const objects = [mockCatalogItem(), mockCatalogItem({ id: 'ITEM2' })]
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/catalog/batch-upsert', { status: 200, body: { objects } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.catalog.batchUpsert({
        idempotency_key: 'batch-key-123',
        batches: [
          {
            objects: [
              { type: 'ITEM', id: '#item1', item_data: { name: 'Item 1' } },
              { type: 'ITEM', id: '#item2', item_data: { name: 'Item 2' } },
            ],
          },
        ],
      })

      expect(result.objects).toHaveLength(2)
    })
  })

  describe('batchRetrieve', () => {
    it('should batch retrieve catalog objects', async () => {
      const objects = [mockCatalogItem(), mockCatalogItem({ id: 'ITEM2' })]
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/catalog/batch-retrieve', { status: 200, body: { objects } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.catalog.batchRetrieve({
        object_ids: ['ITEM123456789', 'ITEM2'],
      })

      expect(result.objects).toHaveLength(2)
    })
  })

  describe('batchDelete', () => {
    it('should batch delete catalog objects', async () => {
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/catalog/batch-delete', { status: 200, body: { deleted_object_ids: ['ITEM1', 'ITEM2'] } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.catalog.batchDelete({
        object_ids: ['ITEM1', 'ITEM2'],
      })

      expect(result.deleted_object_ids).toHaveLength(2)
    })
  })

  describe('search', () => {
    it('should search catalog objects', async () => {
      const objects = [mockCatalogItem()]
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/catalog/search', { status: 200, body: { objects } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.catalog.search({
        object_types: ['ITEM'],
        query: {
          text_query: { keywords: ['test'] },
        },
      })

      expect(result.objects).toHaveLength(1)
    })
  })

  describe('searchItems', () => {
    it('should search catalog items', async () => {
      const items = [mockCatalogItem()]
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/catalog/search-catalog-items', { status: 200, body: { items } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.catalog.searchItems({
        text_filter: 'coffee',
      })

      expect(result.items).toHaveLength(1)
    })
  })

  describe('info', () => {
    it('should get catalog info', async () => {
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v2/catalog/info', { status: 200, body: { limits: { batch_upsert_max_objects_per_batch: 1000 } } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.catalog.info()

      expect(result.limits?.batch_upsert_max_objects_per_batch).toBe(1000)
    })
  })
})

// =============================================================================
// Orders Resource Tests
// =============================================================================

describe('@dotdo/square - Orders', () => {
  describe('create', () => {
    it('should create an order', async () => {
      const expectedOrder = mockOrder()
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/orders', { status: 200, body: { order: expectedOrder } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.orders.create({
        order: {
          location_id: 'L1234567890',
          line_items: [
            { name: 'Test Item', quantity: '1', base_price_money: { amount: 1000, currency: 'USD' } },
          ],
        },
        idempotency_key: 'order-key-123',
      })

      expect(result.order?.id).toBe('ORD123456789')
    })
  })

  describe('retrieve', () => {
    it('should retrieve an order by ID', async () => {
      const expectedOrder = mockOrder()
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v2/orders/ORD123456789', { status: 200, body: { order: expectedOrder } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.orders.retrieve('ORD123456789')

      expect(result.order?.id).toBe('ORD123456789')
    })
  })

  describe('update', () => {
    it('should update an order', async () => {
      const updatedOrder = mockOrder({ state: 'COMPLETED' })
      const mockFetch = createMockFetch(
        new Map([
          ['PUT /v2/orders/ORD123456789', { status: 200, body: { order: updatedOrder } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.orders.update('ORD123456789', {
        order: { state: 'COMPLETED', location_id: 'L1234567890', version: 1 },
      })

      expect(result.order?.state).toBe('COMPLETED')
    })
  })

  describe('pay', () => {
    it('should pay for an order', async () => {
      const paidOrder = mockOrder({ state: 'COMPLETED' })
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/orders/ORD123456789/pay', { status: 200, body: { order: paidOrder } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.orders.pay('ORD123456789', {
        idempotency_key: 'pay-key-123',
        payment_ids: ['PAY123456789'],
      })

      expect(result.order?.state).toBe('COMPLETED')
    })
  })

  describe('search', () => {
    it('should search orders', async () => {
      const orders = [mockOrder(), mockOrder({ id: 'ORD2' })]
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/orders/search', { status: 200, body: { orders } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.orders.search({
        location_ids: ['L1234567890'],
      })

      expect(result.orders).toHaveLength(2)
    })

    it('should filter orders by state', async () => {
      const orders = [mockOrder()]
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/orders/search', { status: 200, body: { orders } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.orders.search({
        location_ids: ['L1234567890'],
        query: {
          filter: {
            state_filter: { states: ['OPEN'] },
          },
        },
      })

      expect(result.orders).toHaveLength(1)
    })
  })

  describe('batchRetrieve', () => {
    it('should batch retrieve orders', async () => {
      const orders = [mockOrder(), mockOrder({ id: 'ORD2' })]
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/orders/batch-retrieve', { status: 200, body: { orders } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.orders.batchRetrieve({
        order_ids: ['ORD123456789', 'ORD2'],
      })

      expect(result.orders).toHaveLength(2)
    })
  })
})

// =============================================================================
// Inventory Resource Tests
// =============================================================================

describe('@dotdo/square - Inventory', () => {
  describe('retrieve', () => {
    it('should retrieve inventory count', async () => {
      const counts = [mockInventoryCount()]
      const mockFetch = createMockFetch(
        new Map([
          ['GET /v2/inventory/VAR123456789', { status: 200, body: { counts } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.inventory.retrieve('VAR123456789')

      expect(result.counts).toHaveLength(1)
      expect(result.counts![0].quantity).toBe('100')
    })
  })

  describe('batchChange', () => {
    it('should batch change inventory', async () => {
      const counts = [mockInventoryCount({ quantity: '90' })]
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/inventory/changes/batch-create', { status: 200, body: { counts } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.inventory.batchChange({
        idempotency_key: 'inv-key-123',
        changes: [
          {
            type: 'ADJUSTMENT',
            adjustment: {
              catalog_object_id: 'VAR123456789',
              location_id: 'L1234567890',
              from_state: 'IN_STOCK',
              to_state: 'SOLD',
              quantity: '10',
            },
          },
        ],
      })

      expect(result.counts![0].quantity).toBe('90')
    })
  })

  describe('batchRetrieveCounts', () => {
    it('should batch retrieve inventory counts', async () => {
      const counts = [mockInventoryCount(), mockInventoryCount({ catalog_object_id: 'VAR2', quantity: '50' })]
      const mockFetch = createMockFetch(
        new Map([
          ['POST /v2/inventory/counts/batch-retrieve', { status: 200, body: { counts } }],
        ])
      )

      const square = new Square('sq0atp-xxx', { fetch: mockFetch })
      const result = await square.inventory.batchRetrieveCounts({
        catalog_object_ids: ['VAR123456789', 'VAR2'],
      })

      expect(result.counts).toHaveLength(2)
    })
  })
})

// =============================================================================
// Webhook Signature Verification Tests
// =============================================================================

describe('@dotdo/square - Webhooks', () => {
  const testSignatureKey = 'test_signature_key_12345'
  const testNotificationUrl = 'https://example.com/webhook'
  const testPayload = JSON.stringify({
    merchant_id: 'MERCHANT123',
    type: 'payment.completed',
    event_id: 'EVT123',
    created_at: '2024-01-01T00:00:00Z',
    data: {
      type: 'payment',
      id: 'PAY123',
      object: { id: 'PAY123', status: 'COMPLETED' },
    },
  })

  describe('verifySignature', () => {
    it('should verify a valid signature', async () => {
      // Create a valid signature
      const combinedPayload = testNotificationUrl + testPayload
      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(testSignatureKey),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(combinedPayload))
      const validSignature = btoa(String.fromCharCode(...new Uint8Array(sig)))

      const isValid = await Webhooks.verifySignature(
        testPayload,
        validSignature,
        testSignatureKey,
        testNotificationUrl
      )

      expect(isValid).toBe(true)
    })

    it('should reject an invalid signature', async () => {
      const isValid = await Webhooks.verifySignature(
        testPayload,
        'invalid_signature',
        testSignatureKey,
        testNotificationUrl
      )

      expect(isValid).toBe(false)
    })
  })

  describe('constructEvent', () => {
    it('should construct and verify a webhook event', async () => {
      // Create a valid signature
      const combinedPayload = testNotificationUrl + testPayload
      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(testSignatureKey),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(combinedPayload))
      const validSignature = btoa(String.fromCharCode(...new Uint8Array(sig)))

      const event = await Webhooks.constructEvent(
        testPayload,
        validSignature,
        testSignatureKey,
        testNotificationUrl
      )

      expect(event.merchant_id).toBe('MERCHANT123')
      expect(event.type).toBe('payment.completed')
      expect(event.data.id).toBe('PAY123')
    })

    it('should reject invalid signature', async () => {
      await expect(
        Webhooks.constructEvent(
          testPayload,
          'invalid_signature',
          testSignatureKey,
          testNotificationUrl
        )
      ).rejects.toThrow('Webhook signature verification failed')
    })

    it('should accept ArrayBuffer payload', async () => {
      const encoder = new TextEncoder()
      const payloadBuffer = encoder.encode(testPayload).buffer

      // Create a valid signature
      const combinedPayload = testNotificationUrl + testPayload
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(testSignatureKey),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(combinedPayload))
      const validSignature = btoa(String.fromCharCode(...new Uint8Array(sig)))

      const event = await Webhooks.constructEvent(
        payloadBuffer,
        validSignature,
        testSignatureKey,
        testNotificationUrl
      )

      expect(event.merchant_id).toBe('MERCHANT123')
    })
  })
})

// =============================================================================
// Request Options Tests
// =============================================================================

describe('@dotdo/square - Request Options', () => {
  it('should pass idempotency key header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ customer: mockCustomer() }),
    })

    const square = new Square('sq0atp-xxx', { fetch: mockFetch })
    await square.customers.create(
      { given_name: 'John' },
      { idempotencyKey: 'idem-key-123' }
    )

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': 'idem-key-123',
        }),
      })
    )
  })

  it('should include Square-Version header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ locations: [] }),
    })

    const square = new Square('sq0atp-xxx', { fetch: mockFetch, squareVersion: '2024-01-01' })
    await square.locations.list()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Square-Version': '2024-01-01',
        }),
      })
    )
  })
})
