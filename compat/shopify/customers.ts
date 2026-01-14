/**
 * @dotdo/shopify - Customers Resource
 *
 * Shopify Admin API compatible customer operations including:
 * - Customers CRUD
 * - Addresses management
 * - Customer search and filtering
 * - Tags and segments
 * - Account activation/deactivation
 * - Marketing consent handling
 * - Metafields
 * - Customer saved searches
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
import type { MetafieldInput } from './products'

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
  sms_marketing_consent?: SmsMarketingConsentInput
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
  state?: 'enabled' | 'disabled'
  sms_marketing_consent?: SmsMarketingConsentInput
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

// Re-export MetafieldInput for backwards compatibility
export type { MetafieldInput } from './products'

/**
 * SMS marketing consent input
 */
export interface SmsMarketingConsentInput {
  state: 'subscribed' | 'unsubscribed' | 'pending' | 'redacted' | 'not_subscribed'
  opt_in_level?: 'single_opt_in' | 'confirmed_opt_in' | 'unknown'
}

/**
 * SMS marketing consent
 */
export interface SmsMarketingConsent {
  state: 'subscribed' | 'unsubscribed' | 'pending' | 'redacted' | 'not_subscribed'
  opt_in_level: 'single_opt_in' | 'confirmed_opt_in' | 'unknown' | null
  consent_updated_at: string | null
  consent_collected_from: 'SHOPIFY' | 'CUSTOMER' | 'OTHER' | null
}

/**
 * Customer invite input
 */
export interface CustomerInviteInput {
  to?: string
  from?: string
  subject?: string
  custom_message?: string
  bcc?: string[]
}

/**
 * Customer invite response
 */
export interface CustomerInvite {
  to: string
  from: string
  subject: string
  custom_message: string
  bcc: string[]
}

/**
 * Customer metafield
 */
export interface CustomerMetafield {
  id: number
  namespace: string
  key: string
  value: string
  type: string
  owner_id: number
  owner_resource: 'customer'
  created_at: string
  updated_at: string
}

/**
 * Customer saved search (segment)
 */
export interface CustomerSavedSearch {
  id: number
  name: string
  query: string
  created_at: string
  updated_at: string
}

/**
 * Customer saved search input
 */
export interface CustomerSavedSearchInput {
  name: string
  query: string
}

// =============================================================================
// Metafields Resource
// =============================================================================

/**
 * Metafields resource for customer metafields
 */
export class CustomerMetafieldsResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all metafields for a customer
   */
  async list(customerId: number, params?: {
    limit?: number
    since_id?: number
    namespace?: string
    key?: string
    type?: string
  }): Promise<RestResponse<{ metafields: CustomerMetafield[] }>> {
    return this.client.get({
      path: `customers/${customerId}/metafields`,
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get a single metafield
   */
  async get(customerId: number, metafieldId: number): Promise<RestResponse<{ metafield: CustomerMetafield }>> {
    return this.client.get({
      path: `customers/${customerId}/metafields/${metafieldId}`,
    })
  }

  /**
   * Create a metafield for a customer
   */
  async create(customerId: number, input: MetafieldInput): Promise<RestResponse<{ metafield: CustomerMetafield }>> {
    return this.client.post({
      path: `customers/${customerId}/metafields`,
      data: { metafield: input },
    })
  }

  /**
   * Update a metafield
   */
  async update(customerId: number, metafieldId: number, input: Partial<MetafieldInput>): Promise<RestResponse<{ metafield: CustomerMetafield }>> {
    return this.client.put({
      path: `customers/${customerId}/metafields/${metafieldId}`,
      data: { metafield: input },
    })
  }

  /**
   * Delete a metafield
   */
  async delete(customerId: number, metafieldId: number): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: `customers/${customerId}/metafields/${metafieldId}`,
    })
  }

  /**
   * Count metafields for a customer
   */
  async count(customerId: number): Promise<RestResponse<{ count: number }>> {
    return this.client.get({
      path: `customers/${customerId}/metafields/count`,
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

// =============================================================================
// Customer Saved Searches Resource
// =============================================================================

/**
 * Customer saved searches (segments) resource
 */
export class CustomerSavedSearchesResource {
  private client: RestClient

  constructor(client: RestClient) {
    this.client = client
  }

  /**
   * List all customer saved searches
   */
  async list(params?: {
    limit?: number
    since_id?: number
    fields?: string
  }): Promise<RestResponse<{ customer_saved_searches: CustomerSavedSearch[] }>> {
    return this.client.get({
      path: 'customer_saved_searches',
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Get a single customer saved search
   */
  async get(savedSearchId: number, params?: { fields?: string }): Promise<RestResponse<{ customer_saved_search: CustomerSavedSearch }>> {
    return this.client.get({
      path: `customer_saved_searches/${savedSearchId}`,
      query: params,
    })
  }

  /**
   * Create a customer saved search
   */
  async create(input: CustomerSavedSearchInput): Promise<RestResponse<{ customer_saved_search: CustomerSavedSearch }>> {
    return this.client.post({
      path: 'customer_saved_searches',
      data: { customer_saved_search: input },
    })
  }

  /**
   * Update a customer saved search
   */
  async update(savedSearchId: number, input: Partial<CustomerSavedSearchInput>): Promise<RestResponse<{ customer_saved_search: CustomerSavedSearch }>> {
    return this.client.put({
      path: `customer_saved_searches/${savedSearchId}`,
      data: { customer_saved_search: input },
    })
  }

  /**
   * Delete a customer saved search
   */
  async delete(savedSearchId: number): Promise<RestResponse<Record<string, never>>> {
    return this.client.delete({
      path: `customer_saved_searches/${savedSearchId}`,
    })
  }

  /**
   * Count customer saved searches
   */
  async count(params?: {
    since_id?: number
  }): Promise<RestResponse<{ count: number }>> {
    return this.client.get({
      path: 'customer_saved_searches/count',
      query: params,
    })
  }

  /**
   * Get customers matching a saved search
   */
  async customers(savedSearchId: number, params?: {
    limit?: number
    order?: string
    fields?: string
  }): Promise<RestResponse<{ customers: Customer[] }>> {
    return this.client.get({
      path: `customer_saved_searches/${savedSearchId}/customers`,
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }
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
  /** Metafields sub-resource */
  metafields: CustomerMetafieldsResource

  constructor(client: RestClient) {
    this.client = client
    this.addresses = new AddressesResource(client)
    this.metafields = new CustomerMetafieldsResource(client)
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
    limit?: number
    since_id?: number
    created_at_min?: string
    created_at_max?: string
    updated_at_min?: string
    updated_at_max?: string
    processed_at_min?: string
    processed_at_max?: string
    financial_status?: 'pending' | 'authorized' | 'partially_paid' | 'paid' | 'partially_refunded' | 'refunded' | 'voided' | 'any'
    fulfillment_status?: 'shipped' | 'partial' | 'unshipped' | 'any' | 'unfulfilled'
  }): Promise<RestResponse<{ orders: Order[] }>> {
    return this.client.get({
      path: `customers/${customerId}/orders`,
      query: params as Record<string, string | number | boolean | undefined>,
    })
  }

  /**
   * Send an account invite
   */
  async sendInvite(customerId: number, input?: CustomerInviteInput): Promise<RestResponse<{ customer_invite: CustomerInvite }>> {
    return this.client.post({
      path: `customers/${customerId}/send_invite`,
      data: { customer_invite: input ?? {} },
    })
  }

  /**
   * Generate account activation URL
   * Returns a URL that can be used to activate a customer account
   */
  async accountActivationUrl(customerId: number): Promise<RestResponse<{ account_activation_url: string }>> {
    return this.client.post({
      path: `customers/${customerId}/account_activation_url`,
      data: {},
    })
  }

  /**
   * Trigger password reset for a customer
   * Sends a password reset email to the customer
   */
  async sendPasswordReset(customerId: number): Promise<RestResponse<{ customer: Customer }>> {
    return this.client.post({
      path: `customers/${customerId}/password_reset`,
      data: {},
    })
  }

  /**
   * Disable a customer account
   * Prevents the customer from logging in
   */
  async disable(customerId: number): Promise<RestResponse<{ customer: Customer }>> {
    return this.update(customerId, { state: 'disabled' })
  }

  /**
   * Enable a customer account
   * Allows the customer to log in again
   */
  async enable(customerId: number): Promise<RestResponse<{ customer: Customer }>> {
    return this.update(customerId, { state: 'enabled' })
  }

  /**
   * Update marketing consent for a customer
   */
  async updateMarketingConsent(customerId: number, accepts_marketing: boolean, opt_in_level?: 'single_opt_in' | 'confirmed_opt_in' | 'unknown'): Promise<RestResponse<{ customer: Customer }>> {
    return this.update(customerId, {
      accepts_marketing,
      marketing_opt_in_level: opt_in_level,
    })
  }

  /**
   * Update SMS marketing consent for a customer
   */
  async updateSmsMarketingConsent(customerId: number, consent: SmsMarketingConsentInput): Promise<RestResponse<{ customer: Customer }>> {
    return this.update(customerId, {
      sms_marketing_consent: consent,
    })
  }

  /**
   * Add tags to a customer
   */
  async addTags(customerId: number, tags: string[]): Promise<RestResponse<{ customer: Customer }>> {
    // First get the current customer to retrieve existing tags
    const { body } = await this.get(customerId)
    const existingTags = body.customer.tags ? body.customer.tags.split(', ') : []
    const allTags = Array.from(new Set([...existingTags, ...tags]))
    return this.update(customerId, { tags: allTags.join(', ') })
  }

  /**
   * Remove tags from a customer
   */
  async removeTags(customerId: number, tagsToRemove: string[]): Promise<RestResponse<{ customer: Customer }>> {
    // First get the current customer to retrieve existing tags
    const { body } = await this.get(customerId)
    const existingTags = body.customer.tags ? body.customer.tags.split(', ') : []
    const remainingTags = existingTags.filter(tag => !tagsToRemove.includes(tag.trim()))
    return this.update(customerId, { tags: remainingTags.join(', ') })
  }

  /**
   * Set tax exemptions for a customer
   */
  async setTaxExemptions(customerId: number, taxExempt: boolean, exemptions?: string[]): Promise<RestResponse<{ customer: Customer }>> {
    return this.update(customerId, {
      tax_exempt: taxExempt,
      tax_exemptions: exemptions,
    })
  }
}

// =============================================================================
// Extended Customer Type with SMS Marketing
// =============================================================================

/**
 * Extended customer type with SMS marketing consent
 */
export interface CustomerWithSmsConsent extends Customer {
  sms_marketing_consent?: SmsMarketingConsent
}
