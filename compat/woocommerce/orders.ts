/**
 * @dotdo/woocommerce - Orders Resource
 *
 * WooCommerce REST API compatible orders operations including:
 * - Order CRUD operations
 * - Order notes management
 * - Refunds processing
 * - Batch operations
 *
 * @module @dotdo/woocommerce/orders
 */

import type { RestClient } from './client'
import type {
  RestResponse,
  BatchInput,
  BatchResponse,
  MetaData,
  MetaDataInput,
} from './types'

// =============================================================================
// Order Types
// =============================================================================

/**
 * Order status
 */
export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'on-hold'
  | 'completed'
  | 'cancelled'
  | 'refunded'
  | 'failed'
  | 'trash'

/**
 * Order billing/shipping address
 */
export interface OrderAddress {
  first_name: string
  last_name: string
  company: string
  address_1: string
  address_2: string
  city: string
  state: string
  postcode: string
  country: string
  email?: string
  phone?: string
}

/**
 * Order line item
 */
export interface OrderLineItem {
  id: number
  name: string
  product_id: number
  variation_id: number
  quantity: number
  tax_class: string
  subtotal: string
  subtotal_tax: string
  total: string
  total_tax: string
  taxes: OrderItemTax[]
  meta_data: MetaData[]
  sku: string
  price: number
}

/**
 * Order item tax
 */
export interface OrderItemTax {
  id: number
  total: string
  subtotal: string
}

/**
 * Order tax line
 */
export interface OrderTaxLine {
  id: number
  rate_code: string
  rate_id: number
  label: string
  compound: boolean
  tax_total: string
  shipping_tax_total: string
  rate_percent: number
  meta_data: MetaData[]
}

/**
 * Order shipping line
 */
export interface OrderShippingLine {
  id: number
  method_title: string
  method_id: string
  instance_id: string
  total: string
  total_tax: string
  taxes: OrderItemTax[]
  meta_data: MetaData[]
}

/**
 * Order fee line
 */
export interface OrderFeeLine {
  id: number
  name: string
  tax_class: string
  tax_status: 'taxable' | 'none'
  amount: string
  total: string
  total_tax: string
  taxes: OrderItemTax[]
  meta_data: MetaData[]
}

/**
 * Order coupon line
 */
export interface OrderCouponLine {
  id: number
  code: string
  discount: string
  discount_tax: string
  meta_data: MetaData[]
}

/**
 * Order refund reference
 */
export interface OrderRefundRef {
  id: number
  reason: string
  total: string
}

/**
 * WooCommerce Order
 */
export interface Order {
  id: number
  parent_id: number
  number: string
  order_key: string
  created_via: string
  version: string
  status: OrderStatus
  currency: string
  date_created: string
  date_created_gmt: string
  date_modified: string
  date_modified_gmt: string
  discount_total: string
  discount_tax: string
  shipping_total: string
  shipping_tax: string
  cart_tax: string
  total: string
  total_tax: string
  prices_include_tax: boolean
  customer_id: number
  customer_ip_address: string
  customer_user_agent: string
  customer_note: string
  billing: OrderAddress
  shipping: OrderAddress
  payment_method: string
  payment_method_title: string
  transaction_id: string
  date_paid: string | null
  date_paid_gmt: string | null
  date_completed: string | null
  date_completed_gmt: string | null
  cart_hash: string
  meta_data: MetaData[]
  line_items: OrderLineItem[]
  tax_lines: OrderTaxLine[]
  shipping_lines: OrderShippingLine[]
  fee_lines: OrderFeeLine[]
  coupon_lines: OrderCouponLine[]
  refunds: OrderRefundRef[]
}

/**
 * Order note
 */
export interface OrderNote {
  id: number
  author: string
  date_created: string
  date_created_gmt: string
  note: string
  customer_note: boolean
}

/**
 * Order refund
 */
export interface OrderRefund {
  id: number
  date_created: string
  date_created_gmt: string
  amount: string
  reason: string
  refunded_by: number
  refunded_payment: boolean
  meta_data: MetaData[]
  line_items: RefundLineItem[]
}

/**
 * Refund line item
 */
export interface RefundLineItem {
  id: number
  name: string
  product_id: number
  variation_id: number
  quantity: number
  tax_class: string
  subtotal: string
  subtotal_tax: string
  total: string
  total_tax: string
  taxes: OrderItemTax[]
  meta_data: MetaData[]
  sku: string
  price: number
  refund_total: number
}

// =============================================================================
// Input Types
// =============================================================================

/**
 * Order address input
 */
export interface OrderAddressInput {
  first_name?: string
  last_name?: string
  company?: string
  address_1?: string
  address_2?: string
  city?: string
  state?: string
  postcode?: string
  country?: string
  email?: string
  phone?: string
}

/**
 * Order line item input
 */
export interface OrderLineItemInput {
  id?: number
  name?: string
  product_id?: number
  variation_id?: number
  quantity?: number
  tax_class?: string
  subtotal?: string
  total?: string
  meta_data?: MetaDataInput[]
}

/**
 * Order shipping line input
 */
export interface OrderShippingLineInput {
  id?: number
  method_title?: string
  method_id?: string
  instance_id?: string
  total?: string
  meta_data?: MetaDataInput[]
}

/**
 * Order fee line input
 */
export interface OrderFeeLineInput {
  id?: number
  name?: string
  tax_class?: string
  tax_status?: 'taxable' | 'none'
  total?: string
  meta_data?: MetaDataInput[]
}

/**
 * Order coupon line input
 */
export interface OrderCouponLineInput {
  id?: number
  code?: string
  meta_data?: MetaDataInput[]
}

/**
 * Order input for create/update
 */
export interface OrderInput {
  parent_id?: number
  status?: OrderStatus
  currency?: string
  customer_id?: number
  customer_note?: string
  billing?: OrderAddressInput
  shipping?: OrderAddressInput
  payment_method?: string
  payment_method_title?: string
  transaction_id?: string
  meta_data?: MetaDataInput[]
  line_items?: OrderLineItemInput[]
  shipping_lines?: OrderShippingLineInput[]
  fee_lines?: OrderFeeLineInput[]
  coupon_lines?: OrderCouponLineInput[]
  set_paid?: boolean
}

/**
 * Order note input
 */
export interface OrderNoteInput {
  note: string
  customer_note?: boolean
  added_by_user?: boolean
}

/**
 * Order refund input
 */
export interface OrderRefundInput {
  amount?: string
  reason?: string
  refunded_by?: number
  meta_data?: MetaDataInput[]
  line_items?: {
    id: number
    quantity?: number
    refund_total?: number
    refund_tax?: { id: number; amount: number }[]
  }[]
  api_refund?: boolean
  api_restock?: boolean
}

// =============================================================================
// Query Parameters
// =============================================================================

/**
 * Order list query parameters
 */
export interface OrderListParams {
  context?: 'view' | 'edit'
  page?: number
  per_page?: number
  search?: string
  after?: string
  before?: string
  modified_after?: string
  modified_before?: string
  dates_are_gmt?: boolean
  exclude?: number[]
  include?: number[]
  offset?: number
  order?: 'asc' | 'desc'
  orderby?: 'date' | 'id' | 'include' | 'title' | 'slug'
  parent?: number[]
  parent_exclude?: number[]
  status?: OrderStatus | OrderStatus[]
  customer?: number
  product?: number
  dp?: number
}

/**
 * Order note list query parameters
 */
export interface OrderNoteListParams {
  context?: 'view' | 'edit'
  type?: 'any' | 'customer' | 'internal'
}

/**
 * Order refund list query parameters
 */
export interface OrderRefundListParams {
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
  dp?: number
}

// =============================================================================
// Orders Resource
// =============================================================================

/**
 * Orders resource for WooCommerce REST API
 */
export class OrdersResource {
  private client: RestClient

  /** Order notes sub-resource */
  notes: OrderNotesResource

  /** Order refunds sub-resource */
  refunds: OrderRefundsResource

  constructor(client: RestClient) {
    this.client = client
    this.notes = new OrderNotesResource(client)
    this.refunds = new OrderRefundsResource(client)
  }

  /**
   * List all orders
   */
  async list(params?: OrderListParams): Promise<RestResponse<Order[]>> {
    return this.client.get({
      path: 'orders',
      query: this.formatParams(params),
    })
  }

  /**
   * Get a single order
   */
  async get(orderId: number): Promise<RestResponse<Order>> {
    return this.client.get({
      path: `orders/${orderId}`,
    })
  }

  /**
   * Create an order
   */
  async create(input: OrderInput): Promise<RestResponse<Order>> {
    return this.client.post({
      path: 'orders',
      data: input,
    })
  }

  /**
   * Update an order
   */
  async update(orderId: number, input: OrderInput): Promise<RestResponse<Order>> {
    return this.client.put({
      path: `orders/${orderId}`,
      data: input,
    })
  }

  /**
   * Delete an order
   */
  async delete(orderId: number, options?: { force?: boolean }): Promise<RestResponse<Order>> {
    return this.client.delete({
      path: `orders/${orderId}`,
      query: options,
    })
  }

  /**
   * Batch create/update/delete orders
   */
  async batch(input: BatchInput<OrderInput>): Promise<RestResponse<BatchResponse<Order>>> {
    return this.client.post({
      path: 'orders/batch',
      data: input,
    })
  }

  /**
   * Format query parameters
   */
  private formatParams(
    params?: OrderListParams
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
// Order Notes Resource
// =============================================================================

/**
 * Order notes resource for WooCommerce REST API
 */
export class OrderNotesResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all notes for an order
   */
  async list(orderId: number, params?: OrderNoteListParams): Promise<RestResponse<OrderNote[]>> {
    return this.client.get({
      path: `orders/${orderId}/notes`,
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get a note
   */
  async get(orderId: number, noteId: number): Promise<RestResponse<OrderNote>> {
    return this.client.get({
      path: `orders/${orderId}/notes/${noteId}`,
    })
  }

  /**
   * Create a note
   */
  async create(orderId: number, input: OrderNoteInput): Promise<RestResponse<OrderNote>> {
    return this.client.post({
      path: `orders/${orderId}/notes`,
      data: input,
    })
  }

  /**
   * Delete a note
   */
  async delete(
    orderId: number,
    noteId: number,
    options?: { force?: boolean }
  ): Promise<RestResponse<OrderNote>> {
    return this.client.delete({
      path: `orders/${orderId}/notes/${noteId}`,
      query: options,
    })
  }
}

// =============================================================================
// Order Refunds Resource
// =============================================================================

/**
 * Order refunds resource for WooCommerce REST API
 */
export class OrderRefundsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all refunds for an order
   */
  async list(
    orderId: number,
    params?: OrderRefundListParams
  ): Promise<RestResponse<OrderRefund[]>> {
    return this.client.get({
      path: `orders/${orderId}/refunds`,
      query: this.formatParams(params),
    })
  }

  /**
   * Get a refund
   */
  async get(orderId: number, refundId: number): Promise<RestResponse<OrderRefund>> {
    return this.client.get({
      path: `orders/${orderId}/refunds/${refundId}`,
    })
  }

  /**
   * Create a refund
   */
  async create(orderId: number, input: OrderRefundInput): Promise<RestResponse<OrderRefund>> {
    return this.client.post({
      path: `orders/${orderId}/refunds`,
      data: input,
    })
  }

  /**
   * Delete a refund
   */
  async delete(
    orderId: number,
    refundId: number,
    options?: { force?: boolean }
  ): Promise<RestResponse<OrderRefund>> {
    return this.client.delete({
      path: `orders/${orderId}/refunds/${refundId}`,
      query: options,
    })
  }

  /**
   * Format query parameters
   */
  private formatParams(
    params?: OrderRefundListParams
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
