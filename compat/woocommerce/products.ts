/**
 * @dotdo/woocommerce - Products Resource
 *
 * WooCommerce REST API compatible products operations including:
 * - Products CRUD (simple, variable, grouped, external)
 * - Product Variations CRUD
 * - Product Categories CRUD
 * - Product Tags CRUD
 * - Product Attributes CRUD
 * - Attribute Terms CRUD
 * - Images management
 * - Batch operations
 *
 * @module @dotdo/woocommerce/products
 */

import type { RestClient } from './client'
import type {
  Product,
  ProductInput,
  ProductListParams,
  ProductVariation,
  ProductVariationInput,
  VariationListParams,
  ProductCategory,
  ProductCategoryInput,
  CategoryListParams,
  ProductTag,
  ProductTagInput,
  TagListParams,
  GlobalProductAttribute,
  GlobalProductAttributeInput,
  AttributeListParams,
  AttributeTerm,
  AttributeTermInput,
  AttributeTermListParams,
  RestResponse,
  BatchInput,
  BatchResponse,
} from './types'

// =============================================================================
// Products Resource
// =============================================================================

/**
 * Products resource for WooCommerce REST API
 */
export class ProductsResource {
  private client: RestClient

  /** Variations sub-resource */
  variations: VariationsResource
  /** Categories sub-resource */
  categories: CategoriesResource
  /** Tags sub-resource */
  tags: TagsResource
  /** Attributes sub-resource */
  attributes: AttributesResource

  constructor(client: RestClient) {
    this.client = client
    this.variations = new VariationsResource(client)
    this.categories = new CategoriesResource(client)
    this.tags = new TagsResource(client)
    this.attributes = new AttributesResource(client)
  }

  /**
   * List all products
   */
  async list(params?: ProductListParams): Promise<RestResponse<Product[]>> {
    return this.client.get({
      path: 'products',
      query: this.formatParams(params),
    })
  }

  /**
   * Get a single product
   */
  async get(productId: number): Promise<RestResponse<Product>> {
    return this.client.get({
      path: `products/${productId}`,
    })
  }

  /**
   * Create a product
   */
  async create(input: ProductInput): Promise<RestResponse<Product>> {
    return this.client.post({
      path: 'products',
      data: input,
    })
  }

  /**
   * Update a product
   */
  async update(productId: number, input: ProductInput): Promise<RestResponse<Product>> {
    return this.client.put({
      path: `products/${productId}`,
      data: input,
    })
  }

  /**
   * Delete a product
   */
  async delete(
    productId: number,
    options?: { force?: boolean }
  ): Promise<RestResponse<Product>> {
    return this.client.delete({
      path: `products/${productId}`,
      query: options,
    })
  }

  /**
   * Batch create/update/delete products
   */
  async batch(input: BatchInput<ProductInput>): Promise<RestResponse<BatchResponse<Product>>> {
    return this.client.post({
      path: 'products/batch',
      data: input,
    })
  }

  /**
   * Format query parameters (convert arrays to comma-separated strings where needed)
   */
  private formatParams(
    params?: ProductListParams
  ): Record<string, string | number | boolean | undefined> | undefined {
    if (!params) return undefined

    const formatted: Record<string, string | number | boolean | undefined> = {}
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          formatted[key] = value.join(',')
        } else {
          formatted[key] = value as string | number | boolean
        }
      }
    }
    return formatted
  }
}

// =============================================================================
// Variations Resource
// =============================================================================

/**
 * Product variations resource for WooCommerce REST API
 */
export class VariationsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all variations for a product
   */
  async list(
    productId: number,
    params?: VariationListParams
  ): Promise<RestResponse<ProductVariation[]>> {
    return this.client.get({
      path: `products/${productId}/variations`,
      query: this.formatParams(params),
    })
  }

  /**
   * Get a variation
   */
  async get(productId: number, variationId: number): Promise<RestResponse<ProductVariation>> {
    return this.client.get({
      path: `products/${productId}/variations/${variationId}`,
    })
  }

  /**
   * Create a variation
   */
  async create(
    productId: number,
    input: ProductVariationInput
  ): Promise<RestResponse<ProductVariation>> {
    return this.client.post({
      path: `products/${productId}/variations`,
      data: input,
    })
  }

  /**
   * Update a variation
   */
  async update(
    productId: number,
    variationId: number,
    input: ProductVariationInput
  ): Promise<RestResponse<ProductVariation>> {
    return this.client.put({
      path: `products/${productId}/variations/${variationId}`,
      data: input,
    })
  }

  /**
   * Delete a variation
   */
  async delete(
    productId: number,
    variationId: number,
    options?: { force?: boolean }
  ): Promise<RestResponse<ProductVariation>> {
    return this.client.delete({
      path: `products/${productId}/variations/${variationId}`,
      query: options,
    })
  }

  /**
   * Batch create/update/delete variations
   */
  async batch(
    productId: number,
    input: BatchInput<ProductVariationInput>
  ): Promise<RestResponse<BatchResponse<ProductVariation>>> {
    return this.client.post({
      path: `products/${productId}/variations/batch`,
      data: input,
    })
  }

  /**
   * Format query parameters
   */
  private formatParams(
    params?: VariationListParams
  ): Record<string, string | number | boolean | undefined> | undefined {
    if (!params) return undefined

    const formatted: Record<string, string | number | boolean | undefined> = {}
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          formatted[key] = value.join(',')
        } else {
          formatted[key] = value as string | number | boolean
        }
      }
    }
    return formatted
  }
}

// =============================================================================
// Categories Resource
// =============================================================================

/**
 * Product categories resource for WooCommerce REST API
 */
export class CategoriesResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all categories
   */
  async list(params?: CategoryListParams): Promise<RestResponse<ProductCategory[]>> {
    return this.client.get({
      path: 'products/categories',
      query: this.formatParams(params),
    })
  }

  /**
   * Get a category
   */
  async get(categoryId: number): Promise<RestResponse<ProductCategory>> {
    return this.client.get({
      path: `products/categories/${categoryId}`,
    })
  }

  /**
   * Create a category
   */
  async create(input: ProductCategoryInput): Promise<RestResponse<ProductCategory>> {
    return this.client.post({
      path: 'products/categories',
      data: input,
    })
  }

  /**
   * Update a category
   */
  async update(
    categoryId: number,
    input: ProductCategoryInput
  ): Promise<RestResponse<ProductCategory>> {
    return this.client.put({
      path: `products/categories/${categoryId}`,
      data: input,
    })
  }

  /**
   * Delete a category
   */
  async delete(
    categoryId: number,
    options?: { force?: boolean }
  ): Promise<RestResponse<ProductCategory>> {
    return this.client.delete({
      path: `products/categories/${categoryId}`,
      query: options,
    })
  }

  /**
   * Batch create/update/delete categories
   */
  async batch(
    input: BatchInput<ProductCategoryInput>
  ): Promise<RestResponse<BatchResponse<ProductCategory>>> {
    return this.client.post({
      path: 'products/categories/batch',
      data: input,
    })
  }

  /**
   * Format query parameters
   */
  private formatParams(
    params?: CategoryListParams
  ): Record<string, string | number | boolean | undefined> | undefined {
    if (!params) return undefined

    const formatted: Record<string, string | number | boolean | undefined> = {}
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          formatted[key] = value.join(',')
        } else {
          formatted[key] = value as string | number | boolean
        }
      }
    }
    return formatted
  }
}

// =============================================================================
// Tags Resource
// =============================================================================

/**
 * Product tags resource for WooCommerce REST API
 */
export class TagsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all tags
   */
  async list(params?: TagListParams): Promise<RestResponse<ProductTag[]>> {
    return this.client.get({
      path: 'products/tags',
      query: this.formatParams(params),
    })
  }

  /**
   * Get a tag
   */
  async get(tagId: number): Promise<RestResponse<ProductTag>> {
    return this.client.get({
      path: `products/tags/${tagId}`,
    })
  }

  /**
   * Create a tag
   */
  async create(input: ProductTagInput): Promise<RestResponse<ProductTag>> {
    return this.client.post({
      path: 'products/tags',
      data: input,
    })
  }

  /**
   * Update a tag
   */
  async update(tagId: number, input: ProductTagInput): Promise<RestResponse<ProductTag>> {
    return this.client.put({
      path: `products/tags/${tagId}`,
      data: input,
    })
  }

  /**
   * Delete a tag
   */
  async delete(tagId: number, options?: { force?: boolean }): Promise<RestResponse<ProductTag>> {
    return this.client.delete({
      path: `products/tags/${tagId}`,
      query: options,
    })
  }

  /**
   * Batch create/update/delete tags
   */
  async batch(input: BatchInput<ProductTagInput>): Promise<RestResponse<BatchResponse<ProductTag>>> {
    return this.client.post({
      path: 'products/tags/batch',
      data: input,
    })
  }

  /**
   * Format query parameters
   */
  private formatParams(
    params?: TagListParams
  ): Record<string, string | number | boolean | undefined> | undefined {
    if (!params) return undefined

    const formatted: Record<string, string | number | boolean | undefined> = {}
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          formatted[key] = value.join(',')
        } else {
          formatted[key] = value as string | number | boolean
        }
      }
    }
    return formatted
  }
}

// =============================================================================
// Attributes Resource
// =============================================================================

/**
 * Product attributes resource for WooCommerce REST API
 */
export class AttributesResource {
  private client: RestClient

  /** Attribute terms sub-resource */
  terms: AttributeTermsResource

  constructor(client: RestClient) {
    this.client = client
    this.terms = new AttributeTermsResource(client)
  }

  /**
   * List all attributes
   */
  async list(params?: AttributeListParams): Promise<RestResponse<GlobalProductAttribute[]>> {
    return this.client.get({
      path: 'products/attributes',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get an attribute
   */
  async get(attributeId: number): Promise<RestResponse<GlobalProductAttribute>> {
    return this.client.get({
      path: `products/attributes/${attributeId}`,
    })
  }

  /**
   * Create an attribute
   */
  async create(input: GlobalProductAttributeInput): Promise<RestResponse<GlobalProductAttribute>> {
    return this.client.post({
      path: 'products/attributes',
      data: input,
    })
  }

  /**
   * Update an attribute
   */
  async update(
    attributeId: number,
    input: GlobalProductAttributeInput
  ): Promise<RestResponse<GlobalProductAttribute>> {
    return this.client.put({
      path: `products/attributes/${attributeId}`,
      data: input,
    })
  }

  /**
   * Delete an attribute
   */
  async delete(
    attributeId: number,
    options?: { force?: boolean }
  ): Promise<RestResponse<GlobalProductAttribute>> {
    return this.client.delete({
      path: `products/attributes/${attributeId}`,
      query: options,
    })
  }

  /**
   * Batch create/update/delete attributes
   */
  async batch(
    input: BatchInput<GlobalProductAttributeInput>
  ): Promise<RestResponse<BatchResponse<GlobalProductAttribute>>> {
    return this.client.post({
      path: 'products/attributes/batch',
      data: input,
    })
  }
}

// =============================================================================
// Attribute Terms Resource
// =============================================================================

/**
 * Attribute terms resource for WooCommerce REST API
 */
export class AttributeTermsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all terms for an attribute
   */
  async list(
    attributeId: number,
    params?: AttributeTermListParams
  ): Promise<RestResponse<AttributeTerm[]>> {
    return this.client.get({
      path: `products/attributes/${attributeId}/terms`,
      query: this.formatParams(params),
    })
  }

  /**
   * Get a term
   */
  async get(attributeId: number, termId: number): Promise<RestResponse<AttributeTerm>> {
    return this.client.get({
      path: `products/attributes/${attributeId}/terms/${termId}`,
    })
  }

  /**
   * Create a term
   */
  async create(attributeId: number, input: AttributeTermInput): Promise<RestResponse<AttributeTerm>> {
    return this.client.post({
      path: `products/attributes/${attributeId}/terms`,
      data: input,
    })
  }

  /**
   * Update a term
   */
  async update(
    attributeId: number,
    termId: number,
    input: AttributeTermInput
  ): Promise<RestResponse<AttributeTerm>> {
    return this.client.put({
      path: `products/attributes/${attributeId}/terms/${termId}`,
      data: input,
    })
  }

  /**
   * Delete a term
   */
  async delete(
    attributeId: number,
    termId: number,
    options?: { force?: boolean }
  ): Promise<RestResponse<AttributeTerm>> {
    return this.client.delete({
      path: `products/attributes/${attributeId}/terms/${termId}`,
      query: options,
    })
  }

  /**
   * Batch create/update/delete terms
   */
  async batch(
    attributeId: number,
    input: BatchInput<AttributeTermInput>
  ): Promise<RestResponse<BatchResponse<AttributeTerm>>> {
    return this.client.post({
      path: `products/attributes/${attributeId}/terms/batch`,
      data: input,
    })
  }

  /**
   * Format query parameters
   */
  private formatParams(
    params?: AttributeTermListParams
  ): Record<string, string | number | boolean | undefined> | undefined {
    if (!params) return undefined

    const formatted: Record<string, string | number | boolean | undefined> = {}
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          formatted[key] = value.join(',')
        } else {
          formatted[key] = value as string | number | boolean
        }
      }
    }
    return formatted
  }
}
