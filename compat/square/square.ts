/**
 * @dotdo/square - Square API Compatibility Layer
 *
 * Drop-in replacement for Square SDK with edge compatibility.
 *
 * @example
 * ```typescript
 * import { Square } from '@dotdo/square'
 *
 * const square = new Square('sq0atp-xxx', { environment: 'sandbox' })
 *
 * // Create a payment
 * const payment = await square.payments.create({
 *   source_id: 'cnon:card-nonce-ok',
 *   idempotency_key: crypto.randomUUID(),
 *   amount_money: { amount: 1000, currency: 'USD' },
 * })
 *
 * // Create a customer
 * const customer = await square.customers.create({
 *   given_name: 'John',
 *   family_name: 'Doe',
 *   email_address: 'john@example.com',
 * })
 * ```
 *
 * @module @dotdo/square
 */

import type {
  Customer,
  CustomerCreateParams,
  CustomerUpdateParams,
  CustomerListParams,
  CustomerQuery,
  Payment,
  PaymentCreateParams,
  PaymentUpdateParams,
  PaymentCompleteParams,
  PaymentCancelParams,
  PaymentListParams,
  Refund,
  RefundPaymentParams,
  RefundListParams,
  CatalogObject,
  CatalogBatchUpsertParams,
  CatalogBatchRetrieveParams,
  CatalogBatchDeleteParams,
  CatalogListParams,
  CatalogSearchParams,
  Order,
  OrderCreateParams,
  OrderUpdateParams,
  OrderPayParams,
  OrderSearchParams,
  Location,
  ListResponse,
  BatchResponse,
  SquareError,
  SquareErrorResponse,
  RequestOptions,
  InventoryChange,
  InventoryCount,
  InventoryBatchChangeParams,
  InventoryBatchRetrieveCountsParams,
  InventoryRetrieveParams,
} from './types'

// =============================================================================
// Configuration
// =============================================================================

/**
 * Square client configuration options
 */
export interface SquareConfig {
  /** Environment ('sandbox' | 'production') */
  environment?: 'sandbox' | 'production'
  /** Custom access token (overrides constructor param) */
  accessToken?: string
  /** Custom fetch implementation */
  fetch?: typeof fetch
  /** Request timeout in milliseconds */
  timeout?: number
  /** Maximum network retries */
  maxNetworkRetries?: number
  /** Custom base URL (for testing) */
  baseUrl?: string
  /** Square API version */
  squareVersion?: string
}

const DEFAULT_TIMEOUT = 60000
const MAX_NETWORK_RETRIES = 2
const DEFAULT_SQUARE_VERSION = '2024-12-18'

// =============================================================================
// Square Error Class
// =============================================================================

/**
 * Square API Error
 */
export class SquareAPIError extends Error {
  errors: SquareError[]
  statusCode: number
  requestId?: string

  constructor(errors: SquareError[], statusCode: number, requestId?: string) {
    const message = errors.map((e) => e.detail || e.code).join(', ')
    super(message)
    this.name = 'SquareAPIError'
    this.errors = errors
    this.statusCode = statusCode
    this.requestId = requestId
  }
}

// =============================================================================
// Resource Base Class
// =============================================================================

/**
 * Base class for Square API resources
 */
abstract class SquareResource {
  protected square: Square

  constructor(square: Square) {
    this.square = square
  }

  protected request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<T> {
    return this.square._request(method, path, body, options)
  }
}

// =============================================================================
// Locations Resource
// =============================================================================

/**
 * Locations resource for managing Square locations
 */
export class LocationsResource extends SquareResource {
  /**
   * List all locations
   */
  async list(options?: RequestOptions): Promise<{ locations?: Location[]; errors?: SquareError[] }> {
    return this.request('GET', '/v2/locations', undefined, options)
  }

  /**
   * Create a location
   */
  async create(
    location: Partial<Location>,
    options?: RequestOptions
  ): Promise<{ location?: Location; errors?: SquareError[] }> {
    return this.request('POST', '/v2/locations', { location }, options)
  }

  /**
   * Retrieve a location by ID
   */
  async retrieve(id: string, options?: RequestOptions): Promise<{ location?: Location; errors?: SquareError[] }> {
    return this.request('GET', `/v2/locations/${id}`, undefined, options)
  }

  /**
   * Update a location
   */
  async update(
    id: string,
    location: Partial<Location>,
    options?: RequestOptions
  ): Promise<{ location?: Location; errors?: SquareError[] }> {
    return this.request('PUT', `/v2/locations/${id}`, { location }, options)
  }
}

// =============================================================================
// Customers Resource
// =============================================================================

/**
 * Customers resource for managing Square customers
 */
export class CustomersResource extends SquareResource {
  /**
   * Create a customer
   */
  async create(
    params: CustomerCreateParams,
    options?: RequestOptions
  ): Promise<{ customer?: Customer; errors?: SquareError[] }> {
    return this.request('POST', '/v2/customers', params, options)
  }

  /**
   * Retrieve a customer by ID
   */
  async retrieve(id: string, options?: RequestOptions): Promise<{ customer?: Customer; errors?: SquareError[] }> {
    return this.request('GET', `/v2/customers/${id}`, undefined, options)
  }

  /**
   * Update a customer
   */
  async update(
    id: string,
    params: CustomerUpdateParams,
    options?: RequestOptions
  ): Promise<{ customer?: Customer; errors?: SquareError[] }> {
    return this.request('PUT', `/v2/customers/${id}`, params, options)
  }

  /**
   * Delete a customer
   */
  async delete(id: string, options?: RequestOptions): Promise<{ errors?: SquareError[] }> {
    return this.request('DELETE', `/v2/customers/${id}`, undefined, options)
  }

  /**
   * List customers
   */
  async list(
    params?: CustomerListParams,
    options?: RequestOptions
  ): Promise<{ customers?: Customer[]; cursor?: string; count?: number; errors?: SquareError[] }> {
    const queryParams = params ? new URLSearchParams() : null
    if (params && queryParams) {
      if (params.cursor) queryParams.set('cursor', params.cursor)
      if (params.limit) queryParams.set('limit', String(params.limit))
      if (params.sort_field) queryParams.set('sort_field', params.sort_field)
      if (params.sort_order) queryParams.set('sort_order', params.sort_order)
      if (params.count) queryParams.set('count', String(params.count))
    }
    const path = queryParams?.toString() ? `/v2/customers?${queryParams}` : '/v2/customers'
    return this.request('GET', path, undefined, options)
  }

  /**
   * Search customers
   */
  async search(
    params: { cursor?: string; limit?: number; query?: CustomerQuery },
    options?: RequestOptions
  ): Promise<{ customers?: Customer[]; cursor?: string; errors?: SquareError[] }> {
    return this.request('POST', '/v2/customers/search', params, options)
  }

  /**
   * Create a customer card (deprecated - use cards API)
   */
  async createCard(
    customerId: string,
    params: { card_nonce: string; billing_address?: Location['address']; cardholder_name?: string },
    options?: RequestOptions
  ): Promise<{ card?: { id: string; card_brand?: string; last_4?: string; exp_month?: number; exp_year?: number }; errors?: SquareError[] }> {
    return this.request('POST', `/v2/customers/${customerId}/cards`, params, options)
  }

  /**
   * Delete a customer card
   */
  async deleteCard(customerId: string, cardId: string, options?: RequestOptions): Promise<{ errors?: SquareError[] }> {
    return this.request('DELETE', `/v2/customers/${customerId}/cards/${cardId}`, undefined, options)
  }
}

// =============================================================================
// Payments Resource
// =============================================================================

/**
 * Payments resource for managing Square payments
 */
export class PaymentsResource extends SquareResource {
  /**
   * Create a payment
   */
  async create(
    params: PaymentCreateParams,
    options?: RequestOptions
  ): Promise<{ payment?: Payment; errors?: SquareError[] }> {
    return this.request('POST', '/v2/payments', params, options)
  }

  /**
   * Retrieve a payment by ID
   */
  async retrieve(id: string, options?: RequestOptions): Promise<{ payment?: Payment; errors?: SquareError[] }> {
    return this.request('GET', `/v2/payments/${id}`, undefined, options)
  }

  /**
   * Update a payment
   */
  async update(
    id: string,
    params: PaymentUpdateParams,
    options?: RequestOptions
  ): Promise<{ payment?: Payment; errors?: SquareError[] }> {
    return this.request('PUT', `/v2/payments/${id}`, params, options)
  }

  /**
   * Cancel a payment
   */
  async cancel(
    id: string,
    _params?: PaymentCancelParams,
    options?: RequestOptions
  ): Promise<{ payment?: Payment; errors?: SquareError[] }> {
    return this.request('POST', `/v2/payments/${id}/cancel`, {}, options)
  }

  /**
   * Complete a payment
   */
  async complete(
    id: string,
    params?: PaymentCompleteParams,
    options?: RequestOptions
  ): Promise<{ payment?: Payment; errors?: SquareError[] }> {
    return this.request('POST', `/v2/payments/${id}/complete`, params ?? {}, options)
  }

  /**
   * List payments
   */
  async list(
    params?: PaymentListParams,
    options?: RequestOptions
  ): Promise<{ payments?: Payment[]; cursor?: string; errors?: SquareError[] }> {
    const queryParams = new URLSearchParams()
    if (params) {
      if (params.begin_time) queryParams.set('begin_time', params.begin_time)
      if (params.end_time) queryParams.set('end_time', params.end_time)
      if (params.sort_order) queryParams.set('sort_order', params.sort_order)
      if (params.cursor) queryParams.set('cursor', params.cursor)
      if (params.location_id) queryParams.set('location_id', params.location_id)
      if (params.limit) queryParams.set('limit', String(params.limit))
      if (params.last_4) queryParams.set('last_4', params.last_4)
      if (params.card_brand) queryParams.set('card_brand', params.card_brand)
    }
    const path = queryParams.toString() ? `/v2/payments?${queryParams}` : '/v2/payments'
    return this.request('GET', path, undefined, options)
  }
}

// =============================================================================
// Refunds Resource
// =============================================================================

/**
 * Refunds resource for managing payment refunds
 */
export class RefundsResource extends SquareResource {
  /**
   * Refund a payment
   */
  async refundPayment(
    params: RefundPaymentParams,
    options?: RequestOptions
  ): Promise<{ refund?: Refund; errors?: SquareError[] }> {
    return this.request('POST', '/v2/refunds', params, options)
  }

  /**
   * Retrieve a refund by ID
   */
  async retrieve(id: string, options?: RequestOptions): Promise<{ refund?: Refund; errors?: SquareError[] }> {
    return this.request('GET', `/v2/refunds/${id}`, undefined, options)
  }

  /**
   * List refunds
   */
  async list(
    params?: RefundListParams,
    options?: RequestOptions
  ): Promise<{ refunds?: Refund[]; cursor?: string; errors?: SquareError[] }> {
    const queryParams = new URLSearchParams()
    if (params) {
      if (params.begin_time) queryParams.set('begin_time', params.begin_time)
      if (params.end_time) queryParams.set('end_time', params.end_time)
      if (params.sort_order) queryParams.set('sort_order', params.sort_order)
      if (params.cursor) queryParams.set('cursor', params.cursor)
      if (params.location_id) queryParams.set('location_id', params.location_id)
      if (params.status) queryParams.set('status', params.status)
      if (params.source_type) queryParams.set('source_type', params.source_type)
      if (params.limit) queryParams.set('limit', String(params.limit))
    }
    const path = queryParams.toString() ? `/v2/refunds?${queryParams}` : '/v2/refunds'
    return this.request('GET', path, undefined, options)
  }
}

// =============================================================================
// Catalog Resource
// =============================================================================

/**
 * Catalog resource for managing Square catalog
 */
export class CatalogResource extends SquareResource {
  /**
   * Batch upsert catalog objects
   */
  async batchUpsert(
    params: CatalogBatchUpsertParams,
    options?: RequestOptions
  ): Promise<BatchResponse<CatalogObject>> {
    return this.request('POST', '/v2/catalog/batch-upsert', params, options)
  }

  /**
   * Batch retrieve catalog objects
   */
  async batchRetrieve(
    params: CatalogBatchRetrieveParams,
    options?: RequestOptions
  ): Promise<{ objects?: CatalogObject[]; related_objects?: CatalogObject[]; errors?: SquareError[] }> {
    return this.request('POST', '/v2/catalog/batch-retrieve', params, options)
  }

  /**
   * Batch delete catalog objects
   */
  async batchDelete(
    params: CatalogBatchDeleteParams,
    options?: RequestOptions
  ): Promise<{ deleted_object_ids?: string[]; deleted_at?: string; errors?: SquareError[] }> {
    return this.request('POST', '/v2/catalog/batch-delete', params, options)
  }

  /**
   * List catalog objects
   */
  async list(
    params?: CatalogListParams,
    options?: RequestOptions
  ): Promise<ListResponse<CatalogObject>> {
    const queryParams = new URLSearchParams()
    if (params) {
      if (params.cursor) queryParams.set('cursor', params.cursor)
      if (params.types) queryParams.set('types', params.types.join(','))
      if (params.catalog_version) queryParams.set('catalog_version', String(params.catalog_version))
    }
    const path = queryParams.toString() ? `/v2/catalog/list?${queryParams}` : '/v2/catalog/list'
    return this.request('GET', path, undefined, options)
  }

  /**
   * Retrieve a catalog object by ID
   */
  async retrieve(
    id: string,
    params?: { include_related_objects?: boolean; catalog_version?: number },
    options?: RequestOptions
  ): Promise<{ object?: CatalogObject; related_objects?: CatalogObject[]; errors?: SquareError[] }> {
    const queryParams = new URLSearchParams()
    if (params) {
      if (params.include_related_objects) queryParams.set('include_related_objects', 'true')
      if (params.catalog_version) queryParams.set('catalog_version', String(params.catalog_version))
    }
    const path = queryParams.toString() ? `/v2/catalog/object/${id}?${queryParams}` : `/v2/catalog/object/${id}`
    return this.request('GET', path, undefined, options)
  }

  /**
   * Upsert a catalog object
   */
  async upsert(
    params: { idempotency_key: string; object: CatalogObject },
    options?: RequestOptions
  ): Promise<{ catalog_object?: CatalogObject; id_mappings?: { client_object_id: string; object_id: string }[]; errors?: SquareError[] }> {
    return this.request('POST', '/v2/catalog/object', params, options)
  }

  /**
   * Delete a catalog object
   */
  async delete(
    id: string,
    options?: RequestOptions
  ): Promise<{ deleted_object_ids?: string[]; deleted_at?: string; errors?: SquareError[] }> {
    return this.request('DELETE', `/v2/catalog/object/${id}`, undefined, options)
  }

  /**
   * Search catalog objects
   */
  async search(
    params: CatalogSearchParams,
    options?: RequestOptions
  ): Promise<{ objects?: CatalogObject[]; related_objects?: CatalogObject[]; cursor?: string; latest_time?: string; errors?: SquareError[] }> {
    return this.request('POST', '/v2/catalog/search', params, options)
  }

  /**
   * Search catalog items
   */
  async searchItems(
    params: {
      text_filter?: string
      category_ids?: string[]
      stock_levels?: ('OUT' | 'LOW')[]
      enabled_location_ids?: string[]
      cursor?: string
      limit?: number
      sort_order?: 'ASC' | 'DESC'
      product_types?: string[]
      custom_attribute_filters?: { custom_attribute_definition_id?: string; key?: string; string_filter?: string; number_filter?: { min?: string; max?: string } }[]
      archived_state?: 'ARCHIVED_STATE_NOT_ARCHIVED' | 'ARCHIVED_STATE_ARCHIVED' | 'ARCHIVED_STATE_ALL'
    },
    options?: RequestOptions
  ): Promise<{ items?: CatalogObject[]; cursor?: string; matched_variation_ids?: string[]; errors?: SquareError[] }> {
    return this.request('POST', '/v2/catalog/search-catalog-items', params, options)
  }

  /**
   * Update item modifier lists
   */
  async updateItemModifierLists(
    params: { item_ids: string[]; modifier_lists_to_enable?: string[]; modifier_lists_to_disable?: string[] },
    options?: RequestOptions
  ): Promise<{ updated_at?: string; errors?: SquareError[] }> {
    return this.request('POST', '/v2/catalog/update-item-modifier-lists', params, options)
  }

  /**
   * Update item taxes
   */
  async updateItemTaxes(
    params: { item_ids: string[]; taxes_to_enable?: string[]; taxes_to_disable?: string[] },
    options?: RequestOptions
  ): Promise<{ updated_at?: string; errors?: SquareError[] }> {
    return this.request('POST', '/v2/catalog/update-item-taxes', params, options)
  }

  /**
   * Get catalog info (metadata)
   */
  async info(options?: RequestOptions): Promise<{ limits?: { batch_upsert_max_objects_per_batch?: number; batch_upsert_max_total_objects?: number; batch_retrieve_max_object_ids?: number; search_max_page_limit?: number; batch_delete_max_object_ids?: number; update_item_taxes_max_item_ids?: number; update_item_taxes_max_taxes_to_enable?: number; update_item_taxes_max_taxes_to_disable?: number; update_item_modifier_lists_max_item_ids?: number; update_item_modifier_lists_max_modifier_lists_to_enable?: number; update_item_modifier_lists_max_modifier_lists_to_disable?: number }; standard_unit_description_group?: { standard_unit_descriptions?: { unit?: { custom_unit?: { name: string; abbreviation: string }; area_unit?: string; length_unit?: string; volume_unit?: string; weight_unit?: string; generic_unit?: string; time_unit?: string; type?: string }; name?: string; abbreviation?: string }[]; language_code?: string } }> {
    return this.request('GET', '/v2/catalog/info', undefined, options)
  }
}

// =============================================================================
// Orders Resource
// =============================================================================

/**
 * Orders resource for managing Square orders
 */
export class OrdersResource extends SquareResource {
  /**
   * Create an order
   */
  async create(
    params: OrderCreateParams,
    options?: RequestOptions
  ): Promise<{ order?: Order; errors?: SquareError[] }> {
    return this.request('POST', '/v2/orders', params, options)
  }

  /**
   * Retrieve an order by ID
   */
  async retrieve(id: string, options?: RequestOptions): Promise<{ order?: Order; errors?: SquareError[] }> {
    return this.request('GET', `/v2/orders/${id}`, undefined, options)
  }

  /**
   * Update an order
   */
  async update(
    id: string,
    params: OrderUpdateParams,
    options?: RequestOptions
  ): Promise<{ order?: Order; errors?: SquareError[] }> {
    return this.request('PUT', `/v2/orders/${id}`, params, options)
  }

  /**
   * Pay for an order
   */
  async pay(
    id: string,
    params: OrderPayParams,
    options?: RequestOptions
  ): Promise<{ order?: Order; errors?: SquareError[] }> {
    return this.request('POST', `/v2/orders/${id}/pay`, params, options)
  }

  /**
   * Clone an order
   */
  async clone(
    params: { order_id: string; version?: number; idempotency_key?: string },
    options?: RequestOptions
  ): Promise<{ order?: Order; errors?: SquareError[] }> {
    return this.request('POST', '/v2/orders/clone', params, options)
  }

  /**
   * Search orders
   */
  async search(
    params: OrderSearchParams,
    options?: RequestOptions
  ): Promise<{ orders?: Order[]; order_entries?: { order_id: string; version?: number; location_id?: string }[]; cursor?: string; errors?: SquareError[] }> {
    return this.request('POST', '/v2/orders/search', params, options)
  }

  /**
   * Batch retrieve orders
   */
  async batchRetrieve(
    params: { location_id?: string; order_ids: string[] },
    options?: RequestOptions
  ): Promise<{ orders?: Order[]; errors?: SquareError[] }> {
    return this.request('POST', '/v2/orders/batch-retrieve', params, options)
  }

  /**
   * Calculate an order
   */
  async calculate(
    params: { order: Order; proposed_rewards?: { id: string; reward_tier_id: string }[] },
    options?: RequestOptions
  ): Promise<{ order?: Order; errors?: SquareError[] }> {
    return this.request('POST', '/v2/orders/calculate', params, options)
  }
}

// =============================================================================
// Inventory Resource
// =============================================================================

/**
 * Inventory resource for managing Square inventory
 */
export class InventoryResource extends SquareResource {
  /**
   * Batch change inventory
   */
  async batchChange(
    params: InventoryBatchChangeParams,
    options?: RequestOptions
  ): Promise<{ counts?: InventoryCount[]; changes?: InventoryChange[]; errors?: SquareError[] }> {
    return this.request('POST', '/v2/inventory/changes/batch-create', params, options)
  }

  /**
   * Batch retrieve inventory counts
   */
  async batchRetrieveCounts(
    params: InventoryBatchRetrieveCountsParams,
    options?: RequestOptions
  ): Promise<{ counts?: InventoryCount[]; cursor?: string; errors?: SquareError[] }> {
    return this.request('POST', '/v2/inventory/counts/batch-retrieve', params, options)
  }

  /**
   * Retrieve inventory count for a catalog object
   */
  async retrieve(
    catalogObjectId: string,
    params?: InventoryRetrieveParams,
    options?: RequestOptions
  ): Promise<{ counts?: InventoryCount[]; cursor?: string; errors?: SquareError[] }> {
    const queryParams = new URLSearchParams()
    if (params) {
      if (params.location_ids) queryParams.set('location_ids', params.location_ids.join(','))
      if (params.cursor) queryParams.set('cursor', params.cursor)
      if (params.limit) queryParams.set('limit', String(params.limit))
    }
    const path = queryParams.toString()
      ? `/v2/inventory/${catalogObjectId}?${queryParams}`
      : `/v2/inventory/${catalogObjectId}`
    return this.request('GET', path, undefined, options)
  }

  /**
   * Retrieve inventory adjustment
   */
  async retrieveAdjustment(
    adjustmentId: string,
    options?: RequestOptions
  ): Promise<{ adjustment?: InventoryChange['adjustment']; errors?: SquareError[] }> {
    return this.request('GET', `/v2/inventory/adjustments/${adjustmentId}`, undefined, options)
  }

  /**
   * Retrieve inventory physical count
   */
  async retrievePhysicalCount(
    physicalCountId: string,
    options?: RequestOptions
  ): Promise<{ count?: InventoryChange['physical_count']; errors?: SquareError[] }> {
    return this.request('GET', `/v2/inventory/physical-counts/${physicalCountId}`, undefined, options)
  }

  /**
   * Retrieve inventory transfer
   */
  async retrieveTransfer(
    transferId: string,
    options?: RequestOptions
  ): Promise<{ transfer?: InventoryChange['transfer']; errors?: SquareError[] }> {
    return this.request('GET', `/v2/inventory/transfers/${transferId}`, undefined, options)
  }

  /**
   * Retrieve inventory changes
   */
  async changes(
    params?: {
      catalog_object_ids?: string[]
      location_ids?: string[]
      types?: ('PHYSICAL_COUNT' | 'ADJUSTMENT' | 'TRANSFER')[]
      states?: string[]
      updated_after?: string
      updated_before?: string
      cursor?: string
      limit?: number
    },
    options?: RequestOptions
  ): Promise<{ changes?: InventoryChange[]; cursor?: string; errors?: SquareError[] }> {
    return this.request('POST', '/v2/inventory/changes/batch-retrieve', params ?? {}, options)
  }
}

// =============================================================================
// Webhook Signature Verification
// =============================================================================

/**
 * Webhook utilities for Square
 */
export class Webhooks {
  /**
   * Verify webhook signature
   */
  static async verifySignature(
    payload: string | ArrayBuffer,
    signature: string,
    signatureKey: string,
    notificationUrl: string
  ): Promise<boolean> {
    const payloadString = typeof payload === 'string' ? payload : new TextDecoder().decode(payload)
    const combinedPayload = notificationUrl + payloadString

    const expectedSignature = await computeHmacSignature(combinedPayload, signatureKey)
    const providedSignature = signature.replace(/^sha256=/, '')

    return secureCompare(providedSignature, expectedSignature)
  }

  /**
   * Construct and verify a webhook event
   */
  static async constructEvent(
    payload: string | ArrayBuffer,
    signature: string,
    signatureKey: string,
    notificationUrl: string
  ): Promise<{
    merchant_id: string
    type: string
    event_id: string
    created_at: string
    data: { type: string; id: string; object: Record<string, unknown> }
  }> {
    const isValid = await Webhooks.verifySignature(payload, signature, signatureKey, notificationUrl)
    if (!isValid) {
      throw new Error('Webhook signature verification failed')
    }

    const payloadString = typeof payload === 'string' ? payload : new TextDecoder().decode(payload)
    return JSON.parse(payloadString)
  }
}

/**
 * Compute HMAC-SHA256 signature (base64 encoded)
 */
async function computeHmacSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const payloadData = encoder.encode(payload)

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', key, payloadData)
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
}

/**
 * Constant-time string comparison
 */
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

// =============================================================================
// Main Square Client
// =============================================================================

/**
 * Square client for API interactions
 */
export class Square {
  private accessToken: string
  private baseUrl: string
  private timeout: number
  private maxNetworkRetries: number
  private _fetch: typeof fetch
  private squareVersion: string

  // Resources
  readonly locations: LocationsResource
  readonly customers: CustomersResource
  readonly payments: PaymentsResource
  readonly refunds: RefundsResource
  readonly catalog: CatalogResource
  readonly orders: OrdersResource
  readonly inventory: InventoryResource

  // Static utilities
  static readonly webhooks = Webhooks

  constructor(accessToken: string, config: SquareConfig = {}) {
    if (!accessToken) {
      throw new Error('Square access token is required')
    }

    this.accessToken = config.accessToken ?? accessToken
    this.squareVersion = config.squareVersion ?? DEFAULT_SQUARE_VERSION

    // Determine base URL
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl
    } else if (config.environment === 'production') {
      this.baseUrl = 'https://connect.squareup.com'
    } else {
      this.baseUrl = 'https://connect.squareupsandbox.com'
    }

    this.timeout = config.timeout ?? DEFAULT_TIMEOUT
    this.maxNetworkRetries = config.maxNetworkRetries ?? MAX_NETWORK_RETRIES
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis)

    // Initialize resources
    this.locations = new LocationsResource(this)
    this.customers = new CustomersResource(this)
    this.payments = new PaymentsResource(this)
    this.refunds = new RefundsResource(this)
    this.catalog = new CatalogResource(this)
    this.orders = new OrdersResource(this)
    this.inventory = new InventoryResource(this)
  }

  /**
   * Make a raw API request
   * @internal
   */
  async _request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<T> {
    const url = new URL(path, this.baseUrl)

    const headers: Record<string, string> = {
      Authorization: `Bearer ${options?.accessToken ?? this.accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': this.squareVersion,
    }

    if (options?.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey
    }

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxNetworkRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), options?.timeout ?? this.timeout)

        try {
          const response = await this._fetch(url.toString(), {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
          })

          const data = await response.json()

          if (!response.ok) {
            const errorResponse = data as SquareErrorResponse
            throw new SquareAPIError(
              errorResponse.errors ?? [{ category: 'API_ERROR', code: 'UNKNOWN', detail: 'Unknown error' }],
              response.status,
              response.headers.get('x-request-id') ?? undefined
            )
          }

          return data as T
        } finally {
          clearTimeout(timeoutId)
        }
      } catch (error) {
        lastError = error as Error

        // Don't retry client errors (4xx)
        if (error instanceof SquareAPIError && error.statusCode >= 400 && error.statusCode < 500) {
          throw error
        }

        // Don't retry if it's an abort error
        if (error instanceof Error && error.name === 'AbortError') {
          throw new SquareAPIError(
            [{ category: 'API_ERROR', code: 'TIMEOUT', detail: 'Request timed out' }],
            408
          )
        }

        // Retry with exponential backoff
        if (attempt < this.maxNetworkRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000)
          await sleep(delay)
        }
      }
    }

    throw lastError ?? new Error('Unknown error')
  }
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// =============================================================================
// Exports
// =============================================================================

export default Square
