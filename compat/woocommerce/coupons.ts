/**
 * @dotdo/woocommerce - Coupons Resource
 *
 * WooCommerce REST API compatible coupon operations including:
 * - Coupon CRUD operations
 * - Discount types (percent, fixed_cart, fixed_product)
 * - Usage restrictions and limits
 * - Batch operations
 *
 * @module @dotdo/woocommerce/coupons
 */

import type { RestClient } from './client'
import type { RestResponse, BatchInput, BatchResponse, MetaData, MetaDataInput } from './types'

// =============================================================================
// Coupon Types
// =============================================================================

/**
 * Discount type
 */
export type DiscountType = 'percent' | 'fixed_cart' | 'fixed_product'

/**
 * WooCommerce Coupon
 */
export interface Coupon {
  id: number
  code: string
  amount: string
  date_created: string
  date_created_gmt: string
  date_modified: string
  date_modified_gmt: string
  discount_type: DiscountType
  description: string
  date_expires: string | null
  date_expires_gmt: string | null
  usage_count: number
  individual_use: boolean
  product_ids: number[]
  excluded_product_ids: number[]
  usage_limit: number | null
  usage_limit_per_user: number | null
  limit_usage_to_x_items: number | null
  free_shipping: boolean
  product_categories: number[]
  excluded_product_categories: number[]
  exclude_sale_items: boolean
  minimum_amount: string
  maximum_amount: string
  email_restrictions: string[]
  used_by: string[]
  meta_data: MetaData[]
}

// =============================================================================
// Input Types
// =============================================================================

/**
 * Coupon input for create/update
 */
export interface CouponInput {
  code?: string
  discount_type?: DiscountType
  amount?: string
  description?: string
  date_expires?: string | null
  date_expires_gmt?: string | null
  individual_use?: boolean
  product_ids?: number[]
  excluded_product_ids?: number[]
  usage_limit?: number | null
  usage_limit_per_user?: number | null
  limit_usage_to_x_items?: number | null
  free_shipping?: boolean
  product_categories?: number[]
  excluded_product_categories?: number[]
  exclude_sale_items?: boolean
  minimum_amount?: string
  maximum_amount?: string
  email_restrictions?: string[]
  meta_data?: MetaDataInput[]
}

// =============================================================================
// Query Parameters
// =============================================================================

/**
 * Coupon list query parameters
 */
export interface CouponListParams {
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
  code?: string
}

// =============================================================================
// Coupons Resource
// =============================================================================

/**
 * Coupons resource for WooCommerce REST API
 */
export class CouponsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all coupons
   */
  async list(params?: CouponListParams): Promise<RestResponse<Coupon[]>> {
    return this.client.get({
      path: 'coupons',
      query: this.formatParams(params),
    })
  }

  /**
   * Get a single coupon
   */
  async get(couponId: number): Promise<RestResponse<Coupon>> {
    return this.client.get({
      path: `coupons/${couponId}`,
    })
  }

  /**
   * Create a coupon
   */
  async create(input: CouponInput): Promise<RestResponse<Coupon>> {
    return this.client.post({
      path: 'coupons',
      data: input,
    })
  }

  /**
   * Update a coupon
   */
  async update(couponId: number, input: CouponInput): Promise<RestResponse<Coupon>> {
    return this.client.put({
      path: `coupons/${couponId}`,
      data: input,
    })
  }

  /**
   * Delete a coupon
   */
  async delete(couponId: number, options?: { force?: boolean }): Promise<RestResponse<Coupon>> {
    return this.client.delete({
      path: `coupons/${couponId}`,
      query: options,
    })
  }

  /**
   * Batch create/update/delete coupons
   */
  async batch(input: BatchInput<CouponInput>): Promise<RestResponse<BatchResponse<Coupon>>> {
    return this.client.post({
      path: 'coupons/batch',
      data: input,
    })
  }

  /**
   * Format query parameters
   */
  private formatParams(
    params?: CouponListParams
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
