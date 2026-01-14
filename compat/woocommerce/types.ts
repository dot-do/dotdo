/**
 * @dotdo/woocommerce - WooCommerce API Type Definitions
 *
 * Type definitions for WooCommerce REST API compatibility layer.
 * Based on WooCommerce REST API v3
 *
 * @module @dotdo/woocommerce/types
 */

// =============================================================================
// API Configuration
// =============================================================================

/**
 * WooCommerce API configuration options
 */
export interface WooCommerceConfig {
  /** WooCommerce store URL */
  url: string
  /** Consumer key for authentication */
  consumerKey: string
  /** Consumer secret for authentication */
  consumerSecret: string
  /** API version (default: 'wc/v3') */
  version?: 'wc/v3' | 'wc/v2' | 'wc/v1'
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Maximum number of retries for failed requests */
  retries?: number
  /** Request timeout in milliseconds */
  timeout?: number
  /** Enable debug logging */
  debug?: boolean
  /** Use Basic Auth instead of OAuth (for HTTPS) */
  useBasicAuth?: boolean
}

/**
 * Internal resolved configuration
 */
export interface ResolvedConfig extends Required<Omit<WooCommerceConfig, 'fetch'>> {
  fetch: typeof fetch
}

// =============================================================================
// Product Types
// =============================================================================

/**
 * Product type enum
 */
export type ProductType = 'simple' | 'grouped' | 'external' | 'variable'

/**
 * Product status
 */
export type ProductStatus = 'draft' | 'pending' | 'private' | 'publish'

/**
 * Stock status
 */
export type StockStatus = 'instock' | 'outofstock' | 'onbackorder'

/**
 * Catalog visibility
 */
export type CatalogVisibility = 'visible' | 'catalog' | 'search' | 'hidden'

/**
 * Tax status
 */
export type TaxStatus = 'taxable' | 'shipping' | 'none'

/**
 * Backorder status
 */
export type BackorderStatus = 'no' | 'notify' | 'yes'

/**
 * WooCommerce Product
 */
export interface Product {
  id: number
  name: string
  slug: string
  permalink: string
  date_created: string
  date_created_gmt: string
  date_modified: string
  date_modified_gmt: string
  type: ProductType
  status: ProductStatus
  featured: boolean
  catalog_visibility: CatalogVisibility
  description: string
  short_description: string
  sku: string
  price: string
  regular_price: string
  sale_price: string
  date_on_sale_from: string | null
  date_on_sale_from_gmt: string | null
  date_on_sale_to: string | null
  date_on_sale_to_gmt: string | null
  price_html: string
  on_sale: boolean
  purchasable: boolean
  total_sales: number
  virtual: boolean
  downloadable: boolean
  downloads: ProductDownload[]
  download_limit: number
  download_expiry: number
  external_url: string
  button_text: string
  tax_status: TaxStatus
  tax_class: string
  manage_stock: boolean
  stock_quantity: number | null
  stock_status: StockStatus
  backorders: BackorderStatus
  backorders_allowed: boolean
  backordered: boolean
  sold_individually: boolean
  weight: string
  dimensions: ProductDimensions
  shipping_required: boolean
  shipping_taxable: boolean
  shipping_class: string
  shipping_class_id: number
  reviews_allowed: boolean
  average_rating: string
  rating_count: number
  related_ids: number[]
  upsell_ids: number[]
  cross_sell_ids: number[]
  parent_id: number
  purchase_note: string
  categories: ProductCategoryRef[]
  tags: ProductTagRef[]
  images: ProductImage[]
  attributes: ProductAttribute[]
  default_attributes: DefaultAttribute[]
  variations: number[]
  grouped_products: number[]
  menu_order: number
  meta_data: MetaData[]
}

/**
 * Product download file
 */
export interface ProductDownload {
  id: string
  name: string
  file: string
}

/**
 * Product dimensions
 */
export interface ProductDimensions {
  length: string
  width: string
  height: string
}

/**
 * Product category reference
 */
export interface ProductCategoryRef {
  id: number
  name: string
  slug: string
}

/**
 * Product tag reference
 */
export interface ProductTagRef {
  id: number
  name: string
  slug: string
}

/**
 * Product image
 */
export interface ProductImage {
  id: number
  date_created: string
  date_created_gmt: string
  date_modified: string
  date_modified_gmt: string
  src: string
  name: string
  alt: string
}

/**
 * Product attribute (for variable products)
 */
export interface ProductAttribute {
  id: number
  name: string
  position: number
  visible: boolean
  variation: boolean
  options: string[]
}

/**
 * Default attribute for variable products
 */
export interface DefaultAttribute {
  id: number
  name: string
  option: string
}

/**
 * Meta data
 */
export interface MetaData {
  id: number
  key: string
  value: string | number | boolean | object
}

// =============================================================================
// Product Variation Types
// =============================================================================

/**
 * Product variation
 */
export interface ProductVariation {
  id: number
  date_created: string
  date_created_gmt: string
  date_modified: string
  date_modified_gmt: string
  description: string
  permalink: string
  sku: string
  price: string
  regular_price: string
  sale_price: string
  date_on_sale_from: string | null
  date_on_sale_from_gmt: string | null
  date_on_sale_to: string | null
  date_on_sale_to_gmt: string | null
  on_sale: boolean
  status: ProductStatus
  purchasable: boolean
  virtual: boolean
  downloadable: boolean
  downloads: ProductDownload[]
  download_limit: number
  download_expiry: number
  tax_status: TaxStatus
  tax_class: string
  manage_stock: boolean | 'parent'
  stock_quantity: number | null
  stock_status: StockStatus
  backorders: BackorderStatus
  backorders_allowed: boolean
  backordered: boolean
  weight: string
  dimensions: ProductDimensions
  shipping_class: string
  shipping_class_id: number
  image: ProductImage | null
  attributes: VariationAttribute[]
  menu_order: number
  meta_data: MetaData[]
}

/**
 * Variation attribute
 */
export interface VariationAttribute {
  id: number
  name: string
  option: string
}

// =============================================================================
// Product Category Types
// =============================================================================

/**
 * Product category
 */
export interface ProductCategory {
  id: number
  name: string
  slug: string
  parent: number
  description: string
  display: 'default' | 'products' | 'subcategories' | 'both'
  image: CategoryImage | null
  menu_order: number
  count: number
}

/**
 * Category image
 */
export interface CategoryImage {
  id: number
  date_created: string
  date_created_gmt: string
  date_modified: string
  date_modified_gmt: string
  src: string
  name: string
  alt: string
}

// =============================================================================
// Product Tag Types
// =============================================================================

/**
 * Product tag
 */
export interface ProductTag {
  id: number
  name: string
  slug: string
  description: string
  count: number
}

// =============================================================================
// Product Attribute Types (Global)
// =============================================================================

/**
 * Global product attribute
 */
export interface GlobalProductAttribute {
  id: number
  name: string
  slug: string
  type: 'select' | 'text'
  order_by: 'menu_order' | 'name' | 'name_num' | 'id'
  has_archives: boolean
}

/**
 * Attribute term
 */
export interface AttributeTerm {
  id: number
  name: string
  slug: string
  description: string
  menu_order: number
  count: number
}

// =============================================================================
// Input Types
// =============================================================================

/**
 * Product create/update input
 */
export interface ProductInput {
  name?: string
  slug?: string
  type?: ProductType
  status?: ProductStatus
  featured?: boolean
  catalog_visibility?: CatalogVisibility
  description?: string
  short_description?: string
  sku?: string
  regular_price?: string
  sale_price?: string
  date_on_sale_from?: string | null
  date_on_sale_from_gmt?: string | null
  date_on_sale_to?: string | null
  date_on_sale_to_gmt?: string | null
  virtual?: boolean
  downloadable?: boolean
  downloads?: Omit<ProductDownload, 'id'>[]
  download_limit?: number
  download_expiry?: number
  external_url?: string
  button_text?: string
  tax_status?: TaxStatus
  tax_class?: string
  manage_stock?: boolean
  stock_quantity?: number | null
  stock_status?: StockStatus
  backorders?: BackorderStatus
  sold_individually?: boolean
  weight?: string
  dimensions?: Partial<ProductDimensions>
  shipping_class?: string
  reviews_allowed?: boolean
  upsell_ids?: number[]
  cross_sell_ids?: number[]
  parent_id?: number
  purchase_note?: string
  categories?: { id: number }[]
  tags?: { id: number }[]
  images?: ProductImageInput[]
  attributes?: ProductAttributeInput[]
  default_attributes?: DefaultAttributeInput[]
  grouped_products?: number[]
  menu_order?: number
  meta_data?: MetaDataInput[]
}

/**
 * Product image input
 */
export interface ProductImageInput {
  id?: number
  src?: string
  name?: string
  alt?: string
}

/**
 * Product attribute input
 */
export interface ProductAttributeInput {
  id?: number
  name?: string
  position?: number
  visible?: boolean
  variation?: boolean
  options?: string[]
}

/**
 * Default attribute input
 */
export interface DefaultAttributeInput {
  id?: number
  name?: string
  option?: string
}

/**
 * Meta data input
 */
export interface MetaDataInput {
  id?: number
  key: string
  value: string | number | boolean | object
}

/**
 * Product variation input
 */
export interface ProductVariationInput {
  description?: string
  sku?: string
  regular_price?: string
  sale_price?: string
  date_on_sale_from?: string | null
  date_on_sale_from_gmt?: string | null
  date_on_sale_to?: string | null
  date_on_sale_to_gmt?: string | null
  status?: ProductStatus
  virtual?: boolean
  downloadable?: boolean
  downloads?: Omit<ProductDownload, 'id'>[]
  download_limit?: number
  download_expiry?: number
  tax_status?: TaxStatus
  tax_class?: string
  manage_stock?: boolean | 'parent'
  stock_quantity?: number | null
  stock_status?: StockStatus
  backorders?: BackorderStatus
  weight?: string
  dimensions?: Partial<ProductDimensions>
  shipping_class?: string
  image?: ProductImageInput | null
  attributes?: VariationAttributeInput[]
  menu_order?: number
  meta_data?: MetaDataInput[]
}

/**
 * Variation attribute input
 */
export interface VariationAttributeInput {
  id?: number
  name?: string
  option?: string
}

/**
 * Product category input
 */
export interface ProductCategoryInput {
  name?: string
  slug?: string
  parent?: number
  description?: string
  display?: 'default' | 'products' | 'subcategories' | 'both'
  image?: ProductImageInput | null
  menu_order?: number
}

/**
 * Product tag input
 */
export interface ProductTagInput {
  name?: string
  slug?: string
  description?: string
}

/**
 * Global product attribute input
 */
export interface GlobalProductAttributeInput {
  name?: string
  slug?: string
  type?: 'select' | 'text'
  order_by?: 'menu_order' | 'name' | 'name_num' | 'id'
  has_archives?: boolean
}

/**
 * Attribute term input
 */
export interface AttributeTermInput {
  name?: string
  slug?: string
  description?: string
  menu_order?: number
}

// =============================================================================
// Query Parameters
// =============================================================================

/**
 * Product list query parameters
 */
export interface ProductListParams {
  context?: 'view' | 'edit'
  page?: number
  per_page?: number
  search?: string
  after?: string
  before?: string
  exclude?: number[]
  include?: number[]
  offset?: number
  order?: 'asc' | 'desc'
  orderby?: 'date' | 'id' | 'include' | 'title' | 'slug' | 'price' | 'popularity' | 'rating'
  parent?: number[]
  parent_exclude?: number[]
  slug?: string
  status?: ProductStatus
  type?: ProductType
  sku?: string
  featured?: boolean
  category?: string
  tag?: string
  shipping_class?: string
  attribute?: string
  attribute_term?: string
  tax_class?: string
  on_sale?: boolean
  min_price?: string
  max_price?: string
  stock_status?: StockStatus
}

/**
 * Product variation list query parameters
 */
export interface VariationListParams {
  context?: 'view' | 'edit'
  page?: number
  per_page?: number
  search?: string
  after?: string
  before?: string
  exclude?: number[]
  include?: number[]
  offset?: number
  order?: 'asc' | 'desc'
  orderby?: 'date' | 'id' | 'include' | 'title' | 'slug'
  parent?: number[]
  parent_exclude?: number[]
  slug?: string
  status?: ProductStatus
  sku?: string
  tax_class?: string
  on_sale?: boolean
  min_price?: string
  max_price?: string
  stock_status?: StockStatus
}

/**
 * Category list query parameters
 */
export interface CategoryListParams {
  context?: 'view' | 'edit'
  page?: number
  per_page?: number
  search?: string
  exclude?: number[]
  include?: number[]
  order?: 'asc' | 'desc'
  orderby?: 'id' | 'include' | 'name' | 'slug' | 'term_group' | 'description' | 'count'
  hide_empty?: boolean
  parent?: number
  product?: number
  slug?: string
}

/**
 * Tag list query parameters
 */
export interface TagListParams {
  context?: 'view' | 'edit'
  page?: number
  per_page?: number
  search?: string
  exclude?: number[]
  include?: number[]
  offset?: number
  order?: 'asc' | 'desc'
  orderby?: 'id' | 'include' | 'name' | 'slug' | 'term_group' | 'description' | 'count'
  hide_empty?: boolean
  product?: number
  slug?: string
}

/**
 * Attribute list query parameters
 */
export interface AttributeListParams {
  context?: 'view' | 'edit'
}

/**
 * Attribute term list query parameters
 */
export interface AttributeTermListParams {
  context?: 'view' | 'edit'
  page?: number
  per_page?: number
  search?: string
  exclude?: number[]
  include?: number[]
  order?: 'asc' | 'desc'
  orderby?: 'id' | 'include' | 'name' | 'slug' | 'term_group' | 'description' | 'count'
  hide_empty?: boolean
  product?: number
  slug?: string
}

// =============================================================================
// Response Types
// =============================================================================

/**
 * REST response wrapper
 */
export interface RestResponse<T> {
  body: T
  headers: Headers
}

/**
 * REST request options
 */
export interface RestRequestOptions {
  path: string
  query?: Record<string, string | number | boolean | string[] | number[] | undefined>
  data?: unknown
  extraHeaders?: Record<string, string>
  retries?: number
}

/**
 * WooCommerce error response
 */
export interface WooCommerceErrorResponse {
  code: string
  message: string
  data?: {
    status: number
    params?: Record<string, string>
    details?: Record<string, unknown>
  }
}

/**
 * Batch operation input
 */
export interface BatchInput<T> {
  create?: T[]
  update?: (T & { id: number })[]
  delete?: number[]
}

/**
 * Batch operation response
 */
export interface BatchResponse<T> {
  create?: T[]
  update?: T[]
  delete?: T[]
}
