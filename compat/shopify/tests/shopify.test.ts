/**
 * @dotdo/shopify - Shopify API Compatibility Layer Tests
 *
 * Tests for the Shopify API compatibility layer including:
 * - Products (CRUD, variants, images, metafields)
 * - Orders (CRUD, fulfill, refund, transactions)
 * - Customers (CRUD, search, addresses)
 * - Inventory (adjust, set levels, list locations)
 * - Webhooks (register, verify signatures)
 * - Auth (token exchange, session management)
 * - GraphQL client
 *
 * @module @dotdo/shopify/tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  shopifyApi,
  LATEST_API_VERSION,
  type ShopifyConfig,
  type Session,
  type Product,
  type ProductVariant,
  type Order,
  type Customer,
  type InventoryLevel,
  type Location,
  type Webhook,
  type WebhookSubscription,
} from '../index'

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
        // Convert pattern like 'GET /admin/api/2024-01/products/:id.json' to regex
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
    scope: 'read_products,write_products,read_orders,write_orders',
    ...overrides,
  }
}

function mockProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1234567890,
    title: 'Test Product',
    body_html: '<p>Test description</p>',
    vendor: 'Test Vendor',
    product_type: 'Test Type',
    handle: 'test-product',
    status: 'active',
    published_scope: 'global',
    tags: 'tag1, tag2',
    template_suffix: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    published_at: '2024-01-01T00:00:00Z',
    variants: [mockVariant()],
    options: [{ id: 1, product_id: 1234567890, name: 'Title', position: 1, values: ['Default Title'] }],
    images: [],
    image: null,
    ...overrides,
  }
}

function mockVariant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 9876543210,
    product_id: 1234567890,
    title: 'Default Title',
    price: '29.99',
    compare_at_price: '39.99',
    sku: 'TEST-SKU-001',
    barcode: '123456789',
    grams: 500,
    weight: 0.5,
    weight_unit: 'kg',
    inventory_item_id: 1111111111,
    inventory_quantity: 100,
    inventory_management: 'shopify',
    inventory_policy: 'deny',
    fulfillment_service: 'manual',
    requires_shipping: true,
    taxable: true,
    position: 1,
    option1: 'Default Title',
    option2: null,
    option3: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function mockOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 1234567890,
    name: '#1001',
    email: 'customer@example.com',
    phone: '+1234567890',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    processed_at: '2024-01-01T00:00:00Z',
    closed_at: null,
    cancelled_at: null,
    cancel_reason: null,
    financial_status: 'paid',
    fulfillment_status: null,
    currency: 'USD',
    total_price: '59.98',
    subtotal_price: '59.98',
    total_tax: '0.00',
    total_discounts: '0.00',
    total_line_items_price: '59.98',
    total_weight: 1000,
    taxes_included: false,
    confirmed: true,
    test: false,
    order_number: 1001,
    token: 'test-token',
    gateway: 'shopify_payments',
    line_items: [
      {
        id: 111,
        product_id: 1234567890,
        variant_id: 9876543210,
        title: 'Test Product',
        variant_title: 'Default Title',
        sku: 'TEST-SKU-001',
        quantity: 2,
        price: '29.99',
        grams: 500,
        fulfillment_status: null,
        fulfillable_quantity: 2,
        fulfillment_service: 'manual',
        requires_shipping: true,
        taxable: true,
        gift_card: false,
        total_discount: '0.00',
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
      phone: '+1234567890',
    },
    shipping_address: {
      first_name: 'John',
      last_name: 'Doe',
      address1: '123 Main St',
      city: 'New York',
      province: 'NY',
      country: 'US',
      zip: '10001',
      phone: '+1234567890',
    },
    customer: mockCustomer(),
    fulfillments: [],
    refunds: [],
    tags: '',
    note: null,
    note_attributes: [],
    discount_codes: [],
    discount_applications: [],
    ...overrides,
  }
}

function mockCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 5555555555,
    email: 'customer@example.com',
    first_name: 'John',
    last_name: 'Doe',
    phone: '+1234567890',
    verified_email: true,
    accepts_marketing: false,
    accepts_marketing_updated_at: null,
    marketing_opt_in_level: null,
    state: 'enabled',
    tags: '',
    currency: 'USD',
    tax_exempt: false,
    tax_exemptions: [],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    orders_count: 1,
    total_spent: '59.98',
    last_order_id: 1234567890,
    last_order_name: '#1001',
    note: null,
    addresses: [
      {
        id: 111,
        customer_id: 5555555555,
        first_name: 'John',
        last_name: 'Doe',
        company: null,
        address1: '123 Main St',
        address2: null,
        city: 'New York',
        province: 'NY',
        country: 'US',
        zip: '10001',
        phone: '+1234567890',
        name: 'John Doe',
        province_code: 'NY',
        country_code: 'US',
        country_name: 'United States',
        default: true,
      },
    ],
    default_address: {
      id: 111,
      customer_id: 5555555555,
      first_name: 'John',
      last_name: 'Doe',
      company: null,
      address1: '123 Main St',
      address2: null,
      city: 'New York',
      province: 'NY',
      country: 'US',
      zip: '10001',
      phone: '+1234567890',
      name: 'John Doe',
      province_code: 'NY',
      country_code: 'US',
      country_name: 'United States',
      default: true,
    },
    ...overrides,
  }
}

function mockLocation(overrides: Partial<Location> = {}): Location {
  return {
    id: 7777777777,
    name: 'Main Warehouse',
    address1: '456 Warehouse St',
    address2: null,
    city: 'Los Angeles',
    province: 'CA',
    country: 'US',
    zip: '90001',
    phone: '+1987654321',
    country_code: 'US',
    country_name: 'United States',
    province_code: 'CA',
    legacy: false,
    active: true,
    admin_graphql_api_id: 'gid://shopify/Location/7777777777',
    localized_country_name: 'United States',
    localized_province_name: 'California',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function mockInventoryLevel(overrides: Partial<InventoryLevel> = {}): InventoryLevel {
  return {
    inventory_item_id: 1111111111,
    location_id: 7777777777,
    available: 100,
    updated_at: '2024-01-01T00:00:00Z',
    admin_graphql_api_id: 'gid://shopify/InventoryLevel/1111111111?inventory_item_id=1111111111',
    ...overrides,
  }
}

// =============================================================================
// Shopify Client Tests - Initialization
// =============================================================================

describe('@dotdo/shopify - Client Initialization', () => {
  describe('shopifyApi factory', () => {
    it('should create a shopify instance with required config', () => {
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products', 'write_orders'],
        hostName: 'myshop.myshopify.com',
      })

      expect(shopify).toBeDefined()
      expect(shopify.config.apiKey).toBe('test-api-key')
      expect(shopify.config.hostName).toBe('myshop.myshopify.com')
    })

    it('should use LATEST_API_VERSION by default', () => {
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
      })

      expect(shopify.config.apiVersion).toBe(LATEST_API_VERSION)
    })

    it('should allow custom API version', () => {
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
        apiVersion: '2024-01',
      })

      expect(shopify.config.apiVersion).toBe('2024-01')
    })

    it('should throw error without required config', () => {
      expect(() =>
        shopifyApi({
          apiKey: '',
          apiSecretKey: 'test-api-secret',
          scopes: ['read_products'],
          hostName: 'myshop.myshopify.com',
        })
      ).toThrow('API key is required')

      expect(() =>
        shopifyApi({
          apiKey: 'test-api-key',
          apiSecretKey: '',
          scopes: ['read_products'],
          hostName: 'myshop.myshopify.com',
        })
      ).toThrow('API secret key is required')

      expect(() =>
        shopifyApi({
          apiKey: 'test-api-key',
          apiSecretKey: 'test-api-secret',
          scopes: [],
          hostName: 'myshop.myshopify.com',
        })
      ).toThrow('At least one scope is required')
    })

    it('should expose auth, clients, and webhooks modules', () => {
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
      })

      expect(shopify.auth).toBeDefined()
      expect(shopify.clients).toBeDefined()
      expect(shopify.webhooks).toBeDefined()
    })
  })
})

// =============================================================================
// Auth Tests
// =============================================================================

describe('@dotdo/shopify - Auth', () => {
  describe('tokenExchange', () => {
    it('should exchange authorization code for access token', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /admin/oauth/access_token',
            {
              status: 200,
              body: {
                access_token: 'shpat_test_token',
                scope: 'read_products,write_orders',
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products', 'write_orders'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const session = await shopify.auth.tokenExchange({
        shop: 'myshop.myshopify.com',
        code: 'auth-code',
      })

      expect(session.accessToken).toBe('shpat_test_token')
      expect(session.shop).toBe('myshop.myshopify.com')
      expect(session.scope).toBe('read_products,write_orders')
    })

    it('should support online access mode', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'POST /admin/oauth/access_token',
            {
              status: 200,
              body: {
                access_token: 'shpat_online_token',
                scope: 'read_products',
                expires_in: 86400,
                associated_user_scope: 'read_products',
                associated_user: {
                  id: 123,
                  first_name: 'John',
                  last_name: 'Doe',
                  email: 'john@example.com',
                  account_owner: true,
                },
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const session = await shopify.auth.tokenExchange({
        shop: 'myshop.myshopify.com',
        code: 'auth-code',
        isOnline: true,
      })

      expect(session.isOnline).toBe(true)
      expect(session.onlineAccessInfo).toBeDefined()
      expect(session.onlineAccessInfo?.associatedUser.email).toBe('john@example.com')
    })
  })

  describe('getAuthorizationUrl', () => {
    it('should generate authorization URL', () => {
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products', 'write_orders'],
        hostName: 'myshop.myshopify.com',
      })

      const { url, state } = shopify.auth.getAuthorizationUrl({
        shop: 'myshop.myshopify.com',
        redirectUri: 'https://myapp.com/callback',
      })

      expect(url).toContain('https://myshop.myshopify.com/admin/oauth/authorize')
      expect(url).toContain('client_id=test-api-key')
      expect(url).toContain('scope=read_products%2Cwrite_orders')
      expect(url).toContain('redirect_uri=https%3A%2F%2Fmyapp.com%2Fcallback')
      expect(state).toBeDefined()
      expect(state.length).toBeGreaterThan(0)
    })

    it('should include state parameter', () => {
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
      })

      const { url, state } = shopify.auth.getAuthorizationUrl({
        shop: 'myshop.myshopify.com',
        redirectUri: 'https://myapp.com/callback',
        state: 'custom-state',
      })

      expect(url).toContain('state=custom-state')
      expect(state).toBe('custom-state')
    })
  })
})

// =============================================================================
// REST Client Tests
// =============================================================================

describe('@dotdo/shopify - REST Client', () => {
  describe('initialization', () => {
    it('should create REST client with session', () => {
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
      })

      const session = mockSession()
      const client = new shopify.clients.Rest({ session })

      expect(client).toBeDefined()
    })
  })

  describe('get', () => {
    it('should make GET requests', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products.json`,
            {
              status: 200,
              body: { products: [mockProduct()] },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({ path: 'products' })

      expect(response.body.products).toHaveLength(1)
      expect(response.body.products[0].id).toBe(1234567890)
    })

    it('should handle query parameters', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products.json`,
            {
              status: 200,
              body: { products: [mockProduct()] },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      await client.get({
        path: 'products',
        query: { limit: 10, status: 'active' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.anything()
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=active'),
        expect.anything()
      )
    })
  })

  describe('post', () => {
    it('should make POST requests with data', async () => {
      const expectedProduct = mockProduct()
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products.json`,
            {
              status: 201,
              body: { product: expectedProduct },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'products',
        data: {
          product: {
            title: 'Test Product',
            body_html: '<p>Test description</p>',
            vendor: 'Test Vendor',
          },
        },
      })

      expect(response.body.product.id).toBe(1234567890)
    })
  })

  describe('put', () => {
    it('should make PUT requests for updates', async () => {
      const updatedProduct = mockProduct({ title: 'Updated Title' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/products/1234567890.json`,
            {
              status: 200,
              body: { product: updatedProduct },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'products/1234567890',
        data: { product: { title: 'Updated Title' } },
      })

      expect(response.body.product.title).toBe('Updated Title')
    })
  })

  describe('delete', () => {
    it('should make DELETE requests', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /admin/api/${LATEST_API_VERSION}/products/1234567890.json`,
            { status: 200, body: {} },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.delete({ path: 'products/1234567890' })

      expect(response.body).toEqual({})
    })
  })

  describe('error handling', () => {
    it('should throw error on 404', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products/nonexistent.json`,
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
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })

      await expect(client.get({ path: 'products/nonexistent' })).rejects.toThrow()
    })

    it('should handle rate limiting', async () => {
      const callCount = { count: 0 }
      const mockFetch = vi.fn(async () => {
        callCount.count++
        if (callCount.count === 1) {
          return {
            ok: false,
            status: 429,
            headers: new Headers({
              'Retry-After': '1',
              'x-request-id': 'req_mock',
            }),
            json: async () => ({ errors: 'Throttled' }),
            text: async () => JSON.stringify({ errors: 'Throttled' }),
          }
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'x-request-id': 'req_mock' }),
          json: async () => ({ products: [mockProduct()] }),
          text: async () => JSON.stringify({ products: [mockProduct()] }),
        }
      })

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
        retries: 2,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({ path: 'products' })

      expect(callCount.count).toBe(2)
      expect(response.body.products).toHaveLength(1)
    })
  })
})

// =============================================================================
// Products Tests
// =============================================================================

describe('@dotdo/shopify - Products', () => {
  describe('list', () => {
    it('should list products', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products.json`,
            {
              status: 200,
              body: { products: [mockProduct(), mockProduct({ id: 2222222222 })] },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({ path: 'products' })

      expect(response.body.products).toHaveLength(2)
    })

    it('should support pagination', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products.json`,
            {
              status: 200,
              body: { products: [mockProduct()] },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      await client.get({
        path: 'products',
        query: { limit: 50, since_id: 1234567890 },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=50'),
        expect.anything()
      )
    })
  })

  describe('get', () => {
    it('should get a single product', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products/1234567890.json`,
            {
              status: 200,
              body: { product: mockProduct() },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({ path: 'products/1234567890' })

      expect(response.body.product.id).toBe(1234567890)
      expect(response.body.product.title).toBe('Test Product')
    })
  })

  describe('create', () => {
    it('should create a product', async () => {
      const newProduct = mockProduct()
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products.json`,
            {
              status: 201,
              body: { product: newProduct },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'products',
        data: {
          product: {
            title: 'Test Product',
            body_html: '<p>Test description</p>',
            vendor: 'Test Vendor',
            variants: [
              {
                price: '29.99',
                sku: 'TEST-SKU-001',
              },
            ],
          },
        },
      })

      expect(response.body.product.id).toBeDefined()
      expect(response.body.product.title).toBe('Test Product')
    })

    it('should create a product with variants', async () => {
      const productWithVariants = mockProduct({
        variants: [
          mockVariant({ title: 'Small', option1: 'Small', price: '29.99' }),
          mockVariant({ id: 9876543211, title: 'Medium', option1: 'Medium', price: '34.99' }),
          mockVariant({ id: 9876543212, title: 'Large', option1: 'Large', price: '39.99' }),
        ],
        options: [{ id: 1, product_id: 1234567890, name: 'Size', position: 1, values: ['Small', 'Medium', 'Large'] }],
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products.json`,
            {
              status: 201,
              body: { product: productWithVariants },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'products',
        data: {
          product: {
            title: 'Test Product',
            options: [{ name: 'Size' }],
            variants: [
              { option1: 'Small', price: '29.99' },
              { option1: 'Medium', price: '34.99' },
              { option1: 'Large', price: '39.99' },
            ],
          },
        },
      })

      expect(response.body.product.variants).toHaveLength(3)
    })
  })

  describe('update', () => {
    it('should update a product', async () => {
      const updatedProduct = mockProduct({ title: 'Updated Product' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/products/1234567890.json`,
            {
              status: 200,
              body: { product: updatedProduct },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'products/1234567890',
        data: { product: { title: 'Updated Product' } },
      })

      expect(response.body.product.title).toBe('Updated Product')
    })
  })

  describe('delete', () => {
    it('should delete a product', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /admin/api/${LATEST_API_VERSION}/products/1234567890.json`,
            { status: 200, body: {} },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.delete({ path: 'products/1234567890' })

      expect(response.body).toEqual({})
    })
  })

  describe('variants', () => {
    it('should list product variants', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products/1234567890/variants.json`,
            {
              status: 200,
              body: { variants: [mockVariant()] },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({ path: 'products/1234567890/variants' })

      expect(response.body.variants).toHaveLength(1)
    })

    it('should create a variant', async () => {
      const newVariant = mockVariant({ title: 'New Variant' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products/1234567890/variants.json`,
            {
              status: 201,
              body: { variant: newVariant },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'products/1234567890/variants',
        data: { variant: { option1: 'New Variant', price: '49.99' } },
      })

      expect(response.body.variant.title).toBe('New Variant')
    })

    it('should update a variant', async () => {
      const updatedVariant = mockVariant({ price: '39.99' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/variants/9876543210.json`,
            {
              status: 200,
              body: { variant: updatedVariant },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'variants/9876543210',
        data: { variant: { price: '39.99' } },
      })

      expect(response.body.variant.price).toBe('39.99')
    })

    it('should delete a variant', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /admin/api/${LATEST_API_VERSION}/products/1234567890/variants/9876543210.json`,
            { status: 200, body: {} },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.delete({ path: 'products/1234567890/variants/9876543210' })

      expect(response.body).toEqual({})
    })
  })
})

// =============================================================================
// Orders Tests
// =============================================================================

describe('@dotdo/shopify - Orders', () => {
  describe('list', () => {
    it('should list orders', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/orders.json`,
            {
              status: 200,
              body: { orders: [mockOrder()] },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_orders'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({ path: 'orders' })

      expect(response.body.orders).toHaveLength(1)
    })

    it('should filter orders by status', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/orders.json`,
            {
              status: 200,
              body: { orders: [mockOrder({ financial_status: 'pending' })] },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_orders'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      await client.get({
        path: 'orders',
        query: { status: 'any', financial_status: 'pending' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('financial_status=pending'),
        expect.anything()
      )
    })
  })

  describe('get', () => {
    it('should get a single order', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/orders/1234567890.json`,
            {
              status: 200,
              body: { order: mockOrder() },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_orders'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({ path: 'orders/1234567890' })

      expect(response.body.order.id).toBe(1234567890)
      expect(response.body.order.name).toBe('#1001')
    })
  })

  describe('create', () => {
    it('should create an order', async () => {
      const newOrder = mockOrder()
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/orders.json`,
            {
              status: 201,
              body: { order: newOrder },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_orders'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'orders',
        data: {
          order: {
            line_items: [
              { variant_id: 9876543210, quantity: 2 },
            ],
            customer: { id: 5555555555 },
            financial_status: 'paid',
          },
        },
      })

      expect(response.body.order.id).toBeDefined()
    })
  })

  describe('update', () => {
    it('should update an order', async () => {
      const updatedOrder = mockOrder({ note: 'Updated note' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/orders/1234567890.json`,
            {
              status: 200,
              body: { order: updatedOrder },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_orders'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'orders/1234567890',
        data: { order: { note: 'Updated note' } },
      })

      expect(response.body.order.note).toBe('Updated note')
    })
  })

  describe('fulfill', () => {
    it('should create a fulfillment for an order', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/orders/1234567890/fulfillments.json`,
            {
              status: 201,
              body: {
                fulfillment: {
                  id: 8888888888,
                  order_id: 1234567890,
                  status: 'success',
                  tracking_company: 'USPS',
                  tracking_number: '1234567890',
                  tracking_url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=1234567890',
                  line_items: [mockOrder().line_items[0]],
                  created_at: '2024-01-01T00:00:00Z',
                  updated_at: '2024-01-01T00:00:00Z',
                },
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_orders'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'orders/1234567890/fulfillments',
        data: {
          fulfillment: {
            tracking_number: '1234567890',
            tracking_company: 'USPS',
            notify_customer: true,
          },
        },
      })

      expect(response.body.fulfillment.status).toBe('success')
      expect(response.body.fulfillment.tracking_number).toBe('1234567890')
    })
  })

  describe('refund', () => {
    it('should create a refund for an order', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/orders/1234567890/refunds.json`,
            {
              status: 201,
              body: {
                refund: {
                  id: 7777777777,
                  order_id: 1234567890,
                  created_at: '2024-01-02T00:00:00Z',
                  note: 'Customer requested refund',
                  restock: true,
                  refund_line_items: [
                    {
                      id: 111,
                      line_item_id: 111,
                      quantity: 1,
                      restock_type: 'return',
                      location_id: 7777777777,
                      subtotal: 29.99,
                      total_tax: 0,
                    },
                  ],
                  transactions: [
                    {
                      id: 9999999999,
                      order_id: 1234567890,
                      kind: 'refund',
                      amount: '29.99',
                      status: 'success',
                      gateway: 'shopify_payments',
                    },
                  ],
                },
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_orders'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'orders/1234567890/refunds',
        data: {
          refund: {
            note: 'Customer requested refund',
            restock: true,
            refund_line_items: [
              {
                line_item_id: 111,
                quantity: 1,
                restock_type: 'return',
              },
            ],
          },
        },
      })

      expect(response.body.refund.id).toBeDefined()
      expect(response.body.refund.refund_line_items).toHaveLength(1)
    })

    it('should calculate refund amounts', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/orders/1234567890/refunds/calculate.json`,
            {
              status: 200,
              body: {
                refund: {
                  shipping: { amount: '0.00' },
                  refund_line_items: [
                    {
                      line_item_id: 111,
                      quantity: 1,
                      subtotal: 29.99,
                      total_tax: 0,
                    },
                  ],
                  transactions: [
                    {
                      amount: '29.99',
                      kind: 'suggested_refund',
                      gateway: 'shopify_payments',
                    },
                  ],
                },
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_orders'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'orders/1234567890/refunds/calculate',
        data: {
          refund: {
            refund_line_items: [
              { line_item_id: 111, quantity: 1 },
            ],
          },
        },
      })

      expect(response.body.refund.transactions[0].amount).toBe('29.99')
    })
  })
})

// =============================================================================
// Customers Tests
// =============================================================================

describe('@dotdo/shopify - Customers', () => {
  describe('list', () => {
    it('should list customers', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers.json`,
            {
              status: 200,
              body: { customers: [mockCustomer()] },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_customers'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({ path: 'customers' })

      expect(response.body.customers).toHaveLength(1)
    })
  })

  describe('get', () => {
    it('should get a single customer', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/5555555555.json`,
            {
              status: 200,
              body: { customer: mockCustomer() },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_customers'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({ path: 'customers/5555555555' })

      expect(response.body.customer.id).toBe(5555555555)
      expect(response.body.customer.email).toBe('customer@example.com')
    })
  })

  describe('create', () => {
    it('should create a customer', async () => {
      const newCustomer = mockCustomer()
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/customers.json`,
            {
              status: 201,
              body: { customer: newCustomer },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_customers'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'customers',
        data: {
          customer: {
            first_name: 'John',
            last_name: 'Doe',
            email: 'customer@example.com',
          },
        },
      })

      expect(response.body.customer.id).toBeDefined()
    })
  })

  describe('update', () => {
    it('should update a customer', async () => {
      const updatedCustomer = mockCustomer({ first_name: 'Jane' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/customers/5555555555.json`,
            {
              status: 200,
              body: { customer: updatedCustomer },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_customers'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.put({
        path: 'customers/5555555555',
        data: { customer: { first_name: 'Jane' } },
      })

      expect(response.body.customer.first_name).toBe('Jane')
    })
  })

  describe('search', () => {
    it('should search customers', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/search.json`,
            {
              status: 200,
              body: { customers: [mockCustomer()] },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_customers'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({
        path: 'customers/search',
        query: { query: 'email:customer@example.com' },
      })

      expect(response.body.customers).toHaveLength(1)
      expect(response.body.customers[0].email).toBe('customer@example.com')
    })
  })
})

// =============================================================================
// Inventory Tests
// =============================================================================

describe('@dotdo/shopify - Inventory', () => {
  describe('locations', () => {
    it('should list locations', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/locations.json`,
            {
              status: 200,
              body: { locations: [mockLocation()] },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_inventory'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({ path: 'locations' })

      expect(response.body.locations).toHaveLength(1)
      expect(response.body.locations[0].name).toBe('Main Warehouse')
    })

    it('should get a single location', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/locations/7777777777.json`,
            {
              status: 200,
              body: { location: mockLocation() },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_inventory'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({ path: 'locations/7777777777' })

      expect(response.body.location.id).toBe(7777777777)
    })
  })

  describe('inventory levels', () => {
    it('should list inventory levels', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/inventory_levels.json`,
            {
              status: 200,
              body: { inventory_levels: [mockInventoryLevel()] },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_inventory'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({
        path: 'inventory_levels',
        query: { location_ids: '7777777777' },
      })

      expect(response.body.inventory_levels).toHaveLength(1)
    })

    it('should adjust inventory levels', async () => {
      const adjustedLevel = mockInventoryLevel({ available: 90 })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/inventory_levels/adjust.json`,
            {
              status: 200,
              body: { inventory_level: adjustedLevel },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_inventory'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'inventory_levels/adjust',
        data: {
          location_id: 7777777777,
          inventory_item_id: 1111111111,
          available_adjustment: -10,
        },
      })

      expect(response.body.inventory_level.available).toBe(90)
    })

    it('should set inventory levels', async () => {
      const setLevel = mockInventoryLevel({ available: 50 })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/inventory_levels/set.json`,
            {
              status: 200,
              body: { inventory_level: setLevel },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_inventory'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'inventory_levels/set',
        data: {
          location_id: 7777777777,
          inventory_item_id: 1111111111,
          available: 50,
        },
      })

      expect(response.body.inventory_level.available).toBe(50)
    })

    it('should connect inventory item to location', async () => {
      const connectedLevel = mockInventoryLevel({ available: 0 })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/inventory_levels/connect.json`,
            {
              status: 201,
              body: { inventory_level: connectedLevel },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_inventory'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'inventory_levels/connect',
        data: {
          location_id: 7777777777,
          inventory_item_id: 1111111111,
        },
      })

      expect(response.body.inventory_level.inventory_item_id).toBe(1111111111)
      expect(response.body.inventory_level.location_id).toBe(7777777777)
    })
  })
})

// =============================================================================
// Webhook Tests
// =============================================================================

describe('@dotdo/shopify - Webhooks', () => {
  describe('validate', () => {
    it('should validate webhook signature', async () => {
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
      })

      const rawBody = JSON.stringify({ id: 1234567890, title: 'Test Product' })
      // Generate a valid HMAC for testing
      const hmac = await shopify.webhooks.generateTestHmac(rawBody)

      const isValid = await shopify.webhooks.validate({
        rawBody,
        hmac,
      })

      expect(isValid).toBe(true)
    })

    it('should reject invalid webhook signature', async () => {
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
      })

      const rawBody = JSON.stringify({ id: 1234567890, title: 'Test Product' })

      const isValid = await shopify.webhooks.validate({
        rawBody,
        hmac: 'invalid-hmac',
      })

      expect(isValid).toBe(false)
    })

    it('should validate webhook with ArrayBuffer body', async () => {
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
      })

      const rawBody = JSON.stringify({ id: 1234567890 })
      const encoder = new TextEncoder()
      const rawBodyBuffer = encoder.encode(rawBody).buffer

      const hmac = await shopify.webhooks.generateTestHmac(rawBody)

      const isValid = await shopify.webhooks.validate({
        rawBody: rawBodyBuffer,
        hmac,
      })

      expect(isValid).toBe(true)
    })
  })

  describe('register', () => {
    it('should register a webhook subscription', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/webhooks.json`,
            {
              status: 201,
              body: {
                webhook: {
                  id: 1234567890,
                  address: 'https://myapp.com/webhooks/products/create',
                  topic: 'products/create',
                  format: 'json',
                  created_at: '2024-01-01T00:00:00Z',
                  updated_at: '2024-01-01T00:00:00Z',
                },
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.post({
        path: 'webhooks',
        data: {
          webhook: {
            topic: 'products/create',
            address: 'https://myapp.com/webhooks/products/create',
            format: 'json',
          },
        },
      })

      expect(response.body.webhook.id).toBeDefined()
      expect(response.body.webhook.topic).toBe('products/create')
    })

    it('should list webhook subscriptions', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/webhooks.json`,
            {
              status: 200,
              body: {
                webhooks: [
                  {
                    id: 1234567890,
                    address: 'https://myapp.com/webhooks/products/create',
                    topic: 'products/create',
                    format: 'json',
                  },
                ],
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({ path: 'webhooks' })

      expect(response.body.webhooks).toHaveLength(1)
    })

    it('should delete a webhook subscription', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /admin/api/${LATEST_API_VERSION}/webhooks/1234567890.json`,
            { status: 200, body: {} },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.delete({ path: 'webhooks/1234567890' })

      expect(response.body).toEqual({})
    })
  })
})

// =============================================================================
// GraphQL Client Tests
// =============================================================================

describe('@dotdo/shopify - GraphQL Client', () => {
  describe('query', () => {
    it('should execute GraphQL queries', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/graphql.json`,
            {
              status: 200,
              body: {
                data: {
                  shop: {
                    name: 'My Shop',
                    email: 'shop@example.com',
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
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Graphql({ session: mockSession() })
      const response = await client.query({
        data: `query { shop { name email } }`,
      })

      expect(response.body.data.shop.name).toBe('My Shop')
    })

    it('should handle GraphQL mutations', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/graphql.json`,
            {
              status: 200,
              body: {
                data: {
                  productCreate: {
                    product: {
                      id: 'gid://shopify/Product/1234567890',
                      title: 'New Product',
                    },
                    userErrors: [],
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
        scopes: ['write_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Graphql({ session: mockSession() })
      const response = await client.query({
        data: {
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
            input: { title: 'New Product' },
          },
        },
      })

      expect(response.body.data.productCreate.product.title).toBe('New Product')
      expect(response.body.data.productCreate.userErrors).toHaveLength(0)
    })

    it('should handle GraphQL errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/graphql.json`,
            {
              status: 200,
              body: {
                data: null,
                errors: [
                  {
                    message: 'Field "nonexistent" not found',
                    locations: [{ line: 1, column: 1 }],
                    path: ['query'],
                  },
                ],
              },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Graphql({ session: mockSession() })
      const response = await client.query({
        data: `query { nonexistent }`,
      })

      expect(response.body.errors).toBeDefined()
      expect(response.body.errors).toHaveLength(1)
    })
  })
})

// =============================================================================
// API Version Tests
// =============================================================================

describe('@dotdo/shopify - API Versions', () => {
  it('should export LATEST_API_VERSION', () => {
    expect(LATEST_API_VERSION).toBeDefined()
    expect(LATEST_API_VERSION).toMatch(/^\d{4}-\d{2}$/)
  })

  it('should use configured API version in requests', async () => {
    const mockFetch = createMockFetch(
      new Map([
        [
          'GET /admin/api/2024-01/products.json',
          {
            status: 200,
            body: { products: [] },
          },
        ],
      ])
    )

    const shopify = shopifyApi({
      apiKey: 'test-api-key',
      apiSecretKey: 'test-api-secret',
      scopes: ['read_products'],
      hostName: 'myshop.myshopify.com',
      apiVersion: '2024-01',
      fetch: mockFetch,
    })

    const client = new shopify.clients.Rest({ session: mockSession() })
    await client.get({ path: 'products' })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/api/2024-01/'),
      expect.anything()
    )
  })
})
