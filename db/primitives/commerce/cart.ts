/**
 * Shopping Cart - Cart management primitive
 *
 * Provides shopping cart functionality:
 * - Cart creation and lifecycle
 * - Item management with quantity
 * - Cart TTL and expiration
 * - Item limits and validation
 * - Abandoned cart tracking
 *
 * @module db/primitives/commerce/cart
 */

// =============================================================================
// Types
// =============================================================================

export type CartStatus = 'active' | 'abandoned' | 'converted' | 'expired'

export interface CartItem {
  id: string
  productId: string
  variantId: string
  quantity: number
  price: number
  name?: string
  imageUrl?: string
  metadata?: Record<string, unknown>
}

export interface Cart {
  id: string
  customerId?: string
  items: CartItem[]
  subtotal: number
  itemCount: number
  status: CartStatus
  note?: string
  attributes?: Record<string, unknown>
  orderId?: string
  createdAt: Date
  updatedAt: Date
  lastActivityAt: Date
  expiresAt?: Date
  convertedAt?: Date
}

export interface AddItemInput {
  productId: string
  variantId: string
  quantity: number
  price: number
  name?: string
  imageUrl?: string
  metadata?: Record<string, unknown>
}

export interface CreateCartInput {
  customerId?: string
}

export interface CartOptions {
  defaultTTL?: number
  extendTTLOnActivity?: boolean
  maxItemsPerCart?: number
  maxQuantityPerItem?: number
  maxCartTotal?: number
  abandonedThreshold?: number
  onCartAbandoned?: (cart: Cart) => void
}

export interface CartSnapshot extends Cart {
  convertedAt: Date
}

// =============================================================================
// CartManager Interface
// =============================================================================

export interface CartManager {
  // Cart lifecycle
  createCart(input?: CreateCartInput): Promise<Cart>
  getCart(id: string): Promise<Cart | null>
  getCartByCustomer(customerId: string): Promise<Cart | null>
  deleteCart(id: string): Promise<void>
  clearCart(id: string): Promise<void>
  mergeCarts(sourceId: string, targetId: string): Promise<Cart>

  // Item management
  addItem(cartId: string, input: AddItemInput): Promise<CartItem>
  updateItemQuantity(cartId: string, itemId: string, quantity: number): Promise<void>
  removeItem(cartId: string, itemId: string): Promise<void>

  // TTL management
  extendCartTTL(cartId: string, additionalMs: number): Promise<Cart>
  cleanupExpiredCarts(): Promise<number>

  // Abandoned cart
  checkAbandonedCarts(): Promise<void>
  getAbandonedCarts(): Promise<Cart[]>
  recoverCart(cartId: string): Promise<Cart>

  // Conversion
  markAsConverted(cartId: string, orderId: string): Promise<CartSnapshot>

  // Notes and attributes
  setCartNote(cartId: string, note: string): Promise<void>
  setCartAttributes(cartId: string, attributes: Record<string, unknown>): Promise<void>
  setCartAttribute(cartId: string, key: string, value: unknown): Promise<void>
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}_${timestamp}${random}`
}

// =============================================================================
// Implementation
// =============================================================================

class InMemoryCartManager implements CartManager {
  private carts: Map<string, Cart> = new Map()
  private options: CartOptions

  constructor(options?: CartOptions) {
    this.options = options ?? {}
  }

  private calculateTotals(items: CartItem[]): { subtotal: number; itemCount: number } {
    let subtotal = 0
    let itemCount = 0
    for (const item of items) {
      subtotal += item.price * item.quantity
      itemCount += item.quantity
    }
    return { subtotal, itemCount }
  }

  private getItemKey(productId: string, variantId: string): string {
    return `${productId}:${variantId}`
  }

  private checkExpiration(cart: Cart): boolean {
    if (cart.expiresAt && new Date() >= cart.expiresAt) {
      return true
    }
    return false
  }

  private checkAbandoned(cart: Cart): boolean {
    if (!this.options.abandonedThreshold) return false
    if (cart.items.length === 0) return false
    if (cart.status !== 'active') return false

    const threshold = this.options.abandonedThreshold
    const lastActivity = cart.lastActivityAt.getTime()
    return Date.now() - lastActivity > threshold
  }

  private updateActivity(cart: Cart): Cart {
    const updated = {
      ...cart,
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    }

    if (this.options.extendTTLOnActivity && this.options.defaultTTL) {
      updated.expiresAt = new Date(Date.now() + this.options.defaultTTL)
    }

    return updated
  }

  async createCart(input?: CreateCartInput): Promise<Cart> {
    const now = new Date()
    const cart: Cart = {
      id: generateId('cart'),
      customerId: input?.customerId,
      items: [],
      subtotal: 0,
      itemCount: 0,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    }

    if (this.options.defaultTTL) {
      cart.expiresAt = new Date(now.getTime() + this.options.defaultTTL)
    }

    this.carts.set(cart.id, cart)
    return cart
  }

  async getCart(id: string): Promise<Cart | null> {
    const cart = this.carts.get(id)
    if (!cart) return null

    // Check expiration
    if (this.checkExpiration(cart)) {
      cart.status = 'expired'
      this.carts.set(id, cart)
      return null
    }

    // Check abandoned
    if (this.checkAbandoned(cart)) {
      cart.status = 'abandoned'
      this.carts.set(id, cart)
    }

    return cart
  }

  async getCartByCustomer(customerId: string): Promise<Cart | null> {
    for (const cart of this.carts.values()) {
      if (cart.customerId === customerId && cart.status === 'active') {
        return this.getCart(cart.id)
      }
    }
    return null
  }

  async deleteCart(id: string): Promise<void> {
    this.carts.delete(id)
  }

  async clearCart(id: string): Promise<void> {
    const cart = await this.getCart(id)
    if (!cart) {
      throw new Error('Cart not found')
    }

    const updated: Cart = {
      ...cart,
      items: [],
      subtotal: 0,
      itemCount: 0,
      updatedAt: new Date(),
      lastActivityAt: new Date(),
    }

    this.carts.set(id, updated)
  }

  async mergeCarts(sourceId: string, targetId: string): Promise<Cart> {
    const source = await this.getCart(sourceId)
    const target = await this.getCart(targetId)

    if (!source || !target) {
      throw new Error('Cart not found')
    }

    // Create a map of items by key
    const itemMap = new Map<string, CartItem>()

    // Add target items first
    for (const item of target.items) {
      const key = this.getItemKey(item.productId, item.variantId)
      itemMap.set(key, { ...item })
    }

    // Merge source items
    for (const item of source.items) {
      const key = this.getItemKey(item.productId, item.variantId)
      const existing = itemMap.get(key)
      if (existing) {
        existing.quantity += item.quantity
      } else {
        itemMap.set(key, { ...item, id: generateId('item') })
      }
    }

    const mergedItems = Array.from(itemMap.values())
    const { subtotal, itemCount } = this.calculateTotals(mergedItems)

    const merged: Cart = {
      ...target,
      items: mergedItems,
      subtotal,
      itemCount,
      updatedAt: new Date(),
      lastActivityAt: new Date(),
    }

    this.carts.set(targetId, merged)

    // Delete source cart
    this.carts.delete(sourceId)

    return merged
  }

  async addItem(cartId: string, input: AddItemInput): Promise<CartItem> {
    const cart = await this.getCart(cartId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    if (cart.status === 'converted') {
      throw new Error('Cannot modify converted cart')
    }

    // Validate quantity
    if (input.quantity <= 0) {
      throw new Error('Invalid quantity')
    }

    // Check max quantity per item
    if (
      this.options.maxQuantityPerItem &&
      input.quantity > this.options.maxQuantityPerItem
    ) {
      throw new Error('Maximum quantity exceeded')
    }

    // Find existing item
    const key = this.getItemKey(input.productId, input.variantId)
    const existingIndex = cart.items.findIndex(
      (i) => this.getItemKey(i.productId, i.variantId) === key
    )

    let item: CartItem
    const items = [...cart.items]

    if (existingIndex >= 0) {
      // Update existing item
      const existing = items[existingIndex]
      const newQuantity = existing.quantity + input.quantity

      if (
        this.options.maxQuantityPerItem &&
        newQuantity > this.options.maxQuantityPerItem
      ) {
        throw new Error('Maximum quantity exceeded')
      }

      items[existingIndex] = {
        ...existing,
        quantity: newQuantity,
      }
      item = items[existingIndex]
    } else {
      // Check max items
      if (
        this.options.maxItemsPerCart &&
        items.length >= this.options.maxItemsPerCart
      ) {
        throw new Error('Maximum items limit reached')
      }

      // Add new item
      item = {
        id: generateId('item'),
        productId: input.productId,
        variantId: input.variantId,
        quantity: input.quantity,
        price: input.price,
        name: input.name,
        imageUrl: input.imageUrl,
        metadata: input.metadata,
      }
      items.push(item)
    }

    const { subtotal, itemCount } = this.calculateTotals(items)

    // Check max cart total
    if (this.options.maxCartTotal && subtotal > this.options.maxCartTotal) {
      throw new Error('Cart total limit exceeded')
    }

    const updated = this.updateActivity({
      ...cart,
      items,
      subtotal,
      itemCount,
    })

    this.carts.set(cartId, updated)
    return item
  }

  async updateItemQuantity(
    cartId: string,
    itemId: string,
    quantity: number
  ): Promise<void> {
    const cart = await this.getCart(cartId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    if (cart.status === 'converted') {
      throw new Error('Cannot modify converted cart')
    }

    if (quantity < 0) {
      throw new Error('Invalid quantity')
    }

    if (
      this.options.maxQuantityPerItem &&
      quantity > this.options.maxQuantityPerItem
    ) {
      throw new Error('Maximum quantity exceeded')
    }

    let items = [...cart.items]
    const itemIndex = items.findIndex((i) => i.id === itemId)

    if (itemIndex === -1) {
      throw new Error('Item not found')
    }

    if (quantity === 0) {
      items.splice(itemIndex, 1)
    } else {
      items[itemIndex] = { ...items[itemIndex], quantity }
    }

    const { subtotal, itemCount } = this.calculateTotals(items)

    const updated = this.updateActivity({
      ...cart,
      items,
      subtotal,
      itemCount,
    })

    this.carts.set(cartId, updated)
  }

  async removeItem(cartId: string, itemId: string): Promise<void> {
    const cart = await this.getCart(cartId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    if (cart.status === 'converted') {
      throw new Error('Cannot modify converted cart')
    }

    const items = cart.items.filter((i) => i.id !== itemId)
    const { subtotal, itemCount } = this.calculateTotals(items)

    const updated = this.updateActivity({
      ...cart,
      items,
      subtotal,
      itemCount,
    })

    this.carts.set(cartId, updated)
  }

  async extendCartTTL(cartId: string, additionalMs: number): Promise<Cart> {
    const cart = await this.getCart(cartId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    const baseTime = cart.expiresAt?.getTime() ?? Date.now()
    const updated: Cart = {
      ...cart,
      expiresAt: new Date(baseTime + additionalMs),
      updatedAt: new Date(),
    }

    this.carts.set(cartId, updated)
    return updated
  }

  async cleanupExpiredCarts(): Promise<number> {
    let count = 0
    const now = new Date()

    for (const [id, cart] of this.carts) {
      if (cart.expiresAt && now >= cart.expiresAt) {
        this.carts.delete(id)
        count++
      }
    }

    return count
  }

  async checkAbandonedCarts(): Promise<void> {
    if (!this.options.abandonedThreshold) return

    for (const cart of this.carts.values()) {
      if (this.checkAbandoned(cart) && cart.status === 'active') {
        cart.status = 'abandoned'
        this.carts.set(cart.id, cart)

        if (this.options.onCartAbandoned) {
          this.options.onCartAbandoned(cart)
        }
      }
    }
  }

  async getAbandonedCarts(): Promise<Cart[]> {
    const abandoned: Cart[] = []

    for (const cart of this.carts.values()) {
      // Check and update status
      if (this.checkAbandoned(cart)) {
        cart.status = 'abandoned'
        this.carts.set(cart.id, cart)
      }

      if (cart.status === 'abandoned') {
        abandoned.push(cart)
      }
    }

    return abandoned
  }

  async recoverCart(cartId: string): Promise<Cart> {
    const cart = this.carts.get(cartId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    const updated = this.updateActivity({
      ...cart,
      status: 'active',
    })

    this.carts.set(cartId, updated)
    return updated
  }

  async markAsConverted(cartId: string, orderId: string): Promise<CartSnapshot> {
    const cart = await this.getCart(cartId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    const convertedAt = new Date()
    const snapshot: CartSnapshot = {
      ...cart,
      status: 'converted',
      orderId,
      convertedAt,
      updatedAt: convertedAt,
    }

    this.carts.set(cartId, snapshot)
    return snapshot
  }

  async setCartNote(cartId: string, note: string): Promise<void> {
    const cart = await this.getCart(cartId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    const updated = this.updateActivity({
      ...cart,
      note,
    })

    this.carts.set(cartId, updated)
  }

  async setCartAttributes(
    cartId: string,
    attributes: Record<string, unknown>
  ): Promise<void> {
    const cart = await this.getCart(cartId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    const updated = this.updateActivity({
      ...cart,
      attributes,
    })

    this.carts.set(cartId, updated)
  }

  async setCartAttribute(
    cartId: string,
    key: string,
    value: unknown
  ): Promise<void> {
    const cart = await this.getCart(cartId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    const attributes = { ...(cart.attributes ?? {}), [key]: value }
    const updated = this.updateActivity({
      ...cart,
      attributes,
    })

    this.carts.set(cartId, updated)
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createCartManager(options?: CartOptions): CartManager {
  return new InMemoryCartManager(options)
}
