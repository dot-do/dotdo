/**
 * @dotdo/woocommerce - Customers Resource
 *
 * WooCommerce REST API compatible customer operations including:
 * - Customer CRUD operations
 * - Customer downloads access
 * - Batch operations
 *
 * @module @dotdo/woocommerce/customers
 */

import type { RestClient } from './client'
import type { RestResponse, BatchInput, BatchResponse, MetaData, MetaDataInput } from './types'

// =============================================================================
// Customer Types
// =============================================================================

/**
 * Customer billing/shipping address
 */
export interface CustomerAddress {
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
 * WooCommerce Customer
 */
export interface Customer {
  id: number
  date_created: string
  date_created_gmt: string
  date_modified: string
  date_modified_gmt: string
  email: string
  first_name: string
  last_name: string
  role: string
  username: string
  billing: CustomerAddress
  shipping: CustomerAddress
  is_paying_customer: boolean
  avatar_url: string
  meta_data: MetaData[]
}

/**
 * Customer download
 */
export interface CustomerDownload {
  download_id: string
  download_url: string
  product_id: number
  product_name: string
  download_name: string
  order_id: number
  order_key: string
  downloads_remaining: string
  access_expires: string | null
  access_expires_gmt: string | null
  file: {
    name: string
    file: string
  }
}

// =============================================================================
// Input Types
// =============================================================================

/**
 * Customer address input
 */
export interface CustomerAddressInput {
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
 * Customer input for create/update
 */
export interface CustomerInput {
  email?: string
  first_name?: string
  last_name?: string
  username?: string
  password?: string
  billing?: CustomerAddressInput
  shipping?: CustomerAddressInput
  meta_data?: MetaDataInput[]
}

// =============================================================================
// Query Parameters
// =============================================================================

/**
 * Customer list query parameters
 */
export interface CustomerListParams {
  context?: 'view' | 'edit'
  page?: number
  per_page?: number
  search?: string
  exclude?: number[]
  include?: number[]
  offset?: number
  order?: 'asc' | 'desc'
  orderby?: 'id' | 'include' | 'name' | 'registered_date'
  email?: string
  role?: 'all' | 'administrator' | 'editor' | 'author' | 'contributor' | 'subscriber' | 'customer'
}

// =============================================================================
// Customers Resource
// =============================================================================

/**
 * Customers resource for WooCommerce REST API
 */
export class CustomersResource {
  private client: RestClient

  /** Customer downloads sub-resource */
  downloads: CustomerDownloadsResource

  constructor(client: RestClient) {
    this.client = client
    this.downloads = new CustomerDownloadsResource(client)
  }

  /**
   * List all customers
   */
  async list(params?: CustomerListParams): Promise<RestResponse<Customer[]>> {
    return this.client.get({
      path: 'customers',
      query: this.formatParams(params),
    })
  }

  /**
   * Get a single customer
   */
  async get(customerId: number): Promise<RestResponse<Customer>> {
    return this.client.get({
      path: `customers/${customerId}`,
    })
  }

  /**
   * Create a customer
   */
  async create(input: CustomerInput): Promise<RestResponse<Customer>> {
    return this.client.post({
      path: 'customers',
      data: input,
    })
  }

  /**
   * Update a customer
   */
  async update(customerId: number, input: CustomerInput): Promise<RestResponse<Customer>> {
    return this.client.put({
      path: `customers/${customerId}`,
      data: input,
    })
  }

  /**
   * Delete a customer
   */
  async delete(
    customerId: number,
    options?: { force?: boolean; reassign?: number }
  ): Promise<RestResponse<Customer>> {
    return this.client.delete({
      path: `customers/${customerId}`,
      query: options,
    })
  }

  /**
   * Batch create/update/delete customers
   */
  async batch(input: BatchInput<CustomerInput>): Promise<RestResponse<BatchResponse<Customer>>> {
    return this.client.post({
      path: 'customers/batch',
      data: input,
    })
  }

  /**
   * Format query parameters
   */
  private formatParams(
    params?: CustomerListParams
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
// Customer Downloads Resource
// =============================================================================

/**
 * Customer downloads resource for WooCommerce REST API
 */
export class CustomerDownloadsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all downloads for a customer
   */
  async list(customerId: number): Promise<RestResponse<CustomerDownload[]>> {
    return this.client.get({
      path: `customers/${customerId}/downloads`,
    })
  }
}
