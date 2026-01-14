/**
 * @dotdo/woocommerce - Tax Resource
 *
 * WooCommerce REST API compatible tax operations including:
 * - Tax rates CRUD
 * - Tax classes management
 * - Batch operations
 *
 * @module @dotdo/woocommerce/taxes
 */

import type { RestClient } from './client'
import type { RestResponse, BatchInput, BatchResponse } from './types'

// =============================================================================
// Tax Types
// =============================================================================

/**
 * Tax rate
 */
export interface TaxRate {
  id: number
  country: string
  state: string
  postcode: string
  city: string
  postcodes: string[]
  cities: string[]
  rate: string
  name: string
  priority: number
  compound: boolean
  shipping: boolean
  order: number
  class: string
}

/**
 * Tax class
 */
export interface TaxClass {
  slug: string
  name: string
}

// =============================================================================
// Input Types
// =============================================================================

/**
 * Tax rate input
 */
export interface TaxRateInput {
  country?: string
  state?: string
  postcode?: string
  city?: string
  postcodes?: string[]
  cities?: string[]
  rate?: string
  name?: string
  priority?: number
  compound?: boolean
  shipping?: boolean
  order?: number
  class?: string
}

/**
 * Tax class input
 */
export interface TaxClassInput {
  name: string
}

// =============================================================================
// Query Parameters
// =============================================================================

/**
 * Tax rate list query parameters
 */
export interface TaxRateListParams {
  context?: 'view' | 'edit'
  page?: number
  per_page?: number
  offset?: number
  order?: 'asc' | 'desc'
  orderby?: 'id' | 'order' | 'priority'
  class?: string
}

// =============================================================================
// Tax Rates Resource
// =============================================================================

/**
 * Tax rates resource for WooCommerce REST API
 */
export class TaxRatesResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all tax rates
   */
  async list(params?: TaxRateListParams): Promise<RestResponse<TaxRate[]>> {
    return this.client.get({
      path: 'taxes',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get a single tax rate
   */
  async get(taxRateId: number): Promise<RestResponse<TaxRate>> {
    return this.client.get({
      path: `taxes/${taxRateId}`,
    })
  }

  /**
   * Create a tax rate
   */
  async create(input: TaxRateInput): Promise<RestResponse<TaxRate>> {
    return this.client.post({
      path: 'taxes',
      data: input,
    })
  }

  /**
   * Update a tax rate
   */
  async update(taxRateId: number, input: TaxRateInput): Promise<RestResponse<TaxRate>> {
    return this.client.put({
      path: `taxes/${taxRateId}`,
      data: input,
    })
  }

  /**
   * Delete a tax rate
   */
  async delete(taxRateId: number, options?: { force?: boolean }): Promise<RestResponse<TaxRate>> {
    return this.client.delete({
      path: `taxes/${taxRateId}`,
      query: options,
    })
  }

  /**
   * Batch create/update/delete tax rates
   */
  async batch(input: BatchInput<TaxRateInput>): Promise<RestResponse<BatchResponse<TaxRate>>> {
    return this.client.post({
      path: 'taxes/batch',
      data: input,
    })
  }
}

// =============================================================================
// Tax Classes Resource
// =============================================================================

/**
 * Tax classes resource for WooCommerce REST API
 */
export class TaxClassesResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all tax classes
   */
  async list(): Promise<RestResponse<TaxClass[]>> {
    return this.client.get({
      path: 'taxes/classes',
    })
  }

  /**
   * Create a tax class
   */
  async create(input: TaxClassInput): Promise<RestResponse<TaxClass>> {
    return this.client.post({
      path: 'taxes/classes',
      data: input,
    })
  }

  /**
   * Delete a tax class
   */
  async delete(slug: string, options?: { force?: boolean }): Promise<RestResponse<TaxClass>> {
    return this.client.delete({
      path: `taxes/classes/${slug}`,
      query: options,
    })
  }
}
