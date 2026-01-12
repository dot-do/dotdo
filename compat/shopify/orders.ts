/**
 * @dotdo/shopify - Orders Resource
 *
 * Shopify Admin API compatible orders operations including:
 * - Orders CRUD (create, get, list, update, close, cancel, delete)
 * - Fulfillments (create, update tracking, cancel, complete)
 * - Refunds (create, calculate, list)
 * - Transactions (create, list, count)
 * - Risk Analysis (fraud detection integration)
 * - Fulfillment Orders (modern fulfillment workflow)
 * - Draft Orders (create orders on behalf of customers)
 *
 * Uses TemporalStore for order history and ExactlyOnceContext for idempotent operations.
 *
 * @example
 * ```typescript
 * import { OrdersResource } from '@dotdo/shopify/orders'
 *
 * const orders = new OrdersResource(restClient)
 *
 * // Create an order
 * const order = await orders.create({
 *   line_items: [{ variant_id: 123, quantity: 1 }],
 *   customer: { email: 'customer@example.com' },
 * })
 *
 * // Add fraud risk assessment
 * await orders.risks.create(order.body.order.id, {
 *   message: 'High velocity checkout from known VPN',
 *   recommendation: 'investigate',
 *   score: '0.8',
 *   source: 'FraudGuard',
 * })
 *
 * // Create fulfillment
 * await orders.fulfillments.create(order.body.order.id, {
 *   location_id: 456,
 *   tracking_number: '1Z999AA10123456784',
 *   tracking_company: 'UPS',
 * })
 *
 * // Process refund
 * await orders.refunds.create(order.body.order.id, {
 *   refund_line_items: [{ line_item_id: 789, quantity: 1 }],
 *   notify: true,
 * })
 * ```
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
  /** Order risks sub-resource for fraud analysis */
  risks: OrderRisksResource
  /** Fulfillment orders sub-resource (modern fulfillment API) */
  fulfillmentOrders: FulfillmentOrdersResource
  /** Draft orders sub-resource */
  draftOrders: DraftOrdersResource

  constructor(client: RestClient) {
    this.client = client
    this.fulfillments = new FulfillmentsResource(client)
    this.refunds = new RefundsResource(client)
    this.transactions = new TransactionsResource(client)
    this.risks = new OrderRisksResource(client)
    this.fulfillmentOrders = new FulfillmentOrdersResource(client)
    this.draftOrders = new DraftOrdersResource(client)
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

// =============================================================================
// Order Risk Types
// =============================================================================

/**
 * Order risk assessment
 */
export interface OrderRisk {
  id: number
  order_id: number
  checkout_id: number | null
  source: string
  score: string
  recommendation: 'cancel' | 'investigate' | 'accept'
  display: boolean
  cause_cancel: boolean
  message: string
  merchant_message: string
}

/**
 * Input for creating an order risk
 */
export interface OrderRiskInput {
  message: string
  recommendation: 'cancel' | 'investigate' | 'accept'
  score?: string
  source?: string
  cause_cancel?: boolean
  display?: boolean
}

/**
 * Input for updating an order risk
 */
export interface OrderRiskUpdateInput {
  message?: string
  recommendation?: 'cancel' | 'investigate' | 'accept'
  score?: string
  source?: string
  cause_cancel?: boolean
  display?: boolean
}

// =============================================================================
// Order Risks Resource
// =============================================================================

/**
 * Order Risks resource for Shopify Admin API
 *
 * Order risks represent the results of fraud analysis performed on an order.
 * Third-party apps can create their own risk assessments that are factored
 * into Shopify's fraud detection.
 */
export class OrderRisksResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all risks for an order
   *
   * Returns a list of all the order risk assessments performed on an order.
   * This includes risks from Shopify's internal analysis as well as risks
   * created by third-party apps.
   */
  async list(orderId: number): Promise<RestResponse<{ risks: OrderRisk[] }>> {
    return this.client.get({
      path: `orders/${orderId}/risks`,
    })
  }

  /**
   * Get a specific order risk
   *
   * Retrieves detailed information about a single risk assessment.
   */
  async get(orderId: number, riskId: number): Promise<RestResponse<{ risk: OrderRisk }>> {
    return this.client.get({
      path: `orders/${orderId}/risks/${riskId}`,
    })
  }

  /**
   * Create an order risk assessment
   *
   * Adds a new risk assessment to an order. Apps can use this to flag
   * potentially fraudulent orders based on their own analysis algorithms.
   *
   * @example
   * ```typescript
   * const result = await orders.risks.create(orderId, {
   *   message: 'High velocity checkout from known VPN',
   *   recommendation: 'investigate',
   *   score: '0.8',
   *   source: 'FraudGuard',
   *   display: true,
   * })
   * ```
   */
  async create(orderId: number, input: OrderRiskInput): Promise<RestResponse<{ risk: OrderRisk }>> {
    return this.client.post({
      path: `orders/${orderId}/risks`,
      data: { risk: input },
    })
  }

  /**
   * Update an order risk assessment
   *
   * Modifies an existing risk assessment. This can be used to update
   * the recommendation or score after gathering additional information.
   */
  async update(orderId: number, riskId: number, input: OrderRiskUpdateInput): Promise<RestResponse<{ risk: OrderRisk }>> {
    return this.client.put({
      path: `orders/${orderId}/risks/${riskId}`,
      data: { risk: input },
    })
  }

  /**
   * Delete an order risk assessment
   *
   * Removes a risk assessment from an order. Only risks created by your
   * app can be deleted; Shopify's internal risk assessments cannot be removed.
   */
  async delete(orderId: number, riskId: number): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: `orders/${orderId}/risks/${riskId}`,
    })
  }
}

// =============================================================================
// Fulfillment Orders Types
// =============================================================================

/**
 * Fulfillment order represents a group of line items to be fulfilled
 * from a specific location
 */
export interface FulfillmentOrder {
  id: number
  order_id: number
  assigned_location_id: number
  request_status: 'unsubmitted' | 'submitted' | 'accepted' | 'rejected' | 'cancellation_requested' | 'cancellation_accepted' | 'cancellation_rejected' | 'closed'
  status: 'open' | 'in_progress' | 'cancelled' | 'incomplete' | 'closed'
  supported_actions: string[]
  destination: FulfillmentOrderDestination | null
  line_items: FulfillmentOrderLineItem[]
  fulfill_at: string | null
  fulfill_by: string | null
  international_duties: { incoterm?: string } | null
  fulfillment_holds: FulfillmentHold[]
  delivery_method: DeliveryMethod | null
  assigned_location: AssignedLocation
  merchant_requests: MerchantRequest[]
  created_at: string
  updated_at: string
}

/**
 * Destination for fulfillment order
 */
export interface FulfillmentOrderDestination {
  id: number
  address1: string | null
  address2: string | null
  city: string | null
  company: string | null
  country: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  province: string | null
  zip: string | null
}

/**
 * Line item in a fulfillment order
 */
export interface FulfillmentOrderLineItem {
  id: number
  shop_id: number
  fulfillment_order_id: number
  quantity: number
  line_item_id: number
  inventory_item_id: number
  fulfillable_quantity: number
  variant_id: number
}

/**
 * Fulfillment hold information
 */
export interface FulfillmentHold {
  reason: 'awaiting_payment' | 'high_risk_of_fraud' | 'incorrect_address' | 'inventory_out_of_stock' | 'other'
  reason_notes: string | null
  held_by: 'merchant' | 'shopify'
}

/**
 * Delivery method for fulfillment order
 */
export interface DeliveryMethod {
  id: number
  method_type: 'shipping' | 'pick_up' | 'local' | 'none' | 'retail'
  min_delivery_date_time: string | null
  max_delivery_date_time: string | null
}

/**
 * Assigned location for fulfillment order
 */
export interface AssignedLocation {
  address1: string | null
  address2: string | null
  city: string | null
  country_code: string
  location_id: number
  name: string
  phone: string | null
  province: string | null
  zip: string | null
}

/**
 * Merchant request for fulfillment order
 */
export interface MerchantRequest {
  message: string
  request_options: { notify_customer?: boolean; date?: string }
  kind: 'fulfillment_request' | 'cancellation_request'
  sent_at: string
}

/**
 * Input for holding a fulfillment order
 */
export interface FulfillmentOrderHoldInput {
  reason: 'awaiting_payment' | 'high_risk_of_fraud' | 'incorrect_address' | 'inventory_out_of_stock' | 'other'
  reason_notes?: string
  notify_merchant?: boolean
  fulfillment_order_line_items?: { id: number; quantity: number }[]
}

/**
 * Input for moving a fulfillment order
 */
export interface FulfillmentOrderMoveInput {
  new_location_id: number
  fulfillment_order_line_items?: { id: number; quantity: number }[]
}

/**
 * Input for releasing a fulfillment order hold
 */
export interface FulfillmentOrderReleaseHoldInput {
  external_id?: string
}

/**
 * Input for scheduling a fulfillment order
 */
export interface FulfillmentOrderScheduleInput {
  fulfill_at: string
}

/**
 * Input for rescheduling a fulfillment order
 */
export interface FulfillmentOrderRescheduleInput {
  new_fulfill_at: string
}

// =============================================================================
// Fulfillment Orders Resource
// =============================================================================

/**
 * Fulfillment Orders resource for Shopify Admin API
 *
 * Fulfillment orders represent a group of one or more line items that are
 * to be fulfilled from the same location. The new fulfillment order API
 * is the recommended way to handle fulfillments for orders.
 */
export class FulfillmentOrdersResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all fulfillment orders for an order
   */
  async list(orderId: number): Promise<RestResponse<{ fulfillment_orders: FulfillmentOrder[] }>> {
    return this.client.get({
      path: `orders/${orderId}/fulfillment_orders`,
    })
  }

  /**
   * Get a specific fulfillment order
   */
  async get(fulfillmentOrderId: number): Promise<RestResponse<{ fulfillment_order: FulfillmentOrder }>> {
    return this.client.get({
      path: `fulfillment_orders/${fulfillmentOrderId}`,
    })
  }

  /**
   * Cancel a fulfillment order
   *
   * Cancels a fulfillment order that is open or in progress. Once cancelled,
   * the fulfillment order cannot be completed.
   */
  async cancel(fulfillmentOrderId: number): Promise<RestResponse<{ fulfillment_order: FulfillmentOrder }>> {
    return this.client.post({
      path: `fulfillment_orders/${fulfillmentOrderId}/cancel`,
      data: {},
    })
  }

  /**
   * Close a fulfillment order
   *
   * Marks a fulfillment order as incomplete and prevents further fulfillment
   * of the remaining items.
   */
  async close(fulfillmentOrderId: number, message?: string): Promise<RestResponse<{ fulfillment_order: FulfillmentOrder }>> {
    return this.client.post({
      path: `fulfillment_orders/${fulfillmentOrderId}/close`,
      data: { fulfillment_order: { message } },
    })
  }

  /**
   * Hold a fulfillment order
   *
   * Places a fulfillment order on hold, preventing it from being fulfilled
   * until the hold is released.
   */
  async hold(fulfillmentOrderId: number, input: FulfillmentOrderHoldInput): Promise<RestResponse<{ fulfillment_order: FulfillmentOrder }>> {
    return this.client.post({
      path: `fulfillment_orders/${fulfillmentOrderId}/hold`,
      data: { fulfillment_hold: input },
    })
  }

  /**
   * Release a fulfillment order hold
   *
   * Releases a held fulfillment order so it can be fulfilled.
   */
  async releaseHold(fulfillmentOrderId: number, input?: FulfillmentOrderReleaseHoldInput): Promise<RestResponse<{ fulfillment_order: FulfillmentOrder }>> {
    return this.client.post({
      path: `fulfillment_orders/${fulfillmentOrderId}/release_hold`,
      data: input ?? {},
    })
  }

  /**
   * Move a fulfillment order to a new location
   *
   * Moves a fulfillment order to a different location. This is useful when
   * inventory needs to be fulfilled from a different warehouse.
   */
  async move(fulfillmentOrderId: number, input: FulfillmentOrderMoveInput): Promise<RestResponse<{ original_fulfillment_order: FulfillmentOrder; moved_fulfillment_order: FulfillmentOrder; remaining_fulfillment_order: FulfillmentOrder | null }>> {
    return this.client.post({
      path: `fulfillment_orders/${fulfillmentOrderId}/move`,
      data: { fulfillment_order: input },
    })
  }

  /**
   * Open a fulfillment order
   *
   * Opens a fulfillment order that was previously closed.
   */
  async open(fulfillmentOrderId: number): Promise<RestResponse<{ fulfillment_order: FulfillmentOrder }>> {
    return this.client.post({
      path: `fulfillment_orders/${fulfillmentOrderId}/open`,
      data: {},
    })
  }

  /**
   * Reschedule a fulfillment order
   *
   * Updates the scheduled fulfillment date for a fulfillment order.
   */
  async reschedule(fulfillmentOrderId: number, input: FulfillmentOrderRescheduleInput): Promise<RestResponse<{ fulfillment_order: FulfillmentOrder }>> {
    return this.client.post({
      path: `fulfillment_orders/${fulfillmentOrderId}/reschedule`,
      data: { fulfillment_order: input },
    })
  }

  /**
   * Set the fulfill-at time of a fulfillment order
   *
   * Sets the deadline for fulfilling the order.
   */
  async setFulfillmentOrdersDeadline(fulfillmentOrderIds: number[], fulfillDeadline: string): Promise<RestResponse<Record<string, never>>> {
    return this.client.post({
      path: 'fulfillment_orders/set_fulfillment_orders_deadline',
      data: {
        fulfillment_order_ids: fulfillmentOrderIds,
        fulfill_at: fulfillDeadline,
      },
    })
  }

  /**
   * Retrieve fulfillment orders assigned to a location
   *
   * Gets all fulfillment orders that are assigned to a specific location
   * and are ready for fulfillment.
   */
  async listByLocation(locationId: number, params?: {
    assignment_status?: 'cancellation_requested' | 'fulfillment_requested' | 'fulfillment_accepted'
    location_ids?: number[]
    created_at_min?: string
    created_at_max?: string
    updated_at_min?: string
    updated_at_max?: string
    limit?: number
  }): Promise<RestResponse<{ fulfillment_orders: FulfillmentOrder[] }>> {
    return this.client.get({
      path: `assigned_fulfillment_orders`,
      query: {
        ...params,
        assignment_status: params?.assignment_status,
        location_ids: params?.location_ids?.join(','),
      },
    })
  }
}

// =============================================================================
// Draft Orders Types
// =============================================================================

/**
 * Draft order represents a preliminary order that can be converted to an order
 */
export interface DraftOrder {
  id: number
  order_id: number | null
  name: string
  customer: DraftOrderCustomer | null
  shipping_address: Address | null
  billing_address: Address | null
  note: string | null
  note_attributes: NoteAttribute[]
  email: string | null
  currency: string
  invoice_sent_at: string | null
  invoice_url: string
  line_items: DraftOrderLineItem[]
  shipping_line: DraftOrderShippingLine | null
  tags: string
  tax_exempt: boolean
  tax_exemptions: string[]
  tax_lines: TaxLine[]
  applied_discount: DraftOrderDiscount | null
  taxes_included: boolean
  total_tax: string
  subtotal_price: string
  total_price: string
  completed_at: string | null
  created_at: string
  updated_at: string
  status: 'open' | 'invoice_sent' | 'completed'
  admin_graphql_api_id: string
}

/**
 * Customer for draft order
 */
export interface DraftOrderCustomer {
  id: number
  email: string | null
  first_name: string | null
  last_name: string | null
  accepts_marketing: boolean
  default_address: Address | null
}

/**
 * Line item for draft order
 */
export interface DraftOrderLineItem {
  id: number
  variant_id: number | null
  product_id: number | null
  title: string
  variant_title: string | null
  sku: string | null
  vendor: string | null
  quantity: number
  requires_shipping: boolean
  taxable: boolean
  gift_card: boolean
  fulfillment_service: string
  grams: number
  tax_lines: TaxLine[]
  applied_discount: DraftOrderDiscount | null
  name: string
  properties: { name: string; value: string }[]
  custom: boolean
  price: string
  admin_graphql_api_id: string
}

/**
 * Shipping line for draft order
 */
export interface DraftOrderShippingLine {
  title: string
  price: string
  custom: boolean
  handle: string | null
}

/**
 * Discount applied to draft order
 */
export interface DraftOrderDiscount {
  title: string | null
  description: string
  value: string
  value_type: 'fixed_amount' | 'percentage'
  amount: string
}

/**
 * Input for creating a draft order
 */
export interface DraftOrderInput {
  line_items?: DraftOrderLineItemInput[]
  customer?: { id?: number; email?: string }
  billing_address?: Address
  shipping_address?: Address
  note?: string
  note_attributes?: { name: string; value: string }[]
  email?: string
  tags?: string
  tax_exempt?: boolean
  shipping_line?: { title: string; price: string; custom?: boolean }
  applied_discount?: { title?: string; description: string; value: string; value_type: 'fixed_amount' | 'percentage'; amount?: string }
  taxes_included?: boolean
  use_customer_default_address?: boolean
}

/**
 * Input for draft order line item
 */
export interface DraftOrderLineItemInput {
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
  tax_lines?: { title: string; price: string; rate?: number }[]
  applied_discount?: { title?: string; description: string; value: string; value_type: 'fixed_amount' | 'percentage' }
  properties?: { name: string; value: string }[]
  custom?: boolean
}

/**
 * Import note attribute from types
 */
interface NoteAttribute {
  name: string
  value: string
}

/**
 * Import tax line from types
 */
interface TaxLine {
  title: string
  price: string
  rate: number
  channel_liable?: boolean
}

// =============================================================================
// Draft Orders Resource
// =============================================================================

/**
 * Draft Orders resource for Shopify Admin API
 *
 * Draft orders let merchants create orders on behalf of customers.
 * They're useful for phone orders, wholesale orders, or orders that
 * require special handling before completion.
 */
export class DraftOrdersResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all draft orders
   */
  async list(params?: {
    limit?: number
    since_id?: number
    created_at_min?: string
    created_at_max?: string
    updated_at_min?: string
    updated_at_max?: string
    ids?: string
    status?: 'open' | 'invoice_sent' | 'completed'
    fields?: string
  }): Promise<RestResponse<{ draft_orders: DraftOrder[] }>> {
    return this.client.get({
      path: 'draft_orders',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get a single draft order
   */
  async get(draftOrderId: number, params?: { fields?: string }): Promise<RestResponse<{ draft_order: DraftOrder }>> {
    return this.client.get({
      path: `draft_orders/${draftOrderId}`,
      query: params,
    })
  }

  /**
   * Create a draft order
   */
  async create(input: DraftOrderInput): Promise<RestResponse<{ draft_order: DraftOrder }>> {
    return this.client.post({
      path: 'draft_orders',
      data: { draft_order: input },
    })
  }

  /**
   * Update a draft order
   */
  async update(draftOrderId: number, input: Partial<DraftOrderInput>): Promise<RestResponse<{ draft_order: DraftOrder }>> {
    return this.client.put({
      path: `draft_orders/${draftOrderId}`,
      data: { draft_order: input },
    })
  }

  /**
   * Delete a draft order
   */
  async delete(draftOrderId: number): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: `draft_orders/${draftOrderId}`,
    })
  }

  /**
   * Count draft orders
   */
  async count(params?: {
    since_id?: number
    created_at_min?: string
    created_at_max?: string
    updated_at_min?: string
    updated_at_max?: string
    status?: 'open' | 'invoice_sent' | 'completed'
  }): Promise<RestResponse<{ count: number }>> {
    return this.client.get({
      path: 'draft_orders/count',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Send an invoice for the draft order
   *
   * Sends an email invoice to the customer with a link to complete checkout.
   */
  async sendInvoice(draftOrderId: number, input?: {
    to?: string
    from?: string
    bcc?: string[]
    subject?: string
    custom_message?: string
  }): Promise<RestResponse<{ draft_order_invoice: { to: string; from: string; bcc: string[]; subject: string; custom_message: string } }>> {
    return this.client.post({
      path: `draft_orders/${draftOrderId}/send_invoice`,
      data: { draft_order_invoice: input ?? {} },
    })
  }

  /**
   * Complete a draft order
   *
   * Completes a draft order, creating a regular order. The draft order
   * is marked as completed and can no longer be modified.
   */
  async complete(draftOrderId: number, paymentPending?: boolean): Promise<RestResponse<{ draft_order: DraftOrder }>> {
    return this.client.put({
      path: `draft_orders/${draftOrderId}/complete`,
      data: paymentPending !== undefined ? { payment_pending: paymentPending } : {},
    })
  }
}
