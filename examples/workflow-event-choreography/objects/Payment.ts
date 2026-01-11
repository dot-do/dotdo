/**
 * Payment Durable Object - Payment Processing Service
 *
 * The Payment DO handles all payment-related events:
 * - Processing payment requests
 * - Handling refunds
 * - Idempotency for duplicate requests
 *
 * In production, this would integrate with Stripe, PayPal, etc.
 */

import { DO } from 'dotdo'
import type {
  PaymentRequestedEvent,
  PaymentCompletedEvent,
  PaymentFailedEvent,
  PaymentRefundedEvent,
} from '../events/types'

// ============================================================================
// TYPES
// ============================================================================

interface Payment {
  id: string
  orderId: string
  customerId: string
  amount: number
  status: 'pending' | 'completed' | 'failed' | 'refunded'
  idempotencyKey: string
  gatewayTransactionId?: string
  failureReason?: string
  createdAt: string
  completedAt?: string
  refundedAt?: string
}

interface PaymentIndex {
  payments: Record<string, Payment> // keyed by orderId
  byIdempotencyKey: Record<string, string> // idempotency key -> orderId
}

// ============================================================================
// PAYMENT DURABLE OBJECT
// ============================================================================

export class PaymentDO extends DO {
  static readonly $type = 'PaymentDO'

  /**
   * Initialize event handlers on startup.
   */
  async onStart() {
    // ========================================================================
    // PAYMENT REQUEST HANDLER
    // ========================================================================

    /**
     * Payment.requested - Process a payment request.
     *
     * This demonstrates idempotency handling - if we receive a duplicate
     * request with the same idempotency key, we return the existing result.
     */
    this.$.on.Payment.requested(async (event) => {
      const request = event.data as PaymentRequestedEvent

      console.log(`[Payment] Processing payment for order ${request.orderId}: $${request.amount}`)

      // Check for idempotent duplicate
      const index = await this.getIndex()
      const existingOrderId = index.byIdempotencyKey[request.idempotencyKey]

      if (existingOrderId) {
        const existingPayment = index.payments[existingOrderId]
        if (existingPayment) {
          console.log(`[Payment] Idempotent duplicate for ${request.orderId}, returning existing result`)

          // Re-emit the same result
          if (existingPayment.status === 'completed') {
            this.$.send('Payment.completed', {
              orderId: existingPayment.orderId,
              paymentId: existingPayment.id,
              amount: existingPayment.amount,
              completedAt: existingPayment.completedAt,
            } as PaymentCompletedEvent)
          } else if (existingPayment.status === 'failed') {
            this.$.send('Payment.failed', {
              orderId: existingPayment.orderId,
              error: existingPayment.failureReason || 'Unknown error',
              code: 'UNKNOWN',
              failedAt: existingPayment.createdAt,
            } as PaymentFailedEvent)
          }
          return
        }
      }

      // Create new payment record
      const paymentId = `pay_${crypto.randomUUID().slice(0, 8)}`
      const now = new Date().toISOString()

      const payment: Payment = {
        id: paymentId,
        orderId: request.orderId,
        customerId: request.customerId,
        amount: request.amount,
        status: 'pending',
        idempotencyKey: request.idempotencyKey,
        createdAt: now,
      }

      // Process payment (simulated)
      const result = await this.processPaymentWithGateway(payment)

      if (result.success) {
        payment.status = 'completed'
        payment.gatewayTransactionId = result.transactionId
        payment.completedAt = new Date().toISOString()

        // Store payment
        await this.savePayment(payment)

        console.log(`[Payment] Payment ${paymentId} completed for order ${request.orderId}`)

        // Emit success event
        this.$.send('Payment.completed', {
          orderId: payment.orderId,
          paymentId: payment.id,
          amount: payment.amount,
          completedAt: payment.completedAt,
        } as PaymentCompletedEvent)

        // Notify customer
        this.$.send('Customer.notified', {
          customerId: payment.customerId,
          orderId: payment.orderId,
          type: 'payment_received',
          message: `Payment of $${payment.amount.toFixed(2)} received for order ${payment.orderId}`,
          sentAt: new Date().toISOString(),
        })
      } else {
        payment.status = 'failed'
        payment.failureReason = result.error

        // Store failed payment
        await this.savePayment(payment)

        console.log(`[Payment] Payment failed for order ${request.orderId}: ${result.error}`)

        // Emit failure event
        this.$.send('Payment.failed', {
          orderId: payment.orderId,
          error: result.error,
          code: result.errorCode,
          failedAt: new Date().toISOString(),
        } as PaymentFailedEvent)

        // Notify customer of failure
        this.$.send('Customer.notified', {
          customerId: payment.customerId,
          orderId: payment.orderId,
          type: 'payment_failed',
          message: `Payment failed for order ${payment.orderId}: ${result.error}`,
          sentAt: new Date().toISOString(),
        })
      }
    })

    // ========================================================================
    // REFUND HANDLER
    // ========================================================================

    /**
     * Payment.refund - Process a refund request.
     */
    this.$.on.Payment.refund(async (event) => {
      const request = event.data as {
        orderId: string
        paymentId: string
        amount: number
        reason: string
      }

      console.log(`[Payment] Processing refund for order ${request.orderId}: $${request.amount}`)

      const index = await this.getIndex()
      const payment = index.payments[request.orderId]

      if (!payment) {
        console.error(`[Payment] Payment not found for order ${request.orderId}`)
        return
      }

      if (payment.status !== 'completed') {
        console.log(`[Payment] Cannot refund payment in status: ${payment.status}`)
        return
      }

      // Process refund (simulated)
      const refundResult = await this.processRefundWithGateway(payment, request.amount)

      if (refundResult.success) {
        payment.status = 'refunded'
        payment.refundedAt = new Date().toISOString()

        await this.savePayment(payment)

        console.log(`[Payment] Refund completed for order ${request.orderId}`)

        // Emit refund event
        this.$.send('Payment.refunded', {
          orderId: payment.orderId,
          paymentId: payment.id,
          refundId: refundResult.refundId,
          amount: request.amount,
          reason: request.reason,
          refundedAt: payment.refundedAt,
        } as PaymentRefundedEvent)

        // Notify customer
        this.$.send('Customer.notified', {
          customerId: payment.customerId,
          orderId: payment.orderId,
          type: 'refunded',
          message: `Refund of $${request.amount.toFixed(2)} processed for order ${payment.orderId}`,
          sentAt: new Date().toISOString(),
        })
      } else {
        console.error(`[Payment] Refund failed for order ${request.orderId}: ${refundResult.error}`)
        // In production, this would trigger an alert or retry mechanism
      }
    })

    console.log('[PaymentDO] Event handlers registered')
  }

  // ==========================================================================
  // PAYMENT GATEWAY SIMULATION
  // ==========================================================================

  /**
   * Simulate payment processing with a gateway.
   * In production, this would call Stripe, PayPal, etc.
   */
  private async processPaymentWithGateway(payment: Payment): Promise<{
    success: boolean
    transactionId?: string
    error?: string
    errorCode?: 'INSUFFICIENT_FUNDS' | 'CARD_DECLINED' | 'FRAUD_DETECTED' | 'EXPIRED' | 'UNKNOWN'
  }> {
    // Simulate network latency
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Simulate 90% success rate for demo
    const successRate = 0.9
    const isSuccess = Math.random() < successRate

    if (isSuccess) {
      return {
        success: true,
        transactionId: `txn_${crypto.randomUUID().slice(0, 12)}`,
      }
    }

    // Simulate different failure reasons
    const failures = [
      { error: 'Insufficient funds', errorCode: 'INSUFFICIENT_FUNDS' as const },
      { error: 'Card declined by issuer', errorCode: 'CARD_DECLINED' as const },
      { error: 'Transaction flagged as potential fraud', errorCode: 'FRAUD_DETECTED' as const },
      { error: 'Card has expired', errorCode: 'EXPIRED' as const },
    ]

    const failure = failures[Math.floor(Math.random() * failures.length)]

    return {
      success: false,
      error: failure.error,
      errorCode: failure.errorCode,
    }
  }

  /**
   * Simulate refund processing.
   */
  private async processRefundWithGateway(
    payment: Payment,
    amount: number
  ): Promise<{
    success: boolean
    refundId?: string
    error?: string
  }> {
    // Simulate network latency
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Refunds have 99% success rate
    if (Math.random() < 0.99) {
      return {
        success: true,
        refundId: `ref_${crypto.randomUUID().slice(0, 8)}`,
      }
    }

    return {
      success: false,
      error: 'Refund gateway temporarily unavailable',
    }
  }

  // ==========================================================================
  // INDEX MANAGEMENT
  // ==========================================================================

  /**
   * Get the payment index.
   */
  private async getIndex(): Promise<PaymentIndex> {
    const index = await this.get<PaymentIndex>('index')
    return index ?? { payments: {}, byIdempotencyKey: {} }
  }

  /**
   * Save a payment to the index.
   */
  private async savePayment(payment: Payment): Promise<void> {
    const index = await this.getIndex()

    index.payments[payment.orderId] = payment
    index.byIdempotencyKey[payment.idempotencyKey] = payment.orderId

    await this.set('index', index)
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  /**
   * Get payment for an order.
   */
  async getPayment(orderId: string): Promise<Payment | null> {
    const index = await this.getIndex()
    return index.payments[orderId] ?? null
  }

  /**
   * Get all payments.
   */
  async getAllPayments(): Promise<Payment[]> {
    const index = await this.getIndex()
    return Object.values(index.payments)
  }
}
