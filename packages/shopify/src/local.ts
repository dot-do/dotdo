/**
 * @dotdo/shopify - Local Shopify Implementation
 *
 * Drop-in replacement for Shopify SDK that runs entirely locally.
 * Perfect for:
 * - Testing without network calls
 * - Edge deployment (Cloudflare Workers)
 * - Development environments
 *
 * @example
 * ```typescript
 * import { ShopifyLocal } from '@dotdo/shopify/local'
 *
 * const shopify = new ShopifyLocal({
 *   shop: 'my-store.myshopify.com',
 *   accessToken: 'test-token',
 * })
 *
 * const product = await shopify.products.create({
 *   title: 'Test Product',
 *   vendor: 'Test Vendor',
 * })
 * ```
 */

import type {
  ShopifyLocalConfig,
  Product,
  ProductInput,
  ProductUpdateInput,
  ProductVariant,
  VariantInput,
  Order,
  OrderInput,
  OrderUpdateInput,
  OrderCancelInput,
  Fulfillment,
  FulfillmentInput,
  FulfillmentTrackingInput,
  Refund,
  RefundInput,
  RefundCalculateInput,
  Customer,
  CustomerInput,
  CustomerUpdateInput,
  CustomerAddress,
  AddressInput,
  Location,
  InventoryLevel,
  InventoryAdjustInput,
  InventorySetInput,
  ProductListResponse,
  OrderListResponse,
  CustomerListResponse,
  AddressListResponse,
  LocationListResponse,
  CountResponse,
  GraphqlQueryOptions,
  GraphqlResponse,
  WebhookValidateParams,
  LineItem,
} from './types'

// =============================================================================
// ID Generation
// =============================================================================

let idCounter = 1

function generateId(): number {
  return idCounter++
}

function generateGid(type: string, id: number): string {
  return `gid://shopify/${type}/${id}`
}

function generateHandle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// =============================================================================
// In-Memory Storage
// =============================================================================

interface Store {
  products: Map<number, Product>
  orders: Map<number, Order>
  customers: Map<number, Customer>
  locations: Map<number, Location>
  inventoryLevels: Map<string, InventoryLevel>
  fulfillments: Map<number, Fulfillment>
  refunds: Map<number, Refund>
}

function createStore(): Store {
  const store: Store = {
    products: new Map(),
    orders: new Map(),
    customers: new Map(),
    locations: new Map(),
    inventoryLevels: new Map(),
    fulfillments: new Map(),
    refunds: new Map(),
  }

  // Create a default location
  const defaultLocation: Location = {
    id: 1,
    name: 'Main Location',
    address1: '123 Main St',
    address2: null,
    city: 'Anytown',
    province: 'CA',
    country: 'US',
    zip: '12345',
    phone: null,
    country_code: 'US',
    country_name: 'United States',
    province_code: 'CA',
    legacy: false,
    active: true,
    admin_graphql_api_id: generateGid('Location', 1),
    localized_country_name: 'United States',
    localized_province_name: 'California',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  store.locations.set(1, defaultLocation)

  return store
}

// =============================================================================
// Products Resource
// =============================================================================

class LocalProductsResource {
  private store: Store
  readonly variants: LocalVariantsResource

  constructor(store: Store) {
    this.store = store
    this.variants = new LocalVariantsResource(store)
  }

  async create(input: ProductInput): Promise<Product> {
    const id = generateId()
    const now = new Date().toISOString()

    const variants: ProductVariant[] = (input.variants || [{ title: 'Default Title', price: '0.00' }]).map(
      (v, index) => this.createVariant(id, v, index)
    )

    const product: Product = {
      id,
      title: input.title,
      body_html: input.body_html ?? null,
      vendor: input.vendor ?? '',
      product_type: input.product_type ?? '',
      handle: input.handle ?? generateHandle(input.title),
      status: input.status ?? 'active',
      published_scope: 'global',
      tags: typeof input.tags === 'string' ? input.tags : (input.tags?.join(', ') ?? ''),
      template_suffix: input.template_suffix ?? null,
      created_at: now,
      updated_at: now,
      published_at: input.published !== false ? now : null,
      variants,
      options: input.options?.map((o, i) => ({
        id: generateId(),
        product_id: id,
        name: o.name,
        position: i + 1,
        values: [],
      })) ?? [{ id: generateId(), product_id: id, name: 'Title', position: 1, values: ['Default Title'] }],
      images: [],
      image: null,
      admin_graphql_api_id: generateGid('Product', id),
    }

    this.store.products.set(id, product)
    return product
  }

  private createVariant(productId: number, input: VariantInput, position: number): ProductVariant {
    const id = generateId()
    const inventoryItemId = generateId()
    const now = new Date().toISOString()

    return {
      id,
      product_id: productId,
      title: input.title ?? 'Default Title',
      price: input.price ?? '0.00',
      compare_at_price: input.compare_at_price ?? null,
      sku: input.sku ?? null,
      barcode: input.barcode ?? null,
      grams: input.grams ?? 0,
      weight: input.weight ?? 0,
      weight_unit: input.weight_unit ?? 'g',
      inventory_item_id: inventoryItemId,
      inventory_quantity: input.inventory_quantity ?? 0,
      inventory_management: input.inventory_management ?? null,
      inventory_policy: input.inventory_policy ?? 'deny',
      fulfillment_service: input.fulfillment_service ?? 'manual',
      requires_shipping: input.requires_shipping ?? true,
      taxable: input.taxable ?? true,
      position: position + 1,
      option1: input.option1 ?? input.title ?? 'Default Title',
      option2: input.option2 ?? null,
      option3: input.option3 ?? null,
      created_at: now,
      updated_at: now,
      image_id: input.image_id ?? null,
      admin_graphql_api_id: generateGid('ProductVariant', id),
    }
  }

  async get(productId: number): Promise<Product> {
    const product = this.store.products.get(productId)
    if (!product) {
      throw new Error(`Product not found: ${productId}`)
    }
    return product
  }

  async update(productId: number, input: ProductUpdateInput): Promise<Product> {
    const product = await this.get(productId)
    const now = new Date().toISOString()

    const updated: Product = {
      ...product,
      ...input,
      tags: input.tags !== undefined
        ? (typeof input.tags === 'string' ? input.tags : input.tags.join(', '))
        : product.tags,
      updated_at: now,
    }

    this.store.products.set(productId, updated)
    return updated
  }

  async delete(productId: number): Promise<void> {
    if (!this.store.products.has(productId)) {
      throw new Error(`Product not found: ${productId}`)
    }
    this.store.products.delete(productId)
  }

  async list(params?: {
    limit?: number
    status?: 'active' | 'archived' | 'draft'
    vendor?: string
    product_type?: string
    handle?: string
  }): Promise<ProductListResponse> {
    let products = Array.from(this.store.products.values())

    if (params?.status) {
      products = products.filter(p => p.status === params.status)
    }
    if (params?.vendor) {
      products = products.filter(p => p.vendor === params.vendor)
    }
    if (params?.product_type) {
      products = products.filter(p => p.product_type === params.product_type)
    }
    if (params?.handle) {
      products = products.filter(p => p.handle === params.handle)
    }
    if (params?.limit) {
      products = products.slice(0, params.limit)
    }

    return { products }
  }

  async count(params?: {
    vendor?: string
    product_type?: string
  }): Promise<CountResponse> {
    let products = Array.from(this.store.products.values())

    if (params?.vendor) {
      products = products.filter(p => p.vendor === params.vendor)
    }
    if (params?.product_type) {
      products = products.filter(p => p.product_type === params.product_type)
    }

    return { count: products.length }
  }
}

class LocalVariantsResource {
  private store: Store

  constructor(store: Store) {
    this.store = store
  }

  async create(productId: number, input: VariantInput): Promise<ProductVariant> {
    const product = this.store.products.get(productId)
    if (!product) {
      throw new Error(`Product not found: ${productId}`)
    }

    const id = generateId()
    const inventoryItemId = generateId()
    const now = new Date().toISOString()
    const position = product.variants.length + 1

    const variant: ProductVariant = {
      id,
      product_id: productId,
      title: input.title ?? 'Default Title',
      price: input.price ?? '0.00',
      compare_at_price: input.compare_at_price ?? null,
      sku: input.sku ?? null,
      barcode: input.barcode ?? null,
      grams: input.grams ?? 0,
      weight: input.weight ?? 0,
      weight_unit: input.weight_unit ?? 'g',
      inventory_item_id: inventoryItemId,
      inventory_quantity: input.inventory_quantity ?? 0,
      inventory_management: input.inventory_management ?? null,
      inventory_policy: input.inventory_policy ?? 'deny',
      fulfillment_service: input.fulfillment_service ?? 'manual',
      requires_shipping: input.requires_shipping ?? true,
      taxable: input.taxable ?? true,
      position,
      option1: input.option1 ?? input.title ?? 'Default Title',
      option2: input.option2 ?? null,
      option3: input.option3 ?? null,
      created_at: now,
      updated_at: now,
      image_id: input.image_id ?? null,
      admin_graphql_api_id: generateGid('ProductVariant', id),
    }

    product.variants.push(variant)
    product.updated_at = now
    this.store.products.set(productId, product)

    return variant
  }

  async get(variantId: number): Promise<ProductVariant> {
    for (const product of this.store.products.values()) {
      const variant = product.variants.find(v => v.id === variantId)
      if (variant) {
        return variant
      }
    }
    throw new Error(`Variant not found: ${variantId}`)
  }

  async update(variantId: number, input: VariantInput): Promise<ProductVariant> {
    for (const product of this.store.products.values()) {
      const variantIndex = product.variants.findIndex(v => v.id === variantId)
      if (variantIndex >= 0) {
        const now = new Date().toISOString()
        const updated: ProductVariant = {
          ...product.variants[variantIndex],
          ...input,
          updated_at: now,
        }
        product.variants[variantIndex] = updated
        product.updated_at = now
        this.store.products.set(product.id, product)
        return updated
      }
    }
    throw new Error(`Variant not found: ${variantId}`)
  }

  async delete(productId: number, variantId: number): Promise<void> {
    const product = this.store.products.get(productId)
    if (!product) {
      throw new Error(`Product not found: ${productId}`)
    }

    const variantIndex = product.variants.findIndex(v => v.id === variantId)
    if (variantIndex < 0) {
      throw new Error(`Variant not found: ${variantId}`)
    }

    product.variants.splice(variantIndex, 1)
    product.updated_at = new Date().toISOString()
    this.store.products.set(productId, product)
  }
}

// =============================================================================
// Orders Resource
// =============================================================================

class LocalOrdersResource {
  private store: Store
  private orderCounter = 1000
  readonly fulfillments: LocalFulfillmentsResource
  readonly refunds: LocalRefundsResource

  constructor(store: Store) {
    this.store = store
    this.fulfillments = new LocalFulfillmentsResource(store)
    this.refunds = new LocalRefundsResource(store)
  }

  async create(input: OrderInput): Promise<Order> {
    const id = generateId()
    const orderNumber = ++this.orderCounter
    const now = new Date().toISOString()

    const lineItems: LineItem[] = (input.line_items ?? []).map((item, index) => ({
      id: generateId(),
      product_id: item.product_id ?? null,
      variant_id: item.variant_id ?? null,
      title: item.title ?? 'Item',
      variant_title: null,
      sku: item.sku ?? null,
      quantity: item.quantity,
      price: item.price ?? '0.00',
      grams: item.grams ?? 0,
      fulfillment_status: null,
      fulfillable_quantity: item.quantity,
      fulfillment_service: item.fulfillment_service ?? 'manual',
      requires_shipping: item.requires_shipping ?? true,
      taxable: item.taxable ?? true,
      gift_card: item.gift_card ?? false,
      total_discount: '0.00',
      discount_allocations: [],
      tax_lines: item.tax_lines ?? [],
      properties: item.properties ?? [],
      admin_graphql_api_id: generateGid('LineItem', generateId()),
    }))

    // Calculate totals
    const subtotalPrice = lineItems.reduce(
      (sum, item) => sum + parseFloat(item.price) * item.quantity,
      0
    )

    const order: Order = {
      id,
      name: `#${orderNumber}`,
      email: input.email ?? input.customer?.email ?? null,
      phone: input.phone ?? null,
      created_at: now,
      updated_at: now,
      processed_at: now,
      closed_at: null,
      cancelled_at: null,
      cancel_reason: null,
      financial_status: input.financial_status ?? 'pending',
      fulfillment_status: null,
      currency: input.currency ?? 'USD',
      total_price: subtotalPrice.toFixed(2),
      subtotal_price: subtotalPrice.toFixed(2),
      total_tax: '0.00',
      total_discounts: '0.00',
      total_line_items_price: subtotalPrice.toFixed(2),
      total_weight: 0,
      taxes_included: input.taxes_included ?? false,
      confirmed: true,
      test: input.test ?? false,
      order_number: orderNumber,
      token: crypto.randomUUID(),
      gateway: null,
      line_items: lineItems,
      shipping_lines: [],
      billing_address: input.billing_address ?? null,
      shipping_address: input.shipping_address ?? null,
      customer: input.customer?.id ? (this.store.customers.get(input.customer.id) ?? null) : null,
      fulfillments: [],
      refunds: [],
      tags: input.tags ?? '',
      note: input.note ?? null,
      note_attributes: [],
      discount_codes: [],
      discount_applications: [],
      admin_graphql_api_id: generateGid('Order', id),
    }

    this.store.orders.set(id, order)
    return order
  }

  async get(orderId: number): Promise<Order> {
    const order = this.store.orders.get(orderId)
    if (!order) {
      throw new Error(`Order not found: ${orderId}`)
    }
    return order
  }

  async update(orderId: number, input: OrderUpdateInput): Promise<Order> {
    const order = await this.get(orderId)
    const now = new Date().toISOString()

    const updated: Order = {
      ...order,
      ...input,
      updated_at: now,
    }

    this.store.orders.set(orderId, updated)
    return updated
  }

  async close(orderId: number): Promise<Order> {
    const order = await this.get(orderId)
    const now = new Date().toISOString()

    const updated: Order = {
      ...order,
      closed_at: now,
      updated_at: now,
    }

    this.store.orders.set(orderId, updated)
    return updated
  }

  async cancel(orderId: number, input?: OrderCancelInput): Promise<Order> {
    const order = await this.get(orderId)
    const now = new Date().toISOString()

    const updated: Order = {
      ...order,
      cancelled_at: now,
      cancel_reason: input?.reason ?? null,
      updated_at: now,
    }

    this.store.orders.set(orderId, updated)
    return updated
  }

  async delete(orderId: number): Promise<void> {
    if (!this.store.orders.has(orderId)) {
      throw new Error(`Order not found: ${orderId}`)
    }
    this.store.orders.delete(orderId)
  }

  async list(params?: {
    limit?: number
    status?: 'open' | 'closed' | 'cancelled' | 'any'
    financial_status?: string
    fulfillment_status?: string
  }): Promise<OrderListResponse> {
    let orders = Array.from(this.store.orders.values())

    if (params?.status && params.status !== 'any') {
      orders = orders.filter(o => {
        if (params.status === 'closed') return o.closed_at !== null
        if (params.status === 'cancelled') return o.cancelled_at !== null
        if (params.status === 'open') return o.closed_at === null && o.cancelled_at === null
        return true
      })
    }
    if (params?.financial_status) {
      orders = orders.filter(o => o.financial_status === params.financial_status)
    }
    if (params?.limit) {
      orders = orders.slice(0, params.limit)
    }

    return { orders }
  }

  async count(params?: {
    status?: 'open' | 'closed' | 'cancelled' | 'any'
    financial_status?: string
  }): Promise<CountResponse> {
    const result = await this.list(params)
    return { count: result.orders.length }
  }
}

class LocalFulfillmentsResource {
  private store: Store

  constructor(store: Store) {
    this.store = store
  }

  async create(orderId: number, input: FulfillmentInput): Promise<Fulfillment> {
    const order = this.store.orders.get(orderId)
    if (!order) {
      throw new Error(`Order not found: ${orderId}`)
    }

    const id = generateId()
    const now = new Date().toISOString()

    const fulfillment: Fulfillment = {
      id,
      order_id: orderId,
      status: 'success',
      tracking_company: input.tracking_company ?? null,
      tracking_number: input.tracking_number ?? null,
      tracking_numbers: input.tracking_numbers ?? (input.tracking_number ? [input.tracking_number] : []),
      tracking_url: input.tracking_url ?? null,
      tracking_urls: input.tracking_urls ?? (input.tracking_url ? [input.tracking_url] : []),
      line_items: order.line_items,
      created_at: now,
      updated_at: now,
      location_id: input.location_id ?? 1,
      shipment_status: input.shipment_status ?? null,
      admin_graphql_api_id: generateGid('Fulfillment', id),
    }

    this.store.fulfillments.set(id, fulfillment)
    order.fulfillments.push(fulfillment)
    order.fulfillment_status = 'fulfilled'
    order.updated_at = now
    this.store.orders.set(orderId, order)

    return fulfillment
  }

  async get(orderId: number, fulfillmentId: number): Promise<Fulfillment> {
    const fulfillment = this.store.fulfillments.get(fulfillmentId)
    if (!fulfillment || fulfillment.order_id !== orderId) {
      throw new Error(`Fulfillment not found: ${fulfillmentId}`)
    }
    return fulfillment
  }

  async updateTracking(
    orderId: number,
    fulfillmentId: number,
    input: FulfillmentTrackingInput
  ): Promise<Fulfillment> {
    const fulfillment = await this.get(orderId, fulfillmentId)
    const now = new Date().toISOString()

    const updated: Fulfillment = {
      ...fulfillment,
      tracking_company: input.tracking_company ?? fulfillment.tracking_company,
      tracking_number: input.tracking_number ?? fulfillment.tracking_number,
      tracking_numbers: input.tracking_numbers ?? fulfillment.tracking_numbers,
      tracking_url: input.tracking_url ?? fulfillment.tracking_url,
      tracking_urls: input.tracking_urls ?? fulfillment.tracking_urls,
      updated_at: now,
    }

    this.store.fulfillments.set(fulfillmentId, updated)
    return updated
  }

  async list(orderId: number): Promise<{ fulfillments: Fulfillment[] }> {
    const fulfillments = Array.from(this.store.fulfillments.values()).filter(
      f => f.order_id === orderId
    )
    return { fulfillments }
  }
}

class LocalRefundsResource {
  private store: Store

  constructor(store: Store) {
    this.store = store
  }

  async create(orderId: number, input: RefundInput): Promise<Refund> {
    const order = this.store.orders.get(orderId)
    if (!order) {
      throw new Error(`Order not found: ${orderId}`)
    }

    const id = generateId()
    const now = new Date().toISOString()

    const refund: Refund = {
      id,
      order_id: orderId,
      created_at: now,
      note: input.note ?? null,
      user_id: null,
      processed_at: now,
      restock: false,
      refund_line_items: (input.refund_line_items ?? []).map(item => {
        const lineItem = order.line_items.find(li => li.id === item.line_item_id)
        return {
          id: generateId(),
          line_item_id: item.line_item_id,
          line_item: lineItem!,
          quantity: item.quantity,
          restock_type: item.restock_type ?? 'no_restock',
          location_id: item.location_id ?? null,
          subtotal: 0,
          subtotal_set: { shop_money: { amount: '0.00', currency_code: 'USD' }, presentment_money: { amount: '0.00', currency_code: 'USD' } },
          total_tax: 0,
          total_tax_set: { shop_money: { amount: '0.00', currency_code: 'USD' }, presentment_money: { amount: '0.00', currency_code: 'USD' } },
        }
      }),
      transactions: [],
      order_adjustments: [],
      admin_graphql_api_id: generateGid('Refund', id),
    }

    this.store.refunds.set(id, refund)
    order.refunds.push(refund)
    order.updated_at = now
    this.store.orders.set(orderId, order)

    return refund
  }

  async calculate(orderId: number, input: RefundCalculateInput): Promise<Partial<Refund>> {
    const order = this.store.orders.get(orderId)
    if (!order) {
      throw new Error(`Order not found: ${orderId}`)
    }

    return {
      refund_line_items: (input.refund_line_items ?? []).map(item => {
        const lineItem = order.line_items.find(li => li.id === item.line_item_id)
        return {
          id: 0,
          line_item_id: item.line_item_id,
          line_item: lineItem!,
          quantity: item.quantity,
          restock_type: item.restock_type ?? 'no_restock',
          location_id: item.location_id ?? null,
          subtotal: parseFloat(lineItem?.price ?? '0') * item.quantity,
          subtotal_set: { shop_money: { amount: '0.00', currency_code: 'USD' }, presentment_money: { amount: '0.00', currency_code: 'USD' } },
          total_tax: 0,
          total_tax_set: { shop_money: { amount: '0.00', currency_code: 'USD' }, presentment_money: { amount: '0.00', currency_code: 'USD' } },
        }
      }),
    }
  }

  async list(orderId: number): Promise<{ refunds: Refund[] }> {
    const refunds = Array.from(this.store.refunds.values()).filter(
      r => r.order_id === orderId
    )
    return { refunds }
  }
}

// =============================================================================
// Customers Resource
// =============================================================================

class LocalCustomersResource {
  private store: Store
  readonly addresses: LocalAddressesResource

  constructor(store: Store) {
    this.store = store
    this.addresses = new LocalAddressesResource(store)
  }

  async create(input: CustomerInput): Promise<Customer> {
    const id = generateId()
    const now = new Date().toISOString()

    const customer: Customer = {
      id,
      email: input.email ?? null,
      first_name: input.first_name ?? null,
      last_name: input.last_name ?? null,
      phone: input.phone ?? null,
      verified_email: input.verified_email ?? false,
      accepts_marketing: input.accepts_marketing ?? false,
      accepts_marketing_updated_at: null,
      marketing_opt_in_level: null,
      state: 'enabled',
      tags: input.tags ?? '',
      currency: 'USD',
      tax_exempt: input.tax_exempt ?? false,
      tax_exemptions: input.tax_exemptions ?? [],
      created_at: now,
      updated_at: now,
      orders_count: 0,
      total_spent: '0.00',
      last_order_id: null,
      last_order_name: null,
      note: input.note ?? null,
      addresses: [],
      default_address: null,
      admin_graphql_api_id: generateGid('Customer', id),
    }

    this.store.customers.set(id, customer)
    return customer
  }

  async get(customerId: number): Promise<Customer> {
    const customer = this.store.customers.get(customerId)
    if (!customer) {
      throw new Error(`Customer not found: ${customerId}`)
    }
    return customer
  }

  async update(customerId: number, input: CustomerUpdateInput): Promise<Customer> {
    const customer = await this.get(customerId)
    const now = new Date().toISOString()

    const updated: Customer = {
      ...customer,
      ...input,
      updated_at: now,
    }

    this.store.customers.set(customerId, updated)
    return updated
  }

  async delete(customerId: number): Promise<void> {
    if (!this.store.customers.has(customerId)) {
      throw new Error(`Customer not found: ${customerId}`)
    }
    this.store.customers.delete(customerId)
  }

  async list(params?: {
    limit?: number
  }): Promise<CustomerListResponse> {
    let customers = Array.from(this.store.customers.values())

    if (params?.limit) {
      customers = customers.slice(0, params.limit)
    }

    return { customers }
  }

  async search(params: { query: string }): Promise<CustomerListResponse> {
    const query = params.query.toLowerCase()
    const customers = Array.from(this.store.customers.values()).filter(c =>
      (c.email?.toLowerCase().includes(query)) ||
      (c.first_name?.toLowerCase().includes(query)) ||
      (c.last_name?.toLowerCase().includes(query))
    )

    return { customers }
  }

  async count(): Promise<CountResponse> {
    return { count: this.store.customers.size }
  }

  async orders(customerId: number): Promise<OrderListResponse> {
    const customer = await this.get(customerId)
    const orders = Array.from(this.store.orders.values()).filter(
      o => o.customer?.id === customerId
    )
    return { orders }
  }
}

class LocalAddressesResource {
  private store: Store

  constructor(store: Store) {
    this.store = store
  }

  async create(customerId: number, input: AddressInput): Promise<CustomerAddress> {
    const customer = this.store.customers.get(customerId)
    if (!customer) {
      throw new Error(`Customer not found: ${customerId}`)
    }

    const id = generateId()

    const address: CustomerAddress = {
      id,
      customer_id: customerId,
      first_name: input.first_name ?? null,
      last_name: input.last_name ?? null,
      company: input.company ?? null,
      address1: input.address1 ?? null,
      address2: input.address2 ?? null,
      city: input.city ?? null,
      province: input.province ?? null,
      country: input.country ?? null,
      zip: input.zip ?? null,
      phone: input.phone ?? null,
      name: `${input.first_name ?? ''} ${input.last_name ?? ''}`.trim(),
      province_code: input.province_code ?? null,
      country_code: input.country_code ?? null,
      country_name: input.country ?? null,
      default: input.default ?? false,
    }

    customer.addresses.push(address)
    if (address.default || customer.addresses.length === 1) {
      customer.default_address = address
    }
    customer.updated_at = new Date().toISOString()
    this.store.customers.set(customerId, customer)

    return address
  }

  async list(customerId: number): Promise<AddressListResponse> {
    const customer = this.store.customers.get(customerId)
    if (!customer) {
      throw new Error(`Customer not found: ${customerId}`)
    }
    return { addresses: customer.addresses }
  }

  async get(customerId: number, addressId: number): Promise<CustomerAddress> {
    const customer = this.store.customers.get(customerId)
    if (!customer) {
      throw new Error(`Customer not found: ${customerId}`)
    }
    const address = customer.addresses.find(a => a.id === addressId)
    if (!address) {
      throw new Error(`Address not found: ${addressId}`)
    }
    return address
  }

  async update(customerId: number, addressId: number, input: AddressInput): Promise<CustomerAddress> {
    const customer = this.store.customers.get(customerId)
    if (!customer) {
      throw new Error(`Customer not found: ${customerId}`)
    }
    const addressIndex = customer.addresses.findIndex(a => a.id === addressId)
    if (addressIndex < 0) {
      throw new Error(`Address not found: ${addressId}`)
    }

    const updated: CustomerAddress = {
      ...customer.addresses[addressIndex],
      ...input,
    }

    customer.addresses[addressIndex] = updated
    customer.updated_at = new Date().toISOString()
    this.store.customers.set(customerId, customer)

    return updated
  }

  async delete(customerId: number, addressId: number): Promise<void> {
    const customer = this.store.customers.get(customerId)
    if (!customer) {
      throw new Error(`Customer not found: ${customerId}`)
    }
    const addressIndex = customer.addresses.findIndex(a => a.id === addressId)
    if (addressIndex < 0) {
      throw new Error(`Address not found: ${addressId}`)
    }

    customer.addresses.splice(addressIndex, 1)
    if (customer.default_address?.id === addressId) {
      customer.default_address = customer.addresses[0] ?? null
    }
    customer.updated_at = new Date().toISOString()
    this.store.customers.set(customerId, customer)
  }

  async setDefault(customerId: number, addressId: number): Promise<CustomerAddress> {
    const customer = this.store.customers.get(customerId)
    if (!customer) {
      throw new Error(`Customer not found: ${customerId}`)
    }
    const address = customer.addresses.find(a => a.id === addressId)
    if (!address) {
      throw new Error(`Address not found: ${addressId}`)
    }

    // Update all addresses
    for (const addr of customer.addresses) {
      addr.default = addr.id === addressId
    }
    address.default = true
    customer.default_address = address
    customer.updated_at = new Date().toISOString()
    this.store.customers.set(customerId, customer)

    return address
  }
}

// =============================================================================
// Inventory Resource
// =============================================================================

class LocalInventoryResource {
  private store: Store
  readonly levels: LocalInventoryLevelsResource
  readonly locations: LocalLocationsResource

  constructor(store: Store) {
    this.store = store
    this.levels = new LocalInventoryLevelsResource(store)
    this.locations = new LocalLocationsResource(store)
  }
}

class LocalInventoryLevelsResource {
  private store: Store

  constructor(store: Store) {
    this.store = store
  }

  async set(input: InventorySetInput): Promise<InventoryLevel> {
    const key = `${input.inventory_item_id}:${input.location_id}`
    const now = new Date().toISOString()

    const level: InventoryLevel = {
      inventory_item_id: input.inventory_item_id,
      location_id: input.location_id,
      available: input.available,
      updated_at: now,
      admin_graphql_api_id: generateGid('InventoryLevel', generateId()),
    }

    this.store.inventoryLevels.set(key, level)
    return level
  }

  async adjust(input: InventoryAdjustInput): Promise<InventoryLevel> {
    const key = `${input.inventory_item_id}:${input.location_id}`
    const existing = this.store.inventoryLevels.get(key)
    const currentAvailable = existing?.available ?? 0

    return this.set({
      inventory_item_id: input.inventory_item_id,
      location_id: input.location_id,
      available: currentAvailable + input.available_adjustment,
    })
  }

  async list(params: {
    inventory_item_ids?: string
    location_ids?: string
  }): Promise<{ inventory_levels: InventoryLevel[] }> {
    const levels = Array.from(this.store.inventoryLevels.values())
    return { inventory_levels: levels }
  }
}

class LocalLocationsResource {
  private store: Store

  constructor(store: Store) {
    this.store = store
  }

  async list(): Promise<LocationListResponse> {
    const locations = Array.from(this.store.locations.values())
    return { locations }
  }

  async get(locationId: number): Promise<Location> {
    const location = this.store.locations.get(locationId)
    if (!location) {
      throw new Error(`Location not found: ${locationId}`)
    }
    return location
  }

  async count(): Promise<CountResponse> {
    return { count: this.store.locations.size }
  }
}

// =============================================================================
// Webhooks Resource
// =============================================================================

class LocalWebhooksResource {
  async validate(params: WebhookValidateParams): Promise<boolean> {
    const rawBodyString =
      typeof params.rawBody === 'string'
        ? params.rawBody
        : new TextDecoder().decode(params.rawBody)

    try {
      const expectedHmac = await this.generateHmac(rawBodyString, params.secret)
      return this.secureCompare(params.hmac, expectedHmac)
    } catch {
      return false
    }
  }

  async generateHmac(data: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const keyData = encoder.encode(secret)
    const messageData = encoder.encode(data)

    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const signature = await crypto.subtle.sign('HMAC', key, messageData)
    return btoa(String.fromCharCode(...new Uint8Array(signature)))
  }

  private secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false

    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
  }
}

// =============================================================================
// GraphQL Resource
// =============================================================================

class LocalGraphqlResource {
  private store: Store

  constructor(store: Store) {
    this.store = store
  }

  async query<T = Record<string, unknown>>(options: GraphqlQueryOptions): Promise<GraphqlResponse<T>> {
    // Simple GraphQL parser for common operations
    const { query, variables } = options

    // Handle product queries
    if (query.includes('products(')) {
      const products = Array.from(this.store.products.values())
      return {
        data: {
          products: {
            edges: products.map(p => ({
              node: {
                id: p.admin_graphql_api_id,
                title: p.title,
                handle: p.handle,
                vendor: p.vendor,
                productType: p.product_type,
                status: p.status.toUpperCase(),
              },
              cursor: btoa(p.id.toString()),
            })),
          },
        } as T,
      }
    }

    // Handle product mutations
    if (query.includes('productCreate')) {
      const input = variables?.input as ProductInput | undefined
      if (input) {
        const product = await this.createProduct(input)
        return {
          data: {
            productCreate: {
              product: {
                id: product.admin_graphql_api_id,
                title: product.title,
              },
              userErrors: [],
            },
          } as T,
        }
      }
    }

    // Default response
    return { data: {} as T }
  }

  private async createProduct(input: ProductInput): Promise<Product> {
    const id = generateId()
    const now = new Date().toISOString()

    const product: Product = {
      id,
      title: input.title,
      body_html: input.body_html ?? null,
      vendor: input.vendor ?? '',
      product_type: input.product_type ?? '',
      handle: input.handle ?? generateHandle(input.title),
      status: input.status ?? 'active',
      published_scope: 'global',
      tags: typeof input.tags === 'string' ? input.tags : (input.tags?.join(', ') ?? ''),
      template_suffix: null,
      created_at: now,
      updated_at: now,
      published_at: now,
      variants: [{
        id: generateId(),
        product_id: id,
        title: 'Default Title',
        price: '0.00',
        compare_at_price: null,
        sku: null,
        barcode: null,
        grams: 0,
        weight: 0,
        weight_unit: 'g',
        inventory_item_id: generateId(),
        inventory_quantity: 0,
        inventory_management: null,
        inventory_policy: 'deny',
        fulfillment_service: 'manual',
        requires_shipping: true,
        taxable: true,
        position: 1,
        option1: 'Default Title',
        option2: null,
        option3: null,
        created_at: now,
        updated_at: now,
        admin_graphql_api_id: generateGid('ProductVariant', id),
      }],
      options: [{ id: generateId(), product_id: id, name: 'Title', position: 1, values: ['Default Title'] }],
      images: [],
      image: null,
      admin_graphql_api_id: generateGid('Product', id),
    }

    this.store.products.set(id, product)
    return product
  }
}

// =============================================================================
// ShopifyLocal Main Class
// =============================================================================

export class ShopifyLocal {
  private store: Store
  readonly config: ShopifyLocalConfig
  readonly products: LocalProductsResource
  readonly orders: LocalOrdersResource
  readonly customers: LocalCustomersResource
  readonly inventory: LocalInventoryResource
  readonly webhooks: LocalWebhooksResource
  readonly graphql: LocalGraphqlResource

  constructor(config: ShopifyLocalConfig) {
    this.config = config
    this.store = createStore()
    this.products = new LocalProductsResource(this.store)
    this.orders = new LocalOrdersResource(this.store)
    this.customers = new LocalCustomersResource(this.store)
    this.inventory = new LocalInventoryResource(this.store)
    this.webhooks = new LocalWebhooksResource()
    this.graphql = new LocalGraphqlResource(this.store)
  }

  /**
   * Clear all state (for testing)
   */
  async clear(): Promise<void> {
    this.store = createStore()
    // Re-initialize resources with new store
    ;(this as { products: LocalProductsResource }).products = new LocalProductsResource(this.store)
    ;(this as { orders: LocalOrdersResource }).orders = new LocalOrdersResource(this.store)
    ;(this as { customers: LocalCustomersResource }).customers = new LocalCustomersResource(this.store)
    ;(this as { inventory: LocalInventoryResource }).inventory = new LocalInventoryResource(this.store)
    ;(this as { graphql: LocalGraphqlResource }).graphql = new LocalGraphqlResource(this.store)
  }
}

export default ShopifyLocal
