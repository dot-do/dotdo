/**
 * CartDO - Shopping Cart Durable Object
 *
 * Manages shopping cart state for a single customer.
 * Each customer gets their own Cart DO instance (keyed by customerId).
 *
 * Responsibilities:
 * - Add/update/remove items
 * - Set shipping and billing addresses
 * - Apply promo codes
 * - Calculate subtotals
 *
 * Events Emitted:
 * - Cart.updated - When cart contents change
 * - Cart.cleared - When cart is emptied
 */

import { DO } from 'dotdo'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface CartItem {
  sku: string
  name: string
  price: number
  quantity: number
  weight?: number
  category?: string
}

export interface Address {
  street: string
  city: string
  state: string
  zip: string
  country: string
}

export interface Cart {
  id: string
  customerId: string
  items: CartItem[]
  shippingAddress?: Address
  billingAddress?: Address
  promoCode?: string
  shippingMethod?: string
  createdAt: Date
  updatedAt: Date
}

export class CartError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'CartError'
  }
}

// ============================================================================
// CART DURABLE OBJECT
// ============================================================================

export class CartDO extends DO {
  static readonly $type = 'CartDO'

  /**
   * Register event handlers on startup.
   */
  async onStart() {
    // Track cart activity for analytics
    this.$.on.Cart.updated(async (event) => {
      const { cartId, itemCount, subtotal } = event.data as {
        cartId: string
        itemCount: number
        subtotal: number
      }
      console.log(`[Cart.updated] Cart ${cartId}: ${itemCount} items, $${subtotal.toFixed(2)}`)
    })

    console.log('[CartDO] Event handlers registered')
  }

  // ==========================================================================
  // CART MANAGEMENT
  // ==========================================================================

  /**
   * Get or create cart for this customer.
   */
  async getCart(): Promise<Cart> {
    let cart = await this.ctx.storage.get<Cart>('cart')
    if (!cart) {
      cart = {
        id: `cart_${crypto.randomUUID().slice(0, 8)}`,
        customerId: this.ns,
        items: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      await this.ctx.storage.put('cart', cart)
    }
    return cart
  }

  /**
   * Add item to cart.
   */
  async addItem(item: CartItem): Promise<Cart> {
    const cart = await this.getCart()

    // Check if item already exists
    const existingIndex = cart.items.findIndex((i) => i.sku === item.sku)
    if (existingIndex >= 0) {
      cart.items[existingIndex].quantity += item.quantity
    } else {
      cart.items.push(item)
    }

    cart.updatedAt = new Date()
    await this.ctx.storage.put('cart', cart)

    // Emit cart updated event
    const subtotal = this.calculateSubtotal(cart.items)
    this.$.send('Cart.updated', {
      cartId: cart.id,
      customerId: cart.customerId,
      itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
      subtotal,
    })

    return cart
  }

  /**
   * Update item quantity in cart.
   */
  async updateItem(sku: string, quantity: number): Promise<Cart> {
    const cart = await this.getCart()

    const item = cart.items.find((i) => i.sku === sku)
    if (!item) {
      throw new CartError(`Item ${sku} not in cart`, 'ITEM_NOT_FOUND')
    }

    if (quantity <= 0) {
      cart.items = cart.items.filter((i) => i.sku !== sku)
    } else {
      item.quantity = quantity
    }

    cart.updatedAt = new Date()
    await this.ctx.storage.put('cart', cart)

    // Emit cart updated event
    const subtotal = this.calculateSubtotal(cart.items)
    this.$.send('Cart.updated', {
      cartId: cart.id,
      customerId: cart.customerId,
      itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
      subtotal,
    })

    return cart
  }

  /**
   * Remove item from cart.
   */
  async removeItem(sku: string): Promise<Cart> {
    return this.updateItem(sku, 0)
  }

  /**
   * Clear the cart.
   */
  async clear(): Promise<void> {
    const cart = await this.getCart()
    const cartId = cart.id
    const customerId = cart.customerId

    cart.items = []
    cart.promoCode = undefined
    cart.updatedAt = new Date()
    await this.ctx.storage.put('cart', cart)

    this.$.send('Cart.cleared', { cartId, customerId })
  }

  /**
   * Set shipping address.
   */
  async setShippingAddress(address: Address): Promise<Cart> {
    const cart = await this.getCart()
    cart.shippingAddress = address
    cart.updatedAt = new Date()
    await this.ctx.storage.put('cart', cart)
    return cart
  }

  /**
   * Set billing address.
   */
  async setBillingAddress(address: Address): Promise<Cart> {
    const cart = await this.getCart()
    cart.billingAddress = address
    cart.updatedAt = new Date()
    await this.ctx.storage.put('cart', cart)
    return cart
  }

  /**
   * Set shipping method.
   */
  async setShippingMethod(method: string): Promise<Cart> {
    const cart = await this.getCart()
    cart.shippingMethod = method
    cart.updatedAt = new Date()
    await this.ctx.storage.put('cart', cart)
    return cart
  }

  /**
   * Apply promo code (validation happens in CheckoutDO).
   */
  async setPromoCode(code: string): Promise<Cart> {
    const cart = await this.getCart()
    cart.promoCode = code.toUpperCase()
    cart.updatedAt = new Date()
    await this.ctx.storage.put('cart', cart)
    return cart
  }

  /**
   * Remove promo code.
   */
  async removePromoCode(): Promise<Cart> {
    const cart = await this.getCart()
    cart.promoCode = undefined
    cart.updatedAt = new Date()
    await this.ctx.storage.put('cart', cart)
    return cart
  }

  /**
   * Calculate subtotal for items.
   */
  calculateSubtotal(items: CartItem[]): number {
    return items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  }

  /**
   * Get cart summary for checkout.
   */
  async getSummary(): Promise<{
    id: string
    customerId: string
    items: CartItem[]
    itemCount: number
    subtotal: number
    shippingAddress?: Address
    billingAddress?: Address
    promoCode?: string
    shippingMethod?: string
  }> {
    const cart = await this.getCart()
    return {
      id: cart.id,
      customerId: cart.customerId,
      items: cart.items,
      itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
      subtotal: this.calculateSubtotal(cart.items),
      shippingAddress: cart.shippingAddress,
      billingAddress: cart.billingAddress,
      promoCode: cart.promoCode,
      shippingMethod: cart.shippingMethod,
    }
  }
}
