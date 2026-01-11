/**
 * PaymentDO - Payment Processing with Dunning
 *
 * Handles payment processing and retry logic (dunning).
 * Each customer gets their own instance (keyed by customerId).
 *
 * Responsibilities:
 * - Process payments via payment gateway
 * - Implement dunning (retry with exponential backoff)
 * - Store payment methods
 * - Track payment history
 * - Handle refunds
 *
 * Dunning Schedule:
 * - Initial attempt: Immediate
 * - Retry 1: 3 days later
 * - Retry 2: 7 days later (10 days total)
 * - Retry 3: 14 days later (24 days total)
 * - After 3 retries: Mark as exhausted, suspend subscription
 *
 * Events Emitted:
 * - Payment.attempted - Payment processing started
 * - Payment.succeeded - Payment successful
 * - Payment.failed - Payment failed (may retry)
 * - Payment.refunded - Refund processed
 * - Retry.scheduled - Payment retry scheduled
 * - Customer.notify - Payment notification
 */

import { DO } from 'dotdo'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded'
export type PaymentMethodType = 'card' | 'bank' | 'wallet'

export interface PaymentMethod {
  id: string
  type: PaymentMethodType
  last4: string
  brand?: string // For cards: visa, mastercard, amex
  expiryMonth?: number
  expiryYear?: number
  isDefault: boolean
  createdAt: Date
}

export interface PaymentAttempt {
  id: string
  invoiceId: string
  subscriptionId: string
  amount: number
  currency: string
  status: PaymentStatus
  paymentMethodId: string
  failureCode?: string
  failureMessage?: string
  attemptedAt: Date
  processedAt?: Date
}

export interface RetrySchedule {
  invoiceId: string
  subscriptionId: string
  amount: number
  currency: string
  attemptNumber: number
  scheduledFor: Date
  status: 'pending' | 'executed' | 'cancelled'
}

export interface PaymentProcessRequest {
  invoiceId: string
  subscriptionId: string
  customerId: string
  amount: number
  currency: string
  paymentMethodId?: string
}

export class PaymentError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'PaymentError'
  }
}

// ============================================================================
// DUNNING CONFIGURATION
// ============================================================================

// Retry delays in days
const DUNNING_SCHEDULE = [3, 7, 14] // 3, 7, 14 days between retries
const MAX_RETRIES = DUNNING_SCHEDULE.length

// ============================================================================
// PAYMENT DURABLE OBJECT
// ============================================================================

export class PaymentDO extends DO {
  static readonly $type = 'PaymentDO'

  /**
   * Register event handlers on startup.
   */
  async onStart() {
    // ========================================================================
    // PAYMENT PROCESSING HANDLERS
    // ========================================================================

    /**
     * Payment.process - Process a payment for an invoice
     */
    this.$.on.Payment.process(async (event) => {
      const { invoiceId, subscriptionId, customerId, amount, currency, paymentMethodId } =
        event.data as PaymentProcessRequest

      // Only handle our customer
      if (customerId !== this.ns) return

      console.log(`[Payment] Processing payment for invoice ${invoiceId}: $${(amount / 100).toFixed(2)}`)

      await this.processPayment({
        invoiceId,
        subscriptionId,
        customerId,
        amount,
        currency,
        paymentMethodId,
      })
    })

    /**
     * Retry.execute - Execute a scheduled retry
     */
    this.$.on.Retry.execute(async (event) => {
      const { invoiceId, retryId } = event.data as {
        invoiceId: string
        retryId: string
      }

      const retry = await this.ctx.storage.get<RetrySchedule>(`retry:${retryId}`)
      if (!retry || retry.status !== 'pending') return

      console.log(`[Payment] Executing retry ${retry.attemptNumber} for invoice ${invoiceId}`)

      // Mark as executed
      retry.status = 'executed'
      await this.ctx.storage.put(`retry:${retryId}`, retry)

      // Process payment
      await this.processPayment({
        invoiceId: retry.invoiceId,
        subscriptionId: retry.subscriptionId,
        customerId: this.ns,
        amount: retry.amount,
        currency: retry.currency,
      })
    })

    /**
     * Payment.refund - Process a refund
     */
    this.$.on.Payment.refund(async (event) => {
      const { paymentId, amount, reason } = event.data as {
        paymentId: string
        orderId?: string
        amount?: number
        reason?: string
      }

      await this.refund(paymentId, amount, reason)
    })

    // ========================================================================
    // SCHEDULED RETRY PROCESSING
    // ========================================================================

    // Check for due retries every hour
    this.$.every.hour(async () => {
      const now = new Date()
      const retries = await this.getPendingRetries()

      for (const retry of retries) {
        if (new Date(retry.scheduledFor) <= now) {
          this.$.send('Retry.execute', {
            invoiceId: retry.invoiceId,
            retryId: `${retry.invoiceId}:${retry.attemptNumber}`,
          })
        }
      }
    })

    console.log('[PaymentDO] Event handlers registered')
  }

  // ==========================================================================
  // PUBLIC API METHODS
  // ==========================================================================

  /**
   * Process a payment.
   */
  async processPayment(request: PaymentProcessRequest): Promise<PaymentAttempt> {
    const { invoiceId, subscriptionId, amount, currency, paymentMethodId } = request

    // Get payment method
    const methods = await this.getPaymentMethods()
    const method = paymentMethodId
      ? methods.find((m) => m.id === paymentMethodId)
      : methods.find((m) => m.isDefault)

    if (!method) {
      // No payment method - emit failure
      this.$.send('Payment.failed', {
        invoiceId,
        subscriptionId,
        attemptCount: 1,
        exhausted: true,
        reason: 'No payment method on file',
      })

      throw new PaymentError('No payment method available', 'NO_PAYMENT_METHOD')
    }

    // Get attempt count for this invoice
    const attempts = await this.getAttempts(invoiceId)
    const attemptNumber = attempts.length + 1

    // Create attempt record
    const attempt: PaymentAttempt = {
      id: `pay_${crypto.randomUUID().slice(0, 8)}`,
      invoiceId,
      subscriptionId,
      amount,
      currency,
      status: 'pending',
      paymentMethodId: method.id,
      attemptedAt: new Date(),
    }

    await this.saveAttempt(attempt)

    this.$.send('Payment.attempted', {
      invoiceId,
      subscriptionId,
      attemptNumber,
      amount,
    })

    // Process payment (simulated - in production: call Stripe, etc.)
    const result = await this.callPaymentGateway(method, amount, currency)

    attempt.processedAt = new Date()

    if (result.success) {
      attempt.status = 'succeeded'
      await this.saveAttempt(attempt)

      // Cancel any pending retries
      await this.cancelRetries(invoiceId)

      this.$.send('Payment.succeeded', {
        invoiceId,
        subscriptionId,
        paymentId: attempt.id,
        amount,
      })

      this.$.send('Customer.notify', {
        customerId: this.ns,
        type: 'payment_succeeded',
        data: { invoiceId, amount: amount / 100, currency },
      })

      return attempt
    } else {
      attempt.status = 'failed'
      attempt.failureCode = result.error?.code
      attempt.failureMessage = result.error?.message
      await this.saveAttempt(attempt)

      // Check if we should retry
      const exhausted = attemptNumber > MAX_RETRIES

      this.$.send('Payment.failed', {
        invoiceId,
        subscriptionId,
        attemptCount: attemptNumber,
        exhausted,
        reason: result.error?.message ?? 'Payment declined',
      })

      this.$.send('Customer.notify', {
        customerId: this.ns,
        type: 'payment_failed',
        data: {
          invoiceId,
          amount: amount / 100,
          reason: result.error?.message,
          willRetry: !exhausted,
        },
      })

      // Schedule retry if not exhausted
      if (!exhausted) {
        await this.scheduleRetry(invoiceId, subscriptionId, amount, currency, attemptNumber)
      }

      return attempt
    }
  }

  /**
   * Add a payment method.
   */
  async addPaymentMethod(
    type: PaymentMethodType,
    token: string,
    makeDefault?: boolean
  ): Promise<PaymentMethod> {
    // In production: validate token with payment gateway
    // Stripe: stripe.paymentMethods.attach(token, { customer: customerId })

    const method: PaymentMethod = {
      id: `pm_${crypto.randomUUID().slice(0, 8)}`,
      type,
      last4: token.slice(-4), // Demo: use last 4 of token
      brand: type === 'card' ? 'visa' : undefined,
      expiryMonth: 12,
      expiryYear: new Date().getFullYear() + 2,
      isDefault: makeDefault ?? false,
      createdAt: new Date(),
    }

    const methods = await this.getPaymentMethods()

    // If making default, unset others
    if (makeDefault) {
      for (const m of methods) {
        m.isDefault = false
      }
    }

    // If no methods exist, make this one default
    if (methods.length === 0) {
      method.isDefault = true
    }

    methods.push(method)
    await this.ctx.storage.put('paymentMethods', methods)

    return method
  }

  /**
   * Remove a payment method.
   */
  async removePaymentMethod(paymentMethodId: string): Promise<void> {
    const methods = await this.getPaymentMethods()
    const index = methods.findIndex((m) => m.id === paymentMethodId)

    if (index === -1) {
      throw new PaymentError('Payment method not found', 'NOT_FOUND')
    }

    const wasDefault = methods[index].isDefault
    methods.splice(index, 1)

    // If removed method was default, make first remaining method default
    if (wasDefault && methods.length > 0) {
      methods[0].isDefault = true
    }

    await this.ctx.storage.put('paymentMethods', methods)
  }

  /**
   * Set default payment method.
   */
  async setDefaultPaymentMethod(paymentMethodId: string): Promise<void> {
    const methods = await this.getPaymentMethods()
    let found = false

    for (const method of methods) {
      if (method.id === paymentMethodId) {
        method.isDefault = true
        found = true
      } else {
        method.isDefault = false
      }
    }

    if (!found) {
      throw new PaymentError('Payment method not found', 'NOT_FOUND')
    }

    await this.ctx.storage.put('paymentMethods', methods)
  }

  /**
   * Get all payment methods.
   */
  async getPaymentMethods(): Promise<PaymentMethod[]> {
    return (await this.ctx.storage.get<PaymentMethod[]>('paymentMethods')) ?? []
  }

  /**
   * Process a refund.
   */
  async refund(paymentId: string, amount?: number, reason?: string): Promise<void> {
    const attempts = await this.getAllAttempts()
    const attempt = attempts.find((a) => a.id === paymentId)

    if (!attempt) {
      throw new PaymentError('Payment not found', 'NOT_FOUND')
    }

    if (attempt.status !== 'succeeded') {
      throw new PaymentError('Can only refund succeeded payments', 'INVALID_STATE')
    }

    const refundAmount = amount ?? attempt.amount

    // In production: call payment gateway
    // Stripe: stripe.refunds.create({ payment_intent: paymentId, amount })

    attempt.status = 'refunded'
    await this.saveAttempt(attempt)

    this.$.send('Payment.refunded', {
      paymentId,
      invoiceId: attempt.invoiceId,
      amount: refundAmount,
      reason,
    })

    this.$.send('Customer.notify', {
      customerId: this.ns,
      type: 'payment_refunded',
      data: { paymentId, amount: refundAmount / 100 },
    })
  }

  /**
   * Get payment attempts for an invoice.
   */
  async getAttempts(invoiceId: string): Promise<PaymentAttempt[]> {
    const all = await this.getAllAttempts()
    return all.filter((a) => a.invoiceId === invoiceId)
  }

  /**
   * Get payment history.
   */
  async getHistory(limit: number = 20): Promise<PaymentAttempt[]> {
    const all = await this.getAllAttempts()
    return all.slice(-limit).reverse()
  }

  // ==========================================================================
  // INTERNAL METHODS
  // ==========================================================================

  /**
   * Get all payment attempts.
   */
  private async getAllAttempts(): Promise<PaymentAttempt[]> {
    return (await this.ctx.storage.get<PaymentAttempt[]>('attempts')) ?? []
  }

  /**
   * Save a payment attempt.
   */
  private async saveAttempt(attempt: PaymentAttempt): Promise<void> {
    const attempts = await this.getAllAttempts()
    const index = attempts.findIndex((a) => a.id === attempt.id)

    if (index >= 0) {
      attempts[index] = attempt
    } else {
      attempts.push(attempt)
    }

    await this.ctx.storage.put('attempts', attempts)
  }

  /**
   * Schedule a payment retry.
   */
  private async scheduleRetry(
    invoiceId: string,
    subscriptionId: string,
    amount: number,
    currency: string,
    currentAttempt: number
  ): Promise<void> {
    const delayDays = DUNNING_SCHEDULE[currentAttempt - 1] ?? DUNNING_SCHEDULE[DUNNING_SCHEDULE.length - 1]
    const scheduledFor = new Date()
    scheduledFor.setDate(scheduledFor.getDate() + delayDays)

    const retry: RetrySchedule = {
      invoiceId,
      subscriptionId,
      amount,
      currency,
      attemptNumber: currentAttempt + 1,
      scheduledFor,
      status: 'pending',
    }

    const retryId = `${invoiceId}:${retry.attemptNumber}`
    await this.ctx.storage.put(`retry:${retryId}`, retry)

    // Track pending retries
    const pendingIds = (await this.ctx.storage.get<string[]>('pendingRetries')) ?? []
    pendingIds.push(retryId)
    await this.ctx.storage.put('pendingRetries', pendingIds)

    this.$.send('Retry.scheduled', {
      invoiceId,
      subscriptionId,
      attemptNumber: retry.attemptNumber,
      scheduledFor,
      delayDays,
    })

    console.log(`[Payment] Retry ${retry.attemptNumber} scheduled for ${scheduledFor.toISOString()}`)
  }

  /**
   * Get pending retries.
   */
  private async getPendingRetries(): Promise<RetrySchedule[]> {
    const pendingIds = (await this.ctx.storage.get<string[]>('pendingRetries')) ?? []
    const retries: RetrySchedule[] = []

    for (const id of pendingIds) {
      const retry = await this.ctx.storage.get<RetrySchedule>(`retry:${id}`)
      if (retry && retry.status === 'pending') {
        retries.push(retry)
      }
    }

    return retries
  }

  /**
   * Cancel pending retries for an invoice.
   */
  private async cancelRetries(invoiceId: string): Promise<void> {
    const pendingIds = (await this.ctx.storage.get<string[]>('pendingRetries')) ?? []
    const remainingIds: string[] = []

    for (const id of pendingIds) {
      const retry = await this.ctx.storage.get<RetrySchedule>(`retry:${id}`)
      if (retry && retry.invoiceId === invoiceId) {
        retry.status = 'cancelled'
        await this.ctx.storage.put(`retry:${id}`, retry)
      } else {
        remainingIds.push(id)
      }
    }

    await this.ctx.storage.put('pendingRetries', remainingIds)
  }

  /**
   * Call payment gateway (simulated).
   */
  private async callPaymentGateway(
    method: PaymentMethod,
    amount: number,
    currency: string
  ): Promise<{
    success: boolean
    transactionId?: string
    error?: { code: string; message: string }
  }> {
    // Simulate payment processing
    // In production: call Stripe, Braintree, etc.
    //
    // Stripe example:
    // const paymentIntent = await stripe.paymentIntents.create({
    //   amount,
    //   currency,
    //   customer: this.ns,
    //   payment_method: method.id,
    //   confirm: true,
    // })

    // Simulate 85% success rate for demo
    const success = Math.random() > 0.15

    if (success) {
      return {
        success: true,
        transactionId: `txn_${crypto.randomUUID().slice(0, 8)}`,
      }
    } else {
      // Simulate different failure reasons
      const failures = [
        { code: 'card_declined', message: 'Your card was declined' },
        { code: 'insufficient_funds', message: 'Insufficient funds' },
        { code: 'expired_card', message: 'Your card has expired' },
        { code: 'processing_error', message: 'An error occurred while processing' },
      ]
      const error = failures[Math.floor(Math.random() * failures.length)]

      return {
        success: false,
        error,
      }
    }
  }
}
