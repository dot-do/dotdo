/**
 * @dotdo/shopify - Customers Resource
 *
 * Shopify Admin API compatible customer operations including:
 * - Customers CRUD
 * - Addresses management
 * - Customer search
 *
 * @module @dotdo/shopify/customers
 */

import type { RestClient } from './client'
import type {
  Customer,
  CustomerAddress,
  Order,
  RestResponse,
} from './types'

// =============================================================================
// Customer Input Types
// =============================================================================

/**
 * Input for creating a customer
 */
export interface CustomerInput {
  email?: string
  first_name?: string
  last_name?: string
  phone?: string
  verified_email?: boolean
  accepts_marketing?: boolean
  accepts_marketing_updated_at?: string
  marketing_opt_in_level?: 'single_opt_in' | 'confirmed_opt_in' | 'unknown'
  note?: string
  tags?: string
  tax_exempt?: boolean
  tax_exemptions?: string[]
  addresses?: AddressInput[]
  send_email_invite?: boolean
  send_email_welcome?: boolean
  password?: string
  password_confirmation?: string
  metafields?: MetafieldInput[]
}

/**
 * Input for updating a customer
 */
export interface CustomerUpdateInput {
  email?: string
  first_name?: string
  last_name?: string
  phone?: string
  verified_email?: boolean
  accepts_marketing?: boolean
  accepts_marketing_updated_at?: string
  marketing_opt_in_level?: 'single_opt_in' | 'confirmed_opt_in' | 'unknown'
  note?: string
  tags?: string
  tax_exempt?: boolean
  tax_exemptions?: string[]
  addresses?: AddressInput[]
  metafields?: MetafieldInput[]
}

/**
 * Input for creating/updating an address
 */
export interface AddressInput {
  id?: number
  first_name?: string
  last_name?: string
  company?: string
  address1?: string
  address2?: string
  city?: string
  province?: string
  province_code?: string
  country?: string
  country_code?: string
  zip?: string
  phone?: string
  default?: boolean
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
// Customers Resource
// =============================================================================

/**
 * Customers resource for Shopify Admin API
 */
export class CustomersResource {
  private client: RestClient

  /** Addresses sub-resource */
  addresses: AddressesResource

  constructor(client: RestClient) {
    this.client = client
    this.addresses = new AddressesResource(client)
  }

  /**
   * List all customers
   */
  async list(params?: {
    limit?: number
    since_id?: number
    created_at_min?: string
    created_at_max?: string
    updated_at_min?: string
    updated_at_max?: string
    ids?: string
    fields?: string
  }): Promise<RestResponse<{ customers: Customer[] }>> {
    return this.client.get({
      path: 'customers',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Search customers
   */
  async search(params: {
    query: string
    limit?: number
    order?: string
    fields?: string
  }): Promise<RestResponse<{ customers: Customer[] }>> {
    return this.client.get({
      path: 'customers/search',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get a single customer
   */
  async get(customerId: number, params?: { fields?: string }): Promise<RestResponse<{ customer: Customer }>> {
    return this.client.get({
      path: `customers/${customerId}`,
      query: params,
    })
  }

  /**
   * Create a customer
   */
  async create(input: CustomerInput): Promise<RestResponse<{ customer: Customer }>> {
    return this.client.post({
      path: 'customers',
      data: { customer: input },
    })
  }

  /**
   * Update a customer
   */
  async update(customerId: number, input: CustomerUpdateInput): Promise<RestResponse<{ customer: Customer }>> {
    return this.client.put({
      path: `customers/${customerId}`,
      data: { customer: input },
    })
  }

  /**
   * Delete a customer
   */
  async delete(customerId: number): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: `customers/${customerId}`,
    })
  }

  /**
   * Count customers
   */
  async count(params?: {
    created_at_min?: string
    created_at_max?: string
    updated_at_min?: string
    updated_at_max?: string
  }): Promise<RestResponse<{ count: number }>> {
    return this.client.get({
      path: 'customers/count',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get customer orders
   */
  async orders(customerId: number, params?: {
    status?: 'open' | 'closed' | 'cancelled' | 'any'
  }): Promise<RestResponse<{ orders: Order[] }>> {
    return this.client.get({
      path: `customers/${customerId}/orders`,
      query: params,
    })
  }

  /**
   * Send an account invite
   */
  async sendInvite(customerId: number, input?: {
    to?: string
    from?: string
    subject?: string
    custom_message?: string
    bcc?: string[]
  }): Promise<RestResponse<{ customer_invite: { to: string; from: string; subject: string; custom_message: string; bcc: string[] } }>> {
    return this.client.post({
      path: `customers/${customerId}/send_invite`,
      data: { customer_invite: input ?? {} },
    })
  }
}

// =============================================================================
// Addresses Resource
// =============================================================================

/**
 * Addresses resource for Shopify Admin API
 */
export class AddressesResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all addresses for a customer
   */
  async list(customerId: number, params?: {
    limit?: number
  }): Promise<RestResponse<{ addresses: CustomerAddress[] }>> {
    return this.client.get({
      path: `customers/${customerId}/addresses`,
      query: params,
    })
  }

  /**
   * Get a customer address
   */
  async get(customerId: number, addressId: number): Promise<RestResponse<{ customer_address: CustomerAddress }>> {
    return this.client.get({
      path: `customers/${customerId}/addresses/${addressId}`,
    })
  }

  /**
   * Create a customer address
   */
  async create(customerId: number, input: AddressInput): Promise<RestResponse<{ customer_address: CustomerAddress }>> {
    return this.client.post({
      path: `customers/${customerId}/addresses`,
      data: { address: input },
    })
  }

  /**
   * Update a customer address
   */
  async update(customerId: number, addressId: number, input: AddressInput): Promise<RestResponse<{ customer_address: CustomerAddress }>> {
    return this.client.put({
      path: `customers/${customerId}/addresses/${addressId}`,
      data: { address: input },
    })
  }

  /**
   * Delete a customer address
   */
  async delete(customerId: number, addressId: number): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: `customers/${customerId}/addresses/${addressId}`,
    })
  }

  /**
   * Set an address as default
   */
  async setDefault(customerId: number, addressId: number): Promise<RestResponse<{ customer_address: CustomerAddress }>> {
    return this.client.put({
      path: `customers/${customerId}/addresses/${addressId}/default`,
      data: {},
    })
  }

  /**
   * Bulk delete addresses
   */
  async bulkDelete(customerId: number, addressIds: number[]): Promise<RestResponse<Record<string, never>>> {
    const idsParam = addressIds.join(',')
    return this.client.put({
      path: `customers/${customerId}/addresses/set`,
      query: { 'address_ids[]': idsParam, operation: 'destroy' },
      data: {},
    })
  }
}
