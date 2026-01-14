/**
 * @dotdo/shopify - Checkout API Tests (TDD RED Phase)
 *
 * Comprehensive tests for Shopify Checkout API compatibility layer.
 * Following Shopify Storefront API and Admin API patterns for:
 * - Checkout creation
 * - Line item management (add, update, remove)
 * - Discount code application
 * - Shipping rate calculation
 * - Payment processing
 * - Checkout completion
 *
 * @see https://shopify.dev/docs/api/storefront/latest/objects/Checkout
 * @see https://shopify.dev/docs/api/admin-rest/latest/resources/checkout
 * @module @dotdo/shopify/tests/checkout
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  shopifyApi,
  LATEST_API_VERSION,
  type ShopifyConfig,
  type Session,
} from '../index'

// =============================================================================
// Test Types (Expected interfaces for Checkout API)
// =============================================================================

interface CheckoutLineItem {
  id: string
  variant_id: number
  quantity: number
  title: string
  variant_title: string | null
  sku: string | null
  price: string
  compare_at_price: string | null
  grams: number
  requires_shipping: boolean
  taxable: boolean
  line_price: string
  applied_discounts: AppliedDiscount[]
  properties: Record<string, string>[]
}

interface AppliedDiscount {
  title: string
  description: string | null
  value: string
  value_type: 'fixed_amount' | 'percentage'
  amount: string
  applicable: boolean
  non_applicable_reason?: string
}

interface ShippingRate {
  id: string
  title: string
  price: string
  handle: string
  phone_required: boolean
  delivery_range: {
    min: string | null
    max: string | null
  } | null
}

interface ShippingAddress {
  first_name: string
  last_name: string
  address1: string
  address2: string | null
  city: string
  province: string
  province_code: string
  country: string
  country_code: string
  zip: string
  phone: string | null
  company: string | null
}

interface BillingAddress extends ShippingAddress {}

interface Checkout {
  id: number
  token: string
  cart_token: string | null
  email: string | null
  buyer_accepts_marketing: boolean
  created_at: string
  updated_at: string
  note: string | null
  note_attributes: Record<string, string>[]
  currency: string
  presentment_currency: string
  completed_at: string | null
  closed_at: string | null
  gateway: string | null
  source_name: string
  total_price: string
  subtotal_price: string
  total_tax: string
  total_discounts: string
  total_weight: number
  total_line_items_price: string
  taxes_included: boolean
  line_items: CheckoutLineItem[]
  shipping_address: ShippingAddress | null
  billing_address: BillingAddress | null
  shipping_rate: ShippingRate | null
  shipping_line: {
    title: string
    price: string
    handle: string
  } | null
  discount_codes: { code: string; amount: string; type: string }[]
  applied_discounts: AppliedDiscount[]
  requires_shipping: boolean
  order_id: number | null
  order: { id: number; name: string } | null
  web_url: string
  payment_due: string
  payment_url: string | null
}

interface Payment {
  id: number
  unique_token: string
  payment_processing_error_message: string | null
  transaction: {
    id: number
    amount: string
    kind: 'authorization' | 'capture' | 'sale'
    status: 'success' | 'failure' | 'pending'
    gateway: string
    authorization: string | null
  } | null
  checkout: Checkout
  credit_card: {
    first_name: string
    last_name: string
    first_digits: string
    last_digits: string
    brand: string
    expiry_month: number
    expiry_year: number
  } | null
}

// =============================================================================
// Test Helpers
// =============================================================================

function createMockFetch(responses: Map<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const urlObj = new URL(url)
    const method = options?.method ?? 'GET'
    const key = `${method} ${urlObj.pathname}`

    // Check for exact match first
    let mockResponse = responses.get(key)

    // If no exact match, try pattern matching for resource IDs
    if (!mockResponse) {
      for (const [pattern, response] of responses.entries()) {
        const regexPattern = pattern
          .replace(/:\w+/g, '[^/]+')
          .replace(/\./g, '\\.')
        const regex = new RegExp(`^${regexPattern}$`)
        if (regex.test(key)) {
          mockResponse = response
          break
        }
      }
    }

    if (!mockResponse) {
      return {
        ok: false,
        status: 404,
        headers: new Headers({ 'x-request-id': 'req_mock' }),
        json: async () => ({
          errors: { base: [`No mock for ${key}`] },
        }),
        text: async () => JSON.stringify({ errors: { base: [`No mock for ${key}`] } }),
      }
    }

    return {
      ok: mockResponse.status >= 200 && mockResponse.status < 300,
      status: mockResponse.status,
      headers: new Headers({
        'x-request-id': 'req_mock',
        'x-shopify-shop-api-call-limit': '1/40',
      }),
      json: async () => mockResponse.body,
      text: async () => JSON.stringify(mockResponse.body),
    }
  })
}

function mockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'offline_myshop.myshopify.com',
    shop: 'myshop.myshopify.com',
    state: 'random-state',
    isOnline: false,
    accessToken: 'shpat_test_token',
    scope: 'read_checkouts,write_checkouts,read_orders,write_orders',
    ...overrides,
  }
}

function mockLineItem(overrides: Partial<CheckoutLineItem> = {}): CheckoutLineItem {
  return {
    id: 'line_item_1',
    variant_id: 9876543210,
    quantity: 1,
    title: 'Test Product',
    variant_title: 'Default Title',
    sku: 'TEST-SKU-001',
    price: '29.99',
    compare_at_price: '39.99',
    grams: 500,
    requires_shipping: true,
    taxable: true,
    line_price: '29.99',
    applied_discounts: [],
    properties: [],
    ...overrides,
  }
}

function mockShippingAddress(overrides: Partial<ShippingAddress> = {}): ShippingAddress {
  return {
    first_name: 'John',
    last_name: 'Doe',
    address1: '123 Main St',
    address2: null,
    city: 'New York',
    province: 'New York',
    province_code: 'NY',
    country: 'United States',
    country_code: 'US',
    zip: '10001',
    phone: '+1234567890',
    company: null,
    ...overrides,
  }
}

function mockShippingRate(overrides: Partial<ShippingRate> = {}): ShippingRate {
  return {
    id: 'shopify-Standard%20Shipping-5.99',
    title: 'Standard Shipping',
    price: '5.99',
    handle: 'shopify-Standard%20Shipping-5.99',
    phone_required: false,
    delivery_range: {
      min: '3-5 business days',
      max: '5-7 business days',
    },
    ...overrides,
  }
}

function mockCheckout(overrides: Partial<Checkout> = {}): Checkout {
  return {
    id: 1234567890,
    token: 'checkout_token_abc123',
    cart_token: 'cart_token_xyz789',
    email: null,
    buyer_accepts_marketing: false,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
    note: null,
    note_attributes: [],
    currency: 'USD',
    presentment_currency: 'USD',
    completed_at: null,
    closed_at: null,
    gateway: null,
    source_name: 'web',
    total_price: '35.98',
    subtotal_price: '29.99',
    total_tax: '0.00',
    total_discounts: '0.00',
    total_weight: 500,
    total_line_items_price: '29.99',
    taxes_included: false,
    line_items: [mockLineItem()],
    shipping_address: null,
    billing_address: null,
    shipping_rate: null,
    shipping_line: null,
    discount_codes: [],
    applied_discounts: [],
    requires_shipping: true,
    order_id: null,
    order: null,
    web_url: 'https://myshop.myshopify.com/checkouts/checkout_token_abc123',
    payment_due: '35.98',
    payment_url: null,
    ...overrides,
  }
}

function mockPayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 9999999999,
    unique_token: 'payment_unique_token_123',
    payment_processing_error_message: null,
    transaction: {
      id: 8888888888,
      amount: '35.98',
      kind: 'sale',
      status: 'success',
      gateway: 'shopify_payments',
      authorization: 'auth_123456',
    },
    checkout: mockCheckout(),
    credit_card: {
      first_name: 'John',
      last_name: 'Doe',
      first_digits: '424242',
      last_digits: '4242',
      brand: 'visa',
      expiry_month: 12,
      expiry_year: 2025,
    },
    ...overrides,
  }
}

// =============================================================================
// Checkout Creation Tests
// =============================================================================

describe('@dotdo/shopify - Checkout Creation', () => {
  describe('create checkout', () => {
    it('should create an empty checkout', async () => {
      const emptyCheckout = mockCheckout({ line_items: [] })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/checkouts.json`,
            {
              status: 201,
              body: { checkout: emptyCheckout },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'checkouts',
        data: { checkout: {} },
      })

      expect(response.body.checkout.id).toBeDefined()
      expect(response.body.checkout.token).toBeDefined()
      expect(response.body.checkout.web_url).toContain('checkouts')
    })

    it('should create checkout with line items', async () => {
      const checkoutWithItems = mockCheckout({
        line_items: [
          mockLineItem({ variant_id: 111, quantity: 2 }),
          mockLineItem({ id: 'line_item_2', variant_id: 222, quantity: 1, title: 'Another Product' }),
        ],
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/checkouts.json`,
            {
              status: 201,
              body: { checkout: checkoutWithItems },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'checkouts',
        data: {
          checkout: {
            line_items: [
              { variant_id: 111, quantity: 2 },
              { variant_id: 222, quantity: 1 },
            ],
          },
        },
      })

      expect(response.body.checkout.line_items).toHaveLength(2)
      expect(response.body.checkout.line_items[0].quantity).toBe(2)
    })

    it('should create checkout with email', async () => {
      const checkoutWithEmail = mockCheckout({ email: 'customer@example.com' })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/checkouts.json`,
            {
              status: 201,
              body: { checkout: checkoutWithEmail },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'checkouts',
        data: {
          checkout: {
            email: 'customer@example.com',
            line_items: [{ variant_id: 111, quantity: 1 }],
          },
        },
      })

      expect(response.body.checkout.email).toBe('customer@example.com')
    })

    it('should create checkout with shipping address', async () => {
      const checkoutWithAddress = mockCheckout({
        shipping_address: mockShippingAddress(),
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/checkouts.json`,
            {
              status: 201,
              body: { checkout: checkoutWithAddress },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'checkouts',
        data: {
          checkout: {
            line_items: [{ variant_id: 111, quantity: 1 }],
            shipping_address: {
              first_name: 'John',
              last_name: 'Doe',
              address1: '123 Main St',
              city: 'New York',
              province: 'NY',
              country: 'US',
              zip: '10001',
            },
          },
        },
      })

      expect(response.body.checkout.shipping_address).toBeDefined()
      expect(response.body.checkout.shipping_address.city).toBe('New York')
    })

    it('should create checkout with note', async () => {
      const checkoutWithNote = mockCheckout({
        note: 'Please gift wrap this order',
        note_attributes: [{ name: 'gift_message', value: 'Happy Birthday!' }],
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/checkouts.json`,
            {
              status: 201,
              body: { checkout: checkoutWithNote },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'checkouts',
        data: {
          checkout: {
            line_items: [{ variant_id: 111, quantity: 1 }],
            note: 'Please gift wrap this order',
            note_attributes: [{ name: 'gift_message', value: 'Happy Birthday!' }],
          },
        },
      })

      expect(response.body.checkout.note).toBe('Please gift wrap this order')
    })

    it('should handle invalid variant error', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/checkouts.json`,
            {
              status: 422,
              body: {
                errors: {
                  line_items: ['Variant 999999 is not available for purchase'],
                },
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })

      await expect(
        client.post({
          path: 'checkouts',
          data: {
            checkout: {
              line_items: [{ variant_id: 999999, quantity: 1 }],
            },
          },
        })
      ).rejects.toThrow()
    })
  })

  describe('get checkout', () => {
    it('should retrieve a checkout by token', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: mockCheckout() },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({ path: 'checkouts/checkout_token_abc123' })

      expect(response.body.checkout.token).toBe('checkout_token_abc123')
    })

    it('should handle checkout not found', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/checkouts/nonexistent_token.json`,
            {
              status: 404,
              body: { errors: 'Not Found' },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })

      await expect(client.get({ path: 'checkouts/nonexistent_token' })).rejects.toThrow()
    })
  })
})

// =============================================================================
// Line Item Management Tests
// =============================================================================

describe('@dotdo/shopify - Checkout Line Items', () => {
  describe('add line items', () => {
    it('should add a single line item to checkout', async () => {
      const updatedCheckout = mockCheckout({
        line_items: [
          mockLineItem(),
          mockLineItem({ id: 'line_item_2', variant_id: 222, title: 'New Product' }),
        ],
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: updatedCheckout },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            line_items: [
              { variant_id: 9876543210, quantity: 1 },
              { variant_id: 222, quantity: 1 },
            ],
          },
        },
      })

      expect(response.body.checkout.line_items).toHaveLength(2)
    })

    it('should add multiple line items at once', async () => {
      const checkoutWithMultiple = mockCheckout({
        line_items: [
          mockLineItem({ variant_id: 111, quantity: 2 }),
          mockLineItem({ id: 'line_item_2', variant_id: 222, quantity: 3 }),
          mockLineItem({ id: 'line_item_3', variant_id: 333, quantity: 1 }),
        ],
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: checkoutWithMultiple },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            line_items: [
              { variant_id: 111, quantity: 2 },
              { variant_id: 222, quantity: 3 },
              { variant_id: 333, quantity: 1 },
            ],
          },
        },
      })

      expect(response.body.checkout.line_items).toHaveLength(3)
    })

    it('should add line item with custom properties', async () => {
      const checkoutWithProperties = mockCheckout({
        line_items: [
          mockLineItem({
            properties: [
              { name: 'Engraving', value: 'Happy Birthday' },
              { name: 'Gift Wrap', value: 'Yes' },
            ],
          }),
        ],
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: checkoutWithProperties },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            line_items: [
              {
                variant_id: 9876543210,
                quantity: 1,
                properties: [
                  { name: 'Engraving', value: 'Happy Birthday' },
                  { name: 'Gift Wrap', value: 'Yes' },
                ],
              },
            ],
          },
        },
      })

      expect(response.body.checkout.line_items[0].properties).toHaveLength(2)
    })
  })

  describe('update line items', () => {
    it('should update line item quantity', async () => {
      const updatedCheckout = mockCheckout({
        line_items: [mockLineItem({ quantity: 5, line_price: '149.95' })],
        subtotal_price: '149.95',
        total_price: '149.95',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: updatedCheckout },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            line_items: [{ variant_id: 9876543210, quantity: 5 }],
          },
        },
      })

      expect(response.body.checkout.line_items[0].quantity).toBe(5)
      expect(response.body.checkout.line_items[0].line_price).toBe('149.95')
    })

    it('should handle out of stock error on quantity increase', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 422,
              body: {
                errors: {
                  line_items: ['Quantity for variant 9876543210 exceeds available inventory'],
                },
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })

      await expect(
        client.put({
          path: 'checkouts/checkout_token_abc123',
          data: {
            checkout: {
              line_items: [{ variant_id: 9876543210, quantity: 1000 }],
            },
          },
        })
      ).rejects.toThrow()
    })
  })

  describe('remove line items', () => {
    it('should remove a line item by setting quantity to 0', async () => {
      const checkoutWithRemovedItem = mockCheckout({
        line_items: [],
        subtotal_price: '0.00',
        total_price: '0.00',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: checkoutWithRemovedItem },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            line_items: [{ variant_id: 9876543210, quantity: 0 }],
          },
        },
      })

      expect(response.body.checkout.line_items).toHaveLength(0)
    })

    it('should clear all line items', async () => {
      const emptyCheckout = mockCheckout({
        line_items: [],
        subtotal_price: '0.00',
        total_price: '0.00',
        requires_shipping: false,
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: emptyCheckout },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            line_items: [],
          },
        },
      })

      expect(response.body.checkout.line_items).toHaveLength(0)
      expect(response.body.checkout.requires_shipping).toBe(false)
    })
  })
})

// =============================================================================
// Discount Code Tests
// =============================================================================

describe('@dotdo/shopify - Checkout Discounts', () => {
  describe('apply discount code', () => {
    it('should apply a percentage discount code', async () => {
      const checkoutWithDiscount = mockCheckout({
        discount_codes: [{ code: 'SAVE20', amount: '5.99', type: 'percentage' }],
        applied_discounts: [
          {
            title: '20% Off',
            description: 'Save 20% on your order',
            value: '20.0',
            value_type: 'percentage',
            amount: '5.99',
            applicable: true,
          },
        ],
        total_discounts: '5.99',
        total_price: '30.00',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: checkoutWithDiscount },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            discount_code: 'SAVE20',
          },
        },
      })

      expect(response.body.checkout.discount_codes).toHaveLength(1)
      expect(response.body.checkout.discount_codes[0].code).toBe('SAVE20')
      expect(response.body.checkout.total_discounts).toBe('5.99')
    })

    it('should apply a fixed amount discount code', async () => {
      const checkoutWithFixedDiscount = mockCheckout({
        discount_codes: [{ code: 'FLAT10', amount: '10.00', type: 'fixed_amount' }],
        applied_discounts: [
          {
            title: '$10 Off',
            description: 'Get $10 off your order',
            value: '10.00',
            value_type: 'fixed_amount',
            amount: '10.00',
            applicable: true,
          },
        ],
        total_discounts: '10.00',
        total_price: '25.98',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: checkoutWithFixedDiscount },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            discount_code: 'FLAT10',
          },
        },
      })

      expect(response.body.checkout.applied_discounts[0].value_type).toBe('fixed_amount')
      expect(response.body.checkout.applied_discounts[0].amount).toBe('10.00')
    })

    it('should apply free shipping discount code', async () => {
      const checkoutWithFreeShipping = mockCheckout({
        discount_codes: [{ code: 'FREESHIP', amount: '5.99', type: 'shipping' }],
        shipping_line: { title: 'Standard Shipping', price: '0.00', handle: 'standard' },
        total_price: '29.99',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: checkoutWithFreeShipping },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            discount_code: 'FREESHIP',
          },
        },
      })

      expect(response.body.checkout.discount_codes[0].type).toBe('shipping')
    })

    it('should handle invalid discount code', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 422,
              body: {
                errors: {
                  discount_code: ['Discount code INVALID123 is not valid'],
                },
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })

      await expect(
        client.put({
          path: 'checkouts/checkout_token_abc123',
          data: {
            checkout: {
              discount_code: 'INVALID123',
            },
          },
        })
      ).rejects.toThrow()
    })

    it('should handle expired discount code', async () => {
      const checkoutWithExpiredDiscount = mockCheckout({
        applied_discounts: [
          {
            title: 'Expired Offer',
            description: null,
            value: '20.0',
            value_type: 'percentage',
            amount: '0.00',
            applicable: false,
            non_applicable_reason: 'Discount code has expired',
          },
        ],
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: checkoutWithExpiredDiscount },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            discount_code: 'EXPIRED20',
          },
        },
      })

      expect(response.body.checkout.applied_discounts[0].applicable).toBe(false)
      expect(response.body.checkout.applied_discounts[0].non_applicable_reason).toContain('expired')
    })
  })

  describe('remove discount code', () => {
    it('should remove discount code from checkout', async () => {
      const checkoutWithoutDiscount = mockCheckout({
        discount_codes: [],
        applied_discounts: [],
        total_discounts: '0.00',
        total_price: '35.98',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: checkoutWithoutDiscount },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            discount_code: '',
          },
        },
      })

      expect(response.body.checkout.discount_codes).toHaveLength(0)
      expect(response.body.checkout.total_discounts).toBe('0.00')
    })
  })
})

// =============================================================================
// Shipping Rates Tests
// =============================================================================

describe('@dotdo/shopify - Checkout Shipping Rates', () => {
  describe('get shipping rates', () => {
    it('should fetch available shipping rates for checkout', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123/shipping_rates.json`,
            {
              status: 200,
              body: {
                shipping_rates: [
                  mockShippingRate(),
                  mockShippingRate({
                    id: 'shopify-Express%20Shipping-12.99',
                    title: 'Express Shipping',
                    price: '12.99',
                    handle: 'shopify-Express%20Shipping-12.99',
                    delivery_range: { min: '1-2 business days', max: '2-3 business days' },
                  }),
                  mockShippingRate({
                    id: 'shopify-Overnight-24.99',
                    title: 'Overnight',
                    price: '24.99',
                    handle: 'shopify-Overnight-24.99',
                    delivery_range: { min: 'Next business day', max: 'Next business day' },
                  }),
                ],
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({
        path: 'checkouts/checkout_token_abc123/shipping_rates',
      })

      expect(response.body.shipping_rates).toHaveLength(3)
      expect(response.body.shipping_rates[0].title).toBe('Standard Shipping')
      expect(response.body.shipping_rates[1].title).toBe('Express Shipping')
    })

    it('should return empty rates when shipping address is missing', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123/shipping_rates.json`,
            {
              status: 202,
              body: {
                shipping_rates: [],
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({
        path: 'checkouts/checkout_token_abc123/shipping_rates',
      })

      expect(response.body.shipping_rates).toHaveLength(0)
    })

    it('should handle rate calculation in progress (polling)', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123/shipping_rates.json`,
            {
              status: 202,
              body: {
                shipping_rates: [],
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({
        path: 'checkouts/checkout_token_abc123/shipping_rates',
      })

      // 202 indicates rates are being calculated, client should poll
      expect(response.body.shipping_rates).toBeDefined()
    })
  })

  describe('select shipping rate', () => {
    it('should select a shipping rate for checkout', async () => {
      const checkoutWithShipping = mockCheckout({
        shipping_address: mockShippingAddress(),
        shipping_rate: mockShippingRate(),
        shipping_line: {
          title: 'Standard Shipping',
          price: '5.99',
          handle: 'shopify-Standard%20Shipping-5.99',
        },
        total_price: '35.98',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: checkoutWithShipping },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            shipping_rate: {
              handle: 'shopify-Standard%20Shipping-5.99',
            },
          },
        },
      })

      expect(response.body.checkout.shipping_line).toBeDefined()
      expect(response.body.checkout.shipping_line.title).toBe('Standard Shipping')
      expect(response.body.checkout.shipping_line.price).toBe('5.99')
    })

    it('should handle invalid shipping rate selection', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 422,
              body: {
                errors: {
                  shipping_rate: ['Selected shipping rate is not available'],
                },
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })

      await expect(
        client.put({
          path: 'checkouts/checkout_token_abc123',
          data: {
            checkout: {
              shipping_rate: {
                handle: 'invalid-shipping-rate',
              },
            },
          },
        })
      ).rejects.toThrow()
    })
  })
})

// =============================================================================
// Payment Processing Tests
// =============================================================================

describe('@dotdo/shopify - Checkout Payment Processing', () => {
  describe('create payment', () => {
    it('should create a credit card payment', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123/payments.json`,
            {
              status: 201,
              body: { payment: mockPayment() },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'checkouts/checkout_token_abc123/payments',
        data: {
          payment: {
            request_details: {
              ip_address: '123.45.67.89',
              accept_language: 'en-US',
              user_agent: 'Mozilla/5.0',
            },
            amount: '35.98',
            session_id: 'session_123',
            unique_token: 'payment_unique_token_123',
          },
        },
      })

      expect(response.body.payment.id).toBeDefined()
      expect(response.body.payment.transaction).toBeDefined()
      expect(response.body.payment.transaction.status).toBe('success')
    })

    it('should create payment with vaulted credit card', async () => {
      const vaultedPayment = mockPayment({
        credit_card: {
          first_name: 'John',
          last_name: 'Doe',
          first_digits: '424242',
          last_digits: '4242',
          brand: 'visa',
          expiry_month: 12,
          expiry_year: 2025,
        },
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123/payments.json`,
            {
              status: 201,
              body: { payment: vaultedPayment },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'checkouts/checkout_token_abc123/payments',
        data: {
          payment: {
            payment_token: 'card_vault_token_abc123',
            amount: '35.98',
            unique_token: 'payment_unique_token_123',
          },
        },
      })

      expect(response.body.payment.credit_card).toBeDefined()
      expect(response.body.payment.credit_card.last_digits).toBe('4242')
    })

    it('should handle payment declined error', async () => {
      const declinedPayment = mockPayment({
        payment_processing_error_message: 'Your card was declined. Please try a different card.',
        transaction: {
          id: 8888888888,
          amount: '35.98',
          kind: 'sale',
          status: 'failure',
          gateway: 'shopify_payments',
          authorization: null,
        },
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123/payments.json`,
            {
              status: 200,
              body: { payment: declinedPayment },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'checkouts/checkout_token_abc123/payments',
        data: {
          payment: {
            amount: '35.98',
            session_id: 'session_123',
            unique_token: 'payment_unique_token_123',
          },
        },
      })

      expect(response.body.payment.transaction.status).toBe('failure')
      expect(response.body.payment.payment_processing_error_message).toContain('declined')
    })

    it('should handle insufficient funds error', async () => {
      const insufficientFundsPayment = mockPayment({
        payment_processing_error_message: 'Insufficient funds',
        transaction: {
          id: 8888888888,
          amount: '35.98',
          kind: 'sale',
          status: 'failure',
          gateway: 'shopify_payments',
          authorization: null,
        },
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123/payments.json`,
            {
              status: 200,
              body: { payment: insufficientFundsPayment },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'checkouts/checkout_token_abc123/payments',
        data: {
          payment: {
            amount: '35.98',
            session_id: 'session_123',
            unique_token: 'payment_unique_token_123',
          },
        },
      })

      expect(response.body.payment.payment_processing_error_message).toContain('Insufficient')
    })
  })

  describe('get payment', () => {
    it('should retrieve payment details', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123/payments/9999999999.json`,
            {
              status: 200,
              body: { payment: mockPayment() },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({
        path: 'checkouts/checkout_token_abc123/payments/9999999999',
      })

      expect(response.body.payment.id).toBe(9999999999)
      expect(response.body.payment.transaction).toBeDefined()
    })
  })

  describe('list payments', () => {
    it('should list all payments for a checkout', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123/payments.json`,
            {
              status: 200,
              body: {
                payments: [
                  mockPayment({ transaction: { ...mockPayment().transaction!, status: 'failure' } }),
                  mockPayment({ id: 9999999998, transaction: { ...mockPayment().transaction!, status: 'success' } }),
                ],
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({
        path: 'checkouts/checkout_token_abc123/payments',
      })

      expect(response.body.payments).toHaveLength(2)
    })
  })
})

// =============================================================================
// Checkout Completion Tests
// =============================================================================

describe('@dotdo/shopify - Checkout Completion', () => {
  describe('complete checkout', () => {
    it('should complete checkout after successful payment', async () => {
      const completedCheckout = mockCheckout({
        completed_at: '2024-01-15T10:30:00Z',
        order_id: 1234567890,
        order: { id: 1234567890, name: '#1001' },
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123/complete.json`,
            {
              status: 200,
              body: { checkout: completedCheckout },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'checkouts/checkout_token_abc123/complete',
        data: {},
      })

      expect(response.body.checkout.completed_at).toBeDefined()
      expect(response.body.checkout.order_id).toBeDefined()
      expect(response.body.checkout.order.name).toBe('#1001')
    })

    it('should handle completion when payment is pending', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123/complete.json`,
            {
              status: 422,
              body: {
                errors: {
                  checkout: ['Payment is still processing. Please wait.'],
                },
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })

      await expect(
        client.post({
          path: 'checkouts/checkout_token_abc123/complete',
          data: {},
        })
      ).rejects.toThrow()
    })

    it('should handle completion when checkout has no payment', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123/complete.json`,
            {
              status: 422,
              body: {
                errors: {
                  checkout: ['Checkout requires payment before completion'],
                },
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })

      await expect(
        client.post({
          path: 'checkouts/checkout_token_abc123/complete',
          data: {},
        })
      ).rejects.toThrow()
    })
  })

  describe('abandon/close checkout', () => {
    it('should close an incomplete checkout', async () => {
      const closedCheckout = mockCheckout({
        closed_at: '2024-01-15T12:00:00Z',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: closedCheckout },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            closed_at: '2024-01-15T12:00:00Z',
          },
        },
      })

      expect(response.body.checkout.closed_at).toBeDefined()
    })
  })

  describe('checkout to order conversion', () => {
    it('should return order details after completion', async () => {
      const completedCheckout = mockCheckout({
        completed_at: '2024-01-15T10:30:00Z',
        order_id: 1234567890,
        order: { id: 1234567890, name: '#1001' },
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: completedCheckout },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({
        path: 'checkouts/checkout_token_abc123',
      })

      expect(response.body.checkout.order_id).toBe(1234567890)
      expect(response.body.checkout.order).toBeDefined()
    })
  })
})

// =============================================================================
// Checkout Address Management Tests
// =============================================================================

describe('@dotdo/shopify - Checkout Addresses', () => {
  describe('update shipping address', () => {
    it('should update shipping address on checkout', async () => {
      const checkoutWithAddress = mockCheckout({
        shipping_address: mockShippingAddress(),
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: checkoutWithAddress },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            shipping_address: {
              first_name: 'John',
              last_name: 'Doe',
              address1: '123 Main St',
              city: 'New York',
              province: 'NY',
              country: 'US',
              zip: '10001',
            },
          },
        },
      })

      expect(response.body.checkout.shipping_address).toBeDefined()
      expect(response.body.checkout.shipping_address.city).toBe('New York')
    })

    it('should handle invalid address error', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 422,
              body: {
                errors: {
                  shipping_address: {
                    zip: ['Invalid zip code for country'],
                  },
                },
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })

      await expect(
        client.put({
          path: 'checkouts/checkout_token_abc123',
          data: {
            checkout: {
              shipping_address: {
                first_name: 'John',
                last_name: 'Doe',
                address1: '123 Main St',
                city: 'New York',
                province: 'NY',
                country: 'US',
                zip: 'INVALID',
              },
            },
          },
        })
      ).rejects.toThrow()
    })
  })

  describe('update billing address', () => {
    it('should update billing address on checkout', async () => {
      const checkoutWithBilling = mockCheckout({
        billing_address: mockShippingAddress({ address1: '456 Billing Ave' }),
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: checkoutWithBilling },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            billing_address: {
              first_name: 'John',
              last_name: 'Doe',
              address1: '456 Billing Ave',
              city: 'New York',
              province: 'NY',
              country: 'US',
              zip: '10001',
            },
          },
        },
      })

      expect(response.body.checkout.billing_address).toBeDefined()
      expect(response.body.checkout.billing_address.address1).toBe('456 Billing Ave')
    })

    it('should copy shipping address to billing', async () => {
      const checkoutWithSameBilling = mockCheckout({
        shipping_address: mockShippingAddress(),
        billing_address: mockShippingAddress(),
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: checkoutWithSameBilling },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            billing_address_same_as_shipping_address: true,
          },
        },
      })

      expect(response.body.checkout.billing_address.address1).toBe(
        response.body.checkout.shipping_address.address1
      )
    })
  })
})

// =============================================================================
// Checkout Email and Marketing Tests
// =============================================================================

describe('@dotdo/shopify - Checkout Email & Marketing', () => {
  describe('update email', () => {
    it('should update customer email on checkout', async () => {
      const checkoutWithEmail = mockCheckout({
        email: 'updated@example.com',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: checkoutWithEmail },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            email: 'updated@example.com',
          },
        },
      })

      expect(response.body.checkout.email).toBe('updated@example.com')
    })

    it('should handle invalid email error', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 422,
              body: {
                errors: {
                  email: ['is invalid'],
                },
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })

      await expect(
        client.put({
          path: 'checkouts/checkout_token_abc123',
          data: {
            checkout: {
              email: 'not-an-email',
            },
          },
        })
      ).rejects.toThrow()
    })
  })

  describe('marketing consent', () => {
    it('should update marketing acceptance on checkout', async () => {
      const checkoutWithMarketing = mockCheckout({
        buyer_accepts_marketing: true,
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: checkoutWithMarketing },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            buyer_accepts_marketing: true,
          },
        },
      })

      expect(response.body.checkout.buyer_accepts_marketing).toBe(true)
    })
  })
})

// =============================================================================
// Checkout Tax Calculation Tests
// =============================================================================

describe('@dotdo/shopify - Checkout Tax Calculation', () => {
  describe('tax calculation', () => {
    it('should calculate taxes based on shipping address', async () => {
      const checkoutWithTax = mockCheckout({
        shipping_address: mockShippingAddress({ province_code: 'CA', country_code: 'US' }),
        total_tax: '2.85',
        taxes_included: false,
        total_price: '38.83',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: checkoutWithTax },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'checkouts/checkout_token_abc123',
        data: {
          checkout: {
            shipping_address: {
              first_name: 'John',
              last_name: 'Doe',
              address1: '123 Main St',
              city: 'Los Angeles',
              province: 'CA',
              country: 'US',
              zip: '90001',
            },
          },
        },
      })

      expect(response.body.checkout.total_tax).toBe('2.85')
      expect(parseFloat(response.body.checkout.total_price)).toBeGreaterThan(
        parseFloat(response.body.checkout.subtotal_price)
      )
    })

    it('should handle tax-included pricing', async () => {
      const checkoutWithTaxIncluded = mockCheckout({
        taxes_included: true,
        total_tax: '4.50',
        total_price: '35.98',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: checkoutWithTaxIncluded },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({
        path: 'checkouts/checkout_token_abc123',
      })

      expect(response.body.checkout.taxes_included).toBe(true)
    })
  })
})

// =============================================================================
// Storefront API Checkout (GraphQL) Tests
// =============================================================================

// =============================================================================
// RED Phase Tests - CheckoutsResource Class (Expected to Fail Until Implemented)
// =============================================================================

describe('@dotdo/shopify - CheckoutsResource (RED Phase - Unimplemented)', () => {
  describe('resource exports', () => {
    it('should export CheckoutsResource class', async () => {
      // This will fail until CheckoutsResource is implemented
      const { CheckoutsResource } = await import('../checkout')
      expect(CheckoutsResource).toBeDefined()
    })

    it('should export Checkout types', async () => {
      const { Checkout, CheckoutLineItem, ShippingRate, Payment } = await import('../checkout')
      expect(Checkout).toBeDefined()
      expect(CheckoutLineItem).toBeDefined()
      expect(ShippingRate).toBeDefined()
      expect(Payment).toBeDefined()
    })
  })

  describe('CheckoutsResource.create', () => {
    it('should have create method', async () => {
      const mockFetch = createMockFetch(new Map())
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      expect(checkoutsResource.create).toBeDefined()
      expect(typeof checkoutsResource.create).toBe('function')
    })

    it('should create checkout with typed input', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/checkouts.json`,
            {
              status: 201,
              body: { checkout: mockCheckout() },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      const checkout = await checkoutsResource.create({
        email: 'test@example.com',
        line_items: [{ variant_id: 111, quantity: 1 }],
      })

      expect(checkout.token).toBeDefined()
      expect(checkout.web_url).toBeDefined()
    })
  })

  describe('CheckoutsResource.get', () => {
    it('should have get method', async () => {
      const mockFetch = createMockFetch(new Map())
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      expect(checkoutsResource.get).toBeDefined()
      expect(typeof checkoutsResource.get).toBe('function')
    })

    it('should get checkout by token', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: mockCheckout() },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      const checkout = await checkoutsResource.get('checkout_token_abc123')

      expect(checkout.token).toBe('checkout_token_abc123')
    })
  })

  describe('CheckoutsResource.update', () => {
    it('should have update method', async () => {
      const mockFetch = createMockFetch(new Map())
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      expect(checkoutsResource.update).toBeDefined()
      expect(typeof checkoutsResource.update).toBe('function')
    })
  })

  describe('CheckoutsResource.shippingRates', () => {
    it('should have shippingRates sub-resource', async () => {
      const mockFetch = createMockFetch(new Map())
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      expect(checkoutsResource.shippingRates).toBeDefined()
    })

    it('should list available shipping rates', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123/shipping_rates.json`,
            {
              status: 200,
              body: {
                shipping_rates: [mockShippingRate()],
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      const rates = await checkoutsResource.shippingRates.list('checkout_token_abc123')

      expect(rates).toHaveLength(1)
      expect(rates[0].title).toBe('Standard Shipping')
    })
  })

  describe('CheckoutsResource.payments', () => {
    it('should have payments sub-resource', async () => {
      const mockFetch = createMockFetch(new Map())
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      expect(checkoutsResource.payments).toBeDefined()
    })

    it('should create payment', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123/payments.json`,
            {
              status: 201,
              body: { payment: mockPayment() },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      const payment = await checkoutsResource.payments.create('checkout_token_abc123', {
        amount: '35.98',
        unique_token: 'payment_unique_token_123',
      })

      expect(payment.id).toBeDefined()
      expect(payment.transaction?.status).toBe('success')
    })

    it('should list payments', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123/payments.json`,
            {
              status: 200,
              body: { payments: [mockPayment()] },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      const payments = await checkoutsResource.payments.list('checkout_token_abc123')

      expect(payments).toHaveLength(1)
    })
  })

  describe('CheckoutsResource.complete', () => {
    it('should have complete method', async () => {
      const mockFetch = createMockFetch(new Map())
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      expect(checkoutsResource.complete).toBeDefined()
      expect(typeof checkoutsResource.complete).toBe('function')
    })

    it('should complete checkout and return order', async () => {
      const completedCheckout = mockCheckout({
        completed_at: '2024-01-15T10:30:00Z',
        order_id: 1234567890,
        order: { id: 1234567890, name: '#1001' },
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123/complete.json`,
            {
              status: 200,
              body: { checkout: completedCheckout },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      const checkout = await checkoutsResource.complete('checkout_token_abc123')

      expect(checkout.completed_at).toBeDefined()
      expect(checkout.order_id).toBe(1234567890)
      expect(checkout.order?.name).toBe('#1001')
    })
  })

  describe('CheckoutsResource.applyDiscount', () => {
    it('should have applyDiscount method', async () => {
      const mockFetch = createMockFetch(new Map())
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      expect(checkoutsResource.applyDiscount).toBeDefined()
      expect(typeof checkoutsResource.applyDiscount).toBe('function')
    })

    it('should apply discount code to checkout', async () => {
      const checkoutWithDiscount = mockCheckout({
        discount_codes: [{ code: 'SAVE20', amount: '5.99', type: 'percentage' }],
        total_discounts: '5.99',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: checkoutWithDiscount },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      const checkout = await checkoutsResource.applyDiscount('checkout_token_abc123', 'SAVE20')

      expect(checkout.discount_codes).toHaveLength(1)
      expect(checkout.discount_codes[0].code).toBe('SAVE20')
    })
  })

  describe('CheckoutsResource.removeDiscount', () => {
    it('should have removeDiscount method', async () => {
      const mockFetch = createMockFetch(new Map())
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      expect(checkoutsResource.removeDiscount).toBeDefined()
      expect(typeof checkoutsResource.removeDiscount).toBe('function')
    })
  })

  describe('CheckoutsResource.selectShippingRate', () => {
    it('should have selectShippingRate method', async () => {
      const mockFetch = createMockFetch(new Map())
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      expect(checkoutsResource.selectShippingRate).toBeDefined()
      expect(typeof checkoutsResource.selectShippingRate).toBe('function')
    })

    it('should select shipping rate for checkout', async () => {
      const checkoutWithShipping = mockCheckout({
        shipping_rate: mockShippingRate(),
        shipping_line: {
          title: 'Standard Shipping',
          price: '5.99',
          handle: 'shopify-Standard%20Shipping-5.99',
        },
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: checkoutWithShipping },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      const checkout = await checkoutsResource.selectShippingRate(
        'checkout_token_abc123',
        'shopify-Standard%20Shipping-5.99'
      )

      expect(checkout.shipping_line).toBeDefined()
      expect(checkout.shipping_line?.title).toBe('Standard Shipping')
    })
  })

  describe('CheckoutsResource.updateLineItems', () => {
    it('should have updateLineItems method', async () => {
      const mockFetch = createMockFetch(new Map())
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      expect(checkoutsResource.updateLineItems).toBeDefined()
      expect(typeof checkoutsResource.updateLineItems).toBe('function')
    })

    it('should add/update/remove line items', async () => {
      const updatedCheckout = mockCheckout({
        line_items: [
          mockLineItem({ quantity: 3 }),
          mockLineItem({ id: 'line_item_2', variant_id: 222 }),
        ],
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/checkouts/checkout_token_abc123.json`,
            {
              status: 200,
              body: { checkout: updatedCheckout },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const { CheckoutsResource } = await import('../checkout')
      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const checkoutsResource = new CheckoutsResource(restClient as any)

      const checkout = await checkoutsResource.updateLineItems('checkout_token_abc123', [
        { variant_id: 9876543210, quantity: 3 },
        { variant_id: 222, quantity: 1 },
      ])

      expect(checkout.line_items).toHaveLength(2)
    })
  })
})

// =============================================================================
// Storefront API Checkout (GraphQL) Tests
// =============================================================================

describe('@dotdo/shopify - Storefront API Checkout (GraphQL)', () => {
  describe('create checkout mutation', () => {
    it('should create checkout via GraphQL', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/graphql.json`,
            {
              status: 200,
              body: {
                data: {
                  checkoutCreate: {
                    checkout: {
                      id: 'gid://shopify/Checkout/checkout_token_abc123',
                      webUrl: 'https://myshop.myshopify.com/checkouts/checkout_token_abc123',
                      lineItems: {
                        edges: [
                          {
                            node: {
                              id: 'gid://shopify/CheckoutLineItem/line_item_1',
                              title: 'Test Product',
                              quantity: 1,
                              variant: {
                                id: 'gid://shopify/ProductVariant/9876543210',
                                price: { amount: '29.99', currencyCode: 'USD' },
                              },
                            },
                          },
                        ],
                      },
                      totalPrice: { amount: '29.99', currencyCode: 'USD' },
                    },
                    checkoutUserErrors: [],
                  },
                },
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Graphql({ session: mockSession() })
      const response = await client.query({
        data: {
          query: `
            mutation checkoutCreate($input: CheckoutCreateInput!) {
              checkoutCreate(input: $input) {
                checkout {
                  id
                  webUrl
                  lineItems(first: 10) {
                    edges {
                      node {
                        id
                        title
                        quantity
                        variant {
                          id
                          price {
                            amount
                            currencyCode
                          }
                        }
                      }
                    }
                  }
                  totalPrice {
                    amount
                    currencyCode
                  }
                }
                checkoutUserErrors {
                  field
                  message
                }
              }
            }
          `,
          variables: {
            input: {
              lineItems: [
                {
                  variantId: 'gid://shopify/ProductVariant/9876543210',
                  quantity: 1,
                },
              ],
            },
          },
        },
      })

      expect(response.body.data.checkoutCreate.checkout).toBeDefined()
      expect(response.body.data.checkoutCreate.checkoutUserErrors).toHaveLength(0)
    })
  })

  describe('checkout line items update mutation', () => {
    it('should update line items via GraphQL', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/graphql.json`,
            {
              status: 200,
              body: {
                data: {
                  checkoutLineItemsUpdate: {
                    checkout: {
                      id: 'gid://shopify/Checkout/checkout_token_abc123',
                      lineItems: {
                        edges: [
                          {
                            node: {
                              id: 'gid://shopify/CheckoutLineItem/line_item_1',
                              quantity: 3,
                            },
                          },
                        ],
                      },
                    },
                    checkoutUserErrors: [],
                  },
                },
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Graphql({ session: mockSession() })
      const response = await client.query({
        data: {
          query: `
            mutation checkoutLineItemsUpdate($checkoutId: ID!, $lineItems: [CheckoutLineItemUpdateInput!]!) {
              checkoutLineItemsUpdate(checkoutId: $checkoutId, lineItems: $lineItems) {
                checkout {
                  id
                  lineItems(first: 10) {
                    edges {
                      node {
                        id
                        quantity
                      }
                    }
                  }
                }
                checkoutUserErrors {
                  field
                  message
                }
              }
            }
          `,
          variables: {
            checkoutId: 'gid://shopify/Checkout/checkout_token_abc123',
            lineItems: [
              {
                id: 'gid://shopify/CheckoutLineItem/line_item_1',
                quantity: 3,
              },
            ],
          },
        },
      })

      expect(response.body.data.checkoutLineItemsUpdate.checkout.lineItems.edges[0].node.quantity).toBe(3)
    })
  })

  describe('checkout discount code apply mutation', () => {
    it('should apply discount code via GraphQL', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/graphql.json`,
            {
              status: 200,
              body: {
                data: {
                  checkoutDiscountCodeApplyV2: {
                    checkout: {
                      id: 'gid://shopify/Checkout/checkout_token_abc123',
                      discountApplications: {
                        edges: [
                          {
                            node: {
                              __typename: 'DiscountCodeApplication',
                              code: 'SAVE20',
                              applicable: true,
                              value: {
                                percentage: 20,
                              },
                            },
                          },
                        ],
                      },
                    },
                    checkoutUserErrors: [],
                  },
                },
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Graphql({ session: mockSession() })
      const response = await client.query({
        data: {
          query: `
            mutation checkoutDiscountCodeApplyV2($checkoutId: ID!, $discountCode: String!) {
              checkoutDiscountCodeApplyV2(checkoutId: $checkoutId, discountCode: $discountCode) {
                checkout {
                  id
                  discountApplications(first: 10) {
                    edges {
                      node {
                        ... on DiscountCodeApplication {
                          code
                          applicable
                          value {
                            ... on PricingPercentageValue {
                              percentage
                            }
                          }
                        }
                      }
                    }
                  }
                }
                checkoutUserErrors {
                  field
                  message
                }
              }
            }
          `,
          variables: {
            checkoutId: 'gid://shopify/Checkout/checkout_token_abc123',
            discountCode: 'SAVE20',
          },
        },
      })

      expect(response.body.data.checkoutDiscountCodeApplyV2.checkout.discountApplications.edges).toHaveLength(1)
      expect(response.body.data.checkoutDiscountCodeApplyV2.checkout.discountApplications.edges[0].node.code).toBe('SAVE20')
    })
  })

  describe('checkout complete with credit card mutation', () => {
    it('should complete checkout via GraphQL', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/graphql.json`,
            {
              status: 200,
              body: {
                data: {
                  checkoutCompleteWithCreditCardV2: {
                    checkout: {
                      id: 'gid://shopify/Checkout/checkout_token_abc123',
                      order: {
                        id: 'gid://shopify/Order/1234567890',
                        name: '#1001',
                      },
                    },
                    payment: {
                      id: 'gid://shopify/Payment/9999999999',
                      ready: true,
                      errorMessage: null,
                      transaction: {
                        status: 'SUCCESS',
                      },
                    },
                    checkoutUserErrors: [],
                  },
                },
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_checkouts'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Graphql({ session: mockSession() })
      const response = await client.query({
        data: {
          query: `
            mutation checkoutCompleteWithCreditCardV2($checkoutId: ID!, $payment: CreditCardPaymentInputV2!) {
              checkoutCompleteWithCreditCardV2(checkoutId: $checkoutId, payment: $payment) {
                checkout {
                  id
                  order {
                    id
                    name
                  }
                }
                payment {
                  id
                  ready
                  errorMessage
                  transaction {
                    status
                  }
                }
                checkoutUserErrors {
                  field
                  message
                }
              }
            }
          `,
          variables: {
            checkoutId: 'gid://shopify/Checkout/checkout_token_abc123',
            payment: {
              paymentAmount: { amount: '35.98', currencyCode: 'USD' },
              idempotencyKey: 'payment_unique_key_123',
              billingAddress: {
                firstName: 'John',
                lastName: 'Doe',
                address1: '123 Main St',
                city: 'New York',
                province: 'NY',
                country: 'US',
                zip: '10001',
              },
              vaultId: 'vault_abc123',
            },
          },
        },
      })

      expect(response.body.data.checkoutCompleteWithCreditCardV2.checkout.order).toBeDefined()
      expect(response.body.data.checkoutCompleteWithCreditCardV2.payment.transaction.status).toBe('SUCCESS')
    })
  })
})
