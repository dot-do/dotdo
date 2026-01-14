/**
 * @dotdo/woocommerce - Products API Tests
 *
 * TDD tests for WooCommerce Products REST API compatibility layer.
 * Tests cover:
 * - Product CRUD operations (simple, variable, grouped products)
 * - Product variations management
 * - Product categories and tags
 * - Product attributes and terms
 * - Image handling
 * - Batch operations
 *
 * @module @dotdo/woocommerce/tests/products
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  wooCommerceApi,
  type WooCommerceConfig,
  type Product,
  type ProductVariation,
  type ProductCategory,
  type ProductTag,
  type GlobalProductAttribute,
  type AttributeTerm,
} from '../index'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockFetch(
  responses: Map<string, { status: number; body: unknown; headers?: Record<string, string> }>
) {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const urlObj = new URL(url)
    const method = options?.method ?? 'GET'
    // Remove query params and get just the path after wp-json/wc/v3/
    const pathMatch = urlObj.pathname.match(/\/wp-json\/wc\/v3\/(.*)/)
    const path = pathMatch ? pathMatch[1] : urlObj.pathname
    const key = `${method} ${path}`

    // Check for exact match first
    let mockResponse = responses.get(key)

    // If no exact match, try pattern matching for resource IDs
    if (!mockResponse) {
      for (const [pattern, response] of responses.entries()) {
        const regexPattern = pattern.replace(/:\w+/g, '[^/]+').replace(/\./g, '\\.')
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
        headers: new Headers(),
        json: async () => ({
          code: 'rest_no_route',
          message: `No mock for ${key}`,
          data: { status: 404 },
        }),
        text: async () =>
          JSON.stringify({
            code: 'rest_no_route',
            message: `No mock for ${key}`,
            data: { status: 404 },
          }),
      }
    }

    return {
      ok: mockResponse.status >= 200 && mockResponse.status < 300,
      status: mockResponse.status,
      headers: new Headers({
        'X-WP-Total': '100',
        'X-WP-TotalPages': '10',
        ...(mockResponse.headers || {}),
      }),
      json: async () => mockResponse.body,
      text: async () => JSON.stringify(mockResponse.body),
    }
  })
}

function mockProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: 'Test Product',
    slug: 'test-product',
    permalink: 'https://store.test/product/test-product',
    date_created: '2024-01-01T00:00:00',
    date_created_gmt: '2024-01-01T00:00:00',
    date_modified: '2024-01-01T00:00:00',
    date_modified_gmt: '2024-01-01T00:00:00',
    type: 'simple',
    status: 'publish',
    featured: false,
    catalog_visibility: 'visible',
    description: '<p>Test description</p>',
    short_description: 'Short description',
    sku: 'TEST-001',
    price: '19.99',
    regular_price: '19.99',
    sale_price: '',
    date_on_sale_from: null,
    date_on_sale_from_gmt: null,
    date_on_sale_to: null,
    date_on_sale_to_gmt: null,
    price_html: '<span class="price">$19.99</span>',
    on_sale: false,
    purchasable: true,
    total_sales: 0,
    virtual: false,
    downloadable: false,
    downloads: [],
    download_limit: -1,
    download_expiry: -1,
    external_url: '',
    button_text: '',
    tax_status: 'taxable',
    tax_class: '',
    manage_stock: false,
    stock_quantity: null,
    stock_status: 'instock',
    backorders: 'no',
    backorders_allowed: false,
    backordered: false,
    sold_individually: false,
    weight: '',
    dimensions: { length: '', width: '', height: '' },
    shipping_required: true,
    shipping_taxable: true,
    shipping_class: '',
    shipping_class_id: 0,
    reviews_allowed: true,
    average_rating: '0.00',
    rating_count: 0,
    related_ids: [],
    upsell_ids: [],
    cross_sell_ids: [],
    parent_id: 0,
    purchase_note: '',
    categories: [],
    tags: [],
    images: [],
    attributes: [],
    default_attributes: [],
    variations: [],
    grouped_products: [],
    menu_order: 0,
    meta_data: [],
    ...overrides,
  }
}

function mockVariation(overrides: Partial<ProductVariation> = {}): ProductVariation {
  return {
    id: 101,
    date_created: '2024-01-01T00:00:00',
    date_created_gmt: '2024-01-01T00:00:00',
    date_modified: '2024-01-01T00:00:00',
    date_modified_gmt: '2024-01-01T00:00:00',
    description: '',
    permalink: 'https://store.test/product/test-product/?attribute_size=M',
    sku: 'TEST-001-M',
    price: '24.99',
    regular_price: '24.99',
    sale_price: '',
    date_on_sale_from: null,
    date_on_sale_from_gmt: null,
    date_on_sale_to: null,
    date_on_sale_to_gmt: null,
    on_sale: false,
    status: 'publish',
    purchasable: true,
    virtual: false,
    downloadable: false,
    downloads: [],
    download_limit: -1,
    download_expiry: -1,
    tax_status: 'taxable',
    tax_class: '',
    manage_stock: false,
    stock_quantity: null,
    stock_status: 'instock',
    backorders: 'no',
    backorders_allowed: false,
    backordered: false,
    weight: '',
    dimensions: { length: '', width: '', height: '' },
    shipping_class: '',
    shipping_class_id: 0,
    image: null,
    attributes: [{ id: 1, name: 'Size', option: 'M' }],
    menu_order: 0,
    meta_data: [],
    ...overrides,
  }
}

function mockCategory(overrides: Partial<ProductCategory> = {}): ProductCategory {
  return {
    id: 1,
    name: 'Test Category',
    slug: 'test-category',
    parent: 0,
    description: 'Test category description',
    display: 'default',
    image: null,
    menu_order: 0,
    count: 5,
    ...overrides,
  }
}

function mockTag(overrides: Partial<ProductTag> = {}): ProductTag {
  return {
    id: 1,
    name: 'Test Tag',
    slug: 'test-tag',
    description: '',
    count: 3,
    ...overrides,
  }
}

function mockAttribute(overrides: Partial<GlobalProductAttribute> = {}): GlobalProductAttribute {
  return {
    id: 1,
    name: 'Size',
    slug: 'pa_size',
    type: 'select',
    order_by: 'menu_order',
    has_archives: false,
    ...overrides,
  }
}

function mockAttributeTerm(overrides: Partial<AttributeTerm> = {}): AttributeTerm {
  return {
    id: 1,
    name: 'Medium',
    slug: 'medium',
    description: '',
    menu_order: 0,
    count: 5,
    ...overrides,
  }
}

function createWooCommerce(mockFetch: typeof fetch): ReturnType<typeof wooCommerceApi> {
  return wooCommerceApi({
    url: 'https://store.test',
    consumerKey: 'ck_test_key',
    consumerSecret: 'cs_test_secret',
    fetch: mockFetch,
  })
}

// =============================================================================
// Products CRUD Tests
// =============================================================================

describe('@dotdo/woocommerce - Products Resource API', () => {
  describe('products.list()', () => {
    it('should list all products', async () => {
      const products = [mockProduct({ id: 1 }), mockProduct({ id: 2, name: 'Product 2' })]
      const mockFetch = createMockFetch(
        new Map([['GET products', { status: 200, body: products }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.list()

      expect(result.body).toHaveLength(2)
      expect(result.body[0].id).toBe(1)
      expect(result.body[1].id).toBe(2)
    })

    it('should support pagination parameters', async () => {
      const mockFetch = createMockFetch(
        new Map([['GET products', { status: 200, body: [mockProduct()] }]])
      )

      const wc = createWooCommerce(mockFetch)
      await wc.products.list({ page: 2, per_page: 10 })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('page=2'),
        expect.any(Object)
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('per_page=10'),
        expect.any(Object)
      )
    })

    it('should filter by status', async () => {
      const mockFetch = createMockFetch(
        new Map([['GET products', { status: 200, body: [] }]])
      )

      const wc = createWooCommerce(mockFetch)
      await wc.products.list({ status: 'draft' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=draft'),
        expect.any(Object)
      )
    })

    it('should filter by type', async () => {
      const mockFetch = createMockFetch(
        new Map([['GET products', { status: 200, body: [] }]])
      )

      const wc = createWooCommerce(mockFetch)
      await wc.products.list({ type: 'variable' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('type=variable'),
        expect.any(Object)
      )
    })

    it('should filter by category', async () => {
      const mockFetch = createMockFetch(
        new Map([['GET products', { status: 200, body: [] }]])
      )

      const wc = createWooCommerce(mockFetch)
      await wc.products.list({ category: '15' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('category=15'),
        expect.any(Object)
      )
    })

    it('should search products by keyword', async () => {
      const mockFetch = createMockFetch(
        new Map([['GET products', { status: 200, body: [] }]])
      )

      const wc = createWooCommerce(mockFetch)
      await wc.products.list({ search: 'shirt' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('search=shirt'),
        expect.any(Object)
      )
    })
  })

  describe('products.get()', () => {
    it('should get a single product by ID', async () => {
      const product = mockProduct({ id: 123 })
      const mockFetch = createMockFetch(
        new Map([['GET products/123', { status: 200, body: product }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.get(123)

      expect(result.body.id).toBe(123)
      expect(result.body.name).toBe('Test Product')
    })

    it('should throw error for non-existent product', async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            'GET products/999',
            {
              status: 404,
              body: {
                code: 'woocommerce_rest_product_invalid_id',
                message: 'Invalid ID.',
                data: { status: 404 },
              },
            },
          ],
        ])
      )

      const wc = createWooCommerce(mockFetch)
      await expect(wc.products.get(999)).rejects.toThrow()
    })
  })

  describe('products.create()', () => {
    it('should create a simple product', async () => {
      const newProduct = mockProduct({ id: 100, name: 'New Simple Product', type: 'simple' })
      const mockFetch = createMockFetch(
        new Map([['POST products', { status: 201, body: newProduct }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.create({
        name: 'New Simple Product',
        type: 'simple',
        regular_price: '19.99',
      })

      expect(result.body.id).toBe(100)
      expect(result.body.name).toBe('New Simple Product')
      expect(result.body.type).toBe('simple')
    })

    it('should create a variable product with attributes', async () => {
      const variableProduct = mockProduct({
        id: 101,
        name: 'Variable T-Shirt',
        type: 'variable',
        attributes: [
          { id: 1, name: 'Size', position: 0, visible: true, variation: true, options: ['S', 'M', 'L'] },
          { id: 2, name: 'Color', position: 1, visible: true, variation: true, options: ['Red', 'Blue'] },
        ],
      })
      const mockFetch = createMockFetch(
        new Map([['POST products', { status: 201, body: variableProduct }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.create({
        name: 'Variable T-Shirt',
        type: 'variable',
        attributes: [
          { name: 'Size', variation: true, options: ['S', 'M', 'L'] },
          { name: 'Color', variation: true, options: ['Red', 'Blue'] },
        ],
      })

      expect(result.body.type).toBe('variable')
      expect(result.body.attributes).toHaveLength(2)
    })

    it('should create a grouped product', async () => {
      const groupedProduct = mockProduct({
        id: 102,
        name: 'Product Bundle',
        type: 'grouped',
        grouped_products: [1, 2, 3],
      })
      const mockFetch = createMockFetch(
        new Map([['POST products', { status: 201, body: groupedProduct }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.create({
        name: 'Product Bundle',
        type: 'grouped',
        grouped_products: [1, 2, 3],
      })

      expect(result.body.type).toBe('grouped')
      expect(result.body.grouped_products).toEqual([1, 2, 3])
    })

    it('should create a product with images', async () => {
      const productWithImages = mockProduct({
        id: 103,
        images: [
          {
            id: 1,
            src: 'https://example.com/image1.jpg',
            name: 'Image 1',
            alt: 'Product image',
            date_created: '2024-01-01T00:00:00',
            date_created_gmt: '2024-01-01T00:00:00',
            date_modified: '2024-01-01T00:00:00',
            date_modified_gmt: '2024-01-01T00:00:00',
          },
        ],
      })
      const mockFetch = createMockFetch(
        new Map([['POST products', { status: 201, body: productWithImages }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.create({
        name: 'Product with Image',
        images: [{ src: 'https://example.com/image1.jpg', alt: 'Product image' }],
      })

      expect(result.body.images).toHaveLength(1)
      expect(result.body.images[0].src).toBe('https://example.com/image1.jpg')
    })

    it('should create a product with categories', async () => {
      const productWithCategories = mockProduct({
        id: 104,
        categories: [
          { id: 1, name: 'Clothing', slug: 'clothing' },
          { id: 2, name: 'T-Shirts', slug: 't-shirts' },
        ],
      })
      const mockFetch = createMockFetch(
        new Map([['POST products', { status: 201, body: productWithCategories }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.create({
        name: 'Categorized Product',
        categories: [{ id: 1 }, { id: 2 }],
      })

      expect(result.body.categories).toHaveLength(2)
    })
  })

  describe('products.update()', () => {
    it('should update a product', async () => {
      const updatedProduct = mockProduct({ id: 1, name: 'Updated Product Name' })
      const mockFetch = createMockFetch(
        new Map([['PUT products/1', { status: 200, body: updatedProduct }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.update(1, { name: 'Updated Product Name' })

      expect(result.body.name).toBe('Updated Product Name')
    })

    it('should update product price', async () => {
      const updatedProduct = mockProduct({ id: 1, regular_price: '29.99', price: '29.99' })
      const mockFetch = createMockFetch(
        new Map([['PUT products/1', { status: 200, body: updatedProduct }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.update(1, { regular_price: '29.99' })

      expect(result.body.regular_price).toBe('29.99')
    })

    it('should update product stock', async () => {
      const updatedProduct = mockProduct({
        id: 1,
        manage_stock: true,
        stock_quantity: 50,
        stock_status: 'instock',
      })
      const mockFetch = createMockFetch(
        new Map([['PUT products/1', { status: 200, body: updatedProduct }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.update(1, {
        manage_stock: true,
        stock_quantity: 50,
      })

      expect(result.body.manage_stock).toBe(true)
      expect(result.body.stock_quantity).toBe(50)
    })
  })

  describe('products.delete()', () => {
    it('should delete a product (move to trash)', async () => {
      const deletedProduct = mockProduct({ id: 1, status: 'draft' })
      const mockFetch = createMockFetch(
        new Map([['DELETE products/1', { status: 200, body: deletedProduct }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.delete(1)

      expect(result.body.id).toBe(1)
    })

    it('should permanently delete a product with force=true', async () => {
      const deletedProduct = mockProduct({ id: 1 })
      const mockFetch = createMockFetch(
        new Map([['DELETE products/1', { status: 200, body: deletedProduct }]])
      )

      const wc = createWooCommerce(mockFetch)
      await wc.products.delete(1, { force: true })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('force=true'),
        expect.any(Object)
      )
    })
  })

  describe('products.batch()', () => {
    it('should batch create products', async () => {
      const batchResponse = {
        create: [mockProduct({ id: 1 }), mockProduct({ id: 2 })],
      }
      const mockFetch = createMockFetch(
        new Map([['POST products/batch', { status: 200, body: batchResponse }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.batch({
        create: [
          { name: 'Product 1', regular_price: '10.00' },
          { name: 'Product 2', regular_price: '20.00' },
        ],
      })

      expect(result.body.create).toHaveLength(2)
    })

    it('should batch update products', async () => {
      const batchResponse = {
        update: [
          mockProduct({ id: 1, name: 'Updated 1' }),
          mockProduct({ id: 2, name: 'Updated 2' }),
        ],
      }
      const mockFetch = createMockFetch(
        new Map([['POST products/batch', { status: 200, body: batchResponse }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.batch({
        update: [
          { id: 1, name: 'Updated 1' },
          { id: 2, name: 'Updated 2' },
        ],
      })

      expect(result.body.update).toHaveLength(2)
    })

    it('should batch delete products', async () => {
      const batchResponse = {
        delete: [mockProduct({ id: 1 }), mockProduct({ id: 2 })],
      }
      const mockFetch = createMockFetch(
        new Map([['POST products/batch', { status: 200, body: batchResponse }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.batch({
        delete: [1, 2],
      })

      expect(result.body.delete).toHaveLength(2)
    })
  })
})

// =============================================================================
// Product Variations Tests
// =============================================================================

describe('@dotdo/woocommerce - Variations Resource API', () => {
  describe('variations.list()', () => {
    it('should list all variations for a product', async () => {
      const variations = [mockVariation({ id: 101 }), mockVariation({ id: 102 })]
      const mockFetch = createMockFetch(
        new Map([['GET products/1/variations', { status: 200, body: variations }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.variations.list(1)

      expect(result.body).toHaveLength(2)
    })
  })

  describe('variations.get()', () => {
    it('should get a single variation', async () => {
      const variation = mockVariation({ id: 101 })
      const mockFetch = createMockFetch(
        new Map([['GET products/1/variations/101', { status: 200, body: variation }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.variations.get(1, 101)

      expect(result.body.id).toBe(101)
    })
  })

  describe('variations.create()', () => {
    it('should create a variation', async () => {
      const newVariation = mockVariation({
        id: 103,
        regular_price: '24.99',
        attributes: [{ id: 1, name: 'Size', option: 'L' }],
      })
      const mockFetch = createMockFetch(
        new Map([['POST products/1/variations', { status: 201, body: newVariation }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.variations.create(1, {
        regular_price: '24.99',
        attributes: [{ name: 'Size', option: 'L' }],
      })

      expect(result.body.id).toBe(103)
      expect(result.body.attributes[0].option).toBe('L')
    })

    it('should create a variation with image', async () => {
      const variationWithImage = mockVariation({
        id: 104,
        image: {
          id: 1,
          src: 'https://example.com/blue-shirt.jpg',
          name: 'Blue Shirt',
          alt: 'Blue variant',
          date_created: '2024-01-01T00:00:00',
          date_created_gmt: '2024-01-01T00:00:00',
          date_modified: '2024-01-01T00:00:00',
          date_modified_gmt: '2024-01-01T00:00:00',
        },
      })
      const mockFetch = createMockFetch(
        new Map([['POST products/1/variations', { status: 201, body: variationWithImage }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.variations.create(1, {
        image: { src: 'https://example.com/blue-shirt.jpg', alt: 'Blue variant' },
      })

      expect(result.body.image).not.toBeNull()
      expect(result.body.image?.src).toBe('https://example.com/blue-shirt.jpg')
    })
  })

  describe('variations.update()', () => {
    it('should update a variation', async () => {
      const updatedVariation = mockVariation({ id: 101, regular_price: '29.99' })
      const mockFetch = createMockFetch(
        new Map([['PUT products/1/variations/101', { status: 200, body: updatedVariation }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.variations.update(1, 101, { regular_price: '29.99' })

      expect(result.body.regular_price).toBe('29.99')
    })
  })

  describe('variations.delete()', () => {
    it('should delete a variation', async () => {
      const deletedVariation = mockVariation({ id: 101 })
      const mockFetch = createMockFetch(
        new Map([['DELETE products/1/variations/101', { status: 200, body: deletedVariation }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.variations.delete(1, 101)

      expect(result.body.id).toBe(101)
    })
  })

  describe('variations.batch()', () => {
    it('should batch create variations', async () => {
      const batchResponse = {
        create: [mockVariation({ id: 101 }), mockVariation({ id: 102 })],
      }
      const mockFetch = createMockFetch(
        new Map([['POST products/1/variations/batch', { status: 200, body: batchResponse }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.variations.batch(1, {
        create: [
          { regular_price: '24.99', attributes: [{ name: 'Size', option: 'S' }] },
          { regular_price: '24.99', attributes: [{ name: 'Size', option: 'M' }] },
        ],
      })

      expect(result.body.create).toHaveLength(2)
    })
  })
})

// =============================================================================
// Product Categories Tests
// =============================================================================

describe('@dotdo/woocommerce - Categories Resource API', () => {
  describe('categories.list()', () => {
    it('should list all categories', async () => {
      const categories = [mockCategory({ id: 1 }), mockCategory({ id: 2, name: 'Category 2' })]
      const mockFetch = createMockFetch(
        new Map([['GET products/categories', { status: 200, body: categories }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.categories.list()

      expect(result.body).toHaveLength(2)
    })

    it('should filter by parent category', async () => {
      const mockFetch = createMockFetch(
        new Map([['GET products/categories', { status: 200, body: [] }]])
      )

      const wc = createWooCommerce(mockFetch)
      await wc.products.categories.list({ parent: 5 })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('parent=5'),
        expect.any(Object)
      )
    })
  })

  describe('categories.get()', () => {
    it('should get a single category', async () => {
      const category = mockCategory({ id: 1 })
      const mockFetch = createMockFetch(
        new Map([['GET products/categories/1', { status: 200, body: category }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.categories.get(1)

      expect(result.body.id).toBe(1)
    })
  })

  describe('categories.create()', () => {
    it('should create a category', async () => {
      const newCategory = mockCategory({ id: 10, name: 'New Category' })
      const mockFetch = createMockFetch(
        new Map([['POST products/categories', { status: 201, body: newCategory }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.categories.create({ name: 'New Category' })

      expect(result.body.name).toBe('New Category')
    })

    it('should create a subcategory', async () => {
      const subcategory = mockCategory({ id: 11, name: 'Subcategory', parent: 1 })
      const mockFetch = createMockFetch(
        new Map([['POST products/categories', { status: 201, body: subcategory }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.categories.create({
        name: 'Subcategory',
        parent: 1,
      })

      expect(result.body.parent).toBe(1)
    })

    it('should create a category with image', async () => {
      const categoryWithImage = mockCategory({
        id: 12,
        image: {
          id: 1,
          src: 'https://example.com/category.jpg',
          name: 'Category Image',
          alt: 'Category thumbnail',
          date_created: '2024-01-01T00:00:00',
          date_created_gmt: '2024-01-01T00:00:00',
          date_modified: '2024-01-01T00:00:00',
          date_modified_gmt: '2024-01-01T00:00:00',
        },
      })
      const mockFetch = createMockFetch(
        new Map([['POST products/categories', { status: 201, body: categoryWithImage }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.categories.create({
        name: 'Category with Image',
        image: { src: 'https://example.com/category.jpg' },
      })

      expect(result.body.image).not.toBeNull()
    })
  })

  describe('categories.update()', () => {
    it('should update a category', async () => {
      const updatedCategory = mockCategory({ id: 1, name: 'Updated Category' })
      const mockFetch = createMockFetch(
        new Map([['PUT products/categories/1', { status: 200, body: updatedCategory }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.categories.update(1, { name: 'Updated Category' })

      expect(result.body.name).toBe('Updated Category')
    })
  })

  describe('categories.delete()', () => {
    it('should delete a category', async () => {
      const deletedCategory = mockCategory({ id: 1 })
      const mockFetch = createMockFetch(
        new Map([['DELETE products/categories/1', { status: 200, body: deletedCategory }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.categories.delete(1, { force: true })

      expect(result.body.id).toBe(1)
    })
  })
})

// =============================================================================
// Product Tags Tests
// =============================================================================

describe('@dotdo/woocommerce - Tags Resource API', () => {
  describe('tags.list()', () => {
    it('should list all tags', async () => {
      const tags = [mockTag({ id: 1 }), mockTag({ id: 2, name: 'Tag 2' })]
      const mockFetch = createMockFetch(
        new Map([['GET products/tags', { status: 200, body: tags }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.tags.list()

      expect(result.body).toHaveLength(2)
    })
  })

  describe('tags.create()', () => {
    it('should create a tag', async () => {
      const newTag = mockTag({ id: 10, name: 'Sale' })
      const mockFetch = createMockFetch(
        new Map([['POST products/tags', { status: 201, body: newTag }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.tags.create({ name: 'Sale' })

      expect(result.body.name).toBe('Sale')
    })
  })

  describe('tags.update()', () => {
    it('should update a tag', async () => {
      const updatedTag = mockTag({ id: 1, name: 'Updated Tag' })
      const mockFetch = createMockFetch(
        new Map([['PUT products/tags/1', { status: 200, body: updatedTag }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.tags.update(1, { name: 'Updated Tag' })

      expect(result.body.name).toBe('Updated Tag')
    })
  })

  describe('tags.delete()', () => {
    it('should delete a tag', async () => {
      const deletedTag = mockTag({ id: 1 })
      const mockFetch = createMockFetch(
        new Map([['DELETE products/tags/1', { status: 200, body: deletedTag }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.tags.delete(1, { force: true })

      expect(result.body.id).toBe(1)
    })
  })
})

// =============================================================================
// Product Attributes Tests
// =============================================================================

describe('@dotdo/woocommerce - Attributes Resource API', () => {
  describe('attributes.list()', () => {
    it('should list all global attributes', async () => {
      const attributes = [mockAttribute({ id: 1, name: 'Size' }), mockAttribute({ id: 2, name: 'Color' })]
      const mockFetch = createMockFetch(
        new Map([['GET products/attributes', { status: 200, body: attributes }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.attributes.list()

      expect(result.body).toHaveLength(2)
    })
  })

  describe('attributes.create()', () => {
    it('should create a global attribute', async () => {
      const newAttribute = mockAttribute({ id: 3, name: 'Material' })
      const mockFetch = createMockFetch(
        new Map([['POST products/attributes', { status: 201, body: newAttribute }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.attributes.create({ name: 'Material' })

      expect(result.body.name).toBe('Material')
    })
  })

  describe('attributes.update()', () => {
    it('should update an attribute', async () => {
      const updatedAttribute = mockAttribute({ id: 1, name: 'Updated Size' })
      const mockFetch = createMockFetch(
        new Map([['PUT products/attributes/1', { status: 200, body: updatedAttribute }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.attributes.update(1, { name: 'Updated Size' })

      expect(result.body.name).toBe('Updated Size')
    })
  })

  describe('attributes.delete()', () => {
    it('should delete an attribute', async () => {
      const deletedAttribute = mockAttribute({ id: 1 })
      const mockFetch = createMockFetch(
        new Map([['DELETE products/attributes/1', { status: 200, body: deletedAttribute }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.attributes.delete(1, { force: true })

      expect(result.body.id).toBe(1)
    })
  })
})

// =============================================================================
// Attribute Terms Tests
// =============================================================================

describe('@dotdo/woocommerce - Attribute Terms Resource API', () => {
  describe('attributes.terms.list()', () => {
    it('should list all terms for an attribute', async () => {
      const terms = [
        mockAttributeTerm({ id: 1, name: 'Small' }),
        mockAttributeTerm({ id: 2, name: 'Medium' }),
        mockAttributeTerm({ id: 3, name: 'Large' }),
      ]
      const mockFetch = createMockFetch(
        new Map([['GET products/attributes/1/terms', { status: 200, body: terms }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.attributes.terms.list(1)

      expect(result.body).toHaveLength(3)
    })
  })

  describe('attributes.terms.create()', () => {
    it('should create an attribute term', async () => {
      const newTerm = mockAttributeTerm({ id: 4, name: 'Extra Large' })
      const mockFetch = createMockFetch(
        new Map([['POST products/attributes/1/terms', { status: 201, body: newTerm }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.attributes.terms.create(1, { name: 'Extra Large' })

      expect(result.body.name).toBe('Extra Large')
    })
  })

  describe('attributes.terms.update()', () => {
    it('should update an attribute term', async () => {
      const updatedTerm = mockAttributeTerm({ id: 1, name: 'XS' })
      const mockFetch = createMockFetch(
        new Map([['PUT products/attributes/1/terms/1', { status: 200, body: updatedTerm }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.attributes.terms.update(1, 1, { name: 'XS' })

      expect(result.body.name).toBe('XS')
    })
  })

  describe('attributes.terms.delete()', () => {
    it('should delete an attribute term', async () => {
      const deletedTerm = mockAttributeTerm({ id: 1 })
      const mockFetch = createMockFetch(
        new Map([['DELETE products/attributes/1/terms/1', { status: 200, body: deletedTerm }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.attributes.terms.delete(1, 1, { force: true })

      expect(result.body.id).toBe(1)
    })
  })

  describe('attributes.terms.batch()', () => {
    it('should batch create attribute terms', async () => {
      const batchResponse = {
        create: [
          mockAttributeTerm({ id: 1, name: 'S' }),
          mockAttributeTerm({ id: 2, name: 'M' }),
          mockAttributeTerm({ id: 3, name: 'L' }),
        ],
      }
      const mockFetch = createMockFetch(
        new Map([['POST products/attributes/1/terms/batch', { status: 200, body: batchResponse }]])
      )

      const wc = createWooCommerce(mockFetch)
      const result = await wc.products.attributes.terms.batch(1, {
        create: [{ name: 'S' }, { name: 'M' }, { name: 'L' }],
      })

      expect(result.body.create).toHaveLength(3)
    })
  })
})

// =============================================================================
// Image Handling Tests
// =============================================================================

describe('@dotdo/woocommerce - Image Handling', () => {
  it('should create a product with multiple images', async () => {
    const productWithImages = mockProduct({
      id: 1,
      images: [
        {
          id: 1,
          src: 'https://example.com/image1.jpg',
          name: 'Image 1',
          alt: 'Front view',
          date_created: '2024-01-01T00:00:00',
          date_created_gmt: '2024-01-01T00:00:00',
          date_modified: '2024-01-01T00:00:00',
          date_modified_gmt: '2024-01-01T00:00:00',
        },
        {
          id: 2,
          src: 'https://example.com/image2.jpg',
          name: 'Image 2',
          alt: 'Back view',
          date_created: '2024-01-01T00:00:00',
          date_created_gmt: '2024-01-01T00:00:00',
          date_modified: '2024-01-01T00:00:00',
          date_modified_gmt: '2024-01-01T00:00:00',
        },
      ],
    })
    const mockFetch = createMockFetch(
      new Map([['POST products', { status: 201, body: productWithImages }]])
    )

    const wc = createWooCommerce(mockFetch)
    const result = await wc.products.create({
      name: 'Product with Images',
      images: [
        { src: 'https://example.com/image1.jpg', alt: 'Front view' },
        { src: 'https://example.com/image2.jpg', alt: 'Back view' },
      ],
    })

    expect(result.body.images).toHaveLength(2)
  })

  it('should update product images', async () => {
    const updatedProduct = mockProduct({
      id: 1,
      images: [
        {
          id: 3,
          src: 'https://example.com/new-image.jpg',
          name: 'New Image',
          alt: 'Updated image',
          date_created: '2024-01-01T00:00:00',
          date_created_gmt: '2024-01-01T00:00:00',
          date_modified: '2024-01-01T00:00:00',
          date_modified_gmt: '2024-01-01T00:00:00',
        },
      ],
    })
    const mockFetch = createMockFetch(
      new Map([['PUT products/1', { status: 200, body: updatedProduct }]])
    )

    const wc = createWooCommerce(mockFetch)
    const result = await wc.products.update(1, {
      images: [{ src: 'https://example.com/new-image.jpg', alt: 'Updated image' }],
    })

    expect(result.body.images).toHaveLength(1)
    expect(result.body.images[0].src).toBe('https://example.com/new-image.jpg')
  })
})

// =============================================================================
// Authentication Tests
// =============================================================================

describe('@dotdo/woocommerce - Authentication', () => {
  it('should use Basic Auth by default', async () => {
    const mockFetch = createMockFetch(
      new Map([['GET products', { status: 200, body: [] }]])
    )

    const wc = wooCommerceApi({
      url: 'https://store.test',
      consumerKey: 'ck_test_key',
      consumerSecret: 'cs_test_secret',
      fetch: mockFetch,
      useBasicAuth: true,
    })

    await wc.products.list()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringContaining('Basic'),
        }),
      })
    )
  })

  it('should use query string authentication when not using Basic Auth', async () => {
    const mockFetch = createMockFetch(
      new Map([['GET products', { status: 200, body: [] }]])
    )

    const wc = wooCommerceApi({
      url: 'https://store.test',
      consumerKey: 'ck_test_key',
      consumerSecret: 'cs_test_secret',
      fetch: mockFetch,
      useBasicAuth: false,
    })

    await wc.products.list()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('consumer_key=ck_test_key'),
      expect.any(Object)
    )
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('consumer_secret=cs_test_secret'),
      expect.any(Object)
    )
  })
})
