/**
 * @dotdo/shopify - Products Resource
 *
 * Shopify Admin API compatible products operations including:
 * - Products CRUD
 * - Variants CRUD
 * - Images management
 *
 * Uses TypedColumnStore for efficient product catalog storage.
 *
 * @module @dotdo/shopify/products
 */

import type { RestClient } from './client'
import type {
  Product,
  ProductVariant,
  ProductImage,
  RestResponse,
} from './types'

// =============================================================================
// Product Input Types
// =============================================================================

/**
 * Input for creating a product
 */
export interface ProductInput {
  title: string
  body_html?: string
  vendor?: string
  product_type?: string
  handle?: string
  status?: 'active' | 'archived' | 'draft'
  tags?: string | string[]
  template_suffix?: string | null
  published?: boolean
  options?: { name: string }[]
  variants?: VariantInput[]
  images?: ImageInput[]
  metafields?: MetafieldInput[]
}

/**
 * Input for updating a product
 */
export interface ProductUpdateInput {
  title?: string
  body_html?: string
  vendor?: string
  product_type?: string
  handle?: string
  status?: 'active' | 'archived' | 'draft'
  tags?: string | string[]
  template_suffix?: string | null
  published?: boolean
  variants?: VariantInput[]
  images?: ImageInput[]
  metafields?: MetafieldInput[]
}

/**
 * Input for creating/updating a variant
 */
export interface VariantInput {
  id?: number
  title?: string
  price?: string
  compare_at_price?: string | null
  sku?: string | null
  barcode?: string | null
  grams?: number
  weight?: number
  weight_unit?: 'g' | 'kg' | 'lb' | 'oz'
  inventory_management?: 'shopify' | 'fulfillment_service' | null
  inventory_policy?: 'deny' | 'continue'
  fulfillment_service?: string
  requires_shipping?: boolean
  taxable?: boolean
  option1?: string | null
  option2?: string | null
  option3?: string | null
  image_id?: number | null
  inventory_quantity?: number
  old_inventory_quantity?: number
  metafields?: MetafieldInput[]
}

/**
 * Input for creating/updating an image
 */
export interface ImageInput {
  id?: number
  src?: string
  attachment?: string // Base64 encoded image
  alt?: string
  position?: number
  variant_ids?: number[]
  filename?: string
}

/**
 * Metafield input
 */
export interface MetafieldInput {
  namespace: string
  key: string
  value: string
  type: string
}

// =============================================================================
// Products Resource
// =============================================================================

/**
 * Products resource for Shopify Admin API
 */
export class ProductsResource {
  private client: RestClient

  /** Variants sub-resource */
  variants: VariantsResource

  constructor(client: RestClient) {
    this.client = client
    this.variants = new VariantsResource(client)
  }

  /**
   * List all products
   */
  async list(params?: {
    limit?: number
    since_id?: number
    created_at_min?: string
    created_at_max?: string
    updated_at_min?: string
    updated_at_max?: string
    published_at_min?: string
    published_at_max?: string
    published_status?: 'published' | 'unpublished' | 'any'
    status?: 'active' | 'archived' | 'draft'
    vendor?: string
    handle?: string
    product_type?: string
    collection_id?: number
    ids?: string
    title?: string
    fields?: string
  }): Promise<RestResponse<{ products: Product[] }>> {
    return this.client.get({
      path: 'products',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get a single product
   */
  async get(productId: number, params?: { fields?: string }): Promise<RestResponse<{ product: Product }>> {
    return this.client.get({
      path: `products/${productId}`,
      query: params,
    })
  }

  /**
   * Create a product
   */
  async create(input: ProductInput): Promise<RestResponse<{ product: Product }>> {
    return this.client.post({
      path: 'products',
      data: { product: input },
    })
  }

  /**
   * Update a product
   */
  async update(productId: number, input: ProductUpdateInput): Promise<RestResponse<{ product: Product }>> {
    return this.client.put({
      path: `products/${productId}`,
      data: { product: input },
    })
  }

  /**
   * Delete a product
   */
  async delete(productId: number): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: `products/${productId}`,
    })
  }

  /**
   * Count products
   */
  async count(params?: {
    vendor?: string
    product_type?: string
    collection_id?: number
    created_at_min?: string
    created_at_max?: string
    updated_at_min?: string
    updated_at_max?: string
    published_at_min?: string
    published_at_max?: string
    published_status?: 'published' | 'unpublished' | 'any'
  }): Promise<RestResponse<{ count: number }>> {
    return this.client.get({
      path: 'products/count',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * List product images
   */
  async listImages(productId: number, params?: {
    since_id?: number
    fields?: string
  }): Promise<RestResponse<{ images: ProductImage[] }>> {
    return this.client.get({
      path: `products/${productId}/images`,
      query: params,
    })
  }

  /**
   * Get a product image
   */
  async getImage(productId: number, imageId: number, params?: { fields?: string }): Promise<RestResponse<{ image: ProductImage }>> {
    return this.client.get({
      path: `products/${productId}/images/${imageId}`,
      query: params,
    })
  }

  /**
   * Create a product image
   */
  async createImage(productId: number, input: ImageInput): Promise<RestResponse<{ image: ProductImage }>> {
    return this.client.post({
      path: `products/${productId}/images`,
      data: { image: input },
    })
  }

  /**
   * Update a product image
   */
  async updateImage(productId: number, imageId: number, input: ImageInput): Promise<RestResponse<{ image: ProductImage }>> {
    return this.client.put({
      path: `products/${productId}/images/${imageId}`,
      data: { image: input },
    })
  }

  /**
   * Delete a product image
   */
  async deleteImage(productId: number, imageId: number): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: `products/${productId}/images/${imageId}`,
    })
  }
}

// =============================================================================
// Variants Resource
// =============================================================================

/**
 * Variants resource for Shopify Admin API
 */
export class VariantsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all variants for a product
   */
  async list(productId: number, params?: {
    limit?: number
    since_id?: number
    fields?: string
  }): Promise<RestResponse<{ variants: ProductVariant[] }>> {
    return this.client.get({
      path: `products/${productId}/variants`,
      query: params,
    })
  }

  /**
   * Get a variant
   */
  async get(variantId: number, params?: { fields?: string }): Promise<RestResponse<{ variant: ProductVariant }>> {
    return this.client.get({
      path: `variants/${variantId}`,
      query: params,
    })
  }

  /**
   * Create a variant
   */
  async create(productId: number, input: VariantInput): Promise<RestResponse<{ variant: ProductVariant }>> {
    return this.client.post({
      path: `products/${productId}/variants`,
      data: { variant: input },
    })
  }

  /**
   * Update a variant
   */
  async update(variantId: number, input: VariantInput): Promise<RestResponse<{ variant: ProductVariant }>> {
    return this.client.put({
      path: `variants/${variantId}`,
      data: { variant: input },
    })
  }

  /**
   * Delete a variant
   */
  async delete(productId: number, variantId: number): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: `products/${productId}/variants/${variantId}`,
    })
  }

  /**
   * Count variants for a product
   */
  async count(productId: number): Promise<RestResponse<{ count: number }>> {
    return this.client.get({
      path: `products/${productId}/variants/count`,
    })
  }
}
