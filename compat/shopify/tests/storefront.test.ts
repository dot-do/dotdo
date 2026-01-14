/**
 * @dotdo/shopify - Storefront API Tests
 *
 * Comprehensive tests for Shopify Storefront API compatibility layer.
 * Tests product queries, collection queries, cart management, checkout flow,
 * and customer authentication.
 *
 * @see https://shopify.dev/docs/api/storefront
 * @module @dotdo/shopify/tests/storefront
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createStorefrontClient,
  STOREFRONT_API_VERSION,
  StorefrontAPIError,
  type StorefrontClient,
  type StorefrontConfig,
  type StorefrontProduct,
  type StorefrontCollection,
  type Cart,
  type Checkout,
} from '../storefront'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockFetch(response: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({
      'content-type': 'application/json',
    }),
    json: async () => response,
    text: async () => JSON.stringify(response),
  }))
}

function createGraphQLResponse<T>(data: T, errors?: unknown[]) {
  return {
    data,
    errors,
  }
}

const testConfig: StorefrontConfig = {
  storeDomain: 'test-store.myshopify.com',
  publicAccessToken: 'test-storefront-token',
}

// =============================================================================
// Client Creation Tests
// =============================================================================

describe('Storefront Client Creation', () => {
  it('should create a client with required config', () => {
    const client = createStorefrontClient(testConfig)
    expect(client).toBeDefined()
    expect(client.product).toBeDefined()
    expect(client.collection).toBeDefined()
    expect(client.cart).toBeDefined()
    expect(client.checkout).toBeDefined()
    expect(client.customer).toBeDefined()
    expect(client.shop).toBeDefined()
    expect(client.query).toBeDefined()
  })

  it('should throw error without store domain', () => {
    expect(() => createStorefrontClient({
      storeDomain: '',
      publicAccessToken: 'token',
    })).toThrow('Store domain is required')
  })

  it('should throw error without access token', () => {
    expect(() => createStorefrontClient({
      storeDomain: 'test-store.myshopify.com',
      publicAccessToken: '',
    })).toThrow('Either publicAccessToken or privateAccessToken is required')
  })

  it('should normalize store domain with https prefix', () => {
    const mockFetch = createMockFetch(createGraphQLResponse({ product: null }))
    const client = createStorefrontClient({
      storeDomain: 'https://test-store.myshopify.com',
      publicAccessToken: 'token',
      fetch: mockFetch as unknown as typeof fetch,
    })

    // Make a request to verify the URL is correct
    client.product.getByHandle('test')
    expect(mockFetch).toHaveBeenCalled()
    const callUrl = mockFetch.mock.calls[0][0] as string
    expect(callUrl).toBe(`https://test-store.myshopify.com/api/${STOREFRONT_API_VERSION}/graphql.json`)
  })

  it('should use default API version', () => {
    const mockFetch = createMockFetch(createGraphQLResponse({ product: null }))
    const client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    client.product.getByHandle('test')
    expect(mockFetch).toHaveBeenCalled()
    const callUrl = mockFetch.mock.calls[0][0] as string
    expect(callUrl).toContain(STOREFRONT_API_VERSION)
  })

  it('should use custom API version when provided', () => {
    const mockFetch = createMockFetch(createGraphQLResponse({ product: null }))
    const client = createStorefrontClient({
      ...testConfig,
      apiVersion: '2024-07',
      fetch: mockFetch as unknown as typeof fetch,
    })

    client.product.getByHandle('test')
    expect(mockFetch).toHaveBeenCalled()
    const callUrl = mockFetch.mock.calls[0][0] as string
    expect(callUrl).toContain('2024-07')
  })

  it('should include public access token header', async () => {
    const mockFetch = createMockFetch(createGraphQLResponse({ product: null }))
    const client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    await client.product.getByHandle('test')
    expect(mockFetch).toHaveBeenCalled()
    const callOptions = mockFetch.mock.calls[0][1] as RequestInit
    expect(callOptions.headers).toHaveProperty('X-Shopify-Storefront-Access-Token', 'test-storefront-token')
  })

  it('should include private access token header when provided', async () => {
    const mockFetch = createMockFetch(createGraphQLResponse({ product: null }))
    const client = createStorefrontClient({
      ...testConfig,
      privateAccessToken: 'private-token',
      fetch: mockFetch as unknown as typeof fetch,
    })

    await client.product.getByHandle('test')
    expect(mockFetch).toHaveBeenCalled()
    const callOptions = mockFetch.mock.calls[0][1] as RequestInit
    expect(callOptions.headers).toHaveProperty('Shopify-Storefront-Private-Token', 'private-token')
  })
})

// =============================================================================
// Product Resource Tests
// =============================================================================

describe('Product Resource', () => {
  let client: StorefrontClient
  let mockFetch: ReturnType<typeof vi.fn>

  const mockProduct: StorefrontProduct = {
    id: 'gid://shopify/Product/123',
    handle: 'classic-tee',
    title: 'Classic T-Shirt',
    description: 'A classic t-shirt',
    descriptionHtml: '<p>A classic t-shirt</p>',
    vendor: 'Test Brand',
    productType: 'Apparel',
    tags: ['clothing', 'tshirt'],
    availableForSale: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    publishedAt: '2024-01-01T00:00:00Z',
    seo: { title: 'Classic T-Shirt', description: 'A classic t-shirt' },
    images: { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
    variants: { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
    options: [{ id: 'gid://shopify/ProductOption/1', name: 'Size', values: ['S', 'M', 'L'] }],
    priceRange: {
      minVariantPrice: { amount: '29.99', currencyCode: 'USD' },
      maxVariantPrice: { amount: '29.99', currencyCode: 'USD' },
    },
    compareAtPriceRange: {
      minVariantPrice: { amount: '39.99', currencyCode: 'USD' },
      maxVariantPrice: { amount: '39.99', currencyCode: 'USD' },
    },
  }

  beforeEach(() => {
    mockFetch = createMockFetch(createGraphQLResponse({ product: mockProduct }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })
  })

  it('should get product by handle', async () => {
    const product = await client.product.getByHandle('classic-tee')
    expect(product).toEqual(mockProduct)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.variables.handle).toBe('classic-tee')
  })

  it('should get product by ID', async () => {
    mockFetch = createMockFetch(createGraphQLResponse({ product: mockProduct }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const product = await client.product.getById('gid://shopify/Product/123')
    expect(product).toEqual(mockProduct)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.variables.id).toBe('gid://shopify/Product/123')
  })

  it('should return null for non-existent product', async () => {
    mockFetch = createMockFetch(createGraphQLResponse({ product: null }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const product = await client.product.getByHandle('non-existent')
    expect(product).toBeNull()
  })

  it('should list products with pagination', async () => {
    const mockProducts = {
      edges: [{ node: mockProduct, cursor: 'cursor1' }],
      pageInfo: { hasNextPage: true, hasPreviousPage: false, endCursor: 'cursor1' },
    }
    mockFetch = createMockFetch(createGraphQLResponse({ products: mockProducts }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.product.list({ first: 10 })
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].node).toEqual(mockProduct)
    expect(result.pageInfo.hasNextPage).toBe(true)
  })

  it('should search products', async () => {
    const mockSearch = {
      totalCount: 5,
      edges: [{ node: mockProduct, cursor: 'cursor1' }],
      pageInfo: { hasNextPage: true, hasPreviousPage: false },
    }
    mockFetch = createMockFetch(createGraphQLResponse({ search: mockSearch }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.product.search('organic cotton')
    expect(result.totalCount).toBe(5)
    expect(result.products.edges).toHaveLength(1)
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.variables.query).toBe('organic cotton')
  })

  it('should get product recommendations', async () => {
    mockFetch = createMockFetch(createGraphQLResponse({ productRecommendations: [mockProduct] }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const recommendations = await client.product.getRecommendations('gid://shopify/Product/123')
    expect(recommendations).toHaveLength(1)
    expect(recommendations[0]).toEqual(mockProduct)
  })

  it('should get variant by ID', async () => {
    const mockVariant = {
      id: 'gid://shopify/ProductVariant/456',
      title: 'Medium',
      availableForSale: true,
      price: { amount: '29.99', currencyCode: 'USD' },
      selectedOptions: [{ name: 'Size', value: 'M' }],
      product: { id: 'gid://shopify/Product/123', handle: 'classic-tee', title: 'Classic T-Shirt' },
    }
    mockFetch = createMockFetch(createGraphQLResponse({ node: mockVariant }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const variant = await client.product.getVariant('gid://shopify/ProductVariant/456')
    expect(variant).toEqual(mockVariant)
  })
})

// =============================================================================
// Collection Resource Tests
// =============================================================================

describe('Collection Resource', () => {
  let client: StorefrontClient
  let mockFetch: ReturnType<typeof vi.fn>

  const mockCollection: StorefrontCollection = {
    id: 'gid://shopify/Collection/789',
    handle: 'summer-sale',
    title: 'Summer Sale',
    description: 'Hot summer deals',
    descriptionHtml: '<p>Hot summer deals</p>',
    updatedAt: '2024-01-01T00:00:00Z',
    seo: { title: 'Summer Sale', description: 'Hot summer deals' },
    products: { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
  }

  beforeEach(() => {
    mockFetch = createMockFetch(createGraphQLResponse({ collection: mockCollection }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })
  })

  it('should get collection by handle', async () => {
    const collection = await client.collection.getByHandle('summer-sale')
    expect(collection).toEqual(mockCollection)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.variables.handle).toBe('summer-sale')
  })

  it('should get collection by ID', async () => {
    const collection = await client.collection.getById('gid://shopify/Collection/789')
    expect(collection).toEqual(mockCollection)
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.variables.id).toBe('gid://shopify/Collection/789')
  })

  it('should list collections', async () => {
    const mockCollections = {
      edges: [{ node: mockCollection, cursor: 'cursor1' }],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
    mockFetch = createMockFetch(createGraphQLResponse({ collections: mockCollections }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.collection.list({ first: 10 })
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].node).toEqual(mockCollection)
  })

  it('should get products in collection', async () => {
    const mockProducts = {
      edges: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    }
    mockFetch = createMockFetch(createGraphQLResponse({ collection: { products: mockProducts } }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.collection.getProducts('summer-sale', { first: 20 })
    expect(result).toEqual(mockProducts)
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.variables.handle).toBe('summer-sale')
  })
})

// =============================================================================
// Cart Resource Tests
// =============================================================================

describe('Cart Resource', () => {
  let client: StorefrontClient
  let mockFetch: ReturnType<typeof vi.fn>

  const mockCart: Cart = {
    id: 'gid://shopify/Cart/abc123',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    checkoutUrl: 'https://test-store.myshopify.com/cart/c/abc123',
    totalQuantity: 2,
    buyerIdentity: {},
    lines: { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
    cost: {
      totalAmount: { amount: '59.98', currencyCode: 'USD' },
      subtotalAmount: { amount: '59.98', currencyCode: 'USD' },
      checkoutChargeAmount: { amount: '59.98', currencyCode: 'USD' },
    },
    attributes: [],
    discountCodes: [],
    discountAllocations: [],
  }

  beforeEach(() => {
    mockFetch = createMockFetch(createGraphQLResponse({ cartCreate: { cart: mockCart, userErrors: [] } }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })
  })

  it('should create a new cart', async () => {
    const result = await client.cart.create()
    expect(result.cart).toEqual(mockCart)
    expect(result.userErrors).toHaveLength(0)
  })

  it('should create cart with initial lines', async () => {
    const result = await client.cart.create({
      lines: [{ merchandiseId: 'gid://shopify/ProductVariant/123', quantity: 2 }],
    })
    expect(result.cart).toEqual(mockCart)
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.variables.input.lines).toHaveLength(1)
    expect(callBody.variables.input.lines[0].merchandiseId).toBe('gid://shopify/ProductVariant/123')
  })

  it('should get cart by ID', async () => {
    mockFetch = createMockFetch(createGraphQLResponse({ cart: mockCart }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const cart = await client.cart.get('gid://shopify/Cart/abc123')
    expect(cart).toEqual(mockCart)
  })

  it('should add lines to cart', async () => {
    mockFetch = createMockFetch(createGraphQLResponse({ cartLinesAdd: { cart: mockCart, userErrors: [] } }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.cart.addLines('gid://shopify/Cart/abc123', [
      { merchandiseId: 'gid://shopify/ProductVariant/456', quantity: 1 },
    ])
    expect(result.cart).toEqual(mockCart)
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.variables.cartId).toBe('gid://shopify/Cart/abc123')
    expect(callBody.variables.lines).toHaveLength(1)
  })

  it('should update lines in cart', async () => {
    mockFetch = createMockFetch(createGraphQLResponse({ cartLinesUpdate: { cart: mockCart, userErrors: [] } }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.cart.updateLines('gid://shopify/Cart/abc123', [
      { id: 'gid://shopify/CartLine/xyz', quantity: 3 },
    ])
    expect(result.cart).toEqual(mockCart)
  })

  it('should remove lines from cart', async () => {
    mockFetch = createMockFetch(createGraphQLResponse({ cartLinesRemove: { cart: mockCart, userErrors: [] } }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.cart.removeLines('gid://shopify/Cart/abc123', ['gid://shopify/CartLine/xyz'])
    expect(result.cart).toEqual(mockCart)
  })

  it('should update discount codes', async () => {
    mockFetch = createMockFetch(createGraphQLResponse({ cartDiscountCodesUpdate: { cart: mockCart, userErrors: [] } }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.cart.updateDiscountCodes('gid://shopify/Cart/abc123', ['SUMMER20'])
    expect(result.cart).toEqual(mockCart)
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.variables.discountCodes).toContain('SUMMER20')
  })

  it('should update buyer identity', async () => {
    mockFetch = createMockFetch(createGraphQLResponse({ cartBuyerIdentityUpdate: { cart: mockCart, userErrors: [] } }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.cart.updateBuyerIdentity('gid://shopify/Cart/abc123', {
      email: 'test@example.com',
      countryCode: 'US',
    })
    expect(result.cart).toEqual(mockCart)
  })

  it('should update cart note', async () => {
    mockFetch = createMockFetch(createGraphQLResponse({ cartNoteUpdate: { cart: mockCart, userErrors: [] } }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.cart.updateNote('gid://shopify/Cart/abc123', 'Please gift wrap')
    expect(result.cart).toEqual(mockCart)
  })
})

// =============================================================================
// Checkout Resource Tests
// =============================================================================

describe('Checkout Resource', () => {
  let client: StorefrontClient
  let mockFetch: ReturnType<typeof vi.fn>

  const mockCheckout: Checkout = {
    id: 'gid://shopify/Checkout/def456',
    webUrl: 'https://test-store.myshopify.com/checkouts/def456',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ready: false,
    requiresShipping: true,
    taxesIncluded: false,
    taxExempt: false,
    currencyCode: 'USD',
    lineItems: { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
    lineItemsSubtotalPrice: { amount: '59.98', currencyCode: 'USD' },
    subtotalPrice: { amount: '59.98', currencyCode: 'USD' },
    totalPrice: { amount: '65.98', currencyCode: 'USD' },
    totalTax: { amount: '6.00', currencyCode: 'USD' },
    discountApplications: { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
    appliedGiftCards: [],
    customAttributes: [],
    buyerIdentity: {},
  }

  beforeEach(() => {
    mockFetch = createMockFetch(createGraphQLResponse({ checkoutCreate: { checkout: mockCheckout, checkoutUserErrors: [] } }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })
  })

  it('should create a new checkout', async () => {
    const result = await client.checkout.create({
      lineItems: [{ variantId: 'gid://shopify/ProductVariant/123', quantity: 2 }],
    })
    expect(result.checkout).toEqual(mockCheckout)
    expect(result.checkoutUserErrors).toHaveLength(0)
  })

  it('should get checkout by ID', async () => {
    mockFetch = createMockFetch(createGraphQLResponse({ node: mockCheckout }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const checkout = await client.checkout.get('gid://shopify/Checkout/def456')
    expect(checkout).toEqual(mockCheckout)
  })

  it('should add line items to checkout', async () => {
    mockFetch = createMockFetch(createGraphQLResponse({ checkoutLineItemsAdd: { checkout: mockCheckout, checkoutUserErrors: [] } }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.checkout.addLineItems('gid://shopify/Checkout/def456', [
      { variantId: 'gid://shopify/ProductVariant/789', quantity: 1 },
    ])
    expect(result.checkout).toEqual(mockCheckout)
  })

  it('should update shipping address', async () => {
    mockFetch = createMockFetch(createGraphQLResponse({ checkoutShippingAddressUpdateV2: { checkout: mockCheckout, checkoutUserErrors: [] } }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.checkout.updateShippingAddress('gid://shopify/Checkout/def456', {
      address1: '123 Main St',
      city: 'San Francisco',
      province: 'CA',
      country: 'US',
      zip: '94102',
    })
    expect(result.checkout).toEqual(mockCheckout)
  })

  it('should update shipping line', async () => {
    mockFetch = createMockFetch(createGraphQLResponse({ checkoutShippingLineUpdate: { checkout: mockCheckout, checkoutUserErrors: [] } }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.checkout.updateShippingLine('gid://shopify/Checkout/def456', 'standard-shipping')
    expect(result.checkout).toEqual(mockCheckout)
  })

  it('should apply discount code', async () => {
    mockFetch = createMockFetch(createGraphQLResponse({ checkoutDiscountCodeApplyV2: { checkout: mockCheckout, checkoutUserErrors: [] } }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.checkout.applyDiscountCode('gid://shopify/Checkout/def456', 'SUMMER20')
    expect(result.checkout).toEqual(mockCheckout)
  })

  it('should remove discount code', async () => {
    mockFetch = createMockFetch(createGraphQLResponse({ checkoutDiscountCodeRemove: { checkout: mockCheckout, checkoutUserErrors: [] } }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.checkout.removeDiscountCode('gid://shopify/Checkout/def456')
    expect(result.checkout).toEqual(mockCheckout)
  })

  it('should apply gift card', async () => {
    mockFetch = createMockFetch(createGraphQLResponse({ checkoutGiftCardsAppend: { checkout: mockCheckout, checkoutUserErrors: [] } }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.checkout.applyGiftCard('gid://shopify/Checkout/def456', 'GIFTCARD123')
    expect(result.checkout).toEqual(mockCheckout)
  })

  it('should associate customer with checkout', async () => {
    mockFetch = createMockFetch(createGraphQLResponse({ checkoutCustomerAssociateV2: { checkout: mockCheckout, checkoutUserErrors: [] } }))
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.checkout.associateCustomer('gid://shopify/Checkout/def456', 'customer-access-token')
    expect(result.checkout).toEqual(mockCheckout)
  })
})

// =============================================================================
// Customer Resource Tests
// =============================================================================

describe('Customer Resource', () => {
  let client: StorefrontClient
  let mockFetch: ReturnType<typeof vi.fn>

  const mockCustomer = {
    id: 'gid://shopify/Customer/123',
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe',
    displayName: 'John Doe',
    phone: '+1234567890',
    acceptsMarketing: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    tags: [],
    addresses: { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
    orders: { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false }, totalCount: 0 },
  }

  const mockAccessToken = {
    accessToken: 'customer-access-token',
    expiresAt: '2024-02-01T00:00:00Z',
  }

  beforeEach(() => {
    mockFetch = vi.fn()
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })
  })

  it('should create a new customer', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => createGraphQLResponse({ customerCreate: { customer: mockCustomer, customerUserErrors: [] } }),
    })

    const result = await client.customer.create({
      email: 'test@example.com',
      password: 'password123',
      firstName: 'John',
      lastName: 'Doe',
    })
    expect(result.customer).toEqual(mockCustomer)
    expect(result.customerUserErrors).toHaveLength(0)
  })

  it('should login customer', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => createGraphQLResponse({ customerAccessTokenCreate: { customerAccessToken: mockAccessToken, customerUserErrors: [] } }),
    })

    const result = await client.customer.login('test@example.com', 'password123')
    expect(result.customerAccessToken).toEqual(mockAccessToken)
    expect(result.customerUserErrors).toHaveLength(0)
  })

  it('should logout customer', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => createGraphQLResponse({ customerAccessTokenDelete: { deletedAccessToken: 'token', userErrors: [] } }),
    })

    const result = await client.customer.logout('customer-access-token')
    expect(result.deletedAccessToken).toBe('token')
  })

  it('should renew access token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => createGraphQLResponse({ customerAccessTokenRenew: { customerAccessToken: mockAccessToken, userErrors: [] } }),
    })

    const result = await client.customer.renewAccessToken('old-token')
    expect(result.customerAccessToken).toEqual(mockAccessToken)
  })

  it('should get customer by access token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => createGraphQLResponse({ customer: mockCustomer }),
    })

    const customer = await client.customer.get('customer-access-token')
    expect(customer).toEqual(mockCustomer)
  })

  it('should update customer', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => createGraphQLResponse({ customerUpdate: { customer: mockCustomer, customerAccessToken: mockAccessToken, customerUserErrors: [] } }),
    })

    const result = await client.customer.update('customer-access-token', { firstName: 'Jane' })
    expect(result.customer).toEqual(mockCustomer)
  })

  it('should request password recovery', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => createGraphQLResponse({ customerRecover: { customerUserErrors: [] } }),
    })

    const result = await client.customer.recover('test@example.com')
    expect(result.customerUserErrors).toHaveLength(0)
  })

  it('should reset password', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => createGraphQLResponse({ customerReset: { customer: mockCustomer, customerAccessToken: mockAccessToken, customerUserErrors: [] } }),
    })

    const result = await client.customer.reset('gid://shopify/Customer/123', {
      password: 'newpassword123',
      resetToken: 'reset-token',
    })
    expect(result.customer).toEqual(mockCustomer)
    expect(result.customerAccessToken).toEqual(mockAccessToken)
  })

  it('should create customer address', async () => {
    const mockAddress = {
      id: 'gid://shopify/MailingAddress/456',
      address1: '123 Main St',
      city: 'San Francisco',
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => createGraphQLResponse({ customerAddressCreate: { customerAddress: mockAddress, customerUserErrors: [] } }),
    })

    const result = await client.customer.createAddress('customer-access-token', {
      address1: '123 Main St',
      city: 'San Francisco',
      country: 'US',
    })
    expect(result.customerAddress).toEqual(mockAddress)
  })

  it('should update customer address', async () => {
    const mockAddress = { id: 'gid://shopify/MailingAddress/456', address1: '456 Oak Ave' }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => createGraphQLResponse({ customerAddressUpdate: { customerAddress: mockAddress, customerUserErrors: [] } }),
    })

    const result = await client.customer.updateAddress('customer-access-token', 'gid://shopify/MailingAddress/456', {
      address1: '456 Oak Ave',
    })
    expect(result.customerAddress).toEqual(mockAddress)
  })

  it('should delete customer address', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => createGraphQLResponse({ customerAddressDelete: { deletedCustomerAddressId: 'gid://shopify/MailingAddress/456', customerUserErrors: [] } }),
    })

    const result = await client.customer.deleteAddress('customer-access-token', 'gid://shopify/MailingAddress/456')
    expect(result.deletedCustomerAddressId).toBe('gid://shopify/MailingAddress/456')
  })

  it('should set default address', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => createGraphQLResponse({ customerDefaultAddressUpdate: { customer: mockCustomer, customerUserErrors: [] } }),
    })

    const result = await client.customer.setDefaultAddress('customer-access-token', 'gid://shopify/MailingAddress/456')
    expect(result.customer).toEqual(mockCustomer)
  })

  it('should get customer orders', async () => {
    const mockOrders = {
      edges: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
      totalCount: 0,
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => createGraphQLResponse({ customer: { orders: mockOrders } }),
    })

    const result = await client.customer.getOrders('customer-access-token', { first: 10 })
    expect(result).toEqual(mockOrders)
  })
})

// =============================================================================
// Shop Resource Tests
// =============================================================================

describe('Shop Resource', () => {
  let client: StorefrontClient
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })
  })

  it('should get shop info', async () => {
    const mockShop = {
      name: 'Test Store',
      description: 'A test store',
      primaryDomain: { host: 'test-store.myshopify.com', url: 'https://test-store.myshopify.com' },
      paymentSettings: {
        acceptedCardBrands: ['VISA', 'MASTERCARD'],
        cardVaultUrl: 'https://vault.shopify.com',
        countryCode: 'US',
        currencyCode: 'USD',
        enabledPresentmentCurrencies: ['USD', 'EUR'],
        supportedDigitalWallets: ['APPLE_PAY', 'GOOGLE_PAY'],
      },
      shipsToCountries: ['US', 'CA', 'GB'],
      moneyFormat: '${{amount}}',
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => createGraphQLResponse({ shop: mockShop }),
    })

    const shop = await client.shop.get()
    expect(shop?.name).toBe('Test Store')
    expect(shop?.paymentSettings.acceptedCardBrands).toContain('VISA')
  })

  it('should get shop policies', async () => {
    const mockPolicies = {
      privacyPolicy: { body: 'Privacy policy text', handle: 'privacy-policy', title: 'Privacy Policy', url: 'https://test-store.myshopify.com/policies/privacy-policy' },
      refundPolicy: { body: 'Refund policy text', handle: 'refund-policy', title: 'Refund Policy', url: 'https://test-store.myshopify.com/policies/refund-policy' },
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => createGraphQLResponse({ shop: mockPolicies }),
    })

    const policies = await client.shop.getPolicies()
    expect(policies.privacyPolicy?.title).toBe('Privacy Policy')
    expect(policies.refundPolicy?.title).toBe('Refund Policy')
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Error Handling', () => {
  it('should throw StorefrontAPIError on GraphQL errors', async () => {
    const mockFetch = createMockFetch({
      data: null,
      errors: [{ message: 'Product not found', locations: [{ line: 1, column: 1 }] }],
    })
    const client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    await expect(client.product.getByHandle('non-existent')).rejects.toThrow(StorefrontAPIError)
  })

  it('should include errors in StorefrontAPIError', async () => {
    const mockFetch = createMockFetch({
      data: null,
      errors: [
        { message: 'Field "foo" does not exist', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } },
        { message: 'Another error' },
      ],
    })
    const client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    try {
      await client.product.getByHandle('test')
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(StorefrontAPIError)
      const apiError = error as StorefrontAPIError
      expect(apiError.errors).toHaveLength(2)
      expect(apiError.message).toBe('Field "foo" does not exist')
    }
  })
})

// =============================================================================
// Raw Query Tests
// =============================================================================

describe('Raw Query', () => {
  it('should execute raw GraphQL queries', async () => {
    const mockFetch = createMockFetch({
      data: { shop: { name: 'Test Store' } },
    })
    const client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    const result = await client.query<{ shop: { name: string } }>(`
      query {
        shop {
          name
        }
      }
    `)
    expect(result.data?.shop.name).toBe('Test Store')
  })

  it('should pass variables to raw queries', async () => {
    const mockFetch = createMockFetch({
      data: { product: { title: 'Test Product' } },
    })
    const client = createStorefrontClient({
      ...testConfig,
      fetch: mockFetch as unknown as typeof fetch,
    })

    await client.query(`
      query getProduct($handle: String!) {
        product(handle: $handle) {
          title
        }
      }
    `, { handle: 'test-product' })

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.variables.handle).toBe('test-product')
  })
})
