/**
 * @dotdo/woocommerce/local - WooCommerce Local/Edge Implementation
 *
 * Durable Object-backed implementation of WooCommerce REST API using dotdo primitives.
 * Provides local storage for all WooCommerce resources without requiring WordPress connection.
 *
 * Features:
 * - Full Orders CRUD with line items, notes, and refunds
 * - Customer management with addresses and downloads
 * - Coupon operations with usage restrictions
 * - Tax rates and tax classes
 * - Shipping zones and methods
 * - Batch operations for all resources
 * - Full-text search
 *
 * @example
 * ```typescript
 * import { WooCommerceLocal } from '@dotdo/woocommerce/local'
 *
 * const wc = new WooCommerceLocal()
 *
 * // Create a customer (stored locally)
 * const customer = await wc.customers.create({
 *   email: 'user@example.com',
 *   first_name: 'John',
 *   last_name: 'Doe',
 * })
 *
 * // Create an order
 * const order = await wc.orders.create({
 *   customer_id: customer.id,
 *   line_items: [{ product_id: 1, quantity: 2 }],
 * })
 * ```
 *
 * @module @dotdo/woocommerce/local
 */

import type {
  Order,
  OrderStatus,
  OrderAddress,
  OrderLineItem,
  OrderTaxLine,
  OrderShippingLine,
  OrderFeeLine,
  OrderCouponLine,
  OrderRefundRef,
  OrderNote,
  OrderRefund,
  RefundLineItem,
  OrderInput,
  OrderNoteInput,
  OrderRefundInput,
  OrderListParams,
  OrderNoteListParams,
  OrderRefundListParams,
} from './orders'

import type {
  Customer,
  CustomerAddress,
  CustomerDownload,
  CustomerInput,
  CustomerListParams,
} from './customers'

import type {
  Coupon,
  DiscountType,
  CouponInput,
  CouponListParams,
} from './coupons'

import type {
  TaxRate,
  TaxClass,
  TaxRateInput,
  TaxClassInput,
  TaxRateListParams,
} from './taxes'

import type {
  ShippingZone,
  ShippingZoneLocation,
  ShippingZoneMethod,
  ShippingMethodSetting,
  ShippingMethod,
  ShippingZoneInput,
  ShippingZoneLocationInput,
  ShippingZoneMethodInput,
} from './shipping'

import type { MetaData, BatchInput, BatchResponse } from './types'

// =============================================================================
// Storage Implementation
// =============================================================================

/**
 * In-memory storage implementation for local use
 */
export class InMemoryStorage {
  private data: Map<string, unknown> = new Map()

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async list(options?: { prefix?: string; limit?: number }): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>()
    let count = 0
    const limit = options?.limit ?? Infinity

    for (const [key, value] of this.data) {
      if (options?.prefix && !key.startsWith(options.prefix)) continue
      if (count >= limit) break
      result.set(key, value)
      count++
    }

    return result
  }

  clear(): void {
    this.data.clear()
  }
}

// =============================================================================
// Utilities
// =============================================================================

let idCounter = 0

function generateId(): number {
  return ++idCounter
}

function now(): string {
  return new Date().toISOString()
}

function nowGmt(): string {
  return new Date().toISOString()
}

function generateOrderKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let key = 'wc_order_'
  for (let i = 0; i < 13; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return key
}

function createDefaultAddress(): OrderAddress {
  return {
    first_name: '',
    last_name: '',
    company: '',
    address_1: '',
    address_2: '',
    city: '',
    state: '',
    postcode: '',
    country: '',
  }
}

function createDefaultCustomerAddress(): CustomerAddress {
  return {
    first_name: '',
    last_name: '',
    company: '',
    address_1: '',
    address_2: '',
    city: '',
    state: '',
    postcode: '',
    country: '',
  }
}

// =============================================================================
// Local Orders Resource
// =============================================================================

export class LocalOrdersResource {
  private storage: InMemoryStorage
  readonly notes: LocalOrderNotesResource
  readonly refunds: LocalOrderRefundsResource

  constructor(storage: InMemoryStorage) {
    this.storage = storage
    this.notes = new LocalOrderNotesResource(storage)
    this.refunds = new LocalOrderRefundsResource(storage)
  }

  async list(params?: OrderListParams): Promise<{ data: Order[]; total: number }> {
    const map = await this.storage.list({ prefix: 'orders:' })
    let orders: Order[] = []

    for (const [key, value] of map.entries()) {
      if (key.includes(':notes:') || key.includes(':refunds:')) continue
      orders.push(value as Order)
    }

    // Apply filters
    if (params?.status) {
      const statuses = Array.isArray(params.status) ? params.status : [params.status]
      orders = orders.filter((o) => statuses.includes(o.status))
    }

    if (params?.customer) {
      orders = orders.filter((o) => o.customer_id === params.customer)
    }

    if (params?.search) {
      const search = params.search.toLowerCase()
      orders = orders.filter(
        (o) =>
          o.number.toLowerCase().includes(search) ||
          o.billing.first_name.toLowerCase().includes(search) ||
          o.billing.last_name.toLowerCase().includes(search) ||
          o.billing.email?.toLowerCase().includes(search)
      )
    }

    if (params?.after) {
      const afterDate = new Date(params.after)
      orders = orders.filter((o) => new Date(o.date_created) > afterDate)
    }

    if (params?.before) {
      const beforeDate = new Date(params.before)
      orders = orders.filter((o) => new Date(o.date_created) < beforeDate)
    }

    // Sorting - use stable sort with ID as tiebreaker
    const orderby = params?.orderby ?? 'date'
    const direction = params?.order ?? 'desc'
    orders.sort((a, b) => {
      let cmp = 0
      switch (orderby) {
        case 'date':
          cmp = new Date(a.date_created).getTime() - new Date(b.date_created).getTime()
          // Stable sort: if dates are equal, sort by ID
          if (cmp === 0) cmp = a.id - b.id
          break
        case 'id':
          cmp = a.id - b.id
          break
        case 'title':
          cmp = a.number.localeCompare(b.number)
          // Stable sort: if titles are equal, sort by ID
          if (cmp === 0) cmp = a.id - b.id
          break
        default:
          cmp = a.id - b.id
      }
      return direction === 'desc' ? -cmp : cmp
    })

    // Pagination
    const total = orders.length
    const page = params?.page ?? 1
    const perPage = params?.per_page ?? 10
    const offset = params?.offset ?? (page - 1) * perPage
    orders = orders.slice(offset, offset + perPage)

    return { data: orders, total }
  }

  async get(orderId: number): Promise<Order> {
    const order = await this.storage.get<Order>(`orders:${orderId}`)
    if (!order) {
      throw new Error(`Order not found: ${orderId}`)
    }
    return order
  }

  async create(input: OrderInput): Promise<Order> {
    const id = generateId()
    const timestamp = now()
    const timestampGmt = nowGmt()

    // Calculate totals from line items
    let total = '0.00'
    let discountTotal = '0.00'
    let shippingTotal = '0.00'

    const lineItems: OrderLineItem[] = (input.line_items ?? []).map((item, idx) => ({
      id: generateId(),
      name: item.name ?? `Product ${item.product_id}`,
      product_id: item.product_id ?? 0,
      variation_id: item.variation_id ?? 0,
      quantity: item.quantity ?? 1,
      tax_class: item.tax_class ?? '',
      subtotal: item.subtotal ?? '0.00',
      subtotal_tax: '0.00',
      total: item.total ?? '0.00',
      total_tax: '0.00',
      taxes: [],
      meta_data: (item.meta_data ?? []).map((m, i) => ({ id: i + 1, key: m.key, value: m.value })),
      sku: '',
      price: parseFloat(item.total ?? '0.00') / (item.quantity ?? 1),
    }))

    // Sum up totals
    total = lineItems.reduce((sum, item) => sum + parseFloat(item.total), 0).toFixed(2)

    const shippingLines: OrderShippingLine[] = (input.shipping_lines ?? []).map((line) => ({
      id: generateId(),
      method_title: line.method_title ?? '',
      method_id: line.method_id ?? '',
      instance_id: line.instance_id ?? '',
      total: line.total ?? '0.00',
      total_tax: '0.00',
      taxes: [],
      meta_data: (line.meta_data ?? []).map((m, i) => ({ id: i + 1, key: m.key, value: m.value })),
    }))

    shippingTotal = shippingLines.reduce((sum, line) => sum + parseFloat(line.total), 0).toFixed(2)

    const feeLines: OrderFeeLine[] = (input.fee_lines ?? []).map((fee) => ({
      id: generateId(),
      name: fee.name ?? '',
      tax_class: fee.tax_class ?? '',
      tax_status: fee.tax_status ?? 'taxable',
      amount: fee.total ?? '0.00',
      total: fee.total ?? '0.00',
      total_tax: '0.00',
      taxes: [],
      meta_data: (fee.meta_data ?? []).map((m, i) => ({ id: i + 1, key: m.key, value: m.value })),
    }))

    const couponLines: OrderCouponLine[] = (input.coupon_lines ?? []).map((coupon) => ({
      id: generateId(),
      code: coupon.code ?? '',
      discount: '0.00',
      discount_tax: '0.00',
      meta_data: (coupon.meta_data ?? []).map((m, i) => ({ id: i + 1, key: m.key, value: m.value })),
    }))

    const order: Order = {
      id,
      parent_id: input.parent_id ?? 0,
      number: String(id),
      order_key: generateOrderKey(),
      created_via: 'rest-api',
      version: '9.0.0',
      status: input.status ?? 'pending',
      currency: input.currency ?? 'USD',
      date_created: timestamp,
      date_created_gmt: timestampGmt,
      date_modified: timestamp,
      date_modified_gmt: timestampGmt,
      discount_total: discountTotal,
      discount_tax: '0.00',
      shipping_total: shippingTotal,
      shipping_tax: '0.00',
      cart_tax: '0.00',
      total: (parseFloat(total) + parseFloat(shippingTotal)).toFixed(2),
      total_tax: '0.00',
      prices_include_tax: false,
      customer_id: input.customer_id ?? 0,
      customer_ip_address: '',
      customer_user_agent: '',
      customer_note: input.customer_note ?? '',
      billing: { ...createDefaultAddress(), ...input.billing },
      shipping: { ...createDefaultAddress(), ...input.shipping },
      payment_method: input.payment_method ?? '',
      payment_method_title: input.payment_method_title ?? '',
      transaction_id: input.transaction_id ?? '',
      date_paid: input.set_paid ? timestamp : null,
      date_paid_gmt: input.set_paid ? timestampGmt : null,
      date_completed: null,
      date_completed_gmt: null,
      cart_hash: '',
      meta_data: (input.meta_data ?? []).map((m, i) => ({ id: i + 1, key: m.key, value: m.value })),
      line_items: lineItems,
      tax_lines: [],
      shipping_lines: shippingLines,
      fee_lines: feeLines,
      coupon_lines: couponLines,
      refunds: [],
    }

    await this.storage.put(`orders:${id}`, order)
    return order
  }

  async update(orderId: number, input: OrderInput): Promise<Order> {
    const order = await this.get(orderId)
    const timestamp = now()
    const timestampGmt = nowGmt()

    // Omit line_items from input spread since they need separate handling
    const { line_items, shipping_lines, fee_lines, coupon_lines, ...inputRest } = input

    const updated: Order = {
      ...order,
      ...inputRest,
      date_modified: timestamp,
      date_modified_gmt: timestampGmt,
      billing: input.billing ? { ...order.billing, ...input.billing } : order.billing,
      shipping: input.shipping ? { ...order.shipping, ...input.shipping } : order.shipping,
      meta_data: input.meta_data
        ? input.meta_data.map((m, i) => ({ id: i + 1, key: m.key, value: m.value }))
        : order.meta_data,
      // Preserve existing line items unless explicitly updated (not implemented for simplicity)
      line_items: order.line_items,
      shipping_lines: order.shipping_lines,
      fee_lines: order.fee_lines,
      coupon_lines: order.coupon_lines,
    }

    // Handle status changes
    if (input.status === 'completed' && !order.date_completed) {
      updated.date_completed = timestamp
      updated.date_completed_gmt = timestampGmt
    }

    if (input.set_paid && !order.date_paid) {
      updated.date_paid = timestamp
      updated.date_paid_gmt = timestampGmt
    }

    await this.storage.put(`orders:${orderId}`, updated)
    return updated
  }

  async delete(orderId: number, options?: { force?: boolean }): Promise<Order> {
    const order = await this.get(orderId)

    if (options?.force) {
      await this.storage.delete(`orders:${orderId}`)
    } else {
      order.status = 'trash'
      await this.storage.put(`orders:${orderId}`, order)
    }

    return order
  }

  async batch(input: BatchInput<OrderInput>): Promise<BatchResponse<Order>> {
    const result: BatchResponse<Order> = {}

    if (input.create) {
      result.create = []
      for (const item of input.create) {
        const order = await this.create(item)
        result.create.push(order)
      }
    }

    if (input.update) {
      result.update = []
      for (const item of input.update) {
        const order = await this.update(item.id, item)
        result.update.push(order)
      }
    }

    if (input.delete) {
      result.delete = []
      for (const id of input.delete) {
        const order = await this.delete(id, { force: true })
        result.delete.push(order)
      }
    }

    return result
  }
}

// =============================================================================
// Local Order Notes Resource
// =============================================================================

export class LocalOrderNotesResource {
  private storage: InMemoryStorage

  constructor(storage: InMemoryStorage) {
    this.storage = storage
  }

  async list(orderId: number, params?: OrderNoteListParams): Promise<{ data: OrderNote[] }> {
    const map = await this.storage.list({ prefix: `orders:${orderId}:notes:` })
    let notes: OrderNote[] = Array.from(map.values()) as OrderNote[]

    if (params?.type === 'customer') {
      notes = notes.filter((n) => n.customer_note)
    } else if (params?.type === 'internal') {
      notes = notes.filter((n) => !n.customer_note)
    }

    notes.sort((a, b) => new Date(b.date_created).getTime() - new Date(a.date_created).getTime())

    return { data: notes }
  }

  async get(orderId: number, noteId: number): Promise<OrderNote> {
    const note = await this.storage.get<OrderNote>(`orders:${orderId}:notes:${noteId}`)
    if (!note) {
      throw new Error(`Order note not found: ${noteId}`)
    }
    return note
  }

  async create(orderId: number, input: OrderNoteInput): Promise<OrderNote> {
    const id = generateId()
    const timestamp = now()

    const note: OrderNote = {
      id,
      author: input.added_by_user ? 'User' : 'System',
      date_created: timestamp,
      date_created_gmt: nowGmt(),
      note: input.note,
      customer_note: input.customer_note ?? false,
    }

    await this.storage.put(`orders:${orderId}:notes:${id}`, note)
    return note
  }

  async delete(orderId: number, noteId: number, options?: { force?: boolean }): Promise<OrderNote> {
    const note = await this.get(orderId, noteId)
    await this.storage.delete(`orders:${orderId}:notes:${noteId}`)
    return note
  }
}

// =============================================================================
// Local Order Refunds Resource
// =============================================================================

export class LocalOrderRefundsResource {
  private storage: InMemoryStorage

  constructor(storage: InMemoryStorage) {
    this.storage = storage
  }

  async list(orderId: number, params?: OrderRefundListParams): Promise<{ data: OrderRefund[]; total: number }> {
    const map = await this.storage.list({ prefix: `orders:${orderId}:refunds:` })
    let refunds: OrderRefund[] = Array.from(map.values()) as OrderRefund[]

    // Sorting
    const direction = params?.order ?? 'desc'
    refunds.sort((a, b) => {
      const cmp = new Date(a.date_created).getTime() - new Date(b.date_created).getTime()
      return direction === 'desc' ? -cmp : cmp
    })

    const total = refunds.length
    const page = params?.page ?? 1
    const perPage = params?.per_page ?? 10
    const offset = params?.offset ?? (page - 1) * perPage
    refunds = refunds.slice(offset, offset + perPage)

    return { data: refunds, total }
  }

  async get(orderId: number, refundId: number): Promise<OrderRefund> {
    const refund = await this.storage.get<OrderRefund>(`orders:${orderId}:refunds:${refundId}`)
    if (!refund) {
      throw new Error(`Order refund not found: ${refundId}`)
    }
    return refund
  }

  async create(orderId: number, input: OrderRefundInput): Promise<OrderRefund> {
    const id = generateId()
    const timestamp = now()

    const lineItems: RefundLineItem[] = (input.line_items ?? []).map((item) => ({
      id: item.id,
      name: '',
      product_id: 0,
      variation_id: 0,
      quantity: item.quantity ?? 0,
      tax_class: '',
      subtotal: '0.00',
      subtotal_tax: '0.00',
      total: '0.00',
      total_tax: '0.00',
      taxes: [],
      meta_data: [],
      sku: '',
      price: 0,
      refund_total: item.refund_total ?? 0,
    }))

    const refund: OrderRefund = {
      id,
      date_created: timestamp,
      date_created_gmt: nowGmt(),
      amount: input.amount ?? '0.00',
      reason: input.reason ?? '',
      refunded_by: input.refunded_by ?? 0,
      refunded_payment: input.api_refund ?? false,
      meta_data: (input.meta_data ?? []).map((m, i) => ({ id: i + 1, key: m.key, value: m.value })),
      line_items: lineItems,
    }

    await this.storage.put(`orders:${orderId}:refunds:${id}`, refund)

    // Update order's refunds array
    const order = await this.storage.get<Order>(`orders:${orderId}`)
    if (order) {
      order.refunds.push({
        id,
        reason: refund.reason,
        total: `-${refund.amount}`,
      })
      await this.storage.put(`orders:${orderId}`, order)
    }

    return refund
  }

  async delete(orderId: number, refundId: number, options?: { force?: boolean }): Promise<OrderRefund> {
    const refund = await this.get(orderId, refundId)
    await this.storage.delete(`orders:${orderId}:refunds:${refundId}`)
    return refund
  }
}

// =============================================================================
// Local Customers Resource
// =============================================================================

export class LocalCustomersResource {
  private storage: InMemoryStorage
  readonly downloads: LocalCustomerDownloadsResource

  constructor(storage: InMemoryStorage) {
    this.storage = storage
    this.downloads = new LocalCustomerDownloadsResource(storage)
  }

  async list(params?: CustomerListParams): Promise<{ data: Customer[]; total: number }> {
    const map = await this.storage.list({ prefix: 'customers:' })
    let customers: Customer[] = []

    for (const [key, value] of map.entries()) {
      if (key.includes(':downloads:')) continue
      customers.push(value as Customer)
    }

    // Apply filters
    if (params?.email) {
      customers = customers.filter((c) => c.email === params.email)
    }

    if (params?.role && params.role !== 'all') {
      customers = customers.filter((c) => c.role === params.role)
    }

    if (params?.search) {
      const search = params.search.toLowerCase()
      customers = customers.filter(
        (c) =>
          c.email.toLowerCase().includes(search) ||
          c.first_name.toLowerCase().includes(search) ||
          c.last_name.toLowerCase().includes(search) ||
          c.username.toLowerCase().includes(search)
      )
    }

    // Sorting
    const orderby = params?.orderby ?? 'id'
    const direction = params?.order ?? 'desc'
    customers.sort((a, b) => {
      let cmp = 0
      switch (orderby) {
        case 'id':
          cmp = a.id - b.id
          break
        case 'name':
          cmp = `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)
          break
        case 'registered_date':
          cmp = new Date(a.date_created).getTime() - new Date(b.date_created).getTime()
          break
        default:
          cmp = a.id - b.id
      }
      return direction === 'desc' ? -cmp : cmp
    })

    // Pagination
    const total = customers.length
    const page = params?.page ?? 1
    const perPage = params?.per_page ?? 10
    const offset = params?.offset ?? (page - 1) * perPage
    customers = customers.slice(offset, offset + perPage)

    return { data: customers, total }
  }

  async get(customerId: number): Promise<Customer> {
    const customer = await this.storage.get<Customer>(`customers:${customerId}`)
    if (!customer) {
      throw new Error(`Customer not found: ${customerId}`)
    }
    return customer
  }

  async create(input: CustomerInput): Promise<Customer> {
    const id = generateId()
    const timestamp = now()
    const timestampGmt = nowGmt()

    // Check for duplicate email
    if (input.email) {
      const existing = await this.list({ email: input.email })
      if (existing.data.length > 0) {
        throw new Error(`A customer with email ${input.email} already exists`)
      }
    }

    const customer: Customer = {
      id,
      date_created: timestamp,
      date_created_gmt: timestampGmt,
      date_modified: timestamp,
      date_modified_gmt: timestampGmt,
      email: input.email ?? '',
      first_name: input.first_name ?? '',
      last_name: input.last_name ?? '',
      role: 'customer',
      username: input.username ?? input.email ?? `user_${id}`,
      billing: { ...createDefaultCustomerAddress(), ...input.billing },
      shipping: { ...createDefaultCustomerAddress(), ...input.shipping },
      is_paying_customer: false,
      avatar_url: '',
      meta_data: (input.meta_data ?? []).map((m, i) => ({ id: i + 1, key: m.key, value: m.value })),
    }

    await this.storage.put(`customers:${id}`, customer)
    return customer
  }

  async update(customerId: number, input: CustomerInput): Promise<Customer> {
    const customer = await this.get(customerId)
    const timestamp = now()
    const timestampGmt = nowGmt()

    const updated: Customer = {
      ...customer,
      ...input,
      date_modified: timestamp,
      date_modified_gmt: timestampGmt,
      billing: input.billing ? { ...customer.billing, ...input.billing } : customer.billing,
      shipping: input.shipping ? { ...customer.shipping, ...input.shipping } : customer.shipping,
      meta_data: input.meta_data
        ? input.meta_data.map((m, i) => ({ id: i + 1, key: m.key, value: m.value }))
        : customer.meta_data,
    }

    await this.storage.put(`customers:${customerId}`, updated)
    return updated
  }

  async delete(customerId: number, options?: { force?: boolean; reassign?: number }): Promise<Customer> {
    const customer = await this.get(customerId)
    await this.storage.delete(`customers:${customerId}`)
    return customer
  }

  async batch(input: BatchInput<CustomerInput>): Promise<BatchResponse<Customer>> {
    const result: BatchResponse<Customer> = {}

    if (input.create) {
      result.create = []
      for (const item of input.create) {
        const customer = await this.create(item)
        result.create.push(customer)
      }
    }

    if (input.update) {
      result.update = []
      for (const item of input.update) {
        const customer = await this.update(item.id, item)
        result.update.push(customer)
      }
    }

    if (input.delete) {
      result.delete = []
      for (const id of input.delete) {
        const customer = await this.delete(id, { force: true })
        result.delete.push(customer)
      }
    }

    return result
  }
}

// =============================================================================
// Local Customer Downloads Resource
// =============================================================================

export class LocalCustomerDownloadsResource {
  private storage: InMemoryStorage

  constructor(storage: InMemoryStorage) {
    this.storage = storage
  }

  async list(customerId: number): Promise<{ data: CustomerDownload[] }> {
    const map = await this.storage.list({ prefix: `customers:${customerId}:downloads:` })
    const downloads: CustomerDownload[] = Array.from(map.values()) as CustomerDownload[]
    return { data: downloads }
  }
}

// =============================================================================
// Local Coupons Resource
// =============================================================================

export class LocalCouponsResource {
  private storage: InMemoryStorage

  constructor(storage: InMemoryStorage) {
    this.storage = storage
  }

  async list(params?: CouponListParams): Promise<{ data: Coupon[]; total: number }> {
    const map = await this.storage.list({ prefix: 'coupons:' })
    let coupons: Coupon[] = Array.from(map.values()) as Coupon[]

    // Apply filters
    if (params?.code) {
      coupons = coupons.filter((c) => c.code.toLowerCase() === params.code!.toLowerCase())
    }

    if (params?.search) {
      const search = params.search.toLowerCase()
      coupons = coupons.filter(
        (c) => c.code.toLowerCase().includes(search) || c.description.toLowerCase().includes(search)
      )
    }

    if (params?.after) {
      const afterDate = new Date(params.after)
      coupons = coupons.filter((c) => new Date(c.date_created) > afterDate)
    }

    if (params?.before) {
      const beforeDate = new Date(params.before)
      coupons = coupons.filter((c) => new Date(c.date_created) < beforeDate)
    }

    // Sorting
    const orderby = params?.orderby ?? 'date'
    const direction = params?.order ?? 'desc'
    coupons.sort((a, b) => {
      let cmp = 0
      switch (orderby) {
        case 'date':
          cmp = new Date(a.date_created).getTime() - new Date(b.date_created).getTime()
          break
        case 'id':
          cmp = a.id - b.id
          break
        case 'title':
          cmp = a.code.localeCompare(b.code)
          break
        default:
          cmp = a.id - b.id
      }
      return direction === 'desc' ? -cmp : cmp
    })

    // Pagination
    const total = coupons.length
    const page = params?.page ?? 1
    const perPage = params?.per_page ?? 10
    const offset = params?.offset ?? (page - 1) * perPage
    coupons = coupons.slice(offset, offset + perPage)

    return { data: coupons, total }
  }

  async get(couponId: number): Promise<Coupon> {
    const coupon = await this.storage.get<Coupon>(`coupons:${couponId}`)
    if (!coupon) {
      throw new Error(`Coupon not found: ${couponId}`)
    }
    return coupon
  }

  async getByCode(code: string): Promise<Coupon | null> {
    const { data } = await this.list({ code })
    return data.length > 0 ? data[0] : null
  }

  async create(input: CouponInput): Promise<Coupon> {
    const id = generateId()
    const timestamp = now()
    const timestampGmt = nowGmt()

    // Check for duplicate code
    if (input.code) {
      const existing = await this.getByCode(input.code)
      if (existing) {
        throw new Error(`A coupon with code ${input.code} already exists`)
      }
    }

    const coupon: Coupon = {
      id,
      code: input.code ?? `COUPON${id}`,
      amount: input.amount ?? '0.00',
      date_created: timestamp,
      date_created_gmt: timestampGmt,
      date_modified: timestamp,
      date_modified_gmt: timestampGmt,
      discount_type: input.discount_type ?? 'fixed_cart',
      description: input.description ?? '',
      date_expires: input.date_expires ?? null,
      date_expires_gmt: input.date_expires_gmt ?? null,
      usage_count: 0,
      individual_use: input.individual_use ?? false,
      product_ids: input.product_ids ?? [],
      excluded_product_ids: input.excluded_product_ids ?? [],
      usage_limit: input.usage_limit ?? null,
      usage_limit_per_user: input.usage_limit_per_user ?? null,
      limit_usage_to_x_items: input.limit_usage_to_x_items ?? null,
      free_shipping: input.free_shipping ?? false,
      product_categories: input.product_categories ?? [],
      excluded_product_categories: input.excluded_product_categories ?? [],
      exclude_sale_items: input.exclude_sale_items ?? false,
      minimum_amount: input.minimum_amount ?? '',
      maximum_amount: input.maximum_amount ?? '',
      email_restrictions: input.email_restrictions ?? [],
      used_by: [],
      meta_data: (input.meta_data ?? []).map((m, i) => ({ id: i + 1, key: m.key, value: m.value })),
    }

    await this.storage.put(`coupons:${id}`, coupon)
    return coupon
  }

  async update(couponId: number, input: CouponInput): Promise<Coupon> {
    const coupon = await this.get(couponId)
    const timestamp = now()
    const timestampGmt = nowGmt()

    const updated: Coupon = {
      ...coupon,
      ...input,
      date_modified: timestamp,
      date_modified_gmt: timestampGmt,
      meta_data: input.meta_data
        ? input.meta_data.map((m, i) => ({ id: i + 1, key: m.key, value: m.value }))
        : coupon.meta_data,
    }

    await this.storage.put(`coupons:${couponId}`, updated)
    return updated
  }

  async delete(couponId: number, options?: { force?: boolean }): Promise<Coupon> {
    const coupon = await this.get(couponId)
    await this.storage.delete(`coupons:${couponId}`)
    return coupon
  }

  async batch(input: BatchInput<CouponInput>): Promise<BatchResponse<Coupon>> {
    const result: BatchResponse<Coupon> = {}

    if (input.create) {
      result.create = []
      for (const item of input.create) {
        const coupon = await this.create(item)
        result.create.push(coupon)
      }
    }

    if (input.update) {
      result.update = []
      for (const item of input.update) {
        const coupon = await this.update(item.id, item)
        result.update.push(coupon)
      }
    }

    if (input.delete) {
      result.delete = []
      for (const id of input.delete) {
        const coupon = await this.delete(id, { force: true })
        result.delete.push(coupon)
      }
    }

    return result
  }
}

// =============================================================================
// Local Tax Rates Resource
// =============================================================================

export class LocalTaxRatesResource {
  private storage: InMemoryStorage

  constructor(storage: InMemoryStorage) {
    this.storage = storage
  }

  async list(params?: TaxRateListParams): Promise<{ data: TaxRate[]; total: number }> {
    const map = await this.storage.list({ prefix: 'tax_rates:' })
    let rates: TaxRate[] = Array.from(map.values()) as TaxRate[]

    if (params?.class) {
      rates = rates.filter((r) => r.class === params.class)
    }

    // Sorting
    const orderby = params?.orderby ?? 'id'
    const direction = params?.order ?? 'asc'
    rates.sort((a, b) => {
      let cmp = 0
      switch (orderby) {
        case 'id':
          cmp = a.id - b.id
          break
        case 'order':
          cmp = a.order - b.order
          break
        case 'priority':
          cmp = a.priority - b.priority
          break
        default:
          cmp = a.id - b.id
      }
      return direction === 'desc' ? -cmp : cmp
    })

    // Pagination
    const total = rates.length
    const page = params?.page ?? 1
    const perPage = params?.per_page ?? 10
    const offset = params?.offset ?? (page - 1) * perPage
    rates = rates.slice(offset, offset + perPage)

    return { data: rates, total }
  }

  async get(taxRateId: number): Promise<TaxRate> {
    const rate = await this.storage.get<TaxRate>(`tax_rates:${taxRateId}`)
    if (!rate) {
      throw new Error(`Tax rate not found: ${taxRateId}`)
    }
    return rate
  }

  async create(input: TaxRateInput): Promise<TaxRate> {
    const id = generateId()

    const rate: TaxRate = {
      id,
      country: input.country ?? '',
      state: input.state ?? '',
      postcode: input.postcode ?? '',
      city: input.city ?? '',
      postcodes: input.postcodes ?? [],
      cities: input.cities ?? [],
      rate: input.rate ?? '0',
      name: input.name ?? '',
      priority: input.priority ?? 1,
      compound: input.compound ?? false,
      shipping: input.shipping ?? true,
      order: input.order ?? 0,
      class: input.class ?? 'standard',
    }

    await this.storage.put(`tax_rates:${id}`, rate)
    return rate
  }

  async update(taxRateId: number, input: TaxRateInput): Promise<TaxRate> {
    const rate = await this.get(taxRateId)

    const updated: TaxRate = {
      ...rate,
      ...input,
    }

    await this.storage.put(`tax_rates:${taxRateId}`, updated)
    return updated
  }

  async delete(taxRateId: number, options?: { force?: boolean }): Promise<TaxRate> {
    const rate = await this.get(taxRateId)
    await this.storage.delete(`tax_rates:${taxRateId}`)
    return rate
  }

  async batch(input: BatchInput<TaxRateInput>): Promise<BatchResponse<TaxRate>> {
    const result: BatchResponse<TaxRate> = {}

    if (input.create) {
      result.create = []
      for (const item of input.create) {
        const rate = await this.create(item)
        result.create.push(rate)
      }
    }

    if (input.update) {
      result.update = []
      for (const item of input.update) {
        const rate = await this.update(item.id, item)
        result.update.push(rate)
      }
    }

    if (input.delete) {
      result.delete = []
      for (const id of input.delete) {
        const rate = await this.delete(id, { force: true })
        result.delete.push(rate)
      }
    }

    return result
  }
}

// =============================================================================
// Local Tax Classes Resource
// =============================================================================

export class LocalTaxClassesResource {
  private storage: InMemoryStorage

  constructor(storage: InMemoryStorage) {
    this.storage = storage
    this.initDefaultClasses()
  }

  private async initDefaultClasses(): Promise<void> {
    const existing = await this.storage.get<TaxClass>('tax_classes:standard')
    if (!existing) {
      await this.storage.put('tax_classes:standard', { slug: 'standard', name: 'Standard rate' })
      await this.storage.put('tax_classes:reduced-rate', { slug: 'reduced-rate', name: 'Reduced rate' })
      await this.storage.put('tax_classes:zero-rate', { slug: 'zero-rate', name: 'Zero rate' })
    }
  }

  async list(): Promise<{ data: TaxClass[] }> {
    const map = await this.storage.list({ prefix: 'tax_classes:' })
    const classes: TaxClass[] = Array.from(map.values()) as TaxClass[]
    return { data: classes }
  }

  async create(input: TaxClassInput): Promise<TaxClass> {
    const slug = input.name.toLowerCase().replace(/\s+/g, '-')
    const taxClass: TaxClass = {
      slug,
      name: input.name,
    }

    await this.storage.put(`tax_classes:${slug}`, taxClass)
    return taxClass
  }

  async delete(slug: string, options?: { force?: boolean }): Promise<TaxClass> {
    const taxClass = await this.storage.get<TaxClass>(`tax_classes:${slug}`)
    if (!taxClass) {
      throw new Error(`Tax class not found: ${slug}`)
    }
    await this.storage.delete(`tax_classes:${slug}`)
    return taxClass
  }
}

// =============================================================================
// Local Shipping Zones Resource
// =============================================================================

export class LocalShippingZonesResource {
  private storage: InMemoryStorage
  readonly locations: LocalShippingZoneLocationsResource
  readonly methods: LocalShippingZoneMethodsResource

  constructor(storage: InMemoryStorage) {
    this.storage = storage
    this.locations = new LocalShippingZoneLocationsResource(storage)
    this.methods = new LocalShippingZoneMethodsResource(storage)
    this.initDefaultZone()
  }

  private async initDefaultZone(): Promise<void> {
    const existing = await this.storage.get<ShippingZone>('shipping_zones:0')
    if (!existing) {
      await this.storage.put('shipping_zones:0', {
        id: 0,
        name: 'Locations not covered by your other zones',
        order: 0,
      })
    }
  }

  async list(): Promise<{ data: ShippingZone[] }> {
    const map = await this.storage.list({ prefix: 'shipping_zones:' })
    const zones: ShippingZone[] = []

    for (const [key, value] of map.entries()) {
      if (key.includes(':locations:') || key.includes(':methods:')) continue
      zones.push(value as ShippingZone)
    }

    zones.sort((a, b) => a.order - b.order)
    return { data: zones }
  }

  async get(zoneId: number): Promise<ShippingZone> {
    const zone = await this.storage.get<ShippingZone>(`shipping_zones:${zoneId}`)
    if (!zone) {
      throw new Error(`Shipping zone not found: ${zoneId}`)
    }
    return zone
  }

  async create(input: ShippingZoneInput): Promise<ShippingZone> {
    const id = generateId()

    const zone: ShippingZone = {
      id,
      name: input.name ?? '',
      order: input.order ?? 0,
    }

    await this.storage.put(`shipping_zones:${id}`, zone)
    return zone
  }

  async update(zoneId: number, input: ShippingZoneInput): Promise<ShippingZone> {
    const zone = await this.get(zoneId)

    const updated: ShippingZone = {
      ...zone,
      ...input,
    }

    await this.storage.put(`shipping_zones:${zoneId}`, updated)
    return updated
  }

  async delete(zoneId: number, options?: { force?: boolean }): Promise<ShippingZone> {
    const zone = await this.get(zoneId)
    await this.storage.delete(`shipping_zones:${zoneId}`)
    return zone
  }
}

// =============================================================================
// Local Shipping Zone Locations Resource
// =============================================================================

export class LocalShippingZoneLocationsResource {
  private storage: InMemoryStorage

  constructor(storage: InMemoryStorage) {
    this.storage = storage
  }

  async list(zoneId: number): Promise<{ data: ShippingZoneLocation[] }> {
    const locations = await this.storage.get<ShippingZoneLocation[]>(
      `shipping_zones:${zoneId}:locations`
    )
    return { data: locations ?? [] }
  }

  async update(zoneId: number, locations: ShippingZoneLocationInput[]): Promise<{ data: ShippingZoneLocation[] }> {
    const newLocations: ShippingZoneLocation[] = locations.map((loc) => ({
      code: loc.code,
      type: loc.type,
    }))

    await this.storage.put(`shipping_zones:${zoneId}:locations`, newLocations)
    return { data: newLocations }
  }
}

// =============================================================================
// Local Shipping Zone Methods Resource
// =============================================================================

export class LocalShippingZoneMethodsResource {
  private storage: InMemoryStorage

  constructor(storage: InMemoryStorage) {
    this.storage = storage
  }

  async list(zoneId: number): Promise<{ data: ShippingZoneMethod[] }> {
    const map = await this.storage.list({ prefix: `shipping_zones:${zoneId}:methods:` })
    const methods: ShippingZoneMethod[] = Array.from(map.values()) as ShippingZoneMethod[]
    methods.sort((a, b) => a.order - b.order)
    return { data: methods }
  }

  async get(zoneId: number, instanceId: number): Promise<ShippingZoneMethod> {
    const method = await this.storage.get<ShippingZoneMethod>(
      `shipping_zones:${zoneId}:methods:${instanceId}`
    )
    if (!method) {
      throw new Error(`Shipping method not found: ${instanceId}`)
    }
    return method
  }

  async create(zoneId: number, input: ShippingZoneMethodInput): Promise<ShippingZoneMethod> {
    const instanceId = generateId()

    // Convert input settings (string values) to full ShippingMethodSetting objects
    const settings: Record<string, ShippingMethodSetting> = {}
    if (input.settings) {
      for (const [key, value] of Object.entries(input.settings)) {
        settings[key] = {
          id: key,
          label: key,
          description: '',
          type: 'text',
          value,
          default: '',
          tip: '',
          placeholder: '',
        }
      }
    }

    const method: ShippingZoneMethod = {
      instance_id: instanceId,
      title: input.title ?? '',
      order: input.order ?? 0,
      enabled: input.enabled ?? true,
      method_id: input.method_id ?? '',
      method_title: input.title ?? '',
      method_description: '',
      settings,
    }

    await this.storage.put(`shipping_zones:${zoneId}:methods:${instanceId}`, method)
    return method
  }

  async update(zoneId: number, instanceId: number, input: ShippingZoneMethodInput): Promise<ShippingZoneMethod> {
    const method = await this.get(zoneId, instanceId)

    // Update settings values while preserving structure
    const updatedSettings = { ...method.settings }
    if (input.settings) {
      for (const [key, value] of Object.entries(input.settings)) {
        if (updatedSettings[key]) {
          updatedSettings[key] = { ...updatedSettings[key], value }
        } else {
          updatedSettings[key] = {
            id: key,
            label: key,
            description: '',
            type: 'text',
            value,
            default: '',
            tip: '',
            placeholder: '',
          }
        }
      }
    }

    const updated: ShippingZoneMethod = {
      ...method,
      title: input.title ?? method.title,
      order: input.order ?? method.order,
      enabled: input.enabled ?? method.enabled,
      method_id: input.method_id ?? method.method_id,
      settings: updatedSettings,
    }

    await this.storage.put(`shipping_zones:${zoneId}:methods:${instanceId}`, updated)
    return updated
  }

  async delete(zoneId: number, instanceId: number, options?: { force?: boolean }): Promise<ShippingZoneMethod> {
    const method = await this.get(zoneId, instanceId)
    await this.storage.delete(`shipping_zones:${zoneId}:methods:${instanceId}`)
    return method
  }
}

// =============================================================================
// Local Shipping Methods Resource
// =============================================================================

export class LocalShippingMethodsResource {
  private storage: InMemoryStorage

  constructor(storage: InMemoryStorage) {
    this.storage = storage
    this.initDefaultMethods()
  }

  private async initDefaultMethods(): Promise<void> {
    const existing = await this.storage.get<ShippingMethod>('shipping_methods:flat_rate')
    if (!existing) {
      await this.storage.put('shipping_methods:flat_rate', {
        id: 'flat_rate',
        title: 'Flat rate',
        description: 'Lets you charge a fixed rate for shipping.',
      })
      await this.storage.put('shipping_methods:free_shipping', {
        id: 'free_shipping',
        title: 'Free shipping',
        description: 'Free shipping is a special method which can be triggered with coupons and minimum order amount.',
      })
      await this.storage.put('shipping_methods:local_pickup', {
        id: 'local_pickup',
        title: 'Local pickup',
        description: 'Allow customers to pick up orders themselves.',
      })
    }
  }

  async list(): Promise<{ data: ShippingMethod[] }> {
    const map = await this.storage.list({ prefix: 'shipping_methods:' })
    const methods: ShippingMethod[] = Array.from(map.values()) as ShippingMethod[]
    return { data: methods }
  }

  async get(methodId: string): Promise<ShippingMethod> {
    const method = await this.storage.get<ShippingMethod>(`shipping_methods:${methodId}`)
    if (!method) {
      throw new Error(`Shipping method not found: ${methodId}`)
    }
    return method
  }
}

// =============================================================================
// WooCommerceLocal Client
// =============================================================================

/**
 * Local WooCommerce implementation backed by in-memory storage
 *
 * Provides a fully functional WooCommerce-compatible REST API without requiring
 * a connection to WordPress/WooCommerce servers.
 */
export class WooCommerceLocal {
  private storage: InMemoryStorage

  readonly orders: LocalOrdersResource
  readonly customers: LocalCustomersResource
  readonly coupons: LocalCouponsResource
  readonly taxRates: LocalTaxRatesResource
  readonly taxClasses: LocalTaxClassesResource
  readonly shippingZones: LocalShippingZonesResource
  readonly shippingMethods: LocalShippingMethodsResource

  constructor(storage?: InMemoryStorage) {
    this.storage = storage ?? new InMemoryStorage()

    this.orders = new LocalOrdersResource(this.storage)
    this.customers = new LocalCustomersResource(this.storage)
    this.coupons = new LocalCouponsResource(this.storage)
    this.taxRates = new LocalTaxRatesResource(this.storage)
    this.taxClasses = new LocalTaxClassesResource(this.storage)
    this.shippingZones = new LocalShippingZonesResource(this.storage)
    this.shippingMethods = new LocalShippingMethodsResource(this.storage)
  }

  /**
   * Clear all data (for testing)
   */
  async clear(): Promise<void> {
    this.storage.clear()
    idCounter = 0
  }
}

// =============================================================================
// Export Default
// =============================================================================

export default WooCommerceLocal
