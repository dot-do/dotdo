/**
 * Stripe Customers Resource - Local Implementation
 *
 * Uses TemporalStore for time-travel queries and historical customer state.
 * Supports all standard CRUD operations plus search.
 */

import { createTemporalStore, type TemporalStore } from '../../../../db/primitives/temporal-store'
import type {
  Customer,
  CustomerCreateParams,
  CustomerUpdateParams,
  CustomerListParams,
  DeletedCustomer,
  ListResponse,
  Metadata,
} from '../types'

export interface CustomersResourceOptions {
  /** Emit webhook events */
  onEvent?: (type: string, data: unknown) => void
}

/**
 * Local Customers Resource implementation
 * Uses TemporalStore for time-aware customer state management
 */
export class LocalCustomersResource {
  private store: TemporalStore<Customer>
  private deletedCustomers: Set<string> = new Set()
  private onEvent?: (type: string, data: unknown) => void

  constructor(options?: CustomersResourceOptions) {
    this.store = createTemporalStore<Customer>({
      enableTTL: false,
      retention: { maxVersions: 100 }, // Keep last 100 versions per customer
    })
    this.onEvent = options?.onEvent
  }

  /**
   * Generate a customer ID
   */
  private generateId(): string {
    return `cus_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`
  }

  /**
   * Create a new customer
   */
  async create(params: CustomerCreateParams): Promise<Customer> {
    const now = Math.floor(Date.now() / 1000)
    const id = this.generateId()

    const customer: Customer = {
      id,
      object: 'customer',
      address: params.address ?? null,
      balance: params.balance ?? 0,
      created: now,
      currency: null,
      default_source: params.source ?? null,
      delinquent: false,
      description: params.description ?? null,
      discount: null,
      email: params.email ?? null,
      invoice_prefix: id.substring(4, 12).toUpperCase(),
      invoice_settings: {
        custom_fields: null,
        default_payment_method: params.payment_method ?? null,
        footer: null,
        rendering_options: null,
      },
      livemode: false,
      metadata: params.metadata ?? {},
      name: params.name ?? null,
      phone: params.phone ?? null,
      preferred_locales: params.preferred_locales ?? [],
      shipping: params.shipping ?? null,
      tax_exempt: params.tax_exempt ?? 'none',
      test_clock: null,
    }

    await this.store.put(id, customer, Date.now())
    this.emitEvent('customer.created', customer)
    return customer
  }

  /**
   * Retrieve a customer by ID
   */
  async retrieve(id: string): Promise<Customer> {
    if (this.deletedCustomers.has(id)) {
      throw this.createError('resource_missing', `No such customer: '${id}'`, 'id')
    }

    const customer = await this.store.get(id)
    if (!customer) {
      throw this.createError('resource_missing', `No such customer: '${id}'`, 'id')
    }
    return customer
  }

  /**
   * Retrieve a customer as of a specific timestamp
   * (Time-travel query using TemporalStore)
   */
  async retrieveAsOf(id: string, timestamp: number): Promise<Customer | null> {
    return this.store.getAsOf(id, timestamp)
  }

  /**
   * Update a customer
   */
  async update(id: string, params: CustomerUpdateParams): Promise<Customer> {
    const existing = await this.retrieve(id)

    const updated: Customer = {
      ...existing,
      address: params.address === '' ? null : (params.address ?? existing.address),
      balance: params.balance ?? existing.balance,
      description: params.description === '' ? null : (params.description ?? existing.description),
      email: params.email === '' ? null : (params.email ?? existing.email),
      metadata: params.metadata === '' ? {} : (params.metadata ?? existing.metadata),
      name: params.name === '' ? null : (params.name ?? existing.name),
      phone: params.phone === '' ? null : (params.phone ?? existing.phone),
      preferred_locales: params.preferred_locales ?? existing.preferred_locales,
      shipping: params.shipping === '' ? null : (params.shipping ?? existing.shipping),
      tax_exempt: params.tax_exempt === '' ? 'none' : (params.tax_exempt ?? existing.tax_exempt),
      default_source: params.default_source ?? existing.default_source,
      invoice_settings: params.invoice_settings ?? existing.invoice_settings,
    }

    await this.store.put(id, updated, Date.now())
    this.emitEvent('customer.updated', updated)
    return updated
  }

  /**
   * Delete a customer
   */
  async del(id: string): Promise<DeletedCustomer> {
    // Verify customer exists
    await this.retrieve(id)

    // Mark as deleted
    this.deletedCustomers.add(id)

    const response: DeletedCustomer = {
      id,
      object: 'customer',
      deleted: true,
    }

    this.emitEvent('customer.deleted', response)
    return response
  }

  /**
   * List customers with optional filtering
   */
  async list(params?: CustomerListParams): Promise<ListResponse<Customer>> {
    const limit = Math.min(params?.limit ?? 10, 100)
    const customers: Customer[] = []

    // Collect all customers from store
    const allCustomers: Customer[] = []
    const iterator = this.store.range('cus_', {})

    let result = await iterator.next()
    while (!result.done) {
      const customer = result.value
      if (!this.deletedCustomers.has(customer.id)) {
        // Apply filters
        if (params?.email && customer.email !== params.email) {
          result = await iterator.next()
          continue
        }
        if (params?.created) {
          if (params.created.gt !== undefined && customer.created <= params.created.gt) {
            result = await iterator.next()
            continue
          }
          if (params.created.gte !== undefined && customer.created < params.created.gte) {
            result = await iterator.next()
            continue
          }
          if (params.created.lt !== undefined && customer.created >= params.created.lt) {
            result = await iterator.next()
            continue
          }
          if (params.created.lte !== undefined && customer.created > params.created.lte) {
            result = await iterator.next()
            continue
          }
        }
        allCustomers.push(customer)
      }
      result = await iterator.next()
    }

    // Sort by created (descending by default)
    allCustomers.sort((a, b) => b.created - a.created)

    // Apply cursor pagination
    let startIndex = 0
    if (params?.starting_after) {
      const idx = allCustomers.findIndex((c) => c.id === params.starting_after)
      if (idx !== -1) {
        startIndex = idx + 1
      }
    } else if (params?.ending_before) {
      const idx = allCustomers.findIndex((c) => c.id === params.ending_before)
      if (idx !== -1) {
        startIndex = Math.max(0, idx - limit)
      }
    }

    // Get page
    const page = allCustomers.slice(startIndex, startIndex + limit)

    return {
      object: 'list',
      data: page,
      has_more: startIndex + limit < allCustomers.length,
      url: '/v1/customers',
    }
  }

  /**
   * Search for customers using Stripe's search syntax
   */
  async search(params: {
    query: string
    limit?: number
    page?: string
  }): Promise<{ data: Customer[]; has_more: boolean; next_page?: string }> {
    const limit = Math.min(params.limit ?? 10, 100)
    const allCustomers: Customer[] = []

    // Collect all non-deleted customers
    const iterator = this.store.range('cus_', {})
    let result = await iterator.next()
    while (!result.done) {
      const customer = result.value
      if (!this.deletedCustomers.has(customer.id)) {
        // Simple query parsing (supports email:"value" and name:"value")
        const emailMatch = params.query.match(/email:"([^"]+)"/)
        const nameMatch = params.query.match(/name:"([^"]+)"/)

        let matches = true
        if (emailMatch && customer.email !== emailMatch[1]) {
          matches = false
        }
        if (nameMatch && customer.name !== nameMatch[1]) {
          matches = false
        }

        if (matches) {
          allCustomers.push(customer)
        }
      }
      result = await iterator.next()
    }

    // Simple pagination
    const page = allCustomers.slice(0, limit)

    return {
      data: page,
      has_more: allCustomers.length > limit,
      next_page: allCustomers.length > limit ? 'next' : undefined,
    }
  }

  /**
   * Create a snapshot of customer state (for testing/debugging)
   */
  async snapshot(): Promise<string> {
    return this.store.snapshot()
  }

  /**
   * Restore from a snapshot
   */
  async restoreSnapshot(id: string): Promise<void> {
    return this.store.restoreSnapshot(id)
  }

  /**
   * Emit a webhook event
   */
  private emitEvent(type: string, data: unknown): void {
    if (this.onEvent) {
      this.onEvent(type, data)
    }
  }

  /**
   * Create a Stripe-style error
   */
  private createError(code: string, message: string, param?: string): Error {
    const error = new Error(message) as Error & {
      type: string
      code: string
      param?: string
    }
    error.type = 'invalid_request_error'
    error.code = code
    error.param = param
    return error
  }
}
