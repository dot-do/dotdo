/**
 * @dotdo/shopify - Customers API Tests (TDD RED Phase)
 *
 * Comprehensive tests for Shopify Customers API compatibility layer.
 * Following Shopify Admin API patterns for:
 * - Customer CRUD operations
 * - Customer addresses management
 * - Customer search and filtering
 * - Customer tags and segments
 * - Customer metafields
 * - Account activation/deactivation
 *
 * @see https://shopify.dev/docs/api/admin-rest/latest/resources/customer
 * @module @dotdo/shopify/tests/customers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  shopifyApi,
  LATEST_API_VERSION,
  type ShopifyConfig,
  type Session,
  type Customer,
  type CustomerAddress,
} from '../index'
import { CustomersResource, AddressesResource } from '../customers'

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
    scope: 'read_customers,write_customers',
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
    addresses: [mockAddress()],
    default_address: mockAddress(),
    admin_graphql_api_id: 'gid://shopify/Customer/5555555555',
    ...overrides,
  }
}

function mockAddress(overrides: Partial<CustomerAddress> = {}): CustomerAddress {
  return {
    id: 111,
    customer_id: 5555555555,
    first_name: 'John',
    last_name: 'Doe',
    company: null,
    address1: '123 Main St',
    address2: null,
    city: 'New York',
    province: 'New York',
    country: 'United States',
    zip: '10001',
    phone: '+1234567890',
    name: 'John Doe',
    province_code: 'NY',
    country_code: 'US',
    country_name: 'United States',
    default: true,
    ...overrides,
  }
}

interface CustomerMetafield {
  id: number
  namespace: string
  key: string
  value: string
  type: string
  owner_id: number
  owner_resource: string
  created_at: string
  updated_at: string
}

function mockMetafield(overrides: Partial<CustomerMetafield> = {}): CustomerMetafield {
  return {
    id: 999,
    namespace: 'custom',
    key: 'loyalty_tier',
    value: 'gold',
    type: 'single_line_text_field',
    owner_id: 5555555555,
    owner_resource: 'customer',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// =============================================================================
// Customer CRUD Operations Tests
// =============================================================================

describe('@dotdo/shopify - Customers CRUD', () => {
  describe('list', () => {
    it('should list all customers', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers.json`,
            {
              status: 200,
              body: { customers: [mockCustomer(), mockCustomer({ id: 6666666666, email: 'jane@example.com' })] },
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

      expect(response.body.customers).toHaveLength(2)
      expect(response.body.customers[0].email).toBe('customer@example.com')
      expect(response.body.customers[1].email).toBe('jane@example.com')
    })

    it('should list customers with pagination', async () => {
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
      await client.get({
        path: 'customers',
        query: { limit: 50, since_id: 5555555554 },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=50'),
        expect.anything()
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('since_id=5555555554'),
        expect.anything()
      )
    })

    it('should filter customers by date range', async () => {
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
      await client.get({
        path: 'customers',
        query: {
          created_at_min: '2024-01-01T00:00:00Z',
          created_at_max: '2024-12-31T23:59:59Z',
        },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('created_at_min='),
        expect.anything()
      )
    })

    it('should filter customers by IDs', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers.json`,
            {
              status: 200,
              body: { customers: [mockCustomer(), mockCustomer({ id: 6666666666 })] },
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
      await client.get({
        path: 'customers',
        query: { ids: '5555555555,6666666666' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('ids=5555555555%2C6666666666'),
        expect.anything()
      )
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
      expect(response.body.customer.first_name).toBe('John')
      expect(response.body.customer.last_name).toBe('Doe')
    })

    it('should get customer with specific fields', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/5555555555.json`,
            {
              status: 200,
              body: { customer: { id: 5555555555, email: 'customer@example.com' } },
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
      await client.get({
        path: 'customers/5555555555',
        query: { fields: 'id,email' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('fields=id%2Cemail'),
        expect.anything()
      )
    })

    it('should handle customer not found', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/nonexistent.json`,
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
        scopes: ['read_customers'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })

      await expect(client.get({ path: 'customers/nonexistent' })).rejects.toThrow()
    })
  })

  describe('create', () => {
    it('should create a customer with basic info', async () => {
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
      expect(response.body.customer.email).toBe('customer@example.com')
    })

    it('should create a customer with addresses', async () => {
      const customerWithAddresses = mockCustomer({
        addresses: [
          mockAddress(),
          mockAddress({ id: 222, address1: '456 Second Ave', default: false }),
        ],
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/customers.json`,
            {
              status: 201,
              body: { customer: customerWithAddresses },
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
            addresses: [
              { address1: '123 Main St', city: 'New York', country: 'US', zip: '10001' },
              { address1: '456 Second Ave', city: 'Brooklyn', country: 'US', zip: '11201' },
            ],
          },
        },
      })

      expect(response.body.customer.addresses).toHaveLength(2)
    })

    it('should create a customer with marketing consent', async () => {
      const customerWithMarketing = mockCustomer({
        accepts_marketing: true,
        accepts_marketing_updated_at: '2024-01-15T10:00:00Z',
        marketing_opt_in_level: 'confirmed_opt_in',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/customers.json`,
            {
              status: 201,
              body: { customer: customerWithMarketing },
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
            email: 'marketing@example.com',
            accepts_marketing: true,
            marketing_opt_in_level: 'confirmed_opt_in',
          },
        },
      })

      expect(response.body.customer.accepts_marketing).toBe(true)
      expect(response.body.customer.marketing_opt_in_level).toBe('confirmed_opt_in')
    })

    it('should create a customer and send welcome email', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/customers.json`,
            {
              status: 201,
              body: { customer: mockCustomer() },
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
      await client.post({
        path: 'customers',
        data: {
          customer: {
            email: 'newcustomer@example.com',
            send_email_welcome: true,
          },
        },
      })

      // Verify the request included send_email_welcome
      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options?.body as string)
      expect(body.customer.send_email_welcome).toBe(true)
    })

    it('should handle duplicate email error', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/customers.json`,
            {
              status: 422,
              body: { errors: { email: ['has already been taken'] } },
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

      await expect(
        client.post({
          path: 'customers',
          data: {
            customer: { email: 'existing@example.com' },
          },
        })
      ).rejects.toThrow()
    })
  })

  describe('update', () => {
    it('should update customer basic info', async () => {
      const updatedCustomer = mockCustomer({ first_name: 'Jane', last_name: 'Smith' })
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
        data: { customer: { first_name: 'Jane', last_name: 'Smith' } },
      })

      expect(response.body.customer.first_name).toBe('Jane')
      expect(response.body.customer.last_name).toBe('Smith')
    })

    it('should update customer email', async () => {
      const updatedCustomer = mockCustomer({ email: 'newemail@example.com' })
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
        data: { customer: { email: 'newemail@example.com' } },
      })

      expect(response.body.customer.email).toBe('newemail@example.com')
    })

    it('should update customer note', async () => {
      const updatedCustomer = mockCustomer({ note: 'VIP customer - handle with care' })
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
        data: { customer: { note: 'VIP customer - handle with care' } },
      })

      expect(response.body.customer.note).toBe('VIP customer - handle with care')
    })
  })

  describe('delete', () => {
    it('should delete a customer', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /admin/api/${LATEST_API_VERSION}/customers/5555555555.json`,
            {
              status: 200,
              body: {},
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
      const response = await client.delete({ path: 'customers/5555555555' })

      expect(response.body).toEqual({})
    })

    it('should handle deleting customer with orders', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /admin/api/${LATEST_API_VERSION}/customers/5555555555.json`,
            {
              status: 422,
              body: { errors: { base: ['Cannot delete customer with existing orders'] } },
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

      await expect(client.delete({ path: 'customers/5555555555' })).rejects.toThrow()
    })
  })

  describe('count', () => {
    it('should return customer count', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/count.json`,
            {
              status: 200,
              body: { count: 150 },
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
      const response = await client.get({ path: 'customers/count' })

      expect(response.body.count).toBe(150)
    })

    it('should filter count by date range', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/count.json`,
            {
              status: 200,
              body: { count: 25 },
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
      await client.get({
        path: 'customers/count',
        query: {
          created_at_min: '2024-01-01T00:00:00Z',
          created_at_max: '2024-01-31T23:59:59Z',
        },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('created_at_min='),
        expect.anything()
      )
    })
  })
})

// =============================================================================
// Customer Addresses Management Tests
// =============================================================================

describe('@dotdo/shopify - Customer Addresses', () => {
  describe('list', () => {
    it('should list all addresses for a customer', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/5555555555/addresses.json`,
            {
              status: 200,
              body: {
                addresses: [
                  mockAddress(),
                  mockAddress({ id: 222, address1: '456 Second Ave', default: false }),
                ],
              },
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
      const response = await client.get({ path: 'customers/5555555555/addresses' })

      expect(response.body.addresses).toHaveLength(2)
      expect(response.body.addresses[0].default).toBe(true)
    })
  })

  describe('get', () => {
    it('should get a single address', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/5555555555/addresses/111.json`,
            {
              status: 200,
              body: { customer_address: mockAddress() },
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
      const response = await client.get({ path: 'customers/5555555555/addresses/111' })

      expect(response.body.customer_address.id).toBe(111)
      expect(response.body.customer_address.address1).toBe('123 Main St')
    })
  })

  describe('create', () => {
    it('should create a new address', async () => {
      const newAddress = mockAddress({ id: 333, address1: '789 Third Blvd' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/customers/5555555555/addresses.json`,
            {
              status: 201,
              body: { customer_address: newAddress },
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
        path: 'customers/5555555555/addresses',
        data: {
          address: {
            address1: '789 Third Blvd',
            city: 'Los Angeles',
            province: 'California',
            country: 'United States',
            zip: '90001',
          },
        },
      })

      expect(response.body.customer_address.id).toBe(333)
      expect(response.body.customer_address.address1).toBe('789 Third Blvd')
    })

    it('should create address with company', async () => {
      const companyAddress = mockAddress({
        id: 444,
        company: 'Acme Corp',
        address1: '100 Corporate Dr',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/customers/5555555555/addresses.json`,
            {
              status: 201,
              body: { customer_address: companyAddress },
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
        path: 'customers/5555555555/addresses',
        data: {
          address: {
            company: 'Acme Corp',
            address1: '100 Corporate Dr',
            city: 'San Francisco',
            country: 'US',
            zip: '94102',
          },
        },
      })

      expect(response.body.customer_address.company).toBe('Acme Corp')
    })
  })

  describe('update', () => {
    it('should update an address', async () => {
      const updatedAddress = mockAddress({ address1: '999 Updated St' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/customers/5555555555/addresses/111.json`,
            {
              status: 200,
              body: { customer_address: updatedAddress },
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
        path: 'customers/5555555555/addresses/111',
        data: { address: { address1: '999 Updated St' } },
      })

      expect(response.body.customer_address.address1).toBe('999 Updated St')
    })
  })

  describe('delete', () => {
    it('should delete an address', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /admin/api/${LATEST_API_VERSION}/customers/5555555555/addresses/222.json`,
            {
              status: 200,
              body: {},
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
      const response = await client.delete({
        path: 'customers/5555555555/addresses/222',
      })

      expect(response.body).toEqual({})
    })

    it('should not delete the last default address', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /admin/api/${LATEST_API_VERSION}/customers/5555555555/addresses/111.json`,
            {
              status: 422,
              body: { errors: { base: ['Cannot delete the default address'] } },
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

      await expect(
        client.delete({ path: 'customers/5555555555/addresses/111' })
      ).rejects.toThrow()
    })
  })

  describe('set default', () => {
    it('should set an address as default', async () => {
      const defaultAddress = mockAddress({ id: 222, default: true })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/customers/5555555555/addresses/222/default.json`,
            {
              status: 200,
              body: { customer_address: defaultAddress },
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
        path: 'customers/5555555555/addresses/222/default',
        data: {},
      })

      expect(response.body.customer_address.default).toBe(true)
    })
  })

  describe('bulk operations', () => {
    it('should bulk delete addresses', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/customers/5555555555/addresses/set.json`,
            {
              status: 200,
              body: {},
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
      await client.put({
        path: 'customers/5555555555/addresses/set',
        query: { 'address_ids[]': '222,333', operation: 'destroy' },
        data: {},
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('operation=destroy'),
        expect.anything()
      )
    })
  })
})

// =============================================================================
// Customer Search and Filtering Tests
// =============================================================================

describe('@dotdo/shopify - Customer Search', () => {
  describe('search', () => {
    it('should search customers by email', async () => {
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

    it('should search customers by name', async () => {
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
      await client.get({
        path: 'customers/search',
        query: { query: 'first_name:John' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('query=first_name%3AJohn'),
        expect.anything()
      )
    })

    it('should search customers by phone', async () => {
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
      await client.get({
        path: 'customers/search',
        query: { query: 'phone:+1234567890' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('query='),
        expect.anything()
      )
    })

    it('should search customers with compound query', async () => {
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
      await client.get({
        path: 'customers/search',
        query: { query: 'state:enabled AND accepts_marketing:true' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('query='),
        expect.anything()
      )
    })

    it('should search with order by total_spent', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/search.json`,
            {
              status: 200,
              body: {
                customers: [
                  mockCustomer({ total_spent: '500.00' }),
                  mockCustomer({ id: 6666666666, total_spent: '250.00' }),
                ],
              },
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
      await client.get({
        path: 'customers/search',
        query: { query: '*', order: 'total_spent DESC' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('order=total_spent'),
        expect.anything()
      )
    })

    it('should search and limit results', async () => {
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
      await client.get({
        path: 'customers/search',
        query: { query: '*', limit: 10 },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.anything()
      )
    })
  })

  describe('filter by state', () => {
    it('should filter enabled customers', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/search.json`,
            {
              status: 200,
              body: { customers: [mockCustomer({ state: 'enabled' })] },
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
        query: { query: 'state:enabled' },
      })

      expect(response.body.customers[0].state).toBe('enabled')
    })

    it('should filter disabled customers', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/search.json`,
            {
              status: 200,
              body: { customers: [mockCustomer({ state: 'disabled' })] },
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
        query: { query: 'state:disabled' },
      })

      expect(response.body.customers[0].state).toBe('disabled')
    })

    it('should filter invited customers', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/search.json`,
            {
              status: 200,
              body: { customers: [mockCustomer({ state: 'invited' })] },
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
        query: { query: 'state:invited' },
      })

      expect(response.body.customers[0].state).toBe('invited')
    })
  })
})

// =============================================================================
// Customer Tags and Segments Tests
// =============================================================================

describe('@dotdo/shopify - Customer Tags', () => {
  describe('manage tags', () => {
    it('should create customer with tags', async () => {
      const customerWithTags = mockCustomer({ tags: 'vip, loyal, wholesale' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/customers.json`,
            {
              status: 201,
              body: { customer: customerWithTags },
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
            email: 'tagged@example.com',
            tags: 'vip, loyal, wholesale',
          },
        },
      })

      expect(response.body.customer.tags).toBe('vip, loyal, wholesale')
    })

    it('should update customer tags', async () => {
      const updatedCustomer = mockCustomer({ tags: 'vip, premium' })
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
        data: { customer: { tags: 'vip, premium' } },
      })

      expect(response.body.customer.tags).toBe('vip, premium')
    })

    it('should search customers by tag', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/search.json`,
            {
              status: 200,
              body: { customers: [mockCustomer({ tags: 'vip' })] },
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
        query: { query: 'tag:vip' },
      })

      expect(response.body.customers[0].tags).toContain('vip')
    })

    it('should clear customer tags', async () => {
      const customerNoTags = mockCustomer({ tags: '' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/customers/5555555555.json`,
            {
              status: 200,
              body: { customer: customerNoTags },
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
        data: { customer: { tags: '' } },
      })

      expect(response.body.customer.tags).toBe('')
    })
  })

  describe('tax exemptions', () => {
    it('should set tax exempt status', async () => {
      const taxExemptCustomer = mockCustomer({
        tax_exempt: true,
        tax_exemptions: ['CA_STATE_TAX', 'CA_COUNTY_TAX'],
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/customers/5555555555.json`,
            {
              status: 200,
              body: { customer: taxExemptCustomer },
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
        data: {
          customer: {
            tax_exempt: true,
            tax_exemptions: ['CA_STATE_TAX', 'CA_COUNTY_TAX'],
          },
        },
      })

      expect(response.body.customer.tax_exempt).toBe(true)
      expect(response.body.customer.tax_exemptions).toContain('CA_STATE_TAX')
    })
  })
})

// =============================================================================
// Customer Metafields Tests
// =============================================================================

describe('@dotdo/shopify - Customer Metafields', () => {
  describe('list metafields', () => {
    it('should list customer metafields', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/5555555555/metafields.json`,
            {
              status: 200,
              body: {
                metafields: [
                  mockMetafield(),
                  mockMetafield({ id: 1000, key: 'birthday', value: '1990-05-15' }),
                ],
              },
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
      const response = await client.get({ path: 'customers/5555555555/metafields' })

      expect(response.body.metafields).toHaveLength(2)
    })
  })

  describe('get metafield', () => {
    it('should get a single metafield', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/5555555555/metafields/999.json`,
            {
              status: 200,
              body: { metafield: mockMetafield() },
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
      const response = await client.get({ path: 'customers/5555555555/metafields/999' })

      expect(response.body.metafield.namespace).toBe('custom')
      expect(response.body.metafield.key).toBe('loyalty_tier')
      expect(response.body.metafield.value).toBe('gold')
    })
  })

  describe('create metafield', () => {
    it('should create a customer metafield', async () => {
      const newMetafield = mockMetafield({ id: 1001, key: 'membership_id', value: 'MEM-12345' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/customers/5555555555/metafields.json`,
            {
              status: 201,
              body: { metafield: newMetafield },
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
        path: 'customers/5555555555/metafields',
        data: {
          metafield: {
            namespace: 'custom',
            key: 'membership_id',
            value: 'MEM-12345',
            type: 'single_line_text_field',
          },
        },
      })

      expect(response.body.metafield.key).toBe('membership_id')
      expect(response.body.metafield.value).toBe('MEM-12345')
    })

    it('should create metafield with JSON value', async () => {
      const jsonMetafield = mockMetafield({
        id: 1002,
        key: 'preferences',
        value: '{"newsletter":true,"sms":false}',
        type: 'json',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/customers/5555555555/metafields.json`,
            {
              status: 201,
              body: { metafield: jsonMetafield },
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
        path: 'customers/5555555555/metafields',
        data: {
          metafield: {
            namespace: 'custom',
            key: 'preferences',
            value: '{"newsletter":true,"sms":false}',
            type: 'json',
          },
        },
      })

      expect(response.body.metafield.type).toBe('json')
    })
  })

  describe('update metafield', () => {
    it('should update a customer metafield', async () => {
      const updatedMetafield = mockMetafield({ value: 'platinum' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/customers/5555555555/metafields/999.json`,
            {
              status: 200,
              body: { metafield: updatedMetafield },
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
        path: 'customers/5555555555/metafields/999',
        data: { metafield: { value: 'platinum' } },
      })

      expect(response.body.metafield.value).toBe('platinum')
    })
  })

  describe('delete metafield', () => {
    it('should delete a customer metafield', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /admin/api/${LATEST_API_VERSION}/customers/5555555555/metafields/999.json`,
            {
              status: 200,
              body: {},
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
      const response = await client.delete({
        path: 'customers/5555555555/metafields/999',
      })

      expect(response.body).toEqual({})
    })
  })

  describe('count metafields', () => {
    it('should count customer metafields', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/5555555555/metafields/count.json`,
            {
              status: 200,
              body: { count: 5 },
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
        path: 'customers/5555555555/metafields/count',
      })

      expect(response.body.count).toBe(5)
    })
  })
})

// =============================================================================
// Account Activation/Deactivation Tests
// =============================================================================

describe('@dotdo/shopify - Customer Account Management', () => {
  describe('send invite', () => {
    it('should send account invite', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/customers/5555555555/send_invite.json`,
            {
              status: 200,
              body: {
                customer_invite: {
                  to: 'customer@example.com',
                  from: 'store@myshop.com',
                  subject: 'Welcome to our store!',
                  custom_message: 'We are excited to have you!',
                  bcc: [],
                },
              },
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
        path: 'customers/5555555555/send_invite',
        data: { customer_invite: {} },
      })

      expect(response.body.customer_invite.to).toBe('customer@example.com')
    })

    it('should send invite with custom message', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/customers/5555555555/send_invite.json`,
            {
              status: 200,
              body: {
                customer_invite: {
                  to: 'customer@example.com',
                  from: 'store@myshop.com',
                  subject: 'Your VIP Access',
                  custom_message: 'As a VIP member, you get special perks!',
                  bcc: ['admin@myshop.com'],
                },
              },
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
        path: 'customers/5555555555/send_invite',
        data: {
          customer_invite: {
            subject: 'Your VIP Access',
            custom_message: 'As a VIP member, you get special perks!',
            bcc: ['admin@myshop.com'],
          },
        },
      })

      expect(response.body.customer_invite.subject).toBe('Your VIP Access')
      expect(response.body.customer_invite.bcc).toContain('admin@myshop.com')
    })
  })

  describe('account activation URL', () => {
    it('should generate account activation URL', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/customers/5555555555/account_activation_url.json`,
            {
              status: 200,
              body: {
                account_activation_url: 'https://myshop.myshopify.com/account/activate/5555555555/abc123token',
              },
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
        path: 'customers/5555555555/account_activation_url',
        data: {},
      })

      expect(response.body.account_activation_url).toContain('account/activate')
    })
  })

  describe('disable/enable account', () => {
    it('should disable customer account', async () => {
      const disabledCustomer = mockCustomer({ state: 'disabled' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/customers/5555555555.json`,
            {
              status: 200,
              body: { customer: disabledCustomer },
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
        data: { customer: { state: 'disabled' } },
      })

      expect(response.body.customer.state).toBe('disabled')
    })

    it('should re-enable customer account', async () => {
      const enabledCustomer = mockCustomer({ state: 'enabled' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/customers/5555555555.json`,
            {
              status: 200,
              body: { customer: enabledCustomer },
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
        data: { customer: { state: 'enabled' } },
      })

      expect(response.body.customer.state).toBe('enabled')
    })
  })

  describe('password reset', () => {
    it('should trigger password reset for customer', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/customers/5555555555/password_reset.json`,
            {
              status: 200,
              body: {
                customer: mockCustomer(),
              },
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
        path: 'customers/5555555555/password_reset',
        data: {},
      })

      expect(response.body.customer.id).toBe(5555555555)
    })
  })
})

// =============================================================================
// Customer Orders History Tests
// =============================================================================

describe('@dotdo/shopify - Customer Orders', () => {
  describe('list orders', () => {
    it('should get customer order history', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/5555555555/orders.json`,
            {
              status: 200,
              body: {
                orders: [
                  { id: 1234567890, name: '#1001', total_price: '59.98' },
                  { id: 1234567891, name: '#1002', total_price: '129.99' },
                ],
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
      const response = await client.get({ path: 'customers/5555555555/orders' })

      expect(response.body.orders).toHaveLength(2)
    })

    it('should filter customer orders by status', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/5555555555/orders.json`,
            {
              status: 200,
              body: {
                orders: [
                  { id: 1234567890, name: '#1001', financial_status: 'paid' },
                ],
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
      await client.get({
        path: 'customers/5555555555/orders',
        query: { status: 'closed' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=closed'),
        expect.anything()
      )
    })
  })
})

// =============================================================================
// Marketing Consent Tests
// =============================================================================

describe('@dotdo/shopify - Customer Marketing', () => {
  describe('marketing consent', () => {
    it('should update marketing consent', async () => {
      const marketingCustomer = mockCustomer({
        accepts_marketing: true,
        accepts_marketing_updated_at: '2024-06-15T10:30:00Z',
        marketing_opt_in_level: 'single_opt_in',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/customers/5555555555.json`,
            {
              status: 200,
              body: { customer: marketingCustomer },
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
        data: {
          customer: {
            accepts_marketing: true,
            marketing_opt_in_level: 'single_opt_in',
          },
        },
      })

      expect(response.body.customer.accepts_marketing).toBe(true)
      expect(response.body.customer.marketing_opt_in_level).toBe('single_opt_in')
    })

    it('should withdraw marketing consent', async () => {
      const noMarketingCustomer = mockCustomer({
        accepts_marketing: false,
        accepts_marketing_updated_at: '2024-06-15T12:00:00Z',
        marketing_opt_in_level: null,
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/customers/5555555555.json`,
            {
              status: 200,
              body: { customer: noMarketingCustomer },
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
        data: {
          customer: { accepts_marketing: false },
        },
      })

      expect(response.body.customer.accepts_marketing).toBe(false)
    })
  })
})

// =============================================================================
// CustomersResource Class Tests (Direct API)
// =============================================================================

describe('@dotdo/shopify - CustomersResource Direct API', () => {
  it('should expose customers resource with addresses sub-resource', async () => {
    const mockFetch = createMockFetch(new Map())

    const shopify = shopifyApi({
      apiKey: 'test-api-key',
      apiSecretKey: 'test-api-secret',
      scopes: ['read_customers', 'write_customers'],
      hostName: 'myshop.myshopify.com',
      fetch: mockFetch,
    })

    const restClient = new shopify.clients.Rest({ session: mockSession() })

    // Verify CustomersResource exists and has correct structure
    expect(CustomersResource).toBeDefined()
    expect(AddressesResource).toBeDefined()

    // The CustomersResource should have addresses sub-resource
    const customersResource = new CustomersResource(restClient as any)
    expect(customersResource.addresses).toBeDefined()
    expect(customersResource.addresses).toBeInstanceOf(AddressesResource)
  })
})

// =============================================================================
// RED Phase Tests - Missing Functionality (Expected to Fail)
// =============================================================================

describe('@dotdo/shopify - Customers RED Phase (Unimplemented)', () => {
  describe('metafields resource', () => {
    it.skip('should have a metafields sub-resource on CustomersResource', () => {
      const mockFetch = createMockFetch(new Map())
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_customers', 'write_customers'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const customersResource = new CustomersResource(restClient as any)

      // This should exist but is not implemented yet
      expect((customersResource as any).metafields).toBeDefined()
    })

    it.skip('should list metafields via resource method', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/5555555555/metafields.json`,
            {
              status: 200,
              body: { metafields: [mockMetafield()] },
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

      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const customersResource = new CustomersResource(restClient as any)

      // Metafields sub-resource method
      const response = await (customersResource as any).metafields.list(5555555555)
      expect(response.body.metafields).toHaveLength(1)
    })
  })

  describe('account activation', () => {
    it.skip('should have accountActivationUrl method', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/customers/5555555555/account_activation_url.json`,
            {
              status: 200,
              body: {
                account_activation_url: 'https://myshop.myshopify.com/account/activate/5555555555/token123',
              },
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

      const restClient = new shopify.clients.Rest({ session: mockSession() })
      const customersResource = new CustomersResource(restClient as any)

      // Method should exist on CustomersResource
      const response = await customersResource.accountActivationUrl(5555555555)
      expect(response.body.account_activation_url).toContain('account/activate')
    })
  })

  describe('saved searches / segments', () => {
    it.skip('should list customer saved searches', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customer_saved_searches.json`,
            {
              status: 200,
              body: {
                customer_saved_searches: [
                  {
                    id: 789123,
                    name: 'VIP Customers',
                    query: 'total_spent:>1000',
                    created_at: '2024-01-01T00:00:00Z',
                    updated_at: '2024-01-01T00:00:00Z',
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
        scopes: ['read_customers'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      // CustomerSavedSearchesResource should be available
      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({ path: 'customer_saved_searches' })
      expect(response.body.customer_saved_searches).toHaveLength(1)
    })

    it.skip('should get customers in a saved search', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customer_saved_searches/789123/customers.json`,
            {
              status: 200,
              body: { customers: [mockCustomer({ tags: 'vip' })] },
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
      const response = await client.get({ path: 'customer_saved_searches/789123/customers' })
      expect(response.body.customers).toHaveLength(1)
    })

    it.skip('should create a customer saved search', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/customer_saved_searches.json`,
            {
              status: 201,
              body: {
                customer_saved_search: {
                  id: 789124,
                  name: 'High Spenders',
                  query: 'total_spent:>500',
                  created_at: '2024-06-01T00:00:00Z',
                  updated_at: '2024-06-01T00:00:00Z',
                },
              },
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
        path: 'customer_saved_searches',
        data: {
          customer_saved_search: {
            name: 'High Spenders',
            query: 'total_spent:>500',
          },
        },
      })

      expect(response.body.customer_saved_search.name).toBe('High Spenders')
    })
  })

  describe('high-level resource API', () => {
    it.skip('should expose customers as a high-level resource on shopify instance', () => {
      const mockFetch = createMockFetch(new Map())

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_customers', 'write_customers'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      // shopify.rest.customers should be available as a high-level resource
      expect((shopify as any).rest).toBeDefined()
      expect((shopify as any).rest.customers).toBeDefined()
    })

    it.skip('should support resource-based CRUD via shopify.rest.customers', async () => {
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

      const session = mockSession()

      // High-level REST resource API
      const customers = await (shopify as any).rest.customers.list({ session })
      expect(customers).toHaveLength(1)
    })
  })

  describe('email marketing consent', () => {
    it.skip('should have smsMarketingConsent field support', async () => {
      const customerWithSMS = mockCustomer()
      ;(customerWithSMS as any).sms_marketing_consent = {
        state: 'subscribed',
        opt_in_level: 'single_opt_in',
        consent_updated_at: '2024-06-15T10:00:00Z',
        consent_collected_from: 'SHOPIFY',
      }

      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/5555555555.json`,
            {
              status: 200,
              body: { customer: customerWithSMS },
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

      expect((response.body.customer as any).sms_marketing_consent).toBeDefined()
      expect((response.body.customer as any).sms_marketing_consent.state).toBe('subscribed')
    })
  })

  describe('multipass', () => {
    it.skip('should generate multipass token for customer SSO', () => {
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_customers'],
        hostName: 'myshop.myshopify.com',
        multipassSecret: 'multipass_secret_key',
      })

      // Multipass token generation for customer SSO
      const customerData = {
        email: 'customer@example.com',
        created_at: new Date().toISOString(),
      }

      const token = (shopify as any).multipass.generate(customerData)
      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
    })

    it.skip('should create customer login URL with multipass', () => {
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_customers'],
        hostName: 'myshop.myshopify.com',
        multipassSecret: 'multipass_secret_key',
      })

      const customerData = {
        email: 'customer@example.com',
        return_to: '/collections/all',
      }

      const loginUrl = (shopify as any).multipass.loginUrl(customerData)
      expect(loginUrl).toContain('myshop.myshopify.com/account/login/multipass/')
    })
  })

  describe('B2B company associations', () => {
    it.skip('should link customer to company', async () => {
      const customerWithCompany = mockCustomer()
      ;(customerWithCompany as any).company = {
        id: 888888,
        name: 'Acme Corporation',
        main_contact_admin_id: 5555555555,
      }

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/customers/5555555555.json`,
            {
              status: 200,
              body: { customer: customerWithCompany },
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
        data: {
          customer: {
            company: { id: 888888 },
          },
        },
      })

      expect((response.body.customer as any).company.name).toBe('Acme Corporation')
    })
  })

  describe('customer merge (GraphQL)', () => {
    it.skip('should merge duplicate customers via GraphQL', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/graphql.json`,
            {
              status: 200,
              body: {
                data: {
                  customerMerge: {
                    resultingCustomerId: 'gid://shopify/Customer/5555555555',
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
        scopes: ['write_customers'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Graphql({ session: mockSession() })
      const response = await client.query({
        data: {
          query: `
            mutation customerMerge($customerOneId: ID!, $customerTwoId: ID!) {
              customerMerge(customerOneId: $customerOneId, customerTwoId: $customerTwoId) {
                resultingCustomerId
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          variables: {
            customerOneId: 'gid://shopify/Customer/5555555555',
            customerTwoId: 'gid://shopify/Customer/6666666666',
          },
        },
      })

      expect(response.body.data.customerMerge.resultingCustomerId).toBeDefined()
      expect(response.body.data.customerMerge.userErrors).toHaveLength(0)
    })
  })

  describe('customer payment methods', () => {
    it.skip('should list customer payment methods', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/customers/5555555555/payment_methods.json`,
            {
              status: 200,
              body: {
                payment_methods: [
                  {
                    id: 'pm_123456',
                    type: 'credit_card',
                    brand: 'visa',
                    last4: '4242',
                    exp_month: 12,
                    exp_year: 2025,
                    default: true,
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
        scopes: ['read_customers'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })
      const response = await client.get({ path: 'customers/5555555555/payment_methods' })

      expect(response.body.payment_methods).toHaveLength(1)
      expect(response.body.payment_methods[0].brand).toBe('visa')
    })

    it.skip('should revoke a customer payment method', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /admin/api/${LATEST_API_VERSION}/customers/5555555555/payment_methods/pm_123456.json`,
            {
              status: 200,
              body: {},
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
      const response = await client.delete({
        path: 'customers/5555555555/payment_methods/pm_123456',
      })

      expect(response.body).toEqual({})
    })
  })
})
