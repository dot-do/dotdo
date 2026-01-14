/**
 * @dotdo/shopify - Products Resource
 *
 * Shopify Admin API compatible products operations including:
 * - Products CRUD
 * - Variants CRUD
 * - Images management
 * - Collections (Custom & Smart)
 * - Metafields support
 * - Inventory tracking integration
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
// Collection Types
// =============================================================================

/**
 * Shopify Collection (Custom or Smart)
 */
export interface Collection {
  id: number
  handle: string
  title: string
  body_html: string | null
  published_at: string | null
  sort_order: string
  template_suffix: string | null
  published_scope: 'web' | 'global'
  updated_at: string
  admin_graphql_api_id: string
  image?: CollectionImage | null
}

/**
 * Custom Collection (manual product assignment)
 */
export interface CustomCollection extends Collection {
  // Custom collections use Collects for product association
}

/**
 * Smart Collection (rule-based)
 */
export interface SmartCollection extends Collection {
  disjunctive: boolean
  rules: CollectionRule[]
}

/**
 * Collection image
 */
export interface CollectionImage {
  created_at: string
  alt: string | null
  width: number
  height: number
  src: string
}

/**
 * Smart collection rule
 */
export interface CollectionRule {
  column: CollectionRuleColumn
  relation: CollectionRuleRelation
  condition: string
}

export type CollectionRuleColumn =
  | 'title'
  | 'type'
  | 'vendor'
  | 'variant_title'
  | 'variant_compare_at_price'
  | 'variant_weight'
  | 'variant_inventory'
  | 'variant_price'
  | 'tag'
  | 'is_price_reduced'

export type CollectionRuleRelation =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'starts_with'
  | 'ends_with'
  | 'contains'
  | 'not_contains'

/**
 * Input for creating a custom collection
 */
export interface CustomCollectionInput {
  title: string
  body_html?: string
  handle?: string
  image?: CollectionImageInput
  published?: boolean
  published_at?: string
  published_scope?: 'web' | 'global'
  sort_order?: string
  template_suffix?: string | null
  metafields?: MetafieldInput[]
  collects?: CollectInput[]
}

/**
 * Input for updating a custom collection
 */
export interface CustomCollectionUpdateInput {
  title?: string
  body_html?: string
  handle?: string
  image?: CollectionImageInput | null
  published?: boolean
  published_at?: string
  published_scope?: 'web' | 'global'
  sort_order?: string
  template_suffix?: string | null
  metafields?: MetafieldInput[]
}

/**
 * Input for creating a smart collection
 */
export interface SmartCollectionInput {
  title: string
  body_html?: string
  handle?: string
  image?: CollectionImageInput
  published?: boolean
  published_at?: string
  published_scope?: 'web' | 'global'
  rules: CollectionRule[]
  disjunctive?: boolean
  sort_order?: string
  template_suffix?: string | null
  metafields?: MetafieldInput[]
}

/**
 * Input for updating a smart collection
 */
export interface SmartCollectionUpdateInput {
  title?: string
  body_html?: string
  handle?: string
  image?: CollectionImageInput | null
  published?: boolean
  published_at?: string
  published_scope?: 'web' | 'global'
  rules?: CollectionRule[]
  disjunctive?: boolean
  sort_order?: string
  template_suffix?: string | null
  metafields?: MetafieldInput[]
}

/**
 * Collection image input
 */
export interface CollectionImageInput {
  src?: string
  attachment?: string // Base64 encoded
  alt?: string
}

// =============================================================================
// Collect Types (Product-Collection Association)
// =============================================================================

/**
 * Collect - Associates a product with a custom collection
 */
export interface Collect {
  id: number
  collection_id: number
  product_id: number
  created_at: string
  updated_at: string
  position: number
  sort_value: string
}

/**
 * Input for creating a collect
 */
export interface CollectInput {
  product_id: number
  collection_id?: number
  position?: number
  sort_value?: string
}

// =============================================================================
// Metafield Types
// =============================================================================

/**
 * Shopify Metafield
 */
export interface Metafield {
  id: number
  namespace: string
  key: string
  value: string
  type: MetafieldType
  description?: string | null
  owner_id: number
  owner_resource: MetafieldOwnerResource
  created_at: string
  updated_at: string
  admin_graphql_api_id: string
}

export type MetafieldType =
  | 'single_line_text_field'
  | 'multi_line_text_field'
  | 'rich_text_field'
  | 'number_integer'
  | 'number_decimal'
  | 'boolean'
  | 'date'
  | 'date_time'
  | 'json'
  | 'color'
  | 'weight'
  | 'dimension'
  | 'volume'
  | 'url'
  | 'file_reference'
  | 'page_reference'
  | 'product_reference'
  | 'variant_reference'
  | 'collection_reference'
  | 'rating'
  | 'money'
  | 'list.single_line_text_field'
  | 'list.page_reference'
  | 'list.product_reference'
  | 'list.variant_reference'
  | 'list.collection_reference'
  | 'list.file_reference'
  | 'list.number_integer'
  | 'list.metaobject_reference'

export type MetafieldOwnerResource =
  | 'product'
  | 'variant'
  | 'customer'
  | 'order'
  | 'collection'
  | 'shop'
  | 'article'
  | 'blog'
  | 'page'

/**
 * Input for creating a metafield
 */
export interface MetafieldCreateInput {
  namespace: string
  key: string
  value: string
  type: string
  description?: string
}

/**
 * Input for updating a metafield
 */
export interface MetafieldUpdateInput {
  value: string
  type?: string
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

  /** Images sub-resource */
  images: ProductImagesResource

  /** Metafields sub-resource for products */
  metafields: ProductMetafieldsResource

  constructor(client: RestClient) {
    this.client = client
    this.variants = new VariantsResource(client)
    this.images = new ProductImagesResource(client)
    this.metafields = new ProductMetafieldsResource(client)
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
   * List product images (convenience method)
   */
  async listImages(productId: number, params?: {
    since_id?: number
    fields?: string
  }): Promise<RestResponse<{ images: ProductImage[] }>> {
    return this.images.list(productId, params)
  }

  /**
   * Get a product image (convenience method)
   */
  async getImage(productId: number, imageId: number, params?: { fields?: string }): Promise<RestResponse<{ image: ProductImage }>> {
    return this.images.get(productId, imageId, params)
  }

  /**
   * Create a product image (convenience method)
   */
  async createImage(productId: number, input: ImageInput): Promise<RestResponse<{ image: ProductImage }>> {
    return this.images.create(productId, input)
  }

  /**
   * Update a product image (convenience method)
   */
  async updateImage(productId: number, imageId: number, input: ImageInput): Promise<RestResponse<{ image: ProductImage }>> {
    return this.images.update(productId, imageId, input)
  }

  /**
   * Delete a product image (convenience method)
   */
  async deleteImage(productId: number, imageId: number): Promise<RestResponse<Record<string, never>>> {
    return this.images.delete(productId, imageId)
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

// =============================================================================
// Product Images Resource
// =============================================================================

/**
 * Product Images resource for Shopify Admin API
 */
export class ProductImagesResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all images for a product
   */
  async list(productId: number, params?: {
    since_id?: number
    fields?: string
  }): Promise<RestResponse<{ images: ProductImage[] }>> {
    return this.client.get({
      path: `products/${productId}/images`,
      query: params,
    })
  }

  /**
   * Get an image
   */
  async get(productId: number, imageId: number, params?: { fields?: string }): Promise<RestResponse<{ image: ProductImage }>> {
    return this.client.get({
      path: `products/${productId}/images/${imageId}`,
      query: params,
    })
  }

  /**
   * Create an image
   */
  async create(productId: number, input: ImageInput): Promise<RestResponse<{ image: ProductImage }>> {
    return this.client.post({
      path: `products/${productId}/images`,
      data: { image: input },
    })
  }

  /**
   * Update an image
   */
  async update(productId: number, imageId: number, input: ImageInput): Promise<RestResponse<{ image: ProductImage }>> {
    return this.client.put({
      path: `products/${productId}/images/${imageId}`,
      data: { image: input },
    })
  }

  /**
   * Delete an image
   */
  async delete(productId: number, imageId: number): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: `products/${productId}/images/${imageId}`,
    })
  }

  /**
   * Count images for a product
   */
  async count(productId: number, params?: {
    since_id?: number
  }): Promise<RestResponse<{ count: number }>> {
    return this.client.get({
      path: `products/${productId}/images/count`,
      query: params,
    })
  }
}

// =============================================================================
// Custom Collections Resource
// =============================================================================

/**
 * Custom Collections resource for Shopify Admin API
 */
export class CustomCollectionsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all custom collections
   */
  async list(params?: {
    limit?: number
    since_id?: number
    title?: string
    product_id?: number
    handle?: string
    updated_at_min?: string
    updated_at_max?: string
    published_at_min?: string
    published_at_max?: string
    published_status?: 'published' | 'unpublished' | 'any'
    ids?: string
    fields?: string
  }): Promise<RestResponse<{ custom_collections: CustomCollection[] }>> {
    return this.client.get({
      path: 'custom_collections',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get a custom collection
   */
  async get(collectionId: number, params?: { fields?: string }): Promise<RestResponse<{ custom_collection: CustomCollection }>> {
    return this.client.get({
      path: `custom_collections/${collectionId}`,
      query: params,
    })
  }

  /**
   * Create a custom collection
   */
  async create(input: CustomCollectionInput): Promise<RestResponse<{ custom_collection: CustomCollection }>> {
    return this.client.post({
      path: 'custom_collections',
      data: { custom_collection: input },
    })
  }

  /**
   * Update a custom collection
   */
  async update(collectionId: number, input: CustomCollectionUpdateInput): Promise<RestResponse<{ custom_collection: CustomCollection }>> {
    return this.client.put({
      path: `custom_collections/${collectionId}`,
      data: { custom_collection: input },
    })
  }

  /**
   * Delete a custom collection
   */
  async delete(collectionId: number): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: `custom_collections/${collectionId}`,
    })
  }

  /**
   * Count custom collections
   */
  async count(params?: {
    title?: string
    product_id?: number
    updated_at_min?: string
    updated_at_max?: string
    published_at_min?: string
    published_at_max?: string
    published_status?: 'published' | 'unpublished' | 'any'
  }): Promise<RestResponse<{ count: number }>> {
    return this.client.get({
      path: 'custom_collections/count',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get products in a custom collection
   */
  async products(collectionId: number, params?: {
    limit?: number
    fields?: string
  }): Promise<RestResponse<{ products: Product[] }>> {
    return this.client.get({
      path: `collections/${collectionId}/products`,
      query: params,
    })
  }
}

// =============================================================================
// Smart Collections Resource
// =============================================================================

/**
 * Smart Collections resource for Shopify Admin API
 */
export class SmartCollectionsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all smart collections
   */
  async list(params?: {
    limit?: number
    since_id?: number
    title?: string
    product_id?: number
    handle?: string
    updated_at_min?: string
    updated_at_max?: string
    published_at_min?: string
    published_at_max?: string
    published_status?: 'published' | 'unpublished' | 'any'
    ids?: string
    fields?: string
  }): Promise<RestResponse<{ smart_collections: SmartCollection[] }>> {
    return this.client.get({
      path: 'smart_collections',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get a smart collection
   */
  async get(collectionId: number, params?: { fields?: string }): Promise<RestResponse<{ smart_collection: SmartCollection }>> {
    return this.client.get({
      path: `smart_collections/${collectionId}`,
      query: params,
    })
  }

  /**
   * Create a smart collection
   */
  async create(input: SmartCollectionInput): Promise<RestResponse<{ smart_collection: SmartCollection }>> {
    return this.client.post({
      path: 'smart_collections',
      data: { smart_collection: input },
    })
  }

  /**
   * Update a smart collection
   */
  async update(collectionId: number, input: SmartCollectionUpdateInput): Promise<RestResponse<{ smart_collection: SmartCollection }>> {
    return this.client.put({
      path: `smart_collections/${collectionId}`,
      data: { smart_collection: input },
    })
  }

  /**
   * Delete a smart collection
   */
  async delete(collectionId: number): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: `smart_collections/${collectionId}`,
    })
  }

  /**
   * Count smart collections
   */
  async count(params?: {
    title?: string
    product_id?: number
    updated_at_min?: string
    updated_at_max?: string
    published_at_min?: string
    published_at_max?: string
    published_status?: 'published' | 'unpublished' | 'any'
  }): Promise<RestResponse<{ count: number }>> {
    return this.client.get({
      path: 'smart_collections/count',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get products in a smart collection
   */
  async products(collectionId: number, params?: {
    limit?: number
    fields?: string
  }): Promise<RestResponse<{ products: Product[] }>> {
    return this.client.get({
      path: `collections/${collectionId}/products`,
      query: params,
    })
  }

  /**
   * Reorder smart collection rules (triggers re-evaluation)
   */
  async reorder(collectionId: number, params: {
    sort_order: string
    products?: number[]
  }): Promise<RestResponse<Record<string, never>>> {
    return this.client.put({
      path: `smart_collections/${collectionId}/order`,
      data: params,
    })
  }
}

// =============================================================================
// Collects Resource
// =============================================================================

/**
 * Collects resource for Shopify Admin API
 * Associates products with custom collections
 */
export class CollectsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all collects
   */
  async list(params?: {
    limit?: number
    since_id?: number
    product_id?: number
    collection_id?: number
    fields?: string
  }): Promise<RestResponse<{ collects: Collect[] }>> {
    return this.client.get({
      path: 'collects',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get a collect
   */
  async get(collectId: number, params?: { fields?: string }): Promise<RestResponse<{ collect: Collect }>> {
    return this.client.get({
      path: `collects/${collectId}`,
      query: params,
    })
  }

  /**
   * Create a collect (add product to collection)
   */
  async create(input: CollectInput): Promise<RestResponse<{ collect: Collect }>> {
    return this.client.post({
      path: 'collects',
      data: { collect: input },
    })
  }

  /**
   * Delete a collect (remove product from collection)
   */
  async delete(collectId: number): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: `collects/${collectId}`,
    })
  }

  /**
   * Count collects
   */
  async count(params?: {
    product_id?: number
    collection_id?: number
  }): Promise<RestResponse<{ count: number }>> {
    return this.client.get({
      path: 'collects/count',
      query: params,
    })
  }
}

// =============================================================================
// Product Metafields Resource
// =============================================================================

/**
 * Product Metafields resource for Shopify Admin API
 */
export class ProductMetafieldsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all metafields for a product
   */
  async list(productId: number, params?: {
    limit?: number
    since_id?: number
    namespace?: string
    key?: string
    fields?: string
  }): Promise<RestResponse<{ metafields: Metafield[] }>> {
    return this.client.get({
      path: `products/${productId}/metafields`,
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get a metafield
   */
  async get(productId: number, metafieldId: number, params?: { fields?: string }): Promise<RestResponse<{ metafield: Metafield }>> {
    return this.client.get({
      path: `products/${productId}/metafields/${metafieldId}`,
      query: params,
    })
  }

  /**
   * Create a metafield
   */
  async create(productId: number, input: MetafieldCreateInput): Promise<RestResponse<{ metafield: Metafield }>> {
    return this.client.post({
      path: `products/${productId}/metafields`,
      data: { metafield: input },
    })
  }

  /**
   * Update a metafield
   */
  async update(productId: number, metafieldId: number, input: MetafieldUpdateInput): Promise<RestResponse<{ metafield: Metafield }>> {
    return this.client.put({
      path: `products/${productId}/metafields/${metafieldId}`,
      data: { metafield: input },
    })
  }

  /**
   * Delete a metafield
   */
  async delete(productId: number, metafieldId: number): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: `products/${productId}/metafields/${metafieldId}`,
    })
  }

  /**
   * Count metafields for a product
   */
  async count(productId: number): Promise<RestResponse<{ count: number }>> {
    return this.client.get({
      path: `products/${productId}/metafields/count`,
    })
  }
}

// =============================================================================
// Variant Metafields Resource
// =============================================================================

/**
 * Variant Metafields resource for Shopify Admin API
 */
export class VariantMetafieldsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all metafields for a variant
   */
  async list(variantId: number, params?: {
    limit?: number
    since_id?: number
    namespace?: string
    key?: string
    fields?: string
  }): Promise<RestResponse<{ metafields: Metafield[] }>> {
    return this.client.get({
      path: `variants/${variantId}/metafields`,
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get a metafield
   */
  async get(variantId: number, metafieldId: number, params?: { fields?: string }): Promise<RestResponse<{ metafield: Metafield }>> {
    return this.client.get({
      path: `variants/${variantId}/metafields/${metafieldId}`,
      query: params,
    })
  }

  /**
   * Create a metafield
   */
  async create(variantId: number, input: MetafieldCreateInput): Promise<RestResponse<{ metafield: Metafield }>> {
    return this.client.post({
      path: `variants/${variantId}/metafields`,
      data: { metafield: input },
    })
  }

  /**
   * Update a metafield
   */
  async update(variantId: number, metafieldId: number, input: MetafieldUpdateInput): Promise<RestResponse<{ metafield: Metafield }>> {
    return this.client.put({
      path: `variants/${variantId}/metafields/${metafieldId}`,
      data: { metafield: input },
    })
  }

  /**
   * Delete a metafield
   */
  async delete(variantId: number, metafieldId: number): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: `variants/${variantId}/metafields/${metafieldId}`,
    })
  }

  /**
   * Count metafields for a variant
   */
  async count(variantId: number): Promise<RestResponse<{ count: number }>> {
    return this.client.get({
      path: `variants/${variantId}/metafields/count`,
    })
  }
}

// =============================================================================
// Collection Metafields Resource
// =============================================================================

/**
 * Collection Metafields resource for Shopify Admin API
 */
export class CollectionMetafieldsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all metafields for a collection
   */
  async list(collectionId: number, params?: {
    limit?: number
    since_id?: number
    namespace?: string
    key?: string
    fields?: string
  }): Promise<RestResponse<{ metafields: Metafield[] }>> {
    return this.client.get({
      path: `collections/${collectionId}/metafields`,
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get a metafield
   */
  async get(collectionId: number, metafieldId: number, params?: { fields?: string }): Promise<RestResponse<{ metafield: Metafield }>> {
    return this.client.get({
      path: `collections/${collectionId}/metafields/${metafieldId}`,
      query: params,
    })
  }

  /**
   * Create a metafield
   */
  async create(collectionId: number, input: MetafieldCreateInput): Promise<RestResponse<{ metafield: Metafield }>> {
    return this.client.post({
      path: `collections/${collectionId}/metafields`,
      data: { metafield: input },
    })
  }

  /**
   * Update a metafield
   */
  async update(collectionId: number, metafieldId: number, input: MetafieldUpdateInput): Promise<RestResponse<{ metafield: Metafield }>> {
    return this.client.put({
      path: `collections/${collectionId}/metafields/${metafieldId}`,
      data: { metafield: input },
    })
  }

  /**
   * Delete a metafield
   */
  async delete(collectionId: number, metafieldId: number): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: `collections/${collectionId}/metafields/${metafieldId}`,
    })
  }

  /**
   * Count metafields for a collection
   */
  async count(collectionId: number): Promise<RestResponse<{ count: number }>> {
    return this.client.get({
      path: `collections/${collectionId}/metafields/count`,
    })
  }
}

// =============================================================================
// Collections Resource (Unified)
// =============================================================================

/**
 * Unified Collections resource for Shopify Admin API
 * Provides access to both Custom and Smart collections
 */
export class CollectionsResource {
  private client: RestClient

  /** Custom collections sub-resource */
  custom: CustomCollectionsResource
  /** Smart collections sub-resource */
  smart: SmartCollectionsResource
  /** Collects sub-resource (product-collection associations) */
  collects: CollectsResource
  /** Metafields sub-resource */
  metafields: CollectionMetafieldsResource

  constructor(client: RestClient) {
    this.client = client
    this.custom = new CustomCollectionsResource(client)
    this.smart = new SmartCollectionsResource(client)
    this.collects = new CollectsResource(client)
    this.metafields = new CollectionMetafieldsResource(client)
  }

  /**
   * Get products in any collection (custom or smart)
   */
  async products(collectionId: number, params?: {
    limit?: number
    fields?: string
  }): Promise<RestResponse<{ products: Product[] }>> {
    return this.client.get({
      path: `collections/${collectionId}/products`,
      query: params,
    })
  }

  /**
   * Add a product to a custom collection
   */
  async addProduct(collectionId: number, productId: number, params?: {
    position?: number
  }): Promise<RestResponse<{ collect: Collect }>> {
    return this.collects.create({
      collection_id: collectionId,
      product_id: productId,
      position: params?.position,
    })
  }

  /**
   * Remove a product from a collection
   */
  async removeProduct(collectId: number): Promise<RestResponse<Record<string, never>>> {
    return this.collects.delete(collectId)
  }

  /**
   * Find collect by product and collection
   */
  async findCollect(productId: number, collectionId: number): Promise<RestResponse<{ collects: Collect[] }>> {
    return this.collects.list({
      product_id: productId,
      collection_id: collectionId,
    })
  }
}

// =============================================================================
// Metafields Resource (Shop-level)
// =============================================================================

/**
 * Shop-level Metafields resource for Shopify Admin API
 */
export class MetafieldsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all shop metafields
   */
  async list(params?: {
    limit?: number
    since_id?: number
    namespace?: string
    key?: string
    metafield?: {
      owner_id?: number
      owner_resource?: MetafieldOwnerResource
    }
    fields?: string
  }): Promise<RestResponse<{ metafields: Metafield[] }>> {
    return this.client.get({
      path: 'metafields',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get a metafield
   */
  async get(metafieldId: number, params?: { fields?: string }): Promise<RestResponse<{ metafield: Metafield }>> {
    return this.client.get({
      path: `metafields/${metafieldId}`,
      query: params,
    })
  }

  /**
   * Create a shop metafield
   */
  async create(input: MetafieldCreateInput): Promise<RestResponse<{ metafield: Metafield }>> {
    return this.client.post({
      path: 'metafields',
      data: { metafield: input },
    })
  }

  /**
   * Update a metafield
   */
  async update(metafieldId: number, input: MetafieldUpdateInput): Promise<RestResponse<{ metafield: Metafield }>> {
    return this.client.put({
      path: `metafields/${metafieldId}`,
      data: { metafield: input },
    })
  }

  /**
   * Delete a metafield
   */
  async delete(metafieldId: number): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: `metafields/${metafieldId}`,
    })
  }

  /**
   * Count metafields
   */
  async count(): Promise<RestResponse<{ count: number }>> {
    return this.client.get({
      path: 'metafields/count',
    })
  }
}
