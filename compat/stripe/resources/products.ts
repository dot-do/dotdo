/**
 * Stripe Products & Prices Resource - Local Implementation
 *
 * Manages products and their pricing tiers.
 * Products are containers, Prices define actual billing terms.
 */

import type {
  Price,
  PriceData,
  Metadata,
  ListResponse,
} from '../types'

// Product type (not fully defined in types.ts)
export interface Product {
  id: string
  object: 'product'
  active: boolean
  created: number
  default_price?: string | null
  description?: string | null
  images: string[]
  livemode: boolean
  metadata: Metadata
  name: string
  package_dimensions?: {
    height: number
    length: number
    weight: number
    width: number
  } | null
  shippable?: boolean | null
  statement_descriptor?: string | null
  tax_code?: string | null
  type: 'good' | 'service'
  unit_label?: string | null
  updated: number
  url?: string | null
}

export interface ProductCreateParams {
  name: string
  active?: boolean
  default_price_data?: {
    currency: string
    unit_amount?: number
    unit_amount_decimal?: string
    recurring?: {
      interval: 'day' | 'week' | 'month' | 'year'
      interval_count?: number
    }
  }
  description?: string
  images?: string[]
  metadata?: Metadata
  package_dimensions?: {
    height: number
    length: number
    weight: number
    width: number
  }
  shippable?: boolean
  statement_descriptor?: string
  tax_code?: string
  type?: 'good' | 'service'
  unit_label?: string
  url?: string
}

export interface ProductUpdateParams {
  active?: boolean
  default_price?: string
  description?: string | ''
  images?: string[]
  metadata?: Metadata | ''
  name?: string
  package_dimensions?: {
    height: number
    length: number
    weight: number
    width: number
  } | ''
  shippable?: boolean
  statement_descriptor?: string | ''
  tax_code?: string | ''
  unit_label?: string | ''
  url?: string | ''
}

export interface ProductListParams {
  active?: boolean
  created?: { gt?: number; gte?: number; lt?: number; lte?: number }
  ids?: string[]
  limit?: number
  starting_after?: string
  ending_before?: string
  type?: 'good' | 'service'
}

export interface PriceCreateParams {
  currency: string
  product?: string
  product_data?: {
    name: string
    active?: boolean
    metadata?: Metadata
    statement_descriptor?: string
    tax_code?: string
    unit_label?: string
  }
  active?: boolean
  billing_scheme?: 'per_unit' | 'tiered'
  lookup_key?: string
  metadata?: Metadata
  nickname?: string
  recurring?: {
    interval: 'day' | 'week' | 'month' | 'year'
    interval_count?: number
    usage_type?: 'licensed' | 'metered'
    aggregate_usage?: 'last_during_period' | 'last_ever' | 'max' | 'sum'
  }
  tax_behavior?: 'exclusive' | 'inclusive' | 'unspecified'
  tiers?: Array<{
    up_to: number | 'inf'
    flat_amount?: number
    flat_amount_decimal?: string
    unit_amount?: number
    unit_amount_decimal?: string
  }>
  tiers_mode?: 'graduated' | 'volume'
  transform_quantity?: { divide_by: number; round: 'down' | 'up' }
  unit_amount?: number
  unit_amount_decimal?: string
}

export interface PriceUpdateParams {
  active?: boolean
  lookup_key?: string
  metadata?: Metadata | ''
  nickname?: string | ''
  tax_behavior?: 'exclusive' | 'inclusive' | 'unspecified'
  transfer_lookup_key?: boolean
}

export interface PriceListParams {
  active?: boolean
  currency?: string
  product?: string
  type?: 'one_time' | 'recurring'
  created?: { gt?: number; gte?: number; lt?: number; lte?: number }
  limit?: number
  starting_after?: string
  ending_before?: string
  lookup_keys?: string[]
  recurring?: { interval?: 'day' | 'week' | 'month' | 'year'; usage_type?: 'licensed' | 'metered' }
}

export interface ProductsResourceOptions {
  onEvent?: (type: string, data: unknown) => void
}

/**
 * Local Products Resource
 */
export class LocalProductsResource {
  private products: Map<string, Product> = new Map()
  private onEvent?: (type: string, data: unknown) => void

  constructor(options?: ProductsResourceOptions) {
    this.onEvent = options?.onEvent
  }

  private generateId(): string {
    return `prod_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`
  }

  async create(params: ProductCreateParams): Promise<Product> {
    const now = Math.floor(Date.now() / 1000)
    const id = this.generateId()

    const product: Product = {
      id,
      object: 'product',
      active: params.active ?? true,
      created: now,
      default_price: null,
      description: params.description ?? null,
      images: params.images ?? [],
      livemode: false,
      metadata: params.metadata ?? {},
      name: params.name,
      package_dimensions: params.package_dimensions ?? null,
      shippable: params.shippable ?? null,
      statement_descriptor: params.statement_descriptor ?? null,
      tax_code: params.tax_code ?? null,
      type: params.type ?? 'service',
      unit_label: params.unit_label ?? null,
      updated: now,
      url: params.url ?? null,
    }

    this.products.set(id, product)
    this.emitEvent('product.created', product)
    return product
  }

  async retrieve(id: string): Promise<Product> {
    const product = this.products.get(id)
    if (!product) {
      throw this.createError('resource_missing', `No such product: '${id}'`, 'id')
    }
    return product
  }

  async update(id: string, params: ProductUpdateParams): Promise<Product> {
    const existing = await this.retrieve(id)
    const now = Math.floor(Date.now() / 1000)

    const updated: Product = {
      ...existing,
      active: params.active ?? existing.active,
      default_price: params.default_price ?? existing.default_price,
      description: params.description === '' ? null : (params.description ?? existing.description),
      images: params.images ?? existing.images,
      metadata: params.metadata === '' ? {} : (params.metadata ?? existing.metadata),
      name: params.name ?? existing.name,
      package_dimensions: params.package_dimensions === '' ? null : (params.package_dimensions ?? existing.package_dimensions),
      shippable: params.shippable ?? existing.shippable,
      statement_descriptor: params.statement_descriptor === '' ? null : (params.statement_descriptor ?? existing.statement_descriptor),
      tax_code: params.tax_code === '' ? null : (params.tax_code ?? existing.tax_code),
      unit_label: params.unit_label === '' ? null : (params.unit_label ?? existing.unit_label),
      updated: now,
      url: params.url === '' ? null : (params.url ?? existing.url),
    }

    this.products.set(id, updated)
    this.emitEvent('product.updated', updated)
    return updated
  }

  async del(id: string): Promise<{ id: string; object: 'product'; deleted: true }> {
    await this.retrieve(id)
    this.products.delete(id)
    this.emitEvent('product.deleted', { id, object: 'product', deleted: true })
    return { id, object: 'product', deleted: true }
  }

  async list(params?: ProductListParams): Promise<ListResponse<Product>> {
    const limit = Math.min(params?.limit ?? 10, 100)
    let products = Array.from(this.products.values())

    // Apply filters
    if (params?.active !== undefined) {
      products = products.filter((p) => p.active === params.active)
    }
    if (params?.type) {
      products = products.filter((p) => p.type === params.type)
    }
    if (params?.ids) {
      products = products.filter((p) => params.ids!.includes(p.id))
    }
    if (params?.created) {
      products = products.filter((p) => {
        if (params.created!.gt !== undefined && p.created <= params.created!.gt) return false
        if (params.created!.gte !== undefined && p.created < params.created!.gte) return false
        if (params.created!.lt !== undefined && p.created >= params.created!.lt) return false
        if (params.created!.lte !== undefined && p.created > params.created!.lte) return false
        return true
      })
    }

    // Sort by created descending
    products.sort((a, b) => b.created - a.created)

    // Cursor pagination
    let startIndex = 0
    if (params?.starting_after) {
      const idx = products.findIndex((p) => p.id === params.starting_after)
      if (idx !== -1) startIndex = idx + 1
    }

    const page = products.slice(startIndex, startIndex + limit)

    return {
      object: 'list',
      data: page,
      has_more: startIndex + limit < products.length,
      url: '/v1/products',
    }
  }

  private emitEvent(type: string, data: unknown): void {
    if (this.onEvent) this.onEvent(type, data)
  }

  private createError(code: string, message: string, param?: string): Error {
    const error = new Error(message) as Error & { type: string; code: string; param?: string }
    error.type = 'invalid_request_error'
    error.code = code
    error.param = param
    return error
  }
}

/**
 * Local Prices Resource
 */
export class LocalPricesResource {
  private prices: Map<string, Price> = new Map()
  private lookupKeys: Map<string, string> = new Map() // lookup_key -> price_id
  private productsResource: LocalProductsResource
  private onEvent?: (type: string, data: unknown) => void

  constructor(productsResource: LocalProductsResource, options?: { onEvent?: (type: string, data: unknown) => void }) {
    this.productsResource = productsResource
    this.onEvent = options?.onEvent
  }

  private generateId(): string {
    return `price_${crypto.randomUUID().replace(/-/g, '').substring(0, 24)}`
  }

  async create(params: PriceCreateParams): Promise<Price> {
    const now = Math.floor(Date.now() / 1000)
    const id = this.generateId()

    // Create inline product if product_data is provided
    let productId = params.product
    if (params.product_data && !productId) {
      const product = await this.productsResource.create({
        name: params.product_data.name,
        active: params.product_data.active,
        metadata: params.product_data.metadata,
        statement_descriptor: params.product_data.statement_descriptor,
        tax_code: params.product_data.tax_code,
        unit_label: params.product_data.unit_label,
      })
      productId = product.id
    }

    if (!productId) {
      throw this.createError('parameter_missing', 'Missing required param: product or product_data', 'product')
    }

    const price: Price = {
      id,
      object: 'price',
      active: params.active ?? true,
      billing_scheme: params.billing_scheme ?? 'per_unit',
      created: now,
      currency: params.currency.toLowerCase(),
      currency_options: null,
      custom_unit_amount: null,
      livemode: false,
      lookup_key: params.lookup_key ?? null,
      metadata: params.metadata ?? {},
      nickname: params.nickname ?? null,
      product: productId,
      recurring: params.recurring
        ? {
            aggregate_usage: params.recurring.aggregate_usage ?? null,
            interval: params.recurring.interval,
            interval_count: params.recurring.interval_count ?? 1,
            usage_type: params.recurring.usage_type ?? 'licensed',
          }
        : null,
      tax_behavior: params.tax_behavior ?? 'unspecified',
      tiers: params.tiers
        ? params.tiers.map((t) => ({
            flat_amount: t.flat_amount ?? null,
            flat_amount_decimal: t.flat_amount_decimal ?? null,
            unit_amount: t.unit_amount ?? null,
            unit_amount_decimal: t.unit_amount_decimal ?? null,
            up_to: t.up_to === 'inf' ? null : t.up_to,
          }))
        : null,
      tiers_mode: params.tiers_mode ?? null,
      transform_quantity: params.transform_quantity ?? null,
      type: params.recurring ? 'recurring' : 'one_time',
      unit_amount: params.unit_amount ?? null,
      unit_amount_decimal: params.unit_amount_decimal ?? null,
    }

    this.prices.set(id, price)

    // Handle lookup key
    if (params.lookup_key) {
      // Remove from any existing price
      const existingPriceId = this.lookupKeys.get(params.lookup_key)
      if (existingPriceId) {
        const existingPrice = this.prices.get(existingPriceId)
        if (existingPrice) {
          existingPrice.lookup_key = null
        }
      }
      this.lookupKeys.set(params.lookup_key, id)
    }

    this.emitEvent('price.created', price)
    return price
  }

  async retrieve(id: string): Promise<Price> {
    const price = this.prices.get(id)
    if (!price) {
      throw this.createError('resource_missing', `No such price: '${id}'`, 'id')
    }
    return price
  }

  async update(id: string, params: PriceUpdateParams): Promise<Price> {
    const existing = await this.retrieve(id)

    const updated: Price = {
      ...existing,
      active: params.active ?? existing.active,
      metadata: params.metadata === '' ? {} : (params.metadata ?? existing.metadata),
      nickname: params.nickname === '' ? null : (params.nickname ?? existing.nickname),
      tax_behavior: params.tax_behavior ?? existing.tax_behavior,
    }

    // Handle lookup key transfer
    if (params.lookup_key !== undefined) {
      // Remove old lookup key
      if (existing.lookup_key) {
        this.lookupKeys.delete(existing.lookup_key)
      }
      // Set new lookup key
      if (params.lookup_key) {
        if (params.transfer_lookup_key) {
          const existingPriceId = this.lookupKeys.get(params.lookup_key)
          if (existingPriceId) {
            const existingPrice = this.prices.get(existingPriceId)
            if (existingPrice) {
              existingPrice.lookup_key = null
            }
          }
        }
        this.lookupKeys.set(params.lookup_key, id)
      }
      updated.lookup_key = params.lookup_key || null
    }

    this.prices.set(id, updated)
    this.emitEvent('price.updated', updated)
    return updated
  }

  async list(params?: PriceListParams): Promise<ListResponse<Price>> {
    const limit = Math.min(params?.limit ?? 10, 100)
    let prices = Array.from(this.prices.values())

    // Apply filters
    if (params?.active !== undefined) {
      prices = prices.filter((p) => p.active === params.active)
    }
    if (params?.currency) {
      prices = prices.filter((p) => p.currency === params.currency!.toLowerCase())
    }
    if (params?.product) {
      prices = prices.filter((p) => p.product === params.product)
    }
    if (params?.type) {
      prices = prices.filter((p) => p.type === params.type)
    }
    if (params?.lookup_keys) {
      prices = prices.filter((p) => p.lookup_key && params.lookup_keys!.includes(p.lookup_key))
    }
    if (params?.recurring) {
      if (params.recurring.interval) {
        prices = prices.filter((p) => p.recurring?.interval === params.recurring!.interval)
      }
      if (params.recurring.usage_type) {
        prices = prices.filter((p) => p.recurring?.usage_type === params.recurring!.usage_type)
      }
    }

    // Sort by created descending
    prices.sort((a, b) => b.created - a.created)

    // Cursor pagination
    let startIndex = 0
    if (params?.starting_after) {
      const idx = prices.findIndex((p) => p.id === params.starting_after)
      if (idx !== -1) startIndex = idx + 1
    }

    const page = prices.slice(startIndex, startIndex + limit)

    return {
      object: 'list',
      data: page,
      has_more: startIndex + limit < prices.length,
      url: '/v1/prices',
    }
  }

  /**
   * Retrieve by lookup key
   */
  async retrieveByLookupKey(lookupKey: string): Promise<Price | null> {
    const priceId = this.lookupKeys.get(lookupKey)
    if (!priceId) return null
    return this.prices.get(priceId) ?? null
  }

  private emitEvent(type: string, data: unknown): void {
    if (this.onEvent) this.onEvent(type, data)
  }

  private createError(code: string, message: string, param?: string): Error {
    const error = new Error(message) as Error & { type: string; code: string; param?: string }
    error.type = 'invalid_request_error'
    error.code = code
    error.param = param
    return error
  }
}
