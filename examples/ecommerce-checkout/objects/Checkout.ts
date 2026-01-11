/**
 * CheckoutDO - Checkout Session Durable Object
 *
 * Orchestrates the checkout process across multiple DOs.
 * Each checkout session gets its own instance (keyed by sessionId).
 *
 * Responsibilities:
 * - Coordinate multi-DO checkout flow
 * - Validate promo codes
 * - Calculate taxes and shipping
 * - Process payments
 * - Implement saga/compensation pattern
 *
 * Flow:
 * 1. Create session with cart snapshot
 * 2. Reserve inventory (InventoryDO)
 * 3. Process payment
 * 4. Create order (OrderDO)
 * 5. Clear cart (CartDO)
 *
 * Compensation on failure:
 * - Release inventory reservation
 * - Refund payment if charged
 * - Notify customer
 *
 * Events Emitted:
 * - Checkout.started - Session created
 * - Checkout.completed - Order placed successfully
 * - Checkout.failed - Checkout failed (triggers compensation)
 * - Payment.processed - Payment completed
 * - Payment.failed - Payment failed
 */

import { DO } from 'dotdo'
import type { CartItem, Address } from './Cart'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface TaxResult {
  rate: number
  amount: number
  breakdown?: Array<{ name: string; rate: number; amount: number }>
}

export interface ShippingRate {
  carrier: string
  method: string
  price: number
  estimatedDays: number
}

export interface PromoResult {
  code: string
  type: 'percent' | 'fixed' | 'free_shipping'
  value: number
  amount: number
  description: string
}

export interface PaymentMethod {
  type: 'card' | 'bank' | 'wallet'
  token: string
  last4?: string
}

export interface PaymentResult {
  id: string
  status: 'succeeded' | 'pending' | 'failed'
  amount: number
  currency: string
  method: PaymentMethod
  chargedAt: Date
}

export interface CheckoutTotals {
  subtotal: number
  tax: TaxResult
  shipping: ShippingRate
  discount: PromoResult | null
  total: number
}

export interface CheckoutSession {
  id: string
  customerId: string
  cartId: string
  items: CartItem[]
  shippingAddress: Address
  billingAddress: Address
  shippingMethod: string
  promoCode?: string
  totals?: CheckoutTotals
  reservationId?: string
  paymentId?: string
  orderId?: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  error?: { code: string; message: string }
  createdAt: Date
  updatedAt: Date
}

export class CheckoutError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'CheckoutError'
  }
}

// ============================================================================
// CHECKOUT DURABLE OBJECT
// ============================================================================

export class CheckoutDO extends DO {
  static readonly $type = 'CheckoutDO'

  /**
   * Register event handlers on startup.
   */
  async onStart() {
    // ========================================================================
    // INVENTORY RESPONSE HANDLERS
    // ========================================================================

    /**
     * Inventory.reserved - Reservation successful, proceed to payment.
     */
    this.$.on.Inventory.reserved(async (event) => {
      const { orderId, reservationId, sessionId } = event.data as {
        orderId: string
        reservationId: string
        sessionId?: string
      }

      // Only handle if this is our session
      const session = await this.ctx.storage.get<CheckoutSession>('session')
      if (!session || session.id !== sessionId) return

      console.log(`[Checkout] Inventory reserved: ${reservationId}`)

      session.reservationId = reservationId
      session.updatedAt = new Date()
      await this.ctx.storage.put('session', session)

      // Proceed to payment - the caller should trigger this
    })

    /**
     * Inventory.insufficient - Reservation failed, abort checkout.
     */
    this.$.on.Inventory.insufficient(async (event) => {
      const { orderId, message, details, sessionId } = event.data as {
        orderId: string
        code: string
        message: string
        details: unknown
        sessionId?: string
      }

      const session = await this.ctx.storage.get<CheckoutSession>('session')
      if (!session || session.id !== sessionId) return

      console.log(`[Checkout] Inventory insufficient: ${message}`)

      session.status = 'failed'
      session.error = { code: 'INSUFFICIENT_STOCK', message }
      session.updatedAt = new Date()
      await this.ctx.storage.put('session', session)

      this.$.send('Checkout.failed', {
        sessionId: session.id,
        customerId: session.customerId,
        reason: message,
        details,
      })
    })

    // ========================================================================
    // ORDER RESPONSE HANDLERS
    // ========================================================================

    /**
     * Order.created - Order created successfully.
     */
    this.$.on.Order.created(async (event) => {
      const { orderId, sessionId } = event.data as {
        orderId: string
        sessionId?: string
      }

      const session = await this.ctx.storage.get<CheckoutSession>('session')
      if (!session || session.id !== sessionId) return

      console.log(`[Checkout] Order created: ${orderId}`)

      session.orderId = orderId
      session.status = 'completed'
      session.updatedAt = new Date()
      await this.ctx.storage.put('session', session)

      // Clear the customer's cart
      this.$.send('Cart.clear', {
        customerId: session.customerId,
      })

      this.$.send('Checkout.completed', {
        sessionId: session.id,
        orderId,
        customerId: session.customerId,
        total: session.totals?.total,
      })
    })

    // ========================================================================
    // PAYMENT HANDLERS
    // ========================================================================

    /**
     * Payment.failed - Trigger compensation.
     */
    this.$.on.Payment.failed(async (event) => {
      const { sessionId, reason } = event.data as {
        sessionId?: string
        reason: string
      }

      const session = await this.ctx.storage.get<CheckoutSession>('session')
      if (!session || session.id !== sessionId) return

      console.log(`[Checkout] Payment failed: ${reason}`)

      // Compensate: release inventory
      if (session.reservationId) {
        this.$.send('Inventory.release', {
          orderId: session.id,
          reason: 'Payment failed',
        })
      }

      session.status = 'failed'
      session.error = { code: 'PAYMENT_FAILED', message: reason }
      session.updatedAt = new Date()
      await this.ctx.storage.put('session', session)

      this.$.send('Checkout.failed', {
        sessionId: session.id,
        customerId: session.customerId,
        reason,
      })
    })

    console.log('[CheckoutDO] Event handlers registered')
  }

  // ==========================================================================
  // CHECKOUT FLOW
  // ==========================================================================

  /**
   * Create a new checkout session from cart.
   */
  async createSession(
    customerId: string,
    cartData: {
      id: string
      items: CartItem[]
      shippingAddress: Address
      billingAddress?: Address
      shippingMethod?: string
      promoCode?: string
    }
  ): Promise<CheckoutSession> {
    if (!cartData.items.length) {
      throw new CheckoutError('Cart is empty', 'EMPTY_CART')
    }

    if (!cartData.shippingAddress) {
      throw new CheckoutError('Shipping address required', 'MISSING_ADDRESS')
    }

    const session: CheckoutSession = {
      id: this.ns, // Session ID is the DO name
      customerId,
      cartId: cartData.id,
      items: cartData.items,
      shippingAddress: cartData.shippingAddress,
      billingAddress: cartData.billingAddress ?? cartData.shippingAddress,
      shippingMethod: cartData.shippingMethod ?? 'ground',
      promoCode: cartData.promoCode,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await this.ctx.storage.put('session', session)

    this.$.send('Checkout.started', {
      sessionId: session.id,
      customerId,
      itemCount: cartData.items.length,
    })

    return session
  }

  /**
   * Get current session.
   */
  async getSession(): Promise<CheckoutSession | null> {
    return (await this.ctx.storage.get<CheckoutSession>('session')) ?? null
  }

  /**
   * Calculate all totals for the session.
   */
  async calculateTotals(): Promise<CheckoutTotals> {
    const session = await this.getSession()
    if (!session) {
      throw new CheckoutError('No active session', 'NO_SESSION')
    }

    // Calculate subtotal
    const subtotal = session.items.reduce((sum, item) => sum + item.price * item.quantity, 0)

    // Calculate tax
    const tax = await this.calculateTax(session.shippingAddress, subtotal, session.items)

    // Get shipping rate
    let shipping = await this.getShippingRate(session.shippingMethod, session.shippingAddress, session.items)

    // Apply promo code
    let discount: PromoResult | null = null
    if (session.promoCode) {
      discount = await this.validatePromoCode(session.promoCode, subtotal, session.customerId)
      if (discount?.type === 'free_shipping') {
        shipping = { ...shipping, price: 0 }
      }
    }

    // Calculate final total
    const discountAmount = discount?.amount ?? 0
    const total = Math.round((subtotal + tax.amount + shipping.price - discountAmount) * 100) / 100

    const totals: CheckoutTotals = {
      subtotal: Math.round(subtotal * 100) / 100,
      tax,
      shipping,
      discount,
      total,
    }

    // Store totals in session
    session.totals = totals
    session.updatedAt = new Date()
    await this.ctx.storage.put('session', session)

    return totals
  }

  /**
   * Process checkout - orchestrates the full saga.
   */
  async processCheckout(paymentMethod: PaymentMethod): Promise<{
    orderId: string
    paymentId: string
    total: number
  }> {
    const session = await this.getSession()
    if (!session) {
      throw new CheckoutError('No active session', 'NO_SESSION')
    }

    if (session.status !== 'pending') {
      throw new CheckoutError(`Session already ${session.status}`, 'INVALID_STATE')
    }

    session.status = 'processing'
    session.updatedAt = new Date()
    await this.ctx.storage.put('session', session)

    try {
      // 1. Calculate totals if not already done
      if (!session.totals) {
        await this.calculateTotals()
      }

      // Reload session to get updated totals
      const updatedSession = (await this.getSession())!

      // 2. Reserve inventory
      const reservation = await this.reserveInventory(updatedSession)
      updatedSession.reservationId = reservation.id
      await this.ctx.storage.put('session', updatedSession)

      // 3. Process payment
      const payment = await this.processPayment(paymentMethod, updatedSession.totals!.total)
      updatedSession.paymentId = payment.id
      await this.ctx.storage.put('session', updatedSession)

      // 4. Commit inventory reservation
      this.$.send('Inventory.commit', {
        orderId: session.id,
      })

      // 5. Create order
      const orderId = await this.createOrder(updatedSession, payment)
      updatedSession.orderId = orderId
      updatedSession.status = 'completed'
      await this.ctx.storage.put('session', updatedSession)

      // 6. Notify success
      this.$.send('Checkout.completed', {
        sessionId: session.id,
        orderId,
        customerId: session.customerId,
        total: updatedSession.totals!.total,
      })

      // 7. Request cart clear
      this.$.send('Cart.clear', {
        customerId: session.customerId,
      })

      return {
        orderId,
        paymentId: payment.id,
        total: updatedSession.totals!.total,
      }
    } catch (error) {
      // Compensation: release inventory and update status
      await this.compensate(session, error as Error)
      throw error
    }
  }

  /**
   * Compensate for failed checkout (saga rollback).
   */
  private async compensate(session: CheckoutSession, error: Error): Promise<void> {
    console.log(`[Checkout] Compensating session ${session.id}: ${error.message}`)

    // Release inventory reservation
    if (session.reservationId) {
      this.$.send('Inventory.release', {
        orderId: session.id,
        reason: error.message,
      })
    }

    // Refund payment if charged
    if (session.paymentId) {
      this.$.send('Payment.refund', {
        paymentId: session.paymentId,
        reason: error.message,
      })
    }

    // Update session status
    session.status = 'failed'
    session.error = {
      code: error instanceof CheckoutError ? error.code : 'CHECKOUT_FAILED',
      message: error.message,
    }
    session.updatedAt = new Date()
    await this.ctx.storage.put('session', session)

    // Notify failure
    this.$.send('Checkout.failed', {
      sessionId: session.id,
      customerId: session.customerId,
      reason: error.message,
    })
  }

  /**
   * Cancel checkout session.
   */
  async cancel(reason?: string): Promise<void> {
    const session = await this.getSession()
    if (!session) return

    if (['completed', 'cancelled'].includes(session.status)) {
      throw new CheckoutError(`Cannot cancel ${session.status} session`, 'INVALID_STATE')
    }

    await this.compensate(session, new Error(reason ?? 'Customer cancelled'))
    session.status = 'cancelled'
    await this.ctx.storage.put('session', session)
  }

  // ==========================================================================
  // SAGA STEPS (cross-DO coordination)
  // ==========================================================================

  /**
   * Reserve inventory via InventoryDO.
   */
  private async reserveInventory(session: CheckoutSession): Promise<{ id: string }> {
    // In production: use $.do() for durable step execution
    // For now: simulate direct call via event
    const reservationId = `res_${crypto.randomUUID().slice(0, 8)}`

    // Emit reservation request
    this.$.send('Inventory.reserve', {
      orderId: session.id,
      items: session.items.map((item) => ({
        sku: item.sku,
        quantity: item.quantity,
      })),
      sessionId: session.id,
    })

    // For demo: simulate successful reservation
    // In production: wait for Inventory.reserved event
    return { id: reservationId }
  }

  /**
   * Create order via OrderDO.
   */
  private async createOrder(session: CheckoutSession, payment: PaymentResult): Promise<string> {
    const orderId = `ord_${crypto.randomUUID().slice(0, 8)}`

    // Emit order creation request
    this.$.send('Order.create', {
      orderId,
      sessionId: session.id,
      customerId: session.customerId,
      items: session.items,
      shippingAddress: session.shippingAddress,
      billingAddress: session.billingAddress,
      totals: session.totals,
      payment: {
        id: payment.id,
        amount: payment.amount,
        method: payment.method,
      },
    })

    return orderId
  }

  // ==========================================================================
  // PRICING CALCULATIONS
  // ==========================================================================

  /**
   * Calculate tax based on address and items.
   */
  async calculateTax(address: Address, subtotal: number, items: CartItem[]): Promise<TaxResult> {
    // In production: call tax service (Avalara, TaxJar, etc.)
    // Demo: simple state-based tax rates
    const taxRates: Record<string, number> = {
      CA: 0.0725,
      NY: 0.08,
      TX: 0.0625,
      WA: 0.065,
      FL: 0.06,
      DEFAULT: 0.05,
    }

    const rate = taxRates[address.state] ?? taxRates.DEFAULT
    const amount = Math.round(subtotal * rate * 100) / 100

    return {
      rate,
      amount,
      breakdown: [{ name: `${address.state} State Tax`, rate, amount }],
    }
  }

  /**
   * Get available shipping rates.
   */
  async getShippingRates(address: Address, items: CartItem[]): Promise<ShippingRate[]> {
    // In production: call shipping APIs (UPS, FedEx, USPS, etc.)
    // Demo: fixed rates based on total weight
    const totalWeight = items.reduce((sum, item) => sum + (item.weight ?? 0.5) * item.quantity, 0)
    const basePrice = totalWeight * 0.5

    return [
      {
        carrier: 'FastShip',
        method: 'ground',
        price: Math.round((basePrice + 5.99) * 100) / 100,
        estimatedDays: 5,
      },
      {
        carrier: 'FastShip',
        method: 'express',
        price: Math.round((basePrice + 12.99) * 100) / 100,
        estimatedDays: 2,
      },
      {
        carrier: 'FastShip',
        method: 'overnight',
        price: Math.round((basePrice + 24.99) * 100) / 100,
        estimatedDays: 1,
      },
    ]
  }

  /**
   * Get a specific shipping rate.
   */
  async getShippingRate(method: string, address: Address, items: CartItem[]): Promise<ShippingRate> {
    const rates = await this.getShippingRates(address, items)
    const rate = rates.find((r) => r.method === method)
    if (!rate) {
      throw new CheckoutError(`Shipping method not available: ${method}`, 'SHIPPING_UNAVAILABLE', {
        availableMethods: rates.map((r) => r.method),
      })
    }
    return rate
  }

  /**
   * Validate and calculate promo discount.
   */
  async validatePromoCode(code: string, subtotal: number, customerId: string): Promise<PromoResult | null> {
    // In production: query promo database
    // Demo promo codes
    const promos: Record<string, Omit<PromoResult, 'amount'>> = {
      SAVE10: { code: 'SAVE10', type: 'fixed', value: 10, description: '$10 off' },
      SAVE20: { code: 'SAVE20', type: 'percent', value: 20, description: '20% off' },
      FREESHIP: { code: 'FREESHIP', type: 'free_shipping', value: 0, description: 'Free shipping' },
      WELCOME15: { code: 'WELCOME15', type: 'percent', value: 15, description: '15% off for new customers' },
    }

    const promo = promos[code.toUpperCase()]
    if (!promo) return null

    let amount = 0
    switch (promo.type) {
      case 'fixed':
        amount = Math.min(promo.value, subtotal)
        break
      case 'percent':
        amount = subtotal * (promo.value / 100)
        break
      case 'free_shipping':
        amount = 0 // Handled in shipping calculation
        break
    }

    return { ...promo, amount: Math.round(amount * 100) / 100 }
  }

  // ==========================================================================
  // PAYMENT PROCESSING
  // ==========================================================================

  /**
   * Process payment.
   */
  async processPayment(paymentMethod: PaymentMethod, amount: number): Promise<PaymentResult> {
    // In production: call payment gateway (Stripe, etc.)
    // Stripe: stripe.paymentIntents.create({ amount, currency, payment_method })

    // Demo: simulate payment processing with 90% success rate
    const success = Math.random() > 0.1

    if (!success) {
      this.$.send('Payment.failed', {
        sessionId: this.ns,
        reason: 'Card declined by issuer',
      })
      throw new CheckoutError('Payment declined', 'PAYMENT_DECLINED', {
        reason: 'Card declined by issuer',
      })
    }

    const payment: PaymentResult = {
      id: `pay_${crypto.randomUUID().slice(0, 8)}`,
      status: 'succeeded',
      amount,
      currency: 'USD',
      method: paymentMethod,
      chargedAt: new Date(),
    }

    this.$.send('Payment.processed', {
      sessionId: this.ns,
      paymentId: payment.id,
      amount,
    })

    return payment
  }
}
