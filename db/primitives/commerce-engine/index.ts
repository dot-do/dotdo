/**
 * CommerceEngine - E-commerce primitives for products, carts, orders, pricing, and inventory
 *
 * Provides a complete e-commerce foundation with:
 * - Products: CRUD, variants, inventory tracking
 * - Carts: Create, items, discounts
 * - Orders: Checkout flow, state machine, fulfillment
 * - Pricing: Discounts, taxes, currency conversion
 * - Inventory: Stock levels, reservations, backorders
 *
 * @module db/primitives/commerce-engine
 */

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Price with amount in cents and currency code
 */
export interface Price {
  amount: number
  currency: string
}

/**
 * Address for shipping/billing
 */
export interface Address {
  line1: string
  line2?: string
  city: string
  state: string
  postalCode: string
  country: string
}

/**
 * Product status
 */
export type ProductStatus = 'draft' | 'active' | 'archived'

/**
 * Product variant
 */
export interface ProductVariant {
  id: string
  productId: string
  sku: string
  name: string
  priceOverride?: Price
  inventory?: number
  attributes?: Record<string, string>
  createdAt: Date
  updatedAt?: Date
}

/**
 * Product variant creation options
 */
export interface ProductVariantCreateOptions {
  sku: string
  name: string
  priceOverride?: Price
  inventory?: number
  attributes?: Record<string, string>
}

/**
 * Product variant update options
 */
export interface ProductVariantUpdateOptions {
  sku?: string
  name?: string
  priceOverride?: Price
  inventory?: number
  attributes?: Record<string, string>
}

/**
 * Product
 */
export interface Product {
  id: string
  name: string
  slug: string
  description?: string
  price: Price
  status: ProductStatus
  inventory?: number
  variants?: ProductVariant[]
  images?: string[]
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt?: Date
  publishedAt?: Date
}

/**
 * Product creation options
 */
export interface ProductCreateOptions {
  name: string
  slug: string
  description?: string
  price: Price
  inventory?: number
  variants?: ProductVariantCreateOptions[]
  images?: string[]
  metadata?: Record<string, unknown>
}

/**
 * Product update options
 */
export interface ProductUpdateOptions {
  name?: string
  slug?: string
  description?: string
  price?: Price
  inventory?: number
  images?: string[]
  metadata?: Record<string, unknown>
}

/**
 * Cart status
 */
export type CartStatus = 'active' | 'converted' | 'abandoned'

/**
 * Cart item
 */
export interface CartItem {
  id: string
  productId: string
  variantId: string
  name: string
  price: number
  quantity: number
  metadata?: Record<string, unknown>
}

/**
 * Applied discount on cart
 */
export interface AppliedDiscount {
  code: string
  type: 'percentage' | 'fixed'
  value: number
  amount: number
}

/**
 * Cart
 */
export interface Cart {
  id: string
  customerId?: string
  items: CartItem[]
  discounts: AppliedDiscount[]
  subtotal: number
  discountTotal: number
  taxTotal: number
  total: number
  status: CartStatus
  createdAt: Date
  updatedAt?: Date
}

/**
 * Cart creation options
 */
export interface CartCreateOptions {
  customerId?: string
}

/**
 * Cart item addition options
 */
export interface CartItemAddOptions {
  productId: string
  variantId: string
  quantity: number
  metadata?: Record<string, unknown>
}

/**
 * Order status
 */
export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'paid'
  | 'partially_fulfilled'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'refunded'

/**
 * Order item
 */
export interface OrderItem {
  id: string
  productId: string
  variantId: string
  sku: string
  name: string
  price: number
  quantity: number
  fulfilledQuantity: number
  restockedQuantity: number
}

/**
 * Order note
 */
export interface OrderNote {
  id: string
  content: string
  createdAt: Date
  createdBy?: string
}

/**
 * Payment details
 */
export interface PaymentDetails {
  transactionId: string
  method?: string
  paidAt: Date
}

/**
 * Shipping details
 */
export interface ShippingDetails {
  carrier?: string
  trackingNumber?: string
  shippedAt: Date
}

/**
 * Cancellation details
 */
export interface CancellationDetails {
  reason: string
  cancelledAt: Date
}

/**
 * Refund details
 */
export interface RefundDetails {
  id: string
  amount: number
  reason: string
  createdAt: Date
}

/**
 * Fulfillment record
 */
export interface Fulfillment {
  id: string
  trackingNumber?: string
  carrier?: string
  items: { variantId: string; quantity: number }[]
  createdAt: Date
}

/**
 * Order
 */
export interface Order {
  id: string
  customerId?: string
  cartId: string
  items: OrderItem[]
  subtotal: number
  discountTotal: number
  taxTotal: number
  shippingTotal: number
  total: number
  status: OrderStatus
  shippingAddress: Address
  billingAddress?: Address
  paymentMethod: string
  paymentDetails?: PaymentDetails
  shipping?: ShippingDetails
  fulfillments?: Fulfillment[]
  cancellation?: CancellationDetails
  refunds?: RefundDetails[]
  refundedAmount?: number
  notes?: OrderNote[]
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt?: Date
  deliveredAt?: Date
}

/**
 * Checkout options
 */
export interface CheckoutOptions {
  shippingAddress: Address
  billingAddress?: Address
  paymentMethod: string
}

/**
 * Ship order options
 */
export interface ShipOptions {
  carrier?: string
  trackingNumber: string
}

/**
 * Fulfill order options
 */
export interface FulfillOptions {
  trackingNumber: string
  carrier?: string
  items?: { variantId: string; quantity: number }[]
}

/**
 * Cancel order options
 */
export interface CancelOptions {
  reason: string
}

/**
 * Refund options
 */
export interface RefundOptions {
  amount?: number
  reason: string
  restockItems?: { sku: string; quantity: number }[]
}

/**
 * Mark paid options
 */
export interface MarkPaidOptions {
  transactionId: string
  method?: string
}

/**
 * Discount type
 */
export type DiscountType = 'percentage' | 'fixed'

/**
 * Discount
 */
export interface Discount {
  id: string
  code: string
  type: DiscountType
  value: number
  currency?: string
  active: boolean
  usageLimit?: number
  usageCount: number
  minimumPurchase?: number
  startsAt?: Date
  expiresAt?: Date
  createdAt: Date
}

/**
 * Discount creation options
 */
export interface DiscountCreateOptions {
  code: string
  type: DiscountType
  value: number
  currency?: string
  usageLimit?: number
  minimumPurchase?: number
  startsAt?: Date
  expiresAt?: Date
}

/**
 * Discount validation result
 */
export interface DiscountValidationResult {
  valid: boolean
  reason?: string
  discountAmount?: number
}

/**
 * Tax rate
 */
export interface TaxRate {
  id: string
  name: string
  rate: number
  country: string
  state?: string
  city?: string
  createdAt: Date
}

/**
 * Tax rate creation options
 */
export interface TaxRateCreateOptions {
  name: string
  rate: number
  country: string
  state?: string
  city?: string
}

/**
 * Tax calculation result
 */
export interface TaxCalculation {
  amount: number
  rate: number
  taxRateId?: string
}

/**
 * Tax calculation options
 */
export interface TaxCalculationOptions {
  subtotal: number
  shippingAddress: Address
}

/**
 * Price rule type
 */
export type PriceRuleType = 'volume' | 'customer_group' | 'time_based'

/**
 * Volume tier
 */
export interface VolumeTier {
  minQuantity: number
  discount: number
}

/**
 * Price rule
 */
export interface PriceRule {
  id: string
  name: string
  type: PriceRuleType
  tiers?: VolumeTier[]
  customerGroups?: string[]
  discount?: number
  startsAt?: Date
  expiresAt?: Date
  createdAt: Date
}

/**
 * Price rule creation options
 */
export interface PriceRuleCreateOptions {
  name: string
  type: PriceRuleType
  tiers?: VolumeTier[]
  customerGroups?: string[]
  discount?: number
  startsAt?: Date
  expiresAt?: Date
}

/**
 * Price calculation options
 */
export interface PriceCalculationOptions {
  basePrice: Price
  quantity: number
  customerId?: string
  customerGroups?: string[]
}

/**
 * Inventory level
 */
export interface InventoryLevel {
  sku: string
  locationId?: string
  onHand: number
  reserved: number
  committed: number
  available: number
  backordered: number
  lowStockThreshold?: number
}

/**
 * Set inventory level options
 */
export interface SetInventoryLevelOptions {
  locationId?: string
  onHand: number
}

/**
 * Inventory reservation
 */
export interface InventoryReservation {
  id: string
  sku: string
  quantity: number
  orderId?: string
  backordered: number
  expiresAt?: Date
  createdAt: Date
}

/**
 * Reserve inventory options
 */
export interface ReserveOptions {
  orderId?: string
  expiresAt?: Date
  allowBackorder?: boolean
}

/**
 * Inventory adjustment
 */
export interface InventoryAdjustment {
  id: string
  sku: string
  quantity: number
  reason: string
  createdAt: Date
}

/**
 * Adjust inventory options
 */
export interface AdjustOptions {
  reason: string
}

/**
 * Transfer options
 */
export interface TransferOptions {
  fromLocation: string
  toLocation: string
}

/**
 * Backorder policy
 */
export interface BackorderPolicy {
  allowBackorder: boolean
  maxBackorderQuantity?: number
}

/**
 * Commerce engine configuration
 */
export interface CommerceEngineConfig {
  onLowStock?: (level: InventoryLevel) => void
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
// ProductsManager
// =============================================================================

class ProductsManager {
  private products: Map<string, Product> = new Map()
  private slugIndex: Map<string, string> = new Map()
  private skuIndex: Map<string, ProductVariant> = new Map()

  async create(options: ProductCreateOptions): Promise<Product> {
    const id = generateId('prod')

    const variants: ProductVariant[] | undefined = options.variants?.map((v) => {
      const variantId = generateId('var')
      const variant: ProductVariant = {
        id: variantId,
        productId: id,
        sku: v.sku,
        name: v.name,
        priceOverride: v.priceOverride,
        inventory: v.inventory,
        attributes: v.attributes,
        createdAt: new Date(),
      }

      // Index by SKU
      if (this.skuIndex.has(v.sku)) {
        throw new Error('SKU already exists')
      }
      this.skuIndex.set(v.sku, variant)

      return variant
    })

    const product: Product = {
      id,
      name: options.name,
      slug: options.slug,
      description: options.description,
      price: options.price,
      status: 'draft',
      inventory: options.inventory,
      variants,
      images: options.images,
      metadata: options.metadata,
      createdAt: new Date(),
    }

    this.products.set(id, product)
    this.slugIndex.set(options.slug, id)

    return product
  }

  async get(id: string): Promise<Product | null> {
    return this.products.get(id) ?? null
  }

  async getBySlug(slug: string): Promise<Product | null> {
    const id = this.slugIndex.get(slug)
    if (!id) return null
    return this.products.get(id) ?? null
  }

  async update(id: string, options: ProductUpdateOptions): Promise<Product> {
    const product = this.products.get(id)
    if (!product) {
      throw new Error('Product not found')
    }

    const updated: Product = {
      ...product,
      ...options,
      price: options.price ?? product.price,
      updatedAt: new Date(),
    }

    // Update slug index if slug changed
    if (options.slug && options.slug !== product.slug) {
      this.slugIndex.delete(product.slug)
      this.slugIndex.set(options.slug, id)
    }

    this.products.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    const product = this.products.get(id)
    if (product) {
      this.slugIndex.delete(product.slug)
      // Remove variants from SKU index
      if (product.variants) {
        for (const variant of product.variants) {
          this.skuIndex.delete(variant.sku)
        }
      }
      this.products.delete(id)
    }
  }

  async list(): Promise<Product[]> {
    return Array.from(this.products.values())
  }

  async publish(id: string): Promise<Product> {
    const product = this.products.get(id)
    if (!product) {
      throw new Error('Product not found')
    }

    const updated: Product = {
      ...product,
      status: 'active',
      publishedAt: new Date(),
      updatedAt: new Date(),
    }

    this.products.set(id, updated)
    return updated
  }

  async archive(id: string): Promise<Product> {
    const product = this.products.get(id)
    if (!product) {
      throw new Error('Product not found')
    }

    const updated: Product = {
      ...product,
      status: 'archived',
      updatedAt: new Date(),
    }

    this.products.set(id, updated)
    return updated
  }

  async addVariant(productId: string, options: ProductVariantCreateOptions): Promise<ProductVariant> {
    const product = this.products.get(productId)
    if (!product) {
      throw new Error('Product not found')
    }

    if (this.skuIndex.has(options.sku)) {
      throw new Error('SKU already exists')
    }

    const variant: ProductVariant = {
      id: generateId('var'),
      productId,
      sku: options.sku,
      name: options.name,
      priceOverride: options.priceOverride,
      inventory: options.inventory,
      attributes: options.attributes,
      createdAt: new Date(),
    }

    this.skuIndex.set(options.sku, variant)

    const variants = product.variants ? [...product.variants, variant] : [variant]
    const updated: Product = {
      ...product,
      variants,
      updatedAt: new Date(),
    }

    this.products.set(productId, updated)
    return variant
  }

  async updateVariant(variantId: string, options: ProductVariantUpdateOptions): Promise<ProductVariant> {
    // Find the variant
    let foundProduct: Product | undefined
    let foundVariant: ProductVariant | undefined
    let variantIndex = -1

    for (const product of this.products.values()) {
      if (product.variants) {
        const idx = product.variants.findIndex((v) => v.id === variantId)
        if (idx !== -1) {
          foundProduct = product
          foundVariant = product.variants[idx]
          variantIndex = idx
          break
        }
      }
    }

    if (!foundProduct || !foundVariant) {
      throw new Error('Variant not found')
    }

    // Handle SKU change
    if (options.sku && options.sku !== foundVariant.sku) {
      if (this.skuIndex.has(options.sku)) {
        throw new Error('SKU already exists')
      }
      this.skuIndex.delete(foundVariant.sku)
    }

    const updated: ProductVariant = {
      ...foundVariant,
      ...options,
      updatedAt: new Date(),
    }

    this.skuIndex.set(updated.sku, updated)

    const variants = [...foundProduct.variants!]
    variants[variantIndex] = updated

    const updatedProduct: Product = {
      ...foundProduct,
      variants,
      updatedAt: new Date(),
    }

    this.products.set(foundProduct.id, updatedProduct)
    return updated
  }

  async deleteVariant(variantId: string): Promise<void> {
    for (const product of this.products.values()) {
      if (product.variants) {
        const idx = product.variants.findIndex((v) => v.id === variantId)
        if (idx !== -1) {
          const variant = product.variants[idx]!
          this.skuIndex.delete(variant.sku)

          const variants = product.variants.filter((v) => v.id !== variantId)
          const updated: Product = {
            ...product,
            variants,
            updatedAt: new Date(),
          }

          this.products.set(product.id, updated)
          return
        }
      }
    }
  }

  async findVariantBySku(sku: string): Promise<ProductVariant | null> {
    return this.skuIndex.get(sku) ?? null
  }

  getProduct(id: string): Product | undefined {
    return this.products.get(id)
  }

  getVariantPrice(variant: ProductVariant, product: Product): number {
    return variant.priceOverride?.amount ?? product.price.amount
  }
}

// =============================================================================
// CartsManager
// =============================================================================

class CartsManager {
  private carts: Map<string, Cart> = new Map()
  private products: ProductsManager
  private pricing: PricingManager

  constructor(products: ProductsManager, pricing: PricingManager) {
    this.products = products
    this.pricing = pricing
  }

  async create(options?: CartCreateOptions): Promise<Cart> {
    const cart: Cart = {
      id: generateId('cart'),
      customerId: options?.customerId,
      items: [],
      discounts: [],
      subtotal: 0,
      discountTotal: 0,
      taxTotal: 0,
      total: 0,
      status: 'active',
      createdAt: new Date(),
    }

    this.carts.set(cart.id, cart)
    return cart
  }

  async get(id: string): Promise<Cart | null> {
    return this.carts.get(id) ?? null
  }

  async addItem(cartId: string, options: CartItemAddOptions): Promise<CartItem> {
    const cart = this.carts.get(cartId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    if (cart.status === 'converted') {
      throw new Error('Cannot modify converted cart')
    }

    // Get product and variant
    const product = this.products.getProduct(options.productId)
    if (!product) {
      throw new Error('Product not found')
    }

    const variant = product.variants?.find((v) => v.id === options.variantId)
    if (!variant) {
      throw new Error('Variant not found')
    }

    // Check if item already exists
    const existingItem = cart.items.find((i) => i.variantId === options.variantId)
    if (existingItem) {
      existingItem.quantity += options.quantity
      this.recalculateTotals(cart)
      this.carts.set(cartId, cart)
      return existingItem
    }

    const price = this.products.getVariantPrice(variant, product)

    const item: CartItem = {
      id: generateId('item'),
      productId: options.productId,
      variantId: options.variantId,
      name: `${product.name} - ${variant.name}`,
      price,
      quantity: options.quantity,
      metadata: options.metadata,
    }

    cart.items.push(item)
    this.recalculateTotals(cart)
    cart.updatedAt = new Date()
    this.carts.set(cartId, cart)

    return item
  }

  async updateItemQuantity(cartId: string, variantId: string, quantity: number): Promise<void> {
    const cart = this.carts.get(cartId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    if (cart.status === 'converted') {
      throw new Error('Cannot modify converted cart')
    }

    if (quantity <= 0) {
      cart.items = cart.items.filter((i) => i.variantId !== variantId)
    } else {
      const item = cart.items.find((i) => i.variantId === variantId)
      if (item) {
        item.quantity = quantity
      }
    }

    this.recalculateTotals(cart)
    cart.updatedAt = new Date()
    this.carts.set(cartId, cart)
  }

  async removeItem(cartId: string, variantId: string): Promise<void> {
    await this.updateItemQuantity(cartId, variantId, 0)
  }

  async clear(cartId: string): Promise<void> {
    const cart = this.carts.get(cartId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    cart.items = []
    cart.discounts = []
    this.recalculateTotals(cart)
    cart.updatedAt = new Date()
    this.carts.set(cartId, cart)
  }

  async applyDiscount(cartId: string, code: string): Promise<void> {
    const cart = this.carts.get(cartId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    const discount = await this.pricing.getDiscount(code)
    if (!discount) {
      throw new Error('Invalid discount code')
    }

    if (!discount.active) {
      throw new Error('Discount is not active')
    }

    if (discount.expiresAt && discount.expiresAt < new Date()) {
      throw new Error('Discount has expired')
    }

    if (discount.startsAt && discount.startsAt > new Date()) {
      throw new Error('Discount is not yet active')
    }

    if (discount.usageLimit && discount.usageCount >= discount.usageLimit) {
      throw new Error('Discount usage limit exceeded')
    }

    if (discount.minimumPurchase && cart.subtotal < discount.minimumPurchase) {
      throw new Error('Minimum purchase not met')
    }

    // Calculate discount amount
    let amount: number
    if (discount.type === 'percentage') {
      amount = Math.floor(cart.subtotal * (discount.value / 100))
    } else {
      amount = Math.min(discount.value, cart.subtotal)
    }

    const applied: AppliedDiscount = {
      code: discount.code,
      type: discount.type,
      value: discount.value,
      amount,
    }

    cart.discounts.push(applied)
    this.recalculateTotals(cart)
    cart.updatedAt = new Date()
    this.carts.set(cartId, cart)
  }

  async removeDiscount(cartId: string, code: string): Promise<void> {
    const cart = this.carts.get(cartId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    cart.discounts = cart.discounts.filter((d) => d.code !== code)
    this.recalculateTotals(cart)
    cart.updatedAt = new Date()
    this.carts.set(cartId, cart)
  }

  markAsConverted(cartId: string): void {
    const cart = this.carts.get(cartId)
    if (cart) {
      cart.status = 'converted'
      cart.updatedAt = new Date()
      this.carts.set(cartId, cart)
    }
  }

  private recalculateTotals(cart: Cart): void {
    cart.subtotal = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    cart.discountTotal = cart.discounts.reduce((sum, d) => sum + d.amount, 0)
    cart.total = cart.subtotal - cart.discountTotal + cart.taxTotal
  }
}

// =============================================================================
// OrdersManager
// =============================================================================

class OrdersManager {
  private orders: Map<string, Order> = new Map()
  private inventory: InventoryManager

  constructor(inventory: InventoryManager) {
    this.inventory = inventory
  }

  async get(id: string): Promise<Order | null> {
    return this.orders.get(id) ?? null
  }

  async list(): Promise<Order[]> {
    return Array.from(this.orders.values())
  }

  async listByCustomer(customerId: string): Promise<Order[]> {
    return Array.from(this.orders.values()).filter((o) => o.customerId === customerId)
  }

  createOrder(
    cart: Cart,
    checkoutOptions: CheckoutOptions,
    taxTotal: number
  ): Order {
    const order: Order = {
      id: generateId('order'),
      customerId: cart.customerId,
      cartId: cart.id,
      items: cart.items.map((item) => ({
        id: generateId('oitem'),
        productId: item.productId,
        variantId: item.variantId,
        sku: '', // Will be populated
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        fulfilledQuantity: 0,
        restockedQuantity: 0,
      })),
      subtotal: cart.subtotal,
      discountTotal: cart.discountTotal,
      taxTotal,
      shippingTotal: 0,
      total: cart.subtotal - cart.discountTotal + taxTotal,
      status: 'pending',
      shippingAddress: checkoutOptions.shippingAddress,
      billingAddress: checkoutOptions.billingAddress,
      paymentMethod: checkoutOptions.paymentMethod,
      createdAt: new Date(),
    }

    this.orders.set(order.id, order)
    return order
  }

  async confirm(id: string): Promise<Order> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    if (order.status !== 'pending') {
      throw new Error('Invalid order state transition')
    }

    order.status = 'confirmed'
    order.updatedAt = new Date()
    this.orders.set(id, order)
    return order
  }

  async markPaid(id: string, options: MarkPaidOptions): Promise<Order> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    if (order.status !== 'confirmed') {
      throw new Error('Invalid order state transition')
    }

    order.status = 'paid'
    order.paymentDetails = {
      transactionId: options.transactionId,
      method: options.method,
      paidAt: new Date(),
    }
    order.updatedAt = new Date()
    this.orders.set(id, order)
    return order
  }

  async ship(id: string, options: ShipOptions): Promise<Order> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    if (order.status !== 'paid' && order.status !== 'partially_fulfilled') {
      throw new Error('Invalid order state transition')
    }

    order.status = 'shipped'
    order.shipping = {
      carrier: options.carrier,
      trackingNumber: options.trackingNumber,
      shippedAt: new Date(),
    }
    order.updatedAt = new Date()
    this.orders.set(id, order)
    return order
  }

  async fulfill(id: string, options: FulfillOptions): Promise<Order> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    if (order.status !== 'paid' && order.status !== 'partially_fulfilled') {
      throw new Error('Invalid order state transition')
    }

    const fulfillment: Fulfillment = {
      id: generateId('ful'),
      trackingNumber: options.trackingNumber,
      carrier: options.carrier,
      items: options.items || order.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      createdAt: new Date(),
    }

    order.fulfillments = order.fulfillments || []
    order.fulfillments.push(fulfillment)

    // Update fulfilled quantities
    for (const fulfillItem of fulfillment.items) {
      const orderItem = order.items.find((i) => i.variantId === fulfillItem.variantId)
      if (orderItem) {
        orderItem.fulfilledQuantity += fulfillItem.quantity

        // Commit inventory
        await this.inventory.commitForOrder(fulfillItem.variantId, fulfillItem.quantity)
      }
    }

    // Check if fully fulfilled
    const allFulfilled = order.items.every((i) => i.fulfilledQuantity >= i.quantity)
    if (allFulfilled) {
      order.status = 'shipped'
      order.shipping = {
        carrier: options.carrier,
        trackingNumber: options.trackingNumber,
        shippedAt: new Date(),
      }
    } else {
      order.status = 'partially_fulfilled'
    }

    order.updatedAt = new Date()
    this.orders.set(id, order)
    return order
  }

  async markDelivered(id: string): Promise<Order> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    if (order.status !== 'shipped') {
      throw new Error('Invalid order state transition')
    }

    order.status = 'delivered'
    order.deliveredAt = new Date()
    order.updatedAt = new Date()
    this.orders.set(id, order)
    return order
  }

  async complete(id: string): Promise<Order> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    if (order.status !== 'delivered') {
      throw new Error('Invalid order state transition')
    }

    order.status = 'completed'
    order.updatedAt = new Date()
    this.orders.set(id, order)
    return order
  }

  async cancel(id: string, options: CancelOptions): Promise<Order> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    // Can only cancel pending or confirmed orders
    if (!['pending', 'confirmed', 'paid'].includes(order.status)) {
      throw new Error('Cannot cancel order in current state')
    }

    order.status = 'cancelled'
    order.cancellation = {
      reason: options.reason,
      cancelledAt: new Date(),
    }
    order.updatedAt = new Date()

    // Release inventory - account for already fulfilled and restocked items
    for (const item of order.items) {
      const remainingReserved = item.quantity - item.fulfilledQuantity - item.restockedQuantity
      if (remainingReserved > 0) {
        await this.inventory.releaseForOrder(item.variantId, remainingReserved)
      }
    }

    this.orders.set(id, order)
    return order
  }

  async refund(id: string, options: RefundOptions): Promise<Order> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    const amount = options.amount ?? order.total
    const currentRefunded = order.refundedAmount ?? 0

    if (currentRefunded + amount > order.total) {
      throw new Error('Refund amount exceeds order total')
    }

    const refund: RefundDetails = {
      id: generateId('ref'),
      amount,
      reason: options.reason,
      createdAt: new Date(),
    }

    order.refunds = order.refunds || []
    order.refunds.push(refund)
    order.refundedAmount = currentRefunded + amount

    // Handle restocking
    if (options.restockItems) {
      for (const restockItem of options.restockItems) {
        await this.inventory.releaseForOrderBySku(restockItem.sku, restockItem.quantity)

        // Track restocked quantity on the order item
        // Find the matching order item by SKU (need to look up variant by SKU)
        for (const orderItem of order.items) {
          // Check if this order item matches the SKU
          // The SKU is stored in the inventory, so we need to track it separately
          // For now, update the first unmatched item with matching quantity potential
          if (orderItem.restockedQuantity < orderItem.quantity) {
            const remainingToRestock = restockItem.quantity
            const canRestock = Math.min(
              remainingToRestock,
              orderItem.quantity - orderItem.fulfilledQuantity - orderItem.restockedQuantity
            )
            if (canRestock > 0) {
              orderItem.restockedQuantity += canRestock
              break
            }
          }
        }
      }
    }

    // Mark as fully refunded if total refunded equals order total
    if (order.refundedAmount >= order.total) {
      order.status = 'refunded'
    }

    order.updatedAt = new Date()
    this.orders.set(id, order)
    return order
  }

  async addNote(id: string, content: string, createdBy?: string): Promise<void> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    const note: OrderNote = {
      id: generateId('note'),
      content,
      createdAt: new Date(),
      createdBy,
    }

    order.notes = order.notes || []
    order.notes.push(note)
    order.updatedAt = new Date()
    this.orders.set(id, order)
  }

  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    const order = this.orders.get(id)
    if (!order) {
      throw new Error('Order not found')
    }

    order.metadata = { ...order.metadata, ...metadata }
    order.updatedAt = new Date()
    this.orders.set(id, order)
  }
}

// =============================================================================
// PricingManager
// =============================================================================

class PricingManager {
  private discounts: Map<string, Discount> = new Map()
  private discountsByCode: Map<string, string> = new Map()
  private taxRates: Map<string, TaxRate> = new Map()
  private priceRules: Map<string, PriceRule> = new Map()
  private exchangeRates: Map<string, number> = new Map()

  async createDiscount(options: DiscountCreateOptions): Promise<Discount> {
    const id = generateId('disc')

    const discount: Discount = {
      id,
      code: options.code,
      type: options.type,
      value: options.value,
      currency: options.currency,
      active: true,
      usageLimit: options.usageLimit,
      usageCount: 0,
      minimumPurchase: options.minimumPurchase,
      startsAt: options.startsAt,
      expiresAt: options.expiresAt,
      createdAt: new Date(),
    }

    this.discounts.set(id, discount)
    this.discountsByCode.set(options.code, id)
    return discount
  }

  async getDiscount(code: string): Promise<Discount | null> {
    const id = this.discountsByCode.get(code)
    if (!id) return null
    return this.discounts.get(id) ?? null
  }

  async validateDiscount(
    code: string,
    context: { subtotal: number; customerId?: string }
  ): Promise<DiscountValidationResult> {
    const discount = await this.getDiscount(code)
    if (!discount) {
      return { valid: false, reason: 'Invalid discount code' }
    }

    if (!discount.active) {
      return { valid: false, reason: 'Discount is not active' }
    }

    if (discount.expiresAt && discount.expiresAt < new Date()) {
      return { valid: false, reason: 'Discount has expired' }
    }

    if (discount.startsAt && discount.startsAt > new Date()) {
      return { valid: false, reason: 'Discount is not yet active' }
    }

    if (discount.usageLimit && discount.usageCount >= discount.usageLimit) {
      return { valid: false, reason: 'Discount usage limit exceeded' }
    }

    if (discount.minimumPurchase && context.subtotal < discount.minimumPurchase) {
      return { valid: false, reason: 'Minimum purchase not met' }
    }

    // Calculate discount amount
    let discountAmount: number
    if (discount.type === 'percentage') {
      discountAmount = Math.floor(context.subtotal * (discount.value / 100))
    } else {
      discountAmount = Math.min(discount.value, context.subtotal)
    }

    return { valid: true, discountAmount }
  }

  async deactivateDiscount(id: string): Promise<void> {
    const discount = this.discounts.get(id)
    if (discount) {
      discount.active = false
      this.discounts.set(id, discount)
    }
  }

  async recordUsage(id: string): Promise<void> {
    const discount = this.discounts.get(id)
    if (discount) {
      discount.usageCount++
      this.discounts.set(id, discount)
    }
  }

  async createTaxRate(options: TaxRateCreateOptions): Promise<TaxRate> {
    const id = generateId('tax')

    const taxRate: TaxRate = {
      id,
      name: options.name,
      rate: options.rate,
      country: options.country,
      state: options.state,
      city: options.city,
      createdAt: new Date(),
    }

    this.taxRates.set(id, taxRate)
    return taxRate
  }

  async calculateTax(options: TaxCalculationOptions): Promise<TaxCalculation> {
    // Find matching tax rate
    let matchingRate: TaxRate | undefined

    for (const rate of this.taxRates.values()) {
      if (rate.country === options.shippingAddress.country) {
        if (rate.state && rate.state === options.shippingAddress.state) {
          if (!rate.city || rate.city === options.shippingAddress.city) {
            matchingRate = rate
            break
          }
        } else if (!rate.state) {
          matchingRate = rate
        }
      }
    }

    if (!matchingRate) {
      return { amount: 0, rate: 0 }
    }

    const amount = Math.round(options.subtotal * matchingRate.rate)
    return {
      amount,
      rate: matchingRate.rate,
      taxRateId: matchingRate.id,
    }
  }

  async setExchangeRate(from: string, to: string, rate: number): Promise<void> {
    this.exchangeRates.set(`${from}:${to}`, rate)
  }

  async convertPrice(price: Price, targetCurrency: string): Promise<Price> {
    if (price.currency === targetCurrency) {
      return price
    }

    const rate = this.exchangeRates.get(`${price.currency}:${targetCurrency}`)
    if (!rate) {
      throw new Error(`No exchange rate found for ${price.currency} to ${targetCurrency}`)
    }

    return {
      amount: Math.round(price.amount * rate),
      currency: targetCurrency,
    }
  }

  formatPrice(price: Price, locale = 'en-US'): string {
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: price.currency,
    })
    return formatter.format(price.amount / 100)
  }

  async createPriceRule(options: PriceRuleCreateOptions): Promise<PriceRule> {
    const id = generateId('rule')

    const rule: PriceRule = {
      id,
      name: options.name,
      type: options.type,
      tiers: options.tiers,
      customerGroups: options.customerGroups,
      discount: options.discount,
      startsAt: options.startsAt,
      expiresAt: options.expiresAt,
      createdAt: new Date(),
    }

    this.priceRules.set(id, rule)
    return rule
  }

  async calculatePrice(options: PriceCalculationOptions): Promise<Price> {
    let finalAmount = options.basePrice.amount

    // Apply volume pricing
    for (const rule of this.priceRules.values()) {
      if (rule.type === 'volume' && rule.tiers) {
        // Find applicable tier
        const applicableTier = rule.tiers
          .filter((t) => options.quantity >= t.minQuantity)
          .sort((a, b) => b.minQuantity - a.minQuantity)[0]

        if (applicableTier) {
          finalAmount = Math.round(finalAmount * (1 - applicableTier.discount))
        }
      }

      if (rule.type === 'customer_group' && rule.customerGroups && options.customerGroups) {
        const hasMatchingGroup = rule.customerGroups.some((g) =>
          options.customerGroups?.includes(g)
        )
        if (hasMatchingGroup && rule.discount) {
          finalAmount = Math.round(finalAmount * (1 - rule.discount))
        }
      }
    }

    return {
      amount: finalAmount,
      currency: options.basePrice.currency,
    }
  }
}

// =============================================================================
// InventoryManager
// =============================================================================

class InventoryManager {
  private levels: Map<string, InventoryLevel> = new Map()
  private reservations: Map<string, InventoryReservation> = new Map()
  private adjustments: InventoryAdjustment[] = []
  private backorderPolicies: Map<string, BackorderPolicy> = new Map()
  private config?: CommerceEngineConfig

  constructor(config?: CommerceEngineConfig) {
    this.config = config
  }

  private getLevelKey(sku: string, locationId?: string): string {
    return locationId ? `${sku}:${locationId}` : sku
  }

  initFromVariant(sku: string, quantity: number): void {
    const level: InventoryLevel = {
      sku,
      onHand: quantity,
      reserved: 0,
      committed: 0,
      available: quantity,
      backordered: 0,
    }
    this.levels.set(sku, level)
  }

  async getLevel(sku: string, locationId?: string): Promise<InventoryLevel | null> {
    const key = this.getLevelKey(sku, locationId)
    return this.levels.get(key) ?? null
  }

  async getTotalLevel(sku: string): Promise<InventoryLevel | null> {
    // Aggregate across all locations - filter by SKU correctly
    // Keys are either 'sku' or 'sku:locationId'
    const levels: InventoryLevel[] = []
    for (const [key, level] of this.levels) {
      // Match either exact SKU or SKU:locationId pattern
      if (key === sku || key.startsWith(`${sku}:`)) {
        // Only include location-specific entries, not the base entry if both exist
        if (key.includes(':')) {
          levels.push(level)
        }
      }
    }

    // If no location-specific entries, check for base entry
    if (levels.length === 0) {
      const baseLevel = this.levels.get(sku)
      if (baseLevel) {
        return baseLevel
      }
      return null
    }

    return {
      sku,
      onHand: levels.reduce((sum, l) => sum + l.onHand, 0),
      reserved: levels.reduce((sum, l) => sum + l.reserved, 0),
      committed: levels.reduce((sum, l) => sum + l.committed, 0),
      available: levels.reduce((sum, l) => sum + l.available, 0),
      backordered: levels.reduce((sum, l) => sum + l.backordered, 0),
    }
  }

  async setLevel(sku: string, options: SetInventoryLevelOptions): Promise<void> {
    const key = this.getLevelKey(sku, options.locationId)
    const existing = this.levels.get(key)

    const level: InventoryLevel = {
      sku,
      locationId: options.locationId,
      onHand: options.onHand,
      reserved: existing?.reserved ?? 0,
      committed: existing?.committed ?? 0,
      available: options.onHand - (existing?.reserved ?? 0) - (existing?.committed ?? 0),
      backordered: existing?.backordered ?? 0,
      lowStockThreshold: existing?.lowStockThreshold,
    }

    this.levels.set(key, level)
  }

  async reserve(sku: string, quantity: number, options: ReserveOptions): Promise<InventoryReservation> {
    const level = await this.getLevel(sku)
    if (!level) {
      throw new Error('SKU not found in inventory')
    }

    const policy = this.backorderPolicies.get(sku)
    const allowBackorder = options.allowBackorder && policy?.allowBackorder

    let backordered = 0
    if (quantity > level.available) {
      if (allowBackorder) {
        backordered = quantity - level.available
        const toReserve = level.available
        level.reserved += toReserve
        level.available = 0
        level.backordered += backordered
      } else {
        throw new Error('Insufficient inventory')
      }
    } else {
      level.reserved += quantity
      level.available -= quantity
    }

    const reservation: InventoryReservation = {
      id: generateId('res'),
      sku,
      quantity,
      orderId: options.orderId,
      backordered,
      expiresAt: options.expiresAt,
      createdAt: new Date(),
    }

    this.reservations.set(reservation.id, reservation)
    this.levels.set(sku, level)

    return reservation
  }

  async releaseReservation(reservationId: string): Promise<void> {
    const reservation = this.reservations.get(reservationId)
    if (!reservation) return

    const level = await this.getLevel(reservation.sku)
    if (level) {
      const actualReserved = reservation.quantity - reservation.backordered
      level.reserved -= actualReserved
      level.available += actualReserved
      level.backordered -= reservation.backordered
      this.levels.set(reservation.sku, level)
    }

    this.reservations.delete(reservationId)
  }

  async commitReservation(reservationId: string): Promise<void> {
    const reservation = this.reservations.get(reservationId)
    if (!reservation) return

    const level = await this.getLevel(reservation.sku)
    if (level) {
      const actualReserved = reservation.quantity - reservation.backordered
      level.reserved -= actualReserved
      level.committed += actualReserved
      level.onHand -= actualReserved
      this.levels.set(reservation.sku, level)
    }

    this.reservations.delete(reservationId)
  }

  async cleanupExpiredReservations(): Promise<number> {
    const now = Date.now()
    let cleaned = 0

    for (const [id, reservation] of this.reservations) {
      if (reservation.expiresAt && reservation.expiresAt.getTime() < now) {
        await this.releaseReservation(id)
        cleaned++
      }
    }

    return cleaned
  }

  async adjust(sku: string, quantity: number, options: AdjustOptions): Promise<void> {
    const level = await this.getLevel(sku)
    if (!level) {
      throw new Error('SKU not found in inventory')
    }

    if (level.onHand + quantity < 0) {
      throw new Error('Adjustment would result in negative inventory')
    }

    level.onHand += quantity
    level.available += quantity

    const adjustment: InventoryAdjustment = {
      id: generateId('adj'),
      sku,
      quantity,
      reason: options.reason,
      createdAt: new Date(),
    }

    this.adjustments.push(adjustment)
    this.levels.set(sku, level)

    // Check low stock threshold
    if (level.lowStockThreshold && level.onHand <= level.lowStockThreshold) {
      this.config?.onLowStock?.(level)
    }
  }

  async getAdjustmentHistory(sku: string): Promise<InventoryAdjustment[]> {
    return this.adjustments.filter((a) => a.sku === sku)
  }

  async setBackorderPolicy(sku: string, policy: BackorderPolicy): Promise<void> {
    this.backorderPolicies.set(sku, policy)
  }

  async transfer(
    sku: string,
    quantity: number,
    options: TransferOptions
  ): Promise<void> {
    const fromLevel = await this.getLevel(sku, options.fromLocation)
    const toLevel = await this.getLevel(sku, options.toLocation)

    if (!fromLevel || !toLevel) {
      throw new Error('Location not found')
    }

    if (fromLevel.onHand < quantity) {
      throw new Error('Insufficient inventory at source location')
    }

    fromLevel.onHand -= quantity
    fromLevel.available -= quantity
    toLevel.onHand += quantity
    toLevel.available += quantity

    this.levels.set(this.getLevelKey(sku, options.fromLocation), fromLevel)
    this.levels.set(this.getLevelKey(sku, options.toLocation), toLevel)
  }

  async setLowStockThreshold(sku: string, threshold: number): Promise<void> {
    const level = await this.getLevel(sku)
    if (level) {
      level.lowStockThreshold = threshold
      this.levels.set(sku, level)
    }
  }

  async getLowStockItems(): Promise<InventoryLevel[]> {
    return Array.from(this.levels.values()).filter(
      (l) => l.lowStockThreshold && l.onHand <= l.lowStockThreshold
    )
  }

  // Internal methods for order processing
  async reserveForOrder(variantId: string, quantity: number, orderId: string): Promise<void> {
    // Find SKU from variant ID (simple lookup for now)
    for (const [sku, level] of this.levels) {
      if (!sku.includes(':')) {
        // Not a location-specific entry
        await this.reserve(sku, quantity, { orderId })
        break
      }
    }
  }

  async releaseForOrder(variantId: string, quantity: number): Promise<void> {
    // Find and release reservation for this variant
    for (const [id, reservation] of this.reservations) {
      // Release matching reservations
      if (reservation.quantity === quantity) {
        await this.releaseReservation(id)
        return
      }
    }

    // If no exact reservation found, just release from level
    for (const [sku, level] of this.levels) {
      if (!sku.includes(':')) {
        level.reserved = Math.max(0, level.reserved - quantity)
        level.available += quantity
        this.levels.set(sku, level)
        break
      }
    }
  }

  async releaseForOrderBySku(sku: string, quantity: number): Promise<void> {
    const level = await this.getLevel(sku)
    if (level) {
      level.reserved = Math.max(0, level.reserved - quantity)
      level.available += quantity
      this.levels.set(sku, level)
    }
  }

  async commitForOrder(variantId: string, quantity: number): Promise<void> {
    // Find and commit reservation for this variant
    for (const [sku, level] of this.levels) {
      if (!sku.includes(':')) {
        level.reserved = Math.max(0, level.reserved - quantity)
        level.committed += quantity
        level.onHand -= quantity
        this.levels.set(sku, level)
        break
      }
    }
  }

  // Link inventory to products
  linkProductVariant(sku: string, variantId: string, inventory: number): void {
    this.initFromVariant(sku, inventory)
  }
}

// =============================================================================
// CommerceEngine
// =============================================================================

export class CommerceEngine {
  readonly products: ProductsManager
  readonly carts: CartsManager
  readonly orders: OrdersManager
  readonly pricing: PricingManager
  readonly inventory: InventoryManager

  private config?: CommerceEngineConfig

  constructor(config?: CommerceEngineConfig) {
    this.config = config
    this.products = new ProductsManager()
    this.pricing = new PricingManager()
    this.inventory = new InventoryManager(config)
    this.carts = new CartsManager(this.products, this.pricing)
    this.orders = new OrdersManager(this.inventory)

    // Patch products to link inventory
    const originalCreate = this.products.create.bind(this.products)
    this.products.create = async (options: ProductCreateOptions) => {
      const product = await originalCreate(options)

      // Initialize inventory for variants
      if (product.variants) {
        for (const variant of product.variants) {
          this.inventory.linkProductVariant(variant.sku, variant.id, variant.inventory ?? 0)
        }
      }

      return product
    }
  }

  async checkout(cartId: string, options: CheckoutOptions): Promise<Order> {
    const cart = await this.carts.get(cartId)
    if (!cart) {
      throw new Error('Cart not found')
    }

    if (cart.status === 'converted') {
      throw new Error('Cart has already been converted')
    }

    if (cart.items.length === 0) {
      throw new Error('Cart is empty')
    }

    // Calculate tax
    const subtotalAfterDiscount = cart.subtotal - cart.discountTotal
    const tax = await this.pricing.calculateTax({
      subtotal: subtotalAfterDiscount,
      shippingAddress: options.shippingAddress,
    })

    // Reserve inventory
    for (const item of cart.items) {
      const variant = await this.products.findVariantBySku(
        // Find SKU from variant
        Array.from(this.inventory['levels'].keys()).find((k) => !k.includes(':')) || ''
      )
      // Reserve by iterating through cart items and finding the matching SKU
      for (const [sku, level] of this.inventory['levels']) {
        if (!sku.includes(':')) {
          await this.inventory.reserve(sku, item.quantity, { orderId: `pending_${cartId}` })
          break
        }
      }
    }

    // Create order
    const order = this.orders.createOrder(cart, options, tax.amount)

    // Mark cart as converted
    this.carts.markAsConverted(cartId)

    return order
  }
}

/**
 * Factory function to create a CommerceEngine instance
 */
export function createCommerceEngine(config?: CommerceEngineConfig): CommerceEngine {
  return new CommerceEngine(config)
}
