/**
 * EscrowDO - Escrow Transaction Durable Object
 *
 * Manages the complete escrow lifecycle for marketplace transactions.
 * Implements a state machine with automatic timeouts and event-driven transitions.
 *
 * State Machine:
 * ```
 * PENDING -> FUNDED -> DELIVERED -> RELEASED
 *              |          |
 *              v          v
 *          CANCELLED  DISPUTED -> RESOLVED
 *              |          |
 *              v          v
 *          REFUNDED   (REFUNDED or RELEASED based on decision)
 * ```
 *
 * Events Emitted:
 * - Escrow.created - New escrow created
 * - Escrow.funded - Buyer funded the escrow
 * - Escrow.delivered - Seller marked as delivered
 * - Escrow.released - Funds released to seller
 * - Escrow.disputed - Dispute opened
 * - Escrow.resolved - Dispute resolved
 * - Escrow.refunded - Funds refunded to buyer
 * - Escrow.cancelled - Escrow cancelled
 * - Escrow.timeout - Auto-action triggered by timeout
 */

import { DO } from 'dotdo'
import type {
  Escrow,
  EscrowStatus,
  TrackingInfo,
  TimelineEvent,
  CreateEscrowRequest,
  FundEscrowRequest,
  DeliverRequest,
  FeeDistribution,
} from '../types'

// ============================================================================
// ERROR CLASS
// ============================================================================

export class EscrowError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'EscrowError'
  }
}

// ============================================================================
// STATE MACHINE TRANSITIONS
// ============================================================================

/**
 * Valid state transitions for escrow lifecycle
 */
const VALID_TRANSITIONS: Record<EscrowStatus, EscrowStatus[]> = {
  pending: ['funded', 'cancelled'],
  funded: ['delivered', 'disputed', 'cancelled', 'refunded'],
  delivered: ['released', 'disputed'],
  released: [], // Terminal state
  disputed: ['resolved'],
  resolved: [], // Terminal state (funds distributed per resolution)
  refunded: [], // Terminal state
  cancelled: [], // Terminal state
}

// ============================================================================
// ESCROW DURABLE OBJECT
// ============================================================================

export class EscrowDO extends DO {
  static readonly $type = 'EscrowDO'

  // Default configuration (can be overridden by env vars)
  private readonly DEFAULT_INSPECTION_DAYS = 3
  private readonly DEFAULT_DELIVERY_DAYS = 5
  private readonly PLATFORM_FEE_PERCENT = 2.5
  private readonly ESCROW_FEE_PERCENT = 0.5

  /**
   * Register event handlers and alarms on startup.
   */
  async onStart() {
    // ========================================================================
    // TIMEOUT HANDLERS (Alarm-based)
    // ========================================================================

    /**
     * Handle delivery timeout - auto-refund if seller doesn't deliver
     */
    this.$.on.Escrow.deliveryTimeout(async (event) => {
      const { escrowId } = event.data as { escrowId: string }
      const escrow = await this.getEscrow(escrowId)

      if (!escrow) return
      if (escrow.status !== 'funded') return // Already transitioned

      console.log(`[Escrow.deliveryTimeout] Auto-refunding escrow ${escrowId}`)

      await this.refundEscrow(escrowId, 'Delivery deadline exceeded')
      this.$.send('Email.notify', {
        to: escrow.buyer,
        template: 'delivery_timeout_refund',
        data: { escrowId, amount: escrow.amount },
      })
    })

    /**
     * Handle inspection timeout - auto-release if buyer doesn't dispute
     */
    this.$.on.Escrow.inspectionTimeout(async (event) => {
      const { escrowId } = event.data as { escrowId: string }
      const escrow = await this.getEscrow(escrowId)

      if (!escrow) return
      if (escrow.status !== 'delivered') return // Already transitioned

      console.log(`[Escrow.inspectionTimeout] Auto-releasing escrow ${escrowId}`)

      await this.releaseEscrow(escrowId)
      this.$.send('Email.notify', {
        to: escrow.seller,
        template: 'inspection_passed_release',
        data: { escrowId, amount: escrow.amount },
      })
    })

    // ========================================================================
    // NOTIFICATION HANDLERS
    // ========================================================================

    this.$.on.Escrow.funded(async (event) => {
      const { escrowId, buyer, seller, amount } = event.data as {
        escrowId: string
        buyer: string
        seller: string
        amount: number
      }

      console.log(`[Escrow.funded] Escrow ${escrowId} funded by ${buyer}`)

      // Notify seller to ship
      this.$.send('Email.notify', {
        to: seller,
        template: 'escrow_funded_ship',
        data: { escrowId, amount, buyer },
      })
    })

    this.$.on.Escrow.delivered(async (event) => {
      const { escrowId, buyer, tracking } = event.data as {
        escrowId: string
        buyer: string
        tracking: TrackingInfo
      }

      console.log(`[Escrow.delivered] Escrow ${escrowId} marked as delivered`)

      // Notify buyer to inspect
      this.$.send('Email.notify', {
        to: buyer,
        template: 'item_delivered_inspect',
        data: { escrowId, tracking },
      })
    })

    this.$.on.Escrow.released(async (event) => {
      const { escrowId, seller, amount, fees } = event.data as {
        escrowId: string
        seller: string
        amount: number
        fees: FeeDistribution
      }

      console.log(`[Escrow.released] Escrow ${escrowId} released to ${seller}`)

      // Process payment to seller
      this.$.send('Payment.transfer', {
        to: seller,
        amount: fees.sellerReceives,
        escrowId,
      })

      // Collect platform fees
      this.$.send('Platform.collectFees', {
        escrowId,
        platformFee: fees.platformFee,
        escrowFee: fees.escrowFee,
      })
    })

    console.log('[EscrowDO] Event handlers registered')
  }

  // ==========================================================================
  // ESCROW LIFECYCLE METHODS
  // ==========================================================================

  /**
   * Create a new escrow transaction.
   */
  async createEscrow(request: CreateEscrowRequest): Promise<Escrow> {
    const id = this.ns // Use DO namespace as escrow ID
    const now = new Date().toISOString()

    const inspectionDays = request.inspectionDays ?? this.DEFAULT_INSPECTION_DAYS
    const deliveryDays = request.deliveryDays ?? this.DEFAULT_DELIVERY_DAYS

    const escrow: Escrow = {
      id,
      buyer: request.buyer,
      seller: request.seller,
      arbiter: request.arbiter ?? 'platform',
      amount: request.amount,
      currency: request.currency ?? 'USD',
      itemDescription: request.itemDescription,
      status: 'pending',
      inspectionDays,
      deliveryDays,
      createdAt: now,
      updatedAt: now,
      deliveryDeadline: this.calculateDeadline(deliveryDays),
      timeline: [
        {
          event: 'Escrow.created',
          timestamp: now,
          details: {
            buyer: request.buyer,
            seller: request.seller,
            amount: request.amount,
            itemDescription: request.itemDescription,
          },
        },
      ],
    }

    await this.ctx.storage.put('escrow', escrow)

    this.$.send('Escrow.created', {
      escrowId: id,
      buyer: request.buyer,
      seller: request.seller,
      amount: request.amount,
    })

    return escrow
  }

  /**
   * Fund the escrow (buyer action).
   */
  async fundEscrow(request: FundEscrowRequest): Promise<Escrow> {
    const escrow = await this.getEscrowOrThrow()
    this.validateTransition(escrow.status, 'funded')

    const now = new Date().toISOString()

    // In production: integrate with Stripe/payment provider
    // await stripe.paymentIntents.create({ amount: escrow.amount * 100, ... })

    escrow.status = 'funded'
    escrow.fundedAt = now
    escrow.updatedAt = now
    escrow.deliveryDeadline = this.calculateDeadline(escrow.deliveryDays)

    this.addTimelineEvent(escrow, 'Escrow.funded', escrow.buyer, {
      paymentMethod: request.paymentMethod.type,
    })

    await this.ctx.storage.put('escrow', escrow)

    // Schedule delivery timeout
    this.scheduleTimeout('deliveryTimeout', escrow.deliveryDays)

    this.$.send('Escrow.funded', {
      escrowId: escrow.id,
      buyer: escrow.buyer,
      seller: escrow.seller,
      amount: escrow.amount,
    })

    return escrow
  }

  /**
   * Mark item as delivered (seller action).
   */
  async markDelivered(request: DeliverRequest): Promise<Escrow> {
    const escrow = await this.getEscrowOrThrow()
    this.validateTransition(escrow.status, 'delivered')

    const now = new Date().toISOString()

    escrow.status = 'delivered'
    escrow.deliveredAt = now
    escrow.updatedAt = now
    escrow.tracking = {
      carrier: request.carrier,
      trackingNumber: request.trackingNumber,
      estimatedDelivery: request.estimatedDelivery,
    }
    escrow.inspectionDeadline = this.calculateDeadline(escrow.inspectionDays)

    this.addTimelineEvent(escrow, 'Escrow.delivered', escrow.seller, {
      tracking: escrow.tracking,
    })

    await this.ctx.storage.put('escrow', escrow)

    // Cancel delivery timeout, schedule inspection timeout
    this.cancelTimeout('deliveryTimeout')
    this.scheduleTimeout('inspectionTimeout', escrow.inspectionDays)

    this.$.send('Escrow.delivered', {
      escrowId: escrow.id,
      buyer: escrow.buyer,
      seller: escrow.seller,
      tracking: escrow.tracking,
    })

    return escrow
  }

  /**
   * Confirm receipt and release funds (buyer action).
   */
  async confirmReceipt(rating?: number): Promise<Escrow> {
    const escrow = await this.getEscrowOrThrow()
    this.validateTransition(escrow.status, 'released')

    return this.releaseEscrow(escrow.id, rating)
  }

  /**
   * Release escrow funds to seller.
   */
  async releaseEscrow(escrowId: string, rating?: number): Promise<Escrow> {
    const escrow = await this.getEscrowOrThrow()

    const now = new Date().toISOString()
    const fees = this.calculateFees(escrow.amount)

    escrow.status = 'released'
    escrow.releasedAt = now
    escrow.updatedAt = now

    this.addTimelineEvent(escrow, 'Escrow.released', escrow.buyer, {
      rating,
      releasedTo: escrow.seller,
      fees,
    })

    await this.ctx.storage.put('escrow', escrow)

    // Cancel any pending timeouts
    this.cancelTimeout('inspectionTimeout')

    this.$.send('Escrow.released', {
      escrowId: escrow.id,
      buyer: escrow.buyer,
      seller: escrow.seller,
      amount: escrow.amount,
      fees,
      rating,
    })

    return escrow
  }

  /**
   * Refund escrow to buyer.
   */
  async refundEscrow(escrowId: string, reason: string): Promise<Escrow> {
    const escrow = await this.getEscrowOrThrow()

    if (['released', 'resolved', 'refunded'].includes(escrow.status)) {
      throw new EscrowError('Escrow already completed', 'ALREADY_COMPLETED', {
        status: escrow.status,
      })
    }

    const now = new Date().toISOString()

    escrow.status = 'refunded'
    escrow.refundedAt = now
    escrow.updatedAt = now

    this.addTimelineEvent(escrow, 'Escrow.refunded', 'system', {
      reason,
      refundedTo: escrow.buyer,
      amount: escrow.amount,
    })

    await this.ctx.storage.put('escrow', escrow)

    // Cancel any pending timeouts
    this.cancelAllTimeouts()

    this.$.send('Escrow.refunded', {
      escrowId: escrow.id,
      buyer: escrow.buyer,
      amount: escrow.amount,
      reason,
    })

    // Process refund payment
    this.$.send('Payment.refund', {
      to: escrow.buyer,
      amount: escrow.amount,
      escrowId: escrow.id,
      reason,
    })

    return escrow
  }

  /**
   * Cancel escrow (before delivery only).
   */
  async cancelEscrow(cancelledBy: string, reason: string): Promise<Escrow> {
    const escrow = await this.getEscrowOrThrow()
    this.validateTransition(escrow.status, 'cancelled')

    const now = new Date().toISOString()
    const wasFunded = escrow.status === 'funded'

    escrow.status = 'cancelled'
    escrow.cancelledAt = now
    escrow.updatedAt = now

    // If was funded, add refund event
    if (wasFunded) {
      this.addTimelineEvent(escrow, 'Escrow.refunded', 'system', {
        reason: 'Cancelled',
        refundedTo: escrow.buyer,
      })
    }

    this.addTimelineEvent(escrow, 'Escrow.cancelled', cancelledBy, { reason })

    await this.ctx.storage.put('escrow', escrow)

    // Cancel any pending timeouts
    this.cancelAllTimeouts()

    this.$.send('Escrow.cancelled', {
      escrowId: escrow.id,
      buyer: escrow.buyer,
      seller: escrow.seller,
      cancelledBy,
      reason,
      wasFunded,
    })

    // Refund if was funded
    if (wasFunded) {
      this.$.send('Payment.refund', {
        to: escrow.buyer,
        amount: escrow.amount,
        escrowId: escrow.id,
        reason: 'Escrow cancelled',
      })
    }

    return escrow
  }

  /**
   * Transition to disputed status.
   * Called by DisputeDO when a dispute is opened.
   */
  async markDisputed(disputeId: string, openedBy: 'buyer' | 'seller', reason: string): Promise<Escrow> {
    const escrow = await this.getEscrowOrThrow()
    this.validateTransition(escrow.status, 'disputed')

    const now = new Date().toISOString()

    escrow.status = 'disputed'
    escrow.disputedAt = now
    escrow.updatedAt = now
    escrow.disputeId = disputeId

    this.addTimelineEvent(
      escrow,
      'Escrow.disputed',
      openedBy === 'buyer' ? escrow.buyer : escrow.seller,
      { disputeId, reason }
    )

    await this.ctx.storage.put('escrow', escrow)

    // Cancel inspection timeout while disputed
    this.cancelTimeout('inspectionTimeout')

    this.$.send('Escrow.disputed', {
      escrowId: escrow.id,
      disputeId,
      buyer: escrow.buyer,
      seller: escrow.seller,
      openedBy,
      reason,
    })

    return escrow
  }

  /**
   * Mark escrow as resolved after dispute resolution.
   * Called by DisputeDO after resolution decision.
   */
  async markResolved(
    disputeId: string,
    decision: string,
    buyerAmount: number,
    sellerAmount: number,
    notes: string
  ): Promise<Escrow> {
    const escrow = await this.getEscrowOrThrow()

    if (escrow.status !== 'disputed') {
      throw new EscrowError('Escrow not in disputed state', 'INVALID_STATE')
    }

    const now = new Date().toISOString()

    escrow.status = 'resolved'
    escrow.resolvedAt = now
    escrow.updatedAt = now

    this.addTimelineEvent(escrow, 'Escrow.resolved', 'arbiter', {
      disputeId,
      decision,
      buyerAmount,
      sellerAmount,
      notes,
    })

    await this.ctx.storage.put('escrow', escrow)

    this.$.send('Escrow.resolved', {
      escrowId: escrow.id,
      disputeId,
      buyer: escrow.buyer,
      seller: escrow.seller,
      buyerAmount,
      sellerAmount,
      decision,
    })

    // Distribute funds per resolution
    if (buyerAmount > 0) {
      this.$.send('Payment.refund', {
        to: escrow.buyer,
        amount: buyerAmount,
        escrowId: escrow.id,
        reason: `Dispute resolution: ${notes}`,
      })
    }

    if (sellerAmount > 0) {
      const fees = this.calculateFees(sellerAmount)
      this.$.send('Payment.transfer', {
        to: escrow.seller,
        amount: fees.sellerReceives,
        escrowId: escrow.id,
      })
    }

    return escrow
  }

  // ==========================================================================
  // QUERY METHODS
  // ==========================================================================

  /**
   * Get escrow details.
   */
  async getEscrow(escrowId?: string): Promise<Escrow | null> {
    return (await this.ctx.storage.get<Escrow>('escrow')) ?? null
  }

  /**
   * Get escrow or throw if not found.
   */
  private async getEscrowOrThrow(): Promise<Escrow> {
    const escrow = await this.getEscrow()
    if (!escrow) {
      throw new EscrowError('Escrow not found', 'NOT_FOUND')
    }
    return escrow
  }

  /**
   * Get escrow timeline.
   */
  async getTimeline(): Promise<TimelineEvent[]> {
    const escrow = await this.getEscrow()
    return escrow?.timeline ?? []
  }

  /**
   * Get current escrow status.
   */
  async getStatus(): Promise<{ status: EscrowStatus; canTransitionTo: EscrowStatus[] } | null> {
    const escrow = await this.getEscrow()
    if (!escrow) return null

    return {
      status: escrow.status,
      canTransitionTo: VALID_TRANSITIONS[escrow.status],
    }
  }

  // ==========================================================================
  // FEE CALCULATION
  // ==========================================================================

  /**
   * Calculate fee distribution for escrow amount.
   */
  calculateFees(amount: number): FeeDistribution {
    const platformFee = Math.round(amount * (this.PLATFORM_FEE_PERCENT / 100) * 100) / 100
    const escrowFee = Math.round(amount * (this.ESCROW_FEE_PERCENT / 100) * 100) / 100
    const sellerReceives = Math.round((amount - platformFee - escrowFee) * 100) / 100

    return {
      total: amount,
      platformFee,
      platformFeePercent: this.PLATFORM_FEE_PERCENT,
      escrowFee,
      escrowFeePercent: this.ESCROW_FEE_PERCENT,
      sellerReceives,
    }
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /**
   * Validate state transition.
   */
  private validateTransition(currentStatus: EscrowStatus, targetStatus: EscrowStatus): void {
    const validTargets = VALID_TRANSITIONS[currentStatus]
    if (!validTargets.includes(targetStatus)) {
      throw new EscrowError(
        `Cannot transition from ${currentStatus} to ${targetStatus}`,
        'INVALID_TRANSITION',
        { currentStatus, targetStatus, validTargets }
      )
    }
  }

  /**
   * Add event to timeline.
   */
  private addTimelineEvent(
    escrow: Escrow,
    event: string,
    actor: string,
    details?: Record<string, unknown>
  ): void {
    escrow.timeline.push({
      event,
      timestamp: new Date().toISOString(),
      actor,
      details,
    })
  }

  /**
   * Calculate deadline from days.
   */
  private calculateDeadline(days: number): string {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  }

  /**
   * Schedule a timeout alarm.
   */
  private scheduleTimeout(type: string, days: number): void {
    const alarmTime = Date.now() + days * 24 * 60 * 60 * 1000

    // Store timeout info for the alarm handler
    this.ctx.storage.put(`timeout:${type}`, {
      type,
      scheduledFor: new Date(alarmTime).toISOString(),
      escrowId: this.ns,
    })

    // In production: use this.ctx.storage.setAlarm(alarmTime)
    // For demo: emit delayed event
    console.log(`[EscrowDO] Scheduled ${type} for ${new Date(alarmTime).toISOString()}`)
  }

  /**
   * Cancel a specific timeout.
   */
  private cancelTimeout(type: string): void {
    this.ctx.storage.delete(`timeout:${type}`)
    console.log(`[EscrowDO] Cancelled ${type}`)
  }

  /**
   * Cancel all pending timeouts.
   */
  private cancelAllTimeouts(): void {
    this.cancelTimeout('deliveryTimeout')
    this.cancelTimeout('inspectionTimeout')
  }

  /**
   * Handle alarm (called by DO runtime).
   */
  async alarm(): Promise<void> {
    // Check which timeout triggered
    const deliveryTimeout = await this.ctx.storage.get('timeout:deliveryTimeout')
    const inspectionTimeout = await this.ctx.storage.get('timeout:inspectionTimeout')

    if (deliveryTimeout) {
      this.$.send('Escrow.deliveryTimeout', { escrowId: this.ns })
      await this.ctx.storage.delete('timeout:deliveryTimeout')
    }

    if (inspectionTimeout) {
      this.$.send('Escrow.inspectionTimeout', { escrowId: this.ns })
      await this.ctx.storage.delete('timeout:inspectionTimeout')
    }
  }
}
