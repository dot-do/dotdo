// Payment Durable Object
// Handles: Payment processing, refunds
// Reacts to: Payment.requested, Payment.refund

import { DO, type DOEnv, createContext } from '@dotdo/do'
import type { Payment, PaymentStatus } from './types'

export class PaymentDO extends DO {
  constructor(state: DurableObjectState, env: DOEnv) {
    super(state, env)
    this.$ = createContext(state, env)

    // React to payment requests
    this.$.on.Payment.requested(async (event) => {
      const { orderId, amount, idempotencyKey } = (event as { type: string; payload: { orderId: string; amount: number; idempotencyKey: string } }).payload
      console.log(`[Payment] Processing payment for order ${orderId}: $${(amount / 100).toFixed(2)}`)

      // Check idempotency - don't double charge
      const existingPayments = await this.things.list({ type: 'Payment' })
      const existing = existingPayments.find((p) => (p as unknown as Payment).orderId === orderId)
      if (existing) {
        console.log(`[Payment] Duplicate request for order ${orderId}, returning existing`)
        const ep = existing as unknown as Payment
        if (ep.status === 'completed') {
          this.$.send({
            type: 'Payment.completed',
            payload: { orderId, paymentId: existing.$id, transactionId: ep.transactionId },
          })
        }
        return
      }

      // Create payment record
      const payment = await this.things.create({
        $type: 'Payment',
        orderId,
        amount,
        status: 'processing' as PaymentStatus,
        createdAt: new Date().toISOString(),
      })

      // Simulate payment processing (90% success rate)
      const success = Math.random() < 0.9

      if (success) {
        const transactionId = `txn_${Date.now()}`
        await this.things.update(payment.$id, {
          status: 'completed',
          transactionId,
          completedAt: new Date().toISOString(),
        })

        console.log(`[Payment] Payment ${payment.$id} completed for order ${orderId}`)

        // Fire event (choreography)
        this.$.send({
          type: 'Payment.completed',
          payload: { orderId, paymentId: payment.$id, transactionId },
        })
      } else {
        await this.things.update(payment.$id, {
          status: 'failed',
          errorMessage: 'Payment declined by issuer',
        })

        console.log(`[Payment] Payment ${payment.$id} failed for order ${orderId}`)

        // Fire event (choreography)
        this.$.send({
          type: 'Payment.failed',
          payload: { orderId, paymentId: payment.$id, reason: 'Payment declined by issuer' },
        })
      }
    })

    // React to refund requests
    this.$.on.Payment.refund(async (event) => {
      const { orderId, paymentId, amount, reason } = (event as { type: string; payload: { orderId: string; paymentId: string; amount: number; reason: string } }).payload
      console.log(`[Payment] Processing refund for order ${orderId}: $${(amount / 100).toFixed(2)}`)

      const payment = await this.things.get(paymentId)
      if (!payment || payment.$type !== 'Payment') {
        console.log(`[Payment] Payment ${paymentId} not found for refund`)
        return
      }

      const refundId = `ref_${Date.now()}`
      await this.things.update(paymentId, {
        status: 'refunded',
        refundId,
      })

      console.log(`[Payment] Refund ${refundId} completed for payment ${paymentId}`)

      this.$.send({
        type: 'Payment.refunded',
        payload: { orderId, paymentId, refundId, amount },
      })
    })
  }
}
