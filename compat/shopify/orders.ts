/**
 * @dotdo/shopify - Orders Resource
 *
 * Shopify Admin API compatible orders operations including:
 * - Orders CRUD
 * - Fulfillments
 * - Refunds
 * - Transactions
 *
 * Uses TemporalStore for order history and ExactlyOnceContext for idempotent operations.
 *
 * @module @dotdo/shopify/orders
 */

import type { RestClient } from './client'
import type {
  Order,
  LineItem,
  Fulfillment,
  Refund,
  Transaction,
  Address,
  RestResponse,
  FinancialStatus,
  FulfillmentStatus,
} from './types'

// =============================================================================
// Order Input Types
// =============================================================================

/**
 * Input for creating an order
 */
export interface OrderInput {
  line_items?: OrderLineItemInput[]
  customer?: { id?: number; email?: string }
  billing_address?: Address
  shipping_address?: Address
  financial_status?: FinancialStatus
  fulfillment_status?: FulfillmentStatus | null
  currency?: string
  email?: string
  phone?: string
  note?: string
  tags?: string
  test?: boolean
  send_receipt?: boolean
  send_fulfillment_receipt?: boolean
  shipping_lines?: ShippingLineInput[]
  discount_codes?: { code: string; amount?: string; type?: string }[]
  taxes_included?: boolean
  tax_lines?: { title: string; price: string; rate?: number }[]
  transactions?: TransactionInput[]
  inventory_behaviour?: 'bypass' | 'decrement_ignoring_policy' | 'decrement_obeying_policy'
  source_name?: string
}

/**
 * Input for order line item
 */
export interface OrderLineItemInput {
  variant_id?: number
  product_id?: number
  title?: string
  quantity: number
  price?: string
  sku?: string
  grams?: number
  requires_shipping?: boolean
  taxable?: boolean
  gift_card?: boolean
  fulfillment_service?: string
  tax_lines?: { title: string; price: string; rate?: number }[]
  properties?: { name: string; value: string }[]
}

/**
 * Input for shipping line
 */
export interface ShippingLineInput {
  title?: string
  price?: string
  code?: string
  source?: string
  carrier_identifier?: string
  tax_lines?: { title: string; price: string; rate?: number }[]
}

/**
 * Input for transaction
 */
export interface TransactionInput {
  kind: 'authorization' | 'capture' | 'sale' | 'void' | 'refund'
  amount?: string
  gateway?: string
  source?: string
  authorization?: string
  currency?: string
}

/**
 * Input for updating an order
 */
export interface OrderUpdateInput {
  email?: string
  phone?: string
  note?: string
  tags?: string
  shipping_address?: Address
  billing_address?: Address
  buyer_accepts_marketing?: boolean
  metafields?: { namespace: string; key: string; value: string; type: string }[]
}

/**
 * Input for cancelling an order
 */
export interface OrderCancelInput {
  reason?: 'customer' | 'fraud' | 'inventory' | 'declined' | 'other'
  email?: boolean
  restock?: boolean
  refund?: { note?: string; shipping?: { full_refund?: boolean; amount?: string }; transactions?: TransactionInput[] }
}

// =============================================================================
// Fulfillment Input Types
// =============================================================================

/**
 * Input for creating a fulfillment
 */
export interface FulfillmentInput {
  location_id?: number
  tracking_number?: string
  tracking_numbers?: string[]
  tracking_url?: string
  tracking_urls?: string[]
  tracking_company?: string
  line_items?: { id: number; quantity?: number }[]
  notify_customer?: boolean
  shipment_status?: 'label_printed' | 'label_purchased' | 'attempted_delivery' | 'ready_for_pickup' | 'confirmed' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'failure'
}

/**
 * Input for updating fulfillment tracking
 */
export interface FulfillmentTrackingInput {
  tracking_number?: string
  tracking_numbers?: string[]
  tracking_url?: string
  tracking_urls?: string[]
  tracking_company?: string
  notify_customer?: boolean
}

// =============================================================================
// Refund Input Types
// =============================================================================

/**
 * Input for creating a refund
 */
export interface RefundInput {
  refund_line_items?: RefundLineItemInput[]
  shipping?: { full_refund?: boolean; amount?: string }
  note?: string
  notify?: boolean
  transactions?: TransactionInput[]
  currency?: string
}

/**
 * Input for refund line item
 */
export interface RefundLineItemInput {
  line_item_id: number
  quantity: number
  restock_type?: 'no_restock' | 'cancel' | 'return' | 'legacy_restock'
  location_id?: number
}

/**
 * Input for calculating a refund
 */
export interface RefundCalculateInput {
  refund_line_items?: RefundLineItemInput[]
  shipping?: { full_refund?: boolean; amount?: string }
}

// =============================================================================
// Orders Resource
// =============================================================================

/**
 * Orders resource for Shopify Admin API
 */
export class OrdersResource {
  private client: RestClient

  /** Fulfillments sub-resource */
  fulfillments: FulfillmentsResource
  /** Refunds sub-resource */
  refunds: RefundsResource
  /** Transactions sub-resource */
  transactions: TransactionsResource

  constructor(client: RestClient) {
    this.client = client
    this.fulfillments = new FulfillmentsResource(client)
    this.refunds = new RefundsResource(client)
    this.transactions = new TransactionsResource(client)
  }

  /**
   * List all orders
   */
  async list(params?: {
    limit?: number
    since_id?: number
    created_at_min?: string
    created_at_max?: string
    updated_at_min?: string
    updated_at_max?: string
    processed_at_min?: string
    processed_at_max?: string
    status?: 'open' | 'closed' | 'cancelled' | 'any'
    financial_status?: FinancialStatus | 'any'
    fulfillment_status?: FulfillmentStatus | 'unfulfilled' | 'any'
    ids?: string
    fields?: string
    attribution_app_id?: string
  }): Promise<RestResponse<{ orders: Order[] }>> {
    return this.client.get({
      path: 'orders',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get a single order
   */
  async get(orderId: number, params?: { fields?: string }): Promise<RestResponse<{ order: Order }>> {
    return this.client.get({
      path: `orders/${orderId}`,
      query: params,
    })
  }

  /**
   * Create an order
   */
  async create(input: OrderInput): Promise<RestResponse<{ order: Order }>> {
    return this.client.post({
      path: 'orders',
      data: { order: input },
    })
  }

  /**
   * Update an order
   */
  async update(orderId: number, input: OrderUpdateInput): Promise<RestResponse<{ order: Order }>> {
    return this.client.put({
      path: `orders/${orderId}`,
      data: { order: input },
    })
  }

  /**
   * Delete an order
   */
  async delete(orderId: number): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: `orders/${orderId}`,
    })
  }

  /**
   * Close an order
   */
  async close(orderId: number): Promise<RestResponse<{ order: Order }>> {
    return this.client.post({
      path: `orders/${orderId}/close`,
      data: {},
    })
  }

  /**
   * Re-open a closed order
   */
  async open(orderId: number): Promise<RestResponse<{ order: Order }>> {
    return this.client.post({
      path: `orders/${orderId}/open`,
      data: {},
    })
  }

  /**
   * Cancel an order
   */
  async cancel(orderId: number, input?: OrderCancelInput): Promise<RestResponse<{ order: Order }>> {
    return this.client.post({
      path: `orders/${orderId}/cancel`,
      data: input ?? {},
    })
  }

  /**
   * Count orders
   */
  async count(params?: {
    created_at_min?: string
    created_at_max?: string
    updated_at_min?: string
    updated_at_max?: string
    status?: 'open' | 'closed' | 'cancelled' | 'any'
    financial_status?: FinancialStatus | 'any'
    fulfillment_status?: FulfillmentStatus | 'unfulfilled' | 'any'
  }): Promise<RestResponse<{ count: number }>> {
    return this.client.get({
      path: 'orders/count',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }
}

// =============================================================================
// Fulfillments Resource
// =============================================================================

/**
 * Fulfillments resource for Shopify Admin API
 */
export class FulfillmentsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all fulfillments for an order
   */
  async list(orderId: number, params?: {
    limit?: number
    since_id?: number
    created_at_min?: string
    created_at_max?: string
    updated_at_min?: string
    updated_at_max?: string
    fields?: string
  }): Promise<RestResponse<{ fulfillments: Fulfillment[] }>> {
    return this.client.get({
      path: `orders/${orderId}/fulfillments`,
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get a fulfillment
   */
  async get(orderId: number, fulfillmentId: number, params?: { fields?: string }): Promise<RestResponse<{ fulfillment: Fulfillment }>> {
    return this.client.get({
      path: `orders/${orderId}/fulfillments/${fulfillmentId}`,
      query: params,
    })
  }

  /**
   * Create a fulfillment for an order
   */
  async create(orderId: number, input: FulfillmentInput): Promise<RestResponse<{ fulfillment: Fulfillment }>> {
    return this.client.post({
      path: `orders/${orderId}/fulfillments`,
      data: { fulfillment: input },
    })
  }

  /**
   * Update a fulfillment's tracking info
   */
  async updateTracking(orderId: number, fulfillmentId: number, input: FulfillmentTrackingInput): Promise<RestResponse<{ fulfillment: Fulfillment }>> {
    return this.client.put({
      path: `orders/${orderId}/fulfillments/${fulfillmentId}/update_tracking`,
      data: { fulfillment: input },
    })
  }

  /**
   * Cancel a fulfillment
   */
  async cancel(orderId: number, fulfillmentId: number): Promise<RestResponse<{ fulfillment: Fulfillment }>> {
    return this.client.post({
      path: `orders/${orderId}/fulfillments/${fulfillmentId}/cancel`,
      data: {},
    })
  }

  /**
   * Complete a fulfillment
   */
  async complete(orderId: number, fulfillmentId: number): Promise<RestResponse<{ fulfillment: Fulfillment }>> {
    return this.client.post({
      path: `orders/${orderId}/fulfillments/${fulfillmentId}/complete`,
      data: {},
    })
  }

  /**
   * Count fulfillments for an order
   */
  async count(orderId: number, params?: {
    created_at_min?: string
    created_at_max?: string
    updated_at_min?: string
    updated_at_max?: string
  }): Promise<RestResponse<{ count: number }>> {
    return this.client.get({
      path: `orders/${orderId}/fulfillments/count`,
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }
}

// =============================================================================
// Refunds Resource
// =============================================================================

/**
 * Refunds resource for Shopify Admin API
 */
export class RefundsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all refunds for an order
   */
  async list(orderId: number, params?: {
    limit?: number
    fields?: string
  }): Promise<RestResponse<{ refunds: Refund[] }>> {
    return this.client.get({
      path: `orders/${orderId}/refunds`,
      query: params,
    })
  }

  /**
   * Get a refund
   */
  async get(orderId: number, refundId: number, params?: { fields?: string }): Promise<RestResponse<{ refund: Refund }>> {
    return this.client.get({
      path: `orders/${orderId}/refunds/${refundId}`,
      query: params,
    })
  }

  /**
   * Create a refund
   */
  async create(orderId: number, input: RefundInput): Promise<RestResponse<{ refund: Refund }>> {
    return this.client.post({
      path: `orders/${orderId}/refunds`,
      data: { refund: input },
    })
  }

  /**
   * Calculate a refund
   */
  async calculate(orderId: number, input: RefundCalculateInput): Promise<RestResponse<{ refund: Partial<Refund> }>> {
    return this.client.post({
      path: `orders/${orderId}/refunds/calculate`,
      data: { refund: input },
    })
  }
}

// =============================================================================
// Transactions Resource
// =============================================================================

/**
 * Transactions resource for Shopify Admin API
 */
export class TransactionsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all transactions for an order
   */
  async list(orderId: number, params?: {
    since_id?: number
    fields?: string
  }): Promise<RestResponse<{ transactions: Transaction[] }>> {
    return this.client.get({
      path: `orders/${orderId}/transactions`,
      query: params,
    })
  }

  /**
   * Get a transaction
   */
  async get(orderId: number, transactionId: number, params?: { fields?: string }): Promise<RestResponse<{ transaction: Transaction }>> {
    return this.client.get({
      path: `orders/${orderId}/transactions/${transactionId}`,
      query: params,
    })
  }

  /**
   * Create a transaction for an order
   */
  async create(orderId: number, input: TransactionInput): Promise<RestResponse<{ transaction: Transaction }>> {
    return this.client.post({
      path: `orders/${orderId}/transactions`,
      data: { transaction: input },
    })
  }

  /**
   * Count transactions for an order
   */
  async count(orderId: number): Promise<RestResponse<{ count: number }>> {
    return this.client.get({
      path: `orders/${orderId}/transactions/count`,
    })
  }
}
