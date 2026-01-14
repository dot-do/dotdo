/**
 * Product - Sellable product entity
 *
 * Represents a product with pricing, inventory, variants.
 * Examples: physical goods, digital products, subscriptions
 */

import { Entity, EntityRecord } from '../entities/Entity'
import { Env } from '../core/DO'

export interface ProductVariant {
  id: string
  name: string
  sku: string
  price: number
  compareAtPrice?: number
  inventory: number
  attributes: Record<string, string>
}

export interface ProductConfig {
  name: string
  description?: string
  category?: string
  tags?: string[]
  images?: string[]
  status: 'draft' | 'active' | 'archived'
  variants: ProductVariant[]
  metadata?: Record<string, unknown>
}

export class Product extends Entity {
  private productConfig: ProductConfig | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Get product configuration
   */
  async getProductConfig(): Promise<ProductConfig | null> {
    if (!this.productConfig) {
      this.productConfig = (await this.ctx.storage.get('product_config')) as ProductConfig | null
    }
    return this.productConfig
  }

  /**
   * Configure the product
   */
  async configure(config: ProductConfig): Promise<void> {
    this.productConfig = config
    await this.ctx.storage.put('product_config', config)
    await this.emit('product.configured', { config })
  }

  /**
   * Update product status
   */
  async setStatus(status: ProductConfig['status']): Promise<void> {
    const config = await this.getProductConfig()
    if (!config) throw new Error('Product not configured')

    config.status = status
    await this.ctx.storage.put('product_config', config)
    await this.emit('product.statusChanged', { status })
  }

  /**
   * Add a variant
   */
  async addVariant(variant: Omit<ProductVariant, 'id'>): Promise<ProductVariant> {
    const config = await this.getProductConfig()
    if (!config) throw new Error('Product not configured')

    const newVariant: ProductVariant = {
      ...variant,
      id: crypto.randomUUID(),
    }

    config.variants.push(newVariant)
    await this.ctx.storage.put('product_config', config)
    await this.emit('variant.added', { variant: newVariant })

    return newVariant
  }

  /**
   * Update variant
   */
  async updateVariant(variantId: string, updates: Partial<ProductVariant>): Promise<ProductVariant | null> {
    const config = await this.getProductConfig()
    if (!config) throw new Error('Product not configured')

    const index = config.variants.findIndex((v) => v.id === variantId)
    if (index === -1) return null

    config.variants[index] = { ...config.variants[index]!, ...updates } as ProductVariant
    await this.ctx.storage.put('product_config', config)
    await this.emit('variant.updated', { variant: config.variants[index] })

    return config.variants[index] ?? null
  }

  /**
   * Remove variant
   */
  async removeVariant(variantId: string): Promise<boolean> {
    const config = await this.getProductConfig()
    if (!config) throw new Error('Product not configured')

    const index = config.variants.findIndex((v) => v.id === variantId)
    if (index === -1) return false

    config.variants.splice(index, 1)
    await this.ctx.storage.put('product_config', config)
    await this.emit('variant.removed', { variantId })

    return true
  }

  /**
   * Check inventory for a variant
   */
  async checkInventory(variantId: string): Promise<{ available: boolean; quantity: number }> {
    const config = await this.getProductConfig()
    if (!config) throw new Error('Product not configured')

    const variant = config.variants.find((v) => v.id === variantId)
    if (!variant) throw new Error(`Variant not found: ${variantId}`)

    return {
      available: variant.inventory > 0,
      quantity: variant.inventory,
    }
  }

  /**
   * Reserve inventory
   */
  async reserveInventory(variantId: string, quantity: number): Promise<boolean> {
    const config = await this.getProductConfig()
    if (!config) throw new Error('Product not configured')

    const variant = config.variants.find((v) => v.id === variantId)
    if (!variant) throw new Error(`Variant not found: ${variantId}`)

    if (variant.inventory < quantity) {
      return false
    }

    variant.inventory -= quantity
    await this.ctx.storage.put('product_config', config)
    await this.emit('inventory.reserved', { variantId, quantity })

    return true
  }

  /**
   * Release inventory
   */
  async releaseInventory(variantId: string, quantity: number): Promise<void> {
    const config = await this.getProductConfig()
    if (!config) throw new Error('Product not configured')

    const variant = config.variants.find((v) => v.id === variantId)
    if (!variant) throw new Error(`Variant not found: ${variantId}`)

    variant.inventory += quantity
    await this.ctx.storage.put('product_config', config)
    await this.emit('inventory.released', { variantId, quantity })
  }

  /**
   * Get lowest price across variants
   */
  async getLowestPrice(): Promise<number | null> {
    const config = await this.getProductConfig()
    if (!config || config.variants.length === 0) return null

    return Math.min(...config.variants.map((v) => v.price))
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/config') {
      if (request.method === 'GET') {
        const config = await this.getProductConfig()
        return new Response(JSON.stringify(config), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'PUT') {
        const config = (await request.json()) as ProductConfig
        await this.configure(config)
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/variants') {
      const config = await this.getProductConfig()
      return new Response(JSON.stringify(config?.variants || []), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/variant' && request.method === 'POST') {
      const variant = (await request.json()) as Omit<ProductVariant, 'id'>
      const created = await this.addVariant(variant)
      return new Response(JSON.stringify(created), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/inventory' && request.method === 'POST') {
      const { variantId, quantity, action } = (await request.json()) as {
        variantId: string
        quantity: number
        action: 'reserve' | 'release'
      }

      if (action === 'reserve') {
        const success = await this.reserveInventory(variantId, quantity)
        return new Response(JSON.stringify({ success }), {
          headers: { 'Content-Type': 'application/json' },
        })
      } else {
        await this.releaseInventory(variantId, quantity)
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    return super.fetch(request)
  }
}

export default Product
