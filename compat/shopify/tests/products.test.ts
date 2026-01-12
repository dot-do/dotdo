/**
 * @dotdo/shopify - Product API RED Tests (dotdo-bvett)
 *
 * TDD RED phase tests for Shopify Product Admin API compatibility layer.
 * Tests cover:
 * - Product CRUD operations
 * - Product variants management
 * - Inventory tracking
 * - Product images
 * - Collections and tags
 * - Bulk operations
 * - Pagination
 * - Error handling
 * - Webhooks
 *
 * @module @dotdo/shopify/tests/products
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  shopifyApi,
  LATEST_API_VERSION,
  type Session,
  type Product,
  type ProductVariant,
  type ProductImage,
  type ProductOption,
  type InventoryLevel,
} from '../index'

// =============================================================================
// High-Level Products Resource API (RED - needs implementation)
// =============================================================================

/**
 * These tests define a high-level Products resource API that doesn't exist yet.
 * TDD RED phase - tests should fail until implementation is complete.
 */
describe('@dotdo/shopify - Products Resource API (RED)', () => {
  describe('products.list()', () => {
    it.skip('should provide a high-level products.list() method', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ products: [] }),
      })

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      // RED: This products resource doesn't exist yet
      const products = shopify.resources.products
      expect(products).toBeDefined()

      // Should provide typed list method
      const session = {
        id: 'test',
        shop: 'myshop.myshopify.com',
        state: '',
        isOnline: false,
        accessToken: 'token',
      }
      const result = await products.list({ session })
      expect(result).toBeDefined()
    })

    it.skip('should support automatic pagination via async iterator', async () => {
      // RED: Async iterator pagination doesn't exist yet
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
      })

      const session = {
        id: 'test',
        shop: 'myshop.myshopify.com',
        state: '',
        isOnline: false,
        accessToken: 'token',
      }

      // Should be able to iterate through all products automatically
      const allProducts = []
      for await (const product of shopify.resources.products.iterate({ session })) {
        allProducts.push(product)
        if (allProducts.length >= 100) break // Safety limit
      }

      expect(allProducts.length).toBeGreaterThan(0)
    })
  })

  describe('products.create()', () => {
    it.skip('should provide typed product creation', async () => {
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_products'],
        hostName: 'myshop.myshopify.com',
      })

      const session = {
        id: 'test',
        shop: 'myshop.myshopify.com',
        state: '',
        isOnline: false,
        accessToken: 'token',
      }

      // RED: High-level typed create method doesn't exist yet
      const product = await shopify.resources.products.create({
        session,
        product: {
          title: 'Test Product',
          body_html: '<p>Description</p>',
          vendor: 'Test Vendor',
          product_type: 'Test',
          variants: [
            { price: '29.99', sku: 'TEST-001' },
          ],
        },
      })

      expect(product.id).toBeDefined()
      expect(product.title).toBe('Test Product')
    })
  })

  describe('product.save()', () => {
    it.skip('should support instance save method', async () => {
      // RED: ORM-style save method doesn't exist yet
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_products'],
        hostName: 'myshop.myshopify.com',
      })

      const session = {
        id: 'test',
        shop: 'myshop.myshopify.com',
        state: '',
        isOnline: false,
        accessToken: 'token',
      }

      const product = new shopify.resources.Product({ session })
      product.title = 'New Product'
      product.variants = [{ price: '19.99' }]

      await product.save()

      expect(product.id).toBeDefined()
    })
  })

  describe('variants subresource', () => {
    it.skip('should access variants as a subresource', async () => {
      // RED: Subresource access pattern doesn't exist yet
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
      })

      const session = {
        id: 'test',
        shop: 'myshop.myshopify.com',
        state: '',
        isOnline: false,
        accessToken: 'token',
      }

      // Should be able to access variants through product
      const variants = await shopify.resources.variants.list({
        session,
        product_id: 1234567890,
      })

      expect(variants).toBeDefined()
    })
  })
})

// =============================================================================
// GraphQL Admin API Products (RED - needs implementation)
// =============================================================================

describe('@dotdo/shopify - GraphQL Products API (RED)', () => {
  describe('typed GraphQL queries', () => {
    it.skip('should provide typed product query builder', async () => {
      // RED: Type-safe GraphQL query builder doesn't exist yet
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
      })

      const session = {
        id: 'test',
        shop: 'myshop.myshopify.com',
        state: '',
        isOnline: false,
        accessToken: 'token',
      }

      const client = new shopify.clients.Graphql({ session })

      // Should have typed query methods
      const result = await client.products.find('gid://shopify/Product/123', {
        fields: ['id', 'title', 'handle', 'variants.edges.node.id'],
      })

      expect(result.id).toBeDefined()
    })

    it.skip('should provide typed mutation methods', async () => {
      // RED: Type-safe mutations don't exist yet
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_products'],
        hostName: 'myshop.myshopify.com',
      })

      const session = {
        id: 'test',
        shop: 'myshop.myshopify.com',
        state: '',
        isOnline: false,
        accessToken: 'token',
      }

      const client = new shopify.clients.Graphql({ session })

      // Should have typed mutation methods
      const result = await client.products.create({
        title: 'New Product',
        productType: 'Test',
        vendor: 'Test Vendor',
      })

      expect(result.product.id).toBeDefined()
      expect(result.userErrors).toEqual([])
    })
  })
})

// =============================================================================
// Product Sync and Batching (RED - needs implementation)
// =============================================================================

describe('@dotdo/shopify - Product Sync (RED)', () => {
  describe('batch operations', () => {
    it.skip('should support batch product updates via REST', async () => {
      // RED: Batch update helper doesn't exist yet
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_products'],
        hostName: 'myshop.myshopify.com',
      })

      const session = {
        id: 'test',
        shop: 'myshop.myshopify.com',
        state: '',
        isOnline: false,
        accessToken: 'token',
      }

      // Should be able to batch update multiple products
      const results = await shopify.resources.products.batchUpdate({
        session,
        products: [
          { id: 1, title: 'Updated 1' },
          { id: 2, title: 'Updated 2' },
          { id: 3, title: 'Updated 3' },
        ],
      })

      expect(results.succeeded).toHaveLength(3)
      expect(results.failed).toHaveLength(0)
    })

    it.skip('should support batch price updates', async () => {
      // RED: Batch price update helper doesn't exist yet
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_products'],
        hostName: 'myshop.myshopify.com',
      })

      const session = {
        id: 'test',
        shop: 'myshop.myshopify.com',
        state: '',
        isOnline: false,
        accessToken: 'token',
      }

      // Should be able to update prices in batch
      const results = await shopify.resources.variants.batchUpdatePrices({
        session,
        updates: [
          { id: 1, price: '29.99' },
          { id: 2, price: '39.99' },
          { id: 3, price: '49.99' },
        ],
      })

      expect(results.succeeded).toHaveLength(3)
    })

    it.skip('should support batch inventory adjustments', async () => {
      // RED: Batch inventory adjustment doesn't exist yet
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['write_inventory'],
        hostName: 'myshop.myshopify.com',
      })

      const session = {
        id: 'test',
        shop: 'myshop.myshopify.com',
        state: '',
        isOnline: false,
        accessToken: 'token',
      }

      // Should be able to adjust inventory in batch
      const results = await shopify.resources.inventoryLevels.batchAdjust({
        session,
        locationId: 7777777777,
        adjustments: [
          { inventoryItemId: 1, adjustment: -5 },
          { inventoryItemId: 2, adjustment: 10 },
          { inventoryItemId: 3, adjustment: -3 },
        ],
      })

      expect(results.succeeded).toHaveLength(3)
    })
  })

  describe('sync helpers', () => {
    it.skip('should provide product sync helper', async () => {
      // RED: Sync helper doesn't exist yet
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products', 'write_products'],
        hostName: 'myshop.myshopify.com',
      })

      const session = {
        id: 'test',
        shop: 'myshop.myshopify.com',
        state: '',
        isOnline: false,
        accessToken: 'token',
      }

      // Should provide a sync helper for full catalog sync
      const sync = await shopify.resources.products.sync({
        session,
        since: new Date('2024-01-01'),
        onProduct: async (product) => {
          // Process each product
          console.log(product.title)
        },
        onProgress: (progress) => {
          console.log(`${progress.processed}/${progress.total}`)
        },
      })

      expect(sync.totalProcessed).toBeGreaterThan(0)
    })

    it.skip('should provide webhook-based sync', async () => {
      // RED: Webhook sync helper doesn't exist yet
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
      })

      // Should provide handlers that integrate with webhook events
      const handler = shopify.webhooks.handlers.products({
        onCreate: async (product) => {
          // Handle new product
          expect(product.id).toBeDefined()
        },
        onUpdate: async (product) => {
          // Handle updated product
          expect(product.id).toBeDefined()
        },
        onDelete: async (productId) => {
          // Handle deleted product
          expect(productId).toBeDefined()
        },
      })

      expect(handler).toBeDefined()
    })
  })
})

// =============================================================================
// Test Helpers
// =============================================================================

function createMockFetch(responses: Map<string, { status: number; body: unknown; headers?: Record<string, string> }>) {
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
        ...(mockResponse.headers || {}),
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
    scope: 'read_products,write_products,read_inventory,write_inventory',
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
    admin_graphql_api_id: 'gid://shopify/Product/1234567890',
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
    admin_graphql_api_id: 'gid://shopify/ProductVariant/9876543210',
    ...overrides,
  }
}

function mockProductImage(overrides: Partial<ProductImage> = {}): ProductImage {
  return {
    id: 5555555555,
    product_id: 1234567890,
    position: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    alt: 'Product image alt text',
    width: 1024,
    height: 768,
    src: 'https://cdn.shopify.com/s/files/1/0000/0001/products/test-image.jpg',
    variant_ids: [],
    admin_graphql_api_id: 'gid://shopify/ProductImage/5555555555',
    ...overrides,
  }
}

interface Collection {
  id: number
  handle: string
  title: string
  body_html: string | null
  published_at: string | null
  sort_order: string
  template_suffix: string | null
  disjunctive?: boolean
  rules?: CollectionRule[]
  published_scope: string
  admin_graphql_api_id: string
  updated_at: string
}

interface CollectionRule {
  column: string
  relation: string
  condition: string
}

function mockCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 8888888888,
    handle: 'test-collection',
    title: 'Test Collection',
    body_html: '<p>Collection description</p>',
    published_at: '2024-01-01T00:00:00Z',
    sort_order: 'best-selling',
    template_suffix: null,
    published_scope: 'global',
    admin_graphql_api_id: 'gid://shopify/Collection/8888888888',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

interface Metafield {
  id: number
  namespace: string
  key: string
  value: string
  type: string
  owner_id: number
  owner_resource: string
  created_at: string
  updated_at: string
  admin_graphql_api_id: string
}

function mockMetafield(overrides: Partial<Metafield> = {}): Metafield {
  return {
    id: 6666666666,
    namespace: 'custom',
    key: 'product_info',
    value: '{"material": "cotton"}',
    type: 'json',
    owner_id: 1234567890,
    owner_resource: 'product',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    admin_graphql_api_id: 'gid://shopify/Metafield/6666666666',
    ...overrides,
  }
}

// =============================================================================
// Product CRUD Tests
// =============================================================================

describe('@dotdo/shopify - Product CRUD', () => {
  describe('create product', () => {
    it('should create a product with minimal fields', async () => {
      const newProduct = mockProduct()
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products.json`,
            { status: 201, body: { product: newProduct } },
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
          },
        },
      })

      expect(response.body.product.id).toBeDefined()
      expect(response.body.product.title).toBe('Test Product')
    })

    it('should create a product with all fields', async () => {
      const fullProduct = mockProduct({
        body_html: '<p>Full description with <strong>HTML</strong></p>',
        vendor: 'Premium Vendor',
        product_type: 'Electronics',
        tags: 'electronics, premium, featured',
        status: 'draft',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products.json`,
            { status: 201, body: { product: fullProduct } },
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
            body_html: '<p>Full description with <strong>HTML</strong></p>',
            vendor: 'Premium Vendor',
            product_type: 'Electronics',
            tags: 'electronics, premium, featured',
            status: 'draft',
          },
        },
      })

      expect(response.body.product.vendor).toBe('Premium Vendor')
      expect(response.body.product.tags).toBe('electronics, premium, featured')
      expect(response.body.product.status).toBe('draft')
    })

    it('should create a product with multiple variants and options', async () => {
      const productWithVariants = mockProduct({
        options: [
          { id: 1, product_id: 1234567890, name: 'Size', position: 1, values: ['Small', 'Medium', 'Large'] },
          { id: 2, product_id: 1234567890, name: 'Color', position: 2, values: ['Red', 'Blue', 'Green'] },
        ],
        variants: [
          mockVariant({ id: 1, title: 'Small / Red', option1: 'Small', option2: 'Red', price: '19.99' }),
          mockVariant({ id: 2, title: 'Small / Blue', option1: 'Small', option2: 'Blue', price: '19.99' }),
          mockVariant({ id: 3, title: 'Medium / Red', option1: 'Medium', option2: 'Red', price: '24.99' }),
          mockVariant({ id: 4, title: 'Large / Green', option1: 'Large', option2: 'Green', price: '29.99' }),
        ],
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products.json`,
            { status: 201, body: { product: productWithVariants } },
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
            title: 'Multi-Variant Product',
            options: [{ name: 'Size' }, { name: 'Color' }],
            variants: [
              { option1: 'Small', option2: 'Red', price: '19.99' },
              { option1: 'Small', option2: 'Blue', price: '19.99' },
              { option1: 'Medium', option2: 'Red', price: '24.99' },
              { option1: 'Large', option2: 'Green', price: '29.99' },
            ],
          },
        },
      })

      expect(response.body.product.options).toHaveLength(2)
      expect(response.body.product.variants).toHaveLength(4)
    })

    it('should create a product with images', async () => {
      const productWithImages = mockProduct({
        images: [
          mockProductImage({ id: 1, position: 1, src: 'https://example.com/image1.jpg' }),
          mockProductImage({ id: 2, position: 2, src: 'https://example.com/image2.jpg' }),
        ],
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products.json`,
            { status: 201, body: { product: productWithImages } },
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
            title: 'Product with Images',
            images: [
              { src: 'https://example.com/image1.jpg' },
              { src: 'https://example.com/image2.jpg' },
            ],
          },
        },
      })

      expect(response.body.product.images).toHaveLength(2)
    })
  })

  describe('read product', () => {
    it('should get a single product by ID', async () => {
      const product = mockProduct()
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products/1234567890.json`,
            { status: 200, body: { product } },
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
    })

    it('should get a product with specific fields only', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products/1234567890.json`,
            { status: 200, body: { product: { id: 1234567890, title: 'Test', handle: 'test' } } },
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
      const response = await client.get({
        path: 'products/1234567890',
        query: { fields: 'id,title,handle' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('fields=id%2Ctitle%2Chandle'),
        expect.anything()
      )
    })

    it('should return 404 for non-existent product', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products/999999999.json`,
            { status: 404, body: { errors: 'Not Found' } },
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
      await expect(client.get({ path: 'products/999999999' })).rejects.toThrow()
    })
  })

  describe('update product', () => {
    it('should update product title', async () => {
      const updatedProduct = mockProduct({ title: 'Updated Title' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/products/1234567890.json`,
            { status: 200, body: { product: updatedProduct } },
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

    it('should update product status to archived', async () => {
      const archivedProduct = mockProduct({ status: 'archived' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/products/1234567890.json`,
            { status: 200, body: { product: archivedProduct } },
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
        data: { product: { status: 'archived' } },
      })

      expect(response.body.product.status).toBe('archived')
    })

    it('should update product tags', async () => {
      const productWithNewTags = mockProduct({ tags: 'new-tag, updated, featured' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/products/1234567890.json`,
            { status: 200, body: { product: productWithNewTags } },
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
        data: { product: { tags: 'new-tag, updated, featured' } },
      })

      expect(response.body.product.tags).toBe('new-tag, updated, featured')
    })
  })

  describe('delete product', () => {
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

    it('should fail to delete non-existent product', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /admin/api/${LATEST_API_VERSION}/products/999999999.json`,
            { status: 404, body: { errors: 'Not Found' } },
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
      await expect(client.delete({ path: 'products/999999999' })).rejects.toThrow()
    })
  })

  describe('count products', () => {
    it('should get product count', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products/count.json`,
            { status: 200, body: { count: 150 } },
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
      const response = await client.get({ path: 'products/count' })

      expect(response.body.count).toBe(150)
    })

    it('should get product count filtered by vendor', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products/count.json`,
            { status: 200, body: { count: 25 } },
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
        path: 'products/count',
        query: { vendor: 'Premium Vendor' },
      })

      // URL encoding may use + or %20 for spaces
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/vendor=Premium[+%20]Vendor/),
        expect.anything()
      )
    })
  })
})

// =============================================================================
// Product Variants Tests
// =============================================================================

describe('@dotdo/shopify - Product Variants', () => {
  describe('list variants', () => {
    it('should list all variants for a product', async () => {
      const variants = [
        mockVariant({ id: 1, title: 'Small' }),
        mockVariant({ id: 2, title: 'Medium' }),
        mockVariant({ id: 3, title: 'Large' }),
      ]

      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products/1234567890/variants.json`,
            { status: 200, body: { variants } },
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

      expect(response.body.variants).toHaveLength(3)
    })
  })

  describe('create variant', () => {
    it('should create a new variant', async () => {
      const newVariant = mockVariant({ id: 4, title: 'Extra Large', option1: 'Extra Large', price: '39.99' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products/1234567890/variants.json`,
            { status: 201, body: { variant: newVariant } },
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
        data: { variant: { option1: 'Extra Large', price: '39.99' } },
      })

      expect(response.body.variant.title).toBe('Extra Large')
      expect(response.body.variant.price).toBe('39.99')
    })

    it('should create variant with inventory tracking', async () => {
      const variantWithInventory = mockVariant({
        inventory_management: 'shopify',
        inventory_quantity: 50,
        inventory_policy: 'deny',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products/1234567890/variants.json`,
            { status: 201, body: { variant: variantWithInventory } },
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
        data: {
          variant: {
            option1: 'Default',
            price: '29.99',
            inventory_management: 'shopify',
            inventory_quantity: 50,
          },
        },
      })

      expect(response.body.variant.inventory_management).toBe('shopify')
      expect(response.body.variant.inventory_quantity).toBe(50)
    })

    it('should create variant with barcode and SKU', async () => {
      const variantWithCodes = mockVariant({
        sku: 'UNIQUE-SKU-001',
        barcode: '1234567890123',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products/1234567890/variants.json`,
            { status: 201, body: { variant: variantWithCodes } },
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
        data: {
          variant: {
            option1: 'Default',
            price: '29.99',
            sku: 'UNIQUE-SKU-001',
            barcode: '1234567890123',
          },
        },
      })

      expect(response.body.variant.sku).toBe('UNIQUE-SKU-001')
      expect(response.body.variant.barcode).toBe('1234567890123')
    })
  })

  describe('update variant', () => {
    it('should update variant price', async () => {
      const updatedVariant = mockVariant({ price: '49.99' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/variants/9876543210.json`,
            { status: 200, body: { variant: updatedVariant } },
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
        data: { variant: { price: '49.99' } },
      })

      expect(response.body.variant.price).toBe('49.99')
    })

    it('should update variant compare at price', async () => {
      const updatedVariant = mockVariant({ compare_at_price: '79.99' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/variants/9876543210.json`,
            { status: 200, body: { variant: updatedVariant } },
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
        data: { variant: { compare_at_price: '79.99' } },
      })

      expect(response.body.variant.compare_at_price).toBe('79.99')
    })

    it('should update variant weight', async () => {
      const updatedVariant = mockVariant({ weight: 1.5, weight_unit: 'lb' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/variants/9876543210.json`,
            { status: 200, body: { variant: updatedVariant } },
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
        data: { variant: { weight: 1.5, weight_unit: 'lb' } },
      })

      expect(response.body.variant.weight).toBe(1.5)
      expect(response.body.variant.weight_unit).toBe('lb')
    })
  })

  describe('delete variant', () => {
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

    it('should not allow deleting the last variant', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /admin/api/${LATEST_API_VERSION}/products/1234567890/variants/9876543210.json`,
            {
              status: 422,
              body: { errors: { base: ['A product must have at least one variant'] } },
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
      await expect(client.delete({ path: 'products/1234567890/variants/9876543210' })).rejects.toThrow()
    })
  })

  describe('get variant', () => {
    it('should get a single variant by ID', async () => {
      const variant = mockVariant()
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/variants/9876543210.json`,
            { status: 200, body: { variant } },
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
      const response = await client.get({ path: 'variants/9876543210' })

      expect(response.body.variant.id).toBe(9876543210)
    })
  })
})

// =============================================================================
// Inventory Tracking Tests
// =============================================================================

describe('@dotdo/shopify - Inventory Tracking', () => {
  describe('inventory levels', () => {
    it('should get inventory levels for an item', async () => {
      const inventoryLevels: InventoryLevel[] = [
        {
          inventory_item_id: 1111111111,
          location_id: 7777777777,
          available: 100,
          updated_at: '2024-01-01T00:00:00Z',
          admin_graphql_api_id: 'gid://shopify/InventoryLevel/1',
        },
      ]

      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/inventory_levels.json`,
            { status: 200, body: { inventory_levels: inventoryLevels } },
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
        query: { inventory_item_ids: '1111111111' },
      })

      expect(response.body.inventory_levels).toHaveLength(1)
      expect(response.body.inventory_levels[0].available).toBe(100)
    })

    it('should adjust inventory level', async () => {
      const adjustedLevel: InventoryLevel = {
        inventory_item_id: 1111111111,
        location_id: 7777777777,
        available: 90,
        updated_at: '2024-01-01T00:00:00Z',
        admin_graphql_api_id: 'gid://shopify/InventoryLevel/1',
      }

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/inventory_levels/adjust.json`,
            { status: 200, body: { inventory_level: adjustedLevel } },
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

    it('should set inventory level', async () => {
      const setLevel: InventoryLevel = {
        inventory_item_id: 1111111111,
        location_id: 7777777777,
        available: 200,
        updated_at: '2024-01-01T00:00:00Z',
        admin_graphql_api_id: 'gid://shopify/InventoryLevel/1',
      }

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/inventory_levels/set.json`,
            { status: 200, body: { inventory_level: setLevel } },
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
          available: 200,
        },
      })

      expect(response.body.inventory_level.available).toBe(200)
    })

    it('should connect inventory item to location', async () => {
      const connectedLevel: InventoryLevel = {
        inventory_item_id: 1111111111,
        location_id: 8888888888,
        available: 0,
        updated_at: '2024-01-01T00:00:00Z',
        admin_graphql_api_id: 'gid://shopify/InventoryLevel/1',
      }

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/inventory_levels/connect.json`,
            { status: 201, body: { inventory_level: connectedLevel } },
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
          location_id: 8888888888,
          inventory_item_id: 1111111111,
        },
      })

      expect(response.body.inventory_level.location_id).toBe(8888888888)
    })

    it('should delete inventory level from location', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /admin/api/${LATEST_API_VERSION}/inventory_levels.json`,
            { status: 200, body: {} },
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
      const response = await client.delete({
        path: 'inventory_levels',
        query: {
          inventory_item_id: '1111111111',
          location_id: '7777777777',
        },
      })

      expect(response.body).toEqual({})
    })
  })

  describe('inventory items', () => {
    it('should get inventory item', async () => {
      const inventoryItem = {
        id: 1111111111,
        sku: 'TEST-SKU-001',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        requires_shipping: true,
        cost: '15.00',
        country_code_of_origin: 'US',
        province_code_of_origin: 'CA',
        harmonized_system_code: '123456',
        tracked: true,
        country_harmonized_system_codes: [],
        admin_graphql_api_id: 'gid://shopify/InventoryItem/1111111111',
      }

      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/inventory_items/1111111111.json`,
            { status: 200, body: { inventory_item: inventoryItem } },
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
      const response = await client.get({ path: 'inventory_items/1111111111' })

      expect(response.body.inventory_item.id).toBe(1111111111)
      expect(response.body.inventory_item.tracked).toBe(true)
    })

    it('should update inventory item cost', async () => {
      const updatedItem = {
        id: 1111111111,
        cost: '20.00',
      }

      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/inventory_items/1111111111.json`,
            { status: 200, body: { inventory_item: updatedItem } },
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
      const response = await client.put({
        path: 'inventory_items/1111111111',
        data: { inventory_item: { cost: '20.00' } },
      })

      expect(response.body.inventory_item.cost).toBe('20.00')
    })
  })
})

// =============================================================================
// Product Images Tests
// =============================================================================

describe('@dotdo/shopify - Product Images', () => {
  describe('list images', () => {
    it('should list all images for a product', async () => {
      const images = [
        mockProductImage({ id: 1, position: 1 }),
        mockProductImage({ id: 2, position: 2 }),
        mockProductImage({ id: 3, position: 3 }),
      ]

      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products/1234567890/images.json`,
            { status: 200, body: { images } },
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
      const response = await client.get({ path: 'products/1234567890/images' })

      expect(response.body.images).toHaveLength(3)
    })

    it('should list images with fields filter', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products/1234567890/images.json`,
            { status: 200, body: { images: [{ id: 1, src: 'https://example.com/img.jpg' }] } },
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
        path: 'products/1234567890/images',
        query: { fields: 'id,src' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('fields=id%2Csrc'),
        expect.anything()
      )
    })
  })

  describe('create image', () => {
    it('should create image from URL', async () => {
      const newImage = mockProductImage({ src: 'https://example.com/new-image.jpg' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products/1234567890/images.json`,
            { status: 201, body: { image: newImage } },
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
        path: 'products/1234567890/images',
        data: { image: { src: 'https://example.com/new-image.jpg' } },
      })

      expect(response.body.image.src).toContain('new-image')
    })

    it('should create image from base64 attachment', async () => {
      const newImage = mockProductImage()
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products/1234567890/images.json`,
            { status: 201, body: { image: newImage } },
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
        path: 'products/1234567890/images',
        data: {
          image: {
            attachment: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            filename: 'test-image.png',
          },
        },
      })

      expect(response.body.image.id).toBeDefined()
    })

    it('should create image with alt text', async () => {
      const newImage = mockProductImage({ alt: 'Descriptive alt text for SEO' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products/1234567890/images.json`,
            { status: 201, body: { image: newImage } },
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
        path: 'products/1234567890/images',
        data: {
          image: {
            src: 'https://example.com/image.jpg',
            alt: 'Descriptive alt text for SEO',
          },
        },
      })

      expect(response.body.image.alt).toBe('Descriptive alt text for SEO')
    })

    it('should create image associated with variants', async () => {
      const newImage = mockProductImage({ variant_ids: [9876543210, 9876543211] })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products/1234567890/images.json`,
            { status: 201, body: { image: newImage } },
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
        path: 'products/1234567890/images',
        data: {
          image: {
            src: 'https://example.com/image.jpg',
            variant_ids: [9876543210, 9876543211],
          },
        },
      })

      expect(response.body.image.variant_ids).toContain(9876543210)
      expect(response.body.image.variant_ids).toContain(9876543211)
    })
  })

  describe('update image', () => {
    it('should update image position', async () => {
      const updatedImage = mockProductImage({ position: 1 })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/products/1234567890/images/5555555555.json`,
            { status: 200, body: { image: updatedImage } },
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
        path: 'products/1234567890/images/5555555555',
        data: { image: { position: 1 } },
      })

      expect(response.body.image.position).toBe(1)
    })

    it('should update image alt text', async () => {
      const updatedImage = mockProductImage({ alt: 'Updated alt text' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/products/1234567890/images/5555555555.json`,
            { status: 200, body: { image: updatedImage } },
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
        path: 'products/1234567890/images/5555555555',
        data: { image: { alt: 'Updated alt text' } },
      })

      expect(response.body.image.alt).toBe('Updated alt text')
    })

    it('should update image variant associations', async () => {
      const updatedImage = mockProductImage({ variant_ids: [9876543212] })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/products/1234567890/images/5555555555.json`,
            { status: 200, body: { image: updatedImage } },
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
        path: 'products/1234567890/images/5555555555',
        data: { image: { variant_ids: [9876543212] } },
      })

      expect(response.body.image.variant_ids).toEqual([9876543212])
    })
  })

  describe('delete image', () => {
    it('should delete a product image', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /admin/api/${LATEST_API_VERSION}/products/1234567890/images/5555555555.json`,
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
      const response = await client.delete({ path: 'products/1234567890/images/5555555555' })

      expect(response.body).toEqual({})
    })
  })

  describe('get single image', () => {
    it('should get a single image by ID', async () => {
      const image = mockProductImage()
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products/1234567890/images/5555555555.json`,
            { status: 200, body: { image } },
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
      const response = await client.get({ path: 'products/1234567890/images/5555555555' })

      expect(response.body.image.id).toBe(5555555555)
    })
  })

  describe('count images', () => {
    it('should count product images', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products/1234567890/images/count.json`,
            { status: 200, body: { count: 5 } },
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
      const response = await client.get({ path: 'products/1234567890/images/count' })

      expect(response.body.count).toBe(5)
    })
  })
})

// =============================================================================
// Collections and Tags Tests
// =============================================================================

describe('@dotdo/shopify - Collections and Tags', () => {
  describe('custom collections', () => {
    it('should list custom collections', async () => {
      const collections = [
        mockCollection({ id: 1, title: 'Summer Sale' }),
        mockCollection({ id: 2, title: 'New Arrivals' }),
      ]

      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/custom_collections.json`,
            { status: 200, body: { custom_collections: collections } },
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
      const response = await client.get({ path: 'custom_collections' })

      expect(response.body.custom_collections).toHaveLength(2)
    })

    it('should create a custom collection', async () => {
      const newCollection = mockCollection({ title: 'Winter Collection' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/custom_collections.json`,
            { status: 201, body: { custom_collection: newCollection } },
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
        path: 'custom_collections',
        data: {
          custom_collection: {
            title: 'Winter Collection',
            body_html: '<p>Winter products</p>',
          },
        },
      })

      expect(response.body.custom_collection.title).toBe('Winter Collection')
    })

    it('should add products to custom collection via collects', async () => {
      const collect = {
        id: 123456789,
        collection_id: 8888888888,
        product_id: 1234567890,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        position: 1,
        sort_value: '0000000001',
      }

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/collects.json`,
            { status: 201, body: { collect } },
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
        path: 'collects',
        data: {
          collect: {
            collection_id: 8888888888,
            product_id: 1234567890,
          },
        },
      })

      expect(response.body.collect.collection_id).toBe(8888888888)
      expect(response.body.collect.product_id).toBe(1234567890)
    })

    it('should remove product from collection', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /admin/api/${LATEST_API_VERSION}/collects/123456789.json`,
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
      const response = await client.delete({ path: 'collects/123456789' })

      expect(response.body).toEqual({})
    })
  })

  describe('smart collections', () => {
    it('should list smart collections', async () => {
      const smartCollections = [
        mockCollection({
          id: 9999999999,
          title: 'Products under $50',
          disjunctive: false,
          rules: [
            { column: 'variant_price', relation: 'less_than', condition: '50' },
          ],
        }),
      ]

      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/smart_collections.json`,
            { status: 200, body: { smart_collections: smartCollections } },
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
      const response = await client.get({ path: 'smart_collections' })

      expect(response.body.smart_collections).toHaveLength(1)
      expect(response.body.smart_collections[0].rules).toBeDefined()
    })

    it('should create a smart collection with rules', async () => {
      const smartCollection = mockCollection({
        title: 'Featured Products',
        disjunctive: true,
        rules: [
          { column: 'tag', relation: 'equals', condition: 'featured' },
          { column: 'vendor', relation: 'equals', condition: 'Premium Vendor' },
        ],
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/smart_collections.json`,
            { status: 201, body: { smart_collection: smartCollection } },
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
        path: 'smart_collections',
        data: {
          smart_collection: {
            title: 'Featured Products',
            disjunctive: true,
            rules: [
              { column: 'tag', relation: 'equals', condition: 'featured' },
              { column: 'vendor', relation: 'equals', condition: 'Premium Vendor' },
            ],
          },
        },
      })

      expect(response.body.smart_collection.disjunctive).toBe(true)
      expect(response.body.smart_collection.rules).toHaveLength(2)
    })

    it('should update smart collection order', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/smart_collections/9999999999/order.json`,
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
      const response = await client.put({
        path: 'smart_collections/9999999999/order',
        data: {
          products: [1234567890, 1234567891, 1234567892],
        },
      })

      expect(response.body).toEqual({})
    })
  })

  describe('product tags', () => {
    it('should update product tags', async () => {
      const productWithTags = mockProduct({ tags: 'new, featured, sale, summer2024' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/products/1234567890.json`,
            { status: 200, body: { product: productWithTags } },
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
        data: { product: { tags: 'new, featured, sale, summer2024' } },
      })

      expect(response.body.product.tags).toBe('new, featured, sale, summer2024')
    })

    it('should filter products by tag', async () => {
      const products = [mockProduct({ tags: 'featured' })]
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products.json`,
            { status: 200, body: { products } },
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
        query: { tag: 'featured' },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('tag=featured'),
        expect.anything()
      )
    })
  })
})

// =============================================================================
// Bulk Operations Tests
// =============================================================================

describe('@dotdo/shopify - Bulk Operations', () => {
  describe('GraphQL bulk operations', () => {
    it('should create a bulk query operation', async () => {
      const bulkOperationResponse = {
        data: {
          bulkOperationRunQuery: {
            bulkOperation: {
              id: 'gid://shopify/BulkOperation/123456789',
              status: 'CREATED',
              query: `{ products { edges { node { id title } } } }`,
            },
            userErrors: [],
          },
        },
      }

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/graphql.json`,
            { status: 200, body: bulkOperationResponse },
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
        data: {
          query: `
            mutation {
              bulkOperationRunQuery(
                query: """
                  {
                    products {
                      edges {
                        node {
                          id
                          title
                          variants {
                            edges {
                              node {
                                id
                                price
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                """
              ) {
                bulkOperation {
                  id
                  status
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
        },
      })

      expect(response.body.data.bulkOperationRunQuery.bulkOperation.status).toBe('CREATED')
    })

    it('should poll bulk operation status', async () => {
      const statusResponse = {
        data: {
          currentBulkOperation: {
            id: 'gid://shopify/BulkOperation/123456789',
            status: 'COMPLETED',
            url: 'https://storage.shopifycloud.com/bulk-operation-results/123456789.jsonl',
            objectCount: '1500',
            fileSize: '2048',
            partialDataUrl: null,
          },
        },
      }

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/graphql.json`,
            { status: 200, body: statusResponse },
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
        data: {
          query: `
            query {
              currentBulkOperation {
                id
                status
                url
                objectCount
                fileSize
                partialDataUrl
              }
            }
          `,
        },
      })

      expect(response.body.data.currentBulkOperation.status).toBe('COMPLETED')
      expect(response.body.data.currentBulkOperation.url).toBeDefined()
    })

    it('should cancel a bulk operation', async () => {
      const cancelResponse = {
        data: {
          bulkOperationCancel: {
            bulkOperation: {
              id: 'gid://shopify/BulkOperation/123456789',
              status: 'CANCELING',
            },
            userErrors: [],
          },
        },
      }

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/graphql.json`,
            { status: 200, body: cancelResponse },
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
        data: {
          query: `
            mutation {
              bulkOperationCancel(id: "gid://shopify/BulkOperation/123456789") {
                bulkOperation {
                  id
                  status
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
        },
      })

      expect(response.body.data.bulkOperationCancel.bulkOperation.status).toBe('CANCELING')
    })
  })

  describe('bulk mutation via GraphQL', () => {
    it('should bulk update product prices', async () => {
      const bulkMutationResponse = {
        data: {
          bulkOperationRunMutation: {
            bulkOperation: {
              id: 'gid://shopify/BulkOperation/987654321',
              status: 'CREATED',
            },
            userErrors: [],
          },
        },
      }

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/graphql.json`,
            { status: 200, body: bulkMutationResponse },
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
            mutation {
              bulkOperationRunMutation(
                mutation: "mutation productVariantUpdate($input: ProductVariantInput!) { productVariantUpdate(input: $input) { productVariant { id price } userErrors { field message } } }"
                stagedUploadPath: "tmp/bulk_op_vars_123456789.jsonl"
              ) {
                bulkOperation {
                  id
                  status
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
        },
      })

      expect(response.body.data.bulkOperationRunMutation.bulkOperation.status).toBe('CREATED')
    })

    it('should stage file upload for bulk mutation', async () => {
      const stagedUploadResponse = {
        data: {
          stagedUploadsCreate: {
            stagedTargets: [
              {
                url: 'https://shopify-staged-uploads.storage.googleapis.com/...',
                resourceUrl: 'https://shopify.com/...',
                parameters: [
                  { name: 'key', value: 'tmp/bulk_op_vars.jsonl' },
                  { name: 'Content-Type', value: 'text/jsonl' },
                ],
              },
            ],
            userErrors: [],
          },
        },
      }

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/graphql.json`,
            { status: 200, body: stagedUploadResponse },
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
            mutation {
              stagedUploadsCreate(input: [{
                resource: BULK_MUTATION_VARIABLES
                filename: "bulk_op_vars.jsonl"
                mimeType: "text/jsonl"
                httpMethod: POST
              }]) {
                stagedTargets {
                  url
                  resourceUrl
                  parameters {
                    name
                    value
                  }
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
        },
      })

      expect(response.body.data.stagedUploadsCreate.stagedTargets).toHaveLength(1)
    })
  })
})

// =============================================================================
// Pagination Tests
// =============================================================================

describe('@dotdo/shopify - Pagination', () => {
  describe('cursor-based pagination', () => {
    it('should get first page of products', async () => {
      const products = [mockProduct({ id: 1 }), mockProduct({ id: 2 })]
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products.json`,
            {
              status: 200,
              body: { products },
              headers: {
                link: `<https://myshop.myshopify.com/admin/api/${LATEST_API_VERSION}/products.json?page_info=eyJsYXN0X2lkIjoyfQ&limit=2>; rel="next"`,
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
      const response = await client.get({
        path: 'products',
        query: { limit: 2 },
      })

      expect(response.body.products).toHaveLength(2)
      expect(response.headers.get('link')).toContain('rel="next"')
    })

    it('should get next page using page_info cursor', async () => {
      const products = [mockProduct({ id: 3 }), mockProduct({ id: 4 })]
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products.json`,
            {
              status: 200,
              body: { products },
              headers: {
                link: `<https://myshop.myshopify.com/admin/api/${LATEST_API_VERSION}/products.json?page_info=eyJsYXN0X2lkIjo0fQ&limit=2>; rel="next", <https://myshop.myshopify.com/admin/api/${LATEST_API_VERSION}/products.json?page_info=eyJsYXN0X2lkIjoyfQ&limit=2>; rel="previous"`,
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
      const response = await client.get({
        path: 'products',
        query: { page_info: 'eyJsYXN0X2lkIjoyfQ', limit: 2 },
      })

      expect(response.body.products).toHaveLength(2)
      expect(response.headers.get('link')).toContain('rel="previous"')
    })

    it('should handle last page without next link', async () => {
      const products = [mockProduct({ id: 5 })]
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products.json`,
            {
              status: 200,
              body: { products },
              headers: {
                link: `<https://myshop.myshopify.com/admin/api/${LATEST_API_VERSION}/products.json?page_info=eyJsYXN0X2lkIjo0fQ&limit=2>; rel="previous"`,
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
      const response = await client.get({
        path: 'products',
        query: { page_info: 'eyJsYXN0X2lkIjo0fQ', limit: 2 },
      })

      expect(response.body.products).toHaveLength(1)
      expect(response.headers.get('link')).not.toContain('rel="next"')
    })
  })

  describe('since_id pagination', () => {
    it('should get products after a specific ID', async () => {
      const products = [mockProduct({ id: 101 }), mockProduct({ id: 102 })]
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products.json`,
            { status: 200, body: { products } },
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
        query: { since_id: 100, limit: 50 },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('since_id=100'),
        expect.anything()
      )
    })
  })

  describe('pagination limits', () => {
    it('should respect maximum limit of 250', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products.json`,
            { status: 200, body: { products: [] } },
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
        query: { limit: 250 },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=250'),
        expect.anything()
      )
    })
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('@dotdo/shopify - Error Handling', () => {
  describe('validation errors', () => {
    it('should handle product validation errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products.json`,
            {
              status: 422,
              body: {
                errors: {
                  title: ['cannot be blank'],
                  body_html: ['is invalid'],
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

      const client = new shopify.clients.Rest({ session: mockSession() })

      await expect(
        client.post({
          path: 'products',
          data: { product: { title: '' } },
        })
      ).rejects.toThrow()
    })

    it('should handle variant validation errors', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products/1234567890/variants.json`,
            {
              status: 422,
              body: {
                errors: {
                  price: ['must be greater than or equal to 0'],
                  sku: ['has already been taken'],
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

      const client = new shopify.clients.Rest({ session: mockSession() })

      await expect(
        client.post({
          path: 'products/1234567890/variants',
          data: { variant: { price: '-10', sku: 'DUPLICATE-SKU' } },
        })
      ).rejects.toThrow()
    })
  })

  describe('authentication errors', () => {
    it('should handle invalid access token', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products.json`,
            {
              status: 401,
              body: { errors: '[API] Invalid API key or access token' },
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

      const client = new shopify.clients.Rest({ session: mockSession({ accessToken: 'invalid' }) })

      await expect(client.get({ path: 'products' })).rejects.toThrow()
    })

    it('should handle insufficient scope', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products.json`,
            {
              status: 403,
              body: { errors: '[API] Access denied' },
            },
          ],
        ])
      )

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'], // Missing write_products
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })

      await expect(
        client.post({
          path: 'products',
          data: { product: { title: 'Test' } },
        })
      ).rejects.toThrow()
    })
  })

  describe('rate limiting', () => {
    it('should handle rate limit with retry', async () => {
      let callCount = 0
      const mockFetch = vi.fn(async () => {
        callCount++
        if (callCount === 1) {
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

      expect(callCount).toBe(2)
      expect(response.body.products).toHaveLength(1)
    })

    it('should fail after max retries on rate limit', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: false,
        status: 429,
        headers: new Headers({
          'Retry-After': '1',
          'x-request-id': 'req_mock',
        }),
        json: async () => ({ errors: 'Throttled' }),
        text: async () => JSON.stringify({ errors: 'Throttled' }),
      }))

      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
        fetch: mockFetch,
        retries: 1,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })

      await expect(client.get({ path: 'products' })).rejects.toThrow()
      expect(mockFetch).toHaveBeenCalledTimes(2) // Initial + 1 retry
    })
  })

  describe('server errors', () => {
    it('should handle 500 internal server error', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products.json`,
            {
              status: 500,
              body: { errors: 'Internal Server Error' },
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
        retries: 0,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })

      await expect(client.get({ path: 'products' })).rejects.toThrow()
    })

    it('should handle 503 service unavailable', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products.json`,
            {
              status: 503,
              body: { errors: 'Service Unavailable' },
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
        retries: 0,
      })

      const client = new shopify.clients.Rest({ session: mockSession() })

      await expect(client.get({ path: 'products' })).rejects.toThrow()
    })
  })
})

// =============================================================================
// Webhook Tests
// =============================================================================

describe('@dotdo/shopify - Product Webhooks', () => {
  describe('webhook registration', () => {
    it('should register products/create webhook', async () => {
      const webhook = {
        id: 123456789,
        address: 'https://myapp.com/webhooks/products/create',
        topic: 'products/create',
        format: 'json',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/webhooks.json`,
            { status: 201, body: { webhook } },
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

      expect(response.body.webhook.topic).toBe('products/create')
    })

    it('should register products/update webhook', async () => {
      const webhook = {
        id: 123456790,
        address: 'https://myapp.com/webhooks/products/update',
        topic: 'products/update',
        format: 'json',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/webhooks.json`,
            { status: 201, body: { webhook } },
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
            topic: 'products/update',
            address: 'https://myapp.com/webhooks/products/update',
            format: 'json',
          },
        },
      })

      expect(response.body.webhook.topic).toBe('products/update')
    })

    it('should register products/delete webhook', async () => {
      const webhook = {
        id: 123456791,
        address: 'https://myapp.com/webhooks/products/delete',
        topic: 'products/delete',
        format: 'json',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/webhooks.json`,
            { status: 201, body: { webhook } },
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
            topic: 'products/delete',
            address: 'https://myapp.com/webhooks/products/delete',
            format: 'json',
          },
        },
      })

      expect(response.body.webhook.topic).toBe('products/delete')
    })

    it('should register inventory webhook', async () => {
      const webhook = {
        id: 123456792,
        address: 'https://myapp.com/webhooks/inventory',
        topic: 'inventory_levels/update',
        format: 'json',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/webhooks.json`,
            { status: 201, body: { webhook } },
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
      const response = await client.post({
        path: 'webhooks',
        data: {
          webhook: {
            topic: 'inventory_levels/update',
            address: 'https://myapp.com/webhooks/inventory',
            format: 'json',
          },
        },
      })

      expect(response.body.webhook.topic).toBe('inventory_levels/update')
    })
  })

  describe('webhook signature validation', () => {
    it('should validate product webhook signature', async () => {
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
      })

      const productPayload = JSON.stringify({
        id: 1234567890,
        title: 'Test Product',
        created_at: '2024-01-01T00:00:00Z',
      })

      const hmac = await shopify.webhooks.generateTestHmac(productPayload)
      const isValid = await shopify.webhooks.validate({
        rawBody: productPayload,
        hmac,
      })

      expect(isValid).toBe(true)
    })

    it('should reject invalid product webhook signature', async () => {
      const shopify = shopifyApi({
        apiKey: 'test-api-key',
        apiSecretKey: 'test-api-secret',
        scopes: ['read_products'],
        hostName: 'myshop.myshopify.com',
      })

      const productPayload = JSON.stringify({
        id: 1234567890,
        title: 'Test Product',
      })

      const isValid = await shopify.webhooks.validate({
        rawBody: productPayload,
        hmac: 'invalid-hmac-signature',
      })

      expect(isValid).toBe(false)
    })
  })
})

// =============================================================================
// Metafields Tests
// =============================================================================

describe('@dotdo/shopify - Product Metafields', () => {
  describe('list metafields', () => {
    it('should list product metafields', async () => {
      const metafields = [
        mockMetafield({ key: 'material', value: 'cotton' }),
        mockMetafield({ id: 2, key: 'care_instructions', value: 'Machine wash cold' }),
      ]

      const mockFetch = createMockFetch(
        new Map([
          [
            `GET /admin/api/${LATEST_API_VERSION}/products/1234567890/metafields.json`,
            { status: 200, body: { metafields } },
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
      const response = await client.get({ path: 'products/1234567890/metafields' })

      expect(response.body.metafields).toHaveLength(2)
    })
  })

  describe('create metafield', () => {
    it('should create a product metafield', async () => {
      const newMetafield = mockMetafield({
        namespace: 'custom',
        key: 'weight_info',
        value: '{"unit": "kg", "value": 2.5}',
        type: 'json',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products/1234567890/metafields.json`,
            { status: 201, body: { metafield: newMetafield } },
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
        path: 'products/1234567890/metafields',
        data: {
          metafield: {
            namespace: 'custom',
            key: 'weight_info',
            value: '{"unit": "kg", "value": 2.5}',
            type: 'json',
          },
        },
      })

      expect(response.body.metafield.key).toBe('weight_info')
      expect(response.body.metafield.type).toBe('json')
    })

    it('should create a metafield with single_line_text_field type', async () => {
      const newMetafield = mockMetafield({
        namespace: 'custom',
        key: 'subtitle',
        value: 'Premium quality product',
        type: 'single_line_text_field',
      })

      const mockFetch = createMockFetch(
        new Map([
          [
            `POST /admin/api/${LATEST_API_VERSION}/products/1234567890/metafields.json`,
            { status: 201, body: { metafield: newMetafield } },
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
        path: 'products/1234567890/metafields',
        data: {
          metafield: {
            namespace: 'custom',
            key: 'subtitle',
            value: 'Premium quality product',
            type: 'single_line_text_field',
          },
        },
      })

      expect(response.body.metafield.type).toBe('single_line_text_field')
    })
  })

  describe('update metafield', () => {
    it('should update a product metafield', async () => {
      const updatedMetafield = mockMetafield({ value: 'Updated value' })
      const mockFetch = createMockFetch(
        new Map([
          [
            `PUT /admin/api/${LATEST_API_VERSION}/products/1234567890/metafields/6666666666.json`,
            { status: 200, body: { metafield: updatedMetafield } },
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
        path: 'products/1234567890/metafields/6666666666',
        data: { metafield: { value: 'Updated value' } },
      })

      expect(response.body.metafield.value).toBe('Updated value')
    })
  })

  describe('delete metafield', () => {
    it('should delete a product metafield', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            `DELETE /admin/api/${LATEST_API_VERSION}/products/1234567890/metafields/6666666666.json`,
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
      const response = await client.delete({ path: 'products/1234567890/metafields/6666666666' })

      expect(response.body).toEqual({})
    })
  })
})
